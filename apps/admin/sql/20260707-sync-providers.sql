CREATE TABLE IF NOT EXISTS synced_providers (
  "id" uuid PRIMARY KEY,
  "ownerId" uuid NOT NULL,
  "providerId" varchar(64) NOT NULL,
  "name" varchar(160) NOT NULL,
  "baseUrl" varchar(500) NOT NULL,
  "apiKey" text NOT NULL,
  "model" varchar(160) NOT NULL,
  "models" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "modelSelectionControlledByCodex" boolean NOT NULL DEFAULT false,
  "apiFormat" varchar(24) NOT NULL,
  "lastModifiedAt" timestamptz NOT NULL DEFAULT now(),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "FK_synced_providers_owner"
    FOREIGN KEY ("ownerId") REFERENCES users("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "IDX_synced_providers_owner_provider"
  ON synced_providers ("ownerId", "providerId");
