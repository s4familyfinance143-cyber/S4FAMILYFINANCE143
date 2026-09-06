import {
  normalizeMemberRole,
  resolveFamilyOwnerUid,
  relationshipFromMember,
  newId,
  stripQuery,
  queryParam,
  readList,
  writeList,
  readDoc,
  writeDoc,
  readBudgets,
  writeBudgets,
  appendAudit,
  normalizeAuditRow,
  buildAuditSummary,
  txType,
  activeWallets,
  activeTransactions,
  buildFinancialSummary,
  buildWalletSummary,
  buildAccountLedger,
  buildExtraReport,
  rateToBase,
  buildCurrencyFamilySummary,
  appendNotification,
  appendGroceryActivity,
  recomputeGroceryVendorSummary,
  memberMatchKey,
  cloudMemberToLocal,
  mergeLocalAndCloudMembers,
  mapFamilyMemberPermissions,
  loadPermissionMembers,
  findCurrentMember,
  lifeModuleKey,
  buildLifePhaseSummary,
  normalizeLifeWriteRow
} from "./_core.js";

export async function seedCloudModuleCaches(
  familyId,
  { ownerName, ownerEmail, ownerRelation = "Owner", ownerUid = "", seedAsOwner = false } = {},
) {
  async function ensureList(module, name, fallback) {
    const existing = await loadOfflineSnapshot(familyId, module, name).catch(() => null);
    if (existing?.data !== undefined) return;
    await writeList(familyId, module, name, fallback);
  }
  async function ensureDoc(module, name, fallback) {
    const existing = await loadOfflineSnapshot(familyId, module, name).catch(() => null);
    if (existing?.data !== undefined) return;
    await writeDoc(familyId, module, name, fallback);
  }

  const membersExisting = await loadOfflineSnapshot(familyId, "family", "members").catch(() => null);
  const membersData = membersExisting?.data;
  const membersEmpty = !Array.isArray(membersData) || membersData.length === 0;
  if (membersEmpty) {
    const uid = String(ownerUid || "").trim();
    // Only invent an OWNER row on explicit family create — joiners must not self-seed OWNER
    if (uid && seedAsOwner) {
    const owner = {
        id: uid,
        member_id: uid,
        user_id: uid,
        uid,
      full_name: ownerName || "Owner",
      email: ownerEmail || "",
      role: "OWNER",
        normalized_role: "OWNER",
        relationship: ownerRelation || "Owner",
      relationship_type: ownerRelation || "Owner",
        relationship_display_label: ownerRelation || "Owner",
      status: "ACTIVE",
        overrides: [],
      joined_at: new Date().toISOString(),
      source: "cloud_local",
    };
    await writeList(familyId, "family", "members", [owner]);
    }
  } else if (ownerUid && seedAsOwner) {
    // Heal legacy mem_owner seed → real Firebase uid (create path only)
    const rows = Array.isArray(membersData) ? membersData : [];
    const uid = String(ownerUid).trim();
    const hasUid = rows.some((r) =>
      [r.uid, r.user_id, r.member_id, r.id].filter(Boolean).map(String).includes(uid),
    );
    if (!hasUid && rows.length) {
      const next = rows.map((r) => {
        const role = String(r.role || r.normalized_role || "").toUpperCase();
        const id = String(r.id || r.member_id || "");
        if (role !== "OWNER" && id !== "mem_owner") return r;
        return {
          ...r,
          id: uid,
          member_id: uid,
          user_id: uid,
          uid,
          email: r.email || ownerEmail || "",
          full_name: r.full_name || ownerName || "Owner",
          updated_at: new Date().toISOString(),
        };
      });
      await writeList(familyId, "family", "members", next);
    }
  }

  await ensureList("family", "invites", []);
  await ensureList("family", "joinRequests", []);
  await ensureList("family", "ownershipTransfers", []);
  await ensureList("finance", "wallets", []);
  await ensureList("finance", "transactions", []);
  await ensureList("finance", "categories", [
    { id: "cat_exp_food", name: "Food & Grocery", name_en: "Food & Grocery", category_type: "EXPENSE" },
    { id: "cat_exp_bills", name: "Bills", name_en: "Bills", category_type: "EXPENSE" },
    { id: "cat_exp_transport", name: "Transport", name_en: "Transport", category_type: "EXPENSE" },
    { id: "cat_exp_other", name: "Other expense", name_en: "Other expense", category_type: "EXPENSE" },
    { id: "cat_inc_salary", name: "Salary / Income", name_en: "Salary / Income", category_type: "INCOME" },
    { id: "cat_inc_other", name: "Other income", name_en: "Other income", category_type: "INCOME" },
  ]);
  await ensureList("planner", "tasks", []);
  await ensureList("planner", "events", []);
  await ensureList("grocery", "lists", []);
  await ensureList("grocery", "items", []);
  await ensureList("grocery", "vendors", []);
  await ensureList("grocery", "priceHistory", []);
  await ensureList("grocery", "vendorSummary", []);
  await ensureList("grocery", "activity", []);
  await ensureDoc("life", "phase15", { items: [], summary: { total: 0 } });
  await ensureDoc("life", "phase16", { items: [], summary: { total: 0 } });
  await ensureList("zakat", "main", []);
  await ensureDoc("zakat", "metalRates", {
    GOLD: 12000,
    SILVER: 150,
    updated_at: new Date().toISOString(),
    source: "cloud_local",
  });
  await ensureList("finance", "budgets", []);
  {
    const bud = await loadOfflineSnapshot(familyId, "finance", "budgets").catch(() => null);
    if (bud?.data && !Array.isArray(bud.data)) {
      const nested = bud.data?.data;
      await writeList(familyId, "finance", "budgets", Array.isArray(nested) ? nested : []);
    }
  }
  await ensureList("finance", "savings", []);
  await ensureList("finance", "loans", []);
  await ensureList("finance", "goals", []);
  await ensureDoc("finance", "goalSummary", {
    total_goals: 0,
    active_count: 0,
    active_target_amount: 0,
    active_current_amount: 0,
    source: "cloud_local",
  });
  await ensureList("finance", "recurring", []);
  await ensureList("finance", "tags", []);
  await ensureList("finance", "transactionTags", []);
  await ensureDoc("system", "currency", {
    code: "BDT",
    symbol: "৳",
    currencies: [
      { code: "BDT", name: "Bangladeshi Taka", symbol: "৳", is_base: true },
      { code: "USD", name: "US Dollar", symbol: "$", is_base: false },
      { code: "INR", name: "Indian Rupee", symbol: "₹", is_base: false },
      { code: "SAR", name: "Saudi Riyal", symbol: "﷼", is_base: false },
    ],
    exchangeRates: [
      { from_currency: "USD", to_currency: "BDT", rate: 110, updated_at: new Date().toISOString() },
      { from_currency: "INR", to_currency: "BDT", rate: 1.32, updated_at: new Date().toISOString() },
      { from_currency: "SAR", to_currency: "BDT", rate: 29.3, updated_at: new Date().toISOString() },
    ],
    currencySummary: { base_currency: "BDT", source: "cloud_local" },
  });
  await ensureList("system", "notifications", []);
  await ensureList("system", "pushDevices", []);
  const auditExisting = await loadOfflineSnapshot(familyId, "system", "audit").catch(() => null);
  if (!auditExisting?.data) {
    await writeList(familyId, "system", "audit", [
      {
        id: newId("aud"),
        at: new Date().toISOString(),
        action: "family.created",
        title: "Cloud family ready",
      },
    ]);
  }
}

