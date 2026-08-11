import { useState } from "react";
import { MoneyPill, TypeChip } from "../ui/FinanceChips";
import { BarChart, LineChart, PieChart } from "../ui/Charts";

const REPORT_TABS = ["overview", "ledger", "networth", "categories", "budget", "loans", "savings", "export"];
const EXPORT_TYPES = ["transactions", "cashflow", "goals"];

function reportMaxValue(rows, keys) {
  const values = rows.flatMap((row) => keys.map((key) => Number(row[key] || 0)));
  return Math.max(...values, 1);
}

function shortTime(value, digits, t) {
  if (!value) return t("noDate");
  const cleaned = String(value).replace("T", " ").replace(/\.\d+.*/, "");
  return digits(cleaned);
}

export function ReportsPanel({
  t,
  digits,
  money,
  amount: _amount,
  currencyName,
  financialReport,
  walletReport,
  ledgerReport,
  netWorthReport,
  categoryReport,
  budgetReport,
  loanReport,
  savingsTrendReport,
  reportAccountId,
  setReportAccountId,
  reportsLoading,
  wallets = [],
  activeFamily,
  onRefresh,
  onLoadLedger,
  onLoadExtraReport,
  onDownload,
}) {
  const [reportTab, setReportTab] = useState("overview");

  const summary = financialReport?.summary || {};
  const txCount = Number(summary.transaction_count || 0);
  const totalDebit = Number(summary.total_debit || 0);
  const totalCredit = Number(summary.total_credit || 0);
  const balanced = totalDebit === totalCredit;
  const walletCount = Number(walletReport?.wallet_count || 0);
  const walletBalance = walletReport?.total_current_balance;
  const accountTypes = financialReport?.account_type_summary || [];
  const walletRows = walletReport?.wallets || [];
  const ledgerRows = ledgerReport?.rows || [];
  const accountOptions = walletRows.length ? walletRows : wallets;
  const typeMax = reportMaxValue(accountTypes, ["total_debit", "total_credit"]);
  const walletMax = reportMaxValue(walletRows, ["current_balance"]);
  const nw = netWorthReport || {};
  const catRows = categoryReport?.categories || categoryReport?.rows || [];
  const budgetRows = budgetReport?.budgets || budgetReport?.rows || [];
  const loanRows = loanReport?.loans || loanReport?.rows || [];

  return (
    <section className="panel settings-panel settings-smart finance-smart reports-smart">
      <div className="settings-head">
        <div>
          <p className="settings-kicker">{t("reportHealth")}</p>
          <h2>{t("reports")}</h2>
        </div>
        <button type="button" className="btn" disabled={reportsLoading} onClick={onRefresh}>
          {reportsLoading ? t("loadingReports") : t("refreshReports")}
        </button>
      </div>

      <div className="settings-tabs" role="tablist">
        {REPORT_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={reportTab === tab}
            className={reportTab === tab ? "settings-tab active" : "settings-tab"}
            onClick={() => {
              setReportTab(tab);
              if (["networth", "categories", "budget", "loans", "savings"].includes(tab)) {
                onLoadExtraReport?.(tab);
              }
            }}
          >
            {t(`reportTab_${tab}`)}
          </button>
        ))}
      </div>

      <div className="settings-identity reports-identity">
        <div className={`sync-health ${balanced ? "ok" : "warn"}`}>
          <strong>{balanced ? "OK" : "!"}</strong>
          <span>{balanced ? "BALANCED" : "CHECK"}</span>
        </div>
        <div className="settings-identity-copy">
          <h3 className="hero-money">{money(walletBalance)}</h3>
          <p className="budget-hero-sub">
            {digits(txCount)} {t("transactions")} · {digits(walletCount)} {t("wallets")} ·{" "}
            {t("transactionsOnly")}
          </p>
          <div className="settings-badges">
            <TypeChip type={balanced ? "INCOME" : "OVER"}>{balanced ? "BALANCED" : "CHECK"}</TypeChip>
            <TypeChip type="TRANSFER">
              {t("totalDebit")} = {t("totalCredit")}
            </TypeChip>
          </div>
        </div>
      </div>

      <div className="settings-stat-row">
        <div className="settings-stat">
          <span>{t("transactions")}</span>
          <strong>{digits(txCount)}</strong>
        </div>
        <div className="settings-stat">
          <span>{t("totalDebit")}</span>
          <strong>
            <MoneyPill tone="expense">{money(summary.total_debit)}</MoneyPill>
          </strong>
        </div>
        <div className="settings-stat">
          <span>{t("totalCredit")}</span>
          <strong>
            <MoneyPill tone="income">{money(summary.total_credit)}</MoneyPill>
          </strong>
        </div>
        <div className="settings-stat">
          <span>{t("walletBalance")}</span>
          <strong>
            <MoneyPill>{money(walletBalance)}</MoneyPill>
          </strong>
        </div>
      </div>

      {reportTab === "overview" ? (
        <div className="settings-stack">
          <div className="settings-block">
            <h4>{t("charts") || "Charts"} — Pie / Bar / Line</h4>
            <div className="s4-chart-grid">
              <PieChart
                data={accountTypes.map((item) => ({
                  label: item.account_type || "?",
                  value: Math.max(Number(item.total_debit || 0), Number(item.total_credit || 0)),
                }))}
              />
              <BarChart
                data={walletRows.slice(0, 8).map((w) => ({
                  label: w.name || w.account_type || "W",
                  value: Number(w.current_balance || 0),
                }))}
              />
              <LineChart
                data={(ledgerRows.length ? ledgerRows.slice(-12) : accountTypes).map((row, i) => ({
                  label: row.account_type || row.created_at || String(i + 1),
                  value: Number(row.total_debit || row.debit || row.amount || row.current_balance || 0),
                }))}
              />
            </div>
            <p className="budget-hero-sub" style={{ marginTop: 8 }}>
              {t("reportTab_savings") || "Savings trend"}: use the Savings tab for charts.
            </p>
          </div>
          <div className="settings-block">
            <h4>{t("accountTypeSummary")}</h4>
            {reportsLoading ? (
              <p className="settings-empty">{t("loadingReports")}</p>
            ) : accountTypes.length === 0 ? (
              <p className="settings-empty">{t("noFinancialSummary")}</p>
            ) : (
              <div className="finance-feed">
                {accountTypes.map((item) => {
                  const debit = Number(item.total_debit || 0);
                  const credit = Number(item.total_credit || 0);
                  const width = Math.min((Math.max(debit, credit) / typeMax) * 100, 100);
                  return (
                    <div
                      className="finance-card finance-card-stack budget-card is-transfer"
                      key={item.account_type || "unknown-type"}
                    >
                      <div className="tx-row budget-row-head">
                        <div className="tx-row-type">
                          <TypeChip type={item.account_type || "ACCOUNT"}>
                            {item.account_type || "UNKNOWN"}
                          </TypeChip>
                        </div>
                        <div className="tx-row-copy">
                          <strong>{item.account_type || t("accountTypeSummary")}</strong>
                          <span className="tx-row-sub">
                            {digits(item.transaction_count)} {t("transactions")}
                          </span>
                        </div>
                        <div className="tx-row-amount">
                          <MoneyPill tone="transfer">{digits(item.transaction_count)} tx</MoneyPill>
                        </div>
                      </div>
                      <div className="progress-wrapper budget-progress">
                        <div className="progress-fill" style={{ width: `${width}%` }} />
                      </div>
                      <div className="budget-amount-row">
                        <div className="budget-amount-cell">
                          <span>{t("debit")}</span>
                          <MoneyPill tone="expense">{money(item.total_debit)}</MoneyPill>
                        </div>
                        <div className="budget-amount-cell">
                          <span>{t("credit")}</span>
                          <MoneyPill tone="income">{money(item.total_credit)}</MoneyPill>
                        </div>
                        <div className="budget-amount-cell">
                          <span>Net</span>
                          <MoneyPill tone={debit - credit >= 0 ? "income" : "expense"}>
                            {money(Math.abs(debit - credit))}
                          </MoneyPill>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="settings-block">
            <h4>{t("walletSummary")}</h4>
            {walletRows.length === 0 ? (
              <p className="settings-empty">{t("noWalletReport")}</p>
            ) : (
              <div className="finance-feed">
                {walletRows.map((wallet) => {
                  const bal = Math.max(Number(wallet.current_balance || 0), 0);
                  const width = Math.min((bal / walletMax) * 100, 100);
                  const code = wallet.currency || activeFamily?.default_currency;
                  return (
                    <div className="finance-card finance-card-stack budget-card is-savings" key={wallet.id}>
                      <div className="tx-row budget-row-head">
                        <div className="tx-row-type budget-chip-col">
                          <TypeChip type={wallet.account_type || "ACCOUNT"}>
                            {wallet.account_type || "ACCOUNT"}
                          </TypeChip>
                        </div>
                        <div className="tx-row-copy">
                          <strong>{wallet.name || t("wallets")}</strong>
                          <span className="tx-row-sub">{currencyName(code)}</span>
                        </div>
                        <div className="tx-row-amount">
                          <MoneyPill tone="savings">{money(wallet.current_balance, code)}</MoneyPill>
                        </div>
                      </div>
                      <div className="progress-wrapper budget-progress">
                        <div className="progress-fill" style={{ width: `${width}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {reportTab === "ledger" ? (
        <div className="settings-stack">
          <div className="settings-block">
            <div className="settings-block-head">
              <div>
                <h4>{t("accountLedgerPreview")}</h4>
                <p className="budget-hero-sub" style={{ margin: 0 }}>
                  {digits(ledgerRows.length)} {t("transactions")}
                </p>
              </div>
              <select
                className="reports-select"
                aria-label={t("ledgerAccount")}
                value={reportAccountId}
                onChange={(e) => {
                  const next = e.target.value;
                  setReportAccountId(next);
                  onLoadLedger(next);
                }}
              >
                <option value="">{t("selectLedgerAccount")}</option>
                {accountOptions.map((wallet) => (
                  <option key={wallet.id} value={wallet.id}>
                    {wallet.name || wallet.id}
                  </option>
                ))}
              </select>
            </div>

            {!ledgerRows.length ? (
              <p className="settings-empty">{reportsLoading ? t("loadingReports") : t("noLedgerRows")}</p>
            ) : (
              <div className="finance-feed" style={{ marginTop: 12 }}>
                {ledgerRows.map((row, index) => {
                  const debit = Number(row.debit || 0);
                  const credit = Number(row.credit || 0);
                  const tone = debit > 0 ? "expense" : credit > 0 ? "income" : "transfer";
                  return (
                    <div className={`finance-card finance-card-stack budget-card is-${tone}`} key={row.transaction_id || index}>
                      <div className="tx-row budget-row-head">
                        <div className="tx-row-type">
                          <TypeChip type={debit > 0 ? "EXPENSE" : credit > 0 ? "INCOME" : "TRANSFER"}>
                            {debit > 0 ? t("debit") : credit > 0 ? t("credit") : "TX"}
                          </TypeChip>
                        </div>
                        <div className="tx-row-copy">
                          <strong>{row.description || row.transaction_id || t("transactions")}</strong>
                          <span className="tx-row-sub">{shortTime(row.transaction_date, digits, t)}</span>
                        </div>
                        <div className="tx-row-amount">
                          <MoneyPill tone="transfer">{money(row.running_balance || "0")}</MoneyPill>
                        </div>
                      </div>
                      <div className="budget-amount-row">
                        <div className="budget-amount-cell">
                          <span>{t("debit")}</span>
                          <MoneyPill tone="expense">{money(row.debit || "0")}</MoneyPill>
                        </div>
                        <div className="budget-amount-cell">
                          <span>{t("credit")}</span>
                          <MoneyPill tone="income">{money(row.credit || "0")}</MoneyPill>
                        </div>
                        <div className="budget-amount-cell">
                          <span>{t("walletBalance")}</span>
                          <MoneyPill>{money(row.running_balance || "0")}</MoneyPill>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {reportTab === "networth" ? (
        <div className="settings-stack">
          <div className="settings-stat-row">
            <div className="settings-stat">
              <span>{t("reportTab_networth") || "Net worth"}</span>
              <strong>{money(nw.net_worth || nw.total_net_worth || 0)}</strong>
            </div>
            <div className="settings-stat">
              <span>{t("wallets")}</span>
              <strong>{money(nw.wallet_balance || 0)}</strong>
            </div>
            <div className="settings-stat">
              <span>{t("savings")}</span>
              <strong>{money(nw.savings_balance || nw.savings || 0)}</strong>
            </div>
            <div className="settings-stat">
              <span>{t("loans")}</span>
              <strong>{money(nw.loan_taken_remaining || nw.liabilities || 0)}</strong>
            </div>
          </div>
          {reportsLoading ? <p className="settings-empty">{t("loadingReports")}</p> : null}
        </div>
      ) : null}

      {reportTab === "categories" ? (
        <div className="settings-stack">
          <div className="settings-block">
            <h4>{t("reportTab_categories") || "Categories"}</h4>
            {!catRows.length ? (
              <p className="settings-empty">{reportsLoading ? t("loadingReports") : t("noData") || "No data"}</p>
            ) : (
              <div className="finance-feed" style={{ marginTop: 12 }}>
                {catRows.slice(0, 30).map((row, index) => (
                  <div className="finance-card tx-card is-savings" key={row.category_id || row.id || index}>
                    <div className="tx-row">
                      <div className="tx-row-copy">
                        <strong>{row.category_name || row.name || row.name_en || "Category"}</strong>
                        <span className="tx-row-sub">{row.category_type || row.type || ""}</span>
                      </div>
                      <div className="tx-row-amount">
                        <MoneyPill>{money(row.total || row.amount || row.expense || 0)}</MoneyPill>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {reportTab === "budget" ? (
        <div className="settings-stack">
          <div className="settings-block">
            <h4>{t("reportTab_budget") || "Budget"}</h4>
            {!budgetRows.length ? (
              <p className="settings-empty">{reportsLoading ? t("loadingReports") : t("noData") || "No data"}</p>
            ) : (
              <div className="finance-feed" style={{ marginTop: 12 }}>
                {budgetRows.slice(0, 30).map((row, index) => (
                  <div className="finance-card tx-card is-savings" key={row.budget_id || row.id || index}>
                    <div className="tx-row">
                      <div className="tx-row-copy">
                        <strong>{row.name || row.title || "Budget"}</strong>
                        <span className="tx-row-sub">
                          {t("spent") || "Spent"} {money(row.spent_amount || row.spent || 0)} / {money(row.budget_amount || row.amount || 0)}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {reportTab === "loans" ? (
        <div className="settings-stack">
          <div className="settings-block">
            <h4>{t("reportTab_loans") || "Loans"}</h4>
            {!loanRows.length ? (
              <p className="settings-empty">{reportsLoading ? t("loadingReports") : t("noData") || "No data"}</p>
            ) : (
              <div className="finance-feed" style={{ marginTop: 12 }}>
                {loanRows.slice(0, 30).map((row, index) => (
                  <div className="finance-card tx-card is-savings" key={row.loan_id || row.id || index}>
                    <div className="tx-row">
                      <div className="tx-row-copy">
                        <strong>{row.person_name || row.name || "Loan"}</strong>
                        <span className="tx-row-sub">{row.loan_type || row.type || ""}</span>
                      </div>
                      <div className="tx-row-amount">
                        <MoneyPill>{money(row.remaining_amount || row.remaining || row.amount || 0)}</MoneyPill>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {reportTab === "savings" ? (
        <div className="settings-stack">
          <div className="settings-block">
            <h4>{t("reportTab_savings") || "Savings trend"}</h4>
            <p className="budget-hero-sub">
              {t("totalSaved") || "Total saved"}: {money(savingsTrendReport?.total_saved || 0)} ·{" "}
              {digits(savingsTrendReport?.point_count || 0)} goals
            </p>
            {(savingsTrendReport?.chart?.bar || []).length ? (
              <div className="reports-charts" style={{ marginTop: 12 }}>
                <BarChart data={savingsTrendReport.chart.bar} />
                <LineChart data={savingsTrendReport.chart.line || []} />
              </div>
            ) : (
              <p className="settings-empty">{reportsLoading ? t("loadingReports") : t("noData") || "No data"}</p>
            )}
            {(savingsTrendReport?.trend || []).length ? (
              <div className="finance-feed" style={{ marginTop: 12 }}>
                {savingsTrendReport.trend.map((row) => (
                  <div className="finance-card tx-card is-savings" key={row.id}>
                    <div className="tx-row">
                      <div className="tx-row-copy">
                        <strong>{row.label}</strong>
                        <span className="tx-row-sub">{row.goal_type || ""}</span>
                      </div>
                      <div className="tx-row-amount">
                        <MoneyPill tone="savings">{money(row.saved)}</MoneyPill>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {reportTab === "export" ? (
        <div className="settings-stack">
          <div className="settings-block">
            <h4>{t("exportReports")}</h4>
            <p className="budget-hero-sub">{t("readyExcelPdfExport")}</p>
            <div className="finance-feed" style={{ marginTop: 12 }}>
              {EXPORT_TYPES.map((type) => (
                <div className="finance-card tx-card is-savings reports-export-row" key={type}>
                  <div className="tx-row">
                    <div className="tx-row-type">
                      <TypeChip type="SAVINGS">{type.toUpperCase()}</TypeChip>
                    </div>
                    <div className="tx-row-copy">
                      <strong>{type.toUpperCase()}</strong>
                      <span className="tx-row-sub">{t("readyExcelPdfExport")}</span>
                    </div>
                    <div className="tx-row-amount reports-export-actions">
                      <button type="button" className="btn btn-primary" onClick={() => onDownload(type, "excel")}>
                        {t("excel")}
                      </button>
                      <button type="button" className="btn" onClick={() => onDownload(type, "pdf")}>
                        {t("pdf")}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
