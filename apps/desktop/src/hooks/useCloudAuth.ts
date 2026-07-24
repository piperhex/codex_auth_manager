import { useCallback, useEffect, useState } from "react";
import {
  changeCloudPassword,
  loadCloudAuthState,
  deleteCloudAccount,
  deleteCloudProvider,
  loginCloud,
  logoutCloud,
  pushCloudAccount,
  pushCloudAccounts,
  pushCloudProvider,
  pushCloudProviders,
  registerCloud,
  requestCloudRegistrationCode,
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
  sessionExpired: false,
};

export function useCloudAuth(notify: (message: string) => void, t: Translate) {
  const [state, setState] = useState<CloudAuthState>(DISABLED_STATE);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [sendingRegistrationCode, setSendingRegistrationCode] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

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

  const login = useCallback(async (email: string, password: string, rememberPassword: boolean) => {
    setLoading(true);
    try {
      const result = await loginCloud(email, password, rememberPassword);
      setState(result.state);
      notify(t("toast.cloudLoginSuccess"));
      if (!result.credentialStorageUpdated) {
        notify(t("toast.cloudPasswordSaveFailed"));
      }
      return true;
    } catch (error) {
      notify(String(error));
      return false;
    } finally {
      setLoading(false);
    }
  }, [notify, t]);

  const sendRegistrationCode = useCallback(async (email: string) => {
    setSendingRegistrationCode(true);
    try {
      await requestCloudRegistrationCode(email);
      notify(t("toast.cloudVerificationCodeSent"));
      return true;
    } catch (error) {
      notify(String(error));
      return false;
    } finally {
      setSendingRegistrationCode(false);
    }
  }, [notify, t]);

  const register = useCallback(async (
    email: string,
    password: string,
    verificationCode: string,
    rememberPassword: boolean,
  ) => {
    setLoading(true);
    try {
      const result = await registerCloud(email, password, verificationCode, rememberPassword);
      setState(result.state);
      notify(t("toast.cloudRegisterSuccess"));
      if (!result.credentialStorageUpdated) {
        notify(t("toast.cloudPasswordSaveFailed"));
      }
      return true;
    } catch (error) {
      notify(String(error));
      return false;
    } finally {
      setLoading(false);
    }
  }, [notify, t]);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    setChangingPassword(true);
    try {
      await changeCloudPassword(currentPassword, newPassword);
      notify(t("toast.cloudPasswordChanged"));
      return true;
    } catch (error) {
      notify(String(error));
      return false;
    } finally {
      setChangingPassword(false);
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

  const pushAccountQuietly = useCallback(async (id: string) => {
    if (!state.authenticated) return;
    try {
      await pushCloudAccount(id);
      await load();
    } catch {
      // Local account operations remain local-first if cloud sync is temporarily unavailable.
    }
  }, [load, state.authenticated]);

  const deleteAccountQuietly = useCallback(async (id: string) => {
    if (!state.authenticated) return;
    try {
      await deleteCloudAccount(id);
      await load();
    } catch {
      // Deletion can be retried by manual full sync if the cloud is temporarily unreachable.
    }
  }, [load, state.authenticated]);

  const pushProvidersQuietly = useCallback(async () => {
    if (!state.authenticated) return;
    try {
      await pushCloudProviders();
      await load();
    } catch {
      // Provider operations remain local-first if cloud sync is temporarily unavailable.
    }
  }, [load, state.authenticated]);

  const pushProviderQuietly = useCallback(async (id: string) => {
    if (!state.authenticated) return;
    try {
      await pushCloudProvider(id);
      await load();
    } catch {
      // Provider operations remain local-first if cloud sync is temporarily unavailable.
    }
  }, [load, state.authenticated]);

  const deleteProviderQuietly = useCallback(async (id: string) => {
    if (!state.authenticated) return;
    try {
      await deleteCloudProvider(id);
      await load();
    } catch {
      // Deletion can be retried manually if the cloud is temporarily unreachable.
    }
  }, [load, state.authenticated]);

  return {
    state,
    loading,
    syncing,
    sendingRegistrationCode,
    changingPassword,
    load,
    saveBaseUrl,
    login,
    sendRegistrationCode,
    register,
    changePassword,
    logout,
    sync,
    pushQuietly,
    pushAccountQuietly,
    deleteAccountQuietly,
    pushProvidersQuietly,
    pushProviderQuietly,
    deleteProviderQuietly,
  };
}
