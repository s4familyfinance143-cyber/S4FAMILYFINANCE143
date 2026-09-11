/** Local SQLite mirrors — save here first (Offline-First). */

import { openMobileDatabase } from "../lib/mobileDb";

/** Dedicated mirror tables. */
export type SpecificLocalEntity =
  | "transactions"
  | "accounts"
  | "grocery_lists"
  | "grocery_items"
  | "loans"
  | "budgets"
  | "notifications"
  | "categories"
  | "family_members";

/** Generic local_records entity_type values. */
export type RecordLocalEntity =
  | "investments"
  | "health_expenses"
  | "vehicle_expenses"
  | "education_funds"
  | "properties"
  | "subscriptions"
  | "documents"
  | "tags"
  | "transaction_tags"
  | "loan_payments"
  | "savings_goals"
  | "financial_goals"
  | "recurring_transactions"
  | "zakat_records"
  | "grocery_vendors";

export type LocalEntity = SpecificLocalEntity | RecordLocalEntity;

const SPECIFIC_TABLE: Record<SpecificLocalEntity, string> = {
  transactions: "local_transactions",
  accounts: "local_accounts",
  grocery_lists: "local_grocery_lists",
  grocery_items: "local_grocery_items",
  loans: "local_loans",
  budgets: "local_budgets",
  notifications: "local_notifications",
  categories: "local_categories",
  family_members: "local_family_members",
};

const RECORD_ENTITIES = new Set<string>([
  "investments",
  "health_expenses",
  "vehicle_expenses",
  "education_funds",
  "properties",
  "subscriptions",
  "documents",
  "tags",
  "transaction_tags",
  "loan_payments",
  "savings_goals",
  "financial_goals",
  "recurring_transactions",
  "zakat_records",
  "grocery_vendors",
]);

export function isLocalEntity(value: string): value is LocalEntity {
  return value in SPECIFIC_TABLE || RECORD_ENTITIES.has(value);
}

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function tableFor(entity: LocalEntity): string {
  if (entity in SPECIFIC_TABLE) return SPECIFIC_TABLE[entity as SpecificLocalEntity];
  return "local_records";
}

