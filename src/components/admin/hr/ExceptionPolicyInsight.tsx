"use client";

import {
  chargeableMinutes,
  computeLeaveAccrual,
  leavePhaseLabelAr,
  parseHm,
  formatHm,
  splitOvertimePay,
  toArabicDigits,
  validateLeaveRequest,
  validatePermissionRequest,
  priorUsedRecordedOn,
  ymd,
  type CycleUsage,
  type LeaveLawType,
  type Policy2026Config,
} from "@/lib/admin/hrPolicy2026";

export interface InsightWorker {
  id: string;
  hireDate?: string;
  attendanceStartDate?: string;
  leaveLawType?: LeaveLawType;
  priorUsedLeaveDays?: number;
  carriedOverLeaveDays?: number;
  hourlyRate?: number;
  createdAt?: { toDate: () => Date };
}

export interface InsightRequest {
  id: string;
  workerId?: string;
  type?: string;
  status?: string;
  exceptionDate?: string;
  endDate?: string;
  lateMinutes?: number;
  leaveDays?: number;
}

/** Days requested by an annual-leave request (defaults to 1 for legacy requests). */
export function leaveDaysOf(r: InsightRequest): number {
  return Number(r.leaveDays) > 0 ? Number(r.leaveDays) : 1;
}

/**
 * Validates an annual-leave request against the worker's live HR-POL-2026 balance.
 * Other approved annual-leave requests are deducted first.
 */
export function checkAnnualLeave(
  req: InsightRequest,
  worker: InsightWorker | undefined,
  all: InsightRequest[],
  cfg: Policy2026Config,
  policyEffectiveFrom?: string,
) {
  const hire = worker?.hireDate || (worker?.createdAt?.toDate ? ymd(worker.createdAt.toDate()) : "");
  if (!hire) return null;
  const usedLeave = all
    .filter(
      (r) =>
        r.id !== req.id &&
        r.workerId === req.workerId &&
        (r.type === "annual_leave" || r.type === "emergency_leave") &&
        r.status === "approved" &&
        r.exceptionDate,
    )
    .map((r) => ({ date: r.exceptionDate as string, days: leaveDaysOf(r) }));
  const asOf = req.exceptionDate ? new Date(req.exceptionDate + "T12:00:00") : new Date();
  const accrual = computeLeaveAccrual(
    hire,
    asOf,
    {
      leaveLawType: worker?.leaveLawType,
      usedLeave,
      carriedOverApproved: worker?.carriedOverLeaveDays ?? 0,
      priorUsedLeaveDays: worker?.priorUsedLeaveDays ?? 0,
      priorUsedAsOf: priorUsedRecordedOn(worker, { policy2026EffectiveFrom: policyEffectiveFrom }),
    },
    cfg,
  );
  const verdict = validateLeaveRequest(accrual, leaveDaysOf(req));
  return { accrual, verdict, hireIsFallback: !worker?.hireDate };
}

/**
 * Validates a monthly permission request (advance_late or early_permission) against the worker's
 * approved permissions in the same calendar month (4 permissions / 240 mins cap, 30–120 mins each).
 */
export function checkMonthlyPermission(
  req: InsightRequest,
  all: InsightRequest[],
  cfg: Policy2026Config,
) {
  const targetYm = (req.exceptionDate || ymd(new Date())).slice(0, 7);
  const approvedInMonth = all.filter(
    (r) =>
      r.id !== req.id &&
      r.workerId === req.workerId &&
      (r.type === "advance_late" || r.type === "early_permission") &&
      r.status === "approved" &&
      (r.exceptionDate || "").slice(0, 7) === targetYm,
  );
  const usage: CycleUsage = {
    count: approvedInMonth.length,
    minutes: approvedInMonth.reduce((sum, r) => sum + chargeableMinutes(Number(r.lateMinutes) || 30, cfg), 0),
  };
  const requestedMins = Number(req.lateMinutes) || 30;
  const verdict = validatePermissionRequest(requestedMins, usage, cfg);
  return { usage, verdict };
}

