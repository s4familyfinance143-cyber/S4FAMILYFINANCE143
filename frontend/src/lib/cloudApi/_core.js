/**
 * Firebase-first API shim: serve App apiGet/apiPost/apiPatch/apiDelete from
 * IndexedDB snapshots (synced to Firestore via pushCloudSnapshot).
 */
import { loadOfflineSnapshot, saveOfflineSnapshot } from "../offlineCache";
import {
  buildLocalBudget,
  buildBudgetStatusSummary,
  enrichBudgetsFromLedger,
  normalizeBudgetsList,
  persistableBudgets,
  budgetDuplicateKey,
  buildLocalSavingsGoal,
  enrichSavingsGoals,
  normalizeSavingsList,
  buildSavingsMovementTx,
  recomputeSavingsFromLedger,
  buildSavingsAnnualPlan,
  recomputeWalletBalancesFromLedger,
  sortTransactionsNewestFirst,
  buildLocalLoan,
  buildLoanMovementTx,
  loanHistoryFromLedger,
  applyLoanPayment,
  walletBalance,
  buildLocalGoal,
  enrichGoals,
  buildGoalSummary,
  buildGoalMovementTx,
  recomputeGoalsFromLedger,
  goalHistoryFromLedger,
  buildLocalRecurring,
  buildRecurringPostTx,
  advanceRecurringAfterPost,
  recurringHistoryFromLedger,
} from "../cloudLocalFinance";
import {
  FAMILY_ROLE_RANK,
  defaultPermissionsForRole,
  applyPermissionOverrides,
  normalizeFamilyRole,
  preferElevatedRole,
  sanitizeRelationshipLabel,
} from "../familyRoles";


export function normalizeMemberRole(member) {
  return normalizeFamilyRole(member);
}

export async function resolveFamilyOwnerUid(familyId, currentUser, members = []) {
  const fromUser = String(currentUser?.family_owner_uid || "").trim();
  if (fromUser) return fromUser;

  try {
    const profile = await readDoc(familyId, "system", "familyProfile", {});
    const fromProfile = String(profile?.owner_uid || profile?.owner_id || "").trim();
    if (fromProfile) return fromProfile;
  } catch {
    /* ignore */
  }

  try {
    const { getFirestoreDb } = await import("../../firebase/config");
    const { doc, getDoc } = await import("firebase/firestore");
    const db = getFirestoreDb();
    if (db) {
      const snap = await getDoc(doc(db, "families", familyId));
      const fromMeta = String(snap.data()?.owner_uid || "").trim();
      if (fromMeta) return fromMeta;
    }
  } catch {
    /* offline */
  }

  const ownerRow = (members || []).find((m) => normalizeMemberRole(m) === "OWNER");
  return String(ownerRow?.uid || ownerRow?.user_id || ownerRow?.member_id || ownerRow?.id || "").trim();
}

export function relationshipFromMember(member, role = "") {
  return sanitizeRelationshipLabel(
    member?.relationship_display_label ||
      member?.relationship ||
      member?.relationship_type ||
      member?.relation ||
      "",
    role || normalizeMemberRole(member),
  );
}

export function newId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function stripQuery(path) {
  return String(path || "").split("?")[0];
}

export function queryParam(path, key) {
  const q = String(path || "").split("?")[1] || "";
  const params = new URLSearchParams(q);
  return params.get(key) || "";
}

export async function readList(familyId, module, name, fallback = []) {
  const row = await loadOfflineSnapshot(familyId, module, name).catch(() => null);
  const data = row?.data;
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  if (data && Array.isArray(data.rows)) return data.rows;
  if (data && Array.isArray(data.records)) return data.records;
  return Array.isArray(fallback) ? fallback : [];
}

export async function writeList(familyId, module, name, list) {
  await saveOfflineSnapshot(familyId, module, name, list);
  return list;
}

export async function readDoc(familyId, module, name, fallback = {}) {
  const row = await loadOfflineSnapshot(familyId, module, name).catch(() => null);
  return row?.data && typeof row.data === "object" ? row.data : fallback;
}

export async function writeDoc(familyId, module, name, data) {
  await saveOfflineSnapshot(familyId, module, name, data);
  return data;
}

