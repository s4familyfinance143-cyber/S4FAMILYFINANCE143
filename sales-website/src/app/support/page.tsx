"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import {
  localizedProducts,
  localizedSupportChannels,
  localizedSupportResources,
  site,
} from "@/lib/site";
import { useI18n } from "@/components/LanguageProvider";
import { PageHeader } from "@/components/PageHeader";
import type { Lang } from "@/lib/i18n";
import type { SupportTicket, SupportTicketDetail } from "@/lib/authApi";
import { formatDateTime } from "@/lib/locale";

type Copy = {
  title: string;
  sub: string;
  selfTitle: string;
  directTitle: string;
  channelsTitle: string;
  hours: string;
  statusReady: string;
  statusDraft: string;
  statusPlanned: string;
  requestTitle: string;
  requestSub: string;
  ticketDeskTitle: string;
  ticketDeskSub: string;
  loginToTicket: string;
  goLogin: string;
  subject: string;
  category: string;
  priority: string;
  product: string;
  platform: string;
  message: string;
  createTicket: string;
  creating: string;
  tickets: string;
  noTickets: string;
  reply: string;
  sendReply: string;
  closeTicket: string;
  closed: string;
  saved: string;
  installHelp: string;
  licenseHelp: string;
  bugHelp: string;
  remoteHelp: string;
  askNow: string;
};

