import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { DEMO_ACCOUNTS, DEMO_INFO } from "../demo";
import type {
  Account,
  AppInfo,
  AppSettings,
  LoginStart,
  LoginStatus,
  ResetCreditsSummary,
} from "../types";
import { DEFAULT_THEME_COLOR, normalizeThemeColor } from "../utils/theme";

export const isDesktopApp = "__TAURI_INTERNALS__" in window;
const FLOATING_BUBBLE_PREVIEW_KEY = "codex-switch:floating-bubble";
const THEME_COLOR_PREVIEW_KEY = "codex-switch:theme-color";
const THEME_COLOR_EVENT = "codex-switch:theme-color-changed";

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

export async function chooseAndImportAuth(): Promise<"imported" | "cancelled" | "preview"> {
  if (!isDesktopApp) return "preview";
  const selected = await open({
    multiple: false,
    filters: [{ name: "Codex auth.json", extensions: ["json"] }],
  });
  if (!selected) return "cancelled";
  await invoke("import_auth_file", { path: selected });
  return "imported";
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

export async function fetchResetCredits(id: string): Promise<ResetCreditsSummary> {
  if (isDesktopApp) return invoke<ResetCreditsSummary>("fetch_reset_credits", { id });
  return {
    credits: [{
      issuedAt: new Date(Date.now() - 3 * 24 * 60 * 60_000).toISOString(),
      expiresAt: new Date(Date.now() + 27 * 24 * 60 * 60_000).toISOString(),
    }],
  };
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
