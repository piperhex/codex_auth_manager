import { CalendarClock, CircleHelp, Clock3, RefreshCw, RotateCcw, ShieldCheck, UserRound, X } from "lucide-react";
import type { Translate } from "../../i18n";

export type HelpVersionState =
  | { status: "checking" }
  | { status: "latest" }
  | { status: "available"; latestVersion: string }
  | { status: "error" };

interface HelpModalProps {
  onClose: () => void;
  version: string;
  versionState: HelpVersionState;
  t: Translate;
}

function versionStatusLabel(state: HelpVersionState, t: Translate) {
  if (state.status === "latest") return t("help.version.latest");
  if (state.status === "available") return t("help.version.available", { version: state.latestVersion });
  if (state.status === "error") return t("help.version.error");
  return t("help.version.checking");
}

export function HelpModal({ onClose, version, versionState, t }: HelpModalProps) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="modal help-modal" role="dialog" aria-modal="true" aria-labelledby="help-modal-title"
        onClick={(event) => event.stopPropagation()}>
        <button type="button" className="modal-close" aria-label={t("help.close")} onClick={onClose}><X size={19} /></button>
        <div className="modal-icon"><CircleHelp size={25} /></div>
        <h2 id="help-modal-title">{t("help.title")}</h2>
        <p>{t("help.description")}</p>
        <div className="help-features">
          <div><UserRound size={18} /><span><b>{t("help.multi.title")}</b><small>{t("help.multi.description")}</small></span></div>
          <div><RotateCcw size={18} /><span><b>{t("help.switch.title")}</b><small>{t("help.switch.description")}</small></span></div>
          <div><RefreshCw size={18} /><span><b>{t("help.usage.title")}</b><small>{t("help.usage.description")}</small></span></div>
          <div><Clock3 size={18} /><span><b>{t("help.auto.title")}</b><small>{t("help.auto.description")}</small></span></div>
          <div><CalendarClock size={18} /><span><b>{t("help.reset.title")}</b><small>{t("help.reset.description")}</small></span></div>
          <div><ShieldCheck size={18} /><span><b>{t("help.security.title")}</b><small>{t("help.security.description")}</small></span></div>
        </div>
        <div className="help-version">
          <span>Codex Switch</span>
          <div className="help-version-details">
            <b>v{version}</b>
            <span className={`help-version-status ${versionState.status}`} role="status" aria-live="polite">
              {versionStatusLabel(versionState, t)}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
