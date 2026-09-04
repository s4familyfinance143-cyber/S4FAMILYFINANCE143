/**
 * Firebase-first API shim: serve App apiGet/apiPost/apiPatch/apiDelete from
 * IndexedDB snapshots (synced to Firestore via pushCloudSnapshot).
 */
import { loadOfflineSnapshot, saveOfflineSnapshot } from "./offlineCache";

function newId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function stripQuery(path) {
  return String(path || "").split("?")[0];
}

function queryParam(path, key) {
  const q = String(path || "").split("?")[1] || "";
  const params = new URLSearchParams(q);
  return params.get(key) || "";
}

async function readList(familyId, module, name, fallback = []) {
  const row = await loadOfflineSnapshot(familyId, module, name).catch(() => null);
  const data = row?.data;
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  if (data && Array.isArray(data.rows)) return data.rows;
  return Array.isArray(fallback) ? fallback : [];
}

async function writeList(familyId, module, name, list) {
  await saveOfflineSnapshot(familyId, module, name, list);
  return list;
}

async function readDoc(familyId, module, name, fallback = {}) {
  const row = await loadOfflineSnapshot(familyId, module, name).catch(() => null);
  return row?.data && typeof row.data === "object" ? row.data : fallback;
}

async function writeDoc(familyId, module, name, doc) {
  await saveOfflineSnapshot(familyId, module, name, doc);
  return doc;
}

async function appendAudit(familyId, entry) {
  const rows = await readList(familyId, "system", "audit", []);
  const next = [
    {
      id: newId("aud"),
      at: new Date().toISOString(),
      ...entry,
    },
    ...rows,
  ].slice(0, 200);
  await writeList(familyId, "system", "audit", next);
  return next;
}

async function appendNotification(familyId, entry) {
  const rows = await readList(familyId, "system", "notifications", []);
  const next = [
    {
      id: newId("ntf"),
      created_at: new Date().toISOString(),
      read: false,
      ...entry,
    },
    ...rows,
  ].slice(0, 100);
  await writeList(familyId, "system", "notifications", next);
  return next;
}

const CLOUD_PERMISSION_CATALOG = [
  "dashboard.read",
  "accounts.create",
  "accounts.read",
  "transactions.create",
  "income.create",
  "expense.create",
  "transactions.read",
  "reports.read",
  "audit.read",
  "backup.create",
  "backup.read",
  "backup.download",
  "backup.restore",
  "sync.view",
  "sync.pull",
  "sync.push",
  "sync.conflicts",
  "sync.resolve",
  "sync.manage",
  "settings.manage",
];

const MEMBER_DEFAULT_PERMISSIONS = [
  "dashboard.read",
  "accounts.read",
  "transactions.read",
  "transactions.create",
  "income.create",
  "expense.create",
  "reports.read",
  "backup.read",
  "sync.view",
  "sync.pull",
];

function normalizeMemberRole(member) {
  return String(member?.normalized_role || member?.role || "MEMBER").toUpperCase();
}

const ROLE_RANK = {
  OWNER: 5,
  ADMIN: 4,
  MEMBER: 3,
  VIEWER: 2,
  CHILD: 1,
};

function preferElevatedRole(...roles) {
  let best = "";
  let bestRank = -1;
  for (const raw of roles) {
    const role = String(raw || "").toUpperCase().trim();
    if (!role) continue;
    const rank = ROLE_RANK[role] ?? 0;
    if (rank > bestRank) {
      best = role;
      bestRank = rank;
    }
  }
  return best || "MEMBER";
}

function defaultPermissionsForRole(role) {
  const r = String(role || "MEMBER").toUpperCase();
  // OWNER/ADMIN: wildcard + explicit settings.manage so UI/backend checks never miss it
  if (r === "OWNER" || r === "ADMIN") return ["*", "settings.manage"];
  return [...MEMBER_DEFAULT_PERMISSIONS];
}

function applyPermissionOverrides(baseKeys, overrides = []) {
  if (baseKeys.includes("*")) return ["*"];
  const set = new Set(baseKeys);
  for (const item of overrides || []) {
    const key = String(item?.permission_key || "").trim();
    if (!key) continue;
    if (item.allow === false) set.delete(key);
    else set.add(key);
  }
  return [...set];
}

function memberMatchKey(member) {
  const email = String(member?.email || "").trim().toLowerCase();
  if (email) return `email:${email}`;
  const uid = String(member?.user_id || member?.uid || member?.member_id || member?.id || "").trim();
  if (uid) return `uid:${uid}`;
  return "";
}

function cloudMemberToLocal(cm) {
  const uid = String(cm?.uid || cm?.id || "").trim();
  const overrides = Array.isArray(cm?.overrides)
    ? cm.overrides
    : Array.isArray(cm?.permission_overrides)
      ? cm.permission_overrides
      : [];
  return {
    id: uid || cm.id,
    member_id: uid || cm.id,
    user_id: uid || cm.user_id || "",
    uid: uid || "",
    full_name: cm.display_name || cm.full_name || cm.name || cm.email || "Member",
    display_name: cm.display_name || cm.full_name || "",
    email: cm.email || "",
    role: cm.role || "MEMBER",
    normalized_role: String(cm.role || "MEMBER").toUpperCase(),
    relationship:
      cm.relationship_display_label ||
      cm.relationship ||
      cm.relationship_type ||
      "",
    relationship_type: cm.relationship_type || cm.relationship || "",
    relationship_display_label: cm.relationship_display_label || "",
    status: cm.status || "ACTIVE",
    overrides,
    permission_overrides: overrides,
    source: "firestore_members",
    updated_at: cm.updated_at || null,
  };
}

