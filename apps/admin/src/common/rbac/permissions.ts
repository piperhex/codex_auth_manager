export enum Permission {
  SelfAccountsRead = 'self.accounts.read',
  SelfAccountsWrite = 'self.accounts.write',
  SelfProvidersRead = 'self.providers.read',
  SelfProvidersWrite = 'self.providers.write',
  SelfPasswordUpdate = 'self.password.update',
  UsersRead = 'admin.users.read',
  UsersManage = 'admin.users.manage',
  RolesRead = 'admin.roles.read',
  RolesManage = 'admin.roles.manage',
  PermissionsManage = 'admin.permissions.manage',
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

export interface PermissionDefinition {
  code: Permission;
  group: string;
  name: string;
  description: string;
}

export const PERMISSION_CATALOG: readonly PermissionDefinition[] = [
  { code: Permission.SelfAccountsRead, group: 'self-service', name: 'Read own accounts', description: 'View accounts assigned or synchronized to the current user.' },
  { code: Permission.SelfAccountsWrite, group: 'self-service', name: 'Manage own accounts', description: 'Update account metadata owned by the current user.' },
  { code: Permission.SelfProvidersRead, group: 'self-service', name: 'Read own providers', description: 'View providers synchronized by the current user.' },
  { code: Permission.SelfProvidersWrite, group: 'self-service', name: 'Manage own providers', description: 'Create, update, and delete providers owned by the current user.' },
  { code: Permission.SelfPasswordUpdate, group: 'self-service', name: 'Change own password', description: 'Change the current user password.' },
  { code: Permission.UsersRead, group: 'users', name: 'Read users', description: 'View users and their synchronized data.' },
  { code: Permission.UsersManage, group: 'users', name: 'Manage users', description: 'Create, update, disable, and delete users.' },
  { code: Permission.RolesRead, group: 'security', name: 'Read roles', description: 'View roles and the permission catalog.' },
  { code: Permission.RolesManage, group: 'security', name: 'Manage roles', description: 'Create, update, and delete custom roles.' },
  { code: Permission.PermissionsManage, group: 'security', name: 'Manage permissions', description: 'Create and edit custom permission definitions.' },
  { code: Permission.OfficialAccountsRead, group: 'official-accounts', name: 'Read official accounts', description: 'View the official account pool and its bindings.' },
  { code: Permission.OfficialAccountsManage, group: 'official-accounts', name: 'Manage official accounts', description: 'Create, update, delete, and bind official accounts.' },
  { code: Permission.AuditLogsRead, group: 'audit', name: 'Read audit logs', description: 'View administrative audit events.' },
  { code: Permission.InvitationsRead, group: 'invitations', name: 'Read invitations', description: 'View registration invitations.' },
  { code: Permission.InvitationsManage, group: 'invitations', name: 'Manage invitations', description: 'Create and revoke registration invitations.' },
  { code: Permission.ApprovalsRead, group: 'approvals', name: 'Read approvals', description: 'View administrator approval requests.' },
  { code: Permission.ApprovalsManage, group: 'approvals', name: 'Manage approvals', description: 'Create and review administrator approval requests.' },
  { code: Permission.AnnouncementsRead, group: 'content', name: 'Read announcements', description: 'View the application announcement configuration.' },
  { code: Permission.AnnouncementsManage, group: 'content', name: 'Manage announcements', description: 'Publish and update application announcements.' },
  { code: Permission.FeedbackRead, group: 'feedback', name: 'Read feedback', description: 'View feedback and its attachments.' },
  { code: Permission.FeedbackManage, group: 'feedback', name: 'Manage feedback', description: 'Reply to user feedback.' },
  { code: Permission.TelemetryRead, group: 'telemetry', name: 'Read telemetry', description: 'View installation and telemetry analytics.' },
] as const;

export const USER_ROLE_PERMISSIONS: readonly Permission[] = [
  Permission.SelfAccountsRead,
  Permission.SelfAccountsWrite,
  Permission.SelfProvidersRead,
  Permission.SelfProvidersWrite,
  Permission.SelfPasswordUpdate,
] as const;

export const SYSTEM_ROLE_CODES = {
  user: 'user',
  admin: 'admin',
} as const;

const PERMISSION_DEPENDENCIES: Partial<Record<Permission, readonly Permission[]>> = {
  [Permission.SelfAccountsWrite]: [Permission.SelfAccountsRead],
  [Permission.SelfProvidersWrite]: [Permission.SelfProvidersRead],
  [Permission.UsersManage]: [Permission.UsersRead, Permission.RolesRead],
  [Permission.RolesManage]: [Permission.RolesRead],
  [Permission.PermissionsManage]: [Permission.RolesRead],
  [Permission.OfficialAccountsManage]: [Permission.OfficialAccountsRead, Permission.UsersRead],
  [Permission.InvitationsManage]: [Permission.InvitationsRead, Permission.RolesRead],
  [Permission.ApprovalsManage]: [Permission.ApprovalsRead, Permission.UsersRead],
  [Permission.AnnouncementsManage]: [Permission.AnnouncementsRead],
  [Permission.FeedbackManage]: [Permission.FeedbackRead],
};

export function expandPermissionDependencies(permissions: readonly string[]): string[] {
  const expanded = new Set(permissions);
  const pending = [...permissions];
  while (pending.length) {
    const permission = pending.pop()!;
    for (const dependency of PERMISSION_DEPENDENCIES[permission as Permission] ?? []) {
      if (expanded.has(dependency)) continue;
      expanded.add(dependency);
      pending.push(dependency);
    }
  }
  return [...expanded];
}
