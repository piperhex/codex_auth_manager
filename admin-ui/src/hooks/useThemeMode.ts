import { useEffect, useState } from "react";
import { loadThemeMode, persistThemeMode } from "../utils/storage";

export function useThemeMode() {
  const [dark, setDark] = useState(loadThemeMode);

  useEffect(() => {
    persistThemeMode(dark);
    document.body.classList.toggle("dark", dark);
  }, [dark]);

  return [dark, setDark] as const;
}
