# GitHub Pull Request Page Revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the four-card pull-request dashboard with a three-queue siderail, cached favorite-repository views, accessible PR actions, and a live read-only PR detail drawer.

**Architecture:** Reuse `github_prs` and `github_sync_meta` with normalized `repo:<owner>/<name>` scopes and persist favorite names in the existing SQLite settings table. Fetch bounded full PR detail only when a row opens, through a new Rust GraphQL parser/command; keep the cached `GithubPr` as the drawer seed and session-cache live detail with TanStack Query.

**Tech Stack:** Tauri 2, Rust, reqwest/serde/sqlx, React 19, TypeScript, TanStack Query, Tailwind CSS v4, React Testing Library/Vitest, `react-markdown`, `remark-gfm`, Lucide, `goey-toast`.

## Global Constraints

- All GitHub requests and credentials stay in Rust; TypeScript receives only sanitized typed results.
- Preserve unrelated `.quickdev.toml` and `.codex/` working-tree changes.
- Do not add a dependency, migration, Tauri capability, CSP origin, or token scope.
- Use `github_favorite_repos` in SQLite settings and `repo:<lowercase-owner>/<lowercase-repository>` cache scopes.
- Favorite search uses `repo:owner/name is:pr is:open sort:updated-desc`, page size 100, cap 300, transactional replacement, stale-cache preservation, and the GitHub generation guard.
- PR detail is read-only and bounded to 100 comments, 100 reviews, 50 commits, 100 files, and 100 checks; patch hunks and GitHub mutations stay out of scope.
- The PR page exposes My PRs, Assigned to Me, Needs My Review, and favorite repositories; Involved / mentioned is not rendered.
- Group by repository defaults to true and persists at `astryn:prs:group-by-repo:v1`.
- The drawer width persists at `astryn:prs:drawer-width:v1`, defaults to 70 vw, and clamps to 680–1180 px and 96 vw.
- Use existing theme tokens, Geist/system typography, indigo accent, Lucide icons, visible focus, reduced-motion handling, and `goey-toast`.
- Every production behavior follows a witnessed failing test, minimal passing implementation, and green refactor.

---

### Task 1: Favorite repository model and persistence

**Files:**
- Create: `src-tauri/src/github/repositories.rs`
- Modify: `src-tauri/src/github/mod.rs`
- Modify: `src-tauri/src/db/github.rs`
- Test: inline `#[cfg(test)]` modules in both Rust files

**Interfaces:**
- Produces: `parse_repository(input: &str) -> Result<RepositoryName, GitHubError>`
- Produces: `RepositoryName { canonical: String, owner: String, name: String, scope: String }`
- Produces: `load_favorite_repos(pool) -> Result<Vec<String>, sqlx::Error>`
- Produces: `set_favorite_repo(pool, repo, favorite) -> Result<Vec<String>, sqlx::Error>`
- Produces: `delete_repo_scope(pool, scope) -> Result<(), sqlx::Error>`
- Consumes: existing `db::save_setting`, `db::load_setting`, `github_prs`, and `github_sync_meta`

- [ ] **Step 1: Write failing parser and settings tests**

```rust
#[test]
fn repository_name_is_trimmed_and_scope_is_lowercase() {
    let repo = parse_repository("  Owner/Repo.Name  ").unwrap();
    assert_eq!(repo.canonical, "Owner/Repo.Name");
    assert_eq!(repo.owner, "Owner");
    assert_eq!(repo.name, "Repo.Name");
    assert_eq!(repo.scope, "repo:owner/repo.name");
}

#[test]
fn repository_name_rejects_extra_segments_and_query_syntax() {
    for bad in ["owner", "owner/repo/extra", "owner/repo sort:created", "/repo"] {
        assert!(parse_repository(bad).is_err(), "{bad}");
    }
}

#[tokio::test]
async fn favorite_repo_round_trip_dedupes_case_insensitively() {
    let (_d, pool) = pool().await;
    set_favorite_repo(&pool, "Owner/Repo", true).await.unwrap();
    set_favorite_repo(&pool, "owner/repo", true).await.unwrap();
    assert_eq!(load_favorite_repos(&pool).await.unwrap(), vec!["Owner/Repo"]);
}

#[tokio::test]
async fn removing_favorite_deletes_only_its_dynamic_scope() {
    // Seed repo:owner/repo and mine rows/meta, remove the favorite, then assert
    // the repo scope is absent and the mine row/meta remains.
}
```

