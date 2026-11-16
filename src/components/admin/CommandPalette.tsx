"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FILTERED_LINKS, ICONS, getNavItemsForRole, type AdminRole, type NavItem } from "@/lib/admin/nav";
import type { AdminBadges } from "@/lib/admin/useAdminBadges";
import type { ThemePref } from "@/lib/admin/theme";

interface Props {
  open: boolean;
  onClose: () => void;
  onNavigate: (href: string) => void;
  badges: AdminBadges;
  role: AdminRole;
  theme: ThemePref;
  onSetTheme: (t: ThemePref) => void;
  onSignOut: () => void;
  onToggleSidebar: () => void;
}

type Group = "Needs attention" | "Actions" | "Go to" | "Preferences";
const GROUP_ORDER: Group[] = ["Needs attention", "Actions", "Go to", "Preferences"];

interface Command {
  id: string;
  label: string;
  hint: string;
  icon: string;
  group: Group;
  count?: number;
  keywords?: string;
  run: () => void;
}

const SUN =
  "M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z";
const MOON =
  "M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z";
const MONITOR =
  "M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z";

export default function CommandPalette({
  open,
  onClose,
  onNavigate,
  badges,
  role,
  theme,
  onSetTheme,
  onSignOut,
  onToggleSidebar,
}: Props) {
  const [q, setQ] = useState("");
  const [groupFilter, setGroupFilter] = useState<"all" | Group>("all");
  const [active, setActive] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const commands: Command[] = useMemo(() => {
    const canOps = role === "super_admin" || role === "ops_admin";
    const canHr = role === "super_admin" || role === "hr_admin";
    const navItems = getNavItemsForRole(role);

    const nav = (href: string) => () => {
      onNavigate(href);
      onClose();
    };
    const go = (item: NavItem) => () => {
      if (item.external) window.open(item.href, "_blank", "noopener,noreferrer");
      else onNavigate(item.href);
      onClose();
    };
    const act = (fn: () => void) => () => {
      onClose();
      fn();
    };

    const attention: Command[] = [
      ...(canOps
        ? [
            {
              id: "att-approvals",
              label: "Review task approvals",
              hint: "Tasks submitted by workers",
              icon: "M5 13l4 4L19 7",
              count: badges.pendingApprovals,
              run: nav(FILTERED_LINKS.pendingApprovals),
            },
            {
              id: "att-subs",
              label: "Contact new leads",
              hint: "New client submissions",
              icon: ICONS.submissions,
              count: badges.newSubmissions,
              run: nav(FILTERED_LINKS.newSubmissions),
            },
            {
              id: "att-chats",
              label: "Read unread task messages",
              hint: "Project chats",
              icon: ICONS.projects,
              count: badges.unreadChats,
              run: nav(FILTERED_LINKS.unreadChats),
            },
          ]
        : []),
      ...(canHr
        ? [
            {
              id: "att-workers",
              label: "Approve new workers",
              hint: "Registrations awaiting approval",
              icon: ICONS.workers,
              count: badges.pendingWorkers,
              run: nav(FILTERED_LINKS.pendingWorkers),
            },
            {
              id: "att-exceptions",
              label: "Decide exception requests",
              hint: "Late arrival, absence & overtime",
              icon: ICONS.exceptions,
              count: badges.pendingExceptions,
              run: nav(FILTERED_LINKS.pendingExceptions),
            },
            {
              id: "att-reimb",
              label: "Review reimbursement claims",
              hint: "Outdoor missions & purchases",
              icon: ICONS.reimbursements,
              count: badges.pendingReimbursements,
              run: nav(FILTERED_LINKS.pendingReimbursements),
            },
          ]
        : []),
    ]
      .filter((c) => c.count > 0)
      .map((c) => ({ ...c, group: "Needs attention" as Group, keywords: "pending inbox todo" }));

    const actions: Command[] = [
      ...(canOps
        ? [
            {
              id: "new-project",
              group: "Actions" as Group,
              label: "Create new project",
              hint: "Projects → New project",
              icon: "M12 4v16m8-8H4",
              keywords: "add",
              run: nav("/admin/projects?new=1"),
            },
            {
              id: "open-client-studio",
              group: "Actions" as Group,
              label: "Open Client Rollout Studio",
              hint: "Manage 3-month social calendar, Kanban & stories",
              icon: ICONS.clientPortal,
              keywords: "arc client rollout social stories reels",
              run: nav("/admin/client-portal"),
            },
            {
              id: "preview-client-portal",
              group: "Actions" as Group,
              label: "Preview Client Portal (External View)",
              hint: "Opens /client in a new tab",
              icon: ICONS.clientPortal,
              keywords: "client view preview portal",
              run: act(() => window.open("/client", "_blank", "noopener,noreferrer")),
            },
            {
              id: "tasks-progress",
              group: "Actions" as Group,
              label: "View tasks in progress",
              hint: "Tasks → In progress",
              icon: ICONS.tasks,
              keywords: "active working",
              run: nav("/admin/tasks?status=in-progress"),
            },
          ]
        : []),
      ...(canHr
        ? [
            {
              id: "workers-online",
              group: "Actions" as Group,
              label: "Who's online now",
              hint: "Workers → Online only",
              icon: ICONS.workers,
              keywords: "active team",
              run: nav("/admin/workers?online=1"),
            },
            {
              id: "hr-payroll",
              group: "Actions" as Group,
              label: "Open Payroll & Payslips Sheet",
              hint: "HR Operations → Payroll tab",
              icon: ICONS.hr,
              keywords: "payroll salary bonus deduction",
              run: nav("/admin/hr?tab=payroll"),
            },
            {
              id: "reports",
              group: "Actions" as Group,
              label: "Export a report",
              hint: "Payroll, attendance & delivery (CSV/PDF)",
              icon: ICONS.reports,
              keywords: "csv pdf payroll",
              run: nav("/admin/reports"),
            },
          ]
        : []),
    ];

    return [
      ...attention,
      ...actions,
      ...navItems.map((i) => ({
        id: `nav-${i.href}`,
        group: "Go to" as Group,
        label: i.label,
        hint: i.description,
        icon: i.icon,
        count: i.badge ? badges[i.badge] : undefined,
        keywords: "page open navigate",
        run: go(i),
      })),
      ...(["light", "dark", "system"] as ThemePref[])
        .filter((t) => t !== theme)
        .map((t) => ({
          id: `theme-${t}`,
          group: "Preferences" as Group,
          label: t === "system" ? "Use system theme" : `Switch to ${t} mode`,
          hint: `Appearance · currently ${theme}`,
          icon: t === "light" ? SUN : t === "dark" ? MOON : MONITOR,
          keywords: "theme appearance dark light",
          run: act(() => onSetTheme(t)),
        })),
      {
        id: "sidebar",
        group: "Preferences",
        label: "Toggle sidebar",
        hint: "Collapse or expand navigation",
        icon: "M4 6h16M4 12h16M4 18h7",
        keywords: "collapse expand",
        run: act(onToggleSidebar),
      },
      {
        id: "sign-out",
        group: "Preferences",
        label: "Sign out",
        hint: "End your admin session",
        icon: "M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1",
        keywords: "logout log out",
        run: act(onSignOut),
      },
    ];
  }, [badges, role, theme, onNavigate, onClose, onSetTheme, onSignOut, onToggleSidebar]);

  const filtered = useMemo(() => {
    const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const byGroup = groupFilter === "all" ? commands : commands.filter((c) => c.group === groupFilter);
    const list = terms.length
      ? byGroup.filter((c) => {
          const hay = `${c.label} ${c.hint} ${c.group} ${c.keywords ?? ""}`.toLowerCase();
          return terms.every((t) => hay.includes(t));
        })
      : byGroup;
    return GROUP_ORDER.flatMap((g) => list.filter((c) => c.group === g));
  }, [q, groupFilter, commands]);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open) {
      if (!d.open) d.showModal();
      setTimeout(() => inputRef.current?.focus(), 10);
    } else if (d.open) {
      d.close();
    }
  }, [open]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (filtered.length ? (a + 1) % filtered.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (filtered.length ? (a - 1 + filtered.length) % filtered.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      filtered[active]?.run();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      aria-label="Command palette"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const rect = e.currentTarget.getBoundingClientRect();
          const inside =
            e.clientX >= rect.left &&
            e.clientX <= rect.right &&
            e.clientY >= rect.top &&
            e.clientY <= rect.bottom;
          if (!inside) onClose();
        }
      }}
      className="m-auto mt-[11vh] w-full max-w-xl overflow-hidden rounded-2xl border border-zinc-200 bg-white p-0 text-zinc-900 animate-scale-in"
      style={{ boxShadow: "var(--mft-shadow-lg)" }}
    >
      <div className="flex items-center gap-3 border-b border-zinc-200 px-4">
        <svg className="h-4 w-4 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          id="command-palette-input"
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKey}
          placeholder="Search pages, actions, settings…"
          className="h-13 flex-1 bg-transparent text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none"
          role="combobox"
          aria-expanded="true"
          aria-controls="command-palette-list"
          aria-activedescendant={filtered[active] ? `cmd-${filtered[active].id}` : undefined}
        />
        <button type="button" onClick={onClose} className="ui-kbd cursor-pointer hover:bg-zinc-100">
          ESC
        </button>
      </div>

      {/* Category Filter Tabs */}
      <div
        role="tablist"
        aria-label="Command categories"
        className="flex items-center gap-1 overflow-x-auto border-b border-zinc-100 bg-zinc-50/70 px-3 py-1.5"
      >
        {(["all", ...GROUP_ORDER] as const).map((g) => (
          <button
            key={g}
            type="button"
            role="tab"
            aria-selected={groupFilter === g}
            onClick={() => {
              setGroupFilter(g);
              setActive(0);
            }}
            className={`mft-tab-btn rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
              groupFilter === g ? "bg-white text-zinc-900 shadow-2xs" : "text-zinc-500 hover:text-zinc-800"
            }`}
          >
            {g === "all" ? "All" : g}
          </button>
        ))}
      </div>

      <ul id="command-palette-list" ref={listRef} role="listbox" className="max-h-[52vh] overflow-y-auto p-2">
        {filtered.length === 0 && (
          <li className="px-3 py-8 text-center text-sm text-zinc-400">No results for “{q}”</li>
        )}
        {filtered.map((c, i) => (
          <li key={c.id} role="presentation">
            {(i === 0 || filtered[i - 1].group !== c.group) && (
              <p
                className={`px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400 ${
                  i === 0 ? "pt-1" : "pt-3"
                }`}
              >
                {c.group}
              </p>
            )}
            <button
              id={`cmd-${c.id}`}
              type="button"
              role="option"
              aria-selected={i === active}
              data-idx={i}
              onMouseEnter={() => setActive(i)}
              onClick={c.run}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors cursor-pointer ${
                i === active ? "bg-red-50 text-red-700" : "text-zinc-700 hover:bg-zinc-50"
              }`}
            >
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                  i === active ? "bg-red-100" : "bg-zinc-100"
                }`}
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={c.icon} />
                </svg>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{c.label}</span>
                <span className="block truncate text-xs text-zinc-500">{c.hint}</span>
              </span>
              {!!c.count && c.count > 0 && (
                <span className="rounded-full bg-zinc-900 px-2 py-0.5 font-code text-[10px] font-bold text-white">
                  {c.count > 99 ? "99+" : c.count}
                </span>
              )}
              {i === active && <span className="ui-kbd">↵</span>}
            </button>
          </li>
        ))}
      </ul>

      <div className="flex items-center gap-4 border-t border-zinc-100 bg-zinc-50 px-4 py-2 text-[11px] text-zinc-500">
        <span>
          <span className="ui-kbd">↑</span> <span className="ui-kbd">↓</span> navigate
        </span>
        <span>
          <span className="ui-kbd">↵</span> execute
        </span>
        <span className="ml-auto">
          <span className="ui-kbd">Ctrl K</span> toggle
        </span>
      </div>
    </dialog>
  );
}
