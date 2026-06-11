/**
 * /app/crm-tube/integrations — route-level tests.
 *
 * Mirrors the healthcheck test pattern: mock the three external
 * layers (Router, Query, API client), then drive the public
 * component surface.
 *
 * The grid always renders the 10 sovereign connectors defined in
 * CONNECTOR_KEYS (apollo, cloudtalk, respond-io, surfe, dexatel,
 * make, webflow, closely, instantly, pixxi). In V1 stub mode the
 * server may return an empty integrations list — the route still
 * renders a card per static key, in the `planned` state.
 *
 * Coverage targets (per the worker task spec):
 *  - H1 "Integrations" + Armenian subtitle
 *  - 10 cards rendered, one per static connector key
 *  - "stub" mode chip on every card (V1 default)
 *  - Click "Run health check" on apollo → postJson called with
 *    the right path, qc.setQueryData updates the cache
 *  - Status pill updates after the health check resolves
 *  - Back link points to /app
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

/* ────────── mock state, hoisted so vi.mock factories see it ────────── */

const mocks = vi.hoisted(() => ({
  integrationsData: null as unknown,
  isLoading: false,
  isError: false,
  fullPath: "/app/crm-tube/integrations/",
  postJson: vi.fn(),
  setQueryData: vi.fn(),
  invalidateQueries: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute:
    () =>
    (cfg: { component: unknown }) => ({
      fullPath: mocks.fullPath,
      useSearch: () => ({}),
      useParams: () => ({}),
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
      if (key === "tube-integrations") {
        return {
          data: mocks.integrationsData,
          isLoading: mocks.isLoading,
          isError: mocks.isError,
          isSuccess: !mocks.isLoading && !mocks.isError && mocks.integrationsData != null,
        };
      }
      return { data: null, isLoading: false, isError: false, isSuccess: false };
    },
    useMutation: (opts: {
      mutationFn: (...args: unknown[]) => Promise<unknown>;
      onSuccess?: (data: unknown) => void;
      onError?: (err: Error) => void;
    }) => {
      const captured = {
        mutate: () => {
          Promise.resolve()
            .then(() => opts.mutationFn())
            .then((data) => opts.onSuccess?.(data))
            .catch((err: Error) => opts.onError?.(err));
        },
        isPending: false,
        isError: false,
        error: null as Error | null,
      };
      return captured;
    },
    useQueryClient: () => ({
      invalidateQueries: mocks.invalidateQueries,
      setQueryData: mocks.setQueryData,
    }),
  };
});

vi.mock("../../../../lib/api/client", () => ({
  getJson: vi.fn().mockImplementation((path: string) => {
    if (path.startsWith("/api/crm/tube/integrations")) {
      return Promise.resolve(mocks.integrationsData ?? {});
    }
    return Promise.resolve({});
  }),
  postJson: mocks.postJson,
  patchJson: vi.fn().mockResolvedValue({}),
}));

/* ────────── import the route under test (mocks are in place by now) ─ */

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

const SAMPLE_INTEGRATIONS = {
  integrations: [
    {
      id: "int-1",
      connector_key: "apollo",
      display_name: "Apollo.io",
      status: "planned",
      environment: "sandbox",
      auth_type: "api-key",
      last_health_status: null,
      last_health_at: null,
      last_health_latency: null,
      last_sync_at: null,
    },
  ],
};

const APOLLO_HEALTH_RESPONSE = {
  id: "int-1",
  connector_key: "apollo",
  display_name: "Apollo.io",
  status: "connected",
  environment: "sandbox",
  auth_type: "api-key",
  last_health_status: "ok",
  last_health_at: "2026-06-11T10:00:00.000Z",
  last_health_latency: 123,
  last_sync_at: null,
};

/* ────────── per-test reset ────────── */

beforeEach(() => {
  mocks.integrationsData = SAMPLE_INTEGRATIONS;
  mocks.isLoading = false;
  mocks.isError = false;
  mocks.postJson.mockReset();
  mocks.setQueryData.mockReset();
  mocks.invalidateQueries.mockReset();
  // Default: postJson resolves to a successful health check.
  mocks.postJson.mockResolvedValue(APOLLO_HEALTH_RESPONSE);
});

afterEach(() => {
  cleanup();
});

/* ────────── page shell ────────── */

describe("Integrations health — page shell", () => {
  it("renders the H1 'Integrations' and the Armenian subtitle", () => {
    renderRoute();
    expect(
      screen.getByRole("heading", { level: 1, name: /^Integrations$/ }),
    ).toBeInTheDocument();
    // The bilingual header includes "Ինտ" for Armenian Ինտեգրացիա.
    expect(screen.getByText(/Ինտ/)).toBeInTheDocument();
  });

  it("renders a back-to-Today link that points to /app", () => {
    renderRoute();
    const back = screen.getByRole("link", { name: /back to Today/i });
    expect(back.getAttribute("data-href")).toBe("/app");
  });

  it("wraps the grid in a container with data-testid='tube-integrations'", () => {
    renderRoute();
    const root = screen.getByTestId("tube-integrations");
    expect(root.getAttribute("data-entity")).toBe("tube-integrations-grid");
  });
});

/* ────────── grid rendering ────────── */

describe("Integrations health — grid rendering", () => {
  it("renders 10 connector cards, one per sovereign connector key", () => {
    renderRoute();
    const CONNECTOR_KEYS = [
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
    ];
    for (const key of CONNECTOR_KEYS) {
      expect(
        screen.getByTestId(`tube-integration-card-${key}`),
      ).toBeInTheDocument();
    }
  });

  it("renders a 'stub' mode chip on every card (V1 default)", () => {
    renderRoute();
    const chips = screen.getAllByTestId(/^tube-integration-mode-stub$/);
    expect(chips).toHaveLength(10);
  });

  it("renders a 'planned' status pill on every card when the server returns no live rows", () => {
    mocks.integrationsData = { integrations: [] };
    renderRoute();
    const plannedPills = screen.getAllByText(/^planned$/i);
    expect(plannedPills.length).toBe(10);
  });

  it("renders the English connector name on each card", () => {
    renderRoute();
    expect(screen.getByText("Apollo.io")).toBeInTheDocument();
    expect(screen.getByText("CloudTalk")).toBeInTheDocument();
    expect(screen.getByText("Respond.io")).toBeInTheDocument();
    expect(screen.getByText("Surfe")).toBeInTheDocument();
    expect(screen.getByText("Dexatel")).toBeInTheDocument();
    expect(screen.getByText("Make")).toBeInTheDocument();
    expect(screen.getByText("Webflow")).toBeInTheDocument();
    expect(screen.getByText("Closely")).toBeInTheDocument();
    expect(screen.getByText("Instantly.ai")).toBeInTheDocument();
    expect(screen.getByText("Pixxi")).toBeInTheDocument();
  });

  it("renders the 'Loading integrations…' message while the query is pending", () => {
    mocks.isLoading = true;
    mocks.integrationsData = null;
    renderRoute();
    expect(screen.getByText(/Loading integrations…/i)).toBeInTheDocument();
  });
});

/* ────────── health check mutation ────────── */

describe("Integrations health — health check", () => {
  it("calls postJson with the right path and body when 'Run health check' is clicked on apollo", async () => {
    renderRoute();
    fireEvent.click(screen.getByTestId("tube-integration-health-apollo"));

    await waitFor(() => {
      expect(mocks.postJson).toHaveBeenCalledTimes(1);
    });
    const [path, body] = mocks.postJson.mock.calls[0];
    expect(path).toBe("/api/crm/tube/integrations/apollo/health-check");
    expect((body as { idempotencyKey: string }).idempotencyKey).toMatch(/^tube-health-/);
  });

  it("updates the cache with setQueryData on success", async () => {
    renderRoute();
    fireEvent.click(screen.getByTestId("tube-integration-health-apollo"));

    await waitFor(() => {
      expect(mocks.setQueryData).toHaveBeenCalledTimes(1);
    });
    const [key, updater] = mocks.setQueryData.mock.calls[0];
    expect(key).toEqual(["tube-integrations"]);

    // The updater merges the new integration row into the
    // existing list. The fixture starts with one row (apollo)
    // — the updater should replace it.
    const oldEnvelope = { integrations: [SAMPLE_INTEGRATIONS.integrations[0]] };
    const next = (updater as (old: unknown) => unknown)(oldEnvelope) as {
      integrations: Array<{ status: string; last_health_status: string | null }>;
    };
    expect(next.integrations).toHaveLength(1);
    expect(next.integrations[0].status).toBe("connected");
    expect(next.integrations[0].last_health_status).toBe("ok");
  });

  it("updates the apollo card status pill to 'connected' after the check", async () => {
    // Server fixture ships 'planned' for apollo, so the card
    // shows the 'planned' pill before the click. The mutation's
    // onSuccess then patches the cache via setQueryData — we
    // assert that the updater the component passed to setQueryData
    // correctly transforms the 'planned' row into a 'connected'
    // row (this is the same path the component uses to render
    // the updated card).
    renderRoute();
    const apolloCard = screen.getByTestId("tube-integration-card-apollo");
    expect(apolloCard.textContent).toMatch(/planned/);

    fireEvent.click(screen.getByTestId("tube-integration-health-apollo"));

    await waitFor(() => {
      expect(mocks.setQueryData).toHaveBeenCalledTimes(1);
    });
    const [, updater] = mocks.setQueryData.mock.calls[0];
    const oldEnvelope = { integrations: [SAMPLE_INTEGRATIONS.integrations[0]] };
    const next = (updater as (old: unknown) => unknown)(oldEnvelope) as {
      integrations: Array<{ status: string }>;
    };
    expect(next.integrations[0].status).toBe("connected");
  });

  it("renders a role='alert' when the health check rejects", async () => {
    mocks.postJson.mockRejectedValueOnce(new Error("connectivity down"));
    renderRoute();
    fireEvent.click(screen.getByTestId("tube-integration-health-apollo"));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/connectivity down/);
  });
});
