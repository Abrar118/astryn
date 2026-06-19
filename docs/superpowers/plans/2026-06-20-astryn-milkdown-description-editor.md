# Milkdown Description Editor Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Tiptap description editor with Milkdown (ProseMirror + remark) and deliver read-only-default + double-click-to-edit, typing-pause autosave with a breadcrumb save indicator, in-app issue-mention pills, correct task lists, and the image proxy — with Markdown canonical at every boundary.

**Architecture:** A new Milkdown-based `DescriptionEditor` renders read-only by default (via the existing `react-markdown` `createMarkdownComponents` factory) and swaps to an editable Milkdown view on double-click, saving on blur. Markdown I/O goes through Milkdown's remark serializer (no HTML/JSON persisted). Custom Milkdown nodes render proxied Linear images and issue-mention pills. The existing `DescriptionAutosave` queue and `IssueDrawer` integration contract (`onSave`, `onOpenLink`, `resolveMention`) are reused unchanged; the breadcrumb shows save state.

**Tech Stack:** React 19, TypeScript strict, `@milkdown/kit@7.21.2` (core/ctx/utils/preset-commonmark/preset-gfm/plugin-listener/plugin-slash/plugin-tooltip), `@milkdown/react@7.21.2`, `@prosemirror-adapter/react`, remark, TanStack Query 5, Vitest, jsdom.

## Global Constraints

- All `@milkdown/*` packages pinned to the **same exact** version `7.21.2`; exactly one `prosemirror-model` resolved; no Milkdown Pro/cloud/license-keyed packages; all MIT/FOSS.
- Markdown is the only format that crosses into TanStack Query / Rust / SQLite / Linear. Never persist HTML or ProseMirror JSON. Empty document serializes to `null` at the command boundary.
- Markdown serialization must be **idempotent**: `serialize(parse(serialize(parse(x)))) === serialize(parse(x))`.
- The proxied image `data:` URL lives only in the DOM; `node.attrs.src` and serialized Markdown keep the original URL.
- Issue-mention pills and all link activation open issues **in-app only** (never the webview); non-issue links open via `safeExternalUrl` in the system browser; the webview never navigates.
- No Edit button / source toggle / Save button / modal; no localStorage; one description mutation path; `silent` suppresses only the duplicate failure toast.
- CSP unchanged (images via proxied `data:`); no token to the webview; sanitized command errors; Asia/Dhaka for date logic.
- TS strict (`noUnusedLocals`/`noUnusedParameters`). Verify each Milkdown API against the installed `@milkdown/kit@7.21.2` / `@milkdown/react@7.21.2` `.d.ts` before relying on it; iterate against the real types.
- Reuse, do not reimplement: `DescriptionAutosave` (`src/features/drawer/descriptionAutosave.ts`), `createMarkdownComponents`/`issueIdentifierFromHref`/`MentionResolver` (`src/features/drawer/markdownComponents.tsx`), `LinearMarkdownImage`/`classifyImageSource`/`loadLinearImage`, `EditorErrorBoundary`/`ReadOnlyDescription`.

---

## File Map

- Create `src/features/drawer/milkdownEditor.ts` — the Milkdown editor configuration: presets (commonmark + gfm), node-attr fixes, remark stringify options, and a headless `roundtripMarkdown(md)` helper used by tests.
- Create `src/features/drawer/milkdownEditor.test.ts` — headless round-trip corpus tests (no corruption, idempotent, schema-valid).
- Create `src/features/drawer/milkdownImageNode.tsx` — custom Milkdown image node + React node view rendering through the Rust proxy.
- Create `src/features/drawer/milkdownMention.ts` — remark plugin + Milkdown node that turns `/issue/<ID>` links into mention nodes; pure `issueMentionFromUrl` detection helper.
- Create `src/features/drawer/milkdownMention.test.ts` — pure detection + round-trip (link preserved) tests.
- Create `src/features/drawer/milkdownMenus.ts` — slash + tooltip command catalog and pure `filterSlashCommands(query)` helper.
- Create `src/features/drawer/milkdownMenus.test.ts` — pure slash-filter tests.
- Rewrite `src/features/drawer/DescriptionEditor.tsx` — read-only-default + double-click-to-edit Milkdown component, autosave, status callback, error boundary; keep exporting `EditorErrorBoundary`/`ReadOnlyDescription`.
- Modify `src/features/drawer/DescriptionEditor.test.tsx` — read-only render, double-click-to-edit, read-only mode has no edit affordance.
- Modify `src/features/drawer/IssueDrawer.tsx` — pass an `onSaveStateChange` to the editor and render the breadcrumb save indicator; remove Tiptap-era wiring.
- Modify `src/styles/index.css` — Milkdown (`.milkdown`/ProseMirror), mention-pill, slash/tooltip styles; keep the `.astryn-prose` read-only styles.
- Delete `src/features/drawer/descriptionExtensions.ts`, `descriptionExtensions.test.ts`, `descriptionCommands.ts`, `descriptionCommands.test.ts`, `DescriptionImage.tsx` (Tiptap-specific) in the final task.
- Modify `package.json`, `package-lock.json` — add Milkdown deps (Task 1); remove Tiptap deps (final task).

