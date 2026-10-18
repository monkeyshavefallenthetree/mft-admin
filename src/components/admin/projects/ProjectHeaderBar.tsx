"use client";

import { useState, useRef, useEffect } from "react";
import { Project, ProjectViewMode, TaskRow, Worker, STATUS_CONFIG } from "./types";
import LinkifiedText from "@/components/admin/ui/LinkifiedText";

interface Props {
  project: Project;
  allProjects: Project[];
  tasks: TaskRow[];
  workers: Worker[];
  viewMode: ProjectViewMode;
  unreadChatCount?: number;
  onSelectViewMode: (mode: ProjectViewMode) => void;
  onBackToProjects: () => void;
  onSelectProject: (projectId: string) => void;
  onOpenCreateTask: () => void;
  onOpenEditProject: () => void;
  onToggleProjectStatus: (projectId: string, currentStatus: string) => void;
  onDeleteProject: (projectId: string) => void;
}

export default function ProjectHeaderBar({
  project,
  allProjects,
  tasks,
  workers,
  viewMode,
  unreadChatCount = 0,
  onSelectViewMode,
  onBackToProjects,
  onSelectProject,
  onOpenCreateTask,
  onOpenEditProject,
  onToggleProjectStatus,
  onDeleteProject,
}: Props) {
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const switcherRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);

  // Close menus on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (switcherRef.current && !switcherRef.current.contains(event.target as Node)) {
        setSwitcherOpen(false);
      }
      if (statusRef.current && !statusRef.current.contains(event.target as Node)) {
        setStatusMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Stats calculation
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((t) => t.status === "completed").length;
  const pendingApprovalTasks = tasks.filter((t) => t.status === "pending-approval").length;
  const inProgressTasks = tasks.filter((t) => ["assigned", "in-progress"].includes(t.status)).length;
  const progressPercent = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const effectiveStatus = project.status || "active";

  return (
    <div className="bg-white border-2 border-zinc-900 shadow-[4px_4px_0px_0px_#09090b] rounded-lg overflow-visible mb-6 transition-all">
      {/* Top Breadcrumb & Switcher Bar */}
      <div className="px-5 py-3 border-b border-zinc-200 bg-zinc-50/80 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={onBackToProjects}
            className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-zinc-500 hover:text-red-600 transition-colors cursor-pointer"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            <span>Projects</span>
          </button>

          <span className="text-zinc-300 font-bold">/</span>

          {/* Quick Project Switcher Dropdown */}
          <div className="relative" ref={switcherRef}>
            <button
              type="button"
              onClick={() => setSwitcherOpen(!switcherOpen)}
              className="flex items-center gap-2 px-2.5 py-1 rounded bg-white hover:bg-zinc-100 border border-zinc-300 text-zinc-950 font-bold uppercase tracking-wider transition-colors cursor-pointer"
            >
              <span className="w-2.5 h-2.5 rounded-full bg-red-600 inline-block" />
              <span className="max-w-[200px] truncate">{project.name}</span>
              <svg className="w-3.5 h-3.5 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {switcherOpen && (
              <div className="absolute left-0 mt-1.5 w-72 bg-white border-2 border-zinc-900 shadow-[4px_4px_0px_0px_#09090b] rounded-md py-1.5 z-50 max-h-80 overflow-y-auto">
                <div className="px-3 py-1.5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest border-b border-zinc-100">
                  Switch Project ({allProjects.length})
                </div>
                {allProjects.map((p) => {
                  const isCurrent = p.id === project.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        onSelectProject(p.id);
                        setSwitcherOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2 flex items-center justify-between text-xs transition-colors cursor-pointer ${
                        isCurrent ? "bg-red-50 text-red-950 font-bold" : "hover:bg-zinc-50 text-zinc-800"
                      }`}
                    >
                      <div className="truncate pr-2">
                        <p className="truncate font-semibold uppercase">{p.name}</p>
                        {p.clientName && <p className="text-[10px] text-zinc-500 truncate">{p.clientName}</p>}
                      </div>
                      <span
                        className={`text-[9px] px-1.5 py-0.5 font-bold uppercase rounded border ${
                          p.status === "completed"
                            ? "bg-emerald-50 text-emerald-700 border-emerald-300"
                            : "bg-blue-50 text-blue-700 border-blue-300"
                        }`}
                      >
                        {p.status || "active"}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Header Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Quick status toggle button */}
          <button
            type="button"
            onClick={() => onToggleProjectStatus(project.id, effectiveStatus)}
            className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded border-2 border-zinc-900 transition-all cursor-pointer flex items-center gap-1.5 shadow-[2px_2px_0px_0px_#09090b] active:translate-x-0.5 active:translate-y-0.5 ${
              effectiveStatus === "completed"
                ? "bg-zinc-100 hover:bg-zinc-200 text-zinc-900"
                : "bg-emerald-600 hover:bg-emerald-700 text-white"
            }`}
          >
            {effectiveStatus === "completed" ? (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>Reopen</span>
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <span>Complete Project</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onOpenEditProject}
            className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded border-2 border-zinc-900 bg-white hover:bg-zinc-900 hover:text-white transition-colors cursor-pointer flex items-center gap-1.5 shadow-[2px_2px_0px_0px_#09090b] active:translate-x-0.5 active:translate-y-0.5 text-zinc-900"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            <span>Edit</span>
          </button>

          <button
            type="button"
            onClick={onOpenCreateTask}
            className="px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded border-2 border-red-600 bg-red-600 hover:bg-red-700 text-white transition-colors cursor-pointer flex items-center gap-1.5 shadow-[2px_2px_0px_0px_#09090b] active:translate-x-0.5 active:translate-y-0.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            <span>New Task</span>
          </button>

          <button
            type="button"
            onClick={() => onDeleteProject(project.id)}
            title="Delete Project"
            className="px-2.5 py-1.5 text-[11px] font-bold uppercase text-red-700 bg-red-50 hover:bg-red-600 hover:text-white border border-red-300 rounded transition-colors cursor-pointer"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>

      {/* Main Project Details Header */}
      <div className="p-5 lg:p-6 bg-white">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2 flex-1 min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-2xl lg:text-3xl font-oswald font-bold uppercase tracking-wide text-zinc-950 truncate">
                {project.name}
              </h1>

              {/* Status Pill with Dropdown */}
              <div className="relative" ref={statusRef}>
                <button
                  type="button"
                  onClick={() => setStatusMenuOpen(!statusMenuOpen)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border cursor-pointer transition-all ${
                    effectiveStatus === "completed"
                      ? "bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100"
                      : effectiveStatus === "on-hold"
                      ? "bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100"
                      : "bg-blue-50 text-blue-700 border-blue-300 hover:bg-blue-100"
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      effectiveStatus === "completed"
                        ? "bg-emerald-500"
                        : effectiveStatus === "on-hold"
                        ? "bg-amber-500"
                        : "bg-blue-500"
                    }`}
                  />
                  <span>{effectiveStatus}</span>
                  <svg className="w-2.5 h-2.5 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {statusMenuOpen && (
                  <div className="absolute left-0 mt-1 w-36 bg-white border-2 border-zinc-900 shadow-[3px_3px_0px_0px_#09090b] rounded py-1 z-50">
                    {["active", "on-hold", "completed"].map((st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => {
                          onToggleProjectStatus(project.id, st === "completed" ? "active" : st);
                          setStatusMenuOpen(false);
                        }}
                        className={`w-full text-left px-3 py-1.5 text-xs uppercase font-bold tracking-wider hover:bg-zinc-100 flex items-center gap-2 cursor-pointer ${
                          effectiveStatus === st ? "text-red-600 bg-red-50" : "text-zinc-800"
                        }`}
                      >
                        <span
                          className={`w-2 h-2 rounded-full ${
                            st === "completed" ? "bg-emerald-500" : st === "on-hold" ? "bg-amber-500" : "bg-blue-500"
                          }`}
                        />
                        {st}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Pending Approvals Flash Badge */}
              {pendingApprovalTasks > 0 && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-900 border border-amber-400 animate-pulse">
                  <svg className="w-3 h-3 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <span>{pendingApprovalTasks} review needed</span>
                </span>
              )}
            </div>

            {/* Client and Tags */}
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              {project.clientName && (
                <span className="text-xs font-bold text-red-600 uppercase tracking-wider bg-red-50 px-2 py-0.5 border border-red-200 rounded">
                  Client: {project.clientName}
                </span>
              )}

              {(project.projectTypes || []).map((t) => (
                <span
                  key={t}
                  className="text-[10px] font-bold uppercase tracking-wider text-zinc-600 bg-zinc-100 border border-zinc-300 px-2 py-0.5 rounded"
                >
                  {t}
                </span>
              ))}

              {(project.startDate || project.endDate) && (
                <span className="text-[10px] font-mono font-medium text-zinc-500 bg-zinc-50 px-2 py-0.5 border border-zinc-200 rounded">
                  📅 {project.startDate || "..."} → {project.endDate || "Ongoing"}
                </span>
              )}
            </div>

            {/* Description */}
            {project.description && (
              <div className="text-xs text-zinc-600 leading-relaxed max-w-3xl pt-1">
                <LinkifiedText text={project.description} />
              </div>
            )}
          </div>

          {/* Quick Progress Donut/Bar Card */}
          <div className="lg:w-72 shrink-0 bg-zinc-50 border border-zinc-200 rounded-lg p-3.5 shadow-xs">
            <div className="flex items-center justify-between text-xs font-mono mb-1.5">
              <span className="font-bold text-zinc-700 uppercase">Progress</span>
              <span className="font-bold text-zinc-950 font-oswald text-sm">{progressPercent}%</span>
            </div>

            {/* Segmented Progress Bar */}
            <div className="h-2.5 w-full bg-zinc-200 rounded-full overflow-hidden flex border border-zinc-300">
              <div
                style={{ width: `${progressPercent}%` }}
                className="bg-emerald-600 h-full transition-all duration-300"
                title={`${completedTasks} completed`}
              />
              {pendingApprovalTasks > 0 && totalTasks > 0 && (
                <div
                  style={{ width: `${Math.round((pendingApprovalTasks / totalTasks) * 100)}%` }}
                  className="bg-amber-500 h-full transition-all duration-300 animate-pulse"
                  title={`${pendingApprovalTasks} pending approval`}
                />
              )}
              {inProgressTasks > 0 && totalTasks > 0 && (
                <div
                  style={{ width: `${Math.round((inProgressTasks / totalTasks) * 100)}%` }}
                  className="bg-blue-500 h-full transition-all duration-300"
                  title={`${inProgressTasks} active`}
                />
              )}
            </div>

            <div className="flex items-center justify-between text-[10px] font-mono text-zinc-500 mt-2 font-bold uppercase">
              <span>{completedTasks}/{totalTasks} tasks done</span>
              {pendingApprovalTasks > 0 && (
                <span className="text-amber-800 font-bold">⚠️ {pendingApprovalTasks} review</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ClickUp View Switcher Navigation Tabs */}
      <div className="px-5 border-t border-zinc-200 bg-zinc-50/50 flex items-center justify-between gap-4 overflow-x-auto">
        <div className="flex items-center gap-1 py-1.5">
          {(
            [
              {
                id: "list" as const,
                label: "List",
                icon: (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h7" />
                  </svg>
                ),
                count: totalTasks,
              },
              {
                id: "board" as const,
                label: "Board",
                icon: (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
                  </svg>
                ),
                count: totalTasks,
              },
              {
                id: "calendar" as const,
                label: "Calendar",
                icon: (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                ),
                count: null,
              },
              {
                id: "chat" as const,
                label: "Group Chat",
                icon: (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" />
                  </svg>
                ),
                count: unreadChatCount > 0 ? unreadChatCount : null,
              },
              {
                id: "overview" as const,
                label: "Overview",
                icon: (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                ),
                count: null,
              },
            ] as const
          ).map((tab) => {
            const isActive = viewMode === tab.id;
            const isChatUnread = tab.id === "chat" && unreadChatCount > 0;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onSelectViewMode(tab.id)}
                className={`flex items-center gap-2 px-3.5 py-2 text-xs font-bold uppercase tracking-wider rounded-md transition-all cursor-pointer ${
                  isActive
                    ? "bg-zinc-950 text-white shadow-xs"
                    : isChatUnread
                    ? "bg-red-50 text-red-700 border border-red-300 hover:bg-red-100"
                    : "text-zinc-600 hover:text-zinc-950 hover:bg-zinc-200/60"
                }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
                {tab.count !== null && (
                  <span
                    className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono font-bold ${
                      isChatUnread
                        ? "bg-red-600 text-white animate-pulse"
                        : isActive
                        ? "bg-zinc-800 text-zinc-300"
                        : "bg-zinc-200 text-zinc-700"
                    }`}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
