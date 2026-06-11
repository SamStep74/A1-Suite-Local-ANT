/**
 * /app/crm-tube — kanban deals board route tests (Phase 8.13, worker 1/3).
 *
 * Mirrors the healthcheck/inventory test pattern. Mocks Router,
 * Query, and the API client. Drives the route through its public
 * `Route` export, swapping the hoisted `mocks.tubes` /
 * `mocks.deals` between tests.
 *
 * Coverage targets (6):
 *  - Page header (English "Tube" + Armenian subtitle)
 *  - Empty-tubes branch when /api/crm/tube returns no tubes
 *  - Tabs render from the tube list with stage counts
 *  - Deal cards render in their stage columns with formatted AMD value
 *  - Back-to-Today link points to /app
 *  - role="alert" error state when queries fail
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

/* ────────── mock state, hoisted so vi.mock factories can see it ────────── */

const mocks = vi.hoisted(() => ({
  search: {} as { tube?: string },
  tubesData: {
    tubes: [
      {
        id: "tube-1",
        name: "Sales",
        description: null,
        is_default: 1,
        position: 0,
        stages: [
          {
            id: "stage-a",
            name: "Lead",
            position: 0,
            probability: 20,
            is_won: 0,
            is_lost: 0,
            color: null,
          },
          {
            id: "stage-b",
            name: "Qualified",
            position: 1,
            probability: 50,
            is_won: 0,
            is_lost: 0,
            color: null,
          },
        ],
      },
    ],
    defaultTubeId: "tube-1",
  } as unknown,
  dealsData: {
    deals: [
      {
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
        contact_email: null,
        organization_name: "Acme",
        stage_name: "Lead",
        stage_probability: 20,
        expected_close_at: "2026-07-15T00:00:00.000Z",
        closed_at: null,
        created_at: "2026-06-01T00:00:00.000Z",
        updated_at: "2026-06-01T00:00:00.000Z",
      },
    ],
  } as unknown,
  loading: false,
  error: false,
  fullPath: "/app/crm-tube/",
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (cfg: { component: unknown; validateSearch: unknown }) => ({
    fullPath: mocks.fullPath,
    useSearch: () => mocks.search,
    useParams: () => ({}),
    useNavigate: () => vi.fn(),
    options: cfg,
  }),
  useSearch: () => mocks.search,
  useParams: () => ({}),
  useNavigate: () => vi.fn(),
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
    <a
      data-href={to}
      data-params={params ? JSON.stringify(params) : undefined}
      href={to}
      {...rest}
    >
      {children}
    </a>
  ),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => {
      const key = queryKey[0];
      if (key === "tube-tubes") {
        return {
          data: mocks.tubesData,
          isLoading: mocks.loading,
          isError: mocks.error,
        };
      }
      if (key === "tube-deals") {
        return {
          data: mocks.dealsData,
          isLoading: mocks.loading,
          isError: mocks.error,
        };
      }
      return { data: null, isLoading: false, isError: false };
    },
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
    useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  };
});

vi.mock("../../../lib/api/client", () => ({
  postJson: vi.fn().mockResolvedValue({}),
  getJson: vi.fn().mockResolvedValue({}),
  postVoid: vi.fn().mockResolvedValue(undefined),
  api: vi.fn().mockResolvedValue({}),
}));

/* ────────── import the route under test (mocks in place) ────────── */

import { Route } from "./index";

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

/* ────────── per-test reset ────────── */

beforeEach(() => {
  mocks.search = {};
  mocks.tubesData = {
    tubes: [
      {
        id: "tube-1",
        name: "Sales",
        description: null,
        is_default: 1,
        position: 0,
        stages: [
          {
            id: "stage-a",
            name: "Lead",
            position: 0,
            probability: 20,
            is_won: 0,
            is_lost: 0,
            color: null,
          },
          {
            id: "stage-b",
            name: "Qualified",
            position: 1,
            probability: 50,
            is_won: 0,
            is_lost: 0,
            color: null,
          },
        ],
      },
    ],
    defaultTubeId: "tube-1",
  };
  mocks.dealsData = {
    deals: [
      {
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
        contact_email: null,
        organization_name: "Acme",
        stage_name: "Lead",
        stage_probability: 20,
        expected_close_at: "2026-07-15T00:00:00.000Z",
        closed_at: null,
        created_at: "2026-06-01T00:00:00.000Z",
        updated_at: "2026-06-01T00:00:00.000Z",
      },
    ],
  };
  mocks.loading = false;
  mocks.error = false;
});

afterEach(() => {
  cleanup();
});

/* ────────── page shell ────────── */

describe("Tube — page shell", () => {
  it("renders the H1 'Tube' and the Armenian subtitle", () => {
    renderRoute();
    expect(
      screen.getByRole("heading", { level: 1, name: /Tube/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("tube-subtitle"),
    ).toHaveTextContent(/Խողող/);
  });

  it("renders a back-to-Today link that points to /app", () => {
    renderRoute();
    const back = screen.getByRole("link", { name: /back to Today/i });
    expect(back.getAttribute("data-href")).toBe("/app");
  });
});

/* ────────── empty + error states ────────── */

describe("Tube — empty and error states", () => {
  it("renders an empty-tubes panel when /api/crm/tube returns no tubes", () => {
    mocks.tubesData = { tubes: [], defaultTubeId: null };
    mocks.dealsData = { deals: [] };
    renderRoute();
    expect(screen.getByText(/No tubes yet/i)).toBeInTheDocument();
  });

  it("renders a role='alert' message when tube queries fail", () => {
    mocks.error = true;
    renderRoute();
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/Could not load tube data/i);
  });
});

/* ────────── kanban content ────────── */

describe("Tube — kanban content", () => {
  it("renders tube tabs with the active tab and stage counts", () => {
    renderRoute();
    const tab = screen.getByRole("tab", { name: /Sales/i });
    expect(tab).toBeInTheDocument();
    expect(tab.getAttribute("aria-selected")).toBe("true");
    // Two stages in the seed data
    expect(tab.textContent).toMatch(/2/);
  });

  it("renders a deal card in its stage column with formatted AMD value", () => {
    renderRoute();
    const card = screen.getByText(/Acme deal/i);
    expect(card).toBeInTheDocument();
    // "1,250,000 AMD" is the legacy app's format
    expect(screen.getByText(/1,250,000 AMD/)).toBeInTheDocument();
    expect(screen.getByText(/Alice/)).toBeInTheDocument();
  });
});
