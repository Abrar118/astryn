# Docs Viewer (F-Docs) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a two-pane **Docs** page that browses the private `GAM-Health-Solutions/core-psycloud-docs` markdown repo — a hierarchical tree on the left, a Milkdown read-only renderer on the right — backed by an offline SQLite cache.

**Architecture:** Rust fetches the repo's recursive git tree (REST) and each markdown file's text (GraphQL), upserts both into a `docs_files` cache table, and exposes typed Tauri commands. React consumes them via TanStack Query, builds the nested tree client-side, and renders the selected file with a read-only Milkdown instance. Reuses the existing GitHub PAT (`github_token`), the `*_logic` + injected-closure command pattern, and the view-registration seam used by the PRs/Slack pages.

**Tech Stack:** Rust (`sqlx`/SQLite, `reqwest`, `tokio`, `serde_json`, `time`), Tauri v2 commands, React + TypeScript (strict), TanStack Query, Milkdown 7.21 (`@milkdown/kit` + `@milkdown/react`), Vitest, `cargo test`.

## Global Constraints

- **All external API calls live in Rust, never the webview.** The token never crosses to TS; React only calls Tauri commands. (`requirements.md` §3)
- **Sanitized errors only.** Commands return `Result<T, CmdError>`; never leak reqwest/GraphQL/keyring diagnostics. GraphQL `errors` on HTTP 200 are failures (handled by the existing `extract_data`).
- **Offline-first.** The page opens and renders from the SQLite cache with no network; sync refreshes it.
- **All sync/error feedback via `goey-toast`** (imports `gooeyToast` from `goey-toast`). Do not substitute another toast lib.
- **Reuse the existing GitHub credential.** Keychain account `github_token`, sent as `Bearer <token>` (already wired via `PatProvider`). No new secret.
- **Source is hardcoded:** owner `GAM-Health-Solutions`, repo `core-psycloud-docs`, branch `main`.
- **Tailwind v4 (CSS-first), dark-first Linear look.** No `tailwind.config.js`.
- **TS is strict** with `noUnusedLocals`/`noUnusedParameters` — unused symbols fail the build.
- **Migrations** live in `src-tauri/migrations/` and run on startup via `sqlx::migrate!("./migrations")` (auto-discovers numbered `.sql` files). Only create tables this milestone uses.
- Rust commands run via `cargo test --manifest-path src-tauri/Cargo.toml`; do not `cd` into `src-tauri`.

## File Structure

**Rust (create):**
- `src-tauri/migrations/0014_docs.sql` — `docs_files` + `docs_sync_meta` tables.
- `src-tauri/src/db/docs.rs` — cache read/write helpers + row structs.
- `src-tauri/src/github/docs.rs` — pure parsers + repo constants + GraphQL/REST request builders.
- `src-tauri/src/commands/docs.rs` — `*_logic` fns + `#[tauri::command]` wrappers.

**Rust (modify):**
- `src-tauri/src/github/mod.rs` — add `pub mod docs;` + a `GitHubClient::rest_get` method.
- `src-tauri/src/db/mod.rs` — add `pub mod docs;` + a migration test.
- `src-tauri/src/commands/mod.rs` — add `pub mod docs;`.
- `src-tauri/src/lib.rs` — register the 4 docs commands in `generate_handler!`.

**Frontend (create):**
- `src/features/docs/docsTree.ts` + `src/features/docs/docsTree.test.ts` — pure tree building/labels.
- `src/features/docs/DocViewer.tsx` — read-only Milkdown.
- `src/features/docs/DocsTree.tsx` — collapsible tree sidebar.
- `src/features/docs/DocsPage.tsx` — the page.

**Frontend (modify):**
- `src/lib/commands.ts` — typed bindings + types.
- `src/lib/queries.ts` — query hooks.
- `src/lib/paneModel.ts` — `"docs"` in `ViewKind` + `VIEWS`.
- `src/components/Dock.tsx` — dock nav entry.
- `src/components/SplitLayout.tsx` — `PaneContent` case.
- `src/components/PaneTabStrip.tsx` — tab `META` entry.

---

### Task 1: Docs cache migration

**Files:**
- Create: `src-tauri/migrations/0014_docs.sql`
- Modify: `src-tauri/src/db/mod.rs` (add test)
- Test: `src-tauri/src/db/mod.rs` (`migration_creates_docs_tables`)

**Interfaces:**
- Produces: tables `docs_files(path PK, name, kind, parent_path, sha, content, synced_at)` and `docs_sync_meta(id PK=1, last_synced_at, file_count, tree_sha, truncated)`.

- [ ] **Step 1: Write the migration**

Create `src-tauri/migrations/0014_docs.sql`:

```sql
-- Cached docs tree + file contents from GAM-Health-Solutions/core-psycloud-docs.
-- The whole tree is replaced on each sync (single source, no buckets).
CREATE TABLE docs_files (
  path         TEXT PRIMARY KEY,          -- repo-relative, e.g. "02-technical/backend/README.md"
  name         TEXT NOT NULL,             -- basename
  kind         TEXT NOT NULL,             -- 'blob' (file) | 'tree' (folder)
  parent_path  TEXT NOT NULL DEFAULT '',  -- '' for top-level
  sha          TEXT NOT NULL,
  content      TEXT,                      -- markdown text; NULL for folders
  synced_at    TEXT NOT NULL
);
CREATE INDEX idx_docs_files_parent ON docs_files(parent_path);

-- Single-row sync metadata so staleness/truncation survive restart.
CREATE TABLE docs_sync_meta (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  last_synced_at TEXT,
  file_count     INTEGER NOT NULL DEFAULT 0,
  tree_sha       TEXT,
  truncated      INTEGER NOT NULL DEFAULT 0
);
```

- [ ] **Step 2: Add the migration test**

In `src-tauri/src/db/mod.rs`, inside `mod tests`, after `migration_creates_github_tables`, add:

```rust
    #[tokio::test]
    async fn migration_creates_docs_tables() {
        let (_dir, pool) = temp_pool().await;
        let files: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM docs_files")
            .fetch_one(&pool)
            .await
            .unwrap();
        let meta: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM docs_sync_meta")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!((files.0, meta.0), (0, 0));
    }
```

- [ ] **Step 3: Run the test (verifies migration applies)**

