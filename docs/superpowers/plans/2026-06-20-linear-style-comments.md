# Linear-Style Comments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the read-only comment timeline into a functional Linear-style comment system: post/edit/delete, single-level threaded replies, emoji reactions, and `@user` autocomplete — composed with the existing Milkdown editor in a pinned bottom composer.

**Architecture:** Comments stay live-only (no SQLite). Five new Linear mutations run in the Rust core (token never leaves Rust) behind thin Tauri commands, each returning the parsed entity. The webview composes Markdown, calls the command, and reconciles the result into the `["issue", id]` TanStack cache via pure optimistic-transform helpers with snapshot rollback. Rendering reuses the existing Milkdown/markdown read path; the `@user` typeahead mirrors the existing slash-menu plugin.

**Tech Stack:** Rust (`sqlx`/`reqwest`/`serde_json`, Tauri v2 commands), TypeScript/React, TanStack Query, Milkdown (`@milkdown/kit` + `@milkdown/react`), Vitest + jsdom + @testing-library/react.

## Global Constraints

- **All external API calls live in Rust, never the webview.** The webview never calls Linear; tokens are never returned to TS. (`requirements.md` §3)
- **Sanitized errors:** Tauri commands return `CmdError` only — never raw reqwest/GraphQL text. GraphQL `errors` on HTTP 200 and `success: false` are both failures (handled by `extract_data` + explicit `success` checks).
- **Optimistic writes with rollback**, all sync/error feedback via **`goey-toast`** (imports `gooeyToast`; do not substitute another lib). (`requirements.md` §12)
- **Live API wins:** introspect the live Linear schema before trusting field/input names (`CommentCreateInput`, `editedAt`, reaction relation, `ReactionCreateInput`).
- **Markdown is canonical** at every boundary; never persist HTML/ProseMirror JSON.
- **TS is strict** (`noUnusedLocals`/`noUnusedParameters`) — unused symbols fail the build.
- **Time/locale** for any date display stays in `Asia/Dhaka` (reuse existing `timeAgo`).
- Rust commands: use `cargo ... --manifest-path src-tauri/Cargo.toml` (never `cd src-tauri`). Keep `cargo fmt` clean.

## File Structure

**Rust (modify):**
- `src-tauri/src/linear/issues.rs` — `DetailReaction` type, extended `DetailComment`, `COMMENT_NODE_FIELDS`, comment selection in detail query, 5 mutation builders + parse fns + `LinearClient` methods.
- `src-tauri/src/commands/mod.rs` — re-export `DetailReaction`; 5 `#[tauri::command]` wrappers (authed-call pattern).
- `src-tauri/src/lib.rs` — register the 5 commands.

**TS (modify):**
- `src/lib/commands.ts` — `DetailReaction`, extended `DetailComment`, 5 invoke wrappers.
- `src/lib/queries.ts` — 5 mutation hooks.
- `src/features/drawer/IssueDrawer.tsx` — pinned composer layout; route comments through `CommentThread`.

**TS (create), all under `src/features/drawer/comments/`:**
- `commentThreads.ts` — `buildCommentThreads` (pure).
- `reactions.ts` — `REACTION_EMOJI`, `aggregateReactions` (pure).
- `commentCache.ts` — optimistic cache transforms (pure).
- `milkdownUserMention.ts` — `@user` typeahead plugin + mention link mark view + `formatUserMention`/`userMentionFromHref` (pure).
- `CommentComposer.tsx` — Milkdown composer (pinned / reply / edit variants).
- `ReactionBar.tsx` — reaction pills + quick-emoji palette.
- `CommentCard.tsx` — one comment (avatar/name/time/edited/body/actions/reactions).
- `CommentThread.tsx` — top-level comment + replies + inline reply composer.
- Tests colocated: `*.test.ts(x)` beside each.

---

### Task 1: Rust — extend comment parse types + detail fetch

**Files:**
- Modify: `src-tauri/src/linear/issues.rs` (struct `DetailComment` ~382; comment parse ~608; detail query comments line ~911)
- Test: `src-tauri/src/linear/issues.rs` (extend `parses_drawer_children_resources_and_activity_history`)

**Interfaces:**
- Produces: `DetailReaction { id, emoji, user_id: Option<String>, user_name: Option<String> }` (serde camelCase); `DetailComment` now `{ id, body, user_id: Option<String>, user_name: Option<String>, created_at, edited_at: Option<String>, parent_id: Option<String>, reactions: Vec<DetailReaction> }`; `const COMMENT_NODE_FIELDS`; `fn parse_comment_node(&Value) -> DetailComment`; `fn parse_reaction_node(&Value) -> DetailReaction`.

- [ ] **Step 1: Add the `DetailReaction` struct and extend `DetailComment`.** Replace the existing `DetailComment` struct (~382):

```rust
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetailReaction {
    pub id: String,
    pub emoji: String,
    pub user_id: Option<String>,
    pub user_name: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetailComment {
    pub id: String,
    pub body: String,
    pub user_id: Option<String>,
    pub user_name: Option<String>,
    pub created_at: String,
    pub edited_at: Option<String>,
    pub parent_id: Option<String>,
    pub reactions: Vec<DetailReaction>,
}
```

- [ ] **Step 2: Add the shared field constant + node parsers.** Place near the other `const *_FIELDS` / `fn node_to_issue` (top of the parse section, e.g. just above `parse_issue_delete` ~308):

```rust
const COMMENT_NODE_FIELDS: &str =
    "id body createdAt editedAt parent { id } user { id name } reactions { id emoji user { id name } }";

fn parse_reaction_node(r: &Value) -> DetailReaction {
    DetailReaction {
        id: s(r, "id").unwrap_or_default(),
        emoji: s(r, "emoji").unwrap_or_default(),
        user_id: nested(r, "user", "id"),
        user_name: nested(r, "user", "name"),
    }
}

fn parse_comment_node(c: &Value) -> DetailComment {
    let reactions = c
        .get("reactions")
        .and_then(Value::as_array)
        .map(|arr| arr.iter().map(parse_reaction_node).collect())
        .unwrap_or_default();
    DetailComment {
        id: s(c, "id").unwrap_or_default(),
        body: s(c, "body").unwrap_or_default(),
        user_id: nested(c, "user", "id"),
        user_name: nested(c, "user", "name"),
        created_at: s(c, "createdAt").unwrap_or_default(),
        edited_at: s(c, "editedAt"),
        parent_id: nested(c, "parent", "id"),
        reactions,
    }
}
```

- [ ] **Step 3: Use `parse_comment_node` in the detail parse.** Replace the existing comments `.map(|c| DetailComment { … })` block (~608) with:

```rust
    let comments = n
        .get("comments")
        .and_then(|c| c.get("nodes"))
        .and_then(|x| x.as_array())
        .map(|arr| arr.iter().map(parse_comment_node).collect())
        .unwrap_or_default();
```

- [ ] **Step 4: Pull the new fields in the detail query.** In `issue_detail_query()` replace the comments line (~911):

```rust
             comments(first: 50) {{ pageInfo {{ hasNextPage }} nodes {{ {COMMENT_NODE_FIELDS} }} }}
```

(The `{COMMENT_NODE_FIELDS}` is a `format!` substitution; its inner `{ }` are literal GraphQL braces, intentionally single-brace.)

- [ ] **Step 5: Extend the existing detail test fixture.** In `parses_drawer_children_resources_and_activity_history`, replace the empty comments node:

```rust
          "comments":{"pageInfo":{"hasNextPage":false},"nodes":[
            {"id":"cm1","body":"Looks good","createdAt":"2026-06-19T10:00:00Z","editedAt":"2026-06-19T10:05:00Z",
             "parent":null,"user":{"id":"u1","name":"Abrar"},
             "reactions":[{"id":"re1","emoji":"👍","user":{"id":"u2","name":"Jakob"}}]},
            {"id":"cm2","body":"Agreed","createdAt":"2026-06-19T11:00:00Z","editedAt":null,
             "parent":{"id":"cm1"},"user":{"id":"u2","name":"Jakob"},"reactions":[]}]},
```

Add assertions after the existing relation asserts:

```rust
        assert_eq!(detail.comments[0].user_id.as_deref(), Some("u1"));
        assert_eq!(detail.comments[0].edited_at.as_deref(), Some("2026-06-19T10:05:00Z"));
        assert_eq!(detail.comments[0].reactions[0].emoji, "👍");
        assert_eq!(detail.comments[0].reactions[0].user_id.as_deref(), Some("u2"));
        assert_eq!(detail.comments[1].parent_id.as_deref(), Some("cm1"));
```

- [ ] **Step 6: Run tests + fmt.**

Run: `cargo test --manifest-path src-tauri/Cargo.toml linear::issues 2>&1 | rg "test result|parses_drawer"`
Expected: `parses_drawer_children_resources_and_activity_history ... ok`, `test result: ok.`
Run: `cargo fmt --manifest-path src-tauri/Cargo.toml`

- [ ] **Step 7: Commit.**

```bash
git add src-tauri/src/linear/issues.rs
git commit -m "feat(comments): fetch reactions, parent, editedAt, user id on comments"
```

---

### Task 2: Rust — comment create/update/delete mutations

**Files:**
- Modify: `src-tauri/src/linear/issues.rs` (mutation builders near `issue_create_mutation` ~933; parse fns near `parse_issue_create` ~336; `LinearClient` methods near `create_issue` ~1010)
- Modify: `src-tauri/src/commands/mod.rs` (import ~13; command wrappers near `delete_issue` ~760)
- Modify: `src-tauri/src/lib.rs` (handler list ~49)
- Test: `src-tauri/src/linear/issues.rs` (new unit tests in `mod tests`)

**Interfaces:**
- Consumes: `parse_comment_node`, `COMMENT_NODE_FIELDS`, `DetailComment` (Task 1).
- Produces: `LinearClient::create_comment(auth, issue_id, body, parent_id: Option<&str>) -> Result<DetailComment, LinearError>`, `update_comment(auth, id, body) -> Result<DetailComment, …>`, `delete_comment(auth, id) -> Result<(), …>`; commands `create_comment`, `update_comment`, `delete_comment`.

- [ ] **Step 1: Write failing parse tests.** Add to `mod tests` in `issues.rs`:

```rust
    #[test]
    fn parses_comment_create() {
        let body = r##"{"data":{"commentCreate":{"success":true,"comment":{
          "id":"cm9","body":"Hi","createdAt":"2026-06-20T09:00:00Z","editedAt":null,
          "parent":null,"user":{"id":"u1","name":"Abrar"},"reactions":[]}}}}"##;
        let c = parse_comment_create(body).unwrap();
        assert_eq!(c.id, "cm9");
        assert_eq!(c.body, "Hi");
        assert!(parse_comment_create(r#"{"data":{"commentCreate":{"success":false}}}"#).is_err());
    }

    #[test]
    fn parses_comment_update_and_delete() {
        let upd = r##"{"data":{"commentUpdate":{"success":true,"comment":{
          "id":"cm9","body":"Edited","createdAt":"2026-06-20T09:00:00Z","editedAt":"2026-06-20T09:30:00Z",
          "parent":null,"user":{"id":"u1","name":"Abrar"},"reactions":[]}}}}"##;
        assert_eq!(parse_comment_update(upd).unwrap().body, "Edited");
        assert!(parse_comment_delete(r#"{"data":{"commentDelete":{"success":true}}}"#).is_ok());
        assert!(parse_comment_delete(r#"{"data":{"commentDelete":{"success":false}}}"#).is_err());
    }
```

- [ ] **Step 2: Run to verify failure.**

Run: `cargo test --manifest-path src-tauri/Cargo.toml parses_comment 2>&1 | rg "error\[|cannot find"`
Expected: compile errors — `parse_comment_create`/`parse_comment_update`/`parse_comment_delete` not found.

- [ ] **Step 3: Add the parse fns.** Near `parse_issue_create` (~336):

```rust
pub fn parse_comment_create(body: &str) -> Result<DetailComment, LinearError> {
    let data = extract_data(body)?;
    let created = data.get("commentCreate").ok_or(LinearError::Malformed)?;
    if created.get("success").and_then(|b| b.as_bool()) != Some(true) {
        return Err(LinearError::Api("commentCreate returned success=false".into()));
    }
    Ok(parse_comment_node(
        created.get("comment").ok_or(LinearError::Malformed)?,
    ))
}

pub fn parse_comment_update(body: &str) -> Result<DetailComment, LinearError> {
    let data = extract_data(body)?;
    let upd = data.get("commentUpdate").ok_or(LinearError::Malformed)?;
    if upd.get("success").and_then(|b| b.as_bool()) != Some(true) {
        return Err(LinearError::Api("commentUpdate returned success=false".into()));
    }
    Ok(parse_comment_node(
        upd.get("comment").ok_or(LinearError::Malformed)?,
    ))
}

pub fn parse_comment_delete(body: &str) -> Result<(), LinearError> {
    let data = extract_data(body)?;
    if data
        .get("commentDelete")
        .and_then(|d| d.get("success"))
        .and_then(|b| b.as_bool())
        == Some(true)
    {
        Ok(())
    } else {
        Err(LinearError::Api("commentDelete returned success=false".into()))
    }
}
```

- [ ] **Step 4: Add mutation builders + client methods.** Builders near `issue_create_mutation` (~933):

```rust
const COMMENT_DELETE_MUTATION: &str =
    "mutation D($id: String!) { commentDelete(id: $id) { success } }";

fn comment_create_mutation() -> String {
    format!(
        "mutation C($input: CommentCreateInput!) {{ commentCreate(input: $input) {{ success comment {{ {COMMENT_NODE_FIELDS} }} }} }}"
    )
}

fn comment_update_mutation() -> String {
    format!(
        "mutation U($id: String!, $input: CommentUpdateInput!) {{ commentUpdate(id: $id, input: $input) {{ success comment {{ {COMMENT_NODE_FIELDS} }} }} }}"
    )
}
```

Methods inside `impl LinearClient` (near `create_issue` ~1010):

```rust
    pub async fn create_comment(
        &self,
        auth: &str,
        issue_id: &str,
        body: &str,
        parent_id: Option<&str>,
    ) -> Result<DetailComment, LinearError> {
        let mut input = serde_json::json!({ "issueId": issue_id, "body": body });
        if let Some(pid) = parent_id {
            input["parentId"] = serde_json::Value::String(pid.to_string());
        }
        let req = serde_json::json!({ "query": comment_create_mutation(), "variables": { "input": input } });
        parse_comment_create(&self.post(auth, req).await?)
    }

    pub async fn update_comment(
        &self,
        auth: &str,
        id: &str,
        body: &str,
    ) -> Result<DetailComment, LinearError> {
        let req = serde_json::json!({
            "query": comment_update_mutation(),
            "variables": { "id": id, "input": { "body": body } }
        });
        parse_comment_update(&self.post(auth, req).await?)
    }

    pub async fn delete_comment(&self, auth: &str, id: &str) -> Result<(), LinearError> {
        let req = serde_json::json!({ "query": COMMENT_DELETE_MUTATION, "variables": { "id": id } });
        parse_comment_delete(&self.post(auth, req).await?)
    }
```

- [ ] **Step 5: Run parse tests (now pass).**

Run: `cargo test --manifest-path src-tauri/Cargo.toml parses_comment 2>&1 | rg "test result"`
Expected: `test result: ok.`

- [ ] **Step 6: Add Tauri command wrappers.** In `commands/mod.rs`, add `DetailReaction` to the import on line ~13 (`DetailAttachment, DetailChild, DetailComment, DetailReaction, …`). Add near `delete_issue` (~760) — these use the lighter authed-call pattern (like `list_users`) because comments never touch SQLite, so no workspace lock/generation is needed:

```rust
async fn authed(state: &State<'_, AppState>) -> Result<String, CmdError> {
    let c = state.credentials.clone();
    tokio::task::spawn_blocking(move || c.authorization())
        .await
        .map_err(|_| CmdError::Internal)?
        .map_err(|_| CmdError::SecretStore)?
        .ok_or(CmdError::NotConfigured)
}

#[tauri::command]
pub async fn create_comment(
    state: State<'_, AppState>,
    issue_id: String,
    body: String,
    parent_id: Option<String>,
) -> Result<DetailComment, CmdError> {
    let auth = authed(&state).await?;
    state
        .linear
        .create_comment(&auth, &issue_id, &body, parent_id.as_deref())
        .await
        .map_err(CmdError::from)
}

#[tauri::command]
pub async fn update_comment(
    state: State<'_, AppState>,
    id: String,
    body: String,
) -> Result<DetailComment, CmdError> {
    let auth = authed(&state).await?;
    state.linear.update_comment(&auth, &id, &body).await.map_err(CmdError::from)
}

#[tauri::command]
pub async fn delete_comment(state: State<'_, AppState>, id: String) -> Result<(), CmdError> {
    let auth = authed(&state).await?;
    state.linear.delete_comment(&auth, &id).await.map_err(CmdError::from)
}
```

> Note: if an `authed` helper with this exact signature already exists after Task 3 ordering, define it once. Place it above the first comment command and reuse it in Task 3.

- [ ] **Step 7: Register in `lib.rs`.** Add to `tauri::generate_handler![…]` (after `commands::get_me`, keeping the trailing comma rules consistent):

```rust
            commands::get_me,
            commands::create_comment,
            commands::update_comment,
            commands::delete_comment
```

- [ ] **Step 8: Build + fmt + commit.**

Run: `cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | tail -3` (expect success)
Run: `cargo fmt --manifest-path src-tauri/Cargo.toml`

```bash
git add src-tauri/src/linear/issues.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat(comments): create/update/delete comment commands"
```

---

### Task 3: Rust — reaction add/remove mutations

**Files:**
- Modify: `src-tauri/src/linear/issues.rs` (builders, parse, client method)
- Modify: `src-tauri/src/commands/mod.rs` (2 command wrappers)
- Modify: `src-tauri/src/lib.rs` (register)
- Test: `src-tauri/src/linear/issues.rs`

**Interfaces:**
- Consumes: `parse_reaction_node`, `DetailReaction` (Task 1), `authed` (Task 2).
- Produces: `LinearClient::add_reaction(auth, comment_id, emoji) -> Result<DetailReaction, …>`, `remove_reaction(auth, id) -> Result<(), …>`; commands `add_reaction`, `remove_reaction`.

- [ ] **Step 1: Failing parse tests.**

```rust
    #[test]
    fn parses_reaction_create_and_delete() {
        let body = r##"{"data":{"reactionCreate":{"success":true,"reaction":{
          "id":"re9","emoji":"🎉","user":{"id":"u1","name":"Abrar"}}}}}"##;
        let r = parse_reaction_create(body).unwrap();
        assert_eq!(r.emoji, "🎉");
        assert_eq!(r.user_id.as_deref(), Some("u1"));
        assert!(parse_reaction_delete(r#"{"data":{"reactionDelete":{"success":true}}}"#).is_ok());
        assert!(parse_reaction_create(r#"{"data":{"reactionCreate":{"success":false}}}"#).is_err());
    }
```

- [ ] **Step 2: Run to verify failure.**

Run: `cargo test --manifest-path src-tauri/Cargo.toml parses_reaction 2>&1 | rg "cannot find|error\["`
Expected: `parse_reaction_create`/`parse_reaction_delete` not found.

- [ ] **Step 3: Parse fns + builders + client method.** Parse fns near the comment parse fns:

```rust
pub fn parse_reaction_create(body: &str) -> Result<DetailReaction, LinearError> {
    let data = extract_data(body)?;
    let created = data.get("reactionCreate").ok_or(LinearError::Malformed)?;
    if created.get("success").and_then(|b| b.as_bool()) != Some(true) {
        return Err(LinearError::Api("reactionCreate returned success=false".into()));
    }
    Ok(parse_reaction_node(
        created.get("reaction").ok_or(LinearError::Malformed)?,
    ))
}

pub fn parse_reaction_delete(body: &str) -> Result<(), LinearError> {
    let data = extract_data(body)?;
    if data
        .get("reactionDelete")
        .and_then(|d| d.get("success"))
        .and_then(|b| b.as_bool())
        == Some(true)
    {
        Ok(())
    } else {
        Err(LinearError::Api("reactionDelete returned success=false".into()))
    }
}
```

Builders + method:

```rust
const REACTION_DELETE_MUTATION: &str =
    "mutation D($id: String!) { reactionDelete(id: $id) { success } }";

fn reaction_create_mutation() -> String {
    "mutation R($input: ReactionCreateInput!) { reactionCreate(input: $input) { success reaction { id emoji user { id name } } } }".to_string()
}
```

```rust
    pub async fn add_reaction(
        &self,
        auth: &str,
        comment_id: &str,
        emoji: &str,
    ) -> Result<DetailReaction, LinearError> {
        let req = serde_json::json!({
            "query": reaction_create_mutation(),
            "variables": { "input": { "commentId": comment_id, "emoji": emoji } }
        });
        parse_reaction_create(&self.post(auth, req).await?)
    }

    pub async fn remove_reaction(&self, auth: &str, id: &str) -> Result<(), LinearError> {
        let req = serde_json::json!({ "query": REACTION_DELETE_MUTATION, "variables": { "id": id } });
        parse_reaction_delete(&self.post(auth, req).await?)
    }
```

- [ ] **Step 4: Run parse tests (pass).**

Run: `cargo test --manifest-path src-tauri/Cargo.toml parses_reaction 2>&1 | rg "test result"`
Expected: `test result: ok.`

- [ ] **Step 5: Commands + register.** In `commands/mod.rs`:

```rust
#[tauri::command]
pub async fn add_reaction(
    state: State<'_, AppState>,
    comment_id: String,
    emoji: String,
) -> Result<DetailReaction, CmdError> {
    let auth = authed(&state).await?;
    state.linear.add_reaction(&auth, &comment_id, &emoji).await.map_err(CmdError::from)
}

#[tauri::command]
pub async fn remove_reaction(state: State<'_, AppState>, id: String) -> Result<(), CmdError> {
    let auth = authed(&state).await?;
    state.linear.remove_reaction(&auth, &id).await.map_err(CmdError::from)
}
```

In `lib.rs` add `commands::add_reaction, commands::remove_reaction` to the handler list (fix the preceding comma).

- [ ] **Step 6: Full Rust test suite + fmt + commit.**

Run: `cargo test --manifest-path src-tauri/Cargo.toml 2>&1 | rg "test result: ok"` (expect all ok)
Run: `cargo fmt --manifest-path src-tauri/Cargo.toml`

```bash
git add src-tauri/src/linear/issues.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat(comments): add/remove reaction commands"
```

---

### Task 4: TS — command bindings + types

**Files:**
- Modify: `src/lib/commands.ts` (`DetailComment` ~105; bindings ~241)

**Interfaces:**
- Produces: TS `DetailReaction`, extended `DetailComment`; `createComment`, `updateComment`, `deleteComment`, `addReaction`, `removeReaction`.

- [ ] **Step 1: Replace the `DetailComment` type** (~105):

```ts
export type DetailReaction = { id: string; emoji: string; userId: string | null; userName: string | null };
export type DetailComment = {
  id: string;
  body: string;
  userId: string | null;
  userName: string | null;
  createdAt: string;
  editedAt: string | null;
  parentId: string | null;
  reactions: DetailReaction[];
};
```

- [ ] **Step 2: Add invoke wrappers** after `getMe` (~241). Tauri v2 maps JS camelCase keys to Rust snake_case params:

```ts
export const createComment = (
  issueId: string,
  body: string,
  parentId?: string | null,
): Promise<DetailComment> => invoke("create_comment", { issueId, body, parentId: parentId ?? null });

export const updateComment = (id: string, body: string): Promise<DetailComment> =>
  invoke("update_comment", { id, body });

export const deleteComment = (id: string): Promise<void> => invoke("delete_comment", { id });

export const addReaction = (commentId: string, emoji: string): Promise<DetailReaction> =>
  invoke("add_reaction", { commentId, emoji });

export const removeReaction = (id: string): Promise<void> => invoke("remove_reaction", { id });
```

- [ ] **Step 3: Typecheck.**

Run: `npx tsc --noEmit`
Expected: no output (clean). (The drawer still compiles — `DetailComment` only gained optional-shaped fields used later.)

- [ ] **Step 4: Commit.**

```bash
git add src/lib/commands.ts
git commit -m "feat(comments): TS bindings for comment + reaction commands"
```

---

### Task 5: Pure helper — `buildCommentThreads`

**Files:**
- Create: `src/features/drawer/comments/commentThreads.ts`
- Test: `src/features/drawer/comments/commentThreads.test.ts`

**Interfaces:**
- Consumes: `DetailComment` (Task 4).
- Produces: `type CommentThreadData = { comment: DetailComment; replies: DetailComment[] }`; `buildCommentThreads(comments: DetailComment[]): CommentThreadData[]`.

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, expect, it } from "vitest";
import { buildCommentThreads } from "./commentThreads";
import type { DetailComment } from "@/lib/commands";

const c = (id: string, createdAt: string, parentId: string | null = null): DetailComment => ({
  id, body: id, userId: "u", userName: "U", createdAt, editedAt: null, parentId, reactions: [],
});

