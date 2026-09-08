import { useCallback, useEffect, useMemo, useState } from "react";
import { TypeChip } from "../ui/FinanceChips";
import {
  JOIN_RELATIONSHIPS,
  OWNER_RELATIONSHIPS,
  buildJoinInvitePayload,
  needsLinkedMember,
  needsRelationshipNote,
  needsSerial,
  serialLabelsFor,
} from "../../lib/familyRelationships";
import {
  FAMILY_ASSIGNABLE_ROLES,
  defaultPermissionsForRole,
  applyPermissionOverrides,
} from "../../lib/familyRoles";

const TABS = ["members", "invite", "join", "requests"];

const EMPTY_JOIN = {
  invite_code: "",
  relationship_type: "Relative",
  relationship_serial: "",
  serial_label: "",
  linked_member_id: "",
  relationship_note: "",
};

const ROLE_RANK = {
  OWNER: 5,
  ADMIN: 4,
  MEMBER: 3,
  VIEWER: 2,
  CHILD: 1,
};

/** Clear “what they can do” toggles — Owner sets these for Wife / members. */
const MEMBER_CAPABILITY_TOGGLES = [
  { key: "dashboard.read", labelEn: "Can View Dashboard", labelBn: "ড্যাশবোর্ড দেখতে পারবে" },
  { key: "accounts.create", labelEn: "Can Create Wallets", labelBn: "ওয়ালেট তৈরি করতে পারবে" },
  { key: "accounts.read", labelEn: "Can View Wallets", labelBn: "ওয়ালেট দেখতে পারবে" },
  { key: "transactions.create", labelEn: "Can Add Transactions", labelBn: "লেনদেন যোগ করতে পারবে" },
  { key: "income.create", labelEn: "Can Add Income", labelBn: "আয় যোগ করতে পারবে" },
  { key: "expense.create", labelEn: "Can Add Expenses", labelBn: "খরচ যোগ করতে পারবে" },
  { key: "transactions.read", labelEn: "Can View Transactions", labelBn: "লেনদেন দেখতে পারবে" },
  { key: "reports.read", labelEn: "Can View Reports", labelBn: "রিপোর্ট দেখতে পারবে" },
  { key: "audit.read", labelEn: "Can View Audit", labelBn: "অডিট দেখতে পারবে" },
  { key: "backup.create", labelEn: "Can Create Backups", labelBn: "ব্যাকআপ তৈরি করতে পারবে" },
  { key: "backup.read", labelEn: "Can View Backups", labelBn: "ব্যাকআপ দেখতে পারবে" },
  { key: "backup.download", labelEn: "Can Download Backups", labelBn: "ব্যাকআপ ডাউনলোড করতে পারবে" },
  { key: "backup.restore", labelEn: "Can Restore Backups", labelBn: "ব্যাকআপ রিস্টোর করতে পারবে" },
  { key: "sync.view", labelEn: "Can View Sync", labelBn: "সিঙ্ক দেখতে পারবে" },
  { key: "sync.pull", labelEn: "Can Pull Sync", labelBn: "সিঙ্ক পুল করতে পারবে" },
  { key: "sync.push", labelEn: "Can Push Sync", labelBn: "সিঙ্ক পুশ করতে পারবে" },
  { key: "settings.manage", labelEn: "Can Manage Settings", labelBn: "সেটিংস পরিবর্তন করতে পারবে" },
];

const ROLE_HELP = {
  MEMBER: {
    en: "Normal member — set each permission below",
    bn: "সাধারণ সদস্য — নিচের প্রতিটি অনুমতি সেট করুন",
  },
  ADMIN: {
    en: "Almost like Owner — full access (individual toggles hidden)",
    bn: "প্রায় Owner — সব অ্যাক্সেস (আলাদা টগল লুকানো)",
  },
  VIEWER: {
    en: "View-only baseline — you can tighten or open toggles below",
    bn: "শুধু দেখার বেসলাইন — নিচে টগল দিয়ে বাড়াতে/কমাতে পারবেন",
  },
  CHILD: {
    en: "Limited child baseline — view + expenses; adjust below",
    bn: "সীমিত চাইল্ড বেসলাইন — দেখা + খরচ; নিচে অ্যাডজাস্ট করুন",
  },
};

function hasEffectivePermission(effective = [], key) {
  if (!key) return false;
  if (effective.includes("*")) return true;
  return effective.includes(key);
}

function capabilityLabel(item, lang) {
  if (String(lang || "").toLowerCase().startsWith("bn")) return item.labelBn || item.labelEn;
  return item.labelEn;
}

function roleHelpText(role, lang) {
  const row = ROLE_HELP[String(role || "").toUpperCase()];
  if (!row) return "";
  if (String(lang || "").toLowerCase().startsWith("bn")) return row.bn;
  return row.en;
}

function resolveMemberCapabilities(member, permissionRow) {
  const memberRole = String(member?.normalized_role || member?.role || "").toUpperCase();
  const permRole = String(permissionRow?.normalized_role || permissionRow?.role || "").toUpperCase();
  const role = memberRole || permRole || "MEMBER";
  if (role === "OWNER" || role === "ADMIN") {
    return ["*"];
  }
  // Always recompute from role baseline + overrides — never trust a stale fat effective_permissions list
  // (optimistic create used to inject MEMBER defaults and leave every toggle OPEN).
  const overrides =
    permRole && memberRole && permRole !== memberRole
      ? []
      : Array.isArray(permissionRow?.overrides)
        ? permissionRow.overrides
        : Array.isArray(permissionRow?.permission_overrides)
          ? permissionRow.permission_overrides
          : Array.isArray(member?.overrides)
            ? member.overrides
            : [];
  return applyPermissionOverrides(defaultPermissionsForRole(role), overrides);
}

