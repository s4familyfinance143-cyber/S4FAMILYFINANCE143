/** Money display helpers — Taka-first, multi-currency safe. */

export function formatTaka(value?: string | number | null, currency = "BDT"): string {
  const n = Number(value ?? 0);
  const amount = Number.isFinite(n) ? n.toFixed(2) : "0.00";
  if (currency === "BDT" || currency === "TK" || currency === "৳") {
    return `৳${amount}`;
  }
  return `${currency} ${amount}`;
}

/** Alias used across existing panels. */
export function formatAmount(value?: string | number | null, currency = "BDT"): string {
  return formatTaka(value, currency);
}

export function parseMoney(value?: string | number | null): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}
