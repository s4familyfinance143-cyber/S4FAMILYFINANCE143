export const DEFAULT_CLOUD_CATEGORIES = [
  { id: "cat_exp_food", name: "Food & Grocery", category_type: "EXPENSE" },
  { id: "cat_exp_bills", name: "Bills", category_type: "EXPENSE" },
  { id: "cat_exp_other", name: "Other expense", category_type: "EXPENSE" },
  { id: "cat_inc_salary", name: "Salary / Income", category_type: "INCOME" },
  { id: "cat_inc_other", name: "Other income", category_type: "INCOME" },
];

function newId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

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
    id: newId("tx"),
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

export function buildLocalSavingsGoal({ familyId, form, currency }) {
  const target = Number(form.target_amount) || 0;
  return {
    id: newId("sav"),
    family_id: familyId,
    wallet_account_id: form.wallet_account_id,
    name: String(form.name || "").trim(),
    goal_type: form.goal_type || "GENERAL",
    target_amount: target,
    current_amount: 0,
    saved_amount: 0,
    currency: currency || "BDT",
    note: form.note || "",
    status: "ACTIVE",
    created_at: new Date().toISOString(),
    source: "cloud_local",
  };
}

export function buildLocalLoan({ familyId, form, currency }) {
  const principal = Number(form.principal_amount) || 0;
  return {
    id: newId("loan"),
    family_id: familyId,
    wallet_account_id: form.wallet_account_id,
    loan_type: form.loan_type || "GIVEN",
    person_name: String(form.person_name || "").trim(),
    principal_amount: principal,
    remaining_amount: principal,
    paid_amount: 0,
    currency: currency || "BDT",
    note: form.note || "",
    interest_rate: Number(form.interest_rate || 0),
    interest_type: form.interest_type || "NONE",
    installment_count: form.installment_count ? Number(form.installment_count) : null,
    start_date: form.start_date || null,
    status: "ACTIVE",
    created_at: new Date().toISOString(),
    source: "cloud_local",
  };
}

export function buildLocalBudget({ familyId, form, currency }) {
  return {
    id: newId("bud"),
    family_id: familyId,
    category_id: form.category_id,
    name: String(form.name || "").trim(),
    budget_amount: Number(form.budget_amount) || 0,
    spent_amount: 0,
    currency: currency || "BDT",
    period_type: form.period_type || "MONTHLY",
    note: form.note || "",
    status: "ACTIVE",
    created_at: new Date().toISOString(),
    source: "cloud_local",
  };
}

export function buildLocalGoal({ familyId, form, currency }) {
  return {
    id: newId("goal"),
    family_id: familyId,
    linked_savings_goal_id: null,
    goal_name: String(form.goal_name || "").trim(),
    name: String(form.goal_name || "").trim(),
    goal_type: form.goal_type || "GENERAL",
    target_amount: Number(form.target_amount) || 0,
    current_amount: 0,
    currency: currency || "BDT",
    target_date: form.target_date || null,
    note: form.note || "",
    status: "ACTIVE",
    created_at: new Date().toISOString(),
    source: "cloud_local",
  };
}

export function buildLocalRecurring({ familyId, form, currency }) {
  return {
    id: newId("rec"),
    family_id: familyId,
    account_id: form.account_id,
    category_id: form.category_id || null,
    title: String(form.title || "").trim(),
    amount: Number(form.amount) || 0,
    currency: currency || "BDT",
    frequency: form.frequency || "MONTHLY",
    transaction_type: form.transaction_type || form.type || "EXPENSE",
    end_date: form.end_date || null,
    description: form.description || "",
    status: "ACTIVE",
    created_at: new Date().toISOString(),
    source: "cloud_local",
  };
}
