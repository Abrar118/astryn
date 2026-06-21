use serde::Serialize;
use sqlx::SqlitePool;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tauri::State;

use super::{AppState, CmdError};
use crate::db::github as gdb;
use crate::github::contributions::{contributions_query_body, parse_contributions, Contributions};
use crate::github::prs::{
    build_search_body, parse_search_page, Bucket, PageInfo, ParsedPr, PAGE_SIZE, PER_BUCKET_CAP,
};
use crate::github::{GitHubCredentialProvider, GitHubError};
use crate::secrets::SecretStore;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::github::fake::FakeGitHubCreds;
    use crate::github::prs::{Bucket, PageInfo, ParsedPr};
    use crate::secrets::fake::FakeSecretStore;
    use std::sync::Mutex;

    async fn pool() -> (tempfile::TempDir, SqlitePool) {
        let dir = tempfile::tempdir().unwrap();
        let pool = crate::db::init_pool(&dir.path().join("astryn/t.db"))
            .await
            .unwrap();
        (dir, pool)
    }

    #[test]
    fn status_computation() {
        assert!(matches!(
            compute_github_status(false, None),
            GitHubStatus::NotConfigured
        ));
        assert!(matches!(
            compute_github_status(true, None),
            GitHubStatus::Unverified
        ));
        match compute_github_status(true, Some("octocat".into())) {
            GitHubStatus::Connected { login } => assert_eq!(login, "octocat"),
            _ => panic!("expected Connected"),
        }
    }

    #[tokio::test]
    async fn set_token_wipes_prior_github_state() {
        let (_d, pool) = pool().await;
        // Seed prior account's login so we can prove it is wiped.
        gdb::save_github_login(&pool, "olduser").await.unwrap();
        let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());
        let gen = AtomicU64::new(0);
        set_github_token_logic(store.clone(), &pool, &gen, "ghp_new".into())
            .await
            .unwrap();
        assert_eq!(gdb::load_github_login(&pool).await.unwrap(), None);
        assert_eq!(gen.load(Ordering::SeqCst), 1);
        assert_eq!(
            store.get(GITHUB_TOKEN_ACCOUNT).unwrap(),
            Some("ghp_new".into())
        );
    }

    #[tokio::test]
    async fn get_status_is_offline() {
        let (_d, pool) = pool().await;
        let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());
        assert!(matches!(
            get_github_status_logic(store.clone(), &pool).await.unwrap(),
            GitHubStatus::NotConfigured
        ));
        store.set(GITHUB_TOKEN_ACCOUNT, "ghp_x").unwrap();
        gdb::save_github_login(&pool, "octocat").await.unwrap();
        match get_github_status_logic(store, &pool).await.unwrap() {
            GitHubStatus::Connected { login } => assert_eq!(login, "octocat"),
            _ => panic!("expected Connected"),
        }
    }

    #[tokio::test]
    async fn test_connection_caches_login() {
        let (_d, pool) = pool().await;
        let creds: Arc<dyn GitHubCredentialProvider> =
            Arc::new(FakeGitHubCreds(Some("Bearer x".into())));
        let status =
            test_github_connection_logic(creds, &pool, |_auth| async { Ok("octocat".to_string()) })
                .await
                .unwrap();
        assert!(matches!(status, GitHubStatus::Connected { .. }));
        assert_eq!(
            gdb::load_github_login(&pool).await.unwrap(),
            Some("octocat".into())
        );
    }

    fn page_pr(n: i64) -> ParsedPr {
        ParsedPr {
            id: format!("o/r#{n}"),
            repo: "o/r".into(),
            number: n,
            title: Some("t".into()),
            draft: false,
            mergeable: Some("mergeable".into()),
            ci_status: Some("success".into()),
            review_decision: None,
            author_login: Some("octocat".into()),
            author_avatar: None,
            comment_count: Some(0),
            branch: Some("b".into()),
            url: Some("u".into()),
            linear_identifier: None,
            updated_at: Some("2026-06-20T00:00:00Z".into()),
        }
    }

    #[tokio::test]
    async fn sync_populates_all_buckets() {
        let (_d, pool) = pool().await;
        let creds: Arc<dyn GitHubCredentialProvider> =
            Arc::new(FakeGitHubCreds(Some("Bearer x".into())));
        let gen = AtomicU64::new(0);
        let results = sync_github_prs_logic(creds, &pool, &gen, "now".into(), |_a, _q, _c| async {
            Ok((
                vec![page_pr(1)],
                PageInfo {
                    has_next_page: false,
                    end_cursor: None,
                },
            ))
        })
        .await
        .unwrap();
        assert_eq!(results.len(), 4);
        assert!(results.iter().all(|r| r.ok && !r.truncated));
        let dash = list_github_prs_logic(&pool).await.unwrap();
        assert_eq!(dash.prs.len(), 4); // one PR per bucket
        assert_eq!(dash.meta.len(), 4);
    }

    #[tokio::test]
    async fn sync_failure_leaves_prior_cache() {
        let (_d, pool) = pool().await;
        // Pre-seed one bucket so we can prove a later failed sync preserves it.
        gdb::replace_bucket(&pool, "needs_review", &[page_pr(7)], "old", false)
            .await
            .unwrap();
        let creds: Arc<dyn GitHubCredentialProvider> =
            Arc::new(FakeGitHubCreds(Some("Bearer x".into())));
        let gen = AtomicU64::new(0);
        let results = sync_github_prs_logic(creds, &pool, &gen, "now".into(), |_a, _q, _c| async {
            Err(GitHubError::Network)
        })
        .await
        .unwrap();
        assert!(results.iter().all(|r| !r.ok));
        // The previously-cached needs_review PR survives the failed refresh.
        let dash = list_github_prs_logic(&pool).await.unwrap();
        assert_eq!(
            dash.prs
                .iter()
                .filter(|p| p.bucket == "needs_review")
                .count(),
            1
        );
    }

    #[tokio::test]
    async fn sync_caps_and_flags_truncation() {
        let (_d, pool) = pool().await;
        let creds: Arc<dyn GitHubCredentialProvider> =
            Arc::new(FakeGitHubCreds(Some("Bearer x".into())));
        let gen = AtomicU64::new(0);
        let calls = Arc::new(Mutex::new(0u32));
        let calls2 = calls.clone();
        // Each call returns 100 distinct PRs, a CHANGING cursor, and claims more.
        sync_github_prs_logic(creds, &pool, &gen, "now".into(), move |_a, _q, _c| {
            let calls = calls2.clone();
            async move {
                let n = {
                    let mut g = calls.lock().unwrap();
                    let n = *g;
                    *g += 1;
                    n
                };
                let prs = (0..100).map(|i| page_pr((n * 100) as i64 + i)).collect();
                Ok((
                    prs,
                    PageInfo {
                        has_next_page: true,
                        end_cursor: Some(format!("c{n}")),
                    },
                ))
            }
        })
        .await
        .unwrap();
        let dash = list_github_prs_logic(&pool).await.unwrap();
        assert_eq!(dash.prs.len(), 1200); // capped at 300 per bucket × 4 buckets
        assert!(dash.meta.iter().all(|m| m.truncated));
    }

    #[tokio::test]
    async fn fetch_bucket_exact_300_is_not_truncated() {
        let calls = Arc::new(Mutex::new(0u32));
        let calls2 = calls.clone();
        // Three full pages (300), then the server reports no more pages.
        let (prs, truncated) = fetch_bucket("auth", Bucket::Mine, &move |_a, _q, _c| {
            let calls = calls2.clone();
            async move {
                let n = {
                    let mut g = calls.lock().unwrap();
                    let n = *g;
                    *g += 1;
                    n
                };
                let last = n == 2;
                let page = (0..100).map(|i| page_pr((n * 100) as i64 + i)).collect();
                Ok((
                    page,
                    PageInfo {
                        has_next_page: !last,
                        end_cursor: if last { None } else { Some(format!("c{n}")) },
                    },
                ))
            }
        })
        .await
        .unwrap();
        assert_eq!(prs.len(), 300);
        assert_eq!(truncated, false);
    }

    #[tokio::test]
    async fn fetch_bucket_more_than_300_is_truncated() {
        let calls = Arc::new(Mutex::new(0u32));
        let calls2 = calls.clone();
        // Three full pages (300) and the server still reports another page.
        let (prs, truncated) = fetch_bucket("auth", Bucket::Mine, &move |_a, _q, _c| {
            let calls = calls2.clone();
            async move {
                let n = {
                    let mut g = calls.lock().unwrap();
                    let n = *g;
                    *g += 1;
                    n
                };
                let page = (0..100).map(|i| page_pr((n * 100) as i64 + i)).collect();
                Ok((
                    page,
                    PageInfo {
                        has_next_page: true,
                        end_cursor: Some(format!("c{n}")),
                    },
                ))
            }
        })
        .await
        .unwrap();
        assert_eq!(prs.len(), 300);
        assert_eq!(truncated, true);
    }

    #[tokio::test]
    async fn fetch_bucket_repeated_cursor_is_malformed() {
        let err = fetch_bucket("auth", Bucket::Mine, &|_a, _q, _c| async {
            // Always claims more with the SAME cursor -> would loop forever.
            Ok((
                vec![page_pr(1)],
                PageInfo {
                    has_next_page: true,
                    end_cursor: Some("same".into()),
                },
            ))
        })
        .await;
        assert!(matches!(err, Err(GitHubError::Malformed)));
    }

    #[tokio::test]
    async fn fetch_bucket_missing_cursor_is_malformed() {
        let err = fetch_bucket("auth", Bucket::Mine, &|_a, _q, _c| async {
            Ok((
                vec![page_pr(1)],
                PageInfo {
                    has_next_page: true,
                    end_cursor: None,
                },
            ))
        })
        .await;
        assert!(matches!(err, Err(GitHubError::Malformed)));
    }

    #[tokio::test]
    async fn sync_aborts_and_writes_nothing_when_generation_changes() {
        let (_d, pool) = pool().await;
        let creds: Arc<dyn GitHubCredentialProvider> =
            Arc::new(FakeGitHubCreds(Some("Bearer x".into())));
        let gen = AtomicU64::new(0);
        // Bump the generation mid-fetch (simulating a token swap) so the guard trips.
        let result = sync_github_prs_logic(creds, &pool, &gen, "now".into(), |_a, _q, _c| {
            gen.fetch_add(1, Ordering::SeqCst);
            async {
                Ok((
                    vec![page_pr(1)],
                    PageInfo {
                        has_next_page: false,
                        end_cursor: None,
                    },
                ))
            }
        })
        .await;
        assert!(matches!(result, Err(CmdError::WorkspaceChanged)));
        assert!(list_github_prs_logic(&pool).await.unwrap().prs.is_empty());
    }

    fn sample_contributions() -> Contributions {
        Contributions {
            total: 2125,
            weeks: vec![vec![crate::github::contributions::ContribDay {
                date: "2025-06-15".into(),
                count: 3,
                weekday: 0,
            }]],
        }
    }

    #[tokio::test]
    async fn sync_contributions_stores_and_returns() {
        let (_d, pool) = pool().await;
        let creds: Arc<dyn GitHubCredentialProvider> =
            Arc::new(FakeGitHubCreds(Some("Bearer x".into())));
        let gen = AtomicU64::new(0);
        let out = sync_github_contributions_logic(creds, &pool, &gen, |_auth| async {
            Ok(sample_contributions())
        })
        .await
        .unwrap();
        assert_eq!(out.total, 2125);
        // Persisted and readable offline.
        let cached = get_github_contributions_logic(&pool)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(cached, sample_contributions());
    }

    #[tokio::test]
    async fn get_contributions_is_none_before_sync() {
        let (_d, pool) = pool().await;
        assert_eq!(get_github_contributions_logic(&pool).await.unwrap(), None);
    }

    #[tokio::test]
    async fn sync_contributions_aborts_on_generation_change() {
        let (_d, pool) = pool().await;
        let creds: Arc<dyn GitHubCredentialProvider> =
            Arc::new(FakeGitHubCreds(Some("Bearer x".into())));
        let gen = AtomicU64::new(0);
        let result = sync_github_contributions_logic(creds, &pool, &gen, |_auth| {
            gen.fetch_add(1, Ordering::SeqCst);
            async { Ok(sample_contributions()) }
        })
        .await;
        assert!(matches!(result, Err(CmdError::WorkspaceChanged)));
        assert_eq!(get_github_contributions_logic(&pool).await.unwrap(), None);
    }
}

