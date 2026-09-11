import type { Lang } from "@/lib/i18n";

export const localeFor: Record<Lang, string> = {
  en: "en-US",
  bn: "bn-BD",
  hi: "hi-IN",
  ur: "ur-PK",
  ar: "ar-SA",
};

export function formatDate(value: string | null | undefined, lang: Lang) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString(localeFor[lang]);
}

export function formatDateTime(value: string | null | undefined, lang: Lang) {
  if (!value) return "-";
  return new Date(value).toLocaleString(localeFor[lang]);
}
