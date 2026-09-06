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

export async function cloudApiPatch({ familyId, path, body, onAfterWrite, currentUser }) {
  if (!familyId) return { handled: false };
  const clean = stripQuery(path);
  const parts = clean.replace(/^\//, "").split("/").filter(Boolean);
  const after = typeof onAfterWrite === "function" ? onAfterWrite : async () => {};

  if (parts[0] === "budgets" && parts[1] && !parts[2]) {
    const existing = await readBudgets(familyId);
    const cats = await readList(familyId, "finance", "categories");
    const id = String(parts[1]);
    const target = existing.find((b) => String(b.id) === id);
    if (!target) {
      return { handled: true, data: { ok: false, detail: "not found" }, error: "not found" };
    }
    const nextCategory = body?.category_id ?? target.category_id;
    const nextPeriod = body?.period_type || target.period_type || "MONTHLY";
    const dupKey = budgetDuplicateKey({ category_id: nextCategory, period_type: nextPeriod });
    const dup = existing.find(
      (b) =>
        String(b.id) !== id &&
        String(b.status || "").toUpperCase() === "ACTIVE" &&
        budgetDuplicateKey(b) === dupKey,
    );
    if (dup) {
      return {
        handled: true,
        data: { ok: false, detail: "Duplicate active budget for category/period" },
        error: "Duplicate active budget for category/period",
      };
    }
    const cat = cats.find((c) => String(c.id) === String(nextCategory));
    const next = existing.map((b) =>
      String(b.id) === id
        ? {
            ...b,
            name: body?.name != null ? String(body.name).trim() : b.name,
            budget_amount:
              body?.budget_amount != null ? Number(body.budget_amount) : Number(b.budget_amount || 0),
            note: body?.note != null ? body.note : b.note,
            category_id: nextCategory,
            category_name: cat?.name_en || cat?.name || b.category_name || "",
            period_type: nextPeriod,
            updated_at: new Date().toISOString(),
          }
        : b,
    );
    await writeBudgets(familyId, next);
    await after();
    return { handled: true, data: next.find((b) => String(b.id) === id) };
  }

  if (parts[0] === "savings" && parts[1] && !parts[2]) {
    const existing = normalizeSavingsList(await readList(familyId, "finance", "savings"));
    const id = String(parts[1]);
    const next = existing.map((g) =>
      String(g.id) === id
        ? {
            ...g,
            name: body?.name != null ? String(body.name).trim() : g.name,
            target_amount: body?.target_amount != null ? Number(body.target_amount) : Number(g.target_amount || 0),
            note: body?.note != null ? body.note : g.note,
            updated_at: new Date().toISOString(),
          }
        : g,
    );
    const txs = await readList(familyId, "finance", "transactions");
    const enriched = recomputeSavingsFromLedger(next, txs);
    await writeList(familyId, "finance", "savings", enriched);
    await after();
    return { handled: true, data: enriched.find((g) => String(g.id) === id) };
  }

  if (parts[0] === "loans" && parts[1] && !parts[2]) {
    const existing = await readList(familyId, "finance", "loans");
    const id = String(parts[1]);
    const next = existing.map((loan) =>
      String(loan.id) === id
        ? {
            ...loan,
            person_name:
              body?.person_name != null ? String(body.person_name).trim() : loan.person_name,
            note: body?.note != null ? body.note : loan.note,
            updated_at: new Date().toISOString(),
          }
        : loan,
    );
    await writeList(familyId, "finance", "loans", next);
    await after();
    return { handled: true, data: next.find((l) => String(l.id) === id) };
  }

  if (parts[0] === "goals" && parts[1] && !parts[2]) {
    const existing = await readList(familyId, "finance", "goals");
    const id = String(parts[1]);
    const txs = await readList(familyId, "finance", "transactions");
    const nextRaw = existing.map((goal) =>
      String(goal.id) === id
        ? {
            ...goal,
            goal_name:
              body?.goal_name != null ? String(body.goal_name).trim() : goal.goal_name,
            name: body?.goal_name != null ? String(body.goal_name).trim() : goal.name,
            goal_type: body?.goal_type != null ? body.goal_type : goal.goal_type,
            target_amount:
              body?.target_amount != null ? Number(body.target_amount) : Number(goal.target_amount || 0),
            target_date: body?.target_date !== undefined ? body.target_date : goal.target_date,
            note: body?.note != null ? body.note : goal.note,
            updated_at: new Date().toISOString(),
          }
        : goal,
    );
    const next = recomputeGoalsFromLedger(nextRaw, txs);
    await writeList(familyId, "finance", "goals", next);
    await writeDoc(familyId, "finance", "goalSummary", buildGoalSummary(next));
    await after();
    return { handled: true, data: next.find((g) => String(g.id) === id) };
  }

  if (parts[0] === "recurring" && parts[1] && !parts[2]) {
    const existing = await readList(familyId, "finance", "recurring");
    const id = String(parts[1]);
    const next = existing.map((row) =>
      String(row.id) === id
        ? {
            ...row,
            title: body?.title != null ? String(body.title).trim() : row.title,
            amount: body?.amount != null ? Number(body.amount) : Number(row.amount || 0),
            frequency: body?.frequency != null ? body.frequency : row.frequency,
            end_date: body?.end_date !== undefined ? body.end_date : row.end_date,
            description: body?.description != null ? body.description : row.description,
            updated_at: new Date().toISOString(),
          }
        : row,
    );
    await writeList(familyId, "finance", "recurring", next);
    await after();
    return { handled: true, data: next.find((r) => String(r.id) === id) };
  }

  // Family settings (currency / timezone) — Owner/Admin with settings.manage
  if (
    parts[0] === "families" &&
    parts[1] === familyId &&
    (parts[2] === "settings" || parts[2] === "currency")
  ) {
    const nextCurrency = String(
      body?.default_currency || body?.currency || "",
    )
      .trim()
      .toUpperCase();
    const nextTimezone = String(body?.timezone || "").trim();

    if (parts[2] === "settings" && !nextCurrency && !nextTimezone) {
      return {
        handled: true,
        data: { ok: false, detail: "No settings provided" },
        error: "No settings provided",
      };
    }
    if (parts[2] === "currency" && !nextCurrency) {
      return {
        handled: true,
        data: { ok: false, detail: "Invalid currency code" },
        error: "Invalid currency code",
      };
    }

    // OWNER / ADMIN always have settings.manage in cloud mode
    const members = await loadPermissionMembers(familyId);
    const me = findCurrentMember(members, currentUser);
    const myUid = String(currentUser?.uid || currentUser?.firebase_uid || currentUser?.id || "").trim();
    const ownerUid = await resolveFamilyOwnerUid(familyId, currentUser, members);
    const role = preferElevatedRole(
      normalizeMemberRole(me || {}),
      myUid && ownerUid && myUid === ownerUid ? "OWNER" : "",
    );
    const effective = me?.effective_permissions || defaultPermissionsForRole(role || "MEMBER");
    const canManage =
      role === "OWNER" ||
      role === "ADMIN" ||
      effective.includes("*") ||
      effective.includes("settings.manage");
    if (!canManage) {
      const err = new Error("Permission denied: settings.manage");
      err.status = 403;
      err.isPermission = true;
      throw err;
    }

    const profile = await readDoc(familyId, "system", "familyProfile", {
      id: familyId,
      default_currency: "BDT",
      timezone: "Asia/Dhaka",
    });
    const currencyBag = await readDoc(familyId, "system", "currency", {
      code: "BDT",
      symbol: "BDT",
    });

    const oldCurrency = profile.default_currency || currencyBag.code || "BDT";
    const oldTimezone = profile.timezone || "Asia/Dhaka";
    const appliedCurrency = nextCurrency || oldCurrency;
    const appliedTimezone = nextTimezone || oldTimezone;

    await writeDoc(familyId, "system", "familyProfile", {
      ...profile,
      id: familyId,
      default_currency: appliedCurrency,
      currency: appliedCurrency,
      timezone: appliedTimezone,
      updated_at: new Date().toISOString(),
      source: "cloud_local",
    });
    await writeDoc(familyId, "system", "currency", {
      ...currencyBag,
      code: appliedCurrency,
      symbol: currencyBag.symbol || appliedCurrency,
      currencySummary: {
        ...(currencyBag.currencySummary || {}),
        base_currency: appliedCurrency,
        source: "cloud_local",
      },
      updated_at: new Date().toISOString(),
    });

    await appendAudit(familyId, {
      action: "FAMILY_SETTINGS_UPDATE",
      default_currency: appliedCurrency,
      timezone: appliedTimezone,
    });

    // Persist to Firestore family meta (multi-device)
    let cloudSyncWarning = null;
    try {
      const { updateFamilyCloudSettings } = await import("../../firebase/familyCloud");
      await updateFamilyCloudSettings({
        familyId,
        currency: appliedCurrency,
        timezone: appliedTimezone,
        actorUid: currentUser?.uid || currentUser?.firebase_uid || me?.user_id || me?.uid,
      });
    } catch (err) {
      const msg = String(err?.message || "");
      if (/permission denied/i.test(msg) || /network|unavailable|connection/i.test(msg)) {
        throw err;
      }
      cloudSyncWarning = `Saved on this device only — cloud settings sync failed: ${msg}`;
    }

    await after();
    return {
      handled: true,
      data: {
        success: true,
        family_id: familyId,
        old_currency: oldCurrency,
        new_currency: appliedCurrency,
        old_timezone: oldTimezone,
        new_timezone: appliedTimezone,
        default_currency: appliedCurrency,
        timezone: appliedTimezone,
        source: "cloud_local",
        cloud_synced: !cloudSyncWarning,
        cloud_sync_warning: cloudSyncWarning,
      },
    };
  }

  // Task update
  if (parts[0] === "tasks" && parts[1] && !parts[2]) {
    const taskId = String(parts[1]);
    const rows = await readList(familyId, "planner", "tasks");
    const hit = rows.find((r) => String(r.id) === taskId);
    if (!hit) {
      return { handled: true, data: { ok: false, detail: "Task not found" }, error: "Task not found" };
    }
    const next = rows.map((r) =>
      String(r.id) === taskId
        ? {
            ...r,
            ...body,
            id: r.id,
            status: body?.status ? String(body.status).toUpperCase() : r.status,
            priority: body?.priority ? String(body.priority).toUpperCase() : r.priority,
            updated_at: new Date().toISOString(),
          }
        : r,
    );
    await writeList(familyId, "planner", "tasks", next);
    await after();
    return { handled: true, data: next.find((r) => String(r.id) === taskId) || {} };
  }

  // Calendar update / soft-cancel
  if (parts[0] === "calendar" && parts[1] && !parts[2]) {
    const eventId = String(parts[1]);
    const rows = await readList(familyId, "planner", "events");
    const hit = rows.find((r) => String(r.id) === eventId);
    if (!hit) {
      return { handled: true, data: { ok: false, detail: "Event not found" }, error: "Event not found" };
    }
    const next = rows.map((r) =>
      String(r.id) === eventId
        ? {
            ...r,
            ...body,
            id: r.id,
            status: body?.status ? String(body.status).toUpperCase() : r.status,
            event_type: body?.event_type ? String(body.event_type).toUpperCase() : r.event_type,
            updated_at: new Date().toISOString(),
          }
        : r,
    );
    await writeList(familyId, "planner", "events", next);
    await after();
    return { handled: true, data: next.find((r) => String(r.id) === eventId) || {} };
  }

  // Grocery item buy / unbuy / update
  if (parts[0] === "grocery" && parts[1] === "items" && parts[2]) {
    const itemId = String(parts[2]);
    const action = String(parts[3] || "").toLowerCase();
    const rows = await readList(familyId, "grocery", "items");
    const hit = rows.find((r) => String(r.id) === itemId);
    if (!hit) {
      return { handled: true, data: { ok: false, detail: "Item not found" }, error: "Item not found" };
    }
    const now = new Date().toISOString();
    let patch = { ...body, updated_at: now };
    if (action === "buy" || body?.is_bought === true) {
      const actual = Number(body?.actual_price ?? hit.actual_price ?? hit.estimated_price ?? 0) || 0;
      const vendorName = body?.vendor_name ?? hit.vendor_name ?? null;
      patch = {
        ...patch,
        is_bought: true,
        bought: true,
        actual_price: actual,
        vendor_name: vendorName,
        bought_at: now,
      };
      const history = await readList(familyId, "grocery", "priceHistory");
      await writeList(familyId, "grocery", "priceHistory", [
        {
          id: newId("gph"),
          family_id: familyId,
          name: hit.name,
          item_name: hit.name,
          barcode: hit.barcode || null,
          vendor_name: vendorName,
          price: actual,
          actual_price: actual,
          estimated_price: Number(hit.estimated_price || 0) || 0,
          currency: body?.currency || "BDT",
          purchased_at: now,
          source: "cloud_local",
        },
        ...history,
      ].slice(0, 200));
    } else if (action === "unbuy" || body?.is_bought === false) {
      patch = {
        ...patch,
        is_bought: false,
        bought: false,
        bought_at: null,
      };
    }
    const next = rows.map((r) => (String(r.id) === itemId ? { ...r, ...patch, id: r.id } : r));
    await writeList(familyId, "grocery", "items", next);
    if (action === "buy" || body?.is_bought === true || action === "unbuy" || body?.is_bought === false) {
      await recomputeGroceryVendorSummary(familyId);
      await appendGroceryActivity(familyId, {
        action_type: action === "unbuy" || body?.is_bought === false ? "UNBUY" : "BUY",
        entity_type: "grocery_items",
        title: hit.name,
      });
    }
    await after();
    return { handled: true, data: next.find((r) => String(r.id) === itemId) || {} };
  }

  // Life module update
  const lifeKey = lifeModuleKey(parts[0]);
  if (lifeKey && parts[1] && parts[2] !== "close") {
    const phase = ["INVESTMENT", "HEALTH", "VEHICLE", "EDUCATION"].includes(lifeKey) ? "phase15" : "phase16";
    const bag = await readDoc(familyId, "life", phase, { items: [] });
    const items = Array.isArray(bag.items) ? bag.items : [];
    const itemId = String(parts[1]);
    const nextItems = items.map((r) =>
      String(r.id) === itemId
        ? normalizeLifeWriteRow(lifeKey, body, { ...r, family_id: familyId })
        : r,
    );
    await writeDoc(familyId, "life", phase, {
      items: nextItems,
      summary: buildLifePhaseSummary(nextItems),
    });
    await after();
    return { handled: true, data: nextItems.find((r) => String(r.id) === itemId) || {} };
  }

  if (lifeKey && parts[1] && parts[2] === "close") {
    const phase = ["INVESTMENT", "HEALTH", "VEHICLE", "EDUCATION"].includes(lifeKey) ? "phase15" : "phase16";
    const bag = await readDoc(familyId, "life", phase, { items: [] });
    const items = Array.isArray(bag.items) ? bag.items : [];
    const itemId = String(parts[1]);
    const nextItems = items.map((r) =>
      String(r.id) === itemId
        ? {
            ...r,
            status: "CLOSED",
            updated_at: new Date().toISOString(),
            close_reason: body?.reason || null,
          }
        : r,
    );
    await writeDoc(familyId, "life", phase, {
      items: nextItems,
      summary: buildLifePhaseSummary(nextItems),
    });
    await after();
    return { handled: true, data: nextItems.find((r) => String(r.id) === itemId) || { ok: true } };
  }

  if (parts[0] === "notifications" && parts[1] === "read" && parts[2]) {
    const rows = await readList(familyId, "system", "notifications");
    const next = rows.map((r) =>
      r.id === parts[2] ? { ...r, read: true, is_read: true, updated_at: new Date().toISOString() } : r,
    );
    await writeList(familyId, "system", "notifications", next);
    await after();
    return { handled: true, data: next.find((r) => r.id === parts[2]) || { ok: true } };
  }

  if (parts[0] === "notifications" && parts[1] === "read-all" && parts[2] === familyId) {
    const rows = await readList(familyId, "system", "notifications");
    let marked = 0;
    const next = rows.map((r) => {
      if (r.read || r.is_read) return r;
      marked += 1;
      return { ...r, read: true, is_read: true, updated_at: new Date().toISOString() };
    });
    await writeList(familyId, "system", "notifications", next);
    await after();
    return { handled: true, data: { marked_read: marked } };
  }

  // Family member role / relationship (Owner governance)
  if (parts[0] === "families" && parts[1] === familyId && parts[2] === "accounts" && parts[3] && !parts[4]) {
    const accountId = String(parts[3]);
    const rows = await readList(familyId, "finance", "wallets");
    const next = rows.map((r) =>
      String(r.id) === accountId
        ? {
            ...r,
            ...body,
            id: r.id,
            updated_at: new Date().toISOString(),
          }
        : r,
    );
    await writeList(familyId, "finance", "wallets", next);
    await after();
    return {
      handled: true,
      data: next.find((r) => String(r.id) === accountId) || { ok: true },
    };
  }

  // Family member role / relationship (Owner governance)
  if (parts[0] === "families" && parts[1] === familyId && parts[2] === "members" && parts[3]) {
    const memberId = String(parts[3] || "").trim();
    const action = String(parts[4] || "").trim().toLowerCase();
    const actorUid = String(
      currentUser?.uid || currentUser?.firebase_uid || currentUser?.id || "",
    ).trim();

    const matchesMember = (raw) => {
      const ids = [raw.member_id, raw.id, raw.uid, raw.user_id]
        .filter(Boolean)
        .map((v) => String(v));
      return ids.includes(memberId);
    };

    if (action === "role") {
      const nextRole = String(body?.role || "").trim().toUpperCase();
      if (!nextRole) {
        return { handled: true, data: { ok: false, detail: "role required" }, error: "role required" };
      }
      let cloudSyncWarning = null;
      try {
        const { setFamilyMemberRole } = await import("../../firebase/familyCloud");
        await setFamilyMemberRole({
          familyId,
          memberUid: memberId,
          role: nextRole,
          actorUid,
        });
      } catch (err) {
        const msg = String(err?.message || "Role update failed");
        if (/Only OWNER|permission|denied|required/i.test(msg)) {
          return { handled: true, data: { ok: false, detail: msg }, error: msg };
        }
        cloudSyncWarning = `Saved on this device only — cloud role sync failed: ${msg}`;
      }
      let rows = await readList(familyId, "family", "members");
      let found = false;
      const next = rows.map((raw) => {
        if (!matchesMember(raw)) return raw;
        found = true;
        return {
          ...raw,
          role: nextRole,
          normalized_role: nextRole,
          member_role: nextRole,
          // Role change resets custom overrides so VIEWER/CHILD/MEMBER baselines apply cleanly
          overrides: [],
          permission_overrides: [],
          updated_at: new Date().toISOString(),
        };
      });
      if (!found) {
        next.push({
          id: memberId,
          member_id: memberId,
          user_id: memberId,
          uid: memberId,
          role: nextRole,
          normalized_role: nextRole,
          status: "ACTIVE",
          updated_at: new Date().toISOString(),
          source: "role_patch",
        });
      }
      await writeList(familyId, "family", "members", next);
      await appendAudit(familyId, { action: "MEMBER_ROLE", member_id: memberId, role: nextRole });
      await after();
      return {
        handled: true,
        data: {
          ok: true,
          member_id: memberId,
          role: nextRole,
          cloud_synced: !cloudSyncWarning,
          cloud_sync_warning: cloudSyncWarning,
        },
      };
    }

    if (action === "relationship" || body?.relationship_type || body?.relationship) {
      const relation = String(
        body?.relationship_type || body?.relationship || body?.relationship_display_label || "",
      ).trim();
      if (!relation) {
        return {
          handled: true,
          data: { ok: false, detail: "relationship required" },
          error: "relationship required",
        };
      }
      let cloudSyncWarning = null;
      try {
        const { setFamilyMemberRelationship } = await import("../../firebase/familyCloud");
        await setFamilyMemberRelationship({
          familyId,
          memberUid: memberId,
          relationshipType: relation,
          actorUid,
        });
      } catch (err) {
        const msg = String(err?.message || "Relationship update failed");
        if (/Only OWNER|permission|denied|required/i.test(msg)) {
          return { handled: true, data: { ok: false, detail: msg }, error: msg };
        }
        cloudSyncWarning = `Saved on this device only — cloud relationship sync failed: ${msg}`;
      }
      let rows = await readList(familyId, "family", "members");
      let found = false;
      const next = rows.map((raw) => {
        if (!matchesMember(raw)) return raw;
        found = true;
        return {
          ...raw,
          relationship: relation,
          relationship_type: relation,
          relationship_display_label: relation,
          updated_at: new Date().toISOString(),
        };
      });
      if (!found) {
        next.push({
          id: memberId,
          member_id: memberId,
          user_id: memberId,
          uid: memberId,
          relationship: relation,
          relationship_type: relation,
          relationship_display_label: relation,
          role: "MEMBER",
          status: "ACTIVE",
          updated_at: new Date().toISOString(),
          source: "relationship_patch",
        });
      }
      await writeList(familyId, "family", "members", next);
      await appendAudit(familyId, {
        action: "MEMBER_RELATIONSHIP",
        member_id: memberId,
        relationship: relation,
      });
      await after();
      return {
        handled: true,
        data: {
          ok: true,
          member_id: memberId,
          relationship: relation,
          relationship_type: relation,
          cloud_synced: !cloudSyncWarning,
          cloud_sync_warning: cloudSyncWarning,
        },
      };
    }
  }

  // Member permission override (Owner assigns Allow/Deny)
  if (parts[0] === "permissions" && parts[1] === "members" && parts[2]) {
    const memberId = String(parts[2] || "").trim();
    const actorUid = String(
      currentUser?.uid || currentUser?.firebase_uid || currentUser?.id || "",
    ).trim();
    let rows = await readList(familyId, "family", "members");
    const actor = findCurrentMember(rows, currentUser);
    const ownerUid = await resolveFamilyOwnerUid(familyId, currentUser, rows);
    const actorRole = preferElevatedRole(
      normalizeMemberRole(actor || {}),
      actorUid && ownerUid && actorUid === ownerUid ? "OWNER" : "",
    );
    if (actorRole !== "OWNER" && actorRole !== "ADMIN") {
      return {
        handled: true,
        data: { ok: false, detail: "Only OWNER/ADMIN can change permissions" },
        error: "Only OWNER/ADMIN can change permissions",
      };
    }
    const key = String(body?.permission_key || "").trim();
    if (!key) {
      return { handled: true, data: { ok: false, detail: "permission_key required" }, error: "permission_key required" };
    }
    const allow = body?.allow !== false;
    const scope = body?.scope || "family";

    const matchesMember = (raw) => {
      const ids = [raw.member_id, raw.id, raw.uid, raw.user_id]
        .filter(Boolean)
        .map((v) => String(v));
      return ids.includes(memberId);
    };

    const applyOverride = (raw) => {
      const overrides = Array.isArray(raw.overrides)
        ? [...raw.overrides]
        : Array.isArray(raw.permission_overrides)
          ? [...raw.permission_overrides]
          : [];
      const idx = overrides.findIndex((o) => o.permission_key === key);
      const row = {
        id: overrides[idx]?.id || newId("pov"),
        permission_key: key,
        allow,
        scope,
        updated_at: new Date().toISOString(),
      };
      if (idx >= 0) overrides[idx] = row;
      else overrides.push(row);
      return {
        ...raw,
        member_id: raw.member_id || raw.id || memberId,
        overrides,
        permission_overrides: overrides,
        updated_at: new Date().toISOString(),
      };
    };

    let found = false;
    let next = rows.map((raw) => {
      if (!matchesMember(raw)) return raw;
      found = true;
      return applyOverride(raw);
    });

    if (!found) {
      next = [
        ...next,
        applyOverride({
          id: memberId,
          member_id: memberId,
          user_id: memberId,
          uid: memberId,
          full_name: body?.full_name || "Member",
          email: body?.email || "",
          role: body?.role || "MEMBER",
          relationship: body?.relationship || "",
          status: "ACTIVE",
          source: "permission_upsert",
        }),
      ];
    }

    await writeList(familyId, "family", "members", next);
    await appendAudit(familyId, {
      action: "PERMISSION_OVERRIDE",
      member_id: memberId,
      permission_key: key,
      allow,
    });

    const updated = next.find((r) => matchesMember(r));
    const mapped = mapFamilyMemberPermissions(updated || {});

    // Also write overrides onto Firestore member doc for multi-device truth
    let cloudSyncWarning = null;
    try {
      const { updateFamilyMemberPermissionOverrides } = await import("../../firebase/familyCloud");
      const firestoreUid = String(
        updated?.uid || updated?.user_id || updated?.member_id || memberId,
      );
      await updateFamilyMemberPermissionOverrides({
        familyId,
        memberUid: firestoreUid,
        overrides: mapped.overrides || [],
        actorUid,
      });
    } catch (err) {
      const msg = String(err?.message || "");
      if (/Only OWNER|permission|denied|Actor/i.test(msg)) {
        return { handled: true, data: { ok: false, detail: msg }, error: msg };
      }
      cloudSyncWarning = `Saved on this device only — cloud permissions sync failed: ${msg}`;
    }

    await after();
    return {
      handled: true,
      data: { ...mapped, cloud_synced: !cloudSyncWarning, cloud_sync_warning: cloudSyncWarning },
    };
  }

  return { handled: false };
}

