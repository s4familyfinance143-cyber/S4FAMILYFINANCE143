export {

  firebaseConfig,

  isFirebaseConfigured,

  isFirebaseFirstMode,

  getFirebaseApp,

  getFirebaseAuth,

  getFirestoreDb,

} from "./config";



export {

  subscribeFirebaseAuth,

  isFirebaseEmailVerified,

  formatFirebaseAuthError,

  firebaseSignInEmail,

  firebaseRegisterEmail,

  firebaseSendPasswordReset,

  firebaseResendVerification,

  firebaseSignInGoogle,

  firebaseSignOut,

  firebaseReloadUser,

  getVerificationResendRemainingMs,

  markVerificationEmailSent,

  VERIFY_RESEND_COOLDOWN_MS,

} from "./auth";



export { createCloudFamilyAccount, seedNewFamilyCache } from "./cloudOnboarding";

export { joinFamilyByInviteCode, findFamilyIdsForUid, ensureFamilyCloudShell } from "./familyCloud";

export {

  pullCloudSnapshot,

  pushCloudSnapshot,

  getUserFamilyProfile,

  ensureUserProfile,

  getCloudSnapshotMeta,

  linkUserFamilyId,

  bindCloudFamilyIdentity,

  resolveAndBindUserFamily,

} from "./cloudSync";



export {

  getFirebaseStorage,

  uploadProfilePhotoToFirebase,

  removeProfilePhotoFromFirebase,

  uploadFamilyDocument,

  uploadTransactionAttachment,

  validateProfilePhotoFile,

} from "./cloudStorage";



export { enableMobilePushNotifications, storeFcmTokenInFirestore } from "./messaging";


