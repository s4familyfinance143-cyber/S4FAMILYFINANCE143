export const DEFAULT_CLOUD_CATEGORIES = [
  { id: "cat_exp_food", name: "Food & Grocery", name_en: "Food & Grocery", category_type: "EXPENSE" },
  { id: "cat_exp_bills", name: "Bills", name_en: "Bills", category_type: "EXPENSE" },
  { id: "cat_exp_transport", name: "Transport", name_en: "Transport", category_type: "EXPENSE" },
  { id: "cat_exp_other", name: "Other expense", name_en: "Other expense", category_type: "EXPENSE" },
  { id: "cat_inc_salary", name: "Salary / Income", name_en: "Salary / Income", category_type: "INCOME" },
  { id: "cat_inc_other", name: "Other income", name_en: "Other income", category_type: "INCOME" },
];

function newId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function walletBalance(w) {
  return Number(w?.balance ?? w?.current_balance ?? 0);
}

export function isActiveWallet(w) {
  return Boolean(w) && !w.deleted_at && w.is_active !== false;
}

function txEffectOnWallet(tx, walletId) {
  if (!tx || !walletId) return 0;
  if (String(tx.status || "").toUpperCase() === "VOID") return 0;
  const amount = Number(tx.amount) || 0;
  if (!amount) return 0;
  const type = String(tx.transaction_type || tx.type || "").toUpperCase();
  const fromId = tx.from_account_id || tx.account_id;
  const toId = tx.to_account_id;
  const wid = String(walletId);
  if (type.includes("INCOME") && String(tx.account_id || fromId) === wid) return amount;
  if (type.includes("EXPENSE") && String(tx.account_id || fromId) === wid) return -amount;
  if (type.includes("SAVINGS_DEPOSIT") && String(tx.account_id || fromId) === wid) return -amount;
  if (type.includes("SAVINGS_WITHDRAW") && String(tx.account_id || fromId) === wid) return amount;
  if (type.includes("TRANSFER")) {
    if (String(fromId) === wid) return -amount;
    if (String(toId) === wid) return amount;
  }
  return 0;
}

function ledgerEffectsForWallet(walletId, transactions) {
  return (transactions || []).reduce((sum, tx) => sum + txEffectOnWallet(tx, walletId), 0);
}

/**
 * Source of truth: opening_balance + posted ledger (voids ignored).
 * Fixes multi-device drift from last-write-wins on denormalized balance fields.
 */
export function recomputeWalletBalancesFromLedger(wallets, transactions) {
  const now = new Date().toISOString();
  const txs = Array.isArray(transactions) ? transactions : [];
  return (wallets || []).map((w) => {
    // Soft-deleted wallets: never bump updated_at (prevents delete resurrection via LWW)
    if (!isActiveWallet(w) || w?.deleted_at) {
      return w;
    }
    const effects = ledgerEffectsForWallet(w.id, txs);
    let opening = w.opening_balance;
    if (opening == null || opening === "") {
      // First reconcile: treat current balance as opening BEFORE applying ledger,
      // unless already ledger-sourced (then reverse-infer).
      if (String(w.balance_source || "") === "ledger") {
        opening = walletBalance(w) - effects;
      } else {
        opening = walletBalance(w);
      }
    }
    opening = Number(opening) || 0;
    const bal = opening + effects;
    return {
      ...w,
      opening_balance: opening,
      balance: bal,
      current_balance: bal,
      // Do NOT bump updated_at for derived balances — keeps soft-delete LWW stable
      updated_at: w.updated_at || now,
      balance_source: "ledger",
    };
  });
}

export function applyWalletBalances(wallets, txForm) {
  // Prefer ledger recompute when caller already has full tx list; this incremental
  // path remains for quick UI updates before save.
  const amount = Number(txForm.amount) || 0;
  const type = String(txForm.type || "expense").toLowerCase();
  const now = new Date().toISOString();
  return (wallets || []).map((w) => {
    const id = w.id;
    let bal = walletBalance(w);
    if (type === "income" && id === txForm.account_id) bal += amount;
    if (type === "expense" && id === txForm.account_id) bal -= amount;
    if (type === "transfer") {
      if (id === txForm.account_id) bal -= amount;
      if (id === txForm.to_account_id) bal += amount;
    }
    return { ...w, balance: bal, current_balance: bal, updated_at: now };
  });
}

