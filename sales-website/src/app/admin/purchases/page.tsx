"use client";

import { useEffect, useState } from "react";
import { AdminNav } from "@/components/AdminNav";
import { useI18n } from "@/components/LanguageProvider";
import { PageHeader, Note } from "@/components/PageHeader";
import { adminText } from "@/lib/adminCopy";
import type { AdminPurchaseRequest } from "@/lib/authApi";
import { formatDateTime } from "@/lib/locale";
import { products } from "@/lib/site";

const statuses = ["new", "contacted", "payment_pending", "paid", "fulfilled", "cancelled"];

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

function productName(slug: string) {
  return products.find((product) => product.slug === slug)?.name ?? slug;
}

export default function AdminPurchasesPage() {
  const { lang } = useI18n();
  const tx = (key: string) => adminText(lang, key);
  const [items, setItems] = useState<AdminPurchaseRequest[]>([]);
  const [error, setError] = useState("");

  async function loadItems() {
    try {
      setError("");
      setItems(await jsonFetch<AdminPurchaseRequest[]>("/api/admin/purchase-requests"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load purchase requests.");
    }
  }

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      jsonFetch<AdminPurchaseRequest[]>("/api/admin/purchase-requests")
        .then(setItems)
        .catch((err) => setError(err instanceof Error ? err.message : "Failed to load purchase requests."));
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  async function updateItem(id: string, body: Partial<Pick<AdminPurchaseRequest, "status" | "admin_notes">>) {
    try {
      await jsonFetch<AdminPurchaseRequest>(`/api/admin/purchase-requests/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      await loadItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update request.");
    }
  }

  async function saveNotes(e: React.FormEvent<HTMLFormElement>, id: string) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    await updateItem(id, { admin_notes: String(form.get("admin_notes") ?? "") });
  }

  return (
    <>
      <PageHeader eyebrow="Admin" title={tx("purchaseRequestsTitle")} subtitle={tx("purchaseRequestsSub")} />
      <section className="mx-auto max-w-[1220px] px-5 py-14">
        <AdminNav />
        <div className="mt-6"><Note tone="good">{tx("purchaseRequestsSub")}</Note></div>
        <div className="mt-8 rounded-3xl border border-line bg-white/[0.02] p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-extrabold text-text">{tx("purchaseRequestsTitle")}</h2>
            <button type="button" onClick={loadItems} className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-muted transition-colors hover:border-accent hover:text-accent">{tx("refresh")}</button>
          </div>
          {error && <p className="mt-4 text-sm font-semibold text-danger">{error}</p>}
          <div className="mt-5 flex flex-col gap-3">
            {items.length === 0 && <p className="text-sm text-muted">{tx("noPurchaseRequests")}</p>}
            {items.map((item) => (
              <article key={item.id} className="rounded-2xl border border-line p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="text-sm font-extrabold text-text">{productName(item.product_slug)}</h3>
                    <p className="mt-1 text-xs text-muted">{item.user_email} · {item.plan} · {formatDateTime(item.created_at, lang)}</p>
                  </div>
                  <select className="rounded-xl border border-line bg-panel/60 px-3 py-2 text-xs text-text" value={item.status} onChange={(e) => updateItem(item.id, { status: e.target.value })}>
                    {statuses.map((status) => <option key={status} value={status}>{status}</option>)}
                  </select>
                </div>
                <dl className="mt-4 grid gap-2 text-xs text-muted sm:grid-cols-3">
                  <div><dt className="font-bold text-text/80">{tx("amount")}</dt><dd className="mt-1">{item.amount ?? "-"} {item.currency}</dd></div>
                  <div><dt className="font-bold text-text/80">{tx("paymentMethod")}</dt><dd className="mt-1">{item.payment_method ?? "-"}</dd></div>
                  <div><dt className="font-bold text-text/80">{tx("reference")}</dt><dd className="mt-1">{item.payment_reference ?? "-"}</dd></div>
                </dl>
                {item.customer_notes && <p className="mt-3 text-sm text-muted">{item.customer_notes}</p>}
                <form onSubmit={(e) => saveNotes(e, item.id)} className="mt-4 flex flex-col gap-2">
                  <textarea name="admin_notes" defaultValue={item.admin_notes ?? ""} className="min-h-20 rounded-xl border border-line bg-panel/60 px-3 py-2 text-sm text-text placeholder:text-muted" placeholder={tx("adminNotes")} />
                  <button type="submit" className="self-start rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-bg transition-opacity hover:opacity-90">{tx("updateRequest")}</button>
                </form>
              </article>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
