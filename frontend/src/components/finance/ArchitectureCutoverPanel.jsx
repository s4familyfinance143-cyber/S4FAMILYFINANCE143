import { useEffect, useMemo, useState } from "react";

/** Architecture cutover tools: readiness, split, metal rates, vehicle km, attachments. */
export function ArchitectureCutoverPanel({
  t,
  money,
  amount,
  apiGet,
  apiPost,
  apiUpload,
  activeFamilyId,
  wallets = [],
  categories = [],
  members = [],
  transactions = [],
  currency = "BDT",
  onMessage,
  onFinanceChanged,
}) {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [readiness, setReadiness] = useState(null);
  const [vault, setVault] = useState(null);
  const [splitForm, setSplitForm] = useState({
    account_id: "",
    category_id: "",
    amount: "",
    description: "",
    member_a: "",
    member_b: "",
  });
  const [metalForm, setMetalForm] = useState({ metal: "GOLD", rate_bdt: "" });
  const [rates, setRates] = useState(null);
  const [vehicleName, setVehicleName] = useState("");
  const [perKm, setPerKm] = useState(null);
  const [txId, setTxId] = useState("");
  const [file, setFile] = useState(null);

  const activeWallets = useMemo(
    () => (wallets || []).filter((w) => !w?.deleted_at && w?.is_active !== false),
    [wallets],
  );
  const expenseCats = useMemo(
    () =>
      (categories || []).filter((c) =>
        String(c.category_type || "").toUpperCase().includes("EXPENSE"),
      ),
    [categories],
  );
  const liveTx = useMemo(
    () =>
      (transactions || [])
        .filter((tx) => String(tx.status || "").toUpperCase() !== "VOID")
        .slice(0, 50),
    [transactions],
  );
  const memberRows = useMemo(
    () =>
      (members || []).filter((m) => {
        const status = String(m.status || "ACTIVE").toUpperCase();
        return status !== "REMOVED" && status !== "LEFT";
      }),
    [members],
  );

  function notify(text, type = "success") {
    setMsg(text);
    if (typeof onMessage === "function") onMessage(text, type);
  }

  async function loadReadiness() {
    if (!apiGet) return;
    setBusy(true);
    try {
      const [ready, vaultStatus] = await Promise.all([
        apiGet("/system/architecture-readiness"),
        apiGet("/documents/vault-status"),
      ]);
      setReadiness(ready);
      setVault(vaultStatus);
      notify(
        `${t("architecture") || "Architecture"} ${ready?.architecture_feature_completeness_pct ?? 0}%`,
        "success",
      );
    } catch (err) {
      notify(err.message || t("architectureLoadFailed") || "Readiness failed", "error");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    loadReadiness();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFamilyId]);

  useEffect(() => {
    setSplitForm((prev) => ({
      ...prev,
      account_id: prev.account_id || activeWallets[0]?.id || "",
      category_id: prev.category_id || expenseCats[0]?.id || "",
      member_a: prev.member_a || memberRows[0]?.member_id || memberRows[0]?.id || "",
      member_b:
        prev.member_b ||
        memberRows[1]?.member_id ||
        memberRows[1]?.id ||
        memberRows[0]?.member_id ||
        memberRows[0]?.id ||
        "",
    }));
  }, [activeWallets, expenseCats, memberRows]);

  useEffect(() => {
    if (!txId && liveTx[0]?.id) setTxId(String(liveTx[0].id));
  }, [liveTx, txId]);

  async function loadRates() {
    setBusy(true);
    try {
      const data = await apiGet("/zakat/metal-rates");
      setRates(data);
      notify(t("metalRatesLoaded") || "Metal rates loaded", "success");
    } catch (err) {
      notify(err.message || t("metalRatesLoadFailed") || "Failed", "error");
    } finally {
      setBusy(false);
    }
  }

  async function saveRate() {
    const rate = Number(metalForm.rate_bdt);
    if (!rate || rate <= 0) {
      notify(t("validRateRequired") || "Valid rate required", "error");
      return;
    }
    setBusy(true);
    try {
      await apiPost(`/zakat/metal-rates?family_id=${encodeURIComponent(activeFamilyId)}`, {
        metal: metalForm.metal,
        rate_bdt: rate,
      });
      notify(t("metalRateSaved") || "Rate saved", "success");
      await loadRates();
    } catch (err) {
      notify(err.message || t("metalRateSaveFailed") || "Save failed", "error");
    } finally {
      setBusy(false);
    }
  }

  async function createSplit() {
    if (!splitForm.account_id) {
      notify(t("walletRequired") || "Wallet required", "error");
      return;
    }
    if (!splitForm.category_id) {
      notify(t("expenseCategoryRequired") || "Category required", "error");
      return;
    }
    const amountNum = Number(splitForm.amount || 0);
    if (!amountNum || amountNum <= 0) {
      notify(t("validAmountRequired") || "Valid amount required", "error");
      return;
    }
    if (!splitForm.member_a || !splitForm.member_b) {
      notify(t("splitMembersRequired") || "Select both members", "error");
      return;
    }
    if (String(splitForm.member_a) === String(splitForm.member_b)) {
      notify(t("splitMembersDifferent") || "Split members must be different", "error");
      return;
    }
    setBusy(true);
    try {
      const half = (amountNum / 2).toFixed(4);
      await apiPost("/expenses/split", {
        family_id: activeFamilyId,
        account_id: splitForm.account_id,
        category_id: splitForm.category_id,
        amount: amountNum,
        currency: currency || "BDT",
        description: splitForm.description || t("splitExpense") || "Split expense",
        splits: [
          { member_id: splitForm.member_a, share_amount: half },
          { member_id: splitForm.member_b, share_amount: (amountNum - Number(half)).toFixed(4) },
        ],
      });
      setSplitForm((prev) => ({ ...prev, amount: "", description: "" }));
      notify(t("splitExpenseCreated") || "Split expense created", "success");
      if (typeof onFinanceChanged === "function") await onFinanceChanged();
    } catch (err) {
      notify(err.message || t("splitExpenseFailed") || "Split failed", "error");
    } finally {
      setBusy(false);
    }
  }

  async function loadPerKm() {
    setBusy(true);
    try {
      const q = new URLSearchParams({
        family_id: activeFamilyId,
        vehicle_name: vehicleName.trim(),
      });
      const data = await apiGet(`/vehicle-expenses/cost-per-km?${q}`);
      setPerKm(data);
      notify(t("vehicleCostLoaded") || "Vehicle cost analyzed", "success");
    } catch (err) {
      notify(err.message || t("vehicleCostFailed") || "Per-km failed", "error");
    } finally {
      setBusy(false);
    }
  }

  async function uploadAttachment() {
    if (!txId) {
      notify(t("transactionRequired") || "Transaction required", "error");
      return;
    }
    if (!file || !apiUpload) {
      notify(t("fileRequired") || "Pick a file", "error");
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("family_id", activeFamilyId);
      fd.append("file", file);
      await apiUpload(`/transactions/${txId}/attachment`, fd);
      setFile(null);
      notify(t("attachmentUploaded") || "Attachment uploaded", "success");
    } catch (err) {
      notify(err.message || t("attachmentUploadFailed") || "Upload failed", "error");
    } finally {
      setBusy(false);
    }
  }

  function txLabel(tx) {
    const type = String(tx.transaction_type || tx.type || "TX").slice(0, 12);
    const amt = typeof amount === "function" ? amount(tx.amount) : tx.amount;
    const desc = String(tx.description || "").slice(0, 28);
    return `${type} · ${amt}${desc ? ` · ${desc}` : ""}`;
  }

  const pct = readiness?.architecture_feature_completeness_pct ?? null;
  const rateList = Array.isArray(rates?.rates)
    ? rates.rates
    : rates && typeof rates === "object"
      ? Object.keys(rates)
          .filter((k) => ["GOLD", "SILVER"].includes(String(k).toUpperCase()))
          .map((k) => ({ metal: k, rate_bdt: rates[k] }))
      : [];

  return (
    <section className="panel settings-panel settings-smart finance-smart">
      <div className="settings-head">
        <div>
          <p className="settings-kicker">{t("architecture")}</p>
          <h2>{t("cutover")}</h2>
        </div>
        <button type="button" className="btn" onClick={loadReadiness} disabled={busy}>
          {t("refresh")}
        </button>
      </div>
      {msg ? <p className="budget-hero-sub">{msg}</p> : null}

      <div className="summary-metric-grid" role="group" aria-label={t("architecture")}>
        <div className="summary-metric-card">
          <span className="summary-metric-label">{t("architecture")}</span>
          <strong className="summary-metric-value">{pct == null ? "…" : `${pct}%`}</strong>
        </div>
        <div className="summary-metric-card">
          <span className="summary-metric-label">{t("modules")}</span>
          <strong className="summary-metric-value">
            {readiness ? `${readiness.done_count}/${readiness.module_count}` : "…"}
          </strong>
        </div>
        <div className="summary-metric-card">
          <span className="summary-metric-label">{t("vault")}</span>
          <strong className="summary-metric-value">{vault?.storage_backend || "…"}</strong>
        </div>
        <div className="summary-metric-card">
          <span className="summary-metric-label">{t("status")}</span>
          <strong className="summary-metric-value">
            {readiness?.architecture_status || vault?.architecture_status || "…"}
          </strong>
        </div>
      </div>

      <div className="settings-stack">
        <div className="settings-block">
          <h4>{t("featureCompleteness")}</h4>
          {readiness?.ops?.note ? <p className="budget-hero-sub">{readiness.ops.note}</p> : null}
          {vault?.note ? <p className="budget-hero-sub">{vault.note}</p> : null}
          {readiness?.modules?.length ? (
            <div className="finance-feed" style={{ marginTop: 12, maxHeight: 280, overflow: "auto" }}>
              {readiness.modules.map((m) => (
                <div className="finance-card tx-card is-savings" key={m.key}>
                  <div className="tx-row">
                    <div className="tx-row-copy">
                      <strong>{m.name}</strong>
                      <span className="tx-row-sub">
                        {m.status}
                        {typeof m.ops_live === "boolean"
                          ? m.ops_live
                            ? ` · ${t("opsLive")}`
                            : ` · ${t("opsOptional")}`
                          : ""}
                      </span>
                    </div>
                    <div className="tx-row-amount">
                      <strong>{m.pct}%</strong>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="settings-block">
          <h4>{t("splitExpense")}</h4>
          <div className="finance-form">
            <select
              value={splitForm.account_id}
              onChange={(e) => setSplitForm({ ...splitForm, account_id: e.target.value })}
            >
              <option value="">{t("selectWallet")}</option>
              {activeWallets.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
            <select
              value={splitForm.category_id}
              onChange={(e) => setSplitForm({ ...splitForm, category_id: e.target.value })}
            >
              <option value="">{t("selectCategory")}</option>
              {expenseCats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name_en || c.name_bn || c.name}
                </option>
              ))}
            </select>
            <input
              placeholder={t("amount")}
              value={splitForm.amount}
              onChange={(e) => setSplitForm({ ...splitForm, amount: e.target.value })}
            />
            <input
              placeholder={t("description")}
              value={splitForm.description}
              onChange={(e) => setSplitForm({ ...splitForm, description: e.target.value })}
            />
            <select
              value={splitForm.member_a}
              onChange={(e) => setSplitForm({ ...splitForm, member_a: e.target.value })}
            >
              <option value="">{t("memberA")}</option>
              {memberRows.map((m) => (
                <option key={m.member_id || m.id} value={m.member_id || m.id}>
                  {m.full_name || m.name || m.member_id || m.id}
                </option>
              ))}
            </select>
            <select
              value={splitForm.member_b}
              onChange={(e) => setSplitForm({ ...splitForm, member_b: e.target.value })}
            >
              <option value="">{t("memberB")}</option>
              {memberRows.map((m) => (
                <option key={m.member_id || m.id} value={m.member_id || m.id}>
                  {m.full_name || m.name || m.member_id || m.id}
                </option>
              ))}
            </select>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={createSplit}>
              {t("createSplit")}
            </button>
          </div>
          {memberRows.length < 2 ? (
            <p className="settings-empty">{t("needTwoMembersForSplit")}</p>
          ) : null}
        </div>

        <div className="settings-block">
          <h4>{t("zakatMetalRates")}</h4>
          <div className="finance-form">
            <select
              value={metalForm.metal}
              onChange={(e) => setMetalForm({ ...metalForm, metal: e.target.value })}
            >
              <option value="GOLD">{t("metalGold")}</option>
              <option value="SILVER">{t("metalSilver")}</option>
            </select>
            <input
              placeholder={t("rateBdtPerGram")}
              value={metalForm.rate_bdt}
              onChange={(e) => setMetalForm({ ...metalForm, rate_bdt: e.target.value })}
            />
            <button type="button" className="btn btn-primary" disabled={busy} onClick={saveRate}>
              {t("saveRate")}
            </button>
            <button type="button" className="btn" disabled={busy} onClick={loadRates}>
              {t("loadRates")}
            </button>
          </div>
          {rateList.length ? (
            <div className="finance-feed" style={{ marginTop: 12 }}>
              {rateList.map((r) => (
                <div className="finance-card" key={r.metal}>
                  <strong>{r.metal}</strong>
                  <span className="tx-row-sub">
                    {typeof money === "function"
                      ? money(r.rate_bdt, currency)
                      : `${r.rate_bdt} ${currency}`}{" "}
                    / {t("gram") || "g"}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="settings-block">
          <h4>{t("vehicleCostPerKm")}</h4>
          <div className="finance-form">
            <input
              placeholder={t("vehicleName")}
              value={vehicleName}
              onChange={(e) => setVehicleName(e.target.value)}
            />
            <button type="button" className="btn" disabled={busy} onClick={loadPerKm}>
              {t("analyze")}
            </button>
          </div>
          {perKm ? (
            <div className="budget-amount-row" style={{ marginTop: 12 }}>
              <div className="budget-amount-cell">
                <span>{t("expenseCount")}</span>
                <strong>{perKm.expense_count ?? 0}</strong>
              </div>
              <div className="budget-amount-cell">
                <span>{t("totalCost")}</span>
                <strong>
                  {typeof money === "function" ? money(perKm.total_cost, currency) : perKm.total_cost}
                </strong>
              </div>
              <div className="budget-amount-cell">
                <span>{t("totalKm")}</span>
                <strong>{perKm.total_km ?? 0}</strong>
              </div>
              <div className="budget-amount-cell">
                <span>{t("costPerKm")}</span>
                <strong>
                  {perKm.cost_per_km == null
                    ? "—"
                    : typeof money === "function"
                      ? money(perKm.cost_per_km, currency)
                      : perKm.cost_per_km}
                </strong>
              </div>
            </div>
          ) : null}
        </div>

        <div className="settings-block">
          <h4>{t("transactionAttachment")}</h4>
          <div className="finance-form">
            <select value={txId} onChange={(e) => setTxId(e.target.value)}>
              <option value="">{t("selectTransaction")}</option>
              {liveTx.map((tx) => (
                <option key={tx.id} value={tx.id}>
                  {txLabel(tx)}
                </option>
              ))}
            </select>
            <input
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              aria-label={t("chooseFile")}
            />
            <button type="button" className="btn btn-primary" disabled={busy} onClick={uploadAttachment}>
              {t("upload")}
            </button>
          </div>
          {liveTx.length === 0 ? (
            <p className="settings-empty">{t("noTransactionsForAttachment")}</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
