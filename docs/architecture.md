# Architecture and Data Flow

This document describes the responsibility boundaries, key data flows, and security constraints of Codex Switch.

## Overview

```mermaid
flowchart LR
    UI["React dashboard and bubble window"] --> Hooks["Business hooks"]
    Hooks --> Adapter["Frontend API adapter"]
    Adapter -->|"Tauri invoke / events"| Commands["Rust commands"]
    Tray["System tray menu"] --> Commands
    Commands --> Store["Local account store"]
    Commands --> API["Codex HTTP API"]
    Commands --> Settings["settings.json"]
    Commands --> Process["Local Codex process"]
    OAuth["OAuth PKCE"] --> Store
    Store --> Current["$CODEX_HOME/auth.json"]
```

The frontend only receives redacted models such as `AccountSummary`, `UsageSummary`, `ResetCreditsSummary`, `AppInfo`, and `AppSettings`. Complete `auth.json` contents, access tokens, and refresh tokens remain in the Rust backend.

## Frontend Responsibilities

- `src/api/backend.ts` is the only entry point for Tauri IPC and file selection. It also provides browser-preview behavior.
- `src/hooks/useAccountManager.ts` orchestrates loading, login, import, switching, deletion, and usage refreshes.
- `src/hooks/useAutoRefresh.ts` persists the global refresh timer plus per-account timers and owns their lifecycles.
- `src/hooks/useFloatingBubble.ts`, `src/hooks/useThemeColor.ts`, and `src/hooks/useLanguage.ts` manage local UI preferences.
- `src/pages/` composes page-level layouts and does not call the backend directly.
- `src/components/` contains presentation and local interactions. The account table loads reset credits through the API adapter, and `FloatingUsageBubble.tsx` renders the standalone usage bubble window.
- `src/utils/` contains pure formatting helpers for dates, quotas, and display text.

## Backend Responsibilities

- `models.rs` defines IPC responses and persisted summary structures.
- `auth.rs` decodes JWT payloads, validates credentials, and generates stable account IDs.
- `storage.rs` resolves data directories and handles JSON reads, atomic replacement, and account-store synchronization.
- `codex_api.rs` refreshes tokens, sends authorized requests, and parses usage and reset-credit responses.
- `oauth.rs` owns PKCE parameters, the local callback server, the login window, and credential exchange.
- `commands.rs` exposes commands to the frontend and only orchestrates account, usage, reset-credit, and process-restart use cases.
- `floating_bubble.rs` owns the floating window, persisted app settings, theme-color events, context-menu positioning, and bubble-position persistence.
- `system_tray.rs` owns the tray menu, dashboard reveal behavior, account quick switching, and tray restart action.
- `lib.rs` registers plugins, application state, windows, tray setup, event handlers, and commands. It contains no business rules.

## Key Data Flows

### Login

1. The frontend calls `start_login` and never receives OAuth tokens.
2. Rust creates a PKCE verifier, challenge, and random state, then starts a local callback listener.
3. After authorization, Rust validates the state and exchanges the authorization code for tokens.
4. Rust validates the credentials, derives an account ID, and writes the complete `auth.json` to the account store.
5. The backend emits `login-status` and `accounts-changed`; the frontend reloads redacted summaries.

### Account Switching

1. The backend makes a best-effort copy of the current `auth.json` to preserve tokens that Codex may have refreshed.
2. It reads and validates the selected account again.
3. It updates `$CODEX_HOME/auth.json` using a temporary file and an atomic replacement in the same directory.
4. It updates the active account ID in `state.json` and tells the frontend to reload.

### Usage Refresh

1. For the account currently used by Codex, the backend reads `$CODEX_HOME/auth.json` as the authoritative credential source and syncs it into the managed store when it differs. Other accounts use their managed-store credentials.
2. It refreshes the token before expiry or after a `401` response, then writes updated active credentials back to both `$CODEX_HOME/auth.json` and the managed store.
3. It calls the Codex usage API and parses only the fields required by the UI.
4. It writes the resulting summary to `usage.json`; the complete API response is never sent to the frontend.

### Settings, Tray, and Floating Bubble

1. App-level settings such as the floating-bubble switch, accent color, and bubble position are read from `settings.json`.
2. Theme changes are persisted through the Rust backend in desktop mode and emitted back to every window with `theme-color-changed`.
3. The optional floating bubble runs as a separate frameless, transparent, always-on-top Tauri window. It uses the same redacted dashboard data and backend events as the main window.
4. The tray and floating-bubble context menu are rebuilt after account changes so active-account checkmarks and usage labels stay current.

### Restart Codex

1. The dashboard button or tray menu calls `restart_codex`.
2. On Windows, the backend tries to discover the current Codex executable path, stops `codex.exe` with `taskkill /F /T`, then relaunches the discovered target or `codex` on `PATH`.
3. On macOS and Linux, the backend stops matching Codex processes with `pkill`, then uses the platform launch strategy available for that OS.
4. Restart is best effort. It does not read, write, or log credentials.

## Persisted Data Layout

```text
OS application data/codex-switch/
  state.json
  settings.json
  accounts/
    <stable account ID>/
      auth.json
      usage.json

$CODEX_HOME/
  auth.json
```

The stable account ID is a truncated hash of the user identity and ChatGPT account ID. It does not contain token data.

The WebView `localStorage` stores UI-only preferences such as language, last all-account refresh time, global auto-refresh state, and per-account auto-refresh timers.

## Security Boundary

- React never receives or renders tokens.
- Errors and events must not include complete requests, responses, authorization codes, or credentials.
- `auth.json` is ignored by Git; test fixtures must use fake tokens.
- Atomic writes reduce the risk of file corruption after interruption, but they do not provide encryption.
- OAuth state and PKCE reduce the risk of forged callbacks and intercepted authorization codes.
