export const STRAPI_CMS_ADMIN =
  process.env.NEXT_PUBLIC_STRAPICMS_ADMIN_URL ?? "http://localhost:1337/admin";

export type BadgeKey = "unreadChats" | "pendingWorkers" | "pendingExceptions" | "pendingApprovals" | "newSubmissions";

export interface NavItem {
  label: string;
  href: string;
  icon: string;
  description: string;
  badge?: BadgeKey;
  external?: boolean;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

export const ICONS = {
  overview: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6",
  projects: "M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z",
  tasks: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4",
  workers: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z",
  sessions: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
  hr: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4",
  exceptions: "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z",
  submissions: "M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4",
  cms: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z",
  reports: "M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
  activity: "M13 10V3L4 14h7v7l9-11h-7z",
};

export const NAV_GROUPS: NavGroup[] = [
  {
    title: "General",
    items: [
      { label: "Overview", href: "/admin", icon: ICONS.overview, description: "Company-wide snapshot of every module" },
      { label: "Reports", href: "/admin/reports", icon: ICONS.reports, description: "Hours, attendance, payroll & delivery reports" },
      { label: "Activity Log", href: "/admin/activity", icon: ICONS.activity, description: "Audit trail of every admin action" },
    ],
  },
  {
    title: "Work",
    items: [
      { label: "Projects", href: "/admin/projects", icon: ICONS.projects, description: "Client projects, boards & calendars", badge: "unreadChats" },
      { label: "Tasks", href: "/admin/tasks", icon: ICONS.tasks, description: "All task directives across projects", badge: "pendingApprovals" },
    ],
  },
  {
    title: "People",
    items: [
      { label: "Workers", href: "/admin/workers", icon: ICONS.workers, description: "Team roster, approvals & profiles", badge: "pendingWorkers" },
      { label: "Work Sessions", href: "/admin/work-sessions", icon: ICONS.sessions, description: "Attendance & logged hours" },
      { label: "HR Dashboard", href: "/admin/hr", icon: ICONS.hr, description: "Performance, penalties & alerts" },
      { label: "Exceptions", href: "/admin/exceptions", icon: ICONS.exceptions, description: "Late / absence requests", badge: "pendingExceptions" },
    ],
  },
  {
    title: "Clients",
    items: [
      { label: "Submissions", href: "/admin/submissions", icon: ICONS.submissions, description: "Inbound leads & meeting requests", badge: "newSubmissions" },
      { label: "Strapi CMS", href: STRAPI_CMS_ADMIN, icon: ICONS.cms, description: "Website content manager", external: true },
    ],
  },
];

export const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

export function findNavItem(pathname: string): NavItem | undefined {
  if (pathname === "/admin") return ALL_NAV_ITEMS[0];
  return ALL_NAV_ITEMS.filter((i) => !i.external && i.href !== "/admin" && pathname.startsWith(i.href))[0];
}

/** Deep links into pre-filtered views — used by KPIs, the bell, toasts and the command palette. */
export const FILTERED_LINKS: Record<BadgeKey, string> = {
  pendingApprovals: "/admin/tasks?status=pending-approval",
  pendingWorkers: "/admin/workers?status=pending",
  pendingExceptions: "/admin/exceptions?status=pending",
  newSubmissions: "/admin/submissions?status=new",
  unreadChats: "/admin/projects",
};

export const NAVIGATE_EVENT = "mft:navigate";

/**
 * Client-side navigation from non-React code (toasts, desktop notifications).
 * The admin layout listens for this event and routes with Next's router, so the
 * page doesn't do a full reload. Falls back to a hard navigation if nobody handles it.
 */
export function navigateTo(href: string) {
  if (typeof window === "undefined") return;
  const ev = new CustomEvent(NAVIGATE_EVENT, { detail: href, cancelable: true });
  const handled = !window.dispatchEvent(ev);
  if (!handled) window.location.assign(href);
}