export async function readBudgets(familyId) {
  const row = await loadOfflineSnapshot(familyId, "finance", "budgets").catch(() => null);
  return normalizeBudgetsList(row?.data);
}

export async function writeBudgets(familyId, list) {
  return writeList(familyId, "finance", "budgets", persistableBudgets(list));
}

export async function appendAudit(familyId, entry) {
  const rows = await readList(familyId, "system", "audit", []);
  const action = entry?.action_type || entry?.action || "ACTION";
  const now = new Date().toISOString();
  const next = [
    {
      id: newId("aud"),
      ...entry,
      action,
      action_type: entry?.action_type || action,
      entity_type: entry?.entity_type || String(action).split(".")[0] || "system",
      entity_id: entry?.entity_id || entry?.member_id || null,
      severity: entry?.severity || "INFO",
      title: entry?.title || action,
      at: entry?.at || now,
      created_at: entry?.created_at || entry?.at || now,
    },
    ...rows,
  ].slice(0, 200);
  await writeList(familyId, "system", "audit", next);
  return next;
}

export function normalizeAuditRow(row) {
  if (!row || typeof row !== "object") return row;
  const action = row.action_type || row.action || "ACTION";
  return {
    ...row,
    action_type: action,
    entity_type: row.entity_type || String(action).split(".")[0] || "system",
    created_at: row.created_at || row.at || null,
    severity: row.severity || "INFO",
    title: row.title || row.description || action,
  };
}

export function buildAuditSummary(rows) {
  const list = (Array.isArray(rows) ? rows : []).map(normalizeAuditRow);
  const byActionMap = new Map();
  const byEntityMap = new Map();
  const bySeverityMap = new Map();
  for (const r of list) {
    const a = r.action_type || "ACTION";
    const e = r.entity_type || "system";
    const s = r.severity || "INFO";
    byActionMap.set(a, (byActionMap.get(a) || 0) + 1);
    byEntityMap.set(e, (byEntityMap.get(e) || 0) + 1);
    bySeverityMap.set(s, (bySeverityMap.get(s) || 0) + 1);
  }
  const toArr = (m, keyName) =>
    [...m.entries()].map(([k, count]) => ({ [keyName]: k, count })).sort((a, b) => b.count - a.count);
  return {
    total_events: list.length,
    total_audit_rows: list.length,
    by_action_type: toArr(byActionMap, "action_type"),
    by_entity_type: toArr(byEntityMap, "entity_type"),
    by_severity: toArr(bySeverityMap, "severity"),
    source: "cloud_local",
  };
}

export function txType(t) {
  return String(t?.type || t?.transaction_type || "").toUpperCase();
}

export function activeWallets(list) {
  return (Array.isArray(list) ? list : []).filter((w) => !w?.deleted_at && w?.is_active !== false);
}

export function activeTransactions(list) {
  return (Array.isArray(list) ? list : []).filter((t) => String(t?.status || "").toUpperCase() !== "VOID");
}

export async function buildFinancialSummary(familyId) {
  const wallets = activeWallets(await readList(familyId, "finance", "wallets"));
  const txs = activeTransactions(await readList(familyId, "finance", "transactions"));
  let totalDebit = 0;
  let totalCredit = 0;
  const byType = new Map();
  for (const t of txs) {
    const amount = Number(t.amount || 0) || 0;
    const type = txType(t);
    const isExpense = type.includes("EXPENSE") || type.includes("DEBIT") || type === "TRANSFER_OUT";
    const isIncome = type.includes("INCOME") || type.includes("CREDIT") || type === "TRANSFER_IN";
    if (isExpense) totalDebit += amount;
    if (isIncome) totalCredit += amount;
    const wallet = wallets.find((w) => String(w.id) === String(t.account_id || t.wallet_id || t.from_account_id));
    const accountType = wallet?.account_type || t.account_type || "OTHER";
    if (!byType.has(accountType)) byType.set(accountType, { account_type: accountType, total_debit: 0, total_credit: 0, count: 0 });
    const row = byType.get(accountType);
    row.count += 1;
    if (isExpense) row.total_debit += amount;
    if (isIncome) row.total_credit += amount;
  }
  return {
    summary: {
      transaction_count: txs.length,
      total_debit: totalDebit,
      total_credit: totalCredit,
      wallet_count: wallets.length,
      total_balance: wallets.reduce((s, w) => s + Number(w.balance ?? w.current_balance ?? 0), 0),
    },
    account_type_summary: [...byType.values()],
    source: "cloud_local",
  };
}

