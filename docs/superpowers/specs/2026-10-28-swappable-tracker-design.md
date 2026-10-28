# Astryn Module System — Spec 3: Swappable Tracker

**Status:** Approved for build (spec approval waived for this run), 2026-10-28.
**Requirement:** `requirements.md` §3 *Module architecture*; `docs/backlog.md` item 3
(prerequisite); `docs/superpowers/specs/2026-10-27-module-system-design.md` (spec 3 row).

## 1. Summary

Calendar, This Week, Dependencies, the task drawer / task tab, Reports and the
Dashboard stop reading Linear directly. They read a **tracker-neutral task
model** through a small **tracker registry** that can merge several trackers at
once. Linear becomes the first module that provides the `tracker` capability;
local tasks (separate spec) is the second. With only Linear on, every screen
behaves exactly as before.

## 2. Goals and non-goals

**Goals**

- One task model and one set of query hooks for every cross-tracker surface.
- Several trackers active at once; their tasks merge into one Calendar, This
  Week, Dependencies graph, Dashboard and Reports.
- Calendar, This Week and Dependencies stay visible while *any* tracker is on
  (today they disappear with Linear).
- Writes (reschedule, status, priority, assignee, delete) route to the tracker
  that owns the task. Optimistic update, rollback and the sync generation guards
  are unchanged.
- The drawer becomes a tracker-neutral shell that renders each tracker's own
  body (Linear keeps its Linear-familiar body), so later features (F9 per-task
  doc links) attach once for every tracker.

**Non-goals**

- Jira or any other remote tracker.
- Cross-tracker relations (a Linear issue blocking a local task).
- Making Linear-only screens neutral: **Issues** (list/board), **Inbox**, the
  Linear create-issue modal and the Linear issue body stay Linear-owned.

## 3. Tracker-neutral task model (`src/lib/tracker.ts`)

The neutral model reuses the cached-issue shape the app already renders — its
fields are generic enough, and keeping it avoids churning every row component.
Each field's neutral meaning:

| Field | Meaning | Linear | Other trackers |
|---|---|---|---|
| `id` | Globally unique task id | Linear UUID | `<prefix>_…` (see §3.1) |
| `identifier` | Short human key | `ENG-123` | list key + number |
| `stateId/Name/Color` | Status | workflow state | custom status |
| `stateType` | **Status category**: `triage`, `backlog`, `unstarted`, `started`, `completed`, `canceled` | Linear state type | category chosen per custom status |
| `teamId/teamKey` | **Workflow scope** (owns the status set) | team | list |
| `projectId/Name` | Grouping | project | — (projects later) |
| `cycleName/Number` | Iteration | cycle | sprint |
| `priority` | 0 none, 1 urgent, 2 high, 3 medium, 4 low | same | same scale |
| `assigneeId/Name` | Assignee | Linear user | tracker-specific self id |

Type aliases: `Task` (= `IssueListItem`), `TaskSummary` (= `CalendarIssue`),
`TaskRelation` (= `Relation`), `TaskStatus` (= `WorkflowState`, `teamId` is the
workflow scope), `TaskPatch` (= `UpdateIssuePatch`), `TaskFilters`.

### 3.1 Identity

- `TrackerId` is a closed union (`"linear"` today). `trackerOf(id)` derives the
  owner from the id: non-Linear trackers prefix their ids (`lt_` for local
  tasks); anything else is Linear. Persisted tabs (`issue` tabs hold only an
  id), the `?issue=` drawer parameter and TanStack caches therefore keep
  working without a migration.
- `TRACKERS: Record<TrackerId, { module, label }>` maps each tracker to the
  module that owns it.

### 3.2 "Mine"

- `ME` (`"@me"`) is a filter sentinel meaning "assigned to me in each tracker".
  Hooks resolve it per tracker to that tracker's viewer id. A tracker whose
  viewer is unknown contributes nothing to a "mine" query.
- `useViewer()` returns `{ ids: Partial<Record<TrackerId, string>>, name,
  isLoading }`. Pure helpers (`buildAgenda`, `buildHeatmap`, dashboard
  functions) take `viewerIds: readonly string[]` instead of one `viewerId`.

## 4. Tracker registry and merged queries

### 4.1 Adapters

`TRACKER_ADAPTERS: Record<TrackerId, TrackerAdapter>` holds plain async
functions over the tracker's existing typed commands:

```
listTasks(filters) · listCalendar({start,end,…filters}) · listUnscheduled(filters)
listRelations() · listFilterOptions() · listStatuses() · listUsers()
viewerQuery { queryKey, queryFn }        // Linear: ["me"], getMe
update(id, patch) · remove(id) · createRelation(issueId, relatedId, type)
```

