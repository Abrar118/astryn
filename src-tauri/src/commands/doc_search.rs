use std::sync::Arc;

use serde::Serialize;
use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter, Manager, State};

use super::docs::{list_docs_sources_logic, usable_source, ActiveProviders};
use super::{AppState, CmdError};
use crate::db::docs as ddb;
use crate::doc_search::embedder::MODEL_NAME;
use crate::doc_search::engine::Engine;
use crate::doc_search::index::{index_source, index_status, IndexStats, SourceIndexStatus};
use crate::doc_search::search::{search_hybrid, SearchResult, DEFAULT_LIMIT};
use crate::modules::ModuleId;

const SEMANTIC_KEY: &str = "docs_semantic_search";

/// Semantic search is on unless the user switched it off.
pub async fn semantic_enabled(pool: &SqlitePool) -> bool {
    crate::db::load_setting(pool, SEMANTIC_KEY)
        .await
        .ok()
        .flatten()
        .as_deref()
        != Some("0")
}

/// Search, limited to sources whose provider is on. `engine` is `None` when
/// semantic search is off (keyword only).
pub async fn search_docs_logic(
    pool: &SqlitePool,
    active: ActiveProviders,
    engine: Option<&Arc<Engine>>,
    query: &str,
    source_id: Option<&str>,
    limit: usize,
) -> Result<SearchResult, CmdError> {
    let allowed: Vec<String> = list_docs_sources_logic(pool, active)
        .await?
        .into_iter()
        .filter(|s| s.available)
        .map(|s| s.id)
        .collect();
    search_hybrid(pool, engine, query, source_id, Some(&allowed), limit)
        .await
        .map_err(|_| CmdError::Internal)
}

/// Re-index one source (error if it can't be read) or every available source
/// (a source that fails, e.g. a moved folder, is skipped).
pub async fn reindex_docs_logic(
    pool: &SqlitePool,
    active: ActiveProviders,
    source_id: Option<&str>,
    progress: &mut impl FnMut(usize, usize),
) -> Result<IndexStats, CmdError> {
    let sources = list_docs_sources_logic(pool, active).await?;
    if source_id.is_some_and(|id| !sources.iter().any(|s| s.id == id)) {
        return Err(CmdError::DocsSourceNotFound);
    }
    let mut total = IndexStats::default();
    for s in sources
        .iter()
        .filter(|s| s.available && source_id.is_none_or(|id| id == s.id))
    {
        match index_source(pool, s, progress).await {
            Ok(stats) => total.add(stats),
            Err(e) if source_id.is_some() => return Err(e),
            Err(_) => {}
        }
    }
    Ok(total)
}

/// Called after a successful sync/rescan. The sync already succeeded, so an
/// indexing failure is not reported as a sync failure; Reindex retries it.
pub async fn index_after_sync(app: &AppHandle, pool: &SqlitePool, source_id: &str) {
    emit_progress(app, "reading", 0, 0, true, false);
    if let Ok(Some(source)) = ddb::load_docs_source(pool, source_id).await {
        let _ = index_source(pool, &source, &mut reading_progress(app)).await;
    }
    emit_progress(app, "reading", 0, 0, false, false);
}

/// Progress callback for the keyword step. Events are thinned (every 20 files
/// and the last) so a big folder doesn't flood the webview.
fn reading_progress(app: &AppHandle) -> impl FnMut(usize, usize) + '_ {
    move |done, total| {
        if done == total || done % 20 == 0 {
            emit_progress(app, "reading", done, total, true, false);
        }
    }
}

fn active(state: &AppState) -> ActiveProviders {
    ActiveProviders {
        github: state.module_active(ModuleId::Github),
        clickup: state.module_active(ModuleId::Clickup),
    }
}

/// Indexing progress for the UI (`docs:progress`). `phase` is `reading` (files
/// split into searchable sections) or `embedding` (meaning vectors).
#[derive(Clone, Serialize)]
struct DocsProgress {
    phase: &'static str,
    done: usize,
    total: usize,
    running: bool,
    failed: bool,
}

fn emit_progress(
    app: &AppHandle,
    phase: &'static str,
    done: usize,
    total: usize,
    running: bool,
    failed: bool,
) {
    let _ = app.emit(
        "docs:progress",
        DocsProgress {
            phase,
            done,
            total,
            running,
            failed,
        },
    );
}

