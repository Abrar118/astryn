# Slack Catch-Up Board (Phase 2 — iteration 1)

**Status:** Design approved (2026-06-23). First slice of the `[EXT]` Slack/Discord work anticipated in `requirements.md` §1/§2/§14. This is a deliberate re-prioritization ahead of M6 (doc links) and the LLM phase, decided by the owner.

## 1. Summary

A standalone, viewer-centric **Slack catch-up board** that answers one question fast: *"What did I miss?"* It surfaces, for a single Slack workspace, the things you haven't read — **unread @mentions, direct & group DMs, unread threads, and unread channels** — and lets you **read them in-app (read-only)**, then jump into the Slack desktop app to reply.

It deliberately mirrors the proven **GitHub PR dashboard (M4)** architecture: a dedicated dock view, a Rust module that owns the token and all API calls, a transactionally-refreshed SQLite cache, typed Tauri commands, and a pure-consumer React frontend. The integration is **poll-on-open** (no persistent connection); live **huddle** awareness is explicitly deferred to iteration 2 (§11), which needs an always-on socket the official API only exposes via real-time events.

This keeps Astryn's hard architectural rule (`requirements.md` §3): all Slack API calls happen in Rust; the webview never sees the token.

## 2. Goals & non-goals

**Goals**
- One place to see everything unread for *you* in your workspace, grouped by signal: **Mentions → DMs → Threads → Channels**.
- **Read unread messages in-app**, read-only and rendered (Slack mrkdwn, emoji, avatars), so you can catch up without opening Slack.
- A per-item **"Open in Slack"** deep link to reply in the native client.
- **Offline-first:** the board opens instantly from the local cache, then refreshes in the background.
- Degrade gracefully with no Slack token (a quiet "Connect Slack" prompt, never an error).
- A convenience **Linear chip** when a message text carries a Linear issue identifier (e.g. `ENG-123`), opening that issue's tab inside Astryn — reusing the GitHub dashboard's identifier→tab mechanism.

**Non-goals (this iteration)**
- **No huddles.** Live huddle indicators need an always-on Socket Mode connection (`user_huddle_changed` events); deferred to iteration 2 (§11). The official API has no "list active huddles" call, so a poll-on-open board cannot show them.
- **No writing to Slack** — no composing/replying (`chat.postMessage`) and **no mark-as-read** (`conversations.mark`). Reading in-app does **not** clear your Slack unread state in v1; replies happen in Slack via the deep link. (Read-only ⇒ no write scopes.)
- **No `search.messages`.** Mentions are derived from the unread messages we already fetch, not via the legacy search API.
- **Single workspace.** Multi-workspace is a clean `[EXT]` seam (the credential provider is trait-backed), not built now.
- **No OAuth.** A user pastes a Slack user token (the OAuth-later seam is the same provider trait, mirroring Linear/GitHub).

## 3. Authentication & secrets

- **Token:** a Slack **user token** (`xoxp-…`) from a Slack app the user creates and installs in their workspace, stored in the OS keychain via the existing `SecretStore` trait. Keychain service `com.orion.astryn`, new account `slack_user_token`. Sent as `Authorization: Bearer <token>`.
- **Why a user token (not a bot token):** unread state, `last_read`, and DM/mention visibility are all *per-user*. A bot token sees only what the bot is a member of and exposes no personal read markers. The catch-up board is inherently viewer-centric, so it requires the installing user's own token.
- **Scopes (minimal, read-only):**
  - Read membership & metadata: `channels:read`, `groups:read`, `im:read`, `mpim:read`, `users:read`, `team:read`.
  - Read message bodies (for in-app reading, thread replies, and mention detection): `channels:history`, `groups:history`, `im:history`, `mpim:history`.
  - **No** `search:read` (mentions derived locally). **No** write scopes (no reply/mark-read in v1).
  - The Settings UI documents that these grant broad read access to the user's conversations in that workspace (trade-off accepted for a single-user local tool).
