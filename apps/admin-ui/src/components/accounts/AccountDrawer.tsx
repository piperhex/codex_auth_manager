import { Badge, Button, Drawer, Table, Tabs, Tag, Typography } from "antd";
import type { TableColumnsType } from "antd";
import { Edit3, Trash2, Unlink } from "lucide-react";
import { useI18n } from "../../i18n-context";
import { formatDate } from "../../utils/format";
import type { SyncAccount, SyncProvider, UserRow } from "../../types";

interface AccountDrawerProps {
  user: UserRow | null;
  accounts: SyncAccount[];
  providers: SyncProvider[];
  loading: boolean;
  providersLoading: boolean;
  onClose: () => void;
  onEditAccount: (account: SyncAccount) => void;
  onDeleteAccount: (account: SyncAccount) => void;
  onRemoveBinding: (account: SyncAccount) => void;
}

export function AccountDrawer({
  accounts,
  loading,
  providers,
  providersLoading,
  user,
  onClose,
  onDeleteAccount,
  onEditAccount,
  onRemoveBinding,
}: AccountDrawerProps) {
  const { language, t } = useI18n();
  const accountColumns: TableColumnsType<SyncAccount> = [
    { title: t("common.email"), dataIndex: "email" },
    { title: t("common.note"), dataIndex: "note", ellipsis: true },
    { title: t("common.plan"), dataIndex: "plan", width: 120 },
    {
      title: t("accounts.source"),
      dataIndex: "source",
      width: 110,
      render: (source: SyncAccount["source"]) => (
        <Tag color={source === "system" ? "blue" : "default"}>
          {t(source === "system" ? "accounts.sourceSystem" : "accounts.sourcePersonal")}
        </Tag>
      ),
    },
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
      render: (_, row) => row.source === "system" ? (
        <Button
          danger
          className="icon-button"
          title={t("accounts.removeBinding")}
          icon={<Unlink size={15} />}
          onClick={() => onRemoveBinding(row)}
        />
      ) : (
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

  const providerColumns: TableColumnsType<SyncProvider> = [
    { title: t("common.name"), dataIndex: "name", width: 180 },
    {
      title: t("common.baseUrl"),
      dataIndex: "baseUrl",
      ellipsis: true,
      render: (value: string) => <Typography.Text copyable={{ text: value }}>{value}</Typography.Text>,
    },
    { title: t("common.model"), dataIndex: "model", width: 180 },
    {
      title: t("providers.models"),
      dataIndex: "models",
      width: 220,
      render: (models: string[]) => (
        <div className="provider-model-tags">
          {(models?.length ? models : ["-"]).slice(0, 3).map((model, index) => (
            <Tag key={`${model}-${index}`}>{model}</Tag>
          ))}
          {models?.length > 3 && <Tag>+{models.length - 3}</Tag>}
        </div>
      ),
    },
    {
      title: t("providers.apiFormat"),
      dataIndex: "apiFormat",
      width: 150,
      render: (value: SyncProvider["apiFormat"]) => (
        value === "openaiResponses" ? t("providers.openaiResponses") : t("providers.openaiChat")
      ),
    },
    {
      title: t("providers.apiKey"),
      dataIndex: "hasApiKey",
      width: 120,
      render: (hasApiKey: boolean) => (
        <Badge status={hasApiKey ? "success" : "default"} text={hasApiKey ? t("common.enabled") : t("common.disabled")} />
      ),
    },
    {
      title: t("common.lastModifiedAt"),
      dataIndex: "lastModifiedAt",
      width: 180,
      render: (value) => formatDate(value, language),
    },
  ];

  return (
    <Drawer
      title={user ? t("sync.drawerTitle", { email: user.email }) : t("sync.title")}
      width={1040}
      open={Boolean(user)}
      onClose={onClose}
    >
      <Tabs
        items={[
          {
            key: "accounts",
            label: t("sync.accountsTab"),
            children: (
              <Table
                rowKey="id"
                loading={loading}
                columns={accountColumns}
                dataSource={accounts}
                pagination={false}
                scroll={{ x: 880 }}
              />
            ),
          },
          {
            key: "providers",
            label: t("sync.providersTab"),
            children: (
              <Table
                rowKey="id"
                loading={providersLoading}
                columns={providerColumns}
                dataSource={providers}
                pagination={false}
                scroll={{ x: 1120 }}
              />
            ),
          },
        ]}
      />
    </Drawer>
  );
}
