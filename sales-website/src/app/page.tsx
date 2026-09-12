"use client";

import Link from "next/link";
import { useI18n } from "@/components/LanguageProvider";
import { products, site } from "@/lib/site";

type IconName =
  | "check"
  | "shield"
  | "wifi"
  | "refresh"
  | "cart"
  | "family"
  | "arrow"
  | "download"
  | "desktop"
  | "phone"
  | "windows"
  | "android"
  | "support"
  | "backup"
  | "lock";

const inventory = products.find((product) => product.slug === "s4-business-thinking-inventory-software") ?? products[0]!;
const finance = products.find((product) => product.slug === "s4-family-finance-143") ?? products[1]!;

const homeCopy = {
  en: {
    badge: "Official Software Platform",
    headline1: "Two Powerful Software,",
    headline2: "One Trusted Platform",
    subtitle: "Professional software for Spare Parts Inventory and Family Finance Management.",
    explore: "Explore Products",
    download: "Download Now",
    corePrefix: "Our",
    coreHighlight: "Two",
    coreSuffix: "Core Products",
    featuresEyebrow: "Features",
    featuresTitle: "Why Choose",
    availableOn: "Available On",
    supportLine: "Need Help? Chat With Us On WhatsApp",
    supportSub: "We are ready to help you.",
    learnMore: "Learn More",
    trustItems: [
      { label: "100% Secure", icon: "shield" as const },
      { label: "Offline Ready", icon: "wifi" as const },
      { label: "Regular Update", icon: "refresh" as const },
    ],
    products: {
      inventory: {
        subtitle: "Spare Parts Inventory Software",
        description: "Complete inventory management solution for spare parts business. Manage stock, sales, purchase, customers, suppliers and reports easily.",
      },
      finance: {
        subtitle: "Family Finance Management",
        description: "Manage your family income, expense, savings, loans, budgets and financial goals in one smart and secure platform.",
      },
    },
    features: [
      { title: "Easy to Use", description: "Simple and user friendly interface", icon: "check" as const },
      { title: "Offline Mode", description: "Works without internet connection", icon: "wifi" as const },
      { title: "Data Security", description: "Your data is secure and encrypted", icon: "lock" as const },
      { title: "Regular Backup", description: "Automatic backup and data recovery", icon: "backup" as const },
      { title: "Multi Device", description: "Use on Desktop, Web and Mobile", icon: "phone" as const },
      { title: "24/7 Support", description: "Always here to help you anytime", icon: "support" as const },
    ],
    availability: [
      { title: "Windows", description: "Desktop App", icon: "windows" as const },
      { title: "Web App", description: "Any Browser", icon: "desktop" as const },
      { title: "Android", description: "Mobile App", icon: "android" as const },
    ],
    stats: [
      { value: "100%", label: "Secure & Reliable", tone: "text-emerald-300" },
      { value: "Growing", label: "User Community", tone: "text-emerald-300" },
      { value: "2+", label: "Powerful Products", tone: "text-blue-300" },
      { value: "24/7", label: "Customer Support", tone: "text-indigo-300" },
    ],
  },
  bn: {
    badge: "অফিসিয়াল সফটওয়্যার প্ল্যাটফর্ম",
    headline1: "দুইটি শক্তিশালী সফটওয়্যার,",
    headline2: "একটি বিশ্বস্ত প্ল্যাটফর্ম",
    subtitle: "Spare Parts Inventory এবং Family Finance Management-এর জন্য professional software।",
    explore: "পণ্য দেখুন",
    download: "ডাউনলোড করুন",
    corePrefix: "আমাদের",
    coreHighlight: "দুইটি",
    coreSuffix: "মূল পণ্য",
    featuresEyebrow: "ফিচার",
    featuresTitle: "কেন বেছে নেবেন",
    availableOn: "যেসব প্ল্যাটফর্মে",
    supportLine: "সাহায্য দরকার? WhatsApp-এ আমাদের সাথে কথা বলুন",
    supportSub: "আমরা আপনাকে সাহায্য করতে প্রস্তুত।",
    learnMore: "আরও জানুন",
    trustItems: [
      { label: "১০০% নিরাপদ", icon: "shield" as const },
      { label: "অফলাইন রেডি", icon: "wifi" as const },
      { label: "নিয়মিত আপডেট", icon: "refresh" as const },
    ],
    products: {
      inventory: {
        subtitle: "Spare Parts Inventory Software",
        description: "Spare parts business-এর stock, sales, purchase, customer, supplier এবং report সহজে manage করার complete inventory solution।",
      },
      finance: {
        subtitle: "Family Finance Management",
        description: "Family income, expense, savings, loan, budget এবং financial goal এক smart ও secure platform-এ manage করুন।",
      },
    },
    features: [
      { title: "ব্যবহার সহজ", description: "সহজ ও user friendly interface", icon: "check" as const },
      { title: "অফলাইন মোড", description: "Internet ছাড়াও কাজ করে", icon: "wifi" as const },
      { title: "ডাটা নিরাপত্তা", description: "আপনার data secure ও protected", icon: "lock" as const },
      { title: "নিয়মিত ব্যাকআপ", description: "Backup ও recovery workflow", icon: "backup" as const },
      { title: "মাল্টি ডিভাইস", description: "Desktop, Web ও Mobile support", icon: "phone" as const },
      { title: "২৪/৭ সাপোর্ট", description: "যেকোনো সময় support পাবেন", icon: "support" as const },
    ],
    availability: [
      { title: "Windows", description: "Desktop App", icon: "windows" as const },
      { title: "Web App", description: "যেকোনো Browser", icon: "desktop" as const },
      { title: "Android", description: "Mobile App", icon: "android" as const },
    ],
    stats: [
      { value: "১০০%", label: "নিরাপদ ও নির্ভরযোগ্য", tone: "text-emerald-300" },
      { value: "Growing", label: "User Community", tone: "text-emerald-300" },
      { value: "২+", label: "শক্তিশালী পণ্য", tone: "text-blue-300" },
      { value: "২৪/৭", label: "কাস্টমার সাপোর্ট", tone: "text-indigo-300" },
    ],
  },
  hi: {
    badge: "आधिकारिक सॉफ्टवेयर प्लेटफॉर्म",
    headline1: "दो शक्तिशाली सॉफ्टवेयर,",
    headline2: "एक भरोसेमंद प्लेटफॉर्म",
    subtitle: "Spare Parts Inventory और Family Finance Management के लिए professional software।",
    explore: "उत्पाद देखें",
    download: "डाउनलोड करें",
    corePrefix: "हमारे",
    coreHighlight: "दो",
    coreSuffix: "मुख्य उत्पाद",
    featuresEyebrow: "Features",
    featuresTitle: "क्यों चुनें",
    availableOn: "उपलब्ध है",
    supportLine: "मदद चाहिए? WhatsApp पर बात करें",
    supportSub: "हम आपकी मदद के लिए तैयार हैं।",
    learnMore: "और जानें",
    trustItems: [
      { label: "100% सुरक्षित", icon: "shield" as const },
      { label: "Offline Ready", icon: "wifi" as const },
      { label: "Regular Update", icon: "refresh" as const },
    ],
    products: {
      inventory: { subtitle: "Spare Parts Inventory Software", description: "Stock, sales, purchase, customer, supplier और reports manage करने के लिए complete inventory solution।" },
      finance: { subtitle: "Family Finance Management", description: "Income, expense, savings, loans, budgets और goals को smart secure platform में manage करें।" },
    },
    features: [
      { title: "Easy to Use", description: "सरल और user friendly interface", icon: "check" as const },
      { title: "Offline Mode", description: "Internet के बिना भी काम करता है", icon: "wifi" as const },
      { title: "Data Security", description: "आपका data सुरक्षित रहता है", icon: "lock" as const },
      { title: "Regular Backup", description: "Backup और recovery workflow", icon: "backup" as const },
      { title: "Multi Device", description: "Desktop, Web और Mobile support", icon: "phone" as const },
      { title: "24/7 Support", description: "कभी भी support उपलब्ध", icon: "support" as const },
    ],
    availability: [
      { title: "Windows", description: "Desktop App", icon: "windows" as const },
      { title: "Web App", description: "Any Browser", icon: "desktop" as const },
      { title: "Android", description: "Mobile App", icon: "android" as const },
    ],
    stats: [
      { value: "100%", label: "Secure & Reliable", tone: "text-emerald-300" },
      { value: "Growing", label: "User Community", tone: "text-emerald-300" },
      { value: "2+", label: "Powerful Products", tone: "text-blue-300" },
      { value: "24/7", label: "Customer Support", tone: "text-indigo-300" },
    ],
  },
  ur: {
    badge: "آفیشل سافٹ ویئر پلیٹ فارم",
    headline1: "دو طاقتور سافٹ ویئر،",
    headline2: "ایک قابل اعتماد پلیٹ فارم",
    subtitle: "Spare Parts Inventory اور Family Finance Management کے لیے professional software۔",
    explore: "Products دیکھیں",
    download: "Download کریں",
    corePrefix: "ہمارے",
    coreHighlight: "دو",
    coreSuffix: "بنیادی Products",
    featuresEyebrow: "Features",
    featuresTitle: "کیوں منتخب کریں",
    availableOn: "Available On",
    supportLine: "مدد چاہیے؟ WhatsApp پر بات کریں",
    supportSub: "ہم آپ کی مدد کے لیے تیار ہیں۔",
    learnMore: "مزید جانیں",
    trustItems: [
      { label: "100% محفوظ", icon: "shield" as const },
      { label: "Offline Ready", icon: "wifi" as const },
      { label: "Regular Update", icon: "refresh" as const },
    ],
    products: {
      inventory: { subtitle: "Spare Parts Inventory Software", description: "Stock, sales, purchase, customers, suppliers اور reports manage کرنے کا complete inventory solution۔" },
      finance: { subtitle: "Family Finance Management", description: "Income, expense, savings, loans, budgets اور goals کو smart secure platform میں manage کریں۔" },
    },
    features: [
      { title: "Easy to Use", description: "آسان اور user friendly interface", icon: "check" as const },
      { title: "Offline Mode", description: "Internet کے بغیر بھی کام کرتا ہے", icon: "wifi" as const },
      { title: "Data Security", description: "آپ کا data محفوظ رہتا ہے", icon: "lock" as const },
      { title: "Regular Backup", description: "Backup اور recovery workflow", icon: "backup" as const },
      { title: "Multi Device", description: "Desktop, Web اور Mobile support", icon: "phone" as const },
      { title: "24/7 Support", description: "کسی بھی وقت support دستیاب", icon: "support" as const },
    ],
    availability: [
      { title: "Windows", description: "Desktop App", icon: "windows" as const },
      { title: "Web App", description: "Any Browser", icon: "desktop" as const },
      { title: "Android", description: "Mobile App", icon: "android" as const },
    ],
    stats: [
      { value: "100%", label: "Secure & Reliable", tone: "text-emerald-300" },
      { value: "Growing", label: "User Community", tone: "text-emerald-300" },
      { value: "2+", label: "Powerful Products", tone: "text-blue-300" },
      { value: "24/7", label: "Customer Support", tone: "text-indigo-300" },
    ],
  },
  ar: {
    badge: "منصة البرامج الرسمية",
    headline1: "برنامجان قويان،",
    headline2: "منصة واحدة موثوقة",
    subtitle: "برامج احترافية لجرد قطع الغيار وإدارة الأموال العائلية.",
    explore: "استكشف المنتجات",
    download: "تنزيل الآن",
    corePrefix: "منتجانا",
    coreHighlight: "الأساسيان",
    coreSuffix: "",
    featuresEyebrow: "الميزات",
    featuresTitle: "لماذا تختار",
    availableOn: "متوفر على",
    supportLine: "تحتاج مساعدة؟ تحدث معنا عبر واتساب",
    supportSub: "نحن جاهزون لمساعدتك.",
    learnMore: "اعرف المزيد",
    trustItems: [
      { label: "آمن 100%", icon: "shield" as const },
      { label: "جاهز دون إنترنت", icon: "wifi" as const },
      { label: "تحديث منتظم", icon: "refresh" as const },
    ],
    products: {
      inventory: { subtitle: "برنامج جرد قطع الغيار", description: "حل كامل لإدارة المخزون والمبيعات والمشتريات والعملاء والموردين والتقارير بسهولة." },
      finance: { subtitle: "إدارة الأموال العائلية", description: "أدر الدخل والمصروفات والمدخرات والقروض والميزانيات والأهداف المالية في منصة آمنة." },
    },
    features: [
      { title: "سهل الاستخدام", description: "واجهة بسيطة وسهلة", icon: "check" as const },
      { title: "وضع دون إنترنت", description: "يعمل بدون اتصال إنترنت", icon: "wifi" as const },
      { title: "أمان البيانات", description: "بياناتك آمنة ومحمية", icon: "lock" as const },
      { title: "نسخ احتياطي", description: "نسخ احتياطي واستعادة", icon: "backup" as const },
      { title: "عدة أجهزة", description: "يدعم سطح المكتب والويب والجوال", icon: "phone" as const },
      { title: "دعم 24/7", description: "مساعدة في أي وقت", icon: "support" as const },
    ],
    availability: [
      { title: "Windows", description: "تطبيق سطح المكتب", icon: "windows" as const },
      { title: "Web App", description: "أي متصفح", icon: "desktop" as const },
      { title: "Android", description: "تطبيق جوال", icon: "android" as const },
    ],
    stats: [
      { value: "100%", label: "آمن وموثوق", tone: "text-emerald-300" },
      { value: "Growing", label: "مجتمع مستخدمين متنامي", tone: "text-emerald-300" },
      { value: "2+", label: "منتجات قوية", tone: "text-blue-300" },
      { value: "24/7", label: "دعم العملاء", tone: "text-indigo-300" },
    ],
  },
} as const;

