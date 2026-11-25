"use client";

import { useMemo } from "react";
import {
  Project,
  TaskRow,
  Worker,
  getAssigneeIds,
  parseDate,
} from "./types";
import { stripRichHtml } from "@/components/admin/ui/LinkifiedText";
import { ChartCard, DonutBreakdown, BarCompare } from "@/components/admin/ui/Charts";

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
  tasks,
  workers,
  onSelectTask,
  onApproveTask,
  onRejectTask,
  onOpenCreateTask,
}: Props) {
  const workerMap = useMemo(() => {
    const map = new Map<string, Worker>();
    workers.forEach((w) => map.set(w.id, w));
    return map;
  }, [workers]);

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
  }, [tasks, workerMap]);

  const statusSlices = useMemo(
    () => [
      { key: "completed", label: "Completed", value: completedTasks.length, color: "#10b981" },
      { key: "in-progress", label: "In Progress", value: tasks.filter((t) => t.status === "in-progress").length, color: "#3b82f6" },
      { key: "assigned", label: "Assigned", value: tasks.filter((t) => t.status === "assigned").length, color: "#6366f1" },
      { key: "review", label: "Needs Review", value: pendingTasks.length, color: "#f59e0b" },
    ],
    [tasks, completedTasks.length, pendingTasks.length]
  );

  const workerChartData = useMemo(
    () =>
      workerWorkload.slice(0, 6).map((item) => ({
        worker: item.worker.firstName || "Worker",
        Completed: item.completed,
        Active: item.active,
        Review: item.pending,
      })),
    [workerWorkload]
  );

  return (
    <div className="space-y-6">
      {/* Top Overview KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="ui-card p-4">
          <p className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">Total Directives</p>
          <p className="font-code text-2xl font-bold text-zinc-950 mt-1.5">{totalTasks}</p>
          <p className="text-xs text-zinc-500 mt-1">Assigned to this project</p>
        </div>

        <div className="ui-card p-4">
          <p className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wider">Completion Rate</p>
          <p className="font-code text-2xl font-bold text-emerald-700 mt-1.5">{progressPercent}%</p>
          <p className="text-xs text-zinc-500 mt-1">
            {completedTasks.length} of {totalTasks} finished
          </p>
        </div>

        <div className="ui-card p-4">
          <p className="text-[11px] font-semibold text-blue-700 uppercase tracking-wider">Active Operations</p>
          <p className="font-code text-2xl font-bold text-blue-700 mt-1.5">{inProgressTasks.length}</p>
          <p className="text-xs text-zinc-500 mt-1">Currently in execution</p>
        </div>

        <div
          className={`ui-card p-4 ${
            pendingTasks.length > 0 ? "border-amber-300 bg-amber-50/30" : ""
          }`}
        >
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold text-amber-800 uppercase tracking-wider">Review Queue</p>
            {pendingTasks.length > 0 && (
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
            )}
          </div>
          <p className={`font-code text-2xl font-bold mt-1.5 ${pendingTasks.length > 0 ? "text-amber-700" : "text-zinc-400"}`}>
            {pendingTasks.length}
          </p>
          <p className="text-xs text-amber-800/80 mt-1 font-medium">
            {pendingTasks.length > 0 ? "Requires admin decision" : "Review queue is clear"}
          </p>
        </div>
      </div>

      {/* Executive Charts Row */}
      {totalTasks > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <ChartCard
            className="lg:col-span-5"
            title="Directive Status Breakdown"
            subtitle="Distribution of tasks across workflow stages"
          >
            <DonutBreakdown
              slices={statusSlices}
              centerLabel="Directives"
              centerValue={String(totalTasks)}
              size={165}
              description="Task status breakdown"
            />
          </ChartCard>

          <ChartCard
            className="lg:col-span-7"
            title="Team Member Execution Velocity"
            subtitle="Completed vs active directives per assigned worker"
            actions={
              <button
                type="button"
                onClick={onOpenCreateTask}
                className="brutal-btn-outline text-[11px] py-1 px-2.5"
              >
                + Assign Task
              </button>
            }
          >
            {workerChartData.length === 0 ? (
              <div className="flex h-44 items-center justify-center text-xs text-zinc-400">
                No workers assigned to tasks yet
              </div>
            ) : (
              <BarCompare
                data={workerChartData}
                xKey="worker"
                series={[
                  { key: "Completed", label: "Completed", color: "#10b981" },
                  { key: "Active", label: "Active", color: "#3b82f6" },
                  { key: "Review", label: "In Review", color: "#f59e0b" },
                ]}
                height={200}
                description="Worker task status"
              />
            )}
          </ChartCard>
        </div>
      )}

      {/* Pending Approval Priority Action Card */}
      {pendingTasks.length > 0 && (
        <div className="ui-card border-amber-300 bg-amber-50/40 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-100 text-amber-700 font-bold">
                !
              </span>
              <div>
                <h3 className="text-sm font-bold text-amber-950">
                  Pending Approval Directives ({pendingTasks.length})
                </h3>
                <p className="text-xs text-amber-800/80">
                  Workers submitted completion proof awaiting your sign-off
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {pendingTasks.map((t) => {
              const ids = getAssigneeIds(t.assignedTo);
              const assignees = ids
                .map((id) => workerMap.get(id)?.firstName)
                .filter(Boolean)
                .join(", ");

              return (
                <div
                  key={t.id}
                  onClick={() => onSelectTask(t)}
                  className="bg-white border border-amber-200/90 rounded-xl p-4 hover:border-amber-400 shadow-2xs transition-all cursor-pointer flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="text-[10px] font-semibold uppercase px-2 py-0.5 bg-amber-50 text-amber-800 border border-amber-200 rounded-full">
                        Submitted for Review
                      </span>
                      {t.photo && (
                        <span className="text-[10px] text-purple-700 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded-full font-semibold">
                          📷 Proof Attached
                        </span>
                      )}
                    </div>
                    <h4 className="text-sm font-bold text-zinc-950 line-clamp-1">{t.title}</h4>
                    <p className="text-xs text-zinc-500 mt-1 line-clamp-2">
                      {stripRichHtml(t.description)}
                    </p>
                    {assignees && (
                      <p className="text-[11px] text-zinc-600 mt-2 font-medium">👤 {assignees}</p>
                    )}
                  </div>

                  <div className="mt-3.5 pt-2.5 border-t border-zinc-100 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onApproveTask(t);
                      }}
                      className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg cursor-pointer transition-colors"
                    >
                      ✓ Approve
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRejectTask(t);
                      }}
                      className="px-3 py-1 bg-red-50 hover:bg-red-600 text-red-700 hover:text-white border border-red-200 text-xs font-semibold rounded-lg cursor-pointer transition-colors"
                    >
                      ✕ Request Changes
                    </button>
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
        <div className="ui-card p-5">
          <div className="flex items-center justify-between pb-3.5 mb-4 border-b border-zinc-100">
            <div>
              <h3 className="text-sm font-bold text-zinc-950">
                Assigned Workforce Distribution
              </h3>
              <p className="text-xs text-zinc-500">Individual directive completion rates</p>
            </div>
            <span className="font-code text-xs font-semibold text-zinc-600 bg-zinc-100 px-2.5 py-1 rounded-lg">
              {workerWorkload.length} {workerWorkload.length === 1 ? "Member" : "Members"}
            </span>
          </div>

          {workerWorkload.length === 0 ? (
            <div className="py-10 text-center text-xs text-zinc-400">
              No workers assigned to this project yet.
            </div>
          ) : (
            <div className="space-y-3">
              {workerWorkload.map((item) => {
                const w = item.worker;
                const donePercent = item.total > 0 ? Math.round((item.completed / item.total) * 100) : 0;

                return (
                  <div key={w.id} className="p-3.5 bg-zinc-50/70 border border-zinc-200/80 rounded-xl">
                    <div className="flex items-center justify-between mb-2 text-xs">
                      <div className="flex items-center gap-2.5">
                        <span className="w-7 h-7 rounded-full bg-zinc-900 text-white text-[10px] font-bold flex items-center justify-center uppercase">
                          {w.firstName?.[0]}{w.lastName?.[0]}
                        </span>
                        <div>
                          <span className="font-semibold text-zinc-950">
                            {w.firstName} {w.lastName}
                          </span>
                          {w.role && (
                            <span className="ml-2 text-[10px] font-medium text-zinc-500 bg-zinc-200/70 px-1.5 py-0.5 rounded-md">
                              {w.role}
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="font-code font-semibold text-zinc-700">
                        {item.completed}/{item.total} ({donePercent}%)
                      </span>
                    </div>

                    <div className="h-2 w-full bg-zinc-200/80 rounded-full overflow-hidden flex">
                      <div style={{ width: `${donePercent}%` }} className="bg-emerald-500 h-full" />
                      {item.pending > 0 && (
                        <div
                          style={{ width: `${Math.round((item.pending / item.total) * 100)}%` }}
                          className="bg-amber-500 h-full"
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
        <div className="ui-card p-5">
          <div className="flex items-center justify-between pb-3.5 mb-4 border-b border-zinc-100">
            <div>
              <h3 className="text-sm font-bold text-zinc-950">
                Directives Watchlist
              </h3>
              <p className="text-xs text-zinc-500">Overdue & time-critical project items</p>
            </div>
            <span
              className={`font-code text-xs font-semibold px-2.5 py-1 rounded-lg ${
                overdueTasks.length > 0 ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
              }`}
            >
              {overdueTasks.length} Overdue
            </span>
          </div>

          {overdueTasks.length === 0 ? (
            <div className="py-10 text-center text-xs text-zinc-500">
              ✓ No overdue tasks — all project timelines are on schedule.
            </div>
          ) : (
            <div className="space-y-2.5 max-h-[320px] overflow-y-auto">
              {overdueTasks.map((t) => {
                const d = parseDate(t.dueDate);
                return (
                  <div
                    key={t.id}
                    onClick={() => onSelectTask(t)}
                    className="p-3.5 bg-red-50/40 border border-red-200/80 rounded-xl hover:border-red-400 transition-colors cursor-pointer flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-zinc-950 truncate">{t.title}</span>
                        <span className="text-[10px] font-semibold uppercase text-red-700 bg-red-100/80 px-2 py-0.5 rounded-full">
                          {t.priority}
                        </span>
                      </div>
                      <p className="font-code text-[11px] text-red-600 font-medium mt-1">
                        Due date passed: {d?.toLocaleDateString()}
                      </p>
                    </div>

                    <button
                      type="button"
                      className="px-2.5 py-1 bg-white border border-red-200 text-red-700 text-xs font-semibold rounded-lg hover:bg-red-600 hover:text-white transition-colors cursor-pointer shrink-0"
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
