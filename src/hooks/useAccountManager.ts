import { useCallback, useEffect, useRef, useState } from "react";
import {
  activateAccount,
  beginLogin,
  chooseAndImportAuth,
  isDesktopApp,
  loadDashboard,
  refreshAccountUsage,
  removeAccount,
  subscribeToBackendEvents,
  updateAccountNote,
} from "../api/backend";
import type { Translate } from "../i18n";
import type { Account, AppInfo } from "../types";

interface RefreshAllOptions {
  quiet?: boolean;
  showSpinner?: boolean;
}

export function useAccountManager(
  notify: (message: string) => void,
  t: Translate,
  afterLocalChange?: () => Promise<void> | void,
) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAccountId, setBusyAccountId] = useState<string | null>(null);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const refreshingAllRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const dashboard = await loadDashboard();
      setAccounts(dashboard.accounts);
      setInfo(dashboard.info);
    } catch (error) {
      notify(String(error));
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => subscribeToBackendEvents(
    () => void load(),
    (status) => {
      notify(status.message);
      void load();
      if (status.ok) void afterLocalChange?.();
    },
  ), [afterLocalChange, load, notify]);

  const startLogin = useCallback(async (embedded: boolean) => {
    if (!isDesktopApp) {
      notify(t("toast.previewLogin"));
      return;
    }
    notify(embedded ? t("toast.openingEmbedded") : t("toast.openingBrowser"));
    try {
      await beginLogin(embedded);
      notify(embedded ? t("toast.embeddedOpened") : t("toast.browserOpened"));
    } catch (error) {
      notify(String(error));
    }
  }, [notify, t]);

  const importAuth = useCallback(async () => {
    notify(isDesktopApp ? t("toast.importPrompt") : t("toast.previewNoFile"));
    try {
      const result = await chooseAndImportAuth();
      if (result === "imported") {
        notify(t("toast.imported"));
        await load();
        await afterLocalChange?.();
      }
    } catch (error) {
      notify(String(error));
    }
  }, [afterLocalChange, load, notify, t]);

  const switchAccount = useCallback(async (id: string) => {
    setBusyAccountId(id);
    try {
      await activateAccount(id);
      if (!isDesktopApp) {
        setAccounts((items) => items.map((item) => ({ ...item, active: item.id === id })));
      }
      notify(t("toast.switched"));
      if (isDesktopApp) await load();
      await afterLocalChange?.();
    } catch (error) {
      notify(String(error));
    } finally {
      setBusyAccountId(null);
    }
  }, [afterLocalChange, load, notify, t]);

  const refreshUsage = useCallback(async (id: string, quiet = false, showSpinner = true) => {
    if (showSpinner) setBusyAccountId(id);
    try {
      await refreshAccountUsage(id);
      if (!isDesktopApp) {
        const fetchedAt = new Date().toISOString();
        setAccounts((items) => items.map((item) => item.id === id
          ? { ...item, usage: { ...item.usage, fetchedAt } }
          : item));
      }
      if (!quiet) notify(t("toast.usageRefreshed"));
      if (isDesktopApp) await load();
      await afterLocalChange?.();
    } catch (error) {
      if (!quiet) notify(String(error));
    } finally {
      if (showSpinner) setBusyAccountId(null);
    }
  }, [afterLocalChange, load, notify, t]);

  const refreshAll = useCallback(async ({ quiet = false, showSpinner = true }: RefreshAllOptions = {}) => {
    if (!accounts.length || refreshingAllRef.current) return;
    refreshingAllRef.current = true;
    if (showSpinner) setRefreshingAll(true);
    try {
      await Promise.allSettled(accounts.map((account) => refreshAccountUsage(account.id)));
      if (isDesktopApp) await load();
      else {
        const fetchedAt = new Date().toISOString();
        setAccounts((items) => items.map((item) => ({ ...item, usage: { ...item.usage, fetchedAt } })));
      }
      if (!quiet) notify(t("toast.allUsageRefreshed"));
      await afterLocalChange?.();
    } finally {
      if (showSpinner) setRefreshingAll(false);
      refreshingAllRef.current = false;
    }
  }, [accounts, afterLocalChange, load, notify, t]);

  const deleteAccount = useCallback(async (id: string) => {
    try {
      await removeAccount(id);
      if (!isDesktopApp) setAccounts((items) => items.filter((item) => item.id !== id));
      notify(t("toast.deleted"));
      if (isDesktopApp) await load();
      await afterLocalChange?.();
    } catch (error) {
      notify(String(error));
    }
  }, [afterLocalChange, load, notify, t]);

  const saveAccountNote = useCallback(async (id: string, note: string, expiresAt: string) => {
    try {
      await updateAccountNote(id, note, expiresAt);
      setAccounts((items) => items.map((item) => item.id === id ? { ...item, note, expiresAt } : item));
      notify(t("toast.accountDetailsSaved"));
      await afterLocalChange?.();
      return true;
    } catch (error) {
      notify(String(error));
      return false;
    }
  }, [afterLocalChange, notify, t]);

  return {
    accounts,
    info,
    loading,
    busyAccountId,
    refreshingAll,
    startLogin,
    importAuth,
    switchAccount,
    refreshUsage,
    refreshAll,
    deleteAccount,
    saveAccountNote,
    reload: load,
  };
}
