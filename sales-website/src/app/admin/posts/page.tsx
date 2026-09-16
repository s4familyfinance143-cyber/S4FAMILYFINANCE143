"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/LanguageProvider";
import { PageHeader, Note } from "@/components/PageHeader";
import { PostCard } from "@/components/PostCard";
import { AdminNav } from "@/components/AdminNav";
import type { Post } from "@/lib/posts";
import type { Lang } from "@/lib/i18n";

type Copy = {
  title: string;
  sub: string;
  video: string;
  image: string;
  text: string;
  textPh: string;
  publish: string;
  publishing: string;
  manage: string;
  empty: string;
  delete: string;
  deleteConfirm: string;
  note: string;
  success: string;
  view: string;
  logout: string;
};

const copy: Record<Lang, Copy> = {
  en: {
    title: "Create Post",
    sub: "Add a video, an image and text. It will appear on the Updates page.",
    video: "Video (mp4, webm, mov · max 100MB)",
    image: "Image (jpg, png, webp, gif · max 10MB)",
    text: "Text",
    textPh: "Write something...",
    publish: "Publish Post",
    publishing: "Publishing...",
    manage: "Published Posts",
    empty: "No posts yet.",
    delete: "Delete",
    deleteConfirm: "Delete this post?",
    note: "You are signed in. This screen is protected — only logged-in admins can publish or delete posts.",
    success: "Post published successfully.",
    view: "View Updates page",
    logout: "Logout",
  },
  bn: {
    title: "নতুন পোস্ট",
    sub: "একটি ভিডিও, একটি ছবি ও টেক্সট যোগ করুন। এটি Updates পেজে দেখাবে।",
    video: "ভিডিও (mp4, webm, mov · সর্বোচ্চ 100MB)",
    image: "ছবি (jpg, png, webp, gif · সর্বোচ্চ 10MB)",
    text: "টেক্সট",
    textPh: "কিছু লিখুন...",
    publish: "পোস্ট প্রকাশ করুন",
    publishing: "প্রকাশ হচ্ছে...",
    manage: "প্রকাশিত পোস্ট",
    empty: "এখনো কোনো পোস্ট নেই।",
    delete: "মুছুন",
    deleteConfirm: "এই পোস্টটি মুছবেন?",
    note: "আপনি লগইন করা আছেন। এই পেজ সুরক্ষিত — শুধু লগইন করা admin post প্রকাশ বা মুছতে পারবে।",
    success: "পোস্ট সফলভাবে প্রকাশিত হয়েছে।",
    view: "Updates পেজ দেখুন",
    logout: "লগআউট",
  },
  hi: {
    title: "पोस्ट बनाएँ",
    sub: "एक वीडियो, एक छवि और टेक्स्ट जोड़ें। यह अपडेट पेज पर दिखाई देगा।",
    video: "वीडियो (mp4, webm, mov · अधिकतम 100MB)",
    image: "छवि (jpg, png, webp, gif · अधिकतम 10MB)",
    text: "टेक्स्ट",
    textPh: "कुछ लिखें...",
    publish: "पोस्ट प्रकाशित करें",
    publishing: "प्रकाशित हो रहा है...",
    manage: "प्रकाशित पोस्ट",
    empty: "अभी कोई पोस्ट नहीं है।",
    delete: "हटाएँ",
    deleteConfirm: "यह पोस्ट हटाएँ?",
    note: "आप लॉग इन हैं। यह स्क्रीन सुरक्षित है — केवल लॉग-इन एडमिन ही पोस्ट प्रकाशित या हटा सकते हैं।",
    success: "पोस्ट सफलतापूर्वक प्रकाशित हुई।",
    view: "अपडेट पेज देखें",
    logout: "लॉगआउट",
  },
  ur: {
    title: "پوسٹ بنائیں",
    sub: "ایک ویڈیو، ایک تصویر اور ٹیکسٹ شامل کریں۔ یہ اپڈیٹس پیج پر ظاہر ہوگا۔",
    video: "ویڈیو (mp4, webm, mov · زیادہ سے زیادہ 100MB)",
    image: "تصویر (jpg, png, webp, gif · زیادہ سے زیادہ 10MB)",
    text: "ٹیکسٹ",
    textPh: "کچھ لکھیں...",
    publish: "پوسٹ شائع کریں",
    publishing: "شائع ہو رہا ہے...",
    manage: "شائع شدہ پوسٹس",
    empty: "ابھی کوئی پوسٹ نہیں۔",
    delete: "حذف کریں",
    deleteConfirm: "یہ پوسٹ حذف کریں؟",
    note: "آپ لاگ اِن ہیں۔ یہ اسکرین محفوظ ہے — صرف لاگ اِن ایڈمن پوسٹ شائع یا حذف کر سکتے ہیں۔",
    success: "پوسٹ کامیابی سے شائع ہوگئی۔",
    view: "اپڈیٹس پیج دیکھیں",
    logout: "لاگ آؤٹ",
  },
  ar: {
    title: "إنشاء منشور",
    sub: "أضف فيديو وصورة ونصًا. سيظهر في صفحة التحديثات.",
    video: "فيديو (mp4, webm, mov · حتى 100 ميغابايت)",
    image: "صورة (jpg, png, webp, gif · حتى 10 ميغابايت)",
    text: "النص",
    textPh: "اكتب شيئًا...",
    publish: "نشر المنشور",
    publishing: "جارٍ النشر...",
    manage: "المنشورات المنشورة",
    empty: "لا توجد منشورات بعد.",
    delete: "حذف",
    deleteConfirm: "حذف هذا المنشور؟",
    note: "أنت مسجّل الدخول. هذه الشاشة محمية — يمكن للمشرفين المسجّلين فقط نشر المنشورات أو حذفها.",
    success: "تم نشر المنشور بنجاح.",
    view: "عرض صفحة التحديثات",
    logout: "تسجيل الخروج",
  },
};

