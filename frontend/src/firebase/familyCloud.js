/**
 * Shared family cloud: invites registry + family-scoped snapshots + members RBAC.
 * Enables real multi-account join (not same-device only).
 */
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";

import { buildBackupPayload, restoreBackupBlob } from "../lib/backupPayload";
import { getFirestoreDb } from "./config";

const SNAPSHOT_DOC_ID = "latest";
const MAX_PART_CHARS = 750_000;

function emailOk(user) {
  return Boolean(user?.emailVerified);
}

function familyMetaRef(familyId) {
  const db = getFirestoreDb();
  return doc(db, "families", familyId);
}

function familyMemberRef(familyId, uid) {
  const db = getFirestoreDb();
  return doc(db, "families", familyId, "members", uid);
}

function familySnapshotRef(familyId) {
  const db = getFirestoreDb();
  return doc(db, "families", familyId, "cloudSnapshots", SNAPSHOT_DOC_ID);
}

function familyPartsCollection(familyId) {
  const db = getFirestoreDb();
  return collection(db, "families", familyId, "cloudSnapshots", SNAPSHOT_DOC_ID, "parts");
}

function inviteRef(code) {
  const db = getFirestoreDb();
  const key = String(code || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "");
  return doc(db, "familyInvites", key);
}

function chunkPayload(jsonText) {
  const parts = [];
  for (let i = 0; i < jsonText.length; i += MAX_PART_CHARS) {
    parts.push(jsonText.slice(i, i + MAX_PART_CHARS));
  }
  return parts.length ? parts : [""];
}

/** Ensure family meta + membership exist (does not downgrade existing role). */
export async function ensureFamilyCloudShell({
  familyId,
  uid,
  email,
  displayName,
  familyName,
  role = "OWNER",
  relationshipType = "",
}) {
  if (!familyId || !uid) return;
  const db = getFirestoreDb();
  if (!db) return;

  const memberSnap = await getDoc(familyMemberRef(familyId, uid));
  const metaSnap = await getDoc(familyMetaRef(familyId));
  const isFirst = !metaSnap.exists() || !metaSnap.data()?.owner_uid;
  const relation = String(relationshipType || "").trim();

  // Member first so subsequent family meta updates pass familyMember/owner rules.
  if (!memberSnap.exists()) {
    await setDoc(
      familyMemberRef(familyId, uid),
      {
        uid,
        email: email || null,
        display_name: displayName || null,
        role: isFirst ? "OWNER" : role || "MEMBER",
        ...(relation
          ? {
              relationship_type: relation,
              relationship: relation,
              relationship_display_label: relation,
            }
          : {}),
        status: "ACTIVE",
        joined_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      },
      { merge: true },
    );
  } else {
    const existingRelation =
      memberSnap.data()?.relationship_type ||
      memberSnap.data()?.relationship ||
      memberSnap.data()?.relationship_display_label ||
      "";
    await setDoc(
      familyMemberRef(familyId, uid),
      {
        email: email || memberSnap.data()?.email || null,
        display_name: displayName || memberSnap.data()?.display_name || null,
        // Backfill relation only when missing (never overwrite a corrected label)
        ...(!existingRelation && relation
          ? {
              relationship_type: relation,
              relationship: relation,
              relationship_display_label: relation,
            }
          : {}),
        status: "ACTIVE",
        updated_at: serverTimestamp(),
      },
      { merge: true },
    );
  }

  await setDoc(
    familyMetaRef(familyId),
    {
      id: familyId,
      name: familyName || metaSnap.data()?.name || "Family",
      owner_uid: isFirst ? uid : metaSnap.data()?.owner_uid || uid,
      created_at: metaSnap.exists() ? metaSnap.data()?.created_at || serverTimestamp() : serverTimestamp(),
      updated_at: serverTimestamp(),
    },
    { merge: true },
  );
}

/**
 * Owner updates family currency / timezone on families/{familyId} meta doc.
 */
export async function updateFamilyCloudSettings({
  familyId,
  currency,
  timezone,
  actorUid,
}) {
  if (!familyId) throw new Error("familyId required");
  const nextCurrency = String(currency || "").trim().toUpperCase();
  const nextTimezone = String(timezone || "").trim();
  if (!nextCurrency && !nextTimezone) {
    throw new Error("No settings provided");
  }
  if (nextCurrency && (nextCurrency.length < 3 || nextCurrency.length > 10)) {
    throw new Error("Invalid currency code");
  }
  if (nextTimezone && (nextTimezone.length < 2 || nextTimezone.length > 64)) {
    throw new Error("Invalid timezone");
  }

  if (actorUid) {
    const actor = await getDoc(familyMemberRef(familyId, actorUid));
    if (!actor.exists()) {
      throw new Error("Permission denied: you are not a family member");
    }
    const role = String(actor.data()?.role || "").toUpperCase();
    if (role !== "OWNER" && role !== "ADMIN") {
      throw new Error("Permission denied: settings.manage required");
    }
  }

  const patch = { updated_at: serverTimestamp() };
  if (nextCurrency) {
    patch.currency = nextCurrency;
    patch.default_currency = nextCurrency;
  }
  if (nextTimezone) {
    patch.timezone = nextTimezone;
  }

  try {
    await setDoc(familyMetaRef(familyId), patch, { merge: true });
  } catch (err) {
    const code = String(err?.code || err?.message || "");
    if (/permission-denied/i.test(code)) {
      throw new Error("Permission denied: unable to update family settings in Firestore");
    }
    if (/unavailable|network|failed-precondition/i.test(code)) {
      throw new Error("Database connection issue — check your network and try again");
    }
    throw new Error(err?.message || "Family settings update failed");
  }

  return {
    success: true,
    family_id: familyId,
    default_currency: nextCurrency || null,
    timezone: nextTimezone || null,
  };
}

