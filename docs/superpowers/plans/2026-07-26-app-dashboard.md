# Astryn App Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a cache-first, action-oriented Dashboard as Astryn's new default destination while preserving the detailed This Week page.

**Architecture:** Pure functions in `src/features/dashboard/dashboard.ts` derive honest personal metrics, attention items, workload buckets, due load, and a week preview from existing typed cache results. `DashboardPage.tsx` consumes existing TanStack Query hooks and renders the selected frosted Action Command Center layout without starting provider syncs or adding a chart library. Existing workspace, dock, pane-tab, and command-palette wiring gain a `dashboard` view.

**Tech Stack:** React 19, TypeScript 5.8 strict mode, TanStack Query 5, Tailwind CSS 4, Lucide React, Vitest, Testing Library.

## Global Constraints

- The implementation is frontend-only: no Rust, migration, IPC, capability, CSP, or dependency changes.
- Dashboard reads existing cached queries and must not call `useGithubSync`, `useSlackSync`, or `useDocsSync`.
- Product dates use `Asia/Dhaka`; the week starts Sunday.
- `Europe/Berlin` remains the Germany clock timezone.
- Existing persisted workspaces stay on their saved view; only fresh/invalid workspace state defaults to Dashboard.
- The existing `this-week` page remains behaviorally unchanged and is relabeled “This Week”.
- Use Geist and existing theme tokens; no external fonts, provider logos, emoji icons, or image assets.
- Preserve unrelated `.quickdev.toml` and `.codex/` working-tree changes.
- Do not commit, push, or open a PR; the repository instructions require explicit user authorization for those actions.

---

### Task 1: Dashboard navigation and default workspace

**Files:**
- Modify: `src/lib/paneModel.test.ts`
- Modify: `src/lib/paneModel.ts`
- Modify: `src/features/command/CommandPalette.test.tsx`
- Modify: `src/features/command/CommandPalette.tsx`
- Modify: `src/components/Dock.tsx`
- Modify: `src/components/PaneTabStrip.tsx`
- Modify: `src/components/SplitLayout.tsx`

**Interfaces:**
- Produces: `ViewKind` includes `"dashboard"`.
- Produces: `FALLBACK.panes[0].tabs[0].view === "dashboard"`.
- Produces: dock, pane tabs, and command palette expose Dashboard and label `"this-week"` as “This Week”.
- Consumes later: `SplitLayout` imports and renders `DashboardPage`.

- [ ] **Step 1: Write failing navigation tests**

Add assertions to `src/lib/paneModel.test.ts` that name the observable regressions:

```ts
it("starts a fresh workspace on the dashboard", () => {
  expect(parsePersisted(null).panes[0].tabs[0].view).toBe("dashboard");
});

it("preserves a persisted dashboard tab", () => {
  const state = parsePersisted(JSON.stringify({
    panes: [{
      id: "pane-0",
      tabs: [{ id: "tab-0", view: "dashboard" }],
      activeTabId: "tab-0",
    }],
    focusedPaneId: "pane-0",
    ratio: 0.5,
    seq: 1,
  }));
  expect(state.panes[0].tabs[0].view).toBe("dashboard");
});
```

Extend `src/features/command/CommandPalette.test.tsx`:

```ts
it("the Dashboard command switches to the dashboard view", () => {
  fireEvent.click(screen.getByText("Go to Dashboard"));
  expect(setActiveView).toHaveBeenCalledWith("dashboard");
});

it("labels the existing agenda command as This Week", () => {
  fireEvent.click(screen.getByText("Go to This Week"));
  expect(setActiveView).toHaveBeenCalledWith("this-week");
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
npm test -- src/lib/paneModel.test.ts src/features/command/CommandPalette.test.tsx
```

Expected: failures because `"dashboard"` is not a `ViewKind`, the fallback is still `"calendar"`, and no Dashboard command exists.

- [ ] **Step 3: Implement navigation wiring**

Update the workspace contract:

```ts
export type ViewKind =
  | "dashboard"
  | "calendar"
  | "list"
  | "this-week"
  | "graph"
  | "inbox"
  | "prs"
  | "slack"
  | "docs"
  | "reports"
  | "settings"
  | "issue";

export const VIEWS: ViewKind[] = [
  "dashboard",
  "calendar",
  "list",
  "this-week",
  "graph",
  "inbox",
  "prs",
  "slack",
  "docs",
  "reports",
  "settings",
  "issue",
];

export const FALLBACK: WorkspaceState = {
  panes: [{
    id: "pane-0",
    tabs: [{ id: "tab-0", view: "dashboard" }],
    activeTabId: "tab-0",
  }],
  focusedPaneId: "pane-0",
  ratio: 0.5,
  seq: 1,
};
```

Add a first `LayoutDashboard` dock item, rename the `"this-week"` label to
`"This Week"` in `NAV` and `META`, add matching pane-tab icon/label branches,
and add these command-palette actions:

```ts
{
  key: "go-dashboard",
  section: "Go to",
  icon: <LayoutDashboard className="size-4" />,
  label: "Go to Dashboard",
  onSelect: () => goTo("dashboard"),
},
{
  key: "go-this-week",
  section: "Go to",
  icon: <CalendarRange className="size-4" />,
  label: "Go to This Week",
  onSelect: () => goTo("this-week"),
},
```

Add `case "dashboard": return <DashboardPage />;` to `PaneContent`. Create a
temporary exported `DashboardPage` returning `null` only if TypeScript needs the
module before Task 3; remove that stub when the real page is written.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
npm test -- src/lib/paneModel.test.ts src/features/command/CommandPalette.test.tsx
```

Expected: all focused navigation tests pass.

---

### Task 2: Cache-derived dashboard model

**Files:**
- Create: `src/features/dashboard/dashboard.test.ts`
- Create: `src/features/dashboard/dashboard.ts`

**Interfaces:**
- Consumes: `IssueListItem[]`, `GithubPr[]`, `Notification[]`, `SlackCatchup | undefined`.
- Produces:

```ts
export type DashboardMetrics = {
  overdue: number;
  reviews: number;
  inbox: number;
  mentions: number;
};

export type AttentionItem = {
  key: string;
  source: "linear" | "github" | "slack" | "inbox";
  target: "issue" | "prs" | "slack" | "inbox";
  entityId: string | null;
  context: string;
  title: string;
  detail: string;
  tone: "danger" | "warning" | "violet" | "cyan";
  rank: number;
  sortAt: string;
};

export type WorkloadBucket = {
  key: "started" | "unstarted" | "backlog";
  label: string;
  count: number;
  color: string;
};

export type DueLoadDay = {
  date: string;
  label: string;
  count: number;
};

export function dashboardMetrics(input: DashboardInput): DashboardMetrics;
export function attentionItems(input: DashboardInput, limit?: number): AttentionItem[];
export function workloadBuckets(
  issues: IssueListItem[],
  viewerId: string | null,
): WorkloadBucket[];
export function dueLoad(
  issues: IssueListItem[],
  viewerId: string | null,
  today: string,
  days?: number,
): DueLoadDay[];
export function weekPreview(
  issues: IssueListItem[],
  viewerId: string | null,
  today: string,
  limit?: number,
): IssueListItem[];
```

- [ ] **Step 1: Write failing derivation tests**

Create complete fixtures with all required command fields. Test hand-derived
outcomes:

```ts
it("scopes overdue metrics to the active viewer and excludes today", () => {
  const metrics = dashboardMetrics({
    issues: [
      issue({ id: "mine-late", assigneeId: "viewer", dueDate: "2026-07-24" }),
      issue({ id: "mine-today", assigneeId: "viewer", dueDate: "2026-07-26" }),
      issue({ id: "other-late", assigneeId: "other", dueDate: "2026-07-20" }),
      issue({
        id: "done-late",
        assigneeId: "viewer",
        dueDate: "2026-07-20",
        stateType: "completed",
      }),
    ],
    prs: [
      pr({ id: "same", bucket: "needs_review" }),
      pr({ id: "same", bucket: "assigned" }),
    ],
    notifications: [
      notification({ id: "unread", read: false }),
      notification({ id: "read", read: true }),
    ],
    slack: catchup({ mentions: [message({ ts: "1" })] }),
    viewerId: "viewer",
    today: "2026-07-26",
  });

  expect(metrics).toEqual({ overdue: 1, reviews: 1, inbox: 1, mentions: 1 });
});