- [ ] **Step 2: Run the focused Rust tests and verify RED**

Run: `cargo test --manifest-path src-tauri/Cargo.toml github::repositories db::github`

Expected: compilation fails because the repository module and favorite functions do not exist.

- [ ] **Step 3: Implement strict repository parsing and favorite settings**

```rust
pub const GITHUB_FAVORITE_REPOS_KEY: &str = "github_favorite_repos";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepositoryName {
    pub canonical: String,
    pub owner: String,
    pub name: String,
    pub scope: String,
}

pub fn parse_repository(input: &str) -> Result<RepositoryName, GitHubError> {
    let canonical = input.trim();
    let (owner, name) = canonical.split_once('/').ok_or(GitHubError::Malformed)?;
    let valid = |part: &str| {
        !part.is_empty()
            && part.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b'.'))
    };
    if !valid(owner) || !valid(name) || name.contains('/') {
        return Err(GitHubError::Malformed);
    }
    Ok(RepositoryName {
        canonical: canonical.to_string(),
        owner: owner.to_string(),
        name: name.to_string(),
        scope: format!("repo:{}", canonical.to_ascii_lowercase()),
    })
}
```

Persist `Vec<String>` JSON, recover malformed JSON as an empty favorite list, preserve first canonical casing, sort case-insensitively for stable UI, and delete only the removed repository’s rows/meta in one transaction.

- [ ] **Step 4: Extend GitHub account wiping**

Add `GITHUB_FAVORITE_REPOS_KEY` to `wipe_github_cache` so token set/clear removes private repository names along with GitHub rows/meta/login/contributions.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `cargo test --manifest-path src-tauri/Cargo.toml github::repositories db::github`

Expected: all repository parser, settings, selective deletion, and credential-wipe tests pass.

- [ ] **Step 6: Commit the task**

```bash
git add src-tauri/src/github/repositories.rs src-tauri/src/github/mod.rs src-tauri/src/db/github.rs
git commit -m "feat: persist favorite GitHub repositories"
```

### Task 2: Favorite repository sync and IPC

**Files:**
- Modify: `src-tauri/src/github/prs.rs`
- Modify: `src-tauri/src/commands/github.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/lib/commands.ts`
- Test: inline Rust tests in `src-tauri/src/github/prs.rs` and `src-tauri/src/commands/github.rs`
- Test: `src/lib/githubQueries.test.tsx`

**Interfaces:**
- Produces: `build_repository_search(repo: &RepositoryName) -> String`
- Produces: `set_github_repo_favorite(repo: String, favorite: bool) -> Result<Vec<String>, CmdError>`
- Changes: `PrDashboard { prs, meta, favorite_repos }`
- Changes: `BucketSyncResult.bucket` remains a string and may be a `repo:` scope
- Produces TypeScript: `PrScope = PrBucket | \`repo:${string}\``
- Produces TypeScript: `setGithubRepoFavorite(repo, favorite) -> Promise<string[]>`

- [ ] **Step 1: Write failing repository-query and sync tests**

```rust
#[test]
fn favorite_query_is_open_and_recent() {
    let repo = parse_repository("Owner/Repo").unwrap();
    assert_eq!(
        build_repository_search(&repo),
        "repo:Owner/Repo is:pr is:open sort:updated-desc"
    );
}

#[tokio::test]
async fn sync_fetches_favorite_scope_and_returns_it_in_dashboard() {
    // Save Owner/Repo as a favorite, run sync with a fake page, then assert a
    // repo:owner/repo row/meta/result and favorite_repos == ["Owner/Repo"].
}

#[tokio::test]
async fn favorite_scope_failure_preserves_previous_cache() {
    // Seed repo scope, make the fake fetch fail only for the repo query, and
    // assert the old row survives with an ok=false result for that scope.
}
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `cargo test --manifest-path src-tauri/Cargo.toml commands::github github::prs`

Expected: new query builder/dashboard fields/favorite scope behavior are missing.

- [ ] **Step 3: Generalize page fetching from enum bucket to query/scope**

Replace the enum-only private fetch helper with:

```rust
async fn fetch_scope<F, Fut>(
    auth: &str,
    query: String,
    fetch_page: &F,
) -> Result<(Vec<ParsedPr>, bool), GitHubError>
```

Keep the existing pagination/cap/dedupe behavior. Sync core `Bucket::all()` first, then validated favorites loaded from SQLite. Before every successful scope write, compare the captured generation and abort with `WorkspaceChanged` on mismatch.

- [ ] **Step 4: Add favorite IPC logic and registration**

```rust
#[tauri::command]
pub async fn set_github_repo_favorite(
    state: State<'_, AppState>,
    repo: String,
    favorite: bool,
) -> Result<Vec<String>, CmdError>
```

Hold `github_lock`, validate via `parse_repository`, persist locally, and map database/provider failures to sanitized `CmdError`. Register the command in `src-tauri/src/lib.rs`.

- [ ] **Step 5: Extend TypeScript contracts**

```ts
export type PrBucket = "needs_review" | "mine" | "assigned" | "involved" | "merged";
export type PrScope = PrBucket | `repo:${string}`;
export type PrDashboard = {
  prs: GithubPr[];
  meta: GithubSyncMeta[];
  favoriteRepos: string[];
};
export const setGithubRepoFavorite = (repo: string, favorite: boolean): Promise<string[]> =>
  invoke("set_github_repo_favorite", { repo, favorite });
