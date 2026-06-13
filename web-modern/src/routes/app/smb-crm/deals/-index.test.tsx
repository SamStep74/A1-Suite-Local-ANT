/**
 * /app/smb-crm/deals — kanban deals board route tests.
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

const mocks = vi.hoisted(() => ({
  search: {} as { stage?: string },
  deals: {
    deals: [
      {
        id: "d-1",
        title: "Acme renewal",
        value: 1_250_000,
        currency: "AMD",
        status: "open",
        stageId: "lead",
        customerId: "c-1",
        orgId: "o-1",
        ownerUserId: null,
        expectedCloseDate: "2026-07-15",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      },
    ],
  } as unknown,
  loading: false,
  error: false,
  fullPath: "/app/smb-crm/deals/",
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (cfg: { component: unknown }) => ({
    fullPath: mocks.fullPath,
    useSearch: () => mocks.search,
    useParams: () => ({}),
    useNavigate: () => vi.fn(),
    options: cfg,
  }),
  useSearch: () => mocks.search,
  useParams: () => ({}),
  useNavigate: () => vi.fn(),
  Link: ({ children, to, ...rest }: {
    children?: React.ReactNode;
    to?: string;
  } & Record<string, unknown>) => <a data-href={to} {...rest}>{children}</a>,
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    useQuery: () => ({
      data: mocks.deals,
      isLoading: mocks.loading,
      isError: mocks.error,
    }),
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

import { Route } from "./index";

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
  mocks.search = { stage: "lead" };
  mocks.deals = {
    deals: [
      {
        id: "d-1",
        title: "Acme renewal",
        value: 1_250_000,
        currency: "AMD",
        status: "open",
        stageId: "lead",
        customerId: "c-1",
        orgId: "o-1",
        ownerUserId: null,
        expectedCloseDate: "2026-07-15",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      },
    ],
  };
  mocks.loading = false;
  mocks.error = false;
});

afterEach(() => {
  cleanup();
});

describe("SMB CRM deals — board", () => {
  it("renders the H1 'Deals' and the Armenian subtitle", () => {
    renderRoute();
    expect(
      screen.getByRole("heading", { level: 1, name: /Deals/i }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("smb-crm-deals-subtitle")).toHaveTextContent(
      /Գործեր/,
    );
  });

  it("renders the 5-stage tab strip", () => {
    renderRoute();
    const tabs = screen.getByTestId("smb-crm-deals-tabs");
    expect(tabs.querySelectorAll("[role='tab']").length).toBe(5);
  });

  it("renders the deal card with the formatted AMD value", () => {
    renderRoute();
    expect(screen.getByText(/Acme renewal/)).toBeInTheDocument();
    expect(screen.getByText(/1,250,000 AMD/)).toBeInTheDocument();
  });

  it("renders the new-deal button", () => {
    renderRoute();
    expect(screen.getByTestId("smb-crm-deal-new")).toBeInTheDocument();
  });

  it("renders an empty-state panel when there are no deals in the active stage", () => {
    mocks.deals = { deals: [] };
    renderRoute();
    expect(screen.getByTestId("smb-crm-deals-empty")).toBeInTheDocument();
  });

  it("renders a role='alert' message when the deals query fails", () => {
    mocks.error = true;
    renderRoute();
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/Could not load deals/i);
  });
});
