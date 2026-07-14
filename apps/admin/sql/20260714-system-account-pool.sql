CREATE TABLE IF NOT EXISTS system_accounts (
  "id" uuid PRIMARY KEY,
  "syncAccountId" varchar(64) NOT NULL,
  "email" varchar(240) NOT NULL,
  "note" text NOT NULL DEFAULT '',
  "expiresAt" varchar(40) NOT NULL DEFAULT '',
  "plan" varchar(80) NOT NULL DEFAULT 'ChatGPT',
  "codexAccountId" varchar(160) NULL,
  "usage" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "auth" jsonb NOT NULL,
  "lastModifiedAt" timestamptz NOT NULL DEFAULT now(),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "IDX_system_accounts_syncAccountId"
  ON system_accounts ("syncAccountId");

CREATE TABLE IF NOT EXISTS system_account_bindings (
  "systemAccountId" uuid NOT NULL,
  "userId" uuid NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "PK_system_account_bindings" PRIMARY KEY ("systemAccountId", "userId"),
  CONSTRAINT "FK_system_account_bindings_account"
    FOREIGN KEY ("systemAccountId") REFERENCES system_accounts ("id") ON DELETE CASCADE,
  CONSTRAINT "FK_system_account_bindings_user"
    FOREIGN KEY ("userId") REFERENCES users ("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "IDX_system_account_bindings_userId"
  ON system_account_bindings ("userId");
