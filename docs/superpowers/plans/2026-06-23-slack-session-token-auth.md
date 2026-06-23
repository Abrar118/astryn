# Slack Session-Token Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the shipped Slack catch-up board authenticate with the Slack desktop app's own session credentials (`xoxc` token + `xoxd` cookie), auto-extracted from the local macOS app, so it works on a workspace where no Slack app can be installed.

**Architecture:** Widen the credential seam from a bare `Bearer` string to `SlackAuth { authorization, cookie }` so `SlackClient::call` can send `Cookie: d=<xoxd>`; the entire unread pipeline is otherwise unchanged. Add a macOS extraction module (`slack/extract.rs`) that scans Slack's Local Storage leveldb for `xoxc` and decrypts the `d` cookie from Slack's Chromium Cookies DB. Store both secrets in the keychain; on an auth failure, re-extract from the still-signed-in app and retry once.

**Tech Stack:** Tauri v2, Rust (`reqwest`, `sqlx` SQLite, `thiserror`, `regex`, RustCrypto `aes`/`cbc`/`pbkdf2`/`hmac`/`sha1`, `std::process::Command`), React 19 + TypeScript, TanStack Query, Vitest, `cargo test`.

**Spec:** `docs/superpowers/specs/2026-06-23-slack-session-token-auth-design.md`. **Branch:** `feat/slack-session-token-auth` (off `feat/slack-catch-up-board`).

## Global Constraints

- **All Slack calls stay in Rust**; neither secret is ever returned to the webview / persisted in SQLite / logs / a TanStack mutation cache. Keychain only.
- **Keychain accounts:** `slack_user_token` (holds `xoxc` in session mode) + new `slack_cookie_d` (holds `xoxd`), service `com.orion.astryn`.
- **Transport:** `Authorization: Bearer <xoxc>` + `Cookie: d=<xoxd>` (cookie only when present). Official `xoxp` mode = no cookie, unchanged. **Verify at impl:** if a method rejects `Bearer <xoxc>`, also send the token as the `token` form param.
- **Self-healing rotation:** on `SlackError::Auth`, re-extract once and retry; if it still fails, surface a sanitized "reconnect" error and keep cached rows.
- **macOS only** for auto-extraction (`#[cfg(target_os = "macos")]`); other OSes use the manual two-field fallback. No new SQLite tables.
- **ToS/employer caveat** (`[REQ]`) shown in Settings and recorded in `requirements.md`.
- **Sanitized errors** — no raw keyring/leveldb/decrypt/sqlite diagnostics cross IPC. TS strict (`noUnusedLocals`/`noUnusedParameters`).
- Rust tests: `cargo test --manifest-path src-tauri/Cargo.toml`; frontend: `npm test`; typecheck `npx tsc --noEmit`.

---

## File Structure

**Rust (new):**
- `src-tauri/src/slack/extract.rs` — `ExtractedCreds`, `ExtractError`, pure `scan_xoxc` + `decrypt_cookie` + `derive_key`, the macOS-gated `read_d_cookie_blob` + `macos_safe_storage_key` + `extract_credentials`.

**Rust (modified):**
- `src-tauri/src/slack/mod.rs` — `SlackAuth`; widen the trait to `auth()`; `PersonalTokenProvider` reads two accounts; `SlackClient::call(&SlackAuth, …)` adds the cookie header; `FakeSlackCreds(Option<SlackAuth>)`; `pub mod extract;`.
- `src-tauri/src/commands/slack.rs` — `authorize()` → `SlackAuth`; fetch helpers + closures thread `SlackAuth`; `set_slack_credentials_logic`; clear deletes both accounts; `detect_slack_credentials` + `store_slack_secrets_logic` + `redetect_secrets`/`run_sync`/`run_test` (one-shot auth retry); tauri wrappers.
- `src-tauri/src/lib.rs` — `SLACK_COOKIE_ACCOUNT`; `PersonalTokenProvider::new(store, token_acct, cookie_acct)`; register `detect_slack_credentials` + rename `set_slack_token`→`set_slack_credentials`.
- `src-tauri/Cargo.toml` — add `aes`, `cbc`, `pbkdf2`, `hmac`, `sha1`.
- `requirements.md` — §4/§5/§10/§11/§14.

**Frontend (modified):**
- `src/lib/commands.ts` — `detectSlackCredentials`, `setSlackCredentials`.
- `src/features/settings/Settings.tsx` — "Detect from Slack app" button + manual two-field fallback.

---

## Task 1: Widen the credential seam to `SlackAuth` (+ cookie header)

**Files:**
- Modify: `src-tauri/src/slack/mod.rs:58-150`
- Modify: `src-tauri/src/commands/slack.rs` (`authorize`, fetch helpers, closures, existing tests)
- Modify: `src-tauri/src/lib.rs:21,89-91`

**Interfaces:**
- Produces: `struct SlackAuth { authorization: String, cookie: Option<String> }` (`Clone`); `trait SlackCredentialProvider { fn auth(&self) -> Result<Option<SlackAuth>, SecretError> }`; `SlackClient::call(&self, auth: &SlackAuth, method: &str, params: &[(&str,&str)])`; `fake::FakeSlackCreds(pub Option<SlackAuth>)`; `const SLACK_COOKIE_ACCOUNT: &str` (lib.rs).
- Consumes: existing `SecretStore`.

- [ ] **Step 1: Write the failing test** — in `src-tauri/src/slack/mod.rs` `tests` module, replace the existing `provider_wraps_token_as_bearer` test and add a cookie-header test:

