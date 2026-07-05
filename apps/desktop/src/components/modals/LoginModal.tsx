import { ChevronRight, ExternalLink, FileInput, KeyRound, LayoutGrid, ShieldCheck, X } from "lucide-react";
import type { Translate } from "../../i18n";

export function LoginModal({ onClose, onStart, onImport, t }: {
  onClose: () => void;
  onStart: (embedded: boolean) => void;
  onImport: () => void;
  t: Translate;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="modal" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="modal-close" aria-label={t("login.close")} onClick={onClose}><X size={19} /></button>
        <div className="modal-icon"><KeyRound size={25} /></div>
        <h2>{t("login.title")}</h2>
        <p>{t("login.description")}</p>
        <button type="button" className="login-choice featured" onClick={() => onStart(true)}>
          <span className="choice-icon"><LayoutGrid size={20} /></span>
          <span><b>{t("login.embedded.title")}</b><small>{t("login.embedded.description")}</small></span><ChevronRight size={19} />
        </button>
        <button type="button" className="login-choice" onClick={() => onStart(false)}>
          <span className="choice-icon"><ExternalLink size={20} /></span>
          <span><b>{t("login.browser.title")}</b><small>{t("login.browser.description")}</small></span><ChevronRight size={19} />
        </button>
        <div className="modal-divider"><span>{t("login.or")}</span></div>
        <button type="button" className="import-choice" onClick={onImport}><FileInput size={17} />{t("login.import")}</button>
        <div className="safety-note"><ShieldCheck size={16} />{t("login.safety")}</div>
      </section>
    </div>
  );
}
