async function removed() {
  throw new Error("Firebase Storage has been removed. Use the VPS server.");
}

export async function uploadFamilyDocument() {
  return removed();
}
export async function uploadTransactionAttachment() {
  return removed();
}
export async function uploadProfilePhotoToFirebase() {
  return removed();
}
export async function removeProfilePhotoFromFirebase() {
  return removed();
}
export function validateProfilePhotoFile(file) {
  if (!file) throw new Error("No file selected");
  return file;
}
