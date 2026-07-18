import { Button, Space, Table, Tabs, Tag, Tooltip, Typography } from "antd";
import type { TableColumnsType } from "antd";
import { Edit3, Plus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { useI18n } from "../i18n-context";
import type { PermissionDefinition, RbacRole } from "../types";

interface RolesPageProps {
  roles: RbacRole[];
  permissions: PermissionDefinition[];
  loading: boolean;
  canManage: boolean;
  canManagePermissions: boolean;
  onRefresh: () => void | Promise<void>;
  onCreate: () => void;
  onEdit: (role: RbacRole) => void;
  onDelete: (role: RbacRole) => void;
  onCreatePermission: () => void;
  onEditPermission: (permission: PermissionDefinition) => void;
}

export function RolesPage({
  canManage,
  canManagePermissions,
  loading,
  onCreate,
  onDelete,
  onEdit,
  onCreatePermission,
  onEditPermission,
  onRefresh,
  permissions,
  roles,
}: RolesPageProps) {
  const { t } = useI18n();
  const canEditRole = (role: RbacRole) => !role.system || role.code === "user";
  const columns: TableColumnsType<RbacRole> = [
    {
      title: t("roles.name"),
      dataIndex: "name",
      render: (name: string, role) => (
        <Space>
          <ShieldCheck size={18} />
          <Space direction="vertical" size={0}>
            <Typography.Text strong>{name}</Typography.Text>
            <Typography.Text type="secondary" code>{role.code}</Typography.Text>
          </Space>
        </Space>
      ),
    },
    {
      title: t("roles.descriptionField"),
      dataIndex: "description",
      render: (value: string) => value || "-",
    },
    {
      title: t("common.status"),
      dataIndex: "system",
      width: 120,
      render: (system: boolean) => (
        <Tag color={system ? "blue" : "default"}>{t(system ? "roles.system" : "roles.custom")}</Tag>
      ),
    },
    {
      title: t("roles.permissions"),
      dataIndex: "permissions",
      width: 180,
      render: (permissions: string[]) => t("roles.permissionCount", { count: permissions.length }),
    },
    {
      title: t("users.total"),
      dataIndex: "userCount",
      width: 140,
      render: (count: number) => t("roles.userCount", { count }),
    },
    {
      title: t("common.actions"),
      width: 120,
      render: (_, role) => (
        <Space>
          <Tooltip title={canEditRole(role) ? t("common.edit") : t("roles.adminRoleHint")}>
            <Button
              className="icon-button"
              icon={<Edit3 size={15} />}
              disabled={!canManage || !canEditRole(role)}
              onClick={() => onEdit(role)}
            />
          </Tooltip>
          <Tooltip title={role.system ? t("roles.systemHint") : t("common.delete")}>
            <Button
              danger
              className="icon-button"
              icon={<Trash2 size={15} />}
              disabled={!canManage || role.system || role.userCount > 0}
              onClick={() => onDelete(role)}
            />
          </Tooltip>
        </Space>
      ),
    },
  ];
  const permissionColumns: TableColumnsType<PermissionDefinition> = [
    {
      title: t("roles.permissionGroup"),
      dataIndex: "group",
      width: 170,
      render: (group: string) => <Tag color="geekblue">{group}</Tag>,
    },
    {
      title: t("common.name"),
      dataIndex: "name",
      width: 220,
      render: (name: string) => <Typography.Text strong>{name}</Typography.Text>,
    },
    {
      title: t("roles.permissionCode"),
      dataIndex: "code",
      width: 260,
      render: (code: string) => <Typography.Text code copyable>{code}</Typography.Text>,
    },
    {
      title: t("roles.descriptionField"),
      dataIndex: "description",
      render: (description: string) => description || "-",
    },
    {
      title: t("common.status"),
      dataIndex: "system",
      width: 120,
      render: (system: boolean) => (
        <Tag color={system ? "blue" : "default"}>{t(system ? "roles.system" : "roles.custom")}</Tag>
      ),
    },
    {
      title: t("common.actions"),
      width: 80,
      render: (_, permission) => (
        <Tooltip title={permission.system ? t("roles.systemPermissionHint") : t("common.edit")}>
          <Button
            className="icon-button"
            icon={<Edit3 size={15} />}
            disabled={!canManagePermissions || permission.system}
            onClick={() => onEditPermission(permission)}
          />
        </Tooltip>
      ),
    },
  ];

  return (
    <>
      <h1 className="page-title">{t("roles.title")}</h1>
      <Typography.Paragraph type="secondary">{t("roles.description")}</Typography.Paragraph>
      <Tabs
        items={[
          {
            key: "roles",
            label: t("roles.rolesTab", { count: roles.length }),
            children: (
              <>
                <div className="toolbar">
                  <div />
                  <div className="toolbar-right">
                    <Button icon={<RefreshCw size={15} />} onClick={() => void onRefresh()}>{t("common.refresh")}</Button>
                    {canManage && (
                      <Button type="primary" icon={<Plus size={15} />} onClick={onCreate}>{t("roles.create")}</Button>
                    )}
                  </div>
                </div>
                <div className="panel">
                  <Table rowKey="code" loading={loading} columns={columns} dataSource={roles} pagination={false} />
                </div>
              </>
            ),
          },
          {
            key: "permissions",
            label: t("roles.permissionsTab", { count: permissions.length }),
            children: (
              <>
                <div className="toolbar">
                  <Typography.Text type="secondary">{t("roles.permissionCatalogHint")}</Typography.Text>
                  <div className="toolbar-right">
                    <Button icon={<RefreshCw size={15} />} onClick={() => void onRefresh()}>{t("common.refresh")}</Button>
                    {canManagePermissions && (
                      <Button type="primary" icon={<Plus size={15} />} onClick={onCreatePermission}>
                        {t("roles.createPermission")}
                      </Button>
                    )}
                  </div>
                </div>
                <div className="panel">
                  <Table
                    rowKey="code"
                    loading={loading}
                    columns={permissionColumns}
                    dataSource={permissions}
                    pagination={false}
                    scroll={{ x: 980 }}
                  />
                </div>
              </>
            ),
          },
        ]}
      />
    </>
  );
}