- **Provider seam:** a new `SlackCredentialProvider` trait + `PersonalTokenProvider` reading `slack_user_token` from `SecretStore`, mirroring `LinearCredentialProvider`/`PersonalKeyProvider` and `GitHubCredentialProvider`/`PatProvider`. This is the OAuth-later **and** multi-workspace-later seam.
- **Webview rule (unchanged, `requirements.md` §3):** the token transits the webview once (user pastes it in Settings), goes through IPC, and is **never** returned to TS, never persisted in browser storage / SQLite / logs / query caches. The Settings save uses a **direct async call** (not a TanStack mutation, whose `variables` would be cached) and clears the input immediately.
- **No token:** `get_slack_status` returns `NotConfigured`; the board renders a "Connect Slack" empty state linking to Settings — no error.

## 4. Backend — `src-tauri/src/slack/` module

New module mirroring `github/`:

- **`mod.rs`** — `SlackClient` (a `reqwest::Client` against `https://slack.com/api/`), `SlackError` (sanitized variants: `Network`, `Auth`, `RateLimited(Option<i64>)`, `Malformed`, `Server`, `Api(String)`), the response interpreter (§4.6), and the `SlackCredentialProvider` trait + `PersonalTokenProvider`.
- **`client.rs`** — typed wrappers over the Web API methods used: `auth.test`, `users.conversations`, `conversations.info`, `conversations.history`, `conversations.replies`, `users.info`.
- **`catchup.rs`** — pure, unit-testable logic: unread computation, mention detection, thread rollup, snippet/identity assembly. No I/O.
- **`sync.rs`** — orchestrates a refresh and commits transactionally (§4.5).

> **Live API wins (`requirements.md` §0):** the Slack field/method names below are accurate to current docs but **must be verified against live responses** during implementation (Slack returns `ok: false` + an `error` string rather than HTTP error codes — see §4.6).

### 4.1 Identity bootstrap

On token set (and lazily if missing), call **`auth.test`** → `{ user_id, team_id, url, user }`. Persist `slack_user_id`, `slack_team_id`, `slack_workspace_url`, `slack_workspace_name` (the latter from `team.info` if needed) in the `settings` table, mirroring how the Linear/GitHub viewer identity is cached. These drive: self-mention detection (`user_id`), self-message exclusion, deep-link construction (`team_id`/`url`), and the board header.

### 4.2 Conversation enumeration

Use **`users.conversations`** (not workspace-wide `conversations.list`) to fetch only the conversations the viewer is a member of:
`users.conversations(types=public_channel,private_channel,im,mpim, exclude_archived=true, limit≤1000)`, cursor-paged. For the user's setup (~5 channels + DMs) this is one page. Each is classified into `kind`: `channel` (public/private), `dm` (im), or `group_dm` (mpim).

### 4.3 Unread computation per surface

For each conversation, fetch `conversations.info` to read the per-user **`last_read`** marker and (for DMs/group-DMs) `unread_count_display`:

- **DMs & group DMs** (`im`/`mpim`): `unread_count_display` is returned directly by Slack for these types — use it as the authoritative unread count. Fetch the unread bodies via `conversations.history(channel, oldest=last_read, inclusive=false)`.
- **Channels** (public/private): Slack does **not** return an unread count for channels. Compute it: `conversations.history(channel, oldest=last_read, inclusive=false)` → the returned messages are the unread set; the count is their length **after excluding your own messages** (`user == slack_user_id`) and join/leave-type system subtypes. `latest_ts` and `latest_snippet` come from the most recent unread message.
- **Self-exclusion:** messages authored by the viewer are never "unread for me" and are excluded from counts and the reader (they may still render as context in a thread, see §4.4).

Cap history per conversation at a sane page (e.g. 100, the API max per page) — given the small footprint, deeper backfill is unnecessary; if a conversation has >100 unread, show "100+".

### 4.4 Threads (best-effort)

With only a handful of member channels this is tractable and near-complete, though Slack exposes **no per-user thread read marker** via the official API — so thread-unread is a documented heuristic:

- A thread is a candidate when a channel message has `reply_count > 0` and `latest_reply` ts is **newer than the channel `last_read`**.
- For each candidate, call `conversations.replies(channel, ts)`; the **unread replies** are those with ts `> last_read` and `user != slack_user_id`. `unread_replies` = their count; `has_mention` if any mentions the viewer.
- Surface a thread in the **Threads** bucket when `unread_replies > 0`. Limitation (documented in-UI and in code comments): because we approximate the thread read-marker with the channel `last_read`, a thread you'd already opened in Slack after reading the channel may still appear. Acceptable for v1.

