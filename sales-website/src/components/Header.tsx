"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { site } from "@/lib/site";
import { useI18n } from "@/components/LanguageProvider";
import { useAuth } from "@/components/AuthProvider";
import { authCopy } from "@/lib/authCopy";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";

const navItems = [
  { key: "home", href: "/" },
  { key: "products", href: "/products", hasMenu: true },
  { key: "features", href: "/#features" },
  { key: "pricing", href: "/pricing" },
  { key: "download", href: "/installers" },
  { key: "docs", href: "/docs" },
  { key: "tutorial", href: "/tutorials" },
  { key: "updates", href: "/updates" },
  { key: "support", href: "/support" },
  { key: "contact", href: "/contact" },
] as const;

const headerCopy = {
  en: {
    whatsapp: "WhatsApp Support",
    email: "Email",
    signIn: "Sign In",
    myAccount: "My Account",
    downloadNow: "Download Now",
    subtitle: "Smart Software For Smart Business",
    nav: {
      home: "Home",
      products: "Products",
      features: "Features",
      pricing: "Pricing",
      download: "Download",
      docs: "Docs",
      tutorial: "Tutorial",
      updates: "Updates",
      support: "Support",
      contact: "Contact",
    },
  },
  bn: {
    whatsapp: "হোয়াটসঅ্যাপ সাপোর্ট",
    email: "ইমেইল",
    signIn: "সাইন ইন",
    myAccount: "আমার অ্যাকাউন্ট",
    downloadNow: "ডাউনলোড করুন",
    subtitle: "স্মার্ট ব্যবসার জন্য স্মার্ট সফটওয়্যার",
    nav: {
      home: "হোম",
      products: "পণ্য",
      features: "ফিচার",
      pricing: "মূল্য",
      download: "ডাউনলোড",
      docs: "ডকস",
      tutorial: "টিউটোরিয়াল",
      updates: "আপডেট",
      support: "সাপোর্ট",
      contact: "যোগাযোগ",
    },
  },
  hi: {
    whatsapp: "व्हाट्सएप सपोर्ट",
    email: "ईमेल",
    signIn: "साइन इन",
    myAccount: "मेरा अकाउंट",
    downloadNow: "डाउनलोड करें",
    subtitle: "स्मार्ट बिजनेस के लिए स्मार्ट सॉफ्टवेयर",
    nav: {
      home: "होम",
      products: "उत्पाद",
      features: "विशेषताएँ",
      pricing: "मूल्य",
      download: "डाउनलोड",
      docs: "डॉक्स",
      tutorial: "ट्यूटोरियल",
      updates: "अपडेट",
      support: "सपोर्ट",
      contact: "संपर्क",
    },
  },
  ur: {
    whatsapp: "واٹس ایپ سپورٹ",
    email: "ای میل",
    signIn: "سائن اِن",
    myAccount: "میرا اکاؤنٹ",
    downloadNow: "ڈاؤن لوڈ کریں",
    subtitle: "سمارٹ بزنس کے لیے سمارٹ سافٹ ویئر",
    nav: {
      home: "ہوم",
      products: "پروڈکٹس",
      features: "خصوصیات",
      pricing: "قیمتیں",
      download: "ڈاؤن لوڈ",
      docs: "دستاویزات",
      tutorial: "ٹیوٹوریل",
      updates: "اپڈیٹس",
      support: "سپورٹ",
      contact: "رابطہ",
    },
  },
  ar: {
    whatsapp: "دعم واتساب",
    email: "البريد",
    signIn: "تسجيل الدخول",
    myAccount: "حسابي",
    downloadNow: "تنزيل الآن",
    subtitle: "برامج ذكية للأعمال الذكية",
    nav: {
      home: "الرئيسية",
      products: "المنتجات",
      features: "الميزات",
      pricing: "الأسعار",
      download: "تنزيل",
      docs: "التوثيق",
      tutorial: "الدروس",
      updates: "التحديثات",
      support: "الدعم",
      contact: "اتصل بنا",
    },
  },
} as const;

