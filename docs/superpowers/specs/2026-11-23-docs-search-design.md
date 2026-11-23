# Docs Search (keyword + semantic) — Design

Search across all Docs sources (local folders, GitHub, ClickUp) from the Docs page
and the command palette. Local-first, no external daemon.

## Decisions

- **Keyword search:** SQLite FTS5 (already compiled into bundled SQLite via `sqlx`). Always on, works with no model.
- **Semantic search:** `BGE-base-en-v1.5` (768-dim, 512-token limit, English only) run in-process with **`candle`** (`candle-core`, `candle-nn`, `candle-transformers` BERT, plus `tokenizers` with the pure-Rust `fancy-regex` feature). Pure Rust, so it builds the same on macOS and Linux with no native ML library. No Ollama / llama-server, no `fastembed`. BGE uses CLS pooling, then L2-normalize.
- **Toggle:** Settings → Docs has a "Semantic search" switch (setting `docs_semantic_search`, default **on**). Off → keyword only, model never loaded, vectors not computed.
- **Fallback if accuracy is not good enough:** switch to Qwen3-Embedding-0.6B (also in `candle-transformers`). Only the embedder module changes; chunks are re-embedded via Reindex.
- **Ranking:** BM25 and cosine results merged with Reciprocal Rank Fusion. Keyword hits are always included, so a model miss cannot hide an exact match.
- **Vectors:** stored as `BLOB` in SQLite, scanned in Rust (no `sqlite-vec`). Cached in memory only while the model is loaded.
- **Model lifecycle:** model loads on first search/index, unloads after 5 idle minutes (drop it; a timer task checks `last_used`). Loading takes ~1 s; keyword results return immediately while it loads.
- **Model files stay inside the project.** They live in `src-tauri/models/bge-base-en-v1.5/` (`config.json`, `tokenizer.json`, `model.safetensors`, ~440 MB), are **gitignored**, and are fetched once by `npm run fetch-model` (`scripts/fetch-search-model.mjs`, from Hugging Face). `tauri.conf.json` lists the folder under `bundle.resources`, so the installer ships it and the app reads it from the resource dir. The app never downloads anything at runtime and writes nothing outside the project/app data. Model missing → keyword only.
- **Installer size** grows by ~440 MB (accepted).

## Data (migration `0045_docs_search.sql`)

- `doc_indexed_files(source_id, path, content_hash, indexed_at)` — skip unchanged files.
- `doc_chunks(id, source_id, path, title, heading_path, start_line, content, embedding BLOB NULL, embedding_model TEXT NULL)` — dimension is implied by the model.
- `doc_chunks_fts` — FTS5 external-content table over `title, heading_path, content` (`porter unicode61`), kept in sync by insert/delete/update triggers.
- No foreign keys (the app runs with them off); deletes are explicit and transactional, as in `remove_docs_source`.

## Chunking

- Split Markdown on headings, keep a `heading_path` breadcrumb and `start_line`; ignore `#` inside fenced code blocks.
- Target **150–300 words** per chunk so each fits BGE's 512-token limit; merge tiny sections, split large ones on paragraph breaks with a small overlap.
- Embedded text is `# <title>\nSection: <heading_path>\n\n<content>`.
- `.txt`: split by paragraph window. PDFs: skipped in v1 (not an error).

## Indexing

- Sources: local files via `local_docs`, GitHub/ClickUp via cached `docs_files.content`.
- Per file: hash content; unchanged and already embedded with the current model → skip. Remove chunks of deleted files.
- Write chunks (FTS) first so keyword search works immediately, then embed in batches of 16–32 and update the `embedding` column.
- Runs in a background task with progress events and a generation guard (same `AtomicU64` pattern as sync). A run that finishes after its source was removed writes nothing (same rule as `replace_docs`).
- Triggers: after GitHub/ClickUp sync, after local rescan, and a manual **Reindex** button. File watcher is out of scope.

## Search

1. Sanitize the query for FTS5 (so `c++`, `1-1s`, quotes never error); top 30 by `bm25(title 3, heading 2, content 1)`.
2. If the model is available: embed the query (BGE prefix `Represent this sentence for searching relevant passages: `; chunks get no prefix), cosine against cached vectors for the current model, top 30.
3. RRF: `1/(60+rank_fts) + 1.2/(60+rank_vec)`. Group hits by file, show best section plus a count of other matches.
4. Response carries `mode: "keyword" | "hybrid"`. Model not downloaded, still loading, or errored → keyword only.

## Commands (all call `state.require(ModuleId::Docs)?` first)

`search_docs(query, source_id?, limit?)`, `reindex_docs(source_id?)`, `docs_index_status()`, `get_semantic_search()` / `set_semantic_search(enabled)`.
Add to `generate_handler!`, `lib/commands.ts`, and the module guard-coverage list.

## Cleanup

Delete `doc_chunks` + `doc_indexed_files` rows in the same transaction as: `remove_docs_source`, `wipe_clickup_cache`, and Docs module-data removal. Rescan/sync purges chunks of vanished files.

## Frontend

- `DocsPage`: search box above the tree; hits show title, breadcrumb, snippet; click opens the doc at `start_line`.
- `CommandPalette`: doc results; keyword on each keystroke, hybrid after ~200 ms debounce.
- `DocsSection` (Settings): per-source "N chunks · keyword/hybrid", the Semantic search toggle, model present/missing status, Reindex.
- Use TanStack Query and `goey-toast`; no new visual patterns.

## Phases (each builds and runs on its own)

1. **Keyword:** migration, chunker, indexer, FTS search, commands, Docs page + palette UI, cleanup.
2. **Semantic:** embedder (fastembed, idle unload, download), vector cache, RRF, status/Reindex UI.

## Tests

Chunker (headings, fenced code, `start_line`, size limits); FTS query sanitizing; RRF ordering and keyword fallback; indexer skips unchanged files and leaves no orphan rows after source removal; embedder normalizes vectors and applies the prefix to queries only (using a fake embedder, no model download in tests).

## Risks / open

- candle is slower than ONNX on CPU; first full index may take minutes. Query latency of 1–2 s is accepted. Unmeasured; Linux office laptop untested until tried there.
- BGE-base quality on real company docs is unmeasured; Qwen3 is the planned upgrade.
- `npm run fetch-model` needs internet once per checkout/CI build.
