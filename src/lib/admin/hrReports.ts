import { sessionHours, type SessionLike } from "@/lib/admin/workTime";
import {
  POLICY_2026_SETTINGS_DEFAULTS,
  type Policy2026SettingsFields,
  type PermissionLedgerEntry,
  type CycleUsage,
  evaluateClockIn,
  evaluateEarlyLeave,
  isPolicy2026Active,
  payableOvertimeForDay,
  policyConfigFromSettings,
  requiredShiftEnd,
} from "@/lib/admin/hrPolicy2026";

export type HrDateRangeKey = "today" | "week" | "month" | "quarter" | "year" | "cycle" | "custom";

export interface WorkLocationItem {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radiusMeters: number; // e.g. 200
  active?: boolean;
}

export interface OfficeNetworkItem {
  id: string;
  name: string; // e.g. "راوتر المقر الرئيسي"
  ip: string; // e.g. "197.52.104.88" or "197.52.104.*"
  active?: boolean;
}

export interface HrSettings extends Policy2026SettingsFields {
  monthStartDay: number; // 1-28 (e.g. 21 for 21st to 20th cycle, 1 for calendar month)
  weekendDays: number[]; // [5, 6] (default: Friday, Saturday in Egypt)
  standardHours: number; // 8
  shiftStartTime: string; // e.g. "10:00" or "09:00"
  gracePeriodMinutes: number; // e.g. 30, 60 (late threshold 1)
  secondThresholdMinutes: number; // e.g. 120 (very late threshold 2)
  defaultHourlyRate: number; // 31.25 EGP
  overtimeMultiplier: number; // 1.5
  absencePenaltyMultiplier: number; // 2 (2x daily pay)
  workLocations?: WorkLocationItem[];
  enforceGeofence?: boolean;
  officeNetworks?: OfficeNetworkItem[];
  officePinEnabled?: boolean;
  officePinMode?: "daily_auto" | "fixed";
  officePinFixedCode?: string;
  officePinSalt?: string;
  officeDeviceAuthSecret?: string;
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
  workLocations: [],
  enforceGeofence: true,
  officeNetworks: [],
  officePinEnabled: true,
  officePinMode: "daily_auto",
  officePinFixedCode: "2026",
  officePinSalt: "mft_office_pin_2026",
  officeDeviceAuthSecret: "MFT-OFFICE-2026",
  // HR-POL-2026 (off until enabled from the Policies modal)
  ...POLICY_2026_SETTINGS_DEFAULTS,
};

function normalizeDigits(str: string): string {
  return str
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .trim();
}

export function getLocalYmdForPin(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function computeDailyOfficePin(
  settings?: Partial<HrSettings>,
  dateYmd: string = getLocalYmdForPin(),
): string {
  if (settings?.officePinMode === "fixed") {
    const fixed = normalizeDigits(settings?.officePinFixedCode || "");
    if (fixed.length >= 4) return fixed;
  }
  const salt = (settings?.officePinSalt || "mft_office_pin_2026").trim();
  const seed = `${dateYmd}::${salt}`;
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const pinNum = 1000 + (Math.abs(hash) % 9000);
  return String(pinNum);
}

export function normalizeIpString(raw: string | null | undefined): string {
  if (!raw) return "";
  const s = normalizeDigits(String(raw))
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "")
    .replace(/^https?:\/\//i, "")
    .replace(/^::ffff:/i, "")
    .trim()
    .toLowerCase();
  // Extract IPv4 or wildcard pattern if surrounded by text/brackets
  const ipv4Match = s.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.(?:\d{1,3}|\*))(?:\s*\/\s*(\d{1,2}))?/);
  if (ipv4Match && ipv4Match[1]) {
    if (ipv4Match[2] === "24") {
      const octets = ipv4Match[1].split(".");
      return `${octets[0]}.${octets[1]}.${octets[2]}.*`;
    }
    return ipv4Match[1];
  }
  return s.replace(/\/.*$/, "").replace(/[^\da-f:.*]/g, "");
}