const copy: Record<Lang, Copy> = {
  en: {
    title: "Support Center",
    sub: "Documentation, tutorials and direct help — whenever you need it.",
    selfTitle: "Self Service",
    directTitle: "Direct Support",
    channelsTitle: "Contact Channels",
    hours: "Business hours: Saturday–Thursday, 10:00–20:00",
    statusReady: "Ready",
    statusDraft: "Draft",
    statusPlanned: "Planned",
    requestTitle: "Request Support",
    requestSub: "Open WhatsApp with a structured support message.",
    ticketDeskTitle: "Customer Ticket Desk",
    ticketDeskSub: "Create and track support tickets from your account.",
    loginToTicket: "Login is required to create and track support tickets.",
    goLogin: "Login to Create Ticket",
    subject: "Subject",
    category: "Category",
    priority: "Priority",
    product: "Product",
    platform: "Platform",
    message: "Message",
    createTicket: "Create Ticket",
    creating: "Creating...",
    tickets: "Your Tickets",
    noTickets: "No support tickets yet.",
    reply: "Reply / follow-up",
    sendReply: "Send Reply",
    closeTicket: "Close Ticket",
    closed: "Closed",
    saved: "Ticket saved.",
    installHelp: "Installation help",
    licenseHelp: "License/account help",
    bugHelp: "Bug report",
    remoteHelp: "Remote support request",
    askNow: "Ask on WhatsApp",
  },
  bn: {
    title: "সাপোর্ট সেন্টার",
    sub: "ডকুমেন্টেশন, টিউটোরিয়াল ও সরাসরি সহায়তা — যখনই প্রয়োজন।",
    selfTitle: "সেলফ সার্ভিস",
    directTitle: "সরাসরি সাপোর্ট",
    channelsTitle: "যোগাযোগের মাধ্যম",
    hours: "কর্মঘণ্টা: শনি–বৃহস্পতি, ১০:০০–২০:০০",
    statusReady: "রেডি",
    statusDraft: "ড্রাফট",
    statusPlanned: "পরিকল্পনায়",
    requestTitle: "সাপোর্ট রিকোয়েস্ট",
    requestSub: "সহায়তার বিস্তারিত বার্তা নিয়ে WhatsApp খুলবে।",
    ticketDeskTitle: "কাস্টমার সহায়তা ডেস্ক",
    ticketDeskSub: "আপনার অ্যাকাউন্ট থেকে সহায়তা টিকিট তৈরি ও ট্র্যাক করুন।",
    loginToTicket: "সহায়তা টিকিট তৈরি ও ট্র্যাক করতে লগইন করতে হবে।",
    goLogin: "টিকিট তৈরি করতে লগইন",
    subject: "বিষয়",
    category: "ধরন",
    priority: "অগ্রাধিকার",
    product: "পণ্য",
    platform: "প্ল্যাটফর্ম",
    message: "বার্তা",
    createTicket: "টিকিট তৈরি করুন",
    creating: "তৈরি হচ্ছে...",
    tickets: "আপনার টিকিট",
    noTickets: "এখনো কোনো সহায়তা টিকিট নেই।",
    reply: "উত্তর / ফলো-আপ",
    sendReply: "উত্তর পাঠান",
    closeTicket: "টিকিট বন্ধ করুন",
    closed: "বন্ধ",
    saved: "টিকিট সংরক্ষিত হয়েছে।",
    installHelp: "ইনস্টলেশন সহায়তা",
    licenseHelp: "লাইসেন্স/অ্যাকাউন্ট সহায়তা",
    bugHelp: "বাগ রিপোর্ট",
    remoteHelp: "রিমোট সাপোর্ট রিকোয়েস্ট",
    askNow: "WhatsApp-এ জিজ্ঞেস করুন",
  },
  hi: {
    title: "सपोर्ट सेंटर",
    sub: "दस्तावेज़, ट्यूटोरियल और सीधी मदद — जब भी आपको ज़रूरत हो।",
    selfTitle: "सेल्फ सर्विस",
    directTitle: "सीधी सहायता",
    channelsTitle: "संपर्क माध्यम",
    hours: "कार्य समय: शनि–गुरु, 10:00–20:00",
    statusReady: "तैयार",
    statusDraft: "ड्राफ्ट",
    statusPlanned: "योजनाबद्ध",
    requestTitle: "सपोर्ट अनुरोध",
    requestSub: "Structured support message के साथ WhatsApp खुलेगा।",
    ticketDeskTitle: "ग्राहक टिकट डेस्क",
    ticketDeskSub: "अपने account से support ticket बनाएँ और track करें।",
    loginToTicket: "Support ticket बनाने और track करने के लिए login आवश्यक है।",
    goLogin: "Ticket बनाने के लिए Login",
    subject: "विषय",
    category: "श्रेणी",
    priority: "प्राथमिकता",
    product: "उत्पाद",
    platform: "प्लेटफ़ॉर्म",
    message: "संदेश",
    createTicket: "Ticket बनाएँ",
    creating: "बन रहा है...",
    tickets: "आपके Tickets",
    noTickets: "अभी कोई support ticket नहीं है।",
    reply: "Reply / follow-up",
    sendReply: "Reply भेजें",
    closeTicket: "Ticket बंद करें",
    closed: "बंद",
    saved: "Ticket saved.",
    installHelp: "Installation सहायता",
    licenseHelp: "License/account सहायता",
    bugHelp: "Bug report",
    remoteHelp: "Remote support request",
    askNow: "WhatsApp पर पूछें",
  },
  ur: {
    title: "سپورٹ سینٹر",
    sub: "دستاویزات، ٹیوٹوریلز اور براہِ راست مدد — جب بھی آپ کو ضرورت ہو۔",
    selfTitle: "سیلف سروس",
    directTitle: "براہِ راست سپورٹ",
    channelsTitle: "رابطے کے ذرائع",
    hours: "کاروباری اوقات: ہفتہ–جمعرات، 10:00–20:00",
    statusReady: "تیار",
    statusDraft: "ڈرافٹ",
    statusPlanned: "منصوبہ بند",
    requestTitle: "سپورٹ درخواست",
    requestSub: "Structured support message کے ساتھ WhatsApp کھلے گا۔",
    ticketDeskTitle: "کسٹمر ٹکٹ ڈیسک",
    ticketDeskSub: "اپنے account سے support ticket بنائیں اور track کریں۔",
    loginToTicket: "Support ticket بنانے اور track کرنے کے لیے login ضروری ہے۔",
    goLogin: "Ticket بنانے کے لیے Login",
    subject: "موضوع",
    category: "کیٹیگری",
    priority: "ترجیح",
    product: "پروڈکٹ",
    platform: "پلیٹ فارم",
    message: "پیغام",
    createTicket: "Ticket بنائیں",
    creating: "بن رہا ہے...",
    tickets: "آپ کے Tickets",
    noTickets: "ابھی کوئی support ticket نہیں۔",
    reply: "Reply / follow-up",
    sendReply: "Reply بھیجیں",
    closeTicket: "Ticket بند کریں",
    closed: "بند",
    saved: "Ticket saved.",
    installHelp: "Installation مدد",
    licenseHelp: "License/account مدد",
    bugHelp: "Bug report",
    remoteHelp: "Remote support request",
    askNow: "WhatsApp پر پوچھیں",
  },
  ar: {
    title: "مركز الدعم",
    sub: "توثيق ودروس ومساعدة مباشرة — متى احتجت إليها.",
    selfTitle: "الخدمة الذاتية",
    directTitle: "الدعم المباشر",
    channelsTitle: "قنوات التواصل",
    hours: "ساعات العمل: السبت–الخميس، 10:00–20:00",
    statusReady: "جاهز",
    statusDraft: "مسودة",
    statusPlanned: "مخطط",
    requestTitle: "طلب دعم",
    requestSub: "يفتح WhatsApp برسالة دعم منظمة.",
    ticketDeskTitle: "مكتب تذاكر العملاء",
    ticketDeskSub: "أنشئ وتتبع تذاكر الدعم من حسابك.",
    loginToTicket: "يجب تسجيل الدخول لإنشاء وتتبع تذاكر الدعم.",
    goLogin: "تسجيل الدخول لإنشاء تذكرة",
    subject: "الموضوع",
    category: "الفئة",
    priority: "الأولوية",
    product: "المنتج",
    platform: "المنصة",
    message: "الرسالة",
    createTicket: "إنشاء تذكرة",
    creating: "جارٍ الإنشاء...",
    tickets: "تذاكرك",
    noTickets: "لا توجد تذاكر دعم بعد.",
    reply: "رد / متابعة",
    sendReply: "إرسال الرد",
    closeTicket: "إغلاق التذكرة",
    closed: "مغلقة",
    saved: "تم حفظ التذكرة.",
    installHelp: "مساعدة التثبيت",
    licenseHelp: "مساعدة الترخيص/الحساب",
    bugHelp: "تقرير خطأ",
    remoteHelp: "طلب دعم عن بعد",
    askNow: "اسأل عبر WhatsApp",
  },
};

