import { Button, Input, Table, Tag, Typography } from "antd";
import type { TableColumnsType } from "antd";
import { RefreshCw, Search } from "lucide-react";
import { actionLabels } from "../constants";
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
  const columns: TableColumnsType<AuditLog> = [
    { title: "时间", dataIndex: "createdAt", width: 180, render: formatDate },
    { title: "操作人", dataIndex: "actorEmail", width: 220 },
    {
      title: "动作",
      dataIndex: "action",
      width: 150,
      render: (action: string) => <Tag color="geekblue">{actionLabels[action] ?? action}</Tag>,
    },
    { title: "对象", dataIndex: "targetEmail", render: (value: string | null, row) => value || row.targetId || "-" },
    {
      title: "详情",
      dataIndex: "metadata",
      render: (value: Record<string, unknown>) => (
        <Typography.Text code>{JSON.stringify(value ?? {})}</Typography.Text>
      ),
    },
  ];

  return (
    <>
      <h1 className="page-title">审计日志</h1>
      <div className="toolbar">
        <div className="toolbar-left">
          <Input
            allowClear
            prefix={<Search size={15} />}
            placeholder="搜索操作人、对象或动作"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            onPressEnter={() => onLoadLogs(1)}
            style={{ width: 280 }}
          />
          <Button icon={<Search size={15} />} onClick={() => onLoadLogs(1)}>搜索</Button>
        </div>
        <Button icon={<RefreshCw size={15} />} onClick={() => onLoadLogs()}>刷新</Button>
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