use super::GITHUB_TOKEN_ACCOUNT;

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BucketSyncResult {
    pub bucket: String,
    pub ok: bool,
    pub truncated: bool,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PrDashboard {
    pub prs: Vec<gdb::PrRow>,
    pub meta: Vec<gdb::SyncMeta>,
}

/// Fetch one bucket to completion (or the cap), deduping by id within the bucket.
async fn fetch_bucket<F, Fut>(
    auth: &str,
    bucket: Bucket,
    fetch_page: &F,
) -> Result<(Vec<ParsedPr>, bool), GitHubError>
where
    F: Fn(String, String, Option<String>) -> Fut,
    Fut: std::future::Future<Output = Result<(Vec<ParsedPr>, PageInfo), GitHubError>>,
{
    let query = bucket.search_query();
    let mut acc: Vec<ParsedPr> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut cursor: Option<String> = None;
    loop {
        let (prs, page) = fetch_page(auth.to_string(), query.clone(), cursor.clone()).await?;
        for p in prs {
            if seen.insert(p.id.clone()) {
                acc.push(p);
            }
        }
        // A single page crossing the cap -> definitely truncated.
        if acc.len() > PER_BUCKET_CAP {
            acc.truncate(PER_BUCKET_CAP);
            return Ok((acc, true));
        }
        // Reached the cap exactly: trust the server's hasNextPage for truncation.
        if acc.len() == PER_BUCKET_CAP {
            return Ok((acc, page.has_next_page));
        }
        // Genuinely exhausted: not truncated.
        if !page.has_next_page {
            return Ok((acc, false));
        }
        // Must advance with a NEW, non-empty cursor, else the server is buggy and
        // we would loop forever (dedup hides the repeat) — treat as malformed.
        match page.end_cursor {
            Some(next) if Some(&next) != cursor.as_ref() => cursor = Some(next),
            _ => return Err(GitHubError::Malformed),
        }
    }
}

pub async fn sync_github_prs_logic<F, Fut>(
    credentials: Arc<dyn GitHubCredentialProvider>,
    pool: &SqlitePool,
    generation: &AtomicU64,
    now: String,
    fetch_page: F,
) -> Result<Vec<BucketSyncResult>, CmdError>
where
    F: Fn(String, String, Option<String>) -> Fut,
    Fut: std::future::Future<Output = Result<(Vec<ParsedPr>, PageInfo), GitHubError>>,
{
    let c = credentials.clone();
    let auth = tokio::task::spawn_blocking(move || c.authorization())
        .await
        .map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::SecretStore)?
        .ok_or(CmdError::GitHubNotConfigured)?;
    let gen0 = generation.load(Ordering::SeqCst);
    let mut results = Vec::new();
    for bucket in Bucket::all() {
        match fetch_bucket(&auth, bucket, &fetch_page).await {
            Ok((prs, truncated)) => {
                // Abort the whole sync if the credential changed mid-flight: a
                // partial (shortened) summary is ambiguous, so surface an error
                // and write nothing further.
                if generation.load(Ordering::SeqCst) != gen0 {
                    return Err(CmdError::WorkspaceChanged);
                }
                gdb::replace_bucket(pool, bucket.key(), &prs, &now, truncated)
                    .await
                    .map_err(|_| CmdError::Internal)?;
                results.push(BucketSyncResult {
                    bucket: bucket.key().into(),
                    ok: true,
                    truncated,
                });
            }
            Err(_) => {
                results.push(BucketSyncResult {
                    bucket: bucket.key().into(),
                    ok: false,
                    truncated: false,
                });
            }
        }
    }
    Ok(results)
}

