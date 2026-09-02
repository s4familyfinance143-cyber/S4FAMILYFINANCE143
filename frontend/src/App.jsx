import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";
import "./styles/architecture-shell.css";
import "./styles/design-polish.css";
import arMessages from "./i18n/messages/ar.json";
import bnMessages from "./i18n/messages/bn.json";
import enMessages from "./i18n/messages/en.json";
import hiMessages from "./i18n/messages/hi.json";
import urMessages from "./i18n/messages/ur.json";
import { SplashScreen } from "./components/auth/SplashScreen";
import { FamilyAuthGate } from "./components/auth/FamilyAuthGate";
import {
  enqueueGroceryChange,
  enqueueOutboxChange,
  flushLocalOutbox,
  isBrowserOnline,
  listPendingOutbox,
  mergePullIntoGroceryState,
} from "./lib/offlineSync";
import { loadOfflineSnapshot, saveOfflineSnapshot } from "./lib/offlineCache";
import {
  cacheReportExport,
  flushPendingUploads,
  getCachedReportExport,
  queueDocumentUpload,
} from "./lib/offlineBlobs";
import { ExecutiveDashboard } from "./components/dashboard/ExecutiveDashboard";
import { DesktopSidebar, MobileBottomNavigation, TopHeader } from "./components/layout/AppNavigation";
import { Phase15Panel } from "./components/phase/Phase15Panel";
import { Phase16Panel } from "./components/phase/Phase16Panel";
import { SettingsPanel } from "./components/settings/SettingsPanel";
import { GroceryPanel } from "./components/grocery/GroceryPanel";
import { SyncPanel } from "./components/sync/SyncPanel";
import { AuditPanel } from "./components/audit/AuditPanel";
import { NotificationsPanel } from "./components/notifications/NotificationsPanel";
import { ReportsPanel } from "./components/reports/ReportsPanel";
import { WalletsPanel } from "./components/finance/WalletsPanel";
import { TransactionsPanel } from "./components/finance/TransactionsPanel";
import { SavingsPanel } from "./components/finance/SavingsPanel";
import { LoansPanel } from "./components/finance/LoansPanel";
import { TagsPanel } from "./components/finance/TagsPanel";
import { ArchitectureCutoverPanel } from "./components/finance/ArchitectureCutoverPanel";
import { BudgetsPanel } from "./components/finance/BudgetsPanel";
import { FamilyGovernancePanel } from "./components/family/FamilyGovernancePanel";
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
  updatePath as lifeUpdatePath,
} from "./lifeArchitectureApi";
import {
  isFirebaseConfigured,
  subscribeFirebaseAuth,
  firebaseSignInEmail,
  firebaseRegisterEmail,
  firebaseSignInGoogle,
  firebaseSignOut,
  pushCloudSnapshot,
  pullCloudSnapshot,
  getCloudSnapshotMeta,
  ensureUserProfile,
  getUserFamilyProfile,
  createCloudFamilyAccount,
} from "./firebase";
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
  loadCloudOnlyMode,
  persistCloudOnlyMode,
  loadCloudFamilyId,
  persistCloudFamilyId,
  clearCloudSession,
} from "./lib/cloudSession";
import { hydrateFamilyFromOfflineCache, buildDashboardFromCache } from "./lib/hydrateFromCache";
import { isNativeApp } from "./lib/runtimeEnv";
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

const FIREBASE_CONFIGURED = isFirebaseConfigured();
const FIREBASE_FIRST_MODE = isFirebaseFirstMode();
const DRIVE_CONFIGURED = isGoogleDriveConfigured();
const LOCAL_FOLDER_SUPPORTED = isLocalFolderBackupSupported();

