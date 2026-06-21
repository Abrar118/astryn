# M4 — GitHub PR Dashboard (revamped F7)

**Status:** Design approved (2026-06-22). Supersedes the original issue-drawer-centric F7 in `requirements.md`.

## 1. Summary

A standalone, dedicated **PR dashboard** centered on *you* (the authenticated GitHub user), spanning every repository you can access — personal, organization, and collaborations. It replaces the original F7 design (per-issue PR badges in the Linear issue drawer), which is dropped.

The page has four sections — **Needs my review**, **My open PRs**, **Assigned to me**, **Involved/mentioned** — each listing open pull requests with title, number, author, comment count, status badges (open/draft, CI, conflict), and review state. When a PR's branch or title carries a Linear issue identifier (e.g. `ENG-123`), the row shows a chip that opens that issue's tab inside Astryn.

This keeps Astryn's hard architectural rule: all GitHub API calls happen in Rust; the webview is a pure consumer of cached data + typed Tauri commands. The token is accepted transiently from the Settings input, sent directly over IPC, immediately removed from component state, and never returned to the renderer or retained in browser storage, SQLite, logs, or query caches.

## 2. Goals & non-goals

**Goals**
- One place to see (up to the 300 most recently updated) open PRs that involve you per bucket, across all accessible repos and orgs.
- Surface PRs awaiting your review, and your own PRs that have received reviews / changes-requested.
- Offline-first: the page opens instantly from the local cache, then refreshes in the background.
- Degrade gracefully with no GitHub token (a quiet "Connect GitHub" prompt, never an error).
- A convenience link from a PR back to its Linear issue when the identifier is obvious.

**Non-goals**
- No per-issue PR badges in the Linear issue drawer (dropped from the original F7).
- No writing to GitHub (no merge/approve/comment) — read-only dashboard.
- No PR detail/diff view inside Astryn — rows link out to github.com.
- No OAuth (a classic PAT is used; the credential provider is trait-backed for an OAuth-later seam).

## 3. Authentication & secrets

- **Token:** a GitHub **classic personal access token**, stored in the OS keychain via the existing `SecretStore` trait. Keychain service `com.orion.astryn`, new account `github_token`. Header sent as `Authorization: Bearer <token>`.
- **Scopes:** `repo` (for private-repository visibility). Add `read:org` **only if** organization/team membership is queried or testing proves it is required for the target search results. The Settings UI documents that a classic `repo` token grants broad read/write repository access (trade-off accepted for a single-user local tool), and notes that organizations enforcing **SAML SSO** require the token to be explicitly authorized for those orgs.
  - This is a documented `[CHOICE]` override of the spec's original fine-grained-PAT default. Reason: fine-grained tokens are scoped to specific repos/orgs and require org opt-in, so they cannot reliably cover "any repo I collaborate on"; a classic token sees everything the user can access in one credential.
- **Provider seam:** a new `GitHubCredentialProvider` trait + `PatProvider` reading `github_token` from `SecretStore`, mirroring `LinearCredentialProvider`/`PersonalKeyProvider`. This is the OAuth-later seam.
- **Webview rule (unchanged):** the token transits the webview once (user pastes it in Settings), goes through IPC, and is **never** returned to TS, never persisted in browser storage / SQLite / logs / query caches. The Settings save uses a direct async call (not a TanStack mutation), and clears the input immediately.
- **No token:** `get_github_status` returns `NotConfigured`; the dashboard renders a "Connect GitHub" empty state linking to Settings. This satisfies the F7 AC ("with no token the feature degrades to a connect prompt without errors").

## 4. Backend — `src-tauri/src/github/` module

New module mirroring `linear/`:

- **`mod.rs`** — `GitHubClient` (a `reqwest::Client` against the GraphQL endpoint `https://api.github.com/graphql`), `GitHubError` (sanitized variants: `Network`, `Auth`, `RateLimited(Option<i64>)`, `Malformed`, `Server`, `Api(String)`), the response interpreter (see §4.6), and the `GitHubCredentialProvider` trait + `PatProvider`.
- **`prs.rs`** — GraphQL query construction, parsing, and the bucket definitions.
- Connection check: `viewer { login }` for `test_github_connection` only (`get_github_status` is offline — see §6).

