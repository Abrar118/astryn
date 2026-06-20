# Full-Page Issue View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open an issue full-page as a new `"issue"` workspace tab (alongside the side drawer), from the right-click context menu and the drawer header breadcrumb.

**Architecture:** Add an `"issue"` tab view carrying `issueId` to the tab model (`lib/tabs.tsx`) with an `openIssueTab` action. Extract the drawer's detail body (`DrawerContent`) into an exported, reusable `IssueDetail({ mode: "drawer" | "page" })`; the drawer renders it `mode="drawer"`, a new `IssuePage` renders it `mode="page"` full-width in `AppShell`'s `<main>`. Two entry points call `openIssueTab`.

**Tech Stack:** React + TypeScript (strict), react-router HashRouter (search params for the drawer only), TanStack Query, lucide-react icons, Vitest + jsdom.

## Global Constraints

- TS is **strict** (`noUnusedLocals`/`noUnusedParameters`) — unused symbols fail the build.
- The webview never calls Linear directly; this feature is pure frontend over existing typed commands/hooks (`useIssueDetail`, `useIssues`).
- Detail UI is a **single source** — `IssueDetail` is shared by drawer and page; do not duplicate the detail body.
- Drawer behavior must be **unchanged** by the extraction (same look/interactions in `mode="drawer"`).
- Issue tabs persist via the existing localStorage tab state; no URL routing for views (the `?issue=` param remains the drawer's mechanism only).
- Gates: `npx tsc --noEmit`, `npx vitest run`, `npm run build` (the pre-existing chunk-size warning is acceptable).

## File Structure

- **Modify** `src/lib/tabs.tsx` — `ViewKind += "issue"`, `Tab.issueId`, pure `upsertIssueTab` + `parsePersisted`, provider `openIssueTab`, `setActiveView` clears `issueId`.
- **Create** `src/lib/tabs.test.ts` — unit tests for the pure helpers.
- **Modify** `src/features/drawer/IssueDrawer.tsx` — rename `DrawerContent` → exported `IssueDetail({ mode, … })`; drawer renders `mode="drawer"`; add header full-page button; gate Close to drawer mode.
- **Create** `src/features/drawer/IssuePage.tsx` — full-page wrapper rendering `<IssueDetail mode="page">`.
- **Create** `src/features/drawer/IssuePage.test.tsx` — light render test (mocked deps).
- **Modify** `src/components/AppShell.tsx` — render `IssuePage` for `view === "issue"`.
- **Modify** `src/components/TabBar.tsx` — issue-tab label (identifier) + icon.
- **Modify** `src/features/issues/IssueContextMenu.tsx` — "Open in full page" row.

---

### Task 1: Tab model — `"issue"` view, `openIssueTab`, persistence (+ TabBar label)

**Files:**
- Modify: `src/lib/tabs.tsx`
- Modify: `src/components/TabBar.tsx` (widening `ViewKind` breaks its `META`; fix it here so `tsc` stays green)
- Test: `src/lib/tabs.test.ts`

**Interfaces:**
- Produces: `type ViewKind = "calendar" | "list" | "settings" | "issue"`; `type Tab = { id: string; view: ViewKind; issueId?: string }`; `upsertIssueTab(tabs: Tab[], issueId: string, seq: number): { tabs: Tab[]; activeId: string; seq: number }`; `parsePersisted(raw: string | null): { tabs: Tab[]; activeId: string; seq: number }`; context method `openIssueTab(issueId: string): void`.

- [ ] **Step 1: Write the failing tests.** Create `src/lib/tabs.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { upsertIssueTab, parsePersisted } from "./tabs";
import type { Tab } from "./tabs";

const base: Tab[] = [{ id: "tab-0", view: "calendar" }];

describe("upsertIssueTab", () => {
  it("creates and activates a new issue tab, incrementing seq", () => {
    const r = upsertIssueTab(base, "iss-1", 1);
    expect(r.tabs).toHaveLength(2);
    expect(r.tabs[1]).toEqual({ id: "tab-1", view: "issue", issueId: "iss-1" });
    expect(r.activeId).toBe("tab-1");
    expect(r.seq).toBe(2);
  });

  it("selects the existing tab when the issue is already open (no duplicate, seq unchanged)", () => {
    const tabs: Tab[] = [...base, { id: "tab-1", view: "issue", issueId: "iss-1" }];
    const r = upsertIssueTab(tabs, "iss-1", 2);
    expect(r.tabs).toHaveLength(2);
    expect(r.activeId).toBe("tab-1");
    expect(r.seq).toBe(2);
  });
});

describe("parsePersisted", () => {
  it("keeps a valid issue tab and drops an issue tab missing issueId", () => {
    const raw = JSON.stringify({
      tabs: [
        { id: "tab-0", view: "calendar" },
        { id: "tab-1", view: "issue", issueId: "iss-1" },
        { id: "tab-2", view: "issue" }, // invalid: no issueId
      ],
      activeId: "tab-1",
      seq: 3,
    });
    const p = parsePersisted(raw);
    expect(p.tabs.map((t) => t.id)).toEqual(["tab-0", "tab-1"]);
    expect(p.activeId).toBe("tab-1");
  });

  it("falls back for null/garbage input", () => {
    expect(parsePersisted(null).tabs).toHaveLength(1);
    expect(parsePersisted("{not json").tabs[0].view).toBe("calendar");
  });
});
```

- [ ] **Step 2: Run to verify failure.**

Run: `npx vitest run src/lib/tabs.test.ts`
Expected: FAIL — `upsertIssueTab`/`parsePersisted` not exported.

- [ ] **Step 3: Implement in `src/lib/tabs.tsx`.** Replace the type lines (3-4):

```ts
export type ViewKind = "calendar" | "list" | "settings" | "issue";
export type Tab = { id: string; view: ViewKind; issueId?: string };
```

Add `openIssueTab` to the `Ctx` type (after `setActiveView`):

```ts
  openIssueTab: (issueId: string) => void;
```

Replace `const VIEWS: ViewKind[] = [...]` (line 23) with:

```ts
const VIEWS: ViewKind[] = ["calendar", "list", "settings", "issue"];
```

Replace the whole `function load(): Persisted { … }` block (lines 25-40) with a pure `parsePersisted` + a thin `load`:

```ts
/** Pure: validate persisted workspace JSON. Drops malformed tabs and any
 *  "issue" tab missing an issueId; falls back when nothing valid remains. */
export function parsePersisted(raw: string | null): Persisted {
  if (!raw) return FALLBACK;
  try {
    const p = JSON.parse(raw) as Partial<Persisted>;
    const tabs = Array.isArray(p.tabs)
      ? p.tabs.filter(
          (t): t is Tab =>
            !!t &&
            typeof t.id === "string" &&
            VIEWS.includes(t.view as ViewKind) &&
            (t.view !== "issue" || (typeof t.issueId === "string" && t.issueId.length > 0)),
        )
      : [];
    if (tabs.length === 0) return FALLBACK;
    const activeId = tabs.some((t) => t.id === p.activeId) ? (p.activeId as string) : tabs[0].id;
    const seq = typeof p.seq === "number" ? p.seq : tabs.length;
    return { tabs, activeId, seq };
  } catch {
    return FALLBACK;
  }
}

function load(): Persisted {
  try {
    return parsePersisted(localStorage.getItem(STORAGE_KEY));
  } catch {
    return FALLBACK;
  }
}

/** Pure: open (or focus) a tab for an issue. Dedupes by issueId. */
export function upsertIssueTab(
  tabs: Tab[],
  issueId: string,
  seq: number,
): { tabs: Tab[]; activeId: string; seq: number } {
  const existing = tabs.find((t) => t.view === "issue" && t.issueId === issueId);
  if (existing) return { tabs, activeId: existing.id, seq };
  const id = `tab-${seq}`;
  return { tabs: [...tabs, { id, view: "issue", issueId }], activeId: id, seq: seq + 1 };
}
```

In the provider, change `setActiveView` (line 65-66) so it clears `issueId` (note: build a fresh object, don't spread `t`):

```ts
  const setActiveView = (view: ViewKind) =>
    setTabs((ts) => ts.map((t) => (t.id === active.id ? { id: t.id, view } : t)));
```

Add `openIssueTab` in the provider (after `selectTab`, ~line 84):

```ts
  const openIssueTab = (issueId: string) => {
    const next = upsertIssueTab(tabs, issueId, seq.current);
    seq.current = next.seq;
    setTabs(next.tabs);
    setActiveId(next.activeId);
  };
```

Add `openIssueTab` to the provider's `value={{ … }}` object.

- [ ] **Step 4: Run the pure tests.**

Run: `npx vitest run src/lib/tabs.test.ts` → PASS (4 tests)

- [ ] **Step 5: Fix `TabBar.tsx` for the widened `ViewKind` + issue-tab label.** Widening `ViewKind` makes `const META: Record<ViewKind, …>` a type error (missing `"issue"` key), so update TabBar now. Change the lucide import to add `FileText`, import `useIssues`, retype `META`, and branch the per-tab label/icon:

```tsx
import { Calendar, FileText, List, Plus, Settings as SettingsIcon, X } from "lucide-react";
import { useWorkspace, type ViewKind } from "@/lib/tabs";
import { useIssues } from "@/lib/queries";
import { DualClock } from "@/features/home/DualClock";

const META: Record<Exclude<ViewKind, "issue">, { label: string; icon: ReactNode }> = {
  calendar: { label: "Calendar", icon: <Calendar className="size-3.5" /> },
  list: { label: "Issues", icon: <List className="size-3.5" /> },
  settings: { label: "Settings", icon: <SettingsIcon className="size-3.5" /> },
};
```

Inside `TabBar`, add `const { data: issues } = useIssues({});` next to `useWorkspace()`, and in the `tabs.map` replace `const m = META[t.view];` and the icon/label spans:

```tsx
        const isActive = t.id === active.id;
        const issue = t.view === "issue" ? (issues ?? []).find((i) => i.id === t.issueId) : undefined;
        const label = t.view === "issue" ? (issue?.identifier ?? "Issue") : META[t.view].label;
        const icon = t.view === "issue" ? <FileText className="size-3.5" /> : META[t.view].icon;
```

and use `{icon}` / `{label}` in the existing spans (replace `{m.icon}` / `{m.label}`).

- [ ] **Step 6: Typecheck.**

Run: `npx tsc --noEmit` → clean (TabBar now handles the `"issue"` view).
Run: `npx vitest run` → full suite green.

- [ ] **Step 7: Commit.**

```bash
git add src/lib/tabs.tsx src/lib/tabs.test.ts src/components/TabBar.tsx
git commit -m "feat(tabs): add issue tab view + openIssueTab (dedupe) + persistence + TabBar label"
```

---

### Task 2: Extract `IssueDetail` + drawer full-page button

**Files:**
- Modify: `src/features/drawer/IssueDrawer.tsx` (rename `DrawerContent` ~line 224; outer render ~line 218; header buttons ~382-425)

**Interfaces:**
- Consumes: `openIssueTab` (Task 1, via `useWorkspace`).
- Produces: `export function IssueDetail({ id, result, mode, onClose }: { id: string; result: IssueDetailResult; mode: "drawer" | "page"; onClose: () => void })`.

- [ ] **Step 1: Rename + signature.** Rename `function DrawerContent({ id, result, onClose }: { id: string; result: IssueDetailResult; onClose: () => void })` to:

```tsx
export function IssueDetail({ id, result, mode, onClose }: { id: string; result: IssueDetailResult; mode: "drawer" | "page"; onClose: () => void }) {
```

Add the workspace hook near the other hooks at the top of the component (after `const { openMenu } = useIssueMenu();`):

```tsx
  const { openIssueTab } = useWorkspace();
```

Add the import at the top of the file: `import { useWorkspace } from "@/lib/tabs";`

- [ ] **Step 2: Update the drawer's render of it** (~line 218):

```tsx
        {result ? <IssueDetail id={id} result={result} mode="drawer" onClose={onClose} /> : null}
```

- [ ] **Step 3: Add the full-page button + gate Close to drawer mode.** In the header button group (the `<div className="flex items-center gap-0.5">` around line 382), add the full-page button before the `<Popover>` "More" menu, and gate the Close button. Replace the Close `IconBtn` (lines 423-425) and add the new button so the group reads:

```tsx
          {mode === "drawer" && (
            <IconBtn title="Open in full page" onClick={() => { openIssueTab(id); onClose(); }}>
              <Maximize2 className="size-4" />
            </IconBtn>
          )}
          {/* …existing Copy link / Copy ID / Open in Linear / More Popover… */}
          {mode === "drawer" && (
            <IconBtn title="Close" onClick={onClose}>
              <X className="size-4" />
            </IconBtn>
          )}
```

(Place the "Open in full page" `IconBtn` right after the opening `<div className="flex items-center gap-0.5">` so it sits left of Copy link; keep Copy link/ID/Open-in-Linear/More unchanged; the Close button stays last but is now gated.) Add `Maximize2` to the lucide-react import.

- [ ] **Step 4: Typecheck + build (drawer behavior unchanged).**

Run: `npx tsc --noEmit` → clean
Run: `npx vitest run` → existing suite still green (no test references `DrawerContent` by name; if any does, update it to `IssueDetail` with `mode="drawer"`).
Run: `npm run build 2>&1 | tail -3` → succeeds.

> No new unit test here: `IssueDetail` pulls Milkdown + many queries, so it is verified by tsc/build and the Task 3 `IssuePage` test + manual smoke. Confirm in the report that the drawer still renders (the `mode="drawer"` path is the unchanged former `DrawerContent`).

- [ ] **Step 5: Commit.**

```bash
git add src/features/drawer/IssueDrawer.tsx
git commit -m "refactor(drawer): extract IssueDetail({mode}) + add open-in-full-page button"
```

---

### Task 3: `IssuePage` + AppShell wiring

**Files:**
- Create: `src/features/drawer/IssuePage.tsx`
- Create: `src/features/drawer/IssuePage.test.tsx`
- Modify: `src/components/AppShell.tsx`

**Interfaces:**
- Consumes: `IssueDetail` (Task 2), `useIssueDetail` (`@/lib/queries`), `useWorkspace` (Task 1).
- Produces: `export function IssuePage({ issueId }: { issueId: string })`.

- [ ] **Step 1: Write the failing `IssuePage` test.** Create `src/features/drawer/IssuePage.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const { detail } = vi.hoisted(() => ({ detail: { value: undefined as unknown } }));
vi.mock("@/lib/queries", () => ({ useIssueDetail: () => ({ data: detail.value }) }));
vi.mock("@/lib/tabs", () => ({ useWorkspace: () => ({ closeTab: vi.fn(), active: { id: "tab-1" } }) }));
vi.mock("./IssueDrawer", () => ({
  IssueDetail: ({ id, mode }: { id: string; mode: string }) => <div data-testid="detail">{`${mode}:${id}`}</div>,
}));

import { IssuePage } from "./IssuePage";

afterEach(() => { cleanup(); detail.value = undefined; });

describe("IssuePage", () => {
  it("shows a loading state until the detail resolves", () => {
    render(<IssuePage issueId="iss-1" />);
    expect(screen.getByText(/loading/i)).toBeTruthy();
  });

  it("renders IssueDetail in page mode once loaded", () => {
    detail.value = { source: "live", detail: {} };
    render(<IssuePage issueId="iss-1" />);
    expect(screen.getByTestId("detail").textContent).toBe("page:iss-1");
  });
});
```

- [ ] **Step 2: Run to verify failure.**

Run: `npx vitest run src/features/drawer/IssuePage.test.tsx`
Expected: FAIL — cannot resolve `./IssuePage`.

- [ ] **Step 3: Implement `src/features/drawer/IssuePage.tsx`:**

```tsx
import { useIssueDetail } from "@/lib/queries";
import { useWorkspace } from "@/lib/tabs";
import { IssueDetail } from "./IssueDrawer";

/** Full-page issue view rendered in the workspace main area (an "issue" tab). */
export function IssuePage({ issueId }: { issueId: string }) {
  const { data: result } = useIssueDetail(issueId);
  const { closeTab, active } = useWorkspace();

  if (!result) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col">
      <IssueDetail id={issueId} result={result} mode="page" onClose={() => closeTab(active.id)} />
    </div>
  );
}
```

- [ ] **Step 4: Run the test (pass).**

Run: `npx vitest run src/features/drawer/IssuePage.test.tsx` → PASS (2 tests)

- [ ] **Step 5: Wire into `AppShell.tsx`.** Add the import and the `<main>` branch:

```tsx
import { IssuePage } from "@/features/drawer/IssuePage";
// …inside <main>, after the settings line:
        {active.view === "issue" && active.issueId && <IssuePage issueId={active.issueId} />}
```

- [ ] **Step 6: Full gates.**

Run: `npx tsc --noEmit` → clean
Run: `npx vitest run` → all green
Run: `npm run build 2>&1 | tail -3` → succeeds

- [ ] **Step 7: Commit.**

```bash
git add src/features/drawer/IssuePage.tsx src/features/drawer/IssuePage.test.tsx src/components/AppShell.tsx
git commit -m "feat(issue-page): full-page issue tab in main area"
```

---

### Task 4: Context-menu "Open in full page" entry

**Files:**
- Modify: `src/features/issues/IssueContextMenu.tsx` (imports; `Menu` body near the "Open details" row ~469-477)

**Interfaces:**
- Consumes: `openIssueTab` (Task 1, via `useWorkspace`).

- [ ] **Step 1: Add imports.** Add `Maximize2` to the lucide-react import block, and `import { useWorkspace } from "@/lib/tabs";`.

- [ ] **Step 2: Use the hook in `Menu`.** Add near the other hooks in `Menu` (after `const [params, setParams] = useSearchParams();`):

```tsx
  const { openIssueTab } = useWorkspace();
```

- [ ] **Step 3: Add the row.** Immediately after the existing "Open details" `Row` block (the one calling `setParams({ issue: issue.id })`, ~line 469-477), add:

```tsx
      {/* Open in full page (workspace tab) */}
      <Row
        icon={<Maximize2 className="size-4" />}
        label="Open in full page"
        onMouseEnter={() => setSub(null)}
        onClick={() => {
          openIssueTab(issue.id);
          onClose();
        }}
      />
```

- [ ] **Step 4: Gates.**

Run: `npx tsc --noEmit` → clean
Run: `npx vitest run` → all green
Run: `npm run build 2>&1 | tail -3` → succeeds

> No unit test: `Menu` requires the full provider/query mock set; this row is trivial wiring verified by tsc/build + manual smoke (right-click an issue → "Open in full page" → it opens as a tab; right-clicking the same issue again focuses the same tab).

- [ ] **Step 5: Commit.**

```bash
git add src/features/issues/IssueContextMenu.tsx
git commit -m "feat(issues): context-menu 'Open in full page' action"
```

---

## Self-Review

**Spec coverage:**
- Tab model (`"issue"` view, `issueId`, `openIssueTab` dedupe, `setActiveView` clears issueId, persistence validation) → Task 1. ✓
- TabBar issue-tab identifier label + icon → Task 1 (folded in: widening `ViewKind` breaks `META`, so TabBar is fixed in the same task — every task stays `tsc`-green). ✓
- Shared `IssueDetail({mode})` extraction; drawer renders `mode="drawer"`, keeps Close + new full-page button → Task 2. ✓
- `IssuePage` full-width + AppShell `<main>` branch → Task 3. ✓
- Entry points: drawer breadcrumb button → Task 2; context menu → Task 4. ✓
- Behavior: opening full page closes the drawer (the drawer button calls `onClose()` after `openIssueTab`; the context menu isn't in the drawer) → Task 2. ✓
- Delete from page closes the tab (`onClose` = `closeTab(active.id)`) → Task 3. ✓
- Testing: pure tab logic unit-tested (Task 1), `IssuePage` render test (Task 3); component wiring gated on tsc/build/manual (Tasks 2, 4) — noted explicitly. ✓

**Placeholder scan:** No TBD/“similar to”/vague steps. Each task is independently `tsc`- and `vitest`-green (TabBar is fixed in Task 1 alongside the `ViewKind` widening, so there is no interim red gate).

**Type consistency:** `openIssueTab(issueId: string)` is defined in Task 1 and consumed verbatim in Tasks 2 & 4. `IssueDetail({ id, result, mode, onClose })` defined in Task 2 and consumed in Task 3's `IssuePage` (and the drawer). `upsertIssueTab`/`parsePersisted` signatures match their tests. `Tab.issueId?: string` is consumed by TabBar (Task 1) and the AppShell branch (Task 3).
