"use client";

import { site } from "@/lib/site";
import { useI18n } from "@/components/LanguageProvider";
import { PageHeader, Note } from "@/components/PageHeader";
import type { Lang } from "@/lib/i18n";

type Copy = { title: string; sub: string; note: string; cta: string };

const copy: Record<Lang, Copy> = {
  en: {
    title: "Request a Demo",
    sub: "See the software in action before you decide.",
    note: "Live demos are arranged over WhatsApp. Send us a message and our team will schedule a walkthrough for you.",
    cta: "Request Demo on WhatsApp",
  },
  bn: {
    title: "ডেমো রিকোয়েস্ট করুন",
    sub: "সিদ্ধান্ত নেওয়ার আগে software সরাসরি দেখে নিন।",
    note: "লাইভ ডেমো WhatsApp-এর মাধ্যমে দেওয়া হয়। একটি বার্তা পাঠান, আমাদের টিম আপনার জন্য একটি walkthrough ঠিক করে দেবে।",
    cta: "WhatsApp-এ ডেমো চান",
  },
  hi: {
    title: "डेमो का अनुरोध करें",
    sub: "निर्णय लेने से पहले सॉफ़्टवेयर को क्रियाशील देखें।",
    note: "लाइव डेमो व्हाट्सएप पर आयोजित किए जाते हैं। संदेश भेजें और हमारी टीम आपके लिए वॉकथ्रू शेड्यूल करेगी।",
    cta: "व्हाट्सएप पर डेमो का अनुरोध करें",
  },
  ur: {
    title: "ڈیمو کی درخواست کریں",
    sub: "فیصلہ کرنے سے پہلے سافٹ ویئر کو عملی طور پر دیکھیں۔",
    note: "لائیو ڈیمو واٹس ایپ پر ترتیب دیے جاتے ہیں۔ پیغام بھیجیں اور ہماری ٹیم آپ کے لیے واک تھرو شیڈول کرے گی۔",
    cta: "واٹس ایپ پر ڈیمو کی درخواست کریں",
  },
  ar: {
    title: "اطلب عرضًا توضيحيًا",
    sub: "شاهد البرنامج أثناء العمل قبل أن تقرر.",
    note: "تُنظَّم العروض التوضيحية المباشرة عبر واتساب. أرسل رسالة وسيقوم فريقنا بجدولة جولة تعريفية لك.",
    cta: "اطلب عرضًا عبر واتساب",
  },
};

export default function DemoPage() {
  const { lang } = useI18n();
  const c = copy[lang] ?? copy.en;

  return (
    <>
      <PageHeader title={c.title} subtitle={c.sub} />
      <section className="mx-auto max-w-[1220px] px-5 py-14">
        <div className="mx-auto max-w-2xl">
          <Note tone="good">{c.note}</Note>
          <div className="mt-8 text-center">
            <a
              href={site.contact.whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block rounded-xl bg-good/90 px-8 py-3.5 text-sm font-bold text-bg transition-opacity hover:opacity-90"
            >
              {c.cta}
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