### 4.1 Buckets & search queries

Each bucket is a GitHub GraphQL `search(type: ISSUE, query: ...)` over open PRs, using `@me` filters so the viewer's login need not be interpolated:

| Bucket | `bucket` value | Search query |
| --- | --- | --- |
| Needs my review | `needs_review` | `is:pr is:open review-requested:@me sort:updated-desc` |
| My open PRs | `mine` | `is:pr is:open author:@me sort:updated-desc` |
| Assigned to me | `assigned` | `is:pr is:open assignee:@me sort:updated-desc` |
| Involved/mentioned | `involved` | `is:pr is:open involves:@me -author:@me -assignee:@me -review-requested:@me sort:updated-desc` |

Every query carries `sort:updated-desc` so the per-bucket cap (§4.3) yields a deterministic, stable subset (the most recently updated PRs) rather than an unstable relevance-ranked one.

**Bucket overlap is resolved explicitly:** `involved` never overlaps the other buckets — it is the *remainder*, `involves:@me` minus authored/assigned/review-requested via negative qualifiers. Overlap among `needs_review`, `mine`, and `assigned` is intentional and allowed (a PR you authored that's also assigned to you appears in both); rows are deduped only within a single bucket.

### 4.2 Fields per PR node

For each `PullRequest` node: `number`, `title`, `url`, `isDraft`, `mergeable` (→ conflict flag), `author { login, avatarUrl }`, `comments { totalCount }`, `reviewDecision`, `repository { nameWithOwner }`, `headRefName` (branch), `updatedAt`, and the head-ref **status-check rollup** for CI. (`state` is not stored — every cached row is open, per §5.)

- **CI rollup:** use the PR's head-ref status-check rollup, **verified against the live schema** during implementation — prefer a direct `PullRequest.statusCheckRollup { state }` if the live schema exposes it, otherwise fall back to `commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }`. Roll up to `success | failure | pending | none`. (Per the repo's "live API wins — introspect before trusting field names" rule.)
- **`review_decision`:** this is the PR's **overall** review status (`APPROVED` / `CHANGES_REQUESTED` / `REVIEW_REQUIRED` / `null`), **not** the current viewer's personal review decision. It is stored and rendered as-is, and `null` is preserved (null does **not** mean `REVIEW_REQUIRED`). This overall status is exactly what serves the user's requirement "show if my own PRs have changes requested": a `CHANGES_REQUESTED` value on a `mine`-bucket row. No per-viewer review query is needed.

### 4.3 Pagination

GitHub GraphQL connections return at most 100 nodes per page and require cursor pagination. Each bucket is fetched by paging on `pageInfo { hasNextPage endCursor }` until exhausted **or** an explicit safety cap of **300 PRs per bucket** is reached. The milestone goal is therefore "the **300 most recently updated** PRs per bucket," not literally every PR. "One query per bucket" holds only for buckets of ≤100 results; larger buckets issue follow-up paged queries.

**Truncation must be persisted, not inferred from row count.** A bucket with exactly 300 cached rows is indistinguishable from a truncated one by count alone. So per-bucket sync metadata — `{ fetched_count, truncated, last_synced_at }` — is persisted (a small `github_sync_meta` table keyed by `bucket`) and returned by `list_github_prs`, so the "showing the 300 most recent" note survives an app restart.

### 4.4 Sync, pruning & failure handling

`sync_github_prs` refreshes the cache **per bucket, independently and transactionally**:

1. Fetch **all pages** for the bucket into memory first.
2. Only on full success, in a single transaction: upsert the fetched rows and **prune** rows for *that bucket* that were not in the result set.
3. If any page fails (network, rate-limit, auth), **abort that bucket** and leave its prior cache untouched. Never prune globally on partially fetched results.

This guarantees a page-2 failure or a rate-limit never empties a bucket. Buckets are independent: one failing does not roll back another's successful refresh. The command returns a per-bucket status so the UI can show which sections are stale. Rate-limit and error classification is handled per §4.6.

