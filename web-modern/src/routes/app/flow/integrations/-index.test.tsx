/**
 * /app/flow/integrations — route-level tests for the Integration hub.
 *
 * Mirrors flow/-index.test.tsx: mock the three layers (Router, Query,
 * API client), then drive the public component surface for the 3
 * sub-surfaces: connectors | webhooks | deliveries.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

/* ────────── mock state ────────── */

const mocks = vi.hoisted(() => ({
  search: { view: "connectors" as string },
  data: {
    connectors: null as unknown,
    webhooks: null as unknown,
    deliveries: null as unknown,
  },
  loading: { connectors: false, webhooks: false, deliveries: false },
  error: { connectors: false, webhooks: false, deliveries: false },
  mutation: { isPending: false, variables: undefined as unknown },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (cfg: { component: unknown }) => ({
    useParams: () => ({}),
    useSearch: () => mocks.search,
    useNavigate: () => vi.fn(),
    options: cfg,
  }),
  Link: ({
    children,
    to,
    params,
    ...rest
  }: {
    children?: React.ReactNode;
    to?: string;
    params?: Record<string, string>;
  } & Record<string, unknown>) => (
    <a data-href={to} href={to} data-params={JSON.stringify(params ?? {})} {...rest}>
      {children}
    </a>
  ),
  notFound: () => {
    throw new Error("notFound() called");
  },
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => {
      const key = String(queryKey[0] ?? "");
      if (key === "integration-connectors") {
        return {
          data: mocks.data.connectors,
          isLoading: mocks.loading.connectors,
          isError: mocks.error.connectors,
        };
      }
      if (key === "webhook-endpoints") {
        return {
          data: mocks.data.webhooks,
          isLoading: mocks.loading.webhooks,
          isError: mocks.error.webhooks,
        };
      }
      if (key === "webhook-deliveries") {
        return {
          data: mocks.data.deliveries,
          isLoading: mocks.loading.deliveries,
          isError: mocks.error.deliveries,
        };
      }
      return { data: null, isLoading: false, isError: false };
    },
    useMutation: () => mocks.mutation,
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  };
});

vi.mock("../../../lib/api/client", () => ({
  getJson: vi.fn().mockResolvedValue({}),
  postJson: vi.fn().mockResolvedValue({}),
  postVoid: vi.fn().mockResolvedValue(undefined),
}));

/* ────────── import under test ────────── */

import { Route } from "./index";

/* ────────── helpers ────────── */

function renderRoute() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Component = Route.options.component as React.ComponentType;
  return render(
    <QueryClientProvider client={qc}>
      <Component />
    </QueryClientProvider>,
  );
}

const CONNECTORS_DATA = {
  ok: true,
  connectors: [
    {
      key: "stripe",
      displayName: "Stripe",
      description: "Payments",
      status: "healthy",
      enabled: true,
      config: {},
      lastHealthStatus: {
        status: "healthy",
        latencyMs: 87,
        checkedAt: "2026-06-10T08:00:00Z",
      },
    },
    {
      key: "twilio",
      displayName: "Twilio",
      description: "SMS",
      status: "down",
      enabled: true,
      config: {},
      lastHealthStatus: null,
    },
  ],
};

const WEBHOOKS_DATA = {
  ok: true,
  endpoints: [
    {
      id: "wh-1",
      url: "https://example.com/hooks/a",
      events: ["quote.accepted", "invoice.paid"],
      enabled: true,
      secret: "shh",
      createdAt: "2026-06-01T00:00:00Z",
    },
    {
      id: "wh-2",
      url: "https://example.com/hooks/b",
      events: ["lead.created"],
      enabled: false,
      secret: null,
      createdAt: "2026-05-15T00:00:00Z",
    },
  ],
};

const DELIVERIES_DATA = {
  ok: true,
  deliveries: [
    {
      id: "del-1",
      endpointId: "wh-1",
      endpointUrl: "https://example.com/hooks/a",
      eventType: "quote.accepted",
      status: "succeeded",
      responseCode: 200,
      responseSnippet: "ok",
      attemptedAt: "2026-06-10T08:00:00Z",
      retryCount: 0,
    },
    {
      id: "del-2",
      endpointId: "wh-1",
      endpointUrl: "https://example.com/hooks/a",
      eventType: "invoice.paid",
      status: "failed",
      responseCode: 503,
      responseSnippet: "Service Unavailable",
      attemptedAt: "2026-06-10T07:30:00Z",
      retryCount: 2,
    },
  ],
};

