import { FormEvent, useEffect, useRef, useState } from "react";
import { ArrowRight, CircleAlert, Cloud, KeyRound, LockKeyhole, Mail, UserPlus, X } from "lucide-react";
import { loadSavedCloudLogin } from "../../api/backend";
import type { Translate } from "../../i18n";

export function CloudLoginModal({
  loading,
  sendingRegistrationCode,
  onClose,
  onLogin,
  onForgotPassword,
  onRegister,
  onSendRegistrationCode,
  sessionExpired,
  t,
}: {
  loading: boolean;
  sendingRegistrationCode: boolean;
  onClose: () => void;
  onLogin: (email: string, password: string, rememberPassword: boolean) => Promise<boolean>;
  onForgotPassword: () => void;
  onRegister: (
    email: string,
    password: string,
    verificationCode: string,
    rememberPassword: boolean,
  ) => Promise<boolean>;
  onSendRegistrationCode: (email: string) => Promise<boolean>;
  sessionExpired: boolean;
  t: Translate;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [codeCooldown, setCodeCooldown] = useState(0);
  const [registerMode, setRegisterMode] = useState(false);
  const [rememberPassword, setRememberPassword] = useState(false);
  const [pendingAction, setPendingAction] = useState<"login" | "register" | null>(null);
  const credentialsEdited = useRef(false);

  useEffect(() => {
    let active = true;
    void loadSavedCloudLogin()
      .then((savedLogin) => {
        if (!active || !savedLogin || credentialsEdited.current) return;
        setEmail(savedLogin.email);
        setPassword(savedLogin.password);
        setRememberPassword(true);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

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
      ? await onLogin(email.trim(), password, rememberPassword)
      : await onRegister(email.trim(), password, verificationCode, rememberPassword);
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
        {sessionExpired && <div className="cloud-session-expired" role="alert">
          <CircleAlert size={17} />
          <span>{t("cloudLogin.sessionExpired")}</span>
        </div>}
        <form className="cloud-login-form" onSubmit={submit}>
          <label htmlFor="cloud-login-email">{t("cloudLogin.email")}</label>
          <span className="cloud-login-input"><Mail size={16} />
            <input id="cloud-login-email" type="email" autoComplete="email" value={email}
              disabled={loading} onChange={(event) => {
                credentialsEdited.current = true;
                setEmail(event.target.value);
              }}
              placeholder={t("cloudLogin.emailPlaceholder")} /></span>
          <div className="cloud-login-label-row">
            <label htmlFor="cloud-login-password">{t("cloudLogin.password")}</label>
            <button type="button" onClick={onForgotPassword}>{t("cloudLogin.forgotPassword")}</button>
          </div>
          <span className="cloud-login-input"><LockKeyhole size={16} />
            <input id="cloud-login-password" type="password" autoComplete="current-password" value={password}
              disabled={loading} onChange={(event) => {
                credentialsEdited.current = true;
                setPassword(event.target.value);
              }}
              placeholder={t("cloudLogin.passwordPlaceholder")} /></span>
          <label className="cloud-remember-password">
            <input type="checkbox" checked={rememberPassword} disabled={loading}
              onChange={(event) => {
                credentialsEdited.current = true;
                setRememberPassword(event.target.checked);
              }} />
            <span>
              <b>{t("cloudLogin.rememberPassword")}</b>
              <small>{t("cloudLogin.rememberPasswordHint")}</small>
            </span>
          </label>
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
