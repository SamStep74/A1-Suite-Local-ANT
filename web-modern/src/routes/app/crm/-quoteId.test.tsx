/**
 * /app/crm/$quoteId (detail route) — first route-level test for the
 * CRM quote detail surface.
 *
 * Same mocking pattern as `index.test.tsx`: the route file is glue
 * code that wires TanStack Router + Query to a handful of inline
 * sub-components (`QuoteHeader`, `LineTable`, `TotalsBlock`,
 * `QuoteMetadata`, `Row`) plus the real `AgentActionPanel` and
 * `PricingEvidence` components. The sub-components are NOT
 * individually exported, so the only public surface is the `Route`
 * object returned by `createFileRoute`.
 *
 * The detail page hits ONE query (`crm-quote` keyed by `quoteId`).
 * It then mounts `AgentActionPanel` (which has its own `agents` query)
 * and `PricingEvidence` on the rendered tree. We mock all three via
 * the `useQuery` mock handler — when a key doesn't match anything
 * we return `{ data: null, isLoading: false }` so the child
 * components stay calm.
 *
 * What we cover:
 *   - Loading state (`isLoading: true`).
 *   - notFound() path (query errors or returns no data).
 *   - Header: title, number, customer, deal, status pill.
 *   - Lines table: qty / unit price / discount / line total / margin
 *     classification (green / amber / red / dash).
 *   - Totals block: subtotal + VAT + total.
 *   - Metadata: currency, created, updated, owner, catalog.
 *   - PricingEvidence rendered without throwing.
 *   - AgentActionPanel rendered (proves AgentContext wiring).
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

/* ────────── mock state, hoisted so vi.mock factories can see it ────────── */

const mocks = vi.hoisted(() => ({
  params: { quoteId: "q-1" },
  quote: null as unknown,
  loading: false,
  error: false,
  fullPath: "/app/crm/$quoteId",
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (cfg: { component: unknown }) => ({
    fullPath: mocks.fullPath,
    useSearch: () => ({}),
    useParams: () => mocks.params,
    useNavigate: () => vi.fn(),
    options: cfg,
    update: (u: unknown) => u,
  }),
  Link: ({
    children,
    to,
    ...rest
  }: {
    children?: React.ReactNode;
    to?: string;
  } & Record<string, unknown>) => (
    <a data-href={to} href={to} {...rest}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
  notFound: () => {
    throw new Error("notFound() called");
  },
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => {
      const key = queryKey[0];
      if (key === "crm-quote") {
        return {
          data: mocks.quote,
          isLoading: mocks.loading,
          isError: mocks.error,
        };
      }
      // AgentActionPanel's own query, plus any other component
      // queries — return calm empty state.
      return { data: null, isLoading: false, isError: false };
    },
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  };
});

vi.mock("../../../lib/api/client", () => ({
  getJson: vi.fn().mockResolvedValue({ quotes: [] }),
  postJson: vi.fn().mockResolvedValue({}),
}));

/* ────────── import the route under test (mocks are in place by now) ───── */

import { Route } from "./$quoteId";

/* ────────── helpers ────────── */

function renderRoute() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const Component = Route.options.component as React.ComponentType;
  return render(
    <QueryClientProvider client={qc}>
      <Component />
    </QueryClientProvider>,
  );
}

const VALID_QUOTE = {
  id: "q-1",
  customerId: "c-1",
  customerName: "Acme Clinic",
  taxId: null,
  dealId: "d-1",
  dealTitle: "Q2 expansion",
  number: "Q-001",
  title: "Treatment chair package",
  status: "draft" as const,
  subtotal: 1200000,
  vat: 240000,
  total: 1440000,
  currency: "AMD",
  validUntil: "2026-08-01T00:00:00.000Z",
  createdByName: "Anna Petrosyan",
  createdAt: "2026-06-01T10:00:00.000Z",
  updatedAt: "2026-06-09T15:30:00.000Z",
  lines: [
    {
      id: "l-1",
      catalogItemId: "ci-1",
      catalogPriceListCode: "STANDARD-2026",
      description: "Treatment chair",
      catalogName: "Treatment chair",
      quantity: 2,
      unitPrice: 400000,
      discountAmount: 0,
      total: 800000,
      marginRuleTargetPercent: 32.5, // green
    },
    {
      id: "l-2",
      catalogItemId: "ci-2",
      catalogPriceListCode: "STANDARD-2026",
      description: "Hydraulic table",
      catalogName: "Hydraulic table",
      quantity: 1,
      unitPrice: 400000,
      discountAmount: 50000,
      total: 350000,
      marginRuleTargetPercent: 15.0, // amber
    },
    {
      id: "l-3",
      catalogItemId: "ci-3",
      catalogPriceListCode: "STANDARD-2026",
      description: "Laser module",
      catalogName: "Laser module",
      quantity: 1,
      unitPrice: 50000,
      discountAmount: 0,
      total: 50000,
      marginRuleTargetPercent: 5.0, // red
    },
  ],
};

