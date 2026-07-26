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
    pub source_count: i64,
}

/// Fetch one source's tree + markdown into its slice of the cache. Sources are
/// synced lazily (only the one being viewed), so this never touches the others.
pub async fn sync_docs_logic<FT, FtFut, FC, FcFut>(
    credentials: Arc<dyn GitHubCredentialProvider>,
    pool: &SqlitePool,
    generation: &AtomicU64,
    source_id: &str,
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

    // Abort if the GitHub token changed mid-sync — never mix two accounts' content.
    if generation.load(Ordering::SeqCst) != gen0 {
        return Err(CmdError::WorkspaceChanged);
    }
    ddb::replace_docs(
        pool,
        source_id,
        &files,
        &now,
        tree_sha.as_deref(),
        truncated,
    )
    .await
    .map_err(|_| CmdError::Internal)?;
    let file_count = files.iter().filter(|f| f.kind == "blob").count() as i64;
    Ok(DocsSyncResult {
        file_count,
        truncated,
    })
}

pub async fn list_docs_logic(
    pool: &SqlitePool,
    source_id: String,
) -> Result<Vec<ddb::DocNode>, CmdError> {
    ddb::list_docs(pool, &source_id)
        .await
        .map_err(|_| CmdError::Internal)
}

pub async fn get_doc_content_logic(
    pool: &SqlitePool,
    source_id: String,
    path: String,
) -> Result<Option<String>, CmdError> {
    ddb::load_doc_content(pool, &source_id, &path)
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
    let source_count = ddb::list_docs_sources(pool)
        .await
        .map_err(|_| CmdError::Internal)?
        .len() as i64;
    Ok(DocsStatus {
        token_present,
        source_count,
    })
}

pub async fn list_docs_sources_logic(pool: &SqlitePool) -> Result<Vec<ddb::DocsSource>, CmdError> {
    ddb::list_docs_sources(pool)
        .await
        .map_err(|_| CmdError::Internal)
}

/// Validate a GitHub repo reference and append it as a source. The display name
/// defaults to the repo name when the caller leaves it blank.
pub async fn add_docs_source_logic(
    pool: &SqlitePool,
    url: String,
    name: Option<String>,
    now: String,
) -> Result<ddb::DocsSource, CmdError> {
    let origin = gdocs::parse_docs_origin(&url).ok_or(CmdError::InvalidUrl)?;
    let label = name
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| origin.repo.clone());
    let inserted = ddb::insert_docs_source(
        pool,
        &label,
        &origin.owner,
        &origin.repo,
        &origin.branch,
        &now,
    )
    .await
    .map_err(|_| CmdError::Internal)?;
    if !inserted {
        return Err(CmdError::DuplicateDocsSource);
    }
    let id = ddb::source_id(&origin.owner, &origin.repo, &origin.branch);
    ddb::load_docs_source(pool, &id)
        .await
        .map_err(|_| CmdError::Internal)?
        .ok_or(CmdError::Internal)
}

pub async fn rename_docs_source_logic(
    pool: &SqlitePool,
    id: String,
    name: String,
) -> Result<ddb::DocsSource, CmdError> {
    let label = name.trim();
    if label.is_empty() {
        return Err(CmdError::InvalidInput);
    }
    let renamed = ddb::rename_docs_source(pool, &id, label)
        .await
        .map_err(|_| CmdError::Internal)?;
    if !renamed {
        return Err(CmdError::DocsSourceNotFound);
    }
    ddb::load_docs_source(pool, &id)
        .await
        .map_err(|_| CmdError::Internal)?
        .ok_or(CmdError::DocsSourceNotFound)
}

pub async fn remove_docs_source_logic(pool: &SqlitePool, id: String) -> Result<(), CmdError> {
    let removed = ddb::remove_docs_source(pool, &id)
        .await
        .map_err(|_| CmdError::Internal)?;
    if removed {
        Ok(())
    } else {
        Err(CmdError::DocsSourceNotFound)
    }
}

fn now_iso() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default()
}

