const APP_URL = "/";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});

self.addEventListener("push", (event) => {
  const payload = readPushPayload(event.data);

  if (payload.data.type === "ask.resolved") {
    event.waitUntil(closeNotificationsForTag(payload.tag));
    return;
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icons/postbox-icon-192.png",
      badge: "/icons/postbox-icon-192.png",
      data: payload.data,
      tag: payload.tag,
      renotify: true
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  event.waitUntil(openOrFocusPostbox());
});

function readPushPayload(data) {
  if (!data) return fallbackPayload();

  try {
    const parsed = data.json();
    return normalizePushPayload(parsed);
  } catch {
    return {
      ...fallbackPayload(),
      body: data.text() || fallbackPayload().body
    };
  }
}

function normalizePushPayload(payload) {
  const fallback = fallbackPayload();
  if (!payload || typeof payload !== "object") return fallback;

  const title = typeof payload.title === "string" && payload.title.trim() ? payload.title : fallback.title;
  const body = typeof payload.body === "string" && payload.body.trim() ? payload.body : fallback.body;
  const data = payload.data && typeof payload.data === "object" ? payload.data : {};
  const tag = typeof data.requestId === "string" && data.requestId ? `postbox-${data.requestId}` : "postbox-question";

  return { title, body, data, tag };
}

function fallbackPayload() {
  return {
    title: "New Postbox question",
    body: "A Postbox session needs your input.",
    data: {},
    tag: "postbox-question"
  };
}

async function closeNotificationsForTag(tag) {
  const notifications = await self.registration.getNotifications({ tag });
  for (const notification of notifications) notification.close();
}

async function openOrFocusPostbox() {
  const windows = await clients.matchAll({ type: "window", includeUncontrolled: true });
  const existingWindow = windows.find((client) => new URL(client.url).origin === self.location.origin);

  if (existingWindow) {
    return existingWindow.focus();
  }

  return clients.openWindow(APP_URL);
}
