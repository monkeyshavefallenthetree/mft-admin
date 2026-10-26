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

const COLUMNS: Array<{ id: string; label: string; dot: string; borderTop: string; bg: string }> = [
  { id: "assigned", label: "TO DO / ASSIGNED", dot: "#3b82f6", borderTop: "border-blue-500", bg: "bg-blue-50/20" },
  { id: "in-progress", label: "IN PROGRESS", dot: "#f59e0b", borderTop: "border-amber-500", bg: "bg-amber-50/20" },
  { id: "pending-approval", label: "PENDING REVIEW", dot: "#d97706", borderTop: "border-amber-600", bg: "bg-amber-50/30" },
  { id: "completed", label: "COMPLETED", dot: "#10b981", borderTop: "border-emerald-500", bg: "bg-emerald-50/20" },
];

export default function ProjectBoardView({
  tasks,
  workers,
  unreadTaskIdSet,
  onSelectTask,
  onOpenEditTask,
  onDeleteTask,
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
            className={`bg-zinc-50 border-2 rounded-lg shadow-[3px_3px_0px_0px_#09090b] flex flex-col max-h-[82vh] overflow-hidden transition-all ${
              isDraggedOver
                ? "border-dashed border-red-600 bg-red-50/40 ring-2 ring-red-500 scale-[1.01]"
                : isPendingCol && colTasks.length > 0
                ? "border-zinc-900 ring-1 ring-amber-400"
                : "border-zinc-900"
            }`}
          >
            {/* Column Header */}
            <div className={`p-3.5 bg-white border-b-2 border-zinc-900 flex items-center justify-between gap-2 border-t-4 ${col.borderTop}`}>
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: col.dot }} />
                <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-900 truncate">
                  {col.label}
                </h3>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold font-mono bg-zinc-200 text-zinc-700">
                  {colTasks.length}
                </span>
              </div>

              <button
                type="button"
                onClick={() => onQuickAddTask({ status: col.id })}
                className="w-6 h-6 rounded bg-zinc-100 hover:bg-zinc-900 hover:text-white text-zinc-700 flex items-center justify-center text-xs font-bold transition-colors cursor-pointer"
                title={`Add task to ${col.label}`}
              >
                +
              </button>
            </div>

            {/* Column Cards List (Droppable area) */}
            <div className="p-3 space-y-3 overflow-y-auto flex-1 min-h-[140px]">
              {colTasks.length === 0 ? (
                <div className={`border border-dashed rounded p-6 text-center text-xs font-mono transition-colors ${
                  isDraggedOver ? "border-red-500 bg-red-100/50 text-red-900 font-bold" : "border-zinc-300 text-zinc-400"
                }`}>
                  {isDraggedOver ? "Drop task here ⬇" : "No tasks in this column"}
                  {!isDraggedOver && (
                    <button
                      type="button"
                      onClick={() => onQuickAddTask({ status: col.id })}
                      className="block mx-auto mt-2 text-red-600 font-bold hover:underline cursor-pointer"
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
                      className={`bg-white border-2 border-zinc-900 rounded-md p-3.5 shadow-[2px_2px_0px_0px_#09090b] hover:shadow-[4px_4px_0px_0px_#09090b] hover:-translate-y-0.5 transition-all cursor-grab active:cursor-grabbing flex flex-col justify-between group ${
                        isBeingDragged ? "opacity-40 scale-95 border-dashed" : ""
                      } ${isPending ? "border-amber-500 bg-amber-50/30" : ""}`}
                    >
                      {/* Card Top: Department & Priority Flag */}
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {task.projectName && (
                            <span
                              className="text-[9px] font-mono font-bold uppercase px-1.5 py-0.2 bg-red-50 border border-red-200 text-red-700 rounded truncate max-w-[130px]"
                              title={`Project: ${task.projectName}`}
                            >
                              📁 {task.projectName}
                            </span>
                          )}
                          {task.department && (
                            <span className="text-[9px] font-mono font-bold uppercase px-1.5 py-0.2 bg-zinc-100 border border-zinc-200 text-zinc-700 rounded">
                              {task.department}
                            </span>
                          )}
                          <span
                            className={`px-1.5 py-0.2 rounded text-[9px] font-bold uppercase tracking-wider border ${
                              PRIORITY_CONFIG[task.priority]?.badge || "bg-zinc-50 text-zinc-600 border-zinc-200"
                            }`}
                          >
                            {task.priority}
                          </span>
                          {task.subtasks && task.subtasks.length > 0 && (
                            <span
                              className={`text-[9px] font-mono font-bold px-1.5 py-0.2 rounded border ${
                                task.subtasks.every((s) => s.completed)
                                  ? "bg-emerald-50 text-emerald-700 border-emerald-300"
                                  : "bg-zinc-100 text-zinc-700 border-zinc-200"
                              }`}
                            >
                              ☑ {task.subtasks.filter((s) => s.completed).length}/{task.subtasks.length}
                            </span>
                          )}
                        </div>

                        {/* Unread Comms Icon */}
                        {hasUnread && (
                          <span className="flex items-center gap-0.5 text-[9px] font-bold text-red-600 bg-red-100 border border-red-300 px-1.5 py-0.2 rounded animate-pulse">
                            💬 Message
                          </span>
                        )}
                      </div>

                      {/* Card Title */}
                      <h4 className="text-xs font-bold uppercase tracking-wide text-zinc-950 group-hover:text-red-600 transition-colors line-clamp-2">
                        {task.title}
                      </h4>

                      {/* Description Snippet */}
                      {task.description && (
                        <div className="text-[11px] text-zinc-500 font-mono line-clamp-2 mt-1 leading-snug">
                          <LinkifiedText text={task.description} />
                        </div>
                      )}

                      {/* Attached Proof Photo Thumbnail */}
                      {task.photo && (
                        <div className="mt-2 relative rounded overflow-hidden border border-zinc-300 group/img">
                          <img
                            src={task.photo}
                            alt="Proof thumbnail"
                            className="w-full h-20 object-cover group-hover/img:scale-105 transition-transform"
                          />
                          <span className="absolute bottom-1 right-1 bg-black/70 text-white text-[9px] font-bold font-mono px-1.5 py-0.5 rounded">
                            📷 PROOF
                          </span>
                        </div>
                      )}

                      {/* Card Pending Review Alert Bar */}
                      {isPending && (
                        <div className="mt-2.5 pt-2 border-t border-amber-200 bg-amber-50 p-2 rounded flex items-center justify-between gap-1">
                          <span className="text-[9px] font-bold text-amber-900 uppercase">⚠️ Submitted</span>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onApproveTask(task);
                              }}
                              className="px-2 py-0.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[9px] font-bold uppercase rounded cursor-pointer"
                            >
                              ✓ Approve
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onRejectTask(task);
                              }}
                              className="px-2 py-0.5 bg-red-600 hover:bg-red-700 text-white text-[9px] font-bold uppercase rounded cursor-pointer"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Card Footer: Start/Due Date & Assignees */}
                      <div className="mt-3 pt-2.5 border-t border-zinc-100 flex items-center justify-between gap-2 text-xs">
                        {/* Start & Due date */}
                        <div className="flex flex-wrap items-center gap-1">
                          {task.startDate && parseDate(task.startDate) && (
                            <span className="text-[10px] font-mono text-zinc-600 bg-zinc-100 border border-zinc-200 px-1.5 py-0.2 rounded inline-flex items-center gap-1">
                              <span>▶</span>
                              <span>Start {parseDate(task.startDate)!.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                            </span>
                          )}
                          {smartDate.label !== "No date" ? (
                            <span
                              className={`text-[10px] font-mono font-bold px-1.5 py-0.2 rounded border inline-flex items-center gap-1 ${
                                smartDate.isOverdue
                                  ? "bg-red-50 text-red-700 border-red-300"
                                  : smartDate.isToday
                                  ? "bg-amber-50 text-amber-800 border-amber-300"
                                  : "bg-zinc-50 text-zinc-600 border-zinc-200"
                              }`}
                            >
                              <span>{smartDate.isOverdue ? "⚠️" : "📅"}</span>
                              <span>{smartDate.label}</span>
                            </span>
                          ) : (
                            !task.startDate && <span className="text-[10px] text-zinc-400 font-mono italic">No due date</span>
                          )}
                        </div>

                        {/* Assignees Stack */}
                        <div className="flex items-center -space-x-1.5">
                          {taskWorkers.slice(0, 3).map((w) => (
                            <span
                              key={w.id}
                              title={`${w.firstName} ${w.lastName}`}
                              className="w-5 h-5 rounded-full bg-zinc-900 text-white text-[8px] font-bold flex items-center justify-center border border-white uppercase shadow-xs shrink-0"
                            >
                              {w.firstName?.[0] || ""}{w.lastName?.[0] || ""}
                            </span>
                          ))}
                          {taskWorkers.length > 3 && (
                            <span className="w-5 h-5 rounded-full bg-zinc-200 text-zinc-700 text-[8px] font-bold flex items-center justify-center border border-white shrink-0">
                              +{taskWorkers.length - 3}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Card Move Quick Arrows & Drag Indicator */}
                      <div className="mt-2 pt-1.5 border-t border-zinc-100 flex items-center justify-between text-[10px] text-zinc-400">
                        {adjacent.prev ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onQuickUpdateStatus(task.id, adjacent.prev!);
                            }}
                            className="hover:text-zinc-900 font-mono font-bold flex items-center gap-0.5 cursor-pointer"
                            title={`Move back to ${adjacent.prev}`}
                          >
                            ← {STATUS_CONFIG[adjacent.prev]?.label || adjacent.prev}
                          </button>
                        ) : (
                          <span />
                        )}

                        <span className="text-[9px] text-zinc-400 font-mono">⠿ Drag</span>

                        {adjacent.next && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onQuickUpdateStatus(task.id, adjacent.next!);
                            }}
                            className="hover:text-red-600 font-mono font-bold flex items-center gap-0.5 cursor-pointer ml-auto"
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
