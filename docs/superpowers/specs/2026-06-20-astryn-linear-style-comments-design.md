# Astryn Linear-Style Comments

## Goal

Turn the issue drawer's **read-only comment timeline into a functional, Linear-style comment system**, reusing the Milkdown editor for composing. Deliver, in one milestone:

- **Post top-level comments** from a composer pinned to the bottom of the drawer's main column.
- **Edit / delete** your own comments (the `…` menu and the `(edited)` indicator).
- **Single-level threaded replies** — an inline reply composer under each top-level comment.
- **Emoji reactions** — a fixed quick-set of 8 emoji, rendered as toggle pills with counts.
- **`@user` autocomplete** in the composer — a teammate typeahead backed by the cached user list.

Markdown stays canonical at every boundary (composer → command → Linear → render), exactly as for descriptions. Comments remain **live-only** (no SQLite tables); all writes flow through the established lock-guarded logic-fn → Tauri command → TanStack hook pattern with optimistic updates and rollback.

## Scope

In scope: the five capabilities above. Out of scope (YAGNI for this milestone): comment **attachments / file upload** (the 📎 affordance in Linear is omitted), nested replies beyond one level, a full searchable emoji picker, comment subscriptions/notifications, and persisting comments to SQLite.

## Architecture overview

```
Milkdown composer ──┐
                    ├─ markdown ─→ create/update_comment command ─→ Linear GraphQL
reaction palette ───┘                add/remove_reaction command ─→ Linear GraphQL
                                                │
detail fetch (comments + reactions) ←───────────┘  (optimistic setQueryData on ["issue", id], rollback on error)
                    │
        buildCommentThreads / aggregateReactions (pure helpers)
                    │
        CommentThread → CommentCard → ReactionBar  (render via existing read-only Milkdown/markdown path)
```

The React webview never calls Linear directly; the Rust core holds the token, runs the GraphQL mutations, and returns sanitized results. After each mutation the returned entity is reconciled into the `["issue", id]` query cache so the timeline stays consistent without a full resync.

## Section 1 — Data model & Rust backend

Comments are not cached in SQLite; they ride on the live detail fetch. Keep that — **no new tables, no migration**.

### Extended detail fetch

Extend the existing `comments(first: 50)` selection in `linear/issues.rs` to pull:

- `parent { id }` — reconstruct single-level threads client-side.
- `editedAt` — drives the `(edited)` indicator.
- `user { id name }` — add `id` (currently only `name`) to author-gate edit/delete and resolve avatars.
- `reactions { id emoji user { id name } }` — render pills, counts, and your-own-reaction toggle state.

### New parse types (`linear/issues.rs`)

- `DetailReaction { id, emoji, user_id, user_name }` (serializes camelCase).
- Extend `DetailComment` with: `user_id: Option<String>`, `parent_id: Option<String>`, `edited_at: Option<String>`, `reactions: Vec<DetailReaction>`. Keep existing `id`, `body`, `user_name` (now `userName`), `created_at`.

### Five mutations

Each gets a `*_logic` async fn (lock-guarded where it mutates shared state, mirroring `update_issue_logic`), a thin `#[tauri::command]` wrapper registered in `lib.rs`, a GraphQL builder + a parse fn with a unit test, and **sanitized errors** (no raw GraphQL/reqwest text). GraphQL `errors` on HTTP 200 and `success: false` are both treated as failures.

- `create_comment(issue_id, body, parent_id: Option<String>)` → returns the created `DetailComment`.
- `update_comment(id, body)` → returns the updated `DetailComment`.
- `delete_comment(id)` → unit success.
- `add_reaction(comment_id, emoji)` → returns the created `DetailReaction`.
- `remove_reaction(id)` → unit success.

### Live schema verification

Per the project's "Live API wins" rule, introspect the live Linear schema before finalizing field/input names (`CommentCreateInput`/`CommentUpdateInput`, the comment→reactions relation, `ReactionCreateInput`, the `editedAt` field name). The shapes above are the design intent; exact names are confirmed against the running schema during implementation.

## Section 2 — Frontend: editor reuse & components

### Composer (`CommentComposer`)

A thin Milkdown sibling to `DescriptionEditor` — it reuses the same plugin stack (`descriptionPlugins`, link handling, `EditorErrorBoundary`, the remark round-trip config) but with **composer semantics**, not edit-in-place:

- Starts empty and editable; never enters read-only display mode.
- **Cmd/Ctrl+Enter or the send button submits.** On success the editor clears; on failure the draft is retained for retry.
- A `variant` prop (`"pinned"` | `"reply"` | `"edit"`) toggles placeholder text and sizing.
- Auto-grows to a max height, then scrolls internally.

