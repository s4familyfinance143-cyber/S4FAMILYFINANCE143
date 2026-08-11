import { MoneyPill, TypeChip, typeTone } from "../ui/FinanceChips";

function EmptyState({ label }) {
  return <div className="empty">{label}</div>;
}

function moduleLabel(moduleType, t) {
  const map = {
    INVESTMENT: t("moduleInvestment"),
    HEALTH: t("moduleHealth"),
    VEHICLE: t("moduleVehicle"),
    EDUCATION: t("moduleEducation"),
    SUBSCRIPTION: t("moduleSubscription"),
    DOCUMENT: t("moduleDocument"),
    PROPERTY: t("moduleProperty"),
  };
  return map[moduleType] || moduleType;
}

const BN_MONTHS = ["জানু", "ফেব্রু", "মার্চ", "এপ্রিল", "মে", "জুন", "জুলাই", "আগস্ট", "সেপ্ট", "অক্টো", "নভে", "ডিসে"];
const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthLabels(lang) {
  if (lang === "bn") return BN_MONTHS;
  return EN_MONTHS;
}

function buildMonthSeries(transactions, lang = "bn") {
  const months = [];
  const labels = monthLabels(lang);
  const now = new Date();
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: labels[d.getMonth()] || d.toLocaleString(undefined, { month: "short" }),
      income: 0,
      expense: 0,
    });
  }
  const index = Object.fromEntries(months.map((m, i) => [m.key, i]));
  for (const tx of transactions || []) {
    const raw = tx.created_at || tx.transaction_date || tx.date;
    if (!raw) continue;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const slot = index[key];
    if (slot == null) continue;
    const amount = Number(tx.amount || 0);
    if (String(tx.transaction_type).toUpperCase() === "INCOME") months[slot].income += amount;
    if (String(tx.transaction_type).toUpperCase() === "EXPENSE") months[slot].expense += amount;
  }
  return months;
}

function linePoints(values, width, height, pad = 16) {
  const max = Math.max(...values, 1);
  return values
    .map((value, i) => {
      const x = pad + (i * (width - pad * 2)) / Math.max(values.length - 1, 1);
      const y = height - pad - (value / max) * (height - pad * 2);
      return `${x},${y}`;
    })
    .join(" ");
}

function assetSlices(dashboard, phase15Summary, phase16Summary, t) {
  const cash = Number(dashboard?.summary?.total_wallet_balance || 0);
  const investment = Number(phase15Summary?.modules?.INVESTMENT?.total_amount || phase15Summary?.modules?.INVESTMENT?.active_count || 0);
  const property = Number(phase16Summary?.modules?.PROPERTY?.total_amount || phase16Summary?.modules?.PROPERTY?.active_count || 0);
  const otherLife =
    Number(phase15Summary?.modules?.HEALTH?.active_count || 0) +
    Number(phase15Summary?.modules?.VEHICLE?.active_count || 0) +
    Number(phase15Summary?.modules?.EDUCATION?.active_count || 0);
  let rows = [
    { label: t("cashBank"), value: cash || 1, color: "#0d9488" },
    { label: t("navProperty"), value: property || (cash ? cash * 0.24 : 1), color: "#0284c7" },
    { label: t("navInvestments"), value: investment || (cash ? cash * 0.16 : 1), color: "#d97706" },
    { label: t("goldAsset"), value: otherLife || (cash ? cash * 0.13 : 1), color: "#ca8a04" },
    { label: t("otherAsset"), value: cash ? cash * 0.09 : 1, color: "#94a3b8" },
  ];
  if (cash <= 0 && investment <= 0 && property <= 0) {
    rows = [
      { label: t("cashBank"), value: 38, color: "#0d9488" },
      { label: t("navProperty"), value: 24, color: "#0284c7" },
      { label: t("navInvestments"), value: 16, color: "#d97706" },
      { label: t("goldAsset"), value: 13, color: "#ca8a04" },
      { label: t("otherAsset"), value: 9, color: "#94a3b8" },
    ];
  }
  const total = rows.reduce((sum, row) => sum + row.value, 0) || 1;
  let cursor = 0;
  return rows.map((row) => {
    const pct = (row.value / total) * 100;
    const start = cursor;
    cursor += pct;
    return { ...row, pct, start };
  });
}

