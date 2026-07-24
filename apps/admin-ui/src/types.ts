export type Role = string;
export type UserStatus = "active" | "disabled";
export type Permission = string;
export type MenuKey = "dashboard" | "myAccounts" | "users" | "roles" | "officialAccounts" | "announcement" | "emailTemplates" | "feedback" | "telemetry" | "audit" | "invitations" | "approvals";

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: Profile;
}

export interface Profile {
  id: string;
  email: string;
  role: Role;
  roleName?: string;
  permissions?: Permission[];
}

export interface RbacRole {
  code: string;
  name: string;
  description: string;
  system: boolean;
  permissions: Permission[];
  userCount: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface PermissionDefinition {
  code: Permission;
  group: string;
  name: string;
  description: string;
  system: boolean;
}

export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AnnouncementConfig {
  contentZh: string;
  contentEn: string;
  link: string;
  enabled: boolean;
  textColor: string;
  backgroundColor: string;
  scrollDurationSeconds: number;
  updatedAt?: string | null;
}

export interface AppNotification {
  id: string;
  titleZh: string;
  titleEn: string;
  contentZh: string;
  contentEn: string;
  link: string;
  linkLabelZh: string;
  linkLabelEn: string;
  enabled: boolean;
  publishedAt: string;
  updatedAt: string;
}

export type AppNotificationInput = Omit<AppNotification, "id" | "updatedAt">;

export interface EmailTemplateVariable {
  key: string;
  description: string;
  example: string;
}

export interface EmailTemplate {
  code: string;
  name: string;
  description: string;
  subject: string;
  body: string;
  mailServiceId?: string | null;
  variables: EmailTemplateVariable[];
  customized: boolean;
  updatedByEmail?: string | null;
  updatedAt?: string | null;
}

export interface MailServiceConfig {
  id: string | null;
  source: "default" | "custom";
  name: string;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  fromAddress: string;
  enabled: boolean;
  hasPassword: boolean;
  updatedByEmail?: string | null;
  updatedAt?: string | null;
}

export interface MailServiceInput {
  name: string;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password?: string;
  fromAddress: string;
  enabled: boolean;
}

export interface AnnouncementClickOverview {
  totalClicks: number;
  clicksLast30Days: number;
  platforms: Record<TelemetryPlatform, number>;
}

export interface AnnouncementClick {
  id: string;
  deviceId: string;
  platform: TelemetryPlatform;
  email?: string | null;
  link: string;
  announcementUpdatedAt?: string | null;
  createdAt: string;
}

export interface AnnouncementClickFilters {
  search?: string;
  platform?: TelemetryPlatform;
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

export type TelemetryPlatform = "windows" | "macos" | "linux" | "android" | "ios";

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
  appVersion?: string | null;
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

export interface DashboardOverview {
  range: {
    days: 7 | 30 | 90;
    startDate: string;
    endDate: string;
  };
  summary: {
    totalUsers: number;
    activeUsers: number;
    newUsers: number;
    totalInstallations: number;
    newInstallations: number;
    officialAccounts: number;
    boundOfficialAccounts: number;
    totalBindings: number;
    pendingFeedback: number;
    repliedFeedback: number;
    pendingApprovals: number;
  };
  trend: Array<{
    date: string;
    users: number;
    installations: number;
  }>;
  platforms: Array<{
    name: TelemetryPlatform;
    value: number;
  }>;
  accountPlans: Array<{
    name: string;
    value: number;
  }>;
  feedback: {
    pending: number;
    replied: number;
  };
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

export interface InvitationRegisteredUser {
  id: string;
  userId?: string | null;
  email: string;
  role: Role;
  giftedAccountCount: number;
  registeredAt: string;
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
