"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useI18n } from "@/components/LanguageProvider";
import { useAuth } from "@/components/AuthProvider";
import { PasswordField } from "@/components/PasswordField";
import { PageHeader } from "@/components/PageHeader";
import { authCopy } from "@/lib/authCopy";
import { accountCopy } from "@/lib/accountCopy";
import { formatDate, formatDateTime } from "@/lib/locale";
import { products } from "@/lib/site";
import type { CustomerLicense, CustomerOrder, CustomerRelease, PaymentCheckoutResult, PaymentTransaction, PurchaseRequest, SessionInfo } from "@/lib/authApi";

const inputCls =
  "w-full rounded-xl border border-line bg-panel/60 px-4 py-3 text-sm text-text placeholder:text-muted focus:border-accent";
const card =
  "rounded-3xl border border-line bg-white/[0.02] p-7 flex flex-col gap-4";

export default function AccountPage() {
  const { lang } = useI18n();
  const c = authCopy[lang] ?? authCopy.en;
  const ac = accountCopy[lang] ?? accountCopy.en;
  const router = useRouter();
  const { user, ready, isAuthenticated, authFetch, logout, refreshUser } =
    useAuth();

  const [fullName, setFullName] = useState("");
  const [organization, setOrganization] = useState("");
  const [country, setCountry] = useState("");
  const [phone, setPhone] = useState("");
  const [savedMsg, setSavedMsg] = useState("");
  const [savedErr, setSavedErr] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [sessionErr, setSessionErr] = useState("");

  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [licenses, setLicenses] = useState<CustomerLicense[]>([]);
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [releases, setReleases] = useState<CustomerRelease[]>([]);
  const [purchaseRequests, setPurchaseRequests] = useState<PurchaseRequest[]>([]);
  const [payments, setPayments] = useState<PaymentTransaction[]>([]);
  const [requestProduct, setRequestProduct] = useState(products[0]?.slug ?? "");
  const [requestPlan, setRequestPlan] = useState("Yearly");
  const [requestAmount, setRequestAmount] = useState("");
  const [requestMethod, setRequestMethod] = useState("");
  const [requestReference, setRequestReference] = useState("");
  const [requestNotes, setRequestNotes] = useState("");
  const [requestMsg, setRequestMsg] = useState("");
  const [submittingRequest, setSubmittingRequest] = useState(false);
  const [checkoutMsg, setCheckoutMsg] = useState("");
  const [checkoutInstructions, setCheckoutInstructions] = useState("");
  const [checkingOutId, setCheckingOutId] = useState<string | null>(null);

  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwMsg, setPwMsg] = useState("");
  const [pwErr, setPwErr] = useState("");
  const [changingPw, setChangingPw] = useState(false);

  useEffect(() => {
    if (!user) return;
    const frame = requestAnimationFrame(() => {
      setFullName(user.profile?.full_name ?? "");
      setOrganization(user.profile?.organization ?? "");
      setCountry(user.profile?.country ?? "");
      setPhone(user.phone ?? "");
    });
    return () => cancelAnimationFrame(frame);
  }, [user]);

  const loadSessions = useCallback(async () => {
    const res = await authFetch<SessionInfo[]>("/account/sessions");
    if (res.ok && res.data) setSessions(res.data);
  }, [authFetch]);

  useEffect(() => {
    if (!ready || !isAuthenticated) return;
    let active = true;
    void (async () => {
      const [sessionRes, licenseRes, orderRes, releaseRes, purchaseRes, paymentRes] = await Promise.all([
        authFetch<SessionInfo[]>("/account/sessions"),
        authFetch<CustomerLicense[]>("/licenses"),
        authFetch<CustomerOrder[]>("/orders"),
        authFetch<CustomerRelease[]>("/downloads/authorized"),
        authFetch<PurchaseRequest[]>("/purchase-requests"),
        authFetch<PaymentTransaction[]>("/payments"),
      ]);
      if (!active) return;
      if (sessionRes.ok && sessionRes.data) setSessions(sessionRes.data);
      if (licenseRes.ok && licenseRes.data) setLicenses(licenseRes.data);
      if (orderRes.ok && orderRes.data) setOrders(orderRes.data);
      if (releaseRes.ok && releaseRes.data) setReleases(releaseRes.data);
      if (purchaseRes.ok && purchaseRes.data) setPurchaseRequests(purchaseRes.data);
      if (paymentRes.ok && paymentRes.data) setPayments(paymentRes.data);
    })();
    return () => {
      active = false;
    };
  }, [ready, isAuthenticated, authFetch]);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSavedMsg("");
    setSavedErr("");
    setSavingProfile(true);
    const res = await authFetch("/account/profile", {
      method: "PATCH",
      body: {
        full_name: fullName || null,
        organization: organization || null,
        country: country || null,
        phone: phone || null,
      },
    });
    setSavingProfile(false);
    if (res.ok) {
      setSavedMsg(c.acSaved);
      await refreshUser();
    } else {
      // authFetch never throws (it returns {ok:false,...} on failure), so
      // this needs an explicit else — without it, a failed save looked
      // identical to a successful one: form just sat there, no message.
      setSavedErr(res.error ?? "Failed to save profile.");
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwMsg("");
    setPwErr("");
    setChangingPw(true);
    const res = await authFetch("/account/change-password", {
      method: "POST",
      body: { current_password: currentPw, new_password: newPw },
    });
    setChangingPw(false);
    if (res.ok) {
      setPwMsg(c.acChanged);
      setCurrentPw("");
      setNewPw("");
      await loadSessions();
    } else {
      setPwErr(res.error ?? "Failed.");
    }
  }

  async function revoke(id: string) {
    setSessionErr("");
    const res = await authFetch(`/account/sessions/${id}`, { method: "DELETE" });
    if (!res.ok) {
      // Same missing-else issue as saveProfile — a failed revoke (session
      // already gone, network error) silently reloaded the same unchanged
      // list with no indication anything went wrong.
      setSessionErr(res.error ?? "Failed to revoke session.");
      return;
    }
    await loadSessions();
  }

  async function submitPurchaseRequest(e: React.FormEvent) {
    e.preventDefault();
    setRequestMsg("");
    setSubmittingRequest(true);
    const res = await authFetch<PurchaseRequest>("/purchase-requests", {
      method: "POST",
      body: {
        product_slug: requestProduct,
        plan: requestPlan,
        amount: requestAmount || null,
        currency: "BDT",
        payment_method: requestMethod || null,
        payment_reference: requestReference || null,
        customer_notes: requestNotes || null,
      },
    });
    setSubmittingRequest(false);
    if (res.ok && res.data) {
      setPurchaseRequests((items) => [res.data as PurchaseRequest, ...items]);
      setRequestMsg(ac.requestSubmitted);
      setRequestAmount("");
      setRequestMethod("");
      setRequestReference("");
      setRequestNotes("");
    } else {
      setRequestMsg(res.error ?? "Failed.");
    }
  }

  async function startCheckout(item: PurchaseRequest) {
    setCheckoutMsg("");
    setCheckoutInstructions("");
    if (!item.amount) {
      setCheckoutMsg(ac.payNeedAmount);
      return;
    }
    setCheckingOutId(item.id);
    const res = await authFetch<PaymentCheckoutResult>("/payments/checkout", {
      method: "POST",
      body: {
        purchase_request_id: item.id,
        amount: item.amount,
        currency: item.currency || "BDT",
        product_name: products.find((p) => p.slug === item.product_slug)?.name ?? item.product_slug,
        method: item.payment_method || "Manual",
      },
    });
    setCheckingOutId(null);
    if (!res.ok || !res.data) {
      setCheckoutMsg(res.error ?? ac.checkoutFailed);
      return;
    }
    setPayments((items) => [res.data!.payment, ...items]);
    if (res.data.checkout_url) {
      window.location.href = res.data.checkout_url;
      return;
    }
    setCheckoutInstructions(res.data.instructions ?? "");
    setCheckoutMsg(ac.checkoutReady);
  }

  async function doLogout() {
    await logout();
    router.replace("/login");
  }

  if (!ready) {
    return (
      <section className="mx-auto max-w-md px-5 py-24 text-center text-muted">
        {c.acLoading}
      </section>
    );
  }

  if (!isAuthenticated) {
    return (
      <section className="mx-auto max-w-md px-5 py-24 text-center">
        <p className="text-text">{c.acNotLogged}</p>
        <Link
          href="/login"
          className="mt-6 inline-block rounded-xl bg-accent px-6 py-3 text-sm font-bold text-bg"
        >
          {c.acGoLogin}
        </Link>
      </section>
    );
  }

  return (
    <>
      <PageHeader eyebrow="Account" title={c.acTitle} subtitle={user?.email} />
      <section className="mx-auto flex max-w-[760px] flex-col gap-8 px-5 py-12">
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 rounded-full border border-line bg-good/5 px-3 py-1.5 text-xs font-bold text-good">
            ✓ {c.acVerified}
          </span>
          <button
            type="button"
            onClick={doLogout}
            className="rounded-xl border border-line px-4 py-2.5 text-sm font-semibold text-text transition-colors hover:border-danger hover:text-danger"
          >
            {c.acLogout}
          </button>
        </div>

        <form onSubmit={saveProfile} className={card}>
          <h2 className="text-lg font-extrabold text-text">{c.acProfile}</h2>
          <input
            className={inputCls}
            placeholder={c.acFullName}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
          <input
            className={inputCls}
            placeholder={c.acOrg}
            value={organization}
            onChange={(e) => setOrganization(e.target.value)}
          />
          <input
            className={inputCls}
            placeholder={c.acCountry}
            value={country}
            onChange={(e) => setCountry(e.target.value)}
          />
          <input
            className={inputCls}
            placeholder={c.acPhone}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          {savedMsg && (
            <p className="text-sm font-semibold text-good">{savedMsg}</p>
          )}
          {savedErr && (
            <p className="text-sm font-semibold text-danger">{savedErr}</p>
          )}
          <button
            type="submit"
            disabled={savingProfile}
            className="self-start rounded-xl bg-accent px-6 py-3 text-sm font-bold text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {savingProfile ? c.acSaving : c.acSave}
          </button>
        </form>

        <form onSubmit={submitPurchaseRequest} className={card}>
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-extrabold text-text">{ac.purchaseRequestTitle}</h2>
            <p className="text-sm text-muted">{ac.purchaseRequestSub}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <select className={inputCls} value={requestProduct} onChange={(e) => setRequestProduct(e.target.value)}>
              {products.map((product) => (
                <option key={product.slug} value={product.slug}>{product.name}</option>
              ))}
            </select>
            <select className={inputCls} value={requestPlan} onChange={(e) => setRequestPlan(e.target.value)}>
              {['Trial', 'Monthly', 'Yearly', 'Lifetime'].map((plan) => (
                <option key={plan} value={plan}>{plan}</option>
              ))}
            </select>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <input className={inputCls} placeholder={ac.amount} value={requestAmount} onChange={(e) => setRequestAmount(e.target.value)} />
            <input className={inputCls} placeholder={ac.payment} value={requestMethod} onChange={(e) => setRequestMethod(e.target.value)} />
            <input className={inputCls} placeholder={ac.reference} value={requestReference} onChange={(e) => setRequestReference(e.target.value)} />
          </div>
          <textarea className={`${inputCls} min-h-24 resize-y`} placeholder={ac.notes} value={requestNotes} onChange={(e) => setRequestNotes(e.target.value)} />
          {requestMsg && <p className="text-sm font-semibold text-good">{requestMsg}</p>}
          {checkoutMsg && <p className="text-sm font-semibold text-accent">{checkoutMsg}</p>}
          {checkoutInstructions && (
            <p className="rounded-2xl border border-line bg-panel/40 p-4 text-sm text-muted whitespace-pre-wrap">
              {checkoutInstructions}
            </p>
          )}
          <button type="submit" disabled={submittingRequest} className="self-start rounded-xl bg-accent px-6 py-3 text-sm font-bold text-bg transition-opacity hover:opacity-90 disabled:opacity-50">
            {submittingRequest ? c.acSaving : ac.submitRequest}
          </button>
          <div className="border-t border-line pt-4">
            <h3 className="text-sm font-extrabold text-text">{ac.myRequests}</h3>
            {purchaseRequests.length === 0 ? (
              <p className="mt-2 text-sm text-muted">{ac.noRequests}</p>
            ) : (
              <div className="mt-3 flex flex-col gap-3">
                {purchaseRequests.map((item) => {
                  const product = products.find((p) => p.slug === item.product_slug);
                  return (
                    <article key={item.id} className="rounded-2xl border border-line bg-panel/30 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-bold text-text">{product?.name ?? item.product_slug}</p>
                          <p className="mt-1 text-xs text-muted">{item.plan} · {formatDate(item.created_at, lang)}</p>
                          {item.amount && (
                            <p className="mt-1 text-xs text-muted">{item.amount} {item.currency}</p>
                          )}
                        </div>
                        <span className="rounded-full bg-accent/10 px-3 py-1 text-xs font-bold text-accent">{item.status}</span>
                      </div>
                      {item.admin_notes && <p className="mt-3 text-xs text-muted">{item.admin_notes}</p>}
                      {item.amount && item.status !== "cancelled" && (
                        <button
                          type="button"
                          disabled={checkingOutId === item.id}
                          onClick={() => void startCheckout(item)}
                          className="mt-3 rounded-xl border border-accent/40 bg-accent/10 px-4 py-2 text-xs font-bold text-accent transition-opacity hover:opacity-90 disabled:opacity-50"
                        >
                          {checkingOutId === item.id ? ac.paying : ac.payNow}
                        </button>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </form>

        <div className={card}>
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-extrabold text-text">{ac.licensesTitle}</h2>
            <p className="text-sm text-muted">
              {ac.licensesSub}
            </p>
          </div>
          {licenses.length === 0 ? (
            <div className="rounded-2xl border border-line bg-panel/30 p-4">
              <p className="text-sm text-muted">
                {ac.noLicenses}
              </p>
              <Link
                href="/pricing"
                className="mt-3 inline-block text-sm font-bold text-accent hover:underline"
              >
                {ac.viewPricing} →
              </Link>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {licenses.map((license) => {
                const product = products.find((p) => p.slug === license.product_slug);
                const active = license.status === "active";
                return (
                  <article
                    key={license.id}
                    className="rounded-2xl border border-line bg-panel/30 p-4"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <h3 className="text-sm font-extrabold text-text">
                          {product?.name ?? license.product_slug}
                        </h3>
                        <p className="mt-1 text-xs text-muted">
                          {license.plan} · {license.active_activation_count}/{license.seats} {ac.activations}
                        </p>
                      </div>
                      <span
                        className={`w-fit rounded-full px-3 py-1 text-xs font-bold ${
                          active ? "bg-good/15 text-good" : "bg-warn/15 text-warn"
                        }`}
                      >
                        {license.status}
                      </span>
                    </div>
                    <dl className="mt-4 grid gap-2 text-xs text-muted sm:grid-cols-2">
                      <div>
                        <dt className="font-bold text-text/80">{ac.licenseKey}</dt>
                        <dd className="mt-1 break-all font-mono">{license.license_key}</dd>
                      </div>
                      <div>
                        <dt className="font-bold text-text/80">{ac.expires}</dt>
                        <dd className="mt-1">
                          {license.expires_at
                            ? formatDate(license.expires_at, lang)
                            : ac.noExpiry}
                        </dd>
                      </div>
                    </dl>
                    {active && license.download_url ? (
                      <a
                        href={license.download_url}
                        className="mt-4 inline-block rounded-xl bg-accent px-5 py-3 text-sm font-bold text-bg transition-opacity hover:opacity-90"
                      >
                        {ac.downloadSoftware}
                      </a>
                    ) : (
                      <p className="mt-4 text-xs font-semibold text-muted">
                        {ac.downloadPending}
                      </p>
                    )}
                  </article>
                );
              })}
            </div>
          )}

          <div className="border-t border-line pt-4">
            <h3 className="text-sm font-extrabold text-text">{ac.availableReleases}</h3>
            {releases.length === 0 ? (
              <p className="mt-3 text-sm text-muted">
                {ac.noReleases}
              </p>
            ) : (
              <div className="mt-3 flex flex-col gap-3">
                {releases.map((release) => {
                  const product = products.find((p) => p.slug === release.product_slug);
                  return (
                    <article key={release.id} className="rounded-2xl border border-line bg-panel/30 p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <h4 className="text-sm font-extrabold text-text">
                            {product?.name ?? release.product_slug}
                          </h4>
                          <p className="mt-1 text-xs text-muted">
                            {release.platform} · v{release.version} · {release.file_name}
                          </p>
                        </div>
                        <span className="w-fit rounded-full bg-good/15 px-3 py-1 text-xs font-bold text-good">
                          {release.access}
                        </span>
                      </div>
                      <dl className="mt-4 grid gap-2 text-xs text-muted sm:grid-cols-2">
                        <div>
                          <dt className="font-bold text-text/80">{ac.size}</dt>
                          <dd className="mt-1">{release.file_size ?? "-"}</dd>
                        </div>
                        <div>
                          <dt className="font-bold text-text/80">{ac.channel}</dt>
                          <dd className="mt-1">{release.channel}</dd>
                        </div>
                        <div className="sm:col-span-2">
                          <dt className="font-bold text-text/80">{ac.checksum}</dt>
                          <dd className="mt-1 break-all font-mono">{release.sha256 ?? ac.pending}</dd>
                        </div>
                      </dl>
                      {release.download_url ? (
                        <a
                          href={release.download_url}
                          className="mt-4 inline-block rounded-xl bg-accent px-5 py-3 text-sm font-bold text-bg transition-opacity hover:opacity-90"
                        >
                          {ac.downloadRelease}
                        </a>
                      ) : (
                        <p className="mt-4 text-xs font-semibold text-muted">
                          {ac.downloadUrlPending}
                        </p>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className={card}>
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-extrabold text-text">{ac.orderHistory}</h2>
            <p className="text-sm text-muted">
              {ac.orderSub}
            </p>
          </div>
          {orders.length === 0 ? (
            <p className="rounded-2xl border border-line bg-panel/30 p-4 text-sm text-muted">
              {ac.noOrders}
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {orders.map((order) => {
                const product = products.find((p) => p.slug === order.product_slug);
                return (
                  <article
                    key={order.id}
                    className="rounded-2xl border border-line bg-panel/30 p-4"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <h3 className="text-sm font-extrabold text-text">
                          {product?.name ?? order.product_slug}
                        </h3>
                        <p className="mt-1 text-xs text-muted">
                          {order.order_number} · {order.plan}
                        </p>
                      </div>
                      <span className="w-fit rounded-full bg-accent/10 px-3 py-1 text-xs font-bold text-accent">
                        {order.status}
                      </span>
                    </div>
                    <dl className="mt-4 grid gap-2 text-xs text-muted sm:grid-cols-2">
                      <div>
                        <dt className="font-bold text-text/80">{ac.amount}</dt>
                        <dd className="mt-1">{order.amount} {order.currency}</dd>
                      </div>
                      <div>
                        <dt className="font-bold text-text/80">{ac.payment}</dt>
                        <dd className="mt-1">{order.payment_method}</dd>
                      </div>
                      <div>
                        <dt className="font-bold text-text/80">{ac.reference}</dt>
                        <dd className="mt-1">{order.payment_reference ?? "-"}</dd>
                      </div>
                      <div>
                        <dt className="font-bold text-text/80">{ac.date}</dt>
                        <dd className="mt-1">
                          {formatDate(order.paid_at ?? order.created_at, lang)}
                        </dd>
                      </div>
                    </dl>
                    <Link
                      href={`/account/orders/${order.id}/receipt`}
                      className="mt-4 inline-block rounded-xl border border-line px-5 py-3 text-sm font-bold text-text transition-colors hover:border-accent hover:text-accent"
                    >
                      {ac.viewReceipt}
                    </Link>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        <div className={card}>
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-extrabold text-text">{ac.paymentsTitle}</h2>
            <p className="text-sm text-muted">{ac.paymentsSub}</p>
          </div>
          {payments.length === 0 ? (
            <p className="rounded-2xl border border-line bg-panel/30 p-4 text-sm text-muted">
              {ac.noPayments}
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {payments.map((payment) => (
                <article key={payment.id} className="rounded-2xl border border-line bg-panel/30 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-extrabold text-text">{payment.amount} {payment.currency}</h3>
                      <p className="mt-1 text-xs text-muted">{payment.provider} · {formatDate(payment.verified_at ?? payment.created_at, lang)}</p>
                    </div>
                    <span className="rounded-full bg-accent/10 px-3 py-1 text-xs font-bold text-accent">{payment.status}</span>
                  </div>
                  <dl className="mt-4 grid gap-2 text-xs text-muted sm:grid-cols-2">
                    <div><dt className="font-bold text-text/80">{ac.provider}</dt><dd className="mt-1">{payment.provider}</dd></div>
                    <div><dt className="font-bold text-text/80">{ac.payment}</dt><dd className="mt-1">{payment.method ?? "-"}</dd></div>
                    <div><dt className="font-bold text-text/80">{ac.reference}</dt><dd className="mt-1 break-all">{payment.reference ?? payment.provider_payment_id ?? "-"}</dd></div>
                    <div><dt className="font-bold text-text/80">{ac.date}</dt><dd className="mt-1">{formatDate(payment.created_at, lang)}</dd></div>
                  </dl>
                </article>
              ))}
            </div>
          )}
        </div>

        <div className={card}>
          <h2 className="text-lg font-extrabold text-text">{c.acSessions}</h2>
          {sessionErr && (
            <p className="text-sm font-semibold text-danger">{sessionErr}</p>
          )}
          <div className="flex flex-col gap-3">
            {sessions.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-line px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-text">
                    {s.user_agent ?? ac.unknownDevice}
                  </p>
                  <p className="text-xs text-muted">
                    {s.ip ?? "-"} ·{" "}
                    {formatDateTime(s.last_seen_at, lang)}
                  </p>
                </div>
                {s.current ? (
                  <span className="shrink-0 rounded-full bg-accent/10 px-3 py-1 text-xs font-bold text-accent">
                    {c.acCurrent}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => revoke(s.id)}
                    className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-muted transition-colors hover:border-danger hover:text-danger"
                  >
                    {c.acRevoke}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <form onSubmit={changePassword} className={card}>
          <h2 className="text-lg font-extrabold text-text">{c.acChangePw}</h2>
          <PasswordField
            value={currentPw}
            onChange={setCurrentPw}
            placeholder={c.acCurrentPw}
            showLabel={c.showPw}
            hideLabel={c.hidePw}
            autoComplete="current-password"
          />
          <PasswordField
            value={newPw}
            onChange={setNewPw}
            placeholder={c.acNewPw}
            showLabel={c.showPw}
            hideLabel={c.hidePw}
            autoComplete="new-password"
          />
          <p className="text-xs text-muted">{c.passwordHint}</p>
          {pwMsg && <p className="text-sm font-semibold text-good">{pwMsg}</p>}
          {pwErr && <p className="text-sm font-semibold text-danger">{pwErr}</p>}
          <button
            type="submit"
            disabled={changingPw}
            className="self-start rounded-xl bg-accent px-6 py-3 text-sm font-bold text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {changingPw ? c.acChanging : c.acChangeBtn}
          </button>
        </form>
      </section>
    </>
  );
}
