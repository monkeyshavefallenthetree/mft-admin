"use client";

import { useEffect, useMemo, useState } from "react";
import {
  computeLeaveAccrual,
  leavePhaseLabelAr,
  leavePhaseLabelEn,
  policyConfigFromSettings,
  priorUsedRecordedOn,
  ymd,
  type LeaveLawType,
} from "@/lib/admin/hrPolicy2026";
import { DEFAULT_HR_SETTINGS, type HrSettings } from "@/lib/admin/hrReports";
import { saveWorkerLeaveProfile, subscribeHrSettings } from "@/lib/admin/hrSettings";
import { toast } from "@/lib/admin/feedback";
import { logActivity } from "@/lib/admin/activity";
import { useHrLang } from "@/lib/admin/hrI18n";

interface Props {
  worker: {
    id: string;
    firstName?: string;
    lastName?: string;
    hireDate?: string;
    attendanceStartDate?: string;
    leaveLawType?: LeaveLawType;
    priorUsedLeaveDays?: number;
    carriedOverLeaveDays?: number;
    carryOverApprovedBy?: string;
    hourlyRate?: number;
    expectedSalary?: number | string;
    createdAt?: { toDate: () => Date };
  };
  adminEmail?: string;
  onSaved?: () => void;
}

function shiftDateMonths(monthsAgo: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - monthsAgo);
  return ymd(d);
}

/**
 * HR-POL-2026 contract, joining date, compensation & leave onboarding editor (Bilingual AR/EN):
 * - Company Hire Date (`hireDate`): when the worker originally signed with the company (drives probation & 15d/21d tier)
 * - Labor Law Mode (`leaveLawType`): "new_15" (15d first year) vs "legacy_21" (Old Labor Law: 21d first year)
 * - System Attendance Start Date (`attendanceStartDate`): when MFT begins counting expected workdays/absences
 * - Hourly Rate (`hourlyRate`) & Monthly Salary (`expectedSalary`) with 1-click auto-calculation
 * - Prior Used Leave (`priorUsedLeaveDays`) & Approved Carry-Over (`carriedOverLeaveDays`)
 */
