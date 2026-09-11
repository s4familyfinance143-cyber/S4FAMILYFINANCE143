// Internationalization: 5 languages — English, Bangla, Hindi, Urdu, Arabic.
// Arabic and Urdu are right-to-left (RTL).

export type Lang = "en" | "bn" | "hi" | "ur" | "ar";

export const DEFAULT_LANG: Lang = "bn";

export const languages: { code: Lang; label: string; native: string; dir: "ltr" | "rtl" }[] = [
  { code: "en", label: "English", native: "English", dir: "ltr" },
  { code: "bn", label: "Bangla", native: "বাংলা", dir: "ltr" },
  { code: "hi", label: "Hindi", native: "हिन्दी", dir: "ltr" },
  { code: "ur", label: "Urdu", native: "اردو", dir: "rtl" },
  { code: "ar", label: "Arabic", native: "العربية", dir: "rtl" },
];

export function dirFor(lang: Lang): "ltr" | "rtl" {
  return lang === "ar" || lang === "ur" ? "rtl" : "ltr";
}

const en = {
  navHome: "Home",
  navProducts: "Products",
  navPricing: "Pricing",
  navDownloads: "Downloads",
  navDocs: "Docs",
  navTutorials: "Tutorials",
  navSupport: "Support",
  navContact: "Contact",
  navUpdates: "Updates",
  navAbout: "About Us",

  login: "Customer Login",
  download: "Download",
  toggleMenu: "Menu",
  chooseLanguage: "Language",
  close: "Close",

  marquee:
    "Welcome to S4BUSINESSTHINKING.COM — Official software for Spare Parts Inventory & Family Finance • Download • License • Support • WhatsApp +880 1860-531723",

  welcomeTitle: "Welcome!",
  welcomeText:
    "Thank you for visiting the official home of S4BUSINESSTHINKING. Explore our two powerful software and manage your business and family finances with confidence and security.",
  welcomeQuote: "One brand. Two software. Complete peace of mind.",
  welcomeEnter: "Enter Website",

  heroBadge: "OFFICIAL SOFTWARE WEBSITE",
  heroTitle: "Two software, one trusted platform",
  heroSubtitle:
    "Under one brand, two production-grade software — Spare Parts Inventory and Family Finance Management.",
  ctaDownloadNow: "Download Now",
  ctaViewPricing: "View Pricing",
  ctaWhatsApp: "WhatsApp Support",

  productsHeading: "Our Software",
  productsSub:
    "Two separate products under one brand. Each has its own download, license and support.",
  viewSoftware: "View Software",
  allSoftware: "All Software",
  pdOverview: "Overview",
  pdFeatures: "Features",
  pdAvailableOn: "Available on",
  pdBuyLicense: "Buy License",
  pdDocumentation: "Documentation",

  prodInventoryShort: "Spare Parts Inventory Software",
  prodInventoryDesc:
    "A complete ERP solution to manage sales, purchase, inventory, accounts, customers, suppliers and multi-device operation for a spare parts business.",
  prodFinanceShort: "Family Finance Management Software",
  prodFinanceDesc:
    "Manage a family's accounts, transactions, deposits, expenses, loans, receivables, savings, assets and member-wise financial control.",

  benefitsHeading: "Why S4BUSINESSTHINKING?",
  bOfflineTitle: "Offline-First",
  bOfflineDesc:
    "Works without internet. Even if the website is down, installed software keeps running.",
  bSecureTitle: "Secure by Design",
  bSecureDesc:
    "Encrypted data, signed license, audit logs and a production-grade security protocol.",
  bFastTitle: "Fast",
  bFastDesc:
    "Optimized performance, quick load and mobile-first responsive design.",
  bScalableTitle: "Scalable",
  bScalableDesc:
    "Branch, warehouse, member and device — as your business grows, the software grows.",

  ctaTitle: "Get started now",
  ctaText:
    "Download the software, watch a demo, or contact us directly on WhatsApp.",
  ctaDownloadCenter: "Download Center",
  ctaRequestDemo: "Request Demo",
  ctaGetSupport: "Get Support",

  footerTagline:
    "Official software website for spare parts inventory and family finance management.",
  footerSoftware: "Software",
  footerContact: "Contact",
  footerLegal: "Legal",
  footerSupportCenter: "Support Center",
  footerDownloadCenter: "Download Center",
  legalPrivacy: "Privacy Policy",
  legalTerms: "Terms & Conditions",
  legalRefund: "Refund Policy",
  legalEula: "License Agreement (EULA)",
  legalCookie: "Cookie Policy",
  legalSecurity: "Security Policy",
  legalAcceptableUse: "Acceptable Use Policy",
  footerRights: "All rights reserved.",
  footerOfficial: "Official domain notice",
};