function statusLabel(status: string, c: Copy) {
  if (status === "ready") return c.statusReady;
  if (status === "draft") return c.statusDraft;
  return c.statusPlanned;
}

function supportHref(topic: string) {
  const message = `Support request: ${topic}\nProduct:\nDevice/Platform:\nProblem details:`;
  return `${site.contact.whatsappUrl}?text=${encodeURIComponent(message)}`;
}

const inputCls =
  "w-full rounded-xl border border-line bg-panel/60 px-4 py-3 text-sm text-text placeholder:text-muted focus:border-accent";

const categories = ["installation", "license", "account", "bug", "billing", "other"];
const priorities = ["low", "normal", "high", "urgent"];

export default function SupportPage() {
  const { lang } = useI18n();
  const c = copy[lang] ?? copy.en;
  const products = localizedProducts(lang);
  const supportResources = localizedSupportResources(lang);
  const supportChannels = localizedSupportChannels(lang);
  const { ready, isAuthenticated, authFetch } = useAuth();
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [selected, setSelected] = useState<SupportTicketDetail | null>(null);
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState("installation");
  const [priority, setPriority] = useState("normal");
  const [productSlug, setProductSlug] = useState(products[0]?.slug ?? "");
  const [platform, setPlatform] = useState("Windows");
  const [message, setMessage] = useState("");
  const [reply, setReply] = useState("");
  const [ticketMsg, setTicketMsg] = useState("");
  const [ticketErr, setTicketErr] = useState("");
  const [creating, setCreating] = useState(false);

  const loadTickets = useCallback(async () => {
    const res = await authFetch<SupportTicket[]>("/support/tickets");
    if (res.ok && res.data) setTickets(res.data);
  }, [authFetch]);

  const loadTicket = useCallback(
    async (id: string) => {
      const res = await authFetch<SupportTicketDetail>(`/support/tickets/${id}`);
      if (res.ok && res.data) setSelected(res.data);
    },
    [authFetch]
  );

  useEffect(() => {
    if (!ready || !isAuthenticated) return;
    let active = true;
    void (async () => {
      const res = await authFetch<SupportTicket[]>("/support/tickets");
      if (active && res.ok && res.data) setTickets(res.data);
    })();
    return () => {
      active = false;
    };
  }, [ready, isAuthenticated, authFetch]);

  async function createTicket(e: React.FormEvent) {
    e.preventDefault();
    setTicketMsg("");
    setTicketErr("");
    setCreating(true);
    const res = await authFetch<SupportTicketDetail>("/support/tickets", {
      method: "POST",
      body: {
        subject,
        category,
        priority,
        product_slug: productSlug || null,
        platform: platform || null,
        message,
      },
    });
    setCreating(false);
    if (res.ok && res.data) {
      setTicketMsg(c.saved);
      setSubject("");
      setMessage("");
      setSelected(res.data);
      await loadTickets();
    } else {
      setTicketErr(res.error ?? "Failed.");
    }
  }

  async function sendReply(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setTicketErr("");
    const res = await authFetch<SupportTicketDetail>(
      `/support/tickets/${selected.id}/messages`,
      { method: "POST", body: { message: reply } }
    );
    if (res.ok && res.data) {
      setReply("");
      setSelected(res.data);
      await loadTickets();
    } else {
      setTicketErr(res.error ?? "Failed.");
    }
  }

  async function closeTicket() {
    if (!selected) return;
    const res = await authFetch(`/support/tickets/${selected.id}/close`, {
      method: "POST",
    });
    if (res.ok) {
      await loadTicket(selected.id);
      await loadTickets();
    }
  }

  return (
    <>
      <PageHeader title={c.title} subtitle={c.sub} />
      <section className="mx-auto max-w-[1220px] px-5 py-14">
        <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
          <div className="rounded-3xl border border-line bg-white/[0.02] p-6">
            <h2 className="text-lg font-extrabold text-text">{c.selfTitle}</h2>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {supportResources.map((resource) => (
                <article
                  key={resource.category}
                  className="rounded-2xl border border-line bg-panel/30 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-sm font-extrabold text-text">
                      {resource.title}
                    </h3>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${
                        resource.status === "ready"
                          ? "bg-good/15 text-good"
                          : resource.status === "draft"
                            ? "bg-warn/15 text-warn"
                            : "bg-muted/10 text-muted"
                      }`}
                    >
                      {statusLabel(resource.status, c)}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-muted">
                    {resource.description}
                  </p>
                  {resource.href ? (
                    <Link
                      href={resource.href}
                      className="mt-4 inline-block text-xs font-bold text-accent hover:underline"
                    >
                      Open resource
                    </Link>
                  ) : (
                    <p className="mt-4 text-xs font-semibold text-muted">
                      Content preparation in progress
                    </p>
                  )}
                </article>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-line bg-white/[0.02] p-6">
            <h2 className="text-lg font-extrabold text-text">{c.directTitle}</h2>
            <p className="mt-2 text-sm text-muted">{c.requestSub}</p>
            <div className="mt-5 flex flex-col gap-3">
              {[c.installHelp, c.licenseHelp, c.bugHelp, c.remoteHelp].map(
                (topic) => (
                  <a
                    key={topic}
                    href={supportHref(topic)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-xl border border-line px-4 py-3 text-sm font-semibold text-text transition-colors hover:border-good hover:text-good"
                  >
                    {topic}
                  </a>
                )
              )}
            </div>
          </div>
        </div>

        <div className="mt-6 rounded-3xl border border-line bg-white/[0.02] p-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-extrabold text-text">
                {c.ticketDeskTitle}
              </h2>
              <p className="mt-1 text-sm text-muted">{c.ticketDeskSub}</p>
            </div>
            {!isAuthenticated && ready && (
              <Link
                href="/login"
                className="rounded-xl bg-accent px-5 py-3 text-center text-sm font-bold text-bg transition-opacity hover:opacity-90"
              >
                {c.goLogin}
              </Link>
            )}
          </div>

          {!ready && <p className="mt-5 text-sm text-muted">Loading...</p>}

          {ready && !isAuthenticated && (
            <p className="mt-5 rounded-2xl border border-line bg-panel/30 p-4 text-sm text-muted">
              {c.loginToTicket}
            </p>
          )}

          {ready && isAuthenticated && (
            <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_1.1fr]">
              <form onSubmit={createTicket} className="flex flex-col gap-4">
                <input
                  className={inputCls}
                  placeholder={c.subject}
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  required
                  maxLength={180}
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <select
                    className={inputCls}
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  >
                    {categories.map((item) => (
                      <option key={item} value={item}>
                        {c.category}: {item}
                      </option>
                    ))}
                  </select>
                  <select
                    className={inputCls}
                    value={priority}
                    onChange={(e) => setPriority(e.target.value)}
                  >
                    {priorities.map((item) => (
                      <option key={item} value={item}>
                        {c.priority}: {item}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <select
                    className={inputCls}
                    value={productSlug}
                    onChange={(e) => setProductSlug(e.target.value)}
                  >
                    {products.map((product) => (
                      <option key={product.slug} value={product.slug}>
                        {c.product}: {product.name}
                      </option>
                    ))}
                  </select>
                  <input
                    className={inputCls}
                    placeholder={c.platform}
                    value={platform}
                    onChange={(e) => setPlatform(e.target.value)}
                    maxLength={40}
                  />
                </div>
                <textarea
                  className={`${inputCls} min-h-36 resize-y`}
                  placeholder={c.message}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  required
                  maxLength={5000}
                />
                {ticketMsg && (
                  <p className="text-sm font-semibold text-good">{ticketMsg}</p>
                )}
                {ticketErr && (
                  <p className="text-sm font-semibold text-danger">{ticketErr}</p>
                )}
                <button
                  type="submit"
                  disabled={creating}
                  className="self-start rounded-xl bg-accent px-6 py-3 text-sm font-bold text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {creating ? c.creating : c.createTicket}
                </button>
              </form>

              <div className="grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
                <div>
                  <h3 className="text-sm font-extrabold text-text">{c.tickets}</h3>
                  <div className="mt-3 flex max-h-[420px] flex-col gap-2 overflow-auto pr-1">
                    {tickets.length === 0 && (
                      <p className="rounded-xl border border-line p-3 text-sm text-muted">
                        {c.noTickets}
                      </p>
                    )}
                    {tickets.map((ticket) => (
                      <button
                        key={ticket.id}
                        type="button"
                        onClick={() => loadTicket(ticket.id)}
                        className={`rounded-xl border p-3 text-start transition-colors hover:border-accent ${
                          selected?.id === ticket.id ? "border-accent" : "border-line"
                        }`}
                      >
                        <p className="line-clamp-2 text-sm font-bold text-text">
                          {ticket.subject}
                        </p>
                        <p className="mt-1 text-xs text-muted">
                          {ticket.status} · {ticket.priority}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-line bg-panel/30 p-4">
                  {selected ? (
                    <>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-extrabold text-text">
                            {selected.subject}
                          </h3>
                          <p className="mt-1 text-xs text-muted">
                            {selected.category} · {selected.status}
                          </p>
                        </div>
                        {selected.status === "closed" ? (
                          <span className="rounded-full bg-muted/10 px-3 py-1 text-xs font-bold text-muted">
                            {c.closed}
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={closeTicket}
                            className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-muted transition-colors hover:border-danger hover:text-danger"
                          >
                            {c.closeTicket}
                          </button>
                        )}
                      </div>
                      <div className="mt-4 flex max-h-56 flex-col gap-3 overflow-auto pr-1">
                        {selected.messages.map((item) => (
                          <div
                            key={item.id}
                            className="rounded-xl border border-line bg-white/[0.02] p-3"
                          >
                            <p className="text-xs font-bold text-accent">
                              {item.author_type} · {formatDateTime(item.created_at, lang)}
                            </p>
                            <p className="mt-2 whitespace-pre-wrap text-sm text-text/90">
                              {item.body}
                            </p>
                          </div>
                        ))}
                      </div>
                      <form onSubmit={sendReply} className="mt-4 flex flex-col gap-3">
                        <textarea
                          className={`${inputCls} min-h-24 resize-y`}
                          placeholder={c.reply}
                          value={reply}
                          onChange={(e) => setReply(e.target.value)}
                          required
                          maxLength={5000}
                        />
                        <button
                          type="submit"
                          className="self-start rounded-xl border border-line px-4 py-2.5 text-sm font-semibold text-text transition-colors hover:border-accent hover:text-accent"
                        >
                          {c.sendReply}
                        </button>
                      </form>
                    </>
                  ) : (
                    <p className="text-sm text-muted">{c.noTickets}</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="mt-6 rounded-3xl border border-line bg-white/[0.02] p-6">
            <h2 className="text-lg font-extrabold text-text">
              {c.channelsTitle}
            </h2>
            <div className="mt-5 grid gap-4 md:grid-cols-4">
              {supportChannels.map((channel) => {
                const external = channel.href.startsWith("http");
                const className =
                  "rounded-2xl border border-line bg-panel/30 p-4 transition-colors hover:border-accent";

                if (external) {
                  return (
                    <a
                      key={channel.type}
                      href={channel.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={className}
                    >
                      <h3 className="text-sm font-extrabold text-text">
                        {channel.label}
                      </h3>
                      <p className="mt-2 text-xs leading-relaxed text-muted">
                        {channel.responseTime}
                      </p>
                    </a>
                  );
                }

                return (
                  <Link key={channel.type} href={channel.href} className={className}>
                    <h3 className="text-sm font-extrabold text-text">
                      {channel.label}
                    </h3>
                    <p className="mt-2 text-xs leading-relaxed text-muted">
                      {channel.responseTime}
                    </p>
                  </Link>
                );
              })}
            </div>
            <p className="mt-4 text-xs text-muted">{c.hours}</p>
        </div>
      </section>
    </>
  );
}
