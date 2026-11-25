import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  where,
  getDocs,
  updateDoc,
  writeBatch,
  serverTimestamp,
  type Firestore,
  type Unsubscribe,
} from "firebase/firestore";

export type ChatNotification = {
  id: string;
  recipientUid: string;
  recipientRole: string | null;
  taskId: string;
  taskTitle: string;
  senderName: string;
  senderRole: "worker" | "admin";
  messagePreview: string;
  isRead: boolean;
  createdAt: { toDate: () => Date } | null;
};

const EXPO_PUSH_TOKEN_RE = /^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/;

export function isValidExpoToken(token: unknown): token is string {
  return typeof token === "string" && EXPO_PUSH_TOKEN_RE.test(token.trim());
}

export function subscribeAdminChatNotifications(
  db: Firestore,
  callback: (notifications: ChatNotification[]) => void,
): Unsubscribe {
  const q = query(
    collection(db, "chatNotifications"),
    where("recipientRole", "==", "admin"),
  );
  return onSnapshot(
    q,
    (snap) => {
      const notifs = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }) as ChatNotification)
        .filter((n) => n.isRead === false)
        .sort((a, b) => {
          const ta = a.createdAt?.toDate().getTime() ?? 0;
          const tb = b.createdAt?.toDate().getTime() ?? 0;
          return tb - ta;
        });
      callback(notifs);
    },
    (err) => {
      console.error("[ChatNotifications] listener error:", err.message, err);
      callback([]);
    },
  );
}

export type StoredPushSubscription = {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
  userAgent?: string;
  platform?: string;
  createdAt?: string;
};

async function pruneDeadWorkerSubscriptions(
  db: Firestore,
  ownerByEndpoint: Map<string, Set<string>>,
  goneEndpoints: string[],
): Promise<void> {
  if (goneEndpoints.length === 0) return;
  const goneSet = new Set(goneEndpoints);
  const affectedUids = new Set<string>();
  for (const ep of goneEndpoints) {
    const owners = ownerByEndpoint.get(ep);
    if (owners) owners.forEach((uid) => affectedUids.add(uid));
  }

  await Promise.all(
    Array.from(affectedUids).map(async (uid) => {
      try {
        const ref = doc(db, "workers", uid);
        const snap = await getDoc(ref);
        if (!snap.exists()) return;
        const data = snap.data();
        const patch: Record<string, unknown> = {};

        if (Array.isArray(data.webPushSubscriptions)) {
          const cleaned = data.webPushSubscriptions.filter(
            (s: unknown) =>
              s &&
              typeof (s as StoredPushSubscription).endpoint === "string" &&
              !goneSet.has((s as StoredPushSubscription).endpoint),
          );
          if (cleaned.length !== data.webPushSubscriptions.length) {
            patch.webPushSubscriptions = cleaned;
          }
        }

        // Legacy fallback cleanup: only clean if expoPushToken holds legacy "webp:" JSON, NEVER native Expo tokens
        if (typeof data.expoPushToken === "string" && data.expoPushToken.startsWith("webp:")) {
          try {
            const parsed = JSON.parse(data.expoPushToken.slice(5));
            const arr = (Array.isArray(parsed) ? parsed : [parsed]).filter(
              (s: unknown) =>
                s &&
                typeof (s as StoredPushSubscription).endpoint === "string" &&
                !goneSet.has((s as StoredPushSubscription).endpoint),
            );
            patch.expoPushToken = arr.length > 0 ? `webp:${JSON.stringify(arr)}` : null;
          } catch {
            /* ignore malformed legacy JSON */
          }
        }

        if (Object.keys(patch).length > 0) {
          patch.webPushUpdatedAt = serverTimestamp();
          await updateDoc(ref, patch);
        }
      } catch (err) {
        console.warn("[WebPush] failed pruning dead endpoint for worker", uid, err);
      }
    }),
  );
}

async function pruneInvalidWorkerExpoTokens(
  db: Firestore,
  ownerByToken: Map<string, Set<string>>,
  invalidTokens: string[],
): Promise<void> {
  if (invalidTokens.length === 0) return;
  const badSet = new Set(invalidTokens);
  const affectedUids = new Set<string>();
  for (const tok of invalidTokens) {
    const owners = ownerByToken.get(tok);
    if (owners) owners.forEach((uid) => affectedUids.add(uid));
  }

  await Promise.all(
    Array.from(affectedUids).map(async (uid) => {
      try {
        const ref = doc(db, "workers", uid);
        const snap = await getDoc(ref);
        if (!snap.exists()) return;
        const currentToken = snap.data().expoPushToken;
        if (typeof currentToken === "string" && badSet.has(currentToken.trim())) {
          await updateDoc(ref, { expoPushToken: null });
        }
      } catch (err) {
        console.warn("[ExpoPush] failed pruning DeviceNotRegistered token for worker", uid, err);
      }
    }),
  );
}