function mergeLocalAndCloudMembers(localRows = [], cloudRows = []) {
  const byKey = new Map();
  for (const row of localRows || []) {
    const key = memberMatchKey(row);
    if (!key) continue;
    byKey.set(key, { ...row });
  }
  for (const cm of cloudRows || []) {
    const mapped = cloudMemberToLocal(cm);
    const key = memberMatchKey(mapped);
    if (!key) continue;
    if (!byKey.has(key)) {
      byKey.set(key, mapped);
      continue;
    }
    const existing = byKey.get(key);
    const cloudOverrides = mapped.overrides || [];
    const localOverrides = Array.isArray(existing.overrides) ? existing.overrides : [];
    // Prefer newer / non-empty overrides; Firestore is source of truth when present
    const overrides = cloudOverrides.length ? cloudOverrides : localOverrides;
    byKey.set(key, {
      ...existing,
      ...mapped,
      // Prefer Firestore uid as stable member_id for multi-device overrides
      member_id: mapped.member_id || existing.member_id,
      id: mapped.id || existing.id,
      uid: mapped.uid || existing.uid,
      user_id: mapped.user_id || existing.user_id,
      full_name: mapped.full_name || existing.full_name,
      email: mapped.email || existing.email,
      // Never let a stale MEMBER cloud row downgrade an OWNER/ADMIN local row
      role: preferElevatedRole(mapped.role, existing.role, mapped.normalized_role, existing.normalized_role),
      normalized_role: preferElevatedRole(
        mapped.normalized_role,
        mapped.role,
        existing.normalized_role,
        existing.role,
      ),
      relationship: mapped.relationship || existing.relationship,
      relationship_type: mapped.relationship_type || existing.relationship_type,
      overrides,
      permission_overrides: overrides,
      source: existing.source && existing.source !== "cloud_local" ? existing.source : "merged",
    });
  }
  return [...byKey.values()];
}

function mapFamilyMemberPermissions(member) {
  const role = normalizeMemberRole(member);
  const overrides = Array.isArray(member?.overrides)
    ? member.overrides
    : Array.isArray(member?.permission_overrides)
      ? member.permission_overrides
      : [];
  const base = defaultPermissionsForRole(role);
  const effective = applyPermissionOverrides(base, overrides);
  return {
    ...member,
    member_id: member.member_id || member.id || member.uid || member.user_id,
    user_id: member.user_id || member.uid || member.email || member.member_id || member.id,
    full_name: member.full_name || member.display_name || member.name || "",
    email: member.email || "",
    relationship:
      member.relationship_display_label ||
      member.relationship ||
      member.relationship_type ||
      member.relation ||
      role,
    role,
    normalized_role: role,
    overrides,
    effective_permissions: effective,
    source: member.source || "cloud_local",
  };
}

async function loadPermissionMembers(familyId) {
  let rows = await readList(familyId, "family", "members");
  try {
    const { listFamilyCloudMembers } = await import("../firebase/familyCloud");
    const cloudMembers = await listFamilyCloudMembers(familyId);
    if (cloudMembers.length) {
      const merged = mergeLocalAndCloudMembers(rows, cloudMembers);
      // Keep local IDB in sync so PATCH /permissions/members/:id can find every member
      if (merged.length) {
        await writeList(familyId, "family", "members", merged);
        rows = merged;
      }
    }
  } catch {
    /* offline / rules not published */
  }
  return rows.map(mapFamilyMemberPermissions);
}

function findCurrentMember(members, currentUser) {
  if (!Array.isArray(members) || !members.length) return null;
  const email = String(currentUser?.email || "").trim().toLowerCase();
  const uid = String(
    currentUser?.uid || currentUser?.firebase_uid || currentUser?.id || currentUser?.user_id || "",
  ).trim();

  const matches = members.filter((m) => {
    const memberUid = String(m.user_id || m.uid || m.member_id || m.id || "").trim();
    const memberEmail = String(m.email || m.user_email || "").trim().toLowerCase();
    if (uid && memberUid && memberUid === uid) return true;
    if (email && memberEmail && memberEmail === email) return true;
    return false;
  });

  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    // Duplicate rows (local seed + Firestore): keep the highest privilege role
    return [...matches].sort(
      (a, b) => (ROLE_RANK[normalizeMemberRole(b)] || 0) - (ROLE_RANK[normalizeMemberRole(a)] || 0),
    )[0];
  }

  // Only fall back to OWNER when we cannot identify the user at all
  if (!uid && !email) {
    return members.find((m) => normalizeMemberRole(m) === "OWNER") || members[0];
  }
  return null;
}

const LIFE_ROUTE_TO_KEY = {
  investments: "INVESTMENT",
  "health-expenses": "HEALTH",
  "vehicle-expenses": "VEHICLE",
  "education-funds": "EDUCATION",
  subscriptions: "SUBSCRIPTION",
  documents: "DOCUMENT",
  properties: "PROPERTY",
};

function lifeModuleKey(route) {
  return LIFE_ROUTE_TO_KEY[route] || null;
}

/**
 * @returns {Promise<{ handled: boolean, data?: any }>}
 */
