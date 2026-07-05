import { ArrowRight, LogIn, RefreshCw } from "lucide-react";
import type { Language, Translate } from "../i18n";
import type { Account, ResetCreditsLoadState } from "../types";
import { AccountTable } from "../components/accounts/AccountTable";

export function AccountsPage({
  accounts,
  loading,
  busyAccountId,
  resetCredits,
  onAdd,
  onSwitch,
  onRefresh,
  onDelete,
  onSaveNote,
  onLoadResetCredits,
  language,
  t,
}: {
  accounts: Account[];
  loading: boolean;
  busyAccountId: string | null;
  resetCredits: Record<string, ResetCreditsLoadState>;
  onAdd: () => void;
  onSwitch: (id: string) => void;
  onRefresh: (id: string) => void;
  onDelete: (id: string) => void;
  onSaveNote: (id: string, note: string, expiresAt: string) => Promise<boolean>;
  onLoadResetCredits: (id: string, force?: boolean) => void;
  language: Language;
  t: Translate;
}) {
  if (loading) return <div className="loading-state"><RefreshCw className="spin" />{t("accounts.loading")}</div>;
  if (!accounts.length) {
    return (
      <div className="empty-state">
        <div><LogIn size={28} /></div><h2>{t("accounts.empty.title")}</h2>
        <p>{t("accounts.empty.description")}</p>
        <button className="primary-button" onClick={onAdd}>{t("accounts.empty.addFirst")}<ArrowRight size={17} /></button>
      </div>
    );
  }
  return <AccountTable accounts={accounts} busyAccountId={busyAccountId}
    onSwitch={onSwitch} onRefresh={onRefresh} onDelete={onDelete}
    onSaveNote={onSaveNote}
    resetCredits={resetCredits} onLoadResetCredits={onLoadResetCredits} language={language} t={t} />;
}