```

Change `GithubPr.bucket` and `GithubSyncMeta.bucket` to `PrScope`.

- [ ] **Step 6: Run focused Rust and frontend boundary tests and verify GREEN**

Run: `cargo test --manifest-path src-tauri/Cargo.toml commands::github github::prs`

Run: `npm test -- src/lib/githubQueries.test.tsx`

Expected: favorite scopes sync/serialize and existing core sync/query behavior remains green.

- [ ] **Step 7: Commit the task**

```bash
git add src-tauri/src/github/prs.rs src-tauri/src/commands/github.rs src-tauri/src/lib.rs src/lib/commands.ts src/lib/githubQueries.test.tsx
git commit -m "feat: sync pull requests for favorite repositories"
```

### Task 3: Live PR detail GraphQL boundary

**Files:**
- Create: `src-tauri/src/github/pr_detail.rs`
- Modify: `src-tauri/src/github/mod.rs`
- Modify: `src-tauri/src/commands/github.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/lib/commands.ts`
- Modify: `src/lib/queries.ts`
- Test: inline Rust tests in `src-tauri/src/github/pr_detail.rs` and `src-tauri/src/commands/github.rs`
- Test: `src/lib/githubQueries.test.tsx`

**Interfaces:**
- Produces Rust: `build_pr_detail_body(repo: &RepositoryName, number: i64) -> Result<Value, GitHubError>`
- Produces Rust: `parse_pr_detail(data: &Value) -> Result<PrDetail, GitHubError>`
- Produces command: `get_github_pr_detail(repo: String, number: i64) -> Result<PrDetail, CmdError>`
- Produces TypeScript: `GithubPrDetail`, `GithubPrComment`, `GithubPrReview`, `GithubPrCommit`, `GithubPrFile`, `GithubPrCheck`, `GithubPrTruncation`
- Produces hook: `useGithubPrDetail(repo: string | null, number: number | null)`

- [ ] **Step 1: Write a failing parser contract test**

```rust
#[test]
fn parses_pr_detail_and_truncation() {
    let detail = parse_pr_detail(&sample_detail_data()).unwrap();
    assert_eq!(detail.repo, "o/r");
    assert_eq!(detail.number, 42);
    assert_eq!(detail.body.as_deref(), Some("## Summary"));
    assert_eq!(detail.comments[0].body, "Looks good");
    assert_eq!(detail.reviews[0].state, "approved");
    assert_eq!(detail.commits[0].oid, "abc123");
    assert_eq!(detail.files[0].path, "src/a.ts");
    assert_eq!(detail.checks[0].conclusion.as_deref(), Some("success"));
    assert!(detail.truncated.files);
}
```

The fixture must include every queried field and both `CheckRun` and
`StatusContext` union forms. Add separate malformed/missing-PR/null-author tests.

- [ ] **Step 2: Run focused detail tests and verify RED**

Run: `cargo test --manifest-path src-tauri/Cargo.toml github::pr_detail`

Expected: compilation fails because the module/types/parser do not exist.

- [ ] **Step 3: Implement bounded query and pure parser**

Use GraphQL variables `owner`, `name`, and `number`; never interpolate request values into GraphQL source. Query:

```graphql
repository(owner:$owner,name:$name) {
  pullRequest(number:$number) {
    number title url state isDraft mergeable reviewDecision body createdAt updatedAt
    additions deletions changedFiles headRefName baseRefName
    repository { nameWithOwner }
    author { login avatarUrl }
    comments(first:100) { totalCount nodes { id body createdAt url author { login avatarUrl } } }
    reviews(first:100) { totalCount nodes { id body state submittedAt url author { login avatarUrl } } }
    commits(last:50) { totalCount nodes { commit { oid messageHeadline committedDate url author { name user { login avatarUrl } } } } }
    files(first:100) { totalCount nodes { path changeType additions deletions } }
    statusCheckRollup { contexts(first:100) { totalCount nodes { ... on CheckRun { name status conclusion detailsUrl } ... on StatusContext { context state targetUrl } } } }
  }
}
```

Normalize enum strings to lowercase, preserve nullable author/body/url fields,
derive truncation from `totalCount > nodes.len()`, and reject missing required
repository/number/title/collection structure.

- [ ] **Step 4: Add command logic, registration, bindings, and hook**

```ts
export const getGithubPrDetail = (repo: string, number: number): Promise<GithubPrDetail> =>
  invoke("get_github_pr_detail", { repo, number });

