# Screen Toggles Implementation Plan

**Spec:** `docs/superpowers/specs/2026-10-28-screen-toggles-design.md`
**Branch:** `feat/screen-toggles`. No migrations. Each task: failing test first,
then the smallest change, then the focused test.

## Task 1: Rust screen state and atomic writes

1. `modules/screens.rs`: `ScreenId`, `load_disabled`, `save_disabled` + tests
   (missing / unknown / malformed / round trip). `pub mod screens;` in
   `modules/mod.rs`.
2. `commands/modules.rs`: `ModulesView.disabled_screens`; `modules_view`
   helper; `set_enabled_modules_logic` and new `set_disabled_screens_logic`
   take the `modules_write` mutex; `AppState::require_screen`. Tests:
   concurrent sets keep DB == memory; screens persist + swap; `require_screen`.
3. `AppState` fields `screens`, `modules_write`; `lib.rs` loads screens and
   registers `set_disabled_screens`; add it to `CORE_COMMANDS`.
4. `list_notifications` → `state.require_screen(ScreenId::Inbox)?`.
5. `cargo test`, `cargo clippy`, `cargo fmt --check`.

## Task 2: Frontend registry

1. `commands.ts`: `ScreenId`, `ModulesView.disabledScreens`,
   `setDisabledScreens`.
2. `modules.ts`: `SWITCHABLE_SCREENS`, screen-aware `viewActive` /
   `visibleViews`, `useModules` returns `disabledScreens`, `isViewActive`,
   `isError`, `refetch`. Tests in `modules.test.tsx`.
3. `queries.ts`: `useNotifications` gated by Inbox. Test in
   `moduleGating.test.tsx`.

## Task 3: Gating and openers

1. `tabs.tsx`: close hidden screens' tabs; openers refuse hidden views (pure
   helper `openableView` in `modules.ts`, tested).
2. Dock, palette, Dashboard quick actions use the screen-aware list.
3. `AppShell`: picker rendered outside the providers. Test: no palette on `⌘K`
   while the picker shows.

## Task 4: Settings → Modules

Nested screen switches under enabled modules; retry state. Tests in
`ModulesSection.test.tsx`.

## Task 5: Picker

"Linear screens" group; Continue calls `setDisabledScreens` then
`setEnabledModules`. Tests in `ModulePicker.test.tsx`.

## Task 6: Dashboard

Inbox gating, fallback links, KPI column count (`--kpi-cols`) + CSS. Tests in
`DashboardPage.test.tsx`. Update `DESIGN.md` KPI row wording.

## Task 7: Missing Linear key

`queries.ts` shared `reportSyncError(err, manual)`; sync loop silent in the
background, hint on manual refresh; palette resync uses it. Tests in
`moduleGating.test.tsx`.

## Task 8: Verify and publish

`npm test`, `npm run build`, cargo test/clippy/fmt, `git diff --check`; focused
commits; push; PR.