Run: `cargo test --manifest-path src-tauri/Cargo.toml migration_creates_docs_tables`
Expected: PASS (1 test).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/migrations/0014_docs.sql src-tauri/src/db/mod.rs
git commit -m "feat(docs): add docs_files + docs_sync_meta cache tables"
```

---

### Task 2: Docs DB cache helpers

**Files:**
- Create: `src-tauri/src/db/docs.rs`
- Modify: `src-tauri/src/db/mod.rs` (add `pub mod docs;`)
- Test: `src-tauri/src/db/docs.rs` (inline `mod tests`)

**Interfaces:**
- Consumes: tables from Task 1.
- Produces:
  - `pub struct DocFile { pub path: String, pub name: String, pub kind: String, pub parent_path: String, pub sha: String, pub content: Option<String> }`
  - `pub struct DocNode { pub path: String, pub name: String, pub kind: String, pub parent_path: String }` (serde camelCase)
  - `pub struct DocsMeta { pub last_synced_at: Option<String>, pub file_count: i64, pub truncated: bool }` (serde camelCase)
  - `pub async fn replace_docs(pool, files: &[DocFile], synced_at: &str, tree_sha: Option<&str>, truncated: bool) -> Result<(), sqlx::Error>`
  - `pub async fn list_docs(pool) -> Result<Vec<DocNode>, sqlx::Error>`
  - `pub async fn load_doc_content(pool, path: &str) -> Result<Option<String>, sqlx::Error>`
  - `pub async fn load_docs_meta(pool) -> Result<Option<DocsMeta>, sqlx::Error>`

- [ ] **Step 1: Register the module**

In `src-tauri/src/db/mod.rs`, under the existing `pub mod github;`, add:

```rust
pub mod docs;
```

- [ ] **Step 2: Write the failing tests**

Create `src-tauri/src/db/docs.rs` with the test module first (the helpers come next):

```rust
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

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DocsMeta {
    pub last_synced_at: Option<String>,
    pub file_count: i64,
    pub truncated: bool,
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

    fn dir(path: &str, parent: &str) -> DocFile {
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
    async fn replace_docs_stores_tree_and_meta() {
        let (_d, pool) = pool().await;
        let files = vec![
            dir("02-technical", ""),
            file("02-technical/README.md", "02-technical", "# Tech"),
            file("README.md", "", "# Root"),
        ];
        replace_docs(&pool, &files, "now", Some("treesha"), false)
            .await
            .unwrap();

        let nodes = list_docs(&pool).await.unwrap();
        assert_eq!(nodes.len(), 3);

        assert_eq!(
            load_doc_content(&pool, "02-technical/README.md")
                .await
                .unwrap()
                .as_deref(),
            Some("# Tech")
        );
        // Folders carry no content.
        assert_eq!(load_doc_content(&pool, "02-technical").await.unwrap(), None);

        let meta = load_docs_meta(&pool).await.unwrap().unwrap();
        assert_eq!(meta.file_count, 2); // two blobs
        assert_eq!(meta.truncated, false);
        assert_eq!(meta.last_synced_at.as_deref(), Some("now"));
    }

    #[tokio::test]
    async fn replace_docs_prunes_old_entries() {
        let (_d, pool) = pool().await;
        replace_docs(&pool, &[file("a.md", "", "a")], "t1", None, false)
            .await
            .unwrap();
        replace_docs(&pool, &[file("b.md", "", "b")], "t2", None, true)
            .await
            .unwrap();
        let nodes = list_docs(&pool).await.unwrap();
        assert_eq!(nodes.len(), 1);
        assert_eq!(nodes[0].path, "b.md");
        // Stale file is gone, meta updated (single row).
        assert_eq!(load_doc_content(&pool, "a.md").await.unwrap(), None);
        assert_eq!(load_docs_meta(&pool).await.unwrap().unwrap().truncated, true);
    }

    #[tokio::test]
    async fn meta_is_none_before_first_sync() {
        let (_d, pool) = pool().await;
        assert!(load_docs_meta(&pool).await.unwrap().is_none());
        assert!(list_docs(&pool).await.unwrap().is_empty());
    }
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml db::docs`
Expected: FAIL — `cannot find function replace_docs`/`list_docs`/`load_doc_content`/`load_docs_meta`.

- [ ] **Step 4: Implement the helpers**

In `src-tauri/src/db/docs.rs`, insert the following **between** the struct definitions and the `#[cfg(test)] mod tests`:

```rust
/// Replace the entire docs cache (delete all rows, insert the fetched set) and
/// upsert the single metadata row, in one transaction so a partial write never
/// leaves a half-empty tree.
pub async fn replace_docs(
    pool: &SqlitePool,
    files: &[DocFile],
    synced_at: &str,
    tree_sha: Option<&str>,
    truncated: bool,
) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM docs_files").execute(&mut *tx).await?;
    for f in files {
        sqlx::query(
            "INSERT INTO docs_files (path, name, kind, parent_path, sha, content, synced_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )
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
        "INSERT INTO docs_sync_meta (id, last_synced_at, file_count, tree_sha, truncated)
         VALUES (1, ?1, ?2, ?3, ?4)
         ON CONFLICT(id) DO UPDATE SET
           last_synced_at = excluded.last_synced_at,
           file_count     = excluded.file_count,
           tree_sha       = excluded.tree_sha,
           truncated      = excluded.truncated",
    )
    .bind(synced_at)
    .bind(file_count)
    .bind(tree_sha)
    .bind(truncated)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

/// All cached entries (folders + files), lightweight (no content). The frontend
/// nests them into a tree.
pub async fn list_docs(pool: &SqlitePool) -> Result<Vec<DocNode>, sqlx::Error> {
    sqlx::query_as::<_, DocNode>(
        "SELECT path, name, kind, parent_path FROM docs_files ORDER BY path",
    )
    .fetch_all(pool)
    .await
}

/// The cached markdown for one file (`None` if the path is unknown or a folder).
pub async fn load_doc_content(pool: &SqlitePool, path: &str) -> Result<Option<String>, sqlx::Error> {
    let row: Option<(Option<String>,)> =
        sqlx::query_as("SELECT content FROM docs_files WHERE path = ?1 AND kind = 'blob'")
            .bind(path)
            .fetch_optional(pool)
            .await?;
    Ok(row.and_then(|r| r.0))
}

/// The single sync-metadata row (`None` before the first sync).
pub async fn load_docs_meta(pool: &SqlitePool) -> Result<Option<DocsMeta>, sqlx::Error> {
    sqlx::query_as::<_, DocsMeta>(
        "SELECT last_synced_at, file_count, truncated FROM docs_sync_meta WHERE id = 1",
    )
    .fetch_optional(pool)
    .await
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml db::docs`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/db/docs.rs src-tauri/src/db/mod.rs
git commit -m "feat(docs): add docs cache read/write helpers"
```

---

### Task 3: GitHub docs parsers + request builders

**Files:**
- Create: `src-tauri/src/github/docs.rs`
- Modify: `src-tauri/src/github/mod.rs` (add `pub mod docs;`)
- Test: `src-tauri/src/github/docs.rs` (inline `mod tests`)

**Interfaces:**
- Consumes: `crate::github::GitHubError`.
- Produces:
  - `pub struct RawEntry { pub path: String, pub kind: String, pub sha: String }`
  - `pub const DOCS_OWNER/DOCS_REPO/DOCS_BRANCH: &str`
  - `pub fn tree_path() -> String`
  - `pub fn is_markdown(path: &str) -> bool`
  - `pub fn basename(path: &str) -> &str`
  - `pub fn parent_path(path: &str) -> &str`
  - `pub fn parse_tree(data: &serde_json::Value) -> Result<(Vec<RawEntry>, bool), GitHubError>`
  - `pub fn content_query_body(path: &str) -> serde_json::Value`
  - `pub fn parse_blob_text(data: &serde_json::Value) -> Result<String, GitHubError>`

- [ ] **Step 1: Register the module**

In `src-tauri/src/github/mod.rs`, at the top with the other `pub mod` lines, add:

```rust
pub mod docs;
```

- [ ] **Step 2: Write the failing tests**

Create `src-tauri/src/github/docs.rs`:

```rust
use serde_json::Value;

use super::GitHubError;

pub const DOCS_OWNER: &str = "GAM-Health-Solutions";
pub const DOCS_REPO: &str = "core-psycloud-docs";
pub const DOCS_BRANCH: &str = "main";

#[derive(Debug, Clone, PartialEq)]
pub struct RawEntry {
    pub path: String,
    pub kind: String, // "blob" | "tree"
    pub sha: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn markdown_detection_is_case_insensitive() {
        assert!(is_markdown("a/b.md"));
        assert!(is_markdown("README.MD"));
        assert!(!is_markdown("a/b.png"));
        assert!(!is_markdown("a/b"));
    }

    #[test]
    fn basename_and_parent_split_paths() {
        assert_eq!(basename("02-technical/backend/README.md"), "README.md");
        assert_eq!(parent_path("02-technical/backend/README.md"), "02-technical/backend");
        assert_eq!(basename("README.md"), "README.md");
        assert_eq!(parent_path("README.md"), "");
    }

    #[test]
    fn tree_path_targets_recursive_default_branch() {
        assert_eq!(
            tree_path(),
            "/repos/GAM-Health-Solutions/core-psycloud-docs/git/trees/main?recursive=1"
        );
    }

    #[test]
    fn parse_tree_extracts_entries_and_truncated() {
        let data = serde_json::json!({
            "tree": [
                { "path": "00-overview", "type": "tree", "sha": "t1" },
                { "path": "00-overview/intro.md", "type": "blob", "sha": "b1" },
                { "path": "weird", "type": "commit" }  // missing sha → skipped
            ],
            "truncated": true
        });
        let (entries, truncated) = parse_tree(&data).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[1], RawEntry { path: "00-overview/intro.md".into(), kind: "blob".into(), sha: "b1".into() });
        assert!(truncated);
    }

    #[test]
    fn parse_tree_missing_array_is_malformed() {
        assert!(matches!(parse_tree(&serde_json::json!({})), Err(GitHubError::Malformed)));
    }

    #[test]
    fn content_query_body_binds_branch_scoped_expression() {
        let body = content_query_body("a/b.md");
        assert_eq!(body["variables"]["expr"], "main:a/b.md");
        assert_eq!(body["variables"]["owner"], "GAM-Health-Solutions");
        assert!(body["query"].as_str().unwrap().contains("on Blob"));
    }

    #[test]
    fn parse_blob_text_reads_text() {
        let data = serde_json::json!({ "repository": { "object": { "text": "# Hi" } } });
        assert_eq!(parse_blob_text(&data).unwrap(), "# Hi");
    }

    #[test]
    fn parse_blob_text_null_object_is_empty() {
        let data = serde_json::json!({ "repository": { "object": Value::Null } });
        assert_eq!(parse_blob_text(&data).unwrap(), "");
    }
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml github::docs`
Expected: FAIL — `cannot find function is_markdown` (etc.).

- [ ] **Step 4: Implement the parsers**

In `src-tauri/src/github/docs.rs`, insert between the `RawEntry` struct and `#[cfg(test)] mod tests`:

```rust
/// REST path for the recursive git tree of the docs repo's default branch.
pub fn tree_path() -> String {
    format!("/repos/{DOCS_OWNER}/{DOCS_REPO}/git/trees/{DOCS_BRANCH}?recursive=1")
}

/// True for a markdown file path (case-insensitive `.md`).
pub fn is_markdown(path: &str) -> bool {
    path.to_ascii_lowercase().ends_with(".md")
}

/// Last path segment.
pub fn basename(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

/// Parent directory path (`""` for a top-level entry).
pub fn parent_path(path: &str) -> &str {
    match path.rfind('/') {
        Some(i) => &path[..i],
        None => "",
    }
}

/// Parse a `git/trees?recursive=1` response into entries + the `truncated` flag.
/// Entries missing path/type/sha are skipped (e.g. submodule `commit` rows).
pub fn parse_tree(data: &Value) -> Result<(Vec<RawEntry>, bool), GitHubError> {
    let arr = data
        .get("tree")
        .and_then(|t| t.as_array())
        .ok_or(GitHubError::Malformed)?;
    let mut out = Vec::new();
    for e in arr {
        let path = e.get("path").and_then(|p| p.as_str());
        let kind = e.get("type").and_then(|p| p.as_str());
        let sha = e.get("sha").and_then(|p| p.as_str());
        if let (Some(path), Some(kind), Some(sha)) = (path, kind, sha) {
            out.push(RawEntry {
                path: path.to_string(),
                kind: kind.to_string(),
                sha: sha.to_string(),
            });
        }
    }
    let truncated = data
        .get("truncated")
        .and_then(|t| t.as_bool())
        .unwrap_or(false);
    Ok((out, truncated))
}

/// GraphQL body reading one file's text via `repository.object(expression:"main:<path>")`.
pub fn content_query_body(path: &str) -> Value {
    serde_json::json!({
        "query": "query($owner:String!,$name:String!,$expr:String!){ \
                    repository(owner:$owner,name:$name){ \
                      object(expression:$expr){ ... on Blob { text } } } }",
        "variables": {
            "owner": DOCS_OWNER,
            "name": DOCS_REPO,
            "expr": format!("{DOCS_BRANCH}:{path}")
        }
    })
}

/// Extract blob text from a content query's `data`. A null/absent object (deleted
/// or binary blob) yields an empty string rather than an error.
pub fn parse_blob_text(data: &Value) -> Result<String, GitHubError> {
    match data.get("repository").and_then(|r| r.get("object")) {
        None | Some(Value::Null) => Ok(String::new()),
        Some(obj) => Ok(obj
            .get("text")
            .and_then(|t| t.as_str())
            .unwrap_or("")
            .to_string()),
    }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml github::docs`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/github/docs.rs src-tauri/src/github/mod.rs
git commit -m "feat(docs): add github tree/blob parsers + request builders"
```

---

### Task 4: GitHubClient REST GET method

**Files:**
- Modify: `src-tauri/src/github/mod.rs` (add `rest_get` to `impl GitHubClient`)

**Interfaces:**
- Consumes: the existing `reqwest::Client`, `interpret_status`, `rate_limit_hint`.
- Produces: `pub async fn GitHubClient::rest_get(&self, authorization: &str, path: &str) -> Result<serde_json::Value, GitHubError>`.

This thin transport method is wired into a command closure (Task 5) and exercised through `sync_docs_logic`'s injected-closure tests, mirroring how `graphql`/`build_search_body` are not unit-tested in isolation.

- [ ] **Step 1: Add the method**

In `src-tauri/src/github/mod.rs`, inside `impl GitHubClient` (after the `graphql` method, before its closing `}`), add:

```rust
    /// GET a GitHub REST path (e.g. "/repos/o/r/git/trees/main?recursive=1") and
    /// return the parsed JSON body. Shares this client's auth + rate-limit handling
    /// with `graphql`; any non-2xx status (404/422/…) becomes an `Api` error so a
    /// JSON error body is never mistaken for a success payload.
    pub async fn rest_get(&self, authorization: &str, path: &str) -> Result<Value, GitHubError> {
        let url = format!("https://api.github.com{path}");
        let resp = self
            .http
            .get(&url)
            .header("Authorization", authorization)
            .header("User-Agent", "astryn")
            .header("Accept", "application/vnd.github+json")
            .send()
            .await
            .map_err(|_| GitHubError::Network)?;
        let status = resp.status().as_u16();
        let h = resp.headers();
        let num = |name: &str| {
            h.get(name)
                .and_then(|v| v.to_str().ok())
                .and_then(|s| s.parse::<i64>().ok())
        };
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        let hint = rate_limit_hint(num("retry-after"), num("x-ratelimit-reset"), now);
        let throttled = hint.is_some() || num("x-ratelimit-remaining") == Some(0);
        let text = resp.text().await.map_err(|_| GitHubError::Network)?;
        if let Some(e) = interpret_status(status, throttled) {
            return Err(match e {
                GitHubError::RateLimited(_) => GitHubError::RateLimited(hint),
                other => other,
            });
        }
        if !(200..300).contains(&status) {
            return Err(GitHubError::Api(format!("github rest status {status}")));
        }
        serde_json::from_str(&text).map_err(|_| GitHubError::Malformed)
    }
```

- [ ] **Step 2: Verify it compiles**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: builds clean (a `dead_code` warning on `rest_get` is fine until Task 5 wires it).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/github/mod.rs
git commit -m "feat(docs): add GitHubClient::rest_get for REST endpoints"
```

---

### Task 5: Docs commands (logic + Tauri wrappers)

**Files:**
- Create: `src-tauri/src/commands/docs.rs`
- Modify: `src-tauri/src/commands/mod.rs` (add `pub mod docs;`)
- Modify: `src-tauri/src/lib.rs` (register 4 commands)
- Test: `src-tauri/src/commands/docs.rs` (inline `mod tests`)

**Interfaces:**
- Consumes: `crate::db::docs` (Task 2), `crate::github::docs` (Task 3), `GitHubClient::rest_get` + `graphql` (Task 4), `AppState`/`CmdError`/`GITHUB_TOKEN_ACCOUNT` from `super`.
- Produces:
  - `pub struct DocsSyncResult { file_count: i64, truncated: bool }` (camelCase)
  - `pub struct DocsStatus { token_present: bool, last_synced_at: Option<String>, file_count: i64, truncated: bool }` (camelCase)
  - `pub async fn sync_docs_logic<FT,FtFut,FC,FcFut>(credentials, pool, generation, now, fetch_tree, fetch_content) -> Result<DocsSyncResult, CmdError>` where `fetch_tree: FnOnce(String) -> Future<Output=Result<(Vec<RawEntry>,bool), GitHubError>>` and `fetch_content: Fn(String,String) -> Future<Output=Result<String, GitHubError>>`
  - commands `sync_docs`, `list_docs_tree`, `get_doc_content`, `get_docs_status`

- [ ] **Step 1: Register the module**

In `src-tauri/src/commands/mod.rs`, next to `pub mod github;`, add:

```rust
pub mod docs;
```

- [ ] **Step 2: Write the failing tests**

Create `src-tauri/src/commands/docs.rs`:

```rust
use serde::Serialize;
use sqlx::SqlitePool;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tauri::State;

use super::{AppState, CmdError, GITHUB_TOKEN_ACCOUNT};
use crate::db::docs as ddb;
use crate::github::docs::{self as gdocs, RawEntry};
use crate::github::{GitHubCredentialProvider, GitHubError};
use crate::secrets::SecretStore;

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DocsSyncResult {
    pub file_count: i64,
    pub truncated: bool,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DocsStatus {
    pub token_present: bool,
    pub last_synced_at: Option<String>,
    pub file_count: i64,
    pub truncated: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::github::fake::FakeGitHubCreds;
    use crate::secrets::fake::FakeSecretStore;

    async fn pool() -> (tempfile::TempDir, SqlitePool) {
        let dir = tempfile::tempdir().unwrap();
        let pool = crate::db::init_pool(&dir.path().join("astryn/t.db"))
            .await
            .unwrap();
        (dir, pool)
    }

    fn sample_tree() -> Vec<RawEntry> {
        vec![
            RawEntry { path: "02-technical".into(), kind: "tree".into(), sha: "t1".into() },
            RawEntry { path: "02-technical/intro.md".into(), kind: "blob".into(), sha: "b1".into() },
            RawEntry { path: "logo.png".into(), kind: "blob".into(), sha: "b2".into() }, // non-md → skipped
        ]
    }

    #[tokio::test]
    async fn sync_caches_tree_and_markdown_content() {
        let (_d, pool) = pool().await;
        let creds: Arc<dyn GitHubCredentialProvider> =
            Arc::new(FakeGitHubCreds(Some("Bearer x".into())));
        let gen = AtomicU64::new(0);
        let result = sync_docs_logic(
            creds,
            &pool,
            &gen,
            "now".into(),
            |_auth| async { Ok((sample_tree(), false)) },
            |_auth, path| async move { Ok(format!("# {path}")) },
        )
        .await
        .unwrap();

        assert_eq!(result.file_count, 1); // one markdown blob
        assert_eq!(result.truncated, false);

        // Folder + markdown file cached; the .png was filtered out.
        let nodes = ddb::list_docs(&pool).await.unwrap();
        assert_eq!(nodes.len(), 2);
        assert_eq!(
            ddb::load_doc_content(&pool, "02-technical/intro.md")
                .await
                .unwrap()
                .as_deref(),
            Some("# 02-technical/intro.md")
        );
    }

    #[tokio::test]
    async fn sync_without_token_is_not_configured() {
        let (_d, pool) = pool().await;
        let creds: Arc<dyn GitHubCredentialProvider> = Arc::new(FakeGitHubCreds(None));
        let gen = AtomicU64::new(0);
        let result = sync_docs_logic(
            creds,
            &pool,
            &gen,
            "now".into(),
            |_auth| async { Ok((sample_tree(), false)) },
            |_auth, _path| async { Ok(String::new()) },
        )
        .await;
        assert!(matches!(result, Err(CmdError::GitHubNotConfigured)));
    }

    #[tokio::test]
    async fn sync_aborts_and_writes_nothing_when_generation_changes() {
        let (_d, pool) = pool().await;
        let creds: Arc<dyn GitHubCredentialProvider> =
            Arc::new(FakeGitHubCreds(Some("Bearer x".into())));
        let gen = AtomicU64::new(0);
        // Bump the generation mid-fetch (simulating a token swap) so the guard trips.
        let result = sync_docs_logic(
            creds,
            &pool,
            &gen,
            "now".into(),
            |_auth| {
                gen.fetch_add(1, Ordering::SeqCst);
                async { Ok((sample_tree(), false)) }
            },
            |_auth, _path| async { Ok("x".into()) },
        )
        .await;
        assert!(matches!(result, Err(CmdError::WorkspaceChanged)));
        assert!(ddb::list_docs(&pool).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn status_reflects_token_and_meta() {
        let (_d, pool) = pool().await;
        let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());

        // No token, no sync.
        let s0 = get_docs_status_logic(store.clone(), &pool).await.unwrap();
        assert_eq!(s0.token_present, false);
        assert_eq!(s0.file_count, 0);
        assert_eq!(s0.last_synced_at, None);

        // Token + a completed sync.
        store.set(GITHUB_TOKEN_ACCOUNT, "ghp_x").unwrap();
        ddb::replace_docs(
            &pool,
            &[ddb::DocFile {
                path: "a.md".into(),
                name: "a.md".into(),
                kind: "blob".into(),
                parent_path: "".into(),
                sha: "s".into(),
                content: Some("a".into()),
            }],
            "now",
            None,
            true,
        )
        .await
        .unwrap();
        let s1 = get_docs_status_logic(store, &pool).await.unwrap();
        assert_eq!(s1.token_present, true);
        assert_eq!(s1.file_count, 1);
        assert_eq!(s1.truncated, true);
        assert_eq!(s1.last_synced_at.as_deref(), Some("now"));
    }
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml commands::docs`
Expected: FAIL — `cannot find function sync_docs_logic`/`get_docs_status_logic`.

- [ ] **Step 4: Implement the logic + commands**

In `src-tauri/src/commands/docs.rs`, insert between the `DocsStatus` struct and `#[cfg(test)] mod tests`:

```rust
pub async fn sync_docs_logic<FT, FtFut, FC, FcFut>(
    credentials: Arc<dyn GitHubCredentialProvider>,
    pool: &SqlitePool,
    generation: &AtomicU64,
    now: String,
    fetch_tree: FT,
    fetch_content: FC,
) -> Result<DocsSyncResult, CmdError>
where
    FT: FnOnce(String) -> FtFut,
    FtFut: std::future::Future<Output = Result<(Vec<RawEntry>, bool), GitHubError>>,
    FC: Fn(String, String) -> FcFut,
    FcFut: std::future::Future<Output = Result<String, GitHubError>>,
{
    let c = credentials.clone();
    let auth = tokio::task::spawn_blocking(move || c.authorization())
        .await
        .map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::SecretStore)?
        .ok_or(CmdError::GitHubNotConfigured)?;
    let gen0 = generation.load(Ordering::SeqCst);

    let (entries, truncated) = fetch_tree(auth.clone()).await?;
    let mut files: Vec<ddb::DocFile> = Vec::new();
    for e in &entries {
        if e.kind == "tree" {
            files.push(ddb::DocFile {
                path: e.path.clone(),
                name: gdocs::basename(&e.path).to_string(),
                kind: "tree".into(),
                parent_path: gdocs::parent_path(&e.path).to_string(),
                sha: e.sha.clone(),
                content: None,
            });
        } else if e.kind == "blob" && gdocs::is_markdown(&e.path) {
            let text = fetch_content(auth.clone(), e.path.clone()).await?;
            files.push(ddb::DocFile {
                path: e.path.clone(),
                name: gdocs::basename(&e.path).to_string(),
                kind: "blob".into(),
                parent_path: gdocs::parent_path(&e.path).to_string(),
                sha: e.sha.clone(),
                content: Some(text),
            });
        }
    }

    // Abort if the GitHub token changed mid-sync — never mix two repos' content.
    if generation.load(Ordering::SeqCst) != gen0 {
        return Err(CmdError::WorkspaceChanged);
    }
    ddb::replace_docs(pool, &files, &now, None, truncated)
        .await
        .map_err(|_| CmdError::Internal)?;
    let file_count = files.iter().filter(|f| f.kind == "blob").count() as i64;
    Ok(DocsSyncResult {
        file_count,
        truncated,
    })
}

pub async fn list_docs_logic(pool: &SqlitePool) -> Result<Vec<ddb::DocNode>, CmdError> {
    ddb::list_docs(pool).await.map_err(|_| CmdError::Internal)
}

pub async fn get_doc_content_logic(
    pool: &SqlitePool,
    path: String,
) -> Result<Option<String>, CmdError> {
    ddb::load_doc_content(pool, &path)
        .await
        .map_err(|_| CmdError::Internal)
}

pub async fn get_docs_status_logic(
    store: Arc<dyn SecretStore>,
    pool: &SqlitePool,
) -> Result<DocsStatus, CmdError> {
    let s = store.clone();
    let token_present = tokio::task::spawn_blocking(move || s.get(GITHUB_TOKEN_ACCOUNT))
        .await
        .map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::SecretStore)?
        .is_some();
    let meta = ddb::load_docs_meta(pool)
        .await
        .map_err(|_| CmdError::Internal)?;
    Ok(DocsStatus {
        token_present,
        last_synced_at: meta.as_ref().and_then(|m| m.last_synced_at.clone()),
        file_count: meta.as_ref().map(|m| m.file_count).unwrap_or(0),
        truncated: meta.as_ref().map(|m| m.truncated).unwrap_or(false),
    })
}

fn now_iso() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default()
}

#[tauri::command]
pub async fn sync_docs(state: State<'_, AppState>) -> Result<DocsSyncResult, CmdError> {
    let _g = state.github_lock.lock().await;
    let client = state.github.clone();
    let client2 = client.clone();
    sync_docs_logic(
        state.github_credentials.clone(),
        &state.pool,
        &state.github_generation,
        now_iso(),
        move |auth| {
            let client = client.clone();
            async move {
                let v = client.rest_get(&auth, &gdocs::tree_path()).await?;
                gdocs::parse_tree(&v)
            }
        },
        move |auth, path| {
            let client = client2.clone();
            async move {
                let data = client.graphql(&auth, gdocs::content_query_body(&path)).await?;
                gdocs::parse_blob_text(&data)
            }
        },
    )
    .await
}

#[tauri::command]
pub async fn list_docs_tree(state: State<'_, AppState>) -> Result<Vec<ddb::DocNode>, CmdError> {
    list_docs_logic(&state.pool).await
}

#[tauri::command]
pub async fn get_doc_content(
    state: State<'_, AppState>,
    path: String,
) -> Result<Option<String>, CmdError> {
    get_doc_content_logic(&state.pool, path).await
}

#[tauri::command]
pub async fn get_docs_status(state: State<'_, AppState>) -> Result<DocsStatus, CmdError> {
    get_docs_status_logic(state.secret_store.clone(), &state.pool).await
}
```

- [ ] **Step 5: Register the commands**

In `src-tauri/src/lib.rs`, inside `tauri::generate_handler![ ... ]`, after the `commands::github::sync_github_contributions,` line, add:

```rust
            commands::docs::sync_docs,
            commands::docs::list_docs_tree,
            commands::docs::get_doc_content,
            commands::docs::get_docs_status,
```

- [ ] **Step 6: Run the tests + full build**

Run: `cargo test --manifest-path src-tauri/Cargo.toml commands::docs`
Expected: PASS (4 tests).

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: builds clean (no more `rest_get` dead-code warning).

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/commands/docs.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat(docs): add docs sync/list/content/status commands"
```

---

### Task 6: Frontend command bindings

**Files:**
- Modify: `src/lib/commands.ts`

**Interfaces:**
- Consumes: the 4 Tauri commands from Task 5.
- Produces (exports):
  - `type DocNode = { path: string; name: string; kind: "blob" | "tree"; parentPath: string }`
  - `type DocsStatus = { tokenPresent: boolean; lastSyncedAt: string | null; fileCount: number; truncated: boolean }`
  - `type DocsSyncResult = { fileCount: number; truncated: boolean }`
  - `syncDocs(): Promise<DocsSyncResult>`, `listDocsTree(): Promise<DocNode[]>`, `getDocContent(path): Promise<string | null>`, `getDocsStatus(): Promise<DocsStatus>`

- [ ] **Step 1: Add the bindings**

In `src/lib/commands.ts`, after the GitHub contributions block (the `syncGithubContributions` export, ~line 456) and before the `// ── Slack catch-up board` comment, add:

```typescript
// ── Docs viewer (F-Docs) ─────────────────────────────────────────────────────

export type DocNode = {
  path: string;
  name: string;
  kind: "blob" | "tree";
  parentPath: string;
};

export type DocsStatus = {
  tokenPresent: boolean;
  lastSyncedAt: string | null;
  fileCount: number;
  truncated: boolean;
};

export type DocsSyncResult = { fileCount: number; truncated: boolean };

/** Fetch the docs repo tree + markdown into the SQLite cache. Reuses the GitHub token. */
export const syncDocs = (): Promise<DocsSyncResult> => invoke("sync_docs");

/** The cached flat list of folders + files (frontend nests it). */
export const listDocsTree = (): Promise<DocNode[]> => invoke("list_docs_tree");

/** Cached markdown for one file (`null` if unknown / not yet synced). */
export const getDocContent = (path: string): Promise<string | null> =>
  invoke("get_doc_content", { path });

export const getDocsStatus = (): Promise<DocsStatus> => invoke("get_docs_status");
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/commands.ts
git commit -m "feat(docs): add typed docs command bindings"
```

---

### Task 7: Doc tree pure logic

**Files:**
- Create: `src/features/docs/docsTree.ts`
- Test: `src/features/docs/docsTree.test.ts`

**Interfaces:**
- Consumes: `DocNode` from `@/lib/commands`.
- Produces:
  - `type DocTreeNode = { path: string; name: string; label: string; kind: "blob" | "tree"; children: DocTreeNode[] }`
  - `displayLabel(name: string): string`
  - `buildDocTree(flat: DocNode[]): DocTreeNode[]`
  - `defaultDocPath(flat: DocNode[]): string | null`

- [ ] **Step 1: Write the failing tests**

Create `src/features/docs/docsTree.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import type { DocNode } from "@/lib/commands";
import { buildDocTree, defaultDocPath, displayLabel } from "./docsTree";

const node = (path: string, kind: "blob" | "tree", parentPath: string): DocNode => ({
  path,
  name: path.split("/").pop()!,
  kind,
  parentPath,
});

describe("displayLabel", () => {
  it("strips numeric prefixes and .md", () => {
    expect(displayLabel("01-architecture.md")).toBe("architecture");
    expect(displayLabel("00-overview")).toBe("overview");
    expect(displayLabel("README.md")).toBe("README");
    expect(displayLabel("backend")).toBe("backend");
  });
  it("keeps the name when stripping would empty it", () => {
    expect(displayLabel("01-.md")).toBe("01-.md");
  });
});

describe("buildDocTree", () => {
  it("nests children under their parent folders", () => {
    const flat = [
      node("02-technical", "tree", ""),
      node("02-technical/backend", "tree", "02-technical"),
      node("02-technical/backend/api.md", "blob", "02-technical/backend"),
      node("README.md", "blob", ""),
    ];
    const tree = buildDocTree(flat);
    // README sorts before the folder (README-first), so roots = [README.md, 02-technical].
    expect(tree.map((n) => n.path)).toEqual(["README.md", "02-technical"]);
    const tech = tree.find((n) => n.path === "02-technical")!;
    expect(tech.children.map((n) => n.path)).toEqual(["02-technical/backend"]);
    expect(tech.children[0].children[0].path).toBe("02-technical/backend/api.md");
  });

  it("orders siblings README-first then by numeric prefix", () => {
    const flat = [
      node("01-product", "tree", ""),
      node("00-overview", "tree", ""),
      node("README.md", "blob", ""),
    ];
    expect(buildDocTree(flat).map((n) => n.path)).toEqual([
      "README.md",
      "00-overview",
      "01-product",
    ]);
  });
});

describe("defaultDocPath", () => {
  it("prefers the root README, else the first file", () => {
    expect(
      defaultDocPath([node("README.md", "blob", ""), node("a.md", "blob", "")]),
    ).toBe("README.md");
    expect(defaultDocPath([node("x", "tree", ""), node("x/a.md", "blob", "x")])).toBe(
      "x/a.md",
    );
    expect(defaultDocPath([node("x", "tree", "")])).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- docsTree`
Expected: FAIL — cannot resolve `./docsTree`.

- [ ] **Step 3: Implement**

Create `src/features/docs/docsTree.ts`:

```typescript
import type { DocNode } from "@/lib/commands";

export type DocTreeNode = {
  path: string;
  name: string;
  label: string;
  kind: "blob" | "tree";
  children: DocTreeNode[];
};

/** Strip a leading "NN-"/"NN_"/"NN." ordering prefix and a trailing ".md". */
export function displayLabel(name: string): string {
  const stripped = name.replace(/\.md$/i, "").replace(/^\d+[-_.]\s*/, "");
  return stripped.length > 0 ? stripped : name;
}

/** Sort key per node: README first, then numeric prefix, then case-insensitive name. */
function sortKey(node: DocTreeNode): [number, number, string] {
  const readme = /^readme\.md$/i.test(node.name) ? 0 : 1;
  const m = /^(\d+)/.exec(node.name);
  const num = m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
  return [readme, num, node.name.toLowerCase()];
}

function cmp(a: DocTreeNode, b: DocTreeNode): number {
  const ka = sortKey(a);
  const kb = sortKey(b);
  for (let i = 0; i < 3; i++) {
    if (ka[i] < kb[i]) return -1;
    if (ka[i] > kb[i]) return 1;
  }
  return 0;
}

/** Build a nested, sorted tree from the flat cached entries. */
export function buildDocTree(flat: DocNode[]): DocTreeNode[] {
  const byPath = new Map<string, DocTreeNode>();
  for (const e of flat) {
    byPath.set(e.path, {
      path: e.path,
      name: e.name,
      label: displayLabel(e.name),
      kind: e.kind,
      children: [],
    });
  }
  const roots: DocTreeNode[] = [];
  for (const e of flat) {
    const self = byPath.get(e.path)!;
    const parent = e.parentPath ? byPath.get(e.parentPath) : undefined;
    if (parent) parent.children.push(self);
    else roots.push(self);
  }
  const sortRec = (nodes: DocTreeNode[]) => {
    nodes.sort(cmp);
    for (const n of nodes) sortRec(n.children);
  };
  sortRec(roots);
  return roots;
}

/** Path to auto-open: the root README.md if present, else the first file. */
export function defaultDocPath(flat: DocNode[]): string | null {
  const rootReadme = flat.find(
    (e) => e.parentPath === "" && /^readme\.md$/i.test(e.name),
  );
  if (rootReadme) return rootReadme.path;
  const firstFile = flat.find((e) => e.kind === "blob");
  return firstFile ? firstFile.path : null;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- docsTree`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/docs/docsTree.ts src/features/docs/docsTree.test.ts
git commit -m "feat(docs): add doc-tree building + label logic"
```

---

### Task 8: Docs query hooks

**Files:**
- Modify: `src/lib/queries.ts`

**Interfaces:**
- Consumes: Task 6 bindings.
- Produces: `useDocsStatus()`, `useDocsTree()`, `useDocContent(path: string | null)`, `useDocsSync(enabled: boolean)`.

- [ ] **Step 1: Add imports**

In `src/lib/queries.ts`, in the existing import block from `"./commands"` (the one that already imports `getGithubStatus`, `listGithubPrs`, etc.), add these four names:

```typescript
  getDocsStatus,
  listDocsTree,
  getDocContent,
  syncDocs,
```

- [ ] **Step 2: Add the hooks**

In `src/lib/queries.ts`, after `clearGithubQueries` (the function ending around line 690), add:

```typescript
export function useDocsStatus() {
  return useQuery({ queryKey: ["docs-status"], queryFn: getDocsStatus });
}

export function useDocsTree() {
  return useQuery({ queryKey: ["docs-tree"], queryFn: listDocsTree });
}

export function useDocContent(path: string | null) {
  return useQuery({
    queryKey: ["doc-content", path],
    queryFn: () => getDocContent(path as string),
    enabled: !!path,
  });
}

/**
 * Docs sync: runs once on mount while the GitHub token is present, then on a
 * manual refetch. Invalidates the tree/content/status so cached views refresh.
 * Disabled (no network) when no token is configured.
 */
export function useDocsSync(enabled: boolean) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ["docs-sync"],
    enabled,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      try {
        const result = await syncDocs();
        await qc.invalidateQueries({ queryKey: ["docs-tree"] });
        await qc.invalidateQueries({ queryKey: ["doc-content"] });
        await qc.invalidateQueries({ queryKey: ["docs-status"] });
        return result;
      } catch (err) {
        gooeyToast.error("Couldn't refresh docs", { description: errorText(err) });
        throw err;
      }
    },
  });
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries.ts
git commit -m "feat(docs): add docs query hooks"
```

---

### Task 9: Read-only Milkdown DocViewer

**Files:**
- Create: `src/features/docs/DocViewer.tsx`

**Interfaces:**
- Consumes: `applyDescriptionConfig`, `ReadOnlyDescription`, `EditorErrorBoundary` from the drawer; `openUrl` from `@tauri-apps/plugin-opener`.
- Produces: `export function DocViewer({ markdown }: { markdown: string })`.

**Notes:** A minimal read-only Milkdown instance (commonmark + gfm + history, no slash/tooltip/mention/upload plugins) reusing `applyDescriptionConfig` for the schema-safety patches, wrapped in `EditorErrorBoundary` whose fallback is the drawer's `ReadOnlyDescription` (react-markdown) for the rare markdown ProseMirror rejects. Links open in the system browser. Per the spec, relative images won't load (private repo) and mermaid renders as a plain code block in v1.

- [ ] **Step 1: Write the component**

Create `src/features/docs/DocViewer.tsx`:

```tsx
import { useMemo } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { MilkdownPlugin } from "@milkdown/ctx";
import {
  Editor,
  rootCtx,
  defaultValueCtx,
  editorViewOptionsCtx,
} from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { history } from "@milkdown/kit/plugin/history";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import {
  EditorErrorBoundary,
  ReadOnlyDescription,
} from "@/features/drawer/DescriptionEditor";
import { applyDescriptionConfig } from "@/features/drawer/milkdownEditor";

