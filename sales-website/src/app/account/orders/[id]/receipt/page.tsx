"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/components/AuthProvider";
import { useI18n } from "@/components/LanguageProvider";
import { accountCopy } from "@/lib/accountCopy";
import { authCopy } from "@/lib/authCopy";
import type { OrderReceipt } from "@/lib/authApi";
import { formatDate } from "@/lib/locale";
import { products } from "@/lib/site";

function productName(slug: string) {
  return products.find((product) => product.slug === slug)?.name ?? slug;
}

export default function AccountOrderReceiptPage() {
  const params = useParams<{ id: string }>();
  const { lang } = useI18n();
  const ac = accountCopy[lang] ?? accountCopy.en;
  const auth = authCopy[lang] ?? authCopy.en;
  const { ready, isAuthenticated, authFetch } = useAuth();
  const [receipt, setReceipt] = useState<OrderReceipt | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!ready || !isAuthenticated || !params.id) return;
    let active = true;
    void (async () => {
      const res = await authFetch<OrderReceipt>(`/orders/${params.id}/receipt`);
      if (!active) return;
      if (res.ok && res.data) {
        setReceipt(res.data);
        setError("");
      } else {
        setError(res.error ?? ac.receiptNotFound);
      }
    })();
    return () => {
      active = false;
    };
  }, [ready, isAuthenticated, authFetch, params.id, ac.receiptNotFound]);

  if (!ready) {
    return <section className="mx-auto max-w-md px-5 py-24 text-center text-muted">{auth.acLoading}</section>;
  }

  if (!isAuthenticated) {
    return (
      <section className="mx-auto max-w-md px-5 py-24 text-center">
        <p className="text-text">{ac.loginForReceipt}</p>
        <Link href="/login" className="mt-6 inline-block rounded-xl bg-accent px-6 py-3 text-sm font-bold text-bg">
          {auth.acGoLogin}
        </Link>
      </section>
    );
  }

  return (
    <>
      <PageHeader eyebrow={ac.receipt} title={receipt?.receipt_number ?? ac.orderReceipt} subtitle={receipt?.order.order_number} />
      <section className="mx-auto max-w-[860px] px-5 py-12">
        <div className="mb-6 flex flex-wrap gap-3 print:hidden">
          <Link href="/account" className="rounded-xl border border-line px-4 py-2.5 text-sm font-semibold text-text transition-colors hover:border-accent hover:text-accent">
            {ac.backToAccount}
          </Link>
          {receipt && (
            <button type="button" onClick={() => window.print()} className="rounded-xl bg-accent px-4 py-2.5 text-sm font-bold text-bg">
              {ac.printReceipt}
            </button>
          )}
        </div>

        {error && <p className="rounded-2xl border border-danger/30 bg-danger/10 p-4 text-sm font-semibold text-danger">{error}</p>}
        {!receipt && !error && <p className="text-sm text-muted">{ac.loadingReceipt}</p>}

        {receipt && (
          <article className="rounded-3xl border border-line bg-white/[0.02] p-7 print:border-black print:bg-white print:text-black">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-2xl font-black text-text print:text-black">{receipt.seller_name}</h2>
                <p className="mt-1 text-sm text-muted print:text-black">{receipt.seller_email}</p>
              </div>
              <div className="text-sm text-muted print:text-black sm:text-end">
                <p className="font-bold text-text print:text-black">{receipt.receipt_number}</p>
                <p>{ac.issued}: {formatDate(receipt.issued_at, lang)}</p>
              </div>
            </div>

            <div className="mt-8 grid gap-6 sm:grid-cols-2">
              <section className="rounded-2xl border border-line p-4 print:border-black">
                <h3 className="text-sm font-extrabold text-text print:text-black">{ac.customer}</h3>
                <p className="mt-3 text-sm text-muted print:text-black">{receipt.customer.full_name ?? receipt.customer.email}</p>
                <p className="mt-1 text-sm text-muted print:text-black">{receipt.customer.email}</p>
                <p className="mt-1 text-sm text-muted print:text-black">{receipt.customer.organization ?? "-"}</p>
                <p className="mt-1 text-sm text-muted print:text-black">{receipt.customer.phone ?? "-"}</p>
              </section>
              <section className="rounded-2xl border border-line p-4 print:border-black">
                <h3 className="text-sm font-extrabold text-text print:text-black">{ac.payment}</h3>
                <p className="mt-3 text-sm text-muted print:text-black">{ac.order}: {receipt.order.order_number}</p>
                <p className="mt-1 text-sm text-muted print:text-black">{ac.status}: {receipt.order.status}</p>
                <p className="mt-1 text-sm text-muted print:text-black">{ac.method}: {receipt.order.payment_method}</p>
                <p className="mt-1 text-sm text-muted print:text-black">{ac.reference}: {receipt.order.payment_reference ?? "-"}</p>
              </section>
            </div>

            <div className="mt-8 overflow-hidden rounded-2xl border border-line print:border-black">
              <table className="w-full text-start text-sm">
                <thead className="bg-panel/60 print:bg-white">
                  <tr className="text-text print:text-black">
                    <th className="p-3">{ac.product}</th>
                    <th className="p-3">{ac.plan}</th>
                    <th className="p-3">{ac.amount}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-line print:border-black">
                    <td className="p-3 text-muted print:text-black">{productName(receipt.order.product_slug)}</td>
                    <td className="p-3 text-muted print:text-black">{receipt.order.plan}</td>
                    <td className="p-3 font-bold text-text print:text-black">{receipt.order.amount} {receipt.order.currency}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <section className="mt-8">
              <h3 className="text-sm font-extrabold text-text print:text-black">{ac.linkedLicenses}</h3>
              {receipt.licenses.length === 0 ? (
                <p className="mt-3 text-sm text-muted print:text-black">{ac.noLinkedLicense}</p>
              ) : (
                <div className="mt-3 flex flex-col gap-3">
                  {receipt.licenses.map((license) => (
                    <div key={license.id} className="rounded-2xl border border-line p-4 print:border-black">
                      <p className="text-sm font-bold text-text print:text-black">{productName(license.product_slug)}</p>
                      <p className="mt-1 break-all font-mono text-xs text-muted print:text-black">{license.license_key}</p>
                      <p className="mt-1 text-xs text-muted print:text-black">{license.plan} · {license.status} · {license.seats} {ac.seats}</p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </article>
        )}
      </section>
    </>
  );
}