---

### Task 1: Dependencies

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Install Milkdown React + adapter (exact, FOSS)**

`@milkdown/kit@7.21.2` is already installed. Add the React bindings at the **same exact** version and the React ProseMirror adapter Milkdown uses for node views:

```bash
npm install --save-exact @milkdown/react@7.21.2 @prosemirror-adapter/react@0.2.7
```

Expected: both appear in `package.json` with exact versions. Do not add any `@milkdown` Pro/cloud package.

- [ ] **Step 2: Verify a single ProseMirror model**

Run: `npm ls prosemirror-model`

Expected: exactly one resolved `prosemirror-model` (deduped). If a second copy appears, stop and report — a duplicate ProseMirror breaks the schema.

- [ ] **Step 3: Verify the existing suite is green**

Run: `npx vitest run`

Expected: all current tests pass (Tiptap editor still present at this point).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add Milkdown React bindings"
```

---

### Task 2: Markdown engine config + headless round-trip tests

**Files:**
- Create: `src/features/drawer/milkdownEditor.ts`
- Create: `src/features/drawer/milkdownEditor.test.ts`

**Interfaces:**
- Produces: `descriptionMilkdownConfig(): (ctx) => void` (or a `MakeEditor` factory) applying commonmark + gfm + node-attr fixes + remark stringify options; `roundtripMarkdown(markdown: string): Promise<{ markdown: string; valid: boolean; error?: string }>` (headless parse→doc→serialize, with `doc.check()`); a `descriptionPlugins` array consumed by later tasks. Later tasks add image/mention/menu plugins to this array.

- [ ] **Step 1: Write the failing round-trip corpus test**

Create `milkdownEditor.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { roundtripMarkdown } from "./milkdownEditor";

const corpus: Record<string, string> = {
  imageBrackets: "![a[b]c](https://uploads.linear.app/x.png)",
  codeFence: "````\n```\ninner\n```\n````",
  tablePipe: "| A\\|B | C |\n| --- | --- |\n| 1 | 2 |",
  linkCode: "see [`provision-clerk --create`](https://linear.app/x/issue/PRO-1/s)",
  strikeCode: "~~`old`~~ done",
  imageInList: "- ![p](https://uploads.linear.app/x.png)\n- two",
  standaloneImage: "![p](https://uploads.linear.app/x.png)",
  taskList: "- [ ] todo\n- [x] done",
  headingsAndCode: "## Plan\n\n**Bold** and *italic* with `code`.\n\n```ts\nconst x = 1\n```",
};

