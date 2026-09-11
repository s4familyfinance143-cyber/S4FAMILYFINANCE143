/** Date formatting — uses date-fns when available, falls back to ISO locale. */

type DateInput = string | number | Date | null | undefined;

function toDate(value: DateInput): Date | null {
  if (value == null || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(value: DateInput, locale: string = "bn-BD"): string {
  const d = toDate(value);
  if (!d) return "—";
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { format } = require("date-fns") as typeof import("date-fns");
    if (locale.startsWith("bn")) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { bn } = require("date-fns/locale") as typeof import("date-fns/locale");
        return format(d, "dd MMM yyyy", { locale: bn });
      } catch {
        return format(d, "dd MMM yyyy");
      }
    }
    return format(d, "dd MMM yyyy");
  } catch {
    return d.toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" });
  }
}

export function formatDateTime(value: DateInput, locale: string = "bn-BD"): string {
  const d = toDate(value);
  if (!d) return "—";
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { format } = require("date-fns") as typeof import("date-fns");
    return format(d, "dd MMM yyyy HH:mm");
  } catch {
    return d.toLocaleString(locale);
  }
}

export function toIsoDate(value: DateInput = new Date()): string {
  const d = toDate(value) || new Date();
  return d.toISOString();
}
