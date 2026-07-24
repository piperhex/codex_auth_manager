import { ArrowRight, LogIn, RefreshCw } from "lucide-react";
import { LocalProxyCard } from "../components/LocalProxyCard";
import type { Language, Translate } from "../i18n";
import type { AccountDisplayMode } from "../hooks/useAccountDisplayMode";
import type { Account, LocalProxyStatus, ResetCreditsLoadState } from "../types";
import { AccountTable } from "../components/accounts/AccountTable";

export function AccountsPage({
  accounts,
  loading,
  busyAccountId,
  localProxy,
  proxyBusy,
  conversationRestoreBusy,
  resetCredits,
  onAdd,
  onSwitch,
  onRefresh,
  onDelete,
  onDeleteMany,
  onEnableMany,
  onDisableMany,
  onAutoSwitchEnabledChange,
  autoSwitchBusyAccountId,
  onAutoSwitchPriorityChange,
  autoSwitchPriorityBusyAccountId,
  onCustomAutoSwitchPriorityEnabledChange,
  onSaveNote,
  onLoadResetCredits,
  onUseResetCredit,
  resetCreditBusyAccountId,
  onStartProxy,
  onStopProxy,
  onRestoreConversations,
  onAutoSwitchChange,
  onAutoDisableUnreachableChange,
  onImageAccountChange,
  onOpenaiAuthAccountChange,
  onListenOnAllInterfacesChange,
  privacyMode,
  displayMode,
  currentModel,
  tokenUsageRefreshSeconds,
  language,
  t,
}: {
  accounts: Account[];
  loading: boolean;
  busyAccountId: string | null;
  localProxy: LocalProxyStatus | null;
  proxyBusy: boolean;
  conversationRestoreBusy: boolean;
  resetCredits: Record<string, ResetCreditsLoadState>;
  onAdd: () => void;
  onSwitch: (id: string) => void;
  onRefresh: (id: string) => void;
  onDelete: (id: string) => void;
  onDeleteMany: (ids: string[]) => Promise<string[]>;
  onEnableMany: (ids: string[]) => Promise<string[]>;
  onDisableMany: (ids: string[]) => Promise<string[]>;
  onAutoSwitchEnabledChange: (id: string, enabled: boolean) => void;
  autoSwitchBusyAccountId: string | null;
  onAutoSwitchPriorityChange: (id: string, priority: number) => Promise<boolean>;
  autoSwitchPriorityBusyAccountId: string | null;
  onCustomAutoSwitchPriorityEnabledChange: (enabled: boolean) => void;
  onSaveNote: (id: string, note: string, expiresAt: string) => Promise<boolean>;
  onLoadResetCredits: (id: string, force?: boolean) => void;
  onUseResetCredit: (id: string) => void;
  resetCreditBusyAccountId: string | null;
  onStartProxy: () => void;
  onStopProxy: () => void;
  onRestoreConversations: () => void;
  onAutoSwitchChange: (enabled: boolean) => void;
  onAutoDisableUnreachableChange: (enabled: boolean) => void;
  onImageAccountChange: (accountId: string | null) => void;
  onOpenaiAuthAccountChange: (accountId: string | null) => void;
  onListenOnAllInterfacesChange: (enabled: boolean) => void;
  privacyMode: boolean;
  displayMode: AccountDisplayMode;
  currentModel: string;
  tokenUsageRefreshSeconds: number;
  language: Language;
  t: Translate;
}) {
  const hotSwitchEnabled = Boolean(localProxy?.running);
  const activeAccount = accounts.find((account) => account.active);
  const proxyStartDisabledReason = activeAccount && !activeAccount.localProxyCompatible
    ? t("providers.proxy.agentIdentityUnsupported")
    : undefined;
  const proxyCard = (
    <div className="home-proxy-wrap">
      <LocalProxyCard localProxy={localProxy} accounts={accounts} proxyBusy={proxyBusy}
        conversationRestoreBusy={conversationRestoreBusy}
        startDisabledReason={proxyStartDisabledReason}
        onStartProxy={onStartProxy} onStopProxy={onStopProxy}
        onRestoreConversations={onRestoreConversations}
        onAutoSwitchChange={onAutoSwitchChange}
        onCustomAutoSwitchPriorityEnabledChange={onCustomAutoSwitchPriorityEnabledChange}
        onAutoDisableUnreachableChange={onAutoDisableUnreachableChange}
        onImageAccountChange={onImageAccountChange}
        onListenOnAllInterfacesChange={onListenOnAllInterfacesChange} t={t} />
    </div>
  );
  if (loading) {
    return (
      <div className="accounts-page">
        {proxyCard}
        <div className="loading-state"><RefreshCw className="spin" />{t("accounts.loading")}</div>
      </div>
    );
  }
  if (!accounts.length) {
    return (
      <div className="accounts-page">
        {proxyCard}
        <div className="empty-state">
          <div><LogIn size={28} /></div><h2>{t("accounts.empty.title")}</h2>
          <p>{t("accounts.empty.description")}</p>
          <button className="primary-button" onClick={onAdd}>{t("accounts.empty.addFirst")}<ArrowRight size={17} /></button>
        </div>
      </div>
    );
  }
  return (
    <div className="accounts-page">
      {proxyCard}
      <AccountTable accounts={accounts} busyAccountId={busyAccountId}
        onSwitch={onSwitch} onRefresh={onRefresh} onDelete={onDelete}
        onDeleteMany={onDeleteMany} onEnableMany={onEnableMany} onDisableMany={onDisableMany}
        onAutoSwitchEnabledChange={onAutoSwitchEnabledChange} autoSwitchBusyAccountId={autoSwitchBusyAccountId}
        onAutoSwitchPriorityChange={onAutoSwitchPriorityChange}
        autoSwitchPriorityBusyAccountId={autoSwitchPriorityBusyAccountId}
        autoSwitchOnQuotaExhaustion={localProxy?.autoSwitchOnQuotaExhaustion ?? false}
        customAutoSwitchPriorityEnabled={localProxy?.customAutoSwitchPriorityEnabled ?? false}
        onSaveNote={onSaveNote}
        resetCredits={resetCredits} onLoadResetCredits={onLoadResetCredits}
        onUseResetCredit={onUseResetCredit} resetCreditBusyAccountId={resetCreditBusyAccountId}
        hotSwitchEnabled={hotSwitchEnabled} privacyMode={privacyMode} displayMode={displayMode}
        openaiAuthAccountId={localProxy?.openaiAuthAccountId ?? null} openaiAuthBusy={proxyBusy}
        onOpenaiAuthAccountChange={onOpenaiAuthAccountChange}
        currentModel={currentModel} tokenUsageRefreshSeconds={tokenUsageRefreshSeconds}
        language={language} t={t} />
    </div>
  );
}
