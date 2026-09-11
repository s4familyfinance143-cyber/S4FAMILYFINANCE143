"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { localizedProducts, site } from "@/lib/site";
import { useI18n } from "@/components/LanguageProvider";
import { PageHeader } from "@/components/PageHeader";

export default function ProductDetailPage() {
  const { t, lang } = useI18n();
  const params = useParams<{ slug: string }>();
  const products = localizedProducts(lang);
  const product = products.find((p) => p.slug === params.slug);

  if (!product) {
    return (
      <section className="mx-auto max-w-[1220px] px-5 py-24 text-center">
        <h1 className="text-2xl font-black text-text">404</h1>
        <p className="mt-3 text-muted">Software not found.</p>
        <Link
          href="/products"
          className="mt-6 inline-block rounded-xl bg-accent px-6 py-3 text-sm font-bold text-bg"
        >
          {t("allSoftware")}
        </Link>
      </section>
    );
  }

  const accentBg = product.accent === "accent" ? "bg-accent" : "bg-accent2";
  const accentText =
    product.accent === "accent" ? "text-accent" : "text-accent2";

  return (
    <>
      <PageHeader
        eyebrow={product.short}
        title={product.name}
        subtitle={product.description}
      />

      <section className="mx-auto max-w-[1220px] px-5 py-14">
        <div className="grid gap-10 lg:grid-cols-[1.6fr_1fr]">
          <div>
            <h2 className="text-xl font-extrabold text-text">
              {t("pdFeatures")}
            </h2>
            <ul className="mt-5 grid gap-3 sm:grid-cols-2">
              {product.features.map((f) => (
                <li
                  key={f}
                  className="flex gap-2 rounded-xl border border-line bg-white/[0.02] p-4 text-sm text-text/90"
                >
                  <span className={accentText}>▹</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>

            <h2 className="mt-10 text-xl font-extrabold text-text">
              {t("pdAvailableOn")}
            </h2>
            <div className="mt-4 flex flex-wrap gap-2">
              {product.platforms.map((plat) => (
                <span
                  key={plat}
                  className="rounded-full border border-line px-4 py-1.5 text-sm text-muted"
                >
                  {plat}
                </span>
              ))}
            </div>
          </div>

          <aside className="h-fit rounded-3xl border border-line bg-panel/50 p-6">
            <div className="flex items-center gap-3">
              <span
                className={`grid h-12 w-12 place-items-center rounded-2xl text-lg font-black text-bg ${accentBg}`}
              >
                S4
              </span>
              <div>
                <h3 className="font-extrabold text-text">{product.name}</h3>
                <p className="text-xs text-muted">{product.short}</p>
              </div>
            </div>

            <div className="mt-6 flex flex-col gap-2.5">
              <Link
                href="/downloads"
                className={`rounded-xl px-5 py-3 text-center text-sm font-bold text-bg transition-opacity hover:opacity-90 ${accentBg}`}
              >
                {t("download")}
              </Link>
              <Link
                href="/pricing"
                className="rounded-xl border border-line px-5 py-3 text-center text-sm font-semibold text-text transition-colors hover:border-accent hover:text-accent"
              >
                {t("pdBuyLicense")}
              </Link>
              <Link
                href="/demo"
                className="rounded-xl border border-line px-5 py-3 text-center text-sm font-semibold text-text transition-colors hover:border-accent hover:text-accent"
              >
                {t("ctaRequestDemo")}
              </Link>
              <a
                href={site.contact.whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-xl border border-line px-5 py-3 text-center text-sm font-semibold text-text transition-colors hover:border-good hover:text-good"
              >
                {t("ctaGetSupport")}
              </a>
            </div>
          </aside>
        </div>

        <div className="mt-12">
          <Link
            href="/products"
            className="text-sm font-semibold text-accent hover:underline"
          >
            ← {t("allSoftware")}
          </Link>
        </div>
      </section>
    </>
  );
}
