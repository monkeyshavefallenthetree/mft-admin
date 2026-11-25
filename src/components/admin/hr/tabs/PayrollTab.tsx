"use client";

import { useMemo, useState } from "react";
import { formatDepartment, type HrSettings, type HolidayItem, type PayrollAdjustment } from "@/lib/admin/hrReports";
import { useHrLang } from "@/lib/admin/hrI18n";
import HrDateRangeSelector from "@/components/admin/hr/HrDateRangeSelector";
import type { AdjustmentKind } from "@/components/admin/hr/HrAdjustmentModal";
import type { Worker } from "@/lib/admin/hrPageTypes";
import type { HrData } from "@/lib/admin/useHrData";
import { workerName } from "@/components/admin/hr/hrPageUtils";
import { ChartCard, BarCompare, DonutBreakdown } from "@/components/admin/ui/Charts";

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
  const [showAnalytics, setShowAnalytics] = useState(true);

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

  const topEarnersChartData = useMemo(() => {
    return [...payrollTableData]
      .sort((a, b) => b.payroll.netPayable - a.payroll.netPayable)
      .slice(0, 7)
      .map(({ worker: w, payroll: p }) => {
        const fullName = workerName(w);
        return {
          worker: fullName.length > 14 ? fullName.slice(0, 13) + "…" : fullName,
          Base: Math.round(p.basePay),
          Extras: Math.round(p.overtimePay + p.manualBonuses + p.allowances),
          Net: Math.round(p.netPayable),
        };
      });
  }, [payrollTableData]);

  const financialCompositionSlices = useMemo(() => {
    const totalBase = payrollTableData.reduce((s, r) => s + r.payroll.basePay, 0);
    return [
      { key: "base", label: t("الراتب الأساسي", "Base Pay"), value: Math.round(totalBase), color: "#09090b" },
      { key: "ot", label: t("الإضافي", "Overtime"), value: Math.round(payrollTotals.overtime), color: "#10b981" },
      { key: "bonus", label: t("البونص والبدلات", "Bonuses & Allowances"), value: Math.round(payrollTotals.bonuses), color: "#3b82f6" },
      { key: "deductions", label: t("الخصومات والسلف", "Deductions & Advances"), value: Math.round(payrollTotals.deductions + payrollTotals.advances), color: "#ef4444" },
    ];
  }, [payrollTableData, payrollTotals, t]);

  return (
    <div className="space-y-5 animate-fade-in">
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
      <div className="ui-card p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 pb-3.5">
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              {t("حالة دورة الرواتب", "Payroll Cycle Status")}
            </span>
            <div className="flex items-center gap-2.5 mt-1">
              <span
                className={`px-3 py-1 rounded-full text-xs font-semibold uppercase border ${
                  currentCycleStatus === "paid"
                    ? "bg-emerald-600 text-white border-emerald-700"
                    : currentCycleStatus === "approved"
                      ? "bg-blue-600 text-white border-blue-700"
                      : "bg-amber-50 text-amber-800 border-amber-200"
                }`}
              >
                {currentCycleStatus === "paid"
                  ? t("تم الصرف (Paid)", "Paid (تم الصرف)")
                  : currentCycleStatus === "approved"
                    ? t("معتمد للصرف (Approved)", "Approved for Payout")
                    : t("مسودة قيد المراجعة (Draft)", "Draft (Under Review)")}
              </span>
              <span className="font-code text-xs text-zinc-500">
                {t("الفترة:", "Cycle:")} {activePeriod.label}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowAnalytics((v) => !v)}
              className="brutal-btn-outline"
            >
              <span>{showAnalytics ? t("إخفاء الرسوم", "Hide Charts") : t("تحليلات الرواتب", "Payroll Charts")}</span>
            </button>
            <button
              type="button"
              onClick={() => openAdjustmentFor(undefined, "bonus")}
              className="px-3 py-1.5 border border-emerald-200 bg-emerald-50 hover:bg-emerald-600 hover:text-white text-emerald-800 text-xs font-semibold cursor-pointer rounded-xl transition-colors"
            >
              {t("🎁 + إضافة بونص / مكافأة", "🎁 + Add Bonus")}
            </button>
            <button
              type="button"
              onClick={() => openAdjustmentFor(undefined, "deduction")}
              className="px-3 py-1.5 border border-red-200 bg-red-50 hover:bg-red-600 hover:text-white text-red-800 text-xs font-semibold cursor-pointer rounded-xl transition-colors"
            >
              {t("⛔ + إضافة خصم إداري", "⛔ + Add Deduction")}
            </button>
            <button
              type="button"
              onClick={() => openAdjustmentFor(undefined, "advance")}
              className="brutal-btn-outline"
            >
              {t("💸 + سلفة / بدل", "💸 + Advance / Allowance")}
            </button>
            <button
              type="button"
              onClick={exportPayrollCsv}
              className="brutal-btn-outline"
            >
              {t("📥 تصدير شيت الرواتب CSV", "📥 Export CSV")}
            </button>
            {currentCycleStatus === "draft" && (
              <button
                type="button"
                onClick={() => void handleToggleCycleStatus("approved")}
                className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer shadow-2xs rounded-xl transition-colors"
              >
                {t("اعتماد كشف الرواتب", "Approve Payroll")}
              </button>
            )}
            {currentCycleStatus === "approved" && (
              <button
                type="button"
                onClick={() => void handleToggleCycleStatus("paid")}
                className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer shadow-2xs rounded-xl transition-colors"
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
          <div className="p-3.5 bg-zinc-50/80 border border-zinc-200/80 rounded-xl">
            <span className="text-zinc-500 text-[10px] uppercase font-semibold tracking-wider">
              {t("إجمالي الاستحقاقات", "Gross Earnings")}
            </span>
            <p className="font-code text-lg font-bold text-zinc-900 mt-1">EGP {payrollTotals.gross}</p>
          </div>
          <div className="p-3.5 bg-zinc-50/80 border border-zinc-200/80 rounded-xl">
            <span className="text-zinc-500 text-[10px] uppercase font-semibold tracking-wider">
              {settings.policy2026Enabled
                ? t(
                    `إجمالي الإضافي (${settings.dayOtMultiplier ?? 1.35}x / ${settings.nightOtMultiplier ?? 1.7}x)`,
                    `Overtime (${settings.dayOtMultiplier ?? 1.35}x / ${settings.nightOtMultiplier ?? 1.7}x)`,
                  )
                : t(`إجمالي الإضافي (${settings.overtimeMultiplier || 1.5}x)`, `Overtime (${settings.overtimeMultiplier || 1.5}x)`)}
            </span>
            <p className="font-code text-lg font-bold text-emerald-700 mt-1">+EGP {payrollTotals.overtime}</p>
          </div>
          <div className="p-3.5 bg-emerald-50/60 border border-emerald-200/80 rounded-xl">
            <span className="text-emerald-800 text-[10px] uppercase font-semibold tracking-wider">
              {t("🎁 البونص والبدلات", "🎁 Bonuses & Allowances")}
            </span>
            <p className="font-code text-lg font-bold text-emerald-700 mt-1">
              +EGP {payrollTotals.bonuses}
            </p>
          </div>
          <div className="p-3.5 bg-red-50/60 border border-red-200/80 rounded-xl">
            <span className="text-red-800 text-[10px] uppercase font-semibold tracking-wider">
              {t("⛔ الخصومات الإدارية والحضور", "⛔ Admin & Attendance Ded.")}
            </span>
            <p className="font-code text-lg font-bold text-red-600 mt-1">
              -EGP {payrollTotals.deductions}
            </p>
            <div className="font-code text-[10px] text-zinc-500 mt-0.5">
              {t(
                `إداري: ${payrollTotals.manualDeductions} · غياب/تأخير: ${payrollTotals.attendanceDeductions}`,
                `Admin: ${payrollTotals.manualDeductions} · Att: ${payrollTotals.attendanceDeductions}`,
              )}
            </div>
          </div>
          <div className="p-3.5 bg-zinc-50/80 border border-zinc-200/80 rounded-xl">
            <span className="text-zinc-500 text-[10px] uppercase font-semibold tracking-wider">
              {t("السلف المستردة (Advances)", "Advances (سلف)")}
            </span>
            <p className="font-code text-lg font-bold text-red-600 mt-1">-EGP {payrollTotals.advances}</p>
          </div>
          <div className="p-3.5 bg-emerald-50 border border-emerald-300 rounded-xl col-span-2 md:col-span-1">
            <span className="text-emerald-800 text-[10px] uppercase font-semibold tracking-wider">
              {t("صافي المبلغ المستحق للصرف", "Net Due to Disburse")}
            </span>
            <p className="font-code text-lg font-bold text-emerald-800 mt-1">EGP {payrollTotals.net}</p>
          </div>
        </div>
      </div>

      {/* Collapsible Executive Payroll Analytics */}
      {showAnalytics && payrollTableData.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 animate-fade-in">
          <ChartCard
            className="lg:col-span-7"
            title={t("توزيع صافي الرواتب والإضافي للموظفين", "Employee Compensation & Extra Earnings")}
            subtitle={t("الراتب الأساسي مقابل الإضافي والبونص وصافي المستحق (ج.م)", "Base pay vs overtime/bonuses and net payable (EGP)")}
          >
            <BarCompare
              data={topEarnersChartData}
              xKey="worker"
              series={[
                { key: "Base", label: t("الأساسي", "Base Pay"), color: "#09090b" },
                { key: "Extras", label: t("الإضافي والبونص", "OT & Bonuses"), color: "#10b981" },
                { key: "Net", label: t("صافي المستحق", "Net Payable"), color: "#dc2626" },
              ]}
              height={205}
              description="Compensation breakdown"
            />
          </ChartCard>

          <ChartCard
            className="lg:col-span-5"
            title={t("هيكل تكلفة الرواتب للدورة الحالية", "Payroll Cost Structure")}
            subtitle={t("توزيع البنود المالية للدورة الحالية", "Breakdown of gross earnings, bonuses, and deductions")}
          >
            <DonutBreakdown
              slices={financialCompositionSlices}
              centerLabel={t("صافي الصرف", "Net Payout")}
              centerValue={`EGP ${payrollTotals.net}`}
              size={165}
              description="Payroll composition"
            />
          </ChartCard>
        </div>
      )}

      {/* Payroll Search & Quick Filter Bar */}
      <div className="ui-card p-3.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={payrollSearch}
            onChange={(e) => setPayrollSearch(e.target.value)}
            placeholder={t("🔍 ابحث عن موظف في شيت الرواتب بالاسم أو القسم...", "🔍 Search employee in Payroll Sheet...")}
            className="bg-zinc-50/80 border border-zinc-200 px-3 py-1.5 text-xs font-medium rounded-xl text-zinc-950 w-full sm:w-72 focus:outline-none focus:border-zinc-900 focus:bg-white"
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
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer border transition-all ${
                  payrollAdjFilter === f.id
                    ? "bg-zinc-900 text-white border-zinc-900"
                    : "bg-zinc-50 text-zinc-700 border-zinc-200 hover:bg-zinc-100"
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
          className="px-3.5 py-1.5 bg-rose-50 hover:bg-rose-600 hover:text-white text-rose-800 border border-rose-200 rounded-xl text-xs font-semibold cursor-pointer transition-colors"
        >
          {t("⚖️ فتح لائحة الجزاءات الرسمية وتوقيع جزاء ←", "⚖️ Open Official Disciplinary Schedule →")}
        </button>
      </div>

      {/* Accessible Responsive Payroll Data Table (modern-web-guidance: responsive-table) */}
      <div
        tabIndex={0}
        role="region"
        aria-labelledby="payroll-sheet-caption"
        className="ui-card mft-table-wrapper text-xs"
      >
        <table className="w-full text-start divide-y divide-zinc-100">
          <caption id="payroll-sheet-caption" className="sr-only">
            Employee payroll calculation and disbursal table
          </caption>
          <thead className="bg-zinc-50/95 text-[11px] font-semibold text-zinc-500">
            <tr>
              <th scope="col" className="py-3 px-4 text-start">{t("الموظف", "Employee")}</th>
              <th scope="col" className="py-3 px-3 text-start">{t("تاريخ التعيين", "Joined")}</th>
              <th scope="col" className="py-3 px-3 text-start">{t("أيام العمل", "Worked")}</th>
              <th scope="col" className="py-3 px-3 text-start">{t("أجر الساعة", "Rate")}</th>
              <th scope="col" className="py-3 px-3 text-start">{t("الأساسي", "Base Pay")}</th>
              <th scope="col" className="py-3 px-3 text-start text-emerald-700">{t("الإضافي", "OT Pay")}</th>
              <th scope="col" className="py-3 px-3 text-start text-emerald-700">
                {t("🎁 البونص / البدلات", "🎁 Bonuses / Allowances")}
              </th>
              <th scope="col" className="py-3 px-3 text-start text-sky-700">{t("الأذونات", "Permissions")}</th>
              <th scope="col" className="py-3 px-3 text-start text-red-600">
                {t("⛔ خصومات إدارية", "⛔ Admin Deductions")}
              </th>
              <th scope="col" className="py-3 px-3 text-start text-red-600">{t("الغياب/التأخير", "Attendance Ded.")}</th>
              <th scope="col" className="py-3 px-3 text-start text-red-600">{t("السلف", "Advances")}</th>
              <th scope="col" className="py-3 px-4 text-end">{t("صافي المستحق", "Net Payable")}</th>
              <th scope="col" className="py-3 px-3 text-center">{t("إجراءات سريعة", "Quick Actions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {filteredPayrollRows.map(({ worker: w, payroll: p, adjustments: workerAdjs }) => {
              const attendanceDed =
                Math.round((p.absencePenalty + p.totalLatePenaltyEgp + p.shortfallDeduction) * 100) / 100;
              const bonusAndAllowanceTotal =
                Math.round((p.manualBonuses + p.allowances) * 100) / 100;
              const bonusAdjs = workerAdjs.filter((a) => a.type === "bonus" || a.type === "allowance");
              const deductionAdjs = workerAdjs.filter((a) => a.type === "deduction");
              const advanceAdjs = workerAdjs.filter((a) => a.type === "advance");
              return (
                <tr key={w.id} className="hover:bg-zinc-50/80 transition-colors">
                  <th scope="row" className="py-3 px-4 font-normal text-start">
                    <div className="font-semibold text-zinc-950">{workerName(w)}</div>
                    <div className="text-[11px] text-zinc-500">{formatDepartment(w.department)}</div>
                  </th>
                  <td className="py-3 px-3 font-code">
                    <button
                      type="button"
                      onClick={() => setOnboardModalWorker(w)}
                      className={`text-[11px] font-semibold underline cursor-pointer ${
                        w.hireDate ? "text-zinc-800" : "text-amber-600"
                      }`}
                    >
                      {w.hireDate || t("⚠ حدد التاريخ", "⚠ Set Date")}
                    </button>
                  </td>
                  <td className="py-3 px-3 font-code">
                    <strong>
                      {p.daysWorked}/{p.expectedWorkDays}d
                    </strong>{" "}
                    <span className="text-zinc-400">({p.totalHours}h)</span>
                  </td>
                  <td className="py-3 px-3 font-code">EGP {p.hourlyRate}/h</td>
                  <td className="py-3 px-3 font-code font-semibold">EGP {p.basePay}</td>
                  <td className="py-3 px-3 font-code text-emerald-700 font-semibold">
                    +{p.overtimePay}
                  </td>
                  <td className="py-3 px-3 font-code">
                    <div className="text-emerald-700 font-bold">
                      {bonusAndAllowanceTotal > 0 ? `+EGP ${bonusAndAllowanceTotal}` : "0"}
                    </div>
                    {bonusAdjs.length > 0 && (
                      <div className="mt-1 flex flex-col gap-1">
                        {bonusAdjs.map((adj) => (
                          <div
                            key={adj.id}
                            className="inline-flex items-center justify-between gap-1.5 px-2 py-0.5 rounded-lg bg-emerald-50 border border-emerald-200 text-[10px] text-emerald-900"
                            title={adj.reason}
                          >
                            <span className="truncate max-w-[120px]">
                              {adj.type === "bonus" ? "🎁" : "🚕"} +{adj.amount} ({adj.reason})
                            </span>
                            <button
                              type="button"
                              onClick={() => void handleRemoveAdjustment(adj, workerName(w))}
                              title={t("شيل / حذف من البايرول", "Remove from Payroll")}
                              className="px-1.5 py-0.2 bg-red-600 hover:bg-red-700 text-white rounded text-[9px] font-bold cursor-pointer shrink-0"
                            >
                              {t("✕ شيل", "✕")}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="py-3 px-3 font-code text-sky-700">
                    {p.permissionsUsed}/4 ({p.permissionMinutesUsed}m)
                  </td>
                  <td className="py-3 px-3 font-code">
                    <div className="text-red-600 font-bold">
                      {p.manualDeductions > 0 ? `-EGP ${p.manualDeductions}` : "0"}
                    </div>
                    {deductionAdjs.length > 0 && (
                      <div className="mt-1 flex flex-col gap-1">
                        {deductionAdjs.map((adj) => (
                          <div
                            key={adj.id}
                            className="inline-flex items-center justify-between gap-1.5 px-2 py-0.5 rounded-lg bg-red-50 border border-red-200 text-[10px] text-red-900"
                            title={adj.reason}
                          >
                            <span className="truncate max-w-[120px]">
                              ⛔ -{adj.amount} ({adj.reason})
                            </span>
                            <button
                              type="button"
                              onClick={() => void handleRemoveAdjustment(adj, workerName(w))}
                              title={t("شيل الخصم من البايرول", "Remove Deduction from Payroll")}
                              className="px-1.5 py-0.2 bg-red-600 hover:bg-red-700 text-white rounded text-[9px] font-bold cursor-pointer shrink-0"
                            >
                              {t("✕ شيل الخصم", "✕ Remove")}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="py-3 px-3 font-code text-red-600">
                    {attendanceDed > 0 ? `-${attendanceDed}` : "0"}
                  </td>
                  <td className="py-3 px-3 font-code text-red-600 font-semibold">
                    <div>{p.salaryAdvances > 0 ? `-${p.salaryAdvances}` : "0"}</div>
                    {advanceAdjs.length > 0 && (
                      <div className="mt-1 flex flex-col gap-1">
                        {advanceAdjs.map((adj) => (
                          <div
                            key={adj.id}
                            className="inline-flex items-center justify-between gap-1.5 px-2 py-0.5 rounded-lg bg-amber-50 border border-amber-200 text-[10px] text-amber-900"
                            title={adj.reason}
                          >
                            <span className="truncate max-w-[100px]">
                              💸 -{adj.amount}
                            </span>
                            <button
                              type="button"
                              onClick={() => void handleRemoveAdjustment(adj, workerName(w))}
                              title={t("شيل السلفة من البايرول", "Remove Advance")}
                              className="px-1.5 py-0.2 bg-red-600 hover:bg-red-700 text-white rounded text-[9px] font-bold cursor-pointer shrink-0"
                            >
                              {t("✕ شيل", "✕")}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="py-3 px-4 text-end font-bold font-code text-sm text-emerald-700">
                    EGP {p.netPayable}
                  </td>
                  <td className="py-3 px-3 text-center">
                    <div className="flex flex-wrap items-center justify-center gap-1">
                      <button
                        type="button"
                        onClick={() => openAdjustmentFor(w.id, "bonus")}
                        title={t("إضافة بونص / مكافأة لهذا الموظف", "Add Bonus for this Employee")}
                        className="px-2 py-1 bg-emerald-50 hover:bg-emerald-600 hover:text-white text-emerald-800 border border-emerald-200 rounded-lg text-[10px] font-semibold transition-all cursor-pointer"
                      >
                        {t("🎁 +بونص", "🎁 +Bonus")}
                      </button>
                      <button
                        type="button"
                        onClick={() => openAdjustmentFor(w.id, "deduction")}
                        title={t("إضافة خصم إداري على هذا الموظف", "Add Admin Deduction for this Employee")}
                        className="px-2 py-1 bg-red-50 hover:bg-red-600 hover:text-white text-red-800 border border-red-200 rounded-lg text-[10px] font-semibold transition-all cursor-pointer"
                      >
                        {t("⛔ +خصم", "⛔ +Deduct")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setOnboardModalWorker(w)}
                        title={t("ضبط تاريخ التعيين والراتب", "Set Joining Date & Rate")}
                        className="px-2 py-1 bg-zinc-100 hover:bg-zinc-900 hover:text-white border border-zinc-200 rounded-lg text-[10px] font-semibold transition-all cursor-pointer"
                      >
                        🗓️
                      </button>
                      <button
                        type="button"
                        onClick={() => setPayslipModalWorker(w)}
                        className="px-2.5 py-1 bg-zinc-900 hover:bg-red-600 text-white rounded-lg text-[10px] font-semibold transition-all cursor-pointer"
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