export type Dict = typeof en;

const bn: Dict = {
  navHome: "হোম",
  navProducts: "পণ্য",
  navPricing: "মূল্য",
  navDownloads: "ডাউনলোড",
  navDocs: "ডকস",
  navTutorials: "টিউটোরিয়াল",
  navSupport: "সাপোর্ট",
  navContact: "যোগাযোগ",
  navUpdates: "আপডেট",
  navAbout: "আমাদের সম্পর্কে",

  login: "কাস্টমার লগইন",
  download: "ডাউনলোড",
  toggleMenu: "মেনু",
  chooseLanguage: "ভাষা",
  close: "বন্ধ করুন",

  marquee:
    "S4BUSINESSTHINKING.COM-এ স্বাগতম — Spare Parts Inventory ও Family Finance-এর official software • Download • License • Support • WhatsApp +880 1860-531723",

  welcomeTitle: "স্বাগতম!",
  welcomeText:
    "S4BUSINESSTHINKING-এর official website-এ আপনাকে সাদর সংবর্ধনা। আমাদের দুইটি শক্তিশালী software দিয়ে আপনার ব্যবসা ও পারিবারিক হিসাব নিশ্চিন্তে ও নিরাপদে পরিচালনা করুন।",
  welcomeQuote: "একটি brand। দুইটি software। সম্পূর্ণ নিশ্চিন্ততা।",
  welcomeEnter: "ওয়েবসাইটে প্রবেশ করুন",

  heroBadge: "অফিসিয়াল সফটওয়্যার ওয়েবসাইট",
  heroTitle: "দুইটি software, একটি বিশ্বস্ত platform",
  heroSubtitle:
    "একই brand-এর অধীনে দুইটি production-grade software — Spare Parts Inventory ও Family Finance Management।",
  ctaDownloadNow: "এখনই ডাউনলোড",
  ctaViewPricing: "মূল্য দেখুন",
  ctaWhatsApp: "হোয়াটসঅ্যাপ সাপোর্ট",

  productsHeading: "আমাদের Software",
  productsSub:
    "একই brand-এর অধীনে দুইটি আলাদা product। প্রতিটির আলাদা download, license ও support।",
  viewSoftware: "Software দেখুন",
  allSoftware: "সব Software",
  pdOverview: "সংক্ষিপ্ত বিবরণ",
  pdFeatures: "ফিচারসমূহ",
  pdAvailableOn: "যেসব প্ল্যাটফর্মে",
  pdBuyLicense: "লাইসেন্স কিনুন",
  pdDocumentation: "ডকুমেন্টেশন",

  prodInventoryShort: "Spare Parts Inventory Software",
  prodInventoryDesc:
    "Spare parts business-এর sales, purchase, inventory, accounts, customer, supplier এবং multi-device operation পরিচালনার জন্য একটি সম্পূর্ণ ERP সমাধান।",
  prodFinanceShort: "Family Finance Management Software",
  prodFinanceDesc:
    "একটি পরিবারের সকল হিসাব, লেনদেন, জমা, খরচ, ঋণ, পাওনা, সঞ্চয়, সম্পদ এবং সদস্যভিত্তিক আর্থিক নিয়ন্ত্রণের জন্য।",

  benefitsHeading: "কেন S4BUSINESSTHINKING?",
  bOfflineTitle: "অফলাইন-ফার্স্ট",
  bOfflineDesc:
    "Internet না থাকলেও software চলবে। Website বন্ধ হলেও installed software থামবে না।",
  bSecureTitle: "সিকিউর বাই ডিজাইন",
  bSecureDesc:
    "Encrypted data, signed license, audit log ও production-grade security protocol।",
  bFastTitle: "দ্রুত",
  bFastDesc:
    "Optimized performance, দ্রুত load এবং mobile-first responsive design।",
  bScalableTitle: "স্কেলেবল",
  bScalableDesc:
    "Branch, warehouse, member ও device — ব্যবসা বাড়লে software বাড়বে।",

  ctaTitle: "এখনই শুরু করুন",
  ctaText:
    "Software download করুন, demo দেখুন অথবা আমাদের সাথে সরাসরি WhatsApp-এ যোগাযোগ করুন।",
  ctaDownloadCenter: "ডাউনলোড সেন্টার",
  ctaRequestDemo: "ডেমো রিকোয়েস্ট",
  ctaGetSupport: "সাপোর্ট নিন",

  footerTagline:
    "Spare parts inventory ও family finance management-এর official software website।",
  footerSoftware: "সফটওয়্যার",
  footerContact: "যোগাযোগ",
  footerLegal: "আইনি",
  footerSupportCenter: "সাপোর্ট সেন্টার",
  footerDownloadCenter: "ডাউনলোড সেন্টার",
  legalPrivacy: "প্রাইভেসি পলিসি",
  legalTerms: "শর্তাবলী",
  legalRefund: "রিফান্ড পলিসি",
  legalEula: "লাইসেন্স চুক্তি (EULA)",
  legalCookie: "কুকি পলিসি",
  legalSecurity: "সিকিউরিটি পলিসি",
  legalAcceptableUse: "গ্রহণযোগ্য ব্যবহার নীতি",
  footerRights: "সর্বস্বত্ব সংরক্ষিত।",
  footerOfficial: "অফিসিয়াল ডোমেইন",
};

