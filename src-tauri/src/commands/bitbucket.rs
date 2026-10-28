//! Bitbucket Cloud code-host commands. Payload shapes are the provider-neutral
//! ones the GitHub PR workspace already uses, so the same UI renders both.

use std::collections::HashSet;
use std::future::Future;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use serde::Serialize;
use serde_json::Value;
use sqlx::SqlitePool;
use tauri::State;

use super::github::{BucketSyncResult, PrDashboard};
use super::{AppState, CmdError};
use crate::bitbucket::pr_detail::{detail_paths, parse_pr_detail, DetailPages};
use crate::bitbucket::pr_diff::{diff_path, parse_unified_diff};
use crate::bitbucket::prs::{
    authored_prs_path, parse_pr_page, parse_viewer, parse_workspaces_page, repo_prs_path, Viewer,
    PER_SCOPE_CAP, WORKSPACES_PATH, WORKSPACE_MAX_PAGES,
};
use crate::bitbucket::repositories::{catalog_path, parse_catalog_page, CATALOG_MAX_PAGES};
use crate::bitbucket::{next_link, BitbucketCredentialProvider, BitbucketError, DIFF_MAX_BYTES};
use crate::code_host::{parse_repo_name, ParsedPr, PrDetail, PrDiff, RepositoryCatalog};
use crate::db::bitbucket as bdb;
use crate::db::code_host::{self as ch, BITBUCKET};
use crate::secrets::SecretStore;

pub const BITBUCKET_EMAIL_ACCOUNT: &str = "bitbucket_email";
pub const BITBUCKET_TOKEN_ACCOUNT: &str = "bitbucket_token";

impl From<BitbucketError> for CmdError {
    fn from(e: BitbucketError) -> Self {
        match e {
            BitbucketError::Network | BitbucketError::Server => CmdError::Network,
            BitbucketError::RateLimited => CmdError::RateLimited,
            BitbucketError::Auth | BitbucketError::Api | BitbucketError::Malformed => {
                CmdError::BitbucketApi
            }
        }
    }
}

/// Sanitized, user-facing reason a scope failed.
fn scope_failure_reason(err: &BitbucketError) -> &'static str {
    match err {
        BitbucketError::Network => "couldn't reach Bitbucket",
        BitbucketError::Auth => "token rejected — check its scopes",
        BitbucketError::RateLimited => "rate limited",
        BitbucketError::Malformed => "unexpected response from Bitbucket",
        BitbucketError::Server => "Bitbucket server error",
        BitbucketError::Api => "Bitbucket rejected the request",
    }
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum BitbucketStatus {
    NotConfigured,
    Unverified,
    Connected { login: String },
}

async fn authorization(
    credentials: Arc<dyn BitbucketCredentialProvider>,
) -> Result<String, CmdError> {
    tokio::task::spawn_blocking(move || credentials.authorization())
        .await
        .map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::SecretStore)?
        .ok_or(CmdError::BitbucketNotConfigured)
}

fn changed(generation: &AtomicU64, gen0: u64) -> Result<(), CmdError> {
    if generation.load(Ordering::SeqCst) == gen0 {
        Ok(())
    } else {
        Err(CmdError::WorkspaceChanged)
    }
}

/// Follow a paginated PR listing to completion (or `cap`), deduping by id.
/// Each row carries whether it awaits the viewer's review.
async fn fetch_prs<F, Fut>(
    auth: &str,
    first: String,
    viewer_uuid: &str,
    cap: usize,
    fetch: &F,
) -> Result<(Vec<(ParsedPr, bool)>, bool), BitbucketError>
where
    F: Fn(String, String) -> Fut,
    Fut: Future<Output = Result<Value, BitbucketError>>,
{
    let mut acc = Vec::new();
    let mut seen = HashSet::new();
    let mut target = first;
    let mut visited = HashSet::new();
    loop {
        if !visited.insert(target.clone()) {
            // A repeated `next` would loop forever.
            return Err(BitbucketError::Malformed);
        }
        let page = fetch(auth.to_string(), target.clone()).await?;
        for (pr, awaits) in parse_pr_page(&page, viewer_uuid)? {
            if seen.insert(pr.id.clone()) {
                acc.push((pr, awaits));
            }
        }
        let next = next_link(&page)?;
        if acc.len() >= cap {
            let truncated = acc.len() > cap || next.is_some();
            acc.truncate(cap);
            return Ok((acc, truncated));
        }
        match next {
            Some(n) => target = n,
            None => return Ok((acc, false)),
        }
    }
}

