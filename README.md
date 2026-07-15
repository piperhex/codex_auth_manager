# Codex Switch

Codex Switch is a local-first Tauri 2 desktop application for signing in to, storing, and switching between multiple Codex / ChatGPT accounts. It also manages third-party model providers, provides an optional local hot-switching proxy, and can sync with a self-hosted backend for administration and read-only mobile access.

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE) [![Release](https://img.shields.io/github/v/release/piperhex/codex-switch)](https://github.com/piperhex/codex-switch/releases)

QQ技术交流群: `1051213898`.

![Codex Switch account dashboard](docs/assets/codex-switch-dashboard.png)

![Codex Switch settings page](docs/assets/codex-switch-settings.png)

## Features

- Reuses the Codex CLI OAuth 2.0 + PKCE login flow
- Supports both an in-app login window and the system browser
- Imports and manages multiple `auth.json` files, including common third-party JSON exports and multi-account JSON files
- Atomically switches `$CODEX_HOME/auth.json` (defaults to `~/.codex/auth.json`)
- Exports and restores local accounts and Provider profiles through `.cs` backup archives
- Displays account email, plan, primary / secondary usage windows, and reset credits, and can consume an available reset credit
- Refreshes one or all accounts manually or on a timer
- Provides a best-effort **Restart ChatGPT** action from the dashboard and tray after switching accounts
- Adds system tray account switching and an optional always-on-top floating usage bubble
- Supports OpenAI Responses and Chat Completions-compatible third-party Providers, multiple models, and either direct config switching or hot switching through a loopback proxy
- Records per-request token totals for traffic sent through the local proxy and can export structured proxy diagnostics
- Can refresh all official accounts after quota exhaustion, switch to the account with the lowest primary-window usage, and retry the request once
- Supports local UI language, accent color, privacy mode, and floating-bubble preferences
- Optionally syncs accounts and Providers with the self-hosted NestJS backend; the Expo mobile companion reads redacted account and usage summaries
- Keeps account and Provider secrets in the Rust backend and out of the desktop React UI and application logs

> [!IMPORTANT]
> Local account credentials, Provider API keys, and desktop cloud-login tokens are stored in the application data directory without an additional at-rest encryption layer. A `.cs` backup contains restorable account credentials and Provider keys and must be protected like an `auth.json` file. Cloud sync is opt-in, but when enabled it uploads those account credentials and Provider keys to the server you configure. Use only a trusted device and trusted self-hosted server, never commit or share credential files or backups, and review exported diagnostics before sharing them.

## Technology

- Frontend: React 18, TypeScript, Vite, and Ant Design
- Desktop runtime: Tauri 2
- Backend: Rust, Reqwest, and Serde
- Optional cloud service: NestJS, TypeORM, PostgreSQL, Redis, and JWT authentication
- Mobile companion: React Native and Expo
- Monorepo: npm workspaces, Lerna, and Nx

## Getting Started

### Prerequisites

- Node.js 18 or later
- npm
- The latest stable Rust toolchain
- The appropriate [Tauri 2 system dependencies](https://v2.tauri.app/start/prerequisites/) for your platform
- WebView2 on Windows (already installed on most modern Windows systems)
- Xcode Command Line Tools on macOS

On Ubuntu, install the Tauri Linux build dependencies first:

```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libappindicator3-dev librsvg2-dev patchelf xdg-utils
```

Install dependencies and start the desktop application:

```powershell
npm install
npm run dev:app
```

Start the browser-only preview with demo data and no access to real credentials:

```powershell
npm run dev
```

Start the admin console or cloud backend:

```powershell
npm run dev:admin
npm run dev:backend
```

Start the Expo mobile companion:

```powershell
npm run start -w @codex-switch/native
```

The mobile app requires a deployed cloud backend and displays synchronized account summaries only. See [apps/native/README.md](apps/native/README.md) and [apps/admin/README.md](apps/admin/README.md) for setup details.

Build the desktop installer:

```powershell
npm run build:app
```

On macOS, build a universal Apple Silicon + Intel bundle:

```bash
npm run build:app:mac
```

On Windows, build an ARM64 bundle:

```powershell
rustup target add aarch64-pc-windows-msvc
npm run build:app:win-arm64
```

Windows ARM64 builds also need the MSVC C++ toolchain with ARM64 build tools available in the developer environment.

On Ubuntu, `npm run build:app` produces `.deb` and AppImage bundles.

Run all frontend and backend checks:

```powershell
npm run check
```

## Releases

GitHub Actions publishes release assets automatically when a version tag is pushed:

```bash
npm run release
npm run release-beta
```

`npm run release` reads `package.json`, bumps the patch version by 1, updates `package.json`, `package-lock.json`, `apps/desktop/package.json`, and `apps/desktop/src-tauri/tauri.conf.json`, commits the version bump, creates an annotated tag such as `v0.1.1`, then pushes both the branch and tag to `origin`. `npm run release-beta` creates a prerelease tag such as `v0.1.1-beta.0`, or increments the beta number if the current version is already beta, and also pushes automatically.

You can pass an exact version or tag with `npm run release -- v0.2.0` or `npm run release-beta -- v0.2.0-beta.1`. Explicit versions are also synced into the version files before the tag is created.

The release workflow builds Windows x64, Windows ARM64, Ubuntu/Linux x64, macOS Apple Silicon and Intel artifacts, an Android APK, and an unsigned iOS Release `.app.zip`, then uploads them to the matching GitHub Release. The iOS artifact verifies the build but requires Apple signing credentials before it can be installed on a device or submitted to the App Store. Release notes are generated automatically from the commits and pull requests included in the tag diff, with the installer download note kept at the top. Tags containing a prerelease suffix, such as `-beta.0`, are published as GitHub prereleases. The workflow can also be run manually from Actions by entering an existing tag.

## Usage

1. Select **Add account**, then sign in through the app, use the system browser, import an existing `auth.json`, or import a compatible JSON export. Compatible import accepts one object, an array, an `{ "accounts": [...] }` wrapper, or newline-delimited objects and recognizes common token/session field names.
2. Refresh usage from the account list. Expand a row to view its reset credits.
3. Select **Switch** to atomically replace the `auth.json` file currently used by Codex.
4. Use **Restart ChatGPT** from the dashboard or tray after switching if a running ChatGPT/Codex process may still be using cached credentials.

Use **Import** and **Export** in the account toolbar to restore or create a `.cs` backup containing all local accounts and Provider profiles. Import merges entries by their stable identifiers; it does not treat the archive as a disposable or secret-free export.

The **Providers** page manages OpenAI Responses or Chat Completions-compatible endpoints, API keys, model lists, and whether Codex or Codex Switch controls model selection. Without the local proxy, switching writes a managed section to `$CODEX_HOME/config.toml` and running sessions may need a restart. Starting the proxy binds `127.0.0.1:15722`, points Codex at it, and enables hot switching. In official-account mode, **Auto switch** handles a quota response by refreshing saved accounts, selecting an eligible account with the lowest primary-window usage, switching credentials, and retrying that request once. The Token Usage window summarizes requests observed by this proxy.

The Settings page provides language selection, accent color, privacy mode, floating usage bubble control, a global auto-refresh timer for all saved accounts, an independent timer for the active account, a cloud backend URL, local data-folder shortcuts, and proxy diagnostic export.

The system tray menu can show the dashboard, switch accounts, restart ChatGPT, or quit the app. The floating usage bubble shows the active account's primary usage window, refreshes that account on left click, expands on hover, can be dragged to a new position, and exposes the same quick actions through its context menu.

The application honors the `CODEX_HOME` environment variable and falls back to `~/.codex` when it is not set. Managed account copies, Provider profiles, app settings, cloud tokens, proxy logs, and token-usage history are stored under the operating system's application data directory.

Cloud login remains disabled until a Base URL is configured in Settings. After login, manual sync and normal account/Provider changes exchange complete credential payloads with that server. The mobile companion calls the redacted `/sync/accounts/summary` route and never receives `auth.json` contents.

## Project Structure

```text
apps/desktop/        Tauri desktop application workspace
  src/               React frontend
  api/               Tauri command and browser-preview adapter
  components/        Reusable presentation components
  hooks/             Account, notification, and auto-refresh state
  pages/             Page-level composition
  utils/             Side-effect-free formatting helpers
  src-tauri/src/     Rust backend
  auth.rs            Credential validation and account identity parsing
  codex_api.rs       Token refresh and Codex HTTP API access
  commands.rs        Tauri command boundary and use-case orchestration
  account_archive.rs .cs account and Provider import/export
  cloud.rs           Optional backend login and bidirectional synchronization
  floating_bubble.rs Floating bubble window, theme settings, and bubble position
  local_proxy.rs     Loopback proxy, API bridging, diagnostics, token usage, and quota failover
  oauth.rs           OAuth PKCE login flow
  providers.rs       Provider persistence and managed Codex config updates
  storage.rs         Paths, atomic writes, and the account store
  system_tray.rs     Tray menu, account quick switching, and restart action
  models.rs          Frontend/backend transfer models
apps/admin-ui/       React admin console workspace
apps/admin/          NestJS cloud backend workspace
apps/native/         Expo mobile account-usage companion
docs/                Architecture and development documentation
```

More documentation:

- [Architecture and data flow](docs/architecture.md)
- [Development and debugging](docs/development.md)
- [Contributing guide](CONTRIBUTING.md)

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before getting started, especially the credential-redaction, responsibility-boundary, and local-validation requirements.

## License

Codex Switch is licensed under the [Apache License 2.0](LICENSE), the same license used by the official [OpenAI Codex](https://github.com/openai/codex) repository.

## Current Limitations

- The OAuth callback first attempts to use local port `1455`, then falls back to `1457`.
- The complete account-management and Provider workflow is desktop-only. The mobile app is a read-only companion for data already synchronized to a configured backend.
- macOS release builds are ad-hoc signed, but not notarized unless Apple Developer signing/notarization credentials are added to CI.
- The published iOS `.app.zip` is unsigned and is a CI build artifact, not an installable App Store package.
- Embedded login depends on WebView and identity-provider policies; use the system browser if it fails.
- The local proxy listens only on `127.0.0.1:15722`; token history is available only for requests routed through it.
- Restarting ChatGPT is best effort and depends on local process discovery plus the platform's ability to relaunch ChatGPT or the legacy `codex` entry point.