export async function buildWalletSummary(familyId) {
  const wallets = activeWallets(await readList(familyId, "finance", "wallets"));
  const rows = wallets.map((w) => ({
    id: w.id,
    wallet_id: w.id,
    name: w.name,
    account_type: w.account_type || "CASH",
    currency: w.currency || "BDT",
    current_balance: Number(w.balance ?? w.current_balance ?? 0) || 0,
    balance: Number(w.balance ?? w.current_balance ?? 0) || 0,
  }));
  return {
    wallet_count: rows.length,
    total_current_balance: rows.reduce((s, w) => s + w.current_balance, 0),
    wallets: rows,
    source: "cloud_local",
  };
}

export async function buildAccountLedger(familyId, accountId, limit = 25) {
  const txs = activeTransactions(await readList(familyId, "finance", "transactions"));
  const aid = String(accountId);
  const filtered = txs
    .filter((t) => {
      const ids = [t.account_id, t.wallet_id, t.from_account_id, t.to_account_id].map((x) => String(x || ""));
      return ids.includes(aid);
    })
    .sort((a, b) => String(a.created_at || a.date || "").localeCompare(String(b.created_at || b.date || "")));
  let running = 0;
  const chronological = filtered.map((t) => {
    const amount = Number(t.amount || 0) || 0;
    const type = txType(t);
    const fromId = String(t.from_account_id || "");
    const toId = String(t.to_account_id || "");
    const accountIdMatch = String(t.account_id || t.wallet_id || "") === aid;
    let debit = 0;
    let credit = 0;
    if (type.includes("TRANSFER") || type === "TRANSFER_OUT" || type === "TRANSFER_IN") {
      if (type === "TRANSFER_OUT" || (fromId && fromId === aid)) debit = amount;
      else if (type === "TRANSFER_IN" || (toId && toId === aid)) credit = amount;
      else if (accountIdMatch && fromId === aid) debit = amount;
      else if (accountIdMatch && toId === aid) credit = amount;
      else if (accountIdMatch) {
        // Ambiguous single-account transfer row — treat as outflow from this wallet
        debit = amount;
      }
    } else if (type.includes("EXPENSE") || type.includes("DEBIT")) {
      debit = amount;
    } else if (type.includes("INCOME") || type.includes("CREDIT")) {
      credit = amount;
    } else {
      debit = amount;
    }
    running += credit - debit;
    return {
      id: t.id,
      transaction_id: t.id,
      transaction_date: t.date || t.created_at,
      date: t.date || t.created_at,
      created_at: t.created_at || t.date,
      type,
      amount,
      debit,
      credit,
      running_balance: running,
      description: t.note || t.description || type || "TX",
      note: t.note || t.description || "",
      category: t.category_name || t.category || "",
      currency: t.currency || "BDT",
    };
  });
  const rows = chronological.reverse().slice(0, limit);
  return { account_id: accountId, rows, count: rows.length, source: "cloud_local" };
}

