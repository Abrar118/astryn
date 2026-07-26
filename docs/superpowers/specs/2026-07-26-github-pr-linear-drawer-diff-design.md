# GitHub PR Linear Drawer and Full Diff Design

**Date:** 2026-07-26
**Status:** Approved
**Branch:** `feat/pr-page-revamp`
**Reference images:**

- `/home/bengalbyte/Pictures/Screenshots/Screenshot From 2026-07-26 22-26-43.png`
- `/home/bengalbyte/Pictures/Screenshots/Screenshot From 2026-07-26 22-25-30.png`

## Goal

Revise the pull-request detail drawer so its information architecture and
visual hierarchy match Linear's pull-request review surface, keep all drawer
content clear of Astryn's floating dock, and render actual GitHub file patches
inside the Diff tab.

## Decisions

- The drawer remains read-only. Review submission, comments, merge actions,
  marking files reviewed, and inline review threads stay on GitHub.
- Overview details and diff patches use separate Tauri commands and TanStack
  Query keys. Opening a pull request must not download the potentially large
  diff response.
- Diff patches load only after the user selects the Diff tab.
- Rust owns the GitHub REST request. The webview never calls GitHub directly and
  never receives credentials.
- File patches come from GitHub's paginated
  `GET /repos/{owner}/{repo}/pulls/{pull_number}/files` endpoint with
  `per_page=100`. Fetch up to GitHub's documented 3,000-file maximum.
- A missing `patch` field is not a malformed response. Binary files and patches
  omitted by GitHub render a calm "Diff unavailable" state with an external
  GitHub action.
- The response is session-cached by TanStack Query and is not persisted to
  SQLite.

## Drawer Structure

### Shared shell

The drawer keeps the existing modal behavior, resizable width, focus
containment, cached-first opening, and external actions. Its visible structure
changes to two compact horizontal bars:

1. A 44px breadcrumb/action bar containing the PR state icon, repository and
   number, branch glyph, truncated title, aggregate additions/deletions,
   favorite action, overflow action, copy/open actions, and close action.
2. A 44px tab bar with quiet rounded pills for `Overview` and `Diff`.

The title no longer occupies a large stacked drawer header. This mirrors the
reference, preserves more vertical space, and makes both tabs share identical
chrome.

The drawer's scrolling content receives at least `pb-24`. The floating dock is
positioned 16px from the viewport bottom and is approximately 56px tall; 96px
of content padding ensures the last interactive/content row can scroll fully
above it.

### Overview

Overview is a flat two-column layout rather than a collection of cards.

- Main column:
  - large PR title;
  - author identity, repository/PR number, and base/head branch context;
  - a quiet `Description` disclosure label;
  - safe GitHub-flavored Markdown rendered directly on the background;
  - chronological activity following the description.
- Metadata rail:
  - Status;
  - Related Linear issue when present;
  - Reviewers, merged from cached review requests and live review authors;
  - Checks;
  - changed-file count and a compact file list.

The rail uses headings, whitespace, and hairline separators only. It does not
use an enclosing card. At narrow drawer widths it stacks beneath the main
column without horizontal overflow.

### Diff

The Diff tab starts with a compact secondary toolbar matching the reference:

- `Files {count}` as the active view;
- `Commits {count}` as a disabled/read-only count in this iteration;
- aggregate additions/deletions;
- an `Open on GitHub` fallback action.

Changed files render as stacked bordered panels:

- header: file icon, full path, additions/deletions, and external action;
- body: unified diff hunks in a monospace table;
- left gutters: old and new line numbers;
- context rows: neutral background;
- additions: green gutter, text, and low-contrast green background;
- deletions: red gutter, text, and low-contrast red background;
- hunk header: muted blue/neutral separator showing the `@@` range;
- `\ No newline at end of file`: muted metadata row.

The renderer parses unified hunk headers and assigns line numbers locally. It
does not attempt syntax highlighting, side-by-side layout, word-level diffing,
or editable review annotations.

## Diff Data Contract

Add a dedicated response:

```text
GithubPrDiff {
  repo: string
  number: number
  files: GithubPrDiffFile[]
  totalFiles: number
  truncated: boolean
}

GithubPrDiffFile {
  path: string
  previousPath: string | null
  changeType: string
  additions: number
  deletions: number
  changes: number
  patch: string | null
  blobUrl: string | null
}
```

`truncated` is true when GitHub's 3,000-file ceiling is reached or pagination
indicates that additional results cannot be represented. Repository inputs and
PR numbers use the existing strict validation. The command captures the GitHub
credential generation before fetching and rejects results if the account
changes before completion.

## Loading and Failure States

- Overview opening remains cached-first and loads live GraphQL detail in the
  background.
- Diff initially shows a compact loading row while its dedicated query runs.
- A diff fetch failure leaves Overview intact and shows a retry action plus an
  `Open on GitHub` fallback.
- An empty diff response shows "No changed files."
- Missing patches show file metadata and "GitHub did not provide a text patch
  for this file."
- Truncation is announced beneath the file panels with an external GitHub
  action.

## Accessibility and Interaction

- The shared drawer remains an `aria-modal` dialog with focus containment,
  Escape close, focus restoration, and background inertness.
- Tabs use `role="tablist"`, `role="tab"`, `aria-selected`, and associated
  tabpanels.
- File paths and code lines remain selectable text.
- Icon-only controls have accessible names and visible keyboard focus.
- Diff state is never communicated only by red/green color: every row preserves
  its `+`, `-`, context, or hunk marker.
- The diff uses semantic table rows and hidden column labels for old/new line
  numbers and code content.

## Testing

- Rust parser tests cover normal files, renamed files, missing patches, malformed
  required fields, pagination, the 3,000-file cap, generation changes, and
  sanitized command errors.
- TypeScript helper tests cover unified hunk parsing and old/new line-number
  advancement.
- Component tests cover the Linear header/tab structure, flat Overview rail,
  dock-safe padding, lazy diff query enablement, patch rows, unavailable patch
  placeholders, retry, and external fallbacks.
- Run the focused Vitest and Rust tests first, then all frontend tests,
  `npx tsc --noEmit`, `npm run build`, all Rust tests, Rust formatting,
  `git diff --check`, and a scoped diff review.

## Out of Scope

- Inline review comments or threads.
- Marking files reviewed.
- Syntax or word-level highlighting.
- Side-by-side diffs.
- Persisting patches in SQLite.
- Fetching raw repository blobs to reconstruct patches GitHub omitted.
