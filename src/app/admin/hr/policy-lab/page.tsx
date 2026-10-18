"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { DEFAULT_HR_SETTINGS, type HolidayItem, type HrSettings } from "@/lib/admin/hrReports";
import { subscribeHolidays, subscribeHrSettings } from "@/lib/admin/hrSettings";
import { policyConfigFromSettings, parseYmd, ymd } from "@/lib/admin/hrPolicy2026";
import { s, ar, cx, Icon, LAB_ICONS } from "@/components/admin/policy-lab/ui";
import AttendanceLab from "@/components/admin/policy-lab/AttendanceLab";
import LeaveLab from "@/components/admin/policy-lab/LeaveLab";
import OvertimeLab from "@/components/admin/policy-lab/OvertimeLab";
import ReimbursementLab from "@/components/admin/policy-lab/ReimbursementLab";
import AuditorConsole from "@/components/admin/policy-lab/AuditorConsole";

type Section = "attendance" | "leave" | "overtime" | "reimbursements" | "auditor";

const SECTIONS: { key: Section; label: string; subEn: string; icon: string }[] = [
  { key: "attendance", label: "١. البصمة والأذونات", subEn: "Clock-in & Permissions", icon: LAB_ICONS.finger },
  { key: "leave", label: "٢. الإجازات السنوية", subEn: "Leave Accrual & Tenure", icon: LAB_ICONS.calendar },
  { key: "overtime", label: "٣. العمل الإضافي", subEn: "Day 1.35x / Night 1.70x", icon: LAB_ICONS.moon },
  { key: "reimbursements", label: "٤. المصروفات", subEn: "Expense Validator", icon: LAB_ICONS.receipt },
  { key: "auditor", label: "٥. وحدة المدقق", subEn: "Bulk Log Auditor", icon: LAB_ICONS.terminal },
];

function expandHolidays(items: HolidayItem[]): string[] {
  const out: string[] = [];
  for (const h of items) {
    const start = parseYmd(h.date);
    if (!start) continue;
    const end = parseYmd(h.endDate || h.date) ?? start;
    for (let d = new Date(start); d <= end && out.length < 2000; d.setDate(d.getDate() + 1)) out.push(ymd(d));
  }
  return out;
}