export async function buildExtraReport(familyId, kind) {
  const wallets = activeWallets(await readList(familyId, "finance", "wallets"));
  const txs = activeTransactions(await readList(familyId, "finance", "transactions"));
  const cats = await readList(familyId, "finance", "categories");
  const budgets = await readBudgets(familyId);
  const loans = await readList(familyId, "finance", "loans");
  const savings = await readList(familyId, "finance", "savings");
  const walletBalance = wallets.reduce((s, w) => s + Number(w.balance ?? w.current_balance ?? 0), 0);
  const savingsBalance = (Array.isArray(savings) ? savings : []).reduce(
    (s, g) => s + (Number(g.current_amount ?? g.saved_amount ?? g.balance ?? 0) || 0),
    0,
  );
  const loanList = Array.isArray(loans) ? loans : [];
  const takenLiabilities = loanList
    .filter((l) => String(l.loan_type || l.type || "").toUpperCase() === "TAKEN")
    .reduce((s, l) => s + (Number(l.remaining_amount ?? l.balance ?? l.amount ?? 0) || 0), 0);
  const givenAssets = loanList
    .filter((l) => String(l.loan_type || l.type || "").toUpperCase() !== "TAKEN")
    .reduce((s, l) => s + (Number(l.remaining_amount ?? l.balance ?? l.amount ?? 0) || 0), 0);
  const liabilities = takenLiabilities;
  const income = txs.filter((t) => txType(t).includes("INCOME")).reduce((s, t) => s + Number(t.amount || 0), 0);
  const expense = txs.filter((t) => txType(t).includes("EXPENSE")).reduce((s, t) => s + Number(t.amount || 0), 0);
  if (kind === "net-worth" || kind === "dashboard") {
    return {
      net_worth: walletBalance + savingsBalance + givenAssets - liabilities,
      total_net_worth: walletBalance + savingsBalance + givenAssets - liabilities,
      total_assets: walletBalance + savingsBalance + givenAssets,
      total_liabilities: liabilities,
      liabilities,
      loan_taken_remaining: liabilities,
      loan_given_remaining: givenAssets,
      wallet_balance: walletBalance,
      savings_balance: savingsBalance,
      savings: savingsBalance,
      total_income: income,
      total_expense: expense,
      source: "cloud_local",
    };
  }
  if (kind === "categories") {
    const byCat = new Map();
    for (const t of txs) {
      const id = String(t.category_id || t.category || "uncategorized");
      const name =
        cats.find((c) => String(c.id) === id)?.name || t.category_name || t.category || "Uncategorized";
      if (!byCat.has(id)) byCat.set(id, { category_id: id, name, total: 0, count: 0 });
      const row = byCat.get(id);
      row.total += Number(t.amount || 0) || 0;
      row.count += 1;
    }
    return { categories: [...byCat.values()].sort((a, b) => b.total - a.total), source: "cloud_local" };
  }
  if (kind === "budget") {
    return {
      budgets: (Array.isArray(budgets) ? budgets : []).map((b) => {
        const limit = Number(b.limit_amount ?? b.amount ?? b.budget_amount ?? 0) || 0;
        const spent = Number(b.spent_amount ?? b.spent ?? 0) || 0;
        return {
          id: b.id,
          budget_id: b.id,
          name: b.name || b.category_name || "Budget",
          limit_amount: limit,
          budget_amount: limit,
          amount: limit,
          spent_amount: spent,
          spent,
          currency: b.currency || "BDT",
        };
      }),
      source: "cloud_local",
    };
  }
  if (kind === "loans") {
    return {
      loans: (Array.isArray(loans) ? loans : []).map((l) => ({
        id: l.id,
        loan_id: l.id,
        name: l.name || l.lender || l.person_name || "Loan",
        person_name: l.person_name || l.lender || l.name || "Loan",
        loan_type: l.loan_type || l.type || "",
        type: l.loan_type || l.type || "",
        amount: Number(l.amount ?? l.principal ?? 0) || 0,
        remaining_amount: Number(l.remaining_amount ?? l.balance ?? l.amount ?? 0) || 0,
        remaining: Number(l.remaining_amount ?? l.balance ?? l.amount ?? 0) || 0,
        currency: l.currency || "BDT",
      })),
      source: "cloud_local",
    };
  }
  if (kind === "savings-trend") {
    const points = (Array.isArray(savings) ? savings : []).map((g) => {
      const saved = Number(g.current_amount ?? g.saved_amount ?? g.balance ?? 0) || 0;
      const target = Number(g.target_amount ?? g.target ?? 0) || 0;
      const label = g.name || "Goal";
      return {
        id: g.id,
        name: label,
        label,
        goal_type: g.goal_type || g.type || "",
        target,
        current: saved,
        saved,
        value: saved,
        currency: g.currency || "BDT",
      };
    });
    const chart = points.map((p) => ({ label: p.label, value: p.saved }));
    return {
      points,
      trend: points,
      chart: { bar: chart, line: chart },
      total_saved: points.reduce((s, p) => s + p.saved, 0),
      point_count: points.length,
      source: "cloud_local",
    };
  }
  return { source: "cloud_local" };
}

