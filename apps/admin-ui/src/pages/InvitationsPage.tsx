import { Button, Table, Tag } from "antd";
import type { TableColumnsType } from "antd";
import { Plus, RefreshCw, XCircle } from "lucide-react";
import { labelForRole } from "../i18n";
import { useI18n } from "../i18n-context";
import type { Invitation, PageResult, Role } from "../types";
import { formatDate } from "../utils/format";

interface InvitationsPageProps {
  invitations: PageResult<Invitation>;
  loading: boolean;
  onCreateInvitation: () => void;
  onLoadInvitations: (page?: number, pageSize?: number) => void | Promise<void>;
  onRevokeInvitation: (invitation: Invitation) => void;
}

export function InvitationsPage({
  invitations,
  loading,
  onCreateInvitation,
  onLoadInvitations,
  onRevokeInvitation,
}: InvitationsPageProps) {
  const { language, t } = useI18n();
  const columns: TableColumnsType<Invitation> = [
    { title: t("common.email"), dataIndex: "email" },
    { title: t("common.role"), dataIndex: "role", width: 100, render: (role: Role) => <Tag>{labelForRole(role, t)}</Tag> },
    { title: t("invitations.creator"), dataIndex: "createdByEmail", width: 220 },
    { title: t("common.expiresAt"), dataIndex: "expiresAt", width: 180, render: (value) => formatDate(value, language) },
    {
      title: t("common.status"),
      key: "status",
      width: 110,
      render: (_, row) => {
        if (row.revokedAt) return <Tag>{t("invitations.status.revoked")}</Tag>;
        if (row.acceptedAt) return <Tag color="green">{t("invitations.status.accepted")}</Tag>;
        if (new Date(row.expiresAt) <= new Date()) return <Tag color="orange">{t("invitations.status.expired")}</Tag>;
        return <Tag color="blue">{t("invitations.status.pending")}</Tag>;
      },
    },
    {
      title: t("common.actions"),
      width: 90,
      render: (_, row) => (
        <Button
          danger
          className="icon-button"
          icon={<XCircle size={15} />}
          disabled={Boolean(row.revokedAt || row.acceptedAt)}
          onClick={() => onRevokeInvitation(row)}
        />
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
          <Button type="primary" icon={<Plus size={15} />} onClick={onCreateInvitation}>{t("invitations.create")}</Button>
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
          scroll={{ x: 880 }}
        />
      </div>
    </>
  );
}
