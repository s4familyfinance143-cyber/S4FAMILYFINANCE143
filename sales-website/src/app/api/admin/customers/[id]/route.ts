import { NextResponse } from "next/server";
import { backendJson } from "@/lib/backendApi";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const res = await backendJson(`/customers/admin/${id}`);
  return NextResponse.json(res.ok ? res.data : { error: res.error }, { status: res.status });
}

export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const res = await backendJson(`/customers/admin/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  return NextResponse.json(res.ok ? res.data : { error: res.error }, { status: res.status });
}
