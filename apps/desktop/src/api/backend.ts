import { invoke } from "@tauri-apps/api/core";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { DEMO_ACCOUNTS, DEMO_INFO } from "../demo";
import { LANGUAGE_STORAGE_KEY, isLanguage, type Language } from "../i18n";
import type {
  Account,
  AccountArchiveImportResult,
  AppInfo,
  AppSettings,
  CloudAuthState,
  CloudSyncResult,
  LoginStart,
  LoginStatus,
  ResetCreditsSummary,
  UpdateInfo,
} from "../types";
import { DEFAULT_THEME_COLOR, normalizeThemeColor } from "../utils/theme";

export const isDesktopApp = "__TAURI_INTERNALS__" in window;
const FLOATING_BUBBLE_PREVIEW_KEY = "codex-switch:floating-bubble";
const THEME_COLOR_PREVIEW_KEY = "codex-switch:theme-color";
const CLOUD_BASE_URL_PREVIEW_KEY = "codex-switch:cloud-base-url";
const CLOUD_USER_PREVIEW_KEY = "codex-switch:cloud-user-email";
const THEME_COLOR_EVENT = "codex-switch:theme-color-changed";
const LANGUAGE_EVENT = "codex-switch:language-changed";
let updateCheckPromise: Promise<UpdateInfo | null> | null = null;

function previewCloudState(): CloudAuthState {
  const baseUrl = window.localStorage.getItem(CLOUD_BASE_URL_PREVIEW_KEY)?.trim() ?? "";
  const userEmail = window.localStorage.getItem(CLOUD_USER_PREVIEW_KEY);
  return {
    enabled: baseUrl.length > 0,
    baseUrl: baseUrl || null,
    authenticated: Boolean(baseUrl && userEmail),
    userEmail,
    userId: userEmail ? "preview" : null,
    lastSyncAt: null,
  };
}

export async function loadDashboard(): Promise<{ accounts: Account[]; info: AppInfo }> {
  if (!isDesktopApp) {
    return { accounts: structuredClone(DEMO_ACCOUNTS), info: DEMO_INFO };
  }
  const [accounts, info] = await Promise.all([
    invoke<Account[]>("list_accounts"),
    invoke<AppInfo>("get_app_info"),
  ]);
  return { accounts, info };
}

export async function loadAppSettings(): Promise<AppSettings> {
  if (!isDesktopApp) {
    return {
      floatingBubbleEnabled: window.localStorage.getItem(FLOATING_BUBBLE_PREVIEW_KEY) === "true",
      themeColor: normalizeThemeColor(window.localStorage.getItem(THEME_COLOR_PREVIEW_KEY) ?? DEFAULT_THEME_COLOR),
      cloudBaseUrl: window.localStorage.getItem(CLOUD_BASE_URL_PREVIEW_KEY),
    };
  }
  return invoke<AppSettings>("get_app_settings");
}

export async function updateFloatingBubble(enabled: boolean): Promise<AppSettings> {
  if (!isDesktopApp) {
    window.localStorage.setItem(FLOATING_BUBBLE_PREVIEW_KEY, String(enabled));
    return {
      floatingBubbleEnabled: enabled,
      themeColor: normalizeThemeColor(window.localStorage.getItem(THEME_COLOR_PREVIEW_KEY) ?? DEFAULT_THEME_COLOR),
    };
  }
  return invoke<AppSettings>("set_floating_bubble", { enabled });
}

export async function updateThemeColor(color: string): Promise<AppSettings> {
  const themeColor = normalizeThemeColor(color);
  if (!isDesktopApp) {
    window.localStorage.setItem(THEME_COLOR_PREVIEW_KEY, themeColor);
    window.dispatchEvent(new CustomEvent<string>(THEME_COLOR_EVENT, { detail: themeColor }));
    return {
      floatingBubbleEnabled: window.localStorage.getItem(FLOATING_BUBBLE_PREVIEW_KEY) === "true",
      themeColor,
    };
  }
  return invoke<AppSettings>("set_theme_color", { color: themeColor });
}

export async function loadCloudAuthState(): Promise<CloudAuthState> {
  if (!isDesktopApp) return previewCloudState();
  return invoke<CloudAuthState>("get_cloud_auth_state");
}