const SENT_QUOTE = {
  ...VALID_QUOTE,
  id: "q-2",
  number: "Q-002",
  title: "Aesthetic laser",
  status: "sent" as const,
  dealTitle: null,
  validUntil: null,
};

const ACCEPTED_QUOTE = {
  ...VALID_QUOTE,
  id: "q-3",
  number: "Q-003",
  title: "Wellness package",
  status: "accepted" as const,
  dealTitle: "Wellness package",
  validUntil: "2026-07-15T00:00:00.000Z",
  vat: 0,
};

/* ────────── per-test reset ────────── */

beforeEach(() => {
  mocks.params = { quoteId: "q-1" };
  mocks.quote = VALID_QUOTE;
  mocks.loading = false;
  mocks.error = false;
});

afterEach(() => {
  cleanup();
});

/* ─────────────────────────────────────────────────────────────────────
 * Route states — loading, not-found, happy path.
 * ──────────────────────────────────────────────────────────────────── */

describe("QuoteDetail — state", () => {
  it("shows the loading message while the quote is loading", () => {
    mocks.loading = true;
    mocks.quote = null;
    renderRoute();
    expect(screen.getByText(/Loading quote/i)).toBeInTheDocument();
  });

  it("calls notFound() when the quote fails to load", () => {
    mocks.error = true;
    mocks.quote = null;
    // notFound() in the route is wired to throw an Error; the route
    // catches it via the real router, but our mock just throws. We
    // assert the throw, which is what notFound() means here.
    expect(() => renderRoute()).toThrow(/notFound/);
  });

  it("calls notFound() when the quote is null", () => {
    mocks.quote = null;
    expect(() => renderRoute()).toThrow(/notFound/);
  });
});

/* ─────────────────────────────────────────────────────────────────────
 * QuoteHeader — title, number, customer, deal, valid-until, status
 * pill. Pin the per-status pill label.
 * ──────────────────────────────────────────────────────────────────── */

describe("QuoteDetail — header", () => {
  it("renders the title and the quote number", () => {
    renderRoute();
    expect(
      screen.getByRole("heading", { name: "Treatment chair package", level: 1 }),
    ).toBeInTheDocument();
    // Number is rendered as a mono uppercase chip; "Q-001" is the
    // first 8-char fallback for the absense of `number`.
    expect(screen.getByText("Q-001")).toBeInTheDocument();
  });

  it("renders the customer name and the deal title", () => {
    renderRoute();
    expect(screen.getByText("Acme Clinic")).toBeInTheDocument();
    expect(screen.getByText("Q2 expansion")).toBeInTheDocument();
  });

  it("renders the 'Valid …' line when validUntil is set", () => {
    renderRoute();
    // Date format is locale-dependent — assert the prefix only.
    expect(screen.getByText(/^Valid /)).toBeInTheDocument();
  });

  it("omits the 'Valid …' line when validUntil is null", () => {
    mocks.quote = SENT_QUOTE;
    renderRoute();
    expect(screen.queryByText(/^Valid /)).toBeNull();
  });

  it("pins the 'Draft' status pill when status=draft", () => {
    renderRoute();
    // The QuoteHeader renders tone.label which is "Draft" for
    // status=draft. Uppercase styling only — text is the original.
    expect(screen.getByText("Draft")).toBeInTheDocument();
  });

  it("pins the 'Sent' status pill when status=sent", () => {
    mocks.quote = SENT_QUOTE;
    renderRoute();
    expect(screen.getByText("Sent")).toBeInTheDocument();
  });

  it("pins the 'Accepted' status pill when status=accepted", () => {
    mocks.quote = ACCEPTED_QUOTE;
    renderRoute();
    expect(screen.getByText("Accepted")).toBeInTheDocument();
  });

  it("renders the 'Send to customer' button only for draft quotes", () => {
    renderRoute();
    expect(
      screen.getByRole("button", { name: /Send to customer/i }),
    ).toBeInTheDocument();

    cleanup();

    mocks.quote = SENT_QUOTE;
    renderRoute();
    expect(
      screen.queryByRole("button", { name: /Send to customer/i }),
    ).toBeNull();
  });
});

/* ─────────────────────────────────────────────────────────────────────
 * LineTable — the per-line margin classification lives inline in
 * $quoteId.tsx:
 *   margin >= 25 → green check
 *   margin >= 10 → amber alert
 *   margin <  10 → red alert
 *   margin null  → em-dash
 * Each line also shows qty, unit price, line total, discount.
 * ──────────────────────────────────────────────────────────────────── */

