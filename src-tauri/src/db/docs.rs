use sqlx::SqlitePool;

#[derive(Debug, Clone)]
pub struct DocFile {
    pub path: String,
    pub name: String,
    pub kind: String,
    pub parent_path: String,
    pub sha: String,
    pub content: Option<String>,
}

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DocNode {
    pub path: String,
    pub name: String,
    pub kind: String,
    pub parent_path: String,
}

/// A configured documentation repository, joined with its cache freshness so the
/// Settings list and the header picker can show "42 files · synced 10:12" without
/// a second round trip.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocsSource {
    pub id: String,
    pub name: String,
    pub owner: String,
    pub repo: String,
    pub branch: String,
    /// Browsable GitHub URL, for the "open on GitHub" affordance in Settings.
    pub url: String,
    pub last_synced_at: Option<String>,
    pub file_count: i64,
    pub truncated: bool,
}

/// The row shape of the sources ⋈ meta query; `url` is derived, not stored.
#[derive(sqlx::FromRow)]
struct SourceRow {
    id: String,
    name: String,
    owner: String,
    repo: String,
    branch: String,
    last_synced_at: Option<String>,
    file_count: i64,
    truncated: bool,
}

impl From<SourceRow> for DocsSource {
    fn from(r: SourceRow) -> Self {
        let url = format!(
            "https://github.com/{}/{}/tree/{}",
            r.owner, r.repo, r.branch
        );
        Self {
            id: r.id,
            name: r.name,
            owner: r.owner,
            repo: r.repo,
            branch: r.branch,
            url,
            last_synced_at: r.last_synced_at,
            file_count: r.file_count,
            truncated: r.truncated,
        }
    }
}

/// Stable id for an origin. Derived rather than random so it survives a rename
/// (open doc tabs reference it) and so re-adding the same repo collides on the
/// primary key instead of silently creating a duplicate source.
pub fn source_id(owner: &str, repo: &str, branch: &str) -> String {
    format!("{owner}/{repo}@{branch}")
}

const SOURCE_SELECT: &str = "SELECT s.id, s.name, s.owner, s.repo, s.branch,
            m.last_synced_at,
            COALESCE(m.file_count, 0) AS file_count,
            COALESCE(m.truncated, 0)  AS truncated
     FROM docs_sources s
     LEFT JOIN docs_sync_meta m ON m.source_id = s.id";

/// All configured sources in insertion order.
pub async fn list_docs_sources(pool: &SqlitePool) -> Result<Vec<DocsSource>, sqlx::Error> {
    let rows: Vec<SourceRow> = sqlx::query_as(&format!("{SOURCE_SELECT} ORDER BY s.position"))
        .fetch_all(pool)
        .await?;
    Ok(rows.into_iter().map(DocsSource::from).collect())
}

/// One source by id (`None` if it was removed).
pub async fn load_docs_source(
    pool: &SqlitePool,
    id: &str,
) -> Result<Option<DocsSource>, sqlx::Error> {
    let row: Option<SourceRow> = sqlx::query_as(&format!("{SOURCE_SELECT} WHERE s.id = ?1"))
        .bind(id)
        .fetch_optional(pool)
        .await?;
    Ok(row.map(DocsSource::from))
}

/// Append a source at the end of the list. Returns `false` if that origin is
/// already configured (primary-key collision), leaving the existing one intact.
pub async fn insert_docs_source(
    pool: &SqlitePool,
    name: &str,
    owner: &str,
    repo: &str,
    branch: &str,
    created_at: &str,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        // VALUES + a scalar subquery, not INSERT..SELECT: SQLite's parser can't
        // tell `ON CONFLICT` from a join's `ON` after a SELECT and rejects it.
        "INSERT INTO docs_sources (id, name, owner, repo, branch, position, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5,
                 (SELECT COALESCE(MAX(position) + 1, 0) FROM docs_sources), ?6)
         ON CONFLICT(id) DO NOTHING",
    )
    .bind(source_id(owner, repo, branch))
    .bind(name)
    .bind(owner)
    .bind(repo)
    .bind(branch)
    .bind(created_at)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
}