export async function updateCloudBaseUrl(baseUrl: string): Promise<CloudAuthState> {
  if (!isDesktopApp) {
    const normalized = baseUrl.trim().replace(/\/+$/, "");
    if (normalized) window.localStorage.setItem(CLOUD_BASE_URL_PREVIEW_KEY, normalized);
    else {
      window.localStorage.removeItem(CLOUD_BASE_URL_PREVIEW_KEY);
      window.localStorage.removeItem(CLOUD_USER_PREVIEW_KEY);
    }
    return previewCloudState();
  }
  return invoke<CloudAuthState>("set_cloud_base_url", { baseUrl });
}

export async function loginCloud(email: string, password: string): Promise<CloudAuthState> {
  if (!isDesktopApp) {
    const baseUrl = window.localStorage.getItem(CLOUD_BASE_URL_PREVIEW_KEY);
    if (!baseUrl) throw new Error("Cloud server base URL is not configured");
    if (!email || !password) throw new Error("Email and password are required");
    window.localStorage.setItem(CLOUD_USER_PREVIEW_KEY, email);
    return previewCloudState();
  }
  return invoke<CloudAuthState>("cloud_login", { email, password });
}

export async function logoutCloud(): Promise<CloudAuthState> {
  if (!isDesktopApp) {
    window.localStorage.removeItem(CLOUD_USER_PREVIEW_KEY);
    return previewCloudState();
  }
  return invoke<CloudAuthState>("cloud_logout");
}

export async function syncCloudAccounts(): Promise<CloudSyncResult> {
  if (!isDesktopApp) return { uploaded: 0, downloaded: 0 };
  return invoke<CloudSyncResult>("cloud_sync_accounts");
}

export async function pushCloudAccounts(): Promise<CloudSyncResult> {
  if (!isDesktopApp) return { uploaded: 0, downloaded: 0 };
  return invoke<CloudSyncResult>("cloud_push_accounts");
}

export async function pushCloudAccount(id: string): Promise<CloudSyncResult> {
  if (!isDesktopApp) return { uploaded: 0, downloaded: 0 };
  return invoke<CloudSyncResult>("cloud_push_account", { id });
}

export async function deleteCloudAccount(id: string): Promise<CloudSyncResult> {
  if (!isDesktopApp) return { uploaded: 0, downloaded: 0 };
  return invoke<CloudSyncResult>("cloud_delete_account", { id });
}

export async function resizeFloatingBubble(expanded: boolean): Promise<void> {
  if (isDesktopApp) await invoke("resize_floating_bubble", { expanded });
}

export async function dragFloatingBubble(): Promise<void> {
  if (isDesktopApp) await invoke("drag_floating_bubble");
}

export async function showFloatingBubbleMenu(): Promise<void> {
  if (isDesktopApp) await invoke("show_floating_bubble_menu");
}

export async function showDashboardFromBubble(): Promise<void> {
  if (isDesktopApp) await invoke("show_dashboard_from_bubble");
}

export async function beginLogin(embedded: boolean): Promise<LoginStart | null> {
  if (!isDesktopApp) return null;
  return invoke<LoginStart>("start_login", { embedded });
}

export type ImportAuthResult =
  | { status: "imported"; id: string }
  | { status: "cancelled" }
  | { status: "preview" };

export type ExportAccountArchiveResult =
  | { status: "exported"; path: string }
  | { status: "cancelled" }
  | { status: "preview" };

export type ImportAccountArchiveResult =
  | { status: "imported"; result: AccountArchiveImportResult }
  | { status: "cancelled" }
  | { status: "preview" };

export async function chooseAndImportAuth(): Promise<ImportAuthResult> {
  if (!isDesktopApp) return { status: "preview" };
  const selected = await open({
    multiple: false,
    filters: [{ name: "Codex auth.json", extensions: ["json"] }],
  });
  if (!selected) return { status: "cancelled" };
  const id = await invoke<string>("import_auth_file", { path: selected });
  return { status: "imported", id };
}

export async function chooseAndExportAccountArchive(): Promise<ExportAccountArchiveResult> {
  if (!isDesktopApp) return { status: "preview" };
  const selected = await save({
    defaultPath: `codex-switch-accounts-${new Date().toISOString().slice(0, 10)}.cs`,
    filters: [{ name: "Codex Switch backup", extensions: ["cs"] }],
  });
  if (!selected) return { status: "cancelled" };
  const path = await invoke<string>("export_accounts_archive", { path: selected });
  return { status: "exported", path };
}

