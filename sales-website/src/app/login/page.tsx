"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useI18n } from "@/components/LanguageProvider";
import { useAuth } from "@/components/AuthProvider";
import { PasswordField } from "@/components/PasswordField";
import { authCopy } from "@/lib/authCopy";

const inputCls =
  "w-full rounded-xl border border-line bg-panel/60 px-4 py-3 text-sm text-text placeholder:text-muted focus:border-accent";

export default function LoginPage() {
  const { lang } = useI18n();
  const c = authCopy[lang] ?? authCopy.en;
  const router = useRouter();
  const { login, isAuthenticated, ready } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [needVerify, setNeedVerify] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const params = new URLSearchParams(window.location.search);
      const q = params.get("email");
      if (q) setEmail(q);
      if (params.get("verified") === "1") setInfo("✓");
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!(ready && isAuthenticated)) return;
    const params = new URLSearchParams(window.location.search);
    const next = params.get("next");
    if (next && next.startsWith("/") && !next.startsWith("//")) {
      router.replace(next);
      return;
    }
    router.replace("/account");
  }, [ready, isAuthenticated, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setNeedVerify(false);
    setBusy(true);
    const res = await login(email, password);
    setBusy(false);
    if (res.ok) {
      const params = new URLSearchParams(window.location.search);
      const next = params.get("next");
      if (next && next.startsWith("/") && !next.startsWith("//")) {
        router.replace(next);
      } else {
        router.replace("/account");
      }
      return;
    }
    if ((res.error ?? "").toLowerCase().includes("not verified")) {
      setNeedVerify(true);
    }
    setError(res.error ?? "Login failed.");
  }

  return (
    <section className="mx-auto flex max-w-md flex-col px-5 py-16">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-accent to-accent2 text-base font-black text-bg">
        S4
      </div>
      <h1 className="mt-5 text-center text-2xl font-black text-text">
        {c.logTitle}
      </h1>
      <p className="mt-2 text-center text-sm text-muted">{c.logSub}</p>

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
        <PasswordField
          value={password}
          onChange={setPassword}
          placeholder={c.passwordLabel}
          showLabel={c.showPw}
          hideLabel={c.hidePw}
          autoComplete="current-password"
        />

        {info && (
          <p className="text-sm font-semibold text-good">✓ {c.acVerified}</p>
        )}
        {error && <p className="text-sm font-semibold text-danger">{error}</p>}
        {needVerify && (
          <Link
            href={`/verify?email=${encodeURIComponent(email)}`}
            className="text-sm font-semibold text-accent hover:underline"
          >
            {c.logVerifyLink} →
          </Link>
        )}

        <button
          type="submit"
          disabled={busy}
          className="rounded-xl bg-accent px-6 py-3 text-sm font-bold text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? c.logSubmitting : c.logSubmit}
        </button>

        <div className="flex items-center justify-between text-xs">
          <Link href="/forgot-password" className="text-muted hover:text-text">
            {c.logForgot}
          </Link>
          <span className="text-muted">
            {c.logNoAccount}{" "}
            <Link href="/register" className="font-semibold text-accent">
              {c.logRegister}
            </Link>
          </span>
        </div>
      </form>
    </section>
  );
}
