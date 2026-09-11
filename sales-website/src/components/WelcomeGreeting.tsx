"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/components/LanguageProvider";
import { site } from "@/lib/site";

const SESSION_KEY = "s4-welcomed";

export function WelcomeGreeting() {
  const { t } = useI18n();
  const [show, setShow] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        if (!sessionStorage.getItem(SESSION_KEY)) {
          setShow(true);
          requestAnimationFrame(() => setMounted(true));
        }
      } catch {
        setShow(true);
        requestAnimationFrame(() => setMounted(true));
      }
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  // Lock background scroll while the greeting is open.
  useEffect(() => {
    if (!show) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [show]);

  function close() {
    setMounted(false);
    try {
      sessionStorage.setItem(SESSION_KEY, "1");
    } catch {
      /* ignore */
    }
    window.setTimeout(() => setShow(false), 250);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    if (show) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [show]);

  if (!show) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("welcomeTitle")}
      className={`fixed inset-0 z-[100] flex items-center justify-center p-4 transition-opacity duration-300 ${
        mounted ? "opacity-100" : "opacity-0"
      }`}
    >
      <button
        type="button"
        aria-label={t("close")}
        onClick={close}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />

      <div
        className={`relative w-full max-w-lg overflow-hidden rounded-3xl border border-line bg-gradient-to-b from-panel2 to-panel p-8 text-center shadow-[0_30px_80px_rgba(0,0,0,.6)] transition-all duration-300 ${
          mounted ? "translate-y-0 scale-100" : "translate-y-4 scale-95"
        }`}
      >
        <div className="pointer-events-none absolute -top-24 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full bg-accent/25 blur-3xl" />

        <div className="relative">
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-accent to-accent2 text-xl font-black text-bg">
            S4
          </span>

          <h2 className="mt-5 text-3xl font-black text-text">
            {t("welcomeTitle")}
          </h2>

          <p className="mt-2 text-sm font-semibold uppercase tracking-[0.2em] text-accent">
            {site.domain}
          </p>

          <p className="mx-auto mt-4 max-w-md text-[15px] leading-relaxed text-muted">
            {t("welcomeText")}
          </p>

          <p className="mt-5 text-base font-bold text-text">
            &ldquo;{t("welcomeQuote")}&rdquo;
          </p>

          <button
            type="button"
            onClick={close}
            className="mt-7 w-full rounded-xl bg-accent px-6 py-3 text-sm font-bold text-bg transition-opacity hover:opacity-90"
          >
            {t("welcomeEnter")}
          </button>
        </div>
      </div>
    </div>
  );
}
