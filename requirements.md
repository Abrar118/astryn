# Astryn — Design & Handoff Doc

**Product:** Astryn — a local-first Linear power client (Phase 1 of a personal command center)
**Audience:** Claude Code (implementing agent)
**Owner:** Abrar
**Status:** Ready to build, Phase 1 (Linear only)
**Last updated:** 2026-06-18

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

The user already lives in Linear for issue tracking at work. The point of this app is a faster, richer, single-pane view: a real calendar, inline detail editing, generated standup/review lists, GitHub PR status tied to issues, and issue-graph visualization.

---

## 2. Scope

### In scope (Phase 1) `[REQ]`

1. **Calendar view** of issues by due date.
2. **Side-drawer issue details** (ClickUp-style) opened on click, with inline editing.
3. **Draggable calendar tasks** — drag an issue to a new day to reschedule its due date.
4. **"My activity" timeline** — a chronological feed of the user's own actions/changes.
5. **Daily standup list generator.**
6. **Weekly review list generator.**
7. **GitHub PR & branch tracking** — PR status correlated to the issue it belongs to.
8. **Issue web / hierarchy visualization** — parent/child + relations as a graph.
9. **Related docs & link storage** per issue (local-first).

### Out of scope `[EXT]`

- Slack and Discord integration (Phase 2).
- Multi-user / team sharing. This is a single-user personal tool.
- Writing standup/review output back to Slack/Discord (Phase 2 hook only).
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

- **Base timezone is `Asia/Dhaka` (UTC+6).** All date/time logic — due-date bucketing, the standup "last 24h" window, the weekly window, and activity-feed grouping ("Today/Yesterday") — is computed in Bangladesh local time, not UTC and not the machine's locale.
- **Week starts on Sunday** (drives the F6 weekly window and any calendar week view).
- **Home view shows a live dual clock:** the user's local **Dhaka** time and **Germany** time side by side. Use the `Europe/Berlin` IANA zone so CET/CEST daylight-saving shifts are handled automatically — do **not** hard-code a fixed UTC offset. Update at least once per minute (per second is fine). Label each clock with its city/zone.

---

## 4. Authentication

### Linear `[CHOICE: personal API key]`

Phase 1 uses a **Linear personal API key** (user generates it at Linear → Settings → Security & access → Personal API keys). It's the fastest path for a single-user tool and avoids running an OAuth callback server.

- Store the key in the OS keychain on first run via a settings screen.
- Send it as the `Authorization` header (the raw key, no `Bearer` prefix — Linear personal keys are sent as-is; verify against current docs).
- Endpoint: `https://api.linear.app/graphql`.
- `[EXT]` OAuth2 flow for multi-account later. Don't build it now, but keep the auth module behind a trait/interface so a second provider can slot in.

### GitHub `[CHOICE: fine-grained PAT]`

A **fine-grained personal access token** with read access to the relevant repos (Pull requests: read, Contents: read, Checks: read). Stored in the keychain alongside the Linear key. Optional — the app must degrade gracefully if no GitHub token is set (feature 7 simply shows "GitHub not connected").

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

-- blocks / blocked_by / related / duplicate
CREATE TABLE relations (
  issue_id        TEXT NOT NULL,
  related_issue_id TEXT NOT NULL,
  type            TEXT NOT NULL,
  PRIMARY KEY (issue_id, related_issue_id, type)
);

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

-- GitHub PRs correlated to issues (feature 7)
CREATE TABLE github_prs (
  id            TEXT PRIMARY KEY,     -- "{repo}#{number}"
  issue_id      TEXT,                 -- may be NULL if correlation fails
  repo          TEXT NOT NULL,        -- "owner/name"
  number        INTEGER NOT NULL,
  title         TEXT,
  state         TEXT,                 -- open|closed
  draft         INTEGER,              -- bool
  merged        INTEGER,              -- bool
  mergeable     TEXT,                 -- mergeable|conflicting|unknown
  ci_status     TEXT,                 -- success|failure|pending|none
  review_state  TEXT,                 -- approved|changes_requested|review_required|none
  branch        TEXT,
  url           TEXT,
  updated_at    TEXT,
  synced_at     TEXT NOT NULL
);
CREATE INDEX idx_prs_issue ON github_prs(issue_id);

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
- **GitHub sync:** on demand when an issue with linked PRs is viewed, plus a background refresh of PRs for issues in "started" state. Respect GitHub rate limits (conditional requests / ETags where possible).
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

## 8. GitHub correlation (feature 7)

**Finding PRs for an issue — two sources, combined:**