### `@user` mention plugin

A second Milkdown mention plugin beside the existing issue-mention one. Typing `@` opens a teammate typeahead filtered **locally** from the cached `useUsers()` list (no network per keystroke) and inserts a mention node. Posted bodies render `@`-mentions as styled pills through the existing mention render path.

### Component tree (`src/features/drawer/comments/`)

- `CommentComposer` — the Milkdown composer (pinned, reply, and edit usages).
- `CommentThread` — one top-level comment + its replies + a "Reply" affordance that expands an inline `CommentComposer`.
- `CommentCard` — avatar, name, relative time, `(edited)`, the rendered body, `ReactionBar`, and hover/focus-revealed actions (react button + `…` menu → Edit/Delete, author-gated). Edit swaps the body for an inline `CommentComposer` seeded with the current markdown.
- `ReactionBar` — reaction pills (toggle on click) + the quick 8-emoji palette on the react button.

### Activity timeline split

`buildActivity` keeps emitting lightweight history lines, but comments are routed through `CommentThread` instead of inline `<article>` cards. The composer is **not** a timeline item — it is the pinned footer (Section 3). History events and comment threads remain interleaved by time in the scroll region.

## Section 3 — Layout: the pinned composer

The main column is currently both the scroll container and the content (`IssueDrawer.tsx`). Split it into a flex column:

```
<div className="flex min-w-0 flex-1 flex-col">                        ← main column (no overflow)
  <div className="drawer-scrollbar flex-1 overflow-y-auto px-7 py-6"> ← scroll region (all existing content + threads)
  <div className="shrink-0 border-t border-border px-7 py-3">         ← pinned composer footer
```

The footer renders only when `editable` (live source); on cache/offline it is hidden, consistent with the existing "Editing is disabled" banner. The right-hand properties rail is unchanged.

## Section 4 — Data flow, optimistic updates & edge states

Comments live inside the `["issue", id]` query's `LiveDetail`. Every mutation does an **optimistic `setQueryData` on that key with snapshot rollback**, via new hooks in `queries.ts`:

- **Post / reply** — insert a pending comment (temp id, attributed to `useMe()`), shown dimmed; on success swap in the server comment, on error roll back and keep the draft in the composer.
- **Edit** — swap the body optimistically; rollback on failure.
- **Delete** — confirm in the `…` menu, remove optimistically, surface an **undo toast** (goey-toast).
- **React / unreact** — toggle the pill instantly; rollback on failure.

**Author gating:** the `…` menu (Edit/Delete) and edit affordance appear only when `comment.userId === me.id` (from `useMe()`).

### Pure helpers (no React, unit-testable)

- `buildCommentThreads(comments)` — group by `parentId` into single-level threads; replies whose parent fell outside the first 50 degrade to top-level; sort threads and replies by `createdAt`.
- `aggregateReactions(reactions)` — collapse to `{ emoji, count, reactedByMe, names }` for the pills and a hover tooltip of who reacted.

### Edge / empty / loading / error states

- **Sending:** send button disabled + spinner; the optimistic comment renders dimmed until confirmed.
- **Error:** rollback + sanitized goey-toast (e.g. "Couldn't post comment"); the draft is retained.
- **Reactions:** counts use tabular-num; failure reverts the pill + toast.
- **Offline / cache:** composer hidden; existing comments render read-only.
- **Accessibility:** hover-revealed actions are **also revealed on focus-within** and keyboard-reachable, with visible focus rings; transitions stay 150–300ms; toasts use goey-toast (non-focus-stealing).

## Section 5 — Testing

- **Rust:** a parse test per mutation (`create/update/delete_comment`, `add/remove_reaction`) + an extended `parse_issue_detail` assertion covering `parentId`, `editedAt`, nested `reactions`, and `user.id`.
- **Vitest:** `buildCommentThreads` (nesting, orphan fallback, ordering), `aggregateReactions` (counts + `reactedByMe`), `CommentComposer` (Cmd+Enter submits, clears on success, retains draft on error), the `@user` mention filter, and author-gated edit/delete visibility — reusing the existing Milkdown test mock.

## Out-of-scope / future hooks

- Comment **attachments** (file upload) — omit the 📎 button now; the composer footer leaves room to add it later.
- **Notifications / subscriptions** ("Unsubscribe" in the Linear screenshot) — not built.
- Deeper reply nesting and a searchable emoji picker — deliberately deferred.
