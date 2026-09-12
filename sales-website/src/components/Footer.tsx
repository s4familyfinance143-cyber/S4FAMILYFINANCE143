"use client";

import Link from "next/link";
import { site, products } from "@/lib/site";
import { useI18n } from "@/components/LanguageProvider";
import type { Dict } from "@/lib/i18n";

const legal: { key: keyof Dict; href: string }[] = [
  { key: "legalPrivacy", href: "/legal/privacy" },
  { key: "legalTerms", href: "/legal/terms" },
  { key: "legalRefund", href: "/legal/refund" },
  { key: "legalEula", href: "/legal/eula" },
  { key: "legalCookie", href: "/legal/cookie" },
  { key: "legalSecurity", href: "/legal/security" },
  { key: "legalAcceptableUse", href: "/legal/acceptable-use" },
];

export function Footer() {
  const { t } = useI18n();

  return (
    <footer className="mt-20 border-t border-line bg-panel/60">
      <div className="mx-auto grid max-w-[1220px] gap-10 px-5 py-14 md:grid-cols-4">
        <div className="md:col-span-1">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-accent to-accent2 text-sm font-black text-bg">
              S4
            </span>
            <span className="text-[15px] font-extrabold text-text">
              {site.domain}
            </span>
          </div>
          <p className="mt-4 text-sm text-muted">{t("footerTagline")}</p>
        </div>

        <div>
          <h3 className="text-sm font-bold uppercase tracking-wide text-muted">
            {t("footerSoftware")}
          </h3>
          <ul className="mt-4 space-y-2.5 text-sm">
            {products.map((p) => (
              <li key={p.slug}>
                <Link
                  href={p.href}
                  className="text-text/90 transition-colors hover:text-accent"
                >
                  {p.name}
                </Link>
              </li>
            ))}
            <li>
              <Link
                href="/installers"
                className="text-text/90 transition-colors hover:text-accent"
              >
                {t("footerDownloadCenter")}
              </Link>
            </li>
            <li>
              <Link
                href="/docs"
                className="text-text/90 transition-colors hover:text-accent"
              >
                {t("navDocs")}
              </Link>
            </li>
            <li>
              <Link
                href="/tutorials"
                className="text-text/90 transition-colors hover:text-accent"
              >
                {t("navTutorials")}
              </Link>
            </li>
          </ul>
        </div>

        <div>
          <h3 className="text-sm font-bold uppercase tracking-wide text-muted">
            {t("footerContact")}
          </h3>
          <ul className="mt-4 space-y-2.5 text-sm">
            <li>
              <a
                href={site.contact.whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-text/90 transition-colors hover:text-good"
              >
                WhatsApp: {site.contact.whatsappDisplay}
              </a>
            </li>
            <li>
              <a
                href={site.contact.emailUrl}
                className="break-all text-text/90 transition-colors hover:text-accent"
              >
                {site.contact.email}
              </a>
            </li>
            <li>
              <a
                href={site.contact.facebookUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-text/90 transition-colors hover:text-accent"
              >
                Facebook Page
              </a>
            </li>
            <li>
              <Link
                href="/support"
                className="text-text/90 transition-colors hover:text-accent"
              >
                {t("footerSupportCenter")}
              </Link>
            </li>
            <li>
              <Link
                href="/about"
                className="text-text/90 transition-colors hover:text-accent"
              >
                {t("navAbout")}
              </Link>
            </li>
          </ul>
        </div>

        <div>
          <h3 className="text-sm font-bold uppercase tracking-wide text-muted">
            {t("footerLegal")}
          </h3>
          <ul className="mt-4 space-y-2.5 text-sm">
            {legal.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  className="text-text/90 transition-colors hover:text-accent"
                >
                  {t(l.key)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="border-t border-line">
        <div className="mx-auto max-w-[1220px] px-5 py-6 text-center text-xs text-muted">
          © {new Date().getFullYear()} {site.domain}. {t("footerRights")} •{" "}
          {t("footerOfficial")}: {site.domain}
        </div>
      </div>
    </footer>
  );
}
