/**
 * /app/smb-crm/integrations — integration health route tests.
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
  fullPath: "/app/smb-crm/integrations/",
  mutationMutate: vi.fn(),
  mutationPending: false,
  mutationOk: false,
  mutationError: false,
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
    useQuery: () => ({ data: null, isLoading: false, isError: false }),
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
    useMutation: () => ({
      mutate: mocks.mutationMutate,
      isPending: mocks.mutationPending,
      data: mocks.mutationOk ? { ok: true } : undefined,
      error: mocks.mutationError ? new Error("fail") : null,
    }),
  };
});

vi.mock("../../../lib/api/client", () => ({
  postJson: vi.fn().mockResolvedValue({ ok: true }),
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
  mocks.mutationMutate = vi.fn();
  mocks.mutationPending = false;
  mocks.mutationOk = false;
  mocks.mutationError = false;
});

afterEach(() => {
  cleanup();
});

describe("SMB CRM integrations — health", () => {
  it("renders the H1 'Integrations'", () => {
    renderRoute();
    expect(
      screen.getByRole("heading", { level: 1, name: /Integrations/i }),
    ).toBeInTheDocument();
  });

  it("renders 10 connector cards (apollo, cloudtalk, … pixxi)", () => {
    renderRoute();
    const cards = screen.getAllByTestId("smb-crm-integration-card");
    expect(cards.length).toBe(10);
    const keys = cards.map((c) => c.getAttribute("data-connector-key"));
    expect(keys).toEqual([
      "apollo",
      "cloudtalk",
      "respond-io",
      "surfe",
      "dexatel",
      "make",
      "webflow",
      "closely",
      "instantly",
      "pixxi",
    ]);
  });

  it("renders a Check button per connector that calls the health mutation", () => {
    renderRoute();
    const checks = screen.getAllByTestId("smb-crm-integration-health");
    expect(checks.length).toBe(10);
    checks[0]!.click();
    expect(mocks.mutationMutate).toHaveBeenCalledWith("apollo");
  });
});
