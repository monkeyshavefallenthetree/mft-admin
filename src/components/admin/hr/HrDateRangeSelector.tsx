"use client";

import { type HrSettings, type HolidayItem, getExpectedWorkDaysInPeriod } from "@/lib/admin/hrReports";

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
    <div className="p-3 bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-700 shadow-[3px_3px_0px_0px_#09090b] rounded-lg space-y-3 font-mono text-xs">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Preset Buttons */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase font-bold text-zinc-400 mr-1">Period:</span>
          {[
            { key: "cycle", label: `Payroll Cycle (${settings.monthStartDay}th)`, desc: "Active month cycle" },
            { key: "prev-cycle", label: "Prev Cycle", desc: "Last month" },
            { key: "month", label: "Calendar Month", desc: "1st to End" },
            { key: "week", label: "This Week", desc: "Last 7 days" },
            { key: "custom", label: "Custom Range", desc: "Pick dates" },
          ].map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => onRangeKeyChange(item.key)}
              className={`px-3 py-1.5 rounded border text-xs font-bold uppercase transition-all cursor-pointer ${
                rangeKey === item.key
                  ? "bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950 border-zinc-950 dark:border-zinc-100 shadow-sm"
                  : "bg-zinc-50 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-700"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* Settings button */}
        <button
          type="button"
          onClick={onOpenPolicyModal}
          className="text-zinc-600 dark:text-zinc-300 hover:text-red-600 dark:hover:text-red-400 font-bold uppercase tracking-wider flex items-center gap-1 cursor-pointer text-[11px]"
        >
          <span>⚙️ Cycle Cutoff (Day {settings.monthStartDay})</span>
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
                className="bg-white dark:bg-zinc-800 border-2 border-zinc-900 dark:border-zinc-700 px-2 py-1 text-xs font-bold text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-red-600"
              />
              <span className="font-bold text-zinc-400">→</span>
              <input
                type="date"
                value={periodEndYmd}
                min={periodStartYmd}
                onChange={(e) => handleToChange(e.target.value)}
                className="bg-white dark:bg-zinc-800 border-2 border-zinc-900 dark:border-zinc-700 px-2 py-1 text-xs font-bold text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-red-600"
              />
            </div>
          ) : (
            <div className="text-zinc-900 dark:text-white font-bold text-xs flex items-center gap-1.5">
              <span>📅</span>
              <span>
                {periodStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })} –{" "}
                {periodEnd.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </span>
            </div>
          )}
        </div>

        {/* Expected Workdays Pill */}
        <div className="flex items-center gap-2 text-[11px]">
          <span className="px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 font-bold">
            {expectedDays} Expected Workdays
          </span>
          <span className="px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 font-bold">
            {settings.weekendDays.length * 4} Rest Days
          </span>
        </div>
      </div>
    </div>
  );
}
