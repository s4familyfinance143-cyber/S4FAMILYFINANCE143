import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";

import { buildBackupPayload, restoreBackupBlob } from "../lib/backupPayload";
import { getFirestoreDb } from "./config";
import { ensureFamilyCloudShell, findFamilyIdsForUid, pullFamilyCloudSnapshot, pushFamilyCloudSnapshot } from "./familyCloud";

const SNAPSHOT_DOC_ID = "latest";
const MAX_PART_CHARS = 750_000;

function snapshotRef(uid) {
  const db = getFirestoreDb();
  if (!db) throw new Error("Firestore not available");
  return doc(db, "users", uid, "cloudSnapshots", SNAPSHOT_DOC_ID);
}

function partsCollection(uid) {
  const db = getFirestoreDb();
  if (!db) throw new Error("Firestore not available");
  return collection(db, "users", uid, "cloudSnapshots", SNAPSHOT_DOC_ID, "parts");
}

function chunkPayload(jsonText) {
  const parts = [];
  for (let i = 0; i < jsonText.length; i += MAX_PART_CHARS) {
    parts.push(jsonText.slice(i, i + MAX_PART_CHARS));
  }
  return parts.length ? parts : [""];
}

/**
 * Push local IndexedDB snapshots to Firestore (user + shared family).
 */
export async function pushCloudSnapshot({ uid, familyId, deviceLabel = "web", email = null, displayName = null }) {
  const { getFirebaseAuth } = await import("./config");
  const authUid = String(getFirebaseAuth()?.currentUser?.uid || "").trim();
  if (!authUid) {
    throw new Error("Not signed in to Firebase — Sign out and Sign in again");
  }
  // Rules check request.auth.uid against the path — never write under a stale uid.
  uid = authUid;

  // Prefer cloud profile family_id over a stale local/IndexedDB hint.
  let resolvedFamilyId = String(familyId || "").trim();
  try {
    const profile = await getUserFamilyProfile(uid);
    const cloudFid = String(profile?.family_id || "").trim();
    if (cloudFid) resolvedFamilyId = cloudFid;
  } catch {
    /* keep caller familyId */
  }

  const payload = await buildBackupPayload(resolvedFamilyId || familyId, deviceLabel);
  const rows = payload.rows || [];
  const jsonText = JSON.stringify(payload);
  const parts = chunkPayload(jsonText);
  const db = getFirestoreDb();
  const metaRef = snapshotRef(uid);
  const batch = writeBatch(db);

  batch.set(metaRef, {
    updated_at: serverTimestamp(),
    exported_at: payload.exported_at,
    family_id: resolvedFamilyId || null,
    device: deviceLabel,
    part_count: parts.length,
    row_count: rows.length,
    bytes: jsonText.length,
  });

  try {
    const existingParts = await getDocs(partsCollection(uid));
    existingParts.forEach((snap) => {
      batch.delete(snap.ref);
    });
  } catch {
    /* first push — no parts yet / list denied briefly */
  }

  parts.forEach((text, index) => {
    const partRef = doc(partsCollection(uid), String(index));
    batch.set(partRef, { index, data: text });
  });

  try {
    await batch.commit();
  } catch (err) {
    const msg = String(err?.message || err || "");
    if (/permission-denied|insufficient permissions/i.test(msg)) {
      throw new Error(
        "Sync push permission-denied — Sign out → Sign in, confirm email verified, then try Sync again",
        { cause: err },
      );
    }
    throw err;
  }

  if (resolvedFamilyId) {
    try {
      await ensureFamilyCloudShell({
        familyId: resolvedFamilyId,
        uid,
        email,
        displayName,
        familyName: resolvedFamilyId,
        // Never pass OWNER here — only meta.owner_uid / first-member logic may elevate
        role: "MEMBER",
      });
      try {
        await linkUserFamilyId(uid, resolvedFamilyId);
      } catch {
        /* profile heal optional */
      }
      await pushFamilyCloudSnapshot({ familyId: resolvedFamilyId, deviceLabel, ownerUid: uid });
    } catch {
      /* family shell may already exist with different owner role — still try snapshot */
      try {
        await pushFamilyCloudSnapshot({ familyId: resolvedFamilyId, deviceLabel, ownerUid: uid });
      } catch (familyErr) {
        console.warn(
          "[S4] family snapshot push skipped",
          familyErr?.code || familyErr?.message || familyErr,
        );
      }
    }
  }

  return {
    partCount: parts.length,
    rowCount: rows.length,
    bytes: jsonText.length,
    exportedAt: payload.exported_at,
    familyId: resolvedFamilyId || null,
  };
}

/**
 * Pull latest cloud snapshot into local IndexedDB.
 * Prefers shared family snapshot when family_id is known (multi-member truth).
 */
