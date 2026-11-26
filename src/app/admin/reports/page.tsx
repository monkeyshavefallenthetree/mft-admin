"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { downloadCsv } from "@/lib/admin/csv";
import { useUrlState } from "@/lib/admin/useUrlState";
import { logActivity } from "@/lib/admin/activity";
import { toast } from "@/lib/admin/feedback";
import { sessionHours } from "@/lib/admin/workTime";
import {
  CAIRO_TZ,
  addDaysToYmd,
  cairoDayOfWeek,
  cairoEndOfDayMs,
  cairoParts,
  cairoStartOfDayMs,
  cairoWallTimeToDate,
  cairoYmd,
  cairoYmdAtMinutes,
} from "@/lib/admin/cairoTime";
import { effectiveLeaveDaysForRequest } from "@/lib/admin/hrPolicy2026";
import {
  DEFAULT_HR_SETTINGS,
  calculateAttendancePolicy,
  computePayrollForWorker,
  formatDepartment,
  getExpectedWorkDaysInPeriod,
  sessionDateYmd,
  type HolidayItem,
  type HrSettings,
  type SessionForHr,
} from "@/lib/admin/hrReports";
import {
  mergeLedgerWithApprovedRequests,
  subscribeApprovedPolicyRequests,
  subscribeHolidays,
  subscribeHrSettings,
  subscribePermissionLedger,
  type ApprovedRequestRow,
  type PermissionLedgerDoc,
} from "@/lib/admin/hrSettings";
import { getAssigneeIds, parseDate } from "@/components/admin/projects/types";
import { EmptyState, PageHeader, Skeleton, STATE_ICONS } from "@/components/admin/ui/States";
import { ICONS } from "@/lib/admin/nav";
import { CellColumnTrend } from "@/components/admin/ui/CellColumnTrend";
import {
  ChartCard,
  DonutBreakdownChart,
  InteractiveAreaChart,
  InteractiveBarChart,
  KpiStatCard,
} from "@/components/admin/ui/Charts";

/* ───────────── Types ───────────── */

interface Worker {
  id: string;
  firstName?: string;
  lastName?: string;
  department?: string;
  role?: string;
  status?: string;
  hourlyRate?: number;
  hireDate?: string;
  attendanceStartDate?: string;
  createdAt?: { toDate?: () => Date };
}
interface Session extends SessionForHr {
  id: string;
  workerName?: string;
  department?: string;
  isLate?: boolean;
  attendanceStatus?: string;
}
interface Task {
  id: string;
  title?: string;
  status?: string;
  projectId?: string;
  projectName?: string;
  assignedTo?: string | string[];
  dueDate?: unknown;
  createdAt?: unknown;
  approvedAt?: unknown;
  updatedAt?: unknown;
}
interface Project {
  id: string;
  name?: string;
  clientName?: string;
  status?: string;
}
interface ExceptionReq {
  id: string;
  type?: string;
  status?: string;
  workerName?: string;
  createdAt?: unknown;
  submittedAt?: unknown;
  date?: string;
}
interface Penalty {
  id: string;
  type?: string;
  amount?: number;
  workerId?: string;
  date?: string;
  appliedAt?: unknown;
}

type RangeKey = "this-week" | "last-7" | "this-month" | "last-month" | "last-90" | "this-year" | "custom";

const RANGES: { key: RangeKey; label: string }[] = [
  { key: "this-week", label: "This week" },
  { key: "last-7", label: "Last 7 days" },
  { key: "this-month", label: "This month" },
  { key: "last-month", label: "Last month" },
  { key: "last-90", label: "Last 90 days" },
  { key: "this-year", label: "This year" },
  { key: "custom", label: "Custom" },
];

const DEPT_HEX = ["#dc2626", "#2563eb", "#059669", "#d97706", "#7c3aed", "#0284c7", "#52525b"];

/* ───────────── Helpers ───────────── */

function ymd(d: Date) {
  return cairoYmd(d);
}

function resolveRange(key: RangeKey, from: string, to: string): { start: Date; end: Date } {
  const now = new Date();
  const p = cairoParts(now);
  const todayStr = cairoYmd(now);
  let start = new Date(cairoStartOfDayMs(todayStr));
  let end = new Date(cairoEndOfDayMs(todayStr));

  switch (key) {
    case "this-week": {
      const dow = cairoDayOfWeek(todayStr);
      start = new Date(cairoStartOfDayMs(addDaysToYmd(todayStr, -dow)));
      break;
    }
    case "last-7":
      start = new Date(cairoStartOfDayMs(addDaysToYmd(todayStr, -6)));
      break;
    case "this-month":
      start = cairoWallTimeToDate(p.year, p.month, 1, 0, 0, 0, 0);
      break;
    case "last-month": {
      const prevYear = p.month === 1 ? p.year - 1 : p.year;
      const prevMonth = p.month === 1 ? 12 : p.month - 1;
      const lastDay = new Date(Date.UTC(prevYear, prevMonth, 0)).getUTCDate();
      start = cairoWallTimeToDate(prevYear, prevMonth, 1, 0, 0, 0, 0);
      end = cairoWallTimeToDate(prevYear, prevMonth, lastDay, 23, 59, 59, 999);
      break;
    }
    case "last-90":
      start = new Date(cairoStartOfDayMs(addDaysToYmd(todayStr, -89)));
      break;
    case "this-year":
      start = cairoWallTimeToDate(p.year, 1, 1, 0, 0, 0, 0);
      break;
    case "custom": {
      const fMs = from ? cairoStartOfDayMs(from) : NaN;
      const tMs = to ? cairoEndOfDayMs(to) : NaN;
      start = Number.isFinite(fMs)
        ? new Date(fMs)
        : new Date(cairoStartOfDayMs(addDaysToYmd(todayStr, -29)));
      if (Number.isFinite(tMs)) end = new Date(tMs);
      break;
    }
  }
  return { start, end };
}

