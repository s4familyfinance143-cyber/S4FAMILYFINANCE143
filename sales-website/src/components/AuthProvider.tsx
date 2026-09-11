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
    }),
    [user, ready, login, logout, refreshUser, authFetch]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