### 4.5 Mentions (derived, no search API)

Mentions are a **view over the already-fetched unread messages** (channel history + DM history + thread replies), not a separate fetch. A message `is_mention` when its `text` contains any of:
- `<@SLACK_USER_ID>` (a direct @-mention of the viewer),
- `<!here>`, `<!channel>`, `<!everyone>` (broadcast mentions in a conversation the viewer is a member of).

(`<!subteam^…>` user-group mentions are **out** for v1 — they'd require `usergroups.list` to know the viewer's groups; revisit later.) Any unread DM also counts as direct attention but is shown in the DMs bucket, not duplicated into Mentions; the Mentions bucket is for channel/thread messages that name you. The Mentions bucket is rendered by filtering `slack_messages WHERE is_mention = 1 AND is_unread = 1`.

### 4.6 Sync, pruning & failure handling

`sync_slack_catchup` refreshes the cache as one logical unit, transactionally:

1. Bootstrap identity (§4.1) if needed; enumerate conversations (§4.2).
2. For each conversation, fetch info + unread history (+ thread replies) into memory (§4.3–4.5), resolving unknown user ids via `users.info` (cached in `slack_users`).
3. **Only on full success**, in a single transaction: replace `slack_conversations` + `slack_messages` for the synced set and write `slack_sync_meta` (`last_synced_at`, counts). A per-conversation fetch failure aborts the whole refresh **without** touching the prior cache (the dataset is small enough that all-or-nothing is simplest and safe). Never leave the cache half-written.
4. Return a summary `{ synced: bool, conversation_count, unread_total, last_synced_at, stale: bool }` so the UI can show staleness.

**Rate-limit & error interpretation:** Slack signals success with **`ok: true`** in a `200 OK` body and failure with **`ok: false` + `error`** (e.g. `invalid_auth`, `not_authed`, `token_revoked` → `Auth`; `ratelimited`, or HTTP `429` with a `Retry-After` header → `RateLimited(reset)`; `missing_scope` → `Auth` with a sanitized hint; 5xx → `Server`). A non-`ok` body is always a failure even on HTTP 200. Slack history/replies methods are Tier-3 (~50 req/min); given ~5 channels a refresh is ~20–40 calls, comfortably under the limit. Back off on `RateLimited` and surface a non-blocking `goey-toast`, keeping cached rows visible.

### 4.7 Credential isolation

Mirrors the GitHub model:
- A dedicated Slack lock serializes `set_slack_token`, `clear_slack_token`, `test_slack_connection`, and `sync_slack_catchup`. A **generation guard** prevents an in-flight sync from committing under a token swapped mid-flight (capture token + generation counter at start; if changed by commit time, abort without writing).
- **Both setting and clearing** the token are an account switch: each wipes **only** Slack state — all `slack_conversations`, `slack_messages`, `slack_users`, `slack_sync_meta`, and the `slack_*` identity keys in `settings` — so a replaced token can never expose the previous account's cached messages or report its identity. The Linear and GitHub caches are never touched.
- **Fail-safe ordering:** while holding the Slack lock, wipe Slack cache/identity/meta and bump the generation **before** mutating the keychain. If the keychain mutation then fails, the cache is already empty.

## 5. Data model

New migration `src-tauri/migrations/0013_slack_catchup.sql`. Only the tables this iteration uses (`requirements.md` §3 DB rule). Threads and Mentions are **derived views over `slack_messages`**, not separate tables.

