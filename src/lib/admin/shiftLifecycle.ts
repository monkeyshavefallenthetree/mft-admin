/**
 * Pure shift lifecycle & auto clock-out evaluator (zero Firestore / React imports).
 *
 * Shared contract across `mft-admin` (cron reconciler, live admin fallback, workTime)
 * and `mft-monkeys-main` (worker dashboard timer & resume reconciliation).
 *
 * Strict priority ordering guarantees that once a shift reaches its warning/end/overdue
 * window, the 2-hour check-in cycle is NEVER triggered (preventing the "+6h after shift"
 * 2-hour notification bug) and auto clock-out caps `logoutTime` & `totalWorkTime` cleanly.
 */

import {
  cairoEndOfDayMs,
  cairoMinutesOfDay,
  cairoYmd,
} from "./cairoTime";
import {
  POLICY_2026_DEFAULTS,
  parseHm,
  policyConfigFromSettings,
  requiredShiftEnd,
  type Policy2026Config,
  type Policy2026SettingsFields,
} from "./hrPolicy2026";

export const CHECKIN_CYCLE_MS = 2 * 60 * 60 * 1000; // 2 hours
export const CHECKIN_GRACE_MS = 10 * 60 * 1000; // 10 minutes before idle
export const CHECKIN_TRIGGER_MS = CHECKIN_CYCLE_MS - CHECKIN_GRACE_MS; // 1h 50m
export const SHIFT_WARNING_BEFORE_MS = 15 * 60 * 1000; // 15 minutes before shift end
export const DEFAULT_AUTO_CLOCK_OUT_GRACE_MS = 2 * 60 * 1000; // 2 minutes after shift end
export const MAX_ABSOLUTE_SHIFT_MS = 16 * 60 * 60 * 1000; // hard safety ceiling

export type ShiftDateLike =
  | Date
  | { toDate: () => Date }
  | { seconds: number; nanoseconds?: number }
  | string
  | number
  | null
  | undefined;

export interface ShiftSessionInput {
  id?: string;
  workerId?: string;
  workerName?: string;
  date?: string;
  isActive?: boolean;
  isExternalMission?: boolean;
  startTime?: ShiftDateLike;
  loginTime?: ShiftDateLike;
  segmentStartAt?: ShiftDateLike;
  lastLoginTime?: ShiftDateLike;
  logoutTime?: ShiftDateLike;
  endTime?: ShiftDateLike;
  lastUpdated?: ShiftDateLike;
  bankedWorkTime?: number;
  totalWorkTime?: number;
  standardHours?: number;
  overtimeMinutes?: number;
  allowedShiftMs?: number;
  presenceStatus?: "active" | "idle" | "offline" | string;
  lastActiveCheckAt?: ShiftDateLike;
  lastActiveCheckAtMs?: number | null;
  checkInNotifiedForAtMs?: number | null;
  idleNotifiedForAtMs?: number | null;
  shiftWarningNotifiedForMs?: number | null;
  shiftCompleteNotifiedForMs?: number | null;
  autoClockedOut?: boolean;
  autoClockOutReason?: "shift_limit_reached" | "past_day_unclosed" | string | null;
  autoClockedOutAt?: ShiftDateLike;
  autoClockOutNotifiedAt?: ShiftDateLike;
}

export interface EvaluateShiftOptions {
  nowMs?: number;
  todayCairoYmd?: string;
  standardHours?: number;
  /**
   * Authoritative admin-approved overtime minutes for this worker & date
   * (strictly from `exceptionRequests` where `type === "overtime"` and `status === "approved"`).
   * When omitted, defaults to `0` — never trusts raw `session.overtimeMinutes` or `session.allowedShiftMs`.
   */
  overtimeMinutes?: number;
  /** Grace window after `shiftLimitAtMs` before automatic clock-out triggers (default 2 min). */
  autoClockOutGraceMs?: number;
  /** HR settings / policy config for early-arrival shift end protection. */
  policySettings?: Policy2026SettingsFields | null;
}

export type ShiftLifecycleAction =
  | "inactive"
  | "auto_clock_out"
  | "shift_complete"
  | "shift_warning_15m"
  | "checkin_due"
  | "ok";

