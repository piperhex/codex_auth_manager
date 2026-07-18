import { useEffect, useMemo, useState } from "react";
import { App as AntApp, Modal, Table, Tag, Typography } from "antd";
import type { TableColumnsType } from "antd";
import { useI18n } from "../../i18n-context";
import type { InvitationRegisteredUser, PageResult, SystemAccount } from "../../types";

type AccountSortOrder = "ascend" | "descend";

interface InvitationAccountGiftModalProps {
  user: InvitationRegisteredUser | null;
  onClose: () => void;
  onLoadAccounts: (
    page: number,
    pageSize: number,
    sortOrder: AccountSortOrder,
  ) => Promise<PageResult<SystemAccount>>;
  onGift: (userId: string, systemAccountIds: string[]) => Promise<{ count: number }>;
}

const emptyAccounts: PageResult<SystemAccount> = {
  items: [],
  total: 0,
  page: 1,
  pageSize: 10,
};

export function InvitationAccountGiftModal({
  user,
  onClose,
  onGift,
  onLoadAccounts,
}: InvitationAccountGiftModalProps) {
  const { message } = AntApp.useApp();
  const { t } = useI18n();
  const [accounts, setAccounts] = useState<PageResult<SystemAccount>>(emptyAccounts);
  const [selectedIds, setSelectedIds] = useState<React.Key[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sortOrder, setSortOrder] = useState<AccountSortOrder>("ascend");

  async function loadAccounts(
    page = accounts.page,
    pageSize = accounts.pageSize,
    order = sortOrder,
  ) {
    setLoading(true);
    try {
      setAccounts(await onLoadAccounts(page, pageSize, order));
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!user) return;
    setAccounts(emptyAccounts);
    setSelectedIds([]);
    setSortOrder("ascend");
    void loadAccounts(1, emptyAccounts.pageSize, "ascend");
  }, [user?.userId]);

  const columns = useMemo<TableColumnsType<SystemAccount>>(() => [
    { title: t("common.email"), dataIndex: "email" },
    {
      title: t("common.plan"),
      dataIndex: "plan",
      width: 120,
      render: (value) => <Tag>{value}</Tag>,
    },
    {
      title: t("common.note"),
      dataIndex: "note",
      ellipsis: true,
      render: (value) => value || "-",
    },
    {
      title: t("officialAccounts.boundUsers"),
      dataIndex: "boundUserCount",
      key: "boundUserCount",
      width: 140,
      sorter: true,
      sortOrder,
    },
  ], [sortOrder, t]);

  async function save() {
    if (!user?.userId || !selectedIds.length) {
      message.warning(t("officialAccounts.selectAccount"));
      return;
    }
    setSaving(true);
    try {
      await onGift(user.userId, selectedIds.map(String));
      message.success(t("invitations.accountGifted", {
        count: selectedIds.length,
        email: user.email,
      }));
      onClose();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={t("invitations.giftAccountTitle", { email: user?.email ?? "" })}
      open={Boolean(user)}
      width={820}
      confirmLoading={saving}
      okText={t("invitations.giftAccount")}
      onCancel={onClose}
      onOk={save}
      destroyOnClose
    >
      <Typography.Paragraph type="secondary">
        {t("invitations.giftAccountHint")}
      </Typography.Paragraph>
      <Table
        rowKey="id"
        size="small"
        loading={loading}
        columns={columns}
        dataSource={accounts.items}
        rowSelection={{ selectedRowKeys: selectedIds, onChange: setSelectedIds }}
        pagination={{
          current: accounts.page,
          pageSize: accounts.pageSize,
          total: accounts.total,
          showSizeChanger: true,
        }}
        onChange={(pagination, _filters, sorter) => {
          const activeSorter = Array.isArray(sorter) ? sorter[0] : sorter;
          const nextOrder = activeSorter?.columnKey === "boundUserCount" && activeSorter.order
            ? activeSorter.order
            : "ascend";
          setSortOrder(nextOrder);
          void loadAccounts(pagination.current, pagination.pageSize, nextOrder);
        }}
        scroll={{ x: 720, y: 380 }}
      />
    </Modal>
  );
}
