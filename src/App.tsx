import { memo, useCallback, useEffect, useState } from "react";
import { ConfigProvider, Tooltip, theme as antdTheme } from "antd";
import enUS from "antd/locale/en_US";
import zhCN from "antd/locale/zh_CN";
import { CalendarClock, Check, CircleHelp, Github, Plus, RefreshCw, RotateCcw, Settings, ShieldCheck, UserRound, Zap } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { checkForUpdate, isDesktopApp, restartCodex } from "./api/backend";
import { HelpModal } from "./components/modals/HelpModal";
import { FloatingUsageBubble } from "./components/FloatingUsageBubble";
import { LoginModal } from "./components/modals/LoginModal";
import { UpdateModal } from "./components/modals/UpdateModal";
import { useAccountManager } from "./hooks/useAccountManager";
import { useAccountAutoRefresh, useAutoRefresh } from "./hooks/useAutoRefresh";
import { useLanguage } from "./hooks/useLanguage";
import { useFloatingBubble } from "./hooks/useFloatingBubble";
import { useResetCredits } from "./hooks/useResetCredits";
import { useThemeColor } from "./hooks/useThemeColor";
import { useToast } from "./hooks/useToast";
import { AccountsPage } from "./pages/AccountsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { formatRefreshTime } from "./utils/format";
import type { UpdateInfo } from "./types";

const LAST_REFRESH_ALL_KEY = "codex-switch:last-refresh-all-at";
const REPOSITORY_URL = "https://github.com/piperhex/codex-switch.git";
const MemoAccountsPage = memo(AccountsPage);
const MemoSettingsPage = memo(SettingsPage);

function storedRefreshAllTime() {
  const value = window.localStorage.getItem(LAST_REFRESH_ALL_KEY);
  return value && !Number.isNaN(new Date(value).getTime()) ? value : null;
}

