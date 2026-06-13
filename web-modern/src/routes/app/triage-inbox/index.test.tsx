/**
 * /app/triage-inbox — route unit test.
 *
 * Asserts the surface-level contract:
 *  - Seeded rows render on first mount.
 *  - "Overdue" saved view filters the table down to overdue rows.
 *  - Row click opens the PeekPanel; the detail body is visible.
 *  - Bulk-action Delete transitions status to resolved, shows the
 *    UndoToast, and Undo restores the original status.
 *
 * Mirrors the `lib/triage/savedViews.test.ts` pattern for
 * resetting state between tests (`__clearForTests`).
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  vi,
} from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";

/* ────────── mocks ────────── */

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children, id }: { children?: React.ReactNode; id?: string }) => (
    <>{children ?? id ?? null}</>
  ),
  useLingui: () => ({
    t: (s: string | TemplateStringsArray) => (Array.isArray(s) ? s[0] : s),
    i18n: { _: (s: string) => s, locale: "hy" },
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (cfg: { component: unknown }) => ({
    fullPath: "/app/triage-inbox/",
    options: cfg,
    useSearch: () => ({}),
    useParams: () => ({}),
    useNavigate: () => vi.fn(),
    update: (u: unknown) => u,
  }),
  Link: ({ children, to }: { children?: React.ReactNode; to?: string }) => (
    <a href={to}>{children}</a>
  ),
}));

import { __clearForTests } from "../../../lib/components/savedViewsStore";
import { __clearTriageFeedForTests } from "../../../lib/triage/feed";
import { TRIAGE_TABLE_ID } from "../../../lib/triage/savedViews";
import { TriageInboxPage } from "./index";

/* ────────── helpers ────────── */

function wrapWithI18n(node: React.ReactNode) {
  return <>{node}</>;
}

// jsdom doesn't implement <dialog>.showModal() / .close(). Patch a
// minimal no-op so the component can mount (mirrors PeekPanel.test.tsx).
beforeEach(() => {
  if (!("showModal" in HTMLDialogElement.prototype)) {
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value: function () {
        (this as HTMLDialogElement & { open: boolean }).open = true;
      },
    });
  }
  if (!("close" in HTMLDialogElement.prototype)) {
    Object.defineProperty(HTMLDialogElement.prototype, "close", {
      configurable: true,
      value: function () {
        (this as HTMLDialogElement & { open: boolean }).open = false;
        this.dispatchEvent(new Event("close"));
      },
    });
  }
});

describe("triage inbox route", () => {
  beforeEach(() => {
    cleanup();
    __clearForTests(TRIAGE_TABLE_ID);
    __clearTriageFeedForTests();
  });

  it("renders the seeded rows on first mount", () => {
    render(wrapWithI18n(<TriageInboxPage />));
    // Header is present
    expect(screen.getByTestId("triage-inbox-page")).toBeInTheDocument();
    // Several fixture rows render via data-table-row-{id} testid
    expect(
      screen.getByTestId("data-table-row-inv-1042-overdue"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("data-table-row-tg-2026-q1-vat"),
    ).toBeInTheDocument();
  });

  it("applies the Overdue view when picked from SavedViews", () => {
    render(wrapWithI18n(<TriageInboxPage />));
    // Open the SavedViews menu
    fireEvent.click(screen.getByTestId("saved-views-trigger"));
    // Click the Overdue row — find the row whose name is "Overdue"
    const overdueRow = screen.getByText("Overdue");
    fireEvent.click(overdueRow);
    // Only the overdue invoice should still be visible.
    expect(
      screen.getByTestId("data-table-row-inv-1042-overdue"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("data-table-row-tg-2026-q1-vat"),
    ).not.toBeInTheDocument();
  });

  it("opens the PeekPanel on row click", () => {
    render(wrapWithI18n(<TriageInboxPage />));
    const row = screen.getByTestId("data-table-row-inv-1042-overdue");
    fireEvent.click(row);
    const peek = screen.getByTestId("triage-inbox-peek");
    expect(peek).toBeInTheDocument();
    // The customer name is shown in the row's subtitle column AND in
    // the peek body, so use getAllByText (>= 1 match) instead of
    // getByText (which would error on the multi-match case).
    const matches = within(peek).getAllByText(/Acme Logistics LLC/);
    expect(matches.length).toBeGreaterThan(0);
  });

  it("Delete bulk action marks resolved, then Undo restores status", async () => {
    render(wrapWithI18n(<TriageInboxPage />));
    // Default "My queue" has at least two rows with assignee=me (the
    // overdue invoice + the Q1 VAT tax-gate). Use the select-all-page
    // checkbox to mark every visible row selected in one click — this
    // is the most robust way to put the bulk bar into a multi-row
    // state from a test (TanStack's per-row toggle is a closure that
    // can drop the second toggle in the same render batch).
    const selectAll = screen.getByTestId("data-table-select-all");
    fireEvent.click(selectAll);
    // Bulk bar is visible with N >= 2 selected.
    const bar = screen.getByTestId("bulk-action-bar");
    expect(bar).toBeInTheDocument();
    const count = Number(bar.getAttribute("data-count"));
    expect(count).toBeGreaterThanOrEqual(2);
    // Capture the ids that are now selected so we can assert on them.
    const selectedIds = [
      "inv-1042-overdue",
      "tg-2026-q1-vat",
    ];
    // Click Delete.
    fireEvent.click(screen.getByTestId("bulk-action-delete"));
    // Undo toast appears.
    const toast = screen.getByTestId("undo-toast");
    expect(toast).toBeInTheDocument();
    // Status badges flip to "resolved" for our known rows.
    for (const id of selectedIds) {
      expect(
        screen
          .getByTestId(`triage-inbox-status-${id}`)
          .textContent?.toLowerCase(),
      ).toContain("resolved");
    }
    // Click Undo.
    fireEvent.click(screen.getByTestId("undo-toast-action"));
    // Statuses are restored.
    for (const id of selectedIds) {
      expect(
        screen
          .getByTestId(`triage-inbox-status-${id}`)
          .textContent?.toLowerCase(),
      ).toContain("open");
    }
  });
});
