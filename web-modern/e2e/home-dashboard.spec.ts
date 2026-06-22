/**
 * home-dashboard.spec.ts — e2e smoke for /app (the Today /
 * Exceptions feed). Locks in slice 31's fix for the 3 home
 * dashboard widget errors ("Couldn't load: API response did
 * not match expected shape").
 *
 * Why this matters:
 *   - The home page is the user's first impression.
 *   - Schema-vs-route drift between
 *     `web-modern/src/lib/api/schemas.ts#ServiceConsoleSchema`
 *     and `server/app.js#getServiceQueue` was a real bug that
 *     made all 3 widgets fail to render. The unit tests in
 *     `schemas.test.ts` lock in the schema; this e2e test
 *     locks in the wire path.
 *
 * Auth: every protected route needs a session. We use the
 * standard `authedPage()` helper and skip the test cleanly if
 * the Fastify backend is not reachable.
 */
import { test, expect } from "@playwright/test";
import { authedPage, FASTIFY_URL, BASE_URL } from "./_helpers";

const ROUTE = `${BASE_URL}/app/`;

test.describe("/app — Today / Exceptions feed (slice 31)", () => {
  test.beforeAll(async ({ request }) => {
    const probe = await request
      .get(`${FASTIFY_URL}/api/health`, { timeout: 2_000 })
      .catch(() => null);
    test.skip(
      !probe || !probe.ok(),
      `Fastify backend not reachable at ${FASTIFY_URL} — skipping authed home e2e (CI runs with START_FASTIFY=1).`
    );
  });

  test("renders the page header + the 3 counter cards without a 'Couldn't load' alert", async ({
    browser,
    request
  }) => {
    const { page } = await authedPage(browser, request);
    try {
      await page.goto(ROUTE);
      // Header — the H1 is "Today"
      const h1 = page.getByRole("heading", { name: "Today", level: 1 });
      await expect(h1).toBeVisible({ timeout: 10_000 });
      // 3 counter cards. The labels live in the ExceptionCard
      // component, so we assert by text content (the page has
      // duplicate text in the section titles — the section
      // titles use the same labels — so `.first()` is the
      // counter card, which is the one rendered above the
      // section list).
      for (const label of ["Exceptions", "Awaiting your approval", "Completed today"]) {
        await expect(
          page.getByText(label, { exact: true }).first()
        ).toBeVisible();
      }
      // No schema-mismatch alert (the bug from slice 31).
      // The page renders a `role="alert"` block on error; this
      // should be absent.
      const errorAlerts = page.getByRole("alert");
      const count = await errorAlerts.count();
      expect(count).toBe(0);
    } finally {
      await page.context().close();
    }
  });

  test("the queue counters load (the schema-vs-route drift fix from slice 31)", async ({
    browser,
    request
  }) => {
    // Slice 31's second bug: `queue` was an OBJECT but the
    // Zod schema was `z.array(z.unknown())`. The page doesn't
    // use queue directly, but the schema parse error caused
    // the entire /api/service/console round-trip to fail,
    // which made all 3 widgets fail. This test asserts the
    // round-trip works (the page renders without error).
    const { page } = await authedPage(browser, request);
    try {
      await page.goto(ROUTE);
      // Wait for the page to settle (any 500s from
      // /api/service/console would have rendered the alert).
      await page.waitForLoadState("networkidle", { timeout: 10_000 });
      // The schema-mismatch error message is "API response did
      // not match expected shape". If the schema parse fails,
      // the page renders this alert. We assert it's absent.
      const error = page.getByText(/API response did not match expected shape/);
      await expect(error).toHaveCount(0);
    } finally {
      await page.context().close();
    }
  });
});
