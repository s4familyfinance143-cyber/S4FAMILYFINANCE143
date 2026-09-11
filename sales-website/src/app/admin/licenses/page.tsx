"use client";

import { useEffect, useState } from "react";
import { AdminNav } from "@/components/AdminNav";
import { useI18n } from "@/components/LanguageProvider";
import { PageHeader, Note } from "@/components/PageHeader";
import { pricingPlans, products } from "@/lib/site";
import type { AdminLicense } from "@/lib/authApi";
import { adminText } from "@/lib/adminCopy";

const inputCls =
  "w-full rounded-xl border border-line bg-panel/60 px-4 py-3 text-sm text-text placeholder:text-muted focus:border-accent";

const statuses = ["active", "pending", "suspended", "expired", "revoked"];

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

export default function AdminLicensesPage() {
  const { lang } = useI18n();
  const tx = (key: string) => adminText(lang, key);
  const [licenses, setLicenses] = useState<AdminLicense[]>([]);
  const [email, setEmail] = useState("");
  const [productSlug, setProductSlug] = useState(products[0]?.slug ?? "");
  const [plan, setPlan] = useState("Yearly");
  const [status, setStatus] = useState("active");
  const [seats, setSeats] = useState(1);
  const [downloadUrl, setDownloadUrl] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadLicenses() {
    try {
      setError("");
      setLicenses(await jsonFetch<AdminLicense[]>("/api/admin/licenses"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load licenses.");
    }
  }

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      void loadLicenses();
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  async function createLicense(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setOk("");
    try {
      await jsonFetch<AdminLicense>("/api/admin/licenses", {
        method: "POST",
        body: JSON.stringify({
          user_email: email,
          product_slug: productSlug,
          plan,
          status,
          seats,
          download_url: downloadUrl || null,
          expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
        }),
      });
      setOk(tx("licenseCreated"));
      setEmail("");
      setDownloadUrl("");
      setExpiresAt("");
      await loadLicenses();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create license.");
    } finally {
      setBusy(false);
    }
  }

  async function updateLicense(id: string, nextStatus: string) {
    try {
      await jsonFetch<AdminLicense>(`/api/admin/licenses/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus }),
      });
      await loadLicenses();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update license.");
    }
  }

  const productPlans = Array.from(
    new Set(
      pricingPlans
        .filter((item) => item.productSlug === productSlug)
        .map((item) => item.plan)
    )
  );

  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title={tx("licensesTitle")}
        subtitle={tx("licensesSub")}
      />
      <section className="mx-auto max-w-[1220px] px-5 py-14">
        <AdminNav />
        <div className="mt-6">
          <Note tone="good">
            {tx("licensesNote")}
          </Note>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <form
            onSubmit={createLicense}
            className="flex flex-col gap-4 rounded-3xl border border-line bg-white/[0.02] p-6"
          >
            <h2 className="text-lg font-extrabold text-text">{tx("createLicense")}</h2>
            <input
              className={inputCls}
              type="email"
              placeholder={tx("customerEmail")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <select
              className={inputCls}
              value={productSlug}
              onChange={(e) => {
                setProductSlug(e.target.value);
                setPlan("Trial");
              }}
            >
              {products.map((product) => (
                <option key={product.slug} value={product.slug}>
                  {product.name}
                </option>
              ))}
            </select>
            <div className="grid gap-3 sm:grid-cols-3">
              <select className={inputCls} value={plan} onChange={(e) => setPlan(e.target.value)}>
                {productPlans.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
              <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
                {statuses.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
              <input
                className={inputCls}
                type="number"
                min={1}
                max={999}
                value={seats}
                onChange={(e) => setSeats(Number(e.target.value))}
              />
            </div>
            <input
              className={inputCls}
              placeholder={tx("downloadUrlOptional")}
              value={downloadUrl}
              onChange={(e) => setDownloadUrl(e.target.value)}
            />
            <input
              className={inputCls}
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
            {error && <p className="text-sm font-semibold text-danger">{error}</p>}
            {ok && <p className="text-sm font-semibold text-good">{ok}</p>}
            <button
              type="submit"
              disabled={busy}
              className="self-start rounded-xl bg-accent px-6 py-3 text-sm font-bold text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy ? tx("saving") : tx("createLicense")}
            </button>
          </form>

          <div className="rounded-3xl border border-line bg-white/[0.02] p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-extrabold text-text">{tx("assignedLicenses")}</h2>
              <button
                type="button"
                onClick={loadLicenses}
                className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-muted transition-colors hover:border-accent hover:text-accent"
              >
                {tx("refresh")}
              </button>
            </div>
            <div className="mt-5 flex max-h-[620px] flex-col gap-3 overflow-auto pr-1">
              {licenses.length === 0 && <p className="text-sm text-muted">{tx("noLicenses")}</p>}
              {licenses.map((license) => {
                const product = products.find((p) => p.slug === license.product_slug);
                return (
                  <article key={license.id} className="rounded-2xl border border-line p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <h3 className="text-sm font-extrabold text-text">
                          {product?.name ?? license.product_slug}
                        </h3>
                        <p className="mt-1 text-xs text-muted">
                          {license.user_email} · {license.plan} · {license.active_activation_count}/{license.seats} {tx("activations")}
                        </p>
                      </div>
                      <select
                        className="rounded-xl border border-line bg-panel/60 px-3 py-2 text-xs text-text"
                        value={license.status}
                        onChange={(e) => updateLicense(license.id, e.target.value)}
                      >
                        {statuses.map((item) => (
                          <option key={item} value={item}>
                            {item}
                          </option>
                        ))}
                      </select>
                    </div>
                    <p className="mt-3 break-all font-mono text-xs text-muted">
                      {license.license_key}
                    </p>
                  </article>
                );
              })}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
