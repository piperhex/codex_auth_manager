CREATE TABLE IF NOT EXISTS admin_audit_logs (
  "id" uuid PRIMARY KEY,
  "actorId" uuid NULL,
  "actorEmail" varchar(160) NOT NULL DEFAULT '',
  "action" varchar(80) NOT NULL,
  "targetType" varchar(40) NOT NULL,
  "targetId" varchar(160) NULL,
  "targetEmail" varchar(160) NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "IDX_admin_audit_logs_createdAt" ON admin_audit_logs ("createdAt");
CREATE INDEX IF NOT EXISTS "IDX_admin_audit_logs_action" ON admin_audit_logs ("action");

CREATE TABLE IF NOT EXISTS admin_invitations (
  "id" uuid PRIMARY KEY,
  "email" varchar(160) NOT NULL,
  "role" varchar(20) NOT NULL DEFAULT 'user',
  "tokenHash" varchar(128) NOT NULL,
  "createdById" uuid NOT NULL,
  "createdByEmail" varchar(160) NOT NULL,
  "acceptedById" uuid NULL,
  "expiresAt" timestamptz NOT NULL,
  "acceptedAt" timestamptz NULL,
  "revokedAt" timestamptz NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "IDX_admin_invitations_email" ON admin_invitations ("email");
CREATE UNIQUE INDEX IF NOT EXISTS "IDX_admin_invitations_tokenHash" ON admin_invitations ("tokenHash");

CREATE TABLE IF NOT EXISTS admin_approval_requests (
  "id" uuid PRIMARY KEY,
  "type" varchar(60) NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'pending',
  "requestedById" uuid NOT NULL,
  "requestedByEmail" varchar(160) NOT NULL,
  "reviewedById" uuid NULL,
  "reviewedByEmail" varchar(160) NULL,
  "targetUserId" uuid NOT NULL,
  "targetEmail" varchar(160) NOT NULL,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "comment" text NOT NULL DEFAULT '',
  "reviewComment" text NOT NULL DEFAULT '',
  "reviewedAt" timestamptz NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "IDX_admin_approval_requests_status_createdAt"
  ON admin_approval_requests ("status", "createdAt");
CREATE INDEX IF NOT EXISTS "IDX_admin_approval_requests_targetUserId"
  ON admin_approval_requests ("targetUserId");