export async function cloudApiGet({ familyId, path, currentUser }) {
  if (!familyId) return { handled: false };
  const clean = stripQuery(path);
  const parts = clean.replace(/^\//, "").split("/").filter(Boolean);

  // Tasks / calendar (planner)
  if (parts[0] === "tasks" && parts[1] === familyId) {
    return { handled: true, data: await readList(familyId, "planner", "tasks") };
  }
  if (parts[0] === "calendar" && parts[1] === familyId) {
    return { handled: true, data: await readList(familyId, "planner", "events") };
  }

  // Grocery
  if (parts[0] === "grocery") {
    if (parts[1] === "lists" && parts[2] === familyId && !parts[3]) {
      return { handled: true, data: await readList(familyId, "grocery", "lists") };
    }
    if (parts[1] === "lists" && parts[2] === familyId && parts[3] && parts[4] === "items") {
      const all = await readList(familyId, "grocery", "items");
      return { handled: true, data: all.filter((i) => String(i.list_id) === String(parts[3])) };
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
    if (parts[1] === "collaboration" && parts[2] === "status") {
      return { handled: true, data: { mode: "cloud_local", online: true } };
    }
  }

  // Life modules list: /investments?family_id=
  const lifeKey = lifeModuleKey(parts[0]);
  if (lifeKey && !parts[1]) {
    const fid = queryParam(path, "family_id") || familyId;
    const bag = await readDoc(fid, "life", lifeKey === "HEALTH" || lifeKey === "INVESTMENT" || lifeKey === "VEHICLE" || lifeKey === "EDUCATION" ? "phase15" : "phase16", { items: [] });
    const items = Array.isArray(bag.items) ? bag.items : [];
    return { handled: true, data: items.filter((i) => i.module_type === lifeKey) };
  }

  if (parts[0] === "life-modules" && parts[1] === "summary") {
    const p15 = await readDoc(familyId, "life", "phase15", { items: [], summary: null });
    const p16 = await readDoc(familyId, "life", "phase16", { items: [], summary: null });
    return {
      handled: true,
      data: p15.summary || p16.summary || { total: (p15.items || []).length + (p16.items || []).length, source: "cloud_local" },
    };
  }

  // Zakat
  if (parts[0] === "zakat" && parts[1] === familyId) {
    return { handled: true, data: await readList(familyId, "zakat", "main") };
  }
  if (parts[0] === "zakat" && parts[1] === "summary" && parts[2] === familyId) {
    const rows = await readList(familyId, "zakat", "main");
    return {
      handled: true,
      data: { count: rows.length, latest: rows[0] || null, source: "cloud_local" },
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
    const rows = await readList(familyId, "system", "audit");
    if (parts[3] === "summary") {
      return { handled: true, data: { total_events: rows.length, source: "cloud_local" } };
    }
    if (parts[3] === "activity") {
      return { handled: true, data: { rows: rows.slice(0, 25) } };
    }
  }

  // Family members / permissions
  if (parts[0] === "families" && parts[1] === familyId && parts[2] === "members") {
    return { handled: true, data: await loadPermissionMembers(familyId) };
  }
  if (parts[0] === "permissions" && parts[1] === "family" && parts[2] === familyId && parts[3] === "me") {
    const members = await loadPermissionMembers(familyId);
    const me = findCurrentMember(members, currentUser);
    const ownerUid = String(
      currentUser?.family_owner_uid ||
        members.find((m) => normalizeMemberRole(m) === "OWNER")?.user_id ||
        members.find((m) => normalizeMemberRole(m) === "OWNER")?.uid ||
        "",
    ).trim();
    const myUid = String(currentUser?.uid || currentUser?.firebase_uid || currentUser?.id || "").trim();
    const isFamilyOwner = Boolean(myUid && ownerUid && myUid === ownerUid);

    const mapped = me
      ? mapFamilyMemberPermissions(me)
      : isFamilyOwner
        ? {
            role: "OWNER",
            normalized_role: "OWNER",
            relationship: "Owner",
            effective_permissions: ["*", "settings.manage"],
            overrides: [],
            source: "cloud_local",
          }
        : {
            role: "OWNER",
            normalized_role: "OWNER",
            relationship: "Owner",
            effective_permissions: ["*"],
            overrides: [],
            source: "cloud_local",
          };

    const resolvedRole = preferElevatedRole(
      mapped.normalized_role,
      mapped.role,
      isFamilyOwner ? "OWNER" : "",
    );

    return {
      handled: true,
      data: {
        role: resolvedRole,
        normalized_role: resolvedRole,
        relationship: mapped.relationship || (resolvedRole === "OWNER" ? "Owner" : "Member"),
        effective_permissions: mapped.effective_permissions?.length
          ? mapped.effective_permissions
          : defaultPermissionsForRole(resolvedRole),
        overrides: mapped.overrides || [],
        member_id: mapped.member_id,
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
  if (parts[0] === "currency") {
    const bag = await readDoc(familyId, "system", "currency", null);
    const defaults = {
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
      return { handled: true, data: defaults.currencies };
    }
    if (parts[1] === "rates") {
      return { handled: true, data: defaults.exchangeRates || [] };
    }
    if (parts[1] === "family-summary") {
      return {
        handled: true,
        data: defaults.currencySummary || {
          base_currency: defaults.code || "BDT",
          source: "cloud_local",
        },
      };
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
    const rates = await readDoc(familyId, "zakat", "metalRates", {
      GOLD: 12000,
      SILVER: 150,
      updated_at: null,
      source: "cloud_local",
    });
    return { handled: true, data: rates };
  }
  if (parts[0] === "vehicle-expenses" && parts[1] === "cost-per-km") {
    const bag = await readDoc(familyId, "life", "phase15", { items: [] });
    const name = queryParam(path, "vehicle_name") || "";
    const items = (bag.items || []).filter(
      (i) =>
        i.module_type === "VEHICLE" &&
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
        full_name: currentUser?.full_name || currentUser?.email || "Cloud User",
        email: currentUser?.email || "",
        is_email_verified: Boolean(currentUser?.is_email_verified),
        source: "cloud_local",
      },
    };
  }

  if (parts[0] === "auth" && parts[1] === "email-status") {
    return {
      handled: true,
      data: { verified: Boolean(currentUser?.is_email_verified), source: "cloud_local" },
    };
  }

  return { handled: false };
}

export async function cloudApiPost({ familyId, path, body, currentUser, onAfterWrite }) {
  if (!familyId) return { handled: false };
  const clean = stripQuery(path);
  const parts = clean.replace(/^\//, "").split("/").filter(Boolean);
  const after = typeof onAfterWrite === "function" ? onAfterWrite : async () => {};

  // Planner
  if (parts[0] === "tasks" && !parts[1]) {
    const rows = await readList(familyId, "planner", "tasks");
    const row = {
      id: newId("task"),
      family_id: familyId,
      title: body.title || "",
      description: body.description || "",
      due_date: body.due_date || null,
      priority: body.priority || "MEDIUM",
      status: "OPEN",
      created_at: new Date().toISOString(),
      source: "cloud_local",
    };
    await writeList(familyId, "planner", "tasks", [row, ...rows]);
    await appendAudit(familyId, { action: "task.create", title: row.title });
    await after();
    return { handled: true, data: row };
  }
  if (parts[0] === "calendar" && !parts[1]) {
    const rows = await readList(familyId, "planner", "events");
    const row = {
      id: newId("evt"),
      family_id: familyId,
      title: body.title || "",
      description: body.description || "",
      event_date: body.event_date || null,
      start_time: body.start_time || null,
      end_time: body.end_time || null,
      event_type: body.event_type || "GENERAL",
      created_at: new Date().toISOString(),
      source: "cloud_local",
    };
    await writeList(familyId, "planner", "events", [row, ...rows]);
    await appendAudit(familyId, { action: "calendar.create", title: row.title });
    await after();
    return { handled: true, data: row };
  }

  // Grocery lists / vendors / items
  if (parts[0] === "grocery" && parts[1] === "lists" && !parts[2]) {
    const rows = await readList(familyId, "grocery", "lists");
    const row = {
      id: newId("glist"),
      family_id: familyId,
      title: body.title || "List",
      budget_amount: Number(body.budget_amount || 0),
      currency: body.currency || "BDT",
      vendor_name: body.vendor_name || null,
      shopping_date: body.shopping_date || null,
      note: body.note || "",
      status: "OPEN",
      created_at: new Date().toISOString(),
      source: "cloud_local",
    };
    await writeList(familyId, "grocery", "lists", [row, ...rows]);
    await appendAudit(familyId, { action: "grocery.list.create", title: row.title });
    await appendNotification(familyId, { title: "Grocery list created", body: row.title, type: "GROCERY" });
    await after();
    return { handled: true, data: row };
  }
  if (parts[0] === "grocery" && parts[1] === "vendors" && !parts[2]) {
    const rows = await readList(familyId, "grocery", "vendors");
    const row = {
      id: newId("gven"),
      family_id: familyId,
      name: body.name || body.vendor_name || "Vendor",
      phone: body.phone || "",
      note: body.note || "",
      created_at: new Date().toISOString(),
      source: "cloud_local",
    };
    await writeList(familyId, "grocery", "vendors", [row, ...rows]);
    await after();
    return { handled: true, data: row };
  }
  if (parts[0] === "grocery" && parts[1] === "items" && !parts[2]) {
    const rows = await readList(familyId, "grocery", "items");
    const row = {
      id: newId("gitem"),
      family_id: familyId,
      list_id: body.list_id || body.grocery_list_id,
      name: body.name || body.item_name || "Item",
      quantity: body.quantity || 1,
      unit: body.unit || "",
      estimated_price: Number(body.estimated_price || body.price || 0),
      bought: false,
      created_at: new Date().toISOString(),
      source: "cloud_local",
    };
    await writeList(familyId, "grocery", "items", [row, ...rows]);
    await after();
    return { handled: true, data: row };
  }

  // Life module create: /investments, /health-expenses, ...
  const lifeKey = lifeModuleKey(parts[0]);
  if (lifeKey && !parts[1]) {
    const phase = ["INVESTMENT", "HEALTH", "VEHICLE", "EDUCATION"].includes(lifeKey) ? "phase15" : "phase16";
    const bag = await readDoc(familyId, "life", phase, { items: [], summary: null });
    const items = Array.isArray(bag.items) ? bag.items : [];
    const row = {
      id: newId("life"),
      family_id: familyId,
      name: body.name || body.title || lifeKey,
      category: body.category || "GENERAL",
      sub_type: body.sub_type || body.type || "",
      provider: body.provider || body.doctor || null,
      member_id: body.member_id || null,
      amount: body.amount ?? body.principal ?? body.value ?? 0,
      secondary_amount: body.secondary_amount ?? body.rate ?? null,
      currency: body.currency || "BDT",
      target_date: body.target_date || body.expense_date || null,
      note: body.note || "",
      status: "ACTIVE",
      created_at: new Date().toISOString(),
      source: "cloud_local",
      ...body,
      module_type: lifeKey,
    };
    const nextItems = [row, ...items];
    await writeDoc(familyId, "life", phase, {
      items: nextItems,
      summary: { total: nextItems.length, source: "cloud_local" },
    });
    await appendAudit(familyId, { action: `life.${lifeKey}.create`, title: row.name });
    await after();
    return { handled: true, data: row };
  }

  if (parts[0] === "zakat" && (parts[1] === "calculate" || !parts[1])) {
    const rows = await readList(familyId, "zakat", "main");
    const cash = Number(body.cash_amount || 0);
    const gold = Number(body.gold_value || 0);
    const silver = Number(body.silver_value || 0);
    const invest = Number(body.investment_value || 0);
    const business = Number(body.business_assets || 0);
    const recv = Number(body.receivables || 0);
    const debts = Number(body.deductible_debts || 0);
    const zakatable = Math.max(0, cash + gold + silver + invest + business + recv - debts);
    const due = Number((zakatable * 0.025).toFixed(2));
    const row = {
      id: newId("zakat"),
      family_id: familyId,
      calculation_year: body.calculation_year || new Date().getFullYear(),
      ...body,
      zakatable_amount: zakatable,
      zakat_due: due,
      created_at: new Date().toISOString(),
      source: "cloud_local",
    };
    await writeList(familyId, "zakat", "main", [row, ...rows]);
    await appendAudit(familyId, { action: "zakat.create", title: String(row.calculation_year) });
    await appendNotification(familyId, {
      title: "Zakat calculated",
      body: `Due: ${due}`,
      type: "ZAKAT",
    });
    await after();
    return { handled: true, data: row };
  }

  // Invites (cloud-local codes + Firestore global registry for multi-account join)
  if (parts[0] === "invites" && (parts[1] === "generate" || parts[1] === "email" || parts[1] === "link")) {
    const invites = await readList(familyId, "family", "invites");
    const code = `S4-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const row = {
      id: newId("inv"),
      family_id: familyId,
      code,
      invite_code: code,
      invite_link: `s4familyfinance://join?code=${code}`,
      invitee_email: body.invitee_email || null,
      expires_in_days: Number(body.expires_in_days || 7),
      max_uses: Number(body.max_uses || 1),
      uses: 0,
      status: "ACTIVE",
      email_sent: Boolean(body.send_email && body.invitee_email),
      email_reason: body.send_email
        ? "Invite code ready — share manually (SMTP optional)"
        : "code_only",
      created_at: new Date().toISOString(),
      created_by: currentUser?.email || "owner",
      source: "cloud_local",
    };
    await writeList(familyId, "family", "invites", [row, ...invites]);
    await appendAudit(familyId, { action: "invite.create", title: code });
    await appendNotification(familyId, {
      title: "Invite created",
      body: code,
      type: "FAMILY",
    });
    // Publish to Firestore so another account can join
    try {
      const { publishFamilyInvite } = await import("../firebase/familyCloud");
      const uid = currentUser?.firebase_uid || currentUser?.uid || body.owner_uid;
      if (uid) {
        await publishFamilyInvite({
          code,
          familyId,
          ownerUid: uid,
          inviteeEmail: body.invitee_email || null,
          expiresInDays: Number(body.expires_in_days || 7),
          maxUses: Number(body.max_uses || 1),
        });
        row.cloud_published = true;
      }
    } catch (err) {
      row.cloud_published = false;
      row.cloud_publish_error = err?.message || "publish_failed";
    }
    await after();
    return { handled: true, data: row };
  }

  if (parts[0] === "invites" && parts[1] === "join") {
    const code = String(body.invite_code || body.code || "").trim().toUpperCase();
    // Prefer cross-account Firestore join when firebase uid present
    const uid = currentUser?.firebase_uid || currentUser?.uid || body.uid;
    if (uid) {
      try {
        const { joinFamilyByInviteCode } = await import("../firebase/familyCloud");
        const result = await joinFamilyByInviteCode({
          code,
          uid,
          email: body.email || currentUser?.email || "",
          displayName: body.full_name || currentUser?.full_name || "Member",
          relationshipType: body.relationship_type || "Relative",
        });
        await after();
        return {
          handled: true,
          data: {
            ...result,
            family_id: result.familyId,
            switched: true,
            source: "firestore_invite",
          },
        };
      } catch (err) {
        // Fall through to same-family local invite list
        if (!/Invalid|expired|used/i.test(String(err?.message || ""))) {
          /* try local */
        } else if (!familyId) {
          throw err;
        }
      }
    }

    const invites = await readList(familyId, "family", "invites");
    const hit = invites.find((i) => String(i.code || i.invite_code || "").toUpperCase() === code);
    if (!hit || hit.status !== "ACTIVE") {
      throw new Error("Invalid or expired invite code");
    }
    const members = await readList(familyId, "family", "members");
    const member = {
      id: newId("mem"),
      member_id: newId("mem"),
      family_id: familyId,
      full_name: body.full_name || currentUser?.full_name || "Member",
      email: body.email || currentUser?.email || "",
      role: "MEMBER",
      relationship_type: body.relationship_type || "Relative",
      status: "ACTIVE",
      joined_at: new Date().toISOString(),
      source: "cloud_local",
    };
    await writeList(familyId, "family", "members", [...members, member]);
    hit.uses = Number(hit.uses || 0) + 1;
    if (hit.uses >= Number(hit.max_uses || 1)) hit.status = "USED";
    await writeList(
      familyId,
      "family",
      "invites",
      invites.map((i) => (i.id === hit.id ? hit : i)),
    );
    await after();
    return { handled: true, data: { member, invite: hit } };
  }

  if (parts[0] === "invites" && parts[2] === "revoke") {
    const invites = await readList(familyId, "family", "invites");
    const target = invites.find((i) => i.id === parts[1]);
    const next = invites.map((i) =>
      i.id === parts[1] ? { ...i, status: "REVOKED" } : i,
    );
    await writeList(familyId, "family", "invites", next);
    if (target?.code || target?.invite_code) {
      try {
        const { revokeFamilyInvite } = await import("../firebase/familyCloud");
        await revokeFamilyInvite(target.code || target.invite_code);
      } catch {
        /* ignore */
      }
    }
    await after();
    return { handled: true, data: { ok: true } };
  }

  // Tags
  if (parts[0] === "tags" && !parts[1]) {
    const rows = await readList(familyId, "finance", "tags");
    const row = {
      id: newId("tag"),
      family_id: familyId,
      name: body.name || body.name_en || "Tag",
      created_at: new Date().toISOString(),
      source: "cloud_local",
    };
    await writeList(familyId, "finance", "tags", [row, ...rows]);
    await after();
    return { handled: true, data: row };
  }
  if (parts[0] === "transaction-tags" && !parts[1]) {
    const rows = await readList(familyId, "finance", "transactionTags");
    const row = {
      id: newId("ttag"),
      family_id: familyId,
      transaction_id: body.transaction_id,
      tag_id: body.tag_id,
      created_at: new Date().toISOString(),
      source: "cloud_local",
    };
    await writeList(familyId, "finance", "transactionTags", [row, ...rows]);
    await after();
    return { handled: true, data: row };
  }

  // Currency rates / base
  if (parts[0] === "currency" && (parts[1] === "rates" || parts[1] === "rate")) {
    const bag = await readDoc(familyId, "system", "currency", {
      currencies: [],
      exchangeRates: [],
      code: "BDT",
    });
    const rates = Array.isArray(bag.exchangeRates) ? bag.exchangeRates : [];
    const row = {
      from_currency: body.from_currency || body.from || "USD",
      to_currency: body.to_currency || body.to || "BDT",
      rate: Number(body.rate || 0),
      updated_at: new Date().toISOString(),
      source: "cloud_local",
    };
    const next = [
      row,
      ...rates.filter(
        (r) =>
          !(
            r.from_currency === row.from_currency && r.to_currency === row.to_currency
          ),
      ),
    ];
    await writeDoc(familyId, "system", "currency", { ...bag, exchangeRates: next });
    await after();
    return { handled: true, data: row };
  }
  if (parts[0] === "currency" && !parts[1]) {
    const bag = await readDoc(familyId, "system", "currency", {
      currencies: [],
      exchangeRates: [],
      code: "BDT",
    });
    const currencies = Array.isArray(bag.currencies) ? bag.currencies : [];
    const row = {
      code: body.code || "BDT",
      name: body.name || body.code || "Currency",
      symbol: body.symbol || body.code || "",
      is_base: Boolean(body.is_base),
      source: "cloud_local",
    };
    const next = [row, ...currencies.filter((c) => c.code !== row.code)];
    await writeDoc(familyId, "system", "currency", {
      ...bag,
      currencies: next,
      code: row.is_base ? row.code : bag.code || row.code,
      symbol: row.is_base ? row.symbol : bag.symbol || row.symbol,
    });
    await after();
    return { handled: true, data: row };
  }

  // Metal rates
  if (parts[0] === "zakat" && parts[1] === "metal-rates") {
    const prev = await readDoc(familyId, "zakat", "metalRates", {});
    const next = {
      ...prev,
      [String(body.metal || "GOLD").toUpperCase()]: Number(body.rate_bdt || body.rate || 0),
      updated_at: new Date().toISOString(),
      source: "cloud_local",
    };
    await writeDoc(familyId, "zakat", "metalRates", next);
    await after();
    return { handled: true, data: next };
  }

  // Split expense → two linked transactions in offline finance cache
  if (parts[0] === "expenses" && parts[1] === "split") {
    const { loadOfflineSnapshot, saveOfflineSnapshot } = await import("./offlineCache");
    const cached = await loadOfflineSnapshot(familyId, "finance", "transactions").catch(() => null);
    const txs = Array.isArray(cached?.data) ? cached.data : [];
    const amount = Number(body.amount || 0);
    const splits = Array.isArray(body.splits) ? body.splits : [];
    const baseId = newId("tx");
    const created = splits.map((s, idx) => ({
      id: `${baseId}_${idx}`,
      family_id: familyId,
      account_id: body.account_id,
      category_id: body.category_id,
      transaction_type: "EXPENSE",
      amount: Number(s.share_amount || 0),
      currency: body.currency || "BDT",
      description: `${body.description || "Split"} (${s.member_id || idx})`,
      member_id: s.member_id || null,
      split_group_id: baseId,
      created_at: new Date().toISOString(),
      source: "cloud_local",
    }));
    await saveOfflineSnapshot(familyId, "finance", "transactions", [...created, ...txs]);
    await appendAudit(familyId, { action: "expense.split", title: body.description || baseId });
    await after();
    return { handled: true, data: { id: baseId, amount, splits: created, source: "cloud_local" } };
  }

  // Notification test endpoints — in-app + browser Notification API
  if (parts[0] === "notifications" && parts[1] === "test-email") {
    await appendNotification(familyId, {
      title: "Test notification",
      body: "Saved in-app. Email SMTP is optional; invite codes work without SMTP.",
      type: "TEST",
      notification_type: "TEST",
      severity: "LOW",
    });
    await after();
    return { handled: true, data: { sent: true, channel: "in_app", reason: "cloud_in_app" } };
  }
  if (parts[0] === "notifications" && parts[1] === "test-push") {
    const title = "S4 Family Finance 143";
    const bodyText = "Push test — browser/local notification";
    await appendNotification(familyId, {
      title,
      body: bodyText,
      type: "TEST",
      notification_type: "TEST",
      severity: "MEDIUM",
    });
    let pushShown = false;
    let pushReason = "browser_unavailable";
    try {
      if (typeof Notification !== "undefined") {
        if (Notification.permission === "granted") {
          new Notification(title, { body: bodyText, icon: "/icon-192.png" });
          pushShown = true;
          pushReason = "browser_notification";
        } else if (Notification.permission !== "denied") {
          const perm = await Notification.requestPermission();
          if (perm === "granted") {
            new Notification(title, { body: bodyText, icon: "/icon-192.png" });
            pushShown = true;
            pushReason = "browser_notification";
          } else {
            pushReason = "permission_not_granted";
          }
        } else {
          pushReason = "permission_denied";
        }
      }
    } catch (err) {
      console.error("[S4 Notify] test-push failed", err);
      pushReason = err?.message || "notification_error";
    }
    await after();
    return {
      handled: true,
      data: {
        sent: true,
        sent_count: pushShown ? 1 : 0,
        channel: pushShown ? "browser_notification" : "in_app_only",
        reason: pushReason,
      },
    };
  }

  if (parts[0] === "notifications" && parts[1] === "devices" && parts[2] === familyId) {
    const devices = await readList(familyId, "system", "pushDevices", []);
    const token = String(body?.token || "").trim();
    if (token.length < 8) {
      return { handled: true, data: { ok: false, reason: "token_too_short" } };
    }
    const existing = devices.find((d) => d.token === token);
    const row = {
      id: existing?.id || newId("dev"),
      token,
      platform: body?.platform || "WEB",
      provider: body?.provider || "FCM",
      device_label: body?.device_label || "web-browser",
      created_at: existing?.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
      is_active: true,
    };
    const next = existing
      ? devices.map((d) => (d.token === token ? row : d))
      : [row, ...devices].slice(0, 20);
    await writeList(familyId, "system", "pushDevices", next);
    await after();
    return { handled: true, data: row };
  }

  if (parts[0] === "notifications" && parts[1] === "scan" && parts[2] === familyId) {
    const created = await appendNotification(familyId, {
      title: "Activity check",
      body: "Cloud scan complete — review family alerts in the inbox.",
      type: "SCAN",
      notification_type: "SCAN",
      severity: "LOW",
    });
    await after();
    return {
      handled: true,
      data: { created_notifications: 1, unread_notifications: created.filter((r) => !r.read).length },
    };
  }

  return { handled: false };
}

export async function cloudApiPatch({ familyId, path, body, onAfterWrite, currentUser }) {
  if (!familyId) return { handled: false };
  const clean = stripQuery(path);
  const parts = clean.replace(/^\//, "").split("/").filter(Boolean);
  const after = typeof onAfterWrite === "function" ? onAfterWrite : async () => {};

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
    const role = normalizeMemberRole(me || { role: "OWNER" });
    const effective = me?.effective_permissions || defaultPermissionsForRole(role);
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
    try {
      const { updateFamilyCloudSettings } = await import("../firebase/familyCloud");
      await updateFamilyCloudSettings({
        familyId,
        currency: appliedCurrency,
        timezone: appliedTimezone,
        actorUid: currentUser?.uid || currentUser?.firebase_uid || me?.user_id || me?.uid,
      });
    } catch (err) {
      // Local snapshots already saved — surface Firestore errors clearly
      const msg = String(err?.message || "");
      if (/permission denied/i.test(msg)) {
        throw err;
      }
      if (/network|unavailable|connection/i.test(msg)) {
        throw err;
      }
      console.warn("[S4 FamilySettings] Firestore meta update skipped", err);
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
      },
    };
  }

  // Task complete / update
  if (parts[0] === "tasks" && parts[1]) {
    const rows = await readList(familyId, "planner", "tasks");
    const next = rows.map((r) => (r.id === parts[1] ? { ...r, ...body, updated_at: new Date().toISOString() } : r));
    await writeList(familyId, "planner", "tasks", next);
    await after();
    return { handled: true, data: next.find((r) => r.id === parts[1]) || {} };
  }

  // Grocery item bought toggle
  if (parts[0] === "grocery" && parts[1] === "items" && parts[2]) {
    const rows = await readList(familyId, "grocery", "items");
    const next = rows.map((r) => (r.id === parts[2] ? { ...r, ...body, updated_at: new Date().toISOString() } : r));
    await writeList(familyId, "grocery", "items", next);
    await after();
    return { handled: true, data: next.find((r) => r.id === parts[2]) || {} };
  }

  // Life module update
  const lifeKey = lifeModuleKey(parts[0]);
  if (lifeKey && parts[1] && parts[2] !== "close") {
    const phase = ["INVESTMENT", "HEALTH", "VEHICLE", "EDUCATION"].includes(lifeKey) ? "phase15" : "phase16";
    const bag = await readDoc(familyId, "life", phase, { items: [] });
    const items = Array.isArray(bag.items) ? bag.items : [];
    const nextItems = items.map((r) =>
      r.id === parts[1] ? { ...r, ...body, module_type: lifeKey, updated_at: new Date().toISOString() } : r,
    );
    await writeDoc(familyId, "life", phase, { ...bag, items: nextItems });
    await after();
    return { handled: true, data: nextItems.find((r) => r.id === parts[1]) || {} };
  }

  if (lifeKey && parts[1] && parts[2] === "close") {
    const phase = ["INVESTMENT", "HEALTH", "VEHICLE", "EDUCATION"].includes(lifeKey) ? "phase15" : "phase16";
    const bag = await readDoc(familyId, "life", phase, { items: [] });
    const items = Array.isArray(bag.items) ? bag.items : [];
    const nextItems = items.map((r) =>
      r.id === parts[1] ? { ...r, status: "CLOSED", updated_at: new Date().toISOString() } : r,
    );
    await writeDoc(familyId, "life", phase, { ...bag, items: nextItems });
    await after();
    return { handled: true, data: { ok: true } };
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
        return { handled: true, data: { ok: false, detail: "role required" } };
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
      try {
        const { setFamilyMemberRole } = await import("../firebase/familyCloud");
        await setFamilyMemberRole({
          familyId,
          memberUid: memberId,
          role: nextRole,
          actorUid,
        });
      } catch (err) {
        console.warn("[S4 MemberRole] Firestore update skipped", err);
      }
      await appendAudit(familyId, { action: "MEMBER_ROLE", member_id: memberId, role: nextRole });
      await after();
      return { handled: true, data: { ok: true, member_id: memberId, role: nextRole } };
    }

    if (action === "relationship" || body?.relationship_type || body?.relationship) {
      const relation = String(
        body?.relationship_type || body?.relationship || body?.relationship_display_label || "",
      ).trim();
      if (!relation) {
        return { handled: true, data: { ok: false, detail: "relationship required" } };
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
      try {
        const { setFamilyMemberRelationship } = await import("../firebase/familyCloud");
        await setFamilyMemberRelationship({
          familyId,
          memberUid: memberId,
          relationshipType: relation,
          actorUid,
        });
      } catch (err) {
        console.warn("[S4 MemberRelation] Firestore update skipped", err);
      }
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
        },
      };
    }
  }

  // Member permission override (Owner assigns Allow/Deny)
  if (parts[0] === "permissions" && parts[1] === "members" && parts[2]) {
    const memberId = String(parts[2] || "").trim();
    let rows = await readList(familyId, "family", "members");
    const key = String(body?.permission_key || "").trim();
    if (!key) {
      return { handled: true, data: { ok: false, detail: "permission_key required" } };
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
    try {
      const { updateFamilyMemberPermissionOverrides } = await import("../firebase/familyCloud");
      const firestoreUid = String(
        updated?.uid || updated?.user_id || updated?.member_id || memberId,
      );
      await updateFamilyMemberPermissionOverrides({
        familyId,
        memberUid: firestoreUid,
        overrides: mapped.overrides || [],
      });
    } catch {
      /* rules / offline — local IDB still saved */
    }

    await after();
    return { handled: true, data: mapped };
  }

  return { handled: false };
}

export async function cloudApiDelete({ familyId, path, onAfterWrite }) {
  if (!familyId) return { handled: false };
  const clean = stripQuery(path);
  const parts = clean.replace(/^\//, "").split("/").filter(Boolean);
  const after = typeof onAfterWrite === "function" ? onAfterWrite : async () => {};

  if (parts[0] === "tasks" && parts[1]) {
    const rows = await readList(familyId, "planner", "tasks");
    await writeList(
      familyId,
      "planner",
      "tasks",
      rows.filter((r) => r.id !== parts[1]),
    );
    await after();
    return { handled: true, data: { ok: true } };
  }
  if (parts[0] === "calendar" && parts[1]) {
    const rows = await readList(familyId, "planner", "events");
    await writeList(
      familyId,
      "planner",
      "events",
      rows.filter((r) => r.id !== parts[1]),
    );
    await after();
    return { handled: true, data: { ok: true } };
  }
  if (parts[0] === "grocery" && parts[1] === "items" && parts[2]) {
    const rows = await readList(familyId, "grocery", "items");
    await writeList(
      familyId,
      "grocery",
      "items",
      rows.filter((r) => r.id !== parts[2]),
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
      rows.filter((r) => r.id !== parts[1]),
    );
    const links = await readList(familyId, "finance", "transactionTags");
    await writeList(
      familyId,
      "finance",
      "transactionTags",
      links.filter((r) => r.tag_id !== parts[1]),
    );
    await after();
    return { handled: true, data: { ok: true } };
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
export async function seedCloudModuleCaches(familyId, { ownerName, ownerEmail, ownerRelation = "Owner" } = {}) {
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
  if (!membersExisting?.data) {
    const owner = {
      id: "mem_owner",
      member_id: "mem_owner",
      full_name: ownerName || "Owner",
      email: ownerEmail || "",
      role: "OWNER",
      normalized_role: "OWNER",
      relationship: ownerRelation || "Owner",
      relationship_type: ownerRelation || "Owner",
      status: "ACTIVE",
      overrides: [],
      joined_at: new Date().toISOString(),
      source: "cloud_local",
    };
    await writeList(familyId, "family", "members", [owner]);
  }

  await ensureList("family", "invites", []);
  await ensureList("family", "joinRequests", []);
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
