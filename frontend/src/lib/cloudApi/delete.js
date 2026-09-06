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

export async function cloudApiDelete({ familyId, path, onAfterWrite, currentUser }) {
  if (!familyId) return { handled: false };
  const clean = stripQuery(path);
  const parts = clean.replace(/^\//, "").split("/").filter(Boolean);
  const after = typeof onAfterWrite === "function" ? onAfterWrite : async () => {};

  // Remove family member (Owner only when Firestore is available)
  if (parts[0] === "families" && parts[1] === familyId && parts[2] === "members" && parts[3]) {
    const memberId = String(parts[3] || "").trim();
    const actorUid = String(
      currentUser?.uid || currentUser?.firebase_uid || currentUser?.id || "",
    ).trim();
    if (!memberId) {
      return { handled: true, data: { ok: false, detail: "member id required" }, error: "member id required" };
    }
    if (actorUid && memberId === actorUid) {
      return {
        handled: true,
        data: { ok: false, detail: "Cannot remove yourself" },
        error: "Cannot remove yourself",
      };
    }
    let cloudSyncWarning = null;
    try {
      const { removeFamilyCloudMember } = await import("../../firebase/familyCloud");
      await removeFamilyCloudMember({ familyId, memberUid: memberId, actorUid });
    } catch (err) {
      const msg = String(err?.message || "Remove member failed");
      if (/Only OWNER|Cannot remove|permission|denied|required/i.test(msg)) {
        return { handled: true, data: { ok: false, detail: msg }, error: msg };
      }
      cloudSyncWarning = `Removed locally — cloud member remove failed: ${msg}`;
    }
    const rows = await readList(familyId, "family", "members");
    const next = rows.filter((raw) => {
      const ids = [raw.member_id, raw.id, raw.uid, raw.user_id].filter(Boolean).map(String);
      return !ids.includes(memberId);
    });
    await writeList(familyId, "family", "members", next);
    await appendAudit(familyId, { action: "MEMBER_REMOVE", member_id: memberId });
    await after();
    return {
      handled: true,
      data: {
        ok: true,
        member_id: memberId,
        cloud_synced: !cloudSyncWarning,
        cloud_sync_warning: cloudSyncWarning,
      },
    };
  }

  if (parts[0] === "tasks" && parts[1]) {
    const taskId = String(parts[1]);
    const rows = await readList(familyId, "planner", "tasks");
    await writeList(
      familyId,
      "planner",
      "tasks",
      rows.filter((r) => String(r.id) !== taskId),
    );
    await after();
    return { handled: true, data: { ok: true } };
  }
  if (parts[0] === "calendar" && parts[1]) {
    const eventId = String(parts[1]);
    const rows = await readList(familyId, "planner", "events");
    await writeList(
      familyId,
      "planner",
      "events",
      rows.filter((r) => String(r.id) !== eventId),
    );
    await after();
    return { handled: true, data: { ok: true } };
  }
  if (parts[0] === "grocery" && parts[1] === "items" && parts[2]) {
    const itemId = String(parts[2]);
    const rows = await readList(familyId, "grocery", "items");
    await writeList(
      familyId,
      "grocery",
      "items",
      rows.filter((r) => String(r.id) !== itemId),
    );
    await after();
    return { handled: true, data: { ok: true } };
  }

  if (parts[0] === "tags" && parts[1]) {
    const rows = await readList(familyId, "finance", "tags");
    await writeList(
      familyId,
      "finance",
      "tags",
      rows.filter((r) => String(r.id) !== String(parts[1])),
    );
    const links = await readList(familyId, "finance", "transactionTags");
    await writeList(
      familyId,
      "finance",
      "transactionTags",
      links.filter((r) => String(r.tag_id) !== String(parts[1])),
    );
    await after();
    return { handled: true, data: { ok: true } };
  }

  if (parts[0] === "transaction-tags" && parts[1]) {
    const links = await readList(familyId, "finance", "transactionTags");
    await writeList(
      familyId,
      "finance",
      "transactionTags",
      links.filter((r) => String(r.id) !== String(parts[1])),
    );
    await after();
    return { handled: true, data: { ok: true } };
  }

  if (parts[0] === "accounts" && parts[1]) {
    const rows = await readList(familyId, "finance", "wallets");
    const now = new Date().toISOString();
    const next = rows.map((r) =>
      String(r.id) === String(parts[1])
        ? { ...r, is_active: false, deleted_at: now, updated_at: now }
        : r,
    );
    await writeList(familyId, "finance", "wallets", next);
    await after();
    return { handled: true, data: { success: true, message: "Wallet deleted" } };
  }

  if (parts[0] === "notifications" && parts[1] && !parts[2]) {
    const rows = await readList(familyId, "system", "notifications");
    await writeList(
      familyId,
      "system",
      "notifications",
      rows.filter((r) => r.id !== parts[1]),
    );
    await after();
    return { handled: true, data: { ok: true } };
  }

  if (parts[0] === "notifications" && parts[1] === "devices" && parts[2]) {
    const rows = await readList(familyId, "system", "pushDevices");
    await writeList(
      familyId,
      "system",
      "pushDevices",
      rows.filter((r) => r.id !== parts[2]),
    );
    await after();
    return { handled: true, data: { ok: true } };
  }

  return { handled: false };
}

/** Seed empty module stores for a new cloud family (does not wipe existing data). */