export type AutoClockOutReason = "shift_limit_reached" | "past_day_unclosed" | null;

export interface ShiftLifecycleResult {
  action: ShiftLifecycleAction;
  sessionYmd: string | null;
  firstClockInMs: number | null;
  segmentStartMs: number;
  priorBankedMs: number;
  standardHours: number;
  overtimeMinutes: number;
  allowedMs: number;
  rawElapsedMs: number;
  effectiveElapsedMs: number;
  shiftLimitAtMs: number;
  autoClockOutDeadlineMs: number;
  autoClockOutReason: AutoClockOutReason;
  cappedLogoutMs: number | null;
  cappedTotalWorkTimeMs: number | null;
  lastCheckInMs: number;
  checkInSecondsRemaining: number;
  shouldSendAutoClockOutPush: boolean;
  shouldSendShiftCompletePush: boolean;
  shouldSendWarningPush: boolean;
  shouldSendCheckInPush: boolean;
  shouldMarkIdle: boolean;
}

export function toMillisSafe(val: ShiftDateLike): number | null {
  if (val == null) return null;
  if (val instanceof Date) {
    const t = val.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof val === "number") {
    return Number.isFinite(val) && val > 0 ? val : null;
  }
  if (typeof val === "string") {
    const t = Date.parse(val);
    return Number.isFinite(t) ? t : null;
  }
  if (typeof val === "object") {
    if ("toDate" in val && typeof val.toDate === "function") {
      const d = val.toDate();
      if (d instanceof Date && Number.isFinite(d.getTime())) return d.getTime();
    }
    if ("seconds" in val && typeof val.seconds === "number" && Number.isFinite(val.seconds)) {
      const nanos = "nanoseconds" in val && typeof val.nanoseconds === "number" ? val.nanoseconds : 0;
      return val.seconds * 1000 + Math.floor(nanos / 1_000_000);
    }
  }
  return null;
}

export interface OvertimeExceptionLike {
  type?: string;
  status?: string;
  exceptionDate?: string;
  date?: string;
  lateMinutes?: number | null;
  overtimeMinutes?: number | null;
}

/**
 * Authoritative approved overtime minutes for a given Cairo date.
 * Strictly counts ONLY `type === "overtime"` with `status === "approved"`.
 * Pending or rejected requests ALWAYS contribute 0.
 */
export function resolveTodayOvertimeMinutes(
  dateYmd: string,
  exceptions: OvertimeExceptionLike[] | null | undefined,
): number {
  if (!dateYmd || !Array.isArray(exceptions)) return 0;
  let total = 0;
  for (const x of exceptions) {
    if (!x || x.type !== "overtime") continue;
    if (String(x.status || "") !== "approved") continue;
    const d = (x.exceptionDate || x.date || "").slice(0, 10);
    if (d !== dateYmd) continue;
    const mins = Number(x.lateMinutes ?? x.overtimeMinutes ?? 0);
    if (Number.isFinite(mins) && mins > 0) total += mins;
  }
  return total;
}

export function isMissionSession(session: Pick<ShiftSessionInput, "id" | "isExternalMission">): boolean {
  return Boolean(session.isExternalMission || (typeof session.id === "string" && session.id.startsWith("mission_")));
}

export function computeAllowedShiftMs(standardHours = 8, overtimeMinutes = 0): number {
  const std = Number.isFinite(standardHours) && standardHours > 0 ? Math.min(standardHours, 16) : 8;
  const ot = Number.isFinite(overtimeMinutes) && overtimeMinutes > 0 ? overtimeMinutes : 0;
  return Math.min(MAX_ABSOLUTE_SHIFT_MS, Math.round(std * 3_600_000 + ot * 60_000));
}