function inRange(d: Date | null, start: Date, end: Date) {
  return !!d && d >= start && d <= end;
}

function sessionDate(s: Session): Date | null {
  const k = sessionDateYmd(s);
  return k ? cairoYmdAtMinutes(k, 12 * 60) : null;
}

function name(w?: Worker) {
  if (!w) return "Unknown";
  return `${w.firstName ?? ""} ${w.lastName ?? ""}`.trim() || "Unnamed";
}

function fmt(n: number, digits = 1) {
  return n.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

function egp(n: number) {
  return `${Math.round(n).toLocaleString()} EGP`;
}

type SortDir = "asc" | "desc";

/* ───────────── Small UI pieces ───────────── */

function Svg({ d, className = "h-4 w-4" }: { d: string; className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

const DOWNLOAD = "M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4";

function CsvButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-zinc-600 transition-colors hover:bg-zinc-50 hover:text-zinc-900 cursor-pointer"
    >
      <Svg d={DOWNLOAD} className="h-3.5 w-3.5" /> CSV
    </button>
  );
}

function SortTh<K extends string>({
  k,
  label,
  sort,
  setSort,
  align = "left",
}: {
  k: K;
  label: string;
  sort: { key: K; dir: SortDir };
  setSort: (s: { key: K; dir: SortDir }) => void;
  align?: "left" | "right";
}) {
  const active = sort.key === k;
  return (
    <th
      className={`px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      <button
        type="button"
        onClick={() => setSort({ key: k, dir: active && sort.dir === "desc" ? "asc" : "desc" })}
        className={`inline-flex items-center gap-1 transition-colors hover:text-zinc-900 cursor-pointer ${
          active ? "text-zinc-900" : ""
        }`}
      >
        {label}
        <span className={`text-[9px] ${active ? "opacity-100" : "opacity-0"}`}>
          {sort.dir === "desc" ? "▼" : "▲"}
        </span>
      </button>
    </th>
  );
}

/* ───────────── Page ───────────── */

type WorkerRowKey = "name" | "days" | "hours" | "overtime" | "late" | "absent" | "tasks" | "pay";

export default function ReportsPage() {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [exceptions, setExceptions] = useState<ExceptionReq[]>([]);
  const [penalties, setPenalties] = useState<Penalty[]>([]);
  const [hrSettings, setHrSettings] = useState<HrSettings>(DEFAULT_HR_SETTINGS);
  const [holidays, setHolidays] = useState<HolidayItem[]>([]);
  const [ledger, setLedger] = useState<PermissionLedgerDoc[]>([]);
  const [approvedRequests, setApprovedRequests] = useState<ApprovedRequestRow[]>([]);
  const [liveNowMs, setLiveNowMs] = useState(() => Date.now());
  const [loaded, setLoaded] = useState<Record<string, boolean>>({});

  const [rangeKey, setRangeKey] = useUrlState("range", "this-month");
  const [from, setFrom] = useUrlState("from");
  const [to, setTo] = useUrlState("to");
  const [dept, setDept] = useUrlState("dept");
  const [workerSearch, setWorkerSearch] = useState("");
  const [chartType, setChartType] = useState<"matrix" | "area" | "bar">("matrix");
  const [workerSort, setWorkerSort] = useState<{ key: WorkerRowKey; dir: SortDir }>({
    key: "hours",
    dir: "desc",
  });

  useEffect(() => {
    const sub = <T,>(col: string, set: (v: T[]) => void) =>
      onSnapshot(
        collection(db, col),
        (snap) => {
          set(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T));
          setLoaded((l) => ({ ...l, [col]: true }));
        },
        () => setLoaded((l) => ({ ...l, [col]: true })),
      );
    const unsubs = [
      sub<Worker>("workers", setWorkers),
      sub<Session>("workSessions", setSessions),
      sub<Task>("tasks", setTasks),
      sub<Project>("projects", setProjects),
      sub<ExceptionReq>("exceptionRequests", setExceptions),
      sub<Penalty>("penalties", setPenalties),
      subscribeHrSettings(setHrSettings),
      subscribeHolidays(setHolidays),
      subscribePermissionLedger(setLedger),
      subscribeApprovedPolicyRequests(setApprovedRequests),
    ];
    const tickId = window.setInterval(() => setLiveNowMs(Date.now()), 60_000);
    return () => {
      window.clearInterval(tickId);
      unsubs.forEach((u) => u());
    };
  }, []);

  const effectiveLedger = useMemo(
    () =>
      mergeLedgerWithApprovedRequests(
        ledger,
        approvedRequests,
        hrSettings.permissionMinMinutes ?? 30,
        hrSettings.permissionMaxSingleMinutes ?? 120,
      ),
    [ledger, approvedRequests, hrSettings.permissionMinMinutes, hrSettings.permissionMaxSingleMinutes],
  );
  const stdHours = hrSettings.standardHours || 8;

  const loading = !loaded.workers || !loaded.workSessions || !loaded.tasks;

  const { start, end } = useMemo(
    () => resolveRange(rangeKey as RangeKey, from, to),
    [rangeKey, from, to],
  );
  const rangeLabel = `${start.toLocaleDateString(undefined, {
    timeZone: CAIRO_TZ,
    month: "short",
    day: "numeric",
    year: "numeric",
  })} – ${end.toLocaleDateString(undefined, {
    timeZone: CAIRO_TZ,
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;

  const workerMap = useMemo(() => new Map(workers.map((w) => [w.id, w])), [workers]);
  const departments = useMemo(
    () => Array.from(new Set(workers.map((w) => w.department).filter(Boolean))) as string[],
    [workers],
  );

  const teamWorkers = useMemo(
    () => workers.filter((w) => w.status === "approved" && (!dept || w.department === dept)),
    [workers, dept],
  );

  const rangeSessions = useMemo(
    () =>
      sessions.filter((s) => {
        if (!inRange(sessionDate(s), start, end)) return false;
        if (dept) {
          const d = s.department ?? workerMap.get(s.workerId ?? "")?.department;
          if (d !== dept) return false;
        }
        return true;
      }),
    [sessions, start, end, dept, workerMap],
  );

  const completedInRange = useMemo(
    () =>
      tasks.filter((t) => {
        if (t.status !== "completed") return false;
        const d = parseDate(t.approvedAt) ?? parseDate(t.updatedAt) ?? parseDate(t.createdAt);
        if (!inRange(d, start, end)) return false;
        if (dept)
          return getAssigneeIds(t.assignedTo).some((id) => workerMap.get(id)?.department === dept);
        return true;
      }),
    [tasks, start, end, dept, workerMap],
  );

  const approvedOtByKey = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of approvedRequests) {
      if (r.type !== "overtime" || !r.workerId || !r.exceptionDate) continue;
      const mins = Number(r.lateMinutes ?? r.overtimeMinutes ?? 0) || 0;
      if (mins > 0) {
        const key = `${r.workerId}|${r.exceptionDate}`;
        map.set(key, (map.get(key) ?? 0) + mins);
      }
    }
    return map;
  }, [approvedRequests]);

  /* KPIs */
  const kpis = useMemo(() => {
    const otMinsFor = (x: Session) => {
      const dKey = sessionDateYmd(x);
      return x.workerId && dKey ? (approvedOtByKey.get(`${x.workerId}|${dKey}`) ?? 0) : 0;
    };
    const totalHours = rangeSessions.reduce(
      (s, x) => s + sessionHours(x, liveNowMs, { standardHours: stdHours, approvedOvertimeMinutes: otMinsFor(x) }),
      0,
    );
    const overtime = rangeSessions.reduce((s, x) => {
      if (x.isExternalMission) return s;
      const approvedOtMins = otMinsFor(x);
      if (approvedOtMins <= 0) return s;
      const h = sessionHours(x, liveNowMs, { standardHours: stdHours, approvedOvertimeMinutes: approvedOtMins });
      return s + Math.min(Math.max(0, h - stdHours), approvedOtMins / 60);
    }, 0);
    let late = 0;
    rangeSessions.forEach((s) => {
      const p = calculateAttendancePolicy(s, hrSettings, liveNowMs);
      if (p.isLate || s.isLate) late++;
    });
    const expectedDays = getExpectedWorkDaysInPeriod(start, end > new Date() ? new Date() : end, {
      weekendDays: hrSettings.weekendDays,
      holidays,
    });
    const expectedSessions = expectedDays * teamWorkers.length;
    const workerDays = new Set(rangeSessions.map((s) => `${s.workerId}|${sessionDateYmd(s)}`)).size;
    const attendance =
      expectedSessions > 0 ? Math.min(100, Math.round((workerDays / expectedSessions) * 100)) : 0;
    const avgPerDay = workerDays > 0 ? totalHours / workerDays : 0;
    return { totalHours, overtime, late, attendance, avgPerDay, workerDays, expectedDays };
  }, [rangeSessions, start, end, teamWorkers.length, hrSettings, holidays, liveNowMs, stdHours, approvedOtByKey]);

  /* Daily trend */
  const trend = useMemo(() => {
    const days: {
      key: string;
      label: string;
      hours: number;
      regular: number;
      overtime: number;
      late: number;
    }[] = [];
    const cursor = new Date(start);
    const last = end > new Date() ? new Date() : end;
    const totalDays = Math.round((last.getTime() - start.getTime()) / 86400000) + 1;
    const weekly = totalDays > 62;
    const buckets = new Map<string, { hours: number; overtime: number; late: number }>();
    rangeSessions.forEach((s) => {
      const d = sessionDate(s);
      if (!d) return;
      let key = ymd(d);
      if (weekly) {
        const w = new Date(d);
        w.setDate(d.getDate() - d.getDay());
        key = ymd(w);
      }
      const b = buckets.get(key) ?? { hours: 0, overtime: 0, late: 0 };
      const dKey = sessionDateYmd(s);
      const approvedOtMins = s.workerId && dKey ? (approvedOtByKey.get(`${s.workerId}|${dKey}`) ?? 0) : 0;
      const h = sessionHours(s, liveNowMs, { standardHours: stdHours, approvedOvertimeMinutes: approvedOtMins });
      b.hours += h;
      if (!s.isExternalMission && approvedOtMins > 0) {
        b.overtime += Math.min(Math.max(0, h - stdHours), approvedOtMins / 60);
      }
      if (calculateAttendancePolicy(s, hrSettings, liveNowMs).isLate || s.isLate) b.late++;
      buckets.set(key, b);
    });
    if (weekly) cursor.setDate(cursor.getDate() - cursor.getDay());
    let guard = 0;
    while (cursor <= last && guard < 400) {
      const key = ymd(cursor);
      const b = buckets.get(key) ?? { hours: 0, overtime: 0, late: 0 };
      const totalH = Math.round(b.hours * 10) / 10;
      const otH = Math.round(b.overtime * 10) / 10;
      days.push({
        key,
        label: weekly
          ? `Wk ${cursor.toLocaleDateString("en-US", { timeZone: CAIRO_TZ, month: "short", day: "numeric" })}`
          : cursor.toLocaleDateString("en-US", { timeZone: CAIRO_TZ, month: "short", day: "numeric" }),
        hours: totalH,
        regular: Math.round(Math.max(0, totalH - otH) * 10) / 10,
        overtime: otH,
        late: b.late,
      });
      cursor.setDate(cursor.getDate() + (weekly ? 7 : 1));
      guard++;
    }
    return { days, weekly };
  }, [rangeSessions, start, end, hrSettings, liveNowMs, stdHours, approvedOtByKey]);

  const trendAvg = useMemo(() => {
    const activeDays = trend.days.filter((d) => d.hours > 0);
    if (!activeDays.length) return 0;
    return Math.round((activeDays.reduce((a, d) => a + d.hours, 0) / activeDays.length) * 10) / 10;
  }, [trend.days]);

  /* Per-worker table */
  const workerRows = useMemo(() => {
    const payEnd = end > new Date() ? new Date() : end;
    const sYmd = cairoYmd(start);
    const eYmd = cairoYmd(payEnd);
    const wknd = hrSettings.weekendDays || [5, 6];
    const rows = teamWorkers.map((w) => {
      const ws = rangeSessions.filter((s) => s.workerId === w.id);
      const leaveReqs = approvedRequests.filter(
        (r) =>
          r.workerId === w.id &&
          (r.type === "annual_leave" ||
            r.type === "unpaid_leave" ||
            r.type === "sick_leave" ||
            r.type === "emergency_leave" ||
            r.type === "absence" ||
            r.type === "absent") &&
          r.exceptionDate >= sYmd &&
          r.exceptionDate <= eYmd,
      );
      const unpaidLeaveDays = leaveReqs
        .filter((r) => r.type === "unpaid_leave" || r.leaveType === "unpaid")
        .reduce((sum, r) => sum + effectiveLeaveDaysForRequest(r, wknd, holidays), 0);
      const paidLeaveDays = leaveReqs
        .filter((r) => r.type !== "unpaid_leave" && r.leaveType !== "unpaid")
        .reduce((sum, r) => sum + effectiveLeaveDaysForRequest(r, wknd, holidays), 0);
      const fallbackStart = w.createdAt?.toDate ? cairoYmd(w.createdAt.toDate()) : null;

      const pay = computePayrollForWorker(
        ws,
        Number(w.hourlyRate) || hrSettings.defaultHourlyRate || 0,
        start,
        payEnd,
        {
          weekendDays: hrSettings.weekendDays,
          holidays,
          settings: hrSettings,
          permissionLedger: effectiveLedger.filter(
            (l) => l.workerId === w.id && l.date >= sYmd && l.date <= eYmd,
          ),
          approvedOvertime: approvedRequests
            .filter(
              (r) =>
                r.workerId === w.id &&
                r.type === "overtime" &&
                r.exceptionDate >= sYmd &&
                r.exceptionDate <= eYmd,
            )
            .map((r) => ({ date: r.exceptionDate, minutes: Number(r.lateMinutes ?? r.overtimeMinutes ?? 0) || 0 })),
          approvedLeaveDays: paidLeaveDays + unpaidLeaveDays,
          paidLeaveDays,
          unpaidLeaveDays,
          workerStartDate: w.attendanceStartDate || w.hireDate || fallbackStart,
          capAtToday: true,
        },
      );
      const done = completedInRange.filter((t) => getAssigneeIds(t.assignedTo).includes(w.id)).length;
      return {
        id: w.id,
        name: name(w),
        dept: w.department,
        days: pay.daysWorked,
        hours: pay.totalHours,
        overtime: pay.overtimeHours,
        late: pay.lateDays + pay.veryLateDays,
        absent: pay.absentDays,
        tasks: done,
        pay: pay.totalPay,
        rate: pay.hourlyRate,
      };
    });
    const q = workerSearch.trim().toLowerCase();
    const filtered = q
      ? rows.filter(
          (r) =>
            r.name.toLowerCase().includes(q) ||
            formatDepartment(r.dept).toLowerCase().includes(q),
        )
      : rows;
    const dir = workerSort.dir === "asc" ? 1 : -1;
    return filtered.sort((a, b) => {
      const k = workerSort.key;
      if (k === "name") return a.name.localeCompare(b.name) * dir;
      return ((a[k] as number) - (b[k] as number)) * dir;
    });
  }, [
    teamWorkers,
    rangeSessions,
    completedInRange,
    start,
    end,
    workerSort,
    workerSearch,
    hrSettings,
    holidays,
    effectiveLedger,
    approvedRequests,
  ]);

  const maxHours = Math.max(1, ...workerRows.map((r) => r.hours));
  const totalPay = workerRows.reduce((s, r) => s + Math.max(0, r.pay), 0);

  /* Departments */
  const deptRows = useMemo(() => {
    const map = new Map<string, { hours: number; people: Set<string>; late: number }>();
    rangeSessions.forEach((s) => {
      const d = s.department ?? workerMap.get(s.workerId ?? "")?.department ?? "unassigned";
      const r = map.get(d) ?? { hours: 0, people: new Set<string>(), late: 0 };
      const dKey = sessionDateYmd(s);
      const approvedOtMins = s.workerId && dKey ? (approvedOtByKey.get(`${s.workerId}|${dKey}`) ?? 0) : 0;
      r.hours += sessionHours(s, liveNowMs, { standardHours: stdHours, approvedOvertimeMinutes: approvedOtMins });
      if (s.workerId) r.people.add(s.workerId);
      if (calculateAttendancePolicy(s, hrSettings, liveNowMs).isLate || s.isLate) r.late++;
      map.set(d, r);
    });
    return Array.from(map.entries())
      .map(([d, r], i) => ({
        dept: d,
        label: formatDepartment(d),
        hours: Math.round(r.hours * 10) / 10,
        people: r.people.size,
        late: r.late,
        color: DEPT_HEX[i % DEPT_HEX.length],
      }))
      .sort((a, b) => b.hours - a.hours);
  }, [rangeSessions, workerMap, hrSettings, liveNowMs, stdHours, approvedOtByKey]);

  /* Projects */
  const projectRows = useMemo(() => {
    const now = new Date();
    return projects
      .map((p) => {
        const pt = tasks.filter((t) => t.projectId === p.id);
        const done = pt.filter((t) => t.status === "completed").length;
        const doneInRange = completedInRange.filter((t) => t.projectId === p.id).length;
        const overdue = pt.filter(
          (t) => t.status !== "completed" && (parseDate(t.dueDate)?.getTime() ?? Infinity) < now.getTime(),
        ).length;
        const review = pt.filter((t) => t.status === "pending-approval").length;
        return {
          id: p.id,
          name: p.name ?? "Untitled",
          client: p.clientName,
          status: p.status ?? "active",
          total: pt.length,
          done,
          doneInRange,
          overdue,
          review,
          pct: pt.length ? Math.round((done / pt.length) * 100) : 0,
        };
      })
      .filter((p) => p.total > 0 || p.status === "active")
      .sort((a, b) => b.doneInRange - a.doneInRange || b.total - a.total);
  }, [projects, tasks, completedInRange]);

  /* Exceptions + penalties */
  const exceptionStats = useMemo(() => {
    const list = exceptions.filter((e) =>
      inRange(
        parseDate(e.createdAt) ??
          parseDate(e.submittedAt) ??
          (e.date ? new Date(e.date + "T12:00:00") : null),
        start,
        end,
      ),
    );
    const by = (k: "type" | "status") =>
      list.reduce<Record<string, number>>((acc, e) => {
        const v = (e[k] as string) || "other";
        acc[v] = (acc[v] ?? 0) + 1;
        return acc;
      }, {});
    return { total: list.length, byType: by("type"), byStatus: by("status") };
  }, [exceptions, start, end]);

  const penaltyStats = useMemo(() => {
    let penaltiesTotal = 0;
    let bonusTotal = 0;
    let count = 0;
    penalties.forEach((p) => {
      const d = parseDate(p.appliedAt) ?? (p.date ? new Date(p.date + "T12:00:00") : null);
      if (!inRange(d, start, end)) return;
      if (dept && workerMap.get(p.workerId ?? "")?.department !== dept) return;
      count++;
      const amt = Math.abs(Number(p.amount) || 0);
      if ((p.type || "").toLowerCase().includes("bonus")) bonusTotal += amt;
      else penaltiesTotal += amt;
    });
    return { penaltiesTotal, bonusTotal, count };
  }, [penalties, start, end, dept, workerMap]);

  /* Exports */
  const stamp = `${ymd(start)}_to_${ymd(end)}`;
  const exportWorkers = () => {
    downloadCsv(
      [
        [
          "Worker",
          "Department",
          "Days worked",
          "Hours",
          "Overtime hours",
          "Late days",
          "Absent days",
          "Tasks completed",
          "Hourly rate",
          "Estimated pay (EGP)",
        ],
        ...workerRows.map((r) => [
          r.name,
          formatDepartment(r.dept),
          r.days,
          r.hours,
          r.overtime,
          r.late,
          r.absent,
          r.tasks,
          r.rate,
          r.pay,
        ]),
      ],
      `team-report_${stamp}.csv`,
    );
    void logActivity({
      action: "exported",
      entity: "hr",
      label: "Team hours & payroll report",
      detail: rangeLabel,
    });
    toast.success("Team report exported");
  };
  const exportProjects = () => {
    downloadCsv(
      [
        [
          "Project",
          "Client",
          "Status",
          "Total tasks",
          "Completed",
          "Completed in period",
          "In review",
          "Overdue",
          "Progress %",
        ],
        ...projectRows.map((p) => [
          p.name,
          p.client ?? "",
          p.status,
          p.total,
          p.done,
          p.doneInRange,
          p.review,
          p.overdue,
          p.pct,
        ]),
      ],
      `project-delivery_${stamp}.csv`,
    );
    void logActivity({
      action: "exported",
      entity: "project",
      label: "Project delivery report",
      detail: rangeLabel,
    });
    toast.success("Project report exported");
  };
  const exportDaily = () => {
    downloadCsv(
      [
        [trend.weekly ? "Week of" : "Date", "Total Hours", "Regular Hours", "Overtime Hours", "Late arrivals"],
        ...trend.days.map((d) => [d.key, d.hours, d.regular, d.overtime, d.late]),
      ],
      `daily-hours_${stamp}.csv`,
    );
    toast.success("Trend data exported");
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports & Analytics"
        description={`Workforce attendance, hours, payroll & project delivery · ${rangeLabel}`}
        actions={
          <>
            <button
              type="button"
              onClick={() => window.print()}
              className="brutal-btn-outline mft-no-print normal-case tracking-normal"
            >
              <Svg d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              Print / PDF
            </button>
            <button
              type="button"
              onClick={exportWorkers}
              disabled={!workerRows.length}
              className="brutal-btn mft-no-print normal-case tracking-normal disabled:opacity-50"
            >
              <Svg d={DOWNLOAD} /> Export Team CSV
            </button>
          </>
        }
      />

      {/* Filters Toolbar */}
      <div className="ui-card mft-no-print flex flex-col gap-3 p-3.5 lg:flex-row lg:items-center">
        <div
          role="tablist"
          aria-label="Report date range"
          className="flex items-center gap-1 overflow-x-auto rounded-lg bg-zinc-100 p-1"
        >
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              role="tab"
              aria-selected={rangeKey === r.key}
              id={`range-${r.key}`}
              onClick={(e) => {
                setRangeKey(r.key);
                e.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" });
              }}
              className={`mft-tab-btn rounded-md px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                rangeKey === r.key
                  ? "bg-white text-zinc-900 shadow-xs"
                  : "text-zinc-500 hover:text-zinc-800"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        {rangeKey === "custom" && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              id="report-from"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="brutal-input w-40"
            />
            <span className="text-xs text-zinc-400">to</span>
            <input
              type="date"
              id="report-to"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="brutal-input w-40"
            />
          </div>
        )}
        <div className="lg:ml-auto">
          <select
            id="report-dept"
            value={dept}
            onChange={(e) => setDept(e.target.value)}
            className="brutal-input lg:w-52"
          >
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d} value={d}>
                {formatDepartment(d)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 6 KPI Stat Cards with Sparklines */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="ui-card p-4">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-3 h-7 w-16" />
            </div>
          ))
        ) : (
          <>
            <KpiStatCard
              label="Hours Logged"
              value={`${fmt(kpis.totalHours)}h`}
              sub={`${kpis.workerDays} worker-days`}
              tone="red"
              icon={ICONS.sessions}
              trend={trend.days.slice(-14).map((d) => d.hours)}
            />
            <KpiStatCard
              label="Avg Hours / Day"
              value={`${fmt(kpis.avgPerDay)}h`}
              sub="Per active worker-day"
              tone="blue"
              icon={ICONS.reports}
            />
            <KpiStatCard
              label="Attendance Rate"
              value={`${kpis.attendance}%`}
              sub={`${kpis.expectedDays} working days`}
              tone={kpis.attendance >= 90 ? "emerald" : kpis.attendance >= 75 ? "amber" : "red"}
              icon={ICONS.workers}
            />
            <KpiStatCard
              label="Late Arrivals"
              value={kpis.late}
              sub="Clock-in after 11:00"
              tone="amber"
              good="down"
              icon={ICONS.exceptions}
              trend={trend.days.slice(-14).map((d) => d.late)}
            />
            <KpiStatCard
              label="Tasks Completed"
              value={completedInRange.length}
              sub="Approved in period"
              tone="emerald"
              icon={ICONS.tasks}
            />
            <KpiStatCard
              label="Estimated Payroll"
              value={egp(totalPay)}
              sub={`${fmt(kpis.overtime)}h overtime logged`}
              tone="violet"
              icon={ICONS.hr}
            />
          </>
        )}
      </div>

      {/* Trend Chart + Department Donut Breakdown */}
      <div className="grid gap-6 xl:grid-cols-3">
        <ChartCard
          title={trend.weekly ? "Weekly Hours & Overtime Telemetry" : "Daily Hours & Overtime Telemetry"}
          subtitle={`Total logged hours vs overtime · Active day average ${fmt(trendAvg)}h`}
          className="xl:col-span-2"
          noPadding={chartType === "matrix"}
          actions={
            <div className="flex items-center gap-2">
              <div
                role="tablist"
                aria-label="Chart style"
                className="flex items-center rounded-lg border border-zinc-200 bg-zinc-50 p-0.5"
              >
                {(
                  [
                    ["matrix", "Cell Matrix"],
                    ["area", "Area Spline"],
                    ["bar", "Stacked Bar"],
                  ] as const
                ).map(([k, l]) => (
                  <button
                    key={k}
                    type="button"
                    role="tab"
                    aria-selected={chartType === k}
                    onClick={() => setChartType(k)}
                    className={`mft-tab-btn rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                      chartType === k ? "bg-white text-zinc-900 shadow-2xs" : "text-zinc-500 hover:text-zinc-800"
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
              <CsvButton onClick={exportDaily} />
            </div>
          }
        >
          {loading ? (
            <div className="p-5">
              <Skeleton className="h-56 w-full" />
            </div>
          ) : trend.days.every((d) => d.hours === 0) ? (
            <EmptyState
              compact
              icon={STATE_ICONS.chart}
              title="No hours logged in this period"
              description="Pick a different date range or department."
            />
          ) : chartType === "matrix" ? (
            <CellColumnTrend
              labels={trend.days.slice(-28).map((d) => d.label)}
              metrics={[
                {
                  key: "hours",
                  label: "Total Hours",
                  values: trend.days.slice(-28).map((d) => d.hours),
                  summary: `${fmt(kpis.totalHours)}h`,
                  deltaLabel: `avg ${fmt(trendAvg)}h/day`,
                  higherIsBetter: true,
                  accent: "#dc2626",
                  format: (v) => `${v}h`,
                  icon: ICONS.sessions,
                },
                {
                  key: "regular",
                  label: "Regular Hours",
                  values: trend.days.slice(-28).map((d) => d.regular),
                  summary: `${fmt(Math.max(0, kpis.totalHours - kpis.overtime))}h`,
                  deltaLabel: `${kpis.workerDays} worker-days`,
                  higherIsBetter: true,
                  accent: "#2563eb",
                  format: (v) => `${v}h`,
                  icon: ICONS.reports,
                },
                {
                  key: "overtime",
                  label: "Overtime (>8h)",
                  values: trend.days.slice(-28).map((d) => d.overtime),
                  summary: `${fmt(kpis.overtime)}h`,
                  deltaLabel: "overtime hours",
                  higherIsBetter: true,
                  accent: "#059669",
                  format: (v) => `${v}h`,
                  icon: ICONS.tasks,
                },
                {
                  key: "late",
                  label: "Late Arrivals",
                  values: trend.days.slice(-28).map((d) => d.late),
                  summary: `${kpis.late}`,
                  deltaLabel: "after 11:00 AM",
                  higherIsBetter: false,
                  accent: "#d97706",
                  format: (v) => `${Math.round(v)}`,
                  icon: ICONS.exceptions,
                },
              ]}
            />
          ) : chartType === "area" ? (
            <InteractiveAreaChart
              data={trend.days}
              xKey="label"
              height={235}
              format={(v) => `${v}h`}
              referenceValue={trendAvg}
              referenceLabel="Active day avg"
              description={`Hours logged and overtime from ${rangeLabel}`}
              series={[
                { key: "hours", label: "Total Hours", color: "#dc2626", fillOpacity: 0.2 },
                { key: "overtime", label: "Overtime (>8h)", color: "#f59e0b", fillOpacity: 0.14 },
              ]}
            />
          ) : (
            <InteractiveBarChart
              data={trend.days}
              xKey="label"
              height={235}
              stacked
              format={(v) => `${v}h`}
              referenceValue={trendAvg}
              referenceLabel="Active day avg"
              description={`Stacked regular and overtime hours from ${rangeLabel}`}
              series={[
                { key: "regular", label: "Regular Hours", color: "#18181b" },
                { key: "overtime", label: "Overtime (>8h)", color: "#dc2626" },
              ]}
            />
          )}
        </ChartCard>

        <ChartCard title="Hours by Department" description="Share of logged hours across teams">
          {loading ? (
            <div className="space-y-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : deptRows.length === 0 ? (
            <EmptyState compact icon={STATE_ICONS.users} title="No department data" />
          ) : (
            <DonutBreakdownChart
              slices={deptRows.map((d) => ({
                key: d.dept,
                label: d.label,
                value: d.hours,
                color: d.color,
              }))}
              centerLabel="Total Hours"
              format={(v) => `${fmt(v)}h`}
              description={`Logged hours by department for ${rangeLabel}`}
            />
          )}
        </ChartCard>
      </div>

      {/* Team Hours & Payroll Table */}
      <ChartCard
        title="Team Hours & Payroll Ledger"
        subtitle="Estimated pay uses each worker's hourly rate with overtime, late and absence policy applied"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={workerSearch}
              onChange={(e) => setWorkerSearch(e.target.value)}
              placeholder="Filter worker or dept…"
              className="brutal-input h-8 w-48 py-1 text-xs"
            />
            <CsvButton onClick={exportWorkers} />
          </div>
        }
      >
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-7 w-full" />
            ))}
          </div>
        ) : workerRows.length === 0 ? (
          <EmptyState
            compact
            icon={STATE_ICONS.users}
            title="No matching workers"
            description={
              workerSearch
                ? "Try clearing the search filter."
                : dept
                  ? "No one in this department yet."
                  : "Approve workers to include them in reports."
            }
          />
        ) : (
          <div className="mft-table-wrapper -mx-5 -mb-5">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="border-b border-zinc-100 bg-zinc-50/95">
                <tr>
                  <SortTh k="name" label="Worker" sort={workerSort} setSort={setWorkerSort} />
                  <SortTh k="days" label="Days" sort={workerSort} setSort={setWorkerSort} align="right" />
                  <SortTh k="hours" label="Hours" sort={workerSort} setSort={setWorkerSort} />
                  <SortTh
                    k="overtime"
                    label="Overtime"
                    sort={workerSort}
                    setSort={setWorkerSort}
                    align="right"
                  />
                  <SortTh k="late" label="Late" sort={workerSort} setSort={setWorkerSort} align="right" />
                  <SortTh
                    k="absent"
                    label="Absent"
                    sort={workerSort}
                    setSort={setWorkerSort}
                    align="right"
                  />
                  <SortTh
                    k="tasks"
                    label="Tasks Done"
                    sort={workerSort}
                    setSort={setWorkerSort}
                    align="right"
                  />
                  <SortTh k="pay" label="Est. Pay" sort={workerSort} setSort={setWorkerSort} align="right" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {workerRows.map((r) => (
                  <tr key={r.id} className="transition-colors hover:bg-zinc-50/80">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-900 font-code text-[11px] font-bold text-white">
                          {r.name
                            .split(" ")
                            .map((p) => p[0])
                            .join("")
                            .slice(0, 2)
                            .toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-zinc-900">{r.name}</p>
                          <p className="text-[11px] text-zinc-500">{formatDepartment(r.dept)}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-code tabular-nums text-zinc-700">{r.days}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-zinc-100">
                          <div
                            className="h-full rounded-full bg-red-500"
                            style={{ width: `${(r.hours / maxHours) * 100}%` }}
                          />
                        </div>
                        <span className="font-code font-semibold tabular-nums text-zinc-900">
                          {fmt(r.hours)}h
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-code tabular-nums text-zinc-700">
                      {r.overtime ? `${fmt(r.overtime)}h` : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {r.late ? (
                        <span className="rounded-md bg-amber-50 px-2 py-0.5 font-code text-[11px] font-semibold text-amber-700">
                          {r.late}
                        </span>
                      ) : (
                        <span className="text-zinc-400">0</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {r.absent ? (
                        <span className="rounded-md bg-red-50 px-2 py-0.5 font-code text-[11px] font-semibold text-red-700">
                          {r.absent}
                        </span>
                      ) : (
                        <span className="text-zinc-400">0</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-code tabular-nums text-zinc-700">{r.tasks}</td>
                    <td
                      className={`px-4 py-3 text-right font-code font-semibold tabular-nums ${
                        r.pay < 0 ? "text-red-600" : "text-zinc-900"
                      }`}
                    >
                      {egp(r.pay)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-zinc-200 bg-zinc-50 text-xs font-semibold text-zinc-700">
                <tr>
                  <td className="px-4 py-3">Total · {workerRows.length} people</td>
                  <td className="px-4 py-3 text-right font-code tabular-nums">
                    {workerRows.reduce((s, r) => s + r.days, 0)}
                  </td>
                  <td className="px-4 py-3 font-code tabular-nums">
                    {fmt(workerRows.reduce((s, r) => s + r.hours, 0))}h
                  </td>
                  <td className="px-4 py-3 text-right font-code tabular-nums">
                    {fmt(workerRows.reduce((s, r) => s + r.overtime, 0))}h
                  </td>
                  <td className="px-4 py-3 text-right font-code tabular-nums">
                    {workerRows.reduce((s, r) => s + r.late, 0)}
                  </td>
                  <td className="px-4 py-3 text-right font-code tabular-nums">
                    {workerRows.reduce((s, r) => s + r.absent, 0)}
                  </td>
                  <td className="px-4 py-3 text-right font-code tabular-nums">
                    {workerRows.reduce((s, r) => s + r.tasks, 0)}
                  </td>
                  <td className="px-4 py-3 text-right font-code tabular-nums">{egp(totalPay)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </ChartCard>

      {/* Projects + Exceptions & Adjustments */}
      <div className="grid gap-6 xl:grid-cols-3">
        <ChartCard
          title="Project Delivery Velocity"
          subtitle="Progress across all directives · completed counts reflect the selected period"
          actions={<CsvButton onClick={exportProjects} />}
          className="xl:col-span-2"
        >
          {!loaded.projects ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : projectRows.length === 0 ? (
            <EmptyState compact icon={ICONS.projects} title="No projects yet" />
          ) : (
            <div className="divide-y divide-zinc-100 -mx-5 -my-5">
              {projectRows.slice(0, 12).map((p) => (
                <div key={p.id} className="flex items-center gap-4 px-5 py-3.5 hover:bg-zinc-50/70">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold text-zinc-900">{p.name}</p>
                      {p.status !== "active" && (
                        <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium capitalize text-zinc-600">
                          {p.status.replace("-", " ")}
                        </span>
                      )}
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-100">
                        <div
                          className={`h-full rounded-full ${
                            p.pct === 100 ? "bg-emerald-500" : "bg-red-500"
                          }`}
                          style={{ width: `${p.pct}%` }}
                        />
                      </div>
                      <span className="w-9 text-right font-code text-[11px] font-semibold tabular-nums text-zinc-700">
                        {p.pct}%
                      </span>
                    </div>
                  </div>
                  <div className="hidden shrink-0 grid-cols-3 gap-4 text-center sm:grid">
                    <div>
                      <p className="font-code text-sm font-semibold tabular-nums text-emerald-600">
                        +{p.doneInRange}
                      </p>
                      <p className="text-[10px] text-zinc-400">done</p>
                    </div>
                    <div>
                      <p className="font-code text-sm font-semibold tabular-nums text-amber-600">
                        {p.review}
                      </p>
                      <p className="text-[10px] text-zinc-400">review</p>
                    </div>
                    <div>
                      <p
                        className={`font-code text-sm font-semibold tabular-nums ${
                          p.overdue ? "text-red-600" : "text-zinc-400"
                        }`}
                      >
                        {p.overdue}
                      </p>
                      <p className="text-[10px] text-zinc-400">overdue</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ChartCard>

        <div className="space-y-6">
          <ChartCard title="Exception Requests" subtitle={`${exceptionStats.total} submitted in period`}>
            {exceptionStats.total === 0 ? (
              <EmptyState compact icon={ICONS.exceptions} title="No requests in this period" />
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                    By type
                  </p>
                  {Object.entries(exceptionStats.byType).map(([k, v]) => (
                    <div key={k} className="flex justify-between py-1 text-xs">
                      <span className="capitalize text-zinc-600">{k}</span>
                      <span className="font-code font-semibold text-zinc-900">{v}</span>
                    </div>
                  ))}
                </div>
                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                    By status
                  </p>
                  {Object.entries(exceptionStats.byStatus).map(([k, v]) => (
                    <div key={k} className="flex justify-between py-1 text-xs">
                      <span className="capitalize text-zinc-600">{k}</span>
                      <span className="font-code font-semibold text-zinc-900">{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </ChartCard>

          <ChartCard title="Penalties & Bonuses" subtitle={`${penaltyStats.count} adjustments in period`}>
            <div className="grid grid-cols-2 divide-x divide-zinc-100 -mx-5 -my-5">
              <div className="p-5">
                <p className="text-[11px] font-medium text-zinc-500">Penalties</p>
                <p className="mt-1 font-code text-xl font-bold tabular-nums text-red-600">
                  −{+penaltyStats.penaltiesTotal.toFixed(2)}{" "}
                  <span className="text-xs font-semibold">
                    day{penaltyStats.penaltiesTotal === 1 ? "" : "s"}
                  </span>
                </p>
              </div>
              <div className="p-5">
                <p className="text-[11px] font-medium text-zinc-500">Bonuses</p>
                <p className="mt-1 font-code text-xl font-bold tabular-nums text-emerald-600">
                  +{+penaltyStats.bonusTotal.toFixed(2)}{" "}
                  <span className="text-xs font-semibold">
                    day{penaltyStats.bonusTotal === 1 ? "" : "s"}
                  </span>
                </p>
              </div>
            </div>
          </ChartCard>
        </div>
      </div>
    </div>
  );
}
