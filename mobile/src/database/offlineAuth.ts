/**
 * Pure offline account bootstrap — no FastAPI required.
 * Stores profile + family in SQLite mobile_meta / local_family_members.
 */

import { openMobileDatabase } from "../lib/mobileDb";
import { upsertLocal } from "./localRepository";

const OFFLINE_PROFILE_KEY = "offline_profile_v1";
const OFFLINE_FAMILY_KEY = "offline_family_v1";

export type OfflineProfile = {
  user_id: string;
  email: string;
  full_name: string;
  password_hint: string;
  created_at: string;
};

export type OfflineFamily = {
  id: string;
  name: string;
  default_currency: string;
  timezone: string;
  owner_user_id: string;
  created_at: string;
};

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `off-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function offlineToken(userId: string) {
  return `offline.${userId}.${Date.now().toString(16)}`;
}

export function isOfflineAccessToken(token: string | null | undefined): boolean {
  return Boolean(token && String(token).startsWith("offline."));
}

async function metaSet(key: string, value: object) {
  const db = await openMobileDatabase();
  const now = new Date().toISOString();
  await db.runAsync(
    "INSERT OR REPLACE INTO mobile_meta (key, value, updated_at) VALUES (?, ?, ?)",
    [key, JSON.stringify(value), now]
  );
}

async function metaGet<T>(key: string): Promise<T | null> {
  const db = await openMobileDatabase();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM mobile_meta WHERE key = ?",
    [key]
  );
  if (!row?.value) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

const DEFAULT_CATEGORIES = [
  { name_en: "Salary", name_bn: "বেতন", category_type: "INCOME" },
  { name_en: "Business", name_bn: "ব্যবসা", category_type: "INCOME" },
  { name_en: "Food", name_bn: "খাবার", category_type: "EXPENSE" },
  { name_en: "Transport", name_bn: "যাতায়াত", category_type: "EXPENSE" },
  { name_en: "Rent", name_bn: "ভাড়া", category_type: "EXPENSE" },
  { name_en: "Utilities", name_bn: "বিল", category_type: "EXPENSE" },
  { name_en: "Other", name_bn: "অন্যান্য", category_type: "EXPENSE" },
];

export async function createOfflineAccount(params: {
  fullName: string;
  email: string;
  password: string;
  familyName: string;
  currency?: string;
  timezone?: string;
}): Promise<{
  access_token: string;
  refresh_token: string;
  user: { id: string; email: string; full_name: string };
  family: OfflineFamily;
}> {
  const full_name = params.fullName.trim() || "Guardian";
  const email = (params.email.trim() || `offline-${Date.now()}@local.s4`).toLowerCase();
  const familyName = params.familyName.trim() || `${full_name} Family`;
  const currency = (params.currency || "BDT").trim() || "BDT";
  const timezone = (params.timezone || "Asia/Dhaka").trim() || "Asia/Dhaka";
  if ((params.password || "").length < 4) {
    throw new Error("Password must be at least 4 characters for offline mode.");
  }

  const user_id = uuid();
  const family_id = uuid();
  const now = new Date().toISOString();

  const profile: OfflineProfile = {
    user_id,
    email,
    full_name,
    password_hint: params.password.slice(0, 1) + "***",
    created_at: now,
  };
  const family: OfflineFamily = {
    id: family_id,
    name: familyName,
    default_currency: currency,
    timezone,
    owner_user_id: user_id,
    created_at: now,
  };

  await metaSet(OFFLINE_PROFILE_KEY, profile);
  await metaSet(OFFLINE_FAMILY_KEY, family);

  await upsertLocal(
    "family_members",
    family_id,
    {
      id: uuid(),
      user_id,
      display_name: full_name,
      role: "OWNER",
      status: "ACTIVE",
    },
    { syncStatus: "done" }
  );

  for (const cat of DEFAULT_CATEGORIES) {
    await upsertLocal(
      "categories",
      family_id,
      {
        id: uuid(),
        name_en: cat.name_en,
        name_bn: cat.name_bn,
        category_type: cat.category_type,
      },
      { syncStatus: "done" }
    );
  }

  // Seed one cash wallet so finance UI is immediately usable.
  await upsertLocal(
    "accounts",
    family_id,
    {
      id: uuid(),
      name: "Cash",
      account_type: "CASH",
      currency,
      opening_balance: "0",
      current_balance: "0",
    },
    { syncStatus: "pending" }
  );

  const access_token = offlineToken(user_id);
  return {
    access_token,
    refresh_token: `offline-refresh.${user_id}`,
    user: { id: user_id, email, full_name },
    family,
  };
}

export async function loadOfflineFamily(): Promise<OfflineFamily | null> {
  return metaGet<OfflineFamily>(OFFLINE_FAMILY_KEY);
}

export async function loadOfflineProfile(): Promise<OfflineProfile | null> {
  return metaGet<OfflineProfile>(OFFLINE_PROFILE_KEY);
}

export async function probeApiHealth(apiBaseUrl: string, timeoutMs = 4000): Promise<{ ok: boolean; detail: string }> {
  const base = apiBaseUrl.trim().replace(/\/+$/, "");
  if (!base) return { ok: false, detail: "API URL empty" };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/api/v1/health`, { method: "GET", signal: ctrl.signal });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    return { ok: true, detail: "ok" };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Network error";
    return { ok: false, detail: msg };
  } finally {
    clearTimeout(timer);
  }
}
