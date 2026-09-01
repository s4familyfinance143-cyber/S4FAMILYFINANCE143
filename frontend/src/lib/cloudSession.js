import { isFirebaseConfigured } from "../firebase/config";

const CLOUD_ONLY_KEY = "s4_cloud_only_mode";
const CLOUD_FAMILY_KEY = "s4_cloud_family_id";

export function isFirebaseFirstMode() {
  const flag = String(import.meta.env.VITE_FIREBASE_FIRST || "").trim().toLowerCase();
  return (flag === "1" || flag === "true" || flag === "yes") && isFirebaseConfigured();
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
