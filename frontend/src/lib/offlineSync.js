import {
  countPendingOutbox,
  enqueueOutboxChange,
  isBrowserOnline,
  listPendingOutbox,
  markOutboxSynced,
} from "./offlineDb";

export { enqueueOutboxChange, countPendingOutbox, isBrowserOnline, listPendingOutbox };

/**
 * Flush local IndexedDB outbox via Phase 10B POST /sync/push.
 * apiPost(path, body) should return parsed JSON and throw on HTTP error.
 */
export async function flushLocalOutbox({
  familyId,
  deviceId = "web-dashboard",
  apiPost,
  deviceName = "Web Dashboard",
  platform = "web",
}) {
  if (!familyId || typeof apiPost !== "function") {
    return { pushed: 0, applied: null, skipped: true };
  }
  if (!isBrowserOnline()) {
    return { pushed: 0, applied: null, offline: true };
  }

  const pending = await listPendingOutbox(familyId);
  if (!pending.length) {
    return { pushed: 0, applied: null, empty: true };
  }

  const changes = pending.map((row) => ({
    client_change_id: row.client_change_id || row.id,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    operation: row.operation,
    payload: row.payload,
  }));

  const result = await apiPost(`/families/${familyId}/sync/push`, {
    device_id: deviceId,
    device_name: deviceName,
    platform,
    app_version: "web-dashboard",
    changes,
  });

  const syncedIds = pending.map((row) => row.id);
  // Mark local rows synced when server accepted (apply may conflict — still left local)
  const conflictCount = Number(result?.conflict_count || 0);
  const failedCount = Number(result?.applied?.failed_count || 0);
  if (conflictCount === 0 && failedCount === 0) {
    await markOutboxSynced(syncedIds);
  } else {
    // Keep only successfully synced client_change_ids if server reports per-id; else mark all synced that aren't in failed
    const failedOutbox = new Set(
      (result?.applied?.failed || []).map((f) => f.outbox_id)
    );
    const accepted = result?.accepted_outbox_ids || [];
    // Local ids differ from server outbox ids — mark all local pending as synced if accepted_count matches
    if (Number(result?.accepted_count) === pending.length && failedCount === 0) {
      // Conflicts still mean server recorded them; drop local pending to avoid loops
      await markOutboxSynced(syncedIds);
    } else if (accepted.length) {
      await markOutboxSynced(syncedIds);
    } else if (!failedOutbox.size) {
      await markOutboxSynced(syncedIds);
    }
  }

  return {
    pushed: pending.length,
    applied: result?.applied || null,
    conflict_count: conflictCount,
    result,
  };
}

/** Merge pull snapshot lightly into grocery + finance React state setters. */
export function mergePullIntoGroceryState(changes, setters) {
  if (!changes || typeof changes !== "object") return;
  const {
    setGroceryLists,
    setGroceryVendors,
    setGroceryItems,
    setWallets,
    setAccounts,
    setBudgets,
    setSavings,
    setLoans,
    setTransactions,
    setGoals,
    setRecurringItems,
  } = setters || {};

  if (typeof setGroceryLists === "function" && Array.isArray(changes.grocery_lists)) {
    setGroceryLists((prev) => mergeById(prev, changes.grocery_lists));
  }
  if (typeof setGroceryVendors === "function" && Array.isArray(changes.grocery_vendors)) {
    setGroceryVendors((prev) => mergeById(prev, changes.grocery_vendors));
  }
  if (typeof setGroceryItems === "function" && Array.isArray(changes.grocery_items)) {
    setGroceryItems((prev) => mergeById(prev, changes.grocery_items));
  }
  const walletSetter = typeof setWallets === "function" ? setWallets : setAccounts;
  if (typeof walletSetter === "function" && Array.isArray(changes.accounts)) {
    walletSetter((prev) => mergeById(prev, changes.accounts));
  }
  if (typeof setBudgets === "function" && Array.isArray(changes.budgets)) {
    setBudgets((prev) => mergeById(prev, changes.budgets));
  }
  if (typeof setSavings === "function" && Array.isArray(changes.savings_goals || changes.savings)) {
    setSavings((prev) => mergeById(prev, changes.savings_goals || changes.savings));
  }
  if (typeof setLoans === "function" && Array.isArray(changes.loans)) {
    setLoans((prev) => mergeById(prev, changes.loans));
  }
  if (typeof setTransactions === "function" && Array.isArray(changes.transactions)) {
    setTransactions((prev) => mergeById(prev, changes.transactions));
  }
  if (typeof setGoals === "function" && Array.isArray(changes.financial_goals || changes.goals)) {
    setGoals((prev) => mergeById(prev, changes.financial_goals || changes.goals));
  }
  if (typeof setRecurringItems === "function" && Array.isArray(changes.recurring_transactions)) {
    setRecurringItems((prev) => mergeById(prev, changes.recurring_transactions));
  }
}

function mergeById(prev, incoming) {
  const map = new Map();
  for (const row of prev || []) {
    if (row?.id) map.set(String(row.id), row);
  }
  for (const row of incoming || []) {
    if (!row?.id) continue;
    const id = String(row.id);
    map.set(id, { ...(map.get(id) || {}), ...row });
  }
  return Array.from(map.values());
}

export async function enqueueGroceryChange(familyId, { entity_type, entity_id, operation, payload }) {
  return enqueueOutboxChange({
    familyId,
    entity_type,
    entity_id,
    operation: operation || "UPDATE",
    payload: payload || {},
  });
}
