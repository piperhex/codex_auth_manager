import { useCallback, useEffect, useState } from "react";
import { loadAppSettings, subscribeToThemeColorChanges, updateThemeColor } from "../api/backend";
import { applyThemeColor, DEFAULT_THEME_COLOR, normalizeThemeColor } from "../utils/theme";

export function useThemeColor(notify: (message: string) => void) {
  const [color, setColor] = useState(() => applyThemeColor(DEFAULT_THEME_COLOR));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void loadAppSettings()
      .then((settings) => {
        if (!active) return;
        const nextColor = applyThemeColor(normalizeThemeColor(settings.themeColor));
        setColor(nextColor);
      })
      .catch((error) => notify(String(error)))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [notify]);

  useEffect(() => subscribeToThemeColorChanges((nextColor) => {
    setColor(applyThemeColor(nextColor));
  }), []);

  const updateColor = useCallback(async (nextColor: string) => {
    const normalized = normalizeThemeColor(nextColor);
    const previous = color;
    setColor(applyThemeColor(normalized));
    setLoading(true);
    try {
      const settings = await updateThemeColor(normalized);
      setColor(applyThemeColor(normalizeThemeColor(settings.themeColor)));
    } catch (error) {
      setColor(applyThemeColor(previous));
      notify(String(error));
    } finally {
      setLoading(false);
    }
  }, [color, notify]);

  return { color, loading, setColor: updateColor };
}
