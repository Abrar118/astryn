# Slack Catch-Up Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only, poll-on-open Slack catch-up board that shows a single workspace's unread mentions, DMs, threads, and channels, lets the user read them in-app, and deep-links into Slack to reply.

**Architecture:** Mirror the shipped GitHub PR dashboard (M4) end to end — a Rust `slack/` module that owns the user token and all Slack Web API calls, a transactionally-refreshed SQLite cache, sanitized typed Tauri commands, and a pure-consumer React feature (`src/features/slack/`). Sync is on-open + a 5-minute background poll; the board reads the cache (offline-first). No persistent connection; huddles/reply/mark-as-read are out of scope.

**Tech Stack:** Tauri v2, Rust (`reqwest` rustls, `sqlx` SQLite, `thiserror`, `regex`, `time`, `tokio`), React 19 + TypeScript, TanStack Query, `goey-toast`, Tailwind v4 + shadcn/ui, Vitest, `cargo test`.

**Spec:** `docs/superpowers/specs/2026-06-23-slack-catch-up-board-design.md`. **Branch:** `feat/slack-catch-up-board`.

## Global Constraints

- **All Slack API calls happen in Rust, never the webview.** The token is held in Rust, sent over IPC once from Settings, and **never** returned to TS or persisted in browser storage / SQLite / logs / query caches.
- **Keychain only** for the token: service `com.orion.astryn`, account `slack_user_token`, sent as `Authorization: Bearer <token>`.
- **Sanitized errors:** Tauri commands return `CmdError` strings — no raw reqwest/Slack/keyring diagnostics cross IPC. A non-`ok` Slack body (`{"ok":false,"error":...}`) is a failure even on HTTP 200.
- **Offline-first:** the board renders from the SQLite cache with no network. Sync is a separate background query.
- **Credential isolation:** setting **or** clearing the Slack token wipes only Slack state and never touches the Linear or GitHub caches; an in-flight sync aborts via a generation guard if the token changes mid-flight.
- **TS is strict** (`noUnusedLocals`/`noUnusedParameters`): no unused symbols. Verify with `npx tsc --noEmit`.
- **Linear identifier reuse:** reuse the existing `crate::github::prs::extract_linear_identifier(branch, title)` (pattern `(?i)\b[A-Z][A-Z0-9]*-\d+\b`, uppercased) — call it as `extract_linear_identifier(text, "")`.
- **Bucket/section order (signal-first):** Mentions → DMs → Threads → Channels.
- **Frontend opens external URLs** via `openUrl` from `@tauri-apps/plugin-opener` (already a dep; capability `opener:default` already granted). Tests mock it: `vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }))`.
- **Run Rust tests** with `cargo test --manifest-path src-tauri/Cargo.toml`; **frontend tests** with `npm test`.

---

## File Structure

**Rust (new):**
- `src-tauri/migrations/0013_slack_catchup.sql` — the four Slack tables.
- `src-tauri/src/slack/mod.rs` — `SlackError`, response interpreter (`classify_slack_error`, `extract_ok`, `interpret_status`), `SlackCredentialProvider` trait + `PersonalTokenProvider`, `SlackClient`, test `fake` creds.
- `src-tauri/src/slack/catchup.rs` — parsed types + raw-JSON parse fns + pure unread/mention/thread logic.
- `src-tauri/src/db/slack.rs` — row + insert types, `replace_catchup`, `wipe_slack_cache`, identity + sync-meta helpers, list queries (with the Linear join).
- `src-tauri/src/commands/slack.rs` — `_logic` fns + thin `#[tauri::command]` wrappers (status, token, sync, list, conversation messages, deep link).

**Rust (modified):**
- `src-tauri/src/lib.rs` — `mod slack;`, build Slack creds/client/lock/generation into `AppState`, register the Slack commands, add `SLACK_TOKEN_ACCOUNT`.
- `src-tauri/src/commands/mod.rs` — add Slack fields to `AppState`, add `CmdError::SlackNotConfigured`, `pub mod slack;`.
- `src-tauri/src/db/mod.rs` — schema test for the new tables.

**Frontend (new):**
- `src/features/slack/SlackPage.tsx` — the board.
- `src/features/slack/SlackRow.tsx` — a conversation/mention/thread row.
- `src/features/slack/SlackReader.tsx` — the expand-to-read message panel.
- `src/features/slack/SlackPage.test.tsx`, `SlackRow.test.tsx` — Vitest.
- `src/lib/slackQueries.test.tsx` — hook smoke test.

**Frontend (modified):**
- `src/lib/commands.ts` — Slack types + invoke bindings.
- `src/lib/queries.ts` — `useSlackStatus`/`useSlackCatchup`/`useSlackSync`/`clearSlackQueries`.
- `src/lib/paneModel.ts` — add `"slack"` to `ViewKind`/`VIEWS`.
- `src/components/Dock.tsx` — `NAV`/`META` entry.
- `src/components/SplitLayout.tsx` — `case "slack"`.
- `src/features/settings/Settings.tsx` — a Slack token card.
- `requirements.md` — reflect that Slack iteration 1 is in scope.

---

## Task 1: Migration + schema test

**Files:**
- Create: `src-tauri/migrations/0013_slack_catchup.sql`
- Test: `src-tauri/src/db/mod.rs` (add a test in the existing `tests` module)

**Interfaces:**
- Produces: tables `slack_conversations`, `slack_messages`, `slack_users`, `slack_sync_meta` (used by `db/slack.rs` in Task 5).

- [ ] **Step 1: Write the failing test** — add to the `tests` module in `src-tauri/src/db/mod.rs` (alongside `migration_creates_github_tables`):

```rust
    #[tokio::test]
    async fn migration_creates_slack_tables() {
        let (_dir, pool) = temp_pool().await;
        for table in ["slack_conversations", "slack_messages", "slack_users", "slack_sync_meta"] {
            let n: (i64,) = sqlx::query_as(&format!("SELECT COUNT(*) FROM {table}"))
                .fetch_one(&pool)
                .await
                .unwrap_or_else(|e| panic!("table {table} missing: {e}"));
            assert_eq!(n.0, 0);
        }
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml migration_creates_slack_tables`
Expected: FAIL — `no such table: slack_conversations`.

- [ ] **Step 3: Create the migration** — `src-tauri/migrations/0013_slack_catchup.sql`:

```sql
-- Slack catch-up board (read-only, single workspace). Cache + computed unread state.
CREATE TABLE slack_conversations (
  id              TEXT PRIMARY KEY,   -- Slack conversation id (Cxxxx | Dxxxx | Gxxxx)
  kind            TEXT NOT NULL,      -- channel | dm | group_dm
  name            TEXT,               -- channel name, or resolved DM partner name(s)
  partner_user_id TEXT,              -- for DMs: the other user's id (NULL otherwise)
  unread_count    INTEGER NOT NULL,   -- computed, excludes the viewer's own messages
  has_mention     INTEGER NOT NULL,   -- bool: any unread message here mentions the viewer
  unread_threads  INTEGER NOT NULL,   -- count of this conversation's threads with unread replies
  last_read_ts    TEXT,               -- Slack last_read marker captured at sync
  latest_ts       TEXT,               -- most recent unread message ts
  latest_snippet  TEXT,               -- preview text of the most recent unread message
  synced_at       TEXT NOT NULL
);
CREATE INDEX idx_slack_conv_kind ON slack_conversations(kind);

CREATE TABLE slack_messages (
  conversation_id   TEXT NOT NULL,
  ts                TEXT NOT NULL,      -- message ts, unique within a conversation
  thread_ts         TEXT,              -- parent ts if a threaded reply (NULL for top-level)
  user_id           TEXT,
  user_name         TEXT,
  user_avatar       TEXT,
  text              TEXT,              -- raw Slack mrkdwn (rendered client-side)
  is_mention        INTEGER NOT NULL,   -- bool
  is_unread         INTEGER NOT NULL,   -- bool
  linear_identifier TEXT,              -- uppercase Linear id extracted from text, nullable
  created_at        TEXT NOT NULL,      -- ISO derived from ts
  raw_json          TEXT,
  PRIMARY KEY (conversation_id, ts)
);
CREATE INDEX idx_slack_msg_conv ON slack_messages(conversation_id);
CREATE INDEX idx_slack_msg_thread ON slack_messages(thread_ts);
CREATE INDEX idx_slack_msg_mention ON slack_messages(is_mention);
CREATE INDEX idx_slack_msg_linear ON slack_messages(linear_identifier);

CREATE TABLE slack_users (
  id        TEXT PRIMARY KEY,
  name      TEXT,
  avatar    TEXT,
  synced_at TEXT NOT NULL
);

CREATE TABLE slack_sync_meta (
  key   TEXT PRIMARY KEY,            -- last_synced_at | conversation_count | unread_total
  value TEXT
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml migration_creates_slack_tables`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/migrations/0013_slack_catchup.sql src-tauri/src/db/mod.rs
git commit -m "feat(slack): add 0013 catch-up migration + schema test"
```

---

## Task 2: `slack/mod.rs` — error, interpreter, provider, client

**Files:**
- Create: `src-tauri/src/slack/mod.rs`
- Modify: `src-tauri/src/lib.rs:1-6` (add `mod slack;`)

**Interfaces:**
- Produces:
  - `enum SlackError { Network, Auth, RateLimited(Option<i64>), Malformed, Server, Api(String) }`
  - `fn classify_slack_error(error: &str) -> SlackError`
  - `fn extract_ok(body: &str) -> Result<serde_json::Value, SlackError>` — returns the full body `Value` when `ok == true`.
  - `fn interpret_status(status: u16, retry_after: Option<i64>) -> Option<SlackError>`
  - `trait SlackCredentialProvider { fn authorization(&self) -> Result<Option<String>, SecretError>; }`
  - `struct PersonalTokenProvider` (Bearer) + `PersonalTokenProvider::new(store, account)`
  - `struct SlackClient` with `SlackClient::new()`, `with_base(base)`, `async fn call(&self, authorization: &str, method: &str, params: &[(&str, &str)]) -> Result<Value, SlackError>`
  - `mod fake { struct FakeSlackCreds(pub Option<String>) }` (under `#[cfg(test)]`)

