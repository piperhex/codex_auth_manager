import { Button, Input, Table, Tag, Typography } from "antd";
import type { TableColumnsType } from "antd";
import { RefreshCw, Search } from "lucide-react";
import { hasTranslation } from "../i18n";
import { useI18n } from "../i18n-context";
import type { AuditLog, PageResult } from "../types";
import { formatDate } from "../utils/format";

interface AuditLogsPageProps {
  logs: PageResult<AuditLog>;
  loading: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  onLoadLogs: (page?: number, pageSize?: number) => void | Promise<void>;
}

export function AuditLogsPage({ logs, loading, search, onLoadLogs, onSearchChange }: AuditLogsPageProps) {
  const { language, t } = useI18n();
  const actionLabel = (action: string) => {
    const key = `audit.action.${action}`;
    return hasTranslation(key) ? t(key) : action;
  };

  const columns: TableColumnsType<AuditLog> = [
    { title: t("audit.time"), dataIndex: "createdAt", width: 180, render: (value) => formatDate(value, language) },
    { title: t("audit.actor"), dataIndex: "actorEmail", width: 220 },
    {
      title: t("audit.action"),
      dataIndex: "action",
      width: 150,
      render: (action: string) => <Tag color="geekblue">{actionLabel(action)}</Tag>,
    },
    { title: t("audit.target"), dataIndex: "targetEmail", render: (value: string | null, row) => value || row.targetId || "-" },
    {
      title: t("audit.details"),
      dataIndex: "metadata",
      render: (value: Record<string, unknown>) => (
        <Typography.Text code>{JSON.stringify(value ?? {})}</Typography.Text>
      ),
    },
  ];

  return (
    <>
      <h1 className="page-title">{t("audit.title")}</h1>
      <div className="toolbar">
        <div className="toolbar-left">
          <Input
            allowClear
            prefix={<Search size={15} />}
            placeholder={t("audit.searchPlaceholder")}
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            onPressEnter={() => onLoadLogs(1)}
            style={{ width: 280 }}
          />
          <Button icon={<Search size={15} />} onClick={() => onLoadLogs(1)}>{t("common.search")}</Button>
        </div>
        <Button icon={<RefreshCw size={15} />} onClick={() => onLoadLogs()}>{t("common.refresh")}</Button>
      </div>
      <div className="panel">
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={logs.items}
          pagination={{
            current: logs.page,
            pageSize: logs.pageSize,
            total: logs.total,
            showSizeChanger: true,
          }}
          onChange={(pagination) => onLoadLogs(pagination.current, pagination.pageSize)}
          scroll={{ x: 920 }}
        />
      </div>
    </>
  );
}
