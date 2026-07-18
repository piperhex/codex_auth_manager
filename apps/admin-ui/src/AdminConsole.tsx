import { useCallback, useEffect, useState } from "react";
import { App as AntApp } from "antd";
import { AccountDrawer } from "./components/accounts/AccountDrawer";
import { AccountEditModal } from "./components/accounts/AccountEditModal";
import { BatchBindSystemAccountsModal } from "./components/accounts/BatchBindSystemAccountsModal";
import { OwnAccountEditModal } from "./components/accounts/OwnAccountEditModal";
import { SystemAccountBindingModal } from "./components/accounts/SystemAccountBindingModal";
import { SystemAccountModal } from "./components/accounts/SystemAccountModal";
import { SystemAccountOAuthModal } from "./components/accounts/SystemAccountOAuthModal";
import { AdminShell } from "./components/layout/AdminShell";
import { ApprovalModal } from "./components/modals/ApprovalModal";
import { InvitationModal } from "./components/modals/InvitationModal";
import { PasswordResetModal } from "./components/modals/PasswordResetModal";
import { ProfileModal } from "./components/modals/ProfileModal";
import { ProfilePasswordModal } from "./components/modals/ProfilePasswordModal";
import { PermissionModal } from "./components/modals/PermissionModal";
import { UserModal } from "./components/modals/UserModal";
import { RoleModal } from "./components/modals/RoleModal";
import { LoginView } from "./components/LoginView";
import { useAuthenticatedApi } from "./hooks/useAuthenticatedApi";
import { ApprovalsPage } from "./pages/ApprovalsPage";
import { AnnouncementPage } from "./pages/AnnouncementPage";
import { AuditLogsPage } from "./pages/AuditLogsPage";
import { FeedbackPage } from "./pages/FeedbackPage";
import { InvitationsPage } from "./pages/InvitationsPage";
import { MyAccountsPage } from "./pages/MyAccountsPage";
import { OfficialAccountsPage } from "./pages/OfficialAccountsPage";
import { TelemetryPage } from "./pages/TelemetryPage";
import { UsersPage } from "./pages/UsersPage";
import { RolesPage } from "./pages/RolesPage";
import type {
  ApprovalRequest,
  AnnouncementConfig,
  AuditLog,
  AuthTokens,
  Invitation,
  FeedbackRow,
  DeviceInstallation,
  MenuKey,
  PageResult,
  Permission,
  PermissionDefinition,
  Profile,
  RbacRole,
  SyncAccount,
  SyncProvider,
  SystemAccount,
  TelemetryEvent,
  TelemetryFilters,
  TelemetryOverview,
  UserFilters,
  UserRow,
} from "./types";
import { useI18n } from "./i18n-context";
import { loadStoredAuth, persistAuth } from "./utils/storage";

interface AdminConsoleProps {
  dark: boolean;
  onThemeChange: (value: boolean) => void;
}

const emptyUsers: PageResult<UserRow> = { items: [], total: 0, page: 1, pageSize: 20 };
const emptyAuditLogs: PageResult<AuditLog> = { items: [], total: 0, page: 1, pageSize: 20 };
const emptyInvitations: PageResult<Invitation> = { items: [], total: 0, page: 1, pageSize: 20 };
const emptyApprovals: PageResult<ApprovalRequest> = { items: [], total: 0, page: 1, pageSize: 20 };
const emptyFeedback: PageResult<FeedbackRow> = { items: [], total: 0, page: 1, pageSize: 20 };
const emptyInstallations: PageResult<DeviceInstallation> = { items: [], total: 0, page: 1, pageSize: 20 };
const emptyTelemetryEvents: PageResult<TelemetryEvent> = { items: [], total: 0, page: 1, pageSize: 20 };
const emptySystemAccounts: PageResult<SystemAccount> = { items: [], total: 0, page: 1, pageSize: 20 };
const emptyTelemetryOverview: TelemetryOverview = {
  totalInstallations: 0,
  installationsLast30Days: 0,
  totalEvents: 0,
  eventsLast30Days: 0,
  platforms: { windows: 0, macos: 0, linux: 0 },
};
const emptyAnnouncement: AnnouncementConfig = {
  contentZh: "",
  contentEn: "",
  link: "",
  enabled: false,
  textColor: "#C4D7C8",
  backgroundColor: "#203128",
  scrollDurationSeconds: 22,
  updatedAt: null,
};