export function resolveSessionAnchors(
  session: ShiftSessionInput,
): {
  sessionYmd: string | null;
  firstClockInMs: number | null;
  segmentStartMs: number | null;
  priorBankedMs: number;
  storedMs: number;
} {
  const storedMs =
    typeof session.totalWorkTime === "number" && Number.isFinite(session.totalWorkTime)
      ? Math.max(0, session.totalWorkTime)
      : 0;
  const firstClockInMs = toMillisSafe(session.startTime) ?? toMillisSafe(session.loginTime);
  const sessionYmd =
    session.date && /^\d{4}-\d{2}-\d{2}/.test(session.date)
      ? session.date.slice(0, 10)
      : firstClockInMs != null
        ? cairoYmd(firstClockInMs)
        : null;

  const explicitSegStart = toMillisSafe(session.segmentStartAt);
  if (explicitSegStart != null) {
    const priorBankedMs =
      typeof session.bankedWorkTime === "number" && Number.isFinite(session.bankedWorkTime)
        ? Math.max(0, session.bankedWorkTime)
        : 0;
    return {
      sessionYmd,
      firstClockInMs,
      segmentStartMs: explicitSegStart,
      priorBankedMs,
      storedMs,
    };
  }

  // Legacy active session without explicit `segmentStartAt`
  const logoutMs = toMillisSafe(session.logoutTime) ?? toMillisSafe(session.endTime);
  const lastLoginMs = toMillisSafe(session.lastLoginTime);
  if (logoutMs == null && firstClockInMs != null) {
    return {
      sessionYmd,
      firstClockInMs,
      segmentStartMs: firstClockInMs,
      priorBankedMs: 0,
      storedMs,
    };
  }
  if (logoutMs != null && lastLoginMs != null && lastLoginMs >= logoutMs) {
    const lastUpdMs = toMillisSafe(session.lastUpdated) ?? lastLoginMs;
    const alreadyInSeg = Math.max(0, lastUpdMs - lastLoginMs);
    const priorBankedMs =
      typeof session.bankedWorkTime === "number" && Number.isFinite(session.bankedWorkTime)
        ? Math.max(0, session.bankedWorkTime)
        : Math.max(0, storedMs - alreadyInSeg);
    return {
      sessionYmd,
      firstClockInMs,
      segmentStartMs: lastLoginMs,
      priorBankedMs,
      storedMs,
    };
  }

  // Never fabricate segmentStartMs = nowMs when real clock-in timestamps are absent
  return {
    sessionYmd,
    firstClockInMs,
    segmentStartMs: firstClockInMs,
    priorBankedMs: storedMs,
    storedMs,
  };
}

export function computeShiftLimitAtMs(params: {
  firstClockInMs: number | null;
  segmentStartMs: number;
  priorBankedMs: number;
  allowedMs: number;
  overtimeMinutes: number;
  policySettings?: Policy2026SettingsFields | null;
}): number {
  const remainingAllowedMs = Math.max(0, params.allowedMs - params.priorBankedMs);
  const durationLimitMs = params.segmentStartMs + remainingAllowedMs;

  if (params.policySettings?.policy2026Enabled === false || params.firstClockInMs == null) {
    return durationLimitMs;
  }

  const pcfg: Policy2026Config = params.policySettings
    ? policyConfigFromSettings(params.policySettings)
    : POLICY_2026_DEFAULTS;
  const shiftStartMin = parseHm(pcfg.shiftStartTime);
  const clockInMin = cairoMinutesOfDay(params.firstClockInMs);

  // Early-arrival protection: if a worker clocked in before official shiftStartTime (e.g. 09:00),
  // HR-POL-2026 clamps requiredShiftEnd to 10:00 + standardHours = 18:00. Don't prematurely
  // auto-clock-out at 17:00 and cause a false early-leave penalty.
  if (clockInMin < shiftStartMin) {
    const policyEndMs =
      requiredShiftEnd(new Date(params.firstClockInMs), pcfg).getTime() +
      Math.max(0, params.overtimeMinutes) * 60_000;
    return Math.max(durationLimitMs, policyEndMs);
  }

  return durationLimitMs;
}

