"use client";

import { type HrSettings, type HolidayItem, getExpectedWorkDaysInPeriod } from "@/lib/admin/hrReports";
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

  const periodStartYmd = periodStart.toISOString().split("T")[0];
  const periodEndYmd = periodEnd.toISOString().split("T")[0];

  const handleFromChange = (val: string) => {
    if (!val) return;
    const start = new Date(val + "T00:00:00");
    onCustomDatesChange(start, periodEnd);
  };

  const handleToChange = (val: string) => {
    if (!val) return;
    const end = new Date(val + "T23:59:59");
    onCustomDatesChange(periodStart, end);
  };

  return (
    <div dir={dir} className="p-3 bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-700 shadow-[3px_3px_0px_0px_#09090b] rounded-lg space-y-3 font-mono text-xs">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Preset Buttons */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase font-bold text-zinc-400 me-1">
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
              className={`px-3 py-1.5 rounded border text-xs font-bold transition-all cursor-pointer ${
                rangeKey === item.key
                  ? "bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950 border-zinc-950 dark:border-zinc-100 shadow-sm"
                  : "bg-zinc-50 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-700"
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
          className="text-zinc-600 dark:text-zinc-300 hover:text-red-600 dark:hover:text-red-400 font-bold flex items-center gap-1 cursor-pointer text-[11px]"
        >
          <span>{t(`⚙️ تغيير يوم بداية الشهر (${settings.monthStartDay})`, `⚙️ Change Cutoff Day (${settings.monthStartDay})`)}</span>
        </button>
      </div>

      {/* Dynamic Date Inputs & Active Period Badge */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-zinc-200 dark:border-zinc-800">
        <div className="flex flex-wrap items-center gap-2">
          {rangeKey === "custom" ? (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={periodStartYmd}
                onChange={(e) => handleFromChange(e.target.value)}
                className="bg-white dark:bg-zinc-800 border-2 border-zinc-900 dark:border-zinc-700 px-2 py-1 text-xs font-bold text-zinc-900 dark:text-zinc-100 rounded focus:outline-none focus:ring-1 focus:ring-red-600"
              />
              <span className="font-bold text-zinc-400">→</span>
              <input
                type="date"
                value={periodEndYmd}
                min={periodStartYmd}
                onChange={(e) => handleToChange(e.target.value)}
                className="bg-white dark:bg-zinc-800 border-2 border-zinc-900 dark:border-zinc-700 px-2 py-1 text-xs font-bold text-zinc-900 dark:text-zinc-100 rounded focus:outline-none focus:ring-1 focus:ring-red-600"
              />
            </div>
          ) : (
            <div className="text-zinc-900 dark:text-white font-bold text-xs flex items-center gap-1.5">
              <span>📅</span>
              <span dir="ltr">
                {periodStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })} –{" "}
                {periodEnd.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </span>
            </div>
          )}
        </div>

        {/* Expected Workdays Pill */}
        <div className="flex items-center gap-2 text-[11px]">
          <span className="px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 font-bold">
            {t(`${expectedDays} يوم عمل فعلي`, `${expectedDays} Expected Workdays`)}
          </span>
          <span className="px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 font-bold">
            {t(`${settings.weekendDays.length} يوم راحة أسبوعي`, `${settings.weekendDays.length} Weekly Rest Day(s)`)}
          </span>
        </div>
      </div>
    </div>
  );
}