try {
  const savedTheme = localStorage.getItem("s4-theme");
  if (savedTheme === "dark") document.documentElement.setAttribute("data-theme", "dark");
} catch {
  /* ignore */
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

const DEFAULT_API_BASE = normalizeApiBase(
  import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000",
);
const API_BASE_STORAGE_KEY = "s4_api_base";
const AUTO_SYNC_STORAGE_KEY = "s4_auto_sync";
const AUTO_SYNC_INTERVAL_MS = 45000;
const DEFAULT_EMAIL = import.meta.env.VITE_DEFAULT_EMAIL || "";
const DEFAULT_PASSWORD = "";
const SYNC_DEVICE_ID = "web-dashboard";
const LANGUAGE_STORAGE_KEY = "s4-language";

function readStoredApiBase() {
  try {
    const saved = localStorage.getItem(API_BASE_STORAGE_KEY);
    if (saved && String(saved).trim()) {
      return normalizeApiBase(saved);
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

function localizedPack(messages, englishPack) {
  return Object.fromEntries(
    Object.keys(englishPack).map((key) => {
      if (!(key in messages)) throw new Error(`Missing localized UI text: ${key}`);
      return [key, messages[key]];
    }),
  );
}
const LANGUAGE_DIGITS = {
  bn: ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"],
  ar: ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"],
  hi: ["०", "१", "२", "३", "४", "५", "६", "७", "८", "९"],
  ur: ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"],
  en: ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"],
};
const CURRENCY_NAMES = {
  AED: { bn: "আমিরাতি দিরহাম", ar: "درهم إماراتي", hi: "यूएई दिरहम", ur: "اماراتی درہم", en: "UAE Dirham" },
  BDT: { bn: "বাংলাদেশি টাকা", ar: "تاكا بنغلاديشي", hi: "बांग्लादेशी टका", ur: "بنگلہ دیشی ٹکا", en: "Bangladeshi Taka" },
  USD: { bn: "মার্কিন ডলার", ar: "دولار أمريكي", hi: "अमेरिकी डॉलर", ur: "امریکی ڈالر", en: "US Dollar" },
  EUR: { bn: "ইউরো", ar: "يورو", hi: "यूरो", ur: "یورو", en: "Euro" },
  SAR: { bn: "সৌদি রিয়াল", ar: "ريال سعودي", hi: "सऊदी रियाल", ur: "سعودی ریال", en: "Saudi Riyal" },
  INR: { bn: "ভারতীয় রুপি", ar: "روبية هندية", hi: "भारतीय रुपया", ur: "بھارتی روپیہ", en: "Indian Rupee" },
  PKR: { bn: "পাকিস্তানি রুপি", ar: "روبية باكستانية", hi: "पाकिस्तानी रुपया", ur: "پاکستانی روپیہ", en: "Pakistani Rupee" },
  GBP: { bn: "ব্রিটিশ পাউন্ড", ar: "جنيه إسترليني", hi: "ब्रिटिश पाउंड", ur: "برطانوی پاؤنڈ", en: "British Pound" },
};
/** Short unit by UI language — Bangla “টাকা”, English “Tk”, Arabic “درهم”, etc. */
const CURRENCY_SHORT = {
  BDT: { bn: "টাকা", en: "Tk", ar: "تاكا", hi: "टका", ur: "ٹکا" },
  USD: { bn: "ডলার", en: "USD", ar: "دولار", hi: "डॉलर", ur: "ڈالر" },
  EUR: { bn: "ইউরো", en: "EUR", ar: "يورو", hi: "यूरो", ur: "یورو" },
  AED: { bn: "দিরহাম", en: "AED", ar: "درهم", hi: "दिरहम", ur: "درہم" },
  SAR: { bn: "রিয়াল", en: "SAR", ar: "ريال", hi: "रियाल", ur: "ریال" },
  INR: { bn: "রুপি", en: "INR", ar: "روبية", hi: "₹", ur: "روپیہ" },
  PKR: { bn: "রুপি", en: "PKR", ar: "روبية", hi: "रुपया", ur: "روپیہ" },
  GBP: { bn: "পাউন্ড", en: "GBP", ar: "جنيه", hi: "पाउंड", ur: "پاؤنڈ" },
};
const UI_TEXT = {
  bn: {
    secureDashboard: "নিরাপদ পরিবার ফাইন্যান্স ড্যাশবোর্ড",
    email: "ইমেইল",
    password: "পাসওয়ার্ড",
    login: "লগইন",
    loggedIn: "লগইন করা হয়েছে",
    activeFamily: "সক্রিয় পরিবার",
    refresh: "রিফ্রেশ",
    loadingFamilies: "পরিবার লোড হচ্ছে...",
    noFamilyFound: "কোনো পরিবার পাওয়া যায়নি",
    dashboard: "ড্যাশবোর্ড",
    wallets: "ওয়ালেট",
    transactions: "লেনদেন",
    savings: "সঞ্চয়",
    loans: "ঋণ",
    budgets: "বাজেট",
    recurring: "পুনরাবৃত্তি",
    goals: "লক্ষ্য",
    family: "পরিবার",
    currency: "মুদ্রা",
    reports: "রিপোর্ট",
    auditCenter: "অডিট সেন্টার",
    backupCenter: "ব্যাকআপ সেন্টার",
    offlineSync: "অফলাইন সিঙ্ক",
    controlCenter: "পারিবারিক ফাইন্যান্স কন্ট্রোল সেন্টার",
    offlineReady: "অফলাইন প্রস্তুত",
    searchModules: "মডিউল, লেনদেন বা সদস্য খুঁজুন...",
    syncAllOk: "সব ডেটা সিঙ্ক হয়েছে",
    familyFinancialPicture: "আপনার পরিবারের আর্থিক চিত্র",
    familyFinancialSub: "ওয়ালেট, আয়-ব্যয়, বাজেট, ঋণ এবং অফলাইন সিঙ্ক—সব গুরুত্বপূর্ণ তথ্য এক জায়গায়।",
    netWorth: "মোট নেট ওয়ার্থ",
    monthlyIncome: "এই মাসের আয়",
    monthlyExpense: "এই মাসের ব্যয়",
    outstandingLoan: "বকেয়া ঋণ",
    incomeVsExpense: "আয় বনাম ব্যয়",
    last7MonthsTrend: "গত ৭ মাসের প্রবণতা",
    assetDistribution: "সম্পদ বণ্টন",
    quickWork: "দ্রুত কাজ",
    mostUsedActions: "সবচেয়ে বেশি ব্যবহৃত কাজ",
    budgetStatus: "বাজেট অবস্থা",
    recentTransactions: "সাম্প্রতিক লেনদেন",
    allModules: "সব মডিউল",
    exportReport: "রিপোর্ট এক্সপোর্ট",
    newTransaction: "নতুন লেনদেন",
    income: "আয়",
    expense: "খরচ",
    transfer: "ট্রান্সফার",
    navOverview: "ওভারভিউ",
    navFinance: "ফাইন্যান্স",
    navFamilyGov: "পারিবারিক গভর্নেন্স",
    navDailyLife: "দৈনন্দিন জীবন",
    navAssetsPlanning: "সম্পদ ও পরিকল্পনা",
    navSystem: "রিপোর্ট ও সিস্টেম",
    planner: "প্ল্যানার",
    navTasks: "টাস্ক",
    navCalendar: "ক্যালেন্ডার",
    createTask: "টাস্ক তৈরি",
    createEvent: "ইভেন্ট তৈরি",
    taskTitle: "টাস্ক শিরোনাম",
    eventTitle: "ইভেন্ট শিরোনাম",
    dueDate: "শেষ তারিখ",
    eventDate: "ইভেন্ট তারিখ",
    startTime: "শুরু",
    endTime: "শেষ",
    priority: "অগ্রাধিকার",
    eventType: "ইভেন্ট ধরন",
    complete: "সম্পন্ন",
    delete: "মুছুন",
    noTasks: "কোনো টাস্ক নেই",
    noEvents: "কোনো ইভেন্ট নেই",
    titleRequired: "শিরোনাম প্রয়োজন",
    eventRequired: "শিরোনাম ও তারিখ প্রয়োজন",
    makeAdmin: "অ্যাডমিন করুন",
    makeMember: "মেম্বার করুন",
    ownershipTransfer: "মালিকানা হস্তান্তর",
    requestTransfer: "হস্তান্তর অনুরোধ",
    pendingTransfers: "মুলতুবি হস্তান্তর",
    acceptTransfer: "গ্রহণ",
    adminApproveTransfer: "অ্যাডমিন অনুমোদন",
    cancelTransfer: "বাতিল",
    selectMember: "সদস্য নির্বাচন",
    removeMember: "সদস্য সরান",
    deactivateFamily: "পরিবার নিষ্ক্রিয়",
    voidTransaction: "বাতিল (void)",
    apiBaseUrl: "API বেস URL",
    saveApiBase: "API URL সংরক্ষণ",
    apiBaseHelp: "লগইনের পর API সার্ভার ঠিকানা পরিবর্তন করতে পারেন।",
    parseReceiptImage: "রসিদ ছবি পার্স",
    ocrImageHint: "রসিদের ছবি আপলোড করে OCR চালান",
    navWalletAccount: "ওয়ালেট / হিসাব",
    navAllTransactions: "সব লেনদেন",
    navAccountTransfer: "হিসাব ট্রান্সফার",
    navSavingsGoals: "সঞ্চয় লক্ষ্য",
    navLoanDebt: "ঋণ / দেনা",
    navFamilyMembers: "পরিবারের সদস্য",
    navJoinRequests: "যোগদানের অনুরোধ",
    navInviteCodes: "ইনভাইট কোড",
    navRolesPermissions: "রোল ও অনুমতি",
    navHealthExpense: "স্বাস্থ্য ব্যয়",
    navEducationFund: "শিক্ষা তহবিল",
    navVehicle: "যানবাহন",
    navSubscriptions: "সাবস্ক্রিপশন",
    navInvestments: "বিনিয়োগ",
    navProperty: "সম্পত্তি",
    navZakat: "যাকাত",
    navDocumentVault: "ডকুমেন্ট ভল্ট",
    navReportsAnalytics: "রিপোর্ট ও বিশ্লেষণ",
    navAuditLogs: "অডিট লগ",
    brandTagline: "অফলাইন-ফার্স্ট পারিবারিক ফাইন্যান্স",
    ownerFullAccess: "মালিক • সম্পূর্ণ অ্যাক্সেস",
    theme: "থিম",
    openMobileMenu: "মোবাইল মেনু খুলুন",
    executiveOverview: "এক্সিকিউটিভ ওভারভিউ",
    walletBalance: "ওয়ালেট ব্যালেন্স",
    cashBank: "নগদ / ব্যাংক",
    goldAsset: "স্বর্ণ / সম্পদ",
    otherAsset: "অন্যান্য",
    invite: "আমন্ত্রণ",
    details: "বিস্তারিত",
    pending: "মুলতুবি",
    failed: "ব্যর্থ",
    unread: "অপঠিত",
    category: "ক্যাটাগরি",
    account: "হিসাব",
    date: "তারিখ",
    amount: "পরিমাণ",
    pendingSyncLabel: "সিঙ্ক মুলতুবি",
    synced: "সিঙ্ক হয়েছে",
    monthUtilization: "চলতি মাসের ব্যবহার",
    deviceQueueStatus: "ডিভাইস কিউ ও সার্ভার অবস্থা",
    systemNormal: "সিস্টেম স্বাভাবিক",
    syncQueueActive: "সিঙ্ক কিউ সক্রিয়",
    lastSync: "সর্বশেষ সিঙ্ক",
    noTransactionsFound: "কোনো লেনদেন পাওয়া যায়নি",
    totalAssets: "মোট সম্পদ",
    assetGroupSub: "হিসাব ও সম্পদ গ্রুপ",
    upcomingDue: "আসন্ন বাকি",
    upcomingDueSub: "ঋণ, সাবস্ক্রিপশন ও ডকুমেন্ট",
    noUpcomingDue: "কোনো আসন্ন বাকি নেই",
    familyGovSub: "মালিক, সদস্য রোল ও মুলতুবি অনুমোদন",
    manage: "ম্যানেজ",
    allModulesSub: "আর্কিটেকচার কভারেজ শর্টকাট",
    openAll: "সব খুলুন",
    statusOk: "ঠিক আছে",
    member: "সদস্য",
    ownerAudit: "মালিক · অডিট",
    settings: "সেটিংস",
    logout: "লগআউট",
    profile: "প্রোফাইল",
    status: "স্ট্যাটাস",
    profilePhoto: "প্রোফাইল ছবি",
    changePhoto: "ছবি বদলান",
    removePhoto: "ছবি সরান",
    photoUpdated: "প্রোফাইল ছবি আপডেট হয়েছে",
    photoRemoved: "প্রোফাইল ছবি সরানো হয়েছে",
    photoUploadFailed: "ছবি আপলোড ব্যর্থ",
    photoHint: "JPG / PNG / WebP · সর্বোচ্চ ২ MB",
    emailVerified: "ইমেইল যাচাই",
    timezone: "টাইমজোন",
    myRole: "আমার ভূমিকা",
    effectivePermissions: "কার্যকর অনুমতি",
    overrides: "ওভাররাইড",
    languageLock: "ভাষা লক",
    allowed: "অনুমোদিত",
    security: "নিরাপত্তা",
    session: "সেশন",
    refreshReady: "রিফ্রেশ প্রস্তুত",
    loginRequired: "লগইন প্রয়োজন",
    refreshSession: "সেশন রিফ্রেশ",
    refreshing: "রিফ্রেশ হচ্ছে...",
    passwordReset: "পাসওয়ার্ড রিসেট",
    requestPasswordReset: "পাসওয়ার্ড রিসেট অনুরোধ",
    requesting: "অনুরোধ হচ্ছে...",
    emailVerification: "ইমেইল যাচাই",
    verified: "যাচাইকৃত",
    notVerified: "যাচাই হয়নি",
    resendVerification: "যাচাই আবার পাঠান",
    sending: "পাঠানো হচ্ছে...",
  },
  ar: {
    secureDashboard: "لوحة مالية عائلية آمنة",
    email: "البريد الإلكتروني",
    password: "كلمة المرور",
    login: "تسجيل الدخول",
    loggedIn: "تم تسجيل الدخول",
    activeFamily: "العائلة النشطة",
    refresh: "تحديث",
    loadingFamilies: "جار تحميل العائلات...",
    noFamilyFound: "لم يتم العثور على عائلة",
    dashboard: "لوحة التحكم",
    wallets: "المحافظ",
    transactions: "المعاملات",
    savings: "الادخار",
    loans: "القروض",
    budgets: "الميزانيات",
    recurring: "المتكرر",
    goals: "الأهداف",
    family: "العائلة",
    currency: "العملة",
    reports: "التقارير",
    auditCenter: "مركز التدقيق",
    backupCenter: "مركز النسخ الاحتياطي",
    offlineSync: "المزامنة دون اتصال",
    settings: "الإعدادات",
    logout: "تسجيل الخروج",
    profile: "الملف الشخصي",
    status: "الحالة",
    emailVerified: "تأكيد البريد",
    timezone: "المنطقة الزمنية",
    myRole: "دوري",
    effectivePermissions: "الصلاحيات الفعالة",
    overrides: "التجاوزات",
    languageLock: "قفل اللغة",
    allowed: "المسموح",
    security: "الأمان",
    session: "الجلسة",
    refreshReady: "التحديث جاهز",
    loginRequired: "تسجيل الدخول مطلوب",
    refreshSession: "تحديث الجلسة",
    refreshing: "جار التحديث...",
    passwordReset: "إعادة تعيين كلمة المرور",
    requestPasswordReset: "طلب إعادة تعيين كلمة المرور",
    requesting: "جار الطلب...",
    emailVerification: "تأكيد البريد الإلكتروني",
    verified: "مؤكد",
    notVerified: "غير مؤكد",
    resendVerification: "إعادة إرسال التأكيد",
    sending: "جار الإرسال...",
  },
  hi: {
    secureDashboard: "सुरक्षित परिवार वित्त डैशबोर्ड",
    email: "ईमेल",
    password: "पासवर्ड",
    login: "लॉगिन",
    loggedIn: "लॉगिन किया गया",
    activeFamily: "सक्रिय परिवार",
    refresh: "रीफ्रेश",
    loadingFamilies: "परिवार लोड हो रहे हैं...",
    noFamilyFound: "कोई परिवार नहीं मिला",
    dashboard: "डैशबोर्ड",
    wallets: "वॉलेट",
    transactions: "लेनदेन",
    savings: "बचत",
    loans: "ऋण",
    budgets: "बजट",
    recurring: "दोहराव",
    goals: "लक्ष्य",
    family: "परिवार",
    currency: "मुद्रा",
    reports: "रिपोर्ट",
    auditCenter: "ऑडिट सेंटर",
    backupCenter: "बैकअप सेंटर",
    offlineSync: "ऑफलाइन सिंक",
    settings: "सेटिंग्स",
    logout: "लॉगआउट",
    profile: "प्रोफाइल",
    status: "स्थिति",
    emailVerified: "ईमेल सत्यापित",
    timezone: "समय क्षेत्र",
    myRole: "मेरी भूमिका",
    effectivePermissions: "प्रभावी अनुमतियां",
    overrides: "ओवरराइड",
    languageLock: "भाषा लॉक",
    allowed: "अनुमत",
    security: "सुरक्षा",
    session: "सेशन",
    refreshReady: "रीफ्रेश तैयार",
    loginRequired: "लॉगिन आवश्यक",
    refreshSession: "सेशन रीफ्रेश",
    refreshing: "रीफ्रेश हो रहा है...",
    passwordReset: "पासवर्ड रीसेट",
    requestPasswordReset: "पासवर्ड रीसेट अनुरोध",
    requesting: "अनुरोध हो रहा है...",
    emailVerification: "ईमेल सत्यापन",
    verified: "सत्यापित",
    notVerified: "सत्यापित नहीं",
    resendVerification: "सत्यापन फिर भेजें",
    sending: "भेजा जा रहा है...",
  },
  ur: {
    secureDashboard: "محفوظ فیملی فنانس ڈیش بورڈ",
    email: "ای میل",
    password: "پاس ورڈ",
    login: "لاگ ان",
    loggedIn: "لاگ ان ہو چکا ہے",
    activeFamily: "فعال خاندان",
    refresh: "ریفریش",
    loadingFamilies: "خاندان لوڈ ہو رہے ہیں...",
    noFamilyFound: "کوئی خاندان نہیں ملا",
    dashboard: "ڈیش بورڈ",
    wallets: "والیٹس",
    transactions: "لین دین",
    savings: "بچت",
    loans: "قرضے",
    budgets: "بجٹ",
    recurring: "بار بار",
    goals: "اہداف",
    family: "خاندان",
    currency: "کرنسی",
    reports: "رپورٹس",
    auditCenter: "آڈٹ سینٹر",
    backupCenter: "بیک اپ سینٹر",
    offlineSync: "آف لائن سنک",
    settings: "سیٹنگز",
    logout: "لاگ آؤٹ",
    profile: "پروفائل",
    status: "حالت",
    emailVerified: "ای میل تصدیق",
    timezone: "ٹائم زون",
    myRole: "میرا کردار",
    effectivePermissions: "موثر اجازتیں",
    overrides: "اوور رائیڈز",
    languageLock: "زبان لاک",
    allowed: "اجازت شدہ",
    security: "سیکیورٹی",
    session: "سیشن",
    refreshReady: "ریفریش تیار",
    loginRequired: "لاگ ان ضروری",
    refreshSession: "سیشن ریفریش",
    refreshing: "ریفریش ہو رہا ہے...",
    passwordReset: "پاس ورڈ ری سیٹ",
    requestPasswordReset: "پاس ورڈ ری سیٹ درخواست",
    requesting: "درخواست ہو رہی ہے...",
    emailVerification: "ای میل تصدیق",
    verified: "تصدیق شدہ",
    notVerified: "تصدیق نہیں ہوئی",
    resendVerification: "تصدیق دوبارہ بھیجیں",
    sending: "بھیجا جا رہا ہے...",
  },
  en: {
    secureDashboard: "Secure family finance dashboard",
    email: "Email",
    password: "Password",
    login: "Login",
    loggedIn: "Logged in",
    activeFamily: "Active family",
    refresh: "Refresh",
    loadingFamilies: "Loading families...",
    noFamilyFound: "No family found",
    dashboard: "Dashboard",
    wallets: "Wallets",
    transactions: "Transactions",
    savings: "Savings",
    loans: "Loans",
    budgets: "Budgets",
    recurring: "Recurring",
    goals: "Goals",
    family: "Family",
    currency: "Currency",
    reports: "Reports",
    auditCenter: "Audit Center",
    backupCenter: "Backup Center",
    offlineSync: "Offline Sync",
    controlCenter: "Family Finance Control Center",
    offlineReady: "Offline Ready",
    searchModules: "Search modules, transactions, or members...",
    syncAllOk: "All data synced",
    familyFinancialPicture: "Your family financial picture",
    familyFinancialSub: "Wallet, income-expense, budget, loan and offline sync — key facts in one place.",
    netWorth: "Total Net Worth",
    monthlyIncome: "Monthly Income",
    monthlyExpense: "Monthly Expense",
    outstandingLoan: "Outstanding Loan",
    incomeVsExpense: "Income vs Expense",
    last7MonthsTrend: "Last 7 months trend",
    assetDistribution: "Asset Distribution",
    quickWork: "Quick Actions",
    mostUsedActions: "Most used actions",
    budgetStatus: "Budget Status",
    recentTransactions: "Recent Transactions",
    allModules: "All Modules",
    exportReport: "Export Report",
    newTransaction: "New Transaction",
    income: "Income",
    expense: "Expense",
    transfer: "Transfer",
    navOverview: "Overview",
    navFinance: "Finance",
    navFamilyGov: "Family Governance",
    navDailyLife: "Daily Life",
    navAssetsPlanning: "Assets & Planning",
    navSystem: "Reports & System",
    planner: "Planner",
    navTasks: "Tasks",
    navCalendar: "Calendar",
    createTask: "Create task",
    createEvent: "Create event",
    taskTitle: "Task title",
    eventTitle: "Event title",
    dueDate: "Due date",
    eventDate: "Event date",
    startTime: "Start",
    endTime: "End",
    priority: "Priority",
    eventType: "Event type",
    complete: "Complete",
    delete: "Delete",
    noTasks: "No tasks yet",
    noEvents: "No events yet",
    titleRequired: "Title required",
    eventRequired: "Title and date required",
    makeAdmin: "Make ADMIN",
    makeMember: "Make MEMBER",
    ownershipTransfer: "Ownership transfer",
    requestTransfer: "Request transfer",
    pendingTransfers: "Pending transfers",
    acceptTransfer: "Accept",
    adminApproveTransfer: "Admin approve",
    cancelTransfer: "Cancel",
    selectMember: "Select member",
    removeMember: "Remove member",
    deactivateFamily: "Deactivate family",
    voidTransaction: "Void",
    apiBaseUrl: "API base URL",
    saveApiBase: "Save API URL",
    apiBaseHelp: "Change the API server address after login.",
    parseReceiptImage: "Parse receipt image",
    ocrImageHint: "Upload a receipt image for OCR",
    navWalletAccount: "Wallet / Account",
    navAllTransactions: "All Transactions",
    navAccountTransfer: "Account Transfer",
    navSavingsGoals: "Savings Goals",
    navLoanDebt: "Loan / Debt",
    navFamilyMembers: "Family Members",
    navJoinRequests: "Join Requests",
    navInviteCodes: "Invite Codes",
    navRolesPermissions: "Roles & Permissions",
    navHealthExpense: "Health Expense",
    navEducationFund: "Education Fund",
    navVehicle: "Vehicle",
    navSubscriptions: "Subscriptions",
    navInvestments: "Investments",
    navProperty: "Property",
    navZakat: "Zakat",
    navDocumentVault: "Document Vault",
    navReportsAnalytics: "Reports & Analytics",
    navAuditLogs: "Audit Logs",
    brandTagline: "Offline-first family finance",
    ownerFullAccess: "Owner • Full Access",
    theme: "Theme",
    openMobileMenu: "Open mobile menu",
    executiveOverview: "Executive Overview",
    walletBalance: "Wallet Balance",
    cashBank: "Cash / Bank",
    goldAsset: "Gold / Asset",
    otherAsset: "Other",
    invite: "Invite",
    details: "Details",
    pending: "Pending",
    failed: "Failed",
    unread: "Unread",
    category: "Category",
    account: "Account",
    date: "Date",
    amount: "Amount",
    pendingSyncLabel: "Pending Sync",
    synced: "Synced",
    monthUtilization: "Current month utilization",
    deviceQueueStatus: "Device queue and server status",
    systemNormal: "System normal",
    syncQueueActive: "Sync queue active",
    lastSync: "Last sync",
    noTransactionsFound: "No transactions found",
    totalAssets: "Total assets",
    assetGroupSub: "Account and asset group",
    upcomingDue: "Upcoming Due",
    upcomingDueSub: "Loan, subscription and document",
    noUpcomingDue: "No upcoming due",
    familyGovSub: "Owner, member role and pending approval",
    manage: "Manage",
    allModulesSub: "Architecture coverage shortcut",
    openAll: "Open all",
    statusOk: "OK",
    member: "Member",
    ownerAudit: "Owner · Audit",
    settings: "Settings",
    logout: "Logout",
    profile: "Profile",
    status: "Status",
    profilePhoto: "Profile photo",
    changePhoto: "Change photo",
    removePhoto: "Remove photo",
    photoUpdated: "Profile photo updated",
    photoRemoved: "Profile photo removed",
    photoUploadFailed: "Photo upload failed",
    photoHint: "JPG / PNG / WebP · max 2 MB",
    emailVerified: "Email verified",
    timezone: "Timezone",
    myRole: "My Role",
    effectivePermissions: "Effective permissions",
    overrides: "Overrides",
    languageLock: "Language Lock",
    allowed: "Allowed",
    security: "Security",
    session: "Session",
    refreshReady: "Refresh Ready",
    loginRequired: "Login Required",
    refreshSession: "Refresh Session",
    refreshing: "Refreshing...",
    passwordReset: "Password Reset",
    requestPasswordReset: "Request Password Reset",
    requesting: "Requesting...",
    emailVerification: "Email Verification",
    verified: "Verified",
    notVerified: "Not Verified",
    resendVerification: "Resend Verification",
    sending: "Sending...",
  },
};
const EXTRA_UI_TEXT = {
  bn: {
    noActiveFamilySelected: "কোনো সক্রিয় পরিবার নির্বাচিত নেই",
    createJoinFamilyFirst: "প্রথমে পরিবার তৈরি বা যোগ দিন, তারপর পেজ রিফ্রেশ করুন।",
    totalWalletBalance: "মোট ওয়ালেট ব্যালেন্স",
    totalIncome: "মোট আয়",
    totalExpense: "মোট খরচ",
    netIncome: "নেট আয়",
    loanGivenRemaining: "দেওয়া ঋণ বাকি",
    loanTakenRemaining: "নেওয়া ঋণ বাকি",
    budgetRemaining: "বাজেট বাকি",
    overBudget: "বাজেটের বেশি",
    recurringDue: "পুনরাবৃত্তি বাকি",
    monthlyRecurring: "মাসিক পুনরাবৃত্তি",
    createWallet: "ওয়ালেট তৈরি",
    refreshWallets: "ওয়ালেট রিফ্রেশ",
    walletName: "ওয়ালেট নাম",
    openingBalance: "ওপেনিং ব্যালেন্স",
    postTransaction: "লেনদেন পোস্ট",
    amount: "পরিমাণ",
    description: "বিবরণ",
    createSavingsGoal: "সঞ্চয় লক্ষ্য তৈরি",
    createGoal: "লক্ষ্য তৈরি",
    contributeWithdraw: "জমা / উত্তোলন",
    familyGovernance: "পরিবার পরিচালনা",
    members: "সদস্য",
    invite: "আমন্ত্রণ",
    joinRequests: "জয়েন রিকোয়েস্ট",
    joinRequestsHint: "Owner pending জয়েন রিকোয়েস্ট approve বা reject করতে পারেন।",
    joinFamily: "ইনভাইট যোগ",
    joinFamilyHint: "অন্য পরিবারে যোগ দিতে ইনভাইট কোড দিন।",
    joinFamilySubmit: "জয়েন রিকোয়েস্ট পাঠান",
    joinRequestedOk: "জয়েন রিকোয়েস্ট পাঠানো হয়েছে",
    inviteCode: "ইনভাইট কোড",
    inviteCodeRequired: "ইনভাইট কোড দরকার",
    noJoinRequests: "কোনো pending জয়েন রিকোয়েস্ট নেই",
    approve: "অনুমোদন",
    reject: "প্রত্যাখ্যান",
    joinApproved: "জয়েন অনুমোদিত",
    joinRejected: "জয়েন প্রত্যাখ্যাত",
    refreshFamily: "পরিবার রিফ্রেশ",
    generateInvite: "আমন্ত্রণ তৈরি",
    generating: "তৈরি হচ্ছে...",
    latestInviteCode: "সর্বশেষ আমন্ত্রণ কোড",
    currencyCenter: "মুদ্রা সেন্টার",
    baseCurrency: "বেস মুদ্রা",
    totalConvertedBalance: "মোট রূপান্তরিত ব্যালেন্স",
    exchangeRates: "এক্সচেঞ্জ রেট",
    refreshCurrency: "মুদ্রা রিফ্রেশ",
    walletCurrencyExposure: "ওয়ালেট মুদ্রা এক্সপোজার",
    activeCurrencies: "সক্রিয় মুদ্রা",
    latestExchangeRates: "সর্বশেষ এক্সচেঞ্জ রেট",
    totalAuditRows: "মোট অডিট সারি",
    readMode: "রিড মোড",
    latestActivity: "সর্বশেষ কার্যক্রম",
    refreshAudit: "অডিট রিফ্রেশ",
    summaryByAction: "অ্যাকশন অনুযায়ী সারাংশ",
    summaryByEntity: "এনটিটি অনুযায়ী সারাংশ",
    databaseIntegrity: "ডাটাবেস ইন্টেগ্রিটি",
    availableBackups: "ব্যাকআপ ফাইল",
    restoreSafety: "রিস্টোর নিরাপত্তা",
    refreshBackups: "ব্যাকআপ রিফ্রেশ",
    createBackup: "ব্যাকআপ তৈরি",
    backupFiles: "ব্যাকআপ ফাইলসমূহ",
    restorePreview: "রিস্টোর প্রিভিউ",
    device: "ডিভাইস",
    pendingOutbox: "পেন্ডিং আউটবক্স",
    openConflicts: "ওপেন কনফ্লিক্ট",
    refreshSyncStatus: "সিঙ্ক স্ট্যাটাস রিফ্রেশ",
    pullServerChanges: "সার্ভার পরিবর্তন আনুন",
    tableCounts: "টেবিল কাউন্ট",
    syncState: "সিঙ্ক স্টেট",
    save: "সেভ",
    cancel: "বাতিল",
    close: "বন্ধ",
    edit: "এডিট",
    history: "ইতিহাস",
    loading: "লোড হচ্ছে...",
    income: "আয়",
    expense: "খরচ",
    transfer: "ট্রান্সফার",
    selectWallet: "ওয়ালেট নির্বাচন",
    toWallet: "যে ওয়ালেটে যাবে",
    selectCategory: "ক্যাটাগরি নির্বাচন",
    noCategory: "কোনো ক্যাটাগরি নেই",
    cash: "ক্যাশ",
    bank: "ব্যাংক",
    mobileBanking: "মোবাইল ব্যাংকিং",
    savingsName: "সঞ্চয় নাম",
    note: "নোট",
    targetAmount: "লক্ষ্য পরিমাণ",
    depositWithdraw: "জমা / উত্তোলন",
    deposit: "জমা",
    withdraw: "উত্তোলন",
    postSavings: "সঞ্চয় পোস্ট",
    refreshSavings: "সঞ্চয় রিফ্রেশ",
    createLoan: "ঋণ তৈরি",
    loanPayment: "ঋণ পেমেন্ট",
    personName: "ব্যক্তির নাম",
    loanAmount: "ঋণের পরিমাণ",
    paymentAmount: "পেমেন্ট পরিমাণ",
    postPayment: "পেমেন্ট পোস্ট",
    refreshLoans: "ঋণ রিফ্রেশ",
    loanSearchFilter: "ঋণ সার্চ / ফিল্টার",
    searchPersonNote: "ব্যক্তি বা নোট সার্চ",
    createBudget: "বাজেট তৈরি",
    budgetName: "বাজেট নাম",
    budgetAmount: "বাজেট পরিমাণ",
    budgetSearchFilter: "বাজেট সার্চ / ফিল্টার",
    searchBudgetCategoryNote: "বাজেট/ক্যাটাগরি/নোট সার্চ",
    refreshBudgets: "বাজেট রিফ্রেশ",
    recurringSearchFilter: "পুনরাবৃত্তি সার্চ / ফিল্টার",
    searchTitleDescription: "শিরোনাম/বিবরণ সার্চ",
    title: "শিরোনাম",
    daily: "দৈনিক",
    weekly: "সাপ্তাহিক",
    monthly: "মাসিক",
    yearly: "বার্ষিক",
    allStatus: "সব স্ট্যাটাস",
    allType: "সব ধরন",
    clearFilter: "ফিল্টার ক্লিয়ার",
    refreshRecurring: "পুনরাবৃত্তি রিফ্রেশ",
    postNow: "এখন পোস্ট",
    pause: "পজ",
    resume: "চালু করুন",
    start: "শুরু",
    end: "শেষ",
    lastPosted: "শেষ পোস্ট",
    never: "কখনো না",
    due: "বাকি",
    nextDue: "পরের তারিখ",
    noEnd: "শেষ নেই",
    goalName: "লক্ষ্য নাম",
    goalType: "লক্ষ্য ধরন",
    selectGoal: "লক্ষ্য নির্বাচন",
    contribute: "জমা দিন",
    refreshGoals: "লক্ষ্য রিফ্রেশ",
    activeFamilyLabel: "সক্রিয় পরিবার",
    selectedFamily: "নির্বাচিত পরিবার",
    expiresInDays: "মেয়াদ দিন",
    maxUses: "সর্বোচ্চ ব্যবহার",
    noFamilyMemberData: "পরিবার সদস্য ডাটা লোড হয়নি",
    walletBalancesIncluded: "ওয়ালেট ব্যালেন্স অন্তর্ভুক্ত",
    convertedIntoBase: "পরিবারের বেস মুদ্রায় রূপান্তরিত",
    balance: "ব্যালেন্স",
    rate: "রেট",
    noCurrenciesFound: "কোনো মুদ্রা পাওয়া যায়নি",
    noExchangeRatesFound: "কোনো এক্সচেঞ্জ রেট পাওয়া যায়নি",
    accountTypeSummary: "অ্যাকাউন্ট ধরন সারাংশ",
    walletSummary: "ওয়ালেট সারাংশ",
    accountLedgerPreview: "অ্যাকাউন্ট লেজার প্রিভিউ",
    exportReports: "রিপোর্ট এক্সপোর্ট",
    refreshReports: "রিপোর্ট রিফ্রেশ",
    loadingReports: "রিপোর্ট লোড হচ্ছে...",
    reportTab_overview: "ওভারভিউ",
    reportTab_ledger: "লেজার",
    reportTab_networth: "নেট ওয়ার্থ",
    reportTab_categories: "ক্যাটাগরি",
    reportTab_budget: "বাজেট",
    reportTab_loans: "ঋণ",
    reportTab_savings: "সঞ্চয় ট্রেন্ড",
    reportTab_apilogs: "API লগ",
    reportTab_export: "এক্সপোর্ট",
    apiLogsHint: "ধীর এন্ডপয়েন্ট (≥৫০০ms হাইলাইট). গড়",
    slowCount: "ধীর",
    ledgerAccount: "লেজার অ্যাকাউন্ট",
    selectLedgerAccount: "লেজার অ্যাকাউন্ট নির্বাচন",
    totalDebit: "মোট ডেবিট",
    totalCredit: "মোট ক্রেডিট",
    walletBalance: "ওয়ালেট ব্যালেন্স",
    debit: "ডেবিট",
    credit: "ক্রেডিট",
    transactionsOnly: "শুধু ব্যালেন্সড ডাবল-এন্ট্রি সারি",
    noFinancialSummary: "ফাইন্যান্সিয়াল সারাংশ পাওয়া যায়নি",
    noWalletReport: "ওয়ালেট রিপোর্ট পাওয়া যায়নি",
    noLedgerRows: "নির্বাচিত অ্যাকাউন্টে লেজার সারি নেই",
    readOnly: "শুধু পড়া",
    protected: "সুরক্ষিত",
    immutableTrail: "অপরিবর্তনীয় ট্রেইল",
    auditSummary: "অডিট সারাংশ",
    refreshToCheck: "চেক করতে রিফ্রেশ করুন",
    familyScopedBackupFiles: "পরিবারভিত্তিক ব্যাকআপ ফাইল",
    previewOnly: "শুধু প্রিভিউ",
    fullRestoreServerStopped: "ফুল রিস্টোর সার্ভার বন্ধ রেখে করতে হবে।",
    loadingBackups: "ব্যাকআপ লোড হচ্ছে...",
    creatingBackup: "ব্যাকআপ তৈরি হচ্ছে...",
    previewRestore: "রিস্টোর প্রিভিউ",
    previewing: "প্রিভিউ হচ্ছে...",
    download: "ডাউনলোড",
    targetDate: "লক্ষ্য তারিখ",
    noDate: "তারিখ নেই",
    noNote: "নোট নেই",
    saved: "সঞ্চিত",
    remaining: "বাকি",
    monthlyNeed: "মাসিক প্রয়োজন",
    active: "সক্রিয়",
    inactive: "নিষ্ক্রিয়",
    unknown: "অজানা",
    yes: "হ্যাঁ",
    no: "না",
    saving: "সেভ হচ্ছে...",
    offlineFirstEnabled: "অফলাইন-ফার্স্ট চালু",
    localWritesWaiting: "লোকাল লেখা সার্ভারের অপেক্ষায়",
    resolveBackendOnly: "শুধু ব্যাকএন্ড/অ্যাডমিন ফ্লো থেকে সমাধান",
    noSyncStatus: "সিঙ্ক স্ট্যাটাস লোড হয়নি",
    lastToken: "শেষ টোকেন",
    notSynced: "সিঙ্ক হয়নি",
    lastPull: "শেষ পুল",
    lastPush: "শেষ পুশ",
    noOpenSyncConflicts: "কোনো ওপেন সিঙ্ক কনফ্লিক্ট নেই",
    noDetails: "বিস্তারিত নেই",
    lastPullPreview: "শেষ পুল প্রিভিউ",
    refreshSessionHelp: "রিফ্রেশ সেশন রোটেট করে অ্যাক্সেস টোকেন আপডেট করে।",
    passwordResetHelp: "লগইন করা ইমেইলের জন্য পাসওয়ার্ড রিসেট অনুরোধ করে। রিসেট টোকেন UI-তে দেখানো হয় না।",
    noPermissionSummary: "পারমিশন সারাংশ লোড হয়নি",
    familyMemberPermissions: "পরিবার সদস্য অনুমতি",
    ownerOnlyUnavailable: "এই ব্যবহারকারীর জন্য ওনার-অনলি সদস্য অনুমতি ওভারভিউ নেই।",
    ownerPermissionsLocked: "ওনার পারমিশন লক করা",
    permissionKey: "পারমিশন কী",
    selectPermission: "পারমিশন নির্বাচন",
    permissionAction: "পারমিশন অ্যাকশন",
    allow: "অনুমতি দিন",
    deny: "না দিন",
    apply: "প্রয়োগ",
    type: "ধরন",
  },
  ar: {
    noActiveFamilySelected: "لم يتم تحديد عائلة نشطة",
    createJoinFamilyFirst: "أنشئ أو انضم إلى عائلة أولاً، ثم حدّث الصفحة.",
    totalWalletBalance: "إجمالي رصيد المحافظ",
    totalIncome: "إجمالي الدخل",
    totalExpense: "إجمالي المصروفات",
    netIncome: "صافي الدخل",
    loanGivenRemaining: "المتبقي من القروض المعطاة",
    loanTakenRemaining: "المتبقي من القروض المستلمة",
    budgetRemaining: "المتبقي من الميزانية",
    overBudget: "تجاوز الميزانية",
    recurringDue: "المتكرر المستحق",
    monthlyRecurring: "المتكرر الشهري",
    createWallet: "إنشاء محفظة",
    refreshWallets: "تحديث المحافظ",
    walletName: "اسم المحفظة",
    openingBalance: "الرصيد الافتتاحي",
    postTransaction: "ترحيل المعاملة",
    amount: "المبلغ",
    description: "الوصف",
    createSavingsGoal: "إنشاء هدف ادخار",
    createGoal: "إنشاء هدف",
    contributeWithdraw: "إيداع / سحب",
    familyGovernance: "إدارة العائلة",
    members: "الأعضاء",
    invite: "دعوة",
    refreshFamily: "تحديث العائلة",
    generateInvite: "إنشاء دعوة",
    generating: "جار الإنشاء...",
    latestInviteCode: "آخر رمز دعوة",
    currencyCenter: "مركز العملات",
    baseCurrency: "العملة الأساسية",
    totalConvertedBalance: "إجمالي الرصيد المحول",
    exchangeRates: "أسعار الصرف",
    refreshCurrency: "تحديث العملة",
    walletCurrencyExposure: "تعرض عملة المحافظ",
    activeCurrencies: "العملات النشطة",
    latestExchangeRates: "أحدث أسعار الصرف",
    totalAuditRows: "إجمالي سجلات التدقيق",
    readMode: "وضع القراءة",
    latestActivity: "آخر نشاط",
    refreshAudit: "تحديث التدقيق",
    summaryByAction: "ملخص حسب الإجراء",
    summaryByEntity: "ملخص حسب الكيان",
    databaseIntegrity: "سلامة قاعدة البيانات",
    availableBackups: "النسخ الاحتياطية المتاحة",
    restoreSafety: "أمان الاستعادة",
    refreshBackups: "تحديث النسخ الاحتياطية",
    createBackup: "إنشاء نسخة احتياطية",
    backupFiles: "ملفات النسخ الاحتياطي",
    restorePreview: "معاينة الاستعادة",
    device: "الجهاز",
    pendingOutbox: "الصادر المعلق",
    openConflicts: "التعارضات المفتوحة",
    refreshSyncStatus: "تحديث حالة المزامنة",
    pullServerChanges: "سحب تغييرات الخادم",
    tableCounts: "عدد الجداول",
    syncState: "حالة المزامنة",
  },
  hi: {
    noActiveFamilySelected: "कोई सक्रिय परिवार चयनित नहीं है",
    createJoinFamilyFirst: "पहले परिवार बनाएं या जुड़ें, फिर पेज रीफ्रेश करें।",
    totalWalletBalance: "कुल वॉलेट बैलेंस",
    totalIncome: "कुल आय",
    totalExpense: "कुल खर्च",
    netIncome: "शुद्ध आय",
    loanGivenRemaining: "दिए गए ऋण शेष",
    loanTakenRemaining: "लिए गए ऋण शेष",
    budgetRemaining: "बजट शेष",
    overBudget: "बजट से अधिक",
    recurringDue: "देय आवर्ती",
    monthlyRecurring: "मासिक आवर्ती",
    createWallet: "वॉलेट बनाएं",
    refreshWallets: "वॉलेट रीफ्रेश",
    walletName: "वॉलेट नाम",
    openingBalance: "प्रारंभिक बैलेंस",
    postTransaction: "लेनदेन पोस्ट करें",
    amount: "राशि",
    description: "विवरण",
    createSavingsGoal: "बचत लक्ष्य बनाएं",
    createGoal: "लक्ष्य बनाएं",
    contributeWithdraw: "योगदान / निकासी",
    familyGovernance: "परिवार शासन",
    members: "सदस्य",
    invite: "आमंत्रण",
    refreshFamily: "परिवार रीफ्रेश",
    generateInvite: "आमंत्रण बनाएं",
    generating: "बन रहा है...",
    latestInviteCode: "नवीनतम आमंत्रण कोड",
    currencyCenter: "मुद्रा केंद्र",
    baseCurrency: "आधार मुद्रा",
    totalConvertedBalance: "कुल परिवर्तित बैलेंस",
    exchangeRates: "विनिमय दरें",
    refreshCurrency: "मुद्रा रीफ्रेश",
    walletCurrencyExposure: "वॉलेट मुद्रा एक्सपोजर",
    activeCurrencies: "सक्रिय मुद्राएं",
    latestExchangeRates: "नवीनतम विनिमय दरें",
    totalAuditRows: "कुल ऑडिट पंक्तियां",
    readMode: "रीड मोड",
    latestActivity: "नवीनतम गतिविधि",
    refreshAudit: "ऑडिट रीफ्रेश",
    summaryByAction: "कार्रवाई अनुसार सारांश",
    summaryByEntity: "इकाई अनुसार सारांश",
    databaseIntegrity: "डेटाबेस अखंडता",
    availableBackups: "उपलब्ध बैकअप",
    restoreSafety: "रिस्टोर सुरक्षा",
    refreshBackups: "बैकअप रीफ्रेश",
    createBackup: "बैकअप बनाएं",
    backupFiles: "बैकअप फाइलें",
    restorePreview: "रिस्टोर प्रिव्यू",
    device: "डिवाइस",
    pendingOutbox: "लंबित आउटबॉक्स",
    openConflicts: "खुले संघर्ष",
    refreshSyncStatus: "सिंक स्थिति रीफ्रेश",
    pullServerChanges: "सर्वर बदलाव खींचें",
    tableCounts: "टेबल काउंट",
    syncState: "सिंक स्थिति",
  },
  ur: {
    noActiveFamilySelected: "کوئی فعال خاندان منتخب نہیں",
    createJoinFamilyFirst: "پہلے خاندان بنائیں یا شامل ہوں، پھر صفحہ ریفریش کریں۔",
    totalWalletBalance: "کل والیٹ بیلنس",
    totalIncome: "کل آمدنی",
    totalExpense: "کل خرچ",
    netIncome: "خالص آمدنی",
    loanGivenRemaining: "دیے گئے قرض باقی",
    loanTakenRemaining: "لیے گئے قرض باقی",
    budgetRemaining: "بجٹ باقی",
    overBudget: "بجٹ سے زیادہ",
    recurringDue: "واجب الادا بار بار",
    monthlyRecurring: "ماہانہ بار بار",
    createWallet: "والیٹ بنائیں",
    refreshWallets: "والیٹس ریفریش",
    walletName: "والیٹ نام",
    openingBalance: "ابتدائی بیلنس",
    postTransaction: "لین دین پوسٹ کریں",
    amount: "رقم",
    description: "تفصیل",
    createSavingsGoal: "بچت ہدف بنائیں",
    createGoal: "ہدف بنائیں",
    contributeWithdraw: "جمع / نکلوائیں",
    familyGovernance: "خاندانی انتظام",
    members: "ارکان",
    invite: "دعوت",
    refreshFamily: "خاندان ریفریش",
    generateInvite: "دعوت بنائیں",
    generating: "بن رہا ہے...",
    latestInviteCode: "تازہ دعوت کوڈ",
    currencyCenter: "کرنسی سینٹر",
    baseCurrency: "بنیادی کرنسی",
    totalConvertedBalance: "کل تبدیل شدہ بیلنس",
    exchangeRates: "ایکسچینج ریٹس",
    refreshCurrency: "کرنسی ریفریش",
    walletCurrencyExposure: "والیٹ کرنسی ایکسپوژر",
    activeCurrencies: "فعال کرنسیاں",
    latestExchangeRates: "تازہ ایکسچینج ریٹس",
    totalAuditRows: "کل آڈٹ قطاریں",
    readMode: "ریڈ موڈ",
    latestActivity: "تازہ سرگرمی",
    refreshAudit: "آڈٹ ریفریش",
    summaryByAction: "عمل کے مطابق خلاصہ",
    summaryByEntity: "اینٹٹی کے مطابق خلاصہ",
    databaseIntegrity: "ڈیٹابیس سالمیت",
    availableBackups: "دستیاب بیک اپ",
    restoreSafety: "رسٹور حفاظت",
    refreshBackups: "بیک اپ ریفریش",
    createBackup: "بیک اپ بنائیں",
    backupFiles: "بیک اپ فائلیں",
    restorePreview: "رستور پری ویو",
    device: "ڈیوائس",
    pendingOutbox: "زیر التوا آؤٹ باکس",
    openConflicts: "کھلے تنازعات",
    refreshSyncStatus: "سنک حالت ریفریش",
    pullServerChanges: "سرور تبدیلیاں لائیں",
    tableCounts: "ٹیبل کاؤنٹس",
    syncState: "سنک حالت",
  },
  en: {
    noActiveFamilySelected: "No active family selected",
    createJoinFamilyFirst: "Create or join a family first, then refresh this page.",
    totalWalletBalance: "Total Wallet Balance",
    totalIncome: "Total Income",
    totalExpense: "Total Expense",
    netIncome: "Net Income",
    loanGivenRemaining: "Loan Given Remaining",
    loanTakenRemaining: "Loan Taken Remaining",
    budgetRemaining: "Budget Remaining",
    overBudget: "Over Budget",
    recurringDue: "Recurring Due",
    monthlyRecurring: "Monthly Recurring",
    createWallet: "Create Wallet",
    refreshWallets: "Refresh Wallets",
    walletName: "Wallet name",
    openingBalance: "Opening balance",
    postTransaction: "Post Transaction",
    amount: "Amount",
    description: "Description",
    createSavingsGoal: "Create Savings Goal",
    createGoal: "Create Goal",
    contributeWithdraw: "Contribute / Withdraw",
    familyGovernance: "Family Governance",
    members: "Members",
    invite: "Invite",
    joinRequests: "Join requests",
    joinRequestsHint: "Owner can approve or reject pending join requests.",
    joinFamily: "Join invite",
    joinFamilyHint: "Enter an invite code to request joining another family.",
    joinFamilySubmit: "Send join request",
    joinRequestedOk: "Join request sent",
    inviteCode: "Invite code",
    inviteCodeRequired: "Invite code required",
    noJoinRequests: "No pending join requests",
    approve: "Approve",
    reject: "Reject",
    joinApproved: "Join approved",
    joinRejected: "Join rejected",
    refreshFamily: "Refresh Family",
    generateInvite: "Generate Invite",
    generating: "Generating...",
    latestInviteCode: "Latest Invite Code",
    currencyCenter: "Currency Center",
    baseCurrency: "Base Currency",
    totalConvertedBalance: "Total Converted Balance",
    exchangeRates: "Exchange Rates",
    refreshCurrency: "Refresh Currency",
    walletCurrencyExposure: "Wallet Currency Exposure",
    activeCurrencies: "Active Currencies",
    latestExchangeRates: "Latest Exchange Rates",
    totalAuditRows: "Total Audit Rows",
    readMode: "Read Mode",
    latestActivity: "Latest Activity",
    refreshAudit: "Refresh Audit",
    summaryByAction: "Summary by Action",
    summaryByEntity: "Summary by Entity",
    databaseIntegrity: "Database Integrity",
    availableBackups: "Available Backups",
    restoreSafety: "Restore Safety",
    refreshBackups: "Refresh Backups",
    createBackup: "Create Backup",
    backupFiles: "Backup Files",
    restorePreview: "Restore Preview",
    device: "Device",
    pendingOutbox: "Pending Outbox",
    openConflicts: "Open Conflicts",
    refreshSyncStatus: "Refresh Sync Status",
    pullServerChanges: "Pull Server Changes",
    tableCounts: "Table Counts",
    syncState: "Sync State",
    save: "Save",
    cancel: "Cancel",
    close: "Close",
    edit: "Edit",
    history: "History",
    loading: "Loading...",
    income: "Income",
    expense: "Expense",
    transfer: "Transfer",
    selectWallet: "Select wallet",
    toWallet: "To wallet",
    selectCategory: "Select category",
    noCategory: "No category",
    cash: "Cash",
    bank: "Bank",
    mobileBanking: "Mobile Banking",
    savingsName: "Savings name",
    note: "Note",
    targetAmount: "Target amount",
    depositWithdraw: "Deposit / Withdraw",
    deposit: "Deposit",
    withdraw: "Withdraw",
    postSavings: "Post Savings",
    refreshSavings: "Refresh Savings",
    createLoan: "Create Loan",
    loanPayment: "Loan Payment",
    personName: "Person name",
    loanAmount: "Loan amount",
    paymentAmount: "Payment amount",
    postPayment: "Post Payment",
    refreshLoans: "Refresh Loans",
    loanSearchFilter: "Loan Search / Filter",
    searchPersonNote: "Search person or note",
    createBudget: "Create Budget",
    budgetName: "Budget name",
    budgetAmount: "Budget amount",
    budgetSearchFilter: "Budget Search / Filter",
    searchBudgetCategoryNote: "Search budget/category/note",
    refreshBudgets: "Refresh Budgets",
    recurringSearchFilter: "Recurring Search / Filter",
    searchTitleDescription: "Search title/description",
    title: "Title",
    daily: "Daily",
    weekly: "Weekly",
    monthly: "Monthly",
    yearly: "Yearly",
    allStatus: "All Status",
    allType: "All Type",
    clearFilter: "Clear Filter",
    refreshRecurring: "Refresh Recurring",
    postNow: "Post Now",
    pause: "Pause",
    resume: "Resume",
    start: "Start",
    end: "End",
    lastPosted: "Last Posted",
    never: "Never",
    due: "Due",
    nextDue: "Next Due",
    noEnd: "No end",
    goalName: "Goal name",
    goalType: "Goal type",
    selectGoal: "Select goal",
    contribute: "Contribute",
    refreshGoals: "Refresh Goals",
    activeFamilyLabel: "Active Family",
    selectedFamily: "Selected family",
    expiresInDays: "Expires in days",
    maxUses: "Max uses",
    noFamilyMemberData: "No family member data loaded",
    walletBalancesIncluded: "wallet balances included",
    convertedIntoBase: "Converted into family base currency",
    balance: "Balance",
    rate: "Rate",
    noCurrenciesFound: "No currencies found",
    noExchangeRatesFound: "No exchange rates found",
    accountTypeSummary: "Account Type Summary",
    walletSummary: "Wallet Summary",
    accountLedgerPreview: "Account Ledger Preview",
    exportReports: "Export Reports",
    refreshReports: "Refresh Reports",
    loadingReports: "Loading reports...",
    reportTab_overview: "Overview",
    reportTab_ledger: "Ledger",
    reportTab_networth: "Net worth",
    reportTab_categories: "Categories",
    reportTab_budget: "Budget",
    reportTab_loans: "Loans",
    reportTab_savings: "Savings trend",
    reportTab_apilogs: "API logs",
    reportTab_export: "Export",
    apiLogsHint: "Slow endpoints (≥500ms highlighted). Avg",
    slowCount: "Slow",
    ledgerAccount: "Ledger account",
    selectLedgerAccount: "Select ledger account",
    totalDebit: "Total Debit",
    totalCredit: "Total Credit",
    walletBalance: "Wallet Balance",
    debit: "Debit",
    credit: "Credit",
    transactionsOnly: "Balanced double-entry rows only",
    noFinancialSummary: "No financial summary found",
    noWalletReport: "No wallet report found",
    noLedgerRows: "No ledger rows found for selected account",
    readOnly: "Read Only",
    protected: "Protected",
    immutableTrail: "Immutable trail",
    auditSummary: "Audit summary",
    refreshToCheck: "Run refresh to check",
    familyScopedBackupFiles: "Family-scoped backup files",
    previewOnly: "Preview Only",
    fullRestoreServerStopped: "Full restore must be done with server stopped.",
    loadingBackups: "Loading backups...",
    creatingBackup: "Creating backup...",
    previewRestore: "Preview Restore",
    previewing: "Previewing...",
    download: "Download",
    targetDate: "Target Date",
    noDate: "No date",
    noNote: "No note",
    saved: "Saved",
    remaining: "Remaining",
    monthlyNeed: "Monthly Need",
    active: "Active",
    inactive: "Inactive",
    unknown: "Unknown",
    yes: "Yes",
    no: "No",
    saving: "Saving...",
    offlineFirstEnabled: "Offline-first enabled",
    localWritesWaiting: "Local writes waiting for server",
    resolveBackendOnly: "Resolve from backend/admin flow only",
    noSyncStatus: "No sync status loaded",
    lastToken: "Last Token",
    notSynced: "Not synced",
    lastPull: "Last pull",
    lastPush: "Last push",
    noOpenSyncConflicts: "No open sync conflicts",
    noDetails: "No details",
    lastPullPreview: "Last Pull Preview",
    refreshSessionHelp: "Rotates the refresh session and updates the access token.",
    passwordResetHelp: "Requests a password reset for the logged-in email. Reset tokens are not shown in UI.",
    noPermissionSummary: "No permission summary loaded",
    familyMemberPermissions: "Family Member Permissions",
    ownerOnlyUnavailable: "Owner-only member permission overview is unavailable for this user.",
    ownerPermissionsLocked: "Owner permissions locked",
    permissionKey: "Permission key",
    selectPermission: "Select permission",
    permissionAction: "Permission action",
    allow: "Allow",
    deny: "Deny",
    apply: "Apply",
    type: "Type",
  },
};
for (const [languageCode, text] of Object.entries(EXTRA_UI_TEXT)) {
  Object.assign(UI_TEXT[languageCode], text);
}
const PHASE17_UI_TEXT = {
  bn: {
    reportHealth: "রিপোর্ট স্বাস্থ্য",
    zakatCalculator: "যাকাত ক্যালকুলেটর",
    calculateZakat: "যাকাত হিসাব করুন",
    assetsFunds: "সম্পদ ও ফান্ড",
    familyAssetsLifeFunds: "পারিবারিক সম্পদ ও জীবন ফান্ড",
    createAssetFundItem: "সম্পদ/ফান্ড আইটেম তৈরি",
    refreshAssetsFunds: "সম্পদ ও ফান্ড রিফ্রেশ",
    assetsFundsItems: "সম্পদ ও ফান্ড আইটেম",
    noAssetsFunds: "কোনো সম্পদ বা ফান্ড পাওয়া যায়নি",
    docsProperty: "ডকস ও প্রপার্টি",
    subscriptionsDocumentsProperty: "সাবস্ক্রিপশন, ডকুমেন্ট ও প্রপার্টি",
    createSubscriptionDocumentPropertyItem: "সাবস্ক্রিপশন/ডকুমেন্ট/প্রপার্টি আইটেম তৈরি",
    refreshDocsProperty: "ডকস ও প্রপার্টি রিফ্রেশ",
    subscriptionsDocumentsPropertyItems: "সাবস্ক্রিপশন, ডকুমেন্ট ও প্রপার্টি আইটেম",
    noSubscriptionDocumentProperty: "কোনো সাবস্ক্রিপশন, ডকুমেন্ট বা প্রপার্টি পাওয়া যায়নি",
    deliveryMode: "ডেলিভারি মোড",
    templates: "টেমপ্লেট",
    name: "নাম",
    category: "ক্যাটাগরি",
    reference: "রেফারেন্স",
    noReference: "রেফারেন্স নেই",
    activeSavingsGoals: "সক্রিয় সঞ্চয় লক্ষ্য",
    totalSaved: "মোট সঞ্চয়",
    totalTarget: "মোট লক্ষ্য",
    savingsRemaining: "সঞ্চয় বাকি",
    overallProgress: "সামগ্রিক অগ্রগতি",
    needsAttention: "মনোযোগ দরকার",
    savingsAlerts: "সঞ্চয় সতর্কতা",
    totalActiveBudget: "মোট সক্রিয় বাজেট",
    totalSpent: "মোট ব্যয়",
    overBudgetCount: "বাজেট বেশি সংখ্যা",
    budgetWarningCount: "বাজেট সতর্কতা সংখ্যা",
    budgetAlerts: "বাজেট সতর্কতা",
    totalZakatRecords: "মোট যাকাত রেকর্ড",
    totalZakatDue: "মোট যাকাত বাকি",
    latestStatus: "সর্বশেষ স্ট্যাটাস",
    zakatHistory: "যাকাত ইতিহাস",
    notifications: "নোটিফিকেশন",
    totalNotifications: "মোট নোটিফিকেশন",
    unread: "অপঠিত",
    highSeverity: "উচ্চ গুরুত্ব",
    mediumSeverity: "মাঝারি গুরুত্ব",
  },
  ar: {
    reportHealth: "حالة التقارير",
    zakatCalculator: "حاسبة الزكاة",
    calculateZakat: "احسب الزكاة",
    assetsFunds: "الأصول والصناديق",
    familyAssetsLifeFunds: "أصول العائلة وصناديق الحياة",
    createAssetFundItem: "إنشاء أصل/صندوق",
    refreshAssetsFunds: "تحديث الأصول والصناديق",
    assetsFundsItems: "عناصر الأصول والصناديق",
    noAssetsFunds: "لا توجد أصول أو صناديق",
    docsProperty: "المستندات والعقارات",
    subscriptionsDocumentsProperty: "الاشتراكات والمستندات والعقارات",
    createSubscriptionDocumentPropertyItem: "إنشاء اشتراك/مستند/عقار",
    refreshDocsProperty: "تحديث المستندات والعقارات",
    subscriptionsDocumentsPropertyItems: "عناصر الاشتراكات والمستندات والعقارات",
    noSubscriptionDocumentProperty: "لا توجد اشتراكات أو مستندات أو عقارات",
    deliveryMode: "وضع التسليم",
    templates: "القوالب",
    name: "الاسم",
    category: "الفئة",
    reference: "المرجع",
    noReference: "لا يوجد مرجع",
    activeSavingsGoals: "أهداف الادخار النشطة",
    totalSaved: "إجمالي المدخر",
    totalTarget: "إجمالي الهدف",
    savingsRemaining: "المتبقي للادخار",
    overallProgress: "التقدم العام",
    needsAttention: "يحتاج انتباهاً",
    savingsAlerts: "تنبيهات الادخار",
    totalActiveBudget: "إجمالي الميزانية النشطة",
    totalSpent: "إجمالي المصروف",
    overBudgetCount: "عدد تجاوز الميزانية",
    budgetWarningCount: "عدد تحذيرات الميزانية",
    budgetAlerts: "تنبيهات الميزانية",
    totalZakatRecords: "إجمالي سجلات الزكاة",
    totalZakatDue: "إجمالي الزكاة المستحقة",
    latestStatus: "آخر حالة",
    zakatHistory: "سجل الزكاة",
    notifications: "الإشعارات",
    totalNotifications: "إجمالي الإشعارات",
    unread: "غير مقروء",
    highSeverity: "أهمية عالية",
    mediumSeverity: "أهمية متوسطة",
  },
  hi: {
    reportHealth: "रिपोर्ट स्थिति",
    zakatCalculator: "ज़कात कैलकुलेटर",
    calculateZakat: "ज़कात गणना करें",
    assetsFunds: "संपत्ति और फंड",
    familyAssetsLifeFunds: "परिवार संपत्ति और जीवन फंड",
    createAssetFundItem: "संपत्ति/फंड आइटम बनाएं",
    refreshAssetsFunds: "संपत्ति और फंड रीफ्रेश",
    assetsFundsItems: "संपत्ति और फंड आइटम",
    noAssetsFunds: "कोई संपत्ति या फंड नहीं मिला",
    docsProperty: "दस्तावेज़ और संपत्ति",
    subscriptionsDocumentsProperty: "सब्सक्रिप्शन, दस्तावेज़ और संपत्ति",
    createSubscriptionDocumentPropertyItem: "सब्सक्रिप्शन/दस्तावेज़/संपत्ति आइटम बनाएं",
    refreshDocsProperty: "दस्तावेज़ और संपत्ति रीफ्रेश",
    subscriptionsDocumentsPropertyItems: "सब्सक्रिप्शन, दस्तावेज़ और संपत्ति आइटम",
    noSubscriptionDocumentProperty: "कोई सब्सक्रिप्शन, दस्तावेज़ या संपत्ति नहीं मिली",
    deliveryMode: "डिलीवरी मोड",
    templates: "टेम्पलेट",
    name: "नाम",
    category: "श्रेणी",
    reference: "संदर्भ",
    noReference: "कोई संदर्भ नहीं",
    activeSavingsGoals: "सक्रिय बचत लक्ष्य",
    totalSaved: "कुल बचत",
    totalTarget: "कुल लक्ष्य",
    savingsRemaining: "बचत शेष",
    overallProgress: "कुल प्रगति",
    needsAttention: "ध्यान चाहिए",
    savingsAlerts: "बचत अलर्ट",
    totalActiveBudget: "कुल सक्रिय बजट",
    totalSpent: "कुल खर्च",
    overBudgetCount: "ओवर बजट संख्या",
    budgetWarningCount: "बजट चेतावनी संख्या",
    budgetAlerts: "बजट अलर्ट",
    totalZakatRecords: "कुल ज़कात रिकॉर्ड",
    totalZakatDue: "कुल देय ज़कात",
    latestStatus: "नवीनतम स्थिति",
    zakatHistory: "ज़कात इतिहास",
    notifications: "सूचनाएं",
    totalNotifications: "कुल सूचनाएं",
    unread: "अपठित",
    highSeverity: "उच्च गंभीरता",
    mediumSeverity: "मध्यम गंभीरता",
  },
  ur: {
    reportHealth: "رپورٹ حالت",
    zakatCalculator: "زکوٰۃ کیلکولیٹر",
    calculateZakat: "زکوٰۃ حساب کریں",
    assetsFunds: "اثاثے اور فنڈز",
    familyAssetsLifeFunds: "خاندانی اثاثے اور زندگی فنڈز",
    createAssetFundItem: "اثاثہ/فنڈ آئٹم بنائیں",
    refreshAssetsFunds: "اثاثے اور فنڈز ریفریش",
    assetsFundsItems: "اثاثے اور فنڈز آئٹمز",
    noAssetsFunds: "کوئی اثاثہ یا فنڈ نہیں ملا",
    docsProperty: "دستاویزات اور پراپرٹی",
    subscriptionsDocumentsProperty: "سبسکرپشن، دستاویزات اور پراپرٹی",
    createSubscriptionDocumentPropertyItem: "سبسکرپشن/دستاویز/پراپرٹی آئٹم بنائیں",
    refreshDocsProperty: "دستاویزات اور پراپرٹی ریفریش",
    subscriptionsDocumentsPropertyItems: "سبسکرپشن، دستاویزات اور پراپرٹی آئٹمز",
    noSubscriptionDocumentProperty: "کوئی سبسکرپشن، دستاویز یا پراپرٹی نہیں ملی",
    deliveryMode: "ڈلیوری موڈ",
    templates: "ٹیمپلیٹس",
    name: "نام",
    category: "کیٹیگری",
    reference: "حوالہ",
    noReference: "کوئی حوالہ نہیں",
    activeSavingsGoals: "فعال بچت اہداف",
    totalSaved: "کل بچت",
    totalTarget: "کل ہدف",
    savingsRemaining: "بچت باقی",
    overallProgress: "مجموعی پیش رفت",
    needsAttention: "توجہ درکار",
    savingsAlerts: "بچت الرٹس",
    totalActiveBudget: "کل فعال بجٹ",
    totalSpent: "کل خرچ",
    overBudgetCount: "بجٹ سے زائد تعداد",
    budgetWarningCount: "بجٹ انتباہ تعداد",
    budgetAlerts: "بجٹ الرٹس",
    totalZakatRecords: "کل زکوٰۃ ریکارڈز",
    totalZakatDue: "کل واجب زکوٰۃ",
    latestStatus: "تازہ حالت",
    zakatHistory: "زکوٰۃ تاریخ",
    notifications: "اطلاعات",
    totalNotifications: "کل اطلاعات",
    unread: "ان پڑھ",
    highSeverity: "زیادہ اہمیت",
    mediumSeverity: "درمیانی اہمیت",
  },
  en: {
    reportHealth: "Report Health",
    zakatCalculator: "Zakat Calculator",
    calculateZakat: "Calculate Zakat",
    assetsFunds: "Assets & Funds",
    familyAssetsLifeFunds: "Family Assets & Life Funds",
    createAssetFundItem: "Create Asset/Fund Item",
    refreshAssetsFunds: "Refresh Assets & Funds",
    assetsFundsItems: "Assets & Funds Items",
    noAssetsFunds: "No assets or funds found",
    docsProperty: "Docs & Property",
    subscriptionsDocumentsProperty: "Subscriptions, Documents & Property",
    createSubscriptionDocumentPropertyItem: "Create Subscription/Document/Property Item",
    refreshDocsProperty: "Refresh Docs & Property",
    subscriptionsDocumentsPropertyItems: "Subscriptions, Documents & Property Items",
    noSubscriptionDocumentProperty: "No subscription, document, or property items found",
    deliveryMode: "Delivery Mode",
    templates: "Templates",
    name: "Name",
    category: "Category",
    reference: "Reference",
    noReference: "No reference",
    activeSavingsGoals: "Active Savings Goals",
    totalSaved: "Total Saved",
    totalTarget: "Total Target",
    savingsRemaining: "Savings Remaining",
    overallProgress: "Overall Progress",
    needsAttention: "Needs Attention",
    savingsAlerts: "Savings Alerts",
    totalActiveBudget: "Total Active Budget",
    totalSpent: "Total Spent",
    overBudgetCount: "Over Budget Count",
    budgetWarningCount: "Budget Warning Count",
    budgetAlerts: "Budget Alerts",
    totalZakatRecords: "Total Zakat Records",
    totalZakatDue: "Total Zakat Due",
    latestStatus: "Latest Status",
    zakatHistory: "Zakat History",
    notifications: "Notifications",
    totalNotifications: "Total Notifications",
    unread: "Unread",
    highSeverity: "High Severity",
    mediumSeverity: "Medium Severity",
  },
};
for (const [languageCode, text] of Object.entries(PHASE17_UI_TEXT)) {
  Object.assign(UI_TEXT[languageCode], text);
}
const PHASE1516_UI_TEXT = {
  bn: {
    moduleInvestment: "বিনিয়োগ",
    moduleHealth: "স্বাস্থ্য",
    moduleVehicle: "যানবাহন",
    moduleEducation: "শিক্ষা",
    moduleSubscription: "সাবস্ক্রিপশন",
    moduleDocument: "ডকুমেন্ট ভল্ট",
    moduleProperty: "প্রপার্টি",
    subType: "ধরন",
    provider: "প্রদানকারী",
    selectMember: "সদস্য নির্বাচন",
    selectAccount: "অ্যাকাউন্ট নির্বাচন",
    maturityDate: "পূর্ণতার তারিখ",
    serviceDueDate: "সার্ভিস due",
    returnRate: "রিটার্ন %",
    mileage: "মাইলেজ",
    monthlyTarget: "মাসিক লক্ষ্য",
    vehiclePlate: "যানবাহন/প্লেট",
    billingCycle: "বিলিং চক্র",
    monthly: "মাসিক",
    yearly: "বার্ষিক",
    monthlyCost: "মাসিক খরচ",
    valuation: "মূল্যায়ন",
    rentalIncome: "ভাড়া আয়",
    location: "অবস্থান",
    dueSoon: "শীঘ্র due",
    editItem: "সম্পাদনা",
    saveItem: "সংরক্ষণ",
    cancelEdit: "বাতিল",
    updateItem: "আইটেম আপডেট",
    createItem: "আইটেম তৈরি",
    upcomingDue: "আসন্ন due",
    attachDocumentFile: "ফাইল সংযুক্ত করুন",
    uploadFile: "ফাইল আপলোড",
    downloadFile: "ফাইল ডাউনলোড",
    replaceFile: "ফাইল পরিবর্তন",
    noFileAttached: "কোনো ফাইল নেই",
    fileAttached: "ফাইল সংযুক্ত",
    encryptedAtRest: "এনক্রিপ্টেড",
  },
  en: {
    moduleInvestment: "Investment",
    moduleHealth: "Health",
    moduleVehicle: "Vehicle",
    moduleEducation: "Education",
    moduleSubscription: "Subscription",
    moduleDocument: "Document Vault",
    moduleProperty: "Property",
    subType: "Type",
    provider: "Provider",
    selectMember: "Select member",
    selectAccount: "Select account",
    maturityDate: "Maturity date",
    serviceDueDate: "Service due date",
    returnRate: "Return %",
    mileage: "Mileage",
    monthlyTarget: "Monthly target",
    vehiclePlate: "Vehicle / plate",
    billingCycle: "Billing cycle",
    monthly: "Monthly",
    yearly: "Yearly",
    monthlyCost: "Monthly cost",
    valuation: "Valuation",
    rentalIncome: "Rental income",
    location: "Location",
    dueSoon: "Due soon",
    editItem: "Edit",
    saveItem: "Save",
    cancelEdit: "Cancel",
    updateItem: "Update item",
    createItem: "Create item",
    upcomingDue: "Upcoming due",
    attachDocumentFile: "Attach file",
    uploadFile: "Upload file",
    downloadFile: "Download file",
    replaceFile: "Replace file",
    noFileAttached: "No file attached",
    fileAttached: "File attached",
    encryptedAtRest: "Encrypted",
  },
};
Object.assign(PHASE1516_UI_TEXT, {
  ar: localizedPack(arMessages, PHASE1516_UI_TEXT.en),
  hi: localizedPack(hiMessages, PHASE1516_UI_TEXT.en),
  ur: localizedPack(urMessages, PHASE1516_UI_TEXT.en),
});
for (const [languageCode, text] of Object.entries(PHASE1516_UI_TEXT)) {
  Object.assign(UI_TEXT[languageCode], text);
}
const SETTINGS_UI_TEXT = {
  bn: {
    settingsTab_profile: "প্রোফাইল",
    settingsTab_family: "পরিবার",
    settingsTab_permissions: "অনুমতি",
    settingsTab_security: "সিকিউরিটি",
    familySettings: "পরিবার সেটিংস",
    saveFamilySettings: "পরিবার সেটিংস সংরক্ষণ",
    familySettingsHelp: "মুদ্রা ও টাইমজোন আপডেট করতে settings.manage অনুমতি লাগবে।",
    myOverrides: "আমার ওভাররাইড",
    noOverrides: "কোনো পারমিশন ওভাররাইড নেই",
    relationship: "সম্পর্ক",
    refresh: "রিফ্রেশ",
    emailDelivery: "ইমেইল ডেলিভারি",
    smtpReady: "SMTP প্রস্তুত",
    smtpNotConfigured: "SMTP কনফিগার নেই",
    smtpHelp: "আসল মেইল পাঠাতে backend .env এ SMTP_HOST + SMTP_FROM_EMAIL দিন। ফেক সেন্ড হয় না।",
    testNotificationEmail: "টেস্ট নোটিফিকেশন ইমেইল",
    emailSent: "ইমেইল পাঠানো হয়েছে",
    emailNotSent: "ইমেইল পাঠানো হয়নি",
  },
  en: {
    settingsTab_profile: "Profile",
    settingsTab_family: "Family",
    settingsTab_permissions: "Permissions",
    settingsTab_security: "Security",
    familySettings: "Family Settings",
    saveFamilySettings: "Save Family Settings",
    familySettingsHelp: "Updating currency/timezone requires settings.manage permission.",
    myOverrides: "My Overrides",
    noOverrides: "No permission overrides",
    relationship: "Relationship",
    refresh: "Refresh",
    emailDelivery: "Email delivery",
    smtpReady: "SMTP ready",
    smtpNotConfigured: "SMTP not configured",
    smtpHelp: "Set SMTP_HOST + SMTP_FROM_EMAIL in backend .env for real mail. No fake send.",
    testNotificationEmail: "Test notification email",
    emailSent: "Email sent",
    emailNotSent: "Email not sent",
  },
};
Object.assign(SETTINGS_UI_TEXT, {
  ar: localizedPack(arMessages, SETTINGS_UI_TEXT.en),
  hi: localizedPack(hiMessages, SETTINGS_UI_TEXT.en),
  ur: localizedPack(urMessages, SETTINGS_UI_TEXT.en),
});
for (const [languageCode, text] of Object.entries(SETTINGS_UI_TEXT)) {
  Object.assign(UI_TEXT[languageCode], text);
}
const GROCERY_UI_TEXT = {
  bn: {
    groceryTitle: "গ্রোসারি / বাজার",
    groceryTab_lists: "লিস্ট",
    groceryTab_scan: "স্ক্যান",
    groceryTab_vendors: "ভেন্ডর",
    groceryTab_collab: "কলাব",
    groceryTab_offline: "অফলাইন",
    groceryPendingSync: "গ্রোসারি কিউ",
    replayPendingSync: "পেন্ডিং সিঙ্ক রিপ্লে",
    pendingGroceryOutbox: "পেন্ডিং গ্রোসারি আউটবক্স",
    noOfflineQueue: "কোনো পেন্ডিং গ্রোসারি সিঙ্ক নেই",
    groceryLists: "বাজার লিস্ট",
    groceryItems: "আইটেম",
    bought: "কেনা",
    pending: "বাকি",
    selectListFirst: "আগে একটি বাজার লিস্ট সিলেক্ট করুন",
    activeList: "সক্রিয় লিস্ট",
    createGroceryList: "নতুন বাজার লিস্ট",
    listTitle: "লিস্ট শিরোনাম",
    budgetAmount: "বাজেট",
    vendor: "ভেন্ডর",
    createList: "লিস্ট তৈরি",
    noGroceryLists: "কোনো বাজার লিস্ট নেই",
    noVendor: "ভেন্ডর নেই",
    selected: "নির্বাচিত",
    open: "খুলুন",
    addGroceryItem: "আইটেম যোগ",
    itemName: "আইটেম নাম",
    qty: "পরিমাণ",
    unit: "ইউনিট",
    estimatedPrice: "আনুমানিক দাম",
    actualPrice: "প্রকৃত দাম",
    barcode: "বারকোড",
    addItem: "যোগ করুন",
    selectPaymentWallet: "পেমেন্ট ওয়ালেট",
    selectExpenseCategory: "খরচ ক্যাটাগরি",
    noGroceryItems: "কোনো আইটেম নেই",
    noBarcode: "বারকোড নেই",
    markBought: "কেনা হয়েছে",
    postExpense: "খরচ পোস্ট",
    expensePosted: "খরচ পোস্ট হয়েছে",
    barcodeLookup: "বারকোড লুকআপ",
    lookupBarcode: "বারকোড খুঁজুন",
    applyToItemForm: "আইটেম ফর্মে প্রয়োগ",
    found: "পাওয়া গেছে",
    noBarcodeMatch: "মিল পাওয়া যায়নি",
    ocrReceiptParse: "OCR রসিদ পার্স",
    ocrPlaceholder: "রসিদ টেক্সট পেস্ট করুন। উদাহরণ: চাল 120",
    parseReceipt: "রসিদ পার্স",
    addAllToList: "সব লিস্টে যোগ",
    noOcrSuggestions: "কোনো OCR সাজেশন নেই",
    vendorMaster: "ভেন্ডর মাস্টার",
    phone: "ফোন",
    address: "ঠিকানা",
    createVendor: "ভেন্ডর তৈরি",
    noVendors: "কোনো ভেন্ডর নেই",
    noPhone: "ফোন নেই",
    inactive: "নিষ্ক্রিয়",
    vendorSummary: "ভেন্ডর সারাংশ",
    noVendorSpending: "ভেন্ডর খরচ নেই",
    priceHistory: "দামের ইতিহাস",
    noPriceHistory: "দামের ইতিহাস নেই",
    syncMode: "সিঙ্ক মোড",
    realtime: "রিয়েলটাইম",
    openLists: "ওপেন লিস্ট",
    activity: "অ্যাকটিভিটি",
    noGroceryActivity: "কোনো গ্রোসারি অ্যাকটিভিটি নেই",
    openCameraScanner: "ক্যামেরা স্ক্যানার খুলুন",
    cameraBarcodeScan: "ক্যামেরা বারকোড স্ক্যান",
  },
  en: {
    groceryTitle: "Grocery / Bazaar",
    groceryTab_lists: "Lists",
    groceryTab_scan: "Scan",
    groceryTab_vendors: "Vendors",
    groceryTab_collab: "Collab",
    groceryTab_offline: "Offline",
    groceryPendingSync: "Grocery queue",
    replayPendingSync: "Replay pending sync",
    pendingGroceryOutbox: "Pending grocery outbox",
    noOfflineQueue: "No pending grocery sync rows",
    groceryLists: "Grocery Lists",
    groceryItems: "Items",
    bought: "Bought",
    pending: "Pending",
    selectListFirst: "Select a grocery list first",
    activeList: "Active list",
    createGroceryList: "Create Grocery List",
    listTitle: "List title",
    budgetAmount: "Budget amount",
    vendor: "Vendor",
    createList: "Create List",
    noGroceryLists: "No grocery lists found",
    noVendor: "No vendor",
    selected: "Selected",
    open: "Open",
    addGroceryItem: "Add Grocery Item",
    itemName: "Item name",
    qty: "Qty",
    unit: "Unit",
    estimatedPrice: "Estimated price",
    actualPrice: "Actual price",
    barcode: "Barcode",
    addItem: "Add Item",
    selectPaymentWallet: "Select payment wallet",
    selectExpenseCategory: "Select expense category",
    noGroceryItems: "No grocery items found",
    noBarcode: "No barcode",
    markBought: "Mark Bought",
    postExpense: "Post Expense",
    expensePosted: "Expense posted",
    barcodeLookup: "Barcode Lookup",
    lookupBarcode: "Lookup Barcode",
    applyToItemForm: "Apply to Item Form",
    found: "Found",
    noBarcodeMatch: "No barcode match",
    ocrReceiptParse: "OCR Receipt Parse",
    ocrPlaceholder: "Paste OCR receipt text. Example: Rice 120",
    parseReceipt: "Parse Receipt",
    addAllToList: "Add All to List",
    noOcrSuggestions: "No OCR suggestions yet",
    vendorMaster: "Vendor Master",
    phone: "Phone",
    address: "Address",
    createVendor: "Create Vendor",
    noVendors: "No grocery vendors found",
    noPhone: "No phone",
    inactive: "Inactive",
    vendorSummary: "Vendor Summary",
    noVendorSpending: "No vendor spending yet",
    priceHistory: "Price History",
    noPriceHistory: "No price history yet",
    syncMode: "Sync Mode",
    realtime: "Realtime",
    openLists: "Open Lists",
    activity: "Activity",
    noGroceryActivity: "No grocery activity yet",
    openCameraScanner: "Open camera scanner",
    cameraBarcodeScan: "Camera barcode scan",
  },
};
Object.assign(GROCERY_UI_TEXT, {
  ar: localizedPack(arMessages, GROCERY_UI_TEXT.en),
  hi: localizedPack(hiMessages, GROCERY_UI_TEXT.en),
  ur: localizedPack(urMessages, GROCERY_UI_TEXT.en),
});
for (const [languageCode, text] of Object.entries(GROCERY_UI_TEXT)) {
  Object.assign(UI_TEXT[languageCode], text);
}
const SYNC_UI_TEXT = {
  bn: {
    syncTab_status: "স্ট্যাটাস",
    syncTab_conflicts: "কনফ্লিক্ট",
    syncTab_pull: "পুল",
    syncTab_logs: "সিঙ্ক লগ",
    syncSuccessRate: "সফলতার হার",
    failCount: "ব্যর্থ",
    conflictResolveHelp: "লোকাল vs সার্ভার ডিফ দেখে resolve করুন",
    localPayload: "লোকাল ডেটা",
    remotePayload: "সার্ভার ডেটা",
    keepServer: "সার্ভার রাখুন",
    keepLocal: "লোকাল রাখুন",
    mergeBoth: "মার্জ",
    resolvedConflicts: "সমাধান করা কনফ্লিক্ট",
    noResolvedConflicts: "কোনো resolved conflict নেই",
    noPullPreview: "এখনো কোনো pull preview নেই",
    offlineDb: "অফলাইন DB",
    pcOfflineDbNote: "PC IndexedDB outbox ব্যবহার করে। SQLCipher শুধু নেটিভ মোবাইলে।",
  },
  en: {
    syncTab_status: "Status",
    syncTab_conflicts: "Conflicts",
    syncTab_pull: "Pull",
    syncTab_logs: "Sync logs",
    syncSuccessRate: "Success rate",
    failCount: "Fails",
    conflictResolveHelp: "Compare local vs server and resolve",
    localPayload: "Local payload",
    remotePayload: "Server payload",
    keepServer: "Keep Server",
    keepLocal: "Keep Local",
    mergeBoth: "Merge",
    resolvedConflicts: "Resolved Conflicts",
    noResolvedConflicts: "No resolved conflicts yet",
    noPullPreview: "No pull preview yet",
    offlineDb: "Offline DB",
    pcOfflineDbNote: "PC uses IndexedDB outbox. SQLCipher applies on native mobile builds.",
  },
};
Object.assign(SYNC_UI_TEXT, {
  ar: localizedPack(arMessages, SYNC_UI_TEXT.en),
  hi: localizedPack(hiMessages, SYNC_UI_TEXT.en),
  ur: localizedPack(urMessages, SYNC_UI_TEXT.en),
});
for (const [languageCode, text] of Object.entries(SYNC_UI_TEXT)) {
  Object.assign(UI_TEXT[languageCode], text);
}
const TOAST_UI_TEXT = {
  bn: {
    activeFamilyRequired: "সক্রিয় পরিবার প্রয়োজন",
    assetFundCreated: "সম্পদ/ফান্ড তৈরি হয়েছে",
    assetFundUpdated: "সম্পদ/ফান্ড আপডেট হয়েছে",
    backendConnectionFailed: "ব্যাকএন্ড সংযোগ ব্যর্থ",
    backupDownloadFailed: "ব্যাকআপ ডাউনলোড ব্যর্থ",
    backupDownloadStarted: "ব্যাকআপ ডাউনলোড শুরু",
    barcodeApplied: "বারকোড আইটেম ফর্মে প্রয়োগ হয়েছে",
    barcodeRequired: "বারকোড প্রয়োজন",
    budgetClosed: "বাজেট বন্ধ হয়েছে",
    budgetCreated: "বাজেট তৈরি হয়েছে",
    budgetLoadFailed: "বাজেট লোড ব্যর্থ",
    budgetNameRequired: "বাজেটের নাম প্রয়োজন",
    budgetUpdated: "বাজেট আপডেট হয়েছে",
    cannotTransferSameWallet: "একই ওয়ালেটে ট্রান্সফার করা যায় না",
    dashboardLoadFailed: "ড্যাশবোর্ড লোড ব্যর্থ",
    documentDownloadStarted: "ডকুমেন্ট ডাউনলোড শুরু",
    documentSavedUploaded: "ডকুমেন্ট সেভ ও ফাইল আপলোড হয়েছে (এনক্রিপ্টেড)",
    documentUploaded: "ডকুমেন্ট ফাইল আপলোড হয়েছে (এনক্রিপ্টেড)",
    downloadComplete: "ডাউনলোড সম্পন্ন",
    downloadFailed: "ডাউনলোড ব্যর্থ",
    emailPasswordRequired: "ইমেইল ও পাসওয়ার্ড প্রয়োজন",
    emailRequiredPasswordReset: "পাসওয়ার্ড রিসেটের জন্য ইমেইল প্রয়োজন",
    emailRequiredVerification: "ভেরিফিকেশনের জন্য ইমেইল প্রয়োজন",
    expenseCategoryRequired: "খরচ ক্যাটাগরি প্রয়োজন",
    familyLoadFailed: "পরিবার লোড ব্যর্থ",
    familySettingsUpdated: "পরিবার সেটিংস আপডেট হয়েছে",
    fromWalletRequired: "সোর্স ওয়ালেট প্রয়োজন",
    goalClosed: "গোল বন্ধ হয়েছে",
    goalContributionPosted: "গোল জমা পোস্ট হয়েছে",
    goalCreated: "গোল তৈরি হয়েছে",
    goalHistoryLoaded: "গোল হিস্টরি লোড হয়েছে",
    goalNameRequired: "গোলের নাম প্রয়োজন",
    goalRequired: "গোল প্রয়োজন",
    goalUpdated: "গোল আপডেট হয়েছে",
    goalWithdrawPosted: "গোল উত্তোলন পোস্ট হয়েছে",
    goalsLoadFailed: "গোল লোড ব্যর্থ",
    groceryItemAdded: "গ্রোসারি আইটেম যোগ হয়েছে",
    groceryItemNameRequired: "গ্রোসারি আইটেমের নাম প্রয়োজন",
    groceryListCreated: "গ্রোসারি লিস্ট তৈরি হয়েছে",
    groceryListTitleRequired: "গ্রোসারি লিস্টের শিরোনাম প্রয়োজন",
    groceryVendorCreated: "গ্রোসারি ভেন্ডর তৈরি হয়েছে",
    inviteExpiryRange: "আমন্ত্রণের মেয়াদ ১–৩০ দিন হতে হবে",
    inviteGenerated: "আমন্ত্রণ তৈরি হয়েছে",
    inviteMaxUsesRange: "আমন্ত্রণ সর্বোচ্চ ব্যবহার ১–১০০ হতে হবে",
    languageNotSupported: "ভাষা সাপোর্টেড নয়",
    loanClosed: "ঋণ বন্ধ হয়েছে",
    loanCreated: "ঋণ তৈরি হয়েছে",
    loanHistoryLoaded: "ঋণ হিস্টরি লোড হয়েছে",
    loanLoadFailed: "ঋণ লোড ব্যর্থ",
    loanPaymentPosted: "ঋণ পেমেন্ট পোস্ট হয়েছে",
    loanRequired: "ঋণ প্রয়োজন",
    loanUpdated: "ঋণ আপডেট হয়েছে",
    loggedOut: "লগআউট হয়েছে",
    loginSuccessful: "লগইন সফল",
    memberPermissionUpdated: "মেম্বার অনুমতি আপডেট হয়েছে",
    nameRequired: "নাম প্রয়োজন",
    noActiveFamilyForUser: "এই ইউজারের কোনো সক্রিয় পরিবার নেই",
    noBarcodeMatch: "প্রয়োগ করার মতো বারকোড মিল নেই",
    noOcrSuggestions: "কোনো OCR সাজেশন নেই",
    onlyActiveBudgetEdit: "শুধু সক্রিয় বাজেট এডিট করা যায়",
    onlyActiveGoalEdit: "শুধু সক্রিয় গোল এডিট করা যায়",
    onlyActiveLoanEdit: "শুধু সক্রিয় ঋণ এডিট করা যায়",
    onlyActivePausedRecurringEdit: "শুধু সক্রিয়/পজড রেকারিং এডিট করা যায়",
    permissionKeyRequired: "অনুমতি কী প্রয়োজন",
    personNameRequired: "ব্যক্তির নাম প্রয়োজন",
    phase16Created: "সাবস্ক্রিপশন/ডকুমেন্ট/সম্পত্তি তৈরি হয়েছে",
    phase16Updated: "সাবস্ক্রিপশন/ডকুমেন্ট/সম্পত্তি আপডেট হয়েছে",
    receiptTextRequired: "রসিদের টেক্সট প্রয়োজন",
    recurringClosed: "রেকারিং বন্ধ হয়েছে",
    recurringCreated: "রেকারিং তৈরি হয়েছে",
    recurringHistoryLoaded: "রেকারিং হিস্টরি লোড হয়েছে",
    recurringLoadFailed: "রেকারিং লোড ব্যর্থ",
    recurringPaused: "রেকারিং পজ হয়েছে",
    recurringPosted: "রেকারিং পোস্ট হয়েছে",
    recurringResumed: "রেকারিং আবার চালু",
    recurringTitleRequired: "রেকারিং শিরোনাম প্রয়োজন",
    recurringUpdated: "রেকারিং আপডেট হয়েছে",
    refreshTokenUnavailable: "রিফ্রেশ টোকেন নেই। আবার লগইন করুন।",
    restorePreviewLoaded: "রিস্টোর প্রিভিউ লোড হয়েছে",
    savingsGoalClosed: "সঞ্চয় গোল বন্ধ হয়েছে",
    savingsGoalCreated: "সঞ্চয় গোল তৈরি হয়েছে",
    savingsGoalRequired: "সঞ্চয় গোল প্রয়োজন",
    savingsGoalUpdated: "সঞ্চয় গোল আপডেট হয়েছে",
    savingsHistoryLoaded: "সঞ্চয় হিস্টরি লোড হয়েছে",
    savingsLoadFailed: "সঞ্চয় লোড ব্যর্থ",
    savingsNameRequired: "সঞ্চয়ের নাম প্রয়োজন",
    selectGroceryListFirst: "আগে একটি গ্রোসারি লিস্ট বেছে নিন",
    selectWalletExpenseCategory: "আগে ওয়ালেট ও খরচ ক্যাটাগরি বেছে নিন",
    sessionRefreshed: "সেশন রিফ্রেশ হয়েছে",
    startDateRequired: "শুরুর তারিখ প্রয়োজন",
    syncPullPreviewLoaded: "সিঙ্ক পুল প্রিভিউ লোড হয়েছে",
    pushLocalOutbox: "লোকাল আউটবক্স পুশ",
    pushingOutbox: "পুশ হচ্ছে…",
    localPendingOutbox: "লোকাল পেন্ডিং",
    browserOnline: "অনলাইন",
    browserOffline: "অফলাইন",
    syncPushDone: "লোকাল আউটবক্স সার্ভারে পুশ হয়েছে",
    syncQueuedOffline: "অফলাইন — পরিবর্তন লোকাল কিউতে সেভ হয়েছে",
    syncTab_push: "পুশ",
    offlineExportOpened: "অফলাইন ক্যাশ থেকে এক্সপোর্ট খোলা হয়েছে",
    documentQueuedOffline: "ডকুমেন্ট অফলাইন কিউতে সেভ — অনলাইনে আপলোড হবে",
    toWalletRequired: "গন্তব্য ওয়ালেট প্রয়োজন",
    transactionLoadFailed: "লেনদেন লোড ব্যর্থ",
    transactionPosted: "লেনদেন পোস্ট হয়েছে",
    validAmountRequired: "সঠিক পরিমাণ প্রয়োজন",
    validBudgetAmountRequired: "সঠিক বাজেট পরিমাণ প্রয়োজন",
    validCurrencyRequired: "সঠিক মুদ্রা কোড প্রয়োজন",
    validLoanAmountRequired: "সঠিক ঋণ পরিমাণ প্রয়োজন",
    validNisabRequired: "সঠিক নিসাব পরিমাণ প্রয়োজন",
    validPaymentAmountRequired: "সঠিক পেমেন্ট পরিমাণ প্রয়োজন",
    validRecurringAmountRequired: "সঠিক রেকারিং পরিমাণ প্রয়োজন",
    validTargetAmountRequired: "সঠিক টার্গেট পরিমাণ প্রয়োজন",
    validTimezoneRequired: "সঠিক টাইমজোন প্রয়োজন",
    vendorNameRequired: "ভেন্ডরের নাম প্রয়োজন",
    walletCreated: "ওয়ালেট তৈরি হয়েছে",
    walletLoadFailed: "ওয়ালেট লোড ব্যর্থ",
    walletNameRequired: "ওয়ালেটের নাম প্রয়োজন",
    walletRequired: "ওয়ালেট প্রয়োজন",
    languageLockedPrefix: "ভাষা লক",
    notificationScanCreated: "নোটিফিকেশন স্ক্যান: {n} তৈরি",
    markedReadCount: "পড়া হয়েছে: {n}",
    zakatDueAmount: "যাকাত বাকি: {amount}",
    groceryExpensePosted: "গ্রোসারি খরচ পোস্ট: {id}",
    ocrSuggestionsCount: "OCR সাজেশন: {n}",
    ocrItemAdded: "OCR আইটেম যোগ: {name}",
    ocrItemsAdded: "OCR আইটেম যোগ: {n}",
    backupCreatedFile: "ব্যাকআপ তৈরি: {file}",
    conflictResolvedStrategy: "কনফ্লিক্ট সমাধান: {strategy}",
    yearPlaceholder: "বছর",
    cashAmountPlaceholder: "নগদ পরিমাণ",
    goldValuePlaceholder: "স্বর্ণের মূল্য",
    nisabAmountPlaceholder: "নিসাব পরিমাণ",
    refreshZakat: "যাকাত রিফ্রেশ",
    zakatableLabel: "যাকাতযোগ্য:",
    refreshNotifications: "নোটিফিকেশন রিফ্রেশ",
    scanNotifications: "নোটিফিকেশন স্ক্যান",
    markAllRead: "সব পড়া চিহ্নিত",
    notifyTab_inbox: "ইনবক্স",
    notifyTab_delivery: "ডেলিভারি",
    notifyTab_devices: "ডিভাইস",
    pushDevices: "ডিভাইস",
    registerPushDevice: "পুশ ডিভাইস রেজিস্টার",
    pastePushToken: "FCM / Expo পুশ টোকেন পেস্ট করুন",
    pastePushTokenHint: "আসল FCM/Expo পুশ টোকেন পেস্ট করুন (কমপক্ষে ৮ অক্ষর)",
    registerDevice: "ডিভাইস রেজিস্টার",
    unregisterDevice: "আনরেজিস্টার",
    noPushDevices: "কোনো ডিভাইস রেজিস্টার নেই",
    sendTestPush: "টেস্ট পুশ পাঠান",
    pushDeviceRegistered: "পুশ ডিভাইস রেজিস্টার হয়েছে",
    pushDeviceUnregistered: "ডিভাইস আনরেজিস্টার হয়েছে",
    testPushSent: "টেস্ট পুশ পাঠানো হয়েছে: {n} ডিভাইস",
    testPushNotSent: "টেস্ট পুশ পাঠানো হয়নি",
    autoSync: "অটো সিঙ্ক",
    autoSyncOnHint: "অনলাইন থাকলে প্রায় ৪৫ সেকেন্ডে IndexedDB আউটবক্স ফ্লাশ হয়।",
    autoSyncOffHint: "স্বয়ংক্রিয় আউটবক্স ফ্লাশ বন্ধ।",
    autoSyncPause: "অটো সিঙ্ক চালু",
    autoSyncResume: "অটো সিঙ্ক বন্ধ",
    lastAutoSync: "শেষ অটো-সিঙ্ক",
    revokeInvite: "ইনভাইট বাতিল",
    revokingInvite: "বাতিল হচ্ছে...",
    inviteRevoked: "ইনভাইট বাতিল হয়েছে",
    statusRead: "পঠিত",
    statusUnread: "অপঠিত",
    read: "পড়া",
    delete: "মুছুন",
    noNotificationsFound: "কোনো নোটিফিকেশন নেই",
    readyExcelPdfExport: "Excel/PDF এক্সপোর্টের জন্য প্রস্তুত",
    excel: "Excel",
    pdf: "PDF",
    given: "দেওয়া",
    taken: "নেওয়া",
    allStatus: "সব স্ট্যাটাস",
    activeStatus: "সক্রিয়",
    closedStatus: "বন্ধ",
    fcmOn: "FCM: চালু",
    fcmOff: "FCM: বন্ধ",
    smtpOff: "SMTP বন্ধ",
  },
  en: {
    activeFamilyRequired: "Active family required",
    assetFundCreated: "Asset/Fund item created",
    assetFundUpdated: "Asset/Fund item updated",
    backendConnectionFailed: "Backend connection failed",
    backupDownloadFailed: "Backup download failed",
    backupDownloadStarted: "Backup download started",
    barcodeApplied: "Barcode item applied to form",
    barcodeRequired: "Barcode required",
    budgetClosed: "Budget closed",
    budgetCreated: "Budget created",
    budgetLoadFailed: "Budget load failed",
    budgetNameRequired: "Budget name required",
    budgetUpdated: "Budget updated",
    cannotTransferSameWallet: "Cannot transfer to the same wallet",
    dashboardLoadFailed: "Dashboard load failed",
    documentDownloadStarted: "Document download started",
    documentSavedUploaded: "Document saved and file uploaded (encrypted at rest)",
    documentUploaded: "Document file uploaded (encrypted at rest)",
    downloadComplete: "Download complete",
    downloadFailed: "Download failed",
    emailPasswordRequired: "Email and password required",
    emailRequiredPasswordReset: "Email required for password reset",
    emailRequiredVerification: "Email required for verification",
    expenseCategoryRequired: "Expense category required",
    familyLoadFailed: "Family load failed",
    familySettingsUpdated: "Family settings updated",
    fromWalletRequired: "From wallet required",
    goalClosed: "Goal closed",
    goalContributionPosted: "Goal contribution posted",
    goalCreated: "Goal created",
    goalHistoryLoaded: "Goal history loaded",
    goalNameRequired: "Goal name required",
    goalRequired: "Goal required",
    goalUpdated: "Goal updated",
    goalWithdrawPosted: "Goal withdraw posted",
    goalsLoadFailed: "Goals load failed",
    groceryItemAdded: "Grocery item added",
    groceryItemNameRequired: "Grocery item name required",
    groceryListCreated: "Grocery list created",
    groceryListTitleRequired: "Grocery list title required",
    groceryVendorCreated: "Grocery vendor created",
    inviteExpiryRange: "Invite expiry must be 1-30 days",
    inviteGenerated: "Invite generated",
    inviteMaxUsesRange: "Invite max uses must be 1-100",
    languageNotSupported: "Language is not supported",
    loanClosed: "Loan closed",
    loanCreated: "Loan created",
    loanHistoryLoaded: "Loan history loaded",
    loanLoadFailed: "Loan load failed",
    loanPaymentPosted: "Loan payment posted",
    loanRequired: "Loan required",
    loanUpdated: "Loan updated",
    loggedOut: "Logged out",
    loginSuccessful: "Login successful",
    memberPermissionUpdated: "Member permission updated",
    nameRequired: "Name required",
    noActiveFamilyForUser: "No active family found for this user",
    noBarcodeMatch: "No barcode match to apply",
    noOcrSuggestions: "No OCR suggestions",
    onlyActiveBudgetEdit: "Only active budget can be edited",
    onlyActiveGoalEdit: "Only active goal can be edited",
    onlyActiveLoanEdit: "Only active loan can be edited",
    onlyActivePausedRecurringEdit: "Only active or paused recurring can be edited",
    permissionKeyRequired: "Permission key required",
    personNameRequired: "Person name required",
    phase16Created: "Subscription/Document/Property item created",
    phase16Updated: "Subscription/Document/Property item updated",
    receiptTextRequired: "Receipt text required",
    recurringClosed: "Recurring closed",
    recurringCreated: "Recurring created",
    recurringHistoryLoaded: "Recurring history loaded",
    recurringLoadFailed: "Recurring load failed",
    recurringPaused: "Recurring paused",
    recurringPosted: "Recurring posted",
    recurringResumed: "Recurring resumed",
    recurringTitleRequired: "Recurring title required",
    recurringUpdated: "Recurring updated",
    refreshTokenUnavailable: "Refresh token unavailable. Please login again.",
    restorePreviewLoaded: "Restore preview loaded",
    savingsGoalClosed: "Savings goal closed",
    savingsGoalCreated: "Savings goal created",
    savingsGoalRequired: "Savings goal required",
    savingsGoalUpdated: "Savings goal updated",
    savingsHistoryLoaded: "Savings history loaded",
    savingsLoadFailed: "Savings load failed",
    savingsNameRequired: "Savings name required",
    selectGroceryListFirst: "Select a grocery list first",
    selectWalletExpenseCategory: "Select wallet and expense category first",
    sessionRefreshed: "Session refreshed",
    startDateRequired: "Start date required",
    syncPullPreviewLoaded: "Sync pull preview loaded",
    pushLocalOutbox: "Push local outbox",
    pushingOutbox: "Pushing…",
    localPendingOutbox: "Local pending",
    browserOnline: "Online",
    browserOffline: "Offline",
    syncPushDone: "Local outbox pushed to server",
    syncQueuedOffline: "Offline — change saved to local queue",
    syncTab_push: "Push",
    offlineExportOpened: "Opened export from offline cache",
    documentQueuedOffline: "Document queued offline — will upload when online",
    toWalletRequired: "To wallet required",
    transactionLoadFailed: "Transaction load failed",
    transactionPosted: "Transaction posted",
    validAmountRequired: "Valid amount required",
    validBudgetAmountRequired: "Valid budget amount required",
    validCurrencyRequired: "Valid currency code required",
    validLoanAmountRequired: "Valid loan amount required",
    validNisabRequired: "Valid nisab amount required",
    validPaymentAmountRequired: "Valid payment amount required",
    validRecurringAmountRequired: "Valid recurring amount required",
    validTargetAmountRequired: "Valid target amount required",
    validTimezoneRequired: "Valid timezone required",
    vendorNameRequired: "Vendor name required",
    walletCreated: "Wallet created",
    walletLoadFailed: "Wallet load failed",
    walletNameRequired: "Wallet name required",
    walletRequired: "Wallet required",
    languageLockedPrefix: "Language locked",
    notificationScanCreated: "Notification scan: {n} created",
    markedReadCount: "Marked read: {n}",
    zakatDueAmount: "Zakat due: {amount}",
    groceryExpensePosted: "Grocery expense posted: {id}",
    ocrSuggestionsCount: "OCR suggestions: {n}",
    ocrItemAdded: "OCR item added: {name}",
    ocrItemsAdded: "OCR items added: {n}",
    backupCreatedFile: "Backup created: {file}",
    conflictResolvedStrategy: "Conflict resolved: {strategy}",
    yearPlaceholder: "Year",
    cashAmountPlaceholder: "Cash amount",
    goldValuePlaceholder: "Gold value",
    nisabAmountPlaceholder: "Nisab amount",
    refreshZakat: "Refresh Zakat",
    zakatableLabel: "Zakatable:",
    refreshNotifications: "Refresh Notifications",
    scanNotifications: "Scan Notifications",
    markAllRead: "Mark All Read",
    notifyTab_inbox: "Inbox",
    notifyTab_delivery: "Delivery",
    notifyTab_devices: "Devices",
    pushDevices: "Devices",
    registerPushDevice: "Register push device",
    pastePushToken: "Paste FCM / Expo push token",
    pastePushTokenHint: "Paste a real FCM/Expo push token (min 8 chars)",
    registerDevice: "Register device",
    unregisterDevice: "Unregister",
    noPushDevices: "No devices registered",
    sendTestPush: "Send test push",
    pushDeviceRegistered: "Push device registered",
    pushDeviceUnregistered: "Device unregistered",
    testPushSent: "Test push sent to {n} device(s)",
    testPushNotSent: "Test push not sent",
    autoSync: "Auto sync",
    autoSyncOnHint: "Flushes IndexedDB outbox about every 45s while online.",
    autoSyncOffHint: "Automatic outbox flush is paused.",
    autoSyncPause: "Auto sync ON",
    autoSyncResume: "Auto sync OFF",
    lastAutoSync: "Last auto-sync",
    revokeInvite: "Revoke invite",
    revokingInvite: "Revoking...",
    inviteRevoked: "Invite revoked",
    statusRead: "READ",
    statusUnread: "UNREAD",
    read: "Read",
    delete: "Delete",
    noNotificationsFound: "No notifications found",
    readyExcelPdfExport: "Ready for Excel/PDF export",
    excel: "Excel",
    pdf: "PDF",
    given: "Given",
    taken: "Taken",
    allStatus: "All Status",
    activeStatus: "Active",
    closedStatus: "Closed",
    fcmOn: "FCM: ON",
    fcmOff: "FCM: OFF",
    smtpOff: "SMTP off",
  },
};
Object.assign(TOAST_UI_TEXT, {
  ar: localizedPack(arMessages, TOAST_UI_TEXT.en),
  hi: localizedPack(hiMessages, TOAST_UI_TEXT.en),
  ur: localizedPack(urMessages, TOAST_UI_TEXT.en),
});
for (const [languageCode, text] of Object.entries(TOAST_UI_TEXT)) {
  Object.assign(UI_TEXT[languageCode], text);
}
const AUTH_GATE_UI_TEXT = {
  bn: {
    createAccount: "অ্যাকাউন্ট তৈরি",
    forgotPasswordLink: "পাসওয়ার্ড ভুলে গেছেন?",
    backToLogin: "লগইনে ফিরে যান",
    fullName: "পুরো নাম",
    showPassword: "পাসওয়ার্ড দেখান",
    hidePassword: "পাসওয়ার্ড লুকান",
    signingIn: "লগইন হচ্ছে...",
    creatingAccount: "অ্যাকাউন্ট তৈরি হচ্ছে...",
    sendingReset: "রিসেট ইমেইল পাঠানো হচ্ছে...",
    registerSuccess: "অ্যাকাউন্ট তৈরি হয়েছে — এখন লগইন করুন",
    forgotSent: "রিসেট লিংক ইমেইলে পাঠানো হয়েছে (চেক করুন)",
    authLoadingTitle: "অপেক্ষা করুন",
    authLoadingHint: "সিকিউর সেশন প্রস্তুত হচ্ছে...",
    alreadyHaveAccount: "আগে থেকে অ্যাকাউন্ট আছে?",
    needAccount: "নতুন ইউজার?",
    sendResetLink: "রিসেট লিংক পাঠান",
    phoneOptional: "ফোন (ঐচ্ছিক)",
    splashHint: "আর্কিটেকচার লোড হচ্ছে...",
    splashLoading: "লোড হচ্ছে...",
    authGateSubtitle: "পরিবার ফাইন্যান্স — লগইন, নতুন পরিবার, বা ইনভাইট দিয়ে যোগ দিন",
    pathLogin: "লগইন",
    pathCreateFamily: "পরিবার তৈরি",
    pathJoinInvite: "ইনভাইট যোগ",
    pathForgot: "পাসওয়ার্ড",
    pathCreateFamilyHint: "আপনি Owner হবেন। স্ত্রী/স্বামী/পরিবারকে পরে ইনভাইট দিয়ে যোগ করবেন।",
    pathJoinInviteHint: "Owner-এর ইনভাইট কোড দিয়ে যোগ দিন — অনুমোদনের পর অ্যাক্সেস পাবেন।",
    familyName: "পরিবারের নাম",
    iAmRelation: "আমি পরিবারে কে?",
    myRelationInFamily: "পরিবারে আমার সম্পর্ক",
    inviteCode: "ইনভাইট কোড",
    inviteCodePlaceholder: "ইনভাইট কোড (যেমন ABC123)",
    relationshipSerialOptional: "সিরিয়াল/ক্রম (ঐচ্ছিক — বড়/ছোট ভাই ইত্যাদি)",
    createFamilyAccount: "পরিবার তৈরি করুন",
    submitJoinInvite: "যোগদানের অনুরোধ পাঠান",
    creatingFamilyGate: "পরিবার তৈরি হচ্ছে...",
    joiningFamilyGate: "যোগদানের অনুরোধ পাঠানো হচ্ছে...",
    familyGateFieldsRequired: "নাম, ইমেইল, পাসওয়ার্ড ও পরিবারের নাম দরকার",
    joinGateFieldsRequired: "ইমেইল, পাসওয়ার্ড ও ইনভাইট কোড দরকার",
    familyCreatedGate: "পরিবার তৈরি হয়েছে — ড্যাশবোর্ডে যান",
    joinRequestedGate: "যোগদানের অনুরোধ পাঠানো হয়েছে — Owner অনুমোদন করবেন",
    familyCreateFailed: "পরিবার তৈরি ব্যর্থ",
    joinFailedGate: "ইনভাইট যোগদান ব্যর্থ",
    flowStep1: "১. অ্যাকাউন্ট",
    flowStep2: "২. পরিবার / ইনভাইট",
    flowStep3: "৩. অনুমোদন",
  },
  en: {
    createAccount: "Create account",
    forgotPasswordLink: "Forgot password?",
    backToLogin: "Back to login",
    fullName: "Full name",
    showPassword: "Show password",
    hidePassword: "Hide password",
    signingIn: "Signing in...",
    creatingAccount: "Creating account...",
    sendingReset: "Sending reset email...",
    registerSuccess: "Account created — please login",
    forgotSent: "Reset link sent to email (check inbox)",
    authLoadingTitle: "Please wait",
    authLoadingHint: "Preparing a secure session...",
    alreadyHaveAccount: "Already have an account?",
    needAccount: "New user?",
    sendResetLink: "Send reset link",
    phoneOptional: "Phone (optional)",
    splashHint: "Loading architecture...",
    splashLoading: "Loading...",
    authGateSubtitle: "Family finance — login, create a family, or join with invite",
    pathLogin: "Login",
    pathCreateFamily: "Create family",
    pathJoinInvite: "Join invite",
    pathForgot: "Password",
    pathCreateFamilyHint: "You become Owner. Invite wife / husband / family later with a code.",
    pathJoinInviteHint: "Join with the Owner’s invite code — access after approval.",
    familyName: "Family name",
    iAmRelation: "Who am I in the family?",
    myRelationInFamily: "My relationship in the family",
    inviteCode: "Invite code",
    inviteCodePlaceholder: "Invite code (e.g. ABC123)",
    relationshipSerialOptional: "Serial / rank (optional — elder / younger…)",
    createFamilyAccount: "Create family",
    submitJoinInvite: "Send join request",
    creatingFamilyGate: "Creating family...",
    joiningFamilyGate: "Sending join request...",
    familyGateFieldsRequired: "Name, email, password and family name are required",
    joinGateFieldsRequired: "Email, password and invite code are required",
    familyCreatedGate: "Family created — opening dashboard",
    joinRequestedGate: "Join requested — waiting for Owner approval",
    familyCreateFailed: "Could not create family",
    joinFailedGate: "Could not join with invite",
    flowStep1: "1. Account",
    flowStep2: "2. Family / invite",
    flowStep3: "3. Approval",
  },
};
Object.assign(AUTH_GATE_UI_TEXT, {
  ar: localizedPack(arMessages, AUTH_GATE_UI_TEXT.en),
  hi: localizedPack(hiMessages, AUTH_GATE_UI_TEXT.en),
  ur: localizedPack(urMessages, AUTH_GATE_UI_TEXT.en),
});
for (const [languageCode, text] of Object.entries(AUTH_GATE_UI_TEXT)) {
  Object.assign(UI_TEXT[languageCode], text);
}
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
  const [fullName, _setFullName] = useState("");
  const [phone, _setPhone] = useState("");
  const [showSplash, setShowSplash] = useState(true);
  const finishSplash = useCallback(() => setShowSplash(false), []);
  const [apiBase, setApiBase] = useState(() => readStoredApiBase());
  const [token, setToken] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [families, setFamilies] = useState([]);
  const [activeFamilyId, setActiveFamilyId] = useState("");
  const [familiesLoading, setFamiliesLoading] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [myPermissions, setMyPermissions] = useState(null);
  const [memberPermissions, setMemberPermissions] = useState([]);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [familyCurrencyForm, setFamilyCurrencyForm] = useState("");
  const [familyTimezoneForm, setFamilyTimezoneForm] = useState("");
  const [settingsTab, setSettingsTab] = useState("profile");
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [securityAction, setSecurityAction] = useState("");
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
  const [cloudOnlyMode, setCloudOnlyMode] = useState(() => loadCloudOnlyMode());
  const cloudAutoSyncRef = useRef(cloudAutoSync);
  const cloudAutoBackupRunningRef = useRef(false);

  const [dashboard, setDashboard] = useState(null);
  const [wallets, setWallets] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [categories, setCategories] = useState([]);
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
  const [inviteForm, setInviteForm] = useState({
    expires_in_days: "7",
    max_uses: "1",
    invitee_email: "",
    send_email: false,
  });
  const [notifications, setNotifications] = useState([]);
  const [notificationSummary, setNotificationSummary] = useState(null);
  const [notificationDelivery, setNotificationDelivery] = useState(null);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [pushDevices, setPushDevices] = useState([]);
  const [pushTokenDraft, setPushTokenDraft] = useState("");
  const [pushPlatform, setPushPlatform] = useState("WEB");
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
    setTimeout(() => setToast(null), 3000);
  }

  function setMessage(message, type = "success") {
    setStatus(message);
    showToast(message, type);

    setTimeout(() => {
      setStatus((current) => (current === message ? "" : current));
    }, 3000);
  }

  const isAppAuthed = Boolean(token) || (cloudOnlyMode && Boolean(firebaseUser?.uid));

  function isCloudLocalMode() {
    return cloudOnlyMode && !token && Boolean(activeFamilyId);
  }

  async function pushCloudSnapshotIfReady() {
    if (!firebaseUser?.uid || !activeFamilyId) return;
    try {
      await pushCloudSnapshot({
        uid: firebaseUser.uid,
        familyId: activeFamilyId,
        deviceLabel: SYNC_DEVICE_ID || "mobile",
      });
    } catch {
      /* ignore background sync errors */
    }
  }

  async function activateCloudSession(user, familyId, familyName = "") {
    persistCloudOnlyMode(true);
    setCloudOnlyMode(true);
    persistCloudFamilyId(familyId);
    setActiveFamilyId(familyId);
    setFirebaseUser(user);
    setFamilies([{ id: familyId, name: familyName || t("cloudOnlyFamilyLabel") }]);
    setCurrentUser({
      full_name: user.displayName || user.email || "Cloud User",
      email: user.email || "",
    });
    await hydrateFromCloudCache(familyId);
    await refreshFirebaseMeta(user.uid);
  }

  async function resolveCloudFamilyId(uid) {
    let familyId = loadCloudFamilyId();
    try {
      const restored = await pullCloudSnapshot(uid);
      if (restored?.familyId) familyId = restored.familyId;
    } catch {
      /* first-time cloud user may have no snapshot */
    }
    if (!familyId) {
      const profile = await getUserFamilyProfile(uid);
      familyId = profile?.family_id || "";
    }
    return familyId;
  }

  function applyOfflineCacheToState(cache) {
    const phase15 = cache["life/phase15"];
    const phase16 = cache["life/phase16"];
    if (Array.isArray(cache["finance/wallets"])) setWallets(cache["finance/wallets"]);
    if (Array.isArray(cache["finance/transactions"])) setTransactions(cache["finance/transactions"]);
    if (Array.isArray(cache["finance/savings"])) setSavings(cache["finance/savings"]);
    if (Array.isArray(cache["finance/loans"])) setLoans(cache["finance/loans"]);
    if (Array.isArray(cache["finance/budgets"])) setBudgets(cache["finance/budgets"]);
    if (Array.isArray(cache["finance/recurring"])) setRecurringItems(cache["finance/recurring"]);
    if (Array.isArray(cache["finance/goals"])) setGoals(cache["finance/goals"]);
    if (cache["finance/goalSummary"]) setGoalSummary(cache["finance/goalSummary"]);
    if (phase15?.items) setPhase15Items(phase15.items);
    if (phase15?.summary) setPhase15Summary(phase15.summary);
    if (phase16?.items) setPhase16Items(phase16.items);
    if (phase16?.summary) setPhase16Summary(phase16.summary);
    if (cache["zakat/main"]) setZakatRecords(Array.isArray(cache["zakat/main"]) ? cache["zakat/main"] : cache["zakat/main"]?.records || []);
    if (cache["reports/overview"]) setFinancialReport(cache["reports/overview"]);
    if (cache["system/currency"]) setCurrencySummary(cache["system/currency"]);
    setDashboard(buildDashboardFromCache(cache));
  }

  async function hydrateFromCloudCache(familyId) {
    const cache = await hydrateFamilyFromOfflineCache(familyId);
    applyOfflineCacheToState(cache);
    return cache;
  }

  async function handleCloudOnlySignIn() {
    if (!FIREBASE_CONFIGURED) {
      setMessage(t("firebaseNotConfigured"), "error");
      return;
    }
    setCloudBusy(true);
    setAuthLoading(true);
    try {
      const user = await firebaseSignInGoogle();
      await ensureUserProfile(user.uid, user);

      const familyId = await resolveCloudFamilyId(user.uid);
      if (!familyId) {
        setMessage(t("cloudOnlyNoDataCreate"), "error");
        return;
      }

      await activateCloudSession(user, familyId);
      setMessage(t("cloudOnlySignInSuccess"), "success");
    } catch (err) {
      setMessage(err.message || t("firebaseSyncFailed"), "error");
    } finally {
      setCloudBusy(false);
      setAuthLoading(false);
    }
  }

  async function handleCloudEmailSignIn({ email, password }) {
    if (!FIREBASE_CONFIGURED) {
      setMessage(t("firebaseNotConfigured"), "error");
      return;
    }
    setCloudBusy(true);
    setAuthLoading(true);
    try {
      const user = await firebaseSignInEmail(email, password);
      await ensureUserProfile(user.uid, user);

      const familyId = await resolveCloudFamilyId(user.uid);
      if (!familyId) {
        setMessage(t("cloudOnlyNoDataCreate"), "error");
        return;
      }

      await activateCloudSession(user, familyId);
      setMessage(t("cloudOnlySignInSuccess"), "success");
    } catch (err) {
      setMessage(err.message || t("firebaseSyncFailed"), "error");
    } finally {
      setCloudBusy(false);
      setAuthLoading(false);
    }
  }

  async function handleCreateCloudFamily({
    email,
    password,
    fullName,
    familyName,
    currency,
    timezone,
    ownerRelation,
  }) {
    if (!FIREBASE_CONFIGURED) {
      setMessage(t("firebaseNotConfigured"), "error");
      return;
    }
    setCloudBusy(true);
    setAuthLoading(true);
    try {
      const { user, familyId, existing, verificationSent } = await createCloudFamilyAccount({
        email,
        password,
        fullName,
        familyName,
        currency,
        timezone,
        ownerRelation,
        deviceLabel: SYNC_DEVICE_ID || "mobile",
      });
      await activateCloudSession(user, familyId, familyName);
      if (existing) {
        setMessage(t("cloudFamilyRestored"), "success");
      } else if (verificationSent) {
        setMessage(t("cloudFamilyCreatedVerify"), "success");
      } else {
        setMessage(t("cloudFamilyCreated"), "success");
      }
    } catch (err) {
      setMessage(err.message || t("familyCreateFailed"), "error");
    } finally {
      setCloudBusy(false);
      setAuthLoading(false);
    }
  }

  async function refreshFirebaseMeta(uid) {
    if (!uid || !FIREBASE_CONFIGURED) return;
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
      const result = await restoreBackupBlob(blob);
      if (result.familyId && !activeFamilyId) setActiveFamilyId(result.familyId);
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

  async function handleDriveConnect() {
    setCloudBusy(true);
    try {
      await connectGoogleDrive({ prompt: "consent" });
      setDriveConnected(true);
      await refreshDriveFileList();
      setMessage(t("driveConnected"), "success");
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
    setMessage(t("driveDisconnect"), "success");
  }

  async function handleDriveUpload() {
    setCloudBusy(true);
    try {
      const token = await getDriveAccessToken();
      const { blob, fileName } = await buildBackupBlob(activeFamilyId, SYNC_DEVICE_ID);
      await uploadBackupToDrive(token, fileName, blob);
      await refreshDriveFileList();
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
      const blob = await downloadDriveBackup(driveToken, files[0].id);
      const result = await restoreBackupBlob(blob);
      if (result.familyId && !activeFamilyId) setActiveFamilyId(result.familyId);
      setMessage(`${t("driveRestoreSuccess")} (${result.restored})`, "success");
      if (token && (activeFamilyId || result.familyId)) await loadDashboard();
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
        firebaseUser?.uid
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

  async function handleFirebaseGoogleSignIn() {
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

  async function handleFirebaseEmailSignIn() {
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

  async function handleFirebaseEmailRegister() {
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

  async function handleFirebaseSignOut() {
    setCloudBusy(true);
    try {
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

  async function handleFirebaseSyncNow() {
    if (!firebaseUser?.uid) {
      setMessage(t("firebaseSignInPrompt"), "error");
      return;
    }
    setCloudBusy(true);
    try {
      const result = await pushCloudSnapshot({
        uid: firebaseUser.uid,
        familyId: activeFamilyId || null,
        deviceLabel: SYNC_DEVICE_ID,
      });
      await refreshFirebaseMeta(firebaseUser.uid);
      setMessage(
        `${t("firebaseSyncSuccess")} (${result.rowCount} rows)`,
        "success",
      );
    } catch (err) {
      setMessage(err.message || t("firebaseSyncFailed"), "error");
    } finally {
      setCloudBusy(false);
    }
  }

  async function handleFirebaseRestore() {
    if (!firebaseUser?.uid) {
      setMessage(t("firebaseSignInPrompt"), "error");
      return;
    }
    if (!window.confirm(t("firebaseRestoreConfirm"))) return;
    setCloudBusy(true);
    try {
      const result = await pullCloudSnapshot(firebaseUser.uid);
      await refreshFirebaseMeta(firebaseUser.uid);
      if (result.familyId && !activeFamilyId) {
        setActiveFamilyId(result.familyId);
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
    return LOCALE_MESSAGES[appLanguage]?.[key] || LOCALE_MESSAGES.en[key] || key;
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
    return categories.filter((category) => category.category_type === "EXPENSE");
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

    const active = budgets.filter((budget) => budget.status === "ACTIVE");
    const totalBudget = active.reduce(
      (sum, budget) => sum + Number(budget.budget_amount || 0),
      0
    );
    const totalSpent = active.reduce(
      (sum, budget) => sum + Number(budget.spent_amount || 0),
      0
    );
    const overBudgetCount = active.filter((budget) => budget.is_over_budget).length;

    return {
      totalBudget: totalBudget.toFixed(2),
      totalSpent: totalSpent.toFixed(2),
      remaining: (totalBudget - totalSpent).toFixed(2),
      activeCount: active.length,
      overBudgetCount,
      warningCount: active.filter((budget) => Number(budget.used_percent || 0) >= 80 && !budget.is_over_budget).length,
    };
  }


  function budgetAlerts() {
    return [
      ...(budgetStatus?.summary?.over_budget || []),
      ...(budgetStatus?.summary?.warning || []),
    ];
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
    return categories.filter(
      (category) => category.category_type === recurringForm.transaction_type
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

      const matchStatus =
        budgetStatusFilter === "ALL" || budget.status === budgetStatusFilter;

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
        headers: { "Content-Type": "application/json" },
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
        headers: { "Content-Type": "application/json" },
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

    setToken("");
    setRefreshToken("");
    clearCloudSession();
    setCloudOnlyMode(false);
    setFamilies([]);
    setActiveFamilyId("");
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
    setActiveFamilyId(familyId);
  }

  async function apiGet(path) {
    const res = await fetch(`${apiBase}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const text = await res.text();
      let detail = text;
      try {
        const parsed = JSON.parse(text);
        detail = parsed.detail || parsed.message || text;
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

  async function apiPost(path, body) {
    const res = await fetch(`${apiBase}${path}`, {
      method: "POST",
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

  async function apiPatch(path, body) {
    const res = await fetch(`${apiBase}${path}`, {
      method: "PATCH",
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

  async function apiPut(path, body) {
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
    const res = await fetch(`${apiBase}${path}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) throw new Error(data.detail || "Request failed");
    return data;
  }

  async function apiUpload(path, formData) {
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

    setFamiliesLoading(true);

    try {
      const data = await apiGet("/families");
      const familyList = Array.isArray(data) ? data : data.families || [];
      setFamilies(familyList);

      if (!familyList.length) {
        clearFamilyData();
        setActiveFamilyId("");
        setMessage(t("noActiveFamilyForUser"), "warning");
        return;
      }

      setActiveFamilyId((current) => {
        if (current && familyList.some((family) => family.id === current)) {
          return current;
        }

        return familyList[0].id;
      });
    } catch {
      setFamilies([]);
      setActiveFamilyId("");
      clearFamilyData();
      setMessage(t("familyLoadFailed"), "error");
    } finally {
      setFamiliesLoading(false);
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
    const path = user?.avatar_url;
    if (!path) return "";
    if (/^https?:\/\//i.test(path)) return path;
    return `${apiBase}${path.startsWith("/") ? path : `/${path}`}`;
  }

  async function uploadProfilePhoto(file) {
    if (!token || !file) return;
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch(`${apiBase}/auth/me/avatar`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(typeof data.detail === "string" ? data.detail : t("photoUploadFailed"), "error");
        return;
      }
      setCurrentUser(data);
      setMessage(t("photoUpdated"), "success");
    } catch {
      setMessage(t("photoUploadFailed"), "error");
    }
  }

  async function removeProfilePhoto() {
    if (!token) return;
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
    if (!token || !activeFamilyId) return;

    setSettingsLoading(true);

    try {
      const data = await apiGet(`/permissions/family/${activeFamilyId}/me`);
      setMyPermissions(data);
    } catch {
      setMyPermissions(null);
    }

    try {
      const data = await apiGet(`/permissions/family/${activeFamilyId}/members`);
      setMemberPermissions(Array.isArray(data) ? data : data?.members || []);
    } catch {
      setMemberPermissions([]);
    }

    try {
      const status = await apiGet("/auth/email-status");
      setEmailStatus(status);
    } catch {
      setEmailStatus(null);
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

      setFamilies((current) =>
        current.map((family) =>
          family.id === activeFamilyId
            ? { ...family, default_currency: nextCurrency, timezone: nextTimezone }
            : family
        )
      );
      setFamilyCurrencyForm(nextCurrency);
      setFamilyTimezoneForm(nextTimezone);
      setMessage(t("familySettingsUpdated"), "success");
      await refreshAll();
    } catch (err) {
      setMessage(err.message || "Family settings update failed", "error");
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

  async function saveMemberPermission(member) {
    const form = permissionForms[member.member_id] || {};
    const permissionKey = String(form.permission_key || "").trim();

    if (!permissionKey) {
      setMessage(t("permissionKeyRequired"), "error");
      return;
    }

    setPermissionSavingMemberId(member.member_id);

    try {
      await apiPatch(`/permissions/members/${member.member_id}`, {
        permission_key: permissionKey,
        allow: form.allow !== false,
        scope: form.scope || "family",
      });

      setMessage(t("memberPermissionUpdated"), "success");
      await loadSettingsData();
    } catch (err) {
      setMessage(err.message || "Member permission update failed", "error");
    } finally {
      setPermissionSavingMemberId("");
    }
  }

  async function refreshSession() {
    if (!refreshToken) {
      setMessage(t("refreshTokenUnavailable"), "error");
      return;
    }

    setSecurityAction("refresh");

    try {
      const res = await fetch(`${apiBase}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
    const targetEmail = currentUser?.email || email;

    if (!targetEmail) {
      setMessage(t("emailRequiredPasswordReset"), "error");
      return;
    }

    setSecurityAction("password-reset");

    try {
      const res = await fetch(`${apiBase}/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: targetEmail }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.detail || "Password reset request failed");
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
      setMessage(err.message || "Password reset request failed", "error");
    } finally {
      setSecurityAction("");
    }
  }

  async function resendVerification() {
    const targetEmail = currentUser?.email || email;

    if (!targetEmail) {
      setMessage(t("emailRequiredVerification"), "error");
      return;
    }

    setSecurityAction("verification");

    try {
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
      setMessage(err.message || "Verification resend failed", "error");
    } finally {
      setSecurityAction("");
    }
  }

  async function sendTestNotificationEmail() {
    if (!token || !activeFamilyId) return;
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
      const data = cached?.data;
      if (Array.isArray(data)) setWallets(data);
      return;
    }
    if (!token) return;

    try {
      const data = await apiGet(`/accounts/family/${activeFamilyId}`);
      setWallets(data);
      await saveOfflineSnapshot(activeFamilyId, "finance", "wallets", data).catch(() => {});

      if (data.length && !txForm.account_id) {
        setTxForm((prev) => ({
          ...prev,
          account_id: data[0].id,
          to_account_id: data[1]?.id || data[0].id,
        }));
      }

      if (data.length && !savingsForm.wallet_account_id) {
        setSavingsForm((prev) => ({
          ...prev,
          wallet_account_id: data[0].id,
        }));
      }

      if (data.length && !savingsAction.wallet_account_id) {
        setSavingsAction((prev) => ({
          ...prev,
          wallet_account_id: data[0].id,
        }));
      }

      if (data.length && !loanForm.wallet_account_id) {
        setLoanForm((prev) => ({
          ...prev,
          wallet_account_id: data[0].id,
        }));
      }

      if (data.length && !loanPaymentForm.wallet_account_id) {
        setLoanPaymentForm((prev) => ({
          ...prev,
          wallet_account_id: data[0].id,
        }));
      }

      if (data.length && !recurringForm.account_id) {
        setRecurringForm((prev) => ({
          ...prev,
          account_id: data[0].id,
        }));
      }
    } catch (err) {
      const msg = String(err?.message || "");
      if (/failed to fetch|network|offline/i.test(msg) || !isBrowserOnline()) {
        const cached = await loadOfflineSnapshot(activeFamilyId, "finance", "wallets").catch(() => null);
        if (cached?.data) {
          setWallets(cached.data);
          setMessage(t("syncQueuedOffline") || "Showing offline wallet cache", "success");
          return;
        }
      }
      setMessage(t("walletLoadFailed"), "error");
    }
  }

  async function loadCategories() {
    if (!token) return;

    try {
      const data = await apiGet(`/categories/family/${activeFamilyId}`);
      setCategories(data);

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
    } catch {
      setCategories([]);
    }
  }

  async function loadTransactions() {
    if (isCloudLocalMode()) {
      const cached = await loadOfflineSnapshot(activeFamilyId, "finance", "transactions").catch(() => null);
      const data = cached?.data;
      if (Array.isArray(data)) setTransactions(data);
      return;
    }
    if (!token) return;

    try {
      const data = await apiGet(`/transactions/${activeFamilyId}`);
      setTransactions(data);
      await saveOfflineSnapshot(activeFamilyId, "finance", "transactions", data).catch(() => {});
    } catch (err) {
      const msg = String(err?.message || "");
      if (/failed to fetch|network|offline/i.test(msg) || !isBrowserOnline()) {
        const cached = await loadOfflineSnapshot(activeFamilyId, "finance", "transactions").catch(() => null);
        if (cached?.data) {
          setTransactions(cached.data);
          return;
        }
      }
      setMessage(t("transactionLoadFailed"), "error");
    }
  }

  async function loadSavings() {
    if (!token) return;

    try {
      const data = await apiGet(`/savings/${activeFamilyId}`);
      setSavings(data);
      await saveOfflineSnapshot(activeFamilyId, "finance", "savings", data).catch(() => {});

      if (data.length && !savingsAction.savings_goal_id) {
        setSavingsAction((prev) => ({
          ...prev,
          savings_goal_id: data[0].id,
        }));
      }
    } catch (err) {
      const msg = String(err?.message || "");
      if (/failed to fetch|network|offline/i.test(msg) || !isBrowserOnline()) {
        const cached = await loadOfflineSnapshot(activeFamilyId, "finance", "savings").catch(() => null);
        if (cached?.data) {
          setSavings(cached.data);
          return;
        }
      }
      setMessage(t("savingsLoadFailed"), "error");
    }
  }

  async function loadLoans() {
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
    if (!token) return;

    try {
      const [data, statusData] = await Promise.all([
        apiGet(`/budgets/${activeFamilyId}`),
        apiGet(`/budgets/status/${activeFamilyId}`),
      ]);
      setBudgets(data);
      setBudgetStatus(statusData);
      await saveOfflineSnapshot(activeFamilyId, "finance", "budgets", { data, statusData }).catch(() => {});
    } catch (err) {
      const msg = String(err?.message || "");
      if (/failed to fetch|network|offline/i.test(msg) || !isBrowserOnline()) {
        const cached = await loadOfflineSnapshot(activeFamilyId, "finance", "budgets").catch(() => null);
        if (cached?.data) {
          setBudgets(cached.data.data || cached.data);
          setBudgetStatus(cached.data.statusData || null);
          return;
        }
      }
      setBudgetStatus(null);
      setMessage(t("budgetLoadFailed"), "error");
    }
  }

  async function loadRecurring() {
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
          setGoals(cached.data);
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
    if (!token || !activeFamilyId) return;

    setAuditLoading(true);

    try {
      const [summary, activity] = await Promise.all([
        apiGet(`/families/${activeFamilyId}/audit-trail/summary`),
        apiGet(`/families/${activeFamilyId}/audit-trail/activity?limit=25`),
      ]);

      setAuditSummary(summary);
      setAuditRows(activity.rows || []);
    } catch (err) {
      setAuditSummary(null);
      setAuditRows([]);
      // Dashboard refresh may hit audit without permission — don't spam scary JSON toasts
      if (!err?.isPermission) {
        setMessage(err.message || "Audit trail load failed", "error");
      }
    } finally {
      setAuditLoading(false);
    }
  }

  async function loadNotifications() {
    if (!token || !activeFamilyId) return;

    setNotificationsLoading(true);

    try {
      const [items, summary, delivery, devices] = await Promise.all([
        apiGet(`/notifications/${activeFamilyId}`),
        apiGet(`/notifications/summary/${activeFamilyId}`),
        apiGet(`/notifications/delivery-status/${activeFamilyId}`),
        apiGet(`/notifications/devices/${activeFamilyId}`).catch(() => []),
      ]);

      setNotifications(items);
      setNotificationSummary(summary);
      setNotificationDelivery(delivery);
      setPushDevices(Array.isArray(devices) ? devices : []);
    } catch (err) {
      setNotifications([]);
      setNotificationSummary(null);
      setNotificationDelivery(null);
      setPushDevices([]);
      setMessage(err.message || "Notification load failed", "error");
    } finally {
      setNotificationsLoading(false);
    }
  }

  async function registerPushDevice() {
    if (!token || !activeFamilyId) return;
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
      setMessage(err.message || "Device register failed", "error");
      setNotificationsLoading(false);
    }
  }

  async function unregisterPushDevice(deviceId) {
    if (!token || !deviceId) return;
    setNotificationsLoading(true);
    try {
      await apiDelete(`/notifications/devices/${deviceId}`);
      setMessage(t("pushDeviceUnregistered") || "Device unregistered", "success");
      await loadNotifications();
    } catch (err) {
      setMessage(err.message || "Unregister failed", "error");
      setNotificationsLoading(false);
    }
  }

  async function sendTestPushNotification() {
    if (!token || !activeFamilyId) return;
    setNotificationsLoading(true);
    try {
      const result = await apiPost(`/notifications/test-push/${activeFamilyId}`, {});
      if (result?.sent) {
        setMessage(
          (t("testPushSent") || "Test push sent to {n} device(s)").replace(
            "{n}",
            digits(result?.sent_count || 0)
          ),
          "success"
        );
      } else {
        setMessage(result?.reason || t("testPushNotSent") || "Test push not sent", "warning");
      }
    } catch (err) {
      setMessage(err.message || "Test push failed", "error");
    } finally {
      setNotificationsLoading(false);
    }
  }

  async function scanNotifications() {
    if (!token || !activeFamilyId) return;

    setNotificationsLoading(true);

    try {
      const result = await apiPost(`/notifications/scan/${activeFamilyId}`, {});
      setMessage(t("notificationScanCreated").replace("{n}", digits(result.created_notifications || 0)), "success");
      await loadNotifications();
    } catch (err) {
      setMessage(err.message || "Notification scan failed", "error");
    } finally {
      setNotificationsLoading(false);
    }
  }

  async function markNotificationRead(notificationId) {
    try {
      await apiPatch(`/notifications/read/${notificationId}`, {});
      await loadNotifications();
    } catch (err) {
      setMessage(err.message || "Notification update failed", "error");
    }
  }

  async function markAllNotificationsRead() {
    try {
      const result = await apiPatch(`/notifications/read-all/${activeFamilyId}`, {});
      setMessage(t("markedReadCount").replace("{n}", digits(result.marked_read || 0)), "success");
      await loadNotifications();
    } catch (err) {
      setMessage(err.message || "Notification update failed", "error");
    }
  }

  async function deleteNotification(notificationId) {
    try {
      await apiDelete(`/notifications/${notificationId}`);
      await loadNotifications();
    } catch (err) {
      setMessage(err.message || "Notification delete failed", "error");
    }
  }

  async function loadZakat() {
    if (!token || !activeFamilyId) return;

    try {
      const [records, summary] = await Promise.all([
        apiGet(`/zakat/${activeFamilyId}`),
        apiGet(`/zakat/summary/${activeFamilyId}`),
      ]);

      setZakatRecords(records);
      setZakatSummary(summary);
      await saveOfflineSnapshot(activeFamilyId, "zakat", "main", { records, summary });
    } catch (err) {
      try {
        const cached = await loadOfflineSnapshot(activeFamilyId, "zakat", "main");
        if (cached?.data) {
          setZakatRecords(cached.data.records || []);
          setZakatSummary(cached.data.summary || null);
          setMessage(t("syncQueuedOffline"), "success");
          return;
        }
      } catch {
        /* ignore cache miss */
      }
      setZakatRecords([]);
      setZakatSummary(null);
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

    if (!isBrowserOnline()) {
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
      setMessage(t("zakatDueAmount").replace("{amount}", money(result.zakat_due, result.currency)), "success");
      await loadZakat();
    } catch (err) {
      const msg = String(err.message || "");
      if (/failed to fetch|network|offline/i.test(msg)) {
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
      setMetalRates(data);
      const gold = (data.rates || []).find((r) => String(r.metal).toUpperCase() === "GOLD");
      const silver = (data.rates || []).find((r) => String(r.metal).toUpperCase() === "SILVER");
      setZakatForm((prev) => ({
        ...prev,
        gold_rate: gold?.rate_bdt || prev.gold_rate,
        silver_rate: silver?.rate_bdt || prev.silver_rate,
      }));
    } catch (err) {
      setMessage(err.message || "Metal rates load failed", "error");
    }
  }

  async function saveMetalRate(metal) {
    const rate = metal === "GOLD" ? zakatForm.gold_rate : zakatForm.silver_rate;
    if (!rate || Number(rate) <= 0) {
      setMessage("Valid rate required", "error");
      return;
    }
    try {
      await apiPost(`/zakat/metal-rates?family_id=${encodeURIComponent(activeFamilyId)}`, {
        metal,
        rate_bdt: rate,
      });
      setMessage(`${metal} rate saved`, "success");
      await loadMetalRates();
    } catch (err) {
      setMessage(err.message || "Rate save failed", "error");
    }
  }

  async function fillNisabFromRates() {
    try {
      const data = await apiGet(`/zakat/nisab-from-rates?metal=${encodeURIComponent(zakatForm.nisab_metal || "SILVER")}`);
      setZakatForm((prev) => ({ ...prev, nisab_amount: data.nisab_amount }));
      setMessage(`Nisab from ${data.metal}: ${data.nisab_amount}`, "success");
    } catch (err) {
      setMessage(err.message || "Nisab auto-fill failed — set metal rates first", "error");
    }
  }

  async function loadPhase15() {
    if (!token || !activeFamilyId) return;

    try {
      const [items, summary] = await Promise.all([
        loadLifeGroup(apiGet, activeFamilyId, LIFE15),
        apiGet(lifeSummaryPath(activeFamilyId)).catch(() => null),
      ]);
      setPhase15Items(items);
      setPhase15Summary(summary);
      await saveOfflineSnapshot(activeFamilyId, "life", "phase15", { items, summary });
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
      setPhase15Items([]);
      setPhase15Summary(null);
      setMessage(err.message || "Assets & Funds load failed", "error");
    }
  }

  function buildPhase15Payload(form) {
    return buildLifeCreatePayload(form.module_type, activeFamilyId, currencyCode(), {
      ...form,
      name: form.name.trim(),
    });
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

    const payload = buildPhase15Payload(phase15Form);
    const op = editingPhase15Id ? "UPDATE" : "CREATE";

    if (!isBrowserOnline()) {
      await enqueueOutboxChange({
        familyId: activeFamilyId,
        entity_type: lifeOfflineEntityType(phase15Form.module_type),
        entity_id: editingPhase15Id || null,
        operation: op,
        payload: { ...payload, client_request_id: `web-p15-${Date.now()}` },
      });
      resetPhase15Form(phase15ActiveTab);
      setMessage(t("syncQueuedOffline"), "success");
      await refreshLocalOutboxCount();
      return;
    }

    try {
      if (editingPhase15Id) {
        await apiPatch(lifeUpdatePath(phase15Form.module_type, editingPhase15Id), payload);
        setMessage(t("assetFundUpdated"), "success");
      } else {
        await apiPost(lifeCreatePath(phase15Form.module_type), payload);
        setMessage(t("assetFundCreated"), "success");
      }
      resetPhase15Form(phase15ActiveTab);
      await loadPhase15();
    } catch (err) {
      const msg = String(err.message || "");
      if (/failed to fetch|network|offline/i.test(msg)) {
        await enqueueOutboxChange({
          familyId: activeFamilyId,
          entity_type: lifeOfflineEntityType(phase15Form.module_type),
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
    if (!isBrowserOnline()) {
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
      setMessage(err.message || "Asset/Fund close failed", "error");
    }
  }

  async function loadPhase16() {
    if (!token || !activeFamilyId) return;
    try {
      const [items, summary] = await Promise.all([
        loadLifeGroup(apiGet, activeFamilyId, LIFE16),
        apiGet(lifeSummaryPath(activeFamilyId)).catch(() => null),
      ]);
      setPhase16Items(items);
      setPhase16Summary(summary);
      await saveOfflineSnapshot(activeFamilyId, "life", "phase16", { items, summary });
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
      setPhase16Items([]);
      setPhase16Summary(null);
      setMessage(err.message || "Subscriptions, Documents & Property load failed", "error");
    }
  }

  function buildPhase16Payload(form) {
    return buildLifeCreatePayload(form.module_type, activeFamilyId, currencyCode(), {
      ...form,
      name: form.name.trim(),
    });
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

  async function uploadPhase16Document(itemId, file) {
    if (!isBrowserOnline()) {
      await queueDocumentUpload({ familyId: activeFamilyId, itemId, file });
      setMessage(t("documentQueuedOffline"), "success");
      return { queued: true };
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

    const payload = buildPhase16Payload(phase16Form);
    const op = editingPhase16Id ? "UPDATE" : "CREATE";
    const clientRequestId = `web-p16-${Date.now()}`;

    if (!isBrowserOnline()) {
      const localId = editingPhase16Id || clientRequestId;
      await enqueueOutboxChange({
        familyId: activeFamilyId,
        entity_type: lifeOfflineEntityType(phase16Form.module_type),
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
      if (phase16Form.module_type === "DOCUMENT" && documentFile) {
        await queueDocumentUpload({
          familyId: activeFamilyId,
          itemId: localId,
          file: documentFile,
        });
      }
      resetPhase16Form(phase16ActiveTab);
      setMessage(t("syncQueuedOffline"), "success");
      await refreshLocalOutboxCount();
      return;
    }

    try {
      let itemId = editingPhase16Id;
      if (editingPhase16Id) {
        await apiPatch(lifeUpdatePath(phase16Form.module_type, editingPhase16Id), payload);
        setMessage(t("phase16Updated"), "success");
      } else {
        const created = await apiPost(lifeCreatePath(phase16Form.module_type), payload);
        itemId = created?.id || "";
        setMessage(t("phase16Created"), "success");
      }

      if (phase16Form.module_type === "DOCUMENT" && documentFile && itemId) {
        await uploadPhase16Document(itemId, documentFile);
        setMessage(t("documentSavedUploaded"), "success");
      }

      resetPhase16Form(phase16ActiveTab);
      await loadPhase16();
    } catch (err) {
      const msg = String(err.message || "");
      if (/failed to fetch|network|offline/i.test(msg)) {
        await enqueueOutboxChange({
          familyId: activeFamilyId,
          entity_type: lifeOfflineEntityType(phase16Form.module_type),
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
    if (!isBrowserOnline()) {
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
      setMessage(err.message || "Subscription/Document/Property close failed", "error");
    }
  }

  async function loadGrocery(options = {}) {
    const silent = Boolean(options.silent);
    if (!token || !activeFamilyId) return;

    try {
      const [lists, priceHistory, vendorSummary, vendors, activity, collaboration] = await Promise.all([
        apiGet(`/grocery/lists/${activeFamilyId}`),
        apiGet(`/grocery/price-history/${activeFamilyId}`),
        apiGet(`/grocery/vendor-summary/${activeFamilyId}`),
        apiGet(`/grocery/vendors/${activeFamilyId}`),
        apiGet(`/grocery/activity/${activeFamilyId}`),
        apiGet(`/grocery/collaboration/status/${activeFamilyId}`),
      ]);
      setGroceryLists(lists);
      setGroceryPriceHistory(priceHistory);
      setGroceryVendorSummary(vendorSummary);
      setGroceryVendors(vendors);
      setGroceryActivity(activity);
      setGroceryCollaboration(collaboration);
      const nextListId = activeGroceryListId || lists[0]?.id || "";
      setActiveGroceryListId(nextListId);

      if (nextListId) {
        const items = await apiGet(`/grocery/lists/${activeFamilyId}/${nextListId}/items`);
        setGroceryItems(items);
      } else {
        setGroceryItems([]);
      }
    } catch (err) {
      setGroceryLists([]);
      setGroceryItems([]);
      setGroceryPriceHistory([]);
      setGroceryVendorSummary([]);
      setGroceryVendors([]);
      setGroceryActivity([]);
      setGroceryCollaboration(null);
      setActiveGroceryListId("");
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
      setGroceryItems(items);
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

    if (!isBrowserOnline()) {
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
      await loadGrocery();
    } catch (err) {
      const msg = String(err.message || "");
      if (/failed to fetch|network|offline/i.test(msg)) {
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

    if (!isBrowserOnline()) {
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
      if (/failed to fetch|network|offline/i.test(msg)) {
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

    if (!isBrowserOnline()) {
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
    } catch (err) {
      const msg = String(err.message || "");
      if (/failed to fetch|network|offline/i.test(msg)) {
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

    if (!isBrowserOnline()) {
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
        actual_price: item.actual_price || item.estimated_price || "0",
        vendor_name: item.vendor_name || null,
        expected_sync_version: item.sync_version,
      });
      await selectGroceryList(activeGroceryListId);
      const [priceHistory, vendorSummary, vendors] = await Promise.all([
        apiGet(`/grocery/price-history/${activeFamilyId}`),
        apiGet(`/grocery/vendor-summary/${activeFamilyId}`),
        apiGet(`/grocery/vendors/${activeFamilyId}`),
      ]);
      setGroceryPriceHistory(priceHistory);
      setGroceryVendorSummary(vendorSummary);
      setGroceryVendors(vendors);
    } catch (err) {
      const msg = String(err.message || "");
      if (/failed to fetch|network|offline/i.test(msg)) {
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
      setMessage(result.found ? "Barcode match found" : "No barcode match found", result.found ? "success" : "warning");
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
    if (!file || !activeFamilyId || !token) {
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

    if (!token || !activeFamilyId || !nextAccountId) {
      setLedgerReport(null);
      return;
    }

    try {
      const data = await apiGet(
        `/families/${activeFamilyId}/reports/account-ledger?account_id=${encodeURIComponent(nextAccountId)}&limit=25`
      );
      setLedgerReport(data);
    } catch (err) {
      setLedgerReport(null);
      setMessage(err.message || "Account ledger load failed", "error");
    }
  }

  async function loadExtraReport(tab) {
    if (!token || !activeFamilyId) return;
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
    if (!token || !activeFamilyId) return;

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
      setFinancialReport(null);
      setWalletReport(null);
      setLedgerReport(null);
      setMessage(err.message || "Reports load failed", "error");
    } finally {
      setReportsLoading(false);
    }
  }

  async function loadCurrencyData() {
    if (!token || !activeFamilyId) return;

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
      setCurrencies([]);
      setExchangeRates([]);
      setCurrencySummary(null);
      setMessage(err.message || "Currency data load failed", "error");
    } finally {
      setCurrencyLoading(false);
    }
  }

  async function loadFamilyGovernance() {
    if (!token || !activeFamilyId) return;

    setGovernanceLoading(true);

    try {
      const data = await apiGet(`/families/${activeFamilyId}/members`);
      setGovernanceMembers(data.members || []);
      try {
        const pending = await apiGet(`/join-requests/family/${activeFamilyId}`);
        setJoinRequests(Array.isArray(pending) ? pending : pending?.requests || []);
      } catch {
        setJoinRequests([]);
      }
    } catch (err) {
      setGovernanceMembers([]);
      setJoinRequests([]);
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
    }
  }

  async function submitLoggedInJoin(joinForm) {
    if (!joinForm?.invite_code?.trim()) {
      setMessage(t("inviteCodeRequired") || "Invite code required", "error");
      return;
    }
    try {
      const body = {
        invite_code: joinForm.invite_code.trim().toUpperCase(),
        relationship_type: joinForm.relationship_type || "Other",
      };
      if (joinForm.serial_label) body.serial_label = joinForm.serial_label;
      if (joinForm.relationship_serial != null && joinForm.relationship_serial !== "") {
        body.relationship_serial = joinForm.relationship_serial;
      }
      if (joinForm.linked_member_id) body.linked_member_id = joinForm.linked_member_id;
      if (joinForm.relationship_note) body.relationship_note = joinForm.relationship_note;
      await apiPost("/invites/join", body);
      setMessage(t("joinRequestedOk") || "Join request sent", "success");
      await loadFamilyGovernance();
      await refreshAll();
    } catch (err) {
      setMessage(err.message || "Join failed", "error");
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
      });

      setGeneratedInvite(data);
      setMessage(t("inviteGenerated"), "success");
    } catch (err) {
      setGeneratedInvite(null);
      setMessage(err.message || "Invite generation failed", "error");
    } finally {
      setInviteGenerating(false);
    }
  }

  async function inviteFamilyByEmail() {
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
      const hint = data.email_sent ? "Email sent" : `Invite ready (${data.email_reason || "SMTP off"})`;
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
    if (!token || !inviteId) return;
    setInviteRevoking(true);
    try {
      await apiPost(`/invites/${inviteId}/revoke`, {});
      setGeneratedInvite(null);
      setMessage(t("inviteRevoked") || "Invite revoked", "success");
    } catch (err) {
      setMessage(err.message || "Invite revoke failed", "error");
    } finally {
      setInviteRevoking(false);
    }
  }

  async function loadBackups() {
    if (!token || !activeFamilyId) return;

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
      }).catch(() => {});
    } catch (err) {
      const msg = String(err?.message || "");
      if (/failed to fetch|network|offline/i.test(msg) || !isBrowserOnline()) {
        const cached = await loadOfflineSnapshot(activeFamilyId, "system", "backup").catch(() => null);
        if (cached?.data) {
          setBackupIntegrity(cached.data.integrity || null);
          setBackupList(cached.data.list || { count: 0, backups: [] });
          setMessage(t("syncQueuedOffline") || "Showing offline backup cache", "success");
          setBackupLoading(false);
          return;
        }
      }
      setBackupIntegrity(null);
      setBackupList({ count: 0, backups: [] });
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
    if (!token || !activeFamilyId) return;

    setSyncLoading(true);

    try {
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
      setSyncStatus(null);
      setSyncConflicts([]);
      setSyncResolvedConflicts([]);
      setMessage(err.message || "Sync status load failed", "error");
    } finally {
      setSyncLoading(false);
    }
  }

  async function loadSyncLogs() {
    if (!token || !activeFamilyId) return;
    setSyncLogsLoading(true);
    try {
      setSyncLogs(
        await apiGet(`/sync-logs?family_id=${encodeURIComponent(activeFamilyId)}&limit=80`),
      );
    } catch (err) {
      setSyncLogs(null);
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
    if (!token || !activeFamilyId) return;
    if (!isBrowserOnline()) {
      if (!silent) setMessage(t("syncQueuedOffline"), "error");
      return;
    }
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
    if (!token || !activeFamilyId) return;

    setSyncPullLoading(true);

    try {
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
    if (!token || !activeFamilyId) return;

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
    if (!walletForm.name.trim()) {
      setMessage(t("walletNameRequired"), "error");
      return;
    }

    const payload = {
      family_id: activeFamilyId,
      name: walletForm.name.trim(),
      account_type: walletForm.account_type,
      currency: currencyCode(),
      opening_balance: walletForm.opening_balance,
      is_shared_family: walletForm.is_shared_family,
      is_owner_wallet: walletForm.is_owner_wallet,
      client_request_id: `web-wallet-${Date.now()}`,
    };

    try {
      setStatus("Creating wallet...");

      if (isCloudLocalMode()) {
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
          created_at: new Date().toISOString(),
          source: "cloud_local",
        };
        const next = [...wallets, newWallet];
        setWallets(next);
        await saveOfflineSnapshot(activeFamilyId, "finance", "wallets", next);
        await pushCloudSnapshotIfReady();
        setWalletForm({
          name: "",
          account_type: "CASH",
          currency: currencyCode(),
          opening_balance: "0",
          is_shared_family: true,
          is_owner_wallet: false,
        });
        setMessage(t("walletCreated"), "success");
        setStatus("");
        return;
      }

      if (!isBrowserOnline()) {
        await enqueueOutboxChange({
          familyId: activeFamilyId,
          entity_type: "accounts",
          operation: "CREATE",
          payload,
        });
        setWalletForm({
          name: "",
          account_type: "CASH",
          currency: currencyCode(),
          opening_balance: "0",
          is_shared_family: true,
          is_owner_wallet: false,
        });
        setMessage(t("syncQueuedOffline"), "success");
        await refreshLocalOutboxCount();
        setStatus("");
        return;
      }

      await apiPost(`/accounts`, payload);

      setWalletForm({
        name: "",
        account_type: "CASH",
        currency: currencyCode(),
        opening_balance: "0",
        is_shared_family: true,
        is_owner_wallet: false,
      });

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
        setMessage(t("syncQueuedOffline"), "success");
        await refreshLocalOutboxCount();
        return;
      }
      setMessage(err.message || "Wallet create failed", "error");
    }
  }

  async function createTransaction(attachFile = null) {
    if (!txForm.account_id) {
      setMessage(t("fromWalletRequired"), "error");
      return;
    }

    if (!txForm.amount || Number(txForm.amount) <= 0) {
      setMessage(t("validAmountRequired"), "error");
      return;
    }

    if (txForm.type === "transfer") {
      if (!txForm.to_account_id) {
        setMessage(t("toWalletRequired"), "error");
        return;
      }

      if (txForm.account_id === txForm.to_account_id) {
        setMessage(t("cannotTransferSameWallet"), "error");
        return;
      }
    }

    if (txForm.type === "expense" && txForm.split_enabled) {
      if (!txForm.split_member_a || !txForm.split_member_b) {
        setMessage("Select both members for split expense", "error");
        return;
      }
      if (txForm.split_member_a === txForm.split_member_b) {
        setMessage("Split members must be different", "error");
        return;
      }
    }

    try {
      setStatus("Posting transaction...");
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
        setStatus("");
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

      if (attachFile && createdId && apiUpload) {
        const fd = new FormData();
        fd.append("family_id", activeFamilyId);
        fd.append("file", attachFile);
        await apiUpload(`/transactions/${createdId}/attachment`, fd);
      }

      setTxForm((prev) => ({
        ...prev,
        amount: "",
        description: "",
        split_enabled: false,
      }));

      setMessage(t("transactionPosted"), "success");
      refreshAll();
    } catch (err) {
      setMessage(err.message || "Transaction failed", "error");
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
      await apiUpload(`/transactions/${transactionId}/attachment`, fd);
      setMessage("Attachment uploaded", "success");
      await loadTransactions?.();
      refreshAll();
    } catch (err) {
      setMessage(err.message || "Attachment failed", "error");
    } finally {
      setAttachBusyId("");
    }
  }

  async function parseExpenseOcr(rawText) {
    return apiPost(`/expenses/ocr/parse?family_id=${encodeURIComponent(activeFamilyId)}`, {
      raw_text: rawText || "",
    });
  }

  async function parseExpenseOcrImage(file) {
    if (!file) return null;
    const fd = new FormData();
    fd.append("family_id", activeFamilyId);
    fd.append("file", file);
    return apiUpload(`/expenses/ocr/parse-image`, fd);
  }

  async function loadSavingsAnnualPlan() {
    try {
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
      setMessage(err.message || "Void failed", "error");
    } finally {
      setVoidBusyId("");
    }
  }

  async function createSavingsGoal() {
    if (!savingsForm.wallet_account_id) {
      setMessage(t("walletRequired"), "error");
      return;
    }

    if (!savingsForm.name.trim()) {
      setMessage(t("savingsNameRequired"), "error");
      return;
    }

    if (!savingsForm.target_amount || Number(savingsForm.target_amount) <= 0) {
      setMessage(t("validTargetAmountRequired"), "error");
      return;
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
        return;
      }

      await apiPost(`/savings`, payload);

      setSavingsForm((prev) => ({
        ...prev,
        name: "",
        target_amount: "",
        note: "",
      }));

      setMessage(t("savingsGoalCreated"), "success");
      refreshAll();
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
        return;
      }
      setMessage(err.message || "Savings create failed", "error");
    }
  }

  async function postSavingsAction() {
    if (!savingsAction.savings_goal_id) {
      setMessage(t("savingsGoalRequired"), "error");
      return;
    }

    if (!savingsAction.wallet_account_id) {
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

    const applyOptimistic = () => {
      setWallets((prev) =>
        (prev || []).map((acc) => {
          if (acc.id !== savingsAction.wallet_account_id) return acc;
          const bal = Number(acc.current_balance || 0);
          const next = actionOp === "DEPOSIT" ? bal - amountNum : bal + amountNum;
          return { ...acc, current_balance: String(next) };
        })
      );
      setSavings((prev) =>
        (prev || []).map((goal) => {
          if (goal.id !== savingsAction.savings_goal_id) return goal;
          const cur = Number(goal.current_amount || 0);
          const next = actionOp === "DEPOSIT" ? cur + amountNum : cur - amountNum;
          return { ...goal, current_amount: String(next) };
        })
      );
      setSavingsAction((prev) => ({ ...prev, amount: "", description: "" }));
    };

    try {
      if (!isBrowserOnline()) {
        await enqueueOutboxChange({
          familyId: activeFamilyId,
          entity_type: "savings_goals",
          operation: actionOp,
          entity_id: savingsAction.savings_goal_id,
          payload,
        });
        applyOptimistic();
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
        });
      }

      setSavingsAction((prev) => ({
        ...prev,
        amount: "",
        description: "",
      }));

      setMessage(
        savingsAction.action === "deposit"
          ? "Savings deposit posted"
          : "Savings withdraw posted",
        "success"
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
        applyOptimistic();
        setMessage(t("syncQueuedOffline"), "success");
        await refreshLocalOutboxCount();
        return;
      }
      setMessage(err.message || "Savings action failed", "error");
    }
  }

  async function createLoan() {
    if (!loanForm.wallet_account_id) {
      setMessage(t("walletRequired"), "error");
      return;
    }

    if (!loanForm.person_name.trim()) {
      setMessage(t("personNameRequired"), "error");
      return;
    }

    if (!loanForm.principal_amount || Number(loanForm.principal_amount) <= 0) {
      setMessage(t("validLoanAmountRequired"), "error");
      return;
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
        return;
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
        return;
      }
      setMessage(err.message || "Loan create failed", "error");
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

    const applyOptimistic = () => {
      const loanType = String(loanRow?.loan_type || "").toUpperCase();
      setWallets((prev) =>
        (prev || []).map((acc) => {
          if (acc.id !== loanPaymentForm.wallet_account_id) return acc;
          const bal = Number(acc.current_balance || 0);
          const next = loanType === "GIVEN" ? bal + amountNum : bal - amountNum;
          return { ...acc, current_balance: String(next) };
        })
      );
      setLoans((prev) =>
        (prev || []).map((loan) => {
          if (loan.id !== loanPaymentForm.loan_id) return loan;
          const remaining = Math.max(0, Number(loan.remaining_amount || 0) - amountNum);
          const paid = Number(loan.paid_amount || 0) + amountNum;
          return {
            ...loan,
            remaining_amount: String(remaining),
            paid_amount: String(paid),
            status: remaining <= 0 ? "CLOSED" : loan.status,
          };
        })
      );
      setLoanPaymentForm((prev) => ({ ...prev, amount: "", description: "" }));
    };

    try {
      if (!isBrowserOnline()) {
        await enqueueOutboxChange({
          familyId: activeFamilyId,
          entity_type: "loans",
          operation: "PAYMENT",
          entity_id: loanPaymentForm.loan_id,
          payload,
        });
        applyOptimistic();
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
        applyOptimistic();
        setMessage(t("syncQueuedOffline"), "success");
        await refreshLocalOutboxCount();
        return;
      }
      setMessage(err.message || "Loan payment failed", "error");
    }
  }

  async function createBudget() {
    if (!budgetForm.category_id) {
      setMessage(t("expenseCategoryRequired"), "error");
      return;
    }

    if (!budgetForm.name.trim()) {
      setMessage(t("budgetNameRequired"), "error");
      return;
    }

    if (!budgetForm.budget_amount || Number(budgetForm.budget_amount) <= 0) {
      setMessage(t("validBudgetAmountRequired"), "error");
      return;
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
        return;
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
        return;
      }
      setMessage(err.message || "Budget create failed", "error");
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
    const payload = {
      family_id: activeFamilyId,
      goal_id: goalContributionForm.goal_id,
      wallet_account_id: goalContributionForm.wallet_account_id,
      amount: goalContributionForm.amount,
      currency: currencyCode(),
      description: goalContributionForm.description,
      client_request_id: `web-goal-contribute-${Date.now()}`,
    };

    const applyOptimistic = () => {
      setWallets((prev) =>
        (prev || []).map((acc) => {
          if (acc.id !== goalContributionForm.wallet_account_id) return acc;
          return { ...acc, current_balance: String(Number(acc.current_balance || 0) - amountNum) };
        })
      );
      setGoals((prev) =>
        (prev || []).map((goal) => {
          if (goal.id !== goalContributionForm.goal_id) return goal;
          const next = Number(goal.current_amount || 0) + amountNum;
          const target = Number(goal.target_amount || 0);
          return {
            ...goal,
            current_amount: String(next),
            status: target > 0 && next >= target ? "COMPLETED" : goal.status,
          };
        })
      );
      setGoalContributionForm((prev) => ({ ...prev, amount: "", description: "" }));
    };

    try {
      if (!isBrowserOnline()) {
        await enqueueOutboxChange({
          familyId: activeFamilyId,
          entity_type: "financial_goals",
          operation: "CONTRIBUTE",
          entity_id: goalContributionForm.goal_id,
          payload,
        });
        applyOptimistic();
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
        applyOptimistic();
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
    const payload = {
      family_id: activeFamilyId,
      goal_id: goalContributionForm.goal_id,
      wallet_account_id: goalContributionForm.wallet_account_id,
      amount: goalContributionForm.amount,
      currency: currencyCode(),
      description: goalContributionForm.description,
      client_request_id: `web-goal-withdraw-${Date.now()}`,
    };

    const applyOptimistic = () => {
      setWallets((prev) =>
        (prev || []).map((acc) => {
          if (acc.id !== goalContributionForm.wallet_account_id) return acc;
          return { ...acc, current_balance: String(Number(acc.current_balance || 0) + amountNum) };
        })
      );
      setGoals((prev) =>
        (prev || []).map((goal) => {
          if (goal.id !== goalContributionForm.goal_id) return goal;
          const next = Math.max(0, Number(goal.current_amount || 0) - amountNum);
          const target = Number(goal.target_amount || 0);
          return {
            ...goal,
            current_amount: String(next),
            status: goal.status === "COMPLETED" && next < target ? "ACTIVE" : goal.status,
          };
        })
      );
      setGoalContributionForm((prev) => ({ ...prev, amount: "", description: "" }));
    };

    try {
      if (!isBrowserOnline()) {
        await enqueueOutboxChange({
          familyId: activeFamilyId,
          entity_type: "financial_goals",
          operation: "WITHDRAW",
          entity_id: goalContributionForm.goal_id,
          payload,
        });
        applyOptimistic();
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
        applyOptimistic();
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

    try {
      await apiPatch(`/goals/${goalEditModal.goal.id}`, {
        family_id: activeFamilyId,
        goal_name: goalEditModal.goal_name.trim(),
        goal_type: goalEditModal.goal_type,
        target_amount: goalEditModal.target_amount,
        target_date: goalEditModal.target_date || null,
        note: goalEditModal.note,
      });

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
    const ok = window.confirm(`Close goal "${item.goal_name}"?`);
    if (!ok) return;

    try {
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
    const ok = window.confirm(`Post recurring "${item.title}" now?`);
    if (!ok) return;

    try {
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

    try {
      await apiPatch(`/recurring/${recurringEditModal.item.id}`, {
        family_id: activeFamilyId,
        title: recurringEditModal.title.trim(),
        amount: recurringEditModal.amount,
        frequency: recurringEditModal.frequency,
        end_date: recurringEditModal.end_date || null,
        description: recurringEditModal.description,
      });

      closeRecurringEdit();
      setMessage(t("recurringUpdated"), "success");
      refreshAll();
    } catch (err) {
      setMessage(err.message || "Recurring update failed", "error");
    }
  }

  async function pauseRecurring(item) {
    const ok = window.confirm(`Pause recurring "${item.title}"?`);
    if (!ok) return;

    const payload = { family_id: activeFamilyId, entity_id: item.id, id: item.id };
    try {
      if (!isBrowserOnline()) {
        await enqueueOutboxChange({
          familyId: activeFamilyId,
          entity_type: "recurring_transactions",
          operation: "PAUSE",
          entity_id: item.id,
          payload,
        });
        setRecurringItems((prev) =>
          (prev || []).map((row) => (row.id === item.id ? { ...row, status: "PAUSED" } : row))
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
    const ok = window.confirm(`Resume recurring "${item.title}"?`);
    if (!ok) return;

    const payload = { family_id: activeFamilyId, entity_id: item.id, id: item.id };
    try {
      if (!isBrowserOnline()) {
        await enqueueOutboxChange({
          familyId: activeFamilyId,
          entity_type: "recurring_transactions",
          operation: "RESUME",
          entity_id: item.id,
          payload,
        });
        setRecurringItems((prev) =>
          (prev || []).map((row) => (row.id === item.id ? { ...row, status: "ACTIVE" } : row))
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
    const ok = window.confirm(`Close recurring "${item.title}"?`);
    if (!ok) return;

    const payload = { family_id: activeFamilyId, entity_id: item.id, id: item.id };
    try {
      if (!isBrowserOnline()) {
        await enqueueOutboxChange({
          familyId: activeFamilyId,
          entity_type: "recurring_transactions",
          operation: "CLOSE",
          entity_id: item.id,
          payload,
        });
        setRecurringItems((prev) =>
          (prev || []).map((row) => (row.id === item.id ? { ...row, status: "CLOSED" } : row))
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
    if (item.status !== "ACTIVE") {
      setMessage(t("onlyActiveBudgetEdit"), "error");
      return;
    }

    setBudgetEditModal({
      open: true,
      budget: item,
      name: item.name || "",
      budget_amount: item.budget_amount || "",
      note: item.note || "",
    });
  }

  function closeBudgetEdit() {
    setBudgetEditModal({
      open: false,
      budget: null,
      name: "",
      budget_amount: "",
      note: "",
    });
  }

  async function saveBudgetEdit() {
    if (!budgetEditModal.budget) return;

    if (!budgetEditModal.name.trim()) {
      setMessage(t("budgetNameRequired"), "error");
      return;
    }

    if (!budgetEditModal.budget_amount || Number(budgetEditModal.budget_amount) <= 0) {
      setMessage(t("validBudgetAmountRequired"), "error");
      return;
    }

    const payload = {
      family_id: activeFamilyId,
      name: budgetEditModal.name.trim(),
      budget_amount: budgetEditModal.budget_amount,
      note: budgetEditModal.note,
    };

    try {
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
    }
  }

  async function closeBudget(item) {
    const ok = window.confirm(`Close budget "${item.name}"?`);
    if (!ok) return;

    try {
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
      setMessage(err.message || "Budget close failed", "error");
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
    const ok = window.confirm(
      `Close loan with "${item.person_name}"?\n\nIf remaining balance exists, backend will block closing.`
    );

    if (!ok) return;

    try {
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
    const newName = window.prompt("Savings name", item.name);
    if (newName === null) return;

    const cleanedName = newName.trim();
    if (!cleanedName) {
      setMessage(t("savingsNameRequired"), "error");
      return;
    }

    const newTarget = window.prompt("Target amount", item.target_amount);
    if (newTarget === null) return;

    if (!newTarget || Number(newTarget) <= 0) {
      setMessage(t("validTargetAmountRequired"), "error");
      return;
    }

    const newNote = window.prompt("Note", item.note || "");
    if (newNote === null) return;

    const payload = {
      family_id: activeFamilyId,
      name: cleanedName,
      target_amount: newTarget,
      note: newNote,
    };

    try {
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
    }
  }

  async function closeSavingsGoal(item) {
    const ok = window.confirm(
      `Close savings goal "${item.name}"?\n\nIf balance exists, backend will block closing.`
    );

    if (!ok) return;

    try {
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
      const data = await apiGet(`/savings/${item.id}/history/${activeFamilyId}`);

      setHistoryModal({
        open: true,
        loading: false,
        goal: data.goal || item,
        history: data.history || [],
      });

      setMessage(t("savingsHistoryLoaded"), "success");
    } catch (err) {
      setHistoryModal({
        open: true,
        loading: false,
        goal: item,
        history: [],
      });

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

  useEffect(() => {
    if (!FIREBASE_CONFIGURED) return undefined;
    return subscribeFirebaseAuth(async (user) => {
      setFirebaseUser(user);
      if (user) {
        try {
          await ensureUserProfile(user.uid, user);
          await refreshFirebaseMeta(user.uid);
        } catch {
          /* ignore profile/meta errors on subscribe */
        }
        if (loadCloudOnlyMode()) {
          const familyId = loadCloudFamilyId();
          if (familyId) {
            setCloudOnlyMode(true);
            setActiveFamilyId(familyId);
            setFamilies([{ id: familyId, name: t("cloudOnlyFamilyLabel") }]);
            setCurrentUser({
              full_name: user.displayName || user.email || "Cloud User",
              email: user.email || "",
            });
            await hydrateFromCloudCache(familyId);
          }
        }
      } else {
        setFirebaseMeta(null);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (driveConnected) {
      refreshDriveFileList();
    }
  }, [driveConnected]);

  useEffect(() => {
    if (!cloudOnlyMode || token || !activeFamilyId) return undefined;

    const timeoutId = window.setTimeout(() => {
      hydrateFromCloudCache(activeFamilyId);
      loadDashboard();
    }, 0);

    return () => window.clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudOnlyMode, token, activeFamilyId]);

  useEffect(() => {
    if (!token) return;

    const timeoutId = window.setTimeout(() => {
      loadProfile();
      loadFamilies();
    }, 0);

    return () => window.clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!token || !activeFamilyId) return;

    const timeoutId = window.setTimeout(() => {
      refreshAll();
    }, 0);

    return () => window.clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, activeFamilyId]);

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

  useEffect(() => {
    const settingsTabKey = parseSettingsTab(activeMenu);
    if (settingsTabKey && ["profile", "family", "permissions", "security", "cloud"].includes(settingsTabKey)) {
      setSettingsTab(settingsTabKey);
    }
    const tab15 = parsePhaseTab(activeMenu, "phase15");
    if (tab15) {
      setPhase15ActiveTab(tab15);
      setPhase15Form((prev) => ({ ...prev, module_type: tab15 }));
    }
    const tab16 = parsePhaseTab(activeMenu, "phase16");
    if (tab16) {
      setPhase16ActiveTab(tab16);
      setPhase16Form((prev) => ({ ...prev, module_type: tab16 }));
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
    if (!token || !activeFamilyId || activeMenu !== "sync") return;
    const timeoutId = window.setTimeout(() => {
      loadSyncStatus();
    }, 0);
    return () => window.clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, activeFamilyId, activeMenu]);

  useEffect(() => {
    if (!token || !activeFamilyId || !autoSyncEnabled) return undefined;

    const runAutoSync = () => {
      if (!isBrowserOnline() || syncPushLoading) return;
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
  }, [token, activeFamilyId, autoSyncEnabled, localOutboxPending, syncPushLoading, browserOnline]);

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
      if (token && activeFamilyId) {
        flushLocalOutbox({ familyId: activeFamilyId, deviceId: SYNC_DEVICE_ID, apiPost })
          .then(() =>
            flushPendingUploads({
              familyId: activeFamilyId,
              uploadFn: async (itemId, file) => {
                // Real server ids only — skip temp local ids
                if (String(itemId).startsWith("web-p16-")) return;
                const formData = new FormData();
                formData.append("family_id", activeFamilyId);
                formData.append("file", file);
                const res = await fetch(`${apiBase}/phase16/${itemId}/upload`, {
                  method: "POST",
                  headers: { Authorization: `Bearer ${token}` },
                  body: formData,
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.detail || "upload failed");
              },
            })
          )
          .then(() => {
            refreshLocalOutboxCount();
            loadSyncStatus();
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
    ["dashboard", t("dashboard"), "⌂"],
    ["wallets", t("wallets"), "◇"],
    ["transactions", t("transactions"), "↕"],
    ["grocery", t("groceryTitle"), "▤"],
    ["reports", t("reports"), "▥"],
    ["family", t("family"), "◎"],
    ["sync", t("offlineSync"), "⟳"],
    ["settings", t("settings"), "⚙"],
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
        ["cutover", "✦", "Cutover"],
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
        ["phase16:SUBSCRIPTION", "↻", t("navSubscriptions")],
      ],
    },
    {
      label: t("navAssetsPlanning"),
      items: [
        ["phase15:INVESTMENT", "◈", t("navInvestments")],
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

  if (showSplash && !isAppAuthed) {
    return (
      <SplashScreen
        brandTitle={digits("S4 FAMILY FINANCE 143")}
        hint={t("splashHint")}
        onDone={finishSplash}
      />
    );
  }

  if (!isAppAuthed) {
    return (
      <main className="s4-auth-host" lang={currentLanguage.code} dir={currentLanguage.dir}>
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
          onApiBaseChange={(next) => setApiBase(persistApiBase(next))}
          onAuthenticated={(access, refresh) => {
            setToken(access);
            setRefreshToken(refresh || "");
          }}
          firebaseConfigured={FIREBASE_CONFIGURED}
          firebaseFirstMode={FIREBASE_FIRST_MODE}
          onFirebaseGoogleSignIn={handleFirebaseGoogleSignIn}
          onCloudOnlySignIn={handleCloudOnlySignIn}
          onCloudEmailSignIn={handleCloudEmailSignIn}
          onCreateCloudFamily={handleCreateCloudFamily}
        />
      </main>
    );
  }

  return (
    <div className="app-layout" lang={currentLanguage.code} dir={currentLanguage.dir}>
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

            <input style={{ width: "100%", minHeight: 56, marginBottom: 14, borderRadius: 12, border: "1px solid #334155", background: "#020b1f", color: "white", padding: 14, fontSize: 16 }} placeholder={t("budgetAmount")} value={budgetEditModal.budget_amount} onChange={(e) => setBudgetEditModal({ ...budgetEditModal, budget_amount: e.target.value })} />

            <input style={{ width: "100%", minHeight: 56, marginBottom: 14, borderRadius: 12, border: "1px solid #334155", background: "#020b1f", color: "white", padding: 14, fontSize: 16 }} placeholder={t("note")} value={budgetEditModal.note} onChange={(e) => setBudgetEditModal({ ...budgetEditModal, note: e.target.value })} />

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <button onClick={saveBudgetEdit} style={{ background: "#2563eb", color: "white", borderRadius: 12, padding: "12px 18px", fontWeight: 800 }}>{t("save")}</button>
              <button onClick={closeBudgetEdit} style={{ background: "#dc2626", color: "white", borderRadius: 12, padding: "12px 18px", fontWeight: 800 }}>{t("cancel")}</button>
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
        avatarUrl={avatarUrl(currentUser)}
        families={families}
        activeFamilyId={activeFamilyId}
        changeActiveFamily={changeActiveFamily}
        familiesLoading={familiesLoading}
        onLogout={logout}
      />

      <main className="main-content">
        <TopHeader
          appLanguage={appLanguage}
          setActiveMenu={setActiveMenu}
          changeAppLanguage={changeAppLanguage}
          t={t}
          lockedLanguages={LOCKED_LANGUAGES}
          unreadCount={notificationSummary?.unread_count || 0}
          onLogout={logout}
          avatarUrl={avatarUrl(currentUser)}
          currentUser={currentUser}
          email={email}
        />

        {!activeFamilyId && (
          <section>
            <div className="card">
              <h2>{t("noActiveFamilySelected")}</h2>
              <p>{t("createJoinFamilyFirst")}</p>
            </div>
          </section>
        )}

        {activeFamilyId && activeMenu === "dashboard" && (
          <ExecutiveDashboard
            dashboard={dashboard}
            wallets={wallets}
            transactions={transactions}
            budgets={budgets}
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
            onCreate={createWallet}
            onRefresh={loadWallets}
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
          />
        )}

        {activeFamilyId && activeMenu === "tags" && (
          <TagsPanel
            t={t}
            apiGet={apiGet}
            apiPost={apiPost}
            apiDelete={apiDelete}
            activeFamilyId={activeFamilyId}
            transactions={transactions}
          />
        )}

        {activeFamilyId && activeMenu === "cutover" && (
          <ArchitectureCutoverPanel
            t={t}
            apiGet={apiGet}
            apiPost={apiPost}
            apiUpload={apiUpload}
            activeFamilyId={activeFamilyId}
            wallets={wallets}
            categories={categories}
            members={governanceMembers}
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
            onClearFilters={() => {
              setBudgetSearch("");
              setBudgetStatusFilter("ALL");
            }}
          />
        )}

        {activeFamilyId && activeMenu === "recurring" && (
          <section className="panel">
            <h2>{t("recurring")}</h2>

            <div className="grid">
              <div className="card">
                <span>{t("recurring")}</span>
                <strong>{digits(recurringSummary().activeCount)}</strong>
              </div>

              <div className="card">
                <span>{t("recurringDue")}</span>
                <strong>{digits(recurringSummary().dueTodayCount)}</strong>
              </div>

              <div className="card">
                <span>{t("monthlyRecurring")}</span>
                <strong>{money(recurringSummary().monthlyAmount)}</strong>
              </div>
            </div>

            <h3>{t("recurring")}</h3>
            <div className="savings-form">
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
                {wallets.map((wallet) => (
                  <option key={wallet.id} value={wallet.id}>{wallet.name}</option>
                ))}
              </select>

              <select
                value={recurringForm.category_id}
                onChange={(e) => setRecurringForm({ ...recurringForm, category_id: e.target.value })}
              >
                <option value="">{t("noCategory")}</option>
                {recurringCategories().map((category) => (
                  <option key={category.id} value={category.id}>{category.name_en}</option>
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
              />

              <input
                type="date"
                value={recurringForm.end_date}
                onChange={(e) => setRecurringForm({ ...recurringForm, end_date: e.target.value })}
              />

              <input
                placeholder={t("description")}
                value={recurringForm.description}
                onChange={(e) => setRecurringForm({ ...recurringForm, description: e.target.value })}
              />

              <button onClick={createRecurring}>{t("recurring")}</button>
            </div>

            <h3>{t("recurringSearchFilter")}</h3>
            <div className="savings-form">
              <input
                placeholder={t("searchTitleDescription")}
                value={recurringSearch}
                onChange={(e) => setRecurringSearch(e.target.value)}
              />

              <select value={recurringStatusFilter} onChange={(e) => setRecurringStatusFilter(e.target.value)}>
                <option value="ALL">{t("allStatus")}</option>
                <option value="ACTIVE">Active</option>
                <option value="PAUSED">Paused</option>
                <option value="COMPLETED">Completed</option>
                <option value="CLOSED">Closed</option>
              </select>

              <select value={recurringTypeFilter} onChange={(e) => setRecurringTypeFilter(e.target.value)}>
                <option value="ALL">{t("allType")}</option>
                <option value="INCOME">{t("income")}</option>
                <option value="EXPENSE">{t("expense")}</option>
              </select>

              <button onClick={() => { setRecurringSearch(""); setRecurringStatusFilter("ALL"); setRecurringTypeFilter("ALL"); }}>
                {t("clearFilter")}
              </button>

              <button onClick={loadRecurring}>{t("refreshRecurring")}</button>
            </div>

            <div>
              {filteredRecurringItems().map((item) => (
                <div className="savings-card" key={item.id}>
                  <div className="savings-header">
                    <div>
                      <div className="savings-title">{item.title}</div>
                      <div className="savings-note">
                        {item.transaction_type} · {item.frequency} · {t("nextDue")}: {digits(item.next_due_date)}
                      </div>
                    </div>

                    <div className={`savings-status ${isRecurringDue(item) ? "savings-closed" : item.status === "ACTIVE" ? "savings-active" : "savings-closed"}`}>
                      {isRecurringDue(item) ? "DUE" : item.status}
                    </div>
                  </div>

                  <div className="savings-meta">
                    <span>{t("amount")}: {money(item.amount, item.currency)}</span>
                    <span>{t("start")}: {digits(item.start_date)}</span>
                    <span>{t("end")}: {item.end_date ? digits(item.end_date) : t("noEnd")}</span>
                    <strong>{t("lastPosted")}: {item.last_posted_at ? digits(item.last_posted_at) : t("never")}</strong>
                  </div>

                  <div className="savings-actions">
                    {["ACTIVE", "PAUSED"].includes(item.status) && (
                      <button className="edit-btn" onClick={() => openRecurringEdit(item)}>{t("edit")}</button>
                    )}

                    <button className="history-btn" onClick={() => openRecurringHistory(item)}>{t("history")}</button>

                    {item.status === "ACTIVE" && (
                      <button className="edit-btn" onClick={() => postRecurring(item)}>{t("postNow")}</button>
                    )}

                    {item.status === "ACTIVE" && (
                      <button className="history-btn" onClick={() => pauseRecurring(item)}>{t("pause")}</button>
                    )}

                    {item.status === "PAUSED" && (
                      <button className="history-btn" onClick={() => resumeRecurring(item)}>{t("resume")}</button>
                    )}

                    {!["CLOSED", "COMPLETED"].includes(item.status) && (
                      <button className="close-btn" onClick={() => closeRecurring(item)}>{t("close")}</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}


        {activeFamilyId && activeMenu === "goals" && (
          <section className="panel">
            <h2>{t("goals")}</h2>

            <div className="grid">
              <div className="card">
                <span>{t("goals")}</span>
                <strong>{digits(goalSummary?.total_goals || 0)}</strong>
              </div>

              <div className="card">
                <span>{t("goals")}</span>
                <strong>{digits(goalSummary?.active_count || 0)}</strong>
              </div>

              <div className="card">
                <span>{t("amount")}</span>
                <strong>{money(goalSummary?.active_target_amount)}</strong>
              </div>

              <div className="card">
                <span>{t("savings")}</span>
                <strong>{money(goalSummary?.active_current_amount)}</strong>
              </div>
            </div>

            <h3>{t("createGoal")}</h3>
            <div className="savings-form">
              <input placeholder={t("goalName")} value={goalForm.goal_name} onChange={(e) => setGoalForm({ ...goalForm, goal_name: e.target.value })} />
              <input placeholder={t("goalType")} value={goalForm.goal_type} onChange={(e) => setGoalForm({ ...goalForm, goal_type: e.target.value })} />
              <input placeholder={t("targetAmount")} value={goalForm.target_amount} onChange={(e) => setGoalForm({ ...goalForm, target_amount: e.target.value })} />
              <input type="date" value={goalForm.target_date} onChange={(e) => setGoalForm({ ...goalForm, target_date: e.target.value })} />
              <input placeholder={t("note")} value={goalForm.note} onChange={(e) => setGoalForm({ ...goalForm, note: e.target.value })} />
              <button onClick={createGoal}>{t("createGoal")}</button>
            </div>

            <h3>{t("contributeWithdraw")}</h3>
            <div className="savings-form">
              <select value={goalContributionForm.goal_id} onChange={(e) => setGoalContributionForm({ ...goalContributionForm, goal_id: e.target.value })}>
                <option value="">{t("selectGoal")}</option>
                {goals.filter((goal) => goal.status !== "CLOSED").map((goal) => (
                  <option key={goal.id} value={goal.id}>
                    {goal.goal_name} - {amount(goal.current_amount)}/{amount(goal.target_amount)}
                  </option>
                ))}
              </select>

              <select value={goalContributionForm.wallet_account_id} onChange={(e) => setGoalContributionForm({ ...goalContributionForm, wallet_account_id: e.target.value })}>
                <option value="">{t("selectWallet")}</option>
                {wallets.map((wallet) => (
                  <option key={wallet.id} value={wallet.id}>{wallet.name}</option>
                ))}
              </select>

              <input placeholder={t("amount")} value={goalContributionForm.amount} onChange={(e) => setGoalContributionForm({ ...goalContributionForm, amount: e.target.value })} />
              <input placeholder={t("description")} value={goalContributionForm.description} onChange={(e) => setGoalContributionForm({ ...goalContributionForm, description: e.target.value })} />

              <button onClick={contributeGoal}>{t("contribute")}</button>
              <button onClick={withdrawGoal}>{t("withdraw")}</button>
              <button onClick={loadGoals}>{t("refreshGoals")}</button>
            </div>

            <div>
              {goals.map((goal) => {
                const progressValue = Math.min(Number(goal.progress_percent || 0), 100);

                return (
                  <div className="savings-card" key={goal.id}>
                    <div className="savings-header">
                      <div>
                        <div className="savings-title">{goal.goal_name}</div>
                        <div className="savings-note">
                          {goal.goal_type} · {t("targetDate")}: {goal.target_date ? digits(goal.target_date) : t("noDate")} · {goal.note || t("noNote")}
                        </div>
                      </div>

                      <div className={`savings-status ${goal.status === "ACTIVE" ? "savings-active" : "savings-closed"}`}>
                        {goal.status}
                      </div>
                    </div>

                    <div className="progress-wrapper">
                      <div className="progress-fill" style={{ width: `${progressValue}%` }} />
                    </div>

                    <div className="savings-meta">
                      <span>{t("saved")}: {money(goal.current_amount, goal.currency)}</span>
                      <span>{t("targetAmount")}: {money(goal.target_amount, goal.currency)}</span>
                      <span>{t("remaining")}: {money(goal.remaining_amount, goal.currency)}</span>
                      <strong>{digits(goal.progress_percent)}%</strong>
                      <span>{t("monthlyNeed")}: {money(goal.recommended_monthly_saving, goal.currency)}</span>
                    </div>

                    <div className="savings-actions">
                      {goal.status === "ACTIVE" && (
                        <button className="edit-btn" onClick={() => openGoalEdit(goal)}>{t("edit")}</button>
                      )}

                      <button className="history-btn" onClick={() => openGoalHistory(goal)}>{t("history")}</button>

                      {goal.status !== "CLOSED" && (
                        <button className="close-btn" onClick={() => closeGoal(goal)}>{t("close")}</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {activeFamilyId && activeMenu === "family" && (
          <FamilyGovernancePanel
            t={t}
            digits={digits}
            currencyName={currencyName}
            activeFamily={activeFamily}
            currentUser={currentUser}
            email={email}
            myPermissions={myPermissions}
            governanceMembers={governanceMembers}
            joinRequests={joinRequests}
            governanceLoading={governanceLoading}
            inviteForm={inviteForm}
            setInviteForm={setInviteForm}
            inviteGenerating={inviteGenerating}
            inviteRevoking={inviteRevoking}
            generatedInvite={generatedInvite}
            onRefresh={loadFamilyGovernance}
            onGenerateInvite={generateFamilyInvite}
            onInviteEmail={inviteFamilyByEmail}
            onInviteLink={inviteFamilyByLink}
            onRevokeInvite={revokeFamilyInvite}
            onDecideJoinRequest={decideJoinRequest}
            onJoinFamily={submitLoggedInJoin}
            apiGet={apiGet}
            apiPost={apiPost}
            apiPatch={apiPatch}
            apiDelete={apiDelete}
            activeFamilyId={activeFamilyId}
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
                <p>{t("convertedIntoBase")}</p>
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
                    <span>{t("rate")}: {digits(wallet.rate_used)}</span>
                    <strong>{money(wallet.converted_balance, currencySummary?.base_currency || activeFamily?.default_currency)}</strong>
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
                {exchangeRates.slice(0, 25).map((rate) => (
                  <div className="row" key={rate.id}>
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
                <strong>{zakatSummary?.latest?.is_zakat_due ? "DUE" : "NOT DUE"}</strong>
                <p>{zakatSummary?.latest?.calculation_year || zakatForm.calculation_year}</p>
              </div>
            </div>

            <h3>{t("calculateZakat")}</h3>
            <div className="savings-form">
              <input placeholder={t("yearPlaceholder")} value={zakatForm.calculation_year} onChange={(e) => setZakatForm({ ...zakatForm, calculation_year: e.target.value })} />
              <input placeholder={t("cashAmountPlaceholder")} value={zakatForm.cash_amount} onChange={(e) => setZakatForm({ ...zakatForm, cash_amount: e.target.value })} />
              <input placeholder="Gold grams (optional)" value={zakatForm.gold_grams || ""} onChange={(e) => setZakatForm({ ...zakatForm, gold_grams: e.target.value })} />
              <input placeholder="Silver grams (optional)" value={zakatForm.silver_grams || ""} onChange={(e) => setZakatForm({ ...zakatForm, silver_grams: e.target.value })} />
              <input placeholder={t("goldValuePlaceholder")} value={zakatForm.gold_value} onChange={(e) => setZakatForm({ ...zakatForm, gold_value: e.target.value })} />
              <input placeholder="Silver value" value={zakatForm.silver_value} onChange={(e) => setZakatForm({ ...zakatForm, silver_value: e.target.value })} />
              <input placeholder="Investment value" value={zakatForm.investment_value} onChange={(e) => setZakatForm({ ...zakatForm, investment_value: e.target.value })} />
              <input placeholder="Business assets" value={zakatForm.business_assets} onChange={(e) => setZakatForm({ ...zakatForm, business_assets: e.target.value })} />
              <input placeholder="Receivables" value={zakatForm.receivables} onChange={(e) => setZakatForm({ ...zakatForm, receivables: e.target.value })} />
              <input placeholder="Deductible debts" value={zakatForm.deductible_debts} onChange={(e) => setZakatForm({ ...zakatForm, deductible_debts: e.target.value })} />
              <select value={zakatForm.nisab_metal || "SILVER"} onChange={(e) => setZakatForm({ ...zakatForm, nisab_metal: e.target.value })}>
                <option value="SILVER">Nisab metal: SILVER</option>
                <option value="GOLD">Nisab metal: GOLD</option>
              </select>
              <input placeholder={t("nisabAmountPlaceholder") + " (auto ok)"} value={zakatForm.nisab_amount} onChange={(e) => setZakatForm({ ...zakatForm, nisab_amount: e.target.value })} />
              <input placeholder={t("note")} value={zakatForm.note} onChange={(e) => setZakatForm({ ...zakatForm, note: e.target.value })} />
              <button onClick={calculateZakat}>{t("calculateZakat")}</button>
              <button onClick={loadZakat}>{t("refreshZakat")}</button>
              <button type="button" onClick={fillNisabFromRates}>Auto nisab from rates</button>
            </div>
            <h3>Gold / Silver rates (BDT / gram)</h3>
            <div className="savings-form">
              <input placeholder="Gold rate" value={zakatForm.gold_rate || ""} onChange={(e) => setZakatForm({ ...zakatForm, gold_rate: e.target.value })} />
              <button type="button" onClick={() => saveMetalRate("GOLD")}>Save GOLD</button>
              <input placeholder="Silver rate" value={zakatForm.silver_rate || ""} onChange={(e) => setZakatForm({ ...zakatForm, silver_rate: e.target.value })} />
              <button type="button" onClick={() => saveMetalRate("SILVER")}>Save SILVER</button>
              <button type="button" onClick={loadMetalRates}>Load rates</button>
            </div>
            {metalRates ? (
              <p className="status">
                {(metalRates.rates || []).map((r) => `${r.metal}=${r.rate_bdt}`).join(" · ") || "No rates yet"}
              </p>
            ) : null}

            <h3>{t("zakatHistory")}</h3>
            {zakatRecords.length === 0 ? (
              <p className="status">No zakat records found</p>
            ) : (
              <div className="table">
                {zakatRecords.map((record) => (
                  <div className="row" key={record.id}>
                    <span>{record.calculation_year}</span>
                    <span>{t("zakatableLabel")} {money(record.zakatable_amount, record.currency)}</span>
                    <span>Nisab: {money(record.nisab_amount, record.currency)}</span>
                    <strong>{money(record.zakat_due, record.currency)}</strong>
                    <span>{record.is_zakat_due ? "DUE" : "NOT DUE"}</span>
                    <span>{record.created_at ? digits(record.created_at) : t("noDate")}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {activeFamilyId && isPhase15Menu(activeMenu) && (
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
            onCancelEdit={() => resetPhase15Form(phase15ActiveTab)}
            onClose={closePhase15Item}
            onRefresh={loadPhase15}
          />
        )}

        {activeFamilyId && isPhase16Menu(activeMenu) && (
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
            onCancelEdit={() => resetPhase16Form(phase16ActiveTab)}
            onClose={closePhase16Item}
            onRefresh={loadPhase16}
            onUploadDocument={uploadDocumentForItem}
            onDownloadDocument={downloadPhase16Document}
          />
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
            currentUser={currentUser}
            email={email}
            avatarUrl={avatarUrl(currentUser)}
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
            permissionForms={permissionForms}
            updatePermissionForm={updatePermissionForm}
            saveMemberPermission={saveMemberPermission}
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
            onRefresh={loadSettingsData}
            apiBase={apiBase}
            onApiBaseChange={(next) => setApiBase(persistApiBase(next))}
            firebaseConfigured={FIREBASE_CONFIGURED}
            firebaseUser={firebaseUser}
            firebaseMeta={firebaseMeta}
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
            onFirebaseGoogleSignIn={handleFirebaseGoogleSignIn}
            onFirebaseEmailSignIn={handleFirebaseEmailSignIn}
            onFirebaseEmailRegister={handleFirebaseEmailRegister}
            onFirebaseSignOut={handleFirebaseSignOut}
            onFirebaseSyncNow={handleFirebaseSyncNow}
            onFirebaseRestore={handleFirebaseRestore}
          />
        )}

        <MobileBottomNavigation navItems={mobileNavItems} activeMenu={activeMenu} setActiveMenu={setActiveMenu} />
        {status ? <p className="status arch-status-toast">{status}</p> : null}
      </main>
    </div>
  );
}

export default App;