/// The viewer's authored open PRs across every workspace they belong to.
async fn fetch_mine<F, Fut>(
    auth: &str,
    viewer: &Viewer,
    fetch: &F,
) -> Result<(Vec<ParsedPr>, bool), BitbucketError>
where
    F: Fn(String, String) -> Fut,
    Fut: Future<Output = Result<Value, BitbucketError>>,
{
    let workspaces = fetch_workspaces(auth, fetch).await?;
    let mut all = Vec::new();
    let mut truncated = false;
    for ws in workspaces {
        let (rows, cut) = fetch_prs(
            auth,
            authored_prs_path(&ws, viewer)?,
            &viewer.uuid,
            PER_SCOPE_CAP,
            fetch,
        )
        .await?;
        truncated |= cut;
        all.extend(rows.into_iter().map(|(pr, _)| pr));
    }
    all.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    if all.len() > PER_SCOPE_CAP {
        all.truncate(PER_SCOPE_CAP);
        truncated = true;
    }
    Ok((all, truncated))
}

async fn fetch_workspaces<F, Fut>(auth: &str, fetch: &F) -> Result<Vec<String>, BitbucketError>
where
    F: Fn(String, String) -> Fut,
    Fut: Future<Output = Result<Value, BitbucketError>>,
{
    let mut slugs = Vec::new();
    let mut target = Some(WORKSPACES_PATH.to_string());
    for _ in 0..WORKSPACE_MAX_PAGES {
        let Some(t) = target else { break };
        let page = fetch(auth.to_string(), t).await?;
        for slug in parse_workspaces_page(&page)? {
            if !slugs.contains(&slug) {
                slugs.push(slug);
            }
        }
        target = next_link(&page)?;
    }
    Ok(slugs)
}

pub async fn sync_bitbucket_prs_logic<F, Fut>(
    credentials: Arc<dyn BitbucketCredentialProvider>,
    pool: &SqlitePool,
    generation: &AtomicU64,
    now: String,
    fetch: F,
) -> Result<Vec<BucketSyncResult>, CmdError>
where
    F: Fn(String, String) -> Fut,
    Fut: Future<Output = Result<Value, BitbucketError>>,
{
    let auth = authorization(credentials).await?;
    let gen0 = generation.load(Ordering::SeqCst);
    let viewer = parse_viewer(&fetch(auth.clone(), "/user".into()).await?)?;
    changed(generation, gen0)?;
    bdb::save_login(pool, &viewer.login)
        .await
        .map_err(|_| CmdError::Internal)?;

    let mut results = Vec::new();
    let mut record = |bucket: &str, outcome: Result<bool, &BitbucketError>| {
        results.push(BucketSyncResult {
            bucket: bucket.to_string(),
            ok: outcome.is_ok(),
            truncated: *outcome.as_ref().unwrap_or(&false),
            reason: outcome.err().map(|e| scope_failure_reason(e).to_string()),
        })
    };

    match fetch_mine(&auth, &viewer, &fetch).await {
        Ok((prs, truncated)) => {
            changed(generation, gen0)?;
            ch::replace_scope(pool, BITBUCKET, "mine", &prs, &now, truncated)
                .await
                .map_err(|_| CmdError::Internal)?;
            record("mine", Ok(truncated));
        }
        Err(e) => record("mine", Err(&e)),
    }

    let favorites = ch::load_favorites(pool, BITBUCKET)
        .await
        .map_err(|_| CmdError::Internal)?;
    let mut awaiting: Vec<ParsedPr> = Vec::new();
    let mut awaiting_truncated = false;
    let mut every_favorite_ok = true;
    for favorite in &favorites {
        let Some(repo) = parse_repo_name(favorite) else {
            continue;
        };
        match fetch_prs(
            &auth,
            repo_prs_path(&repo),
            &viewer.uuid,
            PER_SCOPE_CAP,
            &fetch,
        )
        .await
        {
            Ok((rows, truncated)) => {
                changed(generation, gen0)?;
                awaiting_truncated |= truncated;
                let prs: Vec<ParsedPr> = rows
                    .into_iter()
                    .map(|(pr, awaits)| {
                        if awaits {
                            awaiting.push(pr.clone());
                        }
                        pr
                    })
                    .collect();
                ch::replace_scope(pool, BITBUCKET, &repo.scope, &prs, &now, truncated)
                    .await
                    .map_err(|_| CmdError::Internal)?;
                record(&repo.scope, Ok(truncated));
            }
            Err(e) => {
                every_favorite_ok = false;
                record(&repo.scope, Err(&e));
            }
        }
    }

    // Derived from the favorite scopes; withheld when any of them failed so a
    // failed repository never drops its review requests from the cache.
    if every_favorite_ok {
        awaiting.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        if awaiting.len() > PER_SCOPE_CAP {
            awaiting.truncate(PER_SCOPE_CAP);
            awaiting_truncated = true;
        }
        changed(generation, gen0)?;
        ch::replace_scope(
            pool,
            BITBUCKET,
            "needs_review",
            &awaiting,
            &now,
            awaiting_truncated,
        )
        .await
        .map_err(|_| CmdError::Internal)?;
        record("needs_review", Ok(awaiting_truncated));
    } else {
        results.push(BucketSyncResult {
            bucket: "needs_review".into(),
            ok: false,
            truncated: false,
            reason: Some("a favorite repository couldn't refresh".into()),
        });
    }
    Ok(results)
}

