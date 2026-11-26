import { Timestamp } from "firebase/firestore";
import { cairoYmd } from "./cairoTime";
import {
  computeAllowedShiftMs,
  isMissionSession,
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
  /** Admin-approved overtime minutes for this worker+day. Strictly overrides any raw session field. */
  approvedOvertimeMinutes?: number;
  /** Legacy alias for `approvedOvertimeMinutes`. */
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
    typeof opts?.approvedOvertimeMinutes === "number" && Number.isFinite(opts.approvedOvertimeMinutes)
      ? Math.max(0, opts.approvedOvertimeMinutes)
      : typeof opts?.overtimeMinutes === "number" && Number.isFinite(opts.overtimeMinutes)
        ? Math.max(0, opts.overtimeMinutes)
        : 0;

  return computeAllowedShiftMs(std, ot);
}

/**
 * Returns the accurate work duration (ms) for a session, including live elapsed time
 * for today's currently active shifts (in `Africa/Cairo`). Both active AND closed regular
 * sessions are strictly capped at `standardHours + approvedOvertimeMinutes` so unapproved
 * overtime or unclosed shifts never inflate displayed or paid hours.
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

  if (isMissionSession(session)) {
    return storedMs;
  }

  if (!session.isActive) {
    return Math.min(storedMs, allowedMs);
  }

  const anchors = resolveSessionAnchors(session);
  const todayYmd = cairoYmd(nowMs);

  // Ghost active session with no real clock-in timestamp — never fabricate elapsed time
  if (anchors.segmentStartMs == null) {
    return Math.min(storedMs, allowedMs);
  }

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
