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

  return (
    <section className="panel settings-panel settings-smart finance-smart">
      <div className="settings-head">
        <div>
          <p className="settings-kicker">{t("wallets")}</p>
          <h2>{t("wallets")}</h2>
        </div>
        <button type="button" className="btn" onClick={onRefresh}>
          {t("refreshWallets")}
        </button>
      </div>

      <div className="settings-identity">
        <div className="sync-health ok">
          <strong>{wallets.length}</strong>
          <span>{t("wallets")}</span>
        </div>
        <div className="settings-identity-copy">
          <h3 className="hero-money">{money(totalBalance)}</h3>
          <p>{t("walletBalance")}</p>
          <div className="settings-badges">
            {Object.entries(byType).map(([type, count]) => (
              <TypeChip type={type} key={type}>
                {type}: {count}
              </TypeChip>
            ))}
            {!wallets.length ? <TypeChip type="PENDING">{t("wallets")}: 0</TypeChip> : null}
          </div>
        </div>
      </div>

      <div className="settings-stat-row">
        <div className="settings-stat">
          <span>{t("wallets")}</span>
          <strong>{wallets.length}</strong>
        </div>
        <div className="settings-stat">
          <span>{t("walletBalance")}</span>
          <strong>{money(totalBalance)}</strong>
        </div>
        <div className="settings-stat">
          <span>{t("cash")}</span>
          <strong>{byType.CASH || 0}</strong>
        </div>
        <div className="settings-stat">
          <span>{t("bank")}</span>
          <strong>{byType.BANK || 0}</strong>
        </div>
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
              <option value="CARD">Card</option>
              <option value="GOLD">Gold</option>
              <option value="ASSET">Asset</option>
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
            <p className="settings-empty">{t("wallets")}: 0</p>
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
