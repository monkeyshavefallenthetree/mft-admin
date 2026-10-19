"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, doc, setDoc, updateDoc, serverTimestamp, writeBatch, addDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { downloadCsv } from "@/lib/admin/csv";
import { useUrlState } from "@/lib/admin/useUrlState";
import { toast, confirmDialog } from "@/lib/admin/feedback";
import { logActivity } from "@/lib/admin/activity";
import { sendExpoPushToWorkers } from "@/lib/chatNotifications";
import { notifyAdmins } from "@/lib/adminNotifications";
import { BulkBar, BulkButton, EmptyState, PageHeader, SkeletonRows, STATE_ICONS } from "@/components/admin/ui/States";
import { ICONS } from "@/lib/admin/nav";
import ModalPortal from "@/components/admin/ui/ModalPortal";
import ExceptionPolicyInsight, { checkAnnualLeave, type InsightWorker } from "@/components/admin/hr/ExceptionPolicyInsight";
import { chargeableMinutes, policyConfigFromSettings } from "@/lib/admin/hrPolicy2026";
import { DEFAULT_HR_SETTINGS, type HrSettings } from "@/lib/admin/hrReports";
import { subscribeHrSettings } from "@/lib/admin/hrSettings";

interface ExceptionRequest {
  id: string;
  workerId?: string;
  workerName?: string;
  workerEmail?: string;
  type?: string;
  lateMinutes?: number;
  leaveDays?: number;
  requestedAmount?: number;
  exceptionDate?: string;
  endDate?: string;
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
  if (type === "late") return "Late arrival (تأخير)";
  if (type === "advance_late") return "Advance Late Permission (إذن تأخير مسبق)";
  if (type === "absent") return "Absent for day (غياب)";
  if (type === "overtime") return "Overtime request (وقت إضافي)";
  if (type === "annual_leave") return "Annual Leave (إجازة سنوية)";
  if (type === "unpaid_leave") return "Unpaid Leave (إجازة بدون مرتب)";
  if (type === "sick_leave") return "Sick Leave (إجازة مرضية)";
  if (type === "emergency_leave") return "Emergency Leave (إجازة عارضة)";
  if (type === "advance_request") return "Salary Advance (سلفة)";
  return type || "Other";
}

