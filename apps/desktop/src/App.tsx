import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfigProvider, Popconfirm, Tooltip, theme as antdTheme } from "antd";
import enUS from "antd/locale/en_US";
import zhCN from "antd/locale/zh_CN";
import { BarChart3, CalendarClock, Check, CircleHelp, Cloud, Download, Github, LogIn, LogOut, Plus, RefreshCw, RotateCcw, Server, Settings, ShieldCheck, Upload, UploadCloud, UserRound } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { checkForUpdate, chooseAndExportDiagnosticLogs, isDesktopApp, openManagedFolder, restartCodex, showTokenUsageWindow } from "./api/backend";
import { HelpModal, type HelpVersionState } from "./components/modals/HelpModal";
import { FloatingUsageBubble } from "./components/FloatingUsageBubble";
import { TokenUsageWindow } from "./components/TokenUsageWindow";
import { CloudLoginModal } from "./components/modals/CloudLoginModal";
import { LoginModal } from "./components/modals/LoginModal";
import { UpdateModal } from "./components/modals/UpdateModal";
import { useAccountManager } from "./hooks/useAccountManager";
import { useAccountAutoRefresh, useAutoRefresh } from "./hooks/useAutoRefresh";
import { useCloudAuth } from "./hooks/useCloudAuth";
import { useLanguage } from "./hooks/useLanguage";
import { useFloatingBubble } from "./hooks/useFloatingBubble";
import { useProviderManager } from "./hooks/useProviderManager";
import { useResetCredits } from "./hooks/useResetCredits";
import { useThemeColor } from "./hooks/useThemeColor";
import { useToast } from "./hooks/useToast";
import { AccountsPage } from "./pages/AccountsPage";
import { ProvidersPage } from "./pages/ProvidersPage";
import { SettingsPage } from "./pages/SettingsPage";
import { formatRefreshTime } from "./utils/format";
import type { UpdateInfo } from "./types";

const LAST_REFRESH_ALL_KEY = "codex-switch:last-refresh-all-at";
const IGNORED_UPDATE_VERSION_KEY = "codex-switch:ignored-update-version";
const REPOSITORY_URL = "https://github.com/piperhex/codex-switch.git";
const APP_LOGO_URL = new URL("../src-tauri/icons/128x128.png", import.meta.url).href;
const MemoAccountsPage = memo(AccountsPage);
const MemoProvidersPage = memo(ProvidersPage);
const MemoSettingsPage = memo(SettingsPage);

function storedRefreshAllTime() {
  const value = window.localStorage.getItem(LAST_REFRESH_ALL_KEY);
  return value && !Number.isNaN(new Date(value).getTime()) ? value : null;
}

function shouldShowUpdate(update: UpdateInfo | null) {
  return update?.latestVersion === window.localStorage.getItem(IGNORED_UPDATE_VERSION_KEY) ? null : update;
}

