# Sub-issue Parity + Label Create Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sub-issue rows match the Issues-list rows + a funnel display-options popover (ordering/completed/display-properties), and the rail Labels control becomes a search + checklist dropdown that can create a new label.

**Architecture:** Extract the Issues-list row components + the display-options popover from `IssuesView.tsx` into shared modules, then reuse them in `IssueDetail`'s sub-issues section (children resolved from the `useIssues` cache). Add a Rust `create_label` mutation and rework the rail Labels popover into a search/checklist/create dropdown.

**Tech Stack:** React + TypeScript (strict), TanStack Query, Rust (Tauri commands, `serde_json`/`reqwest`), lucide-react, Vitest, `viewConfig.ts` shared view types.

## Global Constraints

- All Linear calls in Rust; tokens never returned to TS; commands return sanitized `CmdError` only; GraphQL `errors` on HTTP 200 and `success:false` are failures.
- Feedback via `goey-toast` (`gooeyToast`). Optimistic writes with rollback (existing `useUpdateIssue` for label assignment).
- TS strict (`noUnusedLocals`/`noUnusedParameters`). Reuse `viewConfig.ts` types (`DisplayProps`, `Ordering`, `Completed`, `DisplayKey`, `DEFAULT_DISPLAY`, `DEFAULT_CONFIG`); NO duplicated row UI (single shared `IssueRow`).
- The Issues list (`IssuesView`) must be **behaviorally unchanged** by the extractions (its existing tests + build stay green).
- "Nested sub-issues" toggle is OUT OF SCOPE (backend returns one child level) — the display-options popover ships without it; a code comment notes why.
- Gates: `cargo test --manifest-path src-tauri/Cargo.toml`, `npx tsc --noEmit`, `npx vitest run`, `npm run build`.

## File Structure

- **Create** `src/features/issues/IssueRow.tsx` — moved `IssueRow`, `MetaCluster`, `Pill`, `LabelPills`, `PriorityIcon`, `compareIssues` (+ small helpers they need: `cycleText`, `isOverdue`, `dueLabel`, `fmtDate` — move whichever are row-only; shared date helpers stay in `@/lib/dates`).
- **Create** `src/features/issues/DisplayOptions.tsx` — the funnel popover content as a reusable component.
- **Modify** `src/features/issues/IssuesView.tsx` — import the extracted row + display-options; remove the moved definitions; use shared `StatusIcon` from `issueGlyphs.tsx`.
- **Modify** `src/features/drawer/IssueDrawer.tsx` — sub-issues section uses `IssueRow` + `DisplayOptions`.
- **Modify** `src-tauri/src/linear/issues.rs`, `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs` — `create_label`.
- **Modify** `src/lib/commands.ts` — `createLabel` binding; **Create** `src/features/drawer/labelColors.ts` — auto-color palette + picker (+ test).
- **Modify** `src/features/drawer/IssueDrawer.tsx` (Labels rail) — search/checklist/create dropdown; **Modify** `src/lib/queries.ts` — `useCreateLabel` hook (or call binding + invalidate).

---

### Task A1: Extract shared row components

**Files:**
- Create: `src/features/issues/IssueRow.tsx`
- Modify: `src/features/issues/IssuesView.tsx`
- Test: `src/features/issues/IssueRow.test.ts` (for `compareIssues`)

**Interfaces:**
- Produces: `export function IssueRow(props)`, `export function MetaCluster(props)`, `export function Pill(...)`, `export function LabelPills({ labels, max? })`, `export function PriorityIcon({ p })`, `export function compareIssues(a: IssueListItem, b: IssueListItem, by: Ordering): number`. (Same signatures as their current definitions in `IssuesView.tsx`.)

- [ ] **Step 1: Move the components verbatim.** Cut `IssueRow`, `MetaCluster`, `Pill`, `LabelPills`, `PriorityIcon`, and `compareIssues` from `IssuesView.tsx` into a new `src/features/issues/IssueRow.tsx`. Add `export` to each. Move any row-only helpers they reference that are also local to `IssuesView` (e.g. `cycleText`, `isOverdue`, `dueLabel`, `fmtDate`, `PRIORITY_LABELS`/`PRIORITY_COLORS` if used by `PriorityIcon`/`MetaCluster`) — keep `@/lib/dates` helpers imported from there. Import `StatusIcon` from `../drawer/issueGlyphs` (the shared one) and DELETE the duplicate `StatusIcon` definition in `IssuesView.tsx`. Carry over all needed imports (lucide icons, `Avatar`, `viewConfig` types, `IssueListItem`, `Label`).

