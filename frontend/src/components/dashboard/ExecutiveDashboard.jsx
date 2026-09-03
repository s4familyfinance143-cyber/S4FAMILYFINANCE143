import { useMemo, useState } from "react";

function EmptyState({ label }) {
  return <div className="empty">{label}</div>;
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
  return (
    String(label)
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0] || "")
      .join("")
      .toUpperCase() || "M"
  );
}

function taka(digits, value) {
  const n = Number(value || 0);
  const formatted = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(Math.abs(n));
  return digits(formatted);
}

function spendBuckets(transactions, categories, t) {
  const nameById = Object.fromEntries((categories || []).map((c) => [String(c.id), c.name || c.name_en || ""]));
  const rows = [
    { key: "food", label: t("spendFood"), color: "var(--sage)", re: /food|grocery|grocer|বাজার|খাবার|খাদ্য/i, value: 0 },
    { key: "transport", label: t("spendTransport"), color: "var(--navy)", re: /transport|taxi|uber|bus|fuel|যাতা|গাড়ি|petrol/i, value: 0 },
    { key: "shopping", label: t("spendShopping"), color: "var(--gold)", re: /shop|market|amazon|clothing|কেনা/i, value: 0 },
    { key: "bills", label: t("spendBills"), color: "var(--rust)", re: /bill|utility|electric|rent|gas|water|বিল/i, value: 0 },
    { key: "others", label: t("spendOthers"), color: "var(--moss)", re: /.*/, value: 0 },
  ];
  for (const tx of transactions || []) {
    if (String(tx.transaction_type || "").toUpperCase() !== "EXPENSE") continue;
    const amount = Number(tx.amount || 0);
    const blob = `${tx.description || ""} ${tx.title || ""} ${tx.category_name || ""} ${nameById[String(tx.category_id)] || ""}`;
    const hit = rows.find((row) => row.key !== "others" && row.re.test(blob));
    (hit || rows[4]).value += amount;
  }
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  if (total <= 0) {
    return {
      total: 0,
      rows: rows.map((row) => ({ ...row, pct: 0 })),
    };
  }
  return {
    total,
    rows: rows.map((row) => ({ ...row, pct: Math.round((row.value / total) * 100) })),
  };
}

function formatTxWhen(raw, t) {
  if (!raw) return t("noDate");
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return String(raw).slice(0, 10);
  const now = new Date();
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  let dayLabel = d.toLocaleDateString();
  if (d.toDateString() === now.toDateString()) dayLabel = t("today");
  else if (d.toDateString() === yest.toDateString()) dayLabel = t("yesterday");
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `${dayLabel} ${time}`;
}

