import React, { useCallback, useEffect, useState } from "react";
import * as BackgroundTask from "expo-background-task";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import {
  apiGet as svcGet,
  apiPost as svcPost,
  apiPatch as svcPatch,
  apiPut as svcPut,
  apiDelete as svcDelete,
  setApiBaseUrl,
  setAuthToken,
} from "../services/api";
import { useAuth } from "../hooks/useAuth";
import { useFamily } from "../hooks/useFamily";
import { useBudget } from "../hooks/useBudget";
import { useSync } from "../hooks/useSync";
import { useOffline } from "../hooks/useOffline";
import { syncManager } from "../sync/syncManager";
import { LoginScreen } from "../screens/AuthScreen";
import { DashboardScreen } from "../screens/DashboardScreen";
import { IncomeScreen } from "../screens/IncomeScreen";
import { ExpenseScreen } from "../screens/ExpenseScreen";
import { GroceryScreen } from "../screens/GroceryScreen";
import { LoansScreen } from "../screens/LoansScreen";
import { BudgetScreen } from "../screens/BudgetScreen";
import { ReportsScreen } from "../screens/ReportsScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
import { documentScanner } from "../services/documentScanner";
import { mlKit } from "../services/mlKit";
import { useAuthStore } from "../store/authStore";
import { useFamilyStore } from "../store/familyStore";
import { runMigrations } from "../database/migrations";
import { formatAmount as formatTakaAmount } from "../utils/formatTaka";
import { openMobileDatabase, ENCRYPTED_DB_NAME, getOfflineDbSecurityStatus } from "../lib/mobileDb";
import { fastStorage } from "../lib/fastStorage";
import * as TaskManager from "expo-task-manager";
import {
  Alert,
  AppState,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LifeModulesPanel } from "../components/modules/LifeModulesPanel";
import { MobileAuditPanel } from "../components/modules/MobileAuditPanel";
import { MobileBackupPanel } from "../components/modules/MobileBackupPanel";
import { MobileCurrencyPanel } from "../components/modules/MobileCurrencyPanel";
import { type FinanceSub } from "../components/modules/MobileFinancePanel";
import { MobileGovernancePanel } from "../components/modules/MobileGovernancePanel";
import { MobilePlannerPanel } from "../components/modules/MobilePlannerPanel";
import { MobileNotificationsPanel } from "../components/modules/MobileNotificationsPanel";
import { MobileZakatPanel } from "../components/modules/MobileZakatPanel";
import { MobileArchBottomNav } from "../components/MobileArchBottomNav";
import { MobileMoreDrawerList as DrawerNav } from "../components/MobileMoreDrawerList";
import { MobileSplashScreen } from "../components/MobileSplashScreen";
import { AppImages } from "../assets";
import {
  LOCKED_LANGUAGES,
  loadMobileLanguage,
  loadMobileTheme,
  saveMobileLanguage,
  saveMobileTheme,
  tMobile,
  type MobileLang,
  type MobileTheme,
} from "../i18n";

const AUTH_TIMEZONE_PRESETS = ["Asia/Dhaka", "Asia/Dubai", "Asia/Kolkata", "UTC"] as const;
const AUTH_CURRENCY_PRESETS = ["BDT", "AED", "USD", "INR", "SAR"] as const;
import {
  JOIN_RELATIONSHIPS,
  OWNER_RELATIONSHIPS,
  buildJoinInvitePayload,
  needsLinkedMember,
  needsRelationshipNote,
  needsSerial,
  serialLabelsFor,
} from "../lib/familyRelationships";
import {
  fetchOpenConflicts,
  mapDomainOutboxRow,
  mapFinanceIntentToChange,
  mapGroceryRowToChanges,
  MOBILE_SYNC_DEVICE_ID,
  pullPhase10b,
  pushPhase10bChanges,
  pushResultFailed,
  pushResultHasConflict,
} from "../lib/phase10bSync";
import { flushMobileDocumentUploads } from "../lib/offlineFileQueue";
import { loadModuleSnapshot, saveModuleSnapshot } from "../lib/offlineSnapshots";
import { setCloudApiContext } from "../lib/cloudApiBridge";
import {
  persistCloudFamilyId,
  persistCloudOnlyMode,
  clearCloudSession,
  loadCloudFamilyId,
  requireEmailVerification,
} from "../lib/cloudSession";
import {
  isFirebaseFirstMode,
  getFirebaseAuth,
  subscribeFirebaseAuth,
  firebaseSignInEmail,
  firebaseRegisterEmail,
  firebaseSendPasswordReset,
  firebaseSignOut,
  firebaseSignInGoogle,
  firebaseReloadUser,
  firebaseResendVerification,
  isFirebaseEmailVerified,
  formatFirebaseAuthError,
} from "../firebase";
import { enableMobilePushNotifications } from "../firebase/messaging";
import { EmailVerificationGate } from "../components/auth/EmailVerificationGate";
import { createCloudFamilyAccount } from "../firebase/cloudOnboarding";
import { joinFamilyByInviteCode } from "../firebase/familyCloud";
import {
  pullCloudSnapshot,
  pushCloudSnapshot,
  getUserFamilyProfile,
  ensureUserProfile,
  resolveAndBindUserFamily,
  bindCloudFamilyIdentity,
} from "../firebase/cloudSync";
import { loadOfflineSnapshot } from "../lib/offlineCache";
import {
  createOfflineAccount,
  isOfflineAccessToken,
  loadOfflineFamily,
  probeApiHealth,
} from "../database/offlineAuth";

function normalizeApiBaseUrl(value: string) {
  const cleaned = value.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(cleaned)) return cleaned;
  return cleaned.replace(/\/api\/v[12]$/i, "");
}

function isCloudAccessToken(value: string | null | undefined) {
  return String(value || "").startsWith("firebase.");
}

function cloudTokenFor(uid: string) {
  return `firebase.${uid}`;
}

const DEFAULT_API_BASE_URL = normalizeApiBaseUrl(
  process.env.EXPO_PUBLIC_API_BASE_URL ||
    (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ||
    (isFirebaseFirstMode() ? "" : "http://192.168.13.248:8000"),
);
const API_BASE_URL_KEY = "s4_mobile_api_base_url_v1";
const SESSION_KEY = "s4_family_finance_mobile_session_v2";
const REMEMBER_EMAIL_KEY = "s4_remember_email";
const LOCAL_DB_NAME = ENCRYPTED_DB_NAME;
const AUTO_SYNC_INTERVAL_MS = 45000;
const BACKGROUND_SYNC_TASK = "s4-family-finance-background-sync";
const BACKGROUND_SYNC_INTERVAL_MINUTES = 15;
/** User controls refresh — auto-sync stays off unless they turn it on. */
const AUTO_SYNC_PREF_KEY = "s4_auto_sync_enabled";
const MAX_SYNC_RETRIES = 5;

/** Exponential backoff: 2s ? 4s ? 8s ? 16s ? 32s (cap 60s). */
function syncBackoffMs(retryCount: number) {
  const delay = 2000 * Math.pow(2, Math.max(0, retryCount));
  return Math.min(delay, 60_000);
}

function nextRetryAtIso(retryCount: number) {
  return new Date(Date.now() + syncBackoffMs(retryCount)).toISOString();
}

let runtimeApiBaseUrl = DEFAULT_API_BASE_URL;

function getApiBaseUrl() {
  return runtimeApiBaseUrl;
}

function setRuntimeApiBaseUrl(next: string) {
  runtimeApiBaseUrl = normalizeApiBaseUrl(next) || DEFAULT_API_BASE_URL;
  setApiBaseUrl(runtimeApiBaseUrl);
}

function tunnelHeaders() {
  return getApiBaseUrl().includes("loca.lt") ? { "bypass-tunnel-reminder": "true" } : {};
}

function nextSyncFailureStatus(errorMessage: string, retryCount: number) {
  if (errorMessage.includes("SYNC_CONFLICT")) return "conflict";
  if (retryCount + 1 >= MAX_SYNC_RETRIES) return "failed";
  return "pending";
}

type MobileTab = "home" | "finance" | "grocery" | "life" | "family" | "planner" | "zakat" | "reports" | "alerts" | "audit" | "settings" | "sync" | "backup" | "currency";
type AuthMode = "login" | "create" | "join" | "forgot";
type ApiStatus = "idle" | "ok" | "failed";

type StoredSession = {
  access_token: string;
  refresh_token?: string;
  email: string;
  family_id?: string;
  offline_mode?: boolean;
  user?: { id?: string; email?: string; full_name?: string; name?: string };
};

type Family = { id: string; name: string; default_currency?: string; timezone?: string };
type DashboardSummary = {
  total_wallet_balance?: string;
  total_income?: string;
  total_expense?: string;
  net_income_expense?: string;
  loan_taken_remaining?: string;
  loan_given_remaining?: string;
  savings_current?: string;
  wallet_count?: string | number;
};
type Account = { id: string; name: string; account_type: string; current_balance?: string; currency?: string };
type Category = { id: string; name_en?: string; name_bn?: string; category_type: string };
type Transaction = { id: string; transaction_type: string; amount: string; currency?: string; description?: string; created_at?: string };
type Budget = { id: string; name?: string; title?: string; amount?: string; budget_amount?: string; spent_amount?: string; status?: string };
type GroceryList = { id: string; title: string; status: string; vendor_name?: string; budget_amount?: string; currency?: string; mobile_sync_key?: string; sync_version?: number };
type GroceryItem = { id: string; name: string; category?: string; quantity?: string; unit?: string; is_bought: boolean; actual_price?: string; estimated_price?: string; vendor_name?: string; mobile_sync_key?: string; sync_version?: number; note?: string };
type CountRow = { count: number };
type SyncQueueRow = {
  id: number;
  entity_id: string;
  entity_type?: string;
  action: string;
  payload: string;
  retry_count: number;
  last_error?: string;
};
type ConflictPayload = {
  family_id?: string;
  item_id?: string;
  name?: string;
  category?: string;
  quantity?: string;
  unit?: string;
  estimated_price?: string;
  actual_price?: string;
  note?: string;
  sync_version?: number;
  created_at?: string;
};

function passwordStrength(pw: string) {
  let score = 0;
  if (pw.length >= 8) score += 1;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score += 1;
  if (/\d/.test(pw)) score += 1;
  if (/[^A-Za-z0-9]/.test(pw)) score += 1;
  return score;
}

function amount(value?: string | number | null, currency = "AED") {
  return formatTakaAmount(value, currency);
}

function itemEditDefaults(item?: GroceryItem) {
  return {
    name: item?.name || "",
    category: item?.category || "GENERAL",
    quantity: item?.quantity || "1",
    unit: item?.unit || "pcs",
    estimated_price: item?.estimated_price || "0",
    actual_price: item?.actual_price || "0",
    note: item?.note || "",
  };
}

function parseConflictPayload(row: SyncQueueRow): ConflictPayload {
  try {
    return JSON.parse(row.payload) as ConflictPayload;
  } catch {
    return {};
  }
}

async function backgroundApiRequest(path: string, options: RequestInit, authToken: string) {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...tunnelHeaders(),
      Authorization: `Bearer ${authToken}`,
      ...(options.headers as Record<string, string> | undefined),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.detail === "object" ? JSON.stringify(data.detail) : data.detail || "Request failed");
  return data;
}

async function replayGroceryQueueForBackground() {
  if (!(await SecureStore.isAvailableAsync())) return 0;
  const raw = await SecureStore.getItemAsync(SESSION_KEY);
  if (!raw) return 0;
  const session = JSON.parse(raw) as StoredSession;
  if (!session.access_token) return 0;

  try {
    const { syncManager } = await import("../sync/syncManager");
    const familyId =
      session.family_id ||
      (await openMobileDatabase(LOCAL_DB_NAME)
        .then((db) =>
          db.getFirstAsync<{ payload: string }>(
            "SELECT payload FROM sync_queue WHERE status = ? ORDER BY created_at ASC LIMIT 1",
            ["pending"]
          )
        )
        .then((row) => {
          try {
            return row ? String(JSON.parse(row.payload).family_id || "") : "";
          } catch {
            return "";
          }
        })) ||
      "";
    const result = await syncManager.replayPending(session.access_token, familyId, 20);
    return result.synced || 0;
  } catch {
    return 0;
  }
}

