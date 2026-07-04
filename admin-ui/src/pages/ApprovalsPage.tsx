import { Button, Space, Table, Tag } from "antd";
import type { TableColumnsType } from "antd";
import { CheckCircle, Plus, RefreshCw, XCircle } from "lucide-react";
import type { ApprovalRequest, PageResult, Profile } from "../types";
import { formatDate } from "../utils/format";

interface ApprovalsPageProps {
  approvals: PageResult<ApprovalRequest>;
  loading: boolean;
  pendingCount: number;
  profile: Profile | null;
  onCreateApproval: () => void;
  onLoadApprovals: (page?: number, pageSize?: number) => void | Promise<void>;
  onReviewApproval: (approval: ApprovalRequest, decision: "approved" | "rejected") => void;
}

export function ApprovalsPage({
  approvals,
  loading,
  pendingCount,
  profile,
  onCreateApproval,
  onLoadApprovals,
  onReviewApproval,
}: ApprovalsPageProps) {
  const columns: TableColumnsType<ApprovalRequest> = [
    { title: "目标用户", dataIndex: "targetEmail" },
    { title: "提交人", dataIndex: "requestedByEmail", width: 220 },
    {
      title: "状态",
      dataIndex: "status",
      width: 110,
      render: (status: ApprovalRequest["status"]) => {
        const color = status === "approved" ? "green" : status === "rejected" ? "red" : "blue";
        const label = status === "approved" ? "已通过" : status === "rejected" ? "已拒绝" : "待审批";
        return <Tag color={color}>{label}</Tag>;
      },
    },
    { title: "备注", dataIndex: "comment", ellipsis: true },
    { title: "创建时间", dataIndex: "createdAt", width: 180, render: formatDate },
    {
      title: "操作",
      width: 130,
      render: (_, row) => row.status === "pending" ? (
        <Space>
          <Button
            className="icon-button"
            icon={<CheckCircle size={15} />}
            disabled={row.requestedByEmail === profile?.email}
            onClick={() => onReviewApproval(row, "approved")}
          />
          <Button
            danger
            className="icon-button"
            icon={<XCircle size={15} />}
            disabled={row.requestedByEmail === profile?.email}
            onClick={() => onReviewApproval(row, "rejected")}
          />
        </Space>
      ) : row.reviewedByEmail || "-",
    },
  ];

  return (
    <>
      <h1 className="page-title">管理员审批</h1>
      <div className="toolbar">
        <div className="toolbar-left">
          <Tag color="blue">待审批 {pendingCount}</Tag>
        </div>
        <div className="toolbar-right">
          <Button icon={<RefreshCw size={15} />} onClick={() => onLoadApprovals()}>刷新</Button>
          <Button type="primary" icon={<Plus size={15} />} onClick={onCreateApproval}>提交审批</Button>
        </div>
      </div>
      <div className="panel">
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={approvals.items}
          pagination={{
            current: approvals.page,
            pageSize: approvals.pageSize,
            total: approvals.total,
            showSizeChanger: true,
          }}
          onChange={(pagination) => onLoadApprovals(pagination.current, pagination.pageSize)}
          scroll={{ x: 900 }}
        />
      </div>
    </>
  );
}
