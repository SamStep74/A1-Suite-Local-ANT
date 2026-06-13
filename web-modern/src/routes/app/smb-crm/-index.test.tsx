/**
 * /app/smb-crm — onboarding questionnaire route tests (Phase 10, Track 5).
 *
 * Mirrors the crm-tube test pattern. Mocks Router, Query, and the API
 * client. Drives the route through its public `Route` export.
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
  search: {} as { step?: string; locale?: string },
  templates: {
    industryTemplates: [
      {
        industryKey: "retail",
        label: "Retail",
        modules: ["customers", "deals", "tasks"],
        pipeline: ["lead", "qualified", "won"],
        fields: ["email", "phone"],
        kpis: ["monthly_revenue"],
      },
      {
        industryKey: "horeca",
        label: "Horeca",
        modules: ["customers", "deals"],
        pipeline: ["lead", "won"],
        fields: ["email"],
        kpis: [],
      },
    ],
  } as unknown,
  loading: false,
  error: false,
  fullPath: "/app/smb-crm/",
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
      const key = queryKey[0];
      if (key === "smb-crm-templates") {
        return {
          data: mocks.templates,
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
  postJson: vi.fn().mockResolvedValue({ ok: true, blueprintId: "bp-1" }),
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
  mocks.templates = {
    industryTemplates: [
      {
        industryKey: "retail",
        label: "Retail",
        modules: ["customers", "deals", "tasks"],
        pipeline: ["lead", "qualified", "won"],
        fields: ["email", "phone"],
        kpis: ["monthly_revenue"],
      },
      {
        industryKey: "horeca",
        label: "Horeca",
        modules: ["customers", "deals"],
        pipeline: ["lead", "won"],
        fields: ["email"],
        kpis: [],
      },
    ],
  };
  mocks.loading = false;
  mocks.error = false;
});

afterEach(() => {
  cleanup();
});

describe("SMB CRM — onboarding", () => {
  it("renders the H1 'SMB CRM' and the Armenian subtitle", () => {
    renderRoute();
    expect(
      screen.getByRole("heading", { level: 1, name: /SMB CRM/i }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("smb-crm-onboarding-subtitle")).toHaveTextContent(
      /Փոքր բիզնես/,
    );
  });

  it("renders the 7-step stepper", () => {
    renderRoute();
    const stepper = screen.getByTestId("smb-crm-onboarding-stepper");
    const markers = stepper.querySelectorAll("[data-step-marker]");
    expect(markers.length).toBe(7);
  });

  it("renders the submit button on the review step", () => {
    mocks.search = { step: "review" };
    renderRoute();
    const submit = screen.getByTestId("smb-crm-onboarding-submit");
    expect(submit).toBeInTheDocument();
    expect(submit).toHaveTextContent(/blueprint|Ստեղծել/i);
  });

  it("renders a role='alert' message when the templates query fails", () => {
    mocks.error = true;
    renderRoute();
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/Could not load industry templates/i);
  });
});
