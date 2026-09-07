import { doc, setDoc, serverTimestamp } from "firebase/firestore";

import { saveOfflineSnapshot } from "../lib/offlineCache";
import { DEFAULT_CLOUD_CATEGORIES } from "../lib/cloudLocalFinance";
import { seedCloudModuleCaches } from "../lib/cloudApiShim";
import { persistCloudFamilyId } from "../lib/cloudSession";
import { firebaseRegisterEmail, firebaseSignInEmail, firebaseDeleteCurrentUser, isFirebaseEmailVerified } from "./auth";
import { ensureUserProfile, getCloudSnapshotMeta, getUserFamilyProfile, linkUserFamilyId, pushCloudSnapshot } from "./cloudSync";
import { getFirestoreDb } from "./config";
import { ensureFamilyCloudShell } from "./familyCloud";

function withSoftTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    }),
  ]);
}

function newFamilyId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `fam_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  }
  return `fam_${Date.now().toString(36)}`;
}

export async function seedNewFamilyCache(
  familyId,
  {
    familyName,
    ownerName,
    ownerEmail = "",
    currency = "BDT",
    timezone = "Asia/Dhaka",
    ownerRelation = "Owner",
    ownerUid = "",
  },
) {
  await saveOfflineSnapshot(familyId, "finance", "wallets", []);
  await saveOfflineSnapshot(familyId, "finance", "categories", DEFAULT_CLOUD_CATEGORIES);
  await saveOfflineSnapshot(familyId, "finance", "transactions", []);
  await saveOfflineSnapshot(familyId, "finance", "savings", []);
  await saveOfflineSnapshot(familyId, "finance", "loans", []);
  await saveOfflineSnapshot(familyId, "finance", "budgets", []);
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
    owner_uid: ownerUid || undefined,
    created_at: new Date().toISOString(),
    source: "firebase_cloud",
  });
  await seedCloudModuleCaches(familyId, {
    ownerName,
    ownerEmail,
    ownerRelation,
    ownerUid,
    seedAsOwner: true,
  });
}

/**
 * Create Firebase Auth account + new cloud family (no PC backend).
 * Snapshot upload waits until email is verified (hybrid lock).
 *
 * Important: clicking Create immediately writes Authentication → Users.
 * If later steps fail, a newly registered Auth user is deleted so the email
 * does not "come back" as a ghost account after a failed signup.
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
  let verificationError = null;
  let newlyRegistered = false;
  try {
    const registered = await firebaseRegisterEmail(email, password, fullName);
    user = registered.user;
    newlyRegistered = true;
    verificationSent = registered.verificationSent;
    verificationError = registered.verificationError || null;
  } catch (err) {
    const code = String(err?.code || "");
    // Auth user still exists after Firestore wipe — try sign-in, then recreate family shell.
    if (code.includes("email-already-in-use")) {
      try {
        user = await firebaseSignInEmail(email, password);
      } catch (signErr) {
        const signCode = String(signErr?.code || "");
        if (
          signCode.includes("invalid-credential") ||
          signCode.includes("wrong-password") ||
          signCode.includes("user-not-found")
        ) {
          const wrapped = new Error("Email exists in Auth but password does not match");
          wrapped.code = "auth/email-exists-wrong-password";
          wrapped.cause = signErr;
          throw wrapped;
        }
        throw signErr;
      }
      const profile = await getUserFamilyProfile(user.uid);
      if (profile?.family_id) {
        return {
          user,
          familyId: profile.family_id,
          existing: true,
          verificationSent: false,
        };
      }
      // Verified users may only have snapshot meta.
      if (isFirebaseEmailVerified(user)) {
        try {
          const meta = await getCloudSnapshotMeta(user.uid);
          if (meta?.familyId) {
            return { user, familyId: meta.familyId, existing: true, verificationSent: false };
          }
        } catch {
          /* ignore */
        }
      }
    } else {
      throw err;
    }
  }

  let familyId = "";
  try {
    try {
      await withSoftTimeout(ensureUserProfile(user.uid, user), 5000);
    } catch (err) {
      console.warn("[S4 Auth] ensureUserProfile during create skipped", err);
    }

    familyId = newFamilyId();
    await seedNewFamilyCache(familyId, {
      familyName,
      ownerName: fullName,
      ownerEmail: email,
      currency,
      timezone,
      ownerRelation,
      ownerUid: user.uid,
    });
    // Persist before any slow Firestore call so UI timeout / Login can still find the family.
    persistCloudFamilyId(familyId);

    const emailVerified = isFirebaseEmailVerified(user);
    const profileExtra = {
      email: user.email || String(email || "").trim().toLowerCase() || null,
      display_name: user.displayName || fullName || null,
      family_name: familyName,
      default_currency: currency,
      timezone,
      owner_relation: ownerRelation,
      cloud_mode: true,
      email_verified: emailVerified,
    };

    // Always write users/{uid}.family_id — even before email verify.
    // Rules allow this while families/{id} does not exist yet (familyHasNoOwner).
    // Skipping this is what causes Login → "No family on this account yet".
    try {
      await Promise.race([
        linkUserFamilyId(user.uid, familyId, profileExtra),
        new Promise((_, reject) => {
          window.setTimeout(() => reject(new Error("Saving family link timed out")), 12000);
        }),
      ]);
    } catch (linkErr) {
      console.warn("[S4 Auth] family_id link failed (local family kept):", linkErr?.message || linkErr);
      const db = getFirestoreDb();
      if (db) {
        try {
          await withSoftTimeout(
            setDoc(
              doc(db, "users", user.uid),
              { ...profileExtra, updated_at: serverTimestamp() },
              { merge: true },
            ),
            8000,
          );
        } catch (profileErr) {
          console.warn("[S4 Auth] profile write failed:", profileErr?.message || profileErr);
        }
      }
    }

    // Create families/{id} + OWNER so Invite can publish. Soft-timeout must not hide total failure.
    try {
      await Promise.race([
        ensureFamilyCloudShell({
          familyId,
          uid: user.uid,
          email: user.email,
          displayName: fullName,
          familyName,
          role: "OWNER",
          relationshipType: ownerRelation,
        }),
        new Promise((_, reject) => {
          window.setTimeout(() => reject(new Error("Creating family in cloud timed out")), 15000);
        }),
      ]);
    } catch (err) {
      console.warn("[S4 Auth] family shell failed (will retry on invite/login):", err?.message || err);
    }
    try {
      await withSoftTimeout(
        pushCloudSnapshot({
          uid: user.uid,
          familyId,
          deviceLabel,
          email: user.email,
          displayName: fullName,
        }),
        10000,
      );
    } catch (err) {
      console.warn("[S4 Auth] snapshot skipped", err);
    }

    return { user, familyId, existing: false, verificationSent, verificationError };
  } catch (setupErr) {
    // If local family already seeded, keep Auth — user can Create family / Login retry.
    if (newlyRegistered && user && !familyId) {
      try {
        await firebaseDeleteCurrentUser(user);
        console.warn("[S4 Auth] rolled back newly registered Auth user after create failure");
      } catch (rollbackErr) {
        console.warn("[S4 Auth] could not roll back Auth user", rollbackErr);
      }
    }
    throw setupErr;
  }
}
