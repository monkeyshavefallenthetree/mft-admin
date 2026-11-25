"use client";

import { useState } from "react";
import {
  TaskRow,
  Worker,
  STATUS_CONFIG,
  PRIORITY_CONFIG,
  getAssigneeIds,
  formatSmartDate,
  parseDate,
} from "./types";
import LinkifiedText from "@/components/admin/ui/LinkifiedText";

interface Props {
  tasks: TaskRow[];
  workers: Worker[];
  unreadTaskIdSet: Set<string>;
  onSelectTask: (task: TaskRow) => void;
  onOpenEditTask: (task: TaskRow) => void;
  onDeleteTask: (taskId: string) => void;
  onApproveTask: (task: TaskRow) => void;
  onRejectTask: (task: TaskRow) => void;
  onQuickUpdateStatus: (taskId: string, newStatus: string) => void;
  onQuickAddTask: (prefill: { status: string }) => void;
}

const COLUMNS: Array<{ id: string; label: string; dot: string; accentBar: string }> = [
  { id: "assigned", label: "Assigned", dot: "#3b82f6", accentBar: "bg-blue-500" },
  { id: "in-progress", label: "In Progress", dot: "#f59e0b", accentBar: "bg-amber-500" },
  { id: "pending-approval", label: "Pending Review", dot: "#d97706", accentBar: "bg-orange-500" },
  { id: "completed", label: "Completed", dot: "#10b981", accentBar: "bg-emerald-500" },
];

