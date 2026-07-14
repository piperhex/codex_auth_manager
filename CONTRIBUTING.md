# Contributing

Thank you for improving Codex Switch. Because the project handles login credentials, security and reviewability take priority over implementation speed.

## Getting Started

1. Search existing issues to avoid duplicates.
2. Open an issue before implementing a large feature or architectural change. Describe the goal, user value, and security impact.
3. Create a short-lived branch from the latest main branch.
4. Keep commits focused and use Conventional Commits, such as `feat: add account import` or `fix(auth): handle expired token`.
5. Run `npm run check` before opening a pull request.

## Code Guidelines

- Frontend pages and components must not call `invoke` directly. Keep all IPC in `apps/desktop/src/api/backend.ts`.
- Put business state in hooks, presentation logic in components, and pure formatting helpers in `utils`.
- Tauri commands should only define the input boundary and orchestrate use cases. Authentication, storage, and HTTP logic belong in their respective Rust modules.
- IPC models must expose only the fields required by the UI. Never add tokens or complete backend responses.
- Prefer small functions, explicit names, and pure parsing logic that can be tested independently.
- Store user-facing text and documentation as UTF-8. Do not commit editor-specific configuration.

## Security Requirements

- Never commit a real `auth.json`, JWT, cookie, account screenshot, or API response.
- Test tokens must be unusable fake values, and their payloads must not contain real identities.
- Logs, errors, and debug output must not contain access tokens, refresh tokens, or authorization codes.
- Pull requests that change credential persistence, OAuth, file permissions, or network endpoints must describe the threat model and validation performed.
- Do not post exploitable vulnerability details in a public issue. Contact the maintainers first to establish a private reporting channel.

## Tests and Checks

```powershell
npm run check
```

This command checks the desktop frontend, admin console, backend types and tests, mobile TypeScript, Rust formatting, and Rust tests. UI changes should also be tested in both browser-preview and desktop modes. Account-switching, Provider, and local-proxy changes must be tested with a temporary `CODEX_HOME`.

Recommended minimum coverage:

- Frontend components: empty, loading, error, active-account, and busy states
- Storage: missing target directory, invalid JSON, and atomic replacement failures
- Authentication: missing fields, malformed JWTs, and different account IDs
- Network: success, refresh after `401`, unsuccessful status codes, and invalid responses
- Provider/proxy: direct and hot switching, Responses and Chat Completions formats, config restoration, and structured diagnostics that omit request content and credentials
- Cloud sync: first-login merge, last-modified conflict handling, full desktop payloads, and redacted mobile summaries
- Database entities: synchronized-schema coverage plus a dated SQL migration for deployments with `POSTGRES_DB_SYNCHRONIZE=false`

## Commit Messages

Commit messages are linted with commitlint and Husky after `npm install`. Use the Conventional Commits format:

```text
type(scope): short imperative summary
```

The scope is optional. Common types include `feat`, `fix`, `docs`, `refactor`, `test`, `build`, `ci`, and `chore`.

## Pull Request Description

Include the following information:

- What changed and why
- Any impact on credentials, security boundaries, or data locations
- Automated checks and manual verification performed
- Screenshots or recordings for UI changes, with all real account information removed
- Known limitations or follow-up work

## Documentation

Update `README.md`, `docs/`, or this guide whenever behavior, data locations, commands, architecture boundaries, or the contribution workflow changes. Documentation is part of the feature and should not be deferred until after merge.