```rust
    #[test]
    fn provider_supplies_bearer_and_cookie() {
        use crate::secrets::fake::FakeSecretStore;
        let store: std::sync::Arc<dyn SecretStore> = std::sync::Arc::new(FakeSecretStore::default());
        store.set("slack_user_token", "xoxc-1").unwrap();
        store.set("slack_cookie_d", "xoxd-9").unwrap();
        let p = PersonalTokenProvider::new(store.clone(), "slack_user_token", "slack_cookie_d");
        let a = p.auth().unwrap().unwrap();
        assert_eq!(a.authorization, "Bearer xoxc-1");
        assert_eq!(a.cookie.as_deref(), Some("xoxd-9"));
    }

    #[test]
    fn provider_cookie_none_when_absent() {
        use crate::secrets::fake::FakeSecretStore;
        let store: std::sync::Arc<dyn SecretStore> = std::sync::Arc::new(FakeSecretStore::default());
        store.set("slack_user_token", "xoxp-1").unwrap();
        let p = PersonalTokenProvider::new(store, "slack_user_token", "slack_cookie_d");
        let a = p.auth().unwrap().unwrap();
        assert_eq!(a.cookie, None);
    }

    #[tokio::test]
    async fn call_sends_cookie_header_when_present() {
        // A throwaway server that echoes whether a Cookie header arrived.
        let client = SlackClient::with_base("http://127.0.0.1:0/api").unwrap();
        // Pure check instead of a live server: build the auth and assert the helper.
        let auth = SlackAuth { authorization: "Bearer xoxc-1".into(), cookie: Some("xoxd-9".into()) };
        assert_eq!(cookie_header(&auth).as_deref(), Some("d=xoxd-9"));
        let none = SlackAuth { authorization: "Bearer xoxp".into(), cookie: None };
        assert_eq!(cookie_header(&none), None);
        let _ = client; // constructed to prove with_base still compiles
    }
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test --manifest-path src-tauri/Cargo.toml slack::mod`
Expected: FAIL — `SlackAuth`/`cookie_header`/`auth`/3-arg `new` not found.

- [ ] **Step 3: Implement the seam** — in `src-tauri/src/slack/mod.rs`, replace lines 58-150 (trait, provider, `call`, fake) with:

```rust
/// The credentials for a Slack API call: the `Authorization` value plus an
/// optional session cookie (`d`) used in session-token mode.
#[derive(Clone, Debug, PartialEq)]
pub struct SlackAuth {
    pub authorization: String,
    pub cookie: Option<String>,
}

/// `Cookie` header value for an auth, or `None` when there's no cookie.
pub fn cookie_header(auth: &SlackAuth) -> Option<String> {
    auth.cookie.as_ref().map(|c| format!("d={c}"))
}

pub trait SlackCredentialProvider: Send + Sync {
    /// The credentials to authenticate a call, or `None` if nothing is stored.
    fn auth(&self) -> Result<Option<SlackAuth>, SecretError>;
}

pub struct PersonalTokenProvider {
    store: Arc<dyn SecretStore>,
    token_account: String,
    cookie_account: String,
}

impl PersonalTokenProvider {
    pub fn new(
        store: Arc<dyn SecretStore>,
        token_account: impl Into<String>,
        cookie_account: impl Into<String>,
    ) -> Self {
        Self {
            store,
            token_account: token_account.into(),
            cookie_account: cookie_account.into(),
        }
    }
}

impl SlackCredentialProvider for PersonalTokenProvider {
    fn auth(&self) -> Result<Option<SlackAuth>, SecretError> {
        let token = match self.store.get(&self.token_account)? {
            Some(t) => t,
            None => return Ok(None),
        };
        let cookie = self.store.get(&self.cookie_account)?;
        Ok(Some(SlackAuth {
            authorization: format!("Bearer {token}"),
            cookie,
        }))
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

    /// POST a Slack Web API method with form params; returns the parsed `ok:true`
    /// body. In session-token mode the `d` cookie is attached.
    pub async fn call(
        &self,
        auth: &SlackAuth,
        method: &str,
        params: &[(&str, &str)],
    ) -> Result<Value, SlackError> {
        let url = format!("{}/{}", self.base, method);
        let mut req = self
            .http
            .post(&url)
            .header("Authorization", &auth.authorization)
            .form(params);
        if let Some(c) = cookie_header(auth) {
            req = req.header("Cookie", c);
        }
        let resp = req.send().await.map_err(|_| SlackError::Network)?;
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

    pub struct FakeSlackCreds(pub Option<SlackAuth>);

    impl SlackCredentialProvider for FakeSlackCreds {
        fn auth(&self) -> Result<Option<SlackAuth>, SecretError> {
            Ok(self.0.clone())
        }
    }
}
```

Add `pub mod extract;` to the top of `mod.rs` (next to `pub mod catchup;`) and create an empty `src-tauri/src/slack/extract.rs` with `// Filled in Tasks 3-4.` so it compiles.

- [ ] **Step 4: Update the consumers in `commands/slack.rs`** so the crate compiles:
  - `authorize` returns `SlackAuth`:
    ```rust
    async fn authorize(credentials: &Arc<dyn SlackCredentialProvider>) -> Result<crate::slack::SlackAuth, CmdError> {
        let c = credentials.clone();
        tokio::task::spawn_blocking(move || c.auth())
            .await
            .map_err(|_| CmdError::Internal)?
            .map_err(|_| CmdError::SecretStore)?
            .ok_or(CmdError::SlackNotConfigured)
    }
    ```
  - Change the three fetch helpers' `auth: String` parameter to `auth: crate::slack::SlackAuth` (`fetch_auth_test`, `list_member_conversations`, `fetch_conversation_data`) — their bodies pass `&auth` to `client.call(&auth, …)` unchanged.
  - The `*_logic` fns' closure bounds change from `FnOnce(String)`/`Fn(String, …)` to `FnOnce(SlackAuth)`/`Fn(SlackAuth, …)`: in `test_slack_connection_logic` change `F: FnOnce(String)` → `F: FnOnce(crate::slack::SlackAuth)`; in `sync_slack_catchup_logic` change the list/conv closure bounds' first arg `String` → `crate::slack::SlackAuth`. The bodies (`fetch_conv(auth.clone(), …)`) are unchanged because `SlackAuth: Clone`.
  - In the existing tests, replace every `FakeSlackCreds(Some("Bearer x".into()))` with `FakeSlackCreds(Some(crate::slack::SlackAuth { authorization: "Bearer x".into(), cookie: None }))`. (4 sites: lines ~701, 752, 820, 848.)

