import { NextResponse } from "next/server";
import { BACKEND_API_BASE } from "@/lib/backendApi";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const form = await req.formData();
  const res = await fetch(`${BACKEND_API_BASE}/downloads/admin/releases/${id}/file`, {
    method: "POST",
    body: form,
    headers: {
      "X-Admin-Api-Key": process.env.ADMIN_API_KEY ?? "",
    },
  });
  const data = await res.json().catch(() => null);
  return NextResponse.json(res.ok ? data : { error: data?.detail ?? "Request failed." }, { status: res.status });
}