export async function fetchAllClientPublicIps(): Promise<string[]> {
  const fetchWithTimeout = async (url: string, ms = 4000): Promise<Response> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      return await fetch(url, { cache: "no-store", signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  };

  const results = await Promise.allSettled([
    (async () => {
      const res = await fetchWithTimeout("https://api.ipify.org?format=json", 3800);
      if (!res.ok) return null;
      const data = (await res.json()) as { ip?: string };
      return normalizeIpString(data?.ip);
    })(),
    (async () => {
      const res = await fetchWithTimeout("https://ipv4.icanhazip.com", 3800);
      if (!res.ok) return null;
      const txt = await res.text();
      return normalizeIpString(txt);
    })(),
    (async () => {
      const res = await fetchWithTimeout("/api/client-ip", 3000);
      if (!res.ok) return null;
      const data = (await res.json()) as { ip?: string | null };
      return normalizeIpString(data?.ip);
    })(),
    (async () => {
      const res = await fetchWithTimeout("https://api64.ipify.org?format=json", 3800);
      if (!res.ok) return null;
      const data = (await res.json()) as { ip?: string };
      return normalizeIpString(data?.ip);
    })(),
  ]);

  const ips: string[] = [];
  for (const r of results) {
    if (r.status === "fulfilled" && r.value && !ips.includes(r.value)) {
      ips.push(r.value);
    }
  }
  return ips;
}

export async function fetchClientPublicIp(): Promise<string | null> {
  const ips = await fetchAllClientPublicIps();
  return ips[0] || null;
}

/**
 * Parses a Google Maps URL or raw "lat, lng" string into { lat, lng }.
 */
export function parseLocationCoordinates(input: string): { lat: number; lng: number } | null {
  const s = (input || "").trim();
  if (!s) return null;
  const patterns = [
    /@(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/,
    /[?&](?:q|ll|query|center)=(-?\d+\.\d+)\s*(?:,|%2C)\s*(-?\d+\.\d+)/i,
    /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/,
    /(-?\d{1,2}\.\d{3,})\s*[,،\s]\s*(-?\d{1,3}\.\d{3,})/,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m && m[1] && m[2]) {
      const lat = parseFloat(m[1]);
      const lng = parseFloat(m[2]);
      if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
        return { lat, lng };
      }
    }
  }
  return null;
}

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
  /** e.g. "reimbursement" when created by the reimbursement approval flow. */
  source?: string;
  reimbursementId?: string;
  createdAt?: unknown;
  createdBy?: string;
}

