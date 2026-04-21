"use client";

import { useEffect, useState, useMemo } from "react";
import { collection, onSnapshot, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { downloadCsv } from "@/lib/admin/csv";
import { sessionHours } from "@/lib/admin/workTime";

interface WorkSession {
  id: string;
  workerId?: string;
  workerName?: string;
  workerEmail?: string;
  date?: string;
  loginTime?: Timestamp | null;
  logoutTime?: Timestamp | null;
  totalWorkTime?: number;
  isActive?: boolean;
  attendanceStatus?: string;
}

interface WorkerOpt {
  id: string;
  firstName: string;
  lastName: string;
}

export default function AdminWorkSessionsPage() {
  const [sessions, setSessions] = useState<WorkSession[]>([]);
  const [workers, setWorkers] = useState<WorkerOpt[]>([]);
  const [workerFilter, setWorkerFilter] = useState("");
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
      const d = s.date || "";
      if (dateFrom && d && d < dateFrom) return false;
      if (dateTo && d && d > dateTo) return false;
      return true;
    });
  }, [sessions, workerFilter, dateFrom, dateTo]);

  const summary = useMemo(() => {
    let totalMs = 0;
    const workersSet = new Set<string>();
    let onTime = 0;
    let late = 0;
    for (const s of filtered) {
      totalMs += s.totalWorkTime || 0;
      if (s.workerId) workersSet.add(s.workerId);
      if (s.loginTime) {
        const h = s.loginTime.toDate().getHours() + s.loginTime.toDate().getMinutes() / 60;
        if (h >= 12) late += 1;
        else if (h >= 11) late += 1;
        else onTime += 1;
      }
    }
    const totalH = Math.round((totalMs / (1000 * 60 * 60)) * 10) / 10;
    const avg =
      filtered.length > 0 ? Math.round((totalMs / filtered.length / (1000 * 60 * 60)) * 10) / 10 : 0;
    return { totalMs, totalH, count: filtered.length, workers: workersSet.size, onTime, late, avg };
  }, [filtered]);

  const totalsByWorker = useMemo(() => {
    const map: Record<string, { name: string; hours: number; sessions: number }> = {};
    for (const s of filtered) {
      const id = s.workerId || "unknown";
      if (!map[id]) map[id] = { name: s.workerName || id, hours: 0, sessions: 0 };
      map[id].hours += sessionHours(s);
      map[id].sessions += 1;
    }
    return Object.entries(map).sort((a, b) => b[1].hours - a[1].hours);
  }, [filtered]);

  const exportCsv = () => {
    const rows: (string | number)[][] = [
      ["Worker", "Date", "Login", "Logout", "Hours", "Active", "Status"],
    ];
    for (const s of filtered) {
      rows.push([
        s.workerName || "",
        s.date || "",
        s.loginTime ? s.loginTime.toDate().toLocaleString() : "",
        s.logoutTime ? s.logoutTime.toDate().toLocaleString() : s.isActive ? "Active" : "",
        sessionHours(s).toFixed(2),
        s.isActive ? "yes" : "no",
        s.attendanceStatus || "",
      ]);
    }
    downloadCsv(rows, `work_sessions_${new Date().toISOString().split("T")[0]}.csv`);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-2xl font-bold text-red-400">Work time reports</h2>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={exportCsv} className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 rounded-lg text-sm font-semibold">
            Export CSV
          </button>
        </div>
      </div>

      <div className="bg-[#111] border border-red-600/20 rounded-xl p-5 flex flex-wrap gap-4">
        <div className="flex flex-col gap-1 min-w-[160px]">
          <label className="text-xs text-zinc-500 uppercase font-semibold">Worker</label>
          <select
            value={workerFilter}
            onChange={(e) => setWorkerFilter(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
          >
            <option value="">All workers</option>
            {workers.map((w) => (
              <option key={w.id} value={w.id}>
                {w.firstName} {w.lastName}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-zinc-500 uppercase font-semibold">From</label>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-zinc-500 uppercase font-semibold">To</label>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
        </div>
        <div className="flex flex-col gap-1 min-w-[160px]">
          <label className="text-xs text-zinc-500 uppercase font-semibold">View</label>
          <select value={viewType} onChange={(e) => setViewType(e.target.value as "sessions" | "totals")} className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white">
            <option value="sessions">Individual sessions</option>
            <option value="totals">Worker totals</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total hours (filtered)", value: `${summary.totalH}h` },
          { label: "Sessions", value: summary.count },
          { label: "Workers", value: summary.workers },
          { label: "Avg / session", value: `${summary.avg}h` },
        ].map((s) => (
          <div key={s.label} className="bg-[#111] border border-red-600/20 rounded-xl p-4 text-center">
            <div className="text-xl font-bold text-red-400">{s.value}</div>
            <div className="text-xs text-zinc-500 mt-1 uppercase">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-amber-600/30 bg-amber-950/20 p-4 text-sm text-zinc-300">
        <strong className="text-amber-400">Work policy (reference)</strong>
        <p className="mt-2">
          Work starts 10:00 · Late 11–12 (−0.25 day) · Very late 12+ (−0.5 day) · Daily OT over 8h at 1.5× · Monthly OT over 22 days at 1.5× per day.
        </p>
      </div>

      {filtered.length === 0 ? (
        <p className="text-zinc-500 text-center py-12">No sessions match filters.</p>
      ) : viewType === "sessions" ? (
        <div className="space-y-3">
          {filtered.map((s) => {
            const h = sessionHours(s);
            const reg = Math.min(8, h);
            const ot = Math.max(0, h - 8);
            return (
              <div key={s.id} className="bg-[#111] border border-red-600/20 rounded-xl p-4">
                <div className="flex justify-between flex-wrap gap-2">
                  <span className="font-semibold text-white">{s.workerName || "Unknown"}</span>
                  <span className="text-sm text-zinc-500">{s.date}</span>
                </div>
                <p className="text-sm text-zinc-400 mt-2">
                  Login: {s.loginTime ? s.loginTime.toDate().toLocaleString() : "—"} · Logout:{" "}
                  {s.logoutTime ? s.logoutTime.toDate().toLocaleString() : s.isActive ? "Active" : "—"}
                </p>
                <p className="text-sm text-zinc-400 mt-1">
                  {h.toFixed(2)}h total ({reg.toFixed(2)}h reg + {ot.toFixed(2)}h OT) · {s.isActive ? "Active" : "Completed"}
                </p>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-3">
          {totalsByWorker.map(([id, t]) => (
            <div key={id} className="bg-[#111] border border-red-600/20 rounded-xl p-4 flex justify-between flex-wrap gap-2">
              <span className="font-semibold text-white">{t.name}</span>
              <span className="text-zinc-400">
                {t.sessions} sessions · {t.hours.toFixed(2)}h
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
