//! The semantic half of docs search: a model that loads on first use and is
//! dropped after a few idle minutes, an in-memory copy of the chunk vectors
//! (only while the model is loaded), and the job that embeds chunks.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use sqlx::SqlitePool;

use super::embedder::{
    from_blob, passage_text, to_blob, BgeEmbedder, Embedder, MODEL_DIR, MODEL_NAME,
};

pub const IDLE_UNLOAD: Duration = Duration::from_secs(5 * 60);
const BATCH: i64 = 16;
/// After a failed model load, wait this long before trying again.
const LOAD_RETRY: Duration = Duration::from_secs(30);

pub type Loader = Box<dyn Fn() -> Result<Arc<dyn Embedder>, String> + Send + Sync>;

pub struct StoredVector {
    pub id: i64,
    pub source_id: String,
    pub vector: Vec<f32>,
}

#[derive(Default)]
struct Slot {
    embedder: Option<Arc<dyn Embedder>>,
    vectors: Option<Arc<Vec<StoredVector>>>,
    last_used: Option<Instant>,
}

pub struct Engine {
    dir: PathBuf,
    loader: Loader,
    idle: Duration,
    slot: Mutex<Slot>,
    /// One model load at a time.
    load_gate: tokio::sync::Mutex<()>,
    watching: AtomicBool,
    /// Off while semantic search is switched off: the model is not (re)loaded.
    enabled: AtomicBool,
    /// When the model last failed to load, so searches don't retry every time.
    load_failed_at: Mutex<Option<Instant>>,
    /// Bumped when the vectors change, so a slow cache read can't store stale data.
    vectors_version: AtomicU64,
    /// Bumped to stop a running embedding job (a newer job, or search switched off).
    generation: AtomicU64,
}

/// Where the model files are: the bundled resources, or (in a dev build run
/// from the repo) the folder `npm run fetch-model` fills.
pub fn resolve_model_dir(resource_dir: Option<PathBuf>) -> PathBuf {
    let bundled = resource_dir.map(|d| d.join("models").join(MODEL_DIR));
    match bundled {
        Some(d) if has_model(&d) => d,
        _ if cfg!(debug_assertions) => Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("models")
            .join(MODEL_DIR),
        Some(d) => d,
        None => PathBuf::from(MODEL_DIR),
    }
}

fn has_model(dir: &Path) -> bool {
    ["config.json", "tokenizer.json", "model.safetensors"]
        .iter()
        .all(|f| dir.join(f).is_file())
}

impl Engine {
    pub fn new(dir: PathBuf, loader: Loader, idle: Duration) -> Arc<Self> {
        Arc::new(Self {
            dir,
            loader,
            idle,
            slot: Mutex::default(),
            load_gate: tokio::sync::Mutex::new(()),
            watching: AtomicBool::new(false),
            enabled: AtomicBool::new(true),
            load_failed_at: Mutex::new(None),
            vectors_version: AtomicU64::new(0),
            generation: AtomicU64::new(0),
        })
    }

    /// The real BGE model, read from `dir`.
    pub fn bge(dir: PathBuf) -> Arc<Self> {
        let d = dir.clone();
        Self::new(
            dir,
            Box::new(move || BgeEmbedder::load(&d).map(|e| Arc::new(e) as Arc<dyn Embedder>)),
            IDLE_UNLOAD,
        )
    }

    pub fn model_present(&self) -> bool {
        has_model(&self.dir)
    }

    #[cfg(test)]
    pub fn is_loaded(&self) -> bool {
        self.slot.lock().unwrap().embedder.is_some()
    }

