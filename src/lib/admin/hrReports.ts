import { sessionHours, type SessionLike } from "@/lib/admin/workTime";

export type HrDateRangeKey = "today" | "week" | "month" | "quarter" | "year" | "cycle" | "custom";

export interface HrSettings {
  monthStartDay: number; // 1-28 (e.g. 21 for 21st to 20th cycle, 1 for calendar month)
  weekendDays: number[]; // [5, 6] (default: Friday, Saturday in Egypt)
  standardHours: number; // 8
  shiftStartTime: string; // e.g. "10:00" or "09:00"
  gracePeriodMinutes: number; // e.g. 30, 60 (late threshold 1)
  secondThresholdMinutes: number; // e.g. 120 (very late threshold 2)
  defaultHourlyRate: number; // 31.25 EGP
  overtimeMultiplier: number; // 1.5
  absencePenaltyMultiplier: number; // 2 (2x daily pay)
}

export const DEFAULT_HR_SETTINGS: HrSettings = {
  monthStartDay: 21,
  weekendDays: [5, 6],
  standardHours: 8,
  shiftStartTime: "10:00",
  gracePeriodMinutes: 60, // 11:00 AM
  secondThresholdMinutes: 120, // 12:00 PM
  defaultHourlyRate: 31.25,
  overtimeMultiplier: 1.5,
  absencePenaltyMultiplier: 2,
};

export const WORK_POLICY = {
  WORK_START_TIME: 10,
  LATE_THRESHOLD_1: 11,
  LATE_THRESHOLD_2: 12,
  STANDARD_HOURS: 8,
  OVERTIME_MULTIPLIER: 1.5,
  LATE_PENALTY_1: 0.25,
  LATE_PENALTY_2: 0.5,
} as const;

export interface HolidayItem {
  id: string;
  name: string;
  date: string; // YYYY-MM-DD
  endDate?: string; // Optional multi-day end date
  type: "national" | "religious" | "company" | "special";
  isPaid: boolean;
  notes?: string;
  createdAt?: unknown;
  createdBy?: string;
}

export interface PayrollAdjustment {
  id: string;
  workerId: string;
  workerName?: string;
  type: "advance" | "allowance" | "bonus" | "deduction"; // سلفة / بدل / مكافأة / خصم
  amount: number; // EGP
  date: string; // YYYY-MM-DD
  reason: string;
  status?: "pending" | "applied" | "cancelled";
  createdAt?: unknown;
  createdBy?: string;
}

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

/**
 * Calculates start and end Date for a monthly payroll cycle based on `monthStartDay`.
 * For example: if monthStartDay = 21, and targetDate is Oct 11, cycle is Sep 21 - Oct 20.
 */
