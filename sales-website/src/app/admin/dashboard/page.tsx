"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AdminNav } from "@/components/AdminNav";
import { useI18n } from "@/components/LanguageProvider";
import { PageHeader, Note } from "@/components/PageHeader";
import type { AdminDashboard } from "@/lib/authApi";
import { adminCopy } from "@/lib/adminCopy";
import { products } from "@/lib/site";

async function jsonFetch<T>(path: string) {
  const res = await fetch(path, { cache: "no-store" });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "Request failed.");
  return data as T;
}

function productName(slug: string) {
  return products.find((product) => product.slug === slug)?.name ?? slug;
}

const metricKeys: Array<keyof AdminDashboard["metrics"]> = [
  "total_customers",
  "active_customers",
  "unverified_customers",
  "active_licenses",
  "paid_orders",
  "pending_orders",
  "open_tickets",
  "available_releases",
];

export default function AdminDashboardPage() {
  const { lang } = useI18n();
  const c = adminCopy[lang] ?? adminCopy.en;
  const [dashboard, setDashboard] = useState<AdminDashboard | null>(null);
  const [error, setError] = useState("");

  async function loadDashboard() {
    try {
      setError("");
      setDashboard(await jsonFetch<AdminDashboard>("/api/admin/dashboard"));
    } catch (err) {
      setError(err instanceof Error ? err.message : c.loading);
    }
  }

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      jsonFetch<AdminDashboard>("/api/admin/dashboard")
        .then(setDashboard)
        .catch((err) => {
          setError(err instanceof Error ? err.message : c.loading);
        });
    });
    return () => cancelAnimationFrame(frame);
  }, [c.loading]);

  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title={c.dashboardTitle}
        subtitle={c.dashboardSub}
      />
      <section className="mx-auto max-w-[1220px] px-5 py-14">
        <AdminNav />
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Note tone="good">{c.dashboardNote}</Note>
          <button
            type="button"
            onClick={loadDashboard}
            className="rounded-xl border border-line px-4 py-2.5 text-sm font-semibold text-text transition-colors hover:border-accent hover:text-accent"
          >
            {c.refresh}
          </button>
        </div>

        {error && <p className="mt-6 text-sm font-semibold text-danger">{error}</p>}

        {!dashboard ? (
          <p className="mt-8 text-sm text-muted">{c.loading}</p>
        ) : (
          <div className="mt-8 flex flex-col gap-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {metricKeys.map((key) => (
                <article key={key} className="rounded-3xl border border-line bg-white/[0.02] p-5">
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted">{c.metrics[key]}</p>
                  <p className="mt-3 text-3xl font-black text-text">{dashboard.metrics[key]}</p>
                </article>
              ))}
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <section className="rounded-3xl border border-line bg-white/[0.02] p-6">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-extrabold text-text">{c.recentCustomers}</h2>
                  <Link href="/admin/customers" className="text-xs font-bold text-accent hover:underline">{c.open}</Link>
                </div>
                <div className="mt-5 flex flex-col gap-3">
                  {dashboard.recent_customers.map((customer) => (
                    <article key={customer.id} className="rounded-2xl border border-line p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-extrabold text-text">{customer.email}</p>
                          <p className="mt-1 text-xs text-muted">{customer.full_name ?? c.noName}</p>
                        </div>
                        <span className={`rounded-full px-3 py-1 text-xs font-bold ${customer.is_active ? "bg-good/10 text-good" : "bg-danger/10 text-danger"}`}>
                          {customer.is_active ? c.active : c.disabled}
                        </span>
                      </div>
                    </article>
                  ))}
                </div>
              </section>

              <section className="rounded-3xl border border-line bg-white/[0.02] p-6">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-extrabold text-text">{c.recentOrders}</h2>
                  <Link href="/admin/orders" className="text-xs font-bold text-accent hover:underline">{c.open}</Link>
                </div>
                <div className="mt-5 flex flex-col gap-3">
                  {dashboard.recent_orders.map((order) => (
                    <article key={order.id} className="rounded-2xl border border-line p-4">
                      <p className="text-sm font-extrabold text-text">{order.order_number}</p>
                      <p className="mt-1 text-xs text-muted">{order.user_email} · {order.amount} {order.currency}</p>
                      <p className="mt-2 text-xs font-bold text-accent">{order.status}</p>
                    </article>
                  ))}
                </div>
              </section>

              <section className="rounded-3xl border border-line bg-white/[0.02] p-6">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-extrabold text-text">{c.recentTickets}</h2>
                  <Link href="/admin/tickets" className="text-xs font-bold text-accent hover:underline">{c.open}</Link>
                </div>
                <div className="mt-5 flex flex-col gap-3">
                  {dashboard.recent_tickets.map((ticket) => (
                    <article key={ticket.id} className="rounded-2xl border border-line p-4">
                      <p className="text-sm font-extrabold text-text">{ticket.subject}</p>
                      <p className="mt-1 text-xs text-muted">{ticket.user_email} · {ticket.priority}</p>
                      <p className="mt-2 text-xs font-bold text-accent">{ticket.status}</p>
                    </article>
                  ))}
                </div>
              </section>

              <section className="rounded-3xl border border-line bg-white/[0.02] p-6">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-extrabold text-text">{c.recentReleases}</h2>
                  <Link href="/admin/releases" className="text-xs font-bold text-accent hover:underline">{c.open}</Link>
                </div>
                <div className="mt-5 flex flex-col gap-3">
                  {dashboard.recent_releases.map((release) => (
                    <article key={release.id} className="rounded-2xl border border-line p-4">
                      <p className="text-sm font-extrabold text-text">{productName(release.product_slug)}</p>
                      <p className="mt-1 text-xs text-muted">{release.platform} · v{release.version}</p>
                      <p className="mt-2 text-xs font-bold text-accent">{release.status} · {release.is_active ? c.active : c.inactive}</p>
                    </article>
                  ))}
                </div>
              </section>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
