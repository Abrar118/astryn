# Enhancement A — Report

## Functions Implemented

### Part 1 — `src/lib/dates.ts`

- **`weekWindow(now?, offsetWeeks?)`**: Added optional `offsetWeeks` param (default 0).
  Computes the current Dhaka Sunday-week, then shifts the `weekStart` by `offsetWeeks * 7` days via the existing `addDays` helper. All derived fields (`weekEnd`, `weekdays`, `weekend`) shift consistently. Existing zero-arg calls are unchanged.

- **`isoWeek(date: string)`**: New ISO 8601 week-number helper. Takes `YYYY-MM-DD`, uses `Date.UTC` / `getUTCDay` arithmetic. Algorithm: finds the Monday of ISO week 1 (the Monday on or before Jan 4) for the candidate year, then checks boundary conditions for year attribution (previous ISO year if `d < thisYearW1`, next ISO year if `d >= nextYearW1`).

### Part 2 — `src/features/agenda/agendaStats.ts`

- **`buildHeatmap(issues, viewerId, opts)`**: Filters to viewer's dated issues, pre-builds a `date→count` map, then iterates offsets from `-weeksBack` to `+weeksForward` calling `weekWindow(now, offset)` and `addDays` for each of 7 days. Returns `HeatWeek[]` oldest→newest.

- **`statusBreakdown(items)`**: Groups by `stateType`, picks `stateName`/`stateColor` from the first item in each group, sorts by `STATE_RANK` (unknown → rank 9, last).

- **`priorityBreakdown(items)`**: Counts per priority, then filters and maps `PRIORITY_ORDER` to produce ordered entries for only non-empty buckets.

## RED / GREEN Evidence

Tests were written before implementation (spec-driven), then implementation was written to make them pass.

- `src/lib/dates.test.ts`: 19 tests pass (includes new `weekWindow` offset + `isoWeek` suites).
- `src/features/agenda/agendaStats.test.ts`: 15 tests pass.
- Total: **34 tests, 2 files, all GREEN**.

## ISO Test-Value Corrections

All three anchor dates matched the spec's stated expectations; **no corrections were needed**:
- `isoWeek("2026-01-01")` → `{ week: 1, year: 2026 }` (Thu, first week of 2026) ✓
- `isoWeek("2027-01-01")` → `{ week: 53, year: 2026 }` (Fri, previous ISO year) ✓
- `isoWeek("2026-06-24")` → `{ week: 26, year: 2026 }` (Wed) ✓

## Exact Reused Export Names (from `src/features/issues/IssueRow.tsx`)

| Symbol | Value |
|---|---|
| `PRIORITY_LABELS` | `["No priority", "Urgent", "High", "Medium", "Low"]` |
| `PRIORITY_COLORS` | `["#6b7280", "#ef4444", "#f97316", "#eab308", "#3b82f6"]` |
| `PRIORITY_ORDER`  | `[1, 2, 3, 4, 0]` (Urgent→High→Medium→Low→None) |
| `STATE_RANK`      | `{ backlog:0, unstarted:1, started:2, completed:3, canceled:4 }` |

## TypeScript Result

`npx tsc --noEmit` — **clean, no errors**.

## Concerns

None. All functions are pure; no Tauri IPC, no side effects.
