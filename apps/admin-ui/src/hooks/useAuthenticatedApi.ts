import { useCallback, useEffect, useRef } from "react";
import type { Translate } from "../i18n";
import type { AuthTokens } from "../types";

export function useAuthenticatedApi(
  auth: AuthTokens | null,
  saveAuth: (tokens: AuthTokens | null) => void,
  t: Translate,
) {
  const authRef = useRef(auth);
  const refreshPromiseRef = useRef<Promise<AuthTokens> | null>(null);

  useEffect(() => {
    authRef.current = auth;
  }, [auth]);

  const updateAuth = useCallback((tokens: AuthTokens | null) => {
    authRef.current = tokens;
    saveAuth(tokens);
  }, [saveAuth]);

  const refreshAuth = useCallback(() => {
    if (refreshPromiseRef.current) return refreshPromiseRef.current;

    const refreshToken = authRef.current?.refreshToken;
    if (!refreshToken) return Promise.reject(new Error(t("errors.sessionExpired")));

    const refreshPromise = fetch("/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    }).then(async (response) => {
      if (!response.ok) {
        updateAuth(null);
        throw new Error(t("errors.sessionExpired"));
      }
      const refreshed = await response.json() as AuthTokens;
      if (!refreshed.accessToken || !refreshed.refreshToken) {
        updateAuth(null);
        throw new Error(t("errors.sessionExpired"));
      }
      updateAuth(refreshed);
      return refreshed;
    }).finally(() => {
      if (refreshPromiseRef.current === refreshPromise) refreshPromiseRef.current = null;
    });

    refreshPromiseRef.current = refreshPromise;
    return refreshPromise;
  }, [t, updateAuth]);

  const authenticatedFetch = useCallback(async (
    path: string,
    options: RequestInit = {},
    jsonRequest = true,
  ) => {
    const requestWithToken = (token: string) => {
      const headers = new Headers(options.headers);
      if (jsonRequest && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
      headers.set("Authorization", `Bearer ${token}`);
      return fetch(path, { ...options, headers });
    };

    const requestAuth = authRef.current;
    if (!requestAuth?.accessToken) throw new Error(t("errors.notSignedIn"));

    let response = await requestWithToken(requestAuth.accessToken);
    if (response.status !== 401) return response;

    const latestAuth = authRef.current;
    const retryAuth = latestAuth?.accessToken && latestAuth.accessToken !== requestAuth.accessToken
      ? latestAuth
      : await refreshAuth();
    response = await requestWithToken(retryAuth.accessToken);
    return response;
  }, [refreshAuth, t]);

  const signOut = useCallback(async () => {
    const refreshToken = authRef.current?.refreshToken;
    if (refreshToken) {
      await fetch("/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      }).catch(() => undefined);
    }
    updateAuth(null);
  }, [updateAuth]);

  const api = useCallback(async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
    const parse = async (response: Response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || response.statusText);
      return data as T;
    };

    return parse(await authenticatedFetch(path, options));
  }, [authenticatedFetch]);

  const apiBlob = useCallback(async (path: string): Promise<Blob> => {
    const response = await authenticatedFetch(path, {}, false);
    if (!response.ok) {
      const error = await response.json().catch(() => null) as { message?: string } | null;
      throw new Error(error?.message || response.statusText);
    }
    return response.blob();
  }, [authenticatedFetch]);

  return { api, apiBlob, signOut };
}
