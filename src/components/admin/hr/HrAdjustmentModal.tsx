"use client";

import { useState } from "react";
import ModalPortal from "@/components/admin/ui/ModalPortal";
import { addPayrollAdjustment, deletePayrollAdjustment } from "@/lib/admin/hrSettings";
import type { PayrollAdjustment } from "@/lib/admin/hrReports";
import { logActivity } from "@/lib/admin/activity";
import { toast, confirmDialog } from "@/lib/admin/feedback";
import { auth, db } from "@/lib/firebase";
import { sendExpoPushToWorkers } from "@/lib/chatNotifications";
import { notifyAdmins } from "@/lib/adminNotifications";
import { useHrLang } from "@/lib/admin/hrI18n";
import {
  DISCIPLINARY_RULES,
  type OffenseTier,
  computeWorkerDailyWageEgp,
  computeDisciplinaryDeductionEgp,
} from "@/lib/admin/hrDisciplinary";

interface WorkerOption {
  id: string;
  firstName?: string;
  lastName?: string;
  department?: string;
  role?: string;
  hourlyRate?: number;
  expectedSalary?: number | string;
}

export type AdjustmentKind = "bonus" | "deduction" | "advance" | "allowance";

interface Props {
  workers: WorkerOption[];
  preselectedWorkerId?: string;
  initialType?: AdjustmentKind;
  existingAdjustments?: PayrollAdjustment[];
  adminEmail?: string;
  onClose: () => void;
}

