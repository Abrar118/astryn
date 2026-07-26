# Astryn App Dashboard

**Status:** Approved for direct implementation on 2026-07-26.

## 1. Summary

Astryn gains a new first/default destination named **Dashboard**. It is a
personal, action-first command center that summarizes the cached state already
available across Linear, GitHub, Slack, Inbox, and Docs. The existing
`this-week` destination remains intact and is relabeled **This Week**.

The dashboard renders from local cache data immediately and never starts
provider-wide refreshes of its own. Linear keeps the shell's existing sync loop;
GitHub, Slack, and Docs keep their existing page-specific sync behavior. The
dashboard shows cached information and source freshness without weakening
Astryn's offline-first startup.

The chosen visual direction is **Action Command Center**: one ranked attention
queue carries the most visual weight, while compact charts explain workload and
near-term demand. The screen keeps Astryn's dense Linear-style foundation and
adds restrained frosted-glass depth, colorful status accents, and quiet ambient
gradients.

## 2. Goals and non-goals

### Goals

- Answer “What needs my attention now?” within a few seconds.
- Summarize personal Linear work, PR reviews, inbox notifications, Slack
  mentions, documentation availability, and provider status in one view.
- Make summary rows and cards useful navigation shortcuts into the existing
  detailed pages.
- Render cached data independently per provider so one missing or failed source
  never blanks the whole dashboard.
- Work at full desktop width, in Astryn's 320px split-pane minimum, and at
  narrow responsive widths without horizontal page scrolling.
- Preserve keyboard navigation, visible focus, text alternatives for chart
  meaning, and `prefers-reduced-motion`.

### Non-goals

- No new Rust command, migration, provider request, or credential behavior.
- No new chart dependency; the small visualizations use semantic HTML and
  lightweight SVG/CSS.
- No mutations, drag-and-drop, filters, or configurable dashboard widgets.
- No fabricated productivity score or completion trend. The cache does not
  expose enough historical state to make those metrics honest.
- No replacement or redesign of the detailed This Week, Pull Requests, Slack,
  Inbox, Docs, or Reports pages.

## 3. Navigation

- Add `"dashboard"` to `ViewKind` and persisted view validation.
- Make Dashboard the fallback/default tab for a fresh workspace.
- Add Dashboard as the first dock item with the Lucide `LayoutDashboard` icon.
- Rename the current dock label for `"this-week"` from “Overview” to
  “This Week”.
- Add Dashboard and This Week labels/icons to pane tabs and the command palette.
- Dashboard cards and sections navigate with the existing workspace context:
  detailed destinations reuse `setActiveView`; Linear issue rows open the
  existing issue drawer through the `issue` search parameter.
- Existing persisted workspaces remain unchanged. Only new or invalid workspace
  state starts on Dashboard.

## 4. Information architecture

### 4.1 Header

The header contains:

- “Good morning/afternoon/evening, {viewer name}” when the cached viewer is
  available, otherwise “Your workspace”.
- The current Dhaka calendar date.
- The compact existing Dhaka/Germany dual clock. `Asia/Dhaka` and
  `Europe/Berlin` remain IANA timezone values.
- A page-level minute tick refreshes the greeting, date buckets, relative
  freshness, and all date-sensitive metrics if Dashboard remains mounted
  across Dhaka midnight.
- A quiet “Local cache · offline ready” badge. It does not claim an exact
  Linear freshness value that the current command boundary does not expose.

### 4.2 KPI row

Four colorful glass cards show:

1. **Overdue** — active issues assigned to the cached viewer whose `dueDate` is
   before `dhakaToday()`.
2. **Reviews** — distinct GitHub PRs in the `needs_review` bucket.
3. **Inbox** — unread Linear notifications already present in the TanStack
   Query cache. Because the existing notification command is a live provider
   read, Dashboard observes this query with fetching disabled. It shows an em
   dash and links to Inbox when no in-memory result is available.
4. **Mentions** — cached Slack mention messages.

Each card includes a Lucide icon, a text label, the numeric value or an em dash
while unavailable, a one-line explanation, and a destination action. Rose,
violet, cyan, and amber are accents; color is never the only meaning.

### 4.3 Needs your attention

The primary card is a semantic compact table limited to eight rows. Candidates
come from:

- active overdue viewer issues;
- PRs awaiting the viewer's review;
- the viewer's authored PRs with changes requested;
- conflicting PRs;
- Slack mentions;
- unread Linear notifications.

Items use a stable urgency tier:

1. overdue Linear issues, oldest due date first;
2. authored PRs with changes requested or any conflicting PR;
3. PRs awaiting review, newest update first;
4. Slack mentions, newest first;
5. unread inbox notifications, newest first.

Duplicate PRs are collapsed by PR id, keeping their highest urgency. Each row
shows source icon and text, identifier/context, title, urgency/freshness, and a
visible action affordance. Linear rows open the issue drawer; other rows
navigate to their provider page.

When the queue is empty, the card presents a calm “Nothing urgent right now”
state. Loading one provider does not replace already available rows from
another.

### 4.4 Workload and due-load charts

The right rail contains two compact visualizations:

- **Active workload:** horizontal bars for Started, Todo, and Backlog among
  active viewer-assigned issues. Counts and labels are printed beside every
  bar.
- **Next 7 days:** a small bar chart for active viewer issues due today through
  the following six Dhaka dates. Each bar has an accessible label and the
  textual total remains visible.

This is deliberately named “Due load”, not “velocity” or “completed work”.

### 4.5 Lower overview

