import { BellOff, Download, Rocket, X } from "lucide-react";
import type { Translate } from "../../i18n";
import type { UpdateInfo } from "../../types";

interface UpdateModalProps {
  update: UpdateInfo;
  onClose: () => void;
  onIgnore: () => void;
  onDownload: () => void;
  t: Translate;
}

export function UpdateModal({ update, onClose, onIgnore, onDownload, t }: UpdateModalProps) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="modal update-modal" role="dialog" aria-modal="true"
        aria-labelledby="update-modal-title" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="modal-close" aria-label={t("update.close")} onClick={onClose}>
          <X size={19} />
        </button>
        <div className="modal-icon"><Rocket size={25} /></div>
        <h2 id="update-modal-title">{t("update.title")}</h2>
        <p>{t("update.description", { version: update.latestVersion })}</p>
        <div className="update-versions">
          <span>{t("update.currentVersion")} <b>v{update.currentVersion}</b></span>
          <span>{t("update.latestVersion")} <b>v{update.latestVersion}</b></span>
        </div>
        {update.releaseNotes && (
          <div className="update-notes">
            <b>{update.releaseName}</b>
            <pre>{update.releaseNotes}</pre>
          </div>
        )}
        <div className="update-actions">
          <button type="button" className="refresh-all" onClick={onClose}>{t("update.later")}</button>
          <button type="button" className="refresh-all" onClick={onIgnore}>
            <BellOff size={17} />{t("update.ignoreVersion")}
          </button>
          <button type="button" className="primary-button" onClick={onDownload}>
            <Download size={17} />{t("update.download")}
          </button>
        </div>
      </section>
    </div>
  );
}
