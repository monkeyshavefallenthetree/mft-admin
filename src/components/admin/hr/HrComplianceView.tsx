"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import {
  LEAVE_PHASE_AR,
  computeLeaveAccrual,
  policyConfigFromSettings,
  priorUsedRecordedOn,
  usageFromLedger,
  ymd,
  type LeavePhase,
} from "@/lib/admin/hrPolicy2026";
import { getPayrollCycleRange, type HrSettings } from "@/lib/admin/hrReports";
import {
  bulkSetSystemStartDate,
  reapplyPermission,
  reversePermission,
  saveWorkerLeaveProfile,
  type ApprovedRequestRow,
  type PermissionLedgerDoc,
  type ReimbursementDoc,
} from "@/lib/admin/hrSettings";
import { toast, confirmDialog } from "@/lib/admin/feedback";
import { logActivity } from "@/lib/admin/activity";
import { useHrLang } from "@/lib/admin/hrI18n";

const LEAVE_PHASE_EN: Record<LeavePhase, string> = {
  probation: "Probation",
  year1: "Year 1 (15d)",
  year2plus: "Year 2+ (21d)",
};

interface WorkerLite {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  department?: string;
  hourlyRate?: number;
  expectedSalary?: number | string;
  hireDate?: string;
  attendanceStartDate?: string;
  priorUsedLeaveDays?: number;
  carriedOverLeaveDays?: number;
  carryOverApprovedBy?: string;
  createdAt?: { toDate: () => Date };
}

interface Props {
  workers: WorkerLite[];
  ledger: PermissionLedgerDoc[];
  approvedRequests: ApprovedRequestRow[];
  reimbursements: ReimbursementDoc[];
  settings: HrSettings;
  adminEmail: string;
  onOpenPolicyModal: () => void;
}

const PHASE_STYLE: Record<LeavePhase, string> = {
  probation: "bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800",
  year1: "bg-sky-50 text-sky-800 border-sky-300 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800",
  year2plus: "bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800",
};

