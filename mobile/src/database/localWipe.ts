/**
 * Logout wipe for shared family phones.
 *
 * Logging out used to clear only React state: every cached wallet,
 * transaction, member and the pending sync_queue stayed in SQLite, so the
 * next person to use the phone kept the previous user's family data on disk,
 * and their own session could flush the previous user's queued changes.
 *
 * Kept on purpose:
 * - rows of the pure-offline account (keepFamilyId) -- they exist nowhere else;
 * - mobile_meta / sync_meta (schema version, security mode, offline profile).
 */

import { openMobileDatabase } from "../lib/mobileDb";

/** Every per-family cache table created in schema.ts. */
export const FAMILY_SCOPED_TABLES = [
  "local_transactions",
  "local_accounts",
  "local_grocery_lists",
  "local_grocery_items",
  "local_loans",
  "local_budgets",
  "local_notifications",
  "local_categories",
  "local_family_members",
  "local_records",
  "mobile_grocery_drafts",
  "mobile_finance_intents",
] as const;

export type WipeDb = {
  runAsync(sql: string, params?: unknown[]): Promise<unknown>;
  getFirstAsync<T>(sql: string, params?: unknown[]): Promise<T | null>;
};

/** Queue rows that would be lost by a wipe (not yet on the server). */
export async function countUnsyncedChanges(
  keepFamilyId?: string | null,
  db?: WipeDb
): Promise<number> {
  const database = db ?? ((await openMobileDatabase()) as unknown as WipeDb);
  // No offline account: a sentinel no row can match, so everything goes.
  const keep = keepFamilyId || "__no_offline_family__";
  const row = await database.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM sync_queue
     WHERE status IN ('pending', 'syncing', 'failed', 'conflict')
       AND (CASE WHEN json_valid(payload) THEN COALESCE(json_extract(payload, '$.family_id'), '') ELSE '' END) <> ?`,
    [keep]
  );
  return row?.count ?? 0;
}

export async function wipeLocalUserData(
  keepFamilyId?: string | null,
  db?: WipeDb
): Promise<void> {
  const database = db ?? ((await openMobileDatabase()) as unknown as WipeDb);
  // No offline account: a sentinel no row can match, so everything goes.
  const keep = keepFamilyId || "__no_offline_family__";
  for (const table of FAMILY_SCOPED_TABLES) {
    await database.runAsync(`DELETE FROM ${table} WHERE family_id <> ?`, [keep]);
  }
  await database.runAsync(
    `DELETE FROM sync_queue WHERE (CASE WHEN json_valid(payload) THEN COALESCE(json_extract(payload, '$.family_id'), '') ELSE '' END) <> ?`,
    [keep]
  );
}
