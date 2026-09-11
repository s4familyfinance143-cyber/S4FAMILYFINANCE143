import {
  confirmPasswordReset,
  createUserWithEmailAndPassword,
  deleteUser,
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
export const VERIFY_RESEND_COOLDOWN_MS = 120_000;

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
      ? "Firebase অনেক ইমেইল পাঠানোর অনুরোধ আটকেছে (অ্যাকাউন্ট তৈরির সময়ও একটা লিংক যায়)। ১০–১৫ মিনিট অপেক্ষা করুন — Resend চাপবেন না। Gmail Inbox/Spam-এ আগের লিংক খুঁজুন, তারপর «যাচাই করেছি — রিফ্রেশ» চাপুন।"
      : "Firebase rate-limited email sends (Create account already sends one link). Wait 10–15 minutes — do not Resend. Find the earlier link in Gmail Inbox/Spam, then tap «I verified — Refresh».",
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
    "auth/email-already-in-use": bn
      ? "এই ইমেইল ইতিমধ্যে Firebase Authentication-এ আছে। Login করুন, অথবা Console → Authentication → Users থেকে ইউজার ডিলিট করে আবার Create করুন।"
      : "This email already exists in Firebase Authentication. Sign in, or delete the user in Console → Authentication → Users, then create again.",
    "auth/invalid-credential": bn
      ? "ইমেইল/পাসওয়ার্ড মিলছে না। Firestore ডেটা মুছলেও Auth ইউজার থাকতে পারে — পুরনো পাসওয়ার্ড দিয়ে Login করুন, অথবা Authentication → Users থেকে ইমেইলটি ডিলিট করে নতুন Create করুন।"
      : "Email/password do not match. Deleting Firestore data does not remove Auth users — sign in with the old password, or delete the email under Authentication → Users and create again.",
    "auth/wrong-password": bn
      ? "পাসওয়ার্ড ভুল। পুরনো পাসওয়ার্ড দিন, অথবা Authentication থেকে ইউজার ডিলিট করে নতুন অ্যাকাউন্ট তৈরি করুন।"
      : "Wrong password. Use the old password, or delete the Auth user and create a new account.",
    "auth/email-exists-wrong-password": bn
      ? "এই ইমেইল আগে থেকেই আছে — Create করবেন না। Back → Logout, তারপর Login এ সেই ইমেইলের সঠিক পাসওয়ার্ড দিন। (Wife অ্যাকাউন্টে Husband-এর পাসওয়ার্ড চলবে না।)"
      : "This email already has an account — do not Create. Go Back → Logout, then Login with that email's correct password. (Wife account needs Wife's password, not Husband's.)",
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

/** Remove the current Auth user (used to roll back a failed Create family). */
export async function firebaseDeleteCurrentUser(user) {
  const target = user || getFirebaseAuth()?.currentUser;
  if (!target) return false;
  await deleteUser(target);
  return true;
}

export async function firebaseRegisterEmail(email, password, fullName = "") {
  const auth = getFirebaseAuth();
  if (!auth) throw new Error("Firebase is not configured");

  // 1) Create Auth account first (Firebase always does this BEFORE email verify)
  const cred = await createUserWithEmailAndPassword(auth, String(email).trim(), password);

  // 2) Display name — short timeout only
  if (fullName.trim().length > 0) {
    try {
      await Promise.race([
        updateProfile(cred.user, { displayName: fullName.trim() }),
        new Promise((resolve) => {
          window.setTimeout(resolve, 4000);
        }),
      ]);
    } catch (err) {
      console.warn("[firebase] updateProfile after register failed", err);
    }
  }

  // 3) Send verification ONCE and wait — no auto-retry (retry triggers auth/too-many-requests).
  let verificationSent = false;
  let verificationError = null;
  try {
    await Promise.race([
      dispatchVerificationEmail(cred.user, { reason: "register" }),
      new Promise((_, reject) => {
        window.setTimeout(() => reject(new Error("Verification email send timed out")), 12000);
      }),
    ]);
    verificationSent = true;
  } catch (error) {
    verificationError = error;
    console.error("[firebase] initial sendEmailVerification failed", error);
  }

  // Account exists now with emailVerified=false until user clicks the mail link.
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

/** Complete Firebase password reset when the email link lands with oobCode. */
export async function firebaseConfirmPasswordReset(oobCode, newPassword) {
  const auth = getFirebaseAuth();
  if (!auth) throw new Error("Firebase is not configured");
  const code = String(oobCode || "").trim();
  const password = String(newPassword || "");
  if (!code) throw new Error("Missing password reset code");
  if (password.length < 8) throw new Error("Password must be at least 8 characters");
  await confirmPasswordReset(auth, code, password);
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
