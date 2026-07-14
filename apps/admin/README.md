# Codex Switch Backend

NestJS backend for Codex Switch cloud login, account and Provider synchronization, the read-only mobile summary, and administration.

## Stack

- NestJS + TypeORM
- PostgreSQL for users, refresh tokens, synchronized accounts and Providers, admin data, and the official account pool
- Redis for cached profiles, account lists, and Provider lists
- JWT dual token authentication
- Access tokens compatible with your existing Kong JWT plugin
- React + Ant Design admin console at `/admin`

## Local Run

1. Copy `.env.example` to `.env`.
2. Start local dependencies with `docker compose up postgres redis`.
3. From the repository root, run `npm install`.
4. From the repository root, run `npm run dev:backend`.

The first registered account becomes an admin. For local development without Kong, configure the desktop app Settings cloud Base URL as `http://127.0.0.1:8080`.

The default Docker Compose file does not publish PostgreSQL, Redis, or the backend on host ports. In production, Kong should reach the backend through the external `kong-net` network at `http://codex-switch-backend:8080`. For local host debugging, add a temporary compose override with explicit `ports`.

If production uses `POSTGRES_DB_SYNCHRONIZE=false`, apply `sql/20260704-admin-management.sql`,
`sql/20260705-sync-last-modified.sql`, `sql/20260707-sync-providers.sql`, and
`sql/20260714-system-account-pool.sql` before using the expanded admin console, provider sync,
and official account pool.

## Docker Troubleshooting

`password authentication failed for user "codex_switch"` means the backend password does not match the PostgreSQL user's current password. PostgreSQL only applies `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB` when the data volume is first initialized, so changing `.env` later does not update an existing `codex-switch-postgres` volume.

For a disposable local database, recreate the volume:

```bash
docker compose down -v
docker compose up -d --build
```

For a database you need to keep, update the PostgreSQL user password inside the existing database instead of deleting the volume.

`This Redis server's default user does not require a password, but a password was supplied` means `REDIS_PASSWORD` is set for the backend while the Redis server was started without `--requirepass`. The bundled compose file starts Redis with `--requirepass` automatically when `REDIS_PASSWORD` is non-empty.

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

Admins can add credentials to the official account pool and bind one or more pool entries to users. Bound entries are merged into the user's effective `/sync/accounts` list. A bound official entry wins over a personal entry with the same stable sync ID; user-side updates and deletes do not modify the official copy. Edit, unbind, or delete those entries through the official-account admin APIs. All pool mutations and binding changes are written to the admin audit log.

## API

- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout`
- `GET /auth/me`
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
- `GET /admin/api/users`
- `POST /admin/api/users`
- `PATCH /admin/api/users/:id`
- `DELETE /admin/api/users/:id`
- `PATCH /admin/api/profile/password`
- `GET /admin/api/users/:id/accounts`
- `GET /admin/api/users/:id/providers`
- `PATCH /admin/api/users/:id/accounts/:accountId`
- `DELETE /admin/api/users/:id/accounts/:accountId`
- `GET /admin/api/official-accounts`
- `POST /admin/api/official-accounts`
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

Kong JWT plugin validation uses the access token `iss` claim. Keep `KONG_JWT_KEY` and `KONG_JWT_SECRET` aligned with the JWT credential in your existing Kong.