Rust commands stay **per provider** and keep their `state.require(ModuleId::X)?`
guard; merging happens in the frontend query layer. (Rationale: each module
keeps owning its commands, the guard-coverage test needs no capability-guarded
commands, and a disabled tracker's queries simply never run.)

### 4.2 Query keys

Tracker data is keyed per tracker so trackers share one cache without
colliding:

```
["issues", tracker, filters]   ["calendar", tracker, start, end, filters]
["unscheduled", tracker, filters]   ["relations", tracker]
["filter-options", tracker]   ["workflow-states", tracker]   ["users", tracker]
```

Linear-only screens (`useIssues`, `useFilterOptions`, …) read the same
`"linear"` entries, so there is still one copy of Linear data in memory.
Prefix invalidation (`["issues"]`) keeps hitting every tracker; Linear's
key-change / resync wipe clears only the `"linear"` entries.

### 4.3 Merged hooks (`src/lib/taskQueries.ts`)

`useActiveTrackers()`, `useTasks(filters)`, `useCalendarTasks(range, filters)`,
`useUnscheduledTasks(filters)`, `useTaskRelations()`, `useTaskFilterOptions()`,
`useTaskStatuses()`, `useTaskUsers()`, `useViewer()`.

Each runs one query per **active** tracker (`useQueries` with a module-level
`combine`, so the merged array is referentially stable) and returns
`{ data, isLoading, isError }`:

- `data` is the concatenation once every tracker has either data or an error
  (offline-first: a failing tracker never hides another's cached tasks);
  `undefined` while any tracker is still on its first load, or when no tracker
  is active.
- `isError` is true when any tracker's read failed.

### 4.4 Mutations

`useUpdateTask` / `useDeleteTask` / `useCreateTaskRelation` replace the Linear
hooks. `mutationFn` routes by `trackerOf(id)`. The optimistic patch logic is the
existing one with one correction: list/calendar/unscheduled entries are only
reconciled when their key's tracker owns the task, so an edit can never insert a
Linear issue into another tracker's cache.

## 5. Surfaces

| Surface | Change |
|---|---|
| `VIEW_META` | Calendar, This Week, Dependencies owned by the `tracker` capability (`module: "tracker"`), visible while any tracker module is active. Issues and Inbox stay `linear`. |
| Tabs | `tabActive(tab)`: an issue tab closes when its own tracker's module turns off. Labels/icons read merged tasks. |
| Calendar | Merged calendar/unscheduled/task hooks; filter bar lists merged teams/projects and assignees with a "Me" (`ME`) entry, defaulting to `ME`. |
| This Week / Dependencies / bulk bar | Merged tasks + relations; viewer ids from `useViewer`; statuses from `useTaskStatuses`. |
| Dashboard | Issue panels use merged tasks and `viewerIds`; the tracker panels show while any tracker is active. Linear-only sources (Inbox) stay Linear. |
| Drawer | `IssueDrawer` → `TaskDrawer` (shell: overlay, resize, Escape) and `TaskPage` (tab) render `TaskDetail`, which dispatches on `trackerOf(id)`; Linear renders the existing `IssueDetail`. |
| Context menu | `IssueMenuProvider` finds the task in merged tasks and dispatches by tracker; Linear keeps today's menu. |
| Command palette | Task search over merged tasks. "Create new issue" and Resync need the Linear module (they are Linear actions), not just any tracker. |
| Reports (Rust) | `facts::assemble` takes a list of tracker fact sources (`FactSource::Linear { viewer_id }` today) and merges their sections. `generate_report` builds the list from active tracker modules. |

## 6. Rulings

- **Merge in the frontend**, keep Rust commands per provider (§4.1).
- **Ids carry the tracker** (prefix) instead of a separate field (§3.1).
- **IPC names unchanged** (`list_issues`, `update_issue`, …): they are Linear's
  commands; neutral names live in the TS hooks.
- **`?issue=` stays** the drawer parameter (compatibility with every caller).
- **Issues and Inbox stay Linear screens**; local tasks bring their own views.
- **No cross-tracker relations.**

## 7. Testing

- `tracker.ts`: `trackerOf`, `resolveFilters` (ME → per-tracker viewer / skip).
- `taskQueries`: merging (partial errors, inactive trackers), per-tracker keys,
  update routing and the cross-tracker reconcile guard.
- `modules.ts`: tracker-owned views follow any tracker; `tabActive`.
- Agenda/heatmap/dashboard helpers with several viewer ids.
- Rust: `assemble` with no sources, with Linear, ordering preserved.
- All existing suites stay green (behavior with Linear alone is unchanged).
