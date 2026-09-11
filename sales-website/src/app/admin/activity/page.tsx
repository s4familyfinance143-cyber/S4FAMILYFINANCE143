"use client";

import { useEffect, useState } from "react";
import { AdminNav } from "@/components/AdminNav";
import { useI18n } from "@/components/LanguageProvider";
import { PageHeader, Note } from "@/components/PageHeader";
import { adminText } from "@/lib/adminCopy";
import type { AdminEvent } from "@/lib/authApi";
import { formatDateTime } from "@/lib/locale";

const eventTypes = [
  "support_ticket_created",
  "support_ticket_admin_reply",
  "license_created",
  "license_updated",
  "license_activated",
  "license_deactivated",
  "order_created",
  "order_updated",
  "release_created",
  "release_updated",
  "customer_admin_updated",
];

async function jsonFetch<T>(path: string) {
  const res = await fetch(path, { cache: "no-store" });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "Request failed.");
  return data as T;
}

function labelEvent(type: string) {
  return type.replaceAll("_", " ");
}

export default function AdminActivityPage() {
  const { lang } = useI18n();
  const tx = (key: string) => adminText(lang, key);
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [eventType, setEventType] = useState("");
  const [error, setError] = useState("");

  async function loadEvents(nextType = eventType) {
    try {
      setError("");
      const params = new URLSearchParams({ limit: "150" });
      if (nextType) params.set("event_type", nextType);
      setEvents(await jsonFetch<AdminEvent[]>(`/api/admin/events?${params.toString()}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load events.");
    }
  }

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const params = new URLSearchParams({ limit: "150" });
      jsonFetch<AdminEvent[]>(`/api/admin/events?${params.toString()}`)
        .then(setEvents)
        .catch((err) => {
          setError(err instanceof Error ? err.message : "Failed to load events.");
        });
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title={tx("activityTitle")}
        subtitle={tx("activitySub")}
      />
      <section className="mx-auto max-w-[1220px] px-5 py-14">
        <AdminNav />
        <div className="mt-6">
          <Note tone="good">{tx("activitySub")}</Note>
        </div>

        <div className="mt-8 rounded-3xl border border-line bg-white/[0.02] p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="w-full max-w-sm">
              <label className="text-xs font-bold uppercase tracking-[0.18em] text-muted">
                {tx("eventType")}
              </label>
              <select
                className="mt-2 w-full rounded-xl border border-line bg-panel/60 px-4 py-3 text-sm text-text focus:border-accent"
                value={eventType}
                onChange={(e) => {
                  setEventType(e.target.value);
                  void loadEvents(e.target.value);
                }}
              >
                <option value="">{tx("allEvents")}</option>
                {eventTypes.map((type) => (
                  <option key={type} value={type}>
                    {labelEvent(type)}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={() => loadEvents()}
              className="rounded-xl border border-line px-4 py-3 text-sm font-semibold text-text transition-colors hover:border-accent hover:text-accent"
            >
              {tx("refresh")}
            </button>
          </div>

          {error && <p className="mt-5 text-sm font-semibold text-danger">{error}</p>}

          <div className="mt-6 flex flex-col gap-3">
            <h2 className="text-lg font-extrabold text-text">{tx("recentEvents")}</h2>
            {events.length === 0 && <p className="text-sm text-muted">{tx("noEvents")}</p>}
            {events.map((event) => (
              <article key={event.id} className="rounded-2xl border border-line p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <h3 className="text-sm font-extrabold text-text">
                      {labelEvent(event.event_type)}
                    </h3>
                    <p className="mt-1 text-xs text-muted">
                      {formatDateTime(event.created_at, lang)}
                    </p>
                  </div>
                  <span className="w-fit rounded-full bg-accent/10 px-3 py-1 text-xs font-bold text-accent">
                    {event.user_email ?? "system"}
                  </span>
                </div>
                <dl className="mt-4 grid gap-2 text-xs text-muted md:grid-cols-3">
                  <div>
                    <dt className="font-bold text-text/80">{tx("user")}</dt>
                    <dd className="mt-1 break-all">{event.user_email ?? event.user_id ?? "-"}</dd>
                  </div>
                  <div>
                    <dt className="font-bold text-text/80">{tx("ipAddress")}</dt>
                    <dd className="mt-1">{event.ip ?? "-"}</dd>
                  </div>
                  <div>
                    <dt className="font-bold text-text/80">{tx("userAgent")}</dt>
                    <dd className="mt-1 line-clamp-2 break-all">{event.user_agent ?? "-"}</dd>
                  </div>
                </dl>
                {event.detail && <p className="mt-3 text-sm text-muted">{event.detail}</p>}
              </article>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
