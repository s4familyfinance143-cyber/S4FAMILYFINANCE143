import { useState } from "react";
import { MoneyPill, TypeChip } from "../ui/FinanceChips";

const TABS = ["manage", "create"];

export function BudgetsPanel({
  t,
  digits,
  money,
  budgets: _budgets = [],
  filteredBudgets = [],
  expenseCategories = [],
  summary,
  alerts = [],
  budgetForm,
  setBudgetForm,
  budgetSearch,
  setBudgetSearch,
  budgetStatusFilter,
  setBudgetStatusFilter,
  onCreate,
  onRefresh,
  onEdit,
  onClose,
  onClearFilters,
}) {
  const [tab, setTab] = useState("manage");
  const overCount = Number(summary?.overBudgetCount || 0);
  const warnCount = Number(summary?.warningCount || 0);

  return (
    <section className="panel settings-panel settings-smart finance-smart">
      <div className="settings-head">
        <div>
          <p className="settings-kicker">{t("budgets")}</p>
          <h2>{t("budgets")}</h2>
        </div>
        <button type="button" className="btn" onClick={onRefresh}>
          {t("refreshBudgets")}
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
            {t(key === "manage" ? "budgetSearchFilter" : "createBudget")}
          </button>
        ))}
      </div>

      <div className="summary-metric-grid" role="group" aria-label={t("budgets")}>
        <div className="summary-metric-card">
          <span className="summary-metric-label">{t("totalActiveBudget")}</span>
          <strong className="summary-metric-value">{money(summary?.totalBudget)}</strong>
        </div>
        <div className="summary-metric-card">
          <span className="summary-metric-label">{t("totalSpent")}</span>
          <strong className="summary-metric-value">{money(summary?.totalSpent)}</strong>
        </div>
        <div className="summary-metric-card">
          <span className="summary-metric-label">{t("budgetRemaining")}</span>
          <strong className="summary-metric-value">{money(summary?.remaining)}</strong>
        </div>
        <div className={`summary-metric-card ${overCount ? "is-warn" : ""}`}>
          <span className="summary-metric-label">{t("overBudgetCount")}</span>
          <strong className="summary-metric-value">{digits(overCount)}</strong>
        </div>
      </div>

      {warnCount > 0 ? (
        <p className="budget-hero-sub" style={{ marginTop: 0, marginBottom: 8 }}>
          {t("budgetWarning") || "Warning"}: {digits(warnCount)}
        </p>
      ) : null}

      {alerts.length > 0 ? (
        <div className="settings-block" style={{ marginBottom: 8 }}>
          <h4>{t("budgetAlerts")}</h4>
          <div className="finance-feed">
            {alerts.map((budget) => (
              <div
                className={`finance-card tx-card ${budget.is_over_budget ? "is-expense" : "is-loan"}`}
                key={`budget-alert-${budget.id}`}
              >
                <div className="tx-row">
                  <div className="tx-row-type">
                    <TypeChip type={budget.is_over_budget ? "OVER" : "WARN"}>
                      {budget.is_over_budget ? "OVER" : "WARNING"}
                    </TypeChip>
                  </div>
                  <div className="tx-row-copy">
                    <strong>{budget.name}</strong>
                    <span className="tx-row-sub">{budget.category_name}</span>
                  </div>
                  <div className="tx-row-amount">
                    <MoneyPill tone={budget.is_over_budget ? "expense" : "loan"}>
                      {digits(budget.used_percent)}%
                    </MoneyPill>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {tab === "create" ? (
        <div className="settings-stack">
          <div className="settings-block">
            <h4>{t("createBudget")}</h4>
            <div className="finance-form">
              <input
                placeholder={t("budgetName")}
                value={budgetForm.name}
                onChange={(e) => setBudgetForm({ ...budgetForm, name: e.target.value })}
              />
              <select
                value={budgetForm.category_id}
                onChange={(e) => setBudgetForm({ ...budgetForm, category_id: e.target.value })}
              >
                <option value="">{t("selectCategory")}</option>
                {expenseCategories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name_en || category.name}
                  </option>
                ))}
              </select>
              <input
                placeholder={t("budgetAmount")}
                value={budgetForm.budget_amount}
                onChange={(e) => setBudgetForm({ ...budgetForm, budget_amount: e.target.value })}
              />
              <select
                value={budgetForm.period_type}
                onChange={(e) => setBudgetForm({ ...budgetForm, period_type: e.target.value })}
              >
                <option value="MONTHLY">{t("monthly")}</option>
                <option value="WEEKLY">{t("weekly")}</option>
                <option value="YEARLY">{t("yearly")}</option>
              </select>
              <input
                placeholder={t("note")}
                value={budgetForm.note}
                onChange={(e) => setBudgetForm({ ...budgetForm, note: e.target.value })}
              />
              <button type="button" className="btn btn-primary" onClick={onCreate}>
                {t("createBudget")}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="settings-stack">
          <div className="settings-block">
            <h4>{t("budgetSearchFilter")}</h4>
            <div className="finance-form">
              <input
                placeholder={t("searchBudgetCategoryNote")}
                value={budgetSearch}
                onChange={(e) => setBudgetSearch(e.target.value)}
              />
              <select value={budgetStatusFilter} onChange={(e) => setBudgetStatusFilter(e.target.value)}>
                <option value="ALL">{t("allStatus")}</option>
                <option value="ACTIVE">{t("activeStatus")}</option>
                <option value="CLOSED">{t("closedStatus")}</option>
              </select>
              <button type="button" className="btn" onClick={onClearFilters}>
                Clear Filter
              </button>
            </div>
          </div>

          <div className="settings-block">
            <h4>{t("budgets")}</h4>
            {filteredBudgets.length === 0 ? (
              <p className="settings-empty">{t("budgets")}: 0</p>
            ) : (
              <div className="finance-feed">
                {filteredBudgets.map((budget) => {
                  const progressValue = Math.min(Number(budget.used_percent || 0), 100);
                  const tone = budget.is_over_budget ? "expense" : "savings";
                  return (
                    <div
                      className={`finance-card finance-card-stack budget-card is-${tone}`}
                      key={budget.id}
                    >
                      <div className="tx-row budget-row-head">
                        <div className="tx-row-type budget-chip-col">
                          <TypeChip type={budget.is_over_budget ? "OVER" : budget.status}>
                            {budget.is_over_budget ? "OVER" : budget.status}
                          </TypeChip>
                          <TypeChip type="TRANSFER">{budget.period_type}</TypeChip>
                        </div>
                        <div className="tx-row-copy">
                          <strong title={budget.name}>{budget.name}</strong>
                          <span className="tx-row-sub">
                            {budget.category_name}
                            {budget.note ? ` · ${budget.note}` : ""}
                          </span>
                        </div>
                        <div className="tx-row-amount">
                          <MoneyPill tone={budget.is_over_budget ? "expense" : "transfer"}>
                            {digits(budget.used_percent)}%
                          </MoneyPill>
                        </div>
                      </div>

                      <div className="progress-wrapper budget-progress">
                        <div className="progress-fill" style={{ width: `${progressValue}%` }} />
                      </div>

                      <div className="budget-amount-row">
                        <div className="budget-amount-cell">
                          <span>{t("budgets")}</span>
                          <MoneyPill>{money(budget.budget_amount, budget.currency)}</MoneyPill>
                        </div>
                        <div className="budget-amount-cell">
                          <span>{t("totalExpense")}</span>
                          <MoneyPill tone="expense">{money(budget.spent_amount, budget.currency)}</MoneyPill>
                        </div>
                        <div className="budget-amount-cell">
                          <span>{t("remaining")}</span>
                          <MoneyPill tone="income">{money(budget.remaining_amount, budget.currency)}</MoneyPill>
                        </div>
                      </div>

                      <div className="finance-actions">
                        <button type="button" className="btn" onClick={() => onEdit(budget)}>
                          {t("edit")}
                        </button>
                        {budget.status === "ACTIVE" ? (
                          <button type="button" className="btn" onClick={() => onClose(budget)}>
                            {t("close")}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