export function useGithubPrDetail(repo: string | null, number: number | null) {
  return useQuery({
    queryKey: ["github-pr-detail", repo, number],
    enabled: repo !== null && number !== null,
    queryFn: () => getGithubPrDetail(repo!, number!),
    staleTime: Infinity,
    gcTime: Infinity,
  });
}
```

The Rust wrapper obtains authorization with `spawn_blocking`, validates a
positive number/repository, calls `GitHubClient.graphql`, parses, and maps every
provider failure to existing sanitized `CmdError`.

- [ ] **Step 5: Run focused Rust/query tests and verify GREEN**

Run: `cargo test --manifest-path src-tauri/Cargo.toml github::pr_detail commands::github`

Run: `npm test -- src/lib/githubQueries.test.tsx`

Expected: parser, command, binding, query key, disabled state, and existing GitHub tests pass.

- [ ] **Step 6: Commit the task**

```bash
git add src-tauri/src/github/pr_detail.rs src-tauri/src/github/mod.rs src-tauri/src/commands/github.rs src-tauri/src/lib.rs src/lib/commands.ts src/lib/queries.ts src/lib/githubQueries.test.tsx
git commit -m "feat: fetch pull request review details"
```

### Task 4: PR scope helpers and persisted display behavior

**Files:**
- Create: `src/features/prs/prScopes.ts`
- Create: `src/features/prs/prScopes.test.ts`
- Modify: `src/features/prs/prActivity.ts`
- Modify: `src/features/prs/prActivity.test.ts`
- Modify: `src/features/prs/PrToolbar.tsx`

**Interfaces:**
- Produces: `PrimaryPrScope = "mine" | "assigned" | "needs_review"`
- Produces: `repoScope(repo: string) -> \`repo:${string}\``
- Produces: `scopePrs(prs, scope) -> GithubPr[]`
- Produces: `knownRepos(prs, favorites) -> string[]`
- Produces: `loadGroupByRepo(storage?: Storage) -> boolean`
- Produces: `saveGroupByRepo(value, storage?: Storage) -> void`
- Changes: `PrToolbar` removes the board/list layout control

- [ ] **Step 1: Write failing pure helper tests**

```ts
it("defaults repository grouping to true and honors saved false", () => {
  localStorage.clear();
  expect(loadGroupByRepo()).toBe(true);
  localStorage.setItem(PR_GROUP_KEY, "false");
  expect(loadGroupByRepo()).toBe(false);
  localStorage.setItem(PR_GROUP_KEY, "broken");
  expect(loadGroupByRepo()).toBe(true);
});

it("selects a favorite repository scope without duplicate bucket rows", () => {
  expect(scopePrs(rows, "repo:o/r").map((pr) => pr.id)).toEqual(["o/r#1", "o/r#2"]);
});

it("viewer metrics ignore repository scopes", () => {
  expect(prStats([...viewerRows, favoriteOnlyRow]).open).toBe(2);
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- src/features/prs/prScopes.test.ts src/features/prs/prActivity.test.ts`

Expected: helper imports fail and repository-scoped rows incorrectly affect metrics.

