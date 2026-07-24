import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ConfigProvider, Dropdown, Modal, Tooltip, theme as antdTheme } from "antd";
import enUS from "antd/locale/en_US";
import zhCN from "antd/locale/zh_CN";
import { Archive, BarChart3, CalendarClock, Check, CircleHelp, Cloud, Download, Github, LogIn, LogOut, Megaphone, MessageSquareText, Palette, Play, Plus, RefreshCw, RotateCcw, Server, Settings, ShieldCheck, Upload, UploadCloud, UserRound } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { checkForUpdate, chooseAndExportDiagnosticLogs, consumeResetCredit, DEFAULT_CLOUD_BASE_URL, downloadAvailableUpdate, fetchCloudAnnouncement, installDownloadedUpdate, isDesktopApp, launchChatGpt, loadAppSettings, openManagedFolder, reportAnnouncementClick, reportBaseUrlChange, reportFirstInstallation, restartChatGpt, setProxyOnboardingChoice, showTokenUsageWindow, submitFeedback, subscribeToCloudSessionExpired } from "./api/backend";
import { HelpModal, type HelpVersionState } from "./components/modals/HelpModal";
import { FeedbackModal } from "./components/modals/FeedbackModal";
import { FloatingUsageBubble } from "./components/FloatingUsageBubble";
import { TokenUsageHeatmap } from "./components/TokenUsageHeatmap";
import { TokenUsageDashboard } from "./components/TokenUsageDashboard";
import { TokenUsageWindow } from "./components/TokenUsageWindow";
import { CloudLoginModal } from "./components/modals/CloudLoginModal";
import { CloudAccountModal } from "./components/modals/CloudAccountModal";
import { LoginModal } from "./components/modals/LoginModal";
import { UpdateModal } from "./components/modals/UpdateModal";
import { ProxyOnboardingModal } from "./components/modals/ProxyOnboardingModal";
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
import { useTokenUsagePreferences } from "./hooks/useTokenUsagePreferences";
import { useToast } from "./hooks/useToast";
import { AccountsPage } from "./pages/AccountsPage";
import { DreamSkinPage } from "./pages/DreamSkinPage";
import { ProvidersPage } from "./pages/ProvidersPage";
import { SettingsPage } from "./pages/SettingsPage";
import { formatRefreshTime } from "./utils/format";
import type { BubbleResetDisplay, CloudAnnouncement, UpdateInfo } from "./types";

const LAST_REFRESH_ALL_KEY = "codex-switch:last-refresh-all-at";
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const REPOSITORY_URL = "https://github.com/piperhex/codex-switch.git";
const APP_LOGO_URL = new URL("../src-tauri/icons/128x128.png", import.meta.url).href;
const MemoAccountsPage = memo(AccountsPage);
const MemoDreamSkinPage = memo(DreamSkinPage);
const MemoProvidersPage = memo(ProvidersPage);
const MemoSettingsPage = memo(SettingsPage);

function storedRefreshAllTime() {
  const value = window.localStorage.getItem(LAST_REFRESH_ALL_KEY);
  return value && !Number.isNaN(new Date(value).getTime()) ? value : null;
}

function normalizeHttpUrl(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:" ? trimmed : null;
  } catch {
    return null;
  }
}

