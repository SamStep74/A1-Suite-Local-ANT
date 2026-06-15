/**
 * _triage-helpers — spec-specific wrappers for the triage-inbox
 * e2e spec. The i18n shim itself lives in `_i18n-shim.ts` and is
 * shared with the document-steppers spec — both hit the same
 * `tours.ts` + `lingui.ts` race conditions in Vite dev mode.
 */
import type {
  Browser,
  APIRequestContext,
  Page,
} from "@playwright/test";
import { authedPage as baseAuthedPage } from "./_helpers";
import { installI18nShim } from "./_i18n-shim";

/** Login → authed context with the i18n shim installed → page.
 *  Drops in for `_helpers.authedPage` in this spec. */
export async function authedTriagePage(
  browser: Browser,
  request: APIRequestContext,
): Promise<{ page: Page; context: import("@playwright/test").BrowserContext; sid: string }> {
  const { page, context, sid } = await baseAuthedPage(browser, request);
  await installI18nShim(context);
  return { page, context, sid };
}

/** Navigate to `/app/triage-inbox/?lang=hy` and assert the page mounted.
 *  The lang query is for the saved-view "All" / "Overdue" / "Awaiting"
 *  literal-label assertions (Armenian source). */
export async function gotoTriageInbox(page: Page): Promise<void> {
  const response = await page.goto("/app/triage-inbox/?lang=hy");
  if (!response) {
    throw new Error("triage-inbox route did not respond");
  }
  if (![200, 304].includes(response.status())) {
    throw new Error(
      `triage-inbox route returned ${response.status()}, expected 200/304`,
    );
  }
  await page.getByTestId("triage-inbox-page").waitFor({ timeout: 15_000 });
  await page
    .getByRole("heading", { level: 1, name: /Triage inbox/i })
    .waitFor({ timeout: 5_000 });
}