- [ ] **Step 3: Implement helpers and simplify toolbar**

Use literal parsing for `"true"`/`"false"` only, catch storage access failures,
case-normalize repository scope keys, derive known repos from canonical row
values, and filter `prStats` to non-`repo:` buckets before deduplication.
Remove `PrLayout`, `LayoutGrid`, `LayoutList`, `layout`, and `setLayout` from
`PrToolbar`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm test -- src/features/prs/prScopes.test.ts src/features/prs/prActivity.test.ts`

Expected: persisted grouping, scope selection, repo discovery, and viewer metrics pass.

- [ ] **Step 5: Commit the task**

```bash
git add src/features/prs/prScopes.ts src/features/prs/prScopes.test.ts src/features/prs/prActivity.ts src/features/prs/prActivity.test.ts src/features/prs/PrToolbar.tsx
git commit -m "refactor: model pull request page scopes"
```

### Task 5: Siderail, active list, and context menu

**Files:**
- Create: `src/features/prs/PrSidebar.tsx`
- Create: `src/features/prs/PrSidebar.test.tsx`
- Create: `src/features/prs/PrContextMenu.tsx`
- Create: `src/features/prs/PrContextMenu.test.tsx`
- Create: `src/features/prs/PrListPanel.tsx`
- Modify: `src/features/prs/PrRow.tsx`
- Modify: `src/features/prs/PrRow.test.tsx`
- Modify: `src/features/prs/PrsPage.tsx`
- Modify: `src/features/prs/PrsPage.test.tsx`

**Interfaces:**
- `PrSidebar({ prs, favorites, activeScope, onSelect, onFavoriteChange })`
- `PrListPanel({ scope, prs, meta, stale, viewerLogin, onOpenPr, onOpenMenu })`
- `PrContextMenu({ pr, favorite, x, y, onFavoriteChange, onClose })`
- `PrRow({ pr, viewerLogin, onOpen, onOpenMenu })`
- `PrsPage` owns `activeScope`, selected PR, menu position, and favorite mutation

- [ ] **Step 1: Write failing page/row behavior tests**

```tsx
it("shows three primary queues and no involved section", () => {
  renderConnectedPage();
  expect(screen.getByRole("button", { name: /my prs/i })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("button", { name: /assigned to me/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /needs my review/i })).toBeInTheDocument();
  expect(screen.queryByText(/involved/i)).toBeNull();
});

it("opens a PR drawer selection from row click and Enter", () => {
  const onOpen = vi.fn();
  render(<PrRow pr={base} onOpen={onOpen} onOpenMenu={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /add widget/i }));
  fireEvent.keyDown(screen.getByRole("button", { name: /add widget/i }), { key: "Enter" });
  expect(onOpen).toHaveBeenCalledTimes(2);
});
```

Add separate tests for primary switching, favorite selection/counts, picker
exclusion/search, group persistence, Linear-chip propagation, stale/truncated
scope status, and favorite removal fallback.

- [ ] **Step 2: Run page/row tests and verify RED**

Run: `npm test -- src/features/prs/PrsPage.test.tsx src/features/prs/PrRow.test.tsx src/features/prs/PrSidebar.test.tsx`

Expected: siderail/list components are missing and existing four-section assertions fail.

- [ ] **Step 3: Implement siderail and active list**

Build semantic nav buttons with counts and `aria-current`, a compact responsive
rail, a controlled favorite picker from `knownRepos`, and one grouped/un-grouped
active list. Preserve cached/connect/refresh/activity behavior. Use
`useMutation` for `setGithubRepoFavorite`, invalidate `["github-prs"]`, refetch
`["github-sync"]`, and show sanitized toasts.

- [ ] **Step 4: Write failing context-menu tests**

```tsx
it("copies the link and title and can open the PR", async () => {
  renderMenu(base);
  fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
  await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("https://x"));
  fireEvent.click(screen.getByRole("button", { name: "Open PR" }));
  expect(openUrl).toHaveBeenCalledWith("https://x");
});

