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

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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

  const workerMap = useMemo(() => {
    const map = new Map<string, Worker>();
    workers.forEach((w) => map.set(w.id, w));
    return map;
  }, [workers]);

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

  const daysInGrid = useMemo(() => {
    const year = viewMonth.getFullYear();
    const month = viewMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    let startOffset = firstDay.getDay() - 1;
    if (startOffset < 0) startOffset = 6;

    const cells: { date: Date; isCurrentMonth: boolean; key: string; dayTasks: TaskRow[] }[] = [];

    for (let i = 0; i < startOffset; i++) {
      const d = new Date(year, month, 1 - (startOffset - i));
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      cells.push({ date: d, isCurrentMonth: false, key, dayTasks: tasksByDate.get(key) || [] });
    }

    for (let i = 1; i <= lastDay.getDate(); i++) {
      const d = new Date(year, month, i);
      const key = `${year}-${month}-${i}`;
      cells.push({ date: d, isCurrentMonth: true, key, dayTasks: tasksByDate.get(key) || [] });
    }

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
  const jumpToday = () => {
    const now = new Date();
    setViewMonth(new Date(now.getFullYear(), now.getMonth(), 1));
    onSelectDate(now);
  };

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
      <div className="lg:col-span-2 ui-card p-5">
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-zinc-100">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={prevMonth}
              className="brutal-btn-outline px-2.5 py-1.5"
              aria-label="Previous month"
            >
              ← Prev
            </button>
            <button
              type="button"
              onClick={jumpToday}
              className="brutal-btn-outline px-2.5 py-1.5"
            >
              Today
            </button>
          </div>
          <h2 className="text-base sm:text-lg font-bold tracking-tight text-zinc-950">
            {viewMonth.toLocaleString("default", { month: "long", year: "numeric" })}
          </h2>
          <button
            type="button"
            onClick={nextMonth}
            className="brutal-btn-outline px-2.5 py-1.5"
            aria-label="Next month"
          >
            Next →
          </button>
        </div>

        <div className="grid grid-cols-7 mb-2">
          {DAY_NAMES.map((name) => (
            <div key={name} className="text-center text-[11px] font-semibold uppercase text-zinc-400 tracking-wider">
              {name}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1.5">
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
                className={`min-h-[76px] sm:min-h-[90px] p-2 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${
                  isSelected
                    ? "bg-red-50/70 border-red-500 ring-2 ring-red-500/20"
                    : isToday
                    ? "bg-zinc-50 border-zinc-900"
                    : cell.isCurrentMonth
                    ? "bg-white border-zinc-200/80 hover:border-zinc-300 hover:bg-zinc-50/50"
                    : "bg-zinc-50/40 border-transparent opacity-40 hover:opacity-75"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`font-code text-xs font-semibold ${
                      isSelected
                        ? "text-red-600 font-bold"
                        : isToday
                        ? "bg-zinc-900 text-white px-1.5 py-0.2 rounded-md"
                        : "text-zinc-700"
                    }`}
                  >
                    {cell.date.getDate()}
                  </span>

                  {cell.dayTasks.length > 0 && (
                    <span
                      className={`font-code text-[9px] font-bold px-1.5 py-0.2 rounded-full ${
                        hasUrgent
                          ? "bg-red-600 text-white"
                          : hasPending
                          ? "bg-amber-500 text-white"
                          : "bg-zinc-100 text-zinc-700"
                      }`}
                    >
                      {cell.dayTasks.length}
                    </span>
                  )}
                </div>

                <div className="space-y-1 mt-1.5 overflow-hidden">
                  {cell.dayTasks.slice(0, 2).map((t) => (
                    <div
                      key={t.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectTask(t);
                      }}
                      className={`text-[10px] px-1.5 py-0.5 rounded-md truncate font-medium border ${
                        t.status === "completed"
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200 line-through"
                          : t.status === "pending-approval"
                          ? "bg-amber-50 text-amber-800 border-amber-200"
                          : t.priority === "urgent"
                          ? "bg-red-50 text-red-800 border-red-200"
                          : "bg-zinc-100/80 text-zinc-800 border-zinc-200/80"
                      }`}
                      title={t.title}
                    >
                      {t.title}
                    </div>
                  ))}
                  {cell.dayTasks.length > 2 && (
                    <p className="font-code text-[9px] font-semibold text-zinc-400 text-center">
                      +{cell.dayTasks.length - 2} more
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-4 pt-3 border-t border-zinc-100 flex items-center justify-between text-xs text-zinc-500">
          <span>{selectedDate ? `Selected: ${selectedDate.toLocaleDateString()}` : "Showing full month schedule"}</span>
          {selectedDate && (
            <button
              type="button"
              onClick={() => onSelectDate(null)}
              className="text-red-600 font-semibold hover:underline cursor-pointer"
            >
              Clear date filter
            </button>
          )}
        </div>
      </div>

      {/* Selected Day Inspector Panel (1 Col) */}
      <div className="ui-card p-5">
        <div className="flex items-center justify-between pb-3.5 mb-4 border-b border-zinc-100">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Day Schedule</p>
            <h3 className="text-base font-bold text-zinc-950 mt-0.5">
              {selectedDate
                ? selectedDate.toLocaleDateString("en-US", {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })
                : "Select a Date"}
            </h3>
          </div>
          {selectedDate && (
            <button
              type="button"
              onClick={() => onOpenCreateTask(selectedDateStr)}
              className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-xl shadow-2xs cursor-pointer"
            >
              + Task
            </button>
          )}
        </div>

        {!selectedDate ? (
          <div className="py-12 text-center text-xs text-zinc-400">
            Select any date on the calendar to inspect scheduled directives or assign new work.
          </div>
        ) : selectedDateTasks.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-xs text-zinc-500">No tasks scheduled for this date.</p>
            <button
              type="button"
              onClick={() => onOpenCreateTask(selectedDateStr)}
              className="mt-3 brutal-btn"
            >
              Schedule Task for Date
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
                  className="p-3.5 bg-zinc-50/70 border border-zinc-200/80 rounded-xl hover:border-zinc-400 transition-all cursor-pointer group"
                >
                  <div className="flex items-center justify-between gap-1 mb-1.5">
                    <span
                      className={`text-[10px] font-semibold uppercase px-2 py-0.2 rounded-full border ${
                        STATUS_CONFIG[t.status]?.badge || "bg-zinc-100 text-zinc-700 border-zinc-200"
                      }`}
                    >
                      {STATUS_CONFIG[t.status]?.label || t.status}
                    </span>
                    <span
                      className={`text-[10px] font-semibold uppercase px-2 py-0.2 rounded-full border ${
                        PRIORITY_CONFIG[t.priority]?.badge || "bg-zinc-100 text-zinc-600 border-zinc-200"
                      }`}
                    >
                      {t.priority}
                    </span>
                  </div>

                  <h4 className="text-xs font-semibold text-zinc-950 group-hover:text-red-600 transition-colors">
                    {t.title}
                  </h4>

                  {t.description && (
                    <p className="text-[11px] text-zinc-500 line-clamp-2 mt-1">
                      {stripRichHtml(t.description)}
                    </p>
                  )}

                  {(Boolean(t.startDate) || Boolean(t.dueDate)) && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 font-code text-[10px]">
                      {Boolean(t.startDate) && (
                        <span className="px-2 py-0.5 rounded-md bg-sky-50 text-sky-700 border border-sky-200 font-semibold">
                          ▶ Start: {formatSmartDate(t.startDate).label}
                        </span>
                      )}
                      {Boolean(t.dueDate) && (
                        <span className="px-2 py-0.5 rounded-md bg-zinc-100 text-zinc-700 border border-zinc-200 font-semibold">
                          📅 Due: {formatSmartDate(t.dueDate).label}
                        </span>
                      )}
                    </div>
                  )}

                  {taskWorkers.length > 0 && (
                    <div className="mt-2.5 pt-2 border-t border-zinc-200/70 flex items-center gap-1.5 text-[11px] text-zinc-600">
                      <span>👤</span>
                      <span className="font-medium">{taskWorkers.map((w) => w.firstName).join(", ")}</span>
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