```sql
-- Conversations the viewer is a member of (channels + DMs + group DMs), with computed unread state.
CREATE TABLE slack_conversations (
  id              TEXT PRIMARY KEY,   -- Slack conversation id (Cxxxx | Dxxxx | Gxxxx)
  kind            TEXT NOT NULL,      -- channel | dm | group_dm
  name            TEXT,               -- channel name, or resolved DM partner name(s)
  partner_user_id TEXT,              -- for DMs: the other user's id (NULL otherwise)
  unread_count    INTEGER NOT NULL,   -- computed, excludes the viewer's own messages
  has_mention     INTEGER NOT NULL,   -- bool: any unread message here mentions the viewer / @here|channel|everyone
  unread_threads  INTEGER NOT NULL,   -- count of this conversation's threads with unread replies
  last_read_ts    TEXT,               -- Slack last_read marker captured at sync
  latest_ts       TEXT,               -- most recent unread message ts
  latest_snippet  TEXT,               -- preview text of the most recent unread message
  synced_at       TEXT NOT NULL
);
CREATE INDEX idx_slack_conv_kind ON slack_conversations(kind);

-- Cached unread (and thread-reply) message bodies, powering the in-app reader + the Threads/Mentions views.
CREATE TABLE slack_messages (
  conversation_id TEXT NOT NULL,
  ts              TEXT NOT NULL,      -- message ts, unique within a conversation
  thread_ts       TEXT,              -- parent ts if this is a threaded reply (NULL for top-level)
  user_id         TEXT,
  user_name       TEXT,
  user_avatar     TEXT,
  text            TEXT,              -- raw Slack mrkdwn (rendered client-side)
  is_mention      INTEGER NOT NULL,   -- bool
  is_unread       INTEGER NOT NULL,   -- bool
  linear_identifier TEXT,            -- uppercase Linear id extracted from text, nullable
  created_at      TEXT NOT NULL,      -- ISO derived from ts
  raw_json        TEXT,              -- full message node, for fields not yet modeled
  PRIMARY KEY (conversation_id, ts)
);
CREATE INDEX idx_slack_msg_conv ON slack_messages(conversation_id);
CREATE INDEX idx_slack_msg_thread ON slack_messages(thread_ts);
CREATE INDEX idx_slack_msg_mention ON slack_messages(is_mention);
CREATE INDEX idx_slack_msg_linear ON slack_messages(linear_identifier);

-- Render cache of Slack user identities.
CREATE TABLE slack_users (
  id        TEXT PRIMARY KEY,
  name      TEXT,                    -- display/real name
  avatar    TEXT,                    -- image_48 URL
  synced_at TEXT NOT NULL
);

-- Single-row sync bookkeeping (key/value, mirrors the github_sync_meta intent).
CREATE TABLE slack_sync_meta (
  key   TEXT PRIMARY KEY,            -- last_synced_at | conversation_count | unread_total
  value TEXT
);
```

- **`linear_identifier`** is extracted at sync time from each message `text` with the same case-insensitive, boundary-aware pattern the GitHub dashboard uses — `(?i)\b[A-Z][A-Z0-9]*-\d+\b` — then **normalized to uppercase**. As with GitHub, no Linear issue id is stored: the read command resolves it by **joining** `slack_messages.linear_identifier = issues.identifier`, so the chip follows Linear cache rebuilds and never goes stale.
- Viewer/workspace identity (`slack_user_id`, `slack_team_id`, `slack_workspace_url`, `slack_workspace_name`) lives in the existing `settings` table. **Token in keychain only** — never in these tables, logs, or the webview.

## 6. Commands — `src-tauri/src/commands/slack.rs`

New handler file (kept out of the large `commands/mod.rs`). Thin `#[tauri::command]` wrappers over unit-testable async `_logic` fns, registered in `lib.rs` via `generate_handler![...]`. (Custom commands need no `capabilities/default.json` entry, consistent with existing Linear/GitHub commands.)

