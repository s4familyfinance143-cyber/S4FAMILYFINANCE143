"use client";

import { useEffect, useState } from "react";
import { AdminNav } from "@/components/AdminNav";
import { useI18n } from "@/components/LanguageProvider";
import { PageHeader, Note } from "@/components/PageHeader";
import { pricingPlans, products } from "@/lib/site";
import type { AdminLicense, AdminOrder, OrderReceipt } from "@/lib/authApi";
import { adminText } from "@/lib/adminCopy";

const inputCls =
  "w-full rounded-xl border border-line bg-panel/60 px-4 py-3 text-sm text-text placeholder:text-muted focus:border-accent";

const statuses = ["pending", "paid", "refunded", "cancelled", "failed"];

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

export default function AdminOrdersPage() {
  const { lang } = useI18n();
  const tx = (key: string) => adminText(lang, key);
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [licenses, setLicenses] = useState<AdminLicense[]>([]);
  const [receipt, setReceipt] = useState<OrderReceipt | null>(null);
  const [email, setEmail] = useState("");
  const [productSlug, setProductSlug] = useState(products[0]?.slug ?? "");
  const [plan, setPlan] = useState("Yearly");
  const [status, setStatus] = useState("paid");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("BDT");
  const [paymentMethod, setPaymentMethod] = useState("Manual");
  const [paymentReference, setPaymentReference] = useState("");
  const [notes, setNotes] = useState("");
  const [licenseId, setLicenseId] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadData() {
    try {
      setError("");
      const [orderData, licenseData] = await Promise.all([
        jsonFetch<AdminOrder[]>("/api/admin/orders"),
        jsonFetch<AdminLicense[]>("/api/admin/licenses"),
      ]);
      setOrders(orderData);
      setLicenses(licenseData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load orders.");
    }
  }

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      void loadData();
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  async function createOrder(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setOk("");
    try {
      await jsonFetch<AdminOrder>("/api/admin/orders", {
        method: "POST",
        body: JSON.stringify({
          user_email: email,
          status,
          product_slug: productSlug,
          plan,
          amount,
          currency,
          payment_method: paymentMethod,
          payment_reference: paymentReference || null,
          notes: notes || null,
          license_ids: licenseId ? [licenseId] : [],
        }),
      });
      setOk(tx("orderRecorded"));
      setEmail("");
      setAmount("");
      setPaymentReference("");
      setNotes("");
      setLicenseId("");
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create order.");
    } finally {
      setBusy(false);
    }
  }

  async function updateOrder(id: string, nextStatus: string) {
    try {
      await jsonFetch<AdminOrder>(`/api/admin/orders/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus }),
      });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update order.");
    }
  }

  async function loadReceipt(id: string) {
    try {
      setError("");
      setReceipt(await jsonFetch<OrderReceipt>(`/api/admin/orders/${id}/receipt`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load receipt.");
    }
  }

  const productPlans = Array.from(
    new Set(
      pricingPlans
        .filter((item) => item.productSlug === productSlug)
        .map((item) => item.plan)
    )
  );
  const matchingLicenses = licenses.filter(
    (item) => item.user_email.toLowerCase() === email.trim().toLowerCase()
  );

  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title={tx("ordersTitle")}
        subtitle={tx("ordersSub")}
      />
      <section className="mx-auto max-w-[1220px] px-5 py-14">
        <AdminNav />
        <div className="mt-6">
          <Note tone="warn">
            {tx("ordersNote")}
          </Note>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <form
            onSubmit={createOrder}
            className="flex flex-col gap-4 rounded-3xl border border-line bg-white/[0.02] p-6"
          >
            <h2 className="text-lg font-extrabold text-text">{tx("recordOrder")}</h2>
            <input
              className={inputCls}
              type="email"
              placeholder={tx("customerEmail")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <select className={inputCls} value={productSlug} onChange={(e) => setProductSlug(e.target.value)}>
                {products.map((product) => (
                  <option key={product.slug} value={product.slug}>
                    {product.name}
                  </option>
                ))}
              </select>
              <select className={inputCls} value={plan} onChange={(e) => setPlan(e.target.value)}>
                {productPlans.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <input
                className={inputCls}
                placeholder={tx("amount")}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
              <input
                className={inputCls}
                placeholder={tx("currency")}
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                required
              />
              <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
                {statuses.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>
            <input
              className={inputCls}
              placeholder={tx("paymentMethod")}
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              required
            />
            <input
              className={inputCls}
              placeholder={tx("paymentReference")}
              value={paymentReference}
              onChange={(e) => setPaymentReference(e.target.value)}
            />
            <select className={inputCls} value={licenseId} onChange={(e) => setLicenseId(e.target.value)}>
              <option value="">{tx("linkLicenseLater")}</option>
              {matchingLicenses.map((license) => (
                <option key={license.id} value={license.id}>
                  {license.license_key} · {license.product_slug}
                </option>
              ))}
            </select>
            <textarea
              className={`${inputCls} min-h-24 resize-y`}
              placeholder={tx("notes")}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            {error && <p className="text-sm font-semibold text-danger">{error}</p>}
            {ok && <p className="text-sm font-semibold text-good">{ok}</p>}
            <button
              type="submit"
              disabled={busy}
              className="self-start rounded-xl bg-accent px-6 py-3 text-sm font-bold text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy ? tx("saving") : tx("recordOrder")}
            </button>
          </form>

          <div className="rounded-3xl border border-line bg-white/[0.02] p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-extrabold text-text">{tx("orderHistory")}</h2>
              <button
                type="button"
                onClick={loadData}
                className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-muted transition-colors hover:border-accent hover:text-accent"
              >
                {tx("refresh")}
              </button>
            </div>
            <div className="mt-5 flex max-h-[620px] flex-col gap-3 overflow-auto pr-1">
              {orders.length === 0 && <p className="text-sm text-muted">{tx("noOrders")}</p>}
              {orders.map((order) => {
                const product = products.find((p) => p.slug === order.product_slug);
                return (
                  <article key={order.id} className="rounded-2xl border border-line p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <h3 className="text-sm font-extrabold text-text">
                          {order.order_number} · {product?.name ?? order.product_slug}
                        </h3>
                        <p className="mt-1 text-xs text-muted">
                          {order.user_email} · {order.amount} {order.currency} · {order.payment_method}
                        </p>
                      </div>
                      <select
                        className="rounded-xl border border-line bg-panel/60 px-3 py-2 text-xs text-text"
                        value={order.status}
                        onChange={(e) => updateOrder(order.id, e.target.value)}
                      >
                        {statuses.map((item) => (
                          <option key={item} value={item}>
                            {item}
                          </option>
                        ))}
                      </select>
                    </div>
                    <p className="mt-3 text-xs text-muted">
                      {tx("reference")}: {order.payment_reference ?? "-"}
                    </p>
                    <button
                      type="button"
                      onClick={() => loadReceipt(order.id)}
                      className="mt-4 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-muted transition-colors hover:border-accent hover:text-accent"
                    >
                      {tx("viewReceipt")}
                    </button>
                  </article>
                );
              })}
            </div>
          </div>
        </div>

        {receipt && (
          <div className="mt-6 rounded-3xl border border-line bg-white/[0.02] p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-lg font-extrabold text-text">{receipt.receipt_number}</h2>
                <p className="mt-1 text-sm text-muted">
                  {receipt.customer.email} · {receipt.order.order_number}
                </p>
              </div>
              <button
                type="button"
                onClick={() => window.print()}
                className="rounded-xl bg-accent px-4 py-2.5 text-sm font-bold text-bg"
              >
                {tx("print")}
              </button>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-3">
              <section className="rounded-2xl border border-line p-4">
                <h3 className="text-sm font-extrabold text-text">{tx("customer")}</h3>
                <p className="mt-2 text-sm text-muted">{receipt.customer.full_name ?? tx("noName")}</p>
                <p className="mt-1 text-xs text-muted">{receipt.customer.organization ?? tx("noOrg")}</p>
                <p className="mt-1 text-xs text-muted">{receipt.customer.phone ?? tx("noPhone")}</p>
              </section>
              <section className="rounded-2xl border border-line p-4">
                <h3 className="text-sm font-extrabold text-text">{tx("payment")}</h3>
                <p className="mt-2 text-sm text-muted">{receipt.order.amount} {receipt.order.currency}</p>
                <p className="mt-1 text-xs text-muted">{receipt.order.payment_method} · {receipt.order.status}</p>
                <p className="mt-1 text-xs text-muted">{receipt.order.payment_reference ?? tx("reference")}</p>
              </section>
              <section className="rounded-2xl border border-line p-4">
                <h3 className="text-sm font-extrabold text-text">{tx("licenses")}</h3>
                {receipt.licenses.length === 0 ? (
                  <p className="mt-2 text-sm text-muted">{tx("noLinkedLicense")}</p>
                ) : (
                  <div className="mt-2 flex flex-col gap-2">
                    {receipt.licenses.map((license) => (
                      <p key={license.id} className="break-all font-mono text-xs text-muted">
                        {license.license_key}
                      </p>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