- [ ] **Step 1: Write the failing test** — create `src-tauri/src/slack/mod.rs` with the full module **and** these tests at the bottom:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ok_true_returns_body() {
        let v = extract_ok(r#"{"ok":true,"user_id":"U1"}"#).unwrap();
        assert_eq!(v["user_id"], "U1");
    }

    #[test]
    fn ok_false_invalid_auth_is_auth() {
        assert!(matches!(
            extract_ok(r#"{"ok":false,"error":"invalid_auth"}"#),
            Err(SlackError::Auth)
        ));
    }

    #[test]
    fn ok_false_ratelimited_is_rate_limited() {
        assert!(matches!(
            extract_ok(r#"{"ok":false,"error":"ratelimited"}"#),
            Err(SlackError::RateLimited(_))
        ));
    }

    #[test]
    fn ok_false_missing_scope_is_auth() {
        assert!(matches!(
            classify_slack_error("missing_scope"),
            SlackError::Auth
        ));
    }

    #[test]
    fn ok_false_other_is_api() {
        match extract_ok(r#"{"ok":false,"error":"channel_not_found"}"#) {
            Err(SlackError::Api(m)) => assert_eq!(m, "channel_not_found"),
            other => panic!("expected Api, got {other:?}"),
        }
    }

    #[test]
    fn ok_false_without_error_is_malformed() {
        assert!(matches!(
            extract_ok(r#"{"ok":false}"#),
            Err(SlackError::Malformed)
        ));
    }

    #[test]
    fn non_json_is_malformed() {
        assert!(matches!(extract_ok("not json"), Err(SlackError::Malformed)));
    }

    #[test]
    fn status_429_is_rate_limited_with_hint() {
        assert!(matches!(
            interpret_status(429, Some(12)),
            Some(SlackError::RateLimited(Some(12)))
        ));
    }

    #[test]
    fn status_5xx_is_server() {
        assert!(matches!(interpret_status(503, None), Some(SlackError::Server)));
    }

    #[test]
    fn status_200_is_none() {
        assert!(interpret_status(200, None).is_none());
    }

    #[test]
    fn provider_wraps_token_as_bearer() {
        use crate::secrets::fake::FakeSecretStore;
        let store: std::sync::Arc<dyn SecretStore> = std::sync::Arc::new(FakeSecretStore::default());
        store.set("slack_user_token", "xoxp-1").unwrap();
        let p = PersonalTokenProvider::new(store, "slack_user_token");
        assert_eq!(p.authorization().unwrap(), Some("Bearer xoxp-1".to_string()));
    }
}
```

- [ ] **Step 2: Write the module body** (above the test module) in `src-tauri/src/slack/mod.rs`:

```rust
pub mod catchup;

use serde_json::Value;
use std::sync::Arc;
use std::time::Duration;

use crate::secrets::{SecretError, SecretStore};

#[derive(Debug, thiserror::Error)]
pub enum SlackError {
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

/// Map a Slack `error` string (from an `{"ok":false,...}` body) to a sanitized error.
pub fn classify_slack_error(error: &str) -> SlackError {
    match error {
        "invalid_auth" | "not_authed" | "token_revoked" | "account_inactive" | "no_permission"
        | "missing_scope" | "ekm_access_denied" => SlackError::Auth,
        "ratelimited" | "rate_limited" => SlackError::RateLimited(None),
        other => SlackError::Api(other.to_string()),
    }
}

/// Slack signals success with `ok:true` (HTTP 200). A non-`ok` body is a failure
/// even on HTTP 200; classify its `error` string.
pub fn extract_ok(body: &str) -> Result<Value, SlackError> {
    let v: Value = serde_json::from_str(body).map_err(|_| SlackError::Malformed)?;
    match v.get("ok").and_then(|o| o.as_bool()) {
        Some(true) => Ok(v),
        Some(false) => match v.get("error").and_then(|e| e.as_str()) {
            Some(err) => Err(classify_slack_error(err)),
            None => Err(SlackError::Malformed),
        },
        None => Err(SlackError::Malformed),
    }
}

/// Transport-level status mapping. 429 carries the `Retry-After` delta (seconds).
pub fn interpret_status(status: u16, retry_after: Option<i64>) -> Option<SlackError> {
    match status {
        429 => Some(SlackError::RateLimited(retry_after)),
        500..=599 => Some(SlackError::Server),
        _ => None,
    }
}

pub trait SlackCredentialProvider: Send + Sync {
    /// The `Authorization` header value, or `None` if no token is stored.
    fn authorization(&self) -> Result<Option<String>, SecretError>;
}

pub struct PersonalTokenProvider {
    store: Arc<dyn SecretStore>,
    account: String,
}

impl PersonalTokenProvider {
    pub fn new(store: Arc<dyn SecretStore>, account: impl Into<String>) -> Self {
        Self { store, account: account.into() }
    }
}

impl SlackCredentialProvider for PersonalTokenProvider {
    fn authorization(&self) -> Result<Option<String>, SecretError> {
        Ok(self.store.get(&self.account)?.map(|t| format!("Bearer {t}")))
    }
}

#[derive(Clone)]
pub struct SlackClient {
    http: reqwest::Client,
    base: String,
}

impl SlackClient {
    pub fn new() -> Result<Self, SlackError> {
        Self::with_base("https://slack.com/api")
    }

    pub fn with_base(base: impl Into<String>) -> Result<Self, SlackError> {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .connect_timeout(Duration::from_secs(10))
            .build()
            .map_err(|_| SlackError::Network)?;
        Ok(Self { http, base: base.into() })
    }

    /// POST a Slack Web API method with form params; returns the parsed `ok:true` body.
    pub async fn call(
        &self,
        authorization: &str,
        method: &str,
        params: &[(&str, &str)],
    ) -> Result<Value, SlackError> {
        let url = format!("{}/{}", self.base, method);
        let resp = self
            .http
            .post(&url)
            .header("Authorization", authorization)
            .form(params)
            .send()
            .await
            .map_err(|_| SlackError::Network)?;
        let status = resp.status().as_u16();
        let retry_after = resp
            .headers()
            .get("retry-after")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.parse::<i64>().ok());
        if let Some(e) = interpret_status(status, retry_after) {
            return Err(e);
        }
        let text = resp.text().await.map_err(|_| SlackError::Network)?;
        extract_ok(&text)
    }
}

#[cfg(test)]
pub mod fake {
    use super::*;

    pub struct FakeSlackCreds(pub Option<String>);

    impl SlackCredentialProvider for FakeSlackCreds {
        fn authorization(&self) -> Result<Option<String>, SecretError> {
            Ok(self.0.clone())
        }
    }
}
```

- [ ] **Step 3: Register the module** — in `src-tauri/src/lib.rs`, add `mod slack;` to the module list (after `mod secrets;` at line ~6):

```rust
mod commands;
mod db;
mod github;
mod linear;
mod link_preview;
mod secrets;
mod slack;
```

> Note: `catchup.rs` is declared by `pub mod catchup;` at the top of `mod.rs`. Create an empty `src-tauri/src/slack/catchup.rs` now (filled in Tasks 3–4) so the module compiles:

```rust
// Filled in Tasks 3–4.
```

- [ ] **Step 4: Run tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml slack::mod::tests`
Expected: PASS (all 11 tests). Also `cargo build --manifest-path src-tauri/Cargo.toml` compiles.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/slack/mod.rs src-tauri/src/slack/catchup.rs src-tauri/src/lib.rs
git commit -m "feat(slack): error/interpreter/provider/client module"
```

---

## Task 3: `slack/catchup.rs` — parsed types + parse fns

**Files:**
- Modify: `src-tauri/src/slack/catchup.rs`

**Interfaces:**
- Consumes: `serde_json::Value`.
- Produces:
  - `enum ConvKind { Channel, Dm, GroupDm }` (with `fn as_str(&self) -> &'static str`)
  - `struct AuthTest { user_id, team_id, url, user: String }`
  - `struct ParsedConversation { id: String, kind: ConvKind, name: Option<String>, is_member: bool, partner_user_id: Option<String> }`
  - `struct ParsedInfo { last_read: Option<String>, unread_count_display: Option<i64>, latest_ts: Option<String> }`
  - `struct ParsedMessage { ts: String, thread_ts: Option<String>, user_id: Option<String>, text: String, subtype: Option<String>, reply_count: Option<i64>, latest_reply: Option<String> }`
  - `struct ParsedUser { id: String, name: Option<String>, avatar: Option<String> }`
  - `fn parse_auth_test(v: &Value) -> Result<AuthTest, SlackError>`
  - `fn parse_conversations(v: &Value) -> Result<(Vec<ParsedConversation>, Option<String>), SlackError>` (returns rows + `next_cursor`)
  - `fn parse_conversation_info(v: &Value) -> ParsedInfo`
  - `fn parse_messages(v: &Value) -> Vec<ParsedMessage>`
  - `fn parse_user(v: &Value) -> Option<ParsedUser>`

- [ ] **Step 1: Write the failing tests** — append to `src-tauri/src/slack/catchup.rs`:

```rust
#[cfg(test)]
mod parse_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_auth_test() {
        let v = json!({"ok":true,"user_id":"U1","team_id":"T1","url":"https://w.slack.com/","user":"abrar"});
        let a = parse_auth_test(&v).unwrap();
        assert_eq!((a.user_id.as_str(), a.team_id.as_str(), a.user.as_str()), ("U1", "T1", "abrar"));
    }

    #[test]
    fn parse_auth_test_missing_fields_is_malformed() {
        assert!(matches!(parse_auth_test(&json!({"ok":true})), Err(SlackError::Malformed)));
    }

    #[test]
    fn classifies_conversation_kinds_and_cursor() {
        let v = json!({"ok":true,"channels":[
            {"id":"C1","name":"eng","is_im":false,"is_mpim":false,"is_member":true},
            {"id":"D1","is_im":true,"is_member":true,"user":"U2"},
            {"id":"G1","is_mpim":true,"is_member":true}
        ],"response_metadata":{"next_cursor":"abc"}});
        let (rows, cursor) = parse_conversations(&v).unwrap();
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].kind, ConvKind::Channel);
        assert_eq!(rows[1].kind, ConvKind::Dm);
        assert_eq!(rows[1].partner_user_id.as_deref(), Some("U2"));
        assert_eq!(rows[2].kind, ConvKind::GroupDm);
        assert_eq!(cursor.as_deref(), Some("abc"));
    }

    #[test]
    fn empty_cursor_is_none() {
        let v = json!({"ok":true,"channels":[],"response_metadata":{"next_cursor":""}});
        let (_rows, cursor) = parse_conversations(&v).unwrap();
        assert_eq!(cursor, None);
    }

    #[test]
    fn parses_conversation_info() {
        let v = json!({"ok":true,"channel":{"id":"C1","last_read":"100.000","unread_count_display":3,"latest":{"ts":"105.000"}}});
        let info = parse_conversation_info(&v);
        assert_eq!(info.last_read.as_deref(), Some("100.000"));
        assert_eq!(info.unread_count_display, Some(3));
        assert_eq!(info.latest_ts.as_deref(), Some("105.000"));
    }

    #[test]
    fn parses_messages() {
        let v = json!({"ok":true,"messages":[
            {"ts":"101.0","user":"U2","text":"hi <@U1>","reply_count":2,"latest_reply":"103.0"},
            {"ts":"102.0","user":"U2","text":"joined","subtype":"channel_join"}
        ]});
        let msgs = parse_messages(&v);
        assert_eq!(msgs.len(), 2);
        assert_eq!(msgs[0].text, "hi <@U1>");
        assert_eq!(msgs[0].reply_count, Some(2));
        assert_eq!(msgs[1].subtype.as_deref(), Some("channel_join"));
    }

    #[test]
    fn parses_user_prefers_display_name() {
        let v = json!({"ok":true,"user":{"id":"U2","real_name":"Real Name","profile":{"display_name":"disp","image_48":"http://a/x.png"}}});
        let u = parse_user(&v).unwrap();
        assert_eq!(u.name.as_deref(), Some("disp"));
        assert_eq!(u.avatar.as_deref(), Some("http://a/x.png"));
    }

    #[test]
    fn parses_user_falls_back_to_real_name() {
        let v = json!({"ok":true,"user":{"id":"U2","real_name":"Real Name","profile":{"display_name":"","image_48":"http://a/x.png"}}});
        let u = parse_user(&v).unwrap();
        assert_eq!(u.name.as_deref(), Some("Real Name"));
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml slack::catchup::parse_tests`
Expected: FAIL — `parse_auth_test` etc. not found.

- [ ] **Step 3: Write the types + parse fns** at the **top** of `src-tauri/src/slack/catchup.rs`:

```rust
use serde_json::Value;

use super::SlackError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConvKind {
    Channel,
    Dm,
    GroupDm,
}

impl ConvKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            ConvKind::Channel => "channel",
            ConvKind::Dm => "dm",
            ConvKind::GroupDm => "group_dm",
        }
    }
}

#[derive(Debug, Clone)]
pub struct AuthTest {
    pub user_id: String,
    pub team_id: String,
    pub url: String,
    pub user: String,
}

#[derive(Debug, Clone)]
pub struct ParsedConversation {
    pub id: String,
    pub kind: ConvKind,
    pub name: Option<String>,
    pub is_member: bool,
    pub partner_user_id: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct ParsedInfo {
    pub last_read: Option<String>,
    pub unread_count_display: Option<i64>,
    pub latest_ts: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ParsedMessage {
    pub ts: String,
    pub thread_ts: Option<String>,
    pub user_id: Option<String>,
    pub text: String,
    pub subtype: Option<String>,
    pub reply_count: Option<i64>,
    pub latest_reply: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ParsedUser {
    pub id: String,
    pub name: Option<String>,
    pub avatar: Option<String>,
}

fn str_field(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(|x| x.as_str()).map(str::to_string)
}

pub fn parse_auth_test(v: &Value) -> Result<AuthTest, SlackError> {
    Ok(AuthTest {
        user_id: str_field(v, "user_id").ok_or(SlackError::Malformed)?,
        team_id: str_field(v, "team_id").ok_or(SlackError::Malformed)?,
        url: str_field(v, "url").unwrap_or_default(),
        user: str_field(v, "user").unwrap_or_default(),
    })
}

/// Returns parsed member conversations plus the (non-empty) pagination cursor.
pub fn parse_conversations(v: &Value) -> Result<(Vec<ParsedConversation>, Option<String>), SlackError> {
    let channels = v.get("channels").and_then(|c| c.as_array()).ok_or(SlackError::Malformed)?;
    let mut rows = Vec::with_capacity(channels.len());
    for c in channels {
        let id = match str_field(c, "id") {
            Some(id) => id,
            None => continue,
        };
        let is_im = c.get("is_im").and_then(|b| b.as_bool()).unwrap_or(false);
        let is_mpim = c.get("is_mpim").and_then(|b| b.as_bool()).unwrap_or(false);
        let kind = if is_im {
            ConvKind::Dm
        } else if is_mpim {
            ConvKind::GroupDm
        } else {
            ConvKind::Channel
        };
        rows.push(ParsedConversation {
            id,
            kind,
            name: str_field(c, "name"),
            is_member: c.get("is_member").and_then(|b| b.as_bool()).unwrap_or(is_im || is_mpim),
            partner_user_id: if is_im { str_field(c, "user") } else { None },
        });
    }
    let cursor = v
        .get("response_metadata")
        .and_then(|m| m.get("next_cursor"))
        .and_then(|c| c.as_str())
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    Ok((rows, cursor))
}

pub fn parse_conversation_info(v: &Value) -> ParsedInfo {
    let ch = v.get("channel").cloned().unwrap_or(Value::Null);
    ParsedInfo {
        last_read: str_field(&ch, "last_read"),
        unread_count_display: ch.get("unread_count_display").and_then(|n| n.as_i64()),
        latest_ts: ch.get("latest").and_then(|l| l.get("ts")).and_then(|t| t.as_str()).map(str::to_string),
    }
}

pub fn parse_messages(v: &Value) -> Vec<ParsedMessage> {
    v.get("messages")
        .and_then(|m| m.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|m| {
                    Some(ParsedMessage {
                        ts: str_field(m, "ts")?,
                        thread_ts: str_field(m, "thread_ts"),
                        user_id: str_field(m, "user"),
                        text: str_field(m, "text").unwrap_or_default(),
                        subtype: str_field(m, "subtype"),
                        reply_count: m.get("reply_count").and_then(|n| n.as_i64()),
                        latest_reply: str_field(m, "latest_reply"),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

pub fn parse_user(v: &Value) -> Option<ParsedUser> {
    let u = v.get("user")?;
    let id = str_field(u, "id")?;
    let profile = u.get("profile").cloned().unwrap_or(Value::Null);
    let display = str_field(&profile, "display_name").filter(|s| !s.is_empty());
    let name = display.or_else(|| str_field(u, "real_name")).filter(|s| !s.is_empty());
    Some(ParsedUser {
        id,
        name,
        avatar: str_field(&profile, "image_48"),
    })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml slack::catchup::parse_tests`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/slack/catchup.rs
git commit -m "feat(slack): parsed types + Web API response parsing"
```

---

## Task 4: `slack/catchup.rs` — unread / mention / thread logic

**Files:**
- Modify: `src-tauri/src/slack/catchup.rs`

**Interfaces:**
- Consumes: `ParsedMessage` (Task 3), `crate::github::prs::extract_linear_identifier`.
- Produces:
  - `fn is_system_message(m: &ParsedMessage) -> bool`
  - `fn unread_messages<'a>(messages: &'a [ParsedMessage], viewer_id: &str) -> Vec<&'a ParsedMessage>` — excludes the viewer's own + system messages.
  - `fn detect_mention(text: &str, viewer_id: &str) -> bool`
  - `fn ts_gt(a: &str, b: &str) -> bool` — numeric Slack-ts comparison.
  - `fn thread_parents<'a>(messages: &'a [ParsedMessage], last_read: Option<&str>) -> Vec<&'a ParsedMessage>` — parents with replies after `last_read`.
  - `fn linear_id(text: &str) -> Option<String>` — wrapper over the reused extractor.

- [ ] **Step 1: Write the failing tests** — append to `src-tauri/src/slack/catchup.rs`:

```rust
#[cfg(test)]
mod logic_tests {
    use super::*;

    fn msg(ts: &str, user: Option<&str>, text: &str, subtype: Option<&str>) -> ParsedMessage {
        ParsedMessage {
            ts: ts.into(),
            thread_ts: None,
            user_id: user.map(str::to_string),
            text: text.into(),
            subtype: subtype.map(str::to_string),
            reply_count: None,
            latest_reply: None,
        }
    }

    #[test]
    fn unread_excludes_self_and_system() {
        let msgs = vec![
            msg("3.0", Some("U2"), "hello", None),       // kept
            msg("4.0", Some("U1"), "my own msg", None),  // excluded: self
            msg("5.0", Some("U2"), "joined", Some("channel_join")), // excluded: system
        ];
        let unread = unread_messages(&msgs, "U1");
        assert_eq!(unread.len(), 1);
        assert_eq!(unread[0].ts, "3.0");
    }

    #[test]
    fn detects_direct_and_broadcast_mentions() {
        assert!(detect_mention("hey <@U1> look", "U1"));
        assert!(detect_mention("ping <!here>", "U1"));
        assert!(detect_mention("all <!channel>", "U1"));
        assert!(detect_mention("<!everyone> hi", "U1"));
        assert!(!detect_mention("hey <@U2> look", "U1"));
        assert!(!detect_mention("no mention", "U1"));
    }

    #[test]
    fn ts_gt_is_numeric_not_lexical() {
        assert!(ts_gt("1623456789.000200", "1623456789.000100"));
        assert!(ts_gt("100.0", "99.0")); // lexical "100" < "99" but numeric 100 > 99
        assert!(!ts_gt("99.0", "100.0"));
    }

    #[test]
    fn thread_parents_need_replies_after_last_read() {
        let mut a = msg("10.0", Some("U2"), "root", None);
        a.reply_count = Some(3);
        a.latest_reply = Some("20.0");
        let mut b = msg("11.0", Some("U2"), "root old", None);
        b.reply_count = Some(1);
        b.latest_reply = Some("12.0");
        let c = msg("13.0", Some("U2"), "no thread", None); // reply_count None
        let parents = thread_parents(&[a, b, c], Some("15.0"));
        assert_eq!(parents.len(), 1);
        assert_eq!(parents[0].ts, "10.0"); // latest_reply 20 > 15; b's 12 <= 15; c has none
    }

    #[test]
    fn linear_id_reuses_uppercase_extractor() {
        assert_eq!(linear_id("see eng-123 thanks").as_deref(), Some("ENG-123"));
        assert_eq!(linear_id("no id here"), None);
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml slack::catchup::logic_tests`
Expected: FAIL — functions not found.

- [ ] **Step 3: Write the logic** — append (above the test modules) in `src-tauri/src/slack/catchup.rs`:

```rust
/// System/automated message subtypes that should never count as "unread for me".
const SYSTEM_SUBTYPES: &[&str] = &[
    "channel_join", "channel_leave", "channel_topic", "channel_purpose", "channel_name",
    "channel_archive", "channel_unarchive", "group_join", "group_leave",
];

pub fn is_system_message(m: &ParsedMessage) -> bool {
    matches!(&m.subtype, Some(s) if SYSTEM_SUBTYPES.contains(&s.as_str()))
}

/// Messages the viewer hasn't read and didn't author: drop self-authored + system.
pub fn unread_messages<'a>(messages: &'a [ParsedMessage], viewer_id: &str) -> Vec<&'a ParsedMessage> {
    messages
        .iter()
        .filter(|m| m.user_id.as_deref() != Some(viewer_id))
        .filter(|m| !is_system_message(m))
        .collect()
}

/// True if `text` directly @-mentions the viewer or carries a broadcast mention.
pub fn detect_mention(text: &str, viewer_id: &str) -> bool {
    text.contains(&format!("<@{viewer_id}>"))
        || text.contains("<!here>")
        || text.contains("<!channel>")
        || text.contains("<!everyone>")
}

/// Numeric comparison of Slack ts strings ("secs.micros"); false if either is unparseable.
pub fn ts_gt(a: &str, b: &str) -> bool {
    match (a.parse::<f64>(), b.parse::<f64>()) {
        (Ok(x), Ok(y)) => x > y,
        _ => false,
    }
}

/// Thread parents whose latest reply is newer than `last_read` (best-effort:
/// the channel marker stands in for the unavailable per-thread read marker).
pub fn thread_parents<'a>(
    messages: &'a [ParsedMessage],
    last_read: Option<&str>,
) -> Vec<&'a ParsedMessage> {
    messages
        .iter()
        .filter(|m| m.reply_count.unwrap_or(0) > 0)
        .filter(|m| match (&m.latest_reply, last_read) {
            (Some(latest), Some(lr)) => ts_gt(latest, lr),
            (Some(_), None) => true,
            _ => false,
        })
        .collect()
}

/// Uppercase Linear identifier embedded in message text, if any (reuses the
/// GitHub dashboard's boundary-aware extractor).
pub fn linear_id(text: &str) -> Option<String> {
    crate::github::prs::extract_linear_identifier(text, "")
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml slack::catchup::logic_tests`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/slack/catchup.rs
git commit -m "feat(slack): unread/mention/thread pure logic"
```

---

## Task 5: `db/slack.rs` — repository layer

**Files:**
- Create: `src-tauri/src/db/slack.rs`
- Modify: `src-tauri/src/db/mod.rs:5-6` (add `pub mod slack;`)

**Interfaces:**
- Produces:
  - `struct ConversationInsert { id, kind, name: Option<String>, partner_user_id: Option<String>, unread_count: i64, has_mention: bool, unread_threads: i64, last_read_ts: Option<String>, latest_ts: Option<String>, latest_snippet: Option<String> }`
  - `struct MessageInsert { conversation_id, ts, thread_ts: Option<String>, user_id: Option<String>, user_name: Option<String>, user_avatar: Option<String>, text: Option<String>, is_mention: bool, is_unread: bool, linear_identifier: Option<String>, created_at: String, raw_json: Option<String> }`
  - `struct UserInsert { id: String, name: Option<String>, avatar: Option<String> }`
  - `struct ConversationRow` (Serialize camelCase, FromRow), `struct MessageRow` (+ `linear_issue_id`), `struct ThreadRow`.
  - `async fn replace_catchup(pool, &[ConversationInsert], &[MessageInsert], &[UserInsert], synced_at: &str) -> Result<(), sqlx::Error>`
  - `async fn wipe_slack_cache(pool) -> Result<(), sqlx::Error>`
  - `async fn save_slack_identity(pool, user_id, team_id, url, workspace_name) -> Result<(), sqlx::Error>` and `async fn load_slack_identity(pool) -> Result<Option<SlackIdentity>, sqlx::Error>` with `struct SlackIdentity { user_id, team_id, url, workspace_name: Option<String> }`
  - `async fn list_conversations(pool) -> Result<Vec<ConversationRow>, sqlx::Error>`
  - `async fn list_mentions(pool) -> Result<Vec<MessageRow>, sqlx::Error>`
  - `async fn list_threads(pool) -> Result<Vec<ThreadRow>, sqlx::Error>`
  - `async fn list_conversation_messages(pool, conversation_id: &str) -> Result<Vec<MessageRow>, sqlx::Error>`
  - `const SLACK_USER_ID_KEY/SLACK_TEAM_ID_KEY/SLACK_URL_KEY/SLACK_WORKSPACE_NAME_KEY: &str`

- [ ] **Step 1: Write the failing tests** — create `src-tauri/src/db/slack.rs` containing the module body (Step 3) **and** these tests:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    async fn pool() -> (tempfile::TempDir, SqlitePool) {
        let dir = tempfile::tempdir().unwrap();
        let pool = crate::db::init_pool(&dir.path().join("astryn/t.db")).await.unwrap();
        (dir, pool)
    }

    fn conv(id: &str, kind: &str, unread: i64) -> ConversationInsert {
        ConversationInsert {
            id: id.into(),
            kind: kind.into(),
            name: Some("eng".into()),
            partner_user_id: None,
            unread_count: unread,
            has_mention: false,
            unread_threads: 0,
            last_read_ts: Some("1.0".into()),
            latest_ts: Some("2.0".into()),
            latest_snippet: Some("hi".into()),
        }
    }

    fn msg(conv: &str, ts: &str, mention: bool, thread: Option<&str>, linear: Option<&str>) -> MessageInsert {
        MessageInsert {
            conversation_id: conv.into(),
            ts: ts.into(),
            thread_ts: thread.map(str::to_string),
            user_id: Some("U2".into()),
            user_name: Some("Bob".into()),
            user_avatar: None,
            text: Some("body".into()),
            is_mention: mention,
            is_unread: true,
            linear_identifier: linear.map(str::to_string),
            created_at: "2026-06-23T00:00:00Z".into(),
            raw_json: None,
        }
    }

    #[tokio::test]
    async fn replace_catchup_inserts_and_replaces() {
        let (_d, pool) = pool().await;
        replace_catchup(
            &pool,
            &[conv("C1", "channel", 2)],
            &[msg("C1", "10.0", true, None, Some("ENG-1")), msg("C1", "11.0", false, Some("9.0"), None)],
            &[UserInsert { id: "U2".into(), name: Some("Bob".into()), avatar: None }],
            "now",
        )
        .await
        .unwrap();
        assert_eq!(list_conversations(&pool).await.unwrap().len(), 1);
        assert_eq!(list_conversation_messages(&pool, "C1").await.unwrap().len(), 2);

        // A second replace wipes the prior dataset (whole-cache replace).
        replace_catchup(&pool, &[conv("C2", "dm", 1)], &[], &[], "now2").await.unwrap();
        let convs = list_conversations(&pool).await.unwrap();
        assert_eq!(convs.len(), 1);
        assert_eq!(convs[0].id, "C2");
        assert!(list_conversation_messages(&pool, "C1").await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn mentions_and_threads_are_derived() {
        let (_d, pool) = pool().await;
        replace_catchup(
            &pool,
            &[conv("C1", "channel", 3)],
            &[
                msg("C1", "10.0", true, None, None),       // mention, top-level
                msg("C1", "11.0", false, Some("9.0"), None), // thread reply
                msg("C1", "12.0", true, Some("9.0"), None),  // thread reply + mention
            ],
            &[],
            "now",
        )
        .await
        .unwrap();
        assert_eq!(list_mentions(&pool).await.unwrap().len(), 2);
        let threads = list_threads(&pool).await.unwrap();
        assert_eq!(threads.len(), 1);
        assert_eq!(threads[0].thread_ts, "9.0");
        assert_eq!(threads[0].unread_replies, 2);
        assert_eq!(threads[0].has_mention, true);
    }

    #[tokio::test]
    async fn messages_join_linear_issue_id() {
        let (_d, pool) = pool().await;
        sqlx::query("INSERT INTO issues (id, identifier, title, url, created_at, updated_at, synced_at) VALUES ('iss-1','ENG-1','x','u','t','t','t')")
            .execute(&pool).await.unwrap();
        replace_catchup(&pool, &[conv("C1", "channel", 1)], &[msg("C1", "10.0", false, None, Some("ENG-1"))], &[], "now").await.unwrap();
        let rows = list_conversation_messages(&pool, "C1").await.unwrap();
        assert_eq!(rows[0].linear_issue_id.as_deref(), Some("iss-1"));
    }

    #[tokio::test]
    async fn identity_roundtrips_and_wipe_clears_everything() {
        let (_d, pool) = pool().await;
        save_slack_identity(&pool, "U1", "T1", "https://w.slack.com/", Some("Acme")).await.unwrap();
        replace_catchup(&pool, &[conv("C1", "channel", 1)], &[msg("C1", "10.0", false, None, None)], &[UserInsert { id: "U2".into(), name: None, avatar: None }], "now").await.unwrap();
        let id = load_slack_identity(&pool).await.unwrap().unwrap();
        assert_eq!((id.user_id.as_str(), id.team_id.as_str()), ("U1", "T1"));

        wipe_slack_cache(&pool).await.unwrap();
        assert!(list_conversations(&pool).await.unwrap().is_empty());
        assert!(list_conversation_messages(&pool, "C1").await.unwrap().is_empty());
        assert_eq!(load_slack_identity(&pool).await.unwrap(), None);
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml db::slack`
Expected: FAIL — module not found / fns missing.

- [ ] **Step 3: Write the module body** at the top of `src-tauri/src/db/slack.rs`:

```rust
use sqlx::SqlitePool;

pub const SLACK_USER_ID_KEY: &str = "slack_user_id";
pub const SLACK_TEAM_ID_KEY: &str = "slack_team_id";
pub const SLACK_URL_KEY: &str = "slack_workspace_url";
pub const SLACK_WORKSPACE_NAME_KEY: &str = "slack_workspace_name";
pub const SLACK_SYNCED_AT_KEY: &str = "last_synced_at";

#[derive(Debug, Clone)]
pub struct ConversationInsert {
    pub id: String,
    pub kind: String,
    pub name: Option<String>,
    pub partner_user_id: Option<String>,
    pub unread_count: i64,
    pub has_mention: bool,
    pub unread_threads: i64,
    pub last_read_ts: Option<String>,
    pub latest_ts: Option<String>,
    pub latest_snippet: Option<String>,
}

#[derive(Debug, Clone)]
pub struct MessageInsert {
    pub conversation_id: String,
    pub ts: String,
    pub thread_ts: Option<String>,
    pub user_id: Option<String>,
    pub user_name: Option<String>,
    pub user_avatar: Option<String>,
    pub text: Option<String>,
    pub is_mention: bool,
    pub is_unread: bool,
    pub linear_identifier: Option<String>,
    pub created_at: String,
    pub raw_json: Option<String>,
}

#[derive(Debug, Clone)]
pub struct UserInsert {
    pub id: String,
    pub name: Option<String>,
    pub avatar: Option<String>,
}

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ConversationRow {
    pub id: String,
    pub kind: String,
    pub name: Option<String>,
    pub partner_user_id: Option<String>,
    pub unread_count: i64,
    pub has_mention: bool,
    pub unread_threads: i64,
    pub latest_ts: Option<String>,
    pub latest_snippet: Option<String>,
}

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct MessageRow {
    pub conversation_id: String,
    pub ts: String,
    pub thread_ts: Option<String>,
    pub user_id: Option<String>,
    pub user_name: Option<String>,
    pub user_avatar: Option<String>,
    pub text: Option<String>,
    pub is_mention: bool,
    pub linear_identifier: Option<String>,
    pub linear_issue_id: Option<String>,
    pub created_at: String,
}

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ThreadRow {
    pub conversation_id: String,
    pub conversation_name: Option<String>,
    pub thread_ts: String,
    pub unread_replies: i64,
    pub has_mention: bool,
    pub latest_ts: String,
}

#[derive(Debug, PartialEq)]
pub struct SlackIdentity {
    pub user_id: String,
    pub team_id: String,
    pub url: String,
    pub workspace_name: Option<String>,
}

/// Whole-cache replace: a single transaction clears the prior conversations,
/// messages, and users, then inserts the new dataset + sync timestamp. The
/// dataset is small (one workspace), so all-or-nothing keeps the cache from
/// ever being left half-written.
pub async fn replace_catchup(
    pool: &SqlitePool,
    conversations: &[ConversationInsert],
    messages: &[MessageInsert],
    users: &[UserInsert],
    synced_at: &str,
) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM slack_conversations").execute(&mut *tx).await?;
    sqlx::query("DELETE FROM slack_messages").execute(&mut *tx).await?;
    sqlx::query("DELETE FROM slack_users").execute(&mut *tx).await?;
    for c in conversations {
        sqlx::query(
            "INSERT INTO slack_conversations
               (id, kind, name, partner_user_id, unread_count, has_mention, unread_threads,
                last_read_ts, latest_ts, latest_snippet, synced_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
        )
        .bind(&c.id).bind(&c.kind).bind(&c.name).bind(&c.partner_user_id)
        .bind(c.unread_count).bind(c.has_mention).bind(c.unread_threads)
        .bind(&c.last_read_ts).bind(&c.latest_ts).bind(&c.latest_snippet).bind(synced_at)
        .execute(&mut *tx).await?;
    }
    for m in messages {
        sqlx::query(
            "INSERT INTO slack_messages
               (conversation_id, ts, thread_ts, user_id, user_name, user_avatar, text,
                is_mention, is_unread, linear_identifier, created_at, raw_json)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)
             ON CONFLICT(conversation_id, ts) DO NOTHING",
        )
        .bind(&m.conversation_id).bind(&m.ts).bind(&m.thread_ts).bind(&m.user_id)
        .bind(&m.user_name).bind(&m.user_avatar).bind(&m.text).bind(m.is_mention)
        .bind(m.is_unread).bind(&m.linear_identifier).bind(&m.created_at).bind(&m.raw_json)
        .execute(&mut *tx).await?;
    }
    for u in users {
        sqlx::query(
            "INSERT INTO slack_users (id, name, avatar, synced_at) VALUES (?1,?2,?3,?4)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, avatar = excluded.avatar, synced_at = excluded.synced_at",
        )
        .bind(&u.id).bind(&u.name).bind(&u.avatar).bind(synced_at)
        .execute(&mut *tx).await?;
    }
    sqlx::query(
        "INSERT INTO slack_sync_meta (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(SLACK_SYNCED_AT_KEY).bind(synced_at)
    .execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(())
}

/// Drop all Slack cache + identity. Leaves Linear and GitHub untouched.
pub async fn wipe_slack_cache(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    for t in ["slack_conversations", "slack_messages", "slack_users", "slack_sync_meta"] {
        sqlx::query(&format!("DELETE FROM {t}")).execute(&mut *tx).await?;
    }
    sqlx::query("DELETE FROM settings WHERE key IN (?1, ?2, ?3, ?4)")
        .bind(SLACK_USER_ID_KEY).bind(SLACK_TEAM_ID_KEY).bind(SLACK_URL_KEY).bind(SLACK_WORKSPACE_NAME_KEY)
        .execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(())
}

pub async fn save_slack_identity(
    pool: &SqlitePool,
    user_id: &str,
    team_id: &str,
    url: &str,
    workspace_name: Option<&str>,
) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    let mut pairs = vec![
        (SLACK_USER_ID_KEY, user_id.to_string()),
        (SLACK_TEAM_ID_KEY, team_id.to_string()),
        (SLACK_URL_KEY, url.to_string()),
    ];
    if let Some(name) = workspace_name {
        pairs.push((SLACK_WORKSPACE_NAME_KEY, name.to_string()));
    }
    for (k, v) in pairs {
        sqlx::query("INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
            .bind(k).bind(v).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(())
}

pub async fn load_slack_identity(pool: &SqlitePool) -> Result<Option<SlackIdentity>, sqlx::Error> {
    let user_id = crate::db::load_setting(pool, SLACK_USER_ID_KEY).await?;
    let team_id = crate::db::load_setting(pool, SLACK_TEAM_ID_KEY).await?;
    let url = crate::db::load_setting(pool, SLACK_URL_KEY).await?;
    let workspace_name = crate::db::load_setting(pool, SLACK_WORKSPACE_NAME_KEY).await?;
    Ok(match (user_id, team_id, url) {
        (Some(user_id), Some(team_id), Some(url)) => Some(SlackIdentity { user_id, team_id, url, workspace_name }),
        _ => None,
    })
}

pub async fn list_conversations(pool: &SqlitePool) -> Result<Vec<ConversationRow>, sqlx::Error> {
    sqlx::query_as::<_, ConversationRow>(
        "SELECT id, kind, name, partner_user_id, unread_count, has_mention, unread_threads, latest_ts, latest_snippet
         FROM slack_conversations
         ORDER BY (latest_ts IS NULL), latest_ts DESC",
    )
    .fetch_all(pool)
    .await
}

pub async fn list_mentions(pool: &SqlitePool) -> Result<Vec<MessageRow>, sqlx::Error> {
    message_rows(pool, "m.is_mention = 1 AND m.is_unread = 1", "m.ts DESC", None).await
}

pub async fn list_conversation_messages(
    pool: &SqlitePool,
    conversation_id: &str,
) -> Result<Vec<MessageRow>, sqlx::Error> {
    message_rows(pool, "m.conversation_id = ?1 AND m.is_unread = 1", "m.ts ASC", Some(conversation_id)).await
}

async fn message_rows(
    pool: &SqlitePool,
    where_clause: &str,
    order: &str,
    bind: Option<&str>,
) -> Result<Vec<MessageRow>, sqlx::Error> {
    let sql = format!(
        "SELECT m.conversation_id, m.ts, m.thread_ts, m.user_id, m.user_name, m.user_avatar, m.text,
                m.is_mention, m.linear_identifier, i.id AS linear_issue_id, m.created_at
         FROM slack_messages m
         LEFT JOIN issues i ON i.identifier = m.linear_identifier
         WHERE {where_clause}
         ORDER BY {order}"
    );
    let mut q = sqlx::query_as::<_, MessageRow>(&sql);
    if let Some(b) = bind {
        q = q.bind(b);
    }
    q.fetch_all(pool).await
}

pub async fn list_threads(pool: &SqlitePool) -> Result<Vec<ThreadRow>, sqlx::Error> {
    sqlx::query_as::<_, ThreadRow>(
        "SELECT m.conversation_id, c.name AS conversation_name, m.thread_ts,
                COUNT(*) AS unread_replies, MAX(m.is_mention) AS has_mention, MAX(m.ts) AS latest_ts
         FROM slack_messages m
         JOIN slack_conversations c ON c.id = m.conversation_id
         WHERE m.thread_ts IS NOT NULL AND m.is_unread = 1
         GROUP BY m.conversation_id, m.thread_ts
         ORDER BY latest_ts DESC",
    )
    .fetch_all(pool)
    .await
}
```

- [ ] **Step 4: Wire the module + run tests** — in `src-tauri/src/db/mod.rs`, add `pub mod slack;` next to `pub mod github;` (line ~5). Then:

Run: `cargo test --manifest-path src-tauri/Cargo.toml db::slack`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/db/slack.rs src-tauri/src/db/mod.rs
git commit -m "feat(slack): SQLite repository (replace/wipe/identity/list)"
```

---

## Task 6: `commands/slack.rs` — status + token logic, AppState wiring

**Files:**
- Create: `src-tauri/src/commands/slack.rs`
- Modify: `src-tauri/src/commands/mod.rs` (`pub mod slack;`, `AppState` fields, `CmdError::SlackNotConfigured`)
- Modify: `src-tauri/src/lib.rs` (build Slack creds/client/lock/generation; register 4 commands; `SLACK_TOKEN_ACCOUNT`)

**Interfaces:**
- Consumes: `db::slack` (Task 5), `slack::{SlackClient, SlackCredentialProvider, SlackError}`, `slack::catchup::parse_auth_test`.
- Produces:
  - `const SLACK_TOKEN_ACCOUNT: &str` (re-exported from `lib.rs` as the GitHub one is)
  - `enum SlackStatus { NotConfigured, Unverified, Connected { workspace_name: Option<String>, user_name: String } }`
  - `fn compute_slack_status(has_token: bool, identity: Option<db::slack::SlackIdentity>) -> SlackStatus`
  - `async fn set_slack_token_logic(store, pool, generation, token) -> Result<(), CmdError>`
  - `async fn clear_slack_token_logic(store, pool, generation) -> Result<(), CmdError>`
  - `async fn get_slack_status_logic(store, pool) -> Result<SlackStatus, CmdError>`
  - `async fn test_slack_connection_logic<F,Fut>(creds, pool, fetch_auth) -> Result<SlackStatus, CmdError>` where `fetch_auth: FnOnce(String) -> Fut`, `Fut: Future<Output = Result<catchup::AuthTest, SlackError>>`
  - AppState fields: `slack_credentials: Arc<dyn SlackCredentialProvider>`, `slack: SlackClient`, `slack_lock: tokio::sync::Mutex<()>`, `slack_generation: AtomicU64`
  - Tauri commands: `set_slack_token`, `clear_slack_token`, `get_slack_status`, `test_slack_connection`.

- [ ] **Step 1: Add the Slack `CmdError` variants** — in `src-tauri/src/commands/mod.rs`, inside `enum CmdError` (after `GitHubApi`, ~line 113):

```rust
    #[error("No Slack token is configured.")]
    SlackNotConfigured,
    #[error("Slack rejected the request.")]
    SlackApi,
```

- [ ] **Step 2: Add AppState fields** — in `src-tauri/src/commands/mod.rs`, append to `struct AppState` (after `github_generation`, ~line 189):

```rust
    pub slack_credentials: Arc<dyn crate::slack::SlackCredentialProvider>,
    pub slack: crate::slack::SlackClient,
    /// Serializes Slack credential mutations and sync (set/clear/test/sync).
    pub slack_lock: tokio::sync::Mutex<()>,
    /// Bumped by every Slack cache wipe; guards a late sync write.
    pub slack_generation: AtomicU64,
```

Add `pub mod slack;` near the top of `commands/mod.rs` (next to where other command submodules are declared — search for `pub mod github;` and add below it).

- [ ] **Step 3: Write the failing tests** — create `src-tauri/src/commands/slack.rs` with the body (Step 4) plus:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::secrets::fake::FakeSecretStore;
    use crate::slack::catchup::AuthTest;
    use crate::slack::fake::FakeSlackCreds;
    use crate::slack::SlackCredentialProvider;

    async fn pool() -> (tempfile::TempDir, SqlitePool) {
        let dir = tempfile::tempdir().unwrap();
        let pool = crate::db::init_pool(&dir.path().join("astryn/t.db")).await.unwrap();
        (dir, pool)
    }

    #[test]
    fn status_computation() {
        assert!(matches!(compute_slack_status(false, None), SlackStatus::NotConfigured));
        assert!(matches!(compute_slack_status(true, None), SlackStatus::Unverified));
        let id = crate::db::slack::SlackIdentity {
            user_id: "U1".into(), team_id: "T1".into(), url: "u".into(), workspace_name: Some("Acme".into()),
        };
        match compute_slack_status(true, Some(id)) {
            SlackStatus::Connected { user_name, workspace_name } => {
                assert_eq!(user_name, "U1");
                assert_eq!(workspace_name.as_deref(), Some("Acme"));
            }
            _ => panic!("expected Connected"),
        }
    }

    #[tokio::test]
    async fn set_token_wipes_prior_slack_state() {
        let (_d, pool) = pool().await;
        crate::db::slack::save_slack_identity(&pool, "old", "T", "u", None).await.unwrap();
        let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());
        let gen = AtomicU64::new(0);
        set_slack_token_logic(store.clone(), &pool, &gen, "xoxp-new".into()).await.unwrap();
        assert_eq!(crate::db::slack::load_slack_identity(&pool).await.unwrap(), None);
        assert_eq!(gen.load(Ordering::SeqCst), 1);
        assert_eq!(store.get(SLACK_TOKEN_ACCOUNT).unwrap(), Some("xoxp-new".into()));
    }

    #[tokio::test]
    async fn get_status_is_offline() {
        let (_d, pool) = pool().await;
        let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());
        assert!(matches!(get_slack_status_logic(store.clone(), &pool).await.unwrap(), SlackStatus::NotConfigured));
        store.set(SLACK_TOKEN_ACCOUNT, "xoxp-x").unwrap();
        assert!(matches!(get_slack_status_logic(store.clone(), &pool).await.unwrap(), SlackStatus::Unverified));
        crate::db::slack::save_slack_identity(&pool, "U1", "T1", "u", Some("Acme")).await.unwrap();
        match get_slack_status_logic(store, &pool).await.unwrap() {
            SlackStatus::Connected { user_name, .. } => assert_eq!(user_name, "U1"),
            _ => panic!("expected Connected"),
        }
    }

    #[tokio::test]
    async fn test_connection_caches_identity() {
        let (_d, pool) = pool().await;
        let creds: Arc<dyn SlackCredentialProvider> = Arc::new(FakeSlackCreds(Some("Bearer x".into())));
        let status = test_slack_connection_logic(creds, &pool, |_auth| async {
            Ok(AuthTest { user_id: "U1".into(), team_id: "T1".into(), url: "https://acme.slack.com/".into(), user: "abrar".into() })
        })
        .await
        .unwrap();
        assert!(matches!(status, SlackStatus::Connected { .. }));
        let id = crate::db::slack::load_slack_identity(&pool).await.unwrap().unwrap();
        assert_eq!(id.team_id, "T1");
    }

    #[tokio::test]
    async fn test_connection_without_token_is_not_configured_error() {
        let (_d, pool) = pool().await;
        let creds: Arc<dyn SlackCredentialProvider> = Arc::new(FakeSlackCreds(None));
        let r = test_slack_connection_logic(creds, &pool, |_a| async {
            Ok(AuthTest { user_id: "U1".into(), team_id: "T1".into(), url: "u".into(), user: "x".into() })
        })
        .await;
        assert!(matches!(r, Err(CmdError::SlackNotConfigured)));
    }
}
```

- [ ] **Step 4: Write the module body** at the top of `src-tauri/src/commands/slack.rs`:

```rust
use serde::Serialize;
use sqlx::SqlitePool;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tauri::State;

use super::{AppState, CmdError};
use crate::db::slack as sdb;
use crate::slack::catchup::{self, AuthTest};
use crate::slack::{SlackCredentialProvider, SlackError};
use crate::secrets::SecretStore;

use super::super::SLACK_TOKEN_ACCOUNT;

#[derive(Serialize, Debug, PartialEq)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum SlackStatus {
    NotConfigured,
    Unverified,
    Connected {
        #[serde(rename = "workspaceName")]
        workspace_name: Option<String>,
        #[serde(rename = "userName")]
        user_name: String,
    },
}

pub fn compute_slack_status(has_token: bool, identity: Option<sdb::SlackIdentity>) -> SlackStatus {
    match (has_token, identity) {
        (false, _) => SlackStatus::NotConfigured,
        (true, Some(id)) => SlackStatus::Connected {
            workspace_name: id.workspace_name,
            user_name: id.user_id,
        },
        (true, None) => SlackStatus::Unverified,
    }
}

pub async fn set_slack_token_logic(
    store: Arc<dyn SecretStore>,
    pool: &SqlitePool,
    generation: &AtomicU64,
    token: String,
) -> Result<(), CmdError> {
    // Wipe + bump BEFORE the keyring write so a keyring failure leaves an empty
    // cache (safe), never the new token paired with the prior account's data.
    sdb::wipe_slack_cache(pool).await.map_err(|_| CmdError::Internal)?;
    generation.fetch_add(1, Ordering::SeqCst);
    let s = store.clone();
    tokio::task::spawn_blocking(move || s.set(SLACK_TOKEN_ACCOUNT, &token))
        .await
        .map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::SecretStore)?;
    Ok(())
}

pub async fn clear_slack_token_logic(
    store: Arc<dyn SecretStore>,
    pool: &SqlitePool,
    generation: &AtomicU64,
) -> Result<(), CmdError> {
    sdb::wipe_slack_cache(pool).await.map_err(|_| CmdError::Internal)?;
    generation.fetch_add(1, Ordering::SeqCst);
    let s = store.clone();
    tokio::task::spawn_blocking(move || s.delete(SLACK_TOKEN_ACCOUNT))
        .await
        .map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::SecretStore)?;
    Ok(())
}

pub async fn get_slack_status_logic(
    store: Arc<dyn SecretStore>,
    pool: &SqlitePool,
) -> Result<SlackStatus, CmdError> {
    let s = store.clone();
    let has_token = tokio::task::spawn_blocking(move || s.get(SLACK_TOKEN_ACCOUNT))
        .await
        .map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::SecretStore)?
        .is_some();
    let identity = sdb::load_slack_identity(pool).await.map_err(|_| CmdError::Internal)?;
    Ok(compute_slack_status(has_token, identity))
}

async fn authorize(credentials: &Arc<dyn SlackCredentialProvider>) -> Result<String, CmdError> {
    let c = credentials.clone();
    tokio::task::spawn_blocking(move || c.authorization())
        .await
        .map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::SecretStore)?
        .ok_or(CmdError::SlackNotConfigured)
}

pub async fn test_slack_connection_logic<F, Fut>(
    credentials: Arc<dyn SlackCredentialProvider>,
    pool: &SqlitePool,
    fetch_auth: F,
) -> Result<SlackStatus, CmdError>
where
    F: FnOnce(String) -> Fut,
    Fut: std::future::Future<Output = Result<AuthTest, SlackError>>,
{
    let auth = authorize(&credentials).await?;
    let a = fetch_auth(auth).await.map_err(map_slack_err)?;
    let workspace_name = workspace_name_from_url(&a.url);
    sdb::save_slack_identity(pool, &a.user_id, &a.team_id, &a.url, workspace_name.as_deref())
        .await
        .map_err(|_| CmdError::Internal)?;
    Ok(SlackStatus::Connected {
        workspace_name,
        user_name: a.user_id,
    })
}

/// Best-effort workspace label from the team URL (e.g. https://acme.slack.com/ -> "acme").
fn workspace_name_from_url(url: &str) -> Option<String> {
    url.strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
        .and_then(|rest| rest.split('.').next())
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

pub fn map_slack_err(e: SlackError) -> CmdError {
    match e {
        SlackError::Network => CmdError::Network,
        SlackError::Auth => CmdError::SlackNotConfigured,
        SlackError::RateLimited(_) => CmdError::RateLimited,
        SlackError::Server | SlackError::Malformed | SlackError::Api(_) => CmdError::SlackApi,
    }
}

/// Live `auth.test`.
async fn fetch_auth_test(client: &crate::slack::SlackClient, auth: String) -> Result<AuthTest, SlackError> {
    let body = client.call(&auth, "auth.test", &[]).await?;
    catchup::parse_auth_test(&body)
}

#[tauri::command]
pub async fn set_slack_token(state: State<'_, AppState>, token: String) -> Result<(), CmdError> {
    let _g = state.slack_lock.lock().await;
    set_slack_token_logic(state.secret_store.clone(), &state.pool, &state.slack_generation, token).await
}

#[tauri::command]
pub async fn clear_slack_token(state: State<'_, AppState>) -> Result<(), CmdError> {
    let _g = state.slack_lock.lock().await;
    clear_slack_token_logic(state.secret_store.clone(), &state.pool, &state.slack_generation).await
}

#[tauri::command]
pub async fn get_slack_status(state: State<'_, AppState>) -> Result<SlackStatus, CmdError> {
    get_slack_status_logic(state.secret_store.clone(), &state.pool).await
}

#[tauri::command]
pub async fn test_slack_connection(state: State<'_, AppState>) -> Result<SlackStatus, CmdError> {
    let _g = state.slack_lock.lock().await;
    let client = state.slack.clone();
    test_slack_connection_logic(state.slack_credentials.clone(), &state.pool, move |auth| async move {
        fetch_auth_test(&client, auth).await
    })
    .await
}
```

- [ ] **Step 5: Wire AppState construction + command registration** — in `src-tauri/src/lib.rs`:

Add the account constant near the others (line ~18):
```rust
const SLACK_TOKEN_ACCOUNT: &str = "slack_user_token";
```

Add imports (line ~12–14, alongside the github/linear imports):
```rust
use slack::{SlackClient, SlackCredentialProvider, PersonalTokenProvider};
```

In `setup`, after the GitHub client is built (line ~86), build the Slack ones:
```rust
            let slack_credentials: Arc<dyn SlackCredentialProvider> =
                Arc::new(PersonalTokenProvider::new(store.clone(), SLACK_TOKEN_ACCOUNT));
            let slack = SlackClient::new().expect("failed to build Slack HTTP client");
```

Add them to the `app.manage(AppState { ... })` literal (after `github_generation`, line ~106):
```rust
                slack_credentials,
                slack,
                slack_lock: tokio::sync::Mutex::new(()),
                slack_generation: std::sync::atomic::AtomicU64::new(0),
```

Register the commands inside `tauri::generate_handler![ ... ]` (after the github entries, line ~158):
```rust
            commands::slack::set_slack_token,
            commands::slack::clear_slack_token,
            commands::slack::get_slack_status,
            commands::slack::test_slack_connection,
```

- [ ] **Step 6: Run tests + build**

Run: `cargo test --manifest-path src-tauri/Cargo.toml commands::slack`
Then: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: PASS (5 tests) and a clean build.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/commands/slack.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat(slack): status + token commands, credential isolation, AppState wiring"
```

---

## Task 7: `commands/slack.rs` — sync, list, conversation messages, deep link

**Files:**
- Modify: `src-tauri/src/commands/slack.rs`
- Modify: `src-tauri/src/lib.rs` (register 4 more commands)

**Interfaces:**
- Consumes: Task 5 `db::slack`, Task 3/4 `catchup`, Task 6 `authorize`/`map_slack_err`, AppState Slack fields.
- Produces:
  - `struct SlackCatchup { conversations: Vec<sdb::ConversationRow>, mentions: Vec<sdb::MessageRow>, threads: Vec<sdb::ThreadRow>, last_synced_at: Option<String> }` (Serialize camelCase)
  - `struct ConversationData` (the per-conversation fetch result, used by the injected fetch closure): `{ info: catchup::ParsedInfo, messages: Vec<catchup::ParsedMessage>, replies: Vec<(String, Vec<catchup::ParsedMessage>)> }`
  - `async fn sync_slack_catchup_logic<L,LF,C,CF>(creds, pool, generation, viewer_id, now, list_convs, fetch_conv) -> Result<SlackSyncSummary, CmdError>` — fetch closures injected for testing.
  - `struct SlackSyncSummary { synced: bool, conversation_count: i64, unread_total: i64 }` (Serialize camelCase)
  - `async fn get_slack_catchup_logic(pool) -> Result<SlackCatchup, CmdError>`
  - `async fn get_slack_conversation_messages_logic(pool, id) -> Result<Vec<sdb::MessageRow>, CmdError>`
  - `fn slack_deep_link_logic(identity, conversation_id, ts) -> (String, String)` — `(app_url, web_url)`.
  - Tauri commands: `sync_slack_catchup`, `get_slack_catchup`, `get_slack_conversation_messages`, `slack_deep_link`.

- [ ] **Step 1: Write the failing tests** — append to the `tests` module in `src-tauri/src/commands/slack.rs`:

```rust
    use crate::slack::catchup::{ParsedConversation, ParsedInfo, ParsedMessage, ConvKind};

    fn pmsg(ts: &str, user: &str, text: &str) -> ParsedMessage {
        ParsedMessage { ts: ts.into(), thread_ts: None, user_id: Some(user.into()), text: text.into(), subtype: None, reply_count: None, latest_reply: None }
    }

    #[tokio::test]
    async fn sync_populates_cache_and_derives_views() {
        let (_d, pool) = pool().await;
        let creds: Arc<dyn SlackCredentialProvider> = Arc::new(FakeSlackCreds(Some("Bearer x".into())));
        let gen = AtomicU64::new(0);
        let convs = vec![ParsedConversation { id: "C1".into(), kind: ConvKind::Channel, name: Some("eng".into()), is_member: true, partner_user_id: None }];
        let summary = sync_slack_catchup_logic(
            creds, &pool, &gen, "U1".into(), "now".into(),
            move |_auth| { let convs = convs.clone(); async move { Ok(convs) } },
            move |_auth, _conv_id, _last_read| async move {
                Ok(ConversationData {
                    info: ParsedInfo { last_read: Some("5.0".into()), unread_count_display: None, latest_ts: Some("7.0".into()) },
                    messages: vec![pmsg("6.0", "U2", "hi <@U1>"), pmsg("7.0", "U1", "my own")],
                    replies: vec![],
                })
            },
        ).await.unwrap();
        assert!(summary.synced);
        assert_eq!(summary.conversation_count, 1);

        let dash = get_slack_catchup_logic(&pool).await.unwrap();
        assert_eq!(dash.conversations.len(), 1);
        assert_eq!(dash.conversations[0].unread_count, 1); // U1's own message excluded
        assert_eq!(dash.conversations[0].has_mention, true);
        assert_eq!(dash.mentions.len(), 1);
    }

    #[tokio::test]
    async fn sync_failure_leaves_prior_cache() {
        let (_d, pool) = pool().await;
        // Seed a prior cache.
        crate::db::slack::replace_catchup(&pool, &[crate::db::slack::ConversationInsert {
            id: "OLD".into(), kind: "channel".into(), name: Some("old".into()), partner_user_id: None,
            unread_count: 1, has_mention: false, unread_threads: 0, last_read_ts: None, latest_ts: Some("1.0".into()), latest_snippet: None,
        }], &[], &[], "old").await.unwrap();
        let creds: Arc<dyn SlackCredentialProvider> = Arc::new(FakeSlackCreds(Some("Bearer x".into())));
        let gen = AtomicU64::new(0);
        let r = sync_slack_catchup_logic(
            creds, &pool, &gen, "U1".into(), "now".into(),
            |_auth| async { Err::<Vec<ParsedConversation>, _>(SlackError::Network) },
            |_a, _c, _l| async { unreachable!() },
        ).await;
        assert!(r.is_err());
        // Prior cache preserved (all-or-nothing).
        assert_eq!(get_slack_catchup_logic(&pool).await.unwrap().conversations.len(), 1);
    }

    #[tokio::test]
    async fn sync_aborts_on_generation_change() {
        let (_d, pool) = pool().await;
        let creds: Arc<dyn SlackCredentialProvider> = Arc::new(FakeSlackCreds(Some("Bearer x".into())));
        let gen = AtomicU64::new(0);
        let convs = vec![ParsedConversation { id: "C1".into(), kind: ConvKind::Channel, name: None, is_member: true, partner_user_id: None }];
        // Bump the generation on the first per-conversation fetch (simulating a
        // token swap mid-flight) so the guard trips before the cache write.
        let bumped = std::sync::atomic::AtomicBool::new(false);
        let r = sync_slack_catchup_logic(
            creds, &pool, &gen, "U1".into(), "now".into(),
            move |_auth| { let convs = convs.clone(); async move { Ok(convs) } },
            |_a, _c, _l| {
                if !bumped.swap(true, Ordering::SeqCst) { gen.fetch_add(1, Ordering::SeqCst); }
                async move { Ok(ConversationData { info: ParsedInfo::default(), messages: vec![], replies: vec![] }) }
            },
        ).await;
        assert!(matches!(r, Err(CmdError::WorkspaceChanged)));
        assert!(get_slack_catchup_logic(&pool).await.unwrap().conversations.is_empty());
    }

    #[test]
    fn deep_link_builds_app_and_web_urls() {
        let id = crate::db::slack::SlackIdentity { user_id: "U1".into(), team_id: "T1".into(), url: "https://acme.slack.com/".into(), workspace_name: Some("acme".into()) };
        let (app, web) = slack_deep_link_logic(&id, "C1", Some("123.456"));
        assert_eq!(app, "slack://channel?team=T1&id=C1&message=123.456");
        assert_eq!(web, "https://acme.slack.com/archives/C1/p123456");
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml commands::slack`
Expected: FAIL — `sync_slack_catchup_logic` etc. not found.

- [ ] **Step 3: Write the sync/list/deeplink logic** — append (above the `tests` module) in `src-tauri/src/commands/slack.rs`:

```rust
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SlackCatchup {
    pub conversations: Vec<sdb::ConversationRow>,
    pub mentions: Vec<sdb::MessageRow>,
    pub threads: Vec<sdb::ThreadRow>,
    pub last_synced_at: Option<String>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SlackSyncSummary {
    pub synced: bool,
    pub conversation_count: i64,
    pub unread_total: i64,
}

/// Per-conversation fetch result the orchestrator turns into cache rows.
/// `replies`: (thread_ts, replies-after-last_read) for each candidate thread.
pub struct ConversationData {
    pub info: catchup::ParsedInfo,
    pub messages: Vec<catchup::ParsedMessage>,
    pub replies: Vec<(String, Vec<catchup::ParsedMessage>)>,
}

fn ts_to_iso(ts: &str) -> String {
    let secs = ts.split('.').next().and_then(|s| s.parse::<i64>().ok()).unwrap_or(0);
    time::OffsetDateTime::from_unix_timestamp(secs)
        .ok()
        .and_then(|t| t.format(&time::format_description::well_known::Rfc3339).ok())
        .unwrap_or_default()
}

fn snippet(text: &str) -> String {
    let one_line = text.replace('\n', " ");
    if one_line.chars().count() > 140 {
        one_line.chars().take(140).collect::<String>() + "…"
    } else {
        one_line
    }
}

#[allow(clippy::too_many_arguments)]
pub async fn sync_slack_catchup_logic<L, LF, C, CF>(
    credentials: Arc<dyn SlackCredentialProvider>,
    pool: &SqlitePool,
    generation: &AtomicU64,
    viewer_id: String,
    now: String,
    list_convs: L,
    fetch_conv: C,
) -> Result<SlackSyncSummary, CmdError>
where
    L: FnOnce(String) -> LF,
    LF: std::future::Future<Output = Result<Vec<catchup::ParsedConversation>, SlackError>>,
    C: Fn(String, String, Option<String>) -> CF,
    CF: std::future::Future<Output = Result<ConversationData, SlackError>>,
{
    let auth = authorize(&credentials).await?;
    let gen0 = generation.load(Ordering::SeqCst);

    let conversations = list_convs(auth.clone()).await.map_err(map_slack_err)?;

    let mut conv_inserts: Vec<sdb::ConversationInsert> = Vec::new();
    let mut msg_inserts: Vec<sdb::MessageInsert> = Vec::new();
    let mut user_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut unread_total = 0i64;

    for conv in &conversations {
        let data = fetch_conv(auth.clone(), conv.id.clone(), None)
            .await
            .map_err(map_slack_err)?;
        let last_read = data.info.last_read.clone();

        // Top-level unread (channels compute from history; DMs trust the display count).
        let unread: Vec<&catchup::ParsedMessage> = catchup::unread_messages(&data.messages, &viewer_id);
        let mut has_mention = false;
        let mut latest_ts: Option<String> = None;
        let mut latest_snippet: Option<String> = None;

        for m in &unread {
            let is_mention = catchup::detect_mention(&m.text, &viewer_id);
            has_mention |= is_mention;
            if latest_ts.as_deref().map(|cur| catchup::ts_gt(&m.ts, cur)).unwrap_or(true) {
                latest_ts = Some(m.ts.clone());
                latest_snippet = Some(snippet(&m.text));
            }
            if let Some(u) = &m.user_id { user_ids.insert(u.clone()); }
            msg_inserts.push(sdb::MessageInsert {
                conversation_id: conv.id.clone(),
                ts: m.ts.clone(),
                thread_ts: m.thread_ts.clone(),
                user_id: m.user_id.clone(),
                user_name: None,
                user_avatar: None,
                text: Some(m.text.clone()),
                is_mention,
                is_unread: true,
                linear_identifier: catchup::linear_id(&m.text),
                created_at: ts_to_iso(&m.ts),
                raw_json: None,
            });
        }

        // Thread replies (already fetched after last_read by the caller).
        let mut unread_threads = 0i64;
        for (thread_ts, replies) in &data.replies {
            let reply_unread = catchup::unread_messages(replies, &viewer_id);
            let reply_unread: Vec<&catchup::ParsedMessage> =
                reply_unread.into_iter().filter(|m| &m.ts != thread_ts).collect();
            if reply_unread.is_empty() { continue; }
            unread_threads += 1;
            for m in reply_unread {
                let is_mention = catchup::detect_mention(&m.text, &viewer_id);
                has_mention |= is_mention;
                if let Some(u) = &m.user_id { user_ids.insert(u.clone()); }
                msg_inserts.push(sdb::MessageInsert {
                    conversation_id: conv.id.clone(),
                    ts: m.ts.clone(),
                    thread_ts: Some(thread_ts.clone()),
                    user_id: m.user_id.clone(),
                    user_name: None,
                    user_avatar: None,
                    text: Some(m.text.clone()),
                    is_mention,
                    is_unread: true,
                    linear_identifier: catchup::linear_id(&m.text),
                    created_at: ts_to_iso(&m.ts),
                    raw_json: None,
                });
            }
        }

        let unread_count = match (&conv.kind, data.info.unread_count_display) {
            (catchup::ConvKind::Dm, Some(n)) | (catchup::ConvKind::GroupDm, Some(n)) => n,
            _ => unread.len() as i64,
        };
        unread_total += unread_count;

        // Skip conversations with nothing to show.
        if unread_count == 0 && unread_threads == 0 { continue; }

        conv_inserts.push(sdb::ConversationInsert {
            id: conv.id.clone(),
            kind: conv.kind.as_str().to_string(),
            name: conv.name.clone(),
            partner_user_id: conv.partner_user_id.clone(),
            unread_count,
            has_mention,
            unread_threads,
            last_read_ts: last_read,
            latest_ts,
            latest_snippet,
        });
    }

    // Resolve user identities for rendering (best-effort; failure is non-fatal).
    let mut users: Vec<sdb::UserInsert> = Vec::new();
    for uid in &user_ids {
        // The caller can't inject per-user fetch cheaply; identities are resolved
        // in the Tauri wrapper which pre-populates user_name/avatar on inserts.
        users.push(sdb::UserInsert { id: uid.clone(), name: None, avatar: None });
    }

    // Abort if the token changed mid-flight: a partial write would be ambiguous.
    if generation.load(Ordering::SeqCst) != gen0 {
        return Err(CmdError::WorkspaceChanged);
    }

    sdb::replace_catchup(pool, &conv_inserts, &msg_inserts, &users, &now)
        .await
        .map_err(|_| CmdError::Internal)?;

    Ok(SlackSyncSummary {
        synced: true,
        conversation_count: conv_inserts.len() as i64,
        unread_total,
    })
}

pub async fn get_slack_catchup_logic(pool: &SqlitePool) -> Result<SlackCatchup, CmdError> {
    let conversations = sdb::list_conversations(pool).await.map_err(|_| CmdError::Internal)?;
    let mentions = sdb::list_mentions(pool).await.map_err(|_| CmdError::Internal)?;
    let threads = sdb::list_threads(pool).await.map_err(|_| CmdError::Internal)?;
    let last_synced_at = crate::db::load_setting(pool, sdb::SLACK_SYNCED_AT_KEY)
        .await
        .map_err(|_| CmdError::Internal)?;
    Ok(SlackCatchup { conversations, mentions, threads, last_synced_at })
}

pub async fn get_slack_conversation_messages_logic(
    pool: &SqlitePool,
    conversation_id: &str,
) -> Result<Vec<sdb::MessageRow>, CmdError> {
    sdb::list_conversation_messages(pool, conversation_id)
        .await
        .map_err(|_| CmdError::Internal)
}

/// Build the native deep link (and a web fallback) into a Slack conversation/message.
pub fn slack_deep_link_logic(
    identity: &sdb::SlackIdentity,
    conversation_id: &str,
    ts: Option<&str>,
) -> (String, String) {
    let app = match ts {
        Some(ts) => format!("slack://channel?team={}&id={}&message={}", identity.team_id, conversation_id, ts),
        None => format!("slack://channel?team={}&id={}", identity.team_id, conversation_id),
    };
    let base = identity.url.trim_end_matches('/');
    let web = match ts {
        Some(ts) => format!("{}/archives/{}/p{}", base, conversation_id, ts.replace('.', "")),
        None => format!("{}/archives/{}", base, conversation_id),
    };
    (app, web)
}
```

- [ ] **Step 4: Write the Tauri wrappers + real fetch wiring** — append the commands in `src-tauri/src/commands/slack.rs`:

```rust
/// users.conversations (member channels + DMs + group DMs), paged to completion.
async fn list_member_conversations(
    client: &crate::slack::SlackClient,
    auth: String,
) -> Result<Vec<catchup::ParsedConversation>, SlackError> {
    let mut out = Vec::new();
    let mut cursor: Option<String> = None;
    loop {
        let mut params: Vec<(&str, &str)> = vec![
            ("types", "public_channel,private_channel,im,mpim"),
            ("exclude_archived", "true"),
            ("limit", "200"),
        ];
        if let Some(c) = &cursor { params.push(("cursor", c)); }
        let body = client.call(&auth, "users.conversations", &params).await?;
        let (mut rows, next) = catchup::parse_conversations(&body)?;
        out.append(&mut rows);
        match next {
            Some(c) if Some(&c) != cursor.as_ref() => cursor = Some(c),
            _ => break,
        }
    }
    Ok(out.into_iter().filter(|c| c.is_member).collect())
}

/// conversations.info + history (+ thread replies) for one conversation.
async fn fetch_conversation_data(
    client: &crate::slack::SlackClient,
    auth: String,
    conversation_id: String,
) -> Result<ConversationData, SlackError> {
    let info_body = client
        .call(&auth, "conversations.info", &[("channel", &conversation_id)])
        .await?;
    let info = catchup::parse_conversation_info(&info_body);

    let mut hist_params: Vec<(&str, &str)> = vec![("channel", &conversation_id), ("limit", "100"), ("inclusive", "false")];
    if let Some(lr) = &info.last_read { hist_params.push(("oldest", lr)); }
    let hist_body = client.call(&auth, "conversations.history", &hist_params).await?;
    let messages = catchup::parse_messages(&hist_body);

    let mut replies = Vec::new();
    for parent in catchup::thread_parents(&messages, info.last_read.as_deref()) {
        let mut rparams: Vec<(&str, &str)> = vec![("channel", &conversation_id), ("ts", &parent.ts), ("limit", "100")];
        if let Some(lr) = &info.last_read { rparams.push(("oldest", lr)); }
        let rbody = client.call(&auth, "conversations.replies", &rparams).await?;
        replies.push((parent.ts.clone(), catchup::parse_messages(&rbody)));
    }
    Ok(ConversationData { info, messages, replies })
}

#[tauri::command]
pub async fn sync_slack_catchup(state: State<'_, AppState>) -> Result<SlackSyncSummary, CmdError> {
    let _g = state.slack_lock.lock().await;
    let identity = sdb::load_slack_identity(&state.pool).await.map_err(|_| CmdError::Internal)?;
    let viewer_id = identity.map(|i| i.user_id).ok_or(CmdError::SlackNotConfigured)?;
    let client_l = state.slack.clone();
    let client_c = state.slack.clone();
    sync_slack_catchup_logic(
        state.slack_credentials.clone(),
        &state.pool,
        &state.slack_generation,
        viewer_id,
        now_iso_slack(),
        move |auth| { let c = client_l.clone(); async move { list_member_conversations(&c, auth).await } },
        move |auth, conv_id, _last_read| { let c = client_c.clone(); async move { fetch_conversation_data(&c, auth, conv_id).await } },
    )
    .await
}

#[tauri::command]
pub async fn get_slack_catchup(state: State<'_, AppState>) -> Result<SlackCatchup, CmdError> {
    get_slack_catchup_logic(&state.pool).await
}

// Tauri maps the JS camelCase arg `conversationId` to the Rust snake_case
// parameter `conversation_id` automatically (matches the existing commands).
#[tauri::command]
pub async fn get_slack_conversation_messages(
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<Vec<sdb::MessageRow>, CmdError> {
    get_slack_conversation_messages_logic(&state.pool, &conversation_id).await
}

#[tauri::command]
pub async fn slack_deep_link(
    state: State<'_, AppState>,
    conversation_id: String,
    ts: Option<String>,
) -> Result<SlackDeepLink, CmdError> {
    let identity = sdb::load_slack_identity(&state.pool)
        .await
        .map_err(|_| CmdError::Internal)?
        .ok_or(CmdError::SlackNotConfigured)?;
    let (app, web) = slack_deep_link_logic(&identity, &conversation_id, ts.as_deref());
    Ok(SlackDeepLink { app, web })
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SlackDeepLink {
    pub app: String,
    pub web: String,
}

fn now_iso_slack() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default()
}
```

> **Note on user identity resolution:** to keep the injected-closure orchestrator simple, `sync_slack_catchup_logic` stores `user_name`/`user_avatar` as `NULL`. The Tauri `sync_slack_catchup` wrapper should, after `list_member_conversations`, resolve each distinct author via `users.info` and pre-populate a `HashMap<String, ParsedUser>`, then pass enriched data. **For this task, ship NULL names** (the frontend falls back to the user id) and add user resolution in a follow-up step within this task only if `cargo build` time allows; it is not required for tests to pass. Keep the deliverable: messages render with a stable author label.

- [ ] **Step 5: Register the commands** — in `src-tauri/src/lib.rs` `generate_handler!`, after the four Slack token commands:

```rust
            commands::slack::sync_slack_catchup,
            commands::slack::get_slack_catchup,
            commands::slack::get_slack_conversation_messages,
            commands::slack::slack_deep_link,
```

- [ ] **Step 6: Run tests + build**

Run: `cargo test --manifest-path src-tauri/Cargo.toml commands::slack`
Then: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: PASS (9 tests total in the module) and clean build.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/commands/slack.rs src-tauri/src/lib.rs
git commit -m "feat(slack): sync/list/messages/deep-link commands"
```

---

## Task 8: Frontend bindings + query hooks

**Files:**
- Modify: `src/lib/commands.ts` (append a Slack section)
- Modify: `src/lib/queries.ts` (append hooks + `clearSlackQueries`)
- Test: `src/lib/slackQueries.test.tsx`

**Interfaces:**
- Produces (TS): `SlackStatus`, `SlackConversation`, `SlackMessage`, `SlackThread`, `SlackCatchup`, `SlackSyncSummary`, `SlackDeepLink`, binding fns; hooks `useSlackStatus`, `useSlackCatchup`, `useSlackSync(enabled)`, `clearSlackQueries(qc)`.

- [ ] **Step 1: Add bindings** — append to `src/lib/commands.ts`:

```ts
// ── Slack catch-up board (Phase 2, iter 1) ───────────────────────────────────

export type SlackStatus =
  | { state: "not_configured" }
  | { state: "unverified" }
  | { state: "connected"; workspaceName: string | null; userName: string };

export type SlackConversation = {
  id: string;
  kind: "channel" | "dm" | "group_dm";
  name: string | null;
  partnerUserId: string | null;
  unreadCount: number;
  hasMention: boolean;
  unreadThreads: number;
  latestTs: string | null;
  latestSnippet: string | null;
};

export type SlackMessage = {
  conversationId: string;
  ts: string;
  threadTs: string | null;
  userId: string | null;
  userName: string | null;
  userAvatar: string | null;
  text: string | null;
  isMention: boolean;
  linearIdentifier: string | null;
  linearIssueId: string | null;
  createdAt: string;
};

export type SlackThread = {
  conversationId: string;
  conversationName: string | null;
  threadTs: string;
  unreadReplies: number;
  hasMention: boolean;
  latestTs: string;
};

export type SlackCatchup = {
  conversations: SlackConversation[];
  mentions: SlackMessage[];
  threads: SlackThread[];
  lastSyncedAt: string | null;
};

export type SlackSyncSummary = { synced: boolean; conversationCount: number; unreadTotal: number };
export type SlackDeepLink = { app: string; web: string };

export const setSlackToken = (token: string): Promise<void> => invoke("set_slack_token", { token });
export const clearSlackToken = (): Promise<void> => invoke("clear_slack_token");
export const getSlackStatus = (): Promise<SlackStatus> => invoke("get_slack_status");
export const testSlackConnection = (): Promise<SlackStatus> => invoke("test_slack_connection");
export const syncSlackCatchup = (): Promise<SlackSyncSummary> => invoke("sync_slack_catchup");
export const getSlackCatchup = (): Promise<SlackCatchup> => invoke("get_slack_catchup");
export const getSlackConversationMessages = (conversationId: string): Promise<SlackMessage[]> =>
  invoke("get_slack_conversation_messages", { conversationId });
export const slackDeepLink = (conversationId: string, ts?: string | null): Promise<SlackDeepLink> =>
  invoke("slack_deep_link", { conversationId, ts: ts ?? null });
```

- [ ] **Step 2: Write the failing hook test** — `src/lib/slackQueries.test.tsx` (mirror `githubQueries.test.tsx`):

```tsx
// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("goey-toast", () => ({ gooeyToast: { error: vi.fn(), success: vi.fn() } }));

import { useSlackCatchup, useSlackSync } from "./queries";

afterEach(() => { cleanup(); invoke.mockReset(); });

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("slack queries", () => {
  it("useSlackCatchup reads the cache via get_slack_catchup", async () => {
    invoke.mockResolvedValueOnce({ conversations: [], mentions: [], threads: [], lastSyncedAt: null });
    const { result } = renderHook(() => useSlackCatchup(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invoke).toHaveBeenCalledWith("get_slack_catchup");
  });

  it("useSlackSync stays idle when disabled", async () => {
    const { result } = renderHook(() => useSlackSync(false), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(invoke).not.toHaveBeenCalledWith("sync_slack_catchup");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- src/lib/slackQueries.test.tsx`
Expected: FAIL — `useSlackCatchup` not exported.

- [ ] **Step 4: Add the hooks** — append to `src/lib/queries.ts` (next to the github hooks). First extend the imports from `@/lib/commands` to include `getSlackStatus, getSlackCatchup, syncSlackCatchup`, then:

```ts
export function useSlackStatus() {
  return useQuery({ queryKey: ["slack-status"], queryFn: getSlackStatus });
}

export function useSlackCatchup() {
  return useQuery({ queryKey: ["slack-catchup"], queryFn: getSlackCatchup });
}

/**
 * Background Slack sync: on mount + every 5 min while a token is present, then
 * invalidate the cached catch-up so fresh rows render. Disabled when not
 * configured (no token -> no network).
 */
export function useSlackSync(enabled: boolean) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ["slack-sync"],
    enabled,
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      try {
        const summary = await syncSlackCatchup();
        await qc.invalidateQueries({ queryKey: ["slack-catchup"] });
        return summary;
      } catch (err) {
        gooeyToast.error("Couldn't refresh Slack", { description: errorText(err) });
        throw err;
      }
    },
  });
}

export function clearSlackQueries(qc: QueryClient) {
  for (const key of [["slack-status"], ["slack-catchup"], ["slack-sync"]]) {
    qc.cancelQueries({ queryKey: key });
    qc.removeQueries({ queryKey: key });
  }
}
```

> Confirm `errorText` and `gooeyToast` are already imported at the top of `queries.ts` (they are used by the github hooks); if not, add them.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- src/lib/slackQueries.test.tsx`
Expected: PASS (2 tests). Then `npx tsc --noEmit` clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/commands.ts src/lib/queries.ts src/lib/slackQueries.test.tsx
git commit -m "feat(slack): TS bindings + query hooks"
```

---

## Task 9: View wiring (paneModel, Dock, SplitLayout)

**Files:**
- Modify: `src/lib/paneModel.ts:1` and `:11`
- Modify: `src/components/Dock.tsx:1-2,38-48`
- Modify: `src/components/SplitLayout.tsx:29,47-49`
- Test: `src/lib/paneModel.test.ts` (extend an existing VIEWS assertion if present, else add one)

**Interfaces:**
- Consumes: `SlackPage` (Task 10 — create a temporary stub now, replace in Task 10).
- Produces: `"slack"` as a selectable `ViewKind`.

- [ ] **Step 1: Add a failing test** — append to `src/lib/paneModel.test.ts`:

```ts
import { VIEWS } from "./paneModel";
// (add inside an existing describe, or a new one)
it("includes the slack view", () => {
  expect(VIEWS).toContain("slack");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- src/lib/paneModel.test.ts`
Expected: FAIL — `VIEWS` lacks `"slack"`.

- [ ] **Step 3: Add the view to the model** — in `src/lib/paneModel.ts`:

Line 1:
```ts
export type ViewKind = "calendar" | "list" | "this-week" | "graph" | "inbox" | "prs" | "slack" | "settings" | "issue";
```
Line 11:
```ts
export const VIEWS: ViewKind[] = ["calendar", "list", "this-week", "graph", "inbox", "prs", "slack", "settings", "issue"];
```

- [ ] **Step 4: Add the Dock entry** — in `src/components/Dock.tsx`:

Import `MessageSquare` (line 2, add to the lucide import list). Add to `NAV` (after the `prs` entry, line ~44):
```tsx
  { view: "slack", label: "Slack", icon: <MessageSquare className="size-5" /> },
```
Add to `META` (line 48):
```tsx
const META: Record<Exclude<ViewKind, "issue">, string> = { calendar: "Calendar", list: "Issues", "this-week": "Overview", graph: "Dependencies", inbox: "Inbox", prs: "Pull Requests", slack: "Slack", settings: "Settings" };
```

- [ ] **Step 5: Wire SplitLayout** — in `src/components/SplitLayout.tsx`, add the import (line ~29):
```tsx
import { SlackPage } from "@/features/slack/SlackPage";
```
and the case (after `case "prs":`, line ~48):
```tsx
    case "slack":
      return <SlackPage />;
```

- [ ] **Step 6: Create a temporary stub** so the app compiles before Task 10 — `src/features/slack/SlackPage.tsx`:

```tsx
export function SlackPage() {
  return <main className="p-10 text-sm text-muted-foreground">Slack</main>;
}
```

- [ ] **Step 7: Run tests + typecheck**

Run: `npm test -- src/lib/paneModel.test.ts` (PASS) then `npx tsc --noEmit` (clean).

- [ ] **Step 8: Commit**

```bash
git add src/lib/paneModel.ts src/lib/paneModel.test.ts src/components/Dock.tsx src/components/SplitLayout.tsx src/features/slack/SlackPage.tsx
git commit -m "feat(slack): wire the Slack view into nav + layout"
```

---

## Task 10: `SlackPage.tsx` — the board

**Files:**
- Modify: `src/features/slack/SlackPage.tsx` (replace the stub)
- Test: `src/features/slack/SlackPage.test.tsx`

**Interfaces:**
- Consumes: `useSlackStatus`, `useSlackCatchup`, `useSlackSync` (Task 8), `SlackRow` (Task 11 — import a stub-safe component; Task 11 fills it). Until Task 11, render rows inline; Task 11 extracts `SlackRow`/`SlackReader`.
- Produces: `SlackPage` with Mentions → DMs → Threads → Channels sections + a connect prompt.

- [ ] **Step 1: Write the failing test** — `src/features/slack/SlackPage.test.tsx` (mirror `PrsPage.test.tsx`):

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { SlackCatchup, SlackStatus } from "@/lib/commands";

const hooks = vi.hoisted(() => ({
  useSlackStatus: vi.fn(),
  useSlackCatchup: vi.fn(),
  useSlackSync: vi.fn(),
}));
const setActiveView = vi.hoisted(() => vi.fn());
vi.mock("@/lib/queries", () => hooks);
vi.mock("@/lib/tabs", () => ({ useWorkspace: () => ({ setActiveView, openIssueTab: vi.fn() }) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@/lib/commands", async (orig) => ({ ...(await orig<typeof import("@/lib/commands")>()) }));

import { SlackPage } from "./SlackPage";

afterEach(cleanup);

const empty: SlackCatchup = { conversations: [], mentions: [], threads: [], lastSyncedAt: null };

function setup(status: SlackStatus, catchup: SlackCatchup = empty) {
  hooks.useSlackStatus.mockReturnValue({ data: status });
  hooks.useSlackCatchup.mockReturnValue({ data: catchup });
  hooks.useSlackSync.mockReturnValue({ isFetching: false, isError: false, data: undefined, refetch: vi.fn() });
}

describe("SlackPage", () => {
  it("shows a connect prompt when not configured", () => {
    setup({ state: "not_configured" });
    render(<SlackPage />);
    expect(screen.getByText("Connect Slack")).toBeTruthy();
  });

  it("renders the four sections when connected", () => {
    setup({ state: "connected", workspaceName: "acme", userName: "U1" }, {
      ...empty,
      conversations: [
        { id: "D1", kind: "dm", name: "Bob", partnerUserId: "U2", unreadCount: 2, hasMention: false, unreadThreads: 0, latestTs: "2.0", latestSnippet: "hey" },
        { id: "C1", kind: "channel", name: "eng", partnerUserId: null, unreadCount: 1, hasMention: true, unreadThreads: 1, latestTs: "3.0", latestSnippet: "ping" },
      ],
      mentions: [
        { conversationId: "C1", ts: "3.0", threadTs: null, userId: "U2", userName: "Bob", userAvatar: null, text: "ping <@U1>", isMention: true, linearIdentifier: null, linearIssueId: null, createdAt: "2026-06-23T00:00:00Z" },
      ],
    });
    render(<SlackPage />);
    expect(screen.getByText("Mentions")).toBeTruthy();
    expect(screen.getByText("Direct messages")).toBeTruthy();
    expect(screen.getByText("Threads")).toBeTruthy();
    expect(screen.getByText("Channels")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- src/features/slack/SlackPage.test.tsx`
Expected: FAIL — sections/connect prompt not rendered (stub).

- [ ] **Step 3: Implement the board** — replace `src/features/slack/SlackPage.tsx`:

```tsx
import { AtSign, MessageCircle, MessagesSquare, Hash, RefreshCw, Slack } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/lib/tabs";
import { useSlackCatchup, useSlackStatus, useSlackSync } from "@/lib/queries";
import type { SlackConversation, SlackMessage, SlackThread } from "@/lib/commands";
import { SlackRow, SlackMentionRow, SlackThreadRow } from "./SlackRow";

export function SlackPage() {
  const { setActiveView } = useWorkspace();
  const { data: status } = useSlackStatus();
  const connected = status?.state === "connected" || status?.state === "unverified";
  const { data: catchup } = useSlackCatchup();
  const sync = useSlackSync(connected);

  if (status?.state === "not_configured") {
    return (
      <main className="flex h-full flex-col items-center justify-center gap-4 p-10 text-center">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-muted/50">
          <Slack className="size-7 text-muted-foreground" />
        </span>
        <div className="flex flex-col gap-1">
          <h1 className="text-base font-semibold text-foreground">Slack</h1>
          <p className="max-w-xs text-sm text-muted-foreground">
            Link your Slack workspace to catch up on what you missed.
          </p>
        </div>
        <Button onClick={() => setActiveView("settings")}>Connect Slack</Button>
      </main>
    );
  }

  const conversations = catchup?.conversations ?? [];
  const mentions = catchup?.mentions ?? [];
  const threads = catchup?.threads ?? [];
  const dms = conversations.filter((c) => c.kind === "dm" || c.kind === "group_dm");
  const channels = conversations.filter((c) => c.kind === "channel");
  const workspaceName = status?.state === "connected" ? status.workspaceName : null;

  return (
    <main className="flex h-full flex-col overflow-y-auto">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border/60 bg-background/80 px-6 py-3 backdrop-blur">
        <div className="flex items-baseline gap-2">
          <h1 className="text-base font-semibold text-foreground">Slack</h1>
          {workspaceName && <span className="text-xs text-muted-foreground">{workspaceName}</span>}
          {sync.isError && <span className="text-xs text-amber-400">Sync failed — showing cached data.</span>}
        </div>
        <Button variant="ghost" size="sm" aria-label="Refresh" disabled={sync.isFetching} onClick={() => sync.refetch()}>
          <RefreshCw className={`size-4 ${sync.isFetching ? "animate-spin" : ""}`} />
        </Button>
      </header>

      <div className="mx-auto flex w-full max-w-4xl flex-col gap-7 px-8 pt-7 pb-28">
        <Section title="Mentions" count={mentions.length} icon={AtSign} tint="text-amber-400" empty="No unread mentions.">
          {mentions.map((m) => <SlackMentionRow key={`${m.conversationId}:${m.ts}`} msg={m} convName={convName(conversations, m.conversationId)} />)}
        </Section>
        <Section title="Direct messages" count={dms.length} icon={MessageCircle} tint="text-emerald-400" empty="No unread DMs.">
          {dms.map((c) => <SlackRow key={c.id} conv={c} />)}
        </Section>
        <Section title="Threads" count={threads.length} icon={MessagesSquare} tint="text-sky-400" empty="No unread threads.">
          {threads.map((t) => <SlackThreadRow key={`${t.conversationId}:${t.threadTs}`} thread={t} />)}
        </Section>
        <Section title="Channels" count={channels.length} icon={Hash} tint="text-indigo-400" empty="No unread channels.">
          {channels.map((c) => <SlackRow key={c.id} conv={c} />)}
        </Section>
      </div>
    </main>
  );
}

function convName(conversations: SlackConversation[], id: string): string {
  const c = conversations.find((x) => x.id === id);
  return c?.name ?? id;
}

function Section({
  title, count, icon: Icon, tint, empty, children,
}: {
  title: string;
  count: number;
  icon: typeof AtSign;
  tint: string;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <header className="flex items-center gap-2.5 px-0.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/50">
          <Icon className={`size-4 ${tint}`} />
        </span>
        <h2 className="text-sm font-semibold tracking-tight text-foreground">{title}</h2>
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-xs font-medium tabular-nums text-muted-foreground">
          {count}
        </span>
      </header>
      {count === 0 ? (
        <div className="flex items-center gap-2.5 rounded-xl border border-border/50 bg-card/40 px-5 py-4 text-sm text-muted-foreground">
          <Icon className="size-4 shrink-0 opacity-50" />
          <span>{empty}</span>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">{children}</div>
      )}
    </section>
  );
}

// Avoid an unused-import error before Task 11 fleshes out the row file.
export type { SlackMessage, SlackThread };
```

> The trailing `export type` re-export is only to keep types referenced; remove it once Task 11's `SlackRow.tsx` imports them. If `tsc` flags it as unused, delete that line.

- [ ] **Step 4: Create minimal `SlackRow.tsx`** so the page compiles (Task 11 expands it + adds tests):

```tsx
import type { SlackConversation, SlackMessage, SlackThread } from "@/lib/commands";

export function SlackRow({ conv }: { conv: SlackConversation }) {
  return (
    <div className="border-b border-border/50 px-5 py-3 text-sm last:border-b-0">
      {conv.name ?? conv.id} · {conv.unreadCount} unread
    </div>
  );
}

export function SlackMentionRow({ msg, convName }: { msg: SlackMessage; convName: string }) {
  return (
    <div className="border-b border-border/50 px-5 py-3 text-sm last:border-b-0">
      {convName}: {msg.text}
    </div>
  );
}

export function SlackThreadRow({ thread }: { thread: SlackThread }) {
  return (
    <div className="border-b border-border/50 px-5 py-3 text-sm last:border-b-0">
      {thread.conversationName ?? thread.conversationId} · {thread.unreadReplies} new replies
    </div>
  );
}
```

- [ ] **Step 5: Run the test + typecheck**

Run: `npm test -- src/features/slack/SlackPage.test.tsx` (PASS) then `npx tsc --noEmit` (clean).

- [ ] **Step 6: Commit**

```bash
git add src/features/slack/SlackPage.tsx src/features/slack/SlackRow.tsx src/features/slack/SlackPage.test.tsx
git commit -m "feat(slack): catch-up board page with four sections"
```

---

## Task 11: `SlackRow.tsx` + `SlackReader.tsx` — rows + expand-to-read

**Files:**
- Modify: `src/features/slack/SlackRow.tsx`
- Create: `src/features/slack/SlackReader.tsx`
- Test: `src/features/slack/SlackRow.test.tsx`

**Interfaces:**
- Consumes: `getSlackConversationMessages`, `slackDeepLink` (Task 8), `openUrl`, `useWorkspace().openIssueTab`.
- Produces: an expandable `SlackRow` (click → `SlackReader`), `SlackMentionRow`/`SlackThreadRow` with a Linear chip + "Open in Slack".

- [ ] **Step 1: Write the failing tests** — `src/features/slack/SlackRow.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { SlackConversation, SlackMessage } from "@/lib/commands";

const openUrl = vi.hoisted(() => vi.fn());
const openIssueTab = vi.hoisted(() => vi.fn());
const slackDeepLink = vi.hoisted(() => vi.fn());
const getSlackConversationMessages = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));
vi.mock("@/lib/tabs", () => ({ useWorkspace: () => ({ openIssueTab }) }));
vi.mock("@/lib/commands", () => ({ slackDeepLink, getSlackConversationMessages }));

import { SlackMentionRow } from "./SlackRow";

afterEach(() => { cleanup(); openUrl.mockReset(); openIssueTab.mockReset(); slackDeepLink.mockReset(); });

const mention: SlackMessage = {
  conversationId: "C1", ts: "3.0", threadTs: null, userId: "U2", userName: "Bob", userAvatar: null,
  text: "ping <@U1> re ENG-7", isMention: true, linearIdentifier: "ENG-7", linearIssueId: "iss-7", createdAt: "2026-06-23T00:00:00Z",
};

describe("SlackMentionRow", () => {
  it("opens the Linear issue tab from the chip", () => {
    render(<SlackMentionRow msg={mention} convName="eng" />);
    fireEvent.click(screen.getByRole("button", { name: "Open ENG-7" }));
    expect(openIssueTab).toHaveBeenCalledWith("iss-7");
  });

  it("opens Slack via the deep link", async () => {
    slackDeepLink.mockResolvedValueOnce({ app: "slack://channel?team=T1&id=C1&message=3.0", web: "https://acme.slack.com/archives/C1/p30" });
    render(<SlackMentionRow msg={mention} convName="eng" />);
    fireEvent.click(screen.getByRole("button", { name: "Open in Slack" }));
    expect(slackDeepLink).toHaveBeenCalledWith("C1", "3.0");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/features/slack/SlackRow.test.tsx`
Expected: FAIL — chip/button absent.

- [ ] **Step 3: Implement the reader** — `src/features/slack/SlackReader.tsx`:

```tsx
import { useEffect, useState } from "react";
import { getSlackConversationMessages, type SlackMessage } from "@/lib/commands";

/** Read-only list of a conversation's cached unread messages. */
export function SlackReader({ conversationId }: { conversationId: string }) {
  const [messages, setMessages] = useState<SlackMessage[] | null>(null);
  useEffect(() => {
    let live = true;
    getSlackConversationMessages(conversationId)
      .then((m) => { if (live) setMessages(m); })
      .catch(() => { if (live) setMessages([]); });
    return () => { live = false; };
  }, [conversationId]);

  if (messages === null) return <div className="px-5 py-3 text-xs text-muted-foreground">Loading…</div>;
  if (messages.length === 0) return <div className="px-5 py-3 text-xs text-muted-foreground">No cached messages.</div>;

  return (
    <div className="flex flex-col gap-2 border-t border-border/50 bg-background/40 px-5 py-3">
      {messages.map((m) => (
        <div key={m.ts} className="flex flex-col gap-0.5">
          <span className="text-xs font-medium text-foreground">{m.userName ?? m.userId ?? "unknown"}</span>
          <span className="whitespace-pre-wrap text-sm text-muted-foreground">{m.text}</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Implement the rows** — replace `src/features/slack/SlackRow.tsx`:

```tsx
import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ChevronRight, Hash, MessageCircle, MessagesSquare } from "lucide-react";
import { useWorkspace } from "@/lib/tabs";
import { slackDeepLink, type SlackConversation, type SlackMessage, type SlackThread } from "@/lib/commands";
import { SlackReader } from "./SlackReader";

async function openInSlack(conversationId: string, ts?: string | null) {
  try {
    const link = await slackDeepLink(conversationId, ts ?? null);
    await openUrl(link.app);
  } catch {
    /* sanitized: a missing identity just no-ops the open */
  }
}

function LinearChip({ msg }: { msg: SlackMessage }) {
  const { openIssueTab } = useWorkspace();
  if (!msg.linearIssueId || !msg.linearIdentifier) return null;
  return (
    <button
      type="button"
      aria-label={`Open ${msg.linearIdentifier}`}
      onClick={() => openIssueTab(msg.linearIssueId!)}
      className="rounded-md border border-primary/40 px-2 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10"
    >
      {msg.linearIdentifier}
    </button>
  );
}

function OpenInSlack({ conversationId, ts }: { conversationId: string; ts?: string | null }) {
  return (
    <button
      type="button"
      aria-label="Open in Slack"
      onClick={() => openInSlack(conversationId, ts)}
      className="shrink-0 rounded-md border border-border/70 px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-white/[0.06]"
    >
      Open in Slack
    </button>
  );
}

export function SlackRow({ conv }: { conv: SlackConversation }) {
  const [open, setOpen] = useState(false);
  const Icon = conv.kind === "channel" ? Hash : MessageCircle;
  return (
    <div className="border-b border-border/50 last:border-b-0">
      <div className="group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-white/[0.03]">
        <button type="button" onClick={() => setOpen((v) => !v)} aria-label={open ? "Collapse" : "Expand"} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <ChevronRight className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          <span className="shrink-0 text-sm font-medium text-foreground">{conv.name ?? conv.id}</span>
          {conv.latestSnippet && <span className="min-w-0 truncate text-xs text-muted-foreground">{conv.latestSnippet}</span>}
          <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-xs font-medium tabular-nums text-muted-foreground">
            {conv.unreadCount}
          </span>
          {conv.hasMention && <span className="shrink-0 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-300">@</span>}
        </button>
        <OpenInSlack conversationId={conv.id} ts={conv.latestTs} />
      </div>
      {open && <SlackReader conversationId={conv.id} />}
    </div>
  );
}

export function SlackMentionRow({ msg, convName }: { msg: SlackMessage; convName: string }) {
  return (
    <div className="group flex items-start gap-3 border-b border-border/50 px-5 py-3 transition-colors last:border-b-0 hover:bg-white/[0.03]">
      <span className="mt-0.5 shrink-0 text-xs font-medium text-muted-foreground">{convName}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-sm text-foreground">
          <span className="font-medium">{msg.userName ?? msg.userId ?? "unknown"}</span>{" "}
          <span className="text-muted-foreground">{msg.text}</span>
        </span>
      </div>
      <span className="flex shrink-0 items-center gap-2">
        <LinearChip msg={msg} />
        <OpenInSlack conversationId={msg.conversationId} ts={msg.ts} />
      </span>
    </div>
  );
}

export function SlackThreadRow({ thread }: { thread: SlackThread }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-border/50 last:border-b-0">
      <div className="group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-white/[0.03]">
        <button type="button" onClick={() => setOpen((v) => !v)} aria-label={open ? "Collapse" : "Expand"} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <ChevronRight className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />
          <MessagesSquare className="size-4 shrink-0 text-sky-400" />
          <span className="shrink-0 text-sm font-medium text-foreground">{thread.conversationName ?? thread.conversationId}</span>
          <span className="min-w-0 truncate text-xs text-muted-foreground">{thread.unreadReplies} new repl{thread.unreadReplies === 1 ? "y" : "ies"}</span>
          {thread.hasMention && <span className="ml-auto shrink-0 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-300">@</span>}
        </button>
        <OpenInSlack conversationId={thread.conversationId} ts={thread.threadTs} />
      </div>
      {open && <SlackReader conversationId={thread.conversationId} />}
    </div>
  );
}
```

> Remove the temporary `export type { SlackMessage, SlackThread };` line from `SlackPage.tsx` now that `SlackRow.tsx` consumes those types.

- [ ] **Step 5: Run tests + typecheck**

Run: `npm test -- src/features/slack/SlackRow.test.tsx` (PASS) then `npm test -- src/features/slack/SlackPage.test.tsx` (still PASS) then `npx tsc --noEmit` (clean).

- [ ] **Step 6: Commit**

```bash
git add src/features/slack/SlackRow.tsx src/features/slack/SlackReader.tsx src/features/slack/SlackRow.test.tsx src/features/slack/SlackPage.tsx
git commit -m "feat(slack): expandable rows, reader, Linear chip, Open-in-Slack"
```

---

## Task 12: Settings — Slack token card

**Files:**
- Modify: `src/features/settings/Settings.tsx`

**Interfaces:**
- Consumes: `setSlackToken`, `clearSlackToken`, `getSlackStatus`, `testSlackConnection`, `clearSlackQueries`.

- [ ] **Step 1: Add the Slack card** — in `src/features/settings/Settings.tsx`:

Extend the `@/lib/commands` import with `clearSlackToken, getSlackStatus, setSlackToken, testSlackConnection`, and the `@/lib/queries` import with `clearSlackQueries`.

Add state + mutations inside the component (mirror the GitHub block, after `handleGhSave`):

```tsx
  const [slackInput, setSlackInput] = useState("");
  const [slackSaving, setSlackSaving] = useState(false);
  const invalidateSlackStatus = () => qc.invalidateQueries({ queryKey: ["slack-status"] });
  const { data: slackStatus } = useQuery({ queryKey: ["slack-status"], queryFn: getSlackStatus });

  const slackTestMut = useMutation({
    mutationFn: () => testSlackConnection(),
    onSuccess: (s) => {
      if (s.state === "connected") gooeyToast.success(`Connected as ${s.userName}`);
      invalidateSlackStatus();
    },
    onError: (err) => gooeyToast.error("Slack connection failed", { description: errorText(err) }),
  });

  const slackClearMut = useMutation({
    mutationFn: () => clearSlackToken(),
    onSuccess: () => { clearSlackQueries(qc); gooeyToast.success("Slack token cleared"); invalidateSlackStatus(); },
    onError: (err) => { clearSlackQueries(qc); gooeyToast.error("Could not clear the token", { description: errorText(err) }); },
  });

  const slackBusy = slackSaving || slackTestMut.isPending || slackClearMut.isPending;

  const handleSlackSave = async (e: FormEvent) => {
    e.preventDefault();
    if (slackBusy) return;
    const token = slackInput.trim();
    if (!token) return;
    setSlackInput(""); // clear the secret from component state immediately
    setSlackSaving(true);
    try {
      await setSlackToken(token);
      clearSlackQueries(qc);
      gooeyToast.success("Slack token saved");
      invalidateSlackStatus();
    } catch (err) {
      clearSlackQueries(qc);
      gooeyToast.error("Could not save the token", { description: errorText(err) });
    } finally {
      setSlackSaving(false);
    }
  };
```

Add the card JSX after the GitHub `</Card>` (before the closing `</main>`):

```tsx
      <Card className="flex flex-col gap-4 p-6">
        <p className="text-sm text-muted-foreground">
          {slackStatus === undefined
            ? "Checking…"
            : slackStatus.state === "connected"
              ? `Connected as ${slackStatus.userName}${slackStatus.workspaceName ? ` · ${slackStatus.workspaceName}` : ""}`
              : slackStatus.state === "unverified"
                ? "Token saved — not verified"
                : "Not connected"}
        </p>
        <form className="flex flex-col gap-3" onSubmit={handleSlackSave}>
          <Label htmlFor="slack-token">Slack user token</Label>
          <Input id="slack-token" type="password" autoComplete="off" placeholder="xoxp-…" value={slackInput} onChange={(e) => setSlackInput(e.currentTarget.value)} disabled={slackBusy} />
          <p className="text-xs text-muted-foreground">
            Create a Slack app, add the read scopes (<code>channels:read</code>, <code>groups:read</code>, <code>im:read</code>, <code>mpim:read</code>, the matching <code>*:history</code> scopes, <code>users:read</code>, <code>team:read</code>), install it, and paste the user token. Read-only — Astryn never posts or marks anything read.
          </p>
          <div className="flex gap-2">
            <Button type="submit" disabled={slackBusy}>Save Slack token</Button>
            <Button type="button" variant="secondary" disabled={slackBusy} onClick={() => slackTestMut.mutate()}>Test connection</Button>
            <Button type="button" variant="ghost" disabled={slackBusy} onClick={() => slackClearMut.mutate()}>Clear token</Button>
          </div>
        </form>
      </Card>
```

- [ ] **Step 2: Typecheck + existing Settings test**

Run: `npx tsc --noEmit` (clean) then `npm test -- src/features/settings/Settings.test.tsx` (still PASS).

- [ ] **Step 3: Commit**

```bash
git add src/features/settings/Settings.tsx
git commit -m "feat(slack): Settings token card (read-only, direct async save)"
```

---

## Task 13: `requirements.md` updates + full verification

**Files:**
- Modify: `requirements.md`

- [ ] **Step 1: Update `requirements.md`** — make these edits:
  - **§2 In scope:** add item *"Slack catch-up board — read-only unread mentions/DMs/threads/channels for one workspace (Phase 2, iteration 1)."*
  - **§2 Out of scope / §14:** narrow the Slack non-goal to *"huddles (live socket), reply/compose, mark-as-read, multi-workspace, and OAuth."*
  - **§4:** add a *Slack* auth subsection (user token, keychain account `slack_user_token`, read scopes, `SlackCredentialProvider` seam).
  - **§5:** add the `slack_conversations` / `slack_messages` / `slack_users` / `slack_sync_meta` tables.
  - **§6:** add *Slack sync: on-open + 5-min poll; all-or-nothing transactional `replace_catchup`.*
  - **§10:** add the `slack/` Rust module to the module layout.
  - **§11:** add a milestone line *"Slack catch-up board (Phase 2 iter 1). Done."*

- [ ] **Step 2: Full verification**

Run each and confirm the stated outcome:
```bash
cargo test --manifest-path src-tauri/Cargo.toml          # all Rust tests pass (incl. slack::*)
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check # formatting clean
cargo clippy --manifest-path src-tauri/Cargo.toml         # no new warnings
npm test                                                  # all Vitest pass (incl. slack*)
npx tsc --noEmit                                          # typecheck clean
```
Expected: every command exits 0. (If `clippy` flags the `#[allow(clippy::too_many_arguments)]` orchestrator, it's already allowed; address any *new* lints.)

- [ ] **Step 3: Manual smoke (optional, requires a real token)** — `npm run tauri dev`, open the **Slack** dock entry, paste a user token in Settings, Test connection, return to the board, confirm sections populate, expand a row to read, click a Linear chip and "Open in Slack".

- [ ] **Step 4: Commit**

```bash
git add requirements.md
git commit -m "docs(slack): record the catch-up board in requirements.md"
```

---

## Self-Review notes (for the implementer)

- **Spec coverage:** auth/scopes → Task 6 + 12; the four surfaces → Tasks 3–5, 7, 10–11 (DMs via `unread_count_display`; channels via history−`last_read`; mentions derived in `sync` + `list_mentions`; threads via `thread_parents` + `list_threads`); read-in-app → Task 11 `SlackReader`; Open-in-Slack/deep link → Task 7 + 11; Linear chip → Tasks 4/5/11; offline-first → cache reads (Task 7/8/10); credential isolation + generation guard → Task 6/7; sanitized errors → Task 2/6; tests → every task; `requirements.md` → Task 13.
- **Known v1 limitations (documented, not bugs):** thread-unread is heuristic (channel `last_read` proxy); `user_name`/`user_avatar` may be NULL until the optional `users.info` enrichment lands (Task 7 note) — the reader falls back to the user id; `subteam` mentions are out.
- **Type consistency:** Rust `SlackStatus` serializes `userName`/`workspaceName` (camelCase via explicit `rename`); TS `SlackStatus` matches. `ConversationRow`/`MessageRow`/`ThreadRow` `#[serde(rename_all = "camelCase")]` ↔ the TS `SlackConversation`/`SlackMessage`/`SlackThread`. Command arg names (`conversationId`, `ts`, `token`) match the `invoke(...)` payloads in `commands.ts`.