/** Reverse a posted transaction's effect on wallet balances (for void). */
export function reverseWalletBalances(wallets, tx) {
  const amount = Number(tx?.amount) || 0;
  const type = String(tx?.transaction_type || tx?.type || "").toUpperCase();
  const fromId = tx?.from_account_id || tx?.account_id;
  const toId = tx?.to_account_id;
  const now = new Date().toISOString();
  return (wallets || []).map((w) => {
    let bal = walletBalance(w);
    if (type.includes("INCOME") && w.id === (tx?.account_id || fromId)) bal -= amount;
    else if (type.includes("EXPENSE") && w.id === (tx?.account_id || fromId)) bal += amount;
    else if (type.includes("SAVINGS_DEPOSIT") && w.id === (tx?.account_id || fromId)) bal += amount;
    else if (type.includes("SAVINGS_WITHDRAW") && w.id === (tx?.account_id || fromId)) bal -= amount;
    else if (type.includes("TRANSFER")) {
      if (w.id === fromId) bal += amount;
      if (w.id === toId) bal -= amount;
    }
    return { ...w, balance: bal, current_balance: bal, updated_at: now };
  });
}

export function buildLocalTransaction({ familyId, txForm, currency }) {
  const type = String(txForm.type || "expense").toLowerCase();
  const txType = type === "transfer" ? "TRANSFER" : type.toUpperCase();
  const isSplit = type === "expense" && Boolean(txForm.split_enabled);
  const now = new Date().toISOString();
  return {
    id: newId("tx"),
    family_id: familyId,
    account_id: txForm.account_id,
    from_account_id: txForm.account_id,
    to_account_id: type === "transfer" ? txForm.to_account_id || null : null,
    category_id: type === "transfer" ? null : txForm.category_id || null,
    type: txType,
    transaction_type: txType,
    amount: Number(txForm.amount),
    currency: currency || "BDT",
    description: txForm.description || "",
    transaction_date: now.slice(0, 10),
    created_at: now,
    updated_at: now,
    status: "POSTED",
    is_split: isSplit,
    split_member_a: isSplit ? txForm.split_member_a || null : null,
    split_member_b: isSplit ? txForm.split_member_b || null : null,
    source: "cloud_local",
  };
}

export function sortTransactionsNewestFirst(list) {
  return [...(Array.isArray(list) ? list : [])].sort((a, b) =>
    String(b.created_at || b.transaction_date || "").localeCompare(
      String(a.created_at || a.transaction_date || ""),
    ),
  );
}

export function buildLocalSavingsGoal({ familyId, form, currency }) {
  const target = Number(form.target_amount) || 0;
  const now = new Date().toISOString();
  return {
    id: newId("sav"),
    family_id: familyId,
    wallet_account_id: form.wallet_account_id,
    name: String(form.name || "").trim(),
    goal_type: form.goal_type || "GENERAL",
    target_amount: target,
    current_amount: 0,
    saved_amount: 0,
    progress_percent: 0,
    currency: currency || "BDT",
    note: form.note || "",
    status: "ACTIVE",
    created_at: now,
    updated_at: now,
    source: "cloud_local",
  };
}

export function enrichSavingsGoals(list) {
  return (list || []).map((g) => {
    const target = Number(g.target_amount || 0);
    const current = Number(g.current_amount ?? g.saved_amount ?? 0);
    const progress = target > 0 ? Math.round((current / target) * 1000) / 10 : 0;
    return {
      ...g,
      current_amount: current,
      saved_amount: current,
      progress_percent: progress,
    };
  });
}

export function normalizeSavingsList(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.data)) return raw.data;
  if (raw && Array.isArray(raw.savings)) return raw.savings;
  if (raw && Array.isArray(raw.goals)) return raw.goals;
  return [];
}

export function buildSavingsMovementTx({
  familyId,
  goal,
  walletId,
  amount,
  currency,
  action,
  description = "",
}) {
  const now = new Date().toISOString();
  const isDeposit = String(action || "").toUpperCase() !== "WITHDRAW";
  const txType = isDeposit ? "SAVINGS_DEPOSIT" : "SAVINGS_WITHDRAW";
  return {
    id: newId("tx"),
    family_id: familyId,
    account_id: walletId,
    from_account_id: walletId,
    to_account_id: null,
    category_id: null,
    type: txType,
    transaction_type: txType,
    amount: Number(amount) || 0,
    currency: currency || goal?.currency || "BDT",
    description: description || (isDeposit ? `Savings deposit: ${goal?.name || ""}` : `Savings withdraw: ${goal?.name || ""}`),
    transaction_date: now.slice(0, 10),
    created_at: now,
    updated_at: now,
    status: "POSTED",
    savings_goal_id: goal?.id || null,
    source: "cloud_local",
  };
}

