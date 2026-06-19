# Astryn Linear-Style Description Editor

## Goal

Replace the drawer’s textarea/preview description UI with a single inline rich-text editor that follows Linear’s documented interaction model. Descriptions remain Markdown at every persistent boundary: Linear GraphQL, Rust commands, SQLite, and TanStack Query.

## Editor Behavior

- Clicking the description edits it inline; there is no Edit button, source toggle, Save button, or modal.
- Markdown typed or pasted into the editor is converted to rich text.
- Text selection opens a compact formatting toolbar. Typing `/` opens a keyboard-navigable formatting menu.
- Supported Markdown-representable formatting includes headings, bold, italic, strike, inline code, links, blockquotes, bullet and ordered lists, task lists, fenced code blocks, horizontal rules, and GFM tables.
- Cached/offline drawer results remain rendered and read-only. Live results enable editing.
- **Link clicks are intercepted (no webview navigation).** Configure the link extension with `openOnClick: false` and intercept clicks on link marks in both editable and read-only modes. A Linear issue link (matched by identifier against the cached issues) opens that issue in the in-app drawer; every other link is validated with `safeExternalUrl` and opened in the system browser via the opener plugin; unsafe links are blocked. This preserves the previously shipped behavior — clicking an embedded Linear task must not load Linear inside the webview. The drawer owns this resolution and passes it to the editor as `onOpenLink`.

Astryn cannot safely reproduce Linear-only rich-document features that are absent from the GraphQL Markdown `description`, including entity mentions, uploads, embeds, collapsible sections, Mermaid nodes, and anchored comments. Unsupported syntax must not be silently introduced.

## Architecture

Create a focused `DescriptionEditor` component under `src/features/drawer/`. It uses `@tiptap/react`, `@tiptap/starter-kit`, the official `@tiptap/markdown` bridge configured for GFM, and only the extensions needed by the supported feature list.

**Dependencies are all MIT / free and open source.** Use only Tiptap's open-source packages (`@tiptap/*` on the public npm registry, all MIT) plus `marked` (MIT) and the MIT test libraries. Do **not** add any `@tiptap-pro/*` package, Tiptap Cloud / collaboration service, hosted AI, or any dependency that requires a license key, account, or private registry.

**Pin the Tiptap family to one exact version.** `@tiptap/markdown` peer-depends on an *exact* `@tiptap/core` / `@tiptap/pm` version (e.g. `3.27.1`, not a range). Installing the family with `^3` can resolve `core`/`pm` to a newer minor than `markdown` allows, producing a peer conflict and — worse — a duplicate `@tiptap/pm` (ProseMirror) instance that breaks the schema at runtime. Install every `@tiptap/*` package at the **same exact version** and upgrade them in lockstep.

The component accepts the canonical Markdown string, editability, an async `onSave(markdown)` callback, and an `onOpenLink(href)` callback. It owns Tiptap lifecycle, selection/slash menus, save status, and draft synchronization. `IssueDrawer` continues to own issue mutations (passing `patch({ description })` through an awaitable mutation path) and link resolution.

## Markdown and Autosave Data Flow

1. Load `description` using `contentType: "markdown"`.
2. Serialize edits with `editor.getMarkdown()`; never persist HTML or Tiptap JSON.
3. Seed the autosave baseline (`acknowledged`) from the editor's *serialized* form of the loaded content — `markdownFromEditor(editor)`, not the raw server string — so a normalization-only difference (e.g. `*`→`-` bullets, emphasis style) never triggers a spurious first save.
4. Debounce saves after 750 ms of inactivity and flush on blur.
5. Permit one save in flight. If edits occur during that request, retain only the newest Markdown and send it after the first request settles.
6. Ignore externally refreshed content while a local draft is dirty. Adopt server content after the latest draft is acknowledged.
7. Normalize empty editor output to `null` at the command boundary.

Markdown serialization must be **idempotent**: `serialize(parse(serialize(parse(x))))` equals `serialize(parse(x))`. Round-trip tests assert this stability (not just substring presence), so the external-content reconciliation does not churn the editor after each save.

A failed save shows the editor's own inline status; do not also raise the generic mutation toast on the description save path (suppress one source of feedback to avoid duplicate error reporting).

The existing optimistic query update and rollback remain active. A failed save keeps the local draft visible, shows a sanitized toast/status, and retries after the next edit; it never replaces the draft with stale query data.

## Menus and Accessibility

The selection toolbar exposes common inline formatting and link editing. The slash menu covers block formats, lists, tasks, code blocks, rules, and tables. Both menus support arrow-key navigation, Enter selection, Escape dismissal, visible focus, and descriptive button labels. Editor shortcuts follow Linear’s documented conventions where the underlying Markdown representation supports them.

## Security

No editor content is written to localStorage. Links are not fetched or embedded by the webview. Pasted HTML is constrained by the configured Tiptap schema, and persisted output is serialized Markdown. Existing Rust-only Linear access and sanitized command errors remain unchanged.

## Testing and Acceptance

- Unit tests cover representative Markdown parse/serialize round trips (including GFM tables and task lists) and assert serialization idempotency.
- Fake-timer tests cover debounce, blur flush, in-flight coalescing, failure retention, retry, and external-update conflict handling.
- The slash-menu query parsing and command filtering are extracted as pure functions and unit-tested (input string → matching commands / selected index). This is where the menu's logic is verified.
- Full ProseMirror interaction in jsdom (BubbleMenu appearing on selection, typing `/` to drive the menu, keyboard formatting) is unreliable — jsdom has no layout and `view.coordsAtPos` returns no geometry. Do **not** gate the milestone on jsdom component tests that depend on rendered selection geometry; cover those flows in the `tauri dev` manual checklist instead. A lightweight render test (markdown renders as rich text; read-only sets `contenteditable="false"`) is fine.
- Existing TypeScript, Vitest, Vite, Rust test, formatting, and Clippy gates remain green.
- Manual verification confirms inline editing, shortcuts, Markdown paste, autosave/reload persistence, failure recovery, and read-only cached mode in the Tauri webview.
