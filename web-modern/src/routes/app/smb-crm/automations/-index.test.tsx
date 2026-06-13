/**
 * /app/smb-crm/automations — automation list + run log route tests.
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
  automations: {
    automations: [
      {
        id: "auto-1",
        name: "Welcome new lead",
        triggerEvent: "customer.created",
        action: "send_outbound_message",
        enabled: true,
      },
    ],
  } as unknown,
  runs: {
    runs: [
      {
        id: "run-1",
        automationId: "auto-1",
        status: "ok",
        createdAt: "2026-06-01T00:00:00.000Z",
      },
    ],
  } as unknown,
  error: false,
  fullPath: "/app/smb-crm/automations/",
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (cfg: { component: unknown }) => ({
    fullPath: mocks.fullPath,
    useSearch: () => ({}),
    useParams: () => ({}),
    useNavigate: () => vi.fn(),
    options: cfg,
  }),
  useSearch: () => ({}),
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
      const key = queryKey[0];
      if (key === "smb-crm-automations") {
        return {
          data: mocks.automations,
          isLoading: false,
          isError: mocks.error,
        };
      }
      if (key === "smb-crm-automation-runs") {
        return {
          data: mocks.runs,
          isLoading: false,
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
  mocks.automations = {
    automations: [
      {
        id: "auto-1",
        name: "Welcome new lead",
        triggerEvent: "customer.created",
        action: "send_outbound_message",
        enabled: true,
      },
    ],
  };
  mocks.runs = {
    runs: [
      {
        id: "run-1",
        automationId: "auto-1",
        status: "ok",
        createdAt: "2026-06-01T00:00:00.000Z",
      },
    ],
  };
  mocks.error = false;
});

afterEach(() => {
  cleanup();
});

describe("SMB CRM automations — list", () => {
  it("renders the H1 'Automations'", () => {
    renderRoute();
    expect(
      screen.getByRole("heading", { level: 1, name: /Automations/i }),
    ).toBeInTheDocument();
  });

  it("renders one row per automation, with a Run button", () => {
    renderRoute();
    const runBtn = screen.getByTestId("smb-crm-automation-run");
    expect(runBtn).toBeInTheDocument();
    expect(runBtn.getAttribute("data-run-for")).toBe("auto-1");
  });

  it("renders the run log table", () => {
    renderRoute();
    expect(screen.getByTestId("smb-crm-automations-runs")).toBeInTheDocument();
  });

  it("renders a role='alert' message when the automations query fails", () => {
    mocks.error = true;
    renderRoute();
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/Could not load automations/i);
  });
});
