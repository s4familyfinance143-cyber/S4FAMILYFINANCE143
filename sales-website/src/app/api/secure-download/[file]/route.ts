import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8001/api";

const ALLOWED = new Set([
  "S4-Family-Finance-143.apk",
  "S4-Family-Finance-143-Setup.exe",
  "S4BUSINESSTHINKING-Inventory.apk",
  "S4BUSINESSTHINKING-Inventory-Setup.exe",
]);

const CONTENT_TYPE: Record<string, string> = {
  ".apk": "application/vnd.android.package-archive",
  ".exe": "application/octet-stream",
};

async function customerAuthorized(req: Request): Promise<boolean> {
  const auth = req.headers.get("authorization") || "";
  const cookie = req.headers.get("cookie") || "";

  // Prefer Bearer from the logged-in website session.
  if (auth.toLowerCase().startsWith("bearer ")) {
    const me = await fetch(`${API_BASE}/account/me`, {
      headers: { Authorization: auth },
      cache: "no-store",
    });
    if (me.ok) return true;
  }

  // Fallback: refresh cookie from the sales auth API.
  if (cookie) {
    const refreshed = await fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      headers: { Cookie: cookie },
      cache: "no-store",
    });
    if (!refreshed.ok) return false;
    const data = (await refreshed.json().catch(() => null)) as { access_token?: string } | null;
    const access = data?.access_token;
    if (!access) return false;
    const me = await fetch(`${API_BASE}/account/me`, {
      headers: { Authorization: `Bearer ${access}` },
      cache: "no-store",
    });
    return me.ok;
  }

  return false;
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ file: string }> },
) {
  const { file } = await ctx.params;
  const safe = path.basename(String(file || ""));
  if (!ALLOWED.has(safe)) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const ok = await customerAuthorized(req);
  if (!ok) {
    return NextResponse.json(
      { error: "Login required", login: "/login?next=/installers" },
      { status: 401 },
    );
  }

  try {
    const diskPath = path.join(process.cwd(), "public", "downloads", safe);
    const bytes = await readFile(diskPath);
    const ext = path.extname(safe).toLowerCase();
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": CONTENT_TYPE[ext] || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${safe}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "File unavailable" }, { status: 404 });
  }
}
