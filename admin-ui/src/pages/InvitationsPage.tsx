import { Button, Table, Tag } from "antd";
import type { TableColumnsType } from "antd";
import { Plus, RefreshCw, XCircle } from "lucide-react";
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
  const columns: TableColumnsType<Invitation> = [
    { title: "邮箱", dataIndex: "email" },
    { title: "角色", dataIndex: "role", width: 100, render: (role: Role) => <Tag>{role}</Tag> },
    { title: "创建人", dataIndex: "createdByEmail", width: 220 },
    { title: "过期时间", dataIndex: "expiresAt", width: 180, render: formatDate },
    {
      title: "状态",
      key: "status",
      width: 110,
      render: (_, row) => {
        if (row.revokedAt) return <Tag>已撤销</Tag>;
        if (row.acceptedAt) return <Tag color="green">已接受</Tag>;
        if (new Date(row.expiresAt) <= new Date()) return <Tag color="orange">已过期</Tag>;
        return <Tag color="blue">待注册</Tag>;
      },
    },
    {
      title: "操作",
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
      <h1 className="page-title">邀请注册</h1>
      <div className="toolbar">
        <div />
        <div className="toolbar-right">
          <Button icon={<RefreshCw size={15} />} onClick={() => onLoadInvitations()}>刷新</Button>
          <Button type="primary" icon={<Plus size={15} />} onClick={onCreateInvitation}>创建邀请</Button>
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
