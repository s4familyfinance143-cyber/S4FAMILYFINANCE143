/** Firebase/IndexedDB API shim removed — VPS fetch paths only. */

export async function cloudApiGet() {
  return { handled: false };
}

export async function cloudApiPost() {
  return { handled: false };
}

export async function cloudApiPatch() {
  return { handled: false };
}

export async function cloudApiDelete() {
  return { handled: false };
}

export async function seedCloudModuleCaches() {
  return undefined;
}
