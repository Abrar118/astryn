# enh-D: Week-Number Nav + Dashboard Integration Report

## Week Navigation

- Added `const [weekOffset, setWeekOffset] = useState(0)`.
- `weekWindow(new Date(), weekOffset)` replaces the old no-arg `weekWindow()` call; result stored as `win`.
- ISO week number computed via `isoWeek(addDays(win.weekStart, 4))` — Thursday of the Sun-started week — per spec.
- Header primary label: **"Week {n}"** (appends `· {year}` only when week-year ≠ calendar year). Secondary muted line: `"Jun 21 – Jun 27"` using `shortDate(win.weekStart)` and `shortDate(addDays(win.weekStart, 6))`.
- `◀`/`▶` buttons using Lucide `ChevronLeft`/`ChevronRight`; aria-labels "Previous week"/"Next week"; focus-visible ring.
- **"This Week"** reset button rendered only when `weekOffset !== 0`.

### Arrow-key guard (useEffect)

```ts
if (e.metaKey || e.ctrlKey || e.altKey) return;
const tag = target.tagName.toLowerCase();
if (tag === "input" || tag === "textarea" || tag === "select") return;
if (target.isContentEditable) return;
```

Listener removed on unmount via cleanup fn.

## Dashboard Composition

Dashboard section is guarded by `viewerId` (same guard as the grouped list) and rendered between the header and the issue list.

1. **HeatMap** — `weeks=buildHeatmap(issues ?? [], viewerId, { now: new Date(), weeksBack: 8, weeksForward: 1 })`, `currentOffset=weekOffset`, `onSelectWeek=setWeekOffset`.
2. **Overview row** (`grid-cols-1 lg:grid-cols-2`) — `StatusDonut` + `PriorityBar`, both fed from `weekIssues = groups.flatMap(g => g.items).map(it => it.issue)`.
3. **DependencyGraph** — `items=groups.flatMap(g => g.items)`, `allIssues=issues ?? []`, `onOpen=open`.

Section subheadings use `text-[11px] font-medium uppercase tracking-widest text-muted-foreground` to stay subordinate to day-group headers.

## Header & Thread Changes

- **Group headers**: `py-1.5` → `py-2.5`; label size `text-xs font-medium` → `text-[15px] font-semibold`; date/count bumped from `text-[11px]` to `text-xs`.
- **Thread rail**: `border-l border-border/60` → `border-l border-white/15` (faint but visible hairline on dark background).

## Prop Adaptations

No prop mismatches found. All component APIs matched the spec exactly:
- `HeatMap`: `{ weeks, currentOffset, onSelectWeek }` ✓
- `StatusDonut`: `{ data: StatusBreakdownEntry[] }` ✓
- `PriorityBar`: `{ data: PriorityBreakdownEntry[] }` ✓
- `DependencyGraph`: `{ items, allIssues, onOpen }` ✓

## Build / Test Results

- `npx tsc --noEmit` — clean (no errors)
- `npm run build` — succeeded; chunk-size warning is pre-existing (mermaid/cytoscape/katex chunks), not introduced by this change
- `npm run test` — 219/219 tests pass (35 test files)

## Concerns

None. The dashboard scrolls naturally above the sticky day-group headers as intended.
