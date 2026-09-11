"use client";

import { useEffect, useState } from "react";
import { AdminNav } from "@/components/AdminNav";
import { useI18n } from "@/components/LanguageProvider";
import { PageHeader, Note } from "@/components/PageHeader";
import { adminText } from "@/lib/adminCopy";
import type { AdminPaymentTransaction } from "@/lib/authApi";
import { formatDateTime } from "@/lib/locale";

const inputCls = "w-full rounded-xl border border-line bg-panel/60 px-4 py-3 text-sm text-text placeholder:text-muted focus:border-accent";
const statuses = ["pending", "authorized", "captured", "failed", "refunded", "cancelled"];

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

export default function AdminPaymentsPage() {
  const { lang } = useI18n();
  const tx = (key: string) => adminText(lang, key);
  const [items, setItems] = useState<AdminPaymentTransaction[]>([]);
  const [customerEmail, setCustomerEmail] = useState("");
  const [orderId, setOrderId] = useState("");
  const [purchaseRequestId, setPurchaseRequestId] = useState("");
  const [provider, setProvider] = useState("manual");
  const [providerPaymentId, setProviderPaymentId] = useState("");
  const [reference, setReference] = useState("");
  const [method, setMethod] = useState("Manual");
  const [status, setStatus] = useState("pending");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("BDT");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadItems() {
    try {
      setError("");
      setItems(await jsonFetch<AdminPaymentTransaction[]>("/api/admin/payments"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load payments.");
    }
  }

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      void loadItems();
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  async function createPayment(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setOk("");
    try {
      await jsonFetch<AdminPaymentTransaction>("/api/admin/payments", {
        method: "POST",
        body: JSON.stringify({
          user_email: customerEmail || null,
          order_id: orderId || null,
          purchase_request_id: purchaseRequestId || null,
          provider,
          provider_payment_id: providerPaymentId || null,
          reference: reference || null,
          method: method || null,
          status,
          amount,
          currency,
          notes: notes || null,
        }),
      });
      setOk(tx("paymentRecorded"));
      setCustomerEmail("");
      setOrderId("");
      setPurchaseRequestId("");
      setProviderPaymentId("");
      setReference("");
      setAmount("");
      setNotes("");
      await loadItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create payment.");
    } finally {
      setBusy(false);
    }
  }

  async function updateStatus(id: string, nextStatus: string) {
    try {
      await jsonFetch<AdminPaymentTransaction>(`/api/admin/payments/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus }),
      });
      await loadItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update payment.");
    }
  }

  return (
    <>
      <PageHeader eyebrow="Admin" title={tx("paymentsTitle")} subtitle={tx("paymentsSub")} />
      <section className="mx-auto max-w-[1220px] px-5 py-14">
        <AdminNav />
        <div className="mt-6"><Note tone="warn">{tx("paymentsNote")}</Note></div>
        <div className="mt-8 grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <form onSubmit={createPayment} className="flex flex-col gap-4 rounded-3xl border border-line bg-white/[0.02] p-6">
            <h2 className="text-lg font-extrabold text-text">{tx("createPayment")}</h2>
            <input className={inputCls} placeholder={tx("customerEmail")} value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} />
            <div className="grid gap-3 sm:grid-cols-2">
              <input className={inputCls} placeholder={tx("linkedOrderId")} value={orderId} onChange={(e) => setOrderId(e.target.value)} />
              <input className={inputCls} placeholder={tx("linkedPurchaseRequestId")} value={purchaseRequestId} onChange={(e) => setPurchaseRequestId(e.target.value)} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <input className={inputCls} placeholder={tx("provider")} value={provider} onChange={(e) => setProvider(e.target.value)} required />
              <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>{statuses.map((item) => <option key={item} value={item}>{item}</option>)}</select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <input className={inputCls} placeholder={tx("amount")} value={amount} onChange={(e) => setAmount(e.target.value)} required />
              <input className={inputCls} placeholder={tx("currency")} value={currency} onChange={(e) => setCurrency(e.target.value)} required />
            </div>
            <input className={inputCls} placeholder={tx("paymentMethod")} value={method} onChange={(e) => setMethod(e.target.value)} />
            <input className={inputCls} placeholder={tx("providerPaymentId")} value={providerPaymentId} onChange={(e) => setProviderPaymentId(e.target.value)} />
            <input className={inputCls} placeholder={tx("reference")} value={reference} onChange={(e) => setReference(e.target.value)} />
            <textarea className={`${inputCls} min-h-24 resize-y`} placeholder={tx("notes")} value={notes} onChange={(e) => setNotes(e.target.value)} />
            {error && <p className="text-sm font-semibold text-danger">{error}</p>}
            {ok && <p className="text-sm font-semibold text-good">{ok}</p>}
            <button type="submit" disabled={busy} className="self-start rounded-xl bg-accent px-6 py-3 text-sm font-bold text-bg transition-opacity hover:opacity-90 disabled:opacity-50">
              {busy ? tx("saving") : tx("createPayment")}
            </button>
          </form>
          <div className="rounded-3xl border border-line bg-white/[0.02] p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-extrabold text-text">{tx("transactionRegistry")}</h2>
              <button type="button" onClick={loadItems} className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-muted hover:border-accent hover:text-accent">{tx("refresh")}</button>
            </div>
            <div className="mt-5 flex max-h-[700px] flex-col gap-3 overflow-auto pr-1">
              {items.length === 0 && <p className="text-sm text-muted">{tx("noPayments")}</p>}
              {items.map((item) => (
                <article key={item.id} className="rounded-2xl border border-line p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h3 className="text-sm font-extrabold text-text">{item.user_email}</h3>
                      <p className="mt-1 text-xs text-muted">{item.provider} · {item.amount} {item.currency} · {formatDateTime(item.created_at, lang)}</p>
                    </div>
                    <select className="rounded-xl border border-line bg-panel/60 px-3 py-2 text-xs text-text" value={item.status} onChange={(e) => updateStatus(item.id, e.target.value)}>{statuses.map((status) => <option key={status} value={status}>{status}</option>)}</select>
                  </div>
                  <dl className="mt-4 grid gap-2 text-xs text-muted sm:grid-cols-2">
                    <div><dt className="font-bold text-text/80">{tx("reference")}</dt><dd className="mt-1 break-all">{item.reference ?? "-"}</dd></div>
                    <div><dt className="font-bold text-text/80">{tx("providerPaymentId")}</dt><dd className="mt-1 break-all">{item.provider_payment_id ?? "-"}</dd></div>
                    <div><dt className="font-bold text-text/80">{tx("linkedOrderId")}</dt><dd className="mt-1 break-all">{item.order_id ?? "-"}</dd></div>
                    <div><dt className="font-bold text-text/80">{tx("linkedPurchaseRequestId")}</dt><dd className="mt-1 break-all">{item.purchase_request_id ?? "-"}</dd></div>
                  </dl>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