describe("Milkdown markdown round-trip", () => {
  for (const [name, md] of Object.entries(corpus)) {
    it(`${name}: schema-valid and idempotent`, async () => {
      const first = await roundtripMarkdown(md);
      expect(first.error ?? "ok").toBe("ok");
      expect(first.valid).toBe(true);
      const second = await roundtripMarkdown(first.markdown);
      expect(second.markdown).toBe(first.markdown);
    });
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/features/drawer/milkdownEditor.test.ts`
Expected: FAIL — `roundtripMarkdown` not exported.

- [ ] **Step 3: Implement the engine config + round-trip helper**

Create `milkdownEditor.ts`. Use the verified imports `@milkdown/kit/core` (`Editor`, `rootCtx`, `defaultValueCtx`, `serializerCtx`, `editorViewCtx`, `editorStateCtx`, `parserCtx`), `@milkdown/kit/preset/commonmark` (`commonmark`), `@milkdown/kit/preset/gfm` (`gfm`). The headless probe already proved these work; the only additions needed are **node-attr fixes** so `doc.check()` passes (the probe surfaced `image.title` null-vs-string and `bullet_list.spread` type mismatches) and remark **stringify options** (bullet `-`, fences, no setext) for Linear-style output and stable idempotency.

```ts
import { Editor, rootCtx, defaultValueCtx, serializerCtx, editorViewCtx } from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";

// Plugins shared by the live editor and the headless round-trip. Later tasks
// push the image, mention, and menu plugins onto this array.
export const descriptionPlugins: unknown[] = [commonmark, gfm];

/**
 * Apply remark stringify options + node-attr fixes so output is Linear-style
 * and schema-valid. Verify the exact ctx names against the installed
 * @milkdown/kit@7.21.2 types — the commonmark preset exposes a remark
 * stringify options ctx; set bullet "-", emphasis "*", strong "**", fence "`",
 * rule "-", and disable setext headings. Override the image node `title` attr
 * default to `null`-tolerant (parseMarkdown sets it null) and the list `spread`
 * attr to coerce to boolean, so `doc.check()` accepts parsed content.
 */
export function applyDescriptionConfig(ctx: unknown): void {
  // Implement against installed types: set remarkStringifyOptionsCtx and
  // override commonmark image/list node schema attrs. See milkdownEditor.test
  // for the required behavior (valid + idempotent for the corpus).
}

/** Build a headless editor, parse→doc→serialize, and validate the doc. */
export async function roundtripMarkdown(
  markdown: string,
): Promise<{ markdown: string; valid: boolean; error?: string }> {
  const root = document.createElement("div");
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, markdown);
      applyDescriptionConfig(ctx);
    })
    .use(commonmark)
    .use(gfm)
    .create();
  let out = "";
  let valid = false;
  let error: string | undefined;
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    try {
      view.state.doc.check();
      valid = true;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    out = ctx.get(serializerCtx)(view.state.doc);
  });
  await editor.destroy();
  return { markdown: out.trimEnd(), valid, error };
}
```

Iterate `applyDescriptionConfig` until the corpus test passes — the headless probe already showed the serializer is correct; only attr defaults + stringify options need tuning. Do **not** weaken the test assertions.

- [ ] **Step 4: Run the corpus test**

Run: `npx vitest run src/features/drawer/milkdownEditor.test.ts`
Expected: every corpus case schema-valid and idempotent.

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/features/drawer/milkdownEditor.ts src/features/drawer/milkdownEditor.test.ts
git commit -m "feat: milkdown markdown engine with idempotent round-trip"
```

---

### Task 3: Linear image proxy node

**Files:**
- Create: `src/features/drawer/milkdownImageNode.tsx`
- Modify: `src/features/drawer/milkdownEditor.ts` (push the image plugin onto `descriptionPlugins`)
- Modify: `src/features/drawer/milkdownEditor.test.ts` (image round-trip preserves original URL)

**Interfaces:**
- Consumes: `descriptionPlugins` from Task 2; `LinearMarkdownImage` from `./LinearMarkdownImage`.
- Produces: `descriptionImageNode` (a Milkdown `$view`/`$node` plugin set) and a React node-view component `MilkdownImage`.

- [ ] **Step 1: Add the failing image round-trip assertion**

Append to `milkdownEditor.test.ts`:

```ts
import { roundtripMarkdown as rt } from "./milkdownEditor";

describe("Milkdown image node", () => {
  it("keeps the original URL in markdown, never a data URL", async () => {
    const r = await rt("![diagram](https://uploads.linear.app/a/b.png)");
    expect(r.valid).toBe(true);
    expect(r.markdown).toContain("![diagram](https://uploads.linear.app/a/b.png)");
    expect(r.markdown).not.toContain("data:");
  });
});
```

- [ ] **Step 2: Run to verify current state**

Run: `npx vitest run src/features/drawer/milkdownEditor.test.ts`
Expected: PASS for URL preservation already (commonmark image serializes the src) — this test locks it before adding the node view, which must not regress it.

