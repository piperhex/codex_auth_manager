CREATE TABLE IF NOT EXISTS device_installations (
  "deviceId" uuid PRIMARY KEY,
  "platform" varchar(20) NOT NULL,
  "appVersion" varchar(50),
  "firstSeenAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS device_telemetry_events (
  "id" uuid PRIMARY KEY,
  "deviceId" uuid NOT NULL,
  "platform" varchar(20) NOT NULL,
  "eventType" varchar(40) NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "IDX_device_installations_firstSeenAt"
  ON device_installations ("firstSeenAt" DESC);
CREATE INDEX IF NOT EXISTS "IDX_device_installations_platform_firstSeenAt"
  ON device_installations ("platform", "firstSeenAt" DESC);

CREATE INDEX IF NOT EXISTS "IDX_device_telemetry_events_deviceId_createdAt"
  ON device_telemetry_events ("deviceId", "createdAt");
CREATE INDEX IF NOT EXISTS "IDX_device_telemetry_events_eventType_createdAt"
  ON device_telemetry_events ("eventType", "createdAt");
