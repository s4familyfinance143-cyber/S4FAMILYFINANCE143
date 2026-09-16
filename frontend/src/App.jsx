import { useCallback, useEffect, useRef, useState, lazy, Suspense } from "react";
import "./App.css";
import "./styles/architecture-shell.css";
import "./styles/design-polish.css";
import "./styles/mobile-shell.css";
import "./styles/shoyb-desktop.css";
import "./styles/shoyb-mobile.css";
import "./styles/layout-compact.css";
import { SplashScreen } from "./components/auth/SplashScreen";
import { FamilyAuthGate } from "./components/auth/FamilyAuthGate";
import { CloudBackupOnboarding } from "./components/auth/CloudBackupOnboarding";
import { EmailVerificationGate } from "./components/auth/EmailVerificationGate";
import {
  enqueueGroceryChange,
  enqueueOutboxChange,
  flushCloudSnapshotOutbox,
  flushLocalOutbox,
  isBrowserOnline,
  listPendingOutbox,
  mergePullIntoGroceryState,
} from "./lib/offlineSync";
import { loadOfflineSnapshot, saveOfflineSnapshot, hasLocalOfflineData } from "./lib/offlineCache";
import { defaultPermissionsForRole, applyPermissionOverrides } from "./lib/familyRoles";
import {
  cacheReportExport,
  flushPendingUploads,
  getCachedReportExport,
  queueDocumentUpload,
} from "./lib/offlineBlobs";
import { ExecutiveDashboard } from "./components/dashboard/ExecutiveDashboard";
import { DesktopSidebar, MobileBottomNavigation, TopHeader } from "./components/layout/AppNavigation";
const Phase15Panel = lazy(() =>
  import("./components/phase/Phase15Panel").then((m) => ({ default: m.Phase15Panel })),
);
const Phase16Panel = lazy(() =>
  import("./components/phase/Phase16Panel").then((m) => ({ default: m.Phase16Panel })),
);
const ReportsPanel = lazy(() =>
  import("./components/reports/ReportsPanel").then((m) => ({ default: m.ReportsPanel })),
);
import { SettingsPanel } from "./components/settings/SettingsPanel";
import { GroceryPanel } from "./components/grocery/GroceryPanel";
import { SyncPanel } from "./components/sync/SyncPanel";
import { AuditPanel } from "./components/audit/AuditPanel";
import { NotificationsPanel } from "./components/notifications/NotificationsPanel";
import { WalletsPanel } from "./components/finance/WalletsPanel";
import { TransactionsPanel } from "./components/finance/TransactionsPanel";
import { SavingsPanel } from "./components/finance/SavingsPanel";
import { LoansPanel } from "./components/finance/LoansPanel";
import { TagsPanel } from "./components/finance/TagsPanel";
import { ArchitectureCutoverPanel } from "./components/finance/ArchitectureCutoverPanel";
import { BudgetsPanel } from "./components/finance/BudgetsPanel";
import { FamilyGovernancePanel } from "./components/family/FamilyGovernancePanel";
import { InviteCodeSpotlight } from "./components/family/InviteCodeSpotlight";
import { TasksCalendarPanel } from "./components/planner/TasksCalendarPanel";
import {
  LIFE15,
  LIFE16,
  buildCreatePayload as buildLifeCreatePayload,
  closePath as lifeClosePath,
  createPath as lifeCreatePath,
  documentUploadPath,
  lifeSummaryPath,
  loadLifeGroup,
  offlineEntityType as lifeOfflineEntityType,
  summarizeLifeItems,
  updatePath as lifeUpdatePath,
} from "./lifeArchitectureApi";
import {
  isFirebaseConfigured,
  subscribeFirebaseAuth,
  firebaseSignInEmail,
  firebaseRegisterEmail,
  firebaseSignInGoogle,
  firebaseSignOut,
  isFirebaseEmailVerified,
  firebaseReloadUser,
  firebaseResendEmailVerification,
  firebaseSendPasswordReset,
  formatFirebaseAuthError,
  pushCloudSnapshot,
  pullCloudSnapshot,
  getCloudSnapshotMeta,
  ensureUserProfile,
  getUserProfileDoc,
  bindCloudFamilyIdentity,
  resolveAndBindUserFamily,
  createCloudFamilyAccount,
  enableWebPushNotifications,
  getNotificationPermission,
  isWebFcmVapidConfigured,
  subscribeForegroundMessages,
} from "./firebase";
import {
  uploadFamilyDocument,
  uploadTransactionAttachment,
  uploadProfilePhotoToFirebase,
  removeProfilePhotoFromFirebase,
  validateProfilePhotoFile,
} from "./firebase/cloudStorage";
import { joinFamilyByInviteCode } from "./firebase/familyCloud";
import { buildBackupBlob, restoreBackupBlob } from "./lib/backupPayload";
import {
  loadCloudAutoSyncSettings,
  saveCloudAutoSyncSettings,
  shouldRunTarget,
  markTargetRun,
  intervalMs,
} from "./lib/cloudAutoSync";
import { isPhase15Menu, isPhase16Menu, parsePhaseTab, isSettingsMenu, parseSettingsTab } from "./lib/navMenu";
import {
  isFirebaseFirstMode,
  requireEmailVerification,
  loadCloudOnlyMode,
  persistCloudOnlyMode,
  loadCloudFamilyId,
  persistCloudFamilyId,
  clearCloudSession,
} from "./lib/cloudSession";
import { hydrateFamilyFromOfflineCache, buildDashboardFromCache } from "./lib/hydrateFromCache";
import { buildReportExportBlob } from "./lib/clientReportExport";
import { isNativeApp } from "./lib/runtimeEnv";
import {
  clearAuthSession,
  hasRestorableAuthSession,
  persistAuthSession,
  restoreAuthSession,
  touchAuthSessionActivity,
} from "./lib/authSession";
import { loadBackupOnboardingDone, saveBackupOnboardingDone } from "./lib/cloudOnboardingStorage";
import {
  DEFAULT_CLOUD_CATEGORIES,
  recomputeWalletBalancesFromLedger,
  buildLocalTransaction,
  sortTransactionsNewestFirst,
  buildLocalSavingsGoal,
  enrichSavingsGoals,
  normalizeSavingsList,
  buildSavingsMovementTx,
  recomputeSavingsFromLedger,
  buildSavingsAnnualPlan,
  buildLocalLoan,
  buildLoanMovementTx,
  loanHistoryFromLedger,
  applyLoanPayment,
  walletBalance,
  buildLocalBudget,
  enrichBudgetsFromLedger,
  normalizeBudgetsList,
  persistableBudgets,
  budgetDuplicateKey,
  buildBudgetStatusSummary,
  buildLocalGoal,
  enrichGoals,
  buildGoalSummary,
  buildGoalMovementTx,
  recomputeGoalsFromLedger,
  goalHistoryFromLedger,
  buildLocalRecurring,
  buildRecurringPostTx,
  advanceRecurringAfterPost,
  recurringHistoryFromLedger,
} from "./lib/cloudLocalFinance";
import {
  cloudApiGet,
  cloudApiPost,
  cloudApiPatch,
  cloudApiDelete,
  seedCloudModuleCaches,
} from "./lib/cloudApiShim";
import {
  isGoogleDriveConfigured,
  connectGoogleDrive,
  getStoredDriveToken,
  clearStoredDriveToken,
  getDriveAccessToken,
  uploadBackupToDrive,
  listDriveBackups,
  downloadDriveBackup,
} from "./googleDrive";
import {
  isLocalFolderBackupSupported,
  pickBackupFolder,
  writeBackupToFolder,
  readLatestBackupFromFolder,
  getStoredFolderLabel,
  loadDirectoryHandle,
  downloadBackupFile,
} from "./localBackup";
import { UI_TEXT, LANGUAGE_DIGITS, CURRENCY_NAMES, CURRENCY_SHORT } from "./i18n/legacyUiText";
import bnMessages from "./i18n/messages/bn.json";
import enMessages from "./i18n/messages/en.json";
import arMessages from "./i18n/messages/ar.json";
import hiMessages from "./i18n/messages/hi.json";
import urMessages from "./i18n/messages/ur.json";

const FIREBASE_CONFIGURED = isFirebaseConfigured();
const FIREBASE_FIRST_MODE = isFirebaseFirstMode();
const REQUIRE_EMAIL_VERIFICATION = requireEmailVerification();
const DRIVE_CONFIGURED = isGoogleDriveConfigured();
const LOCAL_FOLDER_SUPPORTED = isLocalFolderBackupSupported();

try {
  const savedTheme = localStorage.getItem("s4-theme");
  if (savedTheme === "dark") document.documentElement.setAttribute("data-theme", "dark");
} catch {
  /* ignore */
}

const DEVICE_ID_STORAGE_KEY = "s4-device-id";

function getOrCreateDeviceId() {
  // Backend's new-device security-alert email (AuthSecurityService.
  // _upsert_device_session, via auth.py's get_device_label) falls back to
  // sha256(User-Agent) when no X-Device-Id header is sent — and this client
  // never sent one. Since many unrelated users share the same common
  // browser+OS string, that fallback fingerprint is not actually per-device:
  // an attacker using a stolen password with a common browser could log in
  // without ever triggering the alert, once the real user had logged in
  // once with that same common UA. A random ID persisted in localStorage
  // makes the fingerprint actually unique per browser install.
  try {
    let id = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    if (!id) {
      id =
        (typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `web-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      localStorage.setItem(DEVICE_ID_STORAGE_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

function normalizeApiBase(value) {
  const cleaned = String(value || "").trim().replace(/\/+$/, "");
  if (!cleaned) return "";
  // Direct backend origins always use the sole v1 API path.
  if (/^https?:\/\//i.test(cleaned)) {
    return `${cleaned.replace(/\/api(?:\/v\d+)?$/i, "")}/api/v1`;
  }
  return cleaned;
}

function isUsableApiBase(url) {
  try {
    const u = new URL(String(url || "").trim());
    const h = u.hostname.toLowerCase();
    if (!h) return false;
    if (h === "localhost" || h === "127.0.0.1") return true;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true;
    if (!h.includes(".")) return false;
    // Reject truncated production host typed in Server settings (e.g. app.s4businessthir)
    if (/s4businessthir/i.test(h) && !/s4businessthinking\.com$/i.test(h)) return false;
    return true;
  } catch {
    return false;
  }
}

const DEFAULT_API_BASE = normalizeApiBase(
  import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000",
);
const API_BASE_STORAGE_KEY = "s4_api_base";
const AUTO_SYNC_STORAGE_KEY = "s4_auto_sync";
const AUTO_SYNC_INTERVAL_MS = 15000;
const DEFAULT_EMAIL = import.meta.env.VITE_DEFAULT_EMAIL || "";
const DEFAULT_PASSWORD = "";
const SYNC_DEVICE_ID = "web-dashboard";
const LANGUAGE_STORAGE_KEY = "s4-language";

function readStoredApiBase() {
  try {
    const saved = localStorage.getItem(API_BASE_STORAGE_KEY);
    if (saved && String(saved).trim()) {
      const normalized = normalizeApiBase(saved);
      if (isUsableApiBase(normalized)) return normalized;
      localStorage.removeItem(API_BASE_STORAGE_KEY);
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_API_BASE;
}

function persistApiBase(url) {
  const cleaned = normalizeApiBase(url);
  try {
    if (cleaned) localStorage.setItem(API_BASE_STORAGE_KEY, cleaned);
    else localStorage.removeItem(API_BASE_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  return cleaned || DEFAULT_API_BASE;
}

function readAutoSyncEnabled() {
  try {
    const saved = localStorage.getItem(AUTO_SYNC_STORAGE_KEY);
    if (saved === null || saved === undefined || saved === "") return true;
    return saved !== "0" && saved !== "false";
  } catch {
    return true;
  }
}

function persistAutoSyncEnabled(enabled) {
  try {
    localStorage.setItem(AUTO_SYNC_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    /* ignore */
  }
}
const LOCKED_LANGUAGES = [
  { code: "bn", name: "Bangla", nativeName: "বাংলা", dir: "ltr" },
  { code: "ar", name: "Arabic", nativeName: "العربية", dir: "rtl" },
  { code: "hi", name: "Hindi", nativeName: "हिन्दी", dir: "ltr" },
  { code: "ur", name: "Urdu", nativeName: "اردو", dir: "rtl" },
  { code: "en", name: "English", nativeName: "English", dir: "ltr" },
];
const LOCKED_LANGUAGE_CODES = LOCKED_LANGUAGES.map((language) => language.code);
const LANGUAGE_LABELS = {
  bn: "বাংলা",
  ar: "العربية",
  hi: "हिन्दी",
  ur: "اردو",
  en: "English",
};
const LOCALE_MESSAGES = {
  bn: bnMessages,
  en: enMessages,
  ar: arMessages,
  hi: hiMessages,
  ur: urMessages,
};

const EMPTY_PHASE15_FORM = {
  module_type: "INVESTMENT",
  name: "",
  category: "GENERAL",
  sub_type: "",
  provider: "",
  member_id: "",
  amount: "0",
  secondary_amount: "",
  target_date: "",
  secondary_date: "",
  note: "",
};
const EMPTY_PHASE16_FORM = {
  module_type: "SUBSCRIPTION",
  name: "",
  category: "GENERAL",
  sub_type: "",
  provider: "",
  member_id: "",
  amount: "0",
  secondary_amount: "",
  renewal_or_expiry_date: "",
  secondary_date: "",
  billing_cycle: "MONTHLY",
  payment_account_id: "",
  reference: "",
  note: "",
};
const COMMON_PERMISSION_KEYS = [
  "dashboard.read",
  "accounts.create",
  "accounts.read",
  "transactions.create",
  "income.create",
  "expense.create",
  "transactions.read",
  "reports.read",
  "audit.read",
  "backup.create",
  "backup.read",
  "backup.download",
  "backup.restore",
  "sync.view",
  "sync.pull",
  "sync.push",
  "sync.conflicts",
  "sync.resolve",
  "sync.manage",
  "settings.manage",
];

function App() {
  const [appLanguage, setAppLanguage] = useState(() => {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return LOCKED_LANGUAGE_CODES.includes(stored) ? stored : "bn";
  });
  const [email, _setEmail] = useState(DEFAULT_EMAIL);
  const [password, setPassword] = useState(DEFAULT_PASSWORD);
  const [_authView, setAuthView] = useState("login");
  const [_showPassword, _setShowPassword] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authRestoring, setAuthRestoring] = useState(() => hasRestorableAuthSession(readStoredApiBase()));
  const [fullName, _setFullName] = useState("");
  const [phone, _setPhone] = useState("");
  const [showSplash, setShowSplash] = useState(true);
  const finishSplash = useCallback(() => setShowSplash(false), []);
  const [apiBase, setApiBase] = useState(() => readStoredApiBase());
  const [token, setToken] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [families, setFamilies] = useState([]);
  const [activeFamilyId, setActiveFamilyId] = useState(() => loadCloudFamilyId());
  const [familiesLoading, setFamiliesLoading] = useState(false);
  /** False until the first /families fetch finishes for the current token. */
  const [familiesReady, setFamiliesReady] = useState(false);
  /** True while restoring/selecting the user's active family after login or refresh. */
  const [isFamilyLoading, setIsFamilyLoading] = useState(() =>
    Boolean(FIREBASE_FIRST_MODE && (loadCloudOnlyMode() || loadCloudFamilyId())),
  );
  /** True until first Firebase auth callback finishes when a cloud session is expected. */
  const [sessionBootstrapping, setSessionBootstrapping] = useState(() =>
    Boolean(FIREBASE_FIRST_MODE && FIREBASE_CONFIGURED && (loadCloudOnlyMode() || loadCloudFamilyId())),
  );
  const [currentUser, setCurrentUser] = useState(null);
  const [displayAvatarUrl, setDisplayAvatarUrl] = useState("");
  const [myPermissions, setMyPermissions] = useState(null);
  const [memberPermissions, setMemberPermissions] = useState([]);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [familyCurrencyForm, setFamilyCurrencyForm] = useState("");
  const [familyTimezoneForm, setFamilyTimezoneForm] = useState("");
  const [settingsTab, setSettingsTab] = useState("profile");
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [securityAction, setSecurityAction] = useState("");
  const [deleteAccountStep, setDeleteAccountStep] = useState("idle");
  const [deleteAccountOtp, setDeleteAccountOtp] = useState("");
  const [deleteAccountBusy, setDeleteAccountBusy] = useState(false);
  const [emailStatus, setEmailStatus] = useState(null);
  const [permissionForms, setPermissionForms] = useState({});
  const [permissionSavingMemberId, setPermissionSavingMemberId] = useState("");
  const [activeMenu, setActiveMenu] = useState("dashboard");
  const [status, setStatus] = useState("");
  const [toast, setToast] = useState(null);
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [firebaseMeta, setFirebaseMeta] = useState(null);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [driveConnected, setDriveConnected] = useState(() => Boolean(getStoredDriveToken()));
  const [driveFiles, setDriveFiles] = useState([]);
  const [localFolderLabel, setLocalFolderLabel] = useState(() => getStoredFolderLabel());
  const [cloudAutoSync, setCloudAutoSync] = useState(() => loadCloudAutoSyncSettings());
  const [cloudOnlyMode, setCloudOnlyMode] = useState(() =>
    FIREBASE_FIRST_MODE ? loadCloudOnlyMode() : false,
  );
  const [showBackupOnboarding, setShowBackupOnboarding] = useState(false);
  const cloudAutoSyncRef = useRef(cloudAutoSync);
  const cloudAutoBackupRunningRef = useRef(false);
  const driveConnectSyncOnceRef = useRef(false);

  const [dashboard, setDashboard] = useState(null);
  const [wallets, setWallets] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [categories, setCategories] = useState([]);
  const [categoriesSaving, setCategoriesSaving] = useState(false);
  const [categoryDeletingId, setCategoryDeletingId] = useState("");
  const [savings, setSavings] = useState([]);
  const [loans, setLoans] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [budgetStatus, setBudgetStatus] = useState(null);
  const [recurringItems, setRecurringItems] = useState([]);
  const [goals, setGoals] = useState([]);
  const [goalSummary, setGoalSummary] = useState(null);
  const [auditSummary, setAuditSummary] = useState(null);
  const [auditRows, setAuditRows] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [financialReport, setFinancialReport] = useState(null);
  const [walletReport, setWalletReport] = useState(null);
  const [ledgerReport, setLedgerReport] = useState(null);
  const [netWorthReport, setNetWorthReport] = useState(null);
  const [categoryReport, setCategoryReport] = useState(null);
  const [budgetReport, setBudgetReport] = useState(null);
  const [loanReport, setLoanReport] = useState(null);
  const [savingsTrendReport, setSavingsTrendReport] = useState(null);
  const [apiLogsReport, setApiLogsReport] = useState(null);
  const [reportAccountId, setReportAccountId] = useState("");
  const [reportsLoading, setReportsLoading] = useState(false);
  const [backupIntegrity, setBackupIntegrity] = useState(null);
  const [backupList, setBackupList] = useState({ count: 0, backups: [] });
  const [backupPreview, setBackupPreview] = useState(null);
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupCreating, setBackupCreating] = useState(false);
  const [backupPreviewingFile, setBackupPreviewingFile] = useState("");
  const [syncStatus, setSyncStatus] = useState(null);
  const [syncConflicts, setSyncConflicts] = useState([]);
  const [syncResolvedConflicts, setSyncResolvedConflicts] = useState([]);
  const [syncPullPreview, setSyncPullPreview] = useState(null);
  const [syncLogs, setSyncLogs] = useState(null);
  const [syncLogsLoading, setSyncLogsLoading] = useState(false);
  const [syncLastToken, setSyncLastToken] = useState("");
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncPullLoading, setSyncPullLoading] = useState(false);
  const [syncResolveLoadingId, setSyncResolveLoadingId] = useState("");
  const [syncTab, setSyncTab] = useState("status");
  const [syncPushLoading, setSyncPushLoading] = useState(false);
  const [localOutboxPending, setLocalOutboxPending] = useState(0);
  const [groceryPendingRows, setGroceryPendingRows] = useState([]);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(() => readAutoSyncEnabled());
  const [lastAutoSyncAt, setLastAutoSyncAt] = useState("");
  const [browserOnline, setBrowserOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine !== false
  );
  const [currencies, setCurrencies] = useState([]);
  const [exchangeRates, setExchangeRates] = useState([]);
  const [currencySummary, setCurrencySummary] = useState(null);
  const [currencyLoading, setCurrencyLoading] = useState(false);
  const [governanceMembers, setGovernanceMembers] = useState([]);
  const [joinRequests, setJoinRequests] = useState([]);
  const [governanceLoading, setGovernanceLoading] = useState(false);
  const [inviteGenerating, setInviteGenerating] = useState(false);
  const [inviteRevoking, setInviteRevoking] = useState(false);
  const [generatedInvite, setGeneratedInvite] = useState(null);
  const [inviteSpotlightOpen, setInviteSpotlightOpen] = useState(false);
  const [inviteCodeCopied, setInviteCodeCopied] = useState(false);
  const [familyPanelTab, setFamilyPanelTab] = useState("members");
  const [inviteForm, setInviteForm] = useState({
    expires_in_days: "7",
    max_uses: "1",
    invitee_email: "",
    send_email: false,
  });
  /** When logged in but no family_id — inline Create / Join (not dead Family menu). */
  const [noFamilySetupMode, setNoFamilySetupMode] = useState("choose"); // choose | create | join
  const [noFamilyForm, setNoFamilyForm] = useState({
    password: "",
    fullName: "",
    familyName: "",
    inviteCode: "",
    relation: "Husband",
  });
  const noFamilyAutoRestoreRef = useRef("");
  const [notifications, setNotifications] = useState([]);
  const [notificationSummary, setNotificationSummary] = useState(null);
  const [notificationDelivery, setNotificationDelivery] = useState(null);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [pushDevices, setPushDevices] = useState([]);
  const [pushTokenDraft, setPushTokenDraft] = useState("");
  const [pushPlatform, setPushPlatform] = useState("WEB");
  const [notifyDropdownOpen, setNotifyDropdownOpen] = useState(false);
  const [notifyPermission, setNotifyPermission] = useState("default");
  const [notifyPermissionHint, setNotifyPermissionHint] = useState("");
  const [fcmClientReady, setFcmClientReady] = useState(false);
  const [zakatRecords, setZakatRecords] = useState([]);
  const [zakatSummary, setZakatSummary] = useState(null);
  const [phase15Items, setPhase15Items] = useState([]);
  const [phase15Summary, setPhase15Summary] = useState(null);
  const [phase16Items, setPhase16Items] = useState([]);
  const [phase16Summary, setPhase16Summary] = useState(null);
  const [phase15ActiveTab, setPhase15ActiveTab] = useState("INVESTMENT");
  const [phase16ActiveTab, setPhase16ActiveTab] = useState("SUBSCRIPTION");
  const [editingPhase15Id, setEditingPhase15Id] = useState("");
  const [editingPhase16Id, setEditingPhase16Id] = useState("");
  const [documentFile, setDocumentFile] = useState(null);
  const [groceryLists, setGroceryLists] = useState([]);
  const [groceryItems, setGroceryItems] = useState([]);
  const [groceryPriceHistory, setGroceryPriceHistory] = useState([]);
  const [groceryVendorSummary, setGroceryVendorSummary] = useState([]);
  const [groceryVendors, setGroceryVendors] = useState([]);
  const [groceryBarcodeLookup, setGroceryBarcodeLookup] = useState(null);
  const [groceryOcrPreview, setGroceryOcrPreview] = useState(null);
  const [groceryActivity, setGroceryActivity] = useState([]);
  const [groceryCollaboration, setGroceryCollaboration] = useState(null);
  const [groceryWsState, setGroceryWsState] = useState("off");
  const [activeGroceryListId, setActiveGroceryListId] = useState("");
  const [groceryListForm, setGroceryListForm] = useState({
    title: "",
    budget_amount: "0",
    vendor_name: "",
    shopping_date: "",
    note: "",
  });
  const [groceryItemForm, setGroceryItemForm] = useState({
    name: "",
    category: "GENERAL",
    quantity: "1",
    unit: "pcs",
    estimated_price: "0",
    actual_price: "0",
    vendor_name: "",
    barcode: "",
    note: "",
  });
  const [groceryVendorForm, setGroceryVendorForm] = useState({
    name: "",
    phone: "",
    address: "",
    category: "GENERAL",
    note: "",
  });
  const [groceryExpenseForm, setGroceryExpenseForm] = useState({ account_id: "", category_id: "" });
  const [groceryScanForm, setGroceryScanForm] = useState({ barcode: "", raw_text: "" });
  const [groceryTab, setGroceryTab] = useState("lists");
  const [phase15Form, setPhase15Form] = useState({ ...EMPTY_PHASE15_FORM });
  const [phase16Form, setPhase16Form] = useState({ ...EMPTY_PHASE16_FORM });
  const [zakatForm, setZakatForm] = useState({
    calculation_year: String(new Date().getFullYear()),
    cash_amount: "0",
    gold_value: "0",
    silver_value: "0",
    gold_grams: "",
    silver_grams: "",
    investment_value: "0",
    business_assets: "0",
    receivables: "0",
    deductible_debts: "0",
    nisab_amount: "",
    nisab_metal: "SILVER",
    gold_rate: "",
    silver_rate: "",
    note: "",
  });
  const [metalRates, setMetalRates] = useState(null);

  const [goalForm, setGoalForm] = useState({
    goal_name: "",
    goal_type: "GENERAL",
    target_amount: "",
    currency: "BDT",
    target_date: "",
    note: "",
  });

  const [goalContributionForm, setGoalContributionForm] = useState({
    goal_id: "",
    wallet_account_id: "",
    amount: "",
    currency: "BDT",
    description: "",
  });


  const [loanSearch, setLoanSearch] = useState("");
  const [loanStatusFilter, setLoanStatusFilter] = useState("ALL");
  const [loanTypeFilter, setLoanTypeFilter] = useState("ALL");

  const [budgetSearch, setBudgetSearch] = useState("");
  const [budgetStatusFilter, setBudgetStatusFilter] = useState("ALL");

  const [recurringSearch, setRecurringSearch] = useState("");
  const [recurringStatusFilter, setRecurringStatusFilter] = useState("ALL");
  const [recurringTypeFilter, setRecurringTypeFilter] = useState("ALL");

  const [historyModal, setHistoryModal] = useState({
    open: false,
    loading: false,
    goal: null,
    history: [],
  });

  const [loanHistoryModal, setLoanHistoryModal] = useState({
    open: false,
    loading: false,
    loan: null,
    history: [],
  });

  const [loanEditModal, setLoanEditModal] = useState({
    open: false,
    loan: null,
    person_name: "",
    note: "",
  });

  const [budgetEditModal, setBudgetEditModal] = useState({
    open: false,
    budget: null,
    name: "",
    budget_amount: "",
    note: "",
    category_id: "",
    period_type: "MONTHLY",
  });

  const [recurringEditModal, setRecurringEditModal] = useState({
    open: false,
    item: null,
    title: "",
    amount: "",
    frequency: "MONTHLY",
    end_date: "",
    description: "",
  });

  const [recurringHistoryModal, setRecurringHistoryModal] = useState({
    open: false,
    loading: false,
    item: null,
    history: [],
  });

  const [goalEditModal, setGoalEditModal] = useState({
    open: false,
    goal: null,
    goal_name: "",
    goal_type: "GENERAL",
    target_amount: "",
    target_date: "",
    note: "",
  });

  const [goalHistoryModal, setGoalHistoryModal] = useState({
    open: false,
    loading: false,
    goal: null,
    history: [],
  });

  const [walletForm, setWalletForm] = useState({
    name: "",
    account_type: "CASH",
    currency: "BDT",
    opening_balance: "0",
    is_shared_family: true,
    is_owner_wallet: false,
  });
  const [editingWalletId, setEditingWalletId] = useState("");
  const [walletBusyId, setWalletBusyId] = useState("");
  const [budgetBusyId, setBudgetBusyId] = useState("");
  const [savingsBusyId, setSavingsBusyId] = useState("");

  function emptyWalletForm() {
    return {
      name: "",
      account_type: "CASH",
      currency: currencyCode(),
      opening_balance: "0",
      is_shared_family: true,
      is_owner_wallet: false,
    };
  }

  function activeWalletRows(list) {
    return (Array.isArray(list) ? list : []).filter(
      (w) => !w?.deleted_at && w?.is_active !== false,
    );
  }

  function isActiveWalletId(walletId, list = wallets) {
    if (!walletId) return false;
    return activeWalletRows(list).some((w) => String(w.id) === String(walletId));
  }

  /** Keep tx/savings/loan/recurring forms pointing at live wallets after create/delete/load. */
  function bindActiveWalletForms(activeList) {
    const data = activeWalletRows(activeList);
    const first = data[0]?.id || "";
    const second = data[1]?.id || "";
    setTxForm((prev) => {
      const fromId = isActiveWalletId(prev.account_id, data) ? prev.account_id : first;
      let toId = isActiveWalletId(prev.to_account_id, data) ? prev.to_account_id : second;
      if (!toId || String(toId) === String(fromId)) {
        toId = second && String(second) !== String(fromId) ? second : "";
      }
      return {
        ...prev,
        account_id: fromId,
        to_account_id: toId,
      };
    });
    setSavingsForm((prev) => ({
      ...prev,
      wallet_account_id: isActiveWalletId(prev.wallet_account_id, data) ? prev.wallet_account_id : first,
    }));
    setSavingsAction((prev) => ({
      ...prev,
      wallet_account_id: isActiveWalletId(prev.wallet_account_id, data) ? prev.wallet_account_id : first,
    }));
    setLoanForm((prev) => ({
      ...prev,
      wallet_account_id: isActiveWalletId(prev.wallet_account_id, data) ? prev.wallet_account_id : first,
    }));
    setLoanPaymentForm((prev) => ({
      ...prev,
      wallet_account_id: isActiveWalletId(prev.wallet_account_id, data) ? prev.wallet_account_id : first,
    }));
    setGoalContributionForm((prev) => ({
      ...prev,
      wallet_account_id: isActiveWalletId(prev.wallet_account_id, data) ? prev.wallet_account_id : first,
    }));
    setRecurringForm((prev) => ({
      ...prev,
      account_id: isActiveWalletId(prev.account_id, data) ? prev.account_id : first,
    }));
  }

  const [txForm, setTxForm] = useState({
    type: "income",
    account_id: "",
    to_account_id: "",
    category_id: "",
    amount: "",
    currency: "BDT",
    description: "",
    split_enabled: false,
    split_member_a: "",
    split_member_b: "",
  });
  const [voidBusyId, setVoidBusyId] = useState("");
  const [attachBusyId, setAttachBusyId] = useState("");

  const [savingsForm, setSavingsForm] = useState({
    wallet_account_id: "",
    name: "",
    goal_type: "GENERAL",
    target_amount: "",
    currency: "BDT",
    note: "",
  });
  const [savingsAnnualPlan, setSavingsAnnualPlan] = useState(null);

  const [savingsAction, setSavingsAction] = useState({
    action: "deposit",
    savings_goal_id: "",
    wallet_account_id: "",
    amount: "",
    currency: "BDT",
    description: "",
  });

  const [loanForm, setLoanForm] = useState({
    wallet_account_id: "",
    loan_type: "GIVEN",
    person_name: "",
    principal_amount: "",
    currency: "BDT",
    note: "",
    interest_rate: "0",
    interest_type: "NONE",
    installment_count: "",
    start_date: "",
  });

  const [loanPaymentForm, setLoanPaymentForm] = useState({
    loan_id: "",
    wallet_account_id: "",
    amount: "",
    currency: "BDT",
    description: "",
  });

  const [budgetForm, setBudgetForm] = useState({
    category_id: "",
    name: "",
    budget_amount: "",
    currency: "BDT",
    period_type: "MONTHLY",
    note: "",
  });

  const [recurringForm, setRecurringForm] = useState({
    account_id: "",
    category_id: "",
    title: "",
    transaction_type: "EXPENSE",
    amount: "",
    currency: "BDT",
    frequency: "MONTHLY",
    start_date: new Date().toISOString().slice(0, 10),
    end_date: "",
    description: "",
  });

  function showToast(message, type = "success") {
    setToast({ message, type });
    const ms = type === "error" || type === "warning" ? 8000 : 4500;
    setTimeout(() => setToast(null), ms);
  }

  function setMessage(message, type = "success") {
    // Single surface only — toast. Avoid duplicate top+bottom banners.
    setStatus("");
    showToast(message, type);
  }

  /** Surface auth/sync soft failures in UI (still logs to console). */
  function softFail(scope, err, type = "warning") {
    const detail = String(err?.message || err || "").trim();
    console.warn(`[S4 ${scope}]`, err);
    if (!detail) {
      setMessage(`${scope}: ${t("somethingWentWrong") || "Something went wrong"}`, type);
      return;
    }
    setMessage(`${scope}: ${detail}`, type);
  }

  const isAppAuthed = Boolean(token);

  function isCloudLocalMode() {
    // Offline-first local data plane (IndexedDB). Used when the device has no
    // internet so UI + local/Google-Drive backup blobs still get real data.
    // Firebase shim is gone — api* helpers must not fall through to the network.
    return Boolean(activeFamilyId) && !isBrowserOnline();
  }

  function selectActiveFamily(familyId, meta = {}) {
    const id = String(familyId || "").trim();
    if (!id) {
      setActiveFamilyId("");
      persistCloudFamilyId("");
      return;
    }
    persistCloudFamilyId(id);
    setActiveFamilyId(id);
    if (meta && (meta.name || meta.default_currency || meta.timezone || meta.owner_uid)) {
      setFamilies((prev) => {
        const row = {
          id,
          name: meta.name || t("cloudOnlyFamilyLabel"),
          default_currency: meta.default_currency,
          timezone: meta.timezone,
          owner_uid: meta.owner_uid,
          ...meta,
        };
        if ((prev || []).some((f) => f.id === id)) {
          return (prev || []).map((f) => (f.id === id ? { ...f, ...row } : f));
        }
        return [row, ...(prev || [])];
      });
    }
  }

  function isCloudEmailReady(user = firebaseUser) {
    if (!user?.uid) return false;
    if (!REQUIRE_EMAIL_VERIFICATION) return true;
    return isFirebaseEmailVerified(user);
  }

  /** Finance snapshot sync: allow even before email verify (rules allow own snapshots). */
  function canSyncCloudFinance(user = firebaseUser) {
    return Boolean(user?.uid);
  }

  async function pushCloudSnapshotIfReady(userOverride = null, familyIdOverride = null) {
    const user = userOverride || firebaseUser;
    const familyId = familyIdOverride || activeFamilyId;
    if (!user?.uid || !familyId) return { ok: false, skipped: true };
    if (!canSyncCloudFinance(user)) return { ok: false, skipped: true };
    if (!isBrowserOnline()) return { ok: false, offline: true };
    try {
      await pushCloudSnapshot({
        uid: user.uid,
        familyId,
        deviceLabel: SYNC_DEVICE_ID || "mobile",
        email: user.email || null,
        displayName: user.displayName || null,
      });
      return { ok: true };
    } catch (err) {
      softFail("Sync push", err);
      return { ok: false, error: err };
    }
  }

  /** Pull shared cloud snapshot into IDB, then refresh React state (multi-device wallets/tx). */
  async function pullAndHydrateCloudLocal(userOverride = null, familyIdOverride = null) {
    const user = userOverride || firebaseUser;
    const familyId = familyIdOverride || activeFamilyId || loadCloudFamilyId();
    if (!user?.uid || !familyId) return { restored: 0 };
    if (!canSyncCloudFinance(user) || !isBrowserOnline()) return { restored: 0 };
    try {
      const result = await pullCloudSnapshot(user.uid);
      const fid = result?.familyId || familyId;
      if (fid) {
        persistCloudFamilyId(fid);
        if (String(fid) !== String(activeFamilyId || "")) {
          setActiveFamilyId(fid);
        }
        try {
          const { reconcileWalletBalancesForFamily, reconcileSavingsFromLedgerForFamily } = await import("./lib/offlineCache");
          await reconcileWalletBalancesForFamily(fid);
          await reconcileSavingsFromLedgerForFamily(fid);
        } catch {
          /* ignore */
        }
        await hydrateFromCloudCache(fid);
        await refreshCloudLocalAll();
      }
      return result || { restored: 0 };
    } catch (err) {
      softFail("Sync pull", err);
      return { restored: 0, error: err };
    }
  }

  /** Push local first, then pull-merge — prevents empty remote bags from racing over new writes. */
  async function syncCloudLocalBidirectional(userOverride = null, familyIdOverride = null) {
    await pushCloudSnapshotIfReady(userOverride, familyIdOverride);
    await pullAndHydrateCloudLocal(userOverride, familyIdOverride);
  }

  async function loadOfflineFinanceCache(module, name) {
    if (!activeFamilyId) return undefined;
    const cached = await loadOfflineSnapshot(activeFamilyId, module, name).catch(() => null);
    return cached?.data;
  }

  function enableCloudAutoSyncDefaults() {
    if (!FIREBASE_CONFIGURED) return;
    const next = saveCloudAutoSyncSettings({
      ...cloudAutoSyncRef.current,
      enabled: true,
      firebase: true,
      intervalMinutes: 15,
    });
    setCloudAutoSync(next);
    cloudAutoSyncRef.current = next;
  }

  async function refreshCloudLocalAll() {
    await loadWallets();
    await loadCategories();
    await loadTransactions();
    await loadSavings();
    await loadLoans();
    await loadBudgets();
    await loadRecurring();
    await loadGoals();
    await loadDashboard();
    await loadGrocery({ silent: true });
    await loadPhase15();
    await loadPhase16();
    await loadZakat();
    await loadCurrencyData();
    await loadAuditTrail();
    await loadNotifications();
    await loadReports();
    await loadBackups();
    await loadSyncStatus();
  }

  async function activateCloudSession(user, familyId, familyName = "", options = {}) {
    const bindRole = String(options.role || "MEMBER").toUpperCase() === "OWNER" ? "OWNER" : "MEMBER";
    persistCloudOnlyMode(true);
    setCloudOnlyMode(true);
    persistCloudFamilyId(familyId);
    setActiveFamilyId(familyId);
    setFirebaseUser(user);
    if (familyId && user?.uid) {
      try {
        await Promise.race([
          bindCloudFamilyIdentity({
            uid: user.uid,
            familyId,
            email: user.email || null,
            displayName: user.displayName || null,
            familyName: familyName || familyId,
            role: bindRole,
          }),
          new Promise((resolve) => {
            window.setTimeout(resolve, 5000);
          }),
        ]);
      } catch (err) {
        const raw = String(err?.message || err?.code || "");
        if (/permission-denied|insufficient permissions/i.test(raw)) {
          softFail(
            "Family bind",
            new Error(
              appLanguage === "bn"
                ? "Firebase permission — deploy/firebase/firestore.rules Console-এ Publish করুন, তারপর Sign out → Sign in। Invite Generate আবার চেষ্টা করুন।"
                : "Firebase permission — Publish deploy/firebase/firestore.rules in Console, then Sign out → Sign in. Try Generate invite again.",
            ),
          );
        } else {
          softFail("Family bind", err);
        }
      }
    }
    setFamilies([{ id: familyId, name: familyName || t("cloudOnlyFamilyLabel") }]);
    setCurrentUser({
      full_name: user.displayName || user.email || "Cloud User",
      email: user.email || "",
      is_email_verified: isFirebaseEmailVerified(user),
      is_active: true,
      uid: user.uid,
      firebase_uid: user.uid,
    });
    // Release loading gates immediately so splash is not followed by a stuck "Please wait" screen
    setIsFamilyLoading(false);
    setSessionBootstrapping(false);

    await applyCloudUserAvatar(user);
    // Pull shared family snapshot BEFORE hydrating UI so wallets from other devices appear
    if (isBrowserOnline() && canSyncCloudFinance(user)) {
      try {
        const restored = await Promise.race([
          pullCloudSnapshot(user.uid),
          new Promise((resolve) => {
            window.setTimeout(() => resolve(null), 10000);
          }),
        ]);
        if (restored?.familyId) {
          persistCloudFamilyId(restored.familyId);
          familyId = restored.familyId;
          setActiveFamilyId(restored.familyId);
        }
        try {
          const { reconcileWalletBalancesForFamily, reconcileSavingsFromLedgerForFamily } = await import("./lib/offlineCache");
          await reconcileWalletBalancesForFamily(familyId);
          await reconcileSavingsFromLedgerForFamily(familyId);
        } catch {
          /* ignore */
        }
      } catch (err) {
        softFail("Sync activate", err);
      }
    }
    await hydrateFromCloudCache(familyId);
    try {
      await refreshCloudLocalAll();
    } catch {
      /* loaders may depend on family id already set */
    }
    try {
      const { loadOfflineSnapshot } = await import("./lib/offlineCache");
      const profileRow = await loadOfflineSnapshot(familyId, "system", "familyProfile");
      const profile = profileRow?.data || {};
      setFamilies([
        {
          id: familyId,
          name: profile.name || familyName || t("cloudOnlyFamilyLabel"),
          default_currency: profile.default_currency || profile.currency || "BDT",
          timezone: profile.timezone || "Asia/Dhaka",
          owner_uid: profile.owner_uid || profile.owner_id || undefined,
        },
      ]);
    } catch {
      /* keep basic family row */
    }
    try {
      await seedCloudModuleCaches(familyId, {
    ownerName: user.displayName || user.email || "Owner",
    ownerEmail: user.email || "",
    ownerUid: user.uid || "",
  });
    } catch {
      /* already seeded or storage unavailable */
    }
    await refreshFirebaseMeta(user.uid, user);
    enableCloudAutoSyncDefaults();
    // Non-blocking cloud push — do not hold the UI
    if (isBrowserOnline() && canSyncCloudFinance(user)) {
      void pushCloudSnapshotIfReady(user, familyId);
    }
    if (isCloudEmailReady(user) && !loadBackupOnboardingDone(user.uid)) {
      setShowBackupOnboarding(true);
    }
  }

  function finishBackupOnboarding(skipped = false) {
    if (firebaseUser?.uid) saveBackupOnboardingDone(firebaseUser.uid, skipped);
    setShowBackupOnboarding(false);
  }

  async function handleOnboardingDriveConnect() {
    await handleDriveConnect();
  }

  async function handleOnboardingPickFolder() {
    await handlePickLocalFolder();
    if (getStoredFolderLabel()) {
      const next = saveCloudAutoSyncSettings({
        ...cloudAutoSyncRef.current,
        enabled: true,
        local: true,
        firebase: true,
      });
      setCloudAutoSync(next);
      cloudAutoSyncRef.current = next;
    }
  }

  async function resolveCloudFamilyId(uid, user = null) {
    try {
      const familyId = await Promise.race([
        resolveAndBindUserFamily({
          uid,
          email: user?.email || null,
          displayName: user?.displayName || null,
          localFamilyId: loadCloudFamilyId() || "",
        }),
        new Promise((resolve) => {
          window.setTimeout(() => resolve(loadCloudFamilyId() || ""), 12000);
        }),
      ]);
      return String(familyId || loadCloudFamilyId() || "");
    } catch (err) {
      softFail("Family resolve", err);
      return loadCloudFamilyId() || "";
    }
  }

  /** Direct cloud profile/membership restore — used by Refresh when local family_id is empty. */
  async function restoreFamilyFromCloud(userOverride = null) {
    const user = userOverride || firebaseUser;
    if (!user?.uid) {
      throw new Error(
        appLanguage === "bn"
          ? "লগইন নেই — Logout করে Wife ইমেইল/পাসওয়ার্ড দিয়ে Login করুন"
          : "Not signed in — Logout and Login with Wife email/password",
      );
    }
    let fid = "";
    try {
      const { getUserFamilyProfile } = await import("./firebase/cloudSync");
      const profile = await getUserFamilyProfile(user.uid);
      fid = String(profile?.family_id || "").trim();
    } catch (err) {
      console.warn("[S4] getUserFamilyProfile failed", err);
    }
    if (!fid) {
      try {
        const { findFamilyIdsForUid } = await import("./firebase/familyCloud");
        const ids = await findFamilyIdsForUid(user.uid);
        fid = String(ids?.[0] || "").trim();
      } catch (err) {
        console.warn("[S4] findFamilyIdsForUid failed", err);
      }
    }
    if (!fid) {
      fid = await resolveCloudFamilyId(user.uid, user);
    }
    if (!fid) {
      throw new Error(
        appLanguage === "bn"
          ? "ক্লাউডে এই অ্যাকাউন্টের পরিবার পাওয়া যায়নি। ইন্টারনেট চেক করে আবার Refresh চাপুন।"
          : "No cloud family found for this account. Check internet and tap Refresh again.",
      );
    }
    persistCloudFamilyId(fid);
    await activateCloudSession(user, fid);
    return fid;
  }

  function applyOfflineCacheToState(cache) {
    const phase15 = cache["life/phase15"];
    const phase16 = cache["life/phase16"];
    if (Array.isArray(cache["finance/wallets"])) setWallets(cache["finance/wallets"]);
    if (Array.isArray(cache["finance/categories"])) setCategories(cache["finance/categories"]);
    if (Array.isArray(cache["finance/transactions"])) setTransactions(cache["finance/transactions"]);
    {
      const rawSav = cache["finance/savings"];
      const list = normalizeSavingsList(rawSav);
      if (list.length || Array.isArray(rawSav)) {
        const txs = Array.isArray(cache["finance/transactions"]) ? cache["finance/transactions"] : transactions;
        setSavings(recomputeSavingsFromLedger(list, txs));
      }
    }
    if (Array.isArray(cache["finance/loans"])) setLoans(cache["finance/loans"]);
    {
      const rawBudgets = cache["finance/budgets"];
      const list = normalizeBudgetsList(rawBudgets);
      if (list.length || Array.isArray(rawBudgets) || (rawBudgets && typeof rawBudgets === "object")) {
        const cats = Array.isArray(cache["finance/categories"]) ? cache["finance/categories"] : categories;
        const txs = Array.isArray(cache["finance/transactions"]) ? cache["finance/transactions"] : transactions;
        setBudgets(enrichBudgetsFromLedger(list, txs, cats));
      }
    }
    if (Array.isArray(cache["finance/recurring"])) setRecurringItems(cache["finance/recurring"]);
    if (Array.isArray(cache["finance/goals"])) setGoals(cache["finance/goals"]);
    if (cache["finance/goalSummary"]) setGoalSummary(cache["finance/goalSummary"]);
    if (Array.isArray(phase15?.items)) {
      // Don't clobber non-empty React state with an empty hydrate bag (race after create).
      setPhase15Items((prev) => (phase15.items.length || !prev?.length ? phase15.items : prev));
      if (phase15.summary?.modules) {
        setPhase15Summary(phase15.summary);
      } else if (phase15.items.length) {
        setPhase15Summary(summarizeLifeItems(phase15.items, LIFE15));
      }
    }
    if (Array.isArray(phase16?.items)) {
      setPhase16Items((prev) => (phase16.items.length || !prev?.length ? phase16.items : prev));
      if (phase16.summary?.modules) {
        setPhase16Summary(phase16.summary);
      } else if (phase16.items.length) {
        setPhase16Summary(summarizeLifeItems(phase16.items, LIFE16));
      }
    }
    if (cache["zakat/main"]) {
      const raw = cache["zakat/main"];
      const records = Array.isArray(raw) ? raw : raw?.records || raw?.items || [];
      setZakatRecords((prev) => (records.length || !prev?.length ? records : prev));
      if (cache["zakat/summary"]) {
        setZakatSummary(cache["zakat/summary"]);
      } else if (records.length) {
        setZakatSummary({
          record_count: records.length,
          count: records.length,
          total_zakat_due: records.reduce((sum, r) => sum + (Number(r.zakat_due) || 0), 0),
          latest: records[0] || null,
        });
      }
    } else if (cache["zakat/summary"]) {
      setZakatSummary(cache["zakat/summary"]);
    }
    if (cache["reports/overview"]) {
      const raw = cache["reports/overview"];
      if (raw?.financial || raw?.wallet) {
        setFinancialReport(raw.financial || null);
        setWalletReport(raw.wallet || null);
      } else if (raw?.summary) {
        setFinancialReport(raw);
      }
    }
    if (cache["system/currency"]) {
      const bag = cache["system/currency"];
      if (bag && typeof bag === "object" && (bag.currencies || bag.exchangeRates || bag.currencySummary)) {
        if (Array.isArray(bag.currencies)) setCurrencies(bag.currencies);
        if (Array.isArray(bag.exchangeRates)) setExchangeRates(bag.exchangeRates);
        if (bag.currencySummary) setCurrencySummary(bag.currencySummary);
        else if (bag.base_currency || bag.code) {
          setCurrencySummary({
            base_currency: bag.base_currency || bag.code,
            wallet_count: bag.wallet_count || 0,
            total_converted_balance: bag.total_converted_balance || 0,
            wallets: bag.wallets || [],
          });
        }
      } else {
        setCurrencySummary(bag);
      }
    }
    if (cache["system/backup"]) {
      const bag = cache["system/backup"];
      if (bag?.integrity) setBackupIntegrity(bag.integrity);
      if (bag?.list) setBackupList(bag.list);
    }
    setDashboard(buildDashboardFromCache(cache));
  }

  async function hydrateFromCloudCache(familyId) {
    // Always reconcile savings from ledger before UI hydrate (anti stale progress)
    try {
      const { reconcileSavingsFromLedgerForFamily } = await import("./lib/offlineCache");
      await reconcileSavingsFromLedgerForFamily(familyId);
    } catch {
      /* ignore */
    }
    const cache = await hydrateFamilyFromOfflineCache(familyId);
    applyOfflineCacheToState(cache);
    return cache;
  }

  async function _handleCloudEmailSignIn({ email, password }) {
    if (!FIREBASE_CONFIGURED || !FIREBASE_FIRST_MODE) {
      setMessage(t("firebaseNotConfigured"), "error");
      return;
    }
    setCloudBusy(true);
    setAuthLoading(true);
    setStatus(t("signingIn"));
    try {
      const user = await Promise.race([
        firebaseSignInEmail(email, password),
        new Promise((_, reject) => {
          window.setTimeout(
            () => reject(new Error(appLanguage === "bn" ? "লগইন সময় শেষ — ইন্টারনেট/Firebase চেক করুন।" : "Sign-in timed out — check internet/Firebase.")),
            15000,
          );
        }),
      ]);

      try {
        await Promise.race([
          ensureUserProfile(user.uid, user),
          new Promise((resolve) => {
            window.setTimeout(resolve, 4000);
          }),
        ]);
      } catch (err) {
        softFail("Profile sync", err);
      }

      // Must verify email before entering the family dashboard
      if (REQUIRE_EMAIL_VERIFICATION && !isFirebaseEmailVerified(user)) {
        let pendingFamilyId = loadCloudFamilyId();
        try {
          pendingFamilyId =
            (await Promise.race([
              resolveCloudFamilyId(user.uid, user),
              new Promise((resolve) => {
                window.setTimeout(() => resolve(loadCloudFamilyId() || ""), 8000);
              }),
            ])) || pendingFamilyId;
        } catch {
          /* ignore */
        }
        if (pendingFamilyId) {
          persistCloudFamilyId(pendingFamilyId);
          setActiveFamilyId(pendingFamilyId);
        }
        persistCloudOnlyMode(true);
        setCloudOnlyMode(true);
        setFirebaseUser(user);
        setCurrentUser({
          full_name: user.displayName || user.email || "Cloud User",
          email: user.email || "",
          is_email_verified: false,
          is_active: true,
          uid: user.uid,
          firebase_uid: user.uid,
        });
        setIsFamilyLoading(false);
        setSessionBootstrapping(false);
        setMessage(t("verifyEmailBeforeApp") || t("verifyEmailTitle"), "warning");
        return;
      }

      const familyId = await Promise.race([
        resolveCloudFamilyId(user.uid, user),
        new Promise((resolve) => {
          window.setTimeout(() => resolve(loadCloudFamilyId() || ""), 6000);
        }),
      ]);
      if (!familyId) {
        setFirebaseUser(user);
        setCurrentUser({
          full_name: user.displayName || user.email || "Cloud User",
          email: user.email || "",
          is_email_verified: isFirebaseEmailVerified(user),
          is_active: true,
          uid: user.uid,
          firebase_uid: user.uid,
        });
        setMessage(t("cloudOnlyNoDataCreate"), "warning");
        return { needsFamilySetup: true };
      }

      const activatePromise = activateCloudSession(user, familyId);
      setAuthLoading(false);
      setStatus("");
      setCloudBusy(false);

      try {
        await Promise.race([
          activatePromise,
          new Promise((resolve) => {
            window.setTimeout(resolve, 8000);
          }),
        ]);
      } catch (err) {
        softFail("Session activate", err);
      }
      setMessage(t("cloudOnlySignInSuccess"), "success");
    } catch (err) {
      setMessage(err.message || t("firebaseSyncFailed"), "error");
    } finally {
      setCloudBusy(false);
      setAuthLoading(false);
      setStatus((current) => (current === t("signingIn") ? "" : current));
    }
  }

  async function _handleCreateCloudFamily({
    email,
    password,
    fullName,
    familyName,
    currency,
    timezone,
    ownerRelation,
  }) {
    if (!FIREBASE_CONFIGURED || !FIREBASE_FIRST_MODE) {
      setMessage(t("firebaseNotConfigured"), "error");
      return;
    }
    setCloudBusy(true);
    setAuthLoading(true);
    setStatus(t("creatingFamilyGate"));
    try {
      const created = await Promise.race([
        createCloudFamilyAccount({
          email,
          password,
          fullName,
          familyName,
          currency,
          timezone,
          ownerRelation,
          deviceLabel: SYNC_DEVICE_ID || "mobile",
        }),
        new Promise((_, reject) => {
          window.setTimeout(
            () =>
              reject(
                new Error(
                  appLanguage === "bn"
                    ? "ফ্যামিলি তৈরি সময় শেষ — ইন্টারনেট/Firebase চেক করে আবার চেষ্টা করুন।"
                    : "Create family timed out — check internet/Firebase and try again.",
                ),
              ),
            35000,
          );
        }),
      ]);
      const { user, familyId, existing, verificationSent, verificationError } = created;

      // Keep session + show EmailVerificationGate (do NOT sign out — that forced a second Login
      // and made users think verify only happens after login).
      if (REQUIRE_EMAIL_VERIFICATION && !isFirebaseEmailVerified(user)) {
        if (familyId) {
          persistCloudFamilyId(familyId);
          setActiveFamilyId(familyId);
        }
        persistCloudOnlyMode(true);
        setCloudOnlyMode(true);
        setFirebaseUser(user);
        setCurrentUser({
          full_name: user.displayName || fullName || user.email || "Cloud User",
          email: user.email || email || "",
          is_email_verified: false,
          is_active: true,
          uid: user.uid,
          firebase_uid: user.uid,
        });
        setIsFamilyLoading(false);
        setSessionBootstrapping(false);
        setAuthLoading(false);
        setCloudBusy(false);
        setStatus("");
        if (verificationError) {
          const lang = appLanguage === "bn" ? "bn" : "en";
          setMessage(
            `${t("cloudFamilyCreatedVerify") || "Family created — verify email."} ${formatFirebaseAuthError(verificationError, lang)}`,
            "warning",
          );
        } else {
          setMessage(
            t("cloudFamilyCreatedVerify") ||
              "Family created. Check inbox/spam for the verification link, then tap Refresh.",
            "success",
          );
        }
        return;
      }

      const activatePromise = activateCloudSession(user, familyId, familyName, { role: "OWNER" });
      setAuthLoading(false);
      setStatus("");
      setCloudBusy(false);

      try {
        await Promise.race([
          activatePromise,
          new Promise((resolve) => {
            window.setTimeout(resolve, 15000);
          }),
        ]);
      } catch (err) {
        softFail("Session activate", err);
      }

      if (existing) {
        setMessage(t("cloudFamilyRestored"), "success");
      } else if (verificationSent) {
        setMessage(t("cloudFamilyCreatedVerify"), "success");
      } else if (verificationError) {
        const lang = appLanguage === "bn" ? "bn" : "en";
        setMessage(
          `${t("cloudFamilyCreated")} — ${formatFirebaseAuthError(verificationError, lang)}`,
          "warning",
        );
      } else {
        setMessage(t("cloudFamilyCreated"), "success");
      }
    } catch (err) {
      const lang = appLanguage === "bn" ? "bn" : "en";
      const raw = String(err?.message || "");
      const timedOut =
        /timed out|সময় শেষ|time out/i.test(raw) ||
        /Create family timed out|ফ্যামিলি তৈরি সময় শেষ/i.test(raw);
      const localFid = loadCloudFamilyId();
      // Auth often succeeds before Firestore finishes — local family_id is already saved.
      if (timedOut && localFid) {
        persistCloudFamilyId(localFid);
        try {
          await firebaseSignOut();
        } catch {
          /* ignore */
        }
        setFirebaseUser(null);
        setCurrentUser(null);
        setCloudOnlyMode(false);
        persistCloudOnlyMode(false);
        setActiveFamilyId("");
        setIsFamilyLoading(false);
        setSessionBootstrapping(false);
        setMessage(
          t("cloudFamilyCreatedVerifyThenLogin") ||
            "Account created. Verify your email, then Login. If Login says no family, tap Create family again with the same password.",
          "warning",
        );
        return;
      }
      setMessage(formatFirebaseAuthError(err, lang) || err.message || t("familyCreateFailed"), "error");
    } finally {
      setCloudBusy(false);
      setAuthLoading(false);
      setStatus((current) => (current === t("creatingFamilyGate") ? "" : current));
    }
  }

  async function _handleCloudJoinFamily({ email, password, fullName, inviteCode, relationshipType }) {
    if (!FIREBASE_CONFIGURED || !FIREBASE_FIRST_MODE) {
      setMessage(t("firebaseNotConfigured"), "error");
      return;
    }
    setCloudBusy(true);
    setAuthLoading(true);
    setStatus(t("joiningFamilyGate"));
    try {
      let user;
      try {
        const registered = await firebaseRegisterEmail(email, password, fullName);
        user = registered.user;
      } catch (err) {
        const code = String(err?.code || "");
        if (code.includes("email-already-in-use")) {
          user = await firebaseSignInEmail(email, password);
        } else {
          throw err;
        }
      }

      try {
        await Promise.race([
          ensureUserProfile(user.uid, user),
          new Promise((resolve) => {
            window.setTimeout(resolve, 4000);
          }),
        ]);
      } catch {
        /* optional */
      }

      const result = await Promise.race([
        joinFamilyByInviteCode({
          code: inviteCode,
          uid: user.uid,
          email: user.email || email,
          displayName: fullName || user.displayName || "Member",
          relationshipType: relationshipType || "Relative",
        }),
        new Promise((_, reject) => {
          window.setTimeout(
            () =>
              reject(
                new Error(
                  appLanguage === "bn"
                    ? "ইনভাইট জয়েন সময় শেষ — কোড ও ইন্টারনেট চেক করুন।"
                    : "Join timed out — check invite code and internet.",
                ),
              ),
            25000,
          );
        }),
      ]);

      const familyId = result?.familyId;
      if (!familyId) {
        throw new Error(t("joinFailedGate") || "Join failed");
      }

      if (REQUIRE_EMAIL_VERIFICATION && !isFirebaseEmailVerified(user)) {
        persistCloudFamilyId(familyId);
        persistCloudOnlyMode(true);
        setCloudOnlyMode(true);
        setActiveFamilyId(familyId);
        setFirebaseUser(user);
        setCurrentUser({
          full_name: user.displayName || fullName || user.email || "Cloud User",
          email: user.email || email || "",
          is_email_verified: false,
          is_active: true,
          uid: user.uid,
          firebase_uid: user.uid,
        });
        setIsFamilyLoading(false);
        setSessionBootstrapping(false);
        setMessage(t("verifyEmailBeforeApp") || t("verifyEmailTitle"), "warning");
        return;
      }

      await activateCloudSession(user, familyId, "", { role: "MEMBER" });
      setMessage(t("joinFamilySuccess") || t("joinRequestedOk") || "Joined family successfully", "success");
    } catch (err) {
      const lang = appLanguage === "bn" ? "bn" : "en";
      setMessage(formatFirebaseAuthError(err, lang) || err.message || t("joinFailedGate"), "error");
    } finally {
      setCloudBusy(false);
      setAuthLoading(false);
      setStatus((current) => (current === t("joiningFamilyGate") ? "" : current));
    }
  }

  async function refreshFirebaseMeta(uid, userOverride = null) {
    if (!uid || !FIREBASE_CONFIGURED) return;
    const user = userOverride || firebaseUser;
    if (!isCloudEmailReady(user) && REQUIRE_EMAIL_VERIFICATION) {
      setFirebaseMeta(null);
      return;
    }
    try {
      const meta = await getCloudSnapshotMeta(uid);
      setFirebaseMeta(meta);
    } catch {
      setFirebaseMeta(null);
    }
  }

  async function refreshDriveFileList() {
    if (!DRIVE_CONFIGURED || !getStoredDriveToken()) {
      setDriveFiles([]);
      setDriveConnected(false);
      return;
    }
    try {
      const token = await getDriveAccessToken();
      const files = await listDriveBackups(token);
      setDriveFiles(files);
      setDriveConnected(true);
    } catch {
      setDriveConnected(Boolean(getStoredDriveToken()));
    }
  }

  async function handlePickLocalFolder() {
    if (!LOCAL_FOLDER_SUPPORTED) {
      setMessage(isNativeApp() ? t("localBackupMobileHint") : t("localBackupUnsupported"), "warning");
      return;
    }
    setCloudBusy(true);
    try {
      const handle = await pickBackupFolder();
      setLocalFolderLabel(handle.name || getStoredFolderLabel());
      setMessage(t("localBackupFolderSaved"), "success");
    } catch (err) {
      setMessage(err.message || t("localBackupFailed"), "error");
    } finally {
      setCloudBusy(false);
    }
  }

  async function handleLocalBackup() {
    setCloudBusy(true);
    try {
      const { blob, fileName } = await buildBackupBlob(activeFamilyId, SYNC_DEVICE_ID);
      const result = await writeBackupToFolder(blob, fileName);
      setLocalFolderLabel(result.folder || getStoredFolderLabel());
      setMessage(`${t("localBackupSaved")} (${result.fileName})`, "success");
    } catch (err) {
      setMessage(err.message || t("localBackupFailed"), "error");
    } finally {
      setCloudBusy(false);
    }
  }

  async function handleLocalRestore() {
    if (!window.confirm(t("firebaseRestoreConfirm"))) return;
    setCloudBusy(true);
    try {
      const { blob } = await readLatestBackupFromFolder();
      const result = await restoreBackupBlob(blob, { expectedFamilyId: activeFamilyId || null });
      if (result.familyId && !activeFamilyId) selectActiveFamily(result.familyId);
      setMessage(`${t("localBackupRestored")} (${result.restored})`, "success");
      if (token && (activeFamilyId || result.familyId)) await loadDashboard();
    } catch (err) {
      setMessage(err.message || t("localBackupFailed"), "error");
    } finally {
      setCloudBusy(false);
    }
  }

  async function handleLocalDownload() {
    setCloudBusy(true);
    try {
      const { blob, fileName } = await buildBackupBlob(activeFamilyId, SYNC_DEVICE_ID);
      await downloadBackupFile(blob, fileName);
      setMessage(t("localBackupDownloaded"), "success");
    } catch (err) {
      setMessage(err.message || t("localBackupFailed"), "error");
    } finally {
      setCloudBusy(false);
    }
  }

  function enableDriveAutoSyncDefaults() {
    const next = saveCloudAutoSyncSettings({
      ...cloudAutoSyncRef.current,
      enabled: true,
      local: true,
      drive: true,
      firebase: false,
      intervalMinutes: cloudAutoSyncRef.current?.intervalMinutes || 15,
    });
    setCloudAutoSync(next);
    cloudAutoSyncRef.current = next;
  }

  async function applyDriveBackupRestore(driveToken, fileId) {
    const blob = await downloadDriveBackup(driveToken, fileId);
    const result = await restoreBackupBlob(blob, { expectedFamilyId: activeFamilyId || null });
    if (result.familyId && !activeFamilyId) selectActiveFamily(result.familyId);
    if (token && (activeFamilyId || result.familyId)) await loadDashboard();
    return result;
  }

  async function uploadDriveBackupNow(driveToken) {
    const familyId = activeFamilyId || loadCloudFamilyId() || null;
    const { blob, fileName } = await buildBackupBlob(familyId, SYNC_DEVICE_ID);
    await uploadBackupToDrive(driveToken, fileName, blob);
    return fileName;
  }

  /**
   * After Connect (or session with existing Drive token):
   * - empty local + Drive backup → auto restore
   * - local data + Drive backup → confirm overwrite (Connect only)
   * - local data + no Drive file → auto upload
   * Always enables Drive auto-backup settings.
   */
  async function maybeSyncDriveAfterConnect({ quiet = false, allowConflictPrompt = !quiet } = {}) {
    if (!DRIVE_CONFIGURED || !getStoredDriveToken()) return { ok: false, reason: "not_connected" };
    enableDriveAutoSyncDefaults();

    const driveToken = await getDriveAccessToken();
    const files = await listDriveBackups(driveToken, 1);
    setDriveFiles(files);
    setDriveConnected(true);

    const localHasData = await hasLocalOfflineData(activeFamilyId || loadCloudFamilyId() || null);
    const latest = files[0] || null;

    if (latest && !localHasData) {
      const result = await applyDriveBackupRestore(driveToken, latest.id);
      if (!quiet) setMessage(`${t("driveAutoRestored")} (${result.restored})`, "success");
      return { ok: true, action: "auto_restore", restored: result.restored };
    }

    if (latest && localHasData) {
      if (!allowConflictPrompt) {
        return { ok: true, action: "skipped_conflict" };
      }
      const overwrite = window.confirm(t("driveRestoreConflictConfirm"));
      if (overwrite) {
        const result = await applyDriveBackupRestore(driveToken, latest.id);
        if (!quiet) setMessage(`${t("driveRestoreSuccess")} (${result.restored})`, "success");
        return { ok: true, action: "confirm_restore", restored: result.restored };
      }
      const fileName = await uploadDriveBackupNow(driveToken);
      await refreshDriveFileList();
      if (!quiet) setMessage(`${t("driveUploadSuccess")} (${fileName})`, "success");
      return { ok: true, action: "kept_local_uploaded", fileName };
    }

    if (!latest && localHasData) {
      const fileName = await uploadDriveBackupNow(driveToken);
      await refreshDriveFileList();
      if (!quiet) setMessage(`${t("driveAutoBackupStarted")} (${fileName})`, "success");
      return { ok: true, action: "auto_upload", fileName };
    }

    if (!quiet) setMessage(t("driveConnected"), "success");
    return { ok: true, action: "connected_empty" };
  }

  async function handleDriveConnect() {
    setCloudBusy(true);
    try {
      await connectGoogleDrive({ prompt: "consent" });
      setDriveConnected(true);
      driveConnectSyncOnceRef.current = true;
      await maybeSyncDriveAfterConnect({ quiet: false });
    } catch (err) {
      setMessage(err.message || t("driveBackupFailed"), "error");
    } finally {
      setCloudBusy(false);
    }
  }

  async function handleDriveDisconnect() {
    clearStoredDriveToken();
    setDriveConnected(false);
    setDriveFiles([]);
    driveConnectSyncOnceRef.current = false;
    setMessage(t("driveDisconnect"), "success");
  }

  async function handleDriveUpload() {
    setCloudBusy(true);
    try {
      const tokenDrive = await getDriveAccessToken();
      const fileName = await uploadDriveBackupNow(tokenDrive);
      await refreshDriveFileList();
      enableDriveAutoSyncDefaults();
      setMessage(`${t("driveUploadSuccess")} (${fileName})`, "success");
    } catch (err) {
      setMessage(err.message || t("driveBackupFailed"), "error");
    } finally {
      setCloudBusy(false);
    }
  }

  async function handleDriveRestore() {
    if (!window.confirm(t("firebaseRestoreConfirm"))) return;
    setCloudBusy(true);
    try {
      const driveToken = await getDriveAccessToken();
      const files = await listDriveBackups(driveToken, 1);
      if (!files.length) throw new Error(t("driveNoFiles"));
      const result = await applyDriveBackupRestore(driveToken, files[0].id);
      setMessage(`${t("driveRestoreSuccess")} (${result.restored})`, "success");
    } catch (err) {
      setMessage(err.message || t("driveBackupFailed"), "error");
    } finally {
      setCloudBusy(false);
    }
  }

  function handleCloudAutoSyncChange(next) {
    const saved = saveCloudAutoSyncSettings(next);
    setCloudAutoSync(saved);
    cloudAutoSyncRef.current = saved;
  }

  async function runCloudAutoBackup({ force = false } = {}) {
    const settings = cloudAutoSyncRef.current;
    if (!settings?.enabled && !force) return;
    if (cloudAutoBackupRunningRef.current || cloudBusy) return;
    if (!activeFamilyId) return;
    // Hybrid gate: no cloud/local/drive auto backup until email verified.
    if (cloudOnlyMode && !isCloudEmailReady(firebaseUser)) return;

    cloudAutoBackupRunningRef.current = true;
    let nextSettings = { ...settings };
    let changed = false;
    const now = Date.now();

    try {
      if ((force || shouldRunTarget(settings, "local", now)) && settings.local && LOCAL_FOLDER_SUPPORTED) {
        try {
          const folderHandle = await loadDirectoryHandle();
          if (!folderHandle) throw new Error("no folder");
          const { blob, fileName } = await buildBackupBlob(activeFamilyId, SYNC_DEVICE_ID);
          await writeBackupToFolder(blob, fileName);
          setLocalFolderLabel(getStoredFolderLabel());
          nextSettings = markTargetRun(nextSettings, "local");
          changed = true;
        } catch {
          /* no folder or permission */
        }
      }

      if ((force || shouldRunTarget(settings, "drive", now)) && settings.drive && DRIVE_CONFIGURED && getStoredDriveToken()) {
        try {
          const driveToken = await getDriveAccessToken();
          const { blob, fileName } = await buildBackupBlob(activeFamilyId, SYNC_DEVICE_ID);
          await uploadBackupToDrive(driveToken, fileName, blob);
          nextSettings = markTargetRun(nextSettings, "drive");
          changed = true;
        } catch {
          /* silent auto backup */
        }
      }

      if (
        (force || shouldRunTarget(settings, "firebase", now)) &&
        settings.firebase &&
        FIREBASE_CONFIGURED &&
        firebaseUser?.uid &&
        isCloudEmailReady(firebaseUser)
      ) {
        try {
          await pushCloudSnapshot({
            uid: firebaseUser.uid,
            familyId: activeFamilyId || null,
            deviceLabel: SYNC_DEVICE_ID,
          });
          await refreshFirebaseMeta(firebaseUser.uid);
          nextSettings = markTargetRun(nextSettings, "firebase");
          changed = true;
        } catch {
          /* silent auto backup */
        }
      }

      if (changed) {
        setCloudAutoSync(nextSettings);
        cloudAutoSyncRef.current = nextSettings;
      }
    } finally {
      cloudAutoBackupRunningRef.current = false;
    }
  }

  async function _handleFirebaseGoogleSignIn() {
    if (!FIREBASE_CONFIGURED) {
      setMessage(t("firebaseNotConfigured"), "error");
      return;
    }
    setCloudBusy(true);
    try {
      const user = await firebaseSignInGoogle();
      await ensureUserProfile(user.uid, user);
      setFirebaseUser(user);
      await refreshFirebaseMeta(user.uid);
      setMessage(t("firebaseConnected"), "success");
    } catch (err) {
      setMessage(err.message || t("firebaseSyncFailed"), "error");
    } finally {
      setCloudBusy(false);
    }
  }

  async function _handleFirebaseEmailSignIn() {
    if (!FIREBASE_CONFIGURED) {
      setMessage(t("firebaseNotConfigured"), "error");
      return;
    }
    const mail = window.prompt(t("lblEmail") || "Email", email || "");
    if (!mail) return;
    const pass = window.prompt(t("lblPassword") || "Password");
    if (!pass) return;
    setCloudBusy(true);
    try {
      const user = await firebaseSignInEmail(mail, pass);
      await ensureUserProfile(user.uid, user);
      setFirebaseUser(user);
      await refreshFirebaseMeta(user.uid);
      setMessage(t("firebaseConnected"), "success");
    } catch (err) {
      setMessage(err.message || t("firebaseSyncFailed"), "error");
    } finally {
      setCloudBusy(false);
    }
  }

  async function _handleFirebaseEmailRegister() {
    if (!FIREBASE_CONFIGURED) {
      setMessage(t("firebaseNotConfigured"), "error");
      return;
    }
    const mail = window.prompt(t("lblEmail") || "Email", email || "");
    if (!mail) return;
    const pass = window.prompt(t("lblPassword") || "Password (min 8)");
    if (!pass) return;
    const name = window.prompt(t("lblName") || "Full name", "");
    setCloudBusy(true);
    try {
      const { user } = await firebaseRegisterEmail(mail, pass, name || "");
      await ensureUserProfile(user.uid, user);
      setFirebaseUser(user);
      setMessage(t("firebaseConnected"), "success");
    } catch (err) {
      setMessage(err.message || t("firebaseSyncFailed"), "error");
    } finally {
      setCloudBusy(false);
    }
  }

  async function _handleFirebaseSignOut() {
    setCloudBusy(true);
    try {
      // Cloud-only session: full logout so we don't leave a half-authed shell.
      if (cloudOnlyMode && !token) {
        await firebaseSignOut();
        setFirebaseUser(null);
        setFirebaseMeta(null);
        await logout();
        return;
      }
      await firebaseSignOut();
      setFirebaseUser(null);
      setFirebaseMeta(null);
      setMessage(t("firebaseSignOut"), "success");
    } catch (err) {
      setMessage(err.message || t("firebaseSyncFailed"), "error");
    } finally {
      setCloudBusy(false);
    }
  }

  async function _handleFirebaseSyncNow() {
    if (!firebaseUser?.uid) {
      setMessage(t("firebaseSignInPrompt"), "error");
      return;
    }
    if (!isCloudEmailReady(firebaseUser)) {
      setMessage(t("verifyEmailStillPending"), "warning");
      return;
    }
    setCloudBusy(true);
    try {
      // Pull first so other devices' wallets aren't wiped by a stale push
      await syncCloudLocalBidirectional(firebaseUser, activeFamilyId || loadCloudFamilyId());
      await refreshFirebaseMeta(firebaseUser.uid);
      setMessage(t("firebaseSyncSuccess"), "success");
    } catch (err) {
      setMessage(err.message || t("firebaseSyncFailed"), "error");
    } finally {
      setCloudBusy(false);
    }
  }

  async function _handleFirebaseRestore() {
    if (!firebaseUser?.uid) {
      setMessage(t("firebaseSignInPrompt"), "error");
      return;
    }
    if (!isCloudEmailReady(firebaseUser)) {
      setMessage(t("verifyEmailStillPending"), "warning");
      return;
    }
    if (!window.confirm(t("firebaseRestoreConfirm"))) return;
    setCloudBusy(true);
    try {
      const result = await pullCloudSnapshot(firebaseUser.uid);
      await refreshFirebaseMeta(firebaseUser.uid);
      const fid = result.familyId || activeFamilyId || loadCloudFamilyId();
      if (fid) {
        persistCloudFamilyId(fid);
        if (!activeFamilyId) selectActiveFamily(fid);
        else setActiveFamilyId(fid);
        await hydrateFromCloudCache(fid);
        await refreshCloudLocalAll();
      }
      setMessage(`${t("firebaseRestoreSuccess")} (${result.restored})`, "success");
      if (token && activeFamilyId) {
        await loadDashboard();
      }
    } catch (err) {
      setMessage(err.message || t("firebaseSyncFailed"), "error");
    } finally {
      setCloudBusy(false);
    }
  }

  function t(key) {
    return (
      LOCALE_MESSAGES[appLanguage]?.[key] ||
      UI_TEXT[appLanguage]?.[key] ||
      LOCALE_MESSAGES.en?.[key] ||
      UI_TEXT.en?.[key] ||
      key
    );
  }

  function digits(value) {
    if (value === null || value === undefined) {
      return "";
    }

    const digitSet = LANGUAGE_DIGITS[appLanguage] || LANGUAGE_DIGITS.en;
    return String(value).replace(/\d/g, (digit) => digitSet[Number(digit)]);
  }

  function amount(value, fallback = "0") {
    const raw = value ?? fallback;
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      return digits(String(raw));
    }
    const formatted = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(n);
    return digits(formatted);
  }

  function currencyCode(code) {
    return String(code || currencySummary?.base_currency || activeFamily?.default_currency || "BDT").toUpperCase();
  }

  /** Language-aware short unit: bn→টাকা, en→Tk, ar→درهم … */
  function currencyShort(code) {
    const normalizedCode = currencyCode(code);
    const row = CURRENCY_SHORT[normalizedCode];
    return row?.[appLanguage] || row?.en || normalizedCode;
  }

  function _currencySymbol(code) {
    return currencyShort(code);
  }

  /** Short label for lists/settings (same as money unit). */
  function currencyName(code) {
    const normalizedCode = currencyCode(code);
    return `${currencyShort(normalizedCode)} (${normalizedCode})`;
  }

  function _currencyFullName(code) {
    const normalizedCode = currencyCode(code);
    return CURRENCY_NAMES[normalizedCode]?.[appLanguage] || CURRENCY_NAMES[normalizedCode]?.en || normalizedCode;
  }

  function money(value, code) {
    return `${amount(value)} ${currencyShort(code)}`;
  }

  function changeAppLanguage(code) {
    if (!LOCKED_LANGUAGE_CODES.includes(code)) {
      setMessage(t("languageNotSupported"), "error");
      return;
    }

    setAppLanguage(code);
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, code);
    setMessage(`${t("languageLockedPrefix")}: ${LANGUAGE_LABELS[code] || code}`, "success");
  }

  function expenseCategories() {
    return categories.filter((category) =>
      String(category.category_type || "").toUpperCase().includes("EXPENSE"),
    );
  }

  function totalLoanRemaining(type) {
    return loans
      .filter((loan) => loan.loan_type === type && loan.status === "ACTIVE")
      .reduce((sum, loan) => sum + Number(loan.remaining_amount || 0), 0)
      .toFixed(2);
  }

  function savingsSummary() {
    const active = savings.filter((item) => item.status === "ACTIVE");
    const totalTarget = active.reduce((sum, item) => sum + Number(item.target_amount || 0), 0);
    const totalSaved = active.reduce((sum, item) => sum + Number(item.current_amount || 0), 0);
    const completed = active.filter((item) => Number(item.progress_percent || 0) >= 100);
    const needsAttention = active.filter((item) => Number(item.progress_percent || 0) < 25);

    return {
      activeCount: active.length,
      totalTarget: totalTarget.toFixed(2),
      totalSaved: totalSaved.toFixed(2),
      remaining: Math.max(totalTarget - totalSaved, 0).toFixed(2),
      progressPercent: totalTarget > 0 ? ((totalSaved / totalTarget) * 100).toFixed(2) : "0.00",
      completedCount: completed.length,
      attentionCount: needsAttention.length,
    };
  }


  function savingsAlerts() {
    return savings
      .filter((item) => item.status === "ACTIVE")
      .filter((item) => Number(item.progress_percent || 0) >= 100 || Number(item.progress_percent || 0) < 25);
  }

  function budgetSummary() {
    if (budgetStatus?.summary) {
      return {
        totalBudget: budgetStatus.summary.total_budget || "0",
        totalSpent: budgetStatus.summary.total_spent || "0",
        remaining: budgetStatus.summary.remaining_amount || "0",
        activeCount: budgetStatus.summary.active_count || 0,
        overBudgetCount: budgetStatus.summary.over_budget_count || 0,
        warningCount: budgetStatus.summary.warning_count || 0,
      };
    }

    const status = buildBudgetStatusSummary(budgets);
    return {
      totalBudget: status.summary.total_budget,
      totalSpent: status.summary.total_spent,
      remaining: status.summary.remaining_amount,
      activeCount: status.summary.active_count,
      overBudgetCount: status.summary.over_budget_count,
      warningCount: status.summary.warning_count,
    };
  }


  function budgetAlerts() {
    if (budgetStatus?.summary?.over_budget || budgetStatus?.summary?.warning) {
      return [
        ...(budgetStatus?.summary?.over_budget || []),
        ...(budgetStatus?.summary?.warning || []),
      ];
    }
    return budgets.filter(
      (b) =>
        String(b.status || "").toUpperCase() === "ACTIVE" &&
        (b.is_over_budget || Number(b.used_percent || 0) >= 80),
    );
  }


  function recurringSummary() {
    const today = new Date().toISOString().slice(0, 10);
    const active = recurringItems.filter((item) => item.status === "ACTIVE");
    const dueToday = active.filter((item) => String(item.next_due_date || "") <= today);
    const monthlyAmount = active
      .filter((item) => item.frequency === "MONTHLY")
      .reduce((sum, item) => sum + Number(item.amount || 0), 0);

    return {
      activeCount: active.length,
      dueTodayCount: dueToday.length,
      monthlyAmount: monthlyAmount.toFixed(2),
    };
  }

  function recurringCategories() {
    const want = String(recurringForm.transaction_type || "").toUpperCase();
    return categories.filter(
      (category) => String(category.category_type || "").toUpperCase() === want,
    );
  }

  function isRecurringDue(item) {
    const today = new Date().toISOString().slice(0, 10);
    return item.status === "ACTIVE" && String(item.next_due_date || "") <= today;
  }

  function filteredRecurringItems() {
    const search = recurringSearch.trim().toLowerCase();

    return recurringItems.filter((item) => {
      const matchSearch =
        !search ||
        String(item.title || "").toLowerCase().includes(search) ||
        String(item.description || "").toLowerCase().includes(search);

      const matchStatus =
        recurringStatusFilter === "ALL" || item.status === recurringStatusFilter;

      const matchType =
        recurringTypeFilter === "ALL" || item.transaction_type === recurringTypeFilter;

      return matchSearch && matchStatus && matchType;
    });
  }

  function filteredLoans() {
    const search = loanSearch.trim().toLowerCase();

    return loans.filter((loan) => {
      const matchSearch =
        !search ||
        String(loan.person_name || "").toLowerCase().includes(search) ||
        String(loan.note || "").toLowerCase().includes(search);

      const matchStatus =
        loanStatusFilter === "ALL" || loan.status === loanStatusFilter;

      const matchType = loanTypeFilter === "ALL" || loan.loan_type === loanTypeFilter;

      return matchSearch && matchStatus && matchType;
    });
  }

  function filteredBudgets() {
    const search = budgetSearch.trim().toLowerCase();

    return budgets.filter((budget) => {
      const matchSearch =
        !search ||
        String(budget.name || "").toLowerCase().includes(search) ||
        String(budget.category_name || "").toLowerCase().includes(search) ||
        String(budget.note || "").toLowerCase().includes(search);

      const status = String(budget.status || "").toUpperCase();
      const matchStatus =
        budgetStatusFilter === "ALL" || status === String(budgetStatusFilter || "").toUpperCase();

      return matchSearch && matchStatus;
    });
  }

  async function _login() {
    if (!email.trim() || !password) {
      setMessage(t("emailPasswordRequired"), "error");
      return;
    }

    setAuthLoading(true);
    setStatus(t("signingIn"));

    try {
      const res = await fetch(`${apiBase}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Device-Id": getOrCreateDeviceId() || "" },
        credentials: "include",
        body: JSON.stringify({ email: email.trim(), password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setMessage(data.detail || "Login failed", "error");
        setStatus("");
        return;
      }

      setToken(data.access_token);
      setRefreshToken(data.refresh_token || "");
      persistAuthSession({
        accessToken: data.access_token,
        refreshToken: data.refresh_token || "",
        user: data.user || null,
        apiBase,
      });
      if (data.user) setCurrentUser(data.user);
      setMessage(t("loginSuccessful"), "success");
      setStatus("");
    } catch {
      setMessage(t("backendConnectionFailed"), "error");
      setStatus("");
    } finally {
      setAuthLoading(false);
    }
  }

  async function _registerAccount() {
    if (!fullName.trim() || !email.trim() || !password) {
      setMessage(t("emailPasswordRequired"), "error");
      return;
    }
    if (password.length < 8) {
      setMessage(t("emailPasswordRequired"), "error");
      return;
    }

    setAuthLoading(true);
    setStatus(t("creatingAccount"));
    try {
      const res = await fetch(`${apiBase}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Device-Id": getOrCreateDeviceId() || "" },
        body: JSON.stringify({
          full_name: fullName.trim(),
          email: email.trim(),
          phone: phone.trim() || null,
          password,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const detail = data.detail;
        const msg =
          typeof detail === "object" && detail?.password_errors
            ? detail.password_errors.join(" · ")
            : detail || "Register failed";
        setMessage(msg, "error");
        setStatus("");
        return;
      }
      setAuthView("login");
      setPassword("");
      setMessage(t("registerSuccess"), "success");
      setStatus("");
    } catch {
      setMessage(t("backendConnectionFailed"), "error");
      setStatus("");
    } finally {
      setAuthLoading(false);
    }
  }

  async function _forgotPasswordFromLogin() {
    if (!email.trim()) {
      setMessage(t("emailRequiredPasswordReset"), "error");
      return;
    }
    setAuthLoading(true);
    setStatus(t("sendingReset"));
    try {
      const res = await fetch(`${apiBase}/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.detail || "Reset failed", "error");
        setStatus("");
        return;
      }
      setMessage(t("forgotSent"), "success");
      setAuthView("login");
      setStatus("");
    } catch {
      setMessage(t("backendConnectionFailed"), "error");
      setStatus("");
    } finally {
      setAuthLoading(false);
    }
  }

  async function logout() {
    if (refreshToken) {
      try {
        await fetch(`${apiBase}/auth/logout`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ refresh_token: refreshToken }),
        });
      } catch {
        // Local logout must still work if the revoke request cannot complete.
      }
    }

    try {
      if (firebaseUser || loadCloudOnlyMode()) {
        await firebaseSignOut();
      }
    } catch {
      /* ignore */
    }
    setFirebaseUser(null);
    setFirebaseMeta(null);
    noFamilyAutoRestoreRef.current = "";

    setToken("");
    setRefreshToken("");
    clearAuthSession();
    clearCloudSession();
    setCloudOnlyMode(false);
    setFamilies([]);
    setFamiliesReady(false);
    setActiveFamilyId("");
    persistCloudFamilyId("");
    setIsFamilyLoading(false);
    setSessionBootstrapping(false);
    setCurrentUser(null);
    setMyPermissions(null);
    setMemberPermissions([]);
    setPermissionForms({});
    setDashboard(null);
    setWallets([]);
    setTransactions([]);
    setCategories([]);
    setSavings([]);
    setLoans([]);
    setBudgets([]);
    setBudgetStatus(null);
    setRecurringItems([]);
    setGoals([]);
    setGoalSummary(null);
    setAuditSummary(null);
    setAuditRows([]);
    setFinancialReport(null);
    setWalletReport(null);
    setLedgerReport(null);
    setReportAccountId("");
    setBackupIntegrity(null);
    setBackupList({ count: 0, backups: [] });
    setBackupPreview(null);
    setSyncStatus(null);
    setSyncConflicts([]);
    setSyncPullPreview(null);
    setCurrencies([]);
    setExchangeRates([]);
    setCurrencySummary(null);
    setGovernanceMembers([]);
    setGeneratedInvite(null);
    setInviteSpotlightOpen(false);
    setFamilyPanelTab("members");
    setNotifications([]);
    setNotificationSummary(null);
    setNotificationDelivery(null);
    setZakatRecords([]);
    setZakatSummary(null);
    setPhase15Items([]);
    setPhase15Summary(null);
    setPhase16Items([]);
    setPhase16Summary(null);
    setHistoryModal({ open: false, loading: false, goal: null, history: [] });
    setLoanHistoryModal({ open: false, loading: false, loan: null, history: [] });
    setLoanEditModal({ open: false, loan: null, person_name: "", note: "" });
    setBudgetEditModal({
      open: false,
      budget: null,
      name: "",
      budget_amount: "",
      note: "",
    });
    setRecurringEditModal({
      open: false,
      item: null,
      title: "",
      amount: "",
      frequency: "MONTHLY",
      end_date: "",
      description: "",
    });
    setRecurringHistoryModal({ open: false, loading: false, item: null, history: [] });
    setActiveMenu("dashboard");
    setMessage(t("loggedOut"), "warning");
  }

  function clearFamilyData() {
    setDashboard(null);
    setWallets([]);
    setTransactions([]);
    setCategories([]);
    setSavings([]);
    setLoans([]);
    setBudgets([]);
    setBudgetStatus(null);
    setRecurringItems([]);
    setGoals([]);
    setGoalSummary(null);
    setAuditSummary(null);
    setAuditRows([]);
    setFinancialReport(null);
    setWalletReport(null);
    setLedgerReport(null);
    setReportAccountId("");
    setBackupIntegrity(null);
    setBackupList({ count: 0, backups: [] });
    setBackupPreview(null);
    setSyncStatus(null);
    setSyncConflicts([]);
    setSyncPullPreview(null);
    setCurrencies([]);
    setExchangeRates([]);
    setCurrencySummary(null);
    setGovernanceMembers([]);
    setGeneratedInvite(null);
    setInviteSpotlightOpen(false);
    setFamilyPanelTab("members");
    setNotifications([]);
    setNotificationSummary(null);
    setNotificationDelivery(null);
    setZakatRecords([]);
    setZakatSummary(null);
    setPhase15Items([]);
    setPhase15Summary(null);
    setPhase16Items([]);
    setPhase16Summary(null);
    setGroceryLists([]);
    setGroceryItems([]);
    setGroceryPriceHistory([]);
    setGroceryVendorSummary([]);
    setGroceryVendors([]);
    setGroceryBarcodeLookup(null);
    setGroceryOcrPreview(null);
    setGroceryActivity([]);
    setGroceryCollaboration(null);
    setActiveGroceryListId("");
    setMyPermissions(null);
    setMemberPermissions([]);
    setPermissionForms({});
  }

  function changeActiveFamily(familyId) {
    clearFamilyData();
    selectActiveFamily(familyId);
  }

  function cloudApiUser() {
    return {
      ...(currentUser || {}),
      email: currentUser?.email || firebaseUser?.email || "",
      full_name: currentUser?.full_name || firebaseUser?.displayName || "",
      uid: firebaseUser?.uid || currentUser?.uid,
      firebase_uid: firebaseUser?.uid || currentUser?.firebase_uid,
      is_email_verified: isCloudEmailReady(firebaseUser),
    };
  }

  async function tryRefreshAccessToken() {
    if (!refreshToken) return false;
    try {
      const res = await fetch(`${apiBase}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Device-Id": getOrCreateDeviceId() || "" },
        credentials: "include",
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return false;
      const nextAccess = data.access_token || "";
      const nextRefresh = data.refresh_token || refreshToken;
      if (!nextAccess) return false;
      setToken(nextAccess);
      setRefreshToken(nextRefresh);
      persistAuthSession({
        accessToken: nextAccess,
        refreshToken: nextRefresh,
        user: data.user || currentUser,
        apiBase,
      });
      if (data.user) setCurrentUser(data.user);
      return true;
    } catch {
      return false;
    }
  }

  async function apiGet(path, retried = false) {
    if (isCloudLocalMode()) {
      const hit = await cloudApiGet({
        familyId: activeFamilyId,
        path,
        currentUser: cloudApiUser(),
      });
      if (hit.handled) return hit.data;
      const err = new Error("Failed to fetch (offline)");
      err.offline = true;
      throw err;
    }

    const res = await fetch(`${apiBase}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      if (res.status === 401 && !retried) {
        const refreshed = await tryRefreshAccessToken();
        if (refreshed) return apiGet(path, true);
      }
      const text = await res.text();
      let detail = text;
      try {
        const parsed = JSON.parse(text);
        detail =
          parsed.detail ||
          parsed.message ||
          parsed.error?.message ||
          (parsed.error?.code ? `${parsed.error.code}: ${parsed.error.message || "Request failed"}` : null) ||
          text;
      } catch {
        /* keep raw text */
      }
      const err = new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
      err.status = res.status;
      err.isPermission = res.status === 403 || /permission/i.test(String(detail));
      throw err;
    }
    return res.json();
  }

  async function syncCloudAfterWrite() {
    // Local folder backup can run offline; Drive needs internet.
    runCloudAutoBackup({ force: true });
    if (!isBrowserOnline()) return;
    if (token && activeFamilyId) {
      try {
        await flushLocalOutbox({
          familyId: activeFamilyId,
          deviceId: SYNC_DEVICE_ID || "web-dashboard",
          apiPost,
        });
      } catch (err) {
        softFail("Outbox flush", err);
      }
    }
  }

  async function apiPost(path, body) {
    if (isCloudLocalMode()) {
      const hit = await cloudApiPost({
        familyId: activeFamilyId,
        path,
        body,
        currentUser: cloudApiUser(),
        onAfterWrite: syncCloudAfterWrite,
      });
      if (hit.handled) {
        if (hit.error || hit.data?.ok === false) {
          throw new Error(hit.error || hit.data?.detail || "Request failed");
        }
        if (hit.data?.cloud_sync_warning) {
          setMessage(hit.data.cloud_sync_warning, "warning");
        }
        return hit.data;
      }
      const err = new Error("Failed to fetch (offline)");
      err.offline = true;
      throw err;
    }

    const res = await fetch(`${apiBase}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(
        data.detail ||
          data.message ||
          data.error?.message ||
          (data.error?.code ? `${data.error.code}: ${data.error.message || "Request failed"}` : null) ||
          "Request failed",
      );
    }
    return data;
  }

  async function apiPatch(path, body) {
    if (isCloudLocalMode()) {
      try {
        const hit = await cloudApiPatch({
          familyId: activeFamilyId,
          path,
          body,
          currentUser: cloudApiUser(),
          onAfterWrite: syncCloudAfterWrite,
        });
        if (hit.handled) {
          if (hit.error || hit.data?.ok === false) {
            throw new Error(hit.error || hit.data?.detail || "Request failed");
          }
          if (hit.data?.cloud_sync_warning) {
            setMessage(hit.data.cloud_sync_warning, "warning");
          }
          return hit.data;
        }
      } catch (err) {
        if (err?.offline || /offline/i.test(String(err?.message || ""))) throw err;
        if (err?.status || err?.isPermission || /permission|denied|connection|database|Cloud mode/i.test(String(err?.message || ""))) {
          throw err;
        }
      }
      const err = new Error("Failed to fetch (offline)");
      err.offline = true;
      throw err;
    }

    const res = await fetch(`${apiBase}${path}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const detail = data.detail || data.message || data.error || "";
      const msg =
        typeof detail === "string" && detail
          ? detail
          : res.status === 403
            ? "Permission denied"
            : res.status === 0 || res.status >= 500
              ? "Database connection issue"
              : "Request failed";
      const err = new Error(msg);
      err.status = res.status;
      err.isPermission = res.status === 403 || /permission/i.test(msg);
      throw err;
    }
    return data;
  }

  async function apiPut(path, body) {
    if (isCloudLocalMode()) {
      const hit = await cloudApiPatch({
        familyId: activeFamilyId,
        path,
        body,
        currentUser: cloudApiUser(),
        onAfterWrite: syncCloudAfterWrite,
      });
      if (hit.handled) {
        if (hit.error || hit.data?.ok === false) {
          throw new Error(hit.error || hit.data?.detail || "Request failed");
        }
        return hit.data;
      }
      const err = new Error("Failed to fetch (offline)");
      err.offline = true;
      throw err;
    }

    const res = await fetch(`${apiBase}${path}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) throw new Error(data.detail || "Request failed");
    return data;
  }

  async function apiDelete(path) {
    if (isCloudLocalMode()) {
      const hit = await cloudApiDelete({
        familyId: activeFamilyId,
        path,
        currentUser: firebaseUser
          ? { uid: firebaseUser.uid, email: firebaseUser.email, firebase_uid: firebaseUser.uid }
          : currentUser,
        onAfterWrite: syncCloudAfterWrite,
      });
      if (hit.handled) {
        if (hit.error || hit.data?.ok === false) {
          throw new Error(hit.error || hit.data?.detail || "Request failed");
        }
        if (hit.data?.cloud_sync_warning) {
          setMessage(hit.data.cloud_sync_warning, "warning");
        }
        return hit.data;
      }
      const err = new Error("Failed to fetch (offline)");
      err.offline = true;
      throw err;
    }

    const res = await fetch(`${apiBase}${path}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) throw new Error(data.detail || "Request failed");
    return data;
  }

  async function apiUpload(path, formData) {
    if (isCloudLocalMode()) {
      const clean = String(path || "").split("?")[0];
      const parts = clean.replace(/^\//, "").split("/").filter(Boolean);
      const file = formData.get("file");
      if (!file) throw new Error("File required");

      // /transactions/{id}/attachment
      if (parts[0] === "transactions" && parts[2] === "attachment") {
        const result = await uploadTransactionAttachment({
          familyId: activeFamilyId,
          transactionId: parts[1],
          file,
          uid: firebaseUser?.uid,
        });
        await syncCloudAfterWrite();
        return result;
      }

      // /documents/{id}/upload
      if (parts[0] === "documents" && parts[2] === "upload") {
        const result = await uploadFamilyDocument({
          familyId: activeFamilyId,
          itemId: parts[1],
          file,
          uid: firebaseUser?.uid,
        });
        await persistDocumentFileMeta(parts[1], result);
        await syncCloudAfterWrite();
        return result;
      }

      throw new Error(`Upload not supported in cloud mode: ${path}`);
    }

    const res = await fetch(`${apiBase}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || data.error?.message || "Upload failed");
    return data;
  }

  async function loadFamilies() {
    if (!token) return;

    setFamiliesReady(false);
    setFamiliesLoading(true);
    setIsFamilyLoading(true);

    try {
      const data = await apiGet("/families");
      const familyList = Array.isArray(data) ? data : data.families || [];
      setFamilies(familyList);

      if (!familyList.length) {
        clearFamilyData();
        selectActiveFamily("");
        setMessage(t("noActiveFamilyForUser"), "warning");
        return;
      }

      const storedId = loadCloudFamilyId();
      setActiveFamilyId((current) => {
        const preferred = current || storedId;
        const next =
          preferred && familyList.some((family) => family.id === preferred)
            ? preferred
            : familyList[0].id;
        persistCloudFamilyId(next);
        return next;
      });
    } catch {
      setFamilies([]);
      selectActiveFamily("");
      clearFamilyData();
      setMessage(t("familyLoadFailed"), "error");
    } finally {
      setFamiliesReady(true);
      setFamiliesLoading(false);
      setIsFamilyLoading(false);
    }
  }

  async function loadProfile() {
    if (!token) return;

    try {
      const data = await apiGet("/auth/me");
      setCurrentUser(data);
    } catch {
      setCurrentUser(null);
    }
  }

  function avatarUrl(user) {
    const path = user?.avatar_url || user?.photo_url || "";
    if (!path) return "";
    if (/^https?:\/\//i.test(path)) return path;
    return `${apiBase}${path.startsWith("/") ? path : `/${path}`}`;
  }

  // API avatars require Bearer auth — <img src> cannot send that header, so load as blob URL.
  useEffect(() => {
    let cancelled = false;
    let objectUrl = "";
    async function loadAvatar() {
      const path = currentUser?.avatar_url || currentUser?.photo_url || "";
      if (!path) {
        setDisplayAvatarUrl("");
        return;
      }
      const absolute = /^https?:\/\//i.test(path)
        ? path
        : `${apiBase}${path.startsWith("/") ? path : `/${path}`}`;
      const isProtectedApiAvatar = /\/auth\/avatar\//i.test(absolute) || /^\/auth\/avatar\//i.test(path);
      if (!isProtectedApiAvatar) {
        setDisplayAvatarUrl(absolute);
        return;
      }
      if (!token) {
        setDisplayAvatarUrl("");
        return;
      }
      try {
        const res = await fetch(absolute, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          if (!cancelled) setDisplayAvatarUrl("");
          return;
        }
        const blob = await res.blob();
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) setDisplayAvatarUrl(objectUrl);
      } catch {
        if (!cancelled) setDisplayAvatarUrl("");
      }
    }
    void loadAvatar();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [currentUser?.avatar_url, currentUser?.photo_url, token, apiBase]);

  async function applyCloudUserAvatar(user, profileOverride = null) {
    if (!user?.uid) return;
    try {
      const profile = profileOverride || (await getUserProfileDoc(user.uid));
      const avatar =
        profile?.avatar_url || profile?.photo_url || user.photoURL || "";
      setCurrentUser((prev) => ({
        ...(prev || {}),
        full_name: prev?.full_name || user.displayName || user.email || "Cloud User",
        email: prev?.email || user.email || "",
        is_email_verified:
          prev?.is_email_verified ?? isFirebaseEmailVerified(user),
        avatar_url: avatar || null,
        photo_url: avatar || null,
        photo_storage_path: profile?.photo_storage_path || null,
        is_active: true,
      }));
    } catch (err) {
      console.warn("[S4 ProfilePhoto] could not load profile avatar", err);
    }
  }

  async function uploadProfilePhoto(file) {
    if (!file) return;

    const clientCheck = validateProfilePhotoFile(file);
    if (!clientCheck.ok) {
      console.error("[S4 ProfilePhoto] client validation failed", clientCheck);
      setMessage(clientCheck.message || t("photoUploadFailed"), "error");
      return;
    }

    // Cloud / Firebase-first path (no backend JWT)
    if (isCloudLocalMode() || (cloudOnlyMode && firebaseUser?.uid && !token)) {
      try {
        const result = await uploadProfilePhotoToFirebase({
          uid: firebaseUser.uid,
          file,
        });
        setCurrentUser((prev) => ({
          ...(prev || {}),
          avatar_url: result.avatar_url,
          photo_url: result.avatar_url,
          photo_storage_path: result.storage_path,
        }));
        console.info("[S4 ProfilePhoto] cloud upload success", result);
        setMessage(t("photoUpdated"), "success");
      } catch (err) {
        console.error("[S4 ProfilePhoto] cloud upload error", err);
        const code = String(err?.code || "");
        let msg = err?.message || t("photoUploadFailed");
        if (
          err?.message?.includes("Max size") ||
          err?.message?.includes("JPG")
        ) {
          msg = err.message;
        } else if (
          code.includes("unauthorized") ||
          code.includes("permission-denied") ||
          /storage\/unauthorized/i.test(msg)
        ) {
          msg =
            "Photo upload blocked by Firebase Storage rules. Publish deploy/firebase/storage.rules (Storage → Rules → Publish).";
          console.error(
            "[S4 ProfilePhoto] Storage rules may block users/{uid}/profile — publish deploy/firebase/storage.rules"
          );
        }
        setMessage(msg, "error");
      }
      return;
    }

    if (!token) {
      console.error("[S4 ProfilePhoto] no auth token and not in cloud mode");
      setMessage(t("photoUploadFailed"), "error");
      return;
    }

    const form = new FormData();
    const mime = clientCheck.contentType || "image/jpeg";
    const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
    const named =
      file.name && /\.(jpe?g|png|webp)$/i.test(file.name)
        ? file
        : new File([file], `avatar.${ext}`, { type: mime });
    form.append("file", named, named.name);
    try {
      console.info("[S4 ProfilePhoto] API upload start", {
        name: file.name,
        type: file.type,
        size: file.size,
      });
      const res = await fetch(`${apiBase}/auth/me/avatar`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error("[S4 ProfilePhoto] API upload failed", res.status, data);
        const detail =
          typeof data.detail === "string"
            ? data.detail
            : t("photoUploadFailed");
        setMessage(detail, "error");
        return;
      }
      setCurrentUser(data);
      console.info("[S4 ProfilePhoto] API upload success", data?.avatar_url);
      setMessage(t("photoUpdated"), "success");
    } catch (err) {
      console.error("[S4 ProfilePhoto] API upload exception", err);
      setMessage(t("photoUploadFailed"), "error");
    }
  }

  async function removeProfilePhoto() {
    if (isCloudLocalMode() || (cloudOnlyMode && firebaseUser?.uid && !token)) {
      try {
        await removeProfilePhotoFromFirebase({
          uid: firebaseUser.uid,
          storagePath: currentUser?.photo_storage_path,
        });
        setCurrentUser((prev) => ({
          ...(prev || {}),
          avatar_url: null,
          photo_url: null,
          photo_storage_path: null,
        }));
        setMessage(t("photoRemoved"), "success");
      } catch (err) {
        console.error("[S4 ProfilePhoto] cloud remove error", err);
        setMessage(t("photoUploadFailed"), "error");
      }
      return;
    }

    if (!token) {
      setMessage(t("photoUploadFailed"), "error");
      return;
    }
    try {
      const res = await fetch(`${apiBase}/auth/me/avatar`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(typeof data.detail === "string" ? data.detail : t("photoUploadFailed"), "error");
        return;
      }
      setCurrentUser(data);
      setMessage(t("photoRemoved"), "success");
    } catch {
      setMessage(t("photoUploadFailed"), "error");
    }
  }

  async function loadSettingsData() {
    if (!activeFamilyId) return;
    if (!token && !isCloudLocalMode()) return;

    setSettingsLoading(true);

    try {
      const data = await apiGet(`/permissions/family/${activeFamilyId}/me`);
      if (data && (data.normalized_role || data.role)) {
        setMyPermissions(data);
      }
    } catch (err) {
      console.warn("[S4 Permissions] me load failed", err);
      // Keep last known role — do not wipe to MEMBER/null on transient failures
    }

    try {
      const data = await apiGet(`/permissions/family/${activeFamilyId}/members`);
      const rows = Array.isArray(data) ? data : data?.members || [];
      setMemberPermissions(rows);
    } catch (err) {
      console.warn("[S4 Permissions] members load failed", err);
      // Keep last known list — clearing causes Family Governance toggles to flicker/hide
    }

    try {
      const status = await apiGet("/auth/email-status");
      setEmailStatus(status);
      if (status?.source === "cloud_local") {
        // Firebase Auth emails — ignore backend SMTP warnings
      } else if (!status?.can_send) {
        console.info(
          "[S4 Security] Email delivery unavailable — set SMTP_HOST + SMTP_FROM_EMAIL in backend .env (see deploy docs). Server note:",
          status?.note || "(none)"
        );
      } else if (status?.smtp?.host) {
        console.info("[S4 Security] Email delivery ready", {
          host: status.smtp.host,
          port: status.smtp.port,
          from: status.smtp.from_email,
        });
      }
    } catch {
      setEmailStatus(null);
      console.info(
        "[S4 Security] Could not load email-status (cloud mode or offline). SMTP config stays in backend .env / deploy docs."
      );
    } finally {
      setSettingsLoading(false);
    }
  }

  async function saveFamilySettings() {
    const nextCurrency = familyCurrencyForm.trim().toUpperCase();
    const nextTimezone = familyTimezoneForm.trim();

    if (!activeFamilyId) {
      setMessage(t("activeFamilyRequired"), "error");
      return;
    }

    if (nextCurrency.length < 3 || nextCurrency.length > 10) {
      setMessage(t("validCurrencyRequired"), "error");
      return;
    }

    if (nextTimezone.length < 2 || nextTimezone.length > 64) {
      setMessage(t("validTimezoneRequired"), "error");
      return;
    }

    setSettingsSaving(true);

    try {
      await apiPatch(`/families/${activeFamilyId}/settings`, {
        default_currency: nextCurrency,
        timezone: nextTimezone,
      });

      setFamilies((current) => {
        const list = Array.isArray(current) ? current : [];
        if (!list.some((family) => family.id === activeFamilyId)) {
          return [
            ...list,
            {
              id: activeFamilyId,
              name: activeFamily?.name || t("cloudOnlyFamilyLabel") || "Family",
              default_currency: nextCurrency,
              timezone: nextTimezone,
            },
          ];
        }
        return list.map((family) =>
          family.id === activeFamilyId
            ? { ...family, default_currency: nextCurrency, timezone: nextTimezone }
            : family,
        );
      });
      setFamilyCurrencyForm(nextCurrency);
      setFamilyTimezoneForm(nextTimezone);
      setMessage(t("familySettingsUpdated"), "success");
      try {
        await refreshAll();
      } catch {
        /* settings already saved — refresh is best-effort */
      }
    } catch (err) {
      const raw = String(err?.message || "");
      let msg = raw || t("familySettingsUpdateFailed") || "Family settings update failed";
      if (err?.isPermission || /permission denied/i.test(raw)) {
        msg = t("permissionDeniedSettings") || "Permission denied — Owner/Admin with settings.manage required";
      } else if (/network|unavailable|connection|failed to fetch/i.test(raw)) {
        msg = t("databaseConnectionIssue") || "Database connection issue — check your network and try again";
      } else if (/request failed/i.test(raw)) {
        msg = t("familySettingsUpdateFailed") || "Could not save family settings. Try again.";
      }
      setMessage(msg, "error");
    } finally {
      setSettingsSaving(false);
    }
  }

  async function _saveFamilyCurrency() {
    await saveFamilySettings();
  }

  function updatePermissionForm(memberId, patch) {
    setPermissionForms((current) => ({
      ...current,
      [memberId]: {
        permission_key: "",
        allow: true,
        scope: "family",
        ...(current[memberId] || {}),
        ...patch,
      },
    }));
  }

  function resolvePermissionMemberId(member) {
    return String(
      member?.uid || member?.user_id || member?.member_id || member?.id || "",
    ).trim();
  }

  async function saveMemberPermission(member) {
    const memberId = resolvePermissionMemberId(member);
    const form = permissionForms[memberId] || {};
    const permissionKey = String(form.permission_key || "").trim();

    if (!permissionKey) {
      setMessage(t("permissionKeyRequired"), "error");
      return;
    }

    setPermissionSavingMemberId(memberId);

    try {
      await apiPatch(`/permissions/members/${memberId}`, {
        permission_key: permissionKey,
        allow: form.allow !== false,
        scope: form.scope || "family",
        full_name: member?.full_name || member?.display_name || "",
        email: member?.email || "",
        role: member?.role || member?.normalized_role || "MEMBER",
      });
      updatePermissionForm(memberId, { permission_key: "", allow: true });
      setMessage(t("memberPermissionUpdated"), "success");
      await loadSettingsData();
    } catch (err) {
      setMessage(err.message || "Member permission update failed", "error");
    } finally {
      setPermissionSavingMemberId("");
    }
  }

  async function toggleMemberPermission(member, permissionKey, allow) {
    const memberId = resolvePermissionMemberId(member);
    if (!memberId || !permissionKey) return;
    const memberRole = String(member.normalized_role || member.role || "").toUpperCase();
    if (memberRole === "OWNER") {
      setMessage(t("ownerPermissionsLocked"), "warning");
      return;
    }
    if (memberRole === "ADMIN") {
      setMessage(
        t("adminPermissionsLocked") ||
          "ADMIN has full access — switch role to MEMBER to set individual toggles",
        "warning",
      );
      return;
    }

    const emailKey = String(member?.email || "").trim().toLowerCase();
    const matchesRow = (row) => {
      const ids = [row.member_id, row.id, row.uid, row.user_id].filter(Boolean).map(String);
      if (ids.includes(String(memberId))) return true;
      const rowEmail = String(row.email || "").trim().toLowerCase();
      return Boolean(emailKey && rowEmail && emailKey === rowEmail);
    };

    setPermissionSavingMemberId(memberId);

    // Optimistic UI so the switch feels instant — always recompute from role baseline + overrides
    setMemberPermissions((current) => {
      const rows = Array.isArray(current) ? current : [];
      let found = false;
      const next = rows.map((row) => {
        if (!matchesRow(row)) return row;
        found = true;
        const role = String(row.normalized_role || row.role || memberRole || "MEMBER").toUpperCase();
        const overrides = Array.isArray(row.overrides) ? [...row.overrides] : [];
        const idx = overrides.findIndex((o) => o.permission_key === permissionKey);
        const patch = {
          id: overrides[idx]?.id || `pov_${Date.now()}`,
          permission_key: permissionKey,
          allow: Boolean(allow),
          scope: "family",
          updated_at: new Date().toISOString(),
        };
        if (idx >= 0) overrides[idx] = patch;
        else overrides.push(patch);
        return {
          ...row,
          member_id: row.member_id || memberId,
          uid: row.uid || member.uid || memberId,
          user_id: row.user_id || member.user_id || memberId,
          role,
          normalized_role: role,
          overrides,
          permission_overrides: overrides,
          updated_at: new Date().toISOString(),
          effective_permissions: applyPermissionOverrides(defaultPermissionsForRole(role), overrides),
        };
      });
      if (found) return next;
      const role = String(memberRole || member.normalized_role || member.role || "MEMBER").toUpperCase();
      const overrides = [
        {
          id: `pov_${Date.now()}`,
          permission_key: permissionKey,
          allow: Boolean(allow),
          scope: "family",
          updated_at: new Date().toISOString(),
        },
      ];
      return [
        ...next,
        {
          member_id: memberId,
          id: memberId,
          uid: member.uid || memberId,
          user_id: member.user_id || memberId,
          email: member.email || "",
          full_name: member.full_name || member.display_name || "",
          role,
          normalized_role: role,
          relationship: member.relationship || member.relationship_type || "",
          overrides,
          permission_overrides: overrides,
          updated_at: new Date().toISOString(),
          effective_permissions: applyPermissionOverrides(defaultPermissionsForRole(role), overrides),
        },
      ];
    });

    try {
      const mapped = await apiPatch(`/permissions/members/${memberId}`, {
        permission_key: permissionKey,
        allow: Boolean(allow),
        scope: "family",
        full_name: member.full_name || member.display_name || "",
        email: member.email || "",
        role: member.role || member.normalized_role || "MEMBER",
        relationship: member.relationship || member.relationship_type || "",
      });
      updatePermissionForm(memberId, { permission_key: permissionKey, allow: Boolean(allow) });
      // Prefer PATCH payload — immediate loadSettingsData can race Firestore and snap toggles back ON.
      if (mapped && typeof mapped === "object" && (mapped.effective_permissions || mapped.overrides)) {
        setMemberPermissions((current) => {
          const rows = Array.isArray(current) ? current : [];
          let found = false;
          const next = rows.map((row) => {
            if (!matchesRow(row)) return row;
            found = true;
            return {
              ...row,
              ...mapped,
              member_id: row.member_id || memberId,
              overrides: mapped.overrides || row.overrides || [],
              effective_permissions: mapped.effective_permissions || row.effective_permissions || [],
            };
          });
          if (found) return next;
          return [
            ...next,
            {
              ...mapped,
              member_id: mapped.member_id || memberId,
            },
          ];
        });
      }
      setMessage(t("memberPermissionUpdated"), "success");
      window.setTimeout(() => {
        void loadSettingsData();
      }, 1200);
    } catch (err) {
      setMessage(err.message || "Member permission update failed", "error");
      await loadSettingsData();
    } finally {
      setPermissionSavingMemberId("");
    }
  }

  async function refreshSession() {
    if (cloudOnlyMode && firebaseUser) {
      setSecurityAction("refresh");
      try {
        const refreshed = await firebaseReloadUser();
        if (refreshed) {
          setFirebaseUser(refreshed);
          setCurrentUser((prev) => ({
            ...(prev || {}),
            email: refreshed.email || prev?.email,
            full_name: refreshed.displayName || prev?.full_name,
            is_email_verified: isFirebaseEmailVerified(refreshed),
            uid: refreshed.uid,
            firebase_uid: refreshed.uid,
          }));
        }
        setMessage(t("sessionRefreshed") || "Session refreshed", "success");
        await loadSettingsData();
      } catch (err) {
        setMessage(err.message || "Session refresh failed", "error");
      } finally {
        setSecurityAction("");
      }
      return;
    }

    if (!refreshToken) {
      setMessage(t("refreshTokenUnavailable"), "error");
      return;
    }

    setSecurityAction("refresh");

    try {
      const res = await fetch(`${apiBase}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Device-Id": getOrCreateDeviceId() || "" },
        credentials: "include",
        body: JSON.stringify({ refresh_token: refreshToken || undefined }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.detail || "Session refresh failed");
      }

      setToken(data.access_token || "");
      setRefreshToken(data.refresh_token || "");
      setCurrentUser(data.user || currentUser);
      setMessage(t("sessionRefreshed"), "success");
    } catch (err) {
      setMessage(err.message || "Session refresh failed", "error");
    } finally {
      setSecurityAction("");
    }
  }

  async function requestPasswordReset() {
    const targetEmail = currentUser?.email || email || firebaseUser?.email;

    if (!targetEmail) {
      setMessage(t("emailRequiredPasswordReset"), "error");
      return;
    }

    setSecurityAction("password-reset");

    try {
      if (cloudOnlyMode || (!token && FIREBASE_CONFIGURED)) {
        await firebaseSendPasswordReset(targetEmail);
        setMessage(t("emailSent") || "Password reset email sent", "success");
        return;
      }

      const res = await fetch(`${apiBase}/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: targetEmail }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || t("passwordResetFailed") || "Password reset failed");
      setMessage(t("emailSent") || data.message || "Password reset email sent", "success");
    } catch (err) {
      setMessage(err.message || t("passwordResetFailed") || "Password reset failed", "error");
    } finally {
      setSecurityAction("");
    }
  }

  async function requestDeleteAccountOtp() {
    if (cloudOnlyMode && !token) {
      setMessage(t("loginRequired") || "Sign in with the app account to delete.", "error");
      return;
    }
    if (deleteAccountStep !== "otp") {
      if (!window.confirm(t("deleteAccountConfirmPrompt"))) return;
    }
    setDeleteAccountBusy(true);
    setSecurityAction("delete-account");
    try {
      const data = await apiPost("/auth/me/delete/request-otp", {});
      setDeleteAccountStep("otp");
      setDeleteAccountOtp("");
      setMessage(data?.message || t("emailSent") || "OTP sent", "success");
    } catch (err) {
      setMessage(err.message || "Could not send OTP", "error");
    } finally {
      setDeleteAccountBusy(false);
      setSecurityAction("");
    }
  }

  async function confirmDeleteAccount() {
    const code = String(deleteAccountOtp || "").trim();
    if (code.length < 4) {
      setMessage(t("deleteAccountOtpLabel"), "error");
      return;
    }
    setDeleteAccountBusy(true);
    try {
      const data = await apiPost("/auth/me/delete/confirm", { otp: code });
      setMessage(data?.message || t("deleteAccountSuccess"), "success");
      setDeleteAccountStep("idle");
      setDeleteAccountOtp("");
      await logout();
    } catch (err) {
      setMessage(err.message || t("deleteAccount") || "Delete failed", "error");
    } finally {
      setDeleteAccountBusy(false);
    }
  }

  async function resendVerification() {
    const targetEmail = currentUser?.email || email || firebaseUser?.email;

    if (!targetEmail && !(cloudOnlyMode && firebaseUser)) {
      const err = new Error(t("emailRequiredVerification"));
      setMessage(err.message, "error");
      throw err;
    }

    setSecurityAction("verification");

    try {
      if (cloudOnlyMode && (firebaseUser || FIREBASE_CONFIGURED)) {
        const result = await firebaseResendEmailVerification(firebaseUser);
        if (result.alreadyVerified) {
          const refreshed = await firebaseReloadUser();
          if (refreshed) {
            setFirebaseUser(refreshed);
            setCurrentUser((prev) =>
              prev
                ? { ...prev, is_email_verified: isFirebaseEmailVerified(refreshed) }
                : prev,
            );
          }
          setMessage(t("emailVerified") || "Email verified", "success");
        } else {
          const sentTo = result.email || targetEmail || "";
          const base =
            t("verifyEmailSent") ||
            t("emailSent") ||
            "Verification email sent — check inbox/spam.";
          const extra = result.domainHint
            ? ` ${t("verifyEmailDomainHint") || ""}`.trim()
            : "";
          setMessage(
            sentTo ? `${base} (${sentTo})${extra ? ` ${extra}` : ""}` : `${base}${extra ? ` ${extra}` : ""}`,
            "success",
          );
        }
        return;
      }

      const res = await fetch(`${apiBase}/auth/resend-verification`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: targetEmail }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.detail || "Verification resend failed");
      }

      const delivery = data.email_delivery;
      if (delivery?.sent) {
        setMessage(data.message || t("emailSent"), "success");
      } else {
        setMessage(
          `${data.message || t("emailNotSent")}${delivery?.reason ? ` (${delivery.reason})` : ""}`,
          delivery ? "warning" : "success"
        );
      }
    } catch (err) {
      console.error("[resendVerification]", err);
      const lang = appLanguage === "bn" ? "bn" : "en";
      const friendly =
        err?.code === "auth/resend-cooldown"
          ? err.message
          : formatFirebaseAuthError(err, lang);
      setMessage(friendly || err.message || "Verification resend failed", "error");
      throw err;
    } finally {
      setSecurityAction("");
    }
  }

  async function handleVerifyEmailRefresh() {
    setSecurityAction("verification");
    try {
      const refreshed = await firebaseReloadUser();
      if (!refreshed) {
        setMessage(t("firebaseSignInPrompt"), "error");
        return;
      }
      setFirebaseUser(refreshed);
      setCurrentUser((prev) =>
        prev ? { ...prev, is_email_verified: isFirebaseEmailVerified(refreshed) } : prev,
      );
      if (isFirebaseEmailVerified(refreshed)) {
        setMessage(t("emailVerified") || "Email verified", "success");
        let familyId = activeFamilyId || loadCloudFamilyId();
        if (!familyId) {
          try {
            familyId = await Promise.race([
              resolveCloudFamilyId(refreshed.uid, refreshed),
              new Promise((resolve) => {
                window.setTimeout(() => resolve(""), 8000);
              }),
            ]);
          } catch {
            familyId = "";
          }
        }
        if (familyId) {
          await activateCloudSession(refreshed, familyId);
        } else {
          setMessage(t("cloudOnlyNoDataCreate"), "warning");
        }
        if (!loadBackupOnboardingDone(refreshed.uid)) {
          setShowBackupOnboarding(true);
        }
        await pushCloudSnapshotIfReady(refreshed, familyId || activeFamilyId || loadCloudFamilyId());
        runCloudAutoBackup({ force: true });
      } else {
        setMessage(t("verifyEmailStillPending"), "warning");
      }
    } catch (err) {
      setMessage(err.message || t("firebaseSyncFailed"), "error");
    } finally {
      setSecurityAction("");
    }
  }

  async function handleVerifyEmailSignOut() {
    try {
      await firebaseSignOut();
    } catch {
      /* ignore */
    }
    setFirebaseUser(null);
    setFirebaseMeta(null);
    clearCloudSession();
    setCloudOnlyMode(false);
    setActiveFamilyId("");
    setIsFamilyLoading(false);
    setSessionBootstrapping(false);
    setCurrentUser(null);
    setFamilies([]);
    setMessage(t("loggedOut"), "warning");
  }

  async function sendTestNotificationEmail() {
    if (!activeFamilyId) return;
    if (!token && !isCloudLocalMode()) return;
    try {
      const result = await apiPost(`/notifications/test-email/${activeFamilyId}`, {});
      if (result.sent) {
        setMessage(t("emailSent"), "success");
      } else {
        setMessage(`${t("emailNotSent")}: ${result.reason || "unknown"}`, "warning");
      }
      await loadNotifications();
    } catch (err) {
      setMessage(err.message || "Test email failed", "error");
    }
  }

  async function loadDashboard() {
    if (cloudOnlyMode && !token && activeFamilyId) {
      const cache = await hydrateFamilyFromOfflineCache(activeFamilyId);
      setDashboard(buildDashboardFromCache(cache));
      return;
    }
    if (!token) return;

    try {
      const data = await apiGet(`/dashboard/${activeFamilyId}`);
      setDashboard(data);
    } catch {
      setMessage(t("dashboardLoadFailed"), "error");
    }
  }

  async function loadWallets() {
    if (isCloudLocalMode()) {
      const cached = await loadOfflineSnapshot(activeFamilyId, "finance", "wallets").catch(() => null);
      const data = activeWalletRows(Array.isArray(cached?.data) ? cached.data : []);
      setWallets(data);
      bindActiveWalletForms(data);
      return data;
    }
    if (!token) return [];

    try {
      const data = activeWalletRows(await apiGet(`/accounts/family/${activeFamilyId}`));
      setWallets(data);
      await saveOfflineSnapshot(activeFamilyId, "finance", "wallets", data).catch(() => {});
      bindActiveWalletForms(data);
      return data;
    } catch (err) {
      const msg = String(err?.message || "");
      if (/failed to fetch|network|offline/i.test(msg) || !isBrowserOnline()) {
        const cached = await loadOfflineSnapshot(activeFamilyId, "finance", "wallets").catch(() => null);
        if (cached?.data) {
          const data = activeWalletRows(cached.data);
          setWallets(data);
          bindActiveWalletForms(data);
          return data;
        }
      }
      setMessage(t("walletLoadFailed"), "error");
      return [];
    }
  }

  async function loadCategories() {
    if (isCloudLocalMode()) {
      let data = await loadOfflineFinanceCache("finance", "categories");
      if (!Array.isArray(data) || !data.length) {
        data = DEFAULT_CLOUD_CATEGORIES;
        await saveOfflineSnapshot(activeFamilyId, "finance", "categories", data).catch(() => {});
      }
      setCategories(data);
      const want = String(txForm.type || "income").toUpperCase();
      const match =
        data.find((c) => String(c.category_type || "").toUpperCase().includes(want)) || data[0];
      if (match && !txForm.category_id) {
        setTxForm((prev) => ({ ...prev, category_id: match.id }));
      }
      const expense = data.find((c) => String(c.category_type || "").toUpperCase().includes("EXPENSE"));
      if (expense && !budgetForm.category_id) {
        setBudgetForm((prev) => ({ ...prev, category_id: expense.id }));
      }
      if (expense && !recurringForm.category_id) {
        setRecurringForm((prev) => ({ ...prev, category_id: expense.id }));
      }
      return data;
    }
    if (!token) return [];

    try {
      let data = await apiGet(`/categories/family/${activeFamilyId}`);
      if (!Array.isArray(data)) data = [];

      if (!data.length) {
        try {
          await apiPost(`/categories/seed/${activeFamilyId}`, {});
          data = await apiGet(`/categories/family/${activeFamilyId}`);
          if (!Array.isArray(data)) data = [];
        } catch {
          /* seed requires owner/admin */
        }
      }

      if (!data.length) {
        const cached = await loadOfflineSnapshot(activeFamilyId, "finance", "categories").catch(() => null);
        if (Array.isArray(cached?.data) && cached.data.length) {
          data = cached.data;
        } else if (DEFAULT_CLOUD_CATEGORIES.length) {
          data = DEFAULT_CLOUD_CATEGORIES;
        }
      }

      setCategories(data);
      if (data.length) {
        await saveOfflineSnapshot(activeFamilyId, "finance", "categories", data).catch(() => {});
      }

      if (data.length && !txForm.category_id) {
        setTxForm((prev) => ({
          ...prev,
          category_id: data[0].id,
        }));
      }

      const expense = data.find((category) => category.category_type === "EXPENSE");

      if (expense && !budgetForm.category_id) {
        setBudgetForm((prev) => ({
          ...prev,
          category_id: expense.id,
        }));
      }

      if (expense && !recurringForm.category_id) {
        setRecurringForm((prev) => ({
          ...prev,
          category_id: expense.id,
        }));
      }
      return data;
    } catch (err) {
      const cached = await loadOfflineSnapshot(activeFamilyId, "finance", "categories").catch(() => null);
      if (Array.isArray(cached?.data) && cached.data.length) {
        setCategories(cached.data);
        return cached.data;
      }
      setCategories([]);
      softFail("Categories", err, "error");
      return [];
    }
  }

  async function createCategory(form) {
    if (!activeFamilyId) {
      setMessage(t("activeFamilyRequired"), "error");
      return false;
    }
    if (isCloudLocalMode()) {
      setMessage(t("categoriesOfflineUnavailable") || "Custom categories need an internet connection", "warning");
      return false;
    }
    const nameEn = String(form.name_en || "").trim();
    const nameBn = String(form.name_bn || "").trim();
    if (!nameEn || !nameBn) {
      setMessage(t("categoryNameRequired") || "English and Bangla name are required", "error");
      return false;
    }
    setCategoriesSaving(true);
    try {
      await apiPost("/categories", {
        family_id: activeFamilyId,
        name_en: nameEn,
        name_bn: nameBn,
        category_type: form.category_type === "INCOME" ? "INCOME" : "EXPENSE",
        icon: form.icon ? String(form.icon).trim() : null,
        color: form.color ? String(form.color).trim() : null,
      });
      setMessage(t("categoryCreated") || "Category created", "success");
      await loadCategories();
      return true;
    } catch (err) {
      setMessage(err.message || t("categoryCreateFailed") || "Category create failed", "error");
      return false;
    } finally {
      setCategoriesSaving(false);
    }
  }

  async function deleteCategoryById(categoryId) {
    if (!categoryId) return;
    if (isCloudLocalMode()) {
      setMessage(t("categoriesOfflineUnavailable") || "Custom categories need an internet connection", "warning");
      return;
    }
    setCategoryDeletingId(categoryId);
    try {
      await apiDelete(`/categories/${categoryId}`);
      setMessage(t("categoryDeleted") || "Category deleted", "success");
      await loadCategories();
    } catch (err) {
      setMessage(err.message || t("categoryDeleteFailed") || "Category delete failed", "error");
    } finally {
      setCategoryDeletingId("");
    }
  }

  async function loadTransactions() {
    if (isCloudLocalMode()) {
      const cached = await loadOfflineSnapshot(activeFamilyId, "finance", "transactions").catch(() => null);
      const data = Array.isArray(cached?.data) ? cached.data : [];
      setTransactions(sortTransactionsNewestFirst(data));
      return;
    }
    if (!token) return;

    try {
      const data = await apiGet(`/transactions/${activeFamilyId}`);
      const rows = Array.isArray(data) ? data : data?.transactions || [];
      setTransactions(sortTransactionsNewestFirst(rows));
      await saveOfflineSnapshot(activeFamilyId, "finance", "transactions", rows).catch(() => {});
    } catch (err) {
      const msg = String(err?.message || "");
      if (/failed to fetch|network|offline/i.test(msg) || !isBrowserOnline()) {
        const cached = await loadOfflineSnapshot(activeFamilyId, "finance", "transactions").catch(() => null);
        if (cached?.data) {
          setTransactions(sortTransactionsNewestFirst(cached.data));
          return;
        }
      }
      setMessage(t("transactionLoadFailed"), "error");
    }
  }

  async function loadSavings() {
    if (isCloudLocalMode()) {
      const cached = await loadOfflineSnapshot(activeFamilyId, "finance", "savings").catch(() => null);
      const list = normalizeSavingsList(cached?.data);
      const txCached = await loadOfflineSnapshot(activeFamilyId, "finance", "transactions").catch(() => null);
      const txs = Array.isArray(txCached?.data) ? txCached.data : transactions;
      const enriched = recomputeSavingsFromLedger(list, txs);
      // Always persist ledger-derived progress so sync/hydrate stay consistent
      await saveOfflineSnapshot(activeFamilyId, "finance", "savings", enriched).catch(() => {});
      setSavings(enriched);
      const active = enriched.filter((g) => String(g.status || "").toUpperCase() === "ACTIVE");
      if (active[0]?.id) {
        setSavingsAction((prev) => ({
          ...prev,
          savings_goal_id: active.some((g) => String(g.id) === String(prev.savings_goal_id))
            ? prev.savings_goal_id
            : active[0].id,
        }));
      }
      return;
    }
    if (!token) return;

    try {
      const data = normalizeSavingsList(await apiGet(`/savings/${activeFamilyId}`));
      const enriched = enrichSavingsGoals(data);
      setSavings(enriched);
      await saveOfflineSnapshot(activeFamilyId, "finance", "savings", enriched).catch(() => {});

      if (enriched.length && !savingsAction.savings_goal_id) {
        setSavingsAction((prev) => ({
          ...prev,
          savings_goal_id: enriched[0].id,
        }));
      }
    } catch (err) {
      const msg = String(err?.message || "");
      if (/failed to fetch|network|offline/i.test(msg) || !isBrowserOnline()) {
        const cached = await loadOfflineSnapshot(activeFamilyId, "finance", "savings").catch(() => null);
        if (cached?.data) {
          const list = normalizeSavingsList(cached.data);
          const txCached = await loadOfflineSnapshot(activeFamilyId, "finance", "transactions").catch(() => null);
          const txs = Array.isArray(txCached?.data) ? txCached.data : transactions;
          setSavings(recomputeSavingsFromLedger(list, txs));
          return;
        }
      }
      setMessage(t("savingsLoadFailed"), "error");
    }
  }

  async function loadLoans() {
    if (isCloudLocalMode()) {
      const data = await loadOfflineFinanceCache("finance", "loans");
      if (Array.isArray(data)) setLoans(data);
      return;
    }
    if (!token) return;

    try {
      const data = await apiGet(`/loans/${activeFamilyId}`);
      setLoans(data);
      await saveOfflineSnapshot(activeFamilyId, "finance", "loans", data).catch(() => {});

      if (data.length && !loanPaymentForm.loan_id) {
        setLoanPaymentForm((prev) => ({
          ...prev,
          loan_id: data[0].id,
        }));
      }
    } catch (err) {
      const msg = String(err?.message || "");
      if (/failed to fetch|network|offline/i.test(msg) || !isBrowserOnline()) {
        const cached = await loadOfflineSnapshot(activeFamilyId, "finance", "loans").catch(() => null);
        if (cached?.data) {
          setLoans(cached.data);
          return;
        }
      }
      setMessage(t("loanLoadFailed"), "error");
    }
  }

  async function loadBudgets() {
    if (isCloudLocalMode()) {
      const cached = await loadOfflineSnapshot(activeFamilyId, "finance", "budgets").catch(() => null);
      const raw = cached?.data;
      const list = normalizeBudgetsList(raw);
      const txCached = await loadOfflineSnapshot(activeFamilyId, "finance", "transactions").catch(() => null);
      const catCached = await loadOfflineSnapshot(activeFamilyId, "finance", "categories").catch(() => null);
      const txs = Array.isArray(txCached?.data) ? txCached.data : transactions;
      let cats = Array.isArray(catCached?.data) ? catCached.data : categories;
      if (!cats?.length) {
        cats = DEFAULT_CLOUD_CATEGORIES;
        await saveOfflineSnapshot(activeFamilyId, "finance", "categories", cats).catch(() => {});
        setCategories(cats);
      }
      const enriched = enrichBudgetsFromLedger(list, txs, cats);
      // Always persist as array of source fields so cloud merge-by-id works
      const stripped = persistableBudgets(list);
      const needsStrip =
        !Array.isArray(raw) ||
        list.some((b) => b && ("spent_amount" in b || "used_percent" in b || "is_over_budget" in b || "remaining_amount" in b));
      if (needsStrip || !cached) {
        await saveOfflineSnapshot(activeFamilyId, "finance", "budgets", stripped).catch(() => {});
      }
      setBudgets(enriched);
      setBudgetStatus(null);
      return;
    }
    if (!token) return;

    try {
      const data = await apiGet(`/budgets/${activeFamilyId}`);
      const rows = normalizeBudgetsList(data);
      setBudgets(rows);
      await saveOfflineSnapshot(activeFamilyId, "finance", "budgets", persistableBudgets(rows)).catch(() => {});

      try {
        const statusData = await apiGet(`/budgets/status/${activeFamilyId}`);
        setBudgetStatus(statusData);
      } catch (statusErr) {
        console.warn("[S4 Budget] status load failed", statusErr);
        setBudgetStatus(null);
      }
    } catch (err) {
      const msg = String(err?.message || "");
      if (/failed to fetch|network|offline/i.test(msg) || !isBrowserOnline()) {
        const cached = await loadOfflineSnapshot(activeFamilyId, "finance", "budgets").catch(() => null);
        if (cached?.data) {
          const list = normalizeBudgetsList(cached.data);
          const catCached = await loadOfflineSnapshot(activeFamilyId, "finance", "categories").catch(() => null);
          const cats = Array.isArray(catCached?.data) ? catCached.data : categories;
          const enriched = enrichBudgetsFromLedger(list, transactions, cats);
          setBudgets(enriched);
          setBudgetStatus(null);
          return;
        }
      }
      setBudgetStatus(null);
      setMessage(t("budgetLoadFailed"), "error");
    }
  }

  async function loadRecurring() {
    if (isCloudLocalMode()) {
      const data = await loadOfflineFinanceCache("finance", "recurring");
      if (Array.isArray(data)) {
        const normalized = data.map((item) => {
          const start = item.start_date || String(item.created_at || "").slice(0, 10) || null;
          return {
            ...item,
            start_date: start,
            next_due_date: item.next_due_date || start,
          };
        });
        setRecurringItems(normalized);
        const needsFix = data.some((item) => !item.next_due_date || !item.start_date);
        if (needsFix) {
          await saveOfflineSnapshot(activeFamilyId, "finance", "recurring", normalized).catch(() => {});
        }
      }
      return;
    }
    if (!token) return;

    try {
      const data = await apiGet(`/recurring/${activeFamilyId}`);
      setRecurringItems(data);
      await saveOfflineSnapshot(activeFamilyId, "finance", "recurring", data).catch(() => {});
    } catch (err) {
      const msg = String(err?.message || "");
      if (/failed to fetch|network|offline/i.test(msg) || !isBrowserOnline()) {
        const cached = await loadOfflineSnapshot(activeFamilyId, "finance", "recurring").catch(() => null);
        if (cached?.data) {
          setRecurringItems(cached.data);
          return;
        }
      }
      setMessage(t("recurringLoadFailed"), "error");
    }
  }

  async function loadGoals() {
    if (isCloudLocalMode()) {
      const cached = await loadOfflineSnapshot(activeFamilyId, "finance", "goals").catch(() => null);
      const raw = Array.isArray(cached?.data) ? cached.data : [];
      const txCached = await loadOfflineSnapshot(activeFamilyId, "finance", "transactions").catch(() => null);
      const txs = Array.isArray(txCached?.data) ? txCached.data : transactions;
      const enriched = recomputeGoalsFromLedger(raw, txs);
      setGoals(enriched);
      const summary = buildGoalSummary(enriched);
      setGoalSummary(summary);
      await saveOfflineSnapshot(activeFamilyId, "finance", "goalSummary", summary).catch(() => {});
      if (enriched.length && !goalContributionForm.goal_id) {
        const firstActive = enriched.find((g) => String(g.status || "").toUpperCase() !== "CLOSED");
        if (firstActive) {
          setGoalContributionForm((prev) => ({ ...prev, goal_id: firstActive.id }));
        }
      }
      return;
    }
    if (!token) return;

    try {
      const data = await apiGet(`/goals/${activeFamilyId}`);
      setGoals(data);
      await saveOfflineSnapshot(activeFamilyId, "finance", "goals", data).catch(() => {});

      if (data.length && !goalContributionForm.goal_id) {
        setGoalContributionForm((prev) => ({
          ...prev,
          goal_id: data[0].id,
        }));
      }
    } catch (err) {
      const msg = String(err?.message || "");
      if (/failed to fetch|network|offline/i.test(msg) || !isBrowserOnline()) {
        const cached = await loadOfflineSnapshot(activeFamilyId, "finance", "goals").catch(() => null);
        if (cached?.data) {
          setGoals(enrichGoals(cached.data));
          return;
        }
      }
      setMessage(t("goalsLoadFailed"), "error");
    }

    try {
      const summary = await apiGet(`/goals/summary/${activeFamilyId}`);
      setGoalSummary(summary);
      await saveOfflineSnapshot(activeFamilyId, "finance", "goalSummary", summary).catch(() => {});
    } catch (err) {
      const msg = String(err?.message || "");
      if (/failed to fetch|network|offline/i.test(msg) || !isBrowserOnline()) {
        const cached = await loadOfflineSnapshot(activeFamilyId, "finance", "goalSummary").catch(() => null);
        if (cached?.data) {
          setGoalSummary(cached.data);
          return;
        }
      }
      setGoalSummary(null);
    }
  }

  async function loadAuditTrail() {
    if (!activeFamilyId) return;
    if (!token && !isCloudLocalMode()) return;

    setAuditLoading(true);

    try {
      const [summary, activity] = await Promise.all([
        apiGet(`/families/${activeFamilyId}/audit-trail/summary`),
        apiGet(`/families/${activeFamilyId}/audit-trail/activity?limit=25`),
      ]);

      setAuditSummary(summary);
      setAuditRows(Array.isArray(activity?.rows) ? activity.rows : Array.isArray(activity) ? activity : []);
    } catch (err) {
      try {
        const cached = await loadOfflineSnapshot(activeFamilyId, "system", "audit").catch(() => null);
        const rows = Array.isArray(cached?.data) ? cached.data : [];
        if (rows.length) {
          setAuditRows((prev) => (prev?.length ? prev : rows));
          setAuditSummary((prev) => prev || { total_audit_rows: rows.length, total_events: rows.length });
          return;
        }
      } catch {
        /* ignore */
      }
      setAuditSummary((prev) => prev || null);
      setAuditRows((prev) => (prev?.length ? prev : []));
      // Dashboard refresh may hit audit without permission — don't spam scary JSON toasts
      if (!err?.isPermission) {
        setMessage(err.message || "Audit trail load failed", "error");
      }
    } finally {
      setAuditLoading(false);
    }
  }

  function enrichNotificationDelivery(delivery, devices = [], readyOverride = null) {
    const vapidOk = isWebFcmVapidConfigured();
    const permission = getNotificationPermission();
    const deviceCount = Array.isArray(devices) ? devices.length : 0;
    const tokenReady = readyOverride === null ? fcmClientReady : Boolean(readyOverride);
    const clientOn = tokenReady || (vapidOk && permission === "granted" && deviceCount > 0);
    const fcmOn = Boolean(delivery?.fcm_configured) || vapidOk || clientOn;
    return {
      ...(delivery && typeof delivery === "object" ? delivery : {}),
      fcm_configured: fcmOn,
      browser_permission: permission,
      web_fcm: {
        ...(delivery?.web_fcm || {}),
        vapid_configured: vapidOk,
        permission,
        token_ready: tokenReady,
        device_count: deviceCount,
        sw: "firebase-messaging-sw.js",
      },
      delivery_mode: fcmOn
        ? delivery?.delivery_mode && delivery.delivery_mode !== "IN_APP_ONLY"
          ? delivery.delivery_mode
          : "IN_APP_BROWSER_FCM"
        : delivery?.delivery_mode || "IN_APP_BROWSER",
      note:
        delivery?.note ||
        (!vapidOk
          ? "Set VITE_FIREBASE_VAPID_KEY in frontend/.env and restart Vite"
          : permission === "granted"
            ? "Browser push ready"
            : "Click the bell to enable browser notifications"),
    };
  }

  async function loadNotifications(options = {}) {
    if (!activeFamilyId) return;
    if (!token && !isCloudLocalMode()) return;

    setNotificationsLoading(true);

    try {
      const [items, summary, delivery, devices] = await Promise.all([
        apiGet(`/notifications/${activeFamilyId}`),
        apiGet(`/notifications/summary/${activeFamilyId}`),
        apiGet(`/notifications/delivery-status/${activeFamilyId}`),
        apiGet(`/notifications/devices/${activeFamilyId}`).catch(() => []),
      ]);

      const deviceList = Array.isArray(devices) ? devices : [];
      setNotifications(Array.isArray(items) ? items : []);
      setNotificationSummary(summary);
      setPushDevices(deviceList);
      setNotificationDelivery(
        enrichNotificationDelivery(delivery, deviceList, options.fcmReadyOverride ?? null)
      );
      if (delivery?.browser_permission) {
        setNotifyPermission(delivery.browser_permission);
      } else {
        setNotifyPermission(getNotificationPermission());
      }
      if (deviceList.length > 0 && getNotificationPermission() === "granted" && isWebFcmVapidConfigured()) {
        setFcmClientReady(true);
      }
    } catch (err) {
      console.error("[S4 Notify] loadNotifications failed", err);
      setNotifications((prev) => (prev?.length ? prev : []));
      setNotificationSummary((prev) => prev || null);
      setNotificationDelivery((prev) => prev || null);
      setPushDevices((prev) => (prev?.length ? prev : []));
      setMessage(err.message || "Notification load failed", "error");
    } finally {
      setNotificationsLoading(false);
    }
  }

  async function enableBrowserPushNotifications({ silent = false } = {}) {
    try {
      const result = await enableWebPushNotifications({
        familyId: activeFamilyId,
        deviceLabel: "web-browser",
        registerWithBackend: async (fcmToken) => {
          if (!activeFamilyId) return;
          if (!token && !isCloudLocalMode()) return;
          await apiPost(`/notifications/devices/${activeFamilyId}`, {
            token: fcmToken,
            platform: "WEB",
            provider: "FCM",
            device_label: "web-browser",
          });
        },
      });
      setNotifyPermission(result.permission || getNotificationPermission());
      setNotifyPermissionHint(result.hint || "");
      if (result.ok) {
        setFcmClientReady(true);
        if (!silent) setMessage(t("browserNotifyEnabled") || "Browser notifications enabled", "success");
        await loadNotifications({ fcmReadyOverride: true });
        return result;
      }
      if (result.vapidConfigured) {
        setNotificationDelivery((prev) =>
          enrichNotificationDelivery(prev, pushDevices, result.permission === "granted" ? false : null)
        );
      }
      if (!silent) {
        const type = result.reason === "denied" || result.reason === "missing_vapid" ? "warning" : "error";
        setMessage(result.hint || t("browserNotifyFailed") || "Could not enable browser notifications", type);
      } else if (result.hint) {
        console.warn("[S4 Notify]", result.hint);
      }
      return result;
    } catch (err) {
      console.error("[S4 Notify] enableBrowserPushNotifications failed", err);
      if (!silent) setMessage(err.message || "Notification setup failed", "error");
      return { ok: false, reason: "error", hint: err?.message };
    }
  }

  async function registerPushDevice() {
    if (!activeFamilyId) return;
    if (!token && !isCloudLocalMode()) return;
    const pushToken = String(pushTokenDraft || "").trim();
    if (pushToken.length < 8) {
      setMessage(t("pastePushTokenHint") || "Paste a real FCM/Expo push token (min 8 chars)", "error");
      return;
    }
    setNotificationsLoading(true);
    try {
      await apiPost(`/notifications/devices/${activeFamilyId}`, {
        token: pushToken,
        platform: pushPlatform || "WEB",
        provider: "FCM",
        device_label: "web-dashboard",
      });
      setPushTokenDraft("");
      setMessage(t("pushDeviceRegistered") || "Push device registered", "success");
      await loadNotifications();
    } catch (err) {
      console.error("[S4 Notify] registerPushDevice failed", err);
      setMessage(err.message || "Device register failed", "error");
      setNotificationsLoading(false);
    }
  }

  async function unregisterPushDevice(deviceId) {
    if (!deviceId) return;
    if (!token && !isCloudLocalMode()) return;
    setNotificationsLoading(true);
    try {
      await apiDelete(`/notifications/devices/${deviceId}`);
      setMessage(t("pushDeviceUnregistered") || "Device unregistered", "success");
      await loadNotifications();
    } catch (err) {
      console.error("[S4 Notify] unregisterPushDevice failed", err);
      setMessage(err.message || "Unregister failed", "error");
      setNotificationsLoading(false);
    }
  }

  async function sendTestPushNotification() {
    if (!activeFamilyId) return;
    if (!token && !isCloudLocalMode()) return;
    setNotificationsLoading(true);
    try {
      const result = await apiPost(`/notifications/test-push/${activeFamilyId}`, {});
      if (result?.sent && (result?.sent_count > 0 || result?.channel === "browser_notification")) {
        setMessage(
          (t("testPushSent") || "Test push sent to {n} device(s)").replace(
            "{n}",
            digits(result?.sent_count || 1)
          ),
          "success"
        );
      } else if (result?.reason === "permission_denied") {
        setNotifyPermission("denied");
        setNotifyPermissionHint(
          t("notifyPermissionDenied") ||
            "Browser notifications are blocked. Enable them in site settings."
        );
        setMessage(t("notifyPermissionDenied") || "Browser notifications blocked", "warning");
      } else {
        setMessage(result?.reason || t("testPushNotSent") || "Test push not sent — check inbox for in-app copy", "warning");
      }
      await loadNotifications();
    } catch (err) {
      console.error("[S4 Notify] sendTestPushNotification failed", err);
      setMessage(err.message || "Test push failed", "error");
    } finally {
      setNotificationsLoading(false);
    }
  }

  async function scanNotifications() {
    if (!activeFamilyId) return;
    if (!token && !isCloudLocalMode()) return;

    setNotificationsLoading(true);

    try {
      const result = await apiPost(`/notifications/scan/${activeFamilyId}`, {});
      setMessage(t("notificationScanCreated").replace("{n}", digits(result.created_notifications || 0)), "success");
      await loadNotifications();
    } catch (err) {
      console.error("[S4 Notify] scanNotifications failed", err);
      setMessage(err.message || "Notification scan failed", "error");
    } finally {
      setNotificationsLoading(false);
    }
  }

  async function markNotificationRead(notificationId) {
    if (!activeFamilyId) return;
    if (!token && !isCloudLocalMode()) return;
    try {
      await apiPatch(`/notifications/read/${notificationId}`, {});
      await loadNotifications();
    } catch (err) {
      console.error("[S4 Notify] markNotificationRead failed", err);
      setMessage(err.message || "Notification update failed", "error");
    }
  }

  async function markAllNotificationsRead() {
    if (!activeFamilyId) return;
    if (!token && !isCloudLocalMode()) return;
    try {
      const result = await apiPatch(`/notifications/read-all/${activeFamilyId}`, {});
      setMessage(t("markedReadCount").replace("{n}", digits(result.marked_read || 0)), "success");
      await loadNotifications();
    } catch (err) {
      console.error("[S4 Notify] markAllNotificationsRead failed", err);
      setMessage(err.message || "Notification update failed", "error");
    }
  }

  async function deleteNotification(notificationId) {
    if (!activeFamilyId) return;
    if (!token && !isCloudLocalMode()) return;
    try {
      await apiDelete(`/notifications/${notificationId}`);
      await loadNotifications();
    } catch (err) {
      console.error("[S4 Notify] deleteNotification failed", err);
      setMessage(err.message || "Notification delete failed", "error");
    }
  }

  async function loadZakat() {
    if (!activeFamilyId) return;
    if (!token && !isCloudLocalMode()) return;

    try {
      const cached = await loadOfflineSnapshot(activeFamilyId, "zakat", "main").catch(() => null);
      const cachedRecords = Array.isArray(cached?.data)
        ? cached.data
        : cached?.data?.records || cached?.data?.items || [];
      const memRecords = Array.isArray(zakatRecords) ? zakatRecords : [];
      const prevRecords = cachedRecords.length >= memRecords.length ? cachedRecords : memRecords;

      const [recordsRaw, summaryRaw] = await Promise.all([
        apiGet(`/zakat/${activeFamilyId}`),
        apiGet(`/zakat/summary/${activeFamilyId}`),
      ]);
      const loaded = Array.isArray(recordsRaw)
        ? recordsRaw
        : recordsRaw?.records || recordsRaw?.items || [];
      // Never replace a known non-empty list with an empty load (create/sync race).
      const records = loaded.length || !prevRecords.length ? loaded : prevRecords;
      const summary =
        summaryRaw && (summaryRaw.record_count != null || summaryRaw.latest || summaryRaw.total_zakat_due != null)
          ? summaryRaw
          : {
              record_count: records.length,
              count: records.length,
              total_zakat_due: records.reduce((sum, r) => sum + (Number(r.zakat_due) || 0), 0),
              latest: records[0] || null,
            };
      setZakatRecords(records);
      setZakatSummary(summary);
      // Persist array only when we did not keep prev solely to avoid empty wipe.
      if (records.length || !prevRecords.length) {
        await saveOfflineSnapshot(activeFamilyId, "zakat", "main", records);
      }
      if (summary) {
        await saveOfflineSnapshot(activeFamilyId, "zakat", "summary", summary).catch(() => {});
      }
    } catch (err) {
      try {
        const cached = await loadOfflineSnapshot(activeFamilyId, "zakat", "main");
        if (cached?.data) {
          const records = Array.isArray(cached.data)
            ? cached.data
            : cached.data.records || cached.data.items || [];
          setZakatRecords((prev) => (records.length || !prev?.length ? records : prev));
          const sumCached = await loadOfflineSnapshot(activeFamilyId, "zakat", "summary").catch(() => null);
          setZakatSummary(
            sumCached?.data ||
              cached.data.summary ||
              (records.length
                ? {
                    record_count: records.length,
                    count: records.length,
                    total_zakat_due: records.reduce((sum, r) => sum + (Number(r.zakat_due) || 0), 0),
                    latest: records[0] || null,
                  }
                : null),
          );
          setMessage(t("syncQueuedOffline"), "success");
          return;
        }
      } catch {
        /* ignore cache miss */
      }
      setZakatRecords((prev) => (prev?.length ? prev : []));
      setZakatSummary((prev) => prev || null);
      setMessage(err.message || "Zakat load failed", "error");
    }
  }

  async function calculateZakat() {
    const payload = {
      family_id: activeFamilyId,
      calculation_year: zakatForm.calculation_year,
      currency: currencyCode(),
      cash_amount: zakatForm.cash_amount || "0",
      gold_value: zakatForm.gold_value || "0",
      silver_value: zakatForm.silver_value || "0",
      gold_grams: zakatForm.gold_grams ? Number(zakatForm.gold_grams) : null,
      silver_grams: zakatForm.silver_grams ? Number(zakatForm.silver_grams) : null,
      investment_value: zakatForm.investment_value || "0",
      business_assets: zakatForm.business_assets || "0",
      receivables: zakatForm.receivables || "0",
      deductible_debts: zakatForm.deductible_debts || "0",
      nisab_amount: zakatForm.nisab_amount ? Number(zakatForm.nisab_amount) : null,
      nisab_metal: zakatForm.nisab_metal || "SILVER",
      note: zakatForm.note,
      client_request_id: `web-zakat-${Date.now()}`,
    };

    // Cloud-local writes IndexedDB even while offline — do not enqueue-only.
    if (!isBrowserOnline() && !isCloudLocalMode()) {
      await enqueueOutboxChange({
        familyId: activeFamilyId,
        entity_type: "zakat_records",
        operation: "CREATE",
        payload,
      });
      setMessage(t("syncQueuedOffline"), "success");
      await refreshLocalOutboxCount();
      return;
    }

    try {
      const result = await apiPost("/zakat/calculate", payload);
      setMessage(
        result.is_zakat_due
          ? t("zakatDueAmount").replace("{amount}", money(result.zakat_due, result.currency))
          : t("zakatNotDue") || "Below nisab — zakat not due",
        "success"
      );
      await loadZakat();
    } catch (err) {
      const msg = String(err.message || "");
      if (/failed to fetch|network|offline/i.test(msg) && !isCloudLocalMode()) {
        await enqueueOutboxChange({
          familyId: activeFamilyId,
          entity_type: "zakat_records",
          operation: "CREATE",
          payload,
        });
        setMessage(t("syncQueuedOffline"), "success");
        await refreshLocalOutboxCount();
        return;
      }
      setMessage(err.message || "Zakat calculation failed", "error");
    }
  }

  async function loadMetalRates() {
    try {
      const data = await apiGet("/zakat/metal-rates");
      const rates = Array.isArray(data?.rates)
        ? data.rates
        : ["GOLD", "SILVER"]
            .filter((m) => data?.[m] != null)
            .map((m) => ({ metal: m, rate_bdt: Number(data[m]) }));
      setMetalRates({ ...data, rates });
      const gold = rates.find((r) => String(r.metal).toUpperCase() === "GOLD");
      const silver = rates.find((r) => String(r.metal).toUpperCase() === "SILVER");
      setZakatForm((prev) => ({
        ...prev,
        gold_rate: gold?.rate_bdt != null ? String(gold.rate_bdt) : prev.gold_rate || "",
        silver_rate: silver?.rate_bdt != null ? String(silver.rate_bdt) : prev.silver_rate || "",
      }));
    } catch (err) {
      setMessage(err.message || t("metalRatesLoadFailed"), "error");
    }
  }

  async function saveMetalRate(metal) {
    const rate = metal === "GOLD" ? zakatForm.gold_rate : zakatForm.silver_rate;
    if (!rate || Number(rate) <= 0) {
      setMessage(t("validRateRequired"), "error");
      return;
    }
    try {
      await apiPost(`/zakat/metal-rates?family_id=${encodeURIComponent(activeFamilyId)}`, {
        metal,
        rate_bdt: rate,
      });
      setMessage(t("metalRateSaved"), "success");
      await loadMetalRates();
    } catch (err) {
      setMessage(err.message || t("metalRateSaveFailed"), "error");
    }
  }

  async function fillNisabFromRates() {
    try {
      const data = await apiGet(`/zakat/nisab-from-rates?metal=${encodeURIComponent(zakatForm.nisab_metal || "SILVER")}`);
      if (!data || data.ok === false || data.nisab_amount == null || data.nisab_amount === "") {
        setMessage(data?.detail || t("metalRatesLoadFailed"), "error");
        return;
      }
      const amount = String(data.nisab_amount);
      setZakatForm((prev) => ({ ...prev, nisab_amount: amount }));
      setMessage(`${t("nisabLabel")} ${amount}`, "success");
    } catch (err) {
      setMessage(err.message || t("metalRatesLoadFailed"), "error");
    }
  }

  async function loadPhase15() {
    if (!activeFamilyId) return;
    if (!token && !isCloudLocalMode()) return;

    try {
      const cached = await loadOfflineSnapshot(activeFamilyId, "life", "phase15").catch(() => null);
      const cachedItems = Array.isArray(cached?.data?.items) ? cached.data.items : [];
      const memItems = Array.isArray(phase15Items) ? phase15Items : [];
      const prevItems = cachedItems.length >= memItems.length ? cachedItems : memItems;
      const prevSummary = cached?.data?.summary || null;
      const loaded = await loadLifeGroup(apiGet, activeFamilyId, LIFE15, { previousItems: prevItems });
      // Never replace a known non-empty list with an empty load (create/sync race).
      const items = loaded.length || !prevItems.length ? loaded : prevItems;
      let summary = await apiGet(lifeSummaryPath(activeFamilyId)).catch(() => null);
      if (!summary?.modules) {
        summary = summarizeLifeItems(items, LIFE15);
      }
      setPhase15Items(items);
      setPhase15Summary(summary);
      if (items.length || !cachedItems.length) {
        await saveOfflineSnapshot(activeFamilyId, "life", "phase15", {
          items,
          summary: summary || prevSummary || summarizeLifeItems(items, LIFE15),
        });
      }
    } catch (err) {
      try {
        const cached = await loadOfflineSnapshot(activeFamilyId, "life", "phase15");
        if (cached?.data) {
          setPhase15Items(cached.data.items || []);
          setPhase15Summary(cached.data.summary || null);
          setMessage(t("syncQueuedOffline"), "success");
          return;
        }
      } catch {
        /* ignore */
      }
      setPhase15Items((prev) => (prev?.length ? prev : []));
      setPhase15Summary((prev) => prev || null);
      setMessage(err.message || "Assets & Funds load failed", "error");
    }
  }

  function resetPhase15Form(moduleType = phase15ActiveTab) {
    setEditingPhase15Id("");
    setPhase15Form({ ...EMPTY_PHASE15_FORM, module_type: moduleType });
  }

  function startEditPhase15Item(item) {
    setEditingPhase15Id(item.id);
    setPhase15ActiveTab(item.module_type);
    setPhase15Form({
      module_type: item.module_type,
      name: item.name || "",
      category: item.category || "GENERAL",
      sub_type: item.sub_type || "",
      provider: item.provider || "",
      member_id: item.member_id || "",
      amount: item.amount || "0",
      secondary_amount: item.secondary_amount || "",
      target_date: item.target_date || "",
      secondary_date: item.secondary_date || "",
      note: item.note || "",
    });
  }

  async function savePhase15Item() {
    if (!phase15Form.name.trim()) {
      setMessage(t("nameRequired"), "error");
      return;
    }

    // Always trust the visible tab — form.module_type can drift from the tab UI.
    const moduleType = String(phase15ActiveTab || phase15Form.module_type || "INVESTMENT").toUpperCase();
    const formForSave = { ...phase15Form, module_type: moduleType };
    const payload = buildLifeCreatePayload(moduleType, activeFamilyId, currencyCode(), {
      ...formForSave,
      name: formForSave.name.trim(),
    });
    const op = editingPhase15Id ? "UPDATE" : "CREATE";

    // Cloud-local writes IndexedDB even while offline — do not enqueue-only.
    if (!isBrowserOnline() && !isCloudLocalMode()) {
      await enqueueOutboxChange({
        familyId: activeFamilyId,
        entity_type: lifeOfflineEntityType(moduleType),
        entity_id: editingPhase15Id || null,
        operation: op,
        payload: { ...payload, client_request_id: `web-p15-${Date.now()}` },
      });
      resetPhase15Form(moduleType);
      setMessage(t("syncQueuedOffline"), "success");
      await refreshLocalOutboxCount();
      return;
    }

    try {
      if (editingPhase15Id) {
        await apiPatch(lifeUpdatePath(moduleType, editingPhase15Id), payload);
        setMessage(t("assetFundUpdated"), "success");
      } else {
        const created = await apiPost(lifeCreatePath(moduleType), payload);
        // Optimistic UI so the row is visible even if a later hydrate races
        if (created?.id) {
          const normalized = {
            id: created.id,
            family_id: activeFamilyId,
            module_type: moduleType,
            name: created.name || created.vehicle_name || formForSave.name.trim(),
            category: formForSave.category || "GENERAL",
            sub_type: created.sub_type || created.type || formForSave.sub_type || "",
            provider: created.provider || created.doctor || formForSave.provider || null,
            member_id: created.member_id || formForSave.member_id || null,
            amount: created.amount ?? created.principal ?? formForSave.amount ?? "0",
            secondary_amount: created.secondary_amount ?? formForSave.secondary_amount ?? null,
            currency: created.currency || currencyCode(),
            target_date: created.target_date || formForSave.target_date || null,
            secondary_date: created.secondary_date || formForSave.secondary_date || null,
            status: "ACTIVE",
            note: created.note || formForSave.note || null,
          };
          setPhase15Items((prev) => {
            const next = [normalized, ...(prev || []).filter((r) => String(r.id) !== String(normalized.id))];
            setPhase15Summary(summarizeLifeItems(next, LIFE15));
            return next;
          });
        }
        setMessage(t("assetFundCreated"), "success");
      }
      resetPhase15Form(moduleType);
      await loadPhase15();
    } catch (err) {
      const msg = String(err.message || "");
      if (/failed to fetch|network|offline/i.test(msg) && !isCloudLocalMode()) {
        await enqueueOutboxChange({
          familyId: activeFamilyId,
          entity_type: lifeOfflineEntityType(moduleType),
          entity_id: editingPhase15Id || null,
          operation: op,
          payload: { ...payload, client_request_id: `web-p15-${Date.now()}` },
        });
        setMessage(t("syncQueuedOffline"), "success");
        await refreshLocalOutboxCount();
        return;
      }
      setMessage(err.message || "Asset/Fund save failed", "error");
    }
  }

  async function closePhase15Item(item) {
    if (!isBrowserOnline() && !isCloudLocalMode()) {
      await enqueueOutboxChange({
        familyId: activeFamilyId,
        entity_type: lifeOfflineEntityType(item.module_type),
        entity_id: item.id,
        operation: "DELETE",
        payload: { family_id: activeFamilyId, status: "CLOSED" },
      });
      setMessage(t("syncQueuedOffline"), "success");
      await refreshLocalOutboxCount();
      return;
    }
    try {
      await apiPost(lifeClosePath(item.module_type, item.id), { family_id: activeFamilyId, reason: "Closed from dashboard" });
      await loadPhase15();
    } catch (err) {
      const msg = String(err.message || "");
      if (/failed to fetch|network|offline/i.test(msg) && !isCloudLocalMode()) {
        await enqueueOutboxChange({
          familyId: activeFamilyId,
          entity_type: lifeOfflineEntityType(item.module_type),
          entity_id: item.id,
          operation: "DELETE",
          payload: { family_id: activeFamilyId, status: "CLOSED" },
        });
        setMessage(t("syncQueuedOffline"), "success");
        await refreshLocalOutboxCount();
        return;
      }
      setMessage(err.message || "Asset/Fund close failed", "error");
    }
  }

  async function loadPhase16() {
    if (!activeFamilyId) return;
    if (!token && !isCloudLocalMode()) return;
    try {
      const cached = await loadOfflineSnapshot(activeFamilyId, "life", "phase16").catch(() => null);
      const cachedItems = Array.isArray(cached?.data?.items) ? cached.data.items : [];
      const memItems = Array.isArray(phase16Items) ? phase16Items : [];
      const prevItems = cachedItems.length >= memItems.length ? cachedItems : memItems;
      const prevSummary = cached?.data?.summary || null;
      const loaded = await loadLifeGroup(apiGet, activeFamilyId, LIFE16, { previousItems: prevItems });
      const items = loaded.length || !prevItems.length ? loaded : prevItems;
      let summary = await apiGet(lifeSummaryPath(activeFamilyId)).catch(() => null);
      if (!summary?.modules) {
        summary = summarizeLifeItems(items, LIFE16);
      }
      setPhase16Items(items);
      setPhase16Summary(summary);
      if (items.length || !cachedItems.length) {
        await saveOfflineSnapshot(activeFamilyId, "life", "phase16", {
          items,
          summary: summary || prevSummary || summarizeLifeItems(items, LIFE16),
        });
      }
    } catch (err) {
      try {
        const cached = await loadOfflineSnapshot(activeFamilyId, "life", "phase16");
        if (cached?.data) {
          setPhase16Items(cached.data.items || []);
          setPhase16Summary(cached.data.summary || null);
          setMessage(t("syncQueuedOffline"), "success");
          return;
        }
      } catch {
        /* ignore */
      }
      setPhase16Items((prev) => (prev?.length ? prev : []));
      setPhase16Summary((prev) => prev || null);
      setMessage(err.message || "Subscriptions, Documents & Property load failed", "error");
    }
  }

  function resetPhase16Form(moduleType = phase16ActiveTab) {
    setEditingPhase16Id("");
    setDocumentFile(null);
    setPhase16Form({ ...EMPTY_PHASE16_FORM, module_type: moduleType });
  }

  function startEditPhase16Item(item) {
    setEditingPhase16Id(item.id);
    setPhase16ActiveTab(item.module_type);
    setPhase16Form({
      module_type: item.module_type,
      name: item.name || "",
      category: item.category || "GENERAL",
      sub_type: item.sub_type || "",
      provider: item.provider || "",
      member_id: item.member_id || "",
      amount: item.amount || "0",
      secondary_amount: item.secondary_amount || "",
      renewal_or_expiry_date: item.renewal_or_expiry_date || "",
      secondary_date: item.secondary_date || "",
      billing_cycle: item.billing_cycle || "MONTHLY",
      payment_account_id: item.payment_account_id || "",
      reference: item.reference || "",
      note: item.note || "",
    });
  }

  async function persistDocumentFileMeta(itemId, result) {
    const patch = {
      file_name: result.file_name || result.name || null,
      file_url: result.download_url || result.file_url || null,
      file_path: result.download_url || result.file_path || result.storage_path || null,
      storage_path: result.storage_path || null,
      mime: result.mime || result.content_type || null,
      file_size: result.size || result.file_size || null,
      uploaded_at: result.uploaded_at || new Date().toISOString(),
      has_file: true,
      file_encrypted: Boolean(result.encrypted || result.file_encrypted),
    };
    try {
      await apiPatch(lifeUpdatePath("DOCUMENT", itemId), patch);
    } catch {
      // Fallback: write metadata directly into the phase16 bag
      try {
        const bag = await loadOfflineSnapshot(activeFamilyId, "life", "phase16").catch(() => null);
        const items = Array.isArray(bag?.data?.items) ? bag.data.items : [];
        const nextItems = items.map((row) =>
          String(row.id) === String(itemId) ? { ...row, ...patch, module_type: "DOCUMENT" } : row,
        );
        await saveOfflineSnapshot(activeFamilyId, "life", "phase16", {
          ...(bag?.data || {}),
          items: nextItems,
        });
      } catch {
        /* metadata optional */
      }
    }
  }

  async function uploadPhase16Document(itemId, file) {
    if (!isBrowserOnline() && !isCloudLocalMode()) {
      await queueDocumentUpload({ familyId: activeFamilyId, itemId, file });
      setMessage(t("documentQueuedOffline"), "success");
      return { queued: true };
    }

    if (isCloudLocalMode()) {
      if (!isBrowserOnline()) {
        await queueDocumentUpload({ familyId: activeFamilyId, itemId, file });
        setMessage(t("documentQueuedOffline"), "success");
        return { queued: true };
      }
      const result = await uploadFamilyDocument({
        familyId: activeFamilyId,
        itemId,
        file,
        uid: firebaseUser?.uid,
      });
      await persistDocumentFileMeta(itemId, result);
      await syncCloudAfterWrite();
      return result;
    }

    const formData = new FormData();
    formData.append("family_id", activeFamilyId);
    formData.append("file", file);
    const res = await fetch(`${apiBase}${documentUploadPath(itemId)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.detail || "Document upload failed");
    }
    return data;
  }

  async function savePhase16Item() {
    if (!phase16Form.name.trim()) {
      setMessage(t("nameRequired"), "error");
      return;
    }

    // Always trust the visible tab — form.module_type can drift from the tab UI.
    const moduleType = String(phase16ActiveTab || phase16Form.module_type || "SUBSCRIPTION").toUpperCase();
    const formForSave = { ...phase16Form, module_type: moduleType };
    const payload = buildLifeCreatePayload(moduleType, activeFamilyId, currencyCode(), {
      ...formForSave,
      name: formForSave.name.trim(),
    });
    const op = editingPhase16Id ? "UPDATE" : "CREATE";
    const clientRequestId = `web-p16-${Date.now()}`;

    // Cloud-local writes IndexedDB even while offline — do not enqueue-only.
    if (!isBrowserOnline() && !isCloudLocalMode()) {
      const localId = editingPhase16Id || clientRequestId;
      await enqueueOutboxChange({
        familyId: activeFamilyId,
        entity_type: lifeOfflineEntityType(moduleType),
        entity_id: editingPhase16Id || null,
        operation: op,
        payload: {
          ...payload,
          client_request_id: clientRequestId,
          file_name: documentFile?.name || null,
          file_mime: documentFile?.type || null,
          file_size: documentFile?.size || null,
        },
      });
      if (moduleType === "DOCUMENT" && documentFile) {
        await queueDocumentUpload({
          familyId: activeFamilyId,
          itemId: localId,
          file: documentFile,
        });
      }
      resetPhase16Form(moduleType);
      setMessage(t("syncQueuedOffline"), "success");
      await refreshLocalOutboxCount();
      return;
    }

    try {
      let itemId = editingPhase16Id;
      if (editingPhase16Id) {
        await apiPatch(lifeUpdatePath(moduleType, editingPhase16Id), payload);
        setMessage(t("phase16Updated"), "success");
      } else {
        const created = await apiPost(lifeCreatePath(moduleType), payload);
        itemId = created?.id || "";
        if (created?.id) {
          const normalized = {
            id: created.id,
            family_id: activeFamilyId,
            module_type: moduleType,
            name: created.name || formForSave.name.trim(),
            category: formForSave.category || "GENERAL",
            sub_type: created.sub_type || created.type || formForSave.sub_type || "",
            provider: created.provider || created.location || formForSave.provider || null,
            member_id: created.member_id || formForSave.member_id || null,
            amount: created.amount ?? formForSave.amount ?? "0",
            secondary_amount: created.secondary_amount ?? created.value ?? formForSave.secondary_amount ?? null,
            currency: created.currency || currencyCode(),
            renewal_or_expiry_date:
              created.renewal_or_expiry_date ||
              created.next_due ||
              created.expiry_date ||
              formForSave.renewal_or_expiry_date ||
              null,
            billing_cycle: created.billing_cycle || created.cycle || formForSave.billing_cycle || null,
            payment_account_id: created.payment_account_id || formForSave.payment_account_id || null,
            reference: created.reference || created.area || formForSave.reference || null,
            status: "ACTIVE",
            note: created.note || formForSave.note || null,
            has_file: false,
          };
          setPhase16Items((prev) => {
            const next = [normalized, ...(prev || []).filter((r) => String(r.id) !== String(normalized.id))];
            setPhase16Summary(summarizeLifeItems(next, LIFE16));
            return next;
          });
        }
        setMessage(t("phase16Created"), "success");
      }

      if (moduleType === "DOCUMENT" && documentFile && itemId) {
        await uploadPhase16Document(itemId, documentFile);
        setMessage(t("documentSavedUploaded"), "success");
      }

      resetPhase16Form(moduleType);
      await loadPhase16();
    } catch (err) {
      const msg = String(err.message || "");
      if (/failed to fetch|network|offline/i.test(msg) && !isCloudLocalMode()) {
        await enqueueOutboxChange({
          familyId: activeFamilyId,
          entity_type: lifeOfflineEntityType(moduleType),
          entity_id: editingPhase16Id || null,
          operation: op,
          payload: { ...payload, client_request_id: clientRequestId },
        });
        if (documentFile) {
          await queueDocumentUpload({
            familyId: activeFamilyId,
            itemId: editingPhase16Id || clientRequestId,
            file: documentFile,
          });
        }
        setMessage(t("syncQueuedOffline"), "success");
        await refreshLocalOutboxCount();
        return;
      }
      setMessage(err.message || "Phase16 save failed", "error");
    }
  }

  async function uploadDocumentForItem(item, file) {
    if (!item?.id || !file) return;
    try {
      await uploadPhase16Document(item.id, file);
      setMessage(t("documentUploaded"), "success");
      await loadPhase16();
    } catch (err) {
      setMessage(err.message || "Document upload failed", "error");
    }
  }

  async function downloadPhase16Document(item) {
    if (!item?.id) return;
    const cacheType = `phase16-doc-${item.id}`;
    const trigger = (blob, name) => {
      const fileUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = fileUrl;
      a.download = name || "document.bin";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(fileUrl);
    };
    try {
      if (!isBrowserOnline()) {
        const cached = await getCachedReportExport(activeFamilyId, cacheType, "bin");
        if (cached?.blob) {
          trigger(cached.blob, item.file_name || cached.fileName);
          setMessage(t("offlineExportOpened"), "success");
          return;
        }
        setMessage(t("downloadFailed"), "error");
        return;
      }

      // Cloud-local: download from Firebase Storage URL stored on the item
      if (isCloudLocalMode()) {
        const url = item.file_url || item.file_path;
        if (!url) {
          setMessage(t("noFileAttached") || "No file attached", "error");
          return;
        }
        const res = await fetch(url);
        if (!res.ok) throw new Error("Document download failed");
        const blob = await res.blob();
        try {
          await cacheReportExport(activeFamilyId, cacheType, "bin", blob);
        } catch {
          /* optional */
        }
        trigger(blob, item.file_name || "document.bin");
        setMessage(t("documentDownloadStarted"), "success");
        return;
      }

      const res = await fetch(
        `${apiBase}/documents/${item.id}/download?family_id=${encodeURIComponent(activeFamilyId)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Document download failed");
      }
      const blob = await res.blob();
      try {
        await cacheReportExport(activeFamilyId, cacheType, "bin", blob);
      } catch {
        /* optional */
      }
      trigger(blob, item.file_name || "document.bin");
      setMessage(t("documentDownloadStarted"), "success");
    } catch (err) {
      try {
        const cached = await getCachedReportExport(activeFamilyId, `phase16-doc-${item.id}`, "bin");
        if (cached?.blob) {
          trigger(cached.blob, item.file_name || cached.fileName);
          setMessage(t("offlineExportOpened"), "success");
          return;
        }
      } catch {
        /* ignore */
      }
      setMessage(err.message || "Document download failed", "error");
    }
  }

  async function closePhase16Item(item) {
    if (!isBrowserOnline() && !isCloudLocalMode()) {
      await enqueueOutboxChange({
        familyId: activeFamilyId,
        entity_type: lifeOfflineEntityType(item.module_type),
        entity_id: item.id,
        operation: "DELETE",
        payload: { family_id: activeFamilyId, status: "CLOSED" },
      });
      setMessage(t("syncQueuedOffline"), "success");
      await refreshLocalOutboxCount();
      return;
    }
    try {
      await apiPost(lifeClosePath(item.module_type, item.id), { family_id: activeFamilyId, reason: "Closed from dashboard" });
      await loadPhase16();
    } catch (err) {
      const msg = String(err.message || "");
      if (/failed to fetch|network|offline/i.test(msg) && !isCloudLocalMode()) {
        await enqueueOutboxChange({
          familyId: activeFamilyId,
          entity_type: lifeOfflineEntityType(item.module_type),
          entity_id: item.id,
          operation: "DELETE",
          payload: { family_id: activeFamilyId, status: "CLOSED" },
        });
        setMessage(t("syncQueuedOffline"), "success");
        await refreshLocalOutboxCount();
        return;
      }
      setMessage(err.message || "Subscription/Document/Property close failed", "error");
    }
  }

  async function loadGrocery(options = {}) {
    const silent = Boolean(options.silent);
    const preferListId = options.listId != null ? String(options.listId || "") : null;
    if (!activeFamilyId) return;
    if (!token && !isCloudLocalMode()) return;

    try {
      const [lists, priceHistory, vendorSummary, vendors, activity, collaboration] = await Promise.all([
        apiGet(`/grocery/lists/${activeFamilyId}`),
        apiGet(`/grocery/price-history/${activeFamilyId}`),
        apiGet(`/grocery/vendor-summary/${activeFamilyId}`),
        apiGet(`/grocery/vendors/${activeFamilyId}`),
        apiGet(`/grocery/activity/${activeFamilyId}`),
        apiGet(`/grocery/collaboration/status/${activeFamilyId}`),
      ]);
      const listRows = Array.isArray(lists) ? lists : lists?.lists || [];
      setGroceryLists(listRows);
      setGroceryPriceHistory(Array.isArray(priceHistory) ? priceHistory : []);
      setGroceryVendorSummary(Array.isArray(vendorSummary) ? vendorSummary : []);
      setGroceryVendors(Array.isArray(vendors) ? vendors : []);
      setGroceryActivity(Array.isArray(activity) ? activity : []);
      setGroceryCollaboration(collaboration || null);
      const nextListId =
        preferListId ||
        (activeGroceryListId && listRows.some((l) => String(l.id) === String(activeGroceryListId))
          ? activeGroceryListId
          : listRows[0]?.id || "");
      setActiveGroceryListId(nextListId);

      if (nextListId) {
        const items = await apiGet(`/grocery/lists/${activeFamilyId}/${nextListId}/items`);
        setGroceryItems(Array.isArray(items) ? items : items?.items || []);
      } else {
        setGroceryItems([]);
      }

      // Default wallet + Food expense category for post-expense
      const walletRows = Array.isArray(options.walletRows) ? options.walletRows : wallets;
      const categoryRows = Array.isArray(options.categoryRows) ? options.categoryRows : categories;
      setGroceryExpenseForm((prev) => {
        const next = { ...prev };
        if (!next.account_id && walletRows?.length) {
          const wallet = walletRows.find((w) => w.is_active !== false && !w.deleted_at) || walletRows[0];
          if (wallet?.id) next.account_id = wallet.id;
        }
        if (!next.category_id && categoryRows?.length) {
          const food =
            categoryRows.find((c) => /food|grocery/i.test(String(c.name || c.name_en || ""))) ||
            categoryRows.find((c) => String(c.category_type || c.type || "").toUpperCase() === "EXPENSE");
          if (food?.id) next.category_id = food.id;
        }
        return next;
      });
    } catch (err) {
      // Keep last known grocery data — avoid flashing empty zeros on transient errors
      if (!silent) {
        setMessage(err.message || "Grocery load failed", "error");
      }
    }
  }

  async function selectGroceryList(listId) {
    setActiveGroceryListId(listId);
    if (!listId) {
      setGroceryItems([]);
      return;
    }

    try {
      const items = await apiGet(`/grocery/lists/${activeFamilyId}/${listId}/items`);
      setGroceryItems(Array.isArray(items) ? items : items?.items || []);
    } catch (err) {
      setGroceryItems([]);
      setMessage(err.message || "Grocery items load failed", "error");
    }
  }

  async function createGroceryList() {
    if (!groceryListForm.title.trim()) {
      setMessage(t("groceryListTitleRequired"), "error");
      return;
    }

    const payload = {
      family_id: activeFamilyId,
      title: groceryListForm.title.trim(),
      budget_amount: groceryListForm.budget_amount || "0",
      currency: currencyCode(),
      vendor_name: groceryListForm.vendor_name || null,
      shopping_date: groceryListForm.shopping_date || null,
      note: groceryListForm.note,
      mobile_sync_key: `web-glist-${Date.now()}`,
    };

    // Cloud-local writes IndexedDB even while offline — do not enqueue-only.
    if (!isBrowserOnline() && !isCloudLocalMode()) {
      await enqueueGroceryChange(activeFamilyId, {
        entity_type: "grocery_lists",
        operation: "CREATE",
        payload,
      });
      setGroceryListForm({ title: "", budget_amount: "0", vendor_name: "", shopping_date: "", note: "" });
      setMessage(t("syncQueuedOffline"), "success");
      await refreshLocalOutboxCount();
      return;
    }

    try {
      const row = await apiPost("/grocery/lists", payload);
      setGroceryListForm({ title: "", budget_amount: "0", vendor_name: "", shopping_date: "", note: "" });
      setActiveGroceryListId(row.id);
      setMessage(t("groceryListCreated"), "success");
      await loadGrocery({ listId: row.id });
    } catch (err) {
      const msg = String(err.message || "");
      if (/failed to fetch|network|offline/i.test(msg) && !isCloudLocalMode()) {
        await enqueueGroceryChange(activeFamilyId, {
          entity_type: "grocery_lists",
          operation: "CREATE",
          payload,
        });
        setMessage(t("syncQueuedOffline"), "success");
        await refreshLocalOutboxCount();
        return;
      }
      setMessage(err.message || "Grocery list create failed", "error");
    }
  }

  async function createGroceryVendor() {
    if (!groceryVendorForm.name.trim()) {
      setMessage(t("vendorNameRequired"), "error");
      return;
    }

    const payload = {
      family_id: activeFamilyId,
      name: groceryVendorForm.name.trim(),
      phone: groceryVendorForm.phone || null,
      address: groceryVendorForm.address || null,
      category: groceryVendorForm.category || "GENERAL",
      note: groceryVendorForm.note,
    };

    if (!isBrowserOnline() && !isCloudLocalMode()) {
      await enqueueGroceryChange(activeFamilyId, {
        entity_type: "grocery_vendors",
        operation: "CREATE",
        payload,
      });
      setGroceryVendorForm({ name: "", phone: "", address: "", category: "GENERAL", note: "" });
      setMessage(t("syncQueuedOffline"), "success");
      await refreshLocalOutboxCount();
      return;
    }

    try {
      await apiPost("/grocery/vendors", payload);
      setGroceryVendorForm({ name: "", phone: "", address: "", category: "GENERAL", note: "" });
      setMessage(t("groceryVendorCreated"), "success");
      await loadGrocery();
    } catch (err) {
      const msg = String(err.message || "");
      if (/failed to fetch|network|offline/i.test(msg) && !isCloudLocalMode()) {
        await enqueueGroceryChange(activeFamilyId, {
          entity_type: "grocery_vendors",
          operation: "CREATE",
          payload,
        });
        setMessage(t("syncQueuedOffline"), "success");
        await refreshLocalOutboxCount();
        return;
      }
      setMessage(err.message || "Grocery vendor create failed", "error");
    }
  }

  async function createGroceryItem() {
    if (!activeGroceryListId) {
      setMessage(t("selectGroceryListFirst"), "error");
      return;
    }
    if (!groceryItemForm.name.trim()) {
      setMessage(t("groceryItemNameRequired"), "error");
      return;
    }

    const payload = {
      family_id: activeFamilyId,
      grocery_list_id: activeGroceryListId,
      name: groceryItemForm.name.trim(),
      category: groceryItemForm.category || "GENERAL",
      quantity: groceryItemForm.quantity || "1",
      unit: groceryItemForm.unit || "pcs",
      estimated_price: groceryItemForm.estimated_price || "0",
      actual_price: groceryItemForm.actual_price || "0",
      vendor_name: groceryItemForm.vendor_name || null,
      barcode: groceryItemForm.barcode || null,
      note: groceryItemForm.note,
      mobile_sync_key: `web-${Date.now()}`,
    };

    if (!isBrowserOnline() && !isCloudLocalMode()) {
      await enqueueGroceryChange(activeFamilyId, {
        entity_type: "grocery_items",
        operation: "CREATE",
        payload,
      });
      setGroceryItemForm((prev) => ({ ...prev, name: "", estimated_price: "0", actual_price: "0", barcode: "", note: "" }));
      setMessage(t("syncQueuedOffline"), "success");
      await refreshLocalOutboxCount();
      return;
    }

    try {
      await apiPost("/grocery/items", payload);
      setGroceryItemForm((prev) => ({ ...prev, name: "", estimated_price: "0", actual_price: "0", barcode: "", note: "" }));
      setMessage(t("groceryItemAdded"), "success");
      await selectGroceryList(activeGroceryListId);
      await loadGrocery({ listId: activeGroceryListId, silent: true });
    } catch (err) {
      const msg = String(err.message || "");
      if (/failed to fetch|network|offline/i.test(msg) && !isCloudLocalMode()) {
        await enqueueGroceryChange(activeFamilyId, {
          entity_type: "grocery_items",
          operation: "CREATE",
          payload,
        });
        setMessage(t("syncQueuedOffline"), "success");
        await refreshLocalOutboxCount();
        return;
      }
      setMessage(err.message || "Grocery item create failed", "error");
    }
  }

  async function markGroceryBought(item) {
    const payload = {
      family_id: activeFamilyId,
      is_bought: true,
      actual_price: item.actual_price || item.estimated_price || "0",
      vendor_name: item.vendor_name || null,
      expected_sync_version: item.sync_version,
      sync_version: item.sync_version,
    };

    if (!isBrowserOnline() && !isCloudLocalMode()) {
      await enqueueGroceryChange(activeFamilyId, {
        entity_type: "grocery_items",
        entity_id: item.id,
        operation: "UPDATE",
        payload,
      });
      setGroceryItems((prev) =>
        (prev || []).map((row) => (row.id === item.id ? { ...row, is_bought: true } : row))
      );
      setMessage(t("syncQueuedOffline"), "success");
      await refreshLocalOutboxCount();
      return;
    }

    try {
      await apiPut(`/grocery/items/${item.id}/buy`, {
        family_id: activeFamilyId,
        is_bought: true,
        actual_price: item.actual_price || item.estimated_price || "0",
        vendor_name: item.vendor_name || null,
        expected_sync_version: item.sync_version,
      });
      await selectGroceryList(activeGroceryListId);
      const [priceHistory, vendorSummary, vendors, activity] = await Promise.all([
        apiGet(`/grocery/price-history/${activeFamilyId}`),
        apiGet(`/grocery/vendor-summary/${activeFamilyId}`),
        apiGet(`/grocery/vendors/${activeFamilyId}`),
        apiGet(`/grocery/activity/${activeFamilyId}`),
      ]);
      setGroceryPriceHistory(Array.isArray(priceHistory) ? priceHistory : []);
      setGroceryVendorSummary(Array.isArray(vendorSummary) ? vendorSummary : []);
      setGroceryVendors(Array.isArray(vendors) ? vendors : []);
      setGroceryActivity(Array.isArray(activity) ? activity : []);
    } catch (err) {
      const msg = String(err.message || "");
      if (/failed to fetch|network|offline/i.test(msg) && !isCloudLocalMode()) {
        await enqueueGroceryChange(activeFamilyId, {
          entity_type: "grocery_items",
          entity_id: item.id,
          operation: "UPDATE",
          payload,
        });
        setMessage(t("syncQueuedOffline"), "success");
        await refreshLocalOutboxCount();
        return;
      }
      setMessage(err.message || "Grocery buy update failed", "error");
    }
  }

  async function postGroceryExpense(item) {
    if (!groceryExpenseForm.account_id || !groceryExpenseForm.category_id) {
      setMessage(t("selectWalletExpenseCategory"), "error");
      return;
    }

    try {
      const result = await apiPost(`/grocery/items/${item.id}/post-expense`, {
        family_id: activeFamilyId,
        account_id: groceryExpenseForm.account_id,
        category_id: groceryExpenseForm.category_id,
        amount: item.actual_price || item.estimated_price || "0",
        description: `Grocery expense: ${item.name}`,
      });
      setMessage(t("groceryExpensePosted").replace("{id}", result.transaction_id), "success");
      await selectGroceryList(activeGroceryListId);
      await loadDashboard();
      await loadWallets();
      await loadTransactions();
    } catch (err) {
      setMessage(err.message || "Grocery expense post failed", "error");
    }
  }

  async function lookupGroceryBarcode() {
    if (!groceryScanForm.barcode.trim()) {
      setMessage(t("barcodeRequired"), "error");
      return;
    }

    try {
      const result = await apiGet(`/grocery/barcode/${activeFamilyId}/${encodeURIComponent(groceryScanForm.barcode.trim())}`);
      setGroceryBarcodeLookup(result);
      setMessage(
        result.found ? t("barcodeMatchFound") : t("barcodeNoMatch"),
        result.found ? "success" : "warning"
      );
    } catch (err) {
      setGroceryBarcodeLookup(null);
      setMessage(err.message || "Barcode lookup failed", "error");
    }
  }

  async function parseGroceryOcrText() {
    if (!groceryScanForm.raw_text.trim()) {
      setMessage(t("receiptTextRequired"), "error");
      return;
    }

    try {
      const result = await apiPost("/grocery/ocr/parse", {
        family_id: activeFamilyId,
        raw_text: groceryScanForm.raw_text,
      });
      setGroceryOcrPreview(result);
      setMessage(t("ocrSuggestionsCount").replace("{n}", digits(result.suggestion_count || 0)), "success");
    } catch (err) {
      setGroceryOcrPreview(null);
      setMessage(err.message || "OCR parse failed", "error");
    }
  }

  async function parseGroceryOcrImage(file) {
    if (!file || !activeFamilyId) {
      setMessage(t("ocrImageHint") || "Image required", "error");
      return;
    }
    if (isCloudLocalMode()) {
      try {
        setMessage(t("ocrScanningImage") || "Reading receipt image…", "info");
        const { extractTextFromImageFile, grocerySuggestionsFromOcrText } = await import("./lib/clientOcr");
        const rawText = await extractTextFromImageFile(file);
        if (!rawText) {
          setMessage(t("ocrNoTextFound") || "No text found in image — try a clearer photo or paste text.", "warning");
          return;
        }
        setGroceryScanForm((prev) => ({ ...prev, raw_text: rawText }));
        const result = grocerySuggestionsFromOcrText(rawText);
        setGroceryOcrPreview(result);
        setMessage(
          t("ocrSuggestionsCount").replace("{n}", digits(result.suggestion_count || 0)),
          "success",
        );
      } catch (err) {
        setGroceryOcrPreview(null);
        setMessage(err.message || t("ocrImageFailed") || "OCR image parse failed", "error");
      }
      return;
    }
    if (!token) {
      setMessage(t("ocrImageHint") || "Image required", "error");
      return;
    }
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch(
        `${apiBase}/grocery/ocr/parse-image?family_id=${encodeURIComponent(activeFamilyId)}`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body,
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || "OCR image parse failed");
      setGroceryOcrPreview(data);
      setMessage(
        t("ocrSuggestionsCount").replace("{n}", digits(data.suggestion_count || data.suggestions?.length || 0)),
        "success"
      );
    } catch (err) {
      setGroceryOcrPreview(null);
      setMessage(err.message || "OCR image parse failed", "error");
    }
  }

  function applyGroceryBarcodeToForm() {
    const latest = groceryBarcodeLookup?.latest;
    if (!latest) {
      setMessage(t("noBarcodeMatch"), "error");
      return;
    }
    setGroceryItemForm((prev) => ({
      ...prev,
      name: latest.name || prev.name,
      category: latest.category || prev.category || "GENERAL",
      quantity: latest.quantity || prev.quantity || "1",
      unit: latest.unit || prev.unit || "pcs",
      estimated_price: latest.estimated_price || latest.actual_price || prev.estimated_price || "0",
      actual_price: latest.actual_price || prev.actual_price || "0",
      vendor_name: latest.vendor_name || prev.vendor_name || "",
      barcode: groceryBarcodeLookup.barcode || latest.barcode || prev.barcode || "",
      note: latest.note || prev.note || "",
    }));
    setGroceryTab("lists");
    setMessage(t("barcodeApplied"), "success");
  }

  async function addGroceryOcrSuggestion(suggestion) {
    if (!activeGroceryListId) {
      setMessage(t("selectGroceryListFirst"), "error");
      return;
    }
    try {
      await apiPost("/grocery/items", {
        family_id: activeFamilyId,
        grocery_list_id: activeGroceryListId,
        name: String(suggestion.name || "").trim(),
        category: "OCR",
        quantity: suggestion.quantity || "1",
        unit: suggestion.unit || "pcs",
        estimated_price: suggestion.estimated_price || "0",
        actual_price: "0",
        vendor_name: null,
        barcode: null,
        note: suggestion.raw_line || null,
      });
      setMessage(t("ocrItemAdded").replace("{name}", suggestion.name), "success");
      await selectGroceryList(activeGroceryListId);
      await loadGrocery();
    } catch (err) {
      setMessage(err.message || "OCR item add failed", "error");
    }
  }

  async function addAllGroceryOcrSuggestions() {
    const suggestions = groceryOcrPreview?.suggestions || [];
    if (!suggestions.length) {
      setMessage(t("noOcrSuggestions"), "error");
      return;
    }
    if (!activeGroceryListId) {
      setMessage(t("selectGroceryListFirst"), "error");
      return;
    }
    let added = 0;
    for (const suggestion of suggestions) {
      try {
        await apiPost("/grocery/items", {
          family_id: activeFamilyId,
          grocery_list_id: activeGroceryListId,
          name: String(suggestion.name || "").trim(),
          category: "OCR",
          quantity: suggestion.quantity || "1",
          unit: suggestion.unit || "pcs",
          estimated_price: suggestion.estimated_price || "0",
          actual_price: "0",
          vendor_name: null,
          barcode: null,
          note: suggestion.raw_line || null,
        });
        added += 1;
      } catch {
        // continue remaining suggestions
      }
    }
    setMessage(t("ocrItemsAdded").replace("{n}", digits(added)), added ? "success" : "error");
    await selectGroceryList(activeGroceryListId);
    await loadGrocery();
    setGroceryTab("lists");
  }

  async function loadReportLedger(accountId) {
    const nextAccountId = accountId || reportAccountId;

    if (!activeFamilyId || !nextAccountId) {
      setLedgerReport(null);
      return;
    }
    if (!token && !isCloudLocalMode()) {
      setLedgerReport(null);
      return;
    }

    try {
      const data = await apiGet(
        `/families/${activeFamilyId}/reports/account-ledger?account_id=${encodeURIComponent(nextAccountId)}&limit=25`
      );
      setLedgerReport(data);
    } catch (err) {
      setLedgerReport((prev) => prev || null);
      setMessage(err.message || "Account ledger load failed", "error");
    }
  }

  async function loadExtraReport(tab) {
    if (!activeFamilyId) return;
    if (!token && !isCloudLocalMode()) return;
    setReportsLoading(true);
    try {
      if (tab === "networth") {
        const [dash, nw] = await Promise.all([
          apiGet(`/reports/dashboard/${activeFamilyId}`).catch(() => null),
          apiGet(`/reports/net-worth/${activeFamilyId}`),
        ]);
        setNetWorthReport({ ...(nw || {}), ...(dash || {}) });
      } else if (tab === "categories") {
        setCategoryReport(await apiGet(`/reports/categories/${activeFamilyId}`));
      } else if (tab === "budget") {
        setBudgetReport(await apiGet(`/reports/budget/${activeFamilyId}`));
      } else if (tab === "loans") {
        setLoanReport(await apiGet(`/reports/loans/${activeFamilyId}`));
      } else if (tab === "savings") {
        setSavingsTrendReport(await apiGet(`/reports/savings-trend/${activeFamilyId}`));
      } else if (tab === "apilogs") {
        setApiLogsReport(
          await apiGet(`/api-logs?family_id=${encodeURIComponent(activeFamilyId)}&min_ms=0&limit=80`),
        );
      }
    } catch (err) {
      setMessage(err.message || "Report load failed", "error");
    } finally {
      setReportsLoading(false);
    }
  }

  async function loadReports() {
    if (!activeFamilyId) return;
    if (!token && !isCloudLocalMode()) return;

    setReportsLoading(true);

    try {
      const [financial, wallet] = await Promise.all([
        apiGet(`/families/${activeFamilyId}/reports/financial-summary`),
        apiGet(`/families/${activeFamilyId}/reports/wallet-summary`),
      ]);

      setFinancialReport(financial);
      setWalletReport(wallet);
      await saveOfflineSnapshot(activeFamilyId, "reports", "overview", { financial, wallet });

      const firstAccountId = reportAccountId || wallet.wallets?.[0]?.id || "";
      setReportAccountId(firstAccountId);

      if (firstAccountId) {
        await loadReportLedger(firstAccountId);
      } else {
        setLedgerReport(null);
      }
    } catch (err) {
      try {
        const cached = await loadOfflineSnapshot(activeFamilyId, "reports", "overview");
        if (cached?.data) {
          setFinancialReport(cached.data.financial || null);
          setWalletReport(cached.data.wallet || null);
          setMessage(t("syncQueuedOffline"), "success");
          return;
        }
      } catch {
        /* ignore */
      }
      setFinancialReport((prev) => prev || null);
      setWalletReport((prev) => prev || null);
      setLedgerReport((prev) => prev || null);
      setMessage(err.message || "Reports load failed", "error");
    } finally {
      setReportsLoading(false);
    }
  }

  async function loadCurrencyData() {
    if (!activeFamilyId) return;
    if (!token && !isCloudLocalMode()) return;

    setCurrencyLoading(true);

    try {
      const [currencyList, rateList, familySummary] = await Promise.all([
        apiGet("/currency/"),
        apiGet("/currency/rates"),
        apiGet(`/currency/family-summary/${activeFamilyId}`),
      ]);

      const currenciesNext = Array.isArray(currencyList) ? currencyList : [];
      const ratesNext = Array.isArray(rateList) ? rateList : [];
      setCurrencies(currenciesNext);
      setExchangeRates(ratesNext);
      setCurrencySummary(familySummary);
      await saveOfflineSnapshot(activeFamilyId, "system", "currency", {
        currencies: currenciesNext,
        exchangeRates: ratesNext,
        currencySummary: familySummary,
        code: familySummary?.base_currency || "BDT",
        symbol: familySummary?.base_currency || "BDT",
      }).catch(() => {});
    } catch (err) {
      const msg = String(err?.message || "");
      if (/failed to fetch|network|offline/i.test(msg) || !isBrowserOnline()) {
        const cached = await loadOfflineSnapshot(activeFamilyId, "system", "currency").catch(() => null);
        if (cached?.data) {
          setCurrencies(cached.data.currencies || []);
          setExchangeRates(cached.data.exchangeRates || []);
          setCurrencySummary(cached.data.currencySummary || null);
          setMessage(t("syncQueuedOffline") || "Showing offline currency cache", "success");
          setCurrencyLoading(false);
          return;
        }
      }
      setCurrencies((prev) => (prev?.length ? prev : []));
      setExchangeRates((prev) => (prev?.length ? prev : []));
      setCurrencySummary((prev) => prev || null);
      setMessage(err.message || "Currency data load failed", "error");
    } finally {
      setCurrencyLoading(false);
    }
  }

  async function loadFamilyGovernance(overrideFamilyId) {
    const fid = String(overrideFamilyId || activeFamilyId || "").trim();
    if (!fid) return;
    if (!token && !(cloudOnlyMode && firebaseUser?.uid)) return;

    setGovernanceLoading(true);

    try {
      let data;
      if (cloudOnlyMode && !token) {
        const hit = await cloudApiGet({
          familyId: fid,
          path: `/families/${fid}/members`,
          currentUser: cloudApiUser(),
        });
        data = hit.handled ? hit.data : [];
      } else {
        data = await apiGet(`/families/${fid}/members`);
      }
      let members = Array.isArray(data) ? data : data.members || [];

      // Merge live Firestore member registry (multi-account)
      if (cloudOnlyMode && firebaseUser?.uid) {
        try {
          const { listFamilyCloudMembers } = await import("./firebase/familyCloud");
          const cloudMembers = await listFamilyCloudMembers(fid);
          if (cloudMembers.length) {
            const byEmail = new Map();
            for (const m of members) {
              byEmail.set(String(m.email || m.uid || m.id).toLowerCase(), m);
            }
            for (const cm of cloudMembers) {
              const key = String(cm.email || cm.uid || cm.id).toLowerCase();
              const overrides = Array.isArray(cm.overrides)
                ? cm.overrides
                : Array.isArray(cm.permission_overrides)
                  ? cm.permission_overrides
                  : [];
              if (!byEmail.has(key)) {
                members.push({
                  id: cm.uid || cm.id,
                  member_id: cm.uid || cm.id,
                  user_id: cm.uid || cm.id,
                  uid: cm.uid || cm.id,
                  full_name: cm.display_name || cm.email || "Member",
                  email: cm.email || "",
                  role: cm.role || "MEMBER",
                  relationship: cm.relationship || cm.relationship_type || "",
                  relationship_type: cm.relationship_type || cm.relationship || "",
                  status: cm.status || "ACTIVE",
                  overrides,
                  source: "firestore_members",
                });
              } else {
                const existing = byEmail.get(key);
                // Firestore role is source of truth — never keep a higher local role after demotion
                const cloudRole = String(cm.role || "").toUpperCase();
                if (cloudRole) existing.role = cloudRole;
                existing.normalized_role = cloudRole || existing.normalized_role || existing.role;
                existing.full_name = cm.display_name || existing.full_name;
                existing.uid = cm.uid || cm.id || existing.uid;
                existing.user_id = cm.uid || cm.id || existing.user_id;
                existing.member_id = cm.uid || cm.id || existing.member_id || existing.id;
                existing.id = existing.member_id || existing.id;
                const cloudRelation = String(
                  cm.relationship_display_label || cm.relationship || cm.relationship_type || "",
                ).trim();
                if (cloudRelation) {
                  existing.relationship = cloudRelation;
                  existing.relationship_type = cloudRelation;
                  existing.relationship_display_label = cloudRelation;
                }
                if (overrides.length) existing.overrides = overrides;
                existing.source = existing.source || "merged";
              }
            }
          }
        } catch {
          /* offline / rules not published yet */
        }
      }

      setGovernanceMembers(members);
      try {
        let pending;
        if (cloudOnlyMode && !token) {
          const hit = await cloudApiGet({
            familyId: fid,
            path: `/join-requests/family/${fid}`,
            currentUser: cloudApiUser(),
          });
          pending = hit.handled ? hit.data : [];
        } else {
          pending = await apiGet(`/join-requests/family/${fid}`);
        }
        setJoinRequests(Array.isArray(pending) ? pending : pending?.requests || []);
      } catch {
        setJoinRequests([]);
      }
    } catch (err) {
      // Keep last known members so the panel does not blank / flicker while refreshing
      setMessage(err.message || "Family governance load failed", "error");
    } finally {
      setGovernanceLoading(false);
    }
  }

  async function decideJoinRequest(requestId, action) {
    try {
      await apiPost(`/join-requests/${requestId}/decision`, { decision: action, action, note: null, reason: null });
      setMessage(action === "APPROVE" ? t("joinApproved") || "Join approved" : t("joinRejected") || "Join rejected", "success");
      await loadFamilyGovernance();
      await refreshAll();
    } catch (err) {
      setMessage(err.message || "Join decision failed", "error");
      throw err;
    }
  }

  async function submitLoggedInJoin(joinForm) {
    if (!joinForm?.invite_code?.trim()) {
      setMessage(t("inviteCodeRequired") || "Invite code required", "error");
      throw new Error(t("inviteCodeRequired") || "Invite code required");
    }
    try {
      const code = joinForm.invite_code.trim().toUpperCase();
      if ((cloudOnlyMode || isCloudLocalMode()) && !token && firebaseUser?.uid) {
        const result = await joinFamilyByInviteCode({
          code,
          uid: firebaseUser.uid,
          email: firebaseUser.email || currentUser?.email || "",
          displayName: currentUser?.full_name || firebaseUser.displayName || "Member",
          relationshipType: joinForm.relationship_type || "Other",
        });
        const nextFamilyId = result.familyId;
        await activateCloudSession(firebaseUser, nextFamilyId, "", { role: "MEMBER" });
        setMessage(t("joinFamilySuccess") || t("joinRequestedOk") || "Joined family successfully", "success");
        try {
          await loadFamilyGovernance(nextFamilyId);
        } catch {
          /* optional */
        }
        window.setTimeout(() => {
          void refreshAll();
        }, 0);
        return { ok: true, familyId: nextFamilyId };
      }

      const body = {
        invite_code: code,
        relationship_type: joinForm.relationship_type || "Other",
      };
      if (joinForm.serial_label) body.serial_label = joinForm.serial_label;
      if (joinForm.relationship_serial != null && joinForm.relationship_serial !== "") {
        body.relationship_serial = joinForm.relationship_serial;
      }
      if (joinForm.linked_member_id) body.linked_member_id = joinForm.linked_member_id;
      if (joinForm.relationship_note) body.relationship_note = joinForm.relationship_note;
      const data = await apiPost("/invites/join", body);
      if (data?.family_id || data?.familyId) {
        const nextFamilyId = data.family_id || data.familyId;
        selectActiveFamily(nextFamilyId);
        await loadFamilyGovernance(nextFamilyId);
      }
      setMessage(t("joinRequestedOk") || "Join request sent", "success");
      await refreshAll();
      return { ok: true };
    } catch (err) {
      setMessage(err.message || "Join failed", "error");
      throw err;
    }
  }

  async function generateFamilyInvite() {
    const expiresInDays = Number(inviteForm.expires_in_days || 7);
    const maxUses = Number(inviteForm.max_uses || 1);

    if (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 30) {
      setMessage(t("inviteExpiryRange"), "error");
      return;
    }

    if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 100) {
      setMessage(t("inviteMaxUsesRange"), "error");
      return;
    }

    setInviteGenerating(true);

    try {
      const data = await apiPost(`/invites/generate/${activeFamilyId}`, {
        expires_in_days: expiresInDays,
        max_uses: maxUses,
        invitee_email: (inviteForm.invitee_email || "").trim() || null,
        send_email: Boolean(inviteForm.send_email),
        owner_uid: firebaseUser?.uid || currentUser?.firebase_uid || currentUser?.uid || null,
      });

      const code = String(data?.invite_code || data?.code || "").trim();
      if (!code || data?.cloud_published === false) {
        setGeneratedInvite(null);
        setInviteSpotlightOpen(false);
        setMessage(
          `${t("inviteLocalOnlyWarn")}${data?.cloud_publish_error ? ` (${data.cloud_publish_error})` : ""}`,
          "warning",
        );
        return;
      }

      const inviteRow = {
        ...data,
        invite_code: code,
        code,
      };
      setGeneratedInvite(inviteRow);
      setFamilyPanelTab("invite");
      setInviteSpotlightOpen(true);
      setActiveMenu("family");
      try {
        localStorage.setItem(
          `s4_last_invite_${activeFamilyId}`,
          JSON.stringify({ ...inviteRow, saved_at: Date.now() }),
        );
      } catch {
        /* ignore */
      }
      setToast({
        message:
          appLanguage === "bn"
            ? `আমন্ত্রণ কোড: ${code} — নিচের বড় বক্স থেকে কপি করুন`
            : `Invite code: ${code} — copy from the big box`,
        type: "success",
      });
      window.setTimeout(() => setToast(null), 12000);
      try {
        await loadNotifications();
      } catch {
        /* optional — spotlight already shows the code */
      }
    } catch (err) {
      setGeneratedInvite(null);
      setInviteSpotlightOpen(false);
      const raw = String(err?.message || "");
      const tip =
        /permission-denied|OWNER shell|invite publish|membership/i.test(raw)
          ? (appLanguage === "bn"
              ? "Invite Firebase-এ সেভ হয়নি — এই কোড শেয়ার করবেন না। ইন্টারনেট চেক করে আবার Generate চাপুন। সফল হলে বড় বক্সে কোড আসবে।"
              : "Invite was not saved to Firebase — do not share. Check internet and Generate again. On success the code appears in the big box.")
          : raw || "Invite generation failed";
      setMessage(tip, "error");
    } finally {
      setInviteGenerating(false);
    }
  }

  async function copySpotlightInviteCode() {
    const code = String(generatedInvite?.invite_code || generatedInvite?.code || "").trim();
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setInviteCodeCopied(true);
      window.setTimeout(() => setInviteCodeCopied(false), 1600);
    } catch {
      setInviteCodeCopied(false);
    }
  }

  async function inviteFamilyByEmail() {
    if (isCloudLocalMode()) {
      setMessage(
        t("inviteShareCodeHint") ||
          "Cloud mode does not send email — generate a code and share it manually.",
        "info",
      );
      return generateFamilyInvite();
    }
    const email = (inviteForm.invitee_email || "").trim();
    if (!email.includes("@")) {
      setMessage("Valid email required", "error");
      return;
    }
    setInviteGenerating(true);
    try {
      const data = await apiPost(`/invites/email/${activeFamilyId}`, {
        invitee_email: email,
        expires_in_days: Number(inviteForm.expires_in_days || 7),
        max_uses: Number(inviteForm.max_uses || 1),
      });
      setGeneratedInvite(data);
      const hint = data.email_sent
        ? "Email sent"
        : `Invite ready — share code manually (${data.email_reason || "SMTP off"})`;
      setMessage(hint, data.email_sent ? "success" : "info");
    } catch (err) {
      setMessage(err.message || "Email invite failed", "error");
    } finally {
      setInviteGenerating(false);
    }
  }

  async function inviteFamilyByLink() {
    setInviteGenerating(true);
    try {
      const data = await apiPost(`/invites/link/${activeFamilyId}`, {
        expires_in_days: Number(inviteForm.expires_in_days || 7),
        max_uses: Number(inviteForm.max_uses || 5),
        invitee_email: (inviteForm.invitee_email || "").trim() || null,
      });
      setGeneratedInvite(data);
      setMessage(data.invite_link ? `Link: ${data.invite_link}` : t("inviteGenerated"), "success");
    } catch (err) {
      setMessage(err.message || "Link invite failed", "error");
    } finally {
      setInviteGenerating(false);
    }
  }

  async function revokeFamilyInvite(inviteId) {
    if (!inviteId) return;
    if (!token && !isCloudLocalMode()) return;
    setInviteRevoking(true);
    try {
      await apiPost(`/invites/${inviteId}/revoke`, {});
      setGeneratedInvite(null);
      setInviteSpotlightOpen(false);
      setMessage(t("inviteRevoked") || "Invite revoked", "success");
    } catch (err) {
      setMessage(err.message || "Invite revoke failed", "error");
    } finally {
      setInviteRevoking(false);
    }
  }

  async function loadBackups() {
    if (!activeFamilyId) return;
    if (!token && !isCloudLocalMode()) return;

    setBackupLoading(true);

    try {
      const [integrity, list] = await Promise.all([
        apiGet("/backup/integrity"),
        apiGet(`/backup/list/${activeFamilyId}`),
      ]);

      setBackupIntegrity(integrity);
      setBackupList({
        count: list.count || 0,
        backups: list.backups || [],
      });
      await saveOfflineSnapshot(activeFamilyId, "system", "backup", {
        integrity,
        list: { count: list.count || 0, backups: list.backups || [] },
        files: (await loadOfflineSnapshot(activeFamilyId, "system", "backup").catch(() => null))?.data?.files || {},
      }).catch(() => {});
    } catch (err) {
      const msg = String(err?.message || "");
      if (/failed to fetch|network|offline/i.test(msg) || !isBrowserOnline() || isCloudLocalMode()) {
        const cached = await loadOfflineSnapshot(activeFamilyId, "system", "backup").catch(() => null);
        if (cached?.data) {
          setBackupIntegrity(cached.data.integrity || { ok: true, integrity_check: "IndexedDB OK" });
          setBackupList(cached.data.list || { count: 0, backups: [] });
          setMessage(t("syncQueuedOffline") || "Showing offline backup cache", "success");
          setBackupLoading(false);
          return;
        }
      }
      setBackupIntegrity((prev) => prev || null);
      setBackupList((prev) => prev?.backups?.length ? prev : { count: 0, backups: [] });
      if (!err?.isPermission) {
        setMessage(err.message || "Backup status load failed", "error");
      }
    } finally {
      setBackupLoading(false);
    }
  }

  async function createBackup() {
    if (!activeFamilyId) {
      setMessage(t("activeFamilyRequired"), "error");
      return;
    }

    setBackupCreating(true);

    try {
      if (isCloudLocalMode()) {
        const { blob, fileName, payload } = await buildBackupBlob(activeFamilyId, SYNC_DEVICE_ID);
        const prev = await loadOfflineSnapshot(activeFamilyId, "system", "backup").catch(() => null);
        const bag = prev?.data && typeof prev.data === "object" ? prev.data : { list: { backups: [] }, files: {} };
        const entry = {
          file_name: fileName,
          size_bytes: blob.size,
          created_at: new Date().toISOString(),
          row_count: Array.isArray(payload?.rows) ? payload.rows.length : 0,
          source: "cloud_local",
        };
        const backups = [entry, ...(bag.list?.backups || []).filter((b) => b.file_name !== fileName)].slice(0, 20);
        const files = { ...(bag.files || {}), [fileName]: payload };
        // Cap stored payloads to last 5 to avoid IndexedDB bloat
        const keep = new Set(backups.slice(0, 5).map((b) => b.file_name));
        for (const key of Object.keys(files)) {
          if (!keep.has(key)) delete files[key];
        }
        const integrity = { ok: true, integrity_check: "IndexedDB snapshot export OK", source: "cloud_local" };
        const list = { count: backups.length, backups };
        await saveOfflineSnapshot(activeFamilyId, "system", "backup", { integrity, list, files });
        setBackupIntegrity(integrity);
        setBackupList(list);
        await downloadBackupFile(blob, fileName);
        setMessage(t("backupCreatedFile").replace("{file}", fileName), "success");
        return;
      }

      const data = await apiPost(`/backup/create/${activeFamilyId}`, {});
      setMessage(t("backupCreatedFile").replace("{file}", data.backup_file), "success");
      await loadBackups();
    } catch (err) {
      setMessage(err.message || "Backup create failed", "error");
    } finally {
      setBackupCreating(false);
    }
  }

  async function downloadBackup(fileName) {
    try {
      if (isCloudLocalMode()) {
        const cached = await loadOfflineSnapshot(activeFamilyId, "system", "backup").catch(() => null);
        const payload = cached?.data?.files?.[fileName];
        if (payload) {
          const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
          await downloadBackupFile(blob, fileName);
          setMessage(t("backupDownloadStarted"), "success");
          return;
        }
        // Fallback: fresh export under the requested name
        const { blob } = await buildBackupBlob(activeFamilyId, SYNC_DEVICE_ID);
        await downloadBackupFile(blob, fileName);
        setMessage(t("backupDownloadStarted"), "success");
        return;
      }

      const res = await fetch(
        `${apiBase}/backup/download/${activeFamilyId}/${encodeURIComponent(fileName)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (!res.ok) {
        setMessage(t("backupDownloadFailed"), "error");
        return;
      }

      const blob = await res.blob();
      const fileUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");

      a.href = fileUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();

      window.URL.revokeObjectURL(fileUrl);
      setMessage(t("backupDownloadStarted"), "success");
    } catch {
      setMessage(t("backupDownloadFailed"), "error");
    }
  }

  async function previewRestore(fileName) {
    setBackupPreviewingFile(fileName);

    try {
      if (isCloudLocalMode()) {
        // Cloud-local backups are client-side JSON snapshots (see buildBackupBlob),
        // never uploaded to the backend's /backup/create store, so the backend's
        // preview-file endpoint can never find them (filename format doesn't even
        // match what backup.py expects). Preview from the local cache instead.
        const cached = await loadOfflineSnapshot(activeFamilyId, "system", "backup").catch(() => null);
        const payload = cached?.data?.files?.[fileName];
        if (!payload) {
          throw new Error("Restore preview failed");
        }
        setBackupPreview({
          file_name: fileName,
          restore_safe: true,
          backup_kind: "cloud_local",
          message: `Local snapshot exported at ${payload.exported_at || "unknown time"}.`,
          contains_files: [`${Array.isArray(payload.rows) ? payload.rows.length : 0} rows`],
        });
        setMessage(t("restorePreviewLoaded"), "success");
        return;
      }
      const data = await apiGet(
        `/backup/restore/preview-file/${activeFamilyId}?file_name=${encodeURIComponent(fileName)}`
      );
      setBackupPreview(data);
      setMessage(t("restorePreviewLoaded"), "success");
    } catch (err) {
      setBackupPreview(null);
      setMessage(err.message || "Restore preview failed", "error");
    } finally {
      setBackupPreviewingFile("");
    }
  }

  async function refreshLocalOutboxCount() {
    if (!activeFamilyId) {
      setLocalOutboxPending(0);
      setGroceryPendingRows([]);
      return;
    }
    try {
      const pending = await listPendingOutbox(activeFamilyId);
      setLocalOutboxPending(pending.length);
      setGroceryPendingRows(
        pending.filter((row) => String(row.entity_type || "").toLowerCase().includes("grocery"))
      );
    } catch {
      setLocalOutboxPending(0);
      setGroceryPendingRows([]);
    }
  }

  async function loadSyncStatus() {
    if (!activeFamilyId) return;
    if (!token && !isCloudLocalMode()) return;

    setSyncLoading(true);

    try {
      if (isCloudLocalMode()) {
        const pending = await listPendingOutbox(activeFamilyId).catch(() => []);
        const cache = await hydrateFamilyFromOfflineCache(activeFamilyId);
        const statusData = await apiGet(
          `/families/${activeFamilyId}/sync/status?device_id=${encodeURIComponent(SYNC_DEVICE_ID)}&device_name=Web%20Dashboard&platform=web`
        );
        setSyncStatus({
          ...(statusData || {}),
          pending_outbox: pending.length,
          open_conflicts: 0,
          offline_first: true,
          sync_state: browserOnline ? "CLOUD_LOCAL_READY" : "OFFLINE",
          last_sync_at: firebaseMeta?.updated_at || firebaseMeta?.pushed_at || lastAutoSyncAt || null,
          table_counts: {
            ...(statusData?.table_counts || {}),
            wallets: Array.isArray(cache["finance/wallets"]) ? cache["finance/wallets"].length : 0,
            transactions: Array.isArray(cache["finance/transactions"]) ? cache["finance/transactions"].length : 0,
          },
          source: "cloud_local",
        });
        setSyncConflicts([]);
        setSyncResolvedConflicts([]);
        await refreshLocalOutboxCount();
        return;
      }

      const [statusData, conflictsData, resolvedData] = await Promise.all([
        apiGet(
          `/families/${activeFamilyId}/sync/status?device_id=${encodeURIComponent(SYNC_DEVICE_ID)}&device_name=Web%20Dashboard&platform=web`
        ),
        apiGet(`/families/${activeFamilyId}/sync/conflicts?status=OPEN&limit=25`),
        apiGet(`/families/${activeFamilyId}/sync/conflicts?status=RESOLVED&limit=25`),
      ]);

      setSyncStatus(statusData);
      setSyncConflicts(conflictsData.conflicts || []);
      setSyncResolvedConflicts(resolvedData.conflicts || []);
      await refreshLocalOutboxCount();
    } catch (err) {
      setSyncStatus((prev) => prev || null);
      setSyncConflicts((prev) => (prev?.length ? prev : []));
      setSyncResolvedConflicts((prev) => (prev?.length ? prev : []));
      setMessage(err.message || "Sync status load failed", "error");
    } finally {
      setSyncLoading(false);
    }
  }

  async function loadSyncLogs() {
    if (!activeFamilyId) return;
    if (!token && !isCloudLocalMode()) return;
    setSyncLogsLoading(true);
    try {
      setSyncLogs(
        await apiGet(`/sync-logs?family_id=${encodeURIComponent(activeFamilyId)}&limit=80`),
      );
    } catch (err) {
      setSyncLogs((prev) => prev || null);
      setMessage(err.message || "Sync logs load failed", "error");
    } finally {
      setSyncLogsLoading(false);
    }
  }

  async function resolveSyncConflict(conflict, strategy) {
    if (!token || !activeFamilyId || !conflict?.id) return;

    setSyncResolveLoadingId(conflict.id);
    try {
      let resolution_payload = { strategy, device_id: SYNC_DEVICE_ID };
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

      await apiPost(`/families/${activeFamilyId}/sync/conflicts/${conflict.id}/resolve`, resolution_payload);
      setMessage(t("conflictResolvedStrategy").replace("{strategy}", strategy), "success");
      await loadSyncStatus();
      await loadGrocery({ silent: true });
      await loadWallets();
    } catch (err) {
      setMessage(err.message || "Conflict resolve failed", "error");
    } finally {
      setSyncResolveLoadingId("");
    }
  }

  async function pushLocalSyncOutbox(options = {}) {
    const silent = Boolean(options.silent);
    const isAutomatic = Boolean(options.automatic);
    if (!activeFamilyId) return;
    if (!isBrowserOnline()) {
      if (!silent) setMessage(t("syncQueuedOffline"), "error");
      return;
    }

    // Hybrid cloud-only: flush outbox by pushing Firestore snapshot (no PC backend).
    if (isCloudLocalMode()) {
      if (!firebaseUser?.uid || !isCloudEmailReady(firebaseUser)) return;
      if (!silent) setSyncPushLoading(true);
      try {
        // Recover grocery rows that were enqueue-only (never written to IndexedDB).
        const pending = await listPendingOutbox(activeFamilyId);
        for (const row of pending) {
          const et = String(row.entity_type || "").toLowerCase();
          const op = String(row.operation || "").toUpperCase();
          const payload = row.payload || {};
          try {
            if (et.includes("grocery_list") && op === "CREATE") {
              await apiPost("/grocery/lists", payload);
            } else if (et.includes("grocery_vendor") && op === "CREATE") {
              await apiPost("/grocery/vendors", payload);
            } else if (et.includes("grocery_item") && op === "CREATE") {
              await apiPost("/grocery/items", payload);
            } else if (et.includes("grocery_item") && (op === "UPDATE" || op === "BUY")) {
              const id = row.entity_id || payload.id;
              if (id) {
                await apiPut(`/grocery/items/${id}/buy`, { ...payload, is_bought: true });
              }
            }
          } catch {
            // Keep outbox row; snapshot push still proceeds with current IDB.
          }
        }
        const result = await flushCloudSnapshotOutbox({
          familyId: activeFamilyId,
          uid: firebaseUser.uid,
          pushSnapshot: pushCloudSnapshot,
          deviceLabel: SYNC_DEVICE_ID || "mobile",
        });
        if (isAutomatic) setLastAutoSyncAt(new Date().toISOString());
        await refreshLocalOutboxCount();
        await refreshFirebaseMeta(firebaseUser.uid);
        await loadGrocery({ silent: true });
        if (!silent) {
          if (result.offline) setMessage(t("browserOffline"), "error");
          else if (result.empty || result.pushed === 0) setMessage(t("noSyncStatus"), "success");
          else setMessage(t("syncPushDone"), "success");
        }
      } catch (err) {
        if (!silent) setMessage(err.message || "Sync push failed", "error");
      } finally {
        if (!silent) setSyncPushLoading(false);
      }
      return;
    }

    if (!token) return;
    if (!silent) setSyncPushLoading(true);
    try {
      const result = await flushLocalOutbox({
        familyId: activeFamilyId,
        deviceId: SYNC_DEVICE_ID,
        apiPost,
      });
      if (isAutomatic) {
        setLastAutoSyncAt(new Date().toISOString());
      }
      if (!silent) {
        if (result.offline) {
          setMessage(t("browserOffline"), "error");
        } else if (result.empty || result.pushed === 0) {
          setMessage(t("noSyncStatus"), "success");
        } else {
          setMessage(t("syncPushDone"), "success");
        }
      }
      await loadSyncStatus();
      await loadGrocery({ silent: true });
    } catch (err) {
      if (!silent) setMessage(err.message || "Sync push failed", "error");
    } finally {
      if (!silent) setSyncPushLoading(false);
    }
  }

  function toggleAutoSync() {
    setAutoSyncEnabled((prev) => {
      const next = !prev;
      persistAutoSyncEnabled(next);
      return next;
    });
  }

  async function pullSyncPreview() {
    if (!activeFamilyId) return;
    if (!token && !isCloudLocalMode()) return;

    setSyncPullLoading(true);

    try {
      if (isCloudLocalMode()) {
        const result = await pullAndHydrateCloudLocal();
        setSyncPullPreview({
          changes: [],
          restored: result?.restored || 0,
          sync_token: new Date().toISOString(),
          note: "Cloud snapshot pulled into IndexedDB",
          source: "cloud_local",
        });
        setMessage(t("syncPullPreviewLoaded"), "success");
        await loadSyncStatus();
        return;
      }

      const tokenQuery = syncLastToken ? `&since_token=${encodeURIComponent(syncLastToken)}` : "";
      const data = await apiGet(
        `/families/${activeFamilyId}/sync/pull?device_id=${encodeURIComponent(SYNC_DEVICE_ID)}&limit=100${tokenQuery}`
      );
      setSyncPullPreview(data);
      if (data?.sync_token) setSyncLastToken(data.sync_token);
      mergePullIntoGroceryState(data?.changes, {
        setGroceryLists,
        setGroceryVendors,
        setGroceryItems,
        setWallets,
        setBudgets,
        setSavings,
        setLoans,
        setTransactions,
        setGoals,
        setRecurringItems,
      });
      setMessage(t("syncPullPreviewLoaded"), "success");
      await loadSyncStatus();
      await loadGrocery({ silent: true });
    } catch (err) {
      setSyncPullPreview(null);
      setMessage(err.message || "Sync pull failed", "error");
    } finally {
      setSyncPullLoading(false);
    }
  }

  async function refreshAll() {
    if (!activeFamilyId) return;
    if (!token && !isCloudLocalMode()) return;

    await loadDashboard();
    await loadWallets();
    await loadCategories();
    await loadTransactions();
    await loadSavings();
    await loadLoans();
    await loadBudgets();
    await loadRecurring();
    await loadGoals();
    await loadFamilyGovernance();
    await loadReports();
    await loadCurrencyData();
    await loadAuditTrail();
    await loadNotifications();
    await loadZakat();
    await loadPhase15();
    await loadPhase16();
    await loadGrocery();
    await loadBackups();
    await loadSettingsData();
  }

  async function createWallet() {
    if (!walletForm.name.trim() || walletForm.name.trim().length < 2) {
      setMessage(t("walletNameRequired"), "error");
      return;
    }

    const payload = {
      family_id: activeFamilyId,
      name: walletForm.name.trim(),
      account_type: walletForm.account_type,
      currency: currencyCode(),
      opening_balance: walletForm.opening_balance,
      is_shared_family: Boolean(walletForm.is_shared_family),
      is_owner_wallet: Boolean(walletForm.is_owner_wallet),
      client_request_id: `web-wallet-${Date.now()}`,
    };

    try {
      setStatus("Creating wallet...");
      setWalletBusyId("create");

      if (isCloudLocalMode()) {
        const cached = await loadOfflineSnapshot(activeFamilyId, "finance", "wallets").catch(() => null);
        const existing = Array.isArray(cached?.data) ? cached.data : wallets;
        const newWallet = {
          id: `wal_${Date.now()}`,
          family_id: activeFamilyId,
          name: payload.name,
          account_type: payload.account_type,
          currency: payload.currency,
          balance: Number(payload.opening_balance) || 0,
          current_balance: Number(payload.opening_balance) || 0,
          opening_balance: Number(payload.opening_balance) || 0,
          is_shared_family: payload.is_shared_family,
          is_owner_wallet: payload.is_owner_wallet,
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          source: "cloud_local",
        };
        const next = [...existing.filter((w) => String(w.id) !== String(newWallet.id)), newWallet];
        setWallets(activeWalletRows(next));
        await saveOfflineSnapshot(activeFamilyId, "finance", "wallets", next);
        bindActiveWalletForms(activeWalletRows(next));
        setDashboard(buildDashboardFromCache(await hydrateFamilyFromOfflineCache(activeFamilyId)));
        if (token) {
          await enqueueOutboxChange({
            familyId: activeFamilyId,
            entity_type: "accounts",
            operation: "CREATE",
            payload: { ...payload, id: newWallet.id },
          });
          await refreshLocalOutboxCount();
        }
        if (isBrowserOnline()) {
          await syncCloudAfterWrite();
          setMessage(t("walletCreated"), "success");
        } else {
          await runCloudAutoBackup({ force: true });
          setMessage(t("walletCreatedOffline"), "success");
        }
        setWalletForm(emptyWalletForm());
        setEditingWalletId("");
        return;
      }

      if (!isBrowserOnline()) {
        await enqueueOutboxChange({
          familyId: activeFamilyId,
          entity_type: "accounts",
          operation: "CREATE",
          payload,
        });
        setWalletForm(emptyWalletForm());
        setMessage(t("syncQueuedOffline"), "success");
        await refreshLocalOutboxCount();
        return;
      }

      await apiPost(`/accounts`, payload);
      setWalletForm(emptyWalletForm());
      setEditingWalletId("");
      setMessage(t("walletCreated"), "success");
      refreshAll();
    } catch (err) {
      const msg = String(err.message || "");
      if (/failed to fetch|network|offline/i.test(msg)) {
        await enqueueOutboxChange({
          familyId: activeFamilyId,
          entity_type: "accounts",
          operation: "CREATE",
          payload,
        });
        setWalletForm(emptyWalletForm());
        setMessage(t("syncQueuedOffline"), "success");
        await refreshLocalOutboxCount();
      } else {
        setMessage(err.message || t("walletLoadFailed"), "error");
      }
    } finally {
      setWalletBusyId("");
      setStatus("");
    }
  }

  function startEditWallet(wallet) {
    if (!wallet?.id) return;
    setEditingWalletId(wallet.id);
    setWalletForm({
      name: wallet.name || "",
      account_type: wallet.account_type || "CASH",
      currency: wallet.currency || currencyCode(),
      opening_balance: String(wallet.opening_balance ?? wallet.balance ?? 0),
      is_shared_family: wallet.is_shared_family !== false,
      is_owner_wallet: Boolean(wallet.is_owner_wallet),
    });
  }

  function cancelEditWallet() {
    setEditingWalletId("");
    setWalletForm(emptyWalletForm());
  }

  async function saveEditWallet() {
    if (!editingWalletId) return;
    const trimmedName = walletForm.name.trim();
    if (!trimmedName || trimmedName.length < 2) {
      setMessage(t("walletNameRequired"), "error");
      return;
    }
    if (!String(walletForm.account_type || "").trim()) {
      setMessage(t("walletTypeRequired"), "error");
      return;
    }
    const patch = {
      name: trimmedName,
      account_type: walletForm.account_type,
      is_shared_family: Boolean(walletForm.is_shared_family),
      is_owner_wallet: Boolean(walletForm.is_owner_wallet),
      updated_at: new Date().toISOString(),
    };
    try {
      setWalletBusyId(editingWalletId);
      if (isCloudLocalMode()) {
        const cached = await loadOfflineSnapshot(activeFamilyId, "finance", "wallets").catch(() => null);
        const existing = Array.isArray(cached?.data) ? cached.data : wallets;
        const next = existing.map((w) =>
          String(w.id) === String(editingWalletId) ? { ...w, ...patch } : w,
        );
        setWallets(activeWalletRows(next));
        await saveOfflineSnapshot(activeFamilyId, "finance", "wallets", next);
        setDashboard(buildDashboardFromCache(await hydrateFamilyFromOfflineCache(activeFamilyId)));
        if (token) {
          await enqueueOutboxChange({
            familyId: activeFamilyId,
            entity_type: "accounts",
            operation: "UPDATE",
            payload: { ...patch, id: editingWalletId },
          });
          await refreshLocalOutboxCount();
        }
        if (isBrowserOnline() && canSyncCloudFinance(firebaseUser)) {
          await syncCloudAfterWrite();
        }
        setMessage(t("walletUpdated"), "success");
        cancelEditWallet();
        return;
      }

      if (!token) throw new Error(t("walletLoadFailed"));

      if (!isBrowserOnline()) {
        await enqueueOutboxChange({
          familyId: activeFamilyId,
          entity_type: "accounts",
          operation: "UPDATE",
          payload: { ...patch, id: editingWalletId },
        });
        await refreshLocalOutboxCount();
        setMessage(t("syncQueuedOffline"), "success");
        cancelEditWallet();
        return;
      }

      // Real backend call — no silent fallback. A failure here must surface
      // to the user, otherwise the UI shows "saved" while the server still
      // has the old value.
      await apiPatch(`/accounts/${editingWalletId}`, patch);
      setMessage(t("walletUpdated"), "success");
      cancelEditWallet();
      await loadWallets();
      await loadDashboard();
    } catch (err) {
      setMessage(err.message || t("walletLoadFailed"), "error");
    } finally {
      setWalletBusyId("");
    }
  }

  async function deleteWallet(wallet) {
    if (!wallet?.id) return;
    const label = wallet.name || wallet.id;
    if (!window.confirm(t("confirmDeleteWallet") || `Delete wallet "${label}"?`)) return;
    try {
      setWalletBusyId(wallet.id);
      if (isCloudLocalMode()) {
        const cached = await loadOfflineSnapshot(activeFamilyId, "finance", "wallets").catch(() => null);
        const existing = Array.isArray(cached?.data) ? cached.data : wallets;
        const now = new Date().toISOString();
        const next = existing.map((w) =>
          String(w.id) === String(wallet.id)
            ? { ...w, is_active: false, deleted_at: now, updated_at: now }
            : w,
        );
        setWallets(activeWalletRows(next));
        await saveOfflineSnapshot(activeFamilyId, "finance", "wallets", next);
        bindActiveWalletForms(activeWalletRows(next));
        setDashboard(buildDashboardFromCache(await hydrateFamilyFromOfflineCache(activeFamilyId)));
        if (editingWalletId && String(editingWalletId) === String(wallet.id)) {
          cancelEditWallet();
        }
        if (isBrowserOnline() && canSyncCloudFinance(firebaseUser)) {
          await syncCloudAfterWrite();
        }
        setMessage(t("walletDeleted"), "success");
        return;
      }
      if (!token) throw new Error(t("walletLoadFailed"));
      await apiDelete(`/accounts/${wallet.id}`);
      setMessage(t("walletDeleted"), "success");
      if (editingWalletId && String(editingWalletId) === String(wallet.id)) {
        cancelEditWallet();
      }
      await loadWallets();
      await loadDashboard();
    } catch (err) {
      setMessage(err.message || t("walletLoadFailed"), "error");
    } finally {
      setWalletBusyId("");
    }
  }

  async function createTransaction(attachFile = null) {
    if (!txForm.account_id) {
      setMessage(t("fromWalletRequired"), "error");
      return;
    }

    if (!isActiveWalletId(txForm.account_id)) {
      setMessage(t("fromWalletRequired") || "Select an active wallet", "error");
      bindActiveWalletForms(wallets);
      return;
    }

    if (!txForm.amount || Number(txForm.amount) <= 0) {
      setMessage(t("validAmountRequired"), "error");
      return;
    }

    if (txForm.type !== "transfer" && !txForm.category_id) {
      setMessage(t("selectCategory") || "Select a category", "error");
      return;
    }

    if (txForm.type === "transfer") {
      if (!txForm.to_account_id) {
        setMessage(t("toWalletRequired"), "error");
        return;
      }

      if (!isActiveWalletId(txForm.to_account_id)) {
        setMessage(t("toWalletRequired") || "Select an active destination wallet", "error");
        bindActiveWalletForms(wallets);
        return;
      }

      if (txForm.account_id === txForm.to_account_id) {
        setMessage(t("cannotTransferSameWallet"), "error");
        return;
      }
    }

    if (txForm.type === "expense" && txForm.split_enabled) {
      if (!txForm.split_member_a || !txForm.split_member_b) {
        setMessage(t("splitMembersRequired") || "Select both members for split expense", "error");
        return;
      }
      if (txForm.split_member_a === txForm.split_member_b) {
        setMessage(t("splitMembersDifferent") || "Split members must be different", "error");
        return;
      }
    }

    try {
      setStatus("Posting transaction...");

      if (isCloudLocalMode()) {
        const txCached = await loadOfflineSnapshot(activeFamilyId, "finance", "transactions").catch(() => null);
        const walCached = await loadOfflineSnapshot(activeFamilyId, "finance", "wallets").catch(() => null);
        const existingTx = Array.isArray(txCached?.data) ? txCached.data : transactions;
        const existingWallets = Array.isArray(walCached?.data) ? walCached.data : wallets;
        const isSplit = txForm.type === "expense" && Boolean(txForm.split_enabled);
        let createdRows = [];
        if (isSplit) {
          const total = Number(txForm.amount) || 0;
          const shareA = Math.round((total / 2) * 100) / 100;
          const shareB = Math.round((total - shareA) * 100) / 100;
          const base = buildLocalTransaction({
            familyId: activeFamilyId,
            txForm: { ...txForm, split_enabled: true, amount: shareA },
            currency: currencyCode(),
          });
          const groupId = base.id;
          const rowA = {
            ...base,
            id: `${groupId}_a`,
            amount: shareA,
            split_group_id: groupId,
            member_id: txForm.split_member_a,
            description: `${base.description || "Split"} (${txForm.split_member_a})`,
          };
          const rowB = {
            ...buildLocalTransaction({
              familyId: activeFamilyId,
              txForm: { ...txForm, split_enabled: true, amount: shareB },
              currency: currencyCode(),
            }),
            id: `${groupId}_b`,
            amount: shareB,
            split_group_id: groupId,
            member_id: txForm.split_member_b,
            description: `${base.description || "Split"} (${txForm.split_member_b})`,
          };
          createdRows = [rowA, rowB];
        } else {
          createdRows = [
            buildLocalTransaction({
              familyId: activeFamilyId,
              txForm,
              currency: currencyCode(),
            }),
          ];
        }
        const newTx = createdRows[0];
        const nextTx = sortTransactionsNewestFirst([...createdRows, ...existingTx]);
        const nextWallets = recomputeWalletBalancesFromLedger(existingWallets, nextTx);
        setTransactions(nextTx);
        setWallets(activeWalletRows(nextWallets));
        await saveOfflineSnapshot(activeFamilyId, "finance", "transactions", nextTx);
        await saveOfflineSnapshot(activeFamilyId, "finance", "wallets", nextWallets);
        if (attachFile) {
          try {
            const fd = new FormData();
            fd.append("family_id", activeFamilyId);
            fd.append("file", attachFile);
            const uploaded = await apiUpload(`/transactions/${newTx.id}/attachment`, fd);
            if (uploaded) {
              const withAtt = nextTx.map((row) =>
                String(row.id) === String(newTx.id)
                  ? {
                      ...row,
                      attachment_name: uploaded.file_name || attachFile.name,
                      attachment_url: uploaded.url || uploaded.download_url || null,
                    }
                  : row,
              );
              setTransactions(withAtt);
              await saveOfflineSnapshot(activeFamilyId, "finance", "transactions", withAtt);
            }
          } catch (attErr) {
            console.warn("[S4 Tx] attachment skipped", attErr);
          }
        }
        setDashboard(buildDashboardFromCache(await hydrateFamilyFromOfflineCache(activeFamilyId)));
        if (token) {
          await enqueueOutboxChange({
            familyId: activeFamilyId,
            entity_type: "transactions",
            operation: "CREATE",
            payload: {
              ...createdRows[0],
              client_request_id: createdRows[0]?.client_request_id || `web-tx-${Date.now()}`,
            },
          });
          await refreshLocalOutboxCount();
        }
        if (isBrowserOnline()) {
          await syncCloudAfterWrite();
          setMessage(t("transactionPosted"), "success");
        } else {
          await runCloudAutoBackup({ force: true });
          setMessage(t("transactionPostedOffline") || t("transactionPosted"), "success");
        }
        setTxForm((prev) => ({ ...prev, amount: "", description: "", split_enabled: false }));
        // Refresh budget spent totals from ledger
        try {
          await loadBudgets();
        } catch {
          /* ignore */
        }
        return;
      }

      const clientRequestId = `web-tx-${Date.now()}`;
      const txType = String(txForm.type || "").toUpperCase();
      let createdId = null;

      const offlinePayload = {
        transaction_type: txType === "TRANSFER" ? "TRANSFER" : txType,
        type: txType === "TRANSFER" ? "TRANSFER" : txType,
        account_id: txForm.account_id,
        from_account_id: txForm.account_id,
        to_account_id: txForm.to_account_id,
        category_id: txForm.category_id || null,
        amount: txForm.amount,
        currency: currencyCode(),
        description: txForm.description,
        client_request_id: clientRequestId,
      };

      if (!isBrowserOnline()) {
        await enqueueOutboxChange({
          familyId: activeFamilyId,
          entity_type: "transactions",
          operation: "CREATE",
          payload: offlinePayload,
        });
        setTxForm((prev) => ({ ...prev, amount: "", description: "", split_enabled: false }));
        setMessage(t("syncQueuedOffline"), "success");
        await refreshLocalOutboxCount();
        return;
      }

      if (txForm.type === "income") {
        const data = await apiPost(`/transactions/income`, {
          family_id: activeFamilyId,
          account_id: txForm.account_id,
          category_id: txForm.category_id || null,
          amount: txForm.amount,
          currency: currencyCode(),
          description: txForm.description,
          client_request_id: clientRequestId,
        });
        createdId = data?.id;
      }

      if (txForm.type === "expense") {
        if (txForm.split_enabled) {
          const amount = Number(txForm.amount);
          const half = (amount / 2).toFixed(4);
          const data = await apiPost(`/expenses/split`, {
            family_id: activeFamilyId,
            account_id: txForm.account_id,
            category_id: txForm.category_id || null,
            amount,
            currency: currencyCode(),
            description: txForm.description,
            client_request_id: clientRequestId,
            splits: [
              { member_id: txForm.split_member_a, share_amount: half },
              { member_id: txForm.split_member_b, share_amount: (amount - Number(half)).toFixed(4) },
            ],
          });
          createdId = data?.transaction_id || data?.id;
        } else {
          const data = await apiPost(`/transactions/expense`, {
            family_id: activeFamilyId,
            account_id: txForm.account_id,
            category_id: txForm.category_id || null,
            amount: txForm.amount,
            currency: currencyCode(),
            description: txForm.description,
            client_request_id: clientRequestId,
          });
          createdId = data?.id;
        }
      }

      if (txForm.type === "transfer") {
        const data = await apiPost(`/transactions/transfer`, {
          family_id: activeFamilyId,
          from_account_id: txForm.account_id,
          to_account_id: txForm.to_account_id,
          amount: txForm.amount,
          currency: currencyCode(),
          description: txForm.description,
          client_request_id: clientRequestId,
        });
        createdId = data?.id;
      }

      let attachmentFailed = false;
      if (attachFile && createdId && apiUpload) {
        try {
          const fd = new FormData();
          fd.append("family_id", activeFamilyId);
          fd.append("file", attachFile);
          await apiUpload(`/transactions/${createdId}/attachment`, fd);
        } catch (attErr) {
          // The transaction itself already posted successfully — an attachment
          // failure here must not be reported as a failed transaction, and
          // must not block the form reset (that would leave clientRequestId
          // stale and risk a duplicate post on retry).
          console.warn("[S4 Tx] attachment upload failed", attErr);
          attachmentFailed = true;
        }
      }

      setTxForm((prev) => ({
        ...prev,
        amount: "",
        description: "",
        split_enabled: false,
      }));

      if (attachmentFailed) {
        setMessage(t("transactionPostedAttachmentFailed") || t("transactionPosted"), "warning");
      } else {
        setMessage(t("transactionPosted"), "success");
      }
      refreshAll();
    } catch (err) {
      setMessage(err.message || t("transactionFailed") || "Transaction failed", "error");
    } finally {
      setStatus("");
    }
  }

  async function uploadTxAttachment(transactionId, file) {
    if (!transactionId || !file) return;
    try {
      setAttachBusyId(transactionId);
      const fd = new FormData();
      fd.append("family_id", activeFamilyId);
      fd.append("file", file);
      const uploaded = await apiUpload(`/transactions/${transactionId}/attachment`, fd);
      if (isCloudLocalMode()) {
        const cached = await loadOfflineSnapshot(activeFamilyId, "finance", "transactions").catch(() => null);
        const rows = Array.isArray(cached?.data) ? cached.data : transactions;
        const next = rows.map((row) =>
          String(row.id) === String(transactionId)
            ? {
                ...row,
                attachment_name: uploaded?.file_name || file.name,
                attachment_url: uploaded?.url || uploaded?.download_url || null,
                updated_at: new Date().toISOString(),
              }
            : row,
        );
        setTransactions(sortTransactionsNewestFirst(next));
        await saveOfflineSnapshot(activeFamilyId, "finance", "transactions", next);
        if (isBrowserOnline() && canSyncCloudFinance(firebaseUser)) {
          await syncCloudAfterWrite();
        }
      } else {
        await loadTransactions?.();
        refreshAll();
      }
      setMessage(t("attachmentUploaded") || "Attachment uploaded", "success");
    } catch (err) {
      setMessage(err.message || t("attachmentFailed") || "Attachment failed", "error");
    } finally {
      setAttachBusyId("");
    }
  }

  async function parseExpenseOcr(rawText) {
    if (isCloudLocalMode()) {
      const text = String(rawText || "");
      const nums = [...text.matchAll(/(\d+(?:\.\d{1,2})?)/g)].map((m) => Number(m[1])).filter((n) => n > 0);
      const total = nums.length ? nums.reduce((a, b) => a + b, 0) : 0;
      return {
        suggested_total: total || null,
        line_count: text.split(/\n/).filter(Boolean).length,
        engine: "cloud_local_regex",
        raw_text: text,
        lines: text
          .split(/\n/)
          .filter(Boolean)
          .slice(0, 8)
          .map((line) => ({ description: line.trim() })),
        note: "Cloud mode: simple total from numbers in text",
        source: "cloud_local",
      };
    }
    return apiPost(`/expenses/ocr/parse?family_id=${encodeURIComponent(activeFamilyId)}`, {
      raw_text: rawText || "",
    });
  }

  async function parseExpenseOcrImage(file) {
    if (!file) return null;
    if (isCloudLocalMode()) {
      const { extractTextFromImageFile, expenseParseFromOcrText } = await import("./lib/clientOcr");
      const rawText = await extractTextFromImageFile(file);
      if (!rawText) {
        return {
          suggested_total: null,
          line_count: 0,
          engine: "tesseract_client",
          note: t("ocrNoTextFound") || "No text found in image",
          source: "cloud_local_ocr",
        };
      }
      return expenseParseFromOcrText(rawText);
    }
    const fd = new FormData();
    fd.append("family_id", activeFamilyId);
    fd.append("file", file);
    return apiUpload(`/expenses/ocr/parse-image`, fd);
  }

  async function loadSavingsAnnualPlan() {
    try {
      if (isCloudLocalMode()) {
        const cached = await loadOfflineSnapshot(activeFamilyId, "finance", "savings").catch(() => null);
        const list = enrichSavingsGoals(normalizeSavingsList(cached?.data ?? savings));
        setSavingsAnnualPlan(buildSavingsAnnualPlan(list));
        return;
      }
      const data = await apiGet(`/savings/annual-plan/${activeFamilyId}`);
      setSavingsAnnualPlan(data);
    } catch (err) {
      setMessage(err.message || "Annual plan load failed", "error");
    }
  }

  async function voidTransaction(transactionId) {
    if (!transactionId || !activeFamilyId) return;
    const reason = window.prompt(t("voidReason") || "Void reason (optional)", "") ?? null;
    if (reason === null) return;
    const payload = {
      family_id: activeFamilyId,
      entity_id: transactionId,
      id: transactionId,
      reason: reason.trim() || "VOID",
    };
    try {
      setVoidBusyId(transactionId);
      if (isCloudLocalMode()) {
        const txCached = await loadOfflineSnapshot(activeFamilyId, "finance", "transactions").catch(() => null);
        const walCached = await loadOfflineSnapshot(activeFamilyId, "finance", "wallets").catch(() => null);
        const existingTx = Array.isArray(txCached?.data) ? txCached.data : transactions;
        const existingWallets = Array.isArray(walCached?.data) ? walCached.data : wallets;
        const target = existingTx.find((t) => String(t.id) === String(transactionId));
        if (!target) throw new Error(t("transactionLoadFailed") || "Transaction not found");
        if (String(target.status || "").toUpperCase() === "VOID") {
          setMessage(t("transactionAlreadyVoided") || "Already voided", "warning");
          return;
        }
        const now = new Date().toISOString();
        const nextTx = existingTx.map((t) =>
          String(t.id) === String(transactionId)
            ? {
                ...t,
                status: "VOID",
                void_reason: reason.trim() || "VOID",
                voided_at: now,
                updated_at: now,
              }
            : t,
        );
        const nextWallets = recomputeWalletBalancesFromLedger(existingWallets, nextTx);
        setTransactions(sortTransactionsNewestFirst(nextTx));
        setWallets(activeWalletRows(nextWallets));
        await saveOfflineSnapshot(activeFamilyId, "finance", "transactions", nextTx);
        await saveOfflineSnapshot(activeFamilyId, "finance", "wallets", nextWallets);
        if (target.savings_goal_id) {
          const savCached = await loadOfflineSnapshot(activeFamilyId, "finance", "savings").catch(() => null);
          const existingSav = normalizeSavingsList(savCached?.data ?? savings);
          const nextSav = recomputeSavingsFromLedger(existingSav, nextTx);
          setSavings(nextSav);
          await saveOfflineSnapshot(activeFamilyId, "finance", "savings", nextSav);
        }
        setDashboard(buildDashboardFromCache(await hydrateFamilyFromOfflineCache(activeFamilyId)));
        if (isBrowserOnline()) {
          await syncCloudAfterWrite();
        }
        setMessage(t("transactionVoided") || "Transaction voided", "success");
        try {
          await loadBudgets();
        } catch {
          /* ignore */
        }
        return;
      }
      if (!isBrowserOnline()) {
        await enqueueOutboxChange({
          familyId: activeFamilyId,
          entity_type: "transactions",
          entity_id: transactionId,
          operation: "DELETE",
          payload,
        });
        setMessage(t("syncQueuedOffline"), "success");
        await refreshLocalOutboxCount();
        return;
      }
      const qs = new URLSearchParams({ family_id: activeFamilyId });
      if (reason.trim()) qs.set("reason", reason.trim());
      await apiPost(`/transactions/${transactionId}/void?${qs.toString()}`, {});
      setMessage(t("transactionVoided") || "Transaction voided", "success");
      await loadTransactions();
      await refreshAll();
    } catch (err) {
      const msg = String(err.message || "");
      if (/failed to fetch|network|offline/i.test(msg)) {
        await enqueueOutboxChange({
          familyId: activeFamilyId,
          entity_type: "transactions",
          entity_id: transactionId,
          operation: "DELETE",
          payload,
        });
        setMessage(t("syncQueuedOffline"), "success");
        await refreshLocalOutboxCount();
        return;
      }
      setMessage(err.message || t("voidFailed") || "Void failed", "error");
    } finally {
      setVoidBusyId("");
    }
  }

  async function createSavingsGoal() {
    if (savingsBusyId) return false;
    if (!savingsForm.wallet_account_id || !isActiveWalletId(savingsForm.wallet_account_id)) {
      setMessage(t("walletRequired"), "error");
      return false;
    }

    if (!savingsForm.name.trim() || savingsForm.name.trim().length < 2) {
      setMessage(t("savingsNameRequired"), "error");
      return false;
    }

    if (!savingsForm.target_amount || Number(savingsForm.target_amount) <= 0) {
      setMessage(t("validTargetAmountRequired"), "error");
      return false;
    }

    const payload = {
      family_id: activeFamilyId,
      wallet_account_id: savingsForm.wallet_account_id,
      name: savingsForm.name.trim(),
      goal_type: savingsForm.goal_type,
      target_amount: savingsForm.target_amount,
      currency: currencyCode(),
      note: savingsForm.note,
      client_request_id: `web-sav-${Date.now()}`,
    };

    try {
      setSavingsBusyId("create");
      if (isCloudLocalMode()) {
        const cached = await loadOfflineSnapshot(activeFamilyId, "finance", "savings").catch(() => null);
        const existing = normalizeSavingsList(cached?.data ?? savings);
        const row = buildLocalSavingsGoal({
          familyId: activeFamilyId,
          form: savingsForm,
          currency: currencyCode(),
        });
        const txCached = await loadOfflineSnapshot(activeFamilyId, "finance", "transactions").catch(() => null);
        const txs = Array.isArray(txCached?.data) ? txCached.data : transactions;
        const next = recomputeSavingsFromLedger([...existing, row], txs);
        setSavings(next);
        await saveOfflineSnapshot(activeFamilyId, "finance", "savings", next);
        setSavingsAction((prev) => ({ ...prev, savings_goal_id: row.id }));
        if (isBrowserOnline() && canSyncCloudFinance(firebaseUser)) {
          await syncCloudAfterWrite();
          setMessage(t("savingsGoalCreated"), "success");
        } else {
          setMessage(t("savingsGoalCreatedOffline") || t("savingsGoalCreated"), "success");
        }
        setSavingsForm((prev) => ({ ...prev, name: "", target_amount: "", note: "" }));
        setDashboard(buildDashboardFromCache(await hydrateFamilyFromOfflineCache(activeFamilyId)));
        return true;
      }

      if (!isBrowserOnline()) {
        await enqueueOutboxChange({
          familyId: activeFamilyId,
          entity_type: "savings_goals",
          operation: "CREATE",
          payload,
        });
        setSavingsForm((prev) => ({ ...prev, name: "", target_amount: "", note: "" }));
        setMessage(t("syncQueuedOffline"), "success");
        await refreshLocalOutboxCount();
        return true;
      }

      await apiPost(`/savings`, payload);
      setSavingsForm((prev) => ({ ...prev, name: "", target_amount: "", note: "" }));
      setMessage(t("savingsGoalCreated"), "success");
      refreshAll();
      return true;
    } catch (err) {
      const msg = String(err.message || "");
      if (/failed to fetch|network|offline/i.test(msg)) {
        await enqueueOutboxChange({
          familyId: activeFamilyId,
          entity_type: "savings_goals",
          operation: "CREATE",
          payload,
        });
        setMessage(t("syncQueuedOffline"), "success");
        await refreshLocalOutboxCount();
        return true;
      }
      setMessage(err.message || "Savings create failed", "error");
      return false;
    } finally {
      setSavingsBusyId("");
    }
  }

  async function postSavingsAction() {
    if (savingsBusyId) return;
    if (!savingsAction.savings_goal_id) {
      setMessage(t("savingsGoalRequired"), "error");
      return;
    }

    if (!savingsAction.wallet_account_id || !isActiveWalletId(savingsAction.wallet_account_id)) {
      setMessage(t("walletRequired"), "error");
      return;
    }

    if (!savingsAction.amount || Number(savingsAction.amount) <= 0) {
      setMessage(t("validAmountRequired"), "error");
      return;
    }

    const actionOp = savingsAction.action === "withdraw" ? "WITHDRAW" : "DEPOSIT";
    const amountNum = Number(savingsAction.amount);
    const payload = {
      family_id: activeFamilyId,
      savings_goal_id: savingsAction.savings_goal_id,
      wallet_account_id: savingsAction.wallet_account_id,
      from_account_id: savingsAction.wallet_account_id,
      to_account_id: savingsAction.wallet_account_id,
      amount: savingsAction.amount,
      currency: currencyCode(),
      description: savingsAction.description,
      client_request_id: `web-savings-${actionOp.toLowerCase()}-${Date.now()}`,
    };

    try {
      setSavingsBusyId("action");
      if (isCloudLocalMode()) {
        const savCached = await loadOfflineSnapshot(activeFamilyId, "finance", "savings").catch(() => null);
        const txCached = await loadOfflineSnapshot(activeFamilyId, "finance", "transactions").catch(() => null);
        const walCached = await loadOfflineSnapshot(activeFamilyId, "finance", "wallets").catch(() => null);
        const existingSav = normalizeSavingsList(savCached?.data ?? savings);
        const existingTx = Array.isArray(txCached?.data) ? txCached.data : transactions;
        const existingWallets = Array.isArray(walCached?.data) ? walCached.data : wallets;
        const goal = existingSav.find((g) => String(g.id) === String(savingsAction.savings_goal_id));
        if (!goal) throw new Error(t("savingsGoalRequired") || "Savings goal required");
        if (String(goal.status || "").toUpperCase() !== "ACTIVE") {
          setMessage(t("onlyActiveSavingsAction") || "Only active savings goals can be used", "error");
          return;
        }
        const balNow = Number(goal.current_amount ?? goal.saved_amount ?? 0);
        if (actionOp === "WITHDRAW" && amountNum > balNow + 0.0001) {
          setMessage(t("insufficientSavingsBalance") || "Insufficient savings balance", "error");
          return;
        }
        const wallet = existingWallets.find((w) => String(w.id) === String(savingsAction.wallet_account_id));
        if (!wallet || wallet.deleted_at || wallet.is_active === false) {
          setMessage(t("walletRequired"), "error");
          return;
        }
        if (actionOp === "DEPOSIT") {
          const wBal = Number(wallet.balance ?? wallet.current_balance ?? 0);
          if (amountNum > wBal + 0.0001) {
            setMessage(t("insufficientWalletBalance") || "Insufficient wallet balance", "error");
            return;
          }
        }
        const movement = buildSavingsMovementTx({
          familyId: activeFamilyId,
          goal,
          walletId: savingsAction.wallet_account_id,
          amount: amountNum,
          currency: currencyCode(),
          action: actionOp,
          description: savingsAction.description,
        });
        const nextTx = sortTransactionsNewestFirst([movement, ...existingTx]);
        const nextWallets = recomputeWalletBalancesFromLedger(existingWallets, nextTx);
        const nextSav = recomputeSavingsFromLedger(existingSav, nextTx);
        setTransactions(nextTx);
        setWallets(activeWalletRows(nextWallets));
        setSavings(nextSav);
        await saveOfflineSnapshot(activeFamilyId, "finance", "transactions", nextTx);
        await saveOfflineSnapshot(activeFamilyId, "finance", "wallets", nextWallets);
        await saveOfflineSnapshot(activeFamilyId, "finance", "savings", nextSav);
        setSavingsAction((prev) => ({ ...prev, amount: "", description: "" }));
        setDashboard(buildDashboardFromCache(await hydrateFamilyFromOfflineCache(activeFamilyId)));
        if (isBrowserOnline() && canSyncCloudFinance(firebaseUser)) {
          await syncCloudAfterWrite();
        }
        setMessage(
          actionOp === "DEPOSIT"
            ? t("savingsDepositPosted") || "Savings deposit posted"
            : t("savingsWithdrawPosted") || "Savings withdraw posted",
          "success",
        );
        return;
      }

      if (!isBrowserOnline()) {
        await enqueueOutboxChange({
          familyId: activeFamilyId,
          entity_type: "savings_goals",
          operation: actionOp,
          entity_id: savingsAction.savings_goal_id,
          payload,
        });
        setSavingsAction((prev) => ({ ...prev, amount: "", description: "" }));
        setMessage(t("syncQueuedOffline"), "success");
        await refreshLocalOutboxCount();
        return;
      }

      if (savingsAction.action === "deposit") {
        await apiPost(`/savings/deposit`, {
          family_id: activeFamilyId,
          savings_goal_id: savingsAction.savings_goal_id,
          from_account_id: savingsAction.wallet_account_id,
          amount: savingsAction.amount,
          currency: currencyCode(),
          description: savingsAction.description,
          client_request_id: payload.client_request_id,
        });
      }

      if (savingsAction.action === "withdraw") {
        await apiPost(`/savings/withdraw`, {
          family_id: activeFamilyId,
          savings_goal_id: savingsAction.savings_goal_id,
          to_account_id: savingsAction.wallet_account_id,
          amount: savingsAction.amount,
          currency: currencyCode(),
          description: savingsAction.description,
          client_request_id: payload.client_request_id,
        });
      }

      setSavingsAction((prev) => ({ ...prev, amount: "", description: "" }));
      setMessage(
        savingsAction.action === "deposit"
          ? t("savingsDepositPosted") || "Savings deposit posted"
          : t("savingsWithdrawPosted") || "Savings withdraw posted",
        "success",
      );
      refreshAll();
    } catch (err) {
      const msg = String(err.message || "");
      if (/failed to fetch|network|offline/i.test(msg)) {
        await enqueueOutboxChange({
          familyId: activeFamilyId,
          entity_type: "savings_goals",
          operation: actionOp,
          entity_id: savingsAction.savings_goal_id,
          payload,
        });
        setMessage(t("syncQueuedOffline"), "success");
        await refreshLocalOutboxCount();
        return;
      }
      setMessage(err.message || "Savings action failed", "error");
    } finally {
      setSavingsBusyId("");
    }
  }

  async function createLoan() {
    if (!loanForm.wallet_account_id) {
      setMessage(t("walletRequired"), "error");
      return false;
    }

    if (!loanForm.person_name.trim()) {
      setMessage(t("personNameRequired"), "error");
      return false;
    }

    if (!loanForm.principal_amount || Number(loanForm.principal_amount) <= 0) {
      setMessage(t("validLoanAmountRequired"), "error");
      return false;
    }

    const payload = {
      family_id: activeFamilyId,
      wallet_account_id: loanForm.wallet_account_id,
      loan_type: loanForm.loan_type,
      person_name: loanForm.person_name.trim(),
      principal_amount: loanForm.principal_amount,
      currency: currencyCode(),
      note: loanForm.note,
      interest_rate: Number(loanForm.interest_rate || 0),
      interest_type: loanForm.interest_type || "NONE",
      installment_count: loanForm.installment_count ? Number(loanForm.installment_count) : null,
      start_date: loanForm.start_date || null,
      client_request_id: `web-loan-${Date.now()}`,
    };

    try {
      if (isCloudLocalMode()) {
        const row = buildLocalLoan({
          familyId: activeFamilyId,
          form: loanForm,
          currency: currencyCode(),
        });
        const principal = Number(row.principal_amount) || 0;
        const walletCached = await loadOfflineSnapshot(activeFamilyId, "finance", "wallets").catch(() => null);
        const existingWallets = Array.isArray(walletCached?.data) ? walletCached.data : wallets;
        const wallet = (existingWallets || []).find((w) => String(w.id) === String(row.wallet_account_id));
        if (!wallet || wallet.deleted_at || wallet.is_active === false) {
          setMessage(t("walletRequired"), "error");
          return false;
        }
        if (String(row.loan_type).toUpperCase() === "GIVEN" && walletBalance(wallet) < principal) {
          setMessage(t("insufficientWalletBalance") || "Insufficient wallet balance", "error");
          return false;
        }
        const txCached = await loadOfflineSnapshot(activeFamilyId, "finance", "transactions").catch(() => null);
        const existingTx = Array.isArray(txCached?.data) ? txCached.data : transactions;
        const loanCached = await loadOfflineSnapshot(activeFamilyId, "finance", "loans").catch(() => null);
        const existingLoans = Array.isArray(loanCached?.data) ? loanCached.data : loans;
        const movement = buildLoanMovementTx({
          familyId: activeFamilyId,
          loan: row,
          walletId: row.wallet_account_id,
          amount: principal,
          currency: currencyCode(),
          kind: "DISBURSE",
          description: row.note,
        });
        const nextTx = sortTransactionsNewestFirst([movement, ...existingTx]);
        const nextWallets = recomputeWalletBalancesFromLedger(existingWallets, nextTx);
        const nextLoans = [row, ...existingLoans];
        setTransactions(nextTx);
        setWallets(activeWalletRows(nextWallets));
        setLoans(nextLoans);
        await saveOfflineSnapshot(activeFamilyId, "finance", "transactions", nextTx);
        await saveOfflineSnapshot(activeFamilyId, "finance", "wallets", nextWallets);
        await saveOfflineSnapshot(activeFamilyId, "finance", "loans", nextLoans);
        setLoanForm((prev) => ({
          ...prev,
          person_name: "",
          principal_amount: "",
          note: "",
          interest_rate: "0",
          interest_type: "NONE",
          installment_count: "",
          start_date: "",
        }));
        setLoanPaymentForm((prev) => ({
          ...prev,
          loan_id: prev.loan_id || row.id,
        }));
        setDashboard(buildDashboardFromCache(await hydrateFamilyFromOfflineCache(activeFamilyId)));
        if (isBrowserOnline() && canSyncCloudFinance(firebaseUser)) {
          await syncCloudAfterWrite();
        }
        setMessage(t("loanCreated"), "success");
        return true;
      }

      if (!isBrowserOnline()) {
        await enqueueOutboxChange({
          familyId: activeFamilyId,
          entity_type: "loans",
          operation: "CREATE",
          payload,
        });
        setLoanForm((prev) => ({ ...prev, person_name: "", principal_amount: "", note: "" }));
        setMessage(t("syncQueuedOffline"), "success");
        await refreshLocalOutboxCount();
        return true;
      }

      await apiPost(`/loans`, payload);

      setLoanForm((prev) => ({
        ...prev,
        person_name: "",
        principal_amount: "",
        note: "",
      }));

      setMessage(t("loanCreated"), "success");
      refreshAll();
      return true;
    } catch (err) {
      const msg = String(err.message || "");
      if (/failed to fetch|network|offline/i.test(msg)) {
        await enqueueOutboxChange({
          familyId: activeFamilyId,
          entity_type: "loans",
          operation: "CREATE",
          payload,
        });
        setMessage(t("syncQueuedOffline"), "success");
        await refreshLocalOutboxCount();
        return true;
      }
      setMessage(err.message || "Loan create failed", "error");
      return false;
    }
  }

  async function postLoanPayment() {
    if (!loanPaymentForm.loan_id) {
      setMessage(t("loanRequired"), "error");
      return;
    }

    if (!loanPaymentForm.wallet_account_id) {
      setMessage(t("walletRequired"), "error");
      return;
    }

    if (!loanPaymentForm.amount || Number(loanPaymentForm.amount) <= 0) {
      setMessage(t("validPaymentAmountRequired"), "error");
      return;
    }

    const amountNum = Number(loanPaymentForm.amount);
    const loanRow = (loans || []).find((row) => row.id === loanPaymentForm.loan_id);
    const payload = {
      family_id: activeFamilyId,
      loan_id: loanPaymentForm.loan_id,
      wallet_account_id: loanPaymentForm.wallet_account_id,
      amount: loanPaymentForm.amount,
      currency: currencyCode(),
      description: loanPaymentForm.description,
      client_request_id: `web-loan-pay-${Date.now()}`,
    };

    try {
      if (isCloudLocalMode()) {
        if (!loanRow || String(loanRow.status || "").toUpperCase() !== "ACTIVE") {
          setMessage(t("loanRequired"), "error");
          return;
        }
        const remaining = Number(loanRow.remaining_amount || 0);
        if (amountNum > remaining + 0.0001) {
          setMessage(t("validPaymentAmountRequired"), "error");
          return;
        }
        const walletCached = await loadOfflineSnapshot(activeFamilyId, "finance", "wallets").catch(() => null);
        const existingWallets = Array.isArray(walletCached?.data) ? walletCached.data : wallets;
        const wallet = (existingWallets || []).find(
          (w) => String(w.id) === String(loanPaymentForm.wallet_account_id),
        );
        if (!wallet || wallet.deleted_at || wallet.is_active === false) {
          setMessage(t("walletRequired"), "error");
          return;
        }
        const loanType = String(loanRow.loan_type || "").toUpperCase();
        if (loanType === "TAKEN" && walletBalance(wallet) < amountNum) {
          setMessage(t("insufficientWalletBalance") || "Insufficient wallet balance", "error");
          return;
        }
        const txCached = await loadOfflineSnapshot(activeFamilyId, "finance", "transactions").catch(() => null);
        const existingTx = Array.isArray(txCached?.data) ? txCached.data : transactions;
        const loanCached = await loadOfflineSnapshot(activeFamilyId, "finance", "loans").catch(() => null);
        const existingLoans = Array.isArray(loanCached?.data) ? loanCached.data : loans;
        const updatedLoan = applyLoanPayment(loanRow, amountNum);
        const movement = buildLoanMovementTx({
          familyId: activeFamilyId,
          loan: loanRow,
          walletId: loanPaymentForm.wallet_account_id,
          amount: amountNum,
          currency: currencyCode(),
          kind: "REPAYMENT",
          description: loanPaymentForm.description,
        });
        const nextTx = sortTransactionsNewestFirst([movement, ...existingTx]);
        const nextWallets = recomputeWalletBalancesFromLedger(existingWallets, nextTx);
        const nextLoans = existingLoans.map((loan) =>
          String(loan.id) === String(loanRow.id) ? updatedLoan : loan,
        );
        setTransactions(nextTx);
        setWallets(activeWalletRows(nextWallets));
        setLoans(nextLoans);
        await saveOfflineSnapshot(activeFamilyId, "finance", "transactions", nextTx);
        await saveOfflineSnapshot(activeFamilyId, "finance", "wallets", nextWallets);
        await saveOfflineSnapshot(activeFamilyId, "finance", "loans", nextLoans);
        setLoanPaymentForm((prev) => ({ ...prev, amount: "", description: "" }));
        setDashboard(buildDashboardFromCache(await hydrateFamilyFromOfflineCache(activeFamilyId)));
        if (isBrowserOnline() && canSyncCloudFinance(firebaseUser)) {
          await syncCloudAfterWrite();
        }
        setMessage(t("loanPaymentPosted"), "success");
        return;
      }

      if (!isBrowserOnline()) {
        await enqueueOutboxChange({
          familyId: activeFamilyId,
          entity_type: "loans",
          operation: "PAYMENT",
          entity_id: loanPaymentForm.loan_id,
          payload,
        });
        const loanType = String(loanRow?.loan_type || "").toUpperCase();
        setWallets((prev) =>
          (prev || []).map((acc) => {
            if (acc.id !== loanPaymentForm.wallet_account_id) return acc;
            const bal = Number(acc.current_balance || 0);
            const next = loanType === "GIVEN" ? bal + amountNum : bal - amountNum;
            return { ...acc, current_balance: String(next) };
          }),
        );
        setLoans((prev) =>
          (prev || []).map((loan) =>
            loan.id === loanPaymentForm.loan_id ? applyLoanPayment(loan, amountNum) : loan,
          ),
        );
        setLoanPaymentForm((prev) => ({ ...prev, amount: "", description: "" }));
        setMessage(t("syncQueuedOffline"), "success");
        await refreshLocalOutboxCount();
        return;
      }

      await apiPost(`/loans/payment`, {
        family_id: activeFamilyId,
        loan_id: loanPaymentForm.loan_id,
        wallet_account_id: loanPaymentForm.wallet_account_id,
        amount: loanPaymentForm.amount,
        currency: currencyCode(),
        description: loanPaymentForm.description,
      });

      setLoanPaymentForm((prev) => ({
        ...prev,
        amount: "",
        description: "",
      }));

      setMessage(t("loanPaymentPosted"), "success");
      refreshAll();
    } catch (err) {
      const msg = String(err.message || "");
      if (/failed to fetch|network|offline/i.test(msg)) {
        await enqueueOutboxChange({
          familyId: activeFamilyId,
          entity_type: "loans",
          operation: "PAYMENT",
          entity_id: loanPaymentForm.loan_id,
          payload,
        });
        const loanType = String(loanRow?.loan_type || "").toUpperCase();
        setWallets((prev) =>
          (prev || []).map((acc) => {
            if (acc.id !== loanPaymentForm.wallet_account_id) return acc;
            const bal = Number(acc.current_balance || 0);
            const next = loanType === "GIVEN" ? bal + amountNum : bal - amountNum;
            return { ...acc, current_balance: String(next) };
          }),
        );
        setLoans((prev) =>
          (prev || []).map((loan) =>
            loan.id === loanPaymentForm.loan_id ? applyLoanPayment(loan, amountNum) : loan,
          ),
        );
        setLoanPaymentForm((prev) => ({ ...prev, amount: "", description: "" }));
        setMessage(t("syncQueuedOffline"), "success");
        await refreshLocalOutboxCount();
        return;
      }
      setMessage(err.message || "Loan payment failed", "error");
    }
  }

  async function createBudget() {
    if (budgetBusyId) return false;
    if (!budgetForm.category_id) {
      setMessage(t("expenseCategoryRequired"), "error");
      return false;
    }

    if (!budgetForm.name.trim() || budgetForm.name.trim().length < 2) {
      setMessage(t("budgetNameRequired"), "error");
      return false;
    }

    if (!budgetForm.budget_amount || Number(budgetForm.budget_amount) <= 0) {
      setMessage(t("validBudgetAmountRequired"), "error");
      return false;
    }

    const payload = {
      family_id: activeFamilyId,
      category_id: budgetForm.category_id,
      name: budgetForm.name.trim(),
      budget_amount: budgetForm.budget_amount,
      currency: currencyCode(),
      period_type: budgetForm.period_type,
      note: budgetForm.note,
      client_request_id: `web-budget-${Date.now()}`,
    };

    try {
      setBudgetBusyId("create");
      if (isCloudLocalMode()) {
        const cached = await loadOfflineSnapshot(activeFamilyId, "finance", "budgets").catch(() => null);
        const existing = normalizeBudgetsList(cached?.data ?? budgets);
        const dupKey = budgetDuplicateKey({
          category_id: budgetForm.category_id,
          period_type: budgetForm.period_type,
        });
        const dup = existing.find(
          (b) =>
            String(b.status || "").toUpperCase() === "ACTIVE" && budgetDuplicateKey(b) === dupKey,
        );
        if (dup) {
          setMessage(t("budgetDuplicateActive") || "An active budget already exists for this category and period", "error");
          return false;
        }
        const catCached = await loadOfflineSnapshot(activeFamilyId, "finance", "categories").catch(() => null);
        const cats = Array.isArray(catCached?.data) ? catCached.data : categories;
        const cat = cats.find((c) => String(c.id) === String(budgetForm.category_id));
        const row = buildLocalBudget({
          familyId: activeFamilyId,
          form: budgetForm,
          currency: currencyCode(),
          categoryName: cat?.name_en || cat?.name || "",
        });
        const txCached = await loadOfflineSnapshot(activeFamilyId, "finance", "transactions").catch(() => null);
        const txs = Array.isArray(txCached?.data) ? txCached.data : transactions;
        const nextRaw = persistableBudgets([...existing, row]);
        const next = enrichBudgetsFromLedger(nextRaw, txs, cats);
        setBudgets(next);
        await saveOfflineSnapshot(activeFamilyId, "finance", "budgets", nextRaw);
        if (isBrowserOnline() && canSyncCloudFinance(firebaseUser)) {
          await syncCloudAfterWrite();
          setMessage(t("budgetCreated"), "success");
        } else {
          setMessage(t("budgetCreatedOffline") || t("budgetCreated"), "success");
        }
        setBudgetForm((prev) => ({ ...prev, name: "", budget_amount: "", note: "" }));
        setDashboard(buildDashboardFromCache(await hydrateFamilyFromOfflineCache(activeFamilyId)));
        return true;
      }

      if (!isBrowserOnline()) {
        await enqueueOutboxChange({
          familyId: activeFamilyId,
          entity_type: "budgets",
          operation: "CREATE",
          payload,
        });
        setBudgetForm((prev) => ({ ...prev, name: "", budget_amount: "", note: "" }));
        setMessage(t("syncQueuedOffline"), "success");
        await refreshLocalOutboxCount();
        return true;
      }

      await apiPost(`/budgets`, payload);

      setBudgetForm((prev) => ({
        ...prev,
        name: "",
        budget_amount: "",
        note: "",
      }));

      setMessage(t("budgetCreated"), "success");
      refreshAll();
      return true;
    } catch (err) {
      const msg = String(err.message || "");
      if (/failed to fetch|network|offline/i.test(msg)) {
        await enqueueOutboxChange({
          familyId: activeFamilyId,
          entity_type: "budgets",
          operation: "CREATE",
          payload,
        });
        setMessage(t("syncQueuedOffline"), "success");
        await refreshLocalOutboxCount();
        return true;
      }
      setMessage(err.message || t("budgetLoadFailed") || "Budget create failed", "error");
      return false;
    } finally {
      setBudgetBusyId("");
    }
  }


  async function createGoal() {
    if (!goalForm.goal_name.trim()) {
      setMessage(t("goalNameRequired"), "error");
      return;
    }

    if (!goalForm.target_amount || Number(goalForm.target_amount) <= 0) {
      setMessage(t("validTargetAmountRequired"), "error");
      return;
    }

    const payload = {
      family_id: activeFamilyId,
      linked_savings_goal_id: null,
      goal_name: goalForm.goal_name.trim(),
      goal_type: goalForm.goal_type,
      target_amount: goalForm.target_amount,
      currency: currencyCode(),
      target_date: goalForm.target_date || null,
      note: goalForm.note,
      client_request_id: `web-goal-${Date.now()}`,
    };

    try {
      if (isCloudLocalMode()) {
        const row = enrichGoals([
          buildLocalGoal({
            familyId: activeFamilyId,
            form: goalForm,
            currency: currencyCode(),
          }),
        ])[0];
        const goalCached = await loadOfflineSnapshot(activeFamilyId, "finance", "goals").catch(() => null);
        const existing = Array.isArray(goalCached?.data) ? goalCached.data : goals;
        const next = enrichGoals([row, ...existing]);
        const summary = buildGoalSummary(next);
        setGoals(next);
        setGoalSummary(summary);
        await saveOfflineSnapshot(activeFamilyId, "finance", "goals", next);
        await saveOfflineSnapshot(activeFamilyId, "finance", "goalSummary", summary);
        setGoalContributionForm((prev) => ({ ...prev, goal_id: prev.goal_id || row.id }));
        setGoalForm({
          goal_name: "",
          goal_type: "GENERAL",
          target_amount: "",
          currency: currencyCode(),
          target_date: "",
          note: "",
        });
        setDashboard(buildDashboardFromCache(await hydrateFamilyFromOfflineCache(activeFamilyId)));
        if (isBrowserOnline() && canSyncCloudFinance(firebaseUser)) {
          await syncCloudAfterWrite();
        }
        setMessage(t("goalCreated"), "success");
        return;
      }

      if (!isBrowserOnline()) {
        await enqueueOutboxChange({
          familyId: activeFamilyId,
          entity_type: "financial_goals",
          operation: "CREATE",
          payload,
        });
        setGoalForm({
          goal_name: "",
          goal_type: "GENERAL",
          target_amount: "",
          currency: currencyCode(),
          target_date: "",
          note: "",
        });
        setMessage(t("syncQueuedOffline"), "success");
        await refreshLocalOutboxCount();
        return;
      }

      await apiPost(`/goals`, payload);

      setGoalForm({
        goal_name: "",
        goal_type: "GENERAL",
        target_amount: "",
        currency: currencyCode(),
        target_date: "",
        note: "",
      });

      setMessage(t("goalCreated"), "success");
      refreshAll();
    } catch (err) {
      const msg = String(err.message || "");
      if (/failed to fetch|network|offline/i.test(msg)) {
        await enqueueOutboxChange({
          familyId: activeFamilyId,
          entity_type: "financial_goals",
          operation: "CREATE",
          payload,
        });
        setMessage(t("syncQueuedOffline"), "success");
        await refreshLocalOutboxCount();
        return;
      }
      setMessage(err.message || "Goal create failed", "error");
    }
  }

  async function contributeGoal() {
    if (!goalContributionForm.goal_id) {
      setMessage(t("goalRequired"), "error");
      return;
    }

    if (!goalContributionForm.wallet_account_id) {
      setMessage(t("walletRequired"), "error");
      return;
    }

    if (!goalContributionForm.amount || Number(goalContributionForm.amount) <= 0) {
      setMessage(t("validAmountRequired"), "error");
      return;
    }

    const amountNum = Number(goalContributionForm.amount);
    const goalRow = (goals || []).find((row) => row.id === goalContributionForm.goal_id);
    const payload = {
      family_id: activeFamilyId,
      goal_id: goalContributionForm.goal_id,
      wallet_account_id: goalContributionForm.wallet_account_id,
      amount: goalContributionForm.amount,
      currency: currencyCode(),
      description: goalContributionForm.description,
      client_request_id: `web-goal-contribute-${Date.now()}`,
    };

    try {
      if (isCloudLocalMode()) {
        if (!goalRow || String(goalRow.status || "").toUpperCase() === "CLOSED") {
          setMessage(t("goalRequired"), "error");
          return;
        }
        const walletCached = await loadOfflineSnapshot(activeFamilyId, "finance", "wallets").catch(() => null);
        const existingWallets = Array.isArray(walletCached?.data) ? walletCached.data : wallets;
        const wallet = (existingWallets || []).find(
          (w) => String(w.id) === String(goalContributionForm.wallet_account_id),
        );
        if (!wallet || wallet.deleted_at || wallet.is_active === false) {
          setMessage(t("walletRequired"), "error");
          return;
        }
        if (walletBalance(wallet) < amountNum) {
          setMessage(t("insufficientWalletBalance") || "Insufficient wallet balance", "error");
          return;
        }
        const txCached = await loadOfflineSnapshot(activeFamilyId, "finance", "transactions").catch(() => null);
        const existingTx = Array.isArray(txCached?.data) ? txCached.data : transactions;
        const goalCached = await loadOfflineSnapshot(activeFamilyId, "finance", "goals").catch(() => null);
        const existingGoals = Array.isArray(goalCached?.data) ? goalCached.data : goals;
        const movement = buildGoalMovementTx({
          familyId: activeFamilyId,
          goal: goalRow,
          walletId: goalContributionForm.wallet_account_id,
          amount: amountNum,
          currency: currencyCode(),
          kind: "CONTRIBUTE",
          description: goalContributionForm.description,
        });
        const nextTx = sortTransactionsNewestFirst([movement, ...existingTx]);
        const nextWallets = recomputeWalletBalancesFromLedger(existingWallets, nextTx);
        const nextGoals = recomputeGoalsFromLedger(existingGoals, nextTx);
        const summary = buildGoalSummary(nextGoals);
        setTransactions(nextTx);
        setWallets(activeWalletRows(nextWallets));
        setGoals(nextGoals);
        setGoalSummary(summary);
        await saveOfflineSnapshot(activeFamilyId, "finance", "transactions", nextTx);
        await saveOfflineSnapshot(activeFamilyId, "finance", "wallets", nextWallets);
        await saveOfflineSnapshot(activeFamilyId, "finance", "goals", nextGoals);
        await saveOfflineSnapshot(activeFamilyId, "finance", "goalSummary", summary);
        setGoalContributionForm((prev) => ({ ...prev, amount: "", description: "" }));
        setDashboard(buildDashboardFromCache(await hydrateFamilyFromOfflineCache(activeFamilyId)));
        if (isBrowserOnline() && canSyncCloudFinance(firebaseUser)) {
          await syncCloudAfterWrite();
        }
        setMessage(t("goalContributionPosted"), "success");
        return;
      }

      if (!isBrowserOnline()) {
        await enqueueOutboxChange({
          familyId: activeFamilyId,
          entity_type: "financial_goals",
          operation: "CONTRIBUTE",
          entity_id: goalContributionForm.goal_id,
          payload,
        });
        setWallets((prev) =>
          (prev || []).map((acc) => {
            if (acc.id !== goalContributionForm.wallet_account_id) return acc;
            return { ...acc, current_balance: String(Number(acc.current_balance || 0) - amountNum) };
          }),
        );
        setGoals((prev) =>
          enrichGoals(
            (prev || []).map((goal) => {
              if (goal.id !== goalContributionForm.goal_id) return goal;
              const next = Number(goal.current_amount || 0) + amountNum;
              const target = Number(goal.target_amount || 0);
              return {
                ...goal,
                current_amount: next,
                status: target > 0 && next >= target ? "COMPLETED" : goal.status,
              };
            }),
          ),
        );
        setGoalContributionForm((prev) => ({ ...prev, amount: "", description: "" }));
        setMessage(t("syncQueuedOffline"), "success");
        await refreshLocalOutboxCount();
        return;
      }

      await apiPost(`/goals/contribute`, {
        family_id: activeFamilyId,
        goal_id: goalContributionForm.goal_id,
        wallet_account_id: goalContributionForm.wallet_account_id,
        amount: goalContributionForm.amount,
        currency: currencyCode(),
        description: goalContributionForm.description,
        client_request_id: payload.client_request_id,
      });

      setGoalContributionForm((prev) => ({
        ...prev,
        amount: "",
        description: "",
      }));

      setMessage(t("goalContributionPosted"), "success");
      refreshAll();
    } catch (err) {
      const msg = String(err.message || "");
      if (/failed to fetch|network|offline/i.test(msg)) {
        await enqueueOutboxChange({
          familyId: activeFamilyId,
          entity_type: "financial_goals",
          operation: "CONTRIBUTE",
          entity_id: goalContributionForm.goal_id,
          payload,
        });
        setWallets((prev) =>
          (prev || []).map((acc) => {
            if (acc.id !== goalContributionForm.wallet_account_id) return acc;
            return { ...acc, current_balance: String(Number(acc.current_balance || 0) - amountNum) };
          }),
        );
        setGoals((prev) =>
          enrichGoals(
            (prev || []).map((goal) => {
              if (goal.id !== goalContributionForm.goal_id) return goal;
              const next = Number(goal.current_amount || 0) + amountNum;
              const target = Number(goal.target_amount || 0);
              return {
                ...goal,
                current_amount: next,
                status: target > 0 && next >= target ? "COMPLETED" : goal.status,
              };
            }),
          ),
        );
        setGoalContributionForm((prev) => ({ ...prev, amount: "", description: "" }));
        setMessage(t("syncQueuedOffline"), "success");
        await refreshLocalOutboxCount();
        return;
      }
      setMessage(err.message || "Goal contribution failed", "error");
    }
  }

  async function withdrawGoal() {
    if (!goalContributionForm.goal_id) {
      setMessage(t("goalRequired"), "error");
      return;
    }

    if (!goalContributionForm.wallet_account_id) {
      setMessage(t("walletRequired"), "error");
      return;
    }

    if (!goalContributionForm.amount || Number(goalContributionForm.amount) <= 0) {
      setMessage(t("validAmountRequired"), "error");
      return;
    }

    const amountNum = Number(goalContributionForm.amount);
    const goalRow = (goals || []).find((row) => row.id === goalContributionForm.goal_id);
    const payload = {
      family_id: activeFamilyId,
      goal_id: goalContributionForm.goal_id,
      wallet_account_id: goalContributionForm.wallet_account_id,
      amount: goalContributionForm.amount,
      currency: currencyCode(),
      description: goalContributionForm.description,
      client_request_id: `web-goal-withdraw-${Date.now()}`,
    };

    try {
      if (isCloudLocalMode()) {
        if (!goalRow || String(goalRow.status || "").toUpperCase() === "CLOSED") {
          setMessage(t("goalRequired"), "error");
          return;
        }
        if (amountNum > Number(goalRow.current_amount || 0) + 0.0001) {
          setMessage(t("validAmountRequired"), "error");
          return;
        }
        const walletCached = await loadOfflineSnapshot(activeFamilyId, "finance", "wallets").catch(() => null);
        const existingWallets = Array.isArray(walletCached?.data) ? walletCached.data : wallets;
        const wallet = (existingWallets || []).find(
          (w) => String(w.id) === String(goalContributionForm.wallet_account_id),
        );
        if (!wallet || wallet.deleted_at || wallet.is_active === false) {
          setMessage(t("walletRequired"), "error");
          return;
        }
        const txCached = await loadOfflineSnapshot(activeFamilyId, "finance", "transactions").catch(() => null);
        const existingTx = Array.isArray(txCached?.data) ? txCached.data : transactions;
        const goalCached = await loadOfflineSnapshot(activeFamilyId, "finance", "goals").catch(() => null);
        const existingGoals = Array.isArray(goalCached?.data) ? goalCached.data : goals;
        const movement = buildGoalMovementTx({
          familyId: activeFamilyId,
          goal: goalRow,
          walletId: goalContributionForm.wallet_account_id,
          amount: amountNum,
          currency: currencyCode(),
          kind: "WITHDRAW",
          description: goalContributionForm.description,
        });
        const nextTx = sortTransactionsNewestFirst([movement, ...existingTx]);
        const nextWallets = recomputeWalletBalancesFromLedger(existingWallets, nextTx);
        const nextGoals = recomputeGoalsFromLedger(existingGoals, nextTx);
        const summary = buildGoalSummary(nextGoals);
        setTransactions(nextTx);
        setWallets(activeWalletRows(nextWallets));
        setGoals(nextGoals);
        setGoalSummary(summary);
        await saveOfflineSnapshot(activeFamilyId, "finance", "transactions", nextTx);
        await saveOfflineSnapshot(activeFamilyId, "finance", "wallets", nextWallets);
        await saveOfflineSnapshot(activeFamilyId, "finance", "goals", nextGoals);
        await saveOfflineSnapshot(activeFamilyId, "finance", "goalSummary", summary);
        setGoalContributionForm((prev) => ({ ...prev, amount: "", description: "" }));
        setDashboard(buildDashboardFromCache(await hydrateFamilyFromOfflineCache(activeFamilyId)));
        if (isBrowserOnline() && canSyncCloudFinance(firebaseUser)) {
          await syncCloudAfterWrite();
        }
        setMessage(t("goalWithdrawPosted"), "success");
        return;
      }

      if (!isBrowserOnline()) {
        await enqueueOutboxChange({
          familyId: activeFamilyId,
          entity_type: "financial_goals",
          operation: "WITHDRAW",
          entity_id: goalContributionForm.goal_id,
          payload,
        });
        setWallets((prev) =>
          (prev || []).map((acc) => {
            if (acc.id !== goalContributionForm.wallet_account_id) return acc;
            return { ...acc, current_balance: String(Number(acc.current_balance || 0) + amountNum) };
          }),
        );
        setGoals((prev) =>
          enrichGoals(
            (prev || []).map((goal) => {
              if (goal.id !== goalContributionForm.goal_id) return goal;
              const next = Math.max(0, Number(goal.current_amount || 0) - amountNum);
              const target = Number(goal.target_amount || 0);
              return {
                ...goal,
                current_amount: next,
                status: goal.status === "COMPLETED" && next < target ? "ACTIVE" : goal.status,
              };
            }),
          ),
        );
        setGoalContributionForm((prev) => ({ ...prev, amount: "", description: "" }));
        setMessage(t("syncQueuedOffline"), "success");
        await refreshLocalOutboxCount();
        return;
      }

      await apiPost(`/goals/withdraw`, {
        family_id: activeFamilyId,
        goal_id: goalContributionForm.goal_id,
        wallet_account_id: goalContributionForm.wallet_account_id,
        amount: goalContributionForm.amount,
        currency: currencyCode(),
        description: goalContributionForm.description,
        client_request_id: payload.client_request_id,
      });

      setGoalContributionForm((prev) => ({
        ...prev,
        amount: "",
        description: "",
      }));

      setMessage(t("goalWithdrawPosted"), "success");
      refreshAll();
    } catch (err) {
      const msg = String(err.message || "");
      if (/failed to fetch|network|offline/i.test(msg)) {
        await enqueueOutboxChange({
          familyId: activeFamilyId,
          entity_type: "financial_goals",
          operation: "WITHDRAW",
          entity_id: goalContributionForm.goal_id,
          payload,
        });
        setWallets((prev) =>
          (prev || []).map((acc) => {
            if (acc.id !== goalContributionForm.wallet_account_id) return acc;
            return { ...acc, current_balance: String(Number(acc.current_balance || 0) + amountNum) };
          }),
        );
        setGoals((prev) =>
          enrichGoals(
            (prev || []).map((goal) => {
              if (goal.id !== goalContributionForm.goal_id) return goal;
              const next = Math.max(0, Number(goal.current_amount || 0) - amountNum);
              const target = Number(goal.target_amount || 0);
              return {
                ...goal,
                current_amount: next,
                status: goal.status === "COMPLETED" && next < target ? "ACTIVE" : goal.status,
              };
            }),
          ),
        );
        setGoalContributionForm((prev) => ({ ...prev, amount: "", description: "" }));
        setMessage(t("syncQueuedOffline"), "success");
        await refreshLocalOutboxCount();
        return;
      }
      setMessage(err.message || "Goal withdraw failed", "error");
    }
  }


  function openGoalEdit(item) {
    if (item.status !== "ACTIVE") {
      setMessage(t("onlyActiveGoalEdit"), "error");
      return;
    }

    setGoalEditModal({
      open: true,
      goal: item,
      goal_name: item.goal_name || "",
      goal_type: item.goal_type || "GENERAL",
      target_amount: item.target_amount || "",
      target_date: item.target_date || "",
      note: item.note || "",
    });
  }

  function closeGoalEdit() {
    setGoalEditModal({
      open: false,
      goal: null,
      goal_name: "",
      goal_type: "GENERAL",
      target_amount: "",
      target_date: "",
      note: "",
    });
  }

  async function saveGoalEdit() {
    if (!goalEditModal.goal) return;

    if (!goalEditModal.goal_name.trim()) {
      setMessage(t("goalNameRequired"), "error");
      return;
    }

    if (!goalEditModal.target_amount || Number(goalEditModal.target_amount) <= 0) {
      setMessage(t("validTargetAmountRequired"), "error");
      return;
    }

    const payload = {
      family_id: activeFamilyId,
      goal_name: goalEditModal.goal_name.trim(),
      goal_type: goalEditModal.goal_type,
      target_amount: goalEditModal.target_amount,
      target_date: goalEditModal.target_date || null,
      note: goalEditModal.note,
    };

    try {
      if (isCloudLocalMode()) {
        const goalCached = await loadOfflineSnapshot(activeFamilyId, "finance", "goals").catch(() => null);
        const existing = Array.isArray(goalCached?.data) ? goalCached.data : goals;
        const txCached = await loadOfflineSnapshot(activeFamilyId, "finance", "transactions").catch(() => null);
        const txs = Array.isArray(txCached?.data) ? txCached.data : transactions;
        const nextRaw = existing.map((goal) =>
          String(goal.id) === String(goalEditModal.goal.id)
            ? {
                ...goal,
                goal_name: payload.goal_name,
                name: payload.goal_name,
                goal_type: payload.goal_type || goal.goal_type,
                target_amount: Number(payload.target_amount),
                target_date: payload.target_date,
                note: payload.note || "",
                updated_at: new Date().toISOString(),
              }
            : goal,
        );
        const next = recomputeGoalsFromLedger(nextRaw, txs);
        const summary = buildGoalSummary(next);
        setGoals(next);
        setGoalSummary(summary);
        await saveOfflineSnapshot(activeFamilyId, "finance", "goals", next);
        await saveOfflineSnapshot(activeFamilyId, "finance", "goalSummary", summary);
        closeGoalEdit();
        if (isBrowserOnline() && canSyncCloudFinance(firebaseUser)) {
          await syncCloudAfterWrite();
        }
        setMessage(t("goalUpdated"), "success");
        return;
      }

      await apiPatch(`/goals/${goalEditModal.goal.id}`, payload);

      closeGoalEdit();
      setMessage(t("goalUpdated"), "success");
      refreshAll();
    } catch (err) {
      setMessage(err.message || "Goal update failed", "error");
    }
  }

  async function openGoalHistory(item) {
    setGoalHistoryModal({
      open: true,
      loading: true,
      goal: item,
      history: [],
    });

    try {
      if (isCloudLocalMode()) {
        const txCached = await loadOfflineSnapshot(activeFamilyId, "finance", "transactions").catch(() => null);
        const txs = Array.isArray(txCached?.data) ? txCached.data : transactions;
        const history = goalHistoryFromLedger(item.id, txs);
        setGoalHistoryModal({
          open: true,
          loading: false,
          goal: item,
          history,
        });
        setMessage(t("goalHistoryLoaded"), "success");
        return;
      }

      const data = await apiGet(`/goals/${item.id}/history/${activeFamilyId}`);

      setGoalHistoryModal({
        open: true,
        loading: false,
        goal: data.goal || item,
        history: data.history || [],
      });

      setMessage(t("goalHistoryLoaded"), "success");
    } catch (err) {
      setGoalHistoryModal({
        open: true,
        loading: false,
        goal: item,
        history: [],
      });

      setMessage(err.message || "Goal history load failed", "error");
    }
  }

  function closeGoalHistory() {
    setGoalHistoryModal({
      open: false,
      loading: false,
      goal: null,
      history: [],
    });
  }

  async function closeGoal(item) {
    const ok = window.confirm(t("confirmCloseGoal") || `Close goal "${item.goal_name}"?`);
    if (!ok) return;

    try {
      if (isCloudLocalMode()) {
        const goalCached = await loadOfflineSnapshot(activeFamilyId, "finance", "goals").catch(() => null);
        const existing = Array.isArray(goalCached?.data) ? goalCached.data : goals;
        const next = enrichGoals(
          existing.map((goal) =>
            String(goal.id) === String(item.id)
              ? { ...goal, status: "CLOSED", updated_at: new Date().toISOString() }
              : goal,
          ),
        );
        const summary = buildGoalSummary(next);
        setGoals(next);
        setGoalSummary(summary);
        await saveOfflineSnapshot(activeFamilyId, "finance", "goals", next);
        await saveOfflineSnapshot(activeFamilyId, "finance", "goalSummary", summary);
        if (isBrowserOnline() && canSyncCloudFinance(firebaseUser)) {
          await syncCloudAfterWrite();
        }
        setMessage(t("goalClosed"), "success");
        return;
      }

      await apiPost(`/goals/${item.id}/close`, {
        family_id: activeFamilyId,
        reason: "Closed from frontend",
      });

      setMessage(t("goalClosed"), "success");
      refreshAll();
    } catch (err) {
      setMessage(err.message || "Goal close failed", "error");
    }
  }

  async function createRecurring() {
    if (!recurringForm.account_id) {
      setMessage(t("walletRequired"), "error");
      return;
    }

    if (!recurringForm.title.trim()) {
      setMessage(t("recurringTitleRequired"), "error");
      return;
    }

    if (!recurringForm.amount || Number(recurringForm.amount) <= 0) {
      setMessage(t("validRecurringAmountRequired"), "error");
      return;
    }

    if (!recurringForm.start_date) {
      setMessage(t("startDateRequired"), "error");
      return;
    }

    const payload = {
      family_id: activeFamilyId,
      account_id: recurringForm.account_id,
      category_id: recurringForm.category_id || null,
      title: recurringForm.title.trim(),
      transaction_type: recurringForm.transaction_type,
      amount: recurringForm.amount,
      currency: currencyCode(),
      frequency: recurringForm.frequency,
      start_date: recurringForm.start_date,
      end_date: recurringForm.end_date || null,
      description: recurringForm.description,
      client_request_id: `web-recurring-${Date.now()}`,
    };

    try {
      if (isCloudLocalMode()) {
        const row = buildLocalRecurring({
          familyId: activeFamilyId,
          form: recurringForm,
          currency: currencyCode(),
        });
        const cached = await loadOfflineSnapshot(activeFamilyId, "finance", "recurring").catch(() => null);
        const existing = Array.isArray(cached?.data) ? cached.data : recurringItems;
        const next = [row, ...existing];
        setRecurringItems(next);
        await saveOfflineSnapshot(activeFamilyId, "finance", "recurring", next);
        setRecurringForm((prev) => ({
          ...prev,
          title: "",
          amount: "",
          description: "",
          end_date: "",
        }));
        if (isBrowserOnline() && canSyncCloudFinance(firebaseUser)) {
          await syncCloudAfterWrite();
        }
        setMessage(t("recurringCreated"), "success");
        return;
      }

      if (!isBrowserOnline()) {
        await enqueueOutboxChange({
          familyId: activeFamilyId,
          entity_type: "recurring_transactions",
          operation: "CREATE",
          payload,
        });
        setRecurringForm((prev) => ({
          ...prev,
          title: "",
          amount: "",
          description: "",
        }));
        setMessage(t("syncQueuedOffline"), "success");
        await refreshLocalOutboxCount();
        return;
      }

      await apiPost(`/recurring`, payload);

      setRecurringForm((prev) => ({
        ...prev,
        title: "",
        amount: "",
        description: "",
      }));

      setMessage(t("recurringCreated"), "success");
      refreshAll();
    } catch (err) {
      const msg = String(err.message || "");
      if (/failed to fetch|network|offline/i.test(msg)) {
        await enqueueOutboxChange({
          familyId: activeFamilyId,
          entity_type: "recurring_transactions",
          operation: "CREATE",
          payload,
        });
        setMessage(t("syncQueuedOffline"), "success");
        await refreshLocalOutboxCount();
        return;
      }
      setMessage(err.message || "Recurring create failed", "error");
    }
  }

  async function postRecurring(item) {
    const ok = window.confirm(t("confirmPostRecurring") || `Post recurring "${item.title}" now?`);
    if (!ok) return;

    try {
      if (isCloudLocalMode()) {
        if (String(item.status || "").toUpperCase() !== "ACTIVE") {
          setMessage(t("recurringPosted") || "Recurring post failed", "error");
          return;
        }
        const amountNum = Number(item.amount) || 0;
        const walletCached = await loadOfflineSnapshot(activeFamilyId, "finance", "wallets").catch(() => null);
        const existingWallets = Array.isArray(walletCached?.data) ? walletCached.data : wallets;
        const wallet = (existingWallets || []).find((w) => String(w.id) === String(item.account_id));
        if (!wallet || wallet.deleted_at || wallet.is_active === false) {
          setMessage(t("walletRequired"), "error");
          return;
        }
        const isExpense = !String(item.transaction_type || "").toUpperCase().includes("INCOME");
        if (isExpense && walletBalance(wallet) < amountNum) {
          setMessage(t("insufficientWalletBalance") || "Insufficient wallet balance", "error");
          return;
        }
        const txCached = await loadOfflineSnapshot(activeFamilyId, "finance", "transactions").catch(() => null);
        const existingTx = Array.isArray(txCached?.data) ? txCached.data : transactions;
        const recCached = await loadOfflineSnapshot(activeFamilyId, "finance", "recurring").catch(() => null);
        const existingRec = Array.isArray(recCached?.data) ? recCached.data : recurringItems;
        const movement = buildRecurringPostTx({
          familyId: activeFamilyId,
          item,
          currency: currencyCode(),
        });
        const nextTx = sortTransactionsNewestFirst([movement, ...existingTx]);
        const nextWallets = recomputeWalletBalancesFromLedger(existingWallets, nextTx);
        const nextRec = existingRec.map((row) =>
          String(row.id) === String(item.id) ? advanceRecurringAfterPost(row) : row,
        );
        setTransactions(nextTx);
        setWallets(activeWalletRows(nextWallets));
        setRecurringItems(nextRec);
        await saveOfflineSnapshot(activeFamilyId, "finance", "transactions", nextTx);
        await saveOfflineSnapshot(activeFamilyId, "finance", "wallets", nextWallets);
        await saveOfflineSnapshot(activeFamilyId, "finance", "recurring", nextRec);
        setDashboard(buildDashboardFromCache(await hydrateFamilyFromOfflineCache(activeFamilyId)));
        if (isBrowserOnline() && canSyncCloudFinance(firebaseUser)) {
          await syncCloudAfterWrite();
        }
        setMessage(t("recurringPosted"), "success");
        return;
      }

      await apiPost(`/recurring/${item.id}/post`, {});
      setMessage(t("recurringPosted"), "success");
      refreshAll();
    } catch (err) {
      setMessage(err.message || "Recurring post failed", "error");
    }
  }

  function openRecurringEdit(item) {
    if (!["ACTIVE", "PAUSED"].includes(item.status)) {
      setMessage(t("onlyActivePausedRecurringEdit"), "error");
      return;
    }

    setRecurringEditModal({
      open: true,
      item,
      title: item.title || "",
      amount: item.amount || "",
      frequency: item.frequency || "MONTHLY",
      end_date: item.end_date || "",
      description: item.description || "",
    });
  }

  function closeRecurringEdit() {
    setRecurringEditModal({
      open: false,
      item: null,
      title: "",
      amount: "",
      frequency: "MONTHLY",
      end_date: "",
      description: "",
    });
  }

  async function saveRecurringEdit() {
    if (!recurringEditModal.item) return;

    if (!recurringEditModal.title.trim()) {
      setMessage(t("recurringTitleRequired"), "error");
      return;
    }

    if (!recurringEditModal.amount || Number(recurringEditModal.amount) <= 0) {
      setMessage(t("validRecurringAmountRequired"), "error");
      return;
    }

    const payload = {
      family_id: activeFamilyId,
      title: recurringEditModal.title.trim(),
      amount: recurringEditModal.amount,
      frequency: recurringEditModal.frequency,
      end_date: recurringEditModal.end_date || null,
      description: recurringEditModal.description,
    };

    try {
      if (isCloudLocalMode()) {
        const cached = await loadOfflineSnapshot(activeFamilyId, "finance", "recurring").catch(() => null);
        const existing = Array.isArray(cached?.data) ? cached.data : recurringItems;
        const next = existing.map((row) =>
          String(row.id) === String(recurringEditModal.item.id)
            ? {
                ...row,
                title: payload.title,
                amount: Number(payload.amount),
                frequency: payload.frequency || row.frequency,
                end_date: payload.end_date,
                description: payload.description || "",
                updated_at: new Date().toISOString(),
              }
            : row,
        );
        setRecurringItems(next);
        await saveOfflineSnapshot(activeFamilyId, "finance", "recurring", next);
        closeRecurringEdit();
        if (isBrowserOnline() && canSyncCloudFinance(firebaseUser)) {
          await syncCloudAfterWrite();
        }
        setMessage(t("recurringUpdated"), "success");
        return;
      }

      await apiPatch(`/recurring/${recurringEditModal.item.id}`, payload);

      closeRecurringEdit();
      setMessage(t("recurringUpdated"), "success");
      refreshAll();
    } catch (err) {
      setMessage(err.message || "Recurring update failed", "error");
    }
  }

  async function pauseRecurring(item) {
    const ok = window.confirm(t("confirmPauseRecurring") || `Pause recurring "${item.title}"?`);
    if (!ok) return;

    const payload = { family_id: activeFamilyId, entity_id: item.id, id: item.id };
    try {
      if (isCloudLocalMode()) {
        const cached = await loadOfflineSnapshot(activeFamilyId, "finance", "recurring").catch(() => null);
        const existing = Array.isArray(cached?.data) ? cached.data : recurringItems;
        const next = existing.map((row) =>
          String(row.id) === String(item.id)
            ? { ...row, status: "PAUSED", updated_at: new Date().toISOString() }
            : row,
        );
        setRecurringItems(next);
        await saveOfflineSnapshot(activeFamilyId, "finance", "recurring", next);
        if (isBrowserOnline() && canSyncCloudFinance(firebaseUser)) {
          await syncCloudAfterWrite();
        }
        setMessage(t("recurringPaused"), "success");
        return;
      }

      if (!isBrowserOnline()) {
        await enqueueOutboxChange({
          familyId: activeFamilyId,
          entity_type: "recurring_transactions",
          operation: "PAUSE",
          entity_id: item.id,
          payload,
        });
        setRecurringItems((prev) =>
          (prev || []).map((row) => (row.id === item.id ? { ...row, status: "PAUSED" } : row)),
        );
        setMessage(t("syncQueuedOffline"), "success");
        await refreshLocalOutboxCount();
        return;
      }
      await apiPost(`/recurring/${item.id}/pause`, { family_id: activeFamilyId });
      setMessage(t("recurringPaused"), "success");
      refreshAll();
    } catch (err) {
      const msg = String(err.message || "");
      if (/failed to fetch|network|offline/i.test(msg)) {
        await enqueueOutboxChange({
          familyId: activeFamilyId,
          entity_type: "recurring_transactions",
          operation: "PAUSE",
          entity_id: item.id,
          payload,
        });
        setMessage(t("syncQueuedOffline"), "success");
        await refreshLocalOutboxCount();
        return;
      }
      setMessage(err.message || "Recurring pause failed", "error");
    }
  }

  async function resumeRecurring(item) {
    const ok = window.confirm(t("confirmResumeRecurring") || `Resume recurring "${item.title}"?`);
    if (!ok) return;

    const payload = { family_id: activeFamilyId, entity_id: item.id, id: item.id };
    try {
      if (isCloudLocalMode()) {
        const cached = await loadOfflineSnapshot(activeFamilyId, "finance", "recurring").catch(() => null);
        const existing = Array.isArray(cached?.data) ? cached.data : recurringItems;
        const next = existing.map((row) =>
          String(row.id) === String(item.id)
            ? { ...row, status: "ACTIVE", updated_at: new Date().toISOString() }
            : row,
        );
        setRecurringItems(next);
        await saveOfflineSnapshot(activeFamilyId, "finance", "recurring", next);
        if (isBrowserOnline() && canSyncCloudFinance(firebaseUser)) {
          await syncCloudAfterWrite();
        }
        setMessage(t("recurringResumed"), "success");
        return;
      }

      if (!isBrowserOnline()) {
        await enqueueOutboxChange({
          familyId: activeFamilyId,
          entity_type: "recurring_transactions",
          operation: "RESUME",
          entity_id: item.id,
          payload,
        });
        setRecurringItems((prev) =>
          (prev || []).map((row) => (row.id === item.id ? { ...row, status: "ACTIVE" } : row)),
        );
        setMessage(t("syncQueuedOffline"), "success");
        await refreshLocalOutboxCount();
        return;
      }
      await apiPost(`/recurring/${item.id}/resume`, { family_id: activeFamilyId });
      setMessage(t("recurringResumed"), "success");
      refreshAll();
    } catch (err) {
      const msg = String(err.message || "");
      if (/failed to fetch|network|offline/i.test(msg)) {
        await enqueueOutboxChange({
          familyId: activeFamilyId,
          entity_type: "recurring_transactions",
          operation: "RESUME",
          entity_id: item.id,
          payload,
        });
        setMessage(t("syncQueuedOffline"), "success");
        await refreshLocalOutboxCount();
        return;
      }
      setMessage(err.message || "Recurring resume failed", "error");
    }
  }

  async function closeRecurring(item) {
    const ok = window.confirm(t("confirmCloseRecurring") || `Close recurring "${item.title}"?`);
    if (!ok) return;

    const payload = { family_id: activeFamilyId, entity_id: item.id, id: item.id };
    try {
      if (isCloudLocalMode()) {
        const cached = await loadOfflineSnapshot(activeFamilyId, "finance", "recurring").catch(() => null);
        const existing = Array.isArray(cached?.data) ? cached.data : recurringItems;
        const next = existing.map((row) =>
          String(row.id) === String(item.id)
            ? { ...row, status: "CLOSED", updated_at: new Date().toISOString() }
            : row,
        );
        setRecurringItems(next);
        await saveOfflineSnapshot(activeFamilyId, "finance", "recurring", next);
        if (isBrowserOnline() && canSyncCloudFinance(firebaseUser)) {
          await syncCloudAfterWrite();
        }
        setMessage(t("recurringClosed"), "success");
        return;
      }

      if (!isBrowserOnline()) {
        await enqueueOutboxChange({
          familyId: activeFamilyId,
          entity_type: "recurring_transactions",
          operation: "CLOSE",
          entity_id: item.id,
          payload,
        });
        setRecurringItems((prev) =>
          (prev || []).map((row) => (row.id === item.id ? { ...row, status: "CLOSED" } : row)),
        );
        setMessage(t("syncQueuedOffline"), "success");
        await refreshLocalOutboxCount();
        return;
      }
      await apiPost(`/recurring/${item.id}/close`, { family_id: activeFamilyId });
      setMessage(t("recurringClosed"), "success");
      refreshAll();
    } catch (err) {
      const msg = String(err.message || "");
      if (/failed to fetch|network|offline/i.test(msg)) {
        await enqueueOutboxChange({
          familyId: activeFamilyId,
          entity_type: "recurring_transactions",
          operation: "CLOSE",
          entity_id: item.id,
          payload,
        });
        setMessage(t("syncQueuedOffline"), "success");
        await refreshLocalOutboxCount();
        return;
      }
      setMessage(err.message || "Recurring close failed", "error");
    }
  }

  async function openRecurringHistory(item) {
    setRecurringHistoryModal({ open: true, loading: true, item, history: [] });

    try {
      if (isCloudLocalMode()) {
        const txCached = await loadOfflineSnapshot(activeFamilyId, "finance", "transactions").catch(() => null);
        const txs = Array.isArray(txCached?.data) ? txCached.data : transactions;
        const history = recurringHistoryFromLedger(item.id, txs);
        setRecurringHistoryModal({
          open: true,
          loading: false,
          item,
          history,
        });
        setMessage(t("recurringHistoryLoaded"), "success");
        return;
      }

      const data = await apiGet(`/recurring/${item.id}/history/${activeFamilyId}`);
      setRecurringHistoryModal({
        open: true,
        loading: false,
        item: data.recurring || item,
        history: data.history || [],
      });
      setMessage(t("recurringHistoryLoaded"), "success");
    } catch (err) {
      setRecurringHistoryModal({ open: true, loading: false, item, history: [] });
      setMessage(err.message || "Recurring history load failed", "error");
    }
  }

  function closeRecurringHistory() {
    setRecurringHistoryModal({ open: false, loading: false, item: null, history: [] });
  }

  function openBudgetEdit(item) {
    if (String(item.status || "").toUpperCase() !== "ACTIVE") {
      setMessage(t("onlyActiveBudgetEdit"), "error");
      return;
    }

    setBudgetEditModal({
      open: true,
      budget: item,
      name: item.name || "",
      budget_amount: item.budget_amount || "",
      note: item.note || "",
      category_id: item.category_id || "",
      period_type: item.period_type || "MONTHLY",
    });
  }

  function closeBudgetEdit() {
    setBudgetEditModal({
      open: false,
      budget: null,
      name: "",
      budget_amount: "",
      note: "",
      category_id: "",
      period_type: "MONTHLY",
    });
  }

  async function saveBudgetEdit() {
    if (!budgetEditModal.budget || budgetBusyId) return;

    if (!budgetEditModal.name.trim() || budgetEditModal.name.trim().length < 2) {
      setMessage(t("budgetNameRequired"), "error");
      return;
    }

    if (!budgetEditModal.budget_amount || Number(budgetEditModal.budget_amount) <= 0) {
      setMessage(t("validBudgetAmountRequired"), "error");
      return;
    }

    if (!budgetEditModal.category_id) {
      setMessage(t("expenseCategoryRequired"), "error");
      return;
    }

    const payload = {
      family_id: activeFamilyId,
      name: budgetEditModal.name.trim(),
      budget_amount: budgetEditModal.budget_amount,
      note: budgetEditModal.note,
      category_id: budgetEditModal.category_id,
      period_type: budgetEditModal.period_type || "MONTHLY",
    };

    try {
      setBudgetBusyId(String(budgetEditModal.budget.id));
      if (isCloudLocalMode()) {
        const cached = await loadOfflineSnapshot(activeFamilyId, "finance", "budgets").catch(() => null);
        const existing = normalizeBudgetsList(cached?.data ?? budgets);
        const dupKey = budgetDuplicateKey({
          category_id: payload.category_id,
          period_type: payload.period_type,
        });
        const dup = existing.find(
          (b) =>
            String(b.id) !== String(budgetEditModal.budget.id) &&
            String(b.status || "").toUpperCase() === "ACTIVE" &&
            budgetDuplicateKey(b) === dupKey,
        );
        if (dup) {
          setMessage(
            t("budgetDuplicateActive") || "An active budget already exists for this category and period",
            "error",
          );
          return;
        }
        const catCached = await loadOfflineSnapshot(activeFamilyId, "finance", "categories").catch(() => null);
        const cats = Array.isArray(catCached?.data) ? catCached.data : categories;
        const cat = cats.find((c) => String(c.id) === String(payload.category_id));
        const nextRaw = persistableBudgets(
          existing.map((b) =>
            String(b.id) === String(budgetEditModal.budget.id)
              ? {
                  ...b,
                  name: payload.name,
                  budget_amount: Number(payload.budget_amount),
                  note: payload.note || "",
                  category_id: payload.category_id,
                  category_name: cat?.name_en || cat?.name || b.category_name || "",
                  period_type: payload.period_type,
                  updated_at: new Date().toISOString(),
                }
              : b,
          ),
        );
        const txCached = await loadOfflineSnapshot(activeFamilyId, "finance", "transactions").catch(() => null);
        const txs = Array.isArray(txCached?.data) ? txCached.data : transactions;
        const next = enrichBudgetsFromLedger(nextRaw, txs, cats);
        setBudgets(next);
        await saveOfflineSnapshot(activeFamilyId, "finance", "budgets", nextRaw);
        if (isBrowserOnline() && canSyncCloudFinance(firebaseUser)) {
          await syncCloudAfterWrite();
        }
        closeBudgetEdit();
        setMessage(t("budgetUpdated"), "success");
        setDashboard(buildDashboardFromCache(await hydrateFamilyFromOfflineCache(activeFamilyId)));
        return;
      }

      if (!isBrowserOnline()) {
        await enqueueOutboxChange({
          familyId: activeFamilyId,
          entity_type: "budgets",
          entity_id: budgetEditModal.budget.id,
          operation: "UPDATE",
          payload,
        });
        closeBudgetEdit();
        setMessage(t("syncQueuedOffline"), "success");
        await refreshLocalOutboxCount();
        return;
      }

      await apiPatch(`/budgets/${budgetEditModal.budget.id}`, payload);

      closeBudgetEdit();
      setMessage(t("budgetUpdated"), "success");
      refreshAll();
    } catch (err) {
      const msg = String(err.message || "");
      if (/failed to fetch|network|offline/i.test(msg)) {
        await enqueueOutboxChange({
          familyId: activeFamilyId,
          entity_type: "budgets",
          entity_id: budgetEditModal.budget.id,
          operation: "UPDATE",
          payload,
        });
        setMessage(t("syncQueuedOffline"), "success");
        await refreshLocalOutboxCount();
        return;
      }
      setMessage(err.message || "Budget update failed", "error");
    } finally {
      setBudgetBusyId("");
    }
  }

  async function closeBudget(item) {
    if (budgetBusyId) return;
    const ok = window.confirm(t("confirmCloseBudget") || `Close budget "${item.name}"?`);
    if (!ok) return;

    try {
      setBudgetBusyId(String(item.id));
      if (isCloudLocalMode()) {
        const cached = await loadOfflineSnapshot(activeFamilyId, "finance", "budgets").catch(() => null);
        const existing = normalizeBudgetsList(cached?.data ?? budgets);
        const nextRaw = persistableBudgets(
          existing.map((b) =>
            String(b.id) === String(item.id)
              ? { ...b, status: "CLOSED", updated_at: new Date().toISOString() }
              : b,
          ),
        );
        const txCached = await loadOfflineSnapshot(activeFamilyId, "finance", "transactions").catch(() => null);
        const catCached = await loadOfflineSnapshot(activeFamilyId, "finance", "categories").catch(() => null);
        const txs = Array.isArray(txCached?.data) ? txCached.data : transactions;
        const cats = Array.isArray(catCached?.data) ? catCached.data : categories;
        const next = enrichBudgetsFromLedger(nextRaw, txs, cats);
        setBudgets(next);
        await saveOfflineSnapshot(activeFamilyId, "finance", "budgets", nextRaw);
        if (isBrowserOnline() && canSyncCloudFinance(firebaseUser)) {
          await syncCloudAfterWrite();
        }
        setMessage(t("budgetClosed"), "success");
        setDashboard(buildDashboardFromCache(await hydrateFamilyFromOfflineCache(activeFamilyId)));
        return;
      }

      if (!isBrowserOnline()) {
        await enqueueOutboxChange({
          familyId: activeFamilyId,
          entity_type: "budgets",
          entity_id: item.id,
          operation: "DELETE",
          payload: { family_id: activeFamilyId, status: "CLOSED" },
        });
        setMessage(t("syncQueuedOffline"), "success");
        await refreshLocalOutboxCount();
        return;
      }

      await apiPost(`/budgets/${item.id}/close`, {
        family_id: activeFamilyId,
        reason: "Closed from frontend",
      });

      setMessage(t("budgetClosed"), "success");
      refreshAll();
    } catch (err) {
      const msg = String(err.message || "");
      if (/failed to fetch|network|offline/i.test(msg)) {
        await enqueueOutboxChange({
          familyId: activeFamilyId,
          entity_type: "budgets",
          entity_id: item.id,
          operation: "DELETE",
          payload: { family_id: activeFamilyId, status: "CLOSED" },
        });
        setMessage(t("syncQueuedOffline"), "success");
        await refreshLocalOutboxCount();
        return;
      }
      setMessage(err.message || "Budget close failed", "error");
    } finally {
      setBudgetBusyId("");
    }
  }

  function openLoanEdit(item) {
    if (item.status !== "ACTIVE") {
      setMessage(t("onlyActiveLoanEdit"), "error");
      return;
    }

    setLoanEditModal({
      open: true,
      loan: item,
      person_name: item.person_name || "",
      note: item.note || "",
    });
  }

  function closeLoanEdit() {
    setLoanEditModal({
      open: false,
      loan: null,
      person_name: "",
      note: "",
    });
  }

  async function saveLoanEdit() {
    if (!loanEditModal.loan) return;

    if (!loanEditModal.person_name.trim()) {
      setMessage(t("personNameRequired"), "error");
      return;
    }

    const payload = {
      family_id: activeFamilyId,
      person_name: loanEditModal.person_name.trim(),
      note: loanEditModal.note,
    };

    try {
      if (isCloudLocalMode()) {
        const loanCached = await loadOfflineSnapshot(activeFamilyId, "finance", "loans").catch(() => null);
        const existing = Array.isArray(loanCached?.data) ? loanCached.data : loans;
        const next = existing.map((loan) =>
          String(loan.id) === String(loanEditModal.loan.id)
            ? {
                ...loan,
                person_name: payload.person_name,
                note: payload.note || "",
                updated_at: new Date().toISOString(),
              }
            : loan,
        );
        setLoans(next);
        await saveOfflineSnapshot(activeFamilyId, "finance", "loans", next);
        closeLoanEdit();
        if (isBrowserOnline() && canSyncCloudFinance(firebaseUser)) {
          await syncCloudAfterWrite();
        }
        setMessage(t("loanUpdated"), "success");
        return;
      }

      if (!isBrowserOnline()) {
        await enqueueOutboxChange({
          familyId: activeFamilyId,
          entity_type: "loans",
          entity_id: loanEditModal.loan.id,
          operation: "UPDATE",
          payload,
        });
        closeLoanEdit();
        setMessage(t("syncQueuedOffline"), "success");
        await refreshLocalOutboxCount();
        return;
      }

      await apiPatch(`/loans/${loanEditModal.loan.id}`, payload);

      closeLoanEdit();
      setMessage(t("loanUpdated"), "success");
      refreshAll();
    } catch (err) {
      const msg = String(err.message || "");
      if (/failed to fetch|network|offline/i.test(msg)) {
        await enqueueOutboxChange({
          familyId: activeFamilyId,
          entity_type: "loans",
          entity_id: loanEditModal.loan.id,
          operation: "UPDATE",
          payload,
        });
        setMessage(t("syncQueuedOffline"), "success");
        await refreshLocalOutboxCount();
        return;
      }
      setMessage(err.message || "Loan update failed", "error");
    }
  }

  async function openLoanHistory(item) {
    setLoanHistoryModal({
      open: true,
      loading: true,
      loan: item,
      history: [],
    });

    try {
      if (isCloudLocalMode()) {
        const txCached = await loadOfflineSnapshot(activeFamilyId, "finance", "transactions").catch(() => null);
        const txs = Array.isArray(txCached?.data) ? txCached.data : transactions;
        const history = loanHistoryFromLedger(item.id, txs);
        setLoanHistoryModal({
          open: true,
          loading: false,
          loan: item,
          history,
        });
        setMessage(t("loanHistoryLoaded"), "success");
        return;
      }

      const data = await apiGet(`/loans/${item.id}/history/${activeFamilyId}`);

      setLoanHistoryModal({
        open: true,
        loading: false,
        loan: data.loan || item,
        history: data.history || [],
      });

      setMessage(t("loanHistoryLoaded"), "success");
    } catch (err) {
      setLoanHistoryModal({
        open: true,
        loading: false,
        loan: item,
        history: [],
      });

      setMessage(err.message || "Loan history load failed", "error");
    }
  }

  function closeLoanHistory() {
    setLoanHistoryModal({
      open: false,
      loading: false,
      loan: null,
      history: [],
    });
  }

  async function closeLoan(item) {
    const remaining = Number(item?.remaining_amount || 0);
    if (remaining > 0.0001) {
      setMessage(t("loanCloseNeedsZero") || "Pay remaining balance before closing this loan", "error");
      return;
    }

    const ok = window.confirm(
      t("confirmCloseLoan") || `Close loan with "${item.person_name}"?`,
    );

    if (!ok) return;

    try {
      if (isCloudLocalMode()) {
        const loanCached = await loadOfflineSnapshot(activeFamilyId, "finance", "loans").catch(() => null);
        const existing = Array.isArray(loanCached?.data) ? loanCached.data : loans;
        const next = existing.map((loan) =>
          String(loan.id) === String(item.id)
            ? { ...loan, status: "CLOSED", updated_at: new Date().toISOString() }
            : loan,
        );
        setLoans(next);
        await saveOfflineSnapshot(activeFamilyId, "finance", "loans", next);
        if (isBrowserOnline() && canSyncCloudFinance(firebaseUser)) {
          await syncCloudAfterWrite();
        }
        setMessage(t("loanClosed"), "success");
        return;
      }

      if (!isBrowserOnline()) {
        await enqueueOutboxChange({
          familyId: activeFamilyId,
          entity_type: "loans",
          entity_id: item.id,
          operation: "DELETE",
          payload: { family_id: activeFamilyId, status: "CLOSED" },
        });
        setMessage(t("syncQueuedOffline"), "success");
        await refreshLocalOutboxCount();
        return;
      }

      await apiPost(`/loans/${item.id}/close`, {
        family_id: activeFamilyId,
        reason: "Closed from frontend",
      });

      setMessage(t("loanClosed"), "success");
      refreshAll();
    } catch (err) {
      setMessage(err.message || "Loan close failed", "error");
    }
  }

  async function editSavingsGoal(item) {
    if (savingsBusyId) return;
    if (String(item.status || "").toUpperCase() !== "ACTIVE") {
      setMessage(t("onlyActiveSavingsEdit") || "Only active savings goals can be edited", "error");
      return;
    }
    const newName = window.prompt(t("savingsName") || "Savings name", item.name);
    if (newName === null) return;

    const cleanedName = newName.trim();
    if (!cleanedName || cleanedName.length < 2) {
      setMessage(t("savingsNameRequired"), "error");
      return;
    }

    const newTarget = window.prompt(t("targetAmount") || "Target amount", item.target_amount);
    if (newTarget === null) return;

    if (!newTarget || Number(newTarget) <= 0) {
      setMessage(t("validTargetAmountRequired"), "error");
      return;
    }

    const newNote = window.prompt(t("note") || "Note", item.note || "");
    if (newNote === null) return;

    const payload = {
      family_id: activeFamilyId,
      name: cleanedName,
      target_amount: newTarget,
      note: newNote,
    };

    try {
      setSavingsBusyId(String(item.id));
      if (isCloudLocalMode()) {
        const cached = await loadOfflineSnapshot(activeFamilyId, "finance", "savings").catch(() => null);
        const existing = normalizeSavingsList(cached?.data ?? savings);
        const txCached = await loadOfflineSnapshot(activeFamilyId, "finance", "transactions").catch(() => null);
        const txs = Array.isArray(txCached?.data) ? txCached.data : transactions;
        const nextRaw = existing.map((g) =>
          String(g.id) === String(item.id)
            ? {
                ...g,
                name: payload.name,
                target_amount: Number(payload.target_amount),
                note: payload.note || "",
                updated_at: new Date().toISOString(),
              }
            : g,
        );
        const next = recomputeSavingsFromLedger(nextRaw, txs);
        setSavings(next);
        await saveOfflineSnapshot(activeFamilyId, "finance", "savings", next);
        if (isBrowserOnline() && canSyncCloudFinance(firebaseUser)) {
          await syncCloudAfterWrite();
        }
        setMessage(t("savingsGoalUpdated"), "success");
        return;
      }

      if (!isBrowserOnline()) {
        await enqueueOutboxChange({
          familyId: activeFamilyId,
          entity_type: "savings_goals",
          entity_id: item.id,
          operation: "UPDATE",
          payload,
        });
        setMessage(t("syncQueuedOffline"), "success");
        await refreshLocalOutboxCount();
        return;
      }

      await apiPatch(`/savings/${item.id}`, payload);
      setMessage(t("savingsGoalUpdated"), "success");
      refreshAll();
    } catch (err) {
      const msg = String(err.message || "");
      if (/failed to fetch|network|offline/i.test(msg)) {
        await enqueueOutboxChange({
          familyId: activeFamilyId,
          entity_type: "savings_goals",
          entity_id: item.id,
          operation: "UPDATE",
          payload,
        });
        setMessage(t("syncQueuedOffline"), "success");
        await refreshLocalOutboxCount();
        return;
      }
      setMessage(err.message || "Savings update failed", "error");
    } finally {
      setSavingsBusyId("");
    }
  }

  async function closeSavingsGoal(item) {
    if (savingsBusyId) return;
    const bal = Number(item.current_amount ?? item.saved_amount ?? 0);
    if (bal > 0.0001) {
      setMessage(
        t("savingsCloseNeedsZero") || "Withdraw remaining balance before closing this savings goal",
        "error",
      );
      return;
    }
    const ok = window.confirm(
      t("confirmCloseSavings") || `Close savings goal "${item.name}"?`,
    );
    if (!ok) return;

    try {
      setSavingsBusyId(String(item.id));
      if (isCloudLocalMode()) {
        const cached = await loadOfflineSnapshot(activeFamilyId, "finance", "savings").catch(() => null);
        const existing = normalizeSavingsList(cached?.data ?? savings);
        const txCached = await loadOfflineSnapshot(activeFamilyId, "finance", "transactions").catch(() => null);
        const txs = Array.isArray(txCached?.data) ? txCached.data : transactions;
        const nextRaw = existing.map((g) =>
          String(g.id) === String(item.id)
            ? { ...g, status: "CLOSED", updated_at: new Date().toISOString() }
            : g,
        );
        const next = recomputeSavingsFromLedger(nextRaw, txs);
        setSavings(next);
        await saveOfflineSnapshot(activeFamilyId, "finance", "savings", next);
        const active = next.filter((g) => String(g.status || "").toUpperCase() === "ACTIVE");
        setSavingsAction((prev) => ({
          ...prev,
          savings_goal_id: active.some((g) => String(g.id) === String(prev.savings_goal_id))
            ? prev.savings_goal_id
            : active[0]?.id || "",
        }));
        if (isBrowserOnline() && canSyncCloudFinance(firebaseUser)) {
          await syncCloudAfterWrite();
        }
        setMessage(t("savingsGoalClosed"), "success");
        return;
      }

      if (!isBrowserOnline()) {
        await enqueueOutboxChange({
          familyId: activeFamilyId,
          entity_type: "savings_goals",
          entity_id: item.id,
          operation: "DELETE",
          payload: { family_id: activeFamilyId, status: "CLOSED" },
        });
        setMessage(t("syncQueuedOffline"), "success");
        await refreshLocalOutboxCount();
        return;
      }

      await apiPost(`/savings/${item.id}/close`, {
        family_id: activeFamilyId,
        reason: "Closed from frontend",
      });
      setMessage(t("savingsGoalClosed"), "success");
      refreshAll();
    } catch (err) {
      setMessage(err.message || "Savings close failed", "error");
    } finally {
      setSavingsBusyId("");
    }
  }

  async function openSavingsHistory(item) {
    setHistoryModal({
      open: true,
      loading: true,
      goal: item,
      history: [],
    });

    try {
      if (isCloudLocalMode()) {
        const txCached = await loadOfflineSnapshot(activeFamilyId, "finance", "transactions").catch(() => null);
        const txs = Array.isArray(txCached?.data) ? txCached.data : transactions;
        const history = txs
          .filter((t) => String(t.savings_goal_id || "") === String(item.id))
          .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
        setHistoryModal({
          open: true,
          loading: false,
          goal: item,
          history,
        });
        setMessage(t("savingsHistoryLoaded") || "Savings history loaded", "success");
        return;
      }

      const data = await apiGet(`/savings/${item.id}/history/${activeFamilyId}`);
      setHistoryModal({
        open: true,
        loading: false,
        goal: data.goal || item,
        history: data.history || [],
      });
      setMessage(t("savingsHistoryLoaded") || "Savings history loaded", "success");
    } catch (err) {
      setHistoryModal({ open: true, loading: false, goal: item, history: [] });
      setMessage(err.message || "Savings history load failed", "error");
    }
  }

  function closeSavingsHistory() {
    setHistoryModal({
      open: false,
      loading: false,
      goal: null,
      history: [],
    });
  }

  async function downloadReport(type, format) {
    const triggerDownload = (blob, fileName) => {
      const fileUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = fileUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(fileUrl);
    };

    try {
      setStatus(`Downloading ${type} ${format}...`);

      if (!isBrowserOnline()) {
        const cached = await getCachedReportExport(activeFamilyId, type, format);
        if (cached?.blob) {
          triggerDownload(cached.blob, cached.fileName);
          setMessage(t("offlineExportOpened"), "success");
          setStatus("");
          return;
        }
        setMessage(t("downloadFailed"), "error");
        setStatus("");
        return;
      }

      // Cloud-local: build real Excel/PDF from IndexedDB — no backend JWT export.
      if (isCloudLocalMode()) {
        const cache = await hydrateFamilyFromOfflineCache(activeFamilyId);
        let payload;
        if (type === "transactions") {
          payload = Array.isArray(cache["finance/transactions"]) ? cache["finance/transactions"] : [];
        } else if (type === "cashflow") {
          payload = Array.isArray(cache["finance/transactions"]) ? cache["finance/transactions"] : [];
        } else if (type === "goals") {
          const goals = Array.isArray(cache["finance/goals"]) ? cache["finance/goals"] : [];
          const savings = Array.isArray(cache["finance/savings"]) ? cache["finance/savings"] : [];
          payload = [
            ...goals.map((g) => ({ kind: "goal", ...g })),
            ...savings.map((g) => ({ kind: "savings", ...g })),
          ];
        } else {
          payload = [];
        }
        const { blob, fileName } = buildReportExportBlob({ type, format, payload });
        try {
          await cacheReportExport(activeFamilyId, type, format, blob);
        } catch {
          /* cache optional */
        }
        triggerDownload(blob, fileName);
        setMessage(t("downloadComplete"), "success");
        return;
      }

      const res = await fetch(
        `${apiBase}/reports/${type}/${activeFamilyId}/export/${format}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (!res.ok) {
        setMessage(t("downloadFailed"), "error");
        return;
      }

      const blob = await res.blob();
      const fileName = `s4_${type}_report.${format === "excel" ? "xlsx" : "pdf"}`;
      try {
        await cacheReportExport(activeFamilyId, type, format, blob);
      } catch {
        /* cache optional */
      }
      triggerDownload(blob, fileName);
      setMessage(t("downloadComplete"), "success");
    } catch {
      try {
        const cached = await getCachedReportExport(activeFamilyId, type, format);
        if (cached?.blob) {
          triggerDownload(cached.blob, cached.fileName);
          setMessage(t("offlineExportOpened"), "success");
          return;
        }
      } catch {
        /* ignore */
      }
      setMessage(t("downloadFailed"), "error");
    } finally {
      setStatus("");
    }
  }

  // Phone ↔ laptop account swap often leaves empty local family_id while Firestore still has it.
  // Retry until family restores — do not lock out after one failed attempt.
  useEffect(() => {
    const uid = firebaseUser?.uid;
    if (!uid || activeFamilyId || sessionBootstrapping || isFamilyLoading) return;
    if (noFamilyAutoRestoreRef.current === `ok:${uid}`) return;
    if (!isBrowserOnline()) return;
    let cancelled = false;
    (async () => {
      try {
        const fid = await restoreFamilyFromCloud(firebaseUser);
        if (cancelled || !fid) return;
        noFamilyAutoRestoreRef.current = `ok:${uid}`;
        setMessage(
          appLanguage === "bn" ? "পরিবার ক্লাউড থেকে পুনরুদ্ধার হয়েছে" : "Family restored from cloud",
          "success",
        );
      } catch (err) {
        if (!cancelled) softFail("Family auto-restore", err);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebaseUser?.uid, activeFamilyId, sessionBootstrapping, isFamilyLoading]);

  useEffect(() => {
    // VPS / API mode — never attach Firebase Auth session bootstrap.
    if (!FIREBASE_CONFIGURED || !FIREBASE_FIRST_MODE) {
      try {
        persistCloudOnlyMode(false);
      } catch {
        /* ignore */
      }
      setCloudOnlyMode(false);
      setSessionBootstrapping(false);
      if (!loadCloudFamilyId() && !token) setIsFamilyLoading(false);
      return undefined;
    }

    let cancelled = false;
    let bootDone = false;
    let safetyTimer = 0;
    const markBootDone = () => {
      if (bootDone || cancelled) return;
      bootDone = true;
      window.clearTimeout(safetyTimer);
      setSessionBootstrapping(false);
      setIsFamilyLoading(false);
      setFamiliesLoading(false);
    };
    // Hard unlock — never leave "Preparing a secure session..." stuck
    safetyTimer = window.setTimeout(() => {
      if (cancelled || bootDone) return;
      softFail(
        "Session bootstrap",
        new Error(t("sessionBootstrapTimeout") || "Timed out — check internet, then Refresh or Create/Join family."),
      );
      bootDone = true;
      setSessionBootstrapping(false);
      setIsFamilyLoading(false);
      setFamiliesLoading(false);
      // Keep any local family id so dashboard can open offline
      const localId = loadCloudFamilyId();
      if (localId) {
        setActiveFamilyId((cur) => cur || localId);
        setCloudOnlyMode(true);
        persistCloudOnlyMode(true);
      }
    }, 8000);

    // Unlock UI immediately from localStorage before any Firestore wait
    const cachedFamilyId = loadCloudFamilyId();
    if (cachedFamilyId) {
      setActiveFamilyId(cachedFamilyId);
      setCloudOnlyMode(true);
      persistCloudOnlyMode(true);
      setFamilies((prev) =>
        (prev || []).some((f) => f.id === cachedFamilyId)
          ? prev
          : [{ id: cachedFamilyId, name: t("cloudOnlyFamilyLabel") }, ...(prev || [])],
      );
      setIsFamilyLoading(false);
      setSessionBootstrapping(false);
    }

    const unsub = subscribeFirebaseAuth(async (user) => {
      setFirebaseUser(user);

      if (!user) {
        setFirebaseMeta(null);
        if (!cancelled) {
          markBootDone();
        }
        return;
      }

      try {
        await Promise.race([
          ensureUserProfile(user.uid, user),
          new Promise((resolve) => {
            window.setTimeout(resolve, 3000);
          }),
        ]);
        await Promise.race([
          refreshFirebaseMeta(user.uid),
          new Promise((resolve) => {
            window.setTimeout(resolve, 3000);
          }),
        ]);
      } catch {
        /* ignore profile/meta errors on subscribe */
      }

      const expectCloudSession =
        loadCloudOnlyMode() || Boolean(loadCloudFamilyId()) || (FIREBASE_FIRST_MODE && !token);

      if (!expectCloudSession) {
        if (!cancelled) {
          markBootDone();
        }
        return;
      }

      if (!cancelled) {
        setCloudOnlyMode(true);
        persistCloudOnlyMode(true);
      }

      try {
        // Always resolve from Firestore profile first — localStorage can be empty/stale
        // after swapping accounts across phone ↔ laptop.
        let familyId = "";
        try {
          familyId = await Promise.race([
            resolveCloudFamilyId(user.uid, user),
            new Promise((resolve) => {
              window.setTimeout(() => resolve(loadCloudFamilyId() || ""), 8000);
            }),
          ]);
        } catch {
          familyId = loadCloudFamilyId() || "";
        }

        if (familyId && !cancelled) {
          setActiveFamilyId(familyId);
          persistCloudFamilyId(familyId);
          setIsFamilyLoading(false);
          setSessionBootstrapping(false);
        }

        if (!familyId) {
          /* keep empty — no-family UI + auto-restore effect will retry */
        } else if (canSyncCloudFinance(user) && isBrowserOnline()) {
          try {
            const restored = await Promise.race([
              pullCloudSnapshot(user.uid),
              new Promise((resolve) => {
                window.setTimeout(() => resolve(null), 5000);
              }),
            ]);
            if (restored?.familyId) familyId = restored.familyId;
          } catch (err) {
            softFail("Bootstrap pull", err);
          }
        }
        if (!familyId) familyId = loadCloudFamilyId();

        if (familyId && !cancelled) {
          void activateCloudSession(user, familyId).catch((err) => {
            softFail("Session restore", err);
            markBootDone();
          });
          markBootDone();
        } else if (!cancelled) {
          setCurrentUser({
            full_name: user.displayName || user.email || "Cloud User",
            email: user.email || "",
            is_email_verified: isFirebaseEmailVerified(user),
            is_active: true,
            uid: user.uid,
            firebase_uid: user.uid,
          });
          await applyCloudUserAvatar(user);
          markBootDone();
        }
      } catch (err) {
        softFail("Session restore", err);
        const storedId = loadCloudFamilyId();
        if (storedId && !cancelled) {
          try {
            persistCloudOnlyMode(true);
            setCloudOnlyMode(true);
            setActiveFamilyId(storedId);
            setFamilies([{ id: storedId, name: t("cloudOnlyFamilyLabel") }]);
          } catch {
            /* ignore */
          }
        }
        if (!cancelled) markBootDone();
      }
    });

    return () => {
      cancelled = true;
      window.clearTimeout(safetyTimer);
      try {
        unsub?.();
      } catch {
        /* ignore */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (driveConnected) {
      refreshDriveFileList();
    }
  }, [driveConnected]);

  useEffect(() => {
    if (cloudOnlyMode && firebaseUser?.uid && !cloudAutoSyncRef.current.enabled) {
      enableCloudAutoSyncDefaults();
    }
  }, [cloudOnlyMode, firebaseUser?.uid]);

  useEffect(() => {
    if (!cloudOnlyMode || token || !activeFamilyId) return undefined;

    const timeoutId = window.setTimeout(() => {
      refreshCloudLocalAll();
    }, 0);

    return () => window.clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudOnlyMode, token, activeFamilyId]);

  useEffect(() => {
    if (!cloudOnlyMode || !firebaseUser?.uid || !activeFamilyId) return undefined;
    if (!canSyncCloudFinance(firebaseUser)) return undefined;

    const syncWhenOnline = () => {
      void syncCloudLocalBidirectional();
      runCloudAutoBackup({ force: true });
    };

    window.addEventListener("online", syncWhenOnline);
    return () => window.removeEventListener("online", syncWhenOnline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudOnlyMode, firebaseUser?.uid, firebaseUser?.emailVerified, activeFamilyId]);

  useEffect(() => {
    // Cloud-only: periodically push snapshot while online (mirrors backend outbox auto-sync).
    if (!isCloudLocalMode() || !firebaseUser?.uid || !canSyncCloudFinance(firebaseUser)) return undefined;
    if (!autoSyncEnabled) return undefined;

    const run = () => {
      if (!isBrowserOnline() || syncPushLoading) return;
      void syncCloudLocalBidirectional().then(() => {
        pushLocalSyncOutbox({ silent: true, automatic: true });
      });
    };

    const intervalId = window.setInterval(run, AUTO_SYNC_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") run();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudOnlyMode, token, activeFamilyId, firebaseUser?.uid, firebaseUser?.emailVerified, autoSyncEnabled, syncPushLoading, browserOnline]);

  useEffect(() => {
    try {
      setNotifyPermission(getNotificationPermission());
    } catch (err) {
      console.warn("[S4 Notify] permission read failed", err);
    }
    if (!isAppAuthed || !activeFamilyId) return undefined;
    let unsub = () => {};
    try {
      unsub = subscribeForegroundMessages((payload) => {
        const title = payload?.notification?.title || payload?.data?.title || "S4 Family Finance 143";
        setMessage(title, "success");
        loadNotifications().catch((e) => console.error("[S4 Notify] refresh after push failed", e));
      });
    } catch (err) {
      console.error("[S4 Notify] subscribeForegroundMessages failed", err);
    }
    return () => {
      try {
        unsub();
      } catch {
        /* ignore */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAppAuthed, activeFamilyId, firebaseUser?.uid]);

  useEffect(() => {
    if (!isAppAuthed || !activeFamilyId) return;
    const timeoutId = window.setTimeout(() => {
      loadNotifications().catch((e) => console.error("[S4 Notify] loadNotifications failed", e));
      // Soft: if already granted, refresh FCM token silently; do not prompt automatically.
      try {
        if (getNotificationPermission() === "granted") {
          enableBrowserPushNotifications({ silent: true }).catch((e) =>
            console.warn("[S4 Notify] silent enable failed", e)
          );
        }
      } catch (err) {
        console.warn("[S4 Notify] silent enable skipped", err);
      }
    }, 400);
    return () => window.clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAppAuthed, activeFamilyId, firebaseUser?.uid]);

  useEffect(() => {
    if (!authRestoring) return undefined;
    let cancelled = false;

    (async () => {
      try {
        const result = await restoreAuthSession(apiBase);
        if (cancelled) return;
        if (result.ok) {
          setToken(result.accessToken);
          setRefreshToken(result.refreshToken || "");
          if (result.user) setCurrentUser(result.user);
        }
      } finally {
        if (!cancelled) setAuthRestoring(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [apiBase, authRestoring]);

  useEffect(() => {
    if (!token) return;
    persistAuthSession({ accessToken: token, refreshToken, user: currentUser, apiBase });
  }, [token, refreshToken, currentUser, apiBase]);

  useEffect(() => {
    function onVisibility() {
      if (token) touchAuthSessionActivity();
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [token]);

  useEffect(() => {
    if (!token) return;

    setIsFamilyLoading(true);
    const timeoutId = window.setTimeout(() => {
      loadProfile();
      loadFamilies();
    }, 0);

    return () => window.clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!token || !activeFamilyId) return;
    if (!familiesReady || familiesLoading || isFamilyLoading) return;

    const timeoutId = window.setTimeout(() => {
      refreshAll();
    }, 0);

    return () => window.clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, activeFamilyId, familiesReady, familiesLoading, isFamilyLoading]);

  useEffect(() => {
    if (!isCloudLocalMode() || !activeFamilyId) return;
    const timeoutId = window.setTimeout(() => {
      loadSettingsData();
      loadFamilyGovernance();
    }, 0);
    return () => window.clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudOnlyMode, activeFamilyId, firebaseUser?.uid]);

  // Auto-fetch Family Governance + Permissions when those screens open
  // (wait until activeFamilyId is ready so the query does not fail silently).
  useEffect(() => {
    if (!activeFamilyId) return;
    if (!token && !isCloudLocalMode()) return;

    const onFamily = activeMenu === "family";
    const onDashboard = activeMenu === "dashboard";
    const onSettings = isSettingsMenu(activeMenu);
    if (!onFamily && !onSettings && !onDashboard) return;

    const timeoutId = window.setTimeout(() => {
      if (onFamily || onDashboard) {
        loadFamilyGovernance();
        // Role chips on Family/Dashboard use myPermissions
        loadSettingsData();
      }
      if (onSettings) {
        loadSettingsData();
        // Member list for Permissions tab overlaps governance data
        if (settingsTab === "permissions" || parseSettingsTab(activeMenu) === "permissions") {
          loadFamilyGovernance();
        }
        if (settingsTab === "categories" || parseSettingsTab(activeMenu) === "categories") {
          loadCategories();
        }
      }
    }, 0);

    return () => window.clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMenu, settingsTab, activeFamilyId, token, cloudOnlyMode, firebaseUser?.uid]);

  const activeFamily = families.find((family) => family.id === activeFamilyId);
  const effectivePermissions = myPermissions?.effective_permissions || [];
  const permissionOverrides = myPermissions?.overrides || [];
  const currentLanguage =
    LOCKED_LANGUAGES.find((language) => language.code === appLanguage) || LOCKED_LANGUAGES[0];

  useEffect(() => {
    document.documentElement.lang = currentLanguage.code;
    document.documentElement.dir = currentLanguage.dir;
  }, [currentLanguage.code, currentLanguage.dir]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setFamilyCurrencyForm(activeFamily?.default_currency || "");
      setFamilyTimezoneForm(activeFamily?.timezone || "");
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [activeFamily?.default_currency, activeFamily?.timezone]);

  useEffect(() => {
    cloudAutoSyncRef.current = cloudAutoSync;
  }, [cloudAutoSync]);

  // If Drive token still valid this session, sync once after family is known.
  useEffect(() => {
    if (!DRIVE_CONFIGURED || !getStoredDriveToken()) return undefined;
    if (driveConnectSyncOnceRef.current) return undefined;
    if (cloudBusy) return undefined;
    driveConnectSyncOnceRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        if (cancelled) return;
        setDriveConnected(true);
        await maybeSyncDriveAfterConnect({ quiet: true, allowConflictPrompt: false });
      } catch {
        driveConnectSyncOnceRef.current = false;
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFamilyId, token, firebaseUser?.uid]);

  useEffect(() => {
    const settingsTabKey = parseSettingsTab(activeMenu);
    if (settingsTabKey && ["profile", "family", "permissions", "security", "cloud", "categories"].includes(settingsTabKey)) {
      setSettingsTab(settingsTabKey);
    }
    const tab15 = parsePhaseTab(activeMenu, "phase15");
    if (tab15) {
      setPhase15ActiveTab(tab15);
      setEditingPhase15Id("");
      setPhase15Form({ ...EMPTY_PHASE15_FORM, module_type: tab15 });
    }
    const tab16 = parsePhaseTab(activeMenu, "phase16");
    if (tab16) {
      setPhase16ActiveTab(tab16);
      setEditingPhase16Id("");
      setPhase16Form({ ...EMPTY_PHASE16_FORM, module_type: tab16 });
    }
  }, [activeMenu]);

  useEffect(() => {
    if (!cloudAutoSync.enabled || !activeFamilyId) return undefined;

    const tick = () => {
      if (document.visibilityState !== "visible") return;
      runCloudAutoBackup();
    };

    const intervalId = window.setInterval(tick, Math.min(intervalMs(cloudAutoSync), 60_000));
    tick();
    return () => window.clearInterval(intervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudAutoSync.enabled, cloudAutoSync.intervalMinutes, activeFamilyId, firebaseUser?.uid, driveConnected]);

  useEffect(() => {
    if (!activeFamilyId || activeMenu !== "savings") return;
    const timeoutId = window.setTimeout(() => {
      void (async () => {
        await loadWallets();
        await loadSavings();
      })();
    }, 0);
    return () => window.clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFamilyId, activeMenu, cloudOnlyMode, token]);

  useEffect(() => {
    if (!activeFamilyId || activeMenu !== "budgets") return;
    const timeoutId = window.setTimeout(() => {
      void (async () => {
        await loadCategories();
        await loadBudgets();
      })();
    }, 0);
    return () => window.clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFamilyId, activeMenu, cloudOnlyMode, token]);

  useEffect(() => {
    if (!activeFamilyId || activeMenu !== "grocery") return;
    if (!token && !isCloudLocalMode()) return;
    const timeoutId = window.setTimeout(() => {
      void (async () => {
        const walletRows = (await loadWallets()) || [];
        const categoryRows = (await loadCategories()) || [];
        await loadGrocery({ silent: true, walletRows, categoryRows });
        await refreshLocalOutboxCount();
      })();
    }, 0);
    return () => window.clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFamilyId, activeMenu, cloudOnlyMode, token, firebaseUser?.uid]);

  useEffect(() => {
    if (!activeFamilyId || !isPhase15Menu(activeMenu)) return;
    if (!token && !isCloudLocalMode()) return;
    const timeoutId = window.setTimeout(() => {
      void (async () => {
        await loadFamilyGovernance();
        await loadPhase15();
      })();
    }, 0);
    return () => window.clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFamilyId, activeMenu, cloudOnlyMode, token, firebaseUser?.uid]);

  useEffect(() => {
    if (!activeFamilyId || activeMenu !== "zakat") return;
    if (!token && !isCloudLocalMode()) return;
    const timeoutId = window.setTimeout(() => {
      void (async () => {
        await loadMetalRates();
        await loadZakat();
      })();
    }, 0);
    return () => window.clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFamilyId, activeMenu, cloudOnlyMode, token, firebaseUser?.uid]);

  useEffect(() => {
    if (!activeFamilyId || !isPhase16Menu(activeMenu)) return;
    if (!token && !isCloudLocalMode()) return;
    const timeoutId = window.setTimeout(() => {
      void (async () => {
        await loadWallets();
        await loadFamilyGovernance();
        await loadPhase16();
      })();
    }, 0);
    return () => window.clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFamilyId, activeMenu, cloudOnlyMode, token, firebaseUser?.uid]);

  useEffect(() => {
    if (!activeFamilyId || activeMenu !== "grocery") return undefined;
    if (!isCloudLocalMode()) return undefined;
    // Cloud-local: poll for multi-device freshness (no grocery WebSocket).
    setGroceryWsState("off");
    const intervalId = window.setInterval(() => {
      loadGrocery({ silent: true });
    }, 20000);
    return () => window.clearInterval(intervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFamilyId, activeMenu, cloudOnlyMode]);

  useEffect(() => {
    if (!activeFamilyId || activeMenu !== "sync") return;
    if (!token && !isCloudLocalMode()) return;
    const timeoutId = window.setTimeout(() => {
      loadSyncStatus();
    }, 0);
    return () => window.clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, activeFamilyId, activeMenu, cloudOnlyMode, firebaseUser?.uid]);

  useEffect(() => {
    if (!activeFamilyId) return;
    if (!token && !isCloudLocalMode()) return;
    const menuLoaders = {
      reports: () => loadReports(),
      currency: () => loadCurrencyData(),
      audit: () => loadAuditTrail(),
      backup: () => loadBackups(),
      notifications: () => loadNotifications(),
    };
    const loader = menuLoaders[activeMenu];
    if (!loader) return undefined;
    const timeoutId = window.setTimeout(() => {
      void loader();
    }, 0);
    return () => window.clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFamilyId, activeMenu, cloudOnlyMode, token, firebaseUser?.uid]);

  useEffect(() => {
    if (!activeFamilyId || !autoSyncEnabled) return undefined;
    if (!token && !isCloudLocalMode()) return undefined;

    const runAutoSync = () => {
      if (!isBrowserOnline() || syncPushLoading) return;
      if (isCloudLocalMode()) {
        if (!firebaseUser?.uid || !isCloudEmailReady(firebaseUser)) return;
        pushLocalSyncOutbox({ silent: true, automatic: true });
        return;
      }
      if (localOutboxPending <= 0) return;
      pushLocalSyncOutbox({ silent: true, automatic: true });
    };

    const intervalId = window.setInterval(runAutoSync, AUTO_SYNC_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") runAutoSync();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    token,
    activeFamilyId,
    autoSyncEnabled,
    localOutboxPending,
    syncPushLoading,
    browserOnline,
    cloudOnlyMode,
    firebaseUser?.uid,
  ]);

  useEffect(() => {
    if (!token || !activeFamilyId || activeMenu !== "grocery") return undefined;
    const timeoutId = window.setTimeout(() => {
      refreshLocalOutboxCount();
    }, 0);
    return () => window.clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, activeFamilyId, activeMenu]);

  useEffect(() => {
    function onOnline() {
      setBrowserOnline(true);
      if (isCloudLocalMode() && firebaseUser?.uid && activeFamilyId && isCloudEmailReady(firebaseUser)) {
        pushLocalSyncOutbox({ silent: true, automatic: true }).catch(() => {});
        flushPendingUploads({
          familyId: activeFamilyId,
          uploadFn: async (itemId, file) => {
            if (String(itemId).startsWith("web-p16-")) return { skipped: true };
            const result = await uploadFamilyDocument({
              familyId: activeFamilyId,
              itemId,
              file,
              uid: firebaseUser.uid,
            });
            await persistDocumentFileMeta(itemId, result);
          },
        })
          .then((stats) => {
            if (stats?.synced) loadPhase16().catch(() => {});
          })
          .catch(() => {});
        return;
      }
      if (token && activeFamilyId) {
        flushLocalOutbox({ familyId: activeFamilyId, deviceId: SYNC_DEVICE_ID, apiPost })
          .then(() =>
            flushPendingUploads({
              familyId: activeFamilyId,
              uploadFn: async (itemId, file) => {
                // Real server ids only — keep temp ids queued (do not drop blob)
                if (String(itemId).startsWith("web-p16-")) return { skipped: true };
                const formData = new FormData();
                formData.append("family_id", activeFamilyId);
                formData.append("file", file);
                const res = await fetch(`${apiBase}${documentUploadPath(itemId)}`, {
                  method: "POST",
                  headers: { Authorization: `Bearer ${token}` },
                  body: formData,
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.detail || "upload failed");
                if (data && (data.file_url || data.download_url || data.file_name || data.storage_path)) {
                  await persistDocumentFileMeta(itemId, data);
                }
              },
            })
          )
          .then(() => {
            refreshLocalOutboxCount();
            loadSyncStatus();
            loadPhase16().catch(() => {});
          })
          .catch(() => {});
      }
    }
    function onOffline() {
      setBrowserOnline(false);
    }
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    setBrowserOnline(isBrowserOnline());
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, activeFamilyId]);

  useEffect(() => {
    if (!token || !activeFamilyId || activeMenu !== "grocery") {
      setGroceryWsState("off");
      return undefined;
    }

    let alive = true;
    setGroceryWsState("connecting");
    const wsBase = apiBase.replace(/^http/i, "ws");
    const ws = new WebSocket(`${wsBase}/grocery/ws/${activeFamilyId}?token=${encodeURIComponent(token)}`);

    ws.onopen = () => {
      if (alive) setGroceryWsState("connected");
    };
    ws.onmessage = (event) => {
      if (!alive) return;
      try {
        const data = JSON.parse(event.data);
        if (data?.type === "grocery.changed") {
          loadGrocery({ silent: true });
        }
      } catch {
        // ignore malformed frames
      }
    };
    ws.onerror = () => {
      if (alive) setGroceryWsState("error");
    };
    ws.onclose = () => {
      if (alive) setGroceryWsState("disconnected");
    };

    // Polling fallback (slower safety net; WS drives instant refresh)
    const intervalId = window.setInterval(() => {
      loadGrocery({ silent: true });
    }, 15000);

    return () => {
      alive = false;
      window.clearInterval(intervalId);
      try {
        ws.close();
      } catch {
        // ignore
      }
      setGroceryWsState("off");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, activeFamilyId, activeMenu]);

  const mobileNavItems = [
    ["dashboard", appLanguage === "bn" ? "হোম" : "Home", "⌂"],
    ["transactions", appLanguage === "bn" ? "লেনদেন" : "Transactions", "↕"],
    ["__add__", "", "＋"],
    ["budgets", appLanguage === "bn" ? "বাজেট" : "Budget", "▥"],
    ["family", appLanguage === "bn" ? "পরিবার" : "Family", "☷"],
  ];

  // [menu, icon, label] — slim IA (no duplicate income/expense/transfer rows)
  const navGroups = [
    {
      label: t("navOverview"),
      items: [["dashboard", "⌂", t("dashboard")]],
    },
    {
      label: t("navFinance"),
      items: [
        ["wallets", "◇", t("navWalletAccount")],
        ["transactions", "↕", t("navAllTransactions")],
        ["budgets", "◷", t("budgets")],
        ["savings", "◎", t("navSavingsGoals")],
        ["loans", "⇄", t("navLoanDebt")],
        ["goals", "★", t("goals")],
        ["recurring", "↻", t("recurring")],
        ["tags", "#", t("tags") || "Tags"],
        ["cutover", "✦", t("cutover")],
      ],
    },
    {
      label: t("navFamilyGov"),
      items: [
        ["family", "◎", t("family")],
        ["settings:permissions", "▣", t("navRolesPermissions")],
      ],
    },
    {
      label: t("navDailyLife"),
      items: [
        ["planner", "☰", t("planner")],
        ["grocery", "▤", t("groceryTitle")],
        ["phase15:HEALTH", "✚", t("navHealthExpense")],
        ["phase15:VEHICLE", "▣", t("navVehicle")],
        ["phase16:SUBSCRIPTION", "↻", t("navSubscriptions")],
      ],
    },
    {
      label: t("navAssetsPlanning"),
      items: [
        ["phase15:INVESTMENT", "◈", t("navInvestments")],
        ["phase15:EDUCATION", "▦", t("navEducationFund")],
        ["phase16:PROPERTY", "⌂", t("navProperty")],
        ["zakat", "✦", t("navZakat")],
        ["phase16:DOCUMENT", "▦", t("navDocumentVault")],
      ],
    },
    {
      label: t("navSystem"),
      items: [
        ["reports", "▦", t("navReportsAnalytics")],
        ["currency", "¤", t("currencyCenter")],
        ["notifications", "◉", t("notifications")],
        ["audit", "☰", t("navAuditLogs")],
        ["backup", "☁", t("backupCenter")],
        ["sync", "⟳", t("offlineSync")],
        ["settings", "⚙", t("settings")],
      ],
    },
  ];

  const navItems = navGroups.flatMap((group) => group.items);

  // 1) Branded splash only (0→100). Do not chain another full-screen wait after it.
  if (showSplash) {
    return (
      <SplashScreen
        brandTitle={digits("S4 FAMILY FINANCE 143")}
        hint={t("splashHint")}
        onDone={finishSplash}
      />
    );
  }

  // 2) Brief gate only when we still have no family id to restore into.
  // If localStorage already has activeFamilyId, enter the app immediately.
  if (sessionBootstrapping && !activeFamilyId && !token) {
    return (
      <main className="splash-root" lang={currentLanguage.code} dir={currentLanguage.dir}>
        <div className="auth-loading-overlay" role="status" aria-live="polite">
          <div className="auth-loading-card">
            <div className="auth-spinner" aria-hidden="true" />
            <h2>{t("authLoadingTitle")}</h2>
            <p>{t("authLoadingHint") || t("splashHint")}</p>
          </div>
        </div>
      </main>
    );
  }

  if (authRestoring) {
    return (
      <main className="splash-root" lang={currentLanguage.code} dir={currentLanguage.dir}>
        <div className="auth-loading-overlay" role="status" aria-live="polite">
          <div className="auth-loading-card">
            <div className="auth-spinner" aria-hidden="true" />
            <h2>{t("authLoadingTitle")}</h2>
            <p>{t("authLoadingHint") || t("splashHint")}</p>
          </div>
        </div>
      </main>
    );
  }

  if (!isAppAuthed) {
    return (
      <main className="splash-root" lang={currentLanguage.code} dir={currentLanguage.dir}>
        {toast && (
          <div className={`toast toast-${toast.type}`}>{toast.message}</div>
        )}

        {authLoading && (
          <div className="auth-loading-overlay" role="status" aria-live="polite">
            <div className="auth-loading-card">
              <div className="auth-spinner" aria-hidden="true" />
              <h2>{t("authLoadingTitle")}</h2>
              <p>{status || t("authLoadingHint")}</p>
            </div>
          </div>
        )}

        <FamilyAuthGate
          t={t}
          digits={digits}
          appLanguage={appLanguage}
          lockedLanguages={LOCKED_LANGUAGES}
          languageLabels={LANGUAGE_LABELS}
          onChangeLanguage={changeAppLanguage}
          authLoading={authLoading}
          setAuthLoading={setAuthLoading}
          status={status}
          setStatus={setStatus}
          setMessage={setMessage}
          apiBase={apiBase}
          onAuthenticated={(access, refresh, user) => {
            setToken(access);
            setRefreshToken(refresh || "");
            persistAuthSession({
              accessToken: access,
              refreshToken: refresh || "",
              user: user || null,
              apiBase,
            });
            if (user) setCurrentUser(user);
          }}
        />
      </main>
    );
  }

  const needsEmailVerification =
    REQUIRE_EMAIL_VERIFICATION &&
    cloudOnlyMode &&
    Boolean(firebaseUser?.uid) &&
    !isCloudEmailReady(firebaseUser);

  if (needsEmailVerification) {
    return (
      <div lang={currentLanguage.code} dir={currentLanguage.dir}>
        {toast && <div className={`toast toast-${toast.type}`}>{toast.message}</div>}
        <EmailVerificationGate
          t={t}
          email={firebaseUser?.email || currentUser?.email || ""}
          uid={firebaseUser?.uid || ""}
          busy={securityAction === "verification" || cloudBusy}
          statusMessage={toast?.message || status || ""}
          statusType={toast?.type || (status ? "info" : "")}
          onResend={resendVerification}
          onRefresh={handleVerifyEmailRefresh}
          onSignOut={handleVerifyEmailSignOut}
        />
      </div>
    );
  }

  return (
    <div className="app-layout s4-shell shoyb-shell" lang={currentLanguage.code} dir={currentLanguage.dir}>
      {showBackupOnboarding && cloudOnlyMode && firebaseUser?.uid ? (
        <CloudBackupOnboarding
          t={t}
          lang={appLanguage === "en" ? "en" : "bn"}
          cloudBusy={cloudBusy}
          driveConfigured={DRIVE_CONFIGURED}
          driveConnected={driveConnected}
          localFolderSupported={LOCAL_FOLDER_SUPPORTED}
          localFolderLabel={localFolderLabel}
          onDriveConnect={handleOnboardingDriveConnect}
          onPickLocalFolder={handleOnboardingPickFolder}
          onLocalDownload={handleLocalDownload}
          onSkip={() => finishBackupOnboarding(true)}
          onContinue={() => finishBackupOnboarding(false)}
        />
      ) : null}
      {cloudOnlyMode && !isNativeApp() ? (
        <div className="cloud-only-banner" role="status">
          {t("cloudOnlyBanner")}
        </div>
      ) : null}
      {goalEditModal.open && (
        <div className="modal-overlay">
          <div className="modal-card">
            <h3>{t("edit")} {t("goals")}</h3>

            <input
              placeholder={t("goalName")}
              value={goalEditModal.goal_name}
              onChange={(e) =>
                setGoalEditModal({
                  ...goalEditModal,
                  goal_name: e.target.value,
                })
              }
            />

            <input
              placeholder={t("goalType")}
              value={goalEditModal.goal_type}
              onChange={(e) =>
                setGoalEditModal({
                  ...goalEditModal,
                  goal_type: e.target.value,
                })
              }
            />

            <input
              placeholder={t("targetAmount")}
              value={goalEditModal.target_amount}
              onChange={(e) =>
                setGoalEditModal({
                  ...goalEditModal,
                  target_amount: e.target.value,
                })
              }
            />

            <input
              type="date"
              value={goalEditModal.target_date || ""}
              onChange={(e) =>
                setGoalEditModal({
                  ...goalEditModal,
                  target_date: e.target.value,
                })
              }
            />

            <textarea
              placeholder={t("note")}
              value={goalEditModal.note}
              onChange={(e) =>
                setGoalEditModal({
                  ...goalEditModal,
                  note: e.target.value,
                })
              }
            />

            <div className="modal-actions">
              <button onClick={saveGoalEdit}>{t("save")}</button>
              <button onClick={closeGoalEdit}>{t("cancel")}</button>
            </div>
          </div>
        </div>
      )}

      {goalHistoryModal.open && (
        <div className="modal-overlay">
          <div className="modal-card">
            <h3>
              {t("history")} - {goalHistoryModal.goal?.goal_name}
            </h3>

            {goalHistoryModal.loading ? (
              <p>{t("loading")}</p>
            ) : (
              <>
                {goalHistoryModal.history.length === 0 ? (
                  <p>{t("history")}: 0</p>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>{t("type")}</th>
                        <th>{t("amount")}</th>
                        <th>{t("status")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {goalHistoryModal.history.map((row) => (
                        <tr key={row.id}>
                          <td>{row.transaction_type}</td>
                          <td>{amount(row.amount)}</td>
                          <td>{row.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            )}

            <div className="modal-actions">
              <button onClick={closeGoalHistory}>{t("close")}</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className={`toast toast-${toast.type}`}>{toast.message}</div>
      )}

      <InviteCodeSpotlight
        open={inviteSpotlightOpen}
        code={String(generatedInvite?.invite_code || generatedInvite?.code || "").trim()}
        onClose={() => setInviteSpotlightOpen(false)}
        onCopy={copySpotlightInviteCode}
        copied={inviteCodeCopied}
        t={t}
        language={appLanguage}
      />

      {historyModal.open && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 9998, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ width: "min(900px, 95vw)", maxHeight: "85vh", overflowY: "auto", background: "#0b1f45", border: "1px solid #23497d", borderRadius: 24, padding: 24, color: "#ffffff" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", marginBottom: 20 }}>
              <div>
                <h2 style={{ color: "#ffd42a", marginBottom: 6 }}>{t("savings")} {t("history")}</h2>
                <p style={{ color: "#8ab7ff" }}>{historyModal.goal?.name || t("createSavingsGoal")}</p>
              </div>

              <button onClick={closeSavingsHistory} style={{ background: "#dc2626", color: "white", borderRadius: 12, padding: "12px 18px", fontWeight: 800 }}>
                {t("close")}
              </button>
            </div>

            {historyModal.loading && <p className="status">{t("loading")}</p>}

            {!historyModal.loading && historyModal.history.length === 0 && (
              <p className="status">{t("history")}: 0</p>
            )}

            {!historyModal.loading && historyModal.history.length > 0 && (
              <div className="table">
                {historyModal.history.map((item) => (
                  <div className="row" key={item.id}>
                    <span>{item.transaction_type === "SAVINGS_DEPOSIT" ? t("deposit") : t("withdraw")}</span>
                    <span>{item.description || t("noDetails")}</span>
                    <strong>{money(item.amount, item.currency)}</strong>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {loanHistoryModal.open && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 9998, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ width: "min(900px, 95vw)", maxHeight: "85vh", overflowY: "auto", background: "#0b1f45", border: "1px solid #23497d", borderRadius: 24, padding: 24, color: "#ffffff" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", marginBottom: 20 }}>
              <div>
                <h2 style={{ color: "#ffd42a", marginBottom: 6 }}>{t("loans")} {t("history")}</h2>
                <p style={{ color: "#8ab7ff" }}>{loanHistoryModal.loan?.person_name || t("loans")}</p>
              </div>

              <button onClick={closeLoanHistory} style={{ background: "#dc2626", color: "white", borderRadius: 12, padding: "12px 18px", fontWeight: 800 }}>
                {t("close")}
              </button>
            </div>

            {loanHistoryModal.loading && <p className="status">{t("loading")}</p>}

            {!loanHistoryModal.loading && loanHistoryModal.history.length === 0 && (
              <p className="status">{t("history")}: 0</p>
            )}

            {!loanHistoryModal.loading && loanHistoryModal.history.length > 0 && (
              <div className="table">
                {loanHistoryModal.history.map((item) => (
                  <div className="row" key={item.id}>
                    <span>{item.transaction_type}</span>
                    <span>{item.description || t("noDetails")}</span>
                    <strong>{money(item.amount, item.currency)}</strong>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {loanEditModal.open && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ width: "min(650px, 95vw)", background: "#0b1f45", border: "1px solid #23497d", borderRadius: 24, padding: 24, color: "#ffffff" }}>
            <h2 style={{ color: "#ffd42a", marginBottom: 16 }}>{t("edit")} {t("loans")}</h2>

            <input style={{ width: "100%", minHeight: 56, marginBottom: 14, borderRadius: 12, border: "1px solid #334155", background: "#020b1f", color: "white", padding: 14, fontSize: 16 }} placeholder={t("personName")} value={loanEditModal.person_name} onChange={(e) => setLoanEditModal({ ...loanEditModal, person_name: e.target.value })} />

            <input style={{ width: "100%", minHeight: 56, marginBottom: 14, borderRadius: 12, border: "1px solid #334155", background: "#020b1f", color: "white", padding: 14, fontSize: 16 }} placeholder={t("note")} value={loanEditModal.note} onChange={(e) => setLoanEditModal({ ...loanEditModal, note: e.target.value })} />

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <button onClick={saveLoanEdit} style={{ background: "#2563eb", color: "white", borderRadius: 12, padding: "12px 18px", fontWeight: 800 }}>{t("save")}</button>
              <button onClick={closeLoanEdit} style={{ background: "#dc2626", color: "white", borderRadius: 12, padding: "12px 18px", fontWeight: 800 }}>{t("cancel")}</button>
            </div>
          </div>
        </div>
      )}

      {budgetEditModal.open && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ width: "min(650px, 95vw)", background: "#0b1f45", border: "1px solid #23497d", borderRadius: 24, padding: 24, color: "#ffffff" }}>
            <h2 style={{ color: "#ffd42a", marginBottom: 16 }}>{t("edit")} {t("budgets")}</h2>

            <input style={{ width: "100%", minHeight: 56, marginBottom: 14, borderRadius: 12, border: "1px solid #334155", background: "#020b1f", color: "white", padding: 14, fontSize: 16 }} placeholder={t("budgetName")} value={budgetEditModal.name} onChange={(e) => setBudgetEditModal({ ...budgetEditModal, name: e.target.value })} />

            <select style={{ width: "100%", minHeight: 56, marginBottom: 14, borderRadius: 12, border: "1px solid #334155", background: "#020b1f", color: "white", padding: 14, fontSize: 16 }} value={budgetEditModal.category_id || ""} onChange={(e) => setBudgetEditModal({ ...budgetEditModal, category_id: e.target.value })}>
              <option value="">{t("selectCategory")}</option>
              {expenseCategories().map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name_en || category.name_bn || category.name}
                </option>
              ))}
            </select>

            <input style={{ width: "100%", minHeight: 56, marginBottom: 14, borderRadius: 12, border: "1px solid #334155", background: "#020b1f", color: "white", padding: 14, fontSize: 16 }} placeholder={t("budgetAmount")} value={budgetEditModal.budget_amount} onChange={(e) => setBudgetEditModal({ ...budgetEditModal, budget_amount: e.target.value })} inputMode="decimal" />

            <select style={{ width: "100%", minHeight: 56, marginBottom: 14, borderRadius: 12, border: "1px solid #334155", background: "#020b1f", color: "white", padding: 14, fontSize: 16 }} value={budgetEditModal.period_type || "MONTHLY"} onChange={(e) => setBudgetEditModal({ ...budgetEditModal, period_type: e.target.value })}>
              <option value="MONTHLY">{t("monthly")}</option>
              <option value="WEEKLY">{t("weekly")}</option>
              <option value="YEARLY">{t("yearly")}</option>
            </select>

            <input style={{ width: "100%", minHeight: 56, marginBottom: 14, borderRadius: 12, border: "1px solid #334155", background: "#020b1f", color: "white", padding: 14, fontSize: 16 }} placeholder={t("note")} value={budgetEditModal.note} onChange={(e) => setBudgetEditModal({ ...budgetEditModal, note: e.target.value })} />

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <button disabled={Boolean(budgetBusyId)} onClick={saveBudgetEdit} style={{ background: "#2563eb", color: "white", borderRadius: 12, padding: "12px 18px", fontWeight: 800 }}>{budgetBusyId ? t("loading") : t("save")}</button>
              <button disabled={Boolean(budgetBusyId)} onClick={closeBudgetEdit} style={{ background: "#dc2626", color: "white", borderRadius: 12, padding: "12px 18px", fontWeight: 800 }}>{t("cancel")}</button>
            </div>
          </div>
        </div>
      )}


      {recurringEditModal.open && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ width: "min(650px, 95vw)", background: "#0b1f45", border: "1px solid #23497d", borderRadius: 24, padding: 24, color: "#ffffff" }}>
            <h2 style={{ color: "#ffd42a", marginBottom: 16 }}>{t("edit")} {t("recurring")}</h2>

            <input style={{ width: "100%", minHeight: 56, marginBottom: 14, borderRadius: 12, border: "1px solid #334155", background: "#020b1f", color: "white", padding: 14, fontSize: 16 }} placeholder={t("title")} value={recurringEditModal.title} onChange={(e) => setRecurringEditModal({ ...recurringEditModal, title: e.target.value })} />

            <input style={{ width: "100%", minHeight: 56, marginBottom: 14, borderRadius: 12, border: "1px solid #334155", background: "#020b1f", color: "white", padding: 14, fontSize: 16 }} placeholder={t("amount")} value={recurringEditModal.amount} onChange={(e) => setRecurringEditModal({ ...recurringEditModal, amount: e.target.value })} />

            <select style={{ width: "100%", minHeight: 56, marginBottom: 14, borderRadius: 12, border: "1px solid #334155", background: "#020b1f", color: "white", padding: 14, fontSize: 16 }} value={recurringEditModal.frequency} onChange={(e) => setRecurringEditModal({ ...recurringEditModal, frequency: e.target.value })}>
              <option value="DAILY">{t("daily")}</option>
              <option value="WEEKLY">{t("weekly")}</option>
              <option value="MONTHLY">{t("monthly")}</option>
              <option value="YEARLY">{t("yearly")}</option>
            </select>

            <input style={{ width: "100%", minHeight: 56, marginBottom: 14, borderRadius: 12, border: "1px solid #334155", background: "#020b1f", color: "white", padding: 14, fontSize: 16 }} type="date" value={recurringEditModal.end_date} onChange={(e) => setRecurringEditModal({ ...recurringEditModal, end_date: e.target.value })} />

            <input style={{ width: "100%", minHeight: 56, marginBottom: 14, borderRadius: 12, border: "1px solid #334155", background: "#020b1f", color: "white", padding: 14, fontSize: 16 }} placeholder={t("description")} value={recurringEditModal.description} onChange={(e) => setRecurringEditModal({ ...recurringEditModal, description: e.target.value })} />

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <button onClick={saveRecurringEdit} style={{ background: "#2563eb", color: "white", borderRadius: 12, padding: "12px 18px", fontWeight: 800 }}>{t("save")}</button>
              <button onClick={closeRecurringEdit} style={{ background: "#dc2626", color: "white", borderRadius: 12, padding: "12px 18px", fontWeight: 800 }}>{t("cancel")}</button>
            </div>
          </div>
        </div>
      )}

      {recurringHistoryModal.open && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 9998, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ width: "min(900px, 95vw)", maxHeight: "85vh", overflowY: "auto", background: "#0b1f45", border: "1px solid #23497d", borderRadius: 24, padding: 24, color: "#ffffff" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", marginBottom: 20 }}>
              <div>
                <h2 style={{ color: "#ffd42a", marginBottom: 6 }}>{t("recurring")} {t("history")}</h2>
                <p style={{ color: "#8ab7ff" }}>{recurringHistoryModal.item?.title || t("recurring")}</p>
              </div>

              <button onClick={closeRecurringHistory} style={{ background: "#dc2626", color: "white", borderRadius: 12, padding: "12px 18px", fontWeight: 800 }}>{t("close")}</button>
            </div>

            {recurringHistoryModal.loading && <p className="status">{t("loading")}</p>}

            {!recurringHistoryModal.loading && recurringHistoryModal.history.length === 0 && (
              <p className="status">{t("history")}: 0</p>
            )}

            {!recurringHistoryModal.loading && recurringHistoryModal.history.length > 0 && (
              <div className="table">
                {recurringHistoryModal.history.map((item) => (
                  <div className="row" key={item.id}>
                    <span>{item.transaction_type}</span>
                    <span>{item.description || t("noDetails")}</span>
                    <strong>{money(item.amount, item.currency)}</strong>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}


      <DesktopSidebar
        navGroups={navGroups}
        navItems={navItems}
        activeMenu={activeMenu}
        setActiveMenu={setActiveMenu}
        digits={digits}
        t={t}
        email={email}
        currentUser={currentUser}
        avatarUrl={displayAvatarUrl || avatarUrl(currentUser)}
        families={families}
        activeFamilyId={activeFamilyId}
        changeActiveFamily={changeActiveFamily}
        familiesLoading={familiesLoading}
        onLogout={logout}
      />

      <main className="main-content">
        <TopHeader
          appLanguage={appLanguage}
          activeMenu={activeMenu}
          setActiveMenu={setActiveMenu}
          changeAppLanguage={changeAppLanguage}
          t={t}
          lockedLanguages={LOCKED_LANGUAGES}
          unreadCount={
            Number(
              notificationSummary?.unread_notifications ??
                notificationSummary?.unread_count ??
                notificationSummary?.unread ??
                0
            )
          }
          notifications={notifications}
          notificationsLoading={notificationsLoading}
          notifyPermission={notifyPermission}
          notifyPermissionHint={notifyPermissionHint}
          notifyDropdownOpen={notifyDropdownOpen}
          setNotifyDropdownOpen={setNotifyDropdownOpen}
          onEnablePush={() => enableBrowserPushNotifications({ silent: notifyPermission === "granted" })}
          onRefreshNotifications={loadNotifications}
          onMarkNotificationRead={markNotificationRead}
          onMarkAllNotificationsRead={markAllNotificationsRead}
          onLogout={logout}
          avatarUrl={displayAvatarUrl || avatarUrl(currentUser)}
          currentUser={currentUser}
          email={email}
          navItems={navItems}
          browserOnline={browserOnline}
          syncStatus={syncStatus}
          localOutboxPending={localOutboxPending}
        />

        {!activeFamilyId && (isFamilyLoading || familiesLoading || sessionBootstrapping) && (
          <section className="family-boot-loading" aria-busy="true" aria-live="polite">
            <div className="card family-boot-loading-card">
              <div className="auth-spinner" aria-hidden="true" />
              <h2>{t("authLoadingTitle") || t("loading")}</h2>
              <p>{t("authLoadingHint") || t("loading")}</p>
              <button
                type="button"
                className="btn"
                style={{ marginTop: 12 }}
                onClick={() => {
                  setSessionBootstrapping(false);
                  setIsFamilyLoading(false);
                  setFamiliesLoading(false);
                  const localId = loadCloudFamilyId();
                  if (localId) {
                    setActiveFamilyId(localId);
                    setCloudOnlyMode(true);
                    persistCloudOnlyMode(true);
                  }
                }}
              >
                {t("continueOffline") || t("refresh") || "Continue"}
              </button>
            </div>
          </section>
        )}

        {!activeFamilyId && !isFamilyLoading && !familiesLoading && !sessionBootstrapping && (
          <section>
            <div className="card" style={{ maxWidth: 520 }}>
              <h2>{t("noActiveFamilySelected")}</h2>
              <p>
                {appLanguage === "bn"
                  ? "এই অ্যাকাউন্টে এখনো কোনো পরিবার নেই। Refresh দিয়ে দেখুন, নতুন পরিবার তৈরি করুন, অথবা ইনভাইট কোড দিয়ে যোগ দিন।"
                  : "No family is linked to this account yet. Tap Refresh, create a new family, or join with an invite code."}
              </p>
              <p className="hint" style={{ marginTop: 8 }}>
                {currentUser?.email || email || ""}
              </p>

              {noFamilySetupMode === "choose" ? (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={cloudBusy || authLoading || !token}
                    onClick={async () => {
                      if (!token) {
                        setMessage(
                          appLanguage === "bn" ? "আগে Logout → Login করুন" : "Logout and Login first",
                          "error",
                        );
                        return;
                      }
                      setCloudBusy(true);
                      try {
                        await loadFamilies();
                        if (!loadCloudFamilyId()) {
                          setMessage(
                            appLanguage === "bn"
                              ? "এই অ্যাকাউন্টে পরিবার পাওয়া যায়নি — Create বা Join করুন।"
                              : "No family found for this account — Create or Join.",
                            "warning",
                          );
                        }
                      } catch (err) {
                        setMessage(err?.message || t("familyLoadFailed"), "error");
                      } finally {
                        setCloudBusy(false);
                      }
                    }}
                  >
                    {cloudBusy
                      ? t("loading") || "…"
                      : appLanguage === "bn"
                        ? "রিফ্রেশ / পরিবার লোড"
                        : "Refresh / load family"}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={cloudBusy || authLoading}
                    onClick={() => {
                      setNoFamilySetupMode("join");
                      setNoFamilyForm((f) => ({
                        ...f,
                        fullName: currentUser?.full_name || f.fullName,
                      }));
                    }}
                  >
                    {t("btnJoin") || "Join invite"}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={cloudBusy || authLoading}
                    onClick={() => {
                      setNoFamilySetupMode("create");
                      setNoFamilyForm((f) => ({
                        ...f,
                        fullName: currentUser?.full_name || f.fullName,
                        familyName: f.familyName || "S4 FAMILY 143",
                      }));
                    }}
                  >
                    {t("btnCreate") || "Create family"}
                  </button>
                  <button type="button" className="btn" onClick={() => logout()}>
                    {t("logout") || "Logout"}
                  </button>
                </div>
              ) : null}

              {noFamilySetupMode === "create" ? (
                <form
                  className="signup-form"
                  style={{ marginTop: 16 }}
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!token) {
                      setMessage(
                        appLanguage === "bn" ? "আগে Logout → Login করুন" : "Logout and Login first",
                        "error",
                      );
                      return;
                    }
                    if (!noFamilyForm.familyName.trim()) {
                      setMessage(t("familyGateFieldsRequired") || "Fill required fields", "error");
                      return;
                    }
                    setCloudBusy(true);
                    setAuthLoading(true);
                    setStatus(t("creatingFamilyGate"));
                    try {
                      await apiPost("/families", {
                        name: noFamilyForm.familyName.trim(),
                        default_currency: "BDT",
                        timezone: "Asia/Dhaka",
                        relationship_type: noFamilyForm.relation || "Husband",
                      });
                      await loadFamilies();
                      setNoFamilySetupMode("choose");
                      setMessage(t("familyCreatedGate") || "Family created", "success");
                    } catch (err) {
                      setMessage(err?.message || t("familyCreateFailed") || "Create failed", "error");
                    } finally {
                      setCloudBusy(false);
                      setAuthLoading(false);
                      setStatus("");
                    }
                  }}
                >
                  <div className="field">
                    <label>{t("fullName") || "Full name"}</label>
                    <input
                      value={noFamilyForm.fullName}
                      onChange={(e) => setNoFamilyForm((f) => ({ ...f, fullName: e.target.value }))}
                    />
                  </div>
                  <div className="field">
                    <label>{t("familyName") || "Family name"}</label>
                    <input
                      value={noFamilyForm.familyName}
                      onChange={(e) => setNoFamilyForm((f) => ({ ...f, familyName: e.target.value }))}
                      required
                    />
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    <button type="submit" className="btn btn-primary" disabled={cloudBusy || authLoading}>
                      {authLoading || cloudBusy
                        ? t("creatingFamilyGate") || "Creating…"
                        : t("btnCreateSubmit") ||
                          (appLanguage === "bn"
                            ? "পরিবার তৈরি করুন ও Owner হোন"
                            : "Create family & become Owner")}
                    </button>
                    <button type="button" className="btn" onClick={() => setNoFamilySetupMode("choose")}>
                      {t("back") || "Back"}
                    </button>
                  </div>
                </form>
              ) : null}

              {noFamilySetupMode === "join" ? (
                <form
                  className="signup-form"
                  style={{ marginTop: 16 }}
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!token) {
                      setMessage(
                        appLanguage === "bn" ? "আগে Logout → Login করুন" : "Logout and Login first",
                        "error",
                      );
                      return;
                    }
                    if (!noFamilyForm.inviteCode.trim()) {
                      setMessage(t("joinGateFieldsRequired") || "Fill required fields", "error");
                      return;
                    }
                    setCloudBusy(true);
                    setAuthLoading(true);
                    setStatus(t("joiningFamilyGate"));
                    try {
                      await apiPost("/invites/join", {
                        invite_code: noFamilyForm.inviteCode.trim().toUpperCase(),
                        relationship_type: noFamilyForm.relation || "Wife",
                      });
                      await loadFamilies();
                      setNoFamilySetupMode("choose");
                      setMessage(t("joinRequestedGate") || "Join requested", "success");
                    } catch (err) {
                      setMessage(err?.message || t("joinFailedGate") || "Join failed", "error");
                    } finally {
                      setCloudBusy(false);
                      setAuthLoading(false);
                      setStatus("");
                    }
                  }}
                >
                  <div className="field">
                    <label>{t("fullName") || "Full name"}</label>
                    <input
                      value={noFamilyForm.fullName}
                      onChange={(e) => setNoFamilyForm((f) => ({ ...f, fullName: e.target.value }))}
                    />
                  </div>
                  <div className="field">
                    <label>{t("inviteCode") || "Invite code"}</label>
                    <input
                      value={noFamilyForm.inviteCode}
                      onChange={(e) =>
                        setNoFamilyForm((f) => ({ ...f, inviteCode: e.target.value.toUpperCase() }))
                      }
                      placeholder="S4-XXXXXX"
                      required
                      style={{ textTransform: "uppercase" }}
                    />
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    <button type="submit" className="btn btn-primary" disabled={cloudBusy || authLoading}>
                      {authLoading || cloudBusy
                        ? t("joiningFamilyGate") || "Joining…"
                        : t("btnJoin") || "Join invite"}
                    </button>
                    <button type="button" className="btn" onClick={() => setNoFamilySetupMode("choose")}>
                      {t("back") || "Back"}
                    </button>
                  </div>
                </form>
              ) : null}
            </div>
          </section>
        )}

        {activeFamilyId && activeMenu === "dashboard" && (
          <ExecutiveDashboard
            dashboard={dashboard}
            wallets={wallets}
            transactions={transactions}
            budgets={budgets}
            categories={categories}
            activeFamily={activeFamily}
            syncStatus={syncStatus}
            notificationSummary={notificationSummary}
            auditSummary={auditSummary}
            phase15Summary={phase15Summary}
            phase15Items={phase15Items}
            phase16Summary={phase16Summary}
            phase16Items={phase16Items}
            governanceMembers={governanceMembers}
            setActiveMenu={setActiveMenu}
            budgetSummary={budgetSummary}
            totalLoanRemaining={totalLoanRemaining}
            money={money}
            digits={digits}
            currencyName={currencyName}
            t={t}
            appLanguage={appLanguage}
          />
        )}

        {activeFamilyId && activeMenu === "wallets" && (
          <WalletsPanel
            t={t}
            money={money}
            wallets={wallets}
            walletForm={walletForm}
            setWalletForm={setWalletForm}
            editingWalletId={editingWalletId}
            onCreate={createWallet}
            onSaveEdit={saveEditWallet}
            onStartEdit={startEditWallet}
            onCancelEdit={cancelEditWallet}
            onDelete={deleteWallet}
            onRefresh={loadWallets}
            busyId={walletBusyId}
          />
        )}

        {activeFamilyId && activeMenu === "transactions" && (
          <TransactionsPanel
            t={t}
            money={money}
            transactions={transactions}
            wallets={wallets}
            categories={categories}
            members={governanceMembers}
            txForm={txForm}
            setTxForm={setTxForm}
            onCreate={createTransaction}
            onRefresh={loadTransactions}
            onVoid={voidTransaction}
            onUploadAttachment={uploadTxAttachment}
            onParseExpenseOcr={parseExpenseOcr}
            onParseExpenseOcrImage={parseExpenseOcrImage}
            voidBusyId={voidBusyId}
            attachBusyId={attachBusyId}
            onGoWallets={() => setActiveMenu("wallets")}
            cloudLocalMode={isCloudLocalMode()}
          />
        )}

        {activeFamilyId && activeMenu === "tags" && (
          <TagsPanel
            t={t}
            money={money}
            amount={amount}
            apiGet={apiGet}
            apiPost={apiPost}
            apiDelete={apiDelete}
            activeFamilyId={activeFamilyId}
            transactions={transactions}
            onMessage={setMessage}
          />
        )}

        {activeFamilyId && activeMenu === "cutover" && (
          <ArchitectureCutoverPanel
            t={t}
            money={money}
            amount={amount}
            apiGet={apiGet}
            apiPost={apiPost}
            apiUpload={apiUpload}
            activeFamilyId={activeFamilyId}
            wallets={wallets}
            categories={categories}
            members={governanceMembers}
            transactions={transactions}
            currency={currencyCode()}
            onMessage={setMessage}
            onFinanceChanged={async () => {
              await Promise.all([loadTransactions(), loadWallets()]);
              setDashboard(buildDashboardFromCache(await hydrateFamilyFromOfflineCache(activeFamilyId)));
            }}
          />
        )}

        {activeFamilyId && activeMenu === "savings" && (
          <SavingsPanel
            t={t}
            digits={digits}
            money={money}
            savings={savings}
            wallets={wallets}
            summary={savingsSummary()}
            alerts={savingsAlerts()}
            savingsForm={savingsForm}
            setSavingsForm={setSavingsForm}
            savingsAction={savingsAction}
            setSavingsAction={setSavingsAction}
            annualPlan={savingsAnnualPlan}
            onLoadAnnualPlan={loadSavingsAnnualPlan}
            onCreate={createSavingsGoal}
            onPostAction={postSavingsAction}
            onRefresh={loadSavings}
            onEdit={editSavingsGoal}
            onHistory={openSavingsHistory}
            onClose={closeSavingsGoal}
            busy={Boolean(savingsBusyId)}
          />
        )}

        {activeFamilyId && activeMenu === "loans" && (
          <LoansPanel
            t={t}
            money={money}
            amount={amount}
            loans={loans}
            filteredLoans={filteredLoans()}
            wallets={wallets}
            loanForm={loanForm}
            setLoanForm={setLoanForm}
            loanPaymentForm={loanPaymentForm}
            setLoanPaymentForm={setLoanPaymentForm}
            loanSearch={loanSearch}
            setLoanSearch={setLoanSearch}
            loanStatusFilter={loanStatusFilter}
            setLoanStatusFilter={setLoanStatusFilter}
            loanTypeFilter={loanTypeFilter}
            setLoanTypeFilter={setLoanTypeFilter}
            onCreate={createLoan}
            onPostPayment={postLoanPayment}
            onRefresh={loadLoans}
            onEdit={openLoanEdit}
            onHistory={openLoanHistory}
            onClose={closeLoan}
            onClearFilters={() => {
              setLoanSearch("");
              setLoanStatusFilter("ALL");
              setLoanTypeFilter("ALL");
            }}
          />
        )}

        {activeFamilyId && activeMenu === "budgets" && (
          <BudgetsPanel
            t={t}
            digits={digits}
            money={money}
            budgets={budgets}
            filteredBudgets={filteredBudgets()}
            expenseCategories={expenseCategories()}
            summary={budgetSummary()}
            alerts={budgetAlerts()}
            budgetForm={budgetForm}
            setBudgetForm={setBudgetForm}
            budgetSearch={budgetSearch}
            setBudgetSearch={setBudgetSearch}
            budgetStatusFilter={budgetStatusFilter}
            setBudgetStatusFilter={setBudgetStatusFilter}
            onCreate={createBudget}
            onRefresh={loadBudgets}
            onEdit={openBudgetEdit}
            onClose={closeBudget}
            busy={Boolean(budgetBusyId)}
            onClearFilters={() => {
              setBudgetSearch("");
              setBudgetStatusFilter("ALL");
            }}
          />
        )}

        {activeFamilyId && activeMenu === "recurring" && (
          <section className="panel settings-panel settings-smart finance-smart">
            <div className="settings-head">
              <div>
                <p className="settings-kicker">{t("recurring")}</p>
                <h2>{t("recurring")}</h2>
              </div>
              <button type="button" className="btn" onClick={loadRecurring}>
                {t("refreshRecurring")}
              </button>
            </div>

            <div className="summary-metric-grid" role="group" aria-label={t("recurring")}>
              <div className="summary-metric-card">
                <span className="summary-metric-label">{t("activeStatus")}</span>
                <strong className="summary-metric-value">{digits(recurringSummary().activeCount)}</strong>
              </div>
              <div className="summary-metric-card">
                <span className="summary-metric-label">{t("recurringDue")}</span>
                <strong className="summary-metric-value">{digits(recurringSummary().dueTodayCount)}</strong>
              </div>
              <div className="summary-metric-card">
                <span className="summary-metric-label">{t("monthlyRecurring")}</span>
                <strong className="summary-metric-value">{money(recurringSummary().monthlyAmount)}</strong>
              </div>
            </div>

            <div className="settings-stack">
              <div className="settings-block">
                <h4>{t("createRecurring")}</h4>
                <div className="finance-form">
                  <select
                    value={recurringForm.transaction_type}
                    onChange={(e) =>
                      setRecurringForm({
                        ...recurringForm,
                        transaction_type: e.target.value,
                        category_id: "",
                      })
                    }
                  >
                    <option value="INCOME">{t("income")}</option>
                    <option value="EXPENSE">{t("expense")}</option>
                  </select>

                  <select
                    value={recurringForm.account_id}
                    onChange={(e) => setRecurringForm({ ...recurringForm, account_id: e.target.value })}
                  >
                    <option value="">{t("selectWallet")}</option>
                    {wallets
                      .filter((w) => !w?.deleted_at && w?.is_active !== false)
                      .map((wallet) => (
                        <option key={wallet.id} value={wallet.id}>
                          {wallet.name}
                        </option>
                      ))}
                  </select>

                  <select
                    value={recurringForm.category_id}
                    onChange={(e) => setRecurringForm({ ...recurringForm, category_id: e.target.value })}
                  >
                    <option value="">{t("noCategory")}</option>
                    {recurringCategories().map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name_en || category.name_bn || category.name}
                      </option>
                    ))}
                  </select>

                  <input
                    placeholder={t("title")}
                    value={recurringForm.title}
                    onChange={(e) => setRecurringForm({ ...recurringForm, title: e.target.value })}
                  />

                  <input
                    placeholder={t("amount")}
                    value={recurringForm.amount}
                    onChange={(e) => setRecurringForm({ ...recurringForm, amount: e.target.value })}
                  />

                  <select
                    value={recurringForm.frequency}
                    onChange={(e) => setRecurringForm({ ...recurringForm, frequency: e.target.value })}
                  >
                    <option value="DAILY">{t("daily")}</option>
                    <option value="WEEKLY">{t("weekly")}</option>
                    <option value="MONTHLY">{t("monthly")}</option>
                    <option value="YEARLY">{t("yearly")}</option>
                  </select>

                  <input
                    type="date"
                    value={recurringForm.start_date}
                    onChange={(e) => setRecurringForm({ ...recurringForm, start_date: e.target.value })}
                    aria-label={t("start")}
                  />

                  <input
                    type="date"
                    value={recurringForm.end_date}
                    onChange={(e) => setRecurringForm({ ...recurringForm, end_date: e.target.value })}
                    aria-label={t("end")}
                  />

                  <input
                    placeholder={t("description")}
                    value={recurringForm.description}
                    onChange={(e) => setRecurringForm({ ...recurringForm, description: e.target.value })}
                  />

                  <button type="button" className="btn btn-primary" onClick={createRecurring}>
                    {t("createRecurring")}
                  </button>
                </div>
              </div>

              <div className="settings-block">
                <h4>{t("recurringSearchFilter")}</h4>
                <div className="finance-form">
                  <input
                    placeholder={t("searchTitleDescription")}
                    value={recurringSearch}
                    onChange={(e) => setRecurringSearch(e.target.value)}
                  />

                  <select
                    value={recurringStatusFilter}
                    onChange={(e) => setRecurringStatusFilter(e.target.value)}
                  >
                    <option value="ALL">{t("allStatus")}</option>
                    <option value="ACTIVE">{t("activeStatus")}</option>
                    <option value="PAUSED">{t("pausedStatus")}</option>
                    <option value="COMPLETED">{t("completedStatus")}</option>
                    <option value="CLOSED">{t("closedStatus")}</option>
                  </select>

                  <select
                    value={recurringTypeFilter}
                    onChange={(e) => setRecurringTypeFilter(e.target.value)}
                  >
                    <option value="ALL">{t("allType")}</option>
                    <option value="INCOME">{t("income")}</option>
                    <option value="EXPENSE">{t("expense")}</option>
                  </select>

                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setRecurringSearch("");
                      setRecurringStatusFilter("ALL");
                      setRecurringTypeFilter("ALL");
                    }}
                  >
                    {t("clearFilter")}
                  </button>
                </div>
              </div>

              <div className="settings-block">
                <h4>{t("recurring")}</h4>
                {filteredRecurringItems().length === 0 ? (
                  <p className="settings-empty">{t("noRecurringYet")}</p>
                ) : (
                  <div className="finance-feed">
                    {filteredRecurringItems().map((item) => (
                      <div className="finance-card finance-card-stack budget-card" key={item.id}>
                        <div className="tx-row budget-row-head">
                          <div className="tx-row-copy">
                            <strong title={item.title}>{item.title}</strong>
                            <span className="tx-row-sub">
                              {item.transaction_type} · {item.frequency} · {t("nextDue")}:{" "}
                              {item.next_due_date ? digits(item.next_due_date) : t("noDate")}
                            </span>
                          </div>
                          <div
                            className={`savings-status ${
                              isRecurringDue(item)
                                ? "savings-closed"
                                : item.status === "ACTIVE"
                                  ? "savings-active"
                                  : "savings-closed"
                            }`}
                          >
                            {isRecurringDue(item) ? t("dueStatus") : item.status}
                          </div>
                        </div>

                        <div className="budget-amount-row">
                          <div className="budget-amount-cell">
                            <span>{t("amount")}</span>
                            <strong>{money(item.amount, item.currency)}</strong>
                          </div>
                          <div className="budget-amount-cell">
                            <span>{t("start")}</span>
                            <strong>{item.start_date ? digits(item.start_date) : t("noDate")}</strong>
                          </div>
                          <div className="budget-amount-cell">
                            <span>{t("end")}</span>
                            <strong>{item.end_date ? digits(item.end_date) : t("noEnd")}</strong>
                          </div>
                          <div className="budget-amount-cell">
                            <span>{t("lastPosted")}</span>
                            <strong>
                              {item.last_posted_at ? digits(String(item.last_posted_at).slice(0, 10)) : t("never")}
                            </strong>
                          </div>
                        </div>

                        <div className="finance-actions">
                          {["ACTIVE", "PAUSED"].includes(item.status) ? (
                            <button type="button" className="btn" onClick={() => openRecurringEdit(item)}>
                              {t("edit")}
                            </button>
                          ) : null}
                          <button type="button" className="btn" onClick={() => openRecurringHistory(item)}>
                            {t("history")}
                          </button>
                          {item.status === "ACTIVE" ? (
                            <button type="button" className="btn btn-primary" onClick={() => postRecurring(item)}>
                              {t("postNow")}
                            </button>
                          ) : null}
                          {item.status === "ACTIVE" ? (
                            <button type="button" className="btn" onClick={() => pauseRecurring(item)}>
                              {t("pause")}
                            </button>
                          ) : null}
                          {item.status === "PAUSED" ? (
                            <button type="button" className="btn" onClick={() => resumeRecurring(item)}>
                              {t("resume")}
                            </button>
                          ) : null}
                          {!["CLOSED", "COMPLETED"].includes(item.status) ? (
                            <button type="button" className="btn" onClick={() => closeRecurring(item)}>
                              {t("close")}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>
        )}


        {activeFamilyId && activeMenu === "goals" && (
          <section className="panel settings-panel settings-smart finance-smart">
            <div className="settings-head">
              <div>
                <p className="settings-kicker">{t("goals")}</p>
                <h2>{t("goals")}</h2>
              </div>
              <button type="button" className="btn" onClick={loadGoals}>
                {t("refreshGoals")}
              </button>
            </div>

            <div className="summary-metric-grid" role="group" aria-label={t("goals")}>
              <div className="summary-metric-card">
                <span className="summary-metric-label">{t("goals")}</span>
                <strong className="summary-metric-value">{digits(goalSummary?.total_goals ?? goals.length)}</strong>
              </div>
              <div className="summary-metric-card">
                <span className="summary-metric-label">{t("activeStatus")}</span>
                <strong className="summary-metric-value">
                  {digits(
                    goalSummary?.active_count ??
                      goals.filter((g) => String(g.status || "").toUpperCase() === "ACTIVE").length,
                  )}
                </strong>
              </div>
              <div className="summary-metric-card">
                <span className="summary-metric-label">{t("targetAmount")}</span>
                <strong className="summary-metric-value">{money(goalSummary?.active_target_amount)}</strong>
              </div>
              <div className="summary-metric-card">
                <span className="summary-metric-label">{t("saved")}</span>
                <strong className="summary-metric-value">{money(goalSummary?.active_current_amount)}</strong>
              </div>
            </div>

            <div className="settings-stack">
              <div className="settings-block">
                <h4>{t("createGoal")}</h4>
                <div className="finance-form">
                  <input
                    placeholder={t("goalName")}
                    value={goalForm.goal_name}
                    onChange={(e) => setGoalForm({ ...goalForm, goal_name: e.target.value })}
                  />
                  <select
                    value={goalForm.goal_type}
                    onChange={(e) => setGoalForm({ ...goalForm, goal_type: e.target.value })}
                    aria-label={t("goalType")}
                  >
                    <option value="GENERAL">{t("goalTypeGeneral")}</option>
                    <option value="EMERGENCY">{t("goalTypeEmergency")}</option>
                    <option value="EDUCATION">{t("goalTypeEducation")}</option>
                    <option value="HOME">{t("goalTypeHome")}</option>
                    <option value="VEHICLE">{t("goalTypeVehicle")}</option>
                    <option value="OTHER">{t("goalTypeOther")}</option>
                  </select>
                  <input
                    placeholder={t("targetAmount")}
                    value={goalForm.target_amount}
                    onChange={(e) => setGoalForm({ ...goalForm, target_amount: e.target.value })}
                  />
                  <input
                    type="date"
                    value={goalForm.target_date}
                    onChange={(e) => setGoalForm({ ...goalForm, target_date: e.target.value })}
                    aria-label={t("targetDate")}
                  />
                  <input
                    placeholder={t("note")}
                    value={goalForm.note}
                    onChange={(e) => setGoalForm({ ...goalForm, note: e.target.value })}
                  />
                  <button type="button" className="btn btn-primary" onClick={createGoal}>
                    {t("createGoal")}
                  </button>
                </div>
              </div>

              <div className="settings-block">
                <h4>{t("contributeWithdraw")}</h4>
                <div className="finance-form">
                  <select
                    value={goalContributionForm.goal_id}
                    onChange={(e) =>
                      setGoalContributionForm({ ...goalContributionForm, goal_id: e.target.value })
                    }
                  >
                    <option value="">{t("selectGoal")}</option>
                    {goals
                      .filter((goal) => String(goal.status || "").toUpperCase() !== "CLOSED")
                      .map((goal) => (
                        <option key={goal.id} value={goal.id}>
                          {goal.goal_name} - {amount(goal.current_amount)}/{amount(goal.target_amount)}
                        </option>
                      ))}
                  </select>

                  <select
                    value={goalContributionForm.wallet_account_id}
                    onChange={(e) =>
                      setGoalContributionForm({
                        ...goalContributionForm,
                        wallet_account_id: e.target.value,
                      })
                    }
                  >
                    <option value="">{t("selectWallet")}</option>
                    {wallets
                      .filter((w) => !w?.deleted_at && w?.is_active !== false)
                      .map((wallet) => (
                        <option key={wallet.id} value={wallet.id}>
                          {wallet.name}
                        </option>
                      ))}
                  </select>

                  <input
                    placeholder={t("amount")}
                    value={goalContributionForm.amount}
                    onChange={(e) =>
                      setGoalContributionForm({ ...goalContributionForm, amount: e.target.value })
                    }
                  />
                  <input
                    placeholder={t("description")}
                    value={goalContributionForm.description}
                    onChange={(e) =>
                      setGoalContributionForm({
                        ...goalContributionForm,
                        description: e.target.value,
                      })
                    }
                  />

                  <button type="button" className="btn btn-primary" onClick={contributeGoal}>
                    {t("contribute")}
                  </button>
                  <button type="button" className="btn" onClick={withdrawGoal}>
                    {t("withdraw")}
                  </button>
                </div>
              </div>

              <div className="settings-block">
                <h4>{t("goals")}</h4>
                {goals.length === 0 ? (
                  <p className="settings-empty">{t("noGoalsYet")}</p>
                ) : (
                  <div className="finance-feed">
                    {goals.map((goal) => {
                      const progressValue = Math.min(Number(goal.progress_percent || 0), 100);
                      return (
                        <div className="finance-card finance-card-stack budget-card" key={goal.id}>
                          <div className="tx-row budget-row-head">
                            <div className="tx-row-copy">
                              <strong title={goal.goal_name}>{goal.goal_name}</strong>
                              <span className="tx-row-sub">
                                {goal.goal_type} · {t("targetDate")}:{" "}
                                {goal.target_date ? digits(goal.target_date) : t("noDate")} ·{" "}
                                {goal.note || t("noNote")}
                              </span>
                            </div>
                            <div className={`savings-status ${goal.status === "ACTIVE" ? "savings-active" : "savings-closed"}`}>
                              {goal.status}
                            </div>
                          </div>

                          <div className="progress-wrapper">
                            <div className="progress-fill" style={{ width: `${progressValue}%` }} />
                          </div>

                          <div className="budget-amount-row">
                            <div className="budget-amount-cell">
                              <span>{t("saved")}</span>
                              <strong>{money(goal.current_amount, goal.currency)}</strong>
                            </div>
                            <div className="budget-amount-cell">
                              <span>{t("targetAmount")}</span>
                              <strong>{money(goal.target_amount, goal.currency)}</strong>
                            </div>
                            <div className="budget-amount-cell">
                              <span>{t("remaining")}</span>
                              <strong>{money(goal.remaining_amount, goal.currency)}</strong>
                            </div>
                            <div className="budget-amount-cell">
                              <span>{digits(goal.progress_percent)}%</span>
                              <strong>
                                {t("monthlyNeed")}: {money(goal.recommended_monthly_saving, goal.currency)}
                              </strong>
                            </div>
                          </div>

                          <div className="finance-actions">
                            {String(goal.status || "").toUpperCase() === "ACTIVE" ? (
                              <button type="button" className="btn" onClick={() => openGoalEdit(goal)}>
                                {t("edit")}
                              </button>
                            ) : null}
                            <button type="button" className="btn" onClick={() => openGoalHistory(goal)}>
                              {t("history")}
                            </button>
                            {String(goal.status || "").toUpperCase() !== "CLOSED" ? (
                              <button type="button" className="btn" onClick={() => closeGoal(goal)}>
                                {t("close")}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {activeFamilyId && activeMenu === "family" && (
          <FamilyGovernancePanel
            t={t}
            digits={digits}
            currencyName={currencyName}
            activeFamily={activeFamily}
            currentUser={{
              ...(currentUser || {}),
              uid: firebaseUser?.uid || currentUser?.uid,
              firebase_uid: firebaseUser?.uid || currentUser?.firebase_uid,
              email: currentUser?.email || firebaseUser?.email || email || "",
            }}
            email={email || firebaseUser?.email || ""}
            myPermissions={myPermissions}
            governanceMembers={governanceMembers}
            memberPermissions={memberPermissions}
            permissionSavingMemberId={permissionSavingMemberId}
            toggleMemberPermission={toggleMemberPermission}
            joinRequests={joinRequests}
            governanceLoading={governanceLoading}
            inviteForm={inviteForm}
            setInviteForm={setInviteForm}
            inviteGenerating={inviteGenerating}
            inviteRevoking={inviteRevoking}
            generatedInvite={generatedInvite}
            activeTab={familyPanelTab}
            onTabChange={setFamilyPanelTab}
            onRefresh={async () => {
              await loadFamilyGovernance();
              await loadSettingsData();
            }}
            onGenerateInvite={generateFamilyInvite}
            onInviteEmail={isCloudLocalMode() ? null : inviteFamilyByEmail}
            onInviteLink={inviteFamilyByLink}
            onRevokeInvite={revokeFamilyInvite}
            onDecideJoinRequest={decideJoinRequest}
            onJoinFamily={submitLoggedInJoin}
            apiGet={apiGet}
            apiPost={apiPost}
            apiPatch={apiPatch}
            apiDelete={apiDelete}
            activeFamilyId={activeFamilyId}
            cloudMode={isCloudLocalMode()}
          />
        )}

        {activeFamilyId && activeMenu === "planner" && (
          <TasksCalendarPanel
            t={t}
            digits={digits}
            apiGet={apiGet}
            apiPost={apiPost}
            apiPatch={apiPatch}
            apiDelete={apiDelete}
            activeFamilyId={activeFamilyId}
          />
        )}

        {activeFamilyId && activeMenu === "currency" && (
          <section className="panel">
            <h2>{t("currencyCenter")}</h2>

            <div className="grid">
              <div className="card">
                <span>{t("baseCurrency")}</span>
                <strong>{currencyName(currencySummary?.base_currency || activeFamily?.default_currency)}</strong>
                <p>{digits(currencySummary?.wallet_count || 0)} {t("walletBalancesIncluded")}</p>
              </div>

              <div className="card">
                <span>{t("totalConvertedBalance")}</span>
                <strong>{money(currencySummary?.total_converted_balance, currencySummary?.base_currency || activeFamily?.default_currency)}</strong>
                <p>
                  {currencySummary?.unconverted_wallet_count
                    ? t("excludesUnconvertedWallets").replace("{n}", digits(currencySummary.unconverted_wallet_count))
                    : t("convertedIntoBase")}
                </p>
              </div>

              <div className="card">
                <span>{t("exchangeRates")}</span>
                <strong>{digits(exchangeRates.length)}</strong>
                <button disabled={currencyLoading} onClick={loadCurrencyData}>
                  {currencyLoading ? t("loading") : t("refreshCurrency")}
                </button>
              </div>
            </div>

            {currencyLoading && <p className="status">{t("loading")}</p>}

            <h3>{t("walletCurrencyExposure")}</h3>
            {!currencySummary?.wallets?.length ? (
              <p className="status">{t("noWalletReport")}</p>
            ) : (
              <div className="table">
                {currencySummary.wallets.map((wallet) => (
                  <div className="row" key={wallet.wallet_id}>
                    <span>{wallet.wallet_name || t("wallets")}</span>
                    <span>{currencyName(wallet.wallet_currency)}</span>
                    <span>{t("balance")}: {money(wallet.balance, wallet.wallet_currency)}</span>
                    {wallet.rate_available === false ? (
                      <span className="tone-warning">{t("exchangeRateNotSet")}</span>
                    ) : (
                      <span>{t("rate")}: {digits(wallet.rate_used)}</span>
                    )}
                    <strong>
                      {wallet.rate_available === false
                        ? t("notIncludedInTotal")
                        : money(wallet.converted_balance, currencySummary?.base_currency || activeFamily?.default_currency)}
                    </strong>
                  </div>
                ))}
              </div>
            )}

            <h3>{t("activeCurrencies")}</h3>
            <div className="report-grid">
              {currencies.map((currency) => (
                <div className="report-card" key={currency.id || currency.code}>
                  <h3>{currencyName(currency.code)}</h3>
                  <p>{currency.name}</p>
                  <strong>{currency.symbol || currencyName(currency.code)}</strong>
                  <p>{currency.is_active ? t("active") : t("inactive")}</p>
                </div>
              ))}
              {!currencyLoading && currencies.length === 0 && (
                <p className="status">{t("noCurrenciesFound")}</p>
              )}
            </div>

            <h3>{t("latestExchangeRates")}</h3>
            {exchangeRates.length === 0 ? (
              <p className="status">{t("noExchangeRatesFound")}</p>
            ) : (
              <div className="table">
                {exchangeRates.slice(0, 25).map((rate, idx) => (
                  <div className="row" key={rate.id || `${rate.from_currency}-${rate.to_currency}-${idx}`}>
                    <span>{currencyName(rate.from_currency)} → {currencyName(rate.to_currency)}</span>
                    <strong>{digits(rate.rate)}</strong>
                    <span>{rate.rate_date ? digits(rate.rate_date) : t("noDate")}</span>
                    <span>{rate.source || "Manual"}</span>
                    <span>{rate.is_active ? t("active") : t("inactive")}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {activeFamilyId && activeMenu === "reports" && (
          <Suspense fallback={<section className="panel"><p>{t("loading") || "Loading…"}</p></section>}>
            <ReportsPanel
              t={t}
              digits={digits}
              money={money}
              amount={amount}
              currencyName={currencyName}
              financialReport={financialReport}
              walletReport={walletReport}
              ledgerReport={ledgerReport}
              netWorthReport={netWorthReport}
              categoryReport={categoryReport}
              budgetReport={budgetReport}
              loanReport={loanReport}
              savingsTrendReport={savingsTrendReport}
              apiLogsReport={apiLogsReport}
              reportAccountId={reportAccountId}
              setReportAccountId={setReportAccountId}
              reportsLoading={reportsLoading}
              wallets={wallets}
              activeFamily={activeFamily}
              onRefresh={loadReports}
              onLoadLedger={loadReportLedger}
              onLoadExtraReport={loadExtraReport}
              onDownload={downloadReport}
            />
          </Suspense>
        )}

        {activeFamilyId && activeMenu === "zakat" && (
          <section className="panel">
            <h2>{t("zakatCalculator")}</h2>

            <div className="grid">
              <div className="card">
                <span>{t("totalZakatRecords")}</span>
                <strong>{digits(zakatSummary?.record_count || 0)}</strong>
              </div>
              <div className="card">
                <span>{t("totalZakatDue")}</span>
                <strong>{money(zakatSummary?.total_zakat_due, zakatSummary?.latest?.currency || currencyCode())}</strong>
              </div>
              <div className="card">
                <span>{t("latestStatus")}</span>
                <strong>{zakatSummary?.latest?.is_zakat_due ? t("zakatStatusDue") : t("zakatStatusNotDue")}</strong>
                <p>{zakatSummary?.latest?.calculation_year || zakatForm.calculation_year}</p>
              </div>
            </div>

            <h3>{t("calculateZakat")}</h3>
            <div className="savings-form">
              <input placeholder={t("yearPlaceholder")} value={zakatForm.calculation_year || ""} onChange={(e) => setZakatForm({ ...zakatForm, calculation_year: e.target.value })} />
              <input placeholder={t("cashAmountPlaceholder")} value={zakatForm.cash_amount || ""} onChange={(e) => setZakatForm({ ...zakatForm, cash_amount: e.target.value })} />
              <input placeholder={t("goldGramsPlaceholder")} value={zakatForm.gold_grams || ""} onChange={(e) => setZakatForm({ ...zakatForm, gold_grams: e.target.value })} />
              <input placeholder={t("silverGramsPlaceholder")} value={zakatForm.silver_grams || ""} onChange={(e) => setZakatForm({ ...zakatForm, silver_grams: e.target.value })} />
              <input placeholder={t("goldValuePlaceholder")} value={zakatForm.gold_value || ""} onChange={(e) => setZakatForm({ ...zakatForm, gold_value: e.target.value })} />
              <input placeholder={t("silverValuePlaceholder")} value={zakatForm.silver_value || ""} onChange={(e) => setZakatForm({ ...zakatForm, silver_value: e.target.value })} />
              <input placeholder={t("investmentValuePlaceholder")} value={zakatForm.investment_value || ""} onChange={(e) => setZakatForm({ ...zakatForm, investment_value: e.target.value })} />
              <input placeholder={t("businessAssetsPlaceholder")} value={zakatForm.business_assets || ""} onChange={(e) => setZakatForm({ ...zakatForm, business_assets: e.target.value })} />
              <input placeholder={t("receivablesPlaceholder")} value={zakatForm.receivables || ""} onChange={(e) => setZakatForm({ ...zakatForm, receivables: e.target.value })} />
              <input placeholder={t("deductibleDebtsPlaceholder")} value={zakatForm.deductible_debts || ""} onChange={(e) => setZakatForm({ ...zakatForm, deductible_debts: e.target.value })} />
              <select value={zakatForm.nisab_metal || "SILVER"} onChange={(e) => setZakatForm({ ...zakatForm, nisab_metal: e.target.value })}>
                <option value="SILVER">{t("nisabMetalSilver")}</option>
                <option value="GOLD">{t("nisabMetalGold")}</option>
              </select>
              <input placeholder={t("nisabAmountPlaceholder")} value={zakatForm.nisab_amount || ""} onChange={(e) => setZakatForm({ ...zakatForm, nisab_amount: e.target.value })} />
              <input placeholder={t("note")} value={zakatForm.note || ""} onChange={(e) => setZakatForm({ ...zakatForm, note: e.target.value })} />
              <button type="button" onClick={calculateZakat}>{t("calculateZakat")}</button>
              <button type="button" onClick={loadZakat}>{t("refreshZakat")}</button>
              <button type="button" onClick={fillNisabFromRates}>{t("autoNisabFromRates")}</button>
            </div>
            <h3>{t("zakatMetalRates")}</h3>
            <div className="savings-form">
              <input placeholder={t("goldRatePlaceholder")} value={zakatForm.gold_rate || ""} onChange={(e) => setZakatForm({ ...zakatForm, gold_rate: e.target.value })} />
              <button type="button" onClick={() => saveMetalRate("GOLD")}>{t("saveGoldRate")}</button>
              <input placeholder={t("silverRatePlaceholder")} value={zakatForm.silver_rate || ""} onChange={(e) => setZakatForm({ ...zakatForm, silver_rate: e.target.value })} />
              <button type="button" onClick={() => saveMetalRate("SILVER")}>{t("saveSilverRate")}</button>
              <button type="button" onClick={loadMetalRates}>{t("loadRates")}</button>
            </div>
            {metalRates ? (
              <p className="status">
                {(metalRates.rates || []).map((r) => `${r.metal}=${r.rate_bdt}`).join(" · ") || t("noMetalRatesYet")}
              </p>
            ) : null}

            <h3>{t("zakatHistory")}</h3>
            {zakatRecords.length === 0 ? (
              <p className="status">{t("noZakatRecords")}</p>
            ) : (
              <div className="table">
                {zakatRecords.map((record) => (
                  <div className="row" key={record.id}>
                    <span>{record.calculation_year}</span>
                    <span>{t("zakatableLabel")} {money(record.zakatable_amount, record.currency)}</span>
                    <span>{t("nisabLabel")} {money(record.nisab_amount, record.currency)}</span>
                    <strong>{money(record.zakat_due, record.currency)}</strong>
                    <span>{record.is_zakat_due ? t("zakatStatusDue") : t("zakatStatusNotDue")}</span>
                    <span>{record.created_at ? digits(record.created_at) : t("noDate")}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {activeFamilyId && isPhase15Menu(activeMenu) && (
          <Suspense fallback={<section className="panel"><p>{t("loading") || "Loading…"}</p></section>}>
            <Phase15Panel
              t={t}
              digits={digits}
              money={money}
              phase15Summary={phase15Summary}
              phase15Items={phase15Items}
              phase15Form={phase15Form}
              setPhase15Form={setPhase15Form}
              phase15ActiveTab={phase15ActiveTab}
              setPhase15ActiveTab={setPhase15ActiveTab}
              editingPhase15Id={editingPhase15Id}
              governanceMembers={governanceMembers}
              onSave={savePhase15Item}
              onEdit={startEditPhase15Item}
              onCancelEdit={(moduleType) => resetPhase15Form(moduleType || phase15ActiveTab)}
              onClose={closePhase15Item}
              onRefresh={loadPhase15}
            />
          </Suspense>
        )}

        {activeFamilyId && isPhase16Menu(activeMenu) && (
          <Suspense fallback={<section className="panel"><p>{t("loading") || "Loading…"}</p></section>}>
            <Phase16Panel
              t={t}
              digits={digits}
              money={money}
              phase16Summary={phase16Summary}
              phase16Items={phase16Items}
              phase16Form={phase16Form}
              setPhase16Form={setPhase16Form}
              phase16ActiveTab={phase16ActiveTab}
              setPhase16ActiveTab={setPhase16ActiveTab}
              editingPhase16Id={editingPhase16Id}
              governanceMembers={governanceMembers}
              wallets={wallets}
              documentFile={documentFile}
              setDocumentFile={setDocumentFile}
              onSave={savePhase16Item}
              onEdit={startEditPhase16Item}
              onCancelEdit={(moduleType) => resetPhase16Form(moduleType || phase16ActiveTab)}
              onClose={closePhase16Item}
              onRefresh={loadPhase16}
              onUploadDocument={uploadDocumentForItem}
              onDownloadDocument={downloadPhase16Document}
            />
          </Suspense>
        )}

        {activeFamilyId && activeMenu === "grocery" && (
          <GroceryPanel
            t={t}
            digits={digits}
            money={money}
            groceryTab={groceryTab}
            setGroceryTab={setGroceryTab}
            groceryLists={groceryLists}
            groceryItems={groceryItems}
            groceryVendors={groceryVendors}
            groceryVendorSummary={groceryVendorSummary}
            groceryPriceHistory={groceryPriceHistory}
            groceryActivity={groceryActivity}
            groceryCollaboration={groceryCollaboration}
            groceryWsState={groceryWsState}
            groceryListForm={groceryListForm}
            setGroceryListForm={setGroceryListForm}
            groceryItemForm={groceryItemForm}
            setGroceryItemForm={setGroceryItemForm}
            groceryVendorForm={groceryVendorForm}
            setGroceryVendorForm={setGroceryVendorForm}
            groceryScanForm={groceryScanForm}
            setGroceryScanForm={setGroceryScanForm}
            groceryBarcodeLookup={groceryBarcodeLookup}
            groceryOcrPreview={groceryOcrPreview}
            groceryExpenseForm={groceryExpenseForm}
            setGroceryExpenseForm={setGroceryExpenseForm}
            activeGroceryListId={activeGroceryListId}
            wallets={wallets}
            categories={categories}
            onRefresh={loadGrocery}
            onCreateList={createGroceryList}
            onSelectList={selectGroceryList}
            onCreateItem={createGroceryItem}
            onCreateVendor={createGroceryVendor}
            onLookupBarcode={lookupGroceryBarcode}
            onApplyBarcode={applyGroceryBarcodeToForm}
            onParseOcr={parseGroceryOcrText}
            onParseOcrImage={parseGroceryOcrImage}
            onAddOcrSuggestion={addGroceryOcrSuggestion}
            onAddAllOcrSuggestions={addAllGroceryOcrSuggestions}
            onMarkBought={markGroceryBought}
            onPostExpense={postGroceryExpense}
            localOutboxPending={localOutboxPending}
            groceryPendingRows={groceryPendingRows}
            onReplayPendingSync={() => pushLocalSyncOutbox()}
            syncPushLoading={syncPushLoading}
            cloudLocalMode={isCloudLocalMode()}
          />
        )}

        {activeFamilyId && activeMenu === "audit" && (
          <AuditPanel
            t={t}
            digits={digits}
            auditSummary={auditSummary}
            auditRows={auditRows}
            auditLoading={auditLoading}
            activeFamily={activeFamily}
            activeFamilyId={activeFamilyId}
            onRefresh={loadAuditTrail}
            apiGet={apiGet}
            onError={(msg) => setMessage(msg, "error")}
          />
        )}

        {activeFamilyId && activeMenu === "notifications" && (
          <NotificationsPanel
            t={t}
            digits={digits}
            appLanguage={appLanguage}
            notifications={notifications}
            notificationSummary={notificationSummary}
            notificationDelivery={notificationDelivery}
            notificationsLoading={notificationsLoading}
            pushDevices={pushDevices}
            pushTokenDraft={pushTokenDraft}
            setPushTokenDraft={setPushTokenDraft}
            pushPlatform={pushPlatform}
            setPushPlatform={setPushPlatform}
            onRefresh={loadNotifications}
            onScan={scanNotifications}
            onMarkAllRead={markAllNotificationsRead}
            onMarkRead={markNotificationRead}
            onDelete={deleteNotification}
            onTestEmail={sendTestNotificationEmail}
            onRegisterDevice={registerPushDevice}
            onUnregisterDevice={unregisterPushDevice}
            onTestPush={sendTestPushNotification}
            onEnableBrowserPush={() => enableBrowserPushNotifications()}
          />
        )}

        {activeFamilyId && activeMenu === "backup" && (
          <section className="panel">
            <h2>{t("backupCenter")}</h2>

            <div className="grid">
              <div className="card">
                <span>{t("databaseIntegrity")}</span>
                <strong>{backupIntegrity?.ok ? "OK" : "Unknown"}</strong>
                <p>{backupIntegrity?.integrity_check || t("refreshToCheck")}</p>
              </div>

              <div className="card">
                <span>{t("availableBackups")}</span>
                <strong>{digits(backupList.count || 0)}</strong>
                <p>{t("familyScopedBackupFiles")}</p>
              </div>

              <div className="card">
                <span>{t("restoreSafety")}</span>
                <strong>{t("previewOnly")}</strong>
                <p>{t("fullRestoreServerStopped")}</p>
              </div>
            </div>

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
              <button disabled={backupLoading} onClick={loadBackups}>
                {backupLoading ? t("loadingBackups") : t("refreshBackups")}
              </button>
              <button disabled={backupCreating} onClick={createBackup}>
                {backupCreating ? t("creatingBackup") : t("createBackup")}
              </button>
            </div>

            <h3>{t("backupFiles")}</h3>
            {backupList.backups.length === 0 ? (
              <p className="status">{t("backupFiles")}: 0</p>
            ) : (
              <div className="table">
                {backupList.backups.map((backup) => (
                  <div className="row" key={backup.file_name}>
                    <span>{backup.file_name}</span>
                    <span>{digits(backup.size_bytes)} bytes</span>
                    <span>{backup.created_at ? digits(backup.created_at) : t("noDate")}</span>
                    <button onClick={() => previewRestore(backup.file_name)}>
                      {backupPreviewingFile === backup.file_name ? t("previewing") : t("previewRestore")}
                    </button>
                    <button onClick={() => downloadBackup(backup.file_name)}>{t("download")}</button>
                  </div>
                ))}
              </div>
            )}

            {backupPreview && (
              <>
                <h3>{t("restorePreview")}</h3>
                <div className="card">
                  <span>{backupPreview.file_name}</span>
                  <strong>{backupPreview.restore_safe ? "Valid Backup" : "Not Safe"}</strong>
                  <p>{backupPreview.message}</p>
                  <p>Contains: {digits((backupPreview.contains_files || []).join(", "))}</p>
                </div>
              </>
            )}
          </section>
        )}

        {activeFamilyId && activeMenu === "sync" && (
          <SyncPanel
            t={t}
            digits={digits}
            syncTab={syncTab}
            setSyncTab={setSyncTab}
            syncStatus={syncStatus}
            syncConflicts={syncConflicts}
            syncResolvedConflicts={syncResolvedConflicts}
            syncPullPreview={syncPullPreview}
            syncLoading={syncLoading}
            syncPullLoading={syncPullLoading}
            syncPushLoading={syncPushLoading}
            syncResolveLoadingId={syncResolveLoadingId}
            deviceId={SYNC_DEVICE_ID}
            localOutboxPending={localOutboxPending}
            browserOnline={browserOnline}
            offlineStoreMode="IndexedDB"
            offlineStoreNote={
              t("pcOfflineDbNote") ||
              "PC uses IndexedDB outbox. SQLCipher applies on native mobile builds."
            }
            autoSyncEnabled={autoSyncEnabled}
            onToggleAutoSync={toggleAutoSync}
            lastAutoSyncAt={lastAutoSyncAt}
            onRefresh={loadSyncStatus}
            onPull={pullSyncPreview}
            onPush={() => pushLocalSyncOutbox()}
            onResolve={resolveSyncConflict}
            syncLogs={syncLogs}
            syncLogsLoading={syncLogsLoading}
            onLoadSyncLogs={loadSyncLogs}
          />
        )}

        {activeFamilyId && isSettingsMenu(activeMenu) && (
          <SettingsPanel
            t={t}
            digits={digits}
            settingsTab={settingsTab}
            setSettingsTab={setSettingsTab}
            settingsLoading={settingsLoading}
            settingsSaving={settingsSaving}
            currentUser={{
              ...(currentUser || {}),
              uid: firebaseUser?.uid || currentUser?.uid,
              firebase_uid: firebaseUser?.uid || currentUser?.firebase_uid,
              email: currentUser?.email || firebaseUser?.email || email || "",
            }}
            email={email || firebaseUser?.email || ""}
            avatarUrl={displayAvatarUrl || avatarUrl(currentUser)}
            onUploadPhoto={uploadProfilePhoto}
            onRemovePhoto={removeProfilePhoto}
            activeFamily={activeFamily}
            familyCurrencyForm={familyCurrencyForm}
            setFamilyCurrencyForm={setFamilyCurrencyForm}
            familyTimezoneForm={familyTimezoneForm}
            setFamilyTimezoneForm={setFamilyTimezoneForm}
            onSaveFamilySettings={saveFamilySettings}
            myPermissions={myPermissions}
            effectivePermissions={effectivePermissions}
            permissionOverrides={permissionOverrides}
            memberPermissions={memberPermissions}
            governanceMembers={governanceMembers}
            permissionForms={permissionForms}
            updatePermissionForm={updatePermissionForm}
            saveMemberPermission={saveMemberPermission}
            toggleMemberPermission={toggleMemberPermission}
            permissionSavingMemberId={permissionSavingMemberId}
            commonPermissionKeys={COMMON_PERMISSION_KEYS}
            currentLanguage={currentLanguage}
            appLanguage={appLanguage}
            changeAppLanguage={changeAppLanguage}
            lockedLanguages={LOCKED_LANGUAGES}
            refreshToken={refreshToken}
            securityAction={securityAction}
            refreshSession={refreshSession}
            requestPasswordReset={requestPasswordReset}
            resendVerification={resendVerification}
            emailStatus={emailStatus}
            onRequestDeleteAccountOtp={requestDeleteAccountOtp}
            onConfirmDeleteAccount={confirmDeleteAccount}
            deleteAccountStep={deleteAccountStep}
            deleteAccountOtp={deleteAccountOtp}
            setDeleteAccountOtp={setDeleteAccountOtp}
            deleteAccountBusy={deleteAccountBusy}
            onRefresh={() => {
              loadSettingsData();
              if (settingsTab === "permissions" || parseSettingsTab(activeMenu) === "permissions") {
                loadFamilyGovernance();
              }
              if (settingsTab === "categories" || parseSettingsTab(activeMenu) === "categories") {
                loadCategories();
              }
            }}
            categories={categories}
            categoriesSaving={categoriesSaving}
            categoryDeletingId={categoryDeletingId}
            onCreateCategory={createCategory}
            onDeleteCategory={deleteCategoryById}
            onLoadCategories={loadCategories}
            apiBase={apiBase}
            cloudOnlyMode={cloudOnlyMode}
            onApiBaseChange={(next) => setApiBase(persistApiBase(next))}
            browserOnline={browserOnline}
            cloudBusy={cloudBusy}
            cloudAutoSync={cloudAutoSync}
            onCloudAutoSyncChange={handleCloudAutoSyncChange}
            localFolderSupported={LOCAL_FOLDER_SUPPORTED}
            localFolderLabel={localFolderLabel}
            onPickLocalFolder={handlePickLocalFolder}
            onLocalBackup={handleLocalBackup}
            onLocalRestore={handleLocalRestore}
            onLocalDownload={handleLocalDownload}
            driveConfigured={DRIVE_CONFIGURED}
            driveConnected={driveConnected}
            driveFiles={driveFiles}
            onDriveConnect={handleDriveConnect}
            onDriveDisconnect={handleDriveDisconnect}
            onDriveUpload={handleDriveUpload}
            onDriveRestore={handleDriveRestore}
          />
        )}

        <MobileBottomNavigation navItems={mobileNavItems} activeMenu={activeMenu} setActiveMenu={setActiveMenu} />
        {status ? <p className="status arch-status-toast">{status}</p> : null}
      </main>
    </div>
  );
}

export default App;