- [ ] **Step 3: Implement the proxy node view**

Create `milkdownImageNode.tsx`. Replace the commonmark image node's view with a React node view (via `@prosemirror-adapter/react`'s `useNodeViewFactory` wired in `DescriptionEditor`, Task 7) that renders `LinearMarkdownImage` from `node.attrs.src`/`alt`. The node **schema and markdown parse/serialize stay the commonmark default** (so the original URL round-trips); only the DOM rendering is overridden. Verify the `$view` util signature against installed types.

```tsx
import { NodeViewWrapper } from "@prosemirror-adapter/react"; // verify exact import
import { LinearMarkdownImage } from "./LinearMarkdownImage";

export function MilkdownImage({ node }: { node: { attrs: { src?: string; alt?: string } } }) {
  return (
    <NodeViewWrapper className="my-2">
      <LinearMarkdownImage src={node.attrs.src ?? ""} alt={node.attrs.alt ?? ""} />
    </NodeViewWrapper>
  );
}
```

Push the image `$view` plugin onto `descriptionPlugins` in `milkdownEditor.ts` (guarded so the headless `roundtripMarkdown` — which has no React node-view factory — still works; the view override is a no-op headlessly, the schema/serializer is unchanged).

- [ ] **Step 4: Run image tests + typecheck**

Run: `npx vitest run src/features/drawer/milkdownEditor.test.ts`
Expected: image URL-preservation test passes; corpus still green.

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/features/drawer/milkdownImageNode.tsx src/features/drawer/milkdownEditor.ts src/features/drawer/milkdownEditor.test.ts
git commit -m "feat: proxy Linear images in the milkdown editor"
```

---

### Task 4: Issue-mention pills

**Files:**
- Create: `src/features/drawer/milkdownMention.ts`
- Create: `src/features/drawer/milkdownMention.test.ts`
- Modify: `src/features/drawer/milkdownEditor.ts` (push the mention plugin)

**Interfaces:**
- Consumes: `descriptionPlugins`; `issueIdentifierFromHref` and `MentionResolver` from `./markdownComponents`.
- Produces: pure `issueMentionFromUrl(href: string): string | null` (re-uses `issueIdentifierFromHref`); a Milkdown mention node/plugin `descriptionMentionPlugin(resolveMention, openIssue)` that renders a status-dot + identifier + title pill and on click calls `openIssue(id)` (in-app only). Round-trips back to the original `[ID](url)` markdown link.

- [ ] **Step 1: Write the failing pure-detection + round-trip tests**

Create `milkdownMention.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { issueMentionFromUrl } from "./milkdownMention";
import { roundtripMarkdown } from "./milkdownEditor";

describe("issueMentionFromUrl", () => {
  it("extracts the identifier from a Linear issue URL", () => {
    expect(issueMentionFromUrl("https://linear.app/gam/issue/PRO-153/x")).toBe("PRO-153");
  });
  it("returns null for non-issue links", () => {
    expect(issueMentionFromUrl("https://example.com")).toBeNull();
  });
});

