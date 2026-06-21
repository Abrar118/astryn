use serde::Serialize;
use sqlx::SqlitePool;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tauri::State;

use crate::db;
use crate::db::issues::{
    self as issues, CalendarIssue, FilterOptions, Issue, IssueRecord, LabelRecord,
};
use crate::github::{GitHubClient, GitHubCredentialProvider, GitHubError};
use crate::linear::issues::{
    create_input_to_value, patch_to_input, validate_create_input, CreateIssueInput,
    DetailAttachment, DetailChild, DetailComment, DetailCycle, DetailHistory, DetailReaction,
    DetailRef, DetailRelation, DetailState, IssueDetailNode, NotificationsPage, OrgIdentity,
    ParsedCycle, ParsedIssue, ParsedUser, UpdateIssuePatch, WorkflowState,
};
use crate::linear::sync::{run_sync, SyncMode, SyncResult};
use crate::linear::{LinearClient, LinearCredentialProvider, LinearError};
use crate::secrets::SecretStore;

const LINEAR_KEY_ACCOUNT: &str = "linear_api_key";

pub mod github;

const GITHUB_TOKEN_ACCOUNT: &str = "github_token";

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LabelOut {
    pub id: String,
    pub name: Option<String>,
    pub color: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveDetail {
    #[serde(flatten)]
    pub issue: Issue,
    pub labels: Vec<LabelOut>,
    pub team_states: Vec<DetailState>,
    pub cycle: Option<DetailCycle>,
    pub parent: Option<DetailRef>,
    pub creator_name: Option<String>,
    pub children: Vec<DetailChild>,
    pub relations: Vec<DetailRelation>,
    pub attachments: Vec<DetailAttachment>,
    pub history: Vec<DetailHistory>,
    pub comments: Vec<DetailComment>,
    pub has_more_children: bool,
    pub has_more_relations: bool,
    pub has_more_history: bool,
    pub has_more_comments: bool,
}

#[derive(serde::Serialize)]
#[serde(tag = "source", rename_all = "lowercase")]
pub enum IssueDetailResult {
    Live { detail: Box<LiveDetail> },
    Cache { detail: Box<Issue> },
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Me {
    pub viewer_id: String,
    pub viewer_name: String,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum ConnectionStatus {
    NotConfigured,
    Unverified,
    Connected { name: String },
}

pub fn compute_status(has_key: bool, cached_name: Option<String>) -> ConnectionStatus {
    match (has_key, cached_name) {
        (false, _) => ConnectionStatus::NotConfigured,
        (true, Some(name)) => ConnectionStatus::Connected { name },
        (true, None) => ConnectionStatus::Unverified,
    }
}

#[derive(Debug, thiserror::Error)]
pub enum CmdError {
    #[error("Could not access secure storage.")]
    SecretStore,
    #[error("No Linear key is configured.")]
    NotConfigured,
    #[error("Could not reach Linear.")]
    Network,
    #[error("Rate limit reached. Try again shortly.")]
    RateLimited,
    #[error("Linear rejected the request.")]
    LinearApi,
    #[error("Internal error.")]
    Internal,
    #[error("Workspace changed; please retry.")]
    WorkspaceChanged,
    #[error("Required issue fields are missing.")]
    InvalidInput,
    #[error("Image unavailable.")]
    ImageUnavailable,
    #[error("Preview unavailable.")]
    PreviewUnavailable,
    #[error("No GitHub token is configured.")]
    GitHubNotConfigured,
    #[error("GitHub rejected the request.")]
    GitHubApi,
}

impl serde::Serialize for CmdError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

impl From<crate::link_preview::PreviewError> for CmdError {
    fn from(_: crate::link_preview::PreviewError) -> Self {
        CmdError::PreviewUnavailable
    }
}

impl From<LinearError> for CmdError {
    fn from(e: LinearError) -> Self {
        match e {
            LinearError::Network | LinearError::Server => CmdError::Network,
            LinearError::RateLimited(_) => CmdError::RateLimited,
            LinearError::Auth | LinearError::Api(_) | LinearError::Malformed => CmdError::LinearApi,
            LinearError::Asset => CmdError::ImageUnavailable,
        }
    }
}

impl From<GitHubError> for CmdError {
    fn from(e: GitHubError) -> Self {
        match e {
            GitHubError::Network | GitHubError::Server => CmdError::Network,
            GitHubError::RateLimited(_) => CmdError::RateLimited,
            GitHubError::Auth | GitHubError::Api(_) | GitHubError::Malformed => CmdError::GitHubApi,
        }
    }
}

/// Shared result slot for the per-URL single-flight gate.
type PreviewGate = std::sync::Arc<
    tokio::sync::Mutex<
        Option<Result<crate::link_preview::LinkPreview, crate::link_preview::PreviewError>>,
    >,
>;

pub struct AppState {
    pub pool: SqlitePool,
    pub secret_store: Arc<dyn SecretStore>,
    pub credentials: Arc<dyn LinearCredentialProvider>,
    pub linear: LinearClient,
    /// Serializes credential mutations and bulk sync (set/clear/test/sync).
    pub workspace_lock: tokio::sync::Mutex<()>,
    /// Bumped by every cache wipe; guards `update_issue`'s late write.
    pub workspace_generation: AtomicU64,
    /// Epoch-seconds deadline before which sync is suppressed after a 429 (0 = none).
    pub rate_limited_until: AtomicU64,
    /// In-memory bounded TTL cache for link previews (never persisted).
    pub link_preview_cache: tokio::sync::Mutex<crate::link_preview::cache::PreviewCache>,
    /// Per-URL single-flight gates. The gate's guarded value is the shared
    /// result of the in-flight fetch, so concurrent waiters reuse the first
    /// outcome (success OR error) instead of each re-fetching. A fresh request
    /// after the batch drains creates a new gate and retries (failures are not
    /// persistently cached). The std Mutex guarding the map is never held across
    /// an await.
    pub link_preview_inflight: std::sync::Mutex<std::collections::HashMap<String, PreviewGate>>,
    pub github_credentials: Arc<dyn GitHubCredentialProvider>,
    pub github: GitHubClient,
    /// Serializes GitHub credential mutations and sync (set/clear/test/sync).
    pub github_lock: tokio::sync::Mutex<()>,
    /// Bumped by every GitHub cache wipe; guards a late sync write.
    pub github_generation: AtomicU64,
}

/// Map a parsed wire issue to the cached read-shape (used after issueUpdate).
fn parsed_to_issue(p: &ParsedIssue) -> Issue {
    Issue {
        id: p.id.clone(),
        identifier: p.identifier.clone(),
        title: p.title.clone(),
        description: p.description.clone(),
        due_date: p.due_date.clone(),
        priority: p.priority,
        url: p.url.clone(),
        state_id: p.state_id.clone(),
        state_name: p.state_name.clone(),
        state_type: p.state_type.clone().unwrap_or_default(),
        state_color: p.state_color.clone().unwrap_or_default(),
        assignee_id: p.assignee_id.clone(),
        assignee_name: p.assignee_name.clone(),
        team_id: p.team_id.clone(),
        team_key: p.team_key.clone(),
        project_id: p.project_id.clone(),
        project_name: p.project_name.clone(),
        parent_id: p.parent_id.clone(),
        estimate: p.estimate,
        cycle_name: p.cycle_name.clone(),
        cycle_number: p.cycle_number,
        milestone_name: p.milestone_name.clone(),
        link_count: p.link_count,
        pr_count: p.pr_count,
        attachments_truncated: p.attachments_truncated,
        created_at: p.created_at.clone(),
        updated_at: p.updated_at.clone(),
    }
}

fn parsed_to_record(p: ParsedIssue) -> (IssueRecord, Vec<LabelRecord>) {
    let (rec, labels, _relations) = crate::linear::sync::to_record(p);
    (rec, labels)
}

fn now_epoch() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// On a rate-limit error, arm the backoff deadline (default 60s) before mapping
/// to CmdError so the next sync within the window is suppressed.
fn arm_backoff(e: LinearError, rate_limited_until: &AtomicU64) -> CmdError {
    if let LinearError::RateLimited(secs) = e {
        let wait = secs.unwrap_or(60).max(0) as u64;
        rate_limited_until.store(now_epoch() + wait, Ordering::SeqCst);
    }
    CmdError::from(e)
}

pub async fn sync_issues_logic(
    creds: Arc<dyn LinearCredentialProvider>,
    linear: LinearClient,
    pool: &SqlitePool,
    generation: &AtomicU64,
    rate_limited_until: &AtomicU64,
    full: bool,
) -> Result<SyncResult, CmdError> {
    // Suppress network sync while inside a rate-limit window. A background poll
    // (full=false) reports a silent no-op; an explicit Resync (full=true) surfaces
    // the rate limit instead of a misleading "Resynced 0 issues".
    if now_epoch() < rate_limited_until.load(Ordering::SeqCst) {
        if full {
            return Err(CmdError::RateLimited);
        }
        return Ok(SyncResult {
            mode: SyncMode::Incremental,
            synced: 0,
        });
    }

    let c = creds.clone();
    let auth = tokio::task::spawn_blocking(move || c.authorization())
        .await
        .map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::SecretStore)?
        .ok_or(CmdError::NotConfigured)?;

    // Validate org identity; wipe on mismatch (or honor an explicit full Resync).
    let id = match linear.viewer_with_org(&auth).await {
        Ok(id) => id,
        Err(e) => return Err(arm_backoff(e, rate_limited_until)),
    };
    let mut force_full = full;
    let cached = db::load_org_id(pool)
        .await
        .map_err(|_| CmdError::Internal)?;
    let mismatch = cached.as_deref().map(|c| c != id.org_id).unwrap_or(false);
    if full || mismatch {
        issues::wipe_workspace_cache(pool)
            .await
            .map_err(|_| CmdError::Internal)?;
        generation.fetch_add(1, Ordering::SeqCst);
        force_full = true;
    }
    if mismatch || cached.is_none() || full {
        db::save_identity(
            pool,
            &id.viewer_id,
            &id.viewer_name,
            &id.org_id,
            &id.org_name,
            &id.org_url_key,
        )
        .await
        .map_err(|_| CmdError::Internal)?;
    }

    let client = linear.clone();
    let auth2 = auth.clone();
    run_sync(
        pool,
        move |after, since| {
            let client = client.clone();
            let auth = auth2.clone();
            async move {
                client
                    .issues_page(&auth, after.as_deref(), since.as_deref())
                    .await
            }
        },
        force_full,
    )
    .await
    .map_err(|e| arm_backoff(e, rate_limited_until))
}

pub async fn get_issue_detail_logic(
    creds: Arc<dyn LinearCredentialProvider>,
    linear: LinearClient,
    pool: &SqlitePool,
    id: String,
) -> Result<IssueDetailResult, CmdError> {
    let c = creds.clone();
    let auth = tokio::task::spawn_blocking(move || c.authorization())
        .await
        .map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::SecretStore)?;
    if let Some(auth) = auth {
        match linear.issue_detail(&auth, &id).await {
            Ok(node) => {
                return Ok(IssueDetailResult::Live {
                    detail: Box::new(node_to_live(node)),
                })
            }
            Err(_) => { /* fall through to cache */ }
        }
    }
    match issues::load_issue(pool, &id)
        .await
        .map_err(|_| CmdError::Internal)?
    {
        Some(issue) => Ok(IssueDetailResult::Cache {
            detail: Box::new(issue),
        }),
        None => Err(CmdError::Network), // offline + not cached
    }
}

fn node_to_live(n: IssueDetailNode) -> LiveDetail {
    let labels = n
        .issue
        .labels
        .iter()
        .map(|l| LabelOut {
            id: l.id.clone(),
            name: l.name.clone(),
            color: l.color.clone(),
        })
        .collect();
    LiveDetail {
        issue: parsed_to_issue(&n.issue),
        labels,
        team_states: n.team_states,
        cycle: n.cycle,
        parent: n.parent,
        creator_name: n.creator_name,
        children: n.children,
        relations: n.relations,
        attachments: n.attachments,
        history: n.history,
        comments: n.comments,
        has_more_children: n.has_more_children,
        has_more_relations: n.has_more_relations,
        has_more_history: n.has_more_history,
        has_more_comments: n.has_more_comments,
    }
}

pub async fn update_issue_logic<F, Fut>(
    pool: &SqlitePool,
    lock: &tokio::sync::Mutex<()>,
    generation: &AtomicU64,
    creds: Arc<dyn LinearCredentialProvider>,
    do_update: F,
) -> Result<Issue, CmdError>
where
    F: FnOnce(String) -> Fut,
    Fut: std::future::Future<Output = Result<ParsedIssue, LinearError>>,
{
    // (1) snapshot generation + credential under the lock
    let (gen, auth) = {
        let _g = lock.lock().await;
        let gen = generation.load(Ordering::SeqCst);
        let c = creds.clone();
        let auth = tokio::task::spawn_blocking(move || c.authorization())
            .await
            .map_err(|_| CmdError::Internal)?
            .map_err(|_| CmdError::SecretStore)?
            .ok_or(CmdError::NotConfigured)?;
        (gen, auth)
    };
    // (2) network mutation, no lock held
    let parsed = do_update(auth).await?;
    // (3) recheck + write under the lock
    let _g = lock.lock().await;
    if generation.load(Ordering::SeqCst) != gen {
        return Err(CmdError::WorkspaceChanged);
    }
    let id = parsed.id.clone();
    let (rec, labels) = parsed_to_record(parsed);
    let mut tx = pool.begin().await.map_err(|_| CmdError::Internal)?;
    let applied = issues::upsert_issue(&mut tx, &rec)
        .await
        .map_err(|_| CmdError::Internal)?;
    if applied {
        issues::replace_labels(&mut tx, &rec.id, &labels)
            .await
            .map_err(|_| CmdError::Internal)?;
    }
    tx.commit().await.map_err(|_| CmdError::Internal)?;
    issues::load_issue(pool, &id)
        .await
        .map_err(|_| CmdError::Internal)?
        .ok_or(CmdError::Internal)
}

pub async fn delete_issue_logic<F, Fut>(
    pool: &SqlitePool,
    lock: &tokio::sync::Mutex<()>,
    generation: &AtomicU64,
    creds: Arc<dyn LinearCredentialProvider>,
    id: String,
    do_delete: F,
) -> Result<(), CmdError>
where
    F: FnOnce(String, String) -> Fut,
    Fut: std::future::Future<Output = Result<(), LinearError>>,
{
    let (gen, auth) = {
        let _guard = lock.lock().await;
        let gen = generation.load(Ordering::SeqCst);
        let credentials = creds.clone();
        let auth = tokio::task::spawn_blocking(move || credentials.authorization())
            .await
            .map_err(|_| CmdError::Internal)?
            .map_err(|_| CmdError::SecretStore)?
            .ok_or(CmdError::NotConfigured)?;
        issues::stage_delete(pool, &id)
            .await
            .map_err(|_| CmdError::Internal)?;
        (gen, auth)
    };

    if let Err(error) = do_delete(auth, id.clone()).await {
        let _guard = lock.lock().await;
        if generation.load(Ordering::SeqCst) == gen {
            issues::unstage_delete(pool, &id)
                .await
                .map_err(|_| CmdError::Internal)?;
        }
        return Err(error.into());
    }

    let _guard = lock.lock().await;
    if generation.load(Ordering::SeqCst) != gen {
        return Err(CmdError::WorkspaceChanged);
    }
    issues::finalize_delete(pool, &id)
        .await
        .map_err(|_| CmdError::Internal)
}

pub async fn set_linear_key_logic(
    store: Arc<dyn SecretStore>,
    pool: &SqlitePool,
    generation: &AtomicU64,
    key: String,
) -> Result<(), CmdError> {
    // Wipe + bump FIRST so a later keyring failure can only leave an empty cache
    // (safe), never the new key paired with the old workspace's data.
    db::issues::wipe_workspace_cache(pool)
        .await
        .map_err(|_| CmdError::Internal)?;
    generation.fetch_add(1, Ordering::SeqCst);
    let s = store.clone();
    tokio::task::spawn_blocking(move || s.set(LINEAR_KEY_ACCOUNT, &key))
        .await
        .map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::SecretStore)?;
    Ok(())
}

