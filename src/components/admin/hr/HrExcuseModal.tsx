"use client";

import { useState } from "react";
import ModalPortal from "@/components/admin/ui/ModalPortal";
import { excuseWorkerAbsence } from "@/lib/admin/hrSettings";
import { logActivity } from "@/lib/admin/activity";
import { toast } from "@/lib/admin/feedback";
import { auth, db } from "@/lib/firebase";
import { sendExpoPushToWorkers } from "@/lib/chatNotifications";
import { notifyAdmins } from "@/lib/adminNotifications";

interface Props {
  worker: { id: string; firstName?: string; lastName?: string; email?: string; department?: string };
  date: string; // YYYY-MM-DD
  adminEmail?: string;
  onClose: () => void;
  onExcused?: () => void;
}

const LEAVE_TYPES = [
  { id: "annual", label: "Annual Leave (إجازة سنوية)", desc: "Statutory paid vacation", color: "text-blue-700 bg-blue-50 border-blue-200" },
  { id: "sick", label: "Sick Leave (إجازة مرضية)", desc: "Medical excuse / certificate", color: "text-emerald-700 bg-emerald-50 border-emerald-200" },
  { id: "casual", label: "Emergency / Casual (إجازة عارضة)", desc: "Unforeseen urgent event", color: "text-amber-700 bg-amber-50 border-amber-200" },
  { id: "official", label: "Official Mission (مهمة عمل)", desc: "External company assignment", color: "text-purple-700 bg-purple-50 border-purple-200" },
  { id: "unpaid", label: "Approved Unpaid Leave (إجازة بدون مرتب)", desc: "Excused from 2x penalty", color: "text-zinc-700 bg-zinc-100 border-zinc-300" },
] as const;

export default function HrExcuseModal({ worker, date, adminEmail, onClose, onExcused }: Props) {
  const [leaveType, setLeaveType] = useState<"annual" | "sick" | "casual" | "official" | "unpaid">("annual");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const workerFullName = `${worker.firstName || ""} ${worker.lastName || ""}`.trim() || "Worker";

  const handleExcuse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      toast.warning("Please provide a brief reason or documentation note");
      return;
    }

    setSaving(true);
    try {
      await excuseWorkerAbsence({
        workerId: worker.id,
        workerName: workerFullName,
        workerEmail: worker.email,
        date,
        leaveType,
        reason: reason.trim(),
        adminEmail,
      });

      void sendExpoPushToWorkers(db, {
        recipientUids: [worker.id],
        title: `Absence Excused (${leaveType.toUpperCase()}) ✓`,
        body: `Your absence on ${date} was excused by HR: ${reason.trim()}`,
        tab: "exceptions",
      }).catch(() => {});

      void notifyAdmins(db, {
        targetRoles: ["super_admin", "hr_admin"],
        category: "hr",
        eventType: "absence_excused",
        title: `✅ Absence Excused: ${workerFullName}`,
        body: `${workerFullName} excused on ${date} (${leaveType.toUpperCase()}): ${reason.trim()}`,
        href: "/admin/hr?tab=overview",
        actorUid: auth.currentUser?.uid,
        actorName: adminEmail || auth.currentUser?.email || "HR",
      });

      void logActivity({
        action: "updated",
        entity: "hr",
        entityId: worker.id,
        label: `Excused ${workerFullName} on ${date} (${leaveType})`,
        detail: reason.trim(),
      });

      toast.success(`Absence excused for ${workerFullName} (${leaveType.toUpperCase()})`);
      onExcused?.();
      onClose();
    } catch (err) {
      toast.error("Failed to excuse absence", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalPortal onClose={onClose}>
      <div
        className="fixed inset-0 z-[120] bg-zinc-950/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto animate-fade-in"
        onClick={onClose}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="excuse-absence-modal-title"
          className="ui-card shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto p-6 md:p-7 animate-scale-in text-zinc-950 dark:text-zinc-100"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-start justify-between pb-3 border-b border-zinc-200 dark:border-zinc-800 mb-4">
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-widest text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 px-2.5 py-0.5 rounded-full">
                EXCUSE ABSENCE
              </span>
              <h3 id="excuse-absence-modal-title" className="text-xl font-bold tracking-tight text-zinc-950 dark:text-white mt-1.5">
                Pardon / Excuse Worker Absence
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                Exempts <strong>{workerFullName}</strong> from absence deduction on <strong className="font-code">{date}</strong>.
              </p>
            </div>
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
            >
              &times;
            </button>
          </div>

          <form onSubmit={handleExcuse} className="space-y-4 text-xs">
            <div>
              <label className="block font-semibold uppercase text-zinc-700 dark:text-zinc-300 mb-1.5">
                Leave / Excuse Category (نوع الإجازة أو العذر) *
              </label>
              <div className="space-y-2">
                {LEAVE_TYPES.map((lt) => (
                  <button
                    key={lt.id}
                    type="button"
                    onClick={() => setLeaveType(lt.id)}
                    className={`w-full p-3 rounded-xl border text-left flex items-center justify-between cursor-pointer transition-all ${
                      leaveType === lt.id
                        ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 ring-2 ring-emerald-500/20 font-semibold"
                        : "border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 hover:bg-zinc-50"
                    }`}
                  >
                    <div>
                      <div className="text-xs font-semibold">{lt.label}</div>
                      <div className="text-[10px] text-zinc-500 mt-0.5">{lt.desc}</div>
                    </div>
                    <span>{leaveType === lt.id ? "✓" : "○"}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block font-semibold uppercase text-zinc-700 dark:text-zinc-300 mb-1.5">
                Reason &amp; Documentation Note * (السبب والملاحظات)
              </label>
              <textarea
                required
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Worker notified management in advance regarding medical appointment, or approved annual leave..."
                className="w-full brutal-input px-3 py-2 resize-none"
              />
            </div>

            <div className="p-3 bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl text-[11px] text-amber-900 dark:text-amber-200">
              💡 <strong>Effect:</strong> An approved record will be saved in `exceptionRequests`. The absence penalty will not be deducted from their payroll for this day.
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-zinc-200 dark:border-zinc-800">
              <button
                type="button"
                onClick={onClose}
                className="brutal-btn-outline px-4 py-2 text-xs cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs rounded-lg shadow-xs cursor-pointer disabled:opacity-50 transition-colors"
              >
                {saving ? "Excusing..." : "Approve & Excuse Absence"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </ModalPortal>
  );
}