/// Change a source's display name. `false` if the id is unknown.
pub async fn rename_docs_source(
    pool: &SqlitePool,
    id: &str,
    name: &str,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("UPDATE docs_sources SET name = ?2 WHERE id = ?1")
        .bind(id)
        .bind(name)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

/// Delete a source together with its cached tree and sync metadata, in one
/// transaction (foreign keys are not enforced — see migration 0016). `false` if
/// the id is unknown.
pub async fn remove_docs_source(pool: &SqlitePool, id: &str) -> Result<bool, sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM docs_files WHERE source_id = ?1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM docs_sync_meta WHERE source_id = ?1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    let result = sqlx::query("DELETE FROM docs_sources WHERE id = ?1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(result.rows_affected() > 0)
}

/// Replace one source's cached tree (delete its rows, insert the fetched set) and
/// upsert its metadata row, in one transaction so a partial write never leaves a
/// half-empty tree. Other sources' caches are untouched.
pub async fn replace_docs(
    pool: &SqlitePool,
    source_id: &str,
    files: &[DocFile],
    synced_at: &str,
    tree_sha: Option<&str>,
    truncated: bool,
) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM docs_files WHERE source_id = ?1")
        .bind(source_id)
        .execute(&mut *tx)
        .await?;
    for f in files {
        sqlx::query(
            "INSERT INTO docs_files (source_id, path, name, kind, parent_path, sha, content, synced_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        )
        .bind(source_id)
        .bind(&f.path)
        .bind(&f.name)
        .bind(&f.kind)
        .bind(&f.parent_path)
        .bind(&f.sha)
        .bind(&f.content)
        .bind(synced_at)
        .execute(&mut *tx)
        .await?;
    }
    let file_count = files.iter().filter(|f| f.kind == "blob").count() as i64;
    sqlx::query(
        "INSERT INTO docs_sync_meta (source_id, last_synced_at, file_count, tree_sha, truncated)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(source_id) DO UPDATE SET
           last_synced_at = excluded.last_synced_at,
           file_count     = excluded.file_count,
           tree_sha       = excluded.tree_sha,
           truncated      = excluded.truncated",
    )
    .bind(source_id)
    .bind(synced_at)
    .bind(file_count)
    .bind(tree_sha)
    .bind(truncated)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

/// One source's cached entries (folders + files), lightweight (no content). The
/// frontend nests them into a tree.
pub async fn list_docs(pool: &SqlitePool, source_id: &str) -> Result<Vec<DocNode>, sqlx::Error> {
    sqlx::query_as::<_, DocNode>(
        "SELECT path, name, kind, parent_path FROM docs_files
         WHERE source_id = ?1 ORDER BY path",
    )
    .bind(source_id)
    .fetch_all(pool)
    .await
}

/// The cached markdown for one file (`None` if the path is unknown for that
/// source, or is a folder).
pub async fn load_doc_content(
    pool: &SqlitePool,
    source_id: &str,
    path: &str,
) -> Result<Option<String>, sqlx::Error> {
    let row: Option<(Option<String>,)> = sqlx::query_as(
        "SELECT content FROM docs_files
         WHERE source_id = ?1 AND path = ?2 AND kind = 'blob'",
    )
    .bind(source_id)
    .bind(path)
    .fetch_optional(pool)
    .await?;
    Ok(row.and_then(|r| r.0))
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn pool() -> (tempfile::TempDir, SqlitePool) {
        let dir = tempfile::tempdir().unwrap();
        let pool = crate::db::init_pool(&dir.path().join("astryn/t.db"))
            .await
            .unwrap();
        (dir, pool)
    }

    /// Adds a source and returns its id.
    async fn add(pool: &SqlitePool, name: &str, owner: &str, repo: &str, branch: &str) -> String {
        assert!(insert_docs_source(pool, name, owner, repo, branch, "now")
            .await
            .unwrap());
        source_id(owner, repo, branch)
    }

    fn dir_entry(path: &str, parent: &str) -> DocFile {
        DocFile {
            path: path.into(),
            name: path.rsplit('/').next().unwrap().into(),
            kind: "tree".into(),
            parent_path: parent.into(),
            sha: "s".into(),
            content: None,
        }
    }

    fn file(path: &str, parent: &str, body: &str) -> DocFile {
        DocFile {
            path: path.into(),
            name: path.rsplit('/').next().unwrap().into(),
            kind: "blob".into(),
            parent_path: parent.into(),
            sha: "s".into(),
            content: Some(body.into()),
        }
    }

    #[tokio::test]
    async fn sources_start_empty_and_list_in_insertion_order() {
        let (_d, pool) = pool().await;
        assert!(list_docs_sources(&pool).await.unwrap().is_empty());

        add(&pool, "Core", "acme", "core", "main").await;
        add(&pool, "Design", "acme", "ds", "main").await;

        let sources = list_docs_sources(&pool).await.unwrap();
        assert_eq!(
            sources.iter().map(|s| s.name.as_str()).collect::<Vec<_>>(),
            ["Core", "Design"]
        );
        assert_eq!(sources[0].id, "acme/core@main");
        assert_eq!(sources[0].url, "https://github.com/acme/core/tree/main");
        // No sync yet.
        assert_eq!(sources[0].last_synced_at, None);
        assert_eq!(sources[0].file_count, 0);
        assert_eq!(sources[0].truncated, false);
    }

    #[tokio::test]
    async fn adding_the_same_origin_twice_is_rejected() {
        let (_d, pool) = pool().await;
        add(&pool, "Core", "acme", "core", "main").await;

        // Same owner/repo/branch under a different name → no second row.
        assert_eq!(
            insert_docs_source(&pool, "Duplicate", "acme", "core", "main", "now")
                .await
                .unwrap(),
            false
        );
        let sources = list_docs_sources(&pool).await.unwrap();
        assert_eq!(sources.len(), 1);
        assert_eq!(sources[0].name, "Core"); // original untouched

        // A different branch of the same repo is a distinct source.
        assert!(
            insert_docs_source(&pool, "Core (next)", "acme", "core", "next", "now")
                .await
                .unwrap()
        );
        assert_eq!(list_docs_sources(&pool).await.unwrap().len(), 2);
    }

    #[tokio::test]
    async fn caches_are_isolated_per_source() {
        let (_d, pool) = pool().await;
        let a = add(&pool, "Core", "acme", "core", "main").await;
        let b = add(&pool, "Design", "acme", "ds", "main").await;

        // The same path in both repos must not collide.
        replace_docs(
            &pool,
            &a,
            &[file("README.md", "", "# Core")],
            "t1",
            None,
            false,
        )
        .await
        .unwrap();
        replace_docs(
            &pool,
            &b,
            &[file("README.md", "", "# Design")],
            "t2",
            None,
            true,
        )
        .await
        .unwrap();

        assert_eq!(
            load_doc_content(&pool, &a, "README.md").await.unwrap(),
            Some("# Core".into())
        );
        assert_eq!(
            load_doc_content(&pool, &b, "README.md").await.unwrap(),
            Some("# Design".into())
        );
        assert_eq!(list_docs(&pool, &a).await.unwrap().len(), 1);

        // Re-syncing one source prunes only its own rows.
        replace_docs(&pool, &a, &[file("other.md", "", "x")], "t3", None, false)
            .await
            .unwrap();
        assert_eq!(
            load_doc_content(&pool, &a, "README.md").await.unwrap(),
            None
        );
        assert_eq!(
            load_doc_content(&pool, &b, "README.md").await.unwrap(),
            Some("# Design".into())
        );

        // Metadata is per-source too.
        let sources = list_docs_sources(&pool).await.unwrap();
        assert_eq!(sources[0].last_synced_at.as_deref(), Some("t3"));
        assert_eq!(sources[0].truncated, false);
        assert_eq!(sources[1].last_synced_at.as_deref(), Some("t2"));
        assert_eq!(sources[1].truncated, true);
    }

    #[tokio::test]
    async fn replace_docs_stores_folders_and_counts_only_files() {
        let (_d, pool) = pool().await;
        let a = add(&pool, "Core", "acme", "core", "main").await;
        replace_docs(
            &pool,
            &a,
            &[
                dir_entry("02-technical", ""),
                file("02-technical/README.md", "02-technical", "# Tech"),
                file("README.md", "", "# Root"),
            ],
            "now",
            Some("treesha"),
            false,
        )
        .await
        .unwrap();

        assert_eq!(list_docs(&pool, &a).await.unwrap().len(), 3);
        // Folders carry no content.
        assert_eq!(
            load_doc_content(&pool, &a, "02-technical").await.unwrap(),
            None
        );
        assert_eq!(list_docs_sources(&pool).await.unwrap()[0].file_count, 2);
    }

    #[tokio::test]
    async fn removing_a_source_takes_its_cache_with_it() {
        let (_d, pool) = pool().await;
        let a = add(&pool, "Core", "acme", "core", "main").await;
        let b = add(&pool, "Design", "acme", "ds", "main").await;
        replace_docs(&pool, &a, &[file("a.md", "", "a")], "t1", None, false)
            .await
            .unwrap();
        replace_docs(&pool, &b, &[file("b.md", "", "b")], "t1", None, false)
            .await
            .unwrap();

        assert!(remove_docs_source(&pool, &a).await.unwrap());
        assert!(load_docs_source(&pool, &a).await.unwrap().is_none());
        assert!(list_docs(&pool, &a).await.unwrap().is_empty());
        // The survivor keeps everything.
        assert_eq!(list_docs(&pool, &b).await.unwrap().len(), 1);
        assert_eq!(
            list_docs_sources(&pool).await.unwrap()[0]
                .last_synced_at
                .as_deref(),
            Some("t1")
        );

        // Removing an unknown id is a no-op, not an error.
        assert_eq!(remove_docs_source(&pool, "nope@x").await.unwrap(), false);
    }

    #[tokio::test]
    async fn renaming_keeps_the_id_and_cache() {
        let (_d, pool) = pool().await;
        let a = add(&pool, "Core", "acme", "core", "main").await;
        replace_docs(&pool, &a, &[file("a.md", "", "a")], "t1", None, false)
            .await
            .unwrap();

        assert!(rename_docs_source(&pool, &a, "Platform docs")
            .await
            .unwrap());
        let s = load_docs_source(&pool, &a).await.unwrap().unwrap();
        assert_eq!(s.name, "Platform docs");
        assert_eq!(s.id, a); // id is origin-derived, so open tabs stay valid
        assert_eq!(s.file_count, 1);

        assert_eq!(
            rename_docs_source(&pool, "nope@x", "Ghost").await.unwrap(),
            false
        );
    }
}
