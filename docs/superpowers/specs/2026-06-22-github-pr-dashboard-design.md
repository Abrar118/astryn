# M4 — GitHub PR Dashboard (revamped F7)

**Status:** Design approved (2026-06-22). Supersedes the original issue-drawer-centric F7 in `requirements.md`.

## 1. Summary

A standalone, dedicated **PR dashboard** centered on *you* (the authenticated GitHub user), spanning every repository you can access — personal, organization, and collaborations. It replaces the original F7 design (per-issue PR badges in the Linear issue drawer), which is dropped.

The page has four sections — **Needs my review**, **My open PRs**, **Assigned to me**, **Involved/mentioned** — each listing open pull requests with title, number, author, comment count, status badges (open/draft, CI, conflict), and review state. When a PR's branch or title carries a Linear issue identifier (e.g. `ENG-123`), the row shows a chip that opens that issue's tab inside Astryn.

This keeps Astryn's hard architectural rule: all GitHub API calls happen in Rust; the webview is a pure consumer of cached data + typed Tauri commands. No token ever reaches the webview.

## 2. Goals & non-goals

**Goals**
- One place to see every open PR that involves you, across all accessible repos and orgs.
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

- **`mod.rs`** — `GitHubClient` (a `reqwest::Client` against the GraphQL endpoint `https://api.github.com/graphql`), `GitHubError` (sanitized variants: `Network`, `Auth`, `RateLimited(Option<i64>)`, `Malformed`, `Server`, `Api(String)`), an HTTP-status interpreter (401/403 → `Auth`, 429 → `RateLimited` with reset hint from headers, 5xx → `Server`), and the `GitHubCredentialProvider` trait + `PatProvider`.
- **`prs.rs`** — GraphQL query construction, parsing, and the bucket definitions.
- Connection check: `viewer { login }` for `test_github_connection` / `get_github_status`.

### 4.1 Buckets & search queries

Each bucket is a GitHub GraphQL `search(type: ISSUE, query: ...)` over open PRs, using `@me` filters so the viewer's login need not be interpolated:

| Bucket | `bucket` value | Search query |
| --- | --- | --- |
| Needs my review | `needs_review` | `is:pr is:open review-requested:@me` |
| My open PRs | `mine` | `is:pr is:open author:@me` |
| Assigned to me | `assigned` | `is:pr is:open assignee:@me` |
| Involved/mentioned | `involved` | `is:pr is:open involves:@me -author:@me -assignee:@me -review-requested:@me` |

**Bucket overlap is resolved explicitly:** "Involved/mentioned" is the *remainder* — `involves:@me` minus authored/assigned/review-requested via negative qualifiers — so a PR appears in at most one section. (A PR could still legitimately match both `needs_review` and `assigned`; those are treated as distinct, intentional memberships and are deduped only within a single bucket.)

### 4.2 Fields per PR node

For each `PullRequest` node: `number`, `title`, `url`, `isDraft`, `mergeable` (→ conflict flag), `state`, `author { login, avatarUrl }`, `comments { totalCount }`, `reviewDecision`, `repository { nameWithOwner }`, `headRefName` (branch), `updatedAt`, and the head-ref **status-check rollup** for CI.

- **CI rollup:** use the PR's head-ref status-check rollup, **verified against the live schema** during implementation — prefer a direct `PullRequest.statusCheckRollup { state }` if the live schema exposes it, otherwise fall back to `commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }`. Roll up to `success | failure | pending | none`. (Per the repo's "live API wins — introspect before trusting field names" rule.)
- **`review_decision`:** this is the PR's **overall** review status (`APPROVED` / `CHANGES_REQUESTED` / `REVIEW_REQUIRED` / `null`), **not** the current viewer's personal review decision. It is stored and rendered as-is, and `null` is preserved (null does **not** mean `REVIEW_REQUIRED`). This overall status is exactly what serves the user's requirement "show if my own PRs have changes requested": a `CHANGES_REQUESTED` value on a `mine`-bucket row. No per-viewer review query is needed.

### 4.3 Pagination

GitHub GraphQL connections return at most 100 nodes per page and require cursor pagination. Each bucket is fetched by paging on `pageInfo { hasNextPage endCursor }` until exhausted **or** an explicit safety cap of **300 PRs per bucket** is reached. If the cap is hit, the UI shows a small "showing first 300" note for that section. "One query per bucket" holds only for buckets of ≤100 results; larger buckets issue follow-up paged queries.

### 4.4 Sync, pruning & failure handling

`sync_github_prs` refreshes the cache **per bucket, independently and transactionally**:

1. Fetch **all pages** for the bucket into memory first.
2. Only on full success, in a single transaction: upsert the fetched rows and **prune** rows for *that bucket* that were not in the result set.
3. If any page fails (network, rate-limit, auth), **abort that bucket** and leave its prior cache untouched. Never prune globally on partially fetched results.

This guarantees a page-2 failure or a 429 never empties a bucket. Buckets are independent: one failing does not roll back another's successful refresh. The command returns a per-bucket status so the UI can show which sections are stale.

**Rate limits:** GitHub GraphQL uses a points-based limit; these searches are cheap. On 429, back off and surface a non-blocking `goey-toast`, keeping cached rows visible.

