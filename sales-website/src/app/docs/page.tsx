"use client";

import Link from "next/link";
import { PageHeader, Note } from "@/components/PageHeader";
import { useI18n } from "@/components/LanguageProvider";
import { localizedProducts, localizedSupportResources } from "@/lib/site";
import type { Lang } from "@/lib/i18n";

type Copy = {
  title: string;
  sub: string;
  eyebrow: string;
  intro: string;
  sections: string;
  products: string;
  status: string;
  openSupport: string;
  readGuide: string;
};

const copy: Record<Lang, Copy> = {
  en: {
    title: "Documentation",
    sub: "Official guides for installation, licensing, downloads, accounts and troubleshooting.",
    eyebrow: "Self service",
    intro:
      "This documentation index follows the master website architecture. Full manuals, screenshots and product-specific articles can be added here as they are approved.",
    sections: "Documentation Sections",
    products: "Product Documentation",
    status: "Status",
    openSupport: "Open Support Center",
    readGuide: "Read guide",
  },
  bn: {
    title: "ডকুমেন্টেশন",
    sub: "ইনস্টলেশন, লাইসেন্স, ডাউনলোড, অ্যাকাউন্ট ও সমস্যা সমাধানের official guide।",
    eyebrow: "সেলফ সার্ভিস",
    intro:
      "এই documentation index master website architecture অনুসরণ করে। Approved হলে এখানে full manual, screenshot ও product-specific article যোগ করা যাবে।",
    sections: "ডকুমেন্টেশন সেকশন",
    products: "Product Documentation",
    status: "স্ট্যাটাস",
    openSupport: "সাপোর্ট সেন্টার খুলুন",
    readGuide: "গাইড পড়ুন",
  },
  hi: {
    title: "दस्तावेज़",
    sub: "Installation, license, download, account और troubleshooting के official guides।",
    eyebrow: "Self service",
    intro:
      "यह documentation index master website architecture को follow करता है। Approval के बाद full manuals, screenshots और product articles यहाँ जोड़े जा सकते हैं।",
    sections: "Documentation Sections",
    products: "Product Documentation",
    status: "Status",
    openSupport: "Support Center खोलें",
    readGuide: "Guide पढ़ें",
  },
  ur: {
    title: "دستاویزات",
    sub: "Installation، license، download، account اور troubleshooting کے official guides۔",
    eyebrow: "Self service",
    intro:
      "یہ documentation index master website architecture کو follow کرتا ہے۔ Approval کے بعد full manuals، screenshots اور product articles یہاں شامل کیے جا سکتے ہیں۔",
    sections: "Documentation Sections",
    products: "Product Documentation",
    status: "Status",
    openSupport: "Support Center کھولیں",
    readGuide: "Guide پڑھیں",
  },
  ar: {
    title: "التوثيق",
    sub: "أدلة رسمية للتثبيت والترخيص والتنزيل والحساب واستكشاف الأخطاء.",
    eyebrow: "الخدمة الذاتية",
    intro:
      "يتبع فهرس التوثيق هذا بنية الموقع الرئيسية. يمكن إضافة الأدلة الكاملة والصور والمقالات الخاصة بالمنتج بعد اعتمادها.",
    sections: "أقسام التوثيق",
    products: "توثيق المنتجات",
    status: "الحالة",
    openSupport: "فتح مركز الدعم",
    readGuide: "قراءة الدليل",
  },
};

const guideLinks = [
  { title: "Installation guide", href: "/installers", status: "ready" },
  { title: "Account and security", href: "/account", status: "ready" },
  { title: "Download and release notes", href: "/installers", status: "ready" },
  { title: "License activation", href: "/account", status: "ready" },
  { title: "Troubleshooting", href: "/support", status: "ready" },
] as const;

const quickGuides = [
  {
    title: "Install and update safely",
    steps: ["Download from the official download center", "Check version and file name", "Keep a backup before updating"],
  },
  {
    title: "Use customer account",
    steps: ["Register with a real email", "Verify the code", "Keep sessions and password updated"],
  },
  {
    title: "Manage licenses",
    steps: ["Check active licenses in account", "Use activation only on your own devices", "Open support if seat limit needs review"],
  },
] as const;

