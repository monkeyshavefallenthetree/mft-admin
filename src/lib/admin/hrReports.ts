import { sessionHours, type SessionLike } from "@/lib/admin/workTime";

export type HrDateRangeKey = "today" | "week" | "month" | "quarter" | "year";

export const WORK_POLICY = {
  WORK_START_TIME: 10,
  LATE_THRESHOLD_1: 11,
  LATE_THRESHOLD_2: 12,
  STANDARD_HOURS: 8,
  OVERTIME_MULTIPLIER: 1.5,
  LATE_PENALTY_1: 0.25,
  LATE_PENALTY_2: 0.5,
} as const;

export type SessionForHr = SessionLike & {
  id?: string;
  workerId?: string;
  date?: string;
  loginTime?: { toDate: () => Date } | null;
  createdAt?: { toDate: () => Date } | null;
  totalWorkTime?: number;
};

export function sessionDateYmd(s: SessionForHr): string | null {
  if (s.date && /^\d{4}-\d{2}-\d{2}/.test(s.date)) return s.date.slice(0, 10);
  if (s.loginTime?.toDate) return s.loginTime.toDate().toISOString().split("T")[0];
  if (s.createdAt?.toDate) return s.createdAt.toDate().toISOString().split("T")[0];
  return null;
}

/** HTML `getDateRange`: rolling window ending today. */
export function getHrDateRange(range: HrDateRangeKey): { start: Date; end: Date } {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date();
  switch (range) {
    case "today":
      start.setHours(0, 0, 0, 0);
      return { start, end };
    case "week":
      start.setDate(end.getDate() - 7);
      start.setHours(0, 0, 0, 0);
      return { start, end };
    case "month":
      start.setMonth(end.getMonth() - 1);
      start.setHours(0, 0, 0, 0);
      return { start, end };
    case "quarter":
      start.setMonth(end.getMonth() - 3);
      start.setHours(0, 0, 0, 0);
      return { start, end };
    case "year":
      start.setFullYear(end.getFullYear() - 1);
      start.setHours(0, 0, 0, 0);
      return { start, end };
    default:
      start.setHours(0, 0, 0, 0);
      return { start, end };
  }
}

export function getExpectedWorkDays(range: HrDateRangeKey): number {
  const days: Record<HrDateRangeKey, number> = {
    today: 1,
    week: 5,
    month: 22,
    quarter: 66,
    year: 252,
  };
  return days[range] ?? 1;
}

/** Weekdays only, excluding Fri/Sat (matches HTML Egypt weekend). */
export function getExpectedWorkDaysInPeriod(start: Date, end: Date): number {
  let workDays = 0;
  const d = new Date(start);
  d.setHours(12, 0, 0, 0);
  const endAt = new Date(end);
  endAt.setHours(12, 0, 0, 0);
  while (d <= endAt) {
    const dayOfWeek = d.getDay();
    if (dayOfWeek !== 5 && dayOfWeek !== 6) workDays++;
    d.setDate(d.getDate() + 1);
  }
  return workDays;
}

export function sessionInRange(s: SessionForHr, start: Date, end: Date): boolean {
  const ymd = sessionDateYmd(s);
  if (!ymd) return false;
  const mid = new Date(ymd + "T12:00:00");
  return mid >= start && mid <= end;
}

export function workerSessionsInRange(
  sessions: SessionForHr[],
  workerId: string,
  start: Date,
  end: Date,
): SessionForHr[] {
  return sessions.filter((s) => s.workerId === workerId && sessionInRange(s, start, end));
}

export function calculateAttendancePolicy(session: SessionForHr) {
  if (!session.loginTime?.toDate || session.totalWorkTime == null) {
    return {
      isLate: false,
      latePenalty: 0,
      attendanceStatus: "incomplete" as const,
    };
  }
  const loginTime = session.loginTime.toDate();
  const loginTimeDecimal = loginTime.getHours() + loginTime.getMinutes() / 60;
  let isLate = false;
  let latePenalty = 0;
  let attendanceStatus: "on-time" | "late" | "very-late" = "on-time";

  if (loginTimeDecimal >= WORK_POLICY.LATE_THRESHOLD_2) {
    isLate = true;
    latePenalty = WORK_POLICY.LATE_PENALTY_2;
    attendanceStatus = "very-late";
  } else if (loginTimeDecimal >= WORK_POLICY.LATE_THRESHOLD_1) {
    isLate = true;
    latePenalty = WORK_POLICY.LATE_PENALTY_1;
    attendanceStatus = "late";
  }

  const totalHours = session.totalWorkTime / (1000 * 60 * 60);
  return {
    isLate,
    latePenalty,
    attendanceStatus,
    totalHours: Math.round(totalHours * 100) / 100,
  };
}

