import { isFirebaseConfigured } from "../firebase/config";
import { isNativeApp } from "./runtimeEnv";

const CLOUD_ONLY_KEY = "s4_cloud_only_mode";
const CLOUD_FAMILY_KEY = "s4_cloud_family_id";
/** Alias — active family id is persisted for both cloud and API sessions. */
export const ACTIVE_FAMILY_STORAGE_KEY = CLOUD_FAMILY_KEY;

export function isFirebaseFirstMode() {
  if (!isFirebaseConfigured()) return false;
  if (isNativeApp()) return true;
  const flag = String(import.meta.env.VITE_FIREBASE_FIRST ?? "true").trim().toLowerCase();
  return flag !== "0" && flag !== "false" && flag !== "no";
}

/**
 * Invoice-tracker style: block app until Firebase email is verified.
 * Default ON in Firebase-first mode. Override with VITE_REQUIRE_EMAIL_VERIFICATION=0.
 */
export function requireEmailVerification() {
  if (!isFirebaseConfigured()) return false;
  const raw = import.meta.env.VITE_REQUIRE_EMAIL_VERIFICATION;
  if (raw !== undefined && String(raw).trim() !== "") {
    const flag = String(raw).trim().toLowerCase();
    return flag !== "0" && flag !== "false" && flag !== "no";
  }
  return isFirebaseFirstMode();
}

export function loadCloudOnlyMode() {
  try {
    return localStorage.getItem(CLOUD_ONLY_KEY) === "1";
  } catch {
    return false;
  }
}

export function persistCloudOnlyMode(enabled) {
  try {
    if (enabled) localStorage.setItem(CLOUD_ONLY_KEY, "1");
    else localStorage.removeItem(CLOUD_ONLY_KEY);
  } catch {
    /* ignore */
  }
}

export function loadCloudFamilyId() {
  try {
    return localStorage.getItem(CLOUD_FAMILY_KEY) || "";
  } catch {
    return "";
  }
}

export function persistCloudFamilyId(familyId) {
  try {
    if (familyId) localStorage.setItem(CLOUD_FAMILY_KEY, String(familyId));
    else localStorage.removeItem(CLOUD_FAMILY_KEY);
  } catch {
    /* ignore */
  }
}

export function clearCloudSession() {
  persistCloudOnlyMode(false);
  persistCloudFamilyId("");
}
