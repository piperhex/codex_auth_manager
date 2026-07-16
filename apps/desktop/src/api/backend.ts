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
  BubbleResetDisplay,
  CloudAuthState,
  CloudSyncResult,
  LoginStart,
  LoginStatus,
  LocalProxyStatus,
  Provider,
  ProviderInput,
  ResetCreditsSummary,
  TokenUsageEntry,
  UpdateInfo,
} from "../types";
import { DEFAULT_THEME_COLOR, normalizeThemeColor } from "../utils/theme";

export const isDesktopApp = "__TAURI_INTERNALS__" in window;
const FLOATING_BUBBLE_PREVIEW_KEY = "codex-switch:floating-bubble";
const PRIVACY_MODE_PREVIEW_KEY = "codex-switch:privacy-mode";
const BUBBLE_RESET_DISPLAY_PREVIEW_KEY = "codex-switch:bubble-reset-display";
const THEME_COLOR_PREVIEW_KEY = "codex-switch:theme-color";
const CLOUD_BASE_URL_PREVIEW_KEY = "codex-switch:cloud-base-url";
const CLOUD_USER_PREVIEW_KEY = "codex-switch:cloud-user-email";
const PROVIDERS_PREVIEW_KEY = "codex-switch:providers";
const LOCAL_PROXY_PREVIEW_KEY = "codex-switch:local-proxy-running";
const LOCAL_PROXY_AUTO_SWITCH_PREVIEW_KEY = "codex-switch:local-proxy-auto-switch";
const LOCAL_PROXY_AUTO_DISABLE_UNREACHABLE_PREVIEW_KEY = "codex-switch:local-proxy-auto-disable-unreachable";
const THEME_COLOR_EVENT = "codex-switch:theme-color-changed";
const BUBBLE_RESET_DISPLAY_EVENT = "bubble-reset-display-changed";
const LANGUAGE_EVENT = "codex-switch:language-changed";
const PROVIDERS_EVENT = "codex-switch:providers-changed";
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

function normalizeModels(model: string, models: unknown): string[] {
  const normalized: string[] = [];
  const push = (value: unknown) => {
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    if (trimmed && !normalized.includes(trimmed)) normalized.push(trimmed);
  };
  push(model);
  if (Array.isArray(models)) models.forEach(push);
  return normalized;
}

function readPreviewProviders(): Provider[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(PROVIDERS_PREVIEW_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((provider): provider is Provider & { models?: unknown } => Boolean(
      provider
      && typeof provider === "object"
      && "id" in provider
      && "name" in provider
      && "baseUrl" in provider
      && "model" in provider,
    )).map((provider) => {
      const models = normalizeModels(provider.model, provider.models);
      return {
        ...provider,
        model: models.includes(provider.model.trim()) ? provider.model.trim() : (models[0] ?? ""),
        models,
        modelSelectionControlledByCodex: Boolean(provider.modelSelectionControlledByCodex),
      };
    });
  } catch {
    return [];
  }
}

function writePreviewProviders(providers: Provider[]) {
  window.localStorage.setItem(PROVIDERS_PREVIEW_KEY, JSON.stringify(providers));
  window.dispatchEvent(new CustomEvent(PROVIDERS_EVENT));
}

