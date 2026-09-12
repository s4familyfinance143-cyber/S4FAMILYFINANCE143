import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/session";

const INSTALLER_FILE = /\.(apk|exe)$/i;

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
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
