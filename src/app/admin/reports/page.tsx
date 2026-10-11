"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { downloadCsv } from "@/lib/admin/csv";
import { useUrlState } from "@/lib/admin/useUrlState";
import { logActivity } from "@/lib/admin/activity";
import { toast } from "@/lib/admin/feedback";
import { sessionHours } from "@/lib/admin/workTime";
import { calculateAttendancePolicy, computePayrollForWorker, formatDepartment, getExpectedWorkDaysInPeriod, sessionDateYmd, type SessionForHr } from "@/lib/admin/hrReports";
import { getAssigneeIds, parseDate } from "@/components/admin/projects/types";
import { EmptyState, PageHeader, Skeleton, STATE_ICONS } from "@/components/admin/ui/States";
import { ICONS } from "@/lib/admin/nav";

/* ───────────── Types ───────────── */

interface Worker {
  id: string;
  firstName?: string;
  lastName?: string;
  department?: string;
  role?: string;
  status?: string;
  hourlyRate?: number;
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

/* ───────────── Helpers ───────────── */

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function resolveRange(key: RangeKey, from: string, to: string): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(now);
  const end = new Date(now);
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  switch (key) {
    case "this-week": {
      // Week starts Sunday (Egypt work week: Sun–Thu)
      start.setDate(now.getDate() - now.getDay());
      break;
    }
    case "last-7":
      start.setDate(now.getDate() - 6);
      break;
    case "this-month":
      start.setDate(1);
      break;
    case "last-month":
      start.setMonth(now.getMonth() - 1, 1);
      end.setDate(0); // last day of previous month
      break;
    case "last-90":
      start.setDate(now.getDate() - 89);
      break;
    case "this-year":
      start.setMonth(0, 1);
      break;
    case "custom": {
      const f = from ? new Date(from + "T00:00:00") : null;
      const t = to ? new Date(to + "T23:59:59") : null;
      if (f && !isNaN(f.getTime())) start.setTime(f.getTime());
      else start.setDate(now.getDate() - 29);
      if (t && !isNaN(t.getTime())) end.setTime(t.getTime());
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
  return k ? new Date(k + "T12:00:00") : null;
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

function Kpi({ label, value, sub, tone = "zinc" }: { label: string; value: string | number; sub?: string; tone?: "zinc" | "red" | "emerald" | "amber" | "blue" }) {
  const bar: Record<string, string> = {
    zinc: "bg-zinc-300",
    red: "bg-red-500",
    emerald: "bg-emerald-500",
    amber: "bg-amber-500",
    blue: "bg-blue-500",
  };
  return (
    <div className="ui-card relative overflow-hidden px-4 py-4">
      <span className={`absolute left-0 top-0 h-full w-1 ${bar[tone]}`} />
      <p className="text-[11px] font-medium text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-bold tracking-tight text-zinc-900">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-zinc-500">{sub}</p>}
    </div>
  );
}

function Card({ title, description, action, children, className = "" }: { title: string; description?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`ui-card overflow-hidden ${className}`}>
      <div className="flex items-start justify-between gap-3 border-b border-zinc-100 px-5 py-4">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900">{title}</h3>
          {description && <p className="mt-0.5 text-xs text-zinc-500">{description}</p>}
        </div>
        {action && <div className="mft-no-print shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  );
}

function CsvButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-50 hover:text-zinc-900 cursor-pointer">
      <Svg d={DOWNLOAD} className="h-3.5 w-3.5" /> CSV
    </button>
  );
}

function SortTh<K extends string>({ k, label, sort, setSort, align = "left" }: { k: K; label: string; sort: { key: K; dir: SortDir }; setSort: (s: { key: K; dir: SortDir }) => void; align?: "left" | "right" }) {
  const active = sort.key === k;
  return (
    <th className={`px-4 py-2.5 text-[11px] font-semibold text-zinc-500 ${align === "right" ? "text-right" : "text-left"}`}>
      <button
        type="button"
        onClick={() => setSort({ key: k, dir: active && sort.dir === "desc" ? "asc" : "desc" })}
        className={`inline-flex items-center gap-1 transition-colors hover:text-zinc-900 cursor-pointer ${active ? "text-zinc-900" : ""}`}
      >
        {label}
        <span className={`text-[9px] ${active ? "opacity-100" : "opacity-0"}`}>{sort.dir === "desc" ? "▼" : "▲"}</span>
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
  const [loaded, setLoaded] = useState<Record<string, boolean>>({});

  const [rangeKey, setRangeKey] = useUrlState("range", "this-month");
  const [from, setFrom] = useUrlState("from");
  const [to, setTo] = useUrlState("to");
  const [dept, setDept] = useUrlState("dept");
  const [workerSort, setWorkerSort] = useState<{ key: WorkerRowKey; dir: SortDir }>({ key: "hours", dir: "desc" });

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
    ];
    return () => unsubs.forEach((u) => u());
  }, []);

