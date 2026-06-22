const DISPATCH_NOTIFICATION_MESSAGE_TYPE = "A1_DISPATCH_ALERT_NOTIFY";
const DISPATCH_URL = "/app/desk/dispatch";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  const message = event.data || {};
  if (message.type !== DISPATCH_NOTIFICATION_MESSAGE_TYPE) return;

  const payload = normalizeNotificationPayload(message.payload);
  if (!payload) return;

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      ...payload.options,
      icon: payload.options.icon || "/a1-icon-192.png",
      badge: payload.options.badge || "/a1-icon-192.png",
      data: {
        ...(payload.options.data || {}),
        url: DISPATCH_URL,
      },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url
    ? event.notification.data.url
    : DISPATCH_URL;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const matchingClient = clients.find((client) => client.url.includes(DISPATCH_URL));
      if (matchingClient && "focus" in matchingClient) return matchingClient.focus();
      if (self.clients.openWindow) return self.clients.openWindow(url);
      return undefined;
    }),
  );
});

function normalizeNotificationPayload(payload) {
  if (!payload || typeof payload.title !== "string") return null;
  const title = payload.title.trim();
  if (!title) return null;
  const rawOptions = payload.options && typeof payload.options === "object" ? payload.options : {};

  return {
    title: title.slice(0, 180),
    options: {
      body: normalizeString(rawOptions.body, 300),
      tag: normalizeString(rawOptions.tag, 180),
      icon: normalizeString(rawOptions.icon, 180),
      badge: normalizeString(rawOptions.badge, 180),
      data: rawOptions.data && typeof rawOptions.data === "object" ? rawOptions.data : {},
      renotify: Boolean(rawOptions.renotify),
    },
  };
}

function normalizeString(value, maxLength) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maxLength)
    : undefined;
}
