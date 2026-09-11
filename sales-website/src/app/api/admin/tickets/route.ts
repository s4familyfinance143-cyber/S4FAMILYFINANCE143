import { NextResponse } from "next/server";
import { backendJson } from "@/lib/backendApi";

export const dynamic = "force-dynamic";

export async function GET() {
  const res = await backendJson("/support/admin/tickets");
  return NextResponse.json(res.ok ? res.data : { error: res.error }, { status: res.status });
}
