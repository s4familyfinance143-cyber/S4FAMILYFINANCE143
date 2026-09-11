import type { Post } from "@/lib/posts";

const localeMap: Record<string, string> = {
  en: "en-US",
  bn: "bn-BD",
  hi: "hi-IN",
  ur: "ur-PK",
  ar: "ar",
};

export function PostCard({
  post,
  lang = "en",
  onDelete,
  deleteLabel = "Delete",
}: {
  post: Post;
  lang?: string;
  onDelete?: (id: string) => void;
  deleteLabel?: string;
}) {
  let date = post.createdAt;
  try {
    date = new Intl.DateTimeFormat(localeMap[lang] ?? "en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(post.createdAt));
  } catch {
    /* keep raw */
  }

  return (
    <article className="overflow-hidden rounded-3xl border border-line bg-white/[0.02]">
      {post.videoUrl && (
        <video
          controls
          preload="metadata"
          className="max-h-[520px] w-full bg-black"
          src={post.videoUrl}
        />
      )}
      {post.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={post.imageUrl}
          alt=""
          className="max-h-[520px] w-full object-cover"
        />
      )}
      <div className="p-6">
        {post.text && (
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-text">
            {post.text}
          </p>
        )}
        <div className="mt-4 flex items-center justify-between">
          <time className="text-xs text-muted">{date}</time>
          {onDelete && (
            <button
              type="button"
              onClick={() => onDelete(post.id)}
              className="rounded-lg border border-danger/50 px-3 py-1.5 text-xs font-semibold text-danger transition-colors hover:bg-danger/10"
            >
              {deleteLabel}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
