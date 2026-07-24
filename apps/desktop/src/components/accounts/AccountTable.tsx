import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Dropdown, InputNumber, Popconfirm, Space, Switch, Table, Tag, Tooltip } from "antd";
import type { TableProps } from "antd";
import type { ColumnsType } from "antd/es/table";
import { CalendarClock, Check, MoreHorizontal, RefreshCw, RotateCcw, ToggleLeft, ToggleRight, Trash2, X } from "lucide-react";
import { loadTokenUsageEntries } from "../../api/backend";
import type { Language, Translate } from "../../i18n";
import type { AccountDisplayMode } from "../../hooks/useAccountDisplayMode";
import type { Account, ResetCreditsLoadState, TokenUsageEntry } from "../../types";
import { initials } from "../../utils/format";
import { AccountNoteModal } from "../modals/AccountNoteModal";
import { ResetCreditsPanel } from "./ResetCreditsPanel";
import { UsageMeter } from "./UsageMeter";

interface AccountTableProps {
  accounts: Account[];
  busyAccountId: string | null;
  onSwitch: (id: string) => void;
  onRefresh: (id: string) => void;
  onDelete: (id: string) => void;
  onDeleteMany: (ids: string[]) => Promise<string[]>;
  onAutoSwitchEnabledChange: (id: string, enabled: boolean) => void;
  autoSwitchBusyAccountId: string | null;
  onAutoSwitchPriorityChange: (id: string, priority: number) => Promise<boolean>;
  autoSwitchPriorityBusyAccountId: string | null;
  autoSwitchOnQuotaExhaustion: boolean;
  customAutoSwitchPriorityEnabled: boolean;
  onSaveNote: (id: string, note: string, expiresAt: string) => Promise<boolean>;
  resetCredits: Record<string, ResetCreditsLoadState>;
  onLoadResetCredits: (id: string, force?: boolean) => void;
  onUseResetCredit: (id: string) => void;
  resetCreditBusyAccountId: string | null;
  hotSwitchEnabled: boolean;
  openaiAuthAccountId: string | null;
  openaiAuthBusy: boolean;
  onOpenaiAuthAccountChange: (accountId: string | null) => void;
  privacyMode: boolean;
  displayMode: AccountDisplayMode;
  currentModel: string;
  tokenUsageRefreshSeconds: number;
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

interface AccountContextMenu {
  accountId: string;
  x: number;
  y: number;
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

interface TokenTypeTotals {
  input: number;
  output: number;
  reasoning: number;
  cached: number;
}

const EMPTY_TOKEN_TOTALS: TokenTypeTotals = { input: 0, output: 0, reasoning: 0, cached: 0 };

function tokenAccountKeys(account: Account) {
  return [
    account.accountId?.trim() ? `id:${account.accountId.trim()}` : "",
    account.email.trim() ? `email:${account.email.trim().toLowerCase()}` : "",
  ].filter(Boolean);
}

function entryAccountKeys(entry: TokenUsageEntry) {
  return [
    entry.accountId?.trim() ? `id:${entry.accountId.trim()}` : "",
    entry.accountEmail?.trim() ? `email:${entry.accountEmail.trim().toLowerCase()}` : "",
  ].filter(Boolean);
}

function formatCompactTokenCount(value: number, language: Language) {
  const locale = language === "zh" ? "zh-CN" : "en-US";
  if (value >= 1_000_000) {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value / 1_000_000)}M`;
  }
  if (value >= 1_000) {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value / 1_000)}K`;
  }
  return new Intl.NumberFormat(locale).format(value);
}

