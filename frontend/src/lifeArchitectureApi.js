/** Map PC dashboard life modules → dedicated architecture APIs. */

export const LIFE15 = ["INVESTMENT", "HEALTH", "VEHICLE", "EDUCATION"];
export const LIFE16 = ["SUBSCRIPTION", "DOCUMENT", "PROPERTY"];

const ROUTE = {
  INVESTMENT: "investments",
  HEALTH: "health-expenses",
  VEHICLE: "vehicle-expenses",
  EDUCATION: "education-funds",
  SUBSCRIPTION: "subscriptions",
  DOCUMENT: "documents",
  PROPERTY: "properties",
};

export function architectureRoute(moduleType) {
  return ROUTE[String(moduleType || "").toUpperCase()] || "investments";
}

export function listPath(moduleType, familyId) {
  return `/${architectureRoute(moduleType)}?family_id=${encodeURIComponent(familyId)}`;
}

export function createPath(moduleType) {
  return `/${architectureRoute(moduleType)}`;
}

export function updatePath(moduleType, itemId) {
  return `/${architectureRoute(moduleType)}/${itemId}`;
}

export function closePath(moduleType, itemId) {
  return `/${architectureRoute(moduleType)}/${itemId}/close`;
}

export function documentUploadPath(itemId) {
  return `/documents/${itemId}/upload`;
}

export function lifeSummaryPath(familyId) {
  return `/life-modules/summary?family_id=${encodeURIComponent(familyId)}`;
}

export function lifeUpcomingPath(familyId, days = 30) {
  return `/life-modules/upcoming?family_id=${encodeURIComponent(familyId)}&days=${days}`;
}

export function offlineEntityType(moduleType) {
  const map = {
    INVESTMENT: "investments",
    HEALTH: "health_expenses",
    VEHICLE: "vehicle_expenses",
    EDUCATION: "education_funds",
    SUBSCRIPTION: "subscriptions",
    DOCUMENT: "documents",
    PROPERTY: "properties",
  };
  return map[String(moduleType || "").toUpperCase()] || "investments";
}

export function normalizeLifeItem(moduleType, row) {
  const mt = String(moduleType || row.module_type || "").toUpperCase();
  const isProperty = mt === "PROPERTY";
  return {
    id: row.id,
    family_id: row.family_id,
    module_type: mt,
    name: row.name || row.vehicle_name || "",
    category: row.category || "GENERAL",
    sub_type: row.sub_type || row.type || "",
    provider: row.provider || row.doctor || row.location || null,
    member_id: row.member_id || null,
    // Property: amount field in UI = rental; valuation lives in secondary_amount / value
    amount: isProperty
      ? row.rent_income ?? row.amount ?? "0"
      : row.amount ?? row.principal ?? row.value ?? "0",
    secondary_amount: isProperty
      ? row.value ?? row.secondary_amount ?? null
      : row.secondary_amount ?? row.rate ?? row.rent_income ?? row.km_reading ?? row.monthly_target ?? null,
    currency: row.currency || "BDT",
    target_date: row.target_date || row.expense_date || row.maturity || null,
    secondary_date: row.secondary_date || row.start_date || row.service_due || row.maturity || null,
    renewal_or_expiry_date:
      row.renewal_or_expiry_date || row.next_due || row.expiry_date || row.target_date || null,
    billing_cycle: row.cycle || row.billing_cycle || null,
    payment_account_id: row.payment_account_id || row.account_id || null,
    reference: row.area || row.reference || null,
    status: row.status || "ACTIVE",
    note: row.note || row.notes || null,
    file_name: row.file_name || null,
    file_path: row.file_path || row.file_url || null,
    file_url: row.file_url || row.file_path || null,
    file_size: row.file_size || row.size || null,
    storage_path: row.storage_path || null,
    file_encrypted: row.encrypted ?? row.file_encrypted ?? false,
    has_file: Boolean(row.has_file || row.file_path || row.file_url || row.file_name || row.storage_path),
  };
}

