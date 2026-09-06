import { useEffect, useMemo, useState } from "react";
import { MoneyPill, TypeChip, typeTone } from "../ui/FinanceChips";

function txTypeOf(tx) {
  return String(tx?.transaction_type || tx?.type || "TX").toUpperCase();
}

function isVoided(tx) {
  return String(tx?.status || "").toUpperCase() === "VOID";
}

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
  onGoWallets,
  cloudLocalMode = false,
}) {
  const [ocrText, setOcrText] = useState("");
  const [ocrResult, setOcrResult] = useState(null);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [attachFile, setAttachFile] = useState(null);
  const [postBusy, setPostBusy] = useState(false);

  const activeWallets = useMemo(
    () => (wallets || []).filter((w) => !w?.deleted_at && w?.is_active !== false),
    [wallets],
  );

  const liveTx = useMemo(() => (transactions || []).filter((tx) => !isVoided(tx)), [transactions]);

  const incomeTotal = liveTx
    .filter((tx) => txTypeOf(tx).includes("INCOME"))
    .reduce((s, tx) => s + Number(tx.amount || 0), 0);
  const expenseTotal = liveTx
    .filter((tx) => txTypeOf(tx).includes("EXPENSE"))
    .reduce((s, tx) => s + Number(tx.amount || 0), 0);
  const transferCount = liveTx.filter((tx) => txTypeOf(tx).includes("TRANSFER")).length;

  const filteredCategories = useMemo(() => {
    const want = String(txForm.type || "income").toUpperCase();
    return (categories || []).filter((c) => {
      const ct = String(c.category_type || "").toUpperCase();
      if (want === "TRANSFER") return true;
      return ct.includes(want);
    });
  }, [categories, txForm.type]);

  // Keep category in sync with type; prefer first wallet when empty / invalid
  useEffect(() => {
    const fromOk = activeWallets.some((w) => String(w.id) === String(txForm.account_id));
    if (!fromOk && activeWallets[0]?.id) {
      const fromId = activeWallets[0].id;
      const toId =
        activeWallets.find((w) => String(w.id) !== String(fromId))?.id || "";
      setTxForm((prev) => ({
        ...prev,
        account_id: fromId,
        to_account_id: prev.to_account_id && String(prev.to_account_id) !== String(fromId)
          ? prev.to_account_id
          : toId,
      }));
    }
  }, [activeWallets, txForm.account_id, setTxForm]);

  useEffect(() => {
    if (String(txForm.type || "").toLowerCase() === "transfer") return;
    const match = filteredCategories[0];
    if (!match) return;
    const stillValid = filteredCategories.some((c) => String(c.id) === String(txForm.category_id));
    if (!stillValid) {
      setTxForm((prev) => ({ ...prev, category_id: match.id }));
    }
  }, [txForm.type, txForm.category_id, filteredCategories, setTxForm]);

  const isExpense = txForm.type === "expense";
  const isSplit = Boolean(txForm.split_enabled) && isExpense;

  async function runOcr() {
    if (!onParseExpenseOcr) return;
    setOcrBusy(true);
    try {
      const data = await onParseExpenseOcr(ocrText);
      setOcrResult(data);
      if (data?.suggested_total) {
        setTxForm((prev) => ({
          ...prev,
          amount: String(data.suggested_total).replace(/\.0+$/, "") || String(data.suggested_total),
          description: prev.description || data?.lines?.[0]?.description || "",
        }));
      }
    } finally {
      setOcrBusy(false);
    }
  }

  async function handlePost() {
    if (postBusy) return;
    setPostBusy(true);
    try {
      await onCreate?.(attachFile);
      setAttachFile(null);
    } finally {
      setPostBusy(false);
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
          <strong>{money(incomeTotal)}</strong>
        </div>
        <div className="settings-stat">
          <span>{t("expense")}</span>
          <strong>{money(expenseTotal)}</strong>
        </div>
        <div className="settings-stat">
          <span>{t("transfer")}</span>
          <strong>{transferCount}</strong>
        </div>
        <div className="settings-stat">
          <span>{t("transactions")}</span>
          <strong>{liveTx.length}</strong>
        </div>
      </div>

      {activeWallets.length === 0 ? (
        <div className="settings-block">
          <p className="settings-empty">{t("createWalletFirst") || "Create a wallet first to post transactions."}</p>
          {onGoWallets ? (
            <button type="button" className="btn btn-primary" onClick={onGoWallets}>
              {t("wallets")}
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="settings-stack">
        <div className="settings-block">
          <h4>{t("postTransaction")}</h4>
          <div className="finance-form">
            <select
              value={txForm.type || "income"}
              onChange={(e) =>
                setTxForm({ ...txForm, type: e.target.value, split_enabled: false, category_id: "" })
              }
              aria-label={t("transactions")}
            >
              <option value="income">{t("income")}</option>
              <option value="expense">{t("expense")}</option>
              <option value="transfer">{t("transfer")}</option>
            </select>

            <select
              value={txForm.account_id || ""}
              onChange={(e) => setTxForm({ ...txForm, account_id: e.target.value })}
              aria-label={t("selectWallet")}
            >
              <option value="">{t("selectWallet")}</option>
              {activeWallets.map((wallet) => (
                <option key={wallet.id} value={wallet.id}>
                  {wallet.name} ({money(wallet.current_balance ?? wallet.balance, wallet.currency)})
                </option>
              ))}
            </select>

            {txForm.type === "transfer" ? (
              <select
                value={txForm.to_account_id || ""}
                onChange={(e) => setTxForm({ ...txForm, to_account_id: e.target.value })}
                aria-label={t("toWallet")}
              >
                <option value="">{t("toWallet")}</option>
                {activeWallets.map((wallet) => (
                  <option key={wallet.id} value={wallet.id}>
                    {wallet.name} ({money(wallet.current_balance ?? wallet.balance, wallet.currency)})
                  </option>
                ))}
              </select>
            ) : (
              <select
                value={txForm.category_id || ""}
                onChange={(e) => setTxForm({ ...txForm, category_id: e.target.value })}
                aria-label={t("selectCategory")}
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
              value={txForm.amount || ""}
              onChange={(e) => setTxForm({ ...txForm, amount: e.target.value })}
              inputMode="decimal"
              aria-label={t("amount")}
            />
            <input
              placeholder={t("description")}
              value={txForm.description || ""}
              onChange={(e) => setTxForm({ ...txForm, description: e.target.value })}
              aria-label={t("description")}
            />

            {(txForm.type === "income" || txForm.type === "expense") && (
              <input
                type="file"
                accept="image/*,.pdf,.png,.jpg,.jpeg,.webp"
                onChange={(e) => setAttachFile(e.target.files?.[0] || null)}
              />
            )}
            {attachFile ? (
              <p className="budget-hero-sub">
                {t("fileSelected") || "File"}: {attachFile.name}
              </p>
            ) : null}

            {isExpense ? (
              <label className="settings-check wallet-flag-row">
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
                <span>{t("splitExpense") || "Split expense (2 members)"}</span>
              </label>
            ) : null}

            {isSplit ? (
              <>
                <select
                  value={txForm.split_member_a || ""}
                  onChange={(e) => setTxForm({ ...txForm, split_member_a: e.target.value })}
                >
                  <option value="">{t("memberA") || "Member A"}</option>
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
                  <option value="">{t("memberB") || "Member B"}</option>
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
              disabled={postBusy || activeWallets.length === 0}
              onClick={handlePost}
            >
              {postBusy ? t("loading") : t("postTransaction")}
            </button>
          </div>
        </div>

        {isExpense && onParseExpenseOcr ? (
          <div className="settings-block">
            <h4>{t("billScanOcr") || "Bill scan OCR"}</h4>
            <div className="finance-form">
              <textarea
                rows={4}
                placeholder={t("pasteBillText") || "Paste bill text lines (item + price)"}
                value={ocrText}
                onChange={(e) => setOcrText(e.target.value)}
              />
              {!cloudLocalMode && onParseExpenseOcrImage ? (
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
                        amount:
                          String(data.suggested_total).replace(/\.0+$/, "") ||
                          String(data.suggested_total),
                        description: prev.description || data?.lines?.[0]?.description || "",
                      }));
                    }
                  } finally {
                    setOcrBusy(false);
                    e.target.value = "";
                  }
                }}
              />
              ) : cloudLocalMode ? (
                <p className="settings-empty" style={{ margin: 0 }}>
                  {t("ocrPasteOnlyHint") || "Cloud mode: on-device image OCR (or paste bill text)."}
                </p>
              ) : null}
              <button
                type="button"
                className="btn"
                disabled={ocrBusy || !ocrText.trim()}
                onClick={runOcr}
              >
                {ocrBusy ? t("scanning") || "Scanning�" : t("parseBillFillAmount") || "Parse bill ? fill amount"}
              </button>
            </div>
            {ocrResult ? (
              <p className="budget-hero-sub">
                {t("suggestedTotal") || "Suggested total"}: {ocrResult.suggested_total ?? "�"} �{" "}
                {t("lines") || "lines"}: {ocrResult.line_count} � {ocrResult.engine}
                {ocrResult.note ? ` � ${ocrResult.note}` : ""}
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
                const type = txTypeOf(tx);
                const tone = isVoided(tx) ? "neutral" : typeTone(type);
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
                          {tx.is_split ? ` � ${t("splitShort") || "SPLIT"}` : ""}
                          {tx.attachment_name ? ` � ${tx.attachment_name}` : ""}
                          {tx.transaction_date ? ` � ${tx.transaction_date}` : ""}
                        </span>
                      </div>
                      <div className="tx-row-amount">
                        <MoneyPill tone={tone} signed={signed}>
                          {money(tx.amount, tx.currency)}
                        </MoneyPill>
                      </div>
                    </div>
                    <div className="wallet-card-actions">
                      {onVoid && status !== "VOID" ? (
                        <button
                          type="button"
                          className="btn"
                          disabled={voidBusyId === txId}
                          onClick={() => onVoid(txId)}
                        >
                          {voidBusyId === txId ? t("loading") : t("voidTransaction") || "Void"}
                        </button>
                      ) : null}
                      {onUploadAttachment && status !== "VOID" ? (
                        <label
                          className="btn"
                          style={{ display: "inline-flex", alignItems: "center", cursor: "pointer" }}
                        >
                          {attachBusyId === txId ? t("uploading") || "Uploading�" : t("attach") || "Attach"}
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