describe("buildCommentThreads", () => {
  it("nests replies under their parent, sorted by createdAt", () => {
    const threads = buildCommentThreads([
      c("a", "2026-06-20T10:00:00Z"),
      c("a2", "2026-06-20T10:30:00Z", "a"),
      c("b", "2026-06-20T09:00:00Z"),
      c("a1", "2026-06-20T10:10:00Z", "a"),
    ]);
    expect(threads.map((t) => t.comment.id)).toEqual(["b", "a"]); // top-level by createdAt asc
    expect(threads[1].replies.map((r) => r.id)).toEqual(["a1", "a2"]); // replies by createdAt asc
  });

  it("promotes an orphan reply (parent outside the page) to top-level", () => {
    const threads = buildCommentThreads([c("x", "2026-06-20T10:00:00Z", "missing")]);
    expect(threads).toHaveLength(1);
    expect(threads[0].comment.id).toBe("x");
    expect(threads[0].replies).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure.**

Run: `npx vitest run src/features/drawer/comments/commentThreads.test.ts`
Expected: FAIL — cannot resolve `./commentThreads`.

- [ ] **Step 3: Implement.**

```ts
import type { DetailComment } from "@/lib/commands";

export type CommentThreadData = { comment: DetailComment; replies: DetailComment[] };

const byCreatedAt = (a: DetailComment, b: DetailComment) => a.createdAt.localeCompare(b.createdAt);

/**
 * Group a flat comment list into single-level threads. A comment is top-level
 * when it has no parent, or when its parent is not present in this page (orphan
 * replies degrade to top-level so they are never dropped). Threads and replies
 * are each sorted oldest-first.
 */
export function buildCommentThreads(comments: DetailComment[]): CommentThreadData[] {
  const ids = new Set(comments.map((c) => c.id));
  const repliesByParent = new Map<string, DetailComment[]>();
  const topLevel: DetailComment[] = [];

  for (const comment of comments) {
    const isReply = comment.parentId != null && ids.has(comment.parentId);
    if (isReply) {
      const list = repliesByParent.get(comment.parentId as string);
      if (list) list.push(comment);
      else repliesByParent.set(comment.parentId as string, [comment]);
    } else {
      topLevel.push(comment);
    }
  }

  return topLevel
    .sort(byCreatedAt)
    .map((comment) => ({
      comment,
      replies: (repliesByParent.get(comment.id) ?? []).sort(byCreatedAt),
    }));
}
```

- [ ] **Step 4: Run (pass).**

Run: `npx vitest run src/features/drawer/comments/commentThreads.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit.**

```bash
git add src/features/drawer/comments/commentThreads.ts src/features/drawer/comments/commentThreads.test.ts
git commit -m "feat(comments): buildCommentThreads helper"
```

---

### Task 6: Pure helper — `aggregateReactions` + emoji set

**Files:**
- Create: `src/features/drawer/comments/reactions.ts`
- Test: `src/features/drawer/comments/reactions.test.ts`

**Interfaces:**
- Consumes: `DetailReaction` (Task 4).
- Produces: `const REACTION_EMOJI: readonly string[]`; `type AggregatedReaction = { emoji: string; count: number; reactedByMe: boolean; reactionIdByMe: string | null; names: string[] }`; `aggregateReactions(reactions: DetailReaction[], meId: string | null): AggregatedReaction[]`.

- [ ] **Step 1: Failing test.**

```ts
import { describe, expect, it } from "vitest";
import { aggregateReactions, REACTION_EMOJI } from "./reactions";
import type { DetailReaction } from "@/lib/commands";

const r = (id: string, emoji: string, userId: string, userName: string): DetailReaction => ({
  id, emoji, userId, userName,
});

describe("aggregateReactions", () => {
  it("groups by emoji with counts, names, and my-reaction state", () => {
    const out = aggregateReactions(
      [r("1", "👍", "u1", "Abrar"), r("2", "👍", "u2", "Jakob"), r("3", "🎉", "u2", "Jakob")],
      "u1",
    );
    expect(out.map((x) => [x.emoji, x.count])).toEqual([["👍", 2], ["🎉", 1]]);
    expect(out[0].reactedByMe).toBe(true);
    expect(out[0].reactionIdByMe).toBe("1");
    expect(out[0].names).toEqual(["Abrar", "Jakob"]);
    expect(out[1].reactedByMe).toBe(false);
    expect(out[1].reactionIdByMe).toBeNull();
  });

  it("exposes 8 quick-set emoji", () => {
    expect(REACTION_EMOJI).toHaveLength(8);
  });
});
```

- [ ] **Step 2: Run to verify failure.**

Run: `npx vitest run src/features/drawer/comments/reactions.test.ts`
Expected: FAIL — cannot resolve `./reactions`.

- [ ] **Step 3: Implement.**

```ts
import type { DetailReaction } from "@/lib/commands";

export const REACTION_EMOJI = ["👍", "🎉", "❤️", "😄", "😕", "👀", "🚀", "👎"] as const;

export type AggregatedReaction = {
  emoji: string;
  count: number;
  reactedByMe: boolean;
  reactionIdByMe: string | null;
  names: string[];
};

/** Collapse a comment's reactions into per-emoji pills (first-seen emoji order). */
export function aggregateReactions(
  reactions: DetailReaction[],
  meId: string | null,
): AggregatedReaction[] {
  const order: string[] = [];
  const byEmoji = new Map<string, AggregatedReaction>();
  for (const reaction of reactions) {
    let agg = byEmoji.get(reaction.emoji);
    if (!agg) {
      agg = { emoji: reaction.emoji, count: 0, reactedByMe: false, reactionIdByMe: null, names: [] };
      byEmoji.set(reaction.emoji, agg);
      order.push(reaction.emoji);
    }
    agg.count += 1;
    if (reaction.userName) agg.names.push(reaction.userName);
    if (meId != null && reaction.userId === meId) {
      agg.reactedByMe = true;
      agg.reactionIdByMe = reaction.id;
    }
  }
  return order.map((emoji) => byEmoji.get(emoji) as AggregatedReaction);
}
```

- [ ] **Step 4: Run (pass).**

Run: `npx vitest run src/features/drawer/comments/reactions.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit.**

```bash
git add src/features/drawer/comments/reactions.ts src/features/drawer/comments/reactions.test.ts
git commit -m "feat(comments): aggregateReactions helper + quick emoji set"
```

---

### Task 7: Pure helper — optimistic cache transforms

**Files:**
- Create: `src/features/drawer/comments/commentCache.ts`
- Test: `src/features/drawer/comments/commentCache.test.ts`

**Interfaces:**
- Consumes: `IssueDetailResult`, `DetailComment`, `DetailReaction` (Task 4).
- Produces: `addComment`, `replaceComment`, `editComment`, `removeCommentDeep`, `addReactionTo`, `removeReactionFrom` — each `(result: IssueDetailResult, …) => IssueDetailResult`; plus `makePendingComment(id, issueId, body, parentId, me): DetailComment` and `makePendingReaction(id, emoji, me): DetailReaction`.

- [ ] **Step 1: Failing test.**

```ts
import { describe, expect, it } from "vitest";
import {
  addComment, replaceComment, editComment, removeCommentDeep,
  addReactionTo, removeReactionFrom, makePendingComment, makePendingReaction,
} from "./commentCache";
import type { DetailComment, IssueDetailResult, LiveDetail } from "@/lib/commands";

const comment = (id: string, parentId: string | null = null): DetailComment => ({
  id, body: id, userId: "u1", userName: "U", createdAt: "t", editedAt: null, parentId, reactions: [],
});
const live = (comments: DetailComment[]): IssueDetailResult =>
  ({ source: "live", detail: { comments } as unknown as LiveDetail });

describe("commentCache", () => {
  it("addComment appends; cache source !== live is untouched", () => {
    const r = addComment(live([]), comment("a"));
    expect((r.detail as LiveDetail).comments.map((c) => c.id)).toEqual(["a"]);
    const cache = { source: "cache", detail: {} } as IssueDetailResult;
    expect(addComment(cache, comment("a"))).toBe(cache);
  });

  it("replaceComment swaps the temp id for the server comment", () => {
    const r = replaceComment(live([comment("temp")]), "temp", comment("real"));
    expect((r.detail as LiveDetail).comments[0].id).toBe("real");
  });

  it("editComment sets body + editedAt", () => {
    const r = editComment(live([comment("a")]), "a", "new body", "edited-at");
    const c = (r.detail as LiveDetail).comments[0];
    expect(c.body).toBe("new body");
    expect(c.editedAt).toBe("edited-at");
  });

  it("removeCommentDeep drops the comment and its replies", () => {
    const r = removeCommentDeep(live([comment("a"), comment("a1", "a"), comment("b")]), "a");
    expect((r.detail as LiveDetail).comments.map((c) => c.id)).toEqual(["b"]);
  });

  it("addReactionTo / removeReactionFrom mutate a single comment's reactions", () => {
    const re = makePendingReaction("re1", "👍", { viewerId: "u1", viewerName: "U" });
    const added = addReactionTo(live([comment("a")]), "a", re);
    expect((added.detail as LiveDetail).comments[0].reactions[0].emoji).toBe("👍");
    const removed = removeReactionFrom(added, "a", "re1");
    expect((removed.detail as LiveDetail).comments[0].reactions).toEqual([]);
  });

  it("makePendingComment attributes to me", () => {
    const p = makePendingComment("temp1", "issue1", "hi", null, { viewerId: "u1", viewerName: "Abrar" });
    expect(p).toMatchObject({ id: "temp1", body: "hi", parentId: null, userId: "u1", userName: "Abrar" });
  });
});
```

- [ ] **Step 2: Run to verify failure.**

Run: `npx vitest run src/features/drawer/comments/commentCache.test.ts`
Expected: FAIL — cannot resolve `./commentCache`.

- [ ] **Step 3: Implement.**

```ts
import type { DetailComment, DetailReaction, IssueDetailResult, Me } from "@/lib/commands";

/** Apply `fn` to the live comment list; non-live results pass through unchanged. */
function withComments(
  result: IssueDetailResult,
  fn: (comments: DetailComment[]) => DetailComment[],
): IssueDetailResult {
  if (result.source !== "live") return result;
  return { ...result, detail: { ...result.detail, comments: fn(result.detail.comments) } };
}

export function addComment(result: IssueDetailResult, comment: DetailComment): IssueDetailResult {
  return withComments(result, (cs) => [...cs, comment]);
}

export function replaceComment(
  result: IssueDetailResult,
  tempId: string,
  comment: DetailComment,
): IssueDetailResult {
  return withComments(result, (cs) => cs.map((c) => (c.id === tempId ? comment : c)));
}

export function editComment(
  result: IssueDetailResult,
  id: string,
  body: string,
  editedAt: string | null,
): IssueDetailResult {
  return withComments(result, (cs) => cs.map((c) => (c.id === id ? { ...c, body, editedAt } : c)));
}

export function removeCommentDeep(result: IssueDetailResult, id: string): IssueDetailResult {
  return withComments(result, (cs) => cs.filter((c) => c.id !== id && c.parentId !== id));
}

function withReactions(
  result: IssueDetailResult,
  commentId: string,
  fn: (reactions: DetailReaction[]) => DetailReaction[],
): IssueDetailResult {
  return withComments(result, (cs) =>
    cs.map((c) => (c.id === commentId ? { ...c, reactions: fn(c.reactions) } : c)),
  );
}

export function addReactionTo(
  result: IssueDetailResult,
  commentId: string,
  reaction: DetailReaction,
): IssueDetailResult {
  return withReactions(result, commentId, (rs) => [...rs, reaction]);
}

export function removeReactionFrom(
  result: IssueDetailResult,
  commentId: string,
  reactionId: string,
): IssueDetailResult {
  return withReactions(result, commentId, (rs) => rs.filter((r) => r.id !== reactionId));
}

export function makePendingComment(
  id: string,
  _issueId: string,
  body: string,
  parentId: string | null,
  me: Me | null,
): DetailComment {
  return {
    id,
    body,
    userId: me?.viewerId ?? null,
    userName: me?.viewerName ?? null,
    createdAt: new Date().toISOString(),
    editedAt: null,
    parentId,
    reactions: [],
  };
}

export function makePendingReaction(id: string, emoji: string, me: Me | null): DetailReaction {
  return { id, emoji, userId: me?.viewerId ?? null, userName: me?.viewerName ?? null };
}
```

- [ ] **Step 4: Run (pass).**

Run: `npx vitest run src/features/drawer/comments/commentCache.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit.**

```bash
git add src/features/drawer/comments/commentCache.ts src/features/drawer/comments/commentCache.test.ts
git commit -m "feat(comments): pure optimistic cache transforms"
```

---

### Task 8: TS — TanStack mutation hooks

**Files:**
- Modify: `src/lib/queries.ts` (add hooks after `useUpdateIssue` ~342; extend imports)
- Test: `src/lib/commentMutations.test.tsx`

**Interfaces:**
- Consumes: Task 4 bindings, Task 7 transforms.
- Produces: `useCreateComment()`, `useUpdateComment()`, `useDeleteComment()`, `useAddReaction()`, `useRemoveReaction()`. Each mutation takes `{ issueId, … }` so it can target `["issue", issueId]`.

- [ ] **Step 1: Write the failing hook test** (create + rollback — the core `[REQ]`). New file `src/lib/commentMutations.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import type { IssueDetailResult, LiveDetail } from "./commands";

const { createComment } = vi.hoisted(() => ({ createComment: vi.fn() }));
vi.mock("./commands", async (orig) => ({ ...(await orig<object>()), createComment }));
vi.mock("goey-toast", () => ({ gooeyToast: { error: vi.fn(), success: vi.fn() } }));

import { useCreateComment } from "./queries";

afterEach(() => { cleanup(); createComment.mockReset(); });

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData<IssueDetailResult>(["issue", "i1"], {
    source: "live",
    detail: { comments: [] } as unknown as LiveDetail,
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

describe("useCreateComment", () => {
  it("optimistically inserts a pending comment, then confirms with the server result", async () => {
    createComment.mockResolvedValue({
      id: "real", body: "hi", userId: "u1", userName: "U", createdAt: "t", editedAt: null, parentId: null, reactions: [],
    });
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useCreateComment(), { wrapper });
    result.current.mutate({ issueId: "i1", body: "hi" });
    // optimistic: a pending comment appears immediately
    await waitFor(() => {
      const d = qc.getQueryData<IssueDetailResult>(["issue", "i1"]);
      expect((d!.detail as LiveDetail).comments).toHaveLength(1);
    });
    // confirmed: temp swapped for the server id
    await waitFor(() => {
      const d = qc.getQueryData<IssueDetailResult>(["issue", "i1"]);
      expect((d!.detail as LiveDetail).comments[0].id).toBe("real");
    });
  });

  it("rolls back the optimistic insert on error", async () => {
    createComment.mockRejectedValue(new Error("boom"));
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useCreateComment(), { wrapper });
    result.current.mutate({ issueId: "i1", body: "hi" });
    await waitFor(() => expect(result.current.isError).toBe(true));
    const d = qc.getQueryData<IssueDetailResult>(["issue", "i1"]);
    expect((d!.detail as LiveDetail).comments).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure.**

Run: `npx vitest run src/lib/commentMutations.test.tsx`
Expected: FAIL — `useCreateComment` is not exported.

- [ ] **Step 3: Implement the hooks.** In `queries.ts`, extend the `./commands` import to add `createComment, updateComment, deleteComment, addReaction, removeReaction, type Me`, import the Task 7 transforms, then add after `useUpdateIssue`:

```ts
import {
  addComment, replaceComment, editComment, removeCommentDeep,
  addReactionTo, removeReactionFrom, makePendingComment, makePendingReaction,
} from "@/features/drawer/comments/commentCache";

type DetailSnapshot = { key: QueryKey; data: unknown };

function snapshotDetail(qc: QueryClient, issueId: string): DetailSnapshot {
  return { key: ["issue", issueId], data: qc.getQueryData(["issue", issueId]) };
}

export function useCreateComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ issueId, body, parentId }: { issueId: string; body: string; parentId?: string | null }) =>
      createComment(issueId, body, parentId),
    onMutate: async ({ issueId, body, parentId }) => {
      await qc.cancelQueries({ queryKey: ["issue", issueId] });
      const snap = snapshotDetail(qc, issueId);
      const me = qc.getQueryData<Me | null>(["me"]) ?? null;
      const tempId = `pending-${crypto.randomUUID()}`;
      const pending = makePendingComment(tempId, issueId, body, parentId ?? null, me);
      const cur = qc.getQueryData<IssueDetailResult>(["issue", issueId]);
      if (cur) qc.setQueryData(["issue", issueId], addComment(cur, pending));
      return { snap, tempId };
    },
    onError: (err, _vars, ctx) => {
      if (ctx) qc.setQueryData(ctx.snap.key, ctx.snap.data);
      gooeyToast.error("Couldn't post comment", { description: errorText(err) });
    },
    onSuccess: (server, { issueId }, ctx) => {
      const cur = qc.getQueryData<IssueDetailResult>(["issue", issueId]);
      if (cur && ctx) qc.setQueryData(["issue", issueId], replaceComment(cur, ctx.tempId, server));
    },
    onSettled: (_d, _e, { issueId }) => qc.invalidateQueries({ queryKey: ["issue", issueId] }),
  });
}

export function useUpdateComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { issueId: string; id: string; body: string }) => updateComment(id, body),
    onMutate: async ({ issueId, id, body }) => {
      await qc.cancelQueries({ queryKey: ["issue", issueId] });
      const snap = snapshotDetail(qc, issueId);
      const cur = qc.getQueryData<IssueDetailResult>(["issue", issueId]);
      if (cur) qc.setQueryData(["issue", issueId], editComment(cur, id, body, new Date().toISOString()));
      return { snap };
    },
    onError: (err, _vars, ctx) => {
      if (ctx) qc.setQueryData(ctx.snap.key, ctx.snap.data);
      gooeyToast.error("Couldn't update comment", { description: errorText(err) });
    },
    onSuccess: (server, { issueId, id }) => {
      const cur = qc.getQueryData<IssueDetailResult>(["issue", issueId]);
      if (cur) qc.setQueryData(["issue", issueId], editComment(cur, id, server.body, server.editedAt));
    },
    onSettled: (_d, _e, { issueId }) => qc.invalidateQueries({ queryKey: ["issue", issueId] }),
  });
}

export function useDeleteComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { issueId: string; id: string }) => deleteComment(id),
    onMutate: async ({ issueId, id }) => {
      await qc.cancelQueries({ queryKey: ["issue", issueId] });
      const snap = snapshotDetail(qc, issueId);
      const cur = qc.getQueryData<IssueDetailResult>(["issue", issueId]);
      if (cur) qc.setQueryData(["issue", issueId], removeCommentDeep(cur, id));
      return { snap };
    },
    onError: (err, _vars, ctx) => {
      if (ctx) qc.setQueryData(ctx.snap.key, ctx.snap.data);
      gooeyToast.error("Couldn't delete comment", { description: errorText(err) });
    },
    onSettled: (_d, _e, { issueId }) => qc.invalidateQueries({ queryKey: ["issue", issueId] }),
  });
}

export function useAddReaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ commentId, emoji }: { issueId: string; commentId: string; emoji: string }) =>
      addReaction(commentId, emoji),
    onMutate: async ({ issueId, commentId, emoji }) => {
      await qc.cancelQueries({ queryKey: ["issue", issueId] });
      const snap = snapshotDetail(qc, issueId);
      const me = qc.getQueryData<Me | null>(["me"]) ?? null;
      const tempId = `pending-${crypto.randomUUID()}`;
      const cur = qc.getQueryData<IssueDetailResult>(["issue", issueId]);
      if (cur) qc.setQueryData(["issue", issueId], addReactionTo(cur, commentId, makePendingReaction(tempId, emoji, me)));
      return { snap, tempId };
    },
    onError: (err, _vars, ctx) => {
      if (ctx) qc.setQueryData(ctx.snap.key, ctx.snap.data);
      gooeyToast.error("Couldn't add reaction", { description: errorText(err) });
    },
    onSettled: (_d, _e, { issueId }) => qc.invalidateQueries({ queryKey: ["issue", issueId] }),
  });
}

export function useRemoveReaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ reactionId }: { issueId: string; commentId: string; reactionId: string }) =>
      removeReaction(reactionId),
    onMutate: async ({ issueId, commentId, reactionId }) => {
      await qc.cancelQueries({ queryKey: ["issue", issueId] });
      const snap = snapshotDetail(qc, issueId);
      const cur = qc.getQueryData<IssueDetailResult>(["issue", issueId]);
      if (cur) qc.setQueryData(["issue", issueId], removeReactionFrom(cur, commentId, reactionId));
      return { snap };
    },
    onError: (err, _vars, ctx) => {
      if (ctx) qc.setQueryData(ctx.snap.key, ctx.snap.data);
      gooeyToast.error("Couldn't remove reaction", { description: errorText(err) });
    },
    onSettled: (_d, _e, { issueId }) => qc.invalidateQueries({ queryKey: ["issue", issueId] }),
  });
}
```

(`errorText`, `QueryKey`, `QueryClient`, `useMutation`, `useQueryClient`, `gooeyToast`, `IssueDetailResult` are already imported in `queries.ts`; add only what's missing.)

- [ ] **Step 4: Run the hook test + typecheck.**

Run: `npx vitest run src/lib/commentMutations.test.tsx`
Expected: PASS (2 tests).
Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/queries.ts src/lib/commentMutations.test.tsx
git commit -m "feat(comments): optimistic comment + reaction mutation hooks"
```

---

### Task 9: TS — `CommentComposer` (Milkdown composer)

**Files:**
- Create: `src/features/drawer/comments/CommentComposer.tsx`
- Test: `src/features/drawer/comments/CommentComposer.test.tsx`

**Interfaces:**
- Consumes: `descriptionPlugins`, `applyDescriptionConfig` (`../milkdownEditor`), `configureDescriptionSlash`, `configureDescriptionTooltip` (`../milkdownMenus`), `EditorErrorBoundary` (`../DescriptionEditor`).
- Produces: `CommentComposer({ variant, placeholder?, initialMarkdown?, submitting, onSubmit, onCancel?, onOpenLink, resolveMention })` where `onSubmit: (markdown: string) => void`. `variant: "pinned" | "reply" | "edit"`. Exposes the current markdown via the send button and Cmd/Ctrl+Enter; clears itself only when the parent remounts it via `key` (parent bumps key on success).

- [ ] **Step 1: Write the failing test.** Mirror the Milkdown mock from `DescriptionEditor.test.tsx`. The mocked `Milkdown` renders a textbox; the composer reads markdown from an injected ref updated by the listener — to keep the test independent of ProseMirror, the composer keeps the latest markdown in a ref set from `applyDescriptionConfig`'s listener, but for the test we assert the **submit wiring**: clicking send calls `onSubmit` with the seeded `initialMarkdown`, and Cmd+Enter does the same.

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CommentComposer } from "./CommentComposer";

vi.mock("@milkdown/react", () => ({
  MilkdownProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Milkdown: () => <div contentEditable="true" role="textbox" aria-label="composer" />,
  useEditor: () => ({ loading: false, get: () => undefined }),
}));
vi.mock("@milkdown/kit/core", () => ({
  Editor: { make: () => ({ config: () => ({}), use: () => ({}) }) },
  defaultValueCtx: "d", rootCtx: "r", editorViewOptionsCtx: "e", editorViewCtx: "v",
}));
vi.mock("@milkdown/kit/plugin/listener", () => ({ listener: {}, listenerCtx: "l" }));
vi.mock("../milkdownEditor", () => ({ descriptionPlugins: [], applyDescriptionConfig: vi.fn() }));
vi.mock("../milkdownMenus", () => ({ configureDescriptionSlash: vi.fn(), configureDescriptionTooltip: vi.fn() }));

afterEach(cleanup);

describe("CommentComposer", () => {
  it("submits the current markdown via the send button", () => {
    const onSubmit = vi.fn();
    render(
      <CommentComposer variant="pinned" initialMarkdown="hello" submitting={false}
        onSubmit={onSubmit} onOpenLink={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    expect(onSubmit).toHaveBeenCalledWith("hello");
  });

  it("submits on Cmd/Ctrl+Enter", () => {
    const onSubmit = vi.fn();
    const { container } = render(
      <CommentComposer variant="reply" initialMarkdown="reply body" submitting={false}
        onSubmit={onSubmit} onOpenLink={vi.fn()} />,
    );
    fireEvent.keyDown(container.querySelector("[data-comment-composer]")!, { key: "Enter", metaKey: true });
    expect(onSubmit).toHaveBeenCalledWith("reply body");
  });

  it("disables send while submitting", () => {
    render(
      <CommentComposer variant="pinned" initialMarkdown="x" submitting onSubmit={vi.fn()} onOpenLink={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run to verify failure.**

Run: `npx vitest run src/features/drawer/comments/CommentComposer.test.tsx`
Expected: FAIL — cannot resolve `./CommentComposer`.

- [ ] **Step 3: Implement.** The composer mirrors `MilkdownEditorInner` (always editable, focus on mount) and keeps the live markdown in a ref fed by the listener; `initialMarkdown` seeds both the editor default value and the ref so submit works even before the first edit (and in tests where the listener never fires).

```tsx
import { useRef } from "react";
import type { MilkdownPlugin } from "@milkdown/ctx";
import { Editor } from "@milkdown/kit/core";
import {
  defaultValueCtx, rootCtx, editorViewOptionsCtx, editorViewCtx,
} from "@milkdown/kit/core";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import { ArrowUp } from "lucide-react";
import { descriptionPlugins, applyDescriptionConfig } from "../milkdownEditor";
import { configureDescriptionSlash, configureDescriptionTooltip } from "../milkdownMenus";
import { descriptionMentionPlugin, type MentionResolver } from "../milkdownMention";
import { EditorErrorBoundary } from "../DescriptionEditor";

type Variant = "pinned" | "reply" | "edit";

interface Props {
  variant: Variant;
  initialMarkdown?: string;
  placeholder?: string;
  submitting: boolean;
  onSubmit: (markdown: string) => void;
  onCancel?: () => void;
  onOpenLink: (href: string) => void;
  resolveMention?: MentionResolver;
}

function ComposerInner({ markdownRef, initialMarkdown, onOpenLink, resolveMention }: {
  markdownRef: React.MutableRefObject<string>;
  initialMarkdown: string;
  onOpenLink: (href: string) => void;
  resolveMention?: MentionResolver;
}) {
  const onOpenLinkRef = useRef(onOpenLink);
  onOpenLinkRef.current = onOpenLink;

  useEditor(
    (root) =>
      Editor.make()
        .config((ctx) => {
          ctx.set(rootCtx, root);
          ctx.set(defaultValueCtx, initialMarkdown);
          ctx.set(editorViewOptionsCtx, {
            editable: () => true,
            handleClickOn: (_v, _p, _n, _np, event) => {
              const href = (event.target as HTMLElement | null)?.closest("a")?.getAttribute("href");
              if (href) { event.preventDefault(); onOpenLinkRef.current(href); return true; }
              return false;
            },
          });
          applyDescriptionConfig(ctx);
          ctx.get(listenerCtx).markdownUpdated((_c, md) => { markdownRef.current = md; });
          ctx.get(listenerCtx).mounted((c) => c.get(editorViewCtx).focus());
          configureDescriptionSlash(ctx);
          configureDescriptionTooltip(ctx);
        })
        .use(listener)
        .use(descriptionPlugins as MilkdownPlugin[])
        .use(resolveMention ? descriptionMentionPlugin(resolveMention, (h) => onOpenLinkRef.current(h)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return <Milkdown />;
}

/** Milkdown comment composer. Clears by remounting (parent bumps `key` on success). */
export function CommentComposer({
  variant, initialMarkdown = "", placeholder, submitting, onSubmit, onCancel, onOpenLink, resolveMention,
}: Props) {
  const markdownRef = useRef(initialMarkdown);

  const submit = () => {
    const md = markdownRef.current.trim();
    if (!md || submitting) return;
    onSubmit(md);
  };

  return (
    <EditorErrorBoundary fallback={<div className="text-sm text-muted-foreground">Composer unavailable.</div>}>
      <div
        data-comment-composer={variant}
        className="rounded-xl border border-border bg-card focus-within:border-foreground/25"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
          if (e.key === "Escape" && onCancel) { e.preventDefault(); onCancel(); }
        }}
      >
        <div
          className="comment-composer-prose max-h-56 overflow-y-auto px-3 py-2 text-sm"
          data-placeholder={placeholder ?? (variant === "reply" ? "Leave a reply…" : "Leave a comment…")}
        >
          <MilkdownProvider>
            <ComposerInner
              markdownRef={markdownRef}
              initialMarkdown={initialMarkdown}
              onOpenLink={onOpenLink}
              resolveMention={resolveMention}
            />
          </MilkdownProvider>
        </div>
        <div className="flex items-center justify-end gap-2 px-2 pb-2">
          {onCancel && (
            <button type="button" onClick={onCancel}
              className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Cancel
            </button>
          )}
          <button
            type="button"
            aria-label="Send comment"
            title="Send (⌘↵)"
            disabled={submitting}
            onClick={submit}
            className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowUp className="size-4" />
          </button>
        </div>
      </div>
    </EditorErrorBoundary>
  );
}
```

- [ ] **Step 4: Run (pass).**

Run: `npx vitest run src/features/drawer/comments/CommentComposer.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit.**

```bash
git add src/features/drawer/comments/CommentComposer.tsx src/features/drawer/comments/CommentComposer.test.tsx
git commit -m "feat(comments): Milkdown comment composer"
```

---

### Task 10: TS — `@user` mention typeahead + rendering

**Files:**
- Create: `src/features/drawer/comments/milkdownUserMention.ts`
- Test: `src/features/drawer/comments/milkdownUserMention.test.ts`

**Interfaces:**
- Consumes: `User` (`@/lib/commands`); the slash-typeahead pattern from `../milkdownMenus` (`SlashProvider`, `slashFactory`).
- Produces: pure `filterUsers(users, query): User[]`, `formatUserMention(user): string`, `userMentionFromHref(href): string | null`, `USER_MENTION_PREFIX`; plus `userMentionTypeahead(users): MilkdownPlugin[]` (the `@` typeahead) and `configureUserMention(ctx, users)`.

**Format decision (concrete):** a user mention is the standard Markdown link `[@Name](mention://user/<id>)`. It round-trips through commonmark unchanged and reuses link handling. After implementation, verify against live Linear (post a mention in dev, refetch the comment, inspect `body`); if Linear requires a different token to notify the user, change only `USER_MENTION_PREFIX` + `formatUserMention` and the `userMentionFromHref` matcher. The unit test pins the round-trip of our own format.

- [ ] **Step 1: Write the failing test** (pure functions only — the DOM typeahead mirrors the tested `SlashView`):

```ts
import { describe, expect, it } from "vitest";
import { filterUsers, formatUserMention, userMentionFromHref } from "./milkdownUserMention";
import type { User } from "@/lib/commands";

const users: User[] = [
  { id: "u1", name: "Abrar Mahir Esam" },
  { id: "u2", name: "Jakob Schwarz" },
  { id: "u3", name: "Abdullah Khan" },
];

describe("user mention helpers", () => {
  it("filters case-insensitively by name, empty query returns all", () => {
    expect(filterUsers(users, "").length).toBe(3);
    expect(filterUsers(users, "ab").map((u) => u.id)).toEqual(["u1", "u3"]);
    expect(filterUsers(users, "schwarz").map((u) => u.id)).toEqual(["u2"]);
  });

  it("formats and round-trips a mention href to the user id", () => {
    const md = formatUserMention(users[0]);
    expect(md).toBe("[@Abrar Mahir Esam](mention://user/u1)");
    expect(userMentionFromHref("mention://user/u1")).toBe("u1");
    expect(userMentionFromHref("https://example.com")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure.**

Run: `npx vitest run src/features/drawer/comments/milkdownUserMention.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Implement the pure helpers + the typeahead.** The typeahead class mirrors `SlashView` in `../milkdownMenus` (same `SlashProvider`, `data-md-menu`, keyboard handling, `#run` deletes the trigger range), with three differences: it triggers on `@` instead of `/`, filters `users`, and `#run` inserts the mention link markdown via `insertText` of `formatUserMention(user) + " "`.

```ts
import type { Ctx } from "@milkdown/kit/ctx";
import type { MilkdownPlugin } from "@milkdown/ctx";
import { editorViewCtx } from "@milkdown/kit/core";
import { SlashProvider, slashFactory } from "@milkdown/kit/plugin/slash";
import type { EditorState, PluginView } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import type { User } from "@/lib/commands";

export const USER_MENTION_PREFIX = "mention://user/";

/** Markdown for a user mention: a standard link so it round-trips through commonmark. */
export function formatUserMention(user: User): string {
  return `[@${user.name}](${USER_MENTION_PREFIX}${user.id})`;
}

/** Recover the user id from a mention href, or null if the href isn't a user mention. */
export function userMentionFromHref(href: string): string | null {
  return href.startsWith(USER_MENTION_PREFIX) ? href.slice(USER_MENTION_PREFIX.length) : null;
}

/** Case-insensitive name filter; empty query returns all users. */
export function filterUsers(users: User[], query: string): User[] {
  if (!query) return users;
  const q = query.toLowerCase();
  return users.filter((u) => u.name.toLowerCase().includes(q));
}

export const userMentionSlash = slashFactory("COMMENT_USER_MENTION");

class UserMentionView implements PluginView {
  readonly #content: HTMLElement;
  readonly #list: HTMLElement;
  readonly #provider: SlashProvider;
  readonly #ctx: Ctx;
  readonly #users: User[];
  #selectedIndex = 0;
  #filtered: User[] = [];
  #isOpen = false;
  #triggerFrom = -1;

  constructor(ctx: Ctx, view: EditorView, users: User[]) {
    this.#ctx = ctx;
    this.#users = users;
    const wrapper = document.createElement("div");
    wrapper.className = "md-slash-menu";
    wrapper.setAttribute("data-md-menu", "");
    wrapper.style.display = "none";
    const list = document.createElement("ul");
    list.style.cssText = "list-style:none;margin:0;padding:0;";
    wrapper.appendChild(list);
    this.#list = list;
    this.#content = wrapper;
    document.body.appendChild(wrapper);

    // oxlint-disable-next-line ts/no-this-alias
    const self = this;
    this.#provider = new SlashProvider({
      content: this.#content,
      debounce: 50,
      shouldShow(this: SlashProvider, v: EditorView) {
        const text = this.getContent(v, (node) => node.type.name === "paragraph");
        if (text == null) return false;
        const at = text.lastIndexOf("@");
        if (at < 0) return false;
        const query = text.slice(at + 1);
        if (/\s/.test(query)) return false; // mention token ends at whitespace
        const filtered = filterUsers(self.#users, query);
        if (filtered.length === 0) return false;
        const { $from } = v.state.selection;
        self.#triggerFrom = $from.pos - (text.length - at);
        self.#filtered = filtered;
        self.#selectedIndex = 0;
        self.#render();
        return true;
      },
      offset: 8,
    });
    this.#provider.onShow = () => { this.#isOpen = true; this.#content.style.display = "block"; };
    this.#provider.onHide = () => { this.#isOpen = false; this.#content.style.display = "none"; this.#triggerFrom = -1; };
    this.update(view);
  }

  handleKeyDown(e: KeyboardEvent): boolean {
    if (!this.#isOpen || this.#filtered.length === 0) return false;
    if (e.key === "ArrowDown") { this.#selectedIndex = Math.min(this.#selectedIndex + 1, this.#filtered.length - 1); this.#render(); return true; }
    if (e.key === "ArrowUp") { this.#selectedIndex = Math.max(this.#selectedIndex - 1, 0); this.#render(); return true; }
    if (e.key === "Enter") { const u = this.#filtered[this.#selectedIndex]; if (u) this.#run(u); return true; }
    if (e.key === "Escape") { this.#provider.hide(); return true; }
    return false;
  }

  #render() {
    this.#list.innerHTML = "";
    this.#filtered.forEach((u, i) => {
      const li = document.createElement("li");
      li.setAttribute("data-id", u.id);
      if (i === this.#selectedIndex) li.setAttribute("data-selected", "true");
      li.textContent = u.name;
      li.addEventListener("mouseenter", () => { this.#selectedIndex = i; this.#render(); });
      li.addEventListener("mousedown", (e) => { e.preventDefault(); this.#run(u); });
      this.#list.appendChild(li);
    });
  }

  #run(user: User) {
    const view = this.#ctx.get(editorViewCtx);
    const { state } = view;
    const cursorPos = state.selection.from;
    let tr = state.tr;
    if (this.#triggerFrom >= 0 && this.#triggerFrom < cursorPos) {
      tr = tr.delete(this.#triggerFrom, cursorPos);
    }
    tr = tr.insertText(`${formatUserMention(user)} `);
    view.dispatch(tr);
    this.#provider.hide();
  }

  update = (view: EditorView, prevState?: EditorState) => { this.#provider.update(view, prevState); };
  destroy = () => { this.#provider.destroy(); this.#content.remove(); };
}

export function configureUserMention(ctx: Ctx, users: User[]) {
  let current: UserMentionView | null = null;
  ctx.set(userMentionSlash.key, {
    view: (editorView) => { current = new UserMentionView(ctx, editorView, users); return current; },
    props: { handleKeyDown: (_v: EditorView, e: KeyboardEvent) => current?.handleKeyDown(e) ?? false },
  });
}

/** Plugin array to `.use(...)` in the composer; pass the cached teammate list. */
export function userMentionTypeahead(): MilkdownPlugin[] {
  return [userMentionSlash as unknown as MilkdownPlugin];
}
```

- [ ] **Step 4: Wire the typeahead into the composer.** In `CommentComposer.tsx`, accept a `users: User[]` prop and a `resolveUser?` callback; inside `ComposerInner`'s config add `configureUserMention(ctx, users)` and `.use(userMentionTypeahead())`; and pass `resolveUser` into `descriptionMentionPlugin` (Task 11 extends that mark view to render user pills). Add `users` to `CommentComposer`'s `Props` and thread it through. (Insertion + rendering both reference `mention://user/<id>`.)

- [ ] **Step 5: Run pure test + typecheck.**

Run: `npx vitest run src/features/drawer/comments/milkdownUserMention.test.ts`
Expected: PASS (2 tests).
Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit.**

```bash
git add src/features/drawer/comments/milkdownUserMention.ts src/features/drawer/comments/milkdownUserMention.test.ts src/features/drawer/comments/CommentComposer.tsx
git commit -m "feat(comments): @user mention typeahead + format"
```

- [ ] **Step 7 (verification, manual, in dev):** Post a comment with an `@mention` via the running app, refetch the issue detail, and inspect the returned `comment.body`. If Linear stores/needs a different mention token, update `USER_MENTION_PREFIX`/`formatUserMention`/`userMentionFromHref` and re-run the test. Record the confirmed format in a one-line comment atop `milkdownUserMention.ts`.

---

### Task 11: TS — `ReactionBar`, `CommentCard`, `CommentThread`

**Files:**
- Create: `src/features/drawer/timeAgo.ts` (extracted from `IssueDrawer.tsx`)
- Modify: `src/features/drawer/IssueDrawer.tsx` (remove local `timeAgo`, import the shared one)
- Modify: `src/features/drawer/milkdownMention.ts` (extend the link mark view to render user-mention pills)
- Create: `src/features/drawer/comments/ReactionBar.tsx`, `CommentCard.tsx`, `CommentThread.tsx`
- Test: `src/features/drawer/comments/CommentCard.test.tsx`

**Interfaces:**
- Consumes: `aggregateReactions`, `REACTION_EMOJI` (Task 6); `CommentThreadData` (Task 5); `CommentComposer` (Task 9); `Avatar`, `timeAgo`, `useMe`, mutation hooks (Task 8); the read-only render path (`ReadOnlyDescription` from `../DescriptionEditor`).
- Produces: `ReactionBar({ reactions, onToggle })`; `CommentCard({ comment, issueId, isReply?, onOpenLink, resolveMention })`; `CommentThread({ thread, issueId, onOpenLink, resolveMention })`.

- [ ] **Step 1: Write the failing test** (author-gating + reaction counts):

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { DetailComment } from "@/lib/commands";

const { meId } = vi.hoisted(() => ({ meId: { value: "u1" } }));
vi.mock("@/lib/queries", () => ({
  useMe: () => ({ data: { viewerId: meId.value, viewerName: "Me" } }),
  useUpdateComment: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteComment: () => ({ mutate: vi.fn() }),
  useAddReaction: () => ({ mutate: vi.fn() }),
  useRemoveReaction: () => ({ mutate: vi.fn() }),
  useCreateComment: () => ({ mutate: vi.fn(), isPending: false }),
}));
// Read-only render path stubbed to plain text (avoids react-markdown internals here).
vi.mock("../DescriptionEditor", () => ({ ReadOnlyDescription: ({ markdown }: { markdown: string }) => <div>{markdown}</div> }));

import { CommentCard } from "./CommentCard";

const base: DetailComment = {
  id: "c1", body: "the body", userId: "u1", userName: "Abrar",
  createdAt: "2026-06-19T10:00:00Z", editedAt: "2026-06-19T10:05:00Z", parentId: null,
  reactions: [{ id: "r1", emoji: "👍", userId: "u2", userName: "Jakob" }],
};

afterEach(() => { cleanup(); meId.value = "u1"; });

describe("CommentCard", () => {
  it("shows the (edited) marker and a reaction pill with its count", () => {
    render(<CommentCard comment={base} issueId="i1" onOpenLink={vi.fn()} />);
    expect(screen.getByText(/\(edited\)/)).toBeTruthy();
    expect(screen.getByText("👍")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
  });

  it("exposes the edit/delete menu only to the author", () => {
    const { rerender } = render(<CommentCard comment={base} issueId="i1" onOpenLink={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /comment actions/i })).not.toBeNull();
    meId.value = "someone-else";
    rerender(<CommentCard comment={base} issueId="i1" onOpenLink={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /comment actions/i })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure.**

Run: `npx vitest run src/features/drawer/comments/CommentCard.test.tsx`
Expected: FAIL — cannot resolve `./CommentCard`.

- [ ] **Step 2a: Extract `timeAgo` into a shared module.** `timeAgo` is currently a private function inside `IssueDrawer.tsx` (~line 72). Move it verbatim to a new `src/features/drawer/timeAgo.ts`:

```ts
/** "3d ago" / "just now" relative time. Mirrors the drawer's existing formatter. */
export function timeAgo(iso: string): string {
  // (copy the existing body of timeAgo from IssueDrawer.tsx verbatim)
}
```

Then in `IssueDrawer.tsx` delete the local `function timeAgo(…)` and add `import { timeAgo } from "./timeAgo";`. Run `npx tsc --noEmit` — expect clean (the drawer still resolves `timeAgo`). `CommentCard` imports it from `../timeAgo`.

- [ ] **Step 3: Extend the mention mark view for user pills.** In `milkdownMention.ts`, change `descriptionMentionPlugin` + `makeLinkMarkView` to accept an optional `resolveUser?: (id: string) => { name: string } | undefined`. In `makeLinkMarkView`, before the issue check, detect a user mention:

```ts
import { userMentionFromHref } from "./comments/milkdownUserMention";
// …
const userId = userMentionFromHref(href);
const user = userId && resolveUser ? resolveUser(userId) : undefined;
if (userId && user) {
  const dom = document.createElement("span");
  dom.setAttribute("data-mention-pill", "user");
  dom.title = user.name;
  dom.style.cssText = /* same pill cssText as the issue pill */ "";
  const contentDOM = document.createElement("span");
  dom.appendChild(contentDOM);
  dom.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); });
  return { dom, contentDOM };
}
```

Update `descriptionMentionPlugin(resolveMention, onActivateLink, resolveUser?)` to close over `resolveUser`. Keep existing callers working (third arg optional). Also extend `ReadOnlyDescription`'s `createMarkdownComponents` path: a user-mention link (`href` matching `USER_MENTION_PREFIX`) renders as a non-navigating pill `<span data-mention-pill="user">@Name</span>` — add a branch in the existing link component in `markdownComponents.tsx` that checks `userMentionFromHref(href)`.

- [ ] **Step 4: Implement `ReactionBar.tsx`.**

```tsx
import { SmilePlus } from "lucide-react";
import { Popover } from "@/components/Popover";
import { aggregateReactions, REACTION_EMOJI, type AggregatedReaction } from "./reactions";
import type { DetailReaction } from "@/lib/commands";

export function ReactionBar({
  reactions, meId, onToggle, onAdd,
}: {
  reactions: DetailReaction[];
  meId: string | null;
  onToggle: (agg: AggregatedReaction) => void;
  onAdd: (emoji: string) => void;
}) {
  const aggregated = aggregateReactions(reactions, meId);
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1">
      {aggregated.map((agg) => (
        <button
          key={agg.emoji}
          type="button"
          title={agg.names.join(", ")}
          onClick={() => onToggle(agg)}
          className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs transition-colors ${
            agg.reactedByMe ? "border-primary/50 bg-primary/15 text-foreground" : "border-border text-muted-foreground hover:bg-accent"
          }`}
        >
          <span>{agg.emoji}</span>
          <span className="tabular-nums">{agg.count}</span>
        </button>
      ))}
      <Popover
        align="start"
        buttonTitle="Add reaction"
        buttonClassName="flex size-6 items-center justify-center rounded-full text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        button={<SmilePlus className="size-3.5" />}
        panelClassName="flex gap-1 rounded-lg border border-border bg-popover p-1 shadow-2xl"
      >
        {(close) => (
          <>
            {REACTION_EMOJI.map((emoji) => (
              <button key={emoji} type="button" onClick={() => { onAdd(emoji); close(); }}
                className="rounded-md px-1.5 py-1 text-base hover:bg-accent">
                {emoji}
              </button>
            ))}
          </>
        )}
      </Popover>
    </div>
  );
}
```

- [ ] **Step 5: Implement `CommentCard.tsx`.** Author-gated `…` menu (Edit/Delete), `(edited)`, hover/focus-revealed actions (`group` + `group-hover`/`group-focus-within`), edit-in-place via `CommentComposer variant="edit"`, body via `ReadOnlyDescription`, reactions via `ReactionBar` wired to the Task 8 hooks. Delete confirms in the menu then calls `useDeleteComment().mutate({ issueId, id })` and shows an undo toast.

```tsx
import { useState } from "react";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { gooeyToast } from "goey-toast";
import { Avatar } from "@/components/Avatar";
import { Popover, PopoverItem } from "@/components/Popover";
import { timeAgo } from "../timeAgo";
import {
  useMe, useUpdateComment, useDeleteComment, useAddReaction, useRemoveReaction,
} from "@/lib/queries";
import { ReadOnlyDescription } from "../DescriptionEditor";
import { CommentComposer } from "./CommentComposer";
import { ReactionBar } from "./ReactionBar";
import type { AggregatedReaction } from "./reactions";
import type { DetailComment } from "@/lib/commands";
import type { MentionResolver } from "../markdownComponents";

export function CommentCard({
  comment, issueId, onOpenLink, resolveMention,
}: {
  comment: DetailComment;
  issueId: string;
  onOpenLink: (href: string) => void;
  resolveMention?: MentionResolver;
}) {
  const me = useMe().data ?? null;
  const meId = me?.viewerId ?? null;
  const isAuthor = comment.userId != null && comment.userId === meId;
  const [editing, setEditing] = useState(false);
  const [editKey, setEditKey] = useState(0);
  const update = useUpdateComment();
  const del = useDeleteComment();
  const add = useAddReaction();
  const remove = useRemoveReaction();
  const isPending = comment.id.startsWith("pending-");

  const toggleReaction = (agg: AggregatedReaction) => {
    if (agg.reactedByMe && agg.reactionIdByMe) {
      remove.mutate({ issueId, commentId: comment.id, reactionId: agg.reactionIdByMe });
    } else {
      add.mutate({ issueId, commentId: comment.id, emoji: agg.emoji });
    }
  };

  return (
    <div className={`group min-w-0 flex-1 ${isPending ? "opacity-60" : ""}`}>
      <div className="flex items-center gap-2">
        <Avatar name={comment.userName ?? "?"} size={22} />
        <span className="text-sm font-medium text-foreground">{comment.userName ?? "Unknown"}</span>
        <span className="text-xs text-muted-foreground">
          {timeAgo(comment.createdAt)}{comment.editedAt ? " (edited)" : ""}
        </span>
        {isAuthor && !editing && (
          <div className="ml-auto opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            <Popover
              align="end"
              buttonTitle="Comment actions"
              buttonClassName="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              button={<MoreHorizontal className="size-4" />}
              panelClassName="w-40 rounded-lg border border-border bg-popover p-1 shadow-2xl"
            >
              {(close) => (
                <>
                  <PopoverItem icon={<Pencil className="size-4" />} label="Edit" onClick={() => { setEditing(true); close(); }} />
                  <PopoverItem
                    icon={<Trash2 className="size-4" />}
                    label="Delete"
                    danger
                    onClick={() => {
                      close();
                      del.mutate({ issueId, id: comment.id });
                      gooeyToast.success("Comment deleted");
                    }}
                  />
                </>
              )}
            </Popover>
          </div>
        )}
      </div>

      <div className="mt-1">
        {editing ? (
          <CommentComposer
            key={editKey}
            variant="edit"
            initialMarkdown={comment.body}
            submitting={update.isPending}
            onOpenLink={onOpenLink}
            resolveMention={resolveMention}
            onCancel={() => setEditing(false)}
            onSubmit={(md) => {
              update.mutate({ issueId, id: comment.id, body: md });
              setEditing(false);
              setEditKey((k) => k + 1);
            }}
          />
        ) : (
          <ReadOnlyDescription markdown={comment.body} onOpenLink={onOpenLink} resolveMention={resolveMention} />
        )}
      </div>

      {!editing && (
        <ReactionBar
          reactions={comment.reactions}
          meId={meId}
          onToggle={toggleReaction}
          onAdd={(emoji) => add.mutate({ issueId, commentId: comment.id, emoji })}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 6: Implement `CommentThread.tsx`** (top-level card + replies + inline reply composer):

```tsx
import { useState } from "react";
import { CornerDownRight } from "lucide-react";
import { useCreateComment } from "@/lib/queries";
import { CommentCard } from "./CommentCard";
import { CommentComposer } from "./CommentComposer";
import type { CommentThreadData } from "./commentThreads";
import type { MentionResolver } from "../markdownComponents";

export function CommentThread({
  thread, issueId, onOpenLink, resolveMention,
}: {
  thread: CommentThreadData;
  issueId: string;
  onOpenLink: (href: string) => void;
  resolveMention?: MentionResolver;
}) {
  const [replying, setReplying] = useState(false);
  const [replyKey, setReplyKey] = useState(0);
  const create = useCreateComment();
  const parentId = thread.comment.id;

  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2.5">
      <CommentCard comment={thread.comment} issueId={issueId} onOpenLink={onOpenLink} resolveMention={resolveMention} />

      {thread.replies.length > 0 && (
        <div className="mt-3 space-y-3 border-l border-border pl-3">
          {thread.replies.map((reply) => (
            <CommentCard key={reply.id} comment={reply} issueId={issueId} onOpenLink={onOpenLink} resolveMention={resolveMention} />
          ))}
        </div>
      )}

      <div className="mt-2 pl-3">
        {replying ? (
          <CommentComposer
            key={replyKey}
            variant="reply"
            submitting={create.isPending}
            onOpenLink={onOpenLink}
            resolveMention={resolveMention}
            onCancel={() => setReplying(false)}
            onSubmit={(md) => {
              create.mutate({ issueId, body: md, parentId });
              setReplying(false);
              setReplyKey((k) => k + 1);
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setReplying(true)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <CornerDownRight className="size-3.5" /> Reply
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Run the card test + typecheck.**

Run: `npx vitest run src/features/drawer/comments/CommentCard.test.tsx`
Expected: PASS (2 tests).
Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 8: Commit.**

```bash
git add src/features/drawer/timeAgo.ts src/features/drawer/IssueDrawer.tsx src/features/drawer/comments/ReactionBar.tsx src/features/drawer/comments/CommentCard.tsx src/features/drawer/comments/CommentThread.tsx src/features/drawer/comments/CommentCard.test.tsx src/features/drawer/milkdownMention.ts src/features/drawer/markdownComponents.tsx
git commit -m "feat(comments): comment card, thread, and reaction bar"
```

---

### Task 12: TS — wire into `IssueDrawer` (pinned composer + threads)

**Files:**
- Modify: `src/features/drawer/IssueDrawer.tsx` (Activity render ~605; main column layout ~470-472; `buildActivity` usage ~289; imports)
- Modify: `src/features/drawer/drawerActivity.ts` (drop comments from the timeline list — history-only)
- Test: `src/features/drawer/drawerActivity.test.ts` (update expectations)
- Modify: `src/styles/index.css` (composer placeholder + pill styling)

**Interfaces:**
- Consumes: `buildCommentThreads` (Task 5), `CommentThread` (Task 11), `CommentComposer` (Task 9), `useCreateComment` (Task 8), `useUsers`/`useMe` (existing).

- [ ] **Step 1: Update `buildActivity` to exclude comments.** In `drawerActivity.ts`, remove the `comments` param and the comment-mapping branch so `ActivityItem` no longer has the `comment` kind; `buildActivity` takes `{ createdAt, creatorName, history }`. Update `drawerActivity.test.ts` to drop comment assertions and assert history+created only. Run:

Run: `npx vitest run src/features/drawer/drawerActivity.test.ts`
Expected: PASS after edits.

- [ ] **Step 2: Restructure the main column for the pinned composer.** Replace the main-column wrapper (`IssueDrawer.tsx` ~471-472):

```tsx
        {/* Main column: scrollable content + pinned composer footer */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="drawer-scrollbar min-w-0 flex-1 overflow-y-auto px-7 py-6">
```

Close the scroll `</div>` before the existing `</div>` that ends the main column, then add the footer (only when `editable`):

```tsx
          </div>
          {editable && (
            <div className="shrink-0 border-t border-border px-7 py-3">
              <CommentComposer
                key={`composer-${id}-${composerKey}`}
                variant="pinned"
                submitting={createComment.isPending}
                users={users.data ?? []}
                onOpenLink={handleLink}
                resolveMention={resolveMention}
                onSubmit={(md) => { createComment.mutate({ issueId: id, body: md }); setComposerKey((k) => k + 1); }}
              />
            </div>
          )}
        </div>
```

Add near the other hooks in `DrawerContent`: `const createComment = useCreateComment();` and `const [composerKey, setComposerKey] = useState(0);` (reset `composerKey`/clear is via the `key` bump). `users` (`useUsers()`) and `resolveMention` already exist in this component (verify; if `resolveMention` isn't defined here, build it from `issueByIdent` as the description editor does).

- [ ] **Step 3: Replace the Activity comment rendering with threads.** In the Activity `DrawerSection` (~605), keep history lines from `activity`, and render comment threads from `buildCommentThreads(live.comments)`:

```tsx
          {live && (
            <DrawerSection title="Activity" className="border-t border-border pt-6">
              <div className="space-y-4">
                {activity.length > 0 && (
                  <div className="relative space-y-4 before:absolute before:bottom-3 before:left-[11px] before:top-3 before:w-px before:bg-border">
                    {activity.map((item) => (
                      <div key={item.id} className="relative flex gap-3">
                        <div className="relative z-10 mt-0.5 shrink-0 rounded-full bg-background">
                          <span className="flex size-6 items-center justify-center rounded-full border border-border bg-card text-muted-foreground">
                            {item.kind === "created" ? <CircleDot className="size-3.5" /> : <IterationCcw className="size-3.5" />}
                          </span>
                        </div>
                        <p className="min-w-0 flex-1 pt-0.5 text-sm leading-5 text-muted-foreground">
                          <span className="font-medium text-foreground">{item.actorName ?? "Linear"}</span>{" "}
                          {item.summary} · {timeAgo(item.createdAt)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
                <div className="space-y-3">
                  {buildCommentThreads(live.comments).map((thread) => (
                    <CommentThread
                      key={thread.comment.id}
                      thread={thread}
                      issueId={id}
                      onOpenLink={handleLink}
                      resolveMention={resolveMention}
                    />
                  ))}
                </div>
                {live.comments.length === 0 && activity.length === 0 && (
                  <p className="text-sm text-muted-foreground">No activity yet.</p>
                )}
                {(live.hasMoreHistory || live.hasMoreComments) && (
                  <p className="text-xs text-muted-foreground">Showing the first 50 history events and comments.</p>
                )}
              </div>
            </DrawerSection>
          )}
```

Update `activity` memo to drop the `comments` arg. Remove the now-unused `ReactMarkdown`/`Avatar` import only if nothing else uses them (verify — `md`/`Avatar` are used elsewhere; keep them).

- [ ] **Step 4: Add composer placeholder + user-pill CSS.** In `src/styles/index.css`, add an empty-state placeholder for the composer (Milkdown sets no placeholder by default) and ensure the user-mention pill matches the issue pill:

```css
.comment-composer-prose .ProseMirror { outline: none; min-height: 1.5rem; }
.comment-composer-prose .ProseMirror p.is-empty:first-child::before {
  content: attr(data-placeholder);
  color: var(--muted-foreground);
  position: absolute;
  pointer-events: none;
}
```

(The `data-placeholder` is set on the wrapper in Task 9; if Milkdown's empty-paragraph class differs, scope to `.comment-composer-prose .ProseMirror .is-empty::before` consistent with the existing description placeholder rule.)

- [ ] **Step 5: Full gates.**

Run: `npx tsc --noEmit` (clean)
Run: `npx vitest run` (all suites pass)
Run: `npm run build 2>&1 | tail -3` (built)

- [ ] **Step 6: Manual smoke (dev).** `npm run tauri dev`: open an issue → post a top-level comment (Cmd+Enter) → it appears, then confirms; reply to it; react with 👍 and toggle it off; edit then delete your comment (undo toast); `@`-type a teammate and pick from the typeahead. Confirm offline/cache shows no composer.

- [ ] **Step 7: Commit.**

```bash
git add src/features/drawer/IssueDrawer.tsx src/features/drawer/drawerActivity.ts src/features/drawer/drawerActivity.test.ts src/styles/index.css
git commit -m "feat(comments): pinned composer + threaded comments in the drawer"
```

---

## Self-Review

**Spec coverage:**
- Post top-level comments → Tasks 2, 8, 9, 12. ✓
- Edit/delete own comments → Tasks 2, 8, 11 (author-gated menu). ✓
- Single-level threaded replies → Tasks 5, 11 (`CommentThread` inline reply). ✓
- Emoji reactions (quick 8-set, toggle pills, counts) → Tasks 3, 6, 8, 11 (`ReactionBar`). ✓
- `@user` autocomplete → Task 10; rendering → Task 11. ✓
- Pinned composer layout → Task 12. ✓
- Optimistic + rollback → Tasks 7, 8. ✓
- Live-only (no SQLite) → backend tasks add no migration. ✓
- Sanitized errors / `success=false` failure → Tasks 2, 3. ✓
- Empty/loading/error/offline states → Tasks 9 (submitting/disabled), 11 (pending opacity), 12 (no composer offline, empty-state line). ✓
- Author gating via `me.id` → Task 11. ✓

**Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N". The one external unknown (Linear's exact mention token) is a concrete default format + a bounded verification step (Task 10 Step 7), not a placeholder.

**Type consistency:** `DetailComment`/`DetailReaction` fields match across Rust (Task 1) and TS (Task 4). Mutation hooks (Task 8) take `{ issueId, … }` and call the Task 4 bindings; transforms (Task 7) are consumed unchanged. `aggregateReactions` returns `reactionIdByMe` used by `ReactionBar.onToggle` → `useRemoveReaction({ reactionId })`. `formatUserMention`/`userMentionFromHref` share `USER_MENTION_PREFIX` across composer insertion (Task 10) and pill rendering (Task 11). `CommentThreadData` shape is produced in Task 5 and consumed in Tasks 11–12.

> Open verification carried into execution (flagged, not blocking): exact Linear input/field names (`CommentCreateInput.parentId`, `editedAt`, `ReactionCreateInput.commentId`) and the mention token format — confirm against the live schema during Tasks 2/3/10.