export function recomputeSavingsFromLedger(savings, transactions) {
  const txs = (transactions || []).filter((t) => String(t.status || "").toUpperCase() !== "VOID");
  return enrichSavingsGoals(
    (savings || []).map((g) => {
      let current = 0;
      for (const t of txs) {
        if (String(t.savings_goal_id || "") !== String(g.id)) continue;
        const type = String(t.transaction_type || t.type || "").toUpperCase();
        const amt = Number(t.amount) || 0;
        if (type.includes("SAVINGS_DEPOSIT")) current += amt;
        else if (type.includes("SAVINGS_WITHDRAW")) current -= amt;
      }
      return {
        ...g,
        current_amount: Math.max(0, Math.round(current * 100) / 100),
        saved_amount: Math.max(0, Math.round(current * 100) / 100),
      };
    }),
  );
}

export function buildSavingsAnnualPlan(savings, year = new Date().getFullYear()) {
  const active = (savings || []).filter((g) => String(g.status || "").toUpperCase() === "ACTIVE");
  const funds = active.map((g) => {
    const target = Number(g.target_amount || 0);
    const saved = Number(g.current_amount ?? g.saved_amount ?? 0);
    const type = String(g.goal_type || "GENERAL").toUpperCase();
    const monthly =
      type === "MONTHLY" ? target : type === "ANNUAL" || type === "EMERGENCY" ? target / 12 : target / 12;
    return {
      id: g.id,
      name: g.name,
      goal_type: type,
      monthly_target: Math.round(monthly * 100) / 100,
      annual_target: target,
      saved,
      progress_percent: target > 0 ? Math.round((saved / target) * 1000) / 10 : 0,
    };
  });
  return {
    year,
    total_annual_target: funds.reduce((s, f) => s + Number(f.annual_target || 0), 0),
    total_saved: funds.reduce((s, f) => s + Number(f.saved || 0), 0),
    emergency_fund_count: funds.filter((f) => f.goal_type === "EMERGENCY").length,
    funds,
    source: "cloud_local",
  };
}

export function buildLocalLoan({ familyId, form, currency }) {
  const principal = Number(form.principal_amount) || 0;
  const now = new Date().toISOString();
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
    created_at: now,
    updated_at: now,
    source: "cloud_local",
  };
}

/**
 * Disburse: GIVEN money leaves wallet (EXPENSE); TAKEN money enters (INCOME).
 * Repayment: GIVEN money returns (INCOME); TAKEN money leaves (EXPENSE).
 */
export function buildLoanMovementTx({
  familyId,
  loan,
  walletId,
  amount,
  currency,
  kind = "DISBURSE",
  description = "",
}) {
  const now = new Date().toISOString();
  const loanType = String(loan?.loan_type || "GIVEN").toUpperCase();
  const isDisburse = String(kind || "DISBURSE").toUpperCase() !== "REPAYMENT";
  let txType;
  if (isDisburse) {
    txType = loanType === "TAKEN" ? "INCOME" : "EXPENSE";
  } else {
    txType = loanType === "GIVEN" ? "INCOME" : "EXPENSE";
  }
  const person = loan?.person_name || "";
  const defaultDesc = isDisburse
    ? loanType === "GIVEN"
      ? `Loan given: ${person}`
      : `Loan taken: ${person}`
    : `Loan repayment: ${person}`;
  return {
    id: newId("tx"),
    family_id: familyId,
    account_id: walletId,
    from_account_id: walletId,
    to_account_id: null,
    category_id: null,
    type: txType,
    transaction_type: txType,
    amount: Number(amount) || 0,
    currency: currency || loan?.currency || "BDT",
    description: description || defaultDesc,
    transaction_date: now.slice(0, 10),
    created_at: now,
    updated_at: now,
    status: "POSTED",
    loan_id: loan?.id || null,
    loan_event: isDisburse ? "DISBURSE" : "REPAYMENT",
    source: "cloud_local",
  };
}

