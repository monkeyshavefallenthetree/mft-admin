import { Timestamp } from "firebase/firestore";

type DateLike = Timestamp | Date | { toDate: () => Date } | string | number | null | undefined;

/** Firestore Timestamp or plain client read shape with `toDate`. */
export type SessionLike = {
  totalWorkTime?: number;
  bankedWorkTime?: number;
  date?: string;
  loginTime?: DateLike;
  startTime?: DateLike;
  segmentStartAt?: DateLike;
  lastLoginTime?: DateLike;
  logoutTime?: DateLike;
  lastUpdated?: DateLike;
  workerId?: string;
  workerName?: string;
  isActive?: boolean;
  isExternalMission?: boolean;
};

function toDateSafe(val: DateLike): Date | null {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  if (typeof val === "object" && "toDate" in val && typeof val.toDate === "function") {
    const d = val.toDate();
    return d instanceof Date && !isNaN(d.getTime()) ? d : null;
  }
  if (typeof val === "string" || typeof val === "number") {
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function localYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Returns the accurate work duration (ms) for a session, including live elapsed time
 * for today's currently active shifts even when the worker's phone screen is locked
 * or their browser background timer is throttled.
 */
export function effectiveSessionWorkMs(session: SessionLike, nowMs = Date.now()): number {
  const storedMs = typeof session.totalWorkTime === "number" ? Math.max(0, session.totalWorkTime) : 0;
  if (!session.isActive || session.isExternalMission) {
    return storedMs;
  }

  const startDate = toDateSafe(session.startTime) ?? toDateSafe(session.loginTime);
  const sessionYmd =
    session.date && /^\d{4}-\d{2}-\d{2}/.test(session.date)
      ? session.date.slice(0, 10)
      : startDate
        ? localYmd(startDate)
        : null;
  const todayYmd = localYmd(new Date(nowMs));

  // Never runaway-count an unclosed session from a past calendar day
  if (!sessionYmd || sessionYmd !== todayYmd) {
    return storedMs;
  }

  const MAX_SINGLE_DAY_MS = 16 * 60 * 60 * 1000;
  const explicitSegStart = toDateSafe(session.segmentStartAt);

  if (explicitSegStart) {
    const banked = typeof session.bankedWorkTime === "number" ? Math.max(0, session.bankedWorkTime) : 0;
    const liveMs = banked + Math.max(0, nowMs - explicitSegStart.getTime());
    return Math.max(storedMs, Math.min(liveMs, MAX_SINGLE_DAY_MS));
  }

  // Legacy active session today without explicit `segmentStartAt`
  const logoutDate = toDateSafe(session.logoutTime);
  const lastLoginDate = toDateSafe(session.lastLoginTime);
  if (!logoutDate && startDate) {
    const liveMs = Math.max(0, nowMs - startDate.getTime());
    return Math.max(storedMs, Math.min(liveMs, MAX_SINGLE_DAY_MS));
  }
  if (logoutDate && lastLoginDate && lastLoginDate.getTime() >= logoutDate.getTime()) {
    const lastUpd = toDateSafe(session.lastUpdated) ?? lastLoginDate;
    const alreadyInSeg = Math.max(0, lastUpd.getTime() - lastLoginDate.getTime());
    const banked =
      typeof session.bankedWorkTime === "number"
        ? Math.max(0, session.bankedWorkTime)
        : Math.max(0, storedMs - alreadyInSeg);
    const liveMs = banked + Math.max(0, nowMs - lastLoginDate.getTime());
    return Math.max(storedMs, Math.min(liveMs, MAX_SINGLE_DAY_MS));
  }

  return storedMs;
}

/** Sum effective work duration (ms) for sessions whose `date` is today (YYYY-MM-DD in local TZ). */
export function sumTodayWorkMs(sessions: SessionLike[], todayYmd: string, nowMs = Date.now()): number {
  let total = 0;
  for (const s of sessions) {
    if (s.date === todayYmd) {
      total += effectiveSessionWorkMs(s, nowMs);
    }
  }
  return total;
}

export function msToHoursLabel(ms: number): string {
  const h = Math.round((ms / (1000 * 60 * 60)) * 10) / 10;
  return `${h}h`;
}

export function sessionHours(session: SessionLike, nowMs = Date.now()): number {
  return effectiveSessionWorkMs(session, nowMs) / (1000 * 60 * 60);
}
