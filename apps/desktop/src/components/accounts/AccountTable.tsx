import { useMemo, useState } from "react";
import { Button, Popconfirm, Space, Switch, Table, Tag, Tooltip } from "antd";
import type { TableProps } from "antd";
import type { ColumnsType } from "antd/es/table";
import { CalendarClock, Check, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
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
  onAutoSwitchEnabledChange: (id: string, enabled: boolean) => void;
  autoSwitchBusyAccountId: string | null;
  onSaveNote: (id: string, note: string, expiresAt: string) => Promise<boolean>;
  resetCredits: Record<string, ResetCreditsLoadState>;
  onLoadResetCredits: (id: string, force?: boolean) => void;
  onUseResetCredit: (id: string) => void;
  resetCreditBusyAccountId: string | null;
  hotSwitchEnabled: boolean;
  privacyMode: boolean;
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

function maskAccountEmail(email: string) {
  if (email.length <= 10) return "*****";
  return `${email.slice(0, 5)}*****${email.slice(-5)}`;
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

function resetCreditsCount(state?: ResetCreditsLoadState) {
  return state?.status === "loaded" ? state.data.credits.length : null;
}

function needsAccountAttention(account: Account, hotSwitchEnabled: boolean) {
  return Boolean(account.usage.error) || (hotSwitchEnabled && !account.autoSwitchEnabled);
}

function compareKeepingAttentionLast(
  left: Account,
  right: Account,
  hotSwitchEnabled: boolean,
  sortOrder: UsageSortOrder | null | undefined,
  compare: (left: Account, right: Account) => number,
) {
  const attentionOrder = Number(needsAccountAttention(left, hotSwitchEnabled))
    - Number(needsAccountAttention(right, hotSwitchEnabled));
  if (attentionOrder !== 0) return sortOrder === "descend" ? -attentionOrder : attentionOrder;
  return compare(left, right);
}

export function AccountTable({
  accounts,
  busyAccountId,
  onSwitch,
  onRefresh,
  onDelete,
  onAutoSwitchEnabledChange,
  autoSwitchBusyAccountId,
  onSaveNote,
  resetCredits,
  onLoadResetCredits,
  onUseResetCredit,
  resetCreditBusyAccountId,
  hotSwitchEnabled,
  privacyMode,
  language,
  t,
}: AccountTableProps) {
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [usageSort, setUsageSort] = useState<UsageSortPreference | null>(loadUsageSortPreference);
  const orderedAccounts = useMemo(() => [...accounts].sort(
    (left, right) => Number(needsAccountAttention(left, hotSwitchEnabled))
      - Number(needsAccountAttention(right, hotSwitchEnabled)),
  ), [accounts, hotSwitchEnabled]);
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
      sorter: (left, right, sortOrder) => compareKeepingAttentionLast(
        left,
        right,
        hotSwitchEnabled,
        sortOrder,
        (first, second) => first.email.localeCompare(second.email),
      ),
      filters: [
        { text: t("table.filterNormal"), value: "normal" },
        { text: t("table.filterError"), value: "error" },
      ],
      onFilter: (value, account) => value === "error"
        ? needsAccountAttention(account, hotSwitchEnabled)
        : !needsAccountAttention(account, hotSwitchEnabled),
      render: (_, account) => (
        <div className="account-cell">
          <div className="table-avatar">{initials(account.email)}</div>
          <div className="account-primary">
            <div className="account-email" title={privacyMode ? undefined : account.email}>
              {privacyMode ? maskAccountEmail(account.email) : account.email}
            </div>
            <div className={`account-note-preview${account.note ? "" : " empty"}`} title={privacyMode ? undefined : account.note || t("note.doubleClick")}>
              {privacyMode && account.note ? "**********" : account.note || t("note.doubleClick")}
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
      sorter: (left, right, sortOrder) => compareKeepingAttentionLast(
        left,
        right,
        hotSwitchEnabled,
        sortOrder,
        (first, second) => compareUsageRemaining(first, second, "primary"),
      ),
      sortOrder: usageSort?.column === "fiveHours" ? usageSort.order : null,
      // OpenAI currently reports the primary (5-hour) quota with a weekly reset window.
      // Render its reset time like the weekly quota so it does not show a misleading 5-hour countdown.
      render: (_, account) => <UsageMeter window={account.usage.primary} resetWindow="oneWeek"
        resetCreditsCount={resetCreditsCount(resetCredits[account.id])} language={language} t={t} />,
    },
    {
      title: t("table.oneWeek"), key: "oneWeek", width: 110,
      sorter: (left, right, sortOrder) => compareKeepingAttentionLast(
        left,
        right,
        hotSwitchEnabled,
        sortOrder,
        (first, second) => compareUsageRemaining(first, second, "secondary"),
      ),
      sortOrder: usageSort?.column === "oneWeek" ? usageSort.order : null,
      render: (_, account) => <UsageMeter window={account.usage.secondary} resetWindow="oneWeek"
        resetCreditsCount={resetCreditsCount(resetCredits[account.id])} language={language} t={t} />,
    },
    {
      title: t("table.actions"), width: 135, align: "center", fixed: "right",
      render: (_, account) => {
        const waiting = busyAccountId === account.id;
        const resetWaiting = resetCreditBusyAccountId === account.id;
        return (
          <Space size={4} className="table-actions">
            <Button size="small" type={account.active ? "default" : "primary"} disabled={account.active}
              loading={waiting} icon={account.active ? <Check size={14} /> : <RotateCcw size={14} />}
              onClick={() => onSwitch(account.id)}>
              {account.active ? t("table.inUse") : hotSwitchEnabled ? t("table.hotSwitch") : t("table.switch")}
            </Button>
            <Popconfirm title={t("table.useResetCreditConfirmTitle")}
              description={<span className="reset-credit-confirm-description">{t("table.useResetCreditConfirmDescription")}</span>}
              okText={t("table.useResetCreditOk")} cancelText={t("table.cancel")}
              classNames={{ root: "reset-credit-popconfirm" }}
              styles={{ root: { width: 320, maxWidth: "calc(100vw - 32px)" } }}
              disabled={waiting || resetWaiting}
              onConfirm={() => onUseResetCredit(account.id)}>
              <Tooltip title={t("table.useResetCreditTooltip")}>
                <Button size="small" className="reset-credit-action" loading={resetWaiting}
                  disabled={waiting} icon={<CalendarClock size={14} />}>
                  {t("table.useResetCredit")}
                </Button>
              </Tooltip>
            </Popconfirm>
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
            {hotSwitchEnabled && (
              <Tooltip title={t("table.autoSwitchTooltip")}>
                <Switch size="small" checked={account.autoSwitchEnabled}
                  checkedChildren={t("table.enabled")} unCheckedChildren={t("table.disabled")}
                  loading={autoSwitchBusyAccountId === account.id}
                  disabled={autoSwitchBusyAccountId !== null && autoSwitchBusyAccountId !== account.id}
                  onChange={(enabled) => onAutoSwitchEnabledChange(account.id, enabled)} />
              </Tooltip>
            )}
          </Space>
        );
      },
    },
  ];

  return <>
    <div className="account-table-wrap">
      <Table rowKey="id" size="small" columns={columns} dataSource={orderedAccounts} pagination={false}
        onChange={handleTableChange}
        rowClassName={(account) => [
          account.active ? "active-row" : "",
          needsAccountAttention(account, hotSwitchEnabled) ? "account-alert-row" : "",
        ].filter(Boolean).join(" ")}
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
        scroll={{ x: 1350 }} />
    </div>
    {editingAccount && <AccountNoteModal key={editingAccount.id} account={editingAccount}
      onClose={() => setEditingAccount(null)}
      onSave={(note, expiresAt) => onSaveNote(editingAccount.id, note, expiresAt)} t={t} />}
  </>;
}
