export type Role = "user" | "admin";
export type UserStatus = "active" | "disabled";
export type MenuKey = "users" | "audit" | "invitations" | "approvals";

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: Profile;
}

export interface Profile {
  id: string;
  email: string;
  role: Role;
}

export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
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
  auth: Record<string, unknown>;
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
  email: string;
  role: Role;
  createdByEmail: string;
  expiresAt: string;
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
