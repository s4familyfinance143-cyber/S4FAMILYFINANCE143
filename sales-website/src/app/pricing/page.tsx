"use client";

import { localizedPricingPlans, localizedProducts, site } from "@/lib/site";
import { useI18n } from "@/components/LanguageProvider";
import { PageHeader, Note } from "@/components/PageHeader";
import type { Lang } from "@/lib/i18n";

type Copy = {
  title: string;
  sub: string;
  note: string;
  contact: string;
  quoteRequired: string;
  trialDays: string;
  billing: string;
  license: string;
  support: string;
  included: string;
  currentOffer: string;
  paymentPending: string;
  bestValue: string;
};

const copy: Record<Lang, Copy> = {
  en: {
    title: "Pricing & Licensing",
    sub: "Flexible licenses for every business and family.",
    note: "Final public prices are not published yet. Each license is quoted based on product, devices, users and support needs.",
    contact: "Contact for Pricing",
    quoteRequired: "Quote required",
    trialDays: "Trial days",
    billing: "Billing",
    license: "License",
    support: "Support",
    included: "Included",
    currentOffer: "Ask current offer on WhatsApp",
    paymentPending: "Pay from your account after request",
    bestValue: "Best value",
  },
  bn: {
    title: "মূল্য ও লাইসেন্সিং",
    sub: "প্রতিটি ব্যবসা ও পরিবারের জন্য নমনীয় লাইসেন্স।",
    note: "চূড়ান্ত প্রকাশ্য মূল্য এখনো প্রকাশ করা হয়নি। পণ্য, ডিভাইস, ব্যবহারকারী ও সহায়তার প্রয়োজন অনুযায়ী লাইসেন্স মূল্য জানানো হবে।",
    contact: "মূল্যের জন্য যোগাযোগ",
    quoteRequired: "মূল্য জানতে হবে",
    trialDays: "ট্রায়াল দিন",
    billing: "বিলিং",
    license: "লাইসেন্স",
    support: "সাপোর্ট",
    included: "যা থাকবে",
    currentOffer: "WhatsApp-এ বর্তমান অফার জিজ্ঞেস করুন",
    paymentPending: "অ্যাকাউন্ট থেকে পেমেন্ট/চেকআউট করুন",
    bestValue: "সেরা মূল্যমান",
  },
  hi: {
    title: "मूल्य और लाइसेंसिंग",
    sub: "हर व्यवसाय और परिवार के लिए लचीले लाइसेंस।",
    note: "अंतिम सार्वजनिक मूल्य अभी प्रकाशित नहीं हैं। लाइसेंस उत्पाद, डिवाइस, यूज़र और सपोर्ट जरूरत के अनुसार quote होगा।",
    contact: "मूल्य के लिए संपर्क करें",
    quoteRequired: "Quote आवश्यक",
    trialDays: "Trial दिन",
    billing: "बिलिंग",
    license: "लाइसेंस",
    support: "सपोर्ट",
    included: "शामिल",
    currentOffer: "WhatsApp पर current offer पूछें",
    paymentPending: "Account से Pay / Checkout करें",
    bestValue: "Best value",
  },
  ur: {
    title: "قیمت اور لائسنسنگ",
    sub: "ہر کاروبار اور خاندان کے لیے لچکدار لائسنس۔",
    note: "حتمی عوامی قیمتیں ابھی شائع نہیں ہوئیں۔ لائسنس پروڈکٹ، ڈیوائس، صارف اور سپورٹ ضرورت کے مطابق quote ہوگا۔",
    contact: "قیمت کے لیے رابطہ کریں",
    quoteRequired: "Quote ضروری",
    trialDays: "Trial دن",
    billing: "بلنگ",
    license: "لائسنس",
    support: "سپورٹ",
    included: "شامل",
    currentOffer: "WhatsApp پر current offer پوچھیں",
    paymentPending: "Account سے Pay / Checkout کریں",
    bestValue: "Best value",
  },
  ar: {
    title: "الأسعار والترخيص",
    sub: "تراخيص مرنة لكل عمل وكل عائلة.",
    note: "لم يتم نشر الأسعار العامة النهائية بعد. يتم تقديم عرض حسب المنتج والأجهزة والمستخدمين والدعم.",
    contact: "تواصل لمعرفة السعر",
    quoteRequired: "يتطلب عرض سعر",
    trialDays: "أيام التجربة",
    billing: "الفوترة",
    license: "الترخيص",
    support: "الدعم",
    included: "يشمل",
    currentOffer: "اسأل عن العرض الحالي عبر WhatsApp",
    paymentPending: "ادفع من حسابك بعد الطلب",
    bestValue: "أفضل قيمة",
  },
};

