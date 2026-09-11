import type { Lang } from "@/lib/i18n";

// Locked brand & contact information — single source of truth.
// These values are LOCKED per the master website architecture.

export const site = {
  domain: "WWW.S4BUSINESSTHINKING.COM",
  brand: "S4BUSINESSTHINKING",
  url: "https://www.s4businessthinking.com",
  tagline: "Official software for spare parts inventory and family finance management.",
  taglineBn:
    "একই brand-এর অধীনে দুইটি production-grade software — Spare Parts Inventory ও Family Finance Management।",

  contact: {
    whatsappDisplay: "+880 1860-531723",
    whatsappUrl: "https://wa.me/8801860531723",
    facebookUrl: "https://www.facebook.com/share/1DGLPc3dTF/",
    email: "S4BUSINESSTHINKING@GMAIL.COM",
    emailUrl: "mailto:S4BUSINESSTHINKING@GMAIL.COM",
  },

  legal: {
    businessName: process.env.NEXT_PUBLIC_LEGAL_BUSINESS_NAME || "S4BUSINESSTHINKING",
    registeredAddress: process.env.NEXT_PUBLIC_LEGAL_REGISTERED_ADDRESS || "Bangladesh",
    jurisdiction: process.env.NEXT_PUBLIC_LEGAL_JURISDICTION || "Bangladesh",
    effectiveDate: process.env.NEXT_PUBLIC_LEGAL_EFFECTIVE_DATE || "2026-07-18",
  },

  nav: [
    { label: "Home", href: "/" },
    { label: "Products", href: "/products" },
    { label: "Pricing", href: "/pricing" },
    { label: "Downloads", href: "/downloads" },
    { label: "Support", href: "/support" },
    { label: "Contact", href: "/contact" },
  ],
} as const;

export type Product = {
  slug: string;
  name: string;
  short: string;
  description: string;
  href: string;
  accent: "accent" | "accent2";
  features: string[];
  platforms: string[];
};

export type DownloadRelease = {
  productSlug: string;
  platform: string;
  version: string;
  releaseDate: string;
  status: "available" | "pending";
  fileName?: string;
  size?: string;
  sha256?: string;
  href?: string;
};

export type PricingPlan = {
  productSlug: string;
  plan: "Trial" | "Monthly" | "Yearly" | "Lifetime";
  status: "available" | "quote" | "pending";
  price?: string;
  trialDays?: number;
  billingCycle?: string;
  licenseScope: string;
  supportLevel: string;
  features: string[];
};

export type SupportResource = {
  category: "faq" | "install" | "manual" | "tutorial" | "troubleshooting";
  title: string;
  description: string;
  status: "ready" | "draft" | "planned";
  href?: string;
};

export type SupportChannel = {
  type: "whatsapp" | "facebook" | "email" | "contact";
  label: string;
  responseTime: string;
  href: string;
};

export const products: Product[] = [
  {
    slug: "s4-business-thinking-inventory-software",
    name: "S4BUSINESSTHINKING",
    short: "Spare Parts Inventory Software",
    description:
      "Spare parts business-এর sales, purchase, inventory, accounts, customer, supplier এবং multi-device operation পরিচালনার জন্য একটি সম্পূর্ণ ERP সমাধান।",
    href: "/products/s4-business-thinking-inventory-software",
    accent: "accent",
    features: [
      "Core inventory: product, category, brand, model, barcode/QR",
      "Sales, purchase, quotation, invoice, return",
      "Customer ও supplier ledger",
      "Branch, warehouse, rack/bin management",
      "Profit, stock valuation ও audit report",
      "Offline-first sync, backup ও restore",
    ],
    platforms: ["Windows", "Android"],
  },
  {
    slug: "s4-family-finance-143",
    name: "S4 FAMILY FINANCE 143",
    short: "Family Finance Management Software",
    description:
      "একটি পরিবারের সকল হিসাব, লেনদেন, জমা, খরচ, ঋণ, পাওনা, সঞ্চয়, সম্পদ এবং সদস্যভিত্তিক আর্থিক নিয়ন্ত্রণের জন্য।",
    href: "/products/s4-family-finance-143",
    accent: "accent2",
    features: [
      "Family owner, member invite ও role-based permission",
      "Income, expense, savings ও double-entry accounting",
      "Cash, bank ও mobile wallet",
      "Loan, payable, receivable ও installment",
      "Member-wise ও family-wise reports",
      "Offline-first, encrypted local data ও sync",
    ],
    platforms: ["Android", "Windows"],
  },
];

