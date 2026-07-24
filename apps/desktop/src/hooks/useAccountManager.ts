import { useCallback, useEffect, useRef, useState } from "react";
import {
  activateAccount,
  beginLogin,
  chooseAndImportAccountJson,
  importAccountJsonFromClipboard as importAccountJsonClipboard,
  chooseAndExportAccountArchive,
  chooseAndImportAccountArchive,
  isDesktopApp,
  loadDashboard,
  refreshAccountUsage,
  removeAccount,
  setAccountAutoSwitchEnabled,
  setAccountAutoSwitchPriority,
  subscribeToBackendEvents,
  subscribeToProviderEvents,
  updateAccountNote,
} from "../api/backend";
import type { Translate } from "../i18n";
import type { Account, AppInfo } from "../types";

interface RefreshAllOptions {
  quiet?: boolean;
  showSpinner?: boolean;
}

interface AccountCloudSync {
  pushAll?: () => Promise<void> | void;
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
  const [autoSwitchBusyAccountId, setAutoSwitchBusyAccountId] = useState<string | null>(null);
  const [autoSwitchPriorityBusyAccountId, setAutoSwitchPriorityBusyAccountId] = useState<string | null>(null);
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
  useEffect(() => subscribeToProviderEvents(() => void load()), [load]);

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

  const importAccountJson = useCallback(async () => {
    notify(isDesktopApp ? t("toast.accountJsonImportPrompt") : t("toast.previewNoFile"));
    try {
      const result = await chooseAndImportAccountJson();
      if (result.status === "imported") {
        await load();
        for (const id of result.ids) {
          await cloudSync?.pushAccount?.(id);
        }
        notify(t("toast.accountJsonImported", { count: result.ids.length }));
      }
    } catch (error) {
      notify(String(error));
    }
  }, [cloudSync, load, notify, t]);

  const importAccountJsonFromClipboard = useCallback(async () => {
    notify(isDesktopApp ? t("toast.clipboardImportPrompt") : t("toast.previewNoFile"));
    try {
      const result = await importAccountJsonClipboard();
      if (result.status === "imported") {
        await load();
        for (const id of result.ids) {
          await cloudSync?.pushAccount?.(id);
        }
        notify(t("toast.accountJsonImported", { count: result.ids.length }));
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
        notify(t("toast.archiveImported", {
          accounts: result.result.imported,
          providers: result.result.providersImported,
        }));
        await load();
        await Promise.allSettled(result.result.accountIds.map((id) => cloudSync?.pushAccount?.(id)));
        if (result.result.providerIds.length) await cloudSync?.pushAll?.();
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

  const deleteAccounts = useCallback(async (ids: string[]) => {
    const uniqueIds = [...new Set(ids)];
    const deletedIds: string[] = [];
    let failedCount = 0;

    for (const id of uniqueIds) {
      try {
        await removeAccount(id);
        deletedIds.push(id);
      } catch {
        failedCount += 1;
      }
    }

    if (deletedIds.length) {
      if (isDesktopApp) await load();
      else setAccounts((items) => items.filter((item) => !deletedIds.includes(item.id)));
      await Promise.allSettled(deletedIds.map((id) => cloudSync?.deleteAccount?.(id)));
      notify(t("toast.batchDeleted", { count: deletedIds.length }));
    }
    if (failedCount) notify(t("toast.batchDeleteFailed", { count: failedCount }));
    return deletedIds;
  }, [cloudSync, load, notify, t]);

  const setAutoSwitchEnabled = useCallback(async (id: string, enabled: boolean) => {
    setAutoSwitchBusyAccountId(id);
    try {
      await setAccountAutoSwitchEnabled(id, enabled);
      setAccounts((items) => items.map((item) => item.id === id
        ? { ...item, autoSwitchEnabled: enabled }
        : item));
      if (isDesktopApp) await load();
    } catch (error) {
      notify(String(error));
    } finally {
      setAutoSwitchBusyAccountId(null);
    }
  }, [load, notify]);

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

  const setAutoSwitchPriority = useCallback(async (id: string, priority: number) => {
    setAutoSwitchPriorityBusyAccountId(id);
    try {
      await setAccountAutoSwitchPriority(id, priority);
      setAccounts((items) => items.map((item) => item.id === id
        ? { ...item, autoSwitchPriority: priority }
        : item));
      await cloudSync?.pushAccount?.(id);
      if (isDesktopApp) await load();
      return true;
    } catch (error) {
      notify(String(error));
      return false;
    } finally {
      setAutoSwitchPriorityBusyAccountId(null);
    }
  }, [cloudSync, load, notify]);

  return {
    accounts,
    info,
    loading,
    busyAccountId,
    autoSwitchBusyAccountId,
    autoSwitchPriorityBusyAccountId,
    refreshingAll,
    archiveOperation,
    startLogin,
    importAccountJson,
    importAccountJsonFromClipboard,
    exportAccountArchive,
    importAccountArchive,
    switchAccount,
    refreshUsage,
    refreshAll,
    deleteAccount,
    deleteAccounts,
    setAutoSwitchEnabled,
    setAutoSwitchPriority,
    saveAccountNote,
    reload: load,
  };
}
