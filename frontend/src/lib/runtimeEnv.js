import { Capacitor } from "@capacitor/core";

export function isNativeApp() {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function isLocalhostApi(url) {
  const raw = String(url || "").trim();
  // Same-origin relative paths (e.g. /api/v1) are production web, not localhost.
  if (!raw || raw.startsWith("/")) return false;
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return host === "127.0.0.1" || host === "localhost" || host === "";
  } catch {
    return false;
  }
}

export function isProductionApi(url) {
  const raw = String(url || "").trim();
  // Relative API base is used by the live website behind nginx.
  if (raw.startsWith("/api")) return true;
  try {
    const u = new URL(raw);
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
        return "সার্ভারে যোগাযোগ ব্যর্থ। ইন্টারনেট চেক করুন এবং অ্যাপ রিস্টার্ট করুন।";
      }
      return "Cannot reach server. Check internet and restart the app.";
    }
    if (lang === "bn") {
      return "সার্ভারে যোগাযোগ ব্যর্থ। PC-তে backend চালু আছে কিনা দেখুন।";
    }
    return "Cannot reach server. Make sure the backend is running on your PC.";
  }
  return msg;
}
