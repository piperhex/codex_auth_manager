import { Badge, Button, Input, Table, Tag, Tooltip, Typography } from "antd";
import type { TableColumnsType, TablePaginationConfig } from "antd";
import { Edit3, Files, Link2, LogIn, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { useI18n } from "../i18n-context";
import type { PageResult, SystemAccount } from "../types";
import { formatDate } from "../utils/format";

interface OfficialAccountsPageProps {
  accounts: PageResult<SystemAccount>;
  loading: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  onLoadAccounts: (page?: number, pageSize?: number) => void | Promise<void>;
  onCreate: () => void;
  onCompatibleCreate: () => void;
  onSub2apiCreate: () => void;
  onOAuthCreate: () => void;
  onEdit: (account: SystemAccount) => void;
  onBind: (account: SystemAccount) => void;
  onDelete: (account: SystemAccount) => void;
  canManage: boolean;
}

export function OfficialAccountsPage({
  accounts,
  loading,
  search,
  onBind,
  onCreate,
  onCompatibleCreate,
  onSub2apiCreate,
  onOAuthCreate,
  onDelete,
  onEdit,
  onLoadAccounts,
  onSearchChange,
  canManage,
}: OfficialAccountsPageProps) {
  const { language, t } = useI18n();
  const columns: TableColumnsType<SystemAccount> = [
    {
      title: t("common.email"),
      dataIndex: "email",
      render: (email: string, row) => (
        <div>
          <Typography.Text strong>{email}</Typography.Text>
          <br />
          <Typography.Text type="secondary" copyable={{ text: row.syncAccountId }}>
            {row.syncAccountId}
          </Typography.Text>
        </div>
      ),
    },
    { title: t("common.plan"), dataIndex: "plan", width: 120, render: (value) => <Tag>{value}</Tag> },
    { title: t("common.note"), dataIndex: "note", ellipsis: true, render: (value) => value || "-" },
    {
      title: t("officialAccounts.boundUsers"),
      dataIndex: "boundUserCount",
      width: 120,
      render: (count: number) => (
        <Badge count={count} showZero color={count ? "#1677ff" : "#94a3b8"} />
      ),
    },
    {
      title: t("common.lastModifiedAt"),
      dataIndex: "lastModifiedAt",
      width: 180,
      render: (value) => formatDate(value, language),
    },
    {
      title: t("common.actions"),
      key: "actions",
      width: 150,
      render: (_, row) => (
        <div className="table-actions">
          <Tooltip title={t("officialAccounts.bindUsers")}>
            <Button disabled={!canManage} className="icon-button" icon={<Link2 size={15} />} onClick={() => onBind(row)} />
          </Tooltip>
          <Tooltip title={t("common.edit")}>
            <Button disabled={!canManage} className="icon-button" icon={<Edit3 size={15} />} onClick={() => onEdit(row)} />
          </Tooltip>
          <Tooltip title={t("common.delete")}>
            <Button disabled={!canManage} danger className="icon-button" icon={<Trash2 size={15} />} onClick={() => onDelete(row)} />
          </Tooltip>
        </div>
      ),
    },
  ];

  return (
    <>
      <h1 className="page-title">{t("officialAccounts.title")}</h1>
      <div className="toolbar">
        <div className="toolbar-left">
          <Input
            allowClear
            prefix={<Search size={15} />}
            placeholder={t("officialAccounts.searchPlaceholder")}
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            onPressEnter={() => onLoadAccounts(1)}
            style={{ width: 280 }}
          />
          <Button icon={<Search size={15} />} onClick={() => onLoadAccounts(1)}>{t("common.search")}</Button>
        </div>
        <div className="toolbar-right">
          <Button icon={<RefreshCw size={15} />} onClick={() => onLoadAccounts()}>{t("common.refresh")}</Button>
          {canManage && (
            <>
              <Button icon={<Plus size={15} />} onClick={onCreate}>
                {t("officialAccounts.createWithAuthJson")}
              </Button>
              <Button icon={<Files size={15} />} onClick={onCompatibleCreate}>
                {t("officialAccounts.compatibleImport")}
              </Button>
              <Button icon={<Files size={15} />} onClick={onSub2apiCreate}>
                {t("officialAccounts.sub2apiImport")}
              </Button>
              <Button type="primary" icon={<LogIn size={15} />} onClick={onOAuthCreate}>
                {t("officialAccounts.oauthCreate")}
              </Button>
            </>
          )}
        </div>
      </div>
      <div className="panel">
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={accounts.items}
          pagination={{
            current: accounts.page,
            pageSize: accounts.pageSize,
            total: accounts.total,
            showSizeChanger: true,
          }}
          onChange={(pagination: TablePaginationConfig) => onLoadAccounts(pagination.current, pagination.pageSize)}
          scroll={{ x: 980 }}
        />
      </div>
    </>
  );
}
