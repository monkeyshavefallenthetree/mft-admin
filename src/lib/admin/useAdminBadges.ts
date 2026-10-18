"use client";

import { useEffect, useRef, useState } from "react";
import { collection, doc, getDoc, onSnapshot, query, serverTimestamp, setDoc, where } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { subscribeAdminChatNotifications, type ChatNotification, type StoredPushSubscription } from "@/lib/chatNotifications";
import {
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

export async function syncAdminWebPush(): Promise<boolean> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return false;
  try {
    const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    if (!("PushManager" in window) || Notification.permission !== "granted") return false;

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const appServerKey = urlBase64ToUint8Array(DEFAULT_VAPID_PUBLIC_KEY);
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: appServerKey.buffer as ArrayBuffer,
      });
    }
    const u = auth.currentUser;
    const subJson = sub.toJSON();
    if (u && subJson.endpoint && subJson.keys?.p256dh && subJson.keys?.auth) {
      const role = getAdminRole(u.email);
      const entry: StoredPushSubscription = {
        endpoint: subJson.endpoint,
        expirationTime: subJson.expirationTime ?? null,
        keys: { p256dh: subJson.keys.p256dh, auth: subJson.keys.auth },
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 160) : "",
        createdAt: new Date().toISOString(),
      };
      const ref = doc(db, "adminPushSubscriptions", u.uid);
      const existingSnap = await getDoc(ref).catch(() => null);
      const existingList: StoredPushSubscription[] = Array.isArray(existingSnap?.data()?.subscriptions)
        ? existingSnap!.data()!.subscriptions
        : [];
      const filtered = existingList.filter((s) => s && typeof s.endpoint === "string" && s.endpoint !== entry.endpoint);
      const subscriptions = [entry, ...filtered].slice(0, 5);

      await setDoc(
        ref,
        {
          uid: u.uid,
          email: u.email ?? "",
          role,
          subscription: entry,
          subscriptions,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    }
    return true;
  } catch (err) {
    console.warn("[AdminWebPush] sync failed:", err);
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
  if (ok) {
    await syncAdminWebPush();
  }
  return ok;
}

const ALERT_COPY: Partial<Record<BadgeKey, { title: string; body: (n: number) => string; href: string }>> = {
  pendingWorkers: { title: "New worker registration", body: (n) => `${n} worker${n === 1 ? "" : "s"} awaiting approval`, href: FILTERED_LINKS.pendingWorkers },
  pendingExceptions: { title: "New exception request", body: (n) => `${n} late/absence request${n === 1 ? "" : "s"} pending`, href: FILTERED_LINKS.pendingExceptions },
  pendingApprovals: { title: "Task submitted for approval", body: (n) => `${n} task${n === 1 ? "" : "s"} waiting for review`, href: FILTERED_LINKS.pendingApprovals },
  newSubmissions: { title: "New client submission", body: (n) => `${n} new lead${n === 1 ? "" : "s"} in the inbox`, href: FILTERED_LINKS.newSubmissions },
  unreadChats: { title: "New message", body: (n) => `${n} unread message${n === 1 ? "" : "s"}`, href: FILTERED_LINKS.unreadChats },
  pendingReimbursements: { title: "Reimbursement claim", body: (n) => `${n} claim${n === 1 ? "" : "s"} awaiting review`, href: FILTERED_LINKS.pendingReimbursements },
};

async function showSwOrDesktopNotification(title: string, body: string, tag: string, href: string) {
  try {
    const reg = await navigator.serviceWorker?.getRegistration("/");
    if (reg?.active) {
      reg.active.postMessage({
        type: "SHOW_LOCAL_NOTIFICATION",
        payload: { title, body, tag, url: href },
      });
      return;
    }
    if (reg && typeof reg.showNotification === "function") {
      await reg.showNotification(title, {
        body,
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        tag,
        data: { url: href },
      });
      return;
    }
  } catch {
    /* fallback below */
  }
  try {
    const n = new Notification(title, { body, tag, icon: "/icons/icon-192.png" });
    n.onclick = () => {
      window.focus();
      navigateTo(href);
      n.close();
    };
  } catch {
    /* ignore */
  }
}

