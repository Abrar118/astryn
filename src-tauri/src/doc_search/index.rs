//! Keeps a source's chunks (and so its keyword index) in step with its files.
//! Unchanged files are skipped by content hash; vanished files are purged.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;

use sha1::{Digest, Sha1};
use sqlx::SqlitePool;

use super::chunker;
use super::embedder::MODEL_NAME;
use crate::commands::CmdError;
use crate::db::docs::{DocsSource, DocsSourceKind};
use crate::local_docs::{self, DocFormat};

/// Bump when the chunker changes so every file is re-chunked once.
const CHUNKER_VERSION: &str = "1";

pub struct SourceFile {
    pub path: String,
    pub title: String,
    pub text: String,
    pub markdown: bool,
}

#[derive(Debug, Default, PartialEq, Eq, serde::Serialize)]
pub struct IndexStats {
    pub indexed: usize,
    pub skipped: usize,
    pub removed: usize,
}

impl IndexStats {
    pub fn add(&mut self, o: IndexStats) {
        self.indexed += o.indexed;
        self.skipped += o.skipped;
        self.removed += o.removed;
    }
}

/// What is searchable for one source (for the Settings screen).
#[derive(Debug, serde::Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SourceIndexStatus {
    pub source_id: String,
    pub files: i64,
    pub chunks: i64,
    /// Chunks that also have a meaning vector (semantic search).
    pub embedded: i64,
    pub indexed_at: String,
}

pub async fn index_status(pool: &SqlitePool) -> Result<Vec<SourceIndexStatus>, sqlx::Error> {
    sqlx::query_as(
        "SELECT f.source_id, COUNT(*) AS files, MAX(f.indexed_at) AS indexed_at,
                (SELECT COUNT(*) FROM doc_chunks c WHERE c.source_id = f.source_id) AS chunks,
                (SELECT COUNT(*) FROM doc_chunks c WHERE c.source_id = f.source_id
                   AND c.embedding_model = ?1) AS embedded
         FROM doc_indexed_files f GROUP BY f.source_id",
    )
    .bind(MODEL_NAME)
    .fetch_all(pool)
    .await
}

fn title_of(name: &str) -> String {
    match name.rsplit_once('.') {
        Some((stem, _)) if local_docs::format_of(name).is_some() => stem.to_string(),
        _ => name.to_string(),
    }
}

fn hash(text: &str) -> String {
    format!("{CHUNKER_VERSION}:{:x}", Sha1::digest(text.as_bytes()))
}

/// The searchable files of a source: the cache for GitHub/ClickUp, the folder
/// itself for a local source. PDFs are skipped.
async fn load_files(pool: &SqlitePool, source: &DocsSource) -> Result<Vec<SourceFile>, CmdError> {
    if source.kind == DocsSourceKind::Local {
        let root = PathBuf::from(source.location.as_deref().ok_or(CmdError::Internal)?);
        return tokio::task::spawn_blocking(move || {
            let scan = local_docs::scan_folder(&root)?;
            let files = scan
                .nodes
                .into_iter()
                .filter(|n| n.kind == "blob")
                .filter_map(|n| {
                    let (full, format) = local_docs::resolve_file(&root, &n.path)?;
                    if format == DocFormat::Pdf {
                        return None;
                    }
                    let text = local_docs::read_text(&full)?;
                    Some(SourceFile {
                        title: title_of(&n.name),
                        markdown: format == DocFormat::Markdown,
                        path: n.path,
                        text,
                    })
                });
            Ok::<_, std::io::Error>(files.collect())
        })
        .await
        .map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::DocsFolderUnavailable);
    }
    let rows: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT path, name, content FROM docs_files
         WHERE source_id = ?1 AND kind = 'blob' AND content IS NOT NULL",
    )
    .bind(&source.id)
    .fetch_all(pool)
    .await
    .map_err(|_| CmdError::Internal)?;
    Ok(rows
        .into_iter()
        .filter_map(|(path, name, text)| {
            // ClickUp pages have no extension and are Markdown.
            let format = local_docs::format_of(&name);
            (format != Some(DocFormat::Pdf)).then(|| SourceFile {
                title: title_of(&name),
                markdown: format != Some(DocFormat::Text),
                path,
                text,
            })
        })
        .collect())
}

/// `progress(done, total)` is called after each file.
pub async fn index_source(
    pool: &SqlitePool,
    source: &DocsSource,
    progress: &mut impl FnMut(usize, usize),
) -> Result<IndexStats, CmdError> {
    let files = load_files(pool, source).await?;
    index_files_with(pool, &source.id, &files, progress)
        .await
        .map_err(|_| CmdError::Internal)
}

