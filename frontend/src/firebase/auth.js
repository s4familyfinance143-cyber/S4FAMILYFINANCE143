import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
} from "firebase/auth";

import { getFirebaseAuth, isFirebaseConfigured } from "./config";
import { requestCustomVerificationEmail } from "./customVerificationEmail";

const VERIFY_COOLDOWN_PREFIX = "s4_verify_email_sent_at:";
export const VERIFY_RESEND_COOLDOWN_MS = 60_000;

export function markVerificationEmailSent(uid) {
  if (!uid) return;
  try {
    sessionStorage.setItem(`${VERIFY_COOLDOWN_PREFIX}${uid}`, String(Date.now()));
  } catch {
    /* ignore */
  }
}

export function getVerificationResendRemainingMs(uid) {
  if (!uid) return 0;
  try {
    const raw = sessionStorage.getItem(`${VERIFY_COOLDOWN_PREFIX}${uid}`);
    const sentAt = Number(raw || 0);
    if (!sentAt) return 0;
    const remaining = VERIFY_RESEND_COOLDOWN_MS - (Date.now() - sentAt);
    return remaining > 0 ? remaining : 0;
  } catch {
    return 0;
  }
}

export function subscribeFirebaseAuth(callback) {
  const auth = getFirebaseAuth();
  if (!auth) {
    callback(null);
    return () => {};
  }
  return onAuthStateChanged(auth, callback);
}

export function isFirebaseEmailVerified(user) {
  if (!user) return false;
  // Must match Firestore rules: request.auth.token.email_verified == true
  return Boolean(user.emailVerified);
}

/** Map Firebase Auth error codes to actionable user messages. */
export function formatFirebaseAuthError(error, lang = "en") {
  const code = String(error?.code || "").trim();
  const raw = String(error?.message || error || "").trim();
  const bn = lang === "bn";

  const byCode = {
    "auth/too-many-requests": bn
      ? "অনেকবার চেষ্টা হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন।"
      : "Too many attempts. Wait a few minutes, then try again.",
    "auth/network-request-failed": bn
      ? "নেটওয়ার্ক সমস্যা — ইন্টারনেট চেক করে আবার চেষ্টা করুন।"
      : "Network error — check your connection and try again.",
    "auth/user-token-expired": bn
      ? "সেশন মেয়াদোত্তীর্ণ। আবার সাইন ইন করুন।"
      : "Session expired. Sign out and sign in again.",
    "auth/requires-recent-login": bn
      ? "নিরাপত্তার জন্য আবার সাইন ইন করে verification পাঠান।"
      : "For security, sign out and sign in again, then resend verification.",
    "auth/unauthorized-continue-uri": bn
      ? "এই ডোমেইন Firebase-এ অনুমোদিত নয়। Console → Authentication → Settings → Authorized domains-এ localhost যোগ করুন।"
      : "This domain is not authorized. In Firebase Console → Authentication → Settings → Authorized domains, add localhost (and your app domain).",
    "auth/invalid-continue-uri": bn
      ? "Action URL অবৈধ। Firebase Auth Templates / Authorized domains চেক করুন।"
      : "Invalid action URL. Check Firebase Auth Templates and Authorized domains.",
    "auth/missing-continue-uri": bn
      ? "Action URL নেই। Firebase Console Auth settings চেক করুন।"
      : "Continue URL missing. Check Firebase Console Auth settings.",
    "auth/invalid-user-token": bn
      ? "সেশন অবৈধ। আবার সাইন ইন করুন।"
      : "Invalid session. Sign out and sign in again.",
    "auth/user-disabled": bn
      ? "এই অ্যাকাউন্ট নিষ্ক্রিয় করা হয়েছে।"
      : "This account has been disabled.",
    "auth/user-not-found": bn
      ? "ব্যবহারকারী পাওয়া যায়নি। আবার সাইন ইন করুন।"
      : "User not found. Sign out and sign in again.",
  };

  if (code && byCode[code]) {
    return `${byCode[code]}${code ? ` (${code})` : ""}`;
  }
  if (code) return `${raw || "Firebase auth error"} (${code})`;
  return raw || (bn ? "ইমেইল পাঠানো যায়নি" : "Could not send email");
}

function buildEmailActionCodeSettings() {
  if (typeof window === "undefined" || !window.location?.origin) return undefined;
  // Continue URL must be on an Authorized Domain in Firebase Console.
  return {
    url: `${window.location.origin}/`,
    handleCodeInApp: false,
  };
}

/**
 * Send Firebase Auth verification email as soon as possible.
 * Optionally also POSTs to a custom transactional mail API (Admin + SMTP/Resend)
 * when VITE_CUSTOM_VERIFY_EMAIL_URL is set — that path is typically much faster
 * than Firebase’s built-in mailer queue.
 */
