use serde::Serialize;
use sqlx::SqlitePool;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tauri::State;

use super::{AppState, CmdError, GITHUB_TOKEN_ACCOUNT};
use crate::db::docs::{self as ddb, DocsSourceKind};
use crate::github::docs::{self as gdocs, RawEntry};
use crate::github::{GitHubCredentialProvider, GitHubError};
use crate::local_docs;
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

/// Whether a source's provider is on. Local folders need no provider.
pub fn source_available(kind: DocsSourceKind, github_active: bool) -> bool {
    match kind {
        DocsSourceKind::Github => github_active,
        DocsSourceKind::Local => true,
    }
}

pub async fn list_docs_sources_logic(
    pool: &SqlitePool,
    github_active: bool,
) -> Result<Vec<ddb::DocsSource>, CmdError> {
    let mut sources = ddb::list_docs_sources(pool)
        .await
        .map_err(|_| CmdError::Internal)?;
    for s in &mut sources {
        s.available = source_available(s.kind, github_active);
    }
    Ok(sources)
}

async fn load_source(pool: &SqlitePool, id: &str) -> Result<ddb::DocsSource, CmdError> {
    ddb::load_docs_source(pool, id)
        .await
        .map_err(|_| CmdError::Internal)?
        .ok_or(CmdError::DocsSourceNotFound)
}

/// The folder a local source reads from.
fn local_root(source: &ddb::DocsSource) -> Result<PathBuf, CmdError> {
    source
        .location
        .as_deref()
        .map(PathBuf::from)
        .ok_or(CmdError::Internal)
}

/// Add a folder the user picked as a local source. The display name defaults to
/// the folder's own name.
pub async fn add_local_docs_source_logic(
    pool: &SqlitePool,
    folder: PathBuf,
    now: String,
) -> Result<ddb::DocsSource, CmdError> {
    let probe = folder.clone();
    let is_dir = tokio::task::spawn_blocking(move || probe.is_dir())
        .await
        .map_err(|_| CmdError::Internal)?;
    if !is_dir {
        return Err(CmdError::DocsFolderUnavailable);
    }
    let location = folder.to_string_lossy().into_owned();
    let name = folder
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| location.clone());
    let inserted = ddb::insert_local_docs_source(pool, &name, &location, &now)
        .await
        .map_err(|_| CmdError::Internal)?;
    if !inserted {
        return Err(CmdError::DuplicateDocsSource);
    }
    load_source(pool, &ddb::local_source_id(&location)).await
}

async fn scan(root: PathBuf) -> Result<local_docs::Scan, CmdError> {
    tokio::task::spawn_blocking(move || local_docs::scan_folder(&root))
        .await
        .map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::DocsFolderUnavailable)
}

/// Refresh a local source: rescan the folder and record when/how much was found.
/// The listing itself is not stored — `list_docs_tree` rescans on demand.
pub async fn rescan_local_logic(
    pool: &SqlitePool,
    source: &ddb::DocsSource,
    now: String,
) -> Result<DocsSyncResult, CmdError> {
    let found = scan(local_root(source)?).await?;
    let file_count = found.file_count as i64;
    ddb::write_scan_meta(pool, &source.id, &now, file_count, found.truncated)
        .await
        .map_err(|_| CmdError::Internal)?;
    Ok(DocsSyncResult {
        file_count,
        truncated: found.truncated,
    })
}

/// A source's folders + files: the cache for GitHub, a fresh scan for a folder.
pub async fn list_source_tree_logic(
    pool: &SqlitePool,
    source: &ddb::DocsSource,
) -> Result<Vec<ddb::DocNode>, CmdError> {
    match source.kind {
        DocsSourceKind::Github => list_docs_logic(pool, source.id.clone()).await,
        DocsSourceKind::Local => Ok(scan(local_root(source)?).await?.nodes),
    }
}

