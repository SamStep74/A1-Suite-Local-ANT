import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DISPATCH_SERVICE_WORKER_MESSAGE_TYPE,
  DISPATCH_SERVICE_WORKER_SCOPE,
  DISPATCH_SERVICE_WORKER_URL,
  postDispatchNotificationToServiceWorker,
  registerDispatchServiceWorker,
} from "./dispatch-service-worker";

afterEach(() => {
  Reflect.deleteProperty(navigator, "serviceWorker");
  vi.restoreAllMocks();
});

describe("dispatch service worker helpers", () => {
  it("reports unsupported when service workers are unavailable", async () => {
    Reflect.deleteProperty(navigator, "serviceWorker");

    await expect(registerDispatchServiceWorker()).resolves.toEqual({
      ok: false,
      reason: "unsupported",
    });
    await expect(postDispatchNotificationToServiceWorker("Alert", {})).resolves.toBe(false);
  });

  it("registers the dispatch service worker at the app root scope", async () => {
    const registration = {} as ServiceWorkerRegistration;
    const register = vi.fn().mockResolvedValue(registration);
    setServiceWorkerContainer({ register });

    await expect(registerDispatchServiceWorker()).resolves.toEqual({
      ok: true,
      registration,
    });
    expect(register).toHaveBeenCalledWith(DISPATCH_SERVICE_WORKER_URL, {
      scope: DISPATCH_SERVICE_WORKER_SCOPE,
    });
  });

  it("posts dispatch notifications to an active service worker", async () => {
    const postMessage = vi.fn();
    setServiceWorkerContainer({
      ready: Promise.resolve({
        active: { postMessage },
      } as unknown as ServiceWorkerRegistration),
    });

    await expect(
      postDispatchNotificationToServiceWorker("Visit moved", {
        body: "Customer changed the window.",
        tag: "service-field-visit:visit-1:due-soon",
      }),
    ).resolves.toBe(true);

    expect(postMessage).toHaveBeenCalledWith({
      type: DISPATCH_SERVICE_WORKER_MESSAGE_TYPE,
      payload: {
        title: "Visit moved",
        options: {
          body: "Customer changed the window.",
          tag: "service-field-visit:visit-1:due-soon",
        },
      },
    });
  });

  it("falls back to registration.showNotification when no worker is active yet", async () => {
    const showNotification = vi.fn().mockResolvedValue(undefined);
    setServiceWorkerContainer({
      ready: Promise.resolve({
        active: null,
        showNotification,
      } as unknown as ServiceWorkerRegistration),
    });

    await expect(
      postDispatchNotificationToServiceWorker("Route update", { tag: "route-update" }),
    ).resolves.toBe(true);
    expect(showNotification).toHaveBeenCalledWith("Route update", { tag: "route-update" });
  });
});

function setServiceWorkerContainer(
  overrides: Partial<ServiceWorkerContainer> & {
    register?: ReturnType<typeof vi.fn>;
  },
) {
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      register: vi.fn(),
      ready: Promise.resolve({ active: null } as unknown as ServiceWorkerRegistration),
      controller: null,
      ...overrides,
    },
  });
}