    /// The loaded model, loading it first if needed. Marks it as just used.
    pub async fn embedder(self: &Arc<Self>) -> Result<Arc<dyn Embedder>, String> {
        const OFF: &str = "semantic search is off";
        if !self.enabled.load(Ordering::SeqCst) {
            return Err(OFF.into());
        }
        if let Some(e) = self.touch() {
            return Ok(e);
        }
        let _gate = self.load_gate.lock().await;
        if let Some(e) = self.touch() {
            return Ok(e);
        }
        if self
            .load_failed_at
            .lock()
            .unwrap()
            .is_some_and(|t| t.elapsed() < LOAD_RETRY)
        {
            return Err("model unavailable".into());
        }
        let this = self.clone();
        let loaded = tokio::task::spawn_blocking(move || (this.loader)())
            .await
            .map_err(|e| e.to_string())
            .and_then(|r| r);
        let loaded = match loaded {
            Ok(m) => m,
            Err(e) => {
                *self.load_failed_at.lock().unwrap() = Some(Instant::now());
                return Err(e);
            }
        };
        *self.load_failed_at.lock().unwrap() = None;
        {
            // Checked under the slot lock: `set_enabled(false)` clears the slot
            // under the same lock, so a model that finished loading after the
            // switch-off is dropped here instead of lingering.
            let mut slot = self.slot.lock().unwrap();
            if !self.enabled.load(Ordering::SeqCst) {
                return Err(OFF.into());
            }
            slot.embedder = Some(loaded.clone());
        }
        self.touch();
        if !self.watching.swap(true, Ordering::SeqCst) {
            tokio::spawn(self.clone().unload_when_idle());
        }
        Ok(loaded)
    }

    fn touch(&self) -> Option<Arc<dyn Embedder>> {
        let mut slot = self.slot.lock().unwrap();
        slot.last_used = Some(Instant::now());
        slot.embedder.clone()
    }

    async fn unload_when_idle(self: Arc<Self>) {
        let tick = (self.idle / 4).max(Duration::from_millis(10));
        loop {
            tokio::time::sleep(tick).await;
            let idle = self
                .slot
                .lock()
                .unwrap()
                .last_used
                .is_none_or(|t| t.elapsed() >= self.idle);
            if idle {
                self.unload();
                return;
            }
        }
    }

    /// Drop the model and the vector cache (they are rebuilt on next use).
    pub fn unload(&self) {
        *self.slot.lock().unwrap() = Slot::default();
        self.watching.store(false, Ordering::SeqCst);
    }

    /// Switch semantic search on or off. Off stops the running job and frees the
    /// model; it also stops a load that is still in progress from keeping it.
    pub fn set_enabled(&self, on: bool) {
        self.enabled.store(on, Ordering::SeqCst);
        if !on {
            self.cancel_embedding();
            self.unload();
        }
    }

    /// Stop any running embedding job.
    pub fn cancel_embedding(&self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
    }

    pub fn invalidate_vectors(&self) {
        self.vectors_version.fetch_add(1, Ordering::SeqCst);
        self.slot.lock().unwrap().vectors = None;
    }

