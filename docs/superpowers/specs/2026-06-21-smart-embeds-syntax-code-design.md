# Smart Embeds and Syntax-Highlighted Code Blocks

**Date:** 2026-06-21
**Status:** Approved design, pending implementation plan
**Milestone:** Issue-description editor enhancement (Milkdown)
**Branch context:** to be created off `main`

## Goal

Add compact, toggleable URL previews and syntax-highlighted fenced code blocks to Astryn's Milkdown issue-description editor without changing Markdown as the canonical persistence format or weakening the Tauri webview's security boundary.

## Scope

This increment includes:

- Generic metadata preview cards for HTTP(S) URLs.
- Automatic previews only for bare URLs that occupy an entire paragraph.
- A selection-toolbar action that converts between a preview and a normal Markdown link.
- Compact preview cards in the read-only/display view. **(Updated during implementation: previews are display-only — while editing, a standalone URL stays plain editable text. This avoids re-rendering/re-fetching the embed on every keystroke as a URL is typed; the inline editable single-row embed originally proposed below is intentionally not built.)**
- Syntax highlighting for fenced code blocks.
- An edit-mode language selector driven by the Markdown fence language.
- A Copy action that copies only the code body.
- The existing read-only Mermaid diagram behavior.

Provider-specific interactive embeds, iframes, automatic language detection from code content, persistent preview metadata, and custom embed Markdown syntax are out of scope.

## Canonical Markdown Representation

Astryn continues to persist only standard Markdown.

- A bare HTTP(S) URL that is the sole content of a paragraph is the preview form.
- A standard Markdown link is the inline-link form, even when it is the sole content of a paragraph. For example, `[github.com](https://github.com/)` remains a link rather than becoming a preview.
- Inline URLs and links inside prose never become previews automatically.
- Converting a preview to a link rewrites the bare URL to standard Markdown-link form.
- Converting a link to a preview is available only when the link is the paragraph's sole content; it rewrites that paragraph to the bare URL.

This distinction persists the user's display choice while remaining interoperable with Linear and other Markdown consumers.

## Architecture

### Preview rendering

Add a focused Milkdown/ProseMirror view for standalone bare-URL paragraphs. It owns presentation only and does not store fetched metadata in the document.

**Detection / schema mechanism.** A bare URL in commonmark is plain text inside an ordinary `paragraph` node — there is no node type for a `$view` to attach to, unlike every existing node view (registered via `$view` in `descriptionPlugins`). The preview is therefore driven by a **paragraph node view with a predicate**, not a new schema node:

- A predicate `isStandaloneUrlParagraph(node)` returns true only when the paragraph's sole content is a single text node whose entire trimmed value is one valid HTTP(S) URL and which carries **no `link` mark** (a Markdown link keeps its mark and stays a link).
- The paragraph node view is registered **only on the read-only display editor**. It renders the preview card when the predicate holds (and `!view.editable`); otherwise it falls back to default paragraph rendering. The editable editor keeps ProseMirror's stock paragraphs (no override), so editing/typing is unaffected.
- Persistence is unchanged: the node remains a normal paragraph containing bare-URL text, so the existing commonmark serializer emits the bare URL verbatim. No custom parser/serializer is added. A round-trip test must confirm the bare URL is not auto-linked or escaped on serialize.
- The read-only Milkdown view (non-editable mode) is the primary display renderer; the react-markdown path (`markdownComponents.tsx`) is only the `EditorErrorBoundary` fallback and is out of scope — in that degraded crash state the URL renders as a plain link, which is acceptable.

- The read-only/display view renders a compact card capped at 96 px high.
- While editing, a standalone URL is shown as plain editable text (no embed) — see the Scope note above; the card appears once the description is displayed read-only.
- Card activation (read-only) uses Astryn's existing external-link handler; the webview never navigates directly.
- A loading card appears immediately while metadata is requested.
- A failed or offline request falls back to a compact clickable row showing the original URL.

Preview loading changes presentation only and must not emit a Milkdown Markdown update or trigger description autosave.

### Link/preview toggle

Extend the existing Milkdown selection toolbar with one context-sensitive action:

- `Display as link` when a preview is selected.
- `Display as preview` when a normal link is the sole content of its paragraph.

The conversion is a normal editor transaction, updates the Markdown representation described above, participates in undo/redo, and flows through the existing autosave queue.

### Metadata command

Add a Tauri command named `fetch_link_preview`. It returns a sanitized structure containing:

- requested URL and resolved canonical URL;
- title;
- description;
- site name or host;
- optional favicon or preview image as a bounded data URL.