const inputCls =
  "w-full rounded-xl border border-line bg-panel/60 px-4 py-3 text-sm text-text file:mr-3 file:rounded-md file:border-0 file:bg-accent file:px-3 file:py-1.5 file:text-bg file:font-semibold placeholder:text-muted focus:border-accent";

export default function AdminPostsPage() {
  const { lang } = useI18n();
  const c = copy[lang] ?? copy.en;

  const [posts, setPosts] = useState<Post[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  async function load() {
    try {
      const r = await fetch("/api/posts", { cache: "no-store" });
      const data = await r.json();
      setPosts(Array.isArray(data) ? data : []);
    } catch {
      setPosts([]);
    }
  }

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      void load();
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setOkMsg("");
    setBusy(true);
    try {
      const fd = new FormData(e.currentTarget);
      const res = await fetch("/api/posts", { method: "POST", body: fd });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Failed to publish");
      }
      formRef.current?.reset();
      setText("");
      setOkMsg(c.success);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to publish");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm(c.deleteConfirm)) return;
    try {
      // fetch() does not reject on a non-2xx response — this never checked
      // res.ok, so a failed delete (404, 401 if the session expired, a 500)
      // silently fell through to load() and just looked like it worked.
      const res = await fetch(`/api/posts/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to delete post");
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete post");
    }
  }

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    window.location.href = "/admin/login";
  }

  return (
    <>
      <PageHeader eyebrow="Admin" title={c.title} subtitle={c.sub} />
      <section className="mx-auto max-w-[760px] px-5 py-14">
        <AdminNav />
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex-1">
            <Note tone="good">{c.note}</Note>
          </div>
          <button
            type="button"
            onClick={logout}
            className="shrink-0 rounded-xl border border-line px-4 py-2.5 text-sm font-semibold text-text transition-colors hover:border-danger hover:text-danger"
          >
            {c.logout}
          </button>
        </div>

        <form
          ref={formRef}
          onSubmit={submit}
          className="mt-8 flex flex-col gap-5 rounded-3xl border border-line bg-white/[0.02] p-7"
        >
          <div>
            <label className="mb-2 block text-sm font-semibold text-text">
              {c.video}
            </label>
            <input
              className={inputCls}
              type="file"
              name="video"
              accept="video/mp4,video/webm,video/ogg,video/quicktime"
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold text-text">
              {c.image}
            </label>
            <input
              className={inputCls}
              type="file"
              name="image"
              accept="image/png,image/jpeg,image/webp,image/gif"
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold text-text">
              {c.text}
            </label>
            <textarea
              className={`${inputCls} min-h-32 resize-y`}
              name="text"
              placeholder={c.textPh}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </div>

          {error && <p className="text-sm font-semibold text-danger">{error}</p>}
          {okMsg && <p className="text-sm font-semibold text-good">{okMsg}</p>}

          <div className="flex items-center justify-between gap-3">
            <Link
              href="/updates"
              className="text-sm font-semibold text-accent hover:underline"
            >
              {c.view} →
            </Link>
            <button
              type="submit"
              disabled={busy}
              className="rounded-xl bg-accent px-6 py-3 text-sm font-bold text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy ? c.publishing : c.publish}
            </button>
          </div>
        </form>

        <h2 className="mt-12 text-xl font-extrabold text-text">{c.manage}</h2>
        {posts.length === 0 ? (
          <p className="mt-4 text-muted">{c.empty}</p>
        ) : (
          <div className="mt-5 flex flex-col gap-6">
            {posts.map((p) => (
              <PostCard
                key={p.id}
                post={p}
                lang={lang}
                onDelete={remove}
                deleteLabel={c.delete}
              />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
