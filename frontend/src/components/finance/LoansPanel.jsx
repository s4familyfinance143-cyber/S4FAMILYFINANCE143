import { useEffect, useState } from "react";
import { MoneyPill, TypeChip } from "../ui/FinanceChips";

const TABS = ["manage", "create", "payment"];

export function LoansPanel({
  t,
  money,
  amount,
  loans = [],
  filteredLoans = [],
  wallets = [],
  loanForm,
  setLoanForm,
  loanPaymentForm,
  setLoanPaymentForm,
  loanSearch,
  setLoanSearch,
  loanStatusFilter,
  setLoanStatusFilter,
  loanTypeFilter,
  setLoanTypeFilter,
  onCreate,
  onPostPayment,
  onRefresh,
  onEdit,
  onHistory,
  onClose,
  onClearFilters,
}) {
  const [tab, setTab] = useState("manage");
  const active = loans.filter((loan) => String(loan.status || "").toUpperCase() === "ACTIVE");
  const given = active.filter((loan) => String(loan.loan_type || "").toUpperCase() === "GIVEN").length;
  const taken = active.filter((loan) => String(loan.loan_type || "").toUpperCase() === "TAKEN").length;
  const remainingTotal = active.reduce((sum, loan) => sum + Number(loan.remaining_amount || 0), 0);
  const activeWallets = (wallets || []).filter((w) => !w?.deleted_at && w?.is_active !== false);

  useEffect(() => {
    if (!loanForm?.wallet_account_id && activeWallets[0]?.id) {
      setLoanForm((prev) => ({ ...prev, wallet_account_id: activeWallets[0].id }));
    }
  }, [activeWallets, loanForm?.wallet_account_id, setLoanForm]);

  useEffect(() => {
    if (!loanPaymentForm?.wallet_account_id && activeWallets[0]?.id) {
      setLoanPaymentForm((prev) => ({ ...prev, wallet_account_id: activeWallets[0].id }));
    }
  }, [activeWallets, loanPaymentForm?.wallet_account_id, setLoanPaymentForm]);

  useEffect(() => {
    if (!loanPaymentForm?.loan_id && active[0]?.id) {
      setLoanPaymentForm((prev) => ({ ...prev, loan_id: active[0].id }));
    }
  }, [active, loanPaymentForm?.loan_id, setLoanPaymentForm]);

  async function handleCreate() {
    const ok = await onCreate?.();
    if (ok) setTab("manage");
  }

  function tabLabel(key) {
    if (key === "manage") return t("loans");
    if (key === "create") return t("createLoan");
    return t("loanPayment");
  }

  return (
    <section className="panel settings-panel settings-smart finance-smart">
      <div className="settings-head">
        <div>
          <p className="settings-kicker">{t("loans")}</p>
          <h2>{t("loans")}</h2>
        </div>
        <button type="button" className="btn" onClick={onRefresh}>
          {t("refreshLoans")}
        </button>
      </div>

      <div className="settings-tabs" role="tablist">
        {TABS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? "settings-tab active" : "settings-tab"}
            onClick={() => setTab(key)}
          >
            {tabLabel(key)}
          </button>
        ))}
      </div>

      <div className="summary-metric-grid" role="group" aria-label={t("loans")}>
        <div className="summary-metric-card">
          <span className="summary-metric-label">{t("loans")}</span>
          <strong className="summary-metric-value">{loans.length}</strong>
        </div>
        <div className="summary-metric-card">
          <span className="summary-metric-label">{t("remaining")}</span>
          <strong className="summary-metric-value">{money(remainingTotal)}</strong>
        </div>
        <div className="summary-metric-card">
          <span className="summary-metric-label">{t("given")}</span>
          <strong className="summary-metric-value">{given}</strong>
        </div>
        <div className="summary-metric-card">
          <span className="summary-metric-label">{t("taken")}</span>
          <strong className="summary-metric-value">{taken}</strong>
        </div>
      </div>

      {tab === "manage" ? (
        <div className="settings-stack">
          <div className="settings-block">
            <h4>{t("loanSearchFilter")}</h4>
            <div className="finance-form">
              <input
                placeholder={t("searchPersonNote")}
                value={loanSearch}
                onChange={(e) => setLoanSearch(e.target.value)}
              />
              <select value={loanStatusFilter} onChange={(e) => setLoanStatusFilter(e.target.value)}>
                <option value="ALL">{t("allStatus")}</option>
                <option value="ACTIVE">{t("activeStatus")}</option>
                <option value="CLOSED">{t("closedStatus")}</option>
              </select>
              <select value={loanTypeFilter} onChange={(e) => setLoanTypeFilter(e.target.value)}>
                <option value="ALL">{t("allType")}</option>
                <option value="GIVEN">{t("given")}</option>
                <option value="TAKEN">{t("taken")}</option>
              </select>
              <button type="button" className="btn" onClick={onClearFilters}>
                {t("clearFilter")}
              </button>
            </div>
          </div>

          <div className="settings-block">
            <h4>{t("loans")}</h4>
            {filteredLoans.length === 0 ? (
              <p className="settings-empty">{t("noLoansYet")}</p>
            ) : (
              <div className="finance-feed">
                {filteredLoans.map((loan) => (
                  <div className="finance-card finance-card-stack budget-card is-loan" key={loan.id}>
                    <div className="tx-row budget-row-head">
                      <div className="tx-row-type budget-chip-col">
                        <TypeChip type={loan.status === "ACTIVE" ? "SAVINGS" : "PENDING"}>
                          {loan.status}
                        </TypeChip>
                        <TypeChip type={loan.loan_type}>{loan.loan_type}</TypeChip>
                      </div>
                      <div className="tx-row-copy">
                        <strong title={loan.person_name}>{loan.person_name}</strong>
                        <span className="tx-row-sub">{loan.note || t("noNote")}</span>
                      </div>
                      <div className="tx-row-amount">
                        <MoneyPill tone="loan">{money(loan.remaining_amount, loan.currency)}</MoneyPill>
                      </div>
                    </div>

                    <div className="budget-amount-row">
                      <div className="budget-amount-cell">
                        <span>{t("loanAmount")}</span>
                        <MoneyPill>{money(loan.principal_amount, loan.currency)}</MoneyPill>
                      </div>
                      <div className="budget-amount-cell">
                        <span>{t("paidAmount")}</span>
                        <MoneyPill tone="income">{money(loan.paid_amount, loan.currency)}</MoneyPill>
                      </div>
                      <div className="budget-amount-cell">
                        <span>{t("remaining")}</span>
                        <MoneyPill tone="loan">{money(loan.remaining_amount, loan.currency)}</MoneyPill>
                      </div>
                    </div>

                    <div className="finance-actions">
                      <button type="button" className="btn" onClick={() => onEdit(loan)}>
                        {t("edit")}
                      </button>
                      <button type="button" className="btn" onClick={() => onHistory(loan)}>
                        {t("history")}
                      </button>
                      {String(loan.status || "").toUpperCase() === "ACTIVE" ? (
                        <button type="button" className="btn" onClick={() => onClose(loan)}>
                          {t("close")}
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {tab === "create" ? (
        <div className="settings-stack">
          <div className="settings-block">
            <h4>{t("createLoan")}</h4>
            <div className="finance-form">
              <select
                value={loanForm.loan_type}
                onChange={(e) => setLoanForm({ ...loanForm, loan_type: e.target.value })}
              >
                <option value="GIVEN">{t("given")}</option>
                <option value="TAKEN">{t("taken")}</option>
              </select>
              <select
                value={loanForm.wallet_account_id}
                onChange={(e) => setLoanForm({ ...loanForm, wallet_account_id: e.target.value })}
              >
                <option value="">{t("selectWallet")}</option>
                {activeWallets.map((wallet) => (
                  <option key={wallet.id} value={wallet.id}>
                    {wallet.name}
                  </option>
                ))}
              </select>
              <input
                placeholder={t("personName")}
                value={loanForm.person_name}
                onChange={(e) => setLoanForm({ ...loanForm, person_name: e.target.value })}
              />
              <input
                placeholder={t("loanAmount")}
                value={loanForm.principal_amount}
                onChange={(e) => setLoanForm({ ...loanForm, principal_amount: e.target.value })}
              />
              <input
                placeholder={t("interestRatePercent")}
                value={loanForm.interest_rate || "0"}
                onChange={(e) => setLoanForm({ ...loanForm, interest_rate: e.target.value })}
              />
              <select
                value={loanForm.interest_type || "NONE"}
                onChange={(e) => setLoanForm({ ...loanForm, interest_type: e.target.value })}
              >
                <option value="NONE">{t("noInterest")}</option>
                <option value="FLAT">{t("interestFlat")}</option>
                <option value="REDUCING">{t("interestReducing")}</option>
              </select>
              <input
                placeholder={t("installmentsMonths")}
                value={loanForm.installment_count || ""}
                onChange={(e) => setLoanForm({ ...loanForm, installment_count: e.target.value })}
              />
              <input
                type="date"
                value={loanForm.start_date || ""}
                onChange={(e) => setLoanForm({ ...loanForm, start_date: e.target.value })}
              />
              <input
                placeholder={t("note")}
                value={loanForm.note}
                onChange={(e) => setLoanForm({ ...loanForm, note: e.target.value })}
              />
              <button type="button" className="btn btn-primary" onClick={handleCreate}>
                {t("createLoan")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {tab === "payment" ? (
        <div className="settings-stack">
          <div className="settings-block">
            <h4>{t("loanPayment")}</h4>
            <div className="finance-form">
              <select
                value={loanPaymentForm.loan_id}
                onChange={(e) => setLoanPaymentForm({ ...loanPaymentForm, loan_id: e.target.value })}
              >
                <option value="">{t("loans")}</option>
                {active.map((loan) => (
                  <option key={loan.id} value={loan.id}>
                    {loan.person_name} - {loan.loan_type} - {t("remaining")} {amount(loan.remaining_amount)}
                  </option>
                ))}
              </select>
              <select
                value={loanPaymentForm.wallet_account_id}
                onChange={(e) =>
                  setLoanPaymentForm({ ...loanPaymentForm, wallet_account_id: e.target.value })
                }
              >
                <option value="">{t("selectWallet")}</option>
                {activeWallets.map((wallet) => (
                  <option key={wallet.id} value={wallet.id}>
                    {wallet.name}
                  </option>
                ))}
              </select>
              <input
                placeholder={t("paymentAmount")}
                value={loanPaymentForm.amount}
                onChange={(e) => setLoanPaymentForm({ ...loanPaymentForm, amount: e.target.value })}
              />
              <input
                placeholder={t("description")}
                value={loanPaymentForm.description}
                onChange={(e) => setLoanPaymentForm({ ...loanPaymentForm, description: e.target.value })}
              />
              <button type="button" className="btn btn-primary" onClick={onPostPayment}>
                {t("postPayment")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