export async function pullCloudSnapshot(uid) {
  if (!uid) throw new Error("Firebase user required");

  let familyId = null;
  try {
    const profile = await getUserFamilyProfile(uid);
    familyId = profile?.family_id || null;
  } catch {
    /* ignore */
  }

  if (familyId) {
    try {
      const shared = await pullFamilyCloudSnapshot(familyId);
      if (shared.message !== "no_family_snapshot") {
        return shared;
      }
    } catch {
      /* fall through to user snapshot */
    }
  }

  const metaSnap = await getDoc(snapshotRef(uid));
  if (!metaSnap.exists()) {
    return { restored: 0, message: "no_cloud_snapshot" };
  }
  const meta = metaSnap.data() || {};
  if (!familyId && meta.family_id) {
    try {
      const shared = await pullFamilyCloudSnapshot(meta.family_id);
      if (shared.restored > 0) return shared;
    } catch {
      /* use personal */
    }
  }

  const partSnaps = await getDocs(partsCollection(uid));
  const ordered = partSnaps.docs
    .map((d) => d.data())
    .filter((row) => row && typeof row.data === "string")
    .sort((a, b) => Number(a.index) - Number(b.index));
  const jsonText = ordered.map((p) => p.data).join("");
  const result = await restoreBackupBlob(new Blob([jsonText], { type: "application/json" }), {
    expectedFamilyId: familyId || meta.family_id || null,
  });
  return {
    restored: result.restored,
    exportedAt: result.exportedAt || meta.exported_at || null,
    familyId: result.familyId || meta.family_id || null,
    rowCount: result.rowCount,
  };
}

export async function getCloudSnapshotMeta(uid) {
  if (!uid) return null;
  const metaSnap = await getDoc(snapshotRef(uid));
  if (!metaSnap.exists()) return null;
  const data = metaSnap.data() || {};
  return {
    exportedAt: data.exported_at || null,
    familyId: data.family_id || null,
    rowCount: data.row_count || 0,
    partCount: data.part_count || 0,
    bytes: data.bytes || 0,
    device: data.device || "",
  };
}

export async function getUserFamilyProfile(uid) {
  if (!uid) return null;
  const db = getFirestoreDb();
  if (!db) return null;
  const snap = await getDoc(doc(db, "users", uid));
  if (!snap.exists()) return null;
  return snap.data() || null;
}

/** Persist family_id on the user profile so other devices can resolve the same family. */
export async function linkUserFamilyId(uid, familyId, extra = {}) {
  if (!uid || !familyId) return;
  const db = getFirestoreDb();
  if (!db) return;
  await setDoc(
    doc(db, "users", uid),
    {
      family_id: familyId,
      updated_at: serverTimestamp(),
      ...extra,
    },
    { merge: true },
  );
}

/**
 * Write family_id + members shell so the next PC/phone login finds this family.
 */
export async function bindCloudFamilyIdentity({
  uid,
  familyId,
  email = null,
  displayName = null,
  familyName = null,
  role = "MEMBER",
}) {
  if (!uid || !familyId) return { familyId: "", bound: false };
  // Membership first — rules only allow users.family_id when member / new family.
  await ensureFamilyCloudShell({
    familyId,
    uid,
    email,
    displayName,
    familyName: familyName || familyId,
    role,
  });
  await linkUserFamilyId(uid, familyId);
  return { familyId, bound: true };
}

/**
 * Resolve family for login on a fresh device, then bind profile + shell.
 * Order: local hint → user profile → snapshot meta → membership index → snapshot pull.
 */
export async function resolveAndBindUserFamily({
  uid,
  email = null,
  displayName = null,
  localFamilyId = "",
}) {
  if (!uid) return "";

  // Cloud profile wins over stale localStorage family_id (common after invite heal).
  let profileFamilyId = "";
  try {
    const profile = await getUserFamilyProfile(uid);
    profileFamilyId = String(profile?.family_id || "").trim();
  } catch {
    /* ignore */
  }
  const localHint = String(localFamilyId || "").trim();
  let familyId = profileFamilyId || localHint;

  if (!familyId) {
    try {
      const meta = await getCloudSnapshotMeta(uid);
      familyId = String(meta?.familyId || "").trim();
    } catch {
      /* ignore */
    }
  }

  if (!familyId) {
    try {
      const ids = await findFamilyIdsForUid(uid);
      if (ids.length) familyId = String(ids[0] || "").trim();
    } catch {
      /* ignore */
    }
  }

  if (!familyId) {
    try {
      const restored = await pullCloudSnapshot(uid);
      familyId = String(restored?.familyId || "").trim();
    } catch {
      /* no snapshot yet */
    }
  }

  if (!familyId) return "";

  try {
    await bindCloudFamilyIdentity({
      uid,
      familyId,
      email,
      displayName,
      familyName: familyId,
      role: "MEMBER",
    });
  } catch (err) {
    console.warn("[S4] bindCloudFamilyIdentity failed", err?.code || err?.message || err);
  }

  return familyId;
}

export async function ensureUserProfile(uid, user) {
  if (!uid || !user) return;
  const db = getFirestoreDb();
  if (!db) return;
  const ref = doc(db, "users", uid);
  const payload = {
    email: user.email || null,
    display_name: user.displayName || null,
    last_seen_at: serverTimestamp(),
  };
  // Only write Auth photoURL when present — do not wipe Storage avatar uploads.
  if (user.photoURL) {
    payload.photo_url = user.photoURL;
  }
  await setDoc(ref, payload, { merge: true });
}

export async function getUserProfileDoc(uid) {
  if (!uid) return null;
  const db = getFirestoreDb();
  if (!db) return null;
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}
