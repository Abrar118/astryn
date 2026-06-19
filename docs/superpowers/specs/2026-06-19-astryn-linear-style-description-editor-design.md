# Astryn Linear-Style Description Editor

## Goal

Replace the drawer’s textarea/preview description UI with a single inline rich-text editor that follows Linear’s documented interaction model. Descriptions remain Markdown at every persistent boundary: Linear GraphQL, Rust commands, SQLite, and TanStack Query.

## Editor Behavior

- Clicking the description edits it inline; there is no Edit button, source toggle, Save button, or modal.
- Markdown typed or pasted into the editor is converted to rich text.
- Text selection opens a compact formatting toolbar. Typing `/` opens a keyboard-navigable formatting menu.
- Supported Markdown-representable formatting includes headings, bold, italic, strike, inline code, links, blockquotes, bullet and ordered lists, task lists, fenced code blocks, horizontal rules, and GFM tables.
- Cached/offline drawer results remain rendered and read-only. Live results enable editing.
- The existing validated external-link opener remains responsible for rendered links.

Astryn cannot safely reproduce Linear-only rich-document features that are absent from the GraphQL Markdown `description`, including entity mentions, uploads, embeds, collapsible sections, Mermaid nodes, and anchored comments. Unsupported syntax must not be silently introduced.

## Architecture

Create a focused `DescriptionEditor` component under `src/features/drawer/`. It uses `@tiptap/react`, `@tiptap/starter-kit`, the official `@tiptap/markdown` bridge configured for GFM, and only the extensions needed by the supported feature list.

The component accepts the canonical Markdown string, editability, and an async `onSave(markdown)` callback. It owns Tiptap lifecycle, selection/slash menus, save status, and draft synchronization. `IssueDrawer` continues to own issue mutations and passes `patch({ description })` through an awaitable mutation path.

## Markdown and Autosave Data Flow

1. Load `description` using `contentType: "markdown"`.
2. Serialize edits with `editor.getMarkdown()`; never persist HTML or Tiptap JSON.
3. Debounce saves after 750 ms of inactivity and flush on blur.
4. Permit one save in flight. If edits occur during that request, retain only the newest Markdown and send it after the first request settles.
5. Ignore externally refreshed content while a local draft is dirty. Adopt server content after the latest draft is acknowledged.
6. Normalize empty editor output to `null` at the command boundary.

The existing optimistic query update and rollback remain active. A failed save keeps the local draft visible, shows a sanitized toast/status, and retries after the next edit; it never replaces the draft with stale query data.

## Menus and Accessibility

The selection toolbar exposes common inline formatting and link editing. The slash menu covers block formats, lists, tasks, code blocks, rules, and tables. Both menus support arrow-key navigation, Enter selection, Escape dismissal, visible focus, and descriptive button labels. Editor shortcuts follow Linear’s documented conventions where the underlying Markdown representation supports them.

## Security

No editor content is written to localStorage. Links are not fetched or embedded by the webview. Pasted HTML is constrained by the configured Tiptap schema, and persisted output is serialized Markdown. Existing Rust-only Linear access and sanitized command errors remain unchanged.

## Testing and Acceptance

- Unit tests cover representative Markdown parse/serialize round trips, including GFM tables and task lists.
- Fake-timer tests cover debounce, blur flush, in-flight coalescing, failure retention, retry, and external-update conflict handling.
- Component tests cover selection toolbar and slash-menu keyboard behavior.
- Existing TypeScript, Vitest, Vite, Rust test, formatting, and Clippy gates remain green.
- Manual verification confirms inline editing, shortcuts, Markdown paste, autosave/reload persistence, failure recovery, and read-only cached mode in the Tauri webview.
