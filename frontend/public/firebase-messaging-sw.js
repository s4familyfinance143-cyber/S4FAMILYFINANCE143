/* eslint-disable no-undef */
/**
 * Firebase Cloud Messaging service worker (must live at site root).
 * Handles background push when the app tab is not focused.
 */
importScripts("https://www.gstatic.com/firebasejs/11.10.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/11.10.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyDO05KM8i2WlERcajsqCIMNvKos8tw14lc",
  authDomain: "s4-family-finance.firebaseapp.com",
  projectId: "s4-family-finance",
  storageBucket: "s4-family-finance.firebasestorage.app",
  messagingSenderId: "1089437513968",
  appId: "1:1089437513968:web:0e4438c9489251bf00ea35",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title =
    payload?.notification?.title || payload?.data?.title || "S4 Family Finance 143";
  const body =
    payload?.notification?.body || payload?.data?.body || "New family activity";
  const options = {
    body,
    icon: "/icon-192.png",
    badge: "/icon-96.png",
    data: payload?.data || {},
    tag: payload?.data?.tag || "s4-family-notify",
  };
  self.registration.showNotification(title, options);
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification?.data?.url || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.focus();
          if (targetUrl && "navigate" in client) client.navigate(targetUrl);
          return;
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    }),
  );
});
