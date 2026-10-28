# ClickUp Docs Source — Plan

Spec: `docs/superpowers/specs/2026-10-28-clickup-docs-design.md`. TDD: each step starts with a failing test. Stacked on `feat/docs-sources`.

1. **`clickup/` module** — `ClickUpError`, status mapping, `ClickUpCredentialProvider` + `PersonalTokenProvider`, `ClickUpClient::get`; `clickup/docs.rs`: `parse_doc_link`, request paths, `parse_doc_name`, `parse_user`, `pages_to_files`. Fixture tests.
2. **Module manifest** — `ModuleId::Clickup` (provider, `docs-source`), Rust + TS, command owners.
3. **`db/docs.rs`** — `DocsSourceKind::Clickup`, `insert_clickup_docs_source`, `wipe_clickup_cache`.
4. **`commands/clickup.rs`** — set/clear/test token, `get_clickup_status`; `AppState` fields; `lib.rs` wiring.
5. **`commands/docs.rs`** — `add_clickup_docs_source`, ClickUp sync branch with generation guard, availability; `get_docs_status.clickupTokenPresent`.
6. **`commands/modules.rs`** — remove-data + generation bump + lock for ClickUp.
7. **Frontend** — bindings, queries, Settings ClickUp section, Documentation add form, tree expand toggle for pages with children, Docs page prompt.
8. **Verify** — focused tests, `npm test`, `npm run build`, `cargo test`, `cargo clippy`, `cargo fmt -- --check`, `git diff --check`.
