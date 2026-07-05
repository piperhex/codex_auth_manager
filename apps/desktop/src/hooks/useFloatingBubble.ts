import { useCallback, useEffect, useState } from "react";
import { loadAppSettings, updateFloatingBubble } from "../api/backend";

export function useFloatingBubble(notify: (message: string) => void) {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void loadAppSettings()
      .then((settings) => {
        if (active) setEnabled(settings.floatingBubbleEnabled);
      })
      .catch((error) => notify(String(error)))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [notify]);

  const updateEnabled = useCallback(async (nextEnabled: boolean) => {
    const previous = enabled;
    setEnabled(nextEnabled);
    setLoading(true);
    try {
      const settings = await updateFloatingBubble(nextEnabled);
      setEnabled(settings.floatingBubbleEnabled);
    } catch (error) {
      setEnabled(previous);
      notify(String(error));
    } finally {
      setLoading(false);
    }
  }, [enabled, notify]);

  return { enabled, loading, setEnabled: updateEnabled };
}
