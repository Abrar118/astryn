# Smart Embeds and Syntax-Highlighted Code Blocks

## Goal

Add compact, toggleable URL previews and syntax-highlighted fenced code blocks to Astryn's Milkdown issue-description editor without changing Markdown as the canonical persistence format or weakening the Tauri webview's security boundary.

## Scope

This increment includes:

- Generic metadata preview cards for HTTP(S) URLs.
- Automatic previews only for bare URLs that occupy an entire paragraph.
- A selection-toolbar action that converts between a preview and a normal Markdown link.
- Compact read-only cards and single-row edit-mode embeds.
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

- Read-only mode renders a compact card capped at 96 px high.
- Edit mode renders a single-row preview with favicon or site marker, title, and domain so embeds do not make caret movement or document spacing awkward.
- No additional blank paragraph or margin block is inserted before or after the embed.
- The edit-mode row behaves as one selectable block. Enter or double-click exposes the original URL for editing.
- Read-only activation uses Astryn's existing external-link handler; the webview never navigates directly.
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

Results are held in a bounded in-memory cache with a time-to-live. Preview metadata is not added to issue descriptions or persisted in SQLite. Concurrent requests for the same normalized URL share one in-flight fetch.

### Code-block rendering

Expand the existing code-block node view into a React-rendered component for non-Mermaid fenced blocks.

- Read the language from the existing code-block `language` attribute.
- Highlight using a maintained client-side grammar library with an explicit language-alias map.
- Do not infer a language from code content.
- Missing or unsupported languages render safely as plain text.
- Read-only blocks show a compact header with the language label and Copy action.
- Edit-mode blocks show the same restrained header with a language selector.
- Selecting a language updates the code-block node attribute, changes the serialized Markdown fence language, and triggers normal autosave.
- Copy writes only the block's source text to the clipboard.
- Highlighted output is generated from tokens or escaped text; raw code is never injected as untrusted HTML.

A `mermaid` fence keeps the current behavior: diagram in read-only mode and editable source in edit mode. The code-block changes must not regress Mermaid rendering or Markdown round-tripping.

## Data Flow

### Paste and preview

1. The user pastes an HTTP(S) URL.
2. If the selection is in an empty paragraph and the URL is the only pasted content, Milkdown creates the bare standalone-URL form. Otherwise, paste follows normal inline-link behavior.
3. The preview view requests metadata through `fetch_link_preview`.
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
- Revalidate the destination after every redirect and enforce a small redirect limit.
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
- Preview loading, success, URL fallback, cache reuse, read-only activation, and edit-mode collapsed rendering.
- Selection-toolbar eligibility and both conversion directions.
- Conversion participates in undo/redo and emits canonical Markdown.
- Supported language highlighting and unsupported-language plain-text fallback.
- Language selector updates the fence attribute and serialized Markdown.
- Copy copies only source text and handles clipboard failure locally.
- Mermaid remains a read-only diagram and editable source in edit mode.
- Existing Markdown round-trip and editor autosave tests remain green.

### Rust tests

- Open Graph, standard metadata, missing metadata, malformed HTML, and canonical-URL extraction.
- Scheme and credential rejection.
- IPv4 and IPv6 restricted-address rejection, including redirect targets.
- Redirect, timeout, response-size, image-size, and content-type limits.
- Sanitized error mapping and successful cache behavior.

### Required verification

- `npm test`
- `npm run build`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`

Manual verification in `npm run tauri dev` covers paste, toggle, keyboard navigation, link opening, offline fallback, language changes, copying, and Mermaid rendering in both drawer and full-page issue views.