const menuPermissions: Record<MenuKey, Permission> = {
  myAccounts: "self.accounts.read",
  users: "admin.users.read",
  roles: "admin.roles.read",
  officialAccounts: "admin.official-accounts.read",
  announcement: "admin.announcements.read",
  feedback: "admin.feedback.read",
  telemetry: "admin.telemetry.read",
  audit: "admin.audit-logs.read",
  invitations: "admin.invitations.read",
  approvals: "admin.approvals.read",
};

const menuOrder: MenuKey[] = [
  "users",
  "roles",
  "myAccounts",
  "officialAccounts",
  "announcement",
  "feedback",
  "telemetry",
  "audit",
  "invitations",
  "approvals",
];

function firstAccessibleMenu(profile: Profile | null | undefined): MenuKey {
  const permissions = new Set(profile?.permissions ?? []);
  return menuOrder.find((key) => permissions.has(menuPermissions[key])) ?? "myAccounts";
}

export function AdminConsole({ dark, onThemeChange }: AdminConsoleProps) {
  const { message, modal } = AntApp.useApp();
  const { t } = useI18n();
  const [auth, setAuth] = useState<AuthTokens | null>(() => loadStoredAuth());
  const [profile, setProfile] = useState<Profile | null>(auth?.user ?? null);
  const [activeKey, setActiveKey] = useState<MenuKey>(() => firstAccessibleMenu(auth?.user));
  const [ownAccounts, setOwnAccounts] = useState<SyncAccount[]>([]);
  const [ownAccountsLoading, setOwnAccountsLoading] = useState(false);
  const [editingOwnAccount, setEditingOwnAccount] = useState<SyncAccount | null>(null);
  const [users, setUsers] = useState<PageResult<UserRow>>(emptyUsers);
  const [userFilters, setUserFilters] = useState<UserFilters>({});
  const [usersLoading, setUsersLoading] = useState(false);
  const [systemAccounts, setSystemAccounts] = useState<PageResult<SystemAccount>>(emptySystemAccounts);
  const [systemAccountSearch, setSystemAccountSearch] = useState("");
  const [systemAccountsLoading, setSystemAccountsLoading] = useState(false);
  const [auditLogs, setAuditLogs] = useState<PageResult<AuditLog>>(emptyAuditLogs);
  const [auditSearch, setAuditSearch] = useState("");
  const [auditLoading, setAuditLoading] = useState(false);
  const [feedback, setFeedback] = useState<PageResult<FeedbackRow>>(emptyFeedback);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [telemetryOverview, setTelemetryOverview] = useState<TelemetryOverview>(emptyTelemetryOverview);
  const [telemetryOverviewLoading, setTelemetryOverviewLoading] = useState(false);
  const [installations, setInstallations] = useState<PageResult<DeviceInstallation>>(emptyInstallations);
  const [installationsLoading, setInstallationsLoading] = useState(false);
  const [installationFilters, setInstallationFilters] = useState<TelemetryFilters>({});
  const [telemetryEvents, setTelemetryEvents] = useState<PageResult<TelemetryEvent>>(emptyTelemetryEvents);
  const [telemetryEventsLoading, setTelemetryEventsLoading] = useState(false);
  const [telemetryEventFilters, setTelemetryEventFilters] = useState<TelemetryFilters>({});
  const [invitations, setInvitations] = useState<PageResult<Invitation>>(emptyInvitations);
  const [invitationLoading, setInvitationLoading] = useState(false);
  const [approvals, setApprovals] = useState<PageResult<ApprovalRequest>>(emptyApprovals);
  const [approvalLoading, setApprovalLoading] = useState(false);
  const [announcement, setAnnouncement] = useState<AnnouncementConfig>(emptyAnnouncement);
  const [announcementLoading, setAnnouncementLoading] = useState(false);
  const [announcementSaving, setAnnouncementSaving] = useState(false);
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);
  const [passwordUser, setPasswordUser] = useState<UserRow | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [accountUser, setAccountUser] = useState<UserRow | null>(null);
  const [accounts, setAccounts] = useState<SyncAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [providers, setProviders] = useState<SyncProvider[]>([]);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [editingAccount, setEditingAccount] = useState<SyncAccount | null>(null);
  const [systemAccountModalOpen, setSystemAccountModalOpen] = useState(false);
  const [systemAccountCompatibleImport, setSystemAccountCompatibleImport] = useState(false);
  const [systemAccountOAuthOpen, setSystemAccountOAuthOpen] = useState(false);
  const [editingSystemAccount, setEditingSystemAccount] = useState<SystemAccount | null>(null);
  const [bindingSystemAccount, setBindingSystemAccount] = useState<SystemAccount | null>(null);
  const [bindingUsers, setBindingUsers] = useState<UserRow[]>([]);
  const [boundUserIds, setBoundUserIds] = useState<string[]>([]);
  const [bindingsLoading, setBindingsLoading] = useState(false);
  const [batchBindingUsers, setBatchBindingUsers] = useState<UserRow[]>([]);
  const [batchBindingAccounts, setBatchBindingAccounts] = useState<SystemAccount[]>([]);
  const [batchBindingsLoading, setBatchBindingsLoading] = useState(false);
  const [invitationOpen, setInvitationOpen] = useState(false);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [approvalUsers, setApprovalUsers] = useState<UserRow[]>([]);
  const [approvalTargetUserId, setApprovalTargetUserId] = useState<string | null>(null);
  const [roles, setRoles] = useState<RbacRole[]>([]);
  const [permissionCatalog, setPermissionCatalog] = useState<PermissionDefinition[]>([]);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [roleModalOpen, setRoleModalOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<RbacRole | null>(null);
  const [permissionModalOpen, setPermissionModalOpen] = useState(false);
  const [editingPermission, setEditingPermission] = useState<PermissionDefinition | null>(null);

  const saveAuth = useCallback((next: AuthTokens | null) => {
    setAuth(next);
    setProfile(next?.user ?? null);
    if (next) setActiveKey(firstAccessibleMenu(next.user));
    persistAuth(next);
  }, []);

  const { api, apiBlob, signOut } = useAuthenticatedApi(auth, saveAuth, t);

  const loadProfile = useCallback(async () => {
    if (!auth?.accessToken) return;
    try {
      const data = await api<Profile>("/auth/me");
      setProfile(data);
      setActiveKey((current) => (
        data.permissions?.includes(menuPermissions[current]) ? current : firstAccessibleMenu(data)
      ));
    } catch (error) {
      message.error((error as Error).message);
      await signOut();
    }
  }, [api, auth?.accessToken, message, signOut]);

  const loadRbac = useCallback(async () => {
    setRolesLoading(true);
    try {
      const [nextRoles, nextPermissions] = await Promise.all([
        api<RbacRole[]>("/admin/api/roles"),
        api<PermissionDefinition[]>("/admin/api/permissions"),
      ]);
      setRoles(nextRoles);
      setPermissionCatalog(nextPermissions);
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setRolesLoading(false);
    }
  }, [api, message]);

  const loadOwnAccounts = useCallback(async () => {
    setOwnAccountsLoading(true);
    try {
      const data = await api<{ accounts: SyncAccount[] }>("/admin/api/profile/accounts");
      setOwnAccounts(data.accounts);
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setOwnAccountsLoading(false);
    }
  }, [api, message]);

  const loadUsers = useCallback(async (page = users.page, pageSize = users.pageSize) => {
    setUsersLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (userFilters.search) params.set("search", userFilters.search);
      if (userFilters.role) params.set("role", userFilters.role);
      if (userFilters.status) params.set("status", userFilters.status);
      setUsers(await api<PageResult<UserRow>>(`/admin/api/users?${params}`));
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setUsersLoading(false);
    }
  }, [api, message, userFilters, users.page, users.pageSize]);

  const loadAuditLogs = useCallback(async (page = auditLogs.page, pageSize = auditLogs.pageSize) => {
    setAuditLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (auditSearch.trim()) params.set("search", auditSearch.trim());
      setAuditLogs(await api<PageResult<AuditLog>>(`/admin/api/audit-logs?${params}`));
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setAuditLoading(false);
    }
  }, [api, auditLogs.page, auditLogs.pageSize, auditSearch, message]);

  const loadFeedback = useCallback(async (page = feedback.page, pageSize = feedback.pageSize) => {
    setFeedbackLoading(true);
    try {
      setFeedback(await api<PageResult<FeedbackRow>>(`/admin/api/feedback?page=${page}&pageSize=${pageSize}`));
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setFeedbackLoading(false);
    }
  }, [api, feedback.page, feedback.pageSize, message]);

  const loadFeedbackAttachment = useCallback(async (feedbackId: string, attachmentId: string) => {
    const blob = await apiBlob(`/admin/api/feedback/${feedbackId}/attachments/${attachmentId}`);
    return URL.createObjectURL(blob);
  }, [apiBlob]);

  const sendFeedbackEmail = useCallback(async (feedbackId: string, subject: string, content: string) => {
    try {
      await api(`/admin/api/feedback/${feedbackId}/email`, {
        method: "POST",
        body: JSON.stringify({ subject, content }),
      });
      message.success(t("feedback.emailSent"));
      await loadFeedback();
    } catch (error) {
      message.error((error as Error).message);
      throw error;
    }
  }, [api, loadFeedback, message, t]);

  const loadTelemetryOverview = useCallback(async () => {
    setTelemetryOverviewLoading(true);
    try {
      setTelemetryOverview(await api<TelemetryOverview>("/admin/api/telemetry/overview"));
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setTelemetryOverviewLoading(false);
    }
  }, [api, message]);

  const loadInstallations = useCallback(async (
    page = installations.page,
    pageSize = installations.pageSize,
  ) => {
    setInstallationsLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (installationFilters.search?.trim()) params.set("search", installationFilters.search.trim());
      if (installationFilters.platform) params.set("platform", installationFilters.platform);
      setInstallations(await api<PageResult<DeviceInstallation>>(
        `/admin/api/telemetry/installations?${params}`,
      ));
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setInstallationsLoading(false);
    }
  }, [api, installationFilters, installations.page, installations.pageSize, message]);

  const loadTelemetryEvents = useCallback(async (
    page = telemetryEvents.page,
    pageSize = telemetryEvents.pageSize,
  ) => {
    setTelemetryEventsLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (telemetryEventFilters.search?.trim()) params.set("search", telemetryEventFilters.search.trim());
      if (telemetryEventFilters.platform) params.set("platform", telemetryEventFilters.platform);
      setTelemetryEvents(await api<PageResult<TelemetryEvent>>(
        `/admin/api/telemetry/events?${params}`,
      ));
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setTelemetryEventsLoading(false);
    }
  }, [api, message, telemetryEventFilters, telemetryEvents.page, telemetryEvents.pageSize]);

  const loadSystemAccounts = useCallback(async (
    page = systemAccounts.page,
    pageSize = systemAccounts.pageSize,
  ) => {
    setSystemAccountsLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (systemAccountSearch.trim()) params.set("search", systemAccountSearch.trim());
      setSystemAccounts(await api<PageResult<SystemAccount>>(`/admin/api/official-accounts?${params}`));
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setSystemAccountsLoading(false);
    }
  }, [api, message, systemAccountSearch, systemAccounts.page, systemAccounts.pageSize]);

  const loadInvitations = useCallback(async (page = invitations.page, pageSize = invitations.pageSize) => {
    setInvitationLoading(true);
    try {
      setInvitations(await api<PageResult<Invitation>>(`/admin/api/invitations?page=${page}&pageSize=${pageSize}`));
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setInvitationLoading(false);
    }
  }, [api, invitations.page, invitations.pageSize, message]);

  const loadApprovals = useCallback(async (page = approvals.page, pageSize = approvals.pageSize) => {
    setApprovalLoading(true);
    try {
      setApprovals(await api<PageResult<ApprovalRequest>>(`/admin/api/approvals?page=${page}&pageSize=${pageSize}`));
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setApprovalLoading(false);
    }
  }, [api, approvals.page, approvals.pageSize, message]);

  const loadAnnouncement = useCallback(async () => {
    setAnnouncementLoading(true);
    try {
      setAnnouncement(await api<AnnouncementConfig>("/admin/api/announcement"));
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setAnnouncementLoading(false);
    }
  }, [api, message]);

  const saveAnnouncement = useCallback(async (
    next: Pick<
      AnnouncementConfig,
      "contentZh" | "contentEn" | "link" | "enabled" | "textColor"
      | "backgroundColor" | "scrollDurationSeconds"
    >,
  ) => {
    setAnnouncementSaving(true);
    try {
      const saved = await api<AnnouncementConfig>("/admin/api/announcement", {
        method: "PATCH",
        body: JSON.stringify(next),
      });
      setAnnouncement(saved);
      message.success(t("announcement.saved"));
    } catch (error) {
      message.error((error as Error).message);
      throw error;
    } finally {
      setAnnouncementSaving(false);
    }
  }, [api, message, t]);

  const loadAccounts = useCallback(async (user: UserRow) => {
    setAccountsLoading(true);
    try {
      const data = await api<{ accounts: SyncAccount[] }>(`/admin/api/users/${user.id}/accounts`);
      setAccounts(data.accounts);
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setAccountsLoading(false);
    }
  }, [api, message]);

  const loadProviders = useCallback(async (user: UserRow) => {
    setProvidersLoading(true);
    try {
      const data = await api<{ providers: SyncProvider[] }>(`/admin/api/users/${user.id}/providers`);
      setProviders(data.providers);
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setProvidersLoading(false);
    }
  }, [api, message]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    if (!auth?.accessToken || !profile?.permissions?.includes("admin.roles.read")) return;
    void loadRbac();
  }, [auth?.accessToken, loadRbac, profile?.permissions]);

  useEffect(() => {
    if (!auth?.accessToken || !profile) return;
    if (activeKey === "myAccounts") void loadOwnAccounts();
    if (activeKey === "users") void loadUsers();
    if (activeKey === "officialAccounts") void loadSystemAccounts();
    if (activeKey === "announcement") void loadAnnouncement();
    if (activeKey === "feedback") void loadFeedback();
    if (activeKey === "audit") void loadAuditLogs();
    if (activeKey === "invitations") void loadInvitations();
    if (activeKey === "approvals") void loadApprovals();
  }, [
    activeKey,
    auth?.accessToken,
    loadApprovals,
    loadAuditLogs,
    loadInvitations,
    loadFeedback,
    loadAnnouncement,
    loadOwnAccounts,
    loadSystemAccounts,
    loadUsers,
    profile,
  ]);

  useEffect(() => {
    if (!auth?.accessToken || !profile || activeKey !== "telemetry") return;
    void loadTelemetryOverview();
    void loadInstallations();
    void loadTelemetryEvents();
  }, [activeKey, auth?.accessToken, profile]);

  if (!auth?.accessToken) {
    return <LoginView onAuth={saveAuth} />;
  }

  const pendingApprovalCount = approvals.items.filter((item) => item.status === "pending").length;
  const canManageUsers = Boolean(profile?.permissions?.includes("admin.users.manage"));
  const canManageRoles = Boolean(profile?.permissions?.includes("admin.roles.manage"));
  const canManagePermissions = Boolean(profile?.permissions?.includes("admin.permissions.manage"));
  const canManageOfficialAccounts = Boolean(profile?.permissions?.includes("admin.official-accounts.manage"));
  const canManageInvitations = Boolean(profile?.permissions?.includes("admin.invitations.manage"));
  const canManageApprovals = Boolean(profile?.permissions?.includes("admin.approvals.manage"));
  const canManageAnnouncements = Boolean(profile?.permissions?.includes("admin.announcements.manage"));
  const canManageFeedback = Boolean(profile?.permissions?.includes("admin.feedback.manage"));
  const canManageOwnAccounts = Boolean(profile?.permissions?.includes("self.accounts.write"));

  async function openApprovalModal() {
    const data = await api<PageResult<UserRow>>("/admin/api/users?page=1&pageSize=100&role=user&status=active");
    setApprovalUsers(data.items);
    setApprovalTargetUserId(null);
    setApprovalOpen(true);
  }

  async function reviewApproval(row: ApprovalRequest, decision: "approved" | "rejected") {
    await api(`/admin/api/approvals/${row.id}/review`, {
      method: "POST",
      body: JSON.stringify({ decision }),
    });
    message.success(decision === "approved" ? t("common.approved") : t("common.rejected"));
    await loadApprovals();
    await loadUsers();
  }

  async function loadEveryUser() {
    const first = await api<PageResult<UserRow>>("/admin/api/users?page=1&pageSize=100");
    const items = [...first.items];
    for (let page = 2; items.length < first.total; page += 1) {
      const next = await api<PageResult<UserRow>>(`/admin/api/users?page=${page}&pageSize=100`);
      if (!next.items.length) break;
      items.push(...next.items);
    }
    return items;
  }

  async function loadEverySystemAccount() {
    const first = await api<PageResult<SystemAccount>>("/admin/api/official-accounts?page=1&pageSize=100");
    const items = [...first.items];
    for (let page = 2; items.length < first.total; page += 1) {
      const next = await api<PageResult<SystemAccount>>(`/admin/api/official-accounts?page=${page}&pageSize=100`);
      if (!next.items.length) break;
      items.push(...next.items);
    }
    return items;
  }

  async function openSystemAccountBindings(account: SystemAccount) {
    setBindingSystemAccount(account);
    setBindingsLoading(true);
    try {
      const [allUsers, bindings] = await Promise.all([
        loadEveryUser(),
        api<{ userIds: string[] }>(`/admin/api/official-accounts/${account.id}/bindings`),
      ]);
      setBindingUsers(allUsers);
      setBoundUserIds(bindings.userIds);
    } catch (error) {
      message.error((error as Error).message);
      setBindingSystemAccount(null);
    } finally {
      setBindingsLoading(false);
    }
  }

  async function openBatchBinding(selectedUsers: UserRow[]) {
    if (!selectedUsers.length) return;
    setBatchBindingUsers(selectedUsers);
    setBatchBindingsLoading(true);
    try {
      setBatchBindingAccounts(await loadEverySystemAccount());
    } catch (error) {
      message.error((error as Error).message);
      setBatchBindingUsers([]);
    } finally {
      setBatchBindingsLoading(false);
    }
  }

  const renderPage = () => {
    if (activeKey === "myAccounts") {
      return (
        <MyAccountsPage
          accounts={ownAccounts}
          loading={ownAccountsLoading}
          canManage={canManageOwnAccounts}
          onEdit={setEditingOwnAccount}
          onRefresh={loadOwnAccounts}
        />
      );
    }

    if (activeKey === "officialAccounts") {
      return (
        <OfficialAccountsPage
          accounts={systemAccounts}
          loading={systemAccountsLoading}
          canManage={canManageOfficialAccounts}
          search={systemAccountSearch}
          onSearchChange={setSystemAccountSearch}
          onLoadAccounts={loadSystemAccounts}
          onCreate={() => {
            setEditingSystemAccount(null);
            setSystemAccountCompatibleImport(false);
            setSystemAccountModalOpen(true);
          }}
          onCompatibleCreate={() => {
            setEditingSystemAccount(null);
            setSystemAccountCompatibleImport(true);
            setSystemAccountModalOpen(true);
          }}
          onOAuthCreate={() => setSystemAccountOAuthOpen(true)}
          onEdit={(account) => {
            setEditingSystemAccount(account);
            setSystemAccountCompatibleImport(false);
            setSystemAccountModalOpen(true);
          }}
          onBind={(account) => void openSystemAccountBindings(account)}
          onDelete={(account) => {
            modal.confirm({
              title: t("officialAccounts.deleteTitle"),
              content: account.email,
              okButtonProps: { danger: true },
              onOk: async () => {
                await api(`/admin/api/official-accounts/${account.id}`, { method: "DELETE" });
                message.success(t("common.deleted"));
                await loadSystemAccounts();
              },
            });
          }}
        />
      );
    }

    if (activeKey === "roles") {
      return (
        <RolesPage
          roles={roles}
          permissions={permissionCatalog}
          loading={rolesLoading}
          canManage={canManageRoles}
          canManagePermissions={canManagePermissions}
          onRefresh={loadRbac}
          onCreate={() => {
            setEditingRole(null);
            setRoleModalOpen(true);
          }}
          onEdit={(role) => {
            setEditingRole(role);
            setRoleModalOpen(true);
          }}
          onDelete={(role) => {
            modal.confirm({
              title: t("roles.deleteTitle"),
              content: `${role.name} (${role.code})`,
              okButtonProps: { danger: true },
              onOk: async () => {
                await api(`/admin/api/roles/${encodeURIComponent(role.code)}`, { method: "DELETE" });
                message.success(t("common.deleted"));
                await loadRbac();
              },
            });
          }}
          onCreatePermission={() => {
            setEditingPermission(null);
            setPermissionModalOpen(true);
          }}
          onEditPermission={(permission) => {
            setEditingPermission(permission);
            setPermissionModalOpen(true);
          }}
        />
      );
    }

    if (activeKey === "announcement") {
      return (
        <AnnouncementPage
          announcement={announcement}
          loading={announcementLoading}
          saving={announcementSaving}
          canManage={canManageAnnouncements}
          onRefresh={loadAnnouncement}
          onSave={saveAnnouncement}
        />
      );
    }

    if (activeKey === "feedback") {
      return (
        <FeedbackPage
          feedback={feedback}
          loading={feedbackLoading}
          canManage={canManageFeedback}
          onLoad={loadFeedback}
          onLoadAttachment={loadFeedbackAttachment}
          onSendEmail={sendFeedbackEmail}
        />
      );
    }

    if (activeKey === "telemetry") {
      return (
        <TelemetryPage
          overview={telemetryOverview}
          installations={installations}
          events={telemetryEvents}
          overviewLoading={telemetryOverviewLoading}
          installationsLoading={installationsLoading}
          eventsLoading={telemetryEventsLoading}
          installationFilters={installationFilters}
          eventFilters={telemetryEventFilters}
          onInstallationFiltersChange={setInstallationFilters}
          onEventFiltersChange={setTelemetryEventFilters}
          onLoadOverview={loadTelemetryOverview}
          onLoadInstallations={loadInstallations}
          onLoadEvents={loadTelemetryEvents}
        />
      );
    }

    if (activeKey === "audit") {
      return (
        <AuditLogsPage
          logs={auditLogs}
          loading={auditLoading}
          search={auditSearch}
          onSearchChange={setAuditSearch}
          onLoadLogs={loadAuditLogs}
        />
      );
    }

    if (activeKey === "invitations") {
      return (
        <InvitationsPage
          invitations={invitations}
          loading={invitationLoading}
          roles={roles}
          canManage={canManageInvitations}
          onCreateInvitation={() => setInvitationOpen(true)}
          onLoadInvitations={loadInvitations}
          onRevokeInvitation={async (invitation) => {
            await api(`/admin/api/invitations/${invitation.id}`, { method: "DELETE" });
            message.success(t("common.revoked"));
            await loadInvitations();
          }}
        />
      );
    }

    if (activeKey === "approvals") {
      return (
        <ApprovalsPage
          approvals={approvals}
          loading={approvalLoading}
          pendingCount={pendingApprovalCount}
          profile={profile}
          canManage={canManageApprovals}
          onCreateApproval={() => void openApprovalModal()}
          onLoadApprovals={loadApprovals}
          onReviewApproval={(approval, decision) => void reviewApproval(approval, decision)}
        />
      );
    }

    return (
      <UsersPage
        users={users}
        loading={usersLoading}
        filters={userFilters}
        profile={profile}
        roles={roles}
        canManage={canManageUsers}
        canBindOfficialAccounts={canManageOfficialAccounts}
        canManageApprovals={canManageApprovals}
        pendingApprovalCount={pendingApprovalCount}
        onFiltersChange={setUserFilters}
        onLoadUsers={loadUsers}
        onBindPoolAccounts={(selectedUsers) => void openBatchBinding(selectedUsers)}
        onCreateUser={() => {
          setEditingUser(null);
          setUserModalOpen(true);
        }}
        onEditUser={(user) => {
          setEditingUser(user);
          setUserModalOpen(true);
        }}
        onResetPassword={setPasswordUser}
        onOpenAccounts={(user) => {
          setAccountUser(user);
          void loadAccounts(user);
          void loadProviders(user);
        }}
        onRequestApproval={(user) => {
          setApprovalUsers([user]);
          setApprovalTargetUserId(user.id);
          setApprovalOpen(true);
        }}
        onDeleteUser={(user) => {
          modal.confirm({
            title: t("users.deleteTitle"),
            content: user.email,
            okButtonProps: { danger: true },
            onOk: async () => {
              await api(`/admin/api/users/${user.id}`, { method: "DELETE" });
              message.success(t("common.deleted"));
              await loadUsers();
            },
          });
        }}
      />
    );
  };

  return (
    <AdminShell
      activeKey={activeKey}
      dark={dark}
      profile={profile}
      onMenuChange={setActiveKey}
      onOpenPassword={() => setChangePasswordOpen(true)}
      onOpenProfile={() => setProfileOpen(true)}
      onSignOut={signOut}
      onThemeChange={onThemeChange}
    >
      {renderPage()}

      <UserModal
        open={userModalOpen}
        editingUser={editingUser}
        api={api}
        currentPage={users.page}
        roles={roles}
        onClose={() => setUserModalOpen(false)}
        onSaved={loadUsers}
      />
      <PasswordResetModal api={api} user={passwordUser} onClose={() => setPasswordUser(null)} />
      <AccountDrawer
        user={accountUser}
        accounts={accounts}
        providers={providers}
        loading={accountsLoading}
        providersLoading={providersLoading}
        canManageUsers={canManageUsers}
        canManageOfficialAccounts={canManageOfficialAccounts}
        onClose={() => {
          setAccountUser(null);
          setAccounts([]);
          setProviders([]);
        }}
        onAddToPool={(account) => {
          if (!accountUser) return;
          modal.confirm({
            title: t("accounts.addToPoolTitle"),
            content: t("accounts.addToPoolDescription", { email: account.email }),
            onOk: async () => {
              await api(
                `/admin/api/users/${accountUser.id}/accounts/${encodeURIComponent(account.id)}/add-to-pool`,
                { method: "POST" },
              );
              message.success(t("accounts.addedToPool"));
              await loadSystemAccounts(1);
            },
          });
        }}
        onEditAccount={setEditingAccount}
        onDeleteAccount={(account) => {
          if (!accountUser) return;
          modal.confirm({
            title: t("accounts.deleteTitle"),
            content: account.email,
            okButtonProps: { danger: true },
            onOk: async () => {
              await api(`/admin/api/users/${accountUser.id}/accounts/${account.id}`, { method: "DELETE" });
              message.success(t("common.deleted"));
              await loadAccounts(accountUser);
            },
          });
        }}
        onRemoveBinding={(account) => {
          if (!accountUser || !account.systemAccountId) return;
          modal.confirm({
            title: t("accounts.removeBindingTitle"),
            content: account.email,
            okButtonProps: { danger: true },
            onOk: async () => {
              await api("/admin/api/official-accounts/unbind", {
                method: "POST",
                body: JSON.stringify({
                  systemAccountIds: [account.systemAccountId],
                  userIds: [accountUser.id],
                }),
              });
              message.success(t("officialAccounts.bindingsUpdated"));
              await loadAccounts(accountUser);
            },
          });
        }}
      />
      <OwnAccountEditModal
        account={editingOwnAccount}
        api={api}
        onClose={() => setEditingOwnAccount(null)}
        onSaved={loadOwnAccounts}
      />
      <AccountEditModal
        api={api}
        user={accountUser}
        account={editingAccount}
        onClose={() => setEditingAccount(null)}
        onSaved={loadAccounts}
      />
      <SystemAccountModal
        open={systemAccountModalOpen}
        account={editingSystemAccount}
        compatible={systemAccountCompatibleImport}
        api={api}
        onClose={() => {
          setSystemAccountModalOpen(false);
          setEditingSystemAccount(null);
          setSystemAccountCompatibleImport(false);
        }}
        onSaved={loadSystemAccounts}
      />
      <SystemAccountOAuthModal
        open={systemAccountOAuthOpen}
        api={api}
        onClose={() => setSystemAccountOAuthOpen(false)}
        onSaved={loadSystemAccounts}
      />
      <SystemAccountBindingModal
        account={bindingSystemAccount}
        api={api}
        users={bindingUsers}
        boundUserIds={boundUserIds}
        loading={bindingsLoading}
        onClose={() => {
          setBindingSystemAccount(null);
          setBindingUsers([]);
          setBoundUserIds([]);
        }}
        onSaved={loadSystemAccounts}
      />
      <BatchBindSystemAccountsModal
        api={api}
        users={batchBindingUsers}
        accounts={batchBindingAccounts}
        loading={batchBindingsLoading}
        onClose={() => {
          setBatchBindingUsers([]);
          setBatchBindingAccounts([]);
        }}
        onSaved={loadSystemAccounts}
      />
      <ProfileModal open={profileOpen} profile={profile} onClose={() => setProfileOpen(false)} />
      <ProfilePasswordModal
        open={changePasswordOpen}
        api={api}
        onClose={() => setChangePasswordOpen(false)}
      />
      <InvitationModal
        open={invitationOpen}
        api={api}
        roles={roles}
        onClose={() => setInvitationOpen(false)}
        onSaved={() => loadInvitations(1)}
      />
      <RoleModal
        open={roleModalOpen}
        role={editingRole}
        permissions={permissionCatalog}
        grantablePermissions={profile?.permissions ?? []}
        api={api}
        onClose={() => {
          setRoleModalOpen(false);
          setEditingRole(null);
        }}
        onSaved={loadRbac}
      />
      <PermissionModal
        open={permissionModalOpen}
        permission={editingPermission}
        api={api}
        onClose={() => {
          setPermissionModalOpen(false);
          setEditingPermission(null);
        }}
        onSaved={async () => {
          await Promise.all([loadRbac(), loadProfile()]);
        }}
      />
      <ApprovalModal
        open={approvalOpen}
        api={api}
        users={approvalUsers}
        currentUsers={users.items}
        targetUserId={approvalTargetUserId}
        onClose={() => setApprovalOpen(false)}
        onSaved={() => loadApprovals(1)}
      />
    </AdminShell>
  );
}
