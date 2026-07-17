import { FormEvent, useEffect, useState } from "react";
import { ArrowRight, Cloud, KeyRound, LockKeyhole, Mail, UserPlus, X } from "lucide-react";
import type { Translate } from "../../i18n";

export function CloudLoginModal({
  loading,
  sendingRegistrationCode,
  onClose,
  onLogin,
  onForgotPassword,
  onRegister,
  onSendRegistrationCode,
  t,
}: {
  loading: boolean;
  sendingRegistrationCode: boolean;
  onClose: () => void;
  onLogin: (email: string, password: string) => Promise<boolean>;
  onForgotPassword: () => void;
  onRegister: (email: string, password: string, verificationCode: string) => Promise<boolean>;
  onSendRegistrationCode: (email: string) => Promise<boolean>;
  t: Translate;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [codeCooldown, setCodeCooldown] = useState(0);
  const [registerMode, setRegisterMode] = useState(false);
  const [pendingAction, setPendingAction] = useState<"login" | "register" | null>(null);

  useEffect(() => {
    if (codeCooldown <= 0) return;
    const timer = window.setTimeout(() => setCodeCooldown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [codeCooldown]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setRegisterMode(false);
    void authenticate("login");
  };

  const authenticate = async (action: "login" | "register") => {
    setPendingAction(action);
    const ok = action === "login"
      ? await onLogin(email.trim(), password)
      : await onRegister(email.trim(), password, verificationCode);
    setPendingAction(null);
    if (ok) onClose();
  };

  const sendCode = async () => {
    const ok = await onSendRegistrationCode(email.trim());
    if (ok) setCodeCooldown(60);
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
          <div className="cloud-login-label-row">
            <label htmlFor="cloud-login-password">{t("cloudLogin.password")}</label>
            <button type="button" onClick={onForgotPassword}>{t("cloudLogin.forgotPassword")}</button>
          </div>
          <span className="cloud-login-input"><LockKeyhole size={16} />
            <input id="cloud-login-password" type="password" autoComplete="current-password" value={password}
              disabled={loading} onChange={(event) => setPassword(event.target.value)}
              placeholder={t("cloudLogin.passwordPlaceholder")} /></span>
          {registerMode && <>
            <label htmlFor="cloud-registration-code">{t("cloudLogin.verificationCode")}</label>
            <div className="cloud-verification-row">
              <span className="cloud-login-input"><KeyRound size={16} />
                <input id="cloud-registration-code" type="text" inputMode="numeric" autoComplete="one-time-code"
                  maxLength={6} value={verificationCode} disabled={loading}
                  onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder={t("cloudLogin.verificationCodePlaceholder")} /></span>
              <button type="button" className="cloud-code-button" onClick={() => void sendCode()}
                disabled={loading || sendingRegistrationCode || codeCooldown > 0 || !email.trim()}>
                {codeCooldown > 0
                  ? t("cloudLogin.resendCountdown", { seconds: codeCooldown })
                  : sendingRegistrationCode ? t("cloudLogin.sendingCode") : t("cloudLogin.sendCode")}
              </button>
            </div>
          </>}
          <div className="cloud-login-actions">
            <button type="button" className="cloud-register-button cloud-login-action"
              disabled={loading || (registerMode && (!email.trim() || !password || !/^\d{6}$/.test(verificationCode)))}
              onClick={() => registerMode ? void authenticate("register") : setRegisterMode(true)}>
              <UserPlus size={17} />
              {pendingAction === "register" ? t("cloudLogin.registering") : t("cloudLogin.register")}
            </button>
            <button type="submit" className="primary-button cloud-login-action"
              disabled={loading || !email.trim() || !password}>
              {pendingAction === "login" ? t("cloudLogin.loggingIn") : t("cloudLogin.submit")}<ArrowRight size={17} />
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
