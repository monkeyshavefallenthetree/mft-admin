"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import {
  collection,
  onSnapshot,
  addDoc,
  deleteDoc,
  doc,
  serverTimestamp,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { downloadCsv } from "@/lib/admin/csv";
import { DEPARTMENTS } from "@/lib/admin/constants";
import { sessionHours } from "@/lib/admin/workTime";
import {
  type SessionForHr,
  type HrSettings,
  type HolidayItem,
  type PayrollAdjustment,
  DEFAULT_HR_SETTINGS,
  computeDailyOfficePin,
  computePayrollForWorker,
  formatDepartment,
  formatEmploymentType,
  getPayrollCycleRange,
  getHrDateRange,
  isDateHoliday,
  isLateTodayHtml,
  performanceRating,
  productivityScore,
  sessionDateYmd,
  workerSessionsInRange,
} from "@/lib/admin/hrReports";
import {
  subscribeHrSettings,
  subscribeHolidays,
  subscribePayrollAdjustments,
  deletePayrollAdjustment,
  subscribePayrollCycles,
  setPayrollCycleStatus,
  subscribePermissionLedger,
  subscribeApprovedPolicyRequests,
  mergeLedgerWithApprovedRequests,
  subscribeReimbursements,
  type PayrollCycleRecord,
  type PermissionLedgerDoc,
  type ApprovedRequestRow,
  type ReimbursementDoc,
} from "@/lib/admin/hrSettings";
import { effectiveLeaveDaysForRequest, ymd as localYmd } from "@/lib/admin/hrPolicy2026";
import { useHrLang } from "@/lib/admin/hrI18n";
import Link from "next/link";
import { toast, confirmDialog } from "@/lib/admin/feedback";
import { logActivity } from "@/lib/admin/activity";
import { sendExpoPushToWorkers } from "@/lib/chatNotifications";
import { notifyAdmins } from "@/lib/adminNotifications";
import { useUrlState } from "@/lib/admin/useUrlState";
import ModalPortal from "@/components/admin/ui/ModalPortal";
import HrPolicyModal from "@/components/admin/hr/HrPolicyModal";
import HrHolidaysManager from "@/components/admin/hr/HrHolidaysManager";
import HrPayslipModal from "@/components/admin/hr/HrPayslipModal";
import HrAdjustmentModal, { type AdjustmentKind } from "@/components/admin/hr/HrAdjustmentModal";
import HrDateRangeSelector from "@/components/admin/hr/HrDateRangeSelector";
import HrExcuseModal from "@/components/admin/hr/HrExcuseModal";
import HrComplianceView from "@/components/admin/hr/HrComplianceView";
import WorkerLeaveProfileCard from "@/components/admin/hr/WorkerLeaveProfileCard";
import HrDisciplinaryCatalog from "@/components/admin/hr/HrDisciplinaryCatalog";
import { DISCIPLINARY_RULES } from "@/lib/admin/hrDisciplinary";
import TodayTab, { type TodayFilter } from "@/components/admin/hr/tabs/TodayTab";
import PayrollTab from "@/components/admin/hr/tabs/PayrollTab";
import TeamTab from "@/components/admin/hr/tabs/TeamTab";
import AlertsTab from "@/components/admin/hr/tabs/AlertsTab";
import SendAlertModal from "@/components/admin/hr/SendAlertModal";
import WorkerOnboardModal from "@/components/admin/hr/WorkerOnboardModal";
import Worker360Modal from "@/components/admin/hr/Worker360Modal";
import { useHrData } from "@/lib/admin/useHrData";
import type { Worker } from "@/lib/admin/hrPageTypes";
import { SvgI, workerName } from "@/components/admin/hr/hrPageUtils";

const HR_NAV_TABS = [
  {
    key: "overview",
    ar: "حضور اليوم",
    en: "Today's Attendance",
    icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
  },
  {
    key: "compliance",
    ar: "التعيين والأذونات والإجازات",
    en: "Joining, Permissions & Leave",
    icon: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z",
  },
  {
    key: "payroll",
    ar: "الرواتب وكشوف المرتبات",
    en: "Payroll & Payslips",
    icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  },
  {
    key: "disciplinary",
    ar: "لائحة الجزاءات والمخالفات",
    en: "Disciplinary & Penalties",
    icon: "M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3",
  },
  {
    key: "holidays",
    ar: "العطلات الرسمية واللائحة",
    en: "Holidays & Policy",
    icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
  },
  {
    key: "team",
    ar: "تقييم أداء الفريق",
    en: "Team Performance",
    icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z",
  },
  {
    key: "alerts",
    ar: "التنبيهات والتعاميم",
    en: "Alerts & Notices",
    icon: "M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9",
  },
];

