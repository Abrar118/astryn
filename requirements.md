# Astryn — Design & Handoff Doc

**Product:** Astryn — a local-first Linear power client (Phase 1 of a personal command center)
**Audience:** Claude Code (implementing agent)
**Owner:** Abrar
**Status:** Phase 1 in progress — M0–M1 + activity timeline (F4) + This Week agenda (M3/F5+F6) + GitHub PR dashboard (M4/F7) shipped, with several workspace extensions beyond the original plan; F8–F9 remain.
**Last updated:** 2026-06-21

---

## Implementation status

**Shipped**

- **M0 — Scaffold.** Tauri v2 + React 19 + Tailwind v4 + shadcn/ui, SQLite migrations, OS-keychain secret storage, the Rust Linear GraphQL proxy, the Home dual clock (Dhaka + Germany), and the Settings key-entry/connection flow.
- **M1 — Calendar + Drawer + Drag (F1–F3).** Month/week calendar with filters and the unscheduled rail, drag-to-reschedule, the shared issue detail (drawer **and** full-page tab) with inline editing, and a Milkdown markdown editor (GFM, Mermaid, code blocks, proxied images, issue mentions).
- **F4 — Activity timeline.** Per-issue chronological activity with semantic, color-coded event icons.

**Delivered beyond the original M0/M1 scope**

- **Issue list & board views** — grouping, persisted display options, and `@dnd-kit` board drag (cards → columns).
- **Linear-style comments** — threads, reactions, `@`-mentions, and mention hover-cards (reused on calendar chips).
- **Sub-issue parity** and a **label search/create** dropdown.
- **Two-pane split view** — independent tab groups, resizable divider (pointer + keyboard), pane swap, drag-to-split, and `@dnd-kit` tab drag (reorder + cross-pane move); persisted layout with migration.
- **Inbox** — Linear notifications in the dock with a master-detail layout.
- **Command palette & global shortcuts** — go-to navigation, create, resync/full-resync, open-in-right-split, with `⌘/Ctrl`+`K`/`T`/`[`/`R` bindings.

**Not yet built:** F8 (hierarchy/graph viz), F9 (doc links) — see §9 and §11.

---

## 0. How to read this doc

Tag legend (used throughout):

- `[REQ]` — a hard requirement. Do not change without asking.
- `[CHOICE]` — a decision made for you with a default. You may swap it if you have a concrete reason, but state the reason in your commit/PR. Defaults are chosen to minimize risk.
- `[EXT]` — explicitly out of scope for now / future extension. Do **not** build these yet; just don't architect in a way that blocks them.

When the Linear or GitHub API shape in this doc disagrees with reality, **the live API wins** — introspect the Linear GraphQL schema before writing queries and adjust. The queries here are accurate to the best of our knowledge but should be verified, not trusted blindly.

---

## 1. Goal & context

**Astryn** is a local-first desktop app that acts as a **power client for Linear** — covering workflows Linear's own UI and existing third-party tools (LinCal, Morgen, Reclaim) don't. It is Phase 1 of a larger personal "command center" that will later add Slack and Discord activity tracking. **Those are not part of this build** (`[EXT]`), but the data layer should not assume Linear is the only source forever.

The user already lives in Linear for issue tracking at work. The point of this app is a faster, richer, single-pane view: a real calendar, inline detail editing, a due-date "This Week" agenda, GitHub PR status tied to issues, and issue-graph visualization.

---

## 2. Scope

### In scope (Phase 1) `[REQ]`

1. **Calendar view** of issues by due date.
2. **Side-drawer issue details** (ClickUp-style) opened on click, with inline editing.
3. **Draggable calendar tasks** — drag an issue to a new day to reschedule its due date.
4. **"My activity" timeline** — a chronological feed of the user's own actions/changes.
5. **"This Week" agenda** — viewer's issues organized by due date for the current work week (replaces the original standup and weekly-review generators).
6. **GitHub PR dashboard** — a standalone view of open PRs that involve you (needs-my-review, my PRs, assigned, involved) across all accessible repos.
7. **Issue web / hierarchy visualization** — parent/child + relations as a graph.
8. **Related docs & link storage** per issue (local-first).

### Out of scope `[EXT]`

