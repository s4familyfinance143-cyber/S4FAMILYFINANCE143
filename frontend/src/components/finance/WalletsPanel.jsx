import { MoneyPill, TypeChip } from "../ui/FinanceChips";

const ACCOUNT_TYPES = [
  ["CASH", "cash"],
  ["BANK", "bank"],
  ["BKASH", "bkash"],
  ["NAGAD", "nagad"],
  ["ROCKET", "rocket"],
  ["MOBILE", "mobileBanking"],
  ["CARD", "card"],
  ["GOLD", "gold"],
  ["ASSET", "asset"],
  ["SAVINGS", "savings"],
];

function typeLabel(t, code) {
  const row = ACCOUNT_TYPES.find(([c]) => c === code);
  if (!row) return code;
  const key = row[1];
  const translated = t(key);
  if (translated && translated !== key) return translated;
  if (code === "BKASH") return "bKash";
  if (code === "NAGAD") return "Nagad";
  if (code === "ROCKET") return "Rocket";
  return code;
}

export function WalletsPanel({
  t,
  money,
  wallets = [],
  walletForm,
  setWalletForm,
  editingWalletId = "",
  onCreate,
  onSaveEdit,
  onStartEdit,
  onCancelEdit,
  onDelete,
  onRefresh,
  busyId = "",
}) {
  const activeWallets = (wallets || []).filter(
    (w) => !w?.deleted_at && w?.is_active !== false,
  );
  const totalBalance = activeWallets.reduce(
    (sum, wallet) => sum + Number(wallet.current_balance ?? wallet.balance ?? 0),
    0,
  );
  const byType = activeWallets.reduce((acc, wallet) => {
    const key = wallet.account_type || "OTHER";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const isEditing = Boolean(editingWalletId);
  const metrics = [
    {
      key: "wallets",
      label: t("wallets"),
      value: String(activeWallets.length),
      hint: t("totalWallets"),
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
          <h4>{isEditing ? t("editWallet") : t("createWallet")}</h4>
          <div className="finance-form">
            <input
              placeholder={t("walletName")}
              value={walletForm.name || ""}
              onChange={(e) => setWalletForm({ ...walletForm, name: e.target.value })}
              aria-label={t("walletName")}
            />
            <select
              value={walletForm.account_type || "CASH"}
              onChange={(e) => setWalletForm({ ...walletForm, account_type: e.target.value })}
              aria-label={t("accountType") || "Account type"}
            >
              {ACCOUNT_TYPES.map(([code]) => (
                <option key={code} value={code}>
                  {typeLabel(t, code)}
                </option>
              ))}
            </select>
            {!isEditing ? (
              <input
                placeholder={t("openingBalance")}
                value={walletForm.opening_balance ?? "0"}
                onChange={(e) => setWalletForm({ ...walletForm, opening_balance: e.target.value })}
                aria-label={t("openingBalance")}
              />
            ) : null}
            <label className="wallet-flag-row">
              <input
                type="checkbox"
                checked={Boolean(walletForm.is_shared_family)}
                onChange={(e) =>
                  setWalletForm({ ...walletForm, is_shared_family: e.target.checked })
                }
              />
              <span>{t("sharedFamilyWallet")}</span>
            </label>
            <label className="wallet-flag-row">
              <input
                type="checkbox"
                checked={Boolean(walletForm.is_owner_wallet)}
                onChange={(e) =>
                  setWalletForm({ ...walletForm, is_owner_wallet: e.target.checked })
                }
              />
              <span>{t("ownerOnlyWallet")}</span>
            </label>
            <p className="settings-empty" style={{ marginTop: 0 }}>
              {t("walletFlagHint") || "Tags for family view — data still syncs with the family cloud snapshot."}
            </p>
            {isEditing ? (
              <div className="wallet-form-actions">
                <button type="button" className="btn btn-primary" onClick={onSaveEdit} disabled={Boolean(busyId)}>
                  {t("saveWallet") || t("save") || "Save"}
                </button>
                <button type="button" className="btn" onClick={onCancelEdit} disabled={Boolean(busyId)}>
                  {t("cancel")}
                </button>
              </div>
            ) : (
              <button type="button" className="btn btn-primary" onClick={onCreate} disabled={Boolean(busyId)}>
                {t("createWallet")}
              </button>
            )}
          </div>
        </div>

        <div className="settings-block">
          <h4>{t("wallets")}</h4>
          {activeWallets.length === 0 ? (
            <p className="settings-empty">{t("noWalletsYet")}</p>
          ) : (
            <div className="finance-feed">
              {activeWallets.map((wallet) => {
                const busy = String(busyId) === String(wallet.id);
                return (
                  <div className="finance-card finance-card-stack" key={wallet.id}>
                    <div className="finance-card-top">
                      <div className="finance-card-main">
                        <div className="audit-feed-tags">
                          <TypeChip type={wallet.account_type || "ACCOUNT"} />
                          <TypeChip type="TRANSFER">{wallet.currency || "BDT"}</TypeChip>
                          {wallet.is_shared_family ? (
                            <TypeChip type="SHARED">{t("sharedShort") || "Shared"}</TypeChip>
                          ) : null}
                          {wallet.is_owner_wallet ? (
                            <TypeChip type="OWNER">{t("ownerShort") || "Owner"}</TypeChip>
                          ) : null}
                        </div>
                        <strong>{wallet.name}</strong>
                        <p>{typeLabel(t, wallet.account_type || "CASH")}</p>
                      </div>
                      <MoneyPill>
                        {money(wallet.current_balance ?? wallet.balance, wallet.currency)}
                      </MoneyPill>
                    </div>
                    <div className="wallet-card-actions">
                      <button
                        type="button"
                        className="btn"
                        disabled={busy}
                        onClick={() => onStartEdit?.(wallet)}
                      >
                        {t("edit")}
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger"
                        disabled={busy}
                        onClick={() => onDelete?.(wallet)}
                      >
                        {busy ? t("loading") : t("delete") || "Delete"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