function HeaderIcon({ name }: { name: "whatsapp" | "mail" | "globe" | "user" }) {
  const paths = {
    whatsapp:
      "M6.6 17.4 7.4 14.6A7.5 7.5 0 1 1 10.2 17l-3.6.4Zm3.8-9.3c-.2-.4-.4-.4-.7-.4h-.6c-.2 0-.5.1-.7.4-.2.3-.9.9-.9 2.1s.9 2.4 1 2.6c.1.2 1.8 2.8 4.5 3.9 2.2.9 2.7.7 3.2.7s1.7-.7 1.9-1.3c.2-.6.2-1.2.2-1.3-.1-.1-.2-.2-.5-.4l-1.8-.9c-.3-.1-.5-.2-.7.2l-.7.9c-.2.2-.4.3-.7.1-1-.4-1.9-.9-2.6-1.8-.2-.3-.2-.5.1-.7l.5-.6c.2-.2.2-.4.3-.6.1-.2 0-.4 0-.6l-.8-1.9Z",
    mail: "M3.5 6.5h17v11h-17v-11Zm1.7 1.4 6.8 5.2 6.8-5.2H5.2Zm13.6 8.2v-6l-6.2 4.7a1 1 0 0 1-1.2 0L5.2 10v6.1h13.6Z",
    globe:
      "M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17Zm0 1.8c-.7.8-1.4 2-1.7 3.3h3.4c-.3-1.3-1-2.5-1.7-3.3Zm-3.5 3.3c.2-1 .6-2 1.1-2.8a6.8 6.8 0 0 0-3.3 2.8h2.2Zm9.2 0a6.8 6.8 0 0 0-3.3-2.8c.5.8.9 1.8 1.1 2.8h2.2ZM5.4 10.3a6.8 6.8 0 0 0 0 3.4h2.8a13 13 0 0 1 0-3.4H5.4Zm4.6 0a10.6 10.6 0 0 0 0 3.4h4a10.6 10.6 0 0 0 0-3.4h-4Zm5.8 0a13 13 0 0 1 0 3.4h2.8a6.8 6.8 0 0 0 0-3.4h-2.8Zm-5.5 5.1c.3 1.3 1 2.5 1.7 3.3.7-.8 1.4-2 1.7-3.3h-3.4Zm-.7 2.8c-.5-.8-.9-1.8-1.1-2.8H6.3a6.8 6.8 0 0 0 3.3 2.8Zm4.8 0a6.8 6.8 0 0 0 3.3-2.8h-2.2c-.2 1-.6 2-1.1 2.8Z",
    user: "M12 12.2a4.2 4.2 0 1 1 0-8.4 4.2 4.2 0 0 1 0 8.4Zm0 1.8c3.2 0 6.1 1.8 7.5 4.6.3.6-.1 1.3-.8 1.3H5.3c-.7 0-1.1-.7-.8-1.3A8.4 8.4 0 0 1 12 14Z",
  };

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 shrink-0 fill-current">
      <path d={paths[name]} />
    </svg>
  );
}