/** Open http(s) links in the system browser; ignore in-doc relative anchors. */
function openExternal(href: string) {
  if (/^https?:\/\//i.test(href)) void openUrl(href).catch(() => undefined);
}

function DocMilkdown({ markdown }: { markdown: string }) {
  useEditor(
    (root) =>
      Editor.make()
        .config((ctx) => {
          ctx.set(rootCtx, root);
          ctx.set(defaultValueCtx, markdown);
          ctx.set(editorViewOptionsCtx, {
            editable: () => false,
            handleClickOn: (_view, _pos, _node, _nodePos, event) => {
              const anchor = (event.target as HTMLElement | null)?.closest("a");
              const href = anchor?.getAttribute("href");
              if (href) {
                event.preventDefault();
                openExternal(href);
                return true;
              }
              return false;
            },
          });
          applyDescriptionConfig(ctx);
        })
        .use(commonmark as MilkdownPlugin[])
        .use(gfm as MilkdownPlugin[])
        .use(history),
    [markdown],
  );
  return <Milkdown />;
}

/** Render one doc's markdown read-only, with a react-markdown fallback. */
export function DocViewer({ markdown }: { markdown: string }) {
  const fallback = useMemo(
    () => <ReadOnlyDescription markdown={markdown} onOpenLink={openExternal} />,
    [markdown],
  );
  return (
    <EditorErrorBoundary key={markdown} fallback={fallback}>
      <article className="astryn-prose prose prose-sm prose-invert max-w-3xl px-8 py-6 prose-headings:font-semibold prose-a:text-primary">
        <MilkdownProvider key={markdown}>
          <DocMilkdown markdown={markdown} />
        </MilkdownProvider>
      </article>
    </EditorErrorBoundary>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (If TS rejects `.use(history)` typing, wrap as `.use(history as unknown as MilkdownPlugin[])` to match the existing cast style.)

- [ ] **Step 3: Commit**

```bash
git add src/features/docs/DocViewer.tsx
git commit -m "feat(docs): add read-only Milkdown doc viewer"
```

---

### Task 10: DocsTree sidebar component

**Files:**
- Create: `src/features/docs/DocsTree.tsx`

**Interfaces:**
- Consumes: `DocTreeNode` from `./docsTree`.
- Produces: `export function DocsTree({ tree, selectedPath, onSelect }: { tree: DocTreeNode[]; selectedPath: string | null; onSelect: (path: string) => void })`.

- [ ] **Step 1: Write the component**

Create `src/features/docs/DocsTree.tsx`:

```tsx
import { useState } from "react";
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen } from "lucide-react";
import type { DocTreeNode } from "./docsTree";

function TreeRow({
  node,
  depth,
  selectedPath,
  onSelect,
}: {
  node: DocTreeNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const pad = { paddingLeft: depth * 12 + 8 } as const;

  if (node.kind === "tree") {
    return (
      <div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          style={pad}
          className="flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
        >
          {open ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />}
          {open ? <FolderOpen className="size-3.5 shrink-0 text-amber-400/80" /> : <Folder className="size-3.5 shrink-0 text-amber-400/80" />}
          <span className="truncate">{node.label}</span>
        </button>
        {open &&
          node.children.map((child) => (
            <TreeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelect={onSelect}
            />
          ))}
      </div>
    );
  }

  const active = node.path === selectedPath;
  return (
    <button
      type="button"
      onClick={() => onSelect(node.path)}
      style={pad}
      className={`flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-xs transition-colors ${
        active
          ? "bg-primary/15 text-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
      }`}
    >
      <FileText className={`size-3.5 shrink-0 ${active ? "text-primary" : ""}`} />
      <span className="truncate">{node.label}</span>
    </button>
  );
}

export function DocsTree({
  tree,
  selectedPath,
  onSelect,
}: {
  tree: DocTreeNode[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  return (
    <nav className="flex flex-col gap-0.5 px-2">
      {tree.map((node) => (
        <TreeRow
          key={node.path}
          node={node}
          depth={0}
          selectedPath={selectedPath}
          onSelect={onSelect}
        />
      ))}
    </nav>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/features/docs/DocsTree.tsx
git commit -m "feat(docs): add collapsible docs tree sidebar"
```

---

### Task 11: DocsPage + view registration

**Files:**
- Create: `src/features/docs/DocsPage.tsx`
- Modify: `src/lib/paneModel.ts`, `src/components/Dock.tsx`, `src/components/SplitLayout.tsx`, `src/components/PaneTabStrip.tsx`

**Interfaces:**
- Consumes: Tasks 7–10 (`buildDocTree`, `defaultDocPath`, `DocsTree`, `DocViewer`), Task 8 hooks.
- Produces: `export function DocsPage()`; the `"docs"` view registered across the workspace seam.

- [ ] **Step 1: Write the page**

Create `src/features/docs/DocsPage.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import { BookText, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/lib/tabs";
import { useDocContent, useDocsStatus, useDocsSync, useDocsTree } from "@/lib/queries";
import { buildDocTree, defaultDocPath } from "./docsTree";
import { DocsTree } from "./DocsTree";
import { DocViewer } from "./DocViewer";

export function DocsPage() {
  const { setActiveView } = useWorkspace();
  const { data: status } = useDocsStatus();
  const tokenPresent = status?.tokenPresent ?? false;
  const { data: flat } = useDocsTree();
  const sync = useDocsSync(tokenPresent);

  const [selected, setSelected] = useState<string | null>(null);
  const tree = useMemo(() => buildDocTree(flat ?? []), [flat]);

  // Auto-select the root README (or first file) once the tree is available.
  useEffect(() => {
    if (!selected && flat && flat.length > 0) {
      const def = defaultDocPath(flat);
      if (def) setSelected(def);
    }
  }, [flat, selected]);

  const { data: content } = useDocContent(selected);

  if (status && !tokenPresent) {
    return (
      <main className="flex h-full flex-col items-center justify-center gap-4 p-10 text-center">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-muted/50">
          <BookText className="size-7 text-muted-foreground" />
        </span>
        <div className="flex flex-col gap-1">
          <h1 className="text-base font-semibold text-foreground">Docs</h1>
          <p className="max-w-xs text-sm text-muted-foreground">
            Connect your GitHub account to browse the project documentation.
          </p>
        </div>
        <Button onClick={() => setActiveView("settings")}>Connect GitHub</Button>
      </main>
    );
  }

  return (
    <main className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border/60 bg-background/80 px-5 py-3">
        <div className="flex items-baseline gap-2">
          <h1 className="text-base font-semibold text-foreground">Docs</h1>
          {sync.isError && (
            <span className="text-xs text-amber-400">Sync failed — showing cached docs.</span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Refresh"
          disabled={sync.isFetching}
          onClick={() => sync.refetch()}
        >
          <RefreshCw className={`size-4 ${sync.isFetching ? "animate-spin" : ""}`} />
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="w-72 shrink-0 overflow-y-auto border-r border-border/60 bg-sidebar/30 py-3">
          {tree.length === 0 ? (
            <p className="px-4 py-6 text-xs text-muted-foreground">
              {sync.isFetching ? "Loading docs…" : "No docs cached yet."}
            </p>
          ) : (
            <DocsTree tree={tree} selectedPath={selected} onSelect={setSelected} />
          )}
        </aside>
        <div className="min-w-0 flex-1 overflow-y-auto">
          {selected && content != null ? (
            <DocViewer markdown={content} />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Select a document to read.
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Register the view kind**

In `src/lib/paneModel.ts`:
- Line 1 — add `"docs"` to the `ViewKind` union (before `"settings"`):
  ```typescript
  export type ViewKind = "calendar" | "list" | "this-week" | "graph" | "inbox" | "prs" | "slack" | "docs" | "settings" | "issue";
  ```
- Line 11 — add `"docs"` to `VIEWS` (before `"settings"`):
  ```typescript
  export const VIEWS: ViewKind[] = ["calendar", "list", "this-week", "graph", "inbox", "prs", "slack", "docs", "settings", "issue"];
  ```

- [ ] **Step 3: Register in the Dock**

In `src/components/Dock.tsx`:
- Add `BookText` to the lucide import on line 2 (keep alphabetical-ish ordering):
  ```typescript
  import { BookText, Calendar, CalendarRange, GitPullRequest, Inbox, List, MessageSquare, Network, Plus, RefreshCw, Settings as SettingsIcon } from "lucide-react";
  ```
- In the `NAV` array, add an entry before the `settings` entry:
  ```typescript
    { view: "docs", label: "Docs", icon: <BookText className="size-5" /> },
  ```
- In the `META` record, add `docs`:
  ```typescript
  const META: Record<Exclude<ViewKind, "issue">, string> = { calendar: "Calendar", list: "Issues", "this-week": "Overview", graph: "Dependencies", inbox: "Inbox", prs: "Pull Requests", slack: "Slack", docs: "Docs", settings: "Settings" };
  ```

- [ ] **Step 4: Register in SplitLayout**

In `src/components/SplitLayout.tsx`:
- After the `import { SlackPage } from "@/features/slack/SlackPage";` line, add:
  ```typescript
  import { DocsPage } from "@/features/docs/DocsPage";
  ```
- In `PaneContent`'s switch, after the `case "slack": return <SlackPage />;` line, add:
  ```typescript
    case "docs":
      return <DocsPage />;
  ```

- [ ] **Step 5: Register in the tab strip**

In `src/components/PaneTabStrip.tsx`:
- Add `BookText` to the lucide import on line 2:
  ```typescript
  import { BookText, Calendar, CalendarRange, FileText, GitPullRequest, Inbox, List, MessageSquare, Network, Plus, Settings as SettingsIcon, X } from "lucide-react";
  ```
- In the `META` record, add a `docs` entry before `settings`:
  ```typescript
    docs: { label: "Docs", icon: <BookText className="size-3.5 text-rose-400" /> },
  ```

- [ ] **Step 6: Typecheck + frontend build + full test suites**

Run: `npx tsc --noEmit`
Expected: no errors (the `Record<Exclude<ViewKind, "issue">, …>` maps force every new view to be handled).

Run: `npm test -- docsTree`
Expected: PASS.

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all Rust tests pass (existing + new docs tests).

- [ ] **Step 7: Manual smoke (requires a configured GitHub token)**

Run: `npm run tauri dev`, click the **Docs** dock icon. Verify: the tree loads `00-overview` / `01-product` / `02-technical`, the root README renders on the right, clicking a nested file (e.g. `02-technical/01-architecture.md`) renders it, and Refresh re-syncs. With no token configured, the "Connect GitHub" empty state shows instead.

- [ ] **Step 8: Commit**

```bash
git add src/features/docs/DocsPage.tsx src/lib/paneModel.ts src/components/Dock.tsx src/components/SplitLayout.tsx src/components/PaneTabStrip.tsx
git commit -m "feat(docs): add Docs page and register the view + dock entry"
```

---

## Self-Review

**Spec coverage** (against `2026-06-24-docs-viewer-design.md`):
- Two-pane layout (tree + viewer) → Task 11 (`DocsPage`), Tasks 9–10.
- Milkdown read-only renderer → Task 9 (`DocViewer`, `editable: () => false`).
- All fetching in Rust; reuse `github_token`; new `rest_get` → Tasks 4–5.
- Single-request recursive tree + per-file GraphQL content → Task 3 (`tree_path`, `content_query_body`) + Task 5 wiring.
- SQLite cache `docs_files` + `docs_sync_meta` → Tasks 1–2.
- Commands `sync_docs` / `list_docs_tree` / `get_doc_content` / `get_docs_status` → Task 5.
- Bindings + hooks → Tasks 6, 8.
- Tree nesting, `NN-` prefix stripping, README-first ordering, default selection → Task 7.
- 3-spot view registration + tab strip → Task 11.
- No-token empty state; empty-cache auto-sync; Refresh → Task 11 + Task 8.
- Testing: Rust parse/logic/db + Vitest tree → Tasks 1–3, 5, 7.

**Placeholder scan:** none — every code step contains full content.

**Type consistency:** `DocNode`/`DocsStatus`/`DocsSyncResult` field names match between Rust (`commands/docs.rs`, serde `camelCase`) and TS (`commands.ts`). `DocFile`/`DocNode`/`DocsMeta` in `db/docs.rs` are consumed unchanged by `commands/docs.rs`. `sync_docs_logic`'s closure signatures (`FnOnce(String)`, `Fn(String, String)`) match the Task 5 test fakes and the command wiring. Query keys (`docs-tree`, `doc-content`, `docs-status`, `docs-sync`) are consistent between `useDocsSync` invalidation and the read hooks.

**Known intentional limitations** (carried from the spec, not gaps): relative images don't load (private repo); mermaid renders as a code block in v1; no tree search. The docs sync reuses `github_generation`/`github_lock`, so a token change is guarded but the docs cache is not wiped on token change (next sync overwrites) — acceptable for a single known repo.
