import AsyncStorage from "@react-native-async-storage/async-storage";
import { isFirebaseConfigured, isFirebaseFirstMode } from "../firebase/config";

const CLOUD_ONLY_KEY = "s4_cloud_only_mode";
const CLOUD_FAMILY_KEY = "s4_cloud_family_id";

export const ACTIVE_FAMILY_STORAGE_KEY = CLOUD_FAMILY_KEY;

export { isFirebaseFirstMode };

export function requireEmailVerification() {
  if (!isFirebaseConfigured()) return false;
  const raw = process.env.EXPO_PUBLIC_REQUIRE_EMAIL_VERIFICATION;
  if (raw !== undefined && String(raw).trim() !== "") {
    const flag = String(raw).trim().toLowerCase();
    return flag !== "0" && flag !== "false" && flag !== "no";
  }
  return isFirebaseFirstMode();
}

export async function loadCloudOnlyMode() {
  try {
    return (await AsyncStorage.getItem(CLOUD_ONLY_KEY)) === "1";
  } catch {
    return false;
  }
}

export async function persistCloudOnlyMode(enabled: boolean) {
  try {
    if (enabled) await AsyncStorage.setItem(CLOUD_ONLY_KEY, "1");
    else await AsyncStorage.removeItem(CLOUD_ONLY_KEY);
  } catch {
    /* ignore */
  }
}

export async function loadCloudFamilyId() {
  try {
    return (await AsyncStorage.getItem(CLOUD_FAMILY_KEY)) || "";
  } catch {
    return "";
  }
}

export async function persistCloudFamilyId(familyId: string) {
  try {
    if (familyId) await AsyncStorage.setItem(CLOUD_FAMILY_KEY, String(familyId));
    else await AsyncStorage.removeItem(CLOUD_FAMILY_KEY);
  } catch {
    /* ignore */
  }
}

export async function clearCloudSession() {
  await persistCloudOnlyMode(false);
  await persistCloudFamilyId("");
}
