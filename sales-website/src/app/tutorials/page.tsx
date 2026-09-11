"use client";

import Link from "next/link";
import { PageHeader, Note } from "@/components/PageHeader";
import { useI18n } from "@/components/LanguageProvider";
import type { Lang } from "@/lib/i18n";

type Copy = {
  title: string;
  sub: string;
  eyebrow: string;
  intro: string;
  playlist: string;
  checklist: string;
  openDocs: string;
  requestHelp: string;
};

const copy: Record<Lang, Copy> = {
  en: {
    title: "Tutorials",
    sub: "Step-by-step learning path for setup, licensing, backup, reports and support.",
    eyebrow: "Training",
    intro:
      "Tutorial videos are part of the master architecture. The playlist structure is ready; final videos can be attached after recording and approval.",
    playlist: "Tutorial Playlist",
    checklist: "Checklist",
    openDocs: "Open Documentation",
    requestHelp: "Request Help",
  },
  bn: {
    title: "টিউটোরিয়াল",
    sub: "সেটআপ, লাইসেন্স, ব্যাকআপ, রিপোর্ট ও সাপোর্ট শেখার ধাপে ধাপে পথ।",
    eyebrow: "ট্রেনিং",
    intro:
      "Tutorial video master architecture-এর অংশ। Playlist structure প্রস্তুত আছে; final video record ও approve হলে যুক্ত করা যাবে।",
    playlist: "টিউটোরিয়াল প্লেলিস্ট",
    checklist: "চেকলিস্ট",
    openDocs: "ডকুমেন্টেশন খুলুন",
    requestHelp: "সহায়তা নিন",
  },
  hi: {
    title: "ट्यूटोरियल",
    sub: "Setup, license, backup, reports और support के लिए step-by-step learning path।",
    eyebrow: "Training",
    intro:
      "Tutorial videos master architecture का हिस्सा हैं। Playlist structure तैयार है; final videos approval के बाद जोड़े जा सकते हैं।",
    playlist: "Tutorial Playlist",
    checklist: "Checklist",
    openDocs: "Documentation खोलें",
    requestHelp: "Help माँगें",
  },
  ur: {
    title: "ٹیوٹوریلز",
    sub: "Setup، license، backup، reports اور support کے لیے step-by-step learning path۔",
    eyebrow: "Training",
    intro:
      "Tutorial videos master architecture کا حصہ ہیں۔ Playlist structure تیار ہے؛ final videos approval کے بعد شامل کیے جا سکتے ہیں۔",
    playlist: "Tutorial Playlist",
    checklist: "Checklist",
    openDocs: "Documentation کھولیں",
    requestHelp: "Help لیں",
  },
  ar: {
    title: "الدروس",
    sub: "مسار تعلم خطوة بخطوة للإعداد والترخيص والنسخ الاحتياطي والتقارير والدعم.",
    eyebrow: "التدريب",
    intro:
      "تعد فيديوهات الدروس جزءًا من البنية الرئيسية. هيكل قائمة التشغيل جاهز، ويمكن إرفاق الفيديوهات النهائية بعد التسجيل والاعتماد.",
    playlist: "قائمة الدروس",
    checklist: "قائمة تحقق",
    openDocs: "فتح التوثيق",
    requestHelp: "طلب مساعدة",
  },
};

const tutorials = [
  {
    title: "Install on Windows",
    description: "Download, verify checksum, install and open the software safely.",
    category: "Setup",
    steps: ["Download from official site", "Verify version and file name", "Install as the intended Windows user"],
  },
  {
    title: "Install on Android",
    description: "Prepare the device, install the APK and confirm app permissions.",
    category: "Setup",
    steps: ["Use trusted APK source", "Allow install only when needed", "Confirm permissions before login"],
  },
  {
    title: "Create account and verify email",
    description: "Register, verify OTP and secure the customer account.",
    category: "Account",
    steps: ["Register with real email", "Enter verification code", "Use a strong password"],
  },
  {
    title: "Activate license and manage devices",
    description: "Use a license key, register devices and understand activation limits.",
    category: "License",
    steps: ["Open account license panel", "Activate only trusted devices", "Deactivate unused devices if needed"],
  },
  {
    title: "Backup and restore workflow",
    description: "Plan local backups, restore safely and avoid data loss.",
    category: "Safety",
    steps: ["Create regular backup", "Store copy outside device", "Test restore before emergency"],
  },
  {
    title: "Open and track support tickets",
    description: "Create a ticket, reply with details and close the issue after resolution.",
    category: "Support",
    steps: ["Describe product and platform", "Attach payment/license details if relevant", "Reply until resolved"],
  },
] as const;

export default function TutorialsPage() {
  const { lang } = useI18n();
  const c = copy[lang] ?? copy.en;

  return (
    <>
      <PageHeader eyebrow={c.eyebrow} title={c.title} subtitle={c.sub} />
      <section className="mx-auto max-w-[1220px] px-5 py-14">
        <Note tone="good">{c.intro}</Note>

        <div className="mt-10 flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-2xl font-extrabold text-text">{c.playlist}</h2>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/docs"
              className="rounded-xl border border-line px-5 py-2.5 text-sm font-bold text-text transition-colors hover:border-accent hover:text-accent"
            >
              {c.openDocs}
            </Link>
            <Link
              href="/support"
              className="rounded-xl bg-accent px-5 py-2.5 text-sm font-bold text-bg transition-opacity hover:opacity-90"
            >
              {c.requestHelp}
            </Link>
          </div>
        </div>

        <div className="mt-6 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {tutorials.map((item, index) => (
            <article
              key={item.title}
              className="flex min-h-64 flex-col rounded-3xl border border-line bg-gradient-to-b from-white/[0.035] to-white/[0.015] p-6 shadow-[0_18px_40px_rgba(0,0,0,.20)]"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs font-bold text-accent">
                  {item.category}
                </span>
                <span className="text-xs font-bold text-muted">{String(index + 1).padStart(2, "0")}</span>
              </div>
              <h3 className="mt-5 text-lg font-extrabold text-text">{item.title}</h3>
              <p className="mt-3 flex-1 text-sm text-muted">{item.description}</p>
              <div className="mt-6 rounded-xl border border-line bg-bg/40 p-4">
                <p className="text-sm font-extrabold text-text">{c.checklist}</p>
                <ol className="mt-3 space-y-2 text-sm text-muted">
                  {item.steps.map((step, stepIndex) => (
                    <li key={step}>
                      <span className="font-bold text-accent">{stepIndex + 1}.</span> {step}
                    </li>
                  ))}
                </ol>
              </div>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
