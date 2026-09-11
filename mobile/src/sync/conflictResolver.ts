/** Conflict detection + local payload merge helpers. */

import {
  fetchOpenConflicts,
  pushResultHasConflict,
  pushResultFailed,
} from "../lib/phase10bSync";

export const conflictResolver = {
  hasConflict: pushResultHasConflict,
  failedMessage: pushResultFailed,

  async listOpenServerConflicts(
    apiBase: string,
    token: string,
    familyId: string,
    tunnelHeaders: Record<string, string> = {}
  ) {
    return fetchOpenConflicts(apiBase, token, familyId, tunnelHeaders);
  },

  mergeKeepLocal(localPayload: Record<string, unknown>, remotePayload: Record<string, unknown>) {
    return { ...remotePayload, ...localPayload, conflict_resolution: "keep_local" };
  },

  mergeKeepServer(localPayload: Record<string, unknown>, remotePayload: Record<string, unknown>) {
    return { ...localPayload, ...remotePayload, conflict_resolution: "keep_server" };
  },

  parsePayload(raw: string): Record<string, unknown> {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  },
};