function Icon({ name, className = "h-5 w-5" }: { name: IconName; className?: string }) {
  const paths: Record<IconName, string> = {
    check: "M9.2 16.6 4.9 12.3l1.4-1.4 2.9 2.9 8.5-8.5 1.4 1.4-9.9 9.9Z",
    shield: "M12 3.2 19 6v5.2c0 4.4-2.9 7.3-7 9.1-4.1-1.8-7-4.7-7-9.1V6l7-2.8Zm0 2.1L7 7.3v3.9c0 3.2 1.9 5.4 5 6.9 3.1-1.5 5-3.7 5-6.9V7.3l-5-2Z",
    wifi: "M12 17.5a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4Zm-5-4.2a7.1 7.1 0 0 1 10 0l-1.5 1.5a5 5 0 0 0-7 0L7 13.3Zm-3.8-3.7a12.4 12.4 0 0 1 17.6 0l-1.5 1.5a10.3 10.3 0 0 0-14.6 0L3.2 9.6Z",
    refresh: "M17.7 6.3A8 8 0 1 0 20 12h-2a6 6 0 1 1-1.8-4.3L13 11h8V3l-3.3 3.3Z",
    cart: "M7 18.5a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4Zm9 0a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4ZM4.2 4H2V2h3.7l1 3H21l-2.4 8.2H8.1l.5 1.6H19v2H7.1L4.2 4Z",
    family: "M8.5 11a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Zm7.8.8a2.8 2.8 0 1 1 0-5.6 2.8 2.8 0 0 1 0 5.6ZM2.5 19.5c.8-3.3 3.1-5.6 6-5.6s5.2 2.3 6 5.6h-12Zm11.7 0a8.4 8.4 0 0 0-1.3-3.1 5.3 5.3 0 0 1 8.1 3.1h-6.8Z",
    arrow: "M13.2 5.3 19.9 12l-6.7 6.7-1.4-1.4 4.3-4.3H4v-2h12.1l-4.3-4.3 1.4-1.4Z",
    download: "M11 4h2v8.2l3.1-3.1 1.4 1.4-5.5 5.5-5.5-5.5 1.4-1.4 3.1 3.1V4Zm-6 14h14v2H5v-2Z",
    desktop: "M3 5h18v11H3V5Zm2 2v7h14V7H5Zm4 11h6v2H9v-2Z",
    phone: "M8 3h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm0 3v11h8V6H8Zm3 12v1h2v-1h-2Z",
    windows: "M3 5.3 10.5 4v7H3V5.3Zm8.5-1.4L21 2.2V11h-9.5V3.9ZM3 13h7.5v7L3 18.7V13Zm8.5 0H21v8.8l-9.5-1.7V13Z",
    android: "M8.1 7.1 6.6 4.5l1.1-.6 1.6 2.8a6.2 6.2 0 0 1 5.4 0l1.6-2.8 1.1.6-1.5 2.6A6 6 0 0 1 19 12v6.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 18.5V12a6 6 0 0 1 3.1-4.9ZM8 10.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm8 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z",
    support: "M12 3a8 8 0 0 0-8 8v4a3 3 0 0 0 3 3h1v-7H6a6 6 0 0 1 12 0h-2v7h1.4A5.5 5.5 0 0 1 12 21v-2a3.5 3.5 0 0 0 3.5-3.5V11a3.5 3.5 0 0 0-7 0v5H7a1 1 0 0 1-1-1v-4a6 6 0 0 1 12 0v4a1 1 0 0 1-1 1h-1.5A3.5 3.5 0 0 1 12 19v2a5.5 5.5 0 0 0 5.4-4H17a3 3 0 0 0 3-3v-3a8 8 0 0 0-8-8Z",
    backup: "M12 4a8 8 0 1 1-7.4 5H2l3.6-3.6L9.2 9H6.7A6 6 0 1 0 12 6V4Zm1 4v4.2l3.2 1.9-1 1.7-4.2-2.5V8h2Z",
    lock: "M7 10V8a5 5 0 0 1 10 0v2h1.5v10h-13V10H7Zm2 0h6V8a3 3 0 0 0-6 0v2Zm2 4v2h2v-2h-2Z",
  };

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path fill="currentColor" d={paths[name]} />
    </svg>
  );
}

