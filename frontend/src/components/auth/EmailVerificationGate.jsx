import "./email-verification-gate.css";

/**
 * Invoice-tracker style gate: block cloud session until email is verified.
 */
export function EmailVerificationGate({
  t,
  email = "",
  busy = false,
  onResend,
  onRefresh,
  onSignOut,
}) {
  return (
    <main className="email-verify-root" role="dialog" aria-modal="true" aria-labelledby="email-verify-title">
      <div className="email-verify-card">
        <p className="email-verify-eyebrow">{t("hybridModeLabel") || "Hybrid cloud"}</p>
        <h1 id="email-verify-title">{t("verifyEmailTitle")}</h1>
        <p className="email-verify-body">{t("verifyEmailBody")}</p>
        {email ? (
          <p className="email-verify-mail">
            <strong>{email}</strong>
          </p>
        ) : null}
        <p className="email-verify-hint">{t("verifyEmailHint")}</p>
        <div className="email-verify-actions">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={onResend}>
            {busy ? t("sending") : t("verifyEmailResend")}
          </button>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={onRefresh}>
            {t("verifyEmailRefresh")}
          </button>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={onSignOut}>
            {t("verifyEmailSignOut")}
          </button>
        </div>
      </div>
    </main>
  );
}
