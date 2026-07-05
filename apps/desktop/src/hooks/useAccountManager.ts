import { useCallback, useEffect, useRef, useState } from "react";
import {
  activateAccount,
  beginLogin,
  chooseAndExportAccountArchive,
  chooseAndImportAccountArchive,
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

interface AccountCloudSync {
  pushAccount?: (id: string) => Promise<void> | void;
  deleteAccount?: (id: string) => Promise<void> | void;
}

export function useAccountManager(
  notify: (message: string) => void,
  t: Translate,
  cloudSync?: AccountCloudSync,
) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAccountId, setBusyAccountId] = useState<string | null>(null);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [archiveOperation, setArchiveOperation] = useState<"import" | "export" | null>(null);
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
      if (status.ok && status.accountId) void cloudSync?.pushAccount?.(status.accountId);
    },
  ), [cloudSync, load, notify]);

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
      if (result.status === "imported") {
        notify(t("toast.imported"));
        await load();
        await cloudSync?.pushAccount?.(result.id);
      }
    } catch (error) {
      notify(String(error));
    }
  }, [cloudSync, load, notify, t]);

  const exportAccountArchive = useCallback(async () => {
    notify(isDesktopApp ? t("toast.exportArchivePrompt") : t("toast.previewNoFile"));
    setArchiveOperation("export");
    try {
      const result = await chooseAndExportAccountArchive();
      if (result.status === "exported") {
        notify(t("toast.archiveExported"));
      }
    } catch (error) {
      notify(String(error));
    } finally {
      setArchiveOperation(null);
    }
  }, [notify, t]);

  const importAccountArchive = useCallback(async () => {
    notify(isDesktopApp ? t("toast.importArchivePrompt") : t("toast.previewNoFile"));
    setArchiveOperation("import");
    try {
      const result = await chooseAndImportAccountArchive();
      if (result.status === "imported") {
        notify(t("toast.archiveImported", { count: result.result.imported }));
        await load();
        await Promise.allSettled(result.result.accountIds.map((id) => cloudSync?.pushAccount?.(id)));
      }
    } catch (error) {
      notify(String(error));
    } finally {
      setArchiveOperation(null);
    }
  }, [cloudSync, load, notify, t]);

  const switchAccount = useCallback(async (id: string) => {
    setBusyAccountId(id);
    try {
      await activateAccount(id);
      if (!isDesktopApp) {
        setAccounts((items) => items.map((item) => ({ ...item, active: item.id === id })));
      }
      notify(t("toast.switched"));
      if (isDesktopApp) await load();
      await cloudSync?.pushAccount?.(id);
    } catch (error) {
      notify(String(error));
    } finally {
      setBusyAccountId(null);
    }
  }, [cloudSync, load, notify, t]);

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
      await cloudSync?.pushAccount?.(id);
    } catch (error) {
      if (!quiet) notify(String(error));
    } finally {
      if (showSpinner) setBusyAccountId(null);
    }
  }, [cloudSync, load, notify, t]);

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
      await Promise.allSettled(accounts.map((account) => cloudSync?.pushAccount?.(account.id)));
    } finally {
      if (showSpinner) setRefreshingAll(false);
      refreshingAllRef.current = false;
    }
  }, [accounts, cloudSync, load, notify, t]);

  const deleteAccount = useCallback(async (id: string) => {
    try {
      await removeAccount(id);
      if (!isDesktopApp) setAccounts((items) => items.filter((item) => item.id !== id));
      notify(t("toast.deleted"));
      if (isDesktopApp) await load();
      await cloudSync?.deleteAccount?.(id);
    } catch (error) {
      notify(String(error));
    }
  }, [cloudSync, load, notify, t]);

  const saveAccountNote = useCallback(async (id: string, note: string, expiresAt: string) => {
    try {
      await updateAccountNote(id, note, expiresAt);
      setAccounts((items) => items.map((item) => item.id === id ? { ...item, note, expiresAt } : item));
      notify(t("toast.accountDetailsSaved"));
      await cloudSync?.pushAccount?.(id);
      return true;
    } catch (error) {
      notify(String(error));
      return false;
    }
  }, [cloudSync, notify, t]);

  return {
    accounts,
    info,
    loading,
    busyAccountId,
    refreshingAll,
    archiveOperation,
    startLogin,
    importAuth,
    exportAccountArchive,
    importAccountArchive,
    switchAccount,
    refreshUsage,
    refreshAll,
    deleteAccount,
    saveAccountNote,
    reload: load,
  };
}