function plansFor(plans: ReturnType<typeof localizedPricingPlans>, productSlug: string) {
  return plans.filter((plan) => plan.productSlug === productSlug);
}

function quoteHref(productName: string, planName: string) {
  const message = `I want pricing for ${productName} - ${planName} license.`;
  return `${site.contact.whatsappUrl}?text=${encodeURIComponent(message)}`;
}

export default function PricingPage() {
  const { lang } = useI18n();
  const c = copy[lang] ?? copy.en;
  const products = localizedProducts(lang);
  const pricingPlans = localizedPricingPlans(lang);

  return (
    <>
      <PageHeader title={c.title} subtitle={c.sub} />
      <section className="mx-auto max-w-[1220px] px-5 py-14">
        <Note tone="warn">{c.note}</Note>

        <div className="mt-8 flex flex-col gap-8">
          {products.map((product) => (
            <article
              key={product.slug}
              className="rounded-3xl border border-line bg-white/[0.02] p-7"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <span
                    className={`grid h-11 w-11 place-items-center rounded-2xl text-lg font-black text-bg ${
                      product.accent === "accent" ? "bg-accent" : "bg-accent2"
                    }`}
                  >
                    S4
                  </span>
                  <div>
                    <h2 className="text-lg font-extrabold text-text">
                      {product.name}
                    </h2>
                    <p className="text-sm text-muted">{product.short}</p>
                  </div>
                </div>
                <span className="w-fit rounded-full bg-warn/15 px-3 py-1 text-xs font-bold text-warn">
                  {c.paymentPending}
                </span>
              </div>

              <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
                {plansFor(pricingPlans, product.slug).map((plan) => (
                  <div
                    key={`${product.slug}-${plan.plan}`}
                    className={`flex flex-col rounded-2xl border bg-panel/30 p-5 ${
                      plan.plan === "Yearly" ? "border-accent" : "border-line"
                    }`}
                  >
                    {plan.plan === "Yearly" && (
                      <span className="mb-3 w-fit rounded-full bg-accent px-3 py-1 text-xs font-bold text-bg">
                        {c.bestValue}
                      </span>
                    )}
                    <h3 className="text-lg font-extrabold text-text">
                      {plan.plan}
                    </h3>
                    <p className="mt-2 text-2xl font-black text-text">
                      {plan.price ?? c.quoteRequired}
                    </p>
                    {plan.trialDays && (
                      <p className="mt-1 text-xs font-semibold text-good">
                        {c.trialDays}: {plan.trialDays}
                      </p>
                    )}

                    <dl className="mt-4 flex flex-col gap-3 text-xs text-muted">
                      <div>
                        <dt className="font-bold text-text/80">{c.billing}</dt>
                        <dd className="mt-1">{plan.billingCycle}</dd>
                      </div>
                      <div>
                        <dt className="font-bold text-text/80">{c.license}</dt>
                        <dd className="mt-1">{plan.licenseScope}</dd>
                      </div>
                      <div>
                        <dt className="font-bold text-text/80">{c.support}</dt>
                        <dd className="mt-1">{plan.supportLevel}</dd>
                      </div>
                    </dl>

                    <div className="mt-4 flex-1">
                      <p className="text-xs font-bold text-text/80">
                        {c.included}
                      </p>
                      <ul className="mt-2 space-y-1.5 text-xs text-muted">
                        {plan.features.map((feature) => (
                          <li key={feature} className="flex gap-2">
                            <span className="text-accent">▹</span>
                            <span>{feature}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <a
                      href={quoteHref(product.name, plan.plan)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-5 rounded-xl border border-line px-4 py-2.5 text-center text-sm font-semibold text-text transition-colors hover:border-good hover:text-good"
                    >
                      {c.contact}
                    </a>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>

        <div className="mt-10 text-center">
          <a
            href={site.contact.whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block rounded-xl bg-accent px-8 py-3 text-sm font-bold text-bg transition-opacity hover:opacity-90"
          >
            {c.currentOffer}: {site.contact.whatsappDisplay}
          </a>
        </div>
      </section>
    </>
  );
}
