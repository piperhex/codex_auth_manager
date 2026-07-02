import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from "react";
import {
  dragFloatingBubble,
  loadDashboard,
  resizeFloatingBubble,
  showDashboardFromBubble,
  showFloatingBubbleMenu,
  subscribeToBackendEvents,
} from "../api/backend";
import { useLanguage } from "../hooks/useLanguage";
import { useThemeColor } from "../hooks/useThemeColor";
import type { Account, UsageWindow } from "../types";
import { formatUpdated, remainingTone, resetLabel, type UsageResetWindow } from "../utils/format";

function usageColor(remaining: number) {
  const tone = remainingTone(remaining);
  if (tone === "danger") return "#ef6b62";
  if (tone === "warning") return "#e5b84f";
  return "var(--green-highlight)";
}

const ignoreThemeError = () => undefined;

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function DetailRow({ label, usage, language, resetWindow, now }: {
  label: string;
  usage?: UsageWindow | null;
  language: "en" | "zh";
  resetWindow: UsageResetWindow;
  now: number;
}) {
  if (!usage) {
    const emptyStyle = {
      "--bubble-detail-progress": "0%",
      "--bubble-detail-color": "#6f7d74",
    } as CSSProperties;
    return (
      <div className={`bubble-detail-row bubble-detail-row-${resetWindow}`} style={emptyStyle}>
        <div className="bubble-detail-row-head"><b>{label}</b><span>--</span></div>
        <div className="bubble-detail-progress" aria-hidden="true"><i /></div>
      </div>
    );
  }
  const remaining = clampPercent(usage.remainingPercent);
  const progressStyle = {
    "--bubble-detail-progress": `${remaining}%`,
    "--bubble-detail-color": usageColor(remaining),
  } as CSSProperties;
  return (
    <div className={`bubble-detail-row bubble-detail-row-${resetWindow}`} style={progressStyle}>
      <div className="bubble-detail-row-head">
        <b>{label}</b>
        <span>{language === "zh" ? `剩余 ${remaining}%` : `${remaining}% left`}</span>
      </div>
      <div className="bubble-detail-progress" aria-hidden="true"><i /></div>
      <small>{resetLabel(usage.resetsAt, language, resetWindow, now)}</small>
    </div>
  );
}

export function FloatingUsageBubble() {
  const { language } = useLanguage();
  useThemeColor(ignoreThemeError);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [waterSettling, setWaterSettling] = useState(false);
  const lastPrimaryPointerDownAt = useRef(0);
  const previousRemaining = useRef<number | null>(null);

  const load = useCallback(() => {
    void loadDashboard().then(({ accounts: nextAccounts }) => setAccounts(nextAccounts));
  }, []);

  useEffect(() => {
    load();
    return subscribeToBackendEvents(load, load);
  }, [load]);

  const account = useMemo(() => accounts.find((item) => item.active), [accounts]);
  const primary = account?.usage.primary;
  const secondary = account?.usage.secondary;
  const hasFiveHourReset = Boolean(primary?.resetsAt);
  const remaining = primary ? clampPercent(primary.remainingPercent) : null;
  const weeklyRemaining = secondary ? clampPercent(secondary.remainingPercent) : null;
  const ringStyle = {
    "--bubble-progress": `${weeklyRemaining ?? 0}%`,
    "--bubble-color": weeklyRemaining === null ? "#7b8780" : usageColor(weeklyRemaining),
    "--bubble-water-level": `${remaining ?? 0}%`,
    "--bubble-water-color": "#43c7ff",
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

  useEffect(() => {
    if (!expanded || !hasFiveHourReset) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [expanded, hasFiveHourReset]);

  const setHover = (nextExpanded: boolean) => {
    setExpanded(nextExpanded);
    void resizeFloatingBubble(nextExpanded);
  };

  const startDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const now = Date.now();
    if (now - lastPrimaryPointerDownAt.current < 350) {
      lastPrimaryPointerDownAt.current = 0;
      setExpanded(false);
      void resizeFloatingBubble(false).then(showDashboardFromBubble);
      return;
    }
    lastPrimaryPointerDownAt.current = now;
    setExpanded(false);
    void resizeFloatingBubble(false).then(dragFloatingBubble);
  };

  const openContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setExpanded(false);
    void resizeFloatingBubble(false).then(showFloatingBubbleMenu);
  };

  return (
    <div className={`floating-usage-window ${expanded ? "is-expanded" : ""}`}
      onContextMenu={openContextMenu}
      onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}>
      {expanded && (
        <aside className="bubble-details">
          <header>
            <span>{language === "zh" ? "当前账号" : "Current account"}</span>
            <strong title={account?.email}>{account?.email ?? (language === "zh" ? "暂无账号" : "No account")}</strong>
            {account && <small>{account.plan}</small>}
          </header>
          <DetailRow label="5h" usage={primary} language={language} resetWindow="fiveHours" now={now} />
          <DetailRow label={language === "zh" ? "1 周" : "1 week"} usage={account?.usage.secondary} language={language} resetWindow="oneWeek" now={now} />
          <footer>{language === "zh" ? "更新于 " : "Updated "}{formatUpdated(account?.usage.fetchedAt, language)}</footer>
        </aside>
      )}
      <button type="button" className={`floating-bubble ${waterSettling ? "is-water-settling" : ""}`} style={ringStyle}
        aria-label={language === "zh" ? "当前账号 5 小时用量" : "Current account 5-hour usage"}
        onPointerDown={startDrag}>
        <span className="floating-bubble-water" aria-hidden="true" />
        <span className="floating-bubble-value">{remaining === null ? "--" : `${remaining}%`}</span>
        <small>{language === "zh" ? "5h 剩余" : "5h left"}</small>
      </button>
    </div>
  );
}
