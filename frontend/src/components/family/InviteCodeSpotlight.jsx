/**
 * Always-on-top invite code card so users never lose the code after Generate.
 */
export function InviteCodeSpotlight({ code, open, onClose, onCopy, copied, t, language = "en" }) {
  if (!open || !code) return null;

  const title =
    language === "bn"
      ? "আপনার আমন্ত্রণ কোড"
      : t?.("latestInviteCode") || "Your invite code";
  const hint =
    language === "bn"
      ? "এই কোড এখনই কপি করে শেয়ার করুন। Family → Invite ট্যাবেও থাকবে।"
      : t?.("inviteShareNowHint") ||
        "Copy and share this code now. It also stays on Family → Invite.";

  return (
    <div className="invite-spotlight" role="dialog" aria-modal="true" aria-label={title}>
      <div className="invite-spotlight-card">
        <button type="button" className="invite-spotlight-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
        <p className="invite-spotlight-kicker">{title}</p>
        <strong className="invite-spotlight-code">{code}</strong>
        <p className="invite-spotlight-hint">{hint}</p>
        <div className="invite-spotlight-actions">
          <button type="button" className="btn btn-primary" onClick={onCopy}>
            {copied ? (language === "bn" ? "কপি হয়েছে" : "Copied") : language === "bn" ? "কোড কপি" : "Copy code"}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            {language === "bn" ? "বন্ধ" : "Close"}
          </button>
        </div>
      </div>
    </div>
  );
}
