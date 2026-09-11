"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useI18n } from "@/components/LanguageProvider";
import { PageHeader } from "@/components/PageHeader";
import { PostCard } from "@/components/PostCard";
import type { Post } from "@/lib/posts";
import type { Lang } from "@/lib/i18n";

type Copy = { title: string; sub: string; empty: string; create: string };

const copy: Record<Lang, Copy> = {
  en: {
    title: "Updates",
    sub: "Latest news, announcements and posts.",
    empty: "No posts yet.",
    create: "Create Post",
  },
  bn: {
    title: "আপডেট",
    sub: "সর্বশেষ খবর, ঘোষণা ও পোস্ট।",
    empty: "এখনো কোনো পোস্ট নেই।",
    create: "নতুন পোস্ট",
  },
  hi: {
    title: "अपडेट",
    sub: "ताज़ा समाचार, घोषणाएँ और पोस्ट।",
    empty: "अभी कोई पोस्ट नहीं है।",
    create: "पोस्ट बनाएँ",
  },
  ur: {
    title: "اپڈیٹس",
    sub: "تازہ ترین خبریں، اعلانات اور پوسٹس۔",
    empty: "ابھی کوئی پوسٹ نہیں۔",
    create: "پوسٹ بنائیں",
  },
  ar: {
    title: "التحديثات",
    sub: "أحدث الأخبار والإعلانات والمنشورات.",
    empty: "لا توجد منشورات بعد.",
    create: "إنشاء منشور",
  },
};

export default function UpdatesPage() {
  const { lang } = useI18n();
  const c = copy[lang] ?? copy.en;
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/posts", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => setPosts(Array.isArray(data) ? data : []))
      .catch(() => setPosts([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <PageHeader title={c.title} subtitle={c.sub} />
      <section className="mx-auto max-w-[760px] px-5 py-14">
        <div className="mb-8 flex justify-end">
          <Link
            href="/admin/posts"
            className="rounded-xl bg-accent px-5 py-2.5 text-sm font-bold text-bg transition-opacity hover:opacity-90"
          >
            + {c.create}
          </Link>
        </div>

        {loading ? (
          <p className="text-center text-muted">…</p>
        ) : posts.length === 0 ? (
          <p className="rounded-2xl border border-line bg-white/[0.02] p-10 text-center text-muted">
            {c.empty}
          </p>
        ) : (
          <div className="flex flex-col gap-6">
            {posts.map((p) => (
              <PostCard key={p.id} post={p} lang={lang} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