export default function ProjectBoardView({
  tasks,
  workers,
  unreadTaskIdSet,
  onSelectTask,
  onApproveTask,
  onRejectTask,
  onQuickUpdateStatus,
  onQuickAddTask,
}: Props) {
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dragOverColId, setDragOverColId] = useState<string | null>(null);

  const workerMap = new Map<string, Worker>();
  workers.forEach((w) => workerMap.set(w.id, w));

  const getAdjacentStatuses = (curr: string) => {
    const order = ["assigned", "in-progress", "pending-approval", "completed"];
    const idx = order.indexOf(curr);
    return {
      prev: idx > 0 ? order[idx - 1] : null,
      next: idx < order.length - 1 ? order[idx + 1] : null,
    };
  };

  const handleDragStart = (e: React.DragEvent, taskId: string) => {
    e.dataTransfer.setData("text/plain", taskId);
    setDraggedTaskId(taskId);
  };

  const handleDragOver = (e: React.DragEvent, colId: string) => {
    e.preventDefault();
    if (dragOverColId !== colId) {
      setDragOverColId(colId);
    }
  };

  const handleDragLeave = (_e: React.DragEvent, colId: string) => {
    if (dragOverColId === colId) {
      setDragOverColId(null);
    }
  };

  const handleDrop = (e: React.DragEvent, colId: string) => {
    e.preventDefault();
    const taskId = e.dataTransfer.getData("text/plain") || draggedTaskId;
    setDragOverColId(null);
    setDraggedTaskId(null);
    if (taskId) {
      onQuickUpdateStatus(taskId, colId);
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 items-start">
      {COLUMNS.map((col) => {
        const colTasks = tasks.filter((t) => t.status === col.id);
        const isPendingCol = col.id === "pending-approval";
        const isDraggedOver = dragOverColId === col.id;

        return (
          <div
            key={col.id}
            onDragOver={(e) => handleDragOver(e, col.id)}
            onDragLeave={(e) => handleDragLeave(e, col.id)}
            onDrop={(e) => handleDrop(e, col.id)}
            className={`rounded-2xl border bg-zinc-50/70 flex flex-col max-h-[82vh] overflow-hidden transition-all ${
              isDraggedOver
                ? "border-dashed border-red-500 bg-red-50/30 ring-2 ring-red-500/30"
                : isPendingCol && colTasks.length > 0
                ? "border-amber-300/90"
                : "border-zinc-200/85"
            }`}
          >
            {/* Top Accent Bar */}
            <div className={`h-1 w-full ${col.accentBar}`} />

            {/* Column Header */}
            <div className="p-3.5 bg-white border-b border-zinc-100 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: col.dot }} />
                <h3 className="text-xs font-bold text-zinc-900 truncate">
                  {col.label}
                </h3>
                <span className="px-2 py-0.2 rounded-full text-[11px] font-semibold font-code bg-zinc-100 text-zinc-700">
                  {colTasks.length}
                </span>
              </div>

              <button
                type="button"
                onClick={() => onQuickAddTask({ status: col.id })}
                className="w-6 h-6 rounded-lg bg-zinc-100 hover:bg-zinc-900 hover:text-white text-zinc-700 flex items-center justify-center text-xs font-bold transition-colors cursor-pointer"
                title={`Add task to ${col.label}`}
                aria-label={`Add task to ${col.label}`}
              >
                +
              </button>
            </div>

            {/* Column Cards List */}
            <div className="p-3 space-y-2.5 overflow-y-auto flex-1 min-h-[150px]">
              {colTasks.length === 0 ? (
                <div
                  className={`border border-dashed rounded-xl p-6 text-center text-xs transition-colors ${
                    isDraggedOver
                      ? "border-red-400 bg-red-50/60 text-red-900 font-semibold"
                      : "border-zinc-200 text-zinc-400"
                  }`}
                >
                  {isDraggedOver ? "Drop task here ⬇" : "No directives in stage"}
                  {!isDraggedOver && (
                    <button
                      type="button"
                      onClick={() => onQuickAddTask({ status: col.id })}
                      className="block mx-auto mt-2 text-red-600 font-semibold hover:underline cursor-pointer"
                    >
                      + Add Directive
                    </button>
                  )}
                </div>
              ) : (
                colTasks.map((task) => {
                  const assigneeIds = getAssigneeIds(task.assignedTo);
                  const taskWorkers = assigneeIds.map((id) => workerMap.get(id)).filter(Boolean) as Worker[];
                  const smartDate = formatSmartDate(task.dueDate);
                  const hasUnread = unreadTaskIdSet.has(task.id);
                  const adjacent = getAdjacentStatuses(task.status);
                  const isPending = task.status === "pending-approval";
                  const isBeingDragged = draggedTaskId === task.id;

                  return (
                    <div
                      key={task.id}
                      draggable={true}
                      onDragStart={(e) => handleDragStart(e, task.id)}
                      onClick={() => onSelectTask(task)}
                      className={`ui-card ui-card-hover p-3.5 cursor-grab active:cursor-grabbing flex flex-col justify-between group ${
                        isBeingDragged ? "opacity-40 scale-95 border-dashed" : ""
                      } ${isPending ? "border-amber-300 bg-amber-50/20" : ""}`}
                    >
                      {/* Card Top: Department & Priority */}
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {task.projectName && (
                            <span
                              className="text-[10px] font-medium px-2 py-0.2 bg-red-50 border border-red-100 text-red-700 rounded-md truncate max-w-[130px]"
                              title={`Project: ${task.projectName}`}
                            >
                              {task.projectName}
                            </span>
                          )}
                          {task.department && (
                            <span className="text-[10px] font-medium capitalize px-1.5 py-0.2 bg-zinc-100 border border-zinc-200/80 text-zinc-600 rounded-md">
                              {task.department}
                            </span>
                          )}
                          <span
                            className={`px-2 py-0.2 rounded-full text-[10px] font-semibold uppercase tracking-wider border ${
                              PRIORITY_CONFIG[task.priority]?.badge || "bg-zinc-50 text-zinc-600 border-zinc-200"
                            }`}
                          >
                            {task.priority}
                          </span>
                          {task.subtasks && task.subtasks.length > 0 && (
                            <span
                              className={`font-code text-[10px] font-semibold px-1.5 py-0.2 rounded-md border ${
                                task.subtasks.every((s) => s.completed)
                                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                  : "bg-zinc-100 text-zinc-700 border-zinc-200"
                              }`}
                            >
                              ☑ {task.subtasks.filter((s) => s.completed).length}/{task.subtasks.length}
                            </span>
                          )}
                        </div>

                        {hasUnread && (
                          <span className="flex items-center gap-0.5 text-[10px] font-semibold text-red-600 bg-red-50 border border-red-200 px-1.5 py-0.2 rounded-md">
                            💬
                          </span>
                        )}
                      </div>

                      {/* Card Title */}
                      <h4 className="text-xs font-semibold text-zinc-950 group-hover:text-red-600 transition-colors line-clamp-2">
                        {task.title}
                      </h4>

                      {/* Description Snippet */}
                      {task.description && (
                        <div className="text-[11px] text-zinc-500 line-clamp-2 mt-1 leading-snug">
                          <LinkifiedText text={task.description} />
                        </div>
                      )}

                      {/* Attached Proof Photo Thumbnail */}
                      {task.photo && (
                        <div className="mt-2.5 relative rounded-xl overflow-hidden border border-zinc-200 group/img">
                          <img
                            src={task.photo}
                            alt="Proof thumbnail"
                            className="w-full h-20 object-cover group-hover/img:scale-105 transition-transform"
                          />
                          <span className="absolute bottom-1.5 right-1.5 bg-zinc-950/75 text-white text-[10px] font-semibold px-2 py-0.5 rounded-md backdrop-blur-xs">
                            📷 Proof
                          </span>
                        </div>
                      )}

                      {/* Card Pending Review Alert Bar */}
                      {isPending && (
                        <div className="mt-2.5 pt-2 border-t border-amber-200/80 bg-amber-50/70 p-2 rounded-lg flex items-center justify-between gap-1">
                          <span className="text-[10px] font-semibold text-amber-900">Ready for review</span>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onApproveTask(task);
                              }}
                              className="px-2 py-0.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-semibold rounded-md cursor-pointer"
                            >
                              ✓ Approve
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onRejectTask(task);
                              }}
                              className="px-2 py-0.5 bg-red-50 hover:bg-red-600 text-red-700 hover:text-white border border-red-200 text-[10px] font-semibold rounded-md cursor-pointer"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Card Footer: Due Date & Assignees */}
                      <div className="mt-3 pt-2.5 border-t border-zinc-100 flex items-center justify-between gap-2 text-xs">
                        <div className="flex flex-wrap items-center gap-1">
                          {task.startDate && parseDate(task.startDate) && (
                            <span className="font-code text-[10px] text-zinc-600 bg-zinc-100 border border-zinc-200/80 px-1.5 py-0.2 rounded-md inline-flex items-center gap-1">
                              <span>▶</span>
                              <span>{parseDate(task.startDate)!.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                            </span>
                          )}
                          {smartDate.label !== "No date" ? (
                            <span
                              className={`font-code text-[10px] font-semibold px-2 py-0.2 rounded-md border inline-flex items-center gap-1 ${
                                smartDate.isOverdue
                                  ? "bg-red-50 text-red-700 border-red-200"
                                  : smartDate.isToday
                                  ? "bg-amber-50 text-amber-800 border-amber-200"
                                  : "bg-zinc-50 text-zinc-600 border-zinc-200/80"
                              }`}
                            >
                              <span>{smartDate.isOverdue ? "⚠️" : "📅"}</span>
                              <span>{smartDate.label}</span>
                            </span>
                          ) : (
                            !task.startDate && <span className="text-[11px] text-zinc-400">No due date</span>
                          )}
                        </div>

                        <div className="flex items-center -space-x-1.5">
                          {taskWorkers.slice(0, 3).map((w) => (
                            <span
                              key={w.id}
                              title={`${w.firstName} ${w.lastName}`}
                              className="w-5 h-5 rounded-full bg-zinc-900 text-white text-[8px] font-bold flex items-center justify-center border border-white uppercase shadow-2xs shrink-0"
                            >
                              {w.firstName?.[0] || ""}{w.lastName?.[0] || ""}
                            </span>
                          ))}
                          {taskWorkers.length > 3 && (
                            <span className="w-5 h-5 rounded-full bg-zinc-100 text-zinc-700 text-[8px] font-bold flex items-center justify-center border border-white shrink-0">
                              +{taskWorkers.length - 3}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Quick Stage Move Arrows */}
                      <div className="mt-2 pt-1.5 border-t border-zinc-100/80 flex items-center justify-between text-[10px] text-zinc-400">
                        {adjacent.prev ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onQuickUpdateStatus(task.id, adjacent.prev!);
                            }}
                            className="hover:text-zinc-900 font-medium flex items-center gap-0.5 cursor-pointer"
                            title={`Move back to ${adjacent.prev}`}
                          >
                            ← {STATUS_CONFIG[adjacent.prev]?.label || adjacent.prev}
                          </button>
                        ) : (
                          <span />
                        )}

                        <span className="text-[10px] text-zinc-300">⠿</span>

                        {adjacent.next && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onQuickUpdateStatus(task.id, adjacent.next!);
                            }}
                            className="hover:text-red-600 font-medium flex items-center gap-0.5 cursor-pointer ml-auto"
                            title={`Move next to ${adjacent.next}`}
                          >
                            {STATUS_CONFIG[adjacent.next]?.label || adjacent.next} →
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
