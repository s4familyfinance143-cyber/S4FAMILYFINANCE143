"use client";

import { useState } from "react";
import { site } from "@/lib/site";
import { useI18n } from "@/components/LanguageProvider";
import { PageHeader } from "@/components/PageHeader";
import type { Lang } from "@/lib/i18n";

type Copy = {
  title: string;
  sub: string;
  formTitle: string;
  name: string;
  phone: string;
  message: string;
  send: string;
  whatsapp: string;
  facebook: string;
};

const copy: Record<Lang, Copy> = {
  en: {
    title: "Contact Us",
    sub: "We are here to help. Reach us through any channel below.",
    formTitle: "Send a Message",
    name: "Your Name",
    phone: "Phone / WhatsApp",
    message: "Your Message",
    send: "Send via WhatsApp",
    whatsapp: "WhatsApp Text & Voice Call",
    facebook: "Facebook Page",
  },
  bn: {
    title: "যোগাযোগ করুন",
    sub: "আমরা সাহায্য করতে প্রস্তুত। নিচের যেকোনো মাধ্যমে যোগাযোগ করুন।",
    formTitle: "একটি বার্তা পাঠান",
    name: "আপনার নাম",
    phone: "ফোন / হোয়াটসঅ্যাপ",
    message: "আপনার বার্তা",
    send: "WhatsApp-এ পাঠান",
    whatsapp: "হোয়াটসঅ্যাপ টেক্সট ও ভয়েস কল",
    facebook: "ফেসবুক পেজ",
  },
  hi: {
    title: "संपर्क करें",
    sub: "हम मदद के लिए यहाँ हैं। नीचे किसी भी माध्यम से संपर्क करें।",
    formTitle: "संदेश भेजें",
    name: "आपका नाम",
    phone: "फ़ोन / व्हाट्सएप",
    message: "आपका संदेश",
    send: "व्हाट्सएप से भेजें",
    whatsapp: "व्हाट्सएप टेक्स्ट व वॉइस कॉल",
    facebook: "फेसबुक पेज",
  },
  ur: {
    title: "رابطہ کریں",
    sub: "ہم مدد کے لیے حاضر ہیں۔ نیچے کسی بھی ذریعے سے رابطہ کریں۔",
    formTitle: "پیغام بھیجیں",
    name: "آپ کا نام",
    phone: "فون / واٹس ایپ",
    message: "آپ کا پیغام",
    send: "واٹس ایپ پر بھیجیں",
    whatsapp: "واٹس ایپ ٹیکسٹ اور وائس کال",
    facebook: "فیس بک پیج",
  },
  ar: {
    title: "اتصل بنا",
    sub: "نحن هنا للمساعدة. تواصل معنا عبر أي قناة أدناه.",
    formTitle: "أرسل رسالة",
    name: "اسمك",
    phone: "الهاتف / واتساب",
    message: "رسالتك",
    send: "أرسل عبر واتساب",
    whatsapp: "واتساب رسائل ومكالمات صوتية",
    facebook: "صفحة فيسبوك",
  },
};

export default function ContactPage() {
  const { lang } = useI18n();
  const c = copy[lang] ?? copy.en;
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = `Name: ${name}\nPhone: ${phone}\n\n${message}`;
    const url = `${site.contact.whatsappUrl}?text=${encodeURIComponent(body)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  const inputCls =
    "w-full rounded-xl border border-line bg-panel/60 px-4 py-3 text-sm text-text placeholder:text-muted focus:border-accent";

  return (
    <>
      <PageHeader title={c.title} subtitle={c.sub} />
      <section className="mx-auto max-w-[1220px] px-5 py-14">
        <div className="grid gap-8 lg:grid-cols-[1.3fr_1fr]">
          <form
            onSubmit={submit}
            className="rounded-3xl border border-line bg-white/[0.02] p-7"
          >
            <h2 className="text-lg font-extrabold text-text">{c.formTitle}</h2>
            <div className="mt-5 flex flex-col gap-4">
              <input
                className={inputCls}
                placeholder={c.name}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
              <input
                className={inputCls}
                placeholder={c.phone}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
              <textarea
                className={`${inputCls} min-h-32 resize-y`}
                placeholder={c.message}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                required
              />
              <button
                type="submit"
                className="rounded-xl bg-good/90 px-6 py-3 text-sm font-bold text-bg transition-opacity hover:opacity-90"
              >
                {c.send}
              </button>
            </div>
          </form>

          <aside className="flex flex-col gap-4">
            <a
              href={site.contact.whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-2xl border border-line bg-white/[0.02] p-6 transition-colors hover:border-good"
            >
              <h3 className="font-bold text-text">{c.whatsapp}</h3>
              <p className="mt-1 text-sm text-good">
                {site.contact.whatsappDisplay}
              </p>
            </a>
            <a
              href={site.contact.emailUrl}
              className="rounded-2xl border border-line bg-white/[0.02] p-6 transition-colors hover:border-accent"
            >
              <h3 className="font-bold text-text">Email</h3>
              <p className="mt-1 break-all text-sm text-accent">
                {site.contact.email}
              </p>
            </a>
            <a
              href={site.contact.facebookUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-2xl border border-line bg-white/[0.02] p-6 transition-colors hover:border-accent"
            >
              <h3 className="font-bold text-text">{c.facebook}</h3>
              <p className="mt-1 text-sm text-accent">facebook.com</p>
            </a>
          </aside>
        </div>
      </section>
    </>
  );
}
