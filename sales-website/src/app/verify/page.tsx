"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useI18n } from "@/components/LanguageProvider";
import { apiFetch } from "@/lib/authApi";
import { authCopy } from "@/lib/authCopy";

const inputCls =
  "w-full rounded-xl border border-line bg-panel/60 px-4 py-3 text-sm text-text placeholder:text-muted focus:border-accent";

export default function VerifyPage() {
  const { lang } = useI18n();
  const c = authCopy[lang] ?? authCopy.en;
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const q = new URLSearchParams(window.location.search).get("email");
      if (q) setEmail(q);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setInfo("");
    setBusy(true);
    const res = await apiFetch("/auth/verify-email", {
      method: "POST",
      body: { email, code },
    });
    setBusy(false);
    if (res.ok) {
      router.push(`/login?verified=1&email=${encodeURIComponent(email)}`);
      return;
    }
    setError(res.error ?? "Verification failed.");
  }

  async function resend() {
    if (!email) {
      setError(c.verNeedEmail);
      return;
    }
    setError("");
    const res = await apiFetch("/auth/resend-code", {
      method: "POST",
      body: { email },
    });
    if (res.ok) setInfo(c.verResent);
  }

  return (
    <section className="mx-auto flex max-w-md flex-col px-5 py-16">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-accent to-accent2 text-base font-black text-bg">
        S4
      </div>
      <h1 className="mt-5 text-center text-2xl font-black text-text">
        {c.verTitle}
      </h1>
      <p className="mt-2 text-center text-sm text-muted">{c.verSub}</p>

      <form
        onSubmit={submit}
        className="mt-8 flex flex-col gap-4 rounded-3xl border border-line bg-white/[0.02] p-7"
      >
        <input
          className={inputCls}
          type="email"
          placeholder={c.emailLabel}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
        <input
          className={`${inputCls} text-center text-lg tracking-[0.4em]`}
          inputMode="numeric"
          maxLength={6}
          placeholder={c.verCode}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          required
        />

        {error && <p className="text-sm font-semibold text-danger">{error}</p>}
        {info && <p className="text-sm font-semibold text-good">{info}</p>}

        <button
          type="submit"
          disabled={busy}
          className="rounded-xl bg-accent px-6 py-3 text-sm font-bold text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? c.verSubmitting : c.verSubmit}
        </button>

        <div className="flex items-center justify-between text-xs">
          <button
            type="button"
            onClick={resend}
            className="font-semibold text-accent hover:underline"
          >
            {c.verResend}
          </button>
          <Link href="/login" className="text-muted hover:text-text">
            {c.logTitle}
          </Link>
        </div>
      </form>
    </section>
  );
}