it("deduplicates PR attention and keeps the highest urgency", () => {
  const items = attentionItems({
    issues: [],
    prs: [
      pr({
        id: "pr-1",
        bucket: "mine",
        reviewDecision: "changes_requested",
        updatedAt: "2026-07-25T10:00:00Z",
      }),
      pr({
        id: "pr-1",
        bucket: "needs_review",
        updatedAt: "2026-07-26T10:00:00Z",
      }),
    ],
    notifications: [],
    slack: catchup(),
    viewerId: "viewer",
    today: "2026-07-26",
  });

  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({
    source: "github",
    target: "prs",
    rank: 1,
    detail: "Changes requested",
  });
});

it("orders attention by urgency and caps the queue", () => {
  const input = attentionFixtureWithTenCandidates();
  const items = attentionItems(input, 8);
  expect(items).toHaveLength(8);
  expect(items.map((item) => item.rank)).toEqual([0, 0, 1, 2, 2, 3, 4, 4]);
});

it("returns all workload buckets including zeros", () => {
  expect(workloadBuckets([
    issue({ id: "started", assigneeId: "viewer", stateType: "started" }),
    issue({ id: "todo", assigneeId: "viewer", stateType: "unstarted" }),
    issue({ id: "other", assigneeId: "other", stateType: "backlog" }),
  ], "viewer").map(({ key, count }) => ({ key, count }))).toEqual([
    { key: "started", count: 1 },
    { key: "unstarted", count: 1 },
    { key: "backlog", count: 0 },
  ]);
});

it("builds seven Dhaka-date due-load buckets", () => {
  const days = dueLoad([
    issue({ id: "today", assigneeId: "viewer", dueDate: "2026-07-26" }),
    issue({ id: "tomorrow", assigneeId: "viewer", dueDate: "2026-07-27" }),
  ], "viewer", "2026-07-26");

  expect(days.map(({ date, count }) => ({ date, count }))).toEqual([
    { date: "2026-07-26", count: 1 },
    { date: "2026-07-27", count: 1 },
    { date: "2026-07-28", count: 0 },
    { date: "2026-07-29", count: 0 },
    { date: "2026-07-30", count: 0 },
    { date: "2026-07-31", count: 0 },
    { date: "2026-08-01", count: 0 },
  ]);
});

it("previews overdue first, then this week by date and priority", () => {
  const preview = weekPreview([
    issue({ id: "monday-low", assigneeId: "viewer", dueDate: "2026-07-27", priority: 4 }),
    issue({ id: "overdue", assigneeId: "viewer", dueDate: "2026-07-25", priority: 1 }),
    issue({ id: "monday-high", assigneeId: "viewer", dueDate: "2026-07-27", priority: 1 }),
  ], "viewer", "2026-07-26");
  expect(preview.map((item) => item.id)).toEqual(["overdue", "monday-high", "monday-low"]);
});
```

- [ ] **Step 2: Run focused model tests and verify RED**

Run:

```bash
npm test -- src/features/dashboard/dashboard.test.ts
```

Expected: module-not-found failure because `dashboard.ts` does not exist.

- [ ] **Step 3: Implement minimal pure derivations**

Implement `isActive`, viewer filtering, PR dedupe, deterministic attention
sorting, and date math with the existing `addDays`/`weekWindow` helpers. Use
literal bucket metadata:

```ts
const WORKLOAD_BUCKETS: WorkloadBucket[] = [
  { key: "started", label: "In progress", count: 0, color: "#818cf8" },
  { key: "unstarted", label: "Todo", count: 0, color: "#22d3ee" },
  { key: "backlog", label: "Backlog", count: 0, color: "#64748b" },
];