function walletName(wallets, accountId) {
  const hit = (wallets || []).find((w) => w.id === accountId);
  return hit?.name || "—";
}

function memberDisplayName(member, t) {
  return (
    member.full_name ||
    member.display_name ||
    member.name ||
    member.email ||
    member.relationship_display_label ||
    member.relationship ||
    t("member")
  );
}

function memberInitials(member, t) {
  const label = memberDisplayName(member, t);
  if (/^[0-9a-f-]{20,}$/i.test(String(label))) return "M";
  return String(label)
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] || "")
    .join("")
    .toUpperCase() || "M";
}

function shortId(value) {
  const text = String(value || "");
  if (!text || text.length <= 12) return text;
  return `${text.slice(0, 6)}…${text.slice(-4)}`;
}

export function ExecutiveDashboard({
  dashboard,
  wallets,
  transactions,
  budgets,
  activeFamily,
  syncStatus,
  notificationSummary,
  auditSummary,
  phase15Summary,
  phase15Items: _phase15Items,
  phase16Summary,
  phase16Items: _phase16Items,
  governanceMembers,
  setActiveMenu,
  budgetSummary,
  totalLoanRemaining,
  money,
  digits,
  t,
  appLanguage = "bn",
}) {
  const summary = dashboard?.summary || {};
  const walletBalance = Number(summary.total_wallet_balance || 0);
  const savingsCurrent = Number(dashboard?.savings?.total_current_amount || 0);
  const loanTaken = Number(dashboard?.loans?.loan_taken_remaining || totalLoanRemaining?.("TAKEN") || 0);
  const netWorth = walletBalance + savingsCurrent - loanTaken;
  const incomeTotal = Number(summary.total_income || 0);
  const expenseTotal = Number(summary.total_expense || 0);
  const assetTotal = walletBalance + savingsCurrent + Number(phase15Summary?.modules?.INVESTMENT?.total_amount || 0);

  const pendingSync = Number(syncStatus?.pending_outbox || syncStatus?.pending_count || 0);
  const openConflicts = Number(syncStatus?.open_conflicts || syncStatus?.conflict_count || 0);
  const failedSync = Number(syncStatus?.failed_count || syncStatus?.dead_letter_count || 0);
  const syncHealth = Math.max(0, Math.min(100, 100 - pendingSync * 4 - openConflicts * 10 - failedSync * 8));
  const syncOk = !(pendingSync || openConflicts || failedSync);

  const monthSeries = buildMonthSeries(transactions?.length ? transactions : dashboard?.recent_transactions, appLanguage);
  const incomePoints = linePoints(monthSeries.map((m) => m.income), 700, 210);
  const expensePoints = linePoints(monthSeries.map((m) => m.expense), 700, 210);

  const assets = assetSlices(dashboard, phase15Summary, phase16Summary, t);
  const donutGradient = assets
    .map((slice) => `${slice.color} ${slice.start}% ${slice.start + slice.pct}%`)
    .join(", ");

  const budgetRows = (budgets || [])
    .filter((b) => String(b.status || "").toUpperCase() === "ACTIVE")
    .slice(0, 4)
    .map((b) => {
      const limit = Number(b.budget_amount || 0);
      const spent = Number(b.spent_amount || 0);
      const used = limit > 0 ? Math.min(100, Math.round((spent / limit) * 100)) : Number(b.used_percent || 0);
      return {
        id: b.id,
        name: b.name || b.category_name || t("budgets"),
        spent,
        limit,
        used,
        warn: used >= 75 && used < 90,
        danger: used >= 90 || b.is_over_budget,
      };
    });

  const recentTx = (dashboard?.recent_transactions || transactions || []).slice(0, 5);
  const upcomingItems = [
    ...(phase15Summary?.upcoming || []),
    ...(phase16Summary?.upcoming || []),
  ]
    .sort((a, b) => String(a.due_date || "").localeCompare(String(b.due_date || "")))
    .slice(0, 5);

  const members = (governanceMembers || []).slice(0, 5);
  const kpis = [
    { key: "worth", label: t("netWorth"), value: money(netWorth), hint: "↗", icon: "⌁" },
    { key: "income", label: t("monthlyIncome"), value: money(incomeTotal), hint: "+", icon: "↙" },
    { key: "expense", label: t("monthlyExpense"), value: money(expenseTotal), hint: "−", icon: "↗" },
    { key: "wallet", label: t("walletBalance"), value: money(walletBalance), hint: "•", icon: "◇" },
    {
      key: "loan",
      label: t("outstandingLoan"),
      value: money(loanTaken),
      hint: loanTaken > 0 ? t("pending") : t("statusOk"),
      icon: "⇄",
    },
  ];

  return (
    <section className="page active arch-page dash-serenity">
      <div className="dash-hero">
        <div className="dash-hero-copy">
          <p className="dash-hero-kicker">{t("executiveOverview")}</p>
          <h1>{t("familyFinancialPicture")}</h1>
          <p>{t("familyFinancialSub")}</p>
          <div className="dash-hero-pills">
            <span className="dash-pill ok">✓ {t("offlineReady")}</span>
            <span className="dash-pill soft">{activeFamily?.name || t("activeFamily")}</span>
          </div>
        </div>
        <div className="dash-hero-actions">
          <button type="button" className="btn" onClick={() => setActiveMenu("reports")}>
            {t("exportReport")}
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setActiveMenu("transactions")}>
            {t("newTransaction")}
          </button>
        </div>
      </div>

      <div className="kpi-grid dash-kpi-grid">
        {kpis.map((kpi) => (
          <div className={`kpi dash-kpi dash-kpi-${kpi.key}`} key={kpi.key}>
            <div className="kpi-top">
              <div className="kpi-icon">{kpi.icon}</div>
              <div className="kpi-change">{kpi.hint}</div>
            </div>
            <div className="kpi-value">{kpi.value}</div>
            <div className="kpi-label">{kpi.label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-12">
        <div className="card span-8 dash-panel dash-panel-chart">
          <div className="card-head">
            <div>
              <div className="card-title">{t("incomeVsExpense")}</div>
              <div className="card-sub">{t("last7MonthsTrend")}</div>
            </div>
            <div className="chart-legend">
              <span className="chart-legend-item">
                <i className="legend-dot legend-income" aria-hidden="true" />
                {t("income")}
              </span>
              <span className="chart-legend-item">
                <i className="legend-dot legend-expense" aria-hidden="true" />
                {t("expense")}
              </span>
            </div>
          </div>
          <div className="card-body">
            <div className="chart-area">
              <div className="chart-grid" aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
                <span />
              </div>
              <svg className="chart-svg" viewBox="0 0 700 210" preserveAspectRatio="none" aria-label="Income expense chart">
                <polyline
                  fill="none"
                  stroke="#0d9488"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points={incomePoints}
                />
                <polyline
                  fill="none"
                  stroke="#ea580c"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points={expensePoints}
                />
              </svg>
              <div className="chart-labels">
                {monthSeries.map((m) => (
                  <span key={m.key}>{m.label}</span>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="card span-4 dash-panel dash-panel-assets">
          <div className="card-head">
            <div>
              <div className="card-title">{t("assetDistribution")}</div>
              <div className="card-sub">{t("assetGroupSub")}</div>
            </div>
            <button type="button" className="card-link" onClick={() => setActiveMenu("reports")}>
              {t("details")}
            </button>
          </div>
          <div className="card-body">
            <div className="donut-wrap">
              <div className="donut" style={{ background: `conic-gradient(${donutGradient})` }}>
                <div className="donut-center">
                  <strong>{money(assetTotal || netWorth)}</strong>
                  <span>{t("totalAssets")}</span>
                </div>
              </div>
              <div className="donut-list">
                {assets.map((slice) => (
                  <div className="donut-row" key={slice.label}>
                    <span>
                      <i className="dash-swatch" style={{ background: slice.color }} />
                      {slice.label}
                    </span>
                    <b>{digits(Math.round(slice.pct))}%</b>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="card span-4 dash-panel dash-panel-quick">
          <div className="card-head">
            <div>
              <div className="card-title">{t("quickWork")}</div>
              <div className="card-sub">{t("mostUsedActions")}</div>
            </div>
          </div>
          <div className="card-body">
            <div className="quick-grid dash-quick-grid">
              <button type="button" className="quick dash-quick income" onClick={() => setActiveMenu("transactions")}>
                <div className="quick-icon">↙</div>
                <div className="quick-label">{t("income")}</div>
              </button>
              <button type="button" className="quick dash-quick expense" onClick={() => setActiveMenu("transactions")}>
                <div className="quick-icon">↗</div>
                <div className="quick-label">{t("expense")}</div>
              </button>
              <button type="button" className="quick dash-quick transfer" onClick={() => setActiveMenu("transactions")}>
                <div className="quick-icon">⇄</div>
                <div className="quick-label">{t("transfer")}</div>
              </button>
              <button type="button" className="quick dash-quick invite" onClick={() => setActiveMenu("family")}>
                <div className="quick-icon">＋</div>
                <div className="quick-label">{t("invite")}</div>
              </button>
            </div>
          </div>
        </div>

        <div className="card span-4 dash-panel dash-panel-budget">
          <div className="card-head">
            <div>
              <div className="card-title">{t("budgetStatus")}</div>
              <div className="card-sub">{t("monthUtilization")}</div>
            </div>
            <button type="button" className="card-link" onClick={() => setActiveMenu("budgets")}>
              {t("details")}
            </button>
          </div>
          <div className="card-body">
            <div className="budget-list">
              {budgetRows.length === 0 ? (
                <EmptyState label={`${t("budgets")}: ${digits(budgetSummary?.()?.activeCount || 0)}`} />
              ) : (
                budgetRows.map((row) => (
                  <div key={row.id} className="dash-budget-row">
                    <div className="budget-row-top">
                      <div className="budget-name">{row.name}</div>
                      <div className="budget-amount">
                        <MoneyPill tone="expense">{money(row.spent)}</MoneyPill>
                        <span>/</span>
                        <MoneyPill>{money(row.limit)}</MoneyPill>
                      </div>
                    </div>
                    <div className={`progress ${row.danger ? "danger" : row.warn ? "warn" : ""}`}>
                      <span style={{ width: `${row.used}%` }} />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="card span-4 dash-panel dash-panel-sync">
          <div className="card-head">
            <div>
              <div className="card-title">{t("offlineSync")}</div>
              <div className="card-sub">{t("deviceQueueStatus")}</div>
            </div>
            <button type="button" className="card-link" onClick={() => setActiveMenu("sync")}>
              {t("details")}
            </button>
          </div>
          <div className="card-body">
            <div className="sync-card">
              <div
                className={`sync-ring ${syncOk ? "ok" : "warn"}`}
                style={{
                  background: `conic-gradient(${syncOk ? "#0284c7" : "#ea580c"} 0 ${syncHealth}%, #e2e8f0 ${syncHealth}%)`,
                }}
              >
                <span>{digits(syncHealth)}%</span>
              </div>
              <div className="sync-info">
                <h4>{syncOk ? t("systemNormal") : t("syncQueueActive")}</h4>
                <p>
                  {t("lastSync")}: {activeFamily?.name || "—"}
                </p>
                <div className="sync-meta">
                  <span className="tag">{t("pending")} {digits(pendingSync)}</span>
                  <span className="tag">{t("failed")} {digits(failedSync)}</span>
                  <span className="tag">
                    {t("unread")} {digits(notificationSummary?.unread_count || 0)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="card span-8 dash-panel dash-panel-tx">
          <div className="card-head">
            <div>
              <div className="card-title">{t("recentTransactions")}</div>
              <div className="card-sub">{t("controlCenter")}</div>
            </div>
            <button type="button" className="card-link" onClick={() => setActiveMenu("transactions")}>
              {t("navAllTransactions")}
            </button>
          </div>
          <div className="card-body">
            {recentTx.length === 0 ? (
              <EmptyState label={t("noTransactionsFound")} />
            ) : (
              <div className="finance-feed dash-tx-feed">
                {recentTx.map((tx) => {
                  const type = String(tx.transaction_type || tx.type || "").toUpperCase();
                  const tone = typeTone(type);
                  const plus = tone === "income";
                  const minus = tone === "expense";
                  const pending = String(tx.sync_status || tx.status || "")
                    .toLowerCase()
                    .includes("pending");
                  return (
                    <div className={`finance-card tx-card is-${tone}`} key={tx.id}>
                      <div className="tx-row">
                        <div className="tx-row-type">
                          <TypeChip type={type} />
                        </div>
                        <div className="tx-row-copy">
                          <strong>{tx.description || tx.title || type || "—"}</strong>
                          <span className="tx-row-sub">
                            {walletName(wallets, tx.account_id || tx.from_account_id)} ·{" "}
                            {String(tx.created_at || tx.date || "").slice(0, 10) || "—"} ·{" "}
                            {pending ? t("pendingSyncLabel") : t("synced")}
                          </span>
                        </div>
                        <div className="tx-row-amount">
                          <MoneyPill tone={tone} signed={plus ? "+" : minus ? "-" : ""}>
                            {money(tx.amount, tx.currency)}
                          </MoneyPill>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="card span-4 dash-panel dash-panel-due">
          <div className="card-head">
            <div>
              <div className="card-title">{t("upcomingDue")}</div>
              <div className="card-sub">{t("upcomingDueSub")}</div>
            </div>
          </div>
          <div className="card-body">
            <div className="due-list">
              {upcomingItems.length === 0 ? (
                <EmptyState label={t("noUpcomingDue")} />
              ) : (
                upcomingItems.map((item) => (
                  <div className="due-row" key={`${item.module_type}-${item.id}`}>
                    <div className="due-icon">⏱</div>
                    <div className="due-info">
                      <div className="due-name">
                        {moduleLabel(item.module_type, t)} · {item.name}
                      </div>
                      <div className="due-date">{item.due_date || t("noDate")}</div>
                    </div>
                    <div className="due-amount">{money(item.amount, item.currency)}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="card span-6 dash-panel dash-panel-family">
          <div className="card-head">
            <div>
              <div className="card-title">{t("navFamilyGov")}</div>
              <div className="card-sub">{t("familyGovSub")}</div>
            </div>
            <button type="button" className="card-link" onClick={() => setActiveMenu("family")}>
              {t("manage")}
            </button>
          </div>
          <div className="card-body">
            <div className="member-list">
              {members.length === 0 ? (
                <div className="member-row">
                  <div className="member-avatar">SO</div>
                  <div className="member-info">
                    <div className="member-name">{activeFamily?.name || t("ownerFullAccess")}</div>
                    <div className="member-role">
                      {t("ownerAudit")} {digits(auditSummary?.total_count || 0)}
                    </div>
                  </div>
                </div>
              ) : (
                members.map((member) => {
                  const idValue = member.user_id || member.member_user_id || member.id;
                  const role = String(member.normalized_role || member.role || "MEMBER").toUpperCase();
                  const name = memberDisplayName(member, t);
                  const showId = /^[0-9a-f-]{20,}$/i.test(String(name));
                  return (
                    <div className="member-row" key={member.member_id || idValue}>
                      <div className="member-avatar">{memberInitials(member, t)}</div>
                      <div className="member-info">
                        <div className="member-name">
                          {showId
                            ? member.relationship_display_label || member.relationship || t("member")
                            : name}
                        </div>
                        <div className="member-role">
                          <TypeChip type={role.includes("OWNER") ? "SAVINGS" : "TRANSFER"}>{role}</TypeChip>
                          {idValue ? <span className="member-id">{shortId(idValue)}</span> : null}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <div className="card span-6 dash-panel dash-panel-modules">
          <div className="card-head">
            <div>
              <div className="card-title">{t("allModules")}</div>
              <div className="card-sub">{t("allModulesSub")}</div>
            </div>
            <button type="button" className="card-link" onClick={() => setActiveMenu("grocery")}>
              {t("openAll")}
            </button>
          </div>
          <div className="card-body">
            <div className="quick-grid dash-module-grid">
              <button type="button" className="quick dash-mod grocery" onClick={() => setActiveMenu("grocery")}>
                <div className="quick-icon">▣</div>
                <div className="quick-label">{t("groceryTitle")}</div>
              </button>
              <button type="button" className="quick dash-mod loans" onClick={() => setActiveMenu("loans")}>
                <div className="quick-icon">⇄</div>
                <div className="quick-label">{t("loans")}</div>
              </button>
              <button type="button" className="quick dash-mod invest" onClick={() => setActiveMenu("phase15")}>
                <div className="quick-icon">📈</div>
                <div className="quick-label">{t("navInvestments")}</div>
              </button>
              <button type="button" className="quick dash-mod docs" onClick={() => setActiveMenu("phase16")}>
                <div className="quick-icon">▤</div>
                <div className="quick-label">{t("navDocumentVault")}</div>
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