function preferElevatedRole(...roles) {
  let best = "";
  let bestRank = -1;
  for (const raw of roles) {
    const role = String(raw || "")
      .toUpperCase()
      .trim();
    if (!role || role === "LOADING" || role === "—") continue;
    const rank = ROLE_RANK[role] ?? 0;
    if (rank > bestRank) {
      best = role;
      bestRank = rank;
    }
  }
  return best;
}

/** Stable global family role — never derived from join-request rows or active tab. */
function resolveMyGlobalRole({ myPermissions, governanceMembers, currentUser, email, activeFamily, loadingLabel }) {
  const uid = String(
    currentUser?.uid || currentUser?.firebase_uid || currentUser?.id || currentUser?.user_id || "",
  ).trim();
  const mail = String(currentUser?.email || email || "")
    .trim()
    .toLowerCase();

  const matchedMembers = (governanceMembers || []).filter((m) => {
    const memberUid = String(m.user_id || m.uid || m.member_id || m.id || "").trim();
    const memberEmail = String(m.email || m.user_email || "")
      .trim()
      .toLowerCase();
    if (uid && memberUid && memberUid === uid) return true;
    if (mail && memberEmail && memberEmail === mail) return true;
    return false;
  });

  const fromMembers = preferElevatedRole(
    ...matchedMembers.map((m) => m.normalized_role || m.role || m.member_role),
  );

  const fromPerms = preferElevatedRole(myPermissions?.normalized_role, myPermissions?.role);

  const resolved = preferElevatedRole(fromMembers, fromPerms);
  if (resolved) return resolved;

  // Stale owner_uid only as last resort when member rows are missing
  const ownerUid = String(activeFamily?.owner_uid || activeFamily?.owner_id || "").trim();
  if (uid && ownerUid && uid === ownerUid) return "OWNER";

  if (myPermissions || matchedMembers.length) return "MEMBER";
  return loadingLabel || "—";
}

function shortId(value) {
  const text = String(value || "");
  if (text.length <= 12) return text || "—";
  return `${text.slice(0, 8)}…${text.slice(-4)}`;
}

function memberLabel(member, t) {
  return (
    member.full_name ||
    member.name ||
    member.email ||
    member.user_email ||
    member.relationship_display_label ||
    member.relationship_type ||
    member.relationship ||
    t("members")
  );
}

function memberInitials(member, t) {
  const label = memberLabel(member, t);
  return String(label)
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] || "")
    .join("")
    .toUpperCase() || "?";
}

function roleTone(role) {
  const value = String(role || "").toUpperCase();
  if (value.includes("OWNER") || value.includes("ADMIN")) return "SAVINGS";
  if (value.includes("MEMBER")) return "TRANSFER";
  return "PENDING";
}

function memberIdOf(member) {
  return (
    member.uid ||
    member.user_id ||
    member.member_id ||
    member.id ||
    member.family_member_id ||
    ""
  );
}

function findPermissionRow(memberPermissions, member) {
  const mid = String(memberIdOf(member) || "").trim();
  const email = String(member?.email || "").trim().toLowerCase();
  const rows = Array.isArray(memberPermissions) ? memberPermissions : [];
  return (
    rows.find((row) => {
      const ids = [row.member_id, row.id, row.uid, row.user_id].filter(Boolean).map(String);
      if (mid && ids.includes(mid)) return true;
      const rowEmail = String(row.email || "").trim().toLowerCase();
      return Boolean(email && rowEmail && email === rowEmail);
    }) || null
  );
}

