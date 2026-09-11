/** Queue manager — enqueue / status / retry helpers over SQLite sync_queue. */

import * as queries from "../database/queries";
import type { SyncQueueRow, SyncQueueStatus } from "../database/schema";

export const queueManager = {
  enqueue: queries.enqueue,
  list: queries.listQueue,
  countPending: () => queries.countByStatus("pending"),
  countConflicts: () => queries.countByStatus("conflict"),
  countFailed: () => queries.countByStatus("failed"),
  countPendingGrocery: () => queries.countPendingGrocery(),
  countPendingFinance: () => queries.countPendingByEntity("finance_intent"),
  markStatus: queries.markQueueStatus,
  resetConflicts: queries.resetConflictsToPending,
  cancelConflicts: queries.cancelConflicts,

  async markSyncing(id: number) {
    await queries.markQueueStatus(id, "syncing");
  },

  async markSynced(id: number) {
    await queries.markQueueStatus(id, "done", { synced: true });
  },

  async markFailed(id: number, retryCount: number, error: string, nextRetryAt: string) {
    const status: SyncQueueStatus = retryCount >= 5 ? "failed" : "pending";
    await queries.markQueueStatus(id, status === "failed" ? "failed" : "pending", {
      retry_count: retryCount,
      last_error: error,
      next_retry_at: nextRetryAt,
    });
  },

  async markConflict(id: number, error: string) {
    await queries.markQueueStatus(id, "conflict", {
      retry_count: 0,
      last_error: error,
    });
  },
};

export type { SyncQueueRow };
