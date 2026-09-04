/**
 * Optional fast-path verification email via your own transactional provider.
 *
 * Set VITE_CUSTOM_VERIFY_EMAIL_URL to a HTTPS endpoint that:
 *  1. Verifies the Firebase ID token (Authorization: Bearer …)
 *  2. Calls admin.auth().generateEmailVerificationLink(email)
 *  3. Sends that link immediately via Resend / Brevo / SMTP (Nodemailer)
 *
 * Without this URL, the app uses Firebase Auth’s built-in mailer only
 * (can be delayed on free/Spark projects).
 */

export function getCustomVerifyEmailUrl() {
  const url = String(import.meta.env.VITE_CUSTOM_VERIFY_EMAIL_URL || "").trim();
  return url || "";
}

export function isCustomVerifyEmailConfigured() {
  return Boolean(getCustomVerifyEmailUrl());
}

/**
 * @param {import('firebase/auth').User} user
 * @returns {Promise<{ ok: boolean, skipped?: boolean, status?: number } | null>}
 */
export async function requestCustomVerificationEmail(user) {
  const endpoint = getCustomVerifyEmailUrl();
  if (!endpoint || !user) {
    return { ok: false, skipped: true };
  }

  try {
    const idToken = await user.getIdToken(true);
    const continueUrl =
      typeof window !== "undefined" && window.location?.origin
        ? `${window.location.origin}/`
        : undefined;

    console.info("[S4 VerifyEmail] custom provider request", {
      endpoint,
      email: user.email,
    });

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        email: user.email || "",
        uid: user.uid,
        continueUrl,
        locale: typeof navigator !== "undefined" ? navigator.language : "en",
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[S4 VerifyEmail] custom provider failed", res.status, text.slice(0, 200));
      return { ok: false, status: res.status };
    }

    console.info("[S4 VerifyEmail] custom provider accepted", res.status);
    return { ok: true, status: res.status };
  } catch (err) {
    console.error("[S4 VerifyEmail] custom provider error", err);
    return { ok: false };
  }
}
