import { NextResponse } from "next/server";
import { backendJson } from "@/lib/backendApi";

export const dynamic = "force-dynamic";

export async function GET() {
  const res = await backendJson("/payments/admin");
  return NextResponse.json(res.ok ? res.data : { error: res.error }, { status: res.status });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const res = await backendJson("/payments/admin", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return NextResponse.json(res.ok ? res.data : { error: res.error }, { status: res.status });
}
