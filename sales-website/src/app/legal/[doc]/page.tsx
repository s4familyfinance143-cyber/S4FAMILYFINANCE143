"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useI18n } from "@/components/LanguageProvider";
import { PageHeader, Note } from "@/components/PageHeader";
import { site } from "@/lib/site";
import type { Dict, Lang } from "@/lib/i18n";

const docTitleKey: Record<string, keyof Dict> = {
  privacy: "legalPrivacy",
  terms: "legalTerms",
  refund: "legalRefund",
  eula: "legalEula",
  cookie: "legalCookie",
  security: "legalSecurity",
  "acceptable-use": "legalAcceptableUse",
};

type Copy = { intro: string; note: string; effective: string; contact: string; businessInfo: string; businessName: string; address: string; jurisdiction: string };

const copy: Record<Lang, Copy> = {
  en: {
    intro:
      "This document explains how S4BUSINESSTHINKING.COM handles this area of our service. Please read it carefully.",
    note: "This public policy is prepared for launch readiness. If a signed invoice, receipt, or written agreement conflicts with this page, the signed document controls for that transaction.",
    effective: "Effective date",
    contact: "Questions about this policy",
    businessInfo: "Business information",
    businessName: "Business name",
    address: "Registered address",
    jurisdiction: "Jurisdiction",
  },
  bn: {
    intro:
      "এই ডকুমেন্টে S4BUSINESSTHINKING.COM আমাদের সার্ভিসের এই অংশটি কীভাবে পরিচালনা করে তা বর্ণনা করা হয়েছে। অনুগ্রহ করে মনোযোগ দিয়ে পড়ুন।",
    note: "এই public policy launch readiness-এর জন্য প্রস্তুত। কোনো signed invoice, receipt বা written agreement-এর সাথে এই page-এর conflict হলে ঐ signed document transaction-এর জন্য প্রযোজ্য হবে।",
    effective: "কার্যকর তারিখ",
    contact: "এই policy নিয়ে প্রশ্ন",
    businessInfo: "ব্যবসার তথ্য",
    businessName: "ব্যবসার নাম",
    address: "নিবন্ধিত ঠিকানা",
    jurisdiction: "এখতিয়ার",
  },
  hi: {
    intro:
      "यह दस्तावेज़ बताता है कि S4BUSINESSTHINKING.COM हमारी सेवा के इस हिस्से को कैसे संभालता है। कृपया इसे ध्यान से पढ़ें।",
    note: "यह public policy launch readiness के लिए तैयार है। यदि signed invoice, receipt या written agreement से इस page का conflict हो, तो उस transaction के लिए signed document लागू होगा।",
    effective: "Effective date",
    contact: "Policy questions",
    businessInfo: "Business information",
    businessName: "Business name",
    address: "Registered address",
    jurisdiction: "Jurisdiction",
  },
  ur: {
    intro:
      "یہ دستاویز بتاتی ہے کہ S4BUSINESSTHINKING.COM ہماری سروس کے اس حصے کو کیسے سنبھالتا ہے۔ براہِ کرم اسے غور سے پڑھیں۔",
    note: "یہ public policy launch readiness کے لیے تیار ہے۔ اگر signed invoice، receipt یا written agreement سے اس page کا conflict ہو تو اس transaction کے لیے signed document لاگو ہوگا۔",
    effective: "Effective date",
    contact: "Policy questions",
    businessInfo: "Business information",
    businessName: "Business name",
    address: "Registered address",
    jurisdiction: "Jurisdiction",
  },
  ar: {
    intro:
      "توضّح هذه الوثيقة كيفية تعامل S4BUSINESSTHINKING.COM مع هذا الجانب من خدمتنا. يُرجى قراءتها بعناية.",
    note: "تم إعداد هذه السياسة العامة للاستعداد للإطلاق. إذا تعارضت فاتورة أو إيصال أو اتفاقية مكتوبة موقعة مع هذه الصفحة، فإن المستند الموقع يحكم تلك المعاملة.",
    effective: "تاريخ السريان",
    contact: "أسئلة حول السياسة",
    businessInfo: "معلومات النشاط التجاري",
    businessName: "اسم النشاط التجاري",
    address: "العنوان المسجل",
    jurisdiction: "الاختصاص القضائي",
  },
};