/* ────────── per-test reset ────────── */

beforeEach(() => {
  mocks.search = { view: "connectors" };
  mocks.data = { connectors: null, webhooks: null, deliveries: null };
  mocks.loading = { connectors: false, webhooks: false, deliveries: false };
  mocks.error = { connectors: false, webhooks: false, deliveries: false };
  mocks.mutation = { isPending: false, variables: undefined };
});

afterEach(() => {
  cleanup();
});

/* ────────── page shell ────────── */

describe("Integrations — page shell", () => {
  it("renders the page title", () => {
    renderRoute();
    expect(
      screen.getByRole("heading", { name: "Integration hub", level: 1 }),
    ).toBeInTheDocument();
  });
  it("renders the subtitle", () => {
    renderRoute();
    expect(
      screen.getByText(/Connectors · Webhook endpoints · Delivery ledger/),
    ).toBeInTheDocument();
  });
  it("renders the back-to-flow link", () => {
    renderRoute();
    const back = screen.getByRole("link", { name: /Back to Flow/ });
    expect(back).toBeInTheDocument();
    expect(back.getAttribute("data-href")).toBe("/app/flow");
  });
});

/* ────────── validateSearch ────────── */

describe("Integrations — validateSearch", () => {
  const fn = Route.options.validateSearch as (raw: Record<string, unknown>) => unknown;
  it("defaults to connectors", () => {
    expect(fn({})).toEqual({ view: "connectors" });
  });
  it("accepts each known view", () => {
    expect(fn({ view: "connectors" })).toEqual({ view: "connectors" });
    expect(fn({ view: "webhooks" })).toEqual({ view: "webhooks" });
    expect(fn({ view: "deliveries" })).toEqual({ view: "deliveries" });
  });
  it("falls back to connectors for unknown values", () => {
    expect(fn({ view: "audit" })).toEqual({ view: "connectors" });
    expect(fn({ view: 7 })).toEqual({ view: "connectors" });
  });
});

/* ────────── ViewSwitcher ────────── */