function DashboardApp() {
  const [page, setPage] = useState<"accounts" | "providers" | "settings">("accounts");
  const [showLogin, setShowLogin] = useState(false);
  const [showCloudLogin, setShowCloudLogin] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [helpVersionState, setHelpVersionState] = useState<HelpVersionState>({ status: "checking" });
  const [availableUpdate, setAvailableUpdate] = useState<UpdateInfo | null>(null);
  const [lastRefreshAllAt, setLastRefreshAllAt] = useState<string | null>(storedRefreshAllTime);
  const [restartingCodex, setRestartingCodex] = useState(false);
  const [exportingLogs, setExportingLogs] = useState(false);
  const helpVersionRequestId = useRef(0);
  const { message: toast, notify } = useToast();
  const { language, setLanguage, t } = useLanguage();
  const cloud = useCloudAuth(notify, t);
  const accountCloudSync = useMemo(() => ({
    pushAccount: cloud.pushAccountQuietly,
    deleteAccount: cloud.deleteAccountQuietly,
  }), [cloud.deleteAccountQuietly, cloud.pushAccountQuietly]);
  const floatingBubble = useFloatingBubble(notify);
  const themeColor = useThemeColor(notify);
  const manager = useAccountManager(notify, t, accountCloudSync);
  const providerManager = useProviderManager(notify, t);
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
  const openCloudLogin = useCallback(() => setShowCloudLogin(true), []);
  const switchAccount = useCallback((id: string) => {
    void manager.switchAccount(id);
  }, [manager.switchAccount]);
  const refreshUsage = useCallback((id: string) => {
    void manager.refreshUsage(id);
  }, [manager.refreshUsage]);
  const deleteAccount = useCallback((id: string) => {
    void manager.deleteAccount(id);
  }, [manager.deleteAccount]);
  const saveAccountNote = useCallback((id: string, note: string, expiresAt: string) => (
    manager.saveAccountNote(id, note, expiresAt)
  ), [manager.saveAccountNote]);
  const switchProvider = useCallback((id: string) => {
    void providerManager.switchProvider(id);
  }, [providerManager.switchProvider]);
  const switchProviderModel = useCallback((id: string, model: string) => {
    void providerManager.switchModel(id, model);
  }, [providerManager.switchModel]);
  const setProviderModelControl = useCallback((id: string, controlledByCodex: boolean) => {
    void providerManager.setModelControl(id, controlledByCodex);
  }, [providerManager.setModelControl]);
  const useOfficialProvider = useCallback(() => {
    void providerManager.useOfficialProvider();
  }, [providerManager.useOfficialProvider]);
  const deleteProvider = useCallback((id: string) => {
    void providerManager.deleteProvider(id);
  }, [providerManager.deleteProvider]);
  const loadResetCredits = useCallback((id: string, force?: boolean) => {
    void resetCredits.refreshAccount(id, force);
  }, [resetCredits.refreshAccount]);
  const changeThemeColor = useCallback((color: string) => {
    void themeColor.setColor(color);
  }, [themeColor.setColor]);
  const saveCloudBaseUrl = useCallback(async (baseUrl: string) => {
    await cloud.saveBaseUrl(baseUrl);
  }, [cloud.saveBaseUrl]);
  const loginCloudAccount = useCallback(async (email: string, password: string) => {
    const ok = await cloud.login(email, password);
    if (ok) await manager.reload();
    return ok;
  }, [cloud.login, manager.reload]);
  const syncCloud = useCallback(async () => {
    const result = await cloud.sync();
    if (result) await manager.reload();
  }, [cloud.sync, manager.reload]);
  const changeFloatingBubble = useCallback((enabled: boolean) => {
    void floatingBubble.setEnabled(enabled);
  }, [floatingBubble.setEnabled]);
  const openFolder = useCallback((target: "codexHome" | "accountStore") => {
    if (!isDesktopApp) {
      notify(t("toast.previewOpenFolder"));
      return;
    }
    void openManagedFolder(target).catch((error) => notify(String(error)));
  }, [notify, t]);
  const openCodexHome = useCallback(() => {
    openFolder("codexHome");
  }, [openFolder]);
  const openAccountStore = useCallback(() => {
    openFolder("accountStore");
  }, [openFolder]);
  const exportLogs = useCallback(async () => {
    notify(isDesktopApp ? t("toast.exportLogsPrompt") : t("toast.previewNoFile"));
    setExportingLogs(true);
    try {
      const result = await chooseAndExportDiagnosticLogs();
      if (result.status === "exported") notify(t("toast.logsExported"));
    } catch (error) {
      notify(String(error));
    } finally {
      setExportingLogs(false);
    }
  }, [notify, t]);
  const openHelp = useCallback(() => {
    const requestId = ++helpVersionRequestId.current;
    setShowHelp(true);
    setHelpVersionState({ status: "checking" });
    void checkForUpdate({ force: true })
      .then((update) => {
        if (helpVersionRequestId.current !== requestId) return;
        setHelpVersionState(update
          ? { status: "available", latestVersion: update.latestVersion }
          : { status: "latest" });
      })
      .catch(() => {
        if (helpVersionRequestId.current === requestId) setHelpVersionState({ status: "error" });
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void checkForUpdate()
      .then((update) => {
        if (!cancelled) setAvailableUpdate(shouldShowUpdate(update));
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
  const openTokenUsage = useCallback(async () => {
    try {
      await showTokenUsageWindow();
    } catch (error) {
      notify(String(error));
    }
  }, [notify]);
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
  const ignoreUpdate = useCallback(() => {
    if (!availableUpdate) return;
    window.localStorage.setItem(IGNORED_UPDATE_VERSION_KEY, availableUpdate.latestVersion);
    setAvailableUpdate(null);
  }, [availableUpdate]);

  return (
    <ConfigProvider locale={language === "zh" ? zhCN : enUS} theme={{
      algorithm: antdTheme.compactAlgorithm,
      token: { colorPrimary: themeColor.color, borderRadius: 6, fontFamily: "\"DM Sans\", \"Microsoft YaHei UI\", sans-serif" },
    }}>
      <div className="app-shell">
        <header className="app-menu">
          <div className="brand"><img className="brand-logo" src={APP_LOGO_URL} alt="" />
            <span>Codex<br /><b>Switch</b></span></div>
          <nav className="top-tabs" aria-label={t("nav.aria")}>
            <button className={page === "accounts" ? "selected" : ""} onClick={() => setPage("accounts")}>
              <UserRound size={19} />{t("nav.accounts")}</button>
            <button className={page === "providers" ? "selected" : ""} onClick={() => setPage("providers")}>
              <Server size={19} />{t("nav.providers")}</button>
            <button className={page === "settings" ? "selected" : ""} onClick={() => setPage("settings")}>
              <Settings size={19} />{t("nav.settings")}</button>
          </nav>
          <div className="menu-tools">
            {cloud.state.enabled ? (
              cloud.state.authenticated ? (
                <div className="cloud-chip">
                  <Cloud size={16} /><span><b>{cloud.state.userEmail ?? t("cloud.signedIn")}</b><small>{t("cloud.synced")}</small></span>
                  <div className="cloud-chip-actions">
                    <Tooltip title={t("cloud.sync")}>
                      <button type="button" className="cloud-icon-button" aria-label={t("cloud.sync")}
                        disabled={cloud.syncing} onClick={() => void syncCloud()}>
                        <UploadCloud className={cloud.syncing ? "spin" : ""} size={16} />
                      </button>
                    </Tooltip>
                    <Tooltip title={t("cloud.logout")}>
                      <button type="button" className="cloud-icon-button" aria-label={t("cloud.logout")}
                        disabled={cloud.loading} onClick={() => void cloud.logout()}>
                        <LogOut size={16} />
                      </button>
                    </Tooltip>
                  </div>
                </div>
              ) : (
                <button type="button" className="cloud-login-chip" disabled={cloud.loading} onClick={openCloudLogin}>
                  <LogIn size={16} /><span><b>{t("cloud.login")}</b><small>{t("cloud.loginDescription")}</small></span>
                </button>
              )
            ) : (
              <div className="security-chip"><ShieldCheck size={16} /><span><b>{t("chip.title")}</b><small>{t("chip.description")}</small></span></div>
            )}
            <div className="help-actions">
              <button className="help-button" onClick={openHelp}><CircleHelp size={17} />{t("help.open")}</button>
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
            <div><span className="eyebrow">{page === "providers" ? t("topbar.providersEyebrow") : t("topbar.eyebrow")}</span>
              <h1>{page === "settings"
                ? t("topbar.settings")
                : page === "providers"
                  ? t("topbar.providers", { count: providerManager.providers.length })
                  : t("topbar.accounts", { count: manager.accounts.length })}</h1></div>
            {page === "accounts" && (
              <div className="topbar-actions">
                <button className="primary-button" onClick={openLogin}><Plus size={18} />{t("actions.addAccount")}</button>
                <Tooltip title={t("actions.importArchive")}>
                  <button type="button" className="topbar-icon-button" aria-label={t("actions.importArchive")}
                    disabled={manager.archiveOperation !== null}
                    onClick={() => void manager.importAccountArchive()}>
                    <Upload className={manager.archiveOperation === "import" ? "spin" : ""} size={17} />
                    <span>{t("actions.importArchiveLabel")}</span>
                  </button>
                </Tooltip>
                <Tooltip title={t("actions.exportArchive")}>
                  <button type="button" className="topbar-icon-button" aria-label={t("actions.exportArchive")}
                    disabled={manager.archiveOperation !== null || !manager.accounts.length}
                    onClick={() => void manager.exportAccountArchive()}>
                    <Download className={manager.archiveOperation === "export" ? "spin" : ""} size={17} />
                    <span>{t("actions.exportArchiveLabel")}</span>
                  </button>
                </Tooltip>
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
                <Popconfirm title={t("actions.restartCodexConfirmTitle")}
                  description={t("actions.restartCodexConfirmDescription")}
                  okText={t("actions.restartCodex")} cancelText={t("table.cancel")}
                  okButtonProps={{ danger: true }} disabled={restartingCodex}
                  onConfirm={() => void restartCodexProcess()}>
                  <Tooltip title={t("actions.restartCodexHint")}>
                    <button className="refresh-all restart-codex-button" disabled={restartingCodex}>
                      <RotateCcw className={restartingCodex ? "spin" : ""} size={17} />{t("actions.restartCodex")}
                    </button>
                  </Tooltip>
                </Popconfirm>
              </div>
            )}
            {page === "providers" && (
              <div className="topbar-actions">
                <Tooltip title="Token 消耗汇总">
                  <button className="refresh-all" onClick={() => void openTokenUsage()}>
                    <BarChart3 size={17} />Token 汇总
                  </button>
                </Tooltip>
                <Popconfirm title={t("actions.restartCodexConfirmTitle")}
                  description={t("actions.restartCodexConfirmDescription")}
                  okText={t("actions.restartCodex")} cancelText={t("table.cancel")}
                  okButtonProps={{ danger: true }} disabled={restartingCodex}
                  onConfirm={() => void restartCodexProcess()}>
                  <Tooltip title={t("actions.restartCodexHint")}>
                    <button className="refresh-all restart-codex-button" disabled={restartingCodex}>
                      <RotateCcw className={restartingCodex ? "spin" : ""} size={17} />{t("actions.restartCodex")}
                    </button>
                  </Tooltip>
                </Popconfirm>
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
              cloudBaseUrl={cloud.state.baseUrl ?? ""}
              cloudBaseUrlLoading={cloud.loading}
              cloudAuthenticated={cloud.state.authenticated}
              onCloudBaseUrlSave={saveCloudBaseUrl}
              floatingBubbleEnabled={floatingBubble.enabled}
              floatingBubbleLoading={floatingBubble.loading} onFloatingBubbleChange={changeFloatingBubble}
              onOpenCodexHome={openCodexHome} onOpenAccountStore={openAccountStore} language={language}
              onExportLogs={() => void exportLogs()} exportingLogs={exportingLogs}
              onLanguageChange={setLanguage} t={t} />
          </section>
          <section className="page-panel" hidden={page !== "providers"}>
            <MemoProvidersPage providers={providerManager.providers} loading={providerManager.loading}
              busyProviderId={providerManager.busyProviderId} saving={providerManager.saving}
              localProxy={providerManager.localProxy} proxyBusy={providerManager.proxyBusy}
              info={manager.info} onSave={providerManager.saveProvider}
              onSwitch={switchProvider} onSwitchModel={switchProviderModel}
              onModelControlChange={setProviderModelControl}
              onDisable={useOfficialProvider} onDelete={deleteProvider}
              onStartProxy={providerManager.startProxy} onStopProxy={providerManager.stopProxy} t={t} />
          </section>
          <section className="page-panel" hidden={page !== "accounts"}>
            <MemoAccountsPage accounts={manager.accounts} loading={manager.loading}
              busyAccountId={manager.busyAccountId} onAdd={openLogin}
              localProxy={providerManager.localProxy} proxyBusy={providerManager.proxyBusy}
              onSwitch={switchAccount}
              onRefresh={refreshUsage}
              onDelete={deleteAccount}
              onSaveNote={saveAccountNote}
              resetCredits={resetCredits.states}
              onLoadResetCredits={loadResetCredits}
              onStartProxy={providerManager.startProxy} onStopProxy={providerManager.stopProxy}
              language={language} t={t} />
          </section>
        </main>

        {showLogin && <LoginModal onClose={() => setShowLogin(false)} onStart={startLogin} onImport={importAuth} t={t} />}
        {showCloudLogin && <CloudLoginModal loading={cloud.loading} onClose={() => setShowCloudLogin(false)}
          onLogin={loginCloudAccount} t={t} />}
        {showHelp && <HelpModal onClose={() => setShowHelp(false)} version={manager.info?.version ?? "0.1.0"}
          versionState={helpVersionState} t={t} />}
        {availableUpdate && <UpdateModal update={availableUpdate} onClose={() => setAvailableUpdate(null)}
          onIgnore={ignoreUpdate} onDownload={openRelease} t={t} />}
        {toast && <div className="toast"><Check size={17} />{toast}</div>}
      </div>
    </ConfigProvider>
  );
}

export default function App() {
  const normalizeWindowName = (value: string | null) => (
    (value ?? "").replace(/^#\/?/, "").split(/[?#]/)[0]
  );
  const windowName = normalizeWindowName(new URLSearchParams(window.location.search).get("window"))
    || normalizeWindowName(window.location.hash);
  if (windowName === "bubble") {
    return <FloatingUsageBubble />;
  }
  if (windowName === "token-usage") {
    return <TokenUsageWindow />;
  }
  return <DashboardApp />;
}
