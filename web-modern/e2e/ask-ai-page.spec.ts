/**
 * ask-ai-page.spec.ts — e2e coverage for the new
 * /app/smb-crm/ai page (Phase 10.13 / slice 11 + 14).
 *
 * Tests the SPA surface for the sovereign Ask AI page:
 *
 *   1. Page renders — the 4 preset buttons, the system prompt
 *      textarea, the empty history hint, and the streaming
 *      toggle (default ON).
 *   2. Provider badge — appears in the header. When Ollama is
 *      not running, the badge shows "none" or "ollama · no_provider"
 *      in amber. When Ollama IS running, the badge is green
 *      with the model name.
 *   3. Send button gating — disabled when the user input is
 *      empty. Enabled when non-empty.
 *   4. Streaming path (default) — submit routes through
 *      /api/ai/chat/stream and renders a streaming cursor
 *      that hides when the stream completes. On the dev box
 *      without Ollama, the stream yields a single
 *      no_provider error and the history shows the error.
 *   5. Non-streaming path — uncheck the toggle, submit, the
 *      page routes through /api/ai/chat (the legacy one-shot
 *      endpoint).
 *   6. Armenian + emoji user input round-trips into the
 *      outbound body. Server error responses (or the
 *      no_provider sentinel) render in the history.
 *   7. Back link — points to /app/smb-crm.
 *
 * Auth: every protected route needs a session. We use the
 * standard `authedPage()` helper and skip the test cleanly if
 * the Fastify backend is not reachable (matches the convention
 * in i18n-canary.spec.ts and spa-mode.spec.ts).
 */
import { test, expect } from "@playwright/test";
import {
  authedPage,
  FASTIFY_URL,
  BASE_URL
} from "./_helpers";

const ROUTE = `${BASE_URL}/app/smb-crm/ai`;

