ALTER TABLE "synced_accounts"
  ADD COLUMN IF NOT EXISTS "fieldModifiedAt" jsonb NOT NULL DEFAULT '{}'::jsonb;
