import "./dashboard-mobile-onescreen.css";

function formatBalance(digits, value) {
  const n = Number(value || 0);
  const formatted = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(Math.abs(n));
  return digits(formatted);
}

function moneyText(digits, value, mark, hide) {
  if (hide) return "••••";
  if (/^[A-Z]{3}$/.test(String(mark))) {
    return `${mark} ${formatBalance(digits, value)}`;
  }
  return `${mark}${formatBalance(digits, value)}`;
}


/** Mobile onescreen — same summary metrics as PC balance card */
export function MobileDashboardOnescreen({
  t,
  digits,
  appLanguage = "bn",
  activeFamily: _activeFamily,
  walletBalance = 0,
  incomeTotal = 0,
  expenseTotal = 0,
  netSavings = 0,
  deltaPct = 0,
  deltaUp = true,
  hideBalance = false,
  setHideBalance,
  setActiveMenu,
  mark = "৳",
  syncStatus = null,
}) {
  const pending = Number(syncStatus?.pending_outbox || 0);
  const online = typeof navigator === "undefined" ? true : navigator.onLine !== false;
  const syncState = !online ? "offline" : pending > 0 ? "pending" : "ok";

  const bn = appLanguage === "bn";
  const syncText =
    syncState === "offline"
      ? t("offlineReady")
      : syncState === "pending"
        ? `${t("groceryPendingSync")} · ${digits(pending)} ${t("pending")}`
        : bn
          ? "সব ডেটা সিঙ্ক হয়েছে · সর্বশেষ এখনই"
          : t("syncAllOk");

  const tiles = [
    { menu: "wallets", label: bn ? "ওয়ালেট" : t("wallets"), icon: "💳", tone: "green" },
    { menu: "transactions", label: bn ? "লেনদেন" : t("transactions"), icon: "⇄", tone: "red" },
    { menu: "grocery", label: bn ? "বাজার তালিকা" : t("groceryTitle"), icon: "🛒", tone: "purple" },
    { menu: "savings", label: bn ? "সেভিংস" : t("savings"), icon: "◎", tone: "teal" },
    { menu: "budgets", label: bn ? "বাজেট" : t("budgets"), icon: "⚡", tone: "blue" },
    { menu: "phase15:INVESTMENT", label: bn ? "বিনিয়োগ" : t("navInvestments"), icon: "📈", tone: "orange" },
    { menu: "loans", label: bn ? "ঋণ / দেনা" : t("navLoanDebt"), icon: "💸", tone: "red" },
    { menu: "phase16:DOCUMENT", label: bn ? "ডকুমেন্ট" : t("navDocumentVault"), icon: "📂", tone: "green" },
    { menu: "zakat", label: bn ? "যাকাত" : t("navZakat"), icon: "🕌", tone: "purple" },
    { menu: "phase16:PROPERTY", label: bn ? "সম্পত্তি" : t("navProperty"), icon: "🏠", tone: "teal" },
    { menu: "family", label: bn ? "সদস্য" : t("family"), icon: "👪", tone: "blue" },
    { menu: "settings", label: bn ? "সেটিংস" : t("settings"), icon: "⚙", tone: "orange" },
  ];

  const balanceText = moneyText(digits, walletBalance, mark, hideBalance);
  const deltaAbs = Math.abs(Number(deltaPct) || 0);

  return (
    <div className="m1-dash" aria-label={t("dashboard")}>
      <header className="m1-hero">
        {/* Compact PC-parity balance card only — no green surround */}
        <div className="m1-balance-card">
          <div className="m1-balance-card-accent" aria-hidden="true" />
          <div className="m1-balance-top">
            <div className="m1-balance-label-row">
              <span className="m1-balance-label">{t("totalFamilyBalance")}</span>
              <div className="m1-balance-actions">
                <button
                  type="button"
                  className="m1-eye"
                  onClick={() => setHideBalance((v) => !v)}
                  aria-label="Toggle balance"
                >
                  👁
                </button>
                <button
                  type="button"
                  className="m1-more"
                  onClick={() => setActiveMenu("reports")}
                  aria-label="More"
                >
                  ⋯
                </button>
              </div>
            </div>
            <div className="m1-balance-value">{balanceText}</div>
            <div className={`m1-balance-delta ${deltaUp ? "up" : "down"}`}>
              {deltaUp ? "↑" : "↓"} {digits(String(deltaAbs))}% {t("thisMonthDelta")}
            </div>
          </div>

          <div className="m1-balance-rows">
            <div className="m1-balance-col income">
              <div className="m1-balance-col-label">
                <span className="m1-dot" aria-hidden="true" />
                {t("totalIncome")}
              </div>
              <div className="m1-balance-col-value">
                {moneyText(digits, incomeTotal, mark, hideBalance)}
              </div>
            </div>
            <div className="m1-balance-col expense">
              <div className="m1-balance-col-label">
                <span className="m1-dot" aria-hidden="true" />
                {t("totalExpense")}
              </div>
              <div className="m1-balance-col-value">
                {moneyText(digits, expenseTotal, mark, hideBalance)}
              </div>
            </div>
            <div className="m1-balance-col savings">
              <div className="m1-balance-col-label">
                <span className="m1-dot" aria-hidden="true" />
                {t("netSavings")}
              </div>
              <div className="m1-balance-col-value">
                {moneyText(digits, netSavings, mark, hideBalance)}
              </div>
            </div>
          </div>
        </div>
      </header>

      <section className="m1-sheet">
        <div className="m1-grid" role="navigation" aria-label={t("dashboard")}>
          {tiles.map((tile) => (
            <button
              key={tile.menu}
              type="button"
              className="m1-tile"
              data-tone={tile.tone}
              onClick={() => setActiveMenu(tile.menu)}
            >
              <span className="m1-tile-icon" aria-hidden="true">
                {tile.icon}
              </span>
              <span className="m1-tile-label">{tile.label}</span>
            </button>
          ))}
        </div>

        <button
          type="button"
          className="m1-sync"
          data-state={syncState}
          onClick={() => setActiveMenu("sync")}
        >
          <span className="m1-sync-dot" aria-hidden="true" />
          <span className="m1-sync-copy">{syncText}</span>
        </button>
      </section>
    </div>
  );
}
