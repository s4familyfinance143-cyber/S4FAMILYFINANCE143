import { useEffect, useState } from "react";
import "./email-verification-gate.css";
import {
  getVerificationResendRemainingMs,
  VERIFY_RESEND_COOLDOWN_MS,
} from "../../firebase/auth";

/**
 * Blocks cloud session until email is verified.
 * Includes a 60s resend cooldown for clear feedback after signup/send.
 */
export function EmailVerificationGate({
  t,
  email = "",
  uid = "",
  busy = false,
  statusMessage = "",
  statusType = "",
  onResend,
  onRefresh,
  onSignOut,
}) {
  const [cooldownSec, setCooldownSec] = useState(() =>
    Math.ceil(getVerificationResendRemainingMs(uid) / 1000),
  );
  const [localStatus, setLocalStatus] = useState("");
  const [localType, setLocalType] = useState("info");
  const [resending, setResending] = useState(false);

  useEffect(() => {
    // Hide Firebase Console jargon from end users — keep in developer logs.
    console.info(
      "[S4 VerifyEmail] If mail is delayed: Firebase free-tier mailer queues are slow. " +
        "Set VITE_CUSTOM_VERIFY_EMAIL_URL to an Admin+SMTP/Resend endpoint for instant delivery. " +
        "Also check Auth → Templates and Authorized domains.",
    );
  }, []);

  useEffect(() => {
    const tick = () => {
      const remaining = getVerificationResendRemainingMs(uid);
      setCooldownSec(Math.ceil(remaining / 1000));
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [uid]);

  const displayStatus = localStatus || statusMessage;
  const displayType = localStatus ? localType : statusType || "info";
  const cooldownActive = cooldownSec > 0;
  const resendDisabled = busy || resending || cooldownActive;

  async function handleResend() {
    if (resendDisabled || !onResend) return;
    setResending(true);
    setLocalStatus("");
    try {
      await onResend();
      setCooldownSec(Math.ceil(VERIFY_RESEND_COOLDOWN_MS / 1000));
      setLocalType("success");
      setLocalStatus(
        t("verifyEmailSent") ||
          "Verification email sent — check inbox and spam.",
      );
    } catch (err) {
      const remaining = err?.remainingMs || getVerificationResendRemainingMs(uid);
      if (remaining > 0 || err?.code === "auth/resend-cooldown") {
        setCooldownSec(Math.ceil((remaining || VERIFY_RESEND_COOLDOWN_MS) / 1000));
      }
      setLocalType("error");
      setLocalStatus(err?.message || t("emailNotSent") || "Could not send email");
    } finally {
      setResending(false);
    }
  }

  return (
    <main className="email-verify-root" role="dialog" aria-modal="true" aria-labelledby="email-verify-title">
      <div className="email-verify-card">
        <p className="email-verify-eyebrow">{t("hybridModeLabel") || "Secure cloud"}</p>
        <h1 id="email-verify-title">{t("verifyEmailTitle")}</h1>
        <p className="email-verify-body">{t("verifyEmailBody")}</p>
        {email ? (
          <p className="email-verify-mail">
            <strong>{email}</strong>
          </p>
        ) : null}
        <p className="email-verify-hint">{t("verifyEmailHint")}</p>
        <p className="email-verify-sent-note" role="status" aria-live="polite">
          {cooldownActive
            ? (t("verifyEmailCountdown") || "You can resend in {n}s").replace(
                "{n}",
                String(cooldownSec),
              )
            : t("verifyEmailReadyToResend") || "You can resend the link now."}
        </p>

        {displayStatus ? (
          <div
            className={`email-verify-status email-verify-status--${displayType || "info"}`}
            role="status"
            aria-live="polite"
          >
            {displayStatus}
          </div>
        ) : null}

        <div className="email-verify-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={resendDisabled}
            onClick={handleResend}
          >
            {resending || busy
              ? t("sending")
              : cooldownActive
                ? (t("verifyEmailResendIn") || "Resend link in {n}s").replace(
                    "{n}",
                    String(cooldownSec),
                  )
                : t("verifyEmailResend")}
          </button>
          <button type="button" className="btn btn-secondary" disabled={busy || resending} onClick={onRefresh}>
            {t("verifyEmailRefresh")}
          </button>
          <button type="button" className="btn btn-ghost" disabled={busy || resending} onClick={onSignOut}>
            {t("verifyEmailSignOut")}
          </button>
        </div>
      </div>
    </main>
  );
}