  const loading = !loaded.workers || !loaded.workSessions || !loaded.tasks;

  const { start, end } = useMemo(() => resolveRange(rangeKey as RangeKey, from, to), [rangeKey, from, to]);
  const rangeLabel = `${start.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })} – ${end.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;

  const workerMap = useMemo(() => new Map(workers.map((w) => [w.id, w])), [workers]);
  const departments = useMemo(() => Array.from(new Set(workers.map((w) => w.department).filter(Boolean))) as string[], [workers]);

  const teamWorkers = useMemo(() => workers.filter((w) => w.status === "approved" && (!dept || w.department === dept)), [workers, dept]);

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
        if (dept) return getAssigneeIds(t.assignedTo).some((id) => workerMap.get(id)?.department === dept);
        return true;
      }),
    [tasks, start, end, dept, workerMap],
  );

  /* KPIs */
  const kpis = useMemo(() => {
    const totalHours = rangeSessions.reduce((s, x) => s + sessionHours(x), 0);
    const overtime = rangeSessions.reduce((s, x) => s + Math.max(0, sessionHours(x) - 8), 0);
    let late = 0;
    rangeSessions.forEach((s) => {
      const p = calculateAttendancePolicy(s);
      if (p.isLate || s.isLate) late++;
    });
    const expectedDays = getExpectedWorkDaysInPeriod(start, end > new Date() ? new Date() : end);
    const expectedSessions = expectedDays * teamWorkers.length;
    const workerDays = new Set(rangeSessions.map((s) => `${s.workerId}|${sessionDateYmd(s)}`)).size;
    const attendance = expectedSessions > 0 ? Math.min(100, Math.round((workerDays / expectedSessions) * 100)) : 0;
    const avgPerDay = workerDays > 0 ? totalHours / workerDays : 0;
    return { totalHours, overtime, late, attendance, avgPerDay, workerDays, expectedDays };
  }, [rangeSessions, start, end, teamWorkers.length]);

  /* Daily trend */
  const trend = useMemo(() => {
    const days: { key: string; label: string; hours: number; late: number }[] = [];
    const cursor = new Date(start);
    const last = end > new Date() ? new Date() : end;
    const totalDays = Math.round((last.getTime() - start.getTime()) / 86400000) + 1;
    const weekly = totalDays > 62;
    const buckets = new Map<string, { hours: number; late: number }>();
    rangeSessions.forEach((s) => {
      const d = sessionDate(s);
      if (!d) return;
      let key = ymd(d);
      if (weekly) {
        const w = new Date(d);
        w.setDate(d.getDate() - d.getDay());
        key = ymd(w);
      }
      const b = buckets.get(key) ?? { hours: 0, late: 0 };
      b.hours += sessionHours(s);
      if (calculateAttendancePolicy(s).isLate || s.isLate) b.late++;
      buckets.set(key, b);
    });
    if (weekly) cursor.setDate(cursor.getDate() - cursor.getDay());
    let guard = 0;
    while (cursor <= last && guard < 400) {
      const key = ymd(cursor);
      const b = buckets.get(key) ?? { hours: 0, late: 0 };
      days.push({
        key,
        label: weekly ? `Wk ${cursor.toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : cursor.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        hours: Math.round(b.hours * 10) / 10,
        late: b.late,
      });
      cursor.setDate(cursor.getDate() + (weekly ? 7 : 1));
      guard++;
    }
    return { days, weekly };
  }, [rangeSessions, start, end]);
  const trendMax = Math.max(1, ...trend.days.map((d) => d.hours));

  /* Per-worker table */
  const workerRows = useMemo(() => {
    const payEnd = end > new Date() ? new Date() : end;
    const rows = teamWorkers.map((w) => {
      const ws = rangeSessions.filter((s) => s.workerId === w.id);
      const pay = computePayrollForWorker(ws, Number(w.hourlyRate) || 0, start, payEnd);
      const done = completedInRange.filter((t) => getAssigneeIds(t.assignedTo).includes(w.id)).length;
      const absent = Math.max(0, getExpectedWorkDaysInPeriod(start, payEnd) - new Set(ws.map((s) => sessionDateYmd(s))).size);
      return {
        id: w.id,
        name: name(w),
        dept: w.department,
        days: pay.daysWorked,
        hours: pay.totalHours,
        overtime: pay.overtimeHours,
        late: pay.lateDays + pay.veryLateDays,
        absent,
        tasks: done,
        pay: pay.totalPay,
        rate: pay.hourlyRate,
      };
    });
    const dir = workerSort.dir === "asc" ? 1 : -1;
    return rows.sort((a, b) => {
      const k = workerSort.key;
      if (k === "name") return a.name.localeCompare(b.name) * dir;
      return ((a[k] as number) - (b[k] as number)) * dir;
    });
  }, [teamWorkers, rangeSessions, completedInRange, start, end, workerSort]);
  const maxHours = Math.max(1, ...workerRows.map((r) => r.hours));
  const totalPay = workerRows.reduce((s, r) => s + Math.max(0, r.pay), 0);

  /* Departments */
  const deptRows = useMemo(() => {
    const map = new Map<string, { hours: number; people: Set<string>; late: number }>();
    rangeSessions.forEach((s) => {
      const d = s.department ?? workerMap.get(s.workerId ?? "")?.department ?? "unassigned";
      const r = map.get(d) ?? { hours: 0, people: new Set<string>(), late: 0 };
      r.hours += sessionHours(s);
      if (s.workerId) r.people.add(s.workerId);
      if (calculateAttendancePolicy(s).isLate || s.isLate) r.late++;
      map.set(d, r);
    });
    return Array.from(map.entries())
      .map(([d, r]) => ({ dept: d, hours: r.hours, people: r.people.size, late: r.late }))
      .sort((a, b) => b.hours - a.hours);
  }, [rangeSessions, workerMap]);
  const deptMax = Math.max(1, ...deptRows.map((d) => d.hours));
  const DEPT_COLORS = ["bg-red-500", "bg-blue-500", "bg-emerald-500", "bg-amber-500", "bg-violet-500", "bg-sky-500", "bg-zinc-500"];

  /* Projects */
  const projectRows = useMemo(() => {
    const now = new Date();
    return projects
      .map((p) => {
        const pt = tasks.filter((t) => t.projectId === p.id);
        const done = pt.filter((t) => t.status === "completed").length;
        const doneInRange = completedInRange.filter((t) => t.projectId === p.id).length;
        const overdue = pt.filter((t) => t.status !== "completed" && (parseDate(t.dueDate)?.getTime() ?? Infinity) < now.getTime()).length;
        const review = pt.filter((t) => t.status === "pending-approval").length;
        return { id: p.id, name: p.name ?? "Untitled", client: p.clientName, status: p.status ?? "active", total: pt.length, done, doneInRange, overdue, review, pct: pt.length ? Math.round((done / pt.length) * 100) : 0 };
      })
      .filter((p) => p.total > 0 || p.status === "active")
      .sort((a, b) => b.doneInRange - a.doneInRange || b.total - a.total);
  }, [projects, tasks, completedInRange]);

  /* Exceptions + penalties */
  const exceptionStats = useMemo(() => {
    const list = exceptions.filter((e) => inRange(parseDate(e.createdAt) ?? parseDate(e.submittedAt) ?? (e.date ? new Date(e.date + "T12:00:00") : null), start, end));
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
        ["Worker", "Department", "Days worked", "Hours", "Overtime hours", "Late days", "Absent days", "Tasks completed", "Hourly rate", "Estimated pay (EGP)"],
        ...workerRows.map((r) => [r.name, formatDepartment(r.dept), r.days, r.hours, r.overtime, r.late, r.absent, r.tasks, r.rate, r.pay]),
      ],
      `team-report_${stamp}.csv`,
    );
    void logActivity({ action: "exported", entity: "hr", label: "Team hours & payroll report", detail: rangeLabel });
    toast.success("Team report exported");
  };
  const exportProjects = () => {
    downloadCsv(
      [["Project", "Client", "Status", "Total tasks", "Completed", "Completed in period", "In review", "Overdue", "Progress %"], ...projectRows.map((p) => [p.name, p.client ?? "", p.status, p.total, p.done, p.doneInRange, p.review, p.overdue, p.pct])],
      `project-delivery_${stamp}.csv`,
    );
    void logActivity({ action: "exported", entity: "project", label: "Project delivery report", detail: rangeLabel });
    toast.success("Project report exported");
  };
  const exportDaily = () => {
    downloadCsv([[trend.weekly ? "Week of" : "Date", "Hours", "Late arrivals"], ...trend.days.map((d) => [d.key, d.hours, d.late])], `daily-hours_${stamp}.csv`);
    toast.success("Trend data exported");
  };

  return (
    <div>
      <PageHeader
        title="Reports"
        description={`Attendance, hours, payroll and delivery · ${rangeLabel}`}
        actions={
          <>
            <button type="button" onClick={() => window.print()} className="brutal-btn-outline mft-no-print normal-case tracking-normal">
              <Svg d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              Print / PDF
            </button>
            <button type="button" onClick={exportWorkers} disabled={!workerRows.length} className="brutal-btn mft-no-print normal-case tracking-normal disabled:opacity-50">
              <Svg d={DOWNLOAD} /> Export team report
            </button>
          </>
        }
      />

      {/* Filters */}
      <div className="ui-card mft-no-print mb-6 flex flex-col gap-3 p-3 lg:flex-row lg:items-center">
        <div className="flex flex-wrap gap-1 rounded-lg bg-zinc-100 p-1">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              id={`range-${r.key}`}
              onClick={() => setRangeKey(r.key)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${rangeKey === r.key ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-800"}`}
            >
              {r.label}
            </button>
          ))}
        </div>
        {rangeKey === "custom" && (
          <div className="flex items-center gap-2">
            <input type="date" id="report-from" value={from} onChange={(e) => setFrom(e.target.value)} className="brutal-input w-40" />
            <span className="text-xs text-zinc-400">to</span>
            <input type="date" id="report-to" value={to} onChange={(e) => setTo(e.target.value)} className="brutal-input w-40" />
          </div>
        )}
        <div className="lg:ml-auto">
          <select id="report-dept" value={dept} onChange={(e) => setDept(e.target.value)} className="brutal-input lg:w-48">
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d} value={d}>
                {formatDepartment(d)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* KPIs */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="ui-card p-4">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-3 h-7 w-16" />
            </div>
          ))
        ) : (
          <>
            <Kpi label="Hours logged" value={`${fmt(kpis.totalHours)}h`} sub={`${kpis.workerDays} worker-days`} tone="red" />
            <Kpi label="Avg hours / day" value={`${fmt(kpis.avgPerDay)}h`} sub="Per worker per day" tone="blue" />
            <Kpi label="Attendance rate" value={`${kpis.attendance}%`} sub={`${kpis.expectedDays} working days`} tone={kpis.attendance >= 90 ? "emerald" : kpis.attendance >= 75 ? "amber" : "red"} />
            <Kpi label="Late arrivals" value={kpis.late} sub="Login after 11:00" tone="amber" />
            <Kpi label="Tasks completed" value={completedInRange.length} sub="Approved in period" tone="emerald" />
            <Kpi label="Est. payroll" value={egp(totalPay)} sub={`${fmt(kpis.overtime)}h overtime`} tone="zinc" />
          </>
        )}
      </div>

      {/* Trend + Departments */}
      <div className="mb-6 grid gap-6 xl:grid-cols-3">
        <Card title={trend.weekly ? "Weekly hours" : "Daily hours"} description="Total logged hours with late arrivals highlighted" action={<CsvButton onClick={exportDaily} />} className="xl:col-span-2">
          {loading ? (
            <div className="p-5">
              <Skeleton className="h-48 w-full" />
            </div>
          ) : trend.days.every((d) => d.hours === 0) ? (
            <EmptyState compact icon={STATE_ICONS.chart} title="No hours logged in this period" description="Pick a different date range or department." />
          ) : (
            <div className="px-5 pb-4 pt-6">
              <div className="flex h-52 items-end gap-[3px]">
                {trend.days.map((d) => (
                  <div key={d.key} className="group relative flex h-full flex-1 flex-col justify-end">
                    <div
                      className={`w-full rounded-t-[3px] transition-all ${d.hours ? "bg-red-500/85 group-hover:bg-red-600" : "bg-zinc-100"}`}
                      style={{ height: `${Math.max(d.hours ? 4 : 2, (d.hours / trendMax) * 100)}%` }}
                    />
                    {d.late > 0 && <span className="absolute -top-0 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-amber-500" style={{ bottom: `calc(${(d.hours / trendMax) * 100}% + 4px)`, top: "auto" }} />}
                    <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-zinc-900 px-2 py-1 text-[11px] text-white group-hover:block">
                      <span className="font-semibold">{d.label}</span> · {d.hours}h{d.late ? ` · ${d.late} late` : ""}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex justify-between text-[10px] text-zinc-400">
                <span>{trend.days[0]?.label}</span>
                {trend.days.length > 2 && <span>{trend.days[Math.floor(trend.days.length / 2)]?.label}</span>}
                <span>{trend.days[trend.days.length - 1]?.label}</span>
              </div>
              <div className="mt-3 flex items-center gap-4 text-[11px] text-zinc-500">
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-red-500" /> Hours</span>
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-500" /> Late arrivals</span>
                <span className="ml-auto">Peak {fmt(trendMax)}h</span>
              </div>
            </div>
          )}
        </Card>

        <Card title="By department" description="Share of logged hours">
          {loading ? (
            <div className="space-y-4 p-5">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : deptRows.length === 0 ? (
            <EmptyState compact icon={STATE_ICONS.users} title="No department data" />
          ) : (
            <div className="space-y-4 p-5">
              {deptRows.map((d, i) => (
                <div key={d.dept}>
                  <div className="mb-1.5 flex items-center justify-between text-xs">
                    <span className="font-medium text-zinc-800">{formatDepartment(d.dept)}</span>
                    <span className="text-zinc-500">
                      <span className="font-semibold text-zinc-900">{fmt(d.hours)}h</span> · {d.people} people{d.late ? ` · ${d.late} late` : ""}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-zinc-100">
                    <div className={`h-full rounded-full ${DEPT_COLORS[i % DEPT_COLORS.length]}`} style={{ width: `${(d.hours / deptMax) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Team table */}
      <Card title="Team hours & payroll" description="Estimated pay uses each worker's hourly rate with overtime, late and absence policy applied" action={<CsvButton onClick={exportWorkers} />} className="mb-6">
        {loading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        ) : workerRows.length === 0 ? (
          <EmptyState compact icon={STATE_ICONS.users} title="No approved workers" description={dept ? "No one in this department yet." : "Approve workers to include them in reports."} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="border-b border-zinc-100 bg-zinc-50">
                <tr>
                  <SortTh k="name" label="Worker" sort={workerSort} setSort={setWorkerSort} />
                  <SortTh k="days" label="Days" sort={workerSort} setSort={setWorkerSort} align="right" />
                  <SortTh k="hours" label="Hours" sort={workerSort} setSort={setWorkerSort} />
                  <SortTh k="overtime" label="Overtime" sort={workerSort} setSort={setWorkerSort} align="right" />
                  <SortTh k="late" label="Late" sort={workerSort} setSort={setWorkerSort} align="right" />
                  <SortTh k="absent" label="Absent" sort={workerSort} setSort={setWorkerSort} align="right" />
                  <SortTh k="tasks" label="Tasks done" sort={workerSort} setSort={setWorkerSort} align="right" />
                  <SortTh k="pay" label="Est. pay" sort={workerSort} setSort={setWorkerSort} align="right" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {workerRows.map((r) => (
                  <tr key={r.id} className="transition-colors hover:bg-zinc-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[11px] font-bold text-zinc-600">
                          {r.name
                            .split(" ")
                            .map((p) => p[0])
                            .join("")
                            .slice(0, 2)
                            .toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-medium text-zinc-900">{r.name}</p>
                          <p className="text-[11px] text-zinc-500">{formatDepartment(r.dept)}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-zinc-700">{r.days}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-zinc-100">
                          <div className="h-full rounded-full bg-red-500" style={{ width: `${(r.hours / maxHours) * 100}%` }} />
                        </div>
                        <span className="tabular-nums font-semibold text-zinc-900">{fmt(r.hours)}h</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-zinc-700">{r.overtime ? `${fmt(r.overtime)}h` : "—"}</td>
                    <td className="px-4 py-3 text-right">
                      {r.late ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">{r.late}</span> : <span className="text-zinc-400">0</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {r.absent ? <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">{r.absent}</span> : <span className="text-zinc-400">0</span>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-zinc-700">{r.tasks}</td>
                    <td className={`px-4 py-3 text-right tabular-nums font-semibold ${r.pay < 0 ? "text-red-600" : "text-zinc-900"}`}>{egp(r.pay)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-zinc-200 bg-zinc-50 text-xs font-semibold text-zinc-700">
                <tr>
                  <td className="px-4 py-3">Total · {workerRows.length} people</td>
                  <td className="px-4 py-3 text-right tabular-nums">{workerRows.reduce((s, r) => s + r.days, 0)}</td>
                  <td className="px-4 py-3 tabular-nums">{fmt(workerRows.reduce((s, r) => s + r.hours, 0))}h</td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmt(workerRows.reduce((s, r) => s + r.overtime, 0))}h</td>
                  <td className="px-4 py-3 text-right tabular-nums">{workerRows.reduce((s, r) => s + r.late, 0)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{workerRows.reduce((s, r) => s + r.absent, 0)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{workerRows.reduce((s, r) => s + r.tasks, 0)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{egp(totalPay)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      {/* Projects + exceptions */}
      <div className="grid gap-6 xl:grid-cols-3">
        <Card title="Project delivery" description="Progress across all tasks · completed counts are for the selected period" action={<CsvButton onClick={exportProjects} />} className="xl:col-span-2">
          {!loaded.projects ? (
            <div className="space-y-3 p-5">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : projectRows.length === 0 ? (
            <EmptyState compact icon={ICONS.projects} title="No projects yet" />
          ) : (
            <div className="divide-y divide-zinc-100">
              {projectRows.slice(0, 12).map((p) => (
                <div key={p.id} className="flex items-center gap-4 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium text-zinc-900">{p.name}</p>
                      {p.status !== "active" && <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium capitalize text-zinc-600">{p.status.replace("-", " ")}</span>}
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-100">
                        <div className={`h-full rounded-full ${p.pct === 100 ? "bg-emerald-500" : "bg-red-500"}`} style={{ width: `${p.pct}%` }} />
                      </div>
                      <span className="w-9 text-right text-[11px] font-semibold tabular-nums text-zinc-700">{p.pct}%</span>
                    </div>
                  </div>
                  <div className="hidden shrink-0 grid-cols-3 gap-4 text-center sm:grid">
                    <div>
                      <p className="text-sm font-semibold tabular-nums text-emerald-600">+{p.doneInRange}</p>
                      <p className="text-[10px] text-zinc-400">done</p>
                    </div>
                    <div>
                      <p className="text-sm font-semibold tabular-nums text-amber-600">{p.review}</p>
                      <p className="text-[10px] text-zinc-400">review</p>
                    </div>
                    <div>
                      <p className={`text-sm font-semibold tabular-nums ${p.overdue ? "text-red-600" : "text-zinc-400"}`}>{p.overdue}</p>
                      <p className="text-[10px] text-zinc-400">overdue</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <div className="space-y-6">
          <Card title="Exception requests" description={`${exceptionStats.total} in this period`}>
            {exceptionStats.total === 0 ? (
              <EmptyState compact icon={ICONS.exceptions} title="No requests in this period" />
            ) : (
              <div className="grid grid-cols-2 gap-4 p-5">
                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">By type</p>
                  {Object.entries(exceptionStats.byType).map(([k, v]) => (
                    <div key={k} className="flex justify-between py-1 text-xs">
                      <span className="capitalize text-zinc-600">{k}</span>
                      <span className="font-semibold text-zinc-900">{v}</span>
                    </div>
                  ))}
                </div>
                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">By status</p>
                  {Object.entries(exceptionStats.byStatus).map(([k, v]) => (
                    <div key={k} className="flex justify-between py-1 text-xs">
                      <span className="capitalize text-zinc-600">{k}</span>
                      <span className="font-semibold text-zinc-900">{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>

          <Card title="Penalties & bonuses" description={`${penaltyStats.count} adjustments in this period`}>
            <div className="grid grid-cols-2 divide-x divide-zinc-100">
              <div className="p-5">
                <p className="text-[11px] font-medium text-zinc-500">Penalties</p>
                <p className="mt-1 text-xl font-bold tabular-nums text-red-600">
                  −{+penaltyStats.penaltiesTotal.toFixed(2)} <span className="text-sm font-semibold">day{penaltyStats.penaltiesTotal === 1 ? "" : "s"}</span>
                </p>
              </div>
              <div className="p-5">
                <p className="text-[11px] font-medium text-zinc-500">Bonuses</p>
                <p className="mt-1 text-xl font-bold tabular-nums text-emerald-600">
                  +{+penaltyStats.bonusTotal.toFixed(2)} <span className="text-sm font-semibold">day{penaltyStats.bonusTotal === 1 ? "" : "s"}</span>
                </p>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
