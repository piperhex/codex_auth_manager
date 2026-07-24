CREATE TABLE IF NOT EXISTS app_notifications (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "titleZh" varchar(160) NOT NULL,
  "titleEn" varchar(160) NOT NULL,
  "contentZh" text NOT NULL,
  "contentEn" text NOT NULL,
  "link" varchar(2048) NOT NULL DEFAULT '',
  "linkLabelZh" varchar(80) NOT NULL DEFAULT '',
  "linkLabelEn" varchar(80) NOT NULL DEFAULT '',
  "enabled" boolean NOT NULL DEFAULT true,
  "publishedAt" timestamptz NOT NULL,
  "updatedById" uuid NULL,
  "updatedByEmail" varchar(160) NOT NULL DEFAULT '',
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS app_notifications_recent_idx
  ON app_notifications ("enabled", "publishedAt" DESC);
