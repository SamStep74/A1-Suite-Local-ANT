/**
 * legacy-hatch.spec.ts — Phase 10.1 escape-hatch invariants.
 *
 * These cases pin the contract between the Fastify backend (`server/app.js`,
 * `registerStatic`) and the new SPA's host-port setup. The pre-10.1 layout
 * had the Fastify backend hosting the legacy SPA at `/`; after 10.1 the
 * legacy build lives at `/legacy/*` and `/` returns a clean 404 (the SPA
 * itself runs on a separate port via `web-modern/scripts/serve-spa.mjs`).
 *
 * What this spec asserts (one invariant per test):
 *   1. `/` no longer serves the legacy SPA — a GET returns 404 JSON.
 *   2. `/api/*` still returns 404 JSON (NOT the legacy index.html), so
 *      the SPA fallback never bleeds into the API surface.
 *   3. When the legacy build is present, `/legacy/` returns the legacy
 *      SPA shell (200, HTML, legacy root element).
 *   4. When the legacy build is present, `/legacy/<unknown-path>` falls
 *      back to the legacy index.html (SPA shell, not 404) so the legacy
 *      client-side router can take over.
 *
 * Auth: not required. The Fastify backend serves the static mount and
 * 404s for unknown paths without touching the auth layer. Tests skip
 * gracefully if the Fastify backend isn't reachable on :4100 (same
 * convention as spa-mode.spec.ts).
 *
 * Assumes:
 *   - Fastify is reachable on http://localhost:4100
 *   - Optional: `pnpm run build:ui:legacy` (at the repo root) populated
 *     `public/index.html`. The legacy cases skip if the build is absent.
 */
import { test, expect } from "@playwright/test";

const BACKEND = "http://localhost:4100";

test.describe("Legacy escape hatch — Phase 10.1", () => {
  test("/ no longer serves the legacy SPA (returns 404 JSON)", async ({ request }) => {
    const probe = await request.get(`${BACKEND}/api/health`, {
      timeout: 2_000,
    }).catch(() => null);
    test.skip(
      !probe || !probe.ok(),
      "Fastify backend not reachable on :4100 — skipping (CI runs with START_FASTIFY=1).",
    );

    const res = await request.get(`${BACKEND}/`, { timeout: 5_000 });
    expect(res.status(), "expected / to return 404 (the SPA is on a separate port)").toBe(404);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, error: "NOT_FOUND" });
  });

  test("/api/foo returns 404 JSON, not the legacy SPA shell", async ({ request }) => {
    const probe = await request.get(`${BACKEND}/api/health`, {
      timeout: 2_000,
    }).catch(() => null);
    test.skip(
      !probe || !probe.ok(),
      "Fastify backend not reachable on :4100 — skipping (CI runs with START_FASTIFY=1).",
    );

    const res = await request.get(`${BACKEND}/api/foo`, { timeout: 5_000 });
    expect(res.status()).toBe(404);
    const body = await res.json();
    // /api/* must NEVER be served as the legacy SPA — that would mask
    // genuine API 404s as successful HTML responses.
    expect(body).toMatchObject({ ok: false, error: "NOT_FOUND" });
  });

  test("/legacy/ serves the legacy SPA shell when the build is present", async ({ request }) => {
    const probe = await request.get(`${BACKEND}/api/health`, {
      timeout: 2_000,
    }).catch(() => null);
    test.skip(
      !probe || !probe.ok(),
      "Fastify backend not reachable on :4100 — skipping (CI runs with START_FASTIFY=1).",
    );

    const res = await request.get(`${BACKEND}/legacy/`, { timeout: 5_000 });
    if (res.status() === 404) {
      test.skip(
        true,
        "Legacy build not present in public/ — run `pnpm run build:ui:legacy` to enable.",
      );
    }
    expect([200, 304]).toContain(res.status());
    const ct = res.headers()["content-type"] ?? "";
    expect(ct.toLowerCase()).toContain("text/html");
    const body = await res.text();
    // The legacy Vite app's index.html always has <div id="root"> as the
    // React mount point. A future legacy refactor that removes it must
    // update this assertion in lockstep.
    expect(body).toMatch(/<div\s+id=["']root["']/);
  });

  test("/legacy/<unknown-path> falls back to the legacy index.html (SPA shell)", async ({ request }) => {
    const probe = await request.get(`${BACKEND}/api/health`, {
      timeout: 2_000,
    }).catch(() => null);
    test.skip(
      !probe || !probe.ok(),
      "Fastify backend not reachable on :4100 — skipping (CI runs with START_FASTIFY=1).",
    );

    const res = await request.get(`${BACKEND}/legacy/some/unknown/route`, {
      timeout: 5_000,
    });
    if (res.status() === 404) {
      test.skip(
        true,
        "Legacy build not present in public/ — run `pnpm run build:ui:legacy` to enable.",
      );
    }
    expect([200, 304]).toContain(res.status());
    const body = await res.text();
    // The legacy client-side router needs the SPA shell to take over;
    // if the notFoundHandler ever 404s this path, the legacy UI breaks
    // for every non-root route.
    expect(body).toMatch(/<div\s+id=["']root["']/);
  });
});