### 4.5 Credential isolation

- A dedicated GitHub lock (separate from any Linear sync lock) serializes `set_github_token`, `clear_github_token`, `test_github_connection`, and `sync_github_prs`. A generation guard prevents an in-flight sync from committing under a token swapped mid-flight: capture the token (and a credential generation counter) at the start of a sync; if it changed by commit time, abort without writing.
- **Both setting and clearing** the GitHub token are treated as an account switch: each wipes **only** GitHub state — all `github_prs` rows, `github_sync_meta`, and the `github_login` setting — so a replaced token can never expose the previous account's cached PRs or report its login via `get_github_status`. The Linear workspace cache is never touched.
- **Fail-safe ordering:** while holding the GitHub lock, wipe the GitHub cache/login/meta and increment the credential generation **before** mutating the keychain (set or delete) the token. If the keychain mutation then fails, the cache is already empty — the prior account's data is never left behind alongside a changed/absent token.

### 4.6 Rate-limit & error interpretation

GitHub's GraphQL API reports limits differently from plain REST, so the interpreter must not rely on status codes alone (per [GitHub's GraphQL rate-limit docs](https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api)):

- **Parse the GraphQL `errors` array even on HTTP 200.** Primary rate-limit and many query errors arrive as `200 OK` with a non-empty `errors` array (e.g. `type: "RATE_LIMITED"`). A non-empty `errors` array is a failure; a `RATE_LIMITED`/throttle error maps to `RateLimited`.
- **Inspect headers** `x-ratelimit-remaining`, `x-ratelimit-reset`, and `retry-after` to populate the `RateLimited` reset hint.
- **403** may be a *secondary* rate limit (treat as `RateLimited` when `retry-after` / `x-ratelimit-remaining: 0` indicates throttling) **or** an auth/API failure otherwise (`Auth`). 401 is always `Auth`. 5xx → `Server`.
- Backoff on `RateLimited` and surface a non-blocking `goey-toast`, keeping cached rows visible.

## 5. Data model

New migration `src-tauri/migrations/0009_m4_github_prs.sql`. The original spec's issue-centric `github_prs` is reworked to be viewer/bucket-centric:

```sql
CREATE TABLE github_prs (
  id                TEXT NOT NULL,     -- "owner/repo#number"
  bucket            TEXT NOT NULL,     -- needs_review | mine | assigned | involved
  repo              TEXT NOT NULL,     -- "owner/name"
  number            INTEGER NOT NULL,
  title             TEXT,
  draft             INTEGER,           -- bool (every cached row is an OPEN PR; see note)
  mergeable         TEXT,              -- mergeable | conflicting | unknown
  ci_status         TEXT,              -- success | failure | pending | none
  review_decision   TEXT,             -- approved | changes_requested | review_required | NULL (overall PR review status)
  author_login      TEXT,
  author_avatar     TEXT,
  comment_count     INTEGER,
  branch            TEXT,              -- headRefName
  url               TEXT,
  linear_identifier TEXT,             -- normalized uppercase id extracted from branch/title (e.g. "ENG-123"), nullable
  updated_at        TEXT,             -- PR updatedAt (ISO)
  synced_at         TEXT NOT NULL,
  PRIMARY KEY (id, bucket)
);
CREATE INDEX idx_github_prs_bucket ON github_prs(bucket);
CREATE INDEX idx_github_prs_linear_identifier ON github_prs(linear_identifier);

-- Per-bucket sync metadata so truncation/staleness survive restart.
CREATE TABLE github_sync_meta (
  bucket         TEXT PRIMARY KEY,     -- needs_review | mine | assigned | involved
  fetched_count  INTEGER NOT NULL,
  truncated      INTEGER NOT NULL,     -- bool: cap (§4.3) was hit
  last_synced_at TEXT
);
```

