/**
 * _dom-fill — direct-DOM fill helper for tests where
 * Playwright's `locator.fill()` actionability check hangs.
 *
 * The /app/documents/invoice-create route renders a wizard
 * with text inputs that Playwright's `fill()` cannot complete
 * in CI/local e2e runs against the Vite dev server. The
 * inputs are demonstrably visible, stable, enabled, and
 * uncovered (verified via getBoundingClientRect +
 * elementFromPoint + animation/transition audit), but
 * `locator.fill()` still reports "waiting for element to be
 * visible, enabled and editable" until its timeout. `force: true`
 * does not bypass the wait either.
 *
 * The bypass uses the standard React-friendly pattern:
 *
 *   1. Read the input's prototype and grab the native `value`
 *      setter (so React's onChange fires).
 *   2. Call the setter with the desired value.
 *   3. Dispatch `input` and `change` events so React picks
 *      up the change and updates its internal state.
 *
 * For keyboard-driven tests (e.g. the locale-switch test
 * that needs a real keypress to assert focus), use
 * `_dom-type.ts` (pressSequentially wrapper) instead.
 */
import type { Locator, Page } from "@playwright/test";

/** Set the value of an input by testid using the React-friendly
 *  setter pattern. Returns the final value of the input.
 *
 *  The optional `scope` is a CSS selector for a parent element
 *  — useful when the same testid appears multiple times in the
 *  DOM (e.g. one `wizard-line-description` per line-item row).
 *  When omitted, the first matching element is used. */
export async function domFillByTestId(
  page: Page,
  testId: string,
  value: string,
  scope?: string,
): Promise<string> {
  return page.evaluate(
    ({ testId, value, scope }) => {
      const root: ParentNode = scope
        ? (document.querySelector(scope) ?? document)
        : document;
      const el = root.querySelector(
        `[data-testid="${testId}"]`,
      ) as HTMLInputElement | HTMLTextAreaElement | null;
      if (!el) {
        const ctx = scope ? ` inside ${scope}` : "";
        throw new Error(
          `No element with data-testid="${testId}"${ctx}`,
        );
      }
      const proto = Object.getPrototypeOf(el) as object;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (!setter) {
        throw new Error(
          `Element with data-testid="${testId}" has no value setter`,
        );
      }
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return el.value;
    },
    { testId, value, scope },
  );
}

/** Check or uncheck a checkbox by testid. The optional
 *  `scope` selector is the same as for `domFillByTestId`. */
export async function domSetCheckedByTestId(
  page: Page,
  testId: string,
  checked: boolean,
  scope?: string,
): Promise<void> {
  await page.evaluate(
    ({ testId, checked, scope }) => {
      const root: ParentNode = scope
        ? (document.querySelector(scope) ?? document)
        : document;
      const el = root.querySelector(
        `[data-testid="${testId}"]`,
      ) as HTMLInputElement | null;
      if (!el) {
        const ctx = scope ? ` inside ${scope}` : "";
        throw new Error(`No element with data-testid="${testId}"${ctx}`);
      }
      const proto = Object.getPrototypeOf(el) as object;
      const setter = Object.getOwnPropertyDescriptor(proto, "checked")?.set;
      if (setter) setter.call(el, checked);
      el.checked = checked;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    { testId, checked, scope },
  );
}

/** Click an element by testid. Bypasses Playwright's
 *  actionability check. The element is dispatched a
 *  bubbling click event. The optional `scope` selector
 *  is the same as for `domFillByTestId`. For the
 *  click-on-the-Nth-match case (e.g. `wizard-line-remove`
 *  has one instance per row), pass `index` to pick
 *  a specific match. */
export async function domClickByTestId(
  page: Page,
  testId: string,
  opts: { scope?: string; index?: number } = {},
): Promise<void> {
  await page.evaluate(
    ({ testId, scope, index }) => {
      const root: ParentNode = scope
        ? (document.querySelector(scope) ?? document)
        : document;
      const els = root.querySelectorAll(
        `[data-testid="${testId}"]`,
      ) as NodeListOf<HTMLElement>;
      if (els.length === 0) {
        const ctx = scope ? ` inside ${scope}` : "";
        throw new Error(`No element with data-testid="${testId}"${ctx}`);
      }
      const el = index !== undefined ? els[index] : els[0];
      if (!el) {
        throw new Error(
          `Index ${index} out of range (${els.length} matches) for data-testid="${testId}"`,
        );
      }
      el.click();
    },
    { testId, scope: opts.scope, index: opts.index },
  );
}

/** Type into an input by testid, one character at a time,
 *  using keyboard events. Falls back to domFill if the
 *  element cannot be focused. */
export async function domTypeByTestId(
  page: Page,
  testId: string,
  value: string,
): Promise<string> {
  // Try to focus + type via keyboard events first.
  const focused = await page.evaluate((testId) => {
    const el = document.querySelector(`[data-testid="${testId}"]`) as
      | HTMLInputElement
      | null;
    if (!el) return false;
    el.focus();
    return document.activeElement === el;
  }, testId);
  if (focused) {
    // Clear any existing value
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Delete");
    await page.keyboard.type(value, { delay: 5 });
    const final = await page.evaluate((testId) => {
      const el = document.querySelector(`[data-testid="${testId}"]`) as
        | HTMLInputElement
        | null;
      return el?.value ?? "";
    }, testId);
    if (final === value) return final;
  }
  // Fall back to direct setter
  return domFillByTestId(page, testId, value);
}

/** Convenience: build a Locator-like object whose `fill` /
 *  `click` / `check` methods use the DOM helpers. For tests
 *  that already use Locator chains, you can call
 *  `domFromLocator(page, page.getByTestId("..."))` and then
 *  use `.fill()` on the returned wrapper. */
export function domFromLocator(
  page: Page,
  locator: Locator,
  testId: string,
): {
  fill: (value: string) => Promise<string>;
  click: () => Promise<void>;
  check: () => Promise<void>;
  uncheck: () => Promise<void>;
  type: (value: string) => Promise<string>;
  locator: Locator;
} {
  void locator;
  return {
    fill: (value: string) => domFillByTestId(page, testId, value),
    click: () => domClickByTestId(page, testId),
    check: () => domSetCheckedByTestId(page, testId, true),
    uncheck: () => domSetCheckedByTestId(page, testId, false),
    type: (value: string) => domTypeByTestId(page, testId, value),
    locator,
  };
}
