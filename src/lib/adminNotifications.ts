import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
  type Unsubscribe,
} from "firebase/firestore";
import type { AdminRole } from "@/lib/admin/nav";
import type { StoredPushSubscription } from "@/lib/chatNotifications";

export type AdminNotificationCategory = "chat" | "project" | "task" | "client" | "hr";

export interface AdminNotificationDoc {
  id: string;
  targetRoles: AdminRole[];
  category: AdminNotificationCategory;
  eventType: string;
  title: string;
  body: string;
  href: string;
  actorUid?: string | null;
  actorName?: string | null;
  entityId?: string | null;
  projectId?: string | null;
  taskId?: string | null;
  readBy: string[];
  createdAt: { toDate: () => Date } | null;
  _sourceCollection?: "adminNotifications" | "alerts";
}

export interface NotifyAdminsInput {
  targetRoles: AdminRole[];
  category: AdminNotificationCategory;
  eventType: string;
  title: string;
  body: string;
  href: string;
  actorUid?: string;
  actorName?: string;
  entityId?: string;
  projectId?: string;
  taskId?: string;
  urgent?: boolean;
}

export async function sendWebPushToAdminsFromAdmin(
  db: Firestore,
  opts: {
    roles: AdminRole[];
    excludeUid?: string;
    title: string;
    body: string;
    url?: string;
    taskId?: string;
    urgent?: boolean;
    delayMs?: number;
  },
): Promise<void> {
  const subMap = new Map<string, StoredPushSubscription>();

  const collectDoc = (_docId: string, data: Record<string, unknown> | undefined) => {
    if (!data) return;
    const role = data.role as AdminRole | undefined;
    if (role && !opts.roles.includes(role)) return;

    if (Array.isArray(data.subscriptions)) {
      for (const s of data.subscriptions) {
        if (s && typeof s.endpoint === "string" && s.keys?.p256dh && s.keys?.auth) {
          subMap.set(s.endpoint, s as StoredPushSubscription);
        }
      }
    } else if (
      data.subscription &&
      typeof (data.subscription as StoredPushSubscription).endpoint === "string" &&
      (data.subscription as StoredPushSubscription).keys?.p256dh &&
      (data.subscription as StoredPushSubscription).keys?.auth
    ) {
      const s = data.subscription as StoredPushSubscription;
      subMap.set(s.endpoint, s);
    }
  };

  try {
    const snap = await getDocs(collection(db, "adminPushSubscriptions"));
    snap.forEach((d) => collectDoc(d.id, d.data() as Record<string, unknown>));
  } catch {
    /* ignore */
  }

  try {
    const fallbackSnap = await getDocs(
      query(collection(db, "alerts"), where("type", "==", "admin_push_sub")),
    );
    fallbackSnap.forEach((d) => collectDoc(d.id, d.data() as Record<string, unknown>));
  } catch {
    /* ignore */
  }

  const allSubs = Array.from(subMap.values());
  if (allSubs.length === 0) return;

  try {
    await fetch("/api/web-push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subscriptions: allSubs,
        delayMs: opts.delayMs,
        payload: {
          title: opts.title,
          body: opts.body,
          url: opts.url || "/admin",
          taskId: opts.taskId,
          urgent: opts.urgent,
        },
      }),
    });
  } catch (err) {
    console.warn("[AdminNotifications] Web push failed:", err);
  }
}

