import { NextResponse } from "next/server";
import { deletePost } from "@/lib/posts";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const removed = await deletePost(id);
  if (!removed) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
