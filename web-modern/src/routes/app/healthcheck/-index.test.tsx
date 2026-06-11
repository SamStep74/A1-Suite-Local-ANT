/**
 * /app/healthcheck — route-level tests for the Pattern A skeleton.
 *
 * Mirrors the cfo/reports test pattern: mock the three layers
 * (Router, Query, API client), then drive the public component
 * surface. Because this route has no URL search state, no
 * multi-view switching, and no period navigation, the test stays
 * deliberately short.
 *
 * Coverage targets:
 *  - Page header (English title "Healthcheck" + Armenian subtitle)
 *  - Input default value "skeleton" + Ping button
 *  - Ping click calls postJson with the right path and body
 *  - Success path: result section shows echoed message + timestamp
 *  - Error path: role="alert" message is rendered
 *  - Pending state: button shows "Pinging…" and is disabled
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
  // postJson is hoisted so the api/client mock factory can return it.
  postJson: vi.fn(),
  // useMutation is replaced wholesale — we drive the component by
  // calling the captured mutate() and toggling isPending.
  mutateImpl: vi.fn(),
  isPending: false,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (cfg: { component: unknown }) => ({
    useSearch: () => ({}),
    useParams: () => ({}),
    useNavigate: () => vi.fn(),
    options: cfg,
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
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    useMutation: (opts: {
      mutationFn: (...args: unknown[]) => Promise<unknown>;
      onSuccess?: (data: unknown) => void;
      onError?: (err: Error) => void;
    }) => {
      // Capture the mutationFn so tests can invoke it directly and
      // observe resolve/reject behavior. The returned `mutate` calls
      // mutationFn, then forwards the result to the matching callback.
      mocks.mutateImpl.mockImplementation(() => {
        opts
          .mutationFn()
          .then((data) => opts.onSuccess?.(data))
          .catch((err: Error) => opts.onError?.(err));
      });
      return {
        mutate: () => mocks.mutateImpl(),
        isPending: mocks.isPending,
      };
    },
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  };
});

vi.mock("../../../lib/api/client", () => ({
  postJson: mocks.postJson,
  getJson: vi.fn().mockResolvedValue({}),
  postVoid: vi.fn().mockResolvedValue(undefined),
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

const SUCCESS_RESPONSE = {
  healthcheck: {
    message: "skeleton",
    respondedAt: "2026-06-11T12:00:00.000Z",
  },
};

/* ────────── per-test reset ────────── */

beforeEach(() => {
  mocks.postJson.mockReset();
  mocks.mutateImpl.mockReset();
  mocks.isPending = false;
  // Default: postJson resolves to a valid healthcheck envelope.
  mocks.postJson.mockResolvedValue(SUCCESS_RESPONSE);
});

afterEach(() => {
  cleanup();
});

/* ────────── page shell ────────── */

describe("Healthcheck — page shell", () => {
  it("renders the H1 'Healthcheck' and the Armenian subtitle", () => {
    renderRoute();
    expect(
      screen.getByRole("heading", { level: 1, name: /Healthcheck/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Առողջության ստուգում/),
    ).toBeInTheDocument();
  });

  it("renders the input with the default value 'skeleton' and the Ping button", () => {
    renderRoute();
    const input = screen.getByLabelText(/Healthcheck message/i) as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.value).toBe("skeleton");
    expect(
      screen.getByRole("button", { name: /^Ping$/ }),
    ).toBeInTheDocument();
  });

  it("renders a back-to-Today link that points to /app", () => {
    renderRoute();
    const back = screen.getByRole("link", { name: /back to Today/i });
    expect(back.getAttribute("data-href")).toBe("/app");
  });

  it("wraps the interactive panel in an article with data-testid='healthcheck-panel'", () => {
    renderRoute();
    const panel = screen.getByTestId("healthcheck-panel");
    expect(panel.tagName.toLowerCase()).toBe("article");
  });
});

/* ────────── ping mutation ────────── */

describe("Healthcheck — ping mutation", () => {
  it("calls postJson with the right path and body when Ping is clicked", async () => {
    renderRoute();
    const input = screen.getByLabelText(/Healthcheck message/i);
    fireEvent.change(input, { target: { value: "hello" } });

    fireEvent.click(screen.getByRole("button", { name: /^Ping$/ }));

    expect(mocks.postJson).toHaveBeenCalledTimes(1);
    const [path, body] = mocks.postJson.mock.calls[0];
    expect(path).toBe("/api/healthcheck/ping");
    expect(body).toMatchObject({ message: "hello" });
    // The route stamps a unique idempotencyKey on each call.
    expect((body as { idempotencyKey: string }).idempotencyKey).toMatch(/^ui-/);
  });

  it("shows the echoed message and timestamp on success", async () => {
    mocks.postJson.mockResolvedValueOnce({
      healthcheck: {
        message: "skeleton",
        respondedAt: "2026-06-11T12:00:00.000Z",
      },
    });
    renderRoute();
    fireEvent.click(screen.getByRole("button", { name: /^Ping$/ }));

    await waitFor(() => {
      expect(screen.getByText("skeleton")).toBeInTheDocument();
    });
    expect(screen.getByText(/2026-06-11T12:00:00\.000Z/)).toBeInTheDocument();
  });

  it("renders a role='alert' error message when postJson rejects", async () => {
    mocks.postJson.mockRejectedValueOnce(new Error("boom"));
    renderRoute();
    fireEvent.click(screen.getByRole("button", { name: /^Ping$/ }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/boom/);
  });

  it("shows 'Pinging…' and disables the button while the mutation is pending", () => {
    mocks.isPending = true;
    renderRoute();
    const btn = screen.getByRole("button", { name: /Pinging/i });
    expect(btn).toBeInTheDocument();
    expect(btn).toBeDisabled();
  });
});
