# GitHub Pull Request Page Revamp

**Status:** Approved on 2026-07-26.

**Branch:** `feat/pr-page-revamp`, created from `main` at `088dd41`.

**Supersedes:** The PR-page presentation and “no PR detail view” non-goal in
`docs/superpowers/specs/2026-06-22-github-pr-dashboard-design.md`. The existing
authentication, credential isolation, provider architecture, viewer buckets,
contribution cache, and transactional sync rules remain authoritative unless
this document explicitly changes them.

## 1. Summary

Revamp Astryn’s Pull Requests page into a dense, Linear-inspired master-detail
workspace:

- a page-local siderail selects **My PRs**, **Assigned to Me**, **Needs My
  Review**, or a favorite repository;
- the **Involved / mentioned** bucket is no longer exposed as a page section;
- the active scope renders one focused PR list, grouped by repository by
  default;
- each PR has a right-click and keyboard-accessible action menu;
- favorite repositories persist locally and show every cached open PR in the
  selected repository, not only PRs involving the authenticated viewer; and
- selecting a PR opens a resizable right drawer modeled on Linear’s review
  surface, with a live read-only overview and changed-file view.

The list remains local-first. Repository lists are cached transactionally in
SQLite, while the more expensive PR detail payload is fetched through Rust only
when the drawer opens. The cached list row is the durable offline fallback.

## 2. Product decisions

### 2.1 Goals

- Make the PR page easier to scan by showing one work queue at a time.
- Put the three actionable viewer queues in a persistent siderail.
- Remove the visible Involved / mentioned section.
- Default repository grouping to enabled while respecting an explicit saved
  user override.
- Support Copy link, Copy PR title, Open PR, and Favorite/Unfavorite repository
  from every PR row.
- Let the user favorite a known repository and see all of its open PRs with the
  same row information and controls as viewer queues.
- Show a high-fidelity, read-only PR overview inside Astryn without requiring a
  browser round-trip.
- Preserve cached lists on network, API, authentication, or rate-limit
  failures.

### 2.2 Non-goals

- Astryn will not approve, request changes, comment, merge, close, edit, or
  otherwise mutate GitHub pull requests in this iteration.
- Astryn will not render line-by-line patch hunks or inline review threads.
  The Changes tab is a file-level summary; Open on GitHub remains the path to
  the full diff and write actions.
- The favorite picker will not enumerate every repository accessible through
  the GitHub token. It searches repositories already known from Astryn’s cached
  PR data. A repository can also be favorited directly from any PR row.
- Full PR detail payloads are not persisted to SQLite in this iteration.
  TanStack Query retains them for the current app session.
- No new token scope, dependency, Tauri capability, CSP origin, or external
  frontend request is introduced.

## 3. Visual system

The requested `ui-ux-pro-max` search was run for a dark developer-productivity
dashboard, master-detail layout, context menu, accessibility, and React
guidance. Its useful recommendations are adopted: OLED-friendly dark surfaces,
high legibility, visible focus, stable hover states, a clear z-index hierarchy,
keyboard access, and reduced-motion handling.

The generic search also suggested Fira typography and a green primary accent.
Astryn intentionally does not adopt those suggestions because `requirements.md`
makes Linear continuity authoritative. The revamp therefore uses the existing
Geist/system font, indigo primary token, near-black background, low-chroma
neutral surfaces, Lucide icons, hairline borders, and compact 13–14 px type.
There are no new global theme tokens.

The contribution heatmap and Open / Needs review / Changes requested /
Conflicts metrics remain, satisfying the existing F7 requirement, but move into
a quieter compact band above the active list. They remain viewer-centric and
exclude repository-specific cache scopes so favoriting a repository cannot
inflate personal metrics.

## 4. Page layout and interaction

### 4.1 Siderail

The connected page is a three-region layout:

1. the existing page header;
2. a fixed-width page siderail, approximately 208 px wide; and
3. a flexible active-list panel.

The siderail’s primary navigation is ordered:

1. **My PRs** — selected on every fresh mount;
2. **Assigned to Me**; and
3. **Needs My Review**.