Results are held in a bounded in-memory cache with a time-to-live. This is a net-new pattern — the app has no in-memory cache today (SQLite is the cache; `AppState` holds only atomics and a mutex). The cache lives as a new `AppState` field (e.g. an `Arc<Mutex<…>>` LRU keyed by normalized URL) with both a max-entry bound and a per-entry TTL; entries past TTL or over the bound are evicted. Preview metadata is deliberately **not** persisted in SQLite or added to issue descriptions. Concurrent requests for the same normalized URL share one in-flight fetch (in-flight de-duplication).

The command follows the established thin-wrapper pattern in `src-tauri/src/commands/mod.rs`: a `#[tauri::command]` over a separately-testable async `_logic` fn, returning a serializable struct or sanitized `CmdError`. The closest precedent is `load_linear_image` — a thin command that performs an outbound Rust fetch and returns a bounded data URL to the webview.

### Code-block rendering

Expand the existing code-block node view (`src/features/drawer/milkdownCodeBlock.tsx`) into a React-rendered component for non-Mermaid fenced blocks.

- Read the language from the existing code-block `language` attribute.
- **Highlight in read-only mode only.** In read-only mode (`!view.editable`) the block renders highlighted, non-editable React output. In edit mode the block keeps the current plain `<pre><code>` with `<code>` as the editable `contentDOM` and is **not** live-highlighted. Rationale: injecting highlight spans inside an editable ProseMirror `contentDOM` fights ProseMirror's ownership of that subtree and is a known-hard problem; live edit-mode highlighting (decorations or a CodeMirror-in-ProseMirror block) is out of scope for this increment. The header (language label, controls) is shown in both modes; only the code body's highlighting differs.
- Highlight using **`lowlight`** (highlight.js grammars, returns a hast token tree) with an explicit language-alias map. Rendering the token tree to React elements honors the "from tokens, never untrusted HTML" rule and integrates with the existing hast/react-markdown stack. Do not use any highlighter that returns an HTML string.
- Do not infer a language from code content.
- Missing or unsupported languages render safely as plain (escaped) text.
- Read-only blocks show a compact header with the language label and Copy action.
- Edit-mode blocks show the same restrained header with a language selector.
- Selecting a language updates the code-block node attribute, changes the serialized Markdown fence language, and triggers normal autosave.
- Copy writes only the block's source text to the clipboard.
- Highlighted output is generated from tokens or escaped text; raw code is never injected as untrusted HTML.

A `mermaid` fence keeps the current behavior: diagram in read-only mode (the existing `MermaidDiagram` branch gated on `!view.editable`) and editable source in edit mode. The code-block changes must not regress Mermaid rendering or Markdown round-tripping.

### Components and units

Frontend (`src/features/drawer/`):
- `milkdownEditor.ts` — extend `descriptionPlugins` to register the new paragraph node view; central plugin wiring.
- New paragraph node view (preview) — predicate-driven presentation for standalone bare-URL paragraphs; calls `fetch_link_preview`; presentation-only, never emits a transaction or triggers autosave.
- `milkdownCodeBlock.tsx` — expand the existing code-block node view with the read-only `lowlight` highlighter, header, language selector, and Copy.
- `milkdownMenus.ts` — extend the selection tooltip (`TooltipView` / `inlineCommands`, which already has the Link action) with the context-sensitive `Display as link` / `Display as preview` toggle.
- `descriptionAutosave.ts` — unchanged; the toggle and language-selector transactions flow through the existing 750 ms queue.
- A small language-alias map module shared by the code-block view and any read-only render.
- Out of scope: `markdownComponents.tsx` (react-markdown), which is only the `EditorErrorBoundary` fallback.

Backend (`src-tauri/src/`):
- `commands/mod.rs` — new `fetch_link_preview` command (thin wrapper + async `_logic` fn) plus the in-memory TTL/LRU cache field on `AppState`; register in `lib.rs` `generate_handler!`.
- A new metadata-fetch module (or addition under `linear/`-style structure) holding the SSRF-hardened fetcher: address validation, pinned-IP connect, manual redirect loop, size/timeout/content-type limits, and sanitized metadata extraction.

Dependencies: add `lowlight` (frontend). No CSP change — preview images reach the webview only as bounded data URLs.

## Data Flow

### Paste and preview

1. The user pastes an HTTP(S) URL.
2. Paste must insert the URL as bare text (no automatic `link` mark); preview vs. link is then decided entirely by the canonical sole-content-of-paragraph rule and the node-view predicate — there is no separate "paste creates a preview" code path. Pasting into prose yields ordinary inline text/link behavior.
3. When the paragraph's sole content is that bare URL, the preview node view requests metadata through `fetch_link_preview`.
4. Rust validates and fetches the page, extracts sanitized metadata, optionally fetches a bounded image, and returns the preview structure.
5. React renders the compact card or URL fallback. The document remains unchanged.