describe("Integrations — ViewSwitcher", () => {
  it("renders 3 tabs with role=tablist", () => {
    renderRoute();
    const tablist = screen.getByRole("tablist", { name: "View" });
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs).toHaveLength(3);
  });
  it("renders the 3 expected tab labels", () => {
    renderRoute();
    expect(screen.getByRole("tab", { name: "Connectors" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Webhooks" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Deliveries" })).toBeInTheDocument();
  });
  it("marks connectors as the default selected tab", () => {
    renderRoute();
    expect(screen.getByRole("tab", { name: "Connectors" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
  it("marks the URL view as the selected tab", () => {
    mocks.search = { view: "webhooks" };
    renderRoute();
    expect(screen.getByRole("tab", { name: "Webhooks" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "Connectors" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });
});

/* ────────── Connectors view ────────── */

describe("Integrations — Connectors view", () => {
  it("shows the loading state", () => {
    mocks.loading.connectors = true;
    renderRoute();
    expect(screen.getByText(/Loading connectors/i)).toBeInTheDocument();
  });
  it("shows the error state", () => {
    mocks.error.connectors = true;
    renderRoute();
    expect(screen.getByText(/Failed to load connectors/i)).toBeInTheDocument();
  });
  it("shows the empty state when connectors are missing", () => {
    mocks.data.connectors = { connectors: [] };
    renderRoute();
    expect(screen.getByText(/No connectors configured/i)).toBeInTheDocument();
  });
  it("renders the integration-connector entity marker with count", () => {
    mocks.data.connectors = CONNECTORS_DATA;
    renderRoute();
    const marker = document.querySelector('[data-entity="integration-connector"]');
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute("data-count")).toBe("2");
  });
  it("renders the connectors table with healthy + down pills", () => {
    mocks.data.connectors = CONNECTORS_DATA;
    renderRoute();
    expect(screen.getByText("Stripe")).toBeInTheDocument();
    expect(screen.getByText("Twilio")).toBeInTheDocument();
    expect(screen.getByTestId("connector-row-stripe")).toBeInTheDocument();
    expect(screen.getByTestId("connector-row-twilio")).toBeInTheDocument();
    expect(screen.getAllByText(/^healthy$/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^down$/i).length).toBeGreaterThan(0);
  });
  it("shows 'Never checked' when lastHealthStatus is null", () => {
    mocks.data.connectors = CONNECTORS_DATA;
    renderRoute();
    expect(screen.getByText(/Never checked/i)).toBeInTheDocument();
  });
});

/* ────────── Webhooks view ────────── */

describe("Integrations — Webhooks view", () => {
  beforeEach(() => {
    mocks.search = { view: "webhooks" };
  });
  it("shows the loading state", () => {
    mocks.loading.webhooks = true;
    renderRoute();
    expect(screen.getByText(/Loading webhooks/i)).toBeInTheDocument();
  });
  it("shows the error state", () => {
    mocks.error.webhooks = true;
    renderRoute();
    expect(screen.getByText(/Failed to load webhooks/i)).toBeInTheDocument();
  });
  it("shows the empty state when endpoints are missing", () => {
    mocks.data.webhooks = { endpoints: [] };
    renderRoute();
    expect(
      screen.getByText(/No webhook endpoints registered/i),
    ).toBeInTheDocument();
  });
  it("renders the webhook-endpoint entity marker with count", () => {
    mocks.data.webhooks = WEBHOOKS_DATA;
    renderRoute();
    const marker = document.querySelector('[data-entity="webhook-endpoint"]');
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute("data-count")).toBe("2");
  });
  it("renders the endpoints table with URL + events", () => {
    mocks.data.webhooks = WEBHOOKS_DATA;
    renderRoute();
    expect(screen.getByTestId("webhook-row-wh-1")).toBeInTheDocument();
    expect(screen.getByTestId("webhook-row-wh-2")).toBeInTheDocument();
    expect(screen.getByText(/https:\/\/example\.com\/hooks\/a/)).toBeInTheDocument();
    expect(screen.getByText(/quote\.accepted, invoice\.paid/)).toBeInTheDocument();
  });
});

/* ────────── Deliveries view ────────── */

describe("Integrations — Deliveries view", () => {
  beforeEach(() => {
    mocks.search = { view: "deliveries" };
  });
  it("shows the loading state", () => {
    mocks.loading.deliveries = true;
    renderRoute();
    expect(screen.getByText(/Loading deliveries/i)).toBeInTheDocument();
  });
  it("shows the error state", () => {
    mocks.error.deliveries = true;
    renderRoute();
    expect(screen.getByText(/Failed to load deliveries/i)).toBeInTheDocument();
  });
  it("shows the empty state when deliveries are missing", () => {
    mocks.data.deliveries = { deliveries: [] };
    renderRoute();
    expect(screen.getByText(/No webhook deliveries yet/i)).toBeInTheDocument();
  });
  it("renders the webhook-delivery entity marker with count", () => {
    mocks.data.deliveries = DELIVERIES_DATA;
    renderRoute();
    const marker = document.querySelector('[data-entity="webhook-delivery"]');
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute("data-count")).toBe("2");
  });
  it("renders succeeded + failed pills and a Retry button on the failed row only", () => {
    mocks.data.deliveries = DELIVERIES_DATA;
    renderRoute();
    expect(screen.getAllByText(/^succeeded$/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^failed$/i).length).toBeGreaterThan(0);
    // Only the failed delivery (del-2) gets a Retry button.
    const failedRow = screen.getByTestId("delivery-row-del-2");
    const succeededRow = screen.getByTestId("delivery-row-del-1");
    expect(within(failedRow).getByRole("button", { name: /Retry/i })).toBeInTheDocument();
    expect(within(succeededRow).queryByRole("button", { name: /Retry/i })).toBeNull();
  });
  it("shows the response code + snippet in the row", () => {
    mocks.data.deliveries = DELIVERIES_DATA;
    renderRoute();
    const failedRow = screen.getByTestId("delivery-row-del-2");
    expect(failedRow.textContent).toMatch(/503/);
    expect(failedRow.textContent).toMatch(/Service Unavailable/);
  });
});