pub async fn clear_linear_key_logic(
    store: Arc<dyn SecretStore>,
    pool: &SqlitePool,
    generation: &AtomicU64,
) -> Result<(), CmdError> {
    // Wipe + bump first; a failed delete then leaves an empty cache, which is safe.
    db::issues::wipe_workspace_cache(pool)
        .await
        .map_err(|_| CmdError::Internal)?;
    generation.fetch_add(1, Ordering::SeqCst);
    let s = store.clone();
    tokio::task::spawn_blocking(move || s.delete(LINEAR_KEY_ACCOUNT))
        .await
        .map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::SecretStore)?;
    Ok(())
}

pub async fn get_status_logic(
    store: Arc<dyn SecretStore>,
    pool: &SqlitePool,
) -> Result<ConnectionStatus, CmdError> {
    let s = store.clone();
    let has_key = tokio::task::spawn_blocking(move || s.get(LINEAR_KEY_ACCOUNT))
        .await
        .map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::SecretStore)?
        .is_some();
    let cached = db::load_viewer_name(pool)
        .await
        .map_err(|_| CmdError::Internal)?;
    Ok(compute_status(has_key, cached))
}

pub async fn test_connection_logic<F, Fut>(
    credentials: Arc<dyn LinearCredentialProvider>,
    pool: &SqlitePool,
    generation: &AtomicU64,
    fetch_identity: F,
) -> Result<ConnectionStatus, CmdError>
where
    F: FnOnce(String) -> Fut,
    Fut: std::future::Future<Output = Result<OrgIdentity, LinearError>>,
{
    let c = credentials.clone();
    let auth = tokio::task::spawn_blocking(move || c.authorization())
        .await
        .map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::SecretStore)?
        .ok_or(CmdError::NotConfigured)?;
    let id = fetch_identity(auth).await?;
    // Compare BEFORE overwriting: a swapped key pointing at a different org wipes first.
    if let Some(cached) = db::load_org_id(pool)
        .await
        .map_err(|_| CmdError::Internal)?
    {
        if cached != id.org_id {
            db::issues::wipe_workspace_cache(pool)
                .await
                .map_err(|_| CmdError::Internal)?;
            generation.fetch_add(1, Ordering::SeqCst);
        }
    }
    db::save_identity(
        pool,
        &id.viewer_id,
        &id.viewer_name,
        &id.org_id,
        &id.org_name,
        &id.org_url_key,
    )
    .await
    .map_err(|_| CmdError::Internal)?;
    Ok(ConnectionStatus::Connected {
        name: id.viewer_name,
    })
}