- [ ] **Step 5: Update `lib.rs`** — add the cookie account const and the 3-arg provider ctor:

```rust
const SLACK_COOKIE_ACCOUNT: &str = "slack_cookie_d";
```
and at line ~89-91:
```rust
            let slack_credentials: Arc<dyn SlackCredentialProvider> = Arc::new(
                PersonalTokenProvider::new(store.clone(), SLACK_TOKEN_ACCOUNT, SLACK_COOKIE_ACCOUNT),
            );
```

- [ ] **Step 6: Run tests + build**

Run: `cargo test --manifest-path src-tauri/Cargo.toml slack` then `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: PASS (incl. the 3 new seam tests) + clean build.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/slack/mod.rs src-tauri/src/slack/extract.rs src-tauri/src/commands/slack.rs src-tauri/src/lib.rs
git commit -m "feat(slack): widen credential seam to SlackAuth + send the d cookie"
```

---

## Task 2: Two-secret storage commands (`set_slack_credentials` + clear both)

**Files:**
- Modify: `src-tauri/src/commands/slack.rs` (`set_slack_token_logic`→`set_slack_credentials_logic`, `clear_slack_token_logic`, tauri wrappers)
- Modify: `src-tauri/src/lib.rs` (register `set_slack_credentials`)
- Modify: `src-tauri/src/commands/slack.rs:13` (import `SLACK_COOKIE_ACCOUNT`)

**Interfaces:**
- Consumes: Task 1.
- Produces: `set_slack_credentials_logic(store, pool, generation, token: String, cookie: Option<String>)`; tauri `set_slack_credentials(token, cookie)`; `clear_slack_token` deletes both accounts.

- [ ] **Step 1: Write the failing tests** — append to the `commands::slack` `tests` module:

```rust
    #[tokio::test]
    async fn set_credentials_stores_token_and_cookie() {
        let (_d, pool) = pool().await;
        let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());
        let gen = AtomicU64::new(0);
        set_slack_credentials_logic(store.clone(), &pool, &gen, "xoxc-1".into(), Some("xoxd-9".into()))
            .await
            .unwrap();
        assert_eq!(store.get(SLACK_TOKEN_ACCOUNT).unwrap(), Some("xoxc-1".into()));
        assert_eq!(store.get(super::super::SLACK_COOKIE_ACCOUNT).unwrap(), Some("xoxd-9".into()));
    }

    #[tokio::test]
    async fn set_credentials_without_cookie_clears_stale_cookie() {
        let (_d, pool) = pool().await;
        let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());
        store.set(super::super::SLACK_COOKIE_ACCOUNT, "xoxd-old").unwrap();
        let gen = AtomicU64::new(0);
        set_slack_credentials_logic(store.clone(), &pool, &gen, "xoxp-1".into(), None).await.unwrap();
        assert_eq!(store.get(super::super::SLACK_COOKIE_ACCOUNT).unwrap(), None);
    }

    #[tokio::test]
    async fn clear_deletes_both_secrets() {
        let (_d, pool) = pool().await;
        let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());
        store.set(SLACK_TOKEN_ACCOUNT, "xoxc-1").unwrap();
        store.set(super::super::SLACK_COOKIE_ACCOUNT, "xoxd-9").unwrap();
        let gen = AtomicU64::new(0);
        clear_slack_token_logic(store.clone(), &pool, &gen).await.unwrap();
        assert_eq!(store.get(SLACK_TOKEN_ACCOUNT).unwrap(), None);
        assert_eq!(store.get(super::super::SLACK_COOKIE_ACCOUNT).unwrap(), None);
    }
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test --manifest-path src-tauri/Cargo.toml commands::slack::tests::set_credentials`
Expected: FAIL — `set_slack_credentials_logic` not found.

- [ ] **Step 3: Implement** — in `commands/slack.rs` add `use super::super::SLACK_COOKIE_ACCOUNT;` next to the token import, and replace `set_slack_token_logic` with:

```rust
pub async fn set_slack_credentials_logic(
    store: Arc<dyn SecretStore>,
    pool: &SqlitePool,
    generation: &AtomicU64,
    token: String,
    cookie: Option<String>,
) -> Result<(), CmdError> {
    // Wipe + bump BEFORE the keyring writes (fail-safe ordering).
    sdb::wipe_slack_cache(pool).await.map_err(|_| CmdError::Internal)?;
    generation.fetch_add(1, Ordering::SeqCst);
    let s = store.clone();
    tokio::task::spawn_blocking(move || {
        s.set(SLACK_TOKEN_ACCOUNT, &token)?;
        match cookie {
            Some(c) => s.set(SLACK_COOKIE_ACCOUNT, &c)?,
            None => s.delete(SLACK_COOKIE_ACCOUNT)?,
        }
        Ok::<(), crate::secrets::SecretError>(())
    })
    .await
    .map_err(|_| CmdError::Internal)?
    .map_err(|_| CmdError::SecretStore)?;
    Ok(())
}
```

In `clear_slack_token_logic`, change the keyring block to delete both:

```rust
    let s = store.clone();
    tokio::task::spawn_blocking(move || {
        s.delete(SLACK_TOKEN_ACCOUNT)?;
        s.delete(SLACK_COOKIE_ACCOUNT)?;
        Ok::<(), crate::secrets::SecretError>(())
    })
    .await
    .map_err(|_| CmdError::Internal)?
    .map_err(|_| CmdError::SecretStore)?;
```

Replace the `set_slack_token` tauri command with:

```rust
#[tauri::command]
pub async fn set_slack_credentials(
    state: State<'_, AppState>,
    token: String,
    cookie: Option<String>,
) -> Result<(), CmdError> {
    let _g = state.slack_lock.lock().await;
    set_slack_credentials_logic(
        state.secret_store.clone(),
        &state.pool,
        &state.slack_generation,
        token,
        cookie,
    )
    .await
}
```

