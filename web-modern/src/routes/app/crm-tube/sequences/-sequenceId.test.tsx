/**
 * /app/crm-tube/sequences/$sequenceId — route-level tests.
 *
 * Mirrors the healthcheck test pattern: mock the three external
 * layers (Router, Query, API client), then drive the public
 * component surface. We swap `useQuery`'s response per-test via
 * the hoisted `mocks` object.
 *
 * Note: The detail route reads `useParams()` to get `sequenceId`.
 * The mocked Router returns `{}` from useParams() (sequenceId is
 * not actually needed for any of the assertions — the GET path is
 * constructed unconditionally in queryFn, but the mock query
 * returns our canned data, so the call short-circuits).
 *
 * Coverage targets (per the worker task spec):
 *  - H1 sequence name + status pill ("active" / "paused")
 *  - Steps list renders step cards (one per step)
 *  - Pause/Resume button toggles the active state
 *  - Enroll: pick a contact, click Enroll → postJson called with
 *    the right path and body
 *  - Back link points to /app/crm-tube/sequences
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
  sequenceData: null as unknown,
  contactsData: null as unknown,
  integrationsData: null as unknown,
  isLoading: false,
  isError: false,
  fullPath: "/app/crm-tube/sequences/$sequenceId",
  params: { sequenceId: "seq-1" } as Record<string, string>,
  postJson: vi.fn(),
  patchJson: vi.fn(),
  invalidateQueries: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (cfg: { component: unknown }) => ({
    fullPath: mocks.fullPath,
    useSearch: () => ({}),
    useParams: () => mocks.params,
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
      if (key === "tube-sequence") {
        return {
          data: mocks.sequenceData,
          isLoading: mocks.isLoading,
          isError: mocks.isError,
          isSuccess: !mocks.isLoading && !mocks.isError && mocks.sequenceData != null,
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
      if (key === "tube-contacts-picker") {
        return {
          data: mocks.contactsData,
          isLoading: false,
          isError: false,
          isSuccess: mocks.contactsData != null,
        };
      }
      return { data: null, isLoading: false, isError: false, isSuccess: false };
    },
    useMutation: (opts: {
      mutationFn: (...args: unknown[]) => Promise<unknown>;
      onSuccess?: (data: unknown) => void;
      onError?: (err: Error) => void;
    }) => ({
      mutate: (...args: unknown[]) => {
        Promise.resolve()
          .then(() => opts.mutationFn(...args))
          .then((data) => opts.onSuccess?.(data))
          .catch((err: Error) => opts.onError?.(err));
      },
      isPending: false,
      isError: false,
      error: null as Error | null,
    }),
    useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
  };
});

vi.mock("../../../../lib/api/client", () => ({
  getJson: vi.fn().mockImplementation((path: string) => {
    if (path.includes("/sequences/") && !path.includes("/contacts")) {
      return Promise.resolve(mocks.sequenceData ?? {});
    }
    if (path.startsWith("/api/crm/tube/integrations")) {
      return Promise.resolve(mocks.integrationsData ?? {});
    }
    if (path.startsWith("/api/crm/tube/contacts")) {
      return Promise.resolve(mocks.contactsData ?? {});
    }
    return Promise.resolve({});
  }),
  postJson: mocks.postJson,
  patchJson: mocks.patchJson,
}));

/* ────────── import the route under test (mocks are in place by now) ─ */

import { Route } from "./$sequenceId";

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

const SAMPLE_SEQUENCE = {
  id: "seq-1",
  name: "Apollo Cold Outreach",
  description: "First touch sequence for enriched contacts",
  is_active: true,
  integration_key: "apollo",
  external_id: null,
  step_count: 2,
  created_at: "2026-06-01T10:00:00.000Z",
  updated_at: "2026-06-09T10:00:00.000Z",
  steps: [
    { action: "send_email", name: "Initial outreach" },
    { action: "wait", duration: "2d" },
  ],
};

const SAMPLE_SEQUENCE_PAUSED = {
  ...SAMPLE_SEQUENCE,
  id: "seq-2",
  name: "Paused Sequence",
  is_active: false,
  steps: [],
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
  ],
};

const SAMPLE_CONTACTS = {
  contacts: [
    {
      id: "c-1",
      full_name: "Jane Doe",
      email: "jane@example.com",
      company: "Acme",
      title: null,
    },
  ],
};

/* ────────── per-test reset ────────── */

beforeEach(() => {
  mocks.params = { sequenceId: "seq-1" };
  mocks.sequenceData = SAMPLE_SEQUENCE;
  mocks.integrationsData = SAMPLE_INTEGRATIONS;
  mocks.contactsData = null; // Only fetch on user input
  mocks.isLoading = false;
  mocks.isError = false;
  mocks.postJson.mockReset();
  mocks.patchJson.mockReset();
  // Default: postJson resolves to a successful enroll response.
  mocks.postJson.mockResolvedValue({ enrolled: 1 });
  // Default: patchJson resolves to a successful toggle response.
  mocks.patchJson.mockResolvedValue({});
  mocks.invalidateQueries.mockReset();
});

afterEach(() => {
  cleanup();
});

/* ────────── page shell ────────── */

