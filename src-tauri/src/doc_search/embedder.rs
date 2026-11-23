//! Local text embeddings for semantic docs search: BGE-base-en-v1.5 run
//! in-process with candle (pure Rust, same build on macOS/Linux/Windows).
//!
//! BGE uses CLS pooling then L2-normalisation, so cosine similarity of two
//! vectors is just their dot product. Queries get an instruction prefix;
//! passages (chunks) do not.

use candle_core::{Device, Tensor};
use candle_nn::VarBuilder;
use candle_transformers::models::bert::{BertModel, Config, DTYPE};
use std::path::Path;
use tokenizers::{PaddingParams, Tokenizer, TruncationParams};

/// Stored next to each vector so a model change re-embeds the chunk.
pub const MODEL_NAME: &str = "bge-base-en-v1.5";
pub const MODEL_DIR: &str = "bge-base-en-v1.5";
pub const QUERY_PREFIX: &str = "Represent this sentence for searching relevant passages: ";
const MAX_TOKENS: usize = 512;

/// Turns texts into unit-length vectors. Blocking; call from a worker thread.
pub trait Embedder: Send + Sync {
    fn embed(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, String>;
}

/// Embeds a search query (with the BGE instruction prefix).
pub fn embed_query(e: &dyn Embedder, query: &str) -> Result<Vec<f32>, String> {
    let text = format!("{QUERY_PREFIX}{query}");
    e.embed(&[text])?
        .pop()
        .ok_or_else(|| "empty embedding".to_string())
}

/// The text embedded for a chunk (no query prefix).
pub fn passage_text(title: &str, heading_path: &str, content: &str) -> String {
    format!("# {title}\nSection: {heading_path}\n\n{content}")
}

pub struct BgeEmbedder {
    model: BertModel,
    tokenizer: Tokenizer,
    device: Device,
    /// CPU only: a bounded thread pool, so embedding leaves cores free for the
    /// UI and other apps. `None` on a GPU, where the cores are not the bottleneck.
    pool: Option<rayon::ThreadPool>,
}

/// How many CPU threads embedding may use: half the cores, at least one.
fn cpu_threads() -> usize {
    (std::thread::available_parallelism().map_or(2, |n| n.get()) / 2).max(1)
}

/// The GPU if there is a usable one (Apple Metal), else the CPU. `true` = GPU.
fn pick_device() -> (Device, bool) {
    #[cfg(target_os = "macos")]
    if let Ok(d) = Device::new_metal(0) {
        return (d, true);
    }
    (Device::Cpu, false)
}

impl BgeEmbedder {
    /// Loads `config.json`, `tokenizer.json` and `model.safetensors` from `dir`,
    /// onto the GPU when there is one (checked with a trial run), else the CPU.
    pub fn load(dir: &Path) -> Result<Self, String> {
        let (device, gpu) = pick_device();
        if gpu {
            if let Ok(e) = Self::build(dir, device, true).and_then(|e| e.warm_up()) {
                return Ok(e);
            }
        }
        Self::build(dir, Device::Cpu, false)
    }

    fn build(dir: &Path, device: Device, gpu: bool) -> Result<Self, String> {
        let err = |what: &str, e: &dyn std::fmt::Display| format!("{what}: {e}");
        let config: Config = serde_json::from_slice(
            &std::fs::read(dir.join("config.json")).map_err(|e| err("config.json", &e))?,
        )
        .map_err(|e| err("config.json", &e))?;
        let mut tokenizer = Tokenizer::from_file(dir.join("tokenizer.json"))
            .map_err(|e| err("tokenizer.json", &e))?;
        tokenizer.with_padding(Some(PaddingParams::default()));
        tokenizer
            .with_truncation(Some(TruncationParams {
                max_length: MAX_TOKENS,
                ..Default::default()
            }))
            .map_err(|e| err("tokenizer", &e))?;
        let weights = candle_core::safetensors::load(dir.join("model.safetensors"), &device)
            .map_err(|e| err("model.safetensors", &e))?;
        let model = BertModel::load(VarBuilder::from_tensors(weights, DTYPE, &device), &config)
            .map_err(|e| err("model", &e))?;
        let pool = if gpu {
            None
        } else {
            Some(
                rayon::ThreadPoolBuilder::new()
                    .num_threads(cpu_threads())
                    .thread_name(|i| format!("docs-embed-{i}"))
                    .build()
                    .map_err(|e| err("thread pool", &e))?,
            )
        };
        Ok(Self {
            model,
            tokenizer,
            device,
            pool,
        })
    }

    /// One trial embedding, to find out early that a GPU can't run the model.
    fn warm_up(self) -> Result<Self, String> {
        let v = self.embed(&["warm up".to_string()])?;
        if v.iter().flatten().all(|x| x.is_finite()) {
            Ok(self)
        } else {
            Err("non-finite output".into())
        }
    }