- [ ] **Step 4: Update `lib.rs` registration** — in `generate_handler!`, replace `commands::slack::set_slack_token` with `commands::slack::set_slack_credentials`.

- [ ] **Step 5: Run tests + build**

Run: `cargo test --manifest-path src-tauri/Cargo.toml commands::slack` then `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: PASS + clean build.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/slack.rs src-tauri/src/lib.rs
git commit -m "feat(slack): store token + cookie; clear both; set_slack_credentials"
```

---

## Task 3: Extraction pure units — `scan_xoxc` + key derivation + `decrypt_cookie`

**Files:**
- Modify: `src-tauri/src/slack/extract.rs`
- Modify: `src-tauri/Cargo.toml` (add crypto crates)

**Interfaces:**
- Produces: `enum ExtractError {…}`; `struct ExtractedCreds { xoxc, xoxd, workspace_hint }`; `fn scan_xoxc(bytes: &[u8]) -> Option<String>`; `fn derive_key(password: &[u8]) -> [u8;16]`; `fn decrypt_cookie(encrypted: &[u8], key: &[u8]) -> Result<String, ExtractError>`.

- [ ] **Step 1: Add deps** — in `src-tauri/Cargo.toml` `[dependencies]`:

```toml
aes = "0.8"
cbc = { version = "0.1", features = ["alloc"] }
pbkdf2 = "0.12"
hmac = "0.12"
sha1 = "0.10"
```

- [ ] **Step 2: Write the failing tests** — in `src-tauri/src/slack/extract.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use aes::cipher::{block_padding::Pkcs7, BlockEncryptMut, KeyIvInit};

    #[test]
    fn scan_finds_xoxc_token() {
        let blob = br#"...{"token":"xoxc-12-34-56-abcdef"},"foo":1..."#;
        assert_eq!(scan_xoxc(blob).as_deref(), Some("xoxc-12-34-56-abcdef"));
    }

    #[test]
    fn scan_returns_none_when_absent() {
        assert_eq!(scan_xoxc(b"no token here"), None);
    }

    #[test]
    fn decrypt_round_trips_a_v10_cookie() {
        // Encrypt "xoxd-secret" with the same scheme decrypt_cookie expects.
        let key = derive_key(b"Slack Safe Storage");
        let iv = [0x20u8; 16];
        type Enc = cbc::Encryptor<aes::Aes128>;
        let ct = Enc::new(&key.into(), &iv.into())
            .encrypt_padded_vec_mut::<Pkcs7>(b"xoxd-secret");
        let mut encrypted = b"v10".to_vec();
        encrypted.extend_from_slice(&ct);
        assert_eq!(decrypt_cookie(&encrypted, &key).unwrap(), "xoxd-secret");
    }

    #[test]
    fn decrypt_rejects_short_input() {
        assert!(matches!(decrypt_cookie(b"v1", &[0u8; 16]), Err(ExtractError::CookieUnavailable)));
    }
}
```

- [ ] **Step 3: Run to verify failure**

Run: `cargo test --manifest-path src-tauri/Cargo.toml slack::extract`
Expected: FAIL — symbols not found.

- [ ] **Step 4: Implement the pure units** at the top of `src-tauri/src/slack/extract.rs`:

```rust
use aes::cipher::{block_padding::Pkcs7, BlockDecryptMut, KeyIvInit};
use pbkdf2::pbkdf2_hmac;
use regex::Regex;
use sha1::Sha1;
use std::sync::OnceLock;

#[derive(Debug, thiserror::Error)]
pub enum ExtractError {
    #[error("Slack desktop app not found")]
    NotInstalled,
    #[error("could not read Slack local storage")]
    TokenUnavailable,
    #[error("could not read or decrypt the Slack cookie")]
    CookieUnavailable,
    #[error("auto-detection isn't supported on this OS")]
    Unsupported,
}

pub struct ExtractedCreds {
    pub xoxc: String,
    pub xoxd: String,
    pub workspace_hint: Option<String>,
}

/// First `xoxc-…` token embedded in raw leveldb bytes, if any.
pub fn scan_xoxc(bytes: &[u8]) -> Option<String> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"xoxc-[0-9A-Za-z-]+").unwrap());
    let text = String::from_utf8_lossy(bytes);
    re.find(&text).map(|m| m.as_str().to_string())
}

/// macOS Chromium key: PBKDF2-HMAC-SHA1(password, "saltysalt", 1003, 16).
pub fn derive_key(password: &[u8]) -> [u8; 16] {
    let mut key = [0u8; 16];
    pbkdf2_hmac::<Sha1>(password, b"saltysalt", 1003, &mut key);
    key
}

type Aes128CbcDec = cbc::Decryptor<aes::Aes128>;

/// Decrypt a Chromium `v10`/`v11` cookie blob to its string value. Strips the
/// 3-byte version prefix, AES-128-CBC decrypts (IV = 16×0x20), PKCS#7-unpads,
/// then recovers the `xoxd-…` value (tolerating a leading SHA-256(domain) prefix
/// that newer Chromium prepends).
pub fn decrypt_cookie(encrypted: &[u8], key: &[u8]) -> Result<String, ExtractError> {
    if encrypted.len() <= 3 {
        return Err(ExtractError::CookieUnavailable);
    }
    let ct = &encrypted[3..];
    let iv = [0x20u8; 16];
    let pt = Aes128CbcDec::new(key.into(), (&iv).into())
        .decrypt_padded_vec_mut::<Pkcs7>(ct)
        .map_err(|_| ExtractError::CookieUnavailable)?;
    let text = String::from_utf8_lossy(&pt);
    match text.find("xoxd-") {
        Some(i) => Ok(text[i..].trim_end_matches('\0').to_string()),
        None => Err(ExtractError::CookieUnavailable),
    }
}
```

