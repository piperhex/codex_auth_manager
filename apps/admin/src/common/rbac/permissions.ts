import type { AuthUser } from '@/common/decorators/user.decorator';

export enum Permission {
  SelfAccountsRead = 'self.accounts.read',
  SelfAccountsWrite = 'self.accounts.write',
  SelfProvidersRead = 'self.providers.read',
  SelfProvidersWrite = 'self.providers.write',
  SelfPasswordUpdate = 'self.password.update',
  UsersRead = 'admin.users.read',
  UsersManage = 'admin.users.manage',
  OfficialAccountsRead = 'admin.official-accounts.read',
  OfficialAccountsManage = 'admin.official-accounts.manage',
  AuditLogsRead = 'admin.audit-logs.read',
  InvitationsRead = 'admin.invitations.read',
  InvitationsManage = 'admin.invitations.manage',
  ApprovalsRead = 'admin.approvals.read',
  ApprovalsManage = 'admin.approvals.manage',
  AnnouncementsRead = 'admin.announcements.read',
  AnnouncementsManage = 'admin.announcements.manage',
  FeedbackRead = 'admin.feedback.read',
  FeedbackManage = 'admin.feedback.manage',
  TelemetryRead = 'admin.telemetry.read',
}

const userPermissions = [
  Permission.SelfAccountsRead,
  Permission.SelfAccountsWrite,
  Permission.SelfProvidersRead,
  Permission.SelfProvidersWrite,
  Permission.SelfPasswordUpdate,
] as const;

const rolePermissions: Record<AuthUser['role'], ReadonlySet<Permission>> = {
  user: new Set(userPermissions),
  admin: new Set(Object.values(Permission)),
};

export function permissionsForRole(role: AuthUser['role']): Permission[] {
  return [...(rolePermissions[role] ?? [])];
}

export function roleHasPermissions(role: AuthUser['role'], required: Permission[]): boolean {
  const granted = rolePermissions[role];
  return Boolean(granted) && required.every((permission) => granted.has(permission));
}
