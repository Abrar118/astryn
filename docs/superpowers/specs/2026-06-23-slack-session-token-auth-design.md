# Slack Session-Token Auth via Local-App Auto-Extraction

**Status:** Design approved (2026-06-23). Builds on the shipped Slack catch-up board (`docs/superpowers/specs/2026-06-23-slack-catch-up-board-design.md`, branch `feat/slack-catch-up-board` / PR #11). Branch: `feat/slack-session-token-auth`.

## 1. Why

The shipped board authenticates with an official Slack **user token** (`xoxp-`) from a self-created Slack app. On a workspace where the owner **cannot install custom apps** (Enterprise Grid / admin-restricted, no admin access), that path is impossible — there is no way to obtain an `xoxp` token.

The only remaining route is the **session credentials the Slack desktop client itself uses**: the `xoxc-` API token + the `xoxd` session cookie. These authenticate the *standard* Slack Web API with no app install, so the board's entire unread pipeline works unchanged — the only thing missing is a way to (a) send the cookie and (b) obtain the two values. This iteration adds both, with the values **auto-extracted from the installed Slack desktop app** so the user never touches DevTools.

**Trade-off, stated plainly (`[REQ]` to document in-app):** `xoxc`/`xoxd` use Slack's private client session, not the sanctioned app-token flow. This violates Slack's API terms and, because this is the user's **employer** workspace, may also violate company IT/acceptable-use policy; the `xoxd` cookie is a full session credential. This is a single-user, local, read-only tool operating on the user's own authenticated session — an informed personal-productivity choice. The app surfaces the caveat; it does not hide it.

## 2. Scope

### In scope `[REQ]`
1. Send the `xoxd` cookie alongside the `xoxc` token on every Slack API call (auth-seam widening).
2. **Auto-extract** `xoxc` + `xoxd` from the installed Slack desktop app (**macOS**), store them in the OS keychain.
3. **Self-healing rotation:** on an auth failure, automatically re-extract from the still-logged-in Slack app and retry once.
4. Settings UX: a **"Detect from Slack app"** button (primary) + a manual-paste fallback (two fields).
5. Credential isolation extended to the second secret (the cookie).

### Out of scope `[EXT]`
- **Huddles** — still deferred. (The session token makes them feasible later via `client.boot`/`client.counts`; not built here.)
- **Windows / Linux auto-extraction** (DPAPI / libsecret decryption) — the manual-paste fallback covers other OSes until then. macOS is the owner's platform and ships first.
- Switching the unread engine to `client.counts` — the existing history-vs-`last_read` engine works with the session token as-is; not rewritten (YAGNI).
- Multi-workspace; OAuth.

### Unchanged
The unread pipeline end to end — `users.conversations`, `conversations.info/.history/.replies`, the unread/mention/thread logic, the SQLite cache, the board UI, the Linear chip, "Open in Slack". A session token authenticates the standard Web API, so none of it changes.

## 3. Authentication model

- **`xoxc` token** — sent as `Authorization: Bearer <xoxc>` (the existing wrapping in `PersonalTokenProvider` already produces this; `xoxc` works as a Bearer credential in practice). Keychain account: the existing **`slack_user_token`** (now holds an `xoxc-` value in session mode). **Verify at impl:** the Slack web client sends `xoxc` as a form `token` param rather than a Bearer header; if a method rejects `Bearer <xoxc>`, fall back to sending the token as the `token` form field (our `call` already form-encodes params, so this is a one-line addition) — the `Cookie` header is the load-bearing part either way.
- **`xoxd` cookie** — sent as an HTTP request header **`Cookie: d=<xoxd>`**. New keychain account **`slack_cookie_d`**. (`[CHOICE]` if the `d-s` companion cookie proves necessary for some endpoints, add `slack_cookie_ds`; verify at impl — `d` alone is normally sufficient for the Web API methods used.)
- An official `xoxp` token continues to work with **no cookie** — so the existing path is preserved; "session mode" is simply "a cookie is also present."

### 3.1 Auth seam widening `[REQ]`
`SlackCredentialProvider` currently returns `Result<Option<String>, SecretError>` (the Bearer string). Widen the credential to a struct:

```rust
pub struct SlackAuth { pub authorization: String, pub cookie: Option<String> }

pub trait SlackCredentialProvider: Send + Sync {
    fn auth(&self) -> Result<Option<SlackAuth>, SecretError>;
}
```

- `PersonalTokenProvider` reads `slack_user_token` → `SlackAuth { authorization: "Bearer <t>", cookie: read(slack_cookie_d) }`. (One provider serves both modes: official = cookie `None`, session = cookie `Some`.)
- `SlackClient::call` changes signature from `call(&self, authorization: &str, …)` to `call(&self, auth: &SlackAuth, …)` and adds `.header("Cookie", format!("d={c}"))` when `auth.cookie` is `Some`. **This is the only transport change.**
- The `authorize()` helper in `commands/slack.rs` returns `SlackAuth` instead of `String`; the ~5 `.call(&auth, …)` sites pass `&SlackAuth`. The test `FakeSlackCreds(Option<String>)` becomes `FakeSlackCreds(Option<SlackAuth>)`, and existing slack tests that pass `Some("Bearer x".into())` update to `Some(SlackAuth { authorization: "Bearer x".into(), cookie: None })`. (Mechanical; this is the expected churn of widening the seam.)

## 4. Auto-extraction — `src-tauri/src/slack/extract.rs`

A new module, **macOS-gated** (`#[cfg(target_os = "macos")]`; other targets return `ExtractError::Unsupported`, steering the user to manual paste). Reads the installed Slack app's local state under `~/Library/Application Support/Slack/`.

```rust
pub struct ExtractedCreds { pub xoxc: String, pub xoxd: String, pub workspace_hint: Option<String> }

#[derive(Debug, thiserror::Error)]
pub enum ExtractError {
    #[error("Slack desktop app not found")] NotInstalled,
    #[error("could not read Slack local storage")] TokenUnavailable,
    #[error("could not read or decrypt the Slack cookie")] CookieUnavailable,
    #[error("auto-detection isn't supported on this OS")] Unsupported,
}

pub fn extract_credentials() -> Result<ExtractedCreds, ExtractError>;
```

### 4.1 `xoxc` token — Local Storage leveldb
- Path: `~/Library/Application Support/Slack/Local Storage/leveldb/` (`.ldb` + `.log` files).
- The token lives in the `localConfig_v2` localStorage value (`teams → <team_id> → token`). Chromium's leveldb localStorage key encoding makes a clean parse painful, so the pragmatic, tool-proven approach is to **scan the raw `.ldb`/`.log` bytes for the `xoxc-…` pattern** (regex `xoxc-[0-9A-Za-z-]+`), then, if multiple workspaces are present, extract the enclosing JSON to map workspace→token and pick the relevant one. Single-workspace (the owner's case) → take the sole match.
- Pure, testable unit: `fn scan_xoxc(bytes: &[u8]) -> Vec<String>` — given fixture bytes, returns the token(s). The file-read wrapper is thin.

