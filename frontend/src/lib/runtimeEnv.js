import { Capacitor } from "@capacitor/core";

export function isNativeApp() {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function isLocalhostApi(url) {
  try {
    const host = new URL(String(url || "").trim()).hostname.toLowerCase();
    return host === "127.0.0.1" || host === "localhost" || host === "";
  } catch {
    return true;
  }
}

export function formatFetchError(error, lang = "en") {
  const msg = String(error?.message || error || "").trim();
  if (!msg || /failed to fetch|networkerror|load failed/i.test(msg)) {
    if (lang === "bn") {
      return "সার্ভারে যোগাযোগ ব্যর্থ। PC-তে backend চালু করুন, তারপর Server settings-এ PC-র IP দিন (যেমন http://192.168.1.5:8000)।";
    }
    return "Cannot reach server. Start backend on your PC, then set API URL to your PC LAN IP (e.g. http://192.168.1.5:8000) in Server settings.";
  }
  return msg;
}
