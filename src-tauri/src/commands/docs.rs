use serde::Serialize;
use sqlx::SqlitePool;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tauri::State;

use super::{AppState, CmdError, GITHUB_TOKEN_ACCOUNT};
use crate::db::docs as ddb;
use crate::github::docs::{self as gdocs, RawEntry};
use crate::github::{GitHubCredentialProvider, GitHubError};
use crate::secrets::SecretStore;

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DocsSyncResult {
    pub file_count: i64,
    pub truncated: bool,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DocsStatus {
    pub token_present: bool,
    pub repo_configured: bool,
    pub last_synced_at: Option<String>,
    pub file_count: i64,
    pub truncated: bool,
}

/// The configured docs repo, with a display URL, for the Settings screen.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DocsRepo {
    pub owner: String,
    pub repo: String,
    pub branch: String,
    pub url: String,
}

impl DocsRepo {
    fn new(owner: String, repo: String, branch: String) -> Self {
        let url = format!("https://github.com/{owner}/{repo}/tree/{branch}");
        Self {
            owner,
            repo,
            branch,
            url,
        }
    }
}

pub async fn sync_docs_logic<FT, FtFut, FC, FcFut>(
    credentials: Arc<dyn GitHubCredentialProvider>,
    pool: &SqlitePool,
    generation: &AtomicU64,
    now: String,
    fetch_tree: FT,
    fetch_content: FC,
) -> Result<DocsSyncResult, CmdError>
where
    FT: FnOnce(String) -> FtFut,
    FtFut: std::future::Future<Output = Result<(Vec<RawEntry>, bool, Option<String>), GitHubError>>,
    FC: Fn(String, String) -> FcFut,
    FcFut: std::future::Future<Output = Result<String, GitHubError>>,
{
    let c = credentials.clone();
    let auth = tokio::task::spawn_blocking(move || c.authorization())
        .await
        .map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::SecretStore)?
        .ok_or(CmdError::GitHubNotConfigured)?;
    let gen0 = generation.load(Ordering::SeqCst);

    let (entries, truncated, tree_sha) = fetch_tree(auth.clone()).await?;
    let mut files: Vec<ddb::DocFile> = Vec::new();
    for e in &entries {
        if e.kind == "tree" {
            files.push(ddb::DocFile {
                path: e.path.clone(),
                name: gdocs::basename(&e.path).to_string(),
                kind: "tree".into(),
                parent_path: gdocs::parent_path(&e.path).to_string(),
                sha: e.sha.clone(),
                content: None,
            });
        } else if e.kind == "blob" && gdocs::is_markdown(&e.path) {
            let text = fetch_content(auth.clone(), e.path.clone()).await?;
            files.push(ddb::DocFile {
                path: e.path.clone(),
                name: gdocs::basename(&e.path).to_string(),
                kind: "blob".into(),
                parent_path: gdocs::parent_path(&e.path).to_string(),
                sha: e.sha.clone(),
                content: Some(text),
            });
        }
    }

    // Abort if the GitHub token changed mid-sync — never mix two repos' content.
    if generation.load(Ordering::SeqCst) != gen0 {
        return Err(CmdError::WorkspaceChanged);
    }
    ddb::replace_docs(pool, &files, &now, tree_sha.as_deref(), truncated)
        .await
        .map_err(|_| CmdError::Internal)?;
    let file_count = files.iter().filter(|f| f.kind == "blob").count() as i64;
    Ok(DocsSyncResult {
        file_count,
        truncated,
    })
}

pub async fn list_docs_logic(pool: &SqlitePool) -> Result<Vec<ddb::DocNode>, CmdError> {
    ddb::list_docs(pool).await.map_err(|_| CmdError::Internal)
}

pub async fn get_doc_content_logic(
    pool: &SqlitePool,
    path: String,
) -> Result<Option<String>, CmdError> {
    ddb::load_doc_content(pool, &path)
        .await
        .map_err(|_| CmdError::Internal)
}

pub async fn get_docs_status_logic(
    store: Arc<dyn SecretStore>,
    pool: &SqlitePool,
) -> Result<DocsStatus, CmdError> {
    let s = store.clone();
    let token_present = tokio::task::spawn_blocking(move || s.get(GITHUB_TOKEN_ACCOUNT))
        .await
        .map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::SecretStore)?
        .is_some();
    let meta = ddb::load_docs_meta(pool)
        .await
        .map_err(|_| CmdError::Internal)?;
    let repo_configured = ddb::load_docs_origin(pool)
        .await
        .map_err(|_| CmdError::Internal)?
        .is_some();
    Ok(DocsStatus {
        token_present,
        repo_configured,
        last_synced_at: meta.as_ref().and_then(|m| m.last_synced_at.clone()),
        file_count: meta.as_ref().map(|m| m.file_count).unwrap_or(0),
        truncated: meta.as_ref().map(|m| m.truncated).unwrap_or(false),
    })
}