export default function WorkerLeaveProfileCard({ worker, adminEmail = "admin", onSaved }: Props) {
  const { isAr, dir, t } = useHrLang();
  const [settings, setSettings] = useState<HrSettings>(DEFAULT_HR_SETTINGS);
  const [hireDate, setHireDate] = useState(worker.hireDate ?? "");
  const [attendanceStartDate, setAttendanceStartDate] = useState(worker.attendanceStartDate ?? "");
  const [leaveLawType, setLeaveLawType] = useState<LeaveLawType>(worker.leaveLawType === "legacy_21" ? "legacy_21" : "new_15");
  const [hourlyRate, setHourlyRate] = useState<number>(worker.hourlyRate ?? 31.25);
  const [monthlySalary, setMonthlySalary] = useState<string>(
    worker.expectedSalary != null ? String(worker.expectedSalary) : String(Math.round((worker.hourlyRate ?? 31.25) * 192)),
  );
  const [priorUsed, setPriorUsed] = useState<number>(worker.priorUsedLeaveDays ?? 0);
  const [carry, setCarry] = useState<number>(worker.carriedOverLeaveDays ?? 0);
  const [approvedBy, setApprovedBy] = useState(worker.carryOverApprovedBy ?? adminEmail);
  const [saving, setSaving] = useState(false);

  useEffect(() => subscribeHrSettings(setSettings), []);
  useEffect(() => {
    setHireDate(worker.hireDate ?? "");
    setAttendanceStartDate(worker.attendanceStartDate ?? "");
    setLeaveLawType(worker.leaveLawType === "legacy_21" ? "legacy_21" : "new_15");
    setHourlyRate(worker.hourlyRate ?? 31.25);
    setMonthlySalary(
      worker.expectedSalary != null ? String(worker.expectedSalary) : String(Math.round((worker.hourlyRate ?? 31.25) * 192)),
    );
    setPriorUsed(worker.priorUsedLeaveDays ?? 0);
    setCarry(worker.carriedOverLeaveDays ?? 0);
    setApprovedBy(worker.carryOverApprovedBy || adminEmail);
  }, [
    worker.id,
    worker.hireDate,
    worker.attendanceStartDate,
    worker.leaveLawType,
    worker.hourlyRate,
    worker.expectedSalary,
    worker.priorUsedLeaveDays,
    worker.carriedOverLeaveDays,
    worker.carryOverApprovedBy,
    adminEmail,
  ]);

  const todayYmd = ymd(new Date());
  const fallback = worker.createdAt?.toDate ? ymd(worker.createdAt.toDate()) : "";
  const effectiveHire = hireDate || fallback;
  const preview = useMemo(() => {
    if (!effectiveHire) return null;
    return computeLeaveAccrual(
      effectiveHire,
      new Date(),
      {
        leaveLawType,
        carriedOverApproved: carry,
        priorUsedLeaveDays: priorUsed,
        priorUsedAsOf: priorUsedRecordedOn({ attendanceStartDate }, settings),
      },
      policyConfigFromSettings(settings),
    );
  }, [effectiveHire, leaveLawType, carry, priorUsed, attendanceStartDate, settings]);

  const dirty =
    hireDate !== (worker.hireDate ?? "") ||
    attendanceStartDate !== (worker.attendanceStartDate ?? "") ||
    leaveLawType !== (worker.leaveLawType === "legacy_21" ? "legacy_21" : "new_15") ||
    hourlyRate !== (worker.hourlyRate ?? 31.25) ||
    monthlySalary !== (worker.expectedSalary != null ? String(worker.expectedSalary) : String(Math.round((worker.hourlyRate ?? 31.25) * 192))) ||
    priorUsed !== (worker.priorUsedLeaveDays ?? 0) ||
    carry !== (worker.carriedOverLeaveDays ?? 0) ||
    approvedBy !== (worker.carryOverApprovedBy || adminEmail);

  const save = async () => {
    if (carry > 0 && !approvedBy.trim()) {
      toast.warning(
        t(
          "ترحيل الإجازات يتطلب كتابة اسم المدير المعتمد (البند 14).",
          "Carry-over requires the approving manager's name (V2.0 clause 14).",
        ),
      );
      return;
    }
    setSaving(true);
    try {
      await saveWorkerLeaveProfile(worker.id, {
        hireDate: hireDate || null,
        attendanceStartDate: attendanceStartDate || null,
        leaveLawType,
        hourlyRate: Number.isFinite(hourlyRate) && hourlyRate > 0 ? hourlyRate : 31.25,
        expectedSalary: monthlySalary ? Number(monthlySalary) || monthlySalary : null,
        priorUsedLeaveDays: priorUsed,
        carriedOverLeaveDays: carry,
        carryOverApprovedBy: approvedBy.trim() || adminEmail,
      });
      void logActivity({
        action: "updated",
        entity: "worker",
        entityId: worker.id,
        label: `Contract & leave profile updated for ${`${worker.firstName ?? ""} ${worker.lastName ?? ""}`.trim()} (joined ${hireDate || "—"}, law ${leaveLawType}, system start ${attendanceStartDate || "auto"}, rate ${hourlyRate} EGP/h)`,
      });
      toast.success(t("تم حفظ بيانات التعيين والراتب ورصيد الإجازات بنجاح", "Contract, rate & leave profile saved"));
      onSaved?.();
    } catch (e) {
      toast.error(t("تعذر الحفظ", "Could not save"), { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div dir={dir} className="border-2 border-zinc-900 dark:border-zinc-700 p-4 bg-white dark:bg-zinc-900 rounded-lg space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 dark:border-zinc-800 pb-2.5">
        <div>
          <h4 className="font-bold text-xs uppercase text-zinc-950 dark:text-white flex items-center gap-2">
            <span>🗓️</span>
            <span>
              {t(
                "ضبط تاريخ التعيين والراتب ورصيد الإجازات (HR-POL-2026)",
                "Company Joining Date, Rate & Leave Onboarding (HR-POL-2026)",
              )}
            </span>
          </h4>
          <p className="text-[11px] text-zinc-500 mt-0.5">
            {t(
              "افصل بين تاريخ التحاق الموظف بالشركة (لحساب الإجازات وفترة الاختبار) وتاريخ بدء استخدامه للنظام (لمنع خصم غياب عن الأيام السابقة).",
              "Separate when the worker joined the company (for leave & probation) from when they started on MFT (so past days aren't marked absent).",
            )}
          </p>
        </div>
        {preview && (
          <span className="px-2.5 py-1 rounded bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-[11px] font-bold">
            {isAr ? leavePhaseLabelAr(preview) : leavePhaseLabelEn(preview)} ·{" "}
            {isAr ? `${preview.serviceMonths} شهر خدمة` : `${preview.serviceMonths} mo tenure`}
          </span>
        )}
      </div>

      {/* Quick Tenure Presets for Existing Workers */}
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] bg-zinc-50 dark:bg-zinc-800/50 p-2.5 rounded border border-zinc-200 dark:border-zinc-700">
        <span className="font-bold text-zinc-600 dark:text-zinc-300">
          {t("⚡ اختصارات سريعة لتاريخ التعيين:", "⚡ Quick tenure presets:")}
        </span>
        {[
          { ar: "تعيين جديد (اليوم)", en: "New Hire (Today)", hire: todayYmd, sys: todayYmd },
          { ar: "اجتاز الاختبار (منذ 6 أشهر)", en: "Passed Probation (6m ago)", hire: shiftDateMonths(6), sys: todayYmd },
          { ar: "خبرة سنة (شريحة 15 يوم)", en: "1 Year (15d tier)", hire: shiftDateMonths(12), sys: todayYmd },
          { ar: "خبرة سنتين+ (شريحة 21 يوم)", en: "2+ Years (21d tier)", hire: shiftDateMonths(24), sys: todayYmd },
        ].map((p) => (
          <button
            key={p.en}
            type="button"
            onClick={() => {
              setHireDate(p.hire);
              if (!attendanceStartDate) setAttendanceStartDate(p.sys);
            }}
            className="px-2.5 py-1 border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-red-600 hover:text-white hover:border-red-600 font-bold rounded cursor-pointer transition-colors"
          >
            {isAr ? p.ar : p.en}
          </button>
        ))}
      </div>

      {/* Row 1: Joining Date & System Attendance Start Date */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
        <label className="block p-3 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded">
          <span className="text-zinc-800 dark:text-zinc-200 font-bold flex items-center justify-between">
            <span>{t("١. تاريخ التعيين الفعلي بالشركة", "1. Company Joining Date")}</span>
            <span className="text-[10px] font-normal text-red-600">
              {t("للإجازات وفترة الاختبار", "Leave & Probation")}
            </span>
          </span>
          <input
            type="date"
            id={`worker-hire-date-${worker.id}`}
            value={hireDate}
            onChange={(e) => setHireDate(e.target.value)}
            className="mt-1.5 w-full bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-700 px-2.5 py-1.5 font-bold rounded focus:outline-none focus:ring-2 focus:ring-red-600"
          />
          {!hireDate && fallback ? (
            <span className="block mt-1 text-[10px] text-amber-600 font-medium">
              {t(
                `⚠ غير محدد — يُستخدم مؤقتًا تاريخ إنشاء الحساب (${fallback}). حدد تاريخ التعيين الحقيقي للموظف القديم.`,
                `⚠ Not set — falling back to sign-up date (${fallback}). Set the real contract date for existing staff!`,
              )}
            </span>
          ) : (
            <span className="block mt-1 text-[10px] text-zinc-500">
              {t(
                "تاريخ بداية عمل الموظف في الشركة (حتى لو كان قبل إطلاق هذا النظام بسنوات).",
                "Original date the worker started with the company (even if before this software).",
              )}
            </span>
          )}
        </label>

        <label className="block p-3 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded">
          <span className="text-zinc-800 dark:text-zinc-200 font-bold flex items-center justify-between">
            <span>{t("٢. تاريخ بدء حساب الحضور بالنظام", "2. System Attendance Start Date")}</span>
            <button
              type="button"
              onClick={() => setAttendanceStartDate(todayYmd)}
              className="text-[10px] text-emerald-700 dark:text-emerald-400 underline cursor-pointer font-bold"
            >
              {t(`اجعله اليوم (${todayYmd})`, `Set to Today (${todayYmd})`)}
            </button>
          </span>
          <input
            type="date"
            id={`worker-attendance-start-${worker.id}`}
            value={attendanceStartDate}
            onChange={(e) => setAttendanceStartDate(e.target.value)}
            className="mt-1.5 w-full bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-700 px-2.5 py-1.5 font-bold rounded focus:outline-none focus:ring-2 focus:ring-red-600"
          />
          <span className="block mt-1 text-[10px] text-zinc-500">
            {t(
              "لن يقوم النظام بخصم أي أيام غياب قبل هذا التاريخ عند حساب المرتب.",
              "Payroll will NOT charge absence penalties for any days before this date.",
            )}
          </span>
        </label>
      </div>

      {/* Row 1.5: Labor Law Option for First-Year Annual Leave (15 days vs Old Labor Law 21 days) */}
      <div className="p-3 bg-sky-50/50 dark:bg-sky-950/20 border border-sky-200 dark:border-sky-900 rounded space-y-2 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-zinc-900 dark:text-zinc-100 font-bold">
            {t("⚖️ نظام قانون العمل للإجازة السنوية (أول سنة):", "⚖️ Labor Law Entitlement Mode (First Year):")}
          </span>
          <span className="text-[10px] text-sky-700 dark:text-sky-300 font-bold">
            {leaveLawType === "legacy_21"
              ? t("قانون عمل قديم: 21 يوم من أول سنة (1.75 يوم/شهر)", "Old Labor Law: 21 days from Year 1 (1.75d/mo)")
              : t("قانون العمل الجديد: 15 يوم أول سنة ثم 21 يوم", "New Law: 15 days in Year 1, then 21 days")}
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => setLeaveLawType("new_15")}
            className={`text-start p-2.5 rounded border-2 transition-all cursor-pointer ${
              leaveLawType === "new_15"
                ? "border-red-600 bg-red-50/70 dark:bg-red-950/30 text-zinc-950 dark:text-white shadow-[2px_2px_0px_0px_#dc2626]"
                : "border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:border-zinc-500"
            }`}
          >
            <div className="font-bold flex items-center justify-between">
              <span>{t("📋 قانون العمل الجديد (15 يوم أول سنة)", "📋 Standard Law (15 days in Year 1)")}</span>
              {leaveLawType === "new_15" && <span className="text-red-600 font-black">✓</span>}
            </div>
            <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1">
              {t(
                "بعد أول 6 شهور ينزل 7.5 يوم، ويكمل 15 يوم بنهاية أول سنة (1.25/شهر)، ثم يرتفع إلى 21 يوم بعد السنة الأولى (1.75/شهر).",
                "After 6 months drops 7.5d, reaches 15d at end of Year 1 (1.25d/mo), then rises to 21d/yr after Year 1 (1.75d/mo).",
              )}
            </p>
          </button>

          <button
            type="button"
            onClick={() => setLeaveLawType("legacy_21")}
            className={`text-start p-2.5 rounded border-2 transition-all cursor-pointer ${
              leaveLawType === "legacy_21"
                ? "border-red-600 bg-red-50/70 dark:bg-red-950/30 text-zinc-950 dark:text-white shadow-[2px_2px_0px_0px_#dc2626]"
                : "border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:border-zinc-500"
            }`}
          >
            <div className="font-bold flex items-center justify-between">
              <span>{t("⚖️ قانون عمل قديم (21 يوم أول سنة بدل 15)", "⚖️ Old Labor Law (21 days in Year 1 instead of 15)")}</span>
              {leaveLawType === "legacy_21" && <span className="text-red-600 font-black">✓</span>}
            </div>
            <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1">
              {t(
                "ينزل 21 يوم من أول سنة بدل 15 (بعد أول 6 شهور ينزل 10.5 يوم، ويكمل 21 يوم بنهاية أول سنة بمعدل 1.75 يوم/شهر).",
                "Grants 21 days in Year 1 instead of 15 (after 6 months drops 10.5d, reaches 21d at end of Year 1 at 1.75d/mo).",
              )}
            </p>
          </button>
        </div>
      </div>

      {/* Row 2: Compensation (Hourly Rate & Monthly Salary) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs p-3 bg-emerald-50/40 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900 rounded">
        <label className="block">
          <span className="text-zinc-800 dark:text-zinc-200 font-bold flex items-center justify-between">
            <span>{t("٣. أجر الساعة (ج.م / ساعة)", "3. Hourly Rate (EGP / hour)")}</span>
            <span className="text-[10px] text-emerald-700 dark:text-emerald-400">
              {t(`الراتب التقديري (192 س): ${Math.round(hourlyRate * 192)} ج.م`, `~EGP ${Math.round(hourlyRate * 192)} / mo`)}
            </span>
          </span>
          <input
            type="number"
            min={1}
            step={0.25}
            value={hourlyRate}
            onChange={(e) => {
              const r = Math.max(0, parseFloat(e.target.value) || 0);
              setHourlyRate(r);
              setMonthlySalary(String(Math.round(r * 192)));
            }}
            className="mt-1 w-full bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-700 px-2.5 py-1.5 font-bold rounded focus:outline-none focus:ring-2 focus:ring-red-600"
          />
          <span className="text-[10px] text-zinc-500">
            {t("يُستخدم في حساب الراتب الأساسي والإضافي والخصومات", "Used to calculate base pay, overtime, and deductions")}
          </span>
        </label>

        <label className="block">
          <span className="text-zinc-800 dark:text-zinc-200 font-bold flex items-center justify-between">
            <span>{t("٤. الراتب الشهري المتفق عليه (ج.م)", "4. Monthly Salary (EGP - 24d × 8h)")}</span>
            <button
              type="button"
              onClick={() => {
                const sal = parseFloat(monthlySalary) || 0;
                if (sal > 0) setHourlyRate(Math.round((sal / 192) * 100) / 100);
              }}
              className="text-[10px] text-emerald-700 dark:text-emerald-400 underline cursor-pointer font-bold"
            >
              {t("احسب أجر الساعة تلقائيًا", "Auto-calc hourly rate")}
            </button>
          </span>
          <input
            type="number"
            min={0}
            step={100}
            value={monthlySalary}
            onChange={(e) => {
              const val = e.target.value;
              setMonthlySalary(val);
              const sal = parseFloat(val) || 0;
              if (sal > 0) setHourlyRate(Math.round((sal / 192) * 100) / 100);
            }}
            className="mt-1 w-full bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-700 px-2.5 py-1.5 font-bold rounded focus:outline-none focus:ring-2 focus:ring-red-600"
          />
          <span className="text-[10px] text-zinc-500">
            {t("اكتب الراتب الشهري ليتم حساب أجر الساعة (الراتب ÷ 192 ساعة)", "Type monthly salary to auto-compute hourly rate (÷ 192h)")}
          </span>
        </label>
      </div>

      {/* Row 3: Prior Used Leave & Carry-Over */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
        <label className="block">
          <span className="text-zinc-700 dark:text-zinc-300 font-bold">
            {t("٥. إجازات مستهلكة قبل النظام (أيام)", "5. Leave Used Before System (days)")}
          </span>
          <input
            type="number"
            min={0}
            step={0.5}
            value={priorUsed}
            onChange={(e) => setPriorUsed(Math.max(0, parseFloat(e.target.value) || 0))}
            className="mt-1 w-full bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-700 px-2.5 py-1.5 font-bold rounded focus:outline-none focus:ring-2 focus:ring-red-600"
          />
          <span className="text-[10px] text-zinc-400">
            {t("تُخصم من الرصيد المتراكم للموظف القديم", "Deducted from accrued leave for existing staff")}
          </span>
        </label>
        <label className="block">
          <span className="text-zinc-700 dark:text-zinc-300 font-bold">
            {t("٦. الرصيد المُرحّل والمُعتمد من الإدارة (أيام)", "6. Approved Carry-Over Balance (days)")}
          </span>
          <input
            type="number"
            min={0}
            step={0.5}
            value={carry}
            onChange={(e) => setCarry(Math.max(0, parseFloat(e.target.value) || 0))}
            className="mt-1 w-full bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-700 px-2.5 py-1.5 font-bold rounded focus:outline-none focus:ring-2 focus:ring-red-600"
          />
          <span className="text-[10px] text-zinc-400">
            {t("يُضاف إلى الرصيد المُرحّل قانونياً واستحقاق ما بعد السنة الأولى", "Added to legally carried-over & post-Year-1 balance")}
          </span>
        </label>
        <label className="block">
          <span className="text-zinc-700 dark:text-zinc-300 font-bold">
            {t("٧. اعتمد الترحيل بواسطة", "7. Carry-Over Approved By")}
          </span>
          <input
            type="text"
            value={approvedBy}
            placeholder={t("اسم المدير المعتمد", "Manager name")}
            onChange={(e) => setApprovedBy(e.target.value)}
            className="mt-1 w-full bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-700 px-2.5 py-1.5 font-bold rounded focus:outline-none focus:ring-2 focus:ring-red-600"
          />
        </label>
      </div>

      {/* Live Preview & Save Footer */}
      <div className="pt-3 border-t border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-3">
        {preview ? (
          <div className="text-[11px] text-zinc-600 dark:text-zinc-300 space-y-0.5">
            <p>
              {t("نهاية فترة الاختبار:", "Probation ends:")} <strong>{preview.probationEndsOn}</strong> ·{" "}
              {t("استحقاق ما بعد السنة الأولى (21 يوم / 1.75 شهرياً):", "Post-Year 1 (21d / 1.75/mo) from:")}{" "}
              <strong>{preview.tier2StartsOn}</strong>
            </p>
            <p>
              {t("المتراكم:", "Accrued:")} <strong>{preview.accruedDays}d ({preview.monthlyRate}/mo)</strong>
              {preview.totalCarryOverDays > 0 ? (
                <>
                  {" "}
                  + {t("مُرحّل قانونياً ومعتمد:", "Carried over (legal + approved):")}{" "}
                  <strong>
                    {preview.totalCarryOverDays}d ({preview.legalCarryOverDays}d + {preview.carriedOverApproved}d)
                  </strong>
                </>
              ) : null}
              {priorUsed > 0 ? <> − {t("مستهلك سابقًا:", "Prior used:")} <strong>{priorUsed}d</strong></> : null}
              {" = "}
              <strong className="text-emerald-700 dark:text-emerald-400">
                {t(`الرصيد الصافي المتاح: ${preview.balance} يوم`, `${preview.balance}d net available balance`)}
              </strong>
            </p>
          </div>
        ) : (
          <p className="text-[11px] text-zinc-400">
            {t("حدد تاريخ التعيين بالشركة لحساب رصيد الإجازات تلقائيًا.", "Set a company joining date to calculate leave accrual.")}
          </p>
        )}
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={() => void save()}
          className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-mono text-xs font-bold uppercase border-2 border-zinc-900 shadow-[2px_2px_0px_0px_#09090b] rounded cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving
            ? t("جارٍ الحفظ…", "Saving…")
            : t("حفظ بيانات الموظف والإجازات ✓", "Save Worker & Leave Profile ✓")}
        </button>
      </div>
    </div>
  );
}
