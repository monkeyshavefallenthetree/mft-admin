import React, { useMemo, useState } from "react";

type TaskRowLike = {
  dueDate?: { toDate?: () => Date } | Date | string | null;
  [key: string]: any;
};

type Props = {
  tasks: TaskRowLike[];
  selectedDate: Date | null;
  onSelectDate: (d: Date | null) => void;
};

const DAY_NAMES = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

export default function TasksCalendar({ tasks, selectedDate, onSelectDate }: Props) {
  // Use selectedDate for current month view, or fallback to today
  const cursorDate = selectedDate || new Date();
  const [viewMonth, setViewMonth] = useState(new Date(cursorDate.getFullYear(), cursorDate.getMonth(), 1));

  // Determine dots for this month
  const datesWithTasks = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) {
      if (!t.dueDate) continue;
      const val = t.dueDate as any;
      const d = typeof val.toDate === "function" ? val.toDate() : new Date(val);
      set.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
    }
    return set;
  }, [tasks]);

  // Build grid
  const daysInGrid = useMemo(() => {
    const year = viewMonth.getFullYear();
    const month = viewMonth.getMonth();
    
    // First day of this month
    const firstDay = new Date(year, month, 1);
    // Last day of this month
    const lastDay = new Date(year, month + 1, 0);

    // Day of week index (0=Sun, 1=Mon, etc) -> Re-map to 0=Mon, 6=Sun
    let startOffset = firstDay.getDay() - 1;
    if (startOffset < 0) startOffset = 6; // Sunday becomes 6

    const cells: { date: Date | null; isCurrentMonth: boolean; hasTask: boolean }[] = [];

    // Padding before
    for (let i = 0; i < startOffset; i++) {
        const d = new Date(year, month, 1 - (startOffset - i));
        cells.push({ date: d, isCurrentMonth: false, hasTask: false });
    }

    // Actual days
    for (let i = 1; i <= lastDay.getDate(); i++) {
      const d = new Date(year, month, i);
      const key = `${year}-${month}-${i}`;
      cells.push({ date: d, isCurrentMonth: true, hasTask: datesWithTasks.has(key) });
    }

    // Padding after to complete rows (7 cols)
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
    <div className="border border-[var(--mft-border)] bg-[var(--mft-surface)] p-6 mb-8 shadow-[4px_4px_0px_0px_#00FF66] lg:max-w-xl mx-auto flex flex-col transition-all">
      {/* Header */}
      <div className="flex justify-between items-center mb-6 border-b border-[var(--mft-border)] pb-4">
        <button type="button" onClick={prevMonth} className="text-white hover:text-[var(--mft-primary)] font-mono text-xs tracking-widest font-bold">
          &lt; PREV
        </button>
        <span className="font-oswald text-2xl tracking-widest uppercase text-[var(--mft-primary)]">
          {viewMonth.toLocaleString('default', { month: 'long', year: 'numeric' })}
        </span>
        <button type="button" onClick={nextMonth} className="text-white hover:text-[var(--mft-primary)] font-mono text-xs tracking-widest font-bold">
          NEXT &gt;
        </button>
      </div>

      {/* Days Row */}
      <div className="grid grid-cols-7 mb-4">
        {DAY_NAMES.map(name => (
          <div key={name} className="text-center font-mono text-[10px] sm:text-xs font-bold text-[var(--mft-muted)] tracking-widest">
            {name}
          </div>
        ))}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-7 gap-y-4 gap-x-2 relative">
        {daysInGrid.map((bgDay, i) => {
            const { date, isCurrentMonth, hasTask } = bgDay;
            if (!date) return <div key={i} />

            // Is selected?
            const isSelected = selectedDate && selectedDate.getFullYear() === date.getFullYear() &&
                               selectedDate.getMonth() === date.getMonth() &&
                               selectedDate.getDate() === date.getDate();

            
            return (
                <div key={i} className="flex flex-col items-center min-h-[44px]">
                    <button 
                        type="button"
                        onClick={() => onSelectDate(isSelected ? null : date)}
                        className={`
                            relative w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center font-mono text-sm leading-none bg-transparent hover:bg-[var(--mft-bg)] transition-colors border
                            ${isSelected ? "bg-[var(--mft-primary)] text-black font-bold border-[var(--mft-primary)]" : "text-white border-transparent hover:border-[var(--mft-border)]"}
                            ${!isCurrentMonth && !isSelected ? "opacity-30" : ""}
                        `}
                        style={{
                            borderRadius: isSelected ? '4px' : '0px'
                        }}
                    >
                        {date.getDate()}
                    </button>
                    {/* Activity Dot underneath */}
                    <div className="h-2 w-full flex justify-center mt-1.5">
                        {hasTask && (
                            <div className={`w-1.5 h-1.5 rounded-sm ${isSelected ? "bg-[#000000]" : "bg-[var(--mft-primary)]"}`} />
                        )}
                    </div>
                </div>
            )
        })}
      </div>
      
      {/* Footer / Context */}
      <div className="mt-6 pt-4 border-t border-[var(--mft-border)] flex justify-between items-center">
        <span className="font-mono text-[10px] text-[var(--mft-muted)] uppercase tracking-widest font-bold">
             {selectedDate ? "FILTERING BY DATE" : "SHOWING ALL"}
        </span>
        {selectedDate && (
            <button type="button" onClick={() => onSelectDate(null)} className="font-mono text-[10px] font-bold tracking-widest text-white hover:text-[var(--mft-primary)]">
                [ CLEAR FILTER ]
            </button>
        )}
      </div>
    </div>
  );
}