async function dispatchVerificationEmail(user, { reason = "send" } = {}) {
  const actionCodeSettings = buildEmailActionCodeSettings();
  const started = performance.now?.() || Date.now();

  // Kick optional custom provider in parallel (does not block Firebase send).
  const customPromise = requestCustomVerificationEmail(user).catch((err) => {
    console.warn("[firebase] custom verification email skipped", err?.message || err);
    return null;
  });

  try {
    if (actionCodeSettings) {
      await sendEmailVerification(user, actionCodeSettings);
    } else {
      await sendEmailVerification(user);
    }
    const ms = Math.round((performance.now?.() || Date.now()) - started);
    console.info("[firebase] verification email requested", {
      reason,
      email: user.email,
      continueUrl: actionCodeSettings?.url || "(default template)",
      elapsedMs: ms,
    });
    markVerificationEmailSent(user.uid);
    const custom = await customPromise;
    return {
      sent: true,
      email: user.email || "",
      continueUrl: actionCodeSettings?.url || null,
      customProvider: custom,
    };
  } catch (error) {
    if (
      actionCodeSettings &&
      (error?.code === "auth/unauthorized-continue-uri" ||
        error?.code === "auth/invalid-continue-uri" ||
        error?.code === "auth/missing-continue-uri")
    ) {
      await sendEmailVerification(user);
      console.warn(
        "[firebase] verification sent with default template after continue-uri error",
        error?.code,
      );
      markVerificationEmailSent(user.uid);
      const custom = await customPromise;
      return {
        sent: true,
        email: user.email || "",
        continueUrl: null,
        usedDefaultTemplate: true,
        domainHint: true,
        customProvider: custom,
      };
    }
    throw error;
  }
}

export async function firebaseReloadUser() {
  const auth = getFirebaseAuth();
  if (!auth?.currentUser) return null;
  await auth.currentUser.reload();
  try {
    // Refresh ID token so Firestore rules see updated email_verified claim.
    await auth.currentUser.getIdToken(true);
  } catch {
    /* ignore token refresh errors */
  }
  return auth.currentUser;
}

/**
 * Resend Firebase email verification for the signed-in user.
 * Always prefers auth.currentUser (fresh) over a stale user prop.
 */
export async function firebaseResendEmailVerification(user = null) {
  const auth = getFirebaseAuth();
  if (!auth) {
    const err = new Error("Firebase is not configured");
    err.code = "auth/firebase-not-configured";
    throw err;
  }

  // Prefer live currentUser — stale props can fail silently or use expired tokens.
  let target = auth.currentUser || user;
  if (!target) {
    const err = new Error("No signed-in user — sign in again, then resend");
    err.code = "auth/user-not-found";
    throw err;
  }

  try {
    await target.reload();
    target = auth.currentUser || target;
  } catch (reloadErr) {
    console.warn("[firebase] reload before verification send failed", reloadErr);
  }

  if (isFirebaseEmailVerified(target)) {
    return { alreadyVerified: true, email: target.email || "" };
  }

  const remaining = getVerificationResendRemainingMs(target.uid);
  if (remaining > 0) {
    const err = new Error(
      `Please wait ${Math.ceil(remaining / 1000)}s before requesting another verification email.`,
    );
    err.code = "auth/resend-cooldown";
    err.remainingMs = remaining;
    throw err;
  }

  try {
    return await dispatchVerificationEmail(target, { reason: "resend" });
  } catch (error) {
    console.error("[firebase] sendEmailVerification failed", error);
    throw error;
  }
}

export async function firebaseSignInEmail(email, password) {
  const auth = getFirebaseAuth();
  if (!auth) throw new Error("Firebase is not configured");
  const cred = await signInWithEmailAndPassword(auth, String(email).trim(), password);
  return cred.user;
}

export async function firebaseRegisterEmail(email, password, fullName = "") {
  const auth = getFirebaseAuth();
  if (!auth) throw new Error("Firebase is not configured");

  // 1) Create account
  const cred = await createUserWithEmailAndPassword(auth, String(email).trim(), password);

  // 2) Trigger verification IMMEDIATELY — do not wait on profile update.
  //    Firebase’s built-in mailer can still be slow; we still fire at t=0 after create.
  let verificationSent = false;
  let verificationError = null;
  const verifyPromise = dispatchVerificationEmail(cred.user, { reason: "register" })
    .then((result) => {
      verificationSent = true;
      return result;
    })
    .catch((error) => {
      verificationError = error;
      console.error("[firebase] initial sendEmailVerification failed", error);
      return null;
    });

  // 3) Display name in parallel (does not block the verification request start)
  const profilePromise =
    fullName.trim().length > 0
      ? updateProfile(cred.user, { displayName: fullName.trim() }).catch((err) => {
          console.warn("[firebase] updateProfile after register failed", err);
        })
      : Promise.resolve();

  await Promise.all([verifyPromise, profilePromise]);

  // One more attempt if the first send failed (e.g. transient network)
  if (!verificationSent) {
    try {
      await dispatchVerificationEmail(cred.user, { reason: "register-retry" });
      verificationSent = true;
      verificationError = null;
    } catch (retryErr) {
      verificationError = retryErr;
      console.error("[firebase] initial sendEmailVerification retry failed", retryErr);
    }
  }

  return { user: cred.user, verificationSent, verificationError };
}

export async function firebaseSendPasswordReset(email) {
  const auth = getFirebaseAuth();
  if (!auth) throw new Error("Firebase is not configured");
  const actionCodeSettings = buildEmailActionCodeSettings();
  if (actionCodeSettings) {
    await sendPasswordResetEmail(auth, String(email).trim(), actionCodeSettings);
  } else {
    await sendPasswordResetEmail(auth, String(email).trim());
  }
}

export async function firebaseSignInGoogle() {
  const auth = getFirebaseAuth();
  if (!auth) throw new Error("Firebase is not configured");
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const cred = await signInWithPopup(auth, provider);
  return cred.user;
}

export async function firebaseSignOut() {
  const auth = getFirebaseAuth();
  if (!auth) return;
  await signOut(auth);
}

export function firebaseUserLabel(user) {
  if (!user) return "";
  return user.displayName || user.email || user.uid;
}

export { isFirebaseConfigured };