### 4.5 Credential isolation

- A dedicated GitHub sync lock (separate from any Linear sync lock) serializes `sync_github_prs` and prevents an in-flight sync from committing under a token that was swapped mid-flight (re-read/capture the token at the start of a sync; if it changed, abort).
- Setting or clearing the GitHub token clears **only** GitHub state — all `github_prs` rows and the `github_login` setting — and never touches the Linear workspace cache.

## 5. Data model

New migration `src-tauri/migrations/0009_m4_github_prs.sql`. The original spec's issue-centric `github_prs` is reworked to be viewer/bucket-centric:

```sql
CREATE TABLE github_prs (
  id                TEXT NOT NULL,     -- "owner/repo#number"
  bucket            TEXT NOT NULL,     -- needs_review | mine | assigned | involved
  repo              TEXT NOT NULL,     -- "owner/name"
  number            INTEGER NOT NULL,
  title             TEXT,
  state             TEXT,              -- open | closed | merged
  draft             INTEGER,           -- bool
  merged            INTEGER,           -- bool
  mergeable         TEXT,              -- mergeable | conflicting | unknown
  ci_status         TEXT,              -- success | failure | pending | none
  review_decision   TEXT,             -- approved | changes_requested | review_required | NULL (overall PR review status)
  author_login      TEXT,
  author_avatar     TEXT,
  comment_count     INTEGER,
  branch            TEXT,              -- headRefName
  url               TEXT,
  linear_identifier TEXT,             -- extracted from branch/title (e.g. "ENG-123"), nullable
  updated_at        TEXT,             -- PR updatedAt (ISO)
  synced_at         TEXT NOT NULL,
  PRIMARY KEY (id, bucket)
);
CREATE INDEX idx_github_prs_bucket ON github_prs(bucket);
CREATE INDEX idx_github_prs_linear_identifier ON github_prs(linear_identifier);
```

- **`linear_identifier`** is extracted at sync time by matching `headRefName`/`title` against the Linear identifier pattern (`[A-Z][A-Z0-9]+-\d+`).
- **No stored `linear_issue_id`.** Instead, `list_github_prs` resolves the issue id at read time by **joining** `github_prs.linear_identifier = issues.identifier` and returning `linear_issue_id` alongside each row. The join (not a persisted id) automatically follows Linear cache rebuilds and never goes stale.
- The cached `github_login` lives in the existing `settings` table (key `github_login`), mirroring how the verified Linear viewer name is cached.

## 6. Commands — `src-tauri/src/commands/github.rs`

New handler file (kept out of the already-large `commands/mod.rs`). Thin `#[tauri::command]` wrappers over unit-testable async `_logic` fns, registered in `lib.rs` via `generate_handler![...]`. New permissions added to `src-tauri/capabilities/default.json`.

- `set_github_token(token)` — store in keychain; clears nothing else.
- `clear_github_token()` — delete the keychain entry, wipe `github_prs` rows + `github_login`. Leaves the Linear cache intact.
- `get_github_status()` → `GitHubStatus` (`NotConfigured` | `Unverified` | `Connected { login }`), mirroring `ConnectionStatus`.
- `test_github_connection()` — call `viewer { login }`, cache `github_login`, return `Connected`.
- `sync_github_prs()` → per-bucket result summary (which buckets refreshed vs stayed stale). Acquires the GitHub lock; runs the §4.4 per-bucket transactional refresh.
- `list_github_prs()` → rows grouped by bucket, each enriched with `linear_issue_id` via the §5 join.

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
  - Linear chip (when `linear_issue_id` present) → calls `openIssueTabAcross(issueId)`.

### 7.3 Cache-vs-sync data flow (offline-first)
`PrsPage` separates the cached read from the network sync:
- A `list_github_prs` query renders immediately from SQLite.
- A separate background `sync_github_prs` query runs on mount and on a **5-minute interval** (the interval drives *sync*, matching the Linear sync default — it does **not** merely re-read SQLite), plus a manual refresh button.
- On `sync_github_prs` success, invalidate the `list_github_prs` query so the UI picks up fresh rows.
- On sync failure, keep showing the stale cached rows with a quiet `goey-toast` / inline warning.

Bindings and types added to `src/lib/commands.ts`.

## 8. Testing

**Rust (`cargo test`):**
- GraphQL parsing per field, including CI rollup mapping and `review_decision` mapping (incl. `null` preserved).
- Bucket search-query construction (incl. the `involved` negative-qualifier remainder).
- Pagination loop (multi-page, `hasNextPage`, cap enforcement).
- Linear identifier extraction from branch/title and the read-time join resolution.
- Prune-on-full-success / abort-on-partial-failure behavior (no global prune; one bucket failing leaves its cache; another succeeding still commits).
- Credential isolation (clear-token wipes only GitHub state; swapped-token sync aborts).
- HTTP/error status mapping and the connect/status `_logic` fns.

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
5. A sync failure (network/rate-limit/partial page) leaves the previous cache intact and shows a quiet warning; no bucket is emptied by a partial fetch.
6. Setting/clearing the GitHub token never disturbs the Linear workspace cache.
7. The token never appears in the webview, SQLite, logs, or query caches.
8. Rust + Vitest suites pass; `npx tsc --noEmit` clean.
