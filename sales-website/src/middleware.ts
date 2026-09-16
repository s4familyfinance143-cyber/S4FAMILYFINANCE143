import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/session";

const INSTALLER_FILE = /\.(apk|exe)$/i;

// In-memory best-effort throttle for the admin login endpoint, which had no
// rate limiting at all — scrypt slows brute force somewhat, but nothing
// capped attempt *count* per IP. Fixed window is fine at this app's scale
// (single admin account, one instance); resets on redeploy.
const LOGIN_ATTEMPT_LIMIT = 8;
const LOGIN_WINDOW_MS = 5 * 60 * 1000;
const loginAttempts = new Map<string, { count: number; windowStart: number }>();

function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

function isLoginRateLimited(req: NextRequest): boolean {
  const ip = clientIp(req);
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now - entry.windowStart >= LOGIN_WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, windowStart: now });
    return false;
  }
  entry.count += 1;
  return entry.count > LOGIN_ATTEMPT_LIMIT;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname === "/api/admin/login" && req.method === "POST" && isLoginRateLimited(req)) {
    return NextResponse.json(
      { error: "Too many login attempts. Try again later." },
      { status: 429 },
    );
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySessionToken(token);

  // Old /downloads HTML is stuck in a reverse-proxy cache with pending cards.
  // Serve the fresh installer center under /installers instead.
  if (pathname === "/downloads" || pathname === "/downloads/") {
    const url = req.nextUrl.clone();
    url.pathname = "/installers";
    url.search = "";
    const redirect = NextResponse.redirect(url);
    redirect.headers.set("Cache-Control", "private, no-store, max-age=0, must-revalidate");
    return redirect;
  }

  if (pathname === "/installers") {
    const res = NextResponse.next();
    res.headers.set("Cache-Control", "private, no-store, max-age=0, must-revalidate");
    return res;
  }

  // Block public hotlinks to installer binaries — must use logged-in secure download.
  if (pathname.startsWith("/downloads/") && INSTALLER_FILE.test(pathname)) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", "/installers");
    return NextResponse.redirect(url);
  }

  if (pathname.startsWith("/admin")) {
    if (pathname === "/admin/login") return NextResponse.next();
    if (!session) {
      const url = req.nextUrl.clone();
      url.pathname = "/admin/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/admin/") && !pathname.startsWith("/api/admin/login")) {
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/posts") && req.method !== "GET") {
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/downloads",
    "/downloads/:path*",
    "/installers",
    "/installers/:path*",
    "/admin/:path*",
    "/api/admin/:path*",
    "/api/posts",
    "/api/posts/:path*",
  ],
};
