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

/// Where a source's documents come from (`docs_sources.kind`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DocsSourceKind {
    /// A GitHub repository, synced into `docs_files`.
    Github,
    /// A folder on this machine, read in place (never copied into the cache).
    Local,
    /// A ClickUp Doc, its pages synced into `docs_files`.
    Clickup,
}

impl DocsSourceKind {
    fn parse(s: &str) -> Option<Self> {
        match s {
            "github" => Some(Self::Github),
            "local" => Some(Self::Local),
            "clickup" => Some(Self::Clickup),
            _ => None,
        }
    }
}

/// A configured documentation source, joined with its cache freshness so the
/// Settings list and the header picker can show "42 files · synced 10:12" without
/// a second round trip.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocsSource {
    pub id: String,
    pub kind: DocsSourceKind,
    pub name: String,
    /// GitHub only.
    pub owner: Option<String>,
    pub repo: Option<String>,
    pub branch: Option<String>,
    /// Local only: the absolute folder path.
    pub location: Option<String>,
    /// Browsable GitHub URL, for the "open on GitHub" affordance in Settings.
    pub url: Option<String>,
    pub last_synced_at: Option<String>,
    pub file_count: i64,
    pub truncated: bool,
    /// False while the provider behind the source is turned off (e.g. a GitHub
    /// repository with the GitHub module disabled). Set by the command layer.
    pub available: bool,
}

/// The row shape of the sources ⋈ meta query; `url` is derived, not stored.
#[derive(sqlx::FromRow)]
struct SourceRow {
    id: String,
    kind: String,
    name: String,
    owner: Option<String>,
    repo: Option<String>,
    branch: Option<String>,
    location: Option<String>,
    last_synced_at: Option<String>,
    file_count: i64,
    truncated: bool,
}

impl SourceRow {
    /// `None` for a kind this build doesn't know (e.g. after a downgrade).
    fn into_source(self) -> Option<DocsSource> {
        let kind = DocsSourceKind::parse(&self.kind)?;
        let url = match (kind, &self.owner, &self.repo, &self.branch) {
            (DocsSourceKind::Github, Some(o), Some(r), Some(b)) => {
                Some(format!("https://github.com/{o}/{r}/tree/{b}"))
            }
            (DocsSourceKind::Clickup, ..) => self
                .location
                .as_deref()
                .and_then(crate::clickup::docs::from_location)
                .map(|d| crate::clickup::docs::doc_url(&d)),
            _ => None,
        };
        Some(DocsSource {
            id: self.id,
            kind,
            name: self.name,
            owner: self.owner,
            repo: self.repo,
            branch: self.branch,
            location: self.location,
            url,
            last_synced_at: self.last_synced_at,
            file_count: self.file_count,
            truncated: self.truncated,
            available: true,
        })
    }
}

/// Stable id for an origin. Derived rather than random so it survives a rename
/// (open doc tabs reference it) and so re-adding the same repo collides on the
/// primary key instead of silently creating a duplicate source.
pub fn source_id(owner: &str, repo: &str, branch: &str) -> String {
    format!("{owner}/{repo}@{branch}")
}

/// Stable id for a local folder source (same role as `source_id`).
pub fn local_source_id(location: &str) -> String {
    format!("local:{location}")
}

const SOURCE_SELECT: &str = "SELECT s.id, s.kind, s.name, s.owner, s.repo, s.branch, s.location,
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
    Ok(rows
        .into_iter()
        .filter_map(SourceRow::into_source)
        .collect())
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
    Ok(row.and_then(SourceRow::into_source))
}

/// Append a local folder source. Returns `false` if that folder is already a
/// source (primary-key collision).
pub async fn insert_local_docs_source(
    pool: &SqlitePool,
    name: &str,
    location: &str,
    created_at: &str,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        "INSERT INTO docs_sources (id, kind, name, location, position, created_at)
         VALUES (?1, 'local', ?2, ?3,
                 (SELECT COALESCE(MAX(position) + 1, 0) FROM docs_sources), ?4)
         ON CONFLICT(id) DO NOTHING",
    )
    .bind(local_source_id(location))
    .bind(name)
    .bind(location)
    .bind(created_at)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
}

/// Settings key caching the ClickUp user name shown in Settings.
pub const CLICKUP_USERNAME_KEY: &str = "clickup_username";

/// Stable id for a ClickUp Doc source (same role as `source_id`).
pub fn clickup_source_id(location: &str) -> String {
    format!("clickup:{location}")
}

