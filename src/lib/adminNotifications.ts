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
  },
): Promise<void> {
  const allSubs: StoredPushSubscription[] = [];
  try {
    const snap = await getDocs(collection(db, "adminPushSubscriptions"));
    snap.forEach((d) => {
      const data = d.data();
      if (opts.excludeUid && d.id === opts.excludeUid) return;
      const role = data?.role as AdminRole | undefined;
      if (role && !opts.roles.includes(role)) return;

      if (Array.isArray(data?.subscriptions)) {
        for (const s of data.subscriptions) {
          if (s && typeof s.endpoint === "string" && s.keys?.p256dh && s.keys?.auth) {
            allSubs.push(s as StoredPushSubscription);
          }
        }
      } else if (
        data?.subscription &&
        typeof data.subscription.endpoint === "string" &&
        data.subscription.keys?.p256dh &&
        data.subscription.keys?.auth
      ) {
        allSubs.push(data.subscription as StoredPushSubscription);
      }
    });
  } catch {
    /* ignore */
  }

  if (allSubs.length === 0) return;

  try {
    await fetch("/api/web-push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subscriptions: allSubs,
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

  try {
    await addDoc(collection(db, "adminNotifications"), {
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
    });
  } catch (err) {
    console.warn("[AdminNotifications] Could not create adminNotification:", err);
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
  const q =
    role === "super_admin"
      ? collection(db, "adminNotifications")
      : query(collection(db, "adminNotifications"), where("targetRoles", "array-contains", role));

  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }) as AdminNotificationDoc)
        .filter((n) => {
          if (role === "super_admin") return true;
          return Array.isArray(n.targetRoles) && n.targetRoles.includes(role);
        })
        .sort((a, b) => {
          const ta = a.createdAt?.toDate?.()?.getTime() ?? Date.now();
          const tb = b.createdAt?.toDate?.()?.getTime() ?? Date.now();
          return tb - ta;
        })
        .slice(0, 40);
      callback(list);
    },
    (err) => {
      console.warn("[AdminNotifications] listener error:", err.message);
      callback([]);
    },
  );
}

export async function markAdminNotificationRead(
  db: Firestore,
  notifId: string,
  readerKey: string,
): Promise<void> {
  if (!readerKey) return;
  try {
    await updateDoc(doc(db, "adminNotifications", notifId), {
      readBy: arrayUnion(readerKey),
    });
  } catch {
    /* ignore */
  }
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
      batch.update(doc(db, "adminNotifications", n.id), {
        readBy: arrayUnion(readerKey),
      });
    });
    await batch.commit();
  } catch {
    /* ignore */
  }
}
