import { useCallback, useState } from "react";
import { useAuthStore } from "../store/authStore";
import { useFamilyStore } from "../store/familyStore";
import { syncManager } from "../sync/syncManager";

export function useSync() {
  const token = useAuthStore((s) => s.token);
  const familyId = useFamilyStore((s) => s.familyId);
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<{ synced: number; conflicts: number; failed: number } | null>(null);
  const [status, setStatus] = useState<{ pending: number; conflicts: number; failed: number } | null>(null);

  const refreshStatus = useCallback(async () => {
    const next = await syncManager.status();
    setStatus(next);
    return next;
  }, []);

  const replay = useCallback(async () => {
    if (!token || !familyId) throw new Error("Auth/family required");
    setBusy(true);
    try {
      const result = await syncManager.replayPending(token, familyId);
      setLastResult(result);
      await refreshStatus();
      return result;
    } finally {
      setBusy(false);
    }
  }, [token, familyId, refreshStatus]);

  return { busy, lastResult, status, refreshStatus, replay, syncManager };
}
