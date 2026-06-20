# Astryn Milkdown Description Editor

## Goal

Replace the Tiptap (`@tiptap/markdown`) description editor with **Milkdown** (ProseMirror + remark) to end the recurring Markdown round-trip corruption, and deliver: read-only-by-default with double-click-to-edit-in-place, typing-pause autosave with a breadcrumb save-state indicator, in-app issue-mention pills, correct GFM task-list/checkbox rendering, and a reliable image proxy — all with Markdown as the canonical format at every boundary.

## Why Milkdown

`@tiptap/markdown` parses with `marked` and serializes with a non-CommonMark-compliant writer; ~13 distinct round-trip corruption bugs were found (image bracket/paren escaping, code-fence length, table-cell pipes, fence tracking, inline-image-at-block, `code` mark excluding `link`/`strike`, etc.). Milkdown uses **remark** (the reference GFM implementation) for parse + serialize. A headless round-trip of every known corrupting construct through Milkdown confirmed: all serialize correctly and idempotently, and `link+code` / `strike+code` are valid (no mark-exclusion problem). Milkdown is ProseMirror-based (same engine family as Tiptap), MIT-licensed, and Markdown-first.

Rejected alternatives: **Novel** (is Tiptap → same bug class), **BlockNote** (Tiptap/ProseMirror, documented-lossy Markdown), **Plate** (remark but Slate engine → larger/riskier rewrite).

## Dependencies (MIT / FOSS, pinned exact)

`@milkdown/kit@7.21.2` (bundles core, ctx, transformer, prose, `preset/commonmark`, `preset/gfm`, `plugin/listener`, `plugin/slash`, `plugin/tooltip`, components) and `@milkdown/react@7.21.2`. No Crepe (we need custom nodes + our own read/edit + autosave). No `@milkdown/*` Pro/cloud or license-keyed packages. Keep the Tiptap packages removed once migration is complete and verified.

## Architecture

A focused `DescriptionEditor` (Milkdown) replaces the Tiptap one. `IssueDrawer` integration points are preserved unchanged: it passes canonical Markdown (`detailDesc`), `editable`, an awaitable `onSave(markdown)`, `onOpenLink(href)`, and `resolveMention(identifier)`. Only serialized Markdown crosses into TanStack Query / Rust / SQLite / Linear.

### Read-only-default + double-click-to-edit-in-place

- Default: render the description **read-only** using the existing `react-markdown` path (the `createMarkdownComponents` factory — already renders mention pills, proxied images, inline task lists). This is the robust hot path; opening a drawer never mounts ProseMirror.
- **Double-click** the description (when `editable`) swaps to the Milkdown editable view in place, focused.
- On **blur**, flush save and revert to the read-only view.
- This honors the spec's "clicking the description edits it inline; no Edit button / source toggle / Save button / modal."
- Cached/offline (`editable === false`) descriptions stay read-only with no edit affordance.

### Autosave + save-state indicator

- Reuse the existing `DescriptionAutosave` queue (debounced 750 ms, single-in-flight coalescing, failure latch, dirty-draft reconciliation) driven by Milkdown's `plugin/listener` markdown updates.
- The drawer breadcrumb header shows a **save-state icon**: idle/hidden, "saving", "saved" (brief check), "failed".
- A **toast fires only on failure** (`silent` mutation path stays — no duplicate toast).
- Saved Markdown is `null` when empty (boundary normalization unchanged).

### Markdown I/O

- Load via Milkdown `defaultValueCtx` / set markdown; serialize via `serializerCtx` (remark). Never persist HTML or ProseMirror JSON.
- Configure remark stringify to match Linear conventions where reasonable (e.g. `-` bullets) — but correctness/idempotency takes priority over cosmetic bullet choice.
- Configure node attrs surfaced by the headless probe so the doc is schema-valid: `image.title` default (`""`/nullable), list `spread`.

### Issue-mention pills (Image #6)

- A remark/Milkdown plugin detects links to `/issue/<ID>` (Linear issue URLs) and renders them as a **mention node**: status icon (from the cached issue via `resolveMention`) + identifier + title, highlighted pill.
- Clicking a pill opens the issue **in-app only** (the in-app drawer), never the webview. This fixes the current "opens both web *and* Astryn" bug: the present Tiptap `<a>` both intercepts the click *and* lets WKWebView follow the href; a non-anchor pill node has no native navigation.
- Uncached mentions render as a plain (still in-app-routed) pill/link.
- Non-issue links open in the system browser via the safe-url path; the webview never navigates.

### Images

- Custom image node renders through the existing Rust proxy (`loadLinearImage` / `classifyImageSource` / `LinearMarkdownImage`). The proxied `data:` URL lives only in the DOM; `node.attrs.src` and serialized Markdown keep the original URL.

### Menus

- Selection **tooltip** (bubble) for inline formatting (bold/italic/strike/code/link) via `plugin/tooltip`.
- **Slash** menu for block formats (headings, lists, task list, quote, code block, divider, table) via `plugin/slash`.
- Keyboard navigable, Escape-dismissable, accessible labels.

### Safety net

- Keep the `EditorErrorBoundary` + read-only `react-markdown` fallback around the editable view, so any unexpected editor error degrades to a viewable read-only render instead of crashing the drawer.

## Security / invariants (unchanged)

All external calls in Rust; no token to the webview; sanitized command errors; strict CSP (images via proxied `data:` URLs only); descriptions are Markdown at every persistence boundary; optimistic update + rollback + invalidation on save; `silent` suppresses only the duplicate toast; Asia/Dhaka for date logic.

## Testing & acceptance

- **Headless round-trip** (jsdom): the corrupting-construct corpus (image brackets/parens, 4-backtick fence, table pipes, link+code, strike+code, images, task lists) plus representative real-shaped descriptions parse to schema-valid docs and serialize idempotently with no corruption.
- **Pure helpers**: mention-detection + the slash-command filter unit-tested without a DOM.
- **Component**: read-only renders rich text + pills; double-click enters edit; read-only mode has no edit affordance. (Avoid jsdom assertions that depend on ProseMirror selection geometry.)
- **Autosave**: existing fake-timer queue tests retained.
- Existing Rust / Vitest / tsc / clippy / fmt / build gates stay green.
- **Manual `tauri dev`**: double-click edit, typing-pause autosave + breadcrumb indicator + failure toast, mention pills open in-app only (both modes), proxied images render (both modes), the previously-crashing issues (PRO-93 etc.) open and edit.

## Out of scope

Image upload from Astryn (Linear-only mentions/embeds), collaborative editing, and any non-Markdown-representable Linear rich features.