export function FamilyGovernancePanel({
  t,
  digits,
  currencyName,
  activeFamily,
  currentUser,
  email,
  myPermissions,
  governanceMembers = [],
  memberPermissions = [],
  permissionSavingMemberId = "",
  toggleMemberPermission,
  joinRequests = [],
  governanceLoading,
  inviteForm,
  setInviteForm,
  inviteGenerating,
  generatedInvite,
  onRefresh,
  onGenerateInvite,
  onInviteEmail,
  onInviteLink,
  onRevokeInvite,
  inviteRevoking = false,
  onDecideJoinRequest,
  onJoinFamily,
  apiGet,
  apiPost,
  apiPatch,
  apiDelete,
  activeFamilyId,
  cloudMode = false,
  activeTab = null,
  onTabChange,
}) {
  const [tab, setTab] = useState(activeTab || "members");
  const [copied, setCopied] = useState(false);
  const [decidingId, setDecidingId] = useState("");
  const [joinForm, setJoinForm] = useState({ ...EMPTY_JOIN });
  const [joining, setJoining] = useState(false);
  const [roleBusyId, setRoleBusyId] = useState("");
  const [roleDraftByMember, setRoleDraftByMember] = useState({});
  const [relationBusyId, setRelationBusyId] = useState("");
  const [memberBusyId, setMemberBusyId] = useState("");
  const [deactivateBusy, setDeactivateBusy] = useState(false);
  const [initialFetchDone, setInitialFetchDone] = useState(false);
  const [transferMemberId, setTransferMemberId] = useState("");
  const [transferNote, setTransferNote] = useState("");
  const [transfers, setTransfers] = useState([]);
  const [transferBusy, setTransferBusy] = useState("");
  const [banner, setBanner] = useState(null);

  function flash(message, type = "error") {
    const text = String(message || "").trim();
    if (!text) return;
    setBanner({ text, type });
    window.setTimeout(() => {
      setBanner((prev) => (prev?.text === text ? null : prev));
    }, 4200);
  }

  // Auto-fetch members as soon as family context is ready — do not wait for Refresh.
  useEffect(() => {
    if (!activeFamilyId || !onRefresh) return undefined;
    let cancelled = false;
    setInitialFetchDone(false);
    const timeoutId = window.setTimeout(async () => {
      try {
        await Promise.resolve(onRefresh());
      } finally {
        if (!cancelled) setInitialFetchDone(true);
      }
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
    // Only when family id is ready — avoid re-fetch loops from unstable onRefresh identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFamilyId]);

  const role = useMemo(
    () =>
      resolveMyGlobalRole({
        myPermissions,
        governanceMembers,
        currentUser,
        email,
        activeFamily,
        loadingLabel: t("loading"),
      }),
    [myPermissions, governanceMembers, currentUser, email, activeFamily, t],
  );
  const isOwner = String(role).toUpperCase().includes("OWNER");
  const familyId = activeFamilyId || activeFamily?.id;
  const showMemberSkeleton =
    Boolean(activeFamilyId) &&
    governanceMembers.length === 0 &&
    (governanceLoading || !initialFetchDone);
  const uiLang =
    typeof document !== "undefined" ? document.documentElement.lang || "en" : "en";
  const memberCount = governanceMembers.length;
  const owners = governanceMembers.filter((m) =>
    String(m.role || m.member_role || "").toUpperCase().includes("OWNER")
  ).length;
  const activeCount = governanceMembers.filter((m) => {
    const status = String(m.status || (m.is_active ? "ACTIVE" : "")).toUpperCase();
    return status === "ACTIVE" || m.is_active;
  }).length;

  const myMemberId =
    myPermissions?.member_id ||
    myPermissions?.uid ||
    myPermissions?.user_id ||
    memberIdOf(
      governanceMembers.find((m) => {
        const memberUid = String(m.user_id || m.uid || m.member_id || m.id || "").trim();
        const myUid = String(
          currentUser?.uid || currentUser?.firebase_uid || currentUser?.id || currentUser?.user_id || "",
        ).trim();
        if (myUid && memberUid && memberUid === myUid) return true;
        return (
          String(m.email || m.user_email || "").toLowerCase() ===
          String(currentUser?.email || email || "").toLowerCase()
        );
      }) || {},
    ) ||
    String(currentUser?.uid || currentUser?.firebase_uid || "").trim();

  const loadTransfers = useCallback(async () => {
    if (!familyId || !apiGet) return;
    try {
      const rows = await apiGet(`/families/${familyId}/ownership-transfer`);
      setTransfers(Array.isArray(rows) ? rows : rows?.transfers || []);
    } catch {
      setTransfers([]);
    }
    // apiGet identity changes every render — depend only on familyId
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyId]);

  useEffect(() => {
    void loadTransfers();
  }, [loadTransfers]);

  async function copyInviteCode() {
    const code = String(generatedInvite?.invite_code || generatedInvite?.code || "").trim();
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  async function setMemberRole(member, nextRole) {
    const mid = memberIdOf(member);
    if (!mid || !familyId || !apiPatch) return;
    const current = String(member.role || member.member_role || "MEMBER").toUpperCase();
    if (current === nextRole && !roleDraftByMember[mid]) return;

    // Instant UI — do not wait for refresh (avoids "stuck open" / delayed chip state)
    setRoleDraftByMember((prev) => ({ ...prev, [mid]: nextRole }));
    setRoleBusyId(mid);
    try {
      await apiPatch(`/families/${familyId}/members/${mid}/role`, { role: nextRole });
      flash(t("roleUpdatedOk") || "Role updated", "success");
      await onRefresh?.();
      setRoleDraftByMember((prev) => {
        const next = { ...prev };
        delete next[mid];
        return next;
      });
    } catch (err) {
      setRoleDraftByMember((prev) => {
        const next = { ...prev };
        delete next[mid];
        return next;
      });
      flash(err?.message || t("roleUpdateFailed") || "Role update failed", "error");
    } finally {
      setRoleBusyId("");
    }
  }

  async function setMemberRelationship(member, nextRelation) {
    const mid = memberIdOf(member);
    const relation = String(nextRelation || "").trim();
    if (!mid || !familyId || !apiPatch || !relation) return;
    const current =
      member.relationship_display_label ||
      member.relationship_type ||
      member.relationship ||
      "";
    if (String(current).trim() === relation) return;
    setRelationBusyId(mid);
    try {
      await apiPatch(`/families/${familyId}/members/${mid}/relationship`, {
        relationship_type: relation,
        relationship: relation,
      });
      flash(t("relationshipUpdatedOk") || "Relationship updated", "success");
      await onRefresh?.();
    } catch (err) {
      flash(err?.message || t("relationshipUpdateFailed") || "Relationship update failed", "error");
    } finally {
      setRelationBusyId("");
    }
  }

  async function removeMember(member) {
    const mid = memberIdOf(member);
    if (!mid || !familyId || !apiDelete) return;
    if (!window.confirm(t("confirmRemoveMember") || "Remove this member from the family?")) return;
    setMemberBusyId(mid);
    try {
      await apiDelete(`/families/${familyId}/members/${mid}`);
      flash(t("memberRemovedOk") || "Member removed", "success");
      await onRefresh?.();
    } catch (err) {
      flash(err?.message || t("memberRemoveFailed") || "Remove member failed", "error");
    } finally {
      setMemberBusyId("");
    }
  }

  async function deactivateFamily() {
    if (!familyId || !apiPost || !isOwner) return;
    if (!window.confirm(t("confirmDeactivateFamily") || "Deactivate / archive this family?")) return;
    setDeactivateBusy(true);
    try {
      await apiPost(`/families/${familyId}/deactivate`, {});
      flash(t("familyDeactivatedOk") || "Family archived", "success");
      await onRefresh?.();
    } catch (err) {
      flash(err?.message || t("familyDeactivateFailed") || "Deactivate failed", "error");
    } finally {
      setDeactivateBusy(false);
    }
  }

  async function requestOwnershipTransfer() {
    if (!transferMemberId || !familyId || !apiPost) return;
    setTransferBusy("request");
    try {
      await apiPost(`/families/${familyId}/ownership-transfer`, {
        to_member_id: transferMemberId,
        note: transferNote.trim() || null,
      });
      setTransferNote("");
      flash(t("ownershipTransferRequested") || "Ownership transfer requested", "success");
      await loadTransfers();
    } catch (err) {
      flash(err?.message || "Ownership transfer failed", "error");
    } finally {
      setTransferBusy("");
    }
  }

  async function acceptTransfer(requestId) {
    if (!familyId || !apiPost) return;
    setTransferBusy(requestId);
    try {
      await apiPost(`/families/${familyId}/ownership-transfer/${requestId}/accept`, {});
      flash(t("ownershipTransferAccepted") || "Ownership transferred", "success");
      await loadTransfers();
      await onRefresh?.();
    } catch (err) {
      flash(err?.message || "Accept transfer failed", "error");
    } finally {
      setTransferBusy("");
    }
  }

  async function adminApproveTransfer(requestId) {
    if (!familyId || !apiPost) return;
    setTransferBusy(requestId);
    try {
      await apiPost(`/families/${familyId}/ownership-transfer/${requestId}/admin-approve`, {});
      await loadTransfers();
      await onRefresh?.();
    } catch (err) {
      flash(err?.message || "Approve transfer failed", "error");
    } finally {
      setTransferBusy("");
    }
  }

  async function cancelTransfer(requestId) {
    if (!familyId || !apiPost) return;
    setTransferBusy(requestId);
    try {
      await apiPost(`/families/${familyId}/ownership-transfer/${requestId}/cancel`, {});
      await loadTransfers();
    } catch (err) {
      flash(err?.message || "Cancel transfer failed", "error");
    } finally {
      setTransferBusy("");
    }
  }

  const pendingTransfers = transfers.filter((row) =>
    ["PENDING", "PENDING_ADMIN", "PENDING_ACCEPT"].includes(String(row.status || "").toUpperCase())
  );

  useEffect(() => {
    if (activeTab) setTab(activeTab);
  }, [activeTab]);

  useEffect(() => {
    if (!(generatedInvite?.invite_code || generatedInvite?.code)) return;
    setTab("invite");
    onTabChange?.("invite");
    const id = window.setTimeout(() => {
      document.getElementById("latest-invite-code")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 120);
    return () => window.clearTimeout(id);
  }, [generatedInvite?.invite_code, generatedInvite?.code, onTabChange]);

  const displayInviteCode = String(generatedInvite?.invite_code || generatedInvite?.code || "").trim();

  const transferCandidates = governanceMembers.filter((m) => {
    const mid = memberIdOf(m);
    const roleValue = String(m.role || m.member_role || "").toUpperCase();
    return mid && !roleValue.includes("OWNER");
  });

  return (
    <section className="panel settings-panel settings-smart finance-smart family-smart">
      <div className="settings-head">
        <div>
          <p className="settings-kicker">{t("familyGovernance")}</p>
          <h2>{t("familyGovernance")}</h2>
        </div>
        <button
          type="button"
          className="btn"
          disabled={governanceLoading}
          onClick={() => {
            onRefresh?.();
            void loadTransfers();
          }}
        >
          {governanceLoading ? t("loading") : t("refreshFamily")}
        </button>
      </div>

      {banner ? (
        <p className={banner.type === "success" ? "status ok" : "status error"} role="status">
          {banner.text}
        </p>
      ) : null}

      <div className="settings-tabs" role="tablist">
        {TABS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? "settings-tab active" : "settings-tab"}
            onClick={() => {
              setTab(key);
              onTabChange?.(key);
            }}
          >
            {key === "members"
              ? t("members")
              : key === "invite"
                ? t("invite")
                : key === "join"
                  ? t("joinFamily") || "Join"
                  : `${t("joinRequests") || "Join requests"}${joinRequests.length ? ` (${digits(joinRequests.length)})` : ""}`}
          </button>
        ))}
      </div>

      <div className="settings-identity">
        <div className="sync-health ok family-avatar-mark">
          <strong>
            {String(activeFamily?.name || "S4")
              .trim()
              .slice(0, 2)
              .toUpperCase()}
          </strong>
          <span>{t("activeFamilyLabel")}</span>
        </div>
        <div className="settings-identity-copy">
          <h3>{activeFamily?.name || t("selectedFamily")}</h3>
          <p className="budget-hero-sub">
            {t("currency")}: {currencyName(activeFamily?.default_currency)} · {t("timezone")}:{" "}
            {activeFamily?.timezone || "N/A"}
          </p>
          <p className="budget-hero-sub" style={{ marginTop: 2 }}>
            {t("myRole")}: {String(role).toUpperCase()} · {currentUser?.email || email || "—"}
          </p>
          <div className="settings-badges">
            <TypeChip type={roleTone(role)} className="family-my-role-chip">
              {String(role).toUpperCase()}
            </TypeChip>
            <TypeChip type="TRANSFER">
              {showMemberSkeleton ? t("loading") : `${digits(memberCount)} ${t("members")}`}
            </TypeChip>
          </div>
        </div>
      </div>

      <div className="settings-stat-row">
        <div className="settings-stat">
          <span>{t("members")}</span>
          <strong>
            {showMemberSkeleton ? <span className="family-stat-shimmer" aria-hidden="true" /> : digits(memberCount)}
          </strong>
        </div>
        <div className="settings-stat">
          <span>{t("activeStatus")}</span>
          <strong>
            {showMemberSkeleton ? <span className="family-stat-shimmer" aria-hidden="true" /> : digits(activeCount)}
          </strong>
        </div>
        <div className="settings-stat">
          <span>{t("myRole")}</span>
          <strong>
            {showMemberSkeleton && !myPermissions && role === t("loading") ? (
              <span className="family-stat-shimmer" aria-hidden="true" />
            ) : (
              <TypeChip type={roleTone(role)} className="family-my-role-chip">
                {String(role).toUpperCase()}
              </TypeChip>
            )}
          </strong>
        </div>
        <div className="settings-stat">
          <span>Owner</span>
          <strong>
            {showMemberSkeleton ? <span className="family-stat-shimmer" aria-hidden="true" /> : digits(owners || 1)}
          </strong>
        </div>
      </div>

      {tab === "members" ? (
        <div className="settings-stack">
          <div className="settings-block">
            <div className="settings-block-head">
              <div>
                <h4>{t("members")}</h4>
                <p>
                  {showMemberSkeleton
                    ? t("loading")
                    : `${digits(memberCount)} ${t("members")} · ${digits(activeCount)} ${t("activeStatus")}`}
                </p>
              </div>
            </div>

            {showMemberSkeleton ? (
              <div className="family-member-skeleton" aria-busy="true" aria-live="polite">
                <div className="family-member-skeleton-row" />
                <div className="family-member-skeleton-row" />
                <div className="family-member-skeleton-row" />
              </div>
            ) : governanceMembers.length === 0 ? (
              <p className="settings-empty">{t("noFamilyMemberData")}</p>
            ) : (
              <div className="finance-feed">
                {governanceMembers.map((member) => {
                  const mid = memberIdOf(member);
                  const roleValue = String(
                    roleDraftByMember[mid] || member.role || member.member_role || "MEMBER",
                  ).toUpperCase();
                  const statusValue = String(
                    member.status || (member.is_active ? "ACTIVE" : "UNKNOWN")
                  ).toUpperCase();
                  const relation =
                    member.relationship_display_label ||
                    member.relationship_type ||
                    member.relationship ||
                    "Family Member";
                  const idValue = member.user_id || member.member_user_id || member.id;
                  const canToggleRole = isOwner && mid && !roleValue.includes("OWNER");
                  const canEditRelation = Boolean(isOwner && mid && apiPatch);
                  const canEditCapabilities = Boolean(
                    isOwner &&
                      mid &&
                      toggleMemberPermission &&
                      !roleValue.includes("OWNER") &&
                      !roleValue.includes("ADMIN"),
                  );
                  const canRemove = isOwner && mid && !roleValue.includes("OWNER");
                  const relationOptions = roleValue.includes("OWNER")
                    ? OWNER_RELATIONSHIPS
                    : JOIN_RELATIONSHIPS;
                  const permRow = findPermissionRow(memberPermissions, member);
                  const effectiveCaps = resolveMemberCapabilities(
                    {
                      ...member,
                      role: roleValue,
                      normalized_role: roleValue,
                    },
                    permRow,
                  );
                  const savingCaps =
                    permissionSavingMemberId &&
                    (String(permissionSavingMemberId) === String(mid) ||
                      String(permissionSavingMemberId) === String(permRow?.member_id || ""));
                  const capsTitle =
                    String(uiLang).startsWith("bn")
                      ? "কী কী করতে পারবে"
                      : "What they can do";
                  const capsHint =
                    String(uiLang).startsWith("bn")
                      ? roleValue === "VIEWER"
                        ? "VIEWER = মূলত শুধু দেখা — নিচে টগল দিয়ে বাড়াতে পারবেন"
                        : roleValue === "CHILD"
                          ? "CHILD = সীমিত অ্যাক্সেস — নিচে টগল দিয়ে অ্যাডজাস্ট করুন"
                          : "Owner Wife / সদস্যের অ্যাক্সেস সেট করে — MEMBER/VIEWER/CHILD-এ টগল কাজ করে"
                      : roleValue === "VIEWER"
                        ? "VIEWER = view-only baseline — open more with toggles below"
                        : roleValue === "CHILD"
                          ? "CHILD = limited access — adjust with toggles below"
                          : "Owner sets Wife / member access — toggles work on MEMBER / VIEWER / CHILD";
                  return (
                    <div className="finance-card tx-card is-savings family-member-card" key={idValue || mid}>
                      <div className="tx-row family-member-row">
                        <div className="family-member-avatar" aria-hidden="true">
                          {memberInitials(member, t)}
                        </div>
                        <div className="tx-row-copy">
                          <strong title={memberLabel(member, t)}>{memberLabel(member, t)}</strong>
                          <span className="tx-row-sub">
                            {relation}
                            {idValue ? ` · ${shortId(idValue)}` : ""}
                          </span>
                        </div>
                        <div className="family-member-tags">
                          <TypeChip type={roleTone(roleValue)}>{roleValue}</TypeChip>
                          <TypeChip type={statusValue === "ACTIVE" ? "INCOME" : "PENDING"}>
                            {statusValue}
                          </TypeChip>
                        </div>
                      </div>
                      {canEditRelation || canToggleRole || canRemove || canEditCapabilities || (isOwner && !roleValue.includes("OWNER")) ? (
                        <div className="family-member-actions">
                          {canEditRelation ? (
                            <label className="family-member-relation">
                              <span className="family-member-relation-label">
                                {t("relationship") || "Relationship"}
                              </span>
                              <select
                                aria-label={t("relationship") || "Relationship"}
                                value={
                                  relationOptions.includes(relation)
                                    ? relation
                                    : relation || relationOptions[0]
                                }
                                disabled={relationBusyId === mid}
                                onChange={(e) => void setMemberRelationship(member, e.target.value)}
                              >
                                {!relationOptions.includes(relation) && relation ? (
                                  <option value={relation}>{relation}</option>
                                ) : null}
                                {relationOptions.map((opt) => (
                                  <option key={opt} value={opt}>
                                    {opt}
                                  </option>
                                ))}
                              </select>
                            </label>
                          ) : null}
                          {canToggleRole ? (
                            <div className="family-member-role-block">
                              <span className="family-member-relation-label">
                                {t("accessLevelRole") ||
                                  (String(uiLang).startsWith("bn")
                                    ? "অ্যাক্সেস লেভেল (রোল)"
                                    : "Access level (role)")}
                              </span>
                              <div className="family-member-role-btns" role="group" aria-label={t("role") || "Role"}>
                                {FAMILY_ASSIGNABLE_ROLES.map((nextRole) => (
                                  <button
                                    key={nextRole}
                                    type="button"
                                    className={`btn family-role-chip${roleValue === nextRole ? " is-active" : ""}`}
                                    aria-pressed={roleValue === nextRole}
                                    disabled={roleBusyId === mid}
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      if (roleValue === nextRole) return;
                                      void setMemberRole(member, nextRole);
                                    }}
                                  >
                                    {nextRole}
                                  </button>
                                ))}
                              </div>
                              <p className="family-member-caps-hint">
                                {roleHelpText(roleValue, uiLang) ||
                                  (String(uiLang).startsWith("bn")
                                    ? "MEMBER রাখুন যদি নিচে আলাদা অনুমতি সেট করতে চান"
                                    : "Keep MEMBER to set individual permissions below")}
                              </p>
                            </div>
                          ) : null}
                          {canEditCapabilities ? (
                            <div className="family-member-caps">
                              <div className="family-member-caps-head">
                                <span className="family-member-relation-label">{capsTitle}</span>
                                <span className="family-member-caps-hint">{capsHint}</span>
                              </div>
                              <ul className="permissions-toggle-list family-caps-list">
                                {MEMBER_CAPABILITY_TOGGLES.map((item) => {
                                  const on = hasEffectivePermission(effectiveCaps, item.key);
                                  const label = capabilityLabel(item, uiLang);
                                  return (
                                    <li key={item.key}>
                                      <span className="permissions-toggle-label">{label}</span>
                                      <label className="perm-switch">
                                        <input
                                          type="checkbox"
                                          checked={on}
                                          disabled={Boolean(savingCaps)}
                                          onChange={(e) => {
                                            e.stopPropagation();
                                            toggleMemberPermission?.(
                                              {
                                                ...member,
                                                ...(permRow || {}),
                                                member_id: mid,
                                                uid: member.uid || permRow?.uid || mid,
                                                user_id: member.user_id || permRow?.user_id || mid,
                                                normalized_role: roleValue,
                                                role: roleValue,
                                              },
                                              item.key,
                                              e.target.checked,
                                            );
                                          }}
                                          aria-label={label}
                                        />
                                        <span className="perm-switch-ui" aria-hidden="true" />
                                      </label>
                                    </li>
                                  );
                                })}
                              </ul>
                            </div>
                          ) : isOwner && mid && roleValue.includes("ADMIN") ? (
                            <p className="family-member-caps-hint family-admin-note">
                              {t("adminFullAccessHint") ||
                                (String(uiLang).startsWith("bn")
                                  ? "ADMIN = ফুল অ্যাক্সেস। আলাদা টগল দেখতে রোল MEMBER / VIEWER / CHILD করুন।"
                                  : "ADMIN = full access. Switch role to MEMBER / VIEWER / CHILD to set individual toggles.")}
                            </p>
                          ) : null}
                          {canRemove && apiDelete ? (
                            <button
                              type="button"
                              className="btn family-member-remove"
                              disabled={memberBusyId === mid}
                              onClick={() => void removeMember(member)}
                            >
                              {t("removeMember") || "Remove member"}
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="settings-block">
            <div className="settings-block-head">
              <div>
                <h4>{t("ownershipTransfer")}</h4>
                <p>{t("pendingTransfers")}</p>
              </div>
            </div>
            {isOwner ? (
              <div className="finance-form">
                <select
                  aria-label={t("selectMember")}
                  value={transferMemberId}
                  onChange={(e) => setTransferMemberId(e.target.value)}
                >
                  <option value="">{t("selectMember")}</option>
                  {transferCandidates.map((member) => (
                    <option key={memberIdOf(member)} value={memberIdOf(member)}>
                      {memberLabel(member, t)} · {String(member.role || "MEMBER").toUpperCase()}
                    </option>
                  ))}
                </select>
                <input
                  placeholder={t("note") || "Note"}
                  value={transferNote}
                  onChange={(e) => setTransferNote(e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!transferMemberId || transferBusy === "request" || pendingTransfers.length > 0}
                  onClick={() => void requestOwnershipTransfer()}
                >
                  {t("requestTransfer")}
                </button>
              </div>
            ) : (
              <p className="settings-empty">{t("ownerOnly") || "Owner only"}</p>
            )}

            {pendingTransfers.length === 0 ? (
              <p className="settings-empty" style={{ marginTop: 12 }}>
                {t("pendingTransfers")}: 0
              </p>
            ) : (
              <div className="finance-feed" style={{ marginTop: 12 }}>
                {pendingTransfers.map((row) => {
                  const status = String(row.status || "PENDING").toUpperCase();
                  const canAccept =
                    status === "PENDING_ACCEPT" &&
                    Boolean(myMemberId) &&
                    (String(row.to_member_id || "") === String(myMemberId) ||
                      String(row.to_member_id || "") ===
                        String(currentUser?.uid || currentUser?.firebase_uid || ""));
                  const canAdminApprove =
                    ["PENDING_ADMIN", "PENDING"].includes(status) &&
                    String(role || "").toUpperCase().includes("ADMIN") &&
                    String(row.from_member_id || "") !== String(myMemberId || "") &&
                    String(row.to_member_id || "") !== String(myMemberId || "");
                  const canCancel = isOwner || String(row.from_member_id || "") === String(myMemberId || "");
                  return (
                    <div className="finance-card tx-card is-savings" key={row.id}>
                      <div className="tx-row">
                        <div className="tx-row-copy">
                          <strong>{t("ownershipTransfer")}</strong>
                          <span className="tx-row-sub">
                            {shortId(row.from_member_id)} → {shortId(row.to_member_id)}
                            {row.note ? ` · ${row.note}` : ""}
                          </span>
                        </div>
                        <TypeChip type="PENDING">{status}</TypeChip>
                      </div>
                      <div className="finance-form" style={{ marginTop: 10 }}>
                        {canAdminApprove ? (
                          <button
                            type="button"
                            className="btn btn-primary"
                            disabled={transferBusy === row.id}
                            onClick={() => void adminApproveTransfer(row.id)}
                          >
                            {t("adminApproveTransfer") || "Admin approve"}
                          </button>
                        ) : null}
                        {canAccept ? (
                          <button
                            type="button"
                            className="btn btn-primary"
                            disabled={transferBusy === row.id}
                            onClick={() => void acceptTransfer(row.id)}
                          >
                            {t("acceptTransfer")}
                          </button>
                        ) : null}
                        {canCancel ? (
                          <button
                            type="button"
                            className="btn"
                            disabled={transferBusy === row.id}
                            onClick={() => void cancelTransfer(row.id)}
                          >
                            {t("cancelTransfer")}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {isOwner ? (
            <div className="settings-block">
              <h4>{t("deactivateFamily") || "Deactivate family"}</h4>
              <p className="budget-hero-sub" style={{ marginTop: 4 }}>
                {t("deactivateFamilyHint") || "Archive this family. Cancel any pending ownership transfer first."}
              </p>
              <button
                type="button"
                className="btn"
                disabled={deactivateBusy}
                onClick={() => void deactivateFamily()}
              >
                {deactivateBusy ? t("loading") : t("deactivateFamily") || "Deactivate family"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === "invite" ? (
        <div className="settings-stack">
          <div className="settings-block">
            <h4>{t("generateInvite")}</h4>
            <p className="budget-hero-sub" style={{ marginTop: 4 }}>
              {t("inviteShareCodeHint") ||
                "Primary flow: generate a code and share it manually (WhatsApp, SMS, in person). Email send is optional and only works if SMTP is configured on a backend — cloud Firebase mode does not send mail."}
            </p>
            <div className="finance-form">
              <input
                aria-label={t("expiresInDays")}
                placeholder={t("expiresInDays")}
                value={inviteForm.expires_in_days}
                onChange={(e) => setInviteForm({ ...inviteForm, expires_in_days: e.target.value })}
              />
              <input
                aria-label={t("maxUses")}
                placeholder={t("maxUses")}
                value={inviteForm.max_uses}
                onChange={(e) => setInviteForm({ ...inviteForm, max_uses: e.target.value })}
              />
              <input
                aria-label="Email (optional note)"
                placeholder="invitee@email.com (optional note)"
                value={inviteForm.invitee_email || ""}
                onChange={(e) => setInviteForm({ ...inviteForm, invitee_email: e.target.value })}
              />
              {!cloudMode ? (
                <label className="settings-check">
                  <input
                    type="checkbox"
                    checked={Boolean(inviteForm.send_email)}
                    onChange={(e) => setInviteForm({ ...inviteForm, send_email: e.target.checked })}
                  />
                  Request SMTP email (optional / backend only)
                </label>
              ) : null}
              <button
                type="button"
                className="btn btn-primary"
                disabled={inviteGenerating}
                onClick={onGenerateInvite}
              >
                {inviteGenerating ? t("generating") : t("generateInvite")}
              </button>
              {onInviteLink ? (
                <button type="button" className="btn" disabled={inviteGenerating} onClick={onInviteLink}>
                  Create invite link
                </button>
              ) : null}
              {!cloudMode && onInviteEmail ? (
                <button
                  type="button"
                  className="btn"
                  disabled={inviteGenerating || !(inviteForm.invitee_email || "").includes("@")}
                  onClick={onInviteEmail}
                  title="Requires optional SMTP on PC backend — not used in Firebase cloud mode"
                >
                  Email invite (optional SMTP)
                </button>
              ) : null}
            </div>
          </div>

          {displayInviteCode ? (
            <div className="settings-block invite-success-block" id="latest-invite-code">
              <h4>{t("latestInviteCode")}</h4>
              <p className="budget-hero-sub" style={{ marginBottom: 8 }}>
                {t("inviteShareNowHint") ||
                  "Cloud publish OK — copy this code and share now (WhatsApp / SMS). Do not wait for notifications."}
              </p>
              <div className="invite-code-card invite-code-card--success">
                <div className="invite-code-main">
                  <span className="invite-code-label">{t("latestInviteCode")}</span>
                  <strong className="invite-code-value">{displayInviteCode}</strong>
                  {generatedInvite.invite_link ? (
                    <p className="budget-hero-sub" style={{ marginTop: 8, wordBreak: "break-all" }}>
                      Link: {generatedInvite.invite_link}
                    </p>
                  ) : null}
                  {generatedInvite.invitee_email ? (
                    <p className="budget-hero-sub">Email: {generatedInvite.invitee_email}</p>
                  ) : null}
                  <div className="settings-badges" style={{ marginTop: 10 }}>
                    <TypeChip type="TRANSFER">
                      {t("expiresInDays")}: {digits(generatedInvite.expires_in_days)}
                    </TypeChip>
                    <TypeChip type="SAVINGS">
                      {t("maxUses")}: {digits(generatedInvite.max_uses)}
                    </TypeChip>
                    <TypeChip type="INCOME">CLOUD OK</TypeChip>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button type="button" className="btn btn-primary" onClick={copyInviteCode}>
                    {copied ? "Copied" : "Copy"}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={inviteRevoking || !onRevokeInvite || !(generatedInvite?.invite_id || generatedInvite?.id)}
                    onClick={() => onRevokeInvite?.(generatedInvite?.invite_id || generatedInvite?.id)}
                  >
                    {inviteRevoking
                      ? t("revokingInvite") || "Revoking..."
                      : t("revokeInvite") || "Revoke"}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="settings-block">
              <p className="settings-empty">
                {t("inviteCodeEmptyHint") ||
                  "Generate invite — the live code will appear here immediately after success."}
              </p>
            </div>
          )}
        </div>
      ) : null}

      {tab === "join" ? (
        <div className="settings-stack">
          <div className="settings-block">
            <h4>{t("joinFamily") || "Join with invite"}</h4>
            <p className="budget-hero-sub" style={{ marginTop: 4 }}>
              {t("joinFamilyHintCloud") || t("joinFamilyHint") || "Enter an invite code to join another family."}
            </p>
            <div className="finance-form">
              <input
                aria-label={t("inviteCode") || "Invite code"}
                placeholder={t("inviteCode") || "Invite code"}
                value={joinForm.invite_code}
                onChange={(e) => setJoinForm({ ...joinForm, invite_code: e.target.value })}
              />
              <select
                aria-label={t("relationship") || "Relationship"}
                value={joinForm.relationship_type}
                onChange={(e) =>
                  setJoinForm({
                    ...joinForm,
                    relationship_type: e.target.value,
                    serial_label: "",
                    relationship_serial: "",
                    linked_member_id: "",
                    relationship_note: "",
                  })
                }
              >
                {JOIN_RELATIONSHIPS.map((rel) => (
                  <option key={rel} value={rel}>
                    {rel}
                  </option>
                ))}
              </select>
              {needsSerial(joinForm.relationship_type) ? (
                <select
                  aria-label={t("serialLabel") || "Serial label"}
                  value={joinForm.serial_label}
                  onChange={(e) => setJoinForm({ ...joinForm, serial_label: e.target.value })}
                >
                  <option value="">{t("serialLabel") || "Serial label"}</option>
                  {serialLabelsFor(joinForm.relationship_type).map((label) => (
                    <option key={label} value={label}>
                      {label}
                    </option>
                  ))}
                </select>
              ) : null}
              {joinForm.serial_label === "CUSTOM" || needsSerial(joinForm.relationship_type) ? (
                <input
                  aria-label={t("serial") || "Serial"}
                  placeholder={t("serial") || "Serial # (optional / custom)"}
                  value={joinForm.relationship_serial}
                  onChange={(e) => setJoinForm({ ...joinForm, relationship_serial: e.target.value })}
                />
              ) : null}
              {needsLinkedMember(joinForm.relationship_type) ? (
                <select
                  aria-label={t("linkedMember") || "Linked member"}
                  value={joinForm.linked_member_id}
                  onChange={(e) => setJoinForm({ ...joinForm, linked_member_id: e.target.value })}
                >
                  <option value="">{t("linkedMember") || "Link to child/member"}</option>
                  {governanceMembers.map((m) => (
                    <option key={memberIdOf(m)} value={memberIdOf(m)}>
                      {memberLabel(m, t)}
                    </option>
                  ))}
                </select>
              ) : null}
              {needsRelationshipNote(joinForm.relationship_type) ? (
                <input
                  aria-label={t("relationshipNote") || "Relationship note"}
                  placeholder={t("relationshipNote") || "Relationship note (required)"}
                  value={joinForm.relationship_note}
                  onChange={(e) => setJoinForm({ ...joinForm, relationship_note: e.target.value })}
                />
              ) : null}
              <button
                type="button"
                className="btn btn-primary"
                disabled={joining || !onJoinFamily}
                onClick={async () => {
                  if (needsRelationshipNote(joinForm.relationship_type) && !joinForm.relationship_note.trim()) {
                    window.alert(t("relationshipNoteRequired") || "Relationship note required");
                    return;
                  }
                  if (needsLinkedMember(joinForm.relationship_type) && !joinForm.linked_member_id.trim()) {
                    window.alert(t("linkedMemberRequired") || "Linked member required for in-law");
                    return;
                  }
                  setJoining(true);
                  try {
                    await onJoinFamily?.(buildJoinInvitePayload(joinForm));
                    setJoinForm({ ...EMPTY_JOIN });
                  } catch (err) {
                    flash(err?.message || t("joinFailedGate") || "Join failed", "error");
                  } finally {
                    setJoining(false);
                  }
                }}
              >
                {joining ? t("loading") : t("joinFamily") || "Join family"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {tab === "requests" ? (
        <div className="settings-stack">
          <div className="settings-block">
            <div className="settings-block-head">
              <div>
                <h4>{t("joinRequests") || "Join requests"}</h4>
                <p>{t("joinRequestsHint") || "Owner can approve or reject pending join requests."}</p>
              </div>
            </div>

            {governanceLoading ? (
              <p className="settings-empty">{t("loading")}</p>
            ) : joinRequests.length === 0 ? (
              <p className="settings-empty">{t("noJoinRequests") || "No pending join requests"}</p>
            ) : (
              <div className="finance-feed">
                {joinRequests.map((request) => {
                  const requestId = request.request_id || request.id;
                  return (
                    <div className="finance-card tx-card is-savings family-member-card" key={requestId}>
                      <div className="tx-row family-member-row">
                        <div className="tx-row-copy">
                          <strong>{shortId(request.user_id)}</strong>
                          <span className="tx-row-sub">
                            {request.relationship || request.requested_role || "Member"}
                            {request.relationship_serial != null ? ` · #${digits(request.relationship_serial)}` : ""}
                          </span>
                        </div>
                        <div className="family-member-tags">
                          <TypeChip type="PENDING">{String(request.status || "PENDING").toUpperCase()}</TypeChip>
                        </div>
                      </div>
                      <div className="finance-form" style={{ marginTop: 10 }}>
                        <button
                          type="button"
                          className="btn btn-primary"
                          disabled={decidingId === requestId || !onDecideJoinRequest}
                          onClick={async () => {
                            setDecidingId(requestId);
                            try {
                              await onDecideJoinRequest(requestId, "APPROVE");
                            } catch (err) {
                              flash(err?.message || "Approve failed", "error");
                            } finally {
                              setDecidingId("");
                            }
                          }}
                        >
                          {t("approve") || "Approve"}
                        </button>
                        <button
                          type="button"
                          className="btn"
                          disabled={decidingId === requestId || !onDecideJoinRequest}
                          onClick={async () => {
                            setDecidingId(requestId);
                            try {
                              await onDecideJoinRequest(requestId, "REJECT");
                            } catch (err) {
                              flash(err?.message || "Reject failed", "error");
                            } finally {
                              setDecidingId("");
                            }
                          }}
                        >
                          {t("reject") || "Reject"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
