// Server-only admin credential verification (Node runtime).
import { scryptSync, randomBytes, timingSafeEqual } from "crypto";

/**
 * Hash format: scrypt:<saltHex>:<hashHex>
 * NOTE: ':' is used as the delimiter (not '$') because dotenv variable
 * expansion in @next/env would otherwise treat '$...' as a variable
 * reference and silently truncate the stored hash.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  const actual = scryptSync(password, salt, expected.length);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function verifyAdminCredentials(
  username: string,
  password: string
): boolean {
  const expectedUser = process.env.ADMIN_USERNAME;
  const storedHash = process.env.ADMIN_PASSWORD_HASH;
  if (!expectedUser || !storedHash) return false;
  // Username is case-insensitive (and whitespace-trimmed); password stays exact.
  if (username.trim().toLowerCase() !== expectedUser.trim().toLowerCase()) {
    return false;
  }
  return verifyPassword(password, storedHash);
}
