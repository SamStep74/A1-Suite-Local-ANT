/**
 * auth-token — Bearer-token storage for the new TanStack Start app.
 *
 * This module ships in two execution contexts:
 *
 *   1. SSR (no `window`) — every function must be a safe no-op so that
 *      TanStack Start route handlers can import it without crashing
 *      during the server render.
 *   2. Browser (`window.sessionStorage` is available) — the canonical
 *      path that stores the `ant.bearerSid` value in sessionStorage.
 *
 * Vitest's `environmentMatchGlobs` puts this file in the `node` env
 * (no DOM by default), so we use `vi.stubGlobal` to inject a fake
 * `window.sessionStorage` and verify the browser path. The SSR path
 * is covered by the same module imported with no globals.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearToken, getToken, setToken } from "./auth-token";

/**
 * Build a minimal `window`-shaped object that the auth-token module
 * can read. Returns both the stub and a `backing` reference so tests
 * can inspect what was written.
 */
function makeSessionStorageStub(): {
  stub: { sessionStorage: Storage };
  backing: Map<string, string>;
} {
  const backing = new Map<string, string>();
  const stub = {
    sessionStorage: {
      getItem: vi.fn((k: string) => (backing.has(k) ? backing.get(k)! : null)),
      setItem: vi.fn((k: string, v: string) => {
        backing.set(k, v);
      }),
      removeItem: vi.fn((k: string) => {
        backing.delete(k);
      }),
      clear: vi.fn(() => backing.clear()),
      key: vi.fn(),
      length: 0,
    } as unknown as Storage,
  };
  return { stub, backing };
}

afterEach(() => {
  // Tear down any window stub from the previous test so the next test
  // starts in a clean (no-window) state, matching SSR.
  vi.unstubAllGlobals();
});

describe("auth-token — SSR (no window)", () => {
  it("getToken returns null when window is undefined", () => {
    // No vi.stubGlobal("window", ...) in this test → the module sees
    // `typeof window === "undefined"` and returns null.
    expect(getToken()).toBeNull();
  });

  it("setToken is a safe no-op when window is undefined", () => {
    // Must not throw — TanStack Start route handlers import this
    // module on the server and the function has to be silent there.
    expect(() => setToken("some-sid")).not.toThrow();
  });

  it("clearToken is a safe no-op when window is undefined", () => {
    expect(() => clearToken()).not.toThrow();
  });
});

describe("auth-token — browser (with window.sessionStorage)", () => {
  it("getToken returns the stored sid", () => {
    const { stub, backing } = makeSessionStorageStub();
    vi.stubGlobal("window", stub);
    backing.set("ant.bearerSid", "sid-abc-123");
    expect(getToken()).toBe("sid-abc-123");
  });

  it("getToken returns null when nothing has been stored yet", () => {
    const { stub } = makeSessionStorageStub();
    vi.stubGlobal("window", stub);
    expect(getToken()).toBeNull();
  });

  it("setToken writes the sid to sessionStorage", () => {
    const { stub, backing } = makeSessionStorageStub();
    vi.stubGlobal("window", stub);
    setToken("sid-xyz-789");
    expect(backing.get("ant.bearerSid")).toBe("sid-xyz-789");
    expect(stub.sessionStorage.setItem).toHaveBeenCalledWith(
      "ant.bearerSid",
      "sid-xyz-789",
    );
  });

  it("clearToken removes the sid from sessionStorage", () => {
    const { stub, backing } = makeSessionStorageStub();
    vi.stubGlobal("window", stub);
    backing.set("ant.bearerSid", "sid-remove-me");
    clearToken();
    expect(backing.has("ant.bearerSid")).toBe(false);
    expect(stub.sessionStorage.removeItem).toHaveBeenCalledWith("ant.bearerSid");
  });

  it("getToken returns null when sessionStorage.getItem throws", () => {
    const stub = {
      sessionStorage: {
        getItem: vi.fn(() => {
          throw new Error("SecurityError: storage disabled");
        }),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      } as unknown as Storage,
    };
    vi.stubGlobal("window", stub);
    // Private mode / restricted context — must degrade to null,
    // not throw, so the auth flow can fall back to the cookie.
    expect(getToken()).toBeNull();
  });

  it("setToken swallows exceptions thrown by sessionStorage", () => {
    const stub = {
      sessionStorage: {
        getItem: vi.fn(),
        setItem: vi.fn(() => {
          throw new Error("QuotaExceededError");
        }),
        removeItem: vi.fn(),
      } as unknown as Storage,
    };
    vi.stubGlobal("window", stub);
    expect(() => setToken("sid-fails-to-write")).not.toThrow();
  });

  it("clearToken swallows exceptions thrown by sessionStorage", () => {
    const stub = {
      sessionStorage: {
        getItem: vi.fn(),
        setItem: vi.fn(),
        removeItem: vi.fn(() => {
          throw new Error("SecurityError");
        }),
      } as unknown as Storage,
    };
    vi.stubGlobal("window", stub);
    expect(() => clearToken()).not.toThrow();
  });
});

describe("auth-token — round-trip", () => {
  it("set then get returns the same sid", () => {
    const { stub } = makeSessionStorageStub();
    vi.stubGlobal("window", stub);
    setToken("sid-roundtrip");
    expect(getToken()).toBe("sid-roundtrip");
  });

  it("set then clear then get returns null", () => {
    const { stub } = makeSessionStorageStub();
    vi.stubGlobal("window", stub);
    setToken("sid-clear-me");
    clearToken();
    expect(getToken()).toBeNull();
  });
});
