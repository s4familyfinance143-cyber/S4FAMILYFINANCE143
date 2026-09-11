import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { tMobile, enumLabel, type MobileLang } from "../../i18n";

type Account = {
  id: string;
  name: string;
  account_type: string;
  current_balance?: string;
  currency?: string;
};

type Category = {
  id: string;
  name_en?: string;
  name_bn?: string;
  category_type: string;
};

type Transaction = {
  id: string;
  transaction_type: string;
  amount: string;
  currency?: string;
  description?: string;
  created_at?: string;
  status?: string;
};

type Tag = {
  id: string;
  name: string;
  color?: string | null;
};

type Budget = {
  id: string;
  name?: string;
  budget_amount?: string;
  spent_amount?: string;
  remaining_amount?: string;
  used_percent?: string | number;
  is_over_budget?: boolean;
  currency?: string;
  period_type?: string;
  status?: string;
  category_name?: string;
  note?: string;
};

type SavingsGoal = {
  id: string;
  name: string;
  goal_type?: string;
  target_amount?: string;
  current_amount?: string;
  progress_percent?: string | number;
  currency?: string;
  status?: string;
  note?: string;
};

type Loan = {
  id: string;
  loan_type: string;
  person_name: string;
  principal_amount?: string;
  paid_amount?: string;
  remaining_amount?: string;
  currency?: string;
  status?: string;
  note?: string;
};

type FinancialGoal = {
  id: string;
  goal_name?: string;
  name?: string;
  goal_type?: string;
  target_amount?: string;
  current_amount?: string;
  currency?: string;
  status?: string;
  target_date?: string;
  note?: string;
};

type RecurringItem = {
  id: string;
  title: string;
  transaction_type?: string;
  amount?: string;
  currency?: string;
  frequency?: string;
  next_due_date?: string;
  end_date?: string;
  description?: string;
  status?: string;
};

type HistoryRow = {
  id: string;
  transaction_type?: string;
  amount?: string;
  currency?: string;
  description?: string;
  created_at?: string;
};

type HistoryKind = "recurring" | "savings" | "loans" | "goals";

export type FinanceSub = "WALLETS" | "TX" | "BUDGET" | "SAVINGS" | "LOANS" | "GOALS" | "RECURRING" | "OFFLINE";

type Props = {
  token: string;
  familyId: string;
  currency: string;
  apiGet: (path: string, authToken?: string) => Promise<any>;
  apiPost: (path: string, body: object, authToken?: string) => Promise<any>;
  apiPatch: (path: string, body: object, authToken?: string) => Promise<any>;
  formatAmount: (value?: string | number | null, currency?: string) => string;
  onMessage: (message: string, ok?: boolean) => void;
  onChanged?: () => void;
  offlineSlot?: React.ReactNode;
  lang?: MobileLang;
  onQueueOffline?: (entityType: string, action: string, payload: object) => Promise<void>;
  initialSub?: FinanceSub;
};

const ACCOUNT_TYPES = ["CASH", "BANK", "BKASH", "NAGAD", "ROCKET", "MOBILE", "CARD", "GOLD", "ASSET", "SAVINGS"] as const;
const LOAN_TYPES = ["GIVEN", "TAKEN"] as const;

