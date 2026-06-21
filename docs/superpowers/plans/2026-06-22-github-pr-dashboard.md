# GitHub PR Dashboard (M4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone GitHub PR dashboard — four viewer-centric sections (Needs my review, My open PRs, Assigned to me, Involved/mentioned) backed by a Rust GitHub GraphQL client, an offline-first SQLite cache, and typed Tauri commands.

**Architecture:** All GitHub calls live in Rust (`github/` module) behind a credential-provider seam; results are cached per-bucket in SQLite (`github_prs` + `github_sync_meta`) via transactional replace-with-prune; the React webview consumes typed commands through TanStack Query, rendering cached rows immediately while a background sync refreshes them. Mirrors the existing Linear connect/sync patterns exactly.

**Tech Stack:** Rust (reqwest + serde_json + sqlx + regex), Tauri v2 commands, React 19 + TypeScript, TanStack Query, Vitest.

## Global Constraints

- All external API calls happen in **Rust**, never the webview. The token never returns to TS, and is never persisted in SQLite/logs/query caches. (`requirements.md` §3)
- Tauri commands return **sanitized** `CmdError` strings — no raw reqwest/GraphQL/keyring diagnostics.
- GraphQL `errors` on HTTP 200 are treated as **failures** (rate-limit-aware).
- TS config is **strict** with `noUnusedLocals`/`noUnusedParameters` — unused symbols fail the build.
- Keychain service is `com.orion.astryn`; the new GitHub account is `github_token`.
- Serde structs crossing IPC use `#[serde(rename_all = "camelCase")]`.
- Frontend component tests use the `// @vitest-environment jsdom` docblock + `@testing-library/react` + `vi.mock` (see existing `src/features/command/CommandPalette.test.tsx`).
- Rust tests run via `cargo test --manifest-path src-tauri/Cargo.toml`; frontend via `npm test`; typecheck via `npx tsc --noEmit`.
- Bucket keys are exactly: `needs_review`, `mine`, `assigned`, `involved`. Per-bucket cap = 300; GraphQL page size = 100.

## Task sizing note