function previewProviderId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `provider-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function previewLocalProxyStatus(): LocalProxyStatus {
  return {
    running: window.localStorage.getItem(LOCAL_PROXY_PREVIEW_KEY) === "true",
    address: "127.0.0.1",
    port: 15722,
    baseUrl: "http://127.0.0.1:15722/v1",
    autoSwitchOnQuotaExhaustion: window.localStorage.getItem(LOCAL_PROXY_AUTO_SWITCH_PREVIEW_KEY) === "true",
    autoDisableUnreachableAccounts: window.localStorage.getItem(LOCAL_PROXY_AUTO_DISABLE_UNREACHABLE_PREVIEW_KEY) === "true",
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
      privacyMode: window.localStorage.getItem(PRIVACY_MODE_PREVIEW_KEY) !== "false",
      bubbleResetDisplay: window.localStorage.getItem(BUBBLE_RESET_DISPLAY_PREVIEW_KEY) === "resetAt" ? "resetAt" : "countdown",
      themeColor: normalizeThemeColor(window.localStorage.getItem(THEME_COLOR_PREVIEW_KEY) ?? DEFAULT_THEME_COLOR),
      cloudBaseUrl: window.localStorage.getItem(CLOUD_BASE_URL_PREVIEW_KEY),
    };
  }
  return invoke<AppSettings>("get_app_settings");
}

export async function loadProviders(): Promise<Provider[]> {
  if (!isDesktopApp) {
    const proxyRunning = previewLocalProxyStatus().running;
    return readPreviewProviders().map((provider) => ({
      ...provider,
      supportsDirectSwitch: provider.apiFormat === "openaiResponses" || proxyRunning,
    }));
  }
  return invoke<Provider[]>("list_providers");
}

export async function saveProviderProfile(provider: ProviderInput): Promise<Provider> {
  if (!isDesktopApp) {
    const providers = readPreviewProviders();
    const index = provider.id ? providers.findIndex((item) => item.id === provider.id) : -1;
    const existing = index >= 0 ? providers[index] : null;
    const hasApiKey = Boolean(provider.apiKey?.trim() || existing?.hasApiKey);
    if (!hasApiKey) throw new Error("API key is required for a new provider");
    const models = normalizeModels(provider.model, provider.models);
    const model = provider.model.trim() || (models[0] ?? "");
    const next: Provider = {
      id: existing?.id ?? provider.id ?? previewProviderId(),
      name: provider.name.trim(),
      baseUrl: provider.baseUrl.trim().replace(/\/+$/, ""),
      model,
      models,
      modelSelectionControlledByCodex: provider.modelSelectionControlledByCodex,
      apiFormat: provider.apiFormat,
      active: existing?.active ?? false,
      hasApiKey,
      supportsDirectSwitch: provider.apiFormat === "openaiResponses" || previewLocalProxyStatus().running,
    };
    if (index >= 0) providers[index] = next;
    else providers.push(next);
    writePreviewProviders(providers);
    return next;
  }
  return invoke<Provider>("save_provider", { provider });
}

export async function activateProvider(id: string): Promise<void> {
  if (!isDesktopApp) {
    const providers = readPreviewProviders();
    const selected = providers.find((provider) => provider.id === id);
    if (!selected) throw new Error("Provider does not exist");
    if (!selected.supportsDirectSwitch && !previewLocalProxyStatus().running) throw new Error("Chat Completions providers need a local Responses bridge");
    writePreviewProviders(providers.map((provider) => ({ ...provider, active: provider.id === id })));
    return;
  }
  await invoke("switch_provider", { id });
}

export async function switchProviderModel(id: string, model: string): Promise<Provider> {
  if (!isDesktopApp) {
    const providers = readPreviewProviders();
    const index = providers.findIndex((provider) => provider.id === id);
    if (index < 0) throw new Error("Provider does not exist");
    const selectedModel = model.trim();
    if (!selectedModel) throw new Error("Model is required");
    const provider = providers[index];
    const models = normalizeModels(selectedModel, provider.models);
    providers[index] = { ...provider, model: selectedModel, models };
    writePreviewProviders(providers);
    return providers[index];
  }
  return invoke<Provider>("switch_provider_model", { id, model });
}

export async function setProviderModelControl(id: string, controlledByCodex: boolean): Promise<Provider> {
  if (!isDesktopApp) {
    const providers = readPreviewProviders();
    const index = providers.findIndex((provider) => provider.id === id);
    if (index < 0) throw new Error("Provider does not exist");
    providers[index] = {
      ...providers[index],
      modelSelectionControlledByCodex: controlledByCodex,
    };
    writePreviewProviders(providers);
    return providers[index];
  }
  return invoke<Provider>("set_provider_model_control", { id, controlledByCodex });
}

export async function deactivateProvider(): Promise<void> {
  if (!isDesktopApp) {
    writePreviewProviders(readPreviewProviders().map((provider) => ({ ...provider, active: false })));
    return;
  }
  await invoke("disable_provider");
}

export async function removeProvider(id: string): Promise<void> {
  if (!isDesktopApp) {
    writePreviewProviders(readPreviewProviders().filter((provider) => provider.id !== id));
    return;
  }
  await invoke("delete_provider", { id });
}

export async function loadLocalProxyStatus(): Promise<LocalProxyStatus> {
  if (!isDesktopApp) return previewLocalProxyStatus();
  return invoke<LocalProxyStatus>("get_local_proxy_status");
}

export async function loadTokenUsageEntries(): Promise<TokenUsageEntry[]> {
  if (!isDesktopApp) {
    const now = Math.floor(Date.now() / 1000);
    return [
      {
        id: "preview-token-1",
        ts: now - 92,
        provider: "AICoding.sh",
        model: "gpt-5-codex",
        durationMs: 16720,
        inputTokens: 20088,
        outputTokens: 1376,
        reasoningTokens: 1344,
        cachedTokens: 19456,
        totalTokens: 21464,
      },
      {
        id: "preview-token-2",
        ts: now - 109,
        provider: "AICoding.sh",
        model: "gpt-5-codex",
        durationMs: 3280,
        inputTokens: 19548,
        outputTokens: 32,
        reasoningTokens: 0,
        cachedTokens: 19012,
        totalTokens: 19580,
      },
    ];
  }
  return invoke<TokenUsageEntry[]>("list_token_usage_entries");
}

export async function showTokenUsageWindow(): Promise<void> {
  if (!isDesktopApp) {
    window.open(`${window.location.pathname}?cache=${Date.now()}#token-usage`, "_blank", "noopener,noreferrer");
    return;
  }
  await invoke("show_token_usage_window");
}

