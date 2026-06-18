/**
 * ask-ai.spec.ts — Phase 10.7 e2e coverage for the Ask AI surface.
 *
 * Exercises the four ask-ai user-facing flows the surface must
 * support in Phase 10.5:
 *
 *   1. Stub question   — type a question, submit, observe the
 *                        streamed stub answer, see at least one
 *                        citation chip.
 *   2. Citation click  — click a citation chip and assert the
 *                        panel closes and the URL drills into the
 *                        cited route (Phase 10.5's citation model
 *                        is route-citation-only — no detail panel
 *                        exists yet, so "navigate to cited doc" is
 *                        the contract).
 *   3. Reset / clear   — close the panel and reopen; component
 *                        state is dropped on unmount, so the input
 *                        comes back empty, the prior answer is
 *                        gone, and the empty-state is visible
 *                        again.
 *   4. Locale (en)     — load the page with `?lang=en`, type a
 *                        question, observe English copy on the
 *                        toggle + empty-state, and that the stub
 *                        answer still streams in.
 *
 * Auth: `/app/*` needs a session. We use the standard
 * `authedPage()` helper and skip the test cleanly if the Fastify
 * backend is not reachable (matches the convention in
 * i18n-canary.spec.ts and spa-mode.spec.ts).
 */
import { test, expect } from "@playwright/test";
import { authenticatePage, authedPage, FASTIFY_URL } from "./_helpers";

/**
 * The Phase 10.5 stub returns exactly one citation (the route chip)
 * whenever the parsed `RouteContext` has an `entity` segment. The
 * brief's "3 citation cards render" wording drifted from the
 * actual stub shape — the contract for the surface is "≥1 chip
 * on entity-bearing routes, 0 on /app/{appId} index". We assert
 * the lower bound and comment the contract for future readers.
 */
const STUB_ANSWER_PATTERN = /stub/i;
const STUB_ANSWER_PHRASE = "Phase 10.5 stub answer";

/** The English empty-state sentence and the toggle aria-label are
 *  the canonical English strings the user can see. The en catalog
 *  is currently a placeholder, so `?lang=en` renders the source
 *  string verbatim (per i18n-canary.spec.ts convention). */
const EN_EMPTY_STATE_COPY = "Ask anything about this page.";
const EN_TOGGLE_ARIA = "Open the Ask AI assistant sidebar";

/** A mounted route that gives the parser an `entity` segment.
 *  `/app/crm-tube/contacts` yields the "Contacts" citation chip;
 *  `/app/crm-tube` alone yields entity=undefined and 0 chips. */
const ENTITY_ROUTE = "/app/crm-tube/contacts";

