import { Timestamp } from "firebase/firestore";
import { cairoYmd } from "./cairoTime";
import {
  MAX_ABSOLUTE_SHIFT_MS,
  computeAllowedShiftMs,
  resolveSessionAnchors,
} from "./shiftLifecycle";

type DateLike =
  | Timestamp
  | Date
  | { toDate: () => Date }
  | { seconds: number; nanoseconds?: number }
  | string
  | number
  | null
  | undefined;

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
  endTime?: DateLike;
  lastUpdated?: DateLike;
  workerId?: string;
  workerName?: string;
  isActive?: boolean;
  isExternalMission?: boolean;
  standardHours?: number;
  overtimeMinutes?: number;
  allowedShiftMs?: number;
  autoClockedOut?: boolean;
  autoClockOutReason?: string | null;
  presenceStatus?: string;
  lastActiveCheckAt?: DateLike;
  lastActiveCheckAtMs?: number | null;
};

export interface EffectiveWorkTimeOptions {
  standardHours?: number;
  overtimeMinutes?: number;
}

function resolveAllowedMs(session: SessionLike, opts?: EffectiveWorkTimeOptions): number {
  const std =
    typeof opts?.standardHours === "number" && Number.isFinite(opts.standardHours) && opts.standardHours > 0
      ? opts.standardHours
      : typeof session.standardHours === "number" && Number.isFinite(session.standardHours) && session.standardHours > 0
        ? session.standardHours
        : 8;
  const ot =
    typeof opts?.overtimeMinutes === "number" && Number.isFinite(opts.overtimeMinutes)
      ? Math.max(0, opts.overtimeMinutes)
      : typeof session.overtimeMinutes === "number" && Number.isFinite(session.overtimeMinutes)
        ? Math.max(0, session.overtimeMinutes)
        : 0;

  if (opts?.standardHours !== undefined || opts?.overtimeMinutes !== undefined) {
    return computeAllowedShiftMs(std, ot);
  }
  if (
    typeof session.allowedShiftMs === "number" &&
    Number.isFinite(session.allowedShiftMs) &&
    session.allowedShiftMs > 0
  ) {
    return Math.min(MAX_ABSOLUTE_SHIFT_MS, session.allowedShiftMs);
  }
  return computeAllowedShiftMs(std, ot);
}

/**
 * Returns the accurate work duration (ms) for a session, including live elapsed time
 * for today's currently active shifts (in `Africa/Cairo`) capped cleanly to the worker's
 * allowed shift duration (`standardHours + overtimeMinutes`) so unclosed shifts never
 * runaway-inflate hours or create false overtime.
 */
export function effectiveSessionWorkMs(
  session: SessionLike,
  nowMs = Date.now(),
  opts?: EffectiveWorkTimeOptions,
): number {
  const storedMs =
    typeof session.totalWorkTime === "number" && Number.isFinite(session.totalWorkTime)
      ? Math.max(0, session.totalWorkTime)
      : 0;
  const allowedMs = resolveAllowedMs(session, opts);

  if (!session.isActive || session.isExternalMission) {
    if (session.autoClockedOut && !session.isExternalMission) {
      return Math.min(storedMs, allowedMs);
    }
    return storedMs;
  }

  const anchors = resolveSessionAnchors(session, nowMs);
  const todayYmd = cairoYmd(nowMs);

  // Never runaway-count an unclosed session from a past calendar day
  if (!anchors.sessionYmd || anchors.sessionYmd !== todayYmd) {
    return Math.min(storedMs, allowedMs);
  }

  const liveMs = anchors.priorBankedMs + Math.max(0, nowMs - anchors.segmentStartMs);
  return Math.min(Math.max(storedMs, liveMs), allowedMs);
}

/** Sum effective work duration (ms) for sessions whose `date` is today (`YYYY-MM-DD` in `Africa/Cairo`). */
export function sumTodayWorkMs(
  sessions: SessionLike[],
  todayYmd: string,
  nowMs = Date.now(),
  opts?: EffectiveWorkTimeOptions,
): number {
  let total = 0;
  for (const s of sessions) {
    if (s.date === todayYmd) {
      total += effectiveSessionWorkMs(s, nowMs, opts);
    }
  }
  return total;
}

export function msToHoursLabel(ms: number): string {
  const h = Math.round((ms / (1000 * 60 * 60)) * 10) / 10;
  return `${h}h`;
}

export function sessionHours(
  session: SessionLike,
  nowMs = Date.now(),
  opts?: EffectiveWorkTimeOptions,
): number {
  return effectiveSessionWorkMs(session, nowMs, opts) / (1000 * 60 * 60);
}
