"use client";

import { useEffect, useState, useMemo } from "react";
import { collection, onSnapshot, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { downloadCsv } from "@/lib/admin/csv";
import { sessionHours } from "@/lib/admin/workTime";
import { DEPARTMENTS } from "@/lib/admin/constants";
import { useUrlState } from "@/lib/admin/useUrlState";
import { toast } from "@/lib/admin/feedback";
import { EmptyState, PageHeader, SkeletonRows, STATE_ICONS } from "@/components/admin/ui/States";

interface WorkSession {
  id: string;
  workerId?: string;
  workerName?: string;
  workerEmail?: string;
  date?: string;
  loginTime?: Timestamp | null;
  logoutTime?: Timestamp | null;
  startTime?: Timestamp | null;
  totalWorkTime?: number;
  isActive?: boolean;
  attendanceStatus?: string;
  department?: string;
  role?: string;
  isLate?: boolean;
  latePenalty?: number;
  presenceStatus?: "active" | "idle" | "offline";
  lastActiveCheckAt?: Timestamp | null;
  missedCheckInAt?: Timestamp | null;
  currentTaskTitle?: string;
  currentTaskNote?: string;
  checkIns?: Array<{
    timestamp: string;
    taskId?: string;
    taskTitle?: string;
    note?: string;
    workerName?: string;
  }>;
}

interface WorkerOpt {
  id: string;
  firstName: string;
  lastName: string;
  department?: string;
  role?: string;
}

function formatRole(role: string | undefined) {
  if (!role) return "";
  return role
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isLateSession(s: WorkSession) {
  if (s.isLate || s.attendanceStatus === "late" || s.attendanceStatus === "very-late") return true;
  if (s.loginTime) {
    const d = s.loginTime.toDate();
    return d.getHours() + d.getMinutes() / 60 >= 11;
  }
  return false;
}

function time(t?: Timestamp | null) {
  return t ? t.toDate().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";
}

function Svg({ d, className = "h-4 w-4" }: { d: string; className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

const QUICK = [
  { key: "today", label: "Today" },
  { key: "7", label: "7 days" },
  { key: "30", label: "30 days" },
  { key: "month", label: "This month" },
  { key: "", label: "All" },
];

const PAGE_SIZE = 50;

export default function AdminWorkSessionsPage() {
  const [sessions, setSessions] = useState<WorkSession[]>([]);
  const [workers, setWorkers] = useState<WorkerOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [workerFilter, setWorkerFilter] = useUrlState("worker");
  const [departmentFilter, setDepartmentFilter] = useUrlState("dept");
  const [dateFrom, setDateFrom] = useUrlState("from");
  const [dateTo, setDateTo] = useUrlState("to");
  const [statusFilter, setStatusFilter] = useUrlState("status");
  const [viewType, setViewType] = useUrlState("view", "sessions");
  const [page, setPage] = useState(1);

  useEffect(() => {
    return onSnapshot(
      collection(db, "workSessions"),
      (snap) => {
        const list: WorkSession[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() } as WorkSession));
        list.sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.loginTime?.toMillis?.() ?? 0) - (a.loginTime?.toMillis?.() ?? 0));
        setSessions(list);
        setLoading(false);
      },
      (err) => {
        setLoading(false);
        toast.error("Couldn't load sessions", { description: err.message });
      },
    );
  }, []);

  useEffect(() => {
    return onSnapshot(collection(db, "workers"), (snap) => {
      const list: WorkerOpt[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() } as WorkerOpt));
      list.sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`));
      setWorkers(list);
    });
  }, []);

  const applyQuick = (key: string) => {
    const now = new Date();
    const start = new Date(now);
    if (key === "") {
      setDateFrom("");
      setDateTo("");
      return;
    }
    if (key === "today") {
      /* start = today */
    } else if (key === "month") start.setDate(1);
    else start.setDate(now.getDate() - (Number(key) - 1));
    setDateFrom(ymd(start));
    setDateTo(ymd(now));
  };
  const activeQuick = useMemo(() => {
    const today = ymd(new Date());
    if (!dateFrom && !dateTo) return "";
    if (dateTo !== today) return null;
    for (const q of QUICK) {
      if (!q.key) continue;
      const s = new Date();
      if (q.key === "month") s.setDate(1);
      else if (q.key !== "today") s.setDate(s.getDate() - (Number(q.key) - 1));
      if (ymd(s) === dateFrom) return q.key;
    }
    return null;
  }, [dateFrom, dateTo]);

  const filtered = useMemo(() => {
    return sessions.filter((s) => {
      if (workerFilter && s.workerId !== workerFilter) return false;
      if (departmentFilter && (s.department || "") !== departmentFilter) return false;
      const d = s.date || "";
      if (dateFrom && d && d < dateFrom) return false;
      if (dateTo && d && d > dateTo) return false;
      if (statusFilter === "late" && !isLateSession(s)) return false;
      if (statusFilter === "active" && (!s.isActive || s.presenceStatus === "idle")) return false;
      if (statusFilter === "idle" && (!s.isActive || s.presenceStatus !== "idle")) return false;
      if (statusFilter === "overtime" && sessionHours(s) <= 8) return false;
      return true;
    });
  }, [sessions, workerFilter, departmentFilter, dateFrom, dateTo, statusFilter]);

  useEffect(() => setPage(1), [workerFilter, departmentFilter, dateFrom, dateTo, statusFilter, viewType]);

  const summary = useMemo(() => {
    let totalMs = 0;
    const workersSet = new Set<string>();
    let late = 0;
    let active = 0;
    let idle = 0;
    let ot = 0;
    for (const s of filtered) {
      totalMs += s.totalWorkTime || 0;
      if (s.workerId) workersSet.add(s.workerId);
      if (isLateSession(s)) late += 1;
      if (s.isActive) {
        if (s.presenceStatus === "idle") idle += 1;
        else active += 1;
      }
      ot += Math.max(0, sessionHours(s) - 8);
    }
    const totalH = Math.round((totalMs / 3600000) * 10) / 10;
    const avg = filtered.length > 0 ? Math.round((totalMs / filtered.length / 3600000) * 10) / 10 : 0;
    return { totalH, count: filtered.length, workers: workersSet.size, late, active, idle, avg, ot: Math.round(ot * 10) / 10 };
  }, [filtered]);

  const totalsByWorker = useMemo(() => {
    const map: Record<string, { name: string; dept?: string; role?: string; hours: number; sessions: number; late: number; ot: number }> = {};
    for (const s of filtered) {
      const id = s.workerId || "unknown";
      if (!map[id]) map[id] = { name: s.workerName || id, dept: s.department, role: s.role, hours: 0, sessions: 0, late: 0, ot: 0 };
      const h = sessionHours(s);
      map[id].hours += h;
      map[id].sessions += 1;
      map[id].ot += Math.max(0, h - 8);
      if (isLateSession(s)) map[id].late += 1;
    }
    return Object.entries(map).sort((a, b) => b[1].hours - a[1].hours);
  }, [filtered]);
  const maxWorkerHours = Math.max(1, ...totalsByWorker.map(([, t]) => t.hours));

  const exportCsv = () => {
    const rows: (string | number)[][] = [[
      "Worker",
      "Department",
      "Role",
      "Date",
      "Login",
      "Logout",
      "Hours",
      "Late Status",
      "Active Status",
      "2h Presence",
      "Current Task",
      "Check-in Note"
    ]];
    for (const s of filtered) {
      rows.push([
        s.workerName || "",
        s.department || "",
        s.role || "",
        s.date || "",
        s.loginTime ? s.loginTime.toDate().toLocaleString() : "",
        s.logoutTime ? s.logoutTime.toDate().toLocaleString() : s.isActive ? "Active" : "",
        sessionHours(s).toFixed(2),
        isLateSession(s) ? "Late" : "On-Time",
        s.isActive ? "yes" : "no",
        s.isActive ? (s.presenceStatus === "idle" ? "Idle (Missed Check-in)" : "Active (Verified)") : "Offline",
        s.currentTaskTitle || "",
        s.currentTaskNote || "",
      ]);
    }
    downloadCsv(rows, `work_sessions_${new Date().toISOString().split("T")[0]}.csv`);
    toast.success(`Exported ${filtered.length} sessions`);
  };

  const hasFilters = !!(workerFilter || departmentFilter || dateFrom || dateTo || statusFilter);
  const pageItems = filtered.slice(0, page * PAGE_SIZE);

  return (
    <div>
      <PageHeader
        title="Work sessions"
        description="Clock-in / clock-out logs, hours and attendance flags."
        actions={
          <button type="button" onClick={exportCsv} disabled={!filtered.length} className="brutal-btn-outline normal-case tracking-normal disabled:opacity-50">
            <Svg d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /> Export CSV
          </button>
        }
      />

      {/* Summary */}
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {[
          { label: "Hours logged", value: `${summary.totalH}h`, tone: "bg-red-500" },
          { label: "Sessions", value: summary.count, tone: "bg-zinc-400" },
          { label: "Active (2h OK)", value: summary.active, tone: "bg-emerald-500" },
          { label: "Idle (Missed check)", value: summary.idle, tone: summary.idle > 0 ? "bg-red-600" : "bg-zinc-300" },
          { label: "Late arrivals", value: summary.late, tone: "bg-amber-500" },
          { label: "Overtime", value: `${summary.ot}h`, tone: "bg-violet-500" },
        ].map((s) => (
          <div key={s.label} className="ui-card relative overflow-hidden px-4 py-3">
            <span className={`absolute left-0 top-0 h-full w-1 ${s.tone}`} />
            <p className="text-[11px] font-medium text-zinc-500">{s.label}</p>
            <p className="mt-1 text-xl font-bold tracking-tight text-zinc-900">{loading ? "–" : s.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="ui-card mb-4 space-y-3 p-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="flex flex-wrap gap-1 rounded-lg bg-zinc-100 p-1">
            {QUICK.map((q) => (
              <button
                key={q.key || "all"}
                type="button"
                onClick={() => applyQuick(q.key)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${activeQuick === q.key ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-800"}`}
              >
                {q.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="brutal-input w-40" aria-label="From date" />
            <span className="text-xs text-zinc-400">to</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="brutal-input w-40" aria-label="To date" />
          </div>
          <div className="flex gap-1 rounded-lg bg-zinc-100 p-1 lg:ml-auto">
            {[
              ["sessions", "Sessions"],
              ["totals", "Per worker"],
            ].map(([k, l]) => (
              <button
                key={k}
                type="button"
                onClick={() => setViewType(k)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${viewType === k ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-800"}`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <select value={workerFilter} onChange={(e) => setWorkerFilter(e.target.value)} className="brutal-input md:w-56">
            <option value="">All workers</option>
            {workers.map((w) => (
              <option key={w.id} value={w.id}>
                {w.firstName} {w.lastName}
              </option>
            ))}
          </select>
          <select value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)} className="brutal-input md:w-44">
            <option value="">All departments</option>
            {DEPARTMENTS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="brutal-input md:w-48">
            <option value="">Any status</option>
            <option value="active">Active (2h Verified)</option>
            <option value="idle">Idle / Missed Check-in</option>
            <option value="late">Late arrivals</option>
            <option value="overtime">Overtime (&gt;8h)</option>
          </select>
          {hasFilters && (
            <button
              type="button"
              onClick={() => {
                setWorkerFilter("");
                setDepartmentFilter("");
                setDateFrom("");
                setDateTo("");
                setStatusFilter("");
              }}
              className="px-2 text-xs font-medium text-zinc-500 hover:text-zinc-900 cursor-pointer"
            >
              Reset filters
            </button>
          )}
          <p className="text-[11px] text-zinc-400 md:ml-auto">Work starts 10:00 · Late 11:00–12:00 (−0.25 day) · Very late 12:00+ (−0.5 day) · OT over 8h</p>
        </div>
      </div>

      <div className="ui-card overflow-hidden">
        {loading ? (
          <SkeletonRows rows={8} cols={5} />
        ) : filtered.length === 0 ? (
          <EmptyState icon={STATE_ICONS.clock} title="No sessions match" description={hasFilters ? "Try widening the date range or clearing filters." : "Sessions appear here when workers clock in from the app."} />
        ) : viewType === "sessions" ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] text-sm">
                <thead className="border-b border-zinc-100 bg-zinc-50 text-left text-[11px] font-semibold text-zinc-500">
                  <tr>
                    <th className="px-4 py-2.5">Worker</th>
                    <th className="px-4 py-2.5">Date</th>
                    <th className="px-4 py-2.5">Clock in</th>
                    <th className="px-4 py-2.5">Clock out</th>
                    <th className="px-4 py-2.5">Hours</th>
                    <th className="px-4 py-2.5">2h Presence &amp; Active Task</th>
                    <th className="px-4 py-2.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {pageItems.map((s) => {
                    const h = sessionHours(s);
                    const ot = Math.max(0, h - 8);
                    const late = isLateSession(s);
                    return (
                      <tr key={s.id} className="transition-colors hover:bg-zinc-50">
                        <td className="px-4 py-3">
                          <button type="button" onClick={() => s.workerId && setWorkerFilter(s.workerId)} className="text-left cursor-pointer" title="Filter by this worker">
                            <p className="font-medium text-zinc-900 hover:text-red-600">{s.workerName || "Unknown worker"}</p>
                            <p className="text-[11px] text-zinc-500">{[formatRole(s.role), s.department].filter(Boolean).join(" · ")}</p>
                          </button>
                        </td>
                        <td className="px-4 py-3 text-zinc-700">{s.date ? new Date(s.date + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "—"}</td>
                        <td className={`px-4 py-3 tabular-nums ${late ? "font-semibold text-amber-600" : "text-zinc-700"}`}>{time(s.loginTime)}</td>
                        <td className="px-4 py-3 tabular-nums text-zinc-700">{s.logoutTime ? time(s.logoutTime) : s.isActive ? <span className="text-emerald-600">Working…</span> : "—"}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-zinc-100">
                              <div className={`h-full rounded-full ${ot ? "bg-violet-500" : "bg-red-500"}`} style={{ width: `${Math.min(100, (h / 10) * 100)}%` }} />
                            </div>
                            <span className="tabular-nums font-semibold text-zinc-900">{h.toFixed(1)}h</span>
                            {ot > 0 && <span className="text-[10px] font-medium text-violet-600">+{ot.toFixed(1)} OT</span>}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {s.isActive ? (
                            s.presenceStatus === "idle" ? (
                              <div className="flex flex-col gap-1">
                                <span className="inline-flex items-center gap-1.5 rounded-md bg-red-50 border border-red-200 px-2 py-0.5 text-[11px] font-bold text-red-700 w-fit">
                                  <span className="h-2 w-2 rounded-full bg-red-600 animate-ping" />
                                  Idle (Missed 2h Check)
                                </span>
                                <span className="text-[10px] text-zinc-500 font-mono">
                                  Last check: {time(s.lastActiveCheckAt || s.loginTime)}
                                </span>
                              </div>
                            ) : (
                              <div className="flex flex-col gap-1">
                                <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 w-fit">
                                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                  Active (2h Verified)
                                </span>
                                {s.currentTaskTitle ? (
                                  <div className="max-w-[240px]" title={s.currentTaskTitle + (s.currentTaskNote ? ` — ${s.currentTaskNote}` : "")}>
                                    <p className="truncate text-xs font-medium text-zinc-900">📌 {s.currentTaskTitle}</p>
                                    {s.currentTaskNote && (
                                      <p className="truncate text-[10px] text-zinc-500 italic">&ldquo;{s.currentTaskNote}&rdquo;</p>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-[10px] text-zinc-400 font-mono">Verified at {time(s.lastActiveCheckAt || s.loginTime)}</span>
                                )}
                              </div>
                            )
                          ) : (
                            <div className="text-xs text-zinc-400">
                              {s.checkIns && s.checkIns.length > 0 ? (
                                <span title={`${s.checkIns.length} check-ins logged`}>
                                  ✓ {s.checkIns.length} check-in{s.checkIns.length > 1 ? "s" : ""}
                                </span>
                              ) : (
                                <span>Completed</span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {s.isActive ? (
                              s.presenceStatus === "idle" ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700">
                                  <span className="h-1.5 w-1.5 rounded-full bg-red-600" /> Idle
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" /> Active
                                </span>
                              )
                            ) : (
                              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600">Completed</span>
                            )}
                            {late && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">{s.attendanceStatus === "very-late" ? "Very late" : "Late"}</span>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-zinc-100 bg-zinc-50 px-4 py-2.5 text-xs text-zinc-500">
              <span>
                Showing {pageItems.length} of {filtered.length}
              </span>
              {pageItems.length < filtered.length && (
                <button type="button" onClick={() => setPage((p) => p + 1)} className="font-semibold text-red-600 hover:text-red-700 cursor-pointer">
                  Load {Math.min(PAGE_SIZE, filtered.length - pageItems.length)} more
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="divide-y divide-zinc-100">
            {totalsByWorker.map(([id, t], i) => (
              <div key={id} className="flex flex-wrap items-center gap-4 px-5 py-3.5 transition-colors hover:bg-zinc-50">
                <span className="w-6 text-right text-xs font-semibold text-zinc-400">{i + 1}</span>
                <div className="min-w-[180px] flex-1">
                  <p className="font-medium text-zinc-900">{t.name}</p>
                  <p className="text-[11px] text-zinc-500">{[formatRole(t.role), t.dept].filter(Boolean).join(" · ")}</p>
                </div>
                <div className="flex min-w-[200px] flex-1 items-center gap-3">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-100">
                    <div className="h-full rounded-full bg-red-500" style={{ width: `${(t.hours / maxWorkerHours) * 100}%` }} />
                  </div>
                  <span className="w-16 text-right text-sm font-semibold tabular-nums text-zinc-900">{t.hours.toFixed(1)}h</span>
                </div>
                <div className="flex gap-4 text-center text-xs">
                  <div>
                    <p className="font-semibold text-zinc-900">{t.sessions}</p>
                    <p className="text-[10px] text-zinc-400">sessions</p>
                  </div>
                  <div>
                    <p className={`font-semibold ${t.late ? "text-amber-600" : "text-zinc-400"}`}>{t.late}</p>
                    <p className="text-[10px] text-zinc-400">late</p>
                  </div>
                  <div>
                    <p className={`font-semibold ${t.ot ? "text-violet-600" : "text-zinc-400"}`}>{t.ot.toFixed(1)}h</p>
                    <p className="text-[10px] text-zinc-400">OT</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
