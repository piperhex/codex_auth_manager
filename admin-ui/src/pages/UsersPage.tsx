import { Avatar, Badge, Button, Input, Select, Space, Table, Tag, Tooltip, Typography } from "antd";
import type { TableColumnsType, TablePaginationConfig } from "antd";
import { Database, Edit3, KeyRound, Plus, RefreshCw, Search, ShieldCheck, Trash2 } from "lucide-react";
import { formatDate } from "../utils/format";
import type { PageResult, Profile, Role, UserFilters, UserRow } from "../types";

interface UsersPageProps {
  users: PageResult<UserRow>;
  loading: boolean;
  filters: UserFilters;
  profile: Profile | null;
  pendingApprovalCount: number;
  onFiltersChange: (filters: UserFilters) => void;
  onLoadUsers: (page?: number, pageSize?: number) => void | Promise<void>;
  onCreateUser: () => void;
  onEditUser: (user: UserRow) => void;
  onResetPassword: (user: UserRow) => void;
  onOpenAccounts: (user: UserRow) => void;
  onRequestApproval: (user: UserRow) => void;
  onDeleteUser: (user: UserRow) => void;
}

export function UsersPage({
  filters,
  loading,
  pendingApprovalCount,
  profile,
  users,
  onCreateUser,
  onDeleteUser,
  onEditUser,
  onFiltersChange,
  onLoadUsers,
  onOpenAccounts,
  onRequestApproval,
  onResetPassword,
}: UsersPageProps) {
  const activeVisibleUsers = users.items.filter((item) => !item.disabled).length;
  const adminVisibleUsers = users.items.filter((item) => item.role === "admin").length;

  const columns: TableColumnsType<UserRow> = [
    {
      title: "邮箱",
      dataIndex: "email",
      render: (email: string, row) => (
        <Space>
          <Avatar size={30}>{email.slice(0, 1).toUpperCase()}</Avatar>
          <Space direction="vertical" size={0}>
            <Typography.Text strong>{email}</Typography.Text>
            <Typography.Text type="secondary" copyable={{ text: row.id }}>{row.id}</Typography.Text>
          </Space>
        </Space>
      ),
    },
    {
      title: "角色",
      dataIndex: "role",
      width: 110,
      render: (role: Role) => <Tag color={role === "admin" ? "blue" : "default"}>{role}</Tag>,
    },
    {
      title: "状态",
      dataIndex: "disabled",
      width: 100,
      render: (disabled: boolean) => (
        <Badge status={disabled ? "default" : "success"} text={disabled ? "禁用" : "启用"} />
      ),
    },
    { title: "最后登录", dataIndex: "lastLoginAt", width: 180, render: formatDate },
    { title: "创建时间", dataIndex: "createdAt", width: 180, render: formatDate },
    {
      title: "操作",
      key: "actions",
      width: 310,
      render: (_, row) => (
        <div className="table-actions">
          <Tooltip title="同步账号">
            <Button className="icon-button" icon={<Database size={15} />} onClick={() => onOpenAccounts(row)} />
          </Tooltip>
          <Tooltip title="编辑">
            <Button className="icon-button" icon={<Edit3 size={15} />} onClick={() => onEditUser(row)} />
          </Tooltip>
          <Tooltip title="重置密码">
            <Button className="icon-button" icon={<KeyRound size={15} />} onClick={() => onResetPassword(row)} />
          </Tooltip>
          <Tooltip title="提交管理员审批">
            <Button
              className="icon-button"
              icon={<ShieldCheck size={15} />}
              disabled={row.role === "admin"}
              onClick={() => onRequestApproval(row)}
            />
          </Tooltip>
          <Tooltip title="删除">
            <Button
              danger
              className="icon-button"
              icon={<Trash2 size={15} />}
              disabled={row.id === profile?.id}
              onClick={() => onDeleteUser(row)}
            />
          </Tooltip>
        </div>
      ),
    },
  ];

  return (
    <>
      <h1 className="page-title">用户管理</h1>
      <div className="summary-grid">
        <div className="metric"><span>总用户</span><strong>{users.total}</strong></div>
        <div className="metric"><span>当前页启用</span><strong>{activeVisibleUsers}</strong></div>
        <div className="metric"><span>当前页管理员</span><strong>{adminVisibleUsers}</strong></div>
        <div className="metric"><span>待审批</span><strong>{pendingApprovalCount}</strong></div>
      </div>
      <div className="toolbar">
        <div className="toolbar-left">
          <Input
            allowClear
            prefix={<Search size={15} />}
            placeholder="搜索邮箱"
            value={filters.search}
            onChange={(event) => onFiltersChange({ ...filters, search: event.target.value })}
            onPressEnter={() => onLoadUsers(1)}
            style={{ width: 240 }}
          />
          <Select
            allowClear
            placeholder="角色"
            value={filters.role}
            onChange={(role) => onFiltersChange({ ...filters, role })}
            options={[{ label: "admin", value: "admin" }, { label: "user", value: "user" }]}
            style={{ width: 130 }}
          />
          <Select
            allowClear
            placeholder="状态"
            value={filters.status}
            onChange={(status) => onFiltersChange({ ...filters, status })}
            options={[{ label: "启用", value: "active" }, { label: "禁用", value: "disabled" }]}
            style={{ width: 130 }}
          />
          <Button icon={<Search size={15} />} onClick={() => onLoadUsers(1)}>筛选</Button>
        </div>
        <div className="toolbar-right">
          <Button icon={<RefreshCw size={15} />} onClick={() => onLoadUsers()}>刷新</Button>
          <Button type="primary" icon={<Plus size={15} />} onClick={onCreateUser}>新建用户</Button>
        </div>
      </div>
      <div className="panel">
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={users.items}
          pagination={{
            current: users.page,
            pageSize: users.pageSize,
            total: users.total,
            showSizeChanger: true,
          }}
          onChange={(pagination: TablePaginationConfig) => onLoadUsers(pagination.current, pagination.pageSize)}
          scroll={{ x: 1120 }}
        />
      </div>
    </>
  );
}