export function loanHistoryFromLedger(loanId, transactions = []) {
  const id = String(loanId || "");
  if (!id) return [];
  return sortTransactionsNewestFirst(
    (transactions || []).filter(
      (tx) =>
        String(tx.loan_id || "") === id && String(tx.status || "").toUpperCase() !== "VOID",
    ),
  ).map((tx) => ({
    id: tx.id,
    amount: tx.amount,
    currency: tx.currency,
    description: tx.description,
    transaction_type: tx.transaction_type || tx.type,
    loan_event: tx.loan_event || "",
    created_at: tx.created_at,
    transaction_date: tx.transaction_date,
    status: tx.status,
  }));
}

export function applyLoanPayment(loan, amount) {
  const pay = Math.max(0, Number(amount) || 0);
  const remaining = Math.max(0, Number(loan?.remaining_amount || 0) - pay);
  const paid = Number(loan?.paid_amount || 0) + pay;
  return {
    ...loan,
    remaining_amount: Math.round(remaining * 100) / 100,
    paid_amount: Math.round(paid * 100) / 100,
    status: remaining <= 0.0001 ? "CLOSED" : loan.status || "ACTIVE",
    updated_at: new Date().toISOString(),
  };
}

export function buildLocalBudget({ familyId, form, currency, categoryName = "" }) {
  const amount = Number(form.budget_amount) || 0;
  const now = new Date().toISOString();
  return {
    id: newId("bud"),
    family_id: familyId,
    category_id: form.category_id,
    category_name: categoryName || "",
    name: String(form.name || "").trim(),
    budget_amount: amount,
    spent_amount: 0,
    remaining_amount: amount,
    used_percent: 0,
    is_over_budget: false,
    currency: currency || "BDT",
    period_type: form.period_type || "MONTHLY",
    note: form.note || "",
    status: "ACTIVE",
    created_at: now,
    updated_at: now,
    source: "cloud_local",
  };
}

function txInBudgetPeriod(tx, periodType, now = new Date()) {
  const raw = String(tx?.transaction_date || tx?.created_at || "").slice(0, 10);
  if (!raw) return false;
  const d = new Date(`${raw}T12:00:00`);
  if (Number.isNaN(d.getTime())) return false;
  const period = String(periodType || "MONTHLY").toUpperCase();
  if (period === "WEEKLY") {
    // Calendar week Monday–Sunday
    const start = new Date(now);
    const day = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - day);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return d >= start && d <= end;
  }
  if (period === "YEARLY") {
    return d.getFullYear() === now.getFullYear();
  }
  // MONTHLY default
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

/** Attach spent/remaining/% from expense ledger (voids ignored). */
export function enrichBudgetsFromLedger(budgets, transactions, categories = []) {
  const catMap = new Map(
    (categories || []).map((c) => [String(c.id), c.name_en || c.name_bn || c.name || ""]),
  );
  const txs = (transactions || []).filter(
    (t) =>
      String(t.status || "").toUpperCase() !== "VOID" &&
      String(t.transaction_type || t.type || "").toUpperCase().includes("EXPENSE"),
  );
  const now = new Date();
  return (budgets || []).map((b) => {
    const catId = String(b.category_id || "");
    const spent = txs
      .filter((t) => String(t.category_id || "") === catId && txInBudgetPeriod(t, b.period_type, now))
      .reduce((s, t) => s + Number(t.amount || 0), 0);
    const limit = Number(b.budget_amount || 0);
    const remaining = limit - spent;
    const used = limit > 0 ? Math.round((spent / limit) * 1000) / 10 : 0;
    return {
      ...b,
      category_name: b.category_name || catMap.get(catId) || "",
      spent_amount: spent,
      remaining_amount: remaining,
      used_percent: used,
      is_over_budget: spent > limit && limit > 0,
    };
  });
}

export function normalizeBudgetsList(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.data)) return raw.data;
  if (raw && Array.isArray(raw.budgets)) return raw.budgets;
  return [];
}

/** Persist only source fields — spent/% are always recomputed from ledger. */
export function stripBudgetForStorage(b) {
  if (!b || typeof b !== "object") return b;
  return {
    id: b.id,
    family_id: b.family_id,
    category_id: b.category_id,
    category_name: b.category_name || "",
    name: b.name,
    budget_amount: Number(b.budget_amount) || 0,
    currency: b.currency || "BDT",
    period_type: b.period_type || "MONTHLY",
    note: b.note || "",
    status: b.status || "ACTIVE",
    created_at: b.created_at || new Date().toISOString(),
    updated_at: b.updated_at || new Date().toISOString(),
    source: b.source || "cloud_local",
  };
}

