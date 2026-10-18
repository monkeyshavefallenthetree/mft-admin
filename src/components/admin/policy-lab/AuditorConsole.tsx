"use client";

import { useMemo, useState } from "react";
import { auditAttendanceLog, parseAuditLog, type Policy2026Config } from "@/lib/admin/hrPolicy2026";
import { toast } from "@/lib/admin/feedback";
import { s, ar, cx, money, Icon, LAB_ICONS, Panel, Stat } from "./ui";

const SAMPLE = `# التاريخ, الحضور, الانصراف, إضافي معتمد (دقيقة)
2026-10-21, 10:42, 18:45
2026-10-22, 11:01, 19:05
2026-10-25, 11:35, 19:00
2026-10-26, 10:15, 17:20
2026-10-27, 12:30, 20:30
2026-10-28, 10:05, 21:00, ot=150
2026-10-29, 11:20, 18:10
2026-10-30, 13:00, 17:00, ot=240`;

const DAY_AR = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

export default function AuditorConsole({ cfg, defaultRate, weekendDays, holidays }: { cfg: Policy2026Config; defaultRate: number; weekendDays: number[]; holidays: string[] }) {
  const [text, setText] = useState(SAMPLE);
  const [rate, setRate] = useState(defaultRate);
  const [seedCount, setSeedCount] = useState(0);
  const [seedMin, setSeedMin] = useState(0);
  const [ran, setRan] = useState(true);

  const report = useMemo(() => {
    if (!ran) return null;
    return auditAttendanceLog(parseAuditLog(text), { hourlyRate: rate, startingUsage: { count: seedCount, minutes: seedMin }, weekendDays, holidays, cfg });
  }, [ran, text, rate, seedCount, seedMin, weekendDays, holidays, cfg]);

  const copy = async () => {
    if (!report) return;
    const t = report.totals;
    const lines = [
      "تقرير مدقق HR-POL-2026",
      ...report.days.map((d) => `• ${d.row.date} | حضور ${d.row.clockIn} | انصراف ${d.row.clockOut ?? "—"}\n  ${d.notesAr.join("\n  ")}`),
      "",
      `الأذونات المستخدمة: ${t.permissionsUsed} (${t.permissionMinutesUsed} دقيقة) — المتبقي ${t.remaining.count} / ${t.remaining.minutes} دقيقة`,
      `أيام تأخير غير مغطى: ${t.uncoveredLateDays} — خصم ${t.latePenaltyEgp} ج.م`,
      `انصراف مبكر غير مغطى: ${t.shortfallMinutes} دقيقة — خصم ${t.shortfallDeductionEgp} ج.م`,
      `إضافي: نهاري ${t.otDayMinutes} د / ليلي ${t.otNightMinutes} د — ${t.otPay} ج.م`,
      `صافي الأثر على الراتب: ${t.netEffectEgp} ج.م`,
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      toast.success("تم نسخ التقرير");
    } catch {
      toast.error("تعذر النسخ");
    }
  };

  return (
    <div className={s.grid}>
      <Panel
        id="lab-auditor"
        title="وحدة المدقق — سجلات البصمة"
        hint="الصق سجل الحضور (سطر لكل يوم: التاريخ، الحضور، الانصراف، والإضافي المعتمد اختياريًا بصيغة ot=90). يطبق المدقق اللائحة بالترتيب الزمني: الأذونات أولًا، ثم الخصومات، ثم الإضافي."
        tag="HR-POL-2026 Auditor"
      >
        <div className={s.console}>
          <div className={s.consoleBar} dir="ltr">
            <span className={s.dotR} />
            <span className={s.dotY} />
            <span className={s.dotG} />
            <span className={s.mono} style={{ marginInlineStart: 8 }}>attendance.log</span>
          </div>
          <textarea
            id="lab-auditor-input"
            className={cx(s.consoleArea, s.mono)}
            value={text}
            spellCheck={false}
            onChange={(e) => {
              setText(e.target.value);
              setRan(false);
            }}
          />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginTop: 12, alignItems: "end" }}>
          <div>
            <label className={s.label} htmlFor="lab-auditor-rate">أجر الساعة</label>
            <input id="lab-auditor-rate" type="number" min={0} step={0.25} className={cx(s.input, s.mono)} value={rate} onChange={(e) => setRate(Number(e.target.value) || 0)} />
          </div>
          <div>
            <label className={s.label} htmlFor="lab-auditor-seed-count">أذونات سابقة بالدورة</label>
            <input id="lab-auditor-seed-count" type="number" min={0} className={cx(s.input, s.mono)} value={seedCount} onChange={(e) => setSeedCount(Math.max(0, Number(e.target.value) || 0))} />
          </div>
          <div>
            <label className={s.label} htmlFor="lab-auditor-seed-min">دقائق سابقة</label>
            <input id="lab-auditor-seed-min" type="number" min={0} step={15} className={cx(s.input, s.mono)} value={seedMin} onChange={(e) => setSeedMin(Math.max(0, Number(e.target.value) || 0))} />
          </div>
          <button type="button" id="lab-auditor-run" className={s.btn} onClick={() => setRan(true)}>
            <Icon d={LAB_ICONS.terminal} /> تدقيق السجل
          </button>
          <button type="button" id="lab-auditor-sample" className={s.btnGhost} onClick={() => { setText(SAMPLE); setRan(true); }}>
            مثال
          </button>
        </div>
      </Panel>

      {report && (
        <>
          <div className={s.verdict} id="lab-auditor-verdict">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div>
                <p className={s.small}>صافي الأثر على مسير الراتب</p>
                <p className={s.mono} style={{ fontSize: 30, fontWeight: 700, color: report.totals.netEffectEgp >= 0 ? "#6ee7b7" : "#fca5a5" }}>
                  {report.totals.netEffectEgp >= 0 ? "+" : ""}
                  {money(report.totals.netEffectEgp)}
                </p>
              </div>
              <button type="button" id="lab-auditor-copy" className={s.btnGhost} onClick={copy}>
                نسخ التقرير
              </button>
            </div>
            <div className={s.grid3} style={{ marginTop: 14 }}>
              <Stat label="أذونات مستخدمة" value={`${ar(report.totals.permissionsUsed)} / ${ar(cfg.permissionMaxCount)}`} />
              <Stat label="دقائق الأذونات" value={`${ar(report.totals.permissionMinutesUsed)} / ${ar(cfg.permissionMaxMinutes)}`} />
              <Stat label="خصم التأخير" value={money(report.totals.latePenaltyEgp)} tone="#fca5a5" />
              <Stat label="خصم الانصراف المبكر" value={money(report.totals.shortfallDeductionEgp)} tone="#fca5a5" />
              <Stat label="الإضافي المستحق" value={money(report.totals.otPay)} tone="#6ee7b7" />
              <Stat label="أيام تأخير غير مغطى" value={ar(report.totals.uncoveredLateDays)} />
            </div>
          </div>

          <Panel id="lab-auditor-table" title="التحليل اليومي" hint={report.errors.length ? `تم تجاهل ${ar(report.errors.length)} سطر بسبب أخطاء في الصيغة.` : undefined}>
            <div className={s.scroll} style={{ maxHeight: 560 }}>
              <table className={s.table}>
                <thead>
                  <tr>
                    <th>اليوم</th>
                    <th>حضور / انصراف</th>
                    <th>الحالة</th>
                    <th>الرصيد بعده</th>
                    <th>الأثر</th>
                    <th>ملاحظات المدقق</th>
                  </tr>
                </thead>
                <tbody>
                  {report.days.map((d) => {
                    const dow = new Date(`${d.row.date}T12:00:00`).getDay();
                    const effect = (d.overtime?.total ?? 0) - d.latePenaltyEgp - d.shortfallDeductionEgp;
                    return (
                      <tr key={d.row.line}>
                        <td>
                          <div className={s.mono} style={{ fontSize: 12 }} dir="ltr">{d.row.date}</div>
                          <div className={s.small}>{DAY_AR[dow]}</div>
                        </td>
                        <td className={s.mono} dir="ltr" style={{ textAlign: "right" }}>
                          {d.row.clockIn} → {d.row.clockOut ?? "—"}
                          {d.row.approvedOtMinutes > 0 && <div className={s.small}>ot {d.row.approvedOtMinutes}m</div>}
                        </td>
                        <td>
                          <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
                            {d.isOffDay && <span className={cx(s.pill, s.pDim)}>راحة</span>}
                            {d.clockIn?.status === "on-time" && <span className={cx(s.pill, s.pOk)}>في الموعد</span>}
                            {d.clockIn?.status === "late-covered" && <span className={cx(s.pill, s.pWarn)}>إذن {ar(d.clockIn.chargedMinutes)}د</span>}
                            {d.clockIn?.status === "late-uncovered" && <span className={cx(s.pill, s.pBad)}>غير مغطى</span>}
                            {d.earlyLeave?.isEarly && (
                              <span className={cx(s.pill, d.earlyLeavePermissionUsed ? s.pWarn : s.pBad)}>
                                انصراف مبكر {ar(d.earlyLeave.remainingMinutes)}د
                              </span>
                            )}
                            {d.overtime && d.overtime.totalMinutes > 0 && <span className={cx(s.pill, s.pInfo)}>إضافي {ar(d.overtime.totalMinutes)}د</span>}
                          </div>
                        </td>
                        <td className={s.mono}>{ar(d.usageAfter.count)} · {ar(d.usageAfter.minutes)}د</td>
                        <td className={s.mono} style={{ color: effect > 0 ? "#6ee7b7" : effect < 0 ? "#fca5a5" : "var(--dim)", whiteSpace: "nowrap" }}>
                          {effect === 0 ? "—" : `${effect > 0 ? "+" : ""}${money(Math.round(effect * 100) / 100)}`}
                        </td>
                        <td style={{ minWidth: 280 }}>
                          <ul style={{ margin: 0, paddingInlineStart: 16, lineHeight: 1.8, fontSize: 12.5, color: "#d4d4d8" }}>
                            {d.notesAr.map((n, i) => (
                              <li key={i}>{n}</li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    );
                  })}
                  {report.errors.map((e) => (
                    <tr key={`err-${e.line}`}>
                      <td colSpan={6} className={s.small} style={{ color: "#fca5a5" }}>
                        سطر {ar(e.line)}: {e.error} — <span className={s.mono} dir="ltr">{e.raw}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