export default function HrAdjustmentModal({
  workers,
  preselectedWorkerId,
  initialType = "bonus",
  existingAdjustments = [],
  adminEmail,
  onClose,
}: Props) {
  const { dir, t } = useHrLang();
  const initialWorkerId = preselectedWorkerId || (workers[0]?.id ?? "");
  const [selectedWorkerIds, setSelectedWorkerIds] = useState<string[]>(
    initialWorkerId ? [initialWorkerId] : [],
  );
  const [workerSearch, setWorkerSearch] = useState("");
  const [type, setType] = useState<AdjustmentKind>(initialType);
  const [amount, setAmount] = useState<number | "">("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [reason, setReason] = useState("");
  const [selectedRuleNum, setSelectedRuleNum] = useState<number | "">("");
  const [selectedOffenseTier, setSelectedOffenseTier] = useState<OffenseTier>(1);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const selectedWorkers = workers.filter((w) => selectedWorkerIds.includes(w.id));
  const primaryWorkerDailyWage = computeWorkerDailyWageEgp(selectedWorkers[0] ?? {});

  const applyDisciplinaryPreset = (ruleCode: number, tier: OffenseTier) => {
    const rule = DISCIPLINARY_RULES.find((r) => r.code === ruleCode);
    if (!rule) return;
    const penalty = rule.tiers[tier];
    const calcEgp = computeDisciplinaryDeductionEgp(rule, tier, primaryWorkerDailyWage);
    if (calcEgp > 0) {
      setAmount(calcEgp);
    }
    const tierLabelAr =
      tier === 1 ? "أول مرة" : tier === 2 ? "ثاني مرة" : tier === 3 ? "ثالث مرة" : "رابع مرة";
    setReason(`[بند #${rule.code} - ${tierLabelAr}] ${rule.titleAr} (${penalty.labelAr})`);
  };
  const workerFullName =
    selectedWorkers.length === 1
      ? `${selectedWorkers[0].firstName || ""} ${selectedWorkers[0].lastName || ""}`.trim()
      : selectedWorkers.length > 1
        ? t(`${selectedWorkers.length} موظفين مختارين`, `${selectedWorkers.length} selected workers`)
        : "";

  const workerAdjustments = existingAdjustments.filter(
    (a) => selectedWorkerIds.includes(a.workerId) && a.status !== "cancelled",
  );

  const labels: Record<AdjustmentKind, { ar: string; en: string }> = {
    bonus: { ar: "مكافأة / بونص", en: "Bonus (مكافأة)" },
    deduction: { ar: "خصم إداري", en: "Deduction (خصم)" },
    advance: { ar: "سلفة نقدية", en: "Salary Advance (سلفة)" },
    allowance: { ar: "بدل إضافي", en: "Allowance (بدل)" },
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedWorkerIds.length === 0 || !amount || Number(amount) <= 0 || !reason.trim()) {
      toast.warning(
        t(
          "يرجى اختيار موظف واحد على الأقل وإدخال المبلغ والسبب بشكل صحيح",
          "Please select at least one worker and fill in all required fields",
        ),
      );
      return;
    }

    setSaving(true);
    try {
      for (const wId of selectedWorkerIds) {
        const wObj = workers.find((w) => w.id === wId);
        const wName = wObj ? `${wObj.firstName || ""} ${wObj.lastName || ""}`.trim() : wId;
        await addPayrollAdjustment(
          {
            workerId: wId,
            workerName: wName,
            type,
            amount: Number(amount),
            date,
            reason: reason.trim(),
            status: "applied",
          },
          adminEmail,
        );
      }

      void sendExpoPushToWorkers(db, {
        recipientUids: selectedWorkerIds,
        title: type === "deduction" ? `⛔ تم تسجيل ${labels[type].ar}` : `💰 تم تسجيل ${labels[type].ar}`,
        body: `${amount} ج.م (${date}): ${reason.trim()}`,
        tab: "profile",
        urgent: type === "deduction",
      }).catch(() => {});

      void notifyAdmins(db, {
        targetRoles: ["super_admin", "hr_admin"],
        category: "hr",
        eventType: "payroll_adjustment_recorded",
        title: `💰 ${labels[type].en}: ${workerFullName}`,
        body: `EGP ${amount} recorded for ${workerFullName} (${date}) — ${reason.trim()}`,
        href: "/admin/hr?tab=payroll",
        actorUid: auth.currentUser?.uid,
        actorName: adminEmail || auth.currentUser?.email || "HR",
      });

      void logActivity({
        action: "created",
        entity: "hr",
        entityId: selectedWorkerIds[0] || "",
        label: `${labels[type].en}: EGP ${amount} for ${workerFullName}`,
        detail: reason,
      });

      toast.success(
        t(
          `تم تسجيل ${labels[type].ar} (${amount} ج.م) لـ ${workerFullName} وتحديث شيت الرواتب`,
          `${labels[type].en} (EGP ${amount}) recorded for ${workerFullName} & added to Payroll Sheet`,
        ),
      );
      setAmount("");
      setReason("");
      onClose();
    } catch (err) {
      toast.error(t("فشل حفظ العملية", "Failed to record adjustment"), {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveAdjustment = async (adj: PayrollAdjustment) => {
    if (!adj.id) return;
    const kindLabel = labels[adj.type as AdjustmentKind]?.ar || adj.type;
    const adjWorkerName = adj.workerName || workerFullName;
    const ok = await confirmDialog({
      title: t(`إلغاء وحذف ${kindLabel}؟`, `Remove ${adj.type} (EGP ${adj.amount})?`),
      message: t(
        `هل تريد إزالة ${kindLabel} بقيمة ${adj.amount} ج.م (${adj.reason || "—"}) من شيت راتب ${adjWorkerName} فوراً؟`,
        `Remove this ${adj.type} of EGP ${adj.amount} ("${adj.reason || "—"}") from ${adjWorkerName}'s payroll sheet immediately?`,
      ),
      confirmLabel: t("شيل من شيت الرواتب 🗑️", "Remove from Payroll 🗑️"),
      tone: "danger",
    });
    if (!ok) return;
    setDeletingId(adj.id);
    try {
      await deletePayrollAdjustment(adj.id);
      if (adj.workerId) {
        void sendExpoPushToWorkers(db, {
          recipientUids: [adj.workerId],
          title: `↩ تم إلغاء ${kindLabel}`,
          body: `تم إزالة ${kindLabel} بقيمة ${adj.amount} ج.م من كشف راتبك.`,
          tab: "profile",
        }).catch(() => {});
      }
      void logActivity({
        action: "deleted",
        entity: "hr",
        entityId: adj.id,
        label: `Removed ${adj.type} (EGP ${adj.amount}) for ${adjWorkerName}`,
        detail: adj.reason,
      });
      toast.success(t(`تم حذف ${kindLabel} (${adj.amount} ج.م) وتحديث شيت الرواتب`, `Removed EGP ${adj.amount} from payroll sheet`));
    } catch (err) {
      toast.error(t("تعذر الحذف", "Could not remove adjustment"), {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <ModalPortal onClose={onClose}>
      <div
        className="fixed inset-0 z-[120] bg-zinc-950/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto animate-fade-in"
        onClick={onClose}
      >
        <div
          dir={dir}
          className="bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-700 shadow-2xl w-full max-w-xl max-h-[92vh] overflow-y-auto p-6 md:p-7 animate-scale-in text-zinc-950 dark:text-zinc-100 font-mono rounded-lg"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-start justify-between pb-3 border-b-2 border-zinc-900 dark:border-zinc-700 mb-5">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-red-600 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 px-2 py-0.5 rounded font-mono">
                {t("// إدارة البونص والخصومات والسلف · شيت الرواتب", "// PAYROLL BONUS, DEDUCTIONS & ADVANCES")}
              </span>
              <h3 className="text-xl font-bold font-heading tracking-wide text-zinc-950 dark:text-white mt-1">
                {t("إضافة أو حذف بونص / خصم / سلفة / بدل", "Add or Remove Bonus, Deduction, Advance or Allowance")}
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                {t(
                  "يسمع تلقائياً وفوراً في شيت الرواتب (Payroll Sheet) وكشف راتب الموظف وملف التصدير CSV.",
                  "Automatically updates the worker's monthly Payroll Sheet, Payslip, and CSV export in real time.",
                )}
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
            {/* Target Worker(s) Multi-Select */}
            <div className="space-y-2 border-2 border-zinc-900 dark:border-zinc-700 rounded p-3 bg-zinc-50 dark:bg-zinc-800/40">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="block font-bold uppercase text-zinc-700 dark:text-zinc-300">
                  {t("اختر الموظف أو مجموعة موظفين *", "Select Worker(s) *")}
                  <span className="ms-2 inline-flex items-center px-2 py-0.5 rounded bg-red-600 text-white text-[10px] font-black">
                    {t(`تم اختيار ${selectedWorkerIds.length} موظف`, `${selectedWorkerIds.length} selected`)}
                  </span>
                </label>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setSelectedWorkerIds(workers.map((w) => w.id))}
                    className="px-2 py-1 text-[10px] font-bold bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 rounded cursor-pointer hover:opacity-90"
                  >
                    {t("✓ تحديد الكل", "✓ Select All")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedWorkerIds([])}
                    className="px-2 py-1 text-[10px] font-bold border border-zinc-400 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 rounded cursor-pointer hover:bg-zinc-100"
                  >
                    {t("✕ إلغاء الكل", "✕ Clear")}
                  </button>
                </div>
              </div>

              <input
                type="text"
                value={workerSearch}
                onChange={(e) => setWorkerSearch(e.target.value)}
                placeholder={t("🔍 ابحث باسم الموظف أو القسم...", "🔍 Search worker by name or department...")}
                className="w-full bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 px-2.5 py-1.5 text-xs rounded focus:outline-none focus:ring-2 focus:ring-red-600"
              />

              <div className="max-h-40 overflow-y-auto divide-y divide-zinc-200 dark:divide-zinc-700 border border-zinc-200 dark:border-zinc-700 rounded bg-white dark:bg-zinc-900">
                {workers
                  .filter((w) => {
                    const q = workerSearch.trim().toLowerCase();
                    if (!q) return true;
                    const full = `${w.firstName || ""} ${w.lastName || ""}`.toLowerCase();
                    return full.includes(q) || (w.department || "").toLowerCase().includes(q);
                  })
                  .map((w) => {
                    const checked = selectedWorkerIds.includes(w.id);
                    return (
                      <label
                        key={w.id}
                        className={`flex items-center justify-between gap-2 px-3 py-1.5 cursor-pointer transition-colors ${
                          checked
                            ? "bg-red-50/80 dark:bg-red-950/30 font-bold text-red-900 dark:text-red-200"
                            : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              setSelectedWorkerIds((prev) =>
                                prev.includes(w.id) ? prev.filter((id) => id !== w.id) : [...prev, w.id],
                              );
                            }}
                            className="h-4 w-4 accent-red-600 rounded cursor-pointer"
                          />
                          <span className="truncate">
                            {w.firstName} {w.lastName}
                          </span>
                        </div>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 shrink-0">
                          {w.department || "General"}
                        </span>
                      </label>
                    );
                  })}
              </div>
            </div>

            {/* Adjustment Type Selection */}
            <div>
              <label className="block font-bold uppercase text-zinc-700 dark:text-zinc-300 mb-1">
                {t("نوع العملية على شيت الرواتب *", "Adjustment Type *")}
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    {
                      id: "bonus",
                      label: t("🎁 بونص / مكافأة (Bonus)", "🎁 Bonus (مكافأة)"),
                      desc: t("يزيد على الراتب في شيت الرواتب (+)", "Added to earnings in Payroll Sheet (+)"),
                      activeCls: "border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200 ring-2 ring-emerald-600/20",
                    },
                    {
                      id: "deduction",
                      label: t("⛔ خصم إداري (Deduction)", "⛔ Deduction (خصم إداري)"),
                      desc: t("يُخصم من الراتب في شيت الرواتب (-)", "Subtracted in Payroll Sheet (-)"),
                      activeCls: "border-red-600 bg-red-50 dark:bg-red-950/40 text-red-900 dark:text-red-200 ring-2 ring-red-600/20",
                    },
                    {
                      id: "allowance",
                      label: t("➕ بدل إضافي (Allowance)", "➕ Allowance (بدل)"),
                      desc: t("يُضاف لإجمالي المستحقات (+)", "Added to monthly gross pay (+)"),
                      activeCls: "border-sky-600 bg-sky-50 dark:bg-sky-950/40 text-sky-900 dark:text-sky-200 ring-2 ring-sky-600/20",
                    },
                    {
                      id: "advance",
                      label: t("💸 سلفة نقدية (Advance)", "💸 Salary Advance (سلفة)"),
                      desc: t("تُسترد من صافي الراتب (-)", "Deducted from monthly net pay (-)"),
                      activeCls: "border-amber-600 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 ring-2 ring-amber-600/20",
                    },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setType(item.id)}
                    className={`p-2.5 rounded border-2 text-start cursor-pointer transition-all ${
                      type === item.id
                        ? `${item.activeCls} font-bold`
                        : "border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50"
                    }`}
                  >
                    <div className="font-bold text-xs">{item.label}</div>
                    <div className="text-[10px] opacity-75 mt-0.5">{item.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Quick Disciplinary Violation Picker (When type === "deduction") */}
            {type === "deduction" && (
              <div className="p-3 rounded-lg border-2 border-red-300 dark:border-red-900 bg-red-50/50 dark:bg-red-950/20 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-red-900 dark:text-red-200 text-xs">
                    {t(
                      "⚖️ اختيار مخالفة من لائحة الجزاءات الرسمية (اختياري — يحسب الخصم تلقائياً):",
                      "⚖️ Pick from Official Disciplinary Schedule (Optional — auto-calculates EGP):",
                    )}
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-white dark:bg-zinc-900 border border-red-200 dark:border-red-800 text-zinc-600 dark:text-zinc-300 font-bold">
                    {t(`أجر اليوم: ${primaryWorkerDailyWage} ج.م`, `Daily Wage: EGP ${primaryWorkerDailyWage}`)}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <select
                    value={selectedRuleNum}
                    onChange={(e) => {
                      const val = e.target.value === "" ? "" : Number(e.target.value);
                      setSelectedRuleNum(val);
                      if (val !== "") {
                        applyDisciplinaryPreset(val, selectedOffenseTier);
                      }
                    }}
                    className="sm:col-span-2 bg-white dark:bg-zinc-900 border border-red-300 dark:border-red-800 px-2.5 py-2 text-xs font-bold rounded text-zinc-900 dark:text-zinc-100"
                  >
                    <option value="">
                      {t("— اختر بند المخالفة من اللائحة (أو اكتب الخصم يدوياً بالأسفل) —", "— Select Violation Rule (or enter custom below) —")}
                    </option>
                    {DISCIPLINARY_RULES.map((r) => (
                      <option key={r.code} value={r.code}>
                        #{r.code} — {r.titleAr}
                      </option>
                    ))}
                  </select>

                  <select
                    value={selectedOffenseTier}
                    onChange={(e) => {
                      const tier = Number(e.target.value) as OffenseTier;
                      setSelectedOffenseTier(tier);
                      if (selectedRuleNum !== "") {
                        applyDisciplinaryPreset(Number(selectedRuleNum), tier);
                      }
                    }}
                    className="bg-white dark:bg-zinc-900 border border-red-300 dark:border-red-800 px-2.5 py-2 text-xs font-bold rounded text-zinc-900 dark:text-zinc-100"
                  >
                    <option value={1}>{t("المرة ١ (أول مرة)", "1st Offense")}</option>
                    <option value={2}>{t("المرة ٢ (ثاني مرة)", "2nd Offense")}</option>
                    <option value={3}>{t("المرة ٣ (ثالث مرة)", "3rd Offense")}</option>
                    <option value={4}>{t("المرة ٤ (رابع مرة)", "4th Offense")}</option>
                  </select>
                </div>
              </div>
            )}

            {/* Amount and Date */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block font-bold uppercase text-zinc-700 dark:text-zinc-300">
                    {t("المبلغ بالجنيه (EGP) *", "Amount in EGP *")}
                  </label>
                  <div className="flex gap-1">
                    {[100, 250, 500, 1000].map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setAmount(p)}
                        className="px-1.5 py-0.5 text-[10px] font-bold bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-900 hover:text-white border border-zinc-300 dark:border-zinc-700 rounded cursor-pointer"
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="relative">
                  <span className="absolute start-3 top-2.5 font-bold text-zinc-400">EGP</span>
                  <input
                    type="number"
                    min={1}
                    step="0.5"
                    required
                    value={amount}
                    onChange={(e) => setAmount(e.target.value === "" ? "" : Number(e.target.value))}
                    placeholder="500"
                    className="w-full bg-white dark:bg-zinc-800 border-2 border-zinc-900 dark:border-zinc-700 ps-12 pe-3 py-2 text-zinc-950 dark:text-zinc-100 font-bold text-base rounded focus:outline-none focus:ring-2 focus:ring-red-600"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold uppercase text-zinc-700 dark:text-zinc-300 mb-1">
                  {t("التاريخ *", "Effective Date *")}
                </label>
                <input
                  type="date"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full bg-white dark:bg-zinc-800 border-2 border-zinc-900 dark:border-zinc-700 px-3 py-2.5 text-zinc-950 dark:text-zinc-100 font-bold rounded focus:outline-none focus:ring-2 focus:ring-red-600"
                />
              </div>
            </div>

            {/* Reason */}
            <div>
              <label className="block font-bold uppercase text-zinc-700 dark:text-zinc-300 mb-1">
                {t("السبب / البيان في شيت الرواتب *", "Reason & Note on Payroll Sheet *")}
              </label>
              <textarea
                required
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t(
                  "مثال: بونص تميز في تسليم المشروع، أو خصم إداري لمخالفة التعليمات...",
                  "e.g. Performance bonus for project delivery, or disciplinary deduction...",
                )}
                className="w-full bg-white dark:bg-zinc-800 border-2 border-zinc-900 dark:border-zinc-700 px-3 py-2 text-zinc-950 dark:text-zinc-100 rounded focus:outline-none focus:ring-2 focus:ring-red-600 resize-none"
              />
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2 border-t-2 border-zinc-900 dark:border-zinc-700">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 border-2 border-zinc-900 dark:border-zinc-700 bg-white dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-950 dark:text-zinc-100 font-bold uppercase cursor-pointer rounded"
              >
                {t("إغلاق", "Cancel")}
              </button>
              <button
                type="submit"
                disabled={saving}
                className={`px-5 py-2 text-white font-bold uppercase tracking-wider border-2 border-zinc-900 shadow-[2px_2px_0px_0px_#09090b] cursor-pointer disabled:opacity-50 rounded ${
                  type === "bonus" || type === "allowance"
                    ? "bg-emerald-600 hover:bg-emerald-700"
                    : "bg-red-600 hover:bg-red-700"
                }`}
              >
                {saving
                  ? t("جارٍ الحفظ...", "Saving...")
                  : type === "bonus"
                    ? t("🎁 إضافة البونص لشيت الرواتب", "🎁 Add Bonus to Payroll")
                    : type === "deduction"
                      ? t("⛔ إضافة الخصم لشيت الرواتب", "⛔ Add Deduction to Payroll")
                      : type === "allowance"
                        ? t("➕ إضافة البدل لشيت الرواتب", "➕ Add Allowance to Payroll")
                        : t("💸 تسجيل السلفة في شيت الرواتب", "💸 Add Advance to Payroll")}
              </button>
            </div>
          </form>

          {/* Existing adjustments for the selected worker with 1-click delete */}
          <div className="mt-5 pt-4 border-t-2 border-dashed border-zinc-300 dark:border-zinc-700 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-zinc-900 dark:text-white">
                {t(
                  `📋 البونص والخصومات والسلف المسجلة لـ ${workerFullName} (${workerAdjustments.length}):`,
                  `📋 Recorded Adjustments for ${workerFullName} (${workerAdjustments.length}):`,
                )}
              </h4>
              <span className="text-[10px] text-zinc-500">
                {t("يمكنك حذف أي خصم أو بونص بضغطة واحدة", "Click Remove to delete any deduction or bonus")}
              </span>
            </div>
            {workerAdjustments.length === 0 ? (
              <p className="py-3 text-center text-zinc-400 bg-zinc-50 dark:bg-zinc-800/40 rounded border border-zinc-200 dark:border-zinc-800">
                {t("لا يوجد بونص أو خصومات مسجلة لهذا الموظف في هذه الدورة.", "No bonuses or deductions recorded for this worker in this cycle.")}
              </p>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {workerAdjustments.map((adj) => {
                  const isPos = adj.type === "bonus" || adj.type === "allowance";
                  const kLabel = labels[adj.type as AdjustmentKind]?.ar || adj.type;
                  return (
                    <div
                      key={adj.id}
                      className={`p-2.5 rounded border flex items-center justify-between gap-2 ${
                        isPos
                          ? "bg-emerald-50/60 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-800"
                          : "bg-red-50/60 dark:bg-red-950/30 border-red-300 dark:border-red-800"
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5 font-bold">
                          {selectedWorkerIds.length > 1 && adj.workerName && (
                            <span className="px-1.5 py-0.5 rounded bg-zinc-900 text-white text-[10px]">
                              {adj.workerName}
                            </span>
                          )}
                          <span className={isPos ? "text-emerald-800 dark:text-emerald-300" : "text-red-700 dark:text-red-300"}>
                            {isPos ? "🎁" : "⛔"} {kLabel}: {isPos ? "+" : "-"}EGP {adj.amount}
                          </span>
                          <span className="text-[10px] text-zinc-500 font-normal">({adj.date})</span>
                        </div>
                        {adj.reason && <p className="text-[11px] text-zinc-600 dark:text-zinc-300 truncate">{adj.reason}</p>}
                      </div>
                      <button
                        type="button"
                        disabled={deletingId === adj.id}
                        onClick={() => void handleRemoveAdjustment(adj)}
                        className="shrink-0 px-2.5 py-1 bg-white dark:bg-zinc-900 hover:bg-red-600 text-red-600 hover:text-white border border-red-300 rounded text-[10px] font-bold cursor-pointer transition-colors"
                      >
                        {deletingId === adj.id
                          ? t("جارٍ الحذف...", "Removing...")
                          : t("🗑️ شيل / حذف", "🗑️ Remove")}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