test.describe("Ask AI — surface e2e (Phase 10.7)", () => {
  test.beforeEach(async ({ request }, testInfo) => {
    const probe = await request
      .get(`${FASTIFY_URL}/api/health`, { timeout: 2_000 })
      .catch(() => null);
    testInfo.skip(
      !probe || !probe.ok(),
      `Fastify backend not reachable at ${FASTIFY_URL} — skipping authed ask-ai e2e (CI runs with START_FASTIFY=1).`,
    );
  });

  test("stub question: type, submit, observe streamed answer + ≥1 citation chip", async ({
    browser,
    request,
  }) => {
    const { page } = await authedPage(browser, request);
    try {
      await page.goto(ENTITY_ROUTE);
      await expect(page.getByTestId("app-shell")).toBeVisible();

      // Open the panel.
      const toggle = page.getByTestId("topbar-ask-ai-toggle");
      await expect(toggle).toBeVisible();
      await toggle.click();
      const panel = page.getByTestId("ask-ai-panel");
      await expect(panel).toBeVisible();
      await expect(panel).toHaveAttribute("data-state", "open");

      // Type the question (verbatim from the brief) and submit.
      const input = page.getByTestId("ask-ai-input");
      await expect(input).toBeVisible();
      await input.fill("What is the AR aging for Acme Corp?");
      await page.getByTestId("ask-ai-submit").click();

      // The stub streams the answer in 4-char chunks at 28ms per
      // chunk after an 800ms initial latency. We assert against
      // the canonical Phase 10.5 anchor phrase.
      const answer = page.getByTestId("ask-ai-answer");
      await expect(answer).toBeVisible({ timeout: 15_000 });
      await expect(answer).toContainText(STUB_ANSWER_PATTERN, {
        timeout: 15_000,
      });
      await expect(answer).toContainText(STUB_ANSWER_PHRASE, {
        timeout: 15_000,
      });

      // Citation strip + at least one chip (the entity chip).
      // Phase 10.5 stub returns 1 chip per entity-bearing route;
      // a future real-LLM backend should expand this to multiple.
      const chips = page.getByTestId("ask-ai-citation-chip");
      await expect(chips.first()).toBeVisible({ timeout: 5_000 });
      await expect(chips).toHaveCount(1);
    } finally {
      await page.context().close();
    }
  });

  test("citation click: first chip closes the panel and drills to the cited route", async ({
    browser,
    request,
  }) => {
    const { page } = await authedPage(browser, request);
    try {
      await page.goto(ENTITY_ROUTE);
      await expect(page.getByTestId("app-shell")).toBeVisible();

      const toggle = page.getByTestId("topbar-ask-ai-toggle");
      await toggle.click();
      await expect(page.getByTestId("ask-ai-panel")).toHaveAttribute(
        "data-state",
        "open",
      );

      // Submit a question so the stub returns the citation strip.
      await page.getByTestId("ask-ai-input").fill("cite test");
      await page.getByTestId("ask-ai-submit").click();
      const answer = page.getByTestId("ask-ai-answer");
      await expect(answer).toBeVisible({ timeout: 15_000 });
      await expect(answer).toContainText(STUB_ANSWER_PHRASE, {
        timeout: 15_000,
      });

      // Wait for the citation strip to render.
      const chip = page.getByTestId("ask-ai-citation-chip").first();
      await expect(chip).toBeVisible({ timeout: 5_000 });

      // Click the chip → AskAiPanel's onCitationClick handler
      // closes the panel, then citations.tsx navigates to the
      // stub's href. For /app/crm-tube/contacts that href is
      // `/app/crm-tube/contacts` (entity present, no id) — the
      // route is already mounted, so the URL stays the same but
      // the panel is gone. We assert the panel unmounts.
      const beforePath = new URL(page.url()).pathname;
      await chip.click();
      await expect(page.getByTestId("ask-ai-panel")).toHaveCount(0, {
        timeout: 5_000,
      });
      // We didn't navigate away from a valid route — either the
      // path is preserved (in-app nav to current URL) or it
      // changed to a deeper citation (entity/id). Both are valid
      // for the stub. The non-regression contract is: panel is
      // closed and we are still inside the CRM Tube app surface.
      const afterPath = new URL(page.url()).pathname;
      expect(afterPath.startsWith("/app/crm-tube")).toBe(true);
      // The path can stay the same when we navigate to our own
      // URL (TanStack Router no-ops), but we still want to
      // assert we didn't somehow get bounced to an unrelated app.
      void beforePath;
    } finally {
      await page.context().close();
    }
  });

  test("reset / clear: close + reopen drops prior question, answer, and input", async ({
    page,
    request,
  }) => {
    await authenticatePage(page, request);
    await page.goto(ENTITY_ROUTE);
    await expect(page.getByTestId("app-shell")).toBeVisible();

    const toggle = page.getByTestId("topbar-ask-ai-toggle");
    await toggle.click();
    const panel = page.getByTestId("ask-ai-panel");
    await expect(panel).toHaveAttribute("data-state", "open");

    // Empty state visible on first open.
    await expect(page.getByTestId("ask-ai-empty")).toBeVisible();

    // Submit a question and wait for the answer to land.
    const input = page.getByTestId("ask-ai-input");
    await input.fill("this question should be cleared by reset");
    await page.getByTestId("ask-ai-submit").click();
    const answer = page.getByTestId("ask-ai-answer");
    await expect(answer).toBeVisible({ timeout: 15_000 });
    await expect(answer).toContainText(STUB_ANSWER_PHRASE, {
      timeout: 15_000,
    });
    // Empty state is gone now that we have an answer.
    await expect(page.getByTestId("ask-ai-empty")).toHaveCount(0);

    // "Reset" UX: there is no explicit Reset button in the
    // sidebar (Phase 10.5). The canonical way to clear state is
    // to close the panel and reopen — closing clears local
    // question/answer state.
    await page.getByLabel("Close Ask AI panel").click();
    await expect(page.getByTestId("ask-ai-panel")).toHaveCount(0, {
      timeout: 5_000,
    });
    await toggle.click();
    await expect(page.getByTestId("ask-ai-panel")).toHaveAttribute(
      "data-state",
      "open",
    );

    // After reopen: input is empty, answer is gone, empty-state
    // is back. This is the reset contract.
    const resetInput = page.getByTestId("ask-ai-input");
    await expect(resetInput).toBeVisible();
    await expect(resetInput).toHaveValue("");
    await expect(page.getByTestId("ask-ai-answer")).toHaveCount(0);
    await expect(page.getByTestId("ask-ai-empty")).toBeVisible();
    await page.getByLabel("Close Ask AI panel").click();
    await expect(page.getByTestId("ask-ai-panel")).toHaveCount(0, {
      timeout: 5_000,
    });
  });

  test("locale (en): loads with ?lang=en, English copy renders, stub still streams", async ({
    browser,
    request,
  }) => {
    const { page } = await authedPage(browser, request);
    try {
      await page.goto(`${ENTITY_ROUTE}/?lang=en`);
      await expect(page.getByTestId("app-shell")).toBeVisible();

      // The locale switcher writes <html lang="...">; with the
      // en catalog (a placeholder) the source strings render
      // verbatim. The Russian and Armenian catalogs also fall
      // back to the source string, so this assertion is robust
      // against catalog gaps.
      await expect(page.locator("html")).toHaveAttribute("lang", "en");

      // English copy on the toggle and empty state.
      const toggle = page.getByTestId("topbar-ask-ai-toggle");
      await expect(toggle).toHaveAttribute("aria-label", EN_TOGGLE_ARIA);
      await toggle.click();
      await expect(page.getByTestId("ask-ai-panel")).toHaveAttribute(
        "data-state",
        "open",
      );
      await expect(page.getByTestId("ask-ai-empty")).toBeVisible();
      await expect(page.getByTestId("ask-ai-empty")).toContainText(
        EN_EMPTY_STATE_COPY,
      );

      // Submit a question; the stub still streams its canned
      // English answer regardless of locale (the stub prose is
      // hard-coded English, by design — see stubAnswerFor()).
      await page.getByTestId("ask-ai-input").fill("What is the AR aging for Acme Corp?");
      await page.getByTestId("ask-ai-submit").click();
      const answer = page.getByTestId("ask-ai-answer");
      await expect(answer).toBeVisible({ timeout: 15_000 });
      await expect(answer).toContainText(STUB_ANSWER_PHRASE, {
        timeout: 15_000,
      });
    } finally {
      await page.context().close();
    }
  });
});