const hi: Dict = {
  navHome: "होम",
  navProducts: "उत्पाद",
  navPricing: "मूल्य",
  navDownloads: "डाउनलोड",
  navDocs: "डॉक्स",
  navTutorials: "ट्यूटोरियल",
  navSupport: "सपोर्ट",
  navContact: "संपर्क",
  navUpdates: "अपडेट",
  navAbout: "हमारे बारे में",

  login: "ग्राहक लॉगिन",
  download: "डाउनलोड",
  toggleMenu: "मेन्यू",
  chooseLanguage: "भाषा",
  close: "बंद करें",

  marquee:
    "S4BUSINESSTHINKING.COM में आपका स्वागत है — स्पेयर पार्ट्स इन्वेंटरी और फैमिली फाइनेंस का आधिकारिक सॉफ़्टवेयर • डाउनलोड • लाइसेंस • सपोर्ट • WhatsApp +880 1860-531723",

  welcomeTitle: "स्वागत है!",
  welcomeText:
    "S4BUSINESSTHINKING की आधिकारिक वेबसाइट पर आपका हार्दिक स्वागत है। हमारे दो शक्तिशाली सॉफ़्टवेयर के साथ अपने व्यवसाय और पारिवारिक वित्त को आत्मविश्वास और सुरक्षा के साथ प्रबंधित करें।",
  welcomeQuote: "एक ब्रांड। दो सॉफ़्टवेयर। पूर्ण निश्चिंतता।",
  welcomeEnter: "वेबसाइट में प्रवेश करें",

  heroBadge: "आधिकारिक सॉफ़्टवेयर वेबसाइट",
  heroTitle: "दो सॉफ़्टवेयर, एक भरोसेमंद प्लेटफ़ॉर्म",
  heroSubtitle:
    "एक ही ब्रांड के तहत दो प्रोडक्शन-ग्रेड सॉफ़्टवेयर — स्पेयर पार्ट्स इन्वेंटरी और फैमिली फाइनेंस मैनेजमेंट।",
  ctaDownloadNow: "अभी डाउनलोड करें",
  ctaViewPricing: "मूल्य देखें",
  ctaWhatsApp: "व्हाट्सएप सपोर्ट",

  productsHeading: "हमारे सॉफ़्टवेयर",
  productsSub:
    "एक ब्रांड के तहत दो अलग उत्पाद। प्रत्येक का अपना डाउनलोड, लाइसेंस और सपोर्ट।",
  viewSoftware: "सॉफ़्टवेयर देखें",
  allSoftware: "सभी सॉफ़्टवेयर",
  pdOverview: "अवलोकन",
  pdFeatures: "विशेषताएँ",
  pdAvailableOn: "इन पर उपलब्ध",
  pdBuyLicense: "लाइसेंस खरीदें",
  pdDocumentation: "दस्तावेज़",

  prodInventoryShort: "स्पेयर पार्ट्स इन्वेंटरी सॉफ़्टवेयर",
  prodInventoryDesc:
    "स्पेयर पार्ट्स व्यवसाय के लिए बिक्री, खरीद, इन्वेंटरी, खाते, ग्राहक, आपूर्तिकर्ता और मल्टी-डिवाइस संचालन के प्रबंधन हेतु एक संपूर्ण ERP समाधान।",
  prodFinanceShort: "फैमिली फाइनेंस मैनेजमेंट सॉफ़्टवेयर",
  prodFinanceDesc:
    "एक परिवार के सभी खाते, लेन-देन, जमा, खर्च, ऋण, प्राप्य, बचत, संपत्ति और सदस्य-वार वित्तीय नियंत्रण के लिए।",

  benefitsHeading: "S4BUSINESSTHINKING क्यों?",
  bOfflineTitle: "ऑफ़लाइन-फर्स्ट",
  bOfflineDesc:
    "इंटरनेट के बिना काम करता है। वेबसाइट बंद होने पर भी इंस्टॉल किया गया सॉफ़्टवेयर चलता रहता है।",
  bSecureTitle: "डिज़ाइन से सुरक्षित",
  bSecureDesc:
    "एन्क्रिप्टेड डेटा, साइन किया गया लाइसेंस, ऑडिट लॉग और प्रोडक्शन-ग्रेड सुरक्षा प्रोटोकॉल।",
  bFastTitle: "तेज़",
  bFastDesc:
    "अनुकूलित प्रदर्शन, तेज़ लोड और मोबाइल-फर्स्ट रिस्पॉन्सिव डिज़ाइन।",
  bScalableTitle: "स्केलेबल",
  bScalableDesc:
    "शाखा, गोदाम, सदस्य और डिवाइस — जैसे-जैसे आपका व्यवसाय बढ़ता है, सॉफ़्टवेयर बढ़ता है।",

  ctaTitle: "अभी शुरू करें",
  ctaText:
    "सॉफ़्टवेयर डाउनलोड करें, डेमो देखें, या सीधे व्हाट्सएप पर हमसे संपर्क करें।",
  ctaDownloadCenter: "डाउनलोड सेंटर",
  ctaRequestDemo: "डेमो का अनुरोध",
  ctaGetSupport: "सपोर्ट प्राप्त करें",

  footerTagline:
    "स्पेयर पार्ट्स इन्वेंटरी और फैमिली फाइनेंस मैनेजमेंट के लिए आधिकारिक सॉफ़्टवेयर वेबसाइट।",
  footerSoftware: "सॉफ़्टवेयर",
  footerContact: "संपर्क",
  footerLegal: "कानूनी",
  footerSupportCenter: "सपोर्ट सेंटर",
  footerDownloadCenter: "डाउनलोड सेंटर",
  legalPrivacy: "गोपनीयता नीति",
  legalTerms: "नियम एवं शर्तें",
  legalRefund: "रिफंड नीति",
  legalEula: "लाइसेंस अनुबंध (EULA)",
  legalCookie: "कुकी नीति",
  legalSecurity: "सुरक्षा नीति",
  legalAcceptableUse: "स्वीकार्य उपयोग नीति",
  footerRights: "सर्वाधिकार सुरक्षित।",
  footerOfficial: "आधिकारिक डोमेन",
};

