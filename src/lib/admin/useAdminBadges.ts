"use client";

import { useEffect, useRef, useState } from "react";
import { collection, doc, getDoc, onSnapshot, query, serverTimestamp, setDoc, where } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { subscribeAdminChatNotifications, type ChatNotification, type StoredPushSubscription } from "@/lib/chatNotifications";
import {
  getAdminNotificationCreatedMs,
  subscribeAdminNotifications,
  type AdminNotificationDoc,
} from "@/lib/adminNotifications";
import { FILTERED_LINKS, getAdminRole, navigateTo, type AdminRole, type BadgeKey } from "@/lib/admin/nav";
import { toast } from "@/lib/admin/feedback";
import { initSoundUnlock, playAdminSound } from "@/lib/admin/sound";

export type AdminBadges = Record<BadgeKey, number> & {
  chatNotifications: ChatNotification[];
  adminNotifications: AdminNotificationDoc[];
  unreadAdminNotifs: number;
};

const DEFAULT_VAPID_PUBLIC_KEY =
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ||
  "BC4qV_AA_NGWwJUuOf3I5pKrblvWSHOhhSdY-F0ENgdfzZ3tqFEGPG6HcIj0tv-i8yGkeJA5puekWty8rLH5KQM";

const ADMIN_LOCAL_SUB_KEY = "mft.admin.webPush.sub";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function uint8ArraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function subscriptionKeyMatches(sub: PushSubscription, expectedVapidKey: Uint8Array): boolean {
  try {
    const existing = sub.options?.applicationServerKey;
    if (!existing) return true; // Some browsers omit applicationServerKey on older subs
    return uint8ArraysEqual(new Uint8Array(existing), expectedVapidKey);
  } catch {
    return false;
  }
}

const EMPTY: AdminBadges = {
  unreadChats: 0,
  pendingWorkers: 0,
  pendingExceptions: 0,
  pendingApprovals: 0,
  newSubmissions: 0,
  pendingReimbursements: 0,
  chatNotifications: [],
  adminNotifications: [],
  unreadAdminNotifs: 0,
};

const DESKTOP_KEY = "mft.desktopNotify";

export function desktopNotifySupported() {
  return typeof window !== "undefined" && "Notification" in window;
}

export function desktopNotifyEnabled() {
  return (
    desktopNotifySupported() &&
    Notification.permission === "granted" &&
    localStorage.getItem(DESKTOP_KEY) !== "0"
  );
}

async function persistAdminPushSubscription(entry: StoredPushSubscription): Promise<boolean> {
  try {
    localStorage.setItem(ADMIN_LOCAL_SUB_KEY, JSON.stringify(entry));
  } catch {
    /* ignore */
  }

  const u = auth.currentUser;
  if (!u) return false;

  const role = getAdminRole(u.email);
  const fallbackRef = doc(db, "alerts", `admin_push_${u.uid}`);
  const primaryRef = doc(db, "adminPushSubscriptions", u.uid);
  const existingPrimary = await getDoc(primaryRef).catch(() => null);
  const existingFallback = await getDoc(fallbackRef).catch(() => null);
  const existingList: StoredPushSubscription[] = Array.isArray(existingPrimary?.data()?.subscriptions)
    ? existingPrimary!.data()!.subscriptions
    : Array.isArray(existingFallback?.data()?.subscriptions)
      ? existingFallback!.data()!.subscriptions
      : [];
  const filtered = existingList.filter(
    (s) => s && typeof s.endpoint === "string" && s.endpoint !== entry.endpoint,
  );
  const subscriptions = [entry, ...filtered].slice(0, 5);

  const docData = {
    uid: u.uid,
    email: u.email ?? "",
    role,
    subscription: entry,
    subscriptions,
    updatedAt: serverTimestamp(),
  };

  const [primaryRes, fallbackRes] = await Promise.allSettled([
    setDoc(primaryRef, docData, { merge: true }),
    setDoc(
      fallbackRef,
      {
        ...docData,
        type: "admin_push_sub",
        isRead: true,
        hasPenalty: false,
      },
      { merge: true },
    ),
  ]);

  if (primaryRes.status === "rejected" && fallbackRes.status === "rejected") {
    console.error("[AdminWebPush] Failed to persist subscription to Firestore:", primaryRes.reason, fallbackRes.reason);
    return false;
  }
  return true;
}

