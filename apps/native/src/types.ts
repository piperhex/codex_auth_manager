export interface UsageWindow {
  usedPercent: number;
  remainingPercent: number;
  resetsAt?: number | null;
  windowMinutes?: number | null;
}

export interface UsageSummary {
  primary?: UsageWindow | null;
  secondary?: UsageWindow | null;
  fetchedAt?: string | null;
  error?: string | null;
}

export interface AccountSummary {
  id: string;
  email: string;
  note: string;
  expiresAt: string;
  plan: string;
  accountId?: string | null;
  active: boolean;
  usage: UsageSummary;
  lastModifiedAt?: string;
}

export interface UserProfile {
  id: string;
  email: string;
  role: string;
  roleName?: string;
  permissions?: string[];
}

export interface AuthSession {
  baseUrl: string;
  accessToken: string;
  refreshToken: string;
  email: string;
  profile?: UserProfile;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user?: UserProfile;
}

export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminDashboardOverview {
  range: { days: 7 | 30 | 90; startDate: string; endDate: string };
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
  trend: Array<{ date: string; users: number; installations: number }>;
  platforms: Array<{ name: string; value: number }>;
  accountPlans: Array<{ name: string; value: number }>;
  feedback: { pending: number; replied: number };
}

export interface AdminOfficialAccount {
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

export interface AdminInvitation {
  id: string;
  email?: string | null;
  role: string;
  createdByEmail: string;
  expiresAt?: string | null;
  maxUses: number;
  usedCount: number;
  acceptedAt?: string | null;
  revokedAt?: string | null;
  createdAt: string;
}

export interface InvitationRegisteredUser {
  id: string;
  userId?: string | null;
  email: string;
  role: string;
  giftedAccountCount: number;
  registeredAt: string;
}

export interface AdminFeedback {
  id: string;
  content: string;
  version: string;
  platform: string;
  email?: string | null;
  attachments: Array<{ id: string; fileName: string; mimeType: string; size: number }>;
  lastRepliedAt?: string | null;
  lastRepliedByEmail?: string | null;
  createdAt: string;
}

export interface AdminMailService {
  id: string | null;
  source: 'default' | 'custom';
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

export interface AdminUser {
  id: string;
  email: string;
  role: string;
  disabled: boolean;
  lastLoginAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface AdminRole {
  code: string;
  name: string;
  description: string;
  system: boolean;
  permissions: string[];
  userCount: number;
}