1. **From Linear:** linked PRs appear in `issue.attachments` where `sourceType` indicates GitHub. Parse the PR URL → `owner/repo` + number. This is the reliable primary source.
2. **Fallback by identifier:** Linear's branch/PR convention embeds the issue identifier (e.g. `ENG-123`) in branch names and PR titles. If attachments are missing, you may search GitHub for the identifier — but treat this as secondary and lower-confidence.

**Enrich with live status via GitHub REST:**
- PR object → `GET /repos/{owner}/{repo}/pulls/{number}` → `state`, `draft`, `merged`, `mergeable`, head `sha`, `head.ref` (branch).
- CI → `GET /repos/{owner}/{repo}/commits/{sha}/check-runs` → roll up to `success|failure|pending`.
- Reviews → `GET /repos/{owner}/{repo}/pulls/{number}/reviews` → reduce to `approved|changes_requested|review_required`.

Store the rolled-up result in `github_prs`. In the issue drawer, render a compact PR badge row (state + CI + review). If no GitHub token: show a "Connect GitHub" affordance instead.

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

### F5 — Daily standup generator `[REQ]`
- **Data:** issues where `assignee = me`, bucketed: **Done** (moved to a completed state in the last 24h), **In progress** (state_type = started), **Blocked** (has a `blocked_by` relation that isn't completed, or a "blocked" label). The 24h window is computed in **`Asia/Dhaka`** local time.
- **Behavior:** one-click "Generate standup" → under each bucket heading, **list the matching tasks as `IDENTIFIER — Title` lines only**. For now, titles only — no descriptions, estimates, or other per-item detail. Copy-to-clipboard as markdown. `[EXT — next step]` LLM polish via local Ollama — do **not** implement now; route output through a no-op `polish(text): text` seam. `[EXT]` post to Slack/Discord.
- **AC:** buckets are filtered correctly against the cache using Dhaka-local time; rendered output is title-only lines; markdown copy round-trips cleanly; the `polish` hook returns its input unchanged.

### F6 — Weekly review generator `[REQ]`
- **Data:** 7-day window for a **Sunday-started week**, computed in **`Asia/Dhaka`**: **Completed this week**, **Carried over** (started but not done), **New this week**. `[EXT]` count summary (completed vs. opened) later.
- **Behavior:** mirrors F5 — under each bucket heading, **list matching tasks as `IDENTIFIER — Title` lines only** (titles only for now). Copy-to-markdown. Same no-op `polish` seam as F5.
- **AC:** the week window starts Sunday in Dhaka-local time and bounds the buckets correctly; each bucket lists the right task titles; markdown copy round-trips.

### F7 — GitHub PR & branch tracking `[REQ]`
- See §8. Render per-issue PR badges in the drawer; add an optional global "PRs" view listing all open PRs grouped by issue with status.
- **AC:** an issue with a linked PR shows correct state/CI/review badges; an issue with none shows nothing; with no token the feature degrades to a connect prompt without errors.

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
    generators/      # standup + weekly builders
  migrations/
src/                 # React frontend
  features/
    calendar/
    drawer/
    timeline/
    standup/
    review/
    graph/
    prs/
  lib/               # tauri command bindings, query hooks
  components/
```

---

## 11. Milestones (ship in this order)

- **M0 — Scaffold.** Tauri v2 + React + Tailwind v4 + shadcn/ui + SQLite migrations + keychain + Linear GraphQL proxy in Rust. App shell/home view with the Dhaka + Germany dual clock (no issue data needed). Favicon/app icon wired from `/Users/orion-abrar/Downloads/web`. Smoke test: `viewer` query returns the user's name in the UI. Settings screen to enter/store the Linear key.
- **M1 — Calendar + Drawer + Drag (F1–F3).** The core loop: see issues, open details, edit, reschedule. This alone is more than LinCal does.
- **M2 — Activity timeline (F4).**
- **M3 — Standup + Weekly generators (F5, F6).**
- **M4 — GitHub PR tracking (F7).**
- **M5 — Hierarchy/web viz (F8).**
- **M6 — Doc links (F9).**

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
5. **Standup/weekly output:** titles only (`IDENTIFIER — Title`) for now; richer formatting and counts are `[EXT]`. ✅
6. **Local LLM polish:** deferred to the next phase — not Phase 1. Only the no-op `polish` seam exists now. ✅

Still open (resolve at build time):

7. **Linear key header format:** confirm the current expected `Authorization` header form against live Linear docs before wiring auth.

---

## 14. Non-goals restated `[EXT]`

Slack, Discord, multi-user, OAuth, local-LLM polish, and outbound posting of standup/review are **not** in this build. Leave clean seams (provider trait for auth, source-agnostic activity table, no-op `polish` hook) but implement none of them now. **LLM integration is the immediate next phase** once this Linear build is done.
