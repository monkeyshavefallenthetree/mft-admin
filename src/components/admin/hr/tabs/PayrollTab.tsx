"use client";

import { useMemo, useState } from "react";
import { formatDepartment, type HrSettings, type HolidayItem, type PayrollAdjustment } from "@/lib/admin/hrReports";
import { useHrLang } from "@/lib/admin/hrI18n";
import HrDateRangeSelector from "@/components/admin/hr/HrDateRangeSelector";
import type { AdjustmentKind } from "@/components/admin/hr/HrAdjustmentModal";
import type { Worker } from "@/lib/admin/hrPageTypes";
import type { HrData } from "@/lib/admin/useHrData";
import { workerName } from "@/components/admin/hr/hrPageUtils";

interface Props {
  settings: HrSettings;
  holidays: HolidayItem[];
  rangeKey: string;
  setRangeKey: (k: string) => void;
  setCustomStart: (d: Date) => void;
  setCustomEnd: (d: Date) => void;
  activePeriod: HrData["activePeriod"];
  currentCycleStatus: HrData["currentCycleStatus"];
  payrollTableData: HrData["payrollTableData"];
  payrollTotals: HrData["payrollTotals"];
  setPolicyModalOpen: (open: boolean) => void;
  setSection: (key: string) => void;
  setOnboardModalWorker: (w: Worker) => void;
  setPayslipModalWorker: (w: Worker) => void;
  openAdjustmentFor: (workerId?: string, kind?: AdjustmentKind) => void;
  handleRemoveAdjustment: (adj: PayrollAdjustment, workerDisplayName?: string) => Promise<void>;
  handleToggleCycleStatus: (nextStatus: "draft" | "approved" | "paid") => Promise<void>;
  exportPayrollCsv: () => void;
}

