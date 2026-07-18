import { useState } from "react";
import { App as AntApp, Badge, Button, Modal, Space, Table, Tag, Tooltip, Typography } from "antd";
import type { TableColumnsType } from "antd";
import { ClipboardCopy, Eye, Gift, Plus, RefreshCw, XCircle } from "lucide-react";
import { InvitationAccountGiftModal } from "../components/accounts/InvitationAccountGiftModal";
import { labelForRole } from "../i18n";
import { useI18n } from "../i18n-context";
import type {
  Invitation,
  InvitationRegisteredUser,
  PageResult,
  RbacRole,
  Role,
  SystemAccount,
} from "../types";
import { formatDate } from "../utils/format";

interface InvitationsPageProps {
  invitations: PageResult<Invitation>;
  loading: boolean;
  onCreateInvitation: () => void;
  onLoadInvitations: (page?: number, pageSize?: number) => void | Promise<void>;
  onLoadInvitationUsers: (
    invitationId: string,
    page?: number,
    pageSize?: number,
  ) => Promise<PageResult<InvitationRegisteredUser>>;
  onRevokeInvitation: (invitation: Invitation) => void;
  onCopyInvitationLink: (invitation: Invitation) => Promise<{ token: string }>;
  onLoadGiftAccounts: (
    page: number,
    pageSize: number,
    sortOrder: "ascend" | "descend",
  ) => Promise<PageResult<SystemAccount>>;
  onGiftAccounts: (userId: string, systemAccountIds: string[]) => Promise<{ count: number }>;
  roles: RbacRole[];
  canManage: boolean;
  canGiftAccounts: boolean;
}