it("opens the same menu from Shift+F10", () => {
  renderRow();
  fireEvent.keyDown(screen.getByRole("button", { name: /add widget/i }), {
    key: "F10",
    shiftKey: true,
  });
  expect(openMenu).toHaveBeenCalled();
});
```

- [ ] **Step 5: Run menu tests and verify RED**

Run: `npm test -- src/features/prs/PrContextMenu.test.tsx src/features/prs/PrRow.test.tsx`

Expected: menu module/keyboard handlers/actions are absent.

- [ ] **Step 6: Implement the shared accessible menu**

Reuse the existing WKWebView clipboard fallback, opener plugin, `goey-toast`,
viewport clamping, Escape/outside/resize closure, and cursor/focus styling.
Render the ellipsis button on row hover/focus; wire right-click, ContextMenu key,
and Shift+F10 to the same callback.

- [ ] **Step 7: Run all PR list/menu tests and verify GREEN**

Run: `npm test -- src/features/prs/PrsPage.test.tsx src/features/prs/PrRow.test.tsx src/features/prs/PrSidebar.test.tsx src/features/prs/PrContextMenu.test.tsx`

Expected: navigation, favorites, row selection, context actions, and legacy row badges pass.

- [ ] **Step 8: Commit the task**

```bash
git add src/features/prs/PrSidebar.tsx src/features/prs/PrSidebar.test.tsx src/features/prs/PrContextMenu.tsx src/features/prs/PrContextMenu.test.tsx src/features/prs/PrListPanel.tsx src/features/prs/PrRow.tsx src/features/prs/PrRow.test.tsx src/features/prs/PrsPage.tsx src/features/prs/PrsPage.test.tsx
git commit -m "feat: add pull request siderail and row actions"
```

### Task 6: Read-only PR detail drawer

**Files:**
- Create: `src/features/prs/PrDrawer.tsx`
- Create: `src/features/prs/PrDrawer.test.tsx`
- Create: `src/features/prs/PrDrawerOverview.tsx`
- Create: `src/features/prs/PrDrawerOverview.test.tsx`
- Create: `src/features/prs/PrDrawerChanges.tsx`
- Create: `src/features/prs/PrDrawerChanges.test.tsx`
- Create: `src/features/prs/prDetailDisplay.ts`
- Create: `src/features/prs/prDetailDisplay.test.ts`
- Modify: `src/features/prs/PrsPage.tsx`

**Interfaces:**
- `PrDrawer({ pr, favorite, onFavoriteChange, onClose, returnFocus })`
- `PrDrawerOverview({ seed, detail })`
- `PrDrawerChanges({ seed, detail })`
- `detailTimeline(detail) -> Array<CommentEvent | ReviewEvent | CommitEvent>`
- `loadDrawerWidth(storage?, viewportWidth?) -> number`

- [ ] **Step 1: Write failing pure timeline/width tests**

```ts
it("merges comments reviews and commits chronologically", () => {
  expect(detailTimeline(detail).map((event) => event.kind)).toEqual([
    "commit", "review", "comment",
  ]);
});

it("defaults and clamps drawer width", () => {
  localStorage.clear();
  expect(loadDrawerWidth(localStorage, 1440)).toBe(1008);
  localStorage.setItem(PR_DRAWER_WIDTH_KEY, "2000");
  expect(loadDrawerWidth(localStorage, 1440)).toBe(1180);
});
```

- [ ] **Step 2: Run pure tests and verify RED**

Run: `npm test -- src/features/prs/prDetailDisplay.test.ts`

Expected: helper module is missing.

- [ ] **Step 3: Implement timeline, width, labels, and safe external-link helpers**

Use stable timestamp sorting with explicit event kinds; clamp against
`min(1180, viewport*0.96)` and `min(680, viewport*0.96)` so small windows never
overflow.

- [ ] **Step 4: Write failing drawer component tests**

```tsx
it("renders cached metadata while live detail is loading", () => {
  detailHook.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch });
  render(<PrDrawer pr={base} favorite={false} onFavoriteChange={vi.fn()} onClose={vi.fn()} />);
  expect(screen.getByText("Add widget")).toBeInTheDocument();
  expect(screen.getByRole("status", { name: /loading pull request details/i })).toBeInTheDocument();
});