#[tauri::command]
pub async fn set_linear_key(state: State<'_, AppState>, key: String) -> Result<(), CmdError> {
    let _g = state.workspace_lock.lock().await;
    set_linear_key_logic(
        state.secret_store.clone(),
        &state.pool,
        &state.workspace_generation,
        key,
    )
    .await
}

#[tauri::command]
pub async fn clear_linear_key(state: State<'_, AppState>) -> Result<(), CmdError> {
    let _g = state.workspace_lock.lock().await;
    clear_linear_key_logic(
        state.secret_store.clone(),
        &state.pool,
        &state.workspace_generation,
    )
    .await
}

#[tauri::command]
pub async fn get_connection_status(
    state: State<'_, AppState>,
) -> Result<ConnectionStatus, CmdError> {
    get_status_logic(state.secret_store.clone(), &state.pool).await
}

#[tauri::command]
pub async fn test_linear_connection(
    state: State<'_, AppState>,
) -> Result<ConnectionStatus, CmdError> {
    let _g = state.workspace_lock.lock().await;
    let client = state.linear.clone();
    test_connection_logic(
        state.credentials.clone(),
        &state.pool,
        &state.workspace_generation,
        move |auth| async move { client.viewer_with_org(&auth).await },
    )
    .await
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarArgs {
    pub start: String,
    pub end: String,
    pub team_id: Option<String>,
    pub assignee_id: Option<String>,
    pub project_id: Option<String>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnscheduledArgs {
    pub team_id: Option<String>,
    pub assignee_id: Option<String>,
    pub project_id: Option<String>,
}

#[tauri::command]
pub async fn sync_issues(
    state: State<'_, AppState>,
    full: Option<bool>,
) -> Result<SyncResult, CmdError> {
    let _g = state.workspace_lock.lock().await;
    sync_issues_logic(
        state.credentials.clone(),
        state.linear.clone(),
        &state.pool,
        &state.workspace_generation,
        &state.rate_limited_until,
        full.unwrap_or(false),
    )
    .await
}

#[tauri::command]
pub async fn list_calendar_issues(
    state: State<'_, AppState>,
    args: CalendarArgs,
) -> Result<Vec<CalendarIssue>, CmdError> {
    issues::load_issues_in_range(
        &state.pool,
        &args.start,
        &args.end,
        args.team_id,
        args.assignee_id,
        args.project_id,
    )
    .await
    .map_err(|_| CmdError::Internal)
}

#[tauri::command]
pub async fn list_unscheduled(
    state: State<'_, AppState>,
    args: UnscheduledArgs,
) -> Result<Vec<CalendarIssue>, CmdError> {
    issues::load_unscheduled(&state.pool, args.team_id, args.assignee_id, args.project_id)
        .await
        .map_err(|_| CmdError::Internal)
}

#[tauri::command]
pub async fn list_issues(
    state: State<'_, AppState>,
    args: UnscheduledArgs,
) -> Result<Vec<issues::IssueListItem>, CmdError> {
    issues::load_issues(&state.pool, args.team_id, args.assignee_id, args.project_id)
        .await
        .map_err(|_| CmdError::Internal)
}

#[tauri::command]
pub async fn list_relations(
    state: State<'_, AppState>,
) -> Result<Vec<issues::RelationItem>, CmdError> {
    issues::load_relations(&state.pool)
        .await
        .map_err(|_| CmdError::Internal)
}

#[tauri::command]
pub async fn list_filter_options(state: State<'_, AppState>) -> Result<FilterOptions, CmdError> {
    issues::list_filter_options(&state.pool)
        .await
        .map_err(|_| CmdError::Internal)
}

#[tauri::command]
pub async fn get_issue_detail(
    state: State<'_, AppState>,
    id: String,
) -> Result<IssueDetailResult, CmdError> {
    get_issue_detail_logic(
        state.credentials.clone(),
        state.linear.clone(),
        &state.pool,
        id,
    )
    .await
}

#[tauri::command]
pub async fn load_linear_image(
    state: State<'_, AppState>,
    url: String,
) -> Result<String, CmdError> {
    state.linear.load_image(&url).await.map_err(CmdError::from)
}

pub async fn fetch_link_preview_logic(
    cache: &tokio::sync::Mutex<crate::link_preview::cache::PreviewCache>,
    inflight: &std::sync::Mutex<std::collections::HashMap<String, PreviewGate>>,
    url: String,
) -> Result<crate::link_preview::LinkPreview, CmdError> {
    // Fast path: a fresh cache entry needs no gate.
    if let Some(hit) = cache.lock().await.get(&url, std::time::Instant::now()) {
        return Ok(hit);
    }

    // Acquire (or create) the per-URL gate. The std Mutex is held only for the
    // map get/insert — never across an await.
    let gate: PreviewGate = {
        let mut map = inflight.lock().expect("inflight mutex poisoned");
        map.entry(url.clone())
            .or_insert_with(|| std::sync::Arc::new(tokio::sync::Mutex::new(None)))
            .clone()
    };
    let mut slot = gate.lock().await; // serialize concurrent same-URL requests

    // A prior holder of this gate may have already computed the result while we
    // waited — reuse it (success OR error) without fetching again.
    if let Some(shared) = slot.as_ref() {
        let result = shared.clone();
        drop(slot);
        cleanup_inflight(inflight, &url, &gate);
        return result.map_err(CmdError::from);
    }

    // Also re-check the positive cache (a prior, already-cleaned gate may have
    // filled a still-fresh TTL entry).
    if let Some(hit) = cache.lock().await.get(&url, std::time::Instant::now()) {
        drop(slot);
        cleanup_inflight(inflight, &url, &gate);
        return Ok(hit);
    }

    // We are the single flight for this URL: do the fetch, share the outcome.
    let result = crate::link_preview::fetch::fetch_link_preview(&url).await;
    if let Ok(ref preview) = result {
        cache
            .lock()
            .await
            .put(url.clone(), preview.clone(), std::time::Instant::now());
    }
    *slot = Some(result.clone());
    drop(slot);
    cleanup_inflight(inflight, &url, &gate);
    result.map_err(CmdError::from)
}

/// Remove the per-URL gate from the map once no other waiter still references
/// it (`strong_count <= 2` = the map's copy + our local clone). `ptr_eq` guards
/// against removing a replacement gate.
fn cleanup_inflight(
    inflight: &std::sync::Mutex<std::collections::HashMap<String, PreviewGate>>,
    url: &str,
    gate: &PreviewGate,
) {
    let mut map = inflight.lock().expect("inflight mutex poisoned");
    if let Some(existing) = map.get(url) {
        if std::sync::Arc::ptr_eq(existing, gate) && std::sync::Arc::strong_count(existing) <= 2 {
            map.remove(url);
        }
    }
}

#[tauri::command]
pub async fn fetch_link_preview(
    state: State<'_, AppState>,
    url: String,
) -> Result<crate::link_preview::LinkPreview, CmdError> {
    fetch_link_preview_logic(&state.link_preview_cache, &state.link_preview_inflight, url).await
}

#[tauri::command]
pub async fn update_issue(
    state: State<'_, AppState>,
    id: String,
    patch: UpdateIssuePatch,
) -> Result<Issue, CmdError> {
    let input = patch_to_input(&patch);
    let client = state.linear.clone();
    let id2 = id.clone();
    update_issue_logic(
        &state.pool,
        &state.workspace_lock,
        &state.workspace_generation,
        state.credentials.clone(),
        move |auth| async move { client.update_issue(&auth, &id2, &input).await },
    )
    .await
}

#[tauri::command]
pub async fn create_issue(
    state: State<'_, AppState>,
    input: CreateIssueInput,
) -> Result<Issue, CmdError> {
    validate_create_input(&input).map_err(|_| CmdError::InvalidInput)?;
    let value = create_input_to_value(&input);
    let client = state.linear.clone();
    update_issue_logic(
        &state.pool,
        &state.workspace_lock,
        &state.workspace_generation,
        state.credentials.clone(),
        move |auth| async move { client.create_issue(&auth, &value).await },
    )
    .await
}

#[tauri::command]
pub async fn list_users(state: State<'_, AppState>) -> Result<Vec<ParsedUser>, CmdError> {
    let c = state.credentials.clone();
    let auth = tokio::task::spawn_blocking(move || c.authorization())
        .await
        .map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::SecretStore)?
        .ok_or(CmdError::NotConfigured)?;
    state.linear.users(&auth).await.map_err(CmdError::from)
}

#[tauri::command]
pub async fn list_notifications(state: State<'_, AppState>) -> Result<NotificationsPage, CmdError> {
    let c = state.credentials.clone();
    let auth = tokio::task::spawn_blocking(move || c.authorization())
        .await
        .map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::SecretStore)?
        .ok_or(CmdError::NotConfigured)?;
    state
        .linear
        .notifications(&auth)
        .await
        .map_err(CmdError::from)
}

