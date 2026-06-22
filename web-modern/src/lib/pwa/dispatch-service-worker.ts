export const DISPATCH_SERVICE_WORKER_URL = "/a1-dispatch-sw.js";
export const DISPATCH_SERVICE_WORKER_SCOPE = "/";
export const DISPATCH_SERVICE_WORKER_MESSAGE_TYPE = "A1_DISPATCH_ALERT_NOTIFY";

const SERVICE_WORKER_READY_TIMEOUT_MS = 1_500;

export type DispatchServiceWorkerRegistrationResult =
  | { ok: true; registration: ServiceWorkerRegistration }
  | { ok: false; reason: "unsupported" | "insecure-context" | "registration-failed"; error?: unknown };

export async function registerDispatchServiceWorker(): Promise<DispatchServiceWorkerRegistrationResult> {
  if (typeof window === "undefined" || typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return { ok: false, reason: "unsupported" };
  }
  if (!window.isSecureContext && !isLocalhost(window.location.hostname)) {
    return { ok: false, reason: "insecure-context" };
  }

  try {
    const registration = await navigator.serviceWorker.register(DISPATCH_SERVICE_WORKER_URL, {
      scope: DISPATCH_SERVICE_WORKER_SCOPE,
    });
    return { ok: true, registration };
  } catch (error) {
    return { ok: false, reason: "registration-failed", error };
  }
}

export async function postDispatchNotificationToServiceWorker(
  title: string,
  options: NotificationOptions,
): Promise<boolean> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return false;
  }

  try {
    const registration = await withTimeout(
      navigator.serviceWorker.ready,
      SERVICE_WORKER_READY_TIMEOUT_MS,
    );
    if (!registration) return false;

    const worker = registration.active ?? navigator.serviceWorker.controller;
    if (worker) {
      worker.postMessage({
        type: DISPATCH_SERVICE_WORKER_MESSAGE_TYPE,
        payload: { title, options },
      });
      return true;
    }

    if (typeof registration.showNotification === "function") {
      await registration.showNotification(title, options);
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isLocalhost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}
