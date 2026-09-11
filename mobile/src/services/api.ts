/**
 * HTTP client — Axios primary, fetch fallback.
 * Firebase-first: routes through cloudApiBridge (SQLite + Firestore sync).
 */
import Constants from "expo-constants";
import { isFirebaseFirstMode } from "../firebase/config";
import {
  cloudBridgeDelete,
  cloudBridgeGet,
  cloudBridgePatch,
  cloudBridgePost,
  shouldUseCloudBridge,
} from "../lib/cloudApiBridge";

function normalizeApiBaseUrl(value: string) {
  const cleaned = value.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(cleaned)) return cleaned;
  return cleaned.replace(/\/api\/v1$/i, "");
}

const firebaseFirst = isFirebaseFirstMode();

const DEFAULT_BASE = normalizeApiBaseUrl(
  process.env.EXPO_PUBLIC_API_BASE_URL ||
    (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ||
    (firebaseFirst ? "" : "http://127.0.0.1:8000")
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
    throw new Error("API base URL not set (Firebase-first mode uses local cloud bridge)");
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

async function requestViaCloudBridge<T>(path: string, opts: RequestOpts): Promise<T> {
  const method = (opts.method || "GET").toUpperCase();
  if (method === "GET") return (await cloudBridgeGet(path)) as T;
  if (method === "POST") return (await cloudBridgePost(path, opts.body)) as T;
  if (method === "PATCH" || method === "PUT") return (await cloudBridgePatch(path, opts.body)) as T;
  if (method === "DELETE") return (await cloudBridgeDelete(path)) as T;
  throw new Error(`Unsupported method in cloud mode: ${method}`);
}

async function request<T = any>(path: string, opts: RequestOpts = {}): Promise<T> {
  if (shouldUseCloudBridge()) {
    return requestViaCloudBridge<T>(path, opts);
  }

  const token = opts.token !== undefined ? opts.token : authToken;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
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