export function persistableBudgets(list) {
  return (list || []).map(stripBudgetForStorage);
}

export function budgetDuplicateKey(b) {
  return `${String(b?.category_id || "")}|${String(b?.period_type || "MONTHLY").toUpperCase()}`;
}

/** Build status summary object for shim / dashboard (deduped spent by category+period). */
export function buildBudgetStatusSummary(budgets) {
  const active = (budgets || []).filter((b) => String(b.status || "").toUpperCase() === "ACTIVE");
  const totalBudget = active.reduce((s, b) => s + Number(b.budget_amount || 0), 0);
  const spentKeys = new Set();
  let totalSpent = 0;
  for (const b of active) {
    const key = budgetDuplicateKey(b);
    if (spentKeys.has(key)) continue;
    spentKeys.add(key);
    totalSpent += Number(b.spent_amount || 0);
  }
  const over = active.filter((b) => b.is_over_budget);
  const warning = active.filter((b) => !b.is_over_budget && Number(b.used_percent || 0) >= 80);
  return {
    summary: {
      total_budget: totalBudget.toFixed(2),
      total_spent: totalSpent.toFixed(2),
      remaining_amount: (totalBudget - totalSpent).toFixed(2),
      active_count: active.length,
      over_budget_count: over.length,
      warning_count: warning.length,
      over_budget: over,
      warning,
    },
  };
}

export function buildLocalGoal({ familyId, form, currency }) {
  const now = new Date().toISOString();
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
    created_at: now,
    updated_at: now,
    source: "cloud_local",
  };
}

