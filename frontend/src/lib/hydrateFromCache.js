import { loadOfflineSnapshot } from "./offlineCache";

const SNAPSHOT_KEYS = [
  ["finance", "wallets"],
  ["finance", "categories"],
  ["finance", "transactions"],
  ["finance", "savings"],
  ["finance", "loans"],
  ["finance", "budgets"],
  ["finance", "recurring"],
  ["finance", "goals"],
  ["finance", "goalSummary"],
  ["life", "phase15"],
  ["life", "phase16"],
  ["zakat", "main"],
  ["zakat", "summary"],
  ["reports", "overview"],
  ["system", "currency"],
  ["system", "backup"],
];

export async function hydrateFamilyFromOfflineCache(familyId) {
  if (!familyId) return {};
  const out = {};
  await Promise.all(
    SNAPSHOT_KEYS.map(async ([module, name]) => {
      try {
        const row = await loadOfflineSnapshot(familyId, module, name);
        if (row?.data !== undefined) {
          out[`${module}/${name}`] = row.data;
        }
      } catch {
        /* ignore missing snapshot */
      }
    }),
  );
  return out;
}

/** Minimal dashboard shape from cached finance snapshots. */
export function buildDashboardFromCache(cache) {
  const walletsRaw = Array.isArray(cache["finance/wallets"]) ? cache["finance/wallets"] : [];
  const wallets = walletsRaw.filter((w) => !w?.deleted_at && w?.is_active !== false);
  const transactionsRaw = Array.isArray(cache["finance/transactions"]) ? cache["finance/transactions"] : [];
  const transactions = transactionsRaw.filter((t) => String(t?.status || "").toUpperCase() !== "VOID");
  const walletBalance = wallets.reduce((sum, w) => sum + Number(w.balance || w.current_balance || 0), 0);
  const income = transactions
    .filter((t) => String(t.type || t.transaction_type || "").toUpperCase().includes("INCOME"))
    .reduce((s, t) => s + Number(t.amount || 0), 0);
  const expense = transactions
    .filter((t) => String(t.type || t.transaction_type || "").toUpperCase().includes("EXPENSE"))
    .reduce((s, t) => s + Number(t.amount || 0), 0);
  const recent = [...transactions]
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
    .slice(0, 8);

  return {
    source: "offline_cache",
    // Flat fields (legacy / reports)
    wallet_balance: walletBalance,
    total_income: income,
    total_expense: expense,
    net_worth: walletBalance,
    transaction_count: transactions.length,
    wallet_count: wallets.length,
    recent_transactions: recent,
    // Nested summary — ExecutiveDashboard reads these
    summary: {
      total_wallet_balance: walletBalance,
      total_income: income,
      total_expense: expense,
      net_worth: walletBalance,
      wallet_count: wallets.length,
      transaction_count: transactions.length,
    },
  };
}