export function Header() {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const accountHref = user ? "/account" : "/login";
  const signedLabel = user ? authCopy[lang]?.acTitle ?? authCopy.en.acTitle : t("login");
  const c = headerCopy[lang] ?? headerCopy.en;
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="sticky top-0 z-50 shadow-[0_10px_30px_rgba(7,17,31,0.08)]">
      <div className="bg-[#06172b] text-white">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-2 px-4 py-2 text-xs sm:px-6 lg:text-sm">
          <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-1 text-white/90">
            <a href={site.contact.whatsappUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 transition-colors hover:text-cyan-300">
              <HeaderIcon name="whatsapp" />
              <span>{c.whatsapp}: {site.contact.whatsappDisplay}</span>
            </a>
            <a href={site.contact.emailUrl} className="hidden items-center gap-2 transition-colors hover:text-cyan-300 sm:inline-flex">
              <HeaderIcon name="mail" />
              <span>{c.email}: {site.contact.email.toLowerCase()}</span>
            </a>
          </div>
          <div className="flex items-center gap-3 text-white/90">
            <LanguageSwitcher className="[&>button]:border-blue-400/60 [&>button]:px-3 [&>button]:py-1.5 [&>button]:text-xs [&>button]:text-white [&>button:hover]:border-cyan-300 [&>button:hover]:text-cyan-200" />
            <ThemeToggle className="border-blue-400/60 text-white hover:border-cyan-300 hover:text-cyan-200" />
            <Link href={accountHref} className="inline-flex items-center gap-2 rounded-md border border-blue-400/60 px-3 py-1.5 text-xs font-semibold transition-colors hover:border-cyan-300 hover:text-cyan-200">
              <HeaderIcon name="user" />
              {user ? signedLabel : c.signIn}
            </Link>
          </div>
        </div>
      </div>

      <div className="border-b border-slate-200 bg-white text-slate-950">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:py-4">
          <Link href="/" className="flex min-w-0 items-center gap-3" onClick={() => setOpen(false)}>
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-cyan-400 via-blue-600 to-indigo-600 text-lg font-black text-white shadow-[0_10px_24px_rgba(37,99,235,0.32)] sm:h-12 sm:w-12">
              S4
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-sm font-black tracking-tight text-slate-950 sm:text-base lg:text-lg">
                {site.domain}
              </span>
              <span className="block truncate text-[11px] font-medium text-slate-500 sm:text-xs">
                {c.subtitle}
              </span>
            </span>
          </Link>

          <nav className="hidden items-center gap-3 xl:flex" aria-label="Primary navigation">
            {navItems.map((item) => (
              <Link key={item.href} href={item.href} className={`relative inline-flex items-center gap-1 px-2 py-3 text-sm font-semibold transition-colors hover:text-blue-600 ${isActive(item.href) ? "text-blue-600" : "text-slate-900"}`}>
                {c.nav[item.key]}
                {"hasMenu" in item && item.hasMenu && <span className="text-xs text-slate-500" aria-hidden>⌄</span>}
                {isActive(item.href) && <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-blue-600" aria-hidden />}
              </Link>
            ))}
          </nav>

          <div className="hidden items-center gap-3 xl:flex">
            <Link href={accountHref} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-3 text-sm font-bold text-white shadow-[0_12px_24px_rgba(37,99,235,0.25)] transition hover:bg-blue-700">
              <HeaderIcon name="user" />
              {user ? c.myAccount : c.signIn}
            </Link>
          </div>

          <div className="flex items-center gap-2 xl:hidden">
            <button type="button" aria-label={t("toggleMenu")} aria-expanded={open} onClick={() => setOpen((v) => !v)} className="grid h-11 w-11 place-items-center rounded-lg border border-slate-200 text-slate-950 transition hover:border-blue-500">
              <span className="text-xl leading-none">{open ? "×" : "☰"}</span>
            </button>
          </div>
        </div>

        {open && (
          <div className="border-t border-slate-200 bg-white px-4 py-4 shadow-lg xl:hidden">
            <nav className="mx-auto flex max-w-[1440px] flex-col gap-1" aria-label="Mobile navigation">
              <div className="mb-3 flex flex-wrap gap-2">
                <LanguageSwitcher className="w-fit [&>button]:border-slate-200 [&>button]:text-slate-900" />
                <ThemeToggle className="border-slate-200 text-slate-900 hover:border-blue-500 hover:text-blue-600" />
              </div>
              {navItems.map((item) => (
                <Link key={item.href} href={item.href} onClick={() => setOpen(false)} className="rounded-lg px-3 py-2.5 text-sm font-semibold text-slate-800 hover:bg-blue-50 hover:text-blue-700">
                  {c.nav[item.key]}
                </Link>
              ))}
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <Link href={accountHref} onClick={() => setOpen(false)} className="flex-1 rounded-lg bg-blue-600 px-4 py-3 text-center text-sm font-bold text-white">
                  {user ? c.myAccount : c.signIn}
                </Link>
                <Link href="/installers" onClick={() => setOpen(false)} className="flex-1 rounded-lg border border-slate-200 px-4 py-3 text-center text-sm font-bold text-slate-900">
                  {c.downloadNow}
                </Link>
              </div>
            </nav>
          </div>
        )}
      </div>
    </header>
  );
}
