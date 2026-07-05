import { Badge, Button, Drawer, Table } from "antd";
import type { TableColumnsType } from "antd";
import { Edit3, Trash2 } from "lucide-react";
import { useI18n } from "../../i18n-context";
import type { SyncAccount, UserRow } from "../../types";

interface AccountDrawerProps {
  user: UserRow | null;
  accounts: SyncAccount[];
  loading: boolean;
  onClose: () => void;
  onEditAccount: (account: SyncAccount) => void;
  onDeleteAccount: (account: SyncAccount) => void;
}

export function AccountDrawer({
  accounts,
  loading,
  user,
  onClose,
  onDeleteAccount,
  onEditAccount,
}: AccountDrawerProps) {
  const { t } = useI18n();
  const columns: TableColumnsType<SyncAccount> = [
    { title: t("common.email"), dataIndex: "email" },
    { title: t("common.note"), dataIndex: "note", ellipsis: true },
    { title: t("common.plan"), dataIndex: "plan", width: 120 },
    {
      title: t("common.status"),
      dataIndex: "active",
      width: 90,
      render: (active: boolean) => (
        <Badge status={active ? "processing" : "default"} text={active ? t("accounts.active") : t("accounts.inactive")} />
      ),
    },
    { title: t("common.expiresAt"), dataIndex: "expiresAt", width: 120, render: (value: string) => value || "-" },
    {
      title: t("common.actions"),
      width: 110,
      render: (_, row) => (
        <div className="table-actions">
          <Button className="icon-button" icon={<Edit3 size={15} />} onClick={() => onEditAccount(row)} />
          <Button
            danger
            className="icon-button"
            icon={<Trash2 size={15} />}
            onClick={() => onDeleteAccount(row)}
          />
        </div>
      ),
    },
  ];

  return (
    <Drawer
      title={user ? t("accounts.drawerTitle", { email: user.email }) : t("accounts.title")}
      width={860}
      open={Boolean(user)}
      onClose={onClose}
    >
      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={accounts}
        pagination={false}
        scroll={{ x: 760 }}
      />
    </Drawer>
  );
}
