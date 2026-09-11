/**
 * Mobile push: Expo Notifications → FCM/APNs token → same Firestore shape as web.
 */
import { Platform } from "react-native";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";

import { firebaseConfig, getFirestoreDb, getFirebaseAuth } from "./config";

const LOG_PREFIX = "[S4 Mobile FCM]";

function tokenDocId(token: string) {
  let hash = 0;
  const s = String(token || "");
  for (let i = 0; i < s.length; i += 1) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return `t_${hash.toString(16)}`;
}

export async function storeFcmTokenInFirestore({
  uid,
  familyId,
  token,
  platform = Platform.OS === "ios" ? "IOS" : "ANDROID",
  deviceLabel = "mobile",
}: {
  uid: string;
  familyId?: string | null;
  token: string;
  platform?: string;
  deviceLabel?: string;
}) {
  if (!uid || !token) return;
  const db = getFirestoreDb();
  if (!db) return;

  const payload = {
    token,
    platform,
    device_label: deviceLabel,
    messaging_sender_id: firebaseConfig.messagingSenderId,
    updated_at: serverTimestamp(),
    last_seen_at: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, "users", uid, "fcmTokens", tokenDocId(token)), payload, { merge: true });
    await setDoc(
      doc(db, "users", uid),
      { fcm_token_latest: token, fcm_updated_at: serverTimestamp() },
      { merge: true }
    );
  } catch (err: any) {
    console.warn(LOG_PREFIX, "user FCM token store skipped", err?.code || err?.message || err);
    return;
  }

  if (familyId) {
    try {
      await setDoc(
        doc(db, "families", familyId, "members", uid),
        { fcm_token_latest: token, fcm_updated_at: serverTimestamp() },
        { merge: true }
      );
      await setDoc(
        doc(db, "families", familyId, "fcmTokens", tokenDocId(token)),
        { ...payload, uid },
        { merge: true }
      );
    } catch (familyErr: any) {
      console.warn(LOG_PREFIX, "family FCM token store skipped", familyErr?.code || familyErr?.message || familyErr);
    }
  }
}

export async function enableMobilePushNotifications({
  familyId = null,
  deviceLabel = "mobile",
}: {
  familyId?: string | null;
  deviceLabel?: string;
} = {}) {
  const result = {
    ok: false,
    token: null as string | null,
    reason: "",
    hint: "",
    permission: "",
  };

  try {
    // Dynamic import so app boots without expo-notifications installed yet
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Notifications = require("expo-notifications");
    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;
    if (existing !== "granted") {
      const asked = await Notifications.requestPermissionsAsync();
      finalStatus = asked.status;
    }
    result.permission = String(finalStatus);
    if (finalStatus !== "granted") {
      result.reason = "denied";
      result.hint = "Notification permission not granted";
      return result;
    }

    const tokenResponse = await Notifications.getDevicePushTokenAsync();
    const token = String(tokenResponse?.data || "").trim();
    if (!token) {
      result.reason = "no_token";
      result.hint = "No device push token (use a real device / native build)";
      return result;
    }
    result.token = token;

    const uid = getFirebaseAuth()?.currentUser?.uid;
    if (uid) {
      await storeFcmTokenInFirestore({
        uid,
        familyId,
        token,
        platform: Platform.OS === "ios" ? "IOS" : "ANDROID",
        deviceLabel,
      });
    }

    result.ok = true;
    result.reason = "ready";
    return result;
  } catch (err: any) {
    result.reason = "error";
    result.hint =
      err?.message ||
      "expo-notifications missing — run: npx expo install expo-notifications";
    console.warn(LOG_PREFIX, result.hint);
    return result;
  }
}
