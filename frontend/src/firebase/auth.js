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

export async function firebaseResendEmailVerification(user = null) {
  const auth = getFirebaseAuth();
  const target = user || auth?.currentUser;
  if (!target) throw new Error("No signed-in user");
  if (isFirebaseEmailVerified(target)) return { alreadyVerified: true };
  await sendEmailVerification(target);
  return { sent: true };
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
  const cred = await createUserWithEmailAndPassword(auth, String(email).trim(), password);
  if (fullName.trim()) {
    await updateProfile(cred.user, { displayName: fullName.trim() });
  }
  let verificationSent = false;
  try {
    await sendEmailVerification(cred.user);
    verificationSent = true;
  } catch {
    /* rate limit or provider policy — account still created */
  }
  return { user: cred.user, verificationSent };
}

export async function firebaseSendPasswordReset(email) {
  const auth = getFirebaseAuth();
  if (!auth) throw new Error("Firebase is not configured");
  await sendPasswordResetEmail(auth, String(email).trim());
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
