import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/session";

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySessionToken(token);

  // Protect the admin area (login page stays public).
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

  if (pathname.startsWith("/api/admin/tickets")) {
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/admin/licenses")) {
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/admin/orders")) {
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/admin/customers")) {
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/admin/releases")) {
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/admin/dashboard")) {
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/admin/events")) {
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/admin/purchase-requests")) {
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/admin/payments")) {
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.next();
  }

  // Posts API: public read (GET), protected write (POST/DELETE/etc.).
  if (pathname.startsWith("/api/posts")) {
    if (req.method === "GET") return NextResponse.next();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/api/admin/tickets",
    "/api/admin/tickets/:path*",
    "/api/admin/licenses",
    "/api/admin/licenses/:path*",
    "/api/admin/orders",
    "/api/admin/orders/:path*",
    "/api/admin/customers",
    "/api/admin/customers/:path*",
    "/api/admin/releases",
    "/api/admin/releases/:path*",
    "/api/admin/dashboard",
    "/api/admin/events",
    "/api/admin/purchase-requests",
    "/api/admin/purchase-requests/:path*",
    "/api/admin/payments",
    "/api/admin/payments/:path*",
    "/api/posts",
    "/api/posts/:path*",
  ],
};