/** Publish invite code to global registry (cross-account join). */
export async function publishFamilyInvite({
  code,
  familyId,
  ownerUid,
  inviteeEmail = null,
  expiresInDays = 7,
  maxUses = 1,
}) {
  const key = String(code || "")
    .trim()
    .toUpperCase();
  if (!key || !familyId || !ownerUid) throw new Error("Invite code/family/owner required");
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + Number(expiresInDays || 7));

  await setDoc(inviteRef(key), {
    code: key,
    family_id: familyId,
    owner_uid: ownerUid,
    invitee_email: inviteeEmail || null,
    max_uses: Number(maxUses || 1),
    uses: 0,
    status: "ACTIVE",
    expires_at: expiresAt.toISOString(),
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  });

  return { code: key, family_id: familyId, expires_at: expiresAt.toISOString() };
}

export async function revokeFamilyInvite(code) {
  const key = String(code || "")
    .trim()
    .toUpperCase();
  if (!key) return;
  const ref = inviteRef(key);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  await setDoc(ref, { status: "REVOKED", updated_at: serverTimestamp() }, { merge: true });
}

/**
 * Join another family's cloud data via invite code (different Firebase account).
 * Updates user profile family_id, adds member, consumes invite, pulls family snapshot.
 */
export async function joinFamilyByInviteCode({
  code,
  uid,
  email,
  displayName,
  relationshipType = "Relative",
}) {
  if (!uid) throw new Error("Firebase user required");
  const key = String(code || "")
    .trim()
    .toUpperCase();
  if (!key) throw new Error("Invite code required");

  const invSnap = await getDoc(inviteRef(key));
  if (!invSnap.exists()) throw new Error("Invalid or expired invite code");
  const inv = invSnap.data() || {};
  if (inv.status !== "ACTIVE") throw new Error("Invalid or expired invite code");
  if (inv.expires_at && new Date(inv.expires_at).getTime() < Date.now()) {
    throw new Error("Invite code expired");
  }
  const uses = Number(inv.uses || 0);
  const maxUses = Number(inv.max_uses || 1);
  if (uses >= maxUses) throw new Error("Invite code already used up");

  const familyId = inv.family_id;
  if (!familyId) throw new Error("Invite missing family");

  await setDoc(
    familyMemberRef(familyId, uid),
    {
      uid,
      email: email || null,
      display_name: displayName || null,
      role: "MEMBER",
      relationship_type: relationshipType,
      status: "ACTIVE",
      joined_at: serverTimestamp(),
      updated_at: serverTimestamp(),
      invite_code: key,
    },
    { merge: true },
  );

  const db = getFirestoreDb();
  await setDoc(
    doc(db, "users", uid),
    {
      family_id: familyId,
      role: "MEMBER",
      joined_via_invite: key,
      updated_at: serverTimestamp(),
    },
    { merge: true },
  );

  const nextUses = uses + 1;
  await setDoc(
    inviteRef(key),
    {
      uses: nextUses,
      status: nextUses >= maxUses ? "USED" : "ACTIVE",
      updated_at: serverTimestamp(),
      last_joined_uid: uid,
    },
    { merge: true },
  );

  const pull = await pullFamilyCloudSnapshot(familyId);
  return {
    familyId,
    member: { uid, email, role: "MEMBER", relationship_type: relationshipType },
    invite: { ...inv, uses: nextUses },
    restored: pull.restored,
  };
}

/** Push finance snapshot to families/{id} (shared truth for all members). */
export async function pushFamilyCloudSnapshot({ familyId, deviceLabel = "web", ownerUid = null }) {
  if (!familyId) throw new Error("familyId required");
  const payload = await buildBackupPayload(familyId, deviceLabel);
  const rows = payload.rows || [];
  const jsonText = JSON.stringify(payload);
  const parts = chunkPayload(jsonText);
  const db = getFirestoreDb();
  const metaRef = familySnapshotRef(familyId);
  const batch = writeBatch(db);

  batch.set(metaRef, {
    updated_at: serverTimestamp(),
    exported_at: payload.exported_at,
    family_id: familyId,
    device: deviceLabel,
    owner_uid: ownerUid || null,
    part_count: parts.length,
    row_count: rows.length,
    bytes: jsonText.length,
  });

  const existingParts = await getDocs(familyPartsCollection(familyId));
  existingParts.forEach((snap) => {
    batch.delete(snap.ref);
  });

  parts.forEach((text, index) => {
    const partRef = doc(familyPartsCollection(familyId), String(index));
    batch.set(partRef, { index, data: text });
  });

  await batch.commit();
  return {
    partCount: parts.length,
    rowCount: rows.length,
    bytes: jsonText.length,
    exportedAt: payload.exported_at,
  };
}