const ur: Dict = {
  navHome: "ہوم",
  navProducts: "پروڈکٹس",
  navPricing: "قیمتیں",
  navDownloads: "ڈاؤن لوڈ",
  navDocs: "دستاویزات",
  navTutorials: "ٹیوٹوریلز",
  navSupport: "سپورٹ",
  navContact: "رابطہ",
  navUpdates: "اپڈیٹس",
  navAbout: "ہمارے بارے میں",

  login: "کسٹمر لاگ اِن",
  download: "ڈاؤن لوڈ",
  toggleMenu: "مینو",
  chooseLanguage: "زبان",
  close: "بند کریں",

  marquee:
    "S4BUSINESSTHINKING.COM میں خوش آمدید — اسپیئر پارٹس انوینٹری اور فیملی فنانس کا آفیشل سافٹ ویئر • ڈاؤن لوڈ • لائسنس • سپورٹ • WhatsApp +880 1860-531723",

  welcomeTitle: "خوش آمدید!",
  welcomeText:
    "S4BUSINESSTHINKING کی آفیشل ویب سائٹ پر آپ کا پُرتپاک استقبال ہے۔ ہمارے دو طاقتور سافٹ ویئر کے ساتھ اپنے کاروبار اور خاندانی مالیات کو اعتماد اور تحفظ کے ساتھ سنبھالیں۔",
  welcomeQuote: "ایک برانڈ۔ دو سافٹ ویئر۔ مکمل اطمینان۔",
  welcomeEnter: "ویب سائٹ میں داخل ہوں",

  heroBadge: "آفیشل سافٹ ویئر ویب سائٹ",
  heroTitle: "دو سافٹ ویئر، ایک قابلِ اعتماد پلیٹ فارم",
  heroSubtitle:
    "ایک ہی برانڈ کے تحت دو پروڈکشن گریڈ سافٹ ویئر — اسپیئر پارٹس انوینٹری اور فیملی فنانس مینجمنٹ۔",
  ctaDownloadNow: "ابھی ڈاؤن لوڈ کریں",
  ctaViewPricing: "قیمت دیکھیں",
  ctaWhatsApp: "واٹس ایپ سپورٹ",

  productsHeading: "ہمارے سافٹ ویئر",
  productsSub:
    "ایک برانڈ کے تحت دو الگ پروڈکٹس۔ ہر ایک کا اپنا ڈاؤن لوڈ، لائسنس اور سپورٹ۔",
  viewSoftware: "سافٹ ویئر دیکھیں",
  allSoftware: "تمام سافٹ ویئر",
  pdOverview: "جائزہ",
  pdFeatures: "خصوصیات",
  pdAvailableOn: "دستیاب پلیٹ فارمز",
  pdBuyLicense: "لائسنس خریدیں",
  pdDocumentation: "دستاویزات",

  prodInventoryShort: "اسپیئر پارٹس انوینٹری سافٹ ویئر",
  prodInventoryDesc:
    "اسپیئر پارٹس کے کاروبار کے لیے سیلز، خریداری، انوینٹری، اکاؤنٹس، کسٹمر، سپلائر اور ملٹی ڈیوائس آپریشن کے انتظام کے لیے مکمل ERP حل۔",
  prodFinanceShort: "فیملی فنانس مینجمنٹ سافٹ ویئر",
  prodFinanceDesc:
    "ایک خاندان کے تمام حسابات، لین دین، جمع، اخراجات، قرض، واجبات، بچت، اثاثے اور رکن کے لحاظ سے مالی کنٹرول کے لیے۔",

  benefitsHeading: "S4BUSINESSTHINKING کیوں؟",
  bOfflineTitle: "آف لائن فرسٹ",
  bOfflineDesc:
    "انٹرنیٹ کے بغیر کام کرتا ہے۔ ویب سائٹ بند ہونے پر بھی انسٹال شدہ سافٹ ویئر چلتا رہتا ہے۔",
  bSecureTitle: "ڈیزائن سے محفوظ",
  bSecureDesc:
    "خفیہ ڈیٹا، دستخط شدہ لائسنس، آڈٹ لاگ اور پروڈکشن گریڈ سیکیورٹی پروٹوکول۔",
  bFastTitle: "تیز",
  bFastDesc:
    "بہتر کارکردگی، تیز لوڈنگ اور موبائل فرسٹ ریسپانسیو ڈیزائن۔",
  bScalableTitle: "قابلِ توسیع",
  bScalableDesc:
    "برانچ، گودام، ممبر اور ڈیوائس — جیسے جیسے کاروبار بڑھے، سافٹ ویئر بڑھتا ہے۔",

  ctaTitle: "ابھی شروع کریں",
  ctaText:
    "سافٹ ویئر ڈاؤن لوڈ کریں، ڈیمو دیکھیں، یا براہِ راست واٹس ایپ پر ہم سے رابطہ کریں۔",
  ctaDownloadCenter: "ڈاؤن لوڈ سینٹر",
  ctaRequestDemo: "ڈیمو کی درخواست",
  ctaGetSupport: "سپورٹ حاصل کریں",

  footerTagline:
    "اسپیئر پارٹس انوینٹری اور فیملی فنانس مینجمنٹ کے لیے آفیشل سافٹ ویئر ویب سائٹ۔",
  footerSoftware: "سافٹ ویئر",
  footerContact: "رابطہ",
  footerLegal: "قانونی",
  footerSupportCenter: "سپورٹ سینٹر",
  footerDownloadCenter: "ڈاؤن لوڈ سینٹر",
  legalPrivacy: "پرائیویسی پالیسی",
  legalTerms: "شرائط و ضوابط",
  legalRefund: "ریفنڈ پالیسی",
  legalEula: "لائسنس معاہدہ (EULA)",
  legalCookie: "Cookie Policy",
  legalSecurity: "Security Policy",
  legalAcceptableUse: "Acceptable Use Policy",
  footerRights: "جملہ حقوق محفوظ ہیں۔",
  footerOfficial: "آفیشل ڈومین",
};

