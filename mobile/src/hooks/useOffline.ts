/**
 * Offline status + queue/snapshot helpers for UI.
 */
import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import { queueManager } from "../sync/queueManager";
import { loadModuleSnapshot, saveModuleSnapshot } from "../lib/offlineSnapshots";
import { getOfflineDbSecurityStatus } from "../lib/mobileDb";
import { useSync } from "./useSync";

export type OfflineStatus = {
  online: boolean;
  pending: number;
  conflicts: number;
  failed: number;
  groceryPending: number;
  financePending: number;
  dbMode: string;
  dbNote: string;
};

export function useOffline(familyId?: string | null) {
  const sync = useSync(familyId);
  const [online, setOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine !== false : true
  );
  const [pending, setPending] = useState(0);
  const [conflicts, setConflicts] = useState(0);
  const [failed, setFailed] = useState(0);
  const [groceryPending, setGroceryPending] = useState(0);
  const [financePending, setFinancePending] = useState(0);
  const [dbMode, setDbMode] = useState("unavailable");
  const [dbNote, setDbNote] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [p, c, f, g, fin] = await Promise.all([
        queueManager.countPending(),
        queueManager.countConflicts(),
        queueManager.countFailed(),
        queueManager.countPendingGrocery(),
        queueManager.countPendingFinance(),
      ]);
      setPending(p);
      setConflicts(c);
      setFailed(f);
      setGroceryPending(g);
      setFinancePending(fin);
      const sec = getOfflineDbSecurityStatus();
      setDbMode(sec.mode);
      setDbNote(sec.note);
    } catch {
      /* DB may not be ready */
    }
    await sync.refreshStatus();
  }, [sync]);

  const probeOnline = useCallback(async () => {
    // Prefer browser/network signal when available; fall back to API health ping.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setOnline(false);
      return false;
    }
    try {
      const { getApiBaseUrl } = await import("../services/api");
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 2500);
      const res = await fetch(`${getApiBaseUrl()}/docs`, { method: "HEAD", signal: ctrl.signal });
      clearTimeout(t);
      const ok = res.ok || res.status < 500;
      setOnline(ok);
      return ok;
    } catch {
      // If HEAD fails but navigator says online, keep optimistic true for LAN quirks
      const navOnline = typeof navigator === "undefined" ? true : navigator.onLine !== false;
      setOnline(navOnline);
      return navOnline;
    }
  }, []);

  useEffect(() => {
    void refresh();
    void probeOnline();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void refresh();
        void probeOnline();
      }
    });
    const onOnline = () => {
      setOnline(true);
      void refresh();
      // No auto replay/refresh — user taps Sync/Refresh when they want.
    };
    const onOffline = () => setOnline(false);
    if (typeof globalThis !== "undefined" && "addEventListener" in globalThis) {
      globalThis.addEventListener("online", onOnline);
      globalThis.addEventListener("offline", onOffline);
    }
    const iv = setInterval(() => {
      void probeOnline();
    }, 30_000);
    return () => {
      sub.remove();
      clearInterval(iv);
      if (typeof globalThis !== "undefined" && "removeEventListener" in globalThis) {
        globalThis.removeEventListener("online", onOnline);
        globalThis.removeEventListener("offline", onOffline);
      }
    };
  }, [refresh, probeOnline]);

  const saveSnapshot = useCallback(
    async (module: string, payload: unknown) => {
      if (!familyId) return;
      await saveModuleSnapshot(familyId, module, payload);
    },
    [familyId]
  );

  const loadSnapshot = useCallback(
    async <T = unknown>(module: string) => {
      if (!familyId) return null;
      return loadModuleSnapshot<T>(familyId, module);
    },
    [familyId]
  );

  const status: OfflineStatus = {
    online,
    pending,
    conflicts,
    failed,
    groceryPending,
    financePending,
    dbMode,
    dbNote,
  };

  return {
    ...status,
    status,
    refresh,
    saveSnapshot,
    loadSnapshot,
    probeOnline,
    replayPending: sync.replay,
    replay: sync.replay,
    syncing: sync.busy,
    busy: sync.busy,
  };
}