### 4.2 `xoxd` cookie — Chromium-encrypted Cookies DB
- Path: `~/Library/Application Support/Slack/Cookies` (SQLite). Read `SELECT encrypted_value FROM cookies WHERE name = 'd'` (read-only open; copy the file first if it's locked by a running Slack).
- Decrypt (macOS Chromium scheme): key = `PBKDF2-HMAC-SHA1(password = keychain("Slack Safe Storage"), salt = "saltysalt", iterations = 1003, len = 16)`; cipher = AES-128-CBC, IV = sixteen `0x20` bytes; strip the 3-byte `v10`/`v11` prefix from `encrypted_value`; PKCS#7-unpad; on newer Chromium strip the leading 32-byte SHA-256(domain) prefix if present (**verify the exact Chromium version handling at impl** against the installed Slack).
- `[CHOICE]` Use the Rust **`rookie`** crate (cross-platform Chromium cookie extraction + decryption, accepts a custom cookie-DB path) to avoid hand-rolling the SQLite read + AES + keychain access. Fall back to hand-rolled (`rusqlite` + `aes`/`cbc` + `pbkdf2`+`hmac`+`sha1` + `security-framework` for the keychain password) only if `rookie` can't target Slack's path.
- Pure, testable unit: `fn decrypt_cookie(encrypted: &[u8], key: &[u8]) -> Result<String, ExtractError>` — verified against a known (ciphertext, key) → plaintext vector.
- **macOS keychain prompt:** reading the "Slack Safe Storage" item from Astryn triggers a one-time *"astryn wants to use 'Slack Safe Storage'"* prompt; "Always Allow" suppresses recurrence. Documented in Settings. (`Application Support` is not TCC-protected, so the file reads themselves need no prompt.)

## 5. Storage, rotation & commands — `commands/slack.rs`

### 5.1 Storage
Keychain accounts: `slack_user_token` (`xoxc`) + `slack_cookie_d` (`xoxd`). Identity/workspace meta stays in `settings` as today. The provider reads both from the keychain off the async executor (`spawn_blocking`), exactly like the current token read.

### 5.2 Commands
- **`detect_slack_credentials()`** (new) — runs `extract_credentials()` (in `spawn_blocking`), and on success: wipe prior Slack cache + bump generation (account-switch, fail-safe ordering as today), store `xoxc` + `xoxd` in the keychain, then `auth.test` to verify + cache identity. Returns the same `SlackStatus` shape. Acquires the Slack lock. Surfaces `ExtractError` as a sanitized `CmdError` ("Couldn't read Slack — is the desktop app installed and signed in?").
- **`set_slack_credentials(token, cookie?)`** (the manual fallback; widens the existing `set_slack_token`) — stores `xoxc` (+ optional `xoxd`); same wipe+bump+store flow.
- **`clear_slack_token()`** — now also deletes `slack_cookie_d`. `wipe_slack_cache` + both keychain deletes.
- `get_slack_status` / `test_slack_connection` / `sync_slack_catchup` / `get_slack_catchup` / `get_slack_conversation_messages` / `slack_deep_link` — unchanged except they flow `SlackAuth` (with cookie) through.

### 5.3 Self-healing rotation `[REQ]`
On a `SlackError::Auth` (`invalid_auth`/`not_authed`/`token_revoked`) during `test_slack_connection` or `sync_slack_catchup`, the command — already holding the Slack lock — performs **one** re-detect: `extract_credentials()` → store the fresh `xoxc`/`xoxd` → retry the failed operation once. If the retry still returns `Auth` (e.g. Slack itself is logged out), surface a sanitized "Slack session expired — reconnect" `CmdError`; the board keeps showing cached rows (offline-first). The retry is bounded to once to avoid loops. The orchestration is a small wrapper (`with_auth_retry`) around the live fetch closures, kept out of the pure `*_logic` fns (which stay injected-closure-testable: a fake extractor that returns fresh creds proves the store-and-retry path; a fake that returns `Auth` twice proves the give-up path).

## 6. Frontend — `src/features/settings/Settings.tsx`

The Slack card's primary control becomes **"Detect from Slack app"** → calls `detectSlackCredentials()` → on success toasts "Connected as …" and refreshes status. Below it, a collapsed **"Enter manually"** disclosure reveals two password fields (`xoxc` token + `xoxd` cookie) wired to `set_slack_credentials` via the existing **direct-async, secret-never-cached** pattern (clear inputs before the await). A one-line note states the read-only + ToS/employer caveat and that macOS may prompt for keychain access on first detect. New TS bindings: `detectSlackCredentials()`, `setSlackCredentials(token, cookie?)`; `SlackStatus` is unchanged.

## 7. Security & cross-cutting `[REQ]`
- The `xoxd` cookie is a full session credential — **keychain only**, never returned to TS / persisted in SQLite / logs / a TanStack mutation cache. Same enforceable rule as the token; the manual fallback uses the direct-async save.
- Clearing the token wipes **both** keychain entries + the Slack cache + identity; never touches Linear/GitHub (the existing isolation, extended to the second secret).
- Sanitized errors (no raw keyring/leveldb/decrypt diagnostics cross IPC); offline-first and goey-toast behaviors unchanged.
- The ToS / employer-policy caveat (§1) is restated in `requirements.md` and shown in the Settings note. `[REQ]`

## 8. Testing
**Rust (`cargo test`):**
- `scan_xoxc` extracts the token from fixture leveldb bytes (single + multi-workspace); returns empty on absence.
- `decrypt_cookie` against a known (ciphertext, key, plaintext) Chromium vector; malformed input → `CookieUnavailable`.
- `SlackClient::call` sends `Cookie: d=…` when `auth.cookie` is `Some`, and omits it when `None` (assert on the built request / via a fake transport).
- Provider returns `SlackAuth` with the cookie when `slack_cookie_d` is set, `None` when not.
- `clear` deletes both keychain entries; credential isolation leaves Linear/GitHub intact.
- Self-healing retry: injected fake extractor returning fresh creds → store + retry succeeds; returning `Auth` twice → gives up with the sanitized error, prior cache intact.
- `detect_slack_credentials` (logic, injected extractor) wipes prior state + stores + verifies identity.

**Frontend (Vitest):** Settings "Detect" button calls `detectSlackCredentials` and reflects the result; manual fallback uses the direct-async path (no secret in a mutation); status rendering unchanged.

**Manual smoke (`[REQ]` before merge):** with the real Slack app signed in on macOS, click Detect → confirm the board populates; sign out / rotate to confirm the re-detect path.

## 9. `requirements.md` updates (part of implementation)
- §4 Slack auth: add the **session-token (`xoxc`/`xoxd`) mode** with auto-extraction, the keychain accounts, the `SlackAuth` seam, and the **ToS/employer caveat**; keep `xoxp` as the alternate (installable-workspace) mode.
- §5/§10: note the `slack/extract.rs` module and the `slack_cookie_d` keychain account (no new SQLite tables).
- §11: add a milestone line for session-token auth.
- §14: keep huddles + Win/Linux auto-extract as `[EXT]`.

## 10. Acceptance criteria
1. With the Slack desktop app installed + signed in (macOS), "Detect from Slack app" connects the board with no app install and no DevTools; sections populate from the real workspace.
2. Every Slack API call carries `Cookie: d=<xoxd>` in session mode; official `xoxp` mode still works with no cookie.
3. When the session rotates (token/cookie invalidated), the next sync auto-re-extracts and recovers without user action; if Slack is logged out, a "reconnect" message shows and cached rows remain.
4. The manual fallback (two fields) connects via the direct-async, secret-safe save; neither secret is ever returned to the webview or cached.
5. Clearing Slack wipes both keychain secrets + the cache + identity and never disturbs Linear/GitHub.
6. The ToS/employer caveat is shown in Settings and recorded in `requirements.md`.
7. Rust + Vitest suites pass; `cargo fmt`/`clippy` clean; `tsc --noEmit` clean. A real-app macOS smoke confirms detect + rotation.
