"use client";

import { useState, useMemo } from "react";
import { Project, TaskRow, Worker, HubViewMode, getAssigneeIds } from "./types";
import { stripRichHtml } from "@/components/admin/ui/LinkifiedText";

interface Props {
  projects: Project[];
  tasks: TaskRow[];
  workers: Worker[];
  unreadByProject: Map<string, number>;
  onSelectProject: (projectId: string) => void;
  onOpenProjectChat?: (project: Project) => void;
  onOpenCreateProject: () => void;
  onOpenEditProject: (project: Project) => void;
  onDeleteProject: (projectId: string) => void;
  onOpenCreateTaskForProject: (project: Project) => void;
  onToggleProjectStatus: (projectId: string, currentStatus: string) => void;
}

export default function ProjectsHubView({
  projects,
  tasks,
  workers,
  unreadByProject,
  onSelectProject,
  onOpenProjectChat,
  onOpenCreateProject,
  onOpenEditProject,
  onDeleteProject,
  onOpenCreateTaskForProject,
  onToggleProjectStatus,
}: Props) {
  const [hubView, setHubView] = useState<HubViewMode>("grid");
  const [search, setSearch] = useState("");
  const [filterTab, setFilterTab] = useState<"all" | "active" | "needs-approval" | "completed" | "unread">("all");

  const workerMap = new Map<string, Worker>();
  workers.forEach((w) => workerMap.set(w.id, w));

  // Projects needing approval
  const projectsNeedingApproval = useMemo(() => {
    return new Set(
      tasks
        .filter((t) => {
          const s = (t.status || "").toLowerCase().trim();
          return (s === "pending-approval" || s === "pending_approval" || s === "pending") && t.projectId;
        })
        .map((t) => t.projectId!)
    );
  }, [tasks]);

  const projectsWithUnread = useMemo(() => {
    return new Set(
      Array.from(unreadByProject.keys()).filter((pid) => (unreadByProject.get(pid) ?? 0) > 0)
    );
  }, [unreadByProject]);

  const getProjectEffectiveStatus = (p: Project) => {
    if (p.status === "completed") return "completed";
    const pTasks = tasks.filter((t) => t.projectId === p.id);
    if (pTasks.length > 0 && pTasks.every((t) => t.status === "completed")) {
      return "completed";
    }
    return p.status || "active";
  };

  const activeProjectsCount = projects.filter((p) => getProjectEffectiveStatus(p) === "active").length;
  const completedProjectsCount = projects.filter((p) => getProjectEffectiveStatus(p) === "completed").length;
  const totalPendingReviews = tasks.filter((t) => t.status === "pending-approval").length;

  // Filtered projects
  const filteredProjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projects.filter((p) => {
      const effStatus = getProjectEffectiveStatus(p);

      if (filterTab === "active" && effStatus !== "active") return false;
      if (filterTab === "completed" && effStatus !== "completed") return false;
      if (filterTab === "needs-approval" && !projectsNeedingApproval.has(p.id)) return false;
      if (filterTab === "unread" && !projectsWithUnread.has(p.id)) return false;

      if (!q) return true;
      const matchName = (p.name || "").toLowerCase().includes(q);
      const matchClient = (p.clientName || "").toLowerCase().includes(q);
      const matchTags = (p.projectTypes || []).join(" ").toLowerCase().includes(q);
      const matchDesc = (p.description || "").toLowerCase().includes(q);

      return matchName || matchClient || matchTags || matchDesc;
    });
  }, [projects, search, filterTab, projectsNeedingApproval, projectsWithUnread, tasks]);

  return (
    <div className="space-y-6">
      {/* Top Title & Quick Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-[10px] font-mono font-bold uppercase tracking-[0.3em] text-zinc-500 mb-1">
            {"// WORKSPACE"}
          </p>
          <h1 className="text-3xl font-oswald font-bold text-zinc-950 uppercase tracking-wider">
            Project Command Center
          </h1>
        </div>
        <button
          type="button"
          id="btn-create-project"
          onClick={onOpenCreateProject}
          className="px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white font-bold font-mono text-xs uppercase tracking-wider rounded border-2 border-red-700 shadow-[3px_3px_0px_0px_#09090b] active:translate-x-0.5 active:translate-y-0.5 transition-all cursor-pointer flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          <span>New Project</span>
        </button>
      </div>

      {/* KPI Metrics Ribbon */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <button
          type="button"
          onClick={() => setFilterTab("all")}
          className={`p-4 text-left bg-white border-2 border-zinc-900 rounded-lg shadow-[3px_3px_0px_0px_#09090b] transition-all cursor-pointer ${
            filterTab === "all" ? "ring-2 ring-zinc-950 bg-zinc-50" : "hover:bg-zinc-50"
          }`}
        >
          <p className="text-[10px] font-mono font-bold uppercase tracking-widest text-zinc-500">Total Projects</p>
          <p className="text-2xl font-oswald font-bold text-zinc-950 mt-1">{projects.length}</p>
          <p className="text-[10px] font-mono text-zinc-400 mt-1">All accounts</p>
        </button>

        <button
          type="button"
          onClick={() => setFilterTab("active")}
          className={`p-4 text-left bg-white border-2 border-zinc-900 rounded-lg shadow-[3px_3px_0px_0px_#09090b] transition-all cursor-pointer ${
            filterTab === "active" ? "ring-2 ring-blue-600 bg-blue-50/40" : "hover:bg-blue-50/20"
          }`}
        >
          <p className="text-[10px] font-mono font-bold uppercase tracking-widest text-blue-700">Active Projects</p>
          <p className="text-2xl font-oswald font-bold text-blue-800 mt-1">{activeProjectsCount}</p>
          <p className="text-[10px] font-mono text-zinc-400 mt-1">Operations live</p>
        </button>

        <button
          type="button"
          onClick={() => setFilterTab("needs-approval")}
          className={`p-4 text-left border-2 rounded-lg transition-all cursor-pointer ${
            totalPendingReviews > 0
              ? filterTab === "needs-approval"
                ? "bg-amber-100 border-amber-600 shadow-[3px_3px_0px_0px_#d97706] ring-2 ring-amber-600"
                : "bg-amber-50/80 border-amber-500 hover:border-zinc-900 shadow-[3px_3px_0px_0px_#d97706]"
              : "bg-white border-zinc-900 shadow-[3px_3px_0px_0px_#09090b]"
          }`}
        >
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-mono font-bold uppercase tracking-widest text-amber-900">Task Reviews</p>
            {totalPendingReviews > 0 && (
              <span className="w-2 h-2 rounded-full bg-amber-600 animate-ping" />
            )}
          </div>
          <p className={`text-2xl font-oswald font-bold mt-1 ${totalPendingReviews > 0 ? "text-amber-800" : "text-zinc-400"}`}>
            {totalPendingReviews}
          </p>
          <p className="text-[10px] font-mono text-amber-900 mt-1 font-bold">
            {projectsNeedingApproval.size} project{projectsNeedingApproval.size === 1 ? "" : "s"} waiting {filterTab === "needs-approval" ? "(ACTIVE)" : "→"}
          </p>
        </button>

        <button
          type="button"
          onClick={() => setFilterTab("completed")}
          className={`p-4 text-left bg-white border-2 border-zinc-900 rounded-lg shadow-[3px_3px_0px_0px_#09090b] transition-all cursor-pointer ${
            filterTab === "completed" ? "ring-2 ring-emerald-600 bg-emerald-50/40" : "hover:bg-emerald-50/20"
          }`}
        >
          <p className="text-[10px] font-mono font-bold uppercase tracking-widest text-emerald-700">Completed</p>
          <p className="text-2xl font-oswald font-bold text-emerald-800 mt-1">{completedProjectsCount}</p>
          <p className="text-[10px] font-mono text-zinc-400 mt-1">Delivered</p>
        </button>
      </div>

      {/* Search, Tab Filters & Grid/Table Toggle */}
      <div className="bg-white border-2 border-zinc-900 rounded-lg p-3.5 shadow-[3px_3px_0px_0px_#09090b] flex flex-wrap items-center justify-between gap-3 text-xs">
        {/* Search */}
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search projects by name, client, tags..."
            className="w-full pl-8 pr-7 py-1.5 bg-zinc-50 border border-zinc-300 rounded text-xs text-zinc-900 focus:outline-none focus:border-red-600 font-mono"
          />
          <svg
            className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-2.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2 top-1.5 text-zinc-400 hover:text-zinc-900 font-bold"
            >
              &times;
            </button>
          )}
        </div>

        {/* Tab Filters */}
        <div className="flex items-center gap-1 flex-wrap">
          {(
            [
              { id: "all", label: `ALL (${projects.length})` },
              { id: "active", label: `ACTIVE (${activeProjectsCount})` },
              { id: "needs-approval", label: `⚠️ NEEDS APPROVAL (${projectsNeedingApproval.size})`, highlight: projectsNeedingApproval.size > 0 },
              { id: "completed", label: `COMPLETED (${completedProjectsCount})` },
              ...(projectsWithUnread.size > 0
                ? [{ id: "unread", label: `💬 UNREAD (${projectsWithUnread.size})`, highlight: true }]
                : []),
            ] as const
          ).map((tab) => {
            const isActive = filterTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilterTab(tab.id as typeof filterTab)}
                className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded border transition-all cursor-pointer ${
                  isActive
                    ? "bg-zinc-950 text-white border-zinc-950 shadow-xs"
                    : (tab as any).highlight
                    ? "bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100"
                    : "bg-zinc-50 text-zinc-700 border-zinc-200 hover:border-zinc-400"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* View Switcher: Grid vs Table */}
        <div className="flex items-center gap-1 bg-zinc-100 p-0.5 rounded border border-zinc-200">
          <button
            type="button"
            onClick={() => setHubView("grid")}
            title="Grid Cards View"
            className={`p-1.5 rounded transition-all cursor-pointer ${
              hubView === "grid" ? "bg-white text-zinc-950 shadow-xs font-bold" : "text-zinc-500 hover:text-zinc-900"
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setHubView("table")}
            title="Table List View"
            className={`p-1.5 rounded transition-all cursor-pointer ${
              hubView === "table" ? "bg-white text-zinc-950 shadow-xs font-bold" : "text-zinc-500 hover:text-zinc-900"
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
            </svg>
          </button>
        </div>
      </div>

      {/* Projects Content: Grid or Table */}
      {filteredProjects.length === 0 ? (
        <div className="bg-white border-2 border-zinc-900 shadow-[3px_3px_0px_0px_#09090b] rounded-lg p-12 text-center">
          <p className="text-sm font-bold uppercase tracking-wider text-zinc-900 font-mono">
            {filterTab === "needs-approval" ? "No projects with pending approvals" : "No projects match criteria"}
          </p>
          {filterTab !== "all" && (
            <button
              type="button"
              onClick={() => setFilterTab("all")}
              className="mt-3 px-3 py-1.5 bg-zinc-900 text-white text-xs font-bold uppercase rounded cursor-pointer"
            >
              Reset to All Projects
            </button>
          )}
        </div>
      ) : hubView === "grid" ? (
        /* ─── Grid View ─── */
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filteredProjects.map((p) => {
            const pTasks = tasks.filter((t) => t.projectId === p.id);
            const pTaskCount = pTasks.length;
            const completedCount = pTasks.filter((t) => t.status === "completed").length;
            const pendingApprovalCount = pTasks.filter((t) => t.status === "pending-approval").length;
            const inProgressCount = pTasks.filter((t) => ["assigned", "in-progress"].includes(t.status)).length;
            const progressPercent = pTaskCount > 0 ? Math.round((completedCount / pTaskCount) * 100) : 0;
            const unreadCount = unreadByProject.get(p.id) ?? 0;

            const assignedWorkerIds = Array.from(
              new Set(pTasks.flatMap((t) => getAssigneeIds(t.assignedTo)))
            );
            const assignedWorkers = assignedWorkerIds
              .map((id) => workerMap.get(id))
              .filter(Boolean) as Worker[];

            const effectiveStatus = getProjectEffectiveStatus(p);
            const isCompleted = effectiveStatus === "completed";
            const hasPending = pendingApprovalCount > 0;

            return (
              <div
                key={p.id}
                onClick={() => onSelectProject(p.id)}
                className={`bg-white border-2 border-zinc-900 rounded-lg p-5 shadow-[4px_4px_0px_0px_#09090b] hover:shadow-[6px_6px_0px_0px_#09090b] hover:-translate-y-0.5 transition-all cursor-pointer flex flex-col justify-between group relative ${
                  hasPending ? "ring-2 ring-amber-500" : ""
                }`}
              >
                {/* Unread badge */}
                {unreadCount > 0 && (
                  <span className="absolute -top-2.5 -right-2.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-red-600 text-[11px] font-bold text-white px-1.5 animate-pulse shadow border-2 border-white">
                    {unreadCount}
                  </span>
                )}

                <div>
                  {/* Top Status & Pending Badges */}
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span
                        className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${
                          isCompleted
                            ? "bg-emerald-50 text-emerald-700 border-emerald-300"
                            : "bg-blue-50 text-blue-700 border-blue-300"
                        }`}
                      >
                        {effectiveStatus}
                      </span>

                      {hasPending && (
                        <span className="text-[9px] font-mono font-bold uppercase px-2 py-0.5 bg-amber-100 text-amber-900 border border-amber-400 rounded animate-pulse">
                          ⚠️ {pendingApprovalCount} Review
                        </span>
                      )}
                    </div>

                    <span className="text-[10px] font-mono font-bold text-zinc-500 bg-zinc-100 px-2 py-0.5 rounded border border-zinc-200">
                      {pTaskCount} Tasks
                    </span>
                  </div>

                  {/* Project Title & Client */}
                  <h3 className="text-xl font-oswald font-bold text-zinc-950 uppercase tracking-wide group-hover:text-red-600 transition-colors line-clamp-1">
                    {p.name}
                  </h3>
                  {p.clientName && (
                    <p className="text-[11px] text-red-600 font-bold uppercase tracking-wider mt-0.5">
                      Client: {p.clientName}
                    </p>
                  )}

                  {/* Description */}
                  {p.description && (
                    <p className="text-xs text-zinc-500 font-mono mt-2 line-clamp-2 leading-relaxed">
                      {stripRichHtml(p.description)}
                    </p>
                  )}

                  {/* Progress Bar */}
                  {pTaskCount > 0 && (
                    <div className="mt-4 pt-3 border-t border-zinc-100">
                      <div className="flex items-center justify-between text-[10px] font-mono text-zinc-500 font-bold uppercase mb-1">
                        <span>Task Completion</span>
                        <span className="text-zinc-900">{completedCount}/{pTaskCount} ({progressPercent}%)</span>
                      </div>
                      <div className="h-2 w-full bg-zinc-100 rounded-full overflow-hidden flex border border-zinc-200">
                        <div style={{ width: `${progressPercent}%` }} className="bg-emerald-600 h-full" />
                        {pendingApprovalCount > 0 && (
                          <div
                            style={{ width: `${Math.round((pendingApprovalCount / pTaskCount) * 100)}%` }}
                            className="bg-amber-500 h-full animate-pulse"
                          />
                        )}
                        {inProgressCount > 0 && (
                          <div
                            style={{ width: `${Math.round((inProgressCount / pTaskCount) * 100)}%` }}
                            className="bg-blue-500 h-full"
                          />
                        )}
                      </div>
                    </div>
                  )}

                  {/* Team Avatars & Tags */}
                  <div className="mt-4 pt-3 border-t border-zinc-100 flex items-center justify-between gap-2 flex-wrap">
                    {/* Team Stack */}
                    <div className="flex items-center -space-x-1.5">
                      {assignedWorkers.slice(0, 4).map((w) => (
                        <span
                          key={w.id}
                          title={`${w.firstName} ${w.lastName}`}
                          className="w-6 h-6 rounded-full bg-zinc-900 text-white text-[9px] font-bold flex items-center justify-center border-2 border-white uppercase shadow-xs shrink-0"
                        >
                          {w.firstName?.[0]}{w.lastName?.[0]}
                        </span>
                      ))}
                      {assignedWorkers.length > 4 && (
                        <span className="w-6 h-6 rounded-full bg-zinc-200 text-zinc-700 text-[9px] font-bold flex items-center justify-center border-2 border-white shrink-0">
                          +{assignedWorkers.length - 4}
                        </span>
                      )}
                      {assignedWorkers.length === 0 && (
                        <span className="text-[10px] text-zinc-400 font-mono italic">No team assigned</span>
                      )}
                    </div>

                    {/* Category pills */}
                    <div className="flex items-center gap-1 flex-wrap">
                      {(p.projectTypes || []).slice(0, 2).map((t) => (
                        <span
                          key={t}
                          className="text-[9px] font-bold uppercase tracking-wider text-zinc-600 bg-zinc-100 border border-zinc-200 px-1.5 py-0.2 rounded"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Footer View Link & Quick Task / Group Chat Buttons */}
                {p.lastMessageText && (
                  <div className="mt-3 px-2.5 py-1.5 rounded bg-zinc-50 border border-zinc-200 text-[11px] font-mono text-zinc-600 truncate">
                    💬 <span className="font-bold text-zinc-800">{p.lastMessageSender || "Chat"}:</span> {p.lastMessageText}
                  </div>
                )}
                <div className="mt-4 pt-3 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between text-xs font-mono gap-2 flex-wrap">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenProjectChat?.(p);
                      }}
                      className={`px-2 py-0.5 text-[10px] font-bold uppercase rounded border transition-colors cursor-pointer flex items-center gap-1 ${
                        unreadCount > 0
                          ? "border-red-600 bg-red-600 text-white animate-pulse"
                          : "border-zinc-300 bg-zinc-100 text-zinc-800 hover:bg-zinc-900 hover:text-white"
                      }`}
                      title={`Open ${p.name} Group Chat`}
                    >
                      <span>💬 Group Chat</span>
                      {unreadCount > 0 && <span>({unreadCount})</span>}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenCreateTaskForProject(p);
                      }}
                      className="px-2 py-0.5 text-[10px] font-bold uppercase rounded border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 hover:bg-red-600 hover:text-white dark:hover:bg-red-600 transition-colors cursor-pointer flex items-center gap-1"
                      title={`Assign a new task to ${p.name}`}
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                      </svg>
                      <span>New Task</span>
                    </button>
                  </div>
                  <span className="font-bold text-red-600 group-hover:translate-x-1 transition-transform flex items-center gap-1">
                    Open →
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* ─── Table View ─── */
        <div className="bg-white border-2 border-zinc-900 rounded-lg shadow-[3px_3px_0px_0px_#09090b] overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs font-mono">
            <thead>
              <tr className="bg-zinc-100 border-b-2 border-zinc-900 text-[10px] uppercase font-bold text-zinc-600 tracking-wider">
                <th className="py-3 px-4">Project / Client</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Progress</th>
                <th className="py-3 px-4">Directives</th>
                <th className="py-3 px-4">Team</th>
                <th className="py-3 px-4">Timeline</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200">
              {filteredProjects.map((p) => {
                const pTasks = tasks.filter((t) => t.projectId === p.id);
                const pTaskCount = pTasks.length;
                const completedCount = pTasks.filter((t) => t.status === "completed").length;
                const pendingApprovalCount = pTasks.filter((t) => t.status === "pending-approval").length;
                const progressPercent = pTaskCount > 0 ? Math.round((completedCount / pTaskCount) * 100) : 0;
                const effectiveStatus = getProjectEffectiveStatus(p);

                const assignedWorkerIds = Array.from(
                  new Set(pTasks.flatMap((t) => getAssigneeIds(t.assignedTo)))
                );
                const assignedWorkers = assignedWorkerIds
                  .map((id) => workerMap.get(id))
                  .filter(Boolean) as Worker[];

                return (
                  <tr
                    key={p.id}
                    onClick={() => onSelectProject(p.id)}
                    className="hover:bg-zinc-50 transition-colors cursor-pointer group"
                  >
                    <td className="py-3.5 px-4 font-sans">
                      <div className="font-bold text-sm uppercase text-zinc-950 group-hover:text-red-600 transition-colors truncate max-w-xs">
                        {p.name}
                      </div>
                      {p.clientName && (
                        <div className="text-[10px] text-red-600 font-bold uppercase font-mono">
                          {p.clientName}
                        </div>
                      )}
                    </td>

                    <td className="py-3.5 px-4">
                      <span
                        className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${
                          effectiveStatus === "completed"
                            ? "bg-emerald-50 text-emerald-700 border-emerald-300"
                            : "bg-blue-50 text-blue-700 border-blue-300"
                        }`}
                      >
                        {effectiveStatus}
                      </span>
                    </td>

                    <td className="py-3.5 px-4 min-w-[140px]">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-zinc-200 rounded-full overflow-hidden">
                          <div style={{ width: `${progressPercent}%` }} className="bg-emerald-600 h-full" />
                        </div>
                        <span className="text-[10px] font-bold text-zinc-700">{progressPercent}%</span>
                      </div>
                    </td>

                    <td className="py-3.5 px-4">
                      <span className="font-bold text-zinc-800">{completedCount}/{pTaskCount}</span>
                      {pendingApprovalCount > 0 && (
                        <span className="ml-1.5 px-1.5 py-0.2 bg-amber-100 text-amber-900 border border-amber-300 rounded text-[9px] font-bold">
                          ⚠️ {pendingApprovalCount}
                        </span>
                      )}
                    </td>

                    <td className="py-3.5 px-4">
                      <div className="flex items-center -space-x-1.5">
                        {assignedWorkers.slice(0, 3).map((w) => (
                          <span
                            key={w.id}
                            title={`${w.firstName} ${w.lastName}`}
                            className="w-5 h-5 rounded-full bg-zinc-900 text-white text-[8px] font-bold flex items-center justify-center border border-white uppercase"
                          >
                            {w.firstName?.[0]}{w.lastName?.[0]}
                          </span>
                        ))}
                        {assignedWorkers.length > 3 && (
                          <span className="w-5 h-5 rounded-full bg-zinc-200 text-zinc-700 text-[8px] font-bold flex items-center justify-center border border-white">
                            +{assignedWorkers.length - 3}
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="py-3.5 px-4 text-[10px] text-zinc-500">
                      {p.startDate || "—"} → {p.endDate || "Ongoing"}
                    </td>

                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenProjectChat?.(p);
                          }}
                          className="px-2 py-1 bg-zinc-100 hover:bg-zinc-900 hover:text-white border border-zinc-300 text-zinc-800 text-[10px] font-bold uppercase rounded cursor-pointer transition-colors"
                          title={`Open ${p.name} Group Chat`}
                        >
                          💬 Chat
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenCreateTaskForProject(p);
                          }}
                          className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white text-[10px] font-bold uppercase rounded cursor-pointer transition-colors"
                          title={`Assign a new task to ${p.name}`}
                        >
                          + Task
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectProject(p.id);
                          }}
                          className="px-2.5 py-1 bg-zinc-900 hover:bg-black text-white text-[10px] font-bold uppercase rounded cursor-pointer transition-colors"
                        >
                          Open →
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
