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

export const isDesktopApp = "__TAURI_INTERNALS__" in window;
const FLOATING_BUBBLE_PREVIEW_KEY = "codex-switch:floating-bubble";

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
    return { floatingBubbleEnabled: window.localStorage.getItem(FLOATING_BUBBLE_PREVIEW_KEY) === "true" };
  }
  return invoke<AppSettings>("get_app_settings");
}

export async function updateFloatingBubble(enabled: boolean): Promise<AppSettings> {
  if (!isDesktopApp) {
    window.localStorage.setItem(FLOATING_BUBBLE_PREVIEW_KEY, String(enabled));
    return { floatingBubbleEnabled: enabled };
  }
  return invoke<AppSettings>("set_floating_bubble", { enabled });
}

export async function resizeFloatingBubble(expanded: boolean): Promise<void> {
  if (isDesktopApp) await invoke("resize_floating_bubble", { expanded });
}

export async function dragFloatingBubble(): Promise<void> {
  if (isDesktopApp) await invoke("drag_floating_bubble");
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