- [ ] **Step 2: Re-import in `IssuesView.tsx`.** Replace the removed definitions with `import { IssueRow, MetaCluster, Pill, LabelPills, PriorityIcon, compareIssues } from "./IssueRow";` and use the shared `StatusIcon` from `./issueGlyphs`… wait — `issueGlyphs` lives in `src/features/drawer/`; import it as `import { StatusIcon } from "../drawer/issueGlyphs";` in both `IssueRow.tsx` and `IssuesView.tsx` where needed. Remove now-unused imports from `IssuesView.tsx` (tsc strict will flag them).

- [ ] **Step 3: Write a `compareIssues` test.** Create `src/features/issues/IssueRow.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { compareIssues } from "./IssueRow";
import type { IssueListItem } from "@/lib/commands";

const mk = (over: Partial<IssueListItem>): IssueListItem =>
  ({ id: "i", identifier: "X-1", title: "t", priority: 0, stateType: "started", stateColor: "#fff",
     stateName: "S", dueDate: null, assigneeId: null, assigneeName: null, teamId: null, teamKey: null,
     projectId: null, projectName: null, labels: [], estimate: null, cycleName: null, cycleNumber: null,
     milestoneName: null, linkCount: 0, prCount: 0, attachmentsTruncated: false, url: "", description: null,
     stateId: null, parentId: null, createdAt: "", updatedAt: "", ...over }) as IssueListItem;

describe("compareIssues", () => {
  it("orders by due date ascending, nulls last", () => {
    const a = mk({ dueDate: "2026-06-20" });
    const b = mk({ dueDate: null });
    expect(compareIssues(a, b, "dueDate")).toBeLessThan(0);
  });
  it("orders by priority using the priority order", () => {
    const urgent = mk({ priority: 1 });
    const low = mk({ priority: 4 });
    expect(compareIssues(urgent, low, "priority")).toBeLessThan(0);
  });
});
```

(Adjust the field set to match the real `IssueListItem`; if `compareIssues` references `PRIORITY_ORDER`, move that const into `IssueRow.tsx` too. If the due-date null-handling differs, match the moved implementation — do not change its behavior.)

- [ ] **Step 4: Verify.**

Run: `npx vitest run src/features/issues/IssueRow.test.ts` → PASS
Run: `npx tsc --noEmit` → clean
Run: `npx vitest run` → full suite green (IssuesView's existing tests unchanged)
Run: `npm run build 2>&1 | tail -3` → succeeds

- [ ] **Step 5: Commit.**

```bash
git add src/features/issues/IssueRow.tsx src/features/issues/IssuesView.tsx src/features/issues/IssueRow.test.ts
git commit -m "refactor(issues): extract IssueRow/MetaCluster/Pill/LabelPills/PriorityIcon + compareIssues"
```

---

### Task A2: Extract the display-options popover

**Files:**
- Create: `src/features/issues/DisplayOptions.tsx`
- Modify: `src/features/issues/IssuesView.tsx`

**Interfaces:**
- Consumes: `viewConfig.ts` types.
- Produces: `export function DisplayOptions({ ordering, onOrdering, completed, onCompleted, display, onToggleDisplay }: { ordering: Ordering; onOrdering: (o: Ordering) => void; completed: Completed; onCompleted: (c: Completed) => void; display: DisplayProps; onToggleDisplay: (k: DisplayKey) => void })` — renders the Ordering select, Completed-issues select, and Display-property toggle chips (the popover *content*, not the trigger button).

- [ ] **Step 1: Move the popover content.** In `IssuesView.tsx`, locate the display-options popover content (the Ordering `<select>`, the Completed `<select>`, and the "Display properties" toggle chips). Extract that JSX into `DisplayOptions.tsx`'s `DisplayOptions` component, parameterized by the props above (replace the inline state setters with the `on*` callbacks and the inline `display`/`ordering`/`completed` reads with the props). Move any local style consts it uses (e.g. `miniSelect`, the chip class helper) into `DisplayOptions.tsx`. Do NOT include any "Nested sub-issues" toggle (it doesn't exist today and is out of scope).

