/**
 * Crash reporting:
 * 1) Always-on local crash vault (MMKV / SecureStore) — works without any cloud account
 * 2) Optional Sentry cloud when EXPO_PUBLIC_SENTRY_DSN is set
 */
import Constants from "expo-constants";
import { fastStorage } from "./fastStorage";

const CRASH_KEY = "s4_crash_log_v1";
const MAX_CRASHES = 40;

let started = false;
let sentryEnabled = false;

export type CrashRecord = {
  id: string;
  at: string;
  message: string;
  stack?: string;
  extra?: Record<string, unknown>;
};

function readCrashes(): CrashRecord[] {
  try {
    const raw = fastStorage.getString(CRASH_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeCrashes(rows: CrashRecord[]) {
  fastStorage.set(CRASH_KEY, JSON.stringify(rows.slice(0, MAX_CRASHES)));
}

export function listLocalCrashes(): CrashRecord[] {
  return readCrashes();
}

export function clearLocalCrashes() {
  fastStorage.delete(CRASH_KEY);
}

export function recordLocalCrash(error: unknown, extra?: Record<string, unknown>): CrashRecord {
  const err = error instanceof Error ? error : new Error(String(error));
  const row: CrashRecord = {
    id: `crash-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    message: err.message || "Unknown error",
    stack: err.stack,
    extra,
  };
  const next = [row, ...readCrashes()].slice(0, MAX_CRASHES);
  writeCrashes(next);
  return row;
}

function resolveDsn(): string {
  return String(
    process.env.EXPO_PUBLIC_SENTRY_DSN ||
      (Constants.expoConfig?.extra as any)?.sentryDsn ||
      ""
  ).trim();
}

export function initSentry() {
  if (started) {
    return { enabled: sentryEnabled, localVault: true as const, reason: "already started" };
  }
  started = true;

  // Local vault is always live — no cloud account required
  const dsn = resolveDsn();
  // Expo Go: skip native Sentry — it can SIGSEGV the JS thread on some devices.
  if (Constants.appOwnership === "expo") {
    if (__DEV__) {
      console.info("[Crash] Local vault ON (Expo Go). Cloud Sentry disabled in Go.");
    }
    return { enabled: false as const, localVault: true as const, reason: "Expo Go — local vault only" };
  }
  if (!dsn) {
    if (__DEV__) {
      console.info("[Crash] Local vault ON. Optional cloud: set EXPO_PUBLIC_SENTRY_DSN in mobile/.env");
    }
    return { enabled: false as const, localVault: true as const, reason: "DSN not configured — local vault active" };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sentry = require("@sentry/react-native") as typeof import("@sentry/react-native");
    Sentry.init({
      dsn,
      tracesSampleRate: 0.15,
      enableAutoSessionTracking: true,
      enableNative: false,
      environment: process.env.NODE_ENV === "production" ? "production" : "development",
    });
    sentryEnabled = true;
    return { enabled: true as const, localVault: true as const };
  } catch (err) {
    return {
      enabled: false as const,
      localVault: true as const,
      reason: err instanceof Error ? err.message : "Sentry init failed",
    };
  }
}

export function captureException(error: unknown, context?: Record<string, unknown>) {
  recordLocalCrash(error, context);
  if (!sentryEnabled) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sentry = require("@sentry/react-native") as typeof import("@sentry/react-native");
    Sentry.captureException(error, context ? { extra: context } : undefined);
  } catch {
    /* ignore cloud failures — local vault already saved */
  }
}

export function getCrashReportingStatus() {
  return {
    localVault: true,
    sentryCloud: sentryEnabled,
    dsnConfigured: Boolean(resolveDsn()),
    crashCount: readCrashes().length,
  };
}
