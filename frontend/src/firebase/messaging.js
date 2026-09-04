/**
 * Web push: browser Notification permission + Firebase Cloud Messaging tokens.
 * FCM SDK is loaded lazily so a messaging failure never blanks the app at boot.
 */
import { doc, serverTimestamp, setDoc } from "firebase/firestore";

import { firebaseConfig, getFirebaseApp, getFirebaseAuth, getFirestoreDb } from "./config";

const SW_PATH = "/firebase-messaging-sw.js";
const LOG_PREFIX = "[S4 Notify]";

/**
 * Public VAPID key from Vite env (frontend/.env → VITE_FIREBASE_VAPID_KEY).
 * Strips accidental quotes from .env values.
 */
export function getFirebaseVapidKey() {
  try {
    let key = String(import.meta.env.VITE_FIREBASE_VAPID_KEY ?? "").trim();
    if (
      (key.startsWith('"') && key.endsWith('"')) ||
      (key.startsWith("'") && key.endsWith("'"))
    ) {
      key = key.slice(1, -1).trim();
    }
    return key;
  } catch {
    return "";
  }
}

export function isWebFcmVapidConfigured() {
  return getFirebaseVapidKey().length > 20;
}

async function loadMessagingSdk() {
  try {
    return await import("firebase/messaging");
  } catch (err) {
    console.error(LOG_PREFIX, "firebase/messaging import failed", err);
    return null;
  }
}

export function getNotificationPermission() {
  try {
    if (typeof window === "undefined" || typeof Notification === "undefined") return "unsupported";
    return Notification.permission || "default";
  } catch (err) {
    console.warn(LOG_PREFIX, "getNotificationPermission failed", err);
    return "unsupported";
  }
}

export function isNotificationSupported() {
  try {
    return typeof window !== "undefined" && "Notification" in window;
  } catch {
    return false;
  }
}

/**
 * Ask the browser for notification permission (explicit user gesture recommended).
 * @returns {Promise<'granted'|'denied'|'default'|'unsupported'>}
 */
export async function requestBrowserNotificationPermission() {
  if (!isNotificationSupported()) {
    console.warn(LOG_PREFIX, "Notification API unsupported in this browser");
    return "unsupported";
  }
  try {
    if (Notification.permission === "granted") return "granted";
    if (Notification.permission === "denied") return "denied";
    const result = await Notification.requestPermission();
    console.info(LOG_PREFIX, "permission result:", result);
    return result;
  } catch (err) {
    console.error(LOG_PREFIX, "requestPermission failed", err);
    return "default";
  }
}

/**
 * Register the dedicated FCM service worker at /firebase-messaging-sw.js
 * and return that registration for getToken().
 */
export async function registerMessagingServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    console.warn(LOG_PREFIX, "serviceWorker unsupported");
    return null;
  }
  try {
    const registration = await navigator.serviceWorker.register(SW_PATH, {
      scope: "/",
    });
    await navigator.serviceWorker.ready;
    const fcmRegistration =
      (await navigator.serviceWorker.getRegistration(SW_PATH)) || registration;
    console.info(LOG_PREFIX, "service worker ready", fcmRegistration.scope);
    return fcmRegistration;
  } catch (err) {
    console.error(LOG_PREFIX, "service worker register failed", err);
    return null;
  }
}

function tokenDocId(token) {
  let hash = 0;
  const s = String(token || "");
  for (let i = 0; i < s.length; i += 1) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return `t_${hash.toString(16)}`;
}

/**
 * Persist FCM token on user + family member docs (merge).
 */
export async function storeFcmTokenInFirestore({
  uid,
  familyId,
  token,
  platform = "WEB",
  deviceLabel = "web-browser",
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
    await setDoc(doc(db, "users", uid, "fcmTokens", tokenDocId(token)), payload, {
      merge: true,
    });
    await setDoc(
      doc(db, "users", uid),
      {
        fcm_token_latest: token,
        fcm_updated_at: serverTimestamp(),
      },
      { merge: true },
    );
    if (familyId) {
      await setDoc(
        doc(db, "families", familyId, "members", uid),
        {
          fcm_token_latest: token,
          fcm_updated_at: serverTimestamp(),
        },
        { merge: true },
      );
      await setDoc(
        doc(db, "families", familyId, "fcmTokens", tokenDocId(token)),
        { ...payload, uid },
        { merge: true },
      );
    }
    console.info(LOG_PREFIX, "FCM token stored in Firestore");
  } catch (err) {
    console.error(LOG_PREFIX, "Firestore token store failed", err);
    throw err;
  }
}

/**
 * Request permission (if needed), register SW, obtain FCM token via
 * getToken(messaging, { vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY }).
 */
