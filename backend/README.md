# Codex Switch Backend

NestJS backend for Codex Switch cloud login and account synchronization.

## Stack

- NestJS + TypeORM
- PostgreSQL for users, refresh tokens, and synced accounts
- Redis for cached profiles and account lists
- JWT dual token authentication
- Access tokens compatible with your existing Kong JWT plugin
- Built-in admin page at `/admin`

## Local Run

1. Copy `.env.example` to `.env`.
2. Start local dependencies with `docker compose up postgres redis`.
3. Run `npm install`.
4. Run `npm run dev`.

The first registered account becomes an admin. For local development without Kong, configure the desktop app Settings cloud Base URL as `http://127.0.0.1:8080`.

## Existing Kong Integration

This backend does not run Kong. Deploy it as an upstream service behind your existing Kong gateway.

Set these backend env values to match the JWT credential configured in Kong:

```env
KONG_JWT_KEY=codex-switch
KONG_JWT_SECRET=change-me-kong-jwt-secret
```

The backend signs access tokens with `iss=KONG_JWT_KEY`. Kong's JWT plugin should use `key_claim_name=iss` and `claims_to_verify=exp`.

For DB-backed Kong, create or reuse a Consumer and JWT credential:

```bash
curl -s -X POST http://KONG_ADMIN:8001/consumers \
  --data username=codex-switch-client

curl -s -X POST http://KONG_ADMIN:8001/consumers/codex-switch-client/jwt \
  --data key=codex-switch \
  --data secret=change-me-kong-jwt-secret \
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
- `GET /admin`

Kong JWT plugin validation uses the access token `iss` claim. Keep `KONG_JWT_KEY` and `KONG_JWT_SECRET` aligned with the JWT credential in your existing Kong.