> **Verify at impl:** RustCrypto APIs shift between minor versions — if `decrypt_padded_vec_mut`/`encrypt_padded_vec_mut` or the `KeyIvInit` `.into()` forms don't resolve, adjust to the installed `aes`/`cbc` API (the round-trip test is the oracle). If the round-trip fails on `cbc` 0.1's exact method name, the equivalent is `decrypt_padded_mut::<Pkcs7>(&mut buf)`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml slack::extract`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/slack/extract.rs
git commit -m "feat(slack): xoxc scan + Chromium cookie decrypt (pure units)"
```

---

## Task 4: Extraction I/O — read the Cookies DB + `extract_credentials` (macOS)

**Files:**
- Modify: `src-tauri/src/slack/extract.rs`

**Interfaces:**
- Consumes: Task 3 pure units; existing `sqlx`.
- Produces: `async fn read_d_cookie_blob(db_path: &std::path::Path) -> Result<Vec<u8>, ExtractError>`; `#[cfg(target_os="macos")] async fn extract_credentials() -> Result<ExtractedCreds, ExtractError>` and a non-macOS stub returning `Unsupported`.

- [ ] **Step 1: Write the failing test** — append to `extract.rs` tests:

```rust
    #[tokio::test]
    async fn reads_encrypted_d_cookie_from_a_fixture_db() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("Cookies");
        let pool = sqlx::SqlitePool::connect(&format!("sqlite://{}?mode=rwc", db.display()))
            .await
            .unwrap();
        sqlx::query("CREATE TABLE cookies (name TEXT, encrypted_value BLOB)")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO cookies (name, encrypted_value) VALUES ('d', ?1)")
            .bind(vec![1u8, 2, 3, 4]).execute(&pool).await.unwrap();
        pool.close().await;
        assert_eq!(read_d_cookie_blob(&db).await.unwrap(), vec![1u8, 2, 3, 4]);
    }

    #[tokio::test]
    async fn read_d_cookie_missing_is_cookie_unavailable() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("Cookies");
        let pool = sqlx::SqlitePool::connect(&format!("sqlite://{}?mode=rwc", db.display()))
            .await.unwrap();
        sqlx::query("CREATE TABLE cookies (name TEXT, encrypted_value BLOB)")
            .execute(&pool).await.unwrap();
        pool.close().await;
        assert!(matches!(read_d_cookie_blob(&db).await, Err(ExtractError::CookieUnavailable)));
    }
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test --manifest-path src-tauri/Cargo.toml slack::extract::tests::read`
Expected: FAIL — `read_d_cookie_blob` not found.

- [ ] **Step 3: Implement the I/O** — append to `extract.rs` (above the tests):

```rust
/// Copy the Cookies SQLite to a temp path (Slack may hold a lock), open it
/// read-only, and return the raw `encrypted_value` of the `d` cookie.
pub async fn read_d_cookie_blob(db_path: &std::path::Path) -> Result<Vec<u8>, ExtractError> {
    let bytes = tokio::fs::read(db_path).await.map_err(|_| ExtractError::CookieUnavailable)?;
    let tmp = std::env::temp_dir().join(format!("astryn-slack-cookies-{}", std::process::id()));
    tokio::fs::write(&tmp, &bytes).await.map_err(|_| ExtractError::CookieUnavailable)?;
    let url = format!("sqlite://{}?mode=ro", tmp.display());
    let pool = sqlx::SqlitePool::connect(&url).await.map_err(|_| ExtractError::CookieUnavailable)?;
    let row: Option<(Vec<u8>,)> =
        sqlx::query_as("SELECT encrypted_value FROM cookies WHERE name = 'd' LIMIT 1")
            .fetch_optional(&pool).await.map_err(|_| ExtractError::CookieUnavailable)?;
    pool.close().await;
    let _ = tokio::fs::remove_file(&tmp).await;
    row.map(|r| r.0).ok_or(ExtractError::CookieUnavailable)
}

#[cfg(not(target_os = "macos"))]
pub async fn extract_credentials() -> Result<ExtractedCreds, ExtractError> {
    Err(ExtractError::Unsupported)
}

#[cfg(target_os = "macos")]
mod macos {
    use super::*;

    fn slack_dir() -> Result<std::path::PathBuf, ExtractError> {
        let home = std::env::var("HOME").map_err(|_| ExtractError::NotInstalled)?;
        let dir = std::path::Path::new(&home).join("Library/Application Support/Slack");
        if dir.is_dir() { Ok(dir) } else { Err(ExtractError::NotInstalled) }
    }

    /// The "Slack Safe Storage" password from the login keychain (triggers a
    /// one-time keychain-access prompt). Runs in spawn_blocking.
    fn safe_storage_password() -> Result<String, ExtractError> {
        let out = std::process::Command::new("/usr/bin/security")
            .args(["find-generic-password", "-w", "-s", "Slack Safe Storage"])
            .output()
            .map_err(|_| ExtractError::CookieUnavailable)?;
        if !out.status.success() {
            return Err(ExtractError::CookieUnavailable);
        }
        let pw = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if pw.is_empty() { Err(ExtractError::CookieUnavailable) } else { Ok(pw) }
    }

    pub async fn extract() -> Result<ExtractedCreds, ExtractError> {
        let dir = slack_dir()?;

        // xoxc: scan every leveldb .ldb/.log under Local Storage.
        let ls = dir.join("Local Storage/leveldb");
        let mut rd = tokio::fs::read_dir(&ls).await.map_err(|_| ExtractError::TokenUnavailable)?;
        let mut xoxc = None;
        while let Ok(Some(ent)) = rd.next_entry().await {
            let p = ent.path();
            let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");
            if ext == "ldb" || ext == "log" {
                if let Ok(bytes) = tokio::fs::read(&p).await {
                    if let Some(t) = scan_xoxc(&bytes) { xoxc = Some(t); break; }
                }
            }
        }
        let xoxc = xoxc.ok_or(ExtractError::TokenUnavailable)?;

        // xoxd: decrypt the d cookie.
        let encrypted = read_d_cookie_blob(&dir.join("Cookies")).await?;
        let password = tokio::task::spawn_blocking(safe_storage_password)
            .await
            .map_err(|_| ExtractError::CookieUnavailable)??;
        let key = derive_key(password.as_bytes());
        let xoxd = decrypt_cookie(&encrypted, &key)?;

        Ok(ExtractedCreds { xoxc, xoxd, workspace_hint: None })
    }
}

#[cfg(target_os = "macos")]
pub async fn extract_credentials() -> Result<ExtractedCreds, ExtractError> {
    macos::extract().await
}
```

