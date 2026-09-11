/**
 * Firebase-first API bridge for mobile.
 * Routes /api/v1/* to cloudApiShim + SQLCipher offline cache.
 */
import {
  cloudApiGet,
  cloudApiPost,
  cloudApiPatch,
  cloudApiDelete,
} from "./cloudApiShim";
import { isFirebaseFirstMode } from "../firebase/config";
import { loadCloudFamilyId } from "./cloudSession";

type CurrentUser = { uid?: string; email?: string; displayName?: string } | null;

let activeFamilyId = "";
let currentUser: CurrentUser = null;
let afterWrite: (() => Promise<void> | void) | null = null;

export function setCloudApiContext({
  familyId,
  user,
  onAfterWrite,
}: {
  familyId?: string;
  user?: CurrentUser;
  onAfterWrite?: (() => Promise<void> | void) | null;
}) {
  if (familyId !== undefined) activeFamilyId = String(familyId || "");
  if (user !== undefined) currentUser = user;
  if (onAfterWrite !== undefined) afterWrite = onAfterWrite;
}

export function getCloudApiFamilyId() {
  return activeFamilyId;
}

function stripApiPrefix(path: string) {
  return String(path || "").replace(/^\/?api\/v[12]/i, "") || "/";
}

async function resolveFamilyId() {
  if (activeFamilyId) return activeFamilyId;
  return (await loadCloudFamilyId()) || "";
}

export async function cloudBridgeGet(path: string) {
  const familyId = await resolveFamilyId();
  const hit = await cloudApiGet({
    familyId,
    path: stripApiPrefix(path),
    currentUser,
  });
  if (hit?.handled) return hit.data;
  return [];
}

export async function cloudBridgePost(path: string, body?: unknown) {
  const familyId = await resolveFamilyId();
  const hit = await cloudApiPost({
    familyId,
    path: stripApiPrefix(path),
    body,
    currentUser,
    onAfterWrite: afterWrite || undefined,
  });
  if (hit?.error) throw new Error(hit.error);
  if (hit?.handled) return hit.data;
  throw new Error(`Upload/API not supported in cloud mode: ${path}`);
}

export async function cloudBridgePatch(path: string, body?: unknown) {
  const familyId = await resolveFamilyId();
  const hit = await cloudApiPatch({
    familyId,
    path: stripApiPrefix(path),
    body,
    currentUser,
    onAfterWrite: afterWrite || undefined,
  });
  if (hit?.error) throw new Error(hit.error);
  if (hit?.handled) return hit.data;
  throw new Error(`Patch not supported in cloud mode: ${path}`);
}

export async function cloudBridgeDelete(path: string) {
  const familyId = await resolveFamilyId();
  const hit = await cloudApiDelete({
    familyId,
    path: stripApiPrefix(path),
    currentUser,
    onAfterWrite: afterWrite || undefined,
  });
  if (hit?.error) throw new Error(hit.error);
  if (hit?.handled) return hit.data;
  throw new Error(`Delete not supported in cloud mode: ${path}`);
}

export function shouldUseCloudBridge() {
  return isFirebaseFirstMode() && Boolean(activeFamilyId || currentUser?.uid);
}
