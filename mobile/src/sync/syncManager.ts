/**
 * Sync manager — primary offline replay engine (used by app index).
 */

import { getApiBaseUrl } from "../services/api";
import {
  mapDomainOutboxRow,
  mapFinanceIntentToChange,
  mapGroceryRowToChanges,
  MOBILE_SYNC_DEVICE_ID,
  pullPhase10b,
  pushPhase10bChanges,
  type Phase10bChange,
} from "../lib/phase10bSync";
import { applyServerRowToLocal, isLocalEntity, mapSyncEntityToLocal, markLocalSynced } from "../database/localRepository";
import { conflictResolver } from "./conflictResolver";
import { queueManager, type SyncQueueRow } from "./queueManager";
import { openMobileDatabase } from "../lib/mobileDb";

let replayInFlight: Promise<{ synced: number; conflicts: number; failed: number; processed: number }> | null = null;

function tunnelHeaders(apiBase: string): Record<string, string> {
  return apiBase.includes("loca.lt") ? { "bypass-tunnel-reminder": "true" } : {};
}

function backoffMs(retryCount: number) {
  return Math.min(2000 * Math.pow(2, Math.max(0, retryCount)), 60_000);
}

function nextRetryAt(retryCount: number) {
  return new Date(Date.now() + backoffMs(retryCount)).toISOString();
}

function mapRow(row: SyncQueueRow & { entity_type?: string }) {
  const entityType = String(row.entity_type || "").trim();
  if (
    entityType === "grocery" ||
    row.action.includes("ITEM") ||
    row.action === "CREATE_DRAFT" ||
    row.action === "MARK_ITEM_BOUGHT"
  ) {
    return mapGroceryRowToChanges(row);
  }
  if (entityType === "finance_intent") {
    return [mapFinanceIntentToChange(row)];
  }
  return mapDomainOutboxRow(row);
}

async function applyPullChanges(familyId: string, changes: Record<string, unknown> | undefined | null) {
  if (!changes || typeof changes !== "object") return 0;
  let applied = 0;
  for (const [entityType, rows] of Object.entries(changes)) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      try {
        await applyServerRowToLocal(entityType, familyId, row as Record<string, unknown>);
        applied += 1;
      } catch {
        /* keep pull resilient */
      }
    }
  }
  return applied;
}

async function markLocalAfterPush(row: SyncQueueRow & { entity_type?: string }, result: any) {
  const entityType = String(row.entity_type || "").trim();
  const local = mapSyncEntityToLocal(entityType === "grocery" ? "grocery_lists" : entityType);
  if (!local) return;
  const applied = result?.applied || {};
  const serverId =
    applied?.entity_id ||
    (Array.isArray(applied?.synced) && applied.synced[0]) ||
    row.entity_id;
  try {
    await markLocalSynced(local, String(row.entity_id), serverId ? String(serverId) : undefined);
  } catch {
    /* ignore */
  }
}

async function reclaimStaleSyncing() {
  const db = await openMobileDatabase();
  const cutoff = new Date(Date.now() - 5 * 60_000).toISOString();
  try {
    await db.runAsync(
      `UPDATE sync_queue SET status = 'pending', updated_at = ? WHERE status = 'syncing' AND (updated_at IS NULL OR updated_at < ?)`,
      [new Date().toISOString(), cutoff]
    );
  } catch {
    /* ignore */
  }
}

async function followUpGroceryDraftItem(
  token: string,
  familyId: string,
  row: SyncQueueRow,
  payload: Record<string, any>
) {
  if (row.action !== "CREATE_DRAFT" || !String(payload.item_name || "").trim()) return;
  const apiBase = getApiBaseUrl();
  const headers = tunnelHeaders(apiBase);
  const pull = await pullPhase10b(apiBase, token, familyId, headers, MOBILE_SYNC_DEVICE_ID);
  await applyPullChanges(familyId, pull.changes as any);
  const mobileSyncId = payload.mobile_sync_id || row.entity_id;
  const remoteList = (pull.changes?.grocery_lists || []).find((l) => l.mobile_sync_key === mobileSyncId);
  if (!remoteList?.id) return;
  const itemChanges: Phase10bChange[] = [
    {
      client_change_id: `mobile-q-${row.queue_uuid || row.id}-item`,
      entity_type: "grocery_items",
      operation: "CREATE",
      payload: {
        grocery_list_id: remoteList.id,
        name: payload.item_name,
        quantity: "1",
        unit: "pcs",
        estimated_price: payload.estimated_price || "0",
        actual_price: "0",
        mobile_sync_key: `${mobileSyncId}:item`,
        last_client_updated_at: payload.created_at,
      },
    },
  ];
  const itemPush = await pushPhase10bChanges(apiBase, token, familyId, itemChanges, headers, MOBILE_SYNC_DEVICE_ID);
  if (conflictResolver.hasConflict(itemPush)) throw new Error("SYNC_CONFLICT");
  const itemFail = conflictResolver.failedMessage(itemPush);
  if (itemFail) throw new Error(itemFail);
}

