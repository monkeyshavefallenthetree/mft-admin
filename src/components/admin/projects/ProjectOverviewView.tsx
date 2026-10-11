"use client";

import { useMemo } from "react";
import {
  Project,
  TaskRow,
  Worker,
  STATUS_CONFIG,
  PRIORITY_CONFIG,
  getAssigneeIds,
  parseDate,
} from "./types";

interface Props {
  project: Project;
  tasks: TaskRow[];
  workers: Worker[];
  onSelectTask: (task: TaskRow) => void;
  onApproveTask: (task: TaskRow) => void;
  onRejectTask: (task: TaskRow) => void;
  onOpenCreateTask: () => void;
}

export default function ProjectOverviewView({
  project,
  tasks,
  workers,
  onSelectTask,
  onApproveTask,
  onRejectTask,
  onOpenCreateTask,
}: Props) {
  const workerMap = new Map<string, Worker>();
  workers.forEach((w) => workerMap.set(w.id, w));

  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((t) => t.status === "completed");
  const inProgressTasks = tasks.filter((t) => ["assigned", "in-progress"].includes(t.status));
  const pendingTasks = tasks.filter((t) => t.status === "pending-approval");

  const progressPercent = totalTasks > 0 ? Math.round((completedTasks.length / totalTasks) * 100) : 0;

  // Overdue tasks
  const overdueTasks = useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return tasks.filter((t) => {
      if (t.status === "completed") return false;
      const d = parseDate(t.dueDate);
      if (!d) return false;
      return d < now;
    });
  }, [tasks]);

  // Workload by worker
  const workerWorkload = useMemo(() => {
    const map = new Map<
      string,
      { worker: Worker; total: number; completed: number; active: number; pending: number }
    >();

    for (const t of tasks) {
      const ids = getAssigneeIds(t.assignedTo);
      for (const id of ids) {
        const w = workerMap.get(id);
        if (!w) continue;
        if (!map.has(id)) {
          map.set(id, { worker: w, total: 0, completed: 0, active: 0, pending: 0 });
        }
        const rec = map.get(id)!;
        rec.total += 1;
        if (t.status === "completed") rec.completed += 1;
        else if (t.status === "pending-approval") rec.pending += 1;
        else rec.active += 1;
      }
    }

    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [tasks, workers]);

  return (
    <div className="space-y-6">
      {/* Top Overview KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Directives */}
        <div className="bg-white border-2 border-zinc-900 rounded-lg p-4 shadow-[3px_3px_0px_0px_#09090b]">
          <p className="text-[10px] font-bold font-mono text-zinc-500 uppercase tracking-widest">Total Directives</p>
          <p className="text-3xl font-oswald font-bold text-zinc-950 mt-1">{totalTasks}</p>
          <p className="text-[11px] font-mono text-zinc-500 mt-1">In this project</p>
        </div>

        {/* Progress Rate */}
        <div className="bg-white border-2 border-zinc-900 rounded-lg p-4 shadow-[3px_3px_0px_0px_#09090b]">
          <p className="text-[10px] font-bold font-mono text-emerald-700 uppercase tracking-widest">Completion Rate</p>
          <p className="text-3xl font-oswald font-bold text-emerald-700 mt-1">{progressPercent}%</p>
          <p className="text-[11px] font-mono text-zinc-500 mt-1">{completedTasks.length} of {totalTasks} finished</p>
        </div>

        {/* In Progress */}
        <div className="bg-white border-2 border-zinc-900 rounded-lg p-4 shadow-[3px_3px_0px_0px_#09090b]">
          <p className="text-[10px] font-bold font-mono text-blue-700 uppercase tracking-widest">Active Operations</p>
          <p className="text-3xl font-oswald font-bold text-blue-700 mt-1">{inProgressTasks.length}</p>
          <p className="text-[11px] font-mono text-zinc-500 mt-1">Under execution</p>
        </div>

        {/* Review Queue */}
        <div className={`rounded-lg p-4 border-2 shadow-[3px_3px_0px_0px_#09090b] ${
          pendingTasks.length > 0
            ? "bg-amber-50 border-amber-600 shadow-[3px_3px_0px_0px_#d97706]"
            : "bg-white border-zinc-900"
        }`}>
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold font-mono text-amber-900 uppercase tracking-widest">Review Queue</p>
            {pendingTasks.length > 0 && (
              <span className="w-2 h-2 rounded-full bg-amber-600 animate-ping" />
            )}
          </div>
          <p className={`text-3xl font-oswald font-bold mt-1 ${pendingTasks.length > 0 ? "text-amber-800" : "text-zinc-400"}`}>
            {pendingTasks.length}
          </p>
          <p className="text-[11px] font-mono text-amber-900 mt-1 font-bold">
            {pendingTasks.length > 0 ? "⚠️ Requires admin decision" : "Queue is clear"}
          </p>
        </div>
      </div>

      {/* Pending Approval Priority Action Card */}
      {pendingTasks.length > 0 && (
        <div className="bg-amber-50 border-2 border-amber-600 rounded-lg p-5 shadow-[4px_4px_0px_0px_#d97706]">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2">
              <span className="text-lg">⚠️</span>
              <h3 className="font-oswald text-lg font-bold uppercase tracking-wider text-amber-950">
                Pending Approval Directives ({pendingTasks.length})
              </h3>
            </div>
            <span className="text-xs font-mono font-bold text-amber-900 uppercase">
              Workers submitted proof for review
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {pendingTasks.map((t) => {
              const ids = getAssigneeIds(t.assignedTo);
              const assignees = ids.map((id) => workerMap.get(id)?.firstName).filter(Boolean).join(", ");

              return (
                <div
                  key={t.id}
                  onClick={() => onSelectTask(t)}
                  className="bg-white border border-amber-300 rounded p-3 hover:border-zinc-900 transition-all cursor-pointer flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <span className="text-[9px] font-mono font-bold uppercase px-1.5 py-0.2 bg-amber-100 text-amber-900 rounded">
                        Submitted for Approval
                      </span>
                      <span className="text-[9px] font-mono text-zinc-500 font-bold">
                        {t.submittedForApprovalAt ? "Recently" : ""}
                      </span>
                    </div>
                    <h4 className="text-xs font-bold uppercase text-zinc-950 line-clamp-1">{t.title}</h4>
                    <p className="text-[11px] text-zinc-600 font-mono mt-0.5 line-clamp-2">{t.description}</p>
                    {assignees && (
                      <p className="text-[10px] text-zinc-500 font-mono mt-1 font-semibold">👤 {assignees}</p>
                    )}
                  </div>

                  <div className="mt-3 pt-2 border-t border-zinc-100 flex items-center justify-between gap-2">
                    {t.photo ? (
                      <span className="text-[10px] text-purple-700 font-bold font-mono">📷 Attached Proof</span>
                    ) : (
                      <span />
                    )}
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onApproveTask(t);
                        }}
                        className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold uppercase rounded cursor-pointer"
                      >
                        ✓ Approve
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRejectTask(t);
                        }}
                        className="px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white text-[10px] font-bold uppercase rounded cursor-pointer"
                      >
                        ✕ Reject
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 2-Column Section: Workload by Worker + Overdue/Urgent Directives */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Team Workload Distribution */}
        <div className="bg-white border-2 border-zinc-900 rounded-lg p-5 shadow-[3px_3px_0px_0px_#09090b]">
          <div className="flex items-center justify-between pb-3 mb-4 border-b border-zinc-200">
            <h3 className="font-oswald text-lg font-bold uppercase tracking-wider text-zinc-950">
              Assigned Workforce Distribution
            </h3>
            <span className="text-xs font-mono font-bold text-zinc-500 uppercase">
              {workerWorkload.length} Workers
            </span>
          </div>

          {workerWorkload.length === 0 ? (
            <div className="py-8 text-center text-xs text-zinc-400 font-mono">
              No workers assigned to this project yet.
            </div>
          ) : (
            <div className="space-y-3">
              {workerWorkload.map((item) => {
                const w = item.worker;
                const donePercent = item.total > 0 ? Math.round((item.completed / item.total) * 100) : 0;

                return (
                  <div key={w.id} className="p-3 bg-zinc-50 border border-zinc-200 rounded">
                    <div className="flex items-center justify-between mb-1.5 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full bg-zinc-900 text-white text-[9px] font-bold flex items-center justify-center uppercase">
                          {w.firstName?.[0]}{w.lastName?.[0]}
                        </span>
                        <span className="font-bold text-zinc-950 uppercase">
                          {w.firstName} {w.lastName}
                        </span>
                        {w.role && (
                          <span className="text-[9px] font-mono text-zinc-500 bg-zinc-200 px-1 rounded">
                            {w.role}
                          </span>
                        )}
                      </div>
                      <span className="font-mono font-bold text-zinc-700">
                        {item.completed}/{item.total} Done ({donePercent}%)
                      </span>
                    </div>

                    {/* Mini progress bar */}
                    <div className="h-2 w-full bg-zinc-200 rounded-full overflow-hidden flex">
                      <div style={{ width: `${donePercent}%` }} className="bg-emerald-600 h-full" />
                      {item.pending > 0 && (
                        <div
                          style={{ width: `${Math.round((item.pending / item.total) * 100)}%` }}
                          className="bg-amber-500 h-full animate-pulse"
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Overdue & High Priority Watchlist */}
        <div className="bg-white border-2 border-zinc-900 rounded-lg p-5 shadow-[3px_3px_0px_0px_#09090b]">
          <div className="flex items-center justify-between pb-3 mb-4 border-b border-zinc-200">
            <h3 className="font-oswald text-lg font-bold uppercase tracking-wider text-zinc-950">
              Directives Watchlist
            </h3>
            <span className="text-xs font-mono font-bold text-red-600 uppercase">
              {overdueTasks.length} Overdue
            </span>
          </div>

          {overdueTasks.length === 0 ? (
            <div className="py-8 text-center text-xs text-zinc-500 font-mono">
              ✓ No overdue tasks! All timelines are on schedule.
            </div>
          ) : (
            <div className="space-y-2.5 max-h-[320px] overflow-y-auto">
              {overdueTasks.map((t) => {
                const d = parseDate(t.dueDate);
                return (
                  <div
                    key={t.id}
                    onClick={() => onSelectTask(t)}
                    className="p-3 bg-red-50/50 border border-red-200 rounded hover:border-red-600 transition-colors cursor-pointer flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold uppercase text-red-950 truncate">{t.title}</span>
                        <span className="text-[9px] font-mono font-bold text-red-700 bg-red-100 px-1.5 py-0.2 rounded">
                          {t.priority}
                        </span>
                      </div>
                      <p className="text-[10px] text-red-600 font-mono font-bold mt-0.5">
                        ⚠️ Due date passed: {d?.toLocaleDateString()}
                      </p>
                    </div>

                    <button
                      type="button"
                      className="px-2 py-1 bg-white border border-red-300 text-red-700 text-[10px] font-bold uppercase rounded hover:bg-red-600 hover:text-white transition-colors cursor-pointer shrink-0"
                    >
                      Inspect →
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
