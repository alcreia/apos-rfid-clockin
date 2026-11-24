/**
 * One way to call the API that never throws.
 *
 * `await res.json()` throws when the response is HTML — an Express 500, a proxy page,
 * or the server being replaced by something else on the port. In an event handler that
 * becomes an unhandled rejection and the UI just stops, so every call site goes through
 * this instead.
 */
export type ApiResult<T> = {
  ok: boolean;
  status: number;
  body: T | null;
  networkError: boolean;
};

export async function api<T = unknown>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, init);
    const body = (await res.json().catch(() => null)) as T | null;
    return { ok: res.ok, status: res.status, body, networkError: false };
  } catch {
    // Server down, DNS, aborted request.
    return { ok: false, status: 0, body: null, networkError: true };
  }
}

export function postJson<T = unknown>(url: string, payload: unknown): Promise<ApiResult<T>> {
  return api<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
