/**
 * /app/period-close — route-level tests for the W4-PORT surface.
 *
 * Covers the brief's six required scenarios:
 *   1. Summary strip renders the right X/N for a given period.
 *   2. DataTable shows the 13 steps in 5 categories.
 *   3. Marking a step "done" updates the summary count + the
 *      localStorage write at `a1:close:<periodId>:<stepId>`.
 *   4. The UndoToast catches the action and reverts on click.
 *   5. Prev/next month controls update the period in the URL.
 *   6. Page renders the period header on first mount.
 *
 * Lingui is mocked per the codebase convention (the macro plugin
 * is intentionally not enabled in `vitest.config.ts`).
 *
 * LocalStorage is cleared between tests so the assertions about
 * the localStorage write are deterministic and don't leak state
 * across runs. The route uses `lib/close/state.ts#localStorageAdapter`
 * which falls back to the in-memory shim if `window.localStorage`
 * is missing — but jsdom does provide it, so we hit the real one.
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
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

/* Capture the latest navigate call so we can assert that the
 * period picker updated the URL search. The router mock stores
 * the latest call on a hoisted variable. */
const routerMock = vi.hoisted(() => ({
  navigateCalls: [] as Array<{ search: { period?: string } | undefined }>,
  searchPeriod: "2026-06",
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (cfg: { component: unknown }) => ({
    fullPath: "/app/period-close/",
    options: cfg,
    useSearch: () => ({ period: routerMock.searchPeriod }),
    useParams: () => ({}),
    useNavigate: () => (next: { search: { period?: string } }) => {
      routerMock.navigateCalls.push(next);
      if (next?.search?.period) {
        routerMock.searchPeriod = next.search.period;
      }
      return Promise.resolve();
    },
    update: (u: unknown) => u,
  }),
  Link: ({ children, to }: { children?: React.ReactNode; to?: string }) => (
    <a href={to}>{children}</a>
  ),
}));

/* ────────── imports under test (mocks are in place by now) ────────── */

import { Route, shiftPeriod, StatusPill } from "./index";
import {
  CHECKLIST_STEPS,
  CHECKLIST_TOTAL_STEPS,
  STORAGE_PREFIX,
  groupByCategory,
  readStepState,
  localStorageAdapter,
} from "../../../lib/close";

/* ────────── helpers ────────── */

function clearCloseState(): void {
  const keys: string[] = [];
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const k = window.localStorage.key(i);
    if (k && k.startsWith(STORAGE_PREFIX)) keys.push(k);
  }
  for (const k of keys) window.localStorage.removeItem(k);
}

function renderRoute() {
  const Component = Route.options.component as React.ComponentType;
  return render(<Component />);
}

/* ────────── per-test setup ────────── */

beforeEach(() => {
  routerMock.navigateCalls.length = 0;
  routerMock.searchPeriod = "2026-06";
  clearCloseState();
});

afterEach(() => {
  cleanup();
  clearCloseState();
});

/* ────────── tests ────────── */

describe("period-close — page shell", () => {
  it("renders the page header with the period id from URL search", () => {
    renderRoute();
    const page = screen.getByTestId("period-close-page");
    expect(page).toBeInTheDocument();
    const label = screen.getByTestId("period-label");
    expect(label).toHaveTextContent(/June 2026/);
    expect(label.getAttribute("data-period-id")).toBe("2026-06");
  });

  it("renders the summary strip with 0 of N done for a fresh period", () => {
    renderRoute();
    const summary = screen.getByTestId("period-close-summary");
    expect(summary).toHaveAttribute("data-done", "0");
    expect(summary.getAttribute("data-total")).toBe(String(CHECKLIST_TOTAL_STEPS));
    expect(summary).toHaveTextContent(/0 of/);
  });
});

describe("period-close — DataTable", () => {
  it("renders all 13 canonical steps", async () => {
    renderRoute();
    // The 10.4 DataTable emits `data-testid="data-table-row-{id}"`
    // for each row. We expect one row per step.
    await waitFor(() => {
      const rows = document.querySelectorAll(
        '[data-testid^="data-table-row-"]:not([data-testid^="data-table-row-select-"])',
      );
      expect(rows.length).toBe(CHECKLIST_TOTAL_STEPS);
    });
  });

  it("groups the 13 steps into the 5 canonical categories", () => {
    const grouped = groupByCategory(CHECKLIST_STEPS);
    const keys = Object.keys(grouped);
    expect(keys).toContain("Reconcile");
    expect(keys).toContain("Post");
    expect(keys).toContain("Reports");
    expect(keys).toContain("Tax");
    expect(keys).toContain("Lock");
    // 4 + 3 + 3 + 2 + 1
    expect(grouped.Reconcile).toHaveLength(4);
    expect(grouped.Post).toHaveLength(3);
    expect(grouped.Reports).toHaveLength(3);
    expect(grouped.Tax).toHaveLength(2);
    expect(grouped.Lock).toHaveLength(1);
  });
});

