# Repository Guidelines

## Project Structure & Module Organization

Astryn is a Tauri 2 desktop application with a React 19 and TypeScript frontend. Frontend code lives in `src/`: `main.tsx` mounts the app, `App.tsx` contains the root component, and `App.css` holds its styles. Put imported frontend assets in `src/assets/`; files that must retain their URL or filename belong in `public/`. The Rust backend is under `src-tauri/`, with commands and application setup in `src-tauri/src/lib.rs`, the binary entry point in `main.rs`, permissions in `capabilities/`, and packaging settings in `tauri.conf.json`. Product behavior is specified in `requirements.md`.

## Build, Test, and Development Commands

- `npm install` installs JavaScript and Tauri CLI dependencies.
- `npm run dev` starts the Vite frontend in a browser.
- `npm run tauri dev` runs the complete desktop app with hot reload.
- `npm run build` type-checks TypeScript and creates the frontend production bundle in `dist/`.
- `npm run tauri build` produces a packaged desktop application.
- `cargo test --manifest-path src-tauri/Cargo.toml` runs Rust unit and integration tests.
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` verifies Rust formatting.

## Coding Style & Naming Conventions

TypeScript is strict; keep code free of unused locals, unused parameters, and fallthrough cases. Follow the existing two-space indentation, double quotes, semicolons, and trailing commas. Name React components and component files in `PascalCase`, hooks and functions in `camelCase`, and CSS classes in lowercase kebab-case. Keep Tauri commands small and use Rust `snake_case`. Run `npx tsc --noEmit` and `cargo fmt --manifest-path src-tauri/Cargo.toml` before submitting changes.

## Testing Guidelines

**Vitest is configured** (`npm test`); place frontend tests as `*.test.ts` or `*.test.tsx` beside the code under test. For frontend changes, treat `npm run build` as the minimum automated check and `npm test` as the frontend test suite; manually exercise the affected flow with `npm run tauri dev`. Add Rust unit tests beside their modules using `#[cfg(test)]`; place broader backend tests in `src-tauri/tests/`.

## Commit & Pull Request Guidelines

Git history is unavailable in this checkout. Use concise, imperative commit subjects, preferably Conventional Commit style, such as `feat: add workspace switcher` or `fix: validate empty project names`. Keep each commit focused. Pull requests should explain the user-visible change, list verification commands, link the relevant issue or requirement, and include screenshots or recordings for UI changes. Call out any changes to Tauri capabilities or platform packaging explicitly.
