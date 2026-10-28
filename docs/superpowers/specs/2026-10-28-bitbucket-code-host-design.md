# Bitbucket Code Host (Module Spec 2a)

**Status:** Approved by waiver (owner asked for autonomous delivery), 2026-10-28.
**Requirement:** `requirements.md` §3 *Module architecture* (spec 2 row: provider-agnostic
code-host surfaces + a second provider); `PRODUCT.md` Principle 2.
**Builds on:** `2026-10-27-module-system-design.md`, `2026-06-22-github-pr-dashboard-design.md`,
`2026-07-26-github-pr-page-revamp-design.md`, `2026-07-26-github-pr-linear-drawer-diff-design.md`.

## 1. Summary

Bitbucket Cloud becomes a second `code-host` provider module next to GitHub. The PR
workspace (scopes, rows, filters, grouping, row actions, read-only Overview/Diff drawer)
is made provider-neutral: one set of components renders whichever code host it is
given. GitHub keeps its exact behavior, cache, commands, and query keys.

## 2. Goals and non-goals

**Goals**

- `bitbucket` module (provider, provides `code-host`) with its own keychain accounts,
  credential-provider seam, Rust client, tables, commands, Settings section, and view.
- Bitbucket PR workspace at parity with the GitHub one where the API allows: My PRs,
  Needs My Review, favorite-repository scopes, the repository picker, the cached-first
  drawer with live Overview (description, comments, approvals, commits, files, build
  statuses) and lazy in-app Diff.
- Provider-neutral PR components; GitHub-only bits (contribution heatmap, Assigned queue)
  become per-provider configuration.

**Non-goals**

- Bitbucket as a docs source (see §7 Ruling).
- Bitbucket on the Dashboard or in Reports facts (other lanes own those surfaces; both
  read only GitHub today and keep doing so).
- Writes (approve, comment, merge), Bitbucket Data Center/Server, OAuth.
- Live verification against a real Bitbucket account (no credentials in this build).

## 3. API surface (Bitbucket Cloud REST 2.0, `https://api.bitbucket.org/2.0`)

Taken from Atlassian's published OpenAPI document (`https://api.bitbucket.org/swagger.json`).

| Need | Endpoint |
|---|---|
| Viewer | `GET /user` → `uuid`, `account_id`, `nickname`, `display_name`, `links.avatar.href` |
| Workspaces | `GET /user/workspaces?pagelen=100` → `values[].workspace.slug` |
| My PRs | `GET /workspaces/{ws}/pullrequests/{account_id}?state=OPEN` (per workspace; the global `/pullrequests/{user}` endpoint is gone) |
| Favorite repo | `GET /repositories/{ws}/{slug}/pullrequests?state=OPEN` |
| Repo picker | `GET /repositories/{ws}?role=member&fields=next,values.full_name` (per workspace) |
| Detail | `GET …/pullrequests/{id}`, `/comments`, `/commits`, `/diffstat`, `/statuses` |
| Diff | `GET …/pullrequests/{id}/diff` (redirects to a unified `git diff` text body) |

List calls add `fields=+values.participants,+values.reviewers` (URL-encoded) because
list items omit participants by default. Pagination follows the response's `next` URL,
accepted only when it starts with `https://api.bitbucket.org/2.0/` so a crafted
response can never redirect the credential elsewhere. `pagelen` is 50 for pull
requests and 100 elsewhere.

**Auth.** Atlassian API token sent as HTTP Basic `email:token` (also accepts a legacy
`username:app-password`, which uses the same scheme). Required token scopes:
`read:user:bitbucket`, `read:workspace:bitbucket`, `read:repository:bitbucket`,
`read:pullrequest:bitbucket`.

**Errors.** 401/403 → auth (sanitized "token rejected — check its scopes"), 429 →
rate limited, 5xx → server, other non-2xx → API error, unparsable/missing structure →
malformed. Never an empty success that could erase a cached scope.

## 4. Rust design

- `code_host.rs` (new, provider-neutral): `ParsedPr`, `Reviewer`, `PrDetail*`,
  `PrDiff`, `PrDiffFile`, `RepositoryCatalog`, `RepositoryName` + `parse_repo_name`.
  The `github::*` modules re-export them, so every existing GitHub import still works.
- `db/code_host.rs` (new): `PrRow`, `SyncMeta`, and the scope cache functions
  (`replace_scope`, `list_rows`, `load_meta`, favorites) parameterized by a
  `PrTables { prs, meta, favorites_key }`. `db/github.rs` delegates with the GitHub
  tables; behavior and SQL are unchanged.
- `bitbucket/` (new): `BitbucketError`, `BitbucketCredentialProvider` +
  `ApiTokenProvider` (keychain accounts `bitbucket_email`, `bitbucket_token`),
  `BitbucketClient` (`get_json`, `get_text` with an 8 MiB cap, next-URL validation),
  `BitbucketState` (credentials, client, lock, generation — one `AppState` field),
  parsers in `prs.rs`, `pr_detail.rs`, `pr_diff.rs`, `repositories.rs`.
