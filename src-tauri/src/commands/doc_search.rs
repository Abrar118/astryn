use sqlx::SqlitePool;
use tauri::State;

use super::docs::{list_docs_sources_logic, usable_source, ActiveProviders};
use super::{AppState, CmdError};
use crate::db::docs as ddb;
use crate::doc_search::index::{index_source, index_status, IndexStats, SourceIndexStatus};
use crate::doc_search::search::{search_keyword, DocHit, DEFAULT_LIMIT};
use crate::modules::ModuleId;

/// Keyword search, limited to sources whose provider is on.
pub async fn search_docs_logic(
    pool: &SqlitePool,
    active: ActiveProviders,
    query: &str,
    source_id: Option<&str>,
    limit: usize,
) -> Result<Vec<DocHit>, CmdError> {
    let sources = list_docs_sources_logic(pool, active).await?;
    let mut hits = search_keyword(pool, query, source_id, usize::MAX)
        .await
        .map_err(|_| CmdError::Internal)?;
    hits.retain(|h| sources.iter().any(|s| s.id == h.source_id && s.available));
    hits.truncate(limit);
    Ok(hits)
}

/// Re-index one source (error if it can't be read) or every available source
/// (a source that fails, e.g. a moved folder, is skipped).
pub async fn reindex_docs_logic(
    pool: &SqlitePool,
    active: ActiveProviders,
    source_id: Option<&str>,
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
        match index_source(pool, s).await {
            Ok(stats) => total.add(stats),
            Err(e) if source_id.is_some() => return Err(e),
            Err(_) => {}
        }
    }
    Ok(total)
}

/// Called after a successful sync/rescan. The sync already succeeded, so an
/// indexing failure is not reported as a sync failure; Reindex retries it.
pub async fn index_after_sync(pool: &SqlitePool, source_id: &str) {
    if let Ok(Some(source)) = ddb::load_docs_source(pool, source_id).await {
        let _ = index_source(pool, &source).await;
    }
}

fn active(state: &AppState) -> ActiveProviders {
    ActiveProviders {
        github: state.module_active(ModuleId::Github),
        clickup: state.module_active(ModuleId::Clickup),
    }
}

#[tauri::command]
pub async fn search_docs(
    state: State<'_, AppState>,
    query: String,
    source_id: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<DocHit>, CmdError> {
    state.require(ModuleId::Docs)?;
    let limit = limit.unwrap_or(DEFAULT_LIMIT).min(100);
    search_docs_logic(
        &state.pool,
        active(&state),
        &query,
        source_id.as_deref(),
        limit,
    )
    .await
}

#[tauri::command]
pub async fn reindex_docs(
    state: State<'_, AppState>,
    source_id: Option<String>,
) -> Result<IndexStats, CmdError> {
    state.require(ModuleId::Docs)?;
    if let Some(id) = &source_id {
        usable_source(&state, id).await?;
    }
    reindex_docs_logic(&state.pool, active(&state), source_id.as_deref()).await
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
        let s = reindex_docs_logic(&pool, all, None).await.unwrap();
        assert_eq!(s.indexed, 2);
        assert_eq!(
            search_docs_logic(&pool, all, "vacation", None, 10)
                .await
                .unwrap()
                .len(),
            2
        );

        let github_off = ActiveProviders {
            github: false,
            ..all
        };
        let hits = search_docs_logic(&pool, github_off, "vacation", None, 10)
            .await
            .unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].source_id, "local");

        let status = index_status(&pool).await.unwrap();
        assert_eq!(status.len(), 2);
        assert!(status.iter().all(|s| s.files == 1 && s.chunks == 1));

        assert!(matches!(
            reindex_docs_logic(&pool, all, Some("nope")).await,
            Err(CmdError::DocsSourceNotFound)
        ));
    }

    #[tokio::test]
    async fn removing_a_source_removes_its_chunks() {
        let (_d, _f, pool) = pool_with_sources().await;
        reindex_docs_logic(&pool, ActiveProviders::ALL, None)
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
