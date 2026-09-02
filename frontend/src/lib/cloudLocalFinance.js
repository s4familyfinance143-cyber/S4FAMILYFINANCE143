export const DEFAULT_CLOUD_CATEGORIES = [
  { id: "cat_exp_food", name: "Food & Grocery", category_type: "EXPENSE" },
  { id: "cat_exp_bills", name: "Bills", category_type: "EXPENSE" },
  { id: "cat_exp_other", name: "Other expense", category_type: "EXPENSE" },
  { id: "cat_inc_salary", name: "Salary / Income", category_type: "INCOME" },
  { id: "cat_inc_other", name: "Other income", category_type: "INCOME" },
];

export function walletBalance(w) {
  return Number(w?.balance ?? w?.current_balance ?? 0);
}

export function applyWalletBalances(wallets, txForm) {
  const amount = Number(txForm.amount) || 0;
  const type = String(txForm.type || "expense").toLowerCase();
  return wallets.map((w) => {
    const id = w.id;
    let bal = walletBalance(w);
    if (type === "income" && id === txForm.account_id) bal += amount;
    if (type === "expense" && id === txForm.account_id) bal -= amount;
    if (type === "transfer") {
      if (id === txForm.account_id) bal -= amount;
      if (id === txForm.to_account_id) bal += amount;
    }
    return { ...w, balance: bal, current_balance: bal };
  });
}

export function buildLocalTransaction({ familyId, txForm, currency }) {
  const type = String(txForm.type || "expense").toLowerCase();
  const txType = type === "transfer" ? "TRANSFER" : type.toUpperCase();
  return {
    id: `tx_${Date.now()}`,
    family_id: familyId,
    account_id: txForm.account_id,
    from_account_id: txForm.account_id,
    to_account_id: txForm.to_account_id || null,
    category_id: txForm.category_id || null,
    type: txType,
    transaction_type: txType,
    amount: Number(txForm.amount),
    currency: currency || "BDT",
    description: txForm.description || "",
    transaction_date: new Date().toISOString().slice(0, 10),
    created_at: new Date().toISOString(),
    source: "cloud_local",
  };
}