/**
 * Evaluates a shift session's exact lifecycle state at `nowMs`.
 *
 * Priority order:
 * 1. Past-day unclosed session (`session.date < todayCairoYmd`) → `auto_clock_out` (`past_day_unclosed`)
 * 2. Overdue active session (`nowMs >= shiftLimitAtMs + graceMs`) → `auto_clock_out` (`shift_limit_reached`)
 * 3. Shift limit reached (`shiftLimitAtMs <= nowMs < shiftLimitAtMs + graceMs`) → `shift_complete`
 * 4. Within 15m of shift limit (`shiftLimitAtMs - 15m <= nowMs < shiftLimitAtMs`) → `shift_warning_15m`
 * 5. Active 2-hour check-in window (ONLY when `nowMs < shiftLimitAtMs - 15m`) → `checkin_due`
 * 6. Otherwise → `ok`
 */
export function evaluateShiftLifecycle(
  session: ShiftSessionInput,
  opts: EvaluateShiftOptions = {},
): ShiftLifecycleResult {
  const nowMs = opts.nowMs ?? Date.now();
  const todayCairoYmd = opts.todayCairoYmd ?? cairoYmd(nowMs);
  const autoClockOutGraceMs =
    typeof opts.autoClockOutGraceMs === "number" && Number.isFinite(opts.autoClockOutGraceMs) && opts.autoClockOutGraceMs >= 0
      ? opts.autoClockOutGraceMs
      : DEFAULT_AUTO_CLOCK_OUT_GRACE_MS;

  const standardHours =
    typeof opts.standardHours === "number" && Number.isFinite(opts.standardHours) && opts.standardHours > 0
      ? opts.standardHours
      : typeof session.standardHours === "number" && Number.isFinite(session.standardHours) && session.standardHours > 0
        ? session.standardHours
        : typeof opts.policySettings?.standardHours === "number" && opts.policySettings.standardHours > 0
          ? opts.policySettings.standardHours
          : 8;

  const overtimeMinutes =
    typeof opts.overtimeMinutes === "number" && Number.isFinite(opts.overtimeMinutes)
      ? Math.max(0, opts.overtimeMinutes)
      : 0;

  const allowedMs = computeAllowedShiftMs(standardHours, overtimeMinutes);

  const anchors = resolveSessionAnchors(session);
  const validClockIn =
    Boolean(session.isActive) &&
    !isMissionSession(session) &&
    anchors.firstClockInMs != null &&
    anchors.segmentStartMs != null;

  const segStart = anchors.segmentStartMs ?? 0;
  const shiftLimitAtMs = validClockIn
    ? computeShiftLimitAtMs({
        firstClockInMs: anchors.firstClockInMs,
        segmentStartMs: segStart,
        priorBankedMs: anchors.priorBankedMs,
        allowedMs,
        overtimeMinutes,
        policySettings: opts.policySettings
          ? { ...opts.policySettings, standardHours }
          : { standardHours },
      })
    : 0;
  const autoClockOutDeadlineMs = validClockIn ? shiftLimitAtMs + autoClockOutGraceMs : 0;

  const rawElapsedMs = validClockIn
    ? anchors.priorBankedMs + Math.max(0, nowMs - segStart)
    : anchors.storedMs;
  const effectiveElapsedMs = validClockIn
    ? Math.min(rawElapsedMs, allowedMs)
    : Math.min(anchors.storedMs, allowedMs);

  const lastCheckInMs = validClockIn
    ? (typeof session.lastActiveCheckAtMs === "number" &&
      Number.isFinite(session.lastActiveCheckAtMs) &&
      session.lastActiveCheckAtMs > 0
        ? session.lastActiveCheckAtMs
        : null) ??
      toMillisSafe(session.lastActiveCheckAt) ??
      segStart
    : 0;

  const base: Omit<ShiftLifecycleResult, "action"> = {
    sessionYmd: anchors.sessionYmd,
    firstClockInMs: anchors.firstClockInMs,
    segmentStartMs: segStart,
    priorBankedMs: anchors.priorBankedMs,
    standardHours,
    overtimeMinutes,
    allowedMs,
    rawElapsedMs,
    effectiveElapsedMs,
    shiftLimitAtMs,
    autoClockOutDeadlineMs,
    autoClockOutReason: null,
    cappedLogoutMs: null,
    cappedTotalWorkTimeMs: null,
    lastCheckInMs,
    checkInSecondsRemaining: validClockIn
      ? Math.max(0, Math.ceil((lastCheckInMs + CHECKIN_CYCLE_MS - nowMs) / 1000))
      : 0,
    shouldSendAutoClockOutPush: false,
    shouldSendShiftCompletePush: false,
    shouldSendWarningPush: false,
    shouldSendCheckInPush: false,
    shouldMarkIdle: false,
  };

  if (!validClockIn) {
    return { ...base, action: "inactive" };
  }

  // Priority 1: Past-day unclosed session
  if (anchors.sessionYmd && anchors.sessionYmd < todayCairoYmd) {
    const endOfDayMs = cairoEndOfDayMs(anchors.sessionYmd);
    const boundedEndMs = Number.isFinite(endOfDayMs) ? Math.min(shiftLimitAtMs, endOfDayMs) : shiftLimitAtMs;
    const cappedLogoutMs = Math.max(segStart, boundedEndMs);
    const cappedTotalWorkTimeMs = Math.min(
      Math.max(anchors.priorBankedMs, anchors.priorBankedMs + Math.max(0, cappedLogoutMs - segStart)),
      allowedMs,
    );
    return {
      ...base,
      action: "auto_clock_out",
      effectiveElapsedMs: cappedTotalWorkTimeMs,
      autoClockOutReason: "past_day_unclosed",
      cappedLogoutMs,
      cappedTotalWorkTimeMs,
      shouldSendAutoClockOutPush: toMillisSafe(session.autoClockOutNotifiedAt) == null,
    };
  }

  // Priority 2: Overdue shift auto clock-out (strictly suppresses 2h check-in, warning & shift_complete)
  if (nowMs >= autoClockOutDeadlineMs) {
    const cappedLogoutMs = Math.max(segStart, shiftLimitAtMs);
    const cappedTotalWorkTimeMs = Math.min(
      Math.max(anchors.priorBankedMs, anchors.priorBankedMs + Math.max(0, cappedLogoutMs - segStart)),
      allowedMs,
    );
    return {
      ...base,
      action: "auto_clock_out",
      effectiveElapsedMs: cappedTotalWorkTimeMs,
      autoClockOutReason: "shift_limit_reached",
      cappedLogoutMs,
      cappedTotalWorkTimeMs,
      shouldSendAutoClockOutPush: toMillisSafe(session.autoClockOutNotifiedAt) == null,
    };
  }

  // Priority 3: Shift limit reached, within grace countdown window
  if (nowMs >= shiftLimitAtMs) {
    return {
      ...base,
      action: "shift_complete",
      shouldSendShiftCompletePush: session.shiftCompleteNotifiedForMs !== allowedMs,
    };
  }

  // Priority 4: 15-minute pre-shift-end warning (strictly suppresses 2h check-in)
  if (nowMs >= shiftLimitAtMs - SHIFT_WARNING_BEFORE_MS) {
    return {
      ...base,
      action: "shift_warning_15m",
      shouldSendWarningPush: session.shiftWarningNotifiedForMs !== allowedMs,
    };
  }

  // Priority 5: Active-shift 2-hour check-in cycle (ONLY while >15m remains before shift end)
  const elapsedSinceCheckIn = Math.max(0, nowMs - lastCheckInMs);
  if (elapsedSinceCheckIn >= CHECKIN_TRIGGER_MS) {
    const checkInSecondsRemaining = Math.max(
      0,
      Math.ceil((lastCheckInMs + CHECKIN_CYCLE_MS - nowMs) / 1000),
    );
    return {
      ...base,
      action: "checkin_due",
      checkInSecondsRemaining,
      shouldSendCheckInPush: session.checkInNotifiedForAtMs !== lastCheckInMs,
      shouldMarkIdle:
        checkInSecondsRemaining <= 0 &&
        session.presenceStatus !== "idle" &&
        session.idleNotifiedForAtMs !== lastCheckInMs,
    };
  }

  // Priority 6: Normal active shift
  return {
    ...base,
    action: "ok",
  };
}
