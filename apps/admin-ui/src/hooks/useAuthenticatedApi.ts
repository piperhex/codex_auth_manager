import { useCallback } from "react";
import type { Translate } from "../i18n";
import type { AuthTokens } from "../types";

export function useAuthenticatedApi(
  auth: AuthTokens | null,
  saveAuth: (tokens: AuthTokens | null) => void,
  t: Translate,
) {
  const signOut = useCallback(async () => {
    if (auth?.refreshToken) {
      await fetch("/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: auth.refreshToken }),
      }).catch(() => undefined);
    }
    saveAuth(null);
  }, [auth?.refreshToken, saveAuth]);

  const api = useCallback(async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
    const requestWithToken = async (token: string) => fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(options.headers ?? {}),
      },
    });

    const parse = async (response: Response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || response.statusText);
      return data as T;
    };

    if (!auth?.accessToken) throw new Error(t("errors.notSignedIn"));
    let response = await requestWithToken(auth.accessToken);
    if (response.status === 401 && auth.refreshToken) {
      const refreshResponse = await fetch("/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: auth.refreshToken }),
      });
      if (!refreshResponse.ok) {
        saveAuth(null);
        throw new Error(t("errors.sessionExpired"));
      }
      const refreshed = await refreshResponse.json() as AuthTokens;
      saveAuth(refreshed);
      response = await requestWithToken(refreshed.accessToken);
    }
    return parse(response);
  }, [auth, saveAuth, t]);

  return { api, signOut };
}
