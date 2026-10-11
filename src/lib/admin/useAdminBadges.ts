"use client";

import { useEffect, useRef, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { subscribeAdminChatNotifications, type ChatNotification } from "@/lib/chatNotifications";
import { FILTERED_LINKS, navigateTo, type BadgeKey } from "@/lib/admin/nav";
import { toast } from "@/lib/admin/feedback";

export type AdminBadges = Record<BadgeKey, number> & { chatNotifications: ChatNotification[] };

const EMPTY: AdminBadges = {
  unreadChats: 0,
  pendingWorkers: 0,
  pendingExceptions: 0,
  pendingApprovals: 0,
  newSubmissions: 0,
  chatNotifications: [],
};

function playBeep() {
  if (typeof window === "undefined") return;
  try {
    const Ctx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
  } catch {
    /* ignore */
  }
}

const DESKTOP_KEY = "mft.desktopNotify";

export function desktopNotifySupported() {
  return typeof window !== "undefined" && "Notification" in window;
}

export function desktopNotifyEnabled() {
  return desktopNotifySupported() && Notification.permission === "granted" && localStorage.getItem(DESKTOP_KEY) === "1";
}

/** Ask for permission and remember the preference. Returns the final state. */
export async function setDesktopNotify(on: boolean): Promise<boolean> {
  if (!desktopNotifySupported()) return false;
  if (!on) {
    localStorage.setItem(DESKTOP_KEY, "0");
    return false;
  }
  const perm = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
  const ok = perm === "granted";
  localStorage.setItem(DESKTOP_KEY, ok ? "1" : "0");
  return ok;
}

const ALERT_COPY: Partial<Record<BadgeKey, { title: string; body: (n: number) => string; href: string }>> = {
  pendingWorkers: { title: "New worker registration", body: (n) => `${n} worker${n === 1 ? "" : "s"} awaiting approval`, href: FILTERED_LINKS.pendingWorkers },
  pendingExceptions: { title: "New exception request", body: (n) => `${n} late/absence request${n === 1 ? "" : "s"} pending`, href: FILTERED_LINKS.pendingExceptions },
  pendingApprovals: { title: "Task submitted for approval", body: (n) => `${n} task${n === 1 ? "" : "s"} waiting for review`, href: FILTERED_LINKS.pendingApprovals },
  newSubmissions: { title: "New client submission", body: (n) => `${n} new lead${n === 1 ? "" : "s"} in the inbox`, href: FILTERED_LINKS.newSubmissions },
  unreadChats: { title: "New task message", body: (n) => `${n} unread message${n === 1 ? "" : "s"}`, href: FILTERED_LINKS.unreadChats },
};

function notifyIncrease(key: BadgeKey, count: number) {
  const copy = ALERT_COPY[key];
  if (!copy) return;
  toast.info(copy.title, {
    description: copy.body(count),
    action: { label: "View", onClick: () => navigateTo(copy.href) },
  });
  if (desktopNotifyEnabled() && document.hidden) {
    try {
      const n = new Notification(`MFT · ${copy.title}`, { body: copy.body(count), tag: `mft-${key}` });
      n.onclick = () => {
        window.focus();
        navigateTo(copy.href);
        n.close();
      };
    } catch {
      /* ignore */
    }
  }
}

/** Live counters that power sidebar badges + the notification bell. */
export function useAdminBadges(enabled: boolean): AdminBadges {
  const [badges, setBadges] = useState<AdminBadges>(EMPTY);
  const prev = useRef<Partial<Record<BadgeKey, number>>>({});

  useEffect(() => {
    if (!enabled) return;
    const set = (patch: Partial<AdminBadges>) => setBadges((b) => ({ ...b, ...patch }));
    const unsubs: Array<() => void> = [];

    /** Update a counter and fire alerts when it grows (skips the initial load). */
    const track = (key: BadgeKey, count: number, extra?: Partial<AdminBadges>) => {
      const before = prev.current[key];
      if (before !== undefined && count > before) {
        if (key === "unreadChats") playBeep();
        notifyIncrease(key, count);
      }
      prev.current[key] = count;
      set({ [key]: count, ...extra } as Partial<AdminBadges>);
    };

    unsubs.push(
      subscribeAdminChatNotifications(db, (notifs) => {
        track("unreadChats", notifs.length, { chatNotifications: notifs });
      }),
    );

    const safe = (fn: () => () => void) => {
      try {
        unsubs.push(fn());
      } catch {
        /* ignore */
      }
    };

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

    return () => unsubs.forEach((u) => u());
  }, [enabled]);

  return badges;
}
