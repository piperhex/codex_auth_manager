export type Role = "user" | "admin";
export type UserStatus = "active" | "disabled";
export type Permission =
  | "self.accounts.read"
  | "self.accounts.write"
  | "self.providers.read"
  | "self.providers.write"
  | "self.password.update"
  | "admin.users.read"
  | "admin.users.manage"
  | "admin.official-accounts.read"
  | "admin.official-accounts.manage"
  | "admin.audit-logs.read"
  | "admin.invitations.read"
  | "admin.invitations.manage"
  | "admin.approvals.read"
  | "admin.approvals.manage"
  | "admin.announcements.read"
  | "admin.announcements.manage"
  | "admin.feedback.read"
  | "admin.feedback.manage"
  | "admin.telemetry.read";
export type MenuKey = "myAccounts" | "users" | "officialAccounts" | "announcement" | "feedback" | "telemetry" | "audit" | "invitations" | "approvals";

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: Profile;
}

export interface Profile {
  id: string;
  email: string;
  role: Role;
  permissions?: Permission[];
}

export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AnnouncementConfig {
  content: string;
  enabled: boolean;
  textColor: string;
  backgroundColor: string;
  scrollDurationSeconds: number;
  updatedAt?: string | null;
}

export interface FeedbackAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
}

export interface FeedbackRow {
  id: string;
  content: string;
  version: string;
  platform: string;
  email?: string | null;
  attachments: FeedbackAttachment[];
  lastRepliedAt?: string | null;
  lastRepliedByEmail?: string | null;
  createdAt: string;
}

export type TelemetryPlatform = "windows" | "macos" | "linux";

export interface TelemetryOverview {
  totalInstallations: number;
  installationsLast30Days: number;
  totalEvents: number;
  eventsLast30Days: number;
  platforms: Record<TelemetryPlatform, number>;
}

export interface DeviceInstallation {
  deviceId: string;
  platform: TelemetryPlatform;
  firstSeenAt: string;
}

export interface TelemetryEvent {
  id: string;
  deviceId: string;
  platform: TelemetryPlatform;
  eventType: "base_url_changed";
  createdAt: string;
}

export interface TelemetryFilters {
  search?: string;
  platform?: TelemetryPlatform;
}

export interface UserRow {
  id: string;
  email: string;
  role: Role;
  disabled: boolean;
  lastLoginAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface SyncAccount {
  id: string;
  email: string;
  note: string;
  expiresAt: string;
  plan: string;
  accountId?: string | null;
  active: boolean;
  usage: Record<string, unknown>;
  auth?: Record<string, unknown>;
  lastModifiedAt?: string;
  source?: "personal" | "system";
  systemAccountId?: string;
}

export interface SystemAccount {
  id: string;
  syncAccountId: string;
  email: string;
  note: string;
  expiresAt: string;
  plan: string;
  accountId?: string | null;
  usage: Record<string, unknown>;
  lastModifiedAt: string;
  boundUserCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SyncProvider {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  models: string[];
  modelSelectionControlledByCodex: boolean;
  apiFormat: "openaiResponses" | "openaiChat";
  lastModifiedAt?: string;
  hasApiKey: boolean;
}

export interface AuditLog {
  id: string;
  actorEmail: string;
  action: string;
  targetType: string;
  targetId?: string | null;
  targetEmail?: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface Invitation {
  id: string;
  email?: string | null;
  role: Role;
  createdByEmail: string;
  expiresAt?: string | null;
  maxUses: number;
  usedCount: number;
  acceptedAt?: string | null;
  revokedAt?: string | null;
  createdAt: string;
  token?: string;
}

export interface ApprovalRequest {
  id: string;
  type: "promote_user_to_admin";
  status: "pending" | "approved" | "rejected";
  requestedByEmail: string;
  reviewedByEmail?: string | null;
  targetUserId: string;
  targetEmail: string;
  comment: string;
  reviewComment: string;
  createdAt: string;
  reviewedAt?: string | null;
}

export interface UserFilters {
  search?: string;
  role?: Role;
  status?: UserStatus;
}

export type ApiClient = <T>(path: string, options?: RequestInit) => Promise<T>;