export function InvitationsPage({
  invitations,
  loading,
  onCreateInvitation,
  onLoadInvitations,
  onLoadInvitationUsers,
  onCopyInvitationLink,
  onGiftAccounts,
  onLoadGiftAccounts,
  onRevokeInvitation,
  roles,
  canManage,
  canGiftAccounts,
}: InvitationsPageProps) {
  const { message } = AntApp.useApp();
  const { language, t } = useI18n();
  const [selectedInvitation, setSelectedInvitation] = useState<Invitation | null>(null);
  const [registeredUsers, setRegisteredUsers] = useState<PageResult<InvitationRegisteredUser>>({
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
  });
  const [registeredUsersLoading, setRegisteredUsersLoading] = useState(false);
  const [giftUser, setGiftUser] = useState<InvitationRegisteredUser | null>(null);
  const [copyingInvitationId, setCopyingInvitationId] = useState<string | null>(null);

  async function loadRegisteredUsers(invitation: Invitation, page = 1, pageSize = 20) {
    setRegisteredUsersLoading(true);
    try {
      setRegisteredUsers(await onLoadInvitationUsers(invitation.id, page, pageSize));
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setRegisteredUsersLoading(false);
    }
  }

  function openRegisteredUsers(invitation: Invitation) {
    setSelectedInvitation(invitation);
    setRegisteredUsers({ items: [], total: 0, page: 1, pageSize: 20 });
    void loadRegisteredUsers(invitation);
  }

  async function copyInvitationLink(invitation: Invitation) {
    setCopyingInvitationId(invitation.id);
    try {
      const { token } = await onCopyInvitationLink(invitation);
      await navigator.clipboard.writeText(
        `${window.location.origin}/admin?inviteToken=${encodeURIComponent(token)}`,
      );
      message.success(t("common.copied"));
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setCopyingInvitationId(null);
    }
  }

  const registeredUserColumns: TableColumnsType<InvitationRegisteredUser> = [
    { title: t("common.email"), dataIndex: "email" },
    {
      title: t("common.role"),
      dataIndex: "role",
      width: 140,
      render: (role: Role) => (
        <Tag>{roles.find((item) => item.code === role)?.name ?? labelForRole(role, t)}</Tag>
      ),
    },
    {
      title: t("invitations.registeredAt"),
      dataIndex: "registeredAt",
      width: 190,
      render: (value: string) => formatDate(value, language),
    },
    {
      title: t("invitations.giftedAccountCount"),
      dataIndex: "giftedAccountCount",
      width: 130,
      render: (count: number) => (
        <Badge count={count} showZero color={count ? "#1677ff" : "#94a3b8"} />
      ),
    },
    ...(canGiftAccounts ? [{
      title: t("common.actions"),
      key: "actions",
      width: 120,
      render: (_: unknown, user: InvitationRegisteredUser) => (
        <Tooltip title={t("invitations.giftAccount")}>
          <Button
            size="small"
            icon={<Gift size={14} />}
            disabled={!user.userId}
            onClick={() => setGiftUser(user)}
          >
            {t("invitations.giftAccount")}
          </Button>
        </Tooltip>
      ),
    }] : []),
  ];

  const columns: TableColumnsType<Invitation> = [
    {
      title: t("common.email"),
      dataIndex: "email",
      render: (email?: string | null) => email || t("invitations.anyEmail"),
    },
    {
      title: t("common.role"),
      dataIndex: "role",
      width: 120,
      render: (role: Role) => (
        <Tag>{roles.find((item) => item.code === role)?.name ?? labelForRole(role, t)}</Tag>
      ),
    },
    { title: t("invitations.creator"), dataIndex: "createdByEmail", width: 220 },
    {
      title: t("invitations.uses"),
      key: "uses",
      width: 110,
      render: (_, row) => `${row.usedCount}/${row.maxUses}`,
    },
    {
      title: t("common.expiresAt"),
      dataIndex: "expiresAt",
      width: 180,
      render: (value?: string | null) => value ? formatDate(value, language) : t("invitations.neverExpires"),
    },
    {
      title: t("common.status"),
      key: "status",
      width: 110,
      render: (_, row) => {
        if (row.revokedAt) return <Tag>{t("invitations.status.revoked")}</Tag>;
        if (row.usedCount >= row.maxUses) return <Tag color="green">{t("invitations.status.exhausted")}</Tag>;
        if (row.expiresAt && new Date(row.expiresAt) <= new Date()) {
          return <Tag color="orange">{t("invitations.status.expired")}</Tag>;
        }
        return <Tag color="blue">{t("invitations.status.active")}</Tag>;
      },
    },
    {
      title: t("common.actions"),
      key: "actions",
      width: 210,
      fixed: "right",
      render: (_, row) => (
        <Space size="small">
          <Button size="small" icon={<Eye size={14} />} onClick={() => openRegisteredUsers(row)}>
            {t("invitations.viewUsers")}
          </Button>
          <Tooltip title={t("invitations.copyLink")}>
            <Button
              size="small"
              className="icon-button"
              icon={<ClipboardCopy size={15} />}
              loading={copyingInvitationId === row.id}
              disabled={!canManage || Boolean(
                row.revokedAt
                || row.usedCount >= row.maxUses
                || (row.expiresAt && new Date(row.expiresAt) <= new Date())
              )}
              onClick={() => void copyInvitationLink(row)}
            />
          </Tooltip>
          <Button
            danger
            size="small"
            className="icon-button"
            icon={<XCircle size={15} />}
            disabled={!canManage || Boolean(row.revokedAt || row.usedCount >= row.maxUses)}
            onClick={() => onRevokeInvitation(row)}
          />
        </Space>
      ),
    },
  ];

  return (
    <>
      <h1 className="page-title">{t("invitations.title")}</h1>
      <div className="toolbar">
        <div />
        <div className="toolbar-right">
          <Button icon={<RefreshCw size={15} />} onClick={() => onLoadInvitations()}>{t("common.refresh")}</Button>
          {canManage && (
            <Button type="primary" icon={<Plus size={15} />} onClick={onCreateInvitation}>{t("invitations.create")}</Button>
          )}
        </div>
      </div>
      <div className="panel">
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={invitations.items}
          pagination={{
            current: invitations.page,
            pageSize: invitations.pageSize,
            total: invitations.total,
            showSizeChanger: true,
          }}
          onChange={(pagination) => onLoadInvitations(pagination.current, pagination.pageSize)}
          scroll={{ x: 1160 }}
        />
      </div>

      <Modal
        title={t("invitations.usersTitle")}
        open={Boolean(selectedInvitation)}
        width={920}
        footer={null}
        onCancel={() => {
          setGiftUser(null);
          setSelectedInvitation(null);
        }}
        destroyOnClose
      >
        <Typography.Paragraph type="secondary">
          {t("invitations.registeredUsersCount", { count: registeredUsers.total })}
        </Typography.Paragraph>
        <Table
          rowKey="id"
          size="small"
          loading={registeredUsersLoading}
          columns={registeredUserColumns}
          dataSource={registeredUsers.items}
          locale={{ emptyText: t("invitations.noRegisteredUsers") }}
          pagination={{
            current: registeredUsers.page,
            pageSize: registeredUsers.pageSize,
            total: registeredUsers.total,
            showSizeChanger: true,
          }}
          onChange={(pagination) => {
            if (selectedInvitation) {
              void loadRegisteredUsers(
                selectedInvitation,
                pagination.current,
                pagination.pageSize,
              );
            }
          }}
        />
      </Modal>
      <InvitationAccountGiftModal
        user={giftUser}
        onClose={() => setGiftUser(null)}
        onLoadAccounts={onLoadGiftAccounts}
        onGift={async (userId, systemAccountIds) => {
          const result = await onGiftAccounts(userId, systemAccountIds);
          if (selectedInvitation) {
            await loadRegisteredUsers(
              selectedInvitation,
              registeredUsers.page,
              registeredUsers.pageSize,
            );
          }
          return result;
        }}
      />
    </>
  );
}
