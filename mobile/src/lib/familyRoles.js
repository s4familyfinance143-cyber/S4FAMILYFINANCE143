/** Family RBAC role ranks + default capability keys. */

export const FAMILY_ROLE_RANK = {
  OWNER: 5,
  ADMIN: 4,
  MEMBER: 3,
  VIEWER: 2,
  CHILD: 1,
};

export const FAMILY_ASSIGNABLE_ROLES = ["MEMBER", "ADMIN", "VIEWER", "CHILD"];

export const MEMBER_DEFAULT_PERMISSIONS = [
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

/** Read-mostly — no create / settings / sync push. */
export const VIEWER_DEFAULT_PERMISSIONS = [
  "dashboard.read",
  "accounts.read",
  "transactions.read",
  "reports.read",
  "backup.read",
  "sync.view",
];

/** Limited child — view + expense only. */
export const CHILD_DEFAULT_PERMISSIONS = [
  "dashboard.read",
  "accounts.read",
  "transactions.read",
  "expense.create",
  "sync.view",
];

export function normalizeFamilyRole(roleOrMember) {
  if (roleOrMember && typeof roleOrMember === "object") {
    return String(roleOrMember.normalized_role || roleOrMember.role || "MEMBER")
      .trim()
      .toUpperCase();
  }
  return String(roleOrMember || "MEMBER").trim().toUpperCase();
}

export function defaultPermissionsForRole(role) {
  const r = normalizeFamilyRole(role);
  if (r === "OWNER" || r === "ADMIN") return ["*", "settings.manage"];
  if (r === "VIEWER") return [...VIEWER_DEFAULT_PERMISSIONS];
  if (r === "CHILD") return [...CHILD_DEFAULT_PERMISSIONS];
  return [...MEMBER_DEFAULT_PERMISSIONS];
}

/** Apply allow/deny overrides onto a role baseline. */
export function applyPermissionOverrides(baseKeys, overrides = []) {
  if ((baseKeys || []).includes("*")) return ["*"];
  const set = new Set(baseKeys || []);
  for (const item of overrides || []) {
    const key = String(item?.permission_key || "").trim();
    if (!key) continue;
    if (item.allow === false) set.delete(key);
    else set.add(key);
  }
  return [...set];
}

export function preferElevatedRole(...roles) {
  let best = "";
  let bestRank = -1;
  for (const raw of roles) {
    const role = normalizeFamilyRole(raw);
    if (!role) continue;
    const rank = FAMILY_ROLE_RANK[role] ?? 0;
    if (rank > bestRank) {
      best = role;
      bestRank = rank;
    }
  }
  return best || "MEMBER";
}

/** Never treat OWNER/MEMBER/ADMIN/… as a relationship label. */
export function sanitizeRelationshipLabel(raw, roleFallback = "") {
  const value = String(raw || "").trim();
  if (!value) return "";
  const upper = value.toUpperCase();
  if (FAMILY_ROLE_RANK[upper] != null) return "";
  const role = normalizeFamilyRole(roleFallback);
  if (role && upper === role) return "";
  if (upper === "MEMBER" || upper === "OWNER" || upper === "ADMIN") return "";
  return value;
}
