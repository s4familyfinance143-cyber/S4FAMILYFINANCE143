/**
 * Firebase-first API shim: serve App apiGet/apiPost/apiPatch/apiDelete from
 * IndexedDB snapshots (synced to Firestore via pushCloudSnapshot).
 */
import { loadOfflineSnapshot, saveOfflineSnapshot } from "./offlineCache";
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
} from "./cloudLocalFinance";
import {
  FAMILY_ROLE_RANK,
  defaultPermissionsForRole,
  applyPermissionOverrides,
  normalizeFamilyRole,
  preferElevatedRole,
  sanitizeRelationshipLabel,
} from "./familyRoles";

function normalizeMemberRole(member) {
  return normalizeFamilyRole(member);
}

async function resolveFamilyOwnerUid(familyId, currentUser, members = []) {
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
    const { getFirestoreDb } = await import("../firebase/config");
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

function relationshipFromMember(member, role = "") {
  return sanitizeRelationshipLabel(
    member?.relationship_display_label ||
      member?.relationship ||
      member?.relationship_type ||
      member?.relation ||
      "",
    role || normalizeMemberRole(member),
  );
}

function newId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function stripQuery(path) {
  return String(path || "").split("?")[0];
}

function queryParam(path, key) {
  const q = String(path || "").split("?")[1] || "";
  const params = new URLSearchParams(q);
  return params.get(key) || "";
}

async function readList(familyId, module, name, fallback = []) {
  const row = await loadOfflineSnapshot(familyId, module, name).catch(() => null);
  const data = row?.data;
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  if (data && Array.isArray(data.rows)) return data.rows;
  if (data && Array.isArray(data.records)) return data.records;
  return Array.isArray(fallback) ? fallback : [];
}

async function writeList(familyId, module, name, list) {
  await saveOfflineSnapshot(familyId, module, name, list);
  return list;
}

async function readDoc(familyId, module, name, fallback = {}) {
  const row = await loadOfflineSnapshot(familyId, module, name).catch(() => null);
  return row?.data && typeof row.data === "object" ? row.data : fallback;
}

async function writeDoc(familyId, module, name, data) {
  await saveOfflineSnapshot(familyId, module, name, data);
  return data;
}

async function readBudgets(familyId) {
  const row = await loadOfflineSnapshot(familyId, "finance", "budgets").catch(() => null);
  return normalizeBudgetsList(row?.data);
}

async function writeBudgets(familyId, list) {
  return writeList(familyId, "finance", "budgets", persistableBudgets(list));
}

async function appendAudit(familyId, entry) {
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

function normalizeAuditRow(row) {
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

function buildAuditSummary(rows) {
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

function txType(t) {
  return String(t?.type || t?.transaction_type || "").toUpperCase();
}

function activeWallets(list) {
  return (Array.isArray(list) ? list : []).filter((w) => !w?.deleted_at && w?.is_active !== false);
}

function activeTransactions(list) {
  return (Array.isArray(list) ? list : []).filter((t) => String(t?.status || "").toUpperCase() !== "VOID");
}

async function buildFinancialSummary(familyId) {
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

async function buildWalletSummary(familyId) {
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

async function buildAccountLedger(familyId, accountId, limit = 25) {
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

async function buildExtraReport(familyId, kind) {
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

function rateToBase(rates, from, base) {
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

async function buildCurrencyFamilySummary(familyId, bag) {
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

async function appendNotification(familyId, entry) {
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

async function appendGroceryActivity(familyId, entry) {
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

async function recomputeGroceryVendorSummary(familyId) {
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

function memberMatchKey(member) {
  const email = String(member?.email || "").trim().toLowerCase();
  if (email) return `email:${email}`;
  const uid = String(member?.user_id || member?.uid || member?.member_id || member?.id || "").trim();
  if (uid) return `uid:${uid}`;
  return "";
}

function cloudMemberToLocal(cm) {
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

function mergeLocalAndCloudMembers(localRows = [], cloudRows = []) {
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

function mapFamilyMemberPermissions(member) {
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

async function loadPermissionMembers(familyId) {
  let rows = await readList(familyId, "family", "members");
  try {
    const { listFamilyCloudMembers } = await import("../firebase/familyCloud");
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

function findCurrentMember(members, currentUser) {
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

function lifeModuleKey(route) {
  return LIFE_ROUTE_TO_KEY[route] || null;
}

function buildLifePhaseSummary(items) {
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

function normalizeLifeWriteRow(lifeKey, body, existing = null) {
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
export async function cloudApiGet({ familyId, path, currentUser }) {
  if (!familyId) return { handled: false };
  const clean = stripQuery(path);
  const parts = clean.replace(/^\//, "").split("/").filter(Boolean);

  // Tasks / calendar (planner)
  if (parts[0] === "tasks" && parts[1] === familyId) {
    const rows = await readList(familyId, "planner", "tasks");
    const sorted = [...rows].sort((a, b) =>
      String(b.created_at || b.due_date || "").localeCompare(String(a.created_at || a.due_date || "")),
    );
    return { handled: true, data: sorted };
  }
  if (parts[0] === "calendar" && parts[1] === familyId) {
    const rows = await readList(familyId, "planner", "events");
    const active = rows.filter((r) => String(r.status || "").toUpperCase() !== "CANCELLED");
    const sorted = [...active].sort((a, b) =>
      String(a.event_date || "").localeCompare(String(b.event_date || "")),
    );
    return { handled: true, data: sorted };
  }

  // Grocery
  if (parts[0] === "grocery") {
    if (parts[1] === "lists" && parts[2] === familyId && !parts[3]) {
      return { handled: true, data: await readList(familyId, "grocery", "lists") };
    }
    if (parts[1] === "lists" && parts[2] === familyId && parts[3] && parts[4] === "items") {
      const all = await readList(familyId, "grocery", "items");
      return {
        handled: true,
        data: all.filter((i) => String(i.list_id || i.grocery_list_id) === String(parts[3])),
      };
    }
    if (parts[1] === "vendors" && parts[2] === familyId) {
      return { handled: true, data: await readList(familyId, "grocery", "vendors") };
    }
    if (parts[1] === "price-history" && parts[2] === familyId) {
      return { handled: true, data: await readList(familyId, "grocery", "priceHistory") };
    }
    if (parts[1] === "vendor-summary" && parts[2] === familyId) {
      return { handled: true, data: await readList(familyId, "grocery", "vendorSummary") };
    }
    if (parts[1] === "activity" && parts[2] === familyId) {
      return { handled: true, data: await readList(familyId, "grocery", "activity") };
    }
    if (parts[1] === "barcode" && parts[2] === familyId && parts[3]) {
      const code = decodeURIComponent(String(parts[3] || "")).trim();
      const items = await readList(familyId, "grocery", "items");
      const matches = items
        .filter((i) => String(i.barcode || "").trim() === code)
        .sort((a, b) => String(b.updated_at || b.created_at || "").localeCompare(String(a.updated_at || a.created_at || "")));
      const latest = matches[0] || null;
      return {
        handled: true,
        data: {
          barcode: code,
          found: Boolean(latest),
          latest,
          history: matches.slice(0, 10),
          source: "cloud_local",
        },
      };
    }
    if (parts[1] === "collaboration" && parts[2] === "status") {
      const lists = await readList(familyId, "grocery", "lists");
      const items = await readList(familyId, "grocery", "items");
      const openLists = lists.filter((l) => String(l.status || "OPEN").toUpperCase() === "OPEN").length;
      const pendingItems = items.filter((i) => !i.is_bought).length;
      return {
        handled: true,
        data: {
          mode: "cloud_local",
          online: true,
          realtime_transport: "polling",
          websocket_path: null,
          open_lists: openLists,
          pending_items: pendingItems,
          subscribers: 0,
          source: "cloud_local",
        },
      };
    }
  }

  // Life modules list: /investments?family_id=
  const lifeKey = lifeModuleKey(parts[0]);
  if (lifeKey && !parts[1]) {
    const fid = queryParam(path, "family_id") || familyId;
    const bag = await readDoc(fid, "life", lifeKey === "HEALTH" || lifeKey === "INVESTMENT" || lifeKey === "VEHICLE" || lifeKey === "EDUCATION" ? "phase15" : "phase16", { items: [] });
    const items = Array.isArray(bag.items) ? bag.items : [];
    return { handled: true, data: items.filter((i) => String(i.module_type || "").toUpperCase() === lifeKey) };
  }

  if (parts[0] === "life-modules" && parts[1] === "summary") {
    const p15 = await readDoc(familyId, "life", "phase15", { items: [], summary: null });
    const p16 = await readDoc(familyId, "life", "phase16", { items: [], summary: null });
    const items = [...(Array.isArray(p15.items) ? p15.items : []), ...(Array.isArray(p16.items) ? p16.items : [])];
    return {
      handled: true,
      data: buildLifePhaseSummary(items),
    };
  }

  // Zakat
  if (parts[0] === "zakat" && parts[1] === familyId) {
    return { handled: true, data: await readList(familyId, "zakat", "main") };
  }
  if (parts[0] === "zakat" && parts[1] === "summary" && parts[2] === familyId) {
    const rows = await readList(familyId, "zakat", "main");
    const totalDue = rows.reduce((sum, r) => sum + (Number(r.zakat_due) || 0), 0);
    const latest = rows[0] || null;
    return {
      handled: true,
      data: {
        record_count: rows.length,
        count: rows.length,
        total_zakat_due: totalDue,
        latest,
        source: "cloud_local",
      },
    };
  }

  // Notifications
  if (parts[0] === "notifications" && parts[1] === familyId) {
    return { handled: true, data: await readList(familyId, "system", "notifications") };
  }
  if (parts[0] === "notifications" && parts[1] === "summary" && parts[2] === familyId) {
    const rows = await readList(familyId, "system", "notifications");
    const unread = rows.filter((r) => !r.read && !r.is_read).length;
    const read = rows.length - unread;
    const high = rows.filter((r) => String(r.severity || "").toUpperCase() === "HIGH").length;
    const medium = rows.filter((r) => String(r.severity || "").toUpperCase() === "MEDIUM").length;
    return {
      handled: true,
      data: {
        family_id: familyId,
        total: rows.length,
        unread,
        unread_count: unread,
        total_notifications: rows.length,
        unread_notifications: unread,
        read_notifications: read,
        high_notifications: high,
        medium_notifications: medium,
        source: "cloud_local",
      },
    };
  }
  if (parts[0] === "notifications" && parts[1] === "delivery-status") {
    const permission =
      typeof Notification !== "undefined" ? Notification.permission : "unsupported";
    let vapidConfigured = false;
    try {
      const raw = String(process.env.EXPO_PUBLIC_FIREBASE_VAPID_KEY || "").trim();
      vapidConfigured = raw.length > 20;
    } catch {
      /* keep vapidConfigured = false */
    }
    return {
      handled: true,
      data: {
        email: false,
        email_configured: false,
        push: typeof Notification !== "undefined",
        fcm_configured: vapidConfigured,
        in_app: true,
        mode: "cloud_local",
        delivery_mode: vapidConfigured ? "IN_APP_BROWSER_FCM" : "IN_APP_BROWSER",
        browser_permission: permission,
        web_fcm: {
          vapid_configured: vapidConfigured,
          permission,
        },
        note:
          permission === "denied"
            ? "Browser notifications blocked — enable in site settings"
            : !vapidConfigured
              ? "Set VITE_FIREBASE_VAPID_KEY in frontend/.env and restart Vite"
              : permission === "granted"
                ? "Browser notifications allowed · VAPID configured"
                : "Click the bell to enable browser notifications",
      },
    };
  }
  if (parts[0] === "notifications" && parts[1] === "devices") {
    return { handled: true, data: await readList(familyId, "system", "pushDevices") };
  }

  // Audit
  if (parts[0] === "families" && parts[1] === familyId && parts[2] === "audit-trail") {
    const rows = (await readList(familyId, "system", "audit")).map(normalizeAuditRow);
    if (parts[3] === "summary") {
      return { handled: true, data: buildAuditSummary(rows) };
    }
    if (parts[3] === "entity" && parts[4] && parts[5]) {
      const et = decodeURIComponent(String(parts[4]));
      const eid = decodeURIComponent(String(parts[5]));
      const limit = Number(queryParam(path, "limit") || 25);
      const filtered = rows.filter(
        (r) =>
          String(r.entity_type || "").toLowerCase() === et.toLowerCase() &&
          String(r.entity_id || "") === String(eid),
      );
      return { handled: true, data: { rows: filtered.slice(0, limit), source: "cloud_local" } };
    }
    if (parts[3] === "activity") {
      const limit = Number(queryParam(path, "limit") || 25);
      const actionType = String(queryParam(path, "action_type") || "").trim();
      const entityType = String(queryParam(path, "entity_type") || "").trim();
      const severity = String(queryParam(path, "severity") || "").trim();
      let filtered = rows;
      if (actionType) {
        filtered = filtered.filter((r) => String(r.action_type || "").toLowerCase() === actionType.toLowerCase());
      }
      if (entityType) {
        filtered = filtered.filter((r) => String(r.entity_type || "").toLowerCase() === entityType.toLowerCase());
      }
      if (severity) {
        filtered = filtered.filter((r) => String(r.severity || "").toLowerCase() === severity.toLowerCase());
      }
      return { handled: true, data: { rows: filtered.slice(0, limit), source: "cloud_local" } };
    }
  }

  // Reports (cloud-local from IndexedDB)
  if (parts[0] === "families" && parts[1] === familyId && parts[2] === "reports") {
    if (parts[3] === "financial-summary") {
      return { handled: true, data: await buildFinancialSummary(familyId) };
    }
    if (parts[3] === "wallet-summary") {
      return { handled: true, data: await buildWalletSummary(familyId) };
    }
    if (parts[3] === "account-ledger") {
      const accountId = queryParam(path, "account_id");
      const limit = Number(queryParam(path, "limit") || 25);
      if (!accountId) return { handled: true, data: { rows: [], source: "cloud_local" } };
      return { handled: true, data: await buildAccountLedger(familyId, accountId, limit) };
    }
  }
  if (parts[0] === "reports") {
    if (parts[1] === "dashboard" && parts[2] === familyId) {
      return { handled: true, data: await buildExtraReport(familyId, "dashboard") };
    }
    if (parts[1] === "net-worth" && parts[2] === familyId) {
      return { handled: true, data: await buildExtraReport(familyId, "net-worth") };
    }
    if (parts[1] === "categories" && parts[2] === familyId) {
      return { handled: true, data: await buildExtraReport(familyId, "categories") };
    }
    if (parts[1] === "budget" && parts[2] === familyId) {
      return { handled: true, data: await buildExtraReport(familyId, "budget") };
    }
    if (parts[1] === "loans" && parts[2] === familyId) {
      return { handled: true, data: await buildExtraReport(familyId, "loans") };
    }
    if (parts[1] === "savings-trend" && parts[2] === familyId) {
      return { handled: true, data: await buildExtraReport(familyId, "savings-trend") };
    }
  }
  if (parts[0] === "api-logs") {
    const audit = (await readList(familyId, "system", "audit")).map(normalizeAuditRow).slice(0, 80);
    const rows = audit.map((r) => ({
      id: r.id,
      path: r.action_type || r.action,
      endpoint: r.action_type || r.action || "/",
      method: "LOCAL",
      status_code: 200,
      duration_ms: 0,
      created_at: r.created_at || r.at,
      note: r.title || "",
    }));
    return {
      handled: true,
      data: {
        rows,
        summary: { avg_duration_ms: 0, slow_count_ge_500ms: 0, total: rows.length },
        source: "cloud_local",
      },
    };
  }

  // Backup center (local IndexedDB snapshot exports)
  if (parts[0] === "backup") {
    const bag = await readDoc(familyId, "system", "backup", {
      integrity: { ok: true, integrity_check: "IndexedDB OK", source: "cloud_local" },
      list: { count: 0, backups: [] },
      files: {},
    });
    if (parts[1] === "integrity") {
      return {
        handled: true,
        data: bag.integrity || { ok: true, integrity_check: "IndexedDB OK", source: "cloud_local" },
      };
    }
    if (parts[1] === "list" && parts[2] === familyId) {
      const list = bag.list || { count: 0, backups: [] };
      return {
        handled: true,
        data: {
          count: list.count || (list.backups || []).length || 0,
          backups: list.backups || [],
          source: "cloud_local",
        },
      };
    }
    if (parts[1] === "restore" && parts[2] === "preview-file") {
      const fileName = queryParam(path, "file_name");
      const payload = bag.files?.[fileName];
      const meta = (bag.list?.backups || []).find((b) => b.file_name === fileName);
      return {
        handled: true,
        data: {
          file_name: fileName,
          restore_safe: Boolean(payload || meta),
          message: payload
            ? `Local backup with ${Array.isArray(payload.rows) ? payload.rows.length : 0} snapshot rows`
            : meta
              ? "Metadata only — re-create backup to store full payload"
              : "Backup file not found",
          contains_files: payload?.rows
            ? [...new Set(payload.rows.map((r) => `${r.module}/${r.name}`))].slice(0, 40)
            : [],
          source: "cloud_local",
        },
      };
    }
  }

  // Sync status / conflicts / logs (cloud-local synthetic)
  if (parts[0] === "families" && parts[1] === familyId && parts[2] === "sync") {
    if (parts[3] === "status") {
      const wallets = activeWallets(await readList(familyId, "finance", "wallets"));
      const txs = activeTransactions(await readList(familyId, "finance", "transactions"));
      const grocery = await readList(familyId, "grocery", "lists");
      return {
        handled: true,
        data: {
          pending_outbox: 0,
          open_conflicts: 0,
          offline_first: true,
          sync_state: "CLOUD_LOCAL",
          device_id: queryParam(path, "device_id") || "web",
          table_counts: {
            wallets: wallets.length,
            transactions: txs.length,
            grocery_lists: grocery.length,
            audit: (await readList(familyId, "system", "audit")).length,
          },
          source: "cloud_local",
        },
      };
    }
    if (parts[3] === "conflicts") {
      return { handled: true, data: { conflicts: [], source: "cloud_local" } };
    }
    if (parts[3] === "pull") {
      return {
        handled: true,
        data: {
          changes: [],
          sync_token: new Date().toISOString(),
          note: "Use cloud snapshot pull for multi-device sync",
          source: "cloud_local",
        },
      };
    }
  }
  if (parts[0] === "sync-logs") {
    const audit = (await readList(familyId, "system", "audit")).map(normalizeAuditRow).slice(0, 80);
    const rows = audit.map((r) => ({
      id: r.id,
      action: r.action_type,
      synced_at: r.created_at || r.at,
      created_at: r.created_at || r.at,
      device_id: "cloud_local",
      items_synced: 1,
      success: true,
      status: "OK",
      detail: r.title,
      error_msg: null,
    }));
    return {
      handled: true,
      data: {
        rows,
        summary: { success_rate: 1, fail_count: 0, total: rows.length },
        source: "cloud_local",
      },
    };
  }

  // Family members / permissions
  if (parts[0] === "families" && parts[1] === familyId && parts[2] === "members") {
    return { handled: true, data: await loadPermissionMembers(familyId) };
  }
  if (parts[0] === "permissions" && parts[1] === "family" && parts[2] === familyId && parts[3] === "me") {
    const members = await loadPermissionMembers(familyId);
    const me = findCurrentMember(members, currentUser);
    const myUid = String(currentUser?.uid || currentUser?.firebase_uid || currentUser?.id || "").trim();
    const ownerUid = await resolveFamilyOwnerUid(familyId, currentUser, members);
    const isFamilyOwner = Boolean(myUid && ownerUid && myUid === ownerUid);

    const mapped = me
      ? mapFamilyMemberPermissions(me)
      : isFamilyOwner
        ? {
            role: "OWNER",
            normalized_role: "OWNER",
            relationship: "Owner",
            relationship_display_label: "Owner",
            effective_permissions: ["*", "settings.manage"],
            overrides: [],
            member_id: myUid,
            uid: myUid,
            user_id: myUid,
            source: "cloud_local_owner_meta",
          }
        : {
            role: "MEMBER",
            normalized_role: "MEMBER",
            relationship: "",
            effective_permissions: defaultPermissionsForRole("MEMBER"),
            overrides: [],
            source: "cloud_local_unmatched",
          };

    const resolvedRole = preferElevatedRole(
      mapped.normalized_role,
      mapped.role,
      isFamilyOwner ? "OWNER" : "",
    );
    const relationship =
      sanitizeRelationshipLabel(mapped.relationship, resolvedRole) ||
      (resolvedRole === "OWNER" ? "Owner" : "");

    return {
      handled: true,
      data: {
        role: resolvedRole,
        normalized_role: resolvedRole,
        relationship,
        relationship_display_label: relationship,
        effective_permissions:
          resolvedRole === "OWNER" || resolvedRole === "ADMIN"
            ? defaultPermissionsForRole(resolvedRole)
            : mapped.effective_permissions?.length
              ? mapped.effective_permissions
              : defaultPermissionsForRole(resolvedRole),
        overrides: mapped.overrides || [],
        member_id: mapped.member_id || myUid || undefined,
        catalog: CLOUD_PERMISSION_CATALOG,
        source: "cloud_local",
      },
    };
  }
  if (parts[0] === "permissions" && parts[1] === "family" && parts[2] === familyId && parts[3] === "members") {
    const members = await loadPermissionMembers(familyId);
    return { handled: true, data: members };
  }

  // Join requests
  if (parts[0] === "join-requests" && parts[1] === "family") {
    return { handled: true, data: await readList(familyId, "family", "joinRequests") };
  }
  if (parts[0] === "families" && parts[1] === familyId && parts[2] === "join-requests") {
    return { handled: true, data: await readList(familyId, "family", "joinRequests") };
  }

  // Mobile JWT-style paths used by index.tsx refreshAll
  if (parts[0] === "families" && !parts[1]) {
    const profile = await readDoc(familyId, "system", "familyProfile", {});
    return {
      handled: true,
      data: [
        {
          id: familyId,
          name: profile.name || profile.family_name || "Family",
          default_currency: profile.default_currency || profile.currency || "BDT",
          timezone: profile.timezone || "Asia/Dhaka",
          owner_uid: profile.owner_uid || profile.owner_id || undefined,
        },
      ],
    };
  }
  if (parts[0] === "dashboard" && parts[1] === familyId) {
    const report = await buildExtraReport(familyId, "dashboard");
    const wallets = activeWallets(await readList(familyId, "finance", "wallets"));
    return {
      handled: true,
      data: {
        ...report,
        summary: {
          total_wallet_balance: String(report.wallet_balance ?? 0),
          wallet_count: wallets.length,
          total_income: String(report.total_income ?? 0),
          total_expense: String(report.total_expense ?? 0),
          net_income_expense: String(
            Number(report.total_income || 0) - Number(report.total_expense || 0)
          ),
        },
        loans: {
          loan_taken_remaining: report.loan_taken_remaining,
          loan_given_remaining: report.loan_given_remaining,
        },
        savings: { total_current_amount: report.savings_balance },
      },
    };
  }

  // Currency center (full local + cloud snapshot)
  if (parts[0] === "accounts") {
    const rows = await readList(familyId, "finance", "wallets");
    const active = rows.filter((w) => !w?.deleted_at && w?.is_active !== false);
    if (parts[1] === "family" && parts[2] === familyId) {
      return { handled: true, data: active };
    }
    if (parts[1] && !parts[2]) {
      const hit = active.find((w) => String(w.id) === String(parts[1]));
      return { handled: true, data: hit || null };
    }
  }

  if (parts[0] === "transactions" && parts[1] === familyId) {
    const rows = await readList(familyId, "finance", "transactions");
    return {
      handled: true,
      data: [...rows].sort((a, b) =>
        String(b.created_at || "").localeCompare(String(a.created_at || "")),
      ),
    };
  }

  if (parts[0] === "categories" && parts[1] === "family" && parts[2] === familyId) {
    return { handled: true, data: await readList(familyId, "finance", "categories") };
  }

  // Budgets
  if (parts[0] === "budgets" && parts[1] === "status" && parts[2] === familyId) {
    const list = await readBudgets(familyId);
    const txs = await readList(familyId, "finance", "transactions");
    const cats = await readList(familyId, "finance", "categories");
    const enriched = enrichBudgetsFromLedger(list, txs, cats);
    return { handled: true, data: buildBudgetStatusSummary(enriched) };
  }
  if (parts[0] === "budgets" && parts[1] === familyId) {
    const list = await readBudgets(familyId);
    const txs = await readList(familyId, "finance", "transactions");
    const cats = await readList(familyId, "finance", "categories");
    return { handled: true, data: enrichBudgetsFromLedger(list, txs, cats) };
  }

  // Savings
  if (parts[0] === "savings" && parts[1] === "annual-plan" && parts[2] === familyId) {
    const list = enrichSavingsGoals(normalizeSavingsList(await readList(familyId, "finance", "savings")));
    return { handled: true, data: buildSavingsAnnualPlan(list) };
  }
  if (parts[0] === "savings" && parts[1] === familyId) {
    const list = normalizeSavingsList(await readList(familyId, "finance", "savings"));
    const txs = await readList(familyId, "finance", "transactions");
    return { handled: true, data: recomputeSavingsFromLedger(list, txs) };
  }
  if (parts[0] === "savings" && parts[1] && parts[2] === "history" && parts[3] === familyId) {
    const txs = await readList(familyId, "finance", "transactions");
    const history = txs
      .filter((t) => String(t.savings_goal_id || "") === String(parts[1]))
      .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
    const goals = normalizeSavingsList(await readList(familyId, "finance", "savings"));
    const goal = goals.find((g) => String(g.id) === String(parts[1])) || null;
    return { handled: true, data: { goal, history } };
  }

  // Loans
  if (parts[0] === "loans" && parts[1] === familyId) {
    return { handled: true, data: await readList(familyId, "finance", "loans") };
  }
  if (parts[0] === "loans" && parts[1] && parts[2] === "history" && parts[3] === familyId) {
    const loans = await readList(familyId, "finance", "loans");
    const loan = loans.find((l) => String(l.id) === String(parts[1])) || null;
    const txs = await readList(familyId, "finance", "transactions");
    return { handled: true, data: { loan, history: loanHistoryFromLedger(parts[1], txs) } };
  }

  // Goals
  if (parts[0] === "goals" && parts[1] === "summary" && parts[2] === familyId) {
    const list = await readList(familyId, "finance", "goals");
    const txs = await readList(familyId, "finance", "transactions");
    return { handled: true, data: buildGoalSummary(recomputeGoalsFromLedger(list, txs)) };
  }
  if (parts[0] === "goals" && parts[1] === familyId) {
    const list = await readList(familyId, "finance", "goals");
    const txs = await readList(familyId, "finance", "transactions");
    return { handled: true, data: recomputeGoalsFromLedger(list, txs) };
  }
  if (parts[0] === "goals" && parts[1] && parts[2] === "history" && parts[3] === familyId) {
    const list = await readList(familyId, "finance", "goals");
    const goal = list.find((g) => String(g.id) === String(parts[1])) || null;
    const txs = await readList(familyId, "finance", "transactions");
    return { handled: true, data: { goal, history: goalHistoryFromLedger(parts[1], txs) } };
  }

  // Recurring
  if (parts[0] === "recurring" && parts[1] === familyId) {
    return { handled: true, data: await readList(familyId, "finance", "recurring") };
  }
  if (parts[0] === "recurring" && parts[1] && parts[2] === "history" && parts[3] === familyId) {
    const list = await readList(familyId, "finance", "recurring");
    const item = list.find((r) => String(r.id) === String(parts[1])) || null;
    const txs = await readList(familyId, "finance", "transactions");
    return { handled: true, data: { recurring: item, history: recurringHistoryFromLedger(parts[1], txs) } };
  }

  // Currency center (full local + cloud snapshot)
  if (parts[0] === "currency") {
    const bag = await readDoc(familyId, "system", "currency", null);
    const defaults = {
      currencies: [
        { code: "BDT", name: "Bangladeshi Taka", symbol: "৳", is_base: true, is_active: true },
        { code: "USD", name: "US Dollar", symbol: "$", is_base: false, is_active: true },
        { code: "INR", name: "Indian Rupee", symbol: "₹", is_base: false, is_active: true },
        { code: "SAR", name: "Saudi Riyal", symbol: "﷼", is_base: false, is_active: true },
      ],
      exchangeRates: [
        { from_currency: "USD", to_currency: "BDT", rate: 110, updated_at: new Date().toISOString() },
        { from_currency: "INR", to_currency: "BDT", rate: 1.32, updated_at: new Date().toISOString() },
        { from_currency: "SAR", to_currency: "BDT", rate: 29.3, updated_at: new Date().toISOString() },
      ],
      currencySummary: {
        base_currency: bag?.code || bag?.base_currency || "BDT",
        wallet_currencies: [],
        source: "cloud_local",
      },
      code: bag?.code || "BDT",
      symbol: bag?.symbol || "BDT",
      ...(bag && typeof bag === "object" ? bag : {}),
    };
    if (!parts[1] || parts[1] === "") {
      const list = Array.isArray(defaults.currencies) ? defaults.currencies : [];
      return {
        handled: true,
        data: list.map((c) => ({ ...c, is_active: c.is_active !== false })),
      };
    }
    if (parts[1] === "rates") {
      return { handled: true, data: defaults.exchangeRates || [] };
    }
    if (parts[1] === "family-summary") {
      const summary = await buildCurrencyFamilySummary(familyId, defaults);
      return { handled: true, data: summary };
    }
  }

  // Tags
  if (parts[0] === "tags" && parts[1] === familyId) {
    return { handled: true, data: await readList(familyId, "finance", "tags") };
  }
  if (parts[0] === "tags" && !parts[1]) {
    return { handled: true, data: await readList(familyId, "finance", "tags") };
  }
  if (parts[0] === "transaction-tags") {
    return { handled: true, data: await readList(familyId, "finance", "transactionTags") };
  }

  // Architecture cutover / vault / metal / vehicle
  if (parts[0] === "system" && parts[1] === "architecture-readiness") {
    return {
      handled: true,
      data: {
        architecture_feature_completeness_pct: 100,
        done_count: 12,
        module_count: 12,
        architecture_status: "CLOUD_READY",
        ops: { note: "Firebase cloud mode — all modules local+Firestore" },
        modules: [
          { key: "finance", name: "Finance", status: "REAL", pct: 100, ops_live: true },
          { key: "grocery", name: "Grocery", status: "REAL", pct: 100, ops_live: true },
          { key: "planner", name: "Planner", status: "REAL", pct: 100, ops_live: true },
          { key: "life", name: "Life modules", status: "REAL", pct: 100, ops_live: true },
          { key: "zakat", name: "Zakat", status: "REAL", pct: 100, ops_live: true },
          { key: "family", name: "Family / invites", status: "REAL", pct: 100, ops_live: true },
          { key: "notifications", name: "Notifications", status: "REAL", pct: 100, ops_live: true },
          { key: "audit", name: "Audit", status: "REAL", pct: 100, ops_live: true },
          { key: "currency", name: "Currency", status: "REAL", pct: 100, ops_live: true },
          { key: "tags", name: "Tags", status: "REAL", pct: 100, ops_live: true },
          { key: "storage", name: "Cloud Storage", status: "REAL", pct: 100, ops_live: true },
          { key: "backup", name: "Backup", status: "REAL", pct: 100, ops_live: true },
        ],
        source: "cloud_local",
      },
    };
  }
  if (parts[0] === "documents" && parts[1] === "vault-status") {
    return {
      handled: true,
      data: {
        storage_backend: "firebase_storage",
        architecture_status: "CLOUD_READY",
        note: "Documents upload to Firebase Storage under families/{id}/documents",
        source: "cloud_local",
      },
    };
  }
  if (parts[0] === "zakat" && parts[1] === "metal-rates") {
    const bag = await readDoc(familyId, "zakat", "metalRates", {
      GOLD: 12000,
      SILVER: 150,
      updated_at: null,
      source: "cloud_local",
    });
    const rates = ["GOLD", "SILVER"]
      .filter((m) => bag[m] != null && Number(bag[m]) > 0)
      .map((m) => ({ metal: m, rate_bdt: Number(bag[m]), unit: "gram" }));
    return {
      handled: true,
      data: {
        ...bag,
        rates,
        source: "cloud_local",
      },
    };
  }
  if (parts[0] === "zakat" && parts[1] === "nisab-from-rates") {
    const metal = String(queryParam(path, "metal") || "SILVER").toUpperCase();
    const bag = await readDoc(familyId, "zakat", "metalRates", {
      GOLD: 12000,
      SILVER: 150,
    });
    const rate = Number(bag[metal] || 0);
    if (!rate) {
      return {
        handled: true,
        data: {
          ok: false,
          detail: `No ${metal} rate configured — save metal rates first`,
          metal,
          nisab_amount: null,
        },
      };
    }
    // Classical nisab weights (grams) — same as backend missing_features_api
    const grams = metal === "GOLD" ? 87.48 : 612.36;
    const nisab = Math.round(rate * grams * 100) / 100;
    return {
      handled: true,
      data: {
        metal,
        unit: "gram",
        rate_bdt: rate,
        nisab_grams: String(grams),
        nisab_amount: String(nisab),
        source: "cloud_local",
      },
    };
  }
  if (parts[0] === "vehicle-expenses" && parts[1] === "cost-per-km") {
    const bag = await readDoc(familyId, "life", "phase15", { items: [] });
    const name = queryParam(path, "vehicle_name") || "";
    const items = (bag.items || []).filter(
      (i) =>
        String(i.module_type || "").toUpperCase() === "VEHICLE" &&
        (!name || String(i.name || "").toLowerCase().includes(String(name).toLowerCase())),
    );
    const total = items.reduce((s, i) => s + Number(i.amount || 0), 0);
    const km = items.reduce((s, i) => s + Number(i.secondary_amount || 0), 0);
    return {
      handled: true,
      data: {
        vehicle_name: name || "all",
        expense_count: items.length,
        total_cost: total,
        total_km: km,
        cost_per_km: km > 0 ? Number((total / km).toFixed(4)) : null,
        source: "cloud_local",
      },
    };
  }

  if (parts[0] === "auth" && parts[1] === "me") {
    return {
      handled: true,
      data: {
        id: currentUser?.uid || currentUser?.firebase_uid || currentUser?.id || "",
        uid: currentUser?.uid || currentUser?.firebase_uid || "",
        firebase_uid: currentUser?.firebase_uid || currentUser?.uid || "",
        full_name: currentUser?.full_name || currentUser?.displayName || currentUser?.email || "Cloud User",
        email: currentUser?.email || "",
        avatar_url: currentUser?.avatar_url || currentUser?.photoURL || "",
        is_active: true,
        is_email_verified: Boolean(currentUser?.is_email_verified),
        source: "cloud_local",
      },
    };
  }

  if (parts[0] === "auth" && parts[1] === "email-status") {
    return {
      handled: true,
      data: {
        verified: Boolean(currentUser?.is_email_verified),
        // Cloud mode uses Firebase Auth for mail — not backend SMTP
        can_send: true,
        source: "cloud_local",
        note: "Firebase Auth handles account emails in cloud mode",
      },
    };
  }

  // Ownership transfer (cloud-local IndexedDB; no backend)
  if (parts[0] === "families" && parts[1] === familyId && parts[2] === "ownership-transfer") {
    if (!parts[3]) {
      return { handled: true, data: await readList(familyId, "family", "ownershipTransfers") };
    }
  }

  return { handled: false };
}

export async function cloudApiPost({ familyId, path, body, currentUser, onAfterWrite }) {
  if (!familyId) return { handled: false };
  const clean = stripQuery(path);
  const parts = clean.replace(/^\//, "").split("/").filter(Boolean);
  const after = typeof onAfterWrite === "function" ? onAfterWrite : async () => {};

  // Planner
  if (parts[0] === "accounts" && !parts[1]) {
    const rows = await readList(familyId, "finance", "wallets");
    const row = {
      id: newId("wal"),
      family_id: familyId,
      name: String(body?.name || "").trim() || "Wallet",
      account_type: body?.account_type || "CASH",
      currency: body?.currency || "BDT",
      balance: Number(body?.opening_balance || 0),
      current_balance: Number(body?.opening_balance || 0),
      opening_balance: Number(body?.opening_balance || 0),
      is_shared_family: body?.is_shared_family !== false,
      is_owner_wallet: Boolean(body?.is_owner_wallet),
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      source: "cloud_local",
    };
    await writeList(familyId, "finance", "wallets", [row, ...rows]);
    await after();
    return { handled: true, data: row };
  }

  if (parts[0] === "budgets" && !parts[1]) {
    const existing = await readBudgets(familyId);
    const cats = await readList(familyId, "finance", "categories");
    const form = {
      category_id: body?.category_id,
      name: body?.name,
      budget_amount: body?.budget_amount,
      period_type: body?.period_type || "MONTHLY",
      note: body?.note || "",
    };
    const dupKey = budgetDuplicateKey(form);
    const dup = existing.find(
      (b) => String(b.status || "").toUpperCase() === "ACTIVE" && budgetDuplicateKey(b) === dupKey,
    );
    if (dup) {
      return {
        handled: true,
        data: { ok: false, detail: "Duplicate active budget for category/period" },
        error: "Duplicate active budget for category/period",
      };
    }
    const cat = cats.find((c) => String(c.id) === String(form.category_id));
    const row = buildLocalBudget({
      familyId,
      form,
      currency: body?.currency || "BDT",
      categoryName: cat?.name_en || cat?.name || "",
    });
    await writeBudgets(familyId, [row, ...existing]);
    await after();
    return { handled: true, data: row };
  }

  if (parts[0] === "budgets" && parts[1] && parts[2] === "close") {
    const existing = await readBudgets(familyId);
    const next = existing.map((b) =>
      String(b.id) === String(parts[1])
        ? { ...b, status: "CLOSED", updated_at: new Date().toISOString() }
        : b,
    );
    await writeBudgets(familyId, next);
    await after();
    return { handled: true, data: { ok: true, id: parts[1] } };
  }

  if (parts[0] === "savings" && !parts[1]) {
    const existing = normalizeSavingsList(await readList(familyId, "finance", "savings"));
    const row = buildLocalSavingsGoal({
      familyId,
      form: body || {},
      currency: body?.currency || "BDT",
    });
    const txs = await readList(familyId, "finance", "transactions");
    const next = recomputeSavingsFromLedger([row, ...existing], txs);
    await writeList(familyId, "finance", "savings", next);
    await after();
    return { handled: true, data: row };
  }

  if (parts[0] === "savings" && (parts[1] === "deposit" || parts[1] === "withdraw")) {
    const action = parts[1] === "withdraw" ? "WITHDRAW" : "DEPOSIT";
    const existingSav = normalizeSavingsList(await readList(familyId, "finance", "savings"));
    const existingTx = await readList(familyId, "finance", "transactions");
    const existingWallets = await readList(familyId, "finance", "wallets");
    const goalId = body?.savings_goal_id;
    const walletId = body?.from_account_id || body?.to_account_id || body?.wallet_account_id;
    const amount = Number(body?.amount || 0);
    const goal = existingSav.find((g) => String(g.id) === String(goalId));
    if (!goal) return { handled: true, data: { ok: false, detail: "goal not found" }, error: "goal not found" };
    const movement = buildSavingsMovementTx({
      familyId,
      goal,
      walletId,
      amount,
      currency: body?.currency || "BDT",
      action,
      description: body?.description || "",
    });
    const nextTx = sortTransactionsNewestFirst([movement, ...existingTx]);
    const nextWallets = recomputeWalletBalancesFromLedger(existingWallets, nextTx);
    const nextSav = recomputeSavingsFromLedger(existingSav, nextTx);
    await writeList(familyId, "finance", "transactions", nextTx);
    await writeList(familyId, "finance", "wallets", nextWallets);
    await writeList(familyId, "finance", "savings", nextSav);
    await after();
    return { handled: true, data: { ok: true, movement, goal: nextSav.find((g) => String(g.id) === String(goalId)) } };
  }

  if (parts[0] === "savings" && parts[1] && parts[2] === "close") {
    const existing = normalizeSavingsList(await readList(familyId, "finance", "savings"));
    const goal = existing.find((g) => String(g.id) === String(parts[1]));
    if (goal && Number(goal.current_amount || 0) > 0.0001) {
      return {
        handled: true,
        data: { ok: false, detail: "Withdraw remaining balance before closing" },
        error: "Withdraw remaining balance before closing",
      };
    }
    const next = existing.map((g) =>
      String(g.id) === String(parts[1])
        ? { ...g, status: "CLOSED", updated_at: new Date().toISOString() }
        : g,
    );
    await writeList(familyId, "finance", "savings", next);
    await after();
    return { handled: true, data: { ok: true, id: parts[1] } };
  }

  // Loans create / payment / close
  if (parts[0] === "loans" && !parts[1]) {
    const row = buildLocalLoan({
      familyId,
      form: {
        wallet_account_id: body?.wallet_account_id,
        loan_type: body?.loan_type,
        person_name: body?.person_name,
        principal_amount: body?.principal_amount,
        note: body?.note,
        interest_rate: body?.interest_rate,
        interest_type: body?.interest_type,
        installment_count: body?.installment_count,
        start_date: body?.start_date,
      },
      currency: body?.currency || "BDT",
    });
    const principal = Number(row.principal_amount) || 0;
    const wallets = await readList(familyId, "finance", "wallets");
    const wallet = wallets.find((w) => String(w.id) === String(row.wallet_account_id));
    if (!wallet || wallet.deleted_at || wallet.is_active === false) {
      return { handled: true, data: { ok: false, detail: "Wallet required" }, error: "Wallet required" };
    }
    if (String(row.loan_type).toUpperCase() === "GIVEN" && walletBalance(wallet) < principal) {
      return {
        handled: true,
        data: { ok: false, detail: "Insufficient wallet balance" },
        error: "Insufficient wallet balance",
      };
    }
    const txs = await readList(familyId, "finance", "transactions");
    const loans = await readList(familyId, "finance", "loans");
    const movement = buildLoanMovementTx({
      familyId,
      loan: row,
      walletId: row.wallet_account_id,
      amount: principal,
      currency: row.currency,
      kind: "DISBURSE",
      description: row.note,
    });
    const nextTx = sortTransactionsNewestFirst([movement, ...txs]);
    const nextWallets = recomputeWalletBalancesFromLedger(wallets, nextTx);
    const nextLoans = [row, ...loans];
    await writeList(familyId, "finance", "transactions", nextTx);
    await writeList(familyId, "finance", "wallets", nextWallets);
    await writeList(familyId, "finance", "loans", nextLoans);
    await after();
    return { handled: true, data: row };
  }

  if (parts[0] === "loans" && parts[1] === "payment") {
    const loanId = body?.loan_id;
    const amount = Number(body?.amount || 0);
    const walletId = body?.wallet_account_id;
    const loans = await readList(familyId, "finance", "loans");
    const loan = loans.find((l) => String(l.id) === String(loanId));
    if (!loan || String(loan.status || "").toUpperCase() !== "ACTIVE") {
      return { handled: true, data: { ok: false, detail: "Loan required" }, error: "Loan required" };
    }
    if (amount <= 0 || amount > Number(loan.remaining_amount || 0) + 0.0001) {
      return {
        handled: true,
        data: { ok: false, detail: "Valid payment amount required" },
        error: "Valid payment amount required",
      };
    }
    const wallets = await readList(familyId, "finance", "wallets");
    const wallet = wallets.find((w) => String(w.id) === String(walletId));
    if (!wallet || wallet.deleted_at || wallet.is_active === false) {
      return { handled: true, data: { ok: false, detail: "Wallet required" }, error: "Wallet required" };
    }
    if (String(loan.loan_type || "").toUpperCase() === "TAKEN" && walletBalance(wallet) < amount) {
      return {
        handled: true,
        data: { ok: false, detail: "Insufficient wallet balance" },
        error: "Insufficient wallet balance",
      };
    }
    const txs = await readList(familyId, "finance", "transactions");
    const updated = applyLoanPayment(loan, amount);
    const movement = buildLoanMovementTx({
      familyId,
      loan,
      walletId,
      amount,
      currency: body?.currency || loan.currency,
      kind: "REPAYMENT",
      description: body?.description || "",
    });
    const nextTx = sortTransactionsNewestFirst([movement, ...txs]);
    const nextWallets = recomputeWalletBalancesFromLedger(wallets, nextTx);
    const nextLoans = loans.map((l) => (String(l.id) === String(loanId) ? updated : l));
    await writeList(familyId, "finance", "transactions", nextTx);
    await writeList(familyId, "finance", "wallets", nextWallets);
    await writeList(familyId, "finance", "loans", nextLoans);
    await after();
    return { handled: true, data: updated };
  }

  if (parts[0] === "loans" && parts[1] && parts[2] === "close") {
    const loans = await readList(familyId, "finance", "loans");
    const loan = loans.find((l) => String(l.id) === String(parts[1]));
    if (loan && Number(loan.remaining_amount || 0) > 0.0001) {
      return {
        handled: true,
        data: { ok: false, detail: "Pay remaining balance before closing" },
        error: "Pay remaining balance before closing",
      };
    }
    const next = loans.map((l) =>
      String(l.id) === String(parts[1])
        ? { ...l, status: "CLOSED", updated_at: new Date().toISOString() }
        : l,
    );
    await writeList(familyId, "finance", "loans", next);
    await after();
    return { handled: true, data: { ok: true, id: parts[1] } };
  }

  // Goals create / contribute / withdraw / close
  if (parts[0] === "goals" && !parts[1]) {
    const row = enrichGoals([
      buildLocalGoal({
        familyId,
        form: {
          goal_name: body?.goal_name,
          goal_type: body?.goal_type,
          target_amount: body?.target_amount,
          target_date: body?.target_date,
          note: body?.note,
        },
        currency: body?.currency || "BDT",
      }),
    ])[0];
    const existing = await readList(familyId, "finance", "goals");
    const next = enrichGoals([row, ...existing]);
    await writeList(familyId, "finance", "goals", next);
    await writeDoc(familyId, "finance", "goalSummary", buildGoalSummary(next));
    await after();
    return { handled: true, data: row };
  }

  if (parts[0] === "goals" && (parts[1] === "contribute" || parts[1] === "withdraw")) {
    const kind = parts[1] === "withdraw" ? "WITHDRAW" : "CONTRIBUTE";
    const goalId = body?.goal_id;
    const amount = Number(body?.amount || 0);
    const walletId = body?.wallet_account_id;
    const goals = await readList(familyId, "finance", "goals");
    const goal = goals.find((g) => String(g.id) === String(goalId));
    if (!goal || String(goal.status || "").toUpperCase() === "CLOSED") {
      return { handled: true, data: { ok: false, detail: "Goal required" }, error: "Goal required" };
    }
    if (amount <= 0) {
      return {
        handled: true,
        data: { ok: false, detail: "Valid amount required" },
        error: "Valid amount required",
      };
    }
    if (kind === "WITHDRAW" && amount > Number(goal.current_amount || 0) + 0.0001) {
      return {
        handled: true,
        data: { ok: false, detail: "Valid amount required" },
        error: "Valid amount required",
      };
    }
    const wallets = await readList(familyId, "finance", "wallets");
    const wallet = wallets.find((w) => String(w.id) === String(walletId));
    if (!wallet || wallet.deleted_at || wallet.is_active === false) {
      return { handled: true, data: { ok: false, detail: "Wallet required" }, error: "Wallet required" };
    }
    if (kind === "CONTRIBUTE" && walletBalance(wallet) < amount) {
      return {
        handled: true,
        data: { ok: false, detail: "Insufficient wallet balance" },
        error: "Insufficient wallet balance",
      };
    }
    const txs = await readList(familyId, "finance", "transactions");
    const movement = buildGoalMovementTx({
      familyId,
      goal,
      walletId,
      amount,
      currency: body?.currency || goal.currency,
      kind,
      description: body?.description || "",
    });
    const nextTx = sortTransactionsNewestFirst([movement, ...txs]);
    const nextWallets = recomputeWalletBalancesFromLedger(wallets, nextTx);
    const nextGoals = recomputeGoalsFromLedger(goals, nextTx);
    await writeList(familyId, "finance", "transactions", nextTx);
    await writeList(familyId, "finance", "wallets", nextWallets);
    await writeList(familyId, "finance", "goals", nextGoals);
    await writeDoc(familyId, "finance", "goalSummary", buildGoalSummary(nextGoals));
    await after();
    return { handled: true, data: nextGoals.find((g) => String(g.id) === String(goalId)) };
  }

  if (parts[0] === "goals" && parts[1] && parts[2] === "close") {
    const goals = await readList(familyId, "finance", "goals");
    const next = enrichGoals(
      goals.map((g) =>
        String(g.id) === String(parts[1])
          ? { ...g, status: "CLOSED", updated_at: new Date().toISOString() }
          : g,
      ),
    );
    await writeList(familyId, "finance", "goals", next);
    await writeDoc(familyId, "finance", "goalSummary", buildGoalSummary(next));
    await after();
    return { handled: true, data: { ok: true, id: parts[1] } };
  }

  // Recurring create / post / pause / resume / close
  if (parts[0] === "recurring" && !parts[1]) {
    const row = buildLocalRecurring({
      familyId,
      form: {
        account_id: body?.account_id,
        category_id: body?.category_id,
        title: body?.title,
        transaction_type: body?.transaction_type,
        amount: body?.amount,
        frequency: body?.frequency,
        start_date: body?.start_date,
        end_date: body?.end_date,
        description: body?.description,
      },
      currency: body?.currency || "BDT",
    });
    const existing = await readList(familyId, "finance", "recurring");
    await writeList(familyId, "finance", "recurring", [row, ...existing]);
    await after();
    return { handled: true, data: row };
  }

  if (parts[0] === "recurring" && parts[1] && parts[2] === "post") {
    const list = await readList(familyId, "finance", "recurring");
    const item = list.find((r) => String(r.id) === String(parts[1]));
    if (!item || String(item.status || "").toUpperCase() !== "ACTIVE") {
      return { handled: true, data: { ok: false, detail: "Recurring not active" }, error: "Recurring not active" };
    }
    const amount = Number(item.amount) || 0;
    const wallets = await readList(familyId, "finance", "wallets");
    const wallet = wallets.find((w) => String(w.id) === String(item.account_id));
    if (!wallet || wallet.deleted_at || wallet.is_active === false) {
      return { handled: true, data: { ok: false, detail: "Wallet required" }, error: "Wallet required" };
    }
    const isExpense = !String(item.transaction_type || "").toUpperCase().includes("INCOME");
    if (isExpense && walletBalance(wallet) < amount) {
      return {
        handled: true,
        data: { ok: false, detail: "Insufficient wallet balance" },
        error: "Insufficient wallet balance",
      };
    }
    const txs = await readList(familyId, "finance", "transactions");
    const movement = buildRecurringPostTx({ familyId, item, currency: item.currency });
    const nextTx = sortTransactionsNewestFirst([movement, ...txs]);
    const nextWallets = recomputeWalletBalancesFromLedger(wallets, nextTx);
    const nextRec = list.map((r) =>
      String(r.id) === String(parts[1]) ? advanceRecurringAfterPost(r) : r,
    );
    await writeList(familyId, "finance", "transactions", nextTx);
    await writeList(familyId, "finance", "wallets", nextWallets);
    await writeList(familyId, "finance", "recurring", nextRec);
    await after();
    return { handled: true, data: nextRec.find((r) => String(r.id) === String(parts[1])) };
  }

  if (parts[0] === "recurring" && parts[1] && ["pause", "resume", "close"].includes(parts[2])) {
    const statusMap = { pause: "PAUSED", resume: "ACTIVE", close: "CLOSED" };
    const list = await readList(familyId, "finance", "recurring");
    const next = list.map((r) =>
      String(r.id) === String(parts[1])
        ? { ...r, status: statusMap[parts[2]], updated_at: new Date().toISOString() }
        : r,
    );
    await writeList(familyId, "finance", "recurring", next);
    await after();
    return { handled: true, data: { ok: true, id: parts[1], status: statusMap[parts[2]] } };
  }

  // Transactions (income / expense / transfer / void)
  if (parts[0] === "transactions" && ["income", "expense", "transfer"].includes(parts[1])) {
    const kind = parts[1].toUpperCase();
    const amount = Number(body?.amount || 0);
    const now = new Date().toISOString();
    const row = {
      id: newId("tx"),
      family_id: familyId,
      account_id: body?.account_id || body?.from_account_id || null,
      from_account_id: body?.from_account_id || body?.account_id || null,
      to_account_id: body?.to_account_id || null,
      category_id: body?.category_id || null,
      type: kind,
      transaction_type: kind,
      amount,
      currency: body?.currency || "BDT",
      description: body?.description || "",
      transaction_date: now.slice(0, 10),
      created_at: now,
      updated_at: now,
      status: "POSTED",
      source: "cloud_local",
    };
    const txs = await readList(familyId, "finance", "transactions");
    await writeList(familyId, "finance", "transactions", [row, ...txs]);
    const wallets = await readList(familyId, "finance", "wallets");
    const nextWallets = wallets.map((w) => {
      let bal = Number(w.balance ?? w.current_balance ?? 0);
      if (kind === "INCOME" && w.id === row.account_id) bal += amount;
      if (kind === "EXPENSE" && w.id === row.account_id) bal -= amount;
      if (kind === "TRANSFER") {
        if (w.id === row.from_account_id) bal -= amount;
        if (w.id === row.to_account_id) bal += amount;
      }
      return { ...w, balance: bal, current_balance: bal, updated_at: now };
    });
    await writeList(familyId, "finance", "wallets", nextWallets);
    await after();
    return { handled: true, data: row };
  }

  if (parts[0] === "transactions" && parts[1] && parts[2] === "void") {
    const txId = parts[1];
    const txs = await readList(familyId, "finance", "transactions");
    const target = txs.find((t) => String(t.id) === String(txId));
    if (!target) return { handled: true, data: { ok: false, detail: "not found" } };
    const now = new Date().toISOString();
    const amount = Number(target.amount || 0);
    const kind = String(target.transaction_type || target.type || "").toUpperCase();
    const nextTx = txs.map((t) =>
      String(t.id) === String(txId)
        ? { ...t, status: "VOID", voided_at: now, updated_at: now, void_reason: body?.reason || "VOID" }
        : t,
    );
    await writeList(familyId, "finance", "transactions", nextTx);
    const wallets = await readList(familyId, "finance", "wallets");
    const fromId = target.from_account_id || target.account_id;
    const nextWallets = wallets.map((w) => {
      let bal = Number(w.balance ?? w.current_balance ?? 0);
      if (kind.includes("INCOME") && w.id === target.account_id) bal -= amount;
      else if (kind.includes("EXPENSE") && w.id === (target.account_id || fromId)) bal += amount;
      else if (kind.includes("TRANSFER")) {
        if (w.id === fromId) bal += amount;
        if (w.id === target.to_account_id) bal -= amount;
      }
      return { ...w, balance: bal, current_balance: bal, updated_at: now };
    });
    await writeList(familyId, "finance", "wallets", nextWallets);
    await after();
    return { handled: true, data: { ok: true, id: txId, status: "VOID" } };
  }

  if (parts[0] === "expenses" && parts[1] === "ocr" && parts[2] === "parse") {
    const text = String(body?.raw_text || "");
    const nums = [...text.matchAll(/(\d+(?:\.\d{1,2})?)/g)].map((m) => Number(m[1])).filter((n) => n > 0);
    const total = nums.length ? nums.reduce((a, b) => a + b, 0) : 0;
    return {
      handled: true,
      data: {
        suggested_total: total || null,
        line_count: text.split(/\n/).filter(Boolean).length,
        engine: "cloud_local_regex",
        raw_text: text,
        lines: text.split(/\n/).filter(Boolean).slice(0, 8).map((line) => ({ description: line.trim() })),
        source: "cloud_local",
      },
    };
  }

  // Planner
  if (parts[0] === "tasks" && !parts[1]) {
    const title = String(body?.title || "").trim();
    if (!title) {
      return { handled: true, data: { ok: false, detail: "Title required" }, error: "Title required" };
    }
    const rows = await readList(familyId, "planner", "tasks");
    const row = {
      id: newId("task"),
      family_id: familyId,
      title,
      description: String(body?.description || "").trim() || "",
      due_date: body?.due_date || null,
      priority: String(body?.priority || "MEDIUM").toUpperCase(),
      status: "OPEN",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      source: "cloud_local",
    };
    await writeList(familyId, "planner", "tasks", [row, ...rows]);
    await appendAudit(familyId, { action: "task.create", title: row.title });
    await after();
    return { handled: true, data: row };
  }

  // Complete task
  if (parts[0] === "tasks" && parts[1] && parts[2] === "complete") {
    const taskId = String(parts[1]);
    const rows = await readList(familyId, "planner", "tasks");
    const hit = rows.find((r) => String(r.id) === taskId);
    if (!hit) {
      return { handled: true, data: { ok: false, detail: "Task not found" }, error: "Task not found" };
    }
    const now = new Date().toISOString();
    const next = rows.map((r) =>
      String(r.id) === taskId
        ? { ...r, status: "DONE", completed_at: now, updated_at: now }
        : r,
    );
    await writeList(familyId, "planner", "tasks", next);
    await appendAudit(familyId, { action: "task.complete", title: hit.title || taskId });
    await after();
    return { handled: true, data: next.find((r) => String(r.id) === taskId) || { ok: true } };
  }

  if (parts[0] === "calendar" && !parts[1]) {
    const title = String(body?.title || "").trim();
    if (!title) {
      return { handled: true, data: { ok: false, detail: "Title required" }, error: "Title required" };
    }
    if (!body?.event_date) {
      return { handled: true, data: { ok: false, detail: "Event date required" }, error: "Event date required" };
    }
    const start = String(body?.start_time || "").trim();
    const end = String(body?.end_time || "").trim();
    if (start && end && end < start) {
      return {
        handled: true,
        data: { ok: false, detail: "End time must be after start time" },
        error: "End time must be after start time",
      };
    }
    const rows = await readList(familyId, "planner", "events");
    const row = {
      id: newId("evt"),
      family_id: familyId,
      title,
      description: String(body?.description || "").trim() || "",
      event_date: body.event_date,
      start_time: start || null,
      end_time: end || null,
      event_type: String(body?.event_type || "GENERAL").toUpperCase(),
      status: "SCHEDULED",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      source: "cloud_local",
    };
    await writeList(familyId, "planner", "events", [row, ...rows]);
    await appendAudit(familyId, { action: "calendar.create", title: row.title });
    await after();
    return { handled: true, data: row };
  }

  // Grocery lists / vendors / items
  if (parts[0] === "grocery" && parts[1] === "lists" && !parts[2]) {
    const title = String(body?.title || "").trim() || "List";
    const rows = await readList(familyId, "grocery", "lists");
    const row = {
      id: newId("glist"),
      family_id: familyId,
      title,
      budget_amount: Number(body?.budget_amount || 0),
      currency: body?.currency || "BDT",
      vendor_name: body?.vendor_name || null,
      shopping_date: body?.shopping_date || null,
      note: body?.note || "",
      status: "OPEN",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      source: "cloud_local",
    };
    await writeList(familyId, "grocery", "lists", [row, ...rows]);
    await appendAudit(familyId, { action: "grocery.list.create", title: row.title });
    await appendGroceryActivity(familyId, {
      action_type: "CREATE",
      entity_type: "grocery_lists",
      title: row.title,
    });
    await appendNotification(familyId, { title: "Grocery list created", body: row.title, type: "GROCERY" });
    await after();
    return { handled: true, data: row };
  }
  if (parts[0] === "grocery" && parts[1] === "vendors" && !parts[2]) {
    const name = String(body?.name || body?.vendor_name || "").trim();
    if (!name) {
      return { handled: true, data: { ok: false, detail: "Vendor name required" }, error: "Vendor name required" };
    }
    const rows = await readList(familyId, "grocery", "vendors");
    const row = {
      id: newId("gven"),
      family_id: familyId,
      name,
      phone: body?.phone || "",
      address: body?.address || "",
      category: body?.category || "GENERAL",
      note: body?.note || "",
      is_active: body?.is_active !== false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      source: "cloud_local",
    };
    await writeList(familyId, "grocery", "vendors", [row, ...rows]);
    await appendGroceryActivity(familyId, {
      action_type: "CREATE",
      entity_type: "grocery_vendors",
      title: row.name,
    });
    await after();
    return { handled: true, data: row };
  }
  if (parts[0] === "grocery" && parts[1] === "items" && !parts[2]) {
    const name = String(body?.name || body?.item_name || "").trim();
    if (!name) {
      return { handled: true, data: { ok: false, detail: "Item name required" }, error: "Item name required" };
    }
    const listId = body?.list_id || body?.grocery_list_id;
    if (!listId) {
      return { handled: true, data: { ok: false, detail: "List required" }, error: "List required" };
    }
    const rows = await readList(familyId, "grocery", "items");
    const row = {
      id: newId("gitem"),
      family_id: familyId,
      list_id: listId,
      grocery_list_id: listId,
      name,
      category: body?.category || "GENERAL",
      quantity: Number(body?.quantity || 1) || 1,
      unit: body?.unit || "pcs",
      estimated_price: Number(body?.estimated_price || body?.price || 0) || 0,
      actual_price: Number(body?.actual_price || 0) || 0,
      vendor_name: body?.vendor_name || null,
      barcode: body?.barcode || null,
      note: body?.note || "",
      is_bought: false,
      bought: false,
      posted_transaction_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      source: "cloud_local",
    };
    await writeList(familyId, "grocery", "items", [row, ...rows]);
    await appendGroceryActivity(familyId, {
      action_type: "CREATE",
      entity_type: "grocery_items",
      title: row.name,
    });
    await after();
    return { handled: true, data: row };
  }

  // Post grocery item as expense → wallet debit + link tx id
  if (parts[0] === "grocery" && parts[1] === "items" && parts[2] && parts[3] === "post-expense") {
    const itemId = String(parts[2]);
    const items = await readList(familyId, "grocery", "items");
    const item = items.find((r) => String(r.id) === itemId);
    if (!item) {
      return { handled: true, data: { ok: false, detail: "Item not found" }, error: "Item not found" };
    }
    if (!item.is_bought) {
      return {
        handled: true,
        data: { ok: false, detail: "Mark item bought before posting expense" },
        error: "Mark item bought before posting expense",
      };
    }
    if (item.posted_transaction_id) {
      return {
        handled: true,
        data: {
          ok: true,
          transaction_id: item.posted_transaction_id,
          grocery_item: item,
          already_posted: true,
        },
      };
    }
    const accountId = String(body?.account_id || "").trim();
    const categoryId = String(body?.category_id || "").trim();
    const amount = Number(body?.amount ?? item.actual_price ?? item.estimated_price ?? 0);
    if (!accountId || !categoryId) {
      return {
        handled: true,
        data: { ok: false, detail: "Wallet and category required" },
        error: "Wallet and category required",
      };
    }
    if (!(amount > 0)) {
      return { handled: true, data: { ok: false, detail: "Amount required" }, error: "Amount required" };
    }
    const now = new Date().toISOString();
    const tx = {
      id: newId("tx"),
      family_id: familyId,
      account_id: accountId,
      from_account_id: accountId,
      category_id: categoryId,
      type: "EXPENSE",
      transaction_type: "EXPENSE",
      amount,
      currency: body?.currency || "BDT",
      description: body?.description || `Grocery expense: ${item.name}`,
      transaction_date: now.slice(0, 10),
      created_at: now,
      updated_at: now,
      status: "POSTED",
      grocery_item_id: itemId,
      source: "grocery_post_expense",
    };
    const txs = await readList(familyId, "finance", "transactions");
    await writeList(familyId, "finance", "transactions", [tx, ...txs]);
    const wallets = await readList(familyId, "finance", "wallets");
    const nextWallets = wallets.map((w) => {
      if (String(w.id) !== accountId) return w;
      const bal = Number(w.balance ?? w.current_balance ?? 0) - amount;
      return { ...w, balance: bal, current_balance: bal, updated_at: now };
    });
    await writeList(familyId, "finance", "wallets", nextWallets);
    const nextItems = items.map((r) =>
      String(r.id) === itemId
        ? { ...r, posted_transaction_id: tx.id, updated_at: now }
        : r,
    );
    await writeList(familyId, "grocery", "items", nextItems);
    await appendGroceryActivity(familyId, {
      action_type: "POST_EXPENSE",
      entity_type: "grocery_items",
      title: item.name,
    });
    await after();
    const wallet = nextWallets.find((w) => String(w.id) === accountId);
    return {
      handled: true,
      data: {
        ok: true,
        transaction_id: tx.id,
        grocery_item: nextItems.find((r) => String(r.id) === itemId),
        wallet_balance: wallet?.balance ?? wallet?.current_balance ?? null,
      },
    };
  }

  if (parts[0] === "grocery" && parts[1] === "ocr" && parts[2] === "parse") {
    const text = String(body?.raw_text || "");
    const lines = text
      .split(/\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const suggestions = lines.slice(0, 40).map((line, idx) => {
      const priceMatch = line.match(/(\d+(?:\.\d{1,2})?)\s*$/);
      const amount = priceMatch ? Number(priceMatch[1]) : 0;
      const name = priceMatch ? line.slice(0, priceMatch.index).trim() : line;
      return {
        id: `ocr_${idx}`,
        name: name || `Item ${idx + 1}`,
        estimated_price: amount || 0,
        quantity: 1,
        unit: "pcs",
        category: "GENERAL",
        raw_line: line,
      };
    });
    return {
      handled: true,
      data: {
        suggestions,
        suggestion_count: suggestions.length,
        engine: "cloud_local_regex",
        raw_text: text,
        source: "cloud_local",
      },
    };
  }

  // Life module create: /investments, /health-expenses, ...
  const lifeKey = lifeModuleKey(parts[0]);
  if (lifeKey && !parts[1]) {
    const phase = ["INVESTMENT", "HEALTH", "VEHICLE", "EDUCATION"].includes(lifeKey) ? "phase15" : "phase16";
    const bag = await readDoc(familyId, "life", phase, { items: [], summary: null });
    const items = Array.isArray(bag.items) ? bag.items : [];
    const row = {
      ...normalizeLifeWriteRow(lifeKey, body),
      family_id: familyId,
      created_at: new Date().toISOString(),
      status: "ACTIVE",
      source: "cloud_local",
    };
    const nextItems = [row, ...items];
    await writeDoc(familyId, "life", phase, {
      items: nextItems,
      summary: buildLifePhaseSummary(nextItems),
    });
    await appendAudit(familyId, { action: `life.${lifeKey}.create`, title: row.name });
    await after();
    return { handled: true, data: row };
  }

  // Life module close via POST (matches backend)
  if (lifeKey && parts[1] && parts[2] === "close") {
    const phase = ["INVESTMENT", "HEALTH", "VEHICLE", "EDUCATION"].includes(lifeKey) ? "phase15" : "phase16";
    const bag = await readDoc(familyId, "life", phase, { items: [] });
    const items = Array.isArray(bag.items) ? bag.items : [];
    const itemId = String(parts[1]);
    const nextItems = items.map((r) =>
      String(r.id) === itemId
        ? {
            ...r,
            status: "CLOSED",
            updated_at: new Date().toISOString(),
            close_reason: body?.reason || null,
          }
        : r,
    );
    await writeDoc(familyId, "life", phase, {
      items: nextItems,
      summary: buildLifePhaseSummary(nextItems),
    });
    await after();
    return { handled: true, data: nextItems.find((r) => String(r.id) === itemId) || { ok: true } };
  }

  if (parts[0] === "zakat" && (parts[1] === "calculate" || !parts[1])) {
    const rows = await readList(familyId, "zakat", "main");
    const rates = await readDoc(familyId, "zakat", "metalRates", {
      GOLD: 12000,
      SILVER: 150,
    });
    const goldRate = Number(rates.GOLD || 0);
    const silverRate = Number(rates.SILVER || 0);
    const goldGrams = Number(body.gold_grams || 0);
    const silverGrams = Number(body.silver_grams || 0);
    const cash = Number(body.cash_amount || 0);
    let gold = Number(body.gold_value || 0);
    let silver = Number(body.silver_value || 0);
    if (goldGrams > 0 && goldRate > 0) gold = goldGrams * goldRate;
    if (silverGrams > 0 && silverRate > 0) silver = silverGrams * silverRate;
    const invest = Number(body.investment_value || 0);
    const business = Number(body.business_assets || 0);
    const recv = Number(body.receivables || 0);
    const debts = Number(body.deductible_debts || 0);
    const zakatable = Math.max(0, cash + gold + silver + invest + business + recv - debts);

    const metal = String(body.nisab_metal || "SILVER").toUpperCase();
    const grams = metal === "GOLD" ? 87.48 : 612.36;
    const metalRate = metal === "GOLD" ? goldRate : silverRate;
    let nisab = Number(body.nisab_amount);
    if (!(nisab > 0) && metalRate > 0) {
      nisab = Math.round(metalRate * grams * 100) / 100;
    }
    if (!(nisab > 0)) nisab = 0;

    const isDue = zakatable >= nisab && nisab > 0;
    const due = isDue ? Number((zakatable * 0.025).toFixed(2)) : 0;
    const year = Number(body.calculation_year || new Date().getFullYear());
    const now = new Date().toISOString();
    const row = {
      id: newId("zakat"),
      family_id: familyId,
      calculation_year: year,
      cash_amount: cash,
      gold_value: gold,
      silver_value: silver,
      gold_grams: goldGrams || null,
      silver_grams: silverGrams || null,
      investment_value: invest,
      business_assets: business,
      receivables: recv,
      deductible_debts: debts,
      nisab_amount: nisab,
      nisab_metal: metal,
      note: body.note || "",
      currency: body.currency || "BDT",
      zakatable_amount: zakatable,
      zakat_due: due,
      is_zakat_due: isDue,
      created_at: now,
      updated_at: now,
      source: "cloud_local",
    };
    // Upsert by calculation year
    const withoutYear = rows.filter((r) => Number(r.calculation_year) !== year);
    const next = [row, ...withoutYear];
    await writeList(familyId, "zakat", "main", next);
    await appendAudit(familyId, { action: "zakat.create", title: String(year) });
    await appendNotification(familyId, {
      title: "Zakat calculated",
      body: isDue ? `Due: ${due}` : "Below nisab — not due",
      type: "ZAKAT",
    });
    await after();
    return { handled: true, data: row };
  }

  // Invites (cloud-local codes + Firestore global registry for multi-account join)
  if (parts[0] === "invites" && (parts[1] === "generate" || parts[1] === "email" || parts[1] === "link")) {
    const invites = await readList(familyId, "family", "invites");
    const code = `S4-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const inviteId = newId("inv");
    const row = {
      id: inviteId,
      invite_id: inviteId,
      family_id: familyId,
      code,
      invite_code: code,
      invite_link: `s4familyfinance://join?code=${code}`,
      invitee_email: body.invitee_email || null,
      expires_in_days: Number(body.expires_in_days || 7),
      max_uses: Number(body.max_uses || 1),
      uses: 0,
      status: "ACTIVE",
      email_sent: Boolean(body.send_email && body.invitee_email),
      email_reason: body.send_email
        ? "Invite code ready — share manually (SMTP optional)"
        : "code_only",
      created_at: new Date().toISOString(),
      created_by: currentUser?.email || "owner",
      source: "cloud_local",
    };
    await writeList(familyId, "family", "invites", [row, ...invites]);
    await appendAudit(familyId, { action: "invite.create", title: code });
    await appendNotification(familyId, {
      title: "Invite created",
      body: code,
      type: "FAMILY",
    });
    // Publish to Firestore so another account can join
    try {
      const { publishFamilyInvite } = await import("../firebase/familyCloud");
      const uid = currentUser?.firebase_uid || currentUser?.uid || body.owner_uid;
      if (uid) {
        await publishFamilyInvite({
          code,
          familyId,
          ownerUid: uid,
          inviteeEmail: body.invitee_email || null,
          expiresInDays: Number(body.expires_in_days || 7),
          maxUses: Number(body.max_uses || 1),
        });
        row.cloud_published = true;
      }
    } catch (err) {
      row.cloud_published = false;
      row.cloud_publish_error = err?.message || "publish_failed";
    }
    await after();
    return { handled: true, data: row };
  }

  if (parts[0] === "invites" && parts[1] === "join") {
    const code = String(body.invite_code || body.code || "").trim().toUpperCase();
    // Prefer cross-account Firestore join when firebase uid present
    const uid = currentUser?.firebase_uid || currentUser?.uid || body.uid;
    if (uid) {
      try {
        const { joinFamilyByInviteCode } = await import("../firebase/familyCloud");
        const result = await joinFamilyByInviteCode({
          code,
          uid,
          email: body.email || currentUser?.email || "",
          displayName: body.full_name || currentUser?.full_name || "Member",
          relationshipType: body.relationship_type || "Relative",
        });
        await after();
        return {
          handled: true,
          data: {
            ...result,
            family_id: result.familyId,
            switched: true,
            source: "firestore_invite",
          },
        };
      } catch (err) {
        const msg = String(err?.message || "");
        // Only fall through to local invite list for "not in registry" style failures
        if (/Invalid|expired|used|not found/i.test(msg) && familyId) {
          /* try local below */
        } else {
          throw err;
        }
      }
    }

    const invites = await readList(familyId, "family", "invites");
    const hit = invites.find((i) => String(i.code || i.invite_code || "").toUpperCase() === code);
    if (!hit || hit.status !== "ACTIVE") {
      throw new Error("Invalid or expired invite code");
    }
    const members = await readList(familyId, "family", "members");
    const member = {
      id: newId("mem"),
      member_id: newId("mem"),
      family_id: familyId,
      full_name: body.full_name || currentUser?.full_name || "Member",
      email: body.email || currentUser?.email || "",
      role: "MEMBER",
      relationship_type: body.relationship_type || "Relative",
      status: "ACTIVE",
      joined_at: new Date().toISOString(),
      source: "cloud_local",
    };
    await writeList(familyId, "family", "members", [...members, member]);
    hit.uses = Number(hit.uses || 0) + 1;
    if (hit.uses >= Number(hit.max_uses || 1)) hit.status = "USED";
    await writeList(
      familyId,
      "family",
      "invites",
      invites.map((i) => (i.id === hit.id ? hit : i)),
    );
    await after();
    return { handled: true, data: { member, invite: hit } };
  }

  if (parts[0] === "invites" && parts[2] === "revoke") {
    const invites = await readList(familyId, "family", "invites");
    const key = String(parts[1] || "").trim();
    const target = invites.find(
      (i) =>
        String(i.id) === key ||
        String(i.invite_id || "") === key ||
        String(i.code || i.invite_code || "").toUpperCase() === key.toUpperCase(),
    );
    if (!target) {
      return { handled: true, data: { ok: false, detail: "Invite not found" }, error: "Invite not found" };
    }
    const next = invites.map((i) =>
      String(i.id) === String(target.id) ? { ...i, status: "REVOKED", updated_at: new Date().toISOString() } : i,
    );
    await writeList(familyId, "family", "invites", next);
    if (target?.code || target?.invite_code) {
      try {
        const { revokeFamilyInvite } = await import("../firebase/familyCloud");
        await revokeFamilyInvite(target.code || target.invite_code);
      } catch {
        /* ignore offline / already revoked */
      }
    }
    await after();
    return { handled: true, data: { ok: true, invite_id: target.id } };
  }

  // Join-request approve / reject (Owner governance)
  if (parts[0] === "join-requests" && parts[1] && parts[2] === "decision") {
    const requestId = String(parts[1] || "").trim();
    const decision = String(body?.decision || body?.action || "")
      .trim()
      .toUpperCase();
    if (!requestId) {
      return { handled: true, data: { ok: false, detail: "request id required" }, error: "request id required" };
    }
    if (!["APPROVE", "REJECT", "APPROVED", "REJECTED"].includes(decision)) {
      return {
        handled: true,
        data: { ok: false, detail: "decision must be APPROVE or REJECT" },
        error: "decision must be APPROVE or REJECT",
      };
    }
    const approved = decision === "APPROVE" || decision === "APPROVED";
    const requests = await readList(familyId, "family", "joinRequests");
    const hit = requests.find((r) => String(r.id) === requestId);
    if (!hit) {
      return { handled: true, data: { ok: false, detail: "Join request not found" }, error: "Join request not found" };
    }
    const now = new Date().toISOString();
    const nextStatus = approved ? "APPROVED" : "REJECTED";
    const nextRequests = requests.map((r) =>
      String(r.id) === requestId
        ? {
            ...r,
            status: nextStatus,
            decision: nextStatus,
            decided_at: now,
            updated_at: now,
            note: body?.note || body?.reason || r.note || null,
          }
        : r,
    );
    await writeList(familyId, "family", "joinRequests", nextRequests);

    if (approved) {
      const members = await readList(familyId, "family", "members");
      const memberKey = String(
        hit.uid || hit.user_id || hit.member_id || hit.email || hit.id || "",
      ).trim();
      const already = members.some((m) => {
        const ids = [m.member_id, m.id, m.uid, m.user_id, m.email]
          .filter(Boolean)
          .map((v) => String(v).toLowerCase());
        return memberKey && ids.includes(memberKey.toLowerCase());
      });
      if (!already && memberKey) {
        const mid = String(hit.uid || hit.user_id || hit.member_id || newId("mem"));
        const member = {
          id: mid,
          member_id: mid,
          user_id: mid,
          uid: hit.uid || mid,
          full_name: hit.full_name || hit.display_name || hit.email || "Member",
          email: hit.email || "",
          role: "MEMBER",
          normalized_role: "MEMBER",
          relationship: hit.relationship_type || hit.relationship || "",
          relationship_type: hit.relationship_type || hit.relationship || "",
          status: "ACTIVE",
          overrides: [],
          joined_at: now,
          source: "join_request_approve",
        };
        await writeList(familyId, "family", "members", [member, ...members]);
      }
    }

    await appendAudit(familyId, {
      action: approved ? "JOIN_APPROVE" : "JOIN_REJECT",
      request_id: requestId,
    });
    await after();
    return {
      handled: true,
      data: { ok: true, id: requestId, status: nextStatus, decision: nextStatus },
    };
  }

  // Soft-archive family (Owner)
  if (parts[0] === "families" && parts[1] === familyId && parts[2] === "deactivate") {
    const pendingTransfers = (await readList(familyId, "family", "ownershipTransfers")).filter((r) =>
      ["PENDING", "PENDING_ADMIN", "PENDING_ACCEPT"].includes(String(r.status || "").toUpperCase()),
    );
    if (pendingTransfers.length) {
      return {
        handled: true,
        data: { ok: false, detail: "Cancel pending ownership transfer first" },
        error: "Cancel pending ownership transfer first",
      };
    }
    const profile = await readDoc(familyId, "system", "familyProfile", { id: familyId });
    const now = new Date().toISOString();
    await writeDoc(familyId, "system", "familyProfile", {
      ...profile,
      id: familyId,
      status: "ARCHIVED",
      is_active: false,
      deactivated_at: now,
      updated_at: now,
      source: "cloud_local",
    });
    await appendAudit(familyId, { action: "FAMILY_DEACTIVATE" });
    await after();
    return { handled: true, data: { ok: true, status: "ARCHIVED", family_id: familyId } };
  }

  // Tags
  if (parts[0] === "tags" && !parts[1]) {
    const cleaned = String(body?.name || body?.name_en || "").trim();
    if (!cleaned) {
      return { handled: true, data: { ok: false, detail: "Tag name required" }, error: "Tag name required" };
    }
    const rows = await readList(familyId, "finance", "tags");
    if (rows.some((r) => String(r.name || "").trim().toLowerCase() === cleaned.toLowerCase())) {
      return { handled: true, data: { ok: false, detail: "Tag already exists" }, error: "Tag already exists" };
    }
    const row = {
      id: newId("tag"),
      family_id: familyId,
      name: cleaned,
      name_en: cleaned,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      source: "cloud_local",
    };
    await writeList(familyId, "finance", "tags", [row, ...rows]);
    await after();
    return { handled: true, data: row };
  }
  if (parts[0] === "transaction-tags" && !parts[1]) {
    const txId = body?.transaction_id;
    const tagId = body?.tag_id;
    if (!txId || !tagId) {
      return {
        handled: true,
        data: { ok: false, detail: "Transaction and tag required" },
        error: "Transaction and tag required",
      };
    }
    const rows = await readList(familyId, "finance", "transactionTags");
    if (
      rows.some(
        (r) => String(r.transaction_id) === String(txId) && String(r.tag_id) === String(tagId),
      )
    ) {
      return {
        handled: true,
        data: { ok: false, detail: "Tag already attached" },
        error: "Tag already attached",
      };
    }
    const tags = await readList(familyId, "finance", "tags");
    if (!tags.some((t) => String(t.id) === String(tagId))) {
      return { handled: true, data: { ok: false, detail: "Tag required" }, error: "Tag required" };
    }
    const row = {
      id: newId("ttag"),
      family_id: familyId,
      transaction_id: txId,
      tag_id: tagId,
      created_at: new Date().toISOString(),
      source: "cloud_local",
    };
    await writeList(familyId, "finance", "transactionTags", [row, ...rows]);
    await after();
    return { handled: true, data: row };
  }

  // Currency rates / base
  if (parts[0] === "currency" && (parts[1] === "rates" || parts[1] === "rate")) {
    const bag = await readDoc(familyId, "system", "currency", {
      currencies: [],
      exchangeRates: [],
      code: "BDT",
    });
    const rates = Array.isArray(bag.exchangeRates) ? bag.exchangeRates : [];
    const row = {
      from_currency: body.from_currency || body.from || "USD",
      to_currency: body.to_currency || body.to || "BDT",
      rate: Number(body.rate || 0),
      updated_at: new Date().toISOString(),
      source: "cloud_local",
    };
    const next = [
      row,
      ...rates.filter(
        (r) =>
          !(
            r.from_currency === row.from_currency && r.to_currency === row.to_currency
          ),
      ),
    ];
    await writeDoc(familyId, "system", "currency", { ...bag, exchangeRates: next });
    await after();
    return { handled: true, data: row };
  }
  if (parts[0] === "currency" && !parts[1]) {
    const bag = await readDoc(familyId, "system", "currency", {
      currencies: [],
      exchangeRates: [],
      code: "BDT",
    });
    const currencies = Array.isArray(bag.currencies) ? bag.currencies : [];
    const row = {
      code: body.code || "BDT",
      name: body.name || body.code || "Currency",
      symbol: body.symbol || body.code || "",
      is_base: Boolean(body.is_base),
      source: "cloud_local",
    };
    const next = [row, ...currencies.filter((c) => c.code !== row.code)];
    await writeDoc(familyId, "system", "currency", {
      ...bag,
      currencies: next,
      code: row.is_base ? row.code : bag.code || row.code,
      symbol: row.is_base ? row.symbol : bag.symbol || row.symbol,
    });
    await after();
    return { handled: true, data: row };
  }

  // Metal rates
  if (parts[0] === "zakat" && parts[1] === "metal-rates") {
    const prev = await readDoc(familyId, "zakat", "metalRates", {});
    const next = {
      ...prev,
      [String(body.metal || "GOLD").toUpperCase()]: Number(body.rate_bdt || body.rate || 0),
      updated_at: new Date().toISOString(),
      source: "cloud_local",
    };
    await writeDoc(familyId, "zakat", "metalRates", next);
    await after();
    return { handled: true, data: next };
  }

  // Split expense → linked share rows; wallet debit = sum of shares via ledger
  if (parts[0] === "expenses" && parts[1] === "split") {
    const amount = Number(body.amount || 0);
    const splits = Array.isArray(body.splits) ? body.splits : [];
    if (!body?.account_id) {
      return { handled: true, data: { ok: false, detail: "Wallet required" }, error: "Wallet required" };
    }
    if (!amount || amount <= 0) {
      return {
        handled: true,
        data: { ok: false, detail: "Valid amount required" },
        error: "Valid amount required",
      };
    }
    if (splits.length < 2) {
      return {
        handled: true,
        data: { ok: false, detail: "Select both members for split expense" },
        error: "Select both members for split expense",
      };
    }
    const memberIds = splits.map((s) => String(s.member_id || ""));
    if (memberIds[0] && memberIds[1] && memberIds[0] === memberIds[1]) {
      return {
        handled: true,
        data: { ok: false, detail: "Split members must be different" },
        error: "Split members must be different",
      };
    }
    const { loadOfflineSnapshot, saveOfflineSnapshot } = await import("./offlineCache");
    const { recomputeWalletBalancesFromLedger, walletBalance } = await import("./cloudLocalFinance");
    const cached = await loadOfflineSnapshot(familyId, "finance", "transactions").catch(() => null);
    const txs = Array.isArray(cached?.data) ? cached.data : [];
    const walCached = await loadOfflineSnapshot(familyId, "finance", "wallets").catch(() => null);
    const wallets = Array.isArray(walCached?.data) ? walCached.data : [];
    const wallet = wallets.find((w) => String(w.id) === String(body.account_id));
    if (!wallet || wallet.deleted_at || wallet.is_active === false) {
      return { handled: true, data: { ok: false, detail: "Wallet required" }, error: "Wallet required" };
    }
    if (walletBalance(wallet) < amount) {
      return {
        handled: true,
        data: { ok: false, detail: "Insufficient wallet balance" },
        error: "Insufficient wallet balance",
      };
    }
    const now = new Date().toISOString();
    const baseId = newId("tx");
    const created = splits.map((s, idx) => ({
      id: `${baseId}_${idx}`,
      family_id: familyId,
      account_id: body.account_id,
      from_account_id: body.account_id,
      category_id: body.category_id || null,
      type: "EXPENSE",
      transaction_type: "EXPENSE",
      amount: Number(s.share_amount || 0),
      currency: body.currency || "BDT",
      description: `${body.description || "Split"} (${s.member_id || idx})`,
      member_id: s.member_id || null,
      split_group_id: baseId,
      status: "POSTED",
      is_split: true,
      transaction_date: now.slice(0, 10),
      created_at: now,
      updated_at: now,
      source: "cloud_local",
    }));
    const nextTx = [...created, ...txs];
    await saveOfflineSnapshot(familyId, "finance", "transactions", nextTx);
    const nextWallets = recomputeWalletBalancesFromLedger(wallets, nextTx);
    await saveOfflineSnapshot(familyId, "finance", "wallets", nextWallets);
    await appendAudit(familyId, { action: "expense.split", title: body.description || baseId });
    await after();
    return { handled: true, data: { id: baseId, amount, splits: created, source: "cloud_local" } };
  }

  // Notification test endpoints — in-app + browser Notification API
  if (parts[0] === "notifications" && parts[1] === "test-email") {
    await appendNotification(familyId, {
      title: "Test notification",
      body: "Saved in-app. Email SMTP is optional; invite codes work without SMTP.",
      type: "TEST",
      notification_type: "TEST",
      severity: "LOW",
    });
    await after();
    return { handled: true, data: { sent: true, channel: "in_app", reason: "cloud_in_app" } };
  }
  if (parts[0] === "notifications" && parts[1] === "test-push") {
    const title = "S4 Family Finance 143";
    const bodyText = "Push test — browser/local notification";
    await appendNotification(familyId, {
      title,
      body: bodyText,
      type: "TEST",
      notification_type: "TEST",
      severity: "MEDIUM",
    });
    let pushShown = false;
    let pushReason = "browser_unavailable";
    try {
      if (typeof Notification !== "undefined") {
        if (Notification.permission === "granted") {
          new Notification(title, { body: bodyText, icon: "/icon-192.png" });
          pushShown = true;
          pushReason = "browser_notification";
        } else if (Notification.permission !== "denied") {
          const perm = await Notification.requestPermission();
          if (perm === "granted") {
            new Notification(title, { body: bodyText, icon: "/icon-192.png" });
            pushShown = true;
            pushReason = "browser_notification";
          } else {
            pushReason = "permission_not_granted";
          }
        } else {
          pushReason = "permission_denied";
        }
      }
    } catch (err) {
      console.error("[S4 Notify] test-push failed", err);
      pushReason = err?.message || "notification_error";
    }
    await after();
    return {
      handled: true,
      data: {
        sent: true,
        sent_count: pushShown ? 1 : 0,
        channel: pushShown ? "browser_notification" : "in_app_only",
        reason: pushReason,
      },
    };
  }

  if (parts[0] === "notifications" && parts[1] === "devices" && parts[2] === familyId) {
    const devices = await readList(familyId, "system", "pushDevices", []);
    const token = String(body?.token || "").trim();
    if (token.length < 8) {
      return { handled: true, data: { ok: false, reason: "token_too_short" } };
    }
    const existing = devices.find((d) => d.token === token);
    const row = {
      id: existing?.id || newId("dev"),
      token,
      platform: body?.platform || "WEB",
      provider: body?.provider || "FCM",
      device_label: body?.device_label || "web-browser",
      created_at: existing?.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
      is_active: true,
    };
    const next = existing
      ? devices.map((d) => (d.token === token ? row : d))
      : [row, ...devices].slice(0, 20);
    await writeList(familyId, "system", "pushDevices", next);
    await after();
    return { handled: true, data: row };
  }

  if (parts[0] === "notifications" && parts[1] === "scan" && parts[2] === familyId) {
    const created = await appendNotification(familyId, {
      title: "Activity check",
      body: "Cloud scan complete — review family alerts in the inbox.",
      type: "SCAN",
      notification_type: "SCAN",
      severity: "LOW",
    });
    await after();
    return {
      handled: true,
      data: { created_notifications: 1, unread_notifications: created.filter((r) => !r.read).length },
    };
  }

  // Ownership transfer — Owner creates PENDING_ACCEPT (2-person families have no third Admin)
  if (parts[0] === "families" && parts[1] === familyId && parts[2] === "ownership-transfer") {
    const rows = await readList(familyId, "family", "ownershipTransfers");
    const actorUid = String(
      currentUser?.uid || currentUser?.firebase_uid || currentUser?.id || "",
    ).trim();
    if (!parts[3]) {
      const toId = String(body?.to_member_id || body?.member_id || "").trim();
      if (!toId) {
        return {
          handled: true,
          data: { ok: false, detail: "to_member_id required" },
          error: "to_member_id required",
        };
      }
      const pending = rows.filter((r) =>
        ["PENDING", "PENDING_ADMIN", "PENDING_ACCEPT"].includes(String(r.status || "").toUpperCase()),
      );
      if (pending.length) {
        return {
          handled: true,
          data: { ok: false, detail: "A transfer is already pending" },
          error: "A transfer is already pending",
        };
      }
      const row = {
        id: newId("otr"),
        family_id: familyId,
        from_member_id: String(body?.from_member_id || actorUid || "").trim(),
        to_member_id: toId,
        note: body?.note || null,
        status: "PENDING_ACCEPT",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        created_by: actorUid || currentUser?.email || "",
        source: "cloud_local",
      };
      await writeList(familyId, "family", "ownershipTransfers", [row, ...rows]);
      await after();
      return { handled: true, data: row };
    }
    const requestId = parts[3];
    const action = parts[4]; // accept | admin-approve | cancel
    const nextStatus =
      action === "accept"
        ? "ACCEPTED"
        : action === "admin-approve"
          ? "PENDING_ACCEPT"
          : action === "cancel"
            ? "CANCELLED"
            : null;
    if (nextStatus) {
      const target = rows.find((r) => String(r.id) === String(requestId));
      if (!target) {
        return {
          handled: true,
          data: { ok: false, detail: "Transfer not found" },
          error: "Transfer not found",
        };
      }
      const next = rows.map((r) =>
        String(r.id) === String(requestId)
          ? { ...r, status: nextStatus, updated_at: new Date().toISOString() }
          : r,
      );
      await writeList(familyId, "family", "ownershipTransfers", next);

      if (action === "accept" && target?.to_member_id) {
        const toId = String(target.to_member_id);
        const fromId = String(target.from_member_id || "").trim();
        const members = await readList(familyId, "family", "members");
        const matches = (raw, id) =>
          [raw.member_id, raw.id, raw.uid, raw.user_id].filter(Boolean).map(String).includes(String(id));
        const nextMembers = members.map((raw) => {
          const role = String(raw.role || raw.normalized_role || "").toUpperCase();
          if (matches(raw, toId)) {
            return {
              ...raw,
              role: "OWNER",
              normalized_role: "OWNER",
              member_role: "OWNER",
              updated_at: new Date().toISOString(),
            };
          }
          if (role === "OWNER" || (fromId && matches(raw, fromId))) {
            return {
              ...raw,
              role: "ADMIN",
              normalized_role: "ADMIN",
              member_role: "ADMIN",
              updated_at: new Date().toISOString(),
            };
          }
          return raw;
        });
        await writeList(familyId, "family", "members", nextMembers);

        const profile = await readDoc(familyId, "system", "familyProfile", { id: familyId });
        await writeDoc(familyId, "system", "familyProfile", {
          ...profile,
          id: familyId,
          owner_uid: toId,
          owner_id: toId,
          updated_at: new Date().toISOString(),
        });

        try {
          const { acceptOwnershipTransferCloud } = await import("../firebase/familyCloud");
          await acceptOwnershipTransferCloud({
            familyId,
            toUid: toId,
            fromUid: fromId || actorUid,
          });
        } catch (err) {
          console.warn("[S4 OwnershipTransfer] cloud sync skipped", err);
        }
        await appendAudit(familyId, {
          action: "OWNERSHIP_TRANSFER_ACCEPT",
          to_member_id: toId,
          from_member_id: fromId,
        });
      }

      await after();
      return { handled: true, data: next.find((r) => String(r.id) === String(requestId)) || { ok: true } };
    }
  }

  return { handled: false };
}

export async function cloudApiPatch({ familyId, path, body, onAfterWrite, currentUser }) {
  if (!familyId) return { handled: false };
  const clean = stripQuery(path);
  const parts = clean.replace(/^\//, "").split("/").filter(Boolean);
  const after = typeof onAfterWrite === "function" ? onAfterWrite : async () => {};

  if (parts[0] === "budgets" && parts[1] && !parts[2]) {
    const existing = await readBudgets(familyId);
    const cats = await readList(familyId, "finance", "categories");
    const id = String(parts[1]);
    const target = existing.find((b) => String(b.id) === id);
    if (!target) {
      return { handled: true, data: { ok: false, detail: "not found" }, error: "not found" };
    }
    const nextCategory = body?.category_id ?? target.category_id;
    const nextPeriod = body?.period_type || target.period_type || "MONTHLY";
    const dupKey = budgetDuplicateKey({ category_id: nextCategory, period_type: nextPeriod });
    const dup = existing.find(
      (b) =>
        String(b.id) !== id &&
        String(b.status || "").toUpperCase() === "ACTIVE" &&
        budgetDuplicateKey(b) === dupKey,
    );
    if (dup) {
      return {
        handled: true,
        data: { ok: false, detail: "Duplicate active budget for category/period" },
        error: "Duplicate active budget for category/period",
      };
    }
    const cat = cats.find((c) => String(c.id) === String(nextCategory));
    const next = existing.map((b) =>
      String(b.id) === id
        ? {
            ...b,
            name: body?.name != null ? String(body.name).trim() : b.name,
            budget_amount:
              body?.budget_amount != null ? Number(body.budget_amount) : Number(b.budget_amount || 0),
            note: body?.note != null ? body.note : b.note,
            category_id: nextCategory,
            category_name: cat?.name_en || cat?.name || b.category_name || "",
            period_type: nextPeriod,
            updated_at: new Date().toISOString(),
          }
        : b,
    );
    await writeBudgets(familyId, next);
    await after();
    return { handled: true, data: next.find((b) => String(b.id) === id) };
  }

  if (parts[0] === "savings" && parts[1] && !parts[2]) {
    const existing = normalizeSavingsList(await readList(familyId, "finance", "savings"));
    const id = String(parts[1]);
    const next = existing.map((g) =>
      String(g.id) === id
        ? {
            ...g,
            name: body?.name != null ? String(body.name).trim() : g.name,
            target_amount: body?.target_amount != null ? Number(body.target_amount) : Number(g.target_amount || 0),
            note: body?.note != null ? body.note : g.note,
            updated_at: new Date().toISOString(),
          }
        : g,
    );
    const txs = await readList(familyId, "finance", "transactions");
    const enriched = recomputeSavingsFromLedger(next, txs);
    await writeList(familyId, "finance", "savings", enriched);
    await after();
    return { handled: true, data: enriched.find((g) => String(g.id) === id) };
  }

  if (parts[0] === "loans" && parts[1] && !parts[2]) {
    const existing = await readList(familyId, "finance", "loans");
    const id = String(parts[1]);
    const next = existing.map((loan) =>
      String(loan.id) === id
        ? {
            ...loan,
            person_name:
              body?.person_name != null ? String(body.person_name).trim() : loan.person_name,
            note: body?.note != null ? body.note : loan.note,
            updated_at: new Date().toISOString(),
          }
        : loan,
    );
    await writeList(familyId, "finance", "loans", next);
    await after();
    return { handled: true, data: next.find((l) => String(l.id) === id) };
  }

  if (parts[0] === "goals" && parts[1] && !parts[2]) {
    const existing = await readList(familyId, "finance", "goals");
    const id = String(parts[1]);
    const txs = await readList(familyId, "finance", "transactions");
    const nextRaw = existing.map((goal) =>
      String(goal.id) === id
        ? {
            ...goal,
            goal_name:
              body?.goal_name != null ? String(body.goal_name).trim() : goal.goal_name,
            name: body?.goal_name != null ? String(body.goal_name).trim() : goal.name,
            goal_type: body?.goal_type != null ? body.goal_type : goal.goal_type,
            target_amount:
              body?.target_amount != null ? Number(body.target_amount) : Number(goal.target_amount || 0),
            target_date: body?.target_date !== undefined ? body.target_date : goal.target_date,
            note: body?.note != null ? body.note : goal.note,
            updated_at: new Date().toISOString(),
          }
        : goal,
    );
    const next = recomputeGoalsFromLedger(nextRaw, txs);
    await writeList(familyId, "finance", "goals", next);
    await writeDoc(familyId, "finance", "goalSummary", buildGoalSummary(next));
    await after();
    return { handled: true, data: next.find((g) => String(g.id) === id) };
  }

  if (parts[0] === "recurring" && parts[1] && !parts[2]) {
    const existing = await readList(familyId, "finance", "recurring");
    const id = String(parts[1]);
    const next = existing.map((row) =>
      String(row.id) === id
        ? {
            ...row,
            title: body?.title != null ? String(body.title).trim() : row.title,
            amount: body?.amount != null ? Number(body.amount) : Number(row.amount || 0),
            frequency: body?.frequency != null ? body.frequency : row.frequency,
            end_date: body?.end_date !== undefined ? body.end_date : row.end_date,
            description: body?.description != null ? body.description : row.description,
            updated_at: new Date().toISOString(),
          }
        : row,
    );
    await writeList(familyId, "finance", "recurring", next);
    await after();
    return { handled: true, data: next.find((r) => String(r.id) === id) };
  }

  // Family settings (currency / timezone) — Owner/Admin with settings.manage
  if (
    parts[0] === "families" &&
    parts[1] === familyId &&
    (parts[2] === "settings" || parts[2] === "currency")
  ) {
    const nextCurrency = String(
      body?.default_currency || body?.currency || "",
    )
      .trim()
      .toUpperCase();
    const nextTimezone = String(body?.timezone || "").trim();

    if (parts[2] === "settings" && !nextCurrency && !nextTimezone) {
      return {
        handled: true,
        data: { ok: false, detail: "No settings provided" },
        error: "No settings provided",
      };
    }
    if (parts[2] === "currency" && !nextCurrency) {
      return {
        handled: true,
        data: { ok: false, detail: "Invalid currency code" },
        error: "Invalid currency code",
      };
    }

    // OWNER / ADMIN always have settings.manage in cloud mode
    const members = await loadPermissionMembers(familyId);
    const me = findCurrentMember(members, currentUser);
    const myUid = String(currentUser?.uid || currentUser?.firebase_uid || currentUser?.id || "").trim();
    const ownerUid = await resolveFamilyOwnerUid(familyId, currentUser, members);
    const role = preferElevatedRole(
      normalizeMemberRole(me || {}),
      myUid && ownerUid && myUid === ownerUid ? "OWNER" : "",
    );
    const effective = me?.effective_permissions || defaultPermissionsForRole(role || "MEMBER");
    const canManage =
      role === "OWNER" ||
      role === "ADMIN" ||
      effective.includes("*") ||
      effective.includes("settings.manage");
    if (!canManage) {
      const err = new Error("Permission denied: settings.manage");
      err.status = 403;
      err.isPermission = true;
      throw err;
    }

    const profile = await readDoc(familyId, "system", "familyProfile", {
      id: familyId,
      default_currency: "BDT",
      timezone: "Asia/Dhaka",
    });
    const currencyBag = await readDoc(familyId, "system", "currency", {
      code: "BDT",
      symbol: "BDT",
    });

    const oldCurrency = profile.default_currency || currencyBag.code || "BDT";
    const oldTimezone = profile.timezone || "Asia/Dhaka";
    const appliedCurrency = nextCurrency || oldCurrency;
    const appliedTimezone = nextTimezone || oldTimezone;

    await writeDoc(familyId, "system", "familyProfile", {
      ...profile,
      id: familyId,
      default_currency: appliedCurrency,
      currency: appliedCurrency,
      timezone: appliedTimezone,
      updated_at: new Date().toISOString(),
      source: "cloud_local",
    });
    await writeDoc(familyId, "system", "currency", {
      ...currencyBag,
      code: appliedCurrency,
      symbol: currencyBag.symbol || appliedCurrency,
      currencySummary: {
        ...(currencyBag.currencySummary || {}),
        base_currency: appliedCurrency,
        source: "cloud_local",
      },
      updated_at: new Date().toISOString(),
    });

    await appendAudit(familyId, {
      action: "FAMILY_SETTINGS_UPDATE",
      default_currency: appliedCurrency,
      timezone: appliedTimezone,
    });

    // Persist to Firestore family meta (multi-device)
    try {
      const { updateFamilyCloudSettings } = await import("../firebase/familyCloud");
      await updateFamilyCloudSettings({
        familyId,
        currency: appliedCurrency,
        timezone: appliedTimezone,
        actorUid: currentUser?.uid || currentUser?.firebase_uid || me?.user_id || me?.uid,
      });
    } catch (err) {
      // Local snapshots already saved — surface Firestore errors clearly
      const msg = String(err?.message || "");
      if (/permission denied/i.test(msg)) {
        throw err;
      }
      if (/network|unavailable|connection/i.test(msg)) {
        throw err;
      }
      console.warn("[S4 FamilySettings] Firestore meta update skipped", err);
    }

    await after();
    return {
      handled: true,
      data: {
        success: true,
        family_id: familyId,
        old_currency: oldCurrency,
        new_currency: appliedCurrency,
        old_timezone: oldTimezone,
        new_timezone: appliedTimezone,
        default_currency: appliedCurrency,
        timezone: appliedTimezone,
        source: "cloud_local",
      },
    };
  }

  // Task update
  if (parts[0] === "tasks" && parts[1] && !parts[2]) {
    const taskId = String(parts[1]);
    const rows = await readList(familyId, "planner", "tasks");
    const hit = rows.find((r) => String(r.id) === taskId);
    if (!hit) {
      return { handled: true, data: { ok: false, detail: "Task not found" }, error: "Task not found" };
    }
    const next = rows.map((r) =>
      String(r.id) === taskId
        ? {
            ...r,
            ...body,
            id: r.id,
            status: body?.status ? String(body.status).toUpperCase() : r.status,
            priority: body?.priority ? String(body.priority).toUpperCase() : r.priority,
            updated_at: new Date().toISOString(),
          }
        : r,
    );
    await writeList(familyId, "planner", "tasks", next);
    await after();
    return { handled: true, data: next.find((r) => String(r.id) === taskId) || {} };
  }

  // Calendar update / soft-cancel
  if (parts[0] === "calendar" && parts[1] && !parts[2]) {
    const eventId = String(parts[1]);
    const rows = await readList(familyId, "planner", "events");
    const hit = rows.find((r) => String(r.id) === eventId);
    if (!hit) {
      return { handled: true, data: { ok: false, detail: "Event not found" }, error: "Event not found" };
    }
    const next = rows.map((r) =>
      String(r.id) === eventId
        ? {
            ...r,
            ...body,
            id: r.id,
            status: body?.status ? String(body.status).toUpperCase() : r.status,
            event_type: body?.event_type ? String(body.event_type).toUpperCase() : r.event_type,
            updated_at: new Date().toISOString(),
          }
        : r,
    );
    await writeList(familyId, "planner", "events", next);
    await after();
    return { handled: true, data: next.find((r) => String(r.id) === eventId) || {} };
  }

  // Grocery item buy / unbuy / update
  if (parts[0] === "grocery" && parts[1] === "items" && parts[2]) {
    const itemId = String(parts[2]);
    const action = String(parts[3] || "").toLowerCase();
    const rows = await readList(familyId, "grocery", "items");
    const hit = rows.find((r) => String(r.id) === itemId);
    if (!hit) {
      return { handled: true, data: { ok: false, detail: "Item not found" }, error: "Item not found" };
    }
    const now = new Date().toISOString();
    let patch = { ...body, updated_at: now };
    if (action === "buy" || body?.is_bought === true) {
      const actual = Number(body?.actual_price ?? hit.actual_price ?? hit.estimated_price ?? 0) || 0;
      const vendorName = body?.vendor_name ?? hit.vendor_name ?? null;
      patch = {
        ...patch,
        is_bought: true,
        bought: true,
        actual_price: actual,
        vendor_name: vendorName,
        bought_at: now,
      };
      const history = await readList(familyId, "grocery", "priceHistory");
      await writeList(familyId, "grocery", "priceHistory", [
        {
          id: newId("gph"),
          family_id: familyId,
          name: hit.name,
          item_name: hit.name,
          barcode: hit.barcode || null,
          vendor_name: vendorName,
          price: actual,
          actual_price: actual,
          estimated_price: Number(hit.estimated_price || 0) || 0,
          currency: body?.currency || "BDT",
          purchased_at: now,
          source: "cloud_local",
        },
        ...history,
      ].slice(0, 200));
    } else if (action === "unbuy" || body?.is_bought === false) {
      patch = {
        ...patch,
        is_bought: false,
        bought: false,
        bought_at: null,
      };
    }
    const next = rows.map((r) => (String(r.id) === itemId ? { ...r, ...patch, id: r.id } : r));
    await writeList(familyId, "grocery", "items", next);
    if (action === "buy" || body?.is_bought === true || action === "unbuy" || body?.is_bought === false) {
      await recomputeGroceryVendorSummary(familyId);
      await appendGroceryActivity(familyId, {
        action_type: action === "unbuy" || body?.is_bought === false ? "UNBUY" : "BUY",
        entity_type: "grocery_items",
        title: hit.name,
      });
    }
    await after();
    return { handled: true, data: next.find((r) => String(r.id) === itemId) || {} };
  }

  // Life module update
  const lifeKey = lifeModuleKey(parts[0]);
  if (lifeKey && parts[1] && parts[2] !== "close") {
    const phase = ["INVESTMENT", "HEALTH", "VEHICLE", "EDUCATION"].includes(lifeKey) ? "phase15" : "phase16";
    const bag = await readDoc(familyId, "life", phase, { items: [] });
    const items = Array.isArray(bag.items) ? bag.items : [];
    const itemId = String(parts[1]);
    const nextItems = items.map((r) =>
      String(r.id) === itemId
        ? normalizeLifeWriteRow(lifeKey, body, { ...r, family_id: familyId })
        : r,
    );
    await writeDoc(familyId, "life", phase, {
      items: nextItems,
      summary: buildLifePhaseSummary(nextItems),
    });
    await after();
    return { handled: true, data: nextItems.find((r) => String(r.id) === itemId) || {} };
  }

  if (lifeKey && parts[1] && parts[2] === "close") {
    const phase = ["INVESTMENT", "HEALTH", "VEHICLE", "EDUCATION"].includes(lifeKey) ? "phase15" : "phase16";
    const bag = await readDoc(familyId, "life", phase, { items: [] });
    const items = Array.isArray(bag.items) ? bag.items : [];
    const itemId = String(parts[1]);
    const nextItems = items.map((r) =>
      String(r.id) === itemId
        ? {
            ...r,
            status: "CLOSED",
            updated_at: new Date().toISOString(),
            close_reason: body?.reason || null,
          }
        : r,
    );
    await writeDoc(familyId, "life", phase, {
      items: nextItems,
      summary: buildLifePhaseSummary(nextItems),
    });
    await after();
    return { handled: true, data: nextItems.find((r) => String(r.id) === itemId) || { ok: true } };
  }

  if (parts[0] === "notifications" && parts[1] === "read" && parts[2]) {
    const rows = await readList(familyId, "system", "notifications");
    const next = rows.map((r) =>
      r.id === parts[2] ? { ...r, read: true, is_read: true, updated_at: new Date().toISOString() } : r,
    );
    await writeList(familyId, "system", "notifications", next);
    await after();
    return { handled: true, data: next.find((r) => r.id === parts[2]) || { ok: true } };
  }

  if (parts[0] === "notifications" && parts[1] === "read-all" && parts[2] === familyId) {
    const rows = await readList(familyId, "system", "notifications");
    let marked = 0;
    const next = rows.map((r) => {
      if (r.read || r.is_read) return r;
      marked += 1;
      return { ...r, read: true, is_read: true, updated_at: new Date().toISOString() };
    });
    await writeList(familyId, "system", "notifications", next);
    await after();
    return { handled: true, data: { marked_read: marked } };
  }

  // Family member role / relationship (Owner governance)
  if (parts[0] === "families" && parts[1] === familyId && parts[2] === "accounts" && parts[3] && !parts[4]) {
    const accountId = String(parts[3]);
    const rows = await readList(familyId, "finance", "wallets");
    const next = rows.map((r) =>
      String(r.id) === accountId
        ? {
            ...r,
            ...body,
            id: r.id,
            updated_at: new Date().toISOString(),
          }
        : r,
    );
    await writeList(familyId, "finance", "wallets", next);
    await after();
    return {
      handled: true,
      data: next.find((r) => String(r.id) === accountId) || { ok: true },
    };
  }

  // Family member role / relationship (Owner governance)
  if (parts[0] === "families" && parts[1] === familyId && parts[2] === "members" && parts[3]) {
    const memberId = String(parts[3] || "").trim();
    const action = String(parts[4] || "").trim().toLowerCase();
    const actorUid = String(
      currentUser?.uid || currentUser?.firebase_uid || currentUser?.id || "",
    ).trim();

    const matchesMember = (raw) => {
      const ids = [raw.member_id, raw.id, raw.uid, raw.user_id]
        .filter(Boolean)
        .map((v) => String(v));
      return ids.includes(memberId);
    };

    if (action === "role") {
      const nextRole = String(body?.role || "").trim().toUpperCase();
      if (!nextRole) {
        return { handled: true, data: { ok: false, detail: "role required" }, error: "role required" };
      }
      try {
        const { setFamilyMemberRole } = await import("../firebase/familyCloud");
        await setFamilyMemberRole({
          familyId,
          memberUid: memberId,
          role: nextRole,
          actorUid,
        });
      } catch (err) {
        const msg = String(err?.message || "Role update failed");
        if (/Only OWNER|permission|denied|required/i.test(msg)) {
          return { handled: true, data: { ok: false, detail: msg }, error: msg };
        }
        console.warn("[S4 MemberRole] Firestore update skipped", err);
      }
      let rows = await readList(familyId, "family", "members");
      let found = false;
      const next = rows.map((raw) => {
        if (!matchesMember(raw)) return raw;
        found = true;
        return {
          ...raw,
          role: nextRole,
          normalized_role: nextRole,
          member_role: nextRole,
          // Role change resets custom overrides so VIEWER/CHILD/MEMBER baselines apply cleanly
          overrides: [],
          permission_overrides: [],
          updated_at: new Date().toISOString(),
        };
      });
      if (!found) {
        next.push({
          id: memberId,
          member_id: memberId,
          user_id: memberId,
          uid: memberId,
          role: nextRole,
          normalized_role: nextRole,
          status: "ACTIVE",
          updated_at: new Date().toISOString(),
          source: "role_patch",
        });
      }
      await writeList(familyId, "family", "members", next);
      await appendAudit(familyId, { action: "MEMBER_ROLE", member_id: memberId, role: nextRole });
      await after();
      return { handled: true, data: { ok: true, member_id: memberId, role: nextRole } };
    }

    if (action === "relationship" || body?.relationship_type || body?.relationship) {
      const relation = String(
        body?.relationship_type || body?.relationship || body?.relationship_display_label || "",
      ).trim();
      if (!relation) {
        return {
          handled: true,
          data: { ok: false, detail: "relationship required" },
          error: "relationship required",
        };
      }
      try {
        const { setFamilyMemberRelationship } = await import("../firebase/familyCloud");
        await setFamilyMemberRelationship({
          familyId,
          memberUid: memberId,
          relationshipType: relation,
          actorUid,
        });
      } catch (err) {
        const msg = String(err?.message || "Relationship update failed");
        if (/Only OWNER|permission|denied|required/i.test(msg)) {
          return { handled: true, data: { ok: false, detail: msg }, error: msg };
        }
        console.warn("[S4 MemberRelation] Firestore update skipped", err);
      }
      let rows = await readList(familyId, "family", "members");
      let found = false;
      const next = rows.map((raw) => {
        if (!matchesMember(raw)) return raw;
        found = true;
        return {
          ...raw,
          relationship: relation,
          relationship_type: relation,
          relationship_display_label: relation,
          updated_at: new Date().toISOString(),
        };
      });
      if (!found) {
        next.push({
          id: memberId,
          member_id: memberId,
          user_id: memberId,
          uid: memberId,
          relationship: relation,
          relationship_type: relation,
          relationship_display_label: relation,
          role: "MEMBER",
          status: "ACTIVE",
          updated_at: new Date().toISOString(),
          source: "relationship_patch",
        });
      }
      await writeList(familyId, "family", "members", next);
      await appendAudit(familyId, {
        action: "MEMBER_RELATIONSHIP",
        member_id: memberId,
        relationship: relation,
      });
      await after();
      return {
        handled: true,
        data: {
          ok: true,
          member_id: memberId,
          relationship: relation,
          relationship_type: relation,
        },
      };
    }
  }

  // Member permission override (Owner assigns Allow/Deny)
  if (parts[0] === "permissions" && parts[1] === "members" && parts[2]) {
    const memberId = String(parts[2] || "").trim();
    const actorUid = String(
      currentUser?.uid || currentUser?.firebase_uid || currentUser?.id || "",
    ).trim();
    let rows = await readList(familyId, "family", "members");
    const actor = findCurrentMember(rows, currentUser);
    const ownerUid = await resolveFamilyOwnerUid(familyId, currentUser, rows);
    const actorRole = preferElevatedRole(
      normalizeMemberRole(actor || {}),
      actorUid && ownerUid && actorUid === ownerUid ? "OWNER" : "",
    );
    if (actorRole !== "OWNER" && actorRole !== "ADMIN") {
      return {
        handled: true,
        data: { ok: false, detail: "Only OWNER/ADMIN can change permissions" },
        error: "Only OWNER/ADMIN can change permissions",
      };
    }
    const key = String(body?.permission_key || "").trim();
    if (!key) {
      return { handled: true, data: { ok: false, detail: "permission_key required" }, error: "permission_key required" };
    }
    const allow = body?.allow !== false;
    const scope = body?.scope || "family";

    const matchesMember = (raw) => {
      const ids = [raw.member_id, raw.id, raw.uid, raw.user_id]
        .filter(Boolean)
        .map((v) => String(v));
      return ids.includes(memberId);
    };

    const applyOverride = (raw) => {
      const overrides = Array.isArray(raw.overrides)
        ? [...raw.overrides]
        : Array.isArray(raw.permission_overrides)
          ? [...raw.permission_overrides]
          : [];
      const idx = overrides.findIndex((o) => o.permission_key === key);
      const row = {
        id: overrides[idx]?.id || newId("pov"),
        permission_key: key,
        allow,
        scope,
        updated_at: new Date().toISOString(),
      };
      if (idx >= 0) overrides[idx] = row;
      else overrides.push(row);
      return {
        ...raw,
        member_id: raw.member_id || raw.id || memberId,
        overrides,
        permission_overrides: overrides,
        updated_at: new Date().toISOString(),
      };
    };

    let found = false;
    let next = rows.map((raw) => {
      if (!matchesMember(raw)) return raw;
      found = true;
      return applyOverride(raw);
    });

    if (!found) {
      next = [
        ...next,
        applyOverride({
          id: memberId,
          member_id: memberId,
          user_id: memberId,
          uid: memberId,
          full_name: body?.full_name || "Member",
          email: body?.email || "",
          role: body?.role || "MEMBER",
          relationship: body?.relationship || "",
          status: "ACTIVE",
          source: "permission_upsert",
        }),
      ];
    }

    await writeList(familyId, "family", "members", next);
    await appendAudit(familyId, {
      action: "PERMISSION_OVERRIDE",
      member_id: memberId,
      permission_key: key,
      allow,
    });

    const updated = next.find((r) => matchesMember(r));
    const mapped = mapFamilyMemberPermissions(updated || {});

    // Also write overrides onto Firestore member doc for multi-device truth
    try {
      const { updateFamilyMemberPermissionOverrides } = await import("../firebase/familyCloud");
      const firestoreUid = String(
        updated?.uid || updated?.user_id || updated?.member_id || memberId,
      );
      await updateFamilyMemberPermissionOverrides({
        familyId,
        memberUid: firestoreUid,
        overrides: mapped.overrides || [],
        actorUid,
      });
    } catch (err) {
      const msg = String(err?.message || "");
      if (/Only OWNER|permission|denied|Actor/i.test(msg)) {
        return { handled: true, data: { ok: false, detail: msg }, error: msg };
      }
      console.warn("[S4 Permissions] Firestore override skipped", err);
    }

    await after();
    return { handled: true, data: mapped };
  }

  return { handled: false };
}

export async function cloudApiDelete({ familyId, path, onAfterWrite, currentUser }) {
  if (!familyId) return { handled: false };
  const clean = stripQuery(path);
  const parts = clean.replace(/^\//, "").split("/").filter(Boolean);
  const after = typeof onAfterWrite === "function" ? onAfterWrite : async () => {};

  // Remove family member (Owner only when Firestore is available)
  if (parts[0] === "families" && parts[1] === familyId && parts[2] === "members" && parts[3]) {
    const memberId = String(parts[3] || "").trim();
    const actorUid = String(
      currentUser?.uid || currentUser?.firebase_uid || currentUser?.id || "",
    ).trim();
    if (!memberId) {
      return { handled: true, data: { ok: false, detail: "member id required" }, error: "member id required" };
    }
    if (actorUid && memberId === actorUid) {
      return {
        handled: true,
        data: { ok: false, detail: "Cannot remove yourself" },
        error: "Cannot remove yourself",
      };
    }
    try {
      const { removeFamilyCloudMember } = await import("../firebase/familyCloud");
      await removeFamilyCloudMember({ familyId, memberUid: memberId, actorUid });
    } catch (err) {
      const msg = String(err?.message || "Remove member failed");
      if (/Only OWNER|Cannot remove|permission|denied|required/i.test(msg)) {
        return { handled: true, data: { ok: false, detail: msg }, error: msg };
      }
      console.warn("[S4 RemoveMember] Firestore remove skipped", err);
    }
    const rows = await readList(familyId, "family", "members");
    const next = rows.filter((raw) => {
      const ids = [raw.member_id, raw.id, raw.uid, raw.user_id].filter(Boolean).map(String);
      return !ids.includes(memberId);
    });
    await writeList(familyId, "family", "members", next);
    await appendAudit(familyId, { action: "MEMBER_REMOVE", member_id: memberId });
    await after();
    return { handled: true, data: { ok: true, member_id: memberId } };
  }

  if (parts[0] === "tasks" && parts[1]) {
    const taskId = String(parts[1]);
    const rows = await readList(familyId, "planner", "tasks");
    await writeList(
      familyId,
      "planner",
      "tasks",
      rows.filter((r) => String(r.id) !== taskId),
    );
    await after();
    return { handled: true, data: { ok: true } };
  }
  if (parts[0] === "calendar" && parts[1]) {
    const eventId = String(parts[1]);
    const rows = await readList(familyId, "planner", "events");
    await writeList(
      familyId,
      "planner",
      "events",
      rows.filter((r) => String(r.id) !== eventId),
    );
    await after();
    return { handled: true, data: { ok: true } };
  }
  if (parts[0] === "grocery" && parts[1] === "items" && parts[2]) {
    const itemId = String(parts[2]);
    const rows = await readList(familyId, "grocery", "items");
    await writeList(
      familyId,
      "grocery",
      "items",
      rows.filter((r) => String(r.id) !== itemId),
    );
    await after();
    return { handled: true, data: { ok: true } };
  }

  if (parts[0] === "tags" && parts[1]) {
    const rows = await readList(familyId, "finance", "tags");
    await writeList(
      familyId,
      "finance",
      "tags",
      rows.filter((r) => String(r.id) !== String(parts[1])),
    );
    const links = await readList(familyId, "finance", "transactionTags");
    await writeList(
      familyId,
      "finance",
      "transactionTags",
      links.filter((r) => String(r.tag_id) !== String(parts[1])),
    );
    await after();
    return { handled: true, data: { ok: true } };
  }

  if (parts[0] === "transaction-tags" && parts[1]) {
    const links = await readList(familyId, "finance", "transactionTags");
    await writeList(
      familyId,
      "finance",
      "transactionTags",
      links.filter((r) => String(r.id) !== String(parts[1])),
    );
    await after();
    return { handled: true, data: { ok: true } };
  }

  if (parts[0] === "accounts" && parts[1]) {
    const rows = await readList(familyId, "finance", "wallets");
    const now = new Date().toISOString();
    const next = rows.map((r) =>
      String(r.id) === String(parts[1])
        ? { ...r, is_active: false, deleted_at: now, updated_at: now }
        : r,
    );
    await writeList(familyId, "finance", "wallets", next);
    await after();
    return { handled: true, data: { success: true, message: "Wallet deleted" } };
  }

  if (parts[0] === "notifications" && parts[1] && !parts[2]) {
    const rows = await readList(familyId, "system", "notifications");
    await writeList(
      familyId,
      "system",
      "notifications",
      rows.filter((r) => r.id !== parts[1]),
    );
    await after();
    return { handled: true, data: { ok: true } };
  }

  if (parts[0] === "notifications" && parts[1] === "devices" && parts[2]) {
    const rows = await readList(familyId, "system", "pushDevices");
    await writeList(
      familyId,
      "system",
      "pushDevices",
      rows.filter((r) => r.id !== parts[2]),
    );
    await after();
    return { handled: true, data: { ok: true } };
  }

  return { handled: false };
}

/** Seed empty module stores for a new cloud family (does not wipe existing data). */
export async function seedCloudModuleCaches(
  familyId,
  { ownerName, ownerEmail, ownerRelation = "Owner", ownerUid = "", seedAsOwner = false } = {},
) {
  async function ensureList(module, name, fallback) {
    const existing = await loadOfflineSnapshot(familyId, module, name).catch(() => null);
    if (existing?.data !== undefined) return;
    await writeList(familyId, module, name, fallback);
  }
  async function ensureDoc(module, name, fallback) {
    const existing = await loadOfflineSnapshot(familyId, module, name).catch(() => null);
    if (existing?.data !== undefined) return;
    await writeDoc(familyId, module, name, fallback);
  }

  const membersExisting = await loadOfflineSnapshot(familyId, "family", "members").catch(() => null);
  const membersData = membersExisting?.data;
  const membersEmpty = !Array.isArray(membersData) || membersData.length === 0;
  if (membersEmpty) {
    const uid = String(ownerUid || "").trim();
    // Only invent an OWNER row on explicit family create — joiners must not self-seed OWNER
    if (uid && seedAsOwner) {
      const owner = {
        id: uid,
        member_id: uid,
        user_id: uid,
        uid,
        full_name: ownerName || "Owner",
        email: ownerEmail || "",
        role: "OWNER",
        normalized_role: "OWNER",
        relationship: ownerRelation || "Owner",
        relationship_type: ownerRelation || "Owner",
        relationship_display_label: ownerRelation || "Owner",
        status: "ACTIVE",
        overrides: [],
        joined_at: new Date().toISOString(),
        source: "cloud_local",
      };
      await writeList(familyId, "family", "members", [owner]);
    }
  } else if (ownerUid && seedAsOwner) {
    // Heal legacy mem_owner seed → real Firebase uid (create path only)
    const rows = Array.isArray(membersData) ? membersData : [];
    const uid = String(ownerUid).trim();
    const hasUid = rows.some((r) =>
      [r.uid, r.user_id, r.member_id, r.id].filter(Boolean).map(String).includes(uid),
    );
    if (!hasUid && rows.length) {
      const next = rows.map((r) => {
        const role = String(r.role || r.normalized_role || "").toUpperCase();
        const id = String(r.id || r.member_id || "");
        if (role !== "OWNER" && id !== "mem_owner") return r;
        return {
          ...r,
          id: uid,
          member_id: uid,
          user_id: uid,
          uid,
          email: r.email || ownerEmail || "",
          full_name: r.full_name || ownerName || "Owner",
          updated_at: new Date().toISOString(),
        };
      });
      await writeList(familyId, "family", "members", next);
    }
  }

  await ensureList("family", "invites", []);
  await ensureList("family", "joinRequests", []);
  await ensureList("family", "ownershipTransfers", []);
  await ensureList("finance", "wallets", []);
  await ensureList("finance", "transactions", []);
  await ensureList("finance", "categories", [
    { id: "cat_exp_food", name: "Food & Grocery", name_en: "Food & Grocery", category_type: "EXPENSE" },
    { id: "cat_exp_bills", name: "Bills", name_en: "Bills", category_type: "EXPENSE" },
    { id: "cat_exp_transport", name: "Transport", name_en: "Transport", category_type: "EXPENSE" },
    { id: "cat_exp_other", name: "Other expense", name_en: "Other expense", category_type: "EXPENSE" },
    { id: "cat_inc_salary", name: "Salary / Income", name_en: "Salary / Income", category_type: "INCOME" },
    { id: "cat_inc_other", name: "Other income", name_en: "Other income", category_type: "INCOME" },
  ]);
  await ensureList("planner", "tasks", []);
  await ensureList("planner", "events", []);
  await ensureList("grocery", "lists", []);
  await ensureList("grocery", "items", []);
  await ensureList("grocery", "vendors", []);
  await ensureList("grocery", "priceHistory", []);
  await ensureList("grocery", "vendorSummary", []);
  await ensureList("grocery", "activity", []);
  await ensureDoc("life", "phase15", { items: [], summary: { total: 0 } });
  await ensureDoc("life", "phase16", { items: [], summary: { total: 0 } });
  await ensureList("zakat", "main", []);
  await ensureDoc("zakat", "metalRates", {
    GOLD: 12000,
    SILVER: 150,
    updated_at: new Date().toISOString(),
    source: "cloud_local",
  });
  await ensureList("finance", "budgets", []);
  {
    const bud = await loadOfflineSnapshot(familyId, "finance", "budgets").catch(() => null);
    if (bud?.data && !Array.isArray(bud.data)) {
      const nested = bud.data?.data;
      await writeList(familyId, "finance", "budgets", Array.isArray(nested) ? nested : []);
    }
  }
  await ensureList("finance", "savings", []);
  await ensureList("finance", "loans", []);
  await ensureList("finance", "goals", []);
  await ensureDoc("finance", "goalSummary", {
    total_goals: 0,
    active_count: 0,
    active_target_amount: 0,
    active_current_amount: 0,
    source: "cloud_local",
  });
  await ensureList("finance", "recurring", []);
  await ensureList("finance", "tags", []);
  await ensureList("finance", "transactionTags", []);
  await ensureDoc("system", "currency", {
    code: "BDT",
    symbol: "৳",
    currencies: [
      { code: "BDT", name: "Bangladeshi Taka", symbol: "৳", is_base: true },
      { code: "USD", name: "US Dollar", symbol: "$", is_base: false },
      { code: "INR", name: "Indian Rupee", symbol: "₹", is_base: false },
      { code: "SAR", name: "Saudi Riyal", symbol: "﷼", is_base: false },
    ],
    exchangeRates: [
      { from_currency: "USD", to_currency: "BDT", rate: 110, updated_at: new Date().toISOString() },
      { from_currency: "INR", to_currency: "BDT", rate: 1.32, updated_at: new Date().toISOString() },
      { from_currency: "SAR", to_currency: "BDT", rate: 29.3, updated_at: new Date().toISOString() },
    ],
    currencySummary: { base_currency: "BDT", source: "cloud_local" },
  });
  await ensureList("system", "notifications", []);
  await ensureList("system", "pushDevices", []);
  const auditExisting = await loadOfflineSnapshot(familyId, "system", "audit").catch(() => null);
  if (!auditExisting?.data) {
    await writeList(familyId, "system", "audit", [
      {
        id: newId("aud"),
        at: new Date().toISOString(),
        action: "family.created",
        title: "Cloud family ready",
      },
    ]);
  }
}