pub async fn list_bitbucket_prs_logic(
    pool: &SqlitePool,
    include_tracker: bool,
) -> Result<PrDashboard, CmdError> {
    let db = |_| CmdError::Internal;
    Ok(PrDashboard {
        prs: ch::list_rows(pool, BITBUCKET, include_tracker)
            .await
            .map_err(db)?,
        meta: ch::load_meta(pool, BITBUCKET).await.map_err(db)?,
        favorite_repos: ch::load_favorites(pool, BITBUCKET).await.map_err(db)?,
    })
}

pub async fn set_bitbucket_repo_favorite_logic(
    pool: &SqlitePool,
    repo: String,
    favorite: bool,
) -> Result<Vec<String>, CmdError> {
    let repo = parse_repo_name(&repo).ok_or(CmdError::InvalidInput)?;
    ch::set_favorite(pool, BITBUCKET, &repo, favorite)
        .await
        .map_err(|_| CmdError::Internal)
}

pub async fn list_bitbucket_repositories_logic<F, Fut>(
    credentials: Arc<dyn BitbucketCredentialProvider>,
    generation: &AtomicU64,
    fetch: F,
) -> Result<RepositoryCatalog, CmdError>
where
    F: Fn(String, String) -> Fut,
    Fut: Future<Output = Result<Value, BitbucketError>>,
{
    let gen0 = generation.load(Ordering::SeqCst);
    let auth = authorization(credentials).await?;
    let workspaces = fetch_workspaces(&auth, &fetch).await?;
    changed(generation, gen0)?;
    let mut repositories = Vec::new();
    let mut seen = HashSet::new();
    let mut budget = CATALOG_MAX_PAGES;
    let mut truncated = false;
    'workspaces: for ws in workspaces {
        let mut target = Some(catalog_path(&ws)?);
        while let Some(t) = target {
            if budget == 0 {
                truncated = true;
                break 'workspaces;
            }
            budget -= 1;
            let page = fetch(auth.clone(), t).await?;
            changed(generation, gen0)?;
            for name in parse_catalog_page(&page)? {
                if seen.insert(name.to_ascii_lowercase()) {
                    repositories.push(name);
                }
            }
            target = next_link(&page)?;
        }
    }
    repositories.sort_by(|a, b| {
        a.to_ascii_lowercase()
            .cmp(&b.to_ascii_lowercase())
            .then_with(|| a.cmp(b))
    });
    Ok(RepositoryCatalog {
        repositories,
        truncated,
    })
}

pub async fn get_bitbucket_pr_detail_logic<F, Fut>(
    credentials: Arc<dyn BitbucketCredentialProvider>,
    generation: &AtomicU64,
    repo: String,
    number: i64,
    fetch: F,
) -> Result<PrDetail, CmdError>
where
    F: Fn(String, String) -> Fut,
    Fut: Future<Output = Result<Value, BitbucketError>>,
{
    let repo = parse_repo_name(&repo).ok_or(CmdError::InvalidInput)?;
    let paths = detail_paths(&repo, number).map_err(|_| CmdError::InvalidInput)?;
    let gen0 = generation.load(Ordering::SeqCst);
    let auth = authorization(credentials).await?;
    let pages = DetailPages {
        pr: fetch(auth.clone(), paths.pr).await?,
        comments: fetch(auth.clone(), paths.comments).await?,
        commits: fetch(auth.clone(), paths.commits).await?,
        diffstat: fetch(auth.clone(), paths.diffstat).await?,
        statuses: fetch(auth, paths.statuses).await?,
    };
    changed(generation, gen0)?;
    Ok(parse_pr_detail(&pages)?)
}