const legalContent: Record<string, { updated: string; sections: { heading: string; body: string }[] }> = {
  privacy: {
    updated: "2026-07-18",
    sections: [
      {
        heading: "Information We Collect",
        body: "We collect account details, profile details, support messages, purchase requests, license records, session metadata and security logs needed to provide the website, downloads, licensing and support services.",
      },
      {
        heading: "How We Use Information",
        body: "We use information to create accounts, verify email, issue orders and licenses, provide download access, respond to support tickets, prevent abuse, improve security and send service notifications.",
      },
      {
        heading: "Security and Retention",
        body: "Passwords are stored as hashes. Device identifiers used for license activation are stored as hashes. Records are retained while needed for account, license, tax, fraud-prevention and support purposes.",
      },
      {
        heading: "Your Choices",
        body: "Customers may update profile information from the account page and may contact support for account, order, license or privacy requests.",
      },
    ],
  },
  terms: {
    updated: "2026-07-18",
    sections: [
      {
        heading: "Use of the Website",
        body: "You may use this website to learn about products, create a customer account, request purchases, access downloads, view orders and receive support. You must provide accurate information and must not misuse the service.",
      },
      {
        heading: "Accounts and Security",
        body: "You are responsible for keeping your login credentials secure. We may suspend access if we detect abuse, fraud, unauthorized use or security risk.",
      },
      {
        heading: "Orders and Manual Payments",
        body: "Purchase requests can be submitted from your account. Checkout creates a payment record for admin review (manual mode) or redirects to the configured payment gateway when enabled. Orders and licenses are issued after payment confirmation.",
      },
      {
        heading: "Service Changes",
        body: "Product information, prices, download availability and support processes may change as the software and website evolve.",
      },
    ],
  },
  refund: {
    updated: "2026-07-18",
    sections: [
      {
        heading: "Manual Review",
        body: "Refund requests are reviewed case by case using the order record, payment reference, license status and support history.",
      },
      {
        heading: "Non-Refundable Cases",
        body: "Refunds may be declined where a license has been delivered and activated, a digital download has been accessed, or the issue is caused by unsupported device, misuse or third-party system changes.",
      },
      {
        heading: "Support First",
        body: "Customers should open a support ticket before requesting a refund so installation, activation or product issues can be reviewed and resolved where possible.",
      },
      {
        heading: "Approved Refunds",
        body: "Approved refunds are processed through the original or agreed manual payment channel when technically possible.",
      },
    ],
  },
  eula: {
    updated: "2026-07-18",
    sections: [
      {
        heading: "License Grant",
        body: "A purchased license grants the customer a limited, non-transferable right to install and use the software according to the plan, seat limit, expiry and product terms shown in the customer account or receipt.",
      },
      {
        heading: "Activation and Devices",
        body: "License activation may require a device identifier. Device identifiers are hashed before storage. Seat limits are enforced by the activation service.",
      },
      {
        heading: "Restrictions",
        body: "You may not resell, share, reverse engineer, bypass licensing, tamper with activation, distribute modified copies or use the software for unlawful activity.",
      },
      {
        heading: "Updates and Support",
        body: "Updates, downloads and support are provided according to release availability, license status and the applicable plan.",
      },
    ],
  },
  cookie: {
    updated: "2026-07-18",
    sections: [
      {
        heading: "Essential Cookies",
        body: "The website uses essential cookies and similar storage for login sessions, admin access, language preference, CSRF protection and basic security.",
      },
      {
        heading: "No Payment Tracking by Default",
        body: "The current manual purchase workflow does not rely on third-party payment tracking cookies. If analytics or payment gateways are added later, this policy should be updated.",
      },
      {
        heading: "Managing Cookies",
        body: "You can control cookies from your browser settings. Blocking essential cookies may prevent login, account and admin features from working correctly.",
      },
    ],
  },
  security: {
    updated: "2026-07-18",
    sections: [
      {
        heading: "Account Protection",
        body: "The website uses password hashing, verification codes, session tracking, CSRF checks, origin protection and rate limiting to reduce unauthorized access and abuse.",
      },
      {
        heading: "License Protection",
        body: "License keys are generated server-side. Activation device identifiers are hashed, and signed download links are short lived.",
      },
      {
        heading: "Admin Protection",
        body: "Admin website access is protected separately from customer login, and backend admin APIs require a configured admin API key.",
      },
      {
        heading: "Responsible Reporting",
        body: "If you discover a vulnerability, report it privately through the official support email or WhatsApp channel and do not exploit or disclose it publicly before review.",
      },
    ],
  },
  "acceptable-use": {
    updated: "2026-07-18",
    sections: [
      {
        heading: "Allowed Use",
        body: "You may use the website and software for legitimate business, family finance, account, download, license and support purposes.",
      },
      {
        heading: "Prohibited Use",
        body: "You may not attack, scrape, overload, reverse engineer, bypass licensing, submit false payment references, upload harmful content or use the service for illegal activity.",
      },
      {
        heading: "Enforcement",
        body: "We may limit, suspend or revoke access to accounts, downloads, licenses or support where misuse, fraud, abuse or security risk is detected.",
      },
    ],
  },
};

