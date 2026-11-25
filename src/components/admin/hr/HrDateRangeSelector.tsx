"use client";

import { type HrSettings, type HolidayItem, getExpectedWorkDaysInPeriod } from "@/lib/admin/hrReports";
import { CAIRO_TZ, cairoEndOfDayMs, cairoStartOfDayMs, cairoYmd } from "@/lib/admin/cairoTime";
import { useHrLang } from "@/lib/admin/hrI18n";

interface Props {
  rangeKey: string;
  onRangeKeyChange: (key: string) => void;
  periodStart: Date;
  periodEnd: Date;
  onCustomDatesChange: (start: Date, end: Date) => void;
  settings: HrSettings;
  holidays: HolidayItem[];
  onOpenPolicyModal: () => void;
}

export default function HrDateRangeSelector({
  rangeKey,
  onRangeKeyChange,
  periodStart,
  periodEnd,
  onCustomDatesChange,
  settings,
  holidays,
  onOpenPolicyModal,
}: Props) {
  const { isAr, dir, t } = useHrLang();
  const expectedDays = getExpectedWorkDaysInPeriod(periodStart, periodEnd, {
    weekendDays: settings.weekendDays,
    holidays,
  });

  const periodStartYmd = cairoYmd(periodStart);
  const periodEndYmd = cairoYmd(periodEnd);

  const handleFromChange = (val: string) => {
    if (!val) return;
    const ms = cairoStartOfDayMs(val);
    if (!Number.isFinite(ms)) return;
    onCustomDatesChange(new Date(ms), periodEnd);
  };

  const handleToChange = (val: string) => {
    if (!val) return;
    const ms = cairoEndOfDayMs(val);
    if (!Number.isFinite(ms)) return;
    onCustomDatesChange(periodStart, new Date(ms));
  };

  return (
    <div dir={dir} className="ui-card p-3.5 space-y-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Preset Buttons */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] uppercase font-semibold text-zinc-400 me-1">
            {t("الفترة:", "Period:")}
          </span>
          {[
            { key: "cycle", ar: `دورة الرواتب الحالية (يوم ${settings.monthStartDay})`, en: `Payroll Cycle (${settings.monthStartDay}th)` },
            { key: "prev-cycle", ar: "الدورة السابقة", en: "Previous Cycle" },
            { key: "month", ar: "الشهر الميلادي (1–آخر الشهر)", en: "Calendar Month" },
            { key: "week", ar: "آخر 7 أيام", en: "Last 7 Days" },
            { key: "custom", ar: "فترة مخصصة", en: "Custom Range" },
          ].map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => onRangeKeyChange(item.key)}
              className={`px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all cursor-pointer ${
                rangeKey === item.key
                  ? "bg-zinc-900 text-white border-zinc-900 shadow-2xs"
                  : "bg-zinc-50/80 text-zinc-700 border-zinc-200 hover:bg-zinc-100"
              }`}
            >
              {isAr ? item.ar : item.en}
            </button>
          ))}
        </div>

        {/* Settings shortcut */}
        <button
          type="button"
          onClick={onOpenPolicyModal}
          className="text-zinc-600 hover:text-red-600 font-semibold flex items-center gap-1 cursor-pointer text-xs"
        >
          <span>{t(`⚙️ تغيير يوم بداية الشهر (${settings.monthStartDay})`, `⚙️ Change Cutoff Day (${settings.monthStartDay})`)}</span>
        </button>
      </div>

      {/* Dynamic Date Inputs & Active Period Badge */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2.5 border-t border-zinc-100">
        <div className="flex flex-wrap items-center gap-2">
          {rangeKey === "custom" ? (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={periodStartYmd}
                onChange={(e) => handleFromChange(e.target.value)}
                className="bg-white border border-zinc-200 px-2.5 py-1 text-xs font-code font-semibold text-zinc-900 rounded-lg focus:outline-none focus:border-zinc-900"
              />
              <span className="font-semibold text-zinc-400">→</span>
              <input
                type="date"
                value={periodEndYmd}
                min={periodStartYmd}
                onChange={(e) => handleToChange(e.target.value)}
                className="bg-white border border-zinc-200 px-2.5 py-1 text-xs font-code font-semibold text-zinc-900 rounded-lg focus:outline-none focus:border-zinc-900"
              />
            </div>
          ) : (
            <div className="text-zinc-900 font-semibold text-xs flex items-center gap-1.5">
              <span>📅</span>
              <span dir="ltr" className="font-code">
                {periodStart.toLocaleDateString("en-US", { timeZone: CAIRO_TZ, month: "short", day: "numeric" })} –{" "}
                {periodEnd.toLocaleDateString("en-US", { timeZone: CAIRO_TZ, month: "short", day: "numeric", year: "numeric" })}
              </span>
            </div>
          )}
        </div>

        {/* Expected Workdays Pill */}
        <div className="flex items-center gap-2 text-[11px]">
          <span className="px-2.5 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 font-semibold">
            {t(`${expectedDays} يوم عمل فعلي`, `${expectedDays} Expected Workdays`)}
          </span>
          <span className="px-2.5 py-0.5 rounded-full bg-zinc-100 border border-zinc-200 text-zinc-600 font-medium">
            {t(`${settings.weekendDays.length} يوم راحة أسبوعي`, `${settings.weekendDays.length} Weekly Rest Day(s)`)}
          </span>
        </div>
      </div>
    </div>
  );
}