export async function enableWebPushNotifications({
  familyId = null,
  deviceLabel = "web-browser",
  registerWithBackend = null,
} = {}) {
  const result = {
    ok: false,
    permission: getNotificationPermission(),
    token: null,
    reason: "",
    hint: "",
    vapidConfigured: isWebFcmVapidConfigured(),
    swRegistered: false,
  };

  try {
    if (!isNotificationSupported()) {
      result.reason = "unsupported";
      result.hint = "This browser does not support notifications.";
      return result;
    }

    const permission = await requestBrowserNotificationPermission();
    result.permission = permission;

    if (permission === "denied") {
      result.reason = "denied";
      result.hint =
        "Notifications are blocked. Enable them in browser site settings, then retry from Notifications → Devices.";
      console.warn(LOG_PREFIX, result.hint);
      return result;
    }
    if (permission !== "granted") {
      result.reason = "default";
      result.hint = "Notification permission was not granted.";
      return result;
    }

    const sdk = await loadMessagingSdk();
    if (!sdk) {
      result.reason = "fcm_import_failed";
      result.hint = "Could not load Firebase Messaging. In-app notifications still work.";
      return result;
    }

    const supported = await sdk.isSupported().catch(() => false);
    if (!supported) {
      result.reason = "fcm_unsupported";
      result.hint = "FCM is not supported here; in-app notifications still work.";
      console.warn(LOG_PREFIX, result.hint);
      return result;
    }

    const vapidKey = getFirebaseVapidKey();
    result.vapidConfigured = Boolean(vapidKey);

    if (!vapidKey) {
      result.reason = "missing_vapid";
      result.hint =
        "VITE_FIREBASE_VAPID_KEY is empty. Add it to frontend/.env and restart Vite (npm run dev). In-app alerts still work.";
      console.warn(LOG_PREFIX, result.hint);
      try {
        new Notification("S4 Family Finance 143", {
          body: "Browser alerts enabled. Set VITE_FIREBASE_VAPID_KEY and restart the dev server for FCM.",
          icon: "/icon-192.png",
        });
      } catch {
        /* optional */
      }
      return result;
    }

    const registration = await registerMessagingServiceWorker();
    result.swRegistered = Boolean(registration);

    const messaging = sdk.getMessaging(getFirebaseApp());
    // Required: Vite env public VAPID key for FCM web push tokens
    const token = await sdk.getToken(messaging, {
      vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY
        ? String(import.meta.env.VITE_FIREBASE_VAPID_KEY).trim().replace(/^['"]|['"]$/g, "")
        : vapidKey,
      serviceWorkerRegistration: registration || undefined,
    });

    if (!token) {
      result.reason = "no_token";
      result.hint = "FCM did not return a token. Check Firebase Cloud Messaging is enabled.";
      console.error(LOG_PREFIX, result.hint);
      return result;
    }

    result.token = token;
    const auth = getFirebaseAuth();
    const uid = auth?.currentUser?.uid || null;
    if (uid) {
      try {
        await storeFcmTokenInFirestore({ uid, familyId, token, deviceLabel });
      } catch (err) {
        console.error(LOG_PREFIX, "token store failed (non-fatal)", err);
      }
    }

    if (typeof registerWithBackend === "function") {
      try {
        await registerWithBackend(token);
      } catch (err) {
        console.error(LOG_PREFIX, "backend device register failed", err);
        result.hint = err?.message || "Token obtained but backend register failed";
      }
    }

    result.ok = true;
    result.reason = "ready";
    console.info(LOG_PREFIX, "FCM ready", token.slice(0, 12) + "…");
    return result;
  } catch (err) {
    console.error(LOG_PREFIX, "enableWebPushNotifications failed", err);
    result.reason = "error";
    result.hint = err?.message || "Notification setup failed";
    return result;
  }
}

/**
 * Foreground FCM listener — returns unsubscribe. Never throws to callers.
 */
export function subscribeForegroundMessages(onPayload) {
  let unsub = () => {};
  let cancelled = false;

  (async () => {
    try {
      const sdk = await loadMessagingSdk();
      if (!sdk || cancelled) return;
      const supported = await sdk.isSupported().catch(() => false);
      if (!supported || cancelled) return;
      const messaging = sdk.getMessaging(getFirebaseApp());
      unsub = sdk.onMessage(messaging, (payload) => {
        console.info(LOG_PREFIX, "foreground message", payload);
        try {
          onPayload?.(payload);
        } catch (err) {
          console.error(LOG_PREFIX, "onPayload handler failed", err);
        }
        const title = payload?.notification?.title || payload?.data?.title || "S4 Family Finance 143";
        const body = payload?.notification?.body || payload?.data?.body || "";
        if (getNotificationPermission() === "granted" && (title || body)) {
          try {
            new Notification(title, { body, icon: "/icon-192.png" });
          } catch (err) {
            console.error(LOG_PREFIX, "foreground Notification failed", err);
          }
        }
      });
    } catch (err) {
      console.error(LOG_PREFIX, "onMessage subscribe failed", err);
    }
  })();

  return () => {
    cancelled = true;
    try {
      unsub();
    } catch {
      /* ignore */
    }
  };
}

export function showLocalBrowserNotification(title, body, options = {}) {
  if (!isNotificationSupported() || Notification.permission !== "granted") {
    console.warn(LOG_PREFIX, "cannot show local notification — permission not granted");
    return false;
  }
  try {
    new Notification(title || "S4 Family Finance 143", {
      body: body || "",
      icon: "/icon-192.png",
      ...options,
    });
    return true;
  } catch (err) {
    console.error(LOG_PREFIX, "showLocalBrowserNotification failed", err);
    return false;
  }
}
