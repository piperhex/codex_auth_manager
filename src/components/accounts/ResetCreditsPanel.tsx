import { Button } from "antd";
import { CalendarClock, RefreshCw } from "lucide-react";
import type { Language, Translate } from "../../i18n";
import type { ResetCreditsLoadState } from "../../types";
import { formatBeijingTime } from "../../utils/format";

export function ResetCreditsPanel({ state, onRetry, language, t }: {
  state?: ResetCreditsLoadState;
  onRetry: () => void;
  language: Language;
  t: Translate;
}) {
  if (!state || state.status === "loading") {
    return <div className="reset-credits-status"><RefreshCw className="spin" size={16} />{t("reset.loading")}</div>;
  }
  if (state.status === "error") {
    return (
      <div className="reset-credits-status reset-credits-error">
        <span>{state.error}</span>
        <Button size="small" icon={<RefreshCw size={13} />} onClick={onRetry}>{t("reset.retry")}</Button>
      </div>
    );
  }
  if (!state.data.credits.length) {
    return <div className="reset-credits-status">{t("reset.empty")}</div>;
  }
  return (
    <div className="reset-credits-panel">
      {state.data.credits.map((credit, index) => (
        <div className="reset-credit" key={`${credit.issuedAt ?? "unknown"}-${credit.expiresAt ?? "unknown"}-${index}`}>
          <div className="reset-credit-index"><CalendarClock size={16} />{t("reset.card", { index: index + 1 })}</div>
          <dl>
            <div><dt>{t("reset.issuedAt")}</dt><dd>{formatBeijingTime(credit.issuedAt, language)} <span>{t("reset.timezone")}</span></dd></div>
            <div><dt>{t("reset.expiresAt")}</dt><dd>{formatBeijingTime(credit.expiresAt, language)} <span>{t("reset.timezone")}</span></dd></div>
          </dl>
        </div>
      ))}
    </div>
  );
}
