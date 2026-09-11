import {
  ENCRYPTED_DB_NAME,
  decryptOfflinePayload,
  encryptOfflinePayload,
  getOrCreateOfflineDbKeyHex,
  setOfflineDbSecurityStatus,
} from "./mobileDbCrypto";

type SqlValue = string | number | null;

type DbLike = {
  execAsync: (sql: string) => Promise<void>;
  runAsync: (sql: string, ...params: SqlValue[]) => Promise<unknown>;
  getFirstAsync: <T>(sql: string, ...params: SqlValue[]) => Promise<T | null>;
  getAllAsync: <T>(sql: string, ...params: SqlValue[]) => Promise<T[]>;
};

type SyncQueueRow = {
  id: number;
  entity_type: string;
  entity_id: string;
  action: string;
  payload: string;
  status: string;
  retry_count: number;
  last_error?: string | null;
  created_at: string;
  updated_at?: string | null;
  synced_at?: string | null;
};

const memoryStore: {
  sync_queue: SyncQueueRow[];
  nextId: number;
} = { sync_queue: [], nextId: 1 };

function parseUpdateAssignments(sql: string): string[] {
  const match = sql.replace(/\s+/g, " ").match(/UPDATE\s+sync_queue\s+SET\s+(.+?)\s+WHERE/i);
  if (!match) return [];
  return match[1].split(",").map((part) => part.trim().split("=")[0].trim().toLowerCase());
}

export async function openMobileDatabase(_name: string = ENCRYPTED_DB_NAME): Promise<DbLike> {
  await getOrCreateOfflineDbKeyHex();
  setOfflineDbSecurityStatus({
    mode: "web_payload_aes",
    dbName: "memory:sync_queue",
    keyPresent: true,
    cipherVersion: null,
    note: "Web preview: sync_queue payloads encrypted with AES-GCM (ENCv1). Full SQLCipher is native-only.",
  });

  return {
    async execAsync() {},
    async runAsync(sql: string, ...params: SqlValue[]) {
      const normalized = sql.replace(/\s+/g, " ").trim();
      const upper = normalized.toUpperCase();

      if (upper.startsWith("INSERT INTO SYNC_QUEUE")) {
        const rawPayload = String(params[3] ?? "{}");
        const payload = await encryptOfflinePayload(rawPayload);
        memoryStore.sync_queue.push({
          id: memoryStore.nextId++,
          entity_type: String(params[0] ?? ""),
          entity_id: String(params[1] ?? ""),
          action: String(params[2] ?? ""),
          payload,
          status: String(params[4] ?? "pending"),
          retry_count: Number(params[5] ?? 0),
          last_error: params[6] == null ? null : String(params[6]),
          created_at: String(params[7] ?? new Date().toISOString()),
          updated_at: String(params[8] ?? params[7] ?? new Date().toISOString()),
        });
        return;
      }

      if (upper.startsWith("UPDATE SYNC_QUEUE")) {
        const assignments = parseUpdateAssignments(normalized);
        if (!assignments.length) return;

        const whereHasId = upper.includes("WHERE ID =");
        const whereStatusOnly = upper.includes("WHERE STATUS =") && !whereHasId;
        let valueIdx = 0;
        const values: Record<string, SqlValue> = {};
        for (const col of assignments) {
          values[col] = params[valueIdx++];
        }
        const whereParam = params[valueIdx];

        for (const row of memoryStore.sync_queue) {
          const match = whereHasId
            ? row.id === Number(whereParam)
            : whereStatusOnly
              ? row.status === String(whereParam)
              : false;
          if (!match) continue;

          if ("status" in values) row.status = String(values.status ?? row.status);
          if ("retry_count" in values) row.retry_count = Number(values.retry_count ?? row.retry_count);
          if ("last_error" in values) {
            row.last_error = values.last_error == null ? null : String(values.last_error);
          }
          if ("updated_at" in values) row.updated_at = String(values.updated_at ?? row.updated_at);
          if ("synced_at" in values) row.synced_at = String(values.synced_at ?? row.synced_at);
          if ("payload" in values && values.payload != null) {
            row.payload = await encryptOfflinePayload(String(values.payload));
          }
        }
      }
    },
    async getFirstAsync<T>(sql: string, ...params: SqlValue[]) {
      if (sql.toUpperCase().includes("COUNT(*)")) {
        let rows = memoryStore.sync_queue;
        if (params.length === 1) rows = rows.filter((row) => row.status === String(params[0]));
        else if (params.length >= 2) {
          rows = rows.filter((row) => row.status === String(params[0]) && row.entity_type === String(params[1]));
        }
        return { count: rows.length } as T;
      }
      return null;
    },
    async getAllAsync<T>(sql: string, ...params: SqlValue[]) {
      const status = String(params[0] ?? "conflict");
      const entityType = params.length >= 2 && !sql.toUpperCase().includes("ORDER BY UPDATED_AT")
        ? String(params[1])
        : null;
      // Queries: status only OR status + entity_type
      const wantsEntity =
        params.length >= 2 &&
        (sql.toUpperCase().includes("ENTITY_TYPE") || sql.toUpperCase().includes("AND ENTITY_TYPE"));

      let filtered = memoryStore.sync_queue.filter((row) => row.status === status);
      if (wantsEntity) {
        filtered = filtered.filter((row) => row.entity_type === String(params[1]));
      }

      const rows = await Promise.all(
        filtered.slice(0, 20).map(async (row) => ({
          id: row.id,
          entity_id: row.entity_id,
          action: row.action,
          payload: await decryptOfflinePayload(row.payload),
          retry_count: row.retry_count,
          last_error: row.last_error || undefined,
        }))
      );
      return rows as T[];
    },
  };
}

export function isNativeSqliteAvailable() {
  return false;
}

export { ENCRYPTED_DB_NAME, getOfflineDbSecurityStatus } from "./mobileDbCrypto";