export async function syncAdminWebPush(): Promise<boolean> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return false;
  try {
    const reg = await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    });
    void reg.update().catch(() => {});
    await navigator.serviceWorker.ready;
    if (!("PushManager" in window) || Notification.permission !== "granted") return false;

    const appServerKey = urlBase64ToUint8Array(DEFAULT_VAPID_PUBLIC_KEY);
    let sub = await reg.pushManager.getSubscription();

    // Unsubscribe and re-subscribe if VAPID key rotated or subscription expired
    if (sub) {
      const expired = typeof sub.expirationTime === "number" && sub.expirationTime > 0 && sub.expirationTime <= Date.now();
      const keyMatches = subscriptionKeyMatches(sub, appServerKey);
      if (expired || !keyMatches) {
        await sub.unsubscribe().catch(() => {});
        sub = null;
      }
    }

    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: appServerKey.buffer as ArrayBuffer,
      });
    }

    const subJson = sub.toJSON();
    if (!subJson.endpoint || !subJson.keys?.p256dh || !subJson.keys?.auth) {
      return false;
    }

    const entry: StoredPushSubscription = {
      endpoint: subJson.endpoint,
      expirationTime: subJson.expirationTime ?? null,
      keys: { p256dh: subJson.keys.p256dh, auth: subJson.keys.auth },
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 160) : "",
      platform: typeof navigator !== "undefined" ? (navigator.platform || "").slice(0, 40) : "",
      createdAt: new Date().toISOString(),
    };

    const saved = await persistAdminPushSubscription(entry);
    return auth.currentUser ? saved : true;
  } catch (err) {
    console.warn("[AdminWebPush] sync failed:", err);
    return false;
  }
}

export async function testAdminLockScreenPush(): Promise<boolean> {
  const synced = await setDesktopNotify(true);
  if (!synced) return false;

  const subs: StoredPushSubscription[] = [];
  try {
    const raw = localStorage.getItem(ADMIN_LOCAL_SUB_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as StoredPushSubscription;
      if (parsed?.endpoint && parsed?.keys?.p256dh && parsed?.keys?.auth) {
        subs.push(parsed);
      }
    }
  } catch {
    /* ignore */
  }
  if (subs.length === 0) return false;
  try {
    const res = await fetch("/api/web-push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        subscriptions: subs,
        delayMs: 4000,
        payload: {
          title: "MFT Admin Lock Screen Alert 🔔",
          body: "Lock-screen & background push notifications are active on your device!",
          url: "/admin",
          tag: "mft-admin-test",
          dedupe: true,
          urgent: true,
          requireInteraction: true,
        },
      }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { sent?: number; goneEndpoints?: string[] };
    if (Array.isArray(data.goneEndpoints) && data.goneEndpoints.length > 0) {
      try {
        localStorage.removeItem(ADMIN_LOCAL_SUB_KEY);
      } catch {
        /* ignore */
      }
      void syncAdminWebPush();
      return false;
    }
    return (data.sent ?? 0) > 0;
  } catch {
    return false;
  }
}

/** Ask for permission, subscribe to Web Push, and remember the preference. Returns the final state. */
export async function setDesktopNotify(on: boolean): Promise<boolean> {
  if (!desktopNotifySupported()) return false;
  if (!on) {
    localStorage.setItem(DESKTOP_KEY, "0");
    return false;
  }
  const perm = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
  const ok = perm === "granted";
  localStorage.setItem(DESKTOP_KEY, ok ? "1" : "0");
  if (!ok) return false;
  if ("serviceWorker" in navigator && "PushManager" in window) {
    return await syncAdminWebPush();
  }
  return true;
}

