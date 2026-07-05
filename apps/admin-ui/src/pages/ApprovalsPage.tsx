import { Button, Space, Table, Tag } from "antd";
import type { TableColumnsType } from "antd";
import { CheckCircle, Plus, RefreshCw, XCircle } from "lucide-react";
import { useI18n } from "../i18n-context";
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
  const { language, t } = useI18n();
  const columns: TableColumnsType<ApprovalRequest> = [
    { title: t("approvals.targetUser"), dataIndex: "targetEmail" },
    { title: t("approvals.requester"), dataIndex: "requestedByEmail", width: 220 },
    {
      title: t("common.status"),
      dataIndex: "status",
      width: 110,
      render: (status: ApprovalRequest["status"]) => {
        const color = status === "approved" ? "green" : status === "rejected" ? "red" : "blue";
        const label = status === "approved"
          ? t("approvals.status.approved")
          : status === "rejected"
            ? t("approvals.status.rejected")
            : t("approvals.status.pending");
        return <Tag color={color}>{label}</Tag>;
      },
    },
    { title: t("approvals.comment"), dataIndex: "comment", ellipsis: true },
    { title: t("common.createdAt"), dataIndex: "createdAt", width: 180, render: (value) => formatDate(value, language) },
    {
      title: t("common.actions"),
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
      <h1 className="page-title">{t("approvals.title")}</h1>
      <div className="toolbar">
        <div className="toolbar-left">
          <Tag color="blue">{t("approvals.pendingCount", { count: pendingCount })}</Tag>
        </div>
        <div className="toolbar-right">
          <Button icon={<RefreshCw size={15} />} onClick={() => onLoadApprovals()}>{t("common.refresh")}</Button>
          <Button type="primary" icon={<Plus size={15} />} onClick={onCreateApproval}>{t("approvals.submit")}</Button>
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
