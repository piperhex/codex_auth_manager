import { ArrowRight, LogIn, RefreshCw } from "lucide-react";
import { LocalProxyCard } from "../components/LocalProxyCard";
import type { Language, Translate } from "../i18n";
import type { Account, LocalProxyStatus, ResetCreditsLoadState } from "../types";
import { AccountTable } from "../components/accounts/AccountTable";

export function AccountsPage({
  accounts,
  loading,
  busyAccountId,
  localProxy,
  proxyBusy,
  resetCredits,
  onAdd,
  onSwitch,
  onRefresh,
  onDelete,
  onSaveNote,
  onLoadResetCredits,
  onStartProxy,
  onStopProxy,
  language,
  t,
}: {
  accounts: Account[];
  loading: boolean;
  busyAccountId: string | null;
  localProxy: LocalProxyStatus | null;
  proxyBusy: boolean;
  resetCredits: Record<string, ResetCreditsLoadState>;
  onAdd: () => void;
  onSwitch: (id: string) => void;
  onRefresh: (id: string) => void;
  onDelete: (id: string) => void;
  onSaveNote: (id: string, note: string, expiresAt: string) => Promise<boolean>;
  onLoadResetCredits: (id: string, force?: boolean) => void;
  onStartProxy: () => void;
  onStopProxy: () => void;
  language: Language;
  t: Translate;
}) {
  const hotSwitchEnabled = Boolean(localProxy?.running);
  const proxyCard = (
    <div className="home-proxy-wrap">
      <LocalProxyCard localProxy={localProxy} proxyBusy={proxyBusy}
        onStartProxy={onStartProxy} onStopProxy={onStopProxy} t={t} />
    </div>
  );
  if (loading) {
    return (
      <>
        {proxyCard}
        <div className="loading-state"><RefreshCw className="spin" />{t("accounts.loading")}</div>
      </>
    );
  }
  if (!accounts.length) {
    return (
      <>
        {proxyCard}
        <div className="empty-state">
          <div><LogIn size={28} /></div><h2>{t("accounts.empty.title")}</h2>
          <p>{t("accounts.empty.description")}</p>
          <button className="primary-button" onClick={onAdd}>{t("accounts.empty.addFirst")}<ArrowRight size={17} /></button>
        </div>
      </>
    );
  }
  return (
    <>
      {proxyCard}
      <AccountTable accounts={accounts} busyAccountId={busyAccountId}
        onSwitch={onSwitch} onRefresh={onRefresh} onDelete={onDelete}
        onSaveNote={onSaveNote}
        resetCredits={resetCredits} onLoadResetCredits={onLoadResetCredits}
        hotSwitchEnabled={hotSwitchEnabled} language={language} t={t} />
    </>
  );
}