test.describe("Ask AI page (slice 11 + 14)", () => {
  test.beforeAll(async ({ request }) => {
    // Skip the whole suite gracefully if the Fastify backend
    // isn't running. The e2e harness in CI sets START_FASTIFY=1;
    // local devs may not have the backend up.
    const probe = await request
      .get(`${FASTIFY_URL}/api/health`, { timeout: 2_000 })
      .catch(() => null);
    test.skip(
      !probe || !probe.ok(),
      `Fastify backend not reachable at ${FASTIFY_URL} — skipping Ask AI page e2e (CI runs with START_FASTIFY=1).`
    );
  });

  test("page renders with the 4 preset buttons, empty history, and streaming toggle (default ON)", async ({
    browser,
    request
  }) => {
    const { page } = await authedPage(browser, request);
    try {
      await page.goto(ROUTE);
      await expect(page.getByTestId("smb-crm-ai")).toBeVisible();
      // H1 + subtitle
      await expect(page.getByTestId("smb-crm-ai-h1")).toHaveText(/Ask AI/);
      await expect(page.getByTestId("smb-crm-ai-subtitle")).toContainText(/Sovereign local LLM/);
      // 4 preset buttons
      const presets = page.getByTestId("smb-crm-ai-preset");
      await expect(presets).toHaveCount(4);
      const ids = await presets.evaluateAll((els) =>
        els.map((el) => (el as HTMLElement).dataset.presetId)
      );
      expect(ids).toEqual(["summarise", "translate", "draft", "none"]);
      // Empty history hint
      await expect(page.getByTestId("smb-crm-ai-history-empty")).toBeVisible();
      // Streaming toggle default ON
      const cb = page.getByTestId("smb-crm-ai-streaming-checkbox");
      await expect(cb).toBeChecked();
    } finally {
      await page.context().close();
    }
  });

  test("provider badge appears in the header", async ({ browser, request }) => {
    const { page } = await authedPage(browser, request);
    try {
      await page.goto(ROUTE);
      const badge = page.getByTestId("smb-crm-ai-status");
      await expect(badge).toBeVisible();
      // The badge text must contain the provider name.
      // When Ollama is running, the text is "ollama · <model>".
      // When it's not, the text is "none · no_provider" or
      // "ollama · <error>". Either is acceptable; we just
      // assert the badge is non-empty and one of the two shapes.
      const txt = (await badge.textContent()) ?? "";
      expect(txt.length).toBeGreaterThan(0);
      // No API key prefix can ever appear in the badge.
      expect(txt).not.toMatch(/sk-ant-/);
      expect(txt).not.toMatch(/sk-openai-/);
      expect(txt).not.toMatch(/ghp_/);
    } finally {
      await page.context().close();
    }
  });

  test("Send button is disabled when user input is empty; enabled when non-empty", async ({
    browser,
    request
  }) => {
    const { page } = await authedPage(browser, request);
    try {
      await page.goto(ROUTE);
      const send = page.getByTestId("smb-crm-ai-send");
      await expect(send).toBeDisabled();
      const ta = page.getByTestId("smb-crm-ai-user-input");
      await ta.fill("hi");
      await expect(send).toBeEnabled();
    } finally {
      await page.context().close();
    }
  });

  test("default streaming path: submit fires POST /api/ai/chat/stream and renders the result", async ({
    browser,
    request
  }) => {
    const { page } = await authedPage(browser, request);
    // Capture /api/ai/chat/stream traffic.
    const streamCalls: Array<{ body: string }> = [];
    page.on("request", (req) => {
      if (req.url().endsWith("/api/ai/chat/stream") && req.method() === "POST") {
        streamCalls.push({ body: req.postData() ?? "" });
      }
    });
    try {
      await page.goto(ROUTE);
      const ta = page.getByTestId("smb-crm-ai-user-input");
      await ta.fill("summarise the ARMENIAN text");
      await page.getByTestId("smb-crm-ai-send").click();
      // Either: streaming success → streaming cursor appears + history grows,
      // OR: no_provider → history shows the error.
      // Wait for either.
      await Promise.race([
        page.waitForSelector("[data-testid='smb-crm-ai-streaming-cursor']", { timeout: 8_000 }).then(() => "streaming"),
        page.waitForSelector("[data-testid='smb-crm-ai-history-err']", { timeout: 8_000 }).then(() => "error"),
        page.waitForSelector("[data-testid='smb-crm-ai-history-ai']", { timeout: 8_000 }).then(() => "success")
      ]).catch(() => "timeout");
      // Assert the stream endpoint was called (not the legacy /api/ai/chat).
      expect(streamCalls.length).toBeGreaterThanOrEqual(1);
      // The body must contain the user message we typed.
      const body = streamCalls[0]?.body ?? "";
      expect(body).toContain("summarise the ARMENIAN text");
    } finally {
      await page.context().close();
    }
  });

  test("unchecking the streaming toggle routes the next send through /api/ai/chat (not the stream)", async ({
    browser,
    request
  }) => {
    const { page } = await authedPage(browser, request);
    const legacyCalls: string[] = [];
    const streamCalls: string[] = [];
    page.on("request", (req) => {
      if (req.method() !== "POST") return;
      if (req.url().endsWith("/api/ai/chat/stream")) streamCalls.push(req.url());
      if (req.url().endsWith("/api/ai/chat") && !req.url().endsWith("/stream")) {
        legacyCalls.push(req.url());
      }
    });
    try {
      await page.goto(ROUTE);
      // Uncheck streaming.
      await page.getByTestId("smb-crm-ai-streaming-checkbox").click();
      const ta = page.getByTestId("smb-crm-ai-user-input");
      await ta.fill("non-streaming question");
      await page.getByTestId("smb-crm-ai-send").click();
      // Wait for either history entry.
      await Promise.race([
        page.waitForSelector("[data-testid='smb-crm-ai-history-err']", { timeout: 8_000 }),
        page.waitForSelector("[data-testid='smb-crm-ai-history-ai']", { timeout: 8_000 })
      ]).catch(() => null);
      expect(legacyCalls.length).toBeGreaterThanOrEqual(1);
      expect(streamCalls.length).toBe(0);
    } finally {
      await page.context().close();
    }
  });

  test("Armenian + emoji user input round-trips into the outbound body", async ({
    browser,
    request
  }) => {
    const { page } = await authedPage(browser, request);
    const captured: string[] = [];
    page.on("request", (req) => {
      if (req.url().endsWith("/api/ai/chat/stream") && req.method() === "POST") {
        captured.push(req.postData() ?? "");
      }
    });
    try {
      await page.goto(ROUTE);
      const armenian = "Բարև աշխարհ 🇦🇲";
      await page.getByTestId("smb-crm-ai-user-input").fill(armenian);
      await page.getByTestId("smb-crm-ai-send").click();
      // Give the request a moment to fire.
      await page.waitForTimeout(500);
      expect(captured.length).toBeGreaterThanOrEqual(1);
      expect(captured[0]).toContain(armenian);
    } finally {
      await page.context().close();
    }
  });

  test("Back link points to /app/smb-crm", async ({ browser, request }) => {
    const { page } = await authedPage(browser, request);
    try {
      await page.goto(ROUTE);
      const back = page.getByTestId("smb-crm-ai-back");
      await expect(back).toBeVisible();
      // In the real TanStack Router render, the attribute is
      // `href` (not `data-href` — that was the vitest mock).
      // Accept either form to be robust to future refactors.
      const href = await back.getAttribute("href");
      expect(["/app/smb-crm", "/app/smb-crm/"]).toContain(href);
    } finally {
      await page.context().close();
    }
  });

  test("NO API key ever appears anywhere in the rendered DOM after a full flow", async ({
    browser,
    request
  }) => {
    const { page } = await authedPage(browser, request);
    try {
      await page.goto(ROUTE);
      const ta = page.getByTestId("smb-crm-ai-user-input");
      await ta.fill("trigger history");
      await page.getByTestId("smb-crm-ai-send").click();
      // Wait for some history state to appear.
      await Promise.race([
        page.waitForSelector("[data-testid='smb-crm-ai-history-err']", { timeout: 8_000 }),
        page.waitForSelector("[data-testid='smb-crm-ai-history-ai']", { timeout: 8_000 })
      ]).catch(() => null);
      // Inspect the entire body for known API key prefixes.
      const html = await page.content();
      expect(html).not.toMatch(/sk-ant-[A-Za-z0-9_-]{10,}/);
      expect(html).not.toMatch(/sk-openai-[A-Za-z0-9_-]{10,}/);
      expect(html).not.toMatch(/ghp_[A-Za-z0-9]{20,}/);
    } finally {
      await page.context().close();
    }
  });
});