#[tauri::command]
pub async fn list_labels(state: State<'_, AppState>) -> Result<Vec<LabelOut>, CmdError> {
    let c = state.credentials.clone();
    let auth = tokio::task::spawn_blocking(move || c.authorization())
        .await
        .map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::SecretStore)?
        .ok_or(CmdError::NotConfigured)?;
    let labels = state.linear.labels(&auth).await.map_err(CmdError::from)?;
    Ok(labels
        .into_iter()
        .map(|l| LabelOut {
            id: l.id,
            name: l.name,
            color: l.color,
        })
        .collect())
}

#[tauri::command]
pub async fn list_cycles(state: State<'_, AppState>) -> Result<Vec<ParsedCycle>, CmdError> {
    let c = state.credentials.clone();
    let auth = tokio::task::spawn_blocking(move || c.authorization())
        .await
        .map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::SecretStore)?
        .ok_or(CmdError::NotConfigured)?;
    state.linear.cycles(&auth).await.map_err(CmdError::from)
}

#[tauri::command]
pub async fn list_workflow_states(
    state: State<'_, AppState>,
) -> Result<Vec<WorkflowState>, CmdError> {
    let credentials = state.credentials.clone();
    let auth = tokio::task::spawn_blocking(move || credentials.authorization())
        .await
        .map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::SecretStore)?
        .ok_or(CmdError::NotConfigured)?;
    state
        .linear
        .workflow_states(&auth)
        .await
        .map_err(CmdError::from)
}

