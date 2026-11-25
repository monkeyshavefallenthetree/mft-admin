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
import { stripRichHtml } from "@/components/admin/ui/LinkifiedText";

interface Props {
  tasks: TaskRow[];
  workers: Worker[];
  groupBy: "status" | "priority" | "none";
  unreadTaskIdSet: Set<string>;
  onSelectTask: (task: TaskRow) => void;
  onOpenEditTask: (task: TaskRow) => void;
  onDeleteTask: (taskId: string) => void;
  onApproveTask: (task: TaskRow) => void;
  onRejectTask: (task: TaskRow) => void;
  onQuickUpdateStatus: (taskId: string, newStatus: string) => void;
  onQuickUpdatePriority: (taskId: string, newPriority: string) => void;
  onQuickAddTask: (prefill: { status?: string; priority?: string }) => void;
}

export default function ProjectListView({
  tasks,
  workers,
  groupBy,
  unreadTaskIdSet,
  onSelectTask,
  onOpenEditTask,
  onDeleteTask,
  onApproveTask,
  onRejectTask,
  onQuickUpdateStatus,
  onQuickUpdatePriority,
  onQuickAddTask,
}: Props) {
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [activeDropdown, setActiveDropdown] = useState<{ id: string; type: "status" | "priority" } | null>(null);

  const toggleGroup = (groupKey: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [groupKey]: !prev[groupKey] }));
  };

  const workerMap = new Map<string, Worker>();
  workers.forEach((w) => workerMap.set(w.id, w));

  const groups: Array<{ key: string; label: string; dot: string; tasks: TaskRow[]; badgeStyle?: string }> = [];

  if (groupBy === "status") {
    const statusKeys = ["assigned", "in-progress", "pending-approval", "completed"];
    statusKeys.forEach((k) => {
      const cfg = STATUS_CONFIG[k] || { label: k.toUpperCase(), dot: "#6b7280" };
      const groupTasks = tasks.filter((t) => t.status === k);
      groups.push({
        key: k,
        label: cfg.label,
        dot: cfg.dot,
        tasks: groupTasks,
        badgeStyle: cfg.badge,
      });
    });
  } else if (groupBy === "priority") {
    const priorityKeys = ["urgent", "high", "medium", "low"];
    priorityKeys.forEach((k) => {
      const cfg = PRIORITY_CONFIG[k] || { label: k.toUpperCase(), iconColor: "text-zinc-500" };
      const groupTasks = tasks.filter((t) => t.priority === k);
      groups.push({
        key: k,
        label: `${cfg.label} Priority`,
        dot: k === "urgent" ? "#ef4444" : k === "high" ? "#f97316" : k === "medium" ? "#3b82f6" : "#9ca3af",
        tasks: groupTasks,
      });
    });
  } else {
    groups.push({
      key: "all",
      label: "All Project Directives",
      dot: "#dc2626",
      tasks,
    });
  }

  if (tasks.length === 0) {
    return (
      <div className="ui-card p-12 text-center">
        <div className="w-12 h-12 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center mx-auto mb-3 border border-red-100">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
        </div>
        <h3 className="text-base font-bold text-zinc-950">No directives in this view</h3>
        <p className="text-xs text-zinc-500 mt-1 max-w-sm mx-auto">
          Get started by adding task directives, assigning team members, and setting target deadlines.
        </p>
        <button
          type="button"
          onClick={() => onQuickAddTask({})}
          className="mt-4 px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-semibold text-xs rounded-xl shadow-2xs cursor-pointer inline-flex items-center gap-1.5"
        >
          <span>+ Create First Task</span>
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {groups.map((grp) => {
        const isCollapsed = collapsedGroups[grp.key];
        return (
          <div key={grp.key} className="ui-card overflow-visible">
            {/* Group Header */}
            <div className="px-4 py-3 bg-zinc-50/80 border-b border-zinc-100 rounded-t-2xl flex items-center justify-between gap-3 select-none">
              <div
                className="flex items-center gap-2.5 cursor-pointer flex-1"
                onClick={() => toggleGroup(grp.key)}
              >
                <button
                  type="button"
                  aria-label={isCollapsed ? `Expand ${grp.label}` : `Collapse ${grp.label}`}
                  className="text-zinc-400 hover:text-zinc-900 transition-transform cursor-pointer"
                >
                  <svg
                    className={`w-3.5 h-3.5 transform transition-transform ${isCollapsed ? "-rotate-90" : "rotate-0"}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: grp.dot }} />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-900">
                    {grp.label}
                  </h3>
                  <span className="font-code text-[11px] font-semibold text-zinc-600 bg-zinc-200/70 px-2 py-0.2 rounded-full">
                    {grp.tasks.length}
                  </span>
                </div>

                {grp.key === "pending-approval" && grp.tasks.length > 0 && (
                  <span className="px-2 py-0.5 bg-amber-50 border border-amber-300 text-amber-800 text-[10px] font-semibold rounded-full">
                    ⚠️ Needs Review
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={() => onQuickAddTask(groupBy === "status" ? { status: grp.key } : { priority: grp.key })}
                className="text-xs font-semibold text-zinc-500 hover:text-red-600 transition-colors cursor-pointer flex items-center gap-1"
              >
                <span>+ Add Task</span>
              </button>
            </div>

            {/* Tasks List */}
            {!isCollapsed && (
              <div className="divide-y divide-zinc-100">
                <div className="grid grid-cols-12 gap-3 px-4 py-2 bg-zinc-50/40 text-[11px] font-semibold text-zinc-500">
                  <div className="col-span-12 sm:col-span-5">Directive</div>
                  <div className="hidden sm:block sm:col-span-2">Assignees</div>
                  <div className="hidden sm:block sm:col-span-2">Schedule</div>
                  <div className="hidden sm:block sm:col-span-1 text-center">Priority</div>
                  <div className="hidden sm:block sm:col-span-2 text-right">Status & Actions</div>
                </div>

                {grp.tasks.length === 0 ? (
                  <div className="py-6 text-center text-xs text-zinc-400">
                    No tasks in {grp.label.toLowerCase()}
                  </div>
                ) : (
                  grp.tasks.map((task) => {
                    const assigneeIds = getAssigneeIds(task.assignedTo);
                    const taskWorkers = assigneeIds.map((id) => workerMap.get(id)).filter(Boolean) as Worker[];
                    const smartDate = formatSmartDate(task.dueDate);
                    const hasUnread = unreadTaskIdSet.has(task.id);
                    const isPending = task.status === "pending-approval";
                    const isStatusMenuOpen = activeDropdown?.id === task.id && activeDropdown.type === "status";
                    const isPriorityMenuOpen = activeDropdown?.id === task.id && activeDropdown.type === "priority";

                    return (
                      <div
                        key={task.id}
                        onClick={() => onSelectTask(task)}
                        className={`grid grid-cols-12 gap-3 px-4 py-3 items-center hover:bg-zinc-50/80 transition-colors cursor-pointer group ${
                          isPending ? "bg-amber-50/25" : ""
                        }`}
                      >
                        {/* Task Title & Tags */}
                        <div className="col-span-12 sm:col-span-5 flex items-start gap-2.5 min-w-0">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              const nextStatus = task.status === "completed" ? "in-progress" : "completed";
                              onQuickUpdateStatus(task.id, nextStatus);
                            }}
                            title={task.status === "completed" ? "Mark incomplete" : "Mark completed"}
                            className={`mt-0.5 w-4 h-4 rounded-md border flex items-center justify-center shrink-0 transition-all cursor-pointer ${
                              task.status === "completed"
                                ? "bg-emerald-600 border-emerald-600 text-white"
                                : "border-zinc-300 hover:border-emerald-600 bg-white"
                            }`}
                          >
                            {task.status === "completed" && (
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </button>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span
                                className={`text-xs font-semibold truncate ${
                                  task.status === "completed"
                                    ? "line-through text-zinc-400"
                                    : "text-zinc-950 group-hover:text-red-600"
                                }`}
                              >
                                {task.title}
                              </span>

                              {task.department && (
                                <span className="text-[10px] font-medium capitalize px-1.5 py-0.2 bg-zinc-100 border border-zinc-200/80 text-zinc-600 rounded-md">
                                  {task.department}
                                </span>
                              )}

                              {task.photo && (
                                <span
                                  title="Has attached proof image"
                                  className="text-[10px] px-1.5 py-0.2 bg-purple-50 text-purple-700 border border-purple-200 rounded-md font-semibold"
                                >
                                  📷 Proof
                                </span>
                              )}

                              {task.subtasks && task.subtasks.length > 0 && (
                                <span
                                  title="Checklist / Subtasks progress"
                                  className={`font-code text-[10px] px-1.5 py-0.2 rounded-md border font-semibold ${
                                    task.subtasks.every((s) => s.completed)
                                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                      : "bg-zinc-100 text-zinc-700 border-zinc-200"
                                  }`}
                                >
                                  ☑ {task.subtasks.filter((s) => s.completed).length}/{task.subtasks.length}
                                </span>
                              )}

                              {hasUnread && (
                                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 bg-red-50 border border-red-200 text-red-700 text-[10px] font-semibold rounded-md">
                                  💬 Comms
                                </span>
                              )}
                            </div>

                            {task.description && (
                              <p className="text-[11px] text-zinc-500 truncate max-w-md mt-0.5">
                                {stripRichHtml(task.description)}
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Assignees */}
                        <div className="col-span-6 sm:col-span-2 flex items-center gap-1.5 overflow-hidden">
                          {taskWorkers.length === 0 ? (
                            <span className="text-[11px] text-zinc-400">Unassigned</span>
                          ) : (
                            <div className="flex items-center -space-x-1.5">
                              {taskWorkers.slice(0, 3).map((w) => (
                                <span
                                  key={w.id}
                                  title={`${w.firstName} ${w.lastName}`}
                                  className="w-6 h-6 rounded-full bg-zinc-900 text-white text-[9px] font-bold flex items-center justify-center border-2 border-white uppercase shadow-2xs shrink-0"
                                >
                                  {w.firstName?.[0] || ""}{w.lastName?.[0] || ""}
                                </span>
                              ))}
                              {taskWorkers.length > 3 && (
                                <span className="w-6 h-6 rounded-full bg-zinc-100 text-zinc-700 text-[9px] font-bold flex items-center justify-center border-2 border-white shrink-0">
                                  +{taskWorkers.length - 3}
                                </span>
                              )}
                              <span className="text-xs text-zinc-700 font-medium truncate ml-2">
                                {taskWorkers[0].firstName}
                                {taskWorkers.length > 1 ? ` +${taskWorkers.length - 1}` : ""}
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Start / Due Date */}
                        <div className="col-span-6 sm:col-span-2 flex flex-col items-start gap-1">
                          {task.startDate && parseDate(task.startDate) && (
                            <span className="font-code text-[10px] text-zinc-600 bg-zinc-100 border border-zinc-200/80 px-1.5 py-0.2 rounded-md inline-flex items-center gap-1">
                              <span>▶</span>
                              <span>{parseDate(task.startDate)!.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                            </span>
                          )}
                          {smartDate.label === "No date" ? (
                            !task.startDate && <span className="text-[11px] text-zinc-400">—</span>
                          ) : (
                            <span
                              className={`font-code text-[11px] font-semibold px-2 py-0.5 rounded-lg border inline-flex items-center gap-1 ${
                                smartDate.isOverdue
                                  ? "bg-red-50 text-red-700 border-red-200"
                                  : smartDate.isToday
                                  ? "bg-amber-50 text-amber-800 border-amber-200"
                                  : "bg-zinc-50 text-zinc-700 border-zinc-200/80"
                              }`}
                            >
                              <span>{smartDate.isOverdue ? "⚠️" : "📅"}</span>
                              <span>{smartDate.label}</span>
                            </span>
                          )}
                        </div>

                        {/* Priority Pill */}
                        <div className="col-span-4 sm:col-span-1 flex justify-center relative">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveDropdown(
                                isPriorityMenuOpen ? null : { id: task.id, type: "priority" }
                              );
                            }}
                            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border cursor-pointer transition-all ${
                              PRIORITY_CONFIG[task.priority]?.badge || "bg-zinc-50 text-zinc-600 border-zinc-200"
                            }`}
                          >
                            {task.priority}
                          </button>

                          {isPriorityMenuOpen && (
                            <div className="absolute top-7 z-50 bg-white border border-zinc-200 shadow-lg rounded-xl py-1 w-32 text-left animate-scale-in">
                              {["urgent", "high", "medium", "low"].map((pr) => (
                                <button
                                  key={pr}
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onQuickUpdatePriority(task.id, pr);
                                    setActiveDropdown(null);
                                  }}
                                  className="w-full text-left px-3 py-1.5 text-xs capitalize font-semibold hover:bg-zinc-50 flex items-center gap-2 cursor-pointer"
                                >
                                  <span>{pr === "urgent" ? "🔴" : pr === "high" ? "🟠" : pr === "medium" ? "🔵" : "⚪"}</span>
                                  <span>{pr}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Status / Quick Actions */}
                        <div className="col-span-8 sm:col-span-2 flex items-center justify-end gap-1.5 relative">
                          {isPending ? (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onApproveTask(task);
                                }}
                                title="Approve Directive"
                                className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-semibold rounded-lg cursor-pointer shadow-2xs"
                              >
                                ✓ Approve
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onRejectTask(task);
                                }}
                                title="Reject with feedback"
                                className="px-2 py-1 bg-red-50 hover:bg-red-600 text-red-700 hover:text-white border border-red-200 text-[10px] font-semibold rounded-lg cursor-pointer"
                              >
                                ✕
                              </button>
                            </div>
                          ) : (
                            <div className="relative">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActiveDropdown(
                                    isStatusMenuOpen ? null : { id: task.id, type: "status" }
                                  );
                                }}
                                className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border cursor-pointer ${
                                  STATUS_CONFIG[task.status]?.badge || "bg-zinc-50 text-zinc-700 border-zinc-200"
                                }`}
                              >
                                {STATUS_CONFIG[task.status]?.label || task.status}
                              </button>

                              {isStatusMenuOpen && (
                                <div className="absolute right-0 top-7 z-50 bg-white border border-zinc-200 shadow-lg rounded-xl py-1 w-40 text-left animate-scale-in">
                                  {["assigned", "in-progress", "pending-approval", "completed"].map((st) => (
                                    <button
                                      key={st}
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onQuickUpdateStatus(task.id, st);
                                        setActiveDropdown(null);
                                      }}
                                      className="w-full text-left px-3 py-1.5 text-xs font-semibold hover:bg-zinc-50 flex items-center gap-2 cursor-pointer"
                                    >
                                      <span
                                        className="w-2 h-2 rounded-full"
                                        style={{ backgroundColor: STATUS_CONFIG[st]?.dot || "#6b7280" }}
                                      />
                                      <span>{STATUS_CONFIG[st]?.label || st}</span>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenEditTask(task);
                            }}
                            title="Edit task directive"
                            aria-label="Edit task directive"
                            className="p-1.5 text-zinc-400 hover:text-zinc-900 rounded-lg hover:bg-zinc-100 transition-colors cursor-pointer"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                            </svg>
                          </button>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteTask(task.id);
                            }}
                            title="Delete task"
                            aria-label="Delete task"
                            className="p-1.5 text-zinc-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors cursor-pointer"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}

                {/* Inline Quick Add Button Row */}
                <div className="px-4 py-2.5 bg-zinc-50/40 hover:bg-zinc-50 border-t border-zinc-100 rounded-b-2xl transition-colors">
                  <button
                    type="button"
                    onClick={() => onQuickAddTask(groupBy === "status" ? { status: grp.key } : { priority: grp.key })}
                    className="w-full text-left text-xs text-zinc-500 hover:text-red-600 font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <span>+</span>
                    <span>Add directive to {grp.label}...</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
