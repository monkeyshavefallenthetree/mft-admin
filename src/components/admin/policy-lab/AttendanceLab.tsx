"use client";

import { useMemo, useRef, useState } from "react";
import ModalPortal from "@/components/admin/ui/ModalPortal";
import {
  atMinutes,
  evaluateClockIn,
  evaluateEarlyLeave,
  parseHm,
  usageFromLedger,
  remainingQuota,
  UNCOVERED_REASON_AR,
  type ClockInEvaluation,
  type EarlyLeaveEvaluation,
  type Policy2026Config,
  type PermissionLedgerEntry,
} from "@/lib/admin/hrPolicy2026";
import { s, ar, cx, money, Icon, LAB_ICONS, Panel, Ring, Stat } from "./ui";
import SmartClockOutModal from "./SmartClockOutModal";

type SimEntry = PermissionLedgerEntry & {
  id: string;
  day: number;
  note: string;
  /** EGP deducted for this event (uncovered lateness or unpermitted early leave). */
  deductionEgp: number;
};

const PRESETS = ["10:30", "11:00", "11:01", "11:35", "12:30", "13:30"];
const SIM_WORKER = "simulator";

export default function AttendanceLab({ cfg, hourlyRate }: { cfg: Policy2026Config; hourlyRate: number }) {
  const [clockInHm, setClockInHm] = useState("11:01");
  const [clockOutHm, setClockOutHm] = useState("17:45");
  const [scanning, setScanning] = useState(false);
  const [day, setDay] = useState(1);
  const [evalIn, setEvalIn] = useState<ClockInEvaluation | null>(null);
  const [evalOut, setEvalOut] = useState<{ ev: EarlyLeaveEvaluation; outcome?: string; tone: "ok" | "warn" | "bad" | "info" } | null>(null);
  const [modal, setModal] = useState<EarlyLeaveEvaluation | null>(null);
  const [ledger, setLedger] = useState<SimEntry[]>([]);
  const [startCount, setStartCount] = useState(0);
  const [startMinutes, setStartMinutes] = useState(0);
  const seq = useRef(0);

  const dailyPay = cfg.standardHours * hourlyRate;
  const baseDate = useMemo(() => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    return d;
  }, []);

  /** Quota already consumed this cycle (seed) + simulated ledger. */
  const usage = useMemo(() => {
    const u = usageFromLedger(ledger);
    return { count: u.count + startCount, minutes: u.minutes + startMinutes };
  }, [ledger, startCount, startMinutes]);
  const remaining = remainingQuota(usage, cfg);
  const totalDeduction = ledger.filter((e) => e.status === "applied").reduce((t, e) => t + e.deductionEgp, 0);

  const add = (e: Omit<SimEntry, "id" | "workerId" | "date" | "status">) => {
    seq.current += 1;
    setLedger((l) => [{ ...e, id: `sim-${seq.current}`, workerId: SIM_WORKER, date: `day-${e.day}`, status: "applied" }, ...l]);
  };

  const scan = () => {
    if (scanning) return;
    setScanning(true);
    setEvalOut(null);
    window.setTimeout(() => {
      const nextDay = evalIn ? day + 1 : day;
      const at = atMinutes(baseDate, parseHm(clockInHm));
      const ev = evaluateClockIn(at, usage, cfg);
      setEvalIn(ev);
      setDay(nextDay);
      if (ev.status === "late-covered") {
        add({ day: nextDay, kind: "late", actualMinutes: ev.lateMinutes, chargedMinutes: ev.chargedMinutes, covered: true, source: "simulator", note: `إذن تأخير تلقائي (${ar(ev.clockInHm)})`, deductionEgp: 0 });
      } else if (ev.status === "late-uncovered") {
        add({
          day: nextDay,
          kind: "late",
          actualMinutes: ev.lateMinutes,
          chargedMinutes: 0,
          covered: false,
          fallbackPenaltyDays: ev.fallbackPenaltyDays,
          source: "simulator",
          note: `تأخير غير مغطى — ${UNCOVERED_REASON_AR[ev.uncoveredReason!]}`,
          deductionEgp: Math.round(ev.fallbackPenaltyDays * dailyPay * 100) / 100,
        });
      }
      setScanning(false);
    }, 900);
  };

  const clockOut = () => {
    if (!evalIn) return;
    const outAt = atMinutes(baseDate, parseHm(clockOutHm));
    const ev = evaluateEarlyLeave(outAt, evalIn.requiredEnd, usage, cfg);
    if (!ev.isEarly) {
      setEvalOut({ ev, tone: "ok", outcome: ev.messageAr });
      return;
    }
    setModal(ev);
  };

  const resolve = (choice: "permission" | "break" | "deduct" | "stay") => {
    const ev = modal;
    setModal(null);
    if (!ev || !evalIn) return;
    if (choice === "permission") {
      add({ day, kind: "early_leave", actualMinutes: ev.remainingMinutes, chargedMinutes: ev.chargedMinutes, covered: true, source: "simulator", note: `إذن انصراف مبكر (${ar(clockOutHm)})`, deductionEgp: 0 });
      setEvalOut({ ev, tone: "warn", outcome: `تم استهلاك إذن انصراف مبكر ${ar(ev.chargedMinutes)} دقيقة. المتبقي ${ar(ev.remainingAfter.count)} أذونات / ${ar(ev.remainingAfter.minutes)} دقيقة.` });
    } else if (choice === "deduct") {
      const egp = Math.round((ev.remainingMinutes / 60) * hourlyRate * 100) / 100;
      add({ day, kind: "early_leave", actualMinutes: ev.remainingMinutes, chargedMinutes: 0, covered: false, source: "simulator", note: `انصراف بدون إذن — خصم ${ar(ev.remainingMinutes)} دقيقة`, deductionEgp: egp });
      setEvalOut({ ev, tone: "bad", outcome: `انصراف بدون إذن: خصم مباشر ${money(egp)} من الراتب.` });
    } else if (choice === "break") {
      setEvalOut({ ev, tone: "info", outcome: "تم تسجيل استراحة — الجلسة متوقفة مؤقتًا ولم يُستهلك أي إذن. إذا لم يعد الموظف قبل نهاية الشيفت يُعامل كانصراف مبكر." });
    } else {
      setEvalOut({ ev, tone: "ok", outcome: "تم إلغاء تسجيل الخروج — الموظف مستمر في العمل." });
    }
  };

  const toggle = (id: string) => setLedger((l) => l.map((e) => (e.id === id ? { ...e, status: e.status === "applied" ? "reversed" : "applied" } : e)));
  const reset = () => {
    setLedger([]);
    setEvalIn(null);
    setEvalOut(null);
    setDay(1);
  };

  const tone = !evalIn ? null : evalIn.status === "on-time" ? s.ok : evalIn.status === "late-covered" ? s.warn : s.bad;
  const nowHm = scanning || !evalIn ? clockInHm : evalOut ? clockOutHm : evalIn.clockInHm;

  return (
    <div className={s.grid2}>
      <div className={s.grid}>
        <Panel id="lab-biometric" title="محاكي البصمة" hint="اختر وقت الحضور ثم اضغط «بصمة». قاعدة الدقيقة الواحدة: ١١:٠٠ في الموعد، ١١:٠١ تأخير يُحتسب له إذن ٣٠ دقيقة على الأقل." tag={`اليوم ${ar(day)}`}>
          <div className={cx(s.scanner, scanning && s.scanning)}>
            <div className={cx(s.clock, s.mono)}>{ar(nowHm)}</div>
            <div className={s.clockSub}>الحد: {ar(cfg.lateCutoffTime)} · بداية: {ar(cfg.shiftStartTime)}</div>
            <svg className={s.finger} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.1}>
              <path strokeLinecap="round" strokeLinejoin="round" d={LAB_ICONS.finger} />
            </svg>
            <div className={s.scanLine} />
          </div>

          <div style={{ marginTop: 14 }} className={s.chips}>
            {PRESETS.map((p) => (
              <button key={p} type="button" id={`lab-preset-${p.replace(":", "")}`} className={cx(s.chip, s.mono, clockInHm === p && s.chipActive)} onClick={() => setClockInHm(p)}>
                {ar(p)}
              </button>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, marginTop: 14, alignItems: "end" }}>
            <div>
              <label className={s.label} htmlFor="lab-clockin">وقت الحضور</label>
              <input id="lab-clockin" type="time" className={cx(s.input, s.mono)} value={clockInHm} onChange={(e) => setClockInHm(e.target.value)} />
            </div>
            <button type="button" id="lab-scan" className={s.btn} onClick={scan} disabled={scanning}>
              <Icon d={LAB_ICONS.finger} /> {scanning ? "جارٍ القراءة…" : "بصمة حضور"}
            </button>
          </div>

          {evalIn && !scanning && (
            <div key={`${day}-${evalIn.clockInHm}`} className={cx(s.result, tone)} style={{ marginTop: 14 }} id="lab-clockin-result">
              <b style={{ display: "block", marginBottom: 2 }}>
                {evalIn.status === "on-time" ? "✓ حضور في الموعد" : evalIn.status === "late-covered" ? "⚠ تأخير مغطى بإذن" : "✕ تأخير غير مغطى"}
              </b>
              {evalIn.messageAr}
              <div className={s.small} style={{ marginTop: 6, color: "inherit", opacity: 0.85 }}>
                نهاية الشيفت المرنة = حصر({ar(evalIn.clockInHm)}، {ar(cfg.shiftStartTime)}–{ar(cfg.lateCutoffTime)}) + {ar(cfg.standardHours)} ساعات = <b className={s.mono}>{ar(evalIn.requiredEndHm)}</b>
              </div>
            </div>
          )}
        </Panel>

        <Panel id="lab-clockout" title="تسجيل الخروج الذكي" hint="عند محاولة الانصراف قبل نهاية الشيفت يظهر تنبيه يسأل الموظف عن استهلاك إذن انصراف مبكر، وإلا يُخصم الوقت من الراتب.">
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "end" }}>
            <div>
              <label className={s.label} htmlFor="lab-clockout-time">وقت الانصراف</label>
              <input id="lab-clockout-time" type="time" className={cx(s.input, s.mono)} value={clockOutHm} onChange={(e) => setClockOutHm(e.target.value)} />
            </div>
            <button type="button" id="lab-clockout-btn" className={s.btnGhost} onClick={clockOut} disabled={!evalIn}>
              <Icon d={LAB_ICONS.exit} /> تسجيل خروج
            </button>
          </div>
          {!evalIn && <p className={s.small} style={{ marginTop: 10 }}>سجّل حضورًا أولًا من محاكي البصمة.</p>}
          {evalOut?.outcome && (
            <div className={cx(s.result, s[evalOut.tone])} style={{ marginTop: 14 }} id="lab-clockout-result">
              {evalOut.outcome}
            </div>
          )}
        </Panel>
      </div>

      <div className={s.grid}>
        <Panel id="lab-quota" title="عداد الأذونات الشهرية" hint={`حد أقصى ${ar(cfg.permissionMaxCount)} أذونات و${ar(cfg.permissionMaxMinutes)} دقيقة في الدورة · الإذن الواحد ${ar(cfg.permissionMinMinutes)}–${ar(cfg.permissionMaxSingleMinutes)} دقيقة · لا تغطية جزئية.`}>
          <div style={{ display: "flex", justifyContent: "space-around", flexWrap: "wrap", gap: 12 }}>
            <Ring value={usage.count} max={cfg.permissionMaxCount} label="عدد الأذونات" sub={`متبقي ${ar(remaining.count)}`} />
            <Ring value={usage.minutes} max={cfg.permissionMaxMinutes} label="الدقائق" sub={`متبقي ${ar(remaining.minutes)}`} />
          </div>
          <div className={s.divider} />
          <div className={s.grid3}>
            <div>
              <label className={s.label} htmlFor="lab-seed-count">أذونات مستخدمة مسبقًا</label>
              <input id="lab-seed-count" type="number" min={0} max={cfg.permissionMaxCount} className={cx(s.input, s.mono)} value={startCount} onChange={(e) => setStartCount(Math.max(0, Number(e.target.value) || 0))} />
            </div>
            <div>
              <label className={s.label} htmlFor="lab-seed-minutes">دقائق مستخدمة مسبقًا</label>
              <input id="lab-seed-minutes" type="number" min={0} max={cfg.permissionMaxMinutes} step={15} className={cx(s.input, s.mono)} value={startMinutes} onChange={(e) => setStartMinutes(Math.max(0, Number(e.target.value) || 0))} />
            </div>
            <Stat label="إجمالي الخصومات" value={money(totalDeduction)} tone={totalDeduction > 0 ? "#fca5a5" : undefined} />
          </div>
        </Panel>

        <Panel id="lab-ledger" title="سجل الأذونات" hint="كل حدث يُسجل في الدفتر؛ يمكن للإدارة إلغاؤه أو إعادة تطبيقه (تراجع)." tag={<button type="button" id="lab-ledger-reset" onClick={reset} style={{ color: "inherit", background: "none", border: 0, cursor: "pointer" }}>تصفير ↺</button>}>
          {ledger.length === 0 ? (
            <p className={s.small}>لا توجد أحداث بعد.</p>
          ) : (
            <div className={s.scroll} style={{ maxHeight: 320 }}>
              <table className={s.table}>
                <thead>
                  <tr>
                    <th>اليوم</th>
                    <th>النوع</th>
                    <th>فعلي / محتسب</th>
                    <th>الحالة</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {ledger.map((e) => (
                    <tr key={e.id} style={{ opacity: e.status === "reversed" ? 0.45 : 1 }}>
                      <td className={s.mono}>{ar(e.day)}</td>
                      <td>
                        <div>{e.kind === "late" ? "تأخير" : "انصراف مبكر"}</div>
                        <div className={s.small}>{e.note}</div>
                      </td>
                      <td className={s.mono}>{ar(e.actualMinutes)} / {ar(e.chargedMinutes)}</td>
                      <td>
                        {e.status === "reversed" ? (
                          <span className={cx(s.pill, s.pDim)}>ملغى</span>
                        ) : e.covered ? (
                          <span className={cx(s.pill, s.pOk)}>مغطى</span>
                        ) : (
                          <span className={cx(s.pill, s.pBad)}>خصم {money(e.deductionEgp)}</span>
                        )}
                      </td>
                      <td>
                        <button type="button" id={`lab-ledger-toggle-${e.id}`} className={s.btnGhost} style={{ padding: "4px 8px", fontSize: 12 }} onClick={() => toggle(e.id)} title={e.status === "applied" ? "إلغاء" : "إعادة تطبيق"}>
                          <Icon d={LAB_ICONS.undo} size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      {modal && evalIn && (
        <ModalPortal onClose={() => resolve("stay")}>
          <SmartClockOutModal
            evaluation={modal}
            requiredEndHm={evalIn.requiredEndHm}
            hourlyRate={hourlyRate}
            onUsePermission={() => resolve("permission")}
            onBreak={() => resolve("break")}
            onLeaveWithDeduction={() => resolve("deduct")}
            onStay={() => resolve("stay")}
          />
        </ModalPortal>
      )}
    </div>
  );
}
