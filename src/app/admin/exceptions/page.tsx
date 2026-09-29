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
  approvedAt?: { toDate: () => Date };
  approvedBy?: string;
  rejectedAt?: { toDate: () => Date };
  rejectedBy?: string;
  responseAt?: { toDate: () => Date };
  responseBy?: string;
  createdAt?: { toDate: () => Date };
  submittedAt?: { toDate: () => Date };
}

function formatExceptionType(type: string | undefined) {
  if (type === "late") return "Late Arrival";
  if (type === "absent") return "Absent for Day";
  return type || "Unknown Exception";
}

function formatTs(t: { toDate: () => Date } | undefined) {
  if (!t?.toDate) return "—";
  return t.toDate().toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AdminExceptionsPage() {
  const [items, setItems] = useState<ExceptionRequest[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("all");
  const [workerFilter, setWorkerFilter] = useState("");

  const [responseModal, setResponseModal] = useState<{
    id: string;
    workerName: string;
    mode: "reject" | "response";
  } | null>(null);
  const [modalText, setModalText] = useState("");

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

  const openRejectModal = (id: string, workerName: string) => {
    setModalText("");
    setResponseModal({ id, workerName, mode: "reject" });
  };

  const openResponseModal = (id: string, workerName: string) => {
    setModalText("");
    setResponseModal({ id, workerName, mode: "response" });
  };

  const submitModalAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!responseModal) return;

    if (responseModal.mode === "reject") {
      const u: Record<string, unknown> = {
        status: "rejected",
        rejectedAt: serverTimestamp(),
        rejectedBy: "admin",
      };
      if (modalText.trim()) u.adminResponse = modalText.trim();
      await updateDoc(doc(db, "exceptionRequests", responseModal.id), u);
    } else {
      if (!modalText.trim()) return;
      await updateDoc(doc(db, "exceptionRequests", responseModal.id), {
        adminResponse: modalText.trim(),
        responseAt: serverTimestamp(),
        responseBy: "admin",
      });
    }

    setResponseModal(null);
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this exception request?")) return;
    await deleteDoc(doc(db, "exceptionRequests", id));
  };

  const exportCsv = () => {
    const rows: (string | number)[][] = [
      ["Worker", "Email", "Type", "Late Minutes", "Exception Date", "Reason", "Evidence", "Status", "Submitted", "Admin Response"],
    ];
    for (const e of filtered) {
      rows.push([
        e.workerName || "",
        e.workerEmail || "",
        formatExceptionType(e.type),
        e.lateMinutes ?? "",
        e.exceptionDate || "",
        e.reason || "",
        e.supportingEvidence || "",
        (e.status || "pending").toUpperCase(),
        formatTs(e.createdAt || e.submittedAt),
        e.adminResponse || "",
      ]);
    }
    downloadCsv(rows, `exception_requests_${new Date().toISOString().split("T")[0]}.csv`);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b-2 border-zinc-900">
        <div>
          <h2 className="text-2xl font-black text-zinc-950 font-heading tracking-tight uppercase">
            Exception &amp; Time-Off Requests
          </h2>
          <p className="text-xs text-zinc-600 font-mono mt-0.5">
            Worker Attendance Exceptions, Late Justifications &amp; Approvals
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

      {/* Stats Counters */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Verify Pending", value: stats.pending, color: "text-amber-700" },
          { label: "Approved Requests", value: stats.approved, color: "text-emerald-700" },
          { label: "Rejected Units", value: stats.rejected, color: "text-red-700" },
          { label: "Total Filtered", value: stats.total, color: "text-zinc-950" },
          { label: "Submitted Today", value: stats.todayN, color: "text-zinc-950" },
        ].map((s) => (
          <div key={s.label} className="bg-white border-2 border-zinc-900 shadow-[3px_3px_0px_0px_#09090b] p-4 text-center">
            <div className={`text-2xl font-black font-heading ${s.color}`}>{s.value}</div>
            <div className="text-[10px] font-bold uppercase font-mono tracking-wider text-zinc-600 mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filter Bar */}
      <div className="bg-white border-2 border-zinc-900 shadow-[3px_3px_0px_0px_#09090b] p-4 flex flex-wrap gap-3 font-mono">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-white border-2 border-zinc-900 px-3 py-2 text-xs font-mono font-bold text-zinc-950 focus:outline-none focus:ring-2 focus:ring-red-600 min-w-[120px]"
        >
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="bg-white border-2 border-zinc-900 px-3 py-2 text-xs font-mono font-bold text-zinc-950 focus:outline-none focus:ring-2 focus:ring-red-600 min-w-[120px]"
        >
          <option value="">All Exception Types</option>
          <option value="late">Late Arrival</option>
          <option value="absent">Absence</option>
        </select>
        <select
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
          className="bg-white border-2 border-zinc-900 px-3 py-2 text-xs font-mono font-bold text-zinc-950 focus:outline-none focus:ring-2 focus:ring-red-600 min-w-[120px]"
        >
          <option value="all">All Time</option>
          <option value="today">Today</option>
          <option value="week">This Week</option>
          <option value="month">This Month</option>
        </select>
        <select
          value={workerFilter}
          onChange={(e) => setWorkerFilter(e.target.value)}
          className="bg-white border-2 border-zinc-900 px-3 py-2 text-xs font-mono font-bold text-zinc-950 focus:outline-none focus:ring-2 focus:ring-red-600 min-w-[160px]"
        >
          <option value="">All Workers</option>
          {workerOptions.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </div>

      {/* Exception Request Cards */}
      {filtered.length === 0 ? (
        <div className="p-16 text-center bg-white border-2 border-zinc-900 shadow-[3px_3px_0px_0px_#09090b]">
          <p className="text-xs font-mono font-bold uppercase tracking-widest text-zinc-500">
            No exception requests match current filters.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((e) => (
            <div
              key={e.id}
              className="bg-white border-2 border-zinc-900 p-5 shadow-[4px_4px_0px_0px_#09090b] font-mono text-xs hover:border-red-600 transition-colors"
            >
              <div className="flex flex-wrap justify-between items-start gap-2 pb-3 border-b border-zinc-200">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-bold font-heading text-zinc-950 uppercase tracking-wide">
                      {formatExceptionType(e.type)}
                    </h3>
                    {e.type === "late" && e.lateMinutes != null && (
                      <span className="px-2 py-0.5 text-xs font-bold bg-amber-50 text-amber-900 border border-amber-400">
                        ⏱️ {e.lateMinutes} MINUTES LATE
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-700 mt-1 font-bold">
                    👤 {e.workerName} {e.workerEmail ? `(${e.workerEmail})` : ""}
                  </p>
                </div>
                <span
                  className={`px-3 py-1 text-xs font-bold border ${
                    e.status === "approved"
                      ? "bg-emerald-50 text-emerald-800 border-emerald-400"
                      : e.status === "rejected"
                        ? "bg-red-50 text-red-800 border-red-400"
                        : "bg-amber-50 text-amber-900 border-amber-400"
                  }`}
                >
                  {(e.status || "pending").toUpperCase()}
                </span>
              </div>

              <div className="mt-3 space-y-2 text-zinc-800">
                <p>
                  <span className="text-zinc-500 font-medium">EXCEPTION DATE:</span>{" "}
                  <strong className="text-zinc-950">{e.exceptionDate || "Not specified"}</strong>
                </p>
                <div className="bg-zinc-50 border border-zinc-200 p-3">
                  <span className="text-[10px] uppercase font-bold text-zinc-500 block mb-1">Worker Reason / Excuse:</span>
                  <p className="whitespace-pre-wrap text-zinc-900">{e.reason || "No written reason provided"}</p>
                </div>

                {e.supportingEvidence && (
                  <div className="bg-zinc-50 border border-zinc-200 p-3">
                    <span className="text-[10px] uppercase font-bold text-zinc-500 block mb-1">Supporting Evidence / Attachment:</span>
                    {e.supportingEvidence.startsWith("http") ? (
                      <a
                        href={e.supportingEvidence}
                        target="_blank"
                        rel="noreferrer"
                        className="text-red-600 underline font-bold inline-flex items-center gap-1 break-all"
                      >
                        🔗 View Evidence Document ↗
                      </a>
                    ) : (
                      <p className="text-zinc-900 break-all">{e.supportingEvidence}</p>
                    )}
                  </div>
                )}

                {e.adminResponse && (
                  <div className="bg-amber-50 border border-amber-300 p-3 text-amber-950">
                    <span className="text-[10px] uppercase font-bold text-amber-900 block mb-1">Admin Response / Notes:</span>
                    <p className="whitespace-pre-wrap font-medium">{e.adminResponse}</p>
                    {e.responseBy && (
                      <p className="text-[10px] text-amber-800 mt-1">
                        By {e.responseBy} · {formatTs(e.responseAt)}
                      </p>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-4 text-zinc-500 text-[10px] pt-1">
                  <span>SUBMITTED: {formatTs(e.createdAt || e.submittedAt)}</span>
                  {e.approvedAt && <span>APPROVED: {formatTs(e.approvedAt)} ({e.approvedBy || "admin"})</span>}
                  {e.rejectedAt && <span>REJECTED: {formatTs(e.rejectedAt)} ({e.rejectedBy || "admin"})</span>}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-zinc-200">
                {(!e.status || e.status === "pending") && (
                  <>
                    <button
                      type="button"
                      onClick={() => void approve(e.id)}
                      className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-xs font-bold uppercase border-2 border-zinc-900 shadow-[2px_2px_0px_0px_#09090b] cursor-pointer"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => openRejectModal(e.id, e.workerName || "Worker")}
                      className="px-4 py-1.5 bg-red-600 hover:bg-red-700 text-white font-mono text-xs font-bold uppercase border-2 border-zinc-900 shadow-[2px_2px_0px_0px_#09090b] cursor-pointer"
                    >
                      Reject
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => openResponseModal(e.id, e.workerName || "Worker")}
                  className="px-3.5 py-1.5 border-2 border-zinc-900 bg-white hover:bg-zinc-100 text-zinc-950 font-mono text-xs font-bold uppercase shadow-[2px_2px_0px_0px_#09090b] cursor-pointer"
                >
                  Add Response Note
                </button>
                <button
                  type="button"
                  onClick={() => void remove(e.id)}
                  className="ml-auto px-3 py-1.5 border border-zinc-300 hover:border-red-500 text-red-700 hover:bg-red-50 font-mono text-xs font-bold uppercase cursor-pointer"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Response / Rejection Modal */}
      {responseModal && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 font-mono text-zinc-950"
          onClick={() => setResponseModal(null)}
        >
          <div
            className="bg-white border-2 border-zinc-900 shadow-[8px_8px_0px_0px_#09090b] w-full max-w-md p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center pb-2 border-b-2 border-zinc-900">
              <h3 className="text-lg font-black font-heading uppercase text-zinc-950">
                {responseModal.mode === "reject" ? "Reject Exception Request" : "Add Admin Response"}
              </h3>
              <button
                type="button"
                onClick={() => setResponseModal(null)}
                className="text-2xl font-bold text-zinc-500 hover:text-red-600 cursor-pointer"
              >
                &times;
              </button>
            </div>
            <p className="text-xs text-zinc-600">
              Target Operator: <strong>{responseModal.workerName}</strong>
            </p>
            <form onSubmit={submitModalAction} className="space-y-4">
              <div>
                <label className="block text-xs uppercase font-bold text-zinc-700 mb-1">
                  {responseModal.mode === "reject" ? "Reason for Rejection (Optional)" : "Response / Decision Notes *"}
                </label>
                <textarea
                  rows={4}
                  required={responseModal.mode === "response"}
                  value={modalText}
                  onChange={(e) => setModalText(e.target.value)}
                  placeholder="Enter details visible to the operator..."
                  className="w-full bg-white border-2 border-zinc-900 px-3 py-2 text-xs font-mono text-zinc-950 focus:outline-none focus:ring-2 focus:ring-red-600 resize-y"
                />
              </div>
              <div className="flex gap-2 justify-end pt-2 border-t-2 border-zinc-900">
                <button
                  type="button"
                  onClick={() => setResponseModal(null)}
                  className="px-4 py-2 border-2 border-zinc-900 bg-white hover:bg-zinc-100 text-zinc-950 text-xs font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={`px-4 py-2 text-white font-mono text-xs font-bold uppercase tracking-wider border-2 border-zinc-900 shadow-[2px_2px_0px_0px_#09090b] cursor-pointer ${
                    responseModal.mode === "reject" ? "bg-red-600 hover:bg-red-700" : "bg-zinc-900 hover:bg-zinc-800"
                  }`}
                >
                  {responseModal.mode === "reject" ? "Confirm Rejection" : "Save Response"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