function monthsUntilDate(targetDate) {
  if (!targetDate) return 0;
  const end = new Date(`${String(targetDate).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(end.getTime())) return 0;
  const now = new Date();
  const months =
    (end.getFullYear() - now.getFullYear()) * 12 + (end.getMonth() - now.getMonth());
  return Math.max(0, months);
}

export function enrichGoals(list) {
  return (list || []).map((g) => {
    const target = Number(g.target_amount || 0);
    const current = Math.max(0, Number(g.current_amount || 0));
    const remaining = Math.max(0, Math.round((target - current) * 100) / 100);
    const progress = target > 0 ? Math.round((current / target) * 1000) / 10 : 0;
    const months = monthsUntilDate(g.target_date);
    const recommended = months > 0 ? Math.round((remaining / months) * 100) / 100 : 0;
    return {
      ...g,
      goal_name: g.goal_name || g.name || "",
      name: g.name || g.goal_name || "",
      current_amount: current,
      remaining_amount: remaining,
      progress_percent: progress,
      recommended_monthly_saving: recommended,
    };
  });
}

export function buildGoalSummary(goals) {
  const list = Array.isArray(goals) ? goals : [];
  const active = list.filter((g) => String(g.status || "").toUpperCase() === "ACTIVE");
  return {
    total_goals: list.length,
    active_count: active.length,
    active_target_amount: active.reduce((sum, g) => sum + Number(g.target_amount || 0), 0),
    active_current_amount: active.reduce((sum, g) => sum + Number(g.current_amount || 0), 0),
    source: "cloud_local",
  };
}

/** Contribute: money leaves wallet (EXPENSE). Withdraw: money returns (INCOME). */
export function buildGoalMovementTx({
  familyId,
  goal,
  walletId,
  amount,
  currency,
  kind = "CONTRIBUTE",
  description = "",
}) {
  const now = new Date().toISOString();
  const isContribute = String(kind || "CONTRIBUTE").toUpperCase() !== "WITHDRAW";
  const txType = isContribute ? "EXPENSE" : "INCOME";
  const name = goal?.goal_name || goal?.name || "";
  return {
    id: newId("tx"),
    family_id: familyId,
    account_id: walletId,
    from_account_id: walletId,
    to_account_id: null,
    category_id: null,
    type: txType,
    transaction_type: txType,
    amount: Number(amount) || 0,
    currency: currency || goal?.currency || "BDT",
    description:
      description ||
      (isContribute ? `Goal contribute: ${name}` : `Goal withdraw: ${name}`),
    transaction_date: now.slice(0, 10),
    created_at: now,
    updated_at: now,
    status: "POSTED",
    financial_goal_id: goal?.id || null,
    goal_id: goal?.id || null,
    goal_event: isContribute ? "CONTRIBUTE" : "WITHDRAW",
    source: "cloud_local",
  };
}

export function recomputeGoalsFromLedger(goals, transactions) {
  const txs = (transactions || []).filter((t) => String(t.status || "").toUpperCase() !== "VOID");
  return enrichGoals(
    (goals || []).map((g) => {
      let current = 0;
      for (const t of txs) {
        const gid = String(t.financial_goal_id || t.goal_id || "");
        if (gid !== String(g.id)) continue;
        const event = String(t.goal_event || "").toUpperCase();
        const amt = Number(t.amount) || 0;
        if (event === "CONTRIBUTE") current += amt;
        else if (event === "WITHDRAW") current -= amt;
      }
      const target = Number(g.target_amount || 0);
      let status = String(g.status || "ACTIVE").toUpperCase();
      if (status !== "CLOSED") {
        status = target > 0 && current >= target ? "COMPLETED" : "ACTIVE";
      }
      return {
        ...g,
        current_amount: Math.max(0, Math.round(current * 100) / 100),
        status,
      };
    }),
  );
}

export function goalHistoryFromLedger(goalId, transactions = []) {
  const id = String(goalId || "");
  if (!id) return [];
  return sortTransactionsNewestFirst(
    (transactions || []).filter(
      (tx) =>
        String(tx.financial_goal_id || tx.goal_id || "") === id &&
        String(tx.status || "").toUpperCase() !== "VOID",
    ),
  ).map((tx) => ({
    id: tx.id,
    amount: tx.amount,
    currency: tx.currency,
    description: tx.description,
    transaction_type: tx.goal_event || tx.transaction_type || tx.type,
    created_at: tx.created_at,
    transaction_date: tx.transaction_date,
    status: tx.status,
  }));
}

export function computeNextDueDate(fromDate, frequency) {
  const raw = String(fromDate || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const d = new Date(`${raw}T12:00:00`);
  if (Number.isNaN(d.getTime())) return raw;
  const freq = String(frequency || "MONTHLY").toUpperCase();
  if (freq === "DAILY") d.setDate(d.getDate() + 1);
  else if (freq === "WEEKLY") d.setDate(d.getDate() + 7);
  else if (freq === "YEARLY") d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
}

export function buildLocalRecurring({ familyId, form, currency }) {
  const now = new Date().toISOString();
  const start = form.start_date || now.slice(0, 10);
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
    start_date: start,
    next_due_date: start,
    end_date: form.end_date || null,
    description: form.description || "",
    last_posted_at: null,
    status: "ACTIVE",
    created_at: now,
    updated_at: now,
    source: "cloud_local",
  };
}

export function buildRecurringPostTx({ familyId, item, currency }) {
  const now = new Date().toISOString();
  const type = String(item?.transaction_type || "EXPENSE").toUpperCase();
  const txType = type.includes("INCOME") ? "INCOME" : "EXPENSE";
  return {
    id: newId("tx"),
    family_id: familyId,
    account_id: item.account_id,
    from_account_id: item.account_id,
    to_account_id: null,
    category_id: item.category_id || null,
    type: txType,
    transaction_type: txType,
    amount: Number(item.amount) || 0,
    currency: currency || item.currency || "BDT",
    description: item.description || item.title || "Recurring",
    transaction_date: now.slice(0, 10),
    created_at: now,
    updated_at: now,
    status: "POSTED",
    recurring_id: item.id || null,
    source: "cloud_local",
  };
}

export function advanceRecurringAfterPost(item, postedAt = new Date()) {
  const iso = postedAt.toISOString();
  const today = iso.slice(0, 10);
  const next = computeNextDueDate(today, item.frequency);
  let status = item.status || "ACTIVE";
  if (item.end_date && String(next) > String(item.end_date)) {
    status = "COMPLETED";
  }
  return {
    ...item,
    last_posted_at: iso,
    next_due_date: next,
    status,
    updated_at: iso,
  };
}

export function recurringHistoryFromLedger(recurringId, transactions = []) {
  const id = String(recurringId || "");
  if (!id) return [];
  return sortTransactionsNewestFirst(
    (transactions || []).filter(
      (tx) =>
        String(tx.recurring_id || "") === id && String(tx.status || "").toUpperCase() !== "VOID",
    ),
  ).map((tx) => ({
    id: tx.id,
    amount: tx.amount,
    currency: tx.currency,
    description: tx.description,
    transaction_type: tx.transaction_type || tx.type,
    created_at: tx.created_at,
    transaction_date: tx.transaction_date,
    status: tx.status,
  }));
}
