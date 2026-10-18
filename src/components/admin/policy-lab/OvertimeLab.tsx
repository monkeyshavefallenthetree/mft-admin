"use client";

import { useMemo, useState } from "react";
import { atMinutes, parseHm, splitOvertimePay, type Policy2026Config } from "@/lib/admin/hrPolicy2026";
import { s, ar, cx, money, Icon, LAB_ICONS, Panel, Stat } from "./ui";

const PRESETS: { label: string; start: string; approved: number; actual: number }[] = [
  { label: "١٧:٠٠ ← ساعتان", start: "17:00", approved: 120, actual: 120 },
  { label: "١٩:٠٠ ← ٣ ساعات (ليلي)", start: "19:00", approved: 180, actual: 180 },
  { label: "٠٤:٣٠ ← فجرًا", start: "04:30", approved: 150, actual: 150 },
  { label: "معتمد ٦٠ / فعلي ١٥٠", start: "18:30", approved: 60, actual: 150 },
];

/** Polar helper for the 24h dial (0:00 at top, clockwise). */
function arcPath(cx0: number, cy0: number, r: number, fromMin: number, toMin: number) {
  const a0 = (fromMin / 1440) * 2 * Math.PI - Math.PI / 2;
  const a1 = (toMin / 1440) * 2 * Math.PI - Math.PI / 2;
  const large = toMin - fromMin > 720 ? 1 : 0;
  const p = (a: number) => `${cx0 + r * Math.cos(a)} ${cy0 + r * Math.sin(a)}`;
  return `M ${p(a0)} A ${r} ${r} 0 ${large} 1 ${p(a1)}`;
}

