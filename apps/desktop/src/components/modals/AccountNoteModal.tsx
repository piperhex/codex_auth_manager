import { useRef, useState } from "react";
import { DatePicker } from "antd";
import dayjs from "dayjs";
import { StickyNote, X } from "lucide-react";
import type { Translate } from "../../i18n";
import type { Account } from "../../types";

export function AccountNoteModal({
  account,
  onClose,
  onSave,
  t,
}: {
  account: Account;
  onClose: () => void;
  onSave: (note: string, expiresAt: string) => Promise<boolean>;
  t: Translate;
}) {
  const [note, setNote] = useState(account.note);
  const [expiresAt, setExpiresAt] = useState(account.expiresAt);
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    const saved = await onSave(note, expiresAt);
    setSaving(false);
    if (saved) onClose();
    else textareaRef.current?.focus();
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !saving) onClose();
    }}>
      <form className="modal account-note-modal" role="dialog" aria-modal="true"
        aria-labelledby="account-note-title" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <button type="button" className="modal-close" aria-label={t("note.close")}
          disabled={saving} onClick={onClose}><X size={18} /></button>
        <div className="modal-icon"><StickyNote size={22} /></div>
        <h2 id="account-note-title">{t("note.title")}</h2>
        <p>{t("note.description", { email: account.email })}</p>
        <label className="account-note-label" htmlFor="account-expiration-date">{t("note.expirationDate")}</label>
        <DatePicker id="account-expiration-date" className="account-expiration-picker"
          value={expiresAt ? dayjs(expiresAt, "YYYY-MM-DD") : null} picker="date"
          format="YYYY-MM-DD" placeholder="YYYY-MM-DD"
          allowClear onChange={(date) => setExpiresAt(date?.format("YYYY-MM-DD") ?? "")} />
        <span className="account-expiration-hint">{t("note.expirationHint")}</span>
        <label className="account-note-label" htmlFor="account-note-textarea">{t("note.label")}</label>
        <textarea ref={textareaRef} id="account-note-textarea" className="account-note-textarea"
          autoFocus rows={12} value={note} placeholder={t("note.placeholder")}
          onChange={(event) => setNote(event.target.value)}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
              event.preventDefault();
              void save();
            }
          }} />
        <div className="account-note-footer">
          <span>{t("note.shortcut")}</span>
          <div>
            <button type="button" className="note-cancel-button" disabled={saving} onClick={onClose}>{t("note.cancel")}</button>
            <button type="submit" className="primary-button" disabled={saving}>{saving ? t("note.saving") : t("note.save")}</button>
          </div>
        </div>
      </form>
    </div>
  );
}
