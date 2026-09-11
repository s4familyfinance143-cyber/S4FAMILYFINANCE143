"use client";

import Link from "next/link";
import { localizedProducts } from "@/lib/site";
import { useI18n } from "@/components/LanguageProvider";
import { PageHeader } from "@/components/PageHeader";

export default function ProductsPage() {
  const { t, lang } = useI18n();
  const products = localizedProducts(lang);

  return (
    <>
      <PageHeader
        eyebrow={t("heroBadge")}
        title={t("productsHeading")}
        subtitle={t("productsSub")}
      />
      <section className="mx-auto max-w-[1220px] px-5 py-14">
        <div className="grid gap-6 md:grid-cols-2">
          {products.map((p) => (
              <article
                key={p.slug}
                className="flex flex-col rounded-3xl border border-line bg-gradient-to-b from-white/[0.035] to-white/[0.015] p-7"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`grid h-11 w-11 place-items-center rounded-2xl text-lg font-black text-bg ${
                      p.accent === "accent" ? "bg-accent" : "bg-accent2"
                    }`}
                  >
                    S4
                  </span>
                  <div>
                    <h2 className="text-lg font-extrabold text-text">
                      {p.name}
                    </h2>
                    <p className="text-sm text-muted">{p.short}</p>
                  </div>
                </div>
                <p className="mt-4 text-sm text-muted">{p.description}</p>
                <ul className="mt-4 flex-1 space-y-2 text-sm text-text/90">
                  {p.features.map((f) => (
                    <li key={f} className="flex gap-2">
                      <span
                        className={
                          p.accent === "accent" ? "text-accent" : "text-accent2"
                        }
                      >
                        ▹
                      </span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  href={p.href}
                  className={`mt-6 rounded-xl px-5 py-3 text-center text-sm font-bold text-bg transition-opacity hover:opacity-90 ${
                    p.accent === "accent" ? "bg-accent" : "bg-accent2"
                  }`}
                >
                  {t("viewSoftware")}
                </Link>
              </article>
          ))}
        </div>
      </section>
    </>
  );
}
