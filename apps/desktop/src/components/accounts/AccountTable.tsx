import { useState } from "react";
import { Button, Popconfirm, Space, Table, Tag, Tooltip } from "antd";
import type { TableProps } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Check, Clock3, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import type { Language, Translate } from "../../i18n";
import type { Account, ResetCreditsLoadState } from "../../types";
import { formatUpdated, initials } from "../../utils/format";
import { AccountNoteModal } from "../modals/AccountNoteModal";
import { ResetCreditsPanel } from "./ResetCreditsPanel";
import { UsageMeter } from "./UsageMeter";

interface AccountTableProps {
  accounts: Account[];
  busyAccountId: string | null;
  onSwitch: (id: string) => void;
  onRefresh: (id: string) => void;
  onDelete: (id: string) => void;
  onSaveNote: (id: string, note: string, expiresAt: string) => Promise<boolean>;
  resetCredits: Record<string, ResetCreditsLoadState>;
  onLoadResetCredits: (id: string, force?: boolean) => void;
  language: Language;
  t: Translate;
}

const USAGE_SORT_STORAGE_KEY = "codex-switch:account-table-usage-sort";

type UsageSortColumn = "fiveHours" | "oneWeek";
type UsageSortOrder = "ascend" | "descend";

interface UsageSortPreference {
  column: UsageSortColumn;
  order: UsageSortOrder;
}

function isUsageSortColumn(value: unknown): value is UsageSortColumn {
  return value === "fiveHours" || value === "oneWeek";
}

function isUsageSortOrder(value: unknown): value is UsageSortOrder {
  return value === "ascend" || value === "descend";
}

function loadUsageSortPreference(): UsageSortPreference | null {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(USAGE_SORT_STORAGE_KEY) ?? "null");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const preference = parsed as Partial<UsageSortPreference>;
    if (!isUsageSortColumn(preference.column) || !isUsageSortOrder(preference.order)) return null;
    return { column: preference.column, order: preference.order };
  } catch {
    return null;
  }
}

function persistUsageSortPreference(preference: UsageSortPreference | null) {
  if (!preference) {
    window.localStorage.removeItem(USAGE_SORT_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(USAGE_SORT_STORAGE_KEY, JSON.stringify(preference));
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

function usageRemainingSortValue(window: Account["usage"]["primary"]) {
  return typeof window?.remainingPercent === "number" ? window.remainingPercent : Number.NEGATIVE_INFINITY;
}

function compareUsageRemaining(
  left: Account,
  right: Account,
  usageWindow: "primary" | "secondary",
) {
  return usageRemainingSortValue(left.usage[usageWindow]) - usageRemainingSortValue(right.usage[usageWindow]);
}

export function AccountTable({
  accounts,
  busyAccountId,
  onSwitch,
  onRefresh,
  onDelete,
  onSaveNote,
  resetCredits,
  onLoadResetCredits,
  language,
  t,
}: AccountTableProps) {
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [usageSort, setUsageSort] = useState<UsageSortPreference | null>(loadUsageSortPreference);
  const handleTableChange: NonNullable<TableProps<Account>["onChange"]> = (_, __, sorter) => {
    const activeSorter = Array.isArray(sorter) ? sorter[0] : sorter;
    const nextSort = isUsageSortColumn(activeSorter.columnKey) && isUsageSortOrder(activeSorter.order)
      ? { column: activeSorter.columnKey, order: activeSorter.order }
      : null;

    setUsageSort(nextSort);
    persistUsageSortPreference(nextSort);
  };

  const columns: ColumnsType<Account> = [
    Table.EXPAND_COLUMN as ColumnsType<Account>[number],
    {
      title: t("table.account"), dataIndex: "email", width: 100, fixed: "left",
      sorter: (left, right) => left.email.localeCompare(right.email),
      render: (_, account) => (
        <div className="account-cell">
          <div className="table-avatar">{initials(account.email)}</div>
          <div className="account-primary">
            <div className="account-email" title={account.email}>{account.email}</div>
            <div className={`account-note-preview${account.note ? "" : " empty"}`} title={account.note || t("note.doubleClick")}>
              {account.note || t("note.doubleClick")}
            </div>
            <div className="account-meta">
              {account.active ? <Tag className="current-tag">{t("table.current")}</Tag> : <Tag>{t("table.standby")}</Tag>}
              <div className="updated-cell">
                {language === "zh" ? "刷新于 " : "Updated "}{formatUpdated(account.usage.fetchedAt, language)}
                {account.usage.error && <Tooltip title={account.usage.error}><Tag color="error">{t("table.error")}</Tag></Tooltip>}
              </div>
            </div>
          </div>
        </div>
      ),
    },
    {
      title: t("table.planId"), width: 70,
      render: (_, account) => (
        <Tooltip title={account.accountId ? t("table.workspace", { id: account.accountId }) : t("table.personal")}>
          <div className="plan-stack">
            <Tag className="plan-tag">{account.plan || "ChatGPT"}</Tag>
            {account.expiresAt && <span className="plan-expiration">{t("table.expiresAt", { date: account.expiresAt })}</span>}
          </div>
        </Tooltip>
      ),
    },
    {
      title: t("table.fiveHours"), key: "fiveHours", width: 110,
      sorter: (left, right) => compareUsageRemaining(left, right, "primary"),
      sortOrder: usageSort?.column === "fiveHours" ? usageSort.order : null,
      render: (_, account) => <UsageMeter window={account.usage.primary} resetWindow="fiveHours" language={language} t={t} />,
    },
    {
      title: t("table.oneWeek"), key: "oneWeek", width: 110,
      sorter: (left, right) => compareUsageRemaining(left, right, "secondary"),
      sortOrder: usageSort?.column === "oneWeek" ? usageSort.order : null,
      render: (_, account) => <UsageMeter window={account.usage.secondary} resetWindow="oneWeek" language={language} t={t} />,
    },
    {
      title: t("table.resetCredits"), width: 80, align: "center",
      render: (_, account) => <ResetCreditCount state={resetCredits[account.id]} language={language} t={t} />,
    },
    {
      title: t("table.actions"), width: 80, align: "center", fixed: "right",
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

  return <>
    <div className="account-table-wrap">
      <Table rowKey="id" size="small" columns={columns} dataSource={accounts} pagination={false}
        onChange={handleTableChange}
        rowClassName={(account) => (account.active ? "active-row" : "")}
        onRow={(account) => ({
          title: t("note.doubleClick"),
          onDoubleClick: (event) => {
            if ((event.target as HTMLElement).closest("button, a, input, textarea")) return;
            setEditingAccount(account);
          },
        })}
        expandable={{
          columnWidth: 32,
          fixed: "left",
          expandedRowRender: (account) => <ResetCreditsPanel state={resetCredits[account.id]}
            onRetry={() => onLoadResetCredits(account.id, true)} language={language} t={t} />,
          onExpand: (expanded, account) => { if (expanded) onLoadResetCredits(account.id); },
        }}
        scroll={{ x: 1390 }} />
    </div>
    {editingAccount && <AccountNoteModal key={editingAccount.id} account={editingAccount}
      onClose={() => setEditingAccount(null)}
      onSave={(note, expiresAt) => onSaveNote(editingAccount.id, note, expiresAt)} t={t} />}
  </>;
}
