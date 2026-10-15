/**
 * HTTP client — Axios primary, fetch fallback. Every request goes to the VPS API.
 */
import Constants from "expo-constants";

function normalizeApiBaseUrl(value: string) {
  const cleaned = value.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(cleaned)) return cleaned;
  return cleaned.replace(/\/api\/v1$/i, "");
}

const PRODUCTION_API_BASE_URL = "https://app.s4businessthinking.com";

const DEFAULT_BASE = normalizeApiBaseUrl(
  process.env.EXPO_PUBLIC_API_BASE_URL ||
    (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ||
    PRODUCTION_API_BASE_URL
);

let runtimeBase = DEFAULT_BASE;
let authToken: string | null = null;

export function getApiBaseUrl() {
  return runtimeBase;
}

export function setApiBaseUrl(url: string) {
  runtimeBase = normalizeApiBaseUrl(url || DEFAULT_BASE);
}

export function setAuthToken(token: string | null) {
  authToken = token;
}

export function getAuthToken() {
  return authToken;
}

function tunnelHeaders(): Record<string, string> {
  return runtimeBase.includes("loca.lt") ? { "bypass-tunnel-reminder": "true" } : {};
}

// Backend's new-device security-alert email (auth_security_service.py's
// _upsert_device_session, via auth.py's get_device_label) falls back to
// sha256(User-Agent) when no X-Device-Id header is sent. React Native's
// default fetch/axios User-Agent is near-identical across all installs of
// the same app/OS version, so that fallback isn't actually per-device on
// mobile — a stolen-credential login from a different phone on the same OS
// could go undetected. A random id persisted in SecureStore makes the
// fingerprint unique per install.
//
// Also reused as the offline-sync device_id (phase10bSync.ts /
// syncManager.ts) in place of the old hardcoded MOBILE_SYNC_DEVICE_ID =
// "mobile-expo" literal, which every install sent identically — colliding
// in the backend's sync_devices/sync_state rows (UniqueConstraint on
// family_id+device_id) whenever a family had 2+ phones, each overwriting
// the other's last_sync_token/last_seen bookkeeping.
let cachedDeviceId: string | null = null;

export async function getOrCreateDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;
  const fallback = () => `mobile-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const SecureStore = require("expo-secure-store") as typeof import("expo-secure-store");
    let id = await SecureStore.getItemAsync("s4_device_id");
    if (!id) {
      id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : fallback();
      await SecureStore.setItemAsync("s4_device_id", id);
    }
    cachedDeviceId = id;
  } catch {
    cachedDeviceId = cachedDeviceId || fallback();
  }
  return cachedDeviceId;
}

function detailMessage(data: any, fallback: string) {
  if (!data) return fallback;
  if (typeof data.detail === "string") return data.detail;
  if (typeof data.detail === "object" && data.detail) {
    if (Array.isArray(data.detail.password_errors)) {
      return data.detail.password_errors.join(" · ");
    }
    if (typeof data.detail.message === "string") return data.detail.message;
    return JSON.stringify(data.detail);
  }
  if (typeof data.error === "string") return data.error;
  if (typeof data.error?.message === "string") return data.error.message;
  if (typeof data.message === "string") return data.message;
  return fallback;
}

type RequestOpts = {
  method?: string;
  body?: unknown;
  token?: string | null;
  headers?: Record<string, string>;
  timeoutMs?: number;
};

async function requestWithAxios<T>(path: string, opts: RequestOpts, headers: Record<string, string>): Promise<T | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const axios = require("axios").default as typeof import("axios").default;
    const res = await axios.request({
      baseURL: runtimeBase,
      url: path,
      method: (opts.method || "GET") as any,
      data: opts.body,
      headers,
      timeout: opts.timeoutMs ?? 30000,
      validateStatus: () => true,
    });
    if (res.status >= 400) {
      throw new Error(detailMessage(res.data, `HTTP ${res.status}`));
    }
    return res.data as T;
  } catch (err: any) {
    if (err?.code === "MODULE_NOT_FOUND" || /Cannot find module/.test(String(err?.message || ""))) {
      return null;
    }
    throw err instanceof Error ? err : new Error(String(err));
  }
}

async function requestWithFetch<T>(path: string, opts: RequestOpts, headers: Record<string, string>): Promise<T> {
  const method = (opts.method || "GET").toUpperCase();
  const url = path.startsWith("http") ? path : `${runtimeBase}${path}`;
  if (!runtimeBase && !path.startsWith("http")) {
    throw new Error("API base URL not set — enter the server address in settings");
  }
  const timeoutMs = opts.timeoutMs ?? 30000;
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(url, {
      method,
      headers,
      body: opts.body != null ? JSON.stringify(opts.body) : undefined,
      signal: controller?.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(detailMessage(data, "Request failed"));
    return data as T;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function request<T = any>(path: string, opts: RequestOpts = {}): Promise<T> {
  const token = opts.token !== undefined ? opts.token : authToken;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Device-Id": await getOrCreateDeviceId(),
    ...tunnelHeaders(),
    ...(opts.headers || {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const viaAxios = await requestWithAxios<T>(path, opts, headers);
  if (viaAxios !== null) return viaAxios;
  return requestWithFetch<T>(path, opts, headers);
}

export const api = {
  get: <T = any>(path: string, token?: string | null) => request<T>(path, { method: "GET", token }),
  post: <T = any>(path: string, body?: unknown, token?: string | null) =>
    request<T>(path, { method: "POST", body, token }),
  patch: <T = any>(path: string, body?: unknown, token?: string | null) =>
    request<T>(path, { method: "PATCH", body, token }),
  put: <T = any>(path: string, body?: unknown, token?: string | null) =>
    request<T>(path, { method: "PUT", body, token }),
  delete: <T = any>(path: string, token?: string | null) => request<T>(path, { method: "DELETE", token }),
};

export const apiGet = api.get;
export const apiPost = api.post;
export const apiPatch = api.patch;
export const apiPut = api.put;
export const apiDelete = api.delete;
