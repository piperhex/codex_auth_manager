import { useEffect, useMemo, useState } from "react";
import { App as AntApp, Modal, Table, Tag, Typography } from "antd";
import type { TableColumnsType } from "antd";
import { labelForRole } from "../../i18n";
import { useI18n } from "../../i18n-context";
import type { ApiClient, SystemAccount, UserRow } from "../../types";

interface SystemAccountBindingModalProps {
  account: SystemAccount | null;
  api: ApiClient;
  users: UserRow[];
  boundUserIds: string[];
  loading: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

export function SystemAccountBindingModal({
  account,
  api,
  boundUserIds,
  loading,
  users,
  onClose,
  onSaved,
}: SystemAccountBindingModalProps) {
  const { message } = AntApp.useApp();
  const { t } = useI18n();
  const [selectedIds, setSelectedIds] = useState<React.Key[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => setSelectedIds(boundUserIds), [account?.id, boundUserIds]);

  const columns = useMemo<TableColumnsType<UserRow>>(() => [
    { title: t("common.email"), dataIndex: "email" },
    {
      title: t("common.role"),
      dataIndex: "role",
      width: 110,
      render: (role) => <Tag>{labelForRole(role, t)}</Tag>,
    },
    {
      title: t("common.status"),
      dataIndex: "disabled",
      width: 110,
      render: (disabled) => (
        <Typography.Text type={disabled ? "secondary" : undefined}>
          {disabled ? t("common.disabled") : t("common.enabled")}
        </Typography.Text>
      ),
    },
  ], [t]);

  async function save() {
    if (!account) return;
    const before = new Set(boundUserIds);
    const after = new Set(selectedIds.map(String));
    const added = [...after].filter((id) => !before.has(id));
    const removed = [...before].filter((id) => !after.has(id));
    setSaving(true);
    try {
      if (added.length) {
        await api("/admin/api/official-accounts/bind", {
          method: "POST",
          body: JSON.stringify({ systemAccountIds: [account.id], userIds: added }),
        });
      }
      if (removed.length) {
        await api("/admin/api/official-accounts/unbind", {
          method: "POST",
          body: JSON.stringify({ systemAccountIds: [account.id], userIds: removed }),
        });
      }
      message.success(t("officialAccounts.bindingsUpdated"));
      onClose();
      await onSaved();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={account ? t("officialAccounts.bindingTitle", { email: account.email }) : t("officialAccounts.bindUsers")}
      open={Boolean(account)}
      onCancel={onClose}
      onOk={save}
      confirmLoading={saving}
      width={760}
      destroyOnClose
    >
      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={users}
        rowSelection={{
          selectedRowKeys: selectedIds,
          onChange: setSelectedIds,
          preserveSelectedRowKeys: true,
        }}
        pagination={{ pageSize: 10, showSizeChanger: true }}
        scroll={{ y: 420 }}
      />
    </Modal>
  );
}