export async function startLocalProxy(): Promise<LocalProxyStatus> {
  if (!isDesktopApp) {
    window.localStorage.setItem(LOCAL_PROXY_PREVIEW_KEY, "true");
    writePreviewProviders(readPreviewProviders().map((provider) => ({
      ...provider,
      supportsDirectSwitch: true,
    })));
    return previewLocalProxyStatus();
  }
  return invoke<LocalProxyStatus>("start_local_proxy");
}

export async function stopLocalProxy(): Promise<LocalProxyStatus> {
  if (!isDesktopApp) {
    window.localStorage.removeItem(LOCAL_PROXY_PREVIEW_KEY);
    writePreviewProviders(readPreviewProviders().map((provider) => ({
      ...provider,
      active: false,
      supportsDirectSwitch: provider.apiFormat === "openaiResponses",
    })));
    return previewLocalProxyStatus();
  }
  return invoke<LocalProxyStatus>("stop_local_proxy");
}

export async function setLocalProxyAutoSwitch(enabled: boolean): Promise<LocalProxyStatus> {
  if (!isDesktopApp) {
    if (enabled && !previewLocalProxyStatus().running) {
      throw new Error("Start the local proxy before enabling automatic account switching");
    }
    window.localStorage.setItem(LOCAL_PROXY_AUTO_SWITCH_PREVIEW_KEY, String(enabled));
    return previewLocalProxyStatus();
  }
  return invoke<LocalProxyStatus>("set_auto_switch_on_quota_exhaustion", { enabled });
}

export async function setLocalProxyAutoDisableUnreachable(enabled: boolean): Promise<LocalProxyStatus> {
  if (!isDesktopApp) {
    const status = previewLocalProxyStatus();
    if (enabled && (!status.running || !status.autoSwitchOnQuotaExhaustion)) {
      throw new Error("Enable automatic account switching before enabling automatic disabling of unreachable accounts");
    }
    window.localStorage.setItem(LOCAL_PROXY_AUTO_DISABLE_UNREACHABLE_PREVIEW_KEY, String(enabled));
    return previewLocalProxyStatus();
  }
  return invoke<LocalProxyStatus>("set_auto_disable_unreachable_accounts", { enabled });
}