/// Resolve and read one local document, off the async executor.
async fn read_local<T: Send + 'static>(
    source: &ddb::DocsSource,
    path: String,
    read: fn(&std::path::Path, local_docs::DocFormat) -> Option<T>,
) -> Result<Option<T>, CmdError> {
    let root = local_root(source)?;
    tokio::task::spawn_blocking(move || {
        local_docs::resolve_file(&root, &path).and_then(|(full, format)| read(&full, format))
    })
    .await
    .map_err(|_| CmdError::Internal)
}

/// A document's text: cached Markdown for GitHub; read from disk for a folder
/// (Markdown and `.txt`; `None` for a PDF or anything outside the folder).
pub async fn get_source_content_logic(
    pool: &SqlitePool,
    source: &ddb::DocsSource,
    path: String,
) -> Result<Option<String>, CmdError> {
    match source.kind {
        DocsSourceKind::Github => get_doc_content_logic(pool, source.id.clone(), path).await,
        DocsSourceKind::Local => {
            read_local(source, path, |full, format| match format {
                local_docs::DocFormat::Pdf => None,
                _ => local_docs::read_text(full),
            })
            .await
        }
    }
}

/// A local PDF's bytes. Other sources carry no PDFs.
pub async fn get_doc_pdf_logic(
    source: &ddb::DocsSource,
    path: String,
) -> Result<Vec<u8>, CmdError> {
    if source.kind != DocsSourceKind::Local {
        return Err(CmdError::FileRead);
    }
    read_local(source, path, |full, format| match format {
        local_docs::DocFormat::Pdf => local_docs::read_pdf(full),
        _ => None,
    })
    .await?
    .ok_or(CmdError::FileRead)
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
    state.require(crate::modules::ModuleId::Docs)?;
    let source = load_source(&state.pool, &source_id).await?;
    if source.kind == DocsSourceKind::Local {
        return rescan_local_logic(&state.pool, &source, now_iso()).await;
    }
    state.require(crate::modules::ModuleId::Github)?;
    let _g = state.github_lock.lock().await;
    let (Some(owner), Some(repo), Some(branch)) = (source.owner, source.repo, source.branch) else {
        return Err(CmdError::Internal);
    };
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
    state.require(crate::modules::ModuleId::Docs)?;
    let github_active = state.module_active(crate::modules::ModuleId::Github);
    list_docs_sources_logic(&state.pool, github_active).await
}

