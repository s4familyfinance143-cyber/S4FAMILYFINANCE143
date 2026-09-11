/**
 * Map life module types → architecture dedicated APIs.
 * Keeps PhaseItem-shaped responses for LifeModulesPanel.
 */

export type LifeModuleType =
  | "INVESTMENT"
  | "HEALTH"
  | "VEHICLE"
  | "EDUCATION"
  | "SUBSCRIPTION"
  | "DOCUMENT"
  | "PROPERTY";

const ROUTE: Record<LifeModuleType, string> = {
  INVESTMENT: "investments",
  HEALTH: "health-expenses",
  VEHICLE: "vehicle-expenses",
  EDUCATION: "education-funds",
  SUBSCRIPTION: "subscriptions",
  DOCUMENT: "documents",
  PROPERTY: "properties",
};

export function architectureRoute(moduleType: string): string {
  const key = String(moduleType || "").toUpperCase() as LifeModuleType;
  return ROUTE[key] || "investments";
}

export function listPath(moduleType: string, familyId: string): string {
  return `/api/v1/${architectureRoute(moduleType)}?family_id=${encodeURIComponent(familyId)}`;
}

export function createPath(moduleType: string): string {
  return `/api/v1/${architectureRoute(moduleType)}`;
}

export function closePath(moduleType: string, itemId: string): string {
  return `/api/v1/${architectureRoute(moduleType)}/${itemId}/close`;
}

export function updatePath(moduleType: string, itemId: string): string {
  return `/api/v1/${architectureRoute(moduleType)}/${itemId}`;
}

export function documentUploadPath(itemId: string): string {
  return `/api/v1/documents/${itemId}/upload`;
}

export function documentDownloadPath(itemId: string, familyId: string): string {
  return `/api/v1/documents/${itemId}/download?family_id=${encodeURIComponent(familyId)}`;
}

/** Normalize dedicated API row → PhaseItem-like. */
export function normalizeLifeItem(moduleType: string, row: any): any {
  const mt = String(moduleType || row.module_type || "").toUpperCase();
  return {
    id: row.id,
    family_id: row.family_id,
    module_type: mt,
    name: row.name || row.vehicle_name || "",
    category: "GENERAL",
    sub_type: row.sub_type || row.type || "",
    provider: row.provider || row.doctor || row.location || null,
    member_id: row.member_id || null,
    amount: row.amount ?? row.principal ?? row.value ?? "0",
    secondary_amount: row.rate ?? row.rent_income ?? row.km_reading ?? null,
    currency: row.currency || "BDT",
    target_date: row.target_date || row.expense_date || row.maturity || null,
    secondary_date: row.start_date || null,
    renewal_or_expiry_date: row.next_due || row.expiry_date || row.target_date || null,
    billing_cycle: row.cycle || row.billing_cycle || null,
    reference: row.area || row.reference || null,
    status: row.status || "ACTIVE",
    note: row.note || row.notes || null,
    file_name: row.file_name || null,
    file_path: row.file_path || row.file_url || null,
    file_encrypted: row.encrypted ?? row.file_encrypted ?? false,
  };
}

/** Build create payload for dedicated APIs from life form. */
export function buildCreatePayload(moduleType: string, familyId: string, currency: string, form: Record<string, any>) {
  const mt = moduleType.toUpperCase();
  const base = {
    family_id: familyId,
    currency: currency || "BDT",
    notes: form.note || null,
    note: form.note || null,
  };
  if (mt === "INVESTMENT") {
    return {
      ...base,
      name: form.name,
      type: form.sub_type || "GENERAL",
      principal: form.amount || "0",
      maturity: form.renewal_or_expiry_date || null,
      member_id: form.member_id || null,
    };
  }
  if (mt === "HEALTH") {
    return {
      ...base,
      type: form.sub_type || "GENERAL",
      doctor: form.provider || null,
      amount: form.amount || "0",
      expense_date: form.renewal_or_expiry_date || null,
      member_id: form.member_id || null,
    };
  }
  if (mt === "VEHICLE") {
    return {
      ...base,
      vehicle_name: form.name,
      type: form.sub_type || "GENERAL",
      amount: form.amount || "0",
      expense_date: form.renewal_or_expiry_date || null,
    };
  }
  if (mt === "EDUCATION") {
    return {
      ...base,
      name: form.name,
      type: form.sub_type || "GENERAL",
      provider: form.provider || null,
      amount: form.amount || "0",
      target_date: form.renewal_or_expiry_date || null,
      member_id: form.member_id || null,
    };
  }
  if (mt === "SUBSCRIPTION") {
    return {
      ...base,
      name: form.name,
      amount: form.amount || "0",
      cycle: form.billing_cycle || "MONTHLY",
      next_due: form.renewal_or_expiry_date || null,
    };
  }
  if (mt === "DOCUMENT") {
    return {
      ...base,
      name: form.name,
      type: form.sub_type || "GENERAL",
      expiry_date: form.renewal_or_expiry_date || null,
      member_id: form.member_id || null,
    };
  }
  if (mt === "PROPERTY") {
    return {
      ...base,
      name: form.name,
      type: form.sub_type || "GENERAL",
      value: form.amount || "0",
      location: form.provider || null,
      area: form.reference || null,
    };
  }
  return { ...base, name: form.name, amount: form.amount || "0" };
}

export function offlineEntityType(moduleType: string): string {
  const map: Record<string, string> = {
    INVESTMENT: "investments",
    HEALTH: "health_expenses",
    VEHICLE: "vehicle_expenses",
    EDUCATION: "education_funds",
    SUBSCRIPTION: "subscriptions",
    DOCUMENT: "documents",
    PROPERTY: "properties",
  };
  return map[moduleType.toUpperCase()] || "investments";
}