export async function updateFloatingBubble(enabled: boolean): Promise<AppSettings> {
  if (!isDesktopApp) {
    window.localStorage.setItem(FLOATING_BUBBLE_PREVIEW_KEY, String(enabled));
    return {
      floatingBubbleEnabled: enabled,
      privacyMode: window.localStorage.getItem(PRIVACY_MODE_PREVIEW_KEY) !== "false",
      bubbleResetDisplay: window.localStorage.getItem(BUBBLE_RESET_DISPLAY_PREVIEW_KEY) === "resetAt" ? "resetAt" : "countdown",
      themeColor: normalizeThemeColor(window.localStorage.getItem(THEME_COLOR_PREVIEW_KEY) ?? DEFAULT_THEME_COLOR),
    };
  }
  return invoke<AppSettings>("set_floating_bubble", { enabled });
}

export async function updatePrivacyMode(enabled: boolean): Promise<AppSettings> {
  if (!isDesktopApp) {
    window.localStorage.setItem(PRIVACY_MODE_PREVIEW_KEY, String(enabled));
    return {
      floatingBubbleEnabled: window.localStorage.getItem(FLOATING_BUBBLE_PREVIEW_KEY) === "true",
      privacyMode: enabled,
      bubbleResetDisplay: window.localStorage.getItem(BUBBLE_RESET_DISPLAY_PREVIEW_KEY) === "resetAt" ? "resetAt" : "countdown",
      themeColor: normalizeThemeColor(window.localStorage.getItem(THEME_COLOR_PREVIEW_KEY) ?? DEFAULT_THEME_COLOR),
    };
  }
  return invoke<AppSettings>("set_privacy_mode", { enabled });
}

export async function updateBubbleResetDisplay(display: BubbleResetDisplay): Promise<AppSettings> {
  if (!isDesktopApp) {
    window.localStorage.setItem(BUBBLE_RESET_DISPLAY_PREVIEW_KEY, display);
    window.dispatchEvent(new CustomEvent<BubbleResetDisplay>(BUBBLE_RESET_DISPLAY_EVENT, { detail: display }));
    return {
      floatingBubbleEnabled: window.localStorage.getItem(FLOATING_BUBBLE_PREVIEW_KEY) === "true",
      privacyMode: window.localStorage.getItem(PRIVACY_MODE_PREVIEW_KEY) !== "false",
      bubbleResetDisplay: display,
      themeColor: normalizeThemeColor(window.localStorage.getItem(THEME_COLOR_PREVIEW_KEY) ?? DEFAULT_THEME_COLOR),
    };
  }
  return invoke<AppSettings>("set_bubble_reset_display", { display });
}

