import { useCallback, useEffect, useState } from "react";
import {
  activateProvider,
  loadLocalProxyStatus,
  loadProviders,
  removeProvider,
  restoreNonProxyConversations,
  saveProviderProfile,
  setLocalProxyAutoDisableUnreachable,
  setLocalProxyImageAccount,
  setLocalProxyListenOnAllInterfaces,
  setLocalProxyAutoSwitch,
  setProviderModelControl,
  startLocalProxy,
  stopLocalProxy,
  subscribeToProviderEvents,
  switchProviderModel,
} from "../api/backend";
import type { Translate } from "../i18n";
import type { LocalProxyStatus, Provider, ProviderInput } from "../types";

interface ProviderCloudSync {
  pushProvider?: (id: string) => Promise<void> | void;
  deleteProvider?: (id: string) => Promise<void> | void;
}

function providerErrorMessage(error: unknown, t: Translate) {
  const message = String(error);
  if (message.includes("API key is required for a new provider")) return t("providers.error.apiKeyRequired");
  if (message.includes("Provider does not exist")) return t("providers.error.notFound");
  if (message.includes("Chat Completions providers need a local Responses bridge")) {
    return t("providers.error.chatBridgeRequired");
  }
  if (message.includes("Provider API key is empty")) return t("providers.error.apiKeyEmpty");
  if (message.includes("Provider name is required")) return t("providers.error.nameRequired");
  if (message.includes("Model is required")) return t("providers.error.modelRequired");
  if (message.includes("Base URL is required")) return t("providers.error.baseUrlRequired");
  if (message.includes("Base URL must be an http:// or https:// URL with a host")) {
    return t("providers.error.baseUrlHttp");
  }
  if (message.includes("Provider Base URL must be an upstream API endpoint")) {
    return t("providers.error.baseUrlLocalProxy");
  }
  if (message.includes("Official Codex local proxy requires")) return t("providers.error.officialProxyAuthRequired");
  if (message.includes("Provider id is invalid")) return t("providers.error.providerIdInvalid");
  if (message.includes("Image generation account must use an OAuth token")) {
    return t("providers.error.imageAccountOAuthRequired");
  }
  if (message.includes("Start the local proxy before selecting an image generation account")) {
    return t("providers.error.imageAccountProxyRequired");
  }
  if (message.startsWith("Base URL is invalid:")) {
    return t("providers.error.baseUrlInvalid", { error: message.slice("Base URL is invalid:".length).trim() });
  }
  return message;
}