/** Build Phase15/16-style summary.modules from normalized or raw life rows. */
export function summarizeLifeItems(items, moduleTypes = null) {
  const types = Array.isArray(moduleTypes) && moduleTypes.length
    ? moduleTypes.map((mt) => String(mt).toUpperCase())
    : ["INVESTMENT", "HEALTH", "VEHICLE", "EDUCATION", "SUBSCRIPTION", "DOCUMENT", "PROPERTY"];
  const modules = {};
  for (const mt of types) {
    modules[mt] = { active_count: 0, active: 0, total_amount: 0, due_soon_count: 0, monthly_cost_total: 0 };
  }
  let total = 0;
  const now = Date.now();
  const soonMs = 30 * 24 * 60 * 60 * 1000;
  for (const item of items || []) {
    const mt = String(item?.module_type || "").toUpperCase();
    if (!modules[mt]) {
      if (moduleTypes) continue;
      modules[mt] = { active_count: 0, active: 0, total_amount: 0, due_soon_count: 0, monthly_cost_total: 0 };
    }
    const status = String(item?.status || "ACTIVE").toUpperCase();
    if (status !== "ACTIVE" && status !== "OPEN") continue;
    modules[mt].active_count += 1;
    modules[mt].active += 1;
    const amount =
      mt === "PROPERTY"
        ? Number(item.value ?? item.secondary_amount ?? 0) || 0
        : Number(item.amount ?? item.principal ?? item.value ?? 0) || 0;
    modules[mt].total_amount += amount;
    total += 1;
    if (mt === "SUBSCRIPTION") {
      const cycle = String(item.billing_cycle || item.cycle || "MONTHLY").toUpperCase();
      const subAmt = Number(item.amount || 0) || 0;
      modules[mt].monthly_cost_total += cycle === "YEARLY" ? subAmt / 12 : subAmt;
    }
    const dueRaw =
      item.renewal_or_expiry_date ||
      item.target_date ||
      item.secondary_date ||
      item.maturity ||
      item.next_due ||
      item.expiry_date;
    const dueAt = dueRaw ? Date.parse(dueRaw) : NaN;
    if (Number.isFinite(dueAt) && dueAt >= now && dueAt - now <= soonMs) {
      modules[mt].due_soon_count += 1;
    }
  }
  return { total, modules, source: "client" };
}

