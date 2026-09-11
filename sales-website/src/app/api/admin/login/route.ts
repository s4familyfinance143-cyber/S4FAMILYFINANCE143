import { NextResponse } from "next/server";
import { verifyAdminCredentials } from "@/lib/auth";
import {
  createSessionToken,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
} from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let username = "";
  let password = "";

  const ctype = req.headers.get("content-type") ?? "";
  if (ctype.includes("application/json")) {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    username = String(body.username ?? "");
    password = String(body.password ?? "");
  } else {
    const form = await req.formData();
    username = String(form.get("username") ?? "");
    password = String(form.get("password") ?? "");
  }

  if (!verifyAdminCredentials(username, password)) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const token = await createSessionToken(username);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
