"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PageHeader, Note } from "@/components/PageHeader";
import { AdminNav } from "@/components/AdminNav";
import { useI18n } from "@/components/LanguageProvider";
import type { SupportTicket, SupportTicketDetail } from "@/lib/authApi";
import { adminText } from "@/lib/adminCopy";
import { formatDateTime } from "@/lib/locale";

const inputCls =
  "w-full rounded-xl border border-line bg-panel/60 px-4 py-3 text-sm text-text placeholder:text-muted focus:border-accent";

const statuses = ["open", "waiting_customer", "in_progress", "resolved", "closed"];

async function jsonFetch<T>(path: string, init: RequestInit = {}) {
  const res = await fetch(path, {
    ...init,
    cache: "no-store",
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "Request failed.");
  return data as T;
}

export default function AdminTicketsPage() {
  const { lang } = useI18n();
  const tx = (key: string) => adminText(lang, key);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [selected, setSelected] = useState<SupportTicketDetail | null>(null);
  const [reply, setReply] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadTickets() {
    try {
      setError("");
      setTickets(await jsonFetch<SupportTicket[]>("/api/admin/tickets"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tickets.");
    }
  }

  async function loadTicket(id: string) {
    try {
      setError("");
      setSelected(await jsonFetch<SupportTicketDetail>(`/api/admin/tickets/${id}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load ticket.");
    }
  }

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      void loadTickets();
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  async function sendReply(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setBusy(true);
    try {
      setSelected(
        await jsonFetch<SupportTicketDetail>(
          `/api/admin/tickets/${selected.id}/messages`,
          { method: "POST", body: JSON.stringify({ message: reply }) }
        )
      );
      setReply("");
      await loadTickets();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reply.");
    } finally {
      setBusy(false);
    }
  }

  async function updateStatus(status: string) {
    if (!selected) return;
    setBusy(true);
    try {
      setSelected(
        await jsonFetch<SupportTicketDetail>(
          `/api/admin/tickets/${selected.id}/status`,
          { method: "PATCH", body: JSON.stringify({ status }) }
        )
      );
      await loadTickets();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update status.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title={tx("supportTicketsTitle")}
        subtitle={tx("supportTicketsSub")}
      />
      <section className="mx-auto max-w-[1220px] px-5 py-14">
        <AdminNav />
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <Note tone="good">
            {tx("supportTicketsNote")}
          </Note>
          <Link
            href="/admin/posts"
            className="rounded-xl border border-line px-4 py-2.5 text-center text-sm font-semibold text-text transition-colors hover:border-accent hover:text-accent"
          >
            {tx("managePosts")}
          </Link>
        </div>

        {error && <p className="mt-5 text-sm font-semibold text-danger">{error}</p>}

        <div className="mt-8 grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">
          <div className="rounded-3xl border border-line bg-white/[0.02] p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-extrabold text-text">{tx("tickets")}</h2>
              <button
                type="button"
                onClick={loadTickets}
                className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-muted transition-colors hover:border-accent hover:text-accent"
              >
                {tx("refresh")}
              </button>
            </div>
            <div className="mt-5 flex max-h-[620px] flex-col gap-3 overflow-auto pr-1">
              {tickets.length === 0 && <p className="text-sm text-muted">{tx("noTickets")}</p>}
              {tickets.map((ticket) => (
                <button
                  key={ticket.id}
                  type="button"
                  onClick={() => loadTicket(ticket.id)}
                  className={`rounded-2xl border p-4 text-start transition-colors hover:border-accent ${
                    selected?.id === ticket.id ? "border-accent" : "border-line"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="line-clamp-2 text-sm font-extrabold text-text">
                      {ticket.subject}
                    </h3>
                    <span className="rounded-full bg-accent/10 px-2.5 py-1 text-[11px] font-bold text-accent">
                      {ticket.status}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-muted">
                    {ticket.category} · {ticket.priority} · {ticket.platform ?? "-"}
                  </p>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-line bg-white/[0.02] p-6">
            {selected ? (
              <>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="text-lg font-extrabold text-text">{selected.subject}</h2>
                    <p className="mt-1 text-sm text-muted">
                      {selected.category} · {selected.priority} · {selected.product_slug ?? "-"}
                    </p>
                  </div>
                  <select
                    className="rounded-xl border border-line bg-panel/60 px-4 py-2.5 text-sm text-text"
                    value={selected.status}
                    disabled={busy}
                    onChange={(e) => updateStatus(e.target.value)}
                  >
                    {statuses.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="mt-6 flex max-h-80 flex-col gap-3 overflow-auto pr-1">
                  {selected.messages.map((message) => (
                    <article
                      key={message.id}
                      className="rounded-2xl border border-line bg-panel/30 p-4"
                    >
                      <p className="text-xs font-bold text-accent">
                        {message.author_type} · {formatDateTime(message.created_at, lang)}
                      </p>
                      <p className="mt-2 whitespace-pre-wrap text-sm text-text/90">
                        {message.body}
                      </p>
                    </article>
                  ))}
                </div>

                <form onSubmit={sendReply} className="mt-6 flex flex-col gap-3">
                  <textarea
                    className={`${inputCls} min-h-32 resize-y`}
                    placeholder={tx("writeAdminReply")}
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    required
                    maxLength={5000}
                  />
                  <button
                    type="submit"
                    disabled={busy}
                    className="self-start rounded-xl bg-accent px-6 py-3 text-sm font-bold text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {tx("sendAdminReply")}
                  </button>
                </form>
              </>
            ) : (
              <p className="text-sm text-muted">{tx("selectTicket")}</p>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