export async function notifyAdmins(db: Firestore, input: NotifyAdminsInput): Promise<void> {
  const roles = Array.from(new Set<AdminRole>(["super_admin", ...input.targetRoles]));

  const payload = {
    targetRoles: roles,
    category: input.category,
    eventType: input.eventType,
    title: input.title,
    body: input.body,
    href: input.href,
    actorUid: input.actorUid ?? null,
    actorName: input.actorName ?? null,
    entityId: input.entityId ?? null,
    projectId: input.projectId ?? null,
    taskId: input.taskId ?? null,
    readBy: input.actorUid ? [input.actorUid] : [],
    createdAt: serverTimestamp(),
  };

  try {
    await addDoc(collection(db, "adminNotifications"), payload);
  } catch {
    try {
      await addDoc(collection(db, "alerts"), {
        ...payload,
        type: "schedule",
        isRead: false,
        hasPenalty: false,
        adminNotif: true,
      });
    } catch (err2) {
      console.warn("[AdminNotifications] Could not create adminNotification:", err2);
    }
  }

  void sendWebPushToAdminsFromAdmin(db, {
    roles,
    excludeUid: input.actorUid,
    title: input.title,
    body: input.body,
    url: input.href,
    taskId: input.taskId,
    urgent: input.urgent,
  });
}

export function subscribeAdminNotifications(
  db: Firestore,
  role: AdminRole,
  callback: (items: AdminNotificationDoc[]) => void,
): Unsubscribe {
  const qPrimary =
    role === "super_admin"
      ? collection(db, "adminNotifications")
      : query(collection(db, "adminNotifications"), where("targetRoles", "array-contains", role));

  const qFallback = query(collection(db, "alerts"), where("adminNotif", "==", true));

  let primaryDocs: AdminNotificationDoc[] = [];
  let fallbackDocs: AdminNotificationDoc[] = [];

  const emitMerged = () => {
    const map = new Map<string, AdminNotificationDoc>();
    for (const item of [...primaryDocs, ...fallbackDocs]) {
      if (role !== "super_admin") {
        if (!Array.isArray(item.targetRoles) || !item.targetRoles.includes(role)) continue;
      }
      map.set(item.id, item);
    }
    const list = Array.from(map.values())
      .sort((a, b) => {
        const ta = a.createdAt?.toDate?.()?.getTime() ?? Date.now();
        const tb = b.createdAt?.toDate?.()?.getTime() ?? Date.now();
        return tb - ta;
      })
      .slice(0, 40);
    callback(list);
  };

  const unsub1 = onSnapshot(
    qPrimary,
    (snap) => {
      primaryDocs = snap.docs.map(
        (d) => ({ id: d.id, ...d.data(), _sourceCollection: "adminNotifications" }) as AdminNotificationDoc,
      );
      emitMerged();
    },
    () => {
      primaryDocs = [];
      emitMerged();
    },
  );

  const unsub2 = onSnapshot(
    qFallback,
    (snap) => {
      fallbackDocs = snap.docs.map(
        (d) => ({ id: d.id, ...d.data(), _sourceCollection: "alerts" }) as AdminNotificationDoc,
      );
      emitMerged();
    },
    () => {
      fallbackDocs = [];
      emitMerged();
    },
  );

  return () => {
    unsub1();
    unsub2();
  };
}

export async function markAdminNotificationRead(
  db: Firestore,
  notifId: string,
  readerKey: string,
): Promise<void> {
  if (!readerKey) return;
  await updateDoc(doc(db, "adminNotifications", notifId), {
    readBy: arrayUnion(readerKey),
  }).catch(async () => {
    await updateDoc(doc(db, "alerts", notifId), {
      readBy: arrayUnion(readerKey),
    }).catch(() => {});
  });
}

export async function markAllAdminNotificationsRead(
  db: Firestore,
  items: AdminNotificationDoc[],
  readerKey: string,
): Promise<void> {
  if (!readerKey) return;
  const unread = items.filter((n) => !Array.isArray(n.readBy) || !n.readBy.includes(readerKey));
  if (unread.length === 0) return;
  try {
    const batch = writeBatch(db);
    unread.forEach((n) => {
      const colName = n._sourceCollection || "adminNotifications";
      batch.update(doc(db, colName, n.id), {
        readBy: arrayUnion(readerKey),
      });
    });
    await batch.commit();
  } catch {
    /* ignore */
  }
}