- [ ] **Step 4: Run tests + build**

Run: `cargo test --manifest-path src-tauri/Cargo.toml slack::extract` then `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: PASS (the two DB-read tests; the macOS path is exercised by the smoke in Task 7).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/slack/extract.rs
git commit -m "feat(slack): read+decrypt the d cookie; macOS extract_credentials"
```

---

## Task 5: `detect_slack_credentials` command + self-healing rotation

**Files:**
- Modify: `src-tauri/src/commands/slack.rs`
- Modify: `src-tauri/src/lib.rs` (register `detect_slack_credentials`)

**Interfaces:**
- Consumes: Tasks 1-4.
- Produces: `detect_slack_credentials_logic<E,Fut>(store, pool, generation, extract, fetch_auth) -> Result<SlackStatus, CmdError>` (injected extractor + auth-test for testability); `store_slack_secrets_logic(store, token, cookie)` (no-wipe in-place update); `redetect_secrets`/`run_sync`/`run_test` `&AppState` helpers; tauri `detect_slack_credentials`; the rewired `sync_slack_catchup` + `test_slack_connection` with one-shot redetect-on-auth-failure.

- [ ] **Step 1: Write the failing tests** — append to `commands::slack` tests:

```rust
    use crate::slack::extract::{ExtractError, ExtractedCreds};

    #[tokio::test]
    async fn detect_stores_creds_and_verifies_identity() {
        let (_d, pool) = pool().await;
        let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());
        let gen = AtomicU64::new(0);
        let status = detect_slack_credentials_logic(
            store.clone(), &pool, &gen,
            || async { Ok(ExtractedCreds { xoxc: "xoxc-1".into(), xoxd: "xoxd-9".into(), workspace_hint: None }) },
            |_auth| async { Ok(AuthTest { user_id: "U1".into(), team_id: "T1".into(), url: "https://acme.slack.com/".into(), user: "x".into() }) },
        ).await.unwrap();
        assert!(matches!(status, SlackStatus::Connected { .. }));
        assert_eq!(store.get(SLACK_TOKEN_ACCOUNT).unwrap(), Some("xoxc-1".into()));
        assert_eq!(store.get(super::super::SLACK_COOKIE_ACCOUNT).unwrap(), Some("xoxd-9".into()));
    }

    #[tokio::test]
    async fn detect_surfaces_extract_failure() {
        let (_d, pool) = pool().await;
        let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());
        let gen = AtomicU64::new(0);
        let r = detect_slack_credentials_logic(
            store, &pool, &gen,
            || async { Err(ExtractError::NotInstalled) },
            |_auth| async { Ok(AuthTest { user_id: "U1".into(), team_id: "T1".into(), url: "u".into(), user: "x".into() }) },
        ).await;
        assert!(matches!(r, Err(CmdError::SlackNotConfigured)));
    }

    #[tokio::test]
    async fn store_secrets_updates_both_without_wiping_cache() {
        let (_d, pool) = pool().await;
        // Seed a cached conversation; rotation must NOT clear it.
        crate::db::slack::replace_catchup(&pool, &[crate::db::slack::ConversationInsert {
            id: "C1".into(), kind: "channel".into(), name: Some("eng".into()), partner_user_id: None,
            unread_count: 1, has_mention: false, unread_threads: 0, last_read_ts: None, latest_ts: Some("2.0".into()), latest_snippet: None,
        }], &[], &[], "now").await.unwrap();
        let store: Arc<dyn SecretStore> = Arc::new(FakeSecretStore::default());
        store_slack_secrets_logic(store.clone(), "xoxc-2".into(), Some("xoxd-2".into())).await.unwrap();
        assert_eq!(store.get(SLACK_TOKEN_ACCOUNT).unwrap(), Some("xoxc-2".into()));
        assert_eq!(store.get(super::super::SLACK_COOKIE_ACCOUNT).unwrap(), Some("xoxd-2".into()));
        // Cache survived (rotation is not an account switch).
        assert_eq!(get_slack_catchup_logic(&pool).await.unwrap().conversations.len(), 1);
    }
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test --manifest-path src-tauri/Cargo.toml commands::slack::tests::detect`
Expected: FAIL — `detect_slack_credentials_logic` not found.

- [ ] **Step 3: Implement** — append to `commands/slack.rs`:

```rust
fn map_extract_err(_e: crate::slack::extract::ExtractError) -> CmdError {
    // Sanitized: any extraction failure reads as "not configured / reconnect".
    CmdError::SlackNotConfigured
}

pub async fn detect_slack_credentials_logic<E, EFut, F, FFut>(
    store: Arc<dyn SecretStore>,
    pool: &SqlitePool,
    generation: &AtomicU64,
    extract: E,
    fetch_auth: F,
) -> Result<SlackStatus, CmdError>
where
    E: FnOnce() -> EFut,
    EFut: std::future::Future<Output = Result<crate::slack::extract::ExtractedCreds, crate::slack::extract::ExtractError>>,
    F: FnOnce(crate::slack::SlackAuth) -> FFut,
    FFut: std::future::Future<Output = Result<AuthTest, SlackError>>,
{
    let creds = extract().await.map_err(map_extract_err)?;
    set_slack_credentials_logic(store, pool, generation, creds.xoxc.clone(), Some(creds.xoxd.clone())).await?;
    let auth = crate::slack::SlackAuth { authorization: format!("Bearer {}", creds.xoxc), cookie: Some(creds.xoxd) };
    let a = fetch_auth(auth).await.map_err(map_slack_err)?;
    let workspace_name = workspace_name_from_url(&a.url);
    sdb::save_slack_identity(pool, &a.user_id, &a.team_id, &a.url, workspace_name.as_deref())
        .await.map_err(|_| CmdError::Internal)?;
    Ok(SlackStatus::Connected { workspace_name, user_name: a.user_id })
}

/// Update the two Slack secrets in place — used by self-healing rotation. The
/// account is unchanged (same user, refreshed session), so this does NOT wipe
/// the cache or bump the generation.
pub async fn store_slack_secrets_logic(
    store: Arc<dyn SecretStore>,
    token: String,
    cookie: Option<String>,
) -> Result<(), CmdError> {
    tokio::task::spawn_blocking(move || {
        store.set(SLACK_TOKEN_ACCOUNT, &token)?;
        if let Some(c) = cookie {
            store.set(SLACK_COOKIE_ACCOUNT, &c)?;
        }
        Ok::<(), crate::secrets::SecretError>(())
    })
    .await
    .map_err(|_| CmdError::Internal)?
    .map_err(|_| CmdError::SecretStore)?;
    Ok(())
}
```

The tauri `detect_slack_credentials` wires the real extractor + client:

```rust
#[tauri::command]
pub async fn detect_slack_credentials(state: State<'_, AppState>) -> Result<SlackStatus, CmdError> {
    let _g = state.slack_lock.lock().await;
    let client = state.slack.clone();
    detect_slack_credentials_logic(
        state.secret_store.clone(),
        &state.pool,
        &state.slack_generation,
        || async { crate::slack::extract::extract_credentials().await },
        move |auth| async move { fetch_auth_test(&client, auth).await },
    )
    .await
}
```

**Rotation wiring — replace the EXISTING `sync_slack_catchup` and `test_slack_connection` tauri commands** (from the catch-up board) with these. The sync/test bodies move into plain `&AppState` async fns (no generic-closure lifetime gymnastics), and the thin tauri wrappers add a one-shot redetect-on-auth-failure. The `*_logic` fns are untouched, so their tests stand.

```rust
async fn redetect_secrets(state: &AppState) -> Result<(), CmdError> {
    let extracted = crate::slack::extract::extract_credentials().await.map_err(map_extract_err)?;
    store_slack_secrets_logic(state.secret_store.clone(), extracted.xoxc, Some(extracted.xoxd)).await
}

async fn run_sync(state: &AppState) -> Result<SlackSyncSummary, CmdError> {
    let identity = sdb::load_slack_identity(&state.pool).await.map_err(|_| CmdError::Internal)?;
    let viewer_id = identity.map(|i| i.user_id).ok_or(CmdError::SlackNotConfigured)?;
    let client_l = state.slack.clone();
    let client_c = state.slack.clone();
    sync_slack_catchup_logic(
        state.slack_credentials.clone(), &state.pool, &state.slack_generation, viewer_id, now_iso_slack(),
        move |auth| { let c = client_l.clone(); async move { list_member_conversations(&c, auth).await } },
        move |auth, conv_id, _lr| { let c = client_c.clone(); async move { fetch_conversation_data(&c, auth, conv_id).await } },
    ).await
}

async fn run_test(state: &AppState) -> Result<SlackStatus, CmdError> {
    let client = state.slack.clone();
    test_slack_connection_logic(
        state.slack_credentials.clone(), &state.pool,
        move |auth| async move { fetch_auth_test(&client, auth).await },
    ).await
}

#[tauri::command]
pub async fn sync_slack_catchup(state: State<'_, AppState>) -> Result<SlackSyncSummary, CmdError> {
    let _g = state.slack_lock.lock().await;
    match run_sync(&state).await {
        // map_slack_err maps SlackError::Auth -> SlackNotConfigured, so this is the rotation signal.
        Err(CmdError::SlackNotConfigured) => { redetect_secrets(&state).await?; run_sync(&state).await }
        other => other,
    }
}

#[tauri::command]
pub async fn test_slack_connection(state: State<'_, AppState>) -> Result<SlackStatus, CmdError> {
    let _g = state.slack_lock.lock().await;
    match run_test(&state).await {
        Err(CmdError::SlackNotConfigured) => { redetect_secrets(&state).await?; run_test(&state).await }
        other => other,
    }
}
```

