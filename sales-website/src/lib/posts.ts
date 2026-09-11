import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

export type Post = {
  id: string;
  text: string;
  imageUrl?: string;
  videoUrl?: string;
  createdAt: string;
};

const DATA_DIR = path.join(process.cwd(), "data");
const POSTS_FILE = path.join(DATA_DIR, "posts.json");
const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");

const IMAGE_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};
const VIDEO_TYPES: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/ogg": "ogv",
  "video/quicktime": "mov",
};

const MAX_IMAGE = 10 * 1024 * 1024; // 10 MB
const MAX_VIDEO = 100 * 1024 * 1024; // 100 MB
const MAX_TEXT = 5000;

async function ensureDirs() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
}

export async function listPosts(): Promise<Post[]> {
  await ensureDirs();
  try {
    const raw = await fs.readFile(POSTS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Post[]) : [];
  } catch {
    return [];
  }
}

async function writePosts(posts: Post[]) {
  await ensureDirs();
  await fs.writeFile(POSTS_FILE, JSON.stringify(posts, null, 2), "utf8");
}

function isFile(v: unknown): v is File {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as File).arrayBuffer === "function" &&
    typeof (v as File).size === "number" &&
    typeof (v as File).type === "string"
  );
}

async function saveMedia(file: File, kind: "image" | "video"): Promise<string> {
  const types = kind === "image" ? IMAGE_TYPES : VIDEO_TYPES;
  const max = kind === "image" ? MAX_IMAGE : MAX_VIDEO;
  const ext = types[file.type];
  if (!ext) {
    throw new Error(`Unsupported ${kind} type: ${file.type || "unknown"}`);
  }
  if (file.size > max) {
    throw new Error(
      `${kind} is too large (max ${Math.round(max / (1024 * 1024))} MB)`
    );
  }
  const name = `${crypto.randomUUID()}.${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(path.join(UPLOAD_DIR, name), buf);
  return `/uploads/${name}`;
}

export async function createPost(input: {
  text: string;
  image: FormDataEntryValue | null;
  video: FormDataEntryValue | null;
}): Promise<Post> {
  const text = (input.text ?? "").slice(0, MAX_TEXT).trim();

  let imageUrl: string | undefined;
  let videoUrl: string | undefined;

  if (isFile(input.image) && input.image.size > 0) {
    imageUrl = await saveMedia(input.image, "image");
  }
  if (isFile(input.video) && input.video.size > 0) {
    videoUrl = await saveMedia(input.video, "video");
  }

  if (!text && !imageUrl && !videoUrl) {
    throw new Error("Post is empty. Add a video, image or text.");
  }

  const post: Post = {
    id: crypto.randomUUID(),
    text,
    imageUrl,
    videoUrl,
    createdAt: new Date().toISOString(),
  };

  const posts = await listPosts();
  posts.unshift(post);
  await writePosts(posts);
  return post;
}

export async function deletePost(id: string): Promise<boolean> {
  const posts = await listPosts();
  const target = posts.find((p) => p.id === id);
  if (!target) return false;

  await writePosts(posts.filter((p) => p.id !== id));

  // Best-effort cleanup of uploaded media.
  for (const url of [target.imageUrl, target.videoUrl]) {
    if (url && url.startsWith("/uploads/")) {
      try {
        await fs.unlink(path.join(UPLOAD_DIR, path.basename(url)));
      } catch {
        /* ignore missing files */
      }
    }
  }
  return true;
}