Most tasks follow the standard 2–5-minute step cadence (write test → run → implement → run → commit). A few backend tasks (**7** state-wiring + connect commands, **8** sync/list) bundle several functions into one "implement" step **on purpose**: their pieces share a file and a compile unit (AppState fields, command wrappers, and `lib.rs` registration must land together or the crate won't build), so each is one cohesive deliverable committed at its marked Commit step. Within Task 8 the pure `fetch_bucket` helper is written and tested alongside the sync logic but is independently unit-tested (see its dedicated tests), so a reviewer can still reject it in isolation. Frontend Tasks 12/13 touch several files but produce one renderable/testable feature each.

---

## File Structure

**Create (Rust):**
- `src-tauri/migrations/0009_m4_github_prs.sql` — `github_prs` + `github_sync_meta` tables.
- `src-tauri/src/github/mod.rs` — `GitHubClient`, `GitHubError`, status/error interpretation, credential provider trait + `PatProvider` + test fake.
- `src-tauri/src/github/prs.rs` — `Bucket`, search-query construction, GraphQL body builder, `ParsedPr`, page parsing, Linear-identifier extraction.
- `src-tauri/src/db/github.rs` — `PrRow`, `SyncMeta`, transactional bucket replace, cache wipe, login save/load, joined list, meta load.
- `src-tauri/src/commands/github.rs` — `GitHubStatus`, `BucketSyncResult`, logic fns + `#[tauri::command]` wrappers.

**Modify (Rust):**
- `src-tauri/Cargo.toml` — add `regex`.
- `src-tauri/src/lib.rs` — declare `mod github;`, wire GitHub into `AppState`, register commands.
- `src-tauri/src/commands/mod.rs` — `AppState` GitHub fields, `CmdError` variants + `From<GitHubError>`, `pub mod github;`.
- `src-tauri/src/db/mod.rs` — `pub mod github;`.

**Create (Frontend):**
- `src/features/prs/PrsPage.tsx` — dashboard shell, sections, connect/stale states.
- `src/features/prs/PrRow.tsx` — one PR row + badges.
- `src/features/prs/PrsPage.test.tsx`, `src/features/prs/PrRow.test.tsx` — Vitest.

**Modify (Frontend):**
- `src/lib/commands.ts` — GitHub bindings + types.
- `src/lib/queries.ts` — `useGithubStatus`, `useGithubPrs`, `useGithubSync`, `clearGithubQueries`.
- `src/lib/paneModel.ts` — add `"prs"` to `ViewKind` + `VIEWS`.
- `src/components/Dock.tsx` — `NAV` + `META` entries.
- `src/components/PaneTabStrip.tsx` — `META` entry.
- `src/components/SplitLayout.tsx` — `PaneContent` `case "prs"`.
- `src/features/settings/Settings.tsx` — GitHub connect card.
- `requirements.md`, `CLAUDE.md` — doc updates.

---

## Task 1: Migration — github_prs + github_sync_meta tables

**Files:**
- Create: `src-tauri/migrations/0009_m4_github_prs.sql`
- Test: add to `src-tauri/src/db/mod.rs` test module

**Interfaces:**
- Produces: tables `github_prs` (PK `(id, bucket)`) and `github_sync_meta` (PK `bucket`), available to all later DB tasks.

- [ ] **Step 1: Write the failing test**

Add to the `tests` module in `src-tauri/src/db/mod.rs`:

```rust
    #[tokio::test]
    async fn migration_creates_github_tables() {
        let (_dir, pool) = temp_pool().await;
        let prs: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM github_prs")
            .fetch_one(&pool)
            .await
            .unwrap();
        let meta: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM github_sync_meta")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!((prs.0, meta.0), (0, 0));
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml migration_creates_github_tables`
Expected: FAIL — `no such table: github_prs`.

- [ ] **Step 3: Create the migration**

Create `src-tauri/migrations/0009_m4_github_prs.sql`:

```sql
-- Viewer/bucket-centric GitHub PR cache. A PR may appear in multiple buckets.
CREATE TABLE github_prs (
  id                TEXT NOT NULL,     -- "owner/repo#number"
  bucket            TEXT NOT NULL,     -- needs_review | mine | assigned | involved
  repo              TEXT NOT NULL,     -- "owner/name"
  number            INTEGER NOT NULL,
  title             TEXT,
  draft             INTEGER,           -- bool; every cached row is an OPEN PR
  mergeable         TEXT,              -- mergeable | conflicting | unknown
  ci_status         TEXT,              -- success | failure | pending | none
  review_decision   TEXT,              -- approved | changes_requested | review_required | NULL
  author_login      TEXT,
  author_avatar     TEXT,
  comment_count     INTEGER,
  branch            TEXT,
  url               TEXT,
  linear_identifier TEXT,              -- normalized uppercase id (e.g. "ENG-123"), nullable
  updated_at        TEXT,
  synced_at         TEXT NOT NULL,
  PRIMARY KEY (id, bucket)
);
CREATE INDEX idx_github_prs_bucket ON github_prs(bucket);
CREATE INDEX idx_github_prs_linear_identifier ON github_prs(linear_identifier);
-- Speeds the read-time join github_prs.linear_identifier = issues.identifier.
CREATE INDEX idx_issues_identifier ON issues(identifier);

-- Per-bucket sync metadata so truncation/staleness survive restart.
CREATE TABLE github_sync_meta (
  bucket         TEXT PRIMARY KEY,
  fetched_count  INTEGER NOT NULL,
  truncated      INTEGER NOT NULL,     -- bool: cap was hit
  last_synced_at TEXT
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml migration_creates_github_tables`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/migrations/0009_m4_github_prs.sql src-tauri/src/db/mod.rs
git commit -m "feat(m4): add github_prs + github_sync_meta migration"
```

---

## Task 2: GitHub client module — errors, interpreters, credential provider

**Files:**
- Create: `src-tauri/src/github/mod.rs`
- Modify: `src-tauri/src/lib.rs:3` (add `mod github;`)

**Interfaces:**
- Produces:
  - `enum GitHubError { Network, Auth, RateLimited(Option<i64>), Malformed, Server, Api(String) }`
  - `fn classify_graphql_errors(errors: &[serde_json::Value]) -> GitHubError`
  - `fn extract_data(body: &str) -> Result<serde_json::Value, GitHubError>`
  - `fn interpret_status(status: u16, throttled: bool) -> Option<GitHubError>`
  - `trait GitHubCredentialProvider { fn authorization(&self) -> Result<Option<String>, crate::secrets::SecretError>; }`
  - `struct PatProvider` (returns `Bearer <token>`)
  - `struct GitHubClient` with `fn new() -> Result<Self, GitHubError>`, `fn with_endpoint(...)`, `async fn graphql(&self, authorization: &str, body: serde_json::Value) -> Result<serde_json::Value, GitHubError>`
  - `#[cfg(test)] mod fake` with `FakeGitHubCreds`

- [ ] **Step 1: Add the module declaration**

In `src-tauri/src/lib.rs`, add after `mod db;` (line 2):

```rust
mod github;
```

- [ ] **Step 2: Write the failing tests**

Create `src-tauri/src/github/mod.rs`:

```rust
use serde_json::Value;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::secrets::{SecretError, SecretStore};

#[derive(Debug, thiserror::Error)]
pub enum GitHubError {
    #[error("network error")]
    Network,
    #[error("authentication failed")]
    Auth,
    #[error("rate limited")]
    RateLimited(Option<i64>),
    #[error("malformed response")]
    Malformed,
    #[error("server error")]
    Server,
    #[error("api error: {0}")]
    Api(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn graphql_rate_limited_is_classified() {
        let errs = vec![serde_json::json!({"type": "RATE_LIMITED", "message": "wait"})];
        assert!(matches!(
            classify_graphql_errors(&errs),
            GitHubError::RateLimited(_)
        ));
    }

    #[test]
    fn graphql_other_errors_join_messages() {
        let errs = vec![serde_json::json!({"message": "bad field"})];
        match classify_graphql_errors(&errs) {
            GitHubError::Api(m) => assert_eq!(m, "bad field"),
            other => panic!("expected Api, got {other:?}"),
        }
    }

    #[test]
    fn extract_data_treats_errors_as_failure() {
        let body = r#"{"errors":[{"message":"nope"}],"data":null}"#;
        assert!(matches!(extract_data(body), Err(GitHubError::Api(_))));
    }

    #[test]
    fn extract_data_returns_data_object() {
        let body = r#"{"data":{"viewer":{"login":"octocat"}}}"#;
        let v = extract_data(body).unwrap();
        assert_eq!(v["viewer"]["login"], "octocat");
    }

    #[test]
    fn status_401_is_auth() {
        assert!(matches!(interpret_status(401, false), Some(GitHubError::Auth)));
    }

    #[test]
    fn status_403_throttled_is_rate_limited() {
        assert!(matches!(
            interpret_status(403, true),
            Some(GitHubError::RateLimited(_))
        ));
    }

    #[test]
    fn status_403_unthrottled_is_auth() {
        assert!(matches!(interpret_status(403, false), Some(GitHubError::Auth)));
    }

    #[test]
    fn status_200_is_none() {
        assert!(interpret_status(200, false).is_none());
    }

    #[test]
    fn rate_limit_hint_prefers_retry_after() {
        assert_eq!(rate_limit_hint(Some(30), Some(9_999), 1_000), Some(30));
    }

    #[test]
    fn rate_limit_hint_derives_delta_from_reset_epoch() {
        assert_eq!(rate_limit_hint(None, Some(1_100), 1_000), Some(100));
    }

    #[test]
    fn rate_limit_hint_none_when_absent() {
        assert_eq!(rate_limit_hint(None, None, 1_000), None);
    }
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml github::`
Expected: FAIL — `classify_graphql_errors`/`extract_data`/`interpret_status` not found.

- [ ] **Step 4: Implement the module body**

Append to `src-tauri/src/github/mod.rs` (above the `#[cfg(test)] mod tests`):

```rust
/// Classify a non-empty GraphQL `errors` array. GitHub primary rate limits arrive
/// as HTTP 200 with `type: "RATE_LIMITED"`.
pub fn classify_graphql_errors(errors: &[Value]) -> GitHubError {
    let throttled = errors.iter().any(|e| {
        e.get("type").and_then(|t| t.as_str()) == Some("RATE_LIMITED")
    });
    if throttled {
        return GitHubError::RateLimited(None);
    }
    let joined = errors
        .iter()
        .filter_map(|e| e.get("message").and_then(|m| m.as_str()))
        .collect::<Vec<_>>()
        .join("; ");
    GitHubError::Api(joined)
}

/// Parse a GraphQL body to its `data` object, treating a non-empty `errors`
/// array as a failure even on HTTP 200.
pub fn extract_data(body: &str) -> Result<Value, GitHubError> {
    let v: Value = serde_json::from_str(body).map_err(|_| GitHubError::Malformed)?;
    if let Some(errors) = v.get("errors").and_then(|e| e.as_array()) {
        if !errors.is_empty() {
            return Err(classify_graphql_errors(errors));
        }
    }
    v.get("data").cloned().ok_or(GitHubError::Malformed)
}

/// Map transport statuses to errors. 403 is a *secondary* rate limit when the
/// caller detected throttling headers, otherwise an auth/API failure. The hint
/// is filled by the caller (`graphql`) from headers.
pub fn interpret_status(status: u16, throttled: bool) -> Option<GitHubError> {
    match status {
        401 => Some(GitHubError::Auth),
        403 if throttled => Some(GitHubError::RateLimited(None)),
        403 => Some(GitHubError::Auth),
        429 => Some(GitHubError::RateLimited(None)),
        500..=599 => Some(GitHubError::Server),
        _ => None,
    }
}

/// Best available rate-limit delay (seconds): prefer `retry-after` (already a
/// delta), else derive from the `x-ratelimit-reset` epoch minus `now`.
pub fn rate_limit_hint(retry_after: Option<i64>, reset_epoch: Option<i64>, now: i64) -> Option<i64> {
    retry_after.or_else(|| reset_epoch.map(|reset| reset - now))
}

pub trait GitHubCredentialProvider: Send + Sync {
    /// Returns the value for the `Authorization` header, or `None` if no token is stored.
    fn authorization(&self) -> Result<Option<String>, SecretError>;
}

pub struct PatProvider {
    store: Arc<dyn SecretStore>,
    account: String,
}

impl PatProvider {
    pub fn new(store: Arc<dyn SecretStore>, account: impl Into<String>) -> Self {
        Self { store, account: account.into() }
    }
}

impl GitHubCredentialProvider for PatProvider {
    fn authorization(&self) -> Result<Option<String>, SecretError> {
        // Classic PATs are sent as a Bearer credential.
        Ok(self.store.get(&self.account)?.map(|t| format!("Bearer {t}")))
    }
}

#[derive(Clone)]
pub struct GitHubClient {
    http: reqwest::Client,
    endpoint: String,
}

impl GitHubClient {
    pub fn new() -> Result<Self, GitHubError> {
        Self::with_endpoint("https://api.github.com/graphql")
    }

    pub fn with_endpoint(endpoint: impl Into<String>) -> Result<Self, GitHubError> {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .connect_timeout(Duration::from_secs(10))
            .build()
            .map_err(|_| GitHubError::Network)?;
        Ok(Self { http, endpoint: endpoint.into() })
    }

    /// POST a GraphQL body; returns the parsed `data` object. Detects 429/403
    /// throttling from headers and HTTP-200-with-errors via `extract_data`.
    pub async fn graphql(
        &self,
        authorization: &str,
        body: Value,
    ) -> Result<Value, GitHubError> {
        let resp = self
            .http
            .post(&self.endpoint)
            .header("Authorization", authorization)
            .header("User-Agent", "astryn")
            .json(&body)
            .send()
            .await
            .map_err(|_| GitHubError::Network)?;
        let status = resp.status().as_u16();
        let h = resp.headers();
        let num = |name: &str| {
            h.get(name).and_then(|v| v.to_str().ok()).and_then(|s| s.parse::<i64>().ok())
        };
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        let hint = rate_limit_hint(num("retry-after"), num("x-ratelimit-reset"), now);
        let remaining = num("x-ratelimit-remaining");
        let throttled = hint.is_some() || remaining == Some(0);
        let text = resp.text().await.map_err(|_| GitHubError::Network)?;
        if let Some(e) = interpret_status(status, throttled) {
            return Err(match e {
                GitHubError::RateLimited(_) => GitHubError::RateLimited(hint),
                other => other,
            });
        }
        // HTTP-200-with-errors path: a GraphQL RATE_LIMITED loses its hint inside
        // extract_data — re-attach the header-derived hint here.
        match extract_data(&text) {
            Err(GitHubError::RateLimited(_)) => Err(GitHubError::RateLimited(hint)),
            other => other,
        }
    }
}

#[cfg(test)]
pub mod fake {
    use super::*;

    /// A credential provider that returns a fixed authorization value.
    pub struct FakeGitHubCreds(pub Option<String>);

    impl GitHubCredentialProvider for FakeGitHubCreds {
        fn authorization(&self) -> Result<Option<String>, SecretError> {
            Ok(self.0.clone())
        }
    }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml github::`
Expected: PASS (11 tests).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/github/mod.rs src-tauri/src/lib.rs
git commit -m "feat(m4): add GitHub GraphQL client, error/rate-limit interpreters, credential seam"
```

---

## Task 3: Bucket definitions + search-query construction

**Files:**
- Create: `src-tauri/src/github/prs.rs`
- Modify: `src-tauri/src/github/mod.rs:1` (add `pub mod prs;`)

**Interfaces:**
- Produces:
  - `enum Bucket { NeedsReview, Mine, Assigned, Involved }` with `fn key(&self) -> &'static str`, `fn all() -> [Bucket; 4]`, `fn search_query(&self) -> String`
  - `const PER_BUCKET_CAP: usize = 300; const PAGE_SIZE: i64 = 100;`
  - `fn build_search_body(query: &str, first: i64, after: Option<&str>) -> serde_json::Value`

- [ ] **Step 1: Add the submodule declaration**

In `src-tauri/src/github/mod.rs`, add as the first line:

```rust
pub mod prs;
```

- [ ] **Step 2: Write the failing tests**

Create `src-tauri/src/github/prs.rs`:

```rust
use serde_json::{json, Value};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bucket_keys_are_stable() {
        let keys: Vec<_> = Bucket::all().iter().map(|b| b.key()).collect();
        assert_eq!(keys, ["needs_review", "mine", "assigned", "involved"]);
    }

    #[test]
    fn queries_carry_sort_and_open_pr_filters() {
        for b in Bucket::all() {
            let q = b.search_query();
            assert!(q.contains("is:pr"), "{q}");
            assert!(q.contains("is:open"), "{q}");
            assert!(q.contains("sort:updated-desc"), "{q}");
        }
    }

    #[test]
    fn involved_excludes_other_buckets() {
        let q = Bucket::Involved.search_query();
        assert!(q.contains("involves:@me"));
        assert!(q.contains("-author:@me"));
        assert!(q.contains("-assignee:@me"));
        assert!(q.contains("-review-requested:@me"));
    }

    #[test]
    fn search_body_sets_variables_and_null_cursor() {
        let body = build_search_body("is:pr is:open author:@me", 100, None);
        assert_eq!(body["variables"]["q"], "is:pr is:open author:@me");
        assert_eq!(body["variables"]["first"], 100);
        assert!(body["variables"]["after"].is_null());
        assert!(body["query"].as_str().unwrap().contains("search("));
    }
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml github::prs`
Expected: FAIL — `Bucket` / `build_search_body` not found.

- [ ] **Step 4: Implement**

Insert above the `#[cfg(test)] mod tests` in `src-tauri/src/github/prs.rs`:

```rust
pub const PER_BUCKET_CAP: usize = 300;
pub const PAGE_SIZE: i64 = 100;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Bucket {
    NeedsReview,
    Mine,
    Assigned,
    Involved,
}

impl Bucket {
    pub fn all() -> [Bucket; 4] {
        [Bucket::NeedsReview, Bucket::Mine, Bucket::Assigned, Bucket::Involved]
    }

    pub fn key(&self) -> &'static str {
        match self {
            Bucket::NeedsReview => "needs_review",
            Bucket::Mine => "mine",
            Bucket::Assigned => "assigned",
            Bucket::Involved => "involved",
        }
    }

    pub fn search_query(&self) -> String {
        let base = match self {
            Bucket::NeedsReview => "is:pr is:open review-requested:@me",
            Bucket::Mine => "is:pr is:open author:@me",
            Bucket::Assigned => "is:pr is:open assignee:@me",
            Bucket::Involved => {
                "is:pr is:open involves:@me -author:@me -assignee:@me -review-requested:@me"
            }
        };
        format!("{base} sort:updated-desc")
    }
}

const SEARCH_QUERY: &str = r#"query($q:String!,$first:Int!,$after:String){
  search(query:$q,type:ISSUE,first:$first,after:$after){
    pageInfo{ hasNextPage endCursor }
    nodes{
      ... on PullRequest {
        number title url isDraft mergeable reviewDecision updatedAt
        repository{ nameWithOwner }
        headRefName
        author{ login avatarUrl }
        comments{ totalCount }
        statusCheckRollup{ state }
      }
    }
  }
}"#;

pub fn build_search_body(query: &str, first: i64, after: Option<&str>) -> Value {
    json!({
        "query": SEARCH_QUERY,
        "variables": { "q": query, "first": first, "after": after }
    })
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml github::prs`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/github/prs.rs src-tauri/src/github/mod.rs
git commit -m "feat(m4): add PR buckets, search queries, and GraphQL body builder"
```

---

## Task 4: Linear-identifier extraction

**Files:**
- Modify: `src-tauri/Cargo.toml:31` (add `regex`)
- Modify: `src-tauri/src/github/prs.rs`

**Interfaces:**
- Produces: `fn extract_linear_identifier(branch: &str, title: &str) -> Option<String>` (normalized uppercase; checks branch first, then title)

- [ ] **Step 1: Add the regex dependency**

In `src-tauri/Cargo.toml`, under `[dependencies]` (after the `scraper` line):

```toml
regex = "1"
```

- [ ] **Step 2: Write the failing tests**

Add to the `tests` module in `src-tauri/src/github/prs.rs`:

```rust
    #[test]
    fn extracts_uppercase_from_branch() {
        assert_eq!(
            extract_linear_identifier("feature/ENG-123-fix", ""),
            Some("ENG-123".to_string())
        );
    }

    #[test]
    fn normalizes_lowercase_branch() {
        assert_eq!(
            extract_linear_identifier("eng-123-fix", ""),
            Some("ENG-123".to_string())
        );
    }

    #[test]
    fn falls_back_to_title() {
        assert_eq!(
            extract_linear_identifier("main", "Fix ENG-7: crash"),
            Some("ENG-7".to_string())
        );
    }

    #[test]
    fn rejects_embedded_substring() {
        // No word boundary around the candidate -> not a real identifier.
        assert_eq!(extract_linear_identifier("xENG-123y", ""), None);
    }

    #[test]
    fn release_like_extracts_but_is_filtered_at_join() {
        // `release-2024` validly matches the pattern; it only becomes a chip if it
        // joins a real cached issue (verified in the DB-join task), so extraction
        // must surface it here.
        assert_eq!(
            extract_linear_identifier("release-2024", ""),
            Some("RELEASE-2024".to_string())
        );
    }

    #[test]
    fn returns_none_when_absent() {
        assert_eq!(extract_linear_identifier("main", "just a title"), None);
    }
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml github::prs`
Expected: FAIL — `extract_linear_identifier` not found.

- [ ] **Step 4: Implement**

Add to `src-tauri/src/github/prs.rs` (above the `#[cfg(test)] mod tests`), and add `use std::sync::OnceLock;` and `use regex::Regex;` at the top of the file:

```rust
fn identifier_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)\b[A-Z][A-Z0-9]*-\d+\b").unwrap())
}

/// Extract a Linear issue identifier (e.g. "ENG-123") from a branch name or PR
/// title, normalized to uppercase. Branch wins over title.
pub fn extract_linear_identifier(branch: &str, title: &str) -> Option<String> {
    for s in [branch, title] {
        if let Some(m) = identifier_regex().find(s) {
            return Some(m.as_str().to_uppercase());
        }
    }
    None
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml github::prs`
Expected: PASS (10 tests in module).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/github/prs.rs
git commit -m "feat(m4): extract + normalize Linear identifiers from PR branch/title"
```

---

## Task 5: PR node parsing

**Files:**
- Modify: `src-tauri/src/github/prs.rs`

**Interfaces:**
- Consumes: `extract_linear_identifier` (Task 4)
- Produces:
  - `struct ParsedPr { id, repo, number, title, draft, mergeable, ci_status, review_decision, author_login, author_avatar, comment_count, branch, url, linear_identifier, updated_at }` (all `Option` except `id`, `repo`, `number`, `draft`)
  - `struct PageInfo { has_next_page: bool, end_cursor: Option<String> }`
  - `fn parse_search_page(data: &serde_json::Value) -> (Vec<ParsedPr>, PageInfo)`

- [ ] **Step 1: Write the failing tests**

Add to the `tests` module in `src-tauri/src/github/prs.rs`:

```rust
    fn sample_data() -> Value {
        json!({
            "search": {
                "pageInfo": { "hasNextPage": true, "endCursor": "CUR1" },
                "nodes": [
                    {
                        "number": 42, "title": "Add widget", "url": "https://github.com/o/r/pull/42",
                        "isDraft": false, "mergeable": "CONFLICTING", "reviewDecision": "CHANGES_REQUESTED",
                        "updatedAt": "2026-06-20T10:00:00Z",
                        "repository": { "nameWithOwner": "o/r" },
                        "headRefName": "eng-9-widget",
                        "author": { "login": "octocat", "avatarUrl": "https://a/x.png" },
                        "comments": { "totalCount": 3 },
                        "statusCheckRollup": { "state": "FAILURE" }
                    }
                ]
            }
        })
    }

    #[test]
    fn parses_pr_fields() {
        let (prs, page) = parse_search_page(&sample_data()).unwrap();
        assert_eq!(prs.len(), 1);
        let p = &prs[0];
        assert_eq!(p.id, "o/r#42");
        assert_eq!(p.repo, "o/r");
        assert_eq!(p.number, 42);
        assert_eq!(p.mergeable.as_deref(), Some("conflicting"));
        assert_eq!(p.ci_status.as_deref(), Some("failure"));
        assert_eq!(p.review_decision.as_deref(), Some("changes_requested"));
        assert_eq!(p.comment_count, Some(3));
        assert_eq!(p.linear_identifier.as_deref(), Some("ENG-9"));
        assert_eq!(page.has_next_page, true);
        assert_eq!(page.end_cursor.as_deref(), Some("CUR1"));
    }

    #[test]
    fn null_review_decision_is_preserved() {
        let mut data = sample_data();
        data["search"]["nodes"][0]["reviewDecision"] = Value::Null;
        let (prs, _) = parse_search_page(&data).unwrap();
        assert_eq!(prs[0].review_decision, None);
    }

    #[test]
    fn missing_rollup_maps_to_none_string() {
        let mut data = sample_data();
        data["search"]["nodes"][0]["statusCheckRollup"] = Value::Null;
        let (prs, _) = parse_search_page(&data).unwrap();
        assert_eq!(prs[0].ci_status.as_deref(), Some("none"));
    }

    #[test]
    fn missing_structure_is_malformed() {
        // No `search` object at all -> never silently treat as an empty page,
        // which would let sync transactionally erase a bucket.
        assert!(matches!(parse_search_page(&json!({})), Err(GitHubError::Malformed)));
        // Missing pageInfo.
        let no_page = json!({ "search": { "nodes": [] } });
        assert!(matches!(parse_search_page(&no_page), Err(GitHubError::Malformed)));
    }

    #[test]
    fn malformed_pr_node_fails_the_page() {
        // A node missing `number`/`repository` (with is:pr every node IS a PR)
        // must fail the page, not vanish.
        let bad = json!({
            "search": {
                "pageInfo": { "hasNextPage": false, "endCursor": null },
                "nodes": [ { "title": "no number" } ]
            }
        });
        assert!(matches!(parse_search_page(&bad), Err(GitHubError::Malformed)));
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml github::prs`
Expected: FAIL — `parse_search_page` / `ParsedPr` not found.

- [ ] **Step 3: Implement**

Add `use super::GitHubError;` to the top of `src-tauri/src/github/prs.rs`, then add (above the `#[cfg(test)] mod tests`):

```rust
#[derive(Debug, Clone)]
pub struct ParsedPr {
    pub id: String,
    pub repo: String,
    pub number: i64,
    pub title: Option<String>,
    pub draft: bool,
    pub mergeable: Option<String>,
    pub ci_status: Option<String>,
    pub review_decision: Option<String>,
    pub author_login: Option<String>,
    pub author_avatar: Option<String>,
    pub comment_count: Option<i64>,
    pub branch: Option<String>,
    pub url: Option<String>,
    pub linear_identifier: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone)]
pub struct PageInfo {
    pub has_next_page: bool,
    pub end_cursor: Option<String>,
}

fn str_at(v: &Value, k: &str) -> Option<String> {
    v.get(k).and_then(|x| x.as_str()).map(Into::into)
}

fn map_mergeable(v: Option<&str>) -> Option<String> {
    Some(match v {
        Some("MERGEABLE") => "mergeable",
        Some("CONFLICTING") => "conflicting",
        _ => "unknown",
    }
    .to_string())
}

fn map_review(v: Option<&str>) -> Option<String> {
    match v {
        Some("APPROVED") => Some("approved".into()),
        Some("CHANGES_REQUESTED") => Some("changes_requested".into()),
        Some("REVIEW_REQUIRED") => Some("review_required".into()),
        _ => None, // null preserved; unknown values are not invented
    }
}

fn map_ci(v: Option<&str>) -> Option<String> {
    Some(match v {
        Some("SUCCESS") => "success",
        Some("FAILURE") | Some("ERROR") => "failure",
        Some("PENDING") | Some("EXPECTED") => "pending",
        _ => "none",
    }
    .to_string())
}

fn node_to_pr(n: &Value) -> Result<ParsedPr, GitHubError> {
    // With `is:pr`, every search node IS a PullRequest; a node missing required
    // fields is malformed and must fail the page (never silently disappear).
    let number = n.get("number").and_then(Value::as_i64).ok_or(GitHubError::Malformed)?;
    let repo = n
        .get("repository")
        .and_then(|r| str_at(r, "nameWithOwner"))
        .ok_or(GitHubError::Malformed)?;
    let branch = str_at(n, "headRefName");
    let title = str_at(n, "title");
    let linear_identifier = extract_linear_identifier(
        branch.as_deref().unwrap_or(""),
        title.as_deref().unwrap_or(""),
    );
    let ci = n.get("statusCheckRollup").and_then(|r| r.get("state")).and_then(|s| s.as_str());
    Ok(ParsedPr {
        id: format!("{repo}#{number}"),
        repo,
        number,
        title,
        draft: n.get("isDraft").and_then(Value::as_bool).unwrap_or(false),
        mergeable: map_mergeable(n.get("mergeable").and_then(|m| m.as_str())),
        ci_status: map_ci(ci),
        review_decision: map_review(n.get("reviewDecision").and_then(|r| r.as_str())),
        author_login: n.get("author").and_then(|a| str_at(a, "login")),
        author_avatar: n.get("author").and_then(|a| str_at(a, "avatarUrl")),
        comment_count: n.get("comments").and_then(|c| c.get("totalCount")).and_then(Value::as_i64),
        branch,
        url: str_at(n, "url"),
        linear_identifier,
        updated_at: str_at(n, "updatedAt"),
    })
}

/// Parse one `search` page into PRs + pagination info. Missing `search`/`nodes`/
/// `pageInfo.hasNextPage` is `Malformed` — never an empty success, which would
/// let sync transactionally erase a bucket.
pub fn parse_search_page(data: &Value) -> Result<(Vec<ParsedPr>, PageInfo), GitHubError> {
    let search = data.get("search").ok_or(GitHubError::Malformed)?;
    let nodes = search
        .get("nodes")
        .and_then(|n| n.as_array())
        .ok_or(GitHubError::Malformed)?;
    let prs = nodes.iter().map(node_to_pr).collect::<Result<Vec<_>, _>>()?;
    let page = search.get("pageInfo").ok_or(GitHubError::Malformed)?;
    let page_info = PageInfo {
        has_next_page: page
            .get("hasNextPage")
            .and_then(Value::as_bool)
            .ok_or(GitHubError::Malformed)?,
        end_cursor: str_at(page, "endCursor"),
    };
    Ok((prs, page_info))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml github::prs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/github/prs.rs
git commit -m "feat(m4): parse PR search pages (CI/review/mergeable mapping + pagination)"
```

---

## Task 6: DB layer — bucket replace, cache wipe, login, joined list, meta

**Files:**
- Create: `src-tauri/src/db/github.rs`
- Modify: `src-tauri/src/db/mod.rs:5` (add `pub mod github;`)

**Interfaces:**
- Consumes: `ParsedPr` (Task 5), `crate::db::{save_setting, load_setting}` (existing)
- Produces:
  - `struct PrRow { id, bucket, repo, number, title, draft, mergeable, ci_status, review_decision, author_login, author_avatar, comment_count, branch, url, linear_identifier, linear_issue_id, updated_at }` (`#[serde(rename_all = "camelCase")]`, `sqlx::FromRow`)
  - `struct SyncMeta { bucket, fetched_count, truncated, last_synced_at }` (same derives)
  - `const GITHUB_LOGIN_KEY: &str = "github_login";`
  - `async fn replace_bucket(pool, bucket: &str, prs: &[ParsedPr], synced_at: &str, truncated: bool) -> Result<(), sqlx::Error>`
  - `async fn wipe_github_cache(pool) -> Result<(), sqlx::Error>`
  - `async fn save_github_login(pool, login: &str) -> Result<(), sqlx::Error>`
  - `async fn load_github_login(pool) -> Result<Option<String>, sqlx::Error>`
  - `async fn list_prs(pool) -> Result<Vec<PrRow>, sqlx::Error>`
  - `async fn load_sync_meta(pool) -> Result<Vec<SyncMeta>, sqlx::Error>`

- [ ] **Step 1: Add the submodule declaration**

In `src-tauri/src/db/mod.rs`, change `pub mod issues;` (line 5) to add below it:

```rust
pub mod github;
```

- [ ] **Step 2: Write the failing tests**

Create `src-tauri/src/db/github.rs`:

```rust
use sqlx::SqlitePool;

use crate::github::prs::ParsedPr;

#[cfg(test)]
mod tests {
    use super::*;

    async fn pool() -> (tempfile::TempDir, SqlitePool) {
        let dir = tempfile::tempdir().unwrap();
        let pool = crate::db::init_pool(&dir.path().join("astryn/t.db")).await.unwrap();
        (dir, pool)
    }

    fn pr(id_num: i64, ident: Option<&str>) -> ParsedPr {
        ParsedPr {
            id: format!("o/r#{id_num}"),
            repo: "o/r".into(),
            number: id_num,
            title: Some("t".into()),
            draft: false,
            mergeable: Some("mergeable".into()),
            ci_status: Some("success".into()),
            review_decision: None,
            author_login: Some("octocat".into()),
            author_avatar: None,
            comment_count: Some(1),
            branch: Some("b".into()),
            url: Some("u".into()),
            linear_identifier: ident.map(|s| s.to_string()),
            updated_at: Some("2026-06-20T00:00:00Z".into()),
        }
    }

    #[tokio::test]
    async fn replace_bucket_upserts_and_prunes() {
        let (_d, pool) = pool().await;
        replace_bucket(&pool, "mine", &[pr(1, None), pr(2, None)], "now", false).await.unwrap();
        replace_bucket(&pool, "mine", &[pr(2, None)], "now", true).await.unwrap();
        let rows = list_prs(&pool).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].number, 2);
        let meta = load_sync_meta(&pool).await.unwrap();
        assert_eq!(meta.len(), 1);
        assert_eq!(meta[0].truncated, true);
        assert_eq!(meta[0].fetched_count, 1);
    }

    #[tokio::test]
    async fn list_prs_joins_linear_issue_id() {
        let (_d, pool) = pool().await;
        sqlx::query("INSERT INTO issues (id, identifier, title, url, created_at, updated_at, synced_at) VALUES ('iss-1','ENG-9','x','u','t','t','t')")
            .execute(&pool).await.unwrap();
        replace_bucket(&pool, "mine", &[pr(9, Some("ENG-9")), pr(8, Some("ZZZ-1"))], "now", false).await.unwrap();
        let rows = list_prs(&pool).await.unwrap();
        let matched = rows.iter().find(|r| r.number == 9).unwrap();
        let unmatched = rows.iter().find(|r| r.number == 8).unwrap();
        assert_eq!(matched.linear_issue_id.as_deref(), Some("iss-1"));
        assert_eq!(unmatched.linear_issue_id, None);
    }

    #[tokio::test]
    async fn wipe_clears_prs_meta_and_login() {
        let (_d, pool) = pool().await;
        replace_bucket(&pool, "mine", &[pr(1, None)], "now", false).await.unwrap();
        save_github_login(&pool, "octocat").await.unwrap();
        wipe_github_cache(&pool).await.unwrap();
        assert!(list_prs(&pool).await.unwrap().is_empty());
        assert!(load_sync_meta(&pool).await.unwrap().is_empty());
        assert_eq!(load_github_login(&pool).await.unwrap(), None);
    }
}
```

Note: the INSERT lists exactly the `issues` NOT NULL columns (`id, identifier, title, url, created_at, updated_at, synced_at`) per `src-tauri/migrations/0002_m1_issues.sql`; the join only needs `id` + `identifier`.

- [ ] **Step 3: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml db::github`
Expected: FAIL — functions not found.

- [ ] **Step 4: Implement**

Insert above the `#[cfg(test)] mod tests` in `src-tauri/src/db/github.rs`:

```rust
pub const GITHUB_LOGIN_KEY: &str = "github_login";

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PrRow {
    pub id: String,
    pub bucket: String,
    pub repo: String,
    pub number: i64,
    pub title: Option<String>,
    pub draft: bool,
    pub mergeable: Option<String>,
    pub ci_status: Option<String>,
    pub review_decision: Option<String>,
    pub author_login: Option<String>,
    pub author_avatar: Option<String>,
    pub comment_count: Option<i64>,
    pub branch: Option<String>,
    pub url: Option<String>,
    pub linear_identifier: Option<String>,
    pub linear_issue_id: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SyncMeta {
    pub bucket: String,
    pub fetched_count: i64,
    pub truncated: bool,
    pub last_synced_at: Option<String>,
}

/// Atomically replace one bucket's cached rows and its sync metadata: delete the
/// bucket, insert the fetched set, upsert the meta — all in one transaction so a
/// partial write never empties the bucket.
pub async fn replace_bucket(
    pool: &SqlitePool,
    bucket: &str,
    prs: &[ParsedPr],
    synced_at: &str,
    truncated: bool,
) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM github_prs WHERE bucket = ?1")
        .bind(bucket)
        .execute(&mut *tx)
        .await?;
    for p in prs {
        sqlx::query(
            "INSERT INTO github_prs
               (id, bucket, repo, number, title, draft, mergeable, ci_status, review_decision,
                author_login, author_avatar, comment_count, branch, url, linear_identifier,
                updated_at, synced_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)",
        )
        .bind(&p.id)
        .bind(bucket)
        .bind(&p.repo)
        .bind(p.number)
        .bind(&p.title)
        .bind(p.draft)
        .bind(&p.mergeable)
        .bind(&p.ci_status)
        .bind(&p.review_decision)
        .bind(&p.author_login)
        .bind(&p.author_avatar)
        .bind(p.comment_count)
        .bind(&p.branch)
        .bind(&p.url)
        .bind(&p.linear_identifier)
        .bind(&p.updated_at)
        .bind(synced_at)
        .execute(&mut *tx)
        .await?;
    }
    sqlx::query(
        "INSERT INTO github_sync_meta (bucket, fetched_count, truncated, last_synced_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(bucket) DO UPDATE SET
           fetched_count = excluded.fetched_count,
           truncated = excluded.truncated,
           last_synced_at = excluded.last_synced_at",
    )
    .bind(bucket)
    .bind(prs.len() as i64)
    .bind(truncated)
    .bind(synced_at)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

/// Drop all GitHub cache state (rows + meta + cached login). Leaves Linear alone.
pub async fn wipe_github_cache(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM github_prs").execute(&mut *tx).await?;
    sqlx::query("DELETE FROM github_sync_meta").execute(&mut *tx).await?;
    sqlx::query("DELETE FROM settings WHERE key = ?1")
        .bind(GITHUB_LOGIN_KEY)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}

pub async fn save_github_login(pool: &SqlitePool, login: &str) -> Result<(), sqlx::Error> {
    crate::db::save_setting(pool, GITHUB_LOGIN_KEY, login).await
}

pub async fn load_github_login(pool: &SqlitePool) -> Result<Option<String>, sqlx::Error> {
    crate::db::load_setting(pool, GITHUB_LOGIN_KEY).await
}

pub async fn list_prs(pool: &SqlitePool) -> Result<Vec<PrRow>, sqlx::Error> {
    sqlx::query_as::<_, PrRow>(
        "SELECT p.id, p.bucket, p.repo, p.number, p.title, p.draft, p.mergeable, p.ci_status,
                p.review_decision, p.author_login, p.author_avatar, p.comment_count, p.branch,
                p.url, p.linear_identifier, i.id AS linear_issue_id, p.updated_at
         FROM github_prs p
         LEFT JOIN issues i ON i.identifier = p.linear_identifier
         ORDER BY p.bucket, p.updated_at DESC",
    )
    .fetch_all(pool)
    .await
}

pub async fn load_sync_meta(pool: &SqlitePool) -> Result<Vec<SyncMeta>, sqlx::Error> {
    sqlx::query_as::<_, SyncMeta>(
        "SELECT bucket, fetched_count, truncated, last_synced_at FROM github_sync_meta",
    )
    .fetch_all(pool)
    .await
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml db::github`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/db/github.rs src-tauri/src/db/mod.rs
git commit -m "feat(m4): GitHub PR cache DB layer (transactional replace, wipe, joined list)"
```

---

## Task 7: Connect commands — state wiring, status, set/clear/test

**Files:**
- Create: `src-tauri/src/commands/github.rs`
- Modify: `src-tauri/src/commands/mod.rs` (AppState fields ~136-156; CmdError ~82-104; add `pub mod github;` near top)
- Modify: `src-tauri/src/lib.rs` (imports, AppState construction, command registration)

**Interfaces:**
- Consumes: `crate::github::{GitHubClient, GitHubCredentialProvider, PatProvider, GitHubError}`, `crate::db::github` (Task 6), existing `AppState`/`CmdError`/`compute_status` patterns.
- Produces:
  - `enum GitHubStatus { NotConfigured, Unverified, Connected { login: String } }` (`#[serde(tag = "state", rename_all = "snake_case")]`)
  - `fn compute_github_status(has_token: bool, login: Option<String>) -> GitHubStatus`
  - logic fns: `set_github_token_logic`, `clear_github_token_logic`, `get_github_status_logic`, `test_github_connection_logic`
  - commands: `set_github_token`, `clear_github_token`, `get_github_status`, `test_github_connection`
  - `AppState` fields: `github_credentials: Arc<dyn GitHubCredentialProvider>`, `github: GitHubClient`, `github_lock: tokio::sync::Mutex<()>`, `github_generation: AtomicU64`
  - `const GITHUB_TOKEN_ACCOUNT: &str = "github_token";` (in `lib.rs` and `commands/mod.rs`)

- [ ] **Step 1: Extend AppState, CmdError, and module wiring**

In `src-tauri/src/commands/mod.rs`:

1. Add near the top (after `const LINEAR_KEY_ACCOUNT...`, line 21):

```rust
pub mod github;

const GITHUB_TOKEN_ACCOUNT: &str = "github_token";
```

2. Add to the `use` block (after line 19 `use crate::secrets::SecretStore;`):

```rust
use crate::github::{GitHubClient, GitHubCredentialProvider, GitHubError};
```

3. Add `CmdError` variants (inside the enum, after `ImageUnavailable`, ~line 101):

```rust
    #[error("No GitHub token is configured.")]
    GitHubNotConfigured,
    #[error("GitHub rejected the request.")]
    GitHubApi,
```

4. Add the `From<GitHubError>` impl (after the existing `impl From<LinearError> for CmdError`, ~line 127):

```rust
impl From<GitHubError> for CmdError {
    fn from(e: GitHubError) -> Self {
        match e {
            GitHubError::Network | GitHubError::Server => CmdError::Network,
            GitHubError::RateLimited(_) => CmdError::RateLimited,
            GitHubError::Auth | GitHubError::Api(_) | GitHubError::Malformed => CmdError::GitHubApi,
        }
    }
}
```

5. Add fields to `pub struct AppState` (after `link_preview_inflight`, ~line 155):

```rust
    pub github_credentials: Arc<dyn GitHubCredentialProvider>,
    pub github: GitHubClient,
    /// Serializes GitHub credential mutations and sync (set/clear/test/sync).
    pub github_lock: tokio::sync::Mutex<()>,
    /// Bumped by every GitHub cache wipe; guards a late sync write.
    pub github_generation: AtomicU64,
```

- [ ] **Step 2: Write the failing tests**

Create `src-tauri/src/commands/github.rs`:

```rust
use serde::Serialize;
use sqlx::SqlitePool;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tauri::State;

use super::{AppState, CmdError};
use crate::db::github as gdb;
use crate::github::{GitHubCredentialProvider, GitHubError};
use crate::secrets::SecretStore;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::github::fake::FakeGitHubCreds;
    use crate::secrets::fake::FakeSecretStore;

    async fn pool() -> (tempfile::TempDir, SqlitePool) {
        let dir = tempfile::tempdir().unwrap();
        let pool = crate::db::init_pool(&dir.path().join("astryn/t.db")).await.unwrap();
        (dir, pool)
    }

    #[test]
    fn status_computation() {
        assert!(matches!(compute_github_status(false, None), GitHubStatus::NotConfigured));
        assert!(matches!(compute_github_status(true, None), GitHubStatus::Unverified));
        match compute_github_status(true, Some("octocat".into())) {
            GitHubStatus::Connected { login } => assert_eq!(login, "octocat"),
            _ => panic!("expected Connected"),
        }
    }

    #[tokio::test]
    async fn set_token_wipes_prior_github_state() {
        let (_d, pool) = pool().await;
        // Seed prior account's login so we can prove it is wiped.
        gdb::save_github_login(&pool, "olduser").await.unwrap();
        let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());
        let gen = AtomicU64::new(0);
        set_github_token_logic(store.clone(), &pool, &gen, "ghp_new".into()).await.unwrap();
        assert_eq!(gdb::load_github_login(&pool).await.unwrap(), None);
        assert_eq!(gen.load(Ordering::SeqCst), 1);
        assert_eq!(store.get(GITHUB_TOKEN_ACCOUNT).unwrap(), Some("ghp_new".into()));
    }

    #[tokio::test]
    async fn get_status_is_offline() {
        let (_d, pool) = pool().await;
        let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());
        assert!(matches!(
            get_github_status_logic(store.clone(), &pool).await.unwrap(),
            GitHubStatus::NotConfigured
        ));
        store.set(GITHUB_TOKEN_ACCOUNT, "ghp_x").unwrap();
        gdb::save_github_login(&pool, "octocat").await.unwrap();
        match get_github_status_logic(store, &pool).await.unwrap() {
            GitHubStatus::Connected { login } => assert_eq!(login, "octocat"),
            _ => panic!("expected Connected"),
        }
    }

    #[tokio::test]
    async fn test_connection_caches_login() {
        let (_d, pool) = pool().await;
        let creds: Arc<dyn GitHubCredentialProvider> =
            Arc::new(FakeGitHubCreds(Some("Bearer x".into())));
        let status = test_github_connection_logic(creds, &pool, |_auth| async {
            Ok("octocat".to_string())
        })
        .await
        .unwrap();
        assert!(matches!(status, GitHubStatus::Connected { .. }));
        assert_eq!(gdb::load_github_login(&pool).await.unwrap(), Some("octocat".into()));
    }
}

const GITHUB_TOKEN_ACCOUNT: &str = super::GITHUB_TOKEN_ACCOUNT;
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml commands::github`
Expected: FAIL — `compute_github_status` etc. not found.

- [ ] **Step 4: Implement the logic + commands**

Replace the trailing `const GITHUB_TOKEN_ACCOUNT...` line you added in Step 2 with the full implementation (insert above the `#[cfg(test)] mod tests`):

```rust
use super::GITHUB_TOKEN_ACCOUNT;

#[derive(Serialize, Debug, PartialEq)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum GitHubStatus {
    NotConfigured,
    Unverified,
    Connected { login: String },
}

pub fn compute_github_status(has_token: bool, login: Option<String>) -> GitHubStatus {
    match (has_token, login) {
        (false, _) => GitHubStatus::NotConfigured,
        (true, Some(login)) => GitHubStatus::Connected { login },
        (true, None) => GitHubStatus::Unverified,
    }
}

pub async fn set_github_token_logic(
    store: Arc<dyn SecretStore>,
    pool: &SqlitePool,
    generation: &AtomicU64,
    token: String,
) -> Result<(), CmdError> {
    // Wipe + bump FIRST so a later keyring failure leaves an empty cache (safe),
    // never the new token paired with the previous account's data.
    gdb::wipe_github_cache(pool).await.map_err(|_| CmdError::Internal)?;
    generation.fetch_add(1, Ordering::SeqCst);
    let s = store.clone();
    tokio::task::spawn_blocking(move || s.set(GITHUB_TOKEN_ACCOUNT, &token))
        .await
        .map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::SecretStore)?;
    Ok(())
}

pub async fn clear_github_token_logic(
    store: Arc<dyn SecretStore>,
    pool: &SqlitePool,
    generation: &AtomicU64,
) -> Result<(), CmdError> {
    gdb::wipe_github_cache(pool).await.map_err(|_| CmdError::Internal)?;
    generation.fetch_add(1, Ordering::SeqCst);
    let s = store.clone();
    tokio::task::spawn_blocking(move || s.delete(GITHUB_TOKEN_ACCOUNT))
        .await
        .map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::SecretStore)?;
    Ok(())
}

pub async fn get_github_status_logic(
    store: Arc<dyn SecretStore>,
    pool: &SqlitePool,
) -> Result<GitHubStatus, CmdError> {
    let s = store.clone();
    let has_token = tokio::task::spawn_blocking(move || s.get(GITHUB_TOKEN_ACCOUNT))
        .await
        .map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::SecretStore)?
        .is_some();
    let login = gdb::load_github_login(pool).await.map_err(|_| CmdError::Internal)?;
    Ok(compute_github_status(has_token, login))
}

pub async fn test_github_connection_logic<F, Fut>(
    credentials: Arc<dyn GitHubCredentialProvider>,
    pool: &SqlitePool,
    fetch_login: F,
) -> Result<GitHubStatus, CmdError>
where
    F: FnOnce(String) -> Fut,
    Fut: std::future::Future<Output = Result<String, GitHubError>>,
{
    let c = credentials.clone();
    let auth = tokio::task::spawn_blocking(move || c.authorization())
        .await
        .map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::SecretStore)?
        .ok_or(CmdError::GitHubNotConfigured)?;
    let login = fetch_login(auth).await?;
    gdb::save_github_login(pool, &login).await.map_err(|_| CmdError::Internal)?;
    Ok(GitHubStatus::Connected { login })
}

/// GraphQL `viewer { login }` against the live client.
async fn fetch_viewer_login(
    client: &crate::github::GitHubClient,
    auth: String,
) -> Result<String, GitHubError> {
    let body = serde_json::json!({ "query": "query{ viewer { login } }" });
    let data = client.graphql(&auth, body).await?;
    data.get("viewer")
        .and_then(|v| v.get("login"))
        .and_then(|l| l.as_str())
        .map(Into::into)
        .ok_or(GitHubError::Malformed)
}

#[tauri::command]
pub async fn set_github_token(state: State<'_, AppState>, token: String) -> Result<(), CmdError> {
    let _g = state.github_lock.lock().await;
    set_github_token_logic(state.secret_store.clone(), &state.pool, &state.github_generation, token).await
}

#[tauri::command]
pub async fn clear_github_token(state: State<'_, AppState>) -> Result<(), CmdError> {
    let _g = state.github_lock.lock().await;
    clear_github_token_logic(state.secret_store.clone(), &state.pool, &state.github_generation).await
}

#[tauri::command]
pub async fn get_github_status(state: State<'_, AppState>) -> Result<GitHubStatus, CmdError> {
    get_github_status_logic(state.secret_store.clone(), &state.pool).await
}

#[tauri::command]
pub async fn test_github_connection(state: State<'_, AppState>) -> Result<GitHubStatus, CmdError> {
    let _g = state.github_lock.lock().await;
    let client = state.github.clone();
    test_github_connection_logic(
        state.github_credentials.clone(),
        &state.pool,
        move |auth| async move { fetch_viewer_login(&client, auth).await },
    )
    .await
}
```

(Delete the placeholder `const GITHUB_TOKEN_ACCOUNT: &str = super::GITHUB_TOKEN_ACCOUNT;` line from the bottom of the test scaffold — it is now provided by the `use super::GITHUB_TOKEN_ACCOUNT;` at the top of the implementation.)

- [ ] **Step 5: Wire AppState construction + register commands in lib.rs**

In `src-tauri/src/lib.rs`:

1. Add to the imports (after line 11 `use linear::{...}`):

```rust
use github::{GitHubClient, GitHubCredentialProvider, PatProvider};
```

2. Add the constant (after line 15 `const LINEAR_KEY_ACCOUNT...`):

```rust
const GITHUB_TOKEN_ACCOUNT: &str = "github_token";
```

3. In the `setup` closure, after `let linear = LinearClient::new()...` (line 37), add:

```rust
            let github_credentials: Arc<dyn GitHubCredentialProvider> =
                Arc::new(PatProvider::new(store.clone(), GITHUB_TOKEN_ACCOUNT));
            let github = GitHubClient::new().expect("failed to build GitHub HTTP client");
```

4. In the `app.manage(AppState { ... })` block, add after `link_preview_inflight: ...` (line 53):

```rust
                github_credentials,
                github,
                github_lock: tokio::sync::Mutex::new(()),
                github_generation: std::sync::atomic::AtomicU64::new(0),
```

5. In `tauri::generate_handler![...]`, add after `commands::list_relations` (line 85, add a comma after it):

```rust
            commands::github::set_github_token,
            commands::github::clear_github_token,
            commands::github::get_github_status,
            commands::github::test_github_connection
```

- [ ] **Step 6: Run tests + build to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml commands::github`
Expected: PASS (4 tests).
Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: builds clean.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/commands/github.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat(m4): GitHub connect commands (status, set/clear/test) + AppState wiring"
```

---

## Task 8: Sync + list commands

**Files:**
- Modify: `src-tauri/src/commands/github.rs`
- Modify: `src-tauri/src/lib.rs` (register two commands)

**Interfaces:**
- Consumes: `crate::github::prs::{Bucket, ParsedPr, PageInfo, build_search_body, parse_search_page, PER_BUCKET_CAP, PAGE_SIZE}`, `crate::db::github` (Task 6), `test_*`/`AppState` (Task 7)
- Produces:
  - `struct BucketSyncResult { bucket: String, ok: bool, truncated: bool }` (`camelCase`)
  - `struct PrDashboard { prs: Vec<gdb::PrRow>, meta: Vec<gdb::SyncMeta> }` (`camelCase`)
  - `async fn sync_github_prs_logic<F, Fut>(credentials, pool, generation, now: String, fetch_page: F) -> Result<Vec<BucketSyncResult>, CmdError>` where `F: Fn(String, String, Option<String>) -> Fut`, `Fut: Future<Output = Result<(Vec<ParsedPr>, PageInfo), GitHubError>>`
  - `async fn list_github_prs_logic(pool) -> Result<PrDashboard, CmdError>`
  - commands `sync_github_prs`, `list_github_prs`

- [ ] **Step 1: Write the failing tests**

Add to the `tests` module in `src-tauri/src/commands/github.rs` (extend imports inside the test module with `use crate::github::prs::{Bucket, PageInfo, ParsedPr};` and `use std::sync::Mutex;`; `fetch_bucket` and `sync_github_prs_logic` resolve via the existing `use super::*;`):

```rust
    fn page_pr(n: i64) -> ParsedPr {
        ParsedPr {
            id: format!("o/r#{n}"), repo: "o/r".into(), number: n, title: Some("t".into()),
            draft: false, mergeable: Some("mergeable".into()), ci_status: Some("success".into()),
            review_decision: None, author_login: Some("octocat".into()), author_avatar: None,
            comment_count: Some(0), branch: Some("b".into()), url: Some("u".into()),
            linear_identifier: None, updated_at: Some("2026-06-20T00:00:00Z".into()),
        }
    }

    #[tokio::test]
    async fn sync_populates_all_buckets() {
        let (_d, pool) = pool().await;
        let creds: Arc<dyn GitHubCredentialProvider> = Arc::new(FakeGitHubCreds(Some("Bearer x".into())));
        let gen = AtomicU64::new(0);
        let results = sync_github_prs_logic(creds, &pool, &gen, "now".into(), |_a, _q, _c| async {
            Ok((vec![page_pr(1)], PageInfo { has_next_page: false, end_cursor: None }))
        })
        .await
        .unwrap();
        assert_eq!(results.len(), 4);
        assert!(results.iter().all(|r| r.ok && !r.truncated));
        let dash = list_github_prs_logic(&pool).await.unwrap();
        assert_eq!(dash.prs.len(), 4); // one PR per bucket
        assert_eq!(dash.meta.len(), 4);
    }

    #[tokio::test]
    async fn sync_failure_leaves_prior_cache() {
        let (_d, pool) = pool().await;
        // Pre-seed one bucket so we can prove a later failed sync preserves it.
        gdb::replace_bucket(&pool, "needs_review", &[page_pr(7)], "old", false).await.unwrap();
        let creds: Arc<dyn GitHubCredentialProvider> = Arc::new(FakeGitHubCreds(Some("Bearer x".into())));
        let gen = AtomicU64::new(0);
        let results = sync_github_prs_logic(creds, &pool, &gen, "now".into(), |_a, _q, _c| async {
            Err(GitHubError::Network)
        })
        .await
        .unwrap();
        assert!(results.iter().all(|r| !r.ok));
        // The previously-cached needs_review PR survives the failed refresh.
        let dash = list_github_prs_logic(&pool).await.unwrap();
        assert_eq!(dash.prs.iter().filter(|p| p.bucket == "needs_review").count(), 1);
    }

    #[tokio::test]
    async fn sync_caps_and_flags_truncation() {
        let (_d, pool) = pool().await;
        let creds: Arc<dyn GitHubCredentialProvider> = Arc::new(FakeGitHubCreds(Some("Bearer x".into())));
        let gen = AtomicU64::new(0);
        let calls = Arc::new(Mutex::new(0u32));
        let calls2 = calls.clone();
        // Each call returns 100 distinct PRs, a CHANGING cursor, and claims more.
        sync_github_prs_logic(creds, &pool, &gen, "now".into(), move |_a, _q, _c| {
            let calls = calls2.clone();
            async move {
                let n = { let mut g = calls.lock().unwrap(); let n = *g; *g += 1; n };
                let prs = (0..100).map(|i| page_pr((n * 100) as i64 + i)).collect();
                Ok((prs, PageInfo { has_next_page: true, end_cursor: Some(format!("c{n}")) }))
            }
        })
        .await
        .unwrap();
        let dash = list_github_prs_logic(&pool).await.unwrap();
        assert_eq!(dash.prs.len(), 1200); // capped at 300 per bucket × 4 buckets
        assert!(dash.meta.iter().all(|m| m.truncated));
    }

    #[tokio::test]
    async fn fetch_bucket_exact_300_is_not_truncated() {
        let calls = Arc::new(Mutex::new(0u32));
        let calls2 = calls.clone();
        // Three full pages (300), then the server reports no more pages.
        let (prs, truncated) = fetch_bucket("auth", Bucket::Mine, &move |_a, _q, _c| {
            let calls = calls2.clone();
            async move {
                let n = { let mut g = calls.lock().unwrap(); let n = *g; *g += 1; n };
                let last = n == 2;
                let page = (0..100).map(|i| page_pr((n * 100) as i64 + i)).collect();
                Ok((page, PageInfo { has_next_page: !last, end_cursor: if last { None } else { Some(format!("c{n}")) } }))
            }
        })
        .await
        .unwrap();
        assert_eq!(prs.len(), 300);
        assert_eq!(truncated, false);
    }

    #[tokio::test]
    async fn fetch_bucket_more_than_300_is_truncated() {
        let calls = Arc::new(Mutex::new(0u32));
        let calls2 = calls.clone();
        // Three full pages (300) and the server still reports another page.
        let (prs, truncated) = fetch_bucket("auth", Bucket::Mine, &move |_a, _q, _c| {
            let calls = calls2.clone();
            async move {
                let n = { let mut g = calls.lock().unwrap(); let n = *g; *g += 1; n };
                let page = (0..100).map(|i| page_pr((n * 100) as i64 + i)).collect();
                Ok((page, PageInfo { has_next_page: true, end_cursor: Some(format!("c{n}")) }))
            }
        })
        .await
        .unwrap();
        assert_eq!(prs.len(), 300);
        assert_eq!(truncated, true);
    }

    #[tokio::test]
    async fn fetch_bucket_repeated_cursor_is_malformed() {
        let err = fetch_bucket("auth", Bucket::Mine, &|_a, _q, _c| async {
            // Always claims more with the SAME cursor -> would loop forever.
            Ok((vec![page_pr(1)], PageInfo { has_next_page: true, end_cursor: Some("same".into()) }))
        })
        .await;
        assert!(matches!(err, Err(GitHubError::Malformed)));
    }

    #[tokio::test]
    async fn fetch_bucket_missing_cursor_is_malformed() {
        let err = fetch_bucket("auth", Bucket::Mine, &|_a, _q, _c| async {
            Ok((vec![page_pr(1)], PageInfo { has_next_page: true, end_cursor: None }))
        })
        .await;
        assert!(matches!(err, Err(GitHubError::Malformed)));
    }

    #[tokio::test]
    async fn sync_aborts_and_writes_nothing_when_generation_changes() {
        let (_d, pool) = pool().await;
        let creds: Arc<dyn GitHubCredentialProvider> = Arc::new(FakeGitHubCreds(Some("Bearer x".into())));
        let gen = AtomicU64::new(0);
        // Bump the generation mid-fetch (simulating a token swap) so the guard trips.
        let result = sync_github_prs_logic(creds, &pool, &gen, "now".into(), |_a, _q, _c| {
            gen.fetch_add(1, Ordering::SeqCst);
            async { Ok((vec![page_pr(1)], PageInfo { has_next_page: false, end_cursor: None })) }
        })
        .await;
        assert!(matches!(result, Err(CmdError::WorkspaceChanged)));
        assert!(list_github_prs_logic(&pool).await.unwrap().prs.is_empty());
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml commands::github`
Expected: FAIL — `sync_github_prs_logic` / `list_github_prs_logic` not found.

- [ ] **Step 3: Implement**

Add to `src-tauri/src/commands/github.rs` (above the `#[cfg(test)] mod tests`), and extend the top `use` lines with:

```rust
use crate::github::prs::{
    build_search_body, parse_search_page, Bucket, PageInfo, ParsedPr, PAGE_SIZE, PER_BUCKET_CAP,
};
```

Implementation:

```rust
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BucketSyncResult {
    pub bucket: String,
    pub ok: bool,
    pub truncated: bool,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PrDashboard {
    pub prs: Vec<gdb::PrRow>,
    pub meta: Vec<gdb::SyncMeta>,
}

/// Fetch one bucket to completion (or the cap), deduping by id within the bucket.
async fn fetch_bucket<F, Fut>(
    auth: &str,
    bucket: Bucket,
    fetch_page: &F,
) -> Result<(Vec<ParsedPr>, bool), GitHubError>
where
    F: Fn(String, String, Option<String>) -> Fut,
    Fut: std::future::Future<Output = Result<(Vec<ParsedPr>, PageInfo), GitHubError>>,
{
    let query = bucket.search_query();
    let mut acc: Vec<ParsedPr> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut cursor: Option<String> = None;
    loop {
        let (prs, page) = fetch_page(auth.to_string(), query.clone(), cursor.clone()).await?;
        for p in prs {
            if seen.insert(p.id.clone()) {
                acc.push(p);
            }
        }
        // A single page crossing the cap -> definitely truncated.
        if acc.len() > PER_BUCKET_CAP {
            acc.truncate(PER_BUCKET_CAP);
            return Ok((acc, true));
        }
        // Reached the cap exactly: trust the server's hasNextPage for truncation.
        if acc.len() == PER_BUCKET_CAP {
            return Ok((acc, page.has_next_page));
        }
        // Genuinely exhausted: not truncated.
        if !page.has_next_page {
            return Ok((acc, false));
        }
        // Must advance with a NEW, non-empty cursor, else the server is buggy and
        // we would loop forever (dedup hides the repeat) — treat as malformed.
        match page.end_cursor {
            Some(next) if Some(&next) != cursor.as_ref() => cursor = Some(next),
            _ => return Err(GitHubError::Malformed),
        }
    }
}

pub async fn sync_github_prs_logic<F, Fut>(
    credentials: Arc<dyn GitHubCredentialProvider>,
    pool: &SqlitePool,
    generation: &AtomicU64,
    now: String,
    fetch_page: F,
) -> Result<Vec<BucketSyncResult>, CmdError>
where
    F: Fn(String, String, Option<String>) -> Fut,
    Fut: std::future::Future<Output = Result<(Vec<ParsedPr>, PageInfo), GitHubError>>,
{
    let c = credentials.clone();
    let auth = tokio::task::spawn_blocking(move || c.authorization())
        .await
        .map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::SecretStore)?
        .ok_or(CmdError::GitHubNotConfigured)?;
    let gen0 = generation.load(Ordering::SeqCst);
    let mut results = Vec::new();
    for bucket in Bucket::all() {
        match fetch_bucket(&auth, bucket, &fetch_page).await {
            Ok((prs, truncated)) => {
                // Abort the whole sync if the credential changed mid-flight: a
                // partial (shortened) summary is ambiguous, so surface an error
                // and write nothing further.
                if generation.load(Ordering::SeqCst) != gen0 {
                    return Err(CmdError::WorkspaceChanged);
                }
                gdb::replace_bucket(pool, bucket.key(), &prs, &now, truncated)
                    .await
                    .map_err(|_| CmdError::Internal)?;
                results.push(BucketSyncResult { bucket: bucket.key().into(), ok: true, truncated });
            }
            Err(_) => {
                results.push(BucketSyncResult { bucket: bucket.key().into(), ok: false, truncated: false });
            }
        }
    }
    Ok(results)
}

pub async fn list_github_prs_logic(pool: &SqlitePool) -> Result<PrDashboard, CmdError> {
    let prs = gdb::list_prs(pool).await.map_err(|_| CmdError::Internal)?;
    let meta = gdb::load_sync_meta(pool).await.map_err(|_| CmdError::Internal)?;
    Ok(PrDashboard { prs, meta })
}

fn now_iso() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default()
}

#[tauri::command]
pub async fn sync_github_prs(state: State<'_, AppState>) -> Result<Vec<BucketSyncResult>, CmdError> {
    let _g = state.github_lock.lock().await;
    let client = state.github.clone();
    sync_github_prs_logic(
        state.github_credentials.clone(),
        &state.pool,
        &state.github_generation,
        now_iso(),
        move |auth, query, cursor| {
            let client = client.clone();
            async move {
                let body = build_search_body(&query, PAGE_SIZE, cursor.as_deref());
                let data = client.graphql(&auth, body).await?;
                parse_search_page(&data)
            }
        },
    )
    .await
}

#[tauri::command]
pub async fn list_github_prs(state: State<'_, AppState>) -> Result<PrDashboard, CmdError> {
    list_github_prs_logic(&state.pool).await
}
```

- [ ] **Step 4: Register the commands in lib.rs**

In `src-tauri/src/lib.rs` `generate_handler![...]`, after `commands::github::test_github_connection` add a comma then:

```rust
            commands::github::sync_github_prs,
            commands::github::list_github_prs
```

- [ ] **Step 5: Run tests + build to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml commands::github`
Expected: PASS.
Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: builds clean.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/github.rs src-tauri/src/lib.rs
git commit -m "feat(m4): sync_github_prs (paged, capped, txn-per-bucket) + list_github_prs"
```

---

## Task 9: Frontend command bindings + types

**Files:**
- Modify: `src/lib/commands.ts`

**Interfaces:**
- Produces (TS):
  - `type GitHubStatus = { state: "not_configured" } | { state: "unverified" } | { state: "connected"; login: string }`
  - `type PrBucket = "needs_review" | "mine" | "assigned" | "involved"`
  - `type GithubPr` (camelCase mirror of `PrRow`), `type GithubSyncMeta`, `type PrDashboard`, `type BucketSyncResult`
  - bindings: `setGithubToken`, `clearGithubToken`, `getGithubStatus`, `testGithubConnection`, `syncGithubPrs`, `listGithubPrs`

- [ ] **Step 1: Add the types and bindings**

Append to `src/lib/commands.ts`:

```typescript
// ── M4 GitHub PR dashboard ──────────────────────────────────────────────────

export type GitHubStatus =
  | { state: "not_configured" }
  | { state: "unverified" }
  | { state: "connected"; login: string };

export type PrBucket = "needs_review" | "mine" | "assigned" | "involved";

export type GithubPr = {
  id: string;
  bucket: PrBucket;
  repo: string;
  number: number;
  title: string | null;
  draft: boolean;
  mergeable: "mergeable" | "conflicting" | "unknown" | null;
  ciStatus: "success" | "failure" | "pending" | "none" | null;
  reviewDecision: "approved" | "changes_requested" | "review_required" | null;
  authorLogin: string | null;
  authorAvatar: string | null;
  commentCount: number | null;
  branch: string | null;
  url: string | null;
  linearIdentifier: string | null;
  linearIssueId: string | null;
  updatedAt: string | null;
};

export type GithubSyncMeta = {
  bucket: PrBucket;
  fetchedCount: number;
  truncated: boolean;
  lastSyncedAt: string | null;
};

export type PrDashboard = { prs: GithubPr[]; meta: GithubSyncMeta[] };
export type BucketSyncResult = { bucket: PrBucket; ok: boolean; truncated: boolean };

export const setGithubToken = (token: string): Promise<void> =>
  invoke("set_github_token", { token });

export const clearGithubToken = (): Promise<void> => invoke("clear_github_token");

export const getGithubStatus = (): Promise<GitHubStatus> => invoke("get_github_status");

export const testGithubConnection = (): Promise<GitHubStatus> =>
  invoke("test_github_connection");

export const syncGithubPrs = (): Promise<BucketSyncResult[]> => invoke("sync_github_prs");

export const listGithubPrs = (): Promise<PrDashboard> => invoke("list_github_prs");
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/commands.ts
git commit -m "feat(m4): typed GitHub PR dashboard command bindings"
```

---

## Task 10: Frontend query hooks

**Files:**
- Modify: `src/lib/queries.ts`

**Interfaces:**
- Consumes: bindings from Task 9
- Produces: `useGithubStatus()`, `useGithubPrs()`, `useGithubSync()`, `clearGithubQueries(qc)`

- [ ] **Step 1: Write the failing test**

Create `src/lib/githubQueries.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const listGithubPrs = vi.hoisted(() => vi.fn());
const syncGithubPrs = vi.hoisted(() => vi.fn());
vi.mock("@/lib/commands", () => ({
  listGithubPrs,
  syncGithubPrs,
  getGithubStatus: vi.fn(),
}));

import { useGithubPrs, useGithubSync } from "./queries";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("GitHub query hooks", () => {
  it("useGithubPrs returns the cached dashboard", async () => {
    listGithubPrs.mockResolvedValue({ prs: [{ id: "o/r#1", bucket: "mine" }], meta: [] });
    const { result } = renderHook(() => useGithubPrs(), { wrapper });
    await waitFor(() => expect(result.current.data?.prs).toHaveLength(1));
  });

  it("useGithubSync(false) never hits the network", async () => {
    syncGithubPrs.mockResolvedValue([]);
    renderHook(() => useGithubSync(false), { wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(syncGithubPrs).not.toHaveBeenCalled();
  });

  it("useGithubSync(true) syncs then invalidates the cached list", async () => {
    listGithubPrs.mockResolvedValue({ prs: [], meta: [] });
    syncGithubPrs.mockResolvedValue([]);
    // Render both hooks so the sync-driven invalidation refetches the list.
    renderHook(() => { useGithubPrs(); return useGithubSync(true); }, { wrapper });
    await waitFor(() => expect(syncGithubPrs).toHaveBeenCalled());
    await waitFor(() => expect(listGithubPrs.mock.calls.length).toBeGreaterThanOrEqual(2));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- githubQueries`
Expected: FAIL — `useGithubPrs` is not exported.

- [ ] **Step 3: Implement the hooks**

In `src/lib/queries.ts`, add `getGithubStatus, listGithubPrs, syncGithubPrs` (values only — do not import the `GitHubStatus` type, it is not referenced here and `noUnusedLocals` would fail) to the existing `@/lib/commands` import block, then append:

```typescript
export function useGithubStatus() {
  return useQuery({ queryKey: ["github-status"], queryFn: getGithubStatus });
}

export function useGithubPrs() {
  return useQuery({ queryKey: ["github-prs"], queryFn: listGithubPrs });
}

/**
 * Background GitHub sync: runs on mount + every 5 minutes while a token is
 * present, then invalidates the cached list so fresh rows render. Disabled
 * entirely when not configured (no token -> no network).
 */
export function useGithubSync(enabled: boolean) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ["github-sync"],
    enabled,
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const results = await syncGithubPrs();
      await qc.invalidateQueries({ queryKey: ["github-prs"] });
      return results;
    },
  });
}

export function clearGithubQueries(qc: QueryClient) {
  for (const key of [["github-status"], ["github-prs"], ["github-sync"]]) {
    qc.cancelQueries({ queryKey: key });
    qc.removeQueries({ queryKey: key });
  }
}
```

- [ ] **Step 4: Run test + typecheck to verify they pass**

Run: `npm test -- githubQueries`
Expected: PASS.
Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/queries.ts src/lib/githubQueries.test.tsx
git commit -m "feat(m4): GitHub dashboard query hooks (status, list, background sync)"
```

---

## Task 11: PR row component

**Files:**
- Create: `src/features/prs/PrRow.tsx`
- Create: `src/features/prs/PrRow.test.tsx`

**Interfaces:**
- Consumes: `GithubPr` (Task 9), workspace context `openIssueTab` (from `@/lib/tabs`)
- Produces: `function PrRow({ pr }: { pr: GithubPr })`

- [ ] **Step 1: Write the failing tests**

Create `src/features/prs/PrRow.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { GithubPr } from "@/lib/commands";

const openIssueTab = vi.hoisted(() => vi.fn());
vi.mock("@/lib/tabs", () => ({ useWorkspace: () => ({ openIssueTab }) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

import { PrRow } from "./PrRow";

const base: GithubPr = {
  id: "o/r#42", bucket: "mine", repo: "o/r", number: 42, title: "Add widget", draft: false,
  mergeable: "mergeable", ciStatus: "success", reviewDecision: "changes_requested",
  authorLogin: "octocat", authorAvatar: "https://a/x.png", commentCount: 3, branch: "eng-9",
  url: "https://x", linearIdentifier: "ENG-9", linearIssueId: "iss-1", updatedAt: "2026-06-20T00:00:00Z",
};

afterEach(cleanup);

describe("PrRow", () => {
  it("shows core fields, avatar, relative time, and changes-requested badge", () => {
    render(<PrRow pr={base} />);
    expect(screen.getByText("Add widget")).toBeInTheDocument();
    expect(screen.getByText("#42")).toBeInTheDocument();
    expect(screen.getByText("octocat")).toBeInTheDocument();
    expect(screen.getByText("o/r")).toBeInTheDocument();
    expect(screen.getByText(/changes requested/i)).toBeInTheDocument();
    expect(screen.getByRole("img")).toHaveAttribute("src", "https://a/x.png");
    expect(screen.getByTestId("pr-updated").textContent).not.toBe("");
  });

  it("opens the linked Linear issue when the chip is clicked", () => {
    render(<PrRow pr={base} />);
    fireEvent.click(screen.getByRole("button", { name: /ENG-9/ }));
    expect(openIssueTab).toHaveBeenCalledWith("iss-1");
  });

  it("renders no Linear chip without a matched issue id", () => {
    render(<PrRow pr={{ ...base, linearIssueId: null }} />);
    expect(screen.queryByRole("button", { name: /ENG-9/ })).toBeNull();
  });

  it("shows a conflict badge only when conflicting", () => {
    const { rerender } = render(<PrRow pr={{ ...base, mergeable: "conflicting" }} />);
    expect(screen.getByText(/conflict/i)).toBeInTheDocument();
    rerender(<PrRow pr={{ ...base, mergeable: "mergeable" }} />);
    expect(screen.queryByText(/conflict/i)).toBeNull();
  });

  it("shows explicit open vs draft status", () => {
    const { rerender } = render(<PrRow pr={base} />);
    expect(screen.getByText("Open")).toBeInTheDocument();
    rerender(<PrRow pr={{ ...base, draft: true }} />);
    expect(screen.getByText("Draft")).toBeInTheDocument();
  });

  it.each([
    ["success", "CI passing"],
    ["failure", "CI failing"],
    ["pending", "CI pending"],
  ] as const)("renders a CI badge for %s", (ci, label) => {
    render(<PrRow pr={{ ...base, ciStatus: ci }} />);
    expect(screen.getByLabelText(label)).toBeInTheDocument();
  });

  it.each(["none", null] as const)("renders no CI badge for %s", (ci) => {
    render(<PrRow pr={{ ...base, ciStatus: ci }} />);
    expect(screen.queryByLabelText(/^CI /)).toBeNull();
  });

  it.each([
    ["approved", /approved/i],
    ["changes_requested", /changes requested/i],
    ["review_required", /review required/i],
  ] as const)("renders the %s review label", (decision, re) => {
    render(<PrRow pr={{ ...base, reviewDecision: decision }} />);
    expect(screen.getByText(re)).toBeInTheDocument();
  });

  it("renders no review label when null", () => {
    render(<PrRow pr={{ ...base, reviewDecision: null }} />);
    expect(screen.queryByText(/approved|changes requested|review required/i)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- PrRow`
Expected: FAIL — cannot resolve `./PrRow`.

- [ ] **Step 3: Implement**

Create `src/features/prs/PrRow.tsx`:

```tsx
import { openUrl } from "@tauri-apps/plugin-opener";
import { GitPullRequest, MessageSquare, GitMerge, CheckCircle2, XCircle, Clock } from "lucide-react";
import { useWorkspace } from "@/lib/tabs";
import { timeAgo } from "@/features/drawer/timeAgo";
import type { GithubPr } from "@/lib/commands";

const REVIEW_LABEL: Record<NonNullable<GithubPr["reviewDecision"]>, string> = {
  approved: "Approved",
  changes_requested: "Changes requested",
  review_required: "Review required",
};

function CiBadge({ status }: { status: GithubPr["ciStatus"] }) {
  if (!status || status === "none") return null;
  const map = {
    success: { Icon: CheckCircle2, cls: "text-emerald-400", label: "CI passing" },
    failure: { Icon: XCircle, cls: "text-red-400", label: "CI failing" },
    pending: { Icon: Clock, cls: "text-amber-400", label: "CI pending" },
  } as const;
  const { Icon, cls, label } = map[status];
  return <Icon aria-label={label} className={`size-3.5 ${cls}`} />;
}

export function PrRow({ pr }: { pr: GithubPr }) {
  const { openIssueTab } = useWorkspace();
  const relative = pr.updatedAt ? timeAgo(pr.updatedAt) : "";

  return (
    <div className="flex items-center gap-3 border-b border-border/60 px-4 py-2.5 text-sm hover:bg-white/5">
      <GitPullRequest className={`size-4 shrink-0 ${pr.draft ? "text-muted-foreground" : "text-emerald-400"}`} />
      <button
        type="button"
        onClick={() => pr.url && openUrl(pr.url)}
        className="min-w-0 flex-1 truncate text-left text-foreground hover:underline"
      >
        {pr.title ?? "(untitled)"}
      </button>

      <span className="shrink-0 rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
        {pr.draft ? "Draft" : "Open"}
      </span>
      {pr.reviewDecision && (
        <span className="shrink-0 rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
          {REVIEW_LABEL[pr.reviewDecision]}
        </span>
      )}
      {pr.mergeable === "conflicting" && (
        <span className="flex shrink-0 items-center gap-1 text-[11px] text-amber-400">
          <GitMerge className="size-3.5" /> Conflict
        </span>
      )}
      <CiBadge status={pr.ciStatus} />

      {pr.linearIssueId && (
        <button
          type="button"
          aria-label={`Open ${pr.linearIdentifier}`}
          onClick={() => openIssueTab(pr.linearIssueId!)}
          className="shrink-0 rounded-md border border-primary/40 px-1.5 py-0.5 text-[11px] text-primary hover:bg-primary/10"
        >
          {pr.linearIdentifier}
        </button>
      )}

      <span className="shrink-0 text-[11px] text-muted-foreground">#{pr.number}</span>
      <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">{pr.repo}</span>
      {pr.commentCount != null && pr.commentCount > 0 && (
        <span className="flex shrink-0 items-center gap-0.5 text-[11px] text-muted-foreground">
          <MessageSquare className="size-3" /> {pr.commentCount}
        </span>
      )}
      {pr.authorAvatar && (
        <img src={pr.authorAvatar} alt={pr.authorLogin ? `${pr.authorLogin} avatar` : "author"} className="size-4 shrink-0 rounded-full" />
      )}
      {pr.authorLogin && (
        <span className="shrink-0 text-[11px] text-muted-foreground">{pr.authorLogin}</span>
      )}
      <span data-testid="pr-updated" className="shrink-0 text-[11px] text-muted-foreground">{relative}</span>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- PrRow`
Expected: PASS (all cases — core/avatar/time, chip open, no-chip, conflict, open/draft, CI states, review states, null review).

- [ ] **Step 5: Commit**

```bash
git add src/features/prs/PrRow.tsx src/features/prs/PrRow.test.tsx
git commit -m "feat(m4): PR row with status/CI/review/conflict badges + Linear chip"
```

---

## Task 12: Navigation wiring + PrsPage shell (connect/empty state)

**Files:**
- Modify: `src/lib/paneModel.ts:1,11`
- Modify: `src/components/Dock.tsx:36-44`
- Modify: `src/components/PaneTabStrip.tsx:11-18`
- Modify: `src/components/SplitLayout.tsx:34-51`
- Modify: `src/features/command/CommandPalette.tsx:197-201` (add a "Go to Pull Requests" command)
- Create: `src/features/prs/PrsPage.tsx`
- Create: `src/features/prs/PrsPage.test.tsx`

**Interfaces:**
- Consumes: `useGithubStatus`, `useGithubPrs`, `useGithubSync` (Task 10), `PrRow` (Task 11)
- Produces: `"prs"` view kind; `function PrsPage()`

- [ ] **Step 1: Add the view kind**

In `src/lib/paneModel.ts`:
- Line 1: change the union to include `"prs"`:

```typescript
export type ViewKind = "calendar" | "list" | "this-week" | "graph" | "inbox" | "prs" | "settings" | "issue";
```

- Line 11: add `"prs"` to `VIEWS`:

```typescript
export const VIEWS: ViewKind[] = ["calendar", "list", "this-week", "graph", "inbox", "prs", "settings", "issue"];
```

- [ ] **Step 2: Add Dock nav + meta entries**

In `src/components/Dock.tsx`:
- Line 2: add `GitPullRequest` to the lucide import.
- In the `NAV` array (after the `inbox` entry, line 43):

```typescript
  { view: "prs", label: "Pull Requests", icon: <GitPullRequest className="size-5" /> },
```

- In the `META` record (add a `prs` key):

```typescript
prs: "Pull Requests",
```

- [ ] **Step 3: Add the tab-strip meta entry**

In `src/components/PaneTabStrip.tsx`:
- Line 2: add `GitPullRequest` to the lucide import.
- In the `META` record (after the `inbox` entry, line 16):

```typescript
  prs: { label: "Pull Requests", icon: <GitPullRequest className="size-3.5" /> },
```

- [ ] **Step 4: Add the render case**

In `src/components/SplitLayout.tsx`:
- After line 28, add the import:

```typescript
import { PrsPage } from "@/features/prs/PrsPage";
```

- In `PaneContent`'s switch, after the `inbox` case (line 45):

```typescript
    case "prs":
      return <PrsPage />;
```

- [ ] **Step 5: Add the command-palette destination**

In `src/features/command/CommandPalette.tsx`:
- Add `GitPullRequest` to the lucide-react import (line 32 area / the icon import block).
- In the `commands` array, after the `go-inbox` entry (line 200):

```typescript
      { key: "go-prs", section: "Go to", icon: <GitPullRequest className="size-4" />, label: "Go to Pull Requests", onSelect: () => goTo("prs") },
```

- [ ] **Step 6: Write the failing test**

Create `src/features/prs/PrsPage.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { GithubPr } from "@/lib/commands";

const hooks = vi.hoisted(() => ({
  useGithubStatus: vi.fn(),
  useGithubPrs: vi.fn(),
  useGithubSync: vi.fn(),
}));
const setActiveView = vi.hoisted(() => vi.fn());
const refetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/queries", () => hooks);
vi.mock("@/lib/tabs", () => ({ useWorkspace: () => ({ setActiveView, openIssueTab: vi.fn() }) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

import { PrsPage } from "./PrsPage";

afterEach(() => { cleanup(); refetch.mockClear(); });

function pr(id: string, bucket: GithubPr["bucket"]): GithubPr {
  return {
    id, bucket, repo: "o/r", number: 1, title: "Add widget", draft: false, mergeable: "mergeable",
    ciStatus: "success", reviewDecision: null, authorLogin: "octocat", authorAvatar: null,
    commentCount: 0, branch: "b", url: "https://x", linearIdentifier: null, linearIssueId: null,
    updatedAt: "2026-06-20T00:00:00Z",
  };
}

function setup(status: unknown, prs: GithubPr[] = [], meta: unknown[] = [], sync: unknown = {}) {
  hooks.useGithubStatus.mockReturnValue({ data: status });
  hooks.useGithubPrs.mockReturnValue({ data: { prs, meta } });
  hooks.useGithubSync.mockReturnValue({ data: undefined, isError: false, refetch, ...(sync as object) });
}

describe("PrsPage", () => {
  it("shows a connect prompt when not configured", () => {
    setup({ state: "not_configured" });
    render(<PrsPage />);
    expect(screen.getByText(/connect github/i)).toBeInTheDocument();
  });

  it("renders the four section headings when connected", () => {
    setup({ state: "connected", login: "octocat" });
    render(<PrsPage />);
    expect(screen.getByText(/needs my review/i)).toBeInTheDocument();
    expect(screen.getByText(/my open prs/i)).toBeInTheDocument();
    expect(screen.getByText(/assigned to me/i)).toBeInTheDocument();
    expect(screen.getByText(/involved/i)).toBeInTheDocument();
  });

  it("manual refresh triggers a sync refetch", () => {
    setup({ state: "connected", login: "octocat" });
    render(<PrsPage />);
    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it("renders a PR in every bucket it legitimately belongs to", () => {
    setup({ state: "connected", login: "octocat" }, [pr("o/r#1", "needs_review"), pr("o/r#1", "mine")]);
    render(<PrsPage />);
    // Same PR title shown once under each of the two sections.
    expect(screen.getAllByText("Add widget")).toHaveLength(2);
  });

  it("shows a per-section truncation note from sync meta", () => {
    setup(
      { state: "connected", login: "octocat" },
      [],
      [{ bucket: "mine", fetchedCount: 300, truncated: true, lastSyncedAt: null }],
    );
    render(<PrsPage />);
    expect(screen.getByText(/300 most recent/i)).toBeInTheDocument();
  });

  it("flags a section that failed to refresh", () => {
    setup(
      { state: "connected", login: "octocat" },
      [],
      [],
      { data: [{ bucket: "needs_review", ok: false, truncated: false }] },
    );
    render(<PrsPage />);
    expect(screen.getByText(/couldn't refresh/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npm test -- PrsPage`
Expected: FAIL — cannot resolve `./PrsPage`.

- [ ] **Step 8: Implement PrsPage**

Create `src/features/prs/PrsPage.tsx`:

```tsx
import { GitPullRequest, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/lib/tabs";
import { useGithubPrs, useGithubStatus, useGithubSync } from "@/lib/queries";
import type { GithubPr, GithubSyncMeta, PrBucket } from "@/lib/commands";
import { PrRow } from "./PrRow";

const SECTIONS: { bucket: PrBucket; title: string; empty: string }[] = [
  { bucket: "needs_review", title: "Needs my review", empty: "Nothing awaiting your review." },
  { bucket: "mine", title: "My open PRs", empty: "You have no open PRs." },
  { bucket: "assigned", title: "Assigned to me", empty: "No PRs assigned to you." },
  { bucket: "involved", title: "Involved / mentioned", empty: "Nothing else involving you." },
];

function Section({
  title,
  empty,
  prs,
  meta,
  stale,
}: {
  title: string;
  empty: string;
  prs: GithubPr[];
  meta: GithubSyncMeta | undefined;
  stale: boolean;
}) {
  return (
    <section className="flex flex-col">
      <div className="flex items-center gap-2 px-4 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
        <span className="rounded-full bg-white/10 px-1.5 text-[11px] text-muted-foreground">{prs.length}</span>
        {meta?.truncated && (
          <span className="text-[11px] text-amber-400">showing 300 most recent</span>
        )}
        {stale && <span className="text-[11px] text-amber-400">couldn't refresh — cached</span>}
      </div>
      {prs.length === 0 ? (
        <p className="px-4 pb-3 text-xs text-muted-foreground">{empty}</p>
      ) : (
        prs.map((pr) => <PrRow key={`${pr.bucket}:${pr.id}`} pr={pr} />)
      )}
    </section>
  );
}

export function PrsPage() {
  const { setActiveView } = useWorkspace();
  const { data: status } = useGithubStatus();
  const connected = status?.state === "connected" || status?.state === "unverified";
  const { data: dashboard } = useGithubPrs();
  const sync = useGithubSync(connected);

  if (status?.state === "not_configured") {
    return (
      <main className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <GitPullRequest className="size-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Connect GitHub to see your pull requests.</p>
        <Button onClick={() => setActiveView("settings")}>Connect GitHub</Button>
      </main>
    );
  }

  const prs = dashboard?.prs ?? [];
  const meta = dashboard?.meta ?? [];
  const failed = new Set((sync.data ?? []).filter((r) => !r.ok).map((r) => r.bucket));

  return (
    <main className="flex h-full flex-col overflow-y-auto">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-semibold">Pull Requests</h1>
          {sync.isError && (
            <span className="text-[11px] text-amber-400">Sync failed — showing cached data.</span>
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
      {SECTIONS.map((s) => (
        <Section
          key={s.bucket}
          title={s.title}
          empty={s.empty}
          prs={prs.filter((p) => p.bucket === s.bucket)}
          meta={meta.find((m) => m.bucket === s.bucket)}
          stale={failed.has(s.bucket)}
        />
      ))}
    </main>
  );
}
```

- [ ] **Step 9: Run test + typecheck to verify they pass**

Run: `npm test -- PrsPage`
Expected: PASS (connect prompt, four headings, manual refresh, cross-bucket duplication, per-section truncation note, failed-section flag).
Run: `npx tsc --noEmit`
Expected: no errors (the exhaustive `PaneContent` switch and both `META` records now cover `"prs"`).

- [ ] **Step 10: Commit**

```bash
git add src/lib/paneModel.ts src/components/Dock.tsx src/components/PaneTabStrip.tsx src/components/SplitLayout.tsx src/features/command/CommandPalette.tsx src/features/prs/PrsPage.tsx src/features/prs/PrsPage.test.tsx
git commit -m "feat(m4): wire PRs view into nav + palette + PrsPage shell (sections, connect/stale states)"
```

---

## Task 13: Settings — GitHub connect card

**Files:**
- Modify: `src/features/settings/Settings.tsx`
- Create: `src/features/settings/Settings.test.tsx`

**Interfaces:**
- Consumes: `setGithubToken`, `clearGithubToken`, `getGithubStatus`, `testGithubConnection` (Task 9), `clearGithubQueries` (Task 10)

- [ ] **Step 1: Write the failing test**

Create `src/features/settings/Settings.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const cmd = vi.hoisted(() => ({
  getConnectionStatus: vi.fn().mockResolvedValue({ state: "not_configured" }),
  getGithubStatus: vi.fn().mockResolvedValue({ state: "not_configured" }),
  setGithubToken: vi.fn().mockResolvedValue(undefined),
  clearGithubToken: vi.fn(),
  testGithubConnection: vi.fn(),
  setLinearKey: vi.fn(), clearLinearKey: vi.fn(), testLinearConnection: vi.fn(),
  syncIssues: vi.fn(), errorText: (e: unknown) => String(e),
}));
vi.mock("@/lib/commands", () => cmd);
vi.mock("@/lib/queries", () => ({
  clearWorkspaceQueries: vi.fn(), invalidateWorkspaceQueries: vi.fn(), clearGithubQueries: vi.fn(),
}));
vi.mock("goey-toast", () => ({ gooeyToast: { success: vi.fn(), error: vi.fn() } }));

import { Settings } from "./Settings";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

afterEach(cleanup);

describe("Settings GitHub card", () => {
  it("saves the GitHub token and clears the input", async () => {
    render(<Settings />, { wrapper });
    const input = screen.getByPlaceholderText(/ghp_/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "ghp_secret" } });
    fireEvent.click(screen.getByRole("button", { name: /save github token/i }));
    await waitFor(() => expect(cmd.setGithubToken).toHaveBeenCalledWith("ghp_secret"));
    expect(input.value).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- Settings`
Expected: FAIL — no GitHub placeholder/button found.

- [ ] **Step 3: Implement the GitHub card**

In `src/features/settings/Settings.tsx`:

1. Extend the `@/lib/commands` import (line 8) with:

```typescript
  clearGithubToken,
  getGithubStatus,
  setGithubToken,
  testGithubConnection,
```

2. Extend the `@/lib/queries` import (line 16) with `clearGithubQueries`:

```typescript
import { clearGithubQueries, clearWorkspaceQueries, invalidateWorkspaceQueries } from "@/lib/queries";
```

3. Inside the `Settings` component, after the `resyncMut` block (line 66), add the GitHub state + handlers:

```typescript
  const [ghInput, setGhInput] = useState("");
  const [ghSaving, setGhSaving] = useState(false);
  const invalidateGhStatus = () => qc.invalidateQueries({ queryKey: ["github-status"] });
  const { data: ghStatus } = useQuery({ queryKey: ["github-status"], queryFn: getGithubStatus });

  const ghTestMut = useMutation({
    mutationFn: () => testGithubConnection(),
    onSuccess: (s) => {
      if (s.state === "connected") gooeyToast.success(`Connected as ${s.login}`);
      invalidateGhStatus();
    },
    onError: (err) => gooeyToast.error("GitHub connection failed", { description: errorText(err) }),
  });

  const ghClearMut = useMutation({
    mutationFn: () => clearGithubToken(),
    onSuccess: () => {
      clearGithubQueries(qc);
      gooeyToast.success("GitHub token cleared");
      invalidateGhStatus();
    },
    onError: (err) => {
      clearGithubQueries(qc);
      gooeyToast.error("Could not clear the token", { description: errorText(err) });
    },
  });

  const ghBusy = ghSaving || ghTestMut.isPending || ghClearMut.isPending;

  const handleGhSave = async (e: FormEvent) => {
    e.preventDefault();
    if (ghBusy) return;
    const token = ghInput.trim();
    if (!token) return;
    setGhInput(""); // clear the secret from component state immediately
    setGhSaving(true);
    try {
      await setGithubToken(token);
      clearGithubQueries(qc);
      gooeyToast.success("GitHub token saved");
      invalidateGhStatus();
    } catch (err) {
      clearGithubQueries(qc);
      gooeyToast.error("Could not save the token", { description: errorText(err) });
    } finally {
      setGhSaving(false);
    }
  };
```

4. Add the GitHub `Card` inside the returned `<main>`, after the existing Linear `Card` (before `</main>`, line 150):

```tsx
      <Card className="flex flex-col gap-4 p-6">
        <p className="text-sm text-muted-foreground">
          {ghStatus === undefined
            ? "Checking…"
            : ghStatus.state === "connected"
              ? `Connected as ${ghStatus.login}`
              : ghStatus.state === "unverified"
                ? "Token saved — not verified"
                : "Not connected"}
        </p>
        <form className="flex flex-col gap-3" onSubmit={handleGhSave}>
          <Label htmlFor="github-token">GitHub personal access token (classic)</Label>
          <Input
            id="github-token"
            type="password"
            autoComplete="off"
            placeholder="ghp_…"
            value={ghInput}
            onChange={(e) => setGhInput(e.currentTarget.value)}
            disabled={ghBusy}
          />
          <p className="text-xs text-muted-foreground">
            Needs <code>repo</code> scope. Add <code>read:org</code> only if org/team membership is
            required. Classic tokens grant broad repo access; for SSO orgs, authorize the token.
          </p>
          <div className="flex gap-2">
            <Button type="submit" disabled={ghBusy}>Save GitHub token</Button>
            <Button type="button" variant="secondary" disabled={ghBusy} onClick={() => ghTestMut.mutate()}>
              Test connection
            </Button>
            <Button type="button" variant="ghost" disabled={ghBusy} onClick={() => ghClearMut.mutate()}>
              Clear token
            </Button>
          </div>
        </form>
      </Card>
```

- [ ] **Step 4: Run test + typecheck to verify they pass**

Run: `npm test -- Settings`
Expected: PASS.
Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/features/settings/Settings.tsx src/features/settings/Settings.test.tsx
git commit -m "feat(m4): GitHub connect card in Settings (save/test/clear, secret-safe)"
```

---

## Task 14: Documentation updates + full verification

**Files:**
- Modify: `requirements.md` (§2 item 6, §4 GitHub auth ~line 129, §5 data model, §6 sync, §8, F7+AC ~line 414, §11 M4 line ~464)
- Modify: `CLAUDE.md` (status section + stale test-framework note)
- Modify: `AGENTS.md` (stale "no frontend test runner" note)

**Interfaces:** none (docs only)

- [ ] **Step 1: Update requirements.md**

Apply these edits in `requirements.md`:

1. §2 scope item 6 — replace the line with:

```markdown
6. **GitHub PR dashboard** — a standalone view of open PRs that involve you (needs-my-review, my PRs, assigned, involved) across all accessible repos.
```

2. §4 GitHub auth (line ~129) — replace the paragraph with:

```markdown
A **classic personal access token** with `repo` scope (private-repo visibility); add `read:org` only if org/team membership is queried or testing proves it is required. Stored in the keychain (account `github_token`) and sent as `Authorization: Bearer <token>`. Optional — the app degrades gracefully if no token is set (the dashboard shows a "Connect GitHub" prompt). Classic (not fine-grained) is chosen because fine-grained tokens cannot reliably cover arbitrary collaborations; document the broad-access trade-off and the SAML-SSO authorization requirement.
```

3. §5 data model — replace the `github_prs` CREATE block with the Task 1 `github_prs` + `github_sync_meta` schema (viewer/bucket-centric, PK `(id, bucket)`).

4. §6 sync — replace the "GitHub sync" bullet with:

```markdown
- **GitHub sync:** background refresh on dashboard open + a 5-minute poll while open; each bucket is fetched to completion (cap 300, `sort:updated-desc`) and committed in one transaction (delete+insert+meta), so a partial/failed fetch never empties a bucket. Rate limits: parse GraphQL `errors` on HTTP 200, treat throttled 403 as rate-limited.
```

5. §8 — replace the section body with the viewer-centric bucket description (four `@me` searches; `involved` is the remainder; Linear correlation demoted to the optional convenience chip via branch/title identifier match).

6. F7 + AC (line ~414) — replace with:

```markdown
### F7 — GitHub PR dashboard `[REQ]`
- A standalone view with four sections (needs-my-review, my open PRs, assigned, involved), each row showing title, #number, author, comments, repo, updated time, and status/CI/conflict/review badges; a Linear chip when the branch/title identifier matches a cached issue.
- **AC:** with a token, sections populate; with none, a connect prompt shows without errors; a sync failure leaves the previous cache intact; setting/clearing the token never disturbs the Linear cache.
```

7. §11 M4 line (~464) — replace with:

```markdown
- **M4 — GitHub PR dashboard (F7).** Standalone viewer-centric PR dashboard; classic-PAT auth; offline-first per-bucket cache.
```

- [ ] **Step 2: Update CLAUDE.md**

In `CLAUDE.md`:
- In the "Current status" section, append to the M-list: `**M4 — GitHub PR dashboard (F7). ✅ Done** once this plan is implemented.` (Adjust wording to match the file's existing status style.)
- In the Commands section, correct the stale note: change "**No JS test framework is configured yet.**" to "**Frontend tests use Vitest** (`npm test`); Rust logic is unit-tested (`cargo test`)."

In `AGENTS.md`:
- Correct the stale line "No frontend test runner or coverage threshold is configured yet." to note that **Vitest is configured** (`npm test`, `*.test.ts`/`*.test.tsx` beside the code), while keeping `npm run build` as the required automated check.

- [ ] **Step 3: Run the full verification suite**

Run each and confirm clean output:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
npm test
npm run build   # tsc typecheck + vite build — required by AGENTS.md
```

Expected: all Rust tests pass; clippy clean; fmt clean; all Vitest tests pass; `npm run build` succeeds. Fix any failures before continuing.

- [ ] **Step 4: Manual smoke test (`npm run tauri dev`)**

Launch the app and verify each flow by hand (per AGENTS.md's "manually exercise the affected flow"):

- **No token:** open the Pull Requests view → shows the "Connect GitHub" prompt, no errors.
- **Connect:** Settings → paste a classic PAT → Save → Test connection shows `Connected as <login>`.
- **Connected:** Pull Requests view populates the four sections; rows show title/#number/author avatar/comments/CI/review badges.
- **Refresh:** click the header refresh button → spinner runs and rows update.
- **External link:** click a PR title → opens the PR on github.com in the browser.
- **Linear chip:** a PR whose branch/title matches a cached issue shows its identifier chip → clicking opens that issue's tab.
- **Disconnect:** Settings → Clear token → Pull Requests view returns to the connect prompt; the Linear calendar/list still shows issues (Linear cache untouched).

- [ ] **Step 5: Commit**

```bash
git add requirements.md CLAUDE.md AGENTS.md
git commit -m "docs(m4): update requirements + CLAUDE + AGENTS for the GitHub PR dashboard"
```

---

## Self-Review Notes

- **Spec coverage:** §3 auth/scopes → Tasks 7,13; §4 client+rate-limits → Task 2; §4.1 buckets/sort → Task 3; §4.2 fields/CI/review → Task 5; §4.3 pagination+cap+truncation → Tasks 5,8; §4.4 transactional prune + partial-failure → Tasks 6,8; §4.5 credential isolation + fail-safe ordering + generation guard → Tasks 7,8; §4.6 rate-limit interpretation → Task 2; §5 schema + regex + join → Tasks 1,4,5,6; §6 commands → Tasks 7,8; §7 frontend (nav/cache-vs-sync/components/chip) → Tasks 10,11,12,13; §8 testing (Rust + Vitest) → every task; §9 requirements.md → Task 14; §10 ACs → Tasks 7,8,12,13.
- **Cache-preservation guarantees (review round 2):** malformed pages never erase a bucket — `parse_search_page` returns `Result` and rejects missing `search`/`nodes`/`pageInfo` and malformed PR nodes (Task 5); pagination can't loop forever — missing/repeated cursors are `Malformed` (Task 8); exactly-300 is `truncated=false`, >300-available is `true` (Task 8 `fetch_bucket` tests); a mid-sync credential swap aborts with `WorkspaceChanged` and writes nothing (Task 8).
- **Rate-limit hints** preserved on HTTP 200 (`RATE_LIMITED`), 403, and 429 via `rate_limit_hint` (retry-after, else reset-epoch − now), unit-tested in Task 2.
- **Identifier regex** boundary correctness (`xENG-123y` rejected; `release-2024` extracted but join-filtered) is tested in Tasks 4 and 6.
- **Frontend coverage (review round 2):** manual refresh, per-section stale + truncation note, sync error, cross-bucket duplication (Task 12); avatar, relative time, explicit open/draft, all CI states, all review states + null (Task 11); background-sync enablement + invalidation (Task 10).
- **Type consistency:** `ParsedPr` (Rust, Task 5) → `replace_bucket` (Task 6) → `PrRow` serialized fields → `GithubPr` (TS, Task 9) → `PrRow.tsx`/`PrsPage.tsx` all use the same snake→camel field names. `GitHubStatus`/`compute_github_status` consistent across Tasks 7/10/12/13. Bucket keys `needs_review|mine|assigned|involved` consistent across Tasks 3/6/8/9/12.