pub async fn list_github_prs_logic(pool: &SqlitePool) -> Result<PrDashboard, CmdError> {
    let prs = gdb::list_prs(pool).await.map_err(|_| CmdError::Internal)?;
    let meta = gdb::load_sync_meta(pool)
        .await
        .map_err(|_| CmdError::Internal)?;
    Ok(PrDashboard { prs, meta })
}

fn now_iso() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default()
}

#[tauri::command]
pub async fn sync_github_prs(
    state: State<'_, AppState>,
) -> Result<Vec<BucketSyncResult>, CmdError> {
    let _g = state.github_lock.lock().await;
    let client = state.github.clone();
    sync_github_prs_logic(
        state.github_credentials.clone(),
        &state.pool,
        &state.github_generation,
        now_iso(),
        move |auth, query, cursor| {
            let client = client.clone();
            async move {
                let body = build_search_body(&query, PAGE_SIZE, cursor.as_deref());
                let data = client.graphql(&auth, body).await?;
                parse_search_page(&data)
            }
        },
    )
    .await
}

#[tauri::command]
pub async fn list_github_prs(state: State<'_, AppState>) -> Result<PrDashboard, CmdError> {
    list_github_prs_logic(&state.pool).await
}

/// Offline read of the cached contribution calendar (`None` until first sync).
pub async fn get_github_contributions_logic(
    pool: &SqlitePool,
) -> Result<Option<Contributions>, CmdError> {
    match gdb::load_contributions_json(pool)
        .await
        .map_err(|_| CmdError::Internal)?
    {
        Some(json) => Ok(Some(
            serde_json::from_str(&json).map_err(|_| CmdError::Internal)?,
        )),
        None => Ok(None),
    }
}