function CompactModelTokenChart({ model, totals, language }: {
  model: string;
  totals: TokenTypeTotals;
  language: Language;
}) {
  const labels = language === "zh"
    ? { title: "当前模型 Token 类型累计", input: "输入", output: "输出", reasoning: "推理", cached: "缓存" }
    : { title: "Current model token totals", input: "Input", output: "Output", reasoning: "Reasoning", cached: "Cached" };
  const values = [totals.input, totals.output, totals.reasoning, totals.cached];
  const maximum = Math.max(...values, 1);
  const total = totals.input + totals.output;
  const tooltip = (
    <div className="compact-token-tooltip">
      <strong>{model || "--"}</strong>
      <small>{labels.title}</small>
      {values.map((value, index) => (
        <span key={index}>
          <i className={`token-type-${index}`} />
          {([labels.input, labels.output, labels.reasoning, labels.cached] as const)[index]}
          <b>{formatCompactTokenCount(value, language)}</b>
        </span>
      ))}
    </div>
  );
  return (
    <Tooltip title={tooltip} placement="top">
      <div className="compact-model-token-chart" role="img" aria-label={`${labels.title}: ${model || "--"}`}>
        <span>TOKEN</span>
        <svg viewBox="0 0 48 26" aria-hidden="true">
          {values.map((value, index) => {
            const height = value > 0 ? Math.max(3, Math.round((value / maximum) * 22)) : 2;
            return <rect key={index} className={`token-type-${index}`} x={index * 12 + 2}
              y={24 - height} width="8" height={height} rx="2" />;
          })}
        </svg>
        <small>{formatCompactTokenCount(total, language)}</small>
      </div>
    </Tooltip>
  );
}

function totalsForAccount(totalsByAccount: Map<string, TokenTypeTotals>, account: Account) {
  for (const key of tokenAccountKeys(account)) {
    const totals = totalsByAccount.get(key);
    if (totals) return totals;
  }
  return EMPTY_TOKEN_TOTALS;
}

function isAccountDisabled(account: Account, hotSwitchEnabled: boolean) {
  return hotSwitchEnabled && !account.autoSwitchEnabled;
}