pub async fn get_bitbucket_pr_diff_logic<F, Fut>(
    credentials: Arc<dyn BitbucketCredentialProvider>,
    generation: &AtomicU64,
    repo: String,
    number: i64,
    fetch_text: F,
) -> Result<PrDiff, CmdError>
where
    F: FnOnce(String, String) -> Fut,
    Fut: Future<Output = Result<(String, bool), BitbucketError>>,
{
    let repo = parse_repo_name(&repo).ok_or(CmdError::InvalidInput)?;
    let path = diff_path(&repo, number).ok_or(CmdError::InvalidInput)?;
    let gen0 = generation.load(Ordering::SeqCst);
    let auth = authorization(credentials).await?;
    let (text, cut) = fetch_text(auth, path).await?;
    changed(generation, gen0)?;
    Ok(parse_unified_diff(&text, &repo, number, cut))
}

pub fn compute_bitbucket_status(has_credentials: bool, login: Option<String>) -> BitbucketStatus {
    match (has_credentials, login) {
        (false, _) => BitbucketStatus::NotConfigured,
        (true, Some(login)) => BitbucketStatus::Connected { login },
        (true, None) => BitbucketStatus::Unverified,
    }
}

/// The Basic-auth user part cannot contain `:` or control characters.
fn valid_credentials(email: &str, token: &str) -> bool {
    !email.is_empty()
        && !token.is_empty()
        && !email.contains(':')
        && !email.chars().chain(token.chars()).any(char::is_control)
}

pub async fn set_bitbucket_credentials_logic(
    store: Arc<dyn SecretStore>,
    pool: &SqlitePool,
    generation: &AtomicU64,
    email: String,
    token: String,
) -> Result<(), CmdError> {
    let (email, token) = (email.trim().to_string(), token.trim().to_string());
    if !valid_credentials(&email, &token) {
        return Err(CmdError::InvalidInput);
    }
    // Wipe + bump FIRST so a later keyring failure leaves an empty cache, never
    // the new credential paired with the previous account's data.
    bdb::wipe_bitbucket_cache(pool)
        .await
        .map_err(|_| CmdError::Internal)?;
    generation.fetch_add(1, Ordering::SeqCst);
    tokio::task::spawn_blocking(move || {
        store.set(BITBUCKET_EMAIL_ACCOUNT, &email)?;
        store.set(BITBUCKET_TOKEN_ACCOUNT, &token)
    })
    .await
    .map_err(|_| CmdError::Internal)?
    .map_err(|_| CmdError::SecretStore)
}

pub async fn clear_bitbucket_credentials_logic(
    store: Arc<dyn SecretStore>,
    pool: &SqlitePool,
    generation: &AtomicU64,
) -> Result<(), CmdError> {
    bdb::wipe_bitbucket_cache(pool)
        .await
        .map_err(|_| CmdError::Internal)?;
    generation.fetch_add(1, Ordering::SeqCst);
    tokio::task::spawn_blocking(move || {
        store.delete(BITBUCKET_TOKEN_ACCOUNT)?;
        store.delete(BITBUCKET_EMAIL_ACCOUNT)
    })
    .await
    .map_err(|_| CmdError::Internal)?
    .map_err(|_| CmdError::SecretStore)
}

pub async fn get_bitbucket_status_logic(
    store: Arc<dyn SecretStore>,
    pool: &SqlitePool,
) -> Result<BitbucketStatus, CmdError> {
    let has = tokio::task::spawn_blocking(move || {
        Ok::<_, crate::secrets::SecretError>(
            store.get(BITBUCKET_TOKEN_ACCOUNT)?.is_some()
                && store.get(BITBUCKET_EMAIL_ACCOUNT)?.is_some(),
        )
    })
    .await
    .map_err(|_| CmdError::Internal)?
    .map_err(|_| CmdError::SecretStore)?;
    let login = bdb::load_login(pool)
        .await
        .map_err(|_| CmdError::Internal)?;
    Ok(compute_bitbucket_status(has, login))
}

pub async fn test_bitbucket_connection_logic<F, Fut>(
    credentials: Arc<dyn BitbucketCredentialProvider>,
    pool: &SqlitePool,
    fetch: F,
) -> Result<BitbucketStatus, CmdError>
where
    F: FnOnce(String, String) -> Fut,
    Fut: Future<Output = Result<Value, BitbucketError>>,
{
    let auth = authorization(credentials).await?;
    let viewer = parse_viewer(&fetch(auth, "/user".into()).await?)?;
    bdb::save_login(pool, &viewer.login)
        .await
        .map_err(|_| CmdError::Internal)?;
    Ok(BitbucketStatus::Connected {
        login: viewer.login,
    })
}

fn now_iso() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default()
}

