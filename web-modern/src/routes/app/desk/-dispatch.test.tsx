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
const ACK_KEY = "a1:desk:dispatch-alerts:acknowledged";
const ALERTS_PATH = "/api/service/my-dispatch-alerts";

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

const ALERT = {
  id: "svc-dispatch-alert-due-soon-v99a0d78feb35-visit-1",
  dedupeKey: "service-field-visit:visit-1:due-soon:2026-06-22T08:05:00.000Z",
  kind: "due-soon",
  severity: "high",
  visitId: "visit-1",
  caseNumber: "AO-CASE-1001",
  customerName: "Ani Beauty",
  location: "Ani Beauty, Yerevan",
  status: "scheduled",
  scheduledStartAt: "2026-06-22T10:00:00.000Z",
  scheduledEndAt: "2026-06-22T11:00:00.000Z",
  title: "Visit moved",
  body: "Customer requested a later arrival window.",
  notify: true,
  createdAt: "2026-06-22T08:00:00.000Z",
  referenceAt: "2026-06-22T08:05:00.000Z",
  acknowledgedAt: null,
};

function setupApi(
  visits: Array<Record<string, unknown>> = [VISIT],
  alerts: Array<Record<string, unknown>> = [],
) {
  mocks.getJson.mockImplementation((path: string) => {
    if (path === "/api/service/my-field-visits") return Promise.resolve({ visits });
    if (path === ALERTS_PATH) return Promise.resolve({ alerts });
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

function getJsonCallCount(path: string): number {
  return mocks.getJson.mock.calls.filter(([calledPath]) => calledPath === path).length;
}

function setGeolocationMock(
  getCurrentPosition: Geolocation["getCurrentPosition"] | undefined,
) {
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: getCurrentPosition ? { getCurrentPosition } : undefined,
  });
}

function setNotificationMock(
  permission: NotificationPermission,
  requestResult: NotificationPermission = permission,
) {
  const NotificationCtor = vi.fn((_title: string, _options?: NotificationOptions) => ({}));
  const requestPermission = vi.fn().mockResolvedValue(requestResult);
  const api = NotificationCtor as unknown as typeof Notification & {
    requestPermission: typeof requestPermission;
  };

  Object.defineProperty(api, "permission", { configurable: true, value: permission });
  api.requestPermission = requestPermission;
  Object.defineProperty(window, "Notification", { configurable: true, writable: true, value: api });
  Object.defineProperty(globalThis, "Notification", { configurable: true, writable: true, value: api });
  return { NotificationCtor, requestPermission };
}

function clearNotificationMock() {
  Reflect.deleteProperty(window, "Notification");
  Reflect.deleteProperty(globalThis, "Notification");
}

beforeEach(() => {
  localStorage.clear();
  mocks.getJson.mockReset();
  mocks.postJson.mockReset();
  setupApi();
  setGeolocationMock(undefined);
  clearNotificationMock();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
  setGeolocationMock(undefined);
  clearNotificationMock();
});

describe("/app/desk/dispatch", () => {
  it("renders dispatch alerts near the mobile dispatch header", async () => {
    setupApi([VISIT], [ALERT]);

    renderRoute();

    await screen.findByRole("heading", { name: "Dispatch Alerts" });
    expect(await screen.findByText("Visit moved")).toBeTruthy();
    expect(screen.getByText("Customer requested a later arrival window.")).toBeTruthy();
    expect(screen.getAllByText("AO-CASE-1001").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Ani Beauty").length).toBeGreaterThan(0);
  });

  it("requests permission and sends browser notifications with stable tag and body", async () => {
    setupApi([VISIT], [
      ALERT,
      {
        ...ALERT,
        id: "svc-dispatch-alert-gps-missing-vdaec69700c50-visit-1",
        dedupeKey: "service-field-visit:visit-1:gps-missing:2026-06-22T08:05:00.000Z",
        title: "Silent update",
        notify: false,
      },
    ]);
    const notification = setNotificationMock("default", "granted");

    renderRoute();

    await screen.findByText("Visit moved");
    fireEvent.click(screen.getByRole("button", { name: /^notify$/i }));

    await waitFor(() => expect(notification.requestPermission).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(notification.NotificationCtor).toHaveBeenCalledTimes(1));
    expect(notification.NotificationCtor).toHaveBeenCalledWith(
      "AO-CASE-1001 - Visit moved",
      expect.objectContaining({
        body: "Customer requested a later arrival window.",
        tag: "service-field-visit:visit-1:due-soon:2026-06-22T08:05:00.000Z",
      }),
    );
    expect(screen.getByText("Sent")).toBeTruthy();
  });

  it("shows denied notification state without constructing notifications", async () => {
    setupApi([VISIT], [ALERT]);
    const notification = setNotificationMock("denied");

    renderRoute();

    await screen.findByText("Visit moved");
    fireEvent.click(screen.getByRole("button", { name: /^notify$/i }));

    expect(await screen.findByText("Notifications blocked")).toBeTruthy();
    expect(notification.NotificationCtor).not.toHaveBeenCalled();
  });

  it("shows unsupported notification state without constructing notifications", async () => {
    setupApi([VISIT], [ALERT]);
    clearNotificationMock();

    renderRoute();

    await screen.findByText("Visit moved");
    fireEvent.click(screen.getByRole("button", { name: /^notify$/i }));

    expect(await screen.findByText("Notifications unavailable")).toBeTruthy();
  });

  it("shows notification error state when permission request rejects", async () => {
    setupApi([VISIT], [ALERT]);
    const notification = setNotificationMock("default", "granted");
    notification.requestPermission.mockRejectedValueOnce(new Error("prompt failed"));

    renderRoute();

    await screen.findByText("Visit moved");
    fireEvent.click(screen.getByRole("button", { name: /^notify$/i }));

    expect(await screen.findByText("Notification failed")).toBeTruthy();
    expect(notification.NotificationCtor).not.toHaveBeenCalled();
  });

  it("acknowledges dispatch alerts through the backend endpoint and hides them locally", async () => {
    setupApi([VISIT], [ALERT]);
    mocks.postJson.mockResolvedValue({
      ok: true,
      alert: { ...ALERT, acknowledgedAt: "2026-06-22T08:15:00.000Z" },
    });

    renderRoute();

    await screen.findByText("Visit moved");
    fireEvent.click(screen.getByRole("button", { name: /acknowledge visit moved/i }));

    await waitFor(() => {
      expect(mocks.postJson).toHaveBeenCalledWith(
        "/api/service/dispatch-alerts/svc-dispatch-alert-due-soon-v99a0d78feb35-visit-1/ack",
        {},
        expect.anything(),
      );
    });
    await waitFor(() => expect(screen.queryByText("Visit moved")).toBeNull());
    expect(JSON.parse(localStorage.getItem(ACK_KEY) ?? "[]")).toEqual([
      "service-field-visit:visit-1:due-soon:2026-06-22T08:05:00.000Z",
    ]);

    cleanup();
    setupApi([VISIT], [
      {
        ...ALERT,
        id: "svc-dispatch-alert-due-soon-vbbf771f9bf3a-visit-1",
        dedupeKey: "service-field-visit:visit-1:due-soon:2026-06-22T08:15:00.000Z",
        title: "Visit due soon",
        body: "The scheduled arrival window is approaching.",
      },
    ]);
    renderRoute();

    expect(await screen.findByText("Visit due soon")).toBeTruthy();
    expect(screen.getByText("The scheduled arrival window is approaching.")).toBeTruthy();
  });

  it("keeps dispatch alerts visible and surfaces failure when acknowledgement rejects", async () => {
    setupApi([VISIT], [ALERT]);
    mocks.postJson.mockRejectedValueOnce(new Error("schema_mismatch"));

    renderRoute();

    await screen.findByText("Visit moved");
    fireEvent.click(screen.getByRole("button", { name: /acknowledge visit moved/i }));

    expect(await screen.findByText("Acknowledge failed")).toBeTruthy();
    expect(screen.getByText("Visit moved")).toBeTruthy();
    expect(JSON.parse(localStorage.getItem(ACK_KEY) ?? "[]")).toEqual([]);
  });

  it("renders assigned visits with route, map, and navigation links", async () => {
    setupApi([
      {
        ...VISIT,
        dispatchNavigation: {
          ...VISIT.dispatchNavigation,
          routeOptimization: {
            stopNumber: 1,
            totalStops: 3,
            strategy: "nearest-open-window",
            estimatedTravelMinutes: 12,
            estimatedDistanceKm: 4.8,
            savingsMinutes: 8,
            provider: "maps-router",
            source: "field-service-route-optimizer",
          },
        },
      },
    ]);

    renderRoute();

    await screen.findByText("AO-CASE-1001");
    expect(screen.getByText("Assigned")).toBeTruthy();
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByText("Warehouse -> Ani Beauty")).toBeTruthy();
    expect(screen.getByText("Route plan")).toBeTruthy();
    expect(screen.getByText("Stop 1/3")).toBeTruthy();
    expect(screen.getByText("nearest open window")).toBeTruthy();
    expect(screen.getByText("ETA 12 min")).toBeTruthy();
    expect(screen.getByText("4.8 km")).toBeTruthy();
    expect(screen.getByText("saved 8 min")).toBeTruthy();
    expect(screen.getAllByText("Inspect fiscal printer.").length).toBeGreaterThan(0);

    const mapLink = screen.getByRole("link", { name: /map/i });
    const navigationLink = screen.getByRole("link", { name: /navigation/i });
    expect(mapLink.getAttribute("href")).toBe("https://maps.example.test/visit-1");
    expect(navigationLink.getAttribute("href")).toBe("https://nav.example.test/visit-1");
  });

  it("does not render route optimization evidence when it is null", async () => {
    setupApi([
      {
        ...VISIT,
        dispatchNavigation: {
          ...VISIT.dispatchNavigation,
          routeOptimization: null,
        },
      },
    ]);

    renderRoute();

    await screen.findByText("Warehouse -> Ani Beauty");
    expect(screen.queryByText("Route plan")).toBeNull();
  });

  it("sends an idempotencyKey with technician status updates", async () => {
    mocks.postJson.mockResolvedValue({ ok: true, visit: { ...VISIT, status: "en-route" } });

    renderRoute();

    await screen.findByText("AO-CASE-1001");
    await waitFor(() => expect(getJsonCallCount(ALERTS_PATH)).toBeGreaterThan(0));
    const initialAlertFetches = getJsonCallCount(ALERTS_PATH);
    fireEvent.click(screen.getByRole("button", { name: /en route/i }));

    await waitFor(() => expect(mocks.postJson).toHaveBeenCalledTimes(1));
    const [, body] = mocks.postJson.mock.calls[0] ?? [];
    expect(body).toMatchObject({
      status: "en-route",
      worksheetSummary: "Inspect fiscal printer.",
    });
    expect((body as Record<string, unknown>).idempotencyKey).toEqual(expect.any(String));
    expect((body as Record<string, unknown>).idempotencyKey).toContain("visit-1:en-route");
    await waitFor(() => expect(getJsonCallCount(ALERTS_PATH)).toBeGreaterThan(initialAlertFetches));
  });

  it("captures browser GPS with location evidence and idempotency", async () => {
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      success({
        coords: {
          latitude: 40.1791864,
          longitude: 44.4991027,
          accuracy: 12.4,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
          toJSON: () => ({}),
        },
        timestamp: Date.parse("2026-06-22T08:30:00.000Z"),
        toJSON: () => ({}),
      });
    }) as Geolocation["getCurrentPosition"];
    setGeolocationMock(getCurrentPosition);
    mocks.postJson.mockResolvedValue({
      ok: true,
      visit: {
        ...VISIT,
        technicianLocation: {
          latitude: 40.1791864,
          longitude: 44.4991027,
          accuracyMeters: 12.4,
          capturedAt: "2026-06-22T08:30:00.000Z",
          source: "browser-geolocation",
          mapUrl: "https://maps.example.test/gps/visit-1",
        },
      },
    });

    renderRoute();

    await screen.findByText("AO-CASE-1001");
    await waitFor(() => expect(getJsonCallCount(ALERTS_PATH)).toBeGreaterThan(0));
    const initialAlertFetches = getJsonCallCount(ALERTS_PATH);
    fireEvent.click(screen.getByRole("button", { name: /capture gps/i }));

    await waitFor(() => {
      expect(mocks.postJson).toHaveBeenCalledWith(
        "/api/service/field-visits/visit-1/technician-location",
        expect.objectContaining({
          latitude: 40.1791864,
          longitude: 44.4991027,
          accuracyMeters: 12.4,
          source: "browser-geolocation",
          capturedAt: expect.any(String),
          idempotencyKey: expect.stringContaining("visit-1:technician-location"),
        }),
        expect.anything(),
      );
    });
    await waitFor(() => expect(getJsonCallCount(ALERTS_PATH)).toBeGreaterThan(initialAlertFetches));
    expect(screen.getByText("GPS locked")).toBeTruthy();
    expect(screen.getByText(/40\.179186, 44\.499103/)).toBeTruthy();
    expect(screen.getByText("accuracy 12 m")).toBeTruthy();
    expect(screen.getByRole("link", { name: /gps map/i }).getAttribute("href")).toBe(
      "https://maps.example.test/gps/visit-1",
    );
  });

  it("renders latest GPS evidence from the visit", async () => {
    setupApi([
      {
        ...VISIT,
        technicianLocation: {
          latitude: 40.179186,
          longitude: 44.499103,
          accuracyMeters: 8.5,
          capturedAt: "2026-06-22T08:30:00.000Z",
          source: "browser-geolocation",
        },
      },
    ]);

    renderRoute();

    await screen.findByText("AO-CASE-1001");
    expect(screen.getByText(/40\.179186, 44\.499103/)).toBeTruthy();
    expect(screen.getByText("accuracy 8.5 m")).toBeTruthy();
    expect(screen.getByRole("link", { name: /gps map/i }).getAttribute("href")).toContain(
      "www.google.com/maps/search",
    );
  });

  it("shows unsupported GPS state without posting", async () => {
    renderRoute();

    await screen.findByText("AO-CASE-1001");
    fireEvent.click(screen.getByRole("button", { name: /capture gps/i }));

    expect(await screen.findByText("GPS unavailable")).toBeTruthy();
    expect(mocks.postJson).not.toHaveBeenCalled();
  });

  it("shows geolocation callback errors without posting", async () => {
    const getCurrentPosition = vi.fn((_success: PositionCallback, error?: PositionErrorCallback | null) => {
      error?.({
        code: 1,
        message: "denied",
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3,
      } as GeolocationPositionError);
    }) as Geolocation["getCurrentPosition"];
    setGeolocationMock(getCurrentPosition);

    renderRoute();

    await screen.findByText("AO-CASE-1001");
    fireEvent.click(screen.getByRole("button", { name: /capture gps/i }));

    expect(await screen.findByText("GPS permission denied")).toBeTruthy();
    expect(mocks.postJson).not.toHaveBeenCalled();
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
