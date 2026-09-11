/** Typed sync_queue / meta queries (architecture Offline-First). */

import { openMobileDatabase } from "../lib/mobileDb";
import { MOBILE_SYNC_DEVICE_ID } from "../lib/phase10bSync";
import type { SyncQueueRow, SyncQueueStatus } from "./schema";

type DbLike = Awaited<ReturnType<typeof openMobileDatabase>>;

async function db(): Promise<DbLike> {
  return openMobileDatabase();
}

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `q-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Treat legacy `synced` as done for counts/lists. */
export function normalizeStatus(status: string): string {
  return status === "synced" ? "done" : status;
}

export async function countByStatus(status: SyncQueueStatus): Promise<number> {
  const statuses = status === "done" || status === "synced" ? ["done", "synced"] : [status];
  const placeholders = statuses.map(() => "?").join(",");
  const row = await (await db()).getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM sync_queue WHERE status IN (${placeholders})`,
    statuses
  );
  return row?.count ?? 0;
}

export async function countPendingByEntity(entityType: string): Promise<number> {
  const row = await (await db()).getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) AS count FROM sync_queue WHERE status = ? AND entity_type = ?",
    ["pending", entityType]
  );
  return row?.count ?? 0;
}

export async function countPendingGrocery(): Promise<number> {
  const row = await (await db()).getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM sync_queue
     WHERE status = ?
       AND entity_type IN ('grocery','grocery_lists','grocery_items','grocery_vendors')`,
    ["pending"]
  );
  return row?.count ?? 0;
}


export async function listQueue(
  status: SyncQueueStatus,
  limit = 20,
  entityType?: string
): Promise<SyncQueueRow[]> {
  const statuses = status === "done" || status === "synced" ? ["done", "synced"] : [status];
  const ph = statuses.map(() => "?").join(",");
  if (entityType) {
    return (await db()).getAllAsync<SyncQueueRow>(
      `SELECT id, queue_uuid, device_id, entity_type, entity_id, action, payload, retry_count, last_error, created_at, updated_at, synced_at, next_retry_at, status
       FROM sync_queue WHERE status IN (${ph}) AND entity_type = ? ORDER BY created_at ASC LIMIT ?`,
      [...statuses, entityType, limit]
    );
  }
  return (await db()).getAllAsync<SyncQueueRow>(
    `SELECT id, queue_uuid, device_id, entity_type, entity_id, action, payload, retry_count, last_error, created_at, updated_at, synced_at, next_retry_at, status
     FROM sync_queue WHERE status IN (${ph}) ORDER BY updated_at DESC LIMIT ?`,
    [...statuses, limit]
  );
}

export async function enqueue(params: {
  entityType: string;
  entityId: string;
  action: string;
  payload: object | string;
  deviceId?: string;
}): Promise<{ id: number; queue_uuid: string }> {
  const now = new Date().toISOString();
  const payload = typeof params.payload === "string" ? params.payload : JSON.stringify(params.payload);
  const queueUuid = uuid();
  const deviceId = params.deviceId || MOBILE_SYNC_DEVICE_ID;
  const result = await (await db()).runAsync(
    `INSERT INTO sync_queue (queue_uuid, device_id, entity_type, entity_id, action, payload, status, retry_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
    [queueUuid, deviceId, params.entityType, params.entityId, params.action, payload, now, now]
  );
  return { id: Number(result.lastInsertRowId || 0), queue_uuid: queueUuid };
}

export async function markQueueStatus(
  id: number | string,
  status: SyncQueueStatus,
  extra?: { retry_count?: number; last_error?: string | null; next_retry_at?: string | null; synced?: boolean }
): Promise<void> {
  const now = new Date().toISOString();
  const normalized = status === "synced" ? "done" : status;
  if (extra?.synced || normalized === "done") {
    await (await db()).runAsync(
      "UPDATE sync_queue SET status = ?, updated_at = ?, synced_at = ?, last_error = NULL WHERE id = ?",
      ["done", now, now, id]
    );
    return;
  }
  if (extra?.retry_count != null) {
    await (await db()).runAsync(
      "UPDATE sync_queue SET status = ?, retry_count = ?, last_error = ?, updated_at = ?, next_retry_at = ? WHERE id = ?",
      [normalized, extra.retry_count, extra.last_error ?? null, now, extra.next_retry_at ?? null, id]
    );
    return;
  }
  await (await db()).runAsync("UPDATE sync_queue SET status = ?, updated_at = ? WHERE id = ?", [
    normalized,
    now,
    id,
  ]);
}

export async function resetConflictsToPending(): Promise<void> {
  const now = new Date().toISOString();
  await (await db()).runAsync(
    "UPDATE sync_queue SET status = ?, retry_count = ?, updated_at = ? WHERE status = ?",
    ["pending", 0, now, "conflict"]
  );
}

export async function cancelConflicts(): Promise<void> {
  const now = new Date().toISOString();
  await (await db()).runAsync("UPDATE sync_queue SET status = ?, updated_at = ? WHERE status = ?", [
    "cancelled",
    now,
    "conflict",
  ]);
}
