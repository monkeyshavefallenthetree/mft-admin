"use client";

import { s, ar, cx, Icon, LAB_ICONS } from "./ui";
import type { EarlyLeaveEvaluation } from "@/lib/admin/hrPolicy2026";

/**
 * Smart clock-out alert (HR-POL-2026 clause 3):
 * "متبقي X دقيقة على نهاية الشيفت؛ هل تريد استهلاك إذن انصراف مبكر؟"
 */
export default function SmartClockOutModal({
  evaluation,
  requiredEndHm,
  hourlyRate,
  onUsePermission,
  onBreak,
  onLeaveWithDeduction,
  onStay,
}: {
  evaluation: EarlyLeaveEvaluation;
  requiredEndHm: string;
  hourlyRate: number;
  onUsePermission: () => void;
  onBreak: () => void;
  onLeaveWithDeduction: () => void;
  onStay: () => void;
}) {
  const mins = evaluation.remainingMinutes;
  const hh = Math.floor(mins / 60);
  const mm = mins % 60;
  const deduction = Math.round((evaluation.payrollDeductionMinutes / 60) * hourlyRate * 100) / 100;
  const deductionIfLeave = Math.round((mins / 60) * hourlyRate * 100) / 100;

  return (
    <div className={cx(s.vars, s.backdrop)} onMouseDown={(e) => e.target === e.currentTarget && onStay()} dir="rtl">
      <div className={s.modal} role="dialog" aria-modal="true" aria-labelledby="smart-clockout-title" id="smart-clockout-modal">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <span className={cx(s.pill, evaluation.canUsePermission ? s.pWarn : s.pBad)}>
            <Icon d={LAB_ICONS.warn} size={13} /> انصراف قبل نهاية الشيفت
          </span>
          <button type="button" className={s.btnGhost} style={{ padding: 6 }} onClick={onStay} aria-label="إغلاق" id="smart-clockout-close">
            <Icon d={LAB_ICONS.close} size={16} />
          </button>
        </div>

        <div style={{ textAlign: "center", margin: "20px 0 8px" }}>
          <div className={cx(s.countdown, s.mono)}>
            {ar(String(hh).padStart(2, "0"))}:{ar(String(mm).padStart(2, "0"))}
          </div>
          <p className={s.small} style={{ marginTop: 6 }}>
            نهاية الشيفت المطلوبة <b className={s.mono}>{ar(requiredEndHm)}</b>
          </p>
        </div>

        <h3 id="smart-clockout-title" style={{ fontSize: 16.5, fontWeight: 700, lineHeight: 1.8, textAlign: "center" }}>
          متبقي {ar(mins)} دقيقة على نهاية الشيفت؛ هل تريد استهلاك إذن انصراف مبكر؟
        </h3>

        {!evaluation.canUsePermission && (
          <div className={cx(s.result, s.bad)} style={{ marginTop: 14, fontSize: 13 }}>
            {evaluation.messageAr}
            <div style={{ marginTop: 6, fontWeight: 700 }}>الخصم المتوقع: {ar(deduction.toFixed(2))} ج.م</div>
          </div>
        )}

        <div style={{ display: "grid", gap: 10, marginTop: 18 }}>
          <button type="button" id="smart-clockout-use-permission" className={cx(s.option, s.optionPrimary)} disabled={!evaluation.canUsePermission} onClick={onUsePermission}>
            <span className={s.optIcon} style={{ color: "#34d399" }}><Icon d={LAB_ICONS.check} /></span>
            <span style={{ flex: 1 }}>
              <b style={{ display: "block", fontSize: 14 }}>نعم، استخدم إذن انصراف مبكر</b>
              <span className={s.small}>
                {evaluation.canUsePermission
                  ? `يُخصم ${ar(evaluation.chargedMinutes)} دقيقة من رصيدك — المتبقي بعده ${ar(evaluation.remainingAfter.count)} أذونات / ${ar(evaluation.remainingAfter.minutes)} دقيقة`
                  : "غير متاح حاليًا"}
              </span>
            </span>
          </button>
          <button type="button" id="smart-clockout-break" className={s.option} onClick={onBreak}>
            <span className={s.optIcon} style={{ color: "#38bdf8" }}><Icon d={LAB_ICONS.coffee} /></span>
            <span style={{ flex: 1 }}>
              <b style={{ display: "block", fontSize: 14 }}>استراحة — سأعود</b>
              <span className={s.small}>إيقاف مؤقت بدون استهلاك إذن؛ يجب استكمال الساعات قبل نهاية اليوم.</span>
            </span>
          </button>
          <button type="button" id="smart-clockout-leave-deduction" className={cx(s.option, s.optionDanger)} onClick={onLeaveWithDeduction}>
            <span className={s.optIcon} style={{ color: "#f87171" }}><Icon d={LAB_ICONS.exit} /></span>
            <span style={{ flex: 1 }}>
              <b style={{ display: "block", fontSize: 14 }}>انصراف بدون إذن</b>
              <span className={s.small}>خصم مباشر من الراتب ≈ {ar(deductionIfLeave.toFixed(2))} ج.م ({ar(mins)} دقيقة)</span>
            </span>
          </button>
          <button type="button" id="smart-clockout-stay" className={s.btnGhost} onClick={onStay} style={{ marginTop: 4 }}>
            البقاء في العمل
          </button>
        </div>
      </div>
    </div>
  );
}
