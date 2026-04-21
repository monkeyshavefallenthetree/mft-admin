import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  where,
  getDocs,
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

export async function sendExpoPushToWorkers(
  db: Firestore,
  opts: {
    recipientUids: string[];
    title: string;
    body: string;
    taskId: string;
    taskTitle: string;
  },
): Promise<void> {
  const messages: Array<{
    to: string;
    title: string;
    body: string;
    sound: string;
    priority: string;
    channelId: string;
    android: { channelId: string };
    data: { taskId: string; taskTitle: string };
  }> = [];

  for (const uid of opts.recipientUids) {
    const snap = await getDoc(doc(db, "workers", uid));
    if (!snap.exists()) continue;
    const token = snap.data().expoPushToken;
    if (typeof token === "string" && token.length > 0) {
      messages.push({
        to: token,
        title: opts.title,
        body: opts.body,
        sound: "default",
        priority: "high",
        channelId: "chat",
        android: { channelId: "chat" },
        data: { taskId: opts.taskId, taskTitle: opts.taskTitle },
      });
    }
  }

  if (messages.length === 0) {
    console.warn("[ExpoPush] No workers have expoPushToken — is the mobile APK (not Expo Go) installed and logged in?");
    return;
  }

  const res = await fetch("/api/expo-push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(messages),
  });

  const responseText = await res.text();
  if (!res.ok) {
    console.error("[ExpoPush] API error", res.status, responseText);
    return;
  }

  try {
    const body = JSON.parse(responseText) as {
      data?: Array<{ status?: string; message?: string; details?: unknown }>;
      errors?: unknown[];
    };
    if (Array.isArray(body.errors) && body.errors.length > 0) {
      console.error("[ExpoPush] Expo errors (check FCM credentials in EAS):", body.errors);
    }
    if (Array.isArray(body.data)) {
      for (const ticket of body.data) {
        if (ticket?.status === "ok") {
          console.log("[ExpoPush] Ticket OK:", ticket);
        }
        if (ticket?.status === "error") {
          console.error("[ExpoPush] Ticket error:", ticket.message, ticket.details);
        }
      }
    }
  } catch {
    // non-JSON response
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
      });
    } catch (e) {
      console.warn("[ExpoPush] send failed", e);
    }
  }
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
