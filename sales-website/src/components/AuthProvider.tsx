"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  apiFetch,
  type ApiResult,
  type CurrentUser,
} from "@/lib/authApi";

type SimpleResult = { ok: boolean; error: string | null; message?: string };

type AuthCtx = {
  user: CurrentUser | null;
  ready: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<SimpleResult>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  authFetch: <T>(
    path: string,
    opts?: { method?: string; body?: unknown }
  ) => Promise<ApiResult<T>>;
  /** Authenticated binary download from the marketing site secure endpoint. */
  authDownload: (fileName: string) => Promise<{ ok: boolean; error: string | null }>;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [ready, setReady] = useState(false);
  const tokenRef = useRef<string | null>(null);

  const setToken = (t: string | null) => {
    tokenRef.current = t;
  };

  const tryRefresh = useCallback(async (): Promise<boolean> => {
    const res = await apiFetch<{ access_token: string }>("/auth/refresh", {
      method: "POST",
    });
    if (res.ok && res.data?.access_token) {
      setToken(res.data.access_token);
      return true;
    }
    setToken(null);
    return false;
  }, []);

  const loadMe = useCallback(async (): Promise<void> => {
    const res = await apiFetch<CurrentUser>("/account/me", {
      token: tokenRef.current,
    });
    setUser(res.ok ? res.data : null);
  }, []);

  // authFetch: attach token, and on 401 try one silent refresh + retry.
  const authFetch = useCallback(
    async <T,>(
      path: string,
      opts: { method?: string; body?: unknown } = {}
    ): Promise<ApiResult<T>> => {
      let res = await apiFetch<T>(path, { ...opts, token: tokenRef.current });
      if (res.status === 401) {
        const refreshed = await tryRefresh();
        if (refreshed) {
          res = await apiFetch<T>(path, { ...opts, token: tokenRef.current });
        } else {
          setUser(null);
        }
      }
      return res;
    },
    [tryRefresh]
  );

  const refreshUser = useCallback(async () => {
    await loadMe();
  }, [loadMe]);

  const login = useCallback(
    async (email: string, password: string): Promise<SimpleResult> => {
      const res = await apiFetch<{ access_token: string }>("/auth/login", {
        method: "POST",
        body: { email, password },
      });
      if (res.ok && res.data?.access_token) {
        setToken(res.data.access_token);
        await loadMe();
        return { ok: true, error: null };
      }
      return { ok: false, error: res.error, message: res.error ?? undefined };
    },
    [loadMe]
  );

  const logout = useCallback(async () => {
    await apiFetch("/auth/logout", { method: "POST" });
    setToken(null);
    setUser(null);
  }, []);

  const authDownload = useCallback(
    async (fileName: string): Promise<{ ok: boolean; error: string | null }> => {
      const safe = String(fileName || "").replace(/[^a-zA-Z0-9._-]/g, "");
      if (!safe) return { ok: false, error: "Invalid file" };

      let token = tokenRef.current;
      if (!token) {
        const refreshed = await tryRefresh();
        if (!refreshed) return { ok: false, error: "Login required" };
        token = tokenRef.current;
      }

      let res = await fetch(`/api/secure-download/${encodeURIComponent(safe)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: "include",
      });
      if (res.status === 401) {
        const refreshed = await tryRefresh();
        if (!refreshed) return { ok: false, error: "Login required" };
        token = tokenRef.current;
        res = await fetch(`/api/secure-download/${encodeURIComponent(safe)}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          credentials: "include",
        });
      }
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        return {
          ok: false,
          error: (data && data.error) || `Download failed (${res.status})`,
        };
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = safe;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      return { ok: true, error: null };
    },
    [tryRefresh]
  );

  // On mount: attempt to restore a session from the refresh cookie.
  useEffect(() => {
    let active = true;
    (async () => {
      const ok = await tryRefresh();
      if (ok && active) await loadMe();
      if (active) setReady(true);
    })();
    return () => {
      active = false;
    };
  }, [tryRefresh, loadMe]);

  const value = useMemo<AuthCtx>(
    () => ({
      user,
      ready,
      isAuthenticated: user !== null,
      login,
      logout,
      refreshUser,
      authFetch,
      authDownload,
    }),
    [user, ready, login, logout, refreshUser, authFetch, authDownload]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