const isActive = (stateType: string) =>
  stateType !== "completed" && stateType !== "canceled";
```

When equal-ranked attention items are sorted, use `sortAt` ascending for overdue
dates and descending for timestamp-based provider items, with `key` as the final
stable tie-breaker. Return new arrays and never mutate query-cache objects.

- [ ] **Step 4: Run focused model tests and verify GREEN**

Run:

```bash
npm test -- src/features/dashboard/dashboard.test.ts
```

Expected: all derivation tests pass.

---

### Task 3: Frosted Action Command Center page

**Files:**
- Create: `src/features/dashboard/DashboardPage.test.tsx`
- Create: `src/features/dashboard/DashboardPage.tsx`
- Modify: `src/styles/index.css`
- Modify: `src/components/SplitLayout.tsx`

**Interfaces:**
- Consumes existing hooks: `useIssues`, `useMe`, `useConnectionStatus`,
  `useNotifications`,
  `useGithubStatus`, `useGithubPrs`, `useSlackStatus`, `useSlackCatchup`,
  `useDocsStatus`, `useDocsSources`. Dashboard passes `{ enabled: false }` to
  `useNotifications` because that query performs a live Linear read; an
  existing in-memory result remains observable without initiating a request.
- Produces: `DashboardPage(): JSX.Element`.
- Navigation: issue rows call `setSearchParams({ issue: entityId })`; provider
  summaries call `setActiveView("prs" | "inbox" | "slack" | "docs" | ...)`.

- [ ] **Step 1: Write failing component tests**

Mock only the external/cache hook boundary while rendering the real dashboard.
Mirror complete response shapes:

```ts
it("renders cached metrics and the attention queue", () => {
  render(<DashboardPage />);
  expect(screen.getByRole("heading", { name: /Good morning, Abrar/i })).toBeTruthy();
  expect(screen.getByText("Overdue")).toBeTruthy();
  expect(screen.getByText("GAM-101")).toBeTruthy();
  expect(screen.getByRole("table", { name: "Needs your attention" })).toBeTruthy();
});

it("opens a Linear attention item in the issue drawer", () => {
  render(<DashboardPage />);
  fireEvent.click(screen.getByRole("button", { name: /Open GAM-101/i }));
  expect(setParams).toHaveBeenCalledWith({ issue: "issue-101" });
});

it("navigates from the reviews card to pull requests", () => {
  render(<DashboardPage />);
  fireEvent.click(screen.getByRole("button", { name: /Open pull requests/i }));
  expect(setActiveView).toHaveBeenCalledWith("prs");
});

it("keeps cached Linear content visible while Slack is loading", () => {
  slackCatchupResult = { data: undefined, isLoading: true, isError: false };
  render(<DashboardPage />);
  expect(screen.getByText("GAM-101")).toBeTruthy();
  expect(screen.getByText("Reading cache…")).toBeTruthy();
});

it("renders a calm empty attention state", () => {
  setEmptyDashboardFixtures();
  render(<DashboardPage />);
  expect(screen.getByText("Nothing urgent right now")).toBeTruthy();
});
```

- [ ] **Step 2: Run focused component tests and verify RED**

Run:

```bash
npm test -- src/features/dashboard/DashboardPage.test.tsx
```

Expected: module-not-found or missing-accessible-element failures because the
page is not implemented.

- [ ] **Step 3: Implement the dashboard page**

Build a single scrollable `main` with:

```tsx
<main className="dashboard-surface h-full overflow-y-auto">
  <div aria-hidden className="dashboard-aurora dashboard-aurora-primary" />
  <div aria-hidden className="dashboard-aurora dashboard-aurora-cyan" />
  <div className="relative mx-auto flex w-full max-w-[1500px] flex-col gap-4 px-4 pt-4 pb-28 sm:px-6 sm:pt-6">
    <DashboardHeader />
    <KpiGrid />
    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.8fr)_minmax(260px,0.8fr)]">
      <AttentionTable />
      <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-1">
        <WorkloadChart />
        <DueLoadChart />
      </div>
    </div>
    <OverviewGrid />
    <QuickActions />
  </div>
