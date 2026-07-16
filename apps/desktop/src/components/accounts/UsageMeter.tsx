import { Progress } from "antd";
import { useEffect, useState } from "react";
import type { Language, Translate } from "../../i18n";
import type { UsageWindow } from "../../types";
import { remainingTone, resetCountdownTime, resetCountdownWithDays, resetLabel, type UsageResetWindow } from "../../utils/format";

function usageStroke(value: number) {
  const tone = remainingTone(value);
  if (tone === "danger") return "#d2685b";
  if (tone === "warning") return "#d0a340";
  return "var(--green)";
}

function tableResetLabel(timestamp: number | null | undefined, language: Language, resetWindow: UsageResetWindow, now: number) {
  const label = resetLabel(timestamp, language, resetWindow);
  if (!timestamp) return label;
  if (resetWindow === "oneWeek") {
    const countdown = resetCountdownWithDays(timestamp, language, now);
    if (!countdown) return label;
    return language === "zh" ? `${label}（倒计时：${countdown}）` : `${label} (Countdown: ${countdown})`;
  }
  const countdown = resetCountdownTime(timestamp, now);
  if (!countdown) return label;
  return language === "zh" ? `${label}(倒计时：${countdown})` : `${label} (Countdown: ${countdown})`;
}

export function UsageMeter({ window: usageWindow, resetWindow, resetCreditsCount, variant = "line", language, t }: {
  window?: UsageWindow | null;
  resetWindow: UsageResetWindow;
  resetCreditsCount?: number | null;
  variant?: "line" | "circle";
  language: Language;
  t: Translate;
}) {
  const [now, setNow] = useState(() => Date.now());
  const countdownActive = Boolean(usageWindow?.resetsAt);

  useEffect(() => {
    if (!countdownActive) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [countdownActive, usageWindow?.resetsAt]);

  if (!usageWindow) return <span className="usage-missing">--</span>;
  const remaining = Math.round(usageWindow.remainingPercent);
  const tone = remainingTone(remaining);
  if (variant === "circle") return (
    <div className={`table-usage card-usage-meter table-usage-${resetWindow}`}>
      <Progress type="circle" percent={remaining} size={54} strokeWidth={10} strokeColor={usageStroke(remaining)}
        format={() => <span className="card-usage-percent"><strong className={tone}>{remaining}%</strong><small>{t("usage.remaining")}</small></span>} />
      <span className="card-usage-reset">{resetLabel(usageWindow.resetsAt, language, resetWindow)}</span>
    </div>
  );
  return (
    <div className={`table-usage table-usage-${resetWindow}`}>
      <div className="table-usage-head">
        <strong className={tone}>{remaining}%</strong>
        <span>{t("usage.remaining")}</span>
        {resetCreditsCount !== undefined && (
          <span className="usage-reset-credits">
            {t("usage.resetCreditsRemaining", { count: resetCreditsCount ?? "-" })}
          </span>
        )}
      </div>
      <Progress percent={remaining} showInfo={false} size="small" strokeColor={usageStroke(remaining)} />
      <span className="usage-reset">
        <span>{tableResetLabel(usageWindow.resetsAt, language, resetWindow, now)}</span>
      </span>
    </div>
  );
}
