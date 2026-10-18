"use client";

import { useState } from "react";
import ModalPortal from "@/components/admin/ui/ModalPortal";
import { addPayrollAdjustment } from "@/lib/admin/hrSettings";
import { logActivity } from "@/lib/admin/activity";
import { toast } from "@/lib/admin/feedback";

interface WorkerOption {
  id: string;
  firstName?: string;
  lastName?: string;
  department?: string;
  role?: string;
}

interface Props {
  workers: WorkerOption[];
  preselectedWorkerId?: string;
  adminEmail?: string;
  onClose: () => void;
}

export default function HrAdjustmentModal({
  workers,
  preselectedWorkerId,
  adminEmail,
  onClose,
}: Props) {
  const [workerId, setWorkerId] = useState(preselectedWorkerId || (workers[0]?.id ?? ""));
  const [type, setType] = useState<"advance" | "allowance" | "bonus" | "deduction">("advance");
  const [amount, setAmount] = useState<number | "">("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const selectedWorker = workers.find((w) => w.id === workerId);
  const workerFullName = selectedWorker
    ? `${selectedWorker.firstName || ""} ${selectedWorker.lastName || ""}`.trim()
    : "";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workerId || !amount || Number(amount) <= 0 || !reason.trim()) {
      toast.warning("Please fill in all required fields with a valid amount");
      return;
    }

    setSaving(true);
    try {
      await addPayrollAdjustment(
        {
          workerId,
          workerName: workerFullName,
          type,
          amount: Number(amount),
          date,
          reason: reason.trim(),
          status: "applied",
        },
        adminEmail,
      );

      const labels = {
        advance: "Salary advance (سلفة)",
        allowance: "Allowance (بدل)",
        bonus: "Bonus (مكافأة)",
        deduction: "Deduction (خصم)",
      };

      void logActivity({
        action: "created",
        entity: "hr",
        entityId: workerId,
        label: `${labels[type]}: EGP ${amount} for ${workerFullName}`,
        detail: reason,
      });

      toast.success(`${labels[type]} recorded successfully`);
      onClose();
    } catch (err) {
      toast.error("Failed to record adjustment", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalPortal onClose={onClose}>
      <div
        className="fixed inset-0 z-[120] bg-zinc-950/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto animate-fade-in"
        onClick={onClose}
      >
        <div
          className="bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-700 shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto p-6 md:p-8 animate-scale-in text-zinc-950 dark:text-zinc-100 font-mono"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-start justify-between pb-3 border-b-2 border-zinc-900 dark:border-zinc-700 mb-5">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-red-600 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 px-2 py-0.5 rounded font-mono">
                {"// PAYROLL ADJUSTMENT"}
              </span>
              <h3 className="text-xl font-bold font-heading uppercase tracking-wide text-zinc-950 dark:text-white mt-1">
                Record Advance, Allowance or Bonus
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                Automatically adjusts the worker&apos;s monthly payroll balance and payslip.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-zinc-400 hover:text-zinc-950 dark:hover:text-white text-2xl font-bold leading-none p-1 cursor-pointer"
            >
              &times;
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4 text-xs">
            {/* Target Worker */}
            <div>
              <label className="block font-bold uppercase text-zinc-700 dark:text-zinc-300 mb-1">
                Select Worker * (الموظف)
              </label>
              <select
                required
                value={workerId}
                onChange={(e) => setWorkerId(e.target.value)}
                className="w-full bg-white dark:bg-zinc-800 border-2 border-zinc-900 dark:border-zinc-700 px-3 py-2 text-zinc-950 dark:text-zinc-100 font-bold focus:outline-none focus:ring-2 focus:ring-red-600"
              >
                {workers.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.firstName} {w.lastName} ({w.department || "General"})
                  </option>
                ))}
              </select>
            </div>

            {/* Adjustment Type Selection */}
            <div>
              <label className="block font-bold uppercase text-zinc-700 dark:text-zinc-300 mb-1">
                Adjustment Type * (نوع العملية)
              </label>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { id: "advance", label: "Salary Advance (سلفة)", desc: "Deducted from monthly net pay", color: "border-red-600 text-red-600" },
                  { id: "allowance", label: "Allowance (بدل)", desc: "Added to monthly gross pay", color: "border-emerald-600 text-emerald-600" },
                  { id: "bonus", label: "Exceptional Bonus (مكافأة)", desc: "Added to earnings", color: "border-blue-600 text-blue-600" },
                  { id: "deduction", label: "Disciplinary Deduction (خصم)", desc: "Subtracted from earnings", color: "border-zinc-900 text-zinc-900" },
                ] as const).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setType(item.id)}
                    className={`p-2.5 rounded border text-left cursor-pointer transition-all ${
                      type === item.id
                        ? "border-red-600 bg-red-50 dark:bg-red-950/40 ring-2 ring-red-600/20 font-bold"
                        : "border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50"
                    }`}
                  >
                    <div className="font-bold text-xs">{item.label}</div>
                    <div className="text-[10px] text-zinc-500 mt-0.5">{item.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Amount and Date */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-bold uppercase text-zinc-700 dark:text-zinc-300 mb-1">
                  Amount in EGP * (المبلغ بالجنيه)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2 font-bold text-zinc-400">EGP</span>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    required
                    value={amount}
                    onChange={(e) => setAmount(e.target.value === "" ? "" : Number(e.target.value))}
                    placeholder="e.g. 500"
                    className="w-full bg-white dark:bg-zinc-800 border-2 border-zinc-900 dark:border-zinc-700 pl-12 pr-3 py-2 text-zinc-950 dark:text-zinc-100 font-bold text-base focus:outline-none focus:ring-2 focus:ring-red-600"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold uppercase text-zinc-700 dark:text-zinc-300 mb-1">
                  Effective Date * (التاريخ)
                </label>
                <input
                  type="date"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full bg-white dark:bg-zinc-800 border-2 border-zinc-900 dark:border-zinc-700 px-3 py-2 text-zinc-950 dark:text-zinc-100 font-bold focus:outline-none focus:ring-2 focus:ring-red-600"
                />
              </div>
            </div>

            {/* Reason */}
            <div>
              <label className="block font-bold uppercase text-zinc-700 dark:text-zinc-300 mb-1">
                Reason &amp; Documentation * (السبب والملاحظات)
              </label>
              <textarea
                required
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Mid-month personal advance requested on 10 Oct, or Transportation allowance for Cairo client visits..."
                className="w-full bg-white dark:bg-zinc-800 border-2 border-zinc-900 dark:border-zinc-700 px-3 py-2 text-zinc-950 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-red-600 resize-none"
              />
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-3 border-t-2 border-zinc-900 dark:border-zinc-700">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 border-2 border-zinc-900 dark:border-zinc-700 bg-white dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-950 dark:text-zinc-100 font-bold uppercase cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white font-bold uppercase tracking-wider border-2 border-zinc-900 shadow-[2px_2px_0px_0px_#09090b] cursor-pointer disabled:opacity-50"
              >
                {saving ? "Recording..." : "Save Adjustment"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </ModalPortal>
  );
}