const ALERT_COPY: Partial<Record<BadgeKey, { title: string; body: (n: number) => string; href: string }>> = {
  pendingWorkers: { title: "New worker registration", body: (n) => `${n} worker${n === 1 ? "" : "s"} awaiting approval`, href: FILTERED_LINKS.pendingWorkers },
  pendingExceptions: { title: "New exception request", body: (n) => `${n} late/absence request${n === 1 ? "" : "s"} pending`, href: FILTERED_LINKS.pendingExceptions },
  pendingApprovals: { title: "Task submitted for approval", body: (n) => `${n} task${n === 1 ? "" : "s"} waiting for review`, href: FILTERED_LINKS.pendingApprovals },
  newSubmissions: { title: "New client submission", body: (n) => `${n} new lead${n === 1 ? "" : "s"} in the inbox`, href: FILTERED_LINKS.newSubmissions },
  unreadChats: { title: "New message", body: (n) => `${n} unread message${n === 1 ? "" : "s"}`, href: FILTERED_LINKS.unreadChats },
  pendingReimbursements: { title: "Reimbursement claim", body: (n) => `${n} claim${n === 1 ? "" : "s"} awaiting review`, href: FILTERED_LINKS.pendingReimbursements },
};

async function showSwOrDesktopNotification(
  title: string,
  body: string,
  tag: string,
  href: string,
  dedupe = true,
) {
  const effectiveTag = dedupe ? tag : `${tag}-${Date.now()}`;
  try {
    const reg = await navigator.serviceWorker?.getRegistration("/");
    if (reg && typeof reg.showNotification === "function") {
      try {
        await reg.showNotification(title, {
          body,
          icon: "/icons/icon-192.png",
          badge: "/icons/icon-192.png",
          tag: effectiveTag,
          requireInteraction: true,
          silent: false,
          data: { url: href },
        });
        return;
      } catch {
        await reg.showNotification(title, {
          body,
          icon: "/icons/icon-192.png",
          tag: effectiveTag,
          data: { url: href },
        });
        return;
      }
    }
    if (reg?.active) {
      reg.active.postMessage({
        type: "SHOW_LOCAL_NOTIFICATION",
        payload: { title, body, tag: effectiveTag, dedupe, url: href, requireInteraction: true },
      });
      return;
    }
  } catch {
    /* fallback below */
  }
  try {
    const n = new Notification(title, { body, tag: effectiveTag, icon: "/icons/icon-192.png" });
    n.onclick = () => {
      window.focus();
      navigateTo(href);
      n.close();
    };
  } catch {
    /* ignore */
  }
}

function hasStoredWebPushSub(): boolean {
  try {
    return Boolean(localStorage.getItem(ADMIN_LOCAL_SUB_KEY));
  } catch {
    return false;
  }
}

function isTabHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

function notifyIncrease(key: BadgeKey, count: number) {
  const copy = ALERT_COPY[key];
  if (!copy) return;
  toast.info(copy.title, {
    description: copy.body(count),
    action: { label: "View", onClick: () => navigateTo(copy.href) },
  });
  // Only show local fallback OS notification when the tab is hidden AND Web Push
  // is not already subscribed on this device (avoids duplicate OS banners).
  if (desktopNotifyEnabled() && isTabHidden() && !hasStoredWebPushSub()) {
    void showSwOrDesktopNotification(`MFT · ${copy.title}`, copy.body(count), `mft-${key}`, copy.href, true);
  }
}

