"use client";

import { useState, useRef, useEffect } from "react";
import { Project, ProjectViewMode, TaskRow, Worker } from "./types";
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
  const [switcherQuery, setSwitcherQuery] = useState("");
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const switcherRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);

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

  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((t) => t.status === "completed").length;
  const pendingApprovalTasks = tasks.filter((t) => t.status === "pending-approval").length;
  const inProgressTasks = tasks.filter((t) => ["assigned", "in-progress"].includes(t.status)).length;
  const progressPercent = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const effectiveStatus = project.status || "active";
  const filteredSwitcherProjects = allProjects.filter((p) => {
    const q = switcherQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      (p.name || "").toLowerCase().includes(q) ||
      (p.clientName || "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="ui-card overflow-visible mb-6 transition-all">
      {/* Top Breadcrumb & Switcher Bar */}
      <div className="px-5 py-3 border-b border-zinc-100 bg-zinc-50/70 rounded-t-2xl flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={onBackToProjects}
            className="inline-flex items-center gap-1.5 font-semibold text-zinc-500 hover:text-zinc-950 transition-colors cursor-pointer"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            <span>Projects Portfolio</span>
          </button>

          <span className="text-zinc-300">/</span>

          {/* Quick Project Switcher Dropdown */}
          <div className="relative" ref={switcherRef}>
            <button
              type="button"
              onClick={() => setSwitcherOpen(!switcherOpen)}
              className="inline-flex items-center gap-2 px-3 py-1 rounded-xl bg-white hover:bg-zinc-50 border border-zinc-200 text-zinc-900 font-semibold shadow-2xs transition-all cursor-pointer"
            >
              <span className="w-2 h-2 rounded-full bg-red-600 inline-block" />
              <span className="max-w-[220px] truncate">{project.name}</span>
              <svg className="w-3.5 h-3.5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {switcherOpen && (
              <div className="absolute left-0 mt-1.5 w-80 rounded-2xl border border-zinc-200 bg-white shadow-xl py-2 z-50 animate-scale-in">
                <div className="px-3 pb-2 border-b border-zinc-100">
                  <input
                    type="search"
                    value={switcherQuery}
                    onChange={(e) => setSwitcherQuery(e.target.value)}
                    placeholder="Quick switch project..."
                    className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-900 focus:bg-white focus:outline-none"
                  />
                </div>
                <div className="max-h-72 overflow-y-auto py-1">
                  {filteredSwitcherProjects.map((p) => {
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
                          isCurrent ? "bg-red-50/70 text-red-950 font-semibold" : "hover:bg-zinc-50 text-zinc-800"
                        }`}
                      >
                        <div className="truncate pr-2">
                          <p className="truncate font-semibold">{p.name}</p>
                          {p.clientName && <p className="text-[11px] text-zinc-500 truncate">{p.clientName}</p>}
                        </div>
                        <span
                          className={`text-[10px] px-2 py-0.5 font-semibold uppercase rounded-full border ${
                            p.status === "completed"
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : "bg-blue-50 text-blue-700 border-blue-200"
                          }`}
                        >
                          {p.status || "active"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Header Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => onToggleProjectStatus(project.id, effectiveStatus)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-xl border transition-all cursor-pointer inline-flex items-center gap-1.5 ${
              effectiveStatus === "completed"
                ? "bg-white border-zinc-200 hover:bg-zinc-50 text-zinc-700"
                : "bg-emerald-600 border-emerald-600 hover:bg-emerald-700 text-white shadow-2xs"
            }`}
          >
            {effectiveStatus === "completed" ? (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>Reopen</span>
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <span>Complete Project</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onOpenEditProject}
            className="brutal-btn-outline"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            <span>Edit</span>
          </button>

          <button
            type="button"
            onClick={onOpenCreateTask}
            className="inline-flex items-center gap-1.5 rounded-xl bg-red-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-2xs hover:bg-red-700 transition-colors cursor-pointer"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            <span>New Task</span>
          </button>

          <button
            type="button"
            onClick={() => onDeleteProject(project.id)}
            title="Delete Project"
            aria-label="Delete Project"
            className="p-1.5 text-zinc-400 hover:text-red-600 hover:bg-red-50 border border-transparent hover:border-red-200 rounded-xl transition-colors cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>

      {/* Main Project Details Header */}
      <div className="p-5 lg:p-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2.5 flex-1 min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-xl lg:text-2xl font-bold tracking-tight text-zinc-950 truncate">
                {project.name}
              </h1>

              {/* Status Pill with Dropdown */}
              <div className="relative" ref={statusRef}>
                <button
                  type="button"
                  onClick={() => setStatusMenuOpen(!statusMenuOpen)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wider border cursor-pointer transition-all ${
                    effectiveStatus === "completed"
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                      : effectiveStatus === "on-hold"
                      ? "bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100"
                      : "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100"
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
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
                  <div className="absolute left-0 mt-1.5 w-36 bg-white border border-zinc-200 shadow-lg rounded-xl py-1 z-50 animate-scale-in">
                    {["active", "on-hold", "completed"].map((st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => {
                          onToggleProjectStatus(project.id, st === "completed" ? "active" : st);
                          setStatusMenuOpen(false);
                        }}
                        className={`w-full text-left px-3 py-1.5 text-xs uppercase font-semibold hover:bg-zinc-50 flex items-center gap-2 cursor-pointer ${
                          effectiveStatus === st ? "text-red-600 bg-red-50/60" : "text-zinc-800"
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

              {pendingApprovalTasks > 0 && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-ping" />
                  <span>{pendingApprovalTasks} review needed</span>
                </span>
              )}
            </div>

            {/* Client and Tags */}
            <div className="flex flex-wrap items-center gap-2">
              {project.clientName && (
                <span className="text-xs font-semibold text-red-700 bg-red-50 px-2.5 py-0.5 border border-red-200/80 rounded-lg">
                  Client: {project.clientName}
                </span>
              )}

              {(project.projectTypes || []).map((t) => (
                <span
                  key={t}
                  className="text-[11px] font-medium text-zinc-600 bg-zinc-100 border border-zinc-200/80 px-2 py-0.5 rounded-lg"
                >
                  {t}
                </span>
              ))}

              {(project.startDate || project.endDate) && (
                <span className="font-code text-[11px] font-medium text-zinc-500 bg-zinc-50 px-2.5 py-0.5 border border-zinc-200/80 rounded-lg">
                  📅 {project.startDate || "..."} → {project.endDate || "Ongoing"}
                </span>
              )}
            </div>

            {/* Description */}
            {project.description && (
              <div className="text-xs text-zinc-600 leading-relaxed max-w-3xl pt-0.5">
                <LinkifiedText text={project.description} />
              </div>
            )}
          </div>

          {/* Quick Progress Card */}
          <div className="lg:w-72 shrink-0 bg-zinc-50/80 border border-zinc-200/80 rounded-xl p-4">
            <div className="flex items-center justify-between text-xs mb-2">
              <span className="font-semibold text-zinc-600">Rollout Progress</span>
              <span className="font-code font-bold text-zinc-950 text-sm">{progressPercent}%</span>
            </div>

            <div className="h-2.5 w-full bg-zinc-200/80 rounded-full overflow-hidden flex">
              <div
                style={{ width: `${progressPercent}%` }}
                className="bg-emerald-500 h-full transition-all duration-300"
                title={`${completedTasks} completed`}
              />
              {pendingApprovalTasks > 0 && totalTasks > 0 && (
                <div
                  style={{ width: `${Math.round((pendingApprovalTasks / totalTasks) * 100)}%` }}
                  className="bg-amber-500 h-full transition-all duration-300"
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

            <div className="flex items-center justify-between font-code text-[11px] text-zinc-500 mt-2 font-medium">
              <span>{completedTasks}/{totalTasks} directives done</span>
              {pendingApprovalTasks > 0 && (
                <span className="text-amber-700 font-semibold">{pendingApprovalTasks} in review</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Accessible View Switcher Tabs (modern-web-guidance: tabs) */}
      <div
        role="tablist"
        aria-label="Project workspace views"
        className="px-5 border-t border-zinc-100 bg-zinc-50/50 rounded-b-2xl flex items-center gap-1 overflow-x-auto py-1.5"
      >
        {(
          [
            {
              id: "list" as const,
              label: "List",
              icon: (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h7" />
                </svg>
              ),
              count: totalTasks,
            },
            {
              id: "board" as const,
              label: "Board",
              icon: (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
                </svg>
              ),
              count: totalTasks,
            },
            {
              id: "calendar" as const,
              label: "Calendar",
              icon: (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              ),
              count: null,
            },
            {
              id: "chat" as const,
              label: "Group Chat",
              icon: (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" />
                </svg>
              ),
              count: unreadChatCount > 0 ? unreadChatCount : null,
            },
            {
              id: "overview" as const,
              label: "Overview & Analytics",
              icon: (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9}>
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
              role="tab"
              aria-selected={isActive}
              onClick={() => onSelectViewMode(tab.id)}
              className={`mft-tab-btn inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-xl transition-all cursor-pointer ${
                isActive
                  ? "bg-white text-zinc-950 shadow-2xs"
                  : isChatUnread
                  ? "bg-red-50 text-red-700 border border-red-200 hover:bg-red-100"
                  : "text-zinc-600 hover:text-zinc-950 hover:bg-white/60"
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
              {tab.count !== null && (
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-full font-code font-semibold ${
                    isChatUnread
                      ? "bg-red-600 text-white"
                      : isActive
                      ? "bg-zinc-900 text-white"
                      : "bg-zinc-200/80 text-zinc-700"
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
  );
}