- `set_slack_token(token)` — account switch: store the new token in the keychain **and** wipe prior Slack state (§4.7), then bootstrap identity (§4.1). Leaves Linear/GitHub caches intact.
- `clear_slack_token()` — delete the keychain entry and wipe all Slack state. Leaves Linear/GitHub intact.
- `get_slack_status()` → `SlackStatus` (`NotConfigured` | `Unverified` | `Connected { workspace_name, user_name }`), mirroring `ConnectionStatus`/`GitHubStatus`. **Offline:** derived purely from keychain presence + cached `settings`; never hits the network.
- `test_slack_connection()` — the only status command that hits the network: call `auth.test`, cache identity, return `Connected`.
- `sync_slack_catchup()` → the §4.6 refresh summary. Acquires the Slack lock; disabled-effectively when `NotConfigured`.
- `get_slack_catchup()` → the board payload: conversations grouped by `kind` with counts + `latest_snippet`, plus a derived **Mentions** list and **Threads** list (both read from `slack_messages`), plus `slack_sync_meta`. Each message/row carries `linear_issue_id` via the §5 join. **Offline** (reads cache only).
- `get_slack_conversation_messages(conversation_id)` → cached unread messages for the expand-to-read panel (ordered, with resolved user identity), each enriched with `linear_issue_id`.
- `slack_deep_link(conversation_id, ts?)` → builds the `slack://channel?team=<team_id>&id=<conversation_id>[&message=<ts>]` URL (Rust owns `team_id`); the frontend opens it via the Tauri opener. (A `https://<workspace>.slack.com/archives/<id>/p<ts>` web fallback is returned alongside for when the desktop app is absent.)

All errors are sanitized (`CmdError`); no raw reqwest/Slack/keyring diagnostics cross IPC.

## 7. Frontend — `src/features/slack/`

### 7.1 Navigation wiring
- Add `"slack"` to `ViewKind`/`VIEWS` in `src/lib/paneModel.ts`.
- Add a `slack` entry to `NAV`/`META` in `src/components/Dock.tsx` (a `MessageSquare`/`Slack` lucide icon, label "Slack"), plus a command-palette "Go to Slack" action.
- Add a `case "slack"` in `src/components/SplitLayout.tsx` rendering `<SlackPage/>`.

### 7.2 Components
- **`SlackPage.tsx`** — header (workspace name + last-synced + manual refresh), then sections ordered by signal: **Mentions → DMs → Threads → Channels**, each with a live count. Dense/calm Linear aesthetic (hairline borders, indigo accent), designed via the **`ui-ux-pro-max`** skill. "Connect Slack" empty state when `NotConfigured`; a quiet stale indicator when the last sync failed.
- **`SlackRow.tsx`** — per conversation/thread/mention: kind icon, name (channel `#name`, DM partner, or thread root snippet), unread count, latest snippet, author, relative time. A mention/thread badge where relevant. Click → expand.
- **`SlackReader.tsx`** — the expanded read-only message list for a row: renders cached unread messages (Slack **mrkdwn** → rendered markdown, emoji, `<@id>`/`<#id>` resolved to names, avatars). A **Linear chip** when a message carries `linear_issue_id` → calls the workspace context's `openIssueTab(issueId)` (reusing the GitHub dashboard mechanism). An **"Open in Slack"** button → `slack_deep_link` → Tauri opener.

### 7.3 Cache-vs-sync data flow (offline-first)
`SlackPage` separates the cached read from the network sync, exactly like `PrsPage`:
- A `get_slack_catchup` query renders immediately from SQLite.
- A background `sync_slack_catchup` query runs on mount and on a **5-minute interval** (matching the Linear/GitHub sync default), plus a manual refresh button; **disabled while status is `NotConfigured`** (gated on `get_slack_status`).
- On sync success, invalidate `get_slack_catchup` (and any open `get_slack_conversation_messages`) so the UI picks up fresh rows.
- On sync failure, keep the stale cached rows with a quiet `goey-toast`/inline warning.

### 7.4 Settings
Add a **Slack** section to the Settings screen (alongside Linear/GitHub): a token input using the **direct async call** pattern (never a cached mutation; clear the input immediately on save), a connection status line, and a "Disconnect" action calling `clear_slack_token`. Documents the requested scopes and that v1 is read-only.

Bindings and types added to `src/lib/commands.ts`.

## 8. Testing

