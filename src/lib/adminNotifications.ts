import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  getDoc,
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
  _hasPendingWrites?: boolean;
}

export interface AdminNotificationsSnapshotMeta {
  ready: boolean;
  fromCache: boolean;
}

function normalizeAdminRole(role: unknown): AdminRole | null {
  if (role === "account_manager") return "ops_admin";
  if (role === "super_admin" || role === "ops_admin" || role === "hr_admin") return role;
  return null;
}

export function getAdminNotificationCreatedMs(
  item: Pick<AdminNotificationDoc, "createdAt" | "_hasPendingWrites">,
): number | null {
  const raw = item.createdAt as unknown;
  if (raw && typeof raw === "object") {
    if ("toDate" in raw && typeof (raw as { toDate?: unknown }).toDate === "function") {
      const ms = (raw as { toDate: () => Date }).toDate().getTime();
      if (Number.isFinite(ms)) return ms;
    }
    if ("seconds" in raw && typeof (raw as { seconds?: unknown }).seconds === "number") {
      const rec = raw as { seconds: number; nanoseconds?: unknown };
      const nanos = typeof rec.nanoseconds === "number" ? rec.nanoseconds : 0;
      const ms = rec.seconds * 1000 + Math.floor(nanos / 1_000_000);
      if (Number.isFinite(ms)) return ms;
    }
  } else if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  return item._hasPendingWrites ? Date.now() : null;
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

type AdminSubRef = { collectionName: "adminPushSubscriptions" | "alerts"; docId: string };

async function pruneDeadAdminSubscriptions(
  db: Firestore,
  refsByEndpoint: Map<string, AdminSubRef[]>,
  goneEndpoints: string[],
): Promise<void> {
  if (goneEndpoints.length === 0) return;
  const goneSet = new Set(goneEndpoints);
  const uniqueDocs = new Map<string, AdminSubRef>();
  for (const ep of goneEndpoints) {
    for (const ref of refsByEndpoint.get(ep) ?? []) {
      uniqueDocs.set(`${ref.collectionName}/${ref.docId}`, ref);
    }
  }

  await Promise.all(
    Array.from(uniqueDocs.values()).map(async ({ collectionName, docId }) => {
      try {
        const ref = doc(db, collectionName, docId);
        const snap = await getDoc(ref);
        if (!snap.exists()) return;
        const data = snap.data();
        const existingList: StoredPushSubscription[] = Array.isArray(data.subscriptions)
          ? data.subscriptions
          : data.subscription
            ? [data.subscription as StoredPushSubscription]
            : [];
        const cleaned = existingList.filter(
          (s) => s && typeof s.endpoint === "string" && !goneSet.has(s.endpoint),
        );
        if (cleaned.length !== existingList.length) {
          await updateDoc(ref, {
            subscriptions: cleaned,
            subscription: cleaned[0] ?? null,
            updatedAt: serverTimestamp(),
          });
        }
      } catch (err) {
        console.warn("[AdminNotifications] failed pruning dead endpoint:", collectionName, docId, err);
      }
    }),
  );
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
    tag?: string;
    dedupe?: boolean;
    urgent?: boolean;
    requireInteraction?: boolean;
    delayMs?: number;
  },
): Promise<void> {
  const subMap = new Map<string, StoredPushSubscription>();
  const refsByEndpoint = new Map<string, AdminSubRef[]>();

  const collectDoc = (
    collectionName: "adminPushSubscriptions" | "alerts",
    docId: string,
    data: Record<string, unknown> | undefined,
  ) => {
    if (!data) return;
    // Honor excludeUid so an admin doesn't receive push self-spam for their own action
    if (
      opts.excludeUid &&
      (docId === opts.excludeUid ||
        docId === `admin_push_${opts.excludeUid}` ||
        data.uid === opts.excludeUid)
    ) {
      return;
    }

    const role = normalizeAdminRole(data.role);
    if (role && !opts.roles.includes(role)) return;

    const addSub = (s: StoredPushSubscription) => {
      subMap.set(s.endpoint, s);
      const list = refsByEndpoint.get(s.endpoint) ?? [];
      list.push({ collectionName, docId });
      refsByEndpoint.set(s.endpoint, list);
    };

    if (Array.isArray(data.subscriptions)) {
      for (const s of data.subscriptions) {
        if (s && typeof s.endpoint === "string" && s.keys?.p256dh && s.keys?.auth) {
          addSub(s as StoredPushSubscription);
        }
      }
    } else if (
      data.subscription &&
      typeof (data.subscription as StoredPushSubscription).endpoint === "string" &&
      (data.subscription as StoredPushSubscription).keys?.p256dh &&
      (data.subscription as StoredPushSubscription).keys?.auth
    ) {
      addSub(data.subscription as StoredPushSubscription);
    }
  };

  try {
    const snap = await getDocs(collection(db, "adminPushSubscriptions"));
    snap.forEach((d) => collectDoc("adminPushSubscriptions", d.id, d.data() as Record<string, unknown>));
  } catch {
    /* ignore */
  }

  try {
    const fallbackSnap = await getDocs(
      query(collection(db, "alerts"), where("type", "==", "admin_push_sub")),
    );
    fallbackSnap.forEach((d) => collectDoc("alerts", d.id, d.data() as Record<string, unknown>));
  } catch {
    /* ignore */
  }

  const allSubs = Array.from(subMap.values());
  if (allSubs.length === 0) return;

  try {
    const res = await fetch("/api/web-push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        subscriptions: allSubs,
        delayMs: opts.delayMs,
        payload: {
          title: opts.title,
          body: opts.body,
          url: opts.url || "/admin",
          taskId: opts.taskId,
          tag: opts.tag,
          dedupe: opts.dedupe,
          urgent: opts.urgent,
          requireInteraction: opts.requireInteraction !== false,
        },
      }),
    });
    if (res.ok) {
      const json = (await res.json()) as { goneEndpoints?: string[] };
      if (Array.isArray(json.goneEndpoints) && json.goneEndpoints.length > 0) {
        void pruneDeadAdminSubscriptions(db, refsByEndpoint, json.goneEndpoints);
      }
    }
  } catch (err) {
    console.warn("[AdminNotifications] Web push failed:", err);
  }
}