export function ExecutiveDashboard({
  dashboard,
  wallets: _wallets,
  transactions,
  budgets,
  categories = [],
  activeFamily: _activeFamily,
  governanceMembers,
  setActiveMenu,
  budgetSummary,
  money: _money,
  digits,
  t,
  appLanguage = "bn",
}) {
  const [hideBalance, setHideBalance] = useState(false);
  const summary = dashboard?.summary || {};
  const walletBalance = Number(summary.total_wallet_balance || 0);
  const incomeTotal = Number(summary.total_income || 0);
  const expenseTotal = Number(summary.total_expense || 0);
  const netSavings = incomeTotal - expenseTotal;

  const monthSeries = buildMonthSeries(transactions?.length ? transactions : dashboard?.recent_transactions, appLanguage);
  const thisMonth = monthSeries[monthSeries.length - 1];
  const prevMonth = monthSeries[monthSeries.length - 2];
  const thisNet = (thisMonth?.income || 0) - (thisMonth?.expense || 0);
  const prevNet = (prevMonth?.income || 0) - (prevMonth?.expense || 0);
  const deltaPct = prevNet !== 0 ? Math.round(((thisNet - prevNet) / Math.abs(prevNet)) * 10) / 10 : thisNet > 0 ? 100 : 0;
  const deltaUp = deltaPct >= 0;

  const budgetRows = (budgets || []).filter((b) => String(b.status || "").toUpperCase() === "ACTIVE");
  const budgetLimit = budgetRows.reduce((sum, b) => sum + Number(b.budget_amount || 0), 0);
  const budgetSpent = budgetRows.reduce((sum, b) => sum + Number(b.spent_amount || 0), 0);
  const budgetUsedPct =
    budgetLimit > 0
      ? Math.min(100, Math.round((budgetSpent / budgetLimit) * 100))
      : Number(budgetSummary?.()?.usedPercent || 0) || 0;
  const budgetLeft = Math.max(budgetLimit - budgetSpent, 0);

  const spend = useMemo(
    () => spendBuckets(transactions?.length ? transactions : dashboard?.recent_transactions, categories, t),
    [transactions, dashboard?.recent_transactions, categories, t],
  );
  const spendGradient = spend.rows
    .reduce(
      (acc, row) => {
        const start = acc.cursor;
        acc.cursor += row.pct;
        acc.parts.push(`${row.color} ${start}% ${acc.cursor}%`);
        return acc;
      },
      { cursor: 0, parts: [] },
    )
    .parts.join(", ");

  const recentTx = (dashboard?.recent_transactions || transactions || []).slice(0, 3);
  const members = (governanceMembers || []).slice(0, 5);
  const extraMembers = Math.max((governanceMembers || []).length - 4, 0);
  const shownMembers = extraMembers > 0 ? members.slice(0, 4) : members;
  const memberCount = (governanceMembers || []).length || 0;

  return (
    <section className="page active arch-page dash-shoyb">
      <div className="dash-shoyb-grid">
        <div className="balance-card">
          <div className="bc-top">
            <div className="bc-label">
              {t("totalFamilyBalance")}
              <button type="button" className="bc-eye" onClick={() => setHideBalance((v) => !v)} aria-label="Toggle balance">
                👁
              </button>
            </div>
            <button type="button" className="bc-more" onClick={() => setActiveMenu("reports")} aria-label="More">
              ⋯
            </button>
          </div>
          <div className="bc-left">
            <div className="bc-label bc-label-desktop">
              {t("totalFamilyBalance")}
              <button type="button" className="bc-eye" onClick={() => setHideBalance((v) => !v)} aria-label="Toggle balance">
                👁
              </button>
            </div>
            <div className="bc-figure serif">
              <sup>৳</sup>
              {hideBalance ? "••••••" : taka(digits, walletBalance)}
            </div>
            <div className={`bc-delta ${deltaUp ? "" : "down"}`}>
              {deltaUp ? "↑" : "↓"} {digits(String(Math.abs(deltaPct)))}% {t("thisMonthDelta")}
            </div>
          </div>
          <div className="bc-rows">
            <div className="bc-col income">
              <div className="bc-col-label">{t("totalIncome")}</div>
              <div className="bc-col-value">৳{hideBalance ? "••••" : taka(digits, incomeTotal)}</div>
            </div>
            <div className="bc-col expense">
              <div className="bc-col-label">{t("totalExpense")}</div>
              <div className="bc-col-value">৳{hideBalance ? "••••" : taka(digits, expenseTotal)}</div>
            </div>
            <div className="bc-col savings">
              <div className="bc-col-label">{t("netSavings")}</div>
              <div className="bc-col-value">৳{hideBalance ? "••••" : taka(digits, netSavings)}</div>
            </div>
          </div>
        </div>

        <div className="quick-actions mobile-quick-actions">
          <button type="button" className="qa-btn income" onClick={() => setActiveMenu("transactions")}>
            <div className="qa-icon">↓</div>
            <div className="qa-label">{t("addIncome")}</div>
          </button>
          <button type="button" className="qa-btn expense" onClick={() => setActiveMenu("transactions")}>
            <div className="qa-icon">↑</div>
            <div className="qa-label">{t("addExpense")}</div>
          </button>
          <button type="button" className="qa-btn transfer" onClick={() => setActiveMenu("transactions")}>
            <div className="qa-icon">⇄</div>
            <div className="qa-label">{t("transfer")}</div>
          </button>
          <button type="button" className="qa-btn wallet" onClick={() => setActiveMenu("wallets")}>
            <div className="qa-icon">💳</div>
            <div className="qa-label">{t("wallets")}</div>
          </button>
          <button type="button" className="qa-btn more" onClick={() => document.body.classList.toggle("mobile-drawer-open")}>
            <div className="qa-icon">▦</div>
            <div className="qa-label">{t("navMore")}</div>
          </button>
        </div>

        <div className="stats-row">
          <div className="stat-card">
            <div className="stat-head">
              <span className="stat-title">{t("monthlyBudget")}</span>
              <button type="button" className="stat-more" onClick={() => setActiveMenu("budgets")}>
                ⋯
              </button>
            </div>
            <div className="budget-body">
              <div
                className="donut"
                style={{
                  background: `conic-gradient(var(--navy) 0% ${budgetUsedPct}%, var(--surface-alt) ${budgetUsedPct}% 100%)`,
                }}
              >
                <div className="donut-inner">{digits(budgetUsedPct)}%</div>
              </div>
              <div className="budget-figs">
                <div className="bf-row">
                  {t("budgets")}
                  <b>৳{taka(digits, budgetLimit)}</b>
                </div>
                <div className="bf-row" style={{ marginTop: 5 }}>
                  {t("budgetUsed")}
                  <b>৳{taka(digits, budgetSpent)}</b>
                </div>
                <div className="bf-left">
                  ৳{taka(digits, budgetLeft)} {t("budgetLeft")}
                </div>
              </div>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-head">
              <span className="stat-title spend-title-full">{t("spendingOverview")}</span>
              <span className="stat-title spend-title-short">{t("spendingOverview").split(" ")[0]}</span>
              <span className="stat-more">
                {t("thisMonth")} ⌄
              </span>
            </div>
            <div className="spend-body">
              <div
                className="donut spend-total"
                data-empty={spend.total > 0 ? "0" : "1"}
                style={{
                  background:
                    spend.total > 0
                      ? `conic-gradient(${spendGradient})`
                      : "var(--surface-alt)",
                }}
              >
                <div className="donut-inner">৳{taka(digits, spend.total || expenseTotal)}</div>
              </div>
              <div className="spend-legend">
                {spend.rows.map((row) => (
                  <div className="leg-row" key={row.key}>
                    <span className="leg-dot" style={{ background: row.color }} />
                    <span className="leg-name">{row.label}</span>
                    <span className="leg-pct">{digits(row.pct)}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <button type="button" className="family-banner" onClick={() => setActiveMenu("family")}>
          <div className="fb-icon">👪</div>
          <div className="fb-mid">
            <div className="fb-title">{t("familyMembers")}</div>
            <div className="fb-count">
              {digits(memberCount)} {t("membersCount")}
              <span className="fb-count-extra"> · Stay connected with your family</span>
            </div>
          </div>
          <div className="fb-avatars">
            {shownMembers.length === 0 ? (
              <div className="av">S4</div>
            ) : (
              shownMembers.map((member) => (
                <div className="av" key={member.member_id || member.id || member.user_id}>
                  {memberInitials(member, t)}
                </div>
              ))
            )}
            {extraMembers > 0 ? <div className="av">+{digits(extraMembers)}</div> : null}
          </div>
          <div className="fb-arrow">›</div>
        </button>

        <div className="tx-section">
          <div className="tx-head">
            <span className="tx-head-title">{t("recentTransactions")}</span>
            <button type="button" onClick={() => setActiveMenu("transactions")}>
              {t("viewAll")}
            </button>
          </div>
          <div className="ledger">
            {recentTx.length === 0 ? (
              <EmptyState label={t("noTransactionsFound")} />
            ) : (
              recentTx.map((tx) => {
                const type = String(tx.transaction_type || tx.type || "").toUpperCase();
                const plus = type.includes("INCOME");
                return (
                  <button
                    type="button"
                    className="tx-row"
                    key={tx.id}
                    onClick={() => setActiveMenu("transactions")}
                  >
                    <div className={`tx-icon ${plus ? "plus" : "minus"}`}>{plus ? "↓" : "↑"}</div>
                    <div className="tx-mid">
                      <div className="tx-title">{tx.description || tx.title || type || "—"}</div>
                      <div className="tx-meta">
                        {plus ? t("income") : t("expense")} · {formatTxWhen(tx.created_at || tx.date, t)}
                      </div>
                    </div>
                    <div className={`tx-amt ${plus ? "plus" : "minus"}`}>
                      {plus ? "+" : "-"}৳{taka(digits, tx.amount)}
                    </div>
                    <div className="tx-chev">›</div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="quick-panel desktop-quick-panel">
          <div className="stat-title">{t("quickActions")}</div>
          <div className="qa-row">
            <button type="button" className="qa-btn income" onClick={() => setActiveMenu("transactions")}>
              <div className="qa-icon">↓</div>
              <div className="qa-label">{t("addIncome")}</div>
            </button>
            <button type="button" className="qa-btn expense" onClick={() => setActiveMenu("transactions")}>
              <div className="qa-icon">↑</div>
              <div className="qa-label">{t("addExpense")}</div>
            </button>
          </div>
          <div className="qa-row">
            <button type="button" className="qa-btn transfer" onClick={() => setActiveMenu("transactions")}>
              <div className="qa-icon">⇄</div>
              <div className="qa-label">{t("transfer")}</div>
            </button>
            <button type="button" className="qa-btn wallet" onClick={() => setActiveMenu("wallets")}>
              <div className="qa-icon">💳</div>
              <div className="qa-label">{t("wallets")}</div>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