export const downloadReleases: DownloadRelease[] = [
  {
    productSlug: "s4-business-thinking-inventory-software",
    platform: "Windows",
    version: "1.0.0",
    releaseDate: "Pending verification",
    status: "pending",
    fileName: "S4BUSINESSTHINKING-Inventory-Setup.exe",
  },
  {
    productSlug: "s4-business-thinking-inventory-software",
    platform: "Android",
    version: "1.0.0",
    releaseDate: "Pending verification",
    status: "pending",
    fileName: "S4BUSINESSTHINKING-Inventory.apk",
  },
  {
    productSlug: "s4-family-finance-143",
    platform: "Android",
    version: "1.0.40",
    releaseDate: "2026-09-12",
    status: "available",
    fileName: "S4-Family-Finance-143.apk",
    size: "10.2 MB",
    sha256: "376142fa5b9388d706fb2f9ed7bd1d512e195c74ea55f8b8fcb94a3fcc787fef",
    href: "/downloads/S4-Family-Finance-143.apk",
  },
  {
    productSlug: "s4-family-finance-143",
    platform: "Windows",
    version: "1.0.40",
    releaseDate: "2026-09-12",
    status: "available",
    fileName: "S4-Family-Finance-143-Setup.exe",
    size: "4.5 MB",
    sha256: "cf11ee9a525b0aadeaa6c6d3a4c435454560219db6c7b177cece110db9b8819c",
    href: "/downloads/S4-Family-Finance-143-Setup.exe",
  },
];

export const pricingPlans: PricingPlan[] = [
  {
    productSlug: "s4-business-thinking-inventory-software",
    plan: "Trial",
    status: "quote",
    trialDays: 14,
    billingCycle: "One-time trial",
    licenseScope: "1 business, limited trial devices",
    supportLevel: "Setup support included",
    features: ["All core modules", "Sample data", "Guided onboarding"],
  },
  {
    productSlug: "s4-business-thinking-inventory-software",
    plan: "Monthly",
    status: "quote",
    billingCycle: "Monthly renewal",
    licenseScope: "Business license by device/user count",
    supportLevel: "Standard support",
    features: ["Updates while active", "Backup guidance", "WhatsApp support"],
  },
  {
    productSlug: "s4-business-thinking-inventory-software",
    plan: "Yearly",
    status: "quote",
    billingCycle: "Annual renewal",
    licenseScope: "Business license by device/user count",
    supportLevel: "Priority support",
    features: ["Best value", "Priority updates", "Remote setup support"],
  },
  {
    productSlug: "s4-business-thinking-inventory-software",
    plan: "Lifetime",
    status: "quote",
    billingCycle: "One-time payment",
    licenseScope: "Lifetime license terms confirmed by invoice",
    supportLevel: "Support package quoted separately",
    features: ["Permanent use", "Device activation", "Optional paid upgrades"],
  },
  {
    productSlug: "s4-family-finance-143",
    plan: "Trial",
    status: "quote",
    trialDays: 14,
    billingCycle: "One-time trial",
    licenseScope: "1 family account, limited trial devices",
    supportLevel: "Setup support included",
    features: ["All core modules", "Sample data", "Guided onboarding"],
  },
  {
    productSlug: "s4-family-finance-143",
    plan: "Monthly",
    status: "quote",
    billingCycle: "Monthly renewal",
    licenseScope: "Family license by device/member count",
    supportLevel: "Standard support",
    features: ["Updates while active", "Backup guidance", "WhatsApp support"],
  },
  {
    productSlug: "s4-family-finance-143",
    plan: "Yearly",
    status: "quote",
    billingCycle: "Annual renewal",
    licenseScope: "Family license by device/member count",
    supportLevel: "Priority support",
    features: ["Best value", "Priority updates", "Remote setup support"],
  },
  {
    productSlug: "s4-family-finance-143",
    plan: "Lifetime",
    status: "quote",
    billingCycle: "One-time payment",
    licenseScope: "Lifetime license terms confirmed by invoice",
    supportLevel: "Support package quoted separately",
    features: ["Permanent use", "Device activation", "Optional paid upgrades"],
  },
];