</main>
```

Use a reusable local glass shell:

```tsx
function GlassCard({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section className={cn(
      "dashboard-glass min-w-0 rounded-xl border p-4",
      className,
    )}>
      {children}
    </section>
  );
}
```

All card/table actions are `button` elements with explicit accessible labels.
The attention table uses `<table aria-label="Needs your attention">`, hides
nonessential columns below `sm`, and truncates titles. The due-load chart uses
seven labeled bar buttons or noninteractive bars with `aria-label` values and a
visible total. Source status copy uses text plus icons; no provider logo is
invented.

Add dashboard-only utilities:

```css
.dashboard-surface {
  position: relative;
  isolation: isolate;
  background:
    radial-gradient(circle at 82% 0%, color-mix(in oklab, var(--primary) 12%, transparent), transparent 34%),
    radial-gradient(circle at 4% 72%, color-mix(in oklab, #22d3ee 7%, transparent), transparent 28%),
    var(--background);
}

.dashboard-glass {
  border-color: color-mix(in oklab, var(--foreground) 10%, transparent);
  background: color-mix(in oklab, var(--card) 84%, transparent);
  box-shadow:
    inset 0 1px color-mix(in oklab, white 6%, transparent),
    0 12px 36px color-mix(in oklab, black 15%, transparent);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
}

@media (prefers-reduced-motion: reduce) {
  .dashboard-surface *,
  .dashboard-surface *::before,
  .dashboard-surface *::after {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}
```

Do not add any sync hook. The page reads each provider independently and uses
loading/error flags only to choose the related card's copy.

- [ ] **Step 4: Run focused component and model tests and verify GREEN**

Run:

```bash
npm test -- src/features/dashboard/DashboardPage.test.tsx src/features/dashboard/dashboard.test.ts
```

Expected: all dashboard tests pass.

- [ ] **Step 5: Refactor only while green**

Extract repeated local markup into small colocated components, keep the page
file readable, and rerun:

```bash
npm test -- src/features/dashboard/DashboardPage.test.tsx src/features/dashboard/dashboard.test.ts
```

Expected: all dashboard tests remain green.

---

### Task 4: Integration and regression verification

**Files:**
- Review: all files in the scoped diff
- No new production files unless a failing verification exposes a regression

**Interfaces:**
- Confirms strict TypeScript, existing frontend behavior, production build, and
  whitespace correctness.

- [ ] **Step 1: Run strict type checking**

```bash
npx tsc --noEmit
```

Expected: exit 0 with no TypeScript errors or unused symbols.

- [ ] **Step 2: Run the complete frontend suite**

```bash
npm test
```

Expected: all Vitest files and tests pass with zero failures.

- [ ] **Step 3: Run the production frontend build**

```bash
npm run build
```

Expected: TypeScript and Vite exit 0. Record any pre-existing bundle warnings.

- [ ] **Step 4: Inspect formatting and the complete scoped diff**

```bash
git diff --check
git status --short
git diff -- docs/superpowers/specs/2026-07-26-app-dashboard-design.md docs/superpowers/plans/2026-07-26-app-dashboard.md src
```

Expected: no whitespace errors; no edits to `.quickdev.toml`, `.codex/`,
`src-tauri/`, manifests, capabilities, or CSP.

- [ ] **Step 5: Manual desktop check when practical**

```bash
npm run tauri dev
```

Verify a fresh workspace opens Dashboard, persisted workspaces stay on their
saved view, Dashboard works at full width and in a narrow split, cards navigate,
and Linear attention rows open the issue drawer. If the desktop process cannot
be exercised in this environment, report this path as not manually tested.