On non-macOS, `extract_credentials()` returns `Unsupported` → `SlackNotConfigured`, so the single retry just re-fails (no loop) and the user reconnects manually. The retry is bounded to once by construction (the inner call's result is returned as-is).

- [ ] **Step 4: Register + run tests + build**

Add `commands::slack::detect_slack_credentials` to `lib.rs` `generate_handler!`.
Run: `cargo test --manifest-path src-tauri/Cargo.toml commands::slack` then `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: PASS + clean build.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/slack.rs src-tauri/src/lib.rs
git commit -m "feat(slack): detect_slack_credentials + self-healing auth retry"
```

---

## Task 6: Frontend — bindings + Settings "Detect" + manual fallback

**Files:**
- Modify: `src/lib/commands.ts`
- Modify: `src/features/settings/Settings.tsx`

**Interfaces:**
- Consumes: Tasks 2 & 5 commands.
- Produces (TS): `detectSlackCredentials(): Promise<SlackStatus>`, `setSlackCredentials(token, cookie?): Promise<void>`.

- [ ] **Step 1: Update bindings** — in `src/lib/commands.ts`, replace the `setSlackToken` binding and add detect:

```ts
export const setSlackCredentials = (token: string, cookie?: string | null): Promise<void> =>
  invoke("set_slack_credentials", { token, cookie: cookie ?? null });
export const detectSlackCredentials = (): Promise<SlackStatus> => invoke("detect_slack_credentials");
```
(Remove the old `setSlackToken` export.)

- [ ] **Step 2: Update the Settings Slack card** — in `src/features/settings/Settings.tsx`:
  - Swap the import `setSlackToken` → `setSlackCredentials, detectSlackCredentials`.
  - Add a detect mutation + a manual-fallback handler:

```tsx
  const [slackManualOpen, setSlackManualOpen] = useState(false);
  const [slackCookieInput, setSlackCookieInput] = useState("");

  const slackDetectMut = useMutation({
    mutationFn: () => detectSlackCredentials(),
    onSuccess: (s) => {
      clearSlackQueries(qc);
      if (s.state === "connected") gooeyToast.success(`Connected as ${s.userName}`);
      invalidateSlackStatus();
    },
    onError: (err) =>
      gooeyToast.error("Couldn't detect Slack", {
        description: "Make sure the Slack desktop app is installed and signed in. " + errorText(err),
      }),
  });
```
  Keep the existing manual save but route it through `setSlackCredentials(token, cookie)` (now passing the optional cookie field), still using the direct-async, input-cleared-before-await pattern:

```tsx
  const handleSlackSave = async (e: FormEvent) => {
    e.preventDefault();
    if (slackBusy) return;
    const token = slackInput.trim();
    if (!token) return;
    const cookie = slackCookieInput.trim() || null;
    setSlackInput(""); setSlackCookieInput("");
    setSlackSaving(true);
    try {
      await setSlackCredentials(token, cookie);
      clearSlackQueries(qc);
      gooeyToast.success("Slack credentials saved");
      invalidateSlackStatus();
    } catch (err) {
      clearSlackQueries(qc);
      gooeyToast.error("Could not save", { description: errorText(err) });
    } finally {
      setSlackSaving(false);
    }
  };
```
  - The card body: a primary **"Detect from Slack app"** button (`onClick={() => slackDetectMut.mutate()}`, disabled while `slackBusy || slackDetectMut.isPending`) with a one-line note: *"Reads your signed-in Slack desktop app. macOS may ask to allow keychain access once. Uses your Slack session (xoxc/xoxd) — against Slack's API terms and possibly your employer's policy; read-only."* Then a collapsible **"Enter manually"** (`slackManualOpen`) revealing the existing `xoxc` token field plus a second password field bound to `slackCookieInput` (placeholder `xoxd-…`), and the Save button.
  - Include `detectSlackCredentials`/`setSlackCredentials` in the test mock if `Settings.test.tsx` mocks `@/lib/commands` (mirror Task 12's approach from the prior plan); do not weaken existing assertions.

- [ ] **Step 3: Run tests + typecheck**

Run: `npm test -- src/features/settings/Settings.test.tsx` then `npx tsc --noEmit`
Expected: PASS + clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/commands.ts src/features/settings/Settings.tsx
git commit -m "feat(slack): Settings detect-from-app button + manual cookie fallback"
```

---

## Task 7: `requirements.md` + full verification + macOS smoke

**Files:**
- Modify: `requirements.md`

- [ ] **Step 1: Update `requirements.md`:**
  - §4 Slack auth: add the **session-token (`xoxc`/`xoxd`) mode** with macOS auto-extraction, the `slack_cookie_d` keychain account, the `SlackAuth` seam, self-healing rotation, and the **ToS/employer caveat**; keep `xoxp` as the alternate installable-workspace mode.
  - §5/§10: note the `slack/extract.rs` module + the `slack_cookie_d` account (no new tables).
  - §11: add a milestone line "Slack session-token auth (local-app auto-extraction, macOS). ✅ Done."
  - §14: keep huddles + Windows/Linux auto-extraction as `[EXT]`.

- [ ] **Step 2: Full verification gate** — run each, confirm the outcome:
```bash
cargo test --manifest-path src-tauri/Cargo.toml          # all pass (incl. slack::extract + commands::slack)
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check # clean
cargo clippy --manifest-path src-tauri/Cargo.toml         # no warnings
npm test                                                  # all pass
npx tsc --noEmit                                          # clean
```
If clippy flags new dead_code on `read_d_cookie_blob`/`ExtractedCreds.workspace_hint` (only consumed on macOS), add a targeted `#[allow(dead_code)]` with an intent comment, mirroring the existing `parse_user` treatment.

- [ ] **Step 3: macOS real-app smoke (`[REQ]` before merge)** — `npm run tauri dev`, Settings → "Detect from Slack app" (allow the keychain prompt) → confirm the board populates from the real workspace; then sign out of Slack / let the session rotate and confirm the next sync re-detects (or shows "reconnect"). Record the result. **This is the only check that confirms the `xoxc` transport (Bearer vs `token` param) and the live cookie decryption** — offline tests can't.

- [ ] **Step 4: Commit**

```bash
git add requirements.md
git commit -m "docs(slack): record session-token auth in requirements.md"
```

---

## Self-Review notes (for the implementer)

- **Spec coverage:** cookie transport → T1 (`SlackClient::call` + `SlackAuth`); two-secret storage + clear → T2; auto-extraction (scan + decrypt + I/O) → T3/T4; detect command + self-healing rotation → T5; Settings detect + manual fallback → T6; requirements + caveat + smoke → T7.
- **Type consistency:** `SlackAuth { authorization, cookie }` flows T1→T5; `PersonalTokenProvider::new(store, token_acct, cookie_acct)` (T1) matches the lib.rs call; `set_slack_credentials_logic(…, token, cookie)` (T2) is what T5's detect calls; the tauri command is `set_slack_credentials` (T2) ↔ TS `setSlackCredentials` (T6); `detect_slack_credentials` (T5) ↔ `detectSlackCredentials` (T6).
- **Known smoke-only risks:** the `xoxc` Bearer-vs-`token`-param question and the live Chromium cookie decryption (version prefix handling) are confirmed only by the T7 macOS smoke; the round-trip decrypt test validates the algorithm, not the live blob format.
- **Deferred (unchanged):** huddles; Windows/Linux auto-extraction (manual fallback covers them).