export const supportResources: SupportResource[] = [
  {
    category: "faq",
    title: "Frequently asked questions",
    description: "Common answers about accounts, purchase requests, downloads, licenses and support tickets.",
    status: "ready",
  },
  {
    category: "install",
    title: "Installation guide",
    description: "Official Windows and Android installation checklist with safe download guidance.",
    status: "ready",
  },
  {
    category: "manual",
    title: "User manual",
    description: "Workflow guide for inventory, family finance, backup, reports and account management.",
    status: "ready",
  },
  {
    category: "tutorial",
    title: "Video tutorials",
    description: "Checklist-based tutorial path for setup, backup, reports and license activation.",
    status: "ready",
  },
  {
    category: "troubleshooting",
    title: "Troubleshooting",
    description: "Known issue checklist for login, install, activation, sync and backup problems.",
    status: "ready",
  },
];

export const supportChannels: SupportChannel[] = [
  {
    type: "whatsapp",
    label: "WhatsApp support",
    responseTime: "Fastest response during business hours",
    href: site.contact.whatsappUrl,
  },
  {
    type: "email",
    label: "Email support",
    responseTime: "Best for invoices, licenses and formal requests",
    href: site.contact.emailUrl,
  },
  {
    type: "facebook",
    label: "Facebook page",
    responseTime: "Use for public updates and announcements",
    href: site.contact.facebookUrl,
  },
  {
    type: "contact",
    label: "Contact form",
    responseTime: "Sends a structured message through WhatsApp",
    href: "/contact",
  },
];

type ProductText = Pick<Product, "short" | "description" | "features">;
type ProductTextMap = Record<Lang, Record<string, ProductText>>;

