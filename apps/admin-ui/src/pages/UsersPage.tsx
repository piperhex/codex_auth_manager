import { Avatar, Badge, Button, Input, Select, Space, Table, Tag, Tooltip, Typography } from "antd";
import type { TableColumnsType, TablePaginationConfig } from "antd";
import { Database, Edit3, KeyRound, Plus, RefreshCw, Search, ShieldCheck, Trash2 } from "lucide-react";
import { labelForRole } from "../i18n";
import { useI18n } from "../i18n-context";
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
  const { language, t } = useI18n();
  const activeVisibleUsers = users.items.filter((item) => !item.disabled).length;
  const adminVisibleUsers = users.items.filter((item) => item.role === "admin").length;

  const columns: TableColumnsType<UserRow> = [
    {
      title: t("common.email"),
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
      title: t("common.role"),
      dataIndex: "role",
      width: 110,
      render: (role: Role) => <Tag color={role === "admin" ? "blue" : "default"}>{labelForRole(role, t)}</Tag>,
    },
    {
      title: t("common.status"),
      dataIndex: "disabled",
      width: 100,
      render: (disabled: boolean) => (
        <Badge status={disabled ? "default" : "success"} text={disabled ? t("common.disabled") : t("common.enabled")} />
      ),
    },
    { title: t("users.lastLogin"), dataIndex: "lastLoginAt", width: 180, render: (value) => formatDate(value, language) },
    { title: t("common.createdAt"), dataIndex: "createdAt", width: 180, render: (value) => formatDate(value, language) },
    {
      title: t("common.actions"),
      key: "actions",
      width: 310,
      render: (_, row) => (
        <div className="table-actions">
          <Tooltip title={t("users.syncAccounts")}>
            <Button className="icon-button" icon={<Database size={15} />} onClick={() => onOpenAccounts(row)} />
          </Tooltip>
          <Tooltip title={t("common.edit")}>
            <Button className="icon-button" icon={<Edit3 size={15} />} onClick={() => onEditUser(row)} />
          </Tooltip>
          <Tooltip title={t("users.resetPassword")}>
            <Button className="icon-button" icon={<KeyRound size={15} />} onClick={() => onResetPassword(row)} />
          </Tooltip>
          <Tooltip title={t("users.requestApproval")}>
            <Button
              className="icon-button"
              icon={<ShieldCheck size={15} />}
              disabled={row.role === "admin"}
              onClick={() => onRequestApproval(row)}
            />
          </Tooltip>
          <Tooltip title={t("common.delete")}>
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
      <h1 className="page-title">{t("users.title")}</h1>
      <div className="summary-grid">
        <div className="metric"><span>{t("users.total")}</span><strong>{users.total}</strong></div>
        <div className="metric"><span>{t("users.activeCurrentPage")}</span><strong>{activeVisibleUsers}</strong></div>
        <div className="metric"><span>{t("users.adminCurrentPage")}</span><strong>{adminVisibleUsers}</strong></div>
        <div className="metric"><span>{t("users.pendingApprovals")}</span><strong>{pendingApprovalCount}</strong></div>
      </div>
      <div className="toolbar">
        <div className="toolbar-left">
          <Input
            allowClear
            prefix={<Search size={15} />}
            placeholder={t("users.searchEmail")}
            value={filters.search}
            onChange={(event) => onFiltersChange({ ...filters, search: event.target.value })}
            onPressEnter={() => onLoadUsers(1)}
            style={{ width: 240 }}
          />
          <Select
            allowClear
            placeholder={t("common.role")}
            value={filters.role}
            onChange={(role) => onFiltersChange({ ...filters, role })}
            options={[{ label: labelForRole("admin", t), value: "admin" }, { label: labelForRole("user", t), value: "user" }]}
            style={{ width: 130 }}
          />
          <Select
            allowClear
            placeholder={t("common.status")}
            value={filters.status}
            onChange={(status) => onFiltersChange({ ...filters, status })}
            options={[{ label: t("common.enabled"), value: "active" }, { label: t("common.disabled"), value: "disabled" }]}
            style={{ width: 130 }}
          />
          <Button icon={<Search size={15} />} onClick={() => onLoadUsers(1)}>{t("common.filter")}</Button>
        </div>
        <div className="toolbar-right">
          <Button icon={<RefreshCw size={15} />} onClick={() => onLoadUsers()}>{t("common.refresh")}</Button>
          <Button type="primary" icon={<Plus size={15} />} onClick={onCreateUser}>{t("users.create")}</Button>
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