#[tauri::command]
pub async fn sync_docs(
    state: State<'_, AppState>,
    source_id: String,
) -> Result<DocsSyncResult, CmdError> {
    let _g = state.github_lock.lock().await;
    let source = ddb::load_docs_source(&state.pool, &source_id)
        .await
        .map_err(|_| CmdError::Internal)?
        .ok_or(CmdError::DocsSourceNotFound)?;
    let origin = std::sync::Arc::new(gdocs::DocsOrigin {
        owner: source.owner,
        repo: source.repo,
        branch: source.branch,
    });
    let client = state.github.clone();
    let client2 = client.clone();
    let origin2 = origin.clone();
    sync_docs_logic(
        state.github_credentials.clone(),
        &state.pool,
        &state.github_generation,
        &source_id,
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
pub async fn list_docs_sources(
    state: State<'_, AppState>,
) -> Result<Vec<ddb::DocsSource>, CmdError> {
    list_docs_sources_logic(&state.pool).await
}

#[tauri::command]
pub async fn add_docs_source(
    state: State<'_, AppState>,
    url: String,
    name: Option<String>,
) -> Result<ddb::DocsSource, CmdError> {
    let _g = state.github_lock.lock().await;
    add_docs_source_logic(&state.pool, url, name, now_iso()).await
}

#[tauri::command]
pub async fn rename_docs_source(
    state: State<'_, AppState>,
    source_id: String,
    name: String,
) -> Result<ddb::DocsSource, CmdError> {
    rename_docs_source_logic(&state.pool, source_id, name).await
}

#[tauri::command]
pub async fn remove_docs_source(
    state: State<'_, AppState>,
    source_id: String,
) -> Result<(), CmdError> {
    let _g = state.github_lock.lock().await;
    remove_docs_source_logic(&state.pool, source_id).await
}

#[tauri::command]
pub async fn list_docs_tree(
    state: State<'_, AppState>,
    source_id: String,
) -> Result<Vec<ddb::DocNode>, CmdError> {
    list_docs_logic(&state.pool, source_id).await
}

#[tauri::command]
pub async fn get_doc_content(
    state: State<'_, AppState>,
    source_id: String,
    path: String,
) -> Result<Option<String>, CmdError> {
    get_doc_content_logic(&state.pool, source_id, path).await
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

    /// Adds a source through the command logic and returns its id.
    async fn add(pool: &SqlitePool, url: &str, name: Option<&str>) -> String {
        add_docs_source_logic(pool, url.into(), name.map(String::from), "now".into())
            .await
            .unwrap()
            .id
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
    async fn sync_caches_tree_and_markdown_content_under_its_source() {
        let (_d, pool) = pool().await;
        let id = add(&pool, "https://github.com/acme/docs", None).await;
        let creds: Arc<dyn GitHubCredentialProvider> =
            Arc::new(FakeGitHubCreds(Some("Bearer x".into())));
        let gen = AtomicU64::new(0);
        let result = sync_docs_logic(
            creds,
            &pool,
            &gen,
            &id,
            "now".into(),
            |_auth| async { Ok((sample_tree(), false, Some("tree123".into()))) },
            |_auth, path| async move { Ok(format!("# {path}")) },
        )
        .await
        .unwrap();

        assert_eq!(result.file_count, 1); // one markdown blob
        assert_eq!(result.truncated, false);

        // Folder + markdown file cached; the .png was filtered out.
        let nodes = list_docs_logic(&pool, id.clone()).await.unwrap();
        assert_eq!(nodes.len(), 2);
        assert_eq!(
            get_doc_content_logic(&pool, id, "02-technical/intro.md".into())
                .await
                .unwrap()
                .as_deref(),
            Some("# 02-technical/intro.md")
        );
    }

    #[tokio::test]
    async fn sync_without_token_is_not_configured() {
        let (_d, pool) = pool().await;
        let id = add(&pool, "acme/docs", None).await;
        let creds: Arc<dyn GitHubCredentialProvider> = Arc::new(FakeGitHubCreds(None));
        let gen = AtomicU64::new(0);
        let result = sync_docs_logic(
            creds,
            &pool,
            &gen,
            &id,
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
        let id = add(&pool, "acme/docs", None).await;
        let creds: Arc<dyn GitHubCredentialProvider> =
            Arc::new(FakeGitHubCreds(Some("Bearer x".into())));
        let gen = AtomicU64::new(0);
        // Bump the generation mid-fetch (simulating a token swap) so the guard trips.
        let result = sync_docs_logic(
            creds,
            &pool,
            &gen,
            &id,
            "now".into(),
            |_auth| {
                gen.fetch_add(1, Ordering::SeqCst);
                async { Ok((sample_tree(), false, Some("tree123".into()))) }
            },
            |_auth, _path| async { Ok("x".into()) },
        )
        .await;
        assert!(matches!(result, Err(CmdError::WorkspaceChanged)));
        assert!(list_docs_logic(&pool, id).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn syncing_one_source_leaves_the_others_cached() {
        let (_d, pool) = pool().await;
        let a = add(&pool, "acme/core", Some("Core")).await;
        let b = add(&pool, "acme/design", Some("Design")).await;
        let creds: Arc<dyn GitHubCredentialProvider> =
            Arc::new(FakeGitHubCreds(Some("Bearer x".into())));
        let gen = AtomicU64::new(0);

        for (id, body) in [(&a, "core"), (&b, "design")] {
            sync_docs_logic(
                creds.clone(),
                &pool,
                &gen,
                id,
                "now".into(),
                |_auth| async { Ok((sample_tree(), false, None)) },
                move |_auth, _path| async move { Ok(body.to_string()) },
            )
            .await
            .unwrap();
        }

        // Re-syncing `a` with an empty tree must not disturb `b`.
        sync_docs_logic(
            creds,
            &pool,
            &gen,
            &a,
            "later".into(),
            |_auth| async { Ok((vec![], false, None)) },
            |_auth, _path| async { Ok(String::new()) },
        )
        .await
        .unwrap();

        assert!(list_docs_logic(&pool, a).await.unwrap().is_empty());
        assert_eq!(
            get_doc_content_logic(&pool, b, "02-technical/intro.md".into())
                .await
                .unwrap()
                .as_deref(),
            Some("design")
        );
    }

    #[tokio::test]
    async fn status_reports_token_and_source_count() {
        let (_d, pool) = pool().await;
        let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());

        let s0 = get_docs_status_logic(store.clone(), &pool).await.unwrap();
        assert_eq!(s0.token_present, false);
        assert_eq!(s0.source_count, 0);

        store.set(GITHUB_TOKEN_ACCOUNT, "ghp_x").unwrap();
        add(&pool, "acme/docs", None).await;
        let s1 = get_docs_status_logic(store, &pool).await.unwrap();
        assert_eq!(s1.token_present, true);
        assert_eq!(s1.source_count, 1);
    }

    #[tokio::test]
    async fn add_source_parses_url_and_defaults_the_name_to_the_repo() {
        let (_d, pool) = pool().await;
        let saved = add_docs_source_logic(
            &pool,
            "https://github.com/acme/docs/tree/release".into(),
            None,
            "now".into(),
        )
        .await
        .unwrap();
        assert_eq!(saved.owner, "acme");
        assert_eq!(saved.repo, "docs");
        assert_eq!(saved.branch, "release");
        assert_eq!(saved.name, "docs");
        assert_eq!(saved.id, "acme/docs@release");
        assert_eq!(saved.url, "https://github.com/acme/docs/tree/release");
        assert_eq!(saved.file_count, 0);

        // A blank name falls back too, rather than storing an empty label.
        let second =
            add_docs_source_logic(&pool, "acme/other".into(), Some("   ".into()), "now".into())
                .await
                .unwrap();
        assert_eq!(second.name, "other");
    }

    #[tokio::test]
    async fn add_source_rejects_garbage_and_duplicates() {
        let (_d, pool) = pool().await;
        assert!(matches!(
            add_docs_source_logic(&pool, "not a url".into(), None, "now".into()).await,
            Err(CmdError::InvalidUrl)
        ));
        assert!(list_docs_sources_logic(&pool).await.unwrap().is_empty());

        add(&pool, "acme/docs", None).await;
        assert!(matches!(
            add_docs_source_logic(
                &pool,
                "acme/docs".into(),
                Some("Again".into()),
                "now".into()
            )
            .await,
            Err(CmdError::DuplicateDocsSource)
        ));
        assert_eq!(list_docs_sources_logic(&pool).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn rename_requires_a_real_source_and_a_non_blank_name() {
        let (_d, pool) = pool().await;
        let id = add(&pool, "acme/docs", None).await;

        let renamed = rename_docs_source_logic(&pool, id.clone(), "  Platform  ".into())
            .await
            .unwrap();
        assert_eq!(renamed.name, "Platform");

        assert!(matches!(
            rename_docs_source_logic(&pool, id, "   ".into()).await,
            Err(CmdError::InvalidInput)
        ));
        assert!(matches!(
            rename_docs_source_logic(&pool, "ghost@main".into(), "X".into()).await,
            Err(CmdError::DocsSourceNotFound)
        ));
    }

    #[tokio::test]
    async fn remove_source_drops_its_cache_and_reports_unknown_ids() {
        let (_d, pool) = pool().await;
        let id = add(&pool, "acme/docs", None).await;
        let creds: Arc<dyn GitHubCredentialProvider> =
            Arc::new(FakeGitHubCreds(Some("Bearer x".into())));
        sync_docs_logic(
            creds,
            &pool,
            &AtomicU64::new(0),
            &id,
            "now".into(),
            |_auth| async { Ok((sample_tree(), false, None)) },
            |_auth, _path| async { Ok("x".into()) },
        )
        .await
        .unwrap();

        remove_docs_source_logic(&pool, id.clone()).await.unwrap();
        assert!(list_docs_sources_logic(&pool).await.unwrap().is_empty());
        assert!(list_docs_logic(&pool, id.clone()).await.unwrap().is_empty());

        assert!(matches!(
            remove_docs_source_logic(&pool, id).await,
            Err(CmdError::DocsSourceNotFound)
        ));
    }
}