export async function sendExpoPushToWorkers(
  db: Firestore,
  opts: {
    recipientUids: string[];
    title: string;
    body: string;
    taskId?: string;
    taskTitle?: string;
    tab?: string;
    url?: string;
    tag?: string;
    dedupe?: boolean;
    topic?: string;
    urgent?: boolean;
    requireInteraction?: boolean;
    channelId?: string;
  },
): Promise<void> {
  const targetUrl = opts.url || (opts.tab ? `/dashboard?tab=${opts.tab}` : "/dashboard");
  const targetTab = opts.tab || (opts.taskId ? "tasks" : "");

  const messages: Array<{
    to: string;
    title: string;
    body: string;
    sound: string;
    priority: "high";
    ttl: number;
    badge: number;
    channelId: string;
    mutableContent: boolean;
    _displayInForeground: boolean;
    interruptionLevel: "time-sensitive" | "active";
    urgent: boolean;
    data: Record<string, string>;
  }> = [];

  const webPushMap = new Map<string, StoredPushSubscription>();
  const ownerByEndpoint = new Map<string, Set<string>>();
  const ownerByExpoToken = new Map<string, Set<string>>();
  const seenExpoTokens = new Set<string>();

  const uniqueUids = Array.from(new Set(opts.recipientUids.filter(Boolean)));
  for (const uid of uniqueUids) {
    let snap;
    try {
      snap = await getDoc(doc(db, "workers", uid));
    } catch {
      continue;
    }
    if (!snap.exists()) continue;
    const data = snap.data();

    const registerEndpoint = (sub: StoredPushSubscription) => {
      webPushMap.set(sub.endpoint, sub);
      const set = ownerByEndpoint.get(sub.endpoint) ?? new Set<string>();
      set.add(uid);
      ownerByEndpoint.set(sub.endpoint, set);
    };

    const token = data.expoPushToken;
    if (typeof token === "string" && token.startsWith("webp:")) {
      try {
        const parsed = JSON.parse(token.slice(5));
        const arr = Array.isArray(parsed) ? parsed : [parsed];
        for (const s of arr) {
          if (s && typeof s.endpoint === "string" && s.keys?.p256dh && s.keys?.auth) {
            registerEndpoint(s as StoredPushSubscription);
          }
        }
      } catch {
        /* ignore invalid JSON */
      }
    } else if (isValidExpoToken(token)) {
      const cleanToken = token.trim();
      const owners = ownerByExpoToken.get(cleanToken) ?? new Set<string>();
      owners.add(uid);
      ownerByExpoToken.set(cleanToken, owners);
      if (!seenExpoTokens.has(cleanToken)) {
        seenExpoTokens.add(cleanToken);
        messages.push({
          to: cleanToken,
          title: opts.title,
          body: opts.body,
          sound: "default",
          priority: "high",
          ttl: 86400,
          badge: 1,
          channelId: opts.channelId || (opts.urgent ? "alerts" : "chat"),
          mutableContent: true,
          _displayInForeground: true,
          interruptionLevel: opts.urgent ? "time-sensitive" : "active",
          urgent: Boolean(opts.urgent),
          data: {
            taskId: opts.taskId ?? "",
            taskTitle: opts.taskTitle ?? "",
            tab: targetTab,
            url: targetUrl,
          },
        });
      }
    }

    if (Array.isArray(data.webPushSubscriptions)) {
      for (const s of data.webPushSubscriptions) {
        if (s && typeof s.endpoint === "string" && s.keys?.p256dh && s.keys?.auth) {
          registerEndpoint(s as StoredPushSubscription);
        }
      }
    }
  }

  const webPushSubs = Array.from(webPushMap.values());

  // 1. Send Web Push to Safari (iOS 16.4+ Home Screen PWA) / Chrome / Android PWAs
  if (webPushSubs.length > 0) {
    try {
      const res = await fetch("/api/web-push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({
          subscriptions: webPushSubs,
          payload: {
            title: opts.title,
            body: opts.body,
            url: targetUrl,
            tab: targetTab || undefined,
            taskId: opts.taskId,
            tag: opts.tag,
            dedupe: opts.dedupe,
            topic: opts.topic,
            urgent: opts.urgent,
            requireInteraction: opts.requireInteraction !== false,
            data: {
              url: targetUrl,
              tab: targetTab,
              taskId: opts.taskId ?? "",
            },
          },
        }),
      });
      if (res.ok) {
        const json = (await res.json()) as { goneEndpoints?: string[] };
        if (Array.isArray(json.goneEndpoints) && json.goneEndpoints.length > 0) {
          void pruneDeadWorkerSubscriptions(db, ownerByEndpoint, json.goneEndpoints);
        }
      }
    } catch (err) {
      console.warn("[WebPush] API error:", err);
    }
  }

  // 2. Send Expo Push to native Android/iOS mobile app installs
  if (messages.length === 0) {
    return;
  }

  try {
    const res = await fetch("/api/expo-push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify(messages),
    });

    const responseText = await res.text();
    if (!res.ok) {
      console.error("[ExpoPush] API error", res.status, responseText);
      return;
    }

    try {
      const body = JSON.parse(responseText) as {
        invalidTokens?: string[];
        data?: Array<{ status?: string; message?: string; details?: unknown }>;
        errors?: unknown[];
      };
      if (Array.isArray(body.invalidTokens) && body.invalidTokens.length > 0) {
        void pruneInvalidWorkerExpoTokens(db, ownerByExpoToken, body.invalidTokens);
      }
      if (Array.isArray(body.errors) && body.errors.length > 0) {
        console.error("[ExpoPush] Expo errors:", body.errors);
      }
      if (Array.isArray(body.data)) {
        for (const ticket of body.data) {
          if (ticket?.status === "error") {
            console.error("[ExpoPush] Ticket error:", ticket.message, ticket.details);
          }
        }
      }
    } catch {
      // non-JSON response
    }
  } catch (err) {
    console.warn("[ExpoPush] fetch failed:", err);
  }
}