export default function AdminHRPage() {
  const { isAr, dir, toggleLang, t } = useHrLang();

  const [refreshTick, setRefreshTick] = useState(0);

  // Modals
  const [sendOpen, setSendOpen] = useState(false);

  const [policyModalOpen, setPolicyModalOpen] = useState(false);

  const [adjustmentModalOpen, setAdjustmentModalOpen] = useState(false);

  const [adjustmentWorkerId, setAdjustmentWorkerId] = useState<string | undefined>(undefined);

  const [adjustmentInitialType, setAdjustmentInitialType] = useState<AdjustmentKind>("bonus");

  const [excuseModalWorker, setExcuseModalWorker] = useState<Worker | null>(null);

  const [payslipModalWorker, setPayslipModalWorker] = useState<Worker | null>(null);

  const [dashboardWorker, setDashboardWorker] = useState<Worker | null>(null);

  const [onboardModalWorker, setOnboardModalWorker] = useState<Worker | null>(null);

  const openAdjustmentFor = (workerId?: string, kind: AdjustmentKind = "bonus") => {
    setAdjustmentWorkerId(workerId);
    setAdjustmentInitialType(kind);
    setAdjustmentModalOpen(true);
  };

  // Navigation & Search State
  const [section, setSection] = useUrlState("tab", "overview");

  const [todayFilter, setTodayFilter] = useState<"all" | "present" | "absent" | "late" | "overtime">("all");

  // Date Range and Cycle Selection State
  const [rangeKey, setRangeKey] = useState<string>("cycle");

  const [customStart, setCustomStart] = useState<Date>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d;
  });

  const [customEnd, setCustomEnd] = useState<Date>(() => new Date());

  const {
    adminEmail,
    workers,
    sessions,
    tasks,
    alerts,
    settings,
    holidays,
    adjustments,
    cycleRecords,
    ledger,
    approvedRequests,
    reimbursements,
    effectiveLedger,
    approved,
    today,
    activeCycle,
    activePeriod,
    currentCycleId,
    currentCycleStatus,
    todayHoliday,
    todaysSessions,
    presentWorkerIds,
    lateWorkerIds,
    overtimeWorkerIds,
    hrSummary,
    workerTaskStats,
    policyInputsFor,
    payrollTableData,
    payrollTotals,
    missingHireCount,
    pendingExpensesCount,
  } = useHrData({ refreshTick, rangeKey, customStart, customEnd });

  const handleRemoveAdjustment = async (adj: PayrollAdjustment, workerDisplayName?: string) => {
    if (!adj.id) return;
    const typeAr =
      adj.type === "bonus"
        ? "البونص / المكافأة"
        : adj.type === "deduction"
          ? "الخصم الإداري"
          : adj.type === "allowance"
            ? "البدل"
            : "السلفة";
    const ok = await confirmDialog({
      title: t(`حذف ${typeAr} (${adj.amount} ج.م)؟`, `Remove ${adj.type} (EGP ${adj.amount})?`),
      message: t(
        `هل تريد إزالة ${typeAr} بقيمة ${adj.amount} ج.م (${adj.reason || "—"}) من شيت الرواتب فوراً؟`,
        `Remove this ${adj.type} of EGP ${adj.amount} ("${adj.reason || "—"}") from the Payroll Sheet immediately?`,
      ),
      confirmLabel: t("شيل من شيت الرواتب 🗑️", "Remove from Payroll 🗑️"),
      tone: "danger",
    });
    if (!ok) return;
    try {
      await deletePayrollAdjustment(adj.id);
      if (adj.workerId) {
        void sendExpoPushToWorkers(db, {
          recipientUids: [adj.workerId],
          title: `↩ تم إلغاء ${typeAr}`,
          body: `تم إزالة ${typeAr} بقيمة ${adj.amount} ج.م من شيت الرواتب.`,
          tab: "profile",
        }).catch(() => {});
      }
      void logActivity({
        action: "deleted",
        entity: "hr",
        entityId: adj.id,
        label: `Removed ${adj.type} (EGP ${adj.amount}) for ${workerDisplayName || adj.workerName || adj.workerId}`,
        detail: adj.reason,
      });
      toast.success(
        t(
          `تم حذف ${typeAr} (${adj.amount} ج.م) وتحديث شيت الرواتب فوراً`,
          `Removed ${adj.type} (EGP ${adj.amount}) & updated Payroll Sheet`,
        ),
      );
    } catch (err) {
      toast.error(t("تعذر حذف البند", "Failed to remove adjustment"), {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const exportPayrollCsv = () => {
    const headers = [
      "Employee Name",
      "Employee ID",
      "Department",
      "Role",
      "Company Join Date",
      "Days Worked",
      "Expected Days",
      "Total Hours",
      "Hourly Rate (EGP)",
      "Base Pay (EGP)",
      "Overtime Pay (EGP)",
      "Bonuses / مكافآت (EGP)",
      "Allowances / بدلات ومصروفات (EGP)",
      "Admin Deductions / خصومات إدارية (EGP)",
      "Absence Deductions (EGP)",
      "Late Penalties (EGP)",
      "Salary Advances / سلف (EGP)",
      "Adjustments Details / تفاصيل البونص والخصومات",
      "Net Payable / صافي المستحق (EGP)",
    ];

    const rows: (string | number)[][] = [headers];

    for (const row of payrollTableData) {
      const adjSummary = row.adjustments
        .filter((a) => a.status !== "cancelled")
        .map((a) => {
          const sign = a.type === "bonus" || a.type === "allowance" ? "+" : "-";
          return `[${a.type.toUpperCase()} ${sign}${a.amount} EGP: ${a.reason || ""}]`;
        })
        .join(" | ");

      rows.push([
        workerName(row.worker),
        row.worker.id,
        formatDepartment(row.worker.department),
        row.worker.role || "Operator",
        row.worker.hireDate || "Not Set",
        row.payroll.daysWorked,
        row.payroll.expectedWorkDays,
        row.payroll.totalHours,
        row.payroll.hourlyRate,
        row.payroll.basePay,
        row.payroll.overtimePay,
        row.payroll.manualBonuses,
        row.payroll.allowances,
        row.payroll.manualDeductions,
        row.payroll.absencePenalty,
        row.payroll.totalLatePenaltyEgp,
        row.payroll.salaryAdvances,
        adjSummary,
        row.payroll.netPayable,
      ]);
    }

    const s = activePeriod.start.toISOString().split("T")[0];
    const e = activePeriod.end.toISOString().split("T")[0];
    downloadCsv(rows, `payroll_${s}_to_${e}.csv`);
    toast.success(t("تم تحميل شيت الرواتب بصيغة CSV شاملاً البونص والخصومات", "Payroll sheet CSV downloaded (with Bonuses & Deductions)"));
  };

  const handleToggleCycleStatus = async (nextStatus: "draft" | "approved" | "paid") => {
    const confirmMessages = {
      approved: t(
        "اعتماد دورة الرواتب الحالية؟ يؤكد ذلك مراجعة الساعات والأذونات والخصومات.",
        "Approve this payroll cycle? This confirms that hours and penalties have been reviewed.",
      ),
      paid: t(
        "تأكيد صرف الرواتب (تم الصرف)؟ سيتم قفل الدورة كمدفوعة.",
        "Mark this payroll as PAID (تم الصرف)? This locks the cycle as disbursed.",
      ),
      draft: t(
        "إعادة دورة الرواتب إلى وضع المسودة (قيد المراجعة)؟",
        "Revert payroll back to Draft review mode?",
      ),
    };

    const ok = await confirmDialog({
      title: t(`تأكيد حالة الرواتب: ${nextStatus.toUpperCase()}`, `Confirm Payroll Status: ${nextStatus.toUpperCase()}`),
      message: confirmMessages[nextStatus],
      confirmLabel: t("تأكيد", `Mark as ${nextStatus.toUpperCase()}`),
    });
    if (!ok) return;

    try {
      const updateData: Partial<PayrollCycleRecord> = {
        cycleLabel: activePeriod.label,
        periodStart: activePeriod.start.toISOString().split("T")[0],
        periodEnd: activePeriod.end.toISOString().split("T")[0],
        status: nextStatus,
        totalGrossPay: payrollTotals.gross,
        totalNetPay: payrollTotals.net,
        totalWorkers: approved.length,
      };

      if (nextStatus === "approved") {
        updateData.approvedAt = { toDate: () => new Date() };
        updateData.approvedBy = adminEmail;
      } else if (nextStatus === "paid") {
        updateData.paidAt = { toDate: () => new Date() };
        updateData.paidBy = adminEmail;
      }

      await setPayrollCycleStatus(currentCycleId, updateData, adminEmail);
      void notifyAdmins(db, {
        targetRoles: ["super_admin", "hr_admin"],
        category: "hr",
        eventType: `payroll_cycle_${nextStatus}`,
        title: `💳 Payroll Cycle ${nextStatus.toUpperCase()}: ${activePeriod.label}`,
        body: `${adminEmail} marked payroll cycle (${activePeriod.label}) as ${nextStatus.toUpperCase()} — Net EGP ${payrollTotals.net}.`,
        href: "/admin/hr?tab=payroll",
        actorUid: auth.currentUser?.uid,
        actorName: adminEmail,
      });
      if (nextStatus === "paid" && approved.length > 0) {
        void sendExpoPushToWorkers(db, {
          recipientUids: approved.map((w) => w.id),
          title: "💳 Monthly Payroll Disbursed",
          body: `Payroll for cycle ${activePeriod.label} has been marked as PAID.`,
          tab: "profile",
        }).catch(() => {});
      }
      toast.success(t("تم تحديث حالة دورة الرواتب", `Payroll cycle marked as ${nextStatus.toUpperCase()}`));
    } catch (err) {
      toast.error(t("فشل تحديث حالة الدورة", "Failed to update cycle status"), {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <div dir={dir} className="space-y-5">
      {/* ── Top Command Center Header (Clean 2-Row Studio Architecture) ── */}
      <div className="ui-card overflow-hidden">
        {/* Row 1: Identity & System/Gate Controls */}
        <div className="flex flex-col gap-4 border-b border-zinc-100 p-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-0.5 font-code text-[10px] font-semibold uppercase tracking-wider text-red-600">
                <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                {t("إدارة الموارد البشرية والرواتب · HR-POL-2026", "HR OPERATIONS & PAYROLL · HR-POL-2026")}
              </span>
              <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-0.5 font-code text-[11px] font-semibold text-zinc-700">
                {t(`دورة الرواتب: ${activePeriod.label}`, `Cycle: ${activePeriod.label}`)}
              </span>
            </div>
            <h2 className="mt-1.5 text-2xl font-bold tracking-tight text-zinc-900">
              {t("إدارة الموارد البشرية والرواتب والجزاءات", "HR Operations, Payroll & Disciplinary Center")}
            </h2>
            <p className="mt-1 text-xs sm:text-sm text-zinc-500">
              {t(
                "متابعة الحضور اليومي، تواريخ التعيين، الأذونات والإجازات، لائحة الجزاءات الرسمية، وكشوف الرواتب.",
                "Daily attendance, joining dates, permissions & leave, official disciplinary schedule, and automated payroll.",
              )}
            </p>
          </div>

          {/* System & Office Gate Controls */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              id="hr-lang-toggle"
              onClick={toggleLang}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50/70 px-3 py-2 text-xs font-semibold text-red-700 transition-colors hover:bg-red-600 hover:text-white cursor-pointer"
            >
              <SvgI d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" className="h-3.5 w-3.5" />
              <span>{isAr ? "English (EN)" : "العربية (AR)"}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                const pin = computeDailyOfficePin(settings);
                navigator.clipboard?.writeText(pin);
                toast.success(
                  t(`تم نسخ كود حضور المكتب اليوم (${pin}) ✓`, `Copied Today's Office PIN (${pin}) ✓`),
                  {
                    description: t(
                      "يستخدمه الموظفون داخل الشركة على الأجهزة لبدء الشيفت فوراً.",
                      "Used by workers inside the office to start their shift immediately.",
                    ),
                  },
                );
              }}
              title={t("اضغط لنسخ كود حضور المكتب اليومي", "Click to copy today's Office PIN")}
              className="inline-flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50/70 px-3 py-2 text-xs font-semibold text-indigo-900 transition-colors hover:bg-indigo-100 cursor-pointer"
            >
              <SvgI d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" className="h-3.5 w-3.5 text-indigo-600" />
              <span>{t("كود المكتب:", "Office PIN:")}</span>
              <strong className="rounded border border-indigo-200 bg-white px-1.5 py-0.5 font-code text-xs tracking-widest text-indigo-950" dir="ltr">
                {computeDailyOfficePin(settings)}
              </strong>
            </button>

            <button
              type="button"
              onClick={() => setPolicyModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50/70 px-3 py-2 text-xs font-semibold text-sky-900 transition-colors hover:bg-sky-100 cursor-pointer"
            >
              <SvgI d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5" className="h-3.5 w-3.5 text-sky-600" />
              <span>
                {t(
                  `شبكات الحضور (${(settings.officeNetworks ?? []).filter((n) => n.active !== false).length})`,
                  `Office Gate & IP (${(settings.officeNetworks ?? []).filter((n) => n.active !== false).length})`,
                )}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setPolicyModalOpen(true)}
              className="brutal-btn-outline"
            >
              <SvgI d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" className="h-3.5 w-3.5" />
              <span>{t(`إعدادات اللائحة (يوم ${settings.monthStartDay})`, `Policies (Day ${settings.monthStartDay})`)}</span>
            </button>

            <Link
              href="/admin/hr/policy-lab"
              id="hr-open-policy-lab"
              className="brutal-btn"
            >
              <SvgI d="M9 3v6.5L4.2 18.1A2 2 0 006 21h12a2 2 0 001.8-2.9L15 9.5V3M8 3h8M7 15h10" className="h-3.5 w-3.5" />
              <span>{t("مختبر اللائحة", "Policy Lab")}</span>
            </Link>

            <button
              type="button"
              onClick={() => {
                setRefreshTick((n) => n + 1);
                toast.info(t("تم تحديث البيانات الحية", "Refreshed live data"));
              }}
              title={t("تحديث البيانات", "Refresh Data")}
              className="brutal-btn-outline px-2.5"
            >
              <SvgI d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Row 2: Daily HR Quick-Action Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 bg-zinc-50/80 px-5 py-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            {t("إجراءات الموارد البشرية السريعة", "Quick Daily HR Actions")}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setSection("disciplinary")}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                section === "disciplinary"
                  ? "border-red-600 bg-red-600 text-white"
                  : "border-red-200 bg-red-50/80 text-red-800 hover:bg-red-600 hover:text-white"
              }`}
            >
              <SvgI d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" className="h-3.5 w-3.5" />
              <span>{t(`لائحة الجزاءات (${DISCIPLINARY_RULES.length} بند)`, `Disciplinary Schedule (${DISCIPLINARY_RULES.length})`)}</span>
            </button>

            <button
              type="button"
              onClick={() => openAdjustmentFor(undefined, "bonus")}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50/80 px-3 py-1.5 text-xs font-semibold text-emerald-800 transition-colors hover:bg-emerald-600 hover:text-white cursor-pointer"
            >
              <SvgI d="M12 4v16m8-8H4" className="h-3.5 w-3.5" />
              <span>{t("بونص / مكافأة", "Add Bonus")}</span>
            </button>

            <button
              type="button"
              onClick={() => openAdjustmentFor(undefined, "deduction")}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50/80 px-3 py-1.5 text-xs font-semibold text-red-800 transition-colors hover:bg-red-600 hover:text-white cursor-pointer"
            >
              <SvgI d="M20 12H4" className="h-3.5 w-3.5" />
              <span>{t("خصم / سلفة", "Deduction / Advance")}</span>
            </button>

            <button
              type="button"
              onClick={() => setSendOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900 transition-colors hover:bg-amber-100 cursor-pointer"
            >
              <SvgI d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" className="h-3.5 w-3.5 text-amber-600" />
              <span>{t("إرسال تعميم للكل", "Broadcast Alert")}</span>
            </button>

            <Link
              href="/admin/reimbursements"
              className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50/80 px-3 py-1.5 text-xs font-semibold text-violet-800 transition-colors hover:bg-violet-100"
            >
              <SvgI d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" className="h-3.5 w-3.5" />
              <span>{t(`المصروفات والمأموريات (${pendingExpensesCount})`, `Expenses (${pendingExpensesCount})`)}</span>
            </Link>

            <button
              type="button"
              onClick={exportPayrollCsv}
              className="brutal-btn-outline py-1.5"
            >
              <SvgI d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" className="h-3.5 w-3.5" />
              <span>{t("تصدير شيت الرواتب CSV", "Export Payroll CSV")}</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── Guided 5-Step Quick Workflow Cards (Easy HR Navigation) ── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {[
          {
            key: "overview",
            step: isAr ? "الخطوة 1" : "STEP 1",
            title: t("حضور اليوم والوردية", "Today's Attendance"),
            sub: t(
              `${hrSummary.presentToday} حاضر · ${hrSummary.lateToday} متأخر · ${hrSummary.absentToday} غائب`,
              `${hrSummary.presentToday} present · ${hrSummary.lateToday} late · ${hrSummary.absentToday} absent`,
            ),
            action: t("متابعة الحضور والأعذار", "Monitor & Excuse"),
            accent: "bg-emerald-500",
          },
          {
            key: "compliance",
            step: isAr ? "الخطوة 2" : "STEP 2",
            title: t("التعيين والأذونات والإجازات", "Joining, Permissions & Leave"),
            sub:
              missingHireCount > 0
                ? t(`${missingHireCount} موظف بحاجة لتحديد تاريخ التعيين`, `${missingHireCount} worker(s) need joining date`)
                : t("الأذونات الشهرية (4/240د) ورصيد الإجازات", "Monthly permissions (4/240m) & leave balances"),
            action: t("ضبط التعيين والرصيد", "Set Dates & Quotas"),
            accent: missingHireCount > 0 ? "bg-amber-500" : "bg-sky-500",
          },
          {
            key: "payroll",
            step: isAr ? "الخطوة 3" : "STEP 3",
            title: t("الرواتب وكشوف المرتبات", "Monthly Payroll & Payslips"),
            sub: t(
              `صافي الدورة: ${payrollTotals.net} ج.م · إداري: -${payrollTotals.manualDeductions} ج.م`,
              `Net due: EGP ${payrollTotals.net} · Ded: -EGP ${payrollTotals.manualDeductions}`,
            ),
            action: t("مراجعة الرواتب والطباعة", "Review & Print Payslips"),
            accent: "bg-red-500",
          },
          {
            key: "disciplinary",
            step: isAr ? "الخطوة 4" : "STEP 4",
            title: t("لائحة الجزاءات والمخالفات", "Disciplinary Schedule"),
            sub: t(
              `${DISCIPLINARY_RULES.length} مادة قانونية (مواعيد، سلوك، نظام عمل) مع خصم تلقائي`,
              `${DISCIPLINARY_RULES.length} official articles with auto EGP deduction`,
            ),
            action: t("تصفح اللائحة وتوقيع جزاء", "View Rules & Apply Penalty"),
            accent: "bg-rose-500",
          },
          {
            key: "holidays",
            step: isAr ? "الخطوة 5" : "STEP 5",
            title: t("العطلات الرسمية والسياسات", "Holidays & Work Policies"),
            sub: t(
              `${holidays.length} عطلة رسمية مسجلة · بداية الشهر يوم ${settings.monthStartDay}`,
              `${holidays.length} official holidays · Cycle starts Day ${settings.monthStartDay}`,
            ),
            action: t("إدارة العطلات والسياسات", "Manage Holidays & Rules"),
            accent: "bg-zinc-600",
          },
        ].map((card) => {
          const active = section === card.key;
          return (
            <button
              key={card.key}
              type="button"
              onClick={() => setSection(card.key)}
              className={`ui-card ui-card-hover relative flex flex-col justify-between overflow-hidden p-4 text-start transition-all cursor-pointer ${
                active ? "ring-2 ring-red-600 bg-red-50/20" : ""
              }`}
            >
              <span className={`absolute inset-x-0 top-0 h-1 ${active ? "bg-red-600" : card.accent}`} />
              <div>
                <div className="flex items-center justify-between font-code text-[10px] font-bold uppercase text-zinc-400">
                  <span>{card.step}</span>
                  {active && (
                    <span className="rounded-full bg-red-600 px-2 py-0.5 text-[9px] text-white">
                      {t("نشط", "Active")}
                    </span>
                  )}
                </div>
                <div className="mt-1.5 text-sm font-bold text-zinc-900">{card.title}</div>
                <div className="mt-1 text-[11px] leading-relaxed text-zinc-500">{card.sub}</div>
              </div>
              <div className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-red-600">
                <span>{card.action}</span>
                <span>{isAr ? "←" : "→"}</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* ── Official Holiday Banner (If Today is a Holiday) ── */}
      {todayHoliday && (
        <div className="ui-card flex items-center justify-between gap-3 border-emerald-300 bg-emerald-50/70 p-4 animate-fade-in">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white">
              <SvgI d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" className="h-5 w-5" />
            </span>
            <div>
              <div className="text-sm font-bold text-emerald-950">
                {t(`اليوم عطلة رسمية: ${todayHoliday.name}`, `Today is an Official Holiday: ${todayHoliday.name}`)}
              </div>
              <p className="mt-0.5 text-xs text-emerald-800">
                {t(
                  "العمل معفى اليوم ولن يتم احتساب أي خصم غياب على الموظفين في هذا التاريخ.",
                  "Work shift is excused. Workers will NOT incur absence deductions on this date.",
                )}
              </p>
            </div>
          </div>
          <span className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white">
            {t("عطلة مدفوعة الأجر", "Paid Holiday")}
          </span>
        </div>
      )}

      {/* ── Accessible Single-Row Navigation Tablist ── */}
      <div
        role="tablist"
        aria-label={t("أقسام الموارد البشرية", "HR Modules")}
        className="flex items-center gap-1 overflow-x-auto border-b border-zinc-200 bg-white px-2 pt-1 rounded-t-xl"
      >
        {HR_NAV_TABS.map((tab) => {
          const isSelected = section === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={isSelected}
              id={`hr-nav-tab-${tab.key}`}
              onClick={(e) => {
                setSection(tab.key);
                e.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" });
              }}
              className={`mft-tab-btn flex shrink-0 items-center gap-2 rounded-t-lg px-4 py-3 text-xs font-semibold transition-colors cursor-pointer ${
                isSelected
                  ? "bg-red-50/60 text-red-700"
                  : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
              }`}
            >
              <SvgI d={tab.icon} className={`h-4 w-4 ${isSelected ? "text-red-600" : "text-zinc-400"}`} />
              <span>{isAr ? tab.ar : tab.en}</span>
            </button>
          );
        })}
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          TAB 1: TODAY OPERATIONS (LIVE ROSTER, 1-CLICK ONBOARDING & EXCUSES)
      ══════════════════════════════════════════════════════════════════ */}
      {section === "overview" && (
        <TodayTab
          approved={approved}
          settings={settings}
          hrSummary={hrSummary}
          todaysSessions={todaysSessions}
          presentWorkerIds={presentWorkerIds}
          lateWorkerIds={lateWorkerIds}
          overtimeWorkerIds={overtimeWorkerIds}
          todayFilter={todayFilter}
          setTodayFilter={setTodayFilter}
          setOnboardModalWorker={setOnboardModalWorker}
          setExcuseModalWorker={setExcuseModalWorker}
          setPayslipModalWorker={setPayslipModalWorker}
          openAdjustmentFor={openAdjustmentFor}
        />
      )}

      {/* ══════════════════════════════════════════════════════════════════
          TAB 2: JOINING DATES, PERMISSIONS & LEAVE (HR-POL-2026)
      ══════════════════════════════════════════════════════════════════ */}
      {section === "compliance" && (
        <div className="space-y-5 animate-fade-in font-mono">
          <HrComplianceView
            workers={approved}
            ledger={effectiveLedger}
            approvedRequests={approvedRequests}
            reimbursements={reimbursements}
            settings={settings}
            adminEmail={adminEmail}
            onOpenPolicyModal={() => setPolicyModalOpen(true)}
          />
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          TAB 3: PAYROLL CENTER (COMMAND TABLE, ADVANCES, PAYSLIPS & LOCK)
      ══════════════════════════════════════════════════════════════════ */}
      {section === "payroll" && (
        <PayrollTab
          settings={settings}
          holidays={holidays}
          rangeKey={rangeKey}
          setRangeKey={setRangeKey}
          setCustomStart={setCustomStart}
          setCustomEnd={setCustomEnd}
          activePeriod={activePeriod}
          currentCycleStatus={currentCycleStatus}
          payrollTableData={payrollTableData}
          payrollTotals={payrollTotals}
          setPolicyModalOpen={setPolicyModalOpen}
          setSection={setSection}
          setOnboardModalWorker={setOnboardModalWorker}
          setPayslipModalWorker={setPayslipModalWorker}
          openAdjustmentFor={openAdjustmentFor}
          handleRemoveAdjustment={handleRemoveAdjustment}
          handleToggleCycleStatus={handleToggleCycleStatus}
          exportPayrollCsv={exportPayrollCsv}
        />
      )}

      {/* ══════════════════════════════════════════════════════════════════
          TAB 4: OFFICIAL DISCIPLINARY SCHEDULE & PENALTIES (لائحة الجزاءات)
      ══════════════════════════════════════════════════════════════════ */}
      {section === "disciplinary" && (
        <HrDisciplinaryCatalog
          workers={approved}
          adjustments={adjustments}
          defaultHourlyRate={settings.defaultHourlyRate}
          standardHours={settings.standardHours}
          adminEmail={adminEmail}
        />
      )}

      {/* ══════════════════════════════════════════════════════════════════
          TAB 5: HOLIDAYS & WORK POLICIES
      ══════════════════════════════════════════════════════════════════ */}
      {section === "holidays" && (
        <div className="space-y-6 animate-fade-in font-mono">
          <HrHolidaysManager
            holidays={holidays}
            adminEmail={adminEmail}
            onOpenPolicyModal={() => setPolicyModalOpen(true)}
          />
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          TAB 5: TEAM ANALYTICS & TIMESHEETS
      ══════════════════════════════════════════════════════════════════ */}
      {section === "team" && (
        <TeamTab
          approved={approved}
          sessions={sessions}
          settings={settings}
          activePeriod={activePeriod}
          workerTaskStats={workerTaskStats}
          setOnboardModalWorker={setOnboardModalWorker}
          setPayslipModalWorker={setPayslipModalWorker}
          setDashboardWorker={setDashboardWorker}
        />
      )}

      {/* ══════════════════════════════════════════════════════════════════
          TAB 6: ALERTS & DISCIPLINARY LOGS
      ══════════════════════════════════════════════════════════════════ */}
      {section === "alerts" && <AlertsTab alerts={alerts} approved={approved} setSendOpen={setSendOpen} />}

      {/* ── MODALS ── */}

      {/* 1. Policy Settings Modal */}
      {policyModalOpen && (
        <HrPolicyModal
          initialSettings={settings}
          adminEmail={adminEmail}
          onClose={() => setPolicyModalOpen(false)}
        />
      )}

      {/* 2. Record Bonus / Deduction / Advance / Allowance Modal */}
      {adjustmentModalOpen && (
        <HrAdjustmentModal
          workers={approved}
          preselectedWorkerId={adjustmentWorkerId}
          initialType={adjustmentInitialType}
          existingAdjustments={adjustments.filter((a) => {
            const pStart = activePeriod.start.toISOString().split("T")[0];
            const pEnd = activePeriod.end.toISOString().split("T")[0];
            return a.date >= pStart && a.date <= pEnd;
          })}
          adminEmail={adminEmail}
          onClose={() => {
            setAdjustmentModalOpen(false);
            setAdjustmentWorkerId(undefined);
            setAdjustmentInitialType("bonus");
          }}
        />
      )}

      {/* 3. Excuse Worker Absence Modal */}
      {excuseModalWorker && (
        <HrExcuseModal
          worker={excuseModalWorker}
          date={today}
          adminEmail={adminEmail}
          onClose={() => setExcuseModalWorker(null)}
          onExcused={() => setRefreshTick((n) => n + 1)}
        />
      )}

      {/* 4. Worker Payslip Modal */}
      {payslipModalWorker &&
        (() => {
          const row = payrollTableData.find((r) => r.worker.id === payslipModalWorker.id);
          const computed = row
            ? row.payroll
            : computePayrollForWorker(
                workerSessionsInRange(sessions, payslipModalWorker.id, activePeriod.start, activePeriod.end),
                payslipModalWorker.hourlyRate || settings.defaultHourlyRate || 31.25,
                activePeriod.start,
                activePeriod.end,
                {
                  weekendDays: settings.weekendDays,
                  holidays,
                  settings,
                  ...policyInputsFor(payslipModalWorker, activePeriod.start, activePeriod.end),
                },
              );

          return (
            <HrPayslipModal
              worker={payslipModalWorker}
              payroll={computed}
              adjustments={row?.adjustments ?? []}
              onRemoveAdjustment={(adj) => void handleRemoveAdjustment(adj, workerName(payslipModalWorker))}
              onOpenAddAdjustment={(kind) => {
                const wId = payslipModalWorker.id;
                setPayslipModalWorker(null);
                openAdjustmentFor(wId, kind);
              }}
              cycleLabel={activePeriod.label}
              periodStart={activePeriod.start}
              periodEnd={activePeriod.end}
              onClose={() => setPayslipModalWorker(null)}
            />
          );
        })()}

      {/* 5. Quick Onboarding / Joining Date & Rate Modal */}
      {onboardModalWorker && (
        <WorkerOnboardModal
          worker={onboardModalWorker}
          adminEmail={adminEmail}
          onClose={() => setOnboardModalWorker(null)}
        />
      )}

      {/* 6. Send Alert Modal */}
      {sendOpen && <SendAlertModal approved={approved} adminEmail={adminEmail} onClose={() => setSendOpen(false)} />}

      {/* 7. Complete Worker 360 Dashboard Modal */}
      {dashboardWorker && (
        <Worker360Modal
          worker={dashboardWorker}
          settings={settings}
          adminEmail={adminEmail}
          onClose={() => setDashboardWorker(null)}
          onOpenPayslip={(w) => setPayslipModalWorker(w)}
        />
      )}
    </div>
  );
}