/// Open the native folder picker and add the chosen folder as a local source.
/// The picker runs here in Rust, so a filesystem path never crosses IPC from the
/// webview: only a folder the user picked in this dialog can become a source.
/// `None` when the dialog is cancelled.
#[tauri::command]
pub async fn add_local_docs_source(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<ddb::DocsSource>, CmdError> {
    state.require(crate::modules::ModuleId::Docs)?;
    use tauri_plugin_dialog::DialogExt;
    // blocking_pick_folder() must not run on the main thread.
    let picked =
        tauri::async_runtime::spawn_blocking(move || app.dialog().file().blocking_pick_folder())
            .await
            .map_err(|_| CmdError::Internal)?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let folder = picked
        .into_path()
        .map_err(|_| CmdError::DocsFolderUnavailable)?;
    add_local_docs_source_logic(&state.pool, folder, now_iso())
        .await
        .map(Some)
}

/// Load a source and refuse it while its provider is off.
async fn usable_source(state: &AppState, source_id: &str) -> Result<ddb::DocsSource, CmdError> {
    let source = load_source(&state.pool, source_id).await?;
    if source.kind == DocsSourceKind::Github {
        state.require(crate::modules::ModuleId::Github)?;
    }
    Ok(source)
}

#[tauri::command]
pub async fn add_docs_source(
    state: State<'_, AppState>,
    url: String,
    name: Option<String>,
) -> Result<ddb::DocsSource, CmdError> {
    state.require(crate::modules::ModuleId::Docs)?;
    let _g = state.github_lock.lock().await;
    add_docs_source_logic(&state.pool, url, name, now_iso()).await
}

#[tauri::command]
pub async fn rename_docs_source(
    state: State<'_, AppState>,
    source_id: String,
    name: String,
) -> Result<ddb::DocsSource, CmdError> {
    state.require(crate::modules::ModuleId::Docs)?;
    rename_docs_source_logic(&state.pool, source_id, name).await
}

#[tauri::command]
pub async fn remove_docs_source(
    state: State<'_, AppState>,
    source_id: String,
) -> Result<(), CmdError> {
    state.require(crate::modules::ModuleId::Docs)?;
    let _g = state.github_lock.lock().await;
    remove_docs_source_logic(&state.pool, source_id).await
}

#[tauri::command]
pub async fn list_docs_tree(
    state: State<'_, AppState>,
    source_id: String,
) -> Result<Vec<ddb::DocNode>, CmdError> {
    state.require(crate::modules::ModuleId::Docs)?;
    let source = usable_source(&state, &source_id).await?;
    list_source_tree_logic(&state.pool, &source).await
}

#[tauri::command]
pub async fn get_doc_content(
    state: State<'_, AppState>,
    source_id: String,
    path: String,
) -> Result<Option<String>, CmdError> {
    state.require(crate::modules::ModuleId::Docs)?;
    let source = usable_source(&state, &source_id).await?;
    get_source_content_logic(&state.pool, &source, path).await
}

/// A local PDF's bytes, returned as a raw IPC payload (an `ArrayBuffer` in the
/// webview) rather than a JSON number array.
#[tauri::command]
pub async fn get_doc_pdf(
    state: State<'_, AppState>,
    source_id: String,
    path: String,
) -> Result<tauri::ipc::Response, CmdError> {
    state.require(crate::modules::ModuleId::Docs)?;
    let source = usable_source(&state, &source_id).await?;
    get_doc_pdf_logic(&source, path)
        .await
        .map(tauri::ipc::Response::new)
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
        assert_eq!(saved.owner.as_deref(), Some("acme"));
        assert_eq!(saved.repo.as_deref(), Some("docs"));
        assert_eq!(saved.branch.as_deref(), Some("release"));
        assert_eq!(saved.name, "docs");
        assert_eq!(saved.id, "acme/docs@release");
        assert_eq!(
            saved.url.as_deref(),
            Some("https://github.com/acme/docs/tree/release")
        );
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
        assert!(list_docs_sources_logic(&pool, true)
            .await
            .unwrap()
            .is_empty());

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
        assert_eq!(list_docs_sources_logic(&pool, true).await.unwrap().len(), 1);
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

    /// A temp folder with one of each supported kind plus noise, added as a source.
    async fn local_source(pool: &SqlitePool) -> (tempfile::TempDir, ddb::DocsSource) {
        let folder = tempfile::tempdir().unwrap();
        let root = folder.path();
        std::fs::create_dir_all(root.join("guide")).unwrap();
        std::fs::write(root.join("README.md"), "# Notes").unwrap();
        std::fs::write(root.join("guide/plain.txt"), "just text").unwrap();
        std::fs::write(root.join("guide/spec.pdf"), b"%PDF-1.7").unwrap();
        std::fs::write(root.join("photo.png"), b"png").unwrap();
        let source = add_local_docs_source_logic(pool, root.to_path_buf(), "now".into())
            .await
            .unwrap();
        (folder, source)
    }

    #[tokio::test]
    async fn local_source_is_named_after_its_folder_and_rejects_duplicates() {
        let (_d, pool) = pool().await;
        let (folder, source) = local_source(&pool).await;
        assert_eq!(source.kind, DocsSourceKind::Local);
        assert_eq!(
            source.name,
            folder.path().file_name().unwrap().to_string_lossy()
        );
        assert_eq!(
            source.location.as_deref(),
            Some(folder.path().to_string_lossy().as_ref())
        );
        assert!(matches!(
            add_local_docs_source_logic(&pool, folder.path().to_path_buf(), "now".into()).await,
            Err(CmdError::DuplicateDocsSource)
        ));
        assert!(matches!(
            add_local_docs_source_logic(&pool, folder.path().join("nope"), "now".into()).await,
            Err(CmdError::DocsFolderUnavailable)
        ));
    }

    #[tokio::test]
    async fn local_tree_is_scanned_and_files_are_read_in_place() {
        let (_d, pool) = pool().await;
        let (folder, source) = local_source(&pool).await;

        let tree = list_source_tree_logic(&pool, &source).await.unwrap();
        let paths: Vec<&str> = tree.iter().map(|n| n.path.as_str()).collect();
        assert_eq!(
            paths,
            ["README.md", "guide", "guide/plain.txt", "guide/spec.pdf"]
        );
        // Read in place: nothing was written to the cache.
        assert!(list_docs_logic(&pool, source.id.clone())
            .await
            .unwrap()
            .is_empty());

        let read = |p: &str| get_source_content_logic(&pool, &source, p.into());
        assert_eq!(read("README.md").await.unwrap().as_deref(), Some("# Notes"));
        assert_eq!(
            read("guide/plain.txt").await.unwrap().as_deref(),
            Some("just text")
        );
        assert_eq!(read("guide/spec.pdf").await.unwrap(), None); // PDFs go via get_doc_pdf
        assert_eq!(read("../escape.md").await.unwrap(), None);

        assert_eq!(
            get_doc_pdf_logic(&source, "guide/spec.pdf".into())
                .await
                .unwrap(),
            b"%PDF-1.7"
        );
        assert!(matches!(
            get_doc_pdf_logic(&source, "README.md".into()).await,
            Err(CmdError::FileRead)
        ));

        // Edits on disk show up on the next read — no copy to go stale.
        std::fs::write(folder.path().join("README.md"), "# Changed").unwrap();
        assert_eq!(
            read("README.md").await.unwrap().as_deref(),
            Some("# Changed")
        );
    }

    #[tokio::test]
    async fn rescanning_a_local_source_records_counts_only() {
        let (_d, pool) = pool().await;
        let (folder, source) = local_source(&pool).await;
        let result = rescan_local_logic(&pool, &source, "t1".into())
            .await
            .unwrap();
        assert_eq!((result.file_count, result.truncated), (3, false));
        let listed = &list_docs_sources_logic(&pool, false).await.unwrap()[0];
        assert_eq!(listed.file_count, 3);
        assert_eq!(listed.last_synced_at.as_deref(), Some("t1"));

        // A folder that disappeared fails with a sanitized error.
        drop(folder);
        assert!(matches!(
            rescan_local_logic(&pool, &source, "t2".into()).await,
            Err(CmdError::DocsFolderUnavailable)
        ));
    }

    #[tokio::test]
    async fn github_sources_are_unavailable_while_github_is_off() {
        let (_d, pool) = pool().await;
        add(&pool, "acme/docs", None).await;
        let (_f, _local) = local_source(&pool).await;

        let off = list_docs_sources_logic(&pool, false).await.unwrap();
        assert_eq!(
            off.iter()
                .map(|s| (s.kind, s.available))
                .collect::<Vec<_>>(),
            [
                (DocsSourceKind::Github, false),
                (DocsSourceKind::Local, true)
            ]
        );
        assert!(list_docs_sources_logic(&pool, true)
            .await
            .unwrap()
            .iter()
            .all(|s| s.available));
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
        assert!(list_docs_sources_logic(&pool, true)
            .await
            .unwrap()
            .is_empty());
        assert!(list_docs_logic(&pool, id.clone()).await.unwrap().is_empty());

        assert!(matches!(
            remove_docs_source_logic(&pool, id).await,
            Err(CmdError::DocsSourceNotFound)
        ));
    }
}