/// The kind of a source, or `None` once it has been removed.
async fn source_kind(
    tx: &mut sqlx::SqliteConnection,
    id: &str,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar("SELECT kind FROM docs_sources WHERE id = ?1")
        .bind(id)
        .fetch_optional(tx)
        .await
}

/// Whether a cached file (GitHub/ClickUp) is still in the cache.
async fn cached_file_exists(
    tx: &mut sqlx::SqliteConnection,
    source_id: &str,
    path: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM docs_files
         WHERE source_id = ?1 AND path = ?2 AND content IS NOT NULL)",
    )
    .bind(source_id)
    .bind(path)
    .fetch_one(tx)
    .await
}

async fn delete_file(
    tx: &mut sqlx::SqliteConnection,
    source_id: &str,
    path: &str,
) -> Result<(), sqlx::Error> {
    for sql in [
        "DELETE FROM doc_chunks WHERE source_id = ?1 AND path = ?2",
        "DELETE FROM doc_indexed_files WHERE source_id = ?1 AND path = ?2",
    ] {
        sqlx::query(sql)
            .bind(source_id)
            .bind(path)
            .execute(&mut *tx)
            .await?;
    }
    Ok(())
}

/// Bring one source's chunks in line with `files`. Each file is written in its
/// own transaction. Writes nothing for a source that no longer exists, and
/// nothing for a GitHub/ClickUp file that left the cache since the run read it:
/// a run that finishes after a source was removed or its credential wiped must
/// not bring that content back into the index.
#[cfg(test)]
pub async fn index_files(
    pool: &SqlitePool,
    source_id: &str,
    files: &[SourceFile],
) -> Result<IndexStats, sqlx::Error> {
    index_files_with(pool, source_id, files, &mut |_, _| {}).await
}

