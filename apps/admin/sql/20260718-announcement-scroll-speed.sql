ALTER TABLE app_announcements
  ADD COLUMN IF NOT EXISTS "scrollDurationSeconds" integer NOT NULL DEFAULT 22;
