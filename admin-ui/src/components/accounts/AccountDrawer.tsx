import { Badge, Button, Drawer, Table } from "antd";
import type { TableColumnsType } from "antd";
import { Edit3, Trash2 } from "lucide-react";
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
  const columns: TableColumnsType<SyncAccount> = [
    { title: "邮箱", dataIndex: "email" },
    { title: "备注", dataIndex: "note", ellipsis: true },
    { title: "套餐", dataIndex: "plan", width: 120 },
    {
      title: "状态",
      dataIndex: "active",
      width: 90,
      render: (active: boolean) => (
        <Badge status={active ? "processing" : "default"} text={active ? "当前" : "备用"} />
      ),
    },
    { title: "到期", dataIndex: "expiresAt", width: 120, render: (value: string) => value || "-" },
    {
      title: "操作",
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
      title={user ? `${user.email} / 同步账号` : "同步账号"}
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
