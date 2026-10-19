"use client";

import ModalPortal from "@/components/admin/ui/ModalPortal";
import { type PayrollComputed, formatDepartment, formatEmploymentType } from "@/lib/admin/hrReports";
import { toast } from "@/lib/admin/feedback";
import { useHrLang } from "@/lib/admin/hrI18n";

interface WorkerLike {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  department?: string;
  role?: string;
  employmentType?: string;
  hourlyRate?: number;
}

interface Props {
  worker: WorkerLike;
  payroll: PayrollComputed;
  cycleLabel: string;
  periodStart: Date;
  periodEnd: Date;
  onClose: () => void;
}

export default function HrPayslipModal({
  worker,
  payroll,
  cycleLabel,
  periodStart,
  periodEnd,
  onClose,
}: Props) {
  const { isAr, dir, toggleLang, t } = useHrLang();
  const workerFullName = `${worker.firstName || ""} ${worker.lastName || ""}`.trim() || "Worker";

  const handlePrint = () => {
    window.print();
  };

  const handleCopySummary = () => {
    const text = isAr
      ? `
=== كشف راتب الموظف (MFT) ===
الموظف: ${workerFullName} (كود: ${worker.id})
القسم: ${formatDepartment(worker.department)} | الوظيفة: ${worker.role || "Operator"}
الفترة: ${cycleLabel} (${periodStart.toLocaleDateString()} - ${periodEnd.toLocaleDateString()})
أجر الساعة: ${payroll.hourlyRate} ج.م/ساعة
أيام الحضور: ${payroll.daysWorked} من أصل ${payroll.expectedWorkDays} يوم عمل مطلوب
إجمالي الساعات: ${payroll.totalHours} ساعة

المستحقات:
- الراتب الأساسي: ${payroll.basePay} ج.م
${
  payroll.policyApplied
    ? `- إضافي نهاري معتمد (${payroll.otDayHours}س × 1.35): +${payroll.otDayPay} ج.م\n- إضافي ليلي معتمد (${payroll.otNightHours}س × 1.70): +${payroll.otNightPay} ج.م\n${payroll.nightAllowance > 0 ? `- بدل وردية ليلية: +${payroll.nightAllowance} ج.م\n` : ""}`
    : `- ساعات إضافية: +${payroll.overtimePay} ج.م\n`
}${payroll.allowances > 0 ? `- بدلات ومصروفات معتمدة: +${payroll.allowances} ج.م\n` : ""}${payroll.manualBonuses > 0 ? `- مكافآت: +${payroll.manualBonuses} ج.م\n` : ""}
الاستقطاعات:
${payroll.absencePenalty > 0 ? `- خصم الغياب (${payroll.absentDays} يوم): -${payroll.absencePenalty} ج.م\n` : ""}${payroll.totalLatePenaltyEgp > 0 ? `- جزاءات التأخير غير المغطى: -${payroll.totalLatePenaltyEgp} ج.م\n` : ""}${payroll.shortfallDeduction > 0 ? `- انصراف مبكر بدون إذن (${payroll.shortfallMinutes} دقيقة): -${payroll.shortfallDeduction} ج.م\n` : ""}${payroll.salaryAdvances > 0 ? `- سلف مستردة: -${payroll.salaryAdvances} ج.م\n` : ""}${payroll.manualDeductions > 0 ? `- خصومات إدارية: -${payroll.manualDeductions} ج.م\n` : ""}${payroll.policyApplied ? `\nالأذونات الشهرية المستخدمة: ${payroll.permissionsUsed} أذونات / ${payroll.permissionMinutesUsed} دقيقة\n` : ""}
-----------------------------------------
صافي الراتب المستحق للصرف: ${payroll.netPayable} ج.م
=============================
      `.trim()
      : `
=== MFT WORKFORCE PAYSLIP ===
Employee: ${workerFullName} (ID: ${worker.id})
Department: ${formatDepartment(worker.department)} | Role: ${worker.role || "Operator"}
Period: ${cycleLabel} (${periodStart.toLocaleDateString()} - ${periodEnd.toLocaleDateString()})
Rate: EGP ${payroll.hourlyRate}/h
Days Worked: ${payroll.daysWorked} / ${payroll.expectedWorkDays} Expected Workdays
Total Hours: ${payroll.totalHours}h (Overtime: ${payroll.overtimeHours}h)

EARNINGS:
- Base Pay: EGP ${payroll.basePay}
${
  payroll.policyApplied
    ? `- Overtime Day (${payroll.otDayHours}h x1.35): EGP ${payroll.otDayPay}\n- Overtime Night (${payroll.otNightHours}h x1.70): EGP ${payroll.otNightPay}\n${payroll.nightAllowance > 0 ? `- Night Allowance: EGP ${payroll.nightAllowance}\n` : ""}${payroll.legacyOvertimePay > 0 ? `- Overtime (legacy 1.5x): EGP ${payroll.legacyOvertimePay}\n` : ""}`
    : `- Overtime Pay (1.5x): EGP ${payroll.overtimePay}\n`
}${payroll.allowances > 0 ? `- Allowances: EGP ${payroll.allowances}${payroll.reimbursements > 0 ? ` (incl. reimbursements EGP ${payroll.reimbursements})` : ""}\n` : ""}${payroll.manualBonuses > 0 ? `- Bonuses: EGP ${payroll.manualBonuses}\n` : ""}
DEDUCTIONS:
${payroll.absencePenalty > 0 ? `- Absence Penalty (${payroll.absentDays}d): -EGP ${payroll.absencePenalty}\n` : ""}${payroll.totalLatePenaltyEgp > 0 ? `- Lateness Penalties: -EGP ${payroll.totalLatePenaltyEgp}\n` : ""}${payroll.shortfallDeduction > 0 ? `- Early-leave Shortfall (${payroll.shortfallMinutes} min): -EGP ${payroll.shortfallDeduction}\n` : ""}${payroll.salaryAdvances > 0 ? `- Salary Advances: -EGP ${payroll.salaryAdvances}\n` : ""}${payroll.manualDeductions > 0 ? `- Disciplinary Deductions: -EGP ${payroll.manualDeductions}\n` : ""}${payroll.policyApplied ? `\nHR-POL-2026: permissions used ${payroll.permissionsUsed} / ${payroll.permissionMinutesUsed} min\n` : ""}
-----------------------------------------
NET PAYABLE DUE: EGP ${payroll.netPayable}
=============================
      `.trim();

    void navigator.clipboard.writeText(text);
    toast.success(t("تم نسخ ملخص كشف الراتب", "Payslip summary copied to clipboard"));
  };

  return (
    <ModalPortal onClose={onClose}>
      <div
        className="fixed inset-0 z-[120] bg-zinc-950/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 overflow-y-auto animate-fade-in print:p-0 print:bg-white"
        onClick={onClose}
      >
        <div
          dir={dir}
          className="bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-700 shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto p-6 md:p-8 animate-scale-in text-zinc-950 dark:text-zinc-100 font-mono rounded-lg print:border-none print:shadow-none print:max-w-none print:max-h-none print:p-8"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-3 pb-4 border-b-2 border-zinc-900 dark:border-zinc-700 mb-6">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 px-2 py-0.5 rounded">
                  {t("بيان راتب رسمي · HR-POL-2026", "OFFICIAL PAY STATEMENT")}
                </span>
              </div>
              <h3 className="text-2xl font-black font-heading tracking-wide text-zinc-950 dark:text-white mt-1">
                {t("كشف راتب ومستحقات الموظف", "Employee Compensation Payslip")}
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                {t("الدورة:", "Cycle:")} <strong>{cycleLabel}</strong> ({periodStart.toLocaleDateString()} – {periodEnd.toLocaleDateString()})
              </p>
            </div>
            <div className="flex items-center gap-2 print:hidden">
              <button
                type="button"
                onClick={toggleLang}
                className="px-2.5 py-1 border-2 border-zinc-900 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 text-xs font-bold rounded cursor-pointer hover:bg-red-600 hover:text-white"
              >
                {isAr ? "English" : "العربية"}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="text-zinc-400 hover:text-zinc-950 dark:hover:text-white text-2xl font-bold leading-none p-1 cursor-pointer"
              >
                &times;
              </button>
            </div>
          </div>

          {/* Worker Identity Card */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-300 dark:border-zinc-700 rounded-lg text-xs mb-6">
            <div>
              <span className="text-zinc-500 dark:text-zinc-400 block text-[10px] uppercase font-bold">
                {t("الموظف", "Employee")}
              </span>
              <strong className="text-zinc-900 dark:text-white text-sm block mt-0.5">
                {workerFullName}
              </strong>
              <span className="text-[10px] text-zinc-400">ID: {worker.id}</span>
            </div>

            <div>
              <span className="text-zinc-500 dark:text-zinc-400 block text-[10px] uppercase font-bold">
                {t("القسم والوظيفة", "Department & Role")}
              </span>
              <strong className="text-zinc-900 dark:text-white block mt-0.5">
                {formatDepartment(worker.department)}
              </strong>
              <span className="text-[11px] text-zinc-600 dark:text-zinc-300">{worker.role || "Operator"}</span>
            </div>

            <div>
              <span className="text-zinc-500 dark:text-zinc-400 block text-[10px] uppercase font-bold">
                {t("أجر الساعة", "Hourly Rate")}
              </span>
              <strong className="text-emerald-700 dark:text-emerald-400 text-sm block mt-0.5">
                {payroll.hourlyRate} {t("ج.م / س", "EGP / hr")}
              </strong>
              <span className="text-[10px] text-zinc-400">{formatEmploymentType(worker.employmentType)}</span>
            </div>

            <div>
              <span className="text-zinc-500 dark:text-zinc-400 block text-[10px] uppercase font-bold">
                {t("أيام العمل", "Attendance Ratio")}
              </span>
              <strong className="text-zinc-900 dark:text-white block mt-0.5">
                {payroll.daysWorked} / {payroll.expectedWorkDays} {t("يوم", "days")}
              </strong>
              <span className="text-[10px] text-zinc-500">
                {payroll.expectedWorkDays > 0 ? Math.round((payroll.daysWorked / payroll.expectedWorkDays) * 100) : 0}%{" "}
                {t("التزام بالحضور", "attendance")}
              </span>
            </div>
          </div>

          {/* Breakdown Section */}
          <div className="space-y-4 text-xs">
            {/* 1. Earnings */}
            <div className="border border-zinc-300 dark:border-zinc-700 rounded-lg overflow-hidden">
              <div className="bg-zinc-100 dark:bg-zinc-800 px-4 py-2 border-b border-zinc-300 dark:border-zinc-700 font-bold tracking-wider text-zinc-900 dark:text-white flex items-center justify-between">
                <span>{t("١. إجمالي المستحقات (Gross Earnings)", "1. Gross Earnings (المستحقات)")}</span>
                <span className="text-emerald-700 dark:text-emerald-400">
                  +EGP {payroll.basePay + payroll.overtimePay + payroll.allowances + payroll.manualBonuses}
                </span>
              </div>
              <div className="divide-y divide-zinc-200 dark:divide-zinc-800 p-2 text-zinc-800 dark:text-zinc-200">
                <div className="flex justify-between py-1.5 px-2">
                  <span>
                    {t(
                      `ساعات العمل الأساسية (${payroll.totalHours} ساعة × ${payroll.hourlyRate} ج.م)`,
                      `Regular Base Hours (${payroll.totalHours} hrs @ EGP ${payroll.hourlyRate}/h)`,
                    )}
                  </span>
                  <span className="font-bold">EGP {Math.max(0, payroll.basePay - (payroll.paidLeavePay || 0))}</span>
                </div>
                {payroll.paidLeaveDays > 0 && (
                  <div className="flex justify-between py-1.5 px-2 text-emerald-800 dark:text-emerald-300">
                    <span>
                      {t(
                        `🌴 إجازات مدفوعة الأجر معتمدة (${payroll.paidLeaveDays} يوم)`,
                        `🌴 Approved Paid Leave (${payroll.paidLeaveDays} day(s))`,
                      )}
                    </span>
                    <span className="font-bold">+EGP {payroll.paidLeavePay}</span>
                  </div>
                )}
                {payroll.unpaidLeaveDays > 0 && (
                  <div className="flex justify-between py-1.5 px-2 text-teal-800 dark:text-teal-300">
                    <span>
                      {t(
                        `📅 إجازة بدون مرتب معتمدة (${payroll.unpaidLeaveDays} يوم — معفاة من جزاء الغياب 2x)`,
                        `📅 Approved Unpaid Leave (${payroll.unpaidLeaveDays} day(s) — exempted from 2x penalty)`,
                      )}
                    </span>
                    <span className="font-bold">EGP 0</span>
                  </div>
                )}
                {payroll.policyApplied ? (
                  <>
                    <div className="flex justify-between py-1.5 px-2">
                      <span>
                        {t(
                          `☀️ عمل إضافي نهاري معتمد 06:00–18:00 (${payroll.otDayHours} ساعة × 1.35)`,
                          `☀️ Approved Overtime · Day 06:00–18:00 (${payroll.otDayHours} hrs @ 1.35x)`,
                        )}
                      </span>
                      <span className="font-bold text-emerald-700 dark:text-emerald-400">+EGP {payroll.otDayPay}</span>
                    </div>
                    <div className="flex justify-between py-1.5 px-2">
                      <span>
                        {t(
                          `🌙 عمل إضافي ليلي معتمد 18:00–06:00 (${payroll.otNightHours} ساعة × 1.70)`,
                          `🌙 Approved Overtime · Night 18:00–06:00 (${payroll.otNightHours} hrs @ 1.70x)`,
                        )}
                      </span>
                      <span className="font-bold text-emerald-700 dark:text-emerald-400">+EGP {payroll.otNightPay}</span>
                    </div>
                    {payroll.nightAllowance > 0 && (
                      <div className="flex justify-between py-1.5 px-2">
                        <span>{t("بدل وردية ليلية", "Night Shift Allowance")}</span>
                        <span className="font-bold text-emerald-700 dark:text-emerald-400">+EGP {payroll.nightAllowance}</span>
                      </div>
                    )}
                    {payroll.legacyOvertimePay > 0 && (
                      <div className="flex justify-between py-1.5 px-2">
                        <span>{t("إضافي قبل تاريخ سريان اللائحة (1.5x)", "Overtime before policy effective date (1.5x)")}</span>
                        <span className="font-bold text-emerald-700 dark:text-emerald-400">+EGP {payroll.legacyOvertimePay}</span>
                      </div>
                    )}
                    {payroll.unapprovedOtMinutes > 0 && (
                      <div className="flex justify-between py-1.5 px-2 text-zinc-500 italic">
                        <span>
                          {t(
                            `وقت إضافي بدون تكليف مسبق (${payroll.unapprovedOtMinutes} دقيقة) — غير مستحق للصرف`,
                            `Extra time without prior assignment (${payroll.unapprovedOtMinutes} min) — not payable`,
                          )}
                        </span>
                        <span>EGP 0</span>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex justify-between py-1.5 px-2">
                    <span>
                      {t(
                        `أجر الساعات الإضافية (${payroll.overtimeHours} ساعة × 1.5)`,
                        `Overtime Pay (${payroll.overtimeHours} hrs @ 1.5x multiplier)`,
                      )}
                    </span>
                    <span className="font-bold text-emerald-700 dark:text-emerald-400">
                      +EGP {payroll.overtimePay}
                    </span>
                  </div>
                )}
                {payroll.allowances > 0 && (
                  <div className="flex justify-between py-1.5 px-2 bg-emerald-50/50 dark:bg-emerald-950/20">
                    <span>
                      {t("البدلات والمصروفات المعتمدة (مأموريات / مشتريات)", "Allowances & Approved Reimbursements")}
                      {payroll.reimbursements > 0 && ` (${t("منها مصروفات:", "reimb:")} EGP ${payroll.reimbursements})`}
                    </span>
                    <span className="font-bold text-emerald-700 dark:text-emerald-400">
                      +EGP {payroll.allowances}
                    </span>
                  </div>
                )}
                {payroll.manualBonuses > 0 && (
                  <div className="flex justify-between py-1.5 px-2 bg-emerald-50/50 dark:bg-emerald-950/20">
                    <span>{t("مكافآت الأداء والتميز", "Performance & Exceptional Bonuses")}</span>
                    <span className="font-bold text-emerald-700 dark:text-emerald-400">
                      +EGP {payroll.manualBonuses}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* 2. Deductions */}
            <div className="border border-zinc-300 dark:border-zinc-700 rounded-lg overflow-hidden">
              <div className="bg-zinc-100 dark:bg-zinc-800 px-4 py-2 border-b border-zinc-300 dark:border-zinc-700 font-bold tracking-wider text-zinc-900 dark:text-white flex items-center justify-between">
                <span>{t("٢. الاستقطاعات والسلف (Deductions & Advances)", "2. Deductions & Advances (الاستقطاعات والسلف)")}</span>
                <span className="text-red-600 dark:text-red-400">
                  -EGP {payroll.absencePenalty + payroll.totalLatePenaltyEgp + payroll.shortfallDeduction + payroll.salaryAdvances + payroll.manualDeductions}
                </span>
              </div>
              <div className="divide-y divide-zinc-200 dark:divide-zinc-800 p-2 text-zinc-800 dark:text-zinc-200">
                {payroll.absencePenalty > 0 ? (
                  <div className="flex justify-between py-1.5 px-2 text-red-700 dark:text-red-400">
                    <span>
                      {t(
                        `خصم الغياب بدون إذن (${payroll.absentDays} يوم)`,
                        `Absence Deductions (${payroll.absentDays} unexcused day(s))`,
                      )}
                    </span>
                    <span className="font-bold">-EGP {payroll.absencePenalty}</span>
                  </div>
                ) : (
                  <div className="flex justify-between py-1.5 px-2 text-zinc-500 italic">
                    <span>{t("خصم الغياب (لا يوجد غياب غير مبرر)", "Absence Deductions (No unexcused absences)")}</span>
                    <span>EGP 0</span>
                  </div>
                )}

                {payroll.totalLatePenaltyEgp > 0 ? (
                  <div className="flex justify-between py-1.5 px-2 text-amber-700 dark:text-amber-400">
                    <span>
                      {payroll.policyApplied
                        ? t(
                            `تأخير غير مغطى برصيد الأذونات (${payroll.lateDays} × ربع يوم، ${payroll.veryLateDays} × نصف يوم)`,
                            `Uncovered Lateness — quota exhausted (${payroll.lateDays} × ¼ day, ${payroll.veryLateDays} × ½ day)`,
                          )
                        : t(
                            `جزاءات التأخير (${payroll.lateDays} تأخير، ${payroll.veryLateDays} تأخير شديد)`,
                            `Late Check-in Penalties (${payroll.lateDays} late, ${payroll.veryLateDays} very late)`,
                          )}
                    </span>
                    <span className="font-bold">-EGP {payroll.totalLatePenaltyEgp}</span>
                  </div>
                ) : (
                  <div className="flex justify-between py-1.5 px-2 text-zinc-500 italic">
                    <span>{t("جزاءات التأخير", "Late Check-in Penalties")}</span>
                    <span>EGP 0</span>
                  </div>
                )}

                {payroll.policyApplied && (
                  <div className="flex justify-between py-1.5 px-2 text-zinc-600 dark:text-zinc-400">
                    <span>
                      {t(
                        `الأذونات الشهرية المستخدمة: ${payroll.permissionsUsed} / 4 أذونات · ${payroll.permissionMinutesUsed} / 240 دقيقة (غطت ${payroll.coveredLateCount} تأخير)`,
                        `Monthly permissions used: ${payroll.permissionsUsed} / 4 · ${payroll.permissionMinutesUsed} / 240 min (${payroll.coveredLateCount} late arrival(s) covered)`,
                      )}
                    </span>
                    <span>EGP 0</span>
                  </div>
                )}

                {payroll.shortfallMinutes > 0 && (
                  <div className="flex justify-between py-1.5 px-2 text-zinc-600 dark:text-zinc-400">
                    <span>
                      {t(
                        `انصراف مبكر بدون إذن: ${payroll.shortfallMinutes} دقيقة غير مدفوعة (غير محسوبة في الأجر الأساسي)`,
                        `Early leave without permission: ${payroll.shortfallMinutes} min unpaid (already excluded from base pay)`,
                      )}
                    </span>
                    <span>EGP 0</span>
                  </div>
                )}

                {payroll.salaryAdvances > 0 && (
                  <div className="flex justify-between py-1.5 px-2 bg-red-50/50 dark:bg-red-950/20 text-red-700 dark:text-red-400 font-semibold">
                    <span>{t("سلف نقدية مستردة خلال الشهر", "Mid-month Cash Advances Recovered (سلف)")}</span>
                    <span className="font-bold">-EGP {payroll.salaryAdvances}</span>
                  </div>
                )}

                {payroll.manualDeductions > 0 && (
                  <div className="flex justify-between py-1.5 px-2 text-red-700 dark:text-red-400">
                    <span>{t("خصومات وجزاءات إدارية", "Disciplinary Deductions")}</span>
                    <span className="font-bold">-EGP {payroll.manualDeductions}</span>
                  </div>
                )}
              </div>
            </div>

            {/* 3. Net Payable Summary Banner */}
            <div className="p-4 bg-emerald-50 dark:bg-emerald-950/50 border-2 border-emerald-600 rounded-lg flex flex-col sm:flex-row items-center justify-between gap-3 shadow-[3px_3px_0px_0px_#059669]">
              <div>
                <span className="text-xs uppercase font-bold text-emerald-800 dark:text-emerald-300 tracking-wider">
                  {t("صافي الراتب المستحق للصرف (Net Payable)", "Net Amount Payable (صافي المستحق للصرف)")}
                </span>
                <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5">
                  {t(
                    "المبلغ النهائي المعتمد للتحويل البنكي أو الصرف النقدي.",
                    "Authorized for disbursement via bank transfer / cash envelope.",
                  )}
                </p>
              </div>
              <div className="text-end">
                <span className="text-3xl font-black font-heading text-emerald-800 dark:text-emerald-300">
                  EGP {payroll.netPayable}
                </span>
              </div>
            </div>
          </div>

          {/* Footer & Actions */}
          <div className="mt-8 pt-4 border-t-2 border-zinc-900 dark:border-zinc-700 flex flex-wrap items-center justify-between gap-3 print:hidden">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleCopySummary}
                className="px-3.5 py-2 border-2 border-zinc-900 dark:border-zinc-700 bg-white dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-950 dark:text-zinc-100 font-mono text-xs font-bold uppercase tracking-wider cursor-pointer rounded"
              >
                {t("📋 نسخ الملخص", "📋 Copy Summary")}
              </button>
              <button
                type="button"
                onClick={handlePrint}
                className="px-3.5 py-2 border-2 border-zinc-900 dark:border-zinc-700 bg-white dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-950 dark:text-zinc-100 font-mono text-xs font-bold uppercase tracking-wider cursor-pointer rounded"
              >
                {t("🖨️ طباعة كشف الراتب", "🖨️ Print Payslip")}
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 bg-zinc-900 hover:bg-zinc-800 text-white font-mono text-xs font-bold uppercase tracking-wider border-2 border-zinc-900 cursor-pointer rounded"
            >
              {t("إغلاق", "Close")}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
