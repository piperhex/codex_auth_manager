import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from "react";
import {
  dragFloatingBubble,
  loadDashboard,
  refreshAccountUsage,
  showDashboardFromBubble,
  showFloatingBubbleMenu,
  subscribeToBackendEvents,
} from "../api/backend";
import { useLanguage } from "../hooks/useLanguage";
import { useThemeColor } from "../hooks/useThemeColor";
import type { Account } from "../types";
import { remainingTone, resetClockTime } from "../utils/format";

function usageColor(remaining: number) {
  const tone = remainingTone(remaining);
  if (tone === "danger") return "#ef6b62";
  if (tone === "warning") return "#e5b84f";
  return "var(--green-highlight)";
}

function waterColors(remaining: number | null) {
  const tone = remaining === null ? "good" : remainingTone(remaining);
  if (tone === "danger") return { top: "#ff8a78", main: "#ef4f45", bottom: "#c92e32" };
  if (tone === "warning") return { top: "#ffd76a", main: "#e5b84f", bottom: "#c88716" };
  return { top: "#20b7ed", main: "#0b93d9", bottom: "#0873d5" };
}

const ignoreThemeError = () => undefined;
const DRAG_THRESHOLD_PX = 5;

interface BubblePointerGesture {
  pointerId: number;
  startX: number;
  startY: number;
  dragging: boolean;
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function BubbleResetLabel({ timestamp, language }: { timestamp?: number | null; language: "en" | "zh" }) {
  const clock = resetClockTime(timestamp);
  return (
    <small className="floating-bubble-reset floating-bubble-reset-stacked">
      <span>{language === "zh" ? (clock ? "重置于" : "重置时间") : (clock ? "Resets at" : "Reset time")}</span>
      <span>{clock ?? (language === "zh" ? "未知" : "unknown")}</span>
    </small>
  );
}

export function FloatingUsageBubble() {
  const { language } = useLanguage();
  useThemeColor(ignoreThemeError);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [waterSettling, setWaterSettling] = useState(false);
  const lastPrimaryPointerDownAt = useRef(0);
  const pointerGesture = useRef<BubblePointerGesture | null>(null);
  const refreshingRef = useRef(false);
  const previousRemaining = useRef<number | null>(null);

  const load = useCallback(async () => {
    const { accounts: nextAccounts } = await loadDashboard();
    setAccounts(nextAccounts);
  }, []);

  useEffect(() => {
    void load();
    return subscribeToBackendEvents(load, load);
  }, [load]);

  const account = useMemo(() => accounts.find((item) => item.active), [accounts]);
  const primary = account?.usage.primary;
  const secondary = account?.usage.secondary;
  const remaining = primary ? clampPercent(primary.remainingPercent) : null;
  const weeklyRemaining = secondary ? clampPercent(secondary.remainingPercent) : null;
  const water = waterColors(remaining);
  const bubbleLabel = language === "zh"
    ? (refreshing ? "正在刷新当前账号额度" : "点击刷新当前账号额度")
    : (refreshing ? "Refreshing current account quota" : "Click to refresh current account quota");
  const ringStyle = {
    "--bubble-progress": `${weeklyRemaining ?? 0}%`,
    "--bubble-color": weeklyRemaining === null ? "#7b8780" : usageColor(weeklyRemaining),
    "--bubble-water-level": `${remaining ?? 0}%`,
    "--bubble-water-top": water.top,
    "--bubble-water-color": water.main,
    "--bubble-water-bottom": water.bottom,
  } as CSSProperties;

  useEffect(() => {
    if (remaining === null) {
      previousRemaining.current = null;
      setWaterSettling(false);
      return;
    }
    const previous = previousRemaining.current;
    previousRemaining.current = remaining;
    if (previous !== null && remaining < previous) {
      setWaterSettling(true);
      const timer = window.setTimeout(() => setWaterSettling(false), 1100);
      return () => window.clearTimeout(timer);
    }
  }, [remaining]);

  const refreshCurrentAccount = useCallback(async () => {
    if (!account || refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      await refreshAccountUsage(account.id);
      await load();
    } catch {
      await load().catch(() => undefined);
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }, [account, load]);

  const startPointerGesture = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const now = Date.now();
    if (now - lastPrimaryPointerDownAt.current < 350) {
      lastPrimaryPointerDownAt.current = 0;
      pointerGesture.current = null;
      void showDashboardFromBubble();
      return;
    }
    lastPrimaryPointerDownAt.current = now;
    pointerGesture.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const continuePointerGesture = (event: PointerEvent<HTMLButtonElement>) => {
    const gesture = pointerGesture.current;
    if (!gesture || gesture.pointerId !== event.pointerId || gesture.dragging || !(event.buttons & 1)) return;
    if (Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) < DRAG_THRESHOLD_PX) return;
    gesture.dragging = true;
    lastPrimaryPointerDownAt.current = 0;
    event.preventDefault();
    void dragFloatingBubble();
  };

  const finishPointerGesture = (event: PointerEvent<HTMLButtonElement>) => {
    const gesture = pointerGesture.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    pointerGesture.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!gesture.dragging) void refreshCurrentAccount();
  };

  const cancelPointerGesture = (event: PointerEvent<HTMLButtonElement>) => {
    if (pointerGesture.current?.pointerId === event.pointerId) pointerGesture.current = null;
  };

  const openContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    void showFloatingBubbleMenu();
  };

  return (
    <div className="floating-usage-window" onContextMenu={openContextMenu}>
      <button type="button" className={`floating-bubble ${waterSettling ? "is-water-settling" : ""} ${refreshing ? "is-refreshing" : ""}`} style={ringStyle}
        aria-label={bubbleLabel}
        title={bubbleLabel}
        aria-busy={refreshing}
        onPointerDown={startPointerGesture}
        onPointerMove={continuePointerGesture}
        onPointerUp={finishPointerGesture}
        onPointerCancel={cancelPointerGesture}
        onClick={(event) => { if (event.detail === 0) void refreshCurrentAccount(); }}>
        <span className="floating-bubble-water" aria-hidden="true" />
        <span className="floating-bubble-weekly" aria-hidden="true">
          {language === "zh" ? "周" : "W"} {weeklyRemaining === null ? "--" : `${weeklyRemaining}%`}
        </span>
        <span className="floating-bubble-value">{remaining === null ? "--" : `${remaining}%`}</span>
        <BubbleResetLabel timestamp={primary?.resetsAt} language={language} />
      </button>
    </div>
  );
}
