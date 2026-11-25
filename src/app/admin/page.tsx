"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { FILTERED_LINKS, ICONS, STRAPI_CMS_ADMIN } from "@/lib/admin/nav";
import { effectiveSessionWorkMs, type SessionLike } from "@/lib/admin/workTime";
import { cairoYmd } from "@/lib/admin/cairoTime";
import { DEFAULT_HR_SETTINGS, formatDepartment, isLateTodayHtml, type HrSettings } from "@/lib/admin/hrReports";
import { subscribeHrSettings } from "@/lib/admin/hrSettings";
import { subscribeClientPortals } from "@/lib/admin/clientPortalStore";
import { ARC_DEFAULT_PORTAL, type ClientRolloutPortal } from "@/lib/admin/clientPortalTypes";
import { CellColumnTrend } from "@/components/admin/ui/CellColumnTrend";
import {
  AttendanceHeatmap,
  ChartCard,
  ConcentricRingsChart,
  DonutBreakdownChart,
  InteractiveAreaChart,
  InteractiveBarChart,
  KpiStatCard,
  type KpiTone,
} from "@/components/admin/ui/Charts";

/* ───────────────────────── Types ───────────────────────── */
type TS = { toDate?: () => Date } | Date | string | null | undefined;

interface Worker {
  id: string;
  firstName?: string;
  lastName?: string;
  status?: string;
  isOnline?: boolean;
  role?: string;
  department?: string;
}
interface Project {
  id: string;
  name: string;
  clientName?: string;
  status?: string;
  createdAt?: TS;
}
interface Task {
  id: string;
  title: string;
  status: string;
  priority?: string;
  projectId?: string;
  dueDate?: TS;
  createdAt?: TS;
  updatedAt?: TS;
  assignedTo?: string | string[];
}
interface Session extends SessionLike {
  id: string;
  isLate?: boolean;
  department?: string;
  presenceStatus?: "active" | "idle" | "offline";
}
interface ExceptionReq {
  id: string;
  workerName?: string;
  type?: string;
  status?: string;
  createdAt?: TS;
  submittedAt?: TS;
}
interface Submission {
  id: string;
  fullName?: string;
  company?: string;
  status?: string;
  submittedAt?: TS;
  timestamp?: TS;
  services?: string[];
}

/* ───────────────────────── Helpers ───────────────────────── */
function toDate(v: TS): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === "string") {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof v.toDate === "function") return v.toDate();
  return null;
}

const ymd = (d: Date) => cairoYmd(d);

const hours = (ms: number) => Math.round((ms / 3_600_000) * 10) / 10;

function timeAgo(d: Date | null) {
  if (!d) return "";
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function useCollection<T>(name: string) {
  const [items, setItems] = useState<T[]>([]);
  const [ready, setReady] = useState(false);
  useEffect(
    () =>
      onSnapshot(
        collection(db, name),
        (snap) => {
          setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T));
          setReady(true);
        },
        () => setReady(true),
      ),
    [name],
  );
  return [items, ready] as const;
}

function Icon({ d, className = "h-5 w-5" }: { d: string; className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

const TONES: Record<KpiTone, { bg: string; fg: string; bar: string }> = {
  red: { bg: "bg-red-50", fg: "text-red-600", bar: "bg-red-500" },
  blue: { bg: "bg-blue-50", fg: "text-blue-600", bar: "bg-blue-500" },
  amber: { bg: "bg-amber-50", fg: "text-amber-600", bar: "bg-amber-500" },
  emerald: { bg: "bg-emerald-50", fg: "text-emerald-600", bar: "bg-emerald-500" },
  violet: { bg: "bg-violet-50", fg: "text-violet-600", bar: "bg-violet-500" },
  zinc: { bg: "bg-zinc-100", fg: "text-zinc-700", bar: "bg-zinc-500" },
  orange: { bg: "bg-orange-50", fg: "text-orange-600", bar: "bg-orange-500" },
  sky: { bg: "bg-sky-50", fg: "text-sky-600", bar: "bg-sky-500" },
};

function SectionHeader({
  title,
  subtitle,
  href,
  cta,
}: {
  title: string;
  subtitle?: string;
  href?: string;
  cta?: string;
}) {
  return (
    <div className="mb-4 flex items-end justify-between gap-3">
      <div>
        <h2 className="text-[15px] font-semibold tracking-tight text-zinc-900">{title}</h2>
        {subtitle && <p className="text-xs text-zinc-500">{subtitle}</p>}
      </div>
      {href && (
        <Link href={href} className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 hover:text-red-700">
          {cta ?? "View all"}
          <Icon d="M9 5l7 7-7 7" className="h-3.5 w-3.5" />
        </Link>
      )}
    </div>
  );
}

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`mft-skeleton rounded-xl ${className}`} />;
}

const DEPT_PALETTE = ["#dc2626", "#2563eb", "#059669", "#d97706", "#7c3aed", "#0284c7"];