### Toggle

1. The user selects a preview or an eligible standalone Markdown link.
2. The selection toolbar exposes the appropriate display action.
3. The command rewrites only that paragraph between the two standard Markdown representations.
4. Milkdown emits the updated Markdown and the existing 750 ms autosave queue persists it.

### Code language

1. The editor reads the fenced block's language attribute.
2. The renderer resolves the language or alias to a supported grammar and highlights the code, falling back to plain text.
3. In edit mode, choosing another language updates the node attribute through a ProseMirror transaction.
4. Milkdown serializes the updated fence and normal autosave persists it.

## Security and Network Rules

The preview command is an untrusted-URL fetcher and must enforce all of the following:

- Accept only `http` and `https` URLs.
- Reject credentials in URLs.
- Resolve hosts before connecting and block loopback, private, link-local, multicast, unspecified, and other non-public IP ranges for both IPv4 and IPv6.
- **Defend against DNS rebinding (TOCTOU).** A plain check-then-connect is insufficient because reqwest re-resolves DNS at connect time. Pin the validated address: connect to the resolved-and-checked IP (custom connector / resolver, or connect to the IP with an explicit `Host`) so the bytes go to the address that passed the range check, not a re-resolved one.
- **Disable automatic redirect following** (`redirect::Policy::none()`, as the existing `assets` client already does) and follow redirects manually, re-running the full scheme/credential/address validation on each hop, under a small redirect limit.
- Use short connect and total-request timeouts.
- Limit response bytes before parsing; reject non-HTML page responses for metadata extraction.
- Limit metadata field lengths and image bytes.
- Never execute scripts or return page HTML to the frontend.
- Fetch optional images through the same scheme, redirect, address, timeout, and size checks.
- Return sanitized errors without internal network details.

The existing CSP remains strict: no arbitrary `connect-src`, remote `img-src`, or `frame-src` expansion is needed. Preview images reach the webview only as bounded data URLs.

## Failure Handling

- Loading uses a stable card skeleton so content does not jump substantially.
- Network, parsing, unsupported-content, blocked-address, and offline failures all render the compact original-URL fallback.
- Preview failures do not show global toasts and do not prevent description editing or saving.
- A remount retries a failed preview; successful cache entries avoid repeated requests within their TTL.
- Clipboard failure leaves the block unchanged and shows a local, non-blocking `Copy failed` state.
- Highlighting failure for one block falls back to escaped plain text and does not crash the editor.

## Visual Treatment

Use the approved compact treatment:

- Preview cards use the existing dark editor surfaces, subtle border, small radius, restrained thumbnail, and no prominent shadow.
- Code blocks use a compact header, existing monospace typography, horizontal overflow, and theme-aligned token colors.
- Controls appear consistently without increasing the block height beyond what their function requires.
- Focus, selected, hover, loading, and failure states remain visible with keyboard-accessible contrast.

## Testing and Verification

### Frontend tests

- Bare standalone URL detection versus standard Markdown links and inline URLs.
- Standalone paste in an empty paragraph versus paste inside prose.
- Preview loading, success, URL fallback, cache reuse, and read-only activation.
- Selection-toolbar eligibility and both conversion directions.
- Conversion participates in undo/redo and emits canonical Markdown.
- A standalone bare URL round-trips through serialize without gaining a `link` mark or escaping.
- Supported language highlighting (read-only) and unsupported-language plain-text fallback.
- Edit-mode code blocks remain plain editable text (no highlight spans in the `contentDOM`).
- Language selector updates the fence attribute and serialized Markdown.
- Copy copies only source text and handles clipboard failure locally.
- Mermaid remains a read-only diagram and editable source in edit mode.
- Existing Markdown round-trip and editor autosave tests remain green.

### Rust tests

- Open Graph, standard metadata, missing metadata, malformed HTML, and canonical-URL extraction.
- Scheme and credential rejection.
- IPv4 and IPv6 restricted-address rejection, including redirect targets re-validated on each manual hop.
- Pinned-IP connect: the connection targets the validated resolved address (rebinding defense), not a re-resolved host.
- Redirect, timeout, response-size, image-size, and content-type limits.
- Sanitized error mapping and successful cache behavior.

### Required verification

- `npm test`
- `npm run build`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`

Manual verification in `npm run tauri dev` covers paste, toggle, keyboard navigation, link opening, offline fallback, language changes, copying, and Mermaid rendering in both drawer and full-page issue views.