export default function ExceptionPolicyInsight({
  req,
  worker,
  all,
  cfg,
  defaultHourlyRate,
  policyEffectiveFrom,
}: {
  req: InsightRequest;
  worker: InsightWorker | undefined;
  all: InsightRequest[];
  cfg: Policy2026Config;
  defaultHourlyRate: number;
  policyEffectiveFrom?: string;
}) {
  if (req.type === "annual_leave" || req.type === "emergency_leave") {
    const res = checkAnnualLeave(req, worker, all, cfg, policyEffectiveFrom);
    if (!res) return null;
    const { accrual, verdict } = res;
    return (
      <div
        className={`mt-3 rounded-lg border px-3 py-2.5 text-xs ${
          verdict.ok ? "border-emerald-200 bg-emerald-50/60" : "border-red-200 bg-red-50/70"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold text-zinc-800">
            HR-POL-2026 leave check · {req.exceptionDate} → {req.endDate || req.exceptionDate} ({leaveDaysOf(req)} day(s))
          </span>
          <span dir="rtl" className="rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-[10px] font-bold">
            {leavePhaseLabelAr(accrual)}
          </span>
        </div>
        <p className="mt-1 text-zinc-600">
          Balance on {accrual.asOf}: <strong>{accrual.balance}d</strong> (requestable {accrual.requestableDays}d) · accrued{" "}
          {accrual.accruedDays}d ({accrual.monthlyRate}d/mo · {accrual.annualEntitlementDays}d/yr) · carried-over &amp; approved{" "}
          <strong>+{accrual.totalCarryOverDays}d</strong> (legal {accrual.legalCarryOverDays}d + approved {accrual.carriedOverApproved}d) · used{" "}
          {accrual.usedDays}d · probation ends {accrual.probationEndsOn}
          {res.hireIsFallback && <span className="text-amber-600"> · ⚠ hire date not set (using sign-up date)</span>}
        </p>
        {!verdict.ok && (
          <p dir="rtl" className="mt-1 font-semibold text-red-700">
            {verdict.reasonAr}
          </p>
        )}
      </div>
    );
  }

  if (req.type === "unpaid_leave") {
    return (
      <div className="mt-3 rounded-lg border border-teal-200 bg-teal-50/70 px-3 py-2.5 text-xs text-teal-900">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold">
            📅 Unpaid Leave (إجازة بدون مرتب) · {req.exceptionDate} → {req.endDate || req.exceptionDate} ({leaveDaysOf(req)} day(s))
          </span>
        </div>
      </div>
    );
  }

  if (req.type === "advance_late" || req.type === "early_permission") {
    const { usage, verdict } = checkMonthlyPermission(req, all, cfg);
    const isEarly = req.type === "early_permission";
    return (
      <div
        className={`mt-3 rounded-lg border px-3 py-2.5 text-xs ${
          verdict.ok
            ? "border-violet-200 bg-violet-50/70 text-violet-900"
            : "border-red-200 bg-red-50/80 text-red-900"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold">
            ⏱️ {isEarly ? "Early Leave Permission (إذن انصراف مبكر)" : "Late Permission (إذن تأخير شهري)"} ·{" "}
            {verdict.chargedMinutes} min (requested {req.lateMinutes || 30} min) on {req.exceptionDate || "target date"}
          </span>
          <span dir="rtl" className="rounded border border-violet-300 bg-white px-2 py-0.5 text-[10px] font-bold text-violet-800">
            المتبقي قبل الاعتماد: {toArabicDigits(verdict.remainingCount)} من {toArabicDigits(cfg.permissionMaxCount)} أذونات ·{" "}
            {toArabicDigits(verdict.remainingMinutes)} د
          </span>
        </div>
        {verdict.ok ? (
          <p className="mt-1 text-violet-800" dir="rtl">
            عند موافقة الأدمن، يُعتمد الإذن ({toArabicDigits(verdict.chargedMinutes)} دقيقة) ويُخصم من رصيد الأذونات الشهري للموظف (المستخدم حالياً: {toArabicDigits(usage.count)} أذونات / {toArabicDigits(usage.minutes)} د).
          </p>
        ) : (
          <p className="mt-1 font-bold text-red-700" dir="rtl">
            ❌ {verdict.reasonAr}
          </p>
        )}
      </div>
    );
  }

  if (req.type === "overtime" && Number(req.lateMinutes) > 0) {
    const rate = worker?.hourlyRate || defaultHourlyRate;
    const latestEnd = parseHm(cfg.lateCutoffTime) + Math.round(cfg.standardHours * 60);
    const d = req.exceptionDate ? new Date(req.exceptionDate + "T00:00:00") : new Date();
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, latestEnd);
    const est = splitOvertimePay(start, Number(req.lateMinutes), rate, cfg);
    return (
      <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50/60 px-3 py-2.5 text-xs text-zinc-700">
        <span className="font-semibold text-zinc-800">Estimated payout (HR-POL-2026)</span> · starting {formatHm(latestEnd)} after the
        shift: day {est.dayMinutes}m × {cfg.dayOtMultiplier} = EGP {est.dayPay} · night {est.nightMinutes}m × {cfg.nightOtMultiplier} = EGP{" "}
        {est.nightPay}
        {est.nightAllowance > 0 && ` · night allowance EGP ${est.nightAllowance}`} → <strong>EGP {est.total}</strong>
        <span className="block text-[10px] text-zinc-500">
          Paid only for minutes actually worked after the required shift end, capped at the approved {req.lateMinutes} min.
        </span>
      </div>
    );
  }
  return null;
}