function formatTs(t: { toDate: () => Date } | undefined) {
  if (!t?.toDate) return "—";
  return t.toDate().toLocaleString([], { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatSubmittedYmd(t: { toDate: () => Date } | undefined) {
  if (!t?.toDate) return "—";
  const d = t.toDate();
  const ymdStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const timeStr = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `${ymdStr} (${timeStr})`;
}

function timeAgo(t: { toDate: () => Date } | undefined) {
  if (!t?.toDate) return "";
  const s = Math.floor((Date.now() - t.toDate().getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const adminId = () => auth.currentUser?.email ?? "admin";
const statusOf = (e: ExceptionRequest) => e.status || "pending";

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rejected: "bg-red-50 text-red-700 border-red-200",
};

function Svg({ d, className = "h-4 w-4" }: { d: string; className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

export default function AdminExceptionsPage() {
  const [items, setItems] = useState<ExceptionRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useUrlState("status", "pending");
  const [typeFilter, setTypeFilter] = useUrlState("type");
  const [dateFilter, setDateFilter] = useUrlState("date", "all");
  const [workerFilter, setWorkerFilter] = useUrlState("worker");
  const [search, setSearch] = useUrlState("q");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const [responseModal, setResponseModal] = useState<{ ids: string[]; workerName: string; mode: "reject" | "response" } | null>(null);
  const [modalText, setModalText] = useState("");
  const [workersById, setWorkersById] = useState<Map<string, InsightWorker>>(new Map());
  const [hrSettings, setHrSettings] = useState<HrSettings>(DEFAULT_HR_SETTINGS);
  const policyCfg = useMemo(() => policyConfigFromSettings(hrSettings), [hrSettings]);

  useEffect(() => subscribeHrSettings(setHrSettings), []);
  useEffect(() => {
    return onSnapshot(
      collection(db, "workers"),
      (snap) => {
        const m = new Map<string, InsightWorker>();
        snap.forEach((d) => m.set(d.id, { id: d.id, ...d.data() } as InsightWorker));
        setWorkersById(m);
      },
      () => setWorkersById(new Map()),
    );
  }, []);

  useEffect(() => {
    return onSnapshot(
      collection(db, "exceptionRequests"),
      (snap) => {
        const list: ExceptionRequest[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() } as ExceptionRequest));
        list.sort((a, b) => {
          const ta = a.createdAt?.toDate?.()?.getTime() ?? a.submittedAt?.toDate?.()?.getTime() ?? 0;
          const tb = b.createdAt?.toDate?.()?.getTime() ?? b.submittedAt?.toDate?.()?.getTime() ?? 0;
          return tb - ta;
        });
        setItems(list);
        setLoading(false);
      },
      (err) => {
        setLoading(false);
        toast.error("Couldn't load exception requests", { description: err.message });
      },
    );
  }, []);

  const workerOptions = useMemo(() => {
    const m = new Map<string, string>();
    items.forEach((e) => {
      if (e.workerId && e.workerName) m.set(e.workerId, e.workerName);
    });
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [items]);

  /** Everything except the status tab — used for tab counts. */
  const baseFiltered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((e) => {
      if (typeFilter && e.type !== typeFilter) return false;
      if (workerFilter && e.workerId !== workerFilter) return false;
      if (q && !`${e.workerName ?? ""} ${e.workerEmail ?? ""} ${e.reason ?? ""}`.toLowerCase().includes(q)) return false;
      if (dateFilter !== "all") {
        const ex = e.createdAt?.toDate?.() ?? e.submittedAt?.toDate?.() ?? new Date(0);
        const now = new Date();
        if (dateFilter === "today" && ex.toDateString() !== now.toDateString()) return false;
        if (dateFilter === "week" && ex < new Date(now.getTime() - 7 * 86400000)) return false;
        if (dateFilter === "month" && ex < new Date(now.getTime() - 30 * 86400000)) return false;
      }
      return true;
    });
  }, [items, typeFilter, workerFilter, dateFilter, search]);

  const filtered = useMemo(() => (statusFilter ? baseFiltered.filter((e) => statusOf(e) === statusFilter) : baseFiltered), [baseFiltered, statusFilter]);

  const counts = useMemo(() => {
    const c = { pending: 0, approved: 0, rejected: 0, all: baseFiltered.length };
    baseFiltered.forEach((e) => {
      const s = statusOf(e) as "pending" | "approved" | "rejected";
      if (s in c) c[s]++;
    });
    return c;
  }, [baseFiltered]);

  const todayN = useMemo(() => {
    const today = new Date().toDateString();
    return items.filter((e) => (e.createdAt?.toDate?.() ?? e.submittedAt?.toDate?.() ?? new Date(0)).toDateString() === today).length;
  }, [items]);

  // Drop selections that are no longer visible.
  useEffect(() => {
    setSelected((prev) => {
      const visible = new Set(filtered.map((f) => f.id));
      const next = new Set([...prev].filter((id) => visible.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [filtered]);

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const allSelected = filtered.length > 0 && filtered.every((f) => selected.has(f.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(filtered.map((f) => f.id)));

  const byId = (id: string) => items.find((i) => i.id === id);

  const approve = async (requestedIds: string[]) => {
    // HR-POL-2026: annual leave cannot be approved during probation or beyond the accrued balance.
    const blocked: string[] = [];
    const ids = requestedIds.filter((id) => {
      const e = byId(id);
      if (e?.type !== "annual_leave" || !e.workerId) return true;
      const res = checkAnnualLeave(e, workersById.get(e.workerId), items, policyCfg, hrSettings.policy2026EffectiveFrom);
      if (res && !res.verdict.ok) {
        blocked.push(`${e.workerName ?? "Worker"}: ${res.verdict.reasonAr}`);
        return false;
      }
      return true;
    });
    if (blocked.length) {
      toast.warning(`${blocked.length} annual-leave request(s) blocked by HR-POL-2026`, { description: blocked.join("\n") });
    }
    if (!ids.length) return;
    setBusy(true);
    try {
      const batch = writeBatch(db);
      ids.forEach((id) => batch.update(doc(db, "exceptionRequests", id), { status: "approved", approvedAt: serverTimestamp(), approvedBy: adminId() }));
      await batch.commit();
      ids.forEach((id) => {
        const e = byId(id);
        void logActivity({ action: "approved", entity: "exception", entityId: id, label: `${formatExceptionType(e?.type)} · ${e?.workerName ?? "worker"}`, detail: e?.exceptionDate });
        if (e?.workerId) {
          void sendExpoPushToWorkers(db, {
            recipientUids: [e.workerId],
            title: `${formatExceptionType(e.type)} Approved ✓`,
            body: e.adminResponse || `Your request for ${e.exceptionDate ?? "today"} has been approved.`,
            tab: "exceptions",
          });
        }
        void notifyAdmins(db, {
          targetRoles: ["super_admin", "hr_admin"],
          category: "hr",
          eventType: "exception_approved",
          title: `✅ ${formatExceptionType(e?.type)} Approved: ${e?.workerName ?? "Worker"}`,
          body: `Approved by ${adminId()} for ${e?.exceptionDate ?? "today"}.`,
          href: "/admin/exceptions?status=approved",
          actorUid: auth.currentUser?.uid,
          actorName: adminId(),
        });
        // Automatically sync salary advances to payroll adjustments
        if (e?.type === "advance_request" && e.workerId && Number(e.requestedAmount) > 0) {
          void addDoc(collection(db, "payrollAdjustments"), {
            workerId: e.workerId,
            workerName: e.workerName || "Worker",
            type: "advance",
            amount: Number(e.requestedAmount),
            date: e.exceptionDate || new Date().toISOString().split("T")[0],
            reason: `[Approved Advance Request] ${e.reason || ""}`.trim(),
            status: "applied",
            createdAt: serverTimestamp(),
            createdBy: adminId(),
          });
        }
        // Automatically record a covered permission ledger entry when an advance late permission or late excuse is approved
        if ((e?.type === "advance_late" || e?.type === "late") && e.workerId && e.exceptionDate) {
          const actualMins = Number(e.lateMinutes) || 30;
          void setDoc(
            doc(db, "permissionLedger", `${e.workerId}_${e.exceptionDate}_late`),
            {
              workerId: e.workerId,
              workerName: e.workerName || "Worker",
              date: e.exceptionDate,
              kind: "late",
              actualMinutes: actualMins,
              chargedMinutes: e.type === "advance_late" ? chargeableMinutes(actualMins, policyCfg) : 0,
              covered: true,
              status: "applied",
              source: "admin",
              reason: `[Approved ${e.type}] ${e.reason || ""}`.trim(),
              note: `[Approved ${e.type}] ${e.reason || ""}`.trim(),
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            },
            { merge: true },
          );
        }
      });
      toast.success(ids.length === 1 ? "Request approved" : `${ids.length} requests approved`);
      setSelected(new Set());
    } catch (err) {
      toast.error("Approval failed", { description: err instanceof Error ? err.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  const openRejectModal = (ids: string[], workerName: string) => {
    setModalText("");
    setResponseModal({ ids, workerName, mode: "reject" });
  };

  const openResponseModal = (id: string, workerName: string) => {
    setModalText(byId(id)?.adminResponse ?? "");
    setResponseModal({ ids: [id], workerName, mode: "response" });
  };

  const submitModalAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!responseModal) return;
    setBusy(true);
    try {
      if (responseModal.mode === "reject") {
        const batch = writeBatch(db);
        responseModal.ids.forEach((id) => {
          const u: Record<string, unknown> = { status: "rejected", rejectedAt: serverTimestamp(), rejectedBy: adminId() };
          if (modalText.trim()) u.adminResponse = modalText.trim();
          batch.update(doc(db, "exceptionRequests", id), u);
        });
        await batch.commit();
        responseModal.ids.forEach((id) => {
          const x = byId(id);
          void logActivity({ action: "rejected", entity: "exception", entityId: id, label: `${formatExceptionType(x?.type)} · ${x?.workerName ?? "worker"}`, detail: modalText.trim() || undefined });
          if (x?.workerId) {
            void sendExpoPushToWorkers(db, {
              recipientUids: [x.workerId],
              title: `${formatExceptionType(x.type)} Rejected`,
              body: modalText.trim() || `Your request for ${x.exceptionDate ?? "today"} was not approved.`,
              tab: "exceptions",
              urgent: true,
            });
          }
          void notifyAdmins(db, {
            targetRoles: ["super_admin", "hr_admin"],
            category: "hr",
            eventType: "exception_rejected",
            title: `❌ ${formatExceptionType(x?.type)} Rejected: ${x?.workerName ?? "Worker"}`,
            body: modalText.trim() || `Rejected by ${adminId()} for ${x?.exceptionDate ?? "today"}.`,
            href: "/admin/exceptions?status=rejected",
            actorUid: auth.currentUser?.uid,
            actorName: adminId(),
            urgent: true,
          });
        });
        toast.success(responseModal.ids.length === 1 ? "Request rejected" : `${responseModal.ids.length} requests rejected`);
        setSelected(new Set());
      } else {
        if (!modalText.trim()) return;
        const id = responseModal.ids[0];
        const x = byId(id);
        await updateDoc(doc(db, "exceptionRequests", id), { adminResponse: modalText.trim(), responseAt: serverTimestamp(), responseBy: adminId() });
        void logActivity({ action: "updated", entity: "exception", entityId: id, label: `Response to ${responseModal.workerName}`, detail: modalText.trim().slice(0, 120) });
        if (x?.workerId) {
          void sendExpoPushToWorkers(db, {
            recipientUids: [x.workerId],
            title: `HR Note on ${formatExceptionType(x.type)}`,
            body: modalText.trim(),
            tab: "exceptions",
          });
        }
        void notifyAdmins(db, {
          targetRoles: ["super_admin", "hr_admin"],
          category: "hr",
          eventType: "exception_note",
          title: `💬 HR Note on ${formatExceptionType(x?.type)}: ${responseModal.workerName}`,
          body: modalText.trim(),
          href: "/admin/exceptions",
          actorUid: auth.currentUser?.uid,
          actorName: adminId(),
        });
        toast.success("Response saved", { description: "The worker can now see your note." });
      }
      setResponseModal(null);
    } catch (err) {
      toast.error("Action failed", { description: err instanceof Error ? err.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (ids: string[]) => {
    const ok = await confirmDialog({
      title: ids.length === 1 ? "Delete this request?" : `Delete ${ids.length} requests?`,
      message: "This permanently removes the request and any admin response. This can't be undone.",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const batch = writeBatch(db);
      ids.forEach((id) => batch.delete(doc(db, "exceptionRequests", id)));
      await batch.commit();
      ids.forEach((id) => {
        const x = byId(id);
        void logActivity({ action: "deleted", entity: "exception", entityId: id, label: `${formatExceptionType(x?.type)} · ${x?.workerName ?? "worker"}` });
      });
      toast.success(ids.length === 1 ? "Request deleted" : `${ids.length} requests deleted`);
      setSelected(new Set());
    } catch (err) {
      toast.error("Delete failed", { description: err instanceof Error ? err.message : undefined });
    } finally {
      setBusy(false);
    }
  };


  const exportCsv = () => {
    const rows: (string | number)[][] = [["Worker", "Email", "Type", "Late Minutes", "Leave Days", "Start Date", "End Date", "Reason", "Evidence", "Status", "Submitted At", "Admin Response"]];
    for (const e of filtered) {
      rows.push([
        e.workerName || "",
        e.workerEmail || "",
        formatExceptionType(e.type),
        e.lateMinutes ?? "",
        e.leaveDays ?? "",
        e.exceptionDate || "",
        e.endDate || e.exceptionDate || "",
        e.reason || "",
        e.supportingEvidence || "",
        statusOf(e).toUpperCase(),
        formatSubmittedYmd(e.createdAt || e.submittedAt),
        e.adminResponse || "",
      ]);
    }
    downloadCsv(rows, `exception_requests_${new Date().toISOString().split("T")[0]}.csv`);
    toast.success(`Exported ${filtered.length} requests`);
  };

  const tabs: { key: string; label: string; count: number }[] = [
    { key: "pending", label: "Pending", count: counts.pending },
    { key: "approved", label: "Approved", count: counts.approved },
    { key: "rejected", label: "Rejected", count: counts.rejected },
    { key: "", label: "All", count: counts.all },
  ];

  const hasFilters = !!(typeFilter || workerFilter || search || dateFilter !== "all");
  const selectedIds = [...selected];
  const selectedPending = selectedIds.filter((id) => statusOf(byId(id) ?? ({} as ExceptionRequest)) === "pending");

  return (
    <div className="pb-24">
      <PageHeader
        title="Exception requests"
        description="Late arrival and absence justifications submitted by workers."
        actions={
          <button type="button" onClick={exportCsv} disabled={!filtered.length} className="brutal-btn-outline normal-case tracking-normal disabled:opacity-50">
            <Svg d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /> Export CSV
          </button>
        }
      />

      {/* Stat strip */}
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: "Awaiting decision", value: counts.pending, tone: "text-amber-600", ring: "bg-amber-500" },
          { label: "Approved", value: counts.approved, tone: "text-emerald-600", ring: "bg-emerald-500" },
          { label: "Rejected", value: counts.rejected, tone: "text-red-600", ring: "bg-red-500" },
          { label: "Submitted today", value: todayN, tone: "text-zinc-900", ring: "bg-zinc-400" },
        ].map((s) => (
          <div key={s.label} className="ui-card relative overflow-hidden px-4 py-3">
            <span className={`absolute left-0 top-0 h-full w-1 ${s.ring}`} />
            <p className="text-[11px] font-medium text-zinc-500">{s.label}</p>
            <p className={`mt-1 text-2xl font-bold tracking-tight ${s.tone}`}>{loading ? "–" : s.value}</p>
          </div>
        ))}
      </div>

      {/* Tabs + filters */}
      <div className="ui-card mb-4 overflow-hidden">
        <div className="flex flex-wrap items-center gap-1 border-b border-zinc-100 px-3 pt-2">
          {tabs.map((t) => (
            <button
              key={t.key || "all"}
              type="button"
              id={`exceptions-tab-${t.key || "all"}`}
              onClick={() => setStatusFilter(t.key)}
              className={`relative flex items-center gap-2 px-3 pb-2.5 pt-1.5 text-[13px] font-medium transition-colors cursor-pointer ${
                statusFilter === t.key ? "text-zinc-900" : "text-zinc-500 hover:text-zinc-800"
              }`}
            >
              {t.label}
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${statusFilter === t.key ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-600"}`}>{t.count}</span>
              {statusFilter === t.key && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-red-600" />}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2 p-3 md:flex-row md:items-center">
          <div className="relative flex-1">
            <Svg d={STATE_ICONS.search} className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input id="exceptions-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search worker, email or reason…" className="brutal-input pl-9" />
          </div>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="brutal-input md:w-52">
            <option value="">All request types</option>
            <option value="late">Late arrival</option>
            <option value="advance_late">Advance Late (إذن تأخير مسبق)</option>
            <option value="absent">Absence</option>
            <option value="overtime">Overtime</option>
            <option value="unpaid_leave">Unpaid Leave (إجازة بدون مرتب)</option>
            <option value="annual_leave">Annual Leave (سنوية)</option>
            <option value="sick_leave">Sick Leave (مرضية)</option>
            <option value="emergency_leave">Emergency Leave (عارضة)</option>
            <option value="advance_request">Salary Advance (سلفة)</option>
          </select>
          <select value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} className="brutal-input md:w-36">
            <option value="all">All time</option>
            <option value="today">Today</option>
            <option value="week">Last 7 days</option>
            <option value="month">Last 30 days</option>
          </select>
          <select value={workerFilter} onChange={(e) => setWorkerFilter(e.target.value)} className="brutal-input md:w-48">
            <option value="">All workers</option>
            {workerOptions.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          {hasFilters && (
            <button
              type="button"
              onClick={() => {
                setTypeFilter("");
                setWorkerFilter("");
                setSearch("");
                setDateFilter("all");
              }}
              className="px-2 text-xs font-medium text-zinc-500 hover:text-zinc-900 cursor-pointer"
            >
              Reset
            </button>
          )}
        </div>
        {filtered.length > 0 && (
          <label className="flex cursor-pointer items-center gap-3 border-t border-zinc-100 bg-zinc-50 px-4 py-2 text-xs text-zinc-600">
            <input type="checkbox" className="mft-check" checked={allSelected} onChange={toggleAll} />
            Select all {filtered.length} shown
          </label>
        )}
      </div>

      {/* List */}
      {loading ? (
        <div className="ui-card">
          <SkeletonRows rows={5} cols={3} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="ui-card">
          {statusFilter === "pending" && !hasFilters ? (
            <EmptyState icon={STATE_ICONS.check} title="All caught up" description="There are no exception requests waiting for a decision." />
          ) : (
            <EmptyState icon={ICONS.exceptions} title="No requests match" description="Try another tab or clear your filters." />
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((e) => {
            const st = statusOf(e);
            const isSel = selected.has(e.id);
            const isLeaveReq = ["annual_leave", "unpaid_leave", "sick_leave", "emergency_leave"].includes(e.type || "");
            const startStr = e.exceptionDate || "unspecified date";
            const endStr = e.endDate || startStr;
            return (
              <article key={e.id} className={`ui-card overflow-hidden transition-all ${isSel ? "ring-2 ring-red-500/40" : ""}`}>
                <div className="flex items-start gap-4 p-5">
                  <input type="checkbox" className="mft-check mt-1" checked={isSel} onChange={() => toggle(e.id)} aria-label={`Select request from ${e.workerName}`} />
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-xs font-bold text-zinc-600">
                    {(e.workerName || "?")
                      .split(" ")
                      .map((p) => p[0])
                      .join("")
                      .slice(0, 2)
                      .toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-zinc-900">{e.workerName || "Unknown worker"}</h3>
                      <span className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${
                        e.type === "absent"
                          ? "border-violet-200 bg-violet-50 text-violet-700"
                          : e.type === "overtime"
                            ? "border-blue-200 bg-blue-50 text-blue-700"
                            : e.type === "advance_request"
                              ? "border-amber-300 bg-amber-50 text-amber-900 font-bold"
                              : e.type === "advance_late"
                                ? "border-sky-300 bg-sky-50 text-sky-900 font-semibold"
                                : isLeaveReq
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-800 font-semibold"
                                  : "border-orange-200 bg-orange-50 text-orange-700"
                      }`}>
                        {formatExceptionType(e.type)}
                        {(e.type === "late" || e.type === "advance_late") && e.lateMinutes != null ? ` · ${e.lateMinutes} min` : ""}
                        {e.type === "overtime" && e.lateMinutes != null ? ` · +${e.lateMinutes} min` : ""}
                        {isLeaveReq ? ` · ${Number(e.leaveDays) > 0 ? e.leaveDays : 1}d` : ""}
                        {e.type === "advance_request" && e.requestedAmount != null ? ` · $${e.requestedAmount}` : ""}
                      </span>
                      <span className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold capitalize ${STATUS_STYLE[st] ?? STATUS_STYLE.pending}`}>{st}</span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-zinc-600">
                      {e.workerEmail && <span>{e.workerEmail}</span>}
                      <span className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 font-semibold text-zinc-800" dir="rtl">
                        {isLeaveReq
                          ? `📅 فترة الإجازة: من ${startStr} إلى ${endStr} (${Number(e.leaveDays) > 0 ? e.leaveDays : 1} يوم)`
                          : `📅 تاريخ الطلب: ${startStr}`}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-md border border-sky-200 bg-sky-50 px-2 py-0.5 font-semibold text-sky-800" dir="rtl">
                        📩 تاريخ تقديم الطلب: <span dir="ltr">{formatSubmittedYmd(e.createdAt || e.submittedAt)}</span>
                        {timeAgo(e.createdAt || e.submittedAt) ? ` (${timeAgo(e.createdAt || e.submittedAt)})` : ""}
                      </span>
                    </div>

                    <p className="mt-3 whitespace-pre-wrap rounded-lg bg-zinc-50 px-3 py-2.5 text-[13px] leading-relaxed text-zinc-800">{e.reason || <span className="italic text-zinc-400">No written reason provided</span>}</p>

                    <ExceptionPolicyInsight
                      req={e}
                      worker={e.workerId ? workersById.get(e.workerId) : undefined}
                      all={items}
                      cfg={policyCfg}
                      defaultHourlyRate={hrSettings.defaultHourlyRate || 31.25}
                      policyEffectiveFrom={hrSettings.policy2026EffectiveFrom}
                    />

                    {e.supportingEvidence && (
                      <div className="mt-2 text-xs">
                        {e.supportingEvidence.startsWith("http") ? (
                          <a href={e.supportingEvidence} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-medium text-red-600 hover:underline">
                            <Svg d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" className="h-3.5 w-3.5" />
                            View attached evidence
                          </a>
                        ) : (
                          <p className="break-all text-zinc-600">
                            <span className="font-medium">Evidence:</span> {e.supportingEvidence}
                          </p>
                        )}
                      </div>
                    )}

                    {e.adminResponse && (
                      <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                        <p className="text-[11px] font-semibold text-amber-700">Admin response</p>
                        <p className="mt-0.5 whitespace-pre-wrap text-[13px] text-zinc-800">{e.adminResponse}</p>
                        {e.responseBy && (
                          <p className="mt-1 text-[10px] text-zinc-500">
                            {e.responseBy} · {formatTs(e.responseAt)}
                          </p>
                        )}
                      </div>
                    )}

                    {(e.approvedAt || e.rejectedAt) && (
                      <p className="mt-2 text-[11px] text-zinc-400">
                        {e.approvedAt && `Approved ${formatTs(e.approvedAt)} by ${e.approvedBy || "admin"}`}
                        {e.rejectedAt && `Rejected ${formatTs(e.rejectedAt)} by ${e.rejectedBy || "admin"}`}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 bg-zinc-50 px-5 py-2.5">
                  {st === "pending" && (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void approve([e.id])}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50 cursor-pointer"
                      >
                        <Svg d="M5 13l4 4L19 7" className="h-3.5 w-3.5" /> Approve
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => openRejectModal([e.id], e.workerName || "Worker")}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 cursor-pointer"
                      >
                        <Svg d="M6 18L18 6M6 6l12 12" className="h-3.5 w-3.5" /> Reject
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => openResponseModal(e.id, e.workerName || "Worker")}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-white hover:text-zinc-900 cursor-pointer"
                  >
                    <Svg d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" className="h-3.5 w-3.5" />
                    {e.adminResponse ? "Edit note" : "Add note"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove([e.id])}
                    className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600 cursor-pointer"
                    aria-label="Delete request"
                  >
                    <Svg d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" className="h-3.5 w-3.5" />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <BulkBar count={selected.size} onClear={() => setSelected(new Set())}>
        <BulkButton tone="success" disabled={busy || selectedPending.length === 0} onClick={() => void approve(selectedPending)}>
          Approve{selectedPending.length && selectedPending.length !== selected.size ? ` ${selectedPending.length} pending` : ""}
        </BulkButton>
        <BulkButton disabled={busy || selectedPending.length === 0} onClick={() => openRejectModal(selectedPending, `${selectedPending.length} workers`)}>
          Reject
        </BulkButton>
        <BulkButton tone="danger" disabled={busy} onClick={() => void remove(selectedIds)}>
          Delete
        </BulkButton>
      </BulkBar>

      {/* Response / Rejection Modal */}
      {responseModal && (
        <ModalPortal onClose={() => setResponseModal(null)}>
          <div className="fixed inset-0 z-[120] flex items-center justify-center bg-zinc-950/45 p-4 backdrop-blur-[2px] animate-fade-in" onMouseDown={(ev) => ev.target === ev.currentTarget && setResponseModal(null)}>
            <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 animate-scale-in" style={{ boxShadow: "var(--mft-shadow-lg)" }}>
              <div className="mb-1 flex items-start justify-between">
                <h3 className="text-base font-semibold text-zinc-900">
                  {responseModal.mode === "reject" ? (responseModal.ids.length > 1 ? `Reject ${responseModal.ids.length} requests` : "Reject request") : "Response note"}
                </h3>
                <button type="button" onClick={() => setResponseModal(null)} className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 cursor-pointer" aria-label="Close">
                  <Svg d="M6 18L18 6M6 6l12 12" />
                </button>
              </div>
              <p className="text-sm text-zinc-500">
                {responseModal.mode === "reject" ? "The worker will see this request as rejected." : "Visible to"} <span className="font-medium text-zinc-800">{responseModal.workerName}</span>
              </p>
              <form onSubmit={submitModalAction} className="mt-4 space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-zinc-700">{responseModal.mode === "reject" ? "Reason (optional)" : "Message"}</label>
                  <textarea
                    rows={4}
                    autoFocus
                    required={responseModal.mode === "response"}
                    value={modalText}
                    onChange={(ev) => setModalText(ev.target.value)}
                    placeholder={responseModal.mode === "reject" ? "e.g. No supporting evidence was provided" : "Write a note for the worker…"}
                    className="brutal-input resize-y"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setResponseModal(null)} className="brutal-btn-outline normal-case tracking-normal">
                    Cancel
                  </button>
                  <button type="submit" disabled={busy} className={`inline-flex items-center rounded-lg px-4 py-2 text-xs font-semibold text-white transition-colors disabled:opacity-50 cursor-pointer ${responseModal.mode === "reject" ? "bg-red-600 hover:bg-red-700" : "bg-zinc-900 hover:bg-zinc-800"}`}>
                    {busy ? "Saving…" : responseModal.mode === "reject" ? "Reject" : "Save note"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
}