it("keeps cached content and offers retry after a detail error", () => {
  detailHook.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch });
  renderDrawer();
  expect(screen.getByRole("alert")).toHaveTextContent(/couldn't load live details/i);
  fireEvent.click(screen.getByRole("button", { name: /retry/i }));
  expect(refetch).toHaveBeenCalled();
});
```

Add separate tests for Overview/Changes tabs, Markdown without raw HTML,
timeline decisions, checks/reviewers, file rows/truncation, Escape/backdrop
close, pointer resizing persistence, and focus restoration.

- [ ] **Step 5: Run drawer tests and verify RED**

Run: `npm test -- src/features/prs/PrDrawer.test.tsx src/features/prs/PrDrawerOverview.test.tsx src/features/prs/PrDrawerChanges.test.tsx`

Expected: drawer/overview/changes modules are missing.

- [ ] **Step 6: Implement the drawer shell**

Use a fixed `role="dialog"` shell with a backdrop, sticky header, Close initial
focus, saved width/resizer, `motion-reduce:transition-none`, Overview/Changes
tabs, Copy/Open/Favorite actions, query fallback, Escape handling, and focus
return. Do not trap focus outside nested menus, and do not close on opener
failure.

- [ ] **Step 7: Implement overview and changes**

Render GFM with existing `react-markdown` and `remark-gfm`, custom external link
opening, no raw HTML plugin, chronological events, a 300 px metadata rail,
checks/reviewers/status/Linear issue, calm empty/truncated states, and changed
file rows using the existing diff visual language.

- [ ] **Step 8: Wire the drawer into `PrsPage` and run all drawer/list tests**

Run: `npm test -- src/features/prs`

Expected: all PR tests pass with row selection opening the live/cached drawer.

- [ ] **Step 9: Commit the task**

```bash
git add src/features/prs/PrDrawer.tsx src/features/prs/PrDrawer.test.tsx src/features/prs/PrDrawerOverview.tsx src/features/prs/PrDrawerOverview.test.tsx src/features/prs/PrDrawerChanges.tsx src/features/prs/PrDrawerChanges.test.tsx src/features/prs/prDetailDisplay.ts src/features/prs/prDetailDisplay.test.ts src/features/prs/PrsPage.tsx
git commit -m "feat: add pull request detail drawer"
```

### Task 7: Product authority, integration, and full verification

**Files:**
- Modify: `requirements.md`
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/plans/2026-07-26-github-pr-page-revamp.md`
- Review: every scoped file changed by Tasks 1–6

**Interfaces:**
- Consumes: all completed feature behavior
- Produces: product authority matching the implementation and checked build/test evidence

- [ ] **Step 1: Update product authority**

Revise the F7 status, scope, bucket presentation, sync/cache description,
feature spec, and acceptance criteria to three visible queues, favorite repo
scopes, default grouping, row context actions, and the read-only detail drawer.
Keep the hidden Involved backend compatibility path, heatmap/metrics, 300 cap,
credential rules, and offline cache accurate. Update stale `CLAUDE.md` PR status
and remove “no PR detail view” claims.

- [ ] **Step 2: Mark the plan checkboxes from execution evidence**

Change only completed `- [ ]` items to `- [x]`. Leave an item unchecked if its
command did not run or did not pass.

- [ ] **Step 3: Run formatting and focused verification**

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
npm test -- src/features/prs src/lib/githubQueries.test.tsx
cargo test --manifest-path src-tauri/Cargo.toml github
```

Expected: exit 0 with no failing focused tests.

- [ ] **Step 4: Run full frontend verification**

```bash
npm test
npx tsc --noEmit
npm run build
```

Expected: all Vitest files pass, TypeScript exits 0, and Vite production build exits 0.

- [ ] **Step 5: Run full Rust verification**

```bash
cargo test --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
```

Expected: all Rust tests pass and formatting check exits 0.

- [ ] **Step 6: Inspect the scoped diff**

```bash
git diff --check
git status --short --branch
git diff --stat
git diff
```

Expected: no whitespace errors; only the PR revamp, its tests/docs, the already
committed design/plan, and the user’s untouched pre-existing `.quickdev.toml`
and `.codex/` changes appear.

- [ ] **Step 7: Manually exercise Tauri when the environment permits**

Run: `npm run tauri dev`

Verify primary navigation, favorite add/remove/sync, context menu pointer and
keyboard paths, cached/live drawer, Overview/Changes, external opener, Escape,
resize, reduced motion, and stale/error states. If credentials, display, or
desktop runtime prevent this, report the path as untested instead of claiming
manual success.

- [ ] **Step 8: Commit documentation and any final verified integration fixes**

```bash
git add requirements.md CLAUDE.md docs/superpowers/plans/2026-07-26-github-pr-page-revamp.md
git commit -m "docs: update pull request feature requirements"
```
