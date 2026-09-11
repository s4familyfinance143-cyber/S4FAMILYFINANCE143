import React, { useCallback, useEffect, useState } from "react";
import { Pressable, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { tMobile, type MobileLang } from "../../i18n";
import {
  JOIN_RELATIONSHIPS,
  buildJoinInvitePayload,
  needsLinkedMember,
  needsRelationshipNote,
  needsSerial,
  serialLabelsFor,
} from "../../lib/familyRelationships";

type JoinRequest = {
  request_id: string;
  user_id?: string;
  status?: string;
  requested_role?: string;
  relationship?: string;
  relationship_serial?: number | null;
  created_at?: string;
};

type MemberPerms = {
  member_id: string;
  user_id?: string;
  role?: string;
  relationship?: string;
  effective_permissions?: string[] | Record<string, boolean>;
  overrides?: { permission_key: string; allow: boolean; scope?: string }[];
};

type Props = {
  token: string;
  familyId: string;
  apiGet: (path: string, authToken?: string) => Promise<any>;
  apiPost: (path: string, body: object, authToken?: string) => Promise<any>;
  apiPatch: (path: string, body: object, authToken?: string) => Promise<any>;
  apiDelete?: (path: string, authToken?: string) => Promise<any>;
  onMessage: (message: string, ok?: boolean) => void;
  onChanged?: () => void;
  lang?: MobileLang;
};

type GovSub = "INVITE" | "JOIN" | "REQUESTS" | "PERMS" | "MEMBERS";

const COMMON_PERMISSION_KEYS = [
  "dashboard.read",
  "wallet.read",
  "wallet.create",
  "income.create",
  "expense.create",
  "transfer.create",
  "transaction.read",
  "budget.read",
  "budget.create",
  "savings.read",
  "savings.create",
  "loan.read",
  "loan.create",
  "member.invite",
  "report.read",
  "audit.read",
  "settings.manage",
];

function asPermissionList(value: MemberPerms["effective_permissions"]): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (value && typeof value === "object") {
    return Object.entries(value)
      .filter(([, allowed]) => Boolean(allowed))
      .map(([key]) => key);
  }
  return [];
}

