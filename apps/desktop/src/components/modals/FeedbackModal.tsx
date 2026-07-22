import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { ImagePlus, LoaderCircle, MessageSquareText, Send, Trash2, X } from "lucide-react";
import type { Translate } from "../../i18n";
import {
  FEEDBACK_IMAGE_TYPES,
  MAX_FEEDBACK_IMAGES,
  prepareFeedbackImage,
} from "../../utils/feedbackImages";

interface PreparedImage {
  id: string;
  file: File;
  previewUrl: string;
  compressed: boolean;
}

interface FeedbackModalProps {
  signedInEmail?: string | null;
  onClose: () => void;
  onSubmit: (content: string, contactEmail: string | null, images: File[]) => Promise<void>;
  t: Translate;
}

function fileId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

export function FeedbackModal({ signedInEmail, onClose, onSubmit, t }: FeedbackModalProps) {
  const [content, setContent] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [images, setImages] = useState<PreparedImage[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const imagesRef = useRef(images);
  imagesRef.current = images;

  useEffect(() => () => {
    imagesRef.current.forEach((image) => URL.revokeObjectURL(image.previewUrl));
  }, []);

  const selectImages = async (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!selected.length) return;
    if (images.length + selected.length > MAX_FEEDBACK_IMAGES) {
      setError(t("feedback.errorTooMany", { count: MAX_FEEDBACK_IMAGES }));
      return;
    }

    setPreparing(true);
    setError(null);
    const prepared: PreparedImage[] = [];
    try {
      for (const selectedFile of selected) {
        const result = await prepareFeedbackImage(selectedFile);
        prepared.push({
          id: fileId(),
          file: result.file,
          compressed: result.compressed,
          previewUrl: URL.createObjectURL(result.file),
        });
      }
      setImages((current) => [...current, ...prepared]);
    } catch (caught) {
      prepared.forEach((image) => URL.revokeObjectURL(image.previewUrl));
      setError((caught as Error).message === "unsupported"
        ? t("feedback.errorUnsupported")
        : t("feedback.errorCompress"));
    } finally {
      setPreparing(false);
    }
  };

  const removeImage = (id: string) => {
    setImages((current) => current.filter((image) => {
      if (image.id === id) URL.revokeObjectURL(image.previewUrl);
      return image.id !== id;
    }));
  };

  const submit = async () => {
    if (!content.trim() || submitting || preparing) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(
        content.trim(),
        signedInEmail ? null : contactEmail.trim() || null,
        images.map((image) => image.file),
      );
      onClose();
    } catch (caught) {
      setError(String(caught instanceof Error ? caught.message : caught));
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop feedback-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !submitting && !preparing) onClose();
    }}>
      <form className="modal feedback-modal" role="dialog" aria-modal="true"
        aria-labelledby="feedback-modal-title" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <button type="button" className="modal-close" aria-label={t("feedback.close")}
          disabled={submitting || preparing} onClick={onClose}><X size={18} /></button>
        <div className="modal-icon"><MessageSquareText size={23} /></div>
        <h2 id="feedback-modal-title">{t("feedback.title")}</h2>
        <p>{t("feedback.description")}</p>

        <label className="feedback-label" htmlFor="feedback-content">{t("feedback.content")}</label>
        <textarea id="feedback-content" className="feedback-textarea" autoFocus rows={7}
          maxLength={5000} value={content} placeholder={t("feedback.placeholder")}
          disabled={submitting} onChange={(event) => setContent(event.target.value)} />
        <div className="feedback-meta-row">
          <span>{content.length}/5000</span>
          {signedInEmail && <span>{t("feedback.signedInEmail", { email: signedInEmail })}</span>}
        </div>

        {!signedInEmail && (
          <div className="feedback-contact-field">
            <label className="feedback-label" htmlFor="feedback-email">{t("feedback.contactEmail")}</label>
            <input id="feedback-email" type="email" autoComplete="email" inputMode="email" maxLength={160}
              value={contactEmail} placeholder={t("feedback.contactEmailPlaceholder")} disabled={submitting}
              onChange={(event) => setContactEmail(event.target.value)} />
            <small>{t("feedback.contactEmailHint")}</small>
          </div>
        )}

        <div className="feedback-upload-heading">
          <span><b>{t("feedback.images")}</b><small>{t("feedback.imageHint")}</small></span>
          <label className={`feedback-add-images ${preparing || images.length >= MAX_FEEDBACK_IMAGES ? "disabled" : ""}`}>
            {preparing ? <LoaderCircle className="spin" size={15} /> : <ImagePlus size={15} />}
            {preparing ? t("feedback.compressing") : t("feedback.addImages")}
            <input type="file" accept={FEEDBACK_IMAGE_TYPES.join(",")} multiple
              disabled={preparing || submitting || images.length >= MAX_FEEDBACK_IMAGES}
              onChange={(event) => void selectImages(event)} />
          </label>
        </div>

        {images.length > 0 && (
          <div className="feedback-image-grid">
            {images.map((image) => (
              <div className="feedback-image-item" key={image.id}>
                <img src={image.previewUrl} alt={image.file.name} />
                {image.compressed && <span>{t("feedback.compressed")}</span>}
                <button type="button" aria-label={t("feedback.removeImage")}
                  disabled={submitting} onClick={() => removeImage(image.id)}><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        )}
        {error && <div className="feedback-error" role="alert">{error}</div>}

        <div className="feedback-actions">
          <button type="button" className="note-cancel-button" disabled={submitting || preparing}
            onClick={onClose}>{t("feedback.cancel")}</button>
          <button type="submit" className="primary-button" disabled={!content.trim() || submitting || preparing}>
            {submitting ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}
            {submitting ? t("feedback.submitting") : t("feedback.submit")}
          </button>
        </div>
      </form>
    </div>
  );
}
