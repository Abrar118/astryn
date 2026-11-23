//! Keyword search over the chunk index (SQLite FTS5, BM25-ranked).

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use serde::Serialize;
use sqlx::SqlitePool;

use super::embedder::embed_query;
use super::engine::Engine;

const CHUNK_POOL: i64 = 50; // chunks fetched, then grouped into files
pub const DEFAULT_LIMIT: usize = 20;
const RRF_K: f64 = 60.0;

#[derive(Debug, Serialize, PartialEq, Eq, Clone)]
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

/// One matching section, before sections are grouped into files.
#[derive(Debug, Clone)]
pub struct ChunkHit {
    pub id: i64,
    pub hit: DocHit,
}

type ChunkRow = (i64, String, String, String, String, i64, String);

fn chunk_hit(r: ChunkRow) -> ChunkHit {
    let (id, source_id, path, title, heading_path, start_line, snippet) = r;
    ChunkHit {
        id,
        hit: DocHit {
            source_id,
            path,
            title,
            heading_path,
            start_line,
            snippet,
            more: 0,
        },
    }
}

/// Best-first sections matching the words typed (BM25).
async fn keyword_chunks(
    pool: &SqlitePool,
    query: &str,
    source_id: Option<&str>,
    allowed: Option<&[String]>,
) -> Result<Vec<ChunkHit>, sqlx::Error> {
    let Some(q) = fts_query(query) else {
        return Ok(vec![]);
    };
    let rows: Vec<ChunkRow> = sqlx::query_as(
        "SELECT c.id, c.source_id, c.path, c.title, c.heading_path, c.start_line,
                snippet(doc_chunks_fts, -1, '', '', '…', 24)
         FROM doc_chunks_fts
         JOIN doc_chunks c ON c.id = doc_chunks_fts.rowid
         WHERE doc_chunks_fts MATCH ?1 AND (?2 IS NULL OR c.source_id = ?2)
           AND (?4 IS NULL OR c.source_id IN (SELECT value FROM json_each(?4)))
         ORDER BY bm25(doc_chunks_fts, 3.0, 2.0, 1.0)
         LIMIT ?3",
    )
    .bind(q)
    .bind(source_id)
    .bind(CHUNK_POOL)
    .bind(allowed.map(|a| serde_json::to_string(a).unwrap_or_default()))
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(chunk_hit).collect())
}

/// Best-first sections closest in meaning to the query. `None` when semantic
/// search can't run (model missing or failing, or nothing embedded yet).
async fn semantic_chunks(
    pool: &SqlitePool,
    engine: &Arc<Engine>,
    query: &str,
    source_id: Option<&str>,
    allowed: Option<&[String]>,
) -> Option<Vec<ChunkHit>> {
    // Cheapest checks first: nothing embedded yet, or no usable model, and the
    // vectors are never read into memory.
    if !engine.has_vectors(pool).await {
        return None;
    }
    let embedder = engine.embedder().await.ok()?;
    let vectors = engine.vectors(pool).await.ok()?;
    let q = query.to_string();
    let qv = tokio::task::spawn_blocking(move || embed_query(embedder.as_ref(), &q))
        .await
        .ok()?
        .ok()?;
    // Vectors are unit length, so the dot product is the cosine similarity.
    let mut scored: Vec<(f32, i64)> = vectors
        .iter()
        .filter(|v| source_id.is_none_or(|s| s == v.source_id))
        .filter(|v| allowed.is_none_or(|a| a.contains(&v.source_id)))
        .map(|v| (v.vector.iter().zip(&qv).map(|(a, b)| a * b).sum(), v.id))
        .collect();
    scored.sort_by(|a, b| b.0.total_cmp(&a.0));
    scored.truncate(CHUNK_POOL as usize);
    let ids: Vec<i64> = scored.iter().map(|s| s.1).collect();
    let rows: Vec<ChunkRow> = sqlx::query_as(
        "SELECT id, source_id, path, title, heading_path, start_line, substr(content, 1, 200)
         FROM doc_chunks WHERE id IN (SELECT value FROM json_each(?1))",
    )
    .bind(serde_json::to_string(&ids).ok()?)
    .fetch_all(pool)
    .await
    .ok()?;
    let mut by_id: HashMap<i64, ChunkHit> = rows.into_iter().map(|r| (r.0, chunk_hit(r))).collect();
    // A chunk deleted since the cache was read is simply absent.
    Some(ids.iter().filter_map(|id| by_id.remove(id)).collect())
}

/// Reciprocal Rank Fusion of two best-first lists of ids (meaning weighs a
/// little more than keywords). An id in both lists beats one in either alone.
fn rrf(keyword: &[i64], semantic: &[i64]) -> Vec<i64> {
    let mut score: HashMap<i64, f64> = HashMap::new();
    for (list, weight) in [(keyword, 1.0), (semantic, 1.2)] {
        for (rank, id) in list.iter().enumerate() {
            *score.entry(*id).or_default() += weight / (RRF_K + rank as f64 + 1.0);
        }
    }
    let mut ids: Vec<i64> = keyword.iter().chain(semantic).copied().collect();
    let mut seen = HashSet::new();
    ids.retain(|id| seen.insert(*id));
    ids.sort_by(|a, b| score[b].total_cmp(&score[a]));
    ids
}