function DashboardApp() {
  const [page, setPage] = useState<"accounts" | "providers" | "tokens" | "dreamSkin" | "settings">("accounts");
  const [showLogin, setShowLogin] = useState(false);
  const [showCloudLogin, setShowCloudLogin] = useState(false);
  const [cloudSessionExpired, setCloudSessionExpired] = useState(false);
  const [showCloudAccount, setShowCloudAccount] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [showProxyOnboarding, setShowProxyOnboarding] = useState(false);
  const [proxyOnboardingBusy, setProxyOnboardingBusy] = useState(false);
  const [helpVersionState, setHelpVersionState] = useState<HelpVersionState>({ status: "checking" });
  const [availableUpdate, setAvailableUpdate] = useState<UpdateInfo | null>(null);
  const [showUpdatePrompt, setShowUpdatePrompt] = useState(false);
  const [checkingForUpdate, setCheckingForUpdate] = useState(false);
  const [downloadingUpdate, setDownloadingUpdate] = useState(false);
  const [updateDownloaded, setUpdateDownloaded] = useState(false);
  const [updateProgress, setUpdateProgress] = useState<number | null>(null);
  const [installAfterDownloadRequested, setInstallAfterDownloadRequested] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [updateInstallError, setUpdateInstallError] = useState<string | null>(null);
  const [lastRefreshAllAt, setLastRefreshAllAt] = useState<string | null>(storedRefreshAllTime);
  const [chatGptOperation, setChatGptOperation] = useState<"start" | "restart" | null>(null);
  const [exportingLogs, setExportingLogs] = useState(false);
  const [resetCreditBusyAccountId, setResetCreditBusyAccountId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<CloudAnnouncement | null>(null);
  const helpVersionRequestId = useRef(0);
  const announcementRequestId = useRef(0);
  const availableUpdateRef = useRef<UpdateInfo | null>(null);
  const downloadingUpdateRef = useRef(false);
  const updateDownloadedRef = useRef(false);
  const downloadedUpdateUserInitiatedRef = useRef(false);
  const installAfterDownloadRequestedRef = useRef(false);
  const proxyOnboardingChecked = useRef(false);
  const cloudSessionPromptedRef = useRef(false);
  const { message: toast, notify } = useToast();
  const { language, setLanguage, t } = useLanguage();
  const cloud = useCloudAuth(notify, t);
  const promptCloudRelogin = useCallback((reloadState: boolean) => {
    if (cloudSessionPromptedRef.current) return;
    cloudSessionPromptedRef.current = true;
    setShowCloudAccount(false);
    setCloudSessionExpired(true);
    setShowCloudLogin(true);
    if (reloadState) void cloud.load().catch(() => undefined);
    notify(t("toast.cloudSessionExpired"));
  }, [cloud.load, notify, t]);
  useEffect(
    () => subscribeToCloudSessionExpired(() => promptCloudRelogin(true)),
    [promptCloudRelogin],
  );
  useEffect(() => {
    if (cloud.state.sessionExpired) promptCloudRelogin(false);
  }, [cloud.state.sessionExpired, promptCloudRelogin]);
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
  const tokenUsagePreferences = useTokenUsagePreferences(notify);
  const manager = useAccountManager(notify, t, accountCloudSync);
  const providerManager = useProviderManager(notify, t, providerCloudSync);
  const resetCredits = useResetCredits(manager.accounts, notify, t);
  const activeAccount = manager.accounts.find((account) => account.active) ?? null;
  const loadAnnouncement = useCallback(async () => {
    const requestId = ++announcementRequestId.current;
    try {
      const result = await fetchCloudAnnouncement();
      if (announcementRequestId.current === requestId) {
        const hasChineseContent = result.contentZh?.trim() || result.content?.trim();
        const hasEnglishContent = result.contentEn?.trim() || result.content?.trim();
        setAnnouncement(result.enabled && hasChineseContent && hasEnglishContent ? result : null);
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
  const openCloudLogin = useCallback(() => {
    setCloudSessionExpired(false);
    setShowCloudLogin(true);
  }, []);
  const openCloudAccount = useCallback(() => setShowCloudAccount(true), []);
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
  const loginCloudAccount = useCallback(async (
    email: string,
    password: string,
    rememberPassword: boolean,
  ) => {
    const ok = await cloud.login(email, password, rememberPassword);
    if (ok) {
      cloudSessionPromptedRef.current = false;
      await manager.reload();
    }
    return ok;
  }, [cloud.login, manager.reload]);
  const registerCloudAccount = useCallback(async (
    email: string,
    password: string,
    verificationCode: string,
    rememberPassword: boolean,
  ) => {
    const ok = await cloud.register(email, password, verificationCode, rememberPassword);
    if (ok) {
      cloudSessionPromptedRef.current = false;
      await manager.reload();
    }
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

  const sendFeedback = useCallback(async (content: string, contactEmail: string | null, images: File[]) => {
    await submitFeedback(content, manager.info?.version ?? "0.1.0", contactEmail, images);
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

  useEffect(() => {
    if (!isDesktopApp || providerManager.loading || proxyOnboardingChecked.current) return;
    proxyOnboardingChecked.current = true;
    if (providerManager.localProxy?.running) return;
    void loadAppSettings()
      .then((settings) => setShowProxyOnboarding(settings.proxyOnboardingStatus === "pending"))
      .catch(() => undefined);
  }, [providerManager.loading, providerManager.localProxy?.running]);

  const declineProxyOnboarding = useCallback(async () => {
    setProxyOnboardingBusy(true);
    try {
      await setProxyOnboardingChoice(false);
      setShowProxyOnboarding(false);
    } catch (error) {
      notify(String(error));
    } finally {
      setProxyOnboardingBusy(false);
    }
  }, [notify]);

  const enableProxyOnboarding = useCallback(async () => {
    setProxyOnboardingBusy(true);
    try {
      await setProxyOnboardingChoice(true);
      setShowProxyOnboarding(false);
      await providerManager.startProxy();
    } catch (error) {
      notify(String(error));
    } finally {
      setProxyOnboardingBusy(false);
    }
  }, [notify, providerManager.startProxy]);

  const startLogin = (embedded: boolean) => {
    setShowLogin(false);
    void manager.startLogin(embedded);
  };
  const importAccountJson = () => {
    setShowLogin(false);
    void manager.importAccountJson();
  };
  const importAccountJsonFromClipboard = () => {
    setShowLogin(false);
    void manager.importAccountJsonFromClipboard();
  };
  const refreshAll = () => {
    markRefreshAll();
    void manager.refreshAll();
    void loadAnnouncement();
  };
  const restartChatGptProcess = useCallback(async () => {
    setChatGptOperation("restart");
    try {
      await restartChatGpt();
      notify(isDesktopApp ? t("toast.chatGptRestarted") : t("toast.previewRestartChatGpt"));
    } catch (error) {
      notify(String(error));
    } finally {
      setChatGptOperation(null);
    }
  }, [notify, t]);
  const launchChatGptProcess = useCallback(async () => {
    setChatGptOperation("start");
    try {
      const started = await launchChatGpt();
      notify(isDesktopApp
        ? t(started ? "toast.chatGptStarted" : "toast.chatGptAlreadyRunning")
        : t("toast.previewStartChatGpt"));
    } catch (error) {
      notify(String(error));
    } finally {
      setChatGptOperation(null);
    }
  }, [notify, t]);
  const confirmRestartChatGpt = useCallback(() => {
    Modal.confirm({
      title: t("actions.restartChatGptConfirmTitle"),
      content: t("actions.restartChatGptConfirmDescription"),
      okText: t("actions.restartChatGpt"),
      cancelText: t("table.cancel"),
      okButtonProps: { danger: true },
      onOk: restartChatGptProcess,
    });
  }, [restartChatGptProcess, t]);
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

  const downloadUpdate = useCallback(async (update: UpdateInfo, promptWhenReady: boolean) => {
    if (promptWhenReady) {
      installAfterDownloadRequestedRef.current = true;
      downloadedUpdateUserInitiatedRef.current = true;
      setInstallAfterDownloadRequested(true);
      setAvailableUpdate(update);
      availableUpdateRef.current = update;
    } else if (!downloadingUpdateRef.current) {
      downloadedUpdateUserInitiatedRef.current = false;
    }
    downloadingUpdateRef.current = true;
    setDownloadingUpdate(true);
    setUpdateProgress(null);
    setUpdateInstallError(null);
    try {
      await downloadAvailableUpdate(setUpdateProgress);
      setAvailableUpdate(update);
      availableUpdateRef.current = update;
      setUpdateDownloaded(true);
      updateDownloadedRef.current = true;
      if (installAfterDownloadRequestedRef.current) {
        installAfterDownloadRequestedRef.current = false;
        setInstallAfterDownloadRequested(false);
        setShowUpdatePrompt(true);
      }
      return true;
    } catch (error) {
      downloadedUpdateUserInitiatedRef.current = false;
      if (installAfterDownloadRequestedRef.current) {
        installAfterDownloadRequestedRef.current = false;
        setInstallAfterDownloadRequested(false);
        setUpdateInstallError(String(error));
        setShowUpdatePrompt(true);
      }
      return false;
    } finally {
      downloadingUpdateRef.current = false;
      setDownloadingUpdate(false);
    }
  }, []);

  const checkForUpdates = useCallback(async () => {
    setCheckingForUpdate(true);
    setUpdateInstallError(null);
    try {
      const update = await checkForUpdate({ force: true });
      if (update) {
        setAvailableUpdate(update);
        availableUpdateRef.current = update;
        setShowUpdatePrompt(true);
      } else {
        notify(t("update.latest"));
      }
    } catch (error) {
      notify(t("update.checkError", { error: String(error) }));
    } finally {
      setCheckingForUpdate(false);
    }
  }, [notify, t]);

  useEffect(() => {
    let cancelled = false;
    const checkAndDownload = async () => {
      try {
        if (downloadingUpdateRef.current || downloadedUpdateUserInitiatedRef.current) return;
        const replacePending = updateDownloadedRef.current;
        const previousVersion = availableUpdateRef.current?.latestVersion;
        const update = await checkForUpdate({ force: true, replacePending });
        if (!update) return;
        if (replacePending && update.latestVersion === previousVersion) return;
        if (replacePending) {
          updateDownloadedRef.current = false;
          setUpdateDownloaded(false);
        }
        if (!cancelled) await downloadUpdate(update, false);
      } catch {
        // Background update checks retry quietly on the next interval.
      }
    };
    void checkAndDownload();
    const timer = window.setInterval(() => void checkAndDownload(), UPDATE_CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [downloadUpdate]);

  const installUpdate = useCallback(async () => {
    downloadedUpdateUserInitiatedRef.current = true;
    setInstallingUpdate(true);
    setUpdateInstallError(null);
    try {
      await installDownloadedUpdate();
    } catch (error) {
      setUpdateInstallError(String(error));
      setInstallingUpdate(false);
    }
  }, []);

  const localizedAnnouncementContent = announcement
    ? (language === "zh" ? announcement.contentZh : announcement.contentEn)?.trim()
      || announcement.content?.trim()
    : "";
  const announcementText = localizedAnnouncementContent || t("announcement.welcome");
  const announcementLink = normalizeHttpUrl(announcement?.link);
  const announcementStyle = announcement ? {
    color: announcement.textColor,
    backgroundColor: announcement.backgroundColor,
  } : undefined;
  const announcementTrack = (
    <div
      className="announcement-track"
      key={`${language}:${announcementText}`}
      style={{ animationDuration: `${announcement?.scrollDurationSeconds ?? 22}s` }}
    >
      <div className="announcement-copy">
        <Megaphone size={15} />
        <span>{announcementText}</span>
      </div>
      <div className="announcement-copy" aria-hidden="true">
        <Megaphone size={15} />
        <span>{announcementText}</span>
      </div>
    </div>
  );
  const openAnnouncementLink = () => {
    if (!announcementLink) return;
    if (isDesktopApp) {
      void reportAnnouncementClick(announcementLink, announcement?.updatedAt).catch(() => undefined);
      void openUrl(announcementLink).catch((error) => notify(String(error)));
      return;
    }
    window.open(announcementLink, "_blank", "noopener,noreferrer");
  };
  const chatGptActionMenu = (
    <Dropdown
      trigger={["hover"]}
      menu={{
        items: [
          {
            key: "start",
            icon: <Play className={chatGptOperation === "start" ? "spin" : undefined} size={15} />,
            label: t("actions.startChatGpt"),
            disabled: chatGptOperation !== null,
          },
          {
            key: "restart",
            icon: <RotateCcw className={chatGptOperation === "restart" ? "spin" : undefined} size={15} />,
            label: t("actions.restartChatGpt"),
            disabled: chatGptOperation !== null,
          },
        ],
        onClick: ({ key }) => {
          if (key === "start") void launchChatGptProcess();
          if (key === "restart") confirmRestartChatGpt();
        },
      }}
    >
      <button type="button" className="refresh-all chatgpt-menu-button" disabled={chatGptOperation !== null}>
        <Play size={17} />{t("actions.chatGpt")}
      </button>
    </Dropdown>
  );
  const backupActionMenu = (
    <Dropdown
      trigger={["hover"]}
      menu={{
        items: [
          {
            key: "import",
            icon: <Upload className={manager.archiveOperation === "import" ? "spin" : undefined} size={15} />,
            label: t("actions.importArchive"),
            disabled: manager.archiveOperation !== null,
          },
          {
            key: "export",
            icon: <Download className={manager.archiveOperation === "export" ? "spin" : undefined} size={15} />,
            label: t("actions.exportArchive"),
            disabled: manager.archiveOperation !== null
              || (!manager.accounts.length && !providerManager.providers.length),
          },
        ],
        onClick: ({ key }) => {
          if (key === "import") void manager.importAccountArchive();
          if (key === "export") void manager.exportAccountArchive();
        },
      }}
    >
      <button type="button" className="topbar-icon-button" aria-label={t("actions.backup")}
        disabled={manager.archiveOperation !== null}>
        <Archive className={manager.archiveOperation ? "spin" : undefined} size={17} />
        <span>{t("actions.backup")}</span>
      </button>
    </Dropdown>
  );
  const refreshActionMenu = (
    <div className="refresh-all-wrap">
      <Dropdown
        trigger={["hover"]}
        menu={{
          items: [
            {
              key: "usage",
              icon: <RefreshCw className={manager.refreshingAll ? "spin" : undefined} size={15} />,
              label: t("actions.refreshAll"),
              disabled: manager.refreshingAll || !manager.accounts.length,
            },
            {
              key: "resetCredits",
              icon: <CalendarClock className={resetCredits.refreshingAll ? "spin" : undefined} size={15} />,
              label: t("actions.refreshResetCredits"),
              disabled: resetCredits.refreshingAll || !manager.accounts.length,
            },
          ],
          onClick: ({ key }) => {
            if (key === "usage") refreshAll();
            if (key === "resetCredits") void resetCredits.refreshAll();
          },
        }}
      >
        <button type="button" className="refresh-all" disabled={!manager.accounts.length}>
          <RefreshCw className={manager.refreshingAll || resetCredits.refreshingAll ? "spin" : undefined} size={17} />
          {t("actions.refresh")}
        </button>
      </Dropdown>
      <small className="last-auto-refresh">{t("actions.lastUpdated", { time: formatRefreshTime(lastRefreshAllAt, language) })}</small>
    </div>
  );

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
            {announcementLink ? (
              <button
                type="button"
                className="announcement-marquee announcement-marquee-link"
                title={announcementText}
                style={announcementStyle}
                onClick={openAnnouncementLink}
              >
                {announcementTrack}
              </button>
            ) : (
              <div
                className="announcement-marquee"
                title={announcementText}
                style={announcementStyle}
              >
                {announcementTrack}
              </div>
            )}
          </div>
          <nav className="top-tabs" aria-label={t("nav.aria")}>
            <button className={page === "accounts" ? "selected" : ""} onClick={() => setPage("accounts")}>
              <UserRound size={19} />{t("nav.accounts")}</button>
            <button className={page === "providers" ? "selected" : ""} onClick={() => setPage("providers")}>
              <Server size={19} />{t("nav.providers")}</button>
            <button className={page === "tokens" ? "selected" : ""} onClick={() => setPage("tokens")}>
              <BarChart3 size={19} />{t("nav.tokenUsage")}</button>
            <button className={page === "dreamSkin" ? "selected" : ""} onClick={() => setPage("dreamSkin")}>
              <Palette size={19} />{t("nav.dreamSkin")}</button>
            <button className={page === "settings" ? "selected" : ""} onClick={() => setPage("settings")}>
              <Settings size={19} />{t("nav.settings")}</button>
          </nav>
          <div className="menu-tools">
            {cloud.state.enabled ? (
              <>
              <Dropdown
                trigger={["click"]}
                menu={{
                  items: cloud.state.authenticated
                    ? [
                      { key: "account", icon: <Cloud size={15} />, label: t("cloud.accountDetails") },
                      { type: "divider" },
                      { key: "logout", icon: <LogOut size={15} />, label: t("cloud.logout"), disabled: cloud.loading },
                      { type: "divider" },
                      { key: "checkUpdate", icon: <RefreshCw size={15} />, label: t("update.check"), disabled: checkingForUpdate },
                      { key: "feedback", icon: <MessageSquareText size={15} />, label: t("feedback.title") },
                      { key: "repository", icon: <Github size={15} />, label: t("help.github") },
                      { key: "help", icon: <CircleHelp size={15} />, label: t("about.open") },
                    ]
                    : [
                      { key: "login", icon: <LogIn size={15} />, label: t("cloud.login"), disabled: cloud.loading },
                      { type: "divider" },
                      { key: "checkUpdate", icon: <RefreshCw size={15} />, label: t("update.check"), disabled: checkingForUpdate },
                      { key: "feedback", icon: <MessageSquareText size={15} />, label: t("feedback.title") },
                      { key: "repository", icon: <Github size={15} />, label: t("help.github") },
                      { key: "help", icon: <CircleHelp size={15} />, label: t("about.open") },
                    ],
                  onClick: ({ key }) => {
                    if (key === "account") openCloudAccount();
                    if (key === "logout") void cloud.logout();
                    if (key === "login") openCloudLogin();
                    if (key === "checkUpdate") void checkForUpdates();
                    if (key === "feedback") setShowFeedback(true);
                    if (key === "help") openHelp();
                    if (key === "repository") openRepository();
                  },
                }}
              >
                <button type="button" className={`cloud-avatar-button${cloud.state.authenticated ? " authenticated" : ""}`}
                  aria-label={cloud.state.authenticated ? t("cloud.accountDetails") : t("cloud.login")}
                  disabled={cloud.loading}>
                  {cloud.state.authenticated
                    ? <span>{(cloud.state.userEmail ?? t("cloud.signedIn")).slice(0, 4).toUpperCase()}</span>
                    : <UserRound size={18} />}
                </button>
              </Dropdown>
              </>
            ) : (
              <div className="security-chip"><ShieldCheck size={16} /><span><b>{t("chip.title")}</b><small>{t("chip.description")}</small></span></div>
            )}
            {availableUpdate && (updateDownloaded || (downloadingUpdate && installAfterDownloadRequested)) && (
              <Tooltip title={downloadingUpdate
                ? (updateProgress === null
                  ? t("update.backgroundDownloading")
                  : t("update.downloading", { progress: updateProgress }))
                : t("update.ready")}>
                <button type="button" className={`update-ready-button${downloadingUpdate ? " downloading" : ""}`}
                  style={downloadingUpdate
                    ? { "--update-progress": `${updateProgress ?? 0}%` } as CSSProperties
                    : undefined}
                  aria-label={downloadingUpdate ? t("update.backgroundDownloading") : t("update.ready")}
                  onClick={() => setShowUpdatePrompt(true)}>
                  {downloadingUpdate ? <RefreshCw className="spin" size={18} /> : <Download size={18} />}
                </button>
              </Tooltip>
            )}
          </div>
        </header>

        <main className={page === "accounts" ? "accounts-main" : page === "tokens" ? "tokens-main" : page === "dreamSkin" ? "dream-skin-main" : undefined}>
          {page !== "tokens" && page !== "dreamSkin" && (
          <header className={`topbar${page === "accounts" && providerManager.localProxy?.running ? " accounts-topbar" : ""}`}>
            {page === "accounts" && providerManager.localProxy?.running ? (
              <TokenUsageHeatmap weeks={tokenUsagePreferences.weeks}
                refreshSeconds={tokenUsagePreferences.refreshSeconds} language={language} t={t} />
            ) : (
              <div><span className="eyebrow">{page === "providers" ? t("topbar.providersEyebrow") : t("topbar.eyebrow")}</span>
                <h1>{page === "settings"
                  ? t("topbar.settings")
                  : page === "providers"
                    ? t("topbar.providers", { count: providerManager.providers.length })
                    : t("topbar.accounts", { count: manager.accounts.length })}</h1></div>
            )}
            {page === "accounts" && (
              <div className="topbar-actions">
                <button className="primary-button" onClick={openLogin}><Plus size={18} />{t("actions.addAccount")}</button>
                {backupActionMenu}
                {refreshActionMenu}
                {chatGptActionMenu}
                {cloud.state.authenticated && (
                  <Tooltip title={t("cloud.syncDescription")}>
                    <button type="button" className="refresh-all cloud-sync-action" disabled={cloud.syncing}
                      onClick={() => void syncCloud()}>
                      <UploadCloud className={cloud.syncing ? "spin" : ""} size={17} />{t("cloud.sync")}
                    </button>
                  </Tooltip>
                )}
              </div>
            )}
            {page === "providers" && (
              <div className="topbar-actions">
                <Tooltip title="Token 消耗汇总">
                  <button className="refresh-all" onClick={() => void openTokenUsage()}>
                    <BarChart3 size={17} />Token 汇总
                  </button>
                </Tooltip>
                {chatGptActionMenu}
                {cloud.state.authenticated && (
                  <Tooltip title={t("cloud.syncDescription")}>
                    <button type="button" className="refresh-all cloud-sync-action" disabled={cloud.syncing}
                      onClick={() => void syncCloud()}>
                      <UploadCloud className={cloud.syncing ? "spin" : ""} size={17} />{t("cloud.sync")}
                    </button>
                  </Tooltip>
                )}
              </div>
            )}
            {page === "settings" && (
              <div className="topbar-actions">
                <button type="button" className="refresh-all settings-help-button" onClick={openHelp}>
                  <CircleHelp size={17} />{t("help.open")}
                </button>
              </div>
            )}
          </header>
          )}

          <section className="page-panel" hidden={page !== "dreamSkin"}>
            <MemoDreamSkinPage t={t} notify={notify} />
          </section>
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
              tokenUsageWeeks={tokenUsagePreferences.weeks}
              tokenUsageRefreshSeconds={tokenUsagePreferences.refreshSeconds}
              tokenUsagePreferencesLoading={tokenUsagePreferences.loading}
              onTokenUsageWeeksChange={tokenUsagePreferences.updateWeeks}
              onTokenUsageRefreshSecondsChange={tokenUsagePreferences.updateRefreshSeconds}
              onOpenCodexHome={openCodexHome} onOpenAccountStore={openAccountStore} language={language}
              onExportLogs={() => void exportLogs()} exportingLogs={exportingLogs}
              onLanguageChange={setLanguage} t={t} />
          </section>
          <section className="page-panel" hidden={page !== "providers"}>
            <MemoProvidersPage providers={providerManager.providers} accounts={manager.accounts}
              loading={providerManager.loading}
              busyProviderId={providerManager.busyProviderId} saving={providerManager.saving}
              localProxy={providerManager.localProxy} proxyBusy={providerManager.proxyBusy}
              conversationRestoreBusy={providerManager.conversationRestoreBusy}
              info={manager.info} onSave={providerManager.saveProvider}
              onSwitch={switchProvider} onSwitchModel={switchProviderModel}
              onModelControlChange={setProviderModelControl} onDelete={deleteProvider}
              onStartProxy={providerManager.startProxy} onStopProxy={providerManager.stopProxy}
              onRestoreConversations={providerManager.restoreConversations}
              onAutoSwitchChange={providerManager.setProxyAutoSwitch}
              onCustomAutoSwitchPriorityEnabledChange={providerManager.setProxyCustomPriority}
              onAutoDisableUnreachableChange={providerManager.setProxyAutoDisableUnreachable}
              onImageAccountChange={providerManager.setProxyImageAccount}
              onListenOnAllInterfacesChange={providerManager.setProxyListenOnAllInterfaces}
              displayMode={accountDisplayMode.displayMode} t={t} />
          </section>
          <section className="page-panel token-dashboard-page" hidden={page !== "tokens"}>
            <TokenUsageDashboard language={language} themeColor={themeColor.color}
              weeks={tokenUsagePreferences.weeks}
              refreshSeconds={tokenUsagePreferences.refreshSeconds}
              onWeeksChange={tokenUsagePreferences.updateWeeks}
              preferencesLoading={tokenUsagePreferences.loading} embedded />
          </section>
          <section className="page-panel accounts-page-panel" hidden={page !== "accounts"}>
            <MemoAccountsPage accounts={manager.accounts} loading={manager.loading}
              busyAccountId={manager.busyAccountId} onAdd={openLogin}
              localProxy={providerManager.localProxy} proxyBusy={providerManager.proxyBusy}
              conversationRestoreBusy={providerManager.conversationRestoreBusy}
              onSwitch={switchAccount}
              onRefresh={refreshUsage}
              onDelete={deleteAccount}
              onDeleteMany={manager.deleteAccounts}
              onEnableMany={manager.enableAutoSwitchAccounts}
              onDisableMany={manager.disableAutoSwitchAccounts}
              onAutoSwitchEnabledChange={setAccountAutoSwitchEnabled}
              autoSwitchBusyAccountId={manager.autoSwitchBusyAccountId}
              onAutoSwitchPriorityChange={manager.setAutoSwitchPriority}
              autoSwitchPriorityBusyAccountId={manager.autoSwitchPriorityBusyAccountId}
              onCustomAutoSwitchPriorityEnabledChange={providerManager.setProxyCustomPriority}
              onSaveNote={saveAccountNote}
              resetCredits={resetCredits.states}
              onLoadResetCredits={loadResetCredits}
              onUseResetCredit={(id) => void useResetCredit(id)}
              resetCreditBusyAccountId={resetCreditBusyAccountId}
              onStartProxy={providerManager.startProxy} onStopProxy={providerManager.stopProxy}
              onRestoreConversations={providerManager.restoreConversations}
              onAutoSwitchChange={providerManager.setProxyAutoSwitch}
              onAutoDisableUnreachableChange={providerManager.setProxyAutoDisableUnreachable}
              onImageAccountChange={providerManager.setProxyImageAccount}
              onOpenaiAuthAccountChange={providerManager.setProxyOpenaiAuthAccount}
              onListenOnAllInterfacesChange={providerManager.setProxyListenOnAllInterfaces}
              privacyMode={privacyMode.enabled}
              displayMode={accountDisplayMode.displayMode}
              currentModel={providerManager.activeProvider?.model ?? ""}
              tokenUsageRefreshSeconds={tokenUsagePreferences.refreshSeconds}
              language={language} t={t} />
          </section>
        </main>

        {showLogin && <LoginModal onClose={() => setShowLogin(false)} onStart={startLogin}
          onImport={importAccountJson} onImportClipboard={importAccountJsonFromClipboard} t={t} />}
        {showCloudLogin && <CloudLoginModal loading={cloud.loading} onClose={() => {
          setShowCloudLogin(false);
          setCloudSessionExpired(false);
        }}
          sendingRegistrationCode={cloud.sendingRegistrationCode} onLogin={loginCloudAccount}
          onForgotPassword={openCloudPasswordReset} onRegister={registerCloudAccount}
          onSendRegistrationCode={cloud.sendRegistrationCode} sessionExpired={cloudSessionExpired} t={t} />}
        {showCloudAccount && cloud.state.authenticated && <CloudAccountModal
          email={cloud.state.userEmail} baseUrl={cloud.state.baseUrl}
          changingPassword={cloud.changingPassword} onChangePassword={cloud.changePassword}
          onClose={() => setShowCloudAccount(false)} onOpenPasswordReset={() => {
            setShowCloudAccount(false);
            openCloudPasswordReset();
          }} t={t} />}
        {showHelp && <HelpModal onClose={() => setShowHelp(false)} onDownload={openRelease}
          onFeedback={() => setShowFeedback(true)} version={manager.info?.version ?? "0.1.0"}
          versionState={helpVersionState} t={t} />}
        {showFeedback && <FeedbackModal signedInEmail={cloud.state.authenticated ? cloud.state.userEmail : null}
          onClose={() => setShowFeedback(false)} onSubmit={sendFeedback} t={t} />}
        {availableUpdate && showUpdatePrompt && <UpdateModal update={availableUpdate}
          onClose={() => setShowUpdatePrompt(false)}
          onDownload={() => void downloadUpdate(availableUpdate, true)}
          onInstall={() => void installUpdate()} downloading={downloadingUpdate}
          downloadRequested={installAfterDownloadRequested} downloaded={updateDownloaded}
          installing={installingUpdate} progress={updateProgress} error={updateInstallError} t={t} />}
        {showProxyOnboarding && <ProxyOnboardingModal busy={proxyOnboardingBusy}
          onDecline={() => void declineProxyOnboarding()} onEnable={() => void enableProxyOnboarding()} t={t} />}
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
