import { useCallback, useEffect, useRef, useState } from "react";

const INTERVAL_KEY = "codex-switch:auto-refresh-seconds";
const ENABLED_KEY = "codex-switch:auto-refresh-enabled";
const ACCOUNT_SETTINGS_KEY = "codex-switch:account-auto-refresh-settings";
const DEFAULT_GLOBAL_INTERVAL_SECONDS = 300;
const DEFAULT_ACCOUNT_INTERVAL_SECONDS = 5;

export const MIN_AUTO_REFRESH_SECONDS = 1;
export const MAX_AUTO_REFRESH_SECONDS = 3600;

interface AccountAutoRefreshSetting {
  enabled: boolean;
  seconds: number;
}

type AccountAutoRefreshSettings = Record<string, AccountAutoRefreshSetting>;

function clampInterval(value: unknown, fallback: number) {
  if (value == null || (typeof value === "string" && value.trim() === "")) {
    return fallback;
  }
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return fallback;
  return Math.min(MAX_AUTO_REFRESH_SECONDS, Math.max(MIN_AUTO_REFRESH_SECONDS, Math.round(seconds)));
}

function loadAccountSettings(): AccountAutoRefreshSettings {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(ACCOUNT_SETTINGS_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    return Object.fromEntries(Object.entries(parsed).flatMap(([id, value]) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      const setting = value as Partial<AccountAutoRefreshSetting>;
      return [[id, {
        enabled: setting.enabled === true,
        seconds: clampInterval(setting.seconds, DEFAULT_ACCOUNT_INTERVAL_SECONDS),
      }]];
    }));
  } catch {
    return {};
  }
}

export function useAutoRefresh(active: boolean, onRefresh: () => Promise<void>) {
  const [seconds, setSeconds] = useState(() => clampInterval(
    window.localStorage.getItem(INTERVAL_KEY),
    DEFAULT_GLOBAL_INTERVAL_SECONDS,
  ));
  const [enabled, setEnabled] = useState(() => window.localStorage.getItem(ENABLED_KEY) === "true");
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;

  const updateSeconds = useCallback((value: number | string | null) => {
    setSeconds(clampInterval(value, DEFAULT_GLOBAL_INTERVAL_SECONDS));
  }, []);

  useEffect(() => window.localStorage.setItem(INTERVAL_KEY, String(seconds)), [seconds]);
  useEffect(() => window.localStorage.setItem(ENABLED_KEY, String(enabled)), [enabled]);

  useEffect(() => {
    if (!enabled || !active) return;
    const timer = window.setInterval(async () => {
      await refreshRef.current();
    }, seconds * 1000);
    return () => window.clearInterval(timer);
  }, [active, enabled, seconds]);

  return { seconds, enabled, setEnabled, updateSeconds };
}

export function useAccountAutoRefresh(
  accountId: string | null,
  onRefresh: (accountId: string) => Promise<void>,
) {
  const [settings, setSettings] = useState<AccountAutoRefreshSettings>(loadAccountSettings);
  const refreshRef = useRef(onRefresh);
  const refreshingRef = useRef(false);
  refreshRef.current = onRefresh;

  const setting = accountId ? settings[accountId] : undefined;
  const enabled = setting?.enabled ?? false;
  const seconds = setting?.seconds ?? DEFAULT_ACCOUNT_INTERVAL_SECONDS;

  const updateSetting = useCallback((update: Partial<AccountAutoRefreshSetting>) => {
    if (!accountId) return;
    setSettings((current) => ({
      ...current,
      [accountId]: {
        enabled: current[accountId]?.enabled ?? false,
        seconds: current[accountId]?.seconds ?? DEFAULT_ACCOUNT_INTERVAL_SECONDS,
        ...update,
      },
    }));
  }, [accountId]);

  const setEnabled = useCallback((value: boolean) => {
    updateSetting({ enabled: value });
  }, [updateSetting]);

  const updateSeconds = useCallback((value: number | string | null) => {
    updateSetting({ seconds: clampInterval(value, DEFAULT_ACCOUNT_INTERVAL_SECONDS) });
  }, [updateSetting]);

  useEffect(() => {
    window.localStorage.setItem(ACCOUNT_SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    if (!accountId || !enabled) return;
    const timer = window.setInterval(async () => {
      if (refreshingRef.current) return;
      refreshingRef.current = true;
      try {
        await refreshRef.current(accountId);
      } finally {
        refreshingRef.current = false;
      }
    }, seconds * 1000);
    return () => window.clearInterval(timer);
  }, [accountId, enabled, seconds]);

  return { seconds, enabled, setEnabled, updateSeconds };
}