#[tauri::command]
pub async fn set_bitbucket_credentials(
    state: State<'_, AppState>,
    email: String,
    token: String,
) -> Result<(), CmdError> {
    state.require(crate::modules::ModuleId::Bitbucket)?;
    let bb = &state.bitbucket;
    let _g = bb.lock.lock().await;
    set_bitbucket_credentials_logic(
        state.secret_store.clone(),
        &state.pool,
        &bb.generation,
        email,
        token,
    )
    .await
}

#[tauri::command]
pub async fn clear_bitbucket_credentials(state: State<'_, AppState>) -> Result<(), CmdError> {
    state.require(crate::modules::ModuleId::Bitbucket)?;
    let bb = &state.bitbucket;
    let _g = bb.lock.lock().await;
    clear_bitbucket_credentials_logic(state.secret_store.clone(), &state.pool, &bb.generation).await
}

#[tauri::command]
pub async fn get_bitbucket_status(state: State<'_, AppState>) -> Result<BitbucketStatus, CmdError> {
    get_bitbucket_status_logic(state.secret_store.clone(), &state.pool).await
}

#[tauri::command]
pub async fn test_bitbucket_connection(
    state: State<'_, AppState>,
) -> Result<BitbucketStatus, CmdError> {
    state.require(crate::modules::ModuleId::Bitbucket)?;
    let bb = &state.bitbucket;
    let _g = bb.lock.lock().await;
    let client = bb.client.clone();
    test_bitbucket_connection_logic(
        bb.credentials.clone(),
        &state.pool,
        |auth, path| async move { client.get_json(&auth, &path).await },
    )
    .await
}

#[tauri::command]
pub async fn sync_bitbucket_prs(
    state: State<'_, AppState>,
) -> Result<Vec<BucketSyncResult>, CmdError> {
    state.require(crate::modules::ModuleId::Bitbucket)?;
    let bb = &state.bitbucket;
    let _g = bb.lock.lock().await;
    let client = bb.client.clone();
    sync_bitbucket_prs_logic(
        bb.credentials.clone(),
        &state.pool,
        &bb.generation,
        now_iso(),
        move |auth, target| {
            let client = client.clone();
            async move { client.get_json(&auth, &target).await }
        },
    )
    .await
}

#[tauri::command]
pub async fn list_bitbucket_prs(state: State<'_, AppState>) -> Result<PrDashboard, CmdError> {
    state.require(crate::modules::ModuleId::Bitbucket)?;
    let include_tracker = state.capability(crate::modules::Capability::Tracker);
    list_bitbucket_prs_logic(&state.pool, include_tracker).await
}

#[tauri::command]
pub async fn set_bitbucket_repo_favorite(
    state: State<'_, AppState>,
    repo: String,
    favorite: bool,
) -> Result<Vec<String>, CmdError> {
    state.require(crate::modules::ModuleId::Bitbucket)?;
    let _g = state.bitbucket.lock.lock().await;
    set_bitbucket_repo_favorite_logic(&state.pool, repo, favorite).await
}

#[tauri::command]
pub async fn list_bitbucket_repositories(
    state: State<'_, AppState>,
) -> Result<RepositoryCatalog, CmdError> {
    state.require(crate::modules::ModuleId::Bitbucket)?;
    let bb = &state.bitbucket;
    let client = bb.client.clone();
    list_bitbucket_repositories_logic(bb.credentials.clone(), &bb.generation, move |auth, t| {
        let client = client.clone();
        async move { client.get_json(&auth, &t).await }
    })
    .await
}

#[tauri::command]
pub async fn get_bitbucket_pr_detail(
    state: State<'_, AppState>,
    repo: String,
    number: i64,
) -> Result<PrDetail, CmdError> {
    state.require(crate::modules::ModuleId::Bitbucket)?;
    let bb = &state.bitbucket;
    let client = bb.client.clone();
    get_bitbucket_pr_detail_logic(
        bb.credentials.clone(),
        &bb.generation,
        repo,
        number,
        move |auth, t| {
            let client = client.clone();
            async move { client.get_json(&auth, &t).await }
        },
    )
    .await
}

