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

export function isProductionApi(url) {
  try {
    const u = new URL(String(url || "").trim());
    if (u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    return host.endsWith("s4businessthinking.com") || host.endsWith("s4family.app");
  } catch {
    return false;
  }
}

export function formatFetchError(error, lang = "en", apiBase = "") {
  const msg = String(error?.message || error || "").trim();
  if (!msg || /failed to fetch|networkerror|load failed/i.test(msg)) {
    if (isProductionApi(apiBase)) {
      if (lang === "bn") {
        return "সার্ভারে যোগাযোগ ব্যর্থ। ইন্টারনেট চেক করুন, অ্যাপ রিস্টার্ট করুন, Server settings-এ API URL ঠিক আছে কিনা দেখুন: https://app.s4businessthinking.com/api/v1";
      }
      return "Cannot reach server. Check internet, restart the app, and confirm API URL is https://app.s4businessthinking.com/api/v1";
    }
    if (lang === "bn") {
      return "সার্ভারে যোগাযোগ ব্যর্থ। PC-তে backend চালু করুন, তারপর Server settings-এ PC-র IP দিন (যেমন http://192.168.1.5:8000)।";
    }
    return "Cannot reach server. Start backend on your PC, then set API URL to your PC LAN IP (e.g. http://192.168.1.5:8000) in Server settings.";
  }
  return msg;
}
