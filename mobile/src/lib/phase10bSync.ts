/** Map mobile sync_queue grocery rows → Phase 10B /sync/push changes. */

export type SyncQueueRow = {
  id: number;
  entity_id: string;
  action: string;
  payload: string;
  retry_count: number;
  last_error?: string;
};

export type Phase10bChange = {
  client_change_id: string;
  entity_type: string;
  entity_id?: string | null;
  operation: "CREATE" | "UPDATE" | "DELETE" | "UPSERT" | "DEPOSIT" | "WITHDRAW" | "PAYMENT" | "CONTRIBUTE" | "PAUSE" | "RESUME" | "CLOSE";
  payload: Record<string, unknown>;
};

type GroceryPayload = {
  family_id: string;
  item_id?: string;
  name?: string;
  category?: string;
  quantity?: string;
  unit?: string;
  title?: string;
  item_name?: string;
  estimated_price?: string;
  actual_price?: string;
  note?: string;
  sync_version?: number;
  mobile_sync_id?: string;
  created_at?: string;
  grocery_list_id?: string;
};

export const MOBILE_SYNC_DEVICE_ID = "mobile-expo";

export function mapGroceryRowToChanges(row: SyncQueueRow): Phase10bChange[] {
  const payload = JSON.parse(row.payload) as GroceryPayload;
  const clientId = `mobile-q-${row.id}`;

  if (row.action === "UPDATE_ITEM") {
    if (!payload.item_id) throw new Error("Invalid grocery update payload");
    return [
      {
        client_change_id: clientId,
        entity_type: "grocery_items",
        entity_id: payload.item_id,
        operation: "UPDATE",
        payload: {
          name: payload.name,
          category: payload.category || "GENERAL",
          quantity: payload.quantity || "1",
          unit: payload.unit || "pcs",
          estimated_price: payload.estimated_price || "0",
          actual_price: payload.actual_price || "0",
          note: payload.note,
          expected_sync_version: payload.sync_version,
          last_client_updated_at: payload.created_at,
        },
      },
    ];
  }

  if (row.action === "MARK_ITEM_BOUGHT") {
    if (!payload.item_id) throw new Error("Invalid grocery buy payload");
    return [
      {
        client_change_id: clientId,
        entity_type: "grocery_items",
        entity_id: payload.item_id,
        operation: "UPDATE",
        payload: {
          is_bought: true,
          actual_price: payload.actual_price || payload.estimated_price || "0",
          expected_sync_version: payload.sync_version,
          last_client_updated_at: payload.created_at,
        },
      },
    ];
  }

  if (row.action === "CREATE_DRAFT") {
    const mobileSyncId = payload.mobile_sync_id || row.entity_id;
    const changes: Phase10bChange[] = [
      {
        client_change_id: `${clientId}-list`,
        entity_type: "grocery_lists",
        entity_id: null,
        operation: "CREATE",
        payload: {
          title: payload.title || "Grocery List",
          budget_amount: payload.estimated_price || "0",
          currency: "BDT",
          mobile_sync_key: mobileSyncId,
          note: `mobile_sync_id:${mobileSyncId}`,
          last_client_updated_at: payload.created_at,
          status: "OPEN",
        },
      },
    ];
    // Item create needs list id from server — handled as follow-up via grocery REST after list sync,
    // OR as second change with grocery_list_id once known. For Phase 10B first pass, only list via push;
    // item still created in fallback path after pull finds list by mobile_sync_key.
    return changes;
  }

  throw new Error(`Unsupported sync action: ${row.action}`);
}

export async function pushPhase10bChanges(
  apiBase: string,
  authToken: string,
  familyId: string,
  changes: Phase10bChange[],
  tunnelHeaders: Record<string, string> = {},
  deviceId = MOBILE_SYNC_DEVICE_ID
) {
  const response = await fetch(`${apiBase}/api/v1/families/${familyId}/sync/push`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
      ...tunnelHeaders,
    },
    body: JSON.stringify({
      device_id: deviceId,
      device_name: "S4 Mobile",
      platform: "mobile",
      app_version: "expo",
      changes,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof data.detail === "object" ? JSON.stringify(data.detail) : data.detail || "sync/push failed");
  }
  return data as {
    status: string;
    conflict_count?: number;
    conflict_ids?: string[];
    applied?: { synced_count?: number; failed_count?: number; conflict_count?: number; failed?: { error?: string }[] };
  };
}