- Slack and Discord integration (Phase 2).
- Multi-user / team sharing. This is a single-user personal tool.
- Posting agenda/standup text to Slack/Discord (Phase 2; the M3 "This Week" view is in-app only).
- OAuth-based Linear auth (Phase 1 uses a personal API key — see §4).

---

## 3. Tech stack

- **Shell:** Tauri v2 `[REQ]` (cross-platform desktop, matches existing tooling).
- **Backend (Tauri core):** Rust. Owns all secrets and all outbound API calls. `[REQ]`
- **Frontend:** React + TypeScript + Vite `[REQ]` (resolved — not Svelte/Solid; this also keeps `gooey-toast`, which is React-only, valid).
- **Styling:** Tailwind CSS **v4** + **shadcn/ui** `[REQ]`. Note Tailwind v4 specifics: CSS-first config via `@theme` in the stylesheet (no `tailwind.config.js` by default), `@import "tailwindcss"`, and the new Vite plugin `@tailwindcss/vite`. Use the shadcn CLI's Tailwind-v4-compatible setup. Define the Linear-style palette (see §3 UI direction) as `@theme` tokens so shadcn components inherit it.
- **Server-state/cache layer:** TanStack Query against Tauri commands `[CHOICE]`.
- **Local DB:** SQLite via `sqlx` (Rust side) `[REQ]`. The frontend never touches SQLite directly — it goes through Tauri commands.
- **Secret storage:** OS keychain via the `keyring` crate (or Tauri's secure store plugin) `[REQ]`. **No tokens in SQLite, env files, or the webview.**
- **Calendar UI:** FullCalendar (React adapter) `[CHOICE]` — has drag-and-drop and day/week/month out of the box.
- **Graph UI:** React Flow `[CHOICE]` for the hierarchy/web view (better DX than raw D3 for node/edge graphs; use D3 only if you need a force layout React Flow can't do).
- **HTTP/GraphQL (Rust):** `reqwest` + hand-written GraphQL request bodies, or `graphql-client` if you want typed queries `[CHOICE]`.
- **Toasts/notifications (in-app):** `gooey-toast` `[REQ]` — https://goey-toast.vercel.app/ . React-only morphing toast library with promise tracking; use it for all in-app feedback (sync status, errors, optimistic-write rollbacks, promise toasts for in-flight mutations). Follow the install + API on that site; do not substitute another toast library.
- **UI design skill:** `ui-ux-pro-max` `[REQ]` — use this skill for all UI/UX design work (layout, components, visual polish). Pair it with the built-in `frontend-design` skill for the environment's styling constraints. Consult the skill **before** building any screen, not after.

### Hard architectural rule `[REQ]`

All Linear and GitHub API calls happen in **Rust**, not the webview. The Rust core holds the tokens, executes GraphQL/REST, writes results to SQLite, and exposes typed Tauri commands to the frontend. The webview is a pure consumer of local data + command results. This keeps tokens out of the renderer and makes the cache authoritative.

### UI & design direction `[REQ]`

The app should look and feel like **Linear itself** — the user lives in Linear all day and wants visual continuity, not a different-looking client. Target this aesthetic:

- **Dark-first**, with a near-black background, low-chroma neutral grays, and a single saturated accent (Linear's is a blue/indigo-purple). Provide a light theme as secondary `[CHOICE]`.
- **Dense but calm:** tight vertical rhythm, generous use of subtle 1px hairline borders and very low-contrast surfaces to separate regions rather than heavy cards/shadows.
- **Typography:** Inter (or the system UI stack) `[CHOICE]`, small base size (~13–14px), medium weight for labels, high legibility. No decorative fonts.
- **Snappy and keyboard-driven:** instant transitions (no slow animations), hover affordances, and a **Cmd/Ctrl+K command palette** as a first-class navigation primitive `[CHOICE but strongly encouraged]`.
- **Motion is minimal and functional** — the one place expressive motion is welcome is `gooey-toast` notifications. Everything else stays quick and understated.
- Component patterns to mirror: the right-side **issue detail panel** (matches F2's drawer), compact list rows with state dots, inline editable fields, and quiet empty states.

Use the `ui-ux-pro-max` skill to execute this direction; this section is the *intent*, the skill is the *how*. When in doubt about a component, match how Linear does it.

### Assets (icons & favicons) `[REQ]`

Canonical asset source is the in-repo folder **`public/icons/`** (the approved assets — currently the `icons8-star-liquid-glass-*` set). Use what's there before generating or importing new icon sets. For M0: generate the Tauri app/bundle icon from the **310px** file (`icons8-star-liquid-glass-310.png`) and wire the web favicon from the **32px/96px** files. If a needed icon is missing from the folder, ask before pulling in an external icon library.

### Time, locale & clock `[REQ]`

- **Base timezone is `Asia/Dhaka` (UTC+6).** All date/time logic — due-date bucketing, the "This Week" agenda week window, and activity-feed grouping ("Today/Yesterday") — is computed in Bangladesh local time, not UTC and not the machine's locale.
- **Week starts on Sunday** (drives the This Week agenda window and any calendar week view).
- **Home view shows a live dual clock:** the user's local **Dhaka** time and **Germany** time side by side. Use the `Europe/Berlin` IANA zone so CET/CEST daylight-saving shifts are handled automatically — do **not** hard-code a fixed UTC offset. Update at least once per minute (per second is fine). Label each clock with its city/zone.

---

## 4. Authentication

### Linear `[CHOICE: personal API key]`

Phase 1 uses a **Linear personal API key** (user generates it at Linear → Settings → Security & access → Personal API keys). It's the fastest path for a single-user tool and avoids running an OAuth callback server.

- Store the key in the OS keychain on first run via a settings screen.
- Send it as the `Authorization` header (the raw key, no `Bearer` prefix — Linear personal keys are sent as-is; verify against current docs).
- Endpoint: `https://api.linear.app/graphql`.
- `[EXT]` OAuth2 flow for multi-account later. Don't build it now, but keep the auth module behind a trait/interface so a second provider can slot in.

### GitHub `[CHOICE: classic PAT]`

A **classic personal access token** with `repo` scope (private-repo visibility); add `read:org` only if org/team membership is queried or testing proves it is required. Stored in the keychain (account `github_token`) and sent as `Authorization: Bearer <token>`. Optional — the app degrades gracefully if no token is set (the dashboard shows a "Connect GitHub" prompt). Classic (not fine-grained) is chosen because fine-grained tokens cannot reliably cover arbitrary collaborations; document the broad-access trade-off and the SAML-SSO authorization requirement.

---

## 5. Data model (SQLite)

The local DB is a **cache + a small amount of app-owned data**. Linear is the source of truth for issues; the app owns doc links, sync cursors, and settings.

```sql
-- Cached Linear issues
CREATE TABLE issues (
  id           TEXT PRIMARY KEY,      -- Linear issue id (UUID)
  identifier   TEXT NOT NULL,         -- e.g. "ENG-123"
  title        TEXT NOT NULL,
  description  TEXT,                  -- markdown
  due_date     TEXT,                  -- ISO date or NULL
  priority     INTEGER,               -- 0..4
  estimate     REAL,
  url          TEXT NOT NULL,
  state_id     TEXT,
  state_name   TEXT,
  state_type   TEXT,                  -- backlog|unstarted|started|completed|canceled
  state_color  TEXT,
  assignee_id  TEXT,
  assignee_name TEXT,
  team_id      TEXT,
  team_key     TEXT,
  project_id   TEXT,
  project_name TEXT,
  cycle_id     TEXT,
  parent_id    TEXT,                  -- for hierarchy
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,         -- used as sync cursor
  synced_at    TEXT NOT NULL,
  raw_json     TEXT                   -- full node, for fields not yet modeled
);
CREATE INDEX idx_issues_due ON issues(due_date);
CREATE INDEX idx_issues_assignee ON issues(assignee_id);
CREATE INDEX idx_issues_parent ON issues(parent_id);
CREATE INDEX idx_issues_updated ON issues(updated_at);

CREATE TABLE labels (
  issue_id TEXT NOT NULL,
  label_id TEXT NOT NULL,
  name     TEXT,
  color    TEXT,
  PRIMARY KEY (issue_id, label_id)
);

-- blocks / blocked_by / related / duplicate (denormalized for agenda rendering; added M3)
CREATE TABLE relations (
  issue_id              TEXT NOT NULL,
  related_issue_id      TEXT NOT NULL,
  type                  TEXT NOT NULL,   -- blocks | blocked_by | related | duplicate
  related_identifier    TEXT,
  related_title         TEXT,
  related_state_name    TEXT,
  related_state_type    TEXT,
  related_state_color   TEXT,
  PRIMARY KEY (issue_id, related_issue_id, type)
);
CREATE INDEX idx_relations_issue ON relations(issue_id);

CREATE TABLE comments (
  id         TEXT PRIMARY KEY,
  issue_id   TEXT NOT NULL,
  body       TEXT,
  user_id    TEXT,
  user_name  TEXT,
  created_at TEXT NOT NULL
);

-- Normalized activity feed (feature 4). Built from issue history + comments.
CREATE TABLE activity (
  id         TEXT PRIMARY KEY,
  issue_id   TEXT NOT NULL,
  type       TEXT NOT NULL,          -- state_change|assigned|comment|created|due_changed|...
  actor_id   TEXT,
  actor_name TEXT,
  summary    TEXT,                   -- human-readable, pre-rendered
  from_value TEXT,
  to_value   TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_activity_created ON activity(created_at);

-- App-owned: docs & links per issue (feature 9). Local-only, richer than Linear attachments.
CREATE TABLE doc_links (
  id         TEXT PRIMARY KEY,        -- app-generated UUID
  issue_id   TEXT NOT NULL,
  url        TEXT NOT NULL,
  title      TEXT,
  note       TEXT,
  tags       TEXT,                    -- comma-separated or JSON array
  created_at TEXT NOT NULL
);
CREATE INDEX idx_doclinks_issue ON doc_links(issue_id);

-- GitHub PRs — viewer/bucket-centric (feature 7, M4)
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
  truncated      INTEGER NOT NULL,     -- bool: cap (300) was hit
  last_synced_at TEXT
);

-- Sync bookkeeping
CREATE TABLE sync_cursors (
  source TEXT NOT NULL,               -- "linear_issues" | "github" | ...
  key    TEXT NOT NULL,               -- e.g. "last_updated_at"
  value  TEXT,
  PRIMARY KEY (source, key)
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
```

`[REQ]` Secrets are **never** stored in these tables. Keychain only.

---

## 6. Sync strategy

- **Initial sync:** pull **all issues across all teams in the `GAM Health Solutions` workspace** (resolved scope — not limited to the user's teams or their own assignments). Page through `issues` 100 at a time, upsert into `issues`/`labels`/`relations`/`comments`. If the personal API key has access to more than one organization, filter to GAM Health Solutions; if it's the only workspace, no filter is needed.
- **Incremental sync:** store the max `updatedAt` seen in `sync_cursors`. On refresh, query `issues(filter: { updatedAt: { gt: $cursor } })` and upsert. This keeps refreshes cheap.
- **Trigger:** manual "refresh" button + a configurable interval poll (default 5 min) `[CHOICE]`. `[EXT]` Linear webhooks via a relay later — not now.
- **GitHub sync:** background refresh on dashboard open + a 5-minute poll while open; each bucket is fetched to completion (cap 300, `sort:updated-desc`) and committed in one transaction (delete+insert+meta), so a partial/failed fetch never empties a bucket. Rate limits: parse GraphQL `errors` on HTTP 200, treat throttled 403 as rate-limited.
- **Rate limits:** Linear uses complexity-based rate limiting — keep query depth modest, request only needed fields, and back off on `429`. Surface a non-blocking toast if throttled.

---

## 7. Linear GraphQL reference

> Verify field names against live introspection before relying on these. Representative, not authoritative.

**Identify the current user (for "me" filters and activity):**
```graphql
query { viewer { id name email } }
```

**Issue list (paged), with everything the cache needs:**
```graphql
query Issues($after: String, $filter: IssueFilter) {
  issues(first: 100, after: $after, filter: $filter) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id identifier title description dueDate priority estimate url
      createdAt updatedAt
      state { id name type color }
      assignee { id name }
      team { id key }
      project { id name }
      cycle { id }
      parent { id }
      labels { nodes { id name color } }
      relations { nodes { type relatedIssue { id identifier } } }
      attachments { nodes { id title subtitle url sourceType metadata } }
    }
  }
}
```

**Calendar query (feature 1):** reuse the above with
`filter: { dueDate: { gte: $monthStart, lte: $monthEnd } }`
(plus optional `assignee`, `team`, `project` filters from the UI).

**"My" issues (features 5, 6, "my activity"):**
`filter: { assignee: { isMe: { eq: true } } }`

**Single issue detail with comments + history (feature 2, 4):**
```graphql
query Issue($id: String!) {
  issue(id: $id) {
    id identifier title description dueDate priority estimate url
    state { id name type color } assignee { id name }
    parent { id identifier title }
    children { nodes { id identifier title state { name type } } }
    relations { nodes { type relatedIssue { id identifier title state { type } } } }
    comments { nodes { id body createdAt user { id name } } }
    history {
      nodes {
        id createdAt
        actor { id name }
        fromState { name } toState { name }
        fromAssignee { name } toAssignee { name }
        # introspect for the full set of from*/to* fields available
      }
    }
    attachments { nodes { id title subtitle url sourceType metadata } }
  }
}
```

**Reschedule (feature 3) & inline edits (feature 2):**
```graphql
mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
  issueUpdate(id: $id, input: $input) {
    success
    issue { id dueDate updatedAt state { id name } assignee { id name } }
  }
}
```
- Drag-to-reschedule → `input: { dueDate: "YYYY-MM-DD" }`.
- Drawer edits → `stateId`, `assigneeId`, `priority`, `title`, `description`, etc.

`[REQ]` After any mutation, upsert the returned issue into SQLite so the cache stays consistent without a full resync.

---

## 8. GitHub PR dashboard (feature 7)

The PR dashboard is viewer-centric: it shows open PRs that involve *you* (the authenticated GitHub user), organized into four buckets via `@me` GraphQL search filters:

| Bucket | Search query |
| --- | --- |
| Needs my review | `is:pr is:open review-requested:@me sort:updated-desc` |
| My open PRs | `is:pr is:open author:@me sort:updated-desc` |
| Assigned to me | `is:pr is:open assignee:@me sort:updated-desc` |
| Involved/mentioned | `is:pr is:open involves:@me -author:@me -assignee:@me -review-requested:@me sort:updated-desc` |

Each bucket is capped at the 300 most recently updated PRs. The `involved` bucket is the *remainder* — `involves:@me` minus the other three via negative qualifiers, so it never overlaps them. Overlap among the other three is intentional and allowed.

**Linear correlation** is demoted to an optional convenience chip: when a PR's `headRefName` or `title` contains a Linear issue identifier (matched case-insensitively with `\b[A-Z][A-Z0-9]*-\d+\b`, then normalized to uppercase), the row shows a chip that opens that issue's tab inside Astryn. The identifier is extracted at sync time and stored in `github_prs.linear_identifier`; the join to `issues.identifier` happens at read time in `list_github_prs`, so it automatically follows Linear cache rebuilds. If no GitHub token: the dashboard shows a "Connect GitHub" prompt; no error state.

---

## 9. Feature specs

Each feature lists **data source → behavior → acceptance criteria (AC)**.

### F1 — Calendar view `[REQ]`
- **Data:** `issues` table filtered by `due_date` within the visible range.
- **Behavior:** month/week views (FullCalendar). Issues without a due date go in an "Unscheduled" side rail. Color by `state_type` or priority (toggle). Filters: team, assignee (default = me), project. Overdue + unscheduled visually flagged.
- **AC:** opening the app shows the current month populated from cache within ~100ms; switching month triggers a scoped fetch only if that range isn't cached; filters update the view without a full reload.

### F2 — Issue detail drawer `[REQ]`
- **Data:** `issue(id)` query (live) + cached fallback.
- **Behavior:** clicking any issue (calendar, list, graph) opens a right-side drawer (ClickUp-style, non-modal — calendar stays interactive). Shows title, description (rendered markdown), state, assignee, priority, labels, project/cycle, sub-issues, relations, comments, linked PRs (F7), doc links (F9). Inline-editable: state, assignee, priority, due date, title, description. Edits call `issueUpdate` and optimistically update cache.
- **AC:** drawer opens over cached data instantly, then hydrates from the live query; editing a field persists to Linear and the change survives a refresh; closing/reopening shows the updated value.

### F3 — Draggable calendar tasks `[REQ]`
- **Behavior:** drag an event to another day → `issueUpdate { dueDate }`. Drag from "Unscheduled" rail onto a day to set a due date. Optimistic move with rollback on API failure (toast on error).
- **AC:** dropped issue's due date updates in Linear; on simulated API failure the event snaps back and an error toast shows.

### F4 — My activity timeline `[REQ]`
- **Data:** `activity` table, built by transforming `issue.history` + `comments` for issues where actor = viewer, ordered by `created_at` desc.
- **Behavior:** chronological feed grouped by day ("Today / Yesterday / earlier"), each entry deep-links to the issue (opens F2 drawer). Entry types: created, state change, reassigned, due date changed, commented, completed.
- **AC:** the feed reflects actions the user took in Linear (verify with a real state change), newest first, grouped by day; clicking an entry opens that issue.

### F5 + F6 — "This Week" agenda (replaces original standup + weekly generators) `[REQ]` ✅ Done (M3)

> Design doc: `docs/superpowers/specs/2026-06-21-this-week-agenda-design.md`

The original F5 (daily standup: Done / In-progress / Blocked buckets) and F6 (weekly review: Completed / Carried / New buckets) are **replaced** by a single in-app structured view called **"This Week"**. Markdown export and the no-op `polish()` seam are dropped — output is an interactive view, not generated text.

- **Data:** viewer's issues (assignee = me, via cached `viewer_id` from `settings`) where `due_date` falls within the current work week or is overdue, computed in **`Asia/Dhaka`**, week starting **Sunday**. Issues without a due date are omitted.
- **Day groups (render order):**
  1. **Overdue** — `due_date` < this Sunday **and** `state_type` not `completed`/`canceled`. Shown only when non-empty. Sorted by due date ascending.
  2. **Sunday → Thursday** — one section per weekday; issues whose `due_date` equals that calendar day (any state). Each weekday section always renders even when empty, showing a quiet "Nothing due" line.
  3. **Weekend** — Friday/Saturday of this week. Shown only when non-empty.
  - Within a day group: sorted by priority (high→low), then identifier. Group headers are **sticky** while scrolling and show day name · date · muted count badge.
- **Threaded content** under each top-level row: sub-issues (children via `parent_id`, rendered as compact `IssueRow`s, expanded by default) and related issues (from the `relations` cache: relation type · identifier · title · state chip). **Dedup rule:** if a sub-issue is itself one of *my* issues due this week, it appears only nested — not also as a standalone row.
- **Navigation:** a new dock/sidebar **"This Week"** entry + a command-palette **"Go to This Week"** action. Clicking any issue (top-level or sub-issue) opens the existing **F2 drawer**.
- **Offline-first:** reads cache only — shows data without network; manual resync updates via existing sync path.
- **States:** loading → skeleton rows; whole-week empty → calm centered empty state.
- **Reuse:** top-level and sub-issue rows use the shared `IssueRow` component (compact variant for sub-issues).
- **Frontend:** `src/features/agenda/`. Week-window math via a new `weekWindow(now)` helper in `src/lib/dates.ts` (Sunday-started, `Asia/Dhaka`). Grouping and rendering in the frontend; data assembly in Rust (`generators/` module, `get_week_agenda` command).
- **AC:** groups match due dates in Dhaka time; Sunday week start; Overdue/Weekend sections shown only when non-empty; sub-issues threaded and deduped; relations shown per issue; clicking any row opens the F2 drawer; cache-only reads keep the view available offline.

### F7 — GitHub PR dashboard `[REQ]`
- A standalone view with four sections (needs-my-review, my open PRs, assigned, involved), each row showing title, #number, author, comments, repo, updated time, and status/CI/conflict/review badges; a Linear chip when the branch/title identifier matches a cached issue.
- **AC:** with a token, sections populate; with none, a connect prompt shows without errors; a sync failure leaves the previous cache intact; setting/clearing the token never disturbs the Linear cache.

### F8 — Issue web / hierarchy viz `[REQ]`
- **Data:** `issues.parent_id` (tree) + `relations` (cross-links).
- **Behavior:** React Flow graph. Parent→child as the primary tree; relations (blocks/blocked-by/related/duplicate) as styled edges. Node = issue card (identifier, title, state color). Click a node → F2 drawer. Start from a focused issue and expand neighbors, or render a whole project's tree.
- **AC:** selecting an issue renders its parent/children and relations correctly; clicking a node opens its drawer; layout is readable for at least ~50 nodes.

### F9 — Related docs & link storage `[REQ]`
- **Data:** `doc_links` table (app-owned, local).
- **Behavior:** in the drawer, an "Docs & links" section to add a URL with optional title, note, and tags; list/edit/delete. Local-first (survives offline). `[CHOICE]` optional "also push to Linear as an attachment" toggle via `attachmentCreate`.
- **AC:** links persist across restarts; editing/deleting works; they're scoped to the correct issue.

---

## 10. Suggested project structure

```
src-tauri/
  src/
    main.rs
    commands/        # Tauri command handlers (thin)
    linear/          # GraphQL client, queries, types, sync
    github/          # REST client, correlation, status rollups
    db/              # sqlx, migrations, repositories
    secrets/         # keychain wrapper (trait-backed for future providers)
    activity/        # history->activity transformer
    generators/      # This Week agenda builder (get_week_agenda)
  migrations/
src/                 # React frontend
  features/
    calendar/
    drawer/
    timeline/
    agenda/
    graph/
    prs/
  lib/               # tauri command bindings, query hooks
  components/
```

---

## 11. Milestones (ship in this order)

- **M0 — Scaffold. ✅ Done.** Tauri v2 + React + Tailwind v4 + shadcn/ui + SQLite migrations + keychain + Linear GraphQL proxy in Rust. App shell/home view with the Dhaka + Germany dual clock. App/web icons wired from `public/icons/`. Smoke test: `viewer` query returns the user's name in the UI. Settings screen to enter/store the Linear key.
- **M1 — Calendar + Drawer + Drag (F1–F3). ✅ Done.** The core loop: see issues, open details, edit, reschedule. Shipped with extensions: list/board views, the full-page issue tab, the two-pane split workspace, the command palette + shortcuts, the inbox, sub-issues, and label create (see *Implementation status* near the top).
- **M2 — Activity timeline (F4). ✅ Done.**
- **M3 — This Week agenda (replaces F5/F6 generators). ✅ Done.** Single in-app view of the viewer's issues by due date (Sunday-started week, `Asia/Dhaka`), with Overdue/weekday/Weekend groups, threaded sub-issues and related issues, and a new `relations` cache table. Markdown export and the `polish` seam are dropped. See `docs/superpowers/specs/2026-06-21-this-week-agenda-design.md`.
- **M4 — GitHub PR dashboard (F7).** Standalone viewer-centric PR dashboard; classic-PAT auth; offline-first per-bucket cache.
- **M5 — Hierarchy/web viz (F8).** Not started.
- **M6 — Doc links (F9).** Not started.

Each milestone must be independently runnable and demoable. Don't start a milestone until the previous one builds and runs.

---

## 12. Cross-cutting requirements `[REQ]`

- **Offline-first:** the app opens and shows cached data with no network. Network is for sync/edits only.
- **Optimistic writes with rollback:** every mutation updates the UI immediately and reverts on failure with a visible error.
- **No secrets in the renderer, DB, logs, or commits.** Keychain only.
- **Errors are surfaced, not swallowed:** non-blocking `gooey-toast` notifications for sync/rate-limit/API errors and optimistic-write rollbacks.
- **Typed boundary:** Tauri commands have explicit input/output types shared with the frontend (generate or hand-maintain TS types).

---

## 13. Decisions

Resolved (locked):

1. **Sync scope:** entire **`GAM Health Solutions`** workspace — all teams, all issues. ✅
2. **Frontend:** React + TypeScript + Vite, Tailwind v4, shadcn/ui. ✅
3. **Week start:** Sunday. ✅
4. **Base timezone:** `Asia/Dhaka` for all date/time logic; home shows a live `Europe/Berlin` (Germany) clock alongside local time. ✅
5. **F5/F6 output (M3 revision):** the original standup/weekly markdown generators and the no-op `polish` seam are **dropped**. F5 + F6 are replaced by the "This Week" structured in-app view (due-date agenda, Sunday-started week, any state). Owner redefined these `[REQ]` items. ✅
6. **Local LLM polish:** dropped along with the markdown generators in M3 — no `polish` seam exists in the shipped design. `[EXT]` if a future text-output mode is added. ✅

Resolved during build:

7. **Linear key header format:** the personal API key is sent **raw** in the `Authorization` header (no `Bearer` prefix). ✅

---

## 14. Non-goals restated `[EXT]`

Slack, Discord, multi-user, OAuth, and local-LLM polish are **not** in this build. Leave clean seams (provider trait for auth, source-agnostic activity table) but implement none of them now. **LLM integration is the immediate next phase** once this Linear build is done. Note: the no-op `polish` hook was removed in M3 when the text generators were replaced by the "This Week" structured view.
