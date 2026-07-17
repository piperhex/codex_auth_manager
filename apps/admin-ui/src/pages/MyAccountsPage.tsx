import { useState } from "react";
import { Badge, Button, Modal, Table, Tag, Tooltip, Typography } from "antd";
import type { TableColumnsType } from "antd";
import { Pencil, RefreshCw } from "lucide-react";
import { useI18n } from "../i18n-context";
import type { SyncAccount } from "../types";
import { formatDate } from "../utils/format";

interface MyAccountsPageProps {
  accounts: SyncAccount[];
  loading: boolean;
  onEdit: (account: SyncAccount) => void;
  onRefresh: () => void | Promise<void>;
}

export function MyAccountsPage({ accounts, loading, onEdit, onRefresh }: MyAccountsPageProps) {
  const { language, t } = useI18n();
  const [noteAccount, setNoteAccount] = useState<SyncAccount | null>(null);
  const columns: TableColumnsType<SyncAccount> = [
    {
      title: t("common.email"),
      dataIndex: "email",
      render: (email: string, account) => (
        <div>
          <Typography.Text strong>{email}</Typography.Text>
          <br />
          <Typography.Text type="secondary" copyable={{ text: account.id }}>
            {account.id}
          </Typography.Text>
        </div>
      ),
    },
    {
      title: t("common.plan"),
      dataIndex: "plan",
      width: 120,
      render: (plan: string) => <Tag>{plan || "ChatGPT"}</Tag>,
    },
    {
      title: t("accounts.source"),
      dataIndex: "source",
      width: 120,
      render: (source: SyncAccount["source"]) => (
        <Tag color={source === "system" ? "blue" : "default"}>
          {t(source === "system" ? "accounts.sourceSystem" : "accounts.sourcePersonal")}
        </Tag>
      ),
    },
    {
      title: t("common.status"),
      dataIndex: "active",
      width: 100,
      render: (active: boolean) => (
        <Badge
          status={active ? "processing" : "default"}
          text={t(active ? "accounts.active" : "accounts.inactive")}
        />
      ),
    },
    {
      title: t("common.note"),
      dataIndex: "note",
      ellipsis: true,
      render: (value: string, account) => value ? (
        <Button
          type="link"
          onClick={() => setNoteAccount(account)}
          style={{ display: "block", width: "100%", height: "auto", padding: 0, textAlign: "left" }}
        >
          <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis" }}>
            {value}
          </span>
        </Button>
      ) : "-",
    },
    { title: t("common.expiresAt"), dataIndex: "expiresAt", width: 130, render: (value) => value || "-" },
    {
      title: t("common.lastModifiedAt"),
      dataIndex: "lastModifiedAt",
      width: 180,
      render: (value) => formatDate(value, language),
    },
    {
      title: t("common.actions"),
      key: "actions",
      width: 100,
      fixed: "right",
      align: "center",
      render: (_, account) => {
        const button = (
          <Button
            type="link"
            size="small"
            icon={<Pencil size={14} />}
            disabled={account.source === "system"}
            onClick={() => onEdit(account)}
          >
            {t("common.edit")}
          </Button>
        );
        return account.source === "system" ? (
          <Tooltip title={t("accounts.systemManaged")}>
            <span>{button}</span>
          </Tooltip>
        ) : button;
      },
    },
  ];

  return (
    <>
      <h1 className="page-title">{t("myAccounts.title")}</h1>
      <div className="toolbar">
        <div />
        <Button icon={<RefreshCw size={15} />} onClick={() => onRefresh()}>
          {t("common.refresh")}
        </Button>
      </div>
      <div className="panel">
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={accounts}
          pagination={false}
          scroll={{ x: 1120 }}
        />
      </div>
      <Modal
        title={t("accounts.noteDetailsTitle")}
        open={Boolean(noteAccount)}
        onCancel={() => setNoteAccount(null)}
        footer={(
          <Button type="primary" onClick={() => setNoteAccount(null)}>
            {t("common.close")}
          </Button>
        )}
        width={680}
      >
        <Typography.Text type="secondary">{noteAccount?.email}</Typography.Text>
        <Typography.Paragraph
          copyable={noteAccount ? { text: noteAccount.note } : false}
          style={{ marginTop: 16, maxHeight: "60vh", overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word" }}
        >
          {noteAccount?.note}
        </Typography.Paragraph>
      </Modal>
    </>
  );
}
