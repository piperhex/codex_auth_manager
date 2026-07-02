import { Button, Popconfirm, Space, Table, Tag, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Check, Clock3, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { Language, Translate } from "../../i18n";
import type { Account, ResetCreditsLoadState } from "../../types";
import { formatUpdated, initials } from "../../utils/format";
import { ResetCreditsPanel } from "./ResetCreditsPanel";
import { UsageMeter } from "./UsageMeter";

interface AccountTableProps {
  accounts: Account[];
  busyAccountId: string | null;
  onSwitch: (id: string) => void;
  onRefresh: (id: string) => void;
  onDelete: (id: string) => void;
  resetCredits: Record<string, ResetCreditsLoadState>;
  onLoadResetCredits: (id: string, force?: boolean) => void;
  language: Language;
  t: Translate;
}

function ResetCreditCount({ state, language, t }: { state?: ResetCreditsLoadState; language: Language; t: Translate }) {
  if (!state) {
    return (
      <Tooltip title={t("table.resetCreditsUnknown")}>
        <span className="reset-count-cell">
          <span className="reset-count reset-count-muted">-</span>
          <span className="reset-count-updated">{t("table.resetCreditsUpdated", { time: formatUpdated(null, language) })}</span>
        </span>
      </Tooltip>
    );
  }
  if (state.status === "loading") {
    return (
      <span className="reset-count-cell">
        <span className="reset-count reset-count-muted"><RefreshCw className="spin" size={13} /></span>
        <span className="reset-count-updated">{t("table.resetCreditsRefreshing")}</span>
      </span>
    );
  }
  if (state.status === "error") {
    return <Tooltip title={state.error || t("table.resetCreditsError")}><Tag color="error">{t("table.error")}</Tag></Tooltip>;
  }
  return (
    <span className="reset-count-cell">
      <span className="reset-count">{state.data.credits.length}</span>
      <span className="reset-count-updated">{t("table.resetCreditsUpdated", { time: formatUpdated(state.fetchedAt, language) })}</span>
    </span>
  );
}

export function AccountTable({
  accounts,
  busyAccountId,
  onSwitch,
  onRefresh,
  onDelete,
  resetCredits,
  onLoadResetCredits,
  language,
  t,
}: AccountTableProps) {
  const [now, setNow] = useState(() => Date.now());
  const hasFiveHourReset = accounts.some((account) => Boolean(account.usage.primary?.resetsAt));

  useEffect(() => {
    if (!hasFiveHourReset) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasFiveHourReset]);

  const columns: ColumnsType<Account> = [
    {
      title: t("table.account"), dataIndex: "email", width: 200, fixed: "left",
      sorter: (left, right) => left.email.localeCompare(right.email),
      render: (_, account) => (
        <div className="account-cell">
          <div className="table-avatar">{initials(account.email)}</div>
          <div className="account-primary">
            <div className="account-email" title={account.email}>{account.email}</div>
            <div className="account-meta">{account.active ? <Tag className="current-tag">{t("table.current")}</Tag> : <Tag>{t("table.standby")}</Tag>}</div>
          </div>
        </div>
      ),
    },
    {
      title: t("table.planId"), width: 50,
      render: (_, account) => (
        <Tooltip title={account.accountId ? t("table.workspace", { id: account.accountId }) : t("table.personal")}>
          <Tag className="plan-tag">{account.plan || "ChatGPT"}</Tag>
        </Tooltip>
      ),
    },
    {
      title: t("table.fiveHours"), width: 148,
      render: (_, account) => <UsageMeter window={account.usage.primary} resetWindow="fiveHours" now={now} language={language} t={t} />,
    },
    {
      title: t("table.oneWeek"), width: 148,
      render: (_, account) => <UsageMeter window={account.usage.secondary} resetWindow="oneWeek" now={now} language={language} t={t} />,
    },
    {
      title: t("table.resetCredits"), width: 130, align: "center",
      render: (_, account) => <ResetCreditCount state={resetCredits[account.id]} language={language} t={t} />,
    },
    {
      title: t("table.updated"), width: 100,
      render: (_, account) => (
        <div className="updated-cell">
          <Clock3 size={13} /><span>{formatUpdated(account.usage.fetchedAt, language)}</span>
          {account.usage.error && <Tooltip title={account.usage.error}><Tag color="error">{t("table.error")}</Tag></Tooltip>}
        </div>
      ),
    },
    {
      title: t("table.actions"), width: 140, align: "center", fixed: "right",
      render: (_, account) => {
        const waiting = busyAccountId === account.id;
        return (
          <Space size={4} className="table-actions">
            <Button size="small" type={account.active ? "default" : "primary"} disabled={account.active}
              loading={waiting} icon={account.active ? <Check size={14} /> : <RotateCcw size={14} />}
              onClick={() => onSwitch(account.id)}>{account.active ? t("table.inUse") : t("table.switch")}</Button>
            <Tooltip title={t("table.refreshUsage")}>
              <Button size="small" className="table-icon-button" loading={waiting}
                icon={<RefreshCw size={14} />} onClick={() => onRefresh(account.id)} />
            </Tooltip>
            <Popconfirm title={t("table.deleteConfirmTitle")} description={t("table.deleteConfirmDescription")}
              okText={t("table.delete")} cancelText={t("table.cancel")} okButtonProps={{ danger: true }} disabled={account.active}
              onConfirm={() => onDelete(account.id)}>
              <Tooltip title={account.active ? t("table.activeDeleteTooltip") : t("table.deleteAccount")}>
                <Button danger size="small" className="table-icon-button" aria-label={t("table.deleteAccount")}
                  disabled={account.active} icon={<Trash2 size={14} />} />
              </Tooltip>
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  return (
    <div className="account-table-wrap">
      <Table rowKey="id" size="small" columns={columns} dataSource={accounts} pagination={false}
        rowClassName={(account) => (account.active ? "active-row" : "")}
        expandable={{
          columnWidth: 42,
          expandedRowRender: (account) => <ResetCreditsPanel state={resetCredits[account.id]}
            onRetry={() => onLoadResetCredits(account.id, true)} language={language} t={t} />,
          onExpand: (expanded, account) => { if (expanded) onLoadResetCredits(account.id); },
        }}
        scroll={{ x: 1410 }} />
    </div>
  );
}
