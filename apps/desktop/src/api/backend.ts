import { invoke } from "@tauri-apps/api/core";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { DEMO_ACCOUNTS, DEMO_INFO } from "../demo";
import { BUILT_IN_DREAM_SKIN_THEMES } from "../dreamSkinBuiltIns";
import { LANGUAGE_STORAGE_KEY, isLanguage, type Language } from "../i18n";
import type {
  Account,
  AccountArchiveImportResult,
  AppInfo,
  AppSettings,
  BubbleResetDisplay,
  CloudAuthState,
  CloudAnnouncement,
  CloudSyncResult,
  DreamSkinImportOptions,
  DreamSkinAppearance,
  DreamSkinStatus,
  DailyTokenUsage,
  DirectConversationSyncResult,
  FeedbackImageInput,
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
export const DEFAULT_CLOUD_BASE_URL = "https://codex.onepiper.cloud";
const RELEASES_URL = "https://github.com/piperhex/codex-switch/releases/latest";
let pendingAppUpdate: Update | null = null;
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
const LOCAL_PROXY_LISTEN_ALL_INTERFACES_PREVIEW_KEY = "codex-switch:local-proxy-listen-all-interfaces";
const LOCAL_PROXY_IMAGE_ACCOUNT_PREVIEW_KEY = "codex-switch:image-generation-account";
const TOKEN_USAGE_WEEKS_PREVIEW_KEY = "codex-switch:token-usage-weeks";
const TOKEN_USAGE_REFRESH_PREVIEW_KEY = "codex-switch:token-usage-refresh-seconds";
const THEME_COLOR_EVENT = "codex-switch:theme-color-changed";
const BUBBLE_RESET_DISPLAY_EVENT = "bubble-reset-display-changed";
const LANGUAGE_EVENT = "codex-switch:language-changed";
const PROVIDERS_EVENT = "codex-switch:providers-changed";
const DREAM_SKIN_INSTALLED_PREVIEW_KEY = "codex-switch:dream-skin-installed";
const DREAM_SKIN_SESSION_PREVIEW_KEY = "codex-switch:dream-skin-session";
const DREAM_SKIN_THEME_PREVIEW_KEY = "codex-switch:dream-skin-theme";
const DREAM_SKIN_APPEARANCE_PREVIEW_KEY = "codex-switch:dream-skin-appearance";
const DREAM_SKIN_PREVIEW_THEME_NAMES: Record<string, string> = Object.fromEntries(
  BUILT_IN_DREAM_SKIN_THEMES.map((theme) => [theme.id, theme.englishName]),
);
const DREAM_SKIN_PREVIEW_THEME_APPEARANCES: Record<string, DreamSkinAppearance> = Object.fromEntries(
  BUILT_IN_DREAM_SKIN_THEMES.map((theme) => [theme.id, theme.appearance]),
);
let updateCheckPromise: Promise<UpdateInfo | null> | null = null;

function previewDreamSkinStatus(): DreamSkinStatus {
  const installed = window.localStorage.getItem(DREAM_SKIN_INSTALLED_PREVIEW_KEY) === "true";
  const storedSession = window.localStorage.getItem(DREAM_SKIN_SESSION_PREVIEW_KEY);
  const session = !installed ? "notInstalled" : storedSession === "paused" ? "paused" : storedSession === "active" ? "active" : "ready";
  const storedThemeId = window.localStorage.getItem(DREAM_SKIN_THEME_PREVIEW_KEY);
  const activeThemeId = storedThemeId === "preset-arina-hashimoto" ? "preset-rose-reverie" : storedThemeId;
  const storedAppearance = window.localStorage.getItem(DREAM_SKIN_APPEARANCE_PREVIEW_KEY);
  const activeThemeAppearance: DreamSkinAppearance = storedAppearance === "light" || storedAppearance === "dark"
    ? storedAppearance
    : "auto";
  return {
    supported: true,
    platform: navigator.platform.toLowerCase().includes("mac") ? "macos" : "windows",
    installed,
    runtimeInstalled: installed,
    session,
    activeThemeId,
    activeThemeName: activeThemeId ? DREAM_SKIN_PREVIEW_THEME_NAMES[activeThemeId] ?? "Custom theme" : null,
    activeThemeAppearance,
    enginePath: installed ? "Preview / CodexDreamSkin" : null,
    savedThemes: [],
  };
}

function previewCloudState(): CloudAuthState {
  const storedBaseUrl = window.localStorage.getItem(CLOUD_BASE_URL_PREVIEW_KEY);
  const baseUrl = (storedBaseUrl ?? DEFAULT_CLOUD_BASE_URL).trim();
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
    address: window.localStorage.getItem(LOCAL_PROXY_LISTEN_ALL_INTERFACES_PREVIEW_KEY) === "true" ? "0.0.0.0" : "127.0.0.1",
    port: 15722,
    baseUrl: "http://127.0.0.1:15722/v1",
    autoSwitchOnQuotaExhaustion: window.localStorage.getItem(LOCAL_PROXY_AUTO_SWITCH_PREVIEW_KEY) === "true",
    autoDisableUnreachableAccounts: window.localStorage.getItem(LOCAL_PROXY_AUTO_DISABLE_UNREACHABLE_PREVIEW_KEY) === "true",
    listenOnAllInterfaces: window.localStorage.getItem(LOCAL_PROXY_LISTEN_ALL_INTERFACES_PREVIEW_KEY) === "true",
    imageGenerationAccountId: window.localStorage.getItem(LOCAL_PROXY_IMAGE_ACCOUNT_PREVIEW_KEY),
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
      cloudBaseUrl: window.localStorage.getItem(CLOUD_BASE_URL_PREVIEW_KEY) ?? DEFAULT_CLOUD_BASE_URL,
      tokenUsageWeeks: Number(window.localStorage.getItem(TOKEN_USAGE_WEEKS_PREVIEW_KEY)) || 20,
      tokenUsageRefreshSeconds: Number(window.localStorage.getItem(TOKEN_USAGE_REFRESH_PREVIEW_KEY)) || 60,
      proxyOnboardingStatus: "legacy",
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
        provider: "Official Codex",
        accountId: "workspace-personal",
        accountEmail: "alex.chen@example.com",
        model: "gpt-5-codex",
        durationMs: 16720,
        inputTokens: 2_000_088,
        outputTokens: 1_376_000,
        reasoningTokens: 1_344_000,
        cachedTokens: 1_945_600,
        totalTokens: 3_376_088,
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

export async function loadDailyTokenUsage(startTs: number): Promise<DailyTokenUsage[]> {
  if (!isDesktopApp) {
    const entries: DailyTokenUsage[] = [];
    const date = new Date(startTs * 1000);
    date.setHours(12, 0, 0, 0);
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    while (date <= today) {
      const signal = date.getDate() + date.getMonth() * 7 + date.getDay() * 3;
      if (signal % 4 !== 0) {
        entries.push({
          date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
          totalTokens: (signal % 7 + 1) * 18_400,
          inputTokens: (signal % 7 + 1) * 14_200,
          outputTokens: (signal % 7 + 1) * 4_200,
          reasoningTokens: (signal % 4 + 1) * 1_150,
          cachedTokens: (signal % 5 + 1) * 8_100,
        });
      }
      date.setDate(date.getDate() + 1);
    }
    return entries;
  }
  return invoke<DailyTokenUsage[]>("list_daily_token_usage", { startTs });
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

export async function restoreNonProxyConversations(): Promise<DirectConversationSyncResult> {
  if (!isDesktopApp) return { conversationsUpdated: 0, rolloutFilesUpdated: 0 };
  return invoke<DirectConversationSyncResult>("restore_non_proxy_conversations");
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

export async function setLocalProxyImageAccount(accountId: string | null): Promise<LocalProxyStatus> {
  if (!isDesktopApp) {
    if (!previewLocalProxyStatus().running) {
      throw new Error("Start the local proxy before selecting an image generation account");
    }
    if (accountId) window.localStorage.setItem(LOCAL_PROXY_IMAGE_ACCOUNT_PREVIEW_KEY, accountId);
    else window.localStorage.removeItem(LOCAL_PROXY_IMAGE_ACCOUNT_PREVIEW_KEY);
    return previewLocalProxyStatus();
  }
  return invoke<LocalProxyStatus>("set_image_generation_account", { accountId });
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

export async function updateTokenUsagePreferences(
  weeks: number,
  refreshSeconds: number,
): Promise<AppSettings> {
  if (!isDesktopApp) {
    window.localStorage.setItem(TOKEN_USAGE_WEEKS_PREVIEW_KEY, String(weeks));
    window.localStorage.setItem(TOKEN_USAGE_REFRESH_PREVIEW_KEY, String(refreshSeconds));
    return loadAppSettings();
  }
  return invoke<AppSettings>("set_token_usage_preferences", { weeks, refreshSeconds });
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
    window.localStorage.setItem(CLOUD_BASE_URL_PREVIEW_KEY, normalized);
    if (!normalized) {
      window.localStorage.removeItem(CLOUD_USER_PREVIEW_KEY);
    }
    return previewCloudState();
  }
  return invoke<CloudAuthState>("set_cloud_base_url", { baseUrl });
}

export async function loginCloud(email: string, password: string): Promise<CloudAuthState> {
  if (!isDesktopApp) {
    if (!previewCloudState().baseUrl) throw new Error("Cloud server base URL is not configured");
    if (!email || !password) throw new Error("Email and password are required");
    window.localStorage.setItem(CLOUD_USER_PREVIEW_KEY, email);
    return previewCloudState();
  }
  return invoke<CloudAuthState>("cloud_login", { email, password });
}

export async function fetchCloudAnnouncement(): Promise<CloudAnnouncement> {
  if (isDesktopApp) return invoke<CloudAnnouncement>("fetch_cloud_announcement");
  const { baseUrl } = previewCloudState();
  if (!baseUrl) return {
    content: "",
    contentZh: "",
    contentEn: "",
    link: "",
    enabled: false,
    textColor: "#C4D7C8",
    backgroundColor: "#203128",
    scrollDurationSeconds: 22,
    updatedAt: null,
  };
  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/announcements/current`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Announcement request failed with HTTP ${response.status}`);
  return response.json() as Promise<CloudAnnouncement>;
}

export async function reportAnnouncementClick(
  link: string,
  announcementUpdatedAt?: string | null,
): Promise<void> {
  if (!isDesktopApp) return;
  await invoke("report_announcement_click", { link, announcementUpdatedAt });
}

export async function submitFeedback(
  content: string,
  version: string,
  contactEmail: string | null,
  images: File[],
): Promise<void> {
  const platform = (navigator.userAgent || navigator.platform || "unknown").slice(0, 500);
  if (isDesktopApp) {
    const inputs: FeedbackImageInput[] = await Promise.all(images.map(async (file) => ({
      fileName: file.name,
      mimeType: file.type,
      dataBase64: await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
        reader.onerror = () => reject(reader.error ?? new Error("Unable to read feedback image"));
        reader.readAsDataURL(file);
      }),
    })));
    await invoke("submit_feedback", { content, version, platform, contactEmail, images: inputs });
    return;
  }

  const { baseUrl } = previewCloudState();
  if (!baseUrl) throw new Error("Cloud server base URL is not configured");
  const form = new FormData();
  form.append("content", content);
  form.append("version", version);
  form.append("platform", platform);
  if (contactEmail) form.append("email", contactEmail);
  images.forEach((image) => form.append("images", image, image.name));
  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/feedback`, {
    method: "POST",
    headers: { Accept: "application/json" },
    body: form,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(error?.message || `Feedback submission failed with HTTP ${response.status}`);
  }
}

export async function reportFirstInstallation(): Promise<boolean> {
  if (!isDesktopApp) return false;
  return invoke<boolean>("report_first_installation");
}

export async function reportBaseUrlChange(): Promise<void> {
  if (!isDesktopApp) return;
  return invoke<void>("report_base_url_change");
}

export async function requestCloudRegistrationCode(email: string): Promise<void> {
  if (!isDesktopApp) {
    if (!previewCloudState().baseUrl) throw new Error("Cloud server base URL is not configured");
    if (!email) throw new Error("Email is required");
    return;
  }
  await invoke("cloud_request_registration_code", { email });
}

export async function registerCloud(
  email: string,
  password: string,
  verificationCode: string,
): Promise<CloudAuthState> {
  if (!isDesktopApp) return loginCloud(email, password);
  return invoke<CloudAuthState>("cloud_register", { email, password, verificationCode });
}

export async function changeCloudPassword(currentPassword: string, newPassword: string): Promise<void> {
  if (!isDesktopApp) {
    if (!previewCloudState().authenticated) throw new Error("Cloud account is not signed in");
    if (currentPassword.length < 6) throw new Error("Current password must be at least 6 characters");
    if (newPassword.length < 8) throw new Error("New password must be at least 8 characters");
    return;
  }
  await invoke("cloud_change_password", { currentPassword, newPassword });
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

export async function chooseAndImportAccountJson(): Promise<CompatibleJsonImportResult> {
  if (!isDesktopApp) return { status: "preview" };
  const selected = await open({
    multiple: false,
    filters: [{ name: "Codex account JSON", extensions: ["json", "jsonl", "ndjson"] }],
  });
  if (!selected) return { status: "cancelled" };
  const result = await invoke<{ importedIds: string[] }>("import_account_json_file", { path: selected });
  return { status: "imported", ids: result.importedIds };
}

export async function importAccountJsonFromClipboard(): Promise<CompatibleJsonImportResult> {
  if (!isDesktopApp) return { status: "preview" };
  if (!navigator.clipboard?.readText) throw new Error("Clipboard text access is unavailable");
  const content = await navigator.clipboard.readText();
  if (!content.trim()) throw new Error("Clipboard does not contain account JSON");
  const result = await invoke<{ importedIds: string[] }>("import_account_json_text", { content });
  return { status: "imported", ids: result.importedIds };
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

export async function setLocalProxyListenOnAllInterfaces(enabled: boolean): Promise<LocalProxyStatus> {
  if (!isDesktopApp) {
    if (!previewLocalProxyStatus().running) {
      throw new Error("Start the local proxy before changing its listening address");
    }
    window.localStorage.setItem(LOCAL_PROXY_LISTEN_ALL_INTERFACES_PREVIEW_KEY, String(enabled));
    return previewLocalProxyStatus();
  }
  return invoke<LocalProxyStatus>("set_local_proxy_listen_on_all_interfaces", { enabled });
}

export async function chooseAndImportSub2apiJson(): Promise<CompatibleJsonImportResult> {
  if (!isDesktopApp) return { status: "preview" };
  const selected = await open({
    multiple: false,
    filters: [{ name: "sub2api export JSON", extensions: ["json"] }],
  });
  if (!selected) return { status: "cancelled" };
  const result = await invoke<{ importedIds: string[] }>("import_sub2api_json_file", { path: selected });
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
  if (isDesktopApp) await invoke("switch_account_and_restart_chatgpt", { id });
}

export async function setProxyOnboardingChoice(useProxy: boolean): Promise<AppSettings> {
  if (!isDesktopApp) return loadAppSettings();
  return invoke<AppSettings>("set_proxy_onboarding_choice", { useProxy });
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

export async function launchChatGpt(): Promise<boolean> {
  if (isDesktopApp) return invoke<boolean>("launch_chatgpt");
  return false;
}

export async function openManagedFolder(target: "codexHome" | "accountStore"): Promise<void> {
  if (isDesktopApp) await invoke("open_managed_folder", { target });
}

export async function loadDreamSkinStatus(): Promise<DreamSkinStatus> {
  if (!isDesktopApp) return previewDreamSkinStatus();
  return invoke<DreamSkinStatus>("get_dream_skin_status");
}

export async function installDreamSkin(): Promise<DreamSkinStatus> {
  if (!isDesktopApp) {
    window.localStorage.setItem(DREAM_SKIN_INSTALLED_PREVIEW_KEY, "true");
    return previewDreamSkinStatus();
  }
  return invoke<DreamSkinStatus>("install_dream_skin");
}

export async function applyDreamSkinTheme(themeId: string): Promise<DreamSkinStatus> {
  if (!isDesktopApp) {
    window.localStorage.setItem(DREAM_SKIN_INSTALLED_PREVIEW_KEY, "true");
    window.localStorage.setItem(DREAM_SKIN_SESSION_PREVIEW_KEY, "active");
    window.localStorage.setItem(DREAM_SKIN_THEME_PREVIEW_KEY, themeId);
    window.localStorage.setItem(
      DREAM_SKIN_APPEARANCE_PREVIEW_KEY,
      DREAM_SKIN_PREVIEW_THEME_APPEARANCES[themeId] ?? "auto",
    );
    return previewDreamSkinStatus();
  }
  return invoke<DreamSkinStatus>("apply_dream_skin_theme", { themeId });
}

export type ChooseDreamSkinImageResult =
  | { status: "selected"; path: string }
  | { status: "cancelled" }
  | { status: "preview" };

export async function chooseDreamSkinImage(): Promise<ChooseDreamSkinImageResult> {
  if (!isDesktopApp) return { status: "preview" };
  const selected = await open({
    multiple: false,
    filters: [{
      name: "Dream Skin image",
      extensions: ["png", "jpg", "jpeg", "webp", "heic", "tif", "tiff"],
    }],
  });
  return selected ? { status: "selected", path: selected } : { status: "cancelled" };
}

export async function importDreamSkinImage(
  path: string,
  options: DreamSkinImportOptions,
): Promise<DreamSkinStatus> {
  if (!isDesktopApp) {
    window.localStorage.setItem(DREAM_SKIN_INSTALLED_PREVIEW_KEY, "true");
    window.localStorage.setItem(DREAM_SKIN_SESSION_PREVIEW_KEY, "active");
    window.localStorage.setItem(DREAM_SKIN_THEME_PREVIEW_KEY, "custom");
    window.localStorage.setItem(DREAM_SKIN_APPEARANCE_PREVIEW_KEY, options.appearance);
    return previewDreamSkinStatus();
  }
  return invoke<DreamSkinStatus>("import_dream_skin_image", { path, options });
}

export async function saveDreamSkinTheme(name: string): Promise<DreamSkinStatus> {
  if (!isDesktopApp) return previewDreamSkinStatus();
  return invoke<DreamSkinStatus>("save_dream_skin_theme", { name });
}

export async function setDreamSkinAppearance(appearance: DreamSkinAppearance): Promise<DreamSkinStatus> {
  if (!isDesktopApp) {
    window.localStorage.setItem(DREAM_SKIN_APPEARANCE_PREVIEW_KEY, appearance);
    return previewDreamSkinStatus();
  }
  return invoke<DreamSkinStatus>("set_dream_skin_appearance", { appearance });
}

export async function setDreamSkinPaused(paused: boolean): Promise<DreamSkinStatus> {
  if (!isDesktopApp) {
    window.localStorage.setItem(DREAM_SKIN_SESSION_PREVIEW_KEY, paused ? "paused" : "active");
    return previewDreamSkinStatus();
  }
  return invoke<DreamSkinStatus>("set_dream_skin_paused", { paused });
}

export async function reapplyDreamSkin(): Promise<DreamSkinStatus> {
  if (!isDesktopApp) {
    window.localStorage.setItem(DREAM_SKIN_SESSION_PREVIEW_KEY, "active");
    return previewDreamSkinStatus();
  }
  return invoke<DreamSkinStatus>("reapply_dream_skin");
}

export async function verifyDreamSkin(): Promise<string> {
  if (!isDesktopApp) return "Preview verification completed.";
  return invoke<string>("verify_dream_skin");
}

export async function restoreDreamSkin(): Promise<DreamSkinStatus> {
  if (!isDesktopApp) {
    window.localStorage.removeItem(DREAM_SKIN_INSTALLED_PREVIEW_KEY);
    window.localStorage.removeItem(DREAM_SKIN_SESSION_PREVIEW_KEY);
    window.localStorage.removeItem(DREAM_SKIN_THEME_PREVIEW_KEY);
    window.localStorage.removeItem(DREAM_SKIN_APPEARANCE_PREVIEW_KEY);
    return previewDreamSkinStatus();
  }
  return invoke<DreamSkinStatus>("restore_dream_skin");
}

export async function openDreamSkinFolder(): Promise<void> {
  if (isDesktopApp) await invoke("open_dream_skin_folder");
}

export async function loadDreamSkinThemePreview(themeId: string): Promise<string | null> {
  if (!isDesktopApp) return null;
  return invoke<string | null>("get_dream_skin_theme_preview", { themeId });
}

export function checkForUpdate({ force = false }: { force?: boolean } = {}): Promise<UpdateInfo | null> {
  if (!isDesktopApp) return Promise.resolve(null);
  if (force) return getAvailableAppUpdate();
  updateCheckPromise ??= getAvailableAppUpdate();
  return updateCheckPromise;
}

async function getAvailableAppUpdate(): Promise<UpdateInfo | null> {
  const update = await check();
  pendingAppUpdate = update;
  if (!update) return null;
  return {
    currentVersion: update.currentVersion,
    latestVersion: update.version,
    releaseName: `Codex Switch v${update.version}`,
    releaseNotes: update.body ?? null,
    releaseUrl: RELEASES_URL,
  };
}

export async function installAvailableUpdate(onProgress?: (progress: number | null) => void): Promise<void> {
  if (!isDesktopApp) return;
  const update = pendingAppUpdate ?? await check();
  if (!update) return;

  let downloadedBytes = 0;
  let totalBytes: number | undefined;
  const reportProgress = (event: DownloadEvent) => {
    if (event.event === "Started") {
      totalBytes = event.data.contentLength;
      onProgress?.(totalBytes ? 0 : null);
    } else if (event.event === "Progress") {
      downloadedBytes += event.data.chunkLength;
      onProgress?.(totalBytes ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)) : null);
    }
  };

  try {
    await update.downloadAndInstall(reportProgress);
  } finally {
    await update.close();
    pendingAppUpdate = null;
  }
  await relaunch();
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