export async function pullFamilyCloudSnapshot(familyId) {
  if (!familyId) throw new Error("familyId required");
  const metaSnap = await getDoc(familySnapshotRef(familyId));
  if (!metaSnap.exists()) {
    return { restored: 0, message: "no_family_snapshot" };
  }
  const meta = metaSnap.data() || {};
  const partSnaps = await getDocs(familyPartsCollection(familyId));
  const ordered = partSnaps.docs
    .map((d) => d.data())
    .filter((row) => row && typeof row.data === "string")
    .sort((a, b) => Number(a.index) - Number(b.index));
  const jsonText = ordered.map((p) => p.data).join("");
  const result = await restoreBackupBlob(new Blob([jsonText], { type: "application/json" }));
  return {
    restored: result.restored,
    exportedAt: result.exportedAt || meta.exported_at || null,
    familyId: result.familyId || meta.family_id || familyId,
    rowCount: result.rowCount,
  };
}

export async function listFamilyCloudMembers(familyId) {
  if (!familyId) return [];
  const db = getFirestoreDb();
  const snaps = await getDocs(collection(db, "families", familyId, "members"));
  return snaps.docs.map((d) => ({ id: d.id, uid: d.id, ...d.data() }));
}

/** Persist permission overrides on families/{id}/members/{uid} (Owner RBAC). */
export async function updateFamilyMemberPermissionOverrides({
  familyId,
  memberUid,
  overrides,
  actorUid,
}) {
  if (!familyId || !memberUid) throw new Error("family/member required");
  if (actorUid) {
    const actor = await getDoc(familyMemberRef(familyId, actorUid));
    if (!actor.exists()) throw new Error("Actor is not a family member");
    const actorRole = String(actor.data()?.role || "").toUpperCase();
    if (actorRole !== "OWNER" && actorRole !== "ADMIN") {
      throw new Error("Only OWNER/ADMIN can change permissions");
    }
  }
  const list = Array.isArray(overrides) ? overrides : [];
  await setDoc(
    familyMemberRef(familyId, memberUid),
    {
      overrides: list,
      permission_overrides: list,
      updated_at: serverTimestamp(),
    },
    { merge: true },
  );
  return { ok: true, memberUid, overrides: list };
}

export async function setFamilyMemberRole({ familyId, memberUid, role, actorUid }) {
  if (!familyId || !memberUid || !role) throw new Error("family/member/role required");
  const actor = await getDoc(familyMemberRef(familyId, actorUid));
  if (!actor.exists() || String(actor.data()?.role || "").toUpperCase() !== "OWNER") {
    throw new Error("Only OWNER can change roles");
  }
  await setDoc(
    familyMemberRef(familyId, memberUid),
    { role: String(role).toUpperCase(), updated_at: serverTimestamp() },
    { merge: true },
  );
  return { ok: true, memberUid, role: String(role).toUpperCase() };
}

/** Owner (or self) updates family relationship label (Husband / Wife / …). */
export async function setFamilyMemberRelationship({
  familyId,
  memberUid,
  relationshipType,
  actorUid,
}) {
  if (!familyId || !memberUid) throw new Error("family/member required");
  const relation = String(relationshipType || "").trim();
  if (!relation) throw new Error("relationship required");

  if (actorUid && actorUid !== memberUid) {
    const actor = await getDoc(familyMemberRef(familyId, actorUid));
    if (!actor.exists() || String(actor.data()?.role || "").toUpperCase() !== "OWNER") {
      throw new Error("Only OWNER can change another member's relationship");
    }
  }

  await setDoc(
    familyMemberRef(familyId, memberUid),
    {
      relationship_type: relation,
      relationship: relation,
      relationship_display_label: relation,
      updated_at: serverTimestamp(),
    },
    { merge: true },
  );
  return { ok: true, memberUid, relationship_type: relation };
}

export async function removeFamilyCloudMember({ familyId, memberUid, actorUid }) {
  if (!familyId || !memberUid) throw new Error("family/member required");
  if (memberUid === actorUid) throw new Error("Cannot remove yourself");
  const actor = await getDoc(familyMemberRef(familyId, actorUid));
  if (!actor.exists() || String(actor.data()?.role || "").toUpperCase() !== "OWNER") {
    throw new Error("Only OWNER can remove members");
  }
  await deleteDoc(familyMemberRef(familyId, memberUid));
  return { ok: true };
}

export { emailOk };
