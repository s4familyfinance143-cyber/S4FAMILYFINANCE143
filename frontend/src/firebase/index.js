/**
 * Firebase client removed — VPS/API only.
 * Stubs keep legacy call sites compiling; all configured checks are false.
 */

export function isFirebaseConfigured() {
  return false;
}

export function subscribeFirebaseAuth(callback) {
  try {
    callback?.(null);
  } catch {
    /* ignore */
  }
  return () => {};
}

async function removed(action = "Firebase") {
  throw new Error(`${action} has been removed. Use the VPS server account.`);
}

export async function firebaseSignInEmail() {
  return removed("Firebase sign-in");
}
export async function firebaseRegisterEmail() {
  return removed("Firebase register");
}
export async function firebaseSignInGoogle() {
  return removed("Firebase Google sign-in");
}
export async function firebaseSignOut() {
  return undefined;
}
export function isFirebaseEmailVerified() {
  return false;
}
export async function firebaseReloadUser() {
  return null;
}
export async function firebaseResendEmailVerification() {
  return removed("Firebase email verification");
}
export async function firebaseSendPasswordReset() {
  return removed("Firebase password reset");
}
export async function firebaseConfirmPasswordReset() {
  return removed("Firebase password reset");
}
export function formatFirebaseAuthError(err) {
  return err?.message || "Firebase has been removed";
}
export async function pushCloudSnapshot() {
  return removed("Firebase sync");
}
export async function pullCloudSnapshot() {
  return removed("Firebase sync");
}
export async function getCloudSnapshotMeta() {
  return null;
}
export async function ensureUserProfile() {
  return null;
}
export async function getUserProfileDoc() {
  return null;
}
export async function bindCloudFamilyIdentity() {
  return null;
}
export async function resolveAndBindUserFamily() {
  return "";
}
export async function createCloudFamilyAccount() {
  return removed("Firebase family create");
}
export async function enableWebPushNotifications() {
  return { ok: false, reason: "removed" };
}
export function getNotificationPermission() {
  return typeof Notification !== "undefined" ? Notification.permission : "denied";
}
export function isWebFcmVapidConfigured() {
  return false;
}
export function subscribeForegroundMessages() {
  return () => {};
}