The lower grid contains:

- **Today & This Week:** up to five active viewer issues due within the current
  Dhaka week, overdue first, then due date and priority. The section links to
  the full This Week destination.
- **Pull request health:** distinct open PRs, needs-review, changes-requested,
  and conflicts using the existing `prStats` semantics.
- **Communication:** unread Inbox, Slack mentions, unread DMs/group DMs, and
  unread threads.
- **Sources:** compact status rows for Linear, GitHub, Slack, and Docs. Linear
  uses the local `connection-status` boundary instead of inferring setup from
  cached viewer identity. Status
  copy distinguishes connected, setup needed, cached/unverified, and
  unavailable. GitHub metadata, Slack `lastSyncedAt`, and docs-source
  `lastSyncedAt` are shown only when present.
- **Quick actions:** compact keyboard-friendly buttons for Calendar, Issues,
  This Week, Pull Requests, Slack, Docs, and Reports.

## 5. Visual system

The dashboard follows repository tokens and Geist typography. The
`ui-ux-pro-max` recommendation for Plus Jakarta Sans is intentionally rejected
because Astryn's `[REQ]` prioritizes Linear continuity and the current app uses
Geist.

Glass treatment is limited to dashboard cards:

- opaque-enough card color for text contrast;
- `backdrop-blur` in the 12–16px range;
- one-pixel light/dark hairline borders;
- a faint inset highlight and restrained shadow;
- 12–14px corner radii, consistent with the existing theme;
- low-opacity indigo/cyan ambient gradients on the page background.

The page remains dark-first but uses light-theme-safe card opacity and borders.
Accent gradients belong inside charts, icon wells, and KPI highlights; body
text and table surfaces stay neutral. Hover states change border/background
color without scaling or shifting layout. Transitions stay between 100–200ms
and are disabled under `prefers-reduced-motion`.

Only Lucide icons are used. There are no emoji icons, guessed provider logos, or
new external assets.

## 6. Component and data boundaries

### `src/features/dashboard/dashboard.ts`

Pure derivation functions own dashboard semantics:

- `dashboardMetrics(...)`
- `attentionItems(...)`
- `workloadBuckets(...)`
- `dueLoad(...)`
- `weekPreview(...)`

They accept typed cached command results plus explicit `viewerId` and
`today` inputs. Date-sensitive tests therefore use fixed literals rather than
the machine clock. The functions contain no React, Tauri, or query behavior.

### `src/features/dashboard/DashboardPage.tsx`

The container reads existing hooks and passes their data to presentational
sections. It does not call `useGithubSync`, `useSlackSync`, or `useDocsSync`.
Navigation is injected from `useWorkspace` and `useSearchParams`.

Small presentational components remain colocated unless they become large
enough to obscure the page:

- KPI card;
- attention table;
- workload bars;
- due-load chart;
- overview/source cards;
- quick-action button.

No new cross-feature utility module is introduced.

## 7. Loading, empty, and error behavior

- KPI cards show an em dash and “Reading cache…” while a cache-backed source is
  loading. Inbox shows an em dash and “Open Inbox to read” when its live query
  has not already populated the in-memory query cache.
- Loaded providers render immediately even if another provider is pending.
- A source query failure marks only the related source status as unavailable.
  Stale cached values returned by TanStack Query remain visible; when no data
  exists, cards show an em dash and the attention queue reports a partial
  unavailable state instead of a false zero or calm queue.
- Empty counts render as `0`, not as loading.
- Empty tables and charts use quiet explanatory copy.
- Setup-needed states link to Settings or the relevant provider page.
- The dashboard itself does not create toasts because it performs no network or
  mutation action.

## 8. Accessibility and responsiveness

- Page landmarks use `main`, `header`, `section`, and a real `table`.
- Every section has an accessible heading; chart groups have text summaries and
  per-bar labels.
- Every clickable card/row is a real `button` with `cursor-pointer`, visible
  focus, and stable hover treatment.
- Source/tone meaning is conveyed by icon, label, and copy in addition to color.
- Ambient decoration is `aria-hidden`.
- Dashboard uses a named inline-size container so layout responds to its pane,
  not the application window. At wide pane widths the attention table spans
  roughly two thirds and charts one third; a 320px split pane remains one
  column.
- KPI cards flow 4 → 2 → 1 columns by pane width. Lower overview cards flow
  2 → 1 columns.
- Text truncates inside bounded cells; the page itself has no horizontal
  overflow.

## 9. Testing and verification

### Pure derivation tests

- viewer scoping and active-state filtering;
- Dhaka-date overdue boundary (`dueDate === today` is not overdue);
- PR deduplication and urgency precedence;
- deterministic attention ordering and eight-row cap;
- fixed three-bucket workload counts;
- seven exact due-load dates and counts;
- week-preview ordering and limit.

### Component tests

- cached metrics and attention rows render from mocked query hooks;
- a Linear attention row opens the existing issue drawer parameter;
- a provider card/row navigates to the expected existing view;
- partial provider loading keeps available sections visible;
- no-data state renders accessible empty copy.

### Navigation regression tests

- a fresh workspace defaults to Dashboard;
- persisted Dashboard tabs survive parsing;
- command-palette Dashboard and This Week actions navigate to the right views.

### Verification commands

Run the focused Vitest files first, then:

```bash
npx tsc --noEmit
npm test
npm run build
git diff --check
```

Manual verification, when the environment permits, uses `npm run tauri dev` at
full width and in a narrow split pane. Manual behavior is reported as untested
if the desktop flow cannot be launched.
