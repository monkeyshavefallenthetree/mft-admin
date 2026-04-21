"use client";

import { useEffect, useState, useMemo } from "react";
import {
  collection,
  onSnapshot,
  doc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { downloadCsv } from "@/lib/admin/csv";

interface ExceptionRequest {
  id: string;
  workerId?: string;
  workerName?: string;
  workerEmail?: string;
  type?: string;
  lateMinutes?: number;
  exceptionDate?: string;
  reason?: string;
  supportingEvidence?: string;
  status?: string;
  adminResponse?: string;
  createdAt?: { toDate: () => Date };
  submittedAt?: { toDate: () => Date };
}

function formatExceptionType(type: string | undefined) {
  if (type === "late") return "Late Arrival";
  if (type === "absent") return "Absent for Day";
  return type || "Unknown";
}

function formatTs(t: { toDate: () => Date } | undefined) {
  if (!t?.toDate) return "";
  return t.toDate().toLocaleString();
}

export default function AdminExceptionsPage() {
  const [items, setItems] = useState<ExceptionRequest[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("all");
  const [workerFilter, setWorkerFilter] = useState("");

  useEffect(() => {
    return onSnapshot(collection(db, "exceptionRequests"), (snap) => {
      const list: ExceptionRequest[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() } as ExceptionRequest));
      list.sort((a, b) => {
        const ta = a.createdAt?.toDate?.()?.getTime() ?? a.submittedAt?.toDate?.()?.getTime() ?? 0;
        const tb = b.createdAt?.toDate?.()?.getTime() ?? b.submittedAt?.toDate?.()?.getTime() ?? 0;
        return tb - ta;
      });
      setItems(list);
    });
  }, []);

  const workerOptions = useMemo(() => {
    const m = new Map<string, string>();
    items.forEach((e) => {
      if (e.workerId && e.workerName) m.set(e.workerId, e.workerName);
    });
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [items]);

  const filtered = useMemo(() => {
    return items.filter((e) => {
      if (statusFilter && (e.status || "pending") !== statusFilter) return false;
      if (typeFilter && e.type !== typeFilter) return false;
      if (workerFilter && e.workerId !== workerFilter) return false;
      if (dateFilter !== "all") {
        const ex = e.createdAt?.toDate?.() ?? e.submittedAt?.toDate?.() ?? new Date(0);
        const now = new Date();
        if (dateFilter === "today" && ex.toDateString() !== now.toDateString()) return false;
        if (dateFilter === "week" && ex < new Date(now.getTime() - 7 * 86400000)) return false;
        if (dateFilter === "month" && ex < new Date(now.getTime() - 30 * 86400000)) return false;
      }
      return true;
    });
  }, [items, statusFilter, typeFilter, dateFilter, workerFilter]);

  const stats = useMemo(() => {
    const pending = filtered.filter((e) => !e.status || e.status === "pending").length;
    const approved = filtered.filter((e) => e.status === "approved").length;
    const rejected = filtered.filter((e) => e.status === "rejected").length;
    const today = new Date().toDateString();
    const todayN = filtered.filter((e) => {
      const ex = e.createdAt?.toDate?.() ?? e.submittedAt?.toDate?.() ?? new Date(0);
      return ex.toDateString() === today;
    }).length;
    return { pending, approved, rejected, total: filtered.length, todayN };
  }, [filtered]);

  const approve = async (id: string) => {
    await updateDoc(doc(db, "exceptionRequests", id), {
      status: "approved",
      approvedAt: serverTimestamp(),
      approvedBy: "admin",
    });
  };

  const reject = async (id: string) => {
    const reason = prompt("Reason for rejection (optional):") || "";
    const u: Record<string, unknown> = {
      status: "rejected",
      rejectedAt: serverTimestamp(),
      rejectedBy: "admin",
    };
    if (reason.trim()) u.adminResponse = reason.trim();
    await updateDoc(doc(db, "exceptionRequests", id), u);
  };

  const addResponse = async (id: string) => {
    const response = prompt("Add response / notes:");
    if (!response?.trim()) return;
    await updateDoc(doc(db, "exceptionRequests", id), {
      adminResponse: response.trim(),
      responseAt: serverTimestamp(),
      responseBy: "admin",
    });
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this exception request?")) return;
    await deleteDoc(doc(db, "exceptionRequests", id));
  };

  const exportCsv = () => {
    const rows: (string | number)[][] = [
      ["Worker", "Email", "Type", "Late min", "Exception date", "Reason", "Status", "Submitted", "Admin response"],
    ];
    for (const e of filtered) {
      rows.push([
        e.workerName || "",
        e.workerEmail || "",
        formatExceptionType(e.type),
        e.lateMinutes ?? "",
        e.exceptionDate || "",
        e.reason || "",
        (e.status || "pending").toUpperCase(),
        formatTs(e.createdAt || e.submittedAt),
        e.adminResponse || "",
      ]);
    }
    downloadCsv(rows, `exception_requests_${new Date().toISOString().split("T")[0]}.csv`);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between gap-4">
        <h2 className="text-2xl font-bold text-red-400">Exception requests</h2>
        <button type="button" onClick={exportCsv} className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 rounded-lg text-sm font-semibold">
          Export CSV
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          ["Pending", stats.pending],
          ["Approved", stats.approved],
          ["Rejected", stats.rejected],
          ["Total", stats.total],
          ["Today", stats.todayN],
        ].map(([label, value]) => (
          <div key={label} className="bg-[#111] border border-red-600/20 rounded-xl p-4 text-center">
            <div className="text-xl font-bold text-red-400">{value as number}</div>
            <div className="text-xs text-zinc-500 uppercase mt-1">{label}</div>
          </div>
        ))}
      </div>

      <div className="bg-[#111] border border-red-600/20 rounded-xl p-5 flex flex-wrap gap-4">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white min-w-[120px]">
          <option value="">All status</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white min-w-[120px]">
          <option value="">All types</option>
          <option value="late">Late</option>
          <option value="absent">Absent</option>
        </select>
        <select value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white min-w-[120px]">
          <option value="all">All time</option>
          <option value="today">Today</option>
          <option value="week">This week</option>
          <option value="month">This month</option>
        </select>
        <select value={workerFilter} onChange={(e) => setWorkerFilter(e.target.value)} className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white min-w-[160px]">
          <option value="">All workers</option>
          {workerOptions.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <p className="text-zinc-500 text-center py-12">No exception requests match filters.</p>
      ) : (
        <div className="space-y-4">
          {filtered.map((e) => (
            <div key={e.id} className="bg-[#111] border border-red-600/20 rounded-xl p-5">
              <div className="flex flex-wrap justify-between gap-2">
                <div>
                  <h3 className="text-lg font-semibold text-white">
                    {formatExceptionType(e.type)}
                    {e.type === "late" && e.lateMinutes != null ? ` (${e.lateMinutes} min)` : ""}
                  </h3>
                  <p className="text-sm text-zinc-400 mt-1">
                    {e.workerName} {e.workerEmail ? `(${e.workerEmail})` : ""}
                  </p>
                </div>
                <span className="px-3 py-1 rounded-full text-xs font-bold border border-white/20 bg-white/5">
                  {(e.status || "pending").toUpperCase()}
                </span>
              </div>
              <div className="text-sm text-zinc-400 mt-3 space-y-1">
                <p>Exception date: {e.exceptionDate || "—"}</p>
                <p>Reason: {e.reason || "—"}</p>
                {e.supportingEvidence && <p>Evidence: {e.supportingEvidence}</p>}
                {e.adminResponse && <p className="text-amber-200/90">Admin: {e.adminResponse}</p>}
                <p className="text-xs text-zinc-600">Submitted: {formatTs(e.createdAt || e.submittedAt)}</p>
              </div>
              <div className="flex flex-wrap gap-2 mt-4">
                {(!e.status || e.status === "pending") && (
                  <>
                    <button type="button" onClick={() => void approve(e.id)} className="px-3 py-1.5 bg-green-600 hover:bg-green-700 rounded-lg text-sm font-semibold">
                      Approve
                    </button>
                    <button type="button" onClick={() => void reject(e.id)} className="px-3 py-1.5 bg-red-800 hover:bg-red-700 rounded-lg text-sm font-semibold">
                      Reject
                    </button>
                  </>
                )}
                <button type="button" onClick={() => void addResponse(e.id)} className="px-3 py-1.5 border border-zinc-600 rounded-lg text-sm">
                  Add response
                </button>
                <button type="button" onClick={() => void remove(e.id)} className="px-3 py-1.5 border border-red-600/50 text-red-300 rounded-lg text-sm">
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