const productText: ProductTextMap = {
  en: {
    "s4-business-thinking-inventory-software": {
      short: "Spare Parts Inventory Software",
      description:
        "A complete ERP solution for spare parts sales, purchase, inventory, accounts, customers, suppliers and multi-device operations.",
      features: [
        "Core inventory: product, category, brand, model, barcode/QR",
        "Sales, purchase, quotation, invoice and return",
        "Customer and supplier ledger",
        "Branch, warehouse and rack/bin management",
        "Profit, stock valuation and audit reports",
        "Offline-first sync, backup and restore",
      ],
    },
    "s4-family-finance-143": {
      short: "Family Finance Management Software",
      description:
        "Manage household accounts, transactions, income, expenses, loans, receivables, savings, assets and member-wise financial control.",
      features: [
        "Family owner, member invite and role-based permission",
        "Income, expense, savings and double-entry accounting",
        "Cash, bank and mobile wallet tracking",
        "Loan, payable, receivable and installment management",
        "Member-wise and family-wise reports",
        "Offline-first encrypted local data and sync",
      ],
    },
  },
  bn: {
    "s4-business-thinking-inventory-software": {
      short: "Spare Parts Inventory Software",
      description:
        "স্পেয়ার পার্টস ব্যবসার বিক্রি, ক্রয়, মজুত, হিসাব, কাস্টমার, সরবরাহকারী ও একাধিক ডিভাইস পরিচালনার জন্য সম্পূর্ণ ERP সমাধান।",
      features: [
        "পণ্য, ধরন, ব্র্যান্ড, মডেল ও বারকোড/QR মজুত ব্যবস্থা",
        "বিক্রি, ক্রয়, কোটেশন, চালান ও ফেরত",
        "কাস্টমার ও সরবরাহকারীর খতিয়ান",
        "শাখা, গুদাম ও র্যাক/বিন ব্যবস্থাপনা",
        "লাভ, মজুত মূল্যায়ন ও অডিট রিপোর্ট",
        "অফলাইন ব্যবহারের সুবিধা, সিঙ্ক, ব্যাকআপ ও পুনরুদ্ধার",
      ],
    },
    "s4-family-finance-143": {
      short: "Family Finance Management Software",
      description:
        "পরিবারের হিসাব, লেনদেন, জমা, খরচ, ঋণ, পাওনা, সঞ্চয়, সম্পদ এবং সদস্যভিত্তিক আর্থিক নিয়ন্ত্রণের জন্য।",
      features: [
        "পরিবারের মালিক, সদস্য আমন্ত্রণ ও ভূমিকা অনুযায়ী অনুমতি",
        "আয়, খরচ, সঞ্চয় ও ডাবল-এন্ট্রি হিসাব",
        "নগদ, ব্যাংক ও মোবাইল ওয়ালেট ট্র্যাকিং",
        "ঋণ, পাওনা, দেনা ও কিস্তি ব্যবস্থাপনা",
        "সদস্যভিত্তিক ও পরিবারভিত্তিক রিপোর্ট",
        "অফলাইন ব্যবহারের সুবিধা, এনক্রিপ্টেড লোকাল ডেটা ও সিঙ্ক",
      ],
    },
  },
  hi: {
    "s4-business-thinking-inventory-software": {
      short: "स्पेयर पार्ट्स इन्वेंटरी सॉफ़्टवेयर",
      description:
        "स्पेयर पार्ट्स बिक्री, खरीद, इन्वेंटरी, खाते, ग्राहक, सप्लायर और multi-device operation के लिए संपूर्ण ERP समाधान।",
      features: [
        "मुख्य इन्वेंटरी: product, category, brand, model, barcode/QR",
        "Sales, purchase, quotation, invoice और return",
        "Customer और supplier ledger",
        "Branch, warehouse और rack/bin management",
        "Profit, stock valuation और audit report",
        "Offline-first sync, backup और restore",
      ],
    },
    "s4-family-finance-143": {
      short: "फैमिली फाइनेंस मैनेजमेंट सॉफ़्टवेयर",
      description:
        "परिवार के खाते, लेन-देन, आय, खर्च, ऋण, प्राप्य, बचत, संपत्ति और member-wise financial control के लिए।",
      features: [
        "Family owner, member invite और role-based permission",
        "Income, expense, savings और double-entry accounting",
        "Cash, bank और mobile wallet tracking",
        "Loan, payable, receivable और installment management",
        "Member-wise और family-wise reports",
        "Offline-first encrypted local data और sync",
      ],
    },
  },
  ur: {
    "s4-business-thinking-inventory-software": {
      short: "اسپیئر پارٹس انوینٹری سافٹ ویئر",
      description:
        "اسپیئر پارٹس sales, purchase, inventory, accounts, customers, suppliers اور multi-device operation کے لیے مکمل ERP حل۔",
      features: [
        "Core inventory: product, category, brand, model, barcode/QR",
        "Sales, purchase, quotation, invoice اور return",
        "Customer اور supplier ledger",
        "Branch, warehouse اور rack/bin management",
        "Profit, stock valuation اور audit report",
        "Offline-first sync, backup اور restore",
      ],
    },
    "s4-family-finance-143": {
      short: "فیملی فنانس مینجمنٹ سافٹ ویئر",
      description:
        "خاندانی accounts, transactions, income, expenses, loans, receivables, savings, assets اور member-wise financial control کے لیے۔",
      features: [
        "Family owner, member invite اور role-based permission",
        "Income, expense, savings اور double-entry accounting",
        "Cash, bank اور mobile wallet tracking",
        "Loan, payable, receivable اور installment management",
        "Member-wise اور family-wise reports",
        "Offline-first encrypted local data اور sync",
      ],
    },
  },
  ar: {
    "s4-business-thinking-inventory-software": {
      short: "برنامج مخزون قطع الغيار",
      description:
        "حل ERP كامل لإدارة مبيعات ومشتريات ومخزون وحسابات وعملاء وموردين وتشغيل متعدد الأجهزة لقطع الغيار.",
      features: [
        "المخزون الأساسي: المنتج والفئة والعلامة والطراز والباركود/QR",
        "المبيعات والمشتريات والعروض والفواتير والمرتجعات",
        "دفاتر العملاء والموردين",
        "إدارة الفروع والمستودعات والرفوف",
        "تقارير الربح وتقييم المخزون والتدقيق",
        "مزامنة ونسخ احتياطي واستعادة بنمط offline-first",
      ],
    },
    "s4-family-finance-143": {
      short: "برنامج إدارة مالية الأسرة",
      description:
        "لإدارة حسابات الأسرة والمعاملات والدخل والمصروفات والقروض والمستحقات والمدخرات والأصول والتحكم المالي حسب العضو.",
      features: [
        "مالك الأسرة ودعوة الأعضاء وصلاحيات حسب الدور",
        "الدخل والمصروفات والمدخرات والمحاسبة المزدوجة",
        "تتبع النقد والبنك والمحافظ الإلكترونية",
        "إدارة القروض والدائنين والمدينين والأقساط",
        "تقارير حسب العضو وحسب الأسرة",
        "بيانات محلية مشفرة ومزامنة بنمط offline-first",
      ],
    },
  },
};

