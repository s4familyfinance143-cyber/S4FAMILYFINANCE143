"use client";

import { useEffect, useRef, useState } from "react";
import { languages } from "@/lib/i18n";
import { useI18n } from "@/components/LanguageProvider";

export function LanguageSwitcher({ className = "" }: { className?: string }) {
  const { lang, setLang, t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const current = languages.find((l) => l.code === lang) ?? languages[0];

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("chooseLanguage")}
        className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm font-semibold text-text transition-colors hover:border-accent hover:text-accent"
      >
        <span aria-hidden>{"\uD83C\uDF10"}</span>
        <span>{current.native}</span>
        <span className="text-xs text-muted" aria-hidden>
          {open ? "\u25B2" : "\u25BC"}
        </span>
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute end-0 z-50 mt-2 w-44 overflow-hidden rounded-xl border border-line bg-panel shadow-[0_18px_40px_rgba(0,0,0,.4)]"
        >
          {languages.map((l) => {
            const active = l.code === lang;
            return (
              <li key={l.code} role="option" aria-selected={active}>
                <button
                  type="button"
                  onClick={() => {
                    setLang(l.code);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between px-4 py-2.5 text-sm transition-colors hover:bg-panel2 ${
                    active ? "text-accent" : "text-text"
                  }`}
                >
                  <span className="font-semibold">{l.native}</span>
                  <span className="text-xs text-muted">{l.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
