"use client";

import Link from "next/link";
import { downloadReleases, products, site } from "@/lib/site";
import { useI18n } from "@/components/LanguageProvider";
import { PageHeader, Note } from "@/components/PageHeader";
import type { Lang } from "@/lib/i18n";

const APP_URL = "https://app.s4businessthinking.com";

type Copy = {
  title: string;
  sub: string;
  note: string;
  available: string;
  unavailable: string;
  notify: string;
  version: string;
  releaseDate: string;
  checksum: string;
  file: string;
  size: string;
  downloadNow: string;
  checksumPending: string;
  quickTitle: string;
  quickSub: string;
  openWeb: string;
  android: string;
  windows: string;
  iphone: string;
  iphoneTitle: string;
  iphoneSub: string;
  iphoneSteps: string[];
  otherProducts: string;
};

const copy: Record<Lang, Copy> = {
  en: {
    title: "Download Center",
    sub: "Android APK, Windows EXE, or iPhone PWA (Safari → Add to Home Screen).",
    note: "Official Family Finance installers are ready below. Inventory software downloads will appear here after verification.",
    available: "Available",
    unavailable: "Verification Pending",
    notify: "Notify me on WhatsApp",
    version: "Version",
    releaseDate: "Release date",
    checksum: "SHA-256",
    file: "File",
    size: "Size",
    downloadNow: "Download Now",
    checksumPending: "Checksum pending",
    quickTitle: "S4 FAMILY FINANCE 143 — Ready to install",
    quickSub: "Direct download for Android & Windows. iPhone uses the free PWA (no App Store file).",
    openWeb: "Open Web App",
    android: "Download Android APK",
    windows: "Download Windows EXE",
    iphone: "iPhone / iPad PWA",
    iphoneTitle: "iPhone & iPad — Install as PWA",
    iphoneSub:
      "Apple does not allow APK-style installs. Open the app in Safari, then add it to your Home Screen — it works like a normal app icon.",
    iphoneSteps: [
      "1. Tap “iPhone / iPad PWA” (opens in Safari).",
      "2. Tap the Share button (square with ↑).",
      "3. Choose Add to Home Screen → Add.",
    ],
    otherProducts: "All products",
  },
  bn: {
    title: "ডাউনলোড সেন্টার",
    sub: "Android APK, Windows EXE, অথবা iPhone PWA (Safari → Home Screen-এ যোগ)।",
    note: "Family Finance official installer নিচে রেডি। Inventory সফটওয়্যার যাচাই শেষ হলে এখানে আসবে।",
    available: "ডাউনলোড আছে",
    unavailable: "যাচাই বাকি",
    notify: "WhatsApp-এ জানান",
    version: "ভার্সন",
    releaseDate: "রিলিজ তারিখ",
    checksum: "SHA-256",
    file: "ফাইল",
    size: "সাইজ",
    downloadNow: "ডাউনলোড করুন",
    checksumPending: "Checksum pending আছে",
    quickTitle: "S4 FAMILY FINANCE 143 — ইনস্টল রেডি",
    quickSub: "Android ও Windows সরাসরি ডাউনলোড। iPhone-এ বিনামূল্যে PWA (App Store ফাইল নয়)।",
    openWeb: "ওয়েব অ্যাপ খুলুন",
    android: "Android APK ডাউনলোড",
    windows: "Windows EXE ডাউনলোড",
    iphone: "iPhone / iPad PWA",
    iphoneTitle: "iPhone ও iPad — PWA হিসেবে ইনস্টল",
    iphoneSub:
      "Apple APK-স্টাইল ইনস্টল দেয় না। Safari-তে অ্যাপ খুলে Home Screen-এ যোগ করুন — আইকন সাধারণ অ্যাপের মতো কাজ করবে।",
    iphoneSteps: [
      "১. “iPhone / iPad PWA” ট্যাপ করুন (Safari-তে খুলবে)।",
      "২. Share বাটন ট্যাপ করুন (বর্গাকার ↑)।",
      "৩. Add to Home Screen → Add বেছে নিন।",
    ],
    otherProducts: "সব পণ্য",
  },
  hi: {
    title: "डाउनलोड सेंटर",
    sub: "Android APK, Windows EXE, या iPhone PWA (Safari → Home Screen पर जोड़ें)।",
    note: "Family Finance इंस्टॉलर नीचे तैयार हैं। Inventory डाउनलोड सत्यापन के बाद आएंगे।",
    available: "उपलब्ध",
    unavailable: "सत्यापन बाकी",
    notify: "व्हाट्सएप पर सूचित करें",
    version: "वर्जन",
    releaseDate: "रिलीज तारीख",
    checksum: "SHA-256",
    file: "फाइल",
    size: "साइज",
    downloadNow: "डाउनलोड करें",
    checksumPending: "Checksum लंबित है",
    quickTitle: "S4 FAMILY FINANCE 143 — इंस्टॉल तैयार",
    quickSub: "Android और Windows सीधा डाउनलोड। iPhone पर मुफ्त PWA (App Store फ़ाइल नहीं)।",
    openWeb: "वेब ऐप खोलें",
    android: "Android APK डाउनलोड",
    windows: "Windows EXE डाउनलोड",
    iphone: "iPhone / iPad PWA",
    iphoneTitle: "iPhone और iPad — PWA के रूप में इंस्टॉल",
    iphoneSub:
      "Apple APK-स्टाइल इंस्टॉल नहीं देता। Safari में ऐप खोलकर Home Screen पर जोड़ें — आइकन सामान्य ऐप जैसा काम करेगा।",
    iphoneSteps: [
      "1. “iPhone / iPad PWA” टैप करें (Safari में खुलेगा)।",
      "2. Share बटन टैप करें (वर्ग ↑)।",
      "3. Add to Home Screen → Add चुनें।",
    ],
    otherProducts: "सभी उत्पाद",
  },
  ur: {
    title: "ڈاؤن لوڈ سینٹر",
    sub: "Android APK، Windows EXE، یا iPhone PWA (Safari → Home Screen)۔",
    note: "Family Finance انسٹالر نیچے تیار ہیں۔ Inventory ڈاؤن لوڈ تصدیق کے بعد آئیں گے۔",
    available: "دستیاب",
    unavailable: "تصدیق باقی ہے",
    notify: "واٹس ایپ پر مطلع کریں",
    version: "ورژن",
    releaseDate: "ریلیز تاریخ",
    checksum: "SHA-256",
    file: "فائل",
    size: "سائز",
    downloadNow: "ڈاؤن لوڈ کریں",
    checksumPending: "Checksum زیر التوا ہے",
    quickTitle: "S4 FAMILY FINANCE 143 — انسٹال تیار",
    quickSub: "Android اور Windows براہ راست ڈاؤن لوڈ۔ iPhone پر مفت PWA (App Store فائل نہیں)۔",
    openWeb: "ویب ایپ کھولیں",
    android: "Android APK ڈاؤن لوڈ",
    windows: "Windows EXE ڈاؤن لوڈ",
    iphone: "iPhone / iPad PWA",
    iphoneTitle: "iPhone اور iPad — PWA کے طور پر انسٹال",
    iphoneSub:
      "Apple APK طرز کی انسٹال نہیں دیتا۔ Safari میں ایپ کھول کر Home Screen پر شامل کریں — آئیکن عام ایپ کی طرح کام کرے گا۔",
    iphoneSteps: [
      "1. “iPhone / iPad PWA” دبائیں (Safari میں کھلے گی)۔",
      "2. Share بٹن دبائیں (مربع ↑)۔",
      "3. Add to Home Screen → Add منتخب کریں۔",
    ],
    otherProducts: "تمام پروڈکٹس",
  },
  ar: {
    title: "مركز التنزيل",
    sub: "Android APK أو Windows EXE أو iPhone PWA (Safari ← إضافة إلى الشاشة الرئيسية).",
    note: "مثبتات Family Finance جاهزة أدناه. ستظهر تنزيلات Inventory بعد التحقق.",
    available: "متاح",
    unavailable: "بانتظار التحقق",
    notify: "أبلغني عبر واتساب",
    version: "الإصدار",
    releaseDate: "تاريخ الإصدار",
    checksum: "SHA-256",
    file: "الملف",
    size: "الحجم",
    downloadNow: "تنزيل الآن",
    checksumPending: "المجموع الاختباري معلق",
    quickTitle: "S4 FAMILY FINANCE 143 — جاهز للتثبيت",
    quickSub: "تنزيل مباشر لأندرويد وويندوز. على آيفون استخدم PWA المجاني (ليس ملف App Store).",
    openWeb: "افتح تطبيق الويب",
    android: "تنزيل Android APK",
    windows: "تنزيل Windows EXE",
    iphone: "iPhone / iPad PWA",
    iphoneTitle: "iPhone و iPad — تثبيت كـ PWA",
    iphoneSub:
      "أبل لا تسمح بتثبيت بنمط APK. افتح التطبيق في Safari ثم أضفه إلى الشاشة الرئيسية — يعمل كأيقونة تطبيق عادية.",
    iphoneSteps: [
      "1. اضغط “iPhone / iPad PWA” (يفتح في Safari).",
      "2. اضغط زر المشاركة (مربع ↑).",
      "3. اختر Add to Home Screen ← Add.",
    ],
    otherProducts: "كل المنتجات",
  },
};