export function rateToBase(rates, from, base) {
  const fromCode = String(from || base || "BDT").toUpperCase();
  const baseCode = String(base || "BDT").toUpperCase();
  if (fromCode === baseCode) return 1;
  const list = Array.isArray(rates) ? rates : [];
  const direct = list.find(
    (r) =>
      String(r.from_currency || "").toUpperCase() === fromCode &&
      String(r.to_currency || "").toUpperCase() === baseCode,
  );
  if (direct && Number(direct.rate) > 0) return Number(direct.rate);
  const inverse = list.find(
    (r) =>
      String(r.from_currency || "").toUpperCase() === baseCode &&
      String(r.to_currency || "").toUpperCase() === fromCode,
  );
  if (inverse && Number(inverse.rate) > 0) return 1 / Number(inverse.rate);
  return 1;
}

export async function buildCurrencyFamilySummary(familyId, bag) {
  const base = bag?.currencySummary?.base_currency || bag?.code || bag?.base_currency || "BDT";
  const rates = Array.isArray(bag?.exchangeRates) ? bag.exchangeRates : [];
  const wallets = activeWallets(await readList(familyId, "finance", "wallets"));
  const walletRows = wallets.map((w) => {
    const currency = w.currency || base;
    const balance = Number(w.balance ?? w.current_balance ?? 0) || 0;
    const rate = rateToBase(rates, currency, base);
    return {
      wallet_id: w.id,
      wallet_name: w.name,
      wallet_currency: currency,
      balance,
      rate_used: rate,
      converted_balance: balance * rate,
    };
  });
  const currencySet = [...new Set(walletRows.map((w) => w.wallet_currency))];
  return {
    base_currency: base,
    wallet_count: walletRows.length,
    total_converted_balance: walletRows.reduce((s, w) => s + w.converted_balance, 0),
    wallet_currencies: currencySet,
    wallets: walletRows,
    source: "cloud_local",
  };
}

export async function appendNotification(familyId, entry) {
  const rows = await readList(familyId, "system", "notifications", []);
  const next = [
    {
      id: newId("ntf"),
      created_at: new Date().toISOString(),
      read: false,
      ...entry,
    },
    ...rows,
  ].slice(0, 100);
  await writeList(familyId, "system", "notifications", next);
  return next;
}

export async function appendGroceryActivity(familyId, entry) {
  const rows = await readList(familyId, "grocery", "activity", []);
  const next = [
    {
      id: newId("gact"),
      created_at: new Date().toISOString(),
      action_type: entry?.action_type || "UPDATE",
      entity_type: entry?.entity_type || "grocery",
      title: entry?.title || "",
      ...entry,
    },
    ...rows,
  ].slice(0, 100);
  await writeList(familyId, "grocery", "activity", next);
  return next;
}

export async function recomputeGroceryVendorSummary(familyId) {
  const items = await readList(familyId, "grocery", "items");
  const byVendor = new Map();
  for (const item of items) {
    if (!item?.is_bought) continue;
    const name = String(item.vendor_name || "").trim() || "Unknown";
    const price = Number(item.actual_price ?? item.estimated_price ?? 0);
    const cur = byVendor.get(name) || {
      id: `gvsum_${name.toLowerCase().replace(/\s+/g, "_")}`,
      vendor_name: name,
      purchase_count: 0,
      bought_count: 0,
      total_spent: 0,
      source: "cloud_local",
    };
    cur.purchase_count += 1;
    cur.bought_count = cur.purchase_count;
    cur.total_spent += Number.isFinite(price) ? price : 0;
    byVendor.set(name, cur);
  }
  await writeList(familyId, "grocery", "vendorSummary", [...byVendor.values()]);
}