Each item has a Lucide icon and a count derived from its cached bucket. The
Involved / mentioned bucket is not rendered in the siderail or content area.
Its existing backend cache/sync path may remain for compatibility with other
viewer-centric summaries.

A **Favorite repositories** heading follows the primary navigation. It has a
small `+` button that opens a searchable picker of distinct repository names
already present in cached PR rows. The picker excludes current favorites and
uses canonical `owner/name` display labels. Each favorite row shows its open PR
count and an unfilled/filled star affordance. Adding a favorite selects it
immediately. Removing the active favorite returns selection to My PRs.

At narrow desktop widths, the siderail becomes a compact icon rail with
tooltips. It must not create horizontal page scrolling. This remains a desktop
Tauri experience; a separate phone navigation model is out of scope.

### 4.2 Active list

The active-list header shows the selected scope, count, last-sync/stale state,
and Refresh action. The compact activity/metric band appears below the page
header and above the list controls.

The current health filters and sorting options remain:

- All / Conflicts / CI failing;
- Recent / Oldest / Largest; and
- Group by repository.

The four-card Board/List layout switch is removed because the siderail now
selects one list at a time. Every scope uses the dense list layout.

Repository grouping is persisted in
`localStorage["astryn:prs:group-by-repo:v1"]`. Missing, unreadable, or invalid
state resolves to `true`. A saved `false` remains respected. Grouping is
visually redundant but harmless in a favorite-repository scope; the control
stays consistent rather than changing the toolbar between scopes.

The current `PrRow` information remains: title, state, review state,
mergeability, CI, branch/base relationship, repository, number, diff stats,
comment count, linked Linear state, waiting state, reviewers, author, and
relative update time.

The whole row is a keyboard-focusable selection target. Click or Enter opens
the PR drawer. The title no longer opens GitHub directly, preventing competing
row click targets. The Linear issue chip continues to open the linked issue and
stops row selection propagation.

### 4.3 PR context menu

Right-clicking a row, pressing the keyboard Context Menu key / Shift+F10 while
the row is focused, or activating its visible-on-hover/focus ellipsis button
opens the same menu:

1. Copy link
2. Copy PR title
3. Open PR
4. separator
5. Favorite repository or Unfavorite repository

Copy uses the Clipboard API and reports success/failure with `goey-toast`.
Open PR uses the existing Tauri opener plugin. If a legacy cached row lacks a
URL, link-dependent actions are disabled and explain why; the title and
favorite actions remain available. Escape, outside click, window resize, or
selecting an action closes the menu. Menu placement is clamped to the viewport.

## 5. Favorite repository data

### 5.1 Persistence

Favorite repositories are app-owned state stored as a JSON array in the
existing SQLite `settings` row keyed by `github_favorite_repos`. No migration
is required.

Repository names must match exactly one owner and one repository segment:

```text
[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+
```

The Rust boundary trims input, rejects invalid names, deduplicates
case-insensitively, and preserves the canonical cached casing for display and
the GitHub query. A repository-specific cache scope uses a normalized bucket
key:

```text
repo:<lowercase-owner>/<lowercase-repository>
```

This reuses the current `(id, bucket)` primary key and `github_sync_meta.bucket`
without a schema change. The TypeScript boundary distinguishes core buckets
from repository scopes rather than casting arbitrary strings to `PrBucket`.

Setting or clearing the GitHub token remains an account-switch seam and also
clears `github_favorite_repos`, repository-specific PR rows, and their sync
metadata. Private repository names must never remain visible after a credential
switch.

### 5.2 Commands

Add typed, thin Tauri commands backed by unit-testable logic:

- `set_github_repo_favorite(repo, favorite)` validates and persists the new
  favorite set. Removing a favorite also deletes only that repository’s
  re-fetchable PR rows and sync metadata.
- `list_github_prs()` adds `favoriteRepos: string[]` to the existing dashboard
  payload and returns repository-scoped rows alongside core rows.

The frontend does not optimistically invent persisted favorites. It awaits the
local SQLite mutation, updates or invalidates queries, then triggers the standard
GitHub sync. This avoids a rollback path for a local write that normally
completes immediately.

### 5.3 Repository sync

