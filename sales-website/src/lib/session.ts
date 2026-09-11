// Session token helpers (edge-safe, used by middleware and route handlers).
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "s4_admin";
const ALG = "HS256";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(username: string): Promise<string> {
  return new SignJWT({ role: "admin", username })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(getSecret());
}

export async function verifySessionToken(
  token: string | undefined
): Promise<{ username: string } | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      algorithms: [ALG],
    });
    if (payload.role !== "admin") return null;
    return { username: String(payload.username ?? "admin") };
  } catch {
    return null;
  }
}

export const SESSION_MAX_AGE = MAX_AGE_SECONDS;