function needsAccountAttention(account: Account, hotSwitchEnabled: boolean) {
  return Boolean(account.usage.error) || isAccountDisabled(account, hotSwitchEnabled);
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

function AutoSwitchPriorityInput({
  account,
  disabled,
  onSave,
  t,
}: {
  account: Account;
  disabled: boolean;
  onSave: (id: string, priority: number) => Promise<boolean>;
  t: Translate;
}) {
  const [value, setValue] = useState<number | null>(account.autoSwitchPriority);

  useEffect(() => setValue(account.autoSwitchPriority), [account.autoSwitchPriority]);

  const save = async () => {
    const priority = value === null ? 0 : Math.trunc(value);
    setValue(priority);
    if (priority === account.autoSwitchPriority) return;
    if (!await onSave(account.id, priority)) setValue(account.autoSwitchPriority);
  };

  return <InputNumber className="auto-switch-priority-input" size="small" precision={0} step={1}
    min={-2_147_483_648} max={2_147_483_647} value={value} disabled={disabled}
    aria-label={t("table.autoSwitchPriority")} onChange={setValue}
    onBlur={() => void save()} onPressEnter={(event) => event.currentTarget.blur()} />;
}

function ResetCreditsModal({
  state,
  onClose,
  onRetry,
  language,
  t,
}: {
  state?: ResetCreditsLoadState;
  onClose: () => void;
  onRetry: () => void;
  language: Language;
  t: Translate;
}) {
  const count = resetCreditsCount(state);
  return <div className="modal-backdrop">
    <div className="modal reset-credits-modal">
      <button className="modal-close" onClick={onClose} aria-label={t("table.cancel")}><X size={17} /></button>
      <div className="modal-icon"><CalendarClock size={22} /></div>
      <h2>{t("table.resetCredits")}</h2>
      <p>{t("table.resetCredits")}: {count ?? "-"}</p>
      <ResetCreditsPanel state={state} onRetry={onRetry} language={language} t={t} />
    </div>
  </div>;
}

export function AccountTable({
  accounts,
  busyAccountId,
  onSwitch,
  onRefresh,
  onDelete,
  onDeleteMany,
  onAutoSwitchEnabledChange,
  autoSwitchBusyAccountId,
  onAutoSwitchPriorityChange,
  autoSwitchPriorityBusyAccountId,
  autoSwitchOnQuotaExhaustion,
  customAutoSwitchPriorityEnabled,
  onSaveNote,
  resetCredits,
  onLoadResetCredits,
  onUseResetCredit,
  resetCreditBusyAccountId,
  hotSwitchEnabled,
  openaiAuthAccountId,
  openaiAuthBusy,
  onOpenaiAuthAccountChange,
  privacyMode,
  displayMode,
  currentModel,
  tokenUsageRefreshSeconds,
  language,
  t,
}: AccountTableProps) {
  const tableWrapRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [resetCreditsAccount, setResetCreditsAccount] = useState<Account | null>(null);
  const [contextMenu, setContextMenu] = useState<AccountContextMenu | null>(null);
  const [tableActionMenuAccountId, setTableActionMenuAccountId] = useState<string | null>(null);
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [bulkDeleteBusy, setBulkDeleteBusy] = useState(false);
  const [openaiAuthPendingAccountId, setOpenaiAuthPendingAccountId] = useState<string | null>(null);
  const [usageSort, setUsageSort] = useState<UsageSortPreference | null>(loadUsageSortPreference);
  const [tableScrollY, setTableScrollY] = useState(0);
  const [tokenUsageEntries, setTokenUsageEntries] = useState<TokenUsageEntry[]>([]);
  useEffect(() => {
    const tableWrap = tableWrapRef.current;
    if (!tableWrap) return undefined;

    const updateScrollHeight = () => {
      const headerHeight = tableWrap.querySelector(".ant-table-thead")?.getBoundingClientRect().height ?? 0;
      const toolbarHeight = tableWrap.querySelector(".account-table-toolbar")?.getBoundingClientRect().height ?? 0;
      setTableScrollY(Math.max(1, Math.floor(tableWrap.clientHeight - headerHeight - toolbarHeight)));
    };
    const observer = new ResizeObserver(updateScrollHeight);
    observer.observe(tableWrap);
    updateScrollHeight();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const closeContextMenu = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(".ant-popconfirm")) return;
      if (!contextMenuRef.current?.contains(event.target as Node)) setContextMenu(null);
    };
    document.addEventListener("pointerdown", closeContextMenu);
    return () => document.removeEventListener("pointerdown", closeContextMenu);
  }, []);
  useEffect(() => {
    if (!hotSwitchEnabled) {
      setTokenUsageEntries([]);
      return undefined;
    }
    let active = true;
    const refresh = async () => {
      try {
        const entries = await loadTokenUsageEntries();
        if (active) setTokenUsageEntries(entries);
      } catch {
        // Keep the last successful totals; quota rendering must not fail with token statistics.
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), Math.max(1, tokenUsageRefreshSeconds) * 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [hotSwitchEnabled, tokenUsageRefreshSeconds]);
  useEffect(() => {
    const deletableIds = new Set(accounts.filter((account) => !account.active).map((account) => account.id));
    setSelectedAccountIds((current) => {
      const next = current.filter((id) => deletableIds.has(id));
      return next.length === current.length && next.every((id, index) => id === current[index]) ? current : next;
    });
  }, [accounts]);
  useEffect(() => {
    if (!openaiAuthBusy) setOpenaiAuthPendingAccountId(null);
  }, [openaiAuthBusy]);
  const effectiveCurrentModel = currentModel.trim() || tokenUsageEntries[0]?.model || "";
  const customPriorityActive = hotSwitchEnabled
    && autoSwitchOnQuotaExhaustion
    && customAutoSwitchPriorityEnabled;
  const tokenTotalsByAccount = useMemo(() => {
    const totals = new Map<string, TokenTypeTotals>();
    if (!effectiveCurrentModel) return totals;
    tokenUsageEntries.forEach((entry) => {
      if (entry.model !== effectiveCurrentModel) return;
      entryAccountKeys(entry).forEach((key) => {
        const current = totals.get(key) ?? { ...EMPTY_TOKEN_TOTALS };
        current.input += entry.inputTokens ?? 0;
        current.output += entry.outputTokens ?? 0;
        current.reasoning += entry.reasoningTokens ?? 0;
        current.cached += entry.cachedTokens ?? 0;
        totals.set(key, current);
      });
    });
    return totals;
  }, [effectiveCurrentModel, tokenUsageEntries]);
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
      title: t("table.account"), dataIndex: "email", width: 280, fixed: "left",
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
              <Tooltip title={account.accountId ? t("table.workspace", { id: account.accountId }) : t("table.personal")}>
                <Tag className="plan-tag">{account.plan || "ChatGPT"}</Tag>
              </Tooltip>
              <div className="updated-cell">
                {account.expiresAt && <span className="plan-expiration">{t("table.expiresAt", { date: account.expiresAt })}</span>}
                {account.usage.error && <Tooltip title={account.usage.error}><Tag color="error">{t("table.error")}</Tag></Tooltip>}
              </div>
            </div>
          </div>
        </div>
      ),
    },
    {
      title: t("table.fiveHours"), key: "fiveHours", width: 260,
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
        resetCreditsCount={resetCreditsCount(resetCredits[account.id])} fetchedAt={account.usage.fetchedAt}
        language={language} t={t} />,
    },
    {
      title: t("table.oneWeek"), key: "oneWeek", width: 260,
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
      title: t("table.tokenTotals"), key: "tokenTotals", width: 92, align: "center" as const,
      render: (_: unknown, account: Account) => (
        <div className="account-token-chart-cell">
          {hotSwitchEnabled ? (
            <CompactModelTokenChart model={effectiveCurrentModel}
              totals={totalsForAccount(tokenTotalsByAccount, account)} language={language} />
          ) : (
            <Tooltip title={t("table.tokenTotalsProxyOnly")}>
              <span className="account-token-chart-unavailable">--</span>
            </Tooltip>
          )}
        </div>
      ),
    },
    ...(customPriorityActive ? [{
      title: t("table.autoSwitchPriority"), key: "autoSwitchPriority", width: 150,
      align: "center" as const, fixed: "right" as const,
      render: (_: unknown, account: Account) => (
        <AutoSwitchPriorityInput account={account} t={t}
          disabled={autoSwitchPriorityBusyAccountId !== null}
          onSave={onAutoSwitchPriorityChange} />
      ),
    }] : []),
    {
      title: t("table.actions"), width: 300, align: "center", fixed: "right",
      render: (_, account) => {
        const waiting = busyAccountId === account.id;
        const resetWaiting = resetCreditBusyAccountId === account.id;
        const officialAuthActive = openaiAuthAccountId === account.id;
        const officialAuthUnsupported = Boolean(account.agentIdentity) && !officialAuthActive;
        const switchBlocked = hotSwitchEnabled
          ? !account.localProxyCompatible
          : !account.directSwitchCompatible;
        const switchBlockedReason = hotSwitchEnabled
          ? t("providers.proxy.agentIdentityUnsupported")
          : t("providers.proxy.agentIdentityProxyOnly");
        return (
          <Space size={4} className="table-actions">
            <Tooltip title={switchBlocked ? switchBlockedReason : undefined}>
              <span>
                <Button size="small" type={account.active ? "default" : "primary"}
                  disabled={account.active || switchBlocked}
                  loading={waiting} icon={account.active ? <Check size={14} /> : <RotateCcw size={14} />}
                  onClick={() => onSwitch(account.id)}>
                  {account.active ? t("table.inUse") : hotSwitchEnabled ? t("table.hotSwitch") : t("table.switch")}
                </Button>
              </span>
            </Tooltip>
            {hotSwitchEnabled && (
              <Tooltip placement="top" classNames={{ root: "openai-auth-action-tooltip" }} title={(
                <div className="openai-auth-action-tooltip-content">
                  <p>{t("providers.proxy.openaiAuthAccountTooltipRemote")}</p>
                  <p>{t("providers.proxy.openaiAuthAccountTooltipCapabilities")}</p>
                  {officialAuthUnsupported && (
                    <p className="warning">{t("providers.error.openaiAuthAccountOAuthRequired")}</p>
                  )}
                </div>
              )}>
                <span>
                  <Button size="small" type={officialAuthActive ? "primary" : "default"}
                    danger={officialAuthActive}
                    loading={openaiAuthBusy && openaiAuthPendingAccountId === account.id}
                    disabled={openaiAuthBusy || officialAuthUnsupported}
                    onClick={() => {
                      setOpenaiAuthPendingAccountId(account.id);
                      onOpenaiAuthAccountChange(officialAuthActive ? null : account.id);
                    }}>
                    {t(officialAuthActive
                      ? "providers.proxy.deactivateOpenaiAuthAccount"
                      : "providers.proxy.activateOpenaiAuthAccount")}
                  </Button>
                </span>
              </Tooltip>
            )}
            {hotSwitchEnabled && (
              <Tooltip title={t("table.autoSwitchTooltip")}>
                <Switch size="small" checked={account.autoSwitchEnabled}
                  checkedChildren={t("table.enabled")} unCheckedChildren={t("table.disabled")}
                  loading={autoSwitchBusyAccountId === account.id}
                  disabled={autoSwitchBusyAccountId !== null && autoSwitchBusyAccountId !== account.id}
                  onChange={(enabled) => onAutoSwitchEnabledChange(account.id, enabled)} />
              </Tooltip>
            )}
            <Dropdown trigger={["click"]} placement="bottomRight"
              open={tableActionMenuAccountId === account.id}
              onOpenChange={(open) => setTableActionMenuAccountId(open ? account.id : null)}
              dropdownRender={() => (
                <div className="account-action-menu" onClick={(event) => event.stopPropagation()}>
                  <Popconfirm title={t("table.useResetCreditConfirmTitle")}
                    description={<span className="reset-credit-confirm-description">{t("table.useResetCreditConfirmDescription")}</span>}
                    okText={t("table.useResetCreditOk")} cancelText={t("table.cancel")}
                    classNames={{ root: "reset-credit-popconfirm" }}
                    styles={{ root: { width: 320, maxWidth: "calc(100vw - 32px)" } }}
                    disabled={waiting || resetWaiting}
                    onConfirm={() => {
                      setTableActionMenuAccountId(null);
                      onUseResetCredit(account.id);
                    }}>
                    <button type="button" disabled={waiting || resetWaiting}>
                      <CalendarClock size={14} />
                      {resetWaiting ? t("table.resetCreditsRefreshing") : t("table.useResetCredit")}
                    </button>
                  </Popconfirm>
                  <button type="button" disabled={waiting} onClick={() => {
                    setTableActionMenuAccountId(null);
                    onRefresh(account.id);
                  }}>
                    <RefreshCw size={14} />
                    {t("table.refreshUsage")}
                  </button>
                  <div className="account-action-menu-divider" />
                  <Popconfirm title={t("table.deleteConfirmTitle")} description={t("table.deleteConfirmDescription")}
                    okText={t("table.delete")} cancelText={t("table.cancel")} okButtonProps={{ danger: true }}
                    disabled={account.active}
                    onConfirm={() => {
                      setTableActionMenuAccountId(null);
                      onDelete(account.id);
                    }}>
                    <button type="button" className="destructive" disabled={account.active}
                      title={account.active ? t("table.activeDeleteTooltip") : undefined}>
                      <Trash2 size={14} />
                      {t("table.delete")}
                    </button>
                  </Popconfirm>
                </div>
              )}>
              <Tooltip title={t("table.moreActions")}>
                <Button size="small" className="table-icon-button" aria-label={t("table.moreActions")}
                  icon={<MoreHorizontal size={16} />} />
              </Tooltip>
            </Dropdown>
          </Space>
        );
      },
    },
  ];

  if (displayMode === "cards") return <>
    <div className="account-card-grid">
      {orderedAccounts.map((account) => {
        const waiting = busyAccountId === account.id;
        const resetWaiting = resetCreditBusyAccountId === account.id;
        const isDisabled = isAccountDisabled(account, hotSwitchEnabled);
        const switchBlocked = hotSwitchEnabled
          ? !account.localProxyCompatible
          : !account.directSwitchCompatible;
        const switchBlockedReason = hotSwitchEnabled
          ? t("providers.proxy.agentIdentityUnsupported")
          : t("providers.proxy.agentIdentityProxyOnly");
        return (
          <article key={account.id} className={`account-card${account.active ? " active" : ""}${isDisabled ? " account-alert-card" : ""}`}
            title={switchBlocked ? switchBlockedReason : undefined}
            aria-disabled={switchBlocked}
            onClick={(event) => {
              if ((event.target as HTMLElement).closest("button, a, input, textarea, summary, details, .account-note-trigger")) return;
              setContextMenu(null);
              if (!account.active && !switchBlocked) onSwitch(account.id);
            }}
            onContextMenu={(event) => {
              if ((event.target as HTMLElement).closest("button, a, input, textarea, summary, details")) return;
              event.preventDefault();
              const menuWidth = 180;
              const menuHeight = hotSwitchEnabled ? 132 : 92;
              setContextMenu({
                accountId: account.id,
                x: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8)),
                y: Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8)),
              });
            }}>
            <div className="card-topline" />
            <header className="account-head">
              <div className="avatar">{initials(account.email)}</div>
              <div className="identity">
                <div className="identity-line">
                  <h3 title={privacyMode ? undefined : account.email}>{privacyMode ? maskAccountEmail(account.email) : account.email}</h3>
                  <Tooltip title={account.accountId ? t("table.workspace", { id: account.accountId }) : t("table.personal")}>
                    <Tag className="plan-tag">{account.plan || "ChatGPT"}</Tag>
                  </Tooltip>
                </div>
                <Tooltip title={privacyMode ? "**********" : account.note || t("note.doubleClick")}>
                  <div className="account-note-trigger" onClick={(event) => event.stopPropagation()}
                    onDoubleClick={() => setEditingAccount(account)} aria-label={t("note.doubleClick")}>
                    {privacyMode ? "**********" : account.note || t("note.doubleClick")}
                  </div>
                </Tooltip>
                <div className="plan-line">
                  {account.expiresAt && <span>{t("table.expiresAt", { date: account.expiresAt })}</span>}
                  {account.usage.error && <Tooltip title={account.usage.error}><Tag color="error">{t("table.error")}</Tag></Tooltip>}
                </div>
              </div>
              <div className="card-header-actions">
                <Tooltip title={t("table.refreshUsage")}><Button size="small" className="table-icon-button" loading={waiting}
                  icon={<RefreshCw size={14} />} onClick={() => onRefresh(account.id)} /></Tooltip>
                {contextMenu?.accountId === account.id && <div ref={contextMenuRef} className="context-menu"
                  style={{ left: contextMenu.x, top: contextMenu.y }} onClick={(event) => event.stopPropagation()}>
                  <Popconfirm title={t("table.useResetCreditConfirmTitle")}
                    description={<span className="reset-credit-confirm-description">{t("table.useResetCreditConfirmDescription")}</span>}
                    okText={t("table.useResetCreditOk")} cancelText={t("table.cancel")}
                    disabled={waiting || resetWaiting} onConfirm={() => {
                      setContextMenu(null);
                      onUseResetCredit(account.id);
                    }}>
                    <button type="button" disabled={waiting || resetWaiting}><CalendarClock size={14} />{t("table.useResetCredit")}</button>
                  </Popconfirm>
                  <button type="button" onClick={() => {
                    setContextMenu(null);
                    setResetCreditsAccount(account);
                    onLoadResetCredits(account.id);
                  }}><CalendarClock size={14} />{t("table.viewResetCredits")}</button>
                  {hotSwitchEnabled && <Tooltip title={switchBlocked ? switchBlockedReason : t("table.autoSwitchTooltip")}>
                    <button type="button" disabled={switchBlocked || autoSwitchBusyAccountId !== null}
                      onClick={() => {
                        setContextMenu(null);
                        onAutoSwitchEnabledChange(account.id, !account.autoSwitchEnabled);
                      }}>
                      {account.autoSwitchEnabled ? <ToggleLeft size={14} /> : <ToggleRight size={14} />}
                      {account.autoSwitchEnabled ? t("table.disableAutoSwitch") : t("table.enableAutoSwitch")}
                    </button>
                  </Tooltip>}
                  <Popconfirm title={t("table.deleteConfirmTitle")} description={t("table.deleteConfirmDescription")}
                    okText={t("table.delete")} cancelText={t("table.cancel")} okButtonProps={{ danger: true }} disabled={account.active}
                    onConfirm={() => {
                      setContextMenu(null);
                      onDelete(account.id);
                    }}>
                    <button type="button" className="destructive" disabled={account.active}><Trash2 size={14} />{t("table.delete")}</button>
                  </Popconfirm>
                </div>}
              </div>
            </header>
            <div className="account-card-usage">
              <section><span>{t("table.fiveHours")}</span><UsageMeter window={account.usage.primary} resetWindow="oneWeek"
                resetCreditsCount={resetCreditsCount(resetCredits[account.id])} fetchedAt={account.usage.fetchedAt}
                variant="circle" language={language} t={t} /></section>
              <section><span>{t("table.oneWeek")}</span><UsageMeter window={account.usage.secondary} resetWindow="oneWeek"
                variant="circle" language={language} t={t} /></section>
            </div>
          </article>
        );
      })}
    </div>
    {editingAccount && <AccountNoteModal key={editingAccount.id} account={editingAccount}
      onClose={() => setEditingAccount(null)}
      onSave={(note, expiresAt) => onSaveNote(editingAccount.id, note, expiresAt)} t={t} />}
    {resetCreditsAccount && <ResetCreditsModal state={resetCredits[resetCreditsAccount.id]} onClose={() => setResetCreditsAccount(null)}
      onRetry={() => onLoadResetCredits(resetCreditsAccount.id, true)} language={language} t={t} />}
  </>;

  return <>
    <div ref={tableWrapRef} className="account-table-wrap">
      <div className="account-table-toolbar">
        <Popconfirm title={t("table.batchDeleteConfirmTitle", { count: selectedAccountIds.length })}
          description={t("table.batchDeleteConfirmDescription")}
          okText={t("table.delete")} cancelText={t("table.cancel")} okButtonProps={{ danger: true }}
          disabled={!selectedAccountIds.length || bulkDeleteBusy}
          onConfirm={async () => {
            const ids = [...selectedAccountIds];
            setBulkDeleteBusy(true);
            try {
              const deletedIds = await onDeleteMany(ids);
              const deletedIdSet = new Set(deletedIds);
              setSelectedAccountIds((current) => current.filter((id) => !deletedIdSet.has(id)));
            } finally {
              setBulkDeleteBusy(false);
            }
          }}>
          <Button danger size="small" icon={<Trash2 size={14} />} loading={bulkDeleteBusy}
            disabled={!selectedAccountIds.length}>
            {t("table.batchDelete", { count: selectedAccountIds.length })}
          </Button>
        </Popconfirm>
      </div>
      <Table rowKey="id" size="small" tableLayout="fixed" columns={columns} dataSource={orderedAccounts} pagination={false}
        onChange={handleTableChange}
        rowSelection={{
          fixed: true,
          columnWidth: 36,
          selectedRowKeys: selectedAccountIds,
          onChange: (keys) => setSelectedAccountIds(keys.map(String)),
          getCheckboxProps: (account) => ({
            disabled: account.active,
            title: account.active ? t("table.activeDeleteTooltip") : undefined,
          }),
        }}
        rowClassName={(account) => [
          account.active ? "active-row" : "",
          isAccountDisabled(account, hotSwitchEnabled) ? "account-alert-row" : "",
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
        scroll={tableScrollY
          ? { x: customPriorityActive ? 1380 : 1230, y: tableScrollY }
          : { x: customPriorityActive ? 1380 : 1230 }} />
    </div>
    {editingAccount && <AccountNoteModal key={editingAccount.id} account={editingAccount}
      onClose={() => setEditingAccount(null)}
      onSave={(note, expiresAt) => onSaveNote(editingAccount.id, note, expiresAt)} t={t} />}
  </>;
}
