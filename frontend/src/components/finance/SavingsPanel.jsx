import { useEffect, useState } from "react";
import { MoneyPill, TypeChip } from "../ui/FinanceChips";

const TABS = ["manage", "create", "actions"];

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
  busy = false,
}) {
  const [tab, setTab] = useState("manage");
  const attention = Number(summary?.attentionCount || 0);
  const activeWallets = (wallets || []).filter((w) => !w?.deleted_at && w?.is_active !== false);
  const activeGoals = (savings || []).filter((g) => String(g.status || "").toUpperCase() === "ACTIVE");

  useEffect(() => {
    if (!savingsForm?.wallet_account_id && activeWallets[0]?.id) {
      setSavingsForm((prev) => ({ ...prev, wallet_account_id: activeWallets[0].id }));
    }
  }, [activeWallets, savingsForm?.wallet_account_id, setSavingsForm]);

  useEffect(() => {
    if (!savingsAction?.wallet_account_id && activeWallets[0]?.id) {
      setSavingsAction((prev) => ({ ...prev, wallet_account_id: activeWallets[0].id }));
    }
  }, [activeWallets, savingsAction?.wallet_account_id, setSavingsAction]);

  useEffect(() => {
    if (!savingsAction?.savings_goal_id && activeGoals[0]?.id) {
      setSavingsAction((prev) => ({ ...prev, savings_goal_id: activeGoals[0].id }));
    }
  }, [activeGoals, savingsAction?.savings_goal_id, setSavingsAction]);

  async function handleCreate() {
    const ok = await onCreate?.();
    if (ok) setTab("manage");
  }

  return (
    <section className="panel settings-panel settings-smart finance-smart">
      <div className="settings-head">
        <div>
          <p className="settings-kicker">{t("savings")}</p>
          <h2>{t("savings")}</h2>
        </div>
        <button type="button" className="btn" onClick={onRefresh} disabled={busy}>
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
            {t(
              key === "manage"
                ? "savings"
                : key === "create"
                  ? "createSavingsGoal"
                  : "depositWithdraw",
            )}
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
                        {done ? t("targetDone") || "TARGET DONE" : t("lowProgress") || "LOW PROGRESS"}
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

      {tab === "create" ? (
        <div className="settings-stack">
          <div className="settings-block">
            <h4>{t("createSavingsGoal")}</h4>
            {activeWallets.length === 0 ? (
              <p className="settings-empty">{t("createWalletFirst") || "Create a wallet first"}</p>
            ) : null}
            <div className="finance-form">
              <input
                placeholder={t("savingsName")}
                value={savingsForm.name || ""}
                onChange={(e) => setSavingsForm({ ...savingsForm, name: e.target.value })}
              />
              <select
                value={savingsForm.wallet_account_id || ""}
                onChange={(e) => setSavingsForm({ ...savingsForm, wallet_account_id: e.target.value })}
              >
                <option value="">{t("selectWallet")}</option>
                {activeWallets.map((wallet) => (
                  <option key={wallet.id} value={wallet.id}>
                    {wallet.name}
                  </option>
                ))}
              </select>
              <select
                value={savingsForm.goal_type || "GENERAL"}
                onChange={(e) => setSavingsForm({ ...savingsForm, goal_type: e.target.value })}
              >
                <option value="GENERAL">{t("goalGeneral") || "GENERAL"}</option>
                <option value="EMERGENCY">{t("goalEmergency") || "EMERGENCY FUND"}</option>
                <option value="MONTHLY">{t("goalMonthly") || "MONTHLY"}</option>
                <option value="ANNUAL">{t("goalAnnual") || "ANNUAL"}</option>
              </select>
              <input
                placeholder={t("targetAmount")}
                value={savingsForm.target_amount || ""}
                onChange={(e) => setSavingsForm({ ...savingsForm, target_amount: e.target.value })}
                inputMode="decimal"
              />
              <input
                placeholder={t("note")}
                value={savingsForm.note || ""}
                onChange={(e) => setSavingsForm({ ...savingsForm, note: e.target.value })}
              />
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || activeWallets.length === 0}
                onClick={handleCreate}
              >
                {busy ? t("loading") : t("createSavingsGoal")}
              </button>
            </div>
          </div>
        </div>
      ) : tab === "actions" ? (
        <div className="settings-stack">
          <div className="settings-block">
            <h4>{t("depositWithdraw")}</h4>
            {activeGoals.length === 0 ? (
              <div>
                <p className="settings-empty">{t("noSavingsYet") || "No savings goals yet"}</p>
                <button type="button" className="btn btn-primary" onClick={() => setTab("create")}>
                  {t("createSavingsGoal")}
                </button>
              </div>
            ) : (
              <div className="finance-form">
                <select
                  value={savingsAction.action || "deposit"}
                  onChange={(e) => setSavingsAction({ ...savingsAction, action: e.target.value })}
                >
                  <option value="deposit">{t("deposit")}</option>
                  <option value="withdraw">{t("withdraw")}</option>
                </select>
                <select
                  value={savingsAction.savings_goal_id || ""}
                  onChange={(e) => setSavingsAction({ ...savingsAction, savings_goal_id: e.target.value })}
                >
                  <option value="">{t("savings")}</option>
                  {activeGoals.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <select
                  value={savingsAction.wallet_account_id || ""}
                  onChange={(e) => setSavingsAction({ ...savingsAction, wallet_account_id: e.target.value })}
                >
                  <option value="">{t("selectWallet")}</option>
                  {activeWallets.map((wallet) => (
                    <option key={wallet.id} value={wallet.id}>
                      {wallet.name}
                    </option>
                  ))}
                </select>
                <input
                  placeholder={t("amount")}
                  value={savingsAction.amount || ""}
                  onChange={(e) => setSavingsAction({ ...savingsAction, amount: e.target.value })}
                  inputMode="decimal"
                />
                <input
                  placeholder={t("description")}
                  value={savingsAction.description || ""}
                  onChange={(e) => setSavingsAction({ ...savingsAction, description: e.target.value })}
                />
                <button type="button" className="btn btn-primary" disabled={busy} onClick={onPostAction}>
                  {busy ? t("loading") : t("postSavings")}
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="settings-stack">
          <div className="settings-block">
            <h4>{t("annualPlanning") || "Annual planning"}</h4>
            <button type="button" className="btn" onClick={onLoadAnnualPlan} disabled={busy}>
              {t("loadAnnualPlan") || "Load annual plan"}
            </button>
            {annualPlan ? (
              <div style={{ marginTop: 10 }}>
                <p className="budget-hero-sub">
                  {t("year") || "Year"} {annualPlan.year} · {t("targetAmount")}{" "}
                  {money(annualPlan.total_annual_target)} · {t("saved")} {money(annualPlan.total_saved)} ·{" "}
                  {t("emergencyFunds") || "Emergency funds"} {digits(annualPlan.emergency_fund_count)}
                </p>
                <div className="finance-feed">
                  {(annualPlan.funds || []).map((f) => (
                    <div className="finance-card" key={f.id}>
                      <strong>
                        {f.name} · {f.goal_type}
                      </strong>
                      <span className="tx-row-sub">
                        {t("monthly")}: {money(f.monthly_target)} · {t("yearly")}: {money(f.annual_target)} ·{" "}
                        {f.progress_percent}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="settings-block">
            <h4>
              {t("savings")}
              {savings.length ? ` (${digits(savings.length)})` : ""}
            </h4>
            {savings.length === 0 ? (
              <div>
                <p className="settings-empty">{t("noSavingsYet") || "No savings goals yet"}</p>
                <button type="button" className="btn btn-primary" onClick={() => setTab("create")}>
                  {t("createSavingsGoal")}
                </button>
              </div>
            ) : (
              <div className="finance-feed">
                {savings.map((item) => {
                  const progressValue = Math.min(Number(item.progress_percent || 0), 100);
                  const remaining = Math.max(
                    Number(item.target_amount || 0) - Number(item.current_amount || 0),
                    0,
                  );
                  const isActive = String(item.status || "").toUpperCase() === "ACTIVE";
                  return (
                    <div className="finance-card finance-card-stack budget-card is-savings" key={item.id}>
                      <div className="tx-row budget-row-head">
                        <div className="tx-row-type budget-chip-col">
                          <TypeChip type={isActive ? "SAVINGS" : "PENDING"}>
                            {isActive ? t("activeStatus") : t("closedStatus")}
                          </TypeChip>
                          <TypeChip type="TRANSFER">{item.goal_type}</TypeChip>
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
                        {isActive ? (
                          <button type="button" className="btn" disabled={busy} onClick={() => onEdit(item)}>
                            {t("edit")}
                          </button>
                        ) : null}
                        <button type="button" className="btn" disabled={busy} onClick={() => onHistory(item)}>
                          {t("history")}
                        </button>
                        {isActive ? (
                          <button type="button" className="btn" disabled={busy} onClick={() => onClose(item)}>
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