export default function PayrollTab({
  settings,
  holidays,
  rangeKey,
  setRangeKey,
  setCustomStart,
  setCustomEnd,
  activePeriod,
  currentCycleStatus,
  payrollTableData,
  payrollTotals,
  setPolicyModalOpen,
  setSection,
  setOnboardModalWorker,
  setPayslipModalWorker,
  openAdjustmentFor,
  handleRemoveAdjustment,
  handleToggleCycleStatus,
  exportPayrollCsv,
}: Props) {
  const { t } = useHrLang();
  const [payrollSearch, setPayrollSearch] = useState("");

  const [payrollAdjFilter, setPayrollAdjFilter] = useState<"all" | "has_deduction" | "has_bonus">("all");

  const filteredPayrollRows = useMemo(() => {
    const q = payrollSearch.trim().toLowerCase();
    return payrollTableData.filter(({ worker: w, payroll: p, adjustments: workerAdjs }) => {
      if (payrollAdjFilter === "has_deduction") {
        const hasDed =
          p.manualDeductions > 0 ||
          p.absencePenalty > 0 ||
          p.totalLatePenaltyEgp > 0 ||
          workerAdjs.some((a) => a.type === "deduction" || a.type === "advance");
        if (!hasDed) return false;
      } else if (payrollAdjFilter === "has_bonus") {
        const hasBon =
          p.manualBonuses > 0 ||
          p.allowances > 0 ||
          p.overtimePay > 0 ||
          workerAdjs.some((a) => a.type === "bonus" || a.type === "allowance");
        if (!hasBon) return false;
      }
      if (q) {
        const blob = `${workerName(w)} ${w.department || ""} ${w.role || ""} ${w.email || ""}`.toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
  }, [payrollTableData, payrollSearch, payrollAdjFilter]);

  return (
    <div className="space-y-5 animate-fade-in font-mono">
      <HrDateRangeSelector
        rangeKey={rangeKey}
        onRangeKeyChange={setRangeKey}
        periodStart={activePeriod.start}
        periodEnd={activePeriod.end}
        onCustomDatesChange={(start, end) => {
          setCustomStart(start);
          setCustomEnd(end);
          setRangeKey("custom");
        }}
        settings={settings}
        holidays={holidays}
        onOpenPolicyModal={() => setPolicyModalOpen(true)}
      />

      {/* Payroll Financial Summary & Disbursal Status Bar */}
      <div className="p-5 bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-700 shadow-[4px_4px_0px_0px_#09090b] rounded-lg space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-zinc-900 dark:border-zinc-700 pb-3">
          <div>
            <span className="text-[10px] font-bold uppercase text-zinc-400">
              {t("حالة دورة الرواتب", "Payroll Cycle Status")}
            </span>
            <div className="flex items-center gap-2 mt-0.5">
              <span
                className={`px-3 py-1 rounded text-xs font-bold uppercase border ${
                  currentCycleStatus === "paid"
                    ? "bg-emerald-600 text-white border-emerald-700"
                    : currentCycleStatus === "approved"
                      ? "bg-blue-600 text-white border-blue-700"
                      : "bg-amber-100 text-amber-800 border-amber-300"
                }`}
              >
                {currentCycleStatus === "paid"
                  ? t("تم الصرف (Paid)", "Paid (تم الصرف)")
                  : currentCycleStatus === "approved"
                    ? t("معتمد للصرف (Approved)", "Approved for Payout")
                    : t("مسودة قيد المراجعة (Draft)", "Draft (Under Review)")}
              </span>
              <span className="text-xs text-zinc-500">
                {t("الفترة:", "Cycle:")} {activePeriod.label}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => openAdjustmentFor(undefined, "bonus")}
              className="px-3 py-1.5 border-2 border-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-600 hover:text-white text-emerald-800 dark:text-emerald-300 text-xs font-bold cursor-pointer rounded transition-colors"
            >
              {t("🎁 + إضافة بونص / مكافأة", "🎁 + Add Bonus")}
            </button>
            <button
              type="button"
              onClick={() => openAdjustmentFor(undefined, "deduction")}
              className="px-3 py-1.5 border-2 border-red-700 bg-red-50 dark:bg-red-950/40 hover:bg-red-600 hover:text-white text-red-800 dark:text-red-300 text-xs font-bold cursor-pointer rounded transition-colors"
            >
              {t("⛔ + إضافة خصم إداري", "⛔ + Add Deduction")}
            </button>
            <button
              type="button"
              onClick={() => openAdjustmentFor(undefined, "advance")}
              className="px-3 py-1.5 border-2 border-zinc-900 dark:border-zinc-700 bg-white dark:bg-zinc-800 hover:bg-zinc-100 text-zinc-950 dark:text-zinc-100 text-xs font-bold cursor-pointer rounded"
            >
              {t("💸 + سلفة / بدل", "💸 + Advance / Allowance")}
            </button>
            <button
              type="button"
              onClick={exportPayrollCsv}
              className="px-3 py-1.5 border-2 border-zinc-900 dark:border-zinc-700 bg-white dark:bg-zinc-800 hover:bg-zinc-100 text-zinc-950 dark:text-zinc-100 text-xs font-bold cursor-pointer rounded"
            >
              {t("📥 تصدير شيت الرواتب CSV", "📥 Export CSV")}
            </button>
            {currentCycleStatus === "draft" && (
              <button
                type="button"
                onClick={() => void handleToggleCycleStatus("approved")}
                className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold border-2 border-zinc-900 cursor-pointer shadow-[2px_2px_0px_0px_#09090b] rounded"
              >
                {t("اعتماد كشف الرواتب", "Approve Payroll")}
              </button>
            )}
            {currentCycleStatus === "approved" && (
              <button
                type="button"
                onClick={() => void handleToggleCycleStatus("paid")}
                className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold border-2 border-zinc-900 cursor-pointer shadow-[2px_2px_0px_0px_#059669] rounded"
              >
                {t("✓ تأكيد الصرف (تم الصرف)", "✓ Mark as Paid")}
              </button>
            )}
            {currentCycleStatus === "paid" && (
              <button
                type="button"
                onClick={() => void handleToggleCycleStatus("draft")}
                className="px-2 py-1 text-zinc-400 hover:text-red-600 text-xs underline cursor-pointer"
              >
                {t("إلغاء القفل / تعديل", "Unlock / Revert")}
              </button>
            )}
          </div>
        </div>

        {/* Financial Numbers Strip */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-xs">
          <div className="p-3 bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 rounded">
            <span className="text-zinc-500 text-[10px] uppercase font-bold">
              {t("إجمالي الاستحقاقات", "Gross Earnings")}
            </span>
            <p className="text-xl font-bold font-oswald text-zinc-900 dark:text-white mt-1">EGP {payrollTotals.gross}</p>
          </div>
          <div className="p-3 bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 rounded">
            <span className="text-zinc-500 text-[10px] uppercase font-bold">
              {settings.policy2026Enabled
                ? t(
                    `إجمالي الإضافي (${settings.dayOtMultiplier ?? 1.35}x / ${settings.nightOtMultiplier ?? 1.7}x)`,
                    `Overtime (${settings.dayOtMultiplier ?? 1.35}x / ${settings.nightOtMultiplier ?? 1.7}x)`,
                  )
                : t(`إجمالي الإضافي (${settings.overtimeMultiplier || 1.5}x)`, `Overtime (${settings.overtimeMultiplier || 1.5}x)`)}
            </span>
            <p className="text-xl font-bold font-oswald text-emerald-700 dark:text-emerald-400 mt-1">+EGP {payrollTotals.overtime}</p>
          </div>
          <div className="p-3 bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/60 rounded">
            <span className="text-emerald-800 dark:text-emerald-300 text-[10px] uppercase font-bold">
              {t("🎁 البونص والبدلات", "🎁 Bonuses & Allowances")}
            </span>
            <p className="text-xl font-bold font-oswald text-emerald-700 dark:text-emerald-400 mt-1">
              +EGP {payrollTotals.bonuses}
            </p>
          </div>
          <div className="p-3 bg-red-50/60 dark:bg-red-950/20 border border-red-200 dark:border-red-800/60 rounded">
            <span className="text-red-800 dark:text-red-300 text-[10px] uppercase font-bold">
              {t("⛔ الخصومات الإدارية والحضور", "⛔ Admin & Attendance Ded.")}
            </span>
            <p className="text-xl font-bold font-oswald text-red-600 dark:text-red-400 mt-1">
              -EGP {payrollTotals.deductions}
            </p>
            <div className="text-[10px] text-zinc-500 mt-0.5">
              {t(
                `إداري: ${payrollTotals.manualDeductions} · غياب/تأخير: ${payrollTotals.attendanceDeductions}`,
                `Admin: ${payrollTotals.manualDeductions} · Att: ${payrollTotals.attendanceDeductions}`,
              )}
            </div>
          </div>
          <div className="p-3 bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 rounded">
            <span className="text-zinc-500 text-[10px] uppercase font-bold">
              {t("السلف المستردة (Advances)", "Advances (سلف)")}
            </span>
            <p className="text-xl font-bold font-oswald text-red-600 dark:text-red-400 mt-1">-EGP {payrollTotals.advances}</p>
          </div>
          <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 rounded col-span-2 md:col-span-1">
            <span className="text-emerald-800 dark:text-emerald-300 text-[10px] uppercase font-bold">
              {t("صافي المبلغ المستحق للصرف", "Net Due to Disburse")}
            </span>
            <p className="text-xl font-bold font-oswald text-emerald-800 dark:text-emerald-300 mt-1">EGP {payrollTotals.net}</p>
          </div>
        </div>
      </div>

      {/* Payroll Search & Quick Filter Bar */}
      <div className="p-3.5 bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-700 shadow-[2px_2px_0px_0px_#09090b] rounded-lg flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={payrollSearch}
            onChange={(e) => setPayrollSearch(e.target.value)}
            placeholder={t("🔍 ابحث عن موظف في شيت الرواتب بالاسم أو القسم...", "🔍 Search employee in Payroll Sheet...")}
            className="bg-zinc-50 dark:bg-zinc-800 border-2 border-zinc-900 dark:border-zinc-700 px-3 py-1.5 text-xs font-bold rounded text-zinc-950 dark:text-zinc-100 w-full sm:w-72 focus:outline-none focus:ring-2 focus:ring-red-600"
          />
          <div className="flex items-center gap-1">
            {(
              [
                { id: "all", label: t(`كل الموظفين (${payrollTableData.length})`, `All (${payrollTableData.length})`) },
                { id: "has_deduction", label: t("⛔ عليهم خصم / جزاء", "⛔ Has Deductions") },
                { id: "has_bonus", label: t("🎁 لهم بونص / إضافي", "🎁 Has Bonus / OT") },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setPayrollAdjFilter(f.id)}
                className={`px-2.5 py-1.5 rounded text-xs font-bold cursor-pointer border transition-all ${
                  payrollAdjFilter === f.id
                    ? "bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950 border-zinc-950"
                    : "bg-zinc-50 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setSection("disciplinary")}
          className="px-3 py-1.5 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-600 hover:text-white text-rose-800 dark:text-rose-200 border border-rose-400 dark:border-rose-800 rounded text-xs font-bold cursor-pointer transition-colors"
        >
          {t("⚖️ فتح لائحة الجزاءات الرسمية وتوقيع جزاء ←", "⚖️ Open Official Disciplinary Schedule →")}
        </button>
      </div>

      {/* Full Payroll Data Table */}
      <div className="bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-700 shadow-[3px_3px_0px_0px_#09090b] rounded-lg overflow-x-auto text-xs">
        <table className="w-full text-start divide-y divide-zinc-200 dark:divide-zinc-800 font-mono">
          <thead className="bg-zinc-100 dark:bg-zinc-800 text-[10px] font-bold uppercase text-zinc-600 dark:text-zinc-400">
            <tr>
              <th className="py-3 px-4 text-start">{t("الموظف", "Employee")}</th>
              <th className="py-3 px-3 text-start">{t("تاريخ التعيين", "Joined")}</th>
              <th className="py-3 px-3 text-start">{t("أيام العمل", "Worked")}</th>
              <th className="py-3 px-3 text-start">{t("أجر الساعة", "Rate")}</th>
              <th className="py-3 px-3 text-start">{t("الأساسي", "Base Pay")}</th>
              <th className="py-3 px-3 text-start text-emerald-700 dark:text-emerald-400">{t("الإضافي", "OT Pay")}</th>
              <th className="py-3 px-3 text-start text-emerald-700 dark:text-emerald-400">
                {t("🎁 البونص / البدلات", "🎁 Bonuses / Allowances")}
              </th>
              <th className="py-3 px-3 text-start text-sky-700 dark:text-sky-400">{t("الأذونات", "Permissions")}</th>
              <th className="py-3 px-3 text-start text-red-600">
                {t("⛔ خصومات إدارية", "⛔ Admin Deductions")}
              </th>
              <th className="py-3 px-3 text-start text-red-600">{t("الغياب/التأخير", "Attendance Ded.")}</th>
              <th className="py-3 px-3 text-start text-red-600">{t("السلف", "Advances")}</th>
              <th className="py-3 px-4 text-end">{t("صافي المستحق", "Net Payable")}</th>
              <th className="py-3 px-3 text-center">{t("إجراءات سريعة", "Quick Actions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {filteredPayrollRows.map(({ worker: w, payroll: p, adjustments: workerAdjs }) => {
              const attendanceDed =
                Math.round((p.absencePenalty + p.totalLatePenaltyEgp + p.shortfallDeduction) * 100) / 100;
              const bonusAndAllowanceTotal =
                Math.round((p.manualBonuses + p.allowances) * 100) / 100;
              const bonusAdjs = workerAdjs.filter((a) => a.type === "bonus" || a.type === "allowance");
              const deductionAdjs = workerAdjs.filter((a) => a.type === "deduction");
              const advanceAdjs = workerAdjs.filter((a) => a.type === "advance");
              return (
                <tr key={w.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                  <td className="py-3 px-4">
                    <div className="font-bold text-zinc-950 dark:text-white">{workerName(w)}</div>
                    <div className="text-[10px] text-zinc-500">{formatDepartment(w.department)}</div>
                  </td>
                  <td className="py-3 px-3">
                    <button
                      type="button"
                      onClick={() => setOnboardModalWorker(w)}
                      className={`text-[11px] font-bold underline cursor-pointer ${
                        w.hireDate ? "text-zinc-800 dark:text-zinc-200" : "text-amber-600"
                      }`}
                    >
                      {w.hireDate || t("⚠ حدد التاريخ", "⚠ Set Date")}
                    </button>
                  </td>
                  <td className="py-3 px-3">
                    <strong>
                      {p.daysWorked}/{p.expectedWorkDays}d
                    </strong>{" "}
                    <span className="text-zinc-400">({p.totalHours}h)</span>
                  </td>
                  <td className="py-3 px-3">EGP {p.hourlyRate}/h</td>
                  <td className="py-3 px-3 font-semibold">EGP {p.basePay}</td>
                  <td className="py-3 px-3 text-emerald-700 dark:text-emerald-400 font-semibold">
                    +{p.overtimePay}
                  </td>
                  {/* Bonuses & Allowances Column with Inline Remove Chips */}
                  <td className="py-3 px-3">
                    <div className="text-emerald-700 dark:text-emerald-400 font-bold">
                      {bonusAndAllowanceTotal > 0 ? `+EGP ${bonusAndAllowanceTotal}` : "0"}
                    </div>
                    {bonusAdjs.length > 0 && (
                      <div className="mt-1 flex flex-col gap-1">
                        {bonusAdjs.map((adj) => (
                          <div
                            key={adj.id}
                            className="inline-flex items-center justify-between gap-1.5 px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-300 dark:border-emerald-800 text-[10px] text-emerald-900 dark:text-emerald-200"
                            title={adj.reason}
                          >
                            <span className="truncate max-w-[120px]">
                              {adj.type === "bonus" ? "🎁" : "🚕"} +{adj.amount} ({adj.reason})
                            </span>
                            <button
                              type="button"
                              onClick={() => void handleRemoveAdjustment(adj, workerName(w))}
                              title={t("شيل / حذف من البايرول", "Remove from Payroll")}
                              className="px-1 py-0.2 bg-red-600 hover:bg-red-700 text-white rounded text-[9px] font-bold cursor-pointer shrink-0"
                            >
                              {t("✕ شيل", "✕")}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="py-3 px-3 text-sky-700 dark:text-sky-400">
                    {p.permissionsUsed}/4 ({p.permissionMinutesUsed}m)
                  </td>
                  {/* Admin Deductions Column with Inline Remove Chips */}
                  <td className="py-3 px-3">
                    <div className="text-red-600 font-bold">
                      {p.manualDeductions > 0 ? `-EGP ${p.manualDeductions}` : "0"}
                    </div>
                    {deductionAdjs.length > 0 && (
                      <div className="mt-1 flex flex-col gap-1">
                        {deductionAdjs.map((adj) => (
                          <div
                            key={adj.id}
                            className="inline-flex items-center justify-between gap-1.5 px-1.5 py-0.5 rounded bg-red-50 dark:bg-red-950/50 border border-red-300 dark:border-red-800 text-[10px] text-red-900 dark:text-red-200"
                            title={adj.reason}
                          >
                            <span className="truncate max-w-[120px]">
                              ⛔ -{adj.amount} ({adj.reason})
                            </span>
                            <button
                              type="button"
                              onClick={() => void handleRemoveAdjustment(adj, workerName(w))}
                              title={t("شيل الخصم من البايرول", "Remove Deduction from Payroll")}
                              className="px-1 py-0.2 bg-red-600 hover:bg-red-700 text-white rounded text-[9px] font-bold cursor-pointer shrink-0"
                            >
                              {t("✕ شيل الخصم", "✕ Remove")}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="py-3 px-3 text-red-600">
                    {attendanceDed > 0 ? `-${attendanceDed}` : "0"}
                  </td>
                  <td className="py-3 px-3 text-red-600 font-semibold">
                    <div>{p.salaryAdvances > 0 ? `-${p.salaryAdvances}` : "0"}</div>
                    {advanceAdjs.length > 0 && (
                      <div className="mt-1 flex flex-col gap-1">
                        {advanceAdjs.map((adj) => (
                          <div
                            key={adj.id}
                            className="inline-flex items-center justify-between gap-1.5 px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-800 text-[10px] text-amber-900 dark:text-amber-200"
                            title={adj.reason}
                          >
                            <span className="truncate max-w-[100px]">
                              💸 -{adj.amount}
                            </span>
                            <button
                              type="button"
                              onClick={() => void handleRemoveAdjustment(adj, workerName(w))}
                              title={t("شيل السلفة من البايرول", "Remove Advance")}
                              className="px-1 py-0.2 bg-red-600 hover:bg-red-700 text-white rounded text-[9px] font-bold cursor-pointer shrink-0"
                            >
                              {t("✕ شيل", "✕")}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="py-3 px-4 text-end font-bold font-oswald text-sm text-emerald-700 dark:text-emerald-400">
                    EGP {p.netPayable}
                  </td>
                  <td className="py-3 px-3 text-center">
                    <div className="flex flex-wrap items-center justify-center gap-1">
                      <button
                        type="button"
                        onClick={() => openAdjustmentFor(w.id, "bonus")}
                        title={t("إضافة بونص / مكافأة لهذا الموظف", "Add Bonus for this Employee")}
                        className="px-2 py-1 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-600 hover:text-white text-emerald-800 dark:text-emerald-300 border border-emerald-400 dark:border-emerald-700 rounded text-[10px] font-bold transition-all cursor-pointer"
                      >
                        {t("🎁 +بونص", "🎁 +Bonus")}
                      </button>
                      <button
                        type="button"
                        onClick={() => openAdjustmentFor(w.id, "deduction")}
                        title={t("إضافة خصم إداري على هذا الموظف", "Add Admin Deduction for this Employee")}
                        className="px-2 py-1 bg-red-50 dark:bg-red-950/40 hover:bg-red-600 hover:text-white text-red-800 dark:text-red-300 border border-red-400 dark:border-red-700 rounded text-[10px] font-bold transition-all cursor-pointer"
                      >
                        {t("⛔ +خصم", "⛔ +Deduct")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setOnboardModalWorker(w)}
                        title={t("ضبط تاريخ التعيين والراتب", "Set Joining Date & Rate")}
                        className="px-2 py-1 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-900 hover:text-white border border-zinc-300 dark:border-zinc-700 rounded text-[10px] font-bold transition-all cursor-pointer"
                      >
                        🗓️
                      </button>
                      <button
                        type="button"
                        onClick={() => setPayslipModalWorker(w)}
                        className="px-2.5 py-1 bg-zinc-100 dark:bg-zinc-800 hover:bg-red-600 hover:text-white border border-zinc-300 dark:border-zinc-700 rounded text-[10px] font-bold uppercase transition-all cursor-pointer"
                      >
                        {t("كشف الراتب 📄", "Payslip 📄")}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
