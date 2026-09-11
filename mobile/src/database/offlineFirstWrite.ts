/**
 * Offline-First write path:
 * 1) save local_* SQLite mirror
 * 2) enqueue sync_queue
 * 3) optionally flush via syncManager when online
 * 4) caller updates UI immediately
 */

import { MOBILE_SYNC_DEVICE_ID } from "../lib/phase10bSync";
import { queueManager } from "../sync/queueManager";
import { isLocalEntity, upsertLocal, type LocalEntity } from "./localRepository";

const ENTITY_TO_LOCAL: Record<string, LocalEntity | null> = {
  transactions: "transactions",
  accounts: "accounts",
  grocery: "grocery_lists",
  grocery_lists: "grocery_lists",
  grocery_items: "grocery_items",
  grocery_vendors: "grocery_vendors",
  loans: "loans",
  budgets: "budgets",
  notifications: "notifications",
  categories: "categories",
  family_members: "family_members",
  investments: "investments",
  health_expenses: "health_expenses",
  vehicle_expenses: "vehicle_expenses",
  education_funds: "education_funds",
  properties: "properties",
  subscriptions: "subscriptions",
  documents: "documents",
  tags: "tags",
  transaction_tags: "transaction_tags",
  loan_payments: "loan_payments",
  savings_goals: "savings_goals",
  financial_goals: "financial_goals",
  recurring_transactions: "recurring_transactions",
  zakat_records: "zakat_records",
  finance_intent: null,
  phase15_items: null,
  phase16_items: null,
};

export async function saveOfflineFirst(params: {
  familyId: string;
  entityType: string;
  action: string;
  payload: Record<string, unknown>;
  entityId?: string | null;
}): Promise<{ localId: string; queued: true }> {
  const entityType = String(params.entityType || "").trim();
  const mapped = ENTITY_TO_LOCAL[entityType];
  const localKind: LocalEntity | null =
    mapped ?? (isLocalEntity(entityType) ? (entityType as LocalEntity) : null);
  const payload = {
    ...params.payload,
    family_id: params.familyId,
    device_id: MOBILE_SYNC_DEVICE_ID,
  };

  let localId = String(params.entityId || payload.id || payload.entity_id || "");
  if (localKind) {
    const saved = await upsertLocal(localKind, params.familyId, payload, {
      id: localId || undefined,
      syncStatus: "pending",
    });
    localId = saved.id;
  } else if (!localId) {
    localId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `q-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  await queueManager.enqueue({
    entityType,
    entityId: localId,
    action: String(params.action || "CREATE").toUpperCase(),
    payload: { ...payload, id: localId, entity_id: localId },
  });

  return { localId, queued: true };
}

/** Always queue locally; when online, try immediate replay flush. */
export async function saveOfflineFirstAndFlush(params: {
  familyId: string;
  entityType: string;
  action: string;
  payload: Record<string, unknown>;
  entityId?: string | null;
  token?: string | null;
  online?: boolean;
}): Promise<{ localId: string; queued: true; flushed: boolean }> {
  const saved = await saveOfflineFirst(params);
  let flushed = false;
  if (params.online && params.token) {
    try {
      const { syncManager } = await import("../sync/syncManager");
      await syncManager.replayPending(params.token, params.familyId, 20);
      flushed = true;
    } catch {
      flushed = false;
    }
  }
  return { ...saved, flushed };
}