pub async fn get_docs_repo_logic(pool: &SqlitePool) -> Result<Option<DocsRepo>, CmdError> {
    let origin = ddb::load_docs_origin(pool)
        .await
        .map_err(|_| CmdError::Internal)?;
    Ok(origin.map(|(owner, repo, branch)| DocsRepo::new(owner, repo, branch)))
}

/// Validate + persist a new docs repo origin, clearing the now-stale cache so the
/// old repo's content can't linger under the new one.
pub async fn set_docs_repo_logic(pool: &SqlitePool, url: String) -> Result<DocsRepo, CmdError> {
    let origin = gdocs::parse_docs_origin(&url).ok_or(CmdError::InvalidUrl)?;
    ddb::save_docs_origin(pool, &origin.owner, &origin.repo, &origin.branch)
        .await
        .map_err(|_| CmdError::Internal)?;
    ddb::clear_docs(pool)
        .await
        .map_err(|_| CmdError::Internal)?;
    Ok(DocsRepo::new(origin.owner, origin.repo, origin.branch))
}

fn now_iso() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default()
}

#[tauri::command]
pub async fn sync_docs(state: State<'_, AppState>) -> Result<DocsSyncResult, CmdError> {
    let _g = state.github_lock.lock().await;
    let (owner, repo, branch) = ddb::load_docs_origin(&state.pool)
        .await
        .map_err(|_| CmdError::Internal)?
        .ok_or(CmdError::DocsRepoNotConfigured)?;
    let origin = std::sync::Arc::new(gdocs::DocsOrigin {
        owner,
        repo,
        branch,
    });
    let client = state.github.clone();
    let client2 = client.clone();
    let origin2 = origin.clone();
    sync_docs_logic(
        state.github_credentials.clone(),
        &state.pool,
        &state.github_generation,
        now_iso(),
        move |auth| {
            let client = client.clone();
            let origin = origin.clone();
            async move {
                let v = client.rest_get(&auth, &gdocs::tree_path(&origin)).await?;
                gdocs::parse_tree(&v)
            }
        },
        move |auth, path| {
            let client = client2.clone();
            let origin = origin2.clone();
            async move {
                let data = client
                    .graphql(&auth, gdocs::content_query_body(&origin, &path))
                    .await?;
                gdocs::parse_blob_text(&data)
            }
        },
    )
    .await
}

#[tauri::command]
pub async fn get_docs_repo(state: State<'_, AppState>) -> Result<Option<DocsRepo>, CmdError> {
    get_docs_repo_logic(&state.pool).await
}

#[tauri::command]
pub async fn set_docs_repo(state: State<'_, AppState>, url: String) -> Result<DocsRepo, CmdError> {
    let _g = state.github_lock.lock().await;
    set_docs_repo_logic(&state.pool, url).await
}

#[tauri::command]
pub async fn list_docs_tree(state: State<'_, AppState>) -> Result<Vec<ddb::DocNode>, CmdError> {
    list_docs_logic(&state.pool).await
}

#[tauri::command]
pub async fn get_doc_content(
    state: State<'_, AppState>,
    path: String,
) -> Result<Option<String>, CmdError> {
    get_doc_content_logic(&state.pool, path).await
}