TaskManager.defineTask(BACKGROUND_SYNC_TASK, async () => {
  try {
    await replayGroceryQueueForBackground();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export default function HomeScreen() {
  const authHook = useAuth();
  const familyHook = useFamily();
  const budgetHook = useBudget();
  const syncHook = useSync();
  // Keep architecture modules live in the main tree.
  void mlKit.note;
  void AppImages.icon;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberDevice, setRememberDevice] = useState(true);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [familySetupMode, setFamilySetupMode] = useState<"create" | "join">("create");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [familyCurrency, setFamilyCurrency] = useState("BDT");
  const [familyTimezone, setFamilyTimezone] = useState("Asia/Dhaka");
  const [ownerRelation, setOwnerRelation] = useState("Guardian");
  const [inviteCode, setInviteCode] = useState("");
  const [joinRelation, setJoinRelation] = useState("Relative");
  const [joinSerialLabel, setJoinSerialLabel] = useState("");
  const [joinSerial, setJoinSerial] = useState("");
  const [joinNote, setJoinNote] = useState("");
  const [joinLinkedMemberId, setJoinLinkedMemberId] = useState("");
  const [apiBaseUrlInput, setApiBaseUrlInput] = useState(DEFAULT_API_BASE_URL);
  const [showAdvancedServer, setShowAdvancedServer] = useState(false);
  const [token, setToken] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [firebaseUser, setFirebaseUser] = useState<any>(null);
  const [status, setStatus] = useState<ApiStatus>("idle");
  const [message, setMessage] = useState("Ready.");
  const [loading, setLoading] = useState(false);
  const [families, setFamilies] = useState<Family[]>([]);
  const [activeFamilyId, setActiveFamilyId] = useState("");
  const offlineHook = useOffline(activeFamilyId || null);

  useEffect(() => {
    setAuthToken(token || null);
    useAuthStore.getState().hydrateToken(token || null);
  }, [token]);

  useEffect(() => {
    useFamilyStore.getState().setFamilyId(activeFamilyId || null);
  }, [activeFamilyId]);

  useEffect(() => {
    setApiBaseUrl(getApiBaseUrl());
  }, []);

  const [dashboard, setDashboard] = useState<DashboardSummary | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [groceryLists, setGroceryLists] = useState<GroceryList[]>([]);
  const [groceryItems, setGroceryItems] = useState<GroceryItem[]>([]);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [pendingGrocerySyncCount, setPendingGrocerySyncCount] = useState(0);
  const [pendingFinanceSyncCount, setPendingFinanceSyncCount] = useState(0);
  const [conflictSyncCount, setConflictSyncCount] = useState(0);
  const [failedSyncCount, setFailedSyncCount] = useState(0);

  useEffect(() => {
    if (token && activeFamilyId) {
      void syncHook.refreshStatus();
      void budgetHook.refetch();
      void familyHook.refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, activeFamilyId]);

  useEffect(() => {
    const raw = budgetHook.budgets as any;
    if (!raw) return;
    const rows = Array.isArray(raw) ? raw : raw.budgets || raw.items || [];
    if (Array.isArray(rows) && rows.length) setBudgets(rows);
  }, [budgetHook.budgets]);

  useEffect(() => {
    if (syncHook.status) {
      setPendingSyncCount(syncHook.status.pending);
      setConflictSyncCount(syncHook.status.conflicts);
      setFailedSyncCount(syncHook.status.failed);
      setPendingGrocerySyncCount(syncHook.status.groceryPending);
      setPendingFinanceSyncCount(syncHook.status.financePending);
    }
  }, [syncHook.status]);

  useEffect(() => {
    setPendingSyncCount(offlineHook.pending);
    setConflictSyncCount(offlineHook.conflicts);
    setFailedSyncCount(offlineHook.failed);
    setPendingGrocerySyncCount(offlineHook.groceryPending);
    setPendingFinanceSyncCount(offlineHook.financePending);
  }, [
    offlineHook.pending,
    offlineHook.conflicts,
    offlineHook.failed,
    offlineHook.groceryPending,
    offlineHook.financePending,
  ]);
  const [conflictRows, setConflictRows] = useState<SyncQueueRow[]>([]);
  const [serverConflicts, setServerConflicts] = useState<any[]>([]);
  const [serverConflictBusyId, setServerConflictBusyId] = useState("");
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(false);
  const [backgroundSyncRegistered, setBackgroundSyncRegistered] = useState(false);
  const [backgroundSyncStatus, setBackgroundSyncStatus] = useState("unknown");
  const [lastAutoSyncAt, setLastAutoSyncAt] = useState("");
  const [localDbReady, setLocalDbReady] = useState(false);
  const [dbSecurityNote, setDbSecurityNote] = useState("");
  const [dbSecurityMode, setDbSecurityMode] = useState("unavailable");
  const [groceryForm, setGroceryForm] = useState({ title: "", item_name: "", estimated_price: "0" });
  const [groceryUpdateNote, setGroceryUpdateNote] = useState("");
  const [selectedGroceryItemId, setSelectedGroceryItemId] = useState("");
  const [groceryItemEdit, setGroceryItemEdit] = useState(itemEditDefaults());
  const [financeIntent, setFinanceIntent] = useState({ type: "EXPENSE", amount: "0", note: "", account_id: "", to_account_id: "", category_id: "" });
  const [mobileTab, setMobileTab] = useState<MobileTab>("home");
  const [financeSubFocus, setFinanceSubFocus] = useState<FinanceSub>("WALLETS");
  const [lifeModuleFocus, setLifeModuleFocus] = useState<string>("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [mobileSearch, setMobileSearch] = useState("");
  const [appLang, setAppLang] = useState<MobileLang>("bn");
  const [showSplash, setShowSplash] = useState(true);
  const finishSplash = useCallback(() => setShowSplash(false), []);
  const [appTheme, setAppTheme] = useState<MobileTheme>("light");

  function tm(key: string) {
    return tMobile(appLang, key);
  }

  async function changeAppLang(next: MobileLang) {
    setAppLang(next);
    await saveMobileLanguage(next);
  }

  async function changeAppTheme(next: MobileTheme) {
    setAppTheme(next);
    await saveMobileTheme(next);
  }

  function activeCurrency() {
    return families.find((family) => family.id === activeFamilyId)?.default_currency || "AED";
  }

  async function setupLocalDatabase() {
    try {
      await openMobileDatabase(LOCAL_DB_NAME);
      await runMigrations();
      await refreshPendingCounts();
      const security = getOfflineDbSecurityStatus();
      setDbSecurityMode(security.mode);
      setDbSecurityNote(security.note);
      setLocalDbReady(true);
      setMessage(security.note);
      setStatus(security.mode === "sqlcipher" || security.mode === "web_payload_aes" ? "ok" : "idle");
    } catch {
      setLocalDbReady(false);
      setStatus("failed");
      setMessage("Local SQLite setup failed.");
    }
  }

  async function getPendingSyncCount() {
    const db = await openMobileDatabase(LOCAL_DB_NAME);
    const row = await db.getFirstAsync<CountRow>("SELECT COUNT(*) AS count FROM sync_queue WHERE status = ?", ["pending"]);
    return row?.count ?? 0;
  }

  async function getPendingGrocerySyncCount() {
    const db = await openMobileDatabase(LOCAL_DB_NAME);
    const row = await db.getFirstAsync<CountRow>(
      `SELECT COUNT(*) AS count FROM sync_queue
       WHERE status = ?
         AND entity_type IN ('grocery','grocery_lists','grocery_items','grocery_vendors')`,
      ["pending"]
    );
    return row?.count ?? 0;
  }

  async function getPendingFinanceSyncCount() {
    const db = await openMobileDatabase(LOCAL_DB_NAME);
    const row = await db.getFirstAsync<CountRow>("SELECT COUNT(*) AS count FROM sync_queue WHERE status = ? AND entity_type = ?", ["pending", "finance_intent"]);
    return row?.count ?? 0;
  }

  async function getConflictSyncCount() {
    const db = await openMobileDatabase(LOCAL_DB_NAME);
    const row = await db.getFirstAsync<CountRow>("SELECT COUNT(*) AS count FROM sync_queue WHERE status = ?", ["conflict"]);
    return row?.count ?? 0;
  }

  async function getConflictRows() {
    const db = await openMobileDatabase(LOCAL_DB_NAME);
    return db.getAllAsync<SyncQueueRow>(
      "SELECT id, entity_id, action, payload, retry_count, last_error FROM sync_queue WHERE status = ? ORDER BY updated_at DESC LIMIT 5",
      ["conflict"]
    );
  }

  async function getFailedSyncCount() {
    const db = await openMobileDatabase(LOCAL_DB_NAME);
    const row = await db.getFirstAsync<CountRow>("SELECT COUNT(*) AS count FROM sync_queue WHERE status = ?", ["failed"]);
    return row?.count ?? 0;
  }

  async function refreshPendingCounts() {
    try {
      const [total, grocery, finance, conflicts, failed, rows] = await Promise.all([
        getPendingSyncCount(),
        getPendingGrocerySyncCount(),
        getPendingFinanceSyncCount(),
        getConflictSyncCount(),
        getFailedSyncCount(),
        getConflictRows(),
      ]);
      setPendingSyncCount(total);
      setPendingGrocerySyncCount(grocery);
      setPendingFinanceSyncCount(finance);
      setConflictSyncCount(conflicts);
      setFailedSyncCount(failed);
      setConflictRows(rows);
    } catch {
      // Tables may not exist yet / OEM SQLite flake � keep zeros
      return;
    }
    if (token && activeFamilyId) {
      try {
        const open = await fetchOpenConflicts(getApiBaseUrl(), token, activeFamilyId, tunnelHeaders());
        setServerConflicts(Array.isArray(open) ? open : []);
      } catch {
        /* keep previous serverConflicts */
      }
    } else {
      setServerConflicts([]);
    }
  }

  async function resolveServerConflict(conflict: any, strategy: "keep_server" | "keep_local" | "merge") {
    if (!token || !activeFamilyId || !conflict?.id) return;
    setServerConflictBusyId(conflict.id);
    try {
      let resolution_payload: Record<string, unknown> = {
        strategy,
        device_id: MOBILE_SYNC_DEVICE_ID,
      };
      if (strategy === "keep_server") {
        resolution_payload.chosen = conflict.remote_payload || {};
      } else if (strategy === "keep_local") {
        resolution_payload.chosen = conflict.local_payload || {};
      } else {
        resolution_payload.chosen = {
          ...(conflict.remote_payload || {}),
          ...(conflict.local_payload || {}),
        };
      }
      await apiPost(
        `/api/v1/families/${activeFamilyId}/sync/conflicts/${conflict.id}/resolve`,
        resolution_payload,
        token
      );
      setMessage(`Conflict resolved (${strategy})`);
      setStatus("ok");
      await refreshPendingCounts();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Conflict resolve failed");
      setStatus("failed");
    } finally {
      setServerConflictBusyId("");
    }
  }

  async function retryConflicts() {
    if (!token || !activeFamilyId) {
      Alert.alert("Offline Sync", "Login and select a family before retrying conflicts.");
      return;
    }
    setLoading(true);
    try {
      const lists: GroceryList[] = await apiGet(`/api/v1/grocery/lists/${activeFamilyId}`);
      const itemBatches = await Promise.all(
        lists.slice(0, 8).map((list) => apiGet(`/api/v1/grocery/lists/${activeFamilyId}/${list.id}/items`).catch(() => []))
      );
      const items = itemBatches.flat() as GroceryItem[];
      const db = await openMobileDatabase(LOCAL_DB_NAME);
      const rows = await getConflictRows();
      const now = new Date().toISOString();
      for (const row of rows) {
        const payload = parseConflictPayload(row);
        const serverItem = items.find((item) => item.id === payload.item_id);
        const nextPayload = JSON.stringify({
          ...payload,
          sync_version: serverItem?.sync_version ?? payload.sync_version,
          created_at: now,
          conflict_resolution: "RETRY_WITH_SERVER_VERSION",
        });
        await db.runAsync(
          "UPDATE sync_queue SET status = ?, payload = ?, retry_count = ?, last_error = NULL, updated_at = ? WHERE id = ?",
          ["pending", nextPayload, 0, now, row.id]
        );
      }
      setGroceryItems(items);
      await refreshPendingCounts();
      setMessage(`Re-queued ${rows.length} conflict(s) with refreshed server versions. Replay pending sync to apply.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Conflict retry failed");
      setStatus("failed");
    } finally {
      setLoading(false);
    }
  }

  async function retryFailedSync() {
    const db = await openMobileDatabase(LOCAL_DB_NAME);
    await db.runAsync("UPDATE sync_queue SET status = ?, retry_count = ?, updated_at = ? WHERE status = ?", [
      "pending",
      0,
      new Date().toISOString(),
      "failed",
    ]);
    await refreshPendingCounts();
    setMessage("Failed rows moved back to pending.");
  }

  async function clearConflicts() {
    const db = await openMobileDatabase(LOCAL_DB_NAME);
    await db.runAsync("UPDATE sync_queue SET status = ?, updated_at = ? WHERE status = ?", ["cancelled", new Date().toISOString(), "conflict"]);
    await refreshPendingCounts();
    setMessage("Conflict rows cleared locally. No server data was changed.");
  }

  async function keepServerForConflict(rowId: number) {
    const db = await openMobileDatabase(LOCAL_DB_NAME);
    await db.runAsync("UPDATE sync_queue SET status = ?, updated_at = ? WHERE id = ?", ["cancelled", new Date().toISOString(), rowId]);
    await refreshPendingCounts();
    await refreshAll();
    setMessage("Server version kept. Local conflicted change was cancelled.");
  }

  async function applyLocalOverServer(row: SyncQueueRow) {
    const payload = parseConflictPayload(row);
    const serverItem = groceryItems.find((item) => item.id === payload.item_id);
    if (!serverItem?.sync_version) {
      Alert.alert("Resolve conflict", "Refresh API data first so the latest server version is available.");
      return;
    }

    const db = await openMobileDatabase(LOCAL_DB_NAME);
    const nextPayload = JSON.stringify({
      ...payload,
      sync_version: serverItem.sync_version,
      created_at: new Date().toISOString(),
      conflict_resolution: "LOCAL_OVER_SERVER",
    });
    await db.runAsync("UPDATE sync_queue SET status = ?, payload = ?, updated_at = ? WHERE id = ?", ["pending", nextPayload, new Date().toISOString(), row.id]);
    await refreshPendingCounts();
    setMessage("Local version queued over latest server version. Replay pending sync to apply.");
  }

  async function queueOfflineAction(entityType: string, action: string, payload: object) {
    const { saveOfflineFirst } = await import("../database/offlineFirstWrite");
    const familyId = String(activeFamilyId || (payload as any)?.family_id || "");
    if (!familyId) {
      Alert.alert("Offline Sync", "Family required before queueing offline actions.");
      return;
    }
    await saveOfflineFirst({
      familyId,
      entityType,
      action,
      payload: payload as Record<string, unknown>,
      entityId: String((payload as any)?.entity_id || (payload as any)?.id || "") || null,
    });
    await refreshPendingCounts();
  }

  async function replayPendingSync(isAutomatic = false) {
    if (!token) {
      if (!isAutomatic) Alert.alert("Offline Sync", "Login required before replaying offline actions.");
      return;
    }
    if (isOfflineAccessToken(token)) {
      if (!isAutomatic) {
        Alert.alert("Offline mode", "Offline account-এ server sync নেই। Data phone SQLite-এই আছে.");
      }
      return;
    }

    if (!isAutomatic) setLoading(true);
    let serverConflictCount = 0;
    let synced = 0;
    let failed = 0;
    let conflicts = 0;

    try {
      const result = await syncManager.replayPending(token, activeFamilyId || "", 20);
      synced = result.synced;
      failed = result.failed;
      conflicts = result.conflicts;

      if (result.processed === 0 && activeFamilyId) {
        try {
          await syncManager.pull(token, activeFamilyId);
          const open = await fetchOpenConflicts(getApiBaseUrl(), token, activeFamilyId, tunnelHeaders());
          serverConflictCount = open.length;
        } catch {
          /* pull optional when empty queue */
        }
        if (!isAutomatic) {
          setMessage(
            serverConflictCount
              ? `No pending offline rows. Server open conflicts: ${serverConflictCount}. Finance intents remain review-only.`
              : "No pending offline rows (grocery/life/zakat/finance modules). Finance intents remain review-only."
          );
        }
      } else if (activeFamilyId) {
        try {
          const open = await fetchOpenConflicts(getApiBaseUrl(), token, activeFamilyId, tunnelHeaders());
          serverConflictCount = open.length;
        } catch {
          /* ignore */
        }
        try {
          const uploadResult = await flushMobileDocumentUploads({
            familyId: activeFamilyId,
            apiBaseUrl: getApiBaseUrl(),
            token,
            tunnelHeaders: tunnelHeaders(),
          });
          if (uploadResult.synced || uploadResult.failed) {
            synced += uploadResult.synced;
            failed += uploadResult.failed;
          }
        } catch {
          /* document flush optional */
        }
        setMessage(
          `${isAutomatic ? "Auto-sync" : "Offline sync replay"} via syncManager. Synced ${synced}, failed ${failed}, queue conflicts ${conflicts}, server conflicts ${serverConflictCount}.`
        );
        setStatus(failed || conflicts ? "failed" : "ok");
      }

      await refreshPendingCounts();
      // Manual sync may refresh UI; automatic must not — it was locking buttons via setLoading.
      if (result.processed > 0 && !isAutomatic) await refreshAll();
      if (isAutomatic) setLastAutoSyncAt(new Date().toISOString());
      void syncHook.refreshStatus();
    } finally {
      if (!isAutomatic) setLoading(false);
    }
  }

  function setAutoSyncPreference(enabled: boolean) {
    setAutoSyncEnabled(enabled);
    fastStorage.set(AUTO_SYNC_PREF_KEY, enabled ? "1" : "0");
  }

  async function restoreApiBaseUrl() {
    if (isFirebaseFirstMode()) {
      setRuntimeApiBaseUrl("");
      setApiBaseUrlInput("");
      return;
    }
    try {
      if (!(await SecureStore.isAvailableAsync())) {
        setApiBaseUrlInput(getApiBaseUrl());
        return;
      }
      const saved = await SecureStore.getItemAsync(API_BASE_URL_KEY);
      if (saved?.trim()) {
        const cleaned = normalizeApiBaseUrl(saved.trim());
        // Old installs defaulted to phone-localhost; that only works with USB adb reverse.
        const migrated =
          cleaned === "http://127.0.0.1:8000" || cleaned === "http://localhost:8000"
            ? DEFAULT_API_BASE_URL
            : cleaned;
        setRuntimeApiBaseUrl(migrated);
        setApiBaseUrlInput(getApiBaseUrl());
        if (migrated !== cleaned) {
          await SecureStore.setItemAsync(API_BASE_URL_KEY, migrated);
        }
      } else {
        setApiBaseUrlInput(getApiBaseUrl());
      }
    } catch {
      setApiBaseUrlInput(getApiBaseUrl());
    }
  }

  async function persistApiBaseUrl(nextUrl: string) {
    const cleaned = normalizeApiBaseUrl(nextUrl) || DEFAULT_API_BASE_URL;
    setRuntimeApiBaseUrl(cleaned);
    setApiBaseUrlInput(cleaned);
    try {
      if (await SecureStore.isAvailableAsync()) {
        await SecureStore.setItemAsync(API_BASE_URL_KEY, cleaned);
      }
    } catch {
      // Keep runtime URL even if SecureStore is unavailable.
    }
    return cleaned;
  }

  async function restoreSession() {
    try {
      if (!(await SecureStore.isAvailableAsync())) return;
      const raw = await SecureStore.getItemAsync(SESSION_KEY);
      if (!raw) return;
      const session = JSON.parse(raw) as StoredSession;
      if (!session.access_token) return;
      setToken(session.access_token);
      setRefreshToken(session.refresh_token || "");
      setEmail(session.email || session.user?.email || "");
      if (session.family_id) {
        setActiveFamilyId(session.family_id);
        const cached = await loadModuleSnapshot<{
          dashboard?: DashboardSummary;
          accounts?: Account[];
          transactions?: Transaction[];
          budgets?: Budget[];
          groceryLists?: GroceryList[];
          groceryItems?: GroceryItem[];
        }>(session.family_id, "home:finance").catch(() => null);
        if (cached) {
          if (cached.dashboard) setDashboard(cached.dashboard);
          if (cached.accounts) setAccounts(cached.accounts);
          if (cached.transactions) setTransactions(cached.transactions);
          if (cached.budgets) setBudgets(cached.budgets);
          if (cached.groceryLists) setGroceryLists(cached.groceryLists);
          if (cached.groceryItems) setGroceryItems(cached.groceryItems);
          setStatus("ok");
          setMessage("Offline cache ready. Syncing…");
        }
      }
      setStatus("ok");
      if (isOfflineAccessToken(session.access_token) || session.offline_mode) {
        setMessage("Offline session restored.");
        await refreshAll(session.access_token);
        return;
      }
      if (isCloudAccessToken(session.access_token) || isFirebaseFirstMode()) {
        const uid =
          String(session.access_token || "").replace(/^firebase\./, "") ||
          String(session.user?.uid || session.user?.id || "");
        const familyId = session.family_id || (await loadCloudFamilyId()) || "";
        if (familyId) {
          await persistCloudOnlyMode(true);
          await persistCloudFamilyId(familyId);
          setCloudApiContext({
            familyId,
            user: {
              uid: uid || undefined,
              email: session.email || session.user?.email,
              displayName: session.user?.full_name || session.user?.displayName,
            },
            onAfterWrite: async () => {
              if (!uid || !familyId) return;
              try {
                await pushCloudSnapshot({
                  uid,
                  familyId,
                  deviceLabel: "mobile",
                  email: session.email || session.user?.email,
                  displayName: session.user?.full_name,
                });
              } catch {
                /* ignore */
              }
            },
          });
        }
        setMessage("Cloud session restored.");
        await refreshAll(session.access_token);
        return;
      }
      if (!session.family_id) setMessage("Session restored from secure storage.");
      await refreshAll(session.access_token);
    } catch {
      setStatus("failed");
      setMessage("Session restore failed.");
    }
  }

  async function loadRememberedEmail() {
    try {
      if (!(await SecureStore.isAvailableAsync())) return;
      const saved = await SecureStore.getItemAsync(REMEMBER_EMAIL_KEY);
      if (saved?.trim()) setEmail(saved.trim());
    } catch {
      // Ignore SecureStore gaps on web preview.
    }
  }

  async function apiGet(path: string, authToken = token) {
    return svcGet(path, authToken || null);
  }

  async function apiPost(path: string, body: object, authToken = token) {
    return svcPost(path, body, authToken || null);
  }

  async function apiPatch(path: string, body: object, authToken = token) {
    return svcPatch(path, body, authToken || null);
  }

  async function apiPut(path: string, body: object, authToken = token) {
    return svcPut(path, body, authToken || null);
  }

  async function apiDelete(path: string, authToken = token) {
    return svcDelete(path, authToken || null);
  }

  async function persistSession(
    accessToken: string,
    nextRefreshToken: string,
    user?: any,
    emailOverride?: string,
    familyId?: string,
    offlineMode?: boolean
  ) {
    setToken(accessToken);
    setRefreshToken(nextRefreshToken || "");
    if (familyId) setActiveFamilyId(familyId);
    try {
      if (await SecureStore.isAvailableAsync()) {
        await SecureStore.setItemAsync(
          SESSION_KEY,
          JSON.stringify({
            access_token: accessToken,
            refresh_token: nextRefreshToken,
            email: (emailOverride ?? email).trim(),
            user,
            family_id: familyId || undefined,
            offline_mode: Boolean(offlineMode || isOfflineAccessToken(accessToken)),
          } satisfies StoredSession)
        );
      }
    } catch {
      // Web preview may not support SecureStore; keep session in memory.
    }
  }

  async function createOfflineAccountAuth() {
    const name = fullName.trim() || "Guardian";
    const fam = familyName.trim() || `${name} Family`;
    const mail = email.trim() || `offline-${Date.now()}@local.s4`;
    const pass = password || "offline";
    setLoading(true);
    try {
      await setupLocalDatabase();
      const created = await createOfflineAccount({
        fullName: name,
        email: mail,
        password: pass,
        familyName: fam,
        currency: familyCurrency.trim() || "BDT",
        timezone: familyTimezone.trim() || "Asia/Dhaka",
      });
      setEmail(mail);
      setFamilies([
        {
          id: created.family.id,
          name: created.family.name,
          default_currency: created.family.default_currency,
          timezone: created.family.timezone,
        },
      ]);
      setActiveFamilyId(created.family.id);
      await persistSession(
        created.access_token,
        created.refresh_token,
        created.user,
        mail,
        created.family.id,
        true
      );
      setStatus("ok");
      setMessage("Offline account ready. Server লাগে না — data phone-এ থাকবে.");
      await refreshAll(created.access_token);
      Alert.alert(
        "Offline mode",
        "Account + family তৈরি হয়েছে। Wallet/data add করতে পারবেন। Online sync হবে না যতক্ষণ server account না বানান।"
      );
    } catch (error) {
      setStatus("failed");
      const text = error instanceof Error ? error.message : "Offline create failed";
      setMessage(text);
      Alert.alert("Offline create", text);
    } finally {
      setLoading(false);
    }
  }

  async function testApiConnection() {
    setLoading(true);
    try {
      const url = await persistApiBaseUrl(apiBaseUrlInput);
      const probe = await probeApiHealth(url, 5000);
      if (probe.ok) {
        setStatus("ok");
        setMessage(`API OK: ${url}`);
        Alert.alert("Wi-Fi API", `Connected: ${url}`);
      } else {
        setStatus("failed");
        setMessage(`API fail: ${url} — ${probe.detail}`);
        Alert.alert(
          "Network Error",
          `ফোন API পাচ্ছে না.\n\nURL: ${url}\nError: ${probe.detail}\n\nSame Wi-Fi check করুন, Windows Firewall-এ port 8000 allow করুন, অথবা Offline account ব্যবহার করুন.`
        );
      }
    } finally {
      setLoading(false);
    }
  }

  async function ensureAuthSession() {
    try {
      const data = await apiPost("/api/v1/auth/login", { email: email.trim(), password }, "");
      return {
        access: data.access_token || "",
        refresh: data.refresh_token || "",
        user: data.user,
      };
    } catch {
      if (!fullName.trim()) throw new Error(tm("authFieldsRequired"));
      try {
        await apiPost(
          "/api/v1/auth/register",
          {
            full_name: fullName.trim(),
            email: email.trim(),
            phone: phone.trim() || null,
            password,
          },
          ""
        );
      } catch (regError) {
        const text = regError instanceof Error ? regError.message : "";
        if (!/already|exist|409/i.test(text)) throw regError;
      }
      const data = await apiPost("/api/v1/auth/login", { email: email.trim(), password }, "");
      return {
        access: data.access_token || "",
        refresh: data.refresh_token || "",
        user: data.user,
      };
    }
  }

  async function activateCloudSession(user: any, familyId: string, familyName = "") {
    const fid = String(familyId || "");
    const cloudTok = cloudTokenFor(user.uid);
    await persistCloudOnlyMode(true);
    await persistCloudFamilyId(fid);
    setCloudApiContext({
      familyId: fid,
      user: {
        uid: user.uid,
        email: user.email || undefined,
        displayName: user.displayName || undefined,
      },
      onAfterWrite: async () => {
        if (requireEmailVerification() && !isFirebaseEmailVerified(user)) return;
        if (!fid || !user?.uid) return;
        try {
          await pushCloudSnapshot({
            uid: user.uid,
            familyId: fid,
            deviceLabel: "mobile",
            email: user.email,
            displayName: user.displayName,
          });
        } catch {
          /* ignore offline push */
        }
      },
    });

    if (fid && isFirebaseEmailVerified(user) !== false) {
      try {
        const restored = await pullCloudSnapshot(user.uid);
        if (restored?.familyId) {
          await persistCloudFamilyId(restored.familyId);
          setActiveFamilyId(String(restored.familyId));
        }
      } catch {
        /* offline / unverified */
      }
    }

    let resolvedName = familyName;
    let currency = "BDT";
    let timezone = "Asia/Dhaka";
    if (fid) {
      try {
        const profileRow = await loadOfflineSnapshot(fid, "system", "familyProfile");
        const profile = profileRow?.data || {};
        resolvedName = String(profile.name || familyName || "Family");
        currency = String(profile.default_currency || profile.currency || "BDT");
        timezone = String(profile.timezone || "Asia/Dhaka");
      } catch {
        /* keep defaults */
      }
      setFamilies([
        {
          id: fid,
          name: resolvedName || "Family",
          default_currency: currency,
          timezone,
        },
      ]);
      setActiveFamilyId(fid);
    }

    await persistSession(
      cloudTok,
      "",
      {
        id: user.uid,
        uid: user.uid,
        email: user.email,
        full_name: user.displayName || fullName || user.email,
        is_email_verified: isFirebaseEmailVerified(user),
      },
      user.email || email,
      fid || undefined,
      false
    );
    setFirebaseUser(user);
    if (fid && isFirebaseEmailVerified(user)) {
      void enableMobilePushNotifications({ familyId: fid, deviceLabel: "mobile" });
    }
    return cloudTok;
  }

  async function loginWithGoogle() {
    if (!isFirebaseFirstMode()) {
      Alert.alert("Google", "Firebase-first mode required");
      return;
    }
    setLoading(true);
    try {
      const user = await firebaseSignInGoogle();
      await ensureUserProfile(user.uid, user);
      let familyId = "";
      try {
        familyId = await resolveAndBindUserFamily({
          uid: user.uid,
          email: user.email || null,
          displayName: user.displayName || null,
        });
      } catch {
        const profile = await getUserFamilyProfile(user.uid);
        familyId = String(profile?.family_id || "");
        try {
          const pulled = await pullCloudSnapshot(user.uid);
          if (pulled?.familyId) familyId = String(pulled.familyId);
        } catch {
          /* ignore */
        }
      }
      if (!familyId) {
        await activateCloudSession(user, "");
        setAuthMode("create");
        setFamilySetupMode("create");
        setStatus("ok");
        setMessage("Google signed in — create or join a family.");
        return;
      }
      try {
        await bindCloudFamilyIdentity({
          uid: user.uid,
          familyId,
          email: user.email || null,
          displayName: user.displayName || null,
          role: "MEMBER",
        });
      } catch {
        /* ignore */
      }
      const nextToken = await activateCloudSession(user, familyId);
      setStatus("ok");
      setMessage("Logged in with Google (Firebase).");
      await refreshAll(nextToken);
    } catch (error) {
      setStatus("failed");
      const text = formatFirebaseAuthError(error, appLang === "bn" ? "bn" : "en");
      setMessage(text);
      Alert.alert("Google", text);
    } finally {
      setLoading(false);
    }
  }

  async function login() {
    if (!email.trim() || !password) {
      setMessage("Email and password required.");
      setStatus("failed");
      Alert.alert(tm("login"), tm("loginRequired"));
      return;
    }
    setLoading(true);
    try {
      if (isFirebaseFirstMode()) {
        const user = await firebaseSignInEmail(email.trim(), password);
        await ensureUserProfile(user.uid, user);
        let familyId = "";
        try {
          familyId = await resolveAndBindUserFamily({
            uid: user.uid,
            email: user.email || email.trim(),
            displayName: user.displayName || null,
          });
        } catch {
          const profile = await getUserFamilyProfile(user.uid);
          familyId = String(profile?.family_id || "");
          try {
            const pulled = await pullCloudSnapshot(user.uid);
            if (pulled?.familyId) familyId = String(pulled.familyId);
          } catch {
            /* local only until verified / online */
          }
        }
        if (!familyId) {
          setStatus("failed");
          setMessage("No family linked. Create or join a family.");
          await activateCloudSession(user, "");
          setAuthMode("create");
          setFamilySetupMode("create");
          return;
        }
        try {
          await bindCloudFamilyIdentity({
            uid: user.uid,
            familyId,
            email: user.email || email.trim(),
            displayName: user.displayName || null,
            role: "MEMBER",
          });
        } catch {
          /* ignore */
        }
        const nextToken = await activateCloudSession(user, familyId);
        setStatus("ok");
        setMessage(
          requireEmailVerification() && !isFirebaseEmailVerified(user)
            ? "Logged in — verify email for cloud sync."
            : "Logged in (Firebase cloud)."
        );
        if (rememberDevice) {
          try {
            if (await SecureStore.isAvailableAsync()) {
              await SecureStore.setItemAsync(REMEMBER_EMAIL_KEY, email.trim());
            }
          } catch {
            /* ignore */
          }
        }
        await refreshAll(nextToken);
        return;
      }

      await persistApiBaseUrl(apiBaseUrlInput);
      const data = await apiPost("/api/v1/auth/login", { email: email.trim(), password }, "");
      const nextToken = data.access_token || "";
      if (!nextToken) throw new Error("Login succeeded but no access token returned");
      setStatus("ok");
      setMessage("Logged in. Loading family finance data.");
      await persistSession(nextToken, data.refresh_token || "", data.user);
      if (rememberDevice) {
        try {
          if (await SecureStore.isAvailableAsync()) {
            await SecureStore.setItemAsync(REMEMBER_EMAIL_KEY, email.trim());
          }
        } catch {
          // Keep login flow even if remember-email write fails.
        }
      }
      await refreshAll(nextToken);
    } catch (error) {
      setStatus("failed");
      const text =
        isFirebaseFirstMode()
          ? formatFirebaseAuthError(error, appLang === "bn" ? "bn" : "en")
          : error instanceof Error
            ? error.message
            : "Login failed.";
      setMessage(text);
      Alert.alert(tm("loginFailed"), text);
    } finally {
      setLoading(false);
    }
  }

  async function createFamilyAuth() {
    if (!fullName.trim() || !email.trim() || !password || !familyName.trim()) {
      setMessage(tm("authFieldsRequired"));
      setStatus("failed");
      Alert.alert(tm("authCreate"), tm("authFieldsRequired"));
      return;
    }
    if (passwordStrength(password) < 1) {
      const hint = tm("passwordRulesHint") || "Password must be at least 8 characters.";
      setMessage(hint);
      setStatus("failed");
      Alert.alert(tm("authCreate"), hint);
      return;
    }
    setLoading(true);
    try {
      if (isFirebaseFirstMode()) {
        const created = await createCloudFamilyAccount({
          email: email.trim(),
          password,
          fullName: fullName.trim(),
          familyName: familyName.trim(),
          currency: familyCurrency.trim() || "BDT",
          timezone: familyTimezone.trim() || "Asia/Dhaka",
          ownerRelation,
          deviceLabel: "mobile",
        });
        const nextToken = await activateCloudSession(
          created.user,
          created.familyId,
          familyName.trim()
        );
        setStatus("ok");
        if (created.existing) {
          setMessage("Existing cloud family restored.");
        } else if (created.verificationSent) {
          setMessage("Family created — check email to verify for cloud sync.");
        } else {
          setMessage(tm("familyCreatedOk"));
        }
        try {
          await refreshAll(nextToken);
        } catch (refreshError) {
          const refreshText =
            refreshError instanceof Error ? refreshError.message : "Family created; dashboard refresh failed";
          setMessage(`${tm("familyCreatedOk")} (${refreshText})`);
        }
        return;
      }

      const url = await persistApiBaseUrl(apiBaseUrlInput);
      const probe = await probeApiHealth(url, 5000);
      if (!probe.ok) {
        setStatus("failed");
        setMessage(`Network Error: ${url}`);
        Alert.alert(
          "Network Error",
          `Server পাওয়া যাচ্ছে না.\n\nURL: ${url}\n${probe.detail}\n\nSame Wi-Fi + Firewall 8000 check করুন।\nঅথবা Offline account তৈরি করুন (server লাগে না).`,
          [
            { text: "Offline create", onPress: () => void createOfflineAccountAuth() },
            { text: "OK" },
          ]
        );
        return;
      }
      const session = await ensureAuthSession();
      if (!session.access) throw new Error("No access token");
      const created = await apiPost(
        "/api/v1/families",
        {
          name: familyName.trim(),
          default_currency: familyCurrency.trim() || "BDT",
          timezone: familyTimezone.trim() || "Asia/Dhaka",
          relationship_type: ownerRelation,
        },
        session.access
      );
      const createdFamilyId =
        created?.family_id || created?.family?.id || created?.id || "";
      setStatus("ok");
      setMessage(tm("familyCreatedOk"));
      await persistSession(session.access, session.refresh, session.user, email.trim(), createdFamilyId || undefined, false);
      if (createdFamilyId) setActiveFamilyId(String(createdFamilyId));
      try {
        await refreshAll(session.access);
      } catch (refreshError) {
        // Family already created — keep the session even if dashboard hydrate fails.
        const refreshText =
          refreshError instanceof Error ? refreshError.message : "Family created; dashboard refresh failed";
        setMessage(`${tm("familyCreatedOk")} (${refreshText})`);
      }
    } catch (error) {
      setStatus("failed");
      const text =
        isFirebaseFirstMode()
          ? formatFirebaseAuthError(error, appLang === "bn" ? "bn" : "en")
          : error instanceof Error
            ? error.message
            : "Create family failed";
      setMessage(text);
      Alert.alert(tm("authCreate"), text);
    } finally {
      setLoading(false);
    }
  }

  async function createFamilyForSession() {
    if (!familyName.trim()) {
      setMessage(tm("authFieldsRequired"));
      setStatus("failed");
      Alert.alert(tm("authCreate"), tm("familyName") + " required");
      return;
    }
    if (!token) {
      await createFamilyAuth();
      return;
    }
    setLoading(true);
    try {
      if (isFirebaseFirstMode() && isCloudAccessToken(token)) {
        const created = await createCloudFamilyAccount({
          email: email.trim(),
          password,
          fullName: fullName.trim() || email.trim(),
          familyName: familyName.trim(),
          currency: familyCurrency.trim() || "BDT",
          timezone: familyTimezone.trim() || "Asia/Dhaka",
          ownerRelation,
          deviceLabel: "mobile",
        });
        const nextToken = await activateCloudSession(
          created.user,
          created.familyId,
          familyName.trim()
        );
        setStatus("ok");
        setMessage(tm("familyCreatedOk"));
        await refreshAll(nextToken);
        return;
      }
      const created = await apiPost(
        "/api/v1/families",
        {
          name: familyName.trim(),
          default_currency: familyCurrency.trim() || "BDT",
          timezone: familyTimezone.trim() || "Asia/Dhaka",
          relationship_type: ownerRelation,
        },
        token
      );
      const createdFamilyId =
        created?.family_id || created?.family?.id || created?.id || "";
      if (createdFamilyId) setActiveFamilyId(String(createdFamilyId));
      setStatus("ok");
      setMessage(tm("familyCreatedOk"));
      await refreshAll(token);
    } catch (error) {
      setStatus("failed");
      const text = error instanceof Error ? error.message : "Family create failed";
      setMessage(text);
      Alert.alert(tm("authCreate"), text);
    } finally {
      setLoading(false);
    }
  }

  async function joinFamilyForSession() {
    if (!inviteCode.trim()) {
      setMessage(tm("authFieldsRequired"));
      setStatus("failed");
      return;
    }
    if (needsRelationshipNote(joinRelation) && !joinNote.trim()) {
      setMessage(tm("relationshipNoteRequired") || "Relationship note required");
      setStatus("failed");
      return;
    }
    if (needsLinkedMember(joinRelation) && !joinLinkedMemberId.trim()) {
      setMessage(tm("linkedMemberRequired") || "Linked member id required");
      setStatus("failed");
      return;
    }
    if (!token) {
      await joinFamilyAuth();
      return;
    }
    setLoading(true);
    try {
      if (isFirebaseFirstMode() && isCloudAccessToken(token)) {
        const auth = getFirebaseAuth();
        const user = auth?.currentUser;
        if (!user) throw new Error("Firebase session missing — login again");
        const result = await joinFamilyByInviteCode({
          code: inviteCode.trim().toUpperCase(),
          uid: user.uid,
          email: user.email || email.trim(),
          displayName: user.displayName || fullName.trim() || email.trim(),
          relationshipType: joinRelation,
        });
        const nextToken = await activateCloudSession(user, result.familyId);
        setStatus("ok");
        setMessage(tm("joinRequestedOk"));
        await refreshAll(nextToken);
        return;
      }
      await apiPost(
        "/api/v1/invites/join",
        buildJoinInvitePayload({
          invite_code: inviteCode.trim().toUpperCase(),
          relationship_type: joinRelation,
          relationship_serial: joinSerial,
          serial_label: joinSerialLabel,
          linked_member_id: joinLinkedMemberId,
          relationship_note: joinNote,
        }),
        token
      );
      setStatus("ok");
      setMessage(tm("joinRequestedOk"));
      await refreshAll(token);
    } catch (error) {
      setStatus("failed");
      setMessage(error instanceof Error ? error.message : "Join failed");
    } finally {
      setLoading(false);
    }
  }

  async function joinFamilyAuth() {
    if (!email.trim() || !password || !inviteCode.trim()) {
      setMessage(tm("authFieldsRequired"));
      setStatus("failed");
      return;
    }
    if (needsRelationshipNote(joinRelation) && !joinNote.trim()) {
      setMessage(tm("relationshipNoteRequired") || "Relationship note required");
      setStatus("failed");
      return;
    }
    if (needsLinkedMember(joinRelation) && !joinLinkedMemberId.trim()) {
      setMessage(tm("linkedMemberRequired") || "Linked member id required");
      setStatus("failed");
      return;
    }
    setLoading(true);
    try {
      if (isFirebaseFirstMode()) {
        let user;
        try {
          user = await firebaseSignInEmail(email.trim(), password);
        } catch (signInErr: any) {
          const code = String(signInErr?.code || "");
          if (code.includes("user-not-found") || code.includes("invalid-credential")) {
            const registered = await firebaseRegisterEmail(
              email.trim(),
              password,
              fullName.trim() || email.trim()
            );
            user = registered.user;
          } else {
            throw signInErr;
          }
        }
        await ensureUserProfile(user.uid, user);
        const result = await joinFamilyByInviteCode({
          code: inviteCode.trim().toUpperCase(),
          uid: user.uid,
          email: user.email || email.trim(),
          displayName: user.displayName || fullName.trim() || email.trim(),
          relationshipType: joinRelation,
        });
        const nextToken = await activateCloudSession(user, result.familyId);
        setStatus("ok");
        setMessage(tm("joinRequestedOk"));
        await refreshAll(nextToken);
        setAuthMode("login");
        return;
      }

      await persistApiBaseUrl(apiBaseUrlInput);
      const session = await ensureAuthSession();
      if (!session.access) throw new Error("No access token");
      await apiPost(
        "/api/v1/invites/join",
        buildJoinInvitePayload({
          invite_code: inviteCode.trim().toUpperCase(),
          relationship_type: joinRelation,
          relationship_serial: joinSerial,
          serial_label: joinSerialLabel,
          linked_member_id: joinLinkedMemberId,
          relationship_note: joinNote,
        }),
        session.access
      );
      setStatus("ok");
      setMessage(tm("joinRequestedOk"));
      await persistSession(session.access, session.refresh, session.user);
      await refreshAll(session.access);
      setAuthMode("login");
    } catch (error) {
      setStatus("failed");
      setMessage(
        isFirebaseFirstMode()
          ? formatFirebaseAuthError(error, appLang === "bn" ? "bn" : "en")
          : error instanceof Error
            ? error.message
            : "Join failed"
      );
    } finally {
      setLoading(false);
    }
  }

  async function forgotPasswordAuth() {
    if (!email.trim()) {
      setMessage(tm("authFieldsRequired"));
      setStatus("failed");
      return;
    }
    setLoading(true);
    try {
      if (isFirebaseFirstMode()) {
        await firebaseSendPasswordReset(email.trim());
        setStatus("ok");
        setMessage(tm("resetLinkSent"));
        setAuthMode("login");
        return;
      }
      await persistApiBaseUrl(apiBaseUrlInput);
      await apiPost("/api/v1/auth/forgot-password", { email: email.trim() }, "");
      setStatus("ok");
      setMessage(tm("resetLinkSent"));
      setAuthMode("login");
    } catch (error) {
      setStatus("failed");
      setMessage(
        isFirebaseFirstMode()
          ? formatFirebaseAuthError(error, appLang === "bn" ? "bn" : "en")
          : error instanceof Error
            ? error.message
            : "Reset failed"
      );
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    if (isFirebaseFirstMode() || isCloudAccessToken(token)) {
      try {
        await firebaseSignOut();
      } catch {
        /* ignore */
      }
      await clearCloudSession();
      setCloudApiContext({ familyId: "", user: null, onAfterWrite: null });
    }
    setToken("");
    setRefreshToken("");
    setFamilies([]);
    setActiveFamilyId("");
    setDashboard(null);
    setAccounts([]);
    setCategories([]);
    setTransactions([]);
    setBudgets([]);
    setGroceryLists([]);
    setGroceryItems([]);
    if (await SecureStore.isAvailableAsync()) await SecureStore.deleteItemAsync(SESSION_KEY);
    setMessage("Logged out.");
  }

  async function refreshAll(authToken = token) {
    if (!authToken) return;
    setLoading(true);
    try {
      if (isOfflineAccessToken(authToken)) {
        const offlineFamily = await loadOfflineFamily();
        const familyId = activeFamilyId || offlineFamily?.id || "";
        if (offlineFamily) {
          setFamilies([
            {
              id: offlineFamily.id,
              name: offlineFamily.name,
              default_currency: offlineFamily.default_currency,
              timezone: offlineFamily.timezone,
            },
          ]);
        }
        setActiveFamilyId(familyId);
        if (familyId) {
          const { listLocal } = await import("../database/localRepository");
          const [localAcc, localTx, localBud, localCat] = await Promise.all([
            listLocal("accounts", familyId, 100),
            listLocal("transactions", familyId, 100),
            listLocal("budgets", familyId, 100),
            listLocal("categories", familyId, 100),
          ]);
          const accountRows = (localAcc || []).map((row: any) => ({
            id: String(row.server_id || row.id),
            name: String(row.name || "Wallet"),
            account_type: String(row.account_type || "CASH"),
            currency: String(row.currency || offlineFamily?.default_currency || "BDT"),
            current_balance: String(row.current_balance ?? row.opening_balance ?? "0"),
          }));
          const txRows = (localTx || []).map((row: any) => ({
            id: String(row.server_id || row.id),
            transaction_type: String(row.transaction_type || "EXPENSE"),
            amount: String(row.amount || "0"),
            currency: String(row.currency || "BDT"),
            description: row.description ? String(row.description) : undefined,
            created_at: row.created_at ? String(row.created_at) : undefined,
          }));
          setAccounts(accountRows);
          setTransactions(txRows);
          setBudgets((localBud || []) as Budget[]);
          setCategories(
            (localCat || []).map((row: any) => ({
              id: String(row.server_id || row.id),
              name_en: String(row.name_en || row.name || "Category"),
              name_bn: row.name_bn ? String(row.name_bn) : undefined,
              category_type: String(row.category_type || "EXPENSE"),
            }))
          );
          const bal = accountRows.reduce((sum, a) => sum + (Number(a.current_balance) || 0), 0);
          setDashboard({
            total_wallet_balance: String(bal),
            wallet_count: accountRows.length,
            total_income: "0",
            total_expense: "0",
            net_income_expense: "0",
          });
          await saveModuleSnapshot(familyId, "home:finance", {
            dashboard: {
              total_wallet_balance: String(bal),
              wallet_count: accountRows.length,
            },
            accounts: accountRows,
            transactions: txRows,
            budgets: localBud || [],
          }).catch(() => undefined);
        }
        setStatus("ok");
        setMessage("Offline mode — data from phone SQLite.");
        return;
      }
      if (isCloudAccessToken(authToken)) {
        const uid = String(authToken).replace(/^firebase\./, "");
        try {
          const restored = await pullCloudSnapshot(uid);
          if (restored?.familyId) {
            setActiveFamilyId(String(restored.familyId));
            await persistCloudFamilyId(String(restored.familyId));
            setCloudApiContext({ familyId: String(restored.familyId) });
          }
        } catch {
          /* use local SQLite cache */
        }
      }
      const familyResponse = await apiGet("/api/v1/families", authToken);
      const list: Family[] = Array.isArray(familyResponse) ? familyResponse : familyResponse.families || [];
      setFamilies(list);
      const familyId = activeFamilyId || list[0]?.id || "";
      setActiveFamilyId(familyId);
      if (familyId) {
        const dashboardData = await apiGet(`/api/v1/dashboard/${familyId}`, authToken);
        const summary = dashboardData.summary || dashboardData;
        const dash = {
          ...summary,
          loan_taken_remaining: dashboardData.loans?.loan_taken_remaining,
          loan_given_remaining: dashboardData.loans?.loan_given_remaining,
          savings_current: dashboardData.savings?.total_current_amount,
        };
        setDashboard(dash);
        const accountRowsRaw = await apiGet(`/api/v1/accounts/family/${familyId}`, authToken);
        let accountRows = Array.isArray(accountRowsRaw) ? accountRowsRaw : [];
        const txRaw = await apiGet(`/api/v1/transactions/${familyId}`, authToken);
        let txRows = Array.isArray(txRaw) ? txRaw : txRaw?.transactions || [];
        try {
          const { listLocal } = await import("../database/localRepository");
          const { mergeApiAccounts, mergeApiTransactions } = await import("../lib/mergeLocalFinance");
          const [localAcc, localTx] = await Promise.all([
            listLocal("accounts", familyId, 100),
            listLocal("transactions", familyId, 100),
          ]);
          accountRows = mergeApiAccounts(accountRows, (localAcc || []) as Record<string, unknown>[]);
          txRows = mergeApiTransactions(txRows, (localTx || []) as Record<string, unknown>[]);
        } catch {
          /* local merge optional */
        }
        setAccounts(accountRows);
        setCategories(await apiGet(`/api/v1/categories/family/${familyId}`, authToken));
        setTransactions(txRows);
        const budgetRaw = await apiGet(`/api/v1/budgets/${familyId}`, authToken);
        const budgetRows = Array.isArray(budgetRaw) ? budgetRaw : budgetRaw?.budgets || [];
        setBudgets(budgetRows);

        const grocery = await apiGet(`/api/v1/grocery/lists/${familyId}`, authToken);
        setGroceryLists(grocery);
        const firstListId = grocery[0]?.id;
        const items: GroceryItem[] = firstListId ? await apiGet(`/api/v1/grocery/lists/${familyId}/${firstListId}/items`, authToken) : [];
        setGroceryItems(items);
        const nextItem = items.find((item) => item.id === selectedGroceryItemId) || items[0];
        setSelectedGroceryItemId(nextItem?.id || "");
        setGroceryItemEdit(itemEditDefaults(nextItem));

        await saveModuleSnapshot(familyId, "home:finance", {
          dashboard: dash,
          accounts: accountRows,
          transactions: txRows,
          budgets: budgetRows,
          groceryLists: grocery,
          groceryItems: items,
        }).catch(() => undefined);
        try {
          if (await SecureStore.isAvailableAsync()) {
            const raw = await SecureStore.getItemAsync(SESSION_KEY);
            if (raw) {
              const session = JSON.parse(raw) as StoredSession;
              await SecureStore.setItemAsync(
                SESSION_KEY,
                JSON.stringify({ ...session, family_id: familyId })
              );
            }
          }
        } catch {
          // ignore session patch failures
        }
      }
      setStatus("ok");
      setMessage("Mobile dashboard synced from API.");
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Refresh failed. Offline queue remains available.";
      const familyId = activeFamilyId;
      if (familyId && /failed to fetch|network|offline|connect/i.test(msg)) {
        const cached = await loadModuleSnapshot<{
          dashboard?: DashboardSummary;
          accounts?: Account[];
          transactions?: Transaction[];
          budgets?: Budget[];
          groceryLists?: GroceryList[];
          groceryItems?: GroceryItem[];
        }>(familyId, "home:finance").catch(() => null);
        if (cached) {
          if (cached.dashboard) setDashboard(cached.dashboard);
          if (cached.accounts) setAccounts(cached.accounts);
          if (cached.transactions) setTransactions(cached.transactions);
          if (cached.budgets) setBudgets(cached.budgets);
          if (cached.groceryLists) setGroceryLists(cached.groceryLists);
          if (cached.groceryItems) setGroceryItems(cached.groceryItems);
          setStatus("ok");
          setMessage("Offline cache loaded. Sync when online.");
          setLoading(false);
          return;
        }
      }
      setStatus("failed");
      setMessage(msg);
    } finally {
      setLoading(false);
    }
  }

  async function createOfflineGroceryDraft() {
    if (!activeFamilyId || !groceryForm.title.trim()) {
      Alert.alert("Offline grocery", "Family and list title required.");
      return;
    }
    const payload = { family_id: activeFamilyId, ...groceryForm, created_at: new Date().toISOString() };
    const db = await openMobileDatabase(LOCAL_DB_NAME);
    await db.runAsync(
      "INSERT OR REPLACE INTO mobile_grocery_drafts (id, family_id, title, item_name, estimated_price, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [`draft-${payload.created_at.replace(/\D/g, "")}`, activeFamilyId, groceryForm.title, groceryForm.item_name, groceryForm.estimated_price, payload.created_at]
    );
    await queueOfflineAction("grocery", "CREATE_DRAFT", payload);
    setGroceryForm({ title: "", item_name: "", estimated_price: "0" });
    setMessage("Offline grocery draft queued for sync.");
  }

  async function queueSelectedGroceryItemUpdate() {
    const selectedItem = groceryItems.find((item) => item.id === selectedGroceryItemId) || groceryItems[0];
    if (!activeFamilyId || !selectedItem) {
      Alert.alert("Grocery update", "No synced grocery item is available to update.");
      return;
    }
    const createdAt = new Date().toISOString();
    await queueOfflineAction("grocery", "UPDATE_ITEM", {
      family_id: activeFamilyId,
      item_id: selectedItem.id,
      name: groceryItemEdit.name || selectedItem.name,
      category: groceryItemEdit.category || "GENERAL",
      quantity: groceryItemEdit.quantity || "1",
      unit: groceryItemEdit.unit || "pcs",
      estimated_price: groceryItemEdit.estimated_price || "0",
      actual_price: groceryItemEdit.actual_price || "0",
      note: groceryUpdateNote || groceryItemEdit.note || "Mobile offline update",
      sync_version: selectedItem.sync_version,
      created_at: createdAt,
    });
    setGroceryUpdateNote("");
    setMessage("Grocery item update queued with conflict-version check.");
  }

  async function queueSelectedGroceryItemBought() {
    const selectedItem = groceryItems.find((item) => item.id === selectedGroceryItemId) || groceryItems[0];
    if (!activeFamilyId || !selectedItem) {
      Alert.alert("Grocery buy", "No synced grocery item is available to mark bought.");
      return;
    }
    await queueOfflineAction("grocery", "MARK_ITEM_BOUGHT", {
      family_id: activeFamilyId,
      item_id: selectedItem.id,
      actual_price: selectedItem.actual_price || selectedItem.estimated_price || "0",
      sync_version: selectedItem.sync_version,
      created_at: new Date().toISOString(),
    });
    setMessage("Grocery item buy action queued with conflict-version check.");
  }

  async function queueFinanceIntent() {
    if (!activeFamilyId || !financeIntent.note.trim() || !financeIntent.account_id) {
      Alert.alert("Finance intent", "Family, wallet, and note required.");
      return;
    }
    if (["EXPENSE", "INCOME"].includes(financeIntent.type) && !financeIntent.category_id) {
      Alert.alert("Finance intent", "Category required for income/expense replay.");
      return;
    }
    if (financeIntent.type === "TRANSFER" && !financeIntent.to_account_id) {
      Alert.alert("Finance intent", "Destination wallet required for transfer replay.");
      return;
    }
    const createdAt = new Date().toISOString();
    const db = await openMobileDatabase(LOCAL_DB_NAME);
    const id = `finance-${createdAt.replace(/\D/g, "")}`;
    const payload = { family_id: activeFamilyId, ...financeIntent, created_at: createdAt };
    await db.runAsync(
      "INSERT OR REPLACE INTO mobile_finance_intents (id, family_id, intent_type, amount, note, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [id, activeFamilyId, financeIntent.type, financeIntent.amount, financeIntent.note, createdAt]
    );
    await queueOfflineAction("finance_intent", "REVIEW_REQUIRED", payload);
    setFinanceIntent((current) => ({ ...current, amount: "0", note: "" }));
    setMessage("Finance intent queued. Review + replay posts via sync and updates wallet balances online.");
  }

  async function replayReviewedFinanceIntents() {
    if (!token) {
      Alert.alert("Finance replay", "Login required before replaying finance intents.");
      return;
    }

    setLoading(true);
    const db = await openMobileDatabase(LOCAL_DB_NAME);
    const rows = await db.getAllAsync<SyncQueueRow>(
      "SELECT id, entity_id, action, payload, retry_count, last_error FROM sync_queue WHERE status = ? AND entity_type = ? ORDER BY created_at ASC LIMIT 10",
      ["pending", "finance_intent"]
    );
    let posted = 0;
    let failed = 0;

    for (const row of rows) {
      const now = new Date().toISOString();
      try {
        const payload = JSON.parse(row.payload) as { family_id: string };
        await db.runAsync("UPDATE sync_queue SET status = ?, updated_at = ? WHERE id = ?", ["syncing", now, row.id]);
        const change = mapFinanceIntentToChange(row);
        const pushResult = await pushPhase10bChanges(
          getApiBaseUrl(),
          token,
          payload.family_id,
          [change],
          tunnelHeaders(),
          MOBILE_SYNC_DEVICE_ID
        );
        if (pushResultHasConflict(pushResult)) throw new Error("SYNC_CONFLICT");
        const failMsg = pushResultFailed(pushResult);
        if (failMsg) throw new Error(failMsg);

        await db.runAsync("UPDATE sync_queue SET status = ?, updated_at = ?, synced_at = ?, last_error = NULL WHERE id = ?", ["done", now, now, row.id]);
        posted += 1;
      } catch (error) {
        failed += 1;
        await db.runAsync("UPDATE sync_queue SET status = ?, retry_count = ?, last_error = ?, updated_at = ?, next_retry_at = ? WHERE id = ?", [
          nextSyncFailureStatus(error instanceof Error ? error.message : "Finance replay failed", row.retry_count),
          row.retry_count + 1,
          error instanceof Error ? error.message : "Finance replay failed",
          now,
          nextRetryAtIso(row.retry_count),
          row.id,
        ]);
      }
    }

    await refreshPendingCounts();
    await refreshAll();
    setLoading(false);
    setStatus(failed ? "failed" : "ok");
    setMessage(`Finance replay via Phase 10B. Posted ${posted}, failed ${failed}. Wallet balances update on successful apply.`);
  }

  async function refreshBackgroundSyncStatus() {
    const taskAvailable = await TaskManager.isAvailableAsync().catch(() => false);
    const serviceStatus = await BackgroundTask.getStatusAsync().catch(() => null);
    const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK).catch(() => false);
    setBackgroundSyncRegistered(isRegistered);
    setBackgroundSyncStatus(taskAvailable && serviceStatus === BackgroundTask.BackgroundTaskStatus.Available ? "available" : "restricted");
  }

  async function registerBackgroundSync() {
    try {
      await BackgroundTask.registerTaskAsync(BACKGROUND_SYNC_TASK, { minimumInterval: BACKGROUND_SYNC_INTERVAL_MINUTES });
      await refreshBackgroundSyncStatus();
      setMessage("OS background sync registered. The phone decides exact run time based on network and battery.");
    } catch (error) {
      setStatus("failed");
      setMessage(error instanceof Error ? error.message : "Background sync registration failed.");
    }
  }

  async function unregisterBackgroundSync() {
    try {
      await BackgroundTask.unregisterTaskAsync(BACKGROUND_SYNC_TASK);
      await refreshBackgroundSyncStatus();
      setMessage("OS background sync disabled.");
    } catch (error) {
      setStatus("failed");
      setMessage(error instanceof Error ? error.message : "Background sync unregister failed.");
    }
  }

  async function triggerBackgroundSyncTest() {
    try {
      await BackgroundTask.triggerTaskWorkerForTestingAsync();
      await refreshPendingCounts();
      await refreshAll();
      setMessage("Development background sync trigger completed.");
    } catch (error) {
      setStatus("failed");
      setMessage(error instanceof Error ? error.message : "Background sync test trigger failed.");
    }
  }

  useEffect(() => {
    Promise.resolve().then(async () => {
      setAppLang(await loadMobileLanguage());
      setAppTheme(await loadMobileTheme());
      const saved = fastStorage.getString(AUTO_SYNC_PREF_KEY);
      // Default OFF — only "1" turns auto-sync on.
      setAutoSyncEnabled(saved === "1");
      await restoreApiBaseUrl();
      await loadRememberedEmail();
      // DB must be ready before session/sync touches SQLite (Redmi NPE / missing tables).
      await setupLocalDatabase();
      await restoreSession();
      await refreshBackgroundSyncStatus();
    });
    // Session and local DB setup are one-time app boot tasks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isFirebaseFirstMode()) return;
    return subscribeFirebaseAuth((user) => {
      setFirebaseUser(user);
      if (!user) return;
      const familyId = activeFamilyId || "";
      setCloudApiContext({
        user: {
          uid: user.uid,
          email: user.email || undefined,
          displayName: user.displayName || undefined,
        },
        ...(familyId ? { familyId } : {}),
      });
    });
  }, [activeFamilyId]);

  useEffect(() => {
    if (!token || !autoSyncEnabled) return;

    const runAutoSync = () => {
      if (loading) return;
      if (isCloudAccessToken(token)) {
        const uid = String(token).replace(/^firebase\./, "");
        const familyId = activeFamilyId;
        Promise.resolve().then(async () => {
          try {
            await pullCloudSnapshot(uid);
            if (familyId) {
              const authUser = getFirebaseAuth()?.currentUser;
              if (authUser && (!requireEmailVerification() || isFirebaseEmailVerified(authUser))) {
                await pushCloudSnapshot({
                  uid,
                  familyId,
                  deviceLabel: "mobile",
                  email: authUser.email,
                  displayName: authUser.displayName,
                });
              }
            }
            await refreshAll(token);
          } catch {
            /* keep last UI */
          }
        });
        return;
      }
      if (pendingSyncCount > 0) {
        Promise.resolve().then(() => replayPendingSync(true));
      }
    };

    const intervalId = setInterval(runAutoSync, AUTO_SYNC_INTERVAL_MS);
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") runAutoSync();
    });

    return () => {
      clearInterval(intervalId);
      subscription.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, autoSyncEnabled, pendingSyncCount, loading, activeFamilyId]);
    // Foreground auto-sync intentionally follows current queue/login state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, autoSyncEnabled, pendingSyncCount, loading]);

  const currency = families.find((family) => family.id === activeFamilyId)?.default_currency || "AED";
  const latestTransaction = transactions[0];
  const selectedGroceryItem = groceryItems.find((item) => item.id === selectedGroceryItemId) || groceryItems[0];
  const financeCategories = categories.filter((category) => category.category_type === financeIntent.type);
  const activeFamilyName = families.find((family) => family.id === activeFamilyId)?.name;
  const bottomNavActive =
    mobileTab === "home"
      ? "home"
      : mobileTab === "finance"
        ? "finance"
        : mobileTab === "reports"
          ? "reports"
          : "more";

  function openMoreTab(tab: MobileTab) {
    setMoreOpen(false);
    setMobileTab(tab);
  }

  function openFinanceSub(sub: FinanceSub) {
    setMoreOpen(false);
    setFinanceSubFocus(sub);
    setMobileTab("finance");
  }

  function openLifeModule(moduleType: string) {
    setMoreOpen(false);
    setLifeModuleFocus(moduleType);
    setMobileTab("life");
  }

  const pwScore = passwordStrength(password);
  const dark = appTheme === "dark";

  if (showSplash && !token) {
    return (
      <SafeAreaView style={[styles.safeArea, styles.safeAreaSplash]}>
        <MobileSplashScreen
          brandTitle="S4 FAMILY FINANCE 143"
          hint={tm("splashHint")}
          onDone={finishSplash}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safeArea, dark ? styles.safeAreaDark : null]}>
      <StatusBar barStyle={dark ? "light-content" : "dark-content"} />
      {token &&
      isCloudAccessToken(token) &&
      requireEmailVerification() &&
      firebaseUser &&
      !isFirebaseEmailVerified(firebaseUser) ? (
        <EmailVerificationGate
          email={firebaseUser.email || email}
          uid={firebaseUser.uid}
          busy={loading}
          lang={appLang}
          onResend={async () => {
            await firebaseResendVerification(firebaseUser);
          }}
          onRefresh={async () => {
            const refreshed = await firebaseReloadUser(firebaseUser);
            setFirebaseUser(refreshed);
            if (refreshed && isFirebaseEmailVerified(refreshed)) {
              setMessage(appLang === "bn" ? "ইমেইল ভেরিফাই হয়েছে" : "Email verified");
              void enableMobilePushNotifications({ familyId: activeFamilyId, deviceLabel: "mobile" });
              await refreshAll(token);
            } else {
              setMessage(appLang === "bn" ? "এখনো ভেরিফাই হয়নি — লিংক চেক করুন" : "Still not verified — check the link");
            }
          }}
          onSignOut={() => void logout()}
        />
      ) : (
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={[styles.container, token ? styles.containerWithNav : null]}>
          {!token ? (
            <>
              <View style={styles.hero}>
                <Text style={styles.kicker}>S4 FAMILY 143</Text>
                <Text style={styles.title}>{tm("appTitle")}</Text>
                <Text style={styles.subtitle}>{tm("appSubtitle")}</Text>
                <View style={styles.statusRow}>
                  {LOCKED_LANGUAGES.map((item) => (
                    <Pressable key={item.code} onPress={() => void changeAppLang(item.code)}>
                      <Text style={[styles.statusPill, appLang === item.code ? styles.ok : null]}>
                        {item.nativeName}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              <View style={[styles.panel, dark ? styles.panelDark : null]}>
                <View style={styles.statusRow}>
                  {(
                    [
                      ["login", "authLogin"],
                      ["create", "authCreate"],
                      ["join", "authJoin"],
                      ["forgot", "authForgot"],
                    ] as const
                  ).map(([id, labelKey]) => (
                    <Pressable key={id} onPress={() => setAuthMode(id)}>
                      <Text style={[styles.statusPill, authMode === id ? styles.ok : null]}>{tm(labelKey)}</Text>
                    </Pressable>
                  ))}
                </View>

                {authMode === "login" ? (
                  <>
                    <LoginScreen
                      onLegacySubmit={async (nextEmail, nextPassword) => {
                        setEmail(nextEmail);
                        setPassword(nextPassword);
                        if (isFirebaseFirstMode()) {
                          setLoading(true);
                          try {
                            const user = await firebaseSignInEmail(nextEmail, nextPassword);
                            await ensureUserProfile(user.uid, user);
                            const profile = await getUserFamilyProfile(user.uid);
                            let familyId = String(profile?.family_id || "");
                            try {
                              const pulled = await pullCloudSnapshot(user.uid);
                              if (pulled?.familyId) familyId = String(pulled.familyId);
                            } catch {
                              /* local until online/verified */
                            }
                            if (!familyId) {
                              setStatus("failed");
                              setMessage("No family linked. Create or join a family.");
                              await activateCloudSession(user, "");
                              setAuthMode("create");
                              setFamilySetupMode("create");
                              return;
                            }
                            const nextToken = await activateCloudSession(user, familyId);
                            setStatus("ok");
                            setMessage(
                              requireEmailVerification() && !isFirebaseEmailVerified(user)
                                ? "Logged in — verify email for cloud sync."
                                : "Logged in (Firebase cloud)."
                            );
                            useAuthStore.getState().setSession(nextToken, {
                              uid: user.uid,
                              email: user.email,
                              full_name: user.displayName,
                            });
                            if (rememberDevice) {
                              try {
                                if (await SecureStore.isAvailableAsync()) {
                                  await SecureStore.setItemAsync(REMEMBER_EMAIL_KEY, nextEmail);
                                }
                              } catch {
                                /* ignore */
                              }
                            }
                            await refreshAll(nextToken);
                            void authHook.refreshMe();
                            void familyHook.refetch();
                          } catch (error) {
                            setStatus("failed");
                            const text = formatFirebaseAuthError(error, appLang === "bn" ? "bn" : "en");
                            setMessage(text);
                            Alert.alert(tm("loginFailed"), text);
                            throw error;
                          } finally {
                            setLoading(false);
                          }
                          return;
                        }
                        await persistApiBaseUrl(apiBaseUrlInput);
                        setLoading(true);
                        try {
                          const data = await svcPost("/api/v1/auth/login", { email: nextEmail, password: nextPassword }, null);
                          const nextToken = data.access_token || "";
                          if (!nextToken) throw new Error("Login succeeded but no access token returned");
                          setStatus("ok");
                          setMessage("Logged in. Loading family finance data.");
                          setEmail(nextEmail);
                          setPassword(nextPassword);
                          await persistSession(nextToken, data.refresh_token || "", data.user, nextEmail);
                          useAuthStore.getState().setSession(nextToken, data.user);
                          if (rememberDevice) {
                            try {
                              if (await SecureStore.isAvailableAsync()) {
                                await SecureStore.setItemAsync(REMEMBER_EMAIL_KEY, nextEmail);
                              }
                            } catch {
                              /* ignore */
                            }
                          }
                          await refreshAll(nextToken);
                          void authHook.refreshMe();
                          void familyHook.refetch();
                        } catch (error) {
                          setStatus("failed");
                          const text = error instanceof Error ? error.message : "Login failed.";
                          setMessage(text);
                          Alert.alert(tm("loginFailed"), text);
                          throw error;
                        } finally {
                          setLoading(false);
                        }
                      }}
                    />
                    <Pressable style={styles.rememberRow} onPress={() => setRememberDevice((v) => !v)}>
                      <View style={[styles.rememberBox, rememberDevice ? styles.rememberBoxOn : null, dark ? styles.inputDark : null]}>
                        {rememberDevice ? <Text style={styles.rememberCheck}>✓</Text> : null}
                      </View>
                      <Text style={[styles.rememberLabel, dark ? styles.textOnDark : null]}>{tm("remember")}</Text>
                    </Pressable>
                  </>
                ) : null}

                {authMode !== "login" && (authMode === "create" || authMode === "join") ? (
                  <TextInput
                    style={[styles.input, dark ? styles.inputDark : null]}
                    placeholder={tm("fullName")}
                    placeholderTextColor="#8aa39a"
                    value={fullName}
                    onChangeText={setFullName}
                  />
                ) : null}

                {authMode !== "login" ? (
                  <TextInput
                    style={[styles.input, dark ? styles.inputDark : null]}
                    placeholder={tm("email")}
                    placeholderTextColor="#8aa39a"
                    autoCapitalize="none"
                    keyboardType="email-address"
                    value={email}
                    onChangeText={setEmail}
                  />
                ) : null}

                {authMode !== "login" && authMode !== "forgot" ? (
                  <>
                    <View style={styles.passwordRow}>
                      <TextInput
                        style={[styles.input, styles.passwordInput, dark ? styles.inputDark : null]}
                        placeholder={tm("password")}
                        placeholderTextColor="#8aa39a"
                        secureTextEntry={!showPassword}
                        value={password}
                        onChangeText={setPassword}
                      />
                      <Pressable style={[styles.passwordToggle, dark ? styles.iconBtnDark : null]} onPress={() => setShowPassword((v) => !v)}>
                        <Text style={[styles.passwordToggleText, dark ? styles.textOnDark : null]}>{showPassword ? tm("hide") : tm("show")}</Text>
                      </Pressable>
                    </View>
                    {(authMode === "create" || authMode === "join") && password ? (
                      <View style={styles.pwMeterWrap}>
                        <View style={styles.pwMeter}>
                          {[1, 2, 3, 4].map((n) => (
                            <View
                              key={n}
                              style={[
                                styles.pwBar,
                                pwScore >= n
                                  ? {
                                      backgroundColor:
                                        n <= 1 ? "#EF4444" : n <= 2 ? "#F59E0B" : n <= 3 ? "#84CC16" : "#1D9E75",
                                    }
                                  : null,
                              ]}
                            />
                          ))}
                        </View>
                        <Text style={[styles.muted, dark ? styles.mutedOnDark : null]}>{tm("passwordStrength")}</Text>
                      </View>
                    ) : null}
                  </>
                ) : null}

                {authMode === "create" || authMode === "join" ? (
                  <TextInput
                    style={[styles.input, dark ? styles.inputDark : null]}
                    placeholder={tm("phoneOptional")}
                    placeholderTextColor="#8aa39a"
                    keyboardType="phone-pad"
                    value={phone}
                    onChangeText={setPhone}
                  />
                ) : null}

                {authMode === "create" ? (
                  <>
                    <TextInput
                      style={[styles.input, dark ? styles.inputDark : null]}
                      placeholder={tm("familyName")}
                      placeholderTextColor="#8aa39a"
                      value={familyName}
                      onChangeText={setFamilyName}
                    />
                    <Text style={[styles.sectionLabel, dark ? styles.textOnDark : null]}>{tm("currency") || "Currency"}</Text>
                    <View style={styles.statusRow}>
                      {AUTH_CURRENCY_PRESETS.map((code) => (
                        <Pressable key={code} onPress={() => setFamilyCurrency(code)}>
                          <Text style={[styles.statusPill, familyCurrency === code ? styles.ok : null]}>{code}</Text>
                        </Pressable>
                      ))}
                    </View>
                    <Text style={[styles.sectionLabel, dark ? styles.textOnDark : null]}>{tm("timezone")}</Text>
                    <View style={styles.statusRow}>
                      {AUTH_TIMEZONE_PRESETS.map((tz) => (
                        <Pressable key={tz} onPress={() => setFamilyTimezone(tz)}>
                          <Text style={[styles.statusPill, familyTimezone === tz ? styles.ok : null]}>{tz}</Text>
                        </Pressable>
                      ))}
                    </View>
                    <Text style={[styles.sectionLabel, dark ? styles.textOnDark : null]}>{tm("relationship")}</Text>
                    <View style={styles.statusRow}>
                      {OWNER_RELATIONSHIPS.map((rel) => (
                        <Pressable key={rel} onPress={() => setOwnerRelation(rel)}>
                          <Text style={[styles.statusPill, ownerRelation === rel ? styles.ok : null]}>{rel}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </>
                ) : null}

                {authMode === "join" ? (
                  <>
                    <TextInput
                      style={[styles.input, dark ? styles.inputDark : null]}
                      placeholder={tm("inviteCode")}
                      placeholderTextColor="#8aa39a"
                      autoCapitalize="characters"
                      value={inviteCode}
                      onChangeText={setInviteCode}
                    />
                    <Text style={[styles.sectionLabel, dark ? styles.textOnDark : null]}>{tm("relationship")}</Text>
                    <View style={styles.statusRow}>
                      {JOIN_RELATIONSHIPS.map((rel) => (
                        <Pressable
                          key={rel}
                          onPress={() => {
                            setJoinRelation(rel);
                            setJoinSerialLabel("");
                            setJoinSerial("");
                            setJoinNote("");
                            setJoinLinkedMemberId("");
                          }}
                        >
                          <Text style={[styles.statusPill, joinRelation === rel ? styles.ok : null]}>{rel}</Text>
                        </Pressable>
                      ))}
                    </View>
                    {needsSerial(joinRelation) ? (
                      <>
                        <View style={styles.statusRow}>
                          {serialLabelsFor(joinRelation).map((label) => (
                            <Pressable key={label} onPress={() => setJoinSerialLabel(label)}>
                              <Text style={[styles.statusPill, joinSerialLabel === label ? styles.ok : null]}>{label}</Text>
                            </Pressable>
                          ))}
                        </View>
                        <TextInput
                          style={[styles.input, dark ? styles.inputDark : null]}
                          placeholder="Serial # (optional)"
                          placeholderTextColor="#8aa39a"
                          keyboardType="number-pad"
                          value={joinSerial}
                          onChangeText={setJoinSerial}
                        />
                      </>
                    ) : null}
                    {needsLinkedMember(joinRelation) ? (
                      <TextInput
                        style={[styles.input, dark ? styles.inputDark : null]}
                        placeholder="Linked member ID"
                        placeholderTextColor="#8aa39a"
                        value={joinLinkedMemberId}
                        onChangeText={setJoinLinkedMemberId}
                      />
                    ) : null}
                    {needsRelationshipNote(joinRelation) ? (
                      <TextInput
                        style={[styles.input, dark ? styles.inputDark : null]}
                        placeholder="Relationship note"
                        placeholderTextColor="#8aa39a"
                        value={joinNote}
                        onChangeText={setJoinNote}
                      />
                    ) : null}
                  </>
                ) : null}

                {!isFirebaseFirstMode() ? (
                  <>
                    <Text style={[styles.sectionLabel, dark ? styles.textOnDark : null]}>{tm("apiBaseUrl")}</Text>
                    <TextInput
                      style={[styles.input, dark ? styles.inputDark : null]}
                      placeholder="http://192.168.13.248:8000"
                      placeholderTextColor="#8aa39a"
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="url"
                      value={apiBaseUrlInput}
                      onChangeText={setApiBaseUrlInput}
                    />
                    <Text style={[styles.muted, dark ? styles.mutedOnDark : null]}>{tm("apiBaseHelpUsb")}</Text>
                    <Pressable style={styles.secondaryButton} onPress={testApiConnection} disabled={loading}>
                      <Text style={styles.secondaryButtonText}>{loading ? "…" : "Test Wi-Fi API"}</Text>
                    </Pressable>
                  </>
                ) : (
                  <Text style={[styles.muted, dark ? styles.mutedOnDark : null]}>
                    Firebase cloud mode — PC/LAN server লাগে না।
                  </Text>
                )}

                {authMode === "create" ? (
                  <>
                    <Pressable style={styles.primaryButton} onPress={createFamilyAuth} disabled={loading}>
                      <Text style={styles.primaryButtonText}>{loading ? tm("signingIn") : tm("createFamilySubmit")}</Text>
                    </Pressable>
                    <Pressable style={styles.secondaryButton} onPress={createOfflineAccountAuth} disabled={loading}>
                      <Text style={styles.secondaryButtonText}>
                        {loading ? "…" : "Offline account (server লাগে না)"}
                      </Text>
                    </Pressable>
                  </>
                ) : null}
                {authMode === "login" ? (
                  <>
                    <Pressable style={styles.secondaryButton} onPress={() => void loginWithGoogle()} disabled={loading}>
                      <Text style={styles.secondaryButtonText}>
                        {loading ? "…" : appLang === "bn" ? "Google দিয়ে সাইন ইন" : "Sign in with Google"}
                      </Text>
                    </Pressable>
                    <Pressable style={styles.secondaryButton} onPress={createOfflineAccountAuth} disabled={loading}>
                      <Text style={styles.secondaryButtonText}>
                        {loading ? "…" : "Offline ব্যবহার করুন (server ছাড়া)"}
                      </Text>
                    </Pressable>
                  </>
                ) : null}
                {authMode === "join" ? (
                  <Pressable style={styles.primaryButton} onPress={joinFamilyAuth} disabled={loading}>
                    <Text style={styles.primaryButtonText}>{loading ? tm("signingIn") : tm("joinFamilySubmit")}</Text>
                  </Pressable>
                ) : null}
                {authMode === "forgot" ? (
                  <Pressable style={styles.primaryButton} onPress={forgotPasswordAuth} disabled={loading}>
                    <Text style={styles.primaryButtonText}>{loading ? tm("signingIn") : tm("sendResetLink")}</Text>
                  </Pressable>
                ) : null}
              </View>
            </>
          ) : (
            <>
              <View style={[styles.mobileTopbar, dark ? styles.panelDark : null]}>
                <View style={styles.mobileBrandRow}>
                  <View style={styles.mobileBrand}>
                    <View style={styles.mobileBrandMark}><Text style={styles.mobileBrandMarkText}>S4</Text></View>
                    <View style={styles.flexMin}>
                      <Text style={[styles.mobileBrandTitle, dark ? styles.textOnDark : null]}>S4 FAMILY 143</Text>
                      <Text style={styles.mobileBrandSub}>
                        {isOfflineAccessToken(token) ? "Offline Only" : tm("offlineReady")}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.topActions}>
                    <Pressable style={[styles.iconBtn, dark ? styles.iconBtnDark : null]} onPress={() => changeAppTheme(dark ? "light" : "dark")}>
                      <Text style={[styles.iconBtnText, dark ? styles.textOnDark : null]}>{dark ? "☀" : "☾"}</Text>
                    </Pressable>
                    <Pressable style={[styles.iconBtn, dark ? styles.iconBtnDark : null]} onPress={() => setMobileTab("alerts")}>
                      <Text style={[styles.iconBtnText, dark ? styles.textOnDark : null]}>🔔</Text>
                    </Pressable>
                    <Pressable style={[styles.iconBtn, dark ? styles.iconBtnDark : null]} onPress={logout}>
                      <Text style={[styles.iconBtnText, dark ? styles.textOnDark : null]}>⎋</Text>
                    </Pressable>
                  </View>
                </View>
                <View style={[styles.searchShell, dark ? styles.inputDark : null]}>
                  <Text style={styles.searchIcon}>⌕</Text>
                  <TextInput
                    style={[styles.searchInput, dark ? styles.textOnDark : null]}
                    placeholder="Search modules, transactions..."
                    placeholderTextColor="#6c7b76"
                    value={mobileSearch}
                    onChangeText={setMobileSearch}
                  />
                </View>
              </View>

              {token && !activeFamilyId ? (
                <View style={[styles.panel, dark ? styles.panelDark : null]}>
                  <Text style={[styles.sectionLabel, dark ? styles.textOnDark : null]}>
                    Family setup required
                  </Text>
                  <Text style={[styles.muted, dark ? styles.mutedOnDark : null]}>
                    Wallet ও data add করতে আগে family তৈরি করুন বা invite দিয়ে join করুন। PC server চালু + USB/Wi-Fi connected থাকতে হবে।
                  </Text>
                  <View style={styles.statusRow}>
                    <Pressable onPress={() => setFamilySetupMode("create")}>
                      <Text style={[styles.statusPill, familySetupMode === "create" ? styles.ok : null]}>{tm("authCreate")}</Text>
                    </Pressable>
                    <Pressable onPress={() => setFamilySetupMode("join")}>
                      <Text style={[styles.statusPill, familySetupMode === "join" ? styles.ok : null]}>{tm("authJoin")}</Text>
                    </Pressable>
                  </View>
                  {familySetupMode === "create" ? (
                    <>
                      <TextInput
                        style={[styles.input, dark ? styles.inputDark : null]}
                        placeholder={tm("familyName")}
                        placeholderTextColor="#8aa39a"
                        value={familyName}
                        onChangeText={setFamilyName}
                      />
                      <View style={styles.statusRow}>
                        {["BDT", "AED", "USD", "SAR"].map((code) => (
                          <Pressable key={code} onPress={() => setFamilyCurrency(code)}>
                            <Text style={[styles.statusPill, familyCurrency === code ? styles.ok : null]}>{code}</Text>
                          </Pressable>
                        ))}
                      </View>
                      <Pressable style={styles.primaryButton} onPress={createFamilyForSession} disabled={loading}>
                        <Text style={styles.primaryButtonText}>{loading ? tm("signingIn") : tm("createFamilySubmit")}</Text>
                      </Pressable>
                    </>
                  ) : (
                    <>
                      <TextInput
                        style={[styles.input, dark ? styles.inputDark : null]}
                        placeholder={tm("inviteCode")}
                        placeholderTextColor="#8aa39a"
                        autoCapitalize="characters"
                        value={inviteCode}
                        onChangeText={setInviteCode}
                      />
                      <Pressable style={styles.primaryButton} onPress={joinFamilyForSession} disabled={loading}>
                        <Text style={styles.primaryButtonText}>{loading ? tm("signingIn") : tm("joinFamilySubmit")}</Text>
                      </Pressable>
                    </>
                  )}
                </View>
              ) : null}

              {mobileTab === "home" ? (
                <DashboardScreen
                  currency={currency}
                  familyName={activeFamilyName}
                  dashboard={dashboard}
                  accounts={accounts}
                  budgets={budgets}
                  transactions={
                    mobileSearch.trim()
                      ? transactions.filter((tx) =>
                          [tx.description, tx.transaction_type, tx.amount]
                            .join(" ")
                            .toLowerCase()
                            .includes(mobileSearch.trim().toLowerCase())
                        )
                      : transactions
                  }
                  pendingSync={pendingSyncCount}
                  conflictSync={conflictSyncCount}
                  failedSync={failedSyncCount}
                  money={amount}
                  t={tm}
                  lang={appLang}
                  loading={loading}
                  onOpenFinance={() => {
                    setFinanceSubFocus("WALLETS");
                    setMobileTab("finance");
                  }}
                  onOpenFinanceSub={(sub) => openFinanceSub(sub as FinanceSub)}
                  onOpenReports={() => setMobileTab("reports")}
                  onOpenFamily={() => setMobileTab("family")}
                  onOpenGrocery={() => setMobileTab("grocery")}
                  onOpenLife={() => {
                    setLifeModuleFocus("");
                    setMobileTab("life");
                  }}
                  onOpenLifeModule={(moduleType) => openLifeModule(moduleType)}
                  onOpenZakat={() => setMobileTab("zakat")}
                  onOpenAlerts={() => setMobileTab("alerts")}
                  onOpenAudit={() => setMobileTab("audit")}
                  onOpenSettings={() => setMobileTab("settings")}
                  onOpenSync={() => setMobileTab("sync")}
                  onOpenBackup={() => setMobileTab("backup")}
                  onOpenCurrency={() => setMobileTab("currency")}
                  onRefresh={() => refreshAll()}
                />
              ) : null}
            </>
          )}

          {token && mobileTab === "sync" ? (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>{tm("syncTitle")}</Text>
            <View style={styles.statusRow}>
              <Text style={styles.statusPill}>{localDbReady ? tm("sqliteReady") : tm("sqlitePending")}</Text>
              <Text style={[styles.statusPill, dbSecurityMode === "sqlcipher" || dbSecurityMode === "web_payload_aes" ? styles.ok : null]}>
                {dbSecurityMode === "sqlcipher"
                  ? tm("sqlCipherOn")
                  : dbSecurityMode === "web_payload_aes"
                    ? tm("aesPayload")
                    : dbSecurityMode === "sqlcipher_pending_custom_build"
                      ? tm("cipherKeyReady")
                      : tm("dbPlain")}
              </Text>
              <Text style={styles.statusPill}>{pendingSyncCount} {tm("pending")}</Text>
              <Text style={styles.statusPill}>{pendingGrocerySyncCount} {tm("grocery")}</Text>
              <Text style={[styles.statusPill, conflictSyncCount ? styles.failed : null]}>{conflictSyncCount} {tm("conflict")}</Text>
              <Text style={[styles.statusPill, failedSyncCount ? styles.failed : null]}>{failedSyncCount} {tm("failed")}</Text>
              <Text style={[styles.statusPill, autoSyncEnabled ? styles.ok : null]}>{autoSyncEnabled ? tm("autoOn") : tm("autoOff")}</Text>
              <Text style={[styles.statusPill, backgroundSyncRegistered ? styles.ok : null]}>{backgroundSyncRegistered ? tm("bgOn") : tm("bgOff")}</Text>
              <Text style={[styles.statusPill, status === "ok" ? styles.ok : status === "failed" ? styles.failed : null]}>{status}</Text>
            </View>
            <Text style={styles.muted}>{dbSecurityNote}</Text>
            {dbSecurityMode === "sqlcipher_pending_custom_build" ? (
              <Text style={styles.muted}>
                SQLCipher next: npm run verify:sqlcipher ? npm run prebuild:native ? npm run android:native (or npm run eas:build:dev)
              </Text>
            ) : null}
            {lastAutoSyncAt ? <Text style={styles.muted}>{tm("lastAutoSync")}: {lastAutoSyncAt}</Text> : null}
            <Text style={styles.muted}>OS background sync: {backgroundSyncStatus}. Minimum interval {BACKGROUND_SYNC_INTERVAL_MINUTES} minutes; actual run time is controlled by Android/iOS.</Text>
            <Text style={styles.muted}>{message}</Text>
            {serverConflicts.length ? (
              <>
                <Text style={styles.sectionLabel}>{tm("serverConflicts") || "Server conflicts"}</Text>
                {serverConflicts.map((conflict) => (
                  <View style={styles.listRow} key={conflict.id}>
                    <Text style={styles.listTitle}>
                      {conflict.entity_type || "entity"} � {String(conflict.entity_id || conflict.id).slice(0, 12)}
                    </Text>
                    <Text style={styles.muted}>{tm("chooseResolveStrategy") || "Choose resolve strategy"}</Text>
                    <Pressable
                      style={styles.secondaryButton}
                      disabled={serverConflictBusyId === conflict.id}
                      onPress={() => void resolveServerConflict(conflict, "keep_server")}
                    >
                      <Text style={styles.secondaryButtonText}>{tm("keepServer") || "Keep Server"}</Text>
                    </Pressable>
                    <Pressable
                      style={styles.secondaryButton}
                      disabled={serverConflictBusyId === conflict.id}
                      onPress={() => void resolveServerConflict(conflict, "keep_local")}
                    >
                      <Text style={styles.secondaryButtonText}>{tm("keepLocal") || "Keep Local"}</Text>
                    </Pressable>
                    <Pressable
                      style={styles.secondaryButton}
                      disabled={serverConflictBusyId === conflict.id}
                      onPress={() => void resolveServerConflict(conflict, "merge")}
                    >
                      <Text style={styles.secondaryButtonText}>{tm("mergeConflict") || "Merge"}</Text>
                    </Pressable>
                  </View>
                ))}
              </>
            ) : null}
            {conflictRows.map((row) => {
              const payload = parseConflictPayload(row);
              const serverItem = groceryItems.find((item) => item.id === payload.item_id);
              return (
                <View style={styles.listRow} key={row.id}>
                  <Text style={styles.listTitle}>{row.action} conflict</Text>
                  <Text style={styles.muted}>{row.last_error || "Server rejected stale mobile update."}</Text>
                  <Text style={styles.sectionLabel}>Local vs Server</Text>
                  <Text style={styles.muted}>Name: {payload.name || "-"} / {serverItem?.name || "Refresh needed"}</Text>
                  <Text style={styles.muted}>Category: {payload.category || "-"} / {serverItem?.category || "-"}</Text>
                  <Text style={styles.muted}>Qty: {payload.quantity || "-"} {payload.unit || ""} / {serverItem?.quantity || "-"} {serverItem?.unit || ""}</Text>
                  <Text style={styles.muted}>Estimated: {payload.estimated_price || "0"} / {serverItem?.estimated_price || "-"}</Text>
                  <Text style={styles.muted}>Actual: {payload.actual_price || "0"} / {serverItem?.actual_price || "-"}</Text>
                  <Text style={styles.muted}>Version: local expected v{payload.sync_version || "?"} / server v{serverItem?.sync_version || "?"}</Text>
                  <Pressable style={styles.secondaryButton} onPress={() => keepServerForConflict(row.id)}>
                    <Text style={styles.secondaryButtonText}>Keep Server</Text>
                  </Pressable>
                  <Pressable style={styles.secondaryButton} onPress={() => applyLocalOverServer(row)} disabled={!serverItem?.sync_version}>
                    <Text style={styles.secondaryButtonText}>Apply Local</Text>
                  </Pressable>
                </View>
              );
            })}
            <Pressable
              style={styles.secondaryButton}
              onPress={() => setAutoSyncPreference(!autoSyncEnabled)}
            >
              <Text style={styles.secondaryButtonText}>
                {autoSyncEnabled ? "Pause Auto-Sync" : "Resume Auto-Sync"}
              </Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={backgroundSyncRegistered ? unregisterBackgroundSync : registerBackgroundSync} disabled={!token || loading}>
              <Text style={styles.secondaryButtonText}>{backgroundSyncRegistered ? tm("disableOsBackgroundSync") : tm("enableOsBackgroundSync")}</Text>
            </Pressable>
            {__DEV__ ? (
              <Pressable style={styles.secondaryButton} onPress={triggerBackgroundSyncTest} disabled={!token || loading}>
                <Text style={styles.secondaryButtonText}>Test Background Sync</Text>
              </Pressable>
            ) : null}
            <Pressable style={styles.secondaryButton} onPress={() => replayPendingSync(false)} disabled={!token || loading || pendingSyncCount === 0}>
              <Text style={styles.secondaryButtonText}>{loading ? "Syncing..." : tm("replayPending")}</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={retryConflicts} disabled={!conflictSyncCount || loading}>
              <Text style={styles.secondaryButtonText}>{tm("retryConflicts")}</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={retryFailedSync} disabled={!failedSyncCount || loading}>
              <Text style={styles.secondaryButtonText}>{tm("retryFailed")} ({failedSyncCount})</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={clearConflicts} disabled={!conflictSyncCount || loading}>
              <Text style={styles.secondaryButtonText}>{tm("clearConflicts")}</Text>
            </Pressable>
          </View>
          ) : null}

          {token && mobileTab === "finance" && !activeFamilyId ? (
            <View style={[styles.panel, dark ? styles.panelDark : null]}>
              <Text style={[styles.sectionLabel, dark ? styles.textOnDark : null]}>Family setup required</Text>
              <Text style={[styles.muted, dark ? styles.mutedOnDark : null]}>
                Home tab-এ গিয়ে family তৈরি করুন, তারপর wallet add করতে পারবেন।
              </Text>
              <Pressable style={styles.primaryButton} onPress={() => setMobileTab("home")}>
                <Text style={styles.primaryButtonText}>Go to Home</Text>
              </Pressable>
            </View>
          ) : null}

          {token && mobileTab === "finance" && activeFamilyId ? (
            financeSubFocus === "LOANS" ? (
            <LoansScreen
              token={token}
              familyId={activeFamilyId}
              currency={currency}
              lang={appLang}
              initialSub={financeSubFocus}
              apiGet={apiGet}
              apiPost={apiPost}
              apiPatch={apiPatch}
              formatAmount={amount}
              onQueueOffline={queueOfflineAction}
              onMessage={(text, ok = true) => {
                setMessage(text);
                setStatus(ok ? "ok" : "failed");
              }}
              onChanged={() => refreshAll()}
              offlineSlot={null}
            />
            ) : financeSubFocus === "BUDGET" ? (
            <BudgetScreen
              token={token}
              familyId={activeFamilyId}
              currency={currency}
              lang={appLang}
              initialSub={financeSubFocus}
              apiGet={apiGet}
              apiPost={apiPost}
              apiPatch={apiPatch}
              formatAmount={amount}
              onQueueOffline={queueOfflineAction}
              onMessage={(text, ok = true) => {
                setMessage(text);
                setStatus(ok ? "ok" : "failed");
              }}
              onChanged={() => refreshAll()}
              offlineSlot={null}
            />
            ) : financeSubFocus === "TX" ? (
            <ExpenseScreen
              token={token}
              familyId={activeFamilyId}
              currency={currency}
              lang={appLang}
              initialSub={financeSubFocus}
              apiGet={apiGet}
              apiPost={apiPost}
              apiPatch={apiPatch}
              formatAmount={amount}
              onQueueOffline={queueOfflineAction}
              onMessage={(text, ok = true) => {
                setMessage(text);
                setStatus(ok ? "ok" : "failed");
              }}
              onChanged={() => refreshAll()}
              offlineSlot={null}
            />
            ) : (
            <IncomeScreen
              token={token}
              familyId={activeFamilyId}
              currency={currency}
              lang={appLang}
              initialSub={financeSubFocus}
              apiGet={apiGet}
              apiPost={apiPost}
              apiPatch={apiPatch}
              formatAmount={amount}
              onQueueOffline={queueOfflineAction}
              onMessage={(text, ok = true) => {
                setMessage(text);
                setStatus(ok ? "ok" : "failed");
              }}
              onChanged={() => refreshAll()}
              offlineSlot={
                <View style={{ gap: 12 }}>
                  <Text style={styles.sectionLabel}>{tm("offlineFinanceIntent")}</Text>
                  <View style={styles.grid}>
                    <Metric label={tm("queue")} value={String(pendingFinanceSyncCount)} />
                    <Metric label={tm("lastTx")} value={latestTransaction ? amount(latestTransaction.amount, latestTransaction.currency || currency) : tm("none")} />
                  </View>
                  <View style={styles.statusRow}>
                    {["EXPENSE", "INCOME", "TRANSFER"].map((type) => (
                      <Pressable key={type} onPress={() => setFinanceIntent((current) => ({ ...current, type, category_id: "", to_account_id: "" }))}>
                        <Text style={[styles.statusPill, financeIntent.type === type ? styles.ok : null]}>{type}</Text>
                      </Pressable>
                    ))}
                  </View>
                  <Text style={styles.sectionLabel}>{tm("sourceWallet")}</Text>
                  <View style={styles.statusRow}>
                    {accounts.slice(0, 6).map((account) => (
                      <Pressable key={account.id} onPress={() => setFinanceIntent((current) => ({ ...current, account_id: account.id }))}>
                        <Text style={[styles.statusPill, financeIntent.account_id === account.id ? styles.ok : null]}>{account.name}</Text>
                      </Pressable>
                    ))}
                  </View>
                  {financeIntent.type === "TRANSFER" ? (
                    <>
                      <Text style={styles.sectionLabel}>Destination wallet</Text>
                      <View style={styles.statusRow}>
                        {accounts
                          .filter((account) => account.id !== financeIntent.account_id)
                          .slice(0, 6)
                          .map((account) => (
                            <Pressable key={account.id} onPress={() => setFinanceIntent((current) => ({ ...current, to_account_id: account.id }))}>
                              <Text style={[styles.statusPill, financeIntent.to_account_id === account.id ? styles.ok : null]}>{account.name}</Text>
                            </Pressable>
                          ))}
                      </View>
                    </>
                  ) : (
                    <>
                      <Text style={styles.sectionLabel}>Category</Text>
                      <View style={styles.statusRow}>
                        {financeCategories.slice(0, 8).map((category) => (
                          <Pressable key={category.id} onPress={() => setFinanceIntent((current) => ({ ...current, category_id: category.id }))}>
                            <Text style={[styles.statusPill, financeIntent.category_id === category.id ? styles.ok : null]}>
                              {category.name_en || category.name_bn || category.category_type}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    </>
                  )}
                  <TextInput
                    style={styles.input}
                    placeholder={tm("amount")}
                    placeholderTextColor="#8aa39a"
                    keyboardType="decimal-pad"
                    value={financeIntent.amount}
                    onChangeText={(amountValue) => setFinanceIntent((current) => ({ ...current, amount: amountValue }))}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder={tm("reviewNote")}
                    placeholderTextColor="#8aa39a"
                    value={financeIntent.note}
                    onChangeText={(note) => setFinanceIntent((current) => ({ ...current, note }))}
                  />
                  <Text style={styles.muted}>Intents stay local until reviewed replay. Live posting is under Wallets/Tx tabs.</Text>
                  <Pressable style={styles.primaryButton} onPress={queueFinanceIntent}>
                    <Text style={styles.primaryButtonText}>{tm("queueFinanceIntent")}</Text>
                  </Pressable>
                  <Pressable style={styles.secondaryButton} onPress={replayReviewedFinanceIntents} disabled={!pendingFinanceSyncCount || loading}>
                    <Text style={styles.secondaryButtonText}>{loading ? "Posting..." : "Replay Reviewed Finance"}</Text>
                  </Pressable>
                </View>
              }
            />
            )
          ) : null}

          {token && mobileTab === "family" && activeFamilyId ? (
            <MobileGovernancePanel
              token={token}
              familyId={activeFamilyId}
              lang={appLang}
              apiGet={apiGet}
              apiPost={apiPost}
              apiPatch={apiPatch}
              apiDelete={apiDelete}
              onMessage={(text, ok = true) => {
                setMessage(text);
                setStatus(ok ? "ok" : "failed");
              }}
              onChanged={() => refreshAll()}
            />
          ) : null}

          {token && mobileTab === "planner" && activeFamilyId ? (
            <MobilePlannerPanel
              token={token}
              familyId={activeFamilyId}
              lang={appLang}
              apiGet={apiGet}
              apiPost={apiPost}
              apiDelete={apiDelete}
              onMessage={(text, ok = true) => {
                setMessage(text);
                setStatus(ok ? "ok" : "failed");
              }}
            />
          ) : null}

          {token && mobileTab === "life" && activeFamilyId ? (
            <LifeModulesPanel
              token={token}
              familyId={activeFamilyId}
              currency={currency}
              apiBaseUrl={getApiBaseUrl()}
              lang={appLang}
              initialModuleType={lifeModuleFocus || undefined}
              apiGet={apiGet}
              apiPost={apiPost}
              apiPatch={apiPatch}
              formatAmount={amount}
              onQueueOffline={queueOfflineAction}
              onMessage={(text, ok = true) => {
                setMessage(text);
                setStatus(ok ? "ok" : "failed");
              }}
            />
          ) : null}

          {token && mobileTab === "zakat" && activeFamilyId ? (
            <MobileZakatPanel
              token={token}
              familyId={activeFamilyId}
              currency={currency}
              lang={appLang}
              apiGet={apiGet}
              apiPost={apiPost}
              formatAmount={amount}
              onQueueOffline={queueOfflineAction}
              onMessage={(text, ok = true) => {
                setMessage(text);
                setStatus(ok ? "ok" : "failed");
              }}
            />
          ) : null}

          {token && mobileTab === "reports" && activeFamilyId ? (
            <ReportsScreen
              token={token}
              familyId={activeFamilyId}
              currency={currency}
              apiBaseUrl={getApiBaseUrl()}
              lang={appLang}
              apiGet={apiGet}
              formatAmount={amount}
              onMessage={(text, ok = true) => {
                setMessage(text);
                setStatus(ok ? "ok" : "failed");
              }}
            />
          ) : null}

          {token && mobileTab === "alerts" && activeFamilyId ? (
            <MobileNotificationsPanel
              token={token}
              familyId={activeFamilyId}
              lang={appLang}
              apiGet={apiGet}
              apiPost={apiPost}
              apiPatch={apiPatch}
              apiDelete={apiDelete}
              onMessage={(text, ok = true) => {
                setMessage(text);
                setStatus(ok ? "ok" : "failed");
              }}
            />
          ) : null}

          {token && mobileTab === "audit" && activeFamilyId ? (
            <MobileAuditPanel
              token={token}
              familyId={activeFamilyId}
              lang={appLang}
              apiGet={apiGet}
              onMessage={(text, ok = true) => {
                setMessage(text);
                setStatus(ok ? "ok" : "failed");
              }}
            />
          ) : null}

          {token && mobileTab === "backup" && activeFamilyId ? (
            <MobileBackupPanel
              token={token}
              familyId={activeFamilyId}
              apiBaseUrl={getApiBaseUrl()}
              lang={appLang}
              apiGet={apiGet}
              apiPost={apiPost}
              onMessage={(text, ok = true) => {
                setMessage(text);
                setStatus(ok ? "ok" : "failed");
              }}
            />
          ) : null}

          {token && mobileTab === "currency" && activeFamilyId ? (
            <MobileCurrencyPanel
              token={token}
              familyId={activeFamilyId}
              currency={currency}
              lang={appLang}
              apiGet={apiGet}
              formatAmount={amount}
              onMessage={(text, ok = true) => {
                setMessage(text);
                setStatus(ok ? "ok" : "failed");
              }}
            />
          ) : null}

          {token && mobileTab === "settings" && activeFamilyId ? (
            <SettingsScreen
              token={token}
              refreshToken={refreshToken}
              familyId={activeFamilyId}
              families={families}
              apiBaseUrl={getApiBaseUrl()}
              lang={appLang}
              theme={appTheme}
              onChangeLang={changeAppLang}
              onChangeTheme={changeAppTheme}
              apiGet={apiGet}
              apiPost={apiPost}
              apiPatch={apiPatch}
              onMessage={(text, ok = true) => {
                setMessage(text);
                setStatus(ok ? "ok" : "failed");
              }}
              onFamilyUpdated={() => refreshAll()}
              onApiBaseChange={persistApiBaseUrl}
              onSessionRefreshed={async (accessToken, nextRefreshToken, user) => {
                setToken(accessToken);
                if (nextRefreshToken) setRefreshToken(nextRefreshToken);
                try {
                  if (await SecureStore.isAvailableAsync()) {
                    await SecureStore.setItemAsync(
                      SESSION_KEY,
                      JSON.stringify({
                        access_token: accessToken,
                        refresh_token: nextRefreshToken || refreshToken,
                        email: user?.email || email,
                        user,
                      })
                    );
                  }
                } catch {
                  // Web preview may not support SecureStore.
                }
              }}
            />
          ) : null}

          {token && mobileTab === "grocery" && activeFamilyId ? (
            <GroceryScreen
              token={token}
              familyId={activeFamilyId}
              currency={currency}
              apiBaseUrl={getApiBaseUrl()}
              lang={appLang}
              apiGet={apiGet}
              apiPost={apiPost}
              apiPut={apiPut}
              formatAmount={amount}
              onQueueOffline={queueOfflineAction}
              online={typeof navigator === "undefined" ? true : navigator.onLine !== false}
              onMessage={(text, ok = true) => {
                setMessage(text);
                setStatus(ok ? "ok" : "failed");
              }}
              onChanged={() => refreshAll()}
              offlineSlot={
                <View style={{ gap: 12 }}>
                  <Text style={styles.sectionLabel}>{tm("offlineGroceryDraft")}</Text>
                  <TextInput
                    style={styles.input}
                    placeholder={tm("listTitle")}
                    placeholderTextColor="#8aa39a"
                    value={groceryForm.title}
                    onChangeText={(title) => setGroceryForm((current) => ({ ...current, title }))}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder={tm("itemName")}
                    placeholderTextColor="#8aa39a"
                    value={groceryForm.item_name}
                    onChangeText={(item_name) => setGroceryForm((current) => ({ ...current, item_name }))}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder={tm("estimatedPrice")}
                    placeholderTextColor="#8aa39a"
                    keyboardType="decimal-pad"
                    value={groceryForm.estimated_price}
                    onChangeText={(estimated_price) => setGroceryForm((current) => ({ ...current, estimated_price }))}
                  />
                  <Pressable style={styles.primaryButton} onPress={createOfflineGroceryDraft}>
                    <Text style={styles.primaryButtonText}>{tm("queueOfflineGrocery")}</Text>
                  </Pressable>
                  <Text style={styles.sectionLabel}>Conflict-aware item replay</Text>
                  <Text style={styles.muted}>Select a synced grocery item. Server returns SYNC_CONFLICT if the item changed first.</Text>
                  {groceryItems.slice(0, 8).map((item) => (
                    <Pressable
                      key={item.id}
                      style={styles.listRow}
                      onPress={() => {
                        setSelectedGroceryItemId(item.id);
                        setGroceryItemEdit(itemEditDefaults(item));
                      }}
                    >
                      <Text style={styles.listTitle}>
                        {selectedGroceryItem?.id === item.id ? "Selected: " : ""}
                        {item.name}
                      </Text>
                      <Text style={styles.muted}>
                        v{item.sync_version || 1} � {item.is_bought ? "Bought" : "Pending"} �{" "}
                        {amount(item.actual_price || item.estimated_price, currency)}
                      </Text>
                    </Pressable>
                  ))}
                  <TextInput
                    style={styles.input}
                    placeholder={tm("itemName")}
                    placeholderTextColor="#8aa39a"
                    value={groceryItemEdit.name}
                    onChangeText={(name) => setGroceryItemEdit((current) => ({ ...current, name }))}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder={tm("category")}
                    placeholderTextColor="#8aa39a"
                    value={groceryItemEdit.category}
                    onChangeText={(category) => setGroceryItemEdit((current) => ({ ...current, category }))}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder={tm("quantity")}
                    placeholderTextColor="#8aa39a"
                    keyboardType="decimal-pad"
                    value={groceryItemEdit.quantity}
                    onChangeText={(quantity) => setGroceryItemEdit((current) => ({ ...current, quantity }))}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder={tm("unit")}
                    placeholderTextColor="#8aa39a"
                    value={groceryItemEdit.unit}
                    onChangeText={(unit) => setGroceryItemEdit((current) => ({ ...current, unit }))}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder={tm("estimatedPrice")}
                    placeholderTextColor="#8aa39a"
                    keyboardType="decimal-pad"
                    value={groceryItemEdit.estimated_price}
                    onChangeText={(estimated_price) => setGroceryItemEdit((current) => ({ ...current, estimated_price }))}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder={tm("actualPrice")}
                    placeholderTextColor="#8aa39a"
                    keyboardType="decimal-pad"
                    value={groceryItemEdit.actual_price}
                    onChangeText={(actual_price) => setGroceryItemEdit((current) => ({ ...current, actual_price }))}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder={tm("itemNote")}
                    placeholderTextColor="#8aa39a"
                    value={groceryItemEdit.note}
                    onChangeText={(note) => setGroceryItemEdit((current) => ({ ...current, note }))}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder={tm("updateNote")}
                    placeholderTextColor="#8aa39a"
                    value={groceryUpdateNote}
                    onChangeText={setGroceryUpdateNote}
                  />
                  <Pressable style={styles.secondaryButton} onPress={queueSelectedGroceryItemUpdate} disabled={!selectedGroceryItem}>
                    <Text style={styles.secondaryButtonText}>{tm("queueItemUpdate")}</Text>
                  </Pressable>
                  <Pressable style={styles.secondaryButton} onPress={queueSelectedGroceryItemBought} disabled={!selectedGroceryItem}>
                    <Text style={styles.secondaryButtonText}>{tm("queueMarkBought")}</Text>
                  </Pressable>
                </View>
              }
            />
          ) : null}
        </ScrollView>

        {token ? (
          <MobileArchBottomNav
            active={bottomNavActive}
            onHome={() => setMobileTab("home")}
            onFinance={() => {
              setFinanceSubFocus("WALLETS");
              setMobileTab("finance");
            }}
            onAdd={() => {
              setFinanceSubFocus("TX");
              setMobileTab("finance");
            }}
            onReports={() => setMobileTab("reports")}
            onMore={() => setMoreOpen(true)}
            homeLabel={tm("tab_home")}
            financeLabel={tm("tab_finance")}
            reportsLabel={tm("tab_reports")}
            moreLabel={tm("more")}
            addLabel={tm("add")}
          />
        ) : null}

        <Modal visible={moreOpen} transparent animationType="fade" onRequestClose={() => setMoreOpen(false)}>
          <View style={styles.moreBackdrop}>
            <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setMoreOpen(false)} />
            <View style={styles.moreSheet}>
              <View style={styles.moreHandle} />
              <Text style={styles.moreTitle}>{tm("moreModules")}</Text>
              <Text style={styles.moreSub}>{tm("allModulesHint")}</Text>
              <DrawerNav
                active={mobileTab}
                onNavigate={(route) => {
                  openMoreTab(route as MobileTab);
                }}
                labels={{
                  grocery: tm("tab_grocery"),
                  planner: tm("tab_planner"),
                  life: tm("tab_life"),
                  family: tm("tab_family"),
                  zakat: tm("tab_zakat"),
                  alerts: tm("tab_alerts"),
                  audit: tm("tab_audit"),
                  settings: tm("tab_settings"),
                  sync: tm("tab_sync"),
                  backup: tm("tab_backup"),
                  currency: tm("tab_currency"),
                }}
              />
              <View style={styles.moreGrid}>
                {(
                  [
                    { kind: "finance" as const, sub: "WALLETS" as FinanceSub, labelKey: "wallets", hintKey: "modHint_finance", icon: "◇" },
                    { kind: "finance" as const, sub: "TX" as FinanceSub, labelKey: "tx", hintKey: "modHint_finance", icon: "↕" },
                    { kind: "finance" as const, sub: "BUDGET" as FinanceSub, labelKey: "budgets", hintKey: "modHint_finance", icon: "◷" },
                    { kind: "finance" as const, sub: "SAVINGS" as FinanceSub, labelKey: "savings", hintKey: "modHint_finance", icon: "◎" },
                    { kind: "finance" as const, sub: "LOANS" as FinanceSub, labelKey: "loans", hintKey: "modHint_finance", icon: "⇄" },
                    { kind: "finance" as const, sub: "GOALS" as FinanceSub, labelKey: "goals", hintKey: "modHint_finance", icon: "★" },
                    { kind: "finance" as const, sub: "RECURRING" as FinanceSub, labelKey: "recurring", hintKey: "modHint_finance", icon: "↻" },
                    { kind: "life" as const, moduleType: "HEALTH", labelKey: "enum_HEALTH", hintKey: "modHint_life", icon: "❤" },
                    { kind: "life" as const, moduleType: "VEHICLE", labelKey: "enum_VEHICLE", hintKey: "modHint_life", icon: "🚗" },
                    { kind: "life" as const, moduleType: "EDUCATION", labelKey: "enum_EDUCATION", hintKey: "modHint_life", icon: "📚" },
                    { kind: "life" as const, moduleType: "INVESTMENT", labelKey: "investments", hintKey: "modHint_life", icon: "◈" },
                    { kind: "life" as const, moduleType: "SUBSCRIPTION", labelKey: "enum_SUBSCRIPTION", hintKey: "modHint_life", icon: "🔁" },
                    { kind: "life" as const, moduleType: "DOCUMENT", labelKey: "enum_DOCUMENT", hintKey: "modHint_life", icon: "📄" },
                    { kind: "life" as const, moduleType: "PROPERTY", labelKey: "enum_PROPERTY", hintKey: "modHint_life", icon: "🏠" },
                  ]
                ).map((item) => (
                  <Pressable
                    key={item.kind === "finance" ? `finance-${item.sub}` : `life-${item.moduleType}`}
                    style={styles.moreTile}
                    onPress={() => {
                      if (item.kind === "finance") openFinanceSub(item.sub);
                      else openLifeModule(item.moduleType);
                    }}
                  >
                    <Text style={styles.moreIcon}>{item.icon}</Text>
                    <Text style={styles.moreLabel}>{tm(item.labelKey)}</Text>
                    <Text style={styles.moreHint} numberOfLines={2}>{tm(item.hintKey)}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </View>
        </Modal>
      </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#f3f7f6" },
  safeAreaSplash: { backgroundColor: "#0b1f2a" },
  safeAreaDark: { backgroundColor: "#0e1614" },
  flex: { flex: 1 },
  flexMin: { flex: 1, minWidth: 0 },
  container: { padding: 14, paddingBottom: 36, gap: 14 },
  containerWithNav: { paddingBottom: 110 },
  hero: { padding: 22, borderRadius: 28, backgroundColor: "#0f8f6f" },
  kicker: { color: "#d7fff2", fontWeight: "900", letterSpacing: 1.4, fontSize: 12 },
  title: { color: "#ffffff", fontSize: 30, fontWeight: "900", marginTop: 8 },
  subtitle: { color: "#dffaf2", fontSize: 14, lineHeight: 21, marginTop: 8 },
  panelDark: { backgroundColor: "#14201d", borderColor: "#2b3c37" },
  textOnDark: { color: "#eef8f5" },
  mutedOnDark: { color: "#9dafaa" },
  inputDark: { backgroundColor: "#182724", borderColor: "#2b3c37", color: "#eef8f5" },
  iconBtnDark: { backgroundColor: "#182724", borderColor: "#2b3c37" },
  mobileTopbar: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#dce7e3",
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
  },
  mobileBrandRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  mobileBrand: { flexDirection: "row", alignItems: "center", gap: 9, flex: 1, minWidth: 0 },
  mobileBrandMark: {
    width: 37,
    height: 37,
    borderRadius: 13,
    backgroundColor: "#0f8f6f",
    alignItems: "center",
    justifyContent: "center",
  },
  mobileBrandMarkText: { color: "#ffffff", fontWeight: "950", fontSize: 12 },
  mobileBrandTitle: { color: "#17211e", fontSize: 13, fontWeight: "950" },
  mobileBrandSub: { color: "#0b6f58", fontSize: 9, fontWeight: "800", marginTop: 2 },
  topActions: { flexDirection: "row", gap: 7 },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "#dce7e3",
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
  },
  iconBtnText: { color: "#17211e", fontWeight: "800" },
  searchShell: {
    height: 46,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: "#dce7e3",
    backgroundColor: "#f8fbfa",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    gap: 8,
  },
  searchIcon: { color: "#6c7b76", fontSize: 17 },
  searchInput: { flex: 1, color: "#17211e", fontSize: 13, paddingVertical: 0 },
  panel: { backgroundColor: "#ffffff", borderColor: "#dce7e3", borderWidth: 1, borderRadius: 24, padding: 16, gap: 12 },
  panelTitle: { color: "#17211e", fontSize: 20, fontWeight: "900" },
  muted: { color: "#6c7b76", fontSize: 13, lineHeight: 19 },
  input: { backgroundColor: "#f8fbfa", borderColor: "#dce7e3", borderWidth: 1, borderRadius: 16, color: "#17211e", paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  passwordRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  passwordInput: { flex: 1 },
  passwordToggle: {
    borderWidth: 1,
    borderColor: "#dce7e3",
    backgroundColor: "#e0f4ed",
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    minWidth: 64,
    alignItems: "center",
  },
  passwordToggleText: { color: "#0b6f58", fontWeight: "800", fontSize: 12 },
  pwMeterWrap: { gap: 6 },
  pwMeter: { flexDirection: "row", gap: 6 },
  pwBar: { flex: 1, height: 6, borderRadius: 99, backgroundColor: "#dce7e3" },
  rememberRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 2 },
  rememberBox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#dce7e3",
    backgroundColor: "#f8fbfa",
    alignItems: "center",
    justifyContent: "center",
  },
  rememberBoxOn: { backgroundColor: "#0f8f6f", borderColor: "#0f8f6f" },
  rememberCheck: { color: "#ffffff", fontSize: 12, fontWeight: "900" },
  rememberLabel: { color: "#17211e", fontSize: 13, fontWeight: "700", flex: 1 },
  primaryButton: { backgroundColor: "#0f8f6f", borderRadius: 16, paddingVertical: 14, alignItems: "center" },
  primaryButtonText: { color: "#ffffff", fontWeight: "900", fontSize: 15 },
  secondaryButton: { borderColor: "#0f8f6f", borderWidth: 1, borderRadius: 16, paddingVertical: 12, alignItems: "center", backgroundColor: "#ffffff" },
  secondaryButtonText: { color: "#0b6f58", fontWeight: "800" },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  linkText: { color: "#0f8f6f", fontWeight: "800" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  metricCard: { flexGrow: 1, minWidth: "45%", backgroundColor: "#f8fbfa", borderRadius: 18, padding: 12, borderWidth: 1, borderColor: "#dce7e3" },
  metricLabel: { color: "#6c7b76", fontSize: 12, fontWeight: "700" },
  metricValue: { color: "#17211e", fontSize: 18, fontWeight: "900", marginTop: 6 },
  statusRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  statusPill: { color: "#0b6f58", backgroundColor: "#e0f4ed", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, fontSize: 12, fontWeight: "800", overflow: "hidden" },
  ok: { backgroundColor: "#0f8f6f", color: "#ffffff" },
  failed: { backgroundColor: "#fee9e9", color: "#dc2626" },
  listRow: { borderTopColor: "#dce7e3", borderTopWidth: 1, paddingTop: 10, gap: 2 },
  listTitle: { color: "#17211e", fontWeight: "900", fontSize: 15 },
  sectionLabel: { color: "#0b6f58", fontWeight: "900", marginTop: 6 },
  tabRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tabButton: { backgroundColor: "#f8fbfa", borderColor: "#dce7e3", borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  tabButtonActive: { backgroundColor: "#0f8f6f", borderColor: "#0f8f6f" },
  tabButtonText: { color: "#6c7b76", fontWeight: "800", fontSize: 12 },
  tabButtonTextActive: { color: "#ffffff" },
  moreBackdrop: { flex: 1, backgroundColor: "rgba(7,19,15,0.45)", justifyContent: "flex-end" },
  moreSheet: {
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 16,
    paddingBottom: 28,
    gap: 8,
  },
  moreHandle: {
    alignSelf: "center",
    width: 42,
    height: 4,
    borderRadius: 99,
    backgroundColor: "#d0ddd8",
    marginBottom: 4,
  },
  moreTitle: { color: "#17211e", fontSize: 18, fontWeight: "900" },
  moreSub: { color: "#6c7b76", fontSize: 12, marginBottom: 6 },
  moreGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  moreTile: {
    width: "47%",
    flexGrow: 1,
    minWidth: 140,
    borderWidth: 1,
    borderColor: "#dce7e3",
    backgroundColor: "#f8fbfa",
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 2,
  },
  moreIcon: { fontSize: 20 },
  moreLabel: { color: "#17211e", fontWeight: "900", fontSize: 13, marginTop: 4 },
  moreHint: { color: "#6c7b76", fontSize: 10, lineHeight: 14 },
  moreItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 14,
    backgroundColor: "#f8fbfa",
    marginBottom: 6,
  },
});