function statusClass(status: string) {
  return status === "ready"
    ? "border-good/40 bg-good/10 text-good"
    : status === "planned"
      ? "border-warn/40 bg-warn/10 text-warn"
      : "border-accent/40 bg-accent/10 text-accent";
}

export default function DocsPage() {
  const { lang } = useI18n();
  const c = copy[lang] ?? copy.en;
  const resources = localizedSupportResources(lang);
  const products = localizedProducts(lang);

  return (
    <>
      <PageHeader eyebrow={c.eyebrow} title={c.title} subtitle={c.sub} />
      <section className="mx-auto max-w-[1220px] px-5 py-14">
        <Note tone="good">{c.intro}</Note>

        <div className="mt-10 grid gap-6 lg:grid-cols-[1.35fr_.65fr]">
          <div>
            <h2 className="text-2xl font-extrabold text-text">{c.sections}</h2>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {resources.map((resource) => (
                <article
                  key={resource.category}
                  className="rounded-2xl border border-line bg-white/[0.02] p-5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-base font-bold text-text">{resource.title}</h3>
                    <span
                      className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase ${statusClass(resource.status)}`}
                    >
                      {resource.status}
                    </span>
                  </div>
                  <p className="mt-3 text-sm text-muted">{resource.description}</p>
                  <Link
                    href={resource.href ?? "/support"}
                    className="mt-4 inline-flex text-sm font-bold text-accent hover:underline"
                  >
                    {c.readGuide}
                  </Link>
                </article>
              ))}
            </div>
          </div>

          <aside className="rounded-3xl border border-line bg-panel/50 p-6">
            <h2 className="text-xl font-extrabold text-text">{c.status}</h2>
            <div className="mt-5 space-y-3">
              {guideLinks.map((guide) => (
                <Link
                  key={guide.title}
                  href={guide.href}
                  className="flex items-center justify-between gap-3 rounded-xl border border-line bg-bg/40 px-4 py-3 text-sm transition-colors hover:border-accent"
                >
                  <span className="font-semibold text-text">{guide.title}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${statusClass(guide.status)}`}>
                    {guide.status}
                  </span>
                </Link>
              ))}
            </div>
            <Link
              href="/support"
              className="mt-6 inline-flex w-full justify-center rounded-xl bg-accent px-5 py-3 text-sm font-bold text-bg transition-opacity hover:opacity-90"
            >
              {c.openSupport}
            </Link>
          </aside>
        </div>

        <div className="mt-12">
          <h2 className="text-2xl font-extrabold text-text">Quick Start Guides</h2>
          <div className="mt-5 grid gap-5 md:grid-cols-3">
            {quickGuides.map((guide) => (
              <article key={guide.title} className="rounded-2xl border border-line bg-white/[0.02] p-6">
                <h3 className="text-base font-extrabold text-text">{guide.title}</h3>
                <ol className="mt-4 space-y-2 text-sm text-muted">
                  {guide.steps.map((step, index) => (
                    <li key={step}>
                      <span className="font-bold text-accent">{index + 1}.</span> {step}
                    </li>
                  ))}
                </ol>
              </article>
            ))}
          </div>
        </div>

        <div className="mt-12">
          <h2 className="text-2xl font-extrabold text-text">{c.products}</h2>
          <div className="mt-5 grid gap-5 md:grid-cols-2">
            {products.map((product) => (
              <article key={product.slug} className="rounded-2xl border border-line bg-white/[0.02] p-6">
                <h3 className="text-lg font-extrabold text-text">{product.name}</h3>
                <p className="mt-2 text-sm text-muted">{product.description}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {product.features.slice(0, 3).map((feature) => (
                    <span key={feature} className="rounded-full border border-line px-3 py-1 text-xs text-muted">
                      {feature}
                    </span>
                  ))}
                </div>
                <Link
                  href={product.href}
                  className="mt-5 inline-flex rounded-xl border border-line px-4 py-2 text-sm font-bold text-text transition-colors hover:border-accent hover:text-accent"
                >
                  {product.name}
                </Link>
              </article>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
