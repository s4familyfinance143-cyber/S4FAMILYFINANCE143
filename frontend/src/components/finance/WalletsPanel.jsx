import { MoneyPill, TypeChip } from "../ui/FinanceChips";

export function WalletsPanel({
  t,
  money,
  wallets = [],
  walletForm,
  setWalletForm,
  onCreate,
  onRefresh,
}) {
  const totalBalance = wallets.reduce(
    (sum, wallet) => sum + Number(wallet.current_balance ?? wallet.balance ?? 0),
    0
  );
  const byType = wallets.reduce((acc, wallet) => {
    const key = wallet.account_type || "OTHER";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const metrics = [
    {
      key: "wallets",
      label: t("wallets"),
      value: String(wallets.length),
      hint: t("totalWallets") || t("wallets"),
    },
    {
      key: "balance",
      label: t("walletBalance"),
      value: money(totalBalance),
      hint: t("walletBalance"),
    },
    {
      key: "cash",
      label: t("cash"),
      value: String(byType.CASH || 0),
      hint: t("cash"),
    },
    {
      key: "bank",
      label: t("bank"),
      value: String(byType.BANK || 0),
      hint: t("bank"),
    },
  ];

  return (
    <section className="panel settings-panel settings-smart finance-smart wallets-smart">
      <div className="settings-head">
        <div>
          <p className="settings-kicker">{t("wallets")}</p>
          <h2>{t("wallets")}</h2>
        </div>
        <button type="button" className="btn" onClick={onRefresh}>
          {t("refreshWallets")}
        </button>
      </div>

      <div className="summary-metric-grid" role="group" aria-label={t("wallets")}>
        {metrics.map((item) => (
          <div className="summary-metric-card" key={item.key}>
            <span className="summary-metric-label">{item.label}</span>
            <strong className="summary-metric-value">{item.value}</strong>
          </div>
        ))}
      </div>

      <div className="settings-stack">
        <div className="settings-block">
          <h4>{t("createWallet")}</h4>
          <div className="finance-form">
            <input
              placeholder={t("walletName")}
              value={walletForm.name}
              onChange={(e) => setWalletForm({ ...walletForm, name: e.target.value })}
            />
            <select
              value={walletForm.account_type}
              onChange={(e) => setWalletForm({ ...walletForm, account_type: e.target.value })}
            >
              <option value="CASH">{t("cash")}</option>
              <option value="BANK">{t("bank")}</option>
              <option value="BKASH">bKash</option>
              <option value="NAGAD">Nagad</option>
              <option value="ROCKET">Rocket</option>
              <option value="MOBILE">{t("mobileBanking") || "Mobile"}</option>
              <option value="CARD">{t("card") || "Card"}</option>
              <option value="GOLD">{t("gold") || "Gold"}</option>
              <option value="ASSET">{t("asset") || "Asset"}</option>
              <option value="SAVINGS">{t("savings") || "Savings"}</option>
            </select>
            <input
              placeholder={t("openingBalance")}
              value={walletForm.opening_balance}
              onChange={(e) => setWalletForm({ ...walletForm, opening_balance: e.target.value })}
            />
            <button type="button" className="btn btn-primary" onClick={onCreate}>
              {t("createWallet")}
            </button>
          </div>
        </div>

        <div className="settings-block">
          <h4>{t("wallets")}</h4>
          {wallets.length === 0 ? (
            <p className="settings-empty">{t("noWalletsYet") || t("wallets")}</p>
          ) : (
            <div className="finance-feed">
              {wallets.map((wallet) => (
                <div className="finance-card" key={wallet.id}>
                  <div className="finance-card-main">
                    <div className="audit-feed-tags">
                      <TypeChip type={wallet.account_type || "ACCOUNT"} />
                      <TypeChip type="TRANSFER">{wallet.currency || "BDT"}</TypeChip>
                    </div>
                    <strong>{wallet.name}</strong>
                  </div>
                  <MoneyPill>
                    {money(wallet.current_balance || wallet.balance, wallet.currency)}
                  </MoneyPill>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
