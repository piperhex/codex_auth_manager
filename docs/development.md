# Development and Debugging

## Environment Setup

Install Node.js, npm, the latest stable Rust toolchain, and the Tauri 2 dependencies for your platform. Then install project dependencies:

```powershell
npm install
```

Ubuntu needs the Linux WebKitGTK/AppIndicator toolchain before `npm run dev:app`, `npm run check`, or `npm run build:app`:

```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libappindicator3-dev librsvg2-dev patchelf xdg-utils
```

Dependency versions are locked by the root `package-lock.json` and `apps/desktop/src-tauri/Cargo.lock`. Include both lockfile changes whenever a dependency update is intentional.

## Common Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the desktop browser preview with data from `apps/desktop/src/demo.ts` |
| `npm run dev:app` | Start the complete Tauri desktop application |
| `npm run dev:admin` | Start the admin console |
| `npm run dev:backend` | Start the NestJS backend in watch mode |
| `npm run start -w @codex-switch/native` | Start the Expo mobile development server |
| `npm run android -w @codex-switch/native` | Start Expo and open the Android target |
| `npm run ios -w @codex-switch/native` | Start Expo and open the iOS target |
| `npm run build` | Build all npm workspaces through Lerna/Nx |
| `npm run build:desktop` | Type-check and build the desktop frontend |
| `npm run build:admin` | Build the admin console |
| `npm run build:backend` | Build the NestJS backend |
| `npm run build:app` | Build desktop installers |
| `npm run build:app:mac` | Build a universal macOS bundle |
| `npm run build:app:win-arm64` | Build a Windows ARM64 bundle |
| `npm run check:rust` | Check Rust formatting and run Rust tests |
| `npm run check` | Check desktop, admin UI, backend tests/types, mobile types, Rust formatting, and Rust tests |
| `npm run test` | Run workspace test scripts where present |
| `npm run nx -- graph` | Open the Nx project graph |
| `npm run release` | Bump the patch version, tag, and push a stable release |
| `npm run release-beta` | Bump or create a beta prerelease tag |

## Browser Preview and Desktop Mode

The browser preview does not read real files, start OAuth, access real accounts, or open native windows. `apps/desktop/src/api/backend.ts` selects the appropriate implementation by detecting the Tauri runtime. When adding a backend operation, also define its preview behavior: provide demo/localStorage state or clearly report that the operation is unavailable.

Use a custom Codex directory in desktop mode to avoid changing your everyday environment:

```powershell
$env:CODEX_HOME = "$PWD\.local-codex"
npm run dev:app
```

The `.local-codex/` directory may contain credentials. Confirm that it cannot be committed before using it. A temporary directory outside the workspace is safer.

For local Windows ARM64 app builds, install the Rust `aarch64-pc-windows-msvc` target and use a Visual Studio/MSVC developer environment with ARM64 build tools before running `npm run build:app:win-arm64`.

## Debugging Guidelines

- UI or state issue: reproduce it first with `npm run dev` and demo data.
- IPC issue: verify that command names and arguments in `apps/desktop/src/api/backend.ts` match `commands.rs`.
- File issue: set a temporary `CODEX_HOME` instead of modifying an account you regularly use.
- OAuth issue: confirm that local ports `1455` and `1457` are free, then try the system-browser flow.
- Tray issue: confirm `system_tray::refresh_menu` is called after account, usage, or active-account changes.
- Floating bubble issue: inspect `settings.json`, window label `usage-bubble`, and the `theme-color-changed` event path.
- Provider/config issue: inspect the managed blocks in `$CODEX_HOME/config.toml`, `config-before-provider.toml`, the selected Provider JSON, and the `providers-changed` event path. Never paste real Provider keys into an issue.
- Local proxy issue: confirm `127.0.0.1:15722` is free, inspect `state.json`, call the local `/health` route, and export diagnostics from Settings. Review an export before sharing because upstream error details can still be sensitive.
- Token Usage issue: requests must pass through the local proxy. Inspect `token-usage.sqlite3`, the `token-usage` capability label, and the hash route used by the auxiliary window.
- Cloud issue: verify the configured Base URL, Kong route split, backend logs, and `lastModifiedAt` values. Use only fake credentials while debugging synchronization.
- Mobile issue: verify the same Base URL reaches `/auth/login` and `/sync/accounts/summary` from the device; localhost on the development computer is not localhost on a physical phone.
- Admin schema issue: when `POSTGRES_DB_SYNCHRONIZE=false`, apply every dated SQL migration listed in `apps/admin/README.md` in order.
- Restart issue: test with a disposable Codex session. Windows uses `taskkill`; macOS and Linux use `pkill` plus the available relaunch strategy.
- Rust logic: prefer unit tests around the pure parsing functions in `auth.rs` and `codex_api.rs`.

## Release Workflow

`npm run release` and `npm run release-beta` require a clean working tree. The script updates `package.json`, `package-lock.json`, `apps/desktop/package.json`, and `apps/desktop/src-tauri/tauri.conf.json`, including a numeric WiX/MSI version derived from prerelease tags such as `0.2.3-beta.0` -> `0.2.3.0`. It commits the version bump when needed, creates an annotated tag, then pushes both the current branch and tag to `origin`.

The GitHub Actions release workflow starts from `v*` tags or a manual run with an existing tag. It creates or finds the GitHub Release, generates release notes when needed, runs the relevant checks, and uploads Windows x64, Windows ARM64, Ubuntu/Linux x64, macOS Apple Silicon and Intel artifacts, an Android release APK, and an unsigned iOS Release `.app.zip`. The iOS artifact validates the build only; producing an installable IPA requires signing credentials and a provisioning profile.

## Adding a Feature

1. Define the smallest redacted transfer model in `models.rs`.
2. Put external API, storage, or identity logic in the corresponding Rust module.
3. Orchestrate the use case in `commands.rs` and register the command in `lib.rs`.
4. Add a typed wrapper to `apps/desktop/src/api/backend.ts`.
5. If the feature is app-level configuration, update `AppSettings`, `storage.rs`, and the browser-preview behavior in `apps/desktop/src/api/backend.ts`.
6. If it affects Providers, hot routing, cloud sync, archives, or token history, update the dedicated Rust module and its persistence/version-compatibility tests instead of placing the behavior in `commands.rs`.
7. If it affects tray or floating-bubble behavior, update `system_tray.rs`, `floating_bubble.rs`, and the relevant event refresh paths.
8. For a new auxiliary Tauri window, use an async creation command on Windows, add its label to `src-tauri/capabilities/default.json`, and keep packaged routes compatible with the frontend route parser.
9. Manage business state in a hook, then render it through pages and components.
10. If a backend entity changes, add a dated SQL migration for deployments with `POSTGRES_DB_SYNCHRONIZE=false` and update the backend API list.
11. Update the relevant architecture or usage documentation and run `npm run check`.

Pages must not call `invoke` directly. Tauri command functions must not absorb JWT parsing, HTTP response parsing, or low-level file-replacement logic.
