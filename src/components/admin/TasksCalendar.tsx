import React, { useMemo, useState } from "react";

type TaskRowLike = {
  dueDate?: { toDate?: () => Date } | Date | string | null;
  [key: string]: unknown;
};

type Props = {
  tasks: TaskRowLike[];
  selectedDate: Date | null;
  onSelectDate: (d: Date | null) => void;
};

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function TasksCalendar({ tasks, selectedDate, onSelectDate }: Props) {
  const cursorDate = selectedDate || new Date();
  const [viewMonth, setViewMonth] = useState(new Date(cursorDate.getFullYear(), cursorDate.getMonth(), 1));

  const datesWithTasks = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) {
      if (!t.dueDate) continue;
      const val = t.dueDate as { toDate?: () => Date } | Date | string;
      const d =
        typeof (val as { toDate?: () => Date }).toDate === "function"
          ? (val as { toDate: () => Date }).toDate()
          : new Date(val as Date | string);
      set.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
    }
    return set;
  }, [tasks]);

  const daysInGrid = useMemo(() => {
    const year = viewMonth.getFullYear();
    const month = viewMonth.getMonth();

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    let startOffset = firstDay.getDay() - 1;
    if (startOffset < 0) startOffset = 6;

    const cells: { date: Date | null; isCurrentMonth: boolean; hasTask: boolean }[] = [];

    for (let i = 0; i < startOffset; i++) {
      const d = new Date(year, month, 1 - (startOffset - i));
      cells.push({ date: d, isCurrentMonth: false, hasTask: false });
    }

    for (let i = 1; i <= lastDay.getDate(); i++) {
      const d = new Date(year, month, i);
      const key = `${year}-${month}-${i}`;
      cells.push({ date: d, isCurrentMonth: true, hasTask: datesWithTasks.has(key) });
    }

    const remainder = cells.length % 7;
    if (remainder > 0) {
      const toAdd = 7 - remainder;
      for (let i = 1; i <= toAdd; i++) {
        const d = new Date(year, month + 1, i);
        cells.push({ date: d, isCurrentMonth: false, hasTask: false });
      }
    }

    return cells;
  }, [viewMonth, datesWithTasks]);

  const prevMonth = () => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1));
  const nextMonth = () => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1));

  return (
    <div className="ui-card p-5 mb-6 lg:max-w-xl mx-auto flex flex-col transition-all">
      {/* Header */}
      <div className="flex justify-between items-center mb-4 border-b border-zinc-100 pb-3.5">
        <button
          type="button"
          onClick={prevMonth}
          className="brutal-btn-outline px-2.5 py-1 text-xs cursor-pointer"
        >
          ← Prev
        </button>
        <span className="text-base font-bold tracking-tight text-zinc-950">
          {viewMonth.toLocaleString("default", { month: "long", year: "numeric" })}
        </span>
        <button
          type="button"
          onClick={nextMonth}
          className="brutal-btn-outline px-2.5 py-1 text-xs cursor-pointer"
        >
          Next →
        </button>
      </div>

      {/* Days Row */}
      <div className="grid grid-cols-7 mb-2">
        {DAY_NAMES.map((name) => (
          <div key={name} className="text-center text-[11px] font-semibold uppercase text-zinc-400 tracking-wider">
            {name}
          </div>
        ))}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-7 gap-y-2.5 gap-x-1.5 relative">
        {daysInGrid.map((bgDay, i) => {
          const { date, isCurrentMonth, hasTask } = bgDay;
          if (!date) return <div key={i} />;

          const isSelected =
            selectedDate &&
            selectedDate.getFullYear() === date.getFullYear() &&
            selectedDate.getMonth() === date.getMonth() &&
            selectedDate.getDate() === date.getDate();

          return (
            <div key={i} className="flex flex-col items-center min-h-[42px]">
              <button
                type="button"
                onClick={() => onSelectDate(isSelected ? null : date)}
                className={`relative w-9 h-9 flex items-center justify-center font-code text-xs rounded-xl transition-all border cursor-pointer ${
                  isSelected
                    ? "bg-red-600 text-white font-bold border-red-600 shadow-2xs"
                    : "text-zinc-900 border-transparent hover:bg-zinc-100 hover:border-zinc-200"
                } ${!isCurrentMonth && !isSelected ? "opacity-30" : ""}`}
              >
                {date.getDate()}
              </button>
              <div className="h-2 w-full flex justify-center mt-1">
                {hasTask && (
                  <div className={`w-1.5 h-1.5 rounded-full ${isSelected ? "bg-red-600" : "bg-red-500"}`} />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer / Context */}
      <div className="mt-4 pt-3 border-t border-zinc-100 flex justify-between items-center text-xs">
        <span className="text-zinc-500 font-medium">
          {selectedDate ? `Filtered: ${selectedDate.toLocaleDateString()}` : "Showing all dates"}
        </span>
        {selectedDate && (
          <button
            type="button"
            onClick={() => onSelectDate(null)}
            className="font-semibold text-red-600 hover:underline cursor-pointer"
          >
            Clear filter
          </button>
        )}
      </div>
    </div>
  );
}