export function localizedProducts(lang: Lang): Product[] {
  const copy = productText[lang] ?? productText.en;
  return products.map((product) => ({
    ...product,
    ...(copy[product.slug] ?? productText.en[product.slug]),
  }));
}

const pricingCopy: Record<Lang, Record<PricingPlan["plan"], Pick<PricingPlan, "billingCycle" | "supportLevel" | "features">>> = {
  en: {
    Trial: { billingCycle: "One-time trial", supportLevel: "Setup support included", features: ["All core modules", "Sample data", "Guided onboarding"] },
    Monthly: { billingCycle: "Monthly renewal", supportLevel: "Standard support", features: ["Updates while active", "Backup guidance", "WhatsApp support"] },
    Yearly: { billingCycle: "Annual renewal", supportLevel: "Priority support", features: ["Best value", "Priority updates", "Remote setup support"] },
    Lifetime: { billingCycle: "One-time payment", supportLevel: "Support package quoted separately", features: ["Permanent use", "Device activation", "Optional paid upgrades"] },
  },
  bn: {
    Trial: { billingCycle: "একবারের ট্রায়াল", supportLevel: "সেটআপ সহায়তা অন্তর্ভুক্ত", features: ["সব মূল মডিউল", "নমুনা ডেটা", "শুরু করার নির্দেশনা"] },
    Monthly: { billingCycle: "মাসিক নবায়ন", supportLevel: "স্ট্যান্ডার্ড সহায়তা", features: ["সক্রিয় থাকলে আপডেট", "ব্যাকআপ নির্দেশনা", "WhatsApp সহায়তা"] },
    Yearly: { billingCycle: "বার্ষিক নবায়ন", supportLevel: "অগ্রাধিকার সহায়তা", features: ["সেরা মূল্যমান", "অগ্রাধিকার আপডেট", "রিমোট সেটআপ সহায়তা"] },
    Lifetime: { billingCycle: "এককালীন পেমেন্ট", supportLevel: "সহায়তা প্যাকেজ আলাদা মূল্যায়ন", features: ["স্থায়ী ব্যবহার", "ডিভাইস সক্রিয়করণ", "ঐচ্ছিক পেইড আপগ্রেড"] },
  },
  hi: {
    Trial: { billingCycle: "एक बार का trial", supportLevel: "Setup support शामिल", features: ["सभी core modules", "Sample data", "Guided onboarding"] },
    Monthly: { billingCycle: "Monthly renewal", supportLevel: "Standard support", features: ["Active रहने तक updates", "Backup guidance", "WhatsApp support"] },
    Yearly: { billingCycle: "Annual renewal", supportLevel: "Priority support", features: ["Best value", "Priority updates", "Remote setup support"] },
    Lifetime: { billingCycle: "One-time payment", supportLevel: "Support package अलग quote होगा", features: ["Permanent use", "Device activation", "Optional paid upgrades"] },
  },
  ur: {
    Trial: { billingCycle: "ایک بار کا trial", supportLevel: "Setup support شامل", features: ["تمام core modules", "Sample data", "Guided onboarding"] },
    Monthly: { billingCycle: "Monthly renewal", supportLevel: "Standard support", features: ["Active ہونے پر updates", "Backup guidance", "WhatsApp support"] },
    Yearly: { billingCycle: "Annual renewal", supportLevel: "Priority support", features: ["Best value", "Priority updates", "Remote setup support"] },
    Lifetime: { billingCycle: "One-time payment", supportLevel: "Support package الگ quote ہوگا", features: ["Permanent use", "Device activation", "Optional paid upgrades"] },
  },
  ar: {
    Trial: { billingCycle: "تجربة لمرة واحدة", supportLevel: "دعم الإعداد مشمول", features: ["كل الوحدات الأساسية", "بيانات تجريبية", "إرشاد عند البدء"] },
    Monthly: { billingCycle: "تجديد شهري", supportLevel: "دعم قياسي", features: ["تحديثات أثناء النشاط", "إرشاد النسخ الاحتياطي", "دعم WhatsApp"] },
    Yearly: { billingCycle: "تجديد سنوي", supportLevel: "دعم أولوية", features: ["أفضل قيمة", "تحديثات أولوية", "دعم إعداد عن بعد"] },
    Lifetime: { billingCycle: "دفعة لمرة واحدة", supportLevel: "حزمة الدعم تعرض بشكل منفصل", features: ["استخدام دائم", "تفعيل الجهاز", "ترقيات مدفوعة اختيارية"] },
  },
};

