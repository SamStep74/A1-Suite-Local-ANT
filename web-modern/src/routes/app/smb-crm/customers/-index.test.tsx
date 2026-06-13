/**
 * /app/smb-crm/customers — customer list route tests.
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
  search: {} as { status?: string; branch?: string; q?: string },
  customers: {
    customers: [
      {
        id: "c-1",
        orgId: "o-1",
        fullName: "Alice Abc",
        email: "alice@example.com",
        phone: null,
        companyName: "Acme",
        address: null,
        locale: "en",
        status: "active",
        branchId: null,
        tags: [],
        custom: {},
        mergedIntoId: null,
        createdAt: "2026-06-01T00:00:00.000Z",
      },
      {
        id: "c-2",
        orgId: "o-1",
        fullName: "Bob Def",
        email: null,
        phone: null,
        companyName: null,
        address: null,
        locale: "en",
        status: "lead",
        branchId: null,
        tags: [],
        custom: {},
        mergedIntoId: null,
        createdAt: "2026-06-02T00:00:00.000Z",
      },
    ],
  } as unknown,
  loading: false,
  error: false,
  fullPath: "/app/smb-crm/customers/",
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
    useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => {
      if (queryKey[0] === "smb-crm-customers") {
        return {
          data: mocks.customers,
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
  mocks.search = {};
  mocks.customers = {
    customers: [
      {
        id: "c-1",
        orgId: "o-1",
        fullName: "Alice Abc",
        email: "alice@example.com",
        phone: null,
        companyName: "Acme",
        address: null,
        locale: "en",
        status: "active",
        branchId: null,
        tags: [],
        custom: {},
        mergedIntoId: null,
        createdAt: "2026-06-01T00:00:00.000Z",
      },
      {
        id: "c-2",
        orgId: "o-1",
        fullName: "Bob Def",
        email: null,
        phone: null,
        companyName: null,
        address: null,
        locale: "en",
        status: "lead",
        branchId: null,
        tags: [],
        custom: {},
        mergedIntoId: null,
        createdAt: "2026-06-02T00:00:00.000Z",
      },
    ],
  };
  mocks.loading = false;
  mocks.error = false;
});

afterEach(() => {
  cleanup();
});

describe("SMB CRM customers — list", () => {
  it("renders the H1 'Customers' and the Armenian subtitle", () => {
    renderRoute();
    expect(
      screen.getByRole("heading", { level: 1, name: /Customers/i }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("smb-crm-customers-subtitle")).toHaveTextContent(
      /Հաճախորդներ/,
    );
  });

  it("renders a card for each customer, grouped by status", () => {
    renderRoute();
    const groups = screen.getAllByTestId("smb-crm-customers-group");
    expect(groups.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/Alice Abc/)).toBeInTheDocument();
    expect(screen.getByText(/Bob Def/)).toBeInTheDocument();
  });

  it("renders the search input", () => {
    renderRoute();
    expect(screen.getByTestId("smb-crm-customers-search")).toBeInTheDocument();
  });

  it("renders status filter chips", () => {
    renderRoute();
    const chips = screen.getAllByTestId("smb-crm-customers-status-chip");
    expect(chips.length).toBe(3);
  });

  it("renders an empty state when there are no customers", () => {
    mocks.customers = { customers: [] };
    renderRoute();
    expect(screen.getByTestId("smb-crm-customers-empty")).toBeInTheDocument();
  });

  it("renders a role='alert' message when the query fails", () => {
    mocks.error = true;
    renderRoute();
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/Could not load customers/i);
  });
});
