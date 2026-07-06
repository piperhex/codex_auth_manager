import { useCallback, useEffect, useState } from "react";
import {
  activateProvider,
  deactivateProvider,
  loadLocalProxyStatus,
  loadProviders,
  removeProvider,
  saveProviderProfile,
  setProviderModelControl,
  startLocalProxy,
  stopLocalProxy,
  subscribeToProviderEvents,
  switchProviderModel,
} from "../api/backend";
import type { Translate } from "../i18n";
import type { LocalProxyStatus, Provider, ProviderInput } from "../types";

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
  if (message.startsWith("Base URL is invalid:")) {
    return t("providers.error.baseUrlInvalid", { error: message.slice("Base URL is invalid:".length).trim() });
  }
  return message;
}

export function useProviderManager(notify: (message: string) => void, t: Translate) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [localProxy, setLocalProxy] = useState<LocalProxyStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyProviderId, setBusyProviderId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [proxyBusy, setProxyBusy] = useState(false);

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
      return saved;
    } catch (error) {
      notify(providerErrorMessage(error, t));
      return null;
    } finally {
      setSaving(false);
    }
  }, [load, notify, t]);

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
    } catch (error) {
      notify(providerErrorMessage(error, t));
    } finally {
      setBusyProviderId(null);
    }
  }, [load, notify, t]);

  const setModelControl = useCallback(async (id: string, controlledByCodex: boolean) => {
    setBusyProviderId(id);
    try {
      await setProviderModelControl(id, controlledByCodex);
      notify(t("toast.providerModelControlSaved"));
      await load();
    } catch (error) {
      notify(providerErrorMessage(error, t));
    } finally {
      setBusyProviderId(null);
    }
  }, [load, notify, t]);

  const useOfficialProvider = useCallback(async () => {
    setBusyProviderId("official");
    try {
      await deactivateProvider();
      notify(t("toast.providerRestored"));
      await load();
    } catch (error) {
      notify(providerErrorMessage(error, t));
    } finally {
      setBusyProviderId(null);
    }
  }, [load, notify, t]);

  const deleteProvider = useCallback(async (id: string) => {
    setBusyProviderId(id);
    try {
      await removeProvider(id);
      notify(t("toast.providerDeleted"));
      await load();
    } catch (error) {
      notify(providerErrorMessage(error, t));
    } finally {
      setBusyProviderId(null);
    }
  }, [load, notify, t]);

  const startProxy = useCallback(async () => {
    setProxyBusy(true);
    try {
      setLocalProxy(await startLocalProxy());
      notify(t("toast.localProxyStarted"));
      await load();
    } catch (error) {
      notify(providerErrorMessage(error, t));
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
    activeProvider: providers.find((provider) => provider.active) ?? null,
    saveProvider,
    switchProvider,
    switchModel,
    setModelControl,
    useOfficialProvider,
    deleteProvider,
    startProxy,
    stopProxy,
    reload: load,
  };
}
