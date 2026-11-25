"use client";

import { Worker } from "./types";
import { TASK_DEPARTMENTS } from "@/lib/admin/constants";

interface Props {
  search: string;
  onSearchChange: (v: string) => void;
  selectedWorkerId: string;
  onSelectWorkerId: (id: string) => void;
  selectedPriority: string;
  onSelectPriority: (p: string) => void;
  selectedDepartment: string;
  onSelectDepartment: (d: string) => void;
  groupBy: "status" | "priority" | "none";
  onGroupByChange: (g: "status" | "priority" | "none") => void;
  sortBy: "dueDate" | "priority" | "createdAt" | "title";
  onSortByChange: (s: "dueDate" | "priority" | "createdAt" | "title") => void;
  workers: Worker[];
  onOpenCreateTask: () => void;
  totalFilteredCount: number;
}

export default function ProjectFilterToolbar({
  search,
  onSearchChange,
  selectedWorkerId,
  onSelectWorkerId,
  selectedPriority,
  onSelectPriority,
  selectedDepartment,
  onSelectDepartment,
  groupBy,
  onGroupByChange,
  sortBy,
  onSortByChange,
  workers,
  onOpenCreateTask,
  totalFilteredCount,
}: Props) {
  const hasActiveFilters =
    search || selectedWorkerId || selectedPriority !== "all" || selectedDepartment !== "all";

  const clearFilters = () => {
    onSearchChange("");
    onSelectWorkerId("");
    onSelectPriority("all");
    onSelectDepartment("all");
  };

  return (
    <div className="ui-card p-3.5 mb-5 flex flex-wrap items-center justify-between gap-3 text-xs">
      {/* Search and Filters row */}
      <div className="flex items-center gap-2 flex-wrap flex-1 min-w-[280px]">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <svg
            className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-2.5 pointer-events-none"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Filter tasks, descriptions..."
            aria-label="Search project tasks"
            className="w-full pl-8 pr-7 py-1.5 bg-zinc-50/70 border border-zinc-200 rounded-xl text-xs text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-zinc-900 focus:bg-white transition-all"
          />
          {search && (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              aria-label="Clear task search"
              className="absolute right-2.5 top-1.5 text-zinc-400 hover:text-zinc-900 font-bold cursor-pointer"
            >
              &times;
            </button>
          )}
        </div>

        {/* Assignee Filter */}
        <select
          value={selectedWorkerId}
          onChange={(e) => onSelectWorkerId(e.target.value)}
          aria-label="Filter by assignee"
          className="px-2.5 py-1.5 bg-zinc-50/70 border border-zinc-200 rounded-xl text-xs text-zinc-700 font-medium focus:outline-none focus:border-zinc-900 focus:bg-white cursor-pointer"
        >
          <option value="">All Assignees</option>
          {workers.map((w) => (
            <option key={w.id} value={w.id}>
              {w.firstName} {w.lastName}
            </option>
          ))}
        </select>

        {/* Priority Filter */}
        <select
          value={selectedPriority}
          onChange={(e) => onSelectPriority(e.target.value)}
          aria-label="Filter by priority"
          className="px-2.5 py-1.5 bg-zinc-50/70 border border-zinc-200 rounded-xl text-xs text-zinc-700 font-medium focus:outline-none focus:border-zinc-900 focus:bg-white cursor-pointer"
        >
          <option value="all">All Priorities</option>
          <option value="urgent">🔴 Urgent</option>
          <option value="high">🟠 High</option>
          <option value="medium">🔵 Normal</option>
          <option value="low">⚪ Low</option>
        </select>

        {/* Department Filter */}
        <select
          value={selectedDepartment}
          onChange={(e) => onSelectDepartment(e.target.value)}
          aria-label="Filter by department"
          className="px-2.5 py-1.5 bg-zinc-50/70 border border-zinc-200 rounded-xl text-xs text-zinc-700 font-medium focus:outline-none focus:border-zinc-900 focus:bg-white cursor-pointer capitalize"
        >
          <option value="all">All Departments</option>
          {TASK_DEPARTMENTS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="text-xs text-red-600 hover:text-red-700 font-semibold cursor-pointer px-1.5"
          >
            Reset
          </button>
        )}
      </div>

      {/* Grouping, Sorting & Quick Add */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 text-zinc-500 text-xs">
          <span className="font-medium">Group:</span>
          <select
            value={groupBy}
            onChange={(e) => onGroupByChange(e.target.value as "status" | "priority" | "none")}
            aria-label="Group tasks by"
            className="px-2.5 py-1 bg-zinc-100/80 border border-zinc-200 rounded-lg text-zinc-900 font-semibold focus:outline-none cursor-pointer"
          >
            <option value="status">Status</option>
            <option value="priority">Priority</option>
            <option value="none">None</option>
          </select>
        </div>

        <div className="flex items-center gap-1.5 text-zinc-500 text-xs">
          <span className="font-medium">Sort:</span>
          <select
            value={sortBy}
            onChange={(e) => onSortByChange(e.target.value as "dueDate" | "priority" | "createdAt" | "title")}
            aria-label="Sort tasks by"
            className="px-2.5 py-1 bg-zinc-100/80 border border-zinc-200 rounded-lg text-zinc-900 font-semibold focus:outline-none cursor-pointer"
          >
            <option value="dueDate">Due Date</option>
            <option value="priority">Priority</option>
            <option value="createdAt">Created</option>
            <option value="title">Title</option>
          </select>
        </div>

        <span className="rounded-lg bg-zinc-100 px-2 py-1 font-code text-[11px] font-semibold text-zinc-600">
          {totalFilteredCount} {totalFilteredCount === 1 ? "task" : "tasks"}
        </span>

        <button
          type="button"
          onClick={onOpenCreateTask}
          className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-xl text-xs transition-colors cursor-pointer inline-flex items-center gap-1.5 shadow-2xs"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          <span>New Task</span>
        </button>
      </div>
    </div>
  );
}
