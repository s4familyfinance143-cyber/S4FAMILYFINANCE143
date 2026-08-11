import { useMemo, useState } from "react";
import { MoneyPill, TypeChip, typeTone } from "../ui/FinanceChips";

export function TransactionsPanel({
  t,
  money,
  transactions = [],
  wallets = [],
  categories = [],
  members = [],
  txForm,
  setTxForm,
  onCreate,
  onRefresh,
  onVoid,
  onUploadAttachment,
  onParseExpenseOcr,
  onParseExpenseOcrImage,
  voidBusyId = "",
  attachBusyId = "",
}) {
  const [ocrText, setOcrText] = useState("");
  const [ocrResult, setOcrResult] = useState(null);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [attachFile, setAttachFile] = useState(null);

  const incomeCount = transactions.filter((tx) =>
    String(tx.transaction_type || "").toUpperCase().includes("INCOME")
  ).length;
  const expenseCount = transactions.filter((tx) =>
    String(tx.transaction_type || "").toUpperCase().includes("EXPENSE")
  ).length;
  const transferCount = transactions.filter((tx) =>
    String(tx.transaction_type || "").toUpperCase().includes("TRANSFER")
  ).length;

  const filteredCategories = useMemo(() => {
    const want = String(txForm.type || "income").toUpperCase();
    return (categories || []).filter((c) => {
      const ct = String(c.category_type || "").toUpperCase();
      if (want === "TRANSFER") return true;
      return ct.includes(want);
    });
  }, [categories, txForm.type]);

  const isExpense = txForm.type === "expense";
  const isSplit = Boolean(txForm.split_enabled) && isExpense;

  async function runOcr() {
    if (!onParseExpenseOcr) return;
    setOcrBusy(true);
    try {
      const data = await onParseExpenseOcr(ocrText);
      setOcrResult(data);
      if (data?.suggested_total) {
        setTxForm({ ...txForm, amount: String(data.suggested_total).replace(/\.0+$/, "") || data.suggested_total });
      }
      if (data?.lines?.[0]?.description && !txForm.description) {
        setTxForm((prev) => ({
          ...prev,
          description: data.lines[0].description,
          amount: prev.amount || String(data.suggested_total || ""),
        }));
      }
    } finally {
      setOcrBusy(false);
    }
  }

  return (
    <section className="panel settings-panel settings-smart finance-smart">
      <div className="settings-head">
        <div>
          <p className="settings-kicker">{t("transactions")}</p>
          <h2>{t("transactions")}</h2>
        </div>
        <button type="button" className="btn" onClick={onRefresh}>
          {t("refresh")}
        </button>
      </div>

      <div className="settings-stat-row">
        <div className="settings-stat">
          <span>{t("income")}</span>
          <strong>{incomeCount}</strong>
        </div>
        <div className="settings-stat">
          <span>{t("expense")}</span>
          <strong>{expenseCount}</strong>
        </div>
        <div className="settings-stat">
          <span>{t("transfer")}</span>
          <strong>{transferCount}</strong>
        </div>
        <div className="settings-stat">
          <span>{t("transactions")}</span>
          <strong>{transactions.length}</strong>
        </div>
      </div>

      <div className="settings-stack">
        <div className="settings-block">
          <h4>{t("postTransaction")}</h4>
          <div className="finance-form">
            <select value={txForm.type} onChange={(e) => setTxForm({ ...txForm, type: e.target.value, split_enabled: false })}>
              <option value="income">{t("income")}</option>
              <option value="expense">{t("expense")}</option>
              <option value="transfer">{t("transfer")}</option>
            </select>

            <select
              value={txForm.account_id}
              onChange={(e) => setTxForm({ ...txForm, account_id: e.target.value })}
            >
              <option value="">{t("selectWallet")}</option>
              {wallets.map((wallet) => (
                <option key={wallet.id} value={wallet.id}>
                  {wallet.name}
                </option>
              ))}
            </select>

            {txForm.type === "transfer" ? (
              <select
                value={txForm.to_account_id}
                onChange={(e) => setTxForm({ ...txForm, to_account_id: e.target.value })}
              >
                <option value="">{t("toWallet")}</option>
                {wallets.map((wallet) => (
                  <option key={wallet.id} value={wallet.id}>
                    {wallet.name}
                  </option>
                ))}
              </select>
            ) : (
              <select
                value={txForm.category_id}
                onChange={(e) => setTxForm({ ...txForm, category_id: e.target.value })}
              >
                <option value="">{t("selectCategory")}</option>
                {filteredCategories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name_en || category.name_bn || category.name}
                  </option>
                ))}
              </select>
            )}

            <input
              placeholder={t("amount")}
              value={txForm.amount}
              onChange={(e) => setTxForm({ ...txForm, amount: e.target.value })}
            />
            <input
              placeholder={t("description")}
              value={txForm.description}
              onChange={(e) => setTxForm({ ...txForm, description: e.target.value })}
            />

            {(txForm.type === "income" || txForm.type === "expense") && (
              <input
                type="file"
                accept="image/*,.pdf,.png,.jpg,.jpeg,.webp"
                onChange={(e) => setAttachFile(e.target.files?.[0] || null)}
              />
            )}

            {isExpense ? (
              <label className="settings-check">
                <input
                  type="checkbox"
                  checked={isSplit}
                  onChange={(e) =>
                    setTxForm({
                      ...txForm,
                      split_enabled: e.target.checked,
                      split_member_a: txForm.split_member_a || "",
                      split_member_b: txForm.split_member_b || "",
                    })
                  }
                />
                Split expense (2 members)
              </label>
            ) : null}

            {isSplit ? (
              <>
                <select
                  value={txForm.split_member_a || ""}
                  onChange={(e) => setTxForm({ ...txForm, split_member_a: e.target.value })}
                >
                  <option value="">Member A</option>
                  {members.map((m) => (
                    <option key={m.member_id || m.id} value={m.member_id || m.id}>
                      {m.full_name || m.name || m.member_id || m.id}
                    </option>
                  ))}
                </select>
                <select
                  value={txForm.split_member_b || ""}
                  onChange={(e) => setTxForm({ ...txForm, split_member_b: e.target.value })}
                >
                  <option value="">Member B</option>
                  {members.map((m) => (
                    <option key={m.member_id || m.id} value={m.member_id || m.id}>
                      {m.full_name || m.name || m.member_id || m.id}
                    </option>
                  ))}
                </select>
              </>
            ) : null}

            <button
              type="button"
              className="btn btn-primary"
              onClick={() => onCreate?.(attachFile)}
            >
              {t("postTransaction")}
            </button>
          </div>
        </div>

        {isExpense && onParseExpenseOcr ? (
          <div className="settings-block">
            <h4>Bill scan OCR</h4>
            <div className="finance-form">
              <textarea
                rows={4}
                placeholder="Paste bill text lines (item price)…"
                value={ocrText}
                onChange={(e) => setOcrText(e.target.value)}
              />
              <input
                type="file"
                accept="image/*,.png,.jpg,.jpeg,.webp"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file || !onParseExpenseOcrImage) return;
                  setOcrBusy(true);
                  try {
                    const data = await onParseExpenseOcrImage(file);
                    setOcrResult(data);
                    if (data?.raw_text) setOcrText(data.raw_text);
                    if (data?.suggested_total) {
                      setTxForm((prev) => ({
                        ...prev,
                        amount: String(data.suggested_total).replace(/\.0+$/, "") || data.suggested_total,
                        description: prev.description || data?.lines?.[0]?.description || "",
                      }));
                    }
                  } finally {
                    setOcrBusy(false);
                    e.target.value = "";
                  }
                }}
              />
              <button type="button" className="btn" disabled={ocrBusy || !ocrText.trim()} onClick={runOcr}>
                {ocrBusy ? "Scanning…" : "Parse bill → fill amount"}
              </button>
            </div>
            {ocrResult ? (
              <p className="budget-hero-sub">
                Suggested total: {ocrResult.suggested_total} · lines: {ocrResult.line_count} · engine:{" "}
                {ocrResult.engine}
                {ocrResult.note ? ` · ${ocrResult.note}` : ""}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="settings-block">
          <h4>{t("transactions")}</h4>
          {transactions.length === 0 ? (
            <p className="settings-empty">{t("noTransactionsFound")}</p>
          ) : (
            <div className="finance-feed">
              {transactions.map((tx) => {
                const type = String(tx.transaction_type || "TX").toUpperCase();
                const tone = typeTone(type);
                const signed = tone === "income" ? "+" : tone === "expense" ? "-" : "";
                const txId = tx.id || tx.transaction_id;
                const status = String(tx.status || "POSTED").toUpperCase();
                return (
                  <div className={`finance-card tx-card is-${tone}`} key={txId}>
                    <div className="tx-row">
                      <div className="tx-row-type">
                        <TypeChip type={type} />
                      </div>
                      <div className="tx-row-copy">
                        <strong title={tx.description || txId || ""}>
                          {tx.description || txId || t("transactions")}
                        </strong>
                        <span className="tx-row-sub">
                          {status}
                          {tx.is_split ? " · SPLIT" : ""}
                          {tx.attachment_name ? ` · 📎 ${tx.attachment_name}` : ""}
                        </span>
                      </div>
                      <div className="tx-row-amount">
                        <MoneyPill tone={tone} signed={signed}>
                          {money(tx.amount, tx.currency)}
                        </MoneyPill>
                      </div>
                    </div>
                    <div className="finance-form" style={{ marginTop: 8 }}>
                      {onVoid && status !== "VOID" ? (
                        <button
                          type="button"
                          className="btn"
                          disabled={voidBusyId === txId}
                          onClick={() => onVoid(txId)}
                        >
                          {t("voidTransaction") || "Void"}
                        </button>
                      ) : null}
                      {onUploadAttachment && status !== "VOID" ? (
                        <label className="btn" style={{ display: "inline-flex", alignItems: "center", cursor: "pointer" }}>
                          {attachBusyId === txId ? "Uploading…" : "Attach"}
                          <input
                            type="file"
                            hidden
                            disabled={attachBusyId === txId}
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) onUploadAttachment(txId, f);
                              e.target.value = "";
                            }}
                          />
                        </label>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
