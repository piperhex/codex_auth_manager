ALTER TABLE device_installations
  ADD COLUMN IF NOT EXISTS "appVersion" varchar(50);