export async function chooseAndImportAccountArchive(): Promise<ImportAccountArchiveResult> {
  if (!isDesktopApp) return { status: "preview" };
  const selected = await open({
    multiple: false,
    filters: [{ name: "Codex Switch backup", extensions: ["cs"] }],
  });
  if (!selected) return { status: "cancelled" };
  const result = await invoke<AccountArchiveImportResult>("import_accounts_archive", { path: selected });
  return { status: "imported", result };
}

export async function activateAccount(id: string): Promise<void> {
  if (isDesktopApp) await invoke("switch_account", { id });
}

export async function refreshAccountUsage(id: string): Promise<void> {
  if (isDesktopApp) await invoke("refresh_usage", { id });
}

export async function removeAccount(id: string): Promise<void> {
  if (isDesktopApp) await invoke("delete_account", { id });
}

export async function updateAccountNote(id: string, note: string, expiresAt: string): Promise<void> {
  if (isDesktopApp) await invoke("update_account_note", { id, note, expiresAt });
}

export async function fetchResetCredits(id: string): Promise<ResetCreditsSummary> {
  if (isDesktopApp) return invoke<ResetCreditsSummary>("fetch_reset_credits", { id });
  return {
    credits: [{
      issuedAt: new Date(Date.now() - 3 * 24 * 60 * 60_000).toISOString(),
      expiresAt: new Date(Date.now() + 27 * 24 * 60 * 60_000).toISOString(),
    }],
  };
}

export async function restartCodex(): Promise<void> {
  if (isDesktopApp) await invoke("restart_codex");
}

export async function openManagedFolder(target: "codexHome" | "accountStore"): Promise<void> {
  if (isDesktopApp) await invoke("open_managed_folder", { target });
}

export function checkForUpdate({ force = false }: { force?: boolean } = {}): Promise<UpdateInfo | null> {
  if (!isDesktopApp) return Promise.resolve(null);
  if (force) return invoke<UpdateInfo | null>("check_for_update");
  updateCheckPromise ??= invoke<UpdateInfo | null>("check_for_update");
  return updateCheckPromise;
}

export function subscribeToBackendEvents(
  onAccountsChanged: () => void,
  onLoginStatus: (status: LoginStatus) => void,
): () => void {
  if (!isDesktopApp) return () => undefined;

  const subscriptions: Promise<UnlistenFn>[] = [
    listen("accounts-changed", onAccountsChanged),
    listen<LoginStatus>("login-status", ({ payload }) => onLoginStatus(payload)),
  ];
  return () => subscriptions.forEach((subscription) => void subscription.then((unlisten) => unlisten()));
}

export function subscribeToThemeColorChanges(onChange: (color: string) => void): () => void {
  if (!isDesktopApp) {
    const handleThemeChange = (event: Event) => {
      onChange(normalizeThemeColor((event as CustomEvent<string>).detail));
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === THEME_COLOR_PREVIEW_KEY) onChange(normalizeThemeColor(event.newValue));
    };
    window.addEventListener(THEME_COLOR_EVENT, handleThemeChange);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(THEME_COLOR_EVENT, handleThemeChange);
      window.removeEventListener("storage", handleStorage);
    };
  }

  const subscription = listen<string>("theme-color-changed", ({ payload }) => {
    onChange(normalizeThemeColor(payload));
  });
  return () => void subscription.then((unlisten) => unlisten());
}

export async function publishLanguageChange(language: Language): Promise<void> {
  window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  if (!isDesktopApp) {
    window.dispatchEvent(new CustomEvent<Language>(LANGUAGE_EVENT, { detail: language }));
    return;
  }
  await emit(LANGUAGE_EVENT, language);
}

export function subscribeToLanguageChanges(onChange: (language: Language) => void): () => void {
  const handleLanguage = (value: unknown) => {
    if (isLanguage(value)) onChange(value);
  };
  if (!isDesktopApp) {
    const handleLanguageChange = (event: Event) => {
      handleLanguage((event as CustomEvent<Language>).detail);
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === LANGUAGE_STORAGE_KEY) handleLanguage(event.newValue);
    };
    window.addEventListener(LANGUAGE_EVENT, handleLanguageChange);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(LANGUAGE_EVENT, handleLanguageChange);
      window.removeEventListener("storage", handleStorage);
    };
  }

  const subscription = listen<Language>(LANGUAGE_EVENT, ({ payload }) => {
    handleLanguage(payload);
  });
  return () => void subscription.then((unlisten) => unlisten());
}