function Meter({ value, max, tone }: { value: number; max: number; tone: string }) {
  const pct = Math.min(100, max > 0 ? (value / max) * 100 : 0);
  return (
    <div className="h-1.5 w-full bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
      <div className={`h-full ${tone} transition-all duration-500`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function shiftDateMonths(monthsAgo: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - monthsAgo);
  return ymd(d);
}

type DraftRow = {
  hireDate: string;
  attendanceStartDate: string;
  hourlyRate: number;
  priorUsedLeaveDays: number;
  carriedOverLeaveDays: number;
  carryOverApprovedBy: string;
};

export default function HrComplianceView({
  workers,
  ledger,
  approvedRequests,
  reimbursements,
  settings,
  adminEmail,
  onOpenPolicyModal,
}: Props) {
  const { isAr, dir, t } = useHrLang();
  const cfg = useMemo(() => policyConfigFromSettings(settings), [settings]);
  const cycle = useMemo(() => getPayrollCycleRange(new Date(), settings.monthStartDay), [settings.monthStartDay]);
  const cycleStart = ymd(cycle.start);
  const cycleEnd = ymd(cycle.end);
  const todayYmd = ymd(new Date());

  const [expanded, setExpanded] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [onboardingMode, setOnboardingMode] = useState(false);
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, DraftRow>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [bulkStartDate, setBulkStartDate] = useState(todayYmd);
  const [bulkBusy, setBulkBusy] = useState(false);

  const getDraft = (w: WorkerLite): DraftRow => {
    return (
      drafts[w.id] ?? {
        hireDate: w.hireDate ?? "",
        attendanceStartDate: w.attendanceStartDate ?? "",
        hourlyRate: w.hourlyRate ?? settings.defaultHourlyRate ?? 31.25,
        priorUsedLeaveDays: w.priorUsedLeaveDays ?? 0,
        carriedOverLeaveDays: w.carriedOverLeaveDays ?? 0,
        carryOverApprovedBy: w.carryOverApprovedBy ?? adminEmail,
      }
    );
  };

  const setDraftField = (w: WorkerLite, patch: Partial<DraftRow>) => {
    setDrafts((prev) => ({
      ...prev,
      [w.id]: { ...getDraft(w), ...patch },
    }));
  };

  const saveRowDraft = async (w: WorkerLite, name: string) => {
    const d = getDraft(w);
    if (d.carriedOverLeaveDays > 0 && !d.carryOverApprovedBy.trim()) {
      toast.warning(t("الرصيد المرحّل يتطلب كتابة اسم المدير المعتمد.", "Carry-over requires an approving manager name."));
      return;
    }
    setSavingId(w.id);
    try {
      await saveWorkerLeaveProfile(w.id, {
        hireDate: d.hireDate || null,
        attendanceStartDate: d.attendanceStartDate || null,
        hourlyRate: d.hourlyRate > 0 ? d.hourlyRate : 31.25,
        priorUsedLeaveDays: d.priorUsedLeaveDays,
        carriedOverLeaveDays: d.carriedOverLeaveDays,
        carryOverApprovedBy: d.carryOverApprovedBy.trim() || adminEmail,
      });
      void logActivity({
        action: "updated",
        entity: "worker",
        entityId: w.id,
        label: `Updated joining date & leave profile for ${name} (joined ${d.hireDate || "—"}, system start ${d.attendanceStartDate || "auto"}, rate ${d.hourlyRate})`,
      });
      toast.success(t(`تم حفظ بيانات ${name}`, `Saved ${name}`));
      if (!onboardingMode) setEditingRowId(null);
    } catch (e) {
      toast.error(t("تعذر الحفظ", "Could not save"), { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSavingId(null);
    }
  };

  const handleBulkSystemStart = async () => {
    if (!bulkStartDate || workers.length === 0) return;
    const ok = await confirmDialog({
      title: t(
        `تحديد تاريخ بدء الحساب بالنظام لجميع الموظفين إلى ${bulkStartDate}؟`,
        `Set System Attendance Start Date to ${bulkStartDate}?`,
      ),
      message: t(
        `سيتم ضبط تاريخ بدء حساب الحضور بالنظام على ${bulkStartDate} لجميع الموظفين (${workers.length} موظف) بحيث لا يخصم النظام أي أيام غياب سابقة لهذا التاريخ. (يبقى تاريخ التعيين بالشركة الخاص بكل موظف كما هو لحساب الإجازات).`,
        `This sets the MFT attendance start date to ${bulkStartDate} for all ${workers.length} approved workers so payroll will NOT penalize any days before ${bulkStartDate} as absences. (Each worker's Company Joining Date for leave accrual stays unchanged.)`,
      ),
      confirmLabel: t(`تطبيق على ${workers.length} موظف`, `Apply to ${workers.length} workers`),
    });
    if (!ok) return;
    setBulkBusy(true);
    try {
      await bulkSetSystemStartDate(
        workers.map((w) => w.id),
        bulkStartDate,
      );
      void logActivity({
        action: "updated",
        entity: "hr",
        label: `Bulk set system attendance start date to ${bulkStartDate} for ${workers.length} workers`,
      });
      toast.success(
        t(
          `تم ضبط تاريخ بدء النظام إلى ${bulkStartDate} لجميع الموظفين`,
          `System start date set to ${bulkStartDate} for ${workers.length} workers`,
        ),
      );
    } catch (e) {
      toast.error(t("فشل التحديث الجماعي", "Bulk update failed"), {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBulkBusy(false);
    }
  };

  const rows = useMemo(() => {
    const today = new Date();
    return workers
      .map((w) => {
        const cycleLedger = ledger.filter((l) => l.workerId === w.id && l.date >= cycleStart && l.date <= cycleEnd);
        const usage = usageFromLedger(cycleLedger);
        const uncovered = cycleLedger.filter((l) => l.status === "applied" && !l.covered).length;
        const fallbackHire = w.createdAt?.toDate ? ymd(w.createdAt.toDate()) : null;
        const draft = drafts[w.id];
        const hire = (draft ? draft.hireDate : w.hireDate) || fallbackHire;
        const usedLeave = approvedRequests
          .filter((r) => r.workerId === w.id && r.type === "annual_leave" && r.exceptionDate)
          .map((r) => ({ date: r.exceptionDate, days: Number(r.leaveDays) > 0 ? Number(r.leaveDays) : 1 }));
        const accrual = hire
          ? computeLeaveAccrual(
              hire,
              today,
              {
                usedLeave,
                carriedOverApproved: draft ? draft.carriedOverLeaveDays : w.carriedOverLeaveDays ?? 0,
                priorUsedLeaveDays: draft ? draft.priorUsedLeaveDays : w.priorUsedLeaveDays ?? 0,
                priorUsedAsOf: priorUsedRecordedOn(
                  { attendanceStartDate: draft ? draft.attendanceStartDate : w.attendanceStartDate },
                  settings,
                ),
              },
              cfg,
            )
          : null;
        const pendingReimb = reimbursements.filter(
          (r) => r.workerId === w.id && (r.stage === "pre_approval" || r.stage === "review"),
        ).length;
        return {
          worker: w,
          name: `${w.firstName || ""} ${w.lastName || ""}`.trim() || w.email || "Worker",
          cycleLedger,
          usage,
          uncovered,
          hire,
          hireIsFallback: !w.hireDate,
          systemStart: w.attendanceStartDate || w.hireDate || fallbackHire,
          accrual,
          pendingReimb,
        };
      })
      .filter((r) => !search.trim() || r.name.toLowerCase().includes(search.trim().toLowerCase()))
      .sort((a, b) => b.usage.minutes - a.usage.minutes || a.name.localeCompare(b.name));
  }, [workers, ledger, approvedRequests, reimbursements, cfg, settings, cycleStart, cycleEnd, search, drafts]);

  const kpis = useMemo(() => {
    let used = 0;
    let minutes = 0;
    let uncovered = 0;
    let exhausted = 0;
    let missingHire = 0;
    for (const r of rows) {
      used += r.usage.count;
      minutes += r.usage.minutes;
      uncovered += r.uncovered;
      if (r.usage.count >= cfg.permissionMaxCount || r.usage.minutes >= cfg.permissionMaxMinutes) exhausted++;
      if (r.hireIsFallback) missingHire++;
    }
    const pendingReimb = reimbursements.filter((r) => r.stage === "pre_approval" || r.stage === "review").length;
    return { used, minutes, uncovered, exhausted, missingHire, pendingReimb };
  }, [rows, reimbursements, cfg]);

  const toggleEntry = async (e: PermissionLedgerDoc, name: string) => {
    const reversing = e.status === "applied";
    const ok = await confirmDialog({
      title: reversing ? t("إلغاء الإذن وإعادة الرصيد؟", "Reverse permission?") : t("إعادة تطبيق الإذن؟", "Re-apply permission?"),
      message: reversing
        ? t(
            `هل تريد استعادة ${e.chargedMinutes} دقيقة إلى رصيد ${name} ليوم ${e.date}؟`,
            `Restore ${e.chargedMinutes} min to ${name}'s quota for ${e.date}?`,
          )
        : t(
            `هل تريد إعادة خصم هذا الإذن ليوم ${e.date}؟`,
            `Charge this permission again for ${e.date}?`,
          ),
      confirmLabel: reversing ? t("إلغاء الإذن", "Reverse") : t("إعادة التطبيق", "Re-apply"),
    });
    if (!ok) return;
    try {
      if (reversing) await reversePermission(e.id, adminEmail);
      else await reapplyPermission(e.id, adminEmail);
      void logActivity({
        action: "updated",
        entity: "hr",
        label: `${reversing ? "Reversed" : "Re-applied"} ${e.kind} permission (${e.date}) for ${name}`,
      });
      toast.success(reversing ? t("تم إلغاء الإذن واستعادة الرصيد", "Permission reversed") : t("تم إعادة تطبيق الإذن", "Permission re-applied"));
    } catch (err) {
      toast.error(t("فشل التحديث", "Update failed"), { description: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <div dir={dir} className="space-y-5">
      {/* Policy status banner */}
      <div
        className={`p-4 border-2 rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-3 ${
          settings.policy2026Enabled
            ? "border-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 shadow-[3px_3px_0px_0px_#059669]"
            : "border-amber-500 bg-amber-50 dark:bg-amber-950/30 shadow-[3px_3px_0px_0px_#d97706]"
        }`}
      >
        <div className="text-xs space-y-1">
          <div className="font-bold text-sm tracking-wide text-zinc-950 dark:text-white flex items-center gap-2">
            <span>
              {t(
                `لائحة HR-POL-2026 · ${settings.policy2026Enabled ? "مفعّلة" : "غير مفعّلة"}`,
                `HR-POL-2026 · ${settings.policy2026Enabled ? "Active" : "Disabled"}`,
              )}
            </span>
          </div>
          <p className="text-zinc-600 dark:text-zinc-400">
            {settings.policy2026Enabled
              ? t(
                  `الأذونات الشهرية (${cfg.permissionMaxCount} أذونات / ${cfg.permissionMaxMinutes} دقيقة)، حد التأخير ${cfg.lateCutoffTime}، الإضافي النهاري ${cfg.dayOtMultiplier}x والليلي ${cfg.nightOtMultiplier}x، وتراكم الإجازات من تاريخ التعيين.`,
                  `Monthly permissions (${cfg.permissionMaxCount} / ${cfg.permissionMaxMinutes} min), late cutoff ${cfg.lateCutoffTime}, Day OT ${cfg.dayOtMultiplier}x / Night OT ${cfg.nightOtMultiplier}x, and leave accrual from joining date.`,
                )
              : t(
                  "الأذونات مسجلة أدناه، لكن الرواتب تستخدم النظام القديم حاليًا.",
                  "Permissions are tracked below, but payroll currently uses legacy rules.",
                )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            id="toggle-onboarding-mode"
            onClick={() => setOnboardingMode((v) => !v)}
            className={`px-3 py-2 border-2 border-zinc-900 text-xs font-bold uppercase tracking-wider shadow-[2px_2px_0px_0px_#09090b] cursor-pointer rounded ${
              onboardingMode
                ? "bg-red-600 text-white"
                : "bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950 hover:bg-zinc-800"
            }`}
          >
            {onboardingMode
              ? t("✓ إغلاق وضع التعديل الجماعي", "✓ Done Editing Dates")
              : t("🗓️ ضبط تواريخ تعيين الموظفين والرواتب", "🗓️ Setup Workers' Joining Dates & Rates")}
          </button>
          <button
            type="button"
            onClick={onOpenPolicyModal}
            className="px-3 py-2 border-2 border-zinc-900 bg-white dark:bg-zinc-900 text-xs font-bold uppercase tracking-wider shadow-[2px_2px_0px_0px_#09090b] cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded"
          >
            {t("⚙️ إعدادات اللائحة", "⚙️ Configure Policy")}
          </button>
        </div>
      </div>

      {/* Existing Workers Migration / Onboarding Bar */}
      {(onboardingMode || kpis.missingHire > 0) && (
        <div className="p-4 bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-700 rounded-lg shadow-[3px_3px_0px_0px_#dc2626] space-y-3 text-xs">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="font-bold text-sm text-zinc-950 dark:text-white flex items-center gap-2">
                <span className="px-2 py-0.5 bg-red-600 text-white text-[10px] uppercase rounded">
                  {t("إعداد الموظفين الحاليين", "Existing Staff Setup")}
                </span>
                <span>
                  {t(
                    "تحكم في تاريخ التحاق كل موظف بالشركة وتاريخ بدء الحساب على النظام الجديد",
                    "Control When Existing Workers Joined the Company vs. Started on MFT",
                  )}
                </span>
              </div>
              <p className="text-zinc-600 dark:text-zinc-400">
                {t(
                  "لأن لديك موظفين يعملون بالفعل قبل إطلاق النظام: حدد لكل موظف (١) تاريخ التعيين بالشركة لحساب الإجازات واجتياز فترة الاختبار، و(٢) تاريخ بدء النظام لمنع خصم غياب عن الأيام السابقة، و(٣) الإجازات المستهلكة سابقًا.",
                  "Because your team already worked with you before launching this system: set each worker's (1) Company Joining Date (for probation & 15d/21d leave), (2) System Start Date (no absence penalties before this date), and (3) Prior Used Leave.",
                )}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0 bg-zinc-50 dark:bg-zinc-800/60 p-2.5 border border-zinc-300 dark:border-zinc-700 rounded">
              <div className="text-[10px] font-bold uppercase text-zinc-500">
                {t("تاريخ بدء النظام للجميع:", "Bulk System Start Date:")}
              </div>
              <input
                type="date"
                value={bulkStartDate}
                onChange={(e) => setBulkStartDate(e.target.value)}
                className="border-2 border-zinc-900 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs font-bold rounded"
              />
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => void handleBulkSystemStart()}
                className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold uppercase text-[10px] border border-zinc-900 rounded cursor-pointer disabled:opacity-50"
              >
                {bulkBusy
                  ? t("جارٍ التطبيق…", "Applying…")
                  : t(`تطبيق على الكل (${workers.length})`, `Apply to All (${workers.length})`)}
              </button>
              {!onboardingMode && (
                <button
                  type="button"
                  onClick={() => setOnboardingMode(true)}
                  className="px-2.5 py-1.5 bg-zinc-900 text-white font-bold uppercase text-[10px] rounded cursor-pointer"
                >
                  {t("فتح تعديل جميع الموظفين", "Edit All Workers Inline")}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {[
          {
            label: t("الأذونات المستخدمة", "Permissions Used"),
            value: kpis.used,
            sub: t(`${kpis.minutes} دقيقة في هذه الدورة`, `${kpis.minutes} min this cycle`),
            bar: "bg-sky-500",
          },
          {
            label: t("استنفدوا الرصيد", "Quota Exhausted"),
            value: kpis.exhausted,
            sub: t("وصلوا إلى 4 أذونات أو 240 د", "workers at 4 / 240m"),
            bar: "bg-amber-500",
          },
          {
            label: t("تأخير غير مغطى", "Uncovered Lateness"),
            value: kpis.uncovered,
            sub: t("تطبق عليه لائحة الجزاءات", "fallback penalties"),
            bar: "bg-red-500",
          },
          {
            label: t("مصروفات بانتظار المراجعة", "Pending Expenses"),
            value: kpis.pendingReimb,
            sub: t("مأموريات ومشتريات", "awaiting review"),
            bar: "bg-violet-500",
          },
          {
            label: t("بحاجة لتحديد تاريخ التعيين", "Missing Join Date"),
            value: kpis.missingHire,
            sub: t("اضغط على الصف لتحديده", "click row to set"),
            bar: "bg-zinc-500",
          },
          {
            label: t("الدورة الحالية", "Active Cycle"),
            value: cycle.label.split("–")[0]?.trim() ?? "",
            sub: cycle.label,
            bar: "bg-zinc-900 dark:bg-zinc-100",
          },
        ].map((k) => (
          <div
            key={k.label}
            className="relative overflow-hidden p-3 bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-700 rounded-lg shadow-[2px_2px_0px_0px_#09090b]"
          >
            <span className={`absolute inset-x-0 top-0 h-1 ${k.bar}`} />
            <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">{k.label}</div>
            <div className="mt-1 text-xl font-black text-zinc-950 dark:text-white truncate">{k.value}</div>
            <div className="text-[10px] text-zinc-400 truncate">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-700 rounded-lg shadow-[3px_3px_0px_0px_#09090b] overflow-hidden">
        <div className="p-3 border-b-2 border-zinc-900 dark:border-zinc-700 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-bold text-sm uppercase tracking-wide text-zinc-950 dark:text-white">
            {t("سجل تواريخ التعيين والأذونات والإجازات", "Joining Dates, Permissions & Leave Ledger")}{" "}
            <span className="text-zinc-400 font-normal">({rows.length})</span>
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/admin/reimbursements"
              className="px-2.5 py-1.5 text-xs font-bold border-2 border-violet-600 bg-violet-50 dark:bg-violet-950/40 text-violet-800 dark:text-violet-300 rounded cursor-pointer hover:bg-violet-100"
            >
              {t(`🚕 مراجعة المصروفات والمأموريات (${kpis.pendingReimb})`, `🚕 Review Reimbursements (${kpis.pendingReimb})`)}
            </Link>
            <button
              type="button"
              onClick={() => setOnboardingMode((v) => !v)}
              className={`px-2.5 py-1.5 text-xs font-bold uppercase border-2 border-zinc-900 rounded cursor-pointer ${
                onboardingMode ? "bg-red-600 text-white" : "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
              }`}
            >
              {onboardingMode
                ? t("إغلاق التعديل الجماعي", "Close Inline Editor")
                : t("✏️ تعديل التواريخ والرواتب سريعًا", "✏️ Quick Edit Dates & Rates")}
            </button>
            <input
              id="compliance-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("ابحث باسم الموظف…", "Search worker…")}
              className="px-2.5 py-1.5 text-xs border-2 border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 rounded w-52 focus:outline-none focus:border-red-600"
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-zinc-50 dark:bg-zinc-800/60 text-[10px] uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="text-start p-3">{t("الموظف", "Worker")}</th>
                <th className="text-start p-3">{t("تاريخ التعيين / بدء النظام", "Company Joined / System Start")}</th>
                <th className="text-start p-3">{t("شريحة الإجازة", "Leave Phase")}</th>
                <th className="text-end p-3">{t("رصيد الإجازات", "Leave Balance")}</th>
                <th className="text-start p-3 w-36">{t("الأذونات (العدد)", "Permissions")}</th>
                <th className="text-start p-3 w-36">{t("الأذونات (الدقائق)", "Minutes")}</th>
                <th className="text-center p-3">{t("غير مغطى", "Uncovered")}</th>
                <th className="text-center p-3">{t("مصروفات", "Expenses")}</th>
                <th className="p-3 text-end">{t("إجراءات", "Actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {rows.map((r) => {
                const open = expanded === r.worker.id;
                const isEditingRow = onboardingMode || editingRowId === r.worker.id;
                const draft = getDraft(r.worker);
                const rowDirty =
                  draft.hireDate !== (r.worker.hireDate ?? "") ||
                  draft.attendanceStartDate !== (r.worker.attendanceStartDate ?? "") ||
                  draft.hourlyRate !== (r.worker.hourlyRate ?? settings.defaultHourlyRate ?? 31.25) ||
                  draft.priorUsedLeaveDays !== (r.worker.priorUsedLeaveDays ?? 0) ||
                  draft.carriedOverLeaveDays !== (r.worker.carriedOverLeaveDays ?? 0);
                const countTone =
                  r.usage.count >= cfg.permissionMaxCount ? "bg-red-500" : r.usage.count >= 3 ? "bg-amber-500" : "bg-sky-500";
                const minTone =
                  r.usage.minutes >= cfg.permissionMaxMinutes
                    ? "bg-red-500"
                    : r.usage.minutes >= 180
                      ? "bg-amber-500"
                      : "bg-sky-500";
                return (
                  <Fragment key={r.worker.id}>
                    <tr className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                      <td className="p-3">
                        <div className="font-bold text-zinc-950 dark:text-white">{r.name}</div>
                        <div className="text-[10px] text-zinc-400">
                          {r.worker.department || "—"} · EGP {r.worker.hourlyRate ?? settings.defaultHourlyRate ?? 31.25}/h
                        </div>
                      </td>
                      <td className="p-3">
                        <button
                          type="button"
                          onClick={() => setEditingRowId(editingRowId === r.worker.id ? null : r.worker.id)}
                          className="text-start group cursor-pointer"
                          title={t("اضغط لتعديل تاريخ التعيين وتاريخ بدء النظام وأجر الساعة", "Click to edit joining date, system start date & hourly rate")}
                        >
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] uppercase text-zinc-400">{t("التعيين:", "Joined:")}</span>
                            {r.hire ? (
                              <span
                                className={`font-bold group-hover:underline ${
                                  r.hireIsFallback ? "text-amber-600" : "text-zinc-900 dark:text-zinc-100"
                                }`}
                              >
                                {r.hire}
                                {r.hireIsFallback && t(" ⚠ (تلقائي)", " ⚠ (sign-up)")}
                              </span>
                            ) : (
                              <span className="text-amber-600 font-bold underline">
                                {t("حدد التاريخ…", "Set date…")}
                              </span>
                            )}
                            <span className="text-[10px] text-red-600 opacity-70 group-hover:opacity-100">✏️</span>
                          </div>
                          <div className="text-[10px] text-zinc-500">
                            {t("بدء النظام:", "MFT Start:")}{" "}
                            <strong>{r.worker.attendanceStartDate || t("تلقائي", "Auto")}</strong>
                            {(r.worker.priorUsedLeaveDays ?? 0) > 0 &&
                              ` · ${t("مستهلك سابقًا:", "Prior:")} ${r.worker.priorUsedLeaveDays}d`}
                          </div>
                        </button>
                      </td>
                      <td className="p-3">
                        {r.accrual ? (
                          <div>
                            <span
                              className={`inline-block px-1.5 py-0.5 border rounded text-[10px] font-bold ${
                                PHASE_STYLE[r.accrual.phase]
                              }`}
                            >
                              {isAr ? LEAVE_PHASE_AR[r.accrual.phase] : LEAVE_PHASE_EN[r.accrual.phase]}
                            </span>
                            <div className="text-[10px] text-zinc-400 mt-0.5">
                              {isAr ? `${r.accrual.serviceMonths} شهر خدمة` : `${r.accrual.serviceMonths} mo tenure`}
                            </div>
                          </div>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="p-3 text-end font-bold text-zinc-950 dark:text-white">
                        {r.accrual ? `${r.accrual.balance} ${t("يوم", "d")}` : "—"}
                        {r.accrual && r.accrual.phase === "probation" && (
                          <div className="text-[10px] font-normal text-zinc-400">
                            {t(`ينتهي الاختبار ${r.accrual.probationEndsOn}`, `until ${r.accrual.probationEndsOn}`)}
                          </div>
                        )}
                        {r.accrual && r.accrual.phase !== "probation" && (
                          <div className="text-[10px] font-normal text-zinc-400">
                            {isAr
                              ? `${r.accrual.accruedDays} مستحق − ${r.accrual.usedDays} مستخدم`
                              : `${r.accrual.accruedDays}d accrued − ${r.accrual.usedDays}d used`}
                          </div>
                        )}
                      </td>
                      <td className="p-3">
                        <div className="flex justify-between mb-1">
                          <span className="font-bold">{r.usage.count}</span>
                          <span className="text-zinc-400">/ {cfg.permissionMaxCount}</span>
                        </div>
                        <Meter value={r.usage.count} max={cfg.permissionMaxCount} tone={countTone} />
                      </td>
                      <td className="p-3">
                        <div className="flex justify-between mb-1">
                          <span className="font-bold">{r.usage.minutes}</span>
                          <span className="text-zinc-400">/ {cfg.permissionMaxMinutes}</span>
                        </div>
                        <Meter value={r.usage.minutes} max={cfg.permissionMaxMinutes} tone={minTone} />
                      </td>
                      <td className="p-3 text-center">
                        {r.uncovered > 0 ? (
                          <span className="px-1.5 py-0.5 bg-red-600 text-white rounded font-bold">{r.uncovered}</span>
                        ) : (
                          <span className="text-zinc-300">0</span>
                        )}
                      </td>
                      <td className="p-3 text-center">
                        {r.pendingReimb > 0 ? (
                          <Link href="/admin/reimbursements" className="px-1.5 py-0.5 bg-violet-600 text-white rounded font-bold">
                            {r.pendingReimb}
                          </Link>
                        ) : (
                          <span className="text-zinc-300">0</span>
                        )}
                      </td>
                      <td className="p-3 text-end">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => setEditingRowId(editingRowId === r.worker.id ? null : r.worker.id)}
                            className="px-2 py-1 border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 rounded font-bold uppercase text-[10px] hover:border-red-600 hover:text-red-600 cursor-pointer"
                          >
                            {isEditingRow && !onboardingMode
                              ? t("إغلاق", "Close")
                              : t("🗓️ التعيين والراتب", "🗓️ Dates & Rate")}
                          </button>
                          <button
                            type="button"
                            id={`compliance-ledger-${r.worker.id}`}
                            onClick={() => setExpanded(open ? null : r.worker.id)}
                            className="px-2 py-1 border border-zinc-300 dark:border-zinc-700 rounded font-bold uppercase text-[10px] hover:border-red-600 hover:text-red-600 cursor-pointer"
                          >
                            {open ? t("إخفاء", "Hide") : `${t("السجل", "Ledger")} (${r.cycleLedger.length})`}
                          </button>
                        </div>
                      </td>
                    </tr>

                    {/* Inline Editor for Company Joining Date, System Start Date, Hourly Rate, Prior Used Leave & Carry-Over */}
                    {isEditingRow && (
                      <tr className="bg-amber-50/50 dark:bg-zinc-950/70 border-s-4 border-red-600">
                        <td colSpan={9} className="p-3">
                          <div className="flex flex-wrap items-end gap-3">
                            <div>
                              <label className="block text-[10px] font-bold uppercase text-zinc-600 dark:text-zinc-300">
                                {t("١. تاريخ التعيين بالشركة", "1. Company Joining Date")}
                              </label>
                              <div className="flex items-center gap-1 mt-1">
                                <input
                                  type="date"
                                  value={draft.hireDate}
                                  onChange={(e) => setDraftField(r.worker, { hireDate: e.target.value })}
                                  className="border-2 border-zinc-900 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs font-bold rounded"
                                />
                                {[
                                  { l: "6m", m: 6 },
                                  { l: "1y", m: 12 },
                                  { l: "2y", m: 24 },
                                ].map((p) => (
                                  <button
                                    key={p.l}
                                    type="button"
                                    title={`Set hire date to ${p.l} ago`}
                                    onClick={() =>
                                      setDraftField(r.worker, {
                                        hireDate: shiftDateMonths(p.m),
                                        attendanceStartDate: draft.attendanceStartDate || todayYmd,
                                      })
                                    }
                                    className="px-1.5 py-1 bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-900 hover:text-white text-[10px] font-bold rounded cursor-pointer"
                                  >
                                    -{p.l}
                                  </button>
                                ))}
                              </div>
                            </div>

                            <div>
                              <label className="block text-[10px] font-bold uppercase text-zinc-600 dark:text-zinc-300">
                                {t("٢. تاريخ بدء النظام (الحضور)", "2. System Attendance Start")}
                              </label>
                              <div className="flex items-center gap-1 mt-1">
                                <input
                                  type="date"
                                  value={draft.attendanceStartDate}
                                  onChange={(e) => setDraftField(r.worker, { attendanceStartDate: e.target.value })}
                                  className="border-2 border-zinc-900 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs font-bold rounded"
                                />
                                <button
                                  type="button"
                                  onClick={() => setDraftField(r.worker, { attendanceStartDate: todayYmd })}
                                  className="px-1.5 py-1 bg-emerald-100 text-emerald-800 hover:bg-emerald-600 hover:text-white text-[10px] font-bold rounded cursor-pointer"
                                >
                                  {t("اليوم", "Today")}
                                </button>
                              </div>
                            </div>

                            <div className="w-28">
                              <label className="block text-[10px] font-bold uppercase text-zinc-600 dark:text-zinc-300">
                                {t("٣. أجر الساعة (ج.م)", "3. Rate (EGP/h)")}
                              </label>
                              <input
                                type="number"
                                min={1}
                                step={0.25}
                                value={draft.hourlyRate}
                                onChange={(e) =>
                                  setDraftField(r.worker, { hourlyRate: Math.max(0, parseFloat(e.target.value) || 0) })
                                }
                                className="mt-1 w-full border-2 border-zinc-900 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs font-bold rounded"
                              />
                            </div>

                            <div className="w-32">
                              <label className="block text-[10px] font-bold uppercase text-zinc-600 dark:text-zinc-300">
                                {t("٤. إجازات سابقة (يوم)", "4. Prior Used (d)")}
                              </label>
                              <input
                                type="number"
                                min={0}
                                step={0.5}
                                value={draft.priorUsedLeaveDays}
                                onChange={(e) =>
                                  setDraftField(r.worker, { priorUsedLeaveDays: Math.max(0, parseFloat(e.target.value) || 0) })
                                }
                                className="mt-1 w-full border-2 border-zinc-900 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs font-bold rounded"
                              />
                            </div>

                            <div className="w-28">
                              <label className="block text-[10px] font-bold uppercase text-zinc-600 dark:text-zinc-300">
                                {t("٥. مرحّل (يوم)", "5. Carry-Over (d)")}
                              </label>
                              <input
                                type="number"
                                min={0}
                                step={0.5}
                                value={draft.carriedOverLeaveDays}
                                onChange={(e) =>
                                  setDraftField(r.worker, { carriedOverLeaveDays: Math.max(0, parseFloat(e.target.value) || 0) })
                                }
                                className="mt-1 w-full border-2 border-zinc-900 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs font-bold rounded"
                              />
                            </div>

                            <button
                              type="button"
                              disabled={savingId === r.worker.id || !rowDirty}
                              onClick={() => void saveRowDraft(r.worker, r.name)}
                              className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white font-bold uppercase text-[10px] border-2 border-zinc-900 shadow-[2px_2px_0px_0px_#09090b] rounded cursor-pointer disabled:opacity-40"
                            >
                              {savingId === r.worker.id ? t("جارٍ الحفظ…", "Saving…") : t("حفظ ✓", "Save ✓")}
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}

                    {open && (
                      <tr className="bg-zinc-50/70 dark:bg-zinc-950/40">
                        <td colSpan={9} className="p-3">
                          {r.cycleLedger.length === 0 ? (
                            <p className="text-zinc-400 text-center py-3">
                              {t("لا توجد أذونات مسجلة في هذه الدورة.", "No permissions recorded in this cycle.")}
                            </p>
                          ) : (
                            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                              {r.cycleLedger.map((e) => (
                                <div
                                  key={e.id}
                                  className={`p-2.5 border rounded flex items-start justify-between gap-2 ${
                                    e.status === "reversed"
                                      ? "border-zinc-200 dark:border-zinc-800 opacity-60"
                                      : e.covered
                                        ? "border-sky-300 dark:border-sky-800 bg-white dark:bg-zinc-900"
                                        : "border-red-300 dark:border-red-900 bg-red-50/60 dark:bg-red-950/30"
                                  }`}
                                >
                                  <div className="space-y-0.5">
                                    <div className="font-bold text-zinc-950 dark:text-white">
                                      {e.date} ·{" "}
                                      {e.kind === "late"
                                        ? t("حضور متأخر", "Late arrival")
                                        : e.kind === "early_leave"
                                          ? t("انصراف مبكر", "Early leave")
                                          : t("إذن يدوي", "Manual")}
                                    </div>
                                    <div className="text-[10px] text-zinc-500">
                                      {t(`فعلي ${e.actualMinutes}د ← محتسب ${e.chargedMinutes}د`, `actual ${e.actualMinutes}m → charged ${e.chargedMinutes}m`)}{" "}
                                      ·{" "}
                                      {e.covered
                                        ? t("مغطى بالرصيد", "covered")
                                        : t(`غير مغطى (خصم ${e.fallbackPenaltyDays ?? 0.25} يوم)`, `uncovered (${e.fallbackPenaltyDays ?? 0.25}d penalty)`)}
                                      {e.status === "reversed" && ` · ${t("ملغى", "reversed")}`}
                                    </div>
                                    {e.reason && (
                                      <div className="text-[10px] text-zinc-400" dir="rtl">
                                        {e.reason}
                                      </div>
                                    )}
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => void toggleEntry(e, r.name)}
                                    className="shrink-0 text-[10px] font-bold uppercase text-red-600 hover:underline cursor-pointer"
                                  >
                                    {e.status === "applied" ? t("إلغاء الإذن", "Reverse") : t("إعادة التطبيق", "Re-apply")}
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                          {r.accrual && (
                            <p className="mt-3 text-[10px] text-zinc-500">
                              {isAr
                                ? `تفاصيل الإجازات: المتراكم ${r.accrual.accruedDays} يوم · المستخدم ${r.accrual.usedDays} يوم (منها ${r.accrual.priorUsedLeaveDays} يوم قبل النظام) · المرحّل المعتمد ${r.accrual.carriedOverApproved} يوم · المعدل الحالي ${r.accrual.monthlyRate} يوم/شهر · شريحة 21 يوم تبدأ في ${r.accrual.tier2StartsOn}`
                                : `Leave: accrued ${r.accrual.accruedDays}d · used ${r.accrual.usedDays}d (incl. ${r.accrual.priorUsedLeaveDays}d prior to MFT) · approved carry-over ${r.accrual.carriedOverApproved}d · current rate ${r.accrual.monthlyRate}/month · 21-day tier from ${r.accrual.tier2StartsOn}`}
                            </p>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-zinc-400">
                    {t("لا يوجد موظفون معتمدون مطابقون للبحث.", "No approved workers found.")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
