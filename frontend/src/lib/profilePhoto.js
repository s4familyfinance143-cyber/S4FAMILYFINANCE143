/** Client-side profile photo checks before uploading to the VPS (/auth/me/avatar). */

const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

export function validateProfilePhotoFile(file) {
  if (!file) {
    return { ok: false, message: "No file selected" };
  }

  const type = String(file.type || "").toLowerCase();
  const name = String(file.name || "").toLowerCase();
  const byExt =
    /\.jpe?g$/i.test(name) || /\.png$/i.test(name) || /\.webp$/i.test(name);
  const contentType = ALLOWED.has(type)
    ? type === "image/jpg"
      ? "image/jpeg"
      : type
    : byExt
      ? name.endsWith(".png")
        ? "image/png"
        : name.endsWith(".webp")
          ? "image/webp"
          : "image/jpeg"
      : "";

  if (!contentType) {
    return {
      ok: false,
      message: "Failed to upload. Max size 2MB, JPG/PNG/WebP only.",
    };
  }

  if (Number(file.size || 0) > MAX_BYTES) {
    return {
      ok: false,
      message: "Failed to upload. Max size 2MB, JPG/PNG/WebP only.",
    };
  }

  return { ok: true, contentType, file };
}