export function localizedPricingPlans(lang: Lang): PricingPlan[] {
  const copy = pricingCopy[lang] ?? pricingCopy.en;
  return pricingPlans.map((plan) => ({
    ...plan,
    ...copy[plan.plan],
    licenseScope: plan.productSlug === "s4-family-finance-143"
      ? {
          en: "Family license by device/member count",
          bn: "Device/member count অনুযায়ী family license",
          hi: "Device/member count के अनुसार family license",
          ur: "Device/member count کے مطابق family license",
          ar: "ترخيص أسرة حسب عدد الأجهزة/الأعضاء",
        }[lang]
      : {
          en: "Business license by device/user count",
          bn: "Device/user count অনুযায়ী business license",
          hi: "Device/user count के अनुसार business license",
          ur: "Device/user count کے مطابق business license",
          ar: "ترخيص عمل حسب عدد الأجهزة/المستخدمين",
        }[lang],
  }));
}

const supportResourceCopy: Record<Lang, Record<SupportResource["category"], Pick<SupportResource, "title" | "description">>> = {
  en: {
    faq: { title: "Frequently asked questions", description: "Common answers about download, license, login and support." },
    install: { title: "Installation guide", description: "Step-by-step Windows and Android installation checklist." },
    manual: { title: "User manual", description: "Product usage guide for inventory and family finance workflows." },
    tutorial: { title: "Video tutorials", description: "Short videos for setup, backup, reports and license activation." },
    troubleshooting: { title: "Troubleshooting", description: "Known issue checklist for login, install, sync and backup problems." },
  },
  bn: {
    faq: { title: "সাধারণ প্রশ্ন", description: "ডাউনলোড, লাইসেন্স, লগইন ও সহায়তা সম্পর্কে সাধারণ উত্তর।" },
    install: { title: "ইনস্টলেশন গাইড", description: "Windows ও Android ইনস্টলেশনের ধাপে ধাপে চেকলিস্ট।" },
    manual: { title: "ব্যবহার নির্দেশিকা", description: "মজুত ও পারিবারিক অর্থ ব্যবস্থাপনার ব্যবহার নির্দেশিকা।" },
    tutorial: { title: "ভিডিও টিউটোরিয়াল", description: "সেটআপ, ব্যাকআপ, রিপোর্ট ও লাইসেন্স সক্রিয়করণের ছোট ভিডিও।" },
    troubleshooting: { title: "সমস্যা সমাধান", description: "লগইন, ইনস্টল, সিঙ্ক ও ব্যাকআপ সমস্যার চেকলিস্ট।" },
  },
  hi: {
    faq: { title: "अक्सर पूछे जाने वाले प्रश्न", description: "Download, license, login और support के सामान्य उत्तर।" },
    install: { title: "Installation guide", description: "Windows और Android installation checklist step-by-step।" },
    manual: { title: "User manual", description: "Inventory और family finance workflows के लिए product usage guide।" },
    tutorial: { title: "Video tutorials", description: "Setup, backup, reports और license activation के छोटे videos।" },
    troubleshooting: { title: "Troubleshooting", description: "Login, install, sync और backup problems की known issue checklist।" },
  },
  ur: {
    faq: { title: "اکثر پوچھے گئے سوالات", description: "Download, license, login اور support کے عام جوابات۔" },
    install: { title: "Installation guide", description: "Windows اور Android installation checklist step-by-step۔" },
    manual: { title: "User manual", description: "Inventory اور family finance workflows کے لیے product usage guide۔" },
    tutorial: { title: "Video tutorials", description: "Setup, backup, reports اور license activation کی مختصر videos۔" },
    troubleshooting: { title: "Troubleshooting", description: "Login, install, sync اور backup problems کی known issue checklist۔" },
  },
  ar: {
    faq: { title: "الأسئلة الشائعة", description: "إجابات شائعة حول التنزيل والترخيص وتسجيل الدخول والدعم." },
    install: { title: "دليل التثبيت", description: "قائمة تثبيت Windows وAndroid خطوة بخطوة." },
    manual: { title: "دليل المستخدم", description: "دليل استخدام المنتج لعمليات المخزون وإدارة مالية الأسرة." },
    tutorial: { title: "دروس فيديو", description: "فيديوهات قصيرة للإعداد والنسخ الاحتياطي والتقارير وتفعيل الترخيص." },
    troubleshooting: { title: "استكشاف الأخطاء", description: "قائمة مشاكل معروفة لتسجيل الدخول والتثبيت والمزامنة والنسخ الاحتياطي." },
  },
};

