import { useEffect, useState } from "react";

/** Surfacing architecture cutover APIs: split, attachment, metal rates, per-km, readiness. */
export function ArchitectureCutoverPanel({
  t,
  apiGet,
  apiPost,
  apiUpload,
  activeFamilyId,
  wallets = [],
  categories = [],
  members = [],
}) {
  const [msg, setMsg] = useState("");
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

  async function loadReadiness() {
    try {
      const [ready, vaultStatus] = await Promise.all([
        apiGet("/system/architecture-readiness"),
        apiGet("/documents/vault-status"),
      ]);
      setReadiness(ready);
      setVault(vaultStatus);
      setMsg(`Architecture ${ready.architecture_feature_completeness_pct}%`);
    } catch (err) {
      setMsg(err.message || "Readiness failed");
    }
  }

  useEffect(() => {
    loadReadiness();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFamilyId]);

  async function loadRates() {
    try {
      const data = await apiGet("/zakat/metal-rates");
      setRates(data);
      setMsg("Metal rates loaded");
    } catch (err) {
      setMsg(err.message || "Failed");
    }
  }

  async function saveRate() {
    try {
      await apiPost(`/zakat/metal-rates?family_id=${encodeURIComponent(activeFamilyId)}`, {
        metal: metalForm.metal,
        rate_bdt: metalForm.rate_bdt,
      });
      setMsg("Rate saved");
      await loadRates();
    } catch (err) {
      setMsg(err.message || "Save failed");
    }
  }

  async function createSplit() {
    try {
      const amount = Number(splitForm.amount || 0);
      const half = (amount / 2).toFixed(4);
      await apiPost("/expenses/split", {
        family_id: activeFamilyId,
        account_id: splitForm.account_id,
        category_id: splitForm.category_id,
        amount,
        currency: "BDT",
        description: splitForm.description,
        splits: [
          { member_id: splitForm.member_a, share_amount: half },
          { member_id: splitForm.member_b, share_amount: (amount - Number(half)).toFixed(4) },
        ],
      });
      setMsg("Split expense created");
    } catch (err) {
      setMsg(err.message || "Split failed");
    }
  }

  async function loadPerKm() {
    try {
      const q = new URLSearchParams({ family_id: activeFamilyId, vehicle_name: vehicleName });
      const data = await apiGet(`/vehicle-expenses/cost-per-km?${q}`);
      setPerKm(data);
    } catch (err) {
      setMsg(err.message || "Per-km failed");
    }
  }

  async function uploadAttachment() {
    if (!txId || !file || !apiUpload) {
      setMsg("Pick transaction + file");
      return;
    }
    try {
      const fd = new FormData();
      fd.append("family_id", activeFamilyId);
      fd.append("file", file);
      await apiUpload(`/transactions/${txId}/attachment`, fd);
      setMsg("Attachment uploaded");
    } catch (err) {
      setMsg(err.message || "Upload failed");
    }
  }

  const expenseCats = (categories || []).filter((c) => String(c.category_type || "").includes("EXPENSE"));
  const pct = readiness?.architecture_feature_completeness_pct ?? null;

  return (
    <section className="panel settings-panel settings-smart finance-smart">
      <div className="settings-head">
        <div>
          <p className="settings-kicker">Architecture</p>
          <h2>{t("cutover") || "Missing cutover tools"}</h2>
        </div>
        <button type="button" className="btn" onClick={loadReadiness}>
          {t("refresh") || "Refresh"}
        </button>
      </div>
      {msg ? <p className="budget-hero-sub">{msg}</p> : null}

      <div className="settings-stack">
        <div className="settings-block">
          <h4>Feature completeness</h4>
          <div className="settings-stat-row">
            <div className="settings-stat">
              <span>Architecture</span>
              <strong>{pct == null ? "…" : `${pct}%`}</strong>
            </div>
            <div className="settings-stat">
              <span>Modules</span>
              <strong>
                {readiness ? `${readiness.done_count}/${readiness.module_count}` : "…"}
              </strong>
            </div>
            <div className="settings-stat">
              <span>Vault</span>
              <strong>{vault?.storage_backend || "…"}</strong>
            </div>
            <div className="settings-stat">
              <span>Status</span>
              <strong>{readiness?.architecture_status || vault?.architecture_status || "…"}</strong>
            </div>
          </div>
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
                        {typeof m.ops_live === "boolean" ? (m.ops_live ? " · ops live" : " · ops env optional") : ""}
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
          <h4>Split expense</h4>
          <div className="finance-form">
            <select value={splitForm.account_id} onChange={(e) => setSplitForm({ ...splitForm, account_id: e.target.value })}>
              <option value="">Wallet</option>
              {wallets.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
            <select value={splitForm.category_id} onChange={(e) => setSplitForm({ ...splitForm, category_id: e.target.value })}>
              <option value="">Category</option>
              {expenseCats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name_en || c.name_bn}
                </option>
              ))}
            </select>
            <input placeholder="Amount" value={splitForm.amount} onChange={(e) => setSplitForm({ ...splitForm, amount: e.target.value })} />
            <select value={splitForm.member_a} onChange={(e) => setSplitForm({ ...splitForm, member_a: e.target.value })}>
              <option value="">Member A</option>
              {members.map((m) => (
                <option key={m.member_id || m.id} value={m.member_id || m.id}>
                  {m.full_name || m.name || m.member_id}
                </option>
              ))}
            </select>
            <select value={splitForm.member_b} onChange={(e) => setSplitForm({ ...splitForm, member_b: e.target.value })}>
              <option value="">Member B</option>
              {members.map((m) => (
                <option key={m.member_id || m.id} value={m.member_id || m.id}>
                  {m.full_name || m.name || m.member_id}
                </option>
              ))}
            </select>
            <button type="button" className="btn btn-primary" onClick={createSplit}>
              Create split
            </button>
          </div>
        </div>

        <div className="settings-block">
          <h4>Zakat metal rates</h4>
          <div className="finance-form">
            <select value={metalForm.metal} onChange={(e) => setMetalForm({ ...metalForm, metal: e.target.value })}>
              <option value="GOLD">GOLD</option>
              <option value="SILVER">SILVER</option>
            </select>
            <input placeholder="Rate BDT / gram" value={metalForm.rate_bdt} onChange={(e) => setMetalForm({ ...metalForm, rate_bdt: e.target.value })} />
            <button type="button" className="btn" onClick={saveRate}>
              Save rate
            </button>
            <button type="button" className="btn" onClick={loadRates}>
              Load rates
            </button>
          </div>
          {rates ? <pre style={{ fontSize: 12, whiteSpace: "pre-wrap" }}>{JSON.stringify(rates, null, 2)}</pre> : null}
        </div>

        <div className="settings-block">
          <h4>Vehicle cost per km</h4>
          <div className="finance-form">
            <input placeholder="Vehicle name" value={vehicleName} onChange={(e) => setVehicleName(e.target.value)} />
            <button type="button" className="btn" onClick={loadPerKm}>
              Analyze
            </button>
          </div>
          {perKm ? <pre style={{ fontSize: 12 }}>{JSON.stringify(perKm, null, 2)}</pre> : null}
        </div>

        <div className="settings-block">
          <h4>Transaction attachment</h4>
          <div className="finance-form">
            <input placeholder="Transaction ID" value={txId} onChange={(e) => setTxId(e.target.value)} />
            <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            <button type="button" className="btn" onClick={uploadAttachment}>
              Upload
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
