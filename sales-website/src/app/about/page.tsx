"use client";

import Link from "next/link";
import { PageHeader, Note } from "@/components/PageHeader";
import { useI18n } from "@/components/LanguageProvider";
import { localizedProducts, site } from "@/lib/site";
import type { Lang } from "@/lib/i18n";

type Copy = {
  title: string;
  sub: string;
  eyebrow: string;
  missionTitle: string;
  mission: string;
  promiseTitle: string;
  productsTitle: string;
  contactTitle: string;
  officialNotice: string;
  viewProducts: string;
  contactUs: string;
};

const copy: Record<Lang, Copy> = {
  en: {
    title: "About S4BUSINESSTHINKING",
    sub: "Official software brand for spare parts inventory and family finance management.",
    eyebrow: "Company",
    missionTitle: "Our Mission",
    mission:
      "S4BUSINESSTHINKING builds practical software for real business and family finance workflows: inventory, accounts, licensing, downloads and support under one official website.",
    promiseTitle: "What This Website Provides",
    productsTitle: "Official Software",
    contactTitle: "Official Contact",
    officialNotice:
      "This website is the official source for product information, pricing, downloads, license support, release updates and customer assistance.",
    viewProducts: "View Products",
    contactUs: "Contact Us",
  },
  bn: {
    title: "S4BUSINESSTHINKING সম্পর্কে",
    sub: "Spare parts inventory ও family finance management-এর official software brand।",
    eyebrow: "কোম্পানি",
    missionTitle: "আমাদের লক্ষ্য",
    mission:
      "S4BUSINESSTHINKING বাস্তব business ও family finance workflow-এর জন্য practical software তৈরি করে: inventory, accounts, licensing, downloads ও support এক official website-এর অধীনে।",
    promiseTitle: "এই website যা প্রদান করে",
    productsTitle: "Official Software",
    contactTitle: "Official Contact",
    officialNotice:
      "Product information, pricing, downloads, license support, release update ও customer assistance-এর official source এই website।",
    viewProducts: "পণ্য দেখুন",
    contactUs: "যোগাযোগ করুন",
  },
  hi: {
    title: "S4BUSINESSTHINKING के बारे में",
    sub: "Spare parts inventory और family finance management का official software brand।",
    eyebrow: "Company",
    missionTitle: "हमारा मिशन",
    mission:
      "S4BUSINESSTHINKING real business और family finance workflows के लिए practical software बनाता है: inventory, accounts, licensing, downloads और support एक official website के तहत।",
    promiseTitle: "यह website क्या देती है",
    productsTitle: "Official Software",
    contactTitle: "Official Contact",
    officialNotice:
      "Product information, pricing, downloads, license support, release updates और customer assistance के लिए यह official source है।",
    viewProducts: "Products देखें",
    contactUs: "Contact करें",
  },
  ur: {
    title: "S4BUSINESSTHINKING کے بارے میں",
    sub: "Spare parts inventory اور family finance management کا official software brand۔",
    eyebrow: "Company",
    missionTitle: "ہمارا مقصد",
    mission:
      "S4BUSINESSTHINKING real business اور family finance workflows کے لیے practical software بناتا ہے: inventory، accounts، licensing، downloads اور support ایک official website کے تحت۔",
    promiseTitle: "یہ website کیا فراہم کرتی ہے",
    productsTitle: "Official Software",
    contactTitle: "Official Contact",
    officialNotice:
      "Product information، pricing، downloads، license support، release updates اور customer assistance کے لیے یہ official source ہے۔",
    viewProducts: "Products دیکھیں",
    contactUs: "Contact کریں",
  },
  ar: {
    title: "حول S4BUSINESSTHINKING",
    sub: "العلامة الرسمية لبرامج مخزون قطع الغيار وإدارة مالية الأسرة.",
    eyebrow: "الشركة",
    missionTitle: "مهمتنا",
    mission:
      "تبني S4BUSINESSTHINKING برامج عملية لسير عمل الأعمال والمالية العائلية: المخزون والحسابات والترخيص والتنزيلات والدعم ضمن موقع رسمي واحد.",
    promiseTitle: "ما يوفره هذا الموقع",
    productsTitle: "البرامج الرسمية",
    contactTitle: "التواصل الرسمي",
    officialNotice:
      "هذا الموقع هو المصدر الرسمي لمعلومات المنتجات والأسعار والتنزيلات ودعم الترخيص وتحديثات الإصدارات ومساعدة العملاء.",
    viewProducts: "عرض المنتجات",
    contactUs: "اتصل بنا",
  },
};

const promises = [
  "Official product information",
  "Download and release updates",
  "Pricing and purchase requests",
  "License and account support",
  "Documentation and tutorials",
  "Customer support channels",
] as const;

export default function AboutPage() {
  const { lang } = useI18n();
  const c = copy[lang] ?? copy.en;
  const products = localizedProducts(lang);

  return (
    <>
      <PageHeader eyebrow={c.eyebrow} title={c.title} subtitle={c.sub} />
      <section className="mx-auto max-w-[1220px] px-5 py-14">
        <div className="grid gap-8 lg:grid-cols-[1.2fr_.8fr]">
          <div className="rounded-3xl border border-line bg-white/[0.02] p-7">
            <h2 className="text-2xl font-extrabold text-text">{c.missionTitle}</h2>
            <p className="mt-4 text-muted">{c.mission}</p>
            <div className="mt-7">
              <Note tone="good">{c.officialNotice}</Note>
            </div>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link
                href="/products"
                className="rounded-xl bg-accent px-5 py-3 text-sm font-bold text-bg transition-opacity hover:opacity-90"
              >
                {c.viewProducts}
              </Link>
              <Link
                href="/contact"
                className="rounded-xl border border-line px-5 py-3 text-sm font-bold text-text transition-colors hover:border-accent hover:text-accent"
              >
                {c.contactUs}
              </Link>
            </div>
          </div>

          <aside className="rounded-3xl border border-line bg-panel/50 p-7">
            <h2 className="text-xl font-extrabold text-text">{c.contactTitle}</h2>
            <div className="mt-5 space-y-3 text-sm">
              <a className="block text-good hover:underline" href={site.contact.whatsappUrl} target="_blank" rel="noopener noreferrer">
                WhatsApp: {site.contact.whatsappDisplay}
              </a>
              <a className="block break-all text-accent hover:underline" href={site.contact.emailUrl}>
                {site.contact.email}
              </a>
              <a className="block text-accent hover:underline" href={site.contact.facebookUrl} target="_blank" rel="noopener noreferrer">
                Facebook Page
              </a>
            </div>
          </aside>
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-2">
          <section>
            <h2 className="text-2xl font-extrabold text-text">{c.productsTitle}</h2>
            <div className="mt-5 grid gap-5">
              {products.map((product) => (
                <Link
                  key={product.slug}
                  href={product.href}
                  className="rounded-2xl border border-line bg-white/[0.02] p-6 transition-colors hover:border-accent"
                >
                  <h3 className="text-lg font-extrabold text-text">{product.name}</h3>
                  <p className="mt-2 text-sm text-muted">{product.short}</p>
                </Link>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-extrabold text-text">{c.promiseTitle}</h2>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {promises.map((item) => (
                <div key={item} className="rounded-2xl border border-line bg-white/[0.02] p-5 text-sm font-semibold text-text">
                  {item}
                </div>
              ))}
            </div>
          </section>
        </div>
      </section>
    </>
  );
}