export function buildCreatePayload(moduleType, familyId, currency, form) {
  const mt = String(moduleType || "").toUpperCase();
  const base = {
    family_id: familyId,
    currency: currency || form.currency || "BDT",
    notes: form.note || null,
    note: form.note || null,
  };
  if (mt === "INVESTMENT") {
    return {
      ...base,
      name: form.name,
      type: form.sub_type || "GENERAL",
      category: form.category || "GENERAL",
      principal: form.amount || "0",
      amount: form.amount || "0",
      rate: form.secondary_amount || null,
      secondary_amount: form.secondary_amount || null,
      maturity: form.secondary_date || form.target_date || form.renewal_or_expiry_date || null,
      target_date: form.target_date || form.secondary_date || form.renewal_or_expiry_date || null,
      secondary_date: form.secondary_date || null,
      member_id: form.member_id || null,
    };
  }
  if (mt === "HEALTH") {
    return {
      ...base,
      name: form.name,
      type: form.sub_type || "GENERAL",
      doctor: form.provider || null,
      provider: form.provider || null,
      amount: form.amount || "0",
      expense_date: form.target_date || form.renewal_or_expiry_date || null,
      target_date: form.target_date || form.renewal_or_expiry_date || null,
      member_id: form.member_id || null,
    };
  }
  if (mt === "VEHICLE") {
    return {
      ...base,
      name: form.name,
      vehicle_name: form.name,
      type: form.sub_type || "GENERAL",
      provider: form.provider || null,
      amount: form.amount || "0",
      km_reading: form.secondary_amount || null,
      secondary_amount: form.secondary_amount || null,
      service_due: form.secondary_date || null,
      secondary_date: form.secondary_date || null,
      expense_date: form.target_date || form.renewal_or_expiry_date || null,
      target_date: form.target_date || form.renewal_or_expiry_date || null,
    };
  }
  if (mt === "EDUCATION") {
    return {
      ...base,
      name: form.name,
      type: form.sub_type || "GENERAL",
      category: form.category || "GENERAL",
      provider: form.provider || null,
      amount: form.amount || "0",
      monthly_target: form.secondary_amount || null,
      secondary_amount: form.secondary_amount || null,
      target_date: form.target_date || form.renewal_or_expiry_date || null,
      member_id: form.member_id || null,
    };
  }
  if (mt === "SUBSCRIPTION") {
    return {
      ...base,
      name: form.name,
      type: form.sub_type || "GENERAL",
      sub_type: form.sub_type || "GENERAL",
      amount: form.amount || "0",
      cycle: form.billing_cycle || "MONTHLY",
      billing_cycle: form.billing_cycle || "MONTHLY",
      next_due: form.renewal_or_expiry_date || null,
      renewal_or_expiry_date: form.renewal_or_expiry_date || null,
      payment_account_id: form.payment_account_id || null,
      account_id: form.payment_account_id || null,
    };
  }
  if (mt === "DOCUMENT") {
    return {
      ...base,
      name: form.name,
      type: form.sub_type || "GENERAL",
      sub_type: form.sub_type || "GENERAL",
      category: form.category || "GENERAL",
      amount: form.amount || "0",
      expiry_date: form.renewal_or_expiry_date || null,
      renewal_or_expiry_date: form.renewal_or_expiry_date || null,
      member_id: form.member_id || null,
      reference: form.reference || null,
    };
  }
  if (mt === "PROPERTY") {
    // UI: secondary_amount = valuation, amount = rental income — never treat rent as value.
    const valuation =
      form.secondary_amount != null && String(form.secondary_amount).trim() !== ""
        ? form.secondary_amount
        : form.value != null && String(form.value).trim() !== ""
          ? form.value
          : "0";
    return {
      ...base,
      name: form.name,
      type: form.sub_type || "GENERAL",
      sub_type: form.sub_type || "GENERAL",
      value: valuation,
      secondary_amount: valuation,
      rent_income: form.amount || "0",
      amount: form.amount || "0",
      location: form.provider || null,
      provider: form.provider || null,
      area: form.reference || null,
      reference: form.reference || null,
    };
  }
  return { ...base, name: form.name, amount: form.amount || "0" };
}

export async function loadLifeGroup(apiGet, familyId, moduleTypes, options = {}) {
  const previousItems = Array.isArray(options.previousItems) ? options.previousItems : [];
  const byModule = new Map();
  for (const prev of previousItems) {
    const mt = String(prev.module_type || "").toUpperCase();
    if (!byModule.has(mt)) byModule.set(mt, []);
    byModule.get(mt).push(prev);
  }

  await Promise.all(
    moduleTypes.map(async (mt) => {
      const key = String(mt).toUpperCase();
      const prevForModule = byModule.get(key) || [];
      try {
        const rows = await apiGet(listPath(mt, familyId));
        const list = Array.isArray(rows) ? rows : [];
        // Empty successful GET can be a race after wipe — keep previous non-empty module rows.
        if (list.length === 0 && prevForModule.length > 0) {
          return;
        }
        byModule.set(
          key,
          list.map((row) => normalizeLifeItem(mt, row)),
        );
      } catch {
        // Keep previous rows for this module — never wipe on a single failed GET
      }
    }),
  );

  const items = [];
  moduleTypes.forEach((mt) => {
    items.push(...(byModule.get(String(mt).toUpperCase()) || []));
  });
  return items;
}