The existing background/manual `sync_github_prs` path additionally loads the
favorite list and fetches each repository scope with:

```text
repo:owner/name is:pr is:open sort:updated-desc
```

Repository names are validated before query construction. Each favorite uses
the same pagination rules as a viewer bucket: page size 100, cap 300, dedupe by
PR id, explicit truncation metadata, and a per-scope transactional replacement.
A failed page leaves that repository’s previous cache untouched and returns a
scope-specific failed result. The GitHub credential generation guard is checked
before every commit, so stale in-flight results cannot write after a token
change.

Adding a favorite persists it even if its first network sync fails. The
siderail then shows the favorite with cached data if any, an inline stale
indicator, a Retry action through the page refresh flow, and a non-blocking
toast. Removing a favorite is immediate and recoverable by adding it again and
re-syncing.

## 6. PR detail command

### 6.1 Request and boundary

Add `get_github_pr_detail(repo, number)`. TypeScript passes only the repository
name and positive PR number. Rust validates/splits the repository, reads the
token from the credential provider, and calls GitHub GraphQL using variables
for owner, repository, and number. The token never reaches the webview, SQLite,
logs, errors, or the TanStack cache.

The command parses `repository.pullRequest` and returns a camelCase
`GithubPrDetail` containing:

- title, URL, state, draft status, created/updated timestamps, author, body,
  head/base branches, mergeability, review decision, additions, deletions,
  changed-file count, comment count, and linked issue identifier;
- up to 100 issue comments with author, avatar, Markdown body, timestamp, and
  URL;
- up to 100 reviews with reviewer, avatar, state, Markdown body, submitted
  timestamp, and URL;
- the most recent 50 commits with oid, headline, author identity, timestamp,
  and URL;
- up to 100 changed files with path, change type, additions, and deletions;
- up to 100 check runs/status contexts normalized to name, status, conclusion,
  and details URL; and
- explicit truncation flags for comments, reviews, commits, files, and checks,
  based on connection totals/page information rather than array length alone.

GitHub GraphQL `errors` are treated as failures even on HTTP 200. Missing
required structure, unknown union members where a required normalized value
cannot be produced, invalid repositories, unavailable PRs, authentication
failures, and rate limits map to existing sanitized `CmdError` variants. Raw
GraphQL, reqwest, and provider diagnostics do not cross IPC.

### 6.2 Session caching and fallback

`useGithubPrDetail(repo, number, enabled)` uses a TanStack key containing the
canonical repository and PR number. The query runs only while a drawer has a
selected PR and keeps successfully loaded detail data for the app session.

The clicked cached `GithubPr` is passed separately as the drawer seed. The
shell renders the cached header/status immediately, then fills live-only
sections as the detail arrives. If loading fails, the cached header, branches,
status, CI, reviewers, diff totals, linked Linear issue, and Open on GitHub
action remain visible. An inline `role="alert"` message offers Retry without
discarding the seed.

## 7. PR drawer

### 7.1 Shell and accessibility

`PrDrawer` is page-owned and mounted only while a PR is selected. It is a fixed
right-side dialog over a subtle backdrop, with a default width of 70 vw,
clamped to 680–1180 px and at most 96 vw. A left-edge pointer resizer persists
the selected width under `astryn:prs:drawer-width:v1`.

The shell:

- uses the repository and PR number in its accessible name;
- moves initial focus to the Close button;
- closes on Escape or backdrop click unless a nested menu is handling Escape;
- restores focus to the row or menu action that opened it;
- clamps resize behavior to the viewport; and
- disables slide/opacity transitions under `prefers-reduced-motion`.

Z-index follows Astryn’s established scale: page content below the backdrop,
drawer/backdrop below menus and command overlays, and the context menu at the
shared top overlay level.

### 7.2 Header

The sticky drawer header contains:

- canonical `owner/repo #number`;
- PR title;
- head → base branch relationship;
- additions and deletions;
- Favorite/Unfavorite repository;
- Copy link;
- Open on GitHub; and
- Close.

Cached values render first. Live values replace them only when the detail
request succeeds.

### 7.3 Overview tab

The default Overview tab uses the supplied Linear review screenshots as its
layout reference:

- a flexible primary column with author/date, title, rendered GitHub-flavored
  Markdown description, and chronological activity;
- a quiet 300 px metadata column showing state/draft, mergeability, review
  decision, requested/completed reviewers, checks summary, linked Linear issue,
  and changed-file summary.

Comments, reviews, and commits are merged by timestamp for display. Reviews
show their normalized decision; empty review bodies still render a compact
decision event. User-supplied Markdown is rendered with the existing
`react-markdown` + `remark-gfm` stack. External links open through the Tauri
opener. No raw HTML is enabled.

When a bounded connection is truncated, the section shows a quiet “Showing the
most recent N” note and an Open on GitHub link. Empty description, activity,
reviewer, and check sections use calm explicit empty states rather than blank
space.

### 7.4 Changes tab

The Changes tab renders a dense changed-file list:

- file path and change-type icon;
- additions/deletions and the existing diff-bar visual; and
- a truncated note when GitHub reports more than 100 files.

It does not fetch or render patch text. A persistent Open full diff on GitHub
action makes that boundary clear.

## 8. Frontend component boundaries

Keep the current `src/features/prs/` feature boundary and split new
responsibilities so `PrsPage.tsx` does not become a second drawer monolith:

- `prScopes.ts` — core/repository scope types, bucket-key parsing, favorite
  normalization helpers, and grouping preference parsing;
- `PrSidebar.tsx` — primary scopes, favorite repository list, and picker;
- `PrListPanel.tsx` — active-scope header, toolbar, grouped rows, stale/empty
  states, and selection wiring;
- `PrRow.tsx` — row rendering and keyboard selection;
- `PrContextMenu.tsx` — one menu shared by pointer, keyboard, and ellipsis;
- `PrDrawer.tsx` — dialog shell, tabs, resize/focus/close behavior, and cached
  seed/live query orchestration;
- `PrDrawerOverview.tsx` — description, activity feed, and metadata rail;
- `PrDrawerChanges.tsx` — changed-file summaries; and
- focused pure helpers/tests beside these components.

Existing badge, branch graph, diff-stat, activity, heatmap, query, and opener
patterns are reused. No new catch-all utility module or icon dependency is
introduced.

## 9. Error and state behavior

- **No token:** retain the current centered Connect GitHub state.
- **Initial cache read:** show the existing cached lists immediately; use
  skeleton rows only before the first cache read resolves.
- **Viewer sync failure:** keep all prior viewer buckets and show the existing
  stale status/toast.
- **Favorite sync failure:** preserve that repository’s prior scope and mark
  only that favorite stale.
- **Favorite local-write failure:** leave the UI unchanged and show a sanitized
  toast.
- **Clipboard failure:** keep the menu usable and show a concise error toast.
- **Open URL failure:** surface a concise toast; do not close the drawer.
- **Detail loading:** cached seed plus live-section skeletons.
- **Detail failure:** cached seed plus an announced error, Retry, and Open on
  GitHub.
- **Malformed/truncated detail:** reject malformed required data; accept valid
  bounded collections and label truncation explicitly.
- **Stale async work:** the GitHub credential generation guard protects
  persistent writes; TanStack query keys prevent one PR detail from replacing
  another.

## 10. Testing strategy

Every observable behavior change follows a focused red-green-refactor cycle.

### 10.1 Frontend

Add or extend Vitest/Testing Library coverage for:

- the three primary siderail sections, their order/counts, My PRs default, and
  absence of an Involved section;
- favorite repository counts, picker search/exclusion, selection after add,
  fallback after removal, and same-row rendering for repository scopes;
- grouping defaulting to true for missing/invalid persisted state and honoring
  a saved false value;
- active-scope filtering, sorting, grouping, stale/truncated notes, and
  viewer-only metric calculation;
- row click and Enter opening the drawer while the Linear chip still opens the
  issue without opening the PR;
- right-click, Shift+F10, Context Menu key, and ellipsis opening the same menu;
- Copy link, Copy title, Open PR, Favorite, and Unfavorite behavior, including
  URL-unavailable and clipboard-error states;
