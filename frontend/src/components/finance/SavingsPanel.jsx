import { useState } from "react";
import { MoneyPill, TypeChip } from "../ui/FinanceChips";

const TABS = ["goals", "actions"];

export function SavingsPanel({
  t,
  digits,
  money,
  savings = [],
  wallets = [],
  summary,
  alerts = [],
  savingsForm,
  setSavingsForm,
  savingsAction,
  setSavingsAction,
  annualPlan = null,
  onLoadAnnualPlan,
  onCreate,
  onPostAction,
  onRefresh,
  onEdit,
  onHistory,
  onClose,
}) {
  const [tab, setTab] = useState("goals");
  const attention = Number(summary?.attentionCount || 0);

  return (
    <section className="panel settings-panel settings-smart finance-smart">
      <div className="settings-head">
        <div>
          <p className="settings-kicker">{t("savings")}</p>
          <h2>{t("savings")}</h2>
        </div>
        <button type="button" className="btn" onClick={onRefresh}>
          {t("refreshSavings")}
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
            {t(key === "goals" ? "createSavingsGoal" : "depositWithdraw")}
          </button>
        ))}
      </div>

      <div className="summary-metric-grid" role="group" aria-label={t("savings")}>
        <div className="summary-metric-card">
          <span className="summary-metric-label">{t("activeSavingsGoals")}</span>
          <strong className="summary-metric-value">{digits(summary?.activeCount || 0)}</strong>
        </div>
        <div className="summary-metric-card">
          <span className="summary-metric-label">{t("totalSaved")}</span>
          <strong className="summary-metric-value">{money(summary?.totalSaved)}</strong>
        </div>
        <div className="summary-metric-card">
          <span className="summary-metric-label">{t("totalTarget")}</span>
          <strong className="summary-metric-value">{money(summary?.totalTarget)}</strong>
        </div>
        <div className={`summary-metric-card ${attention ? "is-warn" : ""}`}>
          <span className="summary-metric-label">{t("needsAttention")}</span>
          <strong className="summary-metric-value">{digits(attention)}</strong>
        </div>
      </div>

      {alerts.length > 0 ? (
        <div className="settings-block" style={{ marginBottom: 14 }}>
          <h4>{t("savingsAlerts")}</h4>
          <div className="finance-feed">
            {alerts.map((item) => {
              const done = Number(item.progress_percent || 0) >= 100;
              return (
                <div
                  className={`finance-card tx-card ${done ? "is-savings" : "is-loan"}`}
                  key={`savings-alert-${item.id}`}
                >
                  <div className="tx-row">
                    <div className="tx-row-type">
                      <TypeChip type={done ? "SAVINGS" : "LOW"}>
                        {done ? "TARGET DONE" : "LOW PROGRESS"}
                      </TypeChip>
                    </div>
                    <div className="tx-row-copy">
                      <strong>{item.name}</strong>
                      <span className="tx-row-sub">
                        {money(item.current_amount, item.currency)} / {money(item.target_amount, item.currency)}
                      </span>
                    </div>
                    <div className="tx-row-amount">
                      <MoneyPill tone={done ? "savings" : "loan"}>
                        {digits(item.progress_percent)}%
                      </MoneyPill>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {tab === "goals" ? (
        <div className="settings-stack">
          <div className="settings-block">
            <h4>{t("createSavingsGoal")}</h4>
            <div className="finance-form">
              <input
                placeholder={t("savingsName")}
                value={savingsForm.name}
                onChange={(e) => setSavingsForm({ ...savingsForm, name: e.target.value })}
              />
              <select
                value={savingsForm.wallet_account_id}
                onChange={(e) => setSavingsForm({ ...savingsForm, wallet_account_id: e.target.value })}
              >
                <option value="">{t("selectWallet")}</option>
                {wallets.map((wallet) => (
                  <option key={wallet.id} value={wallet.id}>
                    {wallet.name}
                  </option>
                ))}
              </select>
              <select
                value={savingsForm.goal_type || "GENERAL"}
                onChange={(e) => setSavingsForm({ ...savingsForm, goal_type: e.target.value })}
              >
                <option value="GENERAL">GENERAL</option>
                <option value="EMERGENCY">EMERGENCY FUND</option>
                <option value="MONTHLY">MONTHLY</option>
                <option value="ANNUAL">ANNUAL</option>
              </select>
              <input
                placeholder={t("targetAmount")}
                value={savingsForm.target_amount}
                onChange={(e) => setSavingsForm({ ...savingsForm, target_amount: e.target.value })}
              />
              <input
                placeholder={t("note")}
                value={savingsForm.note}
                onChange={(e) => setSavingsForm({ ...savingsForm, note: e.target.value })}
              />
              <button type="button" className="btn btn-primary" onClick={onCreate}>
                {t("createSavingsGoal")}
              </button>
            </div>
          </div>

          <div className="settings-block">
            <h4>Annual planning</h4>
            <button type="button" className="btn" onClick={onLoadAnnualPlan}>
              Load annual plan
            </button>
            {annualPlan ? (
              <div style={{ marginTop: 10 }}>
                <p className="budget-hero-sub">
                  Year {annualPlan.year} · Target {money(annualPlan.total_annual_target)} · Saved{" "}
                  {money(annualPlan.total_saved)} · Emergency funds {digits(annualPlan.emergency_fund_count)}
                </p>
                <div className="finance-feed">
                  {(annualPlan.funds || []).map((f) => (
                    <div className="finance-card" key={f.id}>
                      <strong>
                        {f.name} · {f.goal_type}
                      </strong>
                      <span className="tx-row-sub">
                        Monthly {money(f.monthly_target)} · Annual {money(f.annual_target)} · {f.progress_percent}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="settings-block">
            <h4>{t("savings")}</h4>
            {savings.length === 0 ? (
              <p className="settings-empty">{t("savings")}: 0</p>
            ) : (
              <div className="finance-feed">
                {savings.map((item) => {
                  const progressValue = Math.min(Number(item.progress_percent || 0), 100);
                  const remaining = Math.max(
                    Number(item.target_amount || 0) - Number(item.current_amount || 0),
                    0
                  );
                  return (
                    <div className="finance-card finance-card-stack budget-card is-savings" key={item.id}>
                      <div className="tx-row budget-row-head">
                        <div className="tx-row-type budget-chip-col">
                          <TypeChip type={item.status === "ACTIVE" ? "SAVINGS" : "PENDING"}>
                            {item.status}
                          </TypeChip>
                        </div>
                        <div className="tx-row-copy">
                          <strong title={item.name}>{item.name}</strong>
                          <span className="tx-row-sub">{item.note || t("noNote")}</span>
                        </div>
                        <div className="tx-row-amount">
                          <MoneyPill tone="transfer">{digits(item.progress_percent)}%</MoneyPill>
                        </div>
                      </div>

                      <div className="progress-wrapper budget-progress">
                        <div className="progress-fill" style={{ width: `${progressValue}%` }} />
                      </div>

                      <div className="budget-amount-row">
                        <div className="budget-amount-cell">
                          <span>{t("saved")}</span>
                          <MoneyPill tone="savings">{money(item.current_amount, item.currency)}</MoneyPill>
                        </div>
                        <div className="budget-amount-cell">
                          <span>{t("targetAmount")}</span>
                          <MoneyPill>{money(item.target_amount, item.currency)}</MoneyPill>
                        </div>
                        <div className="budget-amount-cell">
                          <span>{t("remaining")}</span>
                          <MoneyPill tone="loan">{money(remaining, item.currency)}</MoneyPill>
                        </div>
                      </div>

                      <div className="finance-actions">
                        <button type="button" className="btn" onClick={() => onEdit(item)}>
                          {t("edit")}
                        </button>
                        <button type="button" className="btn" onClick={() => onHistory(item)}>
                          {t("history")}
                        </button>
                        {item.status === "ACTIVE" ? (
                          <button type="button" className="btn" onClick={() => onClose(item)}>
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
      ) : (
        <div className="settings-stack">
          <div className="settings-block">
            <h4>{t("depositWithdraw")}</h4>
            <div className="finance-form">
              <select
                value={savingsAction.action}
                onChange={(e) => setSavingsAction({ ...savingsAction, action: e.target.value })}
              >
                <option value="deposit">{t("deposit")}</option>
                <option value="withdraw">{t("withdraw")}</option>
              </select>
              <select
                value={savingsAction.savings_goal_id}
                onChange={(e) => setSavingsAction({ ...savingsAction, savings_goal_id: e.target.value })}
              >
                <option value="">{t("savings")}</option>
                {savings.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <select
                value={savingsAction.wallet_account_id}
                onChange={(e) => setSavingsAction({ ...savingsAction, wallet_account_id: e.target.value })}
              >
                <option value="">{t("selectWallet")}</option>
                {wallets.map((wallet) => (
                  <option key={wallet.id} value={wallet.id}>
                    {wallet.name}
                  </option>
                ))}
              </select>
              <input
                placeholder={t("amount")}
                value={savingsAction.amount}
                onChange={(e) => setSavingsAction({ ...savingsAction, amount: e.target.value })}
              />
              <input
                placeholder={t("description")}
                value={savingsAction.description}
                onChange={(e) => setSavingsAction({ ...savingsAction, description: e.target.value })}
              />
              <button type="button" className="btn btn-primary" onClick={onPostAction}>
                {t("postSavings")}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