export function useProviderManager(
  notify: (message: string) => void,
  t: Translate,
  cloudSync?: ProviderCloudSync,
) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [localProxy, setLocalProxy] = useState<LocalProxyStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyProviderId, setBusyProviderId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [proxyBusy, setProxyBusy] = useState(false);
  const [conversationRestoreBusy, setConversationRestoreBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [nextProviders, nextProxy] = await Promise.all([
        loadProviders(),
        loadLocalProxyStatus(),
      ]);
      setProviders(nextProviders);
      setLocalProxy(nextProxy);
    } catch (error) {
      notify(String(error));
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => subscribeToProviderEvents(() => void load()), [load]);

  const saveProvider = useCallback(async (provider: ProviderInput) => {
    setSaving(true);
    try {
      const saved = await saveProviderProfile(provider);
      notify(t("toast.providerSaved"));
      await load();
      await cloudSync?.pushProvider?.(saved.id);
      return saved;
    } catch (error) {
      notify(providerErrorMessage(error, t));
      return null;
    } finally {
      setSaving(false);
    }
  }, [cloudSync, load, notify, t]);

  const switchProvider = useCallback(async (id: string) => {
    setBusyProviderId(id);
    try {
      const hotSwitch = Boolean(localProxy?.running);
      await activateProvider(id);
      notify(t(hotSwitch ? "toast.providerSwitchedHot" : "toast.providerSwitched"));
      await load();
    } catch (error) {
      notify(providerErrorMessage(error, t));
    } finally {
      setBusyProviderId(null);
    }
  }, [load, localProxy?.running, notify, t]);

  const switchModel = useCallback(async (id: string, model: string) => {
    setBusyProviderId(id);
    try {
      await switchProviderModel(id, model);
      notify(t("toast.providerModelSwitched"));
      await load();
      await cloudSync?.pushProvider?.(id);
    } catch (error) {
      notify(providerErrorMessage(error, t));
    } finally {
      setBusyProviderId(null);
    }
  }, [cloudSync, load, notify, t]);

  const setModelControl = useCallback(async (id: string, controlledByCodex: boolean) => {
    setBusyProviderId(id);
    try {
      await setProviderModelControl(id, controlledByCodex);
      notify(t("toast.providerModelControlSaved"));
      await load();
      await cloudSync?.pushProvider?.(id);
    } catch (error) {
      notify(providerErrorMessage(error, t));
    } finally {
      setBusyProviderId(null);
    }
  }, [cloudSync, load, notify, t]);

  const deleteProvider = useCallback(async (id: string) => {
    setBusyProviderId(id);
    try {
      await removeProvider(id);
      notify(t("toast.providerDeleted"));
      await load();
      await cloudSync?.deleteProvider?.(id);
    } catch (error) {
      notify(providerErrorMessage(error, t));
    } finally {
      setBusyProviderId(null);
    }
  }, [cloudSync, load, notify, t]);

  const startProxy = useCallback(async () => {
    setProxyBusy(true);
    try {
      setLocalProxy(await startLocalProxy());
      notify(t("toast.localProxyStarted"));
      await load();
    } catch (error) {
      notify(providerErrorMessage(error, t));
      // Configuration is kept when only the client relaunch fails, so ensure the
      // card reflects the running proxy before the user starts it manually.
      await load();
    } finally {
      setProxyBusy(false);
    }
  }, [load, notify, t]);

  const stopProxy = useCallback(async () => {
    setProxyBusy(true);
    try {
      setLocalProxy(await stopLocalProxy());
      notify(t("toast.localProxyStopped"));
      await load();
    } catch (error) {
      notify(providerErrorMessage(error, t));
      // Stopping the proxy is committed before the client relaunch. Refresh the
      // card even when only the relaunch fails.
      await load();
    } finally {
      setProxyBusy(false);
    }
  }, [load, notify, t]);

  const restoreConversations = useCallback(async () => {
    setConversationRestoreBusy(true);
    try {
      const result = await restoreNonProxyConversations();
      notify(t(result.conversationsUpdated > 0
        ? "toast.nonProxyConversationsRestored"
        : "toast.nonProxyConversationsAlreadyOfficial", { count: result.conversationsUpdated }));
    } catch (error) {
      notify(providerErrorMessage(error, t));
    } finally {
      setConversationRestoreBusy(false);
    }
  }, [notify, t]);

  const setProxyAutoSwitch = useCallback(async (enabled: boolean) => {
    setProxyBusy(true);
    try {
      setLocalProxy(await setLocalProxyAutoSwitch(enabled));
      notify(t(enabled ? "toast.proxyAutoSwitchEnabled" : "toast.proxyAutoSwitchDisabled"));
      await load();
    } catch (error) {
      notify(providerErrorMessage(error, t));
    } finally {
      setProxyBusy(false);
    }
  }, [load, notify, t]);

  const setProxyAutoDisableUnreachable = useCallback(async (enabled: boolean) => {
    setProxyBusy(true);
    try {
      setLocalProxy(await setLocalProxyAutoDisableUnreachable(enabled));
      await load();
    } catch (error) {
      notify(providerErrorMessage(error, t));
    } finally {
      setProxyBusy(false);
    }
  }, [load, notify, t]);

  const setProxyImageAccount = useCallback(async (accountId: string | null) => {
    setProxyBusy(true);
    try {
      setLocalProxy(await setLocalProxyImageAccount(accountId));
      notify(t("toast.proxyImageAccountSaved"));
      await load();
    } catch (error) {
      notify(providerErrorMessage(error, t));
    } finally {
      setProxyBusy(false);
    }
  }, [load, notify, t]);

  const setProxyListenOnAllInterfaces = useCallback(async (enabled: boolean) => {
    setProxyBusy(true);
    try {
      setLocalProxy(await setLocalProxyListenOnAllInterfaces(enabled));
      notify(t(enabled ? "toast.proxyLanListeningEnabled" : "toast.proxyLanListeningDisabled"));
      await load();
    } catch (error) {
      notify(providerErrorMessage(error, t));
      await load();
    } finally {
      setProxyBusy(false);
    }
  }, [load, notify, t]);

  return {
    providers,
    localProxy,
    loading,
    busyProviderId,
    saving,
    proxyBusy,
    conversationRestoreBusy,
    activeProvider: providers.find((provider) => provider.active) ?? null,
    saveProvider,
    switchProvider,
    switchModel,
    setModelControl,
    deleteProvider,
    startProxy,
    stopProxy,
    restoreConversations,
    setProxyAutoSwitch,
    setProxyAutoDisableUnreachable,
    setProxyImageAccount,
    setProxyListenOnAllInterfaces,
    reload: load,
  };
}
