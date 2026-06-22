/**
 * /app/desk/dispatch — mobile technician dispatch shell tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

const mocks = vi.hoisted(() => ({
  getJson: vi.fn(),
  postJson: vi.fn(),
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
    search,
    params,
    ...rest
  }: {
    children?: React.ReactNode;
    to?: string;
    search?: Record<string, unknown>;
    params?: Record<string, unknown>;
  } & Record<string, unknown>) => (
    <a
      data-href={to}
      data-search={JSON.stringify(search ?? {})}
      data-params={JSON.stringify(params ?? {})}
      href={to}
      {...rest}
    >
      {children}
    </a>
  ),
}));

vi.mock("../../../lib/api/client", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getJson: mocks.getJson,
    postJson: mocks.postJson,
  };
});

import { Route } from "./dispatch";

const QUEUE_KEY = "a1:desk:my-visits:technician-status-queue";

const VISIT = {
  id: "visit-1",
  caseId: "case-1",
  customerId: "cust-1",
  assignedUserId: "user-1",
  scheduledStartAt: "2026-06-22T09:00:00.000Z",
  scheduledEndAt: "2026-06-22T10:00:00.000Z",
  status: "scheduled",
  location: "Ani Beauty, Yerevan",
  worksheetSummary: "Inspect fiscal printer.",
  createdAt: "2026-06-20T00:00:00.000Z",
  updatedAt: "2026-06-21T00:00:00.000Z",
  caseNumber: "AO-CASE-1001",
  subject: "Fiscal printer field check",
  customerName: "Ani Beauty",
  assignedUserName: "Samvel",
  dispatchNavigation: {
    routeLine: "Warehouse -> Ani Beauty",
    mapUrl: "https://maps.example.test/visit-1",
    directionsUrl: "https://nav.example.test/visit-1",
  },
};

function setupApi(visits = [VISIT]) {
  mocks.getJson.mockImplementation((path: string) => {
    if (path === "/api/service/my-field-visits") return Promise.resolve({ visits });
    return Promise.resolve({});
  });
}

function renderRoute() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const Component = Route.options.component as React.ComponentType;
  return render(
    <QueryClientProvider client={qc}>
      <Component />
    </QueryClientProvider>,
  );
}

function readQueue() {
  return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]") as Array<Record<string, unknown>>;
}

beforeEach(() => {
  localStorage.clear();
  mocks.getJson.mockReset();
  mocks.postJson.mockReset();
  setupApi();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

describe("/app/desk/dispatch", () => {
  it("renders assigned visits with route, map, and navigation links", async () => {
    renderRoute();

    await screen.findByText("AO-CASE-1001");
    expect(screen.getByText("Assigned")).toBeTruthy();
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByText("Warehouse -> Ani Beauty")).toBeTruthy();
    expect(screen.getAllByText("Inspect fiscal printer.").length).toBeGreaterThan(0);

    const mapLink = screen.getByRole("link", { name: /map/i });
    const navigationLink = screen.getByRole("link", { name: /navigation/i });
    expect(mapLink.getAttribute("href")).toBe("https://maps.example.test/visit-1");
    expect(navigationLink.getAttribute("href")).toBe("https://nav.example.test/visit-1");
  });

  it("sends an idempotencyKey with technician status updates", async () => {
    mocks.postJson.mockResolvedValue({ ok: true, visit: { ...VISIT, status: "en-route" } });

    renderRoute();

    await screen.findByText("AO-CASE-1001");
    fireEvent.click(screen.getByRole("button", { name: /en route/i }));

    await waitFor(() => expect(mocks.postJson).toHaveBeenCalledTimes(1));
    const [, body] = mocks.postJson.mock.calls[0] ?? [];
    expect(body).toMatchObject({
      status: "en-route",
      worksheetSummary: "Inspect fiscal printer.",
    });
    expect((body as Record<string, unknown>).idempotencyKey).toEqual(expect.any(String));
    expect((body as Record<string, unknown>).idempotencyKey).toContain("visit-1:en-route");
  });

  it("queues a failed network action and shows pending evidence", async () => {
    mocks.postJson.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    renderRoute();

    await screen.findByText("AO-CASE-1001");
    fireEvent.click(screen.getByRole("button", { name: /en route/i }));

    await waitFor(() => expect(readQueue()).toHaveLength(1));
    expect(readQueue()[0]).toMatchObject({
      visitId: "visit-1",
      status: "en-route",
      worksheetSummary: "Inspect fiscal printer.",
    });
    expect(readQueue()[0]?.idempotencyKey).toEqual(expect.any(String));
    expect(screen.getByText("Pending sync")).toBeTruthy();
    expect(screen.getByText("Queued")).toBeTruthy();
  });

  it("replays queued actions with Sync now and removes successful items", async () => {
    localStorage.setItem(
      QUEUE_KEY,
      JSON.stringify([
        {
          visitId: "visit-1",
          status: "en-route",
          worksheetSummary: "Queued summary.",
          idempotencyKey: "offline-key-1",
          queuedAt: "2026-06-22T08:00:00.000Z",
        },
      ]),
    );
    mocks.postJson.mockResolvedValue({ ok: true, idempotent: true, visit: { ...VISIT, status: "en-route" } });

    renderRoute();

    await screen.findByText("Pending sync");
    fireEvent.click(screen.getByRole("button", { name: /sync now/i }));

    await waitFor(() => {
      expect(mocks.postJson).toHaveBeenCalledWith(
        "/api/service/field-visits/visit-1/technician-status",
        expect.objectContaining({
          status: "en-route",
          worksheetSummary: "Queued summary.",
          idempotencyKey: "offline-key-1",
        }),
        expect.anything(),
      );
    });
    await waitFor(() => expect(localStorage.getItem(QUEUE_KEY)).toBe("[]"));
    await waitFor(() => expect(screen.queryByText("Pending sync")).toBeNull());
  });

  it("tolerates corrupt queue storage", async () => {
    localStorage.setItem(QUEUE_KEY, "{not-json");

    renderRoute();

    await screen.findByText("AO-CASE-1001");
    expect(localStorage.getItem(QUEUE_KEY)).toBe("[]");
    expect(screen.queryByText("Pending sync")).toBeNull();
  });
});