const CLOUD_PERMISSION_CATALOG = [
  "dashboard.read",
  "accounts.create",
  "accounts.read",
  "transactions.create",
  "income.create",
  "expense.create",
  "transactions.read",
  "reports.read",
  "audit.read",
  "backup.create",
  "backup.read",
  "backup.download",
  "backup.restore",
  "sync.view",
  "sync.pull",
  "sync.push",
  "sync.conflicts",
  "sync.resolve",
  "sync.manage",
  "settings.manage",
];

export function memberMatchKey(member) {
  const email = String(member?.email || "").trim().toLowerCase();
  if (email) return `email:${email}`;
  const uid = String(member?.user_id || member?.uid || member?.member_id || member?.id || "").trim();
  if (uid) return `uid:${uid}`;
  return "";
}

export function cloudMemberToLocal(cm) {
  const uid = String(cm?.uid || cm?.id || "").trim();
  const overrides = Array.isArray(cm?.overrides)
    ? cm.overrides
    : Array.isArray(cm?.permission_overrides)
      ? cm.permission_overrides
      : [];
  return {
    id: uid || cm.id,
    member_id: uid || cm.id,
    user_id: uid || cm.user_id || "",
    uid: uid || "",
    full_name: cm.display_name || cm.full_name || cm.name || cm.email || "Member",
    display_name: cm.display_name || cm.full_name || "",
    email: cm.email || "",
    role: cm.role || "MEMBER",
    normalized_role: String(cm.role || "MEMBER").toUpperCase(),
    relationship:
      cm.relationship_display_label ||
      cm.relationship ||
      cm.relationship_type ||
      "",
    relationship_type: cm.relationship_type || cm.relationship || "",
    relationship_display_label: cm.relationship_display_label || "",
    status: cm.status || "ACTIVE",
    overrides,
    permission_overrides: overrides,
    source: "firestore_members",
    updated_at: cm.updated_at || null,
  };
}

export function mergeLocalAndCloudMembers(localRows = [], cloudRows = []) {
  const byKey = new Map();
  for (const row of localRows || []) {
    const key = memberMatchKey(row);
    if (!key) continue;
    byKey.set(key, { ...row });
  }
  for (const cm of cloudRows || []) {
    const mapped = cloudMemberToLocal(cm);
    const key = memberMatchKey(mapped);
    if (!key) continue;
    if (!byKey.has(key)) {
      byKey.set(key, mapped);
      continue;
    }
    const existing = byKey.get(key);
    const cloudOverrides = mapped.overrides || [];
    const localOverrides = Array.isArray(existing.overrides) ? existing.overrides : [];
    const cloudTs = Date.parse(mapped.updated_at || 0) || 0;
    const localTs = Date.parse(existing.updated_at || 0) || 0;
    const cloudRole = String(mapped.role || mapped.normalized_role || "").toUpperCase();
    const localRole = String(existing.role || existing.normalized_role || "").toUpperCase();
    const roleChanged = Boolean(cloudRole && localRole && cloudRole !== localRole);
    // Explicit empty cloud overrides after role clear must win; else prefer fresher non-empty set.
    let overrides;
    if (roleChanged && Array.isArray(mapped.overrides)) {
      overrides = cloudOverrides;
    } else if (localTs > cloudTs && localOverrides.length) {
      overrides = localOverrides;
    } else if (cloudOverrides.length) {
      overrides = cloudOverrides;
    } else if (Array.isArray(mapped.overrides) && cloudTs >= localTs) {
      overrides = cloudOverrides;
    } else {
      overrides = localOverrides;
    }
    byKey.set(key, {
      ...existing,
      ...mapped,
      // Prefer Firestore uid as stable member_id for multi-device overrides
      member_id: mapped.member_id || existing.member_id,
      id: mapped.id || existing.id,
      uid: mapped.uid || existing.uid,
      user_id: mapped.user_id || existing.user_id,
      full_name: mapped.full_name || existing.full_name,
      email: mapped.email || existing.email,
      // Firestore role wins when present — local seed must not outrank cloud MEMBER
      role: mapped.role || existing.role,
      normalized_role: mapped.normalized_role || mapped.role || existing.normalized_role || existing.role,
      relationship: sanitizeRelationshipLabel(
        mapped.relationship || existing.relationship,
        mapped.role || existing.role,
      ),
      relationship_type: sanitizeRelationshipLabel(
        mapped.relationship_type || existing.relationship_type,
        mapped.role || existing.role,
      ),
      overrides,
      permission_overrides: overrides,
      source: existing.source && existing.source !== "cloud_local" ? existing.source : "merged",
    });
  }
  return [...byKey.values()];
}

