"use client";

import { useState, useMemo } from "react";
import { Project, TaskRow, Worker, HubViewMode, getAssigneeIds, parseDate } from "./types";
import { stripRichHtml } from "@/components/admin/ui/LinkifiedText";
import { ChartCard, BarCompare, DonutBreakdown, DonutSlice } from "@/components/admin/ui/Charts";

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

type SortField = "updated" | "name" | "progress" | "tasks";

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
  const [clientFilter, setClientFilter] = useState<string>("all");
  const [filterTab, setFilterTab] = useState<"all" | "active" | "needs-approval" | "completed" | "unread">("all");
  const [sortField, setSortField] = useState<SortField>("updated");
  const [sortDir, setSortDir] = useState<"ascending" | "descending">("descending");
  const [showAnalytics, setShowAnalytics] = useState(true);

  const workerMap = useMemo(() => {
    const map = new Map<string, Worker>();
    workers.forEach((w) => map.set(w.id, w));
    return map;
  }, [workers]);

  // Unique client list for quick filtering
  const uniqueClients = useMemo(() => {
    const set = new Set<string>();
    projects.forEach((p) => {
      if (p.clientName?.trim()) set.add(p.clientName.trim());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [projects]);

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
  const totalCompletedTasks = tasks.filter((t) => t.status === "completed").length;
  const overallCompletionPct = tasks.length > 0 ? Math.round((totalCompletedTasks / tasks.length) * 100) : 0;

  // Portfolio Analytics Data
  const projectVelocityData = useMemo(() => {
    return projects
      .map((p) => {
        const pTasks = tasks.filter((t) => t.projectId === p.id);
        const completed = pTasks.filter((t) => t.status === "completed").length;
        const active = pTasks.filter((t) => ["assigned", "in-progress"].includes(t.status)).length;
        const review = pTasks.filter((t) => t.status === "pending-approval").length;
        return {
          project: p.name.length > 16 ? p.name.slice(0, 15) + "…" : p.name,
          Completed: completed,
          Active: active,
          Review: review,
          total: pTasks.length,
        };
      })
      .filter((d) => d.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 7);
  }, [projects, tasks]);

  const portfolioStatusSlices: DonutSlice[] = useMemo(() => {
    const completed = tasks.filter((t) => t.status === "completed").length;
    const inProgress = tasks.filter((t) => t.status === "in-progress").length;
    const assigned = tasks.filter((t) => t.status === "assigned").length;
    const review = tasks.filter((t) => t.status === "pending-approval").length;
    return [
      { key: "completed", label: "Completed", value: completed, color: "#10b981" },
      { key: "in-progress", label: "In Progress", value: inProgress, color: "#3b82f6" },
      { key: "assigned", label: "Assigned", value: assigned, color: "#6366f1" },
      { key: "needs-review", label: "Needs Review", value: review, color: "#f59e0b" },
    ];
  }, [tasks]);

  // Filtered & sorted projects
  const filteredProjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = projects.filter((p) => {
      const effStatus = getProjectEffectiveStatus(p);

      if (filterTab === "active" && effStatus !== "active") return false;
      if (filterTab === "completed" && effStatus !== "completed") return false;
      if (filterTab === "needs-approval" && !projectsNeedingApproval.has(p.id)) return false;
      if (filterTab === "unread" && !projectsWithUnread.has(p.id)) return false;
      if (clientFilter !== "all" && (p.clientName || "").trim() !== clientFilter) return false;

      if (!q) return true;
      const matchName = (p.name || "").toLowerCase().includes(q);
      const matchClient = (p.clientName || "").toLowerCase().includes(q);
      const matchTags = (p.projectTypes || []).join(" ").toLowerCase().includes(q);
      const matchDesc = (p.description || "").toLowerCase().includes(q);

      return matchName || matchClient || matchTags || matchDesc;
    });

    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
    const dir = sortDir === "ascending" ? 1 : -1;

    list.sort((a, b) => {
      if (sortField === "name") {
        return dir * collator.compare(a.name || "", b.name || "");
      }
      const aTasks = tasks.filter((t) => t.projectId === a.id);
      const bTasks = tasks.filter((t) => t.projectId === b.id);
      if (sortField === "tasks") {
        return dir * (aTasks.length - bTasks.length);
      }
      if (sortField === "progress") {
        const aPct = aTasks.length > 0 ? aTasks.filter((t) => t.status === "completed").length / aTasks.length : 0;
        const bPct = bTasks.length > 0 ? bTasks.filter((t) => t.status === "completed").length / bTasks.length : 0;
        return dir * (aPct - bPct);
      }
      const aTime = parseDate(a.updatedAt)?.getTime() ?? parseDate(a.createdAt)?.getTime() ?? 0;
      const bTime = parseDate(b.updatedAt)?.getTime() ?? parseDate(b.createdAt)?.getTime() ?? 0;
      return dir * (aTime - bTime);
    });

    return list;
  }, [projects, search, filterTab, clientFilter, sortField, sortDir, projectsNeedingApproval, projectsWithUnread, tasks]);

  const handleColumnSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "ascending" ? "descending" : "ascending"));
    } else {
      setSortField(field);
      setSortDir("ascending");
    }
  };

  return (
    <div className="space-y-6">
      {/* Studio Executive Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1 text-[11px] font-semibold tracking-wide text-zinc-600 shadow-2xs mb-2">
            <span className="h-1.5 w-1.5 rounded-full bg-red-600" />
            <span>STUDIO WORKSPACE · PORTFOLIO OPERATIONS</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-zinc-950">
            Project Command Center
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-zinc-500">
            Manage client rollouts, field operations, directive reviews, and real-time project channels.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setShowAnalytics((v) => !v)}
            className="brutal-btn-outline"
          >
            <svg className="h-3.5 w-3.5 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <span>{showAnalytics ? "Hide Analytics" : "Portfolio Insights"}</span>
          </button>

          <button
            type="button"
            id="btn-create-project"
            onClick={onOpenCreateProject}
            className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm shadow-red-600/20 transition-all hover:bg-red-700 active:scale-[0.99] cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.25}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            <span>New Project</span>
          </button>
        </div>
      </div>

      {/* Interactive KPI Filter Ribbon */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <button
          type="button"
          onClick={() => setFilterTab("all")}
          className={`ui-card ui-card-hover p-4 text-left transition-all cursor-pointer ${
            filterTab === "all" ? "ring-2 ring-zinc-900 bg-zinc-50/70" : ""
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Total Portfolio</span>
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-100 text-zinc-700">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
            </span>
          </div>
          <p className="mt-2 font-code text-2xl font-bold tracking-tight text-zinc-950">{projects.length}</p>
          <div className="mt-2 flex items-center justify-between text-[11px] text-zinc-500">
            <span>{uniqueClients.length} client accounts</span>
            <span className="font-code font-semibold text-zinc-700">{overallCompletionPct}% overall</span>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setFilterTab("active")}
          className={`ui-card ui-card-hover p-4 text-left transition-all cursor-pointer ${
            filterTab === "active" ? "ring-2 ring-blue-600 bg-blue-50/30" : ""
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-blue-700">Active Rollouts</span>
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </span>
          </div>
          <p className="mt-2 font-code text-2xl font-bold tracking-tight text-blue-700">{activeProjectsCount}</p>
          <div className="mt-2 flex items-center justify-between text-[11px] text-zinc-500">
            <span>Operations live</span>
            <span className="font-medium text-blue-600">Filter active →</span>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setFilterTab("needs-approval")}
          className={`ui-card ui-card-hover p-4 text-left transition-all cursor-pointer ${
            filterTab === "needs-approval"
              ? "ring-2 ring-amber-500 bg-amber-50/40"
              : totalPendingReviews > 0
              ? "border-amber-300 bg-amber-50/20"
              : ""
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-800">Pending Reviews</span>
            <span className="relative flex h-7 w-7 items-center justify-center rounded-lg bg-amber-100/80 text-amber-700">
              {totalPendingReviews > 0 && (
                <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-500 animate-ping" />
              )}
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </span>
          </div>
          <p className={`mt-2 font-code text-2xl font-bold tracking-tight ${totalPendingReviews > 0 ? "text-amber-700" : "text-zinc-400"}`}>
            {totalPendingReviews}
          </p>
          <div className="mt-2 flex items-center justify-between text-[11px] text-amber-800/80">
            <span>{projectsNeedingApproval.size} project{projectsNeedingApproval.size === 1 ? "" : "s"} waiting</span>
            <span className="font-semibold">{filterTab === "needs-approval" ? "Active filter" : "Inspect →"}</span>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setFilterTab("completed")}
          className={`ui-card ui-card-hover p-4 text-left transition-all cursor-pointer ${
            filterTab === "completed" ? "ring-2 ring-emerald-600 bg-emerald-50/30" : ""
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">Delivered</span>
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </span>
          </div>
          <p className="mt-2 font-code text-2xl font-bold tracking-tight text-emerald-700">{completedProjectsCount}</p>
          <div className="mt-2 flex items-center justify-between text-[11px] text-zinc-500">
            <span>{totalCompletedTasks} tasks finished</span>
            <span className="font-medium text-emerald-600">View archive →</span>
          </div>
        </button>
      </div>

      {/* Collapsible Executive Portfolio Analytics */}
      {showAnalytics && projects.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 animate-fade-in">
          <ChartCard
            className="lg:col-span-7"
            title="Project Directive Volume & Completion"
            subtitle="Task distribution across top active & delivered projects"
            badge={
              <span className="rounded-md bg-zinc-100 px-2 py-0.5 font-code text-[10px] font-semibold text-zinc-600">
                Top {projectVelocityData.length} Projects
              </span>
            }
          >
            {projectVelocityData.length === 0 ? (
              <div className="flex h-48 items-center justify-center text-xs text-zinc-400">
                Assign tasks to projects to visualize portfolio velocity
              </div>
            ) : (
              <BarCompare
                data={projectVelocityData}
                xKey="project"
                series={[
                  { key: "Completed", label: "Completed", color: "#10b981" },
                  { key: "Active", label: "In Progress", color: "#3b82f6" },
                  { key: "Review", label: "Needs Review", color: "#f59e0b" },
                ]}
                height={210}
                description="Portfolio velocity by project"
              />
            )}
          </ChartCard>

          <ChartCard
            className="lg:col-span-5"
            title="Portfolio Directive Breakdown"
            subtitle="All project tasks grouped by execution status"
            badge={
              <span className="rounded-md bg-emerald-50 px-2 py-0.5 font-code text-[10px] font-semibold text-emerald-700">
                {overallCompletionPct}% Complete
              </span>
            }
          >
            <DonutBreakdown
              slices={portfolioStatusSlices}
              centerLabel="Total Tasks"
              centerValue={String(tasks.length)}
              size={165}
              description="Project task status breakdown"
            />
          </ChartCard>
        </div>
      )}

      {/* Search, Accessible Tab Filters & View Controls */}
      <div className="ui-card p-3.5 flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Search Input */}
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <svg
              className="w-4 h-4 text-zinc-400 absolute left-3 top-2.5 pointer-events-none"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search projects by name, client, category..."
              aria-label="Search projects"
              className="w-full rounded-xl border border-zinc-200 bg-zinc-50/70 pl-9 pr-8 py-1.5 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-900 focus:bg-white focus:outline-none transition-all"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label="Clear search"
                className="absolute right-2.5 top-1.5 text-zinc-400 hover:text-zinc-900 font-bold cursor-pointer"
              >
                &times;
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Client Filter */}
            {uniqueClients.length > 0 && (
              <select
                value={clientFilter}
                onChange={(e) => setClientFilter(e.target.value)}
                aria-label="Filter by client"
                className="rounded-xl border border-zinc-200 bg-zinc-50/70 px-3 py-1.5 text-xs font-medium text-zinc-700 focus:border-zinc-900 focus:bg-white focus:outline-none cursor-pointer"
              >
                <option value="all">All Clients ({uniqueClients.length})</option>
                {uniqueClients.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            )}

            {/* Sort Selector */}
            <select
              value={`${sortField}:${sortDir}`}
              onChange={(e) => {
                const [f, d] = e.target.value.split(":") as [SortField, "ascending" | "descending"];
                setSortField(f);
                setSortDir(d);
              }}
              aria-label="Sort projects"
              className="rounded-xl border border-zinc-200 bg-zinc-50/70 px-3 py-1.5 text-xs font-medium text-zinc-700 focus:border-zinc-900 focus:bg-white focus:outline-none cursor-pointer"
            >
              <option value="updated:descending">Sort: Recently Active</option>
              <option value="progress:descending">Sort: Highest Progress</option>
              <option value="tasks:descending">Sort: Most Directives</option>
              <option value="name:ascending">Sort: Name (A–Z)</option>
            </select>

            {/* View Switcher: Grid vs Table */}
            <div className="inline-flex items-center rounded-xl border border-zinc-200 bg-zinc-100/80 p-0.5">
              <button
                type="button"
                onClick={() => setHubView("grid")}
                title="Grid Cards View"
                aria-label="Grid Cards View"
                className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-all cursor-pointer ${
                  hubView === "grid" ? "bg-white text-zinc-950 shadow-2xs" : "text-zinc-500 hover:text-zinc-900"
                }`}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                </svg>
                <span className="hidden sm:inline">Cards</span>
              </button>
              <button
                type="button"
                onClick={() => setHubView("table")}
                title="Table List View"
                aria-label="Table List View"
                className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-all cursor-pointer ${
                  hubView === "table" ? "bg-white text-zinc-950 shadow-2xs" : "text-zinc-500 hover:text-zinc-900"
                }`}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                </svg>
                <span className="hidden sm:inline">Table</span>
              </button>
            </div>
          </div>
        </div>

        {/* Accessible Status Filter Tablist (modern-web-guidance: tabs) */}
        <div
          role="tablist"
          aria-label="Project status filter"
          className="flex items-center gap-1 overflow-x-auto border-t border-zinc-100 pt-2"
        >
          {(
            [
              { id: "all", label: "All Projects", count: projects.length },
              { id: "active", label: "Active", count: activeProjectsCount },
              {
                id: "needs-approval",
                label: "Needs Review",
                count: projectsNeedingApproval.size,
                highlight: projectsNeedingApproval.size > 0,
              },
              { id: "completed", label: "Completed", count: completedProjectsCount },
              ...(projectsWithUnread.size > 0
                ? [{ id: "unread", label: "Unread Chat", count: projectsWithUnread.size, highlight: true }]
                : []),
            ] as const
          ).map((tab) => {
            const isSelected = filterTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isSelected}
                onClick={() => setFilterTab(tab.id as typeof filterTab)}
                className={`mft-tab-btn inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                  isSelected
                    ? "text-zinc-950 bg-zinc-100/80"
                    : (tab as { highlight?: boolean }).highlight
                    ? "text-amber-800 hover:bg-amber-50"
                    : "text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50"
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`rounded-full px-1.5 py-0.2 font-code text-[10px] font-semibold ${
                    isSelected
                      ? "bg-zinc-900 text-white"
                      : (tab as { highlight?: boolean }).highlight
                      ? "bg-amber-100 text-amber-900"
                      : "bg-zinc-100 text-zinc-600"
                  }`}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Projects Content: Grid or Accessible Sortable Table */}
      {filteredProjects.length === 0 ? (
        <div className="ui-card p-12 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-500">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
          </div>
          <p className="text-sm font-semibold text-zinc-900">
            {filterTab === "needs-approval" ? "No projects with pending approvals" : "No projects match your current filters"}
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            Try clearing your search query or switching back to all projects.
          </p>
          {(filterTab !== "all" || clientFilter !== "all" || search) && (
            <button
              type="button"
              onClick={() => {
                setFilterTab("all");
                setClientFilter("all");
                setSearch("");
              }}
              className="mt-4 brutal-btn"
            >
              Reset All Filters
            </button>
          )}
        </div>
      ) : hubView === "grid" ? (
        /* ─── Studio Grid View ─── */
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
                className={`ui-card ui-card-hover p-5 cursor-pointer flex flex-col justify-between group relative ${
                  hasPending ? "ring-1 ring-amber-400/90" : ""
                }`}
              >
                {/* Unread badge */}
                {unreadCount > 0 && (
                  <span className="absolute -top-2 -right-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-red-600 font-code text-[11px] font-bold text-white px-1.5 shadow-md ring-2 ring-white">
                    {unreadCount}
                  </span>
                )}

                <div>
                  {/* Top Status & Pending Badges */}
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span
                        className={`inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider px-2.5 py-0.5 rounded-full border ${
                          isCompleted
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : "bg-blue-50 text-blue-700 border-blue-200"
                        }`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${isCompleted ? "bg-emerald-500" : "bg-blue-500"}`} />
                        {effectiveStatus}
                      </span>

                      {hasPending && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 bg-amber-50 text-amber-800 border border-amber-300 rounded-full">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-ping" />
                          {pendingApprovalCount} Review
                        </span>
                      )}
                    </div>

                    <span className="font-code text-[11px] font-semibold text-zinc-600 bg-zinc-100/90 px-2.5 py-0.5 rounded-lg border border-zinc-200/80">
                      {pTaskCount} {pTaskCount === 1 ? "Task" : "Tasks"}
                    </span>
                  </div>

                  {/* Project Title & Client */}
                  <h3 className="text-base font-bold text-zinc-950 tracking-tight group-hover:text-red-600 transition-colors line-clamp-1">
                    {p.name}
                  </h3>
                  {p.clientName && (
                    <p className="text-xs font-semibold text-red-600 mt-0.5">
                      {p.clientName}
                    </p>
                  )}

                  {/* Description */}
                  {p.description && (
                    <p className="text-xs text-zinc-500 mt-2 line-clamp-2 leading-relaxed">
                      {stripRichHtml(p.description)}
                    </p>
                  )}

                  {/* Progress Bar */}
                  <div className="mt-4 pt-3 border-t border-zinc-100">
                    <div className="flex items-center justify-between text-[11px] text-zinc-500 font-medium mb-1.5">
                      <span>Completion Progress</span>
                      <span className="font-code font-bold text-zinc-900">
                        {completedCount}/{pTaskCount} ({progressPercent}%)
                      </span>
                    </div>
                    <div className="h-2 w-full bg-zinc-100 rounded-full overflow-hidden flex">
                      <div style={{ width: `${progressPercent}%` }} className="bg-emerald-500 h-full transition-all duration-300" />
                      {pendingApprovalCount > 0 && pTaskCount > 0 && (
                        <div
                          style={{ width: `${Math.round((pendingApprovalCount / pTaskCount) * 100)}%` }}
                          className="bg-amber-500 h-full"
                        />
                      )}
                      {inProgressCount > 0 && pTaskCount > 0 && (
                        <div
                          style={{ width: `${Math.round((inProgressCount / pTaskCount) * 100)}%` }}
                          className="bg-blue-500 h-full"
                        />
                      )}
                    </div>
                  </div>

                  {/* Team Avatars & Tags */}
                  <div className="mt-3.5 pt-3 border-t border-zinc-100 flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center -space-x-1.5">
                      {assignedWorkers.slice(0, 4).map((w) => (
                        <span
                          key={w.id}
                          title={`${w.firstName} ${w.lastName}`}
                          className="w-6 h-6 rounded-full bg-zinc-900 text-white text-[9px] font-bold flex items-center justify-center border-2 border-white uppercase shadow-2xs shrink-0"
                        >
                          {w.firstName?.[0]}{w.lastName?.[0]}
                        </span>
                      ))}
                      {assignedWorkers.length > 4 && (
                        <span className="w-6 h-6 rounded-full bg-zinc-100 text-zinc-700 text-[9px] font-bold flex items-center justify-center border-2 border-white shrink-0">
                          +{assignedWorkers.length - 4}
                        </span>
                      )}
                      {assignedWorkers.length === 0 && (
                        <span className="text-[11px] text-zinc-400">No assignees yet</span>
                      )}
                    </div>

                    <div className="flex items-center gap-1 flex-wrap">
                      {(p.projectTypes || []).slice(0, 2).map((t) => (
                        <span
                          key={t}
                          className="text-[10px] font-medium text-zinc-600 bg-zinc-100 border border-zinc-200/80 px-2 py-0.5 rounded-md"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Latest Chat Message Preview */}
                {p.lastMessageText && (
                  <div className="mt-3 px-3 py-2 rounded-xl bg-zinc-50 border border-zinc-200/70 text-[11px] text-zinc-600 truncate">
                    <span className="font-semibold text-zinc-800">{p.lastMessageSender || "Channel"}:</span>{" "}
                    {p.lastMessageText}
                  </div>
                )}

                {/* Card Footer Actions */}
                <div className="mt-4 pt-3 border-t border-zinc-100 flex items-center justify-between text-xs gap-2 flex-wrap">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenProjectChat?.(p);
                      }}
                      className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg border transition-colors cursor-pointer flex items-center gap-1 ${
                        unreadCount > 0
                          ? "border-red-600 bg-red-600 text-white"
                          : "border-zinc-200 bg-zinc-50 text-zinc-700 hover:bg-zinc-900 hover:text-white hover:border-zinc-900"
                      }`}
                      title={`Open ${p.name} Group Chat`}
                    >
                      <span>💬 Chat</span>
                      {unreadCount > 0 && <span className="font-code">({unreadCount})</span>}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenCreateTaskForProject(p);
                      }}
                      className="px-2.5 py-1 text-[11px] font-semibold rounded-lg border border-red-200 bg-red-50/70 text-red-700 hover:bg-red-600 hover:text-white hover:border-red-600 transition-colors cursor-pointer flex items-center gap-1"
                      title={`Assign a new task to ${p.name}`}
                    >
                      <span>+ Task</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenEditProject(p);
                      }}
                      className="p-1 text-zinc-400 hover:text-zinc-800 rounded-lg hover:bg-zinc-100 transition-colors cursor-pointer"
                      title="Edit project settings"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                  </div>
                  <span className="font-semibold text-xs text-red-600 group-hover:translate-x-0.5 transition-transform inline-flex items-center gap-1">
                    Workspace →
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* ─── Accessible Responsive & Sortable Table View (modern-web-guidance: responsive-table, sortable-table) ─── */
        <div
          tabIndex={0}
          role="region"
          aria-labelledby="projects-table-caption"
          className="ui-card mft-table-wrapper"
        >
          <table className="w-full text-left text-xs">
            <caption id="projects-table-caption" className="sr-only">
              Studio projects portfolio table
            </caption>
            <thead>
              <tr className="bg-zinc-50/95 border-b border-zinc-200 text-[11px] font-semibold text-zinc-500">
                <th
                  scope="col"
                  aria-sort={sortField === "name" ? sortDir : undefined}
                  className="py-3 px-4"
                >
                  <button
                    type="button"
                    onClick={() => handleColumnSort("name")}
                    className="inline-flex items-center gap-1 font-semibold text-zinc-600 hover:text-zinc-950 cursor-pointer"
                  >
                    <span>Project / Client</span>
                    <span aria-hidden="true" className="text-[10px] opacity-60">
                      {sortField === "name" ? (sortDir === "ascending" ? "↑" : "↓") : "↕"}
                    </span>
                  </button>
                </th>
                <th scope="col" className="py-3 px-4">Status</th>
                <th
                  scope="col"
                  aria-sort={sortField === "progress" ? sortDir : undefined}
                  className="py-3 px-4"
                >
                  <button
                    type="button"
                    onClick={() => handleColumnSort("progress")}
                    className="inline-flex items-center gap-1 font-semibold text-zinc-600 hover:text-zinc-950 cursor-pointer"
                  >
                    <span>Progress</span>
                    <span aria-hidden="true" className="text-[10px] opacity-60">
                      {sortField === "progress" ? (sortDir === "ascending" ? "↑" : "↓") : "↕"}
                    </span>
                  </button>
                </th>
                <th
                  scope="col"
                  aria-sort={sortField === "tasks" ? sortDir : undefined}
                  className="py-3 px-4"
                >
                  <button
                    type="button"
                    onClick={() => handleColumnSort("tasks")}
                    className="inline-flex items-center gap-1 font-semibold text-zinc-600 hover:text-zinc-950 cursor-pointer"
                  >
                    <span>Directives</span>
                    <span aria-hidden="true" className="text-[10px] opacity-60">
                      {sortField === "tasks" ? (sortDir === "ascending" ? "↑" : "↓") : "↕"}
                    </span>
                  </button>
                </th>
                <th scope="col" className="py-3 px-4">Team</th>
                <th scope="col" className="py-3 px-4">Timeline</th>
                <th scope="col" className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
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
                    className="hover:bg-zinc-50/80 transition-colors cursor-pointer group"
                  >
                    <th scope="row" className="py-3.5 px-4 font-normal text-left">
                      <div className="font-semibold text-sm text-zinc-950 group-hover:text-red-600 transition-colors truncate max-w-xs">
                        {p.name}
                      </div>
                      {p.clientName && (
                        <div className="text-[11px] text-red-600 font-medium">
                          {p.clientName}
                        </div>
                      )}
                    </th>

                    <td className="py-3.5 px-4">
                      <span
                        className={`inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase px-2.5 py-0.5 rounded-full border ${
                          effectiveStatus === "completed"
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : "bg-blue-50 text-blue-700 border-blue-200"
                        }`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${effectiveStatus === "completed" ? "bg-emerald-500" : "bg-blue-500"}`} />
                        {effectiveStatus}
                      </span>
                    </td>

                    <td className="py-3.5 px-4 min-w-[150px]">
                      <div className="flex items-center gap-2.5">
                        <div className="flex-1 h-2 bg-zinc-100 rounded-full overflow-hidden">
                          <div style={{ width: `${progressPercent}%` }} className="bg-emerald-500 h-full" />
                        </div>
                        <span className="font-code text-[11px] font-semibold text-zinc-700">{progressPercent}%</span>
                      </div>
                    </td>

                    <td className="py-3.5 px-4 font-code">
                      <span className="font-semibold text-zinc-800">{completedCount}/{pTaskCount}</span>
                      {pendingApprovalCount > 0 && (
                        <span className="ml-1.5 px-2 py-0.5 bg-amber-50 text-amber-800 border border-amber-300 rounded-full text-[10px] font-semibold">
                          {pendingApprovalCount} review
                        </span>
                      )}
                    </td>

                    <td className="py-3.5 px-4">
                      <div className="flex items-center -space-x-1.5">
                        {assignedWorkers.slice(0, 3).map((w) => (
                          <span
                            key={w.id}
                            title={`${w.firstName} ${w.lastName}`}
                            className="w-6 h-6 rounded-full bg-zinc-900 text-white text-[9px] font-bold flex items-center justify-center border-2 border-white uppercase"
                          >
                            {w.firstName?.[0]}{w.lastName?.[0]}
                          </span>
                        ))}
                        {assignedWorkers.length > 3 && (
                          <span className="w-6 h-6 rounded-full bg-zinc-100 text-zinc-700 text-[9px] font-bold flex items-center justify-center border-2 border-white">
                            +{assignedWorkers.length - 3}
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="py-3.5 px-4 font-code text-[11px] text-zinc-500">
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
                          className="px-2.5 py-1 bg-zinc-100 hover:bg-zinc-900 hover:text-white text-zinc-700 text-[11px] font-semibold rounded-lg cursor-pointer transition-colors"
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
                          className="px-2.5 py-1 bg-red-50 hover:bg-red-600 text-red-700 hover:text-white border border-red-200 text-[11px] font-semibold rounded-lg cursor-pointer transition-colors"
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
                          className="px-2.5 py-1 bg-zinc-900 hover:bg-zinc-800 text-white text-[11px] font-semibold rounded-lg cursor-pointer transition-colors"
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
