/**
 * /app/crm-tube/sequences (index) — route-level tests.
 *
 * Mirrors the healthcheck test pattern: mock the three external
 * layers (Router, Query, API client), then drive the public
 * component surface. We swap `useQuery`'s response per-test via
 * the hoisted `mocks` object.
 *
 * Note on Link capture: the mock `Link` component renders
 * `<a data-href={to}>`. For param routes (`to="$sequenceId"`),
 * `data-href` is the literal template — there is no resolved
 * path. We assert on the rendered cell text instead.
 *
 * Coverage targets (per the worker task spec):
 *  - H1 "Sequences" + Armenian subtitle contains Հ
 *  - Empty state: { sequences: [] } → renders "No sequences yet"
 *  - Populated: 3 sequences → 3 rows + "showing 3 of 3"
 *  - "Active only" toggle off → renders the paused sequence
 *  - "Active only" toggle on (default) → hides the paused sequence
 *  - New sequence form: fill name + submit → postJson called with
 *    the right path and body
 *  - New sequence error: postJson rejects → role="alert"
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
  sequencesData: null as unknown,
  integrationsData: null as unknown,
  isLoading: false,
  isError: false,
  fullPath: "/app/crm-tube/sequences/",
  postJson: vi.fn(),
  invalidateQueries: vi.fn(),
  setQueryData: vi.fn(),
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
    params,
    ...rest
  }: {
    children?: React.ReactNode;
    to?: string;
    params?: Record<string, unknown>;
  } & Record<string, unknown>) => (
    <a data-href={to} data-params={params ? JSON.stringify(params) : ""} href={to} {...rest}>
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
      if (key === "tube-sequences") {
        return {
          data: mocks.sequencesData,
          isLoading: mocks.isLoading,
          isError: mocks.isError,
          isSuccess: !mocks.isLoading && !mocks.isError && mocks.sequencesData != null,
        };
      }
      if (key === "tube-integrations") {
        return {
          data: mocks.integrationsData,
          isLoading: false,
          isError: false,
          isSuccess: mocks.integrationsData != null,
        };
      }
      return { data: null, isLoading: false, isError: false, isSuccess: false };
    },
    useMutation: (opts: {
      mutationFn: (...args: unknown[]) => Promise<unknown>;
      onSuccess?: (data: unknown) => void;
      onError?: (err: Error) => void;
    }) => ({
      mutate: () => {
        Promise.resolve()
          .then(() => opts.mutationFn())
          .then((data) => opts.onSuccess?.(data))
          .catch((err: Error) => opts.onError?.(err));
      },
      isPending: false,
      isError: false,
      error: null as Error | null,
    }),
    useQueryClient: () => ({
      invalidateQueries: mocks.invalidateQueries,
      setQueryData: mocks.setQueryData,
    }),
  };
});

vi.mock("../../../../lib/api/client", () => ({
  getJson: vi.fn().mockImplementation((path: string) => {
    if (path.startsWith("/api/crm/tube/sequences")) {
      return Promise.resolve(mocks.sequencesData ?? {});
    }
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

const SAMPLE_SEQUENCES = {
  sequences: [
    {
      id: "seq-1",
      name: "Apollo Cold Outreach",
      description: "First touch sequence for enriched contacts",
      is_active: true,
      integration_key: "apollo",
      external_id: null,
      step_count: 4,
      created_at: "2026-06-01T10:00:00.000Z",
      updated_at: "2026-06-09T10:00:00.000Z",
    },
    {
      id: "seq-2",
      name: "CloudTalk Followup",
      description: "Post-call nurture",
      is_active: true,
      integration_key: "cloudtalk",
      external_id: null,
      step_count: 2,
      created_at: "2026-06-02T10:00:00.000Z",
      updated_at: "2026-06-10T10:00:00.000Z",
    },
    {
      id: "seq-3",
      name: "Paused Test Sequence",
      description: null,
      is_active: false,
      integration_key: "instantly",
      external_id: null,
      step_count: 1,
      created_at: "2026-06-03T10:00:00.000Z",
      updated_at: "2026-06-08T10:00:00.000Z",
    },
  ],
};

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
    {
      id: "int-2",
      connector_key: "cloudtalk",
      display_name: "CloudTalk",
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

/* ────────── per-test reset ────────── */

beforeEach(() => {
  mocks.sequencesData = SAMPLE_SEQUENCES;
  mocks.integrationsData = SAMPLE_INTEGRATIONS;
  mocks.isLoading = false;
  mocks.isError = false;
  mocks.postJson.mockReset();
  // Default: postJson resolves successfully so the modal closes.
  mocks.postJson.mockResolvedValue(SAMPLE_SEQUENCES.sequences[0]);
  mocks.invalidateQueries.mockReset();
  mocks.setQueryData.mockReset();
});

afterEach(() => {
  cleanup();
});

/* ────────── page shell ────────── */