export function localizedSupportResources(lang: Lang): SupportResource[] {
  const copy = supportResourceCopy[lang] ?? supportResourceCopy.en;
  return supportResources.map((resource) => ({
    ...resource,
    ...copy[resource.category],
  }));
}

const supportChannelCopy: Record<Lang, Record<SupportChannel["type"], Pick<SupportChannel, "label" | "responseTime">>> = {
  en: {
    whatsapp: { label: "WhatsApp support", responseTime: "Fastest response during business hours" },
    email: { label: "Email support", responseTime: "Best for invoices, licenses and formal requests" },
    facebook: { label: "Facebook page", responseTime: "Use for public updates and announcements" },
    contact: { label: "Contact form", responseTime: "Sends a structured message through WhatsApp" },
  },
  bn: {
    whatsapp: { label: "WhatsApp support", responseTime: "কর্মঘণ্টায় দ্রুততম response" },
    email: { label: "Email support", responseTime: "Invoice, license ও formal request-এর জন্য ভালো" },
    facebook: { label: "Facebook page", responseTime: "Public update ও announcement-এর জন্য" },
    contact: { label: "Contact form", responseTime: "WhatsApp-এ structured message পাঠায়" },
  },
  hi: {
    whatsapp: { label: "WhatsApp support", responseTime: "Business hours में सबसे तेज़ response" },
    email: { label: "Email support", responseTime: "Invoices, licenses और formal requests के लिए बेहतर" },
    facebook: { label: "Facebook page", responseTime: "Public updates और announcements के लिए" },
    contact: { label: "Contact form", responseTime: "WhatsApp पर structured message भेजता है" },
  },
  ur: {
    whatsapp: { label: "WhatsApp support", responseTime: "Business hours میں تیز ترین response" },
    email: { label: "Email support", responseTime: "Invoices, licenses اور formal requests کے لیے بہتر" },
    facebook: { label: "Facebook page", responseTime: "Public updates اور announcements کے لیے" },
    contact: { label: "Contact form", responseTime: "WhatsApp پر structured message بھیجتا ہے" },
  },
  ar: {
    whatsapp: { label: "دعم WhatsApp", responseTime: "أسرع رد أثناء ساعات العمل" },
    email: { label: "دعم البريد", responseTime: "أفضل للفواتير والتراخيص والطلبات الرسمية" },
    facebook: { label: "صفحة Facebook", responseTime: "للتحديثات والإعلانات العامة" },
    contact: { label: "نموذج التواصل", responseTime: "يرسل رسالة منظمة عبر WhatsApp" },
  },
};

export function localizedSupportChannels(lang: Lang): SupportChannel[] {
  const copy = supportChannelCopy[lang] ?? supportChannelCopy.en;
  return supportChannels.map((channel) => ({
    ...channel,
    ...copy[channel.type],
  }));
}
