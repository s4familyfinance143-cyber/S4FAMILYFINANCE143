/**
 * Browser-native notifications (Notification API) — no push service needed.
 * Shown for live VPS events while the app is open in a tab.
 */

export function getNotificationPermission() {
  return typeof Notification !== "undefined" ? Notification.permission : "denied";
}

export async function requestBrowserNotifications() {
  if (typeof Notification === "undefined") {
    return { ok: false, permission: "denied", reason: "unsupported", hint: "This browser does not support notifications." };
  }
  let permission = Notification.permission;
  if (permission === "default") {
    try {
      permission = await Notification.requestPermission();
    } catch {
      permission = Notification.permission;
    }
  }
  if (permission === "granted") return { ok: true, permission, reason: "", hint: "" };
  return {
    ok: false,
    permission,
    reason: "denied",
    hint: permission === "denied" ? "Notifications are blocked in the browser settings for this site." : "",
  };
}

/** Show a notification only when the tab is in the background (in-app toasts cover the rest). */
export function showBrowserNotification(title, body = "") {
  try {
    if (getNotificationPermission() !== "granted") return;
    if (typeof document !== "undefined" && document.visibilityState === "visible") return;
    new Notification(title || "S4 Family Finance 143", { body, icon: "/icon-192.png" });
  } catch {
    /* some browsers require a service worker for notifications */
  }
}
