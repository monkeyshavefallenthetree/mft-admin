/* MFT Admin Workspace — Service Worker (Web Push + Android & iOS Lock Screen Persistence) */

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = self.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function buildNotificationOptions(payload) {
  const safePayload = payload && typeof payload === "object" ? payload : {};
  const title = safePayload.title || "MFT Admin";
  const url = safePayload.url || "/admin";
  const baseTag = String(safePayload.tag || safePayload.taskId || "mft-admin");
  const hasTimestampSuffix = /-\d{10,}$/.test(baseTag);
  const tag = safePayload.dedupe
    ? baseTag
    : hasTimestampSuffix
      ? baseTag
      : `${baseTag}-${Date.now()}`;
  const urgent = Boolean(safePayload.urgent);
  // Default requireInteraction = true so notifications persist on Android/desktop until dismissed
  const requireInteraction = safePayload.requireInteraction !== false;

  return {
    title,
    options: {
      body: safePayload.body || "New activity requires attention in MFT Admin.",
      icon: safePayload.icon || "/icons/icon-192.png",
      badge: safePayload.badge || "/icons/icon-192.png",
      tag,
      renotify: true,
      silent: false,
      requireInteraction,
      vibrate: urgent ? [300, 120, 300, 120, 400] : [200, 100, 200],
      timestamp: typeof safePayload.timestamp === "number" ? safePayload.timestamp : Date.now(),
      data: {
        url,
        ...(safePayload.data || {}),
      },
    },
  };
}

async function displayLockScreenNotification(payload) {
  const { title, options } = buildNotificationOptions(payload);
  // 3-tier fallback ensures showNotification never rejects on iOS WebKit (avoids 3-strike push revocation)
  try {
    await self.registration.showNotification(title, options);
  } catch {
    try {
      await self.registration.showNotification(title, {
        body: options.body,
        icon: "/icons/icon-192.png",
        tag: options.tag,
        data: options.data,
      });
    } catch {
      await self.registration.showNotification(title, {
        body: options.body || "New notification from MFT Admin.",
      });
    }
  }

  try {
    if (self.navigator && typeof self.navigator.setAppBadge === "function") {
      const count = typeof payload?.badgeCount === "number" ? payload.badgeCount : 1;
      await self.navigator.setAppBadge(count);
    }
  } catch {
    /* ignore */
  }
}

self.addEventListener("push", (event) => {
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      try {
        payload = { title: "MFT Admin", body: event.data.text() };
      } catch {
        payload = { title: "MFT Admin", body: "New notification received." };
      }
    }
  }

  event.waitUntil(displayLockScreenNotification(payload));
});

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        let appServerKey = event.oldSubscription?.options?.applicationServerKey || null;
        if (!appServerKey) {
          const res = await fetch("/api/web-push", { cache: "no-store" });
          if (res.ok) {
            const json = await res.json();
            if (json && typeof json.publicKey === "string") {
              appServerKey = urlBase64ToUint8Array(json.publicKey);
            }
          }
        }
        if (!appServerKey) return;

        const newSub = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: appServerKey,
        });
        const subJson = newSub.toJSON();
        const clientList = await self.clients.matchAll({
          type: "window",
          includeUncontrolled: true,
        });
        for (const client of clientList) {
          try {
            const clientPath = new URL(client.url).pathname;
            if (clientPath.startsWith("/admin")) {
              client.postMessage({
                type: "MFT_PUSH_SUBSCRIPTION_CHANGED",
                subscription: subJson,
              });
            }
          } catch {
            /* ignore */
          }
        }
      } catch {
        /* ignore rotation failure — client will re-sync on next open */
      }
    })(),
  );
});

self.addEventListener("message", (event) => {
  const msg = event.data;
  if (!msg || typeof msg !== "object") return;

  if (msg.type === "SHOW_LOCAL_NOTIFICATION" && msg.payload) {
    event.waitUntil(displayLockScreenNotification(msg.payload));
  } else if (msg.type === "CLEAR_BADGE") {
    if (self.navigator && typeof self.navigator.clearAppBadge === "function") {
      self.navigator.clearAppBadge().catch(() => {});
    }
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const targetUrl = typeof data.url === "string" && data.url ? data.url : "/admin";
  const absUrl = new URL(targetUrl, self.location.origin).href;

  event.waitUntil(
    (async () => {
      try {
        if (self.navigator && typeof self.navigator.clearAppBadge === "function") {
          await self.navigator.clearAppBadge();
        }
      } catch {
        /* ignore */
      }

      const clientList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      // Only focus existing /admin workspace tabs — never hijack external /client portal tabs
      for (const client of clientList) {
        let clientPath = "";
        try {
          clientPath = new URL(client.url).pathname;
        } catch {
          continue;
        }
        if (!clientPath.startsWith("/admin")) continue;
        if ("focus" in client) {
          await client.focus();
          try {
            if (client.url !== absUrl && "navigate" in client && typeof client.navigate === "function") {
              await client.navigate(absUrl);
            }
          } catch {
            /* fallback to postMessage below */
          }
          client.postMessage({
            type: "MFT_NOTIFICATION_CLICK",
            url: targetUrl,
            data,
          });
          return;
        }
      }

      if (self.clients.openWindow) {
        await self.clients.openWindow(absUrl);
      }
    })(),
  );
});
