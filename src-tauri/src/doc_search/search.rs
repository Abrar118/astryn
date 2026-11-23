//! Keyword search over the chunk index (SQLite FTS5, BM25-ranked).

use serde::Serialize;
use sqlx::SqlitePool;

const CHUNK_POOL: i64 = 50; // chunks fetched, then grouped into files
pub const DEFAULT_LIMIT: usize = 20;

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocHit {
    pub source_id: String,
    pub path: String,
    pub title: String,
    /// Best-matching section of the file.
    pub heading_path: String,
    pub start_line: i64,
    pub snippet: String,
    /// How many other sections of the same file matched.
    pub more: usize,
}

/// Turn what the user typed into a safe FTS5 query: each word quoted (so
/// operators and punctuation like `c++` or `"` can't cause a syntax error),
/// joined with OR so a long question still finds partial matches (BM25 ranks
/// the best first), and the last word treated as a prefix for type-ahead.
/// `None` when nothing searchable was typed.
pub fn fts_query(input: &str) -> Option<String> {
    let words: Vec<&str> = input
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .collect();
    let last = words.len().checked_sub(1)?;
    Some(
        words
            .iter()
            .enumerate()
            .map(|(i, w)| format!("\"{w}\"{}", if i == last { "*" } else { "" }))
            .collect::<Vec<_>>()
            .join(" OR "),
    )
}

pub async fn search_keyword(
    pool: &SqlitePool,
    query: &str,
    source_id: Option<&str>,
    limit: usize,
) -> Result<Vec<DocHit>, sqlx::Error> {
    let Some(q) = fts_query(query) else {
        return Ok(vec![]);
    };
    let rows: Vec<(String, String, String, String, i64, String)> = sqlx::query_as(
        "SELECT c.source_id, c.path, c.title, c.heading_path, c.start_line,
                snippet(doc_chunks_fts, -1, '', '', '…', 24)
         FROM doc_chunks_fts
         JOIN doc_chunks c ON c.id = doc_chunks_fts.rowid
         WHERE doc_chunks_fts MATCH ?1 AND (?2 IS NULL OR c.source_id = ?2)
         ORDER BY bm25(doc_chunks_fts, 3.0, 2.0, 1.0)
         LIMIT ?3",
    )
    .bind(q)
    .bind(source_id)
    .bind(CHUNK_POOL)
    .fetch_all(pool)
    .await?;

    // Rows arrive best-first; the first row of each file is its best section.
    let mut hits: Vec<DocHit> = vec![];
    for (source_id, path, title, heading_path, start_line, snippet) in rows {
        match hits
            .iter_mut()
            .find(|h| h.source_id == source_id && h.path == path)
        {
            Some(h) => h.more += 1,
            None => hits.push(DocHit {
                source_id,
                path,
                title,
                heading_path,
                start_line,
                snippet,
                more: 0,
            }),
        }
    }
    hits.truncate(limit);
    Ok(hits)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::doc_search::index::{index_files, SourceFile};

    #[test]
    fn query_is_quoted_or_joined_with_prefix_on_last_word() {
        assert_eq!(
            fts_query("vacation pol").unwrap(),
            "\"vacation\" OR \"pol\"*"
        );
        assert_eq!(
            fts_query("c++ \"1-1s\" AND NOT").unwrap(),
            "\"c\" OR \"1\" OR \"1s\" OR \"AND\" OR \"NOT\"*"
        );
        assert_eq!(fts_query("  ?!  "), None);
    }

    async fn pool() -> (tempfile::TempDir, SqlitePool) {
        let dir = tempfile::tempdir().unwrap();
        let pool = crate::db::init_pool(&dir.path().join("astryn/t.db"))
            .await
            .unwrap();
        for id in ["s", "t"] {
            sqlx::query(
                "INSERT INTO docs_sources (id, kind, name, location, position, created_at)
                 VALUES (?1, 'local', ?1, '/x', 0, 'now')",
            )
            .bind(id)
            .execute(&pool)
            .await
            .unwrap();
        }
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

    #[tokio::test]
    async fn finds_ranks_groups_and_filters_by_source() {
        let (_d, pool) = pool().await;
        let long = format!(
            "# Leave\n{}\n\n# Travel\nvacation days abroad",
            "filler ".repeat(300)
        );
        index_files(
            &pool,
            "s",
            &[file("hr.md", &long), file("other.md", "# X\nunrelated")],
        )
        .await
        .unwrap();
        index_files(&pool, "t", &[file("t.md", "# T\nvacation policy")])
            .await
            .unwrap();

        let all = search_keyword(&pool, "vacation", None, 10).await.unwrap();
        assert_eq!(all.len(), 2);
        let hr = all.iter().find(|h| h.path == "hr.md").unwrap();
        assert_eq!(hr.heading_path, "Travel");

        let only_s = search_keyword(&pool, "vacation", Some("s"), 10)
            .await
            .unwrap();
        assert_eq!(only_s.len(), 1);
        assert!(
            search_keyword(&pool, "vacat", None, 10)
                .await
                .unwrap()
                .len()
                == 2
        ); // prefix
        assert!(search_keyword(&pool, "c++ \"", None, 10)
            .await
            .unwrap()
            .is_empty()); // no error
        assert_eq!(
            search_keyword(&pool, "vacation", None, 1)
                .await
                .unwrap()
                .len(),
            1
        );
    }
}