export async function sendChatNotificationToWorkers(
  db: Firestore,
  params: {
    recipientUids: string[];
    taskId: string;
    taskTitle: string;
    senderUid: string;
    senderName: string;
    messageText: string;
  },
): Promise<void> {
  const preview =
    params.messageText.length > 80
      ? params.messageText.slice(0, 80) + "…"
      : params.messageText;

  const targets = params.recipientUids.filter((uid) => uid !== params.senderUid);

  const promises = targets.map((uid) =>
    addDoc(collection(db, "chatNotifications"), {
      recipientUid: uid,
      recipientRole: null,
      taskId: params.taskId,
      taskTitle: params.taskTitle,
      senderName: params.senderName,
      senderRole: "admin" as const,
      messagePreview: preview,
      isRead: false,
      createdAt: serverTimestamp(),
    }),
  );
  await Promise.all(promises);

  if (targets.length > 0) {
    try {
      await sendExpoPushToWorkers(db, {
        recipientUids: targets,
        title: `New message from ${params.senderName}`,
        body: preview,
        taskId: params.taskId,
        taskTitle: params.taskTitle,
        channelId: "chat",
      });
    } catch (e) {
      console.warn("[ExpoPush] send failed", e);
    }
  }

  import("./adminNotifications")
    .then(({ notifyAdmins }) =>
      notifyAdmins(db, {
        targetRoles: ["super_admin", "ops_admin"],
        category: "chat",
        eventType: "task_chat_message",
        title: `💬 Task Chat: ${params.taskTitle}`,
        body: `${params.senderName}: ${preview}`,
        href: `/admin/tasks?task=${encodeURIComponent(params.taskId)}`,
        actorUid: params.senderUid,
        actorName: params.senderName,
        taskId: params.taskId,
      }),
    )
    .catch(() => {});
}

export async function sendChatNotificationToAdmin(
  db: Firestore,
  params: {
    taskId: string;
    taskTitle: string;
    senderUid: string;
    senderName: string;
    messageText: string;
  },
): Promise<void> {
  const preview =
    params.messageText.length > 80
      ? params.messageText.slice(0, 80) + "…"
      : params.messageText;

  await addDoc(collection(db, "chatNotifications"), {
    recipientUid: null,
    recipientRole: "admin",
    taskId: params.taskId,
    taskTitle: params.taskTitle,
    senderName: params.senderName,
    senderRole: "worker" as const,
    messagePreview: preview,
    isRead: false,
    createdAt: serverTimestamp(),
  });
}

export async function markTaskChatNotificationsReadForAdmin(
  db: Firestore,
  taskId: string,
): Promise<void> {
  const q = query(
    collection(db, "chatNotifications"),
    where("recipientRole", "==", "admin"),
  );
  const snap = await getDocs(q);
  const unread = snap.docs.filter(
    (d) => d.data().taskId === taskId && d.data().isRead === false,
  );
  if (unread.length === 0) return;

  const batch = writeBatch(db);
  unread.forEach((d) => batch.update(d.ref, { isRead: true }));
  await batch.commit();
}
