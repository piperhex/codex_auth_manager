# Codex Switch

> Chinese is the default documentation language. For the Chinese README, see [README.md](README.md).

Codex Switch is a local-first Tauri 2 desktop application for signing in to, storing, and switching between multiple Codex / ChatGPT accounts. It also manages third-party model providers, offers an optional local hot-switching proxy, and can sync with a self-hosted backend for administration and read-only mobile access.

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE) [![Release](https://img.shields.io/github/v/release/piperhex/codex-switch)](https://github.com/piperhex/codex-switch/releases)

## Screenshots

### Account management and local proxy

![Codex Switch account dashboard](docs/assets/codex-switch-dashboard.png)

### Third-party providers

![Codex Switch providers](docs/assets/codex-switch-providers.png)

### Token usage

![Codex Switch token usage](docs/assets/codex-switch-token-usage.png)

### Settings

![Codex Switch settings](docs/assets/codex-switch-settings.png)

### Floating usage bubble

![Codex Switch floating usage bubble](docs/assets/codex-switch-floating-usage.png)

### Dream Skin

![Codex Switch Dream Skin](docs/assets/codex-switch-dream-skin.png)

## Features

- Reuses the Codex CLI OAuth 2.0 + PKCE login flow, with both in-app and system-browser login.
- Imports and manages multiple `auth.json` files, including common third-party JSON exports and multi-account files.
- Atomically switches `$CODEX_HOME/auth.json` (default: `~/.codex/auth.json`) and supports `.cs` account/provider backups.
- Displays account plans, usage windows, reset credits, and supports manual or scheduled refreshes.
- Provides system-tray switching, a floating usage bubble, and a best-effort **Restart ChatGPT** action.
- Supports OpenAI Responses and Chat Completions-compatible providers, multiple models, direct config switching, and a loopback proxy for hot switching.
- Records token usage for requests routed through the local proxy and exports structured proxy diagnostics.
- Can refresh accounts after quota exhaustion, select an eligible account with the lowest primary-window usage, switch credentials, and retry once.
- Keeps account credentials and Provider secrets in the Rust backend, out of the React UI and application logs.

> [!IMPORTANT]
> Account credentials, Provider API keys, and cloud-login tokens are stored in the application data directory without additional at-rest encryption. A `.cs` backup contains restorable credentials and keys. Cloud sync is opt-in, but enabling it uploads those secrets to the server you configure. Use only trusted devices and self-hosted servers; never commit, share, or publish credential files, backups, or unchecked diagnostics.

## Getting started

### Prerequisites

- Node.js 18 or later
- npm
- Latest stable Rust toolchain
- [Tauri 2 system dependencies](https://v2.tauri.app/start/prerequisites/) for your platform
- WebView2 on Windows and Xcode Command Line Tools on macOS

On Ubuntu, install the Tauri Linux build dependencies:

```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libappindicator3-dev librsvg2-dev patchelf xdg-utils
```

Install dependencies and start the desktop app:

```powershell
npm install
npm run dev:app
```

Other common commands:

```powershell
npm run dev
npm run dev:admin
npm run dev:backend
npm run start -w @codex-switch/native
npm run build:app
npm run check
```

The browser preview uses demo data and never accesses real credentials. The mobile companion requires a deployed cloud backend and only displays synchronized, redacted account summaries. See [the mobile README](apps/native/README.md) and [the admin backend README](apps/admin/README.md).

## Usage

1. Select **Add account** and sign in in the app, through the system browser, or import `auth.json` / a compatible JSON export.
2. Refresh account usage and expand a row to view reset credits.
3. Select **Switch** to atomically replace the `auth.json` currently used by Codex.
4. If a running ChatGPT/Codex process may have cached the old credentials, use **Restart ChatGPT** from the dashboard or tray.

The **Providers** page manages OpenAI Responses or Chat Completions-compatible endpoints, API keys, models, and model-control policy. Without the proxy, switching writes a managed section to `$CODEX_HOME/config.toml`; active sessions may need a restart. The proxy listens on `127.0.0.1:15722`, directs Codex to it, and enables hot switching.

## More documentation

- [Architecture and data flow](docs/architecture.md)
- [Development and debugging](docs/development.md)
- [Contributing guide](CONTRIBUTING.md)

## License

Codex Switch is licensed under the [Apache License 2.0](LICENSE), the same license used by the official [OpenAI Codex](https://github.com/openai/codex) repository.
