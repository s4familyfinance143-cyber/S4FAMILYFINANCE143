/**
 * Firebase Cloud Storage uploads for documents, attachments & profile photos.
 */
import { deleteObject, getDownloadURL, getStorage, ref, uploadBytes } from "firebase/storage";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";

import { getFirebaseApp, getFirestoreDb } from "./config";

let storageInstance = null;

export function getFirebaseStorage() {
  if (!storageInstance) {
    storageInstance = getStorage(getFirebaseApp());
  }
  return storageInstance;
}

function safeName(name) {
  return String(name || "file.bin")
    .replace(/[^\w.\-()+ ]+/g, "_")
    .slice(0, 120);
}

const PROFILE_MAX_BYTES = 2 * 1024 * 1024;
const PROFILE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function validateProfilePhotoFile(file) {
  if (!file) return { ok: false, reason: "missing_file", message: "No file selected." };
  const type = String(file.type || "").toLowerCase();
  if (!PROFILE_TYPES.has(type)) {
    return {
      ok: false,
      reason: "invalid_type",
      message: "Failed to upload. Max size 2MB, JPG/PNG/WebP only.",
    };
  }
  if (Number(file.size || 0) > PROFILE_MAX_BYTES) {
    return {
      ok: false,
      reason: "too_large",
      message: "Failed to upload. Max size 2MB, JPG/PNG/WebP only.",
    };
  }
  return { ok: true };
}

/**
 * Upload profile photo to Firebase Storage and store URL on users/{uid}.
 * Path: users/{uid}/profile/avatar.{ext}
 */
export async function uploadProfilePhotoToFirebase({ uid, file }) {
  console.info("[S4 ProfilePhoto] upload start", {
    uid,
    name: file?.name,
    type: file?.type,
    size: file?.size,
  });

  const check = validateProfilePhotoFile(file);
  if (!check.ok) {
    console.error("[S4 ProfilePhoto] validation failed", check);
    throw new Error(check.message);
  }
  if (!uid) {
    console.error("[S4 ProfilePhoto] missing uid");
    throw new Error("Sign in required to upload profile photo.");
  }

  const storage = getFirebaseStorage();
  const ext =
    file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `users/${uid}/profile/avatar.${ext}`;
  const storageRef = ref(storage, path);
  const metadata = {
    contentType: file.type || "image/jpeg",
    customMetadata: {
      uploaded_by: String(uid),
      original_name: safeName(file.name || `avatar.${ext}`),
    },
  };

  try {
    await uploadBytes(storageRef, file, metadata);
    const url = await getDownloadURL(storageRef);
    console.info("[S4 ProfilePhoto] storage upload ok", { path, url });

    const db = getFirestoreDb();
    if (db) {
      await setDoc(
        doc(db, "users", uid),
        {
          photo_url: url,
          avatar_url: url,
          photo_storage_path: path,
          photo_updated_at: serverTimestamp(),
        },
        { merge: true }
      );
      console.info("[S4 ProfilePhoto] firestore user doc updated", uid);
    }

    return {
      ok: true,
      storage_path: path,
      download_url: url,
      avatar_url: url,
      source: "firebase_storage",
    };
  } catch (err) {
    console.error("[S4 ProfilePhoto] upload failed", {
      code: err?.code,
      message: err?.message,
      err,
    });
    throw err;
  }
}

export async function removeProfilePhotoFromFirebase({ uid, storagePath }) {
  console.info("[S4 ProfilePhoto] remove start", { uid, storagePath });
  if (!uid) throw new Error("Sign in required.");

  try {
    const storage = getFirebaseStorage();
    if (storagePath) {
      await deleteObject(ref(storage, storagePath)).catch((err) => {
        console.warn("[S4 ProfilePhoto] storage delete skipped", err?.message || err);
      });
    } else {
      for (const ext of ["jpg", "png", "webp"]) {
        await deleteObject(ref(storage, `users/${uid}/profile/avatar.${ext}`)).catch(() => {});
      }
    }

    const db = getFirestoreDb();
    if (db) {
      await setDoc(
        doc(db, "users", uid),
        {
          photo_url: null,
          avatar_url: null,
          photo_storage_path: null,
          photo_updated_at: serverTimestamp(),
        },
        { merge: true }
      );
    }
    console.info("[S4 ProfilePhoto] remove ok", uid);
    return { ok: true };
  } catch (err) {
    console.error("[S4 ProfilePhoto] remove failed", {
      code: err?.code,
      message: err?.message,
      err,
    });
    throw err;
  }
}

/**
 * Upload a document file for a life-module DOCUMENT item.
 * Path: families/{familyId}/documents/{itemId}/{fileName}
 */
export async function uploadFamilyDocument({ familyId, itemId, file, uid }) {
  if (!familyId || !itemId || !file) throw new Error("familyId, itemId, and file required");
  const storage = getFirebaseStorage();
  const fileName = safeName(file.name || "document.bin");
  const path = `families/${familyId}/documents/${itemId}/${Date.now()}_${fileName}`;
  const storageRef = ref(storage, path);
  const metadata = {
    contentType: file.type || "application/octet-stream",
    customMetadata: {
      family_id: String(familyId),
      item_id: String(itemId),
      uploaded_by: uid || "",
      original_name: fileName,
    },
  };
  await uploadBytes(storageRef, file, metadata);
  const url = await getDownloadURL(storageRef);
  return {
    ok: true,
    storage_path: path,
    download_url: url,
    file_name: fileName,
    mime: file.type || "application/octet-stream",
    size: file.size || 0,
    uploaded_at: new Date().toISOString(),
    source: "firebase_storage",
  };
}

/**
 * Upload a transaction attachment.
 * Path: families/{familyId}/attachments/{txId}/{fileName}
 */
export async function uploadTransactionAttachment({ familyId, transactionId, file, uid }) {
  if (!familyId || !transactionId || !file) {
    throw new Error("familyId, transactionId, and file required");
  }
  const storage = getFirebaseStorage();
  const fileName = safeName(file.name || "attachment.bin");
  const path = `families/${familyId}/attachments/${transactionId}/${Date.now()}_${fileName}`;
  const storageRef = ref(storage, path);
  const metadata = {
    contentType: file.type || "application/octet-stream",
    customMetadata: {
      family_id: String(familyId),
      transaction_id: String(transactionId),
      uploaded_by: uid || "",
      original_name: fileName,
    },
  };
  await uploadBytes(storageRef, file, metadata);
  const url = await getDownloadURL(storageRef);
  return {
    ok: true,
    storage_path: path,
    download_url: url,
    file_name: fileName,
    mime: file.type || "application/octet-stream",
    size: file.size || 0,
    uploaded_at: new Date().toISOString(),
    source: "firebase_storage",
  };
}