**Rust (`cargo test`):**
- `auth.test`/response parsing; `ok:false` → correct `SlackError` mapping (`invalid_auth`/`token_revoked` → `Auth`, `ratelimited`/429 → `RateLimited` with `Retry-After`, `missing_scope` → sanitized `Auth`, 5xx → `Server`).
- Unread computation: DM `unread_count_display` honored; channel unread = history-after-`last_read` minus the viewer's own messages and join/leave subtypes; "100+" cap.
- Mention detection: `<@SELF>`, `<!here|channel|everyone>` match; another user's mention does not; `<!subteam^…>` does not (v1).
- Thread rollup: candidate selection (reply_count + latest_reply > last_read), unread-reply counting, self-reply exclusion, `has_mention` on a reply.
- Linear identifier extraction + uppercase normalization + word-boundary false-positives (`xENG-123y` no match), and read-time join resolution (no chip unless it joins a cached issue).
- Sync atomicity: a mid-refresh fetch failure leaves the prior cache intact (no half-write); generation guard aborts a swapped-token commit.
- Credential isolation: set-token and clear-token each wipe only Slack state; Linear/GitHub caches untouched.
- `get_slack_status` is offline (no network); `test_slack_connection` calls `auth.test`.
- Deep-link construction (channel and message variants; web fallback).

**Frontend (Vitest):**
- Section rendering + counts; bucket order (Mentions → DMs → Threads → Channels).
- No-token connect prompt; stale-cache (warning + cached rows) state.
- Expand-to-read renders cached messages; mrkdwn/mention/emoji rendering basics.
- Linear-chip → issue-tab navigation.
- "Open in Slack" invokes the deep-link command/opener.
- Background refresh / query invalidation behavior.

## 9. `requirements.md` updates (part of implementation)

Slack is currently tagged `[EXT]`/Phase 2 throughout. The implementation should reflect that iteration 1 is now in-scope **without** overclaiming the deferred parts:
- **§1/§2** — note that the Slack catch-up board (read-only unreads: mentions/DMs/threads/channels) is now Phase 2 iteration 1; huddles, reply, and mark-as-read remain `[EXT]`.
- **§4** — add the Slack user-token auth subsection (scopes, keychain account `slack_user_token`, provider seam).
- **§5** — add the `slack_conversations` / `slack_messages` / `slack_users` / `slack_sync_meta` tables.
- **§6** — add the poll-on-open + 5-min background sync + all-or-nothing transactional refresh.
- **§10/§11** — add the `slack/` Rust module and a new milestone line for the catch-up board.
- **§14** — narrow the Slack non-goal to the still-deferred parts (huddles, write actions, multi-workspace, OAuth).

## 10. Acceptance criteria

1. With a valid token, the board populates four sections — Mentions, DMs (incl. group DMs), Threads, Channels — each with correct unread counts; the viewer's own messages are never counted as unread.
2. DM unread counts match Slack's own (`unread_count_display`); channel unread counts equal the post-`last_read` messages excluding self/system.
3. Clicking a row expands the actual unread messages in-app, read-only and rendered; an "Open in Slack" button deep-links into the native client at that conversation/message.
4. A message containing a Linear identifier present in the cache shows a chip that opens that issue's tab.
5. With no token, the board shows a "Connect Slack" prompt and no errors.
6. A sync failure (network/rate-limit/partial fetch) leaves the previous cache intact and shows a quiet warning; the cache is never left half-written.
7. Setting **or** clearing the Slack token wipes only Slack state (conversations, messages, users, meta, identity) and never disturbs the Linear or GitHub caches; a replaced token never exposes the previous account's messages or identity.
8. The token is accepted transiently from the Settings input, sent directly over IPC, immediately cleared from component state, and never returned to the renderer or retained in browser storage, SQLite, logs, or query caches.
9. The board opens and renders from cache with no network (offline-first).
10. Rust + Vitest suites pass; `npx tsc --noEmit` clean.

## 11. Iteration 2 seam — huddles (not built now)

Leave room, build nothing: a future `slack/socket.rs` opens a **Socket Mode** connection (app-level `xapp-` token) and subscribes to **`user_huddle_changed`**, writing active-huddle state into a `slack_huddles` table surfaced as a 5th **"Live now"** board section. This is the only way the official API exposes huddles — events while connected, with no cold "list active huddles" call — so it requires the always-on background presence we declined for v1. The `catchup` module's section model and the dock view accommodate an added section without rework; the `SlackCredentialProvider` trait already abstracts the credential. Do not build, do not block.
