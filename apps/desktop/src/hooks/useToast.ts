import { useCallback, useEffect, useRef, useState } from "react";

export function useToast() {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<number>();

  const notify = useCallback((nextMessage: string) => {
    window.clearTimeout(timer.current);
    setMessage(nextMessage);
    timer.current = window.setTimeout(() => setMessage(null), 3400);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);
  return { message, notify };
}