pub async fn sync_github_contributions_logic<F, Fut>(
    credentials: Arc<dyn GitHubCredentialProvider>,
    pool: &SqlitePool,
    generation: &AtomicU64,
    fetch: F,
) -> Result<Contributions, CmdError>
where
    F: FnOnce(String) -> Fut,
    Fut: std::future::Future<Output = Result<Contributions, GitHubError>>,
{
    let gen0 = generation.load(Ordering::SeqCst);
    let c = credentials.clone();
    let auth = tokio::task::spawn_blocking(move || c.authorization())
        .await
        .map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::SecretStore)?
        .ok_or(CmdError::GitHubNotConfigured)?;
    let contribs = fetch(auth).await?;
    // Abort if the credential changed mid-fetch (token swap) — write nothing.
    if generation.load(Ordering::SeqCst) != gen0 {
        return Err(CmdError::WorkspaceChanged);
    }
    let json = serde_json::to_string(&contribs).map_err(|_| CmdError::Internal)?;
    gdb::save_contributions_json(pool, &json)
        .await
        .map_err(|_| CmdError::Internal)?;
    Ok(contribs)
}

async fn fetch_contributions(
    client: &crate::github::GitHubClient,
    auth: String,
) -> Result<Contributions, GitHubError> {
    let data = client.graphql(&auth, contributions_query_body()).await?;
    parse_contributions(&data)
}

