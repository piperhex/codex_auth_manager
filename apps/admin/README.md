# Codex Switch Backend

NestJS backend for Codex Switch cloud login, account and Provider synchronization, the read-only mobile summary, and administration.

## Stack

- NestJS + TypeORM
- PostgreSQL for users, refresh tokens, synchronized accounts and Providers, admin data, and the official account pool
- Redis for cached profiles, account lists, and Provider lists
- JWT dual token authentication
- Access tokens compatible with your existing Kong JWT plugin
- React + Ant Design management console at `/admin`

## Local Run

1. Copy `.env.example` to `.env`.
2. Start local dependencies with `docker compose up postgres redis`.
3. From the repository root, run `npm install`.
4. From the repository root, run `npm run dev:backend`.

The first registered account becomes an admin. For local development without Kong, configure the desktop app Settings cloud Base URL as `http://127.0.0.1:8080`.

The default Docker Compose file does not publish PostgreSQL, Redis, or the backend on host ports. In production, Kong should reach the backend through the external `kong-net` network at `http://codex-switch-backend:8080`. For local host debugging, add a temporary compose override with explicit `ports`.

PostgreSQL data is bind-mounted from `/srv/codex-switch/postgres` on the Linux host. Prepare the
directory before the first deployment:

```bash
sudo install -d -m 0750 /srv/codex-switch/postgres
```

The data remains in this directory after `docker compose down` or `docker compose down -v`.

If production uses `POSTGRES_DB_SYNCHRONIZE=false`, apply `sql/20260704-admin-management.sql`,
`sql/20260705-sync-last-modified.sql`, `sql/20260707-sync-providers.sql`,
`sql/20260714-system-account-pool.sql`, `sql/20260717-invitation-policies.sql`,
`sql/20260717-app-announcements.sql`, `sql/20260717-device-installations.sql`,
`sql/20260718-announcement-scroll-speed.sql`, `sql/20260718-user-feedback.sql`, and
`sql/20260718-dynamic-rbac.sql` before using
the expanded admin console, provider sync,
official account pool, reusable invitations, announcements, telemetry, and feedback management.
The RBAC migration must be applied before starting this version because application startup
synchronizes the permission catalog and protected system roles.

## Docker Troubleshooting

`password authentication failed for user "codex_switch"` means the backend password does not match the PostgreSQL user's current password. PostgreSQL only applies `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB` when the data directory is first initialized, so changing `.env` later does not update an existing database.

For a disposable database, stop the stack and move the existing data directory aside before
starting it again:

```bash
docker compose down
sudo mv /srv/codex-switch/postgres "/srv/codex-switch/postgres-backup-$(date +%Y%m%d-%H%M%S)"
sudo install -d -m 0750 /srv/codex-switch/postgres
docker compose up -d --build
```

For a database you need to keep, update the PostgreSQL user password inside the existing database instead of deleting the volume.

`This Redis server's default user does not require a password, but a password was supplied` means `REDIS_PASSWORD` is set for the backend while the Redis server was started without `--requirepass`. The bundled compose file starts Redis with `--requirepass` automatically when `REDIS_PASSWORD` is non-empty.

## Registration Email Verification

Every public or invitation-based registration requires a six-digit email verification code. Codes
are stored as hashes in Redis, expire after five minutes, and are consumed after one successful
verification. Requests for the same email are limited to once per minute, and five incorrect
attempts invalidate the current code.

Mailgun SMTP is supported with the following environment variables:

```dotenv
mail__transport=SMTP
mail__options__host=smtp.mailgun.org
mail__options__port=465
mail__options__secure=true
mail__options__auth__user=blog@chirp.onepiper.cloud
mail__options__auth__pass=replace-with-mailgun-smtp-password
mail__from="Codex Switch <noreply@blog.onepiper.cloud>"
```

The registration client first calls `POST /auth/register/code` with the email address, then sends
the received code as `verificationCode` when calling `POST /auth/register`.

## Existing Kong Integration

This backend does not run Kong. Deploy it as an upstream service behind your existing Kong gateway.

Generate independent secrets before configuring the backend:

```bash
export KONG_JWT_SECRET="$(openssl rand -hex 32)"
export JWT_REFRESH_SECRET="$(openssl rand -hex 32)"
```

Persist both exported values in the backend environment, set `KONG_JWT_KEY=codex-switch`,
and use the same `KONG_JWT_SECRET` for the Kong JWT credential.

Production startup fails if either secret is missing or still uses the development default.

The backend signs access tokens with `iss=KONG_JWT_KEY`. Kong's JWT plugin should use `key_claim_name=iss` and `claims_to_verify=exp`.

For DB-backed Kong, create or reuse a Consumer and JWT credential:

```bash
curl -s -X POST http://KONG_ADMIN:8001/consumers \
  --data username=codex-switch-client

curl -s -X POST http://KONG_ADMIN:8001/consumers/codex-switch-client/jwt \
  --data key=codex-switch \
  --data secret="$KONG_JWT_SECRET" \
  --data algorithm=HS256
```

Create routes so `/auth` and `/admin` remain public, while `/sync` and `/admin/api` are protected by the JWT plugin:

```bash
curl -s -X POST http://KONG_ADMIN:8001/services \
  --data name=codex-switch-backend \
  --data url=http://codex-switch-backend:8080

curl -s -X POST http://KONG_ADMIN:8001/services/codex-switch-backend/routes \
  --data name=codex-switch-public \
  --data 'paths[]=/auth' \
  --data 'paths[]=/admin' \
  --data 'paths[]=/feedback' \
  --data strip_path=false

curl -s -X POST http://KONG_ADMIN:8001/services/codex-switch-backend/routes \
  --data name=codex-switch-protected \
  --data 'paths[]=/sync' \
  --data 'paths[]=/admin/api' \
  --data strip_path=false

curl -s -X POST http://KONG_ADMIN:8001/routes/codex-switch-protected/plugins \
  --data name=jwt \
  --data config.key_claim_name=iss \
  --data 'config.claims_to_verify[]=exp'
```

