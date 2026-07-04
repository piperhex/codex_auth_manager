import { useCallback, useEffect, useState } from "react";
import {
  loadCloudAuthState,
  loginCloud,
  logoutCloud,
  pushCloudAccounts,
  syncCloudAccounts,
  updateCloudBaseUrl,
} from "../api/backend";
import type { Translate } from "../i18n";
import type { CloudAuthState } from "../types";

const DISABLED_STATE: CloudAuthState = {
  enabled: false,
  baseUrl: null,
  authenticated: false,
  userEmail: null,
  userId: null,
  lastSyncAt: null,
};

export function useCloudAuth(notify: (message: string) => void, t: Translate) {
  const [state, setState] = useState<CloudAuthState>(DISABLED_STATE);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    const nextState = await loadCloudAuthState();
    setState(nextState);
    return nextState;
  }, []);

  useEffect(() => {
    let active = true;
    void loadCloudAuthState()
      .then((nextState) => {
        if (active) setState(nextState);
      })
      .catch((error) => notify(String(error)))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [notify]);

  const saveBaseUrl = useCallback(async (baseUrl: string) => {
    setLoading(true);
    try {
      const nextState = await updateCloudBaseUrl(baseUrl);
      setState(nextState);
      notify(nextState.enabled ? t("toast.cloudServerSaved") : t("toast.cloudServerDisabled"));
      return nextState;
    } catch (error) {
      notify(String(error));
      return state;
    } finally {
      setLoading(false);
    }
  }, [notify, state, t]);

  const login = useCallback(async (email: string, password: string) => {
    setLoading(true);
    try {
      const nextState = await loginCloud(email, password);
      setState(nextState);
      notify(t("toast.cloudLoginSuccess"));
      return true;
    } catch (error) {
      notify(String(error));
      return false;
    } finally {
      setLoading(false);
    }
  }, [notify, t]);

  const logout = useCallback(async () => {
    setLoading(true);
    try {
      const nextState = await logoutCloud();
      setState(nextState);
      notify(t("toast.cloudLogoutSuccess"));
    } catch (error) {
      notify(String(error));
    } finally {
      setLoading(false);
    }
  }, [notify, t]);

  const sync = useCallback(async () => {
    if (!state.authenticated) return null;
    setSyncing(true);
    try {
      const result = await syncCloudAccounts();
      await load();
      notify(t("toast.cloudSynced", { uploaded: result.uploaded, downloaded: result.downloaded }));
      return result;
    } catch (error) {
      notify(String(error));
      return null;
    } finally {
      setSyncing(false);
    }
  }, [load, notify, state.authenticated, t]);

  const pushQuietly = useCallback(async () => {
    if (!state.authenticated) return;
    try {
      await pushCloudAccounts();
      await load();
    } catch {
      // Local account operations should stay local-first even when the cloud is temporarily unreachable.
    }
  }, [load, state.authenticated]);

  return {
    state,
    loading,
    syncing,
    load,
    saveBaseUrl,
    login,
    logout,
    sync,
    pushQuietly,
  };
}
