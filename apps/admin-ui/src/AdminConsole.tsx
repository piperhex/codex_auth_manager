import { useCallback, useEffect, useState } from "react";
import { App as AntApp } from "antd";
import { AccountDrawer } from "./components/accounts/AccountDrawer";
import { AccountEditModal } from "./components/accounts/AccountEditModal";
import { AdminShell } from "./components/layout/AdminShell";
import { ApprovalModal } from "./components/modals/ApprovalModal";
import { InvitationModal } from "./components/modals/InvitationModal";
import { PasswordResetModal } from "./components/modals/PasswordResetModal";
import { ProfileModal } from "./components/modals/ProfileModal";
import { ProfilePasswordModal } from "./components/modals/ProfilePasswordModal";
import { UserModal } from "./components/modals/UserModal";
import { LoginView } from "./components/LoginView";
import { useAuthenticatedApi } from "./hooks/useAuthenticatedApi";
import { ApprovalsPage } from "./pages/ApprovalsPage";
import { AuditLogsPage } from "./pages/AuditLogsPage";
import { InvitationsPage } from "./pages/InvitationsPage";
import { UsersPage } from "./pages/UsersPage";
import type {
  ApprovalRequest,
  AuditLog,
  AuthTokens,
  Invitation,
  MenuKey,
  PageResult,
  Profile,
  SyncAccount,
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

export function AdminConsole({ dark, onThemeChange }: AdminConsoleProps) {
  const { message, modal } = AntApp.useApp();
  const { t } = useI18n();
  const [auth, setAuth] = useState<AuthTokens | null>(() => loadStoredAuth());
  const [profile, setProfile] = useState<Profile | null>(auth?.user ?? null);
  const [activeKey, setActiveKey] = useState<MenuKey>("users");
  const [users, setUsers] = useState<PageResult<UserRow>>(emptyUsers);
  const [userFilters, setUserFilters] = useState<UserFilters>({});
  const [usersLoading, setUsersLoading] = useState(false);
  const [auditLogs, setAuditLogs] = useState<PageResult<AuditLog>>(emptyAuditLogs);
  const [auditSearch, setAuditSearch] = useState("");
  const [auditLoading, setAuditLoading] = useState(false);
  const [invitations, setInvitations] = useState<PageResult<Invitation>>(emptyInvitations);
  const [invitationLoading, setInvitationLoading] = useState(false);
  const [approvals, setApprovals] = useState<PageResult<ApprovalRequest>>(emptyApprovals);
  const [approvalLoading, setApprovalLoading] = useState(false);
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);
  const [passwordUser, setPasswordUser] = useState<UserRow | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [accountUser, setAccountUser] = useState<UserRow | null>(null);
  const [accounts, setAccounts] = useState<SyncAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [editingAccount, setEditingAccount] = useState<SyncAccount | null>(null);
  const [invitationOpen, setInvitationOpen] = useState(false);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [approvalUsers, setApprovalUsers] = useState<UserRow[]>([]);
  const [approvalTargetUserId, setApprovalTargetUserId] = useState<string | null>(null);

  const saveAuth = useCallback((next: AuthTokens | null) => {
    setAuth(next);
    setProfile(next?.user ?? null);
    persistAuth(next);
  }, []);

  const { api, signOut } = useAuthenticatedApi(auth, saveAuth, t);

  const loadProfile = useCallback(async () => {
    if (!auth?.accessToken) return;
    try {
      const data = await api<Profile>("/auth/me");
      if (data.role !== "admin") {
        message.error(t("errors.adminRequired"));
        await signOut();
        return;
      }
      setProfile(data);
    } catch (error) {
      message.error((error as Error).message);
      await signOut();
    }
  }, [api, auth?.accessToken, message, signOut, t]);

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

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    if (!auth?.accessToken || !profile) return;
    if (activeKey === "users") void loadUsers();
    if (activeKey === "audit") void loadAuditLogs();
    if (activeKey === "invitations") void loadInvitations();
    if (activeKey === "approvals") void loadApprovals();
  }, [activeKey, auth?.accessToken, loadApprovals, loadAuditLogs, loadInvitations, loadUsers, profile]);

  if (!auth?.accessToken) {
    return <LoginView onAuth={saveAuth} />;
  }

  const pendingApprovalCount = approvals.items.filter((item) => item.status === "pending").length;

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

  const renderPage = () => {
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
        pendingApprovalCount={pendingApprovalCount}
        onFiltersChange={setUserFilters}
        onLoadUsers={loadUsers}
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
        onClose={() => setUserModalOpen(false)}
        onSaved={loadUsers}
      />
      <PasswordResetModal api={api} user={passwordUser} onClose={() => setPasswordUser(null)} />
      <AccountDrawer
        user={accountUser}
        accounts={accounts}
        loading={accountsLoading}
        onClose={() => {
          setAccountUser(null);
          setAccounts([]);
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
      />
      <AccountEditModal
        api={api}
        user={accountUser}
        account={editingAccount}
        onClose={() => setEditingAccount(null)}
        onSaved={loadAccounts}
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
        onClose={() => setInvitationOpen(false)}
        onSaved={() => loadInvitations(1)}
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