export function mapFamilyMemberPermissions(member) {
  const role = normalizeMemberRole(member);
  const overrides = Array.isArray(member?.overrides)
    ? member.overrides
    : Array.isArray(member?.permission_overrides)
      ? member.permission_overrides
      : [];
  const base = defaultPermissionsForRole(role);
  const effective = applyPermissionOverrides(base, overrides);
  const relationship = relationshipFromMember(member, role);
  return {
    ...member,
    member_id: member.member_id || member.id || member.uid || member.user_id,
    user_id: member.user_id || member.uid || member.email || member.member_id || member.id,
    full_name: member.full_name || member.display_name || member.name || "",
    email: member.email || "",
    relationship,
    relationship_type: relationship || member.relationship_type || "",
    relationship_display_label: relationship || member.relationship_display_label || "",
    role,
    normalized_role: role,
    overrides,
    effective_permissions: effective,
    source: member.source || "cloud_local",
  };
}

export async function loadPermissionMembers(familyId) {
  let rows = await readList(familyId, "family", "members");
  try {
    const { listFamilyCloudMembers } = await import("../../firebase/familyCloud");
    const cloudMembers = await listFamilyCloudMembers(familyId);
    if (cloudMembers.length) {
      const merged = mergeLocalAndCloudMembers(rows, cloudMembers);
      // Keep local IDB in sync so PATCH /permissions/members/:id can find every member
      if (merged.length) {
        await writeList(familyId, "family", "members", merged);
        rows = merged;
      }
    }
  } catch {
    /* offline / rules not published */
  }
  return rows.map(mapFamilyMemberPermissions);
}

export function findCurrentMember(members, currentUser) {
  if (!Array.isArray(members) || !members.length) return null;
  const email = String(currentUser?.email || "").trim().toLowerCase();
  const uid = String(
    currentUser?.uid || currentUser?.firebase_uid || currentUser?.id || currentUser?.user_id || "",
  ).trim();

  const matches = members.filter((m) => {
    const memberUid = String(m.user_id || m.uid || m.member_id || m.id || "").trim();
    const memberEmail = String(m.email || m.user_email || "").trim().toLowerCase();
    if (uid && memberUid && memberUid === uid) return true;
    if (email && memberEmail && memberEmail === email) return true;
    return false;
  });

  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    // Duplicate rows (local seed + Firestore): keep the highest privilege role
    return [...matches].sort(
      (a, b) =>
        (FAMILY_ROLE_RANK[normalizeMemberRole(b)] || 0) - (FAMILY_ROLE_RANK[normalizeMemberRole(a)] || 0),
    )[0];
  }

  // Only fall back to OWNER when we cannot identify the user at all
  if (!uid && !email) {
    return members.find((m) => normalizeMemberRole(m) === "OWNER") || members[0];
  }
  return null;
}

const LIFE_ROUTE_TO_KEY = {
  investments: "INVESTMENT",
  "health-expenses": "HEALTH",
  "vehicle-expenses": "VEHICLE",
  "education-funds": "EDUCATION",
  subscriptions: "SUBSCRIPTION",
  documents: "DOCUMENT",
  properties: "PROPERTY",
};

export function lifeModuleKey(route) {
  return LIFE_ROUTE_TO_KEY[route] || null;
}

