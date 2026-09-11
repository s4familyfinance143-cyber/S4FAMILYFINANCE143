import { NextResponse } from "next/server";
import { backendJson } from "@/lib/backendApi";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const res = await backendJson(`/orders/admin/${id}/receipt`);
  return NextResponse.json(res.ok ? res.data : { error: res.error }, { status: res.status });
}