export function MobileFinancePanel({
  token,
  familyId,
  currency,
  apiGet,
  apiPost,
  apiPatch,
  formatAmount,
  onMessage,
  onChanged,
  offlineSlot,
  lang = "bn",
  onQueueOffline,
  initialSub,
}: Props) {
  const tm = (key: string) => tMobile(lang, key);
  const el = (code: string) => enumLabel(lang, code);
  const [sub, setSub] = useState<FinanceSub>(initialSub || "WALLETS");
  const [loading, setLoading] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [newTagName, setNewTagName] = useState("");
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [savings, setSavings] = useState<SavingsGoal[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [goals, setGoals] = useState<FinancialGoal[]>([]);
  const [recurring, setRecurring] = useState<RecurringItem[]>([]);
  const [historyKind, setHistoryKind] = useState<HistoryKind | null>(null);
  const [historyForId, setHistoryForId] = useState<string | null>(null);
  const [historyRows, setHistoryRows] = useState<HistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [budgetEdit, setBudgetEdit] = useState<{ id: string; name: string; budget_amount: string; note: string } | null>(null);
  const [savingsEdit, setSavingsEdit] = useState<{ id: string; name: string; target_amount: string; note: string } | null>(null);
  const [loanEdit, setLoanEdit] = useState<{ id: string; person_name: string; note: string } | null>(null);
  const [goalEdit, setGoalEdit] = useState<{
    id: string;
    goal_name: string;
    goal_type: string;
    target_amount: string;
    target_date: string;
    note: string;
  } | null>(null);
  const [recurringEdit, setRecurringEdit] = useState<{
    id: string;
    title: string;
    amount: string;
    frequency: string;
    end_date: string;
    description: string;
  } | null>(null);
  const [recurringSearch, setRecurringSearch] = useState("");
  const [recurringStatusFilter, setRecurringStatusFilter] = useState("ALL");
  const [recurringTypeFilter, setRecurringTypeFilter] = useState("ALL");
  const [budgetSearch, setBudgetSearch] = useState("");
  const [budgetStatusFilter, setBudgetStatusFilter] = useState("ALL");
  const [loanSearch, setLoanSearch] = useState("");
  const [loanStatusFilter, setLoanStatusFilter] = useState("ALL");
  const [loanTypeFilter, setLoanTypeFilter] = useState("ALL");
  const [goalForm, setGoalForm] = useState({ goal_name: "", goal_type: "GENERAL", target_amount: "" });
  const [recurringForm, setRecurringForm] = useState({
    title: "",
    account_id: "",
    category_id: "",
    transaction_type: "EXPENSE",
    amount: "",
    frequency: "MONTHLY",
    start_date: new Date().toISOString().slice(0, 10),
    end_date: "",
    description: "",
  });
  const [goalAction, setGoalAction] = useState({
    goal_id: "",
    wallet_account_id: "",
    amount: "",
    description: "",
    action: "contribute" as "contribute" | "withdraw",
  });

  const [walletForm, setWalletForm] = useState({ name: "", account_type: "CASH", opening_balance: "0" });
  const [txForm, setTxForm] = useState({
    type: "EXPENSE" as "INCOME" | "EXPENSE" | "TRANSFER",
    account_id: "",
    to_account_id: "",
    category_id: "",
    amount: "",
    description: "",
  });
  const [budgetForm, setBudgetForm] = useState({ name: "", category_id: "", budget_amount: "", period_type: "MONTHLY" });
  const [savingsForm, setSavingsForm] = useState({ name: "", wallet_account_id: "", target_amount: "", goal_type: "GENERAL" });
  const [savingsAction, setSavingsAction] = useState({
    savings_goal_id: "",
    wallet_account_id: "",
    amount: "",
    description: "",
    action: "deposit" as "deposit" | "withdraw",
  });
  const [loanForm, setLoanForm] = useState({
    person_name: "",
    wallet_account_id: "",
    principal_amount: "",
    note: "",
    loan_type: "TAKEN",
  });
  const [loanPayment, setLoanPayment] = useState({
    loan_id: "",
    wallet_account_id: "",
    amount: "",
    description: "",
  });

  const load = useCallback(async () => {
    if (!token || !familyId || sub === "OFFLINE") return;
    setLoading(true);
    if (String(token).startsWith("offline.")) {
      try {
        const { listLocal } = await import("../../database/localRepository");
        const [localAcc, localTx, localBud, localLoan, localCat] = await Promise.all([
          listLocal("accounts", familyId, 100),
          listLocal("transactions", familyId, 100),
          listLocal("budgets", familyId, 100),
          listLocal("loans", familyId, 100),
          listLocal("categories", familyId, 100),
        ]);
        setAccounts(
          (localAcc || []).map((row: any) => ({
            id: String(row.server_id || row.id),
            name: String(row.name || "Wallet"),
            account_type: row.account_type,
            currency: row.currency,
            current_balance: row.current_balance ?? row.opening_balance ?? "0",
          }))
        );
        setTransactions(
          (localTx || []).map((row: any) => ({
            id: String(row.server_id || row.id),
            transaction_type: row.transaction_type,
            amount: row.amount,
            currency: row.currency,
            description: row.description,
            status: row.status,
            account_id: row.account_id,
            category_id: row.category_id,
          }))
        );
        setBudgets(localBud || []);
        setLoans(localLoan || []);
        setCategories(
          (localCat || []).map((row: any) => ({
            id: String(row.server_id || row.id),
            name_en: String(row.name_en || row.name || "Category"),
            name_bn: row.name_bn,
            category_type: String(row.category_type || "EXPENSE"),
          }))
        );
        onMessage("Offline finance data loaded", true);
      } catch (error) {
        onMessage(error instanceof Error ? error.message : tm("financeLoadFailed"), false);
      } finally {
        setLoading(false);
      }
      return;
    }
    try {
      const [acc, cats, txs, buds, sav, lon, gol, rec, tagRows] = await Promise.all([
        apiGet(`/api/v1/accounts/family/${familyId}`, token),
        apiGet(`/api/v1/categories/family/${familyId}`, token),
        apiGet(`/api/v1/transactions/${familyId}`, token),
        apiGet(`/api/v1/budgets/${familyId}`, token),
        apiGet(`/api/v1/savings/${familyId}`, token),
        apiGet(`/api/v1/loans/${familyId}`, token),
        apiGet(`/api/v1/goals/${familyId}`, token),
        apiGet(`/api/v1/recurring/${familyId}`, token),
        apiGet(`/api/v1/tags/${familyId}`, token).catch(() => []),
      ]);
      const accountRows = Array.isArray(acc) ? acc : [];
      const categoryRows = Array.isArray(cats) ? cats : [];
      let mergedAccounts = accountRows;
      let mergedTransactions = Array.isArray(txs) ? txs : [];
      try {
        const { listLocal } = await import("../../database/localRepository");
        const { mergeApiAccounts, mergeApiTransactions } = await import("../../lib/mergeLocalFinance");
        const [localAcc, localTx] = await Promise.all([
          listLocal("accounts", familyId, 100),
          listLocal("transactions", familyId, 100),
        ]);
        mergedAccounts = mergeApiAccounts(accountRows, (localAcc || []) as Record<string, unknown>[]);
        mergedTransactions = mergeApiTransactions(mergedTransactions, (localTx || []) as Record<string, unknown>[]);
      } catch {
        /* local merge optional */
      }
      setAccounts(mergedAccounts);
      setCategories(categoryRows);
      setTransactions(mergedTransactions);
      setBudgets(Array.isArray(buds) ? buds : []);
      setSavings(Array.isArray(sav) ? sav : []);
      setLoans(Array.isArray(lon) ? lon : []);
      setGoals(Array.isArray(gol) ? gol : []);
      setRecurring(Array.isArray(rec) ? rec : []);
      setTags(Array.isArray(tagRows) ? tagRows : []);

      setTxForm((current) => ({
        ...current,
        account_id: current.account_id || accountRows[0]?.id || "",
        category_id:
          current.category_id ||
          categoryRows.find((c: Category) => c.category_type === current.type)?.id ||
          "",
      }));
      setBudgetForm((current) => ({
        ...current,
        category_id: current.category_id || categoryRows.find((c: Category) => c.category_type === "EXPENSE")?.id || "",
      }));
      setSavingsForm((current) => ({
        ...current,
        wallet_account_id: current.wallet_account_id || accountRows[0]?.id || "",
      }));
      setLoanForm((current) => ({
        ...current,
        wallet_account_id: current.wallet_account_id || accountRows[0]?.id || "",
      }));
      setGoalAction((current) => ({
        ...current,
        wallet_account_id: current.wallet_account_id || accountRows[0]?.id || "",
      }));
      setRecurringForm((current) => ({
        ...current,
        account_id: current.account_id || accountRows[0]?.id || "",
        category_id:
          current.category_id ||
          categoryRows.find((c: Category) => c.category_type === current.transaction_type)?.id ||
          "",
      }));
      onMessage(tm("financeLoaded").replace("{n}", String(mergedAccounts.length)), true);
    } catch (error) {
      try {
        const { listLocal } = await import("../../database/localRepository");
        const [localAcc, localTx, localBud, localLoan] = await Promise.all([
          listLocal("accounts", familyId, 100),
          listLocal("transactions", familyId, 100),
          listLocal("budgets", familyId, 100),
          listLocal("loans", familyId, 100),
        ]);
        if (localAcc?.length || localTx?.length) {
          setAccounts(
            (localAcc || []).map((row: any) => ({
              id: String(row.server_id || row.id),
              name: String(row.name || "Wallet"),
              account_type: row.account_type,
              currency: row.currency,
              current_balance: row.current_balance,
            }))
          );
          setTransactions(
            (localTx || []).map((row: any) => ({
              id: String(row.server_id || row.id),
              transaction_type: row.transaction_type,
              amount: row.amount,
              currency: row.currency,
              description: row.description,
              status: row.status,
              account_id: row.account_id,
              category_id: row.category_id,
            }))
          );
          setBudgets(localBud || []);
          setLoans(localLoan || []);
          onMessage("Showing offline finance data", true);
          return;
        }
      } catch {
        /* ignore */
      }
      onMessage(error instanceof Error ? error.message : tm("financeLoadFailed"), false);
    } finally {
      setLoading(false);
    }
  }, [apiGet, familyId, lang, onMessage, sub, token]);

  useEffect(() => {
    if (initialSub) setSub(initialSub);
  }, [initialSub]);

  useEffect(() => {
    void load();
  }, [load]);

  async function afterWrite(okMessage: string) {
    onMessage(okMessage, true);
    await load();
    onChanged?.();
  }


  async function queueFirst(entityType: string, action: string, payload: object, okMessage: string, reset?: () => void) {
    if (!onQueueOffline) return false;
    await onQueueOffline(entityType, action, payload);
    reset?.();
    const online = typeof navigator === "undefined" ? true : navigator.onLine !== false;
    if (online && token) {
      try {
        const { syncManager } = await import("../../sync/syncManager");
        await syncManager.replayPending(token, familyId, 20);
      } catch {
        /* stay queued */
      }
    }
    await afterWrite(okMessage);
    return true;
  }

  async function createWallet() {
    if (!walletForm.name.trim()) {
      onMessage(tm("walletNameRequired"), false);
      return;
    }
    setLoading(true);
    const payload = {
      family_id: familyId,
      name: walletForm.name.trim(),
      account_type: walletForm.account_type,
      currency,
      opening_balance: walletForm.opening_balance || "0",
      client_request_id: `mobile-wallet-${Date.now()}`,
    };
    const online = typeof navigator === "undefined" ? true : navigator.onLine !== false;
    try {
      if (online && token && familyId && !String(token).startsWith("offline.")) {
        try {
          await apiPost("/api/v1/accounts", payload, token);
          setWalletForm({ name: "", account_type: walletForm.account_type, opening_balance: "0" });
          await afterWrite(tm("walletCreated"));
          setLoading(false);
          return;
        } catch (apiError) {
          const apiMsg = apiError instanceof Error ? apiError.message : "";
          if (!onQueueOffline || !/failed to fetch|network|offline|connect/i.test(apiMsg)) {
            throw apiError;
          }
        }
      }
      if (onQueueOffline) {
        await onQueueOffline("accounts", "CREATE", payload);
        const isOfflineTok = String(token || "").startsWith("offline.");
        const _online = typeof navigator === "undefined" ? true : navigator.onLine !== false;
        if (_online && token && !isOfflineTok) {
          try {
            const { syncManager } = await import("../../sync/syncManager");
            await syncManager.replayPending(token, familyId, 20);
          } catch { /* stay queued */ }
        }
        setWalletForm({ name: "", account_type: walletForm.account_type, opening_balance: "0" });
        onMessage(isOfflineTok ? "Wallet saved offline" : "Wallet queued offline", true);
        await load();
        onChanged?.();
        setLoading(false);
        return;
      }
      await apiPost("/api/v1/accounts", payload, token);
      setWalletForm({ name: "", account_type: walletForm.account_type, opening_balance: "0" });
      await afterWrite(tm("walletCreated"));
    } catch (error) {
      const msg = error instanceof Error ? error.message : tm("walletCreateFailed");
      if (onQueueOffline && /failed to fetch|network|offline/i.test(msg)) {
        await onQueueOffline("accounts", "CREATE", payload);
                const _online = typeof navigator === "undefined" ? true : navigator.onLine !== false;
                if (_online && token) {
                  try {
                    const { syncManager } = await import("../../sync/syncManager");
                    await syncManager.replayPending(token, familyId, 20);
                  } catch { /* stay queued */ }
                }
        onMessage("Wallet queued offline", true);
        await load();
        onChanged?.();
        setLoading(false);
        return;
      }
      onMessage(msg, false);
    } finally {
      setLoading(false);
    }
  }

  async function voidTransaction(transactionId: string) {
    if (!transactionId) return;
    setLoading(true);
    const payload = { family_id: familyId, entity_id: transactionId, id: transactionId, reason: "VOID" };
    try {
      if (await queueFirst("transactions", "DELETE", payload, tm("transactionVoided") || "Transaction voided")) {
        return;
      }
      const qs = new URLSearchParams({ family_id: familyId });
      await apiPost(`/api/v1/transactions/${transactionId}/void?${qs.toString()}`, {}, token);
      onMessage(tm("transactionVoided") || "Transaction voided", true);
      await load();
      onChanged?.();
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Void failed", false);
    } finally {
      setLoading(false);
    }
  }

  async function createTag() {
    const name = newTagName.trim();
    if (!name) {
      onMessage("Tag name required", false);
      return;
    }
    setLoading(true);
    const payload = { family_id: familyId, name };
    try {
      if (await queueFirst("tags", "CREATE", payload, "Tag created", () => setNewTagName(""))) {
        return;
      }
      const created = await apiPost("/api/v1/tags", payload, token);
      if (created?.id) {
        setTags((prev) => [...prev, { id: created.id, name: created.name, color: created.color }]);
        setSelectedTagIds((prev) => (prev.includes(created.id) ? prev : [...prev, created.id]));
      }
      setNewTagName("");
      onMessage("Tag created", true);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Tag create failed", false);
    } finally {
      setLoading(false);
    }
  }

  async function attachTagsToTransaction(transactionId: string) {
    if (!transactionId || selectedTagIds.length === 0) return;
    for (const tagId of selectedTagIds) {
      try {
        await apiPost(
          "/api/v1/transaction-tags",
          { family_id: familyId, transaction_id: transactionId, tag_id: tagId },
          token
        );
      } catch {
        // ignore duplicate attach failures
      }
    }
  }

  async function createTransaction() {
    const amountValue = Number(txForm.amount);
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      onMessage(tm("validAmountRequired"), false);
      return;
    }
    if (!txForm.account_id) {
      onMessage(tm("selectWallet"), false);
      return;
    }
    setLoading(true);
    const txType = txForm.type;
    const offlinePayload = {
      family_id: familyId,
      transaction_type: txType,
      type: txType,
      account_id: txForm.account_id,
      from_account_id: txForm.account_id,
      to_account_id: txForm.to_account_id || null,
      category_id: txForm.category_id || null,
      amount: amountValue,
      currency,
      description: txForm.description || undefined,
      client_request_id: `mobile-tx-${Date.now()}`,
      tag_ids: selectedTagIds,
    };
    const online = typeof navigator === "undefined" ? true : navigator.onLine !== false;
    try {
      if (onQueueOffline) {
        if (txType === "TRANSFER" && (!txForm.to_account_id || txForm.to_account_id === txForm.account_id)) {
          onMessage(tm("selectDestWallet"), false);
          setLoading(false);
          return;
        }
        if (txType !== "TRANSFER" && !txForm.category_id) {
          onMessage(tm("selectCategory"), false);
          setLoading(false);
          return;
        }
        await onQueueOffline("transactions", "CREATE", offlinePayload);
                const _online = typeof navigator === "undefined" ? true : navigator.onLine !== false;
                if (_online && token) {
                  try {
                    const { syncManager } = await import("../../sync/syncManager");
                    await syncManager.replayPending(token, familyId, 20);
                  } catch { /* stay queued */ }
                }
        setTxForm((current) => ({ ...current, amount: "", description: "" }));
        setSelectedTagIds([]);
        onMessage("Transaction queued offline", true);
        await load();
        onChanged?.();
        setLoading(false);
        return;
      }
      let created: any = null;
      if (txForm.type === "TRANSFER") {
        if (!txForm.to_account_id || txForm.to_account_id === txForm.account_id) {
          onMessage(tm("selectDestWallet"), false);
          setLoading(false);
          return;
        }
        created = await apiPost(
          "/api/v1/transactions/transfer",
          {
            family_id: familyId,
            from_account_id: txForm.account_id,
            to_account_id: txForm.to_account_id,
            amount: amountValue,
            currency,
            description: txForm.description || undefined,
            client_request_id: offlinePayload.client_request_id,
          },
          token
        );
      } else {
        if (!txForm.category_id) {
          onMessage(tm("selectCategory"), false);
          setLoading(false);
          return;
        }
        const path = txForm.type === "INCOME" ? "/api/v1/transactions/income" : "/api/v1/transactions/expense";
        created = await apiPost(
          path,
          {
            family_id: familyId,
            account_id: txForm.account_id,
            category_id: txForm.category_id,
            amount: amountValue,
            currency,
            description: txForm.description || undefined,
            client_request_id: offlinePayload.client_request_id,
          },
          token
        );
      }
      const txId = created?.id || created?.transaction_id;
      if (txId) await attachTagsToTransaction(String(txId));
      setTxForm((current) => ({ ...current, amount: "", description: "" }));
      setSelectedTagIds([]);
      await afterWrite(tm("transactionPosted"));
    } catch (error) {
      const msg = error instanceof Error ? error.message : tm("transactionFailed");
      if (onQueueOffline && /failed to fetch|network|offline/i.test(msg)) {
        await onQueueOffline("transactions", "CREATE", offlinePayload);
                const _online = typeof navigator === "undefined" ? true : navigator.onLine !== false;
                if (_online && token) {
                  try {
                    const { syncManager } = await import("../../sync/syncManager");
                    await syncManager.replayPending(token, familyId, 20);
                  } catch { /* stay queued */ }
                }
        onMessage("Transaction queued offline", true);
        await load();
        onChanged?.();
        setLoading(false);
        return;
      }
      onMessage(msg, false);
    } finally {
      setLoading(false);
    }
  }

  async function createBudget() {
    if (!budgetForm.name.trim() || !budgetForm.category_id || !budgetForm.budget_amount) {
      onMessage(tm("budgetFieldsRequired"), false);
      return;
    }
    setLoading(true);
    const payload = {
      family_id: familyId,
      category_id: budgetForm.category_id,
      name: budgetForm.name.trim(),
      budget_amount: Number(budgetForm.budget_amount),
      currency,
      period_type: budgetForm.period_type,
      client_request_id: `mobile-budget-${Date.now()}`,
    };
    const online = typeof navigator === "undefined" ? true : navigator.onLine !== false;
    try {
      if (onQueueOffline) {
        await onQueueOffline("budgets", "CREATE", payload);
                const _online = typeof navigator === "undefined" ? true : navigator.onLine !== false;
                if (_online && token) {
                  try {
                    const { syncManager } = await import("../../sync/syncManager");
                    await syncManager.replayPending(token, familyId, 20);
                  } catch { /* stay queued */ }
                }
        setBudgetForm((current) => ({ ...current, name: "", budget_amount: "" }));
        onMessage("Budget queued offline", true);
        await load();
        onChanged?.();
        setLoading(false);
        return;
      }
      await apiPost("/api/v1/budgets", payload, token);
      setBudgetForm((current) => ({ ...current, name: "", budget_amount: "" }));
      await afterWrite(tm("budgetCreated"));
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Budget create failed";
      if (onQueueOffline && /failed to fetch|network|offline/i.test(msg)) {
        await onQueueOffline("budgets", "CREATE", payload);
                const _online = typeof navigator === "undefined" ? true : navigator.onLine !== false;
                if (_online && token) {
                  try {
                    const { syncManager } = await import("../../sync/syncManager");
                    await syncManager.replayPending(token, familyId, 20);
                  } catch { /* stay queued */ }
                }
        onMessage("Budget queued offline", true);
        await load();
        onChanged?.();
        setLoading(false);
        return;
      }
      onMessage(msg, false);
    } finally {
      setLoading(false);
    }
  }

  async function createSavings() {
    if (!savingsForm.name.trim() || !savingsForm.wallet_account_id || !savingsForm.target_amount) {
      onMessage("Savings name, wallet, and target required", false);
      return;
    }
    setLoading(true);
    const payload = {
      family_id: familyId,
      wallet_account_id: savingsForm.wallet_account_id,
      name: savingsForm.name.trim(),
      target_amount: Number(savingsForm.target_amount),
      goal_type: savingsForm.goal_type,
      currency,
      client_request_id: `mobile-sav-${Date.now()}`,
    };
    const online = typeof navigator === "undefined" ? true : navigator.onLine !== false;
    try {
      if (onQueueOffline) {
        await onQueueOffline("savings_goals", "CREATE", payload);
                const _online = typeof navigator === "undefined" ? true : navigator.onLine !== false;
                if (_online && token) {
                  try {
                    const { syncManager } = await import("../../sync/syncManager");
                    await syncManager.replayPending(token, familyId, 20);
                  } catch { /* stay queued */ }
                }
        setSavingsForm((current) => ({ ...current, name: "", target_amount: "" }));
        onMessage("Savings goal queued offline", true);
        await load();
        onChanged?.();
        setLoading(false);
        return;
      }
      await apiPost("/api/v1/savings", payload, token);
      setSavingsForm((current) => ({ ...current, name: "", target_amount: "" }));
      await afterWrite(tm("savingsCreated"));
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Savings create failed";
      if (onQueueOffline && /failed to fetch|network|offline/i.test(msg)) {
        await onQueueOffline("savings_goals", "CREATE", payload);
                const _online = typeof navigator === "undefined" ? true : navigator.onLine !== false;
                if (_online && token) {
                  try {
                    const { syncManager } = await import("../../sync/syncManager");
                    await syncManager.replayPending(token, familyId, 20);
                  } catch { /* stay queued */ }
                }
        onMessage("Savings goal queued offline", true);
        await load();
        onChanged?.();
        setLoading(false);
        return;
      }
      onMessage(msg, false);
    } finally {
      setLoading(false);
    }
  }

  async function createLoan() {
    if (!loanForm.person_name.trim() || !loanForm.wallet_account_id || !loanForm.principal_amount) {
      onMessage("Person, wallet, and principal required", false);
      return;
    }
    setLoading(true);
    const payload = {
      family_id: familyId,
      wallet_account_id: loanForm.wallet_account_id,
      loan_type: loanForm.loan_type,
      person_name: loanForm.person_name.trim(),
      principal_amount: Number(loanForm.principal_amount),
      currency,
      note: loanForm.note || undefined,
      client_request_id: `mobile-loan-${Date.now()}`,
    };
    const online = typeof navigator === "undefined" ? true : navigator.onLine !== false;
    try {
      if (onQueueOffline) {
        await onQueueOffline("loans", "CREATE", payload);
                const _online = typeof navigator === "undefined" ? true : navigator.onLine !== false;
                if (_online && token) {
                  try {
                    const { syncManager } = await import("../../sync/syncManager");
                    await syncManager.replayPending(token, familyId, 20);
                  } catch { /* stay queued */ }
                }
        setLoanForm((current) => ({ ...current, person_name: "", principal_amount: "", note: "" }));
        onMessage("Loan queued offline", true);
        await load();
        onChanged?.();
        setLoading(false);
        return;
      }
      await apiPost("/api/v1/loans", payload, token);
      setLoanForm((current) => ({ ...current, person_name: "", principal_amount: "", note: "" }));
      await afterWrite(tm("loanCreated"));
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Loan create failed";
      if (onQueueOffline && /failed to fetch|network|offline/i.test(msg)) {
        await onQueueOffline("loans", "CREATE", payload);
                const _online = typeof navigator === "undefined" ? true : navigator.onLine !== false;
                if (_online && token) {
                  try {
                    const { syncManager } = await import("../../sync/syncManager");
                    await syncManager.replayPending(token, familyId, 20);
                  } catch { /* stay queued */ }
                }
        onMessage("Loan queued offline", true);
        await load();
        onChanged?.();
        setLoading(false);
        return;
      }
      onMessage(msg, false);
    } finally {
      setLoading(false);
    }
  }

  async function postSavingsMoney() {
    if (!savingsAction.savings_goal_id || !savingsAction.wallet_account_id || !savingsAction.amount) {
      onMessage(tm("savingsActionRequired") || "Goal, wallet, and amount required", false);
      return;
    }
    const amountNum = Number(savingsAction.amount);
    if (!(amountNum > 0)) {
      onMessage(tm("validAmountRequired") || "Valid amount required", false);
      return;
    }
    const actionOp = savingsAction.action === "withdraw" ? "WITHDRAW" : "DEPOSIT";
    const payload = {
      family_id: familyId,
      savings_goal_id: savingsAction.savings_goal_id,
      wallet_account_id: savingsAction.wallet_account_id,
      from_account_id: savingsAction.wallet_account_id,
      to_account_id: savingsAction.wallet_account_id,
      amount: amountNum,
      currency,
      description: savingsAction.description || undefined,
      client_request_id: `mobile-sav-${actionOp.toLowerCase()}-${Date.now()}`,
    };
    const online = typeof navigator === "undefined" ? true : navigator.onLine !== false;
    const applyOptimistic = () => {
      setAccounts((prev) =>
        prev.map((acc) => {
          if (acc.id !== savingsAction.wallet_account_id) return acc;
          const bal = Number(acc.current_balance || 0);
          return { ...acc, current_balance: String(actionOp === "DEPOSIT" ? bal - amountNum : bal + amountNum) };
        })
      );
      setSavings((prev) =>
        prev.map((goal) => {
          if (goal.id !== savingsAction.savings_goal_id) return goal;
          const cur = Number(goal.current_amount || 0);
          return { ...goal, current_amount: String(actionOp === "DEPOSIT" ? cur + amountNum : cur - amountNum) };
        })
      );
      setSavingsAction((c) => ({ ...c, amount: "", description: "" }));
    };
    setLoading(true);
    try {
      if (onQueueOffline) {
        await onQueueOffline("savings_goals", actionOp, payload);
                const _online = typeof navigator === "undefined" ? true : navigator.onLine !== false;
                if (_online && token) {
                  try {
                    const { syncManager } = await import("../../sync/syncManager");
                    await syncManager.replayPending(token, familyId, 20);
                  } catch { /* stay queued */ }
                }
        applyOptimistic();
        onMessage(tm("syncQueuedOffline") || "Queued offline", true);
        setLoading(false);
        return;
      }
      if (actionOp === "DEPOSIT") {
        await apiPost("/api/v1/savings/deposit", {
          family_id: familyId,
          savings_goal_id: savingsAction.savings_goal_id,
          from_account_id: savingsAction.wallet_account_id,
          amount: amountNum,
          currency,
          description: savingsAction.description || undefined,
        }, token);
      } else {
        await apiPost("/api/v1/savings/withdraw", {
          family_id: familyId,
          savings_goal_id: savingsAction.savings_goal_id,
          to_account_id: savingsAction.wallet_account_id,
          amount: amountNum,
          currency,
          description: savingsAction.description || undefined,
        }, token);
      }
      setSavingsAction((c) => ({ ...c, amount: "", description: "" }));
      await afterWrite(actionOp === "DEPOSIT" ? tm("savingsDepositPosted") : tm("savingsWithdrawPosted"));
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Savings action failed";
      if (onQueueOffline && /failed to fetch|network|offline/i.test(msg)) {
        await onQueueOffline("savings_goals", actionOp, payload);
                const _online = typeof navigator === "undefined" ? true : navigator.onLine !== false;
                if (_online && token) {
                  try {
                    const { syncManager } = await import("../../sync/syncManager");
                    await syncManager.replayPending(token, familyId, 20);
                  } catch { /* stay queued */ }
                }
        applyOptimistic();
        onMessage(tm("syncQueuedOffline") || "Queued offline", true);
        setLoading(false);
        return;
      }
      onMessage(msg, false);
    } finally {
      setLoading(false);
    }
  }

  async function postLoanPay() {
    if (!loanPayment.loan_id || !loanPayment.wallet_account_id || !loanPayment.amount) {
      onMessage(tm("loanPaymentRequired") || "Loan, wallet, and amount required", false);
      return;
    }
    const amountNum = Number(loanPayment.amount);
    if (!(amountNum > 0)) {
      onMessage(tm("validAmountRequired") || "Valid amount required", false);
      return;
    }
    const loanRow = loans.find((row) => row.id === loanPayment.loan_id);
    const payload = {
      family_id: familyId,
      loan_id: loanPayment.loan_id,
      wallet_account_id: loanPayment.wallet_account_id,
      amount: amountNum,
      currency,
      description: loanPayment.description || undefined,
      client_request_id: `mobile-loan-pay-${Date.now()}`,
    };
    const online = typeof navigator === "undefined" ? true : navigator.onLine !== false;
    const applyOptimistic = () => {
      const loanType = String(loanRow?.loan_type || "").toUpperCase();
      setAccounts((prev) =>
        prev.map((acc) => {
          if (acc.id !== loanPayment.wallet_account_id) return acc;
          const bal = Number(acc.current_balance || 0);
          return { ...acc, current_balance: String(loanType === "GIVEN" ? bal + amountNum : bal - amountNum) };
        })
      );
      setLoans((prev) =>
        prev.map((loan) => {
          if (loan.id !== loanPayment.loan_id) return loan;
          const remaining = Math.max(0, Number(loan.remaining_amount || 0) - amountNum);
          const paid = Number(loan.paid_amount || 0) + amountNum;
          return {
            ...loan,
            remaining_amount: String(remaining),
            paid_amount: String(paid),
            status: remaining <= 0 ? "CLOSED" : loan.status,
          };
        })
      );
      setLoanPayment((c) => ({ ...c, amount: "", description: "" }));
    };
    setLoading(true);
    try {
      if (onQueueOffline) {
        await onQueueOffline("loans", "PAYMENT", payload);
                const _online = typeof navigator === "undefined" ? true : navigator.onLine !== false;
                if (_online && token) {
                  try {
                    const { syncManager } = await import("../../sync/syncManager");
                    await syncManager.replayPending(token, familyId, 20);
                  } catch { /* stay queued */ }
                }
        applyOptimistic();
        onMessage(tm("syncQueuedOffline") || "Queued offline", true);
        setLoading(false);
        return;
      }
      await apiPost("/api/v1/loans/payment", payload, token);
      setLoanPayment((c) => ({ ...c, amount: "", description: "" }));
      await afterWrite(tm("loanPaymentPosted"));
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Loan payment failed";
      if (onQueueOffline && /failed to fetch|network|offline/i.test(msg)) {
        await onQueueOffline("loans", "PAYMENT", payload);
                const _online = typeof navigator === "undefined" ? true : navigator.onLine !== false;
                if (_online && token) {
                  try {
                    const { syncManager } = await import("../../sync/syncManager");
                    await syncManager.replayPending(token, familyId, 20);
                  } catch { /* stay queued */ }
                }
        applyOptimistic();
        onMessage(tm("syncQueuedOffline") || "Queued offline", true);
        setLoading(false);
        return;
      }
      onMessage(msg, false);
    } finally {
      setLoading(false);
    }
  }

  async function createGoal() {
    if (!goalForm.goal_name.trim() || !goalForm.target_amount) {
      onMessage(tm("goalFieldsRequired") || "Goal name and target required", false);
      return;
    }
    const payload = {
      family_id: familyId,
      linked_savings_goal_id: null,
      goal_name: goalForm.goal_name.trim(),
      goal_type: goalForm.goal_type,
      target_amount: Number(goalForm.target_amount),
      currency,
      client_request_id: `mobile-goal-${Date.now()}`,
    };
    const online = typeof navigator === "undefined" ? true : navigator.onLine !== false;
    setLoading(true);
    try {
      if (onQueueOffline) {
        await onQueueOffline("financial_goals", "CREATE", payload);
                const _online = typeof navigator === "undefined" ? true : navigator.onLine !== false;
                if (_online && token) {
                  try {
                    const { syncManager } = await import("../../sync/syncManager");
                    await syncManager.replayPending(token, familyId, 20);
                  } catch { /* stay queued */ }
                }
        setGoalForm({ goal_name: "", goal_type: "GENERAL", target_amount: "" });
        onMessage(tm("syncQueuedOffline") || "Queued offline", true);
        setLoading(false);
        return;
      }
      await apiPost("/api/v1/goals", payload, token);
      setGoalForm({ goal_name: "", goal_type: "GENERAL", target_amount: "" });
      await afterWrite(tm("goalCreated") || "Goal created");
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Goal create failed";
      if (onQueueOffline && /failed to fetch|network|offline/i.test(msg)) {
        await onQueueOffline("financial_goals", "CREATE", payload);
                const _online = typeof navigator === "undefined" ? true : navigator.onLine !== false;
                if (_online && token) {
                  try {
                    const { syncManager } = await import("../../sync/syncManager");
                    await syncManager.replayPending(token, familyId, 20);
                  } catch { /* stay queued */ }
                }
        onMessage(tm("syncQueuedOffline") || "Queued offline", true);
        setLoading(false);
        return;
      }
      onMessage(msg, false);
    } finally {
      setLoading(false);
    }
  }

  async function postGoalMoney() {
    if (!goalAction.goal_id || !goalAction.wallet_account_id || !goalAction.amount) {
      onMessage(tm("goalActionRequired") || "Goal, wallet, and amount required", false);
      return;
    }
    const amountNum = Number(goalAction.amount);
    if (!(amountNum > 0)) {
      onMessage(tm("validAmountRequired") || "Valid amount required", false);
      return;
    }
    const actionOp = goalAction.action === "withdraw" ? "WITHDRAW" : "CONTRIBUTE";
    const payload = {
      family_id: familyId,
      goal_id: goalAction.goal_id,
      wallet_account_id: goalAction.wallet_account_id,
      amount: amountNum,
      currency,
      description: goalAction.description || undefined,
      client_request_id: `mobile-goal-${actionOp.toLowerCase()}-${Date.now()}`,
    };
    const online = typeof navigator === "undefined" ? true : navigator.onLine !== false;
    const applyOptimistic = () => {
      setAccounts((prev) =>
        prev.map((acc) => {
          if (acc.id !== goalAction.wallet_account_id) return acc;
          const bal = Number(acc.current_balance || 0);
          return { ...acc, current_balance: String(actionOp === "CONTRIBUTE" ? bal - amountNum : bal + amountNum) };
        })
      );
      setGoals((prev) =>
        prev.map((goal) => {
          if (goal.id !== goalAction.goal_id) return goal;
          const cur = Number(goal.current_amount || 0);
          const next = actionOp === "CONTRIBUTE" ? cur + amountNum : Math.max(0, cur - amountNum);
          const target = Number(goal.target_amount || 0);
          return {
            ...goal,
            current_amount: String(next),
            status:
              actionOp === "CONTRIBUTE" && target > 0 && next >= target
                ? "COMPLETED"
                : goal.status === "COMPLETED" && next < target
                  ? "ACTIVE"
                  : goal.status,
          };
        })
      );
      setGoalAction((c) => ({ ...c, amount: "", description: "" }));
    };
    setLoading(true);
    try {
      if (onQueueOffline) {
        await onQueueOffline("financial_goals", actionOp, payload);
                const _online = typeof navigator === "undefined" ? true : navigator.onLine !== false;
                if (_online && token) {
                  try {
                    const { syncManager } = await import("../../sync/syncManager");
                    await syncManager.replayPending(token, familyId, 20);
                  } catch { /* stay queued */ }
                }
        applyOptimistic();
        onMessage(tm("syncQueuedOffline") || "Queued offline", true);
        setLoading(false);
        return;
      }
      if (actionOp === "CONTRIBUTE") {
        await apiPost("/api/v1/goals/contribute", payload, token);
      } else {
        await apiPost("/api/v1/goals/withdraw", payload, token);
      }
      setGoalAction((c) => ({ ...c, amount: "", description: "" }));
      await afterWrite(actionOp === "CONTRIBUTE" ? tm("goalContributionPosted") : tm("goalWithdrawPosted"));
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Goal action failed";
      if (onQueueOffline && /failed to fetch|network|offline/i.test(msg)) {
        await onQueueOffline("financial_goals", actionOp, payload);
                const _online = typeof navigator === "undefined" ? true : navigator.onLine !== false;
                if (_online && token) {
                  try {
                    const { syncManager } = await import("../../sync/syncManager");
                    await syncManager.replayPending(token, familyId, 20);
                  } catch { /* stay queued */ }
                }
        applyOptimistic();
        onMessage(tm("syncQueuedOffline") || "Queued offline", true);
        setLoading(false);
        return;
      }
      onMessage(msg, false);
    } finally {
      setLoading(false);
    }
  }

  async function createRecurring() {
    if (!recurringForm.title.trim() || !recurringForm.account_id || !recurringForm.amount || !recurringForm.start_date) {
      onMessage(tm("recurringFieldsRequired") || "Title, wallet, amount, start date required", false);
      return;
    }
    const payload = {
      family_id: familyId,
      account_id: recurringForm.account_id,
      category_id: recurringForm.category_id || null,
      title: recurringForm.title.trim(),
      transaction_type: recurringForm.transaction_type,
      amount: Number(recurringForm.amount),
      currency,
      frequency: recurringForm.frequency,
      start_date: recurringForm.start_date,
      end_date: recurringForm.end_date || null,
      description: recurringForm.description.trim() || null,
      client_request_id: `mobile-recurring-${Date.now()}`,
    };
    const online = typeof navigator === "undefined" ? true : navigator.onLine !== false;
    setLoading(true);
    try {
      if (onQueueOffline) {
        await onQueueOffline("recurring_transactions", "CREATE", payload);
                const _online = typeof navigator === "undefined" ? true : navigator.onLine !== false;
                if (_online && token) {
                  try {
                    const { syncManager } = await import("../../sync/syncManager");
                    await syncManager.replayPending(token, familyId, 20);
                  } catch { /* stay queued */ }
                }
        setRecurringForm((c) => ({ ...c, title: "", amount: "" }));
        onMessage(tm("syncQueuedOffline") || "Queued offline", true);
        setLoading(false);
        return;
      }
      await apiPost("/api/v1/recurring", payload, token);
      setRecurringForm((c) => ({ ...c, title: "", amount: "" }));
      await afterWrite(tm("recurringCreated") || "Recurring created");
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Recurring create failed";
      if (onQueueOffline && /failed to fetch|network|offline/i.test(msg)) {
        await onQueueOffline("recurring_transactions", "CREATE", payload);
                const _online = typeof navigator === "undefined" ? true : navigator.onLine !== false;
                if (_online && token) {
                  try {
                    const { syncManager } = await import("../../sync/syncManager");
                    await syncManager.replayPending(token, familyId, 20);
                  } catch { /* stay queued */ }
                }
        onMessage(tm("syncQueuedOffline") || "Queued offline", true);
        setLoading(false);
        return;
      }
      onMessage(msg, false);
    } finally {
      setLoading(false);
    }
  }

  async function setRecurringStatus(item: RecurringItem, operation: "PAUSE" | "RESUME" | "CLOSE") {
    const payload = { family_id: familyId, entity_id: item.id, id: item.id };
    const online = typeof navigator === "undefined" ? true : navigator.onLine !== false;
    const nextStatus = operation === "PAUSE" ? "PAUSED" : operation === "RESUME" ? "ACTIVE" : "CLOSED";
    setLoading(true);
    try {
      if (onQueueOffline) {
        await onQueueOffline("recurring_transactions", operation, payload);
        setRecurring((prev) => prev.map((row) => (row.id === item.id ? { ...row, status: nextStatus } : row)));
        onMessage(tm("syncQueuedOffline") || "Queued offline", true);
        setLoading(false);
        return;
      }
      const path =
        operation === "PAUSE"
          ? `/api/v1/recurring/${item.id}/pause`
          : operation === "RESUME"
            ? `/api/v1/recurring/${item.id}/resume`
            : `/api/v1/recurring/${item.id}/close`;
      await apiPost(path, { family_id: familyId }, token);
      await afterWrite(tm("recurringUpdated") || "Recurring updated");
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Recurring update failed";
      if (onQueueOffline && /failed to fetch|network|offline/i.test(msg)) {
        await onQueueOffline("recurring_transactions", operation, payload);
        setRecurring((prev) => prev.map((row) => (row.id === item.id ? { ...row, status: nextStatus } : row)));
        onMessage(tm("syncQueuedOffline") || "Queued offline", true);
        setLoading(false);
        return;
      }
      onMessage(msg, false);
    } finally {
      setLoading(false);
    }
  }

  async function postRecurringNow(item: RecurringItem) {
    const online = typeof navigator === "undefined" ? true : navigator.onLine !== false;
    if (!online) {
      onMessage("Online required to post now", false);
      return;
    }
    setLoading(true);
    try {
      await apiPost(`/api/v1/recurring/${item.id}/post`, {}, token);
      await afterWrite(tm("recurringPosted") || "Recurring posted");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Recurring post failed", false);
    } finally {
      setLoading(false);
    }
  }

  async function loadEntityHistory(kind: HistoryKind, id: string) {
    if (historyKind === kind && historyForId === id && !historyLoading) {
      setHistoryKind(null);
      setHistoryForId(null);
      setHistoryRows([]);
      return;
    }
    const online = typeof navigator === "undefined" ? true : navigator.onLine !== false;
    if (!online) {
      onMessage(tm("onlineRequiredHistory") || "Online required for history", false);
      return;
    }
    setHistoryKind(kind);
    setHistoryForId(id);
    setHistoryRows([]);
    setHistoryLoading(true);
    try {
      const data = await apiGet(`/api/v1/${kind}/${id}/history/${familyId}`, token);
      const rows = Array.isArray(data) ? data : data?.history || [];
      setHistoryRows(rows);
      onMessage(tm("historyLoaded") || "History loaded", true);
    } catch (error) {
      setHistoryRows([]);
      onMessage(error instanceof Error ? error.message : "History load failed", false);
    } finally {
      setHistoryLoading(false);
    }
  }

  function confirmClose(title: string, onConfirm: () => void) {
    Alert.alert(tm("close") || "Close", title, [
      { text: tm("cancel") || "Cancel", style: "cancel" },
      { text: tm("close") || "Close", style: "destructive", onPress: onConfirm },
    ]);
  }

  async function closeBudget(item: Budget) {
    if (String(item.status || "").toUpperCase() === "CLOSED") return;
    confirmClose(`${tm("close")} "${item.name || "Budget"}"?`, async () => {
      setLoading(true);
      try {
        await apiPost(`/api/v1/budgets/${item.id}/close`, { family_id: familyId, reason: "Closed from mobile" }, token);
        await afterWrite(tm("budgetClosed") || "Budget closed");
      } catch (error) {
        onMessage(error instanceof Error ? error.message : "Budget close failed", false);
      } finally {
        setLoading(false);
      }
    });
  }

  async function saveBudgetEdit() {
    if (!budgetEdit) return;
    if (!budgetEdit.name.trim() || !budgetEdit.budget_amount || Number(budgetEdit.budget_amount) <= 0) {
      onMessage(tm("budgetFieldsRequired") || "Budget name and amount required", false);
      return;
    }
    setLoading(true);
    try {
      await apiPatch(
        `/api/v1/budgets/${budgetEdit.id}`,
        {
          family_id: familyId,
          name: budgetEdit.name.trim(),
          budget_amount: budgetEdit.budget_amount,
          note: budgetEdit.note,
        },
        token
      );
      setBudgetEdit(null);
      await afterWrite(tm("budgetUpdated") || "Budget updated");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Budget update failed", false);
    } finally {
      setLoading(false);
    }
  }

  async function closeSavings(item: SavingsGoal) {
    if (String(item.status || "").toUpperCase() === "CLOSED") return;
    confirmClose(`${tm("close")} "${item.name}"?`, async () => {
      setLoading(true);
      try {
        await apiPost(`/api/v1/savings/${item.id}/close`, { family_id: familyId, reason: "Closed from mobile" }, token);
        await afterWrite(tm("savingsClosed") || "Savings closed");
      } catch (error) {
        onMessage(error instanceof Error ? error.message : "Savings close failed", false);
      } finally {
        setLoading(false);
      }
    });
  }

  async function saveSavingsEdit() {
    if (!savingsEdit) return;
    if (!savingsEdit.name.trim() || !savingsEdit.target_amount || Number(savingsEdit.target_amount) <= 0) {
      onMessage(tm("savingsFieldsRequired") || "Savings name and target required", false);
      return;
    }
    setLoading(true);
    try {
      await apiPatch(
        `/api/v1/savings/${savingsEdit.id}`,
        {
          family_id: familyId,
          name: savingsEdit.name.trim(),
          target_amount: savingsEdit.target_amount,
          note: savingsEdit.note,
        },
        token
      );
      setSavingsEdit(null);
      await afterWrite(tm("savingsUpdated") || "Savings updated");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Savings update failed", false);
    } finally {
      setLoading(false);
    }
  }

  async function closeLoan(item: Loan) {
    if (String(item.status || "").toUpperCase() === "CLOSED") return;
    confirmClose(`${tm("close")} "${item.person_name}"?`, async () => {
      setLoading(true);
      try {
        await apiPost(`/api/v1/loans/${item.id}/close`, { family_id: familyId, reason: "Closed from mobile" }, token);
        await afterWrite(tm("loanClosed") || "Loan closed");
      } catch (error) {
        onMessage(error instanceof Error ? error.message : "Loan close failed", false);
      } finally {
        setLoading(false);
      }
    });
  }

  async function saveLoanEdit() {
    if (!loanEdit) return;
    if (!loanEdit.person_name.trim()) {
      onMessage(tm("personNameRequired") || "Person name required", false);
      return;
    }
    setLoading(true);
    try {
      await apiPatch(
        `/api/v1/loans/${loanEdit.id}`,
        {
          family_id: familyId,
          person_name: loanEdit.person_name.trim(),
          note: loanEdit.note,
        },
        token
      );
      setLoanEdit(null);
      await afterWrite(tm("loanUpdated") || "Loan updated");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Loan update failed", false);
    } finally {
      setLoading(false);
    }
  }

  async function closeGoal(item: FinancialGoal) {
    if (String(item.status || "").toUpperCase() === "CLOSED") return;
    const label = item.goal_name || item.name || "Goal";
    confirmClose(`${tm("close")} "${label}"?`, async () => {
      setLoading(true);
      try {
        await apiPost(`/api/v1/goals/${item.id}/close`, { family_id: familyId, reason: "Closed from mobile" }, token);
        await afterWrite(tm("goalClosed") || "Goal closed");
      } catch (error) {
        onMessage(error instanceof Error ? error.message : "Goal close failed", false);
      } finally {
        setLoading(false);
      }
    });
  }

  async function saveGoalEdit() {
    if (!goalEdit) return;
    if (!goalEdit.goal_name.trim() || !goalEdit.target_amount || Number(goalEdit.target_amount) <= 0) {
      onMessage(tm("goalFieldsRequired") || "Goal name and target required", false);
      return;
    }
    setLoading(true);
    try {
      await apiPatch(
        `/api/v1/goals/${goalEdit.id}`,
        {
          family_id: familyId,
          goal_name: goalEdit.goal_name.trim(),
          goal_type: goalEdit.goal_type,
          target_amount: goalEdit.target_amount,
          target_date: goalEdit.target_date || null,
          note: goalEdit.note,
        },
        token
      );
      setGoalEdit(null);
      await afterWrite(tm("goalUpdated") || "Goal updated");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Goal update failed", false);
    } finally {
      setLoading(false);
    }
  }

  async function saveRecurringEdit() {
    if (!recurringEdit) return;
    if (!recurringEdit.title.trim() || !recurringEdit.amount || Number(recurringEdit.amount) <= 0) {
      onMessage(tm("recurringFieldsRequired") || "Title and amount required", false);
      return;
    }
    setLoading(true);
    try {
      await apiPatch(
        `/api/v1/recurring/${recurringEdit.id}`,
        {
          family_id: familyId,
          title: recurringEdit.title.trim(),
          amount: recurringEdit.amount,
          frequency: recurringEdit.frequency,
          end_date: recurringEdit.end_date || null,
          description: recurringEdit.description,
        },
        token
      );
      setRecurringEdit(null);
      await afterWrite(tm("recurringUpdated") || "Recurring updated");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Recurring update failed", false);
    } finally {
      setLoading(false);
    }
  }

  function renderHistoryBlock(kind: HistoryKind, id: string, fallbackTitle: string) {
    if (historyKind !== kind || historyForId !== id) return null;
    return (
      <View style={{ gap: 6, marginTop: 4 }}>
        <Text style={styles.sectionLabel}>{tm("history")}</Text>
        {historyLoading ? <Text style={styles.muted}>...</Text> : null}
        {!historyLoading && historyRows.length === 0 ? <Text style={styles.muted}>{tm("history")}: 0</Text> : null}
        {!historyLoading
          ? historyRows.map((row) => (
              <View key={row.id}>
                <Text style={styles.listTitle}>{row.description || row.transaction_type || fallbackTitle}</Text>
                <Text style={styles.muted}>
                  {formatAmount(row.amount, row.currency || currency)} ·{" "}
                  {row.created_at ? String(row.created_at).slice(0, 19) : "—"}
                </Text>
              </View>
            ))
          : null}
      </View>
    );
  }

  const filteredRecurring = useMemo(() => {
    const search = recurringSearch.trim().toLowerCase();
    return recurring.filter((item) => {
      const matchSearch =
        !search ||
        String(item.title || "").toLowerCase().includes(search) ||
        String(item.description || "").toLowerCase().includes(search);
      const matchStatus = recurringStatusFilter === "ALL" || item.status === recurringStatusFilter;
      const matchType = recurringTypeFilter === "ALL" || item.transaction_type === recurringTypeFilter;
      return matchSearch && matchStatus && matchType;
    });
  }, [recurring, recurringSearch, recurringStatusFilter, recurringTypeFilter]);

  const filteredBudgets = useMemo(() => {
    const search = budgetSearch.trim().toLowerCase();
    return budgets.filter((budget) => {
      const matchSearch =
        !search ||
        String(budget.name || "").toLowerCase().includes(search) ||
        String(budget.category_name || "").toLowerCase().includes(search) ||
        String(budget.note || "").toLowerCase().includes(search);
      const matchStatus =
        budgetStatusFilter === "ALL" || String(budget.status || "ACTIVE").toUpperCase() === budgetStatusFilter;
      return matchSearch && matchStatus;
    });
  }, [budgets, budgetSearch, budgetStatusFilter]);

  const filteredLoans = useMemo(() => {
    const search = loanSearch.trim().toLowerCase();
    return loans.filter((loan) => {
      const matchSearch =
        !search ||
        String(loan.person_name || "").toLowerCase().includes(search) ||
        String(loan.note || "").toLowerCase().includes(search);
      const matchStatus =
        loanStatusFilter === "ALL" || String(loan.status || "ACTIVE").toUpperCase() === loanStatusFilter;
      const matchType = loanTypeFilter === "ALL" || loan.loan_type === loanTypeFilter;
      return matchSearch && matchStatus && matchType;
    });
  }, [loans, loanSearch, loanStatusFilter, loanTypeFilter]);

  const txCategories = categories.filter((category) => category.category_type === txForm.type);
  const expenseCategories = categories.filter((category) => category.category_type === "EXPENSE");

  return (
    <View style={styles.panel}>
      <View style={styles.rowBetween}>
        <Text style={styles.panelTitle}>{tm("finance")}</Text>
        <Pressable onPress={() => void load()} disabled={loading || sub === "OFFLINE"}>
          <Text style={styles.linkText}>{loading ? "..." : tm("refresh")}</Text>
        </Pressable>
      </View>

      <View style={styles.statusRow}>
        {(
          [
            ["WALLETS", "wallets"],
            ["TX", "tx"],
            ["BUDGET", "budgets"],
            ["SAVINGS", "savings"],
            ["LOANS", "loans"],
            ["GOALS", "goals"],
            ["RECURRING", "recurring"],
            ["OFFLINE", "offline"],
          ] as const
        ).map(([id, key]) => (
          <Pressable key={id} onPress={() => setSub(id)}>
            <Text style={[styles.statusPill, sub === id ? styles.ok : null]}>{tm(key)}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.grid}>
        <Metric label={tm("wallets")} value={String(accounts.length)} />
        <Metric label={tm("tx")} value={String(transactions.length)} />
        <Metric label={tm("budgets")} value={String(budgets.length)} />
        <Metric label={tm("savings")} value={String(savings.length)} />
        <Metric label={tm("loans")} value={String(loans.length)} />
        <Metric label={tm("goals")} value={String(goals.length)} />
      </View>

      {sub === "OFFLINE" ? (
        offlineSlot || <Text style={styles.muted}>{tm("noOfflineQueue")}</Text>
      ) : null}

      {sub === "WALLETS" ? (
        <>
          <Text style={styles.sectionLabel}>{tm("createWallet")}</Text>
          <TextInput
            style={styles.input}
            placeholder={tm("walletName")}
            placeholderTextColor="#8aa39a"
            value={walletForm.name}
            onChangeText={(name) => setWalletForm((c) => ({ ...c, name }))}
          />
          <View style={styles.statusRow}>
            {ACCOUNT_TYPES.map((type) => (
              <Pressable key={type} onPress={() => setWalletForm((c) => ({ ...c, account_type: type }))}>
                <Text style={[styles.statusPill, walletForm.account_type === type ? styles.ok : null]}>{el(type)}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            style={styles.input}
            placeholder={tm("openingBalance")}
            placeholderTextColor="#8aa39a"
            keyboardType="decimal-pad"
            value={walletForm.opening_balance}
            onChangeText={(opening_balance) => setWalletForm((c) => ({ ...c, opening_balance }))}
          />
          <Pressable style={styles.primaryButton} onPress={() => void createWallet()} disabled={loading}>
            <Text style={styles.primaryButtonText}>{loading ? tm("saving") : tm("createWalletBtn")}</Text>
          </Pressable>
          <Text style={styles.sectionLabel}>{tm("wallets")}</Text>
          {accounts.length === 0 ? <Text style={styles.muted}>{tm("noWalletsYet")}</Text> : null}
          {accounts.map((account) => (
            <View style={styles.listRow} key={account.id}>
              <Text style={styles.listTitle}>{account.name}</Text>
              <Text style={styles.muted}>
                {account.account_type ? el(account.account_type) : account.account_type} · {formatAmount(account.current_balance, account.currency || currency)}
              </Text>
            </View>
          ))}
        </>
      ) : null}

      {sub === "TX" ? (
        <>
          <Text style={styles.sectionLabel}>{tm("postTransaction")}</Text>
          <View style={styles.statusRow}>
            {(["INCOME", "EXPENSE", "TRANSFER"] as const).map((type) => (
              <Pressable
                key={type}
                onPress={() =>
                  setTxForm((c) => ({
                    ...c,
                    type,
                    category_id: categories.find((cat) => cat.category_type === type)?.id || "",
                    to_account_id: "",
                  }))
                }
              >
                <Text style={[styles.statusPill, txForm.type === type ? styles.ok : null]}>{el(type)}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.sectionLabel}>{tm("wallet")}</Text>
          <View style={styles.statusRow}>
            {accounts.map((account) => (
              <Pressable key={account.id} onPress={() => setTxForm((c) => ({ ...c, account_id: account.id }))}>
                <Text style={[styles.statusPill, txForm.account_id === account.id ? styles.ok : null]}>{account.name}</Text>
              </Pressable>
            ))}
          </View>
          {txForm.type === "TRANSFER" ? (
            <>
              <Text style={styles.sectionLabel}>{tm("toWallet")}</Text>
              <View style={styles.statusRow}>
                {accounts
                  .filter((account) => account.id !== txForm.account_id)
                  .map((account) => (
                    <Pressable key={account.id} onPress={() => setTxForm((c) => ({ ...c, to_account_id: account.id }))}>
                      <Text style={[styles.statusPill, txForm.to_account_id === account.id ? styles.ok : null]}>{account.name}</Text>
                    </Pressable>
                  ))}
              </View>
            </>
          ) : (
            <>
              <Text style={styles.sectionLabel}>{tm("category")}</Text>
              <View style={styles.statusRow}>
                {txCategories.slice(0, 10).map((category) => (
                  <Pressable key={category.id} onPress={() => setTxForm((c) => ({ ...c, category_id: category.id }))}>
                    <Text style={[styles.statusPill, txForm.category_id === category.id ? styles.ok : null]}>
                      {category.name_en || category.name_bn || category.category_type}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}
          <TextInput
            style={styles.input}
            placeholder={tm("amount")}
            placeholderTextColor="#8aa39a"
            keyboardType="decimal-pad"
            value={txForm.amount}
            onChangeText={(amount) => setTxForm((c) => ({ ...c, amount }))}
          />
          <TextInput
            style={styles.input}
            placeholder={tm("description")}
            placeholderTextColor="#8aa39a"
            value={txForm.description}
            onChangeText={(description) => setTxForm((c) => ({ ...c, description }))}
          />
          <Text style={styles.sectionLabel}>Tags</Text>
          <View style={styles.statusRow}>
            {tags.map((tag) => {
              const selected = selectedTagIds.includes(tag.id);
              return (
                <Pressable
                  key={tag.id}
                  onPress={() =>
                    setSelectedTagIds((prev) =>
                      selected ? prev.filter((id) => id !== tag.id) : [...prev, tag.id]
                    )
                  }
                >
                  <Text style={[styles.statusPill, selected ? styles.ok : null]}>{tag.name}</Text>
                </Pressable>
              );
            })}
          </View>
          <TextInput
            style={styles.input}
            placeholder="New tag name"
            placeholderTextColor="#8aa39a"
            value={newTagName}
            onChangeText={setNewTagName}
          />
          <Pressable style={styles.secondaryButton} onPress={() => void createTag()} disabled={loading}>
            <Text style={styles.secondaryButtonText}>Add tag</Text>
          </Pressable>
          <Pressable style={styles.primaryButton} onPress={() => void createTransaction()} disabled={loading}>
            <Text style={styles.primaryButtonText}>{loading ? tm("posting") : tm("postType").replace("{type}", txForm.type)}</Text>
          </Pressable>
          <Text style={styles.sectionLabel}>{tm("recentTransactions")}</Text>
          {transactions.length === 0 ? <Text style={styles.muted}>{tm("noTransactionsYet")}</Text> : null}
          {transactions.slice(0, 12).map((tx) => (
            <View style={styles.listRow} key={tx.id}>
              <Text style={styles.listTitle}>
                {el(tx.transaction_type)} · {formatAmount(tx.amount, tx.currency || currency)}
              </Text>
              <Text style={styles.muted}>
                {tx.description || tm("noNote")} · {tx.status || "POSTED"} · {tx.created_at ? String(tx.created_at).slice(0, 19) : ""}
              </Text>
              {String(tx.status || "").toUpperCase() !== "VOID" ? (
                <Pressable
                  style={styles.secondaryButton}
                  disabled={loading}
                  onPress={() => void voidTransaction(tx.id)}
                >
                  <Text style={styles.secondaryButtonText}>{tm("voidTransaction") || "Void"}</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
        </>
      ) : null}

      {sub === "BUDGET" ? (
        <>
          <Text style={styles.sectionLabel}>{tm("createBudget")}</Text>
          <TextInput
            style={styles.input}
            placeholder={tm("budgetName")}
            placeholderTextColor="#8aa39a"
            value={budgetForm.name}
            onChangeText={(name) => setBudgetForm((c) => ({ ...c, name }))}
          />
          <View style={styles.statusRow}>
            {expenseCategories.slice(0, 10).map((category) => (
              <Pressable key={category.id} onPress={() => setBudgetForm((c) => ({ ...c, category_id: category.id }))}>
                <Text style={[styles.statusPill, budgetForm.category_id === category.id ? styles.ok : null]}>
                  {category.name_en || category.name_bn || "Expense"}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.statusRow}>
            {["WEEKLY", "MONTHLY", "YEARLY"].map((period) => (
              <Pressable key={period} onPress={() => setBudgetForm((c) => ({ ...c, period_type: period }))}>
                <Text style={[styles.statusPill, budgetForm.period_type === period ? styles.ok : null]}>{period}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            style={styles.input}
            placeholder="Budget amount"
            placeholderTextColor="#8aa39a"
            keyboardType="decimal-pad"
            value={budgetForm.budget_amount}
            onChangeText={(budget_amount) => setBudgetForm((c) => ({ ...c, budget_amount }))}
          />
          <Pressable style={styles.primaryButton} onPress={() => void createBudget()} disabled={loading}>
            <Text style={styles.primaryButtonText}>{loading ? tm("saving") : tm("createBudgetBtn")}</Text>
          </Pressable>
          <Text style={styles.sectionLabel}>{tm("budgets")}</Text>
          <TextInput
            style={styles.input}
            placeholder={tm("searchTitleDescription") || "Search"}
            placeholderTextColor="#8aa39a"
            value={budgetSearch}
            onChangeText={setBudgetSearch}
          />
          <View style={styles.statusRow}>
            {(["ALL", "ACTIVE", "CLOSED"] as const).map((status) => (
              <Pressable key={status} onPress={() => setBudgetStatusFilter(status)}>
                <Text style={[styles.statusPill, budgetStatusFilter === status ? styles.ok : null]}>
                  {status === "ALL" ? tm("allStatus") : el(status)}
                </Text>
              </Pressable>
            ))}
          </View>
          {filteredBudgets.length === 0 ? <Text style={styles.muted}>{tm("noBudgetsYet")}</Text> : null}
          {filteredBudgets.map((budget) => (
            <View style={styles.listRow} key={budget.id}>
              <Text style={styles.listTitle}>{budget.name || "Budget"}</Text>
              <Text style={styles.muted}>
                {budget.category_name || "Category"} · {formatAmount(budget.budget_amount, budget.currency || currency)} · spent{" "}
                {formatAmount(budget.spent_amount, budget.currency || currency)}
                {budget.is_over_budget ? " · OVER" : ""} · {budget.status || "ACTIVE"}
              </Text>
              <View style={styles.statusRow}>
                {String(budget.status || "ACTIVE").toUpperCase() === "ACTIVE" ? (
                  <>
                    <Pressable
                      onPress={() =>
                        setBudgetEdit({
                          id: budget.id,
                          name: budget.name || "",
                          budget_amount: String(budget.budget_amount || ""),
                          note: budget.note || "",
                        })
                      }
                    >
                      <Text style={[styles.statusPill, budgetEdit?.id === budget.id ? styles.ok : null]}>{tm("edit")}</Text>
                    </Pressable>
                    <Pressable onPress={() => void closeBudget(budget)} disabled={loading}>
                      <Text style={[styles.statusPill, styles.failed]}>{tm("close")}</Text>
                    </Pressable>
                  </>
                ) : null}
              </View>
              {budgetEdit?.id === budget.id ? (
                <View style={{ gap: 8, marginTop: 6 }}>
                  <TextInput
                    style={styles.input}
                    placeholder={tm("budgetName")}
                    placeholderTextColor="#8aa39a"
                    value={budgetEdit.name}
                    onChangeText={(name) => setBudgetEdit((c) => (c ? { ...c, name } : c))}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder={tm("amount")}
                    placeholderTextColor="#8aa39a"
                    keyboardType="decimal-pad"
                    value={budgetEdit.budget_amount}
                    onChangeText={(budget_amount) => setBudgetEdit((c) => (c ? { ...c, budget_amount } : c))}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder={tm("note")}
                    placeholderTextColor="#8aa39a"
                    value={budgetEdit.note}
                    onChangeText={(note) => setBudgetEdit((c) => (c ? { ...c, note } : c))}
                  />
                  <View style={styles.statusRow}>
                    <Pressable onPress={() => void saveBudgetEdit()} disabled={loading}>
                      <Text style={[styles.statusPill, styles.ok]}>{tm("save")}</Text>
                    </Pressable>
                    <Pressable onPress={() => setBudgetEdit(null)}>
                      <Text style={styles.statusPill}>{tm("cancelEdit")}</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}
            </View>
          ))}
        </>
      ) : null}

      {sub === "SAVINGS" ? (
        <>
          <Text style={styles.sectionLabel}>{tm("createSavings")}</Text>
          <TextInput
            style={styles.input}
            placeholder="Goal name"
            placeholderTextColor="#8aa39a"
            value={savingsForm.name}
            onChangeText={(name) => setSavingsForm((c) => ({ ...c, name }))}
          />
          <View style={styles.statusRow}>
            {accounts.map((account) => (
              <Pressable key={account.id} onPress={() => setSavingsForm((c) => ({ ...c, wallet_account_id: account.id }))}>
                <Text style={[styles.statusPill, savingsForm.wallet_account_id === account.id ? styles.ok : null]}>{account.name}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            style={styles.input}
            placeholder={tm("targetAmount")}
            placeholderTextColor="#8aa39a"
            keyboardType="decimal-pad"
            value={savingsForm.target_amount}
            onChangeText={(target_amount) => setSavingsForm((c) => ({ ...c, target_amount }))}
          />
          <Pressable style={styles.primaryButton} onPress={() => void createSavings()} disabled={loading}>
            <Text style={styles.primaryButtonText}>{loading ? tm("saving") : tm("createSavingsBtn")}</Text>
          </Pressable>

          <Text style={styles.sectionLabel}>{tm("savingsDepositWithdraw")}</Text>
          <View style={styles.statusRow}>
            {(["deposit", "withdraw"] as const).map((action) => (
              <Pressable key={action} onPress={() => setSavingsAction((c) => ({ ...c, action }))}>
                <Text style={[styles.statusPill, savingsAction.action === action ? styles.ok : null]}>
                  {action === "deposit" ? tm("deposit") : tm("withdraw")}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.statusRow}>
            {savings.map((goal) => (
              <Pressable key={goal.id} onPress={() => setSavingsAction((c) => ({ ...c, savings_goal_id: goal.id }))}>
                <Text style={[styles.statusPill, savingsAction.savings_goal_id === goal.id ? styles.ok : null]}>{goal.name}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.statusRow}>
            {accounts.map((account) => (
              <Pressable key={account.id} onPress={() => setSavingsAction((c) => ({ ...c, wallet_account_id: account.id }))}>
                <Text style={[styles.statusPill, savingsAction.wallet_account_id === account.id ? styles.ok : null]}>{account.name}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            style={styles.input}
            placeholder={tm("amount")}
            placeholderTextColor="#8aa39a"
            keyboardType="decimal-pad"
            value={savingsAction.amount}
            onChangeText={(amount) => setSavingsAction((c) => ({ ...c, amount }))}
          />
          <Pressable style={styles.primaryButton} onPress={() => void postSavingsMoney()} disabled={loading}>
            <Text style={styles.primaryButtonText}>{loading ? tm("saving") : tm("postSavingsAction")}</Text>
          </Pressable>

          <Text style={styles.sectionLabel}>{tm("savings")}</Text>
          {savings.length === 0 ? <Text style={styles.muted}>{tm("savings")}</Text> : null}
          {savings.map((goal) => (
            <View style={styles.listRow} key={goal.id}>
              <Text style={styles.listTitle}>{goal.name}</Text>
              <Text style={styles.muted}>
                {goal.goal_type || "GENERAL"} · {formatAmount(goal.current_amount, goal.currency || currency)} /{" "}
                {formatAmount(goal.target_amount, goal.currency || currency)} · {String(goal.progress_percent || 0)}% ·{" "}
                {goal.status || "ACTIVE"}
              </Text>
              <View style={styles.statusRow}>
                {String(goal.status || "ACTIVE").toUpperCase() === "ACTIVE" ? (
                  <>
                    <Pressable
                      onPress={() =>
                        setSavingsEdit({
                          id: goal.id,
                          name: goal.name,
                          target_amount: String(goal.target_amount || ""),
                          note: goal.note || "",
                        })
                      }
                    >
                      <Text style={[styles.statusPill, savingsEdit?.id === goal.id ? styles.ok : null]}>{tm("edit")}</Text>
                    </Pressable>
                    <Pressable onPress={() => void closeSavings(goal)} disabled={loading}>
                      <Text style={[styles.statusPill, styles.failed]}>{tm("close")}</Text>
                    </Pressable>
                  </>
                ) : null}
                <Pressable onPress={() => void loadEntityHistory("savings", goal.id)} disabled={historyLoading && historyForId === goal.id}>
                  <Text style={[styles.statusPill, historyKind === "savings" && historyForId === goal.id ? styles.ok : null]}>
                    {tm("history")}
                  </Text>
                </Pressable>
              </View>
              {savingsEdit?.id === goal.id ? (
                <View style={{ gap: 8, marginTop: 6 }}>
                  <TextInput
                    style={styles.input}
                    placeholder={tm("namePlaceholder")}
                    placeholderTextColor="#8aa39a"
                    value={savingsEdit.name}
                    onChangeText={(name) => setSavingsEdit((c) => (c ? { ...c, name } : c))}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder={tm("targetAmount")}
                    placeholderTextColor="#8aa39a"
                    keyboardType="decimal-pad"
                    value={savingsEdit.target_amount}
                    onChangeText={(target_amount) => setSavingsEdit((c) => (c ? { ...c, target_amount } : c))}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder={tm("note")}
                    placeholderTextColor="#8aa39a"
                    value={savingsEdit.note}
                    onChangeText={(note) => setSavingsEdit((c) => (c ? { ...c, note } : c))}
                  />
                  <View style={styles.statusRow}>
                    <Pressable onPress={() => void saveSavingsEdit()} disabled={loading}>
                      <Text style={[styles.statusPill, styles.ok]}>{tm("save")}</Text>
                    </Pressable>
                    <Pressable onPress={() => setSavingsEdit(null)}>
                      <Text style={styles.statusPill}>{tm("cancelEdit")}</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}
              {renderHistoryBlock("savings", goal.id, goal.name)}
            </View>
          ))}
        </>
      ) : null}

      {sub === "LOANS" ? (
        <>
          <Text style={styles.sectionLabel}>{tm("createLoan")}</Text>
          <View style={styles.statusRow}>
            {LOAN_TYPES.map((type) => (
              <Pressable key={type} onPress={() => setLoanForm((c) => ({ ...c, loan_type: type }))}>
                <Text style={[styles.statusPill, loanForm.loan_type === type ? styles.ok : null]}>{el(type)}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            style={styles.input}
            placeholder={tm("personName")}
            placeholderTextColor="#8aa39a"
            value={loanForm.person_name}
            onChangeText={(person_name) => setLoanForm((c) => ({ ...c, person_name }))}
          />
          <View style={styles.statusRow}>
            {accounts.map((account) => (
              <Pressable key={account.id} onPress={() => setLoanForm((c) => ({ ...c, wallet_account_id: account.id }))}>
                <Text style={[styles.statusPill, loanForm.wallet_account_id === account.id ? styles.ok : null]}>{account.name}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            style={styles.input}
            placeholder={tm("loanAmount")}
            placeholderTextColor="#8aa39a"
            keyboardType="decimal-pad"
            value={loanForm.principal_amount}
            onChangeText={(principal_amount) => setLoanForm((c) => ({ ...c, principal_amount }))}
          />
          <TextInput
            style={styles.input}
            placeholder={tm("note")}
            placeholderTextColor="#8aa39a"
            value={loanForm.note}
            onChangeText={(note) => setLoanForm((c) => ({ ...c, note }))}
          />
          <Pressable style={styles.primaryButton} onPress={() => void createLoan()} disabled={loading}>
            <Text style={styles.primaryButtonText}>{loading ? tm("saving") : tm("createLoanBtn")}</Text>
          </Pressable>

          <Text style={styles.sectionLabel}>{tm("loanPayment")}</Text>
          <View style={styles.statusRow}>
            {loans.filter((loan) => String(loan.status || "ACTIVE").toUpperCase() === "ACTIVE").map((loan) => (
              <Pressable key={loan.id} onPress={() => setLoanPayment((c) => ({ ...c, loan_id: loan.id }))}>
                <Text style={[styles.statusPill, loanPayment.loan_id === loan.id ? styles.ok : null]}>
                  {loan.person_name}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.statusRow}>
            {accounts.map((account) => (
              <Pressable key={account.id} onPress={() => setLoanPayment((c) => ({ ...c, wallet_account_id: account.id }))}>
                <Text style={[styles.statusPill, loanPayment.wallet_account_id === account.id ? styles.ok : null]}>{account.name}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            style={styles.input}
            placeholder={tm("amount")}
            placeholderTextColor="#8aa39a"
            keyboardType="decimal-pad"
            value={loanPayment.amount}
            onChangeText={(amount) => setLoanPayment((c) => ({ ...c, amount }))}
          />
          <Pressable style={styles.primaryButton} onPress={() => void postLoanPay()} disabled={loading}>
            <Text style={styles.primaryButtonText}>{loading ? tm("saving") : tm("postLoanPayment")}</Text>
          </Pressable>

          <Text style={styles.sectionLabel}>{tm("loans")}</Text>
          <TextInput
            style={styles.input}
            placeholder={tm("searchTitleDescription") || "Search"}
            placeholderTextColor="#8aa39a"
            value={loanSearch}
            onChangeText={setLoanSearch}
          />
          <View style={styles.statusRow}>
            {(["ALL", "ACTIVE", "CLOSED", "SETTLED"] as const).map((status) => (
              <Pressable key={status} onPress={() => setLoanStatusFilter(status)}>
                <Text style={[styles.statusPill, loanStatusFilter === status ? styles.ok : null]}>
                  {status === "ALL" ? tm("allStatus") : el(status)}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.statusRow}>
            {(["ALL", ...LOAN_TYPES] as const).map((type) => (
              <Pressable key={type} onPress={() => setLoanTypeFilter(type)}>
                <Text style={[styles.statusPill, loanTypeFilter === type ? styles.ok : null]}>
                  {type === "ALL" ? tm("allType") : el(type)}
                </Text>
              </Pressable>
            ))}
          </View>
          {filteredLoans.length === 0 ? <Text style={styles.muted}>{tm("loans")}</Text> : null}
          {filteredLoans.map((loan) => (
            <View style={styles.listRow} key={loan.id}>
              <Text style={styles.listTitle}>
                {loan.loan_type} · {loan.person_name}
              </Text>
              <Text style={styles.muted}>
                remaining {formatAmount(loan.remaining_amount, loan.currency || currency)} / principal{" "}
                {formatAmount(loan.principal_amount, loan.currency || currency)} · {loan.status || "ACTIVE"}
              </Text>
              <View style={styles.statusRow}>
                {String(loan.status || "ACTIVE").toUpperCase() === "ACTIVE" ? (
                  <>
                    <Pressable
                      onPress={() =>
                        setLoanEdit({
                          id: loan.id,
                          person_name: loan.person_name,
                          note: loan.note || "",
                        })
                      }
                    >
                      <Text style={[styles.statusPill, loanEdit?.id === loan.id ? styles.ok : null]}>{tm("edit")}</Text>
                    </Pressable>
                    <Pressable onPress={() => void closeLoan(loan)} disabled={loading}>
                      <Text style={[styles.statusPill, styles.failed]}>{tm("close")}</Text>
                    </Pressable>
                  </>
                ) : null}
                <Pressable onPress={() => void loadEntityHistory("loans", loan.id)} disabled={historyLoading && historyForId === loan.id}>
                  <Text style={[styles.statusPill, historyKind === "loans" && historyForId === loan.id ? styles.ok : null]}>
                    {tm("history")}
                  </Text>
                </Pressable>
              </View>
              {loanEdit?.id === loan.id ? (
                <View style={{ gap: 8, marginTop: 6 }}>
                  <TextInput
                    style={styles.input}
                    placeholder={tm("personName")}
                    placeholderTextColor="#8aa39a"
                    value={loanEdit.person_name}
                    onChangeText={(person_name) => setLoanEdit((c) => (c ? { ...c, person_name } : c))}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder={tm("note")}
                    placeholderTextColor="#8aa39a"
                    value={loanEdit.note}
                    onChangeText={(note) => setLoanEdit((c) => (c ? { ...c, note } : c))}
                  />
                  <View style={styles.statusRow}>
                    <Pressable onPress={() => void saveLoanEdit()} disabled={loading}>
                      <Text style={[styles.statusPill, styles.ok]}>{tm("save")}</Text>
                    </Pressable>
                    <Pressable onPress={() => setLoanEdit(null)}>
                      <Text style={styles.statusPill}>{tm("cancelEdit")}</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}
              {renderHistoryBlock("loans", loan.id, loan.person_name)}
            </View>
          ))}
        </>
      ) : null}

      {sub === "GOALS" ? (
        <>
          <Text style={styles.sectionLabel}>{tm("createGoal")}</Text>
          <TextInput
            style={styles.input}
            placeholder={tm("goalName")}
            placeholderTextColor="#8aa39a"
            value={goalForm.goal_name}
            onChangeText={(goal_name) => setGoalForm((c) => ({ ...c, goal_name }))}
          />
          <TextInput
            style={styles.input}
            placeholder={tm("targetAmount")}
            placeholderTextColor="#8aa39a"
            keyboardType="decimal-pad"
            value={goalForm.target_amount}
            onChangeText={(target_amount) => setGoalForm((c) => ({ ...c, target_amount }))}
          />
          <Pressable style={styles.primaryButton} onPress={() => void createGoal()} disabled={loading}>
            <Text style={styles.primaryButtonText}>{loading ? tm("saving") : tm("createGoalBtn")}</Text>
          </Pressable>

          <Text style={styles.sectionLabel}>{tm("goalContributeWithdraw")}</Text>
          <View style={styles.statusRow}>
            {(["contribute", "withdraw"] as const).map((action) => (
              <Pressable key={action} onPress={() => setGoalAction((c) => ({ ...c, action }))}>
                <Text style={[styles.statusPill, goalAction.action === action ? styles.ok : null]}>
                  {action === "contribute" ? tm("contribute") : tm("withdraw")}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.statusRow}>
            {goals.map((goal) => (
              <Pressable key={goal.id} onPress={() => setGoalAction((c) => ({ ...c, goal_id: goal.id }))}>
                <Text style={[styles.statusPill, goalAction.goal_id === goal.id ? styles.ok : null]}>
                  {goal.goal_name || goal.name}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.statusRow}>
            {accounts.map((account) => (
              <Pressable key={account.id} onPress={() => setGoalAction((c) => ({ ...c, wallet_account_id: account.id }))}>
                <Text style={[styles.statusPill, goalAction.wallet_account_id === account.id ? styles.ok : null]}>{account.name}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            style={styles.input}
            placeholder={tm("amount")}
            placeholderTextColor="#8aa39a"
            keyboardType="decimal-pad"
            value={goalAction.amount}
            onChangeText={(amount) => setGoalAction((c) => ({ ...c, amount }))}
          />
          <Pressable style={styles.primaryButton} onPress={() => void postGoalMoney()} disabled={loading}>
            <Text style={styles.primaryButtonText}>{loading ? tm("saving") : tm("postGoalAction")}</Text>
          </Pressable>

          <Text style={styles.sectionLabel}>{tm("goals")}</Text>
          {goals.length === 0 ? <Text style={styles.muted}>{tm("goals")}</Text> : null}
          {goals.map((goal) => (
            <View style={styles.listRow} key={goal.id}>
              <Text style={styles.listTitle}>{goal.goal_name || goal.name}</Text>
              <Text style={styles.muted}>
                {goal.goal_type || "GENERAL"} · {formatAmount(goal.current_amount, goal.currency || currency)} /{" "}
                {formatAmount(goal.target_amount, goal.currency || currency)} · {goal.status || "ACTIVE"}
              </Text>
              <View style={styles.statusRow}>
                {String(goal.status || "ACTIVE").toUpperCase() === "ACTIVE" ? (
                  <>
                    <Pressable
                      onPress={() =>
                        setGoalEdit({
                          id: goal.id,
                          goal_name: goal.goal_name || goal.name || "",
                          goal_type: goal.goal_type || "GENERAL",
                          target_amount: String(goal.target_amount || ""),
                          target_date: goal.target_date ? String(goal.target_date).slice(0, 10) : "",
                          note: goal.note || "",
                        })
                      }
                    >
                      <Text style={[styles.statusPill, goalEdit?.id === goal.id ? styles.ok : null]}>{tm("edit")}</Text>
                    </Pressable>
                    <Pressable onPress={() => void closeGoal(goal)} disabled={loading}>
                      <Text style={[styles.statusPill, styles.failed]}>{tm("close")}</Text>
                    </Pressable>
                  </>
                ) : null}
                <Pressable onPress={() => void loadEntityHistory("goals", goal.id)} disabled={historyLoading && historyForId === goal.id}>
                  <Text style={[styles.statusPill, historyKind === "goals" && historyForId === goal.id ? styles.ok : null]}>
                    {tm("history")}
                  </Text>
                </Pressable>
              </View>
              {goalEdit?.id === goal.id ? (
                <View style={{ gap: 8, marginTop: 6 }}>
                  <TextInput
                    style={styles.input}
                    placeholder={tm("goalName")}
                    placeholderTextColor="#8aa39a"
                    value={goalEdit.goal_name}
                    onChangeText={(goal_name) => setGoalEdit((c) => (c ? { ...c, goal_name } : c))}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder={tm("targetAmount")}
                    placeholderTextColor="#8aa39a"
                    keyboardType="decimal-pad"
                    value={goalEdit.target_amount}
                    onChangeText={(target_amount) => setGoalEdit((c) => (c ? { ...c, target_amount } : c))}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor="#8aa39a"
                    value={goalEdit.target_date}
                    onChangeText={(target_date) => setGoalEdit((c) => (c ? { ...c, target_date } : c))}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder={tm("note")}
                    placeholderTextColor="#8aa39a"
                    value={goalEdit.note}
                    onChangeText={(note) => setGoalEdit((c) => (c ? { ...c, note } : c))}
                  />
                  <View style={styles.statusRow}>
                    <Pressable onPress={() => void saveGoalEdit()} disabled={loading}>
                      <Text style={[styles.statusPill, styles.ok]}>{tm("save")}</Text>
                    </Pressable>
                    <Pressable onPress={() => setGoalEdit(null)}>
                      <Text style={styles.statusPill}>{tm("cancelEdit")}</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}
              {renderHistoryBlock("goals", goal.id, goal.goal_name || goal.name || "Goal")}
            </View>
          ))}
        </>
      ) : null}

      {sub === "RECURRING" ? (
        <>
          <Text style={styles.sectionLabel}>{tm("createRecurring")}</Text>
          <TextInput
            style={styles.input}
            placeholder={tm("recurringTitle")}
            placeholderTextColor="#8aa39a"
            value={recurringForm.title}
            onChangeText={(title) => setRecurringForm((c) => ({ ...c, title }))}
          />
          <View style={styles.statusRow}>
            {(["EXPENSE", "INCOME"] as const).map((type) => (
              <Pressable key={type} onPress={() => setRecurringForm((c) => ({ ...c, transaction_type: type }))}>
                <Text style={[styles.statusPill, recurringForm.transaction_type === type ? styles.ok : null]}>{el(type)}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.statusRow}>
            {accounts.map((account) => (
              <Pressable key={account.id} onPress={() => setRecurringForm((c) => ({ ...c, account_id: account.id }))}>
                <Text style={[styles.statusPill, recurringForm.account_id === account.id ? styles.ok : null]}>{account.name}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            style={styles.input}
            placeholder={tm("amount")}
            placeholderTextColor="#8aa39a"
            keyboardType="decimal-pad"
            value={recurringForm.amount}
            onChangeText={(amount) => setRecurringForm((c) => ({ ...c, amount }))}
          />
          <View style={styles.statusRow}>
            {(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"] as const).map((frequency) => (
              <Pressable key={frequency} onPress={() => setRecurringForm((c) => ({ ...c, frequency }))}>
                <Text style={[styles.statusPill, recurringForm.frequency === frequency ? styles.ok : null]}>{el(frequency)}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            style={styles.input}
            placeholder="YYYY-MM-DD"
            placeholderTextColor="#8aa39a"
            value={recurringForm.start_date}
            onChangeText={(start_date) => setRecurringForm((c) => ({ ...c, start_date }))}
          />
          <TextInput
            style={styles.input}
            placeholder={`${tm("end") || "End"} YYYY-MM-DD`}
            placeholderTextColor="#8aa39a"
            value={recurringForm.end_date}
            onChangeText={(end_date) => setRecurringForm((c) => ({ ...c, end_date }))}
          />
          <TextInput
            style={styles.input}
            placeholder={tm("description") || "Description"}
            placeholderTextColor="#8aa39a"
            value={recurringForm.description}
            onChangeText={(description) => setRecurringForm((c) => ({ ...c, description }))}
          />
          <Pressable style={styles.primaryButton} onPress={() => void createRecurring()} disabled={loading}>
            <Text style={styles.primaryButtonText}>{loading ? tm("saving") : tm("createRecurringBtn")}</Text>
          </Pressable>

          <Text style={styles.sectionLabel}>{tm("recurringSearchFilter")}</Text>
          <TextInput
            style={styles.input}
            placeholder={tm("searchTitleDescription")}
            placeholderTextColor="#8aa39a"
            value={recurringSearch}
            onChangeText={setRecurringSearch}
          />
          <View style={styles.statusRow}>
            {(["ALL", "ACTIVE", "PAUSED", "COMPLETED", "CLOSED"] as const).map((status) => (
              <Pressable key={status} onPress={() => setRecurringStatusFilter(status)}>
                <Text style={[styles.statusPill, recurringStatusFilter === status ? styles.ok : null]}>
                  {status === "ALL" ? tm("allStatus") : el(status)}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.statusRow}>
            {(["ALL", "INCOME", "EXPENSE"] as const).map((type) => (
              <Pressable key={type} onPress={() => setRecurringTypeFilter(type)}>
                <Text style={[styles.statusPill, recurringTypeFilter === type ? styles.ok : null]}>
                  {type === "ALL" ? tm("allType") : el(type)}
                </Text>
              </Pressable>
            ))}
          </View>
          <Pressable
            onPress={() => {
              setRecurringSearch("");
              setRecurringStatusFilter("ALL");
              setRecurringTypeFilter("ALL");
            }}
          >
            <Text style={styles.statusPill}>{tm("clearFilters")}</Text>
          </Pressable>

          <Text style={styles.sectionLabel}>{tm("recurring")}</Text>
          {filteredRecurring.length === 0 ? <Text style={styles.muted}>{tm("recurring")}</Text> : null}
          {filteredRecurring.map((item) => (
            <View style={styles.listRow} key={item.id}>
              <Text style={styles.listTitle}>{item.title}</Text>
              <Text style={styles.muted}>
                {item.transaction_type} · {formatAmount(item.amount, item.currency || currency)} · {item.frequency} · due{" "}
                {String(item.next_due_date || "").slice(0, 10)} · {item.status || "ACTIVE"}
              </Text>
              <View style={styles.statusRow}>
                {String(item.status || "").toUpperCase() === "ACTIVE" ? (
                  <Pressable onPress={() => void postRecurringNow(item)} disabled={loading}>
                    <Text style={styles.statusPill}>{tm("postNow")}</Text>
                  </Pressable>
                ) : null}
                {["ACTIVE", "PAUSED"].includes(String(item.status || "").toUpperCase()) ? (
                  <Pressable
                    onPress={() =>
                      setRecurringEdit({
                        id: item.id,
                        title: item.title || "",
                        amount: String(item.amount || ""),
                        frequency: item.frequency || "MONTHLY",
                        end_date: item.end_date ? String(item.end_date).slice(0, 10) : "",
                        description: item.description || "",
                      })
                    }
                  >
                    <Text style={[styles.statusPill, recurringEdit?.id === item.id ? styles.ok : null]}>{tm("edit")}</Text>
                  </Pressable>
                ) : null}
                <Pressable onPress={() => void loadEntityHistory("recurring", item.id)} disabled={historyLoading && historyForId === item.id}>
                  <Text style={[styles.statusPill, historyKind === "recurring" && historyForId === item.id ? styles.ok : null]}>
                    {tm("history")}
                  </Text>
                </Pressable>
                {String(item.status || "").toUpperCase() === "ACTIVE" ? (
                  <Pressable onPress={() => void setRecurringStatus(item, "PAUSE")}>
                    <Text style={styles.statusPill}>{tm("pause")}</Text>
                  </Pressable>
                ) : null}
                {String(item.status || "").toUpperCase() === "PAUSED" ? (
                  <Pressable onPress={() => void setRecurringStatus(item, "RESUME")}>
                    <Text style={styles.statusPill}>{tm("resume")}</Text>
                  </Pressable>
                ) : null}
                {String(item.status || "").toUpperCase() !== "CLOSED" ? (
                  <Pressable onPress={() => void setRecurringStatus(item, "CLOSE")}>
                    <Text style={[styles.statusPill, styles.failed]}>{tm("close")}</Text>
                  </Pressable>
                ) : null}
              </View>
              {recurringEdit?.id === item.id ? (
                <View style={{ gap: 8, marginTop: 6 }}>
                  <TextInput
                    style={styles.input}
                    placeholder={tm("recurringTitle")}
                    placeholderTextColor="#8aa39a"
                    value={recurringEdit.title}
                    onChangeText={(title) => setRecurringEdit((c) => (c ? { ...c, title } : c))}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder={tm("amount")}
                    placeholderTextColor="#8aa39a"
                    keyboardType="decimal-pad"
                    value={recurringEdit.amount}
                    onChangeText={(amount) => setRecurringEdit((c) => (c ? { ...c, amount } : c))}
                  />
                  <View style={styles.statusRow}>
                    {(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"] as const).map((frequency) => (
                      <Pressable key={frequency} onPress={() => setRecurringEdit((c) => (c ? { ...c, frequency } : c))}>
                        <Text style={[styles.statusPill, recurringEdit.frequency === frequency ? styles.ok : null]}>{el(frequency)}</Text>
                      </Pressable>
                    ))}
                  </View>
                  <TextInput
                    style={styles.input}
                    placeholder={`${tm("endDate") || "End date"} YYYY-MM-DD`}
                    placeholderTextColor="#8aa39a"
                    value={recurringEdit.end_date}
                    onChangeText={(end_date) => setRecurringEdit((c) => (c ? { ...c, end_date } : c))}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder={tm("description")}
                    placeholderTextColor="#8aa39a"
                    value={recurringEdit.description}
                    onChangeText={(description) => setRecurringEdit((c) => (c ? { ...c, description } : c))}
                  />
                  <View style={styles.statusRow}>
                    <Pressable onPress={() => void saveRecurringEdit()} disabled={loading}>
                      <Text style={[styles.statusPill, styles.ok]}>{tm("save")}</Text>
                    </Pressable>
                    <Pressable onPress={() => setRecurringEdit(null)}>
                      <Text style={styles.statusPill}>{tm("cancelEdit")}</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}
              {renderHistoryBlock("recurring", item.id, item.title)}
            </View>
          ))}
        </>
      ) : null}
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { backgroundColor: "#ffffff", borderColor: "#dce7e3", borderWidth: 1, borderRadius: 24, padding: 16, gap: 12 },
  panelTitle: { color: "#17211e", fontSize: 20, fontWeight: "900" },
  muted: { color: "#6c7b76", fontSize: 13, lineHeight: 19 },
  input: {
    backgroundColor: "#f8fbfa",
    borderColor: "#dce7e3",
    borderWidth: 1,
    borderRadius: 16,
    color: "#17211e",
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  primaryButton: { backgroundColor: "#0f8f6f", borderRadius: 16, paddingVertical: 14, alignItems: "center" },
  primaryButtonText: { color: "#ffffff", fontWeight: "900", fontSize: 15 },
  secondaryButton: {
    backgroundColor: "#e0f4ed",
    borderRadius: 16,
    paddingVertical: 12,
    alignItems: "center",
    borderColor: "#b7ddd1",
    borderWidth: 1,
  },
  secondaryButtonText: { color: "#0b6f58", fontWeight: "800", fontSize: 14 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  linkText: { color: "#0f8f6f", fontWeight: "800" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  metricCard: { flexGrow: 1, minWidth: "30%", backgroundColor: "#f8fbfa", borderRadius: 18, padding: 12 },
  metricLabel: { color: "#6c7b76", fontSize: 12, fontWeight: "700" },
  metricValue: { color: "#17211e", fontSize: 18, fontWeight: "900", marginTop: 6 },
  statusRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  statusPill: {
    color: "#0b6f58",
    backgroundColor: "#e0f4ed",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 12,
    fontWeight: "800",
  },
  ok: { backgroundColor: "#0f8f6f", color: "#ffffff" },
  failed: { backgroundColor: "#fee9e9", color: "#dc2626" },
  listRow: { borderTopColor: "#dce7e3", borderTopWidth: 1, paddingTop: 10, gap: 2 },
  listTitle: { color: "#17211e", fontWeight: "900", fontSize: 15 },
  sectionLabel: { color: "#0b6f58", fontWeight: "900", marginTop: 6 },
});