/// Append a ClickUp Doc source (`location` = `"{workspace_id}/{doc_id}"`).
/// Returns `false` if that Doc is already a source.
pub async fn insert_clickup_docs_source(
    pool: &SqlitePool,
    name: &str,
    location: &str,
    created_at: &str,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        "INSERT INTO docs_sources (id, kind, name, location, position, created_at)
         VALUES (?1, 'clickup', ?2, ?3,
                 (SELECT COALESCE(MAX(position) + 1, 0) FROM docs_sources), ?4)
         ON CONFLICT(id) DO NOTHING",
    )
    .bind(clickup_source_id(location))
    .bind(name)
    .bind(location)
    .bind(created_at)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
}

/// Drop every ClickUp Doc's cached pages and sync metadata (token change or
/// module data removal). The configured Doc entries stay — they are Docs
/// configuration, and a new token simply resyncs them.
pub async fn wipe_clickup_cache(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    for table in ["docs_files", "docs_sync_meta"] {
        sqlx::query(&format!(
            "DELETE FROM {table} WHERE source_id IN
               (SELECT id FROM docs_sources WHERE kind = 'clickup')"
        ))
        .execute(&mut *tx)
        .await?;
    }
    sqlx::query("DELETE FROM settings WHERE key = ?1")
        .bind(CLICKUP_USERNAME_KEY)
        .execute(&mut *tx)
        .await?;
    tx.commit().await
}

