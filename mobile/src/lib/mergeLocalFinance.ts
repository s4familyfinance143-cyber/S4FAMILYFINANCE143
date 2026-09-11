/** Merge API rows with pending local SQLite mirrors for offline-first UI. */

type AccountRow = {
  id: string;
  name: string;
  account_type?: string;
  currency?: string;
  current_balance?: string | number;
  opening_balance?: string | number;
};

type TransactionRow = {
  id: string;
  transaction_type?: string;
  amount?: string | number;
  currency?: string;
  description?: string;
  status?: string;
  account_id?: string;
  category_id?: string;
};

function mapLocalAccount(row: Record<string, unknown>): AccountRow {
  return {
    id: String(row.server_id || row.id),
    name: String(row.name || "Wallet"),
    account_type: row.account_type != null ? String(row.account_type) : undefined,
    currency: row.currency != null ? String(row.currency) : undefined,
    current_balance: (row.current_balance ?? row.opening_balance ?? "0") as string | number,
  };
}

function mapLocalTransaction(row: Record<string, unknown>): TransactionRow {
  return {
    id: String(row.server_id || row.id),
    transaction_type: row.transaction_type != null ? String(row.transaction_type) : undefined,
    amount: row.amount as string | number | undefined,
    currency: row.currency != null ? String(row.currency) : undefined,
    description: row.description != null ? String(row.description) : undefined,
    status: row.status != null ? String(row.status) : undefined,
    account_id: row.account_id != null ? String(row.account_id) : undefined,
    category_id: row.category_id != null ? String(row.category_id) : undefined,
  };
}

export function mergeApiAccounts<T extends AccountRow>(
  apiRows: T[],
  localRows: Record<string, unknown>[]
): T[] {
  const byId = new Map<string, T>();
  for (const row of apiRows) {
    byId.set(String(row.id), row);
  }
  for (const row of localRows) {
    const syncStatus = String(row.sync_status || "");
    const serverId = row.server_id != null ? String(row.server_id) : "";
    if (syncStatus === "done" && serverId && byId.has(serverId)) continue;
    const mapped = mapLocalAccount(row) as T;
    const key = serverId || String(row.id);
    if (!byId.has(key)) byId.set(key, mapped);
  }
  return Array.from(byId.values());
}

export function mergeApiTransactions<T extends TransactionRow>(
  apiRows: T[],
  localRows: Record<string, unknown>[]
): T[] {
  const byId = new Map<string, T>();
  for (const row of apiRows) {
    byId.set(String(row.id), row);
  }
  for (const row of localRows) {
    const syncStatus = String(row.sync_status || "");
    const serverId = row.server_id != null ? String(row.server_id) : "";
    if (syncStatus === "done" && serverId && byId.has(serverId)) continue;
    const mapped = mapLocalTransaction(row) as T;
    const key = serverId || String(row.id);
    if (!byId.has(key)) byId.set(key, mapped);
  }
  return Array.from(byId.values());
}