If your Kong is declarative or DB-less, adapt `kong/existing-kong.example.yml` into your existing config.

In production, configure the desktop app Settings cloud Base URL to the public Kong route, for example `https://api.example.com`.

## Credential and Official Account Handling

Desktop synchronization uploads complete account `auth` payloads and Provider API keys. The backend stores them in PostgreSQL so server access, database backups, admin access, and operational tooling are part of the credential trust boundary. Use HTTPS at the public gateway, restrict PostgreSQL and Redis to private networks, and never copy production payloads into logs or test fixtures.

The mobile client uses `GET /sync/accounts/summary`, which removes `auth` from every account. It reads the latest data synchronized by a desktop client and does not contact Codex APIs itself.

Admins can add credentials to the official account pool and bind one or more pool entries to users. The admin console accepts a selected file or pasted content for both standard `auth.json` and compatible imports. Compatible import supports a single object, an array, an `accounts` wrapper, newline-delimited JSON, common token aliases, and nested session exports. Bound entries are merged into the user's effective `/sync/accounts` list. A bound official entry wins over a personal entry with the same stable sync ID; user-side updates and deletes do not modify the official copy. Edit, unbind, or delete those entries through the official-account admin APIs. All pool mutations and binding changes are written to the admin audit log.

The admin console can also add an official account through Codex OAuth. It uses the official device authorization flow because the Codex CLI browser flow only permits its localhost callback ports. The one-time OAuth session is scoped to the authenticated administrator, stored in Redis for 15 minutes, and never exposes exchanged tokens to the browser. Keep `CODEX_OAUTH_ISSUER` at its default unless you operate a compatible trusted authorization service.

## RBAC

Every management and synchronization endpoint is protected by an explicit permission in addition to JWT authentication. Roles and role-permission assignments are stored in PostgreSQL and permissions are derived from the user's current database role on every request, so changing or disabling a user takes effect without trusting stale role claims from an access token.

The built-in `user` role provides self-service access and can be edited without being deleted. The protected `admin` role receives every built-in and custom permission. Administrators can create additional roles, create or edit custom permission definitions for external systems, and assign permissions with the searchable multi-select on the **Roles & Permissions** page. Core `admin.*` and `self.*` definitions remain application-owned and read-only because each one corresponds to an enforced backend capability; custom permission codes are immutable after creation so integrations can safely persist them.

Ordinary users can sign in to `/admin`, see only the **My Accounts** page, open their profile, and change their own password. `GET /admin/api/profile/accounts` returns account display data without any `auth` credentials. Menu filtering is only a user-interface aid; backend permission guards remain authoritative.

The public `/admin/reset-password` page resets a forgotten password with a single-use six-digit email code that expires after five minutes. A successful reset revokes all active refresh tokens for that user. The code request response does not reveal whether the supplied email belongs to an account.

Invitations can optionally target one email, allow a configurable number of successful
registrations, and either expire after a configured number of hours or remain valid until their
usage limit is reached or an administrator revokes them. Invitation usage is counted atomically
with user creation so concurrent registrations cannot exceed the configured limit.

## API

- `POST /auth/register`
- `POST /auth/register/code`
- `POST /auth/password-reset/code`
- `POST /auth/password-reset`
- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout`
- `GET /auth/me`
- `POST /feedback`
- `POST /feedback/authenticated`
- `GET /sync/accounts`
- `GET /sync/accounts/summary`
- `PUT /sync/accounts`
- `PUT /sync/accounts/:id`
- `DELETE /sync/accounts/:id`
- `GET /sync/providers`
- `PUT /sync/providers`
- `PUT /sync/providers/:id`
- `DELETE /sync/providers/:id`
- `GET /admin`
- `GET /admin/reset-password`
- `GET /admin/api/users`
- `POST /admin/api/users`
- `PATCH /admin/api/users/:id`
- `DELETE /admin/api/users/:id`
- `PATCH /admin/api/profile/password`
- `GET /admin/api/profile/accounts`
- `GET /admin/api/users/:id/accounts`
- `POST /admin/api/users/:id/accounts/:accountId/add-to-pool`
- `GET /admin/api/users/:id/providers`
- `PATCH /admin/api/users/:id/accounts/:accountId`
- `DELETE /admin/api/users/:id/accounts/:accountId`
- `GET /admin/api/official-accounts`
- `POST /admin/api/official-accounts`
- `POST /admin/api/official-accounts/import`
- `POST /admin/api/official-accounts/oauth/start`
- `POST /admin/api/official-accounts/oauth/:sessionId/poll`
- `PATCH /admin/api/official-accounts/:id`
- `DELETE /admin/api/official-accounts/:id`
- `GET /admin/api/official-accounts/:id/bindings`
- `POST /admin/api/official-accounts/bind`
- `POST /admin/api/official-accounts/unbind`
- `GET /admin/api/audit-logs`
- `GET /admin/api/invitations`
- `POST /admin/api/invitations`
- `DELETE /admin/api/invitations/:id`
- `GET /admin/api/approvals`
- `POST /admin/api/approvals`
- `POST /admin/api/approvals/:id/review`
- `GET /admin/api/feedback`
- `GET /admin/api/feedback/:id`
- `GET /admin/api/feedback/:id/attachments/:attachmentId`
- `POST /admin/api/feedback/:id/email`

Kong JWT plugin validation uses the access token `iss` claim. Keep `KONG_JWT_KEY` and `KONG_JWT_SECRET` aligned with the JWT credential in your existing Kong.
