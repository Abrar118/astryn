# Microsoft Teams Chat Provider + Provider-Neutral Chat Board (Module Spec 2, part b)

**Status:** Approved by waiver (owner delegated decisions, 2026-10-28). Decisions are
recorded as *Rulings* below and in the PR description.
**Requirement:** `requirements.md` §3 *Module architecture*; module-system spec
(`2026-10-27-module-system-design.md`) roadmap row 2 ("provider-agnostic chat
surfaces; first second provider").
**Builds on:** `2026-06-23-slack-catch-up-board-design.md`,
`2026-06-23-slack-session-token-auth-design.md`.

## 1. Summary

Two things ship together:

1. **Provider-neutral chat surfaces.** The catch-up board UI (sections, rows,
   read-only reader, Linear chip, "Open in …" action) moves out of
   `features/slack/` into `features/chat/` and takes a small `ChatProvider`
   adapter. The wire shape the board renders becomes a neutral `ChatCatchup`
   type in `lib/commands.ts`; the Slack types become aliases of it. Slack keeps
   its own dock entry, page, commands, tables, and behavior — unchanged.
2. **Microsoft Teams as a second `chat` provider module** (`teams`). A Rust
   `teams/` module talks to Microsoft Graph with a delegated OAuth token obtained
   through the device-code flow, caches unread chat messages in two new SQLite
   tables, and powers a Teams catch-up board through the same `features/chat/`
   components.

## 2. Goals and non-goals

**Goals**

- A `teams` provider module (provides `chat`) that follows the module rule:
  `ModuleId::Teams`, manifest entries in Rust and TS, `state.require(Teams)?`
  first in every owned command, gated query hooks, a `teams` view in `VIEW_META`,
  a Settings → Teams section, and Remove-module-data support.
- Unread Teams **chats** (1:1, group, meeting chats) with true unread counts,
  @mentions of the viewer, an in-app read-only reader, Linear chips, and an
  "Open in Teams" link.
- Offline-first, all-or-nothing cache refresh with the same generation guard
  and lock discipline as Slack.
- Tokens only in the OS keychain; never returned to TS, never logged.

**Non-goals**

- Teams **channel** messages (see Ruling R3).
- Writing to Teams (reply, mark-as-read), presence, calls/meetings.
- Merging Slack and Teams into one combined board or dashboard aggregation of
  Teams (Ruling R7).
- Multi-tenant / multi-account Teams.

## 3. Rulings

- **R1 — Auth flow: OAuth 2.0 device authorization grant** against the Microsoft
  identity platform v2 endpoints, with a **user-supplied Application (client) ID**
  of a public-client app registration ("Allow public client flows" on) and an
  optional tenant (default `organizations`). No client secret, no redirect URI,
  no local HTTP listener, no new Tauri capability: the user opens the
  verification URL (`https://microsoft.com/devicelogin`, an `https` URL already
  allowed by `opener:default`) and types the code. Auth-code + PKCE was rejected
  because it needs a loopback listener or a custom URI scheme (new capability,
  more attack surface) for no benefit to a single-user desktop tool.
- **R2 — Delegated scopes:** `offline_access User.Read Chat.Read`. All three are
  user-consentable (no admin consent). `Chat.Read` covers listing chats with the
  per-user `viewpoint` read marker and listing chat messages.
- **R3 — Chats only in v1.** Graph exposes **no per-user read marker for channel
  messages**, and reading them needs `ChannelMessage.Read.All`, which requires
  tenant-admin consent; requesting it would make sign-in fail for most users.
  The Teams board therefore shows **Mentions** and **Chats**; the Threads and
  Channels sections are Slack-only. Channel coverage is a clean later seam
  (another fetch feeding the same tables with `kind = 'channel'`).
- **R4 — Refresh token in the keychain, chunked.** The refresh token is the only
  stored secret. Windows Credential Manager caps a password at 2,560 bytes of
  UTF-16 (1,280 chars; `keyring` 3.6 enforces this) and Entra refresh tokens can
  exceed that, so the token is split into ≤1,000-char chunks under accounts
  `teams_refresh_token.0` … `teams_refresh_token.7` (service `com.orion.astryn`).
  Stale higher chunks are deleted on every write. Access tokens are **never
  persisted**: each sync/test redeems the refresh token for a fresh access token
  (one extra request per 5-minute poll) and stores the rotated refresh token.
- **R5 — Client ID and tenant are configuration, not secrets:** stored in the
  `settings` table (`teams_client_id`, `teams_tenant`), validated before use
  (client ID must be a GUID; tenant must be `organizations`, `common`, a GUID, or
  a domain-like name of `[A-Za-z0-9.-]`) so nothing user-typed is spliced
  unchecked into the login URL path.
- **R6 — Read model.** A chat is a candidate when its `lastMessagePreview` is
  newer than `viewpoint.lastMessageReadDateTime` and was not sent by the viewer.
  For candidates, the newest 50 messages (`$top=50&$orderby=createdDateTime
  desc`, the documented maximum) are fetched and filtered client-side to
  user messages (`messageType = message`, not deleted) newer than the read
  marker and not authored by the viewer. A mention is a `mentions[]` entry whose
  `mentioned.user.id` is the viewer, or a `mentioned.conversation` entry
  (@everyone-style); tag mentions are out (like Slack's `subteam`). Message HTML
  is reduced to plain text in Rust (tags stripped, `<at>` kept as text,
  common entities decoded).
- **R7 — Separate Teams view, no dashboard aggregation yet.** Teams gets its own
  dock entry and page beside Slack ("Slack behavior must be unchanged"). The
  dashboard keeps reading Slack only; adding Teams to its attention queue and KPI
  tiles is follow-up work.
- **R8 — Open in Teams uses https deep links** (`chat.webUrl` from Graph for a
  chat; `https://teams.microsoft.com/l/message/{chatId}/{messageId}?context=…`
  for a message), built and validated in Rust (must be `https://teams.microsoft.com/`).
  No `msteams:` scheme, so no capability change.
- **R9 — Paging cap.** Chats are listed `$expand=members,lastMessagePreview`,
  ordered by `lastMessagePreview/createdDateTime desc`, at most 4 pages of 50
  (200 most recently active chats). `@odata.nextLink` is followed only when it
  stays on `https://graph.microsoft.com/` so the bearer token can never be sent
  to another host.
- **R10 — Live verification pending.** There is no Microsoft tenant available
  while building. Every Graph/identity shape is taken from the official docs
  (List chats, List chat messages, chatMessage resource, device-code flow) and
  covered by fixture-based unit tests. A live sign-in and sync against a real
  tenant is required before relying on it (in particular: the combined
  `$expand=members,lastMessagePreview` + `$orderby` request, the deep-link format,
  and Conditional Access policies that block device-code sign-in).
- **R11 — Legacy upgrade path.** A pre-module install that upgrades directly
  enables every module that existed before modules (`ModuleId::ALL` minus
  `teams`), so it does not suddenly show a Teams dock entry.

## 4. Rust design

### 4.1 Registry

`modules/mod.rs`: `ModuleId::Teams` (`"teams"`), manifest entry
`{ kind: Provider, provides: [Chat] }`, owned commands mapped in
`command_owner`, `get_teams_status` added to `CORE_COMMANDS` (status commands are
exempt so Settings can describe a disabled module).

### 4.2 `teams/` module

- `mod.rs` — `TeamsError` (`Network | Auth | RateLimited(Option<i64>) |
  Malformed | Server | Api(String)`), Graph status interpretation (401/403 →
  `Auth`, 429 → `RateLimited(Retry-After)`, 5xx → `Server`), the
  `TeamsCredentialProvider` seam (`refresh_token()` / `save_refresh_token()` /
  `clear()`) with the keychain-backed `KeychainTokenProvider` (chunked, R4), and
  `GraphClient` (HTTP for the Graph API and the identity platform, 20 s timeout).
- `oauth.rs` — pure parsing/validation: device-code response, token-endpoint
  response (`Granted | Pending | SlowDown | Declined | Expired | Failed`),
  client-ID/tenant validation.
- `catchup.rs` — pure parsing and read-model logic: `/me`, chats page (+ next
  link), messages page, HTML → text, unread filtering, mention detection, chat
  display names.

### 4.3 Data model — migration `0035_teams_catchup.sql`

```sql
CREATE TABLE teams_chats (
  id             TEXT PRIMARY KEY,   -- Graph chat id
  kind           TEXT NOT NULL,      -- dm | group_dm
  name           TEXT,               -- topic, or the other members' names
  unread_count   INTEGER NOT NULL,
  has_mention    INTEGER NOT NULL,
  latest_at      TEXT,               -- newest unread message createdDateTime
  latest_snippet TEXT,
  web_url        TEXT,               -- chat.webUrl (Open in Teams)
  synced_at      TEXT NOT NULL
);
CREATE TABLE teams_messages (
  chat_id           TEXT NOT NULL,
  id                TEXT NOT NULL,   -- Graph message id
  user_id           TEXT,
  user_name         TEXT,
  text              TEXT,            -- plain text derived from the HTML body
  is_mention        INTEGER NOT NULL,
  linear_identifier TEXT,
  created_at        TEXT NOT NULL,
  PRIMARY KEY (chat_id, id)
);
CREATE INDEX idx_teams_msg_mention ON teams_messages(is_mention);
```

`chatType` maps `oneOnOne → dm`, `group`/`meeting` (and unknown) → `group_dm`.
Identity (`teams_user_id`, `teams_user_name`) and `teams_last_synced_at` live in
`settings`. Only messages that are unread are stored, so no `is_unread` column.
The read queries alias columns to the neutral board shape
(`conversationId, ts, threadTs, userId, userName, userAvatar, text, isMention,
linearIdentifier, linearIssueId, createdAt`), with `linearIssueId` from a
`LEFT JOIN issues` only while a tracker is active (spec 1 §4.4).

### 4.4 Commands — `commands/teams.rs`

| Command | Notes |
|---|---|
| `start_teams_sign_in(clientId, tenant?)` | Validates, requests a device code, keeps `device_code` in memory only, returns `{ userCode, verificationUri, expiresIn, interval, message }`. |
| `poll_teams_sign_in()` | One token request. `pending` → `{ state: "pending", interval }`. Granted → account switch: wipe Teams cache + bump generation, save config, store refresh token, call `/me`, save identity → `{ state: "connected", userName }`. Declined/expired → sanitized error. |
| `cancel_teams_sign_in()` | Drops the pending device code. |
| `clear_teams_account()` | Wipe cache + bump generation, then delete keychain chunks. |
| `get_teams_status()` *(core)* | Offline: `not_configured | unverified | connected { userName }`. |
| `test_teams_connection()` | Refresh + `/me`, caches identity. |
| `sync_teams_catchup()` | Lock; refresh; list chats; fetch unread candidates; generation check; one transaction. |
| `get_teams_catchup()` | Cache read → `ChatCatchup` shape (`threads: []`). |
| `get_teams_chat_messages(conversationId)` | Cache read for the reader. |
| `teams_open_link(conversationId, messageId?)` | Validated https URL (R8). |

All use `teams_lock` for credential mutations and sync; errors map to sanitized
`CmdError::{TeamsNotConfigured, TeamsApi, TeamsSignInFailed, Network,
RateLimited}`. `set_enabled_modules` bumps `teams_generation` when Teams is
disabled; `remove_module_data(teams)` deletes the tables, identity, config and
keychain chunks.

## 5. Frontend design

- `lib/commands.ts`: neutral `ChatConversation`, `ChatMessage`, `ChatThread`,
  `ChatCatchup`, `ChatSyncSummary`; Slack types alias them; Teams types and
  bindings; `ModuleId` gains `"teams"`.
- `features/chat/`: `ChatProvider` adapter (`name`, `openLabel`,
  `open(conversationId, ts?)`, `loadMessages(conversationId)`, `sections`,
  `chatsLabel`), `CatchupBoard` (header, refresh, stale warning, connect empty
  state, sections), `ChatRows` (conversation, mention, thread rows with the
  Linear chip and the open action), `ChatReader`.
- `features/slack/`: `SlackPage`, `SlackRow`, `SlackReader` become thin adapters
  over `features/chat/` with identical markup, labels, and behavior (existing
  Slack tests pass unchanged).
- `features/teams/TeamsPage.tsx`: Teams adapter; shows Mentions + Chats.
- Settings → Teams: client ID + tenant inputs, **Sign in with Microsoft** →
  shows the code and an "Open sign-in page" button, polls until connected,
  **Cancel**, **Test connection**, **Disconnect**. Explains the app-registration
  prerequisites and that the board is read-only.
- `queries.ts`: `useTeamsStatus`, `useTeamsCatchup`, `useTeamsSync` (5-min poll),
  `clearTeamsQueries`, all gated by `isActive("teams")`.
- Registry: `VIEW_META.teams`, `MODULE_MANIFEST.teams`, `MODULE_COPY.teams`,
  `CAPABILITY_PROVIDERS.chat` mentions both providers, `paneModel` view,
  `SplitLayout` case, Settings nav entry.

## 6. Testing

**Rust:** OAuth parsing (all poll outcomes), client-ID/tenant validation, Graph
status/error mapping, chunked token store (round trip, long token, stale chunk
cleanup, clear), chats/messages/me fixture parsing (doc samples), HTML → text,
unread/mention rules, chat naming, next-link host guard, open-link validation,
DB replace/wipe/identity/Linear join, sync logic (populate, all-or-nothing on
failure, generation abort), sign-in poll account switch, remove-module-data,
guard coverage.
**Frontend:** chat components render both providers, Teams page sections and
connect prompt, Teams Settings device-code flow (code shown, polling, client ID
cleared on success), module gating of Teams hooks, Slack tests unchanged.
**Manual (pending):** live tenant sign-in and sync (R10); desktop run.