export function MobileGovernancePanel({
  token,
  familyId,
  apiGet,
  apiPost,
  apiPatch,
  apiDelete,
  onMessage,
  onChanged,
  lang = "bn",
}: Props) {
  const tm = (key: string) => tMobile(lang, key);
  const [sub, setSub] = useState<GovSub>("INVITE");
  const [loading, setLoading] = useState(false);
  const [me, setMe] = useState<MemberPerms | null>(null);
  const [members, setMembers] = useState<MemberPerms[]>([]);
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [generatedInvite, setGeneratedInvite] = useState<{
    invite_code?: string;
    expires_in_days?: number;
    max_uses?: number;
    invite_id?: string;
    id?: string;
  } | null>(null);
  const [inviteForm, setInviteForm] = useState({ expires_in_days: "7", max_uses: "1" });
  const [joinForm, setJoinForm] = useState({
    invite_code: "",
    relationship_type: "Relative",
    relationship_serial: "",
    serial_label: "",
    linked_member_id: "",
    relationship_note: "",
  });
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [permForm, setPermForm] = useState({ permission_key: "expense.create", allow: true, scope: "family" });
  const [transfers, setTransfers] = useState<any[]>([]);
  const [transferMemberId, setTransferMemberId] = useState("");
  const [transferNote, setTransferNote] = useState("");
  const [roleBusyId, setRoleBusyId] = useState("");
  const [memberBusyId, setMemberBusyId] = useState("");
  const [deactivateBusy, setDeactivateBusy] = useState(false);
  const [transferBusy, setTransferBusy] = useState("");

  const load = useCallback(async () => {
    if (!token || !familyId) return;
    setLoading(true);
    try {
      const mine = await apiGet(`/api/v1/permissions/family/${familyId}/me`, token);
      setMe(mine);

      let memberRows: MemberPerms[] = [];
      try {
        const payload = await apiGet(`/api/v1/permissions/family/${familyId}/members`, token);
        memberRows = Array.isArray(payload) ? payload : payload?.members || [];
      } catch {
        memberRows = [];
      }
      setMembers(memberRows);
      setSelectedMemberId((current) => current || memberRows.find((row) => row.role !== "OWNER")?.member_id || memberRows[0]?.member_id || "");

      let pending: JoinRequest[] = [];
      try {
        const payload = await apiGet(`/api/v1/join-requests/family/${familyId}`, token);
        pending = Array.isArray(payload) ? payload : payload?.requests || [];
      } catch {
        pending = [];
      }
      setRequests(pending);
      try {
        const transferRows = await apiGet(`/api/v1/families/${familyId}/ownership-transfer`, token);
        setTransfers(Array.isArray(transferRows) ? transferRows : transferRows?.transfers || []);
      } catch {
        setTransfers([]);
      }
      onMessage(`Family governance loaded · ${pending.length} pending`, true);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Governance load failed", false);
    } finally {
      setLoading(false);
    }
  }, [apiGet, familyId, onMessage, token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function generateInvite() {
    const expires = Number(inviteForm.expires_in_days || 7);
    const maxUses = Number(inviteForm.max_uses || 1);
    if (!Number.isInteger(expires) || expires < 1 || expires > 30) {
      onMessage("Expiry must be 1-30 days", false);
      return;
    }
    if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 100) {
      onMessage("Max uses must be 1-100", false);
      return;
    }
    setLoading(true);
    try {
      const data = await apiPost(
        `/api/v1/invites/generate/${familyId}`,
        { expires_in_days: expires, max_uses: maxUses },
        token
      );
      setGeneratedInvite(data);
      onMessage(`Invite created: ${data.invite_code}`, true);
      onChanged?.();
    } catch (error) {
      setGeneratedInvite(null);
      onMessage(error instanceof Error ? error.message : "Invite generate failed", false);
    } finally {
      setLoading(false);
    }
  }

  async function submitJoin() {
    if (!joinForm.invite_code.trim()) {
      onMessage(tm("inviteCodeRequired"), false);
      return;
    }
    if (needsRelationshipNote(joinForm.relationship_type) && !joinForm.relationship_note.trim()) {
      onMessage(tm("relationshipNoteRequired") || "Relationship note required", false);
      return;
    }
    if (needsLinkedMember(joinForm.relationship_type) && !joinForm.linked_member_id.trim()) {
      onMessage(tm("linkedMemberRequired") || "Linked member required", false);
      return;
    }
    setLoading(true);
    try {
      const payload = buildJoinInvitePayload(joinForm);
      const data = await apiPost("/api/v1/invites/join", payload, token);
      onMessage(data?.message || `Join request ${data?.status || "submitted"}`, true);
      setJoinForm({
        invite_code: "",
        relationship_type: "Relative",
        relationship_serial: "",
        serial_label: "",
        linked_member_id: "",
        relationship_note: "",
      });
      await load();
      onChanged?.();
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Join failed", false);
    } finally {
      setLoading(false);
    }
  }

  async function decideRequest(requestId: string, action: "APPROVE" | "REJECT") {
    setLoading(true);
    try {
      await apiPost(`/api/v1/join-requests/${requestId}/decision`, { decision: action, action, note: null, reason: null }, token);
      onMessage(`Join request ${action.toLowerCase()}d`, true);
      await load();
      onChanged?.();
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Decision failed", false);
    } finally {
      setLoading(false);
    }
  }

  async function savePermission() {
    if (!selectedMemberId) {
      onMessage(tm("selectMember"), false);
      return;
    }
    if (!permForm.permission_key.trim()) {
      onMessage(tm("permissionKeyRequired"), false);
      return;
    }
    setLoading(true);
    try {
      await apiPatch(
        `/api/v1/permissions/members/${selectedMemberId}`,
        {
          permission_key: permForm.permission_key.trim(),
          allow: permForm.allow,
          scope: permForm.scope || "family",
        },
        token
      );
      onMessage(tm("permissionUpdated"), true);
      await load();
      onChanged?.();
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Permission update failed", false);
    } finally {
      setLoading(false);
    }
  }

  async function setMemberRole(memberId: string, role: "ADMIN" | "MEMBER" | "VIEWER" | "CHILD") {
    setRoleBusyId(memberId);
    try {
      await apiPatch(`/api/v1/families/${familyId}/members/${memberId}/role`, { role }, token);
      onMessage(`Role updated to ${role}`, true);
      await load();
      onChanged?.();
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Role update failed", false);
    } finally {
      setRoleBusyId("");
    }
  }

  async function removeMember(memberId: string) {
    if (!apiDelete) return;
    setMemberBusyId(memberId);
    try {
      await apiDelete(`/api/v1/families/${familyId}/members/${memberId}`, token);
      onMessage(tm("removeMember") || "Member removed", true);
      await load();
      onChanged?.();
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Remove failed", false);
    } finally {
      setMemberBusyId("");
    }
  }

  async function deactivateFamily() {
    setDeactivateBusy(true);
    try {
      await apiPost(`/api/v1/families/${familyId}/deactivate`, {}, token);
      onMessage(tm("deactivateFamily") || "Family deactivated", true);
      onChanged?.();
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Deactivate failed", false);
    } finally {
      setDeactivateBusy(false);
    }
  }

  async function requestOwnershipTransfer() {
    if (!transferMemberId) {
      onMessage(tm("selectMember"), false);
      return;
    }
    setTransferBusy("request");
    try {
      await apiPost(
        `/api/v1/families/${familyId}/ownership-transfer`,
        { to_member_id: transferMemberId, note: transferNote.trim() || null },
        token
      );
      setTransferNote("");
      onMessage(tm("requestTransfer") || "Transfer requested", true);
      await load();
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Transfer request failed", false);
    } finally {
      setTransferBusy("");
    }
  }

  async function acceptTransfer(requestId: string) {
    setTransferBusy(requestId);
    try {
      await apiPost(`/api/v1/families/${familyId}/ownership-transfer/${requestId}/accept`, {}, token);
      onMessage(tm("acceptTransfer") || "Accepted", true);
      await load();
      onChanged?.();
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Accept failed", false);
    } finally {
      setTransferBusy("");
    }
  }

  async function adminApproveTransfer(requestId: string) {
    setTransferBusy(requestId);
    try {
      await apiPost(
        `/api/v1/families/${familyId}/ownership-transfer/${requestId}/admin-approve`,
        {},
        token
      );
      onMessage(tm("adminApproveTransfer") || "Admin approved", true);
      await load();
      onChanged?.();
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Admin approve failed", false);
    } finally {
      setTransferBusy("");
    }
  }

  async function cancelTransfer(requestId: string) {
    setTransferBusy(requestId);
    try {
      await apiPost(`/api/v1/families/${familyId}/ownership-transfer/${requestId}/cancel`, {}, token);
      onMessage(tm("cancelTransfer") || "Cancelled", true);
      await load();
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Cancel failed", false);
    } finally {
      setTransferBusy("");
    }
  }

  const myPerms = asPermissionList(me?.effective_permissions);
  const selectedMember = members.find((row) => row.member_id === selectedMemberId);
  const isOwner = String(me?.role || "").toUpperCase().includes("OWNER");
  const isAdmin = String(me?.role || "").toUpperCase().includes("ADMIN");
  const pendingTransfers = transfers.filter((row) =>
    ["PENDING", "PENDING_ADMIN", "PENDING_ACCEPT"].includes(String(row.status || "").toUpperCase())
  );
  const myMemberId = me?.member_id || "";

  return (
    <View style={styles.panel}>
      <View style={styles.rowBetween}>
        <Text style={styles.panelTitle}>{tm("family")}</Text>
        <Pressable onPress={() => void load()} disabled={loading}>
          <Text style={styles.linkText}>{loading ? "..." : tm("refresh")}</Text>
        </Pressable>
      </View>
      <Text style={styles.muted}>
        {tm("roleLabel")}: {me?.role || "—"} · {myPerms.length} {tm("effectivePerms")}
      </Text>

      <View style={styles.statusRow}>
        {(
          [
            ["MEMBERS", "members"],
            ["INVITE", "generateInvite"],
            ["JOIN", "joinFamily"],
            ["REQUESTS", "requests"],
            ["PERMS", "permsTab"],
          ] as const
        ).map(([id, key]) => (
          <Pressable key={id} onPress={() => setSub(id)}>
            <Text style={[styles.statusPill, sub === id ? styles.ok : null]}>{tm(key)}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.grid}>
        <Metric label={tm("members")} value={String(members.length || (me ? 1 : 0))} />
        <Metric label={tm("pending")} value={String(requests.length)} />
        <Metric label={tm("myPerms")} value={String(myPerms.length)} />
      </View>

      {sub === "MEMBERS" ? (
        <>
          <Text style={styles.sectionLabel}>{tm("members")}</Text>
          {members.length === 0 ? <Text style={styles.muted}>{tm("members")}: 0</Text> : null}
          {members.map((member) => {
            const roleValue = String(member.role || "MEMBER").toUpperCase();
            const canToggle = isOwner && !roleValue.includes("OWNER");
            const canRemove = (isOwner || isAdmin) && !roleValue.includes("OWNER") && !!apiDelete;
            return (
              <View style={styles.listRow} key={member.member_id}>
                <Text style={styles.listTitle}>
                  {member.role || "MEMBER"} · {member.relationship || "—"}
                </Text>
                <Text style={styles.muted}>{member.member_id}</Text>
                {canToggle ? (
                  <View style={styles.statusRow}>
                    {(["MEMBER", "ADMIN", "VIEWER", "CHILD"] as const)
                      .filter((nextRole) => nextRole !== roleValue)
                      .map((nextRole) => (
                        <Pressable
                          key={nextRole}
                          style={styles.secondaryButton}
                          disabled={roleBusyId === member.member_id || loading}
                          onPress={() => void setMemberRole(member.member_id, nextRole)}
                        >
                          <Text style={styles.secondaryButtonText}>{nextRole}</Text>
                        </Pressable>
                      ))}
                  </View>
                ) : null}
                {canRemove ? (
                  <Pressable
                    style={styles.secondaryButton}
                    disabled={memberBusyId === member.member_id || loading}
                    onPress={() => void removeMember(member.member_id)}
                  >
                    <Text style={styles.secondaryButtonText}>{tm("removeMember") || "Remove"}</Text>
                  </Pressable>
                ) : null}
              </View>
            );
          })}

          <Text style={styles.sectionLabel}>{tm("ownershipTransfer") || "Ownership transfer"}</Text>
          {isOwner ? (
            <>
              <Text style={styles.muted}>{tm("selectMember")}</Text>
              <View style={styles.statusRow}>
                {members
                  .filter((m) => !String(m.role || "").toUpperCase().includes("OWNER"))
                  .map((m) => (
                    <Pressable key={m.member_id} onPress={() => setTransferMemberId(m.member_id)}>
                      <Text style={[styles.statusPill, transferMemberId === m.member_id ? styles.ok : null]}>
                        {(m.relationship || m.role || m.member_id).slice(0, 18)}
                      </Text>
                    </Pressable>
                  ))}
              </View>
              <TextInput
                style={styles.input}
                placeholder={tm("note") || "Note"}
                placeholderTextColor="#8aa39a"
                value={transferNote}
                onChangeText={setTransferNote}
              />
              <Pressable
                style={styles.primaryButton}
                disabled={!transferMemberId || transferBusy === "request" || pendingTransfers.length > 0}
                onPress={() => void requestOwnershipTransfer()}
              >
                <Text style={styles.primaryButtonText}>{tm("requestTransfer") || "Request transfer"}</Text>
              </Pressable>
            </>
          ) : (
            <Text style={styles.muted}>{tm("ownerOnly")}</Text>
          )}

          {pendingTransfers.length === 0 ? (
            <Text style={styles.muted}>{tm("pendingTransfers") || "Pending"}: 0</Text>
          ) : (
            pendingTransfers.map((row) => {
              const status = String(row.status || "PENDING").toUpperCase();
              const canAccept =
                status === "PENDING_ACCEPT" && String(row.to_member_id || "") === String(myMemberId || "");
              const canAdminApprove =
                ["PENDING_ADMIN", "PENDING"].includes(status) &&
                isAdmin &&
                String(row.from_member_id || "") !== String(myMemberId || "") &&
                String(row.to_member_id || "") !== String(myMemberId || "");
              const canCancel = isOwner || String(row.from_member_id || "") === String(myMemberId || "");
              return (
                <View style={styles.listRow} key={row.id}>
                  <Text style={styles.listTitle}>
                    {tm("ownershipTransfer") || "Transfer"} · {status}
                  </Text>
                  <Text style={styles.muted}>
                    {String(row.from_member_id || "").slice(0, 8)} → {String(row.to_member_id || "").slice(0, 8)}
                  </Text>
                  {canAdminApprove ? (
                    <Pressable
                      style={styles.primaryButton}
                      disabled={transferBusy === row.id}
                      onPress={() => void adminApproveTransfer(row.id)}
                    >
                      <Text style={styles.primaryButtonText}>
                        {tm("adminApproveTransfer") || "Admin approve"}
                      </Text>
                    </Pressable>
                  ) : null}
                  {canAccept ? (
                    <Pressable
                      style={styles.primaryButton}
                      disabled={transferBusy === row.id}
                      onPress={() => void acceptTransfer(row.id)}
                    >
                      <Text style={styles.primaryButtonText}>{tm("acceptTransfer") || "Accept"}</Text>
                    </Pressable>
                  ) : null}
                  {canCancel ? (
                    <Pressable
                      style={styles.secondaryButton}
                      disabled={transferBusy === row.id}
                      onPress={() => void cancelTransfer(row.id)}
                    >
                      <Text style={styles.secondaryButtonText}>{tm("cancelTransfer") || "Cancel"}</Text>
                    </Pressable>
                  ) : null}
                </View>
              );
            })
          )}

          {isOwner ? (
            <>
              <Text style={styles.sectionLabel}>{tm("deactivateFamily") || "Deactivate family"}</Text>
              <Pressable
                style={styles.secondaryButton}
                disabled={deactivateBusy || loading}
                onPress={() => void deactivateFamily()}
              >
                <Text style={styles.secondaryButtonText}>
                  {deactivateBusy ? "..." : tm("deactivateFamily") || "Deactivate family"}
                </Text>
              </Pressable>
            </>
          ) : null}
        </>
      ) : null}

      {sub === "INVITE" ? (
        <>
          <Text style={styles.sectionLabel}>Generate invite (owner / member.invite)</Text>
          <TextInput
            style={styles.input}
            placeholder={tm("expiresInDays")}
            placeholderTextColor="#8aa39a"
            keyboardType="number-pad"
            value={inviteForm.expires_in_days}
            onChangeText={(expires_in_days) => setInviteForm((c) => ({ ...c, expires_in_days }))}
          />
          <TextInput
            style={styles.input}
            placeholder={tm("maxUses")}
            placeholderTextColor="#8aa39a"
            keyboardType="number-pad"
            value={inviteForm.max_uses}
            onChangeText={(max_uses) => setInviteForm((c) => ({ ...c, max_uses }))}
          />
          <Pressable style={styles.primaryButton} onPress={() => void generateInvite()} disabled={loading}>
            <Text style={styles.primaryButtonText}>{loading ? tm("generating") : tm("generateInviteBtn")}</Text>
          </Pressable>
          {generatedInvite?.invite_code ? (
            <View style={styles.listRow}>
              <Text style={styles.listTitle}>{generatedInvite.invite_code}</Text>
              <Text style={styles.muted}>
                expires {generatedInvite.expires_in_days}d · max {generatedInvite.max_uses} uses
              </Text>
              <Pressable
                style={styles.primaryButton}
                onPress={async () => {
                  try {
                    await Share.share({ message: String(generatedInvite.invite_code) });
                  } catch {
                    onMessage("Copy/share failed", false);
                  }
                }}
              >
                <Text style={styles.primaryButtonText}>{tm("copyInvite") || "Copy / Share"}</Text>
              </Pressable>
              {(generatedInvite.invite_id || generatedInvite.id) ? (
                <Pressable
                  style={styles.secondaryButton}
                  onPress={async () => {
                    setLoading(true);
                    try {
                      const id = generatedInvite.invite_id || generatedInvite.id;
                      await apiPost(`/api/v1/invites/${id}/revoke`, {}, token);
                      setGeneratedInvite(null);
                      onMessage(tm("inviteRevoked") || "Invite revoked", true);
                    } catch (error) {
                      onMessage(error instanceof Error ? error.message : "Revoke failed", false);
                    } finally {
                      setLoading(false);
                    }
                  }}
                  disabled={loading}
                >
                  <Text style={styles.secondaryButtonText}>{tm("revokeInvite") || "Revoke invite"}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : (
            <Text style={styles.muted}>Generated code appears here after create.</Text>
          )}
        </>
      ) : null}

      {sub === "JOIN" ? (
        <>
          <Text style={styles.sectionLabel}>Join another family with invite code</Text>
          <TextInput
            style={styles.input}
            placeholder={tm("inviteCodePlaceholder")}
            placeholderTextColor="#8aa39a"
            autoCapitalize="characters"
            value={joinForm.invite_code}
            onChangeText={(invite_code) => setJoinForm((c) => ({ ...c, invite_code }))}
          />
          <View style={styles.statusRow}>
            {JOIN_RELATIONSHIPS.map((rel) => (
              <Pressable
                key={rel}
                onPress={() =>
                  setJoinForm((c) => ({
                    ...c,
                    relationship_type: rel,
                    serial_label: "",
                    relationship_serial: "",
                    linked_member_id: "",
                    relationship_note: "",
                  }))
                }
              >
                <Text style={[styles.statusPill, joinForm.relationship_type === rel ? styles.ok : null]}>{rel}</Text>
              </Pressable>
            ))}
          </View>
          {needsSerial(joinForm.relationship_type) ? (
            <>
              <View style={styles.statusRow}>
                {serialLabelsFor(joinForm.relationship_type).map((label) => (
                  <Pressable key={label} onPress={() => setJoinForm((c) => ({ ...c, serial_label: label }))}>
                    <Text style={[styles.statusPill, joinForm.serial_label === label ? styles.ok : null]}>{label}</Text>
                  </Pressable>
                ))}
              </View>
              <TextInput
                style={styles.input}
                placeholder="Serial # (optional / custom)"
                placeholderTextColor="#8aa39a"
                keyboardType="number-pad"
                value={joinForm.relationship_serial}
                onChangeText={(relationship_serial) => setJoinForm((c) => ({ ...c, relationship_serial }))}
              />
            </>
          ) : null}
          {needsLinkedMember(joinForm.relationship_type) ? (
            <View style={styles.statusRow}>
              {members.map((m) => (
                <Pressable
                  key={m.member_id}
                  onPress={() => setJoinForm((c) => ({ ...c, linked_member_id: m.member_id }))}
                >
                  <Text style={[styles.statusPill, joinForm.linked_member_id === m.member_id ? styles.ok : null]}>
                    {(m.relationship || m.role || m.member_id).slice(0, 18)}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {needsRelationshipNote(joinForm.relationship_type) ? (
            <TextInput
              style={styles.input}
              placeholder={tm("relationshipNote") || "Relationship note (required)"}
              placeholderTextColor="#8aa39a"
              value={joinForm.relationship_note}
              onChangeText={(relationship_note) => setJoinForm((c) => ({ ...c, relationship_note }))}
            />
          ) : null}
          <Pressable style={styles.primaryButton} onPress={() => void submitJoin()} disabled={loading}>
            <Text style={styles.primaryButtonText}>{loading ? tm("saving") : tm("submitJoin")}</Text>
          </Pressable>
        </>
      ) : null}

      {sub === "REQUESTS" ? (
        <>
          <Text style={styles.sectionLabel}>Pending join requests (owner)</Text>
          {requests.length === 0 ? <Text style={styles.muted}>No pending requests (or not owner)</Text> : null}
          {requests.map((request) => (
            <View style={styles.listRow} key={request.request_id}>
              <Text style={styles.listTitle}>
                {request.relationship || "Member"} · {request.requested_role || "MEMBER"}
              </Text>
              <Text style={styles.muted}>
                user {request.user_id || "—"} · {request.created_at ? String(request.created_at).slice(0, 19) : ""}
              </Text>
              <View style={styles.statusRow}>
                <Pressable onPress={() => void decideRequest(request.request_id, "APPROVE")} disabled={loading}>
                  <Text style={[styles.statusPill, styles.ok]}>Approve</Text>
                </Pressable>
                <Pressable onPress={() => void decideRequest(request.request_id, "REJECT")} disabled={loading}>
                  <Text style={[styles.statusPill, styles.failed]}>Reject</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </>
      ) : null}

      {sub === "PERMS" ? (
        <>
          <Text style={styles.sectionLabel}>My effective permissions</Text>
          <View style={styles.statusRow}>
            {myPerms.slice(0, 16).map((key) => (
              <Text key={key} style={styles.statusPill}>
                {key}
              </Text>
            ))}
          </View>
          {myPerms.length === 0 ? <Text style={styles.muted}>No permission summary</Text> : null}

          <Text style={styles.sectionLabel}>Members (owner can edit overrides)</Text>
          <View style={styles.statusRow}>
            {members.map((member) => (
              <Pressable key={member.member_id} onPress={() => setSelectedMemberId(member.member_id)}>
                <Text style={[styles.statusPill, selectedMemberId === member.member_id ? styles.ok : null]}>
                  {member.relationship || member.role || member.member_id.slice(0, 8)}
                </Text>
              </Pressable>
            ))}
          </View>
          {members.length === 0 ? <Text style={styles.muted}>Member list needs owner access</Text> : null}

          {selectedMember ? (
            <Text style={styles.muted}>
              Selected: {selectedMember.role} · {selectedMember.relationship || selectedMember.member_id}
            </Text>
          ) : null}

          <Text style={styles.sectionLabel}>Override permission</Text>
          <View style={styles.statusRow}>
            {COMMON_PERMISSION_KEYS.map((key) => (
              <Pressable key={key} onPress={() => setPermForm((c) => ({ ...c, permission_key: key }))}>
                <Text style={[styles.statusPill, permForm.permission_key === key ? styles.ok : null]}>{key}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.statusRow}>
            <Pressable onPress={() => setPermForm((c) => ({ ...c, allow: true }))}>
              <Text style={[styles.statusPill, permForm.allow ? styles.ok : null]}>ALLOW</Text>
            </Pressable>
            <Pressable onPress={() => setPermForm((c) => ({ ...c, allow: false }))}>
              <Text style={[styles.statusPill, !permForm.allow ? styles.failed : null]}>DENY</Text>
            </Pressable>
          </View>
          <Pressable style={styles.primaryButton} onPress={() => void savePermission()} disabled={loading}>
            <Text style={styles.primaryButtonText}>{loading ? "Saving..." : "Save Permission Override"}</Text>
          </Pressable>
        </>
      ) : null}
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { backgroundColor: "#ffffff", borderColor: "#dce7e3", borderWidth: 1, borderRadius: 24, padding: 16, gap: 12 },
  panelTitle: { color: "#17211e", fontSize: 20, fontWeight: "900" },
  muted: { color: "#6c7b76", fontSize: 13, lineHeight: 19 },
  input: {
    backgroundColor: "#f8fbfa",
    borderColor: "#dce7e3",
    borderWidth: 1,
    borderRadius: 16,
    color: "#17211e",
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  primaryButton: { backgroundColor: "#0f8f6f", borderRadius: 16, paddingVertical: 14, alignItems: "center" },
  primaryButtonText: { color: "#ffffff", fontWeight: "900", fontSize: 15 },
  secondaryButton: {
    borderColor: "#0f8f6f",
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: "#ffffff",
    marginTop: 6,
  },
  secondaryButtonText: { color: "#0b6f58", fontWeight: "800" },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  linkText: { color: "#0f8f6f", fontWeight: "800" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  metricCard: { flexGrow: 1, minWidth: "30%", backgroundColor: "#f8fbfa", borderRadius: 18, padding: 12 },
  metricLabel: { color: "#6c7b76", fontSize: 12, fontWeight: "700" },
  metricValue: { color: "#17211e", fontSize: 18, fontWeight: "900", marginTop: 6 },
  statusRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  statusPill: {
    color: "#0b6f58",
    backgroundColor: "#e0f4ed",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 12,
    fontWeight: "800",
  },
  ok: { backgroundColor: "#0f8f6f", color: "#ffffff" },
  failed: { backgroundColor: "#7f1d1d" },
  listRow: { borderTopColor: "#dce7e3", borderTopWidth: 1, paddingTop: 10, gap: 4 },
  listTitle: { color: "#17211e", fontWeight: "900", fontSize: 15 },
  sectionLabel: { color: "#0b6f58", fontWeight: "900", marginTop: 6 },
});