export function productivityScore(
  expectedHoursPerDay: number,
  completedTasks: number,
  totalTasks: number,
  sessions: SessionForHr[],
): number {
  if (sessions.length === 0) return 0;
  const avgHours =
    sessions.reduce((sum, s) => sum + sessionHours(s), 0) / sessions.length;
  const exp = expectedHoursPerDay || 8;
  const taskCompletion = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 50;
  return Math.min(100, Math.round((avgHours / exp) * 70 + taskCompletion * 0.3));
}

export function performanceRating(score: number): string {
  if (score >= 90) return "Excellent";
  if (score >= 80) return "Good";
  if (score >= 70) return "Average";
  if (score >= 60) return "Below Average";
  return "Needs Improvement";
}

export function formatDepartment(dept: string | undefined): string {
  if (!dept) return "—";
  return dept
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function formatEmploymentType(type: string | undefined): string {
  if (!type) return "—";
  return type
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("-");
}

const DEFAULT_HOURLY = 31.25;

export type PayrollComputed = {
  daysWorked: number;
  totalHours: number;
  overtimeHours: number;
  hourlyRate: number;
  basePay: number;
  overtimePay: number;
  absencePenalty: number;
  lateDays: number;
  veryLateDays: number;
  totalLatePenaltyEgp: number;
  totalPay: number;
};

export function computePayrollForWorker(
  workerSessions: SessionForHr[],
  hourlyRate: number,
  periodStart: Date,
  periodEnd: Date,
): PayrollComputed {
  const hr = hourlyRate > 0 ? hourlyRate : DEFAULT_HOURLY;
  const daysWorked = workerSessions.length;
  const totalHours = workerSessions.reduce((sum, s) => sum + sessionHours(s), 0);

  const overtimeHours = workerSessions.reduce((sum, s) => {
    const h = sessionHours(s);
    return sum + Math.max(0, h - WORK_POLICY.STANDARD_HOURS);
  }, 0);
  const basePay = totalHours * hr;
  const overtimePay = overtimeHours * hr * WORK_POLICY.OVERTIME_MULTIPLIER;

  const expectedWorkDays = getExpectedWorkDaysInPeriod(periodStart, periodEnd);
  const absentDays = Math.max(0, expectedWorkDays - daysWorked);
  let absencePenalty = 0;
  if (absentDays > 0) {
    const penaltyDays = absentDays * 2;
    const penaltyHours = penaltyDays * 8;
    absencePenalty = penaltyHours * hr;
  }

  let lateDays = 0;
  let veryLateDays = 0;
  let totalLatePenaltyDays = 0;
  for (const s of workerSessions) {
    const policy = calculateAttendancePolicy(s);
    if (policy.attendanceStatus === "late") {
      lateDays++;
      totalLatePenaltyDays += policy.latePenalty;
    } else if (policy.attendanceStatus === "very-late") {
      veryLateDays++;
      totalLatePenaltyDays += policy.latePenalty;
    }
  }
  const totalLatePenaltyEgp = totalLatePenaltyDays * 8 * hr;
  const totalPay = basePay + overtimePay - absencePenalty - totalLatePenaltyEgp;

  return {
    daysWorked,
    totalHours: Math.round(totalHours * 10) / 10,
    overtimeHours: Math.round(overtimeHours * 10) / 10,
    hourlyRate: hr,
    basePay: Math.round(basePay),
    overtimePay: Math.round(overtimePay),
    absencePenalty: Math.round(absencePenalty),
    lateDays,
    veryLateDays,
    totalLatePenaltyEgp: Math.round(totalLatePenaltyEgp),
    totalPay: Math.round(totalPay),
  };
}

export function isLateTodayHtml(session: SessionForHr): boolean {
  if (!session.loginTime?.toDate) return false;
  const login = session.loginTime.toDate();
  const hour = login.getHours() + login.getMinutes() / 60;
  return hour >= WORK_POLICY.LATE_THRESHOLD_1;
}