export type SessionForHr = SessionLike & {
  id?: string;
  workerId?: string;
  date?: string;
  loginTime?: { toDate: () => Date } | null;
  startTime?: { toDate: () => Date } | null;
  logoutTime?: { toDate: () => Date } | null;
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

  // Whole-minute comparison (HR-POL-2026 clause 1): 11:00:59 is on time, 11:01 is late.
  const shiftStartMin = Math.round(shiftStart * 60);
  const threshold1 = shiftStartMin + graceMins;
  const threshold2 = shiftStartMin + secondMins;

  const loginTime = session.loginTime.toDate();
  const loginMin = loginTime.getHours() * 60 + loginTime.getMinutes();
  let isLate = false;
  let latePenalty = 0;
  let attendanceStatus: "on-time" | "late" | "very-late" = "on-time";

  if (loginMin > threshold2) {
    isLate = true;
    latePenalty = WORK_POLICY.LATE_PENALTY_2; // 0.5 day
    attendanceStatus = "very-late";
  } else if (loginMin > threshold1) {
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
  allowances: number; // بدلات (includes approved reimbursements)
  manualBonuses: number; // مكافآت
  manualDeductions: number; // خصومات
  netPayable: number;
  totalPay: number; // Backward compatibility alias
  // ── HR-POL-2026 breakdown (0 when the policy does not apply) ──
  policyApplied: boolean;
  /** Overtime paid under the legacy flat multiplier (sessions before the effective date). */
  legacyOvertimePay: number;
  otDayHours: number;
  otNightHours: number;
  otDayPay: number;
  otNightPay: number;
  nightAllowance: number;
  /** Worked overtime minutes that were not covered by an approved request (unpaid). */
  unapprovedOtMinutes: number;
  permissionsUsed: number;
  permissionMinutesUsed: number;
  coveredLateCount: number;
  uncoveredLateCount: number;
  /** Early-leave minutes not covered by a permission. Unpaid (excluded from base pay). */
  shortfallMinutes: number;
  /** Always 0 under HR-POL-2026: unpaid minutes are already excluded from base pay. Kept for compatibility. */
  shortfallDeduction: number;
  reimbursements: number;
  /** Approved paid leave days (annual / sick / emergency / official) paid at standard daily pay. */
  paidLeaveDays: number;
  paidLeavePay: number;
  /** Approved unpaid leave days (exempted from 2x absence penalty, unpaid for the day itself). */
  unpaidLeaveDays: number;
};

export interface ApprovedOvertimeItem {
  date: string; // YYYY-MM-DD
  minutes: number;
}

function toJsDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  const t = v as { toDate?: () => Date };
  if (typeof t.toDate === "function") return t.toDate();
  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function holidayDateSet(holidays: (string | HolidayItem)[] | undefined): Set<string> {
  const set = new Set<string>();
  for (const h of holidays ?? []) {
    if (typeof h === "string") {
      set.add(h);
      continue;
    }
    if (!h.endDate || h.endDate === h.date) {
      set.add(h.date);
      continue;
    }
    const cur = new Date(h.date + "T12:00:00");
    const endD = new Date(h.endDate + "T12:00:00");
    while (cur <= endD) {
      set.add(cur.toISOString().split("T")[0]);
      cur.setDate(cur.getDate() + 1);
    }
  }
  return set;
}

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
    /** HR-POL-2026: this worker's `permissionLedger` entries (any status) for the period. */
    permissionLedger?: PermissionLedgerEntry[];
    /** HR-POL-2026: approved overtime requests (exceptionRequests type=overtime, status=approved). */
    approvedOvertime?: ApprovedOvertimeItem[];
    /**
     * Effective YYYY-MM-DD from which MFT counts expected workdays for this worker
     * (`worker.attendanceStartDate || worker.hireDate || createdAt`). Prevents false
     * absence penalties for days before the worker joined or onboarded onto MFT.
     */
    workerStartDate?: string | null;
    /** Approved total excused leave days in this period (subtracted from absentDays). */
    approvedLeaveDays?: number;
    /** Approved paid leave days (annual / sick / emergency / official) — paid at standard daily pay. */
    paidLeaveDays?: number;
    /** Approved unpaid leave days — exempted from 2x absence penalty, unpaid for the day itself. */
    unpaidLeaveDays?: number;
    /** When true, do not count future days after today as absent in an in-progress cycle. */
    capAtToday?: boolean;
  },
): PayrollComputed {
  const cfg = options?.settings ?? DEFAULT_HR_SETTINGS;
  const hr = hourlyRate > 0 ? hourlyRate : cfg.defaultHourlyRate || DEFAULT_HOURLY;
  const std = cfg.standardHours || WORK_POLICY.STANDARD_HOURS;
  const daysWorked = workerSessions.length;
  const totalHours = workerSessions.reduce((sum, s) => sum + sessionHours(s), 0);

  const pcfg = policyConfigFromSettings(cfg);
  const weekend = cfg.weekendDays ?? [5, 6];
  const holidaySet = holidayDateSet(options?.holidays);
  const ledger = options?.permissionLedger ?? [];
  const otByDate = new Map<string, number>();
  for (const o of options?.approvedOvertime ?? []) {
    if (!o.date || !(o.minutes > 0)) continue;
    otByDate.set(o.date, (otByDate.get(o.date) ?? 0) + o.minutes);
  }
  const ledgerFor = (date: string, kind: "late" | "early_leave") =>
    ledger.find((e) => e.date === date && e.kind === kind && e.status === "applied");

  let basePay = 0;
  let overtimeHours = 0;
  let legacyOvertimePay = 0;
  let lateDays = 0;
  let veryLateDays = 0;
  let totalLatePenaltyDays = 0;

  let policyApplied = false;
  let otDayMin = 0;
  let otNightMin = 0;
  let otDayPay = 0;
  let otNightPay = 0;
  let nightAllowance = 0;
  let unapprovedOtMinutes = 0;
  let coveredLateCount = 0;
  let uncoveredLateCount = 0;
  let shortfallMinutes = 0;
  // Permission quota consumed this period, re-verified from attendance + approved permission ledger.
  let runningUsage: CycleUsage = { count: 0, minutes: 0 };
  const consumedLedgerIds = new Set<string>();
  const activeCoveredEntries = ledger
    .filter((e) => e.status === "applied" && e.covered && (e.chargedMinutes || 0) > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  const consumeUnmatchedUpTo = (date: string, includeSameDayNonManual: boolean) => {
    for (const entry of activeCoveredEntries) {
      const key = `${entry.date}_${entry.kind}_${entry.id ?? ""}`;
      if (consumedLedgerIds.has(key)) continue;
      if (entry.kind === "manual") {
        if (entry.date <= date) {
          consumedLedgerIds.add(key);
          runningUsage = { count: runningUsage.count + 1, minutes: runningUsage.minutes + (entry.chargedMinutes || 0) };
        }
      } else if (includeSameDayNonManual ? entry.date <= date : entry.date < date) {
        consumedLedgerIds.add(key);
        runningUsage = { count: runningUsage.count + 1, minutes: runningUsage.minutes + (entry.chargedMinutes || 0) };
      }
    }
  };
  /** Legacy tier penalty (0.25 / 0.5 day) for a late clock-in, regardless of quota. */
  const fallbackDaysFor = (firstIn: Date) =>
    evaluateClockIn(firstIn, { count: pcfg.permissionMaxCount, minutes: 0 }, pcfg).fallbackPenaltyDays;

  const sorted = [...workerSessions].sort((a, b) =>
    (sessionDateYmd(a) ?? "").localeCompare(sessionDateYmd(b) ?? ""),
  );

  for (const s of sorted) {
    const h = sessionHours(s);
    const date = sessionDateYmd(s) ?? "";

    if (!isPolicy2026Active(cfg, date)) {
      // ── Legacy maths (kept unchanged for already-closed cycles) ──
      basePay += h * hr;
      const ot = Math.max(0, h - std);
      overtimeHours += ot;
      legacyOvertimePay += ot * hr * (cfg.overtimeMultiplier || WORK_POLICY.OVERTIME_MULTIPLIER);
      const policy = calculateAttendancePolicy(s, cfg);
      if (policy.attendanceStatus === "late") {
        lateDays++;
        totalLatePenaltyDays += policy.latePenalty;
      } else if (policy.attendanceStatus === "very-late") {
        veryLateDays++;
        totalLatePenaltyDays += policy.latePenalty;
      }
      continue;
    }

    // ── HR-POL-2026 ──
    policyApplied = true;
    consumeUnmatchedUpTo(date, false);
    const d = new Date(date + "T12:00:00");
    const isOffDay = weekend.includes(d.getDay()) || holidaySet.has(date);
    const firstIn = toJsDate(s.startTime) ?? toJsDate(s.loginTime);
    const lastOut = s.isActive ? null : toJsDate(s.logoutTime);
    const workedMin = Math.round(h * 60);

    // Off-day work is paid only through approved overtime (clause 4: prior assignment required).
    if (!isOffDay) {
      // Minutes covered by a permission are paid time (capped at the standard day).
      let permissionPaidMin = 0;

      if (firstIn) {
        const ev = evaluateClockIn(firstIn, runningUsage, pcfg);
        if (ev.status !== "on-time") {
          const lateEntry = ledgerFor(date, "late");
          const lateKey = lateEntry ? `${lateEntry.date}_${lateEntry.kind}_${lateEntry.id ?? ""}` : "";
          const alreadyConsumedLate = lateKey ? consumedLedgerIds.has(lateKey) : false;
          if (lateKey) consumedLedgerIds.add(lateKey);
          // 1. Admin-approved lateness excuse (chargedMinutes === 0, covered === true) → fully excused without consuming quota
          if (lateEntry && lateEntry.covered && lateEntry.source === "admin" && (lateEntry.chargedMinutes || 0) === 0) {
            coveredLateCount++;
            permissionPaidMin += ev.lateMinutes;
          }
          // 2. Admin-approved advance late permission (source === "admin", covered === true, chargedMinutes > 0)
          else if (lateEntry && lateEntry.covered && lateEntry.source === "admin") {
            if (!alreadyConsumedLate) {
              const charged = lateEntry.chargedMinutes || ev.chargedMinutes || 30;
              runningUsage = { count: runningUsage.count + 1, minutes: runningUsage.minutes + charged };
            }
            coveredLateCount++;
            permissionPaidMin += ev.lateMinutes;
          }
          // 3. Permission check — NEVER auto-count a permission unless approved (lateEntry.covered === true)
          else {
            const wantsPermission = Boolean(lateEntry?.covered);
            if (wantsPermission && ev.status === "late-covered") {
              coveredLateCount++;
              if (!alreadyConsumedLate) {
                runningUsage = ev.usageAfter;
              }
              permissionPaidMin += ev.lateMinutes;
            } else {
              const days = ev.status === "late-uncovered" ? ev.fallbackPenaltyDays : fallbackDaysFor(firstIn);
              uncoveredLateCount++;
              totalLatePenaltyDays += days;
              if (days >= 0.5) veryLateDays++;
              else lateDays++;
            }
          }
        }

        // Early leave: covered → those minutes are paid; uncovered → simply unpaid (no extra deduction).
        if (lastOut) {
          const reqEnd = requiredShiftEnd(firstIn, pcfg);
          const el = evaluateEarlyLeave(lastOut, reqEnd, runningUsage, pcfg);
          if (el.isEarly) {
            const earlyEntry = ledgerFor(date, "early_leave");
            const earlyKey = earlyEntry ? `${earlyEntry.date}_${earlyEntry.kind}_${earlyEntry.id ?? ""}` : "";
            const alreadyConsumedEarly = earlyKey ? consumedLedgerIds.has(earlyKey) : false;
            if (earlyKey) consumedLedgerIds.add(earlyKey);
            if (earlyEntry?.covered && (earlyEntry.source === "admin" || el.canUsePermission)) {
              if (!alreadyConsumedEarly) {
                const charged = earlyEntry.chargedMinutes || el.chargedMinutes || 30;
                runningUsage = { count: runningUsage.count + 1, minutes: runningUsage.minutes + charged };
              }
              permissionPaidMin += el.remainingMinutes;
            } else {
              shortfallMinutes += el.remainingMinutes;
            }
          }
        }
      }

      basePay += (Math.min(std * 60, workedMin + permissionPaidMin) / 60) * hr;
    }

    // Overtime → only approved minutes, split day 1.35x / night 1.70x.
    if (firstIn) {
      const approvedMin = otByDate.get(date) ?? 0;
      const ot = payableOvertimeForDay({
        firstClockIn: firstIn,
        lastClockOut: lastOut,
        workedMinutes: workedMin,
        approvedMinutes: approvedMin,
        isOffDay,
        hourlyRate: hr,
        cfg: pcfg,
      });
      otDayMin += ot.dayMinutes;
      otNightMin += ot.nightMinutes;
      otDayPay += ot.dayPay;
      otNightPay += ot.nightPay;
      nightAllowance += ot.nightAllowance;
      unapprovedOtMinutes += Math.max(0, ot.actualMinutes - ot.totalMinutes);
      overtimeHours += ot.totalMinutes / 60;
    }
  }
  consumeUnmatchedUpTo("9999-12-31", true);

  const paidLeaveDays = Math.max(0, options?.paidLeaveDays ?? 0);
  const unpaidLeaveDays = Math.max(0, options?.unpaidLeaveDays ?? 0);
  const paidLeavePay = paidLeaveDays * std * hr;
  basePay += paidLeavePay;

  const overtimePay = legacyOvertimePay + otDayPay + otNightPay + nightAllowance;
  // Unpaid early-leave minutes are already excluded from base pay, so nothing more is deducted.
  const shortfallDeduction = 0;

  const permissionsUsed = runningUsage.count;
  const permissionMinutesUsed = runningUsage.minutes;

  // Expected workdays excluding rest days, public holidays, days before worker onboarding, and future days
  let effStart = periodStart;
  if (options?.workerStartDate) {
    const ws = new Date(options.workerStartDate + "T00:00:00");
    if (!isNaN(ws.getTime()) && ws > effStart) effStart = ws;
  }
  let effEnd = periodEnd;
  if (options?.capAtToday) {
    const endToday = new Date();
    endToday.setHours(23, 59, 59, 999);
    if (endToday < effEnd) effEnd = endToday;
  }

  const expectedWorkDays =
    effStart <= effEnd
      ? getExpectedWorkDaysInPeriod(effStart, effEnd, {
          weekendDays: cfg.weekendDays,
          holidays: options?.holidays,
        })
      : 0;

  const totalExcusedLeave =
    options?.approvedLeaveDays != null
      ? Math.max(0, Math.round(options.approvedLeaveDays))
      : Math.max(0, Math.round(paidLeaveDays + unpaidLeaveDays));
  const absentDays = Math.max(0, expectedWorkDays - daysWorked - totalExcusedLeave);
  let absencePenalty = 0;
  if (absentDays > 0) {
    const mult = cfg.absencePenaltyMultiplier || 2;
    const penaltyDays = absentDays * mult;
    const penaltyHours = penaltyDays * (cfg.standardHours || 8);
    absencePenalty = penaltyHours * hr;
  }

  const totalLatePenaltyEgp = totalLatePenaltyDays * (cfg.standardHours || 8) * hr;

  // Factoring in salary advances, allowances, bonuses, and deductions
  let salaryAdvances = 0;
  let allowances = 0;
  let manualBonuses = 0;
  let manualDeductions = 0;
  let reimbursements = 0;

  if (options?.adjustments && options.adjustments.length > 0) {
    for (const adj of options.adjustments) {
      if (adj.status === "cancelled") continue;
      if (adj.type === "advance") {
        salaryAdvances += adj.amount;
      } else if (adj.type === "allowance") {
        allowances += adj.amount;
        if (adj.source === "reimbursement") reimbursements += adj.amount;
      } else if (adj.type === "bonus") {
        manualBonuses += adj.amount;
      } else if (adj.type === "deduction") {
        manualDeductions += adj.amount;
      }
    }
  }

  // Net payable calculation
  const grossPay = basePay + overtimePay + allowances + manualBonuses;
  const totalDeductions = absencePenalty + totalLatePenaltyEgp + shortfallDeduction + salaryAdvances + manualDeductions;
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
    policyApplied,
    legacyOvertimePay: Math.round(legacyOvertimePay),
    otDayHours: Math.round((otDayMin / 60) * 100) / 100,
    otNightHours: Math.round((otNightMin / 60) * 100) / 100,
    otDayPay: Math.round(otDayPay),
    otNightPay: Math.round(otNightPay),
    nightAllowance: Math.round(nightAllowance),
    unapprovedOtMinutes,
    permissionsUsed,
    permissionMinutesUsed,
    coveredLateCount,
    uncoveredLateCount,
    shortfallMinutes,
    shortfallDeduction: Math.round(shortfallDeduction),
    reimbursements: Math.round(reimbursements),
    paidLeaveDays,
    paidLeavePay: Math.round(paidLeavePay),
    unpaidLeaveDays,
  };
}

export function isLateTodayHtml(session: SessionForHr, settings: Partial<HrSettings> = DEFAULT_HR_SETTINGS): boolean {
  if (!session.loginTime?.toDate) return false;
  const login = session.loginTime.toDate();
  const loginMin = login.getHours() * 60 + login.getMinutes();
  const shiftStartMin = Math.round(parseHourStringToDecimal(settings.shiftStartTime, 10) * 60);
  const graceMins = settings.gracePeriodMinutes ?? 60;
  return loginMin > shiftStartMin + graceMins;
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

