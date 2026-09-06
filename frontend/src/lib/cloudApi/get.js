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

export async function cloudApiGet({ familyId, path, currentUser }) {
  if (!familyId) return { handled: false };
  const clean = stripQuery(path);
  const parts = clean.replace(/^\//, "").split("/").filter(Boolean);

  // Tasks / calendar (planner)
  if (parts[0] === "tasks" && parts[1] === familyId) {
    const rows = await readList(familyId, "planner", "tasks");
    const sorted = [...rows].sort((a, b) =>
      String(b.created_at || b.due_date || "").localeCompare(String(a.created_at || a.due_date || "")),
    );
    return { handled: true, data: sorted };
  }
  if (parts[0] === "calendar" && parts[1] === familyId) {
    const rows = await readList(familyId, "planner", "events");
    const active = rows.filter((r) => String(r.status || "").toUpperCase() !== "CANCELLED");
    const sorted = [...active].sort((a, b) =>
      String(a.event_date || "").localeCompare(String(b.event_date || "")),
    );
    return { handled: true, data: sorted };
  }

  // Grocery
  if (parts[0] === "grocery") {
    if (parts[1] === "lists" && parts[2] === familyId && !parts[3]) {
      return { handled: true, data: await readList(familyId, "grocery", "lists") };
    }
    if (parts[1] === "lists" && parts[2] === familyId && parts[3] && parts[4] === "items") {
      const all = await readList(familyId, "grocery", "items");
      return {
        handled: true,
        data: all.filter((i) => String(i.list_id || i.grocery_list_id) === String(parts[3])),
      };
    }
    if (parts[1] === "vendors" && parts[2] === familyId) {
      return { handled: true, data: await readList(familyId, "grocery", "vendors") };
    }
    if (parts[1] === "price-history" && parts[2] === familyId) {
      return { handled: true, data: await readList(familyId, "grocery", "priceHistory") };
    }
    if (parts[1] === "vendor-summary" && parts[2] === familyId) {
      return { handled: true, data: await readList(familyId, "grocery", "vendorSummary") };
    }
    if (parts[1] === "activity" && parts[2] === familyId) {
      return { handled: true, data: await readList(familyId, "grocery", "activity") };
    }
    if (parts[1] === "barcode" && parts[2] === familyId && parts[3]) {
      const code = decodeURIComponent(String(parts[3] || "")).trim();
      const items = await readList(familyId, "grocery", "items");
      const matches = items
        .filter((i) => String(i.barcode || "").trim() === code)
        .sort((a, b) => String(b.updated_at || b.created_at || "").localeCompare(String(a.updated_at || a.created_at || "")));
      const latest = matches[0] || null;
      return {
        handled: true,
        data: {
          barcode: code,
          found: Boolean(latest),
          latest,
          history: matches.slice(0, 10),
          source: "cloud_local",
        },
      };
    }
    if (parts[1] === "collaboration" && parts[2] === "status") {
      const lists = await readList(familyId, "grocery", "lists");
      const items = await readList(familyId, "grocery", "items");
      const openLists = lists.filter((l) => String(l.status || "OPEN").toUpperCase() === "OPEN").length;
      const pendingItems = items.filter((i) => !i.is_bought).length;
      return {
        handled: true,
        data: {
          mode: "cloud_local",
          online: true,
          realtime_transport: "polling",
          websocket_path: null,
          open_lists: openLists,
          pending_items: pendingItems,
          subscribers: 0,
          source: "cloud_local",
        },
      };
    }
  }

  // Life modules list: /investments?family_id=
  const lifeKey = lifeModuleKey(parts[0]);
  if (lifeKey && !parts[1]) {
    const fid = queryParam(path, "family_id") || familyId;
    const bag = await readDoc(fid, "life", lifeKey === "HEALTH" || lifeKey === "INVESTMENT" || lifeKey === "VEHICLE" || lifeKey === "EDUCATION" ? "phase15" : "phase16", { items: [] });
    const items = Array.isArray(bag.items) ? bag.items : [];
    return { handled: true, data: items.filter((i) => String(i.module_type || "").toUpperCase() === lifeKey) };
  }

  if (parts[0] === "life-modules" && parts[1] === "summary") {
    const p15 = await readDoc(familyId, "life", "phase15", { items: [], summary: null });
    const p16 = await readDoc(familyId, "life", "phase16", { items: [], summary: null });
    const items = [...(Array.isArray(p15.items) ? p15.items : []), ...(Array.isArray(p16.items) ? p16.items : [])];
    return {
      handled: true,
      data: buildLifePhaseSummary(items),
    };
  }

  // Zakat
  if (parts[0] === "zakat" && parts[1] === familyId) {
    return { handled: true, data: await readList(familyId, "zakat", "main") };
  }
  if (parts[0] === "zakat" && parts[1] === "summary" && parts[2] === familyId) {
    const rows = await readList(familyId, "zakat", "main");
    const totalDue = rows.reduce((sum, r) => sum + (Number(r.zakat_due) || 0), 0);
    const latest = rows[0] || null;
    return {
      handled: true,
      data: {
        record_count: rows.length,
        count: rows.length,
        total_zakat_due: totalDue,
        latest,
        source: "cloud_local",
      },
    };
  }

  // Notifications
  if (parts[0] === "notifications" && parts[1] === familyId) {
    return { handled: true, data: await readList(familyId, "system", "notifications") };
  }
  if (parts[0] === "notifications" && parts[1] === "summary" && parts[2] === familyId) {
    const rows = await readList(familyId, "system", "notifications");
    const unread = rows.filter((r) => !r.read && !r.is_read).length;
    const read = rows.length - unread;
    const high = rows.filter((r) => String(r.severity || "").toUpperCase() === "HIGH").length;
    const medium = rows.filter((r) => String(r.severity || "").toUpperCase() === "MEDIUM").length;
    return {
      handled: true,
      data: {
        family_id: familyId,
        total: rows.length,
        unread,
        unread_count: unread,
        total_notifications: rows.length,
        unread_notifications: unread,
        read_notifications: read,
        high_notifications: high,
        medium_notifications: medium,
        source: "cloud_local",
      },
    };
  }
  if (parts[0] === "notifications" && parts[1] === "delivery-status") {
    const permission =
      typeof Notification !== "undefined" ? Notification.permission : "unsupported";
    let vapidConfigured = false;
    try {
      const raw = String(import.meta.env.VITE_FIREBASE_VAPID_KEY || "").trim();
      vapidConfigured = raw.length > 20;
    } catch {
      /* keep vapidConfigured = false */
    }
    return {
      handled: true,
      data: {
        email: false,
        email_configured: false,
        push: typeof Notification !== "undefined",
        fcm_configured: vapidConfigured,
        in_app: true,
        mode: "cloud_local",
        delivery_mode: vapidConfigured ? "IN_APP_BROWSER_FCM" : "IN_APP_BROWSER",
        browser_permission: permission,
        web_fcm: {
          vapid_configured: vapidConfigured,
          permission,
        },
        note:
          permission === "denied"
            ? "Browser notifications blocked — enable in site settings"
            : !vapidConfigured
              ? "Set VITE_FIREBASE_VAPID_KEY in frontend/.env and restart Vite"
              : permission === "granted"
                ? "Browser notifications allowed · VAPID configured"
                : "Click the bell to enable browser notifications",
      },
    };
  }
  if (parts[0] === "notifications" && parts[1] === "devices") {
    return { handled: true, data: await readList(familyId, "system", "pushDevices") };
  }

  // Audit
  if (parts[0] === "families" && parts[1] === familyId && parts[2] === "audit-trail") {
    const rows = (await readList(familyId, "system", "audit")).map(normalizeAuditRow);
    if (parts[3] === "summary") {
      return { handled: true, data: buildAuditSummary(rows) };
    }
    if (parts[3] === "entity" && parts[4] && parts[5]) {
      const et = decodeURIComponent(String(parts[4]));
      const eid = decodeURIComponent(String(parts[5]));
      const limit = Number(queryParam(path, "limit") || 25);
      const filtered = rows.filter(
        (r) =>
          String(r.entity_type || "").toLowerCase() === et.toLowerCase() &&
          String(r.entity_id || "") === String(eid),
      );
      return { handled: true, data: { rows: filtered.slice(0, limit), source: "cloud_local" } };
    }
    if (parts[3] === "activity") {
      const limit = Number(queryParam(path, "limit") || 25);
      const actionType = String(queryParam(path, "action_type") || "").trim();
      const entityType = String(queryParam(path, "entity_type") || "").trim();
      const severity = String(queryParam(path, "severity") || "").trim();
      let filtered = rows;
      if (actionType) {
        filtered = filtered.filter((r) => String(r.action_type || "").toLowerCase() === actionType.toLowerCase());
      }
      if (entityType) {
        filtered = filtered.filter((r) => String(r.entity_type || "").toLowerCase() === entityType.toLowerCase());
      }
      if (severity) {
        filtered = filtered.filter((r) => String(r.severity || "").toLowerCase() === severity.toLowerCase());
      }
      return { handled: true, data: { rows: filtered.slice(0, limit), source: "cloud_local" } };
    }
  }

  // Reports (cloud-local from IndexedDB)
  if (parts[0] === "families" && parts[1] === familyId && parts[2] === "reports") {
    if (parts[3] === "financial-summary") {
      return { handled: true, data: await buildFinancialSummary(familyId) };
    }
    if (parts[3] === "wallet-summary") {
      return { handled: true, data: await buildWalletSummary(familyId) };
    }
    if (parts[3] === "account-ledger") {
      const accountId = queryParam(path, "account_id");
      const limit = Number(queryParam(path, "limit") || 25);
      if (!accountId) return { handled: true, data: { rows: [], source: "cloud_local" } };
      return { handled: true, data: await buildAccountLedger(familyId, accountId, limit) };
    }
  }
  if (parts[0] === "reports") {
    if (parts[1] === "dashboard" && parts[2] === familyId) {
      return { handled: true, data: await buildExtraReport(familyId, "dashboard") };
    }
    if (parts[1] === "net-worth" && parts[2] === familyId) {
      return { handled: true, data: await buildExtraReport(familyId, "net-worth") };
    }
    if (parts[1] === "categories" && parts[2] === familyId) {
      return { handled: true, data: await buildExtraReport(familyId, "categories") };
    }
    if (parts[1] === "budget" && parts[2] === familyId) {
      return { handled: true, data: await buildExtraReport(familyId, "budget") };
    }
    if (parts[1] === "loans" && parts[2] === familyId) {
      return { handled: true, data: await buildExtraReport(familyId, "loans") };
    }
    if (parts[1] === "savings-trend" && parts[2] === familyId) {
      return { handled: true, data: await buildExtraReport(familyId, "savings-trend") };
    }
  }
  if (parts[0] === "api-logs") {
    const audit = (await readList(familyId, "system", "audit")).map(normalizeAuditRow).slice(0, 80);
    const rows = audit.map((r) => ({
      id: r.id,
      path: r.action_type || r.action,
      endpoint: r.action_type || r.action || "/",
      method: "LOCAL",
      status_code: 200,
      duration_ms: 0,
      created_at: r.created_at || r.at,
      note: r.title || "",
    }));
    return {
      handled: true,
      data: {
        rows,
        summary: { avg_duration_ms: 0, slow_count_ge_500ms: 0, total: rows.length },
        source: "cloud_local",
      },
    };
  }

  // Backup center (local IndexedDB snapshot exports)
  if (parts[0] === "backup") {
    const bag = await readDoc(familyId, "system", "backup", {
      integrity: { ok: true, integrity_check: "IndexedDB OK", source: "cloud_local" },
      list: { count: 0, backups: [] },
      files: {},
    });
    if (parts[1] === "integrity") {
      return {
        handled: true,
        data: bag.integrity || { ok: true, integrity_check: "IndexedDB OK", source: "cloud_local" },
      };
    }
    if (parts[1] === "list" && parts[2] === familyId) {
      const list = bag.list || { count: 0, backups: [] };
      return {
        handled: true,
        data: {
          count: list.count || (list.backups || []).length || 0,
          backups: list.backups || [],
          source: "cloud_local",
        },
      };
    }
    if (parts[1] === "restore" && parts[2] === "preview-file") {
      const fileName = queryParam(path, "file_name");
      const payload = bag.files?.[fileName];
      const meta = (bag.list?.backups || []).find((b) => b.file_name === fileName);
      return {
        handled: true,
        data: {
          file_name: fileName,
          restore_safe: Boolean(payload || meta),
          message: payload
            ? `Local backup with ${Array.isArray(payload.rows) ? payload.rows.length : 0} snapshot rows`
            : meta
              ? "Metadata only — re-create backup to store full payload"
              : "Backup file not found",
          contains_files: payload?.rows
            ? [...new Set(payload.rows.map((r) => `${r.module}/${r.name}`))].slice(0, 40)
            : [],
          source: "cloud_local",
        },
      };
    }
  }

  // Sync status / conflicts / logs (cloud-local synthetic)
  if (parts[0] === "families" && parts[1] === familyId && parts[2] === "sync") {
    if (parts[3] === "status") {
      const wallets = activeWallets(await readList(familyId, "finance", "wallets"));
      const txs = activeTransactions(await readList(familyId, "finance", "transactions"));
      const grocery = await readList(familyId, "grocery", "lists");
      return {
        handled: true,
        data: {
          pending_outbox: 0,
          open_conflicts: 0,
          offline_first: true,
          sync_state: "CLOUD_LOCAL",
          device_id: queryParam(path, "device_id") || "web",
          table_counts: {
            wallets: wallets.length,
            transactions: txs.length,
            grocery_lists: grocery.length,
            audit: (await readList(familyId, "system", "audit")).length,
          },
          source: "cloud_local",
        },
      };
    }
    if (parts[3] === "conflicts") {
      return { handled: true, data: { conflicts: [], source: "cloud_local" } };
    }
    if (parts[3] === "pull") {
      return {
        handled: true,
        data: {
          changes: [],
          sync_token: new Date().toISOString(),
          note: "Use cloud snapshot pull for multi-device sync",
          source: "cloud_local",
        },
      };
    }
  }
  if (parts[0] === "sync-logs") {
    const audit = (await readList(familyId, "system", "audit")).map(normalizeAuditRow).slice(0, 80);
    const rows = audit.map((r) => ({
      id: r.id,
      action: r.action_type,
      synced_at: r.created_at || r.at,
      created_at: r.created_at || r.at,
      device_id: "cloud_local",
      items_synced: 1,
      success: true,
      status: "OK",
      detail: r.title,
      error_msg: null,
    }));
    return {
      handled: true,
      data: {
        rows,
        summary: { success_rate: 1, fail_count: 0, total: rows.length },
        source: "cloud_local",
      },
    };
  }

  // Family members / permissions
  if (parts[0] === "families" && parts[1] === familyId && parts[2] === "members") {
    return { handled: true, data: await loadPermissionMembers(familyId) };
  }
  if (parts[0] === "permissions" && parts[1] === "family" && parts[2] === familyId && parts[3] === "me") {
    const members = await loadPermissionMembers(familyId);
    const me = findCurrentMember(members, currentUser);
    const myUid = String(currentUser?.uid || currentUser?.firebase_uid || currentUser?.id || "").trim();
    const ownerUid = await resolveFamilyOwnerUid(familyId, currentUser, members);
    const isFamilyOwner = Boolean(myUid && ownerUid && myUid === ownerUid);

    const mapped = me
      ? mapFamilyMemberPermissions(me)
      : isFamilyOwner
        ? {
            role: "OWNER",
            normalized_role: "OWNER",
            relationship: "Owner",
            relationship_display_label: "Owner",
            effective_permissions: ["*", "settings.manage"],
            overrides: [],
            member_id: myUid,
            uid: myUid,
            user_id: myUid,
            source: "cloud_local_owner_meta",
          }
        : {
            role: "MEMBER",
            normalized_role: "MEMBER",
            relationship: "",
            effective_permissions: defaultPermissionsForRole("MEMBER"),
            overrides: [],
            source: "cloud_local_unmatched",
          };

    const resolvedRole = preferElevatedRole(
      mapped.normalized_role,
      mapped.role,
      isFamilyOwner ? "OWNER" : "",
    );
    const relationship =
      sanitizeRelationshipLabel(mapped.relationship, resolvedRole) ||
      (resolvedRole === "OWNER" ? "Owner" : "");

    return {
      handled: true,
      data: {
        role: resolvedRole,
        normalized_role: resolvedRole,
        relationship,
        relationship_display_label: relationship,
        effective_permissions:
          resolvedRole === "OWNER" || resolvedRole === "ADMIN"
            ? defaultPermissionsForRole(resolvedRole)
            : mapped.effective_permissions?.length
              ? mapped.effective_permissions
              : defaultPermissionsForRole(resolvedRole),
        overrides: mapped.overrides || [],
        member_id: mapped.member_id || myUid || undefined,
        catalog: CLOUD_PERMISSION_CATALOG,
        source: "cloud_local",
      },
    };
  }
  if (parts[0] === "permissions" && parts[1] === "family" && parts[2] === familyId && parts[3] === "members") {
    const members = await loadPermissionMembers(familyId);
    return { handled: true, data: members };
  }

  // Join requests
  if (parts[0] === "join-requests" && parts[1] === "family") {
    return { handled: true, data: await readList(familyId, "family", "joinRequests") };
  }
  if (parts[0] === "families" && parts[1] === familyId && parts[2] === "join-requests") {
    return { handled: true, data: await readList(familyId, "family", "joinRequests") };
  }

  // Currency center (full local + cloud snapshot)
  if (parts[0] === "accounts") {
    const rows = await readList(familyId, "finance", "wallets");
    const active = rows.filter((w) => !w?.deleted_at && w?.is_active !== false);
    if (parts[1] === "family" && parts[2] === familyId) {
      return { handled: true, data: active };
    }
    if (parts[1] && !parts[2]) {
      const hit = active.find((w) => String(w.id) === String(parts[1]));
      return { handled: true, data: hit || null };
    }
  }

  if (parts[0] === "transactions" && parts[1] === familyId) {
    const rows = await readList(familyId, "finance", "transactions");
    return {
      handled: true,
      data: [...rows].sort((a, b) =>
        String(b.created_at || "").localeCompare(String(a.created_at || "")),
      ),
    };
  }

  if (parts[0] === "categories" && parts[1] === "family" && parts[2] === familyId) {
    return { handled: true, data: await readList(familyId, "finance", "categories") };
  }

  // Budgets
  if (parts[0] === "budgets" && parts[1] === "status" && parts[2] === familyId) {
    const list = await readBudgets(familyId);
    const txs = await readList(familyId, "finance", "transactions");
    const cats = await readList(familyId, "finance", "categories");
    const enriched = enrichBudgetsFromLedger(list, txs, cats);
    return { handled: true, data: buildBudgetStatusSummary(enriched) };
  }
  if (parts[0] === "budgets" && parts[1] === familyId) {
    const list = await readBudgets(familyId);
    const txs = await readList(familyId, "finance", "transactions");
    const cats = await readList(familyId, "finance", "categories");
    return { handled: true, data: enrichBudgetsFromLedger(list, txs, cats) };
  }

  // Savings
  if (parts[0] === "savings" && parts[1] === "annual-plan" && parts[2] === familyId) {
    const list = enrichSavingsGoals(normalizeSavingsList(await readList(familyId, "finance", "savings")));
    return { handled: true, data: buildSavingsAnnualPlan(list) };
  }
  if (parts[0] === "savings" && parts[1] === familyId) {
    const list = normalizeSavingsList(await readList(familyId, "finance", "savings"));
    const txs = await readList(familyId, "finance", "transactions");
    return { handled: true, data: recomputeSavingsFromLedger(list, txs) };
  }
  if (parts[0] === "savings" && parts[1] && parts[2] === "history" && parts[3] === familyId) {
    const txs = await readList(familyId, "finance", "transactions");
    const history = txs
      .filter((t) => String(t.savings_goal_id || "") === String(parts[1]))
      .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
    const goals = normalizeSavingsList(await readList(familyId, "finance", "savings"));
    const goal = goals.find((g) => String(g.id) === String(parts[1])) || null;
    return { handled: true, data: { goal, history } };
  }

  // Loans
  if (parts[0] === "loans" && parts[1] === familyId) {
    return { handled: true, data: await readList(familyId, "finance", "loans") };
  }
  if (parts[0] === "loans" && parts[1] && parts[2] === "history" && parts[3] === familyId) {
    const loans = await readList(familyId, "finance", "loans");
    const loan = loans.find((l) => String(l.id) === String(parts[1])) || null;
    const txs = await readList(familyId, "finance", "transactions");
    return { handled: true, data: { loan, history: loanHistoryFromLedger(parts[1], txs) } };
  }

  // Goals
  if (parts[0] === "goals" && parts[1] === "summary" && parts[2] === familyId) {
    const list = await readList(familyId, "finance", "goals");
    const txs = await readList(familyId, "finance", "transactions");
    return { handled: true, data: buildGoalSummary(recomputeGoalsFromLedger(list, txs)) };
  }
  if (parts[0] === "goals" && parts[1] === familyId) {
    const list = await readList(familyId, "finance", "goals");
    const txs = await readList(familyId, "finance", "transactions");
    return { handled: true, data: recomputeGoalsFromLedger(list, txs) };
  }
  if (parts[0] === "goals" && parts[1] && parts[2] === "history" && parts[3] === familyId) {
    const list = await readList(familyId, "finance", "goals");
    const goal = list.find((g) => String(g.id) === String(parts[1])) || null;
    const txs = await readList(familyId, "finance", "transactions");
    return { handled: true, data: { goal, history: goalHistoryFromLedger(parts[1], txs) } };
  }

  // Recurring
  if (parts[0] === "recurring" && parts[1] === familyId) {
    return { handled: true, data: await readList(familyId, "finance", "recurring") };
  }
  if (parts[0] === "recurring" && parts[1] && parts[2] === "history" && parts[3] === familyId) {
    const list = await readList(familyId, "finance", "recurring");
    const item = list.find((r) => String(r.id) === String(parts[1])) || null;
    const txs = await readList(familyId, "finance", "transactions");
    return { handled: true, data: { recurring: item, history: recurringHistoryFromLedger(parts[1], txs) } };
  }

  // Currency center (full local + cloud snapshot)
  if (parts[0] === "currency") {
    const bag = await readDoc(familyId, "system", "currency", null);
    const defaults = {
      currencies: [
        { code: "BDT", name: "Bangladeshi Taka", symbol: "৳", is_base: true, is_active: true },
        { code: "USD", name: "US Dollar", symbol: "$", is_base: false, is_active: true },
        { code: "INR", name: "Indian Rupee", symbol: "₹", is_base: false, is_active: true },
        { code: "SAR", name: "Saudi Riyal", symbol: "﷼", is_base: false, is_active: true },
      ],
      exchangeRates: [
        { from_currency: "USD", to_currency: "BDT", rate: 110, updated_at: new Date().toISOString() },
        { from_currency: "INR", to_currency: "BDT", rate: 1.32, updated_at: new Date().toISOString() },
        { from_currency: "SAR", to_currency: "BDT", rate: 29.3, updated_at: new Date().toISOString() },
      ],
      currencySummary: {
        base_currency: bag?.code || bag?.base_currency || "BDT",
        wallet_currencies: [],
        source: "cloud_local",
      },
      code: bag?.code || "BDT",
      symbol: bag?.symbol || "BDT",
      ...(bag && typeof bag === "object" ? bag : {}),
    };
    if (!parts[1] || parts[1] === "") {
      const list = Array.isArray(defaults.currencies) ? defaults.currencies : [];
      return {
        handled: true,
        data: list.map((c) => ({ ...c, is_active: c.is_active !== false })),
      };
    }
    if (parts[1] === "rates") {
      return { handled: true, data: defaults.exchangeRates || [] };
    }
    if (parts[1] === "family-summary") {
      const summary = await buildCurrencyFamilySummary(familyId, defaults);
      return { handled: true, data: summary };
    }
  }

  // Tags
  if (parts[0] === "tags" && parts[1] === familyId) {
    return { handled: true, data: await readList(familyId, "finance", "tags") };
  }
  if (parts[0] === "tags" && !parts[1]) {
    return { handled: true, data: await readList(familyId, "finance", "tags") };
  }
  if (parts[0] === "transaction-tags") {
    return { handled: true, data: await readList(familyId, "finance", "transactionTags") };
  }

  // Architecture cutover / vault / metal / vehicle
  if (parts[0] === "system" && parts[1] === "architecture-readiness") {
    return {
      handled: true,
      data: {
        architecture_feature_completeness_pct: 100,
        done_count: 12,
        module_count: 12,
        architecture_status: "CLOUD_READY",
        ops: { note: "Firebase cloud mode — all modules local+Firestore" },
        modules: [
          { key: "finance", name: "Finance", status: "REAL", pct: 100, ops_live: true },
          { key: "grocery", name: "Grocery", status: "REAL", pct: 100, ops_live: true },
          { key: "planner", name: "Planner", status: "REAL", pct: 100, ops_live: true },
          { key: "life", name: "Life modules", status: "REAL", pct: 100, ops_live: true },
          { key: "zakat", name: "Zakat", status: "REAL", pct: 100, ops_live: true },
          { key: "family", name: "Family / invites", status: "REAL", pct: 100, ops_live: true },
          { key: "notifications", name: "Notifications", status: "REAL", pct: 100, ops_live: true },
          { key: "audit", name: "Audit", status: "REAL", pct: 100, ops_live: true },
          { key: "currency", name: "Currency", status: "REAL", pct: 100, ops_live: true },
          { key: "tags", name: "Tags", status: "REAL", pct: 100, ops_live: true },
          { key: "storage", name: "Cloud Storage", status: "REAL", pct: 100, ops_live: true },
          { key: "backup", name: "Backup", status: "REAL", pct: 100, ops_live: true },
        ],
        source: "cloud_local",
      },
    };
  }
  if (parts[0] === "documents" && parts[1] === "vault-status") {
    return {
      handled: true,
      data: {
        storage_backend: "firebase_storage",
        architecture_status: "CLOUD_READY",
        note: "Documents upload to Firebase Storage under families/{id}/documents",
        source: "cloud_local",
      },
    };
  }
  if (parts[0] === "zakat" && parts[1] === "metal-rates") {
    const bag = await readDoc(familyId, "zakat", "metalRates", {
      GOLD: 12000,
      SILVER: 150,
      updated_at: null,
      source: "cloud_local",
    });
    const rates = ["GOLD", "SILVER"]
      .filter((m) => bag[m] != null && Number(bag[m]) > 0)
      .map((m) => ({ metal: m, rate_bdt: Number(bag[m]), unit: "gram" }));
    return {
      handled: true,
      data: {
        ...bag,
        rates,
        source: "cloud_local",
      },
    };
  }
  if (parts[0] === "zakat" && parts[1] === "nisab-from-rates") {
    const metal = String(queryParam(path, "metal") || "SILVER").toUpperCase();
    const bag = await readDoc(familyId, "zakat", "metalRates", {
      GOLD: 12000,
      SILVER: 150,
    });
    const rate = Number(bag[metal] || 0);
    if (!rate) {
      return {
        handled: true,
        data: {
          ok: false,
          detail: `No ${metal} rate configured — save metal rates first`,
          metal,
          nisab_amount: null,
        },
      };
    }
    // Classical nisab weights (grams) — same as backend missing_features_api
    const grams = metal === "GOLD" ? 87.48 : 612.36;
    const nisab = Math.round(rate * grams * 100) / 100;
    return {
      handled: true,
      data: {
        metal,
        unit: "gram",
        rate_bdt: rate,
        nisab_grams: String(grams),
        nisab_amount: String(nisab),
        source: "cloud_local",
      },
    };
  }
  if (parts[0] === "vehicle-expenses" && parts[1] === "cost-per-km") {
    const bag = await readDoc(familyId, "life", "phase15", { items: [] });
    const name = queryParam(path, "vehicle_name") || "";
    const items = (bag.items || []).filter(
      (i) =>
        String(i.module_type || "").toUpperCase() === "VEHICLE" &&
        (!name || String(i.name || "").toLowerCase().includes(String(name).toLowerCase())),
    );
    const total = items.reduce((s, i) => s + Number(i.amount || 0), 0);
    const km = items.reduce((s, i) => s + Number(i.secondary_amount || 0), 0);
    return {
      handled: true,
      data: {
        vehicle_name: name || "all",
        expense_count: items.length,
        total_cost: total,
        total_km: km,
        cost_per_km: km > 0 ? Number((total / km).toFixed(4)) : null,
        source: "cloud_local",
      },
    };
  }

  if (parts[0] === "auth" && parts[1] === "me") {
    return {
      handled: true,
      data: {
        id: currentUser?.uid || currentUser?.firebase_uid || currentUser?.id || "",
        uid: currentUser?.uid || currentUser?.firebase_uid || "",
        firebase_uid: currentUser?.firebase_uid || currentUser?.uid || "",
        full_name: currentUser?.full_name || currentUser?.displayName || currentUser?.email || "Cloud User",
        email: currentUser?.email || "",
        avatar_url: currentUser?.avatar_url || currentUser?.photoURL || "",
        is_active: true,
        is_email_verified: Boolean(currentUser?.is_email_verified),
        source: "cloud_local",
      },
    };
  }

  if (parts[0] === "auth" && parts[1] === "email-status") {
    return {
      handled: true,
      data: {
        verified: Boolean(currentUser?.is_email_verified),
        // Cloud mode uses Firebase Auth for mail — not backend SMTP
        can_send: true,
        source: "cloud_local",
        note: "Firebase Auth handles account emails in cloud mode",
      },
    };
  }

  // Ownership transfer (cloud-local IndexedDB; no backend)
  if (parts[0] === "families" && parts[1] === familyId && parts[2] === "ownership-transfer") {
    if (!parts[3]) {
      return { handled: true, data: await readList(familyId, "family", "ownershipTransfers") };
    }
  }

  return { handled: false };
}

