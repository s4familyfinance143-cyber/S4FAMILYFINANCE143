export type ValidationResult = { ok: true } | { ok: false; message: string };

export function required(value: unknown, label = "Field"): ValidationResult {
  if (value == null || String(value).trim() === "") {
    return { ok: false, message: `${label} is required` };
  }
  return { ok: true };
}

export function isEmail(value: string): ValidationResult {
  const v = String(value || "").trim();
  if (!v) return { ok: false, message: "Email is required" };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
    return { ok: false, message: "Invalid email address" };
  }
  return { ok: true };
}

export function isStrongPassword(password: string): ValidationResult {
  const pw = String(password || "");
  if (pw.length < 8) return { ok: false, message: "Password must be at least 8 characters" };
  if (!/[A-Z]/.test(pw) || !/[a-z]/.test(pw)) {
    return { ok: false, message: "Password needs upper and lower case letters" };
  }
  if (!/\d/.test(pw)) return { ok: false, message: "Password needs a number" };
  if (!/[^A-Za-z0-9]/.test(pw)) return { ok: false, message: "Password needs a special character" };
  return { ok: true };
}

export function isPositiveMoney(value: string | number): ValidationResult {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return { ok: false, message: "Amount must be greater than 0" };
  return { ok: true };
}

export function passwordStrengthScore(password: string): number {
  const pw = String(password || "");
  let score = 0;
  if (pw.length >= 8) score += 1;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score += 1;
  if (/\d/.test(pw)) score += 1;
  if (/[^A-Za-z0-9]/.test(pw)) score += 1;
  return score;
}