- [ ] **Step 2: Use it in `IssuesView.tsx`.** Replace the inline popover content with `<DisplayOptions ordering={ordering} onOrdering={setOrdering} completed={completed} onCompleted={setCompleted} display={display} onToggleDisplay={toggleDisplay} />` (match IssuesView's existing state setter names; if it toggles display via a different mechanism, pass an adapter so behavior is identical). Keep IssuesView's funnel trigger button + Popover wrapper as-is.

- [ ] **Step 3: Verify (no behavior change).**

Run: `npx tsc --noEmit` → clean
Run: `npx vitest run` → full suite green
Run: `npm run build 2>&1 | tail -3` → succeeds
Manual note in report: the Issues-list funnel still shows Ordering/Completed/Display-properties and behaves as before.

- [ ] **Step 4: Commit.**

```bash
git add src/features/issues/DisplayOptions.tsx src/features/issues/IssuesView.tsx
git commit -m "refactor(issues): extract DisplayOptions popover content"
```

---

### Task A3: Sub-issues reuse the row + display options

**Files:**
- Modify: `src/features/drawer/IssueDrawer.tsx` (sub-issues `DrawerSection`, ~lines 485-529; imports)

**Interfaces:**
- Consumes: `IssueRow`, `compareIssues` (Task A1); `DisplayOptions` (Task A2); `DEFAULT_DISPLAY`/`DEFAULT_CONFIG`/`Ordering`/`Completed`/`DisplayKey`/`DisplayProps` (`viewConfig`); `useIssues` (already imported), `dhakaToday` (`@/lib/dates`), `Popover` (`@/components/Popover`), `SlidersHorizontal` (lucide).

- [ ] **Step 1: Add sub-issue display state + child resolution.** Near the other hooks in `IssueDetail`, add:

```tsx
const [subOrdering, setSubOrdering] = useState<Ordering>("priority");
const [subCompleted, setSubCompleted] = useState<Completed>("all");
const [subDisplay, setSubDisplay] = useState<DisplayProps>(() => ({
  ...DEFAULT_DISPLAY,
  id: false, created: false, updated: false, // sub-issue rows: hide these by default
}));
const toggleSubDisplay = (k: DisplayKey) => setSubDisplay((d) => ({ ...d, [k]: !d[k] }));

const issuesById = useMemo(
  () => new Map((issues ?? []).map((i) => [i.id, i])),
  [issues],
);
```

(Imports: add `useState`/`useMemo` if not present; `Ordering, Completed, DisplayKey, DisplayProps, DEFAULT_DISPLAY` from `@/features/issues/viewConfig`; `IssueRow, compareIssues` from `@/features/issues/IssueRow`; `DisplayOptions` from `@/features/issues/DisplayOptions`; `dhakaToday` from `@/lib/dates`; `SlidersHorizontal` from lucide-react. `Popover` is already imported.)

- [ ] **Step 2: Replace the sub-issues `DrawerSection` body.** Replace the current `live.children.map(...)` custom rows with shared rows resolved from the cache, sorted + filtered. Replace the whole `<div className="space-y-1"> … </div>` inside the Sub-issues `DrawerSection` with:

```tsx
              {(() => {
                const today = dhakaToday();
                const rows = live.children
                  .map((c) => issuesById.get(c.id))
                  .filter((i): i is NonNullable<typeof i> => !!i)
                  .filter((i) => (subCompleted === "active" ? i.stateType !== "completed" && i.stateType !== "canceled" : true))
                  .sort((a, b) => compareIssues(a, b, subOrdering));
                return (
                  <div>
                    {rows.map((sub) => (
                      <IssueRow
                        key={sub.id}
                        issue={sub}
                        display={subDisplay}
                        avatar={sub.assigneeName ? { name: sub.assigneeName } : null}
                        today={today}
                        onOpen={openIssue}
                        onContextMenu={(e) => openMenu(e, sub.id)}
                      />
                    ))}
                    {rows.length === 0 && (
                      <p className="px-2 py-1 text-xs text-muted-foreground">No sub-issues match the current filter.</p>
                    )}
                    {live.hasMoreChildren && <p className="px-2 pt-1 text-xs text-muted-foreground">Showing the first 50 sub-issues.</p>}
                  </div>
                );
              })()}
```

(If `IssueRow`'s `onOpen`/`onContextMenu`/`avatar`/`today` prop names differ from Task A1's, match them exactly.)

- [ ] **Step 3: Add the funnel display-options button to the Sub-issues section header.** The `DrawerSection` renders a `title`/`meta`; add an `action` affordance OR place a `Popover` funnel just inside the section. Simplest: render a small `Popover` funnel as the first child of the section body, right-aligned:

```tsx
              <div className="mb-1 flex justify-end">
                <Popover
                  align="end"
                  buttonTitle="Display options"
                  buttonClassName="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  button={<SlidersHorizontal className="size-3.5" />}
                  panelClassName="w-72 rounded-lg border border-border bg-popover p-3 shadow-2xl"
                >
                  {() => (
                    <DisplayOptions
                      ordering={subOrdering}
                      onOrdering={setSubOrdering}
                      completed={subCompleted}
                      onCompleted={setSubCompleted}
                      display={subDisplay}
                      onToggleDisplay={toggleSubDisplay}
                    />
                  )}
                </Popover>
              </div>
```

- [ ] **Step 4: Verify.**

Run: `npx tsc --noEmit` → clean
Run: `npx vitest run` → full suite green
Run: `npm run build 2>&1 | tail -3` → succeeds
Report: confirm a sub-issue row now shows the list badges; the funnel changes ordering/completed/display.

> No new unit test (the section pulls the whole `IssueDetail`); verified by tsc/build + manual smoke. `compareIssues` is covered by Task A1.

- [ ] **Step 5: Commit.**

```bash
git add src/features/drawer/IssueDrawer.tsx
git commit -m "feat(sub-issues): reuse IssueRow + DisplayOptions (badges + funnel filter)"
```

---

### Task B1: Backend `create_label` + binding + auto-color

**Files:**
- Modify: `src-tauri/src/linear/issues.rs`, `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs`
- Modify: `src/lib/commands.ts`
- Create: `src/features/drawer/labelColors.ts` + `src/features/drawer/labelColors.test.ts`

**Interfaces:**
- Produces (Rust): `LinearClient::create_label(auth, name, color, team_id: Option<&str>) -> Result<ParsedLabel, LinearError>`; command `create_label(name: String, team_id: Option<String>, color: String) -> Result<LabelOut, CmdError>`. (TS): `createLabel(name: string, teamId: string | null, color: string): Promise<Label>`; `pickLabelColor(existing: Label[]): string`.

- [ ] **Step 1: Rust parse test (TDD).** In `issues.rs` `mod tests`:

```rust
    #[test]
    fn parses_label_create() {
        let body = r##"{"data":{"issueLabelCreate":{"success":true,"issueLabel":{
          "id":"l9","name":"infra","color":"#8b5cf6"}}}}"##;
        let l = parse_label_create(body).unwrap();
        assert_eq!(l.id, "l9");
        assert_eq!(l.name.as_deref(), Some("infra"));
        assert!(parse_label_create(r#"{"data":{"issueLabelCreate":{"success":false}}}"#).is_err());
    }
```

Run: `cargo test --manifest-path src-tauri/Cargo.toml parses_label_create 2>&1 | rg "cannot find|error\["` → fails (not defined).

- [ ] **Step 2: Implement parse + builder + client method.** In `issues.rs` (mirroring `parse_comment_create` / `comment_create_mutation`):

```rust
pub fn parse_label_create(body: &str) -> Result<ParsedLabel, LinearError> {
    let data = extract_data(body)?;
    let created = data.get("issueLabelCreate").ok_or(LinearError::Malformed)?;
    if created.get("success").and_then(|b| b.as_bool()) != Some(true) {
        return Err(LinearError::Api("issueLabelCreate returned success=false".into()));
    }
    let l = created.get("issueLabel").ok_or(LinearError::Malformed)?;
    Ok(ParsedLabel {
        id: s(l, "id").unwrap_or_default(),
        name: s(l, "name"),
        color: s(l, "color"),
    })
}

fn label_create_mutation() -> String {
    "mutation L($input: IssueLabelCreateInput!) { issueLabelCreate(input: $input) { success issueLabel { id name color } } }".to_string()
}
```

Client method in `impl LinearClient`:

```rust
    pub async fn create_label(
        &self,
        auth: &str,
        name: &str,
        color: &str,
        team_id: Option<&str>,
    ) -> Result<ParsedLabel, LinearError> {
        let mut input = serde_json::json!({ "name": name, "color": color });
        if let Some(t) = team_id {
            input["teamId"] = serde_json::Value::String(t.to_string());
        }
        let req = serde_json::json!({ "query": label_create_mutation(), "variables": { "input": input } });
        parse_label_create(&self.post(auth, req).await?)
    }
```

Run: `cargo test --manifest-path src-tauri/Cargo.toml parses_label_create 2>&1 | rg "test result"` → ok.

- [ ] **Step 3: Command + registration.** In `commands/mod.rs` (authed-call pattern; `LabelOut` already exists):

```rust
#[tauri::command]
pub async fn create_label(
    state: State<'_, AppState>,
    name: String,
    team_id: Option<String>,
    color: String,
) -> Result<LabelOut, CmdError> {
    let auth = authed(&state).await?;
    let l = state
        .linear
        .create_label(&auth, &name, &color, team_id.as_deref())
        .await
        .map_err(CmdError::from)?;
    Ok(LabelOut { id: l.id, name: l.name, color: l.color })
}
```

Register `commands::create_label` in `lib.rs`'s `tauri::generate_handler![…]` (fix the preceding comma).

Run: `cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | rg -i "warning|error" || echo clean` → clean; `cargo fmt --manifest-path src-tauri/Cargo.toml`.

- [ ] **Step 4: TS binding + auto-color (TDD the picker).** In `commands.ts`:

```ts
export const createLabel = (name: string, teamId: string | null, color: string): Promise<Label> =>
  invoke("create_label", { name, teamId, color });
```

Create `src/features/drawer/labelColors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { LABEL_COLORS, pickLabelColor } from "./labelColors";
import type { Label } from "@/lib/commands";

const lbl = (color: string): Label => ({ id: color, name: "x", color });

describe("pickLabelColor", () => {
  it("returns the first palette color when none are used", () => {
    expect(pickLabelColor([])).toBe(LABEL_COLORS[0]);
  });
  it("returns a color not already used when possible", () => {
    const used = LABEL_COLORS.slice(0, 3).map(lbl);
    expect(LABEL_COLORS.slice(0, 3)).not.toContain(pickLabelColor(used));
  });
});
```

Create `src/features/drawer/labelColors.ts`:

```ts
import type { Label } from "@/lib/commands";

/** Linear-style label color palette. */
export const LABEL_COLORS = [
  "#6e79d6", "#4cb782", "#f2c94c", "#f2994a", "#eb5757",
  "#bb87fc", "#4ea7fc", "#2dd4bf", "#e879a6", "#95a2b3",
] as const;

/** Pick a palette color not already used by an existing label; cycle if all used. */
export function pickLabelColor(existing: Label[]): string {
  const used = new Set(existing.map((l) => (l.color ?? "").toLowerCase()));
  const free = LABEL_COLORS.find((c) => !used.has(c.toLowerCase()));
  return free ?? LABEL_COLORS[existing.length % LABEL_COLORS.length];
}
```

Run: `npx vitest run src/features/drawer/labelColors.test.ts` → PASS; `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit.**

```bash
git add src-tauri/src/linear/issues.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs src/lib/commands.ts src/features/drawer/labelColors.ts src/features/drawer/labelColors.test.ts
git commit -m "feat(labels): create_label backend command + binding + color picker"
```

---

### Task B2: Label dropdown (search + checklist + create)

**Files:**
- Modify: `src/lib/queries.ts` (a `useCreateLabel` hook)
- Modify: `src/features/drawer/IssueDrawer.tsx` (the Labels `RailCard` `action` Popover)

**Interfaces:**
- Consumes: `createLabel` + `pickLabelColor` + `LABEL_COLORS` (Task B1); `useLabels`/`patch` (existing).
- Produces: `useCreateLabel()` (TanStack mutation invalidating `["labels"]`).

- [ ] **Step 1: `useCreateLabel` hook.** In `queries.ts`:

```ts
export function useCreateLabel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, teamId, color }: { name: string; teamId: string | null; color: string }) =>
      createLabel(name, teamId, color),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["labels"] }),
    onError: (err) => gooeyToast.error("Couldn't create label", { description: errorText(err) }),
  });
}
```

(Add `createLabel` to the `./commands` import in `queries.ts`.)

- [ ] **Step 2: Rework the Labels popover into a search/checklist/create dropdown.** In `IssueDrawer.tsx`, replace the Labels `RailCard` `action` Popover's children (the current plain checklist) with a search-driven dropdown. Add near the `IssueDetail` hooks: `const createLabelMut = useCreateLabel();`. Replace the popover content with a small inline component (define `LabelDropdown` in the file, or inline) that holds a `query` state and renders:

```tsx
{() => {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [query, setQuery] = useState("");
  const all = labels ?? [];
  const applied = new Set(live?.labels.map((x) => x.id) ?? []);
  const q = query.trim().toLowerCase();
  const filtered = q ? all.filter((l) => (l.name ?? "").toLowerCase().includes(q)) : all;
  const exact = all.some((l) => (l.name ?? "").toLowerCase() === q);
  const toggle = (id: string) => {
    const ids = live?.labels.map((x) => x.id) ?? [];
    patch({ labelIds: applied.has(id) ? ids.filter((x) => x !== id) : [...ids, id] });
  };
  const create = () => {
    const name = query.trim();
    if (!name) return;
    createLabelMut.mutate(
      { name, teamId: d.teamId, color: pickLabelColor(all) },
      { onSuccess: (lbl) => { patch({ labelIds: [...(live?.labels.map((x) => x.id) ?? []), lbl.id] }); setQuery(""); } },
    );
  };
  return (
    <div className="w-64">
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Change or add labels…"
        className="mb-1 w-full rounded-md border border-border bg-secondary/40 px-2 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-foreground/25"
      />
      <div className="max-h-64 overflow-y-auto">
        {filtered.map((l) => (
          <button key={l.id} type="button" onClick={() => toggle(l.id)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent">
            <span className={`flex size-3.5 items-center justify-center rounded border ${applied.has(l.id) ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>
              {applied.has(l.id) && <Check className="size-2.5" />}
            </span>
            <span className="size-2.5 rounded-full" style={{ backgroundColor: l.color ?? "#6b7280" }} />
            <span className="flex-1 truncate">{l.name ?? "label"}</span>
          </button>
        ))}
        {q && !exact && (
          <button type="button" onClick={create} disabled={createLabelMut.isPending}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-60">
            <Plus className="size-3.5 text-muted-foreground" />
            <span>Create label “{query.trim()}”</span>
          </button>
        )}
        {filtered.length === 0 && !q && <div className="px-2 py-1.5 text-[12px] text-muted-foreground">No labels</div>}
      </div>
    </div>
  );
}}
```

Widen the popover `panelClassName` to fit (`w-64`/`p-1`). Add `Check` and `Plus` to the lucide import if not present. (The `eslint-disable rules-of-hooks` is because the render-prop body uses `useState`; alternatively extract a `LabelDropdown` component and render `<LabelDropdown … />` to avoid the disable — prefer the extracted component if clean.)

> Prefer extracting a `function LabelDropdown({ labels, appliedIds, teamId, onToggle, onCreated })` component (so `useState` is legit) and render it inside the popover. Use whichever keeps hooks valid; do not ship an actual rules-of-hooks violation.

- [ ] **Step 3: Verify.**

Run: `npx tsc --noEmit` → clean
Run: `npx vitest run` → full suite green
Run: `npm run build 2>&1 | tail -3` → succeeds
Report: typing a new name shows "Create label …"; creating assigns it; existing labels filter + toggle.

> No new component unit test (rail pulls `IssueDetail`); the picker + backend parse are unit-tested in B1. Verified by tsc/build + manual smoke.

- [ ] **Step 4: Commit.**

```bash
git add src/lib/queries.ts src/features/drawer/IssueDrawer.tsx
git commit -m "feat(labels): search/checklist/create label dropdown in the rail"
```

---

## Self-Review

**Spec coverage:**
- A1 extract row components → Task A1. ✓  A2 extract display-options → Task A2. ✓  A3 sub-issues reuse + funnel (no nested) → Task A3. ✓
- B1 backend create_label + binding + auto-color → Task B1. ✓  B2 search/checklist/create dropdown → Task B2. ✓
- Nested toggle omitted (noted in A2 Step 1 + Global Constraints). ✓
- Issues-list unchanged by extraction (A1/A2 verify gates). ✓

**Placeholder scan:** Extraction tasks (A1/A2) instruct verbatim MOVE of named existing functions (concrete, not placeholders). New code (A3/B1/B2) is provided in full. No TBD/"add error handling".

**Type consistency:** `IssueRow`/`compareIssues`/`DisplayOptions`/`pickLabelColor`/`createLabel`/`useCreateLabel`/`create_label` signatures match across tasks. `DisplayProps`/`Ordering`/`Completed`/`DisplayKey` come from `viewConfig.ts` (already shared). `ParsedLabel`/`LabelOut`/`Label` are the existing types.

> Execution note: A1/A2 are verbatim extractions whose exact moved code lives in `IssuesView.tsx` — the implementer reads that file and moves the named symbols; if a moved helper's name/shape differs from this plan's assumption, match the source. A3/B2 prop names must match A1/A2's exported signatures (the implementer should reconcile if the extracted signatures differ).