pub async fn index_files_with(
    pool: &SqlitePool,
    source_id: &str,
    files: &[SourceFile],
    progress: &mut impl FnMut(usize, usize),
) -> Result<IndexStats, sqlx::Error> {
    let known: HashMap<String, String> =
        sqlx::query_as("SELECT path, content_hash FROM doc_indexed_files WHERE source_id = ?1")
            .bind(source_id)
            .fetch_all(pool)
            .await?
            .into_iter()
            .collect();
    let mut stats = IndexStats::default();
    for (i, f) in files.iter().enumerate() {
        progress(i + 1, files.len());
        let h = hash(&f.text);
        if known.get(&f.path) == Some(&h) {
            stats.skipped += 1;
            continue;
        }
        let mut tx = pool.begin().await?;
        match source_kind(&mut tx, source_id).await?.as_deref() {
            None => return Ok(stats),
            Some("local") => {}
            Some(_) if cached_file_exists(&mut tx, source_id, &f.path).await? => {}
            Some(_) => continue,
        }
        delete_file(&mut tx, source_id, &f.path).await?;
        for c in chunker::chunk(&f.text, f.markdown) {
            sqlx::query(
                "INSERT INTO doc_chunks (source_id, path, title, heading_path, start_line, content)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            )
            .bind(source_id)
            .bind(&f.path)
            .bind(&f.title)
            .bind(&c.heading_path)
            .bind(c.start_line as i64)
            .bind(&c.content)
            .execute(&mut *tx)
            .await?;
        }
        sqlx::query(
            "INSERT INTO doc_indexed_files (source_id, path, content_hash, indexed_at)
             VALUES (?1, ?2, ?3, datetime('now'))",
        )
        .bind(source_id)
        .bind(&f.path)
        .bind(&h)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        stats.indexed += 1;
    }
    let live: HashSet<&str> = files.iter().map(|f| f.path.as_str()).collect();
    let mut tx = pool.begin().await?;
    for path in known.keys().filter(|p| !live.contains(p.as_str())) {
        delete_file(&mut tx, source_id, path).await?;
        stats.removed += 1;
    }
    tx.commit().await?;
    Ok(stats)
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn pool_with_source() -> (tempfile::TempDir, SqlitePool) {
        let dir = tempfile::tempdir().unwrap();
        let pool = crate::db::init_pool(&dir.path().join("astryn/t.db"))
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO docs_sources (id, kind, name, location, position, created_at)
             VALUES ('s', 'local', 'S', '/x', 0, 'now')",
        )
        .execute(&pool)
        .await
        .unwrap();
        (dir, pool)
    }

    fn file(path: &str, text: &str) -> SourceFile {
        SourceFile {
            path: path.into(),
            title: path.into(),
            text: text.into(),
            markdown: true,
        }
    }

    async fn count(pool: &SqlitePool, table: &str) -> i64 {
        sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table}"))
            .fetch_one(pool)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn skips_unchanged_reindexes_changed_and_purges_vanished() {
        let (_d, pool) = pool_with_source().await;
        let first = [file("a.md", "# A\nalpha"), file("b.md", "# B\nbeta")];
        let s = index_files(&pool, "s", &first).await.unwrap();
        assert_eq!((s.indexed, s.skipped, s.removed), (2, 0, 0));
        assert_eq!(count(&pool, "doc_chunks").await, 2);

        let second = [
            file("a.md", "# A\nalpha"),
            file("b.md", "# B\nbeta changed"),
        ];
        let s = index_files(&pool, "s", &second).await.unwrap();
        assert_eq!((s.indexed, s.skipped, s.removed), (1, 1, 0));

        let s = index_files(&pool, "s", &second[..1]).await.unwrap();
        assert_eq!((s.indexed, s.skipped, s.removed), (0, 1, 1));
        assert_eq!(count(&pool, "doc_chunks").await, 1);
        assert_eq!(count(&pool, "doc_indexed_files").await, 1);
    }

    #[tokio::test]
    async fn keyword_index_follows_chunks() {
        let (_d, pool) = pool_with_source().await;
        index_files(&pool, "s", &[file("a.md", "# A\nvacation policy")])
            .await
            .unwrap();
        let hit = |q: &'static str| {
            let pool = pool.clone();
            async move {
                sqlx::query_scalar::<_, i64>(
                    "SELECT COUNT(*) FROM doc_chunks_fts WHERE doc_chunks_fts MATCH ?1",
                )
                .bind(q)
                .fetch_one(&pool)
                .await
                .unwrap()
            }
        };
        assert_eq!(hit("vacation").await, 1);
        index_files(&pool, "s", &[]).await.unwrap();
        assert_eq!(hit("vacation").await, 0);
    }

    #[tokio::test]
    async fn writes_nothing_for_a_removed_source() {
        let (_d, pool) = pool_with_source().await;
        sqlx::query("DELETE FROM docs_sources")
            .execute(&pool)
            .await
            .unwrap();
        index_files(&pool, "s", &[file("a.md", "# A\nalpha")])
            .await
            .unwrap();
        assert_eq!(count(&pool, "doc_chunks").await, 0);
        assert_eq!(count(&pool, "doc_indexed_files").await, 0);
    }

    #[tokio::test]
    async fn indexes_a_local_folder_and_skips_pdfs() {
        let (_d, pool) = pool_with_source().await;
        let folder = tempfile::tempdir().unwrap();
        std::fs::write(folder.path().join("a.md"), "# A\nalpha").unwrap();
        std::fs::write(folder.path().join("b.txt"), "plain beta").unwrap();
        std::fs::write(folder.path().join("c.pdf"), b"%PDF").unwrap();
        let source = crate::db::docs::load_docs_source(&pool, "s")
            .await
            .unwrap()
            .unwrap();
        let source = DocsSource {
            location: Some(folder.path().to_string_lossy().into()),
            ..source
        };
        let s = index_source(&pool, &source, &mut |_, _| {}).await.unwrap();
        assert_eq!(s.indexed, 2);
    }

    #[tokio::test]
    async fn indexing_that_loses_a_race_with_a_cache_wipe_writes_nothing() {
        let (_d, pool) = pool_with_source().await;
        sqlx::query(
            "INSERT INTO docs_sources (id, kind, name, owner, repo, branch, position, created_at)
             VALUES ('g', 'github', 'G', 'o', 'r', 'main', 1, 'now')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO docs_files (source_id, path, name, kind, parent_path, sha, content, synced_at)
             VALUES ('g', 'secret.md', 'secret.md', 'blob', '', 'x', '# Secret\nprivate roadmap', 'now')",
        )
        .execute(&pool)
        .await
        .unwrap();
        let source = crate::db::docs::load_docs_source(&pool, "g")
            .await
            .unwrap()
            .unwrap();

        // The run has read the cached files; then the GitHub token is removed
        // (wiping the cache) before the run writes its chunks.
        let files = load_files(&pool, &source).await.unwrap();
        crate::db::github::wipe_github_cache(&pool).await.unwrap();
        index_files(&pool, "g", &files).await.unwrap();

        let chunks: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM doc_chunks WHERE source_id = 'g'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            chunks, 0,
            "wiped content must not come back through the index"
        );
    }
}
