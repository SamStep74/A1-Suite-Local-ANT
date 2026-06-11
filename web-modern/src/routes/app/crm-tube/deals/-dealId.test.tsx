/**
 * /app/crm-tube/deals/$dealId — deal detail route tests (Phase 8.13, worker 1/3).
 *
 * Drives the route through its public `Route` export. Mocks Router
 * (with a fixed dealId param), Query (3 query keys: tube-deal,
 * tube-activities, tube-sequences), and the API client.
 *
 * Coverage targets:
 *  - H1 deal title renders
 *  - Status pill + stage badge render with correct labels
 *  - Field rows render contact / org / expected close / stage
 *  - Activities timeline renders activities; empty state when none
 *  - Back link points to /app/crm-tube
 *  - role="alert" error state when deal query fails
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

/* ────────── mock state, hoisted ────────── */

const mocks = vi.hoisted(() => ({
  params: { dealId: "deal-1" },
  deal: {
    id: "deal-1",
    title: "Acme deal",
    value: 1_250_000,
    currency: "AMD",
    status: "open",
    stage_id: "stage-a",
    tube_id: "tube-1",
    contact_id: "c-1",
    organization_id: "o-1",
    owner_user_id: null,
    contact_name: "Alice",
    contact_email: "alice@acme.test",
    organization_name: "Acme",
    stage_name: "Lead",
    stage_probability: 20,
    expected_close_at: "2026-07-15T00:00:00.000Z",
    closed_at: null,
    created_at: "2026-06-01T00:00:00.000Z",
    updated_at: "2026-06-01T00:00:00.000Z",
  } as unknown,
  activities: [
    {
      id: "act-1",
      deal_id: "deal-1",
      kind: "call",
      subject: "Discovery call",
      body: "Discussed pricing",
      occurred_at: "2026-06-05T10:00:00.000Z",
    },
  ] as unknown,
  sequences: [
    {
      id: "seq-1",
      name: "Re-engage",
      description: null,
      is_active: true,
      integration_key: null,
      external_id: null,
      step_count: 3,
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-01T00:00:00.000Z",
    },
  ] as unknown,
  loading: false,
  error: false,
  fullPath: "/app/crm-tube/deals/$dealId",
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (cfg: { component: unknown }) => ({
    fullPath: mocks.fullPath,
    useSearch: () => ({}),
    useParams: () => mocks.params,
    useNavigate: () => vi.fn(),
    options: cfg,
  }),
  useParams: () => mocks.params,
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
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
      if (key === "tube-deal") {
        return {
          data: { deal: mocks.deal },
          isLoading: mocks.loading,
          isError: mocks.error,
        };
      }
      if (key === "tube-activities") {
        return { data: { activities: mocks.activities }, isLoading: false, isError: false };
      }
      if (key === "tube-sequences") {
        return { data: { sequences: mocks.sequences }, isLoading: false, isError: false };
      }
      return { data: null, isLoading: false, isError: false };
    },
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
    useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  };
});

vi.mock("../../../../lib/api/client", () => ({
  postJson: vi.fn().mockResolvedValue({}),
  getJson: vi.fn().mockResolvedValue({}),
  postVoid: vi.fn().mockResolvedValue(undefined),
  api: vi.fn().mockResolvedValue({}),
}));

/* ────────── import the route under test ────────── */

import { Route } from "./$dealId";

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

beforeEach(() => {
  mocks.params = { dealId: "deal-1" };
  mocks.loading = false;
  mocks.error = false;
});

afterEach(() => {
  cleanup();
});

/* ────────── page shell ────────── */

describe("Tube deal — page shell", () => {
  it("renders the H1 with the deal title and the formatted AMD value", () => {
    renderRoute();
    expect(
      screen.getByRole("heading", { level: 1, name: /Acme deal/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/1,250,000 AMD/)).toBeInTheDocument();
  });

  it("renders the status pill and the stage badge", () => {
    renderRoute();
    // Status pill text is the Armenian "Բաց" (open)
    expect(screen.getByText("Բաց")).toBeInTheDocument();
    // Stage badge + stage field both render "Lead" (the badge as a
    // pill, the field as the stage name). Use getAllByText to assert
    // presence without forcing a single match.
    expect(screen.getAllByText("Lead").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/20%/)).toBeInTheDocument();
  });

  it("renders a back link that points to /app/crm-tube", () => {
    renderRoute();
    const back = screen.getByRole("link", { name: /back to Tube/i });
    expect(back.getAttribute("data-href")).toBe("/app/crm-tube");
  });
});

/* ────────── detail content ────────── */

describe("Tube deal — detail content", () => {
  it("renders the contact and organization fields", () => {
    renderRoute();
    expect(screen.getByText(/Alice/)).toBeInTheDocument();
    // Use exact match — the deal title is "Acme deal" so a /Acme/
    // regex matches both the title and the org name. Exact match
    // is the unambiguous way to assert the org field rendered.
    expect(screen.getByText("Acme")).toBeInTheDocument();
  });

  it("renders an activity row from the activities feed", () => {
    renderRoute();
    expect(screen.getByText(/Discovery call/i)).toBeInTheDocument();
  });

  it("renders the empty-timeline state when no activities exist", () => {
    mocks.activities = [];
    renderRoute();
    expect(screen.getByTestId("tube-activities-empty")).toBeInTheDocument();
    expect(screen.getByText(/Գործողություններ դեռ չկան/)).toBeInTheDocument();
  });
});

/* ────────── error state ────────── */

describe("Tube deal — error state", () => {
  it("renders a role='alert' message when the deal query fails", () => {
    mocks.error = true;
    renderRoute();
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/Գործը չի գտնվել/);
  });
});