export async function pullPhase10b(
  apiBase: string,
  authToken: string,
  familyId: string,
  tunnelHeaders: Record<string, string> = {},
  deviceId = MOBILE_SYNC_DEVICE_ID,
  sinceToken?: string | null
) {
  const qs = new URLSearchParams({
    device_id: deviceId,
    limit: "100",
  });
  if (sinceToken) qs.set("since_token", sinceToken);
  const response = await fetch(`${apiBase}/api/v1/families/${familyId}/sync/pull?${qs}`, {
    headers: {
      Authorization: `Bearer ${authToken}`,
      ...tunnelHeaders,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof data.detail === "object" ? JSON.stringify(data.detail) : data.detail || "sync/pull failed");
  }
  return data as {
    sync_token?: string;
    changes?: {
      grocery_lists?: Array<{ id: string; mobile_sync_key?: string; sync_version?: number; title?: string }>;
      grocery_items?: Array<{ id: string; mobile_sync_key?: string; sync_version?: number; name?: string }>;
    };
  };
}

export async function fetchOpenConflicts(
  apiBase: string,
  authToken: string,
  familyId: string,
  tunnelHeaders: Record<string, string> = {}
) {
  const response = await fetch(
    `${apiBase}/api/v1/families/${familyId}/sync/conflicts?status=OPEN&limit=50`,
    {
      headers: {
        Authorization: `Bearer ${authToken}`,
        ...tunnelHeaders,
      },
    }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof data.detail === "object" ? JSON.stringify(data.detail) : data.detail || "sync/conflicts failed");
  }
  return (data.conflicts || []) as Array<{
    id: string;
    entity_type?: string;
    entity_id?: string;
    local_payload?: unknown;
    remote_payload?: unknown;
  }>;
}

export function pushResultHasConflict(result: {
  conflict_count?: number;
  applied?: { conflict_count?: number; failed?: { error?: string }[] };
}): boolean {
  if (Number(result.conflict_count || 0) > 0) return true;
  if (Number(result.applied?.conflict_count || 0) > 0) return true;
  const failed = result.applied?.failed || [];
  return failed.some((f) => String(f.error || "").includes("SYNC_CONFLICT") || String(f.error || "").includes("conflict"));
}

export function mapFinanceIntentToChange(row: SyncQueueRow): Phase10bChange {
  const payload = JSON.parse(row.payload) as {
    family_id: string;
    type?: string;
    account_id?: string;
    to_account_id?: string;
    category_id?: string;
    amount?: string;
    note?: string;
    created_at?: string;
  };
  const txType = String(payload.type || "EXPENSE").toUpperCase();
  return {
    client_change_id: `mobile-fin-${row.id}`,
    entity_type: "transactions",
    entity_id: null,
    operation: "CREATE",
    payload: {
      transaction_type: txType,
      type: txType,
      account_id: payload.account_id,
      from_account_id: payload.account_id,
      to_account_id: payload.to_account_id,
      category_id: payload.category_id,
      amount: payload.amount,
      description: payload.note,
      note: payload.note,
      client_request_id: `mobile-fin-${row.id}`,
      last_client_updated_at: payload.created_at,
    },
  };
}

export function mapDomainOutboxRow(row: SyncQueueRow & { entity_type?: string }): Phase10bChange[] {
  const entityType = String((row as any).entity_type || "").trim();
  const payload = JSON.parse(row.payload) as Record<string, unknown>;
  const op = String(row.action || "UPSERT").toUpperCase();
  const allowed = ["CREATE", "UPDATE", "DELETE", "UPSERT", "DEPOSIT", "WITHDRAW", "PAYMENT", "CONTRIBUTE", "PAUSE", "RESUME", "CLOSE"] as const;
  const operation = (allowed.includes(op as (typeof allowed)[number]) ? op : "UPSERT") as Phase10bChange["operation"];

  const supported = [
    "phase15_items",
    "phase16_items",
    "zakat_records",
    "budgets",
    "savings_goals",
    "loans",
    "accounts",
    "transactions",
    "financial_goals",
    "recurring_transactions",
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
    "grocery_lists",
    "grocery_items",
    "grocery_vendors",
    "categories",
    "notifications",
    "family_members",
  ];
  if (!supported.includes(entityType)) {
    throw new Error(`Unsupported domain entity_type: ${entityType}`);
  }

  return [
    {
      client_change_id: `mobile-q-${row.queue_uuid || row.id}`,
      entity_type: entityType,
      entity_id:
        (payload.entity_id as string) ||
        (payload.savings_goal_id as string) ||
        (payload.loan_id as string) ||
        (payload.goal_id as string) ||
        (payload.id as string) ||
        null,
      operation,
      payload: {
        ...payload,
        client_request_id: payload.client_request_id || `mobile-q-${row.id}`,
      },
    },
  ];
}

export function pushResultFailed(result: {
  applied?: { failed_count?: number; failed?: { error?: string }[] };
}): string | null {
  if (Number(result.applied?.failed_count || 0) <= 0) return null;
  const first = result.applied?.failed?.[0];
  return String(first?.error || "sync apply failed");
}