#[tauri::command]
pub async fn get_docs_status(state: State<'_, AppState>) -> Result<DocsStatus, CmdError> {
    get_docs_status_logic(state.secret_store.clone(), &state.pool).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::github::fake::FakeGitHubCreds;
    use crate::secrets::fake::FakeSecretStore;

    async fn pool() -> (tempfile::TempDir, SqlitePool) {
        let dir = tempfile::tempdir().unwrap();
        let pool = crate::db::init_pool(&dir.path().join("astryn/t.db"))
            .await
            .unwrap();
        (dir, pool)
    }

    fn sample_tree() -> Vec<RawEntry> {
        vec![
            RawEntry {
                path: "02-technical".into(),
                kind: "tree".into(),
                sha: "t1".into(),
            },
            RawEntry {
                path: "02-technical/intro.md".into(),
                kind: "blob".into(),
                sha: "b1".into(),
            },
            RawEntry {
                path: "logo.png".into(),
                kind: "blob".into(),
                sha: "b2".into(),
            }, // non-md → skipped
        ]
    }

    #[tokio::test]
    async fn sync_caches_tree_and_markdown_content() {
        let (_d, pool) = pool().await;
        let creds: Arc<dyn GitHubCredentialProvider> =
            Arc::new(FakeGitHubCreds(Some("Bearer x".into())));
        let gen = AtomicU64::new(0);
        let result = sync_docs_logic(
            creds,
            &pool,
            &gen,
            "now".into(),
            |_auth| async { Ok((sample_tree(), false, Some("tree123".into()))) },
            |_auth, path| async move { Ok(format!("# {path}")) },
        )
        .await
        .unwrap();

        assert_eq!(result.file_count, 1); // one markdown blob
        assert_eq!(result.truncated, false);

        // Folder + markdown file cached; the .png was filtered out.
        let nodes = ddb::list_docs(&pool).await.unwrap();
        assert_eq!(nodes.len(), 2);
        assert_eq!(
            ddb::load_doc_content(&pool, "02-technical/intro.md")
                .await
                .unwrap()
                .as_deref(),
            Some("# 02-technical/intro.md")
        );
    }

    #[tokio::test]
    async fn sync_without_token_is_not_configured() {
        let (_d, pool) = pool().await;
        let creds: Arc<dyn GitHubCredentialProvider> = Arc::new(FakeGitHubCreds(None));
        let gen = AtomicU64::new(0);
        let result = sync_docs_logic(
            creds,
            &pool,
            &gen,
            "now".into(),
            |_auth| async { Ok((sample_tree(), false, Some("tree123".into()))) },
            |_auth, _path| async { Ok(String::new()) },
        )
        .await;
        assert!(matches!(result, Err(CmdError::GitHubNotConfigured)));
    }

    #[tokio::test]
    async fn sync_aborts_and_writes_nothing_when_generation_changes() {
        let (_d, pool) = pool().await;
        let creds: Arc<dyn GitHubCredentialProvider> =
            Arc::new(FakeGitHubCreds(Some("Bearer x".into())));
        let gen = AtomicU64::new(0);
        // Bump the generation mid-fetch (simulating a token swap) so the guard trips.
        let result = sync_docs_logic(
            creds,
            &pool,
            &gen,
            "now".into(),
            |_auth| {
                gen.fetch_add(1, Ordering::SeqCst);
                async { Ok((sample_tree(), false, Some("tree123".into()))) }
            },
            |_auth, _path| async { Ok("x".into()) },
        )
        .await;
        assert!(matches!(result, Err(CmdError::WorkspaceChanged)));
        assert!(ddb::list_docs(&pool).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn status_reflects_token_and_meta() {
        let (_d, pool) = pool().await;
        let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());

        // No token, no sync.
        let s0 = get_docs_status_logic(store.clone(), &pool).await.unwrap();
        assert_eq!(s0.token_present, false);
        assert_eq!(s0.file_count, 0);
        assert_eq!(s0.last_synced_at, None);

        // Token + a completed sync.
        store.set(GITHUB_TOKEN_ACCOUNT, "ghp_x").unwrap();
        ddb::replace_docs(
            &pool,
            &[ddb::DocFile {
                path: "a.md".into(),
                name: "a.md".into(),
                kind: "blob".into(),
                parent_path: "".into(),
                sha: "s".into(),
                content: Some("a".into()),
            }],
            "now",
            None,
            true,
        )
        .await
        .unwrap();
        let s1 = get_docs_status_logic(store, &pool).await.unwrap();
        assert_eq!(s1.token_present, true);
        assert_eq!(s1.file_count, 1);
        assert_eq!(s1.truncated, true);
        assert_eq!(s1.last_synced_at.as_deref(), Some("now"));
    }

    #[tokio::test]
    async fn set_docs_repo_parses_persists_and_clears_cache() {
        let (_d, pool) = pool().await;
        assert!(get_docs_repo_logic(&pool).await.unwrap().is_none());

        // Seed a stale cache from a previous repo.
        ddb::replace_docs(
            &pool,
            &[ddb::DocFile {
                path: "old.md".into(),
                name: "old.md".into(),
                kind: "blob".into(),
                parent_path: "".into(),
                sha: "s".into(),
                content: Some("old".into()),
            }],
            "now",
            None,
            false,
        )
        .await
        .unwrap();

        let saved = set_docs_repo_logic(&pool, "https://github.com/acme/docs/tree/release".into())
            .await
            .unwrap();
        assert_eq!(saved.owner, "acme");
        assert_eq!(saved.repo, "docs");
        assert_eq!(saved.branch, "release");
        assert_eq!(saved.url, "https://github.com/acme/docs/tree/release");

        // Stale cache from the old repo is gone.
        assert!(ddb::list_docs(&pool).await.unwrap().is_empty());

        let got = get_docs_repo_logic(&pool).await.unwrap().unwrap();
        assert_eq!(got.owner, "acme");
        assert_eq!(got.branch, "release");
        assert!(
            get_docs_status_logic(Arc::new(FakeSecretStore::default()), &pool)
                .await
                .unwrap()
                .repo_configured
        );
    }

    #[tokio::test]
    async fn set_docs_repo_rejects_garbage() {
        let (_d, pool) = pool().await;
        let result = set_docs_repo_logic(&pool, "not a url".into()).await;
        assert!(matches!(result, Err(CmdError::InvalidUrl)));
        assert!(get_docs_repo_logic(&pool).await.unwrap().is_none());
    }
}
