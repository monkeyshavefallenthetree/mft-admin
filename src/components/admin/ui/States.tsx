"use client";

import type { ReactNode } from "react";

function Svg({ d, className = "h-6 w-6" }: { d: string; className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

export const STATE_ICONS = {
  inbox: "M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4",
  search: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z",
  error: "M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z",
  check: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
  clock: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
  users: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z",
  chart: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z",
};

export function EmptyState({
  title,
  description,
  icon = STATE_ICONS.inbox,
  action,
  compact = false,
}: {
  title: string;
  description?: string;
  icon?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${compact ? "px-4 py-8" : "px-6 py-16"}`}>
      <div className="relative mb-4">
        <div className="absolute inset-0 -m-2 rounded-full bg-zinc-100/70" />
        <span className="relative flex h-12 w-12 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-400" style={{ boxShadow: "var(--mft-shadow-sm)" }}>
          <Svg d={icon} />
        </span>
      </div>
      <p className="text-sm font-semibold text-zinc-800">{title}</p>
      {description && <p className="mt-1 max-w-sm text-xs leading-relaxed text-zinc-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ title = "Something went wrong", description, onRetry }: { title?: string; description?: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600">
        <Svg d={STATE_ICONS.error} />
      </span>
      <p className="text-sm font-semibold text-zinc-800">{title}</p>
      {description && <p className="mt-1 max-w-sm text-xs text-zinc-500">{description}</p>}
      {onRetry && (
        <button type="button" onClick={onRetry} className="brutal-btn-outline mt-4 normal-case tracking-normal">
          Try again
        </button>
      )}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`mft-skeleton rounded-md ${className}`} />;
}

export function SkeletonRows({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="divide-y divide-zinc-100">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 px-4 py-3.5">
          <Skeleton className="h-8 w-8 rounded-full" />
          {Array.from({ length: cols }).map((__, c) => (
            <Skeleton key={c} className={`h-3 ${c === 0 ? "w-1/4" : "flex-1"}`} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Consistent page header used by the newer pages. */
export function PageHeader({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="mb-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-2xl font-bold tracking-tight text-zinc-900">{title}</h2>
          {description && <p className="mt-1 text-sm text-zinc-500">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

/** Sticky bulk-action bar shown when rows are selected. */
export function BulkBar({ count, onClear, children }: { count: number; onClear: () => void; children: ReactNode }) {
  if (count === 0) return null;
  return (
    <div className="fixed inset-x-0 bottom-6 z-[90] flex justify-center px-4 pointer-events-none">
      <div
        className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-2xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-white animate-slide-up"
        style={{ boxShadow: "0 20px 40px -12px rgba(0,0,0,0.45)" }}
      >
        <span className="flex items-center gap-2 pl-1 pr-2 text-[13px] font-medium">
          <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-red-600 px-1.5 text-[11px] font-bold">{count}</span>
          selected
        </span>
        <span className="h-5 w-px bg-zinc-700" />
        {children}
        <span className="h-5 w-px bg-zinc-700" />
        <button type="button" onClick={onClear} className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white cursor-pointer">
          Clear
        </button>
      </div>
    </div>
  );
}

export function BulkButton({
  onClick,
  children,
  tone = "default",
  disabled,
}: {
  onClick: () => void;
  children: ReactNode;
  tone?: "default" | "success" | "danger";
  disabled?: boolean;
}) {
  const t =
    tone === "danger"
      ? "text-red-300 hover:bg-red-600 hover:text-white"
      : tone === "success"
        ? "text-emerald-300 hover:bg-emerald-600 hover:text-white"
        : "text-zinc-100 hover:bg-zinc-800";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 ${t}`}
    >
      {children}
    </button>
  );
}