describe("Sequences list — page shell", () => {
  it("renders the H1 'Sequences' and an Armenian subtitle containing Հ", () => {
    renderRoute();
    expect(
      screen.getByRole("heading", { level: 1, name: /^Sequences$/ }),
    ).toBeInTheDocument();
    // The bilingual subtitle line in <Header> is "Հ · Sequences".
    expect(screen.getByText(/Հ/)).toBeInTheDocument();
  });

  it("renders a back-to-Today link that points to /app", () => {
    renderRoute();
    const back = screen.getByRole("link", { name: /back to Today/i });
    expect(back.getAttribute("data-href")).toBe("/app");
  });

  it("wraps the list in a container with data-testid='tube-sequences'", () => {
    renderRoute();
    const root = screen.getByTestId("tube-sequences");
    expect(root.getAttribute("data-entity")).toBe("tube-sequences-list");
  });
});

/* ────────── list rendering ────────── */

describe("Sequences list — rendering", () => {
  it("renders the empty state when the API returns no sequences", () => {
    mocks.sequencesData = { sequences: [] };
    renderRoute();
    // The empty state renders its own "New sequence" CTA, plus
    // the header button — at least one must be present.
    expect(
      screen.getByText(/No sequences yet/i),
    ).toBeInTheDocument();
  });

  it("renders 3 rows and 'showing 3 of 3' when 3 sequences are present", () => {
    renderRoute();
    // Filter defaults to "Active only ON" so the paused row is hidden;
    // we toggle it off so all 3 are visible.
    const checkbox = screen.getByLabelText(/Show only active sequences/i) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);

    // The filter bar shows "showing 3 of 3".
    expect(screen.getByText(/showing 3 of 3/i)).toBeInTheDocument();
    // Each row's name renders in the table.
    expect(screen.getByText("Apollo Cold Outreach")).toBeInTheDocument();
    expect(screen.getByText("CloudTalk Followup")).toBeInTheDocument();
    expect(screen.getByText("Paused Test Sequence")).toBeInTheDocument();
  });

  it("renders ALL sequences (including the paused one) when 'Active only' is off", () => {
    renderRoute();
    const checkbox = screen.getByLabelText(/Show only active sequences/i) as HTMLInputElement;
    expect(checkbox.checked).toBe(true); // default on
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);
    // The paused sequence is named "Paused Test Sequence".
    expect(screen.getByText("Paused Test Sequence")).toBeInTheDocument();
  });

  it("hides the paused sequence when 'Active only' is on (default)", () => {
    renderRoute();
    expect(screen.queryByText("Paused Test Sequence")).not.toBeInTheDocument();
    // And the filter bar shows "showing 2 of 3".
    expect(screen.getByText(/showing 2 of 3/i)).toBeInTheDocument();
  });

  it("renders step counts and status pills for each active row", () => {
    renderRoute();
    // Default filter (active only ON) shows seq-1 (4 steps) and seq-2 (2 steps).
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    // Active pills are present (we filter to active only by default).
    const activePills = screen.getAllByText(/^active$/i);
    expect(activePills.length).toBeGreaterThanOrEqual(2);
  });

  it("renders the integration column for each active row", () => {
    renderRoute();
    // The integration_key column displays "apollo" and "cloudtalk" for the
    // two active rows.
    const cells = screen.getAllByRole("cell");
    const cellText = cells.map((c) => c.textContent ?? "").join(" | ");
    expect(cellText).toMatch(/apollo/);
    expect(cellText).toMatch(/cloudtalk/);
  });
});

/* ────────── create form ────────── */

describe("Sequences list — create form", () => {
  it("opens the modal when 'New sequence' is clicked", () => {
    renderRoute();
    const buttons = screen.getAllByRole("button", { name: /New sequence/i });
    expect(buttons.length).toBeGreaterThan(0);
    fireEvent.click(buttons[0]);
    expect(
      screen.getByRole("dialog", { name: /New sequence/i }),
    ).toBeInTheDocument();
  });

  it("calls postJson with the right path and body when the form is submitted", async () => {
    renderRoute();
    const buttons = screen.getAllByRole("button", { name: /New sequence/i });
    fireEvent.click(buttons[0]);

    const nameInput = screen.getByTestId("tube-sequence-name") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "My New Sequence" } });

    fireEvent.click(screen.getByTestId("tube-sequence-submit"));

    await waitFor(() => {
      expect(mocks.postJson).toHaveBeenCalledTimes(1);
    });
    const [path, body] = mocks.postJson.mock.calls[0];
    expect(path).toBe("/api/crm/tube/sequences");
    expect(body).toMatchObject({
      name: "My New Sequence",
      isActive: true,
    });
    expect((body as { idempotencyKey: string }).idempotencyKey).toMatch(/^tube-seq-/);
  });

  it("renders a role='alert' error when postJson rejects", async () => {
    mocks.postJson.mockRejectedValueOnce(new Error("network boom"));
    renderRoute();
    const buttons = screen.getAllByRole("button", { name: /New sequence/i });
    fireEvent.click(buttons[0]);

    const nameInput = screen.getByTestId("tube-sequence-name") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "Bad Sequence" } });
    fireEvent.click(screen.getByTestId("tube-sequence-submit"));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/network boom/);
  });
});
