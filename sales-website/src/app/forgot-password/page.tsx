"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useI18n } from "@/components/LanguageProvider";
import { apiFetch } from "@/lib/authApi";
import { authCopy } from "@/lib/authCopy";

const inputCls =
  "w-full rounded-xl border border-line bg-panel/60 px-4 py-3 text-sm text-text placeholder:text-muted focus:border-accent";

export default function ForgotPasswordPage() {
  const { lang } = useI18n();
  const c = authCopy[lang] ?? authCopy.en;
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    await apiFetch("/auth/forgot-password", {
      method: "POST",
      body: { email },
    });
    setBusy(false);
    setSent(true);
  }

  return (
    <section className="mx-auto flex max-w-md flex-col px-5 py-16">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-accent to-accent2 text-base font-black text-bg">
        S4
      </div>
      <h1 className="mt-5 text-center text-2xl font-black text-text">
        {c.fgTitle}
      </h1>
      <p className="mt-2 text-center text-sm text-muted">{c.fgSub}</p>

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

        {sent && <p className="text-sm font-semibold text-good">{c.fgSent}</p>}

        {sent ? (
          <button
            type="button"
            onClick={() =>
              router.push(`/reset-password?email=${encodeURIComponent(email)}`)
            }
            className="rounded-xl bg-accent px-6 py-3 text-sm font-bold text-bg transition-opacity hover:opacity-90"
          >
            {c.rsTitle} →
          </button>
        ) : (
          <button
            type="submit"
            disabled={busy}
            className="rounded-xl bg-accent px-6 py-3 text-sm font-bold text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? c.fgSubmitting : c.fgSubmit}
          </button>
        )}

        <Link
          href="/login"
          className="text-center text-xs text-muted hover:text-text"
        >
          {c.fgBack}
        </Link>
      </form>
    </section>
  );
}
