import { NextResponse } from "next/server";
import { listPosts, createPost } from "@/lib/posts";

export const dynamic = "force-dynamic";

export async function GET() {
  const posts = await listPosts();
  return NextResponse.json(posts);
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const post = await createPost({
      text: String(form.get("text") ?? ""),
      image: form.get("image"),
      video: form.get("video"),
    });
    return NextResponse.json(post, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create post" },
      { status: 400 }
    );
  }
}