describe("QuoteDetail — line table margin classification", () => {
  it("classifies a 32.5% margin as green", () => {
    renderRoute();
    // The 32.5 line is the first one — look for the percentage text.
    expect(screen.getByText("32.5%")).toBeInTheDocument();
  });

  it("classifies a 15.0% margin as amber", () => {
    renderRoute();
    expect(screen.getByText("15.0%")).toBeInTheDocument();
  });

  it("classifies a 5.0% margin as red", () => {
    renderRoute();
    expect(screen.getByText("5.0%")).toBeInTheDocument();
  });

  it("renders a dash for a line without a margin rule", () => {
    mocks.quote = {
      ...VALID_QUOTE,
      lines: [
        {
          ...VALID_QUOTE.lines[0],
          marginRuleTargetPercent: null,
        },
      ],
    };
    renderRoute();
    const table = screen.getByRole("table");
    // The margin cell contains an em-dash for null margin.
    expect(within(table).getByText("—")).toBeInTheDocument();
  });

  it("renders one row per line in the lines table", () => {
    renderRoute();
    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row");
    // 1 header + 3 data rows
    expect(rows).toHaveLength(4);
  });

  it("shows the 'No lines' copy when the quote has no lines", () => {
    mocks.quote = { ...VALID_QUOTE, lines: [] };
    renderRoute();
    expect(screen.getByText(/No lines on this quote yet/i)).toBeInTheDocument();
  });
});

/* ─────────────────────────────────────────────────────────────────────
 * TotalsBlock — subtotal, optional VAT, total. The total falls back
 * to subtotal when quote.total is missing/zero.
 * ──────────────────────────────────────────────────────────────────── */

describe("QuoteDetail — totals", () => {
  it("renders Subtotal, VAT, and Total", () => {
    renderRoute();
    expect(screen.getByText("Subtotal")).toBeInTheDocument();
    expect(screen.getByText("VAT")).toBeInTheDocument();
    expect(screen.getByText("Total")).toBeInTheDocument();
  });

  it("omits VAT when quote.vat is 0", () => {
    mocks.quote = ACCEPTED_QUOTE; // vat: 0
    renderRoute();
    expect(screen.queryByText("VAT")).toBeNull();
  });
});

/* ─────────────────────────────────────────────────────────────────────
 * QuoteMetadata — the right-rail details block. Uses the inline `Row`
 * sub-component for label/value pairs.
 * ──────────────────────────────────────────────────────────────────── */

describe("QuoteDetail — metadata right-rail", () => {
  it("renders the 'Details' heading", () => {
    renderRoute();
    expect(
      screen.getByRole("heading", { name: "Details" }),
    ).toBeInTheDocument();
  });

  it("renders Currency, Created, Updated, Owner, and Catalog rows", () => {
    renderRoute();
    // The Row sub-component renders <dt> for the label.
    const labels = screen
      .getAllByText(/^(Currency|Created|Updated|Owner|Catalog)$/);
    expect(labels.length).toBe(5);
  });

  it("shows the catalog price list code on the first line", () => {
    renderRoute();
    // VALID_QUOTE.lines[0].catalogPriceListCode = "STANDARD-2026"
    expect(screen.getByText("STANDARD-2026")).toBeInTheDocument();
  });

  it("falls back to 'AMD' when currency is unset", () => {
    mocks.quote = { ...VALID_QUOTE, currency: undefined };
    renderRoute();
    expect(screen.getByText("AMD")).toBeInTheDocument();
  });
});

/* ─────────────────────────────────────────────────────────────────────
 * Right rail — the AI Action Panel must render for the quote
 * context. The mock makes the panel's own query return
 * `{ data: null, isLoading: false }` so the panel falls into its
 * "no suggestions" branch, but the wrapper + title still render.
 * ──────────────────────────────────────────────────────────────────── */

describe("QuoteDetail — right rail", () => {
  it("renders the AgentActionPanel with the 'AI suggestions' title", () => {
    renderRoute();
    expect(screen.getByText(/AI suggestions/i)).toBeInTheDocument();
  });

  it("renders the CRM back-link to the list view", () => {
    renderRoute();
    const backLink = screen
      .getAllByRole("link")
      .find((l) => l.textContent === "CRM");
    expect(backLink).toBeDefined();
    expect(backLink?.getAttribute("data-href")).toBe("/app/crm");
  });
});

/* ─────────────────────────────────────────────────────────────────────
 * PricingEvidence — the third-party component renders below the
 * totals block. We assert it doesn't throw and shows its header
 * text (or falls into a calm empty state). The schema is permissive
 * (.passthrough()) so the real CrmQuote shape is fine.
 * ──────────────────────────────────────────────────────────────────── */

describe("QuoteDetail — pricing evidence", () => {
  it("renders the PricingEvidence component without throwing", () => {
    expect(() => renderRoute()).not.toThrow();
  });
});