#[tauri::command]
pub async fn delete_issue(state: State<'_, AppState>, id: String) -> Result<(), CmdError> {
    let client = state.linear.clone();
    delete_issue_logic(
        &state.pool,
        &state.workspace_lock,
        &state.workspace_generation,
        state.credentials.clone(),
        id,
        move |auth, issue_id| async move { client.delete_issue(&auth, &issue_id).await },
    )
    .await
}

#[tauri::command]
pub async fn get_me(state: State<'_, AppState>) -> Result<Option<Me>, CmdError> {
    Ok(db::load_me(&state.pool)
        .await
        .map_err(|_| CmdError::Internal)?
        .map(|(viewer_id, viewer_name)| Me {
            viewer_id,
            viewer_name,
        }))
}

async fn authed(state: &State<'_, AppState>) -> Result<String, CmdError> {
    let c = state.credentials.clone();
    tokio::task::spawn_blocking(move || c.authorization())
        .await
        .map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::SecretStore)?
        .ok_or(CmdError::NotConfigured)
}

#[tauri::command]
pub async fn create_comment(
    state: State<'_, AppState>,
    issue_id: String,
    body: String,
    parent_id: Option<String>,
) -> Result<DetailComment, CmdError> {
    let auth = authed(&state).await?;
    state
        .linear
        .create_comment(&auth, &issue_id, &body, parent_id.as_deref())
        .await
        .map_err(CmdError::from)
}

