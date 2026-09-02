import { doc, setDoc, serverTimestamp } from "firebase/firestore";

import { saveOfflineSnapshot } from "../lib/offlineCache";
import { firebaseRegisterEmail, firebaseSignInEmail } from "./auth";
import { ensureUserProfile, getCloudSnapshotMeta, pushCloudSnapshot } from "./cloudSync";
import { getFirestoreDb } from "./config";

function newFamilyId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `fam_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  }
  return `fam_${Date.now().toString(36)}`;
}

export async function seedNewFamilyCache(
  familyId,
  { familyName, ownerName, currency = "BDT", timezone = "Asia/Dhaka", ownerRelation = "Owner" },
) {
  await saveOfflineSnapshot(familyId, "finance", "wallets", []);
  await saveOfflineSnapshot(familyId, "finance", "transactions", []);
  await saveOfflineSnapshot(familyId, "finance", "savings", []);
  await saveOfflineSnapshot(familyId, "finance", "loans", []);
  await saveOfflineSnapshot(familyId, "finance", "budgets", { data: [], statusData: {} });
  await saveOfflineSnapshot(familyId, "finance", "recurring", []);
  await saveOfflineSnapshot(familyId, "finance", "goals", []);
  await saveOfflineSnapshot(familyId, "finance", "goalSummary", { total: 0, goals: [] });
  await saveOfflineSnapshot(familyId, "reports", "overview", { financial: {}, wallet: {} });
  await saveOfflineSnapshot(familyId, "system", "currency", { code: currency, symbol: currency });
  await saveOfflineSnapshot(familyId, "system", "familyProfile", {
    id: familyId,
    name: familyName,
    default_currency: currency,
    timezone,
    owner_name: ownerName,
    owner_relation: ownerRelation,
    created_at: new Date().toISOString(),
    source: "firebase_cloud",
  });
}

/**
 * Create Firebase Auth account + new cloud family (no PC backend).
 */
export async function createCloudFamilyAccount({
  email,
  password,
  fullName,
  familyName,
  currency = "BDT",
  timezone = "Asia/Dhaka",
  ownerRelation = "Owner",
  deviceLabel = "mobile",
}) {
  let user;
  let verificationSent = false;
  try {
    const registered = await firebaseRegisterEmail(email, password, fullName);
    user = registered.user;
    verificationSent = registered.verificationSent;
  } catch (err) {
    const code = String(err?.code || "");
    if (code.includes("email-already-in-use")) {
      user = await firebaseSignInEmail(email, password);
      const meta = await getCloudSnapshotMeta(user.uid);
      if (meta?.familyId) {
        return { user, familyId: meta.familyId, existing: true };
      }
    } else {
      throw err;
    }
  }

  await ensureUserProfile(user.uid, user);

  const familyId = newFamilyId();
  await seedNewFamilyCache(familyId, {
    familyName,
    ownerName: fullName,
    currency,
    timezone,
    ownerRelation,
  });

  const db = getFirestoreDb();
  if (db) {
    await setDoc(
      doc(db, "users", user.uid),
      {
        email: user.email || null,
        display_name: user.displayName || fullName || null,
        family_id: familyId,
        family_name: familyName,
        default_currency: currency,
        timezone,
        owner_relation: ownerRelation,
        cloud_mode: true,
        updated_at: serverTimestamp(),
      },
      { merge: true },
    );
  }

  await pushCloudSnapshot({ uid: user.uid, familyId, deviceLabel });

  return { user, familyId, existing: false, verificationSent };
}