- drawer cached-first rendering, detail success, loading skeletons, sanitized
  error fallback, retry, close paths, focus restoration, and reduced-motion
  classes;
- Overview activity ordering, review decision labels, safe Markdown rendering,
  empty states, checks/reviewer metadata, and truncation notes; and
- Changes file summaries and the Open full diff boundary.

### 10.2 Rust and database

Add focused Rust coverage for:

- canonical repository validation, case-insensitive dedupe, and repository
  bucket-key normalization;
- favorite settings JSON round-trips, malformed setting recovery, add/remove,
  repository-cache deletion, and clearing favorites on token set/clear;
- favorite repository search-query construction without unsafe interpolation;
- multi-page repository fetch, 300-row cap, dedupe, sync metadata, transactional
  replacement, partial failure preservation, and generation cancellation;
- dashboard serialization of `favoriteRepos` and repository-scoped rows;
- detail GraphQL variable construction and parsing of summary, Markdown bodies,
  comments, reviews, commits, files, checks/status contexts, null values, and
  truncation flags;
- GraphQL errors on HTTP 200, missing PRs, malformed required fields,
  authentication/rate-limit classification, and sanitized IPC errors; and
- credential changes never committing an in-flight repository sync or exposing
  prior-account favorite names.

### 10.3 Verification

Run:

```bash
npm test -- src/features/prs
npm test
npx tsc --noEmit
npm run build
cargo test --manifest-path src-tauri/Cargo.toml github
cargo test --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
git diff --check
```

If the environment permits, manually exercise the connected GitHub flow with
`npm run tauri dev`: primary navigation, favorite add/remove/sync, context menu,
drawer overview/changes, external opening, resize, keyboard access, and cached
fallback. Manual verification is reported only if actually run.

## 11. Requirements updates

Implementation updates the F7-related product authority in `requirements.md`
to reflect the owner-approved change:

- the visible dashboard sections become My PRs, Assigned to Me, and Needs My
  Review;
- Involved / mentioned is no longer a visible PR-page section;
- favorite repositories and their all-open-PR cache become in scope;
- row context actions and default-on grouping become acceptance criteria;
- the old “no PR detail view” stance is replaced by the read-only on-demand
  detail drawer defined here; and
- the heatmap/metrics, row information, credential rules, offline-first list
  cache, failure preservation, and 300-row scope cap remain requirements.

`CLAUDE.md` status prose is updated only where it would otherwise make the
current PR feature materially misleading.

## 12. Acceptance criteria

1. The PR page opens on My PRs and displays a siderail with My PRs, Assigned to
   Me, Needs My Review, and Favorite repositories; no Involved / mentioned
   section is visible.
2. Selecting a primary scope shows only that bucket. Selecting a favorite shows
   every cached open PR in that repository with the same row information,
   filters, sorting, grouping, and interactions.
3. Repository grouping is on for a first-time user and a saved off preference
   is respected.
4. A repository can be favorited/unfavorited from a PR menu or added from the
   siderail picker. Favorites survive restart, sync transactionally, preserve
   stale cache on failure, and are cleared with an account/token switch.
5. Right-click, keyboard context-menu input, and the row ellipsis expose Copy
   link, Copy PR title, Open PR, and Favorite/Unfavorite repository with
   accessible focus and user-visible feedback.
6. Clicking or pressing Enter on a PR opens a resizable right drawer. The
   cached summary renders immediately; successful live detail fills the
   Overview and Changes tabs.
7. Overview shows Markdown description, chronological comments/reviews/commits,
   and a metadata rail for status, review, checks, linked Linear issue, and
   files. Changes shows bounded file-level additions/deletions and links to the
   full GitHub diff.
8. Detail network/API failure retains a useful cached drawer with a sanitized
   announced error, Retry, and Open on GitHub.
9. GitHub requests and tokens remain in Rust; no credential, provider request,
   raw provider error, or private repository detail bypasses the typed Tauri
   boundary.
10. The compact contribution/metric band remains visible and viewer-centric.
11. Focused frontend/Rust tests, full suites, TypeScript, production build,
    Rust formatting, and scoped diff checks pass. Manual Tauri verification is
    reported only if performed.