export function getPayrollCycleRange(
  targetDate: Date = new Date(),
  monthStartDay: number = 21,
): { start: Date; end: Date; label: string } {
  const d = new Date(targetDate);
  const day = d.getDate();
  const year = d.getFullYear();
  const month = d.getMonth();

  if (monthStartDay <= 1) {
    const start = new Date(year, month, 1, 0, 0, 0, 0);
    const end = new Date(year, month + 1, 0, 23, 59, 59, 999);
    const label = `${start.toLocaleDateString("en-US", { month: "short", year: "numeric" })} (1st–End)`;
    return { start, end, label };
  }

  let start: Date;
  let end: Date;

  if (day >= monthStartDay) {
    start = new Date(year, month, monthStartDay, 0, 0, 0, 0);
    end = new Date(year, month + 1, monthStartDay - 1, 23, 59, 59, 999);
  } else {
    start = new Date(year, month - 1, monthStartDay, 0, 0, 0, 0);
    end = new Date(year, month, monthStartDay - 1, 23, 59, 59, 999);
  }

  const label = `${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
  return { start, end, label };
}

/** Standard rolling window or payroll cycle range. */
export function getHrDateRange(
  range: HrDateRangeKey,
  settings: HrSettings = DEFAULT_HR_SETTINGS,
): { start: Date; end: Date } {
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
    case "cycle":
    case "month": {
      const cycle = getPayrollCycleRange(end, settings.monthStartDay);
      return { start: cycle.start, end: cycle.end };
    }
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
  const days: Record<string, number> = {
    today: 1,
    week: 5,
    cycle: 22,
    month: 22,
    quarter: 66,
    year: 252,
  };
  return days[range] ?? 1;
}

/**
 * Checks if a specific YYYY-MM-DD date falls on an official holiday.
 */
export function isDateHoliday(dateYmd: string, holidays: HolidayItem[]): HolidayItem | null {
  for (const h of holidays) {
    if (!h.endDate || h.endDate === h.date) {
      if (h.date === dateYmd) return h;
    } else {
      if (dateYmd >= h.date && dateYmd <= h.endDate) return h;
    }
  }
  return null;
}

/**
 * Calculates expected workdays in period, excluding configurable weekly rest days (Fri/Sat)
 * AND statutory official holidays so workers are not penalized for authorized off-days.
 */
export function getExpectedWorkDaysInPeriod(
  start: Date,
  end: Date,
  options?: {
    weekendDays?: number[];
    holidays?: (string | HolidayItem)[];
  },
): number {
  const weekend = options?.weekendDays ?? [5, 6];
  const holidayDates = new Set<string>();

  if (options?.holidays) {
    for (const item of options.holidays) {
      if (typeof item === "string") {
        holidayDates.add(item);
      } else {
        if (!item.endDate || item.endDate === item.date) {
          holidayDates.add(item.date);
        } else {
          const cur = new Date(item.date + "T12:00:00");
          const endD = new Date(item.endDate + "T12:00:00");
          while (cur <= endD) {
            holidayDates.add(cur.toISOString().split("T")[0]);
            cur.setDate(cur.getDate() + 1);
          }
        }
      }
    }
  }

  let workDays = 0;
  const d = new Date(start);
  d.setHours(12, 0, 0, 0);
  const endAt = new Date(end);
  endAt.setHours(12, 0, 0, 0);

  while (d <= endAt) {
    const dayOfWeek = d.getDay();
    const ymd = d.toISOString().split("T")[0];
    const isWeekend = weekend.includes(dayOfWeek);
    const isHoliday = holidayDates.has(ymd);

    if (!isWeekend && !isHoliday) {
      workDays++;
    }
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

/** Parses "10:00" or "09:30" string to decimal hours (e.g. 10.0 or 9.5). */
function parseHourStringToDecimal(val: string | number | undefined, defaultVal = 10): number {
  if (val == null) return defaultVal;
  if (typeof val === "number") return val;
  const parts = String(val).split(":");
  if (parts.length < 2) return parseFloat(val) || defaultVal;
  const h = parseInt(parts[0], 10) || 0;
  const m = parseInt(parts[1], 10) || 0;
  return h + m / 60;
}

/**
 * Calculates whether a session was on-time or late based on dynamic or default policies.
 */
export function calculateAttendancePolicy(session: SessionForHr, settings: Partial<HrSettings> = DEFAULT_HR_SETTINGS) {
  if (!session.loginTime?.toDate || session.totalWorkTime == null) {
    return {
      isLate: false,
      latePenalty: 0,
      attendanceStatus: "incomplete" as const,
      totalHours: 0,
    };
  }

  const shiftStart = parseHourStringToDecimal(settings.shiftStartTime, 10);
  const graceMins = settings.gracePeriodMinutes ?? 60;
  const secondMins = settings.secondThresholdMinutes ?? 120;

  const threshold1 = shiftStart + graceMins / 60;
  const threshold2 = shiftStart + secondMins / 60;

  const loginTime = session.loginTime.toDate();
  const loginTimeDecimal = loginTime.getHours() + loginTime.getMinutes() / 60;
  let isLate = false;
  let latePenalty = 0;
  let attendanceStatus: "on-time" | "late" | "very-late" = "on-time";

  if (loginTimeDecimal >= threshold2) {
    isLate = true;
    latePenalty = WORK_POLICY.LATE_PENALTY_2; // 0.5 day
    attendanceStatus = "very-late";
  } else if (loginTimeDecimal >= threshold1) {
    isLate = true;
    latePenalty = WORK_POLICY.LATE_PENALTY_1; // 0.25 day
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
  const avgHours = sessions.reduce((sum, s) => sum + sessionHours(s), 0) / sessions.length;
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
  absentDays: number;
  expectedWorkDays: number;
  lateDays: number;
  veryLateDays: number;
  totalLatePenaltyEgp: number;
  salaryAdvances: number; // سلف
  allowances: number; // بدلات
  manualBonuses: number; // مكافآت
  manualDeductions: number; // خصومات
  netPayable: number;
  totalPay: number; // Backward compatibility alias
};

export function computePayrollForWorker(
  workerSessions: SessionForHr[],
  hourlyRate: number,
  periodStart: Date,
  periodEnd: Date,
  options?: {
    weekendDays?: number[];
    holidays?: (string | HolidayItem)[];
    settings?: HrSettings;
    adjustments?: PayrollAdjustment[];
  },
): PayrollComputed {
  const cfg = options?.settings ?? DEFAULT_HR_SETTINGS;
  const hr = hourlyRate > 0 ? hourlyRate : cfg.defaultHourlyRate || DEFAULT_HOURLY;
  const daysWorked = workerSessions.length;
  const totalHours = workerSessions.reduce((sum, s) => sum + sessionHours(s), 0);

  const overtimeHours = workerSessions.reduce((sum, s) => {
    const h = sessionHours(s);
    return sum + Math.max(0, h - (cfg.standardHours || WORK_POLICY.STANDARD_HOURS));
  }, 0);

  const basePay = totalHours * hr;
  const overtimePay = overtimeHours * hr * (cfg.overtimeMultiplier || WORK_POLICY.OVERTIME_MULTIPLIER);

  // Expected workdays excluding rest days and public holidays
  const expectedWorkDays = getExpectedWorkDaysInPeriod(periodStart, periodEnd, {
    weekendDays: cfg.weekendDays,
    holidays: options?.holidays,
  });

  const absentDays = Math.max(0, expectedWorkDays - daysWorked);
  let absencePenalty = 0;
  if (absentDays > 0) {
    const mult = cfg.absencePenaltyMultiplier || 2;
    const penaltyDays = absentDays * mult;
    const penaltyHours = penaltyDays * (cfg.standardHours || 8);
    absencePenalty = penaltyHours * hr;
  }

  let lateDays = 0;
  let veryLateDays = 0;
  let totalLatePenaltyDays = 0;

  for (const s of workerSessions) {
    const policy = calculateAttendancePolicy(s, cfg);
    if (policy.attendanceStatus === "late") {
      lateDays++;
      totalLatePenaltyDays += policy.latePenalty;
    } else if (policy.attendanceStatus === "very-late") {
      veryLateDays++;
      totalLatePenaltyDays += policy.latePenalty;
    }
  }

  const totalLatePenaltyEgp = totalLatePenaltyDays * (cfg.standardHours || 8) * hr;

  // Factoring in salary advances, allowances, bonuses, and deductions
  let salaryAdvances = 0;
  let allowances = 0;
  let manualBonuses = 0;
  let manualDeductions = 0;

  if (options?.adjustments && options.adjustments.length > 0) {
    for (const adj of options.adjustments) {
      if (adj.type === "advance") {
        salaryAdvances += adj.amount;
      } else if (adj.type === "allowance") {
        allowances += adj.amount;
      } else if (adj.type === "bonus") {
        manualBonuses += adj.amount;
      } else if (adj.type === "deduction") {
        manualDeductions += adj.amount;
      }
    }
  }

  // Net payable calculation
  const grossPay = basePay + overtimePay + allowances + manualBonuses;
  const totalDeductions = absencePenalty + totalLatePenaltyEgp + salaryAdvances + manualDeductions;
  const netPayable = Math.round(grossPay - totalDeductions);

  return {
    daysWorked,
    totalHours: Math.round(totalHours * 10) / 10,
    overtimeHours: Math.round(overtimeHours * 10) / 10,
    hourlyRate: hr,
    basePay: Math.round(basePay),
    overtimePay: Math.round(overtimePay),
    absencePenalty: Math.round(absencePenalty),
    absentDays,
    expectedWorkDays,
    lateDays,
    veryLateDays,
    totalLatePenaltyEgp: Math.round(totalLatePenaltyEgp),
    salaryAdvances: Math.round(salaryAdvances),
    allowances: Math.round(allowances),
    manualBonuses: Math.round(manualBonuses),
    manualDeductions: Math.round(manualDeductions),
    netPayable,
    totalPay: netPayable,
  };
}

export function isLateTodayHtml(session: SessionForHr, settings: Partial<HrSettings> = DEFAULT_HR_SETTINGS): boolean {
  if (!session.loginTime?.toDate) return false;
  const login = session.loginTime.toDate();
  const hour = login.getHours() + login.getMinutes() / 60;
  const shiftStart = parseHourStringToDecimal(settings.shiftStartTime, 10);
  const graceMins = settings.gracePeriodMinutes ?? 60;
  return hour >= shiftStart + graceMins / 60;
}

/** Pre-defined Egyptian Public & Statutory Holidays Template */
export const EGYPTIAN_HOLIDAYS_TEMPLATE: Omit<HolidayItem, "id">[] = [
  { name: "Coptic Christmas Day", date: "2026-01-07", type: "religious", isPaid: true, notes: "Official national holiday" },
  { name: "Revolution & Police Day", date: "2026-01-25", type: "national", isPaid: true, notes: "25th of January National Day" },
  { name: "Eid Al-Fitr (Day 1)", date: "2026-03-20", endDate: "2026-03-22", type: "religious", isPaid: true, notes: "Eid Al-Fitr statutory holidays" },
  { name: "Sham El-Nessim", date: "2026-04-13", type: "national", isPaid: true, notes: "Spring Festival" },
  { name: "Sinai Liberation Day", date: "2026-04-25", type: "national", isPaid: true, notes: "Sinai Liberation Day" },
  { name: "Labor Day", date: "2026-05-01", type: "national", isPaid: true, notes: "International Workers' Day" },
  { name: "Arafat Day & Eid Al-Adha", date: "2026-05-26", endDate: "2026-05-29", type: "religious", isPaid: true, notes: "Eid Al-Adha statutory holidays" },
  { name: "Islamic New Year", date: "2026-06-16", type: "religious", isPaid: true, notes: "Hijri New Year" },
  { name: "30 June Revolution Day", date: "2026-06-30", type: "national", isPaid: true, notes: "National Revolution Day" },
  { name: "23 July Revolution Day", date: "2026-07-23", type: "national", isPaid: true, notes: "National Revolution Day" },
  { name: "Prophet's Birthday (Mawlid)", date: "2026-08-25", type: "religious", isPaid: true, notes: "Mawlid al-Nabi" },
  { name: "Armed Forces Day (6th of October)", date: "2026-10-06", type: "national", isPaid: true, notes: "Victory of 6th of October" },
];

