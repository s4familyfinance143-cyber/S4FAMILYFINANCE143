import { NextResponse } from "next/server";
import { backendJson } from "@/lib/backendApi";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const res = await backendJson(`/support/admin/tickets/${id}/messages`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return NextResponse.json(res.ok ? res.data : { error: res.error }, { status: res.status });
}
