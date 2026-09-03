/**
 * Firebase Cloud Storage uploads for documents & transaction attachments.
 */
import { getDownloadURL, getStorage, ref, uploadBytes } from "firebase/storage";

import { getFirebaseApp } from "./config";

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