describe("period-close — Mark done updates summary + localStorage", () => {
  it("selecting 2 rows + clicking Mark done updates summary to 2/N and writes the keys", async () => {
    renderRoute();

    // Wait for rows to mount
    await waitFor(() => {
      const rows = document.querySelectorAll(
        '[data-testid^="data-table-row-"]:not([data-testid^="data-table-row-select-"])',
      );
      expect(rows.length).toBe(CHECKLIST_TOTAL_STEPS);
    });

    // Select the first two rows via the 10.4 per-row checkbox
    // (`data-table-row-select-{id}`).
    const bankSelect = screen.getByTestId("data-table-row-select-reconcile-bank");
    const cardsSelect = screen.getByTestId("data-table-row-select-reconcile-cards");
    fireEvent.click(bankSelect);
    fireEvent.click(cardsSelect);

    // The bulk bar mounts with count=2
    const bar = await screen.findByTestId("bulk-action-bar");
    expect(bar).toHaveAttribute("data-count", "2");

    // Click "Mark done"
    fireEvent.click(screen.getByTestId("bulk-action-mark-done"));

    // Summary should reflect 2 done
    await waitFor(() => {
      const summary = screen.getByTestId("period-close-summary");
      expect(summary).toHaveAttribute("data-done", "2");
    });

    // localStorage should have 2 keys at a1:close:2026-06:<stepId>
    const storage = localStorageAdapter();
    const stateBank = readStepState(storage, "2026-06", {
      ...CHECKLIST_STEPS[0]!,
    });
    const stateCards = readStepState(storage, "2026-06", {
      ...CHECKLIST_STEPS[1]!,
    });
    expect(stateBank.status).toBe("done");
    expect(stateCards.status).toBe("done");

    // The row pills should reflect the new state for the affected rows
    const bankRow = screen.getByTestId("data-table-row-reconcile-bank");
    const cardsRow = screen.getByTestId("data-table-row-reconcile-cards");
    expect(within(bankRow).getByTestId("status-pill-done")).toBeInTheDocument();
    expect(within(cardsRow).getByTestId("status-pill-done")).toBeInTheDocument();
  });
});

describe("period-close — UndoToast", () => {
  it("Mark done shows the toast, and Undo reverts the local state", async () => {
    renderRoute();

    await waitFor(() => {
      const rows = document.querySelectorAll(
        '[data-testid^="data-table-row-"]:not([data-testid^="data-table-row-select-"])',
      );
      expect(rows.length).toBe(CHECKLIST_TOTAL_STEPS);
    });

    // Select + Mark done a single row
    fireEvent.click(screen.getByTestId("data-table-row-select-reconcile-bank"));
    fireEvent.click(screen.getByTestId("bulk-action-mark-done"));

    // Summary should be 1 done
    await waitFor(() => {
      const summary = screen.getByTestId("period-close-summary");
      expect(summary).toHaveAttribute("data-done", "1");
    });

    // UndoToast should appear with a "Marked" message
    const toast = await screen.findByTestId("undo-toast");
    expect(toast).toBeInTheDocument();
    expect(toast.textContent).toMatch(/marked done/i);

    // Click Undo
    fireEvent.click(screen.getByTestId("undo-toast-action"));

    // Toast should hide
    await waitFor(() => {
      expect(screen.queryByTestId("undo-toast")).toBeNull();
    });

    // Summary should drop back to 0 done
    await waitFor(() => {
      const summary = screen.getByTestId("period-close-summary");
      expect(summary).toHaveAttribute("data-done", "0");
    });

    // localStorage should NOT have a "done" entry for the touched step
    const storage = localStorageAdapter();
    const stateBank = readStepState(storage, "2026-06", CHECKLIST_STEPS[0]!);
    expect(stateBank.status).toBe("pending");
  });
});

describe("period-close — period picker (prev/next)", () => {
  it("clicking prev decrements the period and pushes a new URL", async () => {
    const { rerender } = renderRoute();
    const label = screen.getByTestId("period-label");
    expect(label).toHaveTextContent(/June 2026/);

    fireEvent.click(screen.getByTestId("period-prev"));

    // The router mock updates the hoisted searchPeriod. The
    // real TanStack Router triggers a re-render on navigate();
    // our test mock doesn't, so we `rerender` to force the next
    // render to read the updated search period.
    const Component = Route.options.component as React.ComponentType;
    rerender(<Component />);

    await waitFor(() => {
      const next = screen.getByTestId("period-label");
      expect(next).toHaveTextContent(/May 2026/);
      expect(next.getAttribute("data-period-id")).toBe("2026-05");
    });
    expect(routerMock.navigateCalls.length).toBeGreaterThanOrEqual(1);
    expect(routerMock.navigateCalls[0]!.search!.period).toBe("2026-05");
  });

  it("shiftPeriod helper: 2026-01 + 1 = 2026-02; 2026-01 - 1 = 2025-12", () => {
    expect(shiftPeriod("2026-01", 1)).toBe("2026-02");
    expect(shiftPeriod("2026-01", -1)).toBe("2025-12");
    // December → January rolls the year
    expect(shiftPeriod("2026-12", 1)).toBe("2027-01");
    // Garbage is returned unchanged
    expect(shiftPeriod("not-a-period", 1)).toBe("not-a-period");
  });
});

describe("period-close — StatusPill (component export)", () => {
  it("renders the right pill for each status", () => {
    const { rerender } = render(<StatusPill status="done" />);
    expect(screen.getByTestId("status-pill-done")).toBeInTheDocument();

    rerender(<StatusPill status="blocked" />);
    expect(screen.getByTestId("status-pill-blocked")).toBeInTheDocument();

    rerender(<StatusPill status="skipped" />);
    expect(screen.getByTestId("status-pill-skipped")).toBeInTheDocument();

    rerender(<StatusPill status="pending" />);
    expect(screen.getByTestId("status-pill-pending")).toBeInTheDocument();
  });
});
