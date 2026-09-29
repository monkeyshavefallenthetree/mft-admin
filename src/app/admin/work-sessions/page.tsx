"use client";

import { useEffect, useState, useMemo } from "react";
import { collection, onSnapshot, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { downloadCsv } from "@/lib/admin/csv";
import { sessionHours } from "@/lib/admin/workTime";
import { DEPARTMENTS } from "@/lib/admin/constants";

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

export default function AdminWorkSessionsPage() {
  const [sessions, setSessions] = useState<WorkSession[]>([]);
  const [workers, setWorkers] = useState<WorkerOpt[]>([]);
  const [workerFilter, setWorkerFilter] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [viewType, setViewType] = useState<"sessions" | "totals">("sessions");

  useEffect(() => {
    return onSnapshot(collection(db, "workSessions"), (snap) => {
      const list: WorkSession[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() } as WorkSession));
      list.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      setSessions(list);
    });
  }, []);

  useEffect(() => {
    return onSnapshot(collection(db, "workers"), (snap) => {
      const list: WorkerOpt[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() } as WorkerOpt));
      setWorkers(list);
    });
  }, []);

  const filtered = useMemo(() => {
    return sessions.filter((s) => {
      if (workerFilter && s.workerId !== workerFilter) return false;
      if (departmentFilter && (s.department || "") !== departmentFilter) return false;
      const d = s.date || "";
      if (dateFrom && d && d < dateFrom) return false;
      if (dateTo && d && d > dateTo) return false;
      return true;
    });
  }, [sessions, workerFilter, departmentFilter, dateFrom, dateTo]);

  const summary = useMemo(() => {
    let totalMs = 0;
    const workersSet = new Set<string>();
    let onTime = 0;
    let late = 0;
    for (const s of filtered) {
      totalMs += s.totalWorkTime || 0;
      if (s.workerId) workersSet.add(s.workerId);
      if (s.isLate || s.attendanceStatus === "late" || s.attendanceStatus === "very-late") {
        late += 1;
      } else if (s.loginTime) {
        const h = s.loginTime.toDate().getHours() + s.loginTime.toDate().getMinutes() / 60;
        if (h >= 11) late += 1;
        else onTime += 1;
      } else {
        onTime += 1;
      }
    }
    const totalH = Math.round((totalMs / (1000 * 60 * 60)) * 10) / 10;
    const avg =
      filtered.length > 0 ? Math.round((totalMs / filtered.length / (1000 * 60 * 60)) * 10) / 10 : 0;
    return { totalMs, totalH, count: filtered.length, workers: workersSet.size, onTime, late, avg };
  }, [filtered]);

  const totalsByWorker = useMemo(() => {
    const map: Record<string, { name: string; dept?: string; hours: number; sessions: number }> = {};
    for (const s of filtered) {
      const id = s.workerId || "unknown";
      if (!map[id]) map[id] = { name: s.workerName || id, dept: s.department, hours: 0, sessions: 0 };
      map[id].hours += sessionHours(s);
      map[id].sessions += 1;
    }
    return Object.entries(map).sort((a, b) => b[1].hours - a[1].hours);
  }, [filtered]);

  const exportCsv = () => {
    const rows: (string | number)[][] = [
      ["Worker", "Department", "Role", "Date", "Login", "Logout", "Hours", "Late Status", "Active Status"],
    ];
    for (const s of filtered) {
      rows.push([
        s.workerName || "",
        s.department || "",
        s.role || "",
        s.date || "",
        s.loginTime ? s.loginTime.toDate().toLocaleString() : "",
        s.logoutTime ? s.logoutTime.toDate().toLocaleString() : s.isActive ? "Active" : "",
        sessionHours(s).toFixed(2),
        s.isLate ? "Late" : "On-Time",
        s.isActive ? "yes" : "no",
      ]);
    }
    downloadCsv(rows, `work_sessions_${new Date().toISOString().split("T")[0]}.csv`);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b-2 border-zinc-900">
        <div>
          <h2 className="text-2xl font-black text-zinc-950 font-heading tracking-tight uppercase">
            Work Time Reports
          </h2>
          <p className="text-xs text-zinc-600 font-mono mt-0.5">
            Operational Attendance, Session Logs &amp; Shift Telemetry
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={exportCsv}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-mono text-xs font-bold uppercase tracking-wider border-2 border-zinc-900 shadow-[2px_2px_0px_0px_#09090b] cursor-pointer"
          >
            Export CSV
          </button>
        </div>
      </div>

      {/* Summary Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Logged Hours", value: `${summary.totalH}h`, color: "text-zinc-950" },
          { label: "Session Logs", value: summary.count, color: "text-zinc-950" },
          { label: "Active Workers", value: summary.workers, color: "text-emerald-700" },
          { label: "Flagged Late", value: summary.late, color: "text-amber-700" },
        ].map((s) => (
          <div key={s.label} className="bg-white border-2 border-zinc-900 shadow-[3px_3px_0px_0px_#09090b] p-4 text-center">
            <div className={`text-2xl font-black font-heading ${s.color}`}>{s.value}</div>
            <div className="text-[10px] font-bold uppercase font-mono tracking-wider text-zinc-600 mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white border-2 border-zinc-900 shadow-[3px_3px_0px_0px_#09090b] p-4 flex flex-wrap gap-3 font-mono">
        <div className="flex flex-col gap-1 min-w-[160px] flex-1">
          <label className="text-[10px] text-zinc-700 uppercase font-bold tracking-wider">Worker</label>
          <select
            value={workerFilter}
            onChange={(e) => setWorkerFilter(e.target.value)}
            className="bg-white border-2 border-zinc-900 px-3 py-2 text-xs text-zinc-950 font-bold focus:outline-none focus:ring-2 focus:ring-red-600"
          >
            <option value="">All workers</option>
            {workers.map((w) => (
              <option key={w.id} value={w.id}>
                {w.firstName} {w.lastName}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1 min-w-[140px]">
          <label className="text-[10px] text-zinc-700 uppercase font-bold tracking-wider">Department</label>
          <select
            value={departmentFilter}
            onChange={(e) => setDepartmentFilter(e.target.value)}
            className="bg-white border-2 border-zinc-900 px-3 py-2 text-xs text-zinc-950 font-bold focus:outline-none focus:ring-2 focus:ring-red-600"
          >
            <option value="">All departments</option>
            {DEPARTMENTS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label.toUpperCase()}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-zinc-700 uppercase font-bold tracking-wider">From Date</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="bg-white border-2 border-zinc-900 px-3 py-2 text-xs text-zinc-950 font-bold focus:outline-none focus:ring-2 focus:ring-red-600"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-zinc-700 uppercase font-bold tracking-wider">To Date</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="bg-white border-2 border-zinc-900 px-3 py-2 text-xs text-zinc-950 font-bold focus:outline-none focus:ring-2 focus:ring-red-600"
          />
        </div>
        <div className="flex flex-col gap-1 min-w-[140px]">
          <label className="text-[10px] text-zinc-700 uppercase font-bold tracking-wider">Display Mode</label>
          <select
            value={viewType}
            onChange={(e) => setViewType(e.target.value as "sessions" | "totals")}
            className="bg-white border-2 border-zinc-900 px-3 py-2 text-xs text-zinc-950 font-bold focus:outline-none focus:ring-2 focus:ring-red-600"
          >
            <option value="sessions">Individual sessions</option>
            <option value="totals">Worker totals</option>
          </select>
        </div>
      </div>

      {/* Policy Reference Alert */}
      <div className="border-2 border-amber-500 bg-amber-50 p-3 text-xs font-mono text-amber-950 shadow-[2px_2px_0px_0px_#d97706]">
        <strong className="font-bold uppercase tracking-wider text-amber-900">Attendance Policy Thresholds:</strong> Work starts at 10:00 · Late 11:00–12:00 (−0.25 day) · Very late 12:00+ (−0.5 day) · Daily OT applies over 8h.
      </div>

      {filtered.length === 0 ? (
        <div className="p-16 text-center bg-white border-2 border-zinc-900 shadow-[3px_3px_0px_0px_#09090b]">
          <p className="text-xs font-mono font-bold uppercase tracking-widest text-zinc-500">
            No work sessions match current filters.
          </p>
        </div>
      ) : viewType === "sessions" ? (
        <div className="space-y-3">
          {filtered.map((s) => {
            const h = sessionHours(s);
            const reg = Math.min(8, h);
            const ot = Math.max(0, h - 8);
            const isLate = s.isLate || s.attendanceStatus === "late" || s.attendanceStatus === "very-late";

            return (
              <div
                key={s.id}
                className="bg-white border-2 border-zinc-900 p-4 shadow-[2px_2px_0px_0px_#09090b] font-mono text-xs hover:border-red-600 transition-colors"
              >
                <div className="flex justify-between items-start flex-wrap gap-2 pb-2 border-b border-zinc-200">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-sm text-zinc-950 font-heading">{s.workerName || "Unknown Worker"}</span>
                    {s.role && (
                      <span className="text-[10px] font-bold text-red-600 bg-red-50 border border-red-300 px-1.5 py-0.5">
                        {formatRole(s.role)}
                      </span>
                    )}
                    {s.department && (
                      <span className="text-[10px] font-bold text-zinc-800 bg-zinc-100 border border-zinc-300 px-1.5 py-0.5 uppercase">
                        {s.department}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {isLate && (
                      <span className="px-2 py-0.5 text-[10px] font-bold bg-amber-50 text-amber-900 border border-amber-400">
                        ⚠️ LATE ARRIVAL
                      </span>
                    )}
                    <span className={`px-2 py-0.5 text-[10px] font-bold border ${s.isActive ? "bg-emerald-50 text-emerald-800 border-emerald-400" : "bg-zinc-100 text-zinc-700 border-zinc-300"}`}>
                      {s.isActive ? "🟢 ACTIVE SHIFT" : "COMPLETED"}
                    </span>
                    <span className="text-zinc-600 font-bold">{s.date}</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2 pt-1 text-zinc-700">
                  <p>
                    <span className="text-zinc-500">CLOCK-IN:</span>{" "}
                    <strong>{s.loginTime ? s.loginTime.toDate().toLocaleString([], { hour: "2-digit", minute: "2-digit" }) : "—"}</strong>
                    {" · "}
                    <span className="text-zinc-500">CLOCK-OUT:</span>{" "}
                    <strong>{s.logoutTime ? s.logoutTime.toDate().toLocaleString([], { hour: "2-digit", minute: "2-digit" }) : s.isActive ? "Active Now" : "—"}</strong>
                  </p>
                  <p className="md:text-right">
                    <span className="text-zinc-500">SHIFT TIME:</span>{" "}
                    <strong className="text-zinc-950">{h.toFixed(2)}h total</strong>
                    {" "}({reg.toFixed(2)}h reg {ot > 0 ? `+ ${ot.toFixed(2)}h OT` : ""})
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-3">
          {totalsByWorker.map(([id, t]) => (
            <div
              key={id}
              className="bg-white border-2 border-zinc-900 p-4 shadow-[2px_2px_0px_0px_#09090b] font-mono text-xs flex justify-between items-center flex-wrap gap-2"
            >
              <div>
                <span className="font-bold text-sm text-zinc-950 font-heading">{t.name}</span>
                {t.dept && (
                  <span className="ml-2 text-[10px] font-bold text-zinc-600 bg-zinc-100 border border-zinc-300 px-1.5 py-0.5 uppercase">
                    {t.dept}
                  </span>
                )}
              </div>
              <div className="font-bold text-sm text-zinc-950">
                {t.sessions} sessions · <span className="text-red-600">{t.hours.toFixed(2)}h</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
