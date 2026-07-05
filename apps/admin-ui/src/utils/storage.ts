import { THEME_KEY, TOKEN_KEY } from "../constants";
import type { AuthTokens } from "../types";

export function loadStoredAuth(): AuthTokens | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    return raw ? JSON.parse(raw) as AuthTokens : null;
  } catch {
    return null;
  }
}

export function persistAuth(tokens: AuthTokens | null) {
  if (tokens) localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
  else localStorage.removeItem(TOKEN_KEY);
}

export function loadThemeMode() {
  return localStorage.getItem(THEME_KEY) === "dark";
}

export function persistThemeMode(dark: boolean) {
  localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
}