- `commands/bitbucket.rs`: `set_bitbucket_credentials`, `clear_bitbucket_credentials`,
  `get_bitbucket_status` (core-exempt, like the other status commands),
  `test_bitbucket_connection`, `sync_bitbucket_prs`, `list_bitbucket_prs`,
  `set_bitbucket_repo_favorite`, `list_bitbucket_repositories`,
  `get_bitbucket_pr_detail`, `get_bitbucket_pr_diff`. Each owned command calls
  `state.require(ModuleId::Bitbucket)?` first. Payload shapes equal the GitHub ones.
- Migration `0030_bitbucket_prs.sql`: `bitbucket_prs` and `bitbucket_sync_meta`,
  column-for-column the same as the GitHub tables.
- Module manifest: `bitbucket` provider providing `code-host`. Remove-data wipes the
  two tables, the `bitbucket_login` and `bitbucket_favorite_repos` settings, and both
  keychain accounts. Disabling bumps the Bitbucket generation.

### Sync (`sync_bitbucket_prs`)

1. Read credentials (`spawn_blocking`), snapshot the generation.
2. `GET /user` (caches `bitbucket_login`); the account id drives the queries.
3. `mine`: every workspace's authored open PRs, merged, deduped, capped at 300.
4. Each favorite `repo:<ws/slug>` scope: all open PRs (cap 300).
5. `needs_review`: open PRs from favorite repositories where the viewer is a
   `REVIEWER` participant who has neither approved nor requested changes and is not the
   author. Written only if every favorite scope succeeded, so a failed repository never
   silently drops rows from it.
6. Generation re-checked before every write; each scope commits in one transaction.

Row mapping: `id = "ws/slug#id"`, `repo = "ws/slug"`; reviewers from participants
(+ pending reviewers); review decision = `changes_requested` if any reviewer requested
changes, else `approved` if any approval, else `review_required` if reviewers exist,
else null. Lists carry no build or merge status, so `ci_status = "none"`,
`mergeable = "unknown"`, sizes null; the drawer fills them live.

## 5. Frontend design

- `features/prs/codeHost.ts`: `CodeHostApi` (name, settings section, primary scopes,
  copy, `hasContributions`, and the provider's hooks) + `CodeHostContext`. The default
  context value is GitHub, so existing call sites are unchanged.
  `githubHost.ts` / `bitbucketHost.ts` bind the hooks.
- `PrsPage` takes `host` (default GitHub) and provides the context; `PrSidebar`,
  `PrDrawer`, `PrDrawerOverview`, `PrDrawerChanges` read provider hooks and the
  provider name from it. GitHub-only pieces (heatmap, Assigned queue) are config.
- New view `bitbucket-prs` ("Bitbucket PRs", owned by `bitbucket`) in `VIEW_META`,
  `ViewKind`, and `SplitLayout`; Settings → Connections → Bitbucket with email + token
  form (direct async save, inputs cleared immediately), Test, Clear.
- Queries in `lib/queries.ts` mirror GitHub's (`bitbucket-*` keys), gated by
  `useOwnerActive("bitbucket")`; `clearBitbucketQueries` on credential changes.

## 6. Testing

- Rust: fixture-based parser tests (PR page, participants → reviewers/decision,
  needs-review derivation, detail assembly, unified-diff splitting incl. binary,
  rename, add/delete, truncation), next-URL validation, status mapping, auth header,
  sync logic (scopes, failure keeps cache, needs-review withheld on favorite failure,
  generation abort), credential set/clear wipe, remove-module-data, guard coverage.
- Frontend: Bitbucket host renders its scopes and connect prompt, no heatmap; drawer
  reads hooks from the context; GitHub tests unchanged in behavior.

## 7. Rulings

- Separate `bitbucket-prs` view instead of one merged PR inbox: keeps GitHub's view,
  label, and cache untouched and matches the module rule (each module owns its screen).
- Bitbucket provides only `code-host`, not `docs-source`: the docs-source code is
  GitHub-specific (GitHub tree + GraphQL blobs, `owner/repo@branch` ids, GitHub
  credentials) and the local-folder docs lane is reshaping `docs_sources` concurrently;
  declaring `docs-source` without a working sync would make Docs "available" but broken.
- Needs My Review is derived from favorite repositories: Bitbucket Cloud has no
  cross-repository "review requested" endpoint.
- No Assigned queue (Bitbucket PRs have no assignees) and no contribution heatmap.
- Credential = Atlassian account email + API token (Basic auth), both in the keychain;
  legacy app passwords work with the username in the email field.
- Pre-module installs that auto-enable everything on upgrade do not get Bitbucket
  turned on; it was never configured there.
- Avatars are not shown for Bitbucket (initials fallback, one seam in
  `bitbucket::account_avatar`): they come from several Atlassian/Gravatar hosts the CSP
  does not allow, and widening CSP or proxying them is left until live verification.
  No CSP or capability change in this work.
- Reports stay GitHub-only: their PR facts read `github_prs`, so they are gated on the
  GitHub module being active (not on any `code-host` provider). Otherwise a disabled
  GitHub's kept cache would leak into reports once Bitbucket supplies `code-host`.
- Live verification against a Bitbucket account is pending (no credentials available).
