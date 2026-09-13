/** Persisted API auth — survives app kill; 5-minute grace for fast re-entry. */

const SESSION_KEY = "s4_auth_session";
/** Minimum session retention when briefly leaving the app (user request). */
export const AUTH_GRACE_MS = 5 * 60 * 1000;
const ACCESS_TTL_MS = 15 * 60 * 1000;

function safeParse(raw) {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function readStoredAuthSession() {
  try {
    return safeParse(localStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

export function persistAuthSession({ accessToken, refreshToken, user, apiBase }) {
  if (!accessToken && !refreshToken) return;
  try {
    const prev = readStoredAuthSession() || {};
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        access_token: accessToken || prev.access_token || "",
        refresh_token: refreshToken ?? prev.refresh_token ?? "",
        user: user ?? prev.user ?? null,
        api_base: apiBase || prev.api_base || "",
        last_active_at: Date.now(),
        access_expires_at: accessToken
          ? Date.now() + ACCESS_TTL_MS
          : Number(prev.access_expires_at || 0),
      }),
    );
  } catch {
    /* ignore quota / private mode */
  }
}

export function touchAuthSessionActivity() {
  try {
    const session = readStoredAuthSession();
    if (!session?.access_token && !session?.refresh_token) return;
    session.last_active_at = Date.now();
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* ignore */
  }
}

export function clearAuthSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export function hasRestorableAuthSession(apiBase = "") {
  const session = readStoredAuthSession();
  if (!session?.access_token && !session?.refresh_token) return false;
  if (apiBase && session.api_base && session.api_base !== apiBase) return false;
  return true;
}

function accessTokenStillValid(session) {
  const exp = Number(session?.access_expires_at || 0);
  return Boolean(session?.access_token) && exp > Date.now() + 30_000;
}

function withinGrace(session) {
  const last = Number(session?.last_active_at || 0);
  if (!last) return true;
  return Date.now() - last <= AUTH_GRACE_MS;
}

/**
 * Restore tokens on cold start. Uses cached access token when still valid;
 * otherwise rotates via /auth/refresh.
 */
export async function restoreAuthSession(apiBase) {
  const stored = readStoredAuthSession();
  if (!stored) return { ok: false, reason: "none" };
  if (apiBase && stored.api_base && stored.api_base !== apiBase) {
    return { ok: false, reason: "api_mismatch" };
  }

  if (accessTokenStillValid(stored) && (withinGrace(stored) || stored.refresh_token)) {
    touchAuthSessionActivity();
    return {
      ok: true,
      accessToken: stored.access_token,
      refreshToken: stored.refresh_token || "",
      user: stored.user || null,
      fast: true,
    };
  }

  if (!stored.refresh_token) {
    if (withinGrace(stored) && stored.access_token) {
      touchAuthSessionActivity();
      return {
        ok: true,
        accessToken: stored.access_token,
        refreshToken: "",
        user: stored.user || null,
        fast: true,
      };
    }
    clearAuthSession();
    return { ok: false, reason: "no_refresh" };
  }

  try {
    const res = await fetch(`${apiBase}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ refresh_token: stored.refresh_token }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      clearAuthSession();
      return { ok: false, reason: "refresh_failed", detail: data.detail };
    }
    const accessToken = data.access_token || "";
    const refreshToken = data.refresh_token || stored.refresh_token;
    const user = data.user || stored.user || null;
    persistAuthSession({ accessToken, refreshToken, user, apiBase });
    return { ok: true, accessToken, refreshToken, user, fast: false };
  } catch (err) {
    if (withinGrace(stored) && stored.access_token) {
      touchAuthSessionActivity();
      return {
        ok: true,
        accessToken: stored.access_token,
        refreshToken: stored.refresh_token || "",
        user: stored.user || null,
        fast: true,
        offline: true,
      };
    }
    return { ok: false, reason: "network", detail: err?.message };
  }
}
