/** Offline read-cache for life / zakat / reports (IndexedDB). */

const DB_NAME = "s4-offline-cache";
const DB_VERSION = 1;
const STORE = "snapshots";

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB not available"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("tx failed"));
    tx.onabort = () => reject(tx.error || new Error("tx aborted"));
  });
}

export function cacheKey(familyId, module, name = "default") {
  return `${familyId}::${module}::${name}`;
}

export async function saveOfflineSnapshot(familyId, module, name, data) {
  const db = await openDb();
  const key = cacheKey(familyId, module, name);
  const row = {
    key,
    familyId: String(familyId),
    module: String(module),
    name: String(name || "default"),
    data,
    updated_at: new Date().toISOString(),
  };
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).put(row);
  await txDone(tx);
  db.close();
  return row;
}

export async function loadOfflineSnapshot(familyId, module, name = "default") {
  const db = await openDb();
  const key = cacheKey(familyId, module, name);
  const tx = db.transaction(STORE, "readonly");
  const row = await new Promise((resolve, reject) => {
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
  await txDone(tx);
  db.close();
  return row;
}

/** Export cached snapshot rows (optionally one family only). */
export async function exportAllOfflineSnapshots(familyId = null) {
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  const rows = await new Promise((resolve, reject) => {
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
  await txDone(tx);
  db.close();
  if (!familyId) return rows;
  const want = String(familyId);
  return rows.filter((row) => String(row?.familyId || "") === want);
}

/** True when IndexedDB has at least one offline snapshot (optionally for one family). */
export async function hasLocalOfflineData(familyId = null) {
  try {
    const rows = await exportAllOfflineSnapshots(familyId);
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
}

const MERGEABLE_LIST_MODULES = new Set([
  "finance",
  "family",
  "grocery",
  "planner",
  "system",
  "zakat",
]);

/** Doc bags keyed by module/name whose `.items` arrays should merge by id (not blind replace). */
const MERGEABLE_ITEM_DOC_MODULES = new Set(["life"]);

function mergeRowsById(localList, incomingList) {
  const map = new Map();
  for (const row of localList || []) {
    if (row?.id == null && row?.member_id == null && row?.uid == null) continue;
    const id = String(row.id || row.member_id || row.uid);
    map.set(id, row);
  }
  for (const row of incomingList || []) {
    if (row?.id == null && row?.member_id == null && row?.uid == null) continue;
    const id = String(row.id || row.member_id || row.uid);
    const prev = map.get(id);
    if (!prev) {
      map.set(id, row);
      continue;
    }
    // Soft-delete always wins over an active peer (never resurrect deleted wallets)
    const prevDeleted = Boolean(prev.deleted_at) || prev.is_active === false;
    const nextDeleted = Boolean(row.deleted_at) || row.is_active === false;
    if (prevDeleted && !nextDeleted) {
      map.set(id, prev);
      continue;
    }
    if (nextDeleted && !prevDeleted) {
      map.set(id, { ...prev, ...row });
      continue;
    }
    if (prevDeleted && nextDeleted) {
      const prevAt = Date.parse(prev.updated_at || prev.deleted_at || prev.created_at || 0) || 0;
      const nextAt = Date.parse(row.updated_at || row.deleted_at || row.created_at || 0) || 0;
      map.set(id, nextAt >= prevAt ? { ...prev, ...row } : { ...row, ...prev });
      continue;
    }
    const prevAt = Date.parse(prev.updated_at || prev.created_at || 0) || 0;
    const nextAt = Date.parse(row.updated_at || row.created_at || 0) || 0;
    // Prefer newer row; if equal timestamps, prefer incoming (cloud truth)
    map.set(id, nextAt >= prevAt ? { ...prev, ...row } : { ...row, ...prev });
  }
  return Array.from(map.values());
}

function recomputeLifeDocSummary(items) {
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
        ? Number(item.value ?? item.secondary_amount ?? item.amount ?? 0) || 0
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

function mergeLifeDoc(localData, incomingData) {
  const local = localData && typeof localData === "object" && !Array.isArray(localData) ? localData : {};
  const incoming =
    incomingData && typeof incomingData === "object" && !Array.isArray(incomingData) ? incomingData : {};
  const localItems = Array.isArray(local.items) ? local.items : [];
  const incomingItems = Array.isArray(incoming.items) ? incoming.items : [];
  // Never let an empty remote seed wipe a non-empty local bag when merge map missed local.
  const items =
    localItems.length && incomingItems.length === 0
      ? localItems
      : mergeRowsById(localItems, incomingItems);
  return {
    ...incoming,
    ...local,
    items,
    summary: recomputeLifeDocSummary(items),
  };
}

/** Restore rows produced by exportAllOfflineSnapshots (merge list snapshots by id). */
export async function importOfflineSnapshots(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return 0;

  // Read existing rows first (separate tx) — never await inside an open IDB write tx
  const dbRead = await openDb();
  const existingByKey = new Map();
  await new Promise((resolve, reject) => {
    const tx = dbRead.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    let pending = 0;
    let settled = false;
    const done = () => {
      if (settled) return;
      if (pending === 0) {
        settled = true;
        resolve();
      }
    };
    for (const row of list) {
      if (!row?.key) continue;
      const module = String(row.module || "");
      const isListMerge = MERGEABLE_LIST_MODULES.has(module) && Array.isArray(row.data);
      const isLifeMerge =
        MERGEABLE_ITEM_DOC_MODULES.has(module) &&
        row.data &&
        typeof row.data === "object" &&
        !Array.isArray(row.data);
      if (!isListMerge && !isLifeMerge) continue;
      pending += 1;
      const req = store.get(row.key);
      req.onsuccess = () => {
        if (req.result) existingByKey.set(row.key, req.result);
        pending -= 1;
        done();
      };
      req.onerror = () => {
        pending -= 1;
        done();
      };
    }
    tx.oncomplete = () => done();
    tx.onerror = () => reject(tx.error || new Error("read failed"));
    if (pending === 0) done();
  }).catch(() => {});
  dbRead.close();

  // Defensive: ensure life docs are loaded for merge even if the bulk read skipped them
  for (const row of list) {
    if (!row?.key || existingByKey.has(row.key)) continue;
    const module = String(row.module || "");
    if (!MERGEABLE_ITEM_DOC_MODULES.has(module)) continue;
    if (!row.data || typeof row.data !== "object" || Array.isArray(row.data)) continue;
    try {
      const existing = await loadOfflineSnapshot(row.familyId, row.module, row.name);
      if (existing) existingByKey.set(row.key, existing);
    } catch {
      /* ignore */
    }
  }

  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  for (const row of list) {
    if (!row || !row.key) continue;
    const module = String(row.module || "");
    const incoming = row.data;
    if (MERGEABLE_LIST_MODULES.has(module) && Array.isArray(incoming)) {
      const existing = existingByKey.get(row.key);
      const localData = existing?.data;
      const merged = Array.isArray(localData)
        ? mergeRowsById(localData, incoming)
        : incoming;
      store.put({
        ...row,
        data: merged,
        updated_at: new Date().toISOString(),
      });
    } else if (
      MERGEABLE_ITEM_DOC_MODULES.has(module) &&
      incoming &&
      typeof incoming === "object" &&
      !Array.isArray(incoming)
    ) {
      const existing = existingByKey.get(row.key);
      const merged = mergeLifeDoc(existing?.data, incoming);
      store.put({
        ...row,
        data: merged,
        updated_at: new Date().toISOString(),
      });
    } else {
      store.put(row);
    }
  }
  await txDone(tx);
  db.close();

  // After merge: recompute wallet balances from full transaction ledger (anti-drift)
  const familyIds = new Set();
  for (const row of list) {
    if (row?.familyId) familyIds.add(String(row.familyId));
  }
  for (const fid of familyIds) {
    await reconcileWalletBalancesForFamily(fid).catch(() => {});
    await reconcileSavingsFromLedgerForFamily(fid).catch(() => {});
  }

  return list.length;
}

/** Recompute finance/wallets from finance/transactions ledger for one family. */
export async function reconcileWalletBalancesForFamily(familyId) {
  if (!familyId) return 0;
  const { recomputeWalletBalancesFromLedger } = await import("./cloudLocalFinance");
  const walRow = await loadOfflineSnapshot(familyId, "finance", "wallets").catch(() => null);
  const txRow = await loadOfflineSnapshot(familyId, "finance", "transactions").catch(() => null);
  const wallets = Array.isArray(walRow?.data) ? walRow.data : [];
  const transactions = Array.isArray(txRow?.data) ? txRow.data : [];
  if (!wallets.length) return 0;
  const next = recomputeWalletBalancesFromLedger(wallets, transactions);
  await saveOfflineSnapshot(familyId, "finance", "wallets", next);
  return next.length;
}

/** Recompute finance/savings current/progress from SAVINGS_* ledger txs. */
export async function reconcileSavingsFromLedgerForFamily(familyId) {
  if (!familyId) return 0;
  const {
    normalizeSavingsList,
    recomputeSavingsFromLedger,
  } = await import("./cloudLocalFinance");
  const savRow = await loadOfflineSnapshot(familyId, "finance", "savings").catch(() => null);
  const txRow = await loadOfflineSnapshot(familyId, "finance", "transactions").catch(() => null);
  const list = normalizeSavingsList(savRow?.data);
  const transactions = Array.isArray(txRow?.data) ? txRow.data : [];
  if (!list.length && !Array.isArray(savRow?.data)) return 0;
  const next = recomputeSavingsFromLedger(list, transactions);
  await saveOfflineSnapshot(familyId, "finance", "savings", next);
  return next.length;
}