const ar: Dict = {
  navHome: "الرئيسية",
  navProducts: "المنتجات",
  navPricing: "الأسعار",
  navDownloads: "التنزيلات",
  navDocs: "التوثيق",
  navTutorials: "الدروس",
  navSupport: "الدعم",
  navContact: "اتصل بنا",
  navUpdates: "التحديثات",
  navAbout: "من نحن",

  login: "دخول العميل",
  download: "تنزيل",
  toggleMenu: "القائمة",
  chooseLanguage: "اللغة",
  close: "إغلاق",

  marquee:
    "مرحبًا بك في S4BUSINESSTHINKING.COM — البرنامج الرسمي لجرد قطع الغيار وإدارة الأموال العائلية • تنزيل • ترخيص • دعم • WhatsApp +880 1860-531723",

  welcomeTitle: "أهلاً وسهلاً!",
  welcomeText:
    "نرحّب بك بحرارة في الموقع الرسمي لـ S4BUSINESSTHINKING. استكشف برنامجينا القويّين وأدر أعمالك وأموال عائلتك بثقة وأمان.",
  welcomeQuote: "علامة واحدة. برنامجان. راحة بال كاملة.",
  welcomeEnter: "ادخل إلى الموقع",

  heroBadge: "الموقع الرسمي للبرامج",
  heroTitle: "برنامجان، منصة واحدة موثوقة",
  heroSubtitle:
    "تحت علامة تجارية واحدة، برنامجان بمستوى إنتاجي — جرد قطع الغيار وإدارة الأموال العائلية.",
  ctaDownloadNow: "نزّل الآن",
  ctaViewPricing: "عرض الأسعار",
  ctaWhatsApp: "دعم واتساب",

  productsHeading: "برامجنا",
  productsSub:
    "منتجان منفصلان تحت علامة واحدة. لكل منهما تنزيل وترخيص ودعم خاص.",
  viewSoftware: "عرض البرنامج",
  allSoftware: "جميع البرامج",
  pdOverview: "نظرة عامة",
  pdFeatures: "الميزات",
  pdAvailableOn: "متوفر على",
  pdBuyLicense: "شراء ترخيص",
  pdDocumentation: "التوثيق",

  prodInventoryShort: "برنامج جرد قطع الغيار",
  prodInventoryDesc:
    "حل ERP متكامل لإدارة المبيعات والمشتريات والمخزون والحسابات والعملاء والموردين والتشغيل على أجهزة متعددة لأعمال قطع الغيار.",
  prodFinanceShort: "برنامج إدارة الأموال العائلية",
  prodFinanceDesc:
    "لإدارة جميع حسابات الأسرة والمعاملات والودائع والنفقات والقروض والمستحقات والمدخرات والأصول والتحكم المالي لكل فرد.",

  benefitsHeading: "لماذا S4BUSINESSTHINKING؟",
  bOfflineTitle: "يعمل دون إنترنت أولاً",
  bOfflineDesc:
    "يعمل بدون إنترنت. وحتى لو توقف الموقع، يستمر البرنامج المثبَّت في العمل.",
  bSecureTitle: "آمن بالتصميم",
  bSecureDesc:
    "بيانات مشفّرة وترخيص موقّع وسجلات تدقيق وبروتوكول أمان بمستوى إنتاجي.",
  bFastTitle: "سريع",
  bFastDesc:
    "أداء مُحسَّن وتحميل سريع وتصميم متجاوب يراعي الأجهزة المحمولة أولاً.",
  bScalableTitle: "قابل للتوسّع",
  bScalableDesc:
    "فرع ومستودع وعضو وجهاز — كلما نما عملك نما البرنامج معه.",

  ctaTitle: "ابدأ الآن",
  ctaText:
    "نزّل البرنامج، أو شاهد عرضًا توضيحيًا، أو تواصل معنا مباشرة عبر واتساب.",
  ctaDownloadCenter: "مركز التنزيل",
  ctaRequestDemo: "اطلب عرضًا توضيحيًا",
  ctaGetSupport: "احصل على الدعم",

  footerTagline:
    "الموقع الرسمي لبرامج جرد قطع الغيار وإدارة الأموال العائلية.",
  footerSoftware: "البرامج",
  footerContact: "اتصل بنا",
  footerLegal: "قانوني",
  footerSupportCenter: "مركز الدعم",
  footerDownloadCenter: "مركز التنزيل",
  legalPrivacy: "سياسة الخصوصية",
  legalTerms: "الشروط والأحكام",
  legalRefund: "سياسة الاسترداد",
  legalEula: "اتفاقية الترخيص (EULA)",
  legalCookie: "سياسة ملفات تعريف الارتباط",
  legalSecurity: "سياسة الأمان",
  legalAcceptableUse: "سياسة الاستخدام المقبول",
  footerRights: "جميع الحقوق محفوظة.",
  footerOfficial: "إشعار النطاق الرسمي",
};

export const translations: Record<Lang, Dict> = { en, bn, hi, ur, ar };