export default function OvertimeLab({ cfg, defaultRate }: { cfg: Policy2026Config; defaultRate: number }) {
  const [start, setStart] = useState("18:30");
  const [approved, setApproved] = useState(120);
  const [actual, setActual] = useState(150);
  const [rate, setRate] = useState(defaultRate);
  const [hasApproval, setHasApproval] = useState(true);

  const payable = hasApproval ? Math.min(Math.max(0, approved), Math.max(0, actual)) : 0;
  const split = useMemo(() => splitOvertimePay(atMinutes(new Date(), parseHm(start)), payable, rate, cfg), [start, payable, rate, cfg]);
  const legacy = Math.round((actual / 60) * rate * 1.5 * 100) / 100;

  const dayStart = parseHm(cfg.dayWindowStart);
  const nightStart = parseHm(cfg.nightWindowStart);
  const s0 = parseHm(start);

  return (
    <div className={s.grid2}>
      <Panel id="lab-overtime" title="حاسبة العمل الإضافي" hint={`لا يُصرف إضافي إلا بتكليف مسبق معتمد · نهاري (${ar(cfg.dayWindowStart)}–${ar(cfg.nightWindowStart)}) × ${ar(cfg.dayOtMultiplier)} · ليلي (${ar(cfg.nightWindowStart)}–${ar(cfg.dayWindowStart)}) × ${ar(cfg.nightOtMultiplier)}${cfg.nightShiftAllowance ? ` + بدل ليلي ${money(cfg.nightShiftAllowance)}` : ""}.`}>
        <div className={s.chips} style={{ marginBottom: 14 }}>
          {PRESETS.map((p, i) => (
            <button
              key={p.label}
              type="button"
              id={`lab-ot-preset-${i}`}
              className={cx(s.chip, start === p.start && approved === p.approved && actual === p.actual && s.chipActive)}
              onClick={() => {
                setStart(p.start);
                setApproved(p.approved);
                setActual(p.actual);
                setHasApproval(true);
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className={s.grid3}>
          <div>
            <label className={s.label} htmlFor="lab-ot-start">بداية الإضافي</label>
            <input id="lab-ot-start" type="time" className={cx(s.input, s.mono)} value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div>
            <label className={s.label} htmlFor="lab-ot-approved">المعتمد (دقيقة)</label>
            <input id="lab-ot-approved" type="number" min={0} step={15} className={cx(s.input, s.mono)} value={approved} onChange={(e) => setApproved(Number(e.target.value) || 0)} />
          </div>
          <div>
            <label className={s.label} htmlFor="lab-ot-actual">الفعلي (دقيقة)</label>
            <input id="lab-ot-actual" type="number" min={0} step={15} className={cx(s.input, s.mono)} value={actual} onChange={(e) => setActual(Number(e.target.value) || 0)} />
          </div>
          <div>
            <label className={s.label} htmlFor="lab-ot-rate">أجر الساعة (ج.م)</label>
            <input id="lab-ot-rate" type="number" min={0} step={0.25} className={cx(s.input, s.mono)} value={rate} onChange={(e) => setRate(Number(e.target.value) || 0)} />
          </div>
        </div>
        <button
          type="button"
          id="lab-ot-approval-toggle"
          className={cx(s.check, hasApproval && s.checkOn)}
          style={{ marginTop: 12, width: "100%", background: "transparent", color: "inherit" }}
          onClick={() => setHasApproval((v) => !v)}
        >
          <span className={s.checkBox}>{hasApproval && <Icon d={LAB_ICONS.check} size={12} />}</span>
          يوجد تكليف إداري مسبق معتمد (طلب إضافي موافق عليه)
        </button>

        <div style={{ marginTop: 16 }}>
          <div className={s.otBar} dir="ltr">
            {split.dayMinutes > 0 && <div className={s.otDay} style={{ flexGrow: split.dayMinutes }}>☀ {split.dayMinutes}m</div>}
            {split.nightMinutes > 0 && <div className={s.otNight} style={{ flexGrow: split.nightMinutes }}>☾ {split.nightMinutes}m</div>}
            {split.totalMinutes === 0 && <div style={{ flex: 1, display: "grid", placeItems: "center", fontSize: 12, color: "var(--dim)" }}>لا يوجد إضافي مستحق</div>}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
            {split.segments.map((g, i) => (
              <span key={i} className={cx(s.pill, g.kind === "day" ? s.pWarn : s.pInfo)}>
                <span className={s.mono}>{ar(g.from)} → {ar(g.to)}</span> · {g.kind === "day" ? "نهاري" : "ليلي"} {ar(g.minutes)}د
              </span>
            ))}
          </div>
        </div>

        {!hasApproval && actual > 0 && (
          <div className={cx(s.result, s.bad)} style={{ marginTop: 14 }}>بقاء {ar(actual)} دقيقة بدون تكليف مسبق — لا يُصرف أي مقابل إضافي (البند ٤).</div>
        )}
        {hasApproval && actual > approved && (
          <div className={cx(s.result, s.warn)} style={{ marginTop: 14 }}>تم العمل {ar(actual)} دقيقة لكن المعتمد {ar(approved)} فقط — يُصرف الأقل.</div>
        )}
      </Panel>

      <Panel id="lab-overtime-result" title="النتيجة" hint="مقارنة بالحساب القديم (١٫٥× تلقائيًا لكل الساعات الزائدة).">
        <div className={s.dial}>
          <svg viewBox="0 0 220 220" width="220" height="220">
            <circle cx="110" cy="110" r="92" fill="none" stroke="rgba(255,255,255,.06)" strokeWidth="16" />
            <path d={arcPath(110, 110, 92, dayStart, nightStart)} fill="none" stroke="rgba(245,158,11,.35)" strokeWidth="16" />
            <path d={arcPath(110, 110, 92, nightStart, dayStart + 1440)} fill="none" stroke="rgba(99,102,241,.35)" strokeWidth="16" />
            {split.totalMinutes > 0 && (
              <path d={arcPath(110, 110, 72, s0, s0 + Math.min(split.totalMinutes, 1439))} fill="none" stroke="url(#otg)" strokeWidth="10" strokeLinecap="round" style={{ filter: "drop-shadow(0 0 6px rgba(239,68,68,.7))" }} />
            )}
            <defs>
              <linearGradient id="otg" x1="0" x2="1">
                <stop offset="0" stopColor="#ef4444" />
                <stop offset="1" stopColor="#f97316" />
              </linearGradient>
            </defs>
            {[0, 6, 12, 18].map((h) => {
              const a = (h / 24) * 2 * Math.PI - Math.PI / 2;
              return (
                <text key={h} x={110 + 58 * Math.cos(a)} y={110 + 58 * Math.sin(a) + 4} textAnchor="middle" fontSize="11" fill="#a1a1aa" fontFamily="IBM Plex Mono, monospace">
                  {String(h).padStart(2, "0")}
                </text>
              );
            })}
          </svg>
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center", pointerEvents: "none" }}>
            <div>
              <div className={s.mono} style={{ fontSize: 20, fontWeight: 700 }}>{money(split.total)}</div>
              <div className={s.small}>{ar(split.totalMinutes)} دقيقة</div>
            </div>
          </div>
        </div>

        <div className={s.grid3} style={{ marginTop: 16 }}>
          <Stat label={`نهاري × ${ar(cfg.dayOtMultiplier)}`} value={money(split.dayPay)} tone="#fcd34d" />
          <Stat label={`ليلي × ${ar(cfg.nightOtMultiplier)}`} value={money(split.nightPay)} tone="#c4b5fd" />
          <Stat label="بدل ليلي" value={money(split.nightAllowance)} />
          <Stat label="الحساب القديم ١٫٥×" value={money(legacy)} tone="#a1a1aa" />
        </div>
        <p className={s.small} style={{ marginTop: 12 }}>
          الفرق عن النظام القديم: <b className={s.mono} style={{ color: split.total - legacy >= 0 ? "#6ee7b7" : "#fca5a5" }}>{money(Math.round((split.total - legacy) * 100) / 100)}</b>
        </p>
      </Panel>
    </div>
  );
}