export default function PolicyLabPage() {
  const [settings, setSettings] = useState<HrSettings>(DEFAULT_HR_SETTINGS);
  const [holidays, setHolidays] = useState<HolidayItem[]>([]);
  const [section, setSection] = useState<Section>("attendance");
  const [showGuide, setShowGuide] = useState(true);

  useEffect(() => {
    const u1 = subscribeHrSettings(setSettings);
    const u2 = subscribeHolidays(setHolidays);
    return () => {
      u1();
      u2();
    };
  }, []);

  const cfg = useMemo(() => policyConfigFromSettings(settings), [settings]);
  const holidayDates = useMemo(() => expandHolidays(holidays), [holidays]);
  const rate = settings.defaultHourlyRate || 31.25;
  const enabled = !!settings.policy2026Enabled;

  return (
    <div className="pb-16">
      {/* Arabic typeface for the lab (React 19 hoists & dedupes stylesheet links). */}
      {/* eslint-disable-next-line @next/next/no-page-custom-font -- intentionally scoped to this RTL page */}
      <link rel="stylesheet" precedence="default" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;600;700&display=swap" />

      <div className={s.lab} dir="rtl" lang="ar">
        <header className={s.hero}>
          <div>
            <span className={s.eyebrow}>
              <span className={cx(s.pulseDot, !enabled && s.pulseDotOff)} />
              {enabled ? `السياسة مفعّلة منذ ${ar(settings.policy2026EffectiveFrom ?? "")}` : "وضع المحاكاة الآمن (Sandbox) — لا يغير بيانات الموظفين الحقيقية"}
            </span>
            <h1 className={s.title}>مختبر لائحة HR-POL-2026 ووحدة التدقيق</h1>
            <p className={s.subtitle}>
              بيئة تجريبية (Simulator) لاختبار قواعد البصمة، الأذونات، الإجازات، الإضافي، وتدقيق سجلات الحضور قبل أو أثناء تطبيقها على الرواتب الفعلية.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link href="/admin/hr?tab=compliance" id="lab-go-onboarding" className={s.btnPrimary}>
              <Icon d={LAB_ICONS.calendar} size={16} /> ضبط تواريخ تعيين الموظفين الحاليين
            </Link>
            <Link href="/admin/workers" id="lab-go-workers" className={s.btnGhost}>
              سجل الموظفين (Workers)
            </Link>
            <Link href="/admin/hr" id="lab-back-hr" className={s.btnGhost}>
              لوحة الموارد البشرية والرواتب
            </Link>
            <button type="button" onClick={() => setShowGuide((v) => !v)} className={s.btnGhost}>
              {showGuide ? "إخفاء الدليل" : "كيف أستخدم المختبر؟"}
            </button>
          </div>
        </header>

        {showGuide && (
          <div className={s.card} style={{ marginBottom: 18, borderColor: "rgba(220,38,38,0.35)" }}>
            <div className={s.cardHead}>
              <div>
                <h2 className={s.cardTitle}>لماذا صُمم هذا المختبر؟ وكيف تستخدمه؟ (Quick UX Guide)</h2>
                <p className={s.small}>
                  هذا المختبر مفصول عن قاعدة بيانات الموظفين الحقيقية حتى تتمكن من تجربة أي سيناريو أو لصق شيت حضور كامل لمعرفة الخصومات والأذونات بدقة دون الخوف من تعديل رواتب الموظفين بالخطأ.
                </p>
              </div>
              <span className={cx(s.badge, s.badgeInfo)}>Sandbox + Auditor</span>
            </div>
            <div className={s.grid3} style={{ marginTop: 10 }}>
              <div className={s.stat}>
                <p className={s.statLabel}>١. للموظفين الحاليين بالشركة (البيانات الحقيقية)</p>
                <p className={s.small} style={{ marginTop: 4 }}>
                  لضبط تاريخ التحاق كل موظف بالشركة (حساب الإجازات واجتياز فترة الاختبار) وتاريخ بدء الحساب بالنظام الجديد: افتح{" "}
                  <Link href="/admin/hr?tab=compliance" style={{ color: "#f87171", textDecoration: "underline", fontWeight: 700 }}>
                    HR → Permissions &amp; Leave
                  </Link>{" "}
                  أو صفحة{" "}
                  <Link href="/admin/workers" style={{ color: "#f87171", textDecoration: "underline", fontWeight: 700 }}>
                    Workers
                  </Link>{" "}
                  واضغط <b>Set Joining Date</b>.
                </p>
              </div>
              <div className={s.stat}>
                <p className={s.statLabel}>٢. لاختبار حالة موظف سريعًا (الأقسام ١–٤ أدناه)</p>
                <p className={s.small} style={{ marginTop: 4 }}>
                  حرّك مؤشر وقت الدخول (مثلاً ١١:٣٥) أو جرب زر «تسجيل الخروج المبكر» أو أدخل تاريخ تعيين موظف قديم لترى فورًا كيف يحسب النظام الأذونات والرصيد والإضافي النهاري/الليلي.
                </p>
              </div>
              <div className={s.stat}>
                <p className={s.statLabel}>٣. لتدقيق شيت بصمة كامل (قسم ٥: وحدة المدقق)</p>
                <p className={s.small} style={{ marginTop: 4 }}>
                  افتح تبويب <b>«٥. وحدة المدقق»</b> والصق سجل حضور أي موظف بصيغة <code>YYYY-MM-DD, HH:MM, HH:MM</code> ليخرج لك كشف حساب تفصيلي بالرصيد والخصومات وصافي المستحق مع تصدير CSV.
                </p>
              </div>
            </div>
          </div>
        )}

        <div className={s.grid3} style={{ marginBottom: 18 }}>
          {[
            ["حد التأخير", ar(cfg.lateCutoffTime)],
            ["الأذونات / الشهر", `${ar(cfg.permissionMaxCount)} · ${ar(cfg.permissionMaxMinutes)}د`],
            ["الإذن الواحد", `${ar(cfg.permissionMinMinutes)}–${ar(cfg.permissionMaxSingleMinutes)}د`],
            ["إضافي نهاري / ليلي", `${ar(cfg.dayOtMultiplier)}× / ${ar(cfg.nightOtMultiplier)}×`],
            ["أجر الساعة", `${ar(rate)} ج.م`],
          ].map(([k, v]) => (
            <div key={k} className={s.stat}>
              <p className={s.statLabel}>{k}</p>
              <p className={s.mono} style={{ marginTop: 4, fontSize: 16, fontWeight: 600 }}>{v}</p>
            </div>
          ))}
        </div>

        <nav className={s.nav} aria-label="أقسام المختبر">
          {SECTIONS.map((x) => (
            <button key={x.key} type="button" id={`lab-nav-${x.key}`} className={cx(s.navBtn, section === x.key && s.navBtnActive)} onClick={() => setSection(x.key)}>
              <Icon d={x.icon} size={16} /> <span>{x.label}</span>
              <span style={{ fontSize: 10, opacity: 0.7, marginRight: 4 }} dir="ltr">({x.subEn})</span>
            </button>
          ))}
        </nav>

        <div key={section}>
          {section === "attendance" && <AttendanceLab cfg={cfg} hourlyRate={rate} />}
          {section === "leave" && <LeaveLab cfg={cfg} />}
          {section === "overtime" && <OvertimeLab cfg={cfg} defaultRate={rate} />}
          {section === "reimbursements" && <ReimbursementLab cfg={cfg} />}
          {section === "auditor" && <AuditorConsole cfg={cfg} defaultRate={rate} weekendDays={settings.weekendDays ?? [5, 6]} holidays={holidayDates} />}
        </div>

        <p className={s.small} style={{ marginTop: 22, textAlign: "center" }}>
          القيم الافتراضية القابلة للتعديل من «السياسات»: تقريب الإذن لأقرب ١٥ دقيقة بعد حد أدنى ٣٠ · بدل الوردية الليلية {ar(cfg.nightShiftAllowance)} ج.م · سماحية الفاتورة {ar(cfg.invoiceTolerancePct)}٪ · تاريخ السريان {ar(settings.policy2026EffectiveFrom ?? "")}
        </p>
      </div>
    </div>
  );
}