export async function upsertLocal(
  entity: LocalEntity,
  familyId: string,
  data: Record<string, unknown>,
  opts?: { id?: string; syncStatus?: string }
): Promise<{ id: string; table: string }> {
  const db = await openMobileDatabase();
  const now = new Date().toISOString();
  const id = String(opts?.id || data.id || data.server_id || uuid());
  const syncStatus = opts?.syncStatus || "pending";
  const payload = JSON.stringify({ ...data, id, family_id: familyId });
  const serverId = data.server_id != null ? String(data.server_id) : id.match(/^[0-9a-f-]{36}$/i) ? id : null;

  if (entity === "transactions") {
    await db.runAsync(
      `INSERT OR REPLACE INTO local_transactions
       (id, family_id, server_id, transaction_type, account_id, category_id, amount, currency, description, status, sync_status, client_request_id, payload, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM local_transactions WHERE id = ?), ?), ?, NULL)`,
      [
        id,
        familyId,
        serverId,
        String(data.transaction_type || data.type || "EXPENSE"),
        data.account_id || null,
        data.category_id || null,
        String(data.amount ?? "0"),
        String(data.currency || "BDT"),
        data.description || data.note || null,
        String(data.status || "LOCAL"),
        syncStatus,
        data.client_request_id || id,
        payload,
        id,
        now,
        now,
      ]
    );
  } else if (entity === "accounts") {
    await db.runAsync(
      `INSERT OR REPLACE INTO local_accounts
       (id, family_id, server_id, name, account_type, currency, current_balance, opening_balance, sync_status, payload, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM local_accounts WHERE id = ?), ?), ?, NULL)`,
      [
        id,
        familyId,
        serverId,
        String(data.name || "Wallet"),
        data.account_type || data.type || null,
        String(data.currency || "BDT"),
        data.current_balance != null ? String(data.current_balance) : null,
        data.opening_balance != null ? String(data.opening_balance) : null,
        syncStatus,
        payload,
        id,
        now,
        now,
      ]
    );
  } else if (entity === "grocery_lists") {
    await db.runAsync(
      `INSERT OR REPLACE INTO local_grocery_lists
       (id, family_id, server_id, name, status, budget_amount, currency, vendor_name, shopping_date, note, mobile_sync_key, sync_version, sync_status, payload, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM local_grocery_lists WHERE id = ?), ?), ?, NULL)`,
      [
        id,
        familyId,
        serverId,
        String(data.name || data.title || "Grocery"),
        String(data.status || "OPEN"),
        data.budget_amount != null ? String(data.budget_amount) : null,
        String(data.currency || "BDT"),
        data.vendor_name || null,
        data.shopping_date || null,
        data.note || null,
        data.mobile_sync_key || id,
        Number(data.sync_version || 1),
        syncStatus,
        payload,
        id,
        now,
        now,
      ]
    );
  } else if (entity === "grocery_items") {
    await db.runAsync(
      `INSERT OR REPLACE INTO local_grocery_items
       (id, family_id, server_id, grocery_list_id, name, quantity, unit, estimated_price, actual_price, is_bought, mobile_sync_key, sync_version, sync_status, payload, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM local_grocery_items WHERE id = ?), ?), ?, NULL)`,
      [
        id,
        familyId,
        serverId,
        data.grocery_list_id || null,
        String(data.name || "Item"),
        data.quantity != null ? String(data.quantity) : "1",
        data.unit || "pcs",
        data.estimated_price != null ? String(data.estimated_price) : null,
        data.actual_price != null ? String(data.actual_price) : null,
        data.is_bought ? 1 : 0,
        data.mobile_sync_key || id,
        Number(data.sync_version || 1),
        syncStatus,
        payload,
        id,
        now,
        now,
      ]
    );
  } else if (entity === "loans") {
    await db.runAsync(
      `INSERT OR REPLACE INTO local_loans
       (id, family_id, server_id, person_name, amount, currency, loan_type, status, sync_status, payload, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM local_loans WHERE id = ?), ?), ?, NULL)`,
      [
        id,
        familyId,
        serverId,
        data.person_name || null,
        data.amount != null ? String(data.amount) : null,
        String(data.currency || "BDT"),
        data.loan_type || data.direction || null,
        data.status || null,
        syncStatus,
        payload,
        id,
        now,
        now,
      ]
    );
  } else if (entity === "budgets") {
    await db.runAsync(
      `INSERT OR REPLACE INTO local_budgets
       (id, family_id, server_id, name, category_id, budget_amount, spent_amount, currency, status, sync_status, payload, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM local_budgets WHERE id = ?), ?), ?, NULL)`,
      [
        id,
        familyId,
        serverId,
        data.name || null,
        data.category_id || null,
        data.budget_amount != null ? String(data.budget_amount) : null,
        data.spent_amount != null ? String(data.spent_amount) : null,
        String(data.currency || "BDT"),
        data.status || null,
        syncStatus,
        payload,
        id,
        now,
        now,
      ]
    );
  } else if (entity === "notifications") {
    await db.runAsync(
      `INSERT OR REPLACE INTO local_notifications
       (id, family_id, server_id, title, body, notification_type, is_read, sync_status, payload, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM local_notifications WHERE id = ?), ?), ?, NULL)`,
      [
        id,
        familyId,
        serverId,
        data.title || null,
        data.body || data.message || null,
        data.notification_type || data.type || null,
        data.is_read ? 1 : 0,
        syncStatus,
        payload,
        id,
        now,
        now,
      ]
    );
  } else if (entity === "categories") {
    await db.runAsync(
      `INSERT OR REPLACE INTO local_categories
       (id, family_id, server_id, name_en, name_bn, category_type, icon, color, sync_status, payload, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM local_categories WHERE id = ?), ?), ?, NULL)`,
      [
        id,
        familyId,
        serverId,
        data.name_en || data.name || null,
        data.name_bn || null,
        data.category_type || data.type || null,
        data.icon || null,
        data.color || null,
        syncStatus,
        payload,
        id,
        now,
        now,
      ]
    );
  } else if (entity === "family_members") {
    await db.runAsync(
      `INSERT OR REPLACE INTO local_family_members
       (id, family_id, server_id, user_id, display_name, role, status, sync_status, payload, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM local_family_members WHERE id = ?), ?), ?, NULL)`,
      [
        id,
        familyId,
        serverId,
        data.user_id || null,
        data.display_name || data.name || null,
        data.role || null,
        data.status || null,
        syncStatus,
        payload,
        id,
        now,
        now,
      ]
    );
  } else {
    // Generic local_records for life + extended finance entities
    await db.runAsync(
      `INSERT OR REPLACE INTO local_records
       (id, family_id, server_id, entity_type, title, amount, currency, status, sync_status, payload, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM local_records WHERE id = ?), ?), ?, NULL)`,
      [
        id,
        familyId,
        serverId,
        entity,
        String(data.title || data.name || data.person_name || entity),
        data.amount != null
          ? String(data.amount)
          : data.value != null
            ? String(data.value)
            : data.target_amount != null
              ? String(data.target_amount)
              : null,
        String(data.currency || "BDT"),
        data.status != null ? String(data.status) : null,
        syncStatus,
        payload,
        id,
        now,
        now,
      ]
    );
  }

  return { id, table: tableFor(entity) };
}

export async function listLocal(entity: LocalEntity, familyId: string, limit = 100) {
  const db = await openMobileDatabase();
  if (entity in SPECIFIC_TABLE) {
    const table = SPECIFIC_TABLE[entity as SpecificLocalEntity];
    return db.getAllAsync(
      `SELECT * FROM ${table} WHERE family_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT ?`,
      [familyId, limit]
    );
  }
  return db.getAllAsync(
    `SELECT * FROM local_records WHERE family_id = ? AND entity_type = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT ?`,
    [familyId, entity, limit]
  );
}

export async function markLocalSynced(entity: LocalEntity, localId: string, serverId?: string) {
  const db = await openMobileDatabase();
  const table = tableFor(entity);
  const now = new Date().toISOString();
  if (serverId) {
    await db.runAsync(`UPDATE ${table} SET sync_status = 'done', server_id = ?, updated_at = ? WHERE id = ?`, [
      serverId,
      now,
      localId,
    ]);
  } else {
    await db.runAsync(`UPDATE ${table} SET sync_status = 'done', updated_at = ? WHERE id = ?`, [now, localId]);
  }
}

/** Map sync entity_type / alias → LocalEntity. */
export function mapSyncEntityToLocal(entityType: string): LocalEntity | null {
  const key = String(entityType || "").trim();
  if (!key) return null;
  if (key === "grocery") return "grocery_lists";
  if (isLocalEntity(key)) return key;
  return null;
}

/** Apply a pulled server row into the matching local_* mirror. */
export async function applyServerRowToLocal(
  entityType: string,
  familyId: string,
  row: Record<string, unknown>
): Promise<void> {
  const local = mapSyncEntityToLocal(entityType);
  if (!local) return;
  const id = String(row.id || row.server_id || "");
  if (!id) return;
  await upsertLocal(
    local,
    familyId,
    {
      ...row,
      server_id: id,
      id,
    },
    { id, syncStatus: "done" }
  );
}
