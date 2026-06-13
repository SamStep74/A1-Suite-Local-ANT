/**
 * /app/smb-crm/customers/$customerId — customer detail route tests.
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
  params: { customerId: "c-1" } as { customerId: string },
  customer: {
    customer: {
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
  } as unknown,
  deals: {
    deals: [
      {
        id: 'd-1',
        customerId: 'c-1',
        title: 'Acme Q3 expansion',
        value: 1500000,
        currency: 'AMD',
        stage: 'negotiation',
        ownerId: 'u-1',
        branchId: null,
        expectedCloseDate: '2026-09-30',
        custom: {},
        createdAt: '2026-06-01T00:00:00.000Z',
      },
    ],
  } as unknown,
  activities: {
    activities: [
      {
        id: 'a-1',
        customerId: 'c-1',
        kind: 'call',
        body: 'Intro call · 30 min · interested in CRM module',
        at: '2026-06-05T10:00:00.000Z',
        actorId: 'u-1',
      },
    ],
  } as unknown,
  summary: { summary: "A solid enterprise lead." } as unknown,
  loading: false,
  error: false,
  fullPath: "/app/smb-crm/customers/$customerId",
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (cfg: { component: unknown }) => ({
    fullPath: mocks.fullPath,
    useSearch: () => ({}),
    useParams: () => mocks.params,
    useNavigate: () => vi.fn(),
    options: cfg,
  }),
  useSearch: () => ({}),
  useParams: () => mocks.params,
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
      const key = queryKey[0];
      if (key === "smb-crm-customer") {
        return { data: mocks.customer, isLoading: false, isError: false };
      }
      if (key === "smb-crm-customer-deals") {
        return { data: mocks.deals, isLoading: false, isError: false };
      }
      if (key === "smb-crm-customer-acts") {
        return { data: mocks.activities, isLoading: false, isError: false };
      }
      if (key === "smb-crm-customer-summary") {
        return { data: mocks.summary, isLoading: false, isError: false };
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

import { Route } from "./$customerId";

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
  mocks.params = { customerId: "c-1" };
  mocks.customer = {
    customer: {
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
  };
  mocks.deals = {
    deals: [
      {
        id: 'd-1',
        customerId: 'c-1',
        title: 'Acme Q3 expansion',
        value: 1500000,
        currency: 'AMD',
        stage: 'negotiation',
        ownerId: 'u-1',
        branchId: null,
        expectedCloseDate: '2026-09-30',
        custom: {},
        createdAt: '2026-06-01T00:00:00.000Z',
      },
    ],
  };
  mocks.activities = {
    activities: [
      {
        id: 'a-1',
        customerId: 'c-1',
        kind: 'call',
        body: 'Intro call · 30 min · interested in CRM module',
        at: '2026-06-05T10:00:00.000Z',
        actorId: 'u-1',
      },
    ],
  };
  mocks.summary = { summaryText: "A solid enterprise lead." };
});

afterEach(() => {
  cleanup();
});

describe("SMB CRM customers — detail", () => {
  it("renders the H1 and the customer's email", () => {
    renderRoute();
    expect(
      screen.getByRole("heading", { level: 1, name: /Alice Abc/ }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("smb-crm-customer-detail-email")).toHaveTextContent(
      /alice@example.com/,
    );
  });

  it("renders the deals + activities sections", () => {
    renderRoute();
    expect(screen.getByTestId("smb-crm-customer-deals")).toBeInTheDocument();
    expect(
      screen.getByTestId("smb-crm-customer-activities"),
    ).toBeInTheDocument();
  });

  it("renders the customer summary text when present", () => {
    renderRoute();
    expect(screen.getByTestId("smb-crm-customer-summary")).toHaveTextContent(
      /enterprise lead/,
    );
  });

  it("renders the customer summary text when present", () => {
    renderRoute();
    expect(screen.getByTestId("smb-crm-customer-summary")).toHaveTextContent(
      /enterprise lead/,
    );
  });
});
