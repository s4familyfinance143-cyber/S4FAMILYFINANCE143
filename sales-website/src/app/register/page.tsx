"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useI18n } from "@/components/LanguageProvider";
import { PasswordField } from "@/components/PasswordField";
import { apiFetch } from "@/lib/authApi";
import { authCopy } from "@/lib/authCopy";

const inputCls =
  "w-full rounded-xl border border-line bg-panel/60 px-4 py-3 text-sm text-text placeholder:text-muted focus:border-accent";

export default function RegisterPage() {
  const { lang } = useI18n();
  const c = authCopy[lang] ?? authCopy.en;
  const router = useRouter();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [organization, setOrganization] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const res = await apiFetch("/auth/register", {
      method: "POST",
      body: {
        email,
        password,
        full_name: fullName || null,
        organization: organization || null,
      },
    });
    setBusy(false);
    if (res.ok) {
      router.push(`/verify?email=${encodeURIComponent(email)}`);
      return;
    }
    setError(res.error ?? "Registration failed.");
  }

  return (
    <section className="mx-auto flex max-w-md flex-col px-5 py-16">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-accent to-accent2 text-base font-black text-bg">
        S4
      </div>
      <h1 className="mt-5 text-center text-2xl font-black text-text">
        {c.regTitle}
      </h1>
      <p className="mt-2 text-center text-sm text-muted">{c.regSub}</p>

      <form
        onSubmit={submit}
        className="mt-8 flex flex-col gap-4 rounded-3xl border border-line bg-white/[0.02] p-7"
      >
        <input
          className={inputCls}
          placeholder={c.regFullName}
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          autoComplete="name"
        />
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
          className={inputCls}
          placeholder={c.regOrg}
          value={organization}
          onChange={(e) => setOrganization(e.target.value)}
          autoComplete="organization"
        />
        <PasswordField
          value={password}
          onChange={setPassword}
          placeholder={c.passwordLabel}
          showLabel={c.showPw}
          hideLabel={c.hidePw}
          autoComplete="new-password"
        />
        <p className="text-xs text-muted">{c.passwordHint}</p>

        {error && <p className="text-sm font-semibold text-danger">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="rounded-xl bg-accent px-6 py-3 text-sm font-bold text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? c.regSubmitting : c.regSubmit}
        </button>

        <p className="text-center text-xs text-muted">
          {c.regHaveAccount}{" "}
          <Link href="/login" className="font-semibold text-accent">
            {c.regLoginLink}
          </Link>
        </p>
      </form>
    </section>
  );
}