/// Sections arrive best-first; the first section of each file is its best.
fn group_by_file(chunks: Vec<ChunkHit>, limit: usize) -> Vec<DocHit> {
    let mut hits: Vec<DocHit> = vec![];
    for c in chunks {
        let h = c.hit;
        match hits
            .iter_mut()
            .find(|x| x.source_id == h.source_id && x.path == h.path)
        {
            Some(x) => x.more += 1,
            None => hits.push(h),
        }
    }
    hits.truncate(limit);
    hits
}

#[derive(Debug, Serialize, PartialEq, Eq, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum SearchMode {
    Keyword,
    Hybrid,
}

#[derive(Debug, Serialize)]
pub struct SearchResult {
    pub mode: SearchMode,
    pub hits: Vec<DocHit>,
}

/// Keyword results, merged with meaning-based ones when `engine` is given and
/// able to run. Keyword hits are always kept, so a model miss can't hide an
/// exact match. `allowed` limits the sources searched (`None`: all), so sources
/// that must not show up never take a result slot.
pub async fn search_hybrid(
    pool: &SqlitePool,
    engine: Option<&Arc<Engine>>,
    query: &str,
    source_id: Option<&str>,
    allowed: Option<&[String]>,
    limit: usize,
) -> Result<SearchResult, sqlx::Error> {
    let keyword = keyword_chunks(pool, query, source_id, allowed).await?;
    let semantic = match engine {
        Some(e) if !query.trim().is_empty() => {
            semantic_chunks(pool, e, query, source_id, allowed).await
        }
        _ => None,
    };
    let Some(semantic) = semantic else {
        return Ok(SearchResult {
            mode: SearchMode::Keyword,
            hits: group_by_file(keyword, limit),
        });
    };
    let order = rrf(
        &keyword.iter().map(|c| c.id).collect::<Vec<_>>(),
        &semantic.iter().map(|c| c.id).collect::<Vec<_>>(),
    );
    // Keyword snippets (with the matched words) win over a plain text start.
    let mut by_id: HashMap<i64, ChunkHit> = semantic.into_iter().map(|c| (c.id, c)).collect();
    by_id.extend(keyword.into_iter().map(|c| (c.id, c)));
    let merged = order.iter().filter_map(|id| by_id.remove(id)).collect();
    Ok(SearchResult {
        mode: SearchMode::Hybrid,
        hits: group_by_file(merged, limit),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::doc_search::index::{index_files, SourceFile};
    use std::time::Duration;

    async fn search_keyword(
        pool: &SqlitePool,
        query: &str,
        source_id: Option<&str>,
        limit: usize,
    ) -> Result<Vec<DocHit>, sqlx::Error> {
        Ok(search_hybrid(pool, None, query, source_id, None, limit)
            .await?
            .hits)
    }

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

    #[test]
    fn rrf_prefers_ids_found_by_both_and_weighs_meaning_higher() {
        // 2 is in both lists; 1 and 3 are each first in one list.
        assert_eq!(rrf(&[1, 2], &[3, 2]), vec![2, 3, 1]);
        assert_eq!(rrf(&[1], &[]), vec![1]);
    }

    #[tokio::test]
    async fn hybrid_finds_by_meaning_and_falls_back_to_keywords() {
        use crate::doc_search::engine::tests::{pool_with_chunks, topic_engine};
        let (_d, pool) = pool_with_chunks().await;
        let engine = topic_engine(Duration::from_secs(60));

        // Nothing embedded yet: keyword only, and "time away" matches no words.
        let r = search_hybrid(&pool, Some(&engine), "time away", None, None, 10)
            .await
            .unwrap();
        assert_eq!((r.mode, r.hits.len()), (SearchMode::Keyword, 0));

        engine.embed_pending(&pool, |_, _| {}).await.unwrap();
        let r = search_hybrid(&pool, Some(&engine), "time away", None, None, 10)
            .await
            .unwrap();
        assert_eq!(r.mode, SearchMode::Hybrid);
        assert_eq!(r.hits[0].path, "leave.md");

        // An exact keyword match is still found when meaning points elsewhere.
        let r = search_hybrid(&pool, Some(&engine), "pipeline", None, None, 10)
            .await
            .unwrap();
        assert!(r.hits.iter().any(|h| h.path == "deploy.md"));

        // Semantic search off (no engine): plain keyword results.
        let r = search_hybrid(&pool, None, "holiday", None, None, 10)
            .await
            .unwrap();
        assert_eq!(
            (r.mode, r.hits[0].path.as_str()),
            (SearchMode::Keyword, "leave.md")
        );
    }
}