/// Record a local folder scan (time, file count, truncated) without storing the
/// listing itself — local files are read in place. `false` (nothing written) if
/// the source was removed meanwhile.
pub async fn write_scan_meta(
    pool: &SqlitePool,
    source_id: &str,
    scanned_at: &str,
    file_count: i64,
    truncated: bool,
) -> Result<bool, sqlx::Error> {
    // Written only while the source still exists, so a scan that finishes after
    // the source was removed can't leave an orphan row behind. (The WHERE also
    // lets SQLite parse ON CONFLICT after an INSERT … SELECT.)
    let result = sqlx::query(
        "INSERT INTO docs_sync_meta (source_id, last_synced_at, file_count, tree_sha, truncated)
         SELECT ?1, ?2, ?3, NULL, ?4
         WHERE EXISTS (SELECT 1 FROM docs_sources WHERE id = ?1)
         ON CONFLICT(source_id) DO UPDATE SET
           last_synced_at = excluded.last_synced_at,
           file_count     = excluded.file_count,
           truncated      = excluded.truncated",
    )
    .bind(source_id)
    .bind(scanned_at)
    .bind(file_count)
    .bind(truncated)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
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
        "INSERT INTO docs_sources (id, kind, name, owner, repo, branch, position, created_at)
         VALUES (?1, 'github', ?2, ?3, ?4, ?5,
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
///
/// Returns `false` and writes nothing if the source no longer exists: a sync
/// that finishes after its source was removed (or after Docs data was removed)
/// must not leave orphan rows that no later wipe can reach. The check runs after
/// the first write, once this transaction holds SQLite's write lock, so a
/// concurrent removal is either fully before it or fully after it.
pub async fn replace_docs(
    pool: &SqlitePool,
    source_id: &str,
    files: &[DocFile],
    synced_at: &str,
    tree_sha: Option<&str>,
    truncated: bool,
) -> Result<bool, sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM docs_files WHERE source_id = ?1")
        .bind(source_id)
        .execute(&mut *tx)
        .await?;
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM docs_sources WHERE id = ?1)")
            .bind(source_id)
            .fetch_one(&mut *tx)
            .await?;
    if !exists {
        tx.commit().await?; // only removed rows that were already orphans
        return Ok(false);
    }
    // `position` records the order the source gave (ClickUp's page order).
    for (position, f) in files.iter().enumerate() {
        sqlx::query(
            "INSERT INTO docs_files (source_id, path, name, kind, parent_path, sha, content, synced_at, position)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        )
        .bind(source_id)
        .bind(&f.path)
        .bind(&f.name)
        .bind(&f.kind)
        .bind(&f.parent_path)
        .bind(&f.sha)
        .bind(&f.content)
        .bind(synced_at)
        .bind(position as i64)
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
    Ok(true)
}

/// One source's cached entries (folders + files), lightweight (no content), in
/// the order the source gave them. The frontend nests them into a tree.
pub async fn list_docs(pool: &SqlitePool, source_id: &str) -> Result<Vec<DocNode>, sqlx::Error> {
    sqlx::query_as::<_, DocNode>(
        "SELECT path, name, kind, parent_path FROM docs_files
         WHERE source_id = ?1 ORDER BY position, path",
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
        assert_eq!(sources[0].kind, DocsSourceKind::Github);
        assert_eq!(
            sources[0].url.as_deref(),
            Some("https://github.com/acme/core/tree/main")
        );
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
    async fn local_folders_store_only_their_path_and_scan_meta() {
        let (_d, pool) = pool().await;
        add(&pool, "Core", "acme", "core", "main").await;
        assert!(
            insert_local_docs_source(&pool, "Notes", "/home/me/notes", "now")
                .await
                .unwrap()
        );
        // The same folder twice is rejected.
        assert!(
            !insert_local_docs_source(&pool, "Again", "/home/me/notes", "now")
                .await
                .unwrap()
        );

        let id = local_source_id("/home/me/notes");
        write_scan_meta(&pool, &id, "t1", 7, true).await.unwrap();

        let sources = list_docs_sources(&pool).await.unwrap();
        assert_eq!(sources.len(), 2);
        let local = &sources[1];
        assert_eq!(local.id, "local:/home/me/notes");
        assert_eq!(local.kind, DocsSourceKind::Local);
        assert_eq!(local.location.as_deref(), Some("/home/me/notes"));
        assert_eq!((local.owner.as_ref(), local.url.as_ref()), (None, None));
        assert_eq!(local.file_count, 7);
        assert!(local.truncated);
        assert_eq!(local.last_synced_at.as_deref(), Some("t1"));
        // No listing or content was cached.
        assert!(list_docs(&pool, &id).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn clickup_docs_cache_their_pages_and_wipe_alone() {
        let (_d, pool) = pool().await;
        let gh = add(&pool, "Core", "acme", "core", "main").await;
        assert!(
            insert_clickup_docs_source(&pool, "Handbook", "901/abc-1", "now")
                .await
                .unwrap()
        );
        assert!(
            !insert_clickup_docs_source(&pool, "Again", "901/abc-1", "now")
                .await
                .unwrap()
        );
        let cu = clickup_source_id("901/abc-1");
        assert_eq!(cu, "clickup:901/abc-1");

        replace_docs(&pool, &gh, &[file("a.md", "", "a")], "t", None, false)
            .await
            .unwrap();
        replace_docs(&pool, &cu, &[file("p1", "", "# Page")], "t", None, false)
            .await
            .unwrap();
        crate::db::save_setting(&pool, CLICKUP_USERNAME_KEY, "Abrar")
            .await
            .unwrap();

        let s = load_docs_source(&pool, &cu).await.unwrap().unwrap();
        assert_eq!(s.kind, DocsSourceKind::Clickup);
        assert_eq!(
            s.url.as_deref(),
            Some("https://app.clickup.com/901/v/dc/abc-1")
        );
        assert_eq!(s.file_count, 1);

        wipe_clickup_cache(&pool).await.unwrap();
        assert!(list_docs(&pool, &cu).await.unwrap().is_empty());
        assert_eq!(list_docs(&pool, &gh).await.unwrap().len(), 1); // GitHub untouched
        assert_eq!(list_docs_sources(&pool).await.unwrap().len(), 2); // entries kept
        assert_eq!(
            crate::db::load_setting(&pool, CLICKUP_USERNAME_KEY)
                .await
                .unwrap(),
            None
        );
    }

    #[tokio::test]
    async fn a_sync_that_lands_after_its_source_was_removed_writes_nothing() {
        let (_d, pool) = pool().await;
        let a = add(&pool, "Core", "acme", "core", "main").await;
        assert!(insert_local_docs_source(&pool, "Notes", "/notes", "now")
            .await
            .unwrap());
        let local = local_source_id("/notes");
        assert!(remove_docs_source(&pool, &a).await.unwrap());
        assert!(remove_docs_source(&pool, &local).await.unwrap());

        // The late writes are refused rather than leaving orphan rows behind.
        assert!(
            !replace_docs(&pool, &a, &[file("a.md", "", "a")], "t", None, false)
                .await
                .unwrap()
        );
        assert!(!write_scan_meta(&pool, &local, "t", 3, false).await.unwrap());
        for table in ["docs_files", "docs_sync_meta"] {
            let n: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table}"))
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(n, 0, "{table} has orphans");
        }
    }

    #[tokio::test]
    async fn unknown_kinds_are_hidden() {
        let (_d, pool) = pool().await;
        sqlx::query(
            "INSERT INTO docs_sources (id, kind, name, position, created_at)
             VALUES ('x:1', 'future', 'From a newer build', 0, 'now')",
        )
        .execute(&pool)
        .await
        .unwrap();
        assert!(list_docs_sources(&pool).await.unwrap().is_empty());
        assert!(load_docs_source(&pool, "x:1").await.unwrap().is_none());
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
