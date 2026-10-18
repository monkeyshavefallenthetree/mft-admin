"use client";

import { useState, useMemo } from "react";
import {
  TaskRow,
  Worker,
  STATUS_CONFIG,
  PRIORITY_CONFIG,
  getAssigneeIds,
  parseDate,
  formatSmartDate,
} from "./types";
import { stripRichHtml } from "@/components/admin/ui/LinkifiedText";

interface Props {
  tasks: TaskRow[];
  workers: Worker[];
  selectedDate: Date | null;
  onSelectDate: (d: Date | null) => void;
  onSelectTask: (task: TaskRow) => void;
  onOpenCreateTask: (prefillDate?: string) => void;
}

const DAY_NAMES = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

export default function ProjectCalendarView({
  tasks,
  workers,
  selectedDate,
  onSelectDate,
  onSelectTask,
  onOpenCreateTask,
}: Props) {
  const cursorDate = selectedDate || new Date();
  const [viewMonth, setViewMonth] = useState(new Date(cursorDate.getFullYear(), cursorDate.getMonth(), 1));

  const workerMap = new Map<string, Worker>();
  workers.forEach((w) => workerMap.set(w.id, w));

  // Map tasks by date key: YYYY-M-D (both startDate and dueDate)
  const tasksByDate = useMemo(() => {
    const map = new Map<string, TaskRow[]>();
    const addToDate = (d: Date | null, t: TaskRow) => {
      if (!d) return;
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (!map.has(key)) map.set(key, []);
      const list = map.get(key)!;
      if (!list.some((x) => x.id === t.id)) {
        list.push(t);
      }
    };
    for (const t of tasks) {
      addToDate(parseDate(t.startDate), t);
      addToDate(parseDate(t.dueDate), t);
    }
    return map;
  }, [tasks]);

  // Build grid
  const daysInGrid = useMemo(() => {
    const year = viewMonth.getFullYear();
    const month = viewMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    let startOffset = firstDay.getDay() - 1;
    if (startOffset < 0) startOffset = 6;

    const cells: { date: Date; isCurrentMonth: boolean; key: string; dayTasks: TaskRow[] }[] = [];

    // Padding before
    for (let i = 0; i < startOffset; i++) {
      const d = new Date(year, month, 1 - (startOffset - i));
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      cells.push({ date: d, isCurrentMonth: false, key, dayTasks: tasksByDate.get(key) || [] });
    }

    // Days in current month
    for (let i = 1; i <= lastDay.getDate(); i++) {
      const d = new Date(year, month, i);
      const key = `${year}-${month}-${i}`;
      cells.push({ date: d, isCurrentMonth: true, key, dayTasks: tasksByDate.get(key) || [] });
    }

    // Padding after
    const remainder = cells.length % 7;
    if (remainder > 0) {
      const toAdd = 7 - remainder;
      for (let i = 1; i <= toAdd; i++) {
        const d = new Date(year, month + 1, i);
        const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
        cells.push({ date: d, isCurrentMonth: false, key, dayTasks: tasksByDate.get(key) || [] });
      }
    }

    return cells;
  }, [viewMonth, tasksByDate]);

  const prevMonth = () => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1));
  const nextMonth = () => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1));

  // Selected date tasks
  const selectedDateTasks = useMemo(() => {
    if (!selectedDate) return [];
    const key = `${selectedDate.getFullYear()}-${selectedDate.getMonth()}-${selectedDate.getDate()}`;
    return tasksByDate.get(key) || [];
  }, [selectedDate, tasksByDate]);

  const pad = (n: number) => n.toString().padStart(2, "0");
  const selectedDateStr = selectedDate
    ? `${selectedDate.getFullYear()}-${pad(selectedDate.getMonth() + 1)}-${pad(selectedDate.getDate())}`
    : "";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
      {/* Calendar Grid (2 Cols) */}
      <div className="lg:col-span-2 bg-white border-2 border-zinc-900 rounded-lg p-5 shadow-[3px_3px_0px_0px_#09090b]">
        {/* Calendar Nav */}
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-zinc-200">
          <button
            type="button"
            onClick={prevMonth}
            className="px-3 py-1 bg-zinc-100 hover:bg-zinc-900 hover:text-white rounded text-xs font-mono font-bold transition-colors cursor-pointer"
          >
            &lt; PREV
          </button>
          <h2 className="text-xl font-oswald font-bold uppercase tracking-wider text-zinc-950">
            {viewMonth.toLocaleString("default", { month: "long", year: "numeric" })}
          </h2>
          <button
            type="button"
            onClick={nextMonth}
            className="px-3 py-1 bg-zinc-100 hover:bg-zinc-900 hover:text-white rounded text-xs font-mono font-bold transition-colors cursor-pointer"
          >
            NEXT &gt;
          </button>
        </div>

        {/* Days of week */}
        <div className="grid grid-cols-7 mb-2">
          {DAY_NAMES.map((name) => (
            <div key={name} className="text-center font-mono text-[10px] font-bold text-zinc-400 tracking-wider">
              {name}
            </div>
          ))}
        </div>

        {/* Calendar Cells */}
        <div className="grid grid-cols-7 gap-1">
          {daysInGrid.map((cell, idx) => {
            const isSelected =
              selectedDate &&
              selectedDate.getFullYear() === cell.date.getFullYear() &&
              selectedDate.getMonth() === cell.date.getMonth() &&
              selectedDate.getDate() === cell.date.getDate();

            const isToday =
              new Date().getFullYear() === cell.date.getFullYear() &&
              new Date().getMonth() === cell.date.getMonth() &&
              new Date().getDate() === cell.date.getDate();

            const hasPending = cell.dayTasks.some((t) => t.status === "pending-approval");
            const hasUrgent = cell.dayTasks.some((t) => t.priority === "urgent");

            return (
              <div
                key={idx}
                onClick={() => onSelectDate(isSelected ? null : cell.date)}
                className={`min-h-[72px] sm:min-h-[85px] p-1.5 rounded border transition-all cursor-pointer flex flex-col justify-between ${
                  isSelected
                    ? "bg-red-50 border-red-600 ring-2 ring-red-600 shadow-xs"
                    : isToday
                    ? "bg-zinc-50 border-zinc-900 font-bold"
                    : cell.isCurrentMonth
                    ? "bg-white border-zinc-200 hover:border-zinc-400 hover:bg-zinc-50/50"
                    : "bg-zinc-50/40 border-transparent opacity-40 hover:opacity-80"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`text-xs font-mono font-bold ${
                      isSelected
                        ? "text-red-600"
                        : isToday
                        ? "text-zinc-950 underline"
                        : "text-zinc-700"
                    }`}
                  >
                    {cell.date.getDate()}
                  </span>

                  {cell.dayTasks.length > 0 && (
                    <span
                      className={`text-[9px] font-bold font-mono px-1 rounded ${
                        hasUrgent
                          ? "bg-red-600 text-white"
                          : hasPending
                          ? "bg-amber-500 text-white"
                          : "bg-zinc-200 text-zinc-700"
                      }`}
                    >
                      {cell.dayTasks.length}
                    </span>
                  )}
                </div>

                {/* Day Tasks Preview Chips */}
                <div className="space-y-0.5 mt-1 overflow-hidden">
                  {cell.dayTasks.slice(0, 2).map((t) => (
                    <div
                      key={t.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectTask(t);
                      }}
                      className={`text-[9px] font-mono px-1 py-0.2 rounded truncate uppercase font-bold border ${
                        t.status === "completed"
                          ? "bg-emerald-50 text-emerald-800 border-emerald-200 line-through"
                          : t.status === "pending-approval"
                          ? "bg-amber-100 text-amber-900 border-amber-300"
                          : t.priority === "urgent"
                          ? "bg-red-100 text-red-900 border-red-300"
                          : "bg-zinc-100 text-zinc-800 border-zinc-200"
                      }`}
                      title={t.title}
                    >
                      {t.title}
                    </div>
                  ))}
                  {cell.dayTasks.length > 2 && (
                    <p className="text-[8px] font-mono font-bold text-zinc-500 text-center">
                      +{cell.dayTasks.length - 2} more
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="mt-4 pt-3 border-t border-zinc-200 flex items-center justify-between text-xs font-mono text-zinc-500">
          <span>{selectedDate ? `Selected: ${selectedDate.toLocaleDateString()}` : "Showing whole month"}</span>
          {selectedDate && (
            <button
              type="button"
              onClick={() => onSelectDate(null)}
              className="text-red-600 font-bold hover:underline cursor-pointer"
            >
              [ Clear Date Filter ]
            </button>
          )}
        </div>
      </div>

      {/* Selected Day Inspector Panel (1 Col) */}
      <div className="bg-white border-2 border-zinc-900 rounded-lg p-5 shadow-[3px_3px_0px_0px_#09090b]">
        <div className="flex items-center justify-between pb-3 mb-4 border-b border-zinc-200">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 font-mono">Day Schedule</p>
            <h3 className="text-lg font-oswald font-bold uppercase text-zinc-950">
              {selectedDate ? selectedDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }) : "Select a Date"}
            </h3>
          </div>
          {selectedDate && (
            <button
              type="button"
              onClick={() => onOpenCreateTask(selectedDateStr)}
              className="px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white text-[11px] font-bold uppercase rounded shadow-xs cursor-pointer"
            >
              + Task
            </button>
          )}
        </div>

        {!selectedDate ? (
          <div className="py-12 text-center text-xs text-zinc-400 font-mono">
            Click on any date in the calendar to inspect assigned directives and schedule work.
          </div>
        ) : selectedDateTasks.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-xs text-zinc-500 font-mono">No tasks scheduled for this day.</p>
            <button
              type="button"
              onClick={() => onOpenCreateTask(selectedDateStr)}
              className="mt-3 px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-bold uppercase rounded cursor-pointer"
            >
              Schedule Task for this Date
            </button>
          </div>
        ) : (
          <div className="space-y-3 max-h-[480px] overflow-y-auto pr-1">
            {selectedDateTasks.map((t) => {
              const assigneeIds = getAssigneeIds(t.assignedTo);
              const taskWorkers = assigneeIds.map((id) => workerMap.get(id)).filter(Boolean) as Worker[];

              return (
                <div
                  key={t.id}
                  onClick={() => onSelectTask(t)}
                  className="p-3 bg-zinc-50 border border-zinc-200 rounded hover:border-zinc-900 transition-all cursor-pointer group"
                >
                  <div className="flex items-center justify-between gap-1 mb-1.5">
                    <span
                      className={`text-[9px] font-bold uppercase px-1.5 py-0.2 rounded border ${
                        STATUS_CONFIG[t.status]?.badge || "bg-zinc-100 text-zinc-700 border-zinc-200"
                      }`}
                    >
                      {STATUS_CONFIG[t.status]?.label || t.status}
                    </span>
                    <span
                      className={`text-[9px] font-bold uppercase px-1.5 py-0.2 rounded border ${
                        PRIORITY_CONFIG[t.priority]?.badge || "bg-zinc-100 text-zinc-600 border-zinc-200"
                      }`}
                    >
                      {t.priority}
                    </span>
                  </div>

                  <h4 className="text-xs font-bold uppercase text-zinc-950 group-hover:text-red-600 transition-colors">
                    {t.title}
                  </h4>

                  {t.description && (
                    <p className="text-[11px] text-zinc-500 font-mono line-clamp-2 mt-1">
                      {stripRichHtml(t.description)}
                    </p>
                  )}

                  {(Boolean(t.startDate) || Boolean(t.dueDate)) && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] font-mono">
                      {Boolean(t.startDate) && (
                        <span className="px-1.5 py-0.2 rounded bg-sky-50 text-sky-700 border border-sky-200 font-bold">
                          ▶ Start: {formatSmartDate(t.startDate).label}
                        </span>
                      )}
                      {Boolean(t.dueDate) && (
                        <span className="px-1.5 py-0.2 rounded bg-zinc-100 text-zinc-700 border border-zinc-200 font-bold">
                          📅 Due: {formatSmartDate(t.dueDate).label}
                        </span>
                      )}
                    </div>
                  )}

                  {taskWorkers.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-zinc-200 flex items-center gap-1.5 text-[10px] text-zinc-600 font-mono">
                      <span>👤</span>
                      <span>{taskWorkers.map((w) => w.firstName).join(", ")}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