/// Embed chunks that have no vector yet, in the background, reporting progress
/// as `docs:progress` events. Does nothing while semantic search is off
/// or the model files are missing. A newer run stops an older one.
pub fn spawn_embedding(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let state = app.state::<AppState>();
        let engine = app.state::<Arc<Engine>>();
        if !semantic_enabled(&state.pool).await || !engine.model_present() {
            return;
        }
        let emit = |done, total, running, failed| {
            emit_progress(&app, "embedding", done, total, running, failed)
        };
        emit(0, 0, true, false);
        let result = engine
            .embed_pending(&state.pool, |done, total| emit(done, total, true, false))
            .await;
        // A superseded run leaves the bar to whoever superseded it, so a newer
        // job's progress is not hidden by this one finishing.
        if !matches!(&result, Ok(run) if run.superseded) {
            emit(0, 0, false, result.is_err());
        }
    });
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticStatus {
    enabled: bool,
    model_present: bool,
    model: &'static str,
}

async fn semantic_status(pool: &SqlitePool, engine: &Engine) -> SemanticStatus {
    SemanticStatus {
        enabled: semantic_enabled(pool).await,
        model_present: engine.model_present(),
        model: MODEL_NAME,
    }
}

#[tauri::command]
pub async fn get_semantic_search(
    state: State<'_, AppState>,
    engine: State<'_, Arc<Engine>>,
) -> Result<SemanticStatus, CmdError> {
    state.require(ModuleId::Docs)?;
    Ok(semantic_status(&state.pool, &engine).await)
}

#[tauri::command]
pub async fn set_semantic_search(
    app: AppHandle,
    state: State<'_, AppState>,
    engine: State<'_, Arc<Engine>>,
    enabled: bool,
) -> Result<SemanticStatus, CmdError> {
    state.require(ModuleId::Docs)?;
    crate::db::save_setting(&state.pool, SEMANTIC_KEY, if enabled { "1" } else { "0" })
        .await
        .map_err(|_| CmdError::Internal)?;
    // Off stops embedding and frees the model; vectors already stored are kept.
    engine.set_enabled(enabled);
    if enabled {
        spawn_embedding(&app);
    } else {
        emit_progress(&app, "embedding", 0, 0, false, false);
    }
    Ok(semantic_status(&state.pool, &engine).await)
}

#[tauri::command]
pub async fn search_docs(
    state: State<'_, AppState>,
    engine: State<'_, Arc<Engine>>,
    query: String,
    source_id: Option<String>,
    limit: Option<usize>,
) -> Result<SearchResult, CmdError> {
    state.require(ModuleId::Docs)?;
    let limit = limit.unwrap_or(DEFAULT_LIMIT).min(100);
    let engine = semantic_enabled(&state.pool).await.then(|| &*engine);
    search_docs_logic(
        &state.pool,
        active(&state),
        engine,
        &query,
        source_id.as_deref(),
        limit,
    )
    .await
}

#[tauri::command]
pub async fn reindex_docs(
    app: AppHandle,
    state: State<'_, AppState>,
    source_id: Option<String>,
) -> Result<IndexStats, CmdError> {
    state.require(ModuleId::Docs)?;
    if let Some(id) = &source_id {
        usable_source(&state, id).await?;
    }
    emit_progress(&app, "reading", 0, 0, true, false);
    let stats = reindex_docs_logic(
        &state.pool,
        active(&state),
        source_id.as_deref(),
        &mut reading_progress(&app),
    )
    .await;
    emit_progress(&app, "reading", 0, 0, false, false);
    spawn_embedding(&app);
    stats
}

