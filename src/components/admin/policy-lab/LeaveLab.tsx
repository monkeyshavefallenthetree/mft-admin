"use client";

import { useMemo, useState } from "react";
import {
  computeLeaveAccrual,
  LEAVE_PHASE_AR,
  parseYmd,
  validateLeaveRequest,
  ymd,
  type Policy2026Config,
} from "@/lib/admin/hrPolicy2026";
import { s, ar, cx, Panel, Stat } from "./ui";

function defaultHire(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 10);
  return ymd(d);
}

export default function LeaveLab({ cfg }: { cfg: Policy2026Config }) {
  const [hire, setHire] = useState(defaultHire);
  const [asOf, setAsOf] = useState(() => ymd(new Date()));
  const [used, setUsed] = useState(0);
  const [carried, setCarried] = useState(0);
  const [req, setReq] = useState(2);

  const acc = useMemo(() => {
    const asOfDate = parseYmd(asOf) ?? new Date();
    return computeLeaveAccrual(hire, asOfDate, { usedLeave: used > 0 ? [{ date: hire, days: used }] : [], carriedOverApproved: carried }, cfg);
  }, [hire, asOf, used, carried, cfg]);

  const verdict = validateLeaveRequest(acc, req);
  const prob = cfg.probationMonths;
  const y1End = Math.max(prob, cfg.year1AccrualMonths);
  const span = Math.max(36, acc.serviceMonths + 6);
  const pct = (m: number) => `${Math.min(100, (m / span) * 100)}%`;
  const phaseTone = acc.phase === "probation" ? s.pWarn : acc.phase === "year1" ? s.pInfo : s.pOk;

  return (
    <div className={s.grid}>
      <Panel id="lab-leave" title="حاسبة الإجازات السنوية" hint={`أول ${ar(prob)} أشهر اختبار · بعد إتمام ${ar(prob)} أشهر ينزل ٧٫٥ يوم ثم ${ar(cfg.leaveRateYear1)} يوم/شهر ليكتمل ١٥ يوماً بنهاية السنة الأولى · ما بعد السنة الأولى: ٢١ يوماً في السنة (بواقع ${ar(cfg.leaveRateYear2)} يوم شهرياً) + الرصيد المُرحّل قانونياً والمُعتمد من الإدارة.`} tag={<span className={cx(s.pill, phaseTone)}>{LEAVE_PHASE_AR[acc.phase]}</span>}>
        <div className={s.grid3}>
          <div>
            <label className={s.label} htmlFor="lab-leave-hire">تاريخ التعيين</label>
            <input id="lab-leave-hire" type="date" className={cx(s.input, s.mono)} value={hire} onChange={(e) => setHire(e.target.value)} />
          </div>
          <div>
            <label className={s.label} htmlFor="lab-leave-asof">حتى تاريخ</label>
            <input id="lab-leave-asof" type="date" className={cx(s.input, s.mono)} value={asOf} onChange={(e) => setAsOf(e.target.value)} />
          </div>
          <div>
            <label className={s.label} htmlFor="lab-leave-used">أيام مستخدمة</label>
            <input id="lab-leave-used" type="number" min={0} step={0.5} className={cx(s.input, s.mono)} value={used} onChange={(e) => setUsed(Math.max(0, Number(e.target.value) || 0))} />
          </div>
          <div>
            <label className={s.label} htmlFor="lab-leave-carried">الرصيد المُرحّل والمُعتمد من الإدارة</label>
            <input id="lab-leave-carried" type="number" min={0} step={0.5} className={cx(s.input, s.mono)} value={carried} onChange={(e) => setCarried(Math.max(0, Number(e.target.value) || 0))} />
          </div>
        </div>

        <div style={{ marginTop: 18 }}>
          <div className={s.timeline} dir="ltr">
            <div className={s.tlSeg} style={{ insetInlineStart: 0, width: pct(prob), background: "linear-gradient(135deg, rgba(245,185,66,.55), rgba(245,158,11,.35))" }}>اختبار → +٧٫٥</div>
            <div className={s.tlSeg} style={{ insetInlineStart: pct(prob), width: `calc(${pct(y1End)} - ${pct(prob)})`, background: "linear-gradient(135deg, rgba(56,189,248,.5), rgba(14,165,233,.3))" }}>١٫٢٥ / شهر → ١٥</div>
            <div className={s.tlSeg} style={{ insetInlineStart: pct(y1End), width: `calc(100% - ${pct(y1End)})`, background: "linear-gradient(135deg, rgba(52,211,153,.45), rgba(16,185,129,.25))" }}>١٫٧٥ / شهر → ٢١</div>
            <div className={s.tlNow} style={{ insetInlineStart: pct(acc.serviceMonths) }} title={`${acc.serviceMonths} months`} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }} className={s.small} dir="ltr">
            <span className={s.mono}>{acc.hireDate}</span>
            <span className={s.mono}>↑ {acc.probationEndsOn}</span>
            <span className={s.mono}>↑ {acc.tier2StartsOn}</span>
            <span className={s.mono}>+{span}m</span>
          </div>
        </div>

        <div className={s.grid3} style={{ marginTop: 16 }}>
          <Stat label="أشهر الخدمة" value={ar(acc.serviceMonths)} />
          <Stat label="المستحق" value={ar(acc.accruedDays)} tone="#7dd3fc" />
          <Stat label="المُرحّل والمعتمد" value={`+${ar(acc.totalCarryOverDays)}`} tone="#6ee7b7" />
          <Stat label="المستخدم" value={ar(acc.usedDays)} />
          <Stat label="الرصيد الصافي" value={ar(acc.balance)} tone="#6ee7b7" />
          <Stat label="المعدل الحالي" value={`${ar(acc.monthlyRate)}/ش (${ar(acc.annualEntitlementDays)}/س)`} />
        </div>

        <div className={s.divider} />
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,180px) 1fr", gap: 12, alignItems: "center" }}>
          <div>
            <label className={s.label} htmlFor="lab-leave-request">طلب إجازة (أيام)</label>
            <input id="lab-leave-request" type="number" min={0.5} step={0.5} className={cx(s.input, s.mono)} value={req} onChange={(e) => setReq(Number(e.target.value) || 0)} />
          </div>
          <div className={cx(s.result, verdict.ok ? s.ok : s.bad)} id="lab-leave-verdict">
            {verdict.ok ? `✓ مقبول — المتاح للطلب ${ar(acc.requestableDays)} يوم، والرصيد بعد الطلب ${ar(Math.round((acc.balance - req) * 100) / 100)} يوم.` : `✕ ${verdict.reasonAr}`}
          </div>
        </div>
      </Panel>

      <Panel id="lab-leave-schedule" title="جدول الاستحقاق الشهري" hint="محاكاة شهر بشهر: الاستحقاق، الإسقاط عند حدود سنة الإجازة، والرصيد التراكمي.">
        <div className={s.scroll}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>الشهر</th>
                <th>الفترة</th>
                <th>المرحلة</th>
                <th>مستحق</th>
                <th>مسقط</th>
                <th>الرصيد</th>
              </tr>
            </thead>
            <tbody>
              {acc.schedule.map((r) => (
                <tr key={r.month}>
                  <td className={s.mono}>{ar(r.month)}</td>
                  <td className={s.mono} dir="ltr" style={{ textAlign: "right", fontSize: 12 }}>{r.periodStart} → {r.periodEnd}</td>
                  <td>
                    <span className={cx(s.pill, r.phase === "probation" ? s.pWarn : r.phase === "year1" ? s.pInfo : s.pOk)}>{LEAVE_PHASE_AR[r.phase]}</span>
                  </td>
                  <td className={s.mono}>{r.accrued ? `+${ar(r.accrued)}` : "—"}</td>
                  <td className={s.mono} style={{ color: r.forfeited ? "#fca5a5" : undefined }}>{r.forfeited ? `−${ar(r.forfeited)}` : "—"}</td>
                  <td className={s.mono}><b>{ar(r.balance)}</b></td>
                </tr>
              ))}
              {acc.schedule.length === 0 && (
                <tr>
                  <td colSpan={6} className={s.small}>لم يكتمل أي شهر خدمة بعد.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