/* ───────────────────────── Page ───────────────────────── */
export default function AdminOverviewPage() {
  const [workers, wReady] = useCollection<Worker>("workers");
  const [projects, pReady] = useCollection<Project>("projects");
  const [tasks, tReady] = useCollection<Task>("tasks");
  const [sessions] = useCollection<Session>("workSessions");
  const [exceptions] = useCollection<ExceptionReq>("exceptionRequests");
  const [submissions] = useCollection<Submission>("submissions");
  const [hrSettings, setHrSettings] = useState<HrSettings>(DEFAULT_HR_SETTINGS);
  const [portalData, setPortalData] = useState<ClientRolloutPortal>(ARC_DEFAULT_PORTAL);

  useEffect(() => subscribeHrSettings(setHrSettings), []);

  useEffect(() => {
    const unsub = subscribeClientPortals((portalsMap) => {
      const first = portalsMap[ARC_DEFAULT_PORTAL.id] ?? Object.values(portalsMap)[0] ?? ARC_DEFAULT_PORTAL;
      setPortalData(first);
    });
    return () => unsub();
  }, []);

  const ready = wReady && pReady && tReady;

  const [now, setNow] = useState(() => new Date());
  const [chartDays, setChartDays] = useState<7 | 14 | 28>(14);
  const [chartMode, setChartMode] = useState<"matrix" | "area" | "bar" | "heatmap">("matrix");

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const s = useMemo(() => {
    const today = ymd(now);
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const approvedWorkers = workers.filter((w) => w.status === "approved");
    const pendingWorkers = workers.filter((w) => w.status === "pending");
    const workerMap = new Map(workers.map((w) => [w.id, w]));

    const pendingApproval = tasks.filter((t) => t.status === "pending-approval");
    const openTasks = tasks.filter((t) => t.status !== "completed");
    const completedTasks = tasks.filter((t) => t.status === "completed");
    const overdue = openTasks.filter((t) => {
      const d = toDate(t.dueDate);
      return d && d < startOfToday;
    });
    const dueToday = openTasks.filter((t) => {
      const d = toDate(t.dueDate);
      return d && ymd(d) === today;
    });

    const activeProjects = projects.filter((p) => (p.status || "active") === "active");
    const completedProjects = projects.filter((p) => p.status === "completed");

    const stdHours = hrSettings.standardHours || 8;
    const isSessionLate = (x: Session) =>
      x.startTime || x.loginTime ? isLateTodayHtml(x, hrSettings) : Boolean(x.isLate);

    const todaySessions = sessions.filter((x) => x.date === today);
    const todayMs = todaySessions.reduce(
      (a, x) => a + effectiveSessionWorkMs(x, now.getTime(), { standardHours: stdHours }),
      0,
    );
    const lateToday = todaySessions.filter((x) => !x.isExternalMission && isSessionLate(x)).length;
    const activeSessions = todaySessions.filter((x) => x.isActive);
    const idleSessions = activeSessions.filter((x) => x.presenceStatus === "idle");
    const activeTodayWorkerIds = new Set(activeSessions.map((x) => x.workerId).filter(Boolean));
    const onlineWorkers = workers.filter((w) => activeTodayWorkerIds.has(w.id));

    // Build 28-day daily series for charts, sparklines & week-over-week deltas
    const days28: {
      label: string;
      shortDay: string;
      date: string;
      totalH: number;
      regularH: number;
      overtimeH: number;
      sessions: number;
      late: number;
      tasksDone: number;
    }[] = [];

    for (let i = 27; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const key = ymd(d);
      const daySessions = sessions.filter((x) => x.date === key);
      let dayTotalH = 0;
      let dayOtH = 0;
      let dayLate = 0;
      for (const sess of daySessions) {
        const h = hours(
          effectiveSessionWorkMs(sess, key === today ? now.getTime() : undefined, { standardHours: stdHours }),
        );
        dayTotalH += h;
        dayOtH += Math.max(0, h - stdHours);
        if (!sess.isExternalMission && isSessionLate(sess)) dayLate++;
      }
      const dayTasksDone = completedTasks.filter((t) => {
        const td = toDate(t.updatedAt) || toDate(t.createdAt);
        return td && ymd(td) === key;
      }).length;

      days28.push({
        label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        shortDay: d.toLocaleDateString(undefined, { weekday: "short" }),
        date: key,
        totalH: Math.round(dayTotalH * 10) / 10,
        regularH: Math.round(Math.max(0, dayTotalH - dayOtH) * 10) / 10,
        overtimeH: Math.round(dayOtH * 10) / 10,
        sessions: daySessions.length,
        late: dayLate,
        tasksDone: dayTasksDone,
      });
    }

    const last7 = days28.slice(-7);
    const prev7 = days28.slice(-14, -7);
    const weekTotal = Math.round(last7.reduce((a, d) => a + d.totalH, 0) * 10) / 10;
    const prevWeekTotal = Math.round(prev7.reduce((a, d) => a + d.totalH, 0) * 10) / 10;
    const hoursDelta = prevWeekTotal > 0 ? (weekTotal - prevWeekTotal) / prevWeekTotal : null;

    const tasksDone7 = last7.reduce((a, d) => a + d.tasksDone, 0);
    const tasksDonePrev7 = prev7.reduce((a, d) => a + d.tasksDone, 0);
    const tasksDelta = tasksDonePrev7 > 0 ? (tasksDone7 - tasksDonePrev7) / tasksDonePrev7 : null;

    const pendingExceptions = exceptions.filter((e) => e.status === "pending");
    const newSubs = submissions.filter((x) => !x.status || x.status === "new");

    const statusDist = [
      { key: "assigned", label: "To do", color: "#2563eb", value: tasks.filter((t) => t.status === "assigned").length },
      { key: "in-progress", label: "In progress", color: "#d97706", value: tasks.filter((t) => t.status === "in-progress").length },
      { key: "pending-approval", label: "In review", color: "#ea580c", value: pendingApproval.length },
      { key: "completed", label: "Completed", color: "#059669", value: completedTasks.length },
    ];

    // Department hours breakdown (last 28 days)
    const deptMap = new Map<string, number>();
    const cutoff28 = days28[0]?.date ?? "";
    for (const sess of sessions) {
      if ((sess.date ?? "") < cutoff28) continue;
      const dept = sess.department || workerMap.get(sess.workerId ?? "")?.department || "general";
      const h = hours(
        effectiveSessionWorkMs(sess, sess.date === today ? now.getTime() : undefined, { standardHours: stdHours }),
      );
      deptMap.set(dept, (deptMap.get(dept) ?? 0) + h);
    }
    const deptSlices = Array.from(deptMap.entries())
      .map(([k, v], i) => ({
        key: k,
        label: formatDepartment(k),
        value: Math.round(v * 10) / 10,
        color: DEPT_PALETTE[i % DEPT_PALETTE.length],
      }))
      .filter((x) => x.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);

    const projectRows = activeProjects
      .map((p) => {
        const pt = tasks.filter((t) => t.projectId === p.id);
        const done = pt.filter((t) => t.status === "completed").length;
        const review = pt.filter((t) => t.status === "pending-approval").length;
        const overdueCount = pt.filter((t) => {
          if (t.status === "completed") return false;
          const d = toDate(t.dueDate);
          return d && d < startOfToday;
        }).length;
        return {
          ...p,
          total: pt.length,
          done,
          review,
          overdueCount,
          pct: pt.length ? Math.round((done / pt.length) * 100) : 0,
        };
      })
      .sort((a, b) => b.review - a.review || b.total - a.total)
      .slice(0, 6);

    // Activity feed
    type Act = { id: string; at: Date; title: string; meta: string; href: string; tone: KpiTone; icon: string };
    const acts: Act[] = [];
    tasks.forEach((t) => {
      const at = toDate(t.updatedAt) || toDate(t.createdAt);
      if (!at) return;
      const verb =
        t.status === "completed"
          ? "completed"
          : t.status === "pending-approval"
            ? "submitted for review"
            : toDate(t.updatedAt)
              ? "updated"
              : "created";
      acts.push({
        id: "t" + t.id,
        at,
        title: t.title,
        meta: `Task ${verb}`,
        href: "/admin/tasks",
        tone: t.status === "completed" ? "emerald" : t.status === "pending-approval" ? "amber" : "blue",
        icon: ICONS.tasks,
      });
    });
    submissions.forEach((x) => {
      const at = toDate(x.submittedAt) || toDate(x.timestamp);
      if (!at) return;
      acts.push({
        id: "s" + x.id,
        at,
        title: x.fullName || "New lead",
        meta: `Submission${x.company ? ` · ${x.company}` : ""}`,
        href: "/admin/submissions",
        tone: "violet",
        icon: ICONS.submissions,
      });
    });
    exceptions.forEach((e) => {
      const at = toDate(e.createdAt) || toDate(e.submittedAt);
      if (!at) return;
      acts.push({
        id: "e" + e.id,
        at,
        title: e.workerName || "Worker",
        meta: `${e.type === "late" ? "Late arrival" : e.type === "absent" ? "Absence" : "Exception"} request · ${e.status || "pending"}`,
        href: "/admin/exceptions",
        tone: "orange",
        icon: ICONS.exceptions,
      });
    });
    acts.sort((a, b) => b.at.getTime() - a.at.getTime());

    return {
      approvedWorkers,
      pendingWorkers,
      onlineWorkers,
      idleSessions,
      pendingApproval,
      openTasks,
      completedTasks,
      overdue,
      dueToday,
      activeProjects,
      completedProjects,
      todayMs,
      lateToday,
      activeSessions,
      days28,
      last7,
      weekTotal,
      hoursDelta,
      tasksDelta,
      pendingExceptions,
      newSubs,
      statusDist,
      deptSlices,
      projectRows,
      activity: acts.slice(0, 8),
      todaySessions,
    };
  }, [workers, projects, tasks, sessions, exceptions, submissions, now, hrSettings]);

  // Client Rollout Portal live metrics
  const portalStats = useMemo(() => {
    const posts = portalData.feedCalendar ?? [];
    const stories = portalData.dailyStories ?? [];
    const milestones = portalData.milestones ?? [];
    const approvedPosts = posts.filter(
      (p) => p.publishStatus === "Approved" || p.publishStatus === "Published" || p.publishStatus === "Scheduled",
    ).length;
    const readyPosts = posts.filter((p) => p.publishStatus === "Ready for Review").length;
    const revisionPosts = posts.filter((p) => p.publishStatus === "Revision Requested").length;
    const approvedStories = stories.filter(
      (st) => st.publishStatus === "Approved" || st.publishStatus === "Published" || st.publishStatus === "Scheduled",
    ).length;
    const pendingMilestones = milestones.filter(
      (m) => (m.status === "Waiting Client" || m.owner.includes("ARC")) && !m.clientApproved && m.status !== "Done",
    ).length;
    return {
      totalPosts: posts.length,
      approvedPosts,
      readyPosts,
      revisionPosts,
      totalStories: stories.length,
      approvedStories,
      pendingMilestones,
      pct: posts.length ? Math.round((approvedPosts / posts.length) * 100) : 0,
    };
  }, [portalData]);

  const chartSlice = useMemo(() => s.days28.slice(-chartDays), [s.days28, chartDays]);
  const chartAvgHours = useMemo(() => {
    if (!chartSlice.length) return 0;
    return Math.round((chartSlice.reduce((a, d) => a + d.totalH, 0) / chartSlice.length) * 10) / 10;
  }, [chartSlice]);

  const greeting =
    now.getHours() < 12 ? "Good morning" : now.getHours() < 18 ? "Good afternoon" : "Good evening";
  const attentionCount =
    s.pendingApproval.length +
    s.pendingWorkers.length +
    s.pendingExceptions.length +
    s.overdue.length +
    s.newSubs.length +
    portalStats.revisionPosts;

  const attention = [
    {
      n: s.pendingApproval.length,
      label: "tasks waiting for your approval",
      href: FILTERED_LINKS.pendingApprovals,
      tone: "amber" as KpiTone,
      icon: "M5 13l4 4L19 7",
      cta: "Review",
    },
    {
      n: s.overdue.length,
      label: "overdue task directives",
      href: "/admin/tasks",
      tone: "red" as KpiTone,
      icon: ICONS.sessions,
      cta: "Inspect",
    },
    {
      n: portalStats.revisionPosts,
      label: "client rollout posts with requested edits",
      href: "/admin/client-portal",
      tone: "orange" as KpiTone,
      icon: ICONS.clientPortal,
      cta: "Studio",
    },
    {
      n: s.pendingWorkers.length,
      label: "new workers awaiting account approval",
      href: FILTERED_LINKS.pendingWorkers,
      tone: "blue" as KpiTone,
      icon: ICONS.workers,
      cta: "Approve",
    },
    {
      n: s.pendingExceptions.length,
      label: "HR exception requests pending decision",
      href: FILTERED_LINKS.pendingExceptions,
      tone: "violet" as KpiTone,
      icon: ICONS.exceptions,
      cta: "Decide",
    },
    {
      n: s.newSubs.length,
      label: "new inbound client submissions",
      href: FILTERED_LINKS.newSubmissions,
      tone: "emerald" as KpiTone,
      icon: ICONS.submissions,
      cta: "Contact",
    },
  ].filter((a) => a.n > 0);

  const modules = [
    {
      title: "Projects",
      href: "/admin/projects",
      icon: ICONS.projects,
      tone: "red" as KpiTone,
      desc: "Client boards, lists, group chat & calendars",
      stats: [
        ["Active", s.activeProjects.length],
        ["Completed", s.completedProjects.length],
        ["Total", projects.length],
      ],
    },
    {
      title: "Tasks",
      href: "/admin/tasks",
      icon: ICONS.tasks,
      tone: "blue" as KpiTone,
      desc: "All directives, reviews & deadlines",
      stats: [
        ["Open", s.openTasks.length],
        ["In review", s.pendingApproval.length],
        ["Done", s.completedTasks.length],
      ],
    },
    {
      title: "Client Rollout Studio",
      href: "/admin/client-portal",
      icon: ICONS.clientPortal,
      tone: "emerald" as KpiTone,
      desc: "3-month social media rollout, Kanban & story decks",
      stats: [
        ["Posts", `${portalStats.approvedPosts}/${portalStats.totalPosts}`],
        ["In review", portalStats.readyPosts],
        ["Stories", portalStats.totalStories],
      ],
    },
    {
      title: "HR Operations",
      href: "/admin/hr",
      icon: ICONS.hr,
      tone: "violet" as KpiTone,
      desc: "Attendance, payroll cycles, payslips & penalties",
      stats: [
        ["Late today", s.lateToday],
        ["Sessions", s.todaySessions.length],
        ["Roster", s.approvedWorkers.length],
      ],
    },
    {
      title: "Workers",
      href: "/admin/workers",
      icon: ICONS.workers,
      tone: "sky" as KpiTone,
      desc: "Team roster, onboarding approvals & rates",
      stats: [
        ["Approved", s.approvedWorkers.length],
        ["Pending", s.pendingWorkers.length],
        ["Online", s.onlineWorkers.length],
      ],
    },
    {
      title: "Work Sessions",
      href: "/admin/work-sessions",
      icon: ICONS.sessions,
      tone: "amber" as KpiTone,
      desc: "Live shift timers, check-ins & presence logs",
      stats: [
        ["Today", `${hours(s.todayMs)}h`],
        ["Active", s.activeSessions.length],
        ["7 days", `${s.weekTotal}h`],
      ],
    },
    {
      title: "Reports & Analytics",
      href: "/admin/reports",
      icon: ICONS.reports,
      tone: "blue" as KpiTone,
      desc: "Payroll, attendance & delivery exports (CSV/PDF)",
      stats: [
        ["7d hours", `${s.weekTotal}h`],
        ["Done tasks", s.completedTasks.length],
        ["Team", s.approvedWorkers.length],
      ],
    },
    {
      title: "Exceptions",
      href: "/admin/exceptions",
      icon: ICONS.exceptions,
      tone: "orange" as KpiTone,
      desc: "Late arrival, absence & leave requests",
      stats: [
        ["Pending", s.pendingExceptions.length],
        ["Approved", exceptions.filter((e) => e.status === "approved").length],
        ["Total", exceptions.length],
      ],
    },
    {
      title: "Reimbursements",
      href: "/admin/reimbursements",
      icon: ICONS.reimbursements,
      tone: "emerald" as KpiTone,
      desc: "Outdoor missions & purchase expense claims",
      stats: [
        ["Policy", "2026"],
        ["Team", s.approvedWorkers.length],
        ["Status", "Live"],
      ],
    },
    {
      title: "Submissions",
      href: "/admin/submissions",
      icon: ICONS.submissions,
      tone: "violet" as KpiTone,
      desc: "Inbound client leads & discovery requests",
      stats: [
        ["New", s.newSubs.length],
        ["Total", submissions.length],
        ["Closed", submissions.filter((x) => x.status === "completed").length],
      ],
    },
    {
      title: "Activity Audit Log",
      href: "/admin/activity",
      icon: ICONS.activity,
      tone: "zinc" as KpiTone,
      desc: "Chronological audit trail of admin actions",
      stats: [],
    },
    {
      title: "Strapi CMS",
      href: STRAPI_CMS_ADMIN,
      icon: ICONS.cms,
      tone: "zinc" as KpiTone,
      desc: "External website content management",
      stats: [],
      external: true,
    },
  ];

  const workerName = (id: string) => {
    const w = workers.find((x) => x.id === id);
    return w ? `${w.firstName ?? ""} ${w.lastName ?? ""}`.trim() : "";
  };

  return (
    <div className="space-y-6">
      {/* ── Executive Command Hero ── */}
      <section
        className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950 p-6 text-white md:p-7"
        style={{ boxShadow: "var(--mft-shadow-lg)" }}
      >
        <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-red-600/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-28 left-1/3 h-64 w-64 rounded-full bg-blue-500/10 blur-3xl" />

        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 font-code text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                Live Telemetry
              </span>
              <span className="font-code text-xs text-zinc-400">
                {now.toLocaleDateString(undefined, {
                  weekday: "long",
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </span>
            </div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight md:text-3xl">{greeting}</h1>
            <p className="mt-1.5 max-w-xl text-sm text-zinc-300">
              {attentionCount > 0 ? (
                <>
                  There {attentionCount === 1 ? "is" : "are"}{" "}
                  <span className="font-semibold text-white">
                    {attentionCount} priority item{attentionCount === 1 ? "" : "s"}
                  </span>{" "}
                  awaiting review across tasks, HR operations, and the client rollout studio.
                </>
              ) : (
                <>All workspace queues are clear — zero overdue directives or pending approvals.</>
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/admin/projects?new=1"
              className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-xs font-semibold text-white shadow-lg shadow-red-950/50 transition-all hover:bg-red-500 active:scale-[0.99]"
            >
              <Icon d="M12 4v16m8-8H4" className="h-4 w-4" /> New Project
            </Link>
            <Link
              href="/admin/client-portal"
              className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-3.5 py-2.5 text-xs font-semibold text-white ring-1 ring-white/15 backdrop-blur transition-all hover:bg-white/15"
            >
              <Icon d={ICONS.clientPortal} className="h-4 w-4 text-red-400" /> Client Studio
            </Link>
            <Link
              href="/admin/hr"
              className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-3.5 py-2.5 text-xs font-semibold text-white ring-1 ring-white/15 backdrop-blur transition-all hover:bg-white/15"
            >
              <Icon d={ICONS.hr} className="h-4 w-4 text-emerald-400" /> HR &amp; Payroll
            </Link>
            <Link
              href="/admin/reports"
              className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-3.5 py-2.5 text-xs font-semibold text-white ring-1 ring-white/15 backdrop-blur transition-all hover:bg-white/15"
            >
              <Icon d={ICONS.reports} className="h-4 w-4 text-sky-400" /> Analytics
            </Link>
          </div>
        </div>

        {/* Live Telemetry Strip */}
        <div className="relative mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            {
              label: "Workforce Online",
              val: `${s.onlineWorkers.length} / ${s.approvedWorkers.length}`,
              sub: `${s.activeSessions.length - s.idleSessions.length} active · ${s.idleSessions.length} idle`,
              dot: "bg-emerald-400",
            },
            {
              label: "Hours Logged Today",
              val: `${hours(s.todayMs)}h`,
              sub: `7-day total: ${s.weekTotal}h`,
              dot: "bg-sky-400",
            },
            {
              label: "Task Completion",
              val: `${tasks.length ? Math.round((s.completedTasks.length / tasks.length) * 100) : 0}%`,
              sub: `${s.dueToday.length} due today · ${s.pendingApproval.length} in review`,
              dot: "bg-amber-400",
            },
            {
              label: "Client Rollout Sign-Off",
              val: `${portalStats.pct}%`,
              sub: `${portalStats.approvedPosts}/${portalStats.totalPosts} posts · ${portalStats.readyPosts} in review`,
              dot: "bg-red-400",
            },
          ].map((item) => (
            <div
              key={item.label}
              className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 backdrop-blur-xs"
            >
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-400">
                <span className={`h-1.5 w-1.5 rounded-full ${item.dot}`} />
                {item.label}
              </div>
              <p className="mt-1 font-code text-xl font-bold tracking-tight tabular-nums text-white">
                {ready ? item.val : "—"}
              </p>
              <p className="mt-0.5 truncate text-[11px] text-zinc-400">{item.sub}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── 8 KPI Stat Cards with Sparklines & Directional Deltas ── */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {!ready ? (
          Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-[136px]" />)
        ) : (
          <>
            <KpiStatCard
              label="Logged Hours (7d)"
              value={`${s.weekTotal}h`}
              sub={`${hours(s.todayMs)}h logged today`}
              icon={ICONS.sessions}
              tone="red"
              href="/admin/work-sessions"
              delta={s.hoursDelta}
              good="up"
              period="vs prior 7d"
              trend={s.last7.map((d) => d.totalH)}
            />
            <KpiStatCard
              label="Open Directives"
              value={s.openTasks.length}
              sub={`${s.dueToday.length} due today · ${s.completedTasks.length} done`}
              icon={ICONS.tasks}
              tone="blue"
              href="/admin/tasks"
              delta={s.tasksDelta}
              good="up"
              period="velocity vs 7d"
              trend={s.last7.map((d) => d.tasksDone)}
            />
            <KpiStatCard
              label="Awaiting Approval"
              value={s.pendingApproval.length}
              sub="Submitted by team for review"
              icon="M5 13l4 4L19 7"
              tone="amber"
              href={FILTERED_LINKS.pendingApprovals}
              alert={s.pendingApproval.length > 0}
            />
            <KpiStatCard
              label="Overdue Directives"
              value={s.overdue.length}
              sub={s.overdue.length > 0 ? "Requires immediate follow-up" : "All tasks on schedule"}
              icon={ICONS.exceptions}
              tone="orange"
              href="/admin/tasks"
              good="down"
              alert={s.overdue.length > 0}
            />
            <KpiStatCard
              label="Active Projects"
              value={s.activeProjects.length}
              sub={`${s.completedProjects.length} completed · ${projects.length} total`}
              icon={ICONS.projects}
              tone="emerald"
              href="/admin/projects"
            />
            <KpiStatCard
              label="Client Rollout Studio"
              value={`${portalStats.approvedPosts}/${portalStats.totalPosts}`}
              sub={`${portalStats.readyPosts} awaiting client · ${portalStats.approvedStories} stories`}
              icon={ICONS.clientPortal}
              tone="violet"
              href="/admin/client-portal"
              alert={portalStats.revisionPosts > 0}
            />
            <KpiStatCard
              label="Team Roster & Presence"
              value={s.approvedWorkers.length}
              sub={`${s.onlineWorkers.length} online now · ${s.pendingWorkers.length} pending`}
              icon={ICONS.workers}
              tone="sky"
              href={s.pendingWorkers.length > 0 ? FILTERED_LINKS.pendingWorkers : "/admin/workers"}
              alert={s.pendingWorkers.length > 0}
              trend={s.last7.map((d) => d.sessions)}
            />
            <KpiStatCard
              label="HR Exceptions & Leads"
              value={s.pendingExceptions.length + s.newSubs.length}
              sub={`${s.pendingExceptions.length} HR requests · ${s.newSubs.length} new leads`}
              icon={ICONS.hr}
              tone="zinc"
              href={s.pendingExceptions.length > 0 ? FILTERED_LINKS.pendingExceptions : "/admin/hr"}
              alert={s.pendingExceptions.length + s.newSubs.length > 0}
            />
          </>
        )}
      </section>

      {/* ── Analytics Workbench + Priority Action Inbox ── */}
      <section className="grid gap-6 xl:grid-cols-3">
        <ChartCard
          title="Workforce & Output Telemetry"
          subtitle={`${chartSlice.reduce((a, d) => Math.round((a + d.totalH) * 10) / 10, 0)}h logged across ${chartDays} days · Daily avg ${chartAvgHours}h`}
          className="xl:col-span-2"
          noPadding={chartMode === "matrix"}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {/* View mode tablist */}
              <div
                role="tablist"
                aria-label="Chart visualization mode"
                className="flex items-center overflow-x-auto rounded-lg border border-zinc-200 bg-zinc-50 p-0.5"
              >
                {(
                  [
                    ["matrix", "Cell Matrix"],
                    ["area", "Area Spline"],
                    ["bar", "Stacked Bar"],
                    ["heatmap", "28d Grid"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={chartMode === key}
                    onClick={(e) => {
                      setChartMode(key);
                      e.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" });
                    }}
                    className={`mft-tab-btn rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                      chartMode === key ? "bg-white text-zinc-900 shadow-2xs" : "text-zinc-500 hover:text-zinc-800"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Range selector */}
              {chartMode !== "heatmap" && (
                <div className="flex items-center rounded-lg border border-zinc-200 bg-zinc-50 p-0.5">
                  {([7, 14, 28] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setChartDays(d)}
                      className={`rounded-md px-2 py-1 font-code text-[11px] font-semibold transition-colors cursor-pointer ${
                        chartDays === d ? "bg-white text-zinc-900 shadow-2xs" : "text-zinc-500 hover:text-zinc-800"
                      }`}
                    >
                      {d}d
                    </button>
                  ))}
                </div>
              )}
            </div>
          }
          footer={
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                Overtime logged in window:{" "}
                <strong className="font-code font-semibold text-zinc-800">
                  {Math.round(chartSlice.reduce((a, d) => a + d.overtimeH, 0) * 10) / 10}h
                </strong>
              </span>
              <Link href="/admin/reports" className="font-semibold text-red-600 hover:text-red-700">
                Open full payroll &amp; attendance reports →
              </Link>
            </div>
          }
        >
          {chartMode === "matrix" ? (
            <CellColumnTrend
              labels={chartSlice.map((d) => d.label)}
              metrics={[
                {
                  key: "hours",
                  label: "Logged Hours",
                  values: chartSlice.map((d) => d.totalH),
                  summary: `${Math.round(chartSlice.reduce((a, d) => a + d.totalH, 0) * 10) / 10}h`,
                  delta: s.hoursDelta,
                  deltaLabel: `avg ${chartAvgHours}h/day`,
                  higherIsBetter: true,
                  accent: "#dc2626",
                  format: (v) => `${v}h`,
                  icon: ICONS.sessions,
                },
                {
                  key: "tasks",
                  label: "Tasks Completed",
                  values: chartSlice.map((d) => d.tasksDone),
                  summary: `${chartSlice.reduce((a, d) => a + d.tasksDone, 0)}`,
                  delta: s.tasksDelta,
                  deltaLabel: `${s.openTasks.length} open now`,
                  higherIsBetter: true,
                  accent: "#2563eb",
                  format: (v) => `${Math.round(v)}`,
                  icon: ICONS.tasks,
                },
                {
                  key: "sessions",
                  label: "Shift Sessions",
                  values: chartSlice.map((d) => d.sessions),
                  summary: `${chartSlice.reduce((a, d) => a + d.sessions, 0)}`,
                  deltaLabel: `${s.onlineWorkers.length} online today`,
                  higherIsBetter: true,
                  accent: "#059669",
                  format: (v) => `${Math.round(v)}`,
                  icon: ICONS.workers,
                },
                {
                  key: "late",
                  label: "Late Arrivals",
                  values: chartSlice.map((d) => d.late),
                  summary: `${chartSlice.reduce((a, d) => a + d.late, 0)}`,
                  deltaLabel: "clock-in > 11:00",
                  higherIsBetter: false,
                  accent: "#d97706",
                  format: (v) => `${Math.round(v)}`,
                  icon: ICONS.exceptions,
                },
              ]}
            />
          ) : chartMode === "area" ? (
            <InteractiveAreaChart
              data={chartSlice}
              xKey="label"
              height={235}
              format={(v) => `${v}h`}
              referenceValue={chartAvgHours}
              referenceLabel="Daily avg"
              description={`Logged hours and overtime over the last ${chartDays} days`}
              series={[
                { key: "totalH", label: "Total Hours", color: "#dc2626", fillOpacity: 0.22 },
                { key: "overtimeH", label: "Overtime Hours", color: "#f59e0b", fillOpacity: 0.14 },
              ]}
            />
          ) : chartMode === "bar" ? (
            <InteractiveBarChart
              data={chartSlice}
              xKey="label"
              height={235}
              stacked
              format={(v) => `${v}h`}
              referenceValue={chartAvgHours}
              referenceLabel="Daily avg"
              description={`Regular and overtime hours stacked bar chart over the last ${chartDays} days`}
              series={[
                { key: "regularH", label: "Regular Hours", color: "#18181b" },
                { key: "overtimeH", label: "Overtime (>8h)", color: "#dc2626" },
              ]}
            />
          ) : (
            <AttendanceHeatmap
              days={s.days28.map((d) => ({
                date: d.date,
                label: d.label,
                hours: d.totalH,
                sessions: d.sessions,
                late: d.late,
              }))}
            />
          )}
        </ChartCard>

        {/* Priority Action Inbox */}
        <div className="ui-card flex flex-col justify-between p-5">
          <div>
            <SectionHeader title="Priority Action Queue" subtitle="Items awaiting admin decision" />
            {attention.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-emerald-200/60 bg-emerald-50/50 py-10 text-center">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                  <Icon d="M5 13l4 4L19 7" />
                </span>
                <p className="mt-3 text-sm font-semibold text-zinc-800">All queues clear</p>
                <p className="mt-0.5 text-xs text-zinc-500">No pending approvals or overdue tasks right now.</p>
              </div>
            ) : (
              <ul className="space-y-2">
                {attention.map((a) => {
                  const t = TONES[a.tone];
                  return (
                    <li key={a.label}>
                      <Link
                        href={a.href}
                        className="group flex items-center gap-3 rounded-xl border border-zinc-100 p-3 transition-all hover:border-zinc-200 hover:bg-zinc-50"
                      >
                        <span
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${t.bg} ${t.fg}`}
                        >
                          <Icon d={a.icon} className="h-[18px] w-[18px]" />
                        </span>
                        <span className="min-w-0 flex-1 text-[13px] text-zinc-700">
                          <span className="font-code font-bold text-zinc-900">{a.n}</span> {a.label}
                        </span>
                        <span className="rounded-lg bg-zinc-900 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors group-hover:bg-red-600">
                          {a.cta}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Live Workforce Presence Radar Strip */}
          <div className="mt-5 rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-3.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-zinc-800">Live Shift Radar</span>
              <Link href="/admin/work-sessions" className="font-semibold text-red-600 hover:text-red-700">
                Sessions →
              </Link>
            </div>
            <div className="mt-2.5 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-white p-2 border border-zinc-200/60">
                <p className="font-code text-base font-bold text-emerald-600">
                  {s.activeSessions.length - s.idleSessions.length}
                </p>
                <p className="text-[10px] font-medium text-zinc-500">Active</p>
              </div>
              <div className="rounded-lg bg-white p-2 border border-zinc-200/60">
                <p className="font-code text-base font-bold text-amber-600">{s.idleSessions.length}</p>
                <p className="text-[10px] font-medium text-zinc-500">Idle</p>
              </div>
              <div className="rounded-lg bg-white p-2 border border-zinc-200/60">
                <p className="font-code text-base font-bold text-red-600">{s.lateToday}</p>
                <p className="text-[10px] font-medium text-zinc-500">Late Today</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 3-Column Breakdown Bento: Task Pipeline Donut + Department Hours Donut + Client Rollout Studio ── */}
      <section className="grid gap-6 lg:grid-cols-3">
        <ChartCard
          title="Task Pipeline Distribution"
          subtitle={`${tasks.length} directives across all projects`}
          actions={
            <Link href="/admin/tasks" className="text-xs font-semibold text-red-600 hover:text-red-700">
              All tasks →
            </Link>
          }
        >
          <DonutBreakdownChart
            slices={s.statusDist}
            centerLabel="Completion"
            centerValue={`${tasks.length ? Math.round((s.completedTasks.length / tasks.length) * 100) : 0}%`}
            description="Task pipeline breakdown across To do, In progress, In review, and Completed"
          />
        </ChartCard>

        <ChartCard
          title="Hours by Department (28d)"
          subtitle="Share of logged hours across teams"
          actions={
            <Link href="/admin/reports" className="text-xs font-semibold text-red-600 hover:text-red-700">
              Reports →
            </Link>
          }
        >
          {s.deptSlices.length === 0 ? (
            <p className="py-12 text-center text-xs text-zinc-400">No department hours logged in this window.</p>
          ) : (
            <DonutBreakdownChart
              slices={s.deptSlices}
              centerLabel="28d Hours"
              format={(v) => `${v}h`}
              description="Logged hours by department over the last 28 days"
            />
          )}
        </ChartCard>

        <ChartCard
          title="Workspace Health Rings"
          subtitle="Real-time completion, client sign-off & shift presence"
          badge={
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-code text-[10px] font-semibold text-emerald-700">
              Live Rings
            </span>
          }
          actions={
            <Link
              href="/admin/client-portal"
              className="rounded-lg border border-zinc-200 px-2.5 py-1 text-[11px] font-semibold text-zinc-700 hover:bg-zinc-50"
            >
              Client Studio →
            </Link>
          }
        >
          <ConcentricRingsChart
            rings={[
              {
                key: "tasks",
                label: "Task Velocity",
                sublabel: `${s.completedTasks.length} of ${tasks.length} directives done`,
                pct: tasks.length ? Math.round((s.completedTasks.length / tasks.length) * 100) : 0,
                color: "#059669",
                href: "/admin/tasks",
              },
              {
                key: "rollout",
                label: "Client Rollout",
                sublabel: `${portalStats.approvedPosts}/${portalStats.totalPosts} posts · ${portalStats.readyPosts} in review`,
                pct: portalStats.pct,
                color: "#dc2626",
                href: "/admin/client-portal",
              },
              {
                key: "presence",
                label: "Shift Presence",
                sublabel: `${s.onlineWorkers.length} of ${s.approvedWorkers.length} team online`,
                pct: s.approvedWorkers.length
                  ? Math.round((s.onlineWorkers.length / s.approvedWorkers.length) * 100)
                  : 0,
                color: "#2563eb",
                href: "/admin/work-sessions",
              },
            ]}
          />
        </ChartCard>
      </section>

      {/* ── Active Projects Delivery Table + Live Activity & Online Roster ── */}
      <section className="grid gap-6 xl:grid-cols-3">
        <div className="ui-card overflow-hidden xl:col-span-2">
          <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4">
            <div>
              <h2 className="text-[15px] font-semibold text-zinc-900">Active Projects Delivery</h2>
              <p className="text-xs text-zinc-500">Prioritized by directives awaiting review and completion progress</p>
            </div>
            <Link href="/admin/projects" className="text-xs font-semibold text-red-600 hover:text-red-700">
              All projects →
            </Link>
          </div>

          {s.projectRows.length === 0 ? (
            <p className="py-12 text-center text-sm text-zinc-500">No active projects yet.</p>
          ) : (
            <div className="mft-table-wrapper">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="border-b border-zinc-100 bg-zinc-50/90 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                  <tr>
                    <th className="px-5 py-3">Project / Client</th>
                    <th className="px-3 py-3 text-right">Directives</th>
                    <th className="px-3 py-3 text-right">Status</th>
                    <th className="px-5 py-3 text-right">Delivery Progress</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {s.projectRows.map((p) => (
                    <tr key={p.id} className="transition-colors hover:bg-zinc-50/80">
                      <td className="px-5 py-3.5">
                        <Link href={`/admin/projects?project=${encodeURIComponent(p.id)}`} className="flex items-center gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-zinc-900 font-code text-xs font-bold text-white">
                            {p.name.slice(0, 2).toUpperCase()}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-zinc-900">{p.name}</p>
                            <p className="truncate text-xs text-zinc-500">{p.clientName || "Internal Workspace"}</p>
                          </div>
                        </Link>
                      </td>
                      <td className="px-3 py-3.5 text-right font-code text-xs tabular-nums text-zinc-700">
                        <span className="font-bold text-zinc-900">{p.done}</span> / {p.total}
                      </td>
                      <td className="px-3 py-3.5 text-right">
                        <div className="inline-flex flex-wrap justify-end gap-1">
                          {p.review > 0 && (
                            <span className="rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                              {p.review} review
                            </span>
                          )}
                          {p.overdueCount > 0 && (
                            <span className="rounded-md bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                              {p.overdueCount} overdue
                            </span>
                          )}
                          {p.review === 0 && p.overdueCount === 0 && (
                            <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                              On track
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center justify-end gap-2.5">
                          <div className="h-2 w-28 overflow-hidden rounded-full bg-zinc-100">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-500"
                              style={{ width: `${p.pct}%` }}
                            />
                          </div>
                          <span className="w-9 text-right font-code text-xs font-bold tabular-nums text-zinc-800">
                            {p.pct}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Who's Online + Recent Activity */}
        <div className="space-y-6">
          <div className="ui-card p-5">
            <SectionHeader
              title="Online Team Roster"
              subtitle={`${s.onlineWorkers.length} of ${s.approvedWorkers.length} members active`}
              href="/admin/workers"
            />
            {s.onlineWorkers.length === 0 ? (
              <p className="py-6 text-center text-xs text-zinc-400">No active shifts right now.</p>
            ) : (
              <ul className="space-y-1.5">
                {s.onlineWorkers.slice(0, 5).map((w) => {
                  const openForWorker = s.openTasks.filter((t) =>
                    (Array.isArray(t.assignedTo) ? t.assignedTo : [t.assignedTo]).includes(w.id),
                  ).length;
                  return (
                    <li key={w.id} className="flex items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-zinc-50">
                      <span className="relative">
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-900 font-code text-[11px] font-bold uppercase text-white">
                          {(w.firstName?.[0] ?? "") + (w.lastName?.[0] ?? "")}
                        </span>
                        <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-semibold text-zinc-900">
                          {workerName(w.id) || "Worker"}
                        </span>
                        <span className="block truncate text-[11px] capitalize text-zinc-500">
                          {(w.role || w.department || "team member").replace(/-/g, " ")}
                        </span>
                      </span>
                      <span className="rounded-md bg-zinc-100 px-2 py-0.5 font-code text-[10px] font-semibold text-zinc-600">
                        {openForWorker} open
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="ui-card p-5">
            <SectionHeader title="Live Workspace Stream" subtitle="Recent events" href="/admin/activity" />
            {s.activity.length === 0 ? (
              <p className="py-6 text-center text-xs text-zinc-400">No recent activity.</p>
            ) : (
              <ol className="relative space-y-1.5 before:absolute before:bottom-2 before:left-[15px] before:top-2 before:w-px before:bg-zinc-200">
                {s.activity.slice(0, 5).map((a) => {
                  const t = TONES[a.tone];
                  return (
                    <li key={a.id}>
                      <Link
                        href={a.href}
                        className="relative flex items-center gap-3 rounded-lg py-1.5 pr-2 transition-colors hover:bg-zinc-50"
                      >
                        <span
                          className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-4 ring-white ${t.bg} ${t.fg}`}
                        >
                          <Icon d={a.icon} className="h-3.5 w-3.5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-semibold text-zinc-900">{a.title}</span>
                          <span className="block truncate text-[11px] text-zinc-500">{a.meta}</span>
                        </span>
                        <span className="shrink-0 font-code text-[10px] text-zinc-400">{timeAgo(a.at)}</span>
                      </Link>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </div>
      </section>

      {/* ── Complete 12-Module Directory ── */}
      <section>
        <SectionHeader title="Workspace Modules" subtitle="Direct access to every operational and HR control center" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {modules.map((m) => {
            const t = TONES[m.tone];
            return (
              <Link
                key={m.title}
                href={m.href}
                target={m.external ? "_blank" : undefined}
                rel={m.external ? "noopener noreferrer" : undefined}
                className="ui-card ui-card-hover group flex flex-col justify-between p-5"
              >
                <div>
                  <div className="flex items-center gap-3">
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${t.bg} ${t.fg}`}>
                      <Icon d={m.icon} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-zinc-900">{m.title}</p>
                      <p className="truncate text-xs text-zinc-500">{m.desc}</p>
                    </div>
                  </div>
                  {m.stats.length > 0 ? (
                    <div className="mt-4 grid grid-cols-3 divide-x divide-zinc-100 rounded-xl border border-zinc-100 bg-zinc-50/70 py-2.5">
                      {m.stats.map(([l, v]) => (
                        <div key={l as string} className="px-2 text-center">
                          <p className="font-code text-sm font-bold tabular-nums text-zinc-900">{v}</p>
                          <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">{l}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-4 rounded-xl border border-zinc-100 bg-zinc-50/70 py-3.5 text-center text-xs text-zinc-500">
                      {m.external ? "Opens external CMS ↗" : "View full audit trail →"}
                    </div>
                  )}
                </div>
                <span className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-zinc-500 transition-colors group-hover:text-red-600">
                  Open {m.title}
                  <Icon d="M9 5l7 7-7 7" className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