export default function LegalPage() {
  const { lang, t } = useI18n();
  const params = useParams<{ doc: string }>();
  const titleKey = docTitleKey[params.doc];
  const c = copy[lang] ?? copy.en;
  const content = legalContent[params.doc];

  if (!titleKey || !content) {
    return (
      <section className="mx-auto max-w-[1220px] px-5 py-24 text-center">
        <h1 className="text-2xl font-black text-text">404</h1>
        <Link
          href="/"
          className="mt-6 inline-block rounded-xl bg-accent px-6 py-3 text-sm font-bold text-bg"
        >
          {t("navHome")}
        </Link>
      </section>
    );
  }

  return (
    <>
      <PageHeader eyebrow={t("footerLegal")} title={t(titleKey)} />
      <section className="mx-auto max-w-3xl px-5 py-14">
        <p className="text-muted">{c.intro}</p>
        <p className="mt-3 text-sm font-semibold text-muted">
          {c.effective}: {site.legal.effectiveDate || content.updated}
        </p>
        <div className="mt-8">
          <Note tone="warn">{c.note}</Note>
        </div>
        <div className="mt-10 space-y-8">
          {content.sections.map((section) => (
            <section key={section.heading}>
              <h2 className="text-xl font-extrabold text-text">{section.heading}</h2>
              <p className="mt-3 leading-7 text-muted">{section.body}</p>
            </section>
          ))}
        </div>
        <div className="mt-10 rounded-2xl border border-line bg-white/[0.02] p-5">
          <h2 className="text-base font-extrabold text-text">{c.businessInfo}</h2>
          <dl className="mt-4 grid gap-3 text-sm text-muted sm:grid-cols-2">
            <div>
              <dt className="font-bold text-text/80">{c.businessName}</dt>
              <dd className="mt-1">{site.legal.businessName}</dd>
            </div>
            <div>
              <dt className="font-bold text-text/80">{c.jurisdiction}</dt>
              <dd className="mt-1">{site.legal.jurisdiction}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="font-bold text-text/80">{c.address}</dt>
              <dd className="mt-1">{site.legal.registeredAddress}</dd>
            </div>
          </dl>
        </div>
        <div className="mt-10 rounded-2xl border border-line bg-white/[0.02] p-5">
          <h2 className="text-base font-extrabold text-text">{c.contact}</h2>
          <p className="mt-2 text-sm text-muted">
            Email: <a className="text-accent hover:underline" href={site.contact.emailUrl}>{site.contact.email}</a>
          </p>
        </div>
        <div className="mt-10 border-t border-line pt-6">
          <Link
            href="/"
            className="text-sm font-semibold text-accent hover:underline"
          >
            ← {t("navHome")}
          </Link>
        </div>
      </section>
    </>
  );
}
