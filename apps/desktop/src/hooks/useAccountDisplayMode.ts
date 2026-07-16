import { useCallback, useState } from "react";

const ACCOUNT_DISPLAY_MODE_KEY = "codex-switch:account-display-mode";

export type AccountDisplayMode = "table" | "cards";

function loadAccountDisplayMode(): AccountDisplayMode {
  return window.localStorage.getItem(ACCOUNT_DISPLAY_MODE_KEY) === "cards" ? "cards" : "table";
}

export function useAccountDisplayMode() {
  const [displayMode, setDisplayModeState] = useState<AccountDisplayMode>(loadAccountDisplayMode);

  const setDisplayMode = useCallback((mode: AccountDisplayMode) => {
    window.localStorage.setItem(ACCOUNT_DISPLAY_MODE_KEY, mode);
    setDisplayModeState(mode);
  }, []);

  return { displayMode, setDisplayMode };
}