#[tauri::command]
pub async fn get_bitbucket_pr_diff(
    state: State<'_, AppState>,
    repo: String,
    number: i64,
) -> Result<PrDiff, CmdError> {
    state.require(crate::modules::ModuleId::Bitbucket)?;
    let bb = &state.bitbucket;
    let client = bb.client.clone();
    get_bitbucket_pr_diff_logic(
        bb.credentials.clone(),
        &bb.generation,
        repo,
        number,
        move |auth, path| async move { client.get_text(&auth, &path, DIFF_MAX_BYTES).await },
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bitbucket::fake::FakeBitbucketCreds;
    use crate::bitbucket::prs::tests::{account, pr_json, ME};
    use crate::secrets::fake::FakeSecretStore;
    use serde_json::json;
    use std::sync::Mutex;

    async fn pool() -> (tempfile::TempDir, SqlitePool) {
        let dir = tempfile::tempdir().unwrap();
        let pool = crate::db::init_pool(&dir.path().join("astryn/t.db"))
            .await
            .unwrap();
        (dir, pool)
    }

    fn creds() -> Arc<dyn BitbucketCredentialProvider> {
        Arc::new(FakeBitbucketCreds(Some("Basic x".into())))
    }

    fn reviewer_me() -> Value {
        json!([{ "user": account(ME, "me"), "role": "REVIEWER", "approved": false, "state": null }])
    }

    /// A fake Bitbucket: `/user`, one workspace, one authored PR, and two
    /// favorite repositories (`acme/api` has a PR awaiting my review).
    fn fake_api(target: &str) -> Result<Value, BitbucketError> {
        if target == "/user" {
            return Ok(account(ME, "me"));
        }
        if target.starts_with("/user/workspaces") {
            return Ok(json!({ "values": [{ "workspace": { "slug": "acme" } }] }));
        }
        if target.starts_with("/workspaces/acme/pullrequests/557058:me?") {
            return Ok(json!({ "values": [pr_json(1, "acme/web", json!([]))] }));
        }
        if target.starts_with("/repositories/acme/api/pullrequests?") {
            return Ok(json!({ "values": [
                pr_json(5, "acme/api", reviewer_me()),
                pr_json(6, "acme/api", json!([]))
            ] }));
        }
        if target.starts_with("/repositories/acme/broken/pullrequests?") {
            return Err(BitbucketError::Network);
        }
        Err(BitbucketError::Api)
    }

    async fn favorite(pool: &SqlitePool, repo: &str) {
        set_bitbucket_repo_favorite_logic(pool, repo.into(), true)
            .await
            .unwrap();
    }

    fn count(dash: &PrDashboard, bucket: &str) -> usize {
        dash.prs.iter().filter(|p| p.bucket == bucket).count()
    }

    #[tokio::test]
    async fn sync_fills_mine_favorites_and_needs_review() {
        let (_d, pool) = pool().await;
        favorite(&pool, "acme/api").await;
        let gen = AtomicU64::new(0);
        let results = sync_bitbucket_prs_logic(creds(), &pool, &gen, "now".into(), |a, t| {
            assert_eq!(a, "Basic x");
            async move { fake_api(&t) }
        })
        .await
        .unwrap();
        assert!(results.iter().all(|r| r.ok), "{results:?}");
        let dash = list_bitbucket_prs_logic(&pool, true).await.unwrap();
        assert_eq!(count(&dash, "mine"), 1);
        assert_eq!(count(&dash, "repo:acme/api"), 2);
        assert_eq!(count(&dash, "needs_review"), 1);
        assert_eq!(dash.favorite_repos, vec!["acme/api"]);
        assert_eq!(bdb::load_login(&pool).await.unwrap().as_deref(), Some("me"));
        // GitHub's cache is untouched.
        assert!(crate::db::github::list_prs(&pool, true)
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn failed_favorite_keeps_its_cache_and_withholds_needs_review() {
        let (_d, pool) = pool().await;
        favorite(&pool, "acme/api").await;
        favorite(&pool, "acme/broken").await;
        let gen = AtomicU64::new(0);
        sync_bitbucket_prs_logic(creds(), &pool, &gen, "old".into(), |_a, t| async move {
            if t.contains("broken") {
                Ok(json!({ "values": [pr_json(9, "acme/broken", reviewer_me())] }))
            } else {
                fake_api(&t)
            }
        })
        .await
        .unwrap();

        let results =
            sync_bitbucket_prs_logic(creds(), &pool, &gen, "now".into(), |_a, t| async move {
                fake_api(&t)
            })
            .await
            .unwrap();
        let broken = results
            .iter()
            .find(|r| r.bucket == "repo:acme/broken")
            .unwrap();
        assert!(!broken.ok);
        assert_eq!(broken.reason.as_deref(), Some("couldn't reach Bitbucket"));
        assert!(
            !results
                .iter()
                .find(|r| r.bucket == "needs_review")
                .unwrap()
                .ok
        );

        let dash = list_bitbucket_prs_logic(&pool, true).await.unwrap();
        assert_eq!(count(&dash, "repo:acme/broken"), 1);
        // The earlier needs_review (two awaiting PRs) survives intact.
        assert_eq!(count(&dash, "needs_review"), 2);
    }

    #[tokio::test]
    async fn sync_aborts_without_writing_when_generation_changes() {
        let (_d, pool) = pool().await;
        let gen = AtomicU64::new(0);
        let result = sync_bitbucket_prs_logic(creds(), &pool, &gen, "now".into(), |_a, t| {
            gen.fetch_add(1, Ordering::SeqCst);
            async move { fake_api(&t) }
        })
        .await;
        assert!(matches!(result, Err(CmdError::WorkspaceChanged)));
        assert!(list_bitbucket_prs_logic(&pool, true)
            .await
            .unwrap()
            .prs
            .is_empty());
    }

    #[tokio::test]
    async fn sync_without_credentials_is_not_configured_and_auth_fails_cleanly() {
        let (_d, pool) = pool().await;
        let gen = AtomicU64::new(0);
        let none: Arc<dyn BitbucketCredentialProvider> = Arc::new(FakeBitbucketCreds(None));
        let r = sync_bitbucket_prs_logic(none, &pool, &gen, "now".into(), |_a, t| async move {
            fake_api(&t)
        })
        .await;
        assert!(matches!(r, Err(CmdError::BitbucketNotConfigured)));
        let r = sync_bitbucket_prs_logic(creds(), &pool, &gen, "now".into(), |_a, _t| async {
            Err::<Value, _>(BitbucketError::Auth)
        })
        .await;
        assert!(matches!(r, Err(CmdError::BitbucketApi)));
    }

    #[tokio::test]
    async fn pagination_follows_next_caps_and_rejects_loops() {
        let calls = Arc::new(Mutex::new(0usize));
        let seen = calls.clone();
        let (rows, truncated) = fetch_prs(
            "auth",
            "/repositories/a/b/pullrequests?x".into(),
            ME,
            PER_SCOPE_CAP,
            &move |_a, _t| {
                let n = {
                    let mut g = seen.lock().unwrap();
                    *g += 1;
                    *g
                };
                async move {
                    let values: Vec<Value> = (0..50)
                        .map(|i| pr_json((n * 100 + i) as i64, "a/b", json!([])))
                        .collect();
                    Ok(json!({
                        "values": values,
                        "next": format!("https://api.bitbucket.org/2.0/repositories/a/b/pullrequests?page={}", n + 1)
                    }))
                }
            },
        )
        .await
        .unwrap();
        assert_eq!(rows.len(), PER_SCOPE_CAP);
        assert!(truncated);
        assert_eq!(*calls.lock().unwrap(), 6);

        let looped = fetch_prs(
            "auth",
            "https://api.bitbucket.org/2.0/x".into(),
            ME,
            PER_SCOPE_CAP,
            &|_a, _t| async {
                Ok(json!({ "values": [], "next": "https://api.bitbucket.org/2.0/x" }))
            },
        )
        .await;
        assert!(matches!(looped, Err(BitbucketError::Malformed)));

        let foreign = fetch_prs("auth", "/x".into(), ME, PER_SCOPE_CAP, &|_a, _t| async {
            Ok(json!({ "values": [], "next": "https://evil.example/steal" }))
        })
        .await;
        assert!(matches!(foreign, Err(BitbucketError::Malformed)));
    }

    #[tokio::test]
    async fn favorites_validate_input() {
        let (_d, pool) = pool().await;
        assert!(matches!(
            set_bitbucket_repo_favorite_logic(&pool, "nope".into(), true).await,
            Err(CmdError::InvalidInput)
        ));
        assert_eq!(
            set_bitbucket_repo_favorite_logic(&pool, "Acme/Api".into(), true)
                .await
                .unwrap(),
            vec!["Acme/Api"]
        );
    }

    #[tokio::test]
    async fn repository_catalog_spans_workspaces_and_dedupes() {
        let gen = AtomicU64::new(0);
        let catalog = list_bitbucket_repositories_logic(creds(), &gen, |_a, t| async move {
            if t.starts_with("/user/workspaces") {
                Ok(json!({ "values": [
                    { "workspace": { "slug": "acme" } },
                    { "workspace": { "slug": "me" } }
                ] }))
            } else if t.starts_with("/repositories/acme?") {
                Ok(json!({
                    "values": [{ "full_name": "acme/web" }],
                    "next": "https://api.bitbucket.org/2.0/repositories/acme?page=2"
                }))
            } else if t.contains("acme?page=2") {
                Ok(json!({ "values": [{ "full_name": "acme/api" }, { "full_name": "ACME/web" }] }))
            } else {
                Ok(json!({ "values": [{ "full_name": "me/dotfiles" }] }))
            }
        })
        .await
        .unwrap();
        assert_eq!(
            catalog.repositories,
            vec!["acme/api", "acme/web", "me/dotfiles"]
        );
        assert!(!catalog.truncated);
    }

    #[tokio::test]
    async fn detail_fetches_five_bounded_pages() {
        let gen = AtomicU64::new(0);
        let calls = Arc::new(Mutex::new(Vec::new()));
        let seen = calls.clone();
        let detail =
            get_bitbucket_pr_detail_logic(creds(), &gen, "acme/api".into(), 5, move |_a, t| {
                seen.lock().unwrap().push(t.clone());
                async move {
                    Ok(if t == "/repositories/acme/api/pullrequests/5" {
                        pr_json(5, "acme/api", json!([]))
                    } else {
                        json!({ "values": [] })
                    })
                }
            })
            .await
            .unwrap();
        assert_eq!(detail.number, 5);
        assert_eq!(calls.lock().unwrap().len(), 5);
        assert!(matches!(
            get_bitbucket_pr_detail_logic(creds(), &gen, "../x".into(), 5, |_a, _t| async {
                panic!("invalid input must not fetch");
                #[allow(unreachable_code)]
                Ok(json!({}))
            })
            .await,
            Err(CmdError::InvalidInput)
        ));
    }

    #[tokio::test]
    async fn diff_parses_text_and_guards_generation() {
        let gen = AtomicU64::new(0);
        let diff =
            get_bitbucket_pr_diff_logic(creds(), &gen, "acme/api".into(), 5, |_a, p| async move {
                assert_eq!(p, "/repositories/acme/api/pullrequests/5/diff");
                Ok((
                    "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n".to_string(),
                    false,
                ))
            })
            .await
            .unwrap();
        assert_eq!(diff.files.len(), 1);

        let r = get_bitbucket_pr_diff_logic(creds(), &gen, "acme/api".into(), 5, |_a, _p| {
            gen.fetch_add(1, Ordering::SeqCst);
            async { Ok((String::new(), false)) }
        })
        .await;
        assert!(matches!(r, Err(CmdError::WorkspaceChanged)));
    }

    #[tokio::test]
    async fn credentials_set_and_clear_wipe_cache_and_bump_generation() {
        let (_d, pool) = pool().await;
        favorite(&pool, "acme/api").await;
        let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());
        let gen = AtomicU64::new(0);

        assert!(matches!(
            set_bitbucket_credentials_logic(store.clone(), &pool, &gen, "a:b".into(), "t".into())
                .await,
            Err(CmdError::InvalidInput)
        ));
        assert!(matches!(
            set_bitbucket_credentials_logic(
                store.clone(),
                &pool,
                &gen,
                "me@x.io".into(),
                " ".into()
            )
            .await,
            Err(CmdError::InvalidInput)
        ));
        assert_eq!(gen.load(Ordering::SeqCst), 0);

        set_bitbucket_credentials_logic(
            store.clone(),
            &pool,
            &gen,
            " me@x.io ".into(),
            "tok".into(),
        )
        .await
        .unwrap();
        assert_eq!(gen.load(Ordering::SeqCst), 1);
        assert_eq!(
            store.get(BITBUCKET_EMAIL_ACCOUNT).unwrap().as_deref(),
            Some("me@x.io")
        );
        assert!(ch::load_favorites(&pool, BITBUCKET)
            .await
            .unwrap()
            .is_empty());
        assert_eq!(
            get_bitbucket_status_logic(store.clone(), &pool)
                .await
                .unwrap(),
            BitbucketStatus::Unverified
        );

        let status =
            test_bitbucket_connection_logic(creds(), &pool, |_a, t| async move { fake_api(&t) })
                .await
                .unwrap();
        assert_eq!(status, BitbucketStatus::Connected { login: "me".into() });
        assert_eq!(
            get_bitbucket_status_logic(store.clone(), &pool)
                .await
                .unwrap(),
            BitbucketStatus::Connected { login: "me".into() }
        );

        clear_bitbucket_credentials_logic(store.clone(), &pool, &gen)
            .await
            .unwrap();
        assert_eq!(gen.load(Ordering::SeqCst), 2);
        assert_eq!(store.get(BITBUCKET_TOKEN_ACCOUNT).unwrap(), None);
        assert_eq!(store.get(BITBUCKET_EMAIL_ACCOUNT).unwrap(), None);
        assert_eq!(
            get_bitbucket_status_logic(store, &pool).await.unwrap(),
            BitbucketStatus::NotConfigured
        );
    }

    #[test]
    fn errors_are_sanitized() {
        assert_eq!(
            CmdError::from(BitbucketError::Auth).to_string(),
            "Bitbucket rejected the request."
        );
        assert!(matches!(
            CmdError::from(BitbucketError::RateLimited),
            CmdError::RateLimited
        ));
    }
}