export async function notifyAdmins(db: Firestore, input: NotifyAdminsInput): Promise<void> {
  const normalizedInputRoles = input.targetRoles
    .map((r) => normalizeAdminRole(r))
    .filter((r): r is AdminRole => r !== null);
  const roles = Array.from(new Set<AdminRole>(["super_admin", ...normalizedInputRoles]));

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

  let createdId: string | null = null;
  try {
    const ref = await addDoc(collection(db, "adminNotifications"), payload);
    createdId = ref.id;
  } catch {
    try {
      const ref = await addDoc(collection(db, "alerts"), {
        ...payload,
        type: "schedule",
        isRead: false,
        hasPenalty: false,
        adminNotif: true,
      });
      createdId = ref.id;
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
    tag: createdId ? `mft-ev-${createdId}` : undefined,
    dedupe: Boolean(createdId),
    urgent: input.urgent,
    requireInteraction: true,
  });
}

export function subscribeAdminNotifications(
  db: Firestore,
  role: AdminRole,
  callback: (items: AdminNotificationDoc[], meta: AdminNotificationsSnapshotMeta) => void,
): Unsubscribe {
  const qPrimary =
    role === "super_admin"
      ? collection(db, "adminNotifications")
      : query(collection(db, "adminNotifications"), where("targetRoles", "array-contains", role));

  const qFallback = query(collection(db, "alerts"), where("adminNotif", "==", true));

  let primaryDocs: AdminNotificationDoc[] = [];
  let fallbackDocs: AdminNotificationDoc[] = [];
  let primaryReady = false;
  let fallbackReady = false;
  let primaryFromCache = true;
  let fallbackFromCache = true;

  const emitMerged = () => {
    // Wait until both listeners have resolved at least once so the consumer
    // never treats a partial/empty first emission as the baseline and blasts
    // historical alerts when the second listener arrives.
    const ready = primaryReady && fallbackReady;
    if (!ready) return;

    const map = new Map<string, AdminNotificationDoc>();
    for (const item of [...primaryDocs, ...fallbackDocs]) {
      const normalizedRoles = Array.isArray(item.targetRoles)
        ? item.targetRoles
            .map((r) => normalizeAdminRole(r))
            .filter((r): r is AdminRole => r !== null)
        : [];
      if (role !== "super_admin" && !normalizedRoles.includes(role)) continue;
      map.set(item.id, { ...item, targetRoles: normalizedRoles });
    }
    const list = Array.from(map.values())
      .sort((a, b) => {
        // Corrupt/legacy docs missing `createdAt` sort to 0 instead of Date.now()
        // so they never pin to the top or masquerade as live alerts.
        const ta = getAdminNotificationCreatedMs(a) ?? 0;
        const tb = getAdminNotificationCreatedMs(b) ?? 0;
        return tb - ta;
      })
      .slice(0, 40);
    callback(list, {
      ready: true,
      fromCache: primaryFromCache || fallbackFromCache,
    });
  };

  const unsub1 = onSnapshot(
    qPrimary,
    { includeMetadataChanges: true },
    (snap) => {
      primaryDocs = snap.docs.map(
        (d) =>
          ({
            id: d.id,
            ...d.data(),
            _sourceCollection: "adminNotifications",
            _hasPendingWrites: d.metadata.hasPendingWrites,
          }) as AdminNotificationDoc,
      );
      primaryReady = true;
      primaryFromCache = snap.metadata.fromCache;
      emitMerged();
    },
    () => {
      primaryDocs = [];
      primaryReady = true;
      primaryFromCache = false;
      emitMerged();
    },
  );

  const unsub2 = onSnapshot(
    qFallback,
    { includeMetadataChanges: true },
    (snap) => {
      fallbackDocs = snap.docs.map(
        (d) =>
          ({
            id: d.id,
            ...d.data(),
            _sourceCollection: "alerts",
            _hasPendingWrites: d.metadata.hasPendingWrites,
          }) as AdminNotificationDoc,
      );
      fallbackReady = true;
      fallbackFromCache = snap.metadata.fromCache;
      emitMerged();
    },
    () => {
      fallbackDocs = [];
      fallbackReady = true;
      fallbackFromCache = false;
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