- **Every cached row is an open PR** (all queries carry `is:open`), so `state` and `merged` are omitted from the schema — they'd be constant. `draft` is kept because open PRs can be draft or ready.
- **`linear_identifier`** is extracted at sync time by matching `headRefName`/`title` with a case-insensitive, boundary-aware pattern `(?i)\b[A-Z][A-Z0-9]*-\d+\b` (Linear-generated branches are commonly lowercase, e.g. `eng-123`), then **normalized to uppercase** before storing/joining.
- **No stored `linear_issue_id`.** Instead, `list_github_prs` resolves the issue id at read time by **joining** `github_prs.linear_identifier = issues.identifier` and returning `linear_issue_id` alongside each row. The join (not a persisted id) automatically follows Linear cache rebuilds and never goes stale.
- The cached `github_login` lives in the existing `settings` table (key `github_login`), mirroring how the verified Linear viewer name is cached.

## 6. Commands — `src-tauri/src/commands/github.rs`

New handler file (kept out of the already-large `commands/mod.rs`). Thin `#[tauri::command]` wrappers over unit-testable async `_logic` fns, registered in `lib.rs` via `generate_handler![...]`. (Custom application commands do **not** require entries in `src-tauri/capabilities/default.json` — that file only carries core/plugin permissions, and none of the existing custom commands are listed there — so M4 adds no capability entries.)

- `set_github_token(token)` — treated as an account switch: store the new token in the keychain **and** wipe prior GitHub state (`github_prs`, `github_sync_meta`, `github_login`). Leaves the Linear cache intact. (Uses the §4.5 GitHub lock.)
- `clear_github_token()` — delete the keychain entry and wipe `github_prs`, `github_sync_meta`, `github_login`. Leaves the Linear cache intact.
- `get_github_status()` → `GitHubStatus` (`NotConfigured` | `Unverified` | `Connected { login }`), mirroring `ConnectionStatus`. **Offline:** derived purely from keychain presence + the cached `github_login` setting; it never calls the network.
- `test_github_connection()` — the only status command that hits the network: call `viewer { login }`, cache `github_login`, return `Connected`.
- `sync_github_prs()` → per-bucket result summary (which buckets refreshed vs stayed stale, with truncation flags). Acquires the GitHub lock; runs the §4.4 per-bucket transactional refresh.
- `list_github_prs()` → rows grouped by bucket (each enriched with `linear_issue_id` via the §5 join) plus the per-bucket `github_sync_meta`.

All errors are sanitized (`CmdError`); no raw reqwest/GraphQL/keyring diagnostics cross the IPC boundary.

## 7. Frontend — `src/features/prs/`

### 7.1 Navigation wiring
- Add `"prs"` to `ViewKind` and `VIEWS` in `src/lib/paneModel.ts`.
- Add a `prs` entry to `NAV` and `META` in `src/components/Dock.tsx` (a `GitPullRequest` lucide icon, label "Pull Requests").
- Add a `case "prs"` in `src/components/SplitLayout.tsx` rendering `<PrsPage/>`. (`PaneTabStrip` already derives its title/icon from `META`, so tabs work once `META` has the entry.)

### 7.2 Components
- **`PrsPage.tsx`** — four sections with live counts; dense/calm Linear aesthetic (hairline borders, indigo accent), designed via the `ui-ux-pro-max` skill. Empty/connect state when not configured. Per-section stale indicator when that bucket failed to refresh.
- **`PrRow.tsx`** — title, `#number`, author avatar + login, comment count, `owner/repo` + relative "updated 2h ago", and status badges:
  - open/draft (draft vs ready),
  - CI (success/failure/pending/none),
  - conflict flag (when `mergeable = conflicting`),
  - review decision (approved / **changes requested** / review required; nothing when null).
  - Linear chip (when `linear_issue_id` present) → calls the workspace context's `openIssueTab(issueId)` (which wraps the `openIssueTabAcross` reducer), not the reducer directly.

### 7.3 Cache-vs-sync data flow (offline-first)
`PrsPage` separates the cached read from the network sync:
- A `list_github_prs` query renders immediately from SQLite.
- A separate background `sync_github_prs` query runs on mount and on a **5-minute interval** (the interval drives *sync*, matching the Linear sync default — it does **not** merely re-read SQLite), plus a manual refresh button. This sync query is **disabled while status is `NotConfigured`** (no token → no network calls), gated on `get_github_status`.
- On `sync_github_prs` success, invalidate the `list_github_prs` query so the UI picks up fresh rows.
- On sync failure, keep showing the stale cached rows with a quiet `goey-toast` / inline warning.

