import { useCallback, useEffect, useRef, useState } from "react";
import { fetchResetCredits } from "../api/backend";
import type { Translate } from "../i18n";
import type { Account, ResetCreditsLoadState } from "../types";

export function useResetCredits(accounts: Account[], notify: (message: string) => void, t: Translate) {
  const [states, setStates] = useState<Record<string, ResetCreditsLoadState>>({});
  const requests = useRef(new Set<string>());
  const refreshingAllRef = useRef(false);
  const [refreshingAll, setRefreshingAll] = useState(false);

  useEffect(() => {
    const accountIds = new Set(accounts.map((account) => account.id));
    setStates((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(([id]) => accountIds.has(id)),
      ) as Record<string, ResetCreditsLoadState>;
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
    for (const id of Array.from(requests.current)) {
      if (!accountIds.has(id)) requests.current.delete(id);
    }
  }, [accounts]);

  const refreshAccount = useCallback(async (id: string, force = false) => {
    if (requests.current.has(id)) return;
    if (!force && states[id]) return;
    requests.current.add(id);
    setStates((current) => ({ ...current, [id]: { status: "loading" } }));
    try {
      const data = await fetchResetCredits(id);
      setStates((current) => ({ ...current, [id]: { status: "loaded", data } }));
    } catch (error) {
      setStates((current) => ({ ...current, [id]: { status: "error", error: String(error) } }));
    } finally {
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