    /// Whether any chunk has a vector (without loading them all).
    pub async fn has_vectors(&self, pool: &SqlitePool) -> bool {
        if let Some(v) = &self.slot.lock().unwrap().vectors {
            return !v.is_empty();
        }
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM doc_chunks WHERE embedding_model = ?1)")
            .bind(MODEL_NAME)
            .fetch_one(pool)
            .await
            .unwrap_or(false)
    }

    #[cfg(test)]
    pub fn vectors_cached(&self) -> bool {
        self.slot.lock().unwrap().vectors.is_some()
    }

    /// All chunk vectors of the current model (cached while the model is loaded).
    pub async fn vectors(&self, pool: &SqlitePool) -> Result<Arc<Vec<StoredVector>>, sqlx::Error> {
        if let Some(v) = self.slot.lock().unwrap().vectors.clone() {
            return Ok(v);
        }
        let version = self.vectors_version.load(Ordering::SeqCst);
        let rows: Vec<(i64, String, Vec<u8>)> = sqlx::query_as(
            "SELECT id, source_id, embedding FROM doc_chunks
             WHERE embedding IS NOT NULL AND embedding_model = ?1",
        )
        .bind(MODEL_NAME)
        .fetch_all(pool)
        .await?;
        let all = Arc::new(
            rows.into_iter()
                .map(|(id, source_id, blob)| StoredVector {
                    id,
                    source_id,
                    vector: from_blob(&blob),
                })
                .collect::<Vec<_>>(),
        );
        if self.vectors_version.load(Ordering::SeqCst) == version {
            self.slot.lock().unwrap().vectors = Some(all.clone());
        }
        Ok(all)
    }

    /// Embed every chunk that has no vector for the current model, a few at a
    /// time, calling `progress(done, total)` after each batch. A newer job (or
    /// `cancel_embedding`) stops this one at the next batch (`superseded`). A
    /// chunk deleted meanwhile is simply not updated, so nothing is written for
    /// a removed source.
    pub async fn embed_pending(
        self: &Arc<Self>,
        pool: &SqlitePool,
        mut progress: impl FnMut(usize, usize),
    ) -> Result<EmbedRun, String> {
        let job = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let result = self.embed_batches(pool, job, &mut progress).await;
        // The vectors changed. Dropping the search cache once per job (not per
        // batch) keeps searches during a long job from re-reading them all.
        self.invalidate_vectors();
        result.map(|embedded| EmbedRun {
            embedded,
            superseded: self.generation.load(Ordering::SeqCst) != job,
        })
    }

    async fn embed_batches(
        self: &Arc<Self>,
        pool: &SqlitePool,
        job: u64,
        progress: &mut impl FnMut(usize, usize),
    ) -> Result<usize, String> {
        let total: i64 = sqlx::query_scalar(PENDING_COUNT)
            .bind(MODEL_NAME)
            .fetch_one(pool)
            .await
            .map_err(|e| e.to_string())?;
        if total == 0 {
            return Ok(0);
        }
        let embedder = self.embedder().await?;
        let mut done = 0usize;
        while self.generation.load(Ordering::SeqCst) == job {
            let rows: Vec<(i64, String, String, String)> = sqlx::query_as(PENDING_BATCH)
                .bind(MODEL_NAME)
                .bind(BATCH)
                .fetch_all(pool)
                .await
                .map_err(|e| e.to_string())?;
            if rows.is_empty() {
                break;
            }
            let texts: Vec<String> = rows
                .iter()
                .map(|(_, title, heading, content)| passage_text(title, heading, content))
                .collect();
            let e = embedder.clone();
            let vectors = tokio::task::spawn_blocking(move || e.embed(&texts))
                .await
                .map_err(|e| e.to_string())??;
            self.touch();
            let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
            for ((id, ..), v) in rows.iter().zip(&vectors) {
                sqlx::query(
                    "UPDATE doc_chunks SET embedding = ?1, embedding_model = ?2 WHERE id = ?3",
                )
                .bind(to_blob(v))
                .bind(MODEL_NAME)
                .bind(id)
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
            }
            tx.commit().await.map_err(|e| e.to_string())?;
            done += rows.len();
            progress(done, total as usize);
        }
        Ok(done)
    }
}

/// How an embedding job ended.
#[derive(Debug)]
pub struct EmbedRun {
    #[cfg_attr(not(test), allow(dead_code))] // only the tests read the count
    pub embedded: usize,
    /// A newer job started, or semantic search was switched off, before it finished.
    pub superseded: bool,
}

const PENDING_COUNT: &str =
    "SELECT COUNT(*) FROM doc_chunks WHERE embedding IS NULL OR embedding_model IS NOT ?1";
const PENDING_BATCH: &str = "SELECT id, title, heading_path, content FROM doc_chunks
     WHERE embedding IS NULL OR embedding_model IS NOT ?1 ORDER BY id LIMIT ?2";

#[cfg(test)]
pub mod tests {
    use super::*;
    use crate::doc_search::index::{index_files, SourceFile};

    /// Two-dimensional "meaning": 1 = about time off, 0 = anything else.
    pub struct TopicEmbedder;

    impl Embedder for TopicEmbedder {
        fn embed(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
            Ok(texts
                .iter()
                .map(|t| {
                    if t.contains("holiday") || t.contains("time away") {
                        vec![1.0, 0.0]
                    } else {
                        vec![0.0, 1.0]
                    }
                })
                .collect())
        }
    }

    pub fn topic_engine(idle: Duration) -> Arc<Engine> {
        Engine::new(
            PathBuf::new(),
            Box::new(|| Ok(Arc::new(TopicEmbedder) as Arc<dyn Embedder>)),
            idle,
        )
    }

    pub async fn pool_with_chunks() -> (tempfile::TempDir, SqlitePool) {
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
        let files: Vec<SourceFile> = [
            (
                "leave.md",
                "# Leave\nStaff receive an annual holiday allowance.",
            ),
            ("deploy.md", "# Deploy\nThe pipeline runs on every merge."),
        ]
        .into_iter()
        .map(|(p, t)| SourceFile {
            path: p.into(),
            title: p.into(),
            text: t.into(),
            markdown: true,
        })
        .collect();
        index_files(&pool, "s", &files).await.unwrap();
        (dir, pool)
    }