describe("Sequence detail — page shell", () => {
  it("renders the H1 with the sequence name and an 'active' status pill", () => {
    renderRoute();
    expect(
      screen.getByRole("heading", { level: 1, name: "Apollo Cold Outreach" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/^active$/i)).toBeInTheDocument();
  });

  it("renders a 'paused' status pill when the sequence is inactive", () => {
    mocks.sequenceData = SAMPLE_SEQUENCE_PAUSED;
    renderRoute();
    expect(
      screen.getByRole("heading", { level: 1, name: "Paused Sequence" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/^paused$/i)).toBeInTheDocument();
  });

  it("renders a back link to /app/crm-tube/sequences", () => {
    renderRoute();
    const back = screen.getByRole("link", { name: /Sequences/i });
    expect(back.getAttribute("data-href")).toBe("/app/crm-tube/sequences");
  });

  it("wraps the steps in a section with data-testid='tube-sequence-steps'", () => {
    renderRoute();
    const steps = screen.getByTestId("tube-sequence-steps");
    expect(steps.tagName.toLowerCase()).toBe("section");
  });
});

/* ────────── steps list ────────── */

describe("Sequence detail — steps list", () => {
  it("renders one step card per step", () => {
    renderRoute();
    // Each step renders a 'Step N · …' line.
    expect(screen.getByText(/Step 1 · send_email/i)).toBeInTheDocument();
    expect(screen.getByText(/Step 2 · wait/i)).toBeInTheDocument();
  });

  it("renders the 'No steps yet' empty state when the sequence has zero steps", () => {
    mocks.sequenceData = SAMPLE_SEQUENCE_PAUSED;
    renderRoute();
    expect(
      screen.getByText(/No steps yet/i),
    ).toBeInTheDocument();
  });

  it("renders a disabled 'Edit step' button on each step (lands in 8.14)", () => {
    renderRoute();
    const editButtons = screen.getAllByRole("button", { name: /Edit step/i });
    expect(editButtons.length).toBe(2);
    editButtons.forEach((b) => expect(b).toBeDisabled());
  });
});

/* ────────── pause/resume ────────── */

describe("Sequence detail — pause/resume", () => {
  it("shows the 'Pause' button when the sequence is active", () => {
    renderRoute();
    const btn = screen.getByTestId("tube-sequence-toggle");
    expect(btn.textContent).toMatch(/Pause/);
  });

  it("shows the 'Resume' button when the sequence is paused", () => {
    mocks.sequenceData = SAMPLE_SEQUENCE_PAUSED;
    renderRoute();
    const btn = screen.getByTestId("tube-sequence-toggle");
    expect(btn.textContent).toMatch(/Resume/);
  });

  it("calls patchJson with the right path and body when Pause is clicked", async () => {
    renderRoute();
    fireEvent.click(screen.getByTestId("tube-sequence-toggle"));
    await waitFor(() => {
      expect(mocks.patchJson).toHaveBeenCalledTimes(1);
    });
    const [path, body] = mocks.patchJson.mock.calls[0];
    expect(path).toBe("/api/crm/tube/sequences/seq-1");
    expect(body).toMatchObject({
      isActive: false,
    });
    expect((body as { idempotencyKey: string }).idempotencyKey).toMatch(/^tube-seq-pause-/);
  });
});

/* ────────── enroll ────────── */

describe("Sequence detail — enroll", () => {
  it("renders the enroll panel", () => {
    renderRoute();
    expect(screen.getByTestId("tube-sequence-enroll")).toBeInTheDocument();
  });

  it("calls postJson with the right path and body when Enroll is clicked", async () => {
    mocks.contactsData = SAMPLE_CONTACTS;
    renderRoute();

    // Type to surface the picker.
    const input = screen.getByTestId("tube-sequence-enroll-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Jane" } });

    // Pick the contact from the listbox.
    screen.getByRole("listbox");
    const option = screen.getByRole("option", { name: /Jane Doe/ });
    fireEvent.click(option);

    // Click Enroll.
    const submit = screen.getByTestId("tube-sequence-enroll-submit");
    fireEvent.click(submit);

    await waitFor(() => {
      expect(mocks.postJson).toHaveBeenCalledTimes(1);
    });
    const [path, body] = mocks.postJson.mock.calls[0];
    expect(path).toBe("/api/crm/tube/sequences/enroll");
    expect(body).toMatchObject({
      sequenceId: "seq-1",
      contactIds: ["c-1"],
    });
    expect((body as { idempotencyKey: string }).idempotencyKey).toMatch(/^tube-enroll-/);
  });

  it("disables the Enroll button when no contact is selected", () => {
    mocks.contactsData = SAMPLE_CONTACTS;
    renderRoute();
    const submit = screen.getByTestId("tube-sequence-enroll-submit");
    expect(submit).toBeDisabled();
  });

  it("renders a role='alert' when the enroll mutation rejects", async () => {
    mocks.postJson.mockRejectedValueOnce(new Error("enroll failed"));
    mocks.contactsData = SAMPLE_CONTACTS;
    renderRoute();
    const input = screen.getByTestId("tube-sequence-enroll-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Jane" } });
    fireEvent.click(screen.getByRole("option", { name: /Jane Doe/ }));
    fireEvent.click(screen.getByTestId("tube-sequence-enroll-submit"));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/enroll failed/);
  });
});
