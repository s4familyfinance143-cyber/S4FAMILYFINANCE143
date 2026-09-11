export const BACKEND_API_BASE =
  process.env.BACKEND_API_BASE ??
  process.env.NEXT_PUBLIC_API_BASE ??
  "http://localhost:8001/api";

export async function backendJson<T>(
  path: string,
  init: RequestInit = {}
): Promise<{ ok: boolean; status: number; data: T | null; error: string | null }> {
  const res = await fetch(`${BACKEND_API_BASE}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      "X-Admin-Api-Key": process.env.ADMIN_API_KEY ?? "",
      ...(init.headers ?? {}),
    },
  });

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  const detail =
    data && typeof data === "object" && "detail" in data
      ? String((data as { detail: unknown }).detail)
      : null;

  return {
    ok: res.ok,
    status: res.status,
    data: res.ok ? (data as T) : null,
    error: res.ok ? null : detail ?? "Request failed.",
  };
}
