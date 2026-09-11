import { NextResponse } from "next/server";
import { backendJson } from "@/lib/backendApi";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q");
  const path = q ? `/customers/admin?q=${encodeURIComponent(q)}` : "/customers/admin";
  const res = await backendJson(path);
  return NextResponse.json(res.ok ? res.data : { error: res.error }, { status: res.status });
}