export function buildLifePhaseSummary(items) {
  const modules = {};
  for (const mt of [
    "INVESTMENT",
    "HEALTH",
    "VEHICLE",
    "EDUCATION",
    "SUBSCRIPTION",
    "DOCUMENT",
    "PROPERTY",
  ]) {
    modules[mt] = { active_count: 0, active: 0, total_amount: 0, due_soon_count: 0, monthly_cost_total: 0 };
  }
  let total = 0;
  const now = Date.now();
  const soonMs = 30 * 24 * 60 * 60 * 1000;
  for (const item of items || []) {
    const mt = String(item?.module_type || "").toUpperCase();
    if (!modules[mt]) {
      modules[mt] = { active_count: 0, active: 0, total_amount: 0, due_soon_count: 0, monthly_cost_total: 0 };
    }
    const status = String(item?.status || "ACTIVE").toUpperCase();
    if (status !== "ACTIVE" && status !== "OPEN") continue;
    modules[mt].active_count += 1;
    modules[mt].active += 1;
    const amount =
      mt === "PROPERTY"
        ? Number(item.value ?? item.secondary_amount ?? 0) || 0
        : Number(item.amount ?? item.principal ?? item.value ?? 0) || 0;
    modules[mt].total_amount += amount;
    total += 1;
    if (mt === "SUBSCRIPTION") {
      const cycle = String(item.billing_cycle || item.cycle || "MONTHLY").toUpperCase();
      const subAmt = Number(item.amount || 0) || 0;
      modules[mt].monthly_cost_total += cycle === "YEARLY" ? subAmt / 12 : subAmt;
    }
    const dueRaw =
      item.renewal_or_expiry_date ||
      item.target_date ||
      item.secondary_date ||
      item.maturity ||
      item.next_due ||
      item.expiry_date;
    const dueAt = dueRaw ? Date.parse(dueRaw) : NaN;
    if (Number.isFinite(dueAt) && dueAt >= now && dueAt - now <= soonMs) {
      modules[mt].due_soon_count += 1;
    }
  }
  return { total, modules, source: "cloud_local" };
}

export function normalizeLifeWriteRow(lifeKey, body, existing = null) {
  const base = existing && typeof existing === "object" ? existing : {};
  const merged = { ...base, ...(body || {}) };
  return {
    ...merged,
    id: base.id || newId("life"),
    family_id: merged.family_id,
    name: merged.name || merged.title || merged.vehicle_name || lifeKey,
    category: merged.category || "GENERAL",
    sub_type: merged.sub_type || merged.type || "",
    provider: merged.provider || merged.doctor || merged.location || null,
    location: merged.location || merged.provider || null,
    member_id: merged.member_id || null,
    amount: Number(merged.amount ?? merged.principal ?? merged.rent_income ?? merged.value ?? 0) || 0,
    value: merged.value != null ? Number(merged.value) || 0 : merged.value,
    rent_income: merged.rent_income != null ? Number(merged.rent_income) || 0 : merged.rent_income,
    secondary_amount:
      merged.secondary_amount ??
      merged.value ??
      merged.rate ??
      merged.km_reading ??
      merged.monthly_target ??
      null,
    currency: merged.currency || "BDT",
    target_date: merged.target_date || merged.expense_date || merged.maturity || null,
    secondary_date: merged.secondary_date || merged.start_date || merged.service_due || null,
    renewal_or_expiry_date:
      merged.renewal_or_expiry_date || merged.next_due || merged.expiry_date || null,
    next_due: merged.next_due || merged.renewal_or_expiry_date || null,
    expiry_date: merged.expiry_date || merged.renewal_or_expiry_date || null,
    cycle: merged.cycle || merged.billing_cycle || null,
    billing_cycle: merged.billing_cycle || merged.cycle || null,
    payment_account_id: merged.payment_account_id || merged.account_id || null,
    account_id: merged.account_id || merged.payment_account_id || null,
    reference: merged.reference || merged.area || null,
    area: merged.area || merged.reference || null,
    note: merged.note || merged.notes || "",
    file_name: merged.file_name || null,
    file_url: merged.file_url || merged.file_path || null,
    file_path: merged.file_path || merged.file_url || null,
    file_size: merged.file_size || merged.size || null,
    storage_path: merged.storage_path || null,
    has_file: Boolean(
      merged.has_file || merged.file_path || merged.file_url || merged.file_name || merged.storage_path,
    ),
    status: merged.status || "ACTIVE",
    module_type: lifeKey,
    updated_at: new Date().toISOString(),
    source: merged.source || "cloud_local",
  };
}

/**
 * @returns {Promise<{ handled: boolean, data?: any }>}
 */
