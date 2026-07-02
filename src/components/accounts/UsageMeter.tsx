import { Progress } from "antd";
import type { Language, Translate } from "../../i18n";
import type { UsageWindow } from "../../types";
import { remainingTone, resetLabel, type UsageResetWindow } from "../../utils/format";

function usageStroke(value: number) {
  const tone = remainingTone(value);
  if (tone === "danger") return "#d2685b";
  if (tone === "warning") return "#d0a340";
  return "var(--green)";
}

export function UsageMeter({ window, resetWindow, now, language, t }: {
  window?: UsageWindow | null;
  resetWindow: UsageResetWindow;
  now: number;
  language: Language;
  t: Translate;
}) {
  if (!window) return <span className="usage-missing">--</span>;
  const remaining = Math.round(window.remainingPercent);
  const tone = remainingTone(remaining);
  return (
    <div className={`table-usage table-usage-${resetWindow}`}>
      <div className="table-usage-head">
        <strong className={tone}>{remaining}%</strong>
        <span>{t("usage.remaining")}</span>
      </div>
      <Progress percent={remaining} showInfo={false} size="small" strokeColor={usageStroke(remaining)} />
      <span className="usage-reset">{resetLabel(window.resetsAt, language, resetWindow, now)}</span>
    </div>
  );
}
