import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfigProvider, Popconfirm, Tooltip, theme as antdTheme } from "antd";
import enUS from "antd/locale/en_US";
import zhCN from "antd/locale/zh_CN";
import { BarChart3, CalendarClock, Check, CircleHelp, Cloud, Download, Github, LogIn, LogOut, Megaphone, Plus, RefreshCw, RotateCcw, Server, Settings, ShieldCheck, Upload, UploadCloud, UserRound } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { checkForUpdate, chooseAndExportDiagnosticLogs, consumeResetCredit, DEFAULT_CLOUD_BASE_URL, fetchCloudAnnouncement, isDesktopApp, openManagedFolder, reportBaseUrlChange, reportFirstInstallation, restartChatGpt, showTokenUsageWindow, submitFeedback, syncDirectConversations } from "./api/backend";
import { HelpModal, type HelpVersionState } from "./components/modals/HelpModal";
import { FeedbackModal } from "./components/modals/FeedbackModal";
import { FloatingUsageBubble } from "./components/FloatingUsageBubble";
import { TokenUsageWindow } from "./components/TokenUsageWindow";
import { CloudLoginModal } from "./components/modals/CloudLoginModal";
import { LoginModal } from "./components/modals/LoginModal";
import { UpdateModal } from "./components/modals/UpdateModal";
import { useAccountManager } from "./hooks/useAccountManager";
import { useAccountAutoRefresh, useAutoRefresh } from "./hooks/useAutoRefresh";
import { useAccountDisplayMode } from "./hooks/useAccountDisplayMode";
import { useBubbleResetDisplay } from "./hooks/useBubbleResetDisplay";
import { useCloudAuth } from "./hooks/useCloudAuth";
import { useLanguage } from "./hooks/useLanguage";
import { useFloatingBubble } from "./hooks/useFloatingBubble";
import { useProviderManager } from "./hooks/useProviderManager";
import { usePrivacyMode } from "./hooks/usePrivacyMode";
import { useResetCredits } from "./hooks/useResetCredits";
import { useThemeColor } from "./hooks/useThemeColor";
import { useToast } from "./hooks/useToast";
import { AccountsPage } from "./pages/AccountsPage";
import { ProvidersPage } from "./pages/ProvidersPage";
import { SettingsPage } from "./pages/SettingsPage";
import { formatRefreshTime } from "./utils/format";
import type { BubbleResetDisplay, CloudAnnouncement, UpdateInfo } from "./types";

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
  const [showFeedback, setShowFeedback] = useState(false);
  const [helpVersionState, setHelpVersionState] = useState<HelpVersionState>({ status: "checking" });
  const [availableUpdate, setAvailableUpdate] = useState<UpdateInfo | null>(null);
  const [lastRefreshAllAt, setLastRefreshAllAt] = useState<string | null>(storedRefreshAllTime);
  const [restartingChatGpt, setRestartingChatGpt] = useState(false);
  const [syncingDirectConversations, setSyncingDirectConversations] = useState(false);
  const [exportingLogs, setExportingLogs] = useState(false);
  const [resetCreditBusyAccountId, setResetCreditBusyAccountId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<CloudAnnouncement | null>(null);
  const helpVersionRequestId = useRef(0);
  const announcementRequestId = useRef(0);
  const { message: toast, notify } = useToast();
  const { language, setLanguage, t } = useLanguage();
  const cloud = useCloudAuth(notify, t);
  const accountCloudSync = useMemo(() => ({
    pushAll: cloud.pushQuietly,
    pushAccount: cloud.pushAccountQuietly,
    deleteAccount: cloud.deleteAccountQuietly,
  }), [cloud.deleteAccountQuietly, cloud.pushAccountQuietly, cloud.pushQuietly]);
  const providerCloudSync = useMemo(() => ({
    pushProvider: cloud.pushProviderQuietly,
    deleteProvider: cloud.deleteProviderQuietly,
  }), [cloud.deleteProviderQuietly, cloud.pushProviderQuietly]);
  const floatingBubble = useFloatingBubble(notify);
  const bubbleResetDisplay = useBubbleResetDisplay(notify);
  const privacyMode = usePrivacyMode(notify);
  const accountDisplayMode = useAccountDisplayMode();
  const themeColor = useThemeColor(notify);
  const manager = useAccountManager(notify, t, accountCloudSync);
  const providerManager = useProviderManager(notify, t, providerCloudSync);
  const resetCredits = useResetCredits(manager.accounts, notify, t);
  const activeAccount = manager.accounts.find((account) => account.active) ?? null;
  const loadAnnouncement = useCallback(async () => {
    const requestId = ++announcementRequestId.current;
    try {
      const result = await fetchCloudAnnouncement();
      if (announcementRequestId.current === requestId) {
        setAnnouncement(result.enabled && result.content.trim() ? result : null);
      }
    } catch {
      if (announcementRequestId.current === requestId) setAnnouncement(null);
    }
  }, []);
  const markRefreshAll = useCallback(() => {
    const refreshedAt = new Date().toISOString();
    window.localStorage.setItem(LAST_REFRESH_ALL_KEY, refreshedAt);
    setLastRefreshAllAt(refreshedAt);
  }, []);
  const automaticRefresh = useCallback(
    async () => {
      markRefreshAll();
      await Promise.all([
        manager.refreshAll({ quiet: true, showSpinner: false }),
        loadAnnouncement(),
      ]);
    },
    [loadAnnouncement, manager.refreshAll, markRefreshAll],
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
  const setAccountAutoSwitchEnabled = useCallback((id: string, enabled: boolean) => {
    void manager.setAutoSwitchEnabled(id, enabled);
  }, [manager.setAutoSwitchEnabled]);
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
  const deleteProvider = useCallback((id: string) => {
    void providerManager.deleteProvider(id);
  }, [providerManager.deleteProvider]);
  const loadResetCredits = useCallback((id: string, force?: boolean) => {
    void resetCredits.refreshAccount(id, force);
  }, [resetCredits.refreshAccount]);
  const useResetCredit = useCallback(async (id: string) => {
    setResetCreditBusyAccountId(id);
    try {
      await consumeResetCredit(id);
      notify(t("toast.resetCreditConsumed"));
      await Promise.allSettled([
        resetCredits.refreshAccount(id, true),
        manager.refreshUsage(id, true, false),
      ]);
    } catch (error) {
      notify(String(error));
    } finally {
      setResetCreditBusyAccountId(null);
    }
  }, [manager.refreshUsage, notify, resetCredits.refreshAccount, t]);
  const changeThemeColor = useCallback((color: string) => {
    void themeColor.setColor(color);
  }, [themeColor.setColor]);
  const saveCloudBaseUrl = useCallback(async (baseUrl: string) => {
    const previousBaseUrl = cloud.state.baseUrl?.trim().replace(/\/+$/, "") ?? "";
    const requestedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
    if (previousBaseUrl && !requestedBaseUrl) {
      await reportBaseUrlChange().catch(() => undefined);
    }
    const nextState = await cloud.saveBaseUrl(baseUrl);
    const nextBaseUrl = nextState.baseUrl?.trim().replace(/\/+$/, "") ?? "";
    if (nextBaseUrl && nextBaseUrl !== previousBaseUrl) {
      void reportBaseUrlChange().catch(() => undefined);
    }
  }, [cloud.saveBaseUrl, cloud.state.baseUrl]);
  const loginCloudAccount = useCallback(async (email: string, password: string) => {
    const ok = await cloud.login(email, password);
    if (ok) await manager.reload();
    return ok;
  }, [cloud.login, manager.reload]);
  const registerCloudAccount = useCallback(async (email: string, password: string, verificationCode: string) => {
    const ok = await cloud.register(email, password, verificationCode);
    if (ok) await manager.reload();
    return ok;
  }, [cloud.register, manager.reload]);
  const openCloudPasswordReset = useCallback(() => {
    const baseUrl = (cloud.state.baseUrl?.trim() || DEFAULT_CLOUD_BASE_URL).replace(/\/+$/, "");
    const resetUrl = `${baseUrl}/admin/reset-password`;
    if (isDesktopApp) {
      void openUrl(resetUrl).catch((error) => notify(String(error)));
      return;
    }
    window.open(resetUrl, "_blank", "noopener,noreferrer");
  }, [cloud.state.baseUrl, notify]);
  const syncCloud = useCallback(async () => {
    const result = await cloud.sync();
    if (result) {
      await manager.reload();
      await providerManager.reload();
    }
  }, [cloud.sync, manager.reload, providerManager.reload]);
  const changeFloatingBubble = useCallback((enabled: boolean) => {
    void floatingBubble.setEnabled(enabled);
  }, [floatingBubble.setEnabled]);
  const changeBubbleResetDisplay = useCallback((display: BubbleResetDisplay) => {
    void bubbleResetDisplay.setDisplay(display);
  }, [bubbleResetDisplay.setDisplay]);
  const changePrivacyMode = useCallback((enabled: boolean) => {
    void privacyMode.setEnabled(enabled);
  }, [privacyMode.setEnabled]);
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
          ? { status: "available", latestVersion: update.latestVersion, releaseUrl: update.releaseUrl }
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
  const sendFeedback = useCallback(async (content: string, images: File[]) => {
    await submitFeedback(content, manager.info?.version ?? "0.1.0", images);
    notify(t("feedback.success"));
  }, [manager.info?.version, notify, t]);

  useEffect(() => {
    setAnnouncement(null);
    void loadAnnouncement();
    const timer = window.setInterval(() => void loadAnnouncement(), 60 * 60 * 1000);
    return () => {
      announcementRequestId.current += 1;
      window.clearInterval(timer);
    };
  }, [cloud.state.baseUrl, loadAnnouncement]);

  useEffect(() => {
    void reportFirstInstallation().catch(() => undefined);
  }, [cloud.state.baseUrl]);

  const startLogin = (embedded: boolean) => {
    setShowLogin(false);
    void manager.startLogin(embedded);
  };
  const importAuth = () => {
    setShowLogin(false);
    void manager.importAuth();
  };
  const importCompatibleJson = () => {
    setShowLogin(false);
    void manager.importCompatibleJson();
  };
  const refreshAll = () => {
    markRefreshAll();
    void manager.refreshAll();
    void loadAnnouncement();
  };
  const restartChatGptProcess = useCallback(async () => {
    setRestartingChatGpt(true);
    try {
      await restartChatGpt();
      notify(isDesktopApp ? t("toast.chatGptRestarted") : t("toast.previewRestartChatGpt"));
    } catch (error) {
      notify(String(error));
    } finally {
      setRestartingChatGpt(false);
    }
  }, [notify, t]);
  const syncDirectConversationHistory = useCallback(async () => {
    setSyncingDirectConversations(true);
    try {
      const result = await syncDirectConversations();
      if (!isDesktopApp) {
        notify(t("toast.previewSyncDirectConversations"));
      } else if (result.conversationsUpdated > 0) {
        notify(t("toast.directConversationsSynced", { count: result.conversationsUpdated }));
      } else {
        notify(t("toast.directConversationsAlreadySynced"));
      }
    } catch (error) {
      notify(String(error));
    } finally {
      setSyncingDirectConversations(false);
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
  const openRelease = (releaseUrl: string) => {
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
          <div className="announcement-slot" aria-live="polite">
            <div
              className="announcement-marquee"
              title={announcement?.content ?? t("announcement.welcome")}
              style={announcement ? {
                color: announcement.textColor,
                backgroundColor: announcement.backgroundColor,
              } : undefined}
            >
              <div
                className="announcement-track"
                key={announcement?.content ?? language}
                style={{
                  animationDuration: `${announcement?.scrollDurationSeconds ?? 22}s`,
                }}
              >
                <div className="announcement-copy">
                  <Megaphone size={15} />
                  <span>{announcement?.content ?? t("announcement.welcome")}</span>
                </div>
                <div className="announcement-copy" aria-hidden="true">
                  <Megaphone size={15} />
                  <span>{announcement?.content ?? t("announcement.welcome")}</span>
                </div>
              </div>
            </div>
          </div>
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

        <main className={page === "accounts" ? "accounts-main" : undefined}>
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
                    disabled={manager.archiveOperation !== null
                      || (!manager.accounts.length && !providerManager.providers.length)}
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
                <Popconfirm title={t("actions.restartChatGptConfirmTitle")}
                  description={t("actions.restartChatGptConfirmDescription")}
                  okText={t("actions.restartChatGpt")} cancelText={t("table.cancel")}
                  okButtonProps={{ danger: true }} disabled={restartingChatGpt}
                  onConfirm={() => void restartChatGptProcess()}>
                  <Tooltip title={t("actions.restartChatGptHint")}>
                    <button className="refresh-all restart-chatgpt-button" disabled={restartingChatGpt}>
                      <RotateCcw className={restartingChatGpt ? "spin" : ""} size={17} />{t("actions.restartChatGpt")}
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
                <Popconfirm title={t("actions.restartChatGptConfirmTitle")}
                  description={t("actions.restartChatGptConfirmDescription")}
                  okText={t("actions.restartChatGpt")} cancelText={t("table.cancel")}
                  okButtonProps={{ danger: true }} disabled={restartingChatGpt}
                  onConfirm={() => void restartChatGptProcess()}>
                  <Tooltip title={t("actions.restartChatGptHint")}>
                    <button className="refresh-all restart-chatgpt-button" disabled={restartingChatGpt}>
                      <RotateCcw className={restartingChatGpt ? "spin" : ""} size={17} />{t("actions.restartChatGpt")}
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
              bubbleResetDisplay={bubbleResetDisplay.display} bubbleResetDisplayLoading={bubbleResetDisplay.loading}
              onBubbleResetDisplayChange={changeBubbleResetDisplay}
              privacyModeEnabled={privacyMode.enabled} privacyModeLoading={privacyMode.loading}
              onPrivacyModeChange={changePrivacyMode}
              accountDisplayMode={accountDisplayMode.displayMode}
              onAccountDisplayModeChange={accountDisplayMode.setDisplayMode}
              onOpenCodexHome={openCodexHome} onOpenAccountStore={openAccountStore} language={language}
              onExportLogs={() => void exportLogs()} exportingLogs={exportingLogs}
              onLanguageChange={setLanguage} t={t} />
          </section>
          <section className="page-panel" hidden={page !== "providers"}>
            <MemoProvidersPage providers={providerManager.providers} loading={providerManager.loading}
              busyProviderId={providerManager.busyProviderId} saving={providerManager.saving}
              localProxy={providerManager.localProxy} proxyBusy={providerManager.proxyBusy}
              conversationSyncBusy={syncingDirectConversations}
              info={manager.info} onSave={providerManager.saveProvider}
              onSwitch={switchProvider} onSwitchModel={switchProviderModel}
              onModelControlChange={setProviderModelControl} onDelete={deleteProvider}
              onStartProxy={providerManager.startProxy} onStopProxy={providerManager.stopProxy}
              onSyncDirectConversations={() => void syncDirectConversationHistory()}
              onAutoSwitchChange={providerManager.setProxyAutoSwitch}
              onAutoDisableUnreachableChange={providerManager.setProxyAutoDisableUnreachable}
              displayMode={accountDisplayMode.displayMode} t={t} />
          </section>
          <section className="page-panel accounts-page-panel" hidden={page !== "accounts"}>
            <MemoAccountsPage accounts={manager.accounts} loading={manager.loading}
              busyAccountId={manager.busyAccountId} onAdd={openLogin}
              localProxy={providerManager.localProxy} proxyBusy={providerManager.proxyBusy}
              conversationSyncBusy={syncingDirectConversations}
              onSwitch={switchAccount}
              onRefresh={refreshUsage}
              onDelete={deleteAccount}
              onAutoSwitchEnabledChange={setAccountAutoSwitchEnabled}
              autoSwitchBusyAccountId={manager.autoSwitchBusyAccountId}
              onSaveNote={saveAccountNote}
              resetCredits={resetCredits.states}
              onLoadResetCredits={loadResetCredits}
              onUseResetCredit={(id) => void useResetCredit(id)}
              resetCreditBusyAccountId={resetCreditBusyAccountId}
              onStartProxy={providerManager.startProxy} onStopProxy={providerManager.stopProxy}
              onSyncDirectConversations={() => void syncDirectConversationHistory()}
              onAutoSwitchChange={providerManager.setProxyAutoSwitch}
              onAutoDisableUnreachableChange={providerManager.setProxyAutoDisableUnreachable}
              privacyMode={privacyMode.enabled}
              displayMode={accountDisplayMode.displayMode}
              language={language} t={t} />
          </section>
        </main>

        {showLogin && <LoginModal onClose={() => setShowLogin(false)} onStart={startLogin} onImport={importAuth} onImportCompatibleJson={importCompatibleJson} t={t} />}
        {showCloudLogin && <CloudLoginModal loading={cloud.loading} onClose={() => setShowCloudLogin(false)}
          sendingRegistrationCode={cloud.sendingRegistrationCode} onLogin={loginCloudAccount}
          onForgotPassword={openCloudPasswordReset} onRegister={registerCloudAccount}
          onSendRegistrationCode={cloud.sendRegistrationCode} t={t} />}
        {showHelp && <HelpModal onClose={() => setShowHelp(false)} onDownload={openRelease}
          onFeedback={() => setShowFeedback(true)} version={manager.info?.version ?? "0.1.0"}
          versionState={helpVersionState} t={t} />}
        {showFeedback && <FeedbackModal email={cloud.state.authenticated ? cloud.state.userEmail : null}
          onClose={() => setShowFeedback(false)} onSubmit={sendFeedback} t={t} />}
        {availableUpdate && <UpdateModal update={availableUpdate} onClose={() => setAvailableUpdate(null)}
          onIgnore={ignoreUpdate} onDownload={() => {
            setAvailableUpdate(null);
            openRelease(availableUpdate.releaseUrl);
          }} t={t} />}
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
