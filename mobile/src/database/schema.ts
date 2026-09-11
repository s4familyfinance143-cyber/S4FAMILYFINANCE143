/** Offline SQLite schema — architecture Offline-First local mirrors + sync_queue. */

export const SCHEMA_VERSION = 7;

/** Architecture status enum: pending|syncing|done|failed|conflict (+ legacy synced/cancelled). */
export type SyncQueueStatus =
  | "pending"
  | "syncing"
  | "done"
  | "synced" // legacy alias of done
  | "failed"
  | "conflict"
  | "cancelled";

export type SyncQueueRow = {
  id: number | string;
  queue_uuid?: string | null;
  device_id?: string | null;
  entity_type?: string;
  entity_id: string;
  action: string;
  payload: string;
  status?: SyncQueueStatus | string;
  retry_count: number;
  last_error?: string | null;
  created_at?: string;
  updated_at?: string;
  synced_at?: string | null;
  next_retry_at?: string | null;
};

export const CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS sync_meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mobile_meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  queue_uuid TEXT,
  device_id TEXT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  synced_at TEXT,
  next_retry_at TEXT
);

CREATE TABLE IF NOT EXISTS local_transactions (
  id TEXT PRIMARY KEY NOT NULL,
  family_id TEXT NOT NULL,
  server_id TEXT,
  transaction_type TEXT NOT NULL,
  account_id TEXT,
  category_id TEXT,
  amount TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'BDT',
  description TEXT,
  status TEXT NOT NULL DEFAULT 'LOCAL',
  sync_status TEXT NOT NULL DEFAULT 'pending',
  client_request_id TEXT,
  payload TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS local_accounts (
  id TEXT PRIMARY KEY NOT NULL,
  family_id TEXT NOT NULL,
  server_id TEXT,
  name TEXT NOT NULL,
  account_type TEXT,
  currency TEXT NOT NULL DEFAULT 'BDT',
  current_balance TEXT,
  opening_balance TEXT,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  payload TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS local_grocery_lists (
  id TEXT PRIMARY KEY NOT NULL,
  family_id TEXT NOT NULL,
  server_id TEXT,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  budget_amount TEXT,
  currency TEXT DEFAULT 'BDT',
  vendor_name TEXT,
  shopping_date TEXT,
  note TEXT,
  mobile_sync_key TEXT,
  sync_version INTEGER DEFAULT 1,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  payload TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS local_grocery_items (
  id TEXT PRIMARY KEY NOT NULL,
  family_id TEXT NOT NULL,
  server_id TEXT,
  grocery_list_id TEXT,
  name TEXT NOT NULL,
  quantity TEXT,
  unit TEXT,
  estimated_price TEXT,
  actual_price TEXT,
  is_bought INTEGER NOT NULL DEFAULT 0,
  mobile_sync_key TEXT,
  sync_version INTEGER DEFAULT 1,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  payload TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS local_loans (
  id TEXT PRIMARY KEY NOT NULL,
  family_id TEXT NOT NULL,
  server_id TEXT,
  person_name TEXT,
  amount TEXT,
  currency TEXT DEFAULT 'BDT',
  loan_type TEXT,
  status TEXT,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  payload TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS local_budgets (
  id TEXT PRIMARY KEY NOT NULL,
  family_id TEXT NOT NULL,
  server_id TEXT,
  name TEXT,
  category_id TEXT,
  budget_amount TEXT,
  spent_amount TEXT,
  currency TEXT DEFAULT 'BDT',
  status TEXT,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  payload TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS local_notifications (
  id TEXT PRIMARY KEY NOT NULL,
  family_id TEXT NOT NULL,
  server_id TEXT,
  title TEXT,
  body TEXT,
  notification_type TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  payload TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS local_categories (
  id TEXT PRIMARY KEY NOT NULL,
  family_id TEXT NOT NULL,
  server_id TEXT,
  name_en TEXT,
  name_bn TEXT,
  category_type TEXT,
  icon TEXT,
  color TEXT,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  payload TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS local_family_members (
  id TEXT PRIMARY KEY NOT NULL,
  family_id TEXT NOT NULL,
  server_id TEXT,
  user_id TEXT,
  display_name TEXT,
  role TEXT,
  status TEXT,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  payload TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS local_records (
  id TEXT PRIMARY KEY NOT NULL,
  family_id TEXT NOT NULL,
  server_id TEXT,
  entity_type TEXT NOT NULL,
  title TEXT,
  amount TEXT,
  currency TEXT DEFAULT 'BDT',
  status TEXT,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  payload TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS mobile_grocery_drafts (
  id TEXT PRIMARY KEY NOT NULL,
  family_id TEXT NOT NULL,
  title TEXT,
  item_name TEXT,
  estimated_price TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mobile_finance_intents (
  id TEXT PRIMARY KEY NOT NULL,
  family_id TEXT NOT NULL,
  intent_type TEXT NOT NULL,
  amount TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sync_queue_status_created ON sync_queue(status, created_at);
CREATE INDEX IF NOT EXISTS idx_sync_queue_device ON sync_queue(device_id);
CREATE INDEX IF NOT EXISTS idx_local_tx_family ON local_transactions(family_id, sync_status);
CREATE INDEX IF NOT EXISTS idx_local_accounts_family ON local_accounts(family_id, sync_status);
CREATE INDEX IF NOT EXISTS idx_local_grocery_family ON local_grocery_lists(family_id, sync_status);
CREATE INDEX IF NOT EXISTS idx_local_grocery_items_family ON local_grocery_items(family_id, grocery_list_id);
CREATE INDEX IF NOT EXISTS idx_local_loans_family ON local_loans(family_id, sync_status);
CREATE INDEX IF NOT EXISTS idx_local_budgets_family ON local_budgets(family_id, sync_status);
CREATE INDEX IF NOT EXISTS idx_local_records_family_type ON local_records(family_id, entity_type, sync_status);
`;