describe("mention round-trip", () => {
  it("a mention link survives serialization as the original markdown link", async () => {
    const md = "done ([PRO-153](https://linear.app/gam/issue/PRO-153/x))";
    const r = await roundtripMarkdown(md);
    expect(r.valid).toBe(true);
    expect(r.markdown).toContain("[PRO-153](https://linear.app/gam/issue/PRO-153/x)");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/features/drawer/milkdownMention.test.ts`
Expected: FAIL — `issueMentionFromUrl` not exported.

- [ ] **Step 3: Implement the mention detection + node**

Create `milkdownMention.ts`. `issueMentionFromUrl` delegates to `issueIdentifierFromHref`. The mention node is a Milkdown node whose markdown parse/serialize maps to/from a standard link (`[ID](url)`) so round-trip is preserved, with a React node view rendering the pill (status dot from `resolveMention`, identifier text, title tooltip); click → `openIssue`. Implement the node/view against installed `@milkdown/kit/utils` `$node`/`$remark`/`$view` types; the pill is **not** an anchor (no native navigation — fixes "opens both web and Astryn").

```ts
import { issueIdentifierFromHref } from "./markdownComponents";

export function issueMentionFromUrl(href: string): string | null {
  return issueIdentifierFromHref(href);
}

// descriptionMentionPlugin(resolveMention, openIssue): a Milkdown plugin set
// (remark transform + node + react view) — implement against installed types so
// markdown `[ID](url)` <-> mention node, view = pill, click = openIssue(id).
```

Push `descriptionMentionPlugin` onto `descriptionPlugins` (headless round-trip must still preserve the link markdown without a React view).

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/features/drawer/milkdownMention.test.ts`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/features/drawer/milkdownMention.ts src/features/drawer/milkdownMention.test.ts src/features/drawer/milkdownEditor.ts
git commit -m "feat: in-app issue-mention pills in the milkdown editor"
```

---

### Task 5: Slash + tooltip menus

**Files:**
- Create: `src/features/drawer/milkdownMenus.ts`
- Create: `src/features/drawer/milkdownMenus.test.ts`
- Modify: `src/features/drawer/milkdownEditor.ts` (push slash + tooltip plugins)

**Interfaces:**
- Consumes: `descriptionPlugins`; `@milkdown/kit/plugin/slash`, `@milkdown/kit/plugin/tooltip`.
- Produces: `slashCommands` catalog; pure `filterSlashCommands(query: string): SlashCommand[]`; `inlineCommands` catalog; menu config consumed by `DescriptionEditor`.

- [ ] **Step 1: Write the failing pure slash-filter test**

Create `milkdownMenus.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { filterSlashCommands, slashCommands } from "./milkdownMenus";

describe("filterSlashCommands", () => {
  it("returns all commands for an empty query", () => {
    expect(filterSlashCommands("")).toHaveLength(slashCommands.length);
  });
  it("matches label and keywords case-insensitively", () => {
    expect(filterSlashCommands("HEAD").map((c) => c.id)).toEqual(["h1", "h2", "h3"]);
    expect(filterSlashCommands("todo").map((c) => c.id)).toContain("task");
  });
  it("returns nothing for an unmatched query", () => {
    expect(filterSlashCommands("zzz")).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/features/drawer/milkdownMenus.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the catalogs + filter + plugin wiring**

Create `milkdownMenus.ts`: a `slashCommands` array (`{ id, label, keywords, run(ctx) }`) for text/h1/h2/h3/bullet/ordered/task/quote/code/divider/table, a pure `filterSlashCommands`, an `inlineCommands` array for bold/italic/strike/code/link, and the slash + tooltip plugin configuration (built on `@milkdown/kit/plugin/slash` and `@milkdown/kit/plugin/tooltip`, calling Milkdown commands from the commonmark/gfm presets — verify command names against installed types). `DescriptionEditor` (Task 7) must call `filterSlashCommands` (not re-implement it). Push the slash + tooltip plugins onto `descriptionPlugins`.

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/features/drawer/milkdownMenus.test.ts`
Expected: 3 pass.

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/features/drawer/milkdownMenus.ts src/features/drawer/milkdownMenus.test.ts src/features/drawer/milkdownEditor.ts
git commit -m "feat: slash and tooltip menus for the milkdown editor"
```

---

### Task 6: DescriptionEditor (read-only-default + double-click-to-edit)

**Files:**
- Rewrite: `src/features/drawer/DescriptionEditor.tsx`
- Modify: `src/features/drawer/DescriptionEditor.test.tsx`
- Modify: `src/styles/index.css`

**Interfaces:**
- Consumes: `descriptionPlugins`/`applyDescriptionConfig` (Task 2), image/mention/menu plugins (Tasks 3–5), `DescriptionAutosave`, `createMarkdownComponents`/`MentionResolver`, `@milkdown/react` (`useEditor`, `Milkdown`, `MilkdownProvider`), `@prosemirror-adapter/react` (`ProsemirrorAdapterProvider`, `useNodeViewFactory`).
- Produces: `DescriptionEditor` with props `{ markdown: string; editable: boolean; onSave: (md: string) => Promise<void>; onOpenLink: (href: string) => void; resolveMention?: MentionResolver; onSaveStateChange?: (s: SaveStatus) => void }`; re-exports `EditorErrorBoundary`, `ReadOnlyDescription`. `SaveStatus` continues to come from `descriptionAutosave`.

- [ ] **Step 1: Write failing component tests**

Replace the body of `DescriptionEditor.test.tsx` (keep `EditorErrorBoundary`/`ReadOnlyDescription` tests if present). These assert only what jsdom renders reliably — no ProseMirror selection geometry.

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DescriptionEditor } from "./DescriptionEditor";

afterEach(cleanup);

describe("DescriptionEditor", () => {
  it("renders read-only Markdown by default (rich text, no editor textbox)", async () => {
    render(<DescriptionEditor markdown={"## Plan\n\n**Ship it**"} editable onSave={vi.fn()} onOpenLink={vi.fn()} />);
    expect(await screen.findByRole("heading", { level: 2, name: "Plan" })).toBeTruthy();
    expect(screen.getByText("Ship it").tagName).toBe("STRONG");
  });

  it("read-only mode shows no edit affordance", () => {
    render(<DescriptionEditor markdown="Cached" editable={false} onSave={vi.fn()} onOpenLink={vi.fn()} />);
    // Double-click must not mount an editable surface when not editable.
    fireEvent.doubleClick(screen.getByText("Cached"));
    expect(document.querySelector('[contenteditable="true"]')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/features/drawer/DescriptionEditor.test.tsx`
Expected: FAIL — component rewritten signature / behavior not present yet.

- [ ] **Step 3: Implement the read-only-default editor**

Rewrite `DescriptionEditor.tsx`:
- Default render: `ReadOnlyDescription` (the existing `createMarkdownComponents` path — already renders pills, proxied images, inline task lists) wrapped so a **double-click** (only when `editable`) flips to edit mode.
- Edit mode: a Milkdown editor (`MilkdownProvider` + `ProsemirrorAdapterProvider` + `useEditor`) configured with `applyDescriptionConfig` + `descriptionPlugins` + `plugin/listener` (`listenerCtx.markdownUpdated` → `queue.update(markdown)`), the image/mention React node views, and slash/tooltip menus. Seed content from `markdown`; focus on mount.
- Reuse `DescriptionAutosave` (750 ms debounce) exactly as today: `onSave` callback, subscribe status → local state **and** `onSaveStateChange`. On **blur**, `queue.flush()` and revert to read-only view.
- External reconciliation: while a draft is dirty keep it; adopt new `markdown` only when clean (reuse the `acceptExternal` pattern).
- Wrap the editable view in `EditorErrorBoundary` with the `ReadOnlyDescription` fallback.
- No localStorage / Edit button / source toggle / second mutation path.

Add Milkdown + ProseMirror base CSS imports and scoped styles (`.milkdown`, `.ProseMirror`) plus mention-pill / slash / tooltip styles in `src/styles/index.css`; keep `.astryn-prose`.

- [ ] **Step 4: Run component tests + typecheck + build**

Run: `npx vitest run src/features/drawer/DescriptionEditor.test.tsx`
Expected: pass.

Run: `npx tsc --noEmit`
Expected: clean.

Run: `npm run build`
Expected: passes (record the pre-existing chunk-size warning only).

- [ ] **Step 5: Commit**

```bash
git add src/features/drawer/DescriptionEditor.tsx src/features/drawer/DescriptionEditor.test.tsx src/styles/index.css
git commit -m "feat: read-only-default milkdown description editor with click-to-edit"
```

---

### Task 7: Drawer integration + breadcrumb save indicator

**Files:**
- Modify: `src/features/drawer/IssueDrawer.tsx`

**Interfaces:**
- Consumes: `DescriptionEditor` (Task 6) with `onSaveStateChange`; existing `handleLink`, `resolveMention`, `saveDescription`, `SaveStatus`.

- [ ] **Step 1: Wire the editor's save state to the breadcrumb**

In `IssueDrawer.tsx`'s `DrawerContent`: add `const [saveState, setSaveState] = useState<SaveStatus>("idle")`, pass `onSaveStateChange={setSaveState}` to `DescriptionEditor`, and render a save-state icon in the breadcrumb/action header — `saving` (spinner), `saved` (brief check), `error` (alert). Keep `saveDescription` using `mutateAsync({ ..., silent: true })` so only the editor surface/toast reports failure; show a `gooeyToast.error` only when `saveState` transitions to `error` (no duplicate). Continue passing `resolveMention` and `onOpenLink={handleLink}`.

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit`
Expected: clean.

Run: `npm run build`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/features/drawer/IssueDrawer.tsx
git commit -m "feat: show description save state in the issue breadcrumb"
```

---

### Task 8: Remove Tiptap + full verification

**Files:**
- Delete: `src/features/drawer/descriptionExtensions.ts`, `descriptionExtensions.test.ts`, `descriptionCommands.ts`, `descriptionCommands.test.ts`, `DescriptionImage.tsx`, `descriptionAutosave.test.ts` only if the queue moved (it does not — keep `descriptionAutosave.ts` + its test)
- Modify: `package.json`, `package-lock.json`, `vitest.config.ts` (drop Tiptap-only test aliases if now unused)

- [ ] **Step 1: Confirm Tiptap is unreferenced, then remove it**

Run: `rg -n "@tiptap|descriptionExtensions|descriptionCommands|DescriptionImage" src` — expected: no references outside the files being deleted.

Delete the Tiptap-specific files listed above. Remove all `@tiptap/*` and `@tiptap-pro` (none) packages:

```bash
npm uninstall @tiptap/core @tiptap/pm @tiptap/react @tiptap/starter-kit @tiptap/markdown @tiptap/extension-task-list @tiptap/extension-task-item @tiptap/extension-table @tiptap/extension-table-row @tiptap/extension-table-header @tiptap/extension-table-cell @tiptap/extension-image
```

Keep the `src/__mocks__/tauri-*.ts` + `vitest.config.ts` aliases (still needed — `LinearMarkdownImage` imports `@tauri-apps/*`).

- [ ] **Step 2: Verify no dangling references / single ProseMirror**

Run: `rg -n "@tiptap" . --glob '!package-lock.json'` → expected: none.
Run: `npm ls prosemirror-model` → expected: exactly one copy.

- [ ] **Step 3: Run all automated gates**

```bash
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
npx tsc --noEmit
npx vitest run
npm run build
```

Expected: every command exits zero (chunk-size warning only on build).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove Tiptap now that Milkdown is the description editor"
```

- [ ] **Step 5: Manual `tauri dev` checklist (user-run)**

Verify in a live drawer:
1. Double-click a description enters edit; typing then pausing autosaves; the breadcrumb shows saving→saved; a simulated failure shows the error state + one toast and retains the draft.
2. Blurring the editor saves and reverts to the read-only view.
3. Cached/offline descriptions are read-only with no edit affordance.
4. Issue-mention pills render with status + identifier and open the issue **in-app only** (never the browser) — verify the previously double-opening case.
5. Proxied Linear images render in both read-only and edit modes; the saved Markdown keeps the original URL (not a `data:` URL).
6. Task list checkboxes render inline.
7. The previously-crashing issues (PRO-93, PRO-187, PSY-395, PSY-373, PSY-268) open, render, and (where valid) edit without `contentMatchAt`.
8. `/` slash menu and the selection tooltip format correctly.

---

## Self-Review

**Spec coverage:** engine choice + deps (Task 1); remark round-trip/no-corruption + attr fixes (Task 2); image proxy with URL preservation (Task 3); mention pills in-app-only (Task 4); slash/tooltip menus (Task 5); read-only-default + double-click edit + autosave + error boundary (Task 6); breadcrumb save indicator + failure toast (Task 7); Tiptap removal + full gates + manual checklist (Task 8). All spec sections map to a task.

**Type consistency:** `descriptionPlugins`/`applyDescriptionConfig`/`roundtripMarkdown` (Task 2) are consumed verbatim by Tasks 3–6; `DescriptionEditor` prop names (`onSave`, `onOpenLink`, `resolveMention`, `onSaveStateChange`) match between Task 6 and Task 7; `filterSlashCommands`/`slashCommands` names match between Task 5 and its test; `issueMentionFromUrl` matches between Task 4 and its test; `SaveStatus` reused from `descriptionAutosave`.

**Library-API caveat:** Tasks 2–6 touch Milkdown APIs whose exact signatures must be confirmed against the installed `@milkdown/kit@7.21.2` / `@milkdown/react@7.21.2` types — the tests in each task are the correctness gate, and the headless probe already proved the serializer behaves. Implementers should iterate against the real types rather than assume.
