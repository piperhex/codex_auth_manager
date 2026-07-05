# Codex Switch Backend

NestJS backend for Codex Switch cloud login and account synchronization.

## Stack

- NestJS + TypeORM
- PostgreSQL for users, refresh tokens, and synced accounts
- Redis for cached profiles and account lists
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

If production uses `POSTGRES_DB_SYNCHRONIZE=false`, apply `sql/20260704-admin-management.sql` before using the expanded admin console.

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

## API

- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout`
- `GET /auth/me`
- `GET /sync/accounts`
- `PUT /sync/accounts`
- `PUT /sync/accounts/:id`
- `DELETE /sync/accounts/:id`
- `GET /admin`
- `GET /admin/api/users`
- `POST /admin/api/users`
- `PATCH /admin/api/users/:id`
- `DELETE /admin/api/users/:id`
- `PATCH /admin/api/profile/password`
- `GET /admin/api/users/:id/accounts`
- `PATCH /admin/api/users/:id/accounts/:accountId`
- `DELETE /admin/api/users/:id/accounts/:accountId`
- `GET /admin/api/audit-logs`
- `GET /admin/api/invitations`
- `POST /admin/api/invitations`
- `DELETE /admin/api/invitations/:id`
- `GET /admin/api/approvals`
- `POST /admin/api/approvals`
- `POST /admin/api/approvals/:id/review`

Kong JWT plugin validation uses the access token `iss` claim. Keep `KONG_JWT_KEY` and `KONG_JWT_SECRET` aligned with the JWT credential in your existing Kong.
