"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  DEFAULT_LANG,
  dirFor,
  translations,
  type Dict,
  type Lang,
} from "@/lib/i18n";

type Ctx = {
  lang: Lang;
  dir: "ltr" | "rtl";
  setLang: (l: Lang) => void;
  t: (key: keyof Dict) => string;
};

const LanguageContext = createContext<Ctx | null>(null);

const STORAGE_KEY = "s4-lang";

function isLang(v: string | null): v is Lang {
  return v === "en" || v === "bn" || v === "hi" || v === "ur" || v === "ar";
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(DEFAULT_LANG);

  // Load stored preference immediately after mount; delaying this causes a visible wrong-language flash.
  useEffect(() => {
    let frame = 0;
    function applyStored() {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (isLang(stored)) {
          document.documentElement.lang = stored;
          document.documentElement.dir = dirFor(stored);
          setLangState(stored);
        }
      } catch {
        /* ignore storage errors */
      }
    }

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (isLang(stored)) {
        document.documentElement.lang = stored;
        document.documentElement.dir = dirFor(stored);
      }
    } catch {
      /* ignore storage errors */
    }

    frame = requestAnimationFrame(applyStored);
    window.addEventListener("pageshow", applyStored);
    window.addEventListener("focus", applyStored);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pageshow", applyStored);
      window.removeEventListener("focus", applyStored);
    };
  }, []);

  // Keep <html lang/dir> in sync for accessibility, SEO and RTL.
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dirFor(lang);
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* ignore storage errors */
    }
  }, []);

  const t = useCallback(
    (key: keyof Dict) => translations[lang][key] ?? translations.en[key],
    [lang]
  );

  const value = useMemo<Ctx>(
    () => ({ lang, dir: dirFor(lang), setLang, t }),
    [lang, setLang, t]
  );

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useI18n(): Ctx {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useI18n must be used within LanguageProvider");
  return ctx;
}
