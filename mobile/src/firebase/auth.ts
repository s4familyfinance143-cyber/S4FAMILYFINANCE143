import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithCredential,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type User,
} from "firebase/auth";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as WebBrowser from "expo-web-browser";

import { getFirebaseAuth, isFirebaseConfigured } from "./config";

WebBrowser.maybeCompleteAuthSession();

const VERIFY_COOLDOWN_PREFIX = "s4_verify_email_sent_at:";
export const VERIFY_RESEND_COOLDOWN_MS = 60_000;

export function subscribeFirebaseAuth(callback: (user: User | null) => void) {
  const auth = getFirebaseAuth();
  if (!auth) {
    callback(null);
    return () => {};
  }
  return onAuthStateChanged(auth, callback);
}

export function isFirebaseEmailVerified(user: User | null | undefined) {
  return Boolean(user?.emailVerified);
}

export async function markVerificationEmailSent(uid: string) {
  if (!uid) return;
  try {
    await AsyncStorage.setItem(`${VERIFY_COOLDOWN_PREFIX}${uid}`, String(Date.now()));
  } catch {
    /* ignore */
  }
}

export async function getVerificationResendRemainingMs(uid: string) {
  if (!uid) return 0;
  try {
    const raw = await AsyncStorage.getItem(`${VERIFY_COOLDOWN_PREFIX}${uid}`);
    const sentAt = Number(raw || 0);
    if (!sentAt) return 0;
    const remaining = VERIFY_RESEND_COOLDOWN_MS - (Date.now() - sentAt);
    return remaining > 0 ? remaining : 0;
  } catch {
    return 0;
  }
}

export function formatFirebaseAuthError(error: any, lang = "en") {
  const code = String(error?.code || "").trim();
  const bn = lang === "bn";
  const byCode: Record<string, string> = {
    "auth/too-many-requests": bn
      ? "অনেকবার চেষ্টা হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন।"
      : "Too many attempts. Wait a few minutes, then try again.",
    "auth/network-request-failed": bn
      ? "নেটওয়ার্ক সমস্যা — ইন্টারনেট চেক করে আবার চেষ্টা করুন।"
      : "Network error — check your connection and try again.",
    "auth/invalid-credential": bn ? "ইমেইল বা পাসওয়ার্ড ভুল।" : "Wrong email or password.",
    "auth/wrong-password": bn ? "পাসওয়ার্ড ভুল।" : "Wrong password.",
    "auth/user-not-found": bn ? "এই ইমেইলে অ্যাকাউন্ট নেই।" : "No account for this email.",
    "auth/email-already-in-use": bn ? "এই ইমেইল ইতিমধ্যে ব্যবহৃত।" : "Email already in use.",
    "auth/weak-password": bn ? "পাসওয়ার্ড আরও শক্তিশালী হতে হবে।" : "Password is too weak.",
  };
  if (byCode[code]) return byCode[code];
  return String(error?.message || error || (bn ? "অথেনটিকেশন ব্যর্থ" : "Auth failed"));
}

/** Match web signature — used by cloudOnboarding.js */
export async function firebaseSignInEmail(email: string, password: string) {
  if (!isFirebaseConfigured()) throw new Error("Firebase not configured");
  const auth = getFirebaseAuth();
  if (!auth) throw new Error("Firebase Auth unavailable");
  const cred = await signInWithEmailAndPassword(auth, String(email).trim(), password);
  return cred.user;
}

/** Match web signature — returns { user, verificationSent, verificationError } */
export async function firebaseRegisterEmail(email: string, password: string, fullName = "") {
  if (!isFirebaseConfigured()) throw new Error("Firebase not configured");
  const auth = getFirebaseAuth();
  if (!auth) throw new Error("Firebase Auth unavailable");
  const cred = await createUserWithEmailAndPassword(auth, String(email).trim(), password);

  let verificationSent = false;
  let verificationError: any = null;
  try {
    await sendEmailVerification(cred.user);
    verificationSent = true;
    await markVerificationEmailSent(cred.user.uid);
  } catch (error) {
    verificationError = error;
  }

  if (String(fullName || "").trim()) {
    try {
      await updateProfile(cred.user, { displayName: String(fullName).trim() });
    } catch {
      /* ignore */
    }
  }

  return { user: cred.user, verificationSent, verificationError };
}

export async function firebaseSendPasswordReset(email: string) {
  const auth = getFirebaseAuth();
  if (!auth) throw new Error("Firebase Auth unavailable");
  await sendPasswordResetEmail(auth, String(email).trim());
}

export async function firebaseResendVerification(user: User) {
  if (!user) throw new Error("No user");
  const remaining = await getVerificationResendRemainingMs(user.uid);
  if (remaining > 0) {
    throw new Error(`Wait ${Math.ceil(remaining / 1000)}s before resending`);
  }
  await sendEmailVerification(user);
  await markVerificationEmailSent(user.uid);
}

export async function firebaseSignOut() {
  const auth = getFirebaseAuth();
  if (!auth) return;
  await signOut(auth);
}

export async function firebaseReloadUser(user: User) {
  if (!user) return null;
  await user.reload();
  return getFirebaseAuth()?.currentUser || user;
}

/**
 * Google Sign-In via Expo AuthSession → Firebase credential.
 * Needs EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID (Firebase Console → Google provider Web client ID).
 */
export async function firebaseSignInGoogle() {
  if (!isFirebaseConfigured()) throw new Error("Firebase not configured");
  const auth = getFirebaseAuth();
  if (!auth) throw new Error("Firebase Auth unavailable");

  const webClientId = String(process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || "").trim();
  if (!webClientId) {
    throw new Error(
      "EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID missing — set Web client ID from Firebase Google Sign-In"
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const AuthSession = require("expo-auth-session");

  const redirectUri = AuthSession.makeRedirectUri({
    scheme: "s4familyfinance",
  });

  const discovery = {
    authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenEndpoint: "https://oauth2.googleapis.com/token",
    revocationEndpoint: "https://oauth2.googleapis.com/revoke",
  };

  const request = new AuthSession.AuthRequest({
    clientId: webClientId,
    redirectUri,
    scopes: ["openid", "profile", "email"],
    responseType: AuthSession.ResponseType.IdToken,
    extraParams: { prompt: "select_account", nonce: String(Date.now()) },
    usePKCE: false,
  });

  await request.makeAuthUrlAsync(discovery);
  const result = await request.promptAsync(discovery);
  if (result.type !== "success") {
    throw new Error("Google sign-in cancelled");
  }
  const idToken = result.params?.id_token || result.authentication?.idToken;
  if (!idToken) throw new Error("Google did not return an ID token");

  const credential = GoogleAuthProvider.credential(idToken);
  const cred = await signInWithCredential(auth, credential);
  return cred.user;
}
