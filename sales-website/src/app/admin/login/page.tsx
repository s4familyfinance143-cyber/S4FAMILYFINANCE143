"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/components/LanguageProvider";
import type { Lang } from "@/lib/i18n";

type Copy = {
  title: string;
  sub: string;
  username: string;
  password: string;
  button: string;
  loading: string;
  error: string;
  show: string;
  hide: string;
};

const copy: Record<Lang, Copy> = {
  en: {
    title: "Admin Login",
    sub: "Sign in to manage website content.",
    username: "Username",
    password: "Password",
    button: "Login",
    loading: "Signing in...",
    error: "Invalid username or password.",
    show: "Show password",
    hide: "Hide password",
  },
  bn: {
    title: "অ্যাডমিন লগইন",
    sub: "Website কন্টেন্ট পরিচালনার জন্য সাইন ইন করুন।",
    username: "ইউজারনেম",
    password: "পাসওয়ার্ড",
    button: "লগইন",
    loading: "সাইন ইন হচ্ছে...",
    error: "ভুল ইউজারনেম বা পাসওয়ার্ড।",
    show: "পাসওয়ার্ড দেখান",
    hide: "পাসওয়ার্ড লুকান",
  },
  hi: {
    title: "एडमिन लॉगिन",
    sub: "वेबसाइट सामग्री प्रबंधित करने के लिए साइन इन करें।",
    username: "उपयोगकर्ता नाम",
    password: "पासवर्ड",
    button: "लॉगिन",
    loading: "साइन इन हो रहा है...",
    error: "गलत उपयोगकर्ता नाम या पासवर्ड।",
    show: "पासवर्ड दिखाएँ",
    hide: "पासवर्ड छिपाएँ",
  },
  ur: {
    title: "ایڈمن لاگ اِن",
    sub: "ویب سائٹ مواد کے انتظام کے لیے سائن اِن کریں۔",
    username: "یوزر نیم",
    password: "پاس ورڈ",
    button: "لاگ اِن",
    loading: "سائن اِن ہو رہا ہے...",
    error: "غلط یوزر نیم یا پاس ورڈ۔",
    show: "پاس ورڈ دکھائیں",
    hide: "پاس ورڈ چھپائیں",
  },
  ar: {
    title: "دخول المشرف",
    sub: "سجّل الدخول لإدارة محتوى الموقع.",
    username: "اسم المستخدم",
    password: "كلمة المرور",
    button: "تسجيل الدخول",
    loading: "جارٍ تسجيل الدخول...",
    error: "اسم المستخدم أو كلمة المرور غير صحيحة.",
    show: "إظهار كلمة المرور",
    hide: "إخفاء كلمة المرور",
  },
};

export default function AdminLoginPage() {
  const { lang } = useI18n();
  const c = copy[lang] ?? copy.en;
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        setError(c.error);
        return;
      }
      const next =
        new URLSearchParams(window.location.search).get("next") ||
        "/admin/posts";
      router.replace(next);
      router.refresh();
    } catch {
      setError(c.error);
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    "w-full rounded-xl border border-line bg-panel/60 px-4 py-3 text-sm text-text placeholder:text-muted focus:border-accent";

  return (
    <section className="mx-auto flex max-w-md flex-col px-5 py-20">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-accent to-accent2 text-base font-black text-bg">
        S4
      </div>
      <h1 className="mt-5 text-center text-2xl font-black text-text">
        {c.title}
      </h1>
      <p className="mt-2 text-center text-sm text-muted">{c.sub}</p>

      <form
        onSubmit={submit}
        className="mt-8 flex flex-col gap-4 rounded-3xl border border-line bg-white/[0.02] p-7"
      >
        <input
          className={inputCls}
          placeholder={c.username}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          required
        />
        <div className="relative">
          <input
            className={`${inputCls} pe-12`}
            type={showPw ? "text" : "password"}
            placeholder={c.password}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
          <button
            type="button"
            onClick={() => setShowPw((v) => !v)}
            aria-label={showPw ? c.hide : c.show}
            title={showPw ? c.hide : c.show}
            className="absolute inset-y-0 end-0 grid w-11 place-items-center text-muted transition-colors hover:text-text"
          >
            {showPw ? (
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                <line x1="2" y1="2" x2="22" y2="22" />
              </svg>
            ) : (
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        </div>
        {error && <p className="text-sm font-semibold text-danger">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="rounded-xl bg-accent px-6 py-3 text-sm font-bold text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? c.loading : c.button}
        </button>
      </form>
    </section>
  );
}