Bindings and types added to `src/lib/commands.ts`.

## 8. Testing

**Rust (`cargo test`):**
- GraphQL parsing per field, including CI rollup mapping and `review_decision` mapping (incl. `null` preserved).
- Bucket search-query construction (incl. the `involved` negative-qualifier remainder).
- Pagination loop (multi-page, `hasNextPage`, cap enforcement, `truncated` flag persistence).
- Linear identifier extraction: lowercase branches (`eng-123`), mixed case, punctuation boundaries, and uppercase normalization. Embedded false positives must NOT match (e.g. `xENG-123y` — no word boundary). Note `release-2024` *does* validly match the pattern, so it's tested at the join layer: it extracts `RELEASE-2024` but yields **no chip unless it joins an actual cached issue**. Plus the read-time join resolution itself.
- Prune-on-full-success / abort-on-partial-failure behavior (no global prune; one bucket failing leaves its cache; another succeeding still commits).
- Credential isolation (set-token and clear-token each wipe only GitHub state; swapped-token sync aborts via the generation guard).
- Rate-limit/error interpretation per §4.6: GraphQL errors on HTTP 200, `RATE_LIMITED` → `RateLimited`, 403 secondary-limit vs auth disambiguation, header reset hints.
- `get_github_status` is offline (no network); `test_github_connection` calls `viewer`.

**Frontend (Vitest — already configured; the CLAUDE.md "no JS test framework" note is stale):**
- Four-section rendering and counts.
- No-token (connect prompt) and stale-cache (warning + cached rows) states.
- Bucket membership: a PR in two legitimate buckets renders in both; the `involved` remainder excludes authored/assigned/review-requested.
- Linear-chip → issue-tab navigation.
- Background refresh / query invalidation behavior.
- Status badge mappings (draft, CI states, conflict, each review decision, null → none).

## 9. `requirements.md` updates (part of implementation)

The implementation must update `requirements.md`, whose F7-related sections still describe the old issue-drawer design:
- **§2 scope** item 6 — reframe "GitHub PR & branch tracking" as the standalone dashboard.
- **§4 GitHub auth** (line ~129) — classic PAT + scope wording (§3 above), replacing the fine-grained default with the stated reason.
- **§5 data model** — replace the issue-centric `github_prs` with the viewer/bucket-centric schema (§5 above).
- **§6 sync strategy** — replace "on demand when an issue with linked PRs is viewed" with the on-open + 5-min background poll + per-bucket transactional refresh.
- **§8 GitHub correlation** — reframe from issue→PR correlation to the viewer-centric buckets; demote Linear correlation to the optional convenience chip.
- **F7 + AC** — rewrite to the dashboard's acceptance criteria (sections populate; no-token shows connect prompt without errors; stale cache survives sync failure).
- **§11 M4 line** — update to "GitHub PR dashboard".

## 10. Acceptance criteria

1. With a valid token, all four sections populate with the correct PRs, deduped within each bucket, "Involved" excluding the other three.
2. Each row shows title, `#number`, author, comment count, repo, updated-time, and correct status/CI/conflict/review badges.
3. A PR whose branch/title contains a Linear identifier present in the cache shows a chip that opens that issue's tab.
4. With no token, the page shows a "Connect GitHub" prompt and no errors.
5. A sync failure (network/rate-limit/partial page) leaves the previous cache intact and shows a quiet warning; no bucket is emptied by a partial fetch. A truncated bucket shows its "300 most recent" note across restarts.
6. Setting **or** clearing the GitHub token wipes only GitHub state (rows, sync meta, login) and never disturbs the Linear workspace cache; a replaced token never exposes the previous account's PRs or login.
7. The token is accepted transiently from the Settings input, sent directly over IPC, immediately cleared from component state, and never returned to the renderer or retained in browser storage, SQLite, logs, or query caches.
8. Rust + Vitest suites pass; `npx tsc --noEmit` clean.