    async fn embedded(pool: &SqlitePool) -> i64 {
        sqlx::query_scalar("SELECT COUNT(*) FROM doc_chunks WHERE embedding IS NOT NULL")
            .fetch_one(pool)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn embeds_pending_chunks_once_and_reports_progress() {
        let (_d, pool) = pool_with_chunks().await;
        let engine = topic_engine(IDLE_UNLOAD);
        let mut seen = vec![];
        let n = engine
            .embed_pending(&pool, |d, t| seen.push((d, t)))
            .await
            .unwrap();
        assert_eq!((n.embedded, embedded(&pool).await), (2, 2));
        assert!(!n.superseded);
        assert_eq!(seen, vec![(2, 2)]);
        // Nothing left to do the second time.
        assert_eq!(
            engine
                .embed_pending(&pool, |_, _| {})
                .await
                .unwrap()
                .embedded,
            0
        );
        // A vector from another model is stale and gets replaced.
        sqlx::query("UPDATE doc_chunks SET embedding_model = 'old' WHERE path = 'leave.md'")
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(
            engine
                .embed_pending(&pool, |_, _| {})
                .await
                .unwrap()
                .embedded,
            1
        );
    }

    #[tokio::test]
    async fn a_newer_job_stops_the_running_one() {
        let (_d, pool) = pool_with_chunks().await;
        let engine = topic_engine(IDLE_UNLOAD);
        let e = engine.clone();
        let n = engine
            .embed_pending(&pool, move |_, _| e.cancel_embedding())
            .await
            .unwrap();
        assert_eq!((n.embedded, n.superseded), (2, true)); // one batch holds both chunks
                                                           // With more chunks than one batch, the cancel stops it after the first.
        for i in 0..20 {
            sqlx::query(
                "INSERT INTO doc_chunks (source_id, path, title, heading_path, start_line, content)
                 VALUES ('s', 'm.md', 'm', '', ?1, 'filler')",
            )
            .bind(i)
            .execute(&pool)
            .await
            .unwrap();
        }
        let e = engine.clone();
        let n = engine
            .embed_pending(&pool, move |_, _| e.cancel_embedding())
            .await
            .unwrap();
        assert_eq!((n.embedded, n.superseded), (BATCH as usize, true));
    }

    #[tokio::test]
    async fn model_is_dropped_after_idling_and_reloaded_on_demand() {
        let engine = topic_engine(Duration::from_millis(40));
        engine.embedder().await.unwrap();
        assert!(engine.is_loaded());
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert!(!engine.is_loaded());
        engine.embedder().await.unwrap();
        assert!(engine.is_loaded());
    }

    #[tokio::test]
    async fn vectors_are_cached_until_invalidated() {
        let (_d, pool) = pool_with_chunks().await;
        let engine = topic_engine(IDLE_UNLOAD);
        engine.embed_pending(&pool, |_, _| {}).await.unwrap();
        let a = engine.vectors(&pool).await.unwrap();
        assert_eq!(a.len(), 2);
        assert!(Arc::ptr_eq(&a, &engine.vectors(&pool).await.unwrap()));
        engine.invalidate_vectors();
        assert!(!Arc::ptr_eq(&a, &engine.vectors(&pool).await.unwrap()));
    }

    #[tokio::test]
    async fn the_vector_cache_survives_batches_and_is_dropped_when_the_job_ends() {
        let (_d, pool) = pool_with_chunks().await;
        for i in 0..20 {
            sqlx::query(
                "INSERT INTO doc_chunks (source_id, path, title, heading_path, start_line, content)
                 VALUES ('s', 'm.md', 'm', '', ?1, 'filler')",
            )
            .bind(i)
            .execute(&pool)
            .await
            .unwrap();
        }
        let engine = topic_engine(IDLE_UNLOAD);
        engine.vectors(&pool).await.unwrap();
        assert!(engine.vectors_cached());
        let (e, mut batches) = (engine.clone(), 0);
        engine
            .embed_pending(&pool, |_, _| {
                batches += 1;
                assert!(e.vectors_cached(), "batch {batches} dropped the cache");
            })
            .await
            .unwrap();
        assert!(batches >= 2);
        assert!(!engine.vectors_cached());
    }

    #[tokio::test]
    async fn switching_off_while_the_model_loads_does_not_leave_it_loaded() {
        let engine = Engine::new(
            PathBuf::new(),
            Box::new(|| {
                std::thread::sleep(Duration::from_millis(150));
                Ok(Arc::new(TopicEmbedder) as Arc<dyn Embedder>)
            }),
            IDLE_UNLOAD,
        );
        let loading = tokio::spawn({
            let e = engine.clone();
            async move { e.embedder().await.map(|_| ()) }
        });
        tokio::time::sleep(Duration::from_millis(30)).await;
        engine.set_enabled(false);
        assert!(loading.await.unwrap().is_err());
        assert!(!engine.is_loaded());
        assert!(engine.embedder().await.is_err()); // still off
        engine.set_enabled(true);
        assert!(engine.embedder().await.is_ok());
    }

    #[tokio::test]
    async fn a_failed_load_is_not_retried_on_every_search() {
        use std::sync::atomic::AtomicUsize;
        let (_d, pool) = pool_with_chunks().await;
        topic_engine(IDLE_UNLOAD)
            .embed_pending(&pool, |_, _| {})
            .await
            .unwrap(); // vectors are in the database
        let calls = Arc::new(AtomicUsize::new(0));
        let c = calls.clone();
        let broken = Engine::new(
            PathBuf::new(),
            Box::new(move || {
                c.fetch_add(1, Ordering::SeqCst);
                Err("model file missing".into())
            }),
            IDLE_UNLOAD,
        );
        for _ in 0..3 {
            let r = crate::doc_search::search::search_hybrid(
                &pool,
                Some(&broken),
                "holiday",
                None,
                None,
                5,
            )
            .await
            .unwrap();
            assert_eq!(r.mode, crate::doc_search::search::SearchMode::Keyword);
        }
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        // Without a model the vectors are never read into memory.
        assert!(!broken.vectors_cached());
    }

    /// Needs the real model (`npm run fetch-model`):
    /// `cargo test --release real_model_end_to_end -- --ignored --nocapture`
    #[tokio::test]
    #[ignore]
    async fn real_model_end_to_end() {
        use crate::doc_search::search::search_hybrid;
        let (_d, pool) = pool_with_chunks().await; // two tiny docs, replaced below
        sqlx::query("DELETE FROM doc_chunks")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM doc_indexed_files")
            .execute(&pool)
            .await
            .unwrap();
        let docs = [
            ("leave.md", "# Time off\n## Annual leave\nEvery employee gets twenty paid days of vacation per year. Requests go to your manager at least two weeks ahead."),
            ("deploy.md", "# Releases\n## Deploying\nThe pipeline builds and ships to production on every merge to main. Rollbacks are one click in the dashboard."),
            ("expenses.md", "# Expenses\n## Reimbursement\nSubmit receipts within thirty days. Meals while travelling are covered up to fifty dollars a day."),
            ("oncall.md", "# On-call\n## Rotation\nEngineers take the pager one week in six. Handover happens Monday at ten."),
        ];
        let files: Vec<SourceFile> = docs
            .iter()
            .map(|(p, t)| SourceFile {
                path: p.to_string(),
                title: p.to_string(),
                text: t.to_string(),
                markdown: true,
            })
            .collect();
        index_files(&pool, "s", &files).await.unwrap();
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("models")
            .join("bge-base-en-v1.5");
        let engine = Engine::bge(dir);
        let t = Instant::now();
        engine.embed_pending(&pool, |_, _| {}).await.unwrap();
        println!("embedded 4 docs (incl. model load) in {:?}", t.elapsed());
        for (q, want) in [
            ("how much holiday do I get", "leave.md"),
            ("undo a bad release", "deploy.md"),
            (
                "can I claim back my lunch on a business trip",
                "expenses.md",
            ),
            ("who is carrying the pager", "oncall.md"),
        ] {
            let t = Instant::now();
            let r = search_hybrid(&pool, Some(&engine), q, None, None, 5)
                .await
                .unwrap();
            println!(
                "{q:?} -> {:?} in {:?}",
                r.hits.iter().map(|h| h.path.as_str()).collect::<Vec<_>>(),
                t.elapsed()
            );
            assert_eq!(r.hits[0].path, want, "{q}");
        }
    }
}