#[tauri::command]
pub async fn update_comment(
    state: State<'_, AppState>,
    id: String,
    body: String,
) -> Result<DetailComment, CmdError> {
    let auth = authed(&state).await?;
    state
        .linear
        .update_comment(&auth, &id, &body)
        .await
        .map_err(CmdError::from)
}

#[tauri::command]
pub async fn delete_comment(state: State<'_, AppState>, id: String) -> Result<(), CmdError> {
    let auth = authed(&state).await?;
    state
        .linear
        .delete_comment(&auth, &id)
        .await
        .map_err(CmdError::from)
}

#[tauri::command]
pub async fn add_reaction(
    state: State<'_, AppState>,
    comment_id: String,
    emoji: String,
) -> Result<DetailReaction, CmdError> {
    let auth = authed(&state).await?;
    state
        .linear
        .add_reaction(&auth, &comment_id, &emoji)
        .await
        .map_err(CmdError::from)
}

#[tauri::command]
pub async fn remove_reaction(state: State<'_, AppState>, id: String) -> Result<(), CmdError> {
    let auth = authed(&state).await?;
    state
        .linear
        .remove_reaction(&auth, &id)
        .await
        .map_err(CmdError::from)
}

#[tauri::command]
pub async fn create_label(
    state: State<'_, AppState>,
    name: String,
    team_id: Option<String>,
    color: String,
) -> Result<LabelOut, CmdError> {
    let auth = authed(&state).await?;
    let l = state
        .linear
        .create_label(&auth, &name, &color, team_id.as_deref())
        .await
        .map_err(CmdError::from)?;
    Ok(LabelOut {
        id: l.id,
        name: l.name,
        color: l.color,
    })
}