function releaseFor(productSlug: string, platform: string) {
  return downloadReleases.find(
    (r) => r.productSlug === productSlug && r.platform === platform
  );
}

const FINANCE_SLUG = "s4-family-finance-143";

export default function DownloadsPage() {
  const { lang, t } = useI18n();
  const c = copy[lang] ?? copy.en;
  const financeAndroid = releaseFor(FINANCE_SLUG, "Android");
  const financeWindows = releaseFor(FINANCE_SLUG, "Windows");
  const orderedProducts = [
    ...products.filter((p) => p.slug === FINANCE_SLUG),
    ...products.filter((p) => p.slug !== FINANCE_SLUG),
  ];

  return (
    <>
      <PageHeader title={c.title} subtitle={c.sub} />
      <section className="mx-auto max-w-[1220px] px-5 py-14">
        <div className="rounded-3xl border border-accent2/40 bg-gradient-to-br from-accent2/15 to-white/[0.03] p-7 sm:p-8">
          <h2 className="text-xl font-black text-text sm:text-2xl">{c.quickTitle}</h2>
          <p className="mt-2 text-sm text-muted">{c.quickSub}</p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            {financeAndroid?.href ? (
              <a
                href={financeAndroid.href}
                download={financeAndroid.fileName || true}
                className="inline-flex items-center justify-center rounded-xl bg-accent2 px-5 py-3.5 text-sm font-bold text-bg transition-opacity hover:opacity-90"
              >
                {c.android}
              </a>
            ) : null}
            {financeWindows?.href ? (
              <a
                href={financeWindows.href}
                download={financeWindows.fileName || true}
                className="inline-flex items-center justify-center rounded-xl bg-accent px-5 py-3.5 text-sm font-bold text-bg transition-opacity hover:opacity-90"
              >
                {c.windows}
              </a>
            ) : null}
            <a
              href={APP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center rounded-xl border border-good/50 bg-good/10 px-5 py-3.5 text-sm font-bold text-good transition-colors hover:border-good hover:bg-good/20"
            >
              {c.iphone}
            </a>
            <a
              href={APP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center rounded-xl border border-line px-5 py-3.5 text-sm font-bold text-text transition-colors hover:border-good hover:text-good"
            >
              {c.openWeb}
            </a>
          </div>
        </div>

        <div className="mt-6 rounded-3xl border border-line bg-white/[0.02] p-7 sm:p-8">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-black text-text sm:text-xl">{c.iphoneTitle}</h2>
            <span className="rounded-full bg-good/15 px-3 py-1 text-xs font-bold text-good">
              {c.available}
            </span>
          </div>
          <p className="mt-2 text-sm text-muted">{c.iphoneSub}</p>
          <ol className="mt-4 space-y-2 text-sm text-text/90">
            {c.iphoneSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <a
            href={APP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-5 inline-flex items-center justify-center rounded-xl bg-good px-5 py-3.5 text-sm font-bold text-bg transition-opacity hover:opacity-90"
          >
            {c.iphone}
          </a>
        </div>

        <div className="mt-8">
          <Note tone="warn">{c.note}</Note>
        </div>

        <h3 className="mt-10 text-sm font-extrabold uppercase tracking-wide text-muted">
          {c.otherProducts}
        </h3>

        <div className="mt-4 grid gap-6 md:grid-cols-2">
          {orderedProducts.map((p) => (
            <article
              key={p.slug}
              className="rounded-3xl border border-line bg-white/[0.02] p-7"
            >
              <div className="flex items-center gap-3">
                <span
                  className={`grid h-11 w-11 place-items-center rounded-2xl text-lg font-black text-bg ${
                    p.accent === "accent" ? "bg-accent" : "bg-accent2"
                  }`}
                >
                  S4
                </span>
                <h2 className="text-lg font-extrabold text-text">{p.name}</h2>
              </div>

              <div className="mt-6 flex flex-col gap-4">
                {p.platforms.map((plat) => {
                  const release = releaseFor(p.slug, plat);
                  const isAvailable = release?.status === "available" && release.href;

                  return (
                    <div
                      key={plat}
                      className="rounded-2xl border border-line bg-panel/30 p-4"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <h3 className="text-sm font-extrabold text-text">
                            {t("download")} · {plat}
                          </h3>
                          <p className="mt-1 text-xs text-muted">
                            {c.version}: {release?.version ?? "-"} · {c.releaseDate}:{" "}
                            {release?.releaseDate ?? "-"}
                          </p>
                        </div>
                        <span
                          className={`w-fit rounded-full px-3 py-1 text-xs font-bold ${
                            isAvailable
                              ? "bg-good/15 text-good"
                              : "bg-warn/15 text-warn"
                          }`}
                        >
                          {isAvailable ? c.available : c.unavailable}
                        </span>
                      </div>

                      <dl className="mt-4 grid gap-2 text-xs text-muted sm:grid-cols-2">
                        <div>
                          <dt className="font-bold text-text/80">{c.file}</dt>
                          <dd className="mt-1 break-all">{release?.fileName ?? "-"}</dd>
                        </div>
                        <div>
                          <dt className="font-bold text-text/80">{c.size}</dt>
                          <dd className="mt-1">{release?.size ?? "-"}</dd>
                        </div>
                        <div className="sm:col-span-2">
                          <dt className="font-bold text-text/80">{c.checksum}</dt>
                          <dd className="mt-1 break-all font-mono">
                            {release?.sha256 ?? c.checksumPending}
                          </dd>
                        </div>
                      </dl>

                      {isAvailable ? (
                        <a
                          href={release.href}
                          download={release.fileName || true}
                          className="mt-4 block rounded-xl bg-accent px-5 py-3 text-center text-sm font-bold text-bg transition-opacity hover:opacity-90"
                        >
                          {c.downloadNow}
                        </a>
                      ) : (
                        <a
                          href={site.contact.whatsappUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-4 block rounded-xl border border-line px-5 py-3 text-center text-sm font-semibold text-text transition-colors hover:border-good hover:text-good"
                        >
                          {c.notify}
                        </a>
                      )}
                    </div>
                  );
                })}

                {p.slug === FINANCE_SLUG ? (
                  <div className="rounded-2xl border border-good/30 bg-good/5 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <h3 className="text-sm font-extrabold text-text">
                          {t("download")} · iPhone / iPad (PWA)
                        </h3>
                        <p className="mt-1 text-xs text-muted">{c.iphoneSub}</p>
                      </div>
                      <span className="w-fit rounded-full bg-good/15 px-3 py-1 text-xs font-bold text-good">
                        {c.available}
                      </span>
                    </div>
                    <a
                      href={APP_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-4 block rounded-xl bg-good px-5 py-3 text-center text-sm font-bold text-bg transition-opacity hover:opacity-90"
                    >
                      {c.iphone}
                    </a>
                  </div>
                ) : null}
              </div>
            </article>
          ))}
        </div>

        <p className="mt-8 text-center text-sm text-muted">
          <Link href="/products/s4-family-finance-143" className="font-semibold text-good hover:underline">
            S4 FAMILY FINANCE 143
          </Link>
        </p>
      </section>
    </>
  );
}