function MiniDashboard({ type }: { type: "inventory" | "finance" }) {
  const green = type === "finance";
  const label = green ? "Family Overview" : "Sales Overview";
  const accent = green ? "bg-emerald-500" : "bg-blue-500";
  const panel = green ? "bg-emerald-50" : "bg-slate-900";
  const text = green ? "text-slate-900" : "text-white";
  const muted = green ? "text-slate-500" : "text-slate-400";

  return (
    <div className={`relative overflow-hidden rounded-xl border ${green ? "border-emerald-100 bg-white" : "border-slate-700 bg-[#071423]"} p-3 shadow-2xl`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={`h-3 w-3 rounded-sm ${accent}`} />
          <span className={`text-[10px] font-bold ${text}`}>{green ? "S4 FAMILY" : "S4 BUSINESS"}</span>
        </div>
        <div className="flex gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
          <span className="h-1.5 w-1.5 rounded-full bg-yellow-400" />
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        </div>
      </div>
      <div className="grid grid-cols-[0.34fr_1fr] gap-3">
        <div className={`space-y-2 rounded-lg ${panel} p-2`}>
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className={`h-2 rounded-full ${green ? "bg-slate-100" : "bg-slate-700"}`} />
          ))}
        </div>
        <div className="min-w-0">
          <div className="grid grid-cols-3 gap-2">
            {["৳ 1,250,000", "৳ 850,000", "1,250"].map((item, index) => (
              <div key={item} className={`rounded-lg ${green ? "bg-slate-50" : "bg-slate-800"} p-2`}>
                <p className={`text-[8px] ${muted}`}>{index === 2 ? "Total Items" : "Total"}</p>
                <p className={`mt-1 truncate text-[10px] font-black ${green ? (index === 1 ? "text-red-500" : "text-emerald-600") : "text-white"}`}>{item}</p>
              </div>
            ))}
          </div>
          <div className={`mt-3 rounded-lg ${green ? "bg-slate-50" : "bg-slate-800"} p-3`}>
            <div className="mb-2 flex items-center justify-between">
              <span className={`text-[9px] font-bold ${text}`}>{label}</span>
              <span className={`text-[8px] ${muted}`}>Recent</span>
            </div>
            <div className="flex h-20 items-end gap-1.5">
              {[28, 46, 35, 64, 48, 74, 58, 88, 72, 96].map((height, index) => (
                <span key={index} className={`w-full rounded-t ${green ? "bg-emerald-400" : "bg-cyan-400"}`} style={{ height: `${height}%` }} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DevicePreview({ type, compact = false }: { type: "inventory" | "finance"; compact?: boolean }) {
  if (compact) {
    return <ProductDevicePreview type={type} />;
  }

  return (
    <div className="relative h-48 sm:h-64 lg:h-80" aria-label={`${type} dashboard preview`}>
      <div className="absolute bottom-0 right-0 w-[76%] rounded-[1.2rem] border-4 border-slate-950 bg-slate-950 p-1 shadow-[0_24px_50px_rgba(15,23,42,0.28)]">
        <MiniDashboard type={type} />
      </div>
      <div className="absolute bottom-2 left-0 w-[30%] min-w-20 rounded-[1rem] border-4 border-slate-950 bg-slate-950 p-1 shadow-[0_18px_34px_rgba(15,23,42,0.22)]">
        <MiniDashboard type={type} />
      </div>
    </div>
  );
}

function ProductDevicePreview({ type }: { type: "inventory" | "finance" }) {
  const green = type === "finance";
  const accent = green ? "bg-emerald-500" : "bg-blue-500";
  const soft = green ? "bg-emerald-50" : "bg-blue-50";
  const chart = green ? "bg-emerald-400" : "bg-cyan-400";
  const title = green ? "Finance Dashboard" : "Inventory Dashboard";
  const cards = green ? ["Balance", "Income", "Expense"] : ["Sales", "Stock", "Purchase"];

  return (
    <div className="relative min-h-56 overflow-visible px-2 pt-5 sm:min-h-64" aria-label={`${type} laptop and mobile preview`}>
      <div className="absolute bottom-0 left-0 w-[82%] max-w-[360px]">
        <div className="rounded-t-[1.15rem] border-[7px] border-slate-950 bg-slate-950 p-1 shadow-[0_24px_50px_rgba(15,23,42,0.24)]">
          <div className="overflow-hidden rounded-[0.65rem] bg-white p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-[9px] font-black text-slate-950">{title}</p>
                <p className="text-[7px] text-slate-400">Executive overview</p>
              </div>
              <span className={`h-3 w-3 rounded-full ${accent}`} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              {cards.map((card, index) => (
                <div key={card} className="rounded-md bg-slate-50 p-2">
                  <p className="text-[7px] text-slate-400">{card}</p>
                  <p className={`mt-1 truncate text-[8px] font-black ${green ? (index === 2 ? "text-red-500" : "text-emerald-600") : "text-blue-600"}`}>{green ? ["৳ 6.82M", "৳ 12.45M", "৳ 5.63M"][index] : ["৳ 1.25M", "1,250", "৳ 850K"][index]}</p>
                </div>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-[1fr_0.72fr] gap-3">
              <div className="flex h-20 items-end gap-1.5 rounded-lg bg-slate-50 p-2">
                {[35, 60, 48, 78, 66, 88, 74].map((height, index) => (
                  <span key={index} className={`w-full rounded-t ${chart}`} style={{ height: `${height}%` }} />
                ))}
              </div>
              <div className="space-y-1.5 rounded-lg bg-slate-50 p-2">
                {[0, 1, 2, 3].map((item) => (
                  <span key={item} className="block h-2 rounded-full bg-white" />
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="mx-auto h-3 w-[88%] rounded-b-xl bg-gradient-to-b from-slate-400 to-slate-200 shadow-[0_12px_22px_rgba(15,23,42,0.2)]" />
      </div>

      <div className="absolute bottom-3 right-1 z-20 w-[31%] min-w-[88px] max-w-[122px] rounded-[1.15rem] border-[6px] border-slate-950 bg-slate-950 p-1 shadow-[0_20px_38px_rgba(15,23,42,0.28)]">
        <div className="overflow-hidden rounded-[0.75rem] bg-white p-2">
          <div className="mx-auto mb-2 h-1 w-8 rounded-full bg-slate-800" />
          <div className="mb-2 flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${accent}`} />
            <span className="h-1.5 flex-1 rounded-full bg-slate-100" />
          </div>
          <div className={`rounded-lg ${soft} p-2`}>
            <p className="text-[7px] font-black text-slate-900">{green ? "Family" : "Stock"}</p>
            <p className={`mt-1 text-[9px] font-black ${green ? "text-emerald-600" : "text-blue-600"}`}>{green ? "৳ 1.25M" : "1,250"}</p>
          </div>
          <div className="mt-2 flex h-14 items-end gap-1">
            {[42, 70, 55, 82, 64].map((height, index) => (
              <span key={index} className={`w-full rounded-t ${chart}`} style={{ height: `${height}%` }} />
            ))}
          </div>
          <div className="mt-2 space-y-1">
            {[0, 1, 2].map((item) => (
              <span key={item} className="block h-1.5 rounded-full bg-slate-100" />
            ))}
          </div>
          <div className="mx-auto mt-2 h-1.5 w-1.5 rounded-full bg-slate-200" />
        </div>
      </div>
    </div>
  );
}

function HeroPreview() {
  return (
    <div className="relative mx-auto min-h-[280px] w-full max-w-3xl lg:min-h-[350px]" aria-label="S4 product dashboard previews">
      <div className="absolute left-4 top-0 z-30 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-700 px-4 py-2 text-white shadow-xl sm:left-16">
        <p className="text-xs font-black">S4 BUSINESS THINKING</p>
        <p className="text-[11px] text-white/85">Spare Parts Inventory</p>
      </div>
      <div className="absolute right-3 top-8 z-30 rounded-lg bg-gradient-to-r from-emerald-500 to-green-700 px-4 py-2 text-white shadow-xl sm:right-16">
        <p className="text-xs font-black">S4 FAMILY FINANCE 143</p>
        <p className="text-[11px] text-white/85">Family Finance Management</p>
      </div>

      <div className="absolute bottom-8 left-0 w-[78%] max-w-[560px] -rotate-1 sm:left-4">
        <div className="rounded-t-[1.4rem] border-[8px] border-slate-950 bg-slate-950 p-1 shadow-[0_28px_70px_rgba(0,0,0,0.45)]">
          <MiniDashboard type="inventory" />
        </div>
        <div className="mx-auto h-4 w-[88%] rounded-b-2xl bg-gradient-to-b from-slate-400 to-slate-200 shadow-[0_14px_26px_rgba(0,0,0,0.3)]" />
      </div>

      <div className="absolute bottom-0 right-0 z-20 w-[31%] min-w-[118px] max-w-[190px] rotate-1 rounded-[1.5rem] border-[8px] border-slate-950 bg-slate-950 p-1 shadow-[0_28px_70px_rgba(0,0,0,0.5)]">
        <div className="overflow-hidden rounded-[1rem] bg-white p-3">
          <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-800" />
          <div className="mb-3 flex items-center gap-2">
            <span className="h-3 w-3 rounded-sm bg-emerald-500" />
            <span className="text-[10px] font-black text-slate-950">S4 FAMILY</span>
          </div>
          <div className="rounded-xl bg-emerald-50 p-3">
            <p className="text-[8px] text-slate-500">Total Savings</p>
            <p className="mt-1 text-sm font-black text-emerald-600">৳ 1.25M</p>
          </div>
          <div className="mt-3 flex h-24 items-end gap-1.5 rounded-xl bg-slate-50 p-2">
            {[36, 58, 48, 74, 62, 90].map((height, index) => (
              <span key={index} className="w-full rounded-t bg-emerald-400" style={{ height: `${height}%` }} />
            ))}
          </div>
          <div className="mt-3 space-y-1.5">
            {[0, 1, 2].map((item) => (
              <span key={item} className="block h-2 rounded-full bg-slate-100" />
            ))}
          </div>
          <div className="mx-auto mt-3 h-2 w-2 rounded-full bg-slate-200" />
        </div>
      </div>
    </div>
  );
}

function ProductCard({
  product,
  type,
  labels,
  learnMore,
}: {
  product: typeof inventory;
  type: "inventory" | "finance";
  labels: { subtitle: string; description: string };
  learnMore: string;
}) {
  const isFinance = type === "finance";
  const color = isFinance ? "green" : "blue";
  const title = isFinance ? "S4 FAMILY FINANCE 143" : "S4 BUSINESS THINKING";

  return (
    <article className={`grid gap-6 overflow-hidden rounded-2xl border bg-white p-6 shadow-[0_16px_42px_rgba(15,23,42,0.08)] transition-transform duration-300 hover:-translate-y-1 md:grid-cols-[1fr_0.95fr] ${isFinance ? "border-emerald-200" : "border-blue-200"}`}>
      <div className="flex flex-col justify-center">
        <div className="flex items-center gap-4">
          <span className={`grid h-14 w-14 place-items-center rounded-xl text-white shadow-lg ${isFinance ? "bg-emerald-500" : "bg-blue-600"}`}>
            <Icon name={isFinance ? "family" : "cart"} className="h-7 w-7" />
          </span>
          <div>
            <h3 className={`text-xl font-black tracking-tight ${isFinance ? "text-emerald-700" : "text-blue-700"}`}>{title}</h3>
            <p className="font-semibold text-slate-950">{labels.subtitle}</p>
          </div>
        </div>
        <p className="mt-5 max-w-xl text-sm leading-7 text-slate-700">{labels.description}</p>
        <Link href={product.href} className={`mt-5 inline-flex w-fit items-center gap-2 rounded-lg px-5 py-3 text-sm font-bold text-white transition ${color === "green" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-blue-600 hover:bg-blue-700"}`}>
          {learnMore}
          <Icon name="arrow" className="h-4 w-4" />
        </Link>
      </div>
      <DevicePreview type={type} compact />
    </article>
  );
}

export default function Home() {
  const { lang } = useI18n();
  const c = homeCopy[lang] ?? homeCopy.en;

  return (
    <>
      <section className="relative overflow-hidden bg-[#06172b] text-white">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(14,165,233,0.18),transparent_34%),radial-gradient(circle_at_80%_10%,rgba(37,99,235,0.18),transparent_32%),linear-gradient(135deg,#06172b_0%,#031021_52%,#061a33_100%)]" />
        <div className="absolute inset-x-0 bottom-0 h-px bg-cyan-300/20" />
        <div className="relative mx-auto grid max-w-[1440px] items-center gap-10 px-4 py-12 sm:px-6 md:py-14 lg:grid-cols-[0.95fr_1.05fr] lg:py-16">
          <div className="max-w-3xl">
            <span className="inline-flex items-center gap-2 rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-sm font-bold text-cyan-200">
              <span className="grid h-5 w-5 place-items-center rounded-full bg-blue-600 text-white">
                <Icon name="check" className="h-3.5 w-3.5" />
              </span>
              {c.badge}
            </span>
            <h1 className="mt-6 flex flex-col gap-2 text-4xl font-black leading-[1.04] tracking-[-0.04em] sm:text-5xl lg:text-[3.35rem] xl:text-6xl 2xl:text-[4.2rem]">
              <span className="block text-white drop-shadow-[0_10px_28px_rgba(255,255,255,0.08)]">
                {c.headline1}
              </span>
              <span className="relative block w-fit max-w-full bg-gradient-to-r from-cyan-300 via-blue-400 to-purple-400 bg-clip-text pb-2 text-transparent drop-shadow-[0_18px_36px_rgba(56,189,248,0.18)]">
                {c.headline2}
                <span className="absolute inset-x-0 bottom-0 h-1 rounded-full bg-gradient-to-r from-cyan-300/80 via-blue-500/80 to-purple-400/80" aria-hidden />
              </span>
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-white/82 sm:text-xl">
              {c.subtitle}
            </p>
            <div className="mt-6 flex max-w-xl flex-wrap gap-3 rounded-xl border border-white/15 bg-white/5 p-2">
              {c.trustItems.map((item) => (
                <div key={item.label} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-white">
                  <Icon name={item.icon} className="h-5 w-5 text-cyan-300" />
                  {item.label}
                </div>
              ))}
            </div>
            <div className="mt-7 flex flex-wrap gap-4">
              <Link href="/products" className="inline-flex items-center gap-3 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-3.5 text-sm font-bold text-white shadow-[0_18px_34px_rgba(37,99,235,0.35)] transition hover:from-blue-700 hover:to-indigo-700">
                {c.explore}
                <Icon name="arrow" className="h-5 w-5" />
              </Link>
              <Link href="/installers" className="inline-flex items-center gap-3 rounded-lg border border-white/35 bg-white/5 px-6 py-3.5 text-sm font-bold text-white transition hover:border-cyan-300 hover:text-cyan-200">
                {c.download}
                <Icon name="download" className="h-5 w-5" />
              </Link>
            </div>
          </div>
          <HeroPreview />
        </div>
      </section>

      <section className="bg-slate-50 px-4 py-10 text-slate-950 sm:px-6" aria-labelledby="core-products-heading">
        <div className="mx-auto max-w-[1330px]">
          <h2 id="core-products-heading" className="text-center text-2xl font-black tracking-tight sm:text-3xl">
            {c.corePrefix} <span className="text-blue-600">{c.coreHighlight}</span> {c.coreSuffix}
          </h2>
          <div className="mt-8 grid gap-5 xl:grid-cols-2">
            <ProductCard product={inventory} type="inventory" labels={c.products.inventory} learnMore={c.learnMore} />
            <ProductCard product={finance} type="finance" labels={c.products.finance} learnMore={c.learnMore} />
          </div>
        </div>
      </section>

      <section id="features" className="bg-slate-50 px-4 pb-10 text-slate-950 sm:px-6" aria-labelledby="why-choose-heading">
        <div className="mx-auto max-w-[1330px]">
          <p className="text-center text-sm font-black uppercase tracking-[0.22em] text-blue-600">
            {c.featuresEyebrow}
          </p>
          <h2 id="why-choose-heading" className="mt-2 text-center text-2xl font-black tracking-tight">
            {c.featuresTitle} <span className="text-blue-600">S4?</span>
          </h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {c.features.map((feature) => (
              <article key={feature.title} className="rounded-xl border border-blue-100 bg-white p-5 shadow-[0_10px_28px_rgba(15,23,42,0.05)] transition hover:-translate-y-0.5 hover:shadow-[0_16px_32px_rgba(15,23,42,0.08)]">
                <span className="grid h-12 w-12 place-items-center rounded-xl bg-blue-50 text-blue-600">
                  <Icon name={feature.icon} className="h-6 w-6" />
                </span>
                <h3 className="mt-3 text-sm font-black text-slate-950">{feature.title}</h3>
                <p className="mt-1 text-sm leading-6 text-slate-600">{feature.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#06172b] px-4 py-8 text-white sm:px-6" aria-label="Availability and support">
        <div className="mx-auto grid max-w-[1330px] gap-8 lg:grid-cols-[1fr_1.1fr_1.6fr] lg:items-center">
          <div>
            <p className="text-sm font-semibold text-white/85">{c.availableOn}</p>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-3">
              {c.availability.map((item) => (
                <div key={item.title} className="flex items-center gap-3 rounded-lg border border-white/15 bg-white/5 p-3">
                  <Icon name={item.icon} className="h-7 w-7 text-blue-300" />
                  <div>
                    <p className="text-sm font-black">{item.title}</p>
                    <p className="text-xs text-white/65">{item.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="border-y border-white/15 py-5 lg:border-x lg:border-y-0 lg:px-8 lg:py-0">
            <p className="text-sm font-semibold text-white/85">{c.supportLine}</p>
            <a href={site.contact.whatsappUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-3 text-2xl font-black tracking-tight text-white transition hover:text-cyan-200">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-emerald-500 text-white">
                <Icon name="support" className="h-6 w-6" />
              </span>
              {site.contact.whatsappDisplay}
            </a>
            <p className="mt-1 text-sm text-white/60">{c.supportSub}</p>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {c.stats.map((stat) => (
              <div key={stat.label} className="border-white/10 sm:border-l sm:pl-5">
                <p className={`text-2xl font-black ${stat.tone}`}>{stat.value}</p>
                <p className="mt-1 text-xs text-white/70">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
