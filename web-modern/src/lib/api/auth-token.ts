/**
 * auth-token — Bearer-token storage for the new TanStack Start app.
 *
 * Why sessionStorage, not localStorage:
 *   - matches the server's `sid` cookie tab lifetime (no orphan tokens
 *     after the user closes the tab)
 *   - protected by the same-origin policy: an XSS in another tab can't
 *     read sessionStorage from a different tab on the same origin
 *   - never written to disk
 *
 * Why a Bearer token, not the `sid` cookie:
 *   - Chrome refuses to store HttpOnly cookies on `credentials: "include"`
 *     CORS-mode responses through the Vite dev proxy shape (see
 *     vite.config.ts for the full bisection). The legacy Vite app uses
 *     the cookie; the new app uses this token + Authorization header.
 *
 * SSR-safety: every read/write is guarded by `typeof window`. The
 * TanStack Start server route handlers never touch this module.
 */
const KEY = "ant.bearerSid";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(KEY);
  } catch {
    // sessionStorage can throw in private mode / restricted contexts
    return null;
  }
}

export function setToken(sid: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(KEY, sid);
  } catch {
    // ignore
  }
}

export function clearToken(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