/** Live counters + role-scoped event feed that power sidebar badges + the notification bell. */
export function useAdminBadges(enabled: boolean, role: AdminRole = "super_admin"): AdminBadges {
  const scopeKey = enabled ? role : "__disabled__";
  const [scopedBadges, setScopedBadges] = useState<{ scope: string; data: AdminBadges }>({
    scope: scopeKey,
    data: EMPTY,
  });
  const badges = scopedBadges.scope === scopeKey ? scopedBadges.data : EMPTY;
  const prev = useRef<Partial<Record<BadgeKey, number>>>({});
  const seenNotifIds = useRef<Set<string> | null>(null);

  useEffect(() => {
    prev.current = {};
    seenNotifIds.current = null;
    if (!enabled) return;

    initSoundUnlock();
    void syncAdminWebPush();

    const onSwMessage = (ev: MessageEvent) => {
      if (ev.data?.type === "MFT_NOTIFICATION_CLICK" && typeof ev.data.url === "string") {
        navigateTo(ev.data.url);
      } else if (ev.data?.type === "MFT_PUSH_SUBSCRIPTION_CHANGED" && ev.data.subscription) {
        const subJson = ev.data.subscription as {
          endpoint?: string;
          expirationTime?: number | null;
          keys?: { p256dh?: string; auth?: string };
        };
        if (subJson.endpoint && subJson.keys?.p256dh && subJson.keys?.auth) {
          void persistAdminPushSubscription({
            endpoint: subJson.endpoint,
            expirationTime: subJson.expirationTime ?? null,
            keys: { p256dh: subJson.keys.p256dh, auth: subJson.keys.auth },
            userAgent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 160) : "",
            platform: typeof navigator !== "undefined" ? (navigator.platform || "").slice(0, 40) : "",
            createdAt: new Date().toISOString(),
          });
        }
      }
    };
    navigator.serviceWorker?.addEventListener("message", onSwMessage);

    const canOps = role === "super_admin" || role === "ops_admin";
    const canHr = role === "super_admin" || role === "hr_admin";

    const set = (patch: Partial<AdminBadges>) =>
      setScopedBadges((cur) => ({
        scope: scopeKey,
        data: { ...(cur.scope === scopeKey ? cur.data : EMPTY), ...patch },
      }));
    const unsubs: Array<() => void> = [
      () => navigator.serviceWorker?.removeEventListener("message", onSwMessage),
    ];

    const mountedAtMs = Date.now();
    const ALERT_RECENCY_WINDOW_MS = 120_000;

    /**
     * Update a counter for sidebar badges & bell queues. Only fire toast/sound/OS
     * alerts on settled server increments when `alertOnIncrease` is true (used for
     * queues not already emitted into `adminNotifications`, preventing duplicate alerts).
     */
    const track = (
      key: BadgeKey,
      count: number,
      extra?: Partial<AdminBadges>,
      fromCache = false,
      alertOnIncrease = false,
    ) => {
      const before = prev.current[key];
      if (!fromCache) {
        if (alertOnIncrease && before !== undefined && count > before) {
          playAdminSound();
          notifyIncrease(key, count);
        }
        prev.current[key] = count;
      }
      set({ [key]: count, ...extra } as Partial<AdminBadges>);
    };

    const safe = (fn: () => () => void) => {
      try {
        unsubs.push(fn());
      } catch {
        /* ignore */
      }
    };

    // Role-scoped real-time event stream (messages, projects, tasks started/claimed/submitted, new hires, excuses, HR events)
    safe(() =>
      subscribeAdminNotifications(db, role, (items, meta) => {
        const currentUid = auth.currentUser?.uid || auth.currentUser?.email || "admin";
        const unread = items.filter((n) => !Array.isArray(n.readBy) || !n.readBy.includes(currentUid));

        if (seenNotifIds.current === null) {
          // Wait for the first settled server snapshot before recording the baseline
          // so stale cache hydration never triggers false alerts.
          if (meta.ready && !meta.fromCache) {
            seenNotifIds.current = new Set(items.map((i) => i.id));
          }
        } else if (!meta.fromCache) {
          for (const item of items) {
            if (!seenNotifIds.current.has(item.id)) {
              seenNotifIds.current.add(item.id);
              const alreadyRead = Array.isArray(item.readBy) && item.readBy.includes(currentUid);
              const createdMs = getAdminNotificationCreatedMs(item);
              const isFresh = createdMs !== null && createdMs >= mountedAtMs - ALERT_RECENCY_WINDOW_MS;
              if (item.actorUid !== auth.currentUser?.uid && !alreadyRead && isFresh) {
                playAdminSound();
                toast.info(item.title, {
                  description: item.body,
                  action: { label: "View", onClick: () => navigateTo(item.href) },
                });
                // Skip local SW/desktop fallback when tab is visible (in-page toast is shown)
                // or when Web Push is already subscribed on this device (avoids duplicate OS alerts).
                if (desktopNotifyEnabled() && isTabHidden() && !hasStoredWebPushSub()) {
                  void showSwOrDesktopNotification(item.title, item.body, `mft-ev-${item.id}`, item.href, true);
                }
              }
            }
          }
        }

        set({
          adminNotifications: items,
          unreadAdminNotifs: unread.length,
        });
      }),
    );

    if (canOps) {
      unsubs.push(
        subscribeAdminChatNotifications(db, (notifs, meta) => {
          track("unreadChats", notifs.length, { chatNotifications: notifs }, Boolean(meta?.fromCache));
        }),
      );
      safe(() =>
        onSnapshot(
          query(collection(db, "tasks"), where("status", "==", "pending-approval")),
          (s) => track("pendingApprovals", s.size, undefined, s.metadata.fromCache),
          () => {},
        ),
      );
      safe(() =>
        onSnapshot(
          collection(db, "submissions"),
          { includeMetadataChanges: true },
          (s) => {
            let n = 0;
            s.forEach((d) => {
              const st = d.data().status;
              if (!st || st === "new") n += 1;
            });
            track("newSubmissions", n, undefined, s.metadata.fromCache, true);
          },
          () => {},
        ),
      );
    }

    if (canHr) {
      safe(() =>
        onSnapshot(
          query(collection(db, "workers"), where("status", "==", "pending")),
          (s) => track("pendingWorkers", s.size, undefined, s.metadata.fromCache),
          () => {},
        ),
      );
      safe(() =>
        onSnapshot(
          query(collection(db, "exceptionRequests"), where("status", "==", "pending")),
          (s) => track("pendingExceptions", s.size, undefined, s.metadata.fromCache),
          () => {},
        ),
      );
      safe(() =>
        onSnapshot(
          query(collection(db, "reimbursements"), where("stage", "in", ["pre_approval", "review"])),
          (s) => track("pendingReimbursements", s.size, undefined, s.metadata.fromCache),
          () => {},
        ),
      );

      // Live Admin Fallback Shift Watchdog: triggers server-side shift reconciliation every 60s
      // using the signed-in HR/Super Admin's Firebase ID token (throttled across tabs via localStorage)
      const RECONCILE_THROTTLE_KEY = "mft.admin.lastShiftReconcileMs";
      const runReconcile = async () => {
        try {
          if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
          const now = Date.now();
          try {
            const last = Number(localStorage.getItem(RECONCILE_THROTTLE_KEY) || "0");
            if (now - last < 45_000) return;
            localStorage.setItem(RECONCILE_THROTTLE_KEY, String(now));
          } catch {
            /* ignore storage errors */
          }
          const user = auth.currentUser;
          if (!user) return;
          const idToken = await user.getIdToken();
          await fetch("/api/cron/reconcile-shifts", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${idToken}`,
            },
          });
        } catch {
          /* non-fatal background reconciliation */
        }
      };
      const initialTimer = window.setTimeout(() => void runReconcile(), 5_000);
      const intervalId = window.setInterval(() => void runReconcile(), 60_000);
      unsubs.push(() => {
        window.clearTimeout(initialTimer);
        window.clearInterval(intervalId);
      });
    }

    return () => unsubs.forEach((u) => u());
  }, [enabled, role, scopeKey]);

  return badges;
}