#[cfg(test)]
mod status_tests {
    use super::*;

    #[test]
    fn no_key_is_not_configured() {
        assert_eq!(compute_status(false, None), ConnectionStatus::NotConfigured);
        assert_eq!(
            compute_status(false, Some("x".into())),
            ConnectionStatus::NotConfigured
        );
    }

    #[test]
    fn key_without_cache_is_unverified() {
        assert_eq!(compute_status(true, None), ConnectionStatus::Unverified);
    }

    #[test]
    fn key_with_cache_is_connected() {
        assert_eq!(
            compute_status(true, Some("Abrar".into())),
            ConnectionStatus::Connected {
                name: "Abrar".into()
            }
        );
    }

    #[test]
    fn connected_serializes_with_state_and_name() {
        let json = serde_json::to_string(&ConnectionStatus::Connected {
            name: "Abrar".into(),
        })
        .unwrap();
        assert_eq!(json, r#"{"state":"connected","name":"Abrar"}"#);
    }

    #[test]
    fn not_configured_serializes_with_state_only() {
        let json = serde_json::to_string(&ConnectionStatus::NotConfigured).unwrap();
        assert_eq!(json, r#"{"state":"not_configured"}"#);
    }
}

#[cfg(test)]
mod logic_tests {
    use super::*;
    use crate::linear::PersonalKeyProvider;
    use crate::secrets::fake::FakeSecretStore;

    async fn temp_pool() -> (tempfile::TempDir, SqlitePool) {
        let dir = tempfile::tempdir().unwrap();
        let pool = db::init_pool(&dir.path().join("astryn/test.db"))
            .await
            .unwrap();
        (dir, pool)
    }

    fn gen0() -> AtomicU64 {
        AtomicU64::new(0)
    }

    fn org(id: &str) -> OrgIdentity {
        OrgIdentity {
            viewer_id: "v1".into(),
            viewer_name: "Abrar".into(),
            org_id: id.into(),
            org_name: "GAM".into(),
            org_url_key: "gam".into(),
        }
    }

    #[tokio::test]
    async fn no_key_reports_not_configured() {
        let (_dir, pool) = temp_pool().await;
        let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());
        let status = get_status_logic(store, &pool).await.unwrap();
        assert_eq!(status, ConnectionStatus::NotConfigured);
    }

    #[tokio::test]
    async fn cached_identity_reports_connected() {
        let (_dir, pool) = temp_pool().await;
        let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());
        store.set(LINEAR_KEY_ACCOUNT, "lin_xyz").unwrap();
        db::save_identity(&pool, "v1", "Abrar", "orgA", "GAM", "gam")
            .await
            .unwrap();
        let status = get_status_logic(store, &pool).await.unwrap();
        assert_eq!(
            status,
            ConnectionStatus::Connected {
                name: "Abrar".into()
            }
        );
    }

