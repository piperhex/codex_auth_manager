import { useCallback, useEffect, useRef, useState } from "react";
import { fetchResetCredits } from "../api/backend";
import type { Translate } from "../i18n";
import type { Account, ResetCreditsLoadState } from "../types";

const RESET_CREDITS_CACHE_KEY = "codex-switch:reset-credits-cache";

type LoadedResetCreditsState = Extract<ResetCreditsLoadState, { status: "loaded" }>;

function cachedCreditFrom(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { issuedAt: null, expiresAt: null };
  }
  const credit = value as { issuedAt?: unknown; expiresAt?: unknown };
  return {
    issuedAt: typeof credit.issuedAt === "string" ? credit.issuedAt : null,
    expiresAt: typeof credit.expiresAt === "string" ? credit.expiresAt : null,
  };
}

function cachedStateFrom(value: unknown): LoadedResetCreditsState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const state = value as Partial<LoadedResetCreditsState>;
  if (state.status !== "loaded" || typeof state.fetchedAt !== "string") return null;
  if (!state.data || typeof state.data !== "object" || !Array.isArray(state.data.credits)) return null;
  return {
    status: "loaded",
    data: {
      credits: state.data.credits.map(cachedCreditFrom),
    },
    fetchedAt: state.fetchedAt,
  };
}

function loadResetCreditsCache() {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(RESET_CREDITS_CACHE_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).flatMap(([id, state]) => {
      const cachedState = cachedStateFrom(state);
      return cachedState ? [[id, cachedState]] : [];
    })) as Record<string, LoadedResetCreditsState>;
  } catch {
    return {};
  }
}

function persistResetCreditsCache(states: Record<string, LoadedResetCreditsState>) {
  if (!Object.keys(states).length) {
    window.localStorage.removeItem(RESET_CREDITS_CACHE_KEY);
    return;
  }
  window.localStorage.setItem(RESET_CREDITS_CACHE_KEY, JSON.stringify(states));
}

function sameStateRecord(left: Record<string, ResetCreditsLoadState>, right: Record<string, ResetCreditsLoadState>) {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length && leftKeys.every((key) => left[key] === right[key]);
}

export function useResetCredits(accounts: Account[], notify: (message: string) => void, t: Translate) {
  const [states, setStates] = useState<Record<string, ResetCreditsLoadState>>({});
  const cachedStates = useRef(loadResetCreditsCache());
  const sessionRequests = useRef(new Set<string>());
  const requests = useRef(new Set<string>());
  const refreshingAllRef = useRef(false);
  const [refreshingAll, setRefreshingAll] = useState(false);

  useEffect(() => {
    const accountIds = new Set(accounts.map((account) => account.id));
    if (accountIds.size) {
      cachedStates.current = Object.fromEntries(
        Object.entries(cachedStates.current).filter(([id]) => accountIds.has(id)),
      );
      persistResetCreditsCache(cachedStates.current);
    }

    setStates((current) => {
      const next = Object.fromEntries(accounts.flatMap((account) => {
        const state = current[account.id] ?? cachedStates.current[account.id];
        return state ? [[account.id, state]] : [];
      })) as Record<string, ResetCreditsLoadState>;
      return sameStateRecord(current, next) ? current : next;
    });
    for (const id of Array.from(requests.current)) {
      if (!accountIds.has(id)) requests.current.delete(id);
    }
    for (const id of Array.from(sessionRequests.current)) {
      if (!accountIds.has(id)) sessionRequests.current.delete(id);
    }
  }, [accounts]);

  const refreshAccount = useCallback(async (id: string, force = false) => {
    if (requests.current.has(id)) return;
    if (!force && states[id] && sessionRequests.current.has(id)) return;
    requests.current.add(id);
    setStates((current) => ({ ...current, [id]: { status: "loading" } }));
    try {
      const data = await fetchResetCredits(id);
      const loadedState: LoadedResetCreditsState = { status: "loaded", data, fetchedAt: new Date().toISOString() };
      cachedStates.current = { ...cachedStates.current, [id]: loadedState };
      persistResetCreditsCache(cachedStates.current);
      setStates((current) => ({ ...current, [id]: loadedState }));
    } catch (error) {
      setStates((current) => ({ ...current, [id]: { status: "error", error: String(error) } }));
    } finally {
      sessionRequests.current.add(id);
      requests.current.delete(id);
    }
  }, [states]);

  const refreshAll = useCallback(async () => {
    if (!accounts.length || refreshingAllRef.current) return;
    refreshingAllRef.current = true;
    setRefreshingAll(true);
    try {
      await Promise.allSettled(accounts.map((account) => refreshAccount(account.id, true)));
      notify(t("toast.resetCreditsRefreshed"));
    } finally {
      refreshingAllRef.current = false;
      setRefreshingAll(false);
    }
  }, [accounts, notify, refreshAccount, t]);

  return {
    states,
    refreshingAll,
    refreshAccount,
    refreshAll,
  };
}
