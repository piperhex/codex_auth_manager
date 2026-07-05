import { Progress } from "antd";
import { useEffect, useState } from "react";
import type { Language, Translate } from "../../i18n";
import type { UsageWindow } from "../../types";
import { remainingTone, resetCountdownTime, resetLabel, type UsageResetWindow } from "../../utils/format";

function usageStroke(value: number) {
  const tone = remainingTone(value);
  if (tone === "danger") return "#d2685b";
  if (tone === "warning") return "#d0a340";
  return "var(--green)";
}

function tableResetLabel(timestamp: number | null | undefined, language: Language, resetWindow: UsageResetWindow, now: number) {
  const label = resetLabel(timestamp, language, resetWindow);
  if (resetWindow !== "fiveHours" || !timestamp) return label;
  const countdown = resetCountdownTime(timestamp, now);
  if (!countdown) return label;
  return language === "zh" ? `${label}(倒计时：${countdown})` : `${label} (Countdown: ${countdown})`;
}

export function UsageMeter({ window: usageWindow, resetWindow, language, t }: {
  window?: UsageWindow | null;
  resetWindow: UsageResetWindow;
  language: Language;
  t: Translate;
}) {
  const [now, setNow] = useState(() => Date.now());
  const countdownActive = resetWindow === "fiveHours" && Boolean(usageWindow?.resetsAt);

  useEffect(() => {
    if (!countdownActive) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [countdownActive, usageWindow?.resetsAt]);

  if (!usageWindow) return <span className="usage-missing">--</span>;
  const remaining = Math.round(usageWindow.remainingPercent);
  const tone = remainingTone(remaining);
  return (
    <div className={`table-usage table-usage-${resetWindow}`}>
      <div className="table-usage-head">
        <strong className={tone}>{remaining}%</strong>
        <span>{t("usage.remaining")}</span>
      </div>
      <Progress percent={remaining} showInfo={false} size="small" strokeColor={usageStroke(remaining)} />
      <span className="usage-reset">{tableResetLabel(usageWindow.resetsAt, language, resetWindow, now)}</span>
    </div>
  );
}