export async function updateThemeColor(color: string): Promise<AppSettings> {
  const themeColor = normalizeThemeColor(color);
  if (!isDesktopApp) {
    window.localStorage.setItem(THEME_COLOR_PREVIEW_KEY, themeColor);
    window.dispatchEvent(new CustomEvent<string>(THEME_COLOR_EVENT, { detail: themeColor }));
    return {
      floatingBubbleEnabled: window.localStorage.getItem(FLOATING_BUBBLE_PREVIEW_KEY) === "true",
      privacyMode: window.localStorage.getItem(PRIVACY_MODE_PREVIEW_KEY) !== "false",
      bubbleResetDisplay: window.localStorage.getItem(BUBBLE_RESET_DISPLAY_PREVIEW_KEY) === "resetAt" ? "resetAt" : "countdown",
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

export async function pushCloudProviders(): Promise<CloudSyncResult> {
  if (!isDesktopApp) return { uploaded: 0, downloaded: 0 };
  return invoke<CloudSyncResult>("cloud_push_providers");
}

export async function pushCloudProvider(id: string): Promise<CloudSyncResult> {
  if (!isDesktopApp) return { uploaded: 0, downloaded: 0 };
  return invoke<CloudSyncResult>("cloud_push_provider", { id });
}

export async function deleteCloudAccount(id: string): Promise<CloudSyncResult> {
  if (!isDesktopApp) return { uploaded: 0, downloaded: 0 };
  return invoke<CloudSyncResult>("cloud_delete_account", { id });
}

export async function deleteCloudProvider(id: string): Promise<CloudSyncResult> {
  if (!isDesktopApp) return { uploaded: 0, downloaded: 0 };
  return invoke<CloudSyncResult>("cloud_delete_provider", { id });
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

export type CompatibleJsonImportResult =
  | { status: "imported"; ids: string[] }
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

export type ExportDiagnosticLogsResult =
  | { status: "exported"; path: string }
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

export async function chooseAndImportCompatibleJson(): Promise<CompatibleJsonImportResult> {
  if (!isDesktopApp) return { status: "preview" };
  const selected = await open({
    multiple: false,
    filters: [{ name: "Compatible Codex JSON", extensions: ["json"] }],
  });
  if (!selected) return { status: "cancelled" };
  const result = await invoke<{ importedIds: string[] }>("import_compatible_json_file", { path: selected });
  return { status: "imported", ids: result.importedIds };
}

export async function chooseAndExportAccountArchive(): Promise<ExportAccountArchiveResult> {
  if (!isDesktopApp) return { status: "preview" };
  const selected = await save({
    defaultPath: `codex-switch-backup-${new Date().toISOString().slice(0, 10)}.cs`,
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

export async function chooseAndExportDiagnosticLogs(): Promise<ExportDiagnosticLogsResult> {
  if (!isDesktopApp) return { status: "preview" };
  const selected = await save({
    defaultPath: `codex-switch-diagnostics-${new Date().toISOString().slice(0, 10)}.jsonl`,
    filters: [{ name: "Codex Switch diagnostics", extensions: ["jsonl"] }],
  });
  if (!selected) return { status: "cancelled" };
  const path = await invoke<string>("export_diagnostic_logs", { path: selected });
  return { status: "exported", path };
}

export async function activateAccount(id: string): Promise<void> {
  if (isDesktopApp) await invoke("switch_account", { id });
}

export async function setAccountAutoSwitchEnabled(id: string, enabled: boolean): Promise<void> {
  if (isDesktopApp) await invoke("set_account_auto_switch_enabled", { id, enabled });
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

export async function consumeResetCredit(id: string): Promise<void> {
  if (isDesktopApp) await invoke("consume_reset_credit", { id });
}

export async function restartChatGpt(): Promise<void> {
  if (isDesktopApp) await invoke("restart_chatgpt");
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

export function subscribeToBubbleResetDisplayChanges(
  onChange: (display: BubbleResetDisplay) => void,
): () => void {
  const handleChange = (value: unknown) => {
    if (value === "countdown" || value === "resetAt") onChange(value);
  };
  if (!isDesktopApp) {
    const handleDisplayChange = (event: Event) => {
      handleChange((event as CustomEvent<BubbleResetDisplay>).detail);
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === BUBBLE_RESET_DISPLAY_PREVIEW_KEY) handleChange(event.newValue);
    };
    window.addEventListener(BUBBLE_RESET_DISPLAY_EVENT, handleDisplayChange);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(BUBBLE_RESET_DISPLAY_EVENT, handleDisplayChange);
      window.removeEventListener("storage", handleStorage);
    };
  }

  const subscription = listen<BubbleResetDisplay>(BUBBLE_RESET_DISPLAY_EVENT, ({ payload }) => {
    handleChange(payload);
  });
  return () => void subscription.then((unlisten) => unlisten());
}

export function subscribeToProviderEvents(onProvidersChanged: () => void): () => void {
  if (!isDesktopApp) {
    window.addEventListener(PROVIDERS_EVENT, onProvidersChanged);
    return () => window.removeEventListener(PROVIDERS_EVENT, onProvidersChanged);
  }
  const subscription = listen("providers-changed", onProvidersChanged);
  return () => void subscription.then((unlisten) => unlisten());
}

export async function publishLanguageChange(language: Language): Promise<void> {
  window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  if (!isDesktopApp) {
    window.dispatchEvent(new CustomEvent<Language>(LANGUAGE_EVENT, { detail: language }));
    return;
  }
  await invoke("set_app_language", { language });
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
