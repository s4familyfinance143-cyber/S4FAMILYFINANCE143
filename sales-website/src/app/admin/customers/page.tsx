"use client";

import { useEffect, useState } from "react";
import { AdminNav } from "@/components/AdminNav";
import { useI18n } from "@/components/LanguageProvider";
import { PageHeader, Note } from "@/components/PageHeader";
import type { AdminCustomer, AdminCustomerDetail } from "@/lib/authApi";
import { adminText } from "@/lib/adminCopy";
import { formatDate } from "@/lib/locale";
import { products } from "@/lib/site";

const inputCls =
  "w-full rounded-xl border border-line bg-panel/60 px-4 py-3 text-sm text-text placeholder:text-muted focus:border-accent";

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

function productName(slug: string | null) {
  if (!slug) return "No product";
  return products.find((product) => product.slug === slug)?.name ?? slug;
}

export default function AdminCustomersPage() {
  const { lang } = useI18n();
  const tx = (key: string) => adminText(lang, key);
  const [customers, setCustomers] = useState<AdminCustomer[]>([]);
  const [selected, setSelected] = useState<AdminCustomerDetail | null>(null);
  const [query, setQuery] = useState("");
  const [phone, setPhone] = useState("");
  const [fullName, setFullName] = useState("");
  const [organization, setOrganization] = useState("");
  const [country, setCountry] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [isVerified, setIsVerified] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);

  function hydrateForm(customer: AdminCustomerDetail) {
    setPhone(customer.phone ?? "");
    setFullName(customer.profile?.full_name ?? "");
    setOrganization(customer.profile?.organization ?? "");
    setCountry(customer.profile?.country ?? "");
    setIsActive(customer.is_active);
    setIsVerified(customer.is_verified);
  }

  async function loadCustomers(search = query) {
    try {
      setError("");
      const path = search.trim()
        ? `/api/admin/customers?q=${encodeURIComponent(search.trim())}`
        : "/api/admin/customers";
      const data = await jsonFetch<AdminCustomer[]>(path);
      setCustomers(data);
      if (selected && !data.some((customer) => customer.id === selected.id)) {
        setSelected(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load customers.");
    }
  }

  async function loadDetail(id: string) {
    try {
      setError("");
      setOk("");
      const detail = await jsonFetch<AdminCustomerDetail>(`/api/admin/customers/${id}`);
      setSelected(detail);
      hydrateForm(detail);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load customer.");
    }
  }

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      jsonFetch<AdminCustomer[]>("/api/admin/customers")
        .then(setCustomers)
        .catch((err) => {
          setError(err instanceof Error ? err.message : "Failed to load customers.");
        });
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  async function updateCustomer(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError("");
    setOk("");
    try {
      const detail = await jsonFetch<AdminCustomerDetail>(`/api/admin/customers/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          phone: phone || null,
          is_active: isActive,
          is_verified: isVerified,
          full_name: fullName || null,
          organization: organization || null,
          country: country || null,
        }),
      });
      setSelected(detail);
      hydrateForm(detail);
      setOk(tx("customerUpdated"));
      await loadCustomers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update customer.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title={tx("customersTitle")}
        subtitle={tx("customersSub")}
      />
      <section className="mx-auto max-w-[1220px] px-5 py-14">
        <AdminNav />
        <div className="mt-6">
          <Note tone="good">
            {tx("customersNote")}
          </Note>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-3xl border border-line bg-white/[0.02] p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-lg font-extrabold text-text">{tx("customerList")}</h2>
              <button
                type="button"
                onClick={() => loadCustomers()}
                className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-muted transition-colors hover:border-accent hover:text-accent"
              >
                {tx("refresh")}
              </button>
            </div>
            <form
              className="mt-4 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void loadCustomers();
              }}
            >
              <input
                className={inputCls}
                placeholder={tx("searchCustomers")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button className="rounded-xl bg-accent px-5 text-sm font-bold text-bg" type="submit">
                {tx("search")}
              </button>
            </form>
            <div className="mt-5 flex max-h-[650px] flex-col gap-3 overflow-auto pr-1">
              {customers.length === 0 && <p className="text-sm text-muted">{tx("noCustomers")}</p>}
              {customers.map((customer) => (
                <button
                  key={customer.id}
                  type="button"
                  onClick={() => loadDetail(customer.id)}
                  className={`rounded-2xl border p-4 text-start transition-colors ${
                    selected?.id === customer.id
                      ? "border-accent bg-accent/10"
                      : "border-line hover:border-accent"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-extrabold text-text">{customer.email}</h3>
                      <p className="mt-1 text-xs text-muted">
                        {customer.profile?.full_name ?? tx("noName")} · {customer.profile?.organization ?? tx("noOrg")}
                      </p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-bold ${
                      customer.is_active ? "bg-good/10 text-good" : "bg-danger/10 text-danger"
                    }`}>
                      {customer.is_active ? tx("active") : tx("disabled")}
                    </span>
                  </div>
                  <p className="mt-3 text-xs text-muted">
                    {customer.license_count} {tx("licenses")} · {customer.order_count} {tx("orders")} · {customer.ticket_count} {tx("tickets")}
                  </p>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-line bg-white/[0.02] p-6">
            {!selected ? (
              <p className="text-sm text-muted">{tx("selectCustomer")}</p>
            ) : (
              <div className="flex flex-col gap-6">
                <div>
                  <h2 className="text-lg font-extrabold text-text">{selected.email}</h2>
                  <p className="mt-1 text-sm text-muted">
                    {tx("joined")} {formatDate(selected.created_at, lang)} · {selected.is_verified ? tx("verified") : tx("unverified")}
                  </p>
                </div>

                <form onSubmit={updateCustomer} className="grid gap-3 rounded-2xl border border-line p-4">
                  <h3 className="text-sm font-extrabold text-text">{tx("accountProfile")}</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <input className={inputCls} placeholder={tx("fullName")} value={fullName} onChange={(e) => setFullName(e.target.value)} />
                    <input className={inputCls} placeholder={tx("phone")} value={phone} onChange={(e) => setPhone(e.target.value)} />
                    <input className={inputCls} placeholder={tx("organization")} value={organization} onChange={(e) => setOrganization(e.target.value)} />
                    <input className={inputCls} placeholder={tx("country")} value={country} onChange={(e) => setCountry(e.target.value)} />
                  </div>
                  <div className="flex flex-wrap gap-4 text-sm text-muted">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                      {tx("activeAccount")}
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={isVerified} onChange={(e) => setIsVerified(e.target.checked)} />
                      {tx("emailVerified")}
                    </label>
                  </div>
                  {error && <p className="text-sm font-semibold text-danger">{error}</p>}
                  {ok && <p className="text-sm font-semibold text-good">{ok}</p>}
                  <button
                    type="submit"
                    disabled={busy}
                    className="self-start rounded-xl bg-accent px-6 py-3 text-sm font-bold text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {busy ? tx("saving") : tx("saveCustomer")}
                  </button>
                </form>

                <div className="grid gap-4 xl:grid-cols-3">
                  <div className="rounded-2xl border border-line p-4">
                    <h3 className="text-sm font-extrabold text-text">{tx("licenses")}</h3>
                    <div className="mt-3 flex flex-col gap-3">
                      {selected.licenses.length === 0 && <p className="text-xs text-muted">{tx("noLicenses")}</p>}
                      {selected.licenses.map((license) => (
                        <div key={license.id} className="rounded-xl bg-panel/40 p-3">
                          <p className="text-xs font-bold text-text">{productName(license.product_slug)}</p>
                          <p className="mt-1 text-xs text-muted">{license.plan} · {license.status} · {license.seats} seat(s)</p>
                          <p className="mt-2 break-all font-mono text-[11px] text-muted">{license.license_key}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-line p-4">
                    <h3 className="text-sm font-extrabold text-text">{tx("orders")}</h3>
                    <div className="mt-3 flex flex-col gap-3">
                      {selected.orders.length === 0 && <p className="text-xs text-muted">{tx("noOrders")}</p>}
                      {selected.orders.map((order) => (
                        <div key={order.id} className="rounded-xl bg-panel/40 p-3">
                          <p className="text-xs font-bold text-text">{order.order_number}</p>
                          <p className="mt-1 text-xs text-muted">{order.amount} {order.currency} · {order.status}</p>
                          <p className="mt-1 text-xs text-muted">{order.payment_method} · {order.payment_reference ?? "-"}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-line p-4">
                    <h3 className="text-sm font-extrabold text-text">{tx("tickets")}</h3>
                    <div className="mt-3 flex flex-col gap-3">
                      {selected.tickets.length === 0 && <p className="text-xs text-muted">{tx("noTickets")}</p>}
                      {selected.tickets.map((ticket) => (
                        <div key={ticket.id} className="rounded-xl bg-panel/40 p-3">
                          <p className="text-xs font-bold text-text">{ticket.subject}</p>
                          <p className="mt-1 text-xs text-muted">{ticket.category} · {ticket.priority} · {ticket.status}</p>
                          <p className="mt-1 text-xs text-muted">{productName(ticket.product_slug)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
