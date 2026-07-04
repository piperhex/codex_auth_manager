import { FormEvent, useState } from "react";
import { ArrowRight, Cloud, LockKeyhole, Mail, X } from "lucide-react";
import type { Translate } from "../../i18n";

export function CloudLoginModal({
  loading,
  onClose,
  onLogin,
  t,
}: {
  loading: boolean;
  onClose: () => void;
  onLogin: (email: string, password: string) => Promise<boolean>;
  t: Translate;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void onLogin(email.trim(), password).then((ok) => {
      if (ok) onClose();
    });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="modal cloud-login-modal" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="modal-close" aria-label={t("cloudLogin.close")} onClick={onClose}
          disabled={loading}><X size={19} /></button>
        <div className="modal-icon"><Cloud size={25} /></div>
        <h2>{t("cloudLogin.title")}</h2>
        <p>{t("cloudLogin.description")}</p>
        <form className="cloud-login-form" onSubmit={submit}>
          <label htmlFor="cloud-login-email">{t("cloudLogin.email")}</label>
          <span className="cloud-login-input"><Mail size={16} />
            <input id="cloud-login-email" type="email" autoComplete="email" value={email}
              disabled={loading} onChange={(event) => setEmail(event.target.value)}
              placeholder={t("cloudLogin.emailPlaceholder")} /></span>
          <label htmlFor="cloud-login-password">{t("cloudLogin.password")}</label>
          <span className="cloud-login-input"><LockKeyhole size={16} />
            <input id="cloud-login-password" type="password" autoComplete="current-password" value={password}
              disabled={loading} onChange={(event) => setPassword(event.target.value)}
              placeholder={t("cloudLogin.passwordPlaceholder")} /></span>
          <button type="submit" className="primary-button cloud-login-submit"
            disabled={loading || !email.trim() || !password}>
            {loading ? t("cloudLogin.loggingIn") : t("cloudLogin.submit")}<ArrowRight size={17} />
          </button>
        </form>
      </section>
    </div>
  );
}