function notifyIncrease(key: BadgeKey, count: number) {
  const copy = ALERT_COPY[key];
  if (!copy) return;
  toast.info(copy.title, {
    description: copy.body(count),
    action: { label: "View", onClick: () => navigateTo(copy.href) },
  });
  if (desktopNotifyEnabled() && document.hidden) {
    void showSwOrDesktopNotification(`MFT · ${copy.title}`, copy.body(count), `mft-${key}`, copy.href);
  }
}

/** Live counters + role-scoped event feed that power sidebar badges + the notification bell. */
export function useAdminBadges(enabled: boolean, role: AdminRole = "super_admin"): AdminBadges {
  const [badges, setBadges] = useState<AdminBadges>(EMPTY);
  const prev = useRef<Partial<Record<BadgeKey, number>>>({});
  const seenNotifIds = useRef<Set<string> | null>(null);

  useEffect(() => {
    setBadges(EMPTY);
    prev.current = {};
    seenNotifIds.current = null;
    if (!enabled) return;

    initSoundUnlock();
    void syncAdminWebPush();

    const onSwMessage = (ev: MessageEvent) => {
      if (ev.data?.type === "MFT_NOTIFICATION_CLICK" && typeof ev.data.url === "string") {
        navigateTo(ev.data.url);
      }
    };
    navigator.serviceWorker?.addEventListener("message", onSwMessage);

    const canOps = role === "super_admin" || role === "ops_admin";
    const canHr = role === "super_admin" || role === "hr_admin";

    const set = (patch: Partial<AdminBadges>) => setBadges((b) => ({ ...b, ...patch }));
    const unsubs: Array<() => void> = [
      () => navigator.serviceWorker?.removeEventListener("message", onSwMessage),
    ];

    /** Update a counter and fire alerts + sound when it grows (skips the initial load). */
    const track = (key: BadgeKey, count: number, extra?: Partial<AdminBadges>) => {
      const before = prev.current[key];
      if (before !== undefined && count > before) {
        playAdminSound();
        notifyIncrease(key, count);
      }
      prev.current[key] = count;
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
      subscribeAdminNotifications(db, role, (items) => {
        const currentUid = auth.currentUser?.uid || auth.currentUser?.email || "admin";
        const unread = items.filter((n) => !Array.isArray(n.readBy) || !n.readBy.includes(currentUid));

        if (seenNotifIds.current === null) {
          seenNotifIds.current = new Set(items.map((i) => i.id));
        } else {
          for (const item of items) {
            if (!seenNotifIds.current.has(item.id)) {
              seenNotifIds.current.add(item.id);
              if (item.actorUid !== auth.currentUser?.uid) {
                playAdminSound();
                toast.info(item.title, {
                  description: item.body,
                  action: { label: "View", onClick: () => navigateTo(item.href) },
                });
                if (desktopNotifyEnabled()) {
                  void showSwOrDesktopNotification(item.title, item.body, `mft-ev-${item.id}`, item.href);
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
        subscribeAdminChatNotifications(db, (notifs) => {
          track("unreadChats", notifs.length, { chatNotifications: notifs });
        }),
      );
      safe(() =>
        onSnapshot(
          query(collection(db, "tasks"), where("status", "==", "pending-approval")),
          (s) => track("pendingApprovals", s.size),
          () => {},
        ),
      );
      safe(() =>
        onSnapshot(
          collection(db, "submissions"),
          (s) => {
            let n = 0;
            s.forEach((d) => {
              const st = d.data().status;
              if (!st || st === "new") n += 1;
            });
            track("newSubmissions", n);
          },
          () => {},
        ),
      );
    }

    if (canHr) {
      safe(() =>
        onSnapshot(
          query(collection(db, "workers"), where("status", "==", "pending")),
          (s) => track("pendingWorkers", s.size),
          () => {},
        ),
      );
      safe(() =>
        onSnapshot(
          query(collection(db, "exceptionRequests"), where("status", "==", "pending")),
          (s) => track("pendingExceptions", s.size),
          () => {},
        ),
      );
      safe(() =>
        onSnapshot(
          query(collection(db, "reimbursements"), where("stage", "in", ["pre_approval", "review"])),
          (s) => track("pendingReimbursements", s.size),
          () => {},
        ),
      );
    }

    return () => unsubs.forEach((u) => u());
  }, [enabled, role]);

  return badges;
}
