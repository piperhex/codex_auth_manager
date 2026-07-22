ALTER TABLE "synced_accounts"
  ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz NULL;
