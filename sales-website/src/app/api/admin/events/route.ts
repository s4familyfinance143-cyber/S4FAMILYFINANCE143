import { NextResponse } from "next/server";
import { backendJson } from "@/lib/backendApi";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const params = new URLSearchParams();
  const eventType = url.searchParams.get("event_type");
  const limit = url.searchParams.get("limit");
  if (eventType) params.set("event_type", eventType);
  if (limit) params.set("limit", limit);
  const query = params.toString();
  const res = await backendJson(`/events/admin${query ? `?${query}` : ""}`);
  return NextResponse.json(res.ok ? res.data : { error: res.error }, { status: res.status });
}