    fn run(&self, texts: &[String]) -> candle_core::Result<Vec<Vec<f32>>> {
        let encoded = self
            .tokenizer
            .encode_batch(texts.to_vec(), true)
            .map_err(|e| candle_core::Error::Msg(e.to_string()))?;
        let rows = encoded.len();
        let cols = encoded.first().map_or(0, |e| e.get_ids().len());
        let ids: Vec<u32> = encoded.iter().flat_map(|e| e.get_ids().to_vec()).collect();
        let mask: Vec<u32> = encoded
            .iter()
            .flat_map(|e| e.get_attention_mask().to_vec())
            .collect();
        let ids = Tensor::from_vec(ids, (rows, cols), &self.device)?;
        let mask = Tensor::from_vec(mask, (rows, cols), &self.device)?;
        let out = self.model.forward(&ids, &ids.zeros_like()?, Some(&mask))?;
        // CLS pooling: the first token's hidden state.
        let mut vectors = out.narrow(1, 0, 1)?.squeeze(1)?.to_vec2::<f32>()?;
        vectors.iter_mut().for_each(|v| l2_normalize(v));
        Ok(vectors)
    }
}

impl Embedder for BgeEmbedder {
    fn embed(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
        if texts.is_empty() {
            return Ok(Vec::new());
        }
        match &self.pool {
            Some(pool) => pool.install(|| self.run(texts)),
            None => self.run(texts),
        }
        .map_err(|e| e.to_string())
    }
}

/// A vector as stored in `doc_chunks.embedding` (little-endian f32s).
pub fn to_blob(v: &[f32]) -> Vec<u8> {
    v.iter().flat_map(|x| x.to_le_bytes()).collect()
}

pub fn from_blob(b: &[u8]) -> Vec<f32> {
    b.as_chunks::<4>()
        .0
        .iter()
        .map(|c| f32::from_le_bytes(*c))
        .collect()
}

fn l2_normalize(v: &mut [f32]) {
    let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm > 0.0 {
        v.iter_mut().for_each(|x| *x /= norm);
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use std::sync::Mutex;

    /// Records what it was asked to embed; returns a fixed vector per text.
    #[derive(Default)]
    pub struct FakeEmbedder {
        pub seen: Mutex<Vec<String>>,
    }

    impl Embedder for FakeEmbedder {
        fn embed(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
            self.seen.lock().unwrap().extend(texts.iter().cloned());
            Ok(texts.iter().map(|_| vec![1.0, 0.0]).collect())
        }
    }

    #[test]
    fn query_gets_the_prefix_and_passages_do_not() {
        let fake = FakeEmbedder::default();
        embed_query(&fake, "vacation policy").unwrap();
        let text = passage_text("Handbook", "Leave > Vacation", "Ten days.");
        fake.embed(std::slice::from_ref(&text)).unwrap();
        let seen = fake.seen.lock().unwrap();
        assert_eq!(
            seen[0],
            "Represent this sentence for searching relevant passages: vacation policy"
        );
        assert_eq!(
            seen[1],
            "# Handbook\nSection: Leave > Vacation\n\nTen days."
        );
    }

    #[test]
    fn blob_round_trips() {
        let v = vec![0.5, -1.25, 3.0];
        assert_eq!(from_blob(&to_blob(&v)), v);
    }

    #[test]
    fn normalizing_gives_unit_length_and_leaves_zero_alone() {
        let mut v = vec![3.0, 4.0];
        l2_normalize(&mut v);
        assert!((v[0] - 0.6).abs() < 1e-6 && (v[1] - 0.8).abs() < 1e-6);
        let mut zero = vec![0.0, 0.0];
        l2_normalize(&mut zero);
        assert_eq!(zero, vec![0.0, 0.0]);
    }

    /// Needs the real model: `npm run fetch-model`, then
    /// `cargo test --manifest-path src-tauri/Cargo.toml real_model -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn real_model_ranks_the_relevant_passage_first() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("models")
            .join(MODEL_DIR);
        let e = BgeEmbedder::load(&dir).unwrap();
        let passages = [
            "Employees receive twenty days of paid vacation each year.",
            "The deployment pipeline runs on every merge to main.",
        ]
        .map(String::from);
        let started = std::time::Instant::now();
        let vecs = e.embed(&passages).unwrap();
        println!("embedded 2 passages in {:?}", started.elapsed());
        let q = embed_query(&e, "how many days off do I get?").unwrap();
        let dot = |a: &[f32], b: &[f32]| a.iter().zip(b).map(|(x, y)| x * y).sum::<f32>();
        assert_eq!(q.len(), 768);
        assert!((dot(&q, &q) - 1.0).abs() < 1e-4);
        assert!(dot(&q, &vecs[0]) > dot(&q, &vecs[1]));
    }
}