export const syncManager = {
  deviceId: MOBILE_SYNC_DEVICE_ID,

  async pull(token: string, familyId: string, sinceToken?: string | null) {
    const apiBase = getApiBaseUrl();
    const result = await pullPhase10b(
      apiBase,
      token,
      familyId,
      tunnelHeaders(apiBase),
      MOBILE_SYNC_DEVICE_ID,
      sinceToken
    );
    const applied = await applyPullChanges(familyId, (result as any)?.changes);
    return { ...result, local_applied: applied };
  },

  async pushChanges(token: string, familyId: string, changes: Phase10bChange[]) {
    const apiBase = getApiBaseUrl();
    return pushPhase10bChanges(apiBase, token, familyId, changes, tunnelHeaders(apiBase), MOBILE_SYNC_DEVICE_ID);
  },

  async listDuePending(limit = 20): Promise<(SyncQueueRow & { entity_type?: string })[]> {
    const db = await openMobileDatabase();
    const now = new Date().toISOString();
    return db.getAllAsync<SyncQueueRow & { entity_type?: string }>(
      `SELECT id, queue_uuid, device_id, entity_type, entity_id, action, payload, retry_count, last_error, created_at, updated_at, synced_at, next_retry_at
       FROM sync_queue
       WHERE status = ?
         AND entity_type IN (
           'grocery','grocery_lists','grocery_items','grocery_vendors','finance_intent',
           'phase15_items','phase16_items','zakat_records','budgets','savings_goals',
           'loans','accounts','transactions','financial_goals','recurring_transactions',
           'investments','health_expenses','vehicle_expenses','education_funds',
           'properties','subscriptions','documents','tags','transaction_tags','loan_payments',
           'categories','notifications','family_members'
         )
         AND (next_retry_at IS NULL OR next_retry_at <= ?)
       ORDER BY created_at ASC
       LIMIT ?`,
      ["pending", now, limit]
    );
  },

  async replayPending(token: string, familyId: string, limit = 20) {
    if (replayInFlight) return replayInFlight;

    replayInFlight = (async () => {
      await reclaimStaleSyncing();
      const rows = await syncManager.listDuePending(limit);
      let synced = 0;
      let conflicts = 0;
      let failed = 0;

      for (const row of rows) {
        await queueManager.markSyncing(row.id);
        try {
          const payload = conflictResolver.parsePayload(row.payload);
          const fid = String(payload.family_id || familyId || "");
          if (!fid) throw new Error("family_id missing in offline payload");

          await syncManager.pull(token, fid);
          const changes = mapRow(row).map((c) => ({
            ...c,
            client_change_id: c.client_change_id || `mobile-q-${row.queue_uuid || row.id}`,
          }));
          const result = await syncManager.pushChanges(token, fid, changes);
          if (conflictResolver.hasConflict(result)) {
            await queueManager.markConflict(row.id, "SYNC_CONFLICT");
            conflicts += 1;
            continue;
          }
          const failMsg = conflictResolver.failedMessage(result);
          if (failMsg) throw new Error(failMsg);

          await followUpGroceryDraftItem(token, fid, row, payload);
          await markLocalAfterPush(row, result);
          await queueManager.markSynced(row.id);
          synced += 1;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (message.includes("SYNC_CONFLICT") || message.toLowerCase().includes("conflict")) {
            await queueManager.markConflict(row.id, message);
            conflicts += 1;
          } else {
            const next = (row.retry_count || 0) + 1;
            await queueManager.markFailed(row.id, next, message, nextRetryAt(next));
            failed += 1;
          }
        }
      }

      return { synced, conflicts, failed, processed: rows.length };
    })();

    try {
      return await replayInFlight;
    } finally {
      replayInFlight = null;
    }
  },

  async status() {
    return {
      pending: await queueManager.countPending(),
      conflicts: await queueManager.countConflicts(),
      failed: await queueManager.countFailed(),
      groceryPending: await queueManager.countPendingGrocery(),
      financePending: await queueManager.countPendingFinance(),
    };
  },
};

export { isLocalEntity };
