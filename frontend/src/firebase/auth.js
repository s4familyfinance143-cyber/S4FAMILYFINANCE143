export {
  firebaseSendPasswordReset,
  firebaseConfirmPasswordReset,
  firebaseSignInEmail,
  firebaseRegisterEmail,
  firebaseSignOut,
  isFirebaseEmailVerified,
  formatFirebaseAuthError,
} from "./index";

export const VERIFY_RESEND_COOLDOWN_MS = 60_000;

export function getVerificationResendRemainingMs() {
  return 0;
}