    #[tokio::test]
    async fn saving_key_wipes_and_bumps_generation() {
        let (_dir, pool) = temp_pool().await;
        let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());
        db::save_identity(&pool, "v0", "Old", "org0", "Old", "old")
            .await
            .unwrap();
        let g = gen0();
        set_linear_key_logic(store.clone(), &pool, &g, "lin_xyz".into())
            .await
            .unwrap();
        assert_eq!(g.load(Ordering::SeqCst), 1);
        assert_eq!(db::load_org_id(&pool).await.unwrap(), None); // identity wiped
        let status = get_status_logic(store, &pool).await.unwrap();
        assert_eq!(status, ConnectionStatus::Unverified);
    }

    #[tokio::test]
    async fn clearing_key_wipes_and_bumps() {
        let (_dir, pool) = temp_pool().await;
        let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());
        store.set(LINEAR_KEY_ACCOUNT, "lin_xyz").unwrap();
        let g = gen0();
        clear_linear_key_logic(store.clone(), &pool, &g)
            .await
            .unwrap();
        assert_eq!(g.load(Ordering::SeqCst), 1);
        assert_eq!(store.get(LINEAR_KEY_ACCOUNT).unwrap(), None);
    }

    #[tokio::test]
    async fn test_connection_same_org_keeps_cache_and_saves_identity() {
        let (_dir, pool) = temp_pool().await;
        let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());
        store.set(LINEAR_KEY_ACCOUNT, "lin_xyz").unwrap();
        db::save_identity(&pool, "v1", "Abrar", "orgA", "GAM", "gam")
            .await
            .unwrap();
        let creds: Arc<dyn LinearCredentialProvider> =
            Arc::new(PersonalKeyProvider::new(store.clone(), LINEAR_KEY_ACCOUNT));
        let g = AtomicU64::new(5);
        let status = test_connection_logic(creds, &pool, &g, |_a| async { Ok(org("orgA")) })
            .await
            .unwrap();
        assert_eq!(
            status,
            ConnectionStatus::Connected {
                name: "Abrar".into()
            }
        );
        assert_eq!(g.load(Ordering::SeqCst), 5); // same org -> no wipe -> no bump
    }

    #[tokio::test]
    async fn test_connection_different_org_wipes_and_bumps() {
        let (_dir, pool) = temp_pool().await;
        let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());
        store.set(LINEAR_KEY_ACCOUNT, "lin_xyz").unwrap();
        db::save_identity(&pool, "v1", "Abrar", "orgA", "GAM", "gam")
            .await
            .unwrap();
        let creds: Arc<dyn LinearCredentialProvider> =
            Arc::new(PersonalKeyProvider::new(store.clone(), LINEAR_KEY_ACCOUNT));
        let g = AtomicU64::new(0);
        test_connection_logic(creds, &pool, &g, |_a| async { Ok(org("orgB")) })
            .await
            .unwrap();
        assert_eq!(g.load(Ordering::SeqCst), 1); // mismatch -> wipe -> bump
        assert_eq!(db::load_org_id(&pool).await.unwrap(), Some("orgB".into())); // new identity saved
    }

    fn parsed(id: &str, due: Option<&str>, updated: &str) -> ParsedIssue {
        ParsedIssue {
            id: id.into(),
            identifier: format!("ENG-{id}"),
            title: "T".into(),
            description: None,
            due_date: due.map(Into::into),
            priority: 0,
            url: "u".into(),
            state_id: Some("s".into()),
            state_name: Some("Todo".into()),
            state_type: Some("unstarted".into()),
            state_color: Some("#fff".into()),
            assignee_id: Some("me".into()),
            assignee_name: Some("Me".into()),
            team_id: Some("t".into()),
            team_key: Some("ENG".into()),
            project_id: None,
            project_name: None,
            parent_id: None,
            estimate: None,
            cycle_name: None,
            cycle_number: None,
            milestone_name: None,
            link_count: 0,
            pr_count: 0,
            attachments_truncated: false,
            created_at: "c".into(),
            updated_at: updated.into(),
            archived_at: None,
            labels: vec![],
            relations: vec![],
            raw_json: "{}".into(),
        }
    }

    #[tokio::test]
    async fn update_issue_persists_when_generation_unchanged() {
        let (_dir, pool) = temp_pool().await;
        let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());
        store.set(LINEAR_KEY_ACCOUNT, "lin").unwrap();
        let creds: Arc<dyn LinearCredentialProvider> =
            Arc::new(PersonalKeyProvider::new(store.clone(), LINEAR_KEY_ACCOUNT));
        let lock = tokio::sync::Mutex::new(());
        let g = AtomicU64::new(0);
        let issue = update_issue_logic(&pool, &lock, &g, creds, |_auth| async {
            Ok(parsed("1", Some("2026-06-20"), "2026-06-19T00:00:00Z"))
        })
        .await
        .unwrap();
        assert_eq!(issue.due_date.as_deref(), Some("2026-06-20"));
        assert_eq!(
            issues::load_issue(&pool, "1")
                .await
                .unwrap()
                .unwrap()
                .due_date
                .as_deref(),
            Some("2026-06-20")
        );
    }

    #[tokio::test]
    async fn update_issue_discards_write_when_generation_changes() {
        let (_dir, pool) = temp_pool().await;
        let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());
        store.set(LINEAR_KEY_ACCOUNT, "lin").unwrap();
        let creds: Arc<dyn LinearCredentialProvider> =
            Arc::new(PersonalKeyProvider::new(store.clone(), LINEAR_KEY_ACCOUNT));
        let lock = tokio::sync::Mutex::new(());
        let g = AtomicU64::new(0);
        // Simulate a key change landing during the network mutation by bumping inside the fetcher.
        let gref = &g;
        let res = update_issue_logic(&pool, &lock, &g, creds, |_auth| async {
            gref.fetch_add(1, Ordering::SeqCst);
            Ok(parsed("1", Some("2026-06-20"), "2026-06-19T00:00:00Z"))
        })
        .await;
        assert!(matches!(res, Err(CmdError::WorkspaceChanged)));
        assert!(issues::load_issue(&pool, "1").await.unwrap().is_none()); // no write
    }

    #[tokio::test]
    async fn delete_issue_discards_local_delete_when_generation_changes() {
        let (_dir, pool) = temp_pool().await;
        let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());
        store.set(LINEAR_KEY_ACCOUNT, "lin").unwrap();
        let creds: Arc<dyn LinearCredentialProvider> =
            Arc::new(PersonalKeyProvider::new(store, LINEAR_KEY_ACCOUNT));
        let (record, _) = parsed_to_record(parsed("1", None, "2026-06-19T00:00:00Z"));
        let mut tx = pool.begin().await.unwrap();
        issues::upsert_issue(&mut tx, &record).await.unwrap();
        tx.commit().await.unwrap();
        let lock = tokio::sync::Mutex::new(());
        let generation = AtomicU64::new(0);
        let generation_ref = &generation;
        let result = delete_issue_logic(
            &pool,
            &lock,
            &generation,
            creds,
            "1".into(),
            |_auth, _id| async {
                generation_ref.fetch_add(1, Ordering::SeqCst);
                Ok(())
            },
        )
        .await;
        assert!(matches!(result, Err(CmdError::WorkspaceChanged)));
        assert!(issues::load_issue(&pool, "1").await.unwrap().is_some());
    }
}