#[tauri::command]
pub async fn get_github_contributions(
    state: State<'_, AppState>,
) -> Result<Option<Contributions>, CmdError> {
    get_github_contributions_logic(&state.pool).await
}

#[tauri::command]
pub async fn sync_github_contributions(
    state: State<'_, AppState>,
) -> Result<Contributions, CmdError> {
    let _g = state.github_lock.lock().await;
    let client = state.github.clone();
    sync_github_contributions_logic(
        state.github_credentials.clone(),
        &state.pool,
        &state.github_generation,
        move |auth| async move { fetch_contributions(&client, auth).await },
    )
    .await
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum GitHubStatus {
    NotConfigured,
    Unverified,
    Connected { login: String },
}

pub fn compute_github_status(has_token: bool, login: Option<String>) -> GitHubStatus {
    match (has_token, login) {
        (false, _) => GitHubStatus::NotConfigured,
        (true, Some(login)) => GitHubStatus::Connected { login },
        (true, None) => GitHubStatus::Unverified,
    }
}

pub async fn set_github_token_logic(
    store: Arc<dyn SecretStore>,
    pool: &SqlitePool,
    generation: &AtomicU64,
    token: String,
) -> Result<(), CmdError> {
    // Wipe + bump FIRST so a later keyring failure leaves an empty cache (safe),
    // never the new token paired with the previous account's data.
    gdb::wipe_github_cache(pool)
        .await
        .map_err(|_| CmdError::Internal)?;
    generation.fetch_add(1, Ordering::SeqCst);
    let s = store.clone();
    tokio::task::spawn_blocking(move || s.set(GITHUB_TOKEN_ACCOUNT, &token))
        .await
        .map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::SecretStore)?;
    Ok(())
}

