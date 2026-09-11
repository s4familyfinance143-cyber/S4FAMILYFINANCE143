import { useAuthStore } from "../store/authStore";
import { authService } from "../services/authService";
import { useCallback, useState } from "react";

export function useAuth() {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const setSession = useAuthStore((s) => s.setSession);
  const clearSession = useAuthStore((s) => s.clearSession);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = useCallback(async (email: string, password: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await authService.login(email, password);
      setSession(result.access_token, result.user);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Login failed";
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [setSession]);

  const logout = useCallback(async () => {
    await authService.logout();
    await clearSession();
  }, [clearSession]);

  const refreshMe = useCallback(async () => {
    if (!token) return null;
    const me = await authService.me(token);
    setSession(token, me);
    return me;
  }, [token, setSession]);

  return {
    token,
    user,
    isAuthenticated: Boolean(token),
    loading,
    error,
    login,
    logout,
    refreshMe,
  };
}