function DashboardApp() {
  const [page, setPage] = useState<"accounts" | "settings">("accounts");
  const [showLogin, setShowLogin] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [availableUpdate, setAvailableUpdate] = useState<UpdateInfo | null>(null);
  const [lastRefreshAllAt, setLastRefreshAllAt] = useState<string | null>(storedRefreshAllTime);
  const [restartingCodex, setRestartingCodex] = useState(false);
  const { message: toast, notify } = useToast();
  const { language, setLanguage, t } = useLanguage();
  const floatingBubble = useFloatingBubble(notify);
  const themeColor = useThemeColor(notify);
  const manager = useAccountManager(notify, t);
  const resetCredits = useResetCredits(manager.accounts, notify, t);
  const activeAccount = manager.accounts.find((account) => account.active) ?? null;
  const markRefreshAll = useCallback(() => {
    const refreshedAt = new Date().toISOString();
    window.localStorage.setItem(LAST_REFRESH_ALL_KEY, refreshedAt);
    setLastRefreshAllAt(refreshedAt);
  }, []);
  const automaticRefresh = useCallback(
    () => {
      markRefreshAll();
      return manager.refreshAll({ quiet: true, showSpinner: false });
    },
    [manager.refreshAll, markRefreshAll],
  );
  const autoRefresh = useAutoRefresh(manager.accounts.length > 0, automaticRefresh);
  const accountAutoRefresh = useAccountAutoRefresh(
    activeAccount?.id ?? null,
    (accountId) => manager.refreshUsage(accountId, true, false),
  );
  const openLogin = useCallback(() => setShowLogin(true), []);
  const switchAccount = useCallback((id: string) => {
    void manager.switchAccount(id);
  }, [manager.switchAccount]);
  const refreshUsage = useCallback((id: string) => {
    void manager.refreshUsage(id);
  }, [manager.refreshUsage]);
  const deleteAccount = useCallback((id: string) => {
    void manager.deleteAccount(id);
  }, [manager.deleteAccount]);
  const loadResetCredits = useCallback((id: string, force?: boolean) => {
    void resetCredits.refreshAccount(id, force);
  }, [resetCredits.refreshAccount]);
  const changeThemeColor = useCallback((color: string) => {
    void themeColor.setColor(color);
  }, [themeColor.setColor]);
  const changeFloatingBubble = useCallback((enabled: boolean) => {
    void floatingBubble.setEnabled(enabled);
  }, [floatingBubble.setEnabled]);

  useEffect(() => {
    let cancelled = false;
    void checkForUpdate()
      .then((update) => {
        if (!cancelled) setAvailableUpdate(update);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const startLogin = (embedded: boolean) => {
    setShowLogin(false);
    void manager.startLogin(embedded);
  };
  const importAuth = () => {
    setShowLogin(false);
    void manager.importAuth();
  };
  const refreshAll = () => {
    markRefreshAll();
    void manager.refreshAll();
  };
  const restartCodexProcess = useCallback(async () => {
    setRestartingCodex(true);
    try {
      await restartCodex();
      notify(isDesktopApp ? t("toast.codexRestarted") : t("toast.previewRestartCodex"));
    } catch (error) {
      notify(String(error));
    } finally {
      setRestartingCodex(false);
    }
  }, [notify, t]);
  const openRepository = () => {
    if ("__TAURI_INTERNALS__" in window) {
      void openUrl(REPOSITORY_URL).catch((error) => notify(String(error)));
      return;
    }
    window.open(REPOSITORY_URL, "_blank", "noopener,noreferrer");
  };
  const openRelease = () => {
    if (!availableUpdate) return;
    const releaseUrl = availableUpdate.releaseUrl;
    setAvailableUpdate(null);
    if (isDesktopApp) {
      void openUrl(releaseUrl).catch((error) => notify(String(error)));
      return;
    }
    window.open(releaseUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <ConfigProvider locale={language === "zh" ? zhCN : enUS} theme={{
      algorithm: antdTheme.compactAlgorithm,
      token: { colorPrimary: themeColor.color, borderRadius: 6, fontFamily: "\"DM Sans\", \"Microsoft YaHei UI\", sans-serif" },
    }}>
      <div className="app-shell">
        <header className="app-menu">
          <div className="brand"><div className="brand-mark"><Zap size={19} fill="currentColor" /></div>
            <span>Codex<br /><b>Switch</b></span></div>
          <nav className="top-tabs" aria-label={t("nav.aria")}>
            <button className={page === "accounts" ? "selected" : ""} onClick={() => setPage("accounts")}>
              <UserRound size={19} />{t("nav.accounts")}</button>
            <button className={page === "settings" ? "selected" : ""} onClick={() => setPage("settings")}>
              <Settings size={19} />{t("nav.settings")}</button>
          </nav>
          <div className="menu-tools">
            <div className="security-chip"><ShieldCheck size={16} /><span><b>{t("chip.title")}</b><small>{t("chip.description")}</small></span></div>
            <div className="help-actions">
              <button className="help-button" onClick={() => setShowHelp(true)}><CircleHelp size={17} />{t("help.open")}</button>
              <Tooltip title={t("help.github")}>
                <button type="button" className="github-button" aria-label={t("help.github")} onClick={openRepository}>
                  <Github size={18} />
                </button>
              </Tooltip>
            </div>
          </div>
        </header>

        <main>
          <header className="topbar">
            <div><span className="eyebrow">{t("topbar.eyebrow")}</span>
              <h1>{page === "settings" ? t("topbar.settings") : t("topbar.accounts", { count: manager.accounts.length })}</h1></div>
            {page === "accounts" && (
              <div className="topbar-actions">
                <button className="primary-button" onClick={openLogin}><Plus size={18} />{t("actions.addAccount")}</button>
                <div className="refresh-all-wrap">
                  <button className="refresh-all" onClick={refreshAll}
                    disabled={manager.refreshingAll || !manager.accounts.length}>
                    <RefreshCw className={manager.refreshingAll ? "spin" : ""} size={17} />{t("actions.refreshAll")}
                  </button>
                  <small className="last-auto-refresh">{t("actions.lastUpdated", { time: formatRefreshTime(lastRefreshAllAt, language) })}</small>
                </div>
                <button className="refresh-all" onClick={() => void resetCredits.refreshAll()}
                  disabled={resetCredits.refreshingAll || !manager.accounts.length}>
                  <CalendarClock className={resetCredits.refreshingAll ? "spin" : ""} size={17} />{t("actions.refreshResetCredits")}
                </button>
                <button className="refresh-all" onClick={() => void restartCodexProcess()} disabled={restartingCodex}>
                  <RotateCcw className={restartingCodex ? "spin" : ""} size={17} />{t("actions.restartCodex")}
                </button>
              </div>
            )}
          </header>

          <section className="page-panel" hidden={page !== "settings"}>
            <MemoSettingsPage info={manager.info} autoRefreshEnabled={autoRefresh.enabled}
              autoRefreshSeconds={autoRefresh.seconds} onEnabledChange={autoRefresh.setEnabled}
              onSecondsChange={autoRefresh.updateSeconds} currentAccountEmail={activeAccount?.email ?? null}
              accountAutoRefreshEnabled={accountAutoRefresh.enabled}
              accountAutoRefreshSeconds={accountAutoRefresh.seconds}
              onAccountAutoRefreshEnabledChange={accountAutoRefresh.setEnabled}
              onAccountAutoRefreshSecondsChange={accountAutoRefresh.updateSeconds}
              themeColor={themeColor.color} themeColorLoading={themeColor.loading}
              onThemeColorChange={changeThemeColor}
              floatingBubbleEnabled={floatingBubble.enabled}
              floatingBubbleLoading={floatingBubble.loading} onFloatingBubbleChange={changeFloatingBubble} language={language}
              onLanguageChange={setLanguage} t={t} />
          </section>
          <section className="page-panel" hidden={page !== "accounts"}>
            <MemoAccountsPage accounts={manager.accounts} loading={manager.loading}
              busyAccountId={manager.busyAccountId} onAdd={openLogin}
              onSwitch={switchAccount}
              onRefresh={refreshUsage}
              onDelete={deleteAccount}
              resetCredits={resetCredits.states}
              onLoadResetCredits={loadResetCredits}
              language={language} t={t} />
          </section>
        </main>

        {showLogin && <LoginModal onClose={() => setShowLogin(false)} onStart={startLogin} onImport={importAuth} t={t} />}
        {showHelp && <HelpModal onClose={() => setShowHelp(false)} version={manager.info?.version ?? "0.1.0"} t={t} />}
        {availableUpdate && <UpdateModal update={availableUpdate} onClose={() => setAvailableUpdate(null)}
          onDownload={openRelease} t={t} />}
        {toast && <div className="toast"><Check size={17} />{toast}</div>}
      </div>
    </ConfigProvider>
  );
}

export default function App() {
  if (new URLSearchParams(window.location.search).get("window") === "bubble") {
    return <FloatingUsageBubble />;
  }
  return <DashboardApp />;
}