#[tauri::command]
pub async fn docs_index_status(
    state: State<'_, AppState>,
) -> Result<Vec<SourceIndexStatus>, CmdError> {
    state.require(ModuleId::Docs)?;
    index_status(&state.pool)
        .await
        .map_err(|_| CmdError::Internal)
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn pool_with_sources() -> (tempfile::TempDir, tempfile::TempDir, SqlitePool) {
        let dir = tempfile::tempdir().unwrap();
        let pool = crate::db::init_pool(&dir.path().join("astryn/t.db"))
            .await
            .unwrap();
        let folder = tempfile::tempdir().unwrap();
        std::fs::write(folder.path().join("a.md"), "# A\nvacation policy").unwrap();
        let loc = folder.path().to_string_lossy().to_string();
        sqlx::query(
            "INSERT INTO docs_sources (id, kind, name, location, position, created_at)
             VALUES ('local', 'local', 'L', ?1, 0, 'now')",
        )
        .bind(&loc)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO docs_sources (id, kind, name, owner, repo, branch, position, created_at)
             VALUES ('o/r@main', 'github', 'G', 'o', 'r', 'main', 1, 'now')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO docs_files (source_id, path, name, kind, parent_path, sha, content, synced_at)
             VALUES ('o/r@main', 'g.md', 'g.md', 'blob', '', 'x', '# G\nvacation days', 'now')",
        )
        .execute(&pool)
        .await
        .unwrap();
        (dir, folder, pool)
    }

    #[tokio::test]
    async fn reindex_search_status_and_provider_off() {
        let (_d, _f, pool) = pool_with_sources().await;
        let all = ActiveProviders::ALL;
        let s = reindex_docs_logic(&pool, all, None, &mut |_, _| {})
            .await
            .unwrap();
        assert_eq!(s.indexed, 2);
        assert_eq!(
            search_docs_logic(&pool, all, None, "vacation", None, 10)
                .await
                .unwrap()
                .hits
                .len(),
            2
        );

        let github_off = ActiveProviders {
            github: false,
            ..all
        };
        let hits = search_docs_logic(&pool, github_off, None, "vacation", None, 10)
            .await
            .unwrap()
            .hits;
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].source_id, "local");

        let status = index_status(&pool).await.unwrap();
        assert_eq!(status.len(), 2);
        assert!(status.iter().all(|s| s.files == 1 && s.chunks == 1));

        assert!(matches!(
            reindex_docs_logic(&pool, all, Some("nope"), &mut |_, _| {}).await,
            Err(CmdError::DocsSourceNotFound)
        ));
    }

    #[tokio::test]
    async fn a_source_that_is_off_takes_no_result_slots() {
        let (_d, _f, pool) = pool_with_sources().await;
        let all = ActiveProviders::ALL;
        reindex_docs_logic(&pool, all, None, &mut |_, _| {})
            .await
            .unwrap();
        // The GitHub source matches far more strongly and more often than the local one.
        for i in 0..80 {
            sqlx::query(
                "INSERT INTO doc_chunks (source_id, path, title, heading_path, start_line, content)
                 VALUES ('o/r@main', ?1, 'g', '', 1, 'vacation vacation vacation vacation')",
            )
            .bind(format!("g{i}.md"))
            .execute(&pool)
            .await
            .unwrap();
        }
        let github_off = ActiveProviders {
            github: false,
            ..all
        };
        let hits = search_docs_logic(&pool, github_off, None, "vacation", None, 10)
            .await
            .unwrap()
            .hits;
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].source_id, "local");
    }

    #[tokio::test]
    async fn reindex_reports_progress_per_file() {
        let (_d, _f, pool) = pool_with_sources().await;
        let mut seen = vec![];
        reindex_docs_logic(&pool, ActiveProviders::ALL, None, &mut |d, t| {
            seen.push((d, t))
        })
        .await
        .unwrap();
        // One file in each of the two sources.
        assert_eq!(seen, vec![(1, 1), (1, 1)]);
    }

    #[tokio::test]
    async fn semantic_search_is_on_by_default_and_can_be_switched_off() {
        let (_d, _f, pool) = pool_with_sources().await;
        assert!(semantic_enabled(&pool).await);
        crate::db::save_setting(&pool, SEMANTIC_KEY, "0")
            .await
            .unwrap();
        assert!(!semantic_enabled(&pool).await);
        crate::db::save_setting(&pool, SEMANTIC_KEY, "1")
            .await
            .unwrap();
        assert!(semantic_enabled(&pool).await);
    }

    #[tokio::test]
    async fn removing_a_source_removes_its_chunks() {
        let (_d, _f, pool) = pool_with_sources().await;
        reindex_docs_logic(&pool, ActiveProviders::ALL, None, &mut |_, _| {})
            .await
            .unwrap();
        ddb::remove_docs_source(&pool, "local").await.unwrap();
        let left: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM doc_chunks WHERE source_id = 'local'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(left, 0);
        assert_eq!(index_status(&pool).await.unwrap().len(), 1);
    }
}