pub async fn clear_github_token_logic(
    store: Arc<dyn SecretStore>,
    pool: &SqlitePool,
    generation: &AtomicU64,
) -> Result<(), CmdError> {
    gdb::wipe_github_cache(pool)
        .await
        .map_err(|_| CmdError::Internal)?;
    generation.fetch_add(1, Ordering::SeqCst);
    let s = store.clone();
    tokio::task::spawn_blocking(move || s.delete(GITHUB_TOKEN_ACCOUNT))
        .await
        .map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::SecretStore)?;
    Ok(())
}

pub async fn get_github_status_logic(
    store: Arc<dyn SecretStore>,
    pool: &SqlitePool,
) -> Result<GitHubStatus, CmdError> {
    let s = store.clone();
    let has_token = tokio::task::spawn_blocking(move || s.get(GITHUB_TOKEN_ACCOUNT))
        .await
        .map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::SecretStore)?
        .is_some();
    let login = gdb::load_github_login(pool)
        .await
        .map_err(|_| CmdError::Internal)?;
    Ok(compute_github_status(has_token, login))
}

pub async fn test_github_connection_logic<F, Fut>(
    credentials: Arc<dyn GitHubCredentialProvider>,
    pool: &SqlitePool,
    fetch_login: F,
) -> Result<GitHubStatus, CmdError>
where
    F: FnOnce(String) -> Fut,
    Fut: std::future::Future<Output = Result<String, GitHubError>>,
{
    let c = credentials.clone();
    let auth = tokio::task::spawn_blocking(move || c.authorization())
        .await
        .map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::SecretStore)?
        .ok_or(CmdError::GitHubNotConfigured)?;
    let login = fetch_login(auth).await?;
    gdb::save_github_login(pool, &login)
        .await
        .map_err(|_| CmdError::Internal)?;
    Ok(GitHubStatus::Connected { login })
}

/// GraphQL `viewer { login }` against the live client.
async fn fetch_viewer_login(
    client: &crate::github::GitHubClient,
    auth: String,
) -> Result<String, GitHubError> {
    let body = serde_json::json!({ "query": "query{ viewer { login } }" });
    let data = client.graphql(&auth, body).await?;
    data.get("viewer")
        .and_then(|v| v.get("login"))
        .and_then(|l| l.as_str())
        .map(Into::into)
        .ok_or(GitHubError::Malformed)
}

#[tauri::command]
pub async fn set_github_token(state: State<'_, AppState>, token: String) -> Result<(), CmdError> {
    let _g = state.github_lock.lock().await;
    set_github_token_logic(
        state.secret_store.clone(),
        &state.pool,
        &state.github_generation,
        token,
    )
    .await
}

#[tauri::command]
pub async fn clear_github_token(state: State<'_, AppState>) -> Result<(), CmdError> {
    let _g = state.github_lock.lock().await;
    clear_github_token_logic(
        state.secret_store.clone(),
        &state.pool,
        &state.github_generation,
    )
    .await
}

#[tauri::command]
pub async fn get_github_status(state: State<'_, AppState>) -> Result<GitHubStatus, CmdError> {
    get_github_status_logic(state.secret_store.clone(), &state.pool).await
}

#[tauri::command]
pub async fn test_github_connection(state: State<'_, AppState>) -> Result<GitHubStatus, CmdError> {
    let _g = state.github_lock.lock().await;
    let client = state.github.clone();
    test_github_connection_logic(
        state.github_credentials.clone(),
        &state.pool,
        move |auth| async move { fetch_viewer_login(&client, auth).await },
    )
    .await
}
