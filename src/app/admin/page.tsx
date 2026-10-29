"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { FILTERED_LINKS, ICONS, STRAPI_CMS_ADMIN } from "@/lib/admin/nav";

/* ───────────────────────── Types ───────────────────────── */
type TS = { toDate?: () => Date } | Date | string | null | undefined;

interface Worker { id: string; firstName?: string; lastName?: string; status?: string; isOnline?: boolean; role?: string; department?: string }
interface Project { id: string; name: string; clientName?: string; status?: string; createdAt?: TS }
interface Task { id: string; title: string; status: string; priority?: string; projectId?: string; dueDate?: TS; createdAt?: TS; updatedAt?: TS; assignedTo?: string | string[] }
interface Session { id: string; date?: string; totalWorkTime?: number; isActive?: boolean; workerId?: string; workerName?: string; isLate?: boolean }
interface ExceptionReq { id: string; workerName?: string; type?: string; status?: string; createdAt?: TS; submittedAt?: TS }
interface Submission { id: string; fullName?: string; company?: string; status?: string; submittedAt?: TS; timestamp?: TS; services?: string[] }

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
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

const TONES = {
  red: { bg: "bg-red-50", fg: "text-red-600", bar: "bg-red-500" },
  blue: { bg: "bg-blue-50", fg: "text-blue-600", bar: "bg-blue-500" },
  amber: { bg: "bg-amber-50", fg: "text-amber-600", bar: "bg-amber-500" },
  emerald: { bg: "bg-emerald-50", fg: "text-emerald-600", bar: "bg-emerald-500" },
  violet: { bg: "bg-violet-50", fg: "text-violet-600", bar: "bg-violet-500" },
  zinc: { bg: "bg-zinc-100", fg: "text-zinc-600", bar: "bg-zinc-500" },
  orange: { bg: "bg-orange-50", fg: "text-orange-600", bar: "bg-orange-500" },
  sky: { bg: "bg-sky-50", fg: "text-sky-600", bar: "bg-sky-500" },
} as const;
type Tone = keyof typeof TONES;

/* ───────────────────────── Small components ───────────────────────── */
function Kpi({ label, value, sub, icon, tone, href, alert }: { label: string; value: string | number; sub: string; icon: string; tone: Tone; href: string; alert?: boolean }) {
  const t = TONES[tone];
  return (
    <Link href={href} className={`ui-card ui-card-hover group relative block p-4 ${alert ? "ring-1 ring-amber-300" : ""}`}>
      <div className="flex items-start justify-between">
        <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${t.bg} ${t.fg}`}>
          <Icon d={icon} className="h-[18px] w-[18px]" />
        </span>
        {alert && (
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
          </span>
        )}
      </div>
      <p className="mt-3 text-2xl font-bold tabular-nums tracking-tight text-zinc-900">{value}</p>
      <p className="text-[13px] font-medium text-zinc-700">{label}</p>
      <p className="mt-0.5 text-xs text-zinc-500">{sub}</p>
      <Icon d="M9 5l7 7-7 7" className="absolute bottom-4 right-4 h-4 w-4 text-zinc-300 transition-all group-hover:translate-x-0.5 group-hover:text-zinc-500" />
    </Link>
  );
}

function SectionHeader({ title, subtitle, href, cta }: { title: string; subtitle?: string; href?: string; cta?: string }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-3">
      <div>
        <h2 className="text-[15px] font-semibold text-zinc-900">{title}</h2>
        {subtitle && <p className="text-xs text-zinc-500">{subtitle}</p>}
      </div>
      {href && (
        <Link href={href} className="text-xs font-medium text-red-600 hover:text-red-700">
          {cta ?? "View all"} →
        </Link>
      )}
    </div>
  );
}

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-zinc-200/70 ${className}`} />;
}

/* ───────────────────────── Page ───────────────────────── */
export default function AdminOverviewPage() {
  const [workers, wReady] = useCollection<Worker>("workers");
  const [projects, pReady] = useCollection<Project>("projects");
  const [tasks, tReady] = useCollection<Task>("tasks");
  const [sessions] = useCollection<Session>("workSessions");
  const [exceptions] = useCollection<ExceptionReq>("exceptionRequests");
  const [submissions] = useCollection<Submission>("submissions");
  const ready = wReady && pReady && tReady;

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const s = useMemo(() => {
    const today = ymd(now);
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const approvedWorkers = workers.filter((w) => w.status === "approved");
    const pendingWorkers = workers.filter((w) => w.status === "pending");

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

    const todaySessions = sessions.filter((x) => x.date === today);
    const todayMs = todaySessions.reduce((a, x) => a + (x.totalWorkTime || 0), 0);
    const lateToday = todaySessions.filter((x) => x.isLate).length;
    const activeSessions = todaySessions.filter((x) => x.isActive);
    const activeTodayWorkerIds = new Set(activeSessions.map((x) => x.workerId).filter(Boolean));
    const onlineWorkers = workers.filter((w) => activeTodayWorkerIds.has(w.id));

    // Last 7 days hours
    const week: { label: string; date: string; h: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const key = ymd(d);
      const ms = sessions.filter((x) => x.date === key).reduce((a, x) => a + (x.totalWorkTime || 0), 0);
      week.push({ label: d.toLocaleDateString(undefined, { weekday: "short" }), date: key, h: hours(ms) });
    }
    const weekTotal = Math.round(week.reduce((a, d) => a + d.h, 0) * 10) / 10;
    const weekMax = Math.max(1, ...week.map((d) => d.h));

    const pendingExceptions = exceptions.filter((e) => e.status === "pending");
    const newSubs = submissions.filter((x) => !x.status || x.status === "new");

    const statusDist = [
      { key: "assigned", label: "To do", color: "#3b82f6", n: tasks.filter((t) => t.status === "assigned").length },
      { key: "in-progress", label: "In progress", color: "#f59e0b", n: tasks.filter((t) => t.status === "in-progress").length },
      { key: "pending-approval", label: "In review", color: "#ea580c", n: pendingApproval.length },
      { key: "completed", label: "Completed", color: "#10b981", n: completedTasks.length },
    ];
    const totalTasks = Math.max(1, tasks.length);
    let acc = 0;
    const conic = statusDist
      .map((x) => {
        const from = (acc / totalTasks) * 360;
        acc += x.n;
        const to = (acc / totalTasks) * 360;
        return `${x.color} ${from}deg ${to}deg`;
      })
      .join(", ");

    const projectRows = activeProjects
      .map((p) => {
        const pt = tasks.filter((t) => t.projectId === p.id);
        const done = pt.filter((t) => t.status === "completed").length;
        const review = pt.filter((t) => t.status === "pending-approval").length;
        return { ...p, total: pt.length, done, review, pct: pt.length ? Math.round((done / pt.length) * 100) : 0 };
      })
      .sort((a, b) => b.review - a.review || b.total - a.total)
      .slice(0, 5);

    // Activity feed
    type Act = { id: string; at: Date; title: string; meta: string; href: string; tone: Tone; icon: string };
    const acts: Act[] = [];
    tasks.forEach((t) => {
      const at = toDate(t.updatedAt) || toDate(t.createdAt);
      if (!at) return;
      const verb = t.status === "completed" ? "completed" : t.status === "pending-approval" ? "submitted for review" : toDate(t.updatedAt) ? "updated" : "created";
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
      acts.push({ id: "s" + x.id, at, title: x.fullName || "New lead", meta: `Submission${x.company ? ` · ${x.company}` : ""}`, href: "/admin/submissions", tone: "violet", icon: ICONS.submissions });
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
      approvedWorkers, pendingWorkers, onlineWorkers, pendingApproval, openTasks, completedTasks, overdue, dueToday,
      activeProjects, completedProjects, todayMs, lateToday, activeSessions, week, weekTotal, weekMax,
      pendingExceptions, newSubs, statusDist, conic, projectRows, activity: acts.slice(0, 10), todaySessions,
    };
  }, [workers, projects, tasks, sessions, exceptions, submissions, now]);

  const greeting = now.getHours() < 12 ? "Good morning" : now.getHours() < 18 ? "Good afternoon" : "Good evening";
  const attentionCount = s.pendingApproval.length + s.pendingWorkers.length + s.pendingExceptions.length + s.overdue.length + s.newSubs.length;

  const attention = [
    { n: s.pendingApproval.length, label: "tasks waiting for your approval", href: FILTERED_LINKS.pendingApprovals, tone: "amber" as Tone, icon: "M5 13l4 4L19 7", cta: "Review" },
    { n: s.overdue.length, label: "overdue tasks", href: "/admin/projects", tone: "red" as Tone, icon: ICONS.sessions, cta: "Open" },
    { n: s.pendingWorkers.length, label: "new workers awaiting approval", href: FILTERED_LINKS.pendingWorkers, tone: "blue" as Tone, icon: ICONS.workers, cta: "Approve" },
    { n: s.pendingExceptions.length, label: "exception requests pending", href: FILTERED_LINKS.pendingExceptions, tone: "orange" as Tone, icon: ICONS.exceptions, cta: "Decide" },
    { n: s.newSubs.length, label: "new client submissions", href: FILTERED_LINKS.newSubmissions, tone: "violet" as Tone, icon: ICONS.submissions, cta: "Contact" },
  ].filter((a) => a.n > 0);

  const modules = [
    { title: "Projects", href: "/admin/projects", icon: ICONS.projects, tone: "red" as Tone, desc: "Boards, lists & calendars per client", stats: [["Active", s.activeProjects.length], ["Completed", s.completedProjects.length], ["Total", projects.length]] },
    { title: "Tasks", href: "/admin/tasks", icon: ICONS.tasks, tone: "blue" as Tone, desc: "Every directive across all projects", stats: [["Open", s.openTasks.length], ["In review", s.pendingApproval.length], ["Done", s.completedTasks.length]] },
    { title: "Workers", href: "/admin/workers", icon: ICONS.workers, tone: "emerald" as Tone, desc: "Team roster, approvals & profiles", stats: [["Approved", s.approvedWorkers.length], ["Pending", s.pendingWorkers.length], ["Online", s.onlineWorkers.length]] },
    { title: "Work Sessions", href: "/admin/work-sessions", icon: ICONS.sessions, tone: "sky" as Tone, desc: "Attendance logs & hours worked", stats: [["Today", `${hours(s.todayMs)}h`], ["Active", s.activeSessions.length], ["7 days", `${s.weekTotal}h`]] },
    { title: "HR Dashboard", href: "/admin/hr", icon: ICONS.hr, tone: "violet" as Tone, desc: "Performance, penalties & alerts", stats: [["Late today", s.lateToday], ["Sessions", s.todaySessions.length], ["Team", s.approvedWorkers.length]] },
    { title: "Exceptions", href: "/admin/exceptions", icon: ICONS.exceptions, tone: "orange" as Tone, desc: "Late arrival & absence requests", stats: [["Pending", s.pendingExceptions.length], ["Total", exceptions.length], ["Approved", exceptions.filter((e) => e.status === "approved").length]] },
    { title: "Submissions", href: "/admin/submissions", icon: ICONS.submissions, tone: "amber" as Tone, desc: "Inbound leads & meeting requests", stats: [["New", s.newSubs.length], ["Total", submissions.length], ["Done", submissions.filter((x) => x.status === "completed").length]] },
    { title: "Reports", href: "/admin/reports", icon: ICONS.reports, tone: "sky" as Tone, desc: "Payroll, attendance & delivery with CSV/PDF export", stats: [["7-day hours", `${s.weekTotal}h`], ["Done tasks", s.completedTasks.length], ["Team", s.approvedWorkers.length]] },
    { title: "Activity Log", href: "/admin/activity", icon: ICONS.activity, tone: "zinc" as Tone, desc: "Audit trail of every admin action", stats: [] },
    { title: "Strapi CMS", href: STRAPI_CMS_ADMIN, icon: ICONS.cms, tone: "zinc" as Tone, desc: "Manage website content", stats: [], external: true },
  ];

  const workerName = (id: string) => {
    const w = workers.find((x) => x.id === id);
    return w ? `${w.firstName ?? ""} ${w.lastName ?? ""}`.trim() : "";
  };

  return (
    <div className="space-y-6">
      {/* ── Hero ── */}
      <section className="relative overflow-hidden rounded-2xl border border-zinc-200 bg-gradient-to-br from-zinc-900 via-zinc-900 to-red-950 p-6 text-white md:p-8" style={{ boxShadow: "var(--mft-shadow-lg)" }}>
        <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-red-600/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 left-1/3 h-56 w-56 rounded-full bg-red-500/10 blur-3xl" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-medium text-zinc-400">{now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight md:text-3xl">{greeting} 👋</h1>
            <p className="mt-2 max-w-xl text-sm text-zinc-300">
              {attentionCount > 0 ? (
                <>You have <span className="font-semibold text-white">{attentionCount} item{attentionCount === 1 ? "" : "s"}</span> that need your attention across the workspace.</>
              ) : (
                <>Everything is under control — no pending approvals or overdue work.</>
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/projects?new=1" className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-red-900/40 transition-all hover:bg-red-500 active:scale-[0.98]">
              <Icon d="M12 4v16m8-8H4" className="h-4 w-4" /> New project
            </Link>
            <Link href="/admin/tasks" className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2 text-sm font-semibold text-white ring-1 ring-white/15 backdrop-blur transition-all hover:bg-white/15">
              <Icon d={ICONS.tasks} className="h-4 w-4" /> Assign task
            </Link>
            <Link href="/admin/workers" className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2 text-sm font-semibold text-white ring-1 ring-white/15 backdrop-blur transition-all hover:bg-white/15">
              <Icon d={ICONS.workers} className="h-4 w-4" /> Team
            </Link>
          </div>
        </div>
        {/* Mini strip */}
        <div className="relative mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Online now", `${s.onlineWorkers.length}/${s.approvedWorkers.length}`],
            ["Hours today", `${hours(s.todayMs)}h`],
            ["Due today", s.dueToday.length],
            ["Completion", `${tasks.length ? Math.round((s.completedTasks.length / tasks.length) * 100) : 0}%`],
          ].map(([l, v]) => (
            <div key={l as string} className="rounded-xl bg-white/5 px-4 py-3 ring-1 ring-white/10">
              <p className="text-[11px] text-zinc-400">{l}</p>
              <p className="text-xl font-semibold tabular-nums">{ready ? v : "—"}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── KPIs ── */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {!ready
          ? Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-[138px]" />)
          : (
            <>
              <Kpi label="Active projects" value={s.activeProjects.length} sub={`${projects.length} total`} icon={ICONS.projects} tone="red" href="/admin/projects" />
              <Kpi label="Open tasks" value={s.openTasks.length} sub={`${s.dueToday.length} due today`} icon={ICONS.tasks} tone="blue" href="/admin/tasks" />
              <Kpi label="Awaiting approval" value={s.pendingApproval.length} sub="Submitted by workers" icon="M5 13l4 4L19 7" tone="amber" href={FILTERED_LINKS.pendingApprovals} alert={s.pendingApproval.length > 0} />
              <Kpi label="Overdue tasks" value={s.overdue.length} sub="Past due date" icon={ICONS.sessions} tone="orange" href="/admin/projects" alert={s.overdue.length > 0} />
              <Kpi label="Team members" value={s.approvedWorkers.length} sub={`${s.onlineWorkers.length} online · ${s.pendingWorkers.length} pending`} icon={ICONS.workers} tone="emerald" href={s.pendingWorkers.length > 0 ? FILTERED_LINKS.pendingWorkers : "/admin/workers"} alert={s.pendingWorkers.length > 0} />
              <Kpi label="Hours logged today" value={`${hours(s.todayMs)}h`} sub={`${s.activeSessions.length} active sessions`} icon={ICONS.sessions} tone="sky" href="/admin/work-sessions" />
              <Kpi label="Exception requests" value={s.pendingExceptions.length} sub="Pending decision" icon={ICONS.exceptions} tone="violet" href={FILTERED_LINKS.pendingExceptions} alert={s.pendingExceptions.length > 0} />
              <Kpi label="New submissions" value={s.newSubs.length} sub={`${submissions.length} leads total`} icon={ICONS.submissions} tone="zinc" href={FILTERED_LINKS.newSubmissions} alert={s.newSubs.length > 0} />
            </>
          )}
      </section>

      {/* ── Attention + Chart ── */}
      <section className="grid gap-6 xl:grid-cols-3">
        <div className="ui-card p-5 xl:col-span-1">
          <SectionHeader title="Needs your attention" subtitle="Prioritized action items" />
          {attention.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl bg-emerald-50/60 py-10 text-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                <Icon d="M5 13l4 4L19 7" />
              </span>
              <p className="mt-3 text-sm font-medium text-zinc-800">All clear</p>
              <p className="text-xs text-zinc-500">No pending actions right now.</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {attention.map((a) => {
                const t = TONES[a.tone];
                return (
                  <li key={a.label}>
                    <Link href={a.href} className="group flex items-center gap-3 rounded-xl border border-zinc-100 p-3 transition-all hover:border-zinc-200 hover:bg-zinc-50">
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${t.bg} ${t.fg}`}>
                        <Icon d={a.icon} className="h-[18px] w-[18px]" />
                      </span>
                      <span className="flex-1 text-[13px] text-zinc-700">
                        <span className="font-semibold text-zinc-900">{a.n}</span> {a.label}
                      </span>
                      <span className="rounded-md bg-zinc-900 px-2 py-1 text-[11px] font-semibold text-white opacity-80 transition-opacity group-hover:opacity-100">{a.cta}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="ui-card p-5 xl:col-span-2">
          <SectionHeader title="Hours worked — last 7 days" subtitle={`${s.weekTotal}h total across the team`} href="/admin/work-sessions" cta="Sessions" />
          <div className="flex h-52 items-end gap-3">
            {s.week.map((d, i) => {
              const pct = (d.h / s.weekMax) * 100;
              const isToday = i === s.week.length - 1;
              return (
                <div key={d.date} className="group flex flex-1 flex-col items-center gap-2">
                  <span className="text-[11px] font-semibold tabular-nums text-zinc-600 opacity-0 transition-opacity group-hover:opacity-100">{d.h}h</span>
                  <div className="relative flex h-40 w-full items-end overflow-hidden rounded-lg bg-zinc-100">
                    <div
                      className={`w-full rounded-lg transition-all duration-700 ${isToday ? "bg-gradient-to-t from-red-600 to-red-400" : "bg-gradient-to-t from-zinc-800 to-zinc-500 group-hover:from-red-600 group-hover:to-red-400"}`}
                      style={{ height: `${Math.max(pct, d.h > 0 ? 4 : 0)}%` }}
                    />
                  </div>
                  <span className={`text-[11px] font-medium ${isToday ? "text-red-600" : "text-zinc-500"}`}>{d.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Modules overview (every page) ── */}
      <section>
        <SectionHeader title="All modules" subtitle="Quick snapshot of every area of the dashboard" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {modules.map((m) => {
            const t = TONES[m.tone];
            return (
              <Link
                key={m.title}
                href={m.href}
                target={m.external ? "_blank" : undefined}
                rel={m.external ? "noopener noreferrer" : undefined}
                className="ui-card ui-card-hover group flex flex-col p-5"
              >
                <div className="flex items-center gap-3">
                  <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${t.bg} ${t.fg}`}>
                    <Icon d={m.icon} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-zinc-900">{m.title}</p>
                    <p className="truncate text-xs text-zinc-500">{m.desc}</p>
                  </div>
                </div>
                {m.stats.length > 0 ? (
                  <div className="mt-4 grid grid-cols-3 divide-x divide-zinc-100 rounded-lg bg-zinc-50 py-2.5">
                    {m.stats.map(([l, v]) => (
                      <div key={l as string} className="px-2 text-center">
                        <p className="text-base font-bold tabular-nums text-zinc-900">{v}</p>
                        <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">{l}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-4 rounded-lg bg-zinc-50 py-4 text-center text-xs text-zinc-500">Opens in a new tab ↗</div>
                )}
                <span className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-zinc-500 transition-colors group-hover:text-red-600">
                  Open {m.title} <Icon d="M9 5l7 7-7 7" className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      {/* ── Projects + Task distribution + Online ── */}
      <section className="grid gap-6 xl:grid-cols-3">
        <div className="ui-card p-5 xl:col-span-2">
          <SectionHeader title="Active projects" subtitle="Sorted by items in review" href="/admin/projects" />
          {s.projectRows.length === 0 ? (
            <p className="py-10 text-center text-sm text-zinc-500">No active projects yet.</p>
          ) : (
            <div className="divide-y divide-zinc-100">
              {s.projectRows.map((p) => (
                <Link key={p.id} href="/admin/projects" className="flex items-center gap-4 py-3 transition-colors hover:bg-zinc-50/70 -mx-2 px-2 rounded-lg">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-xs font-bold text-white">
                    {p.name.slice(0, 2).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold text-zinc-900">{p.name}</p>
                      {p.review > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">{p.review} in review</span>}
                    </div>
                    <p className="truncate text-xs text-zinc-500">{p.clientName || "Internal"} · {p.done}/{p.total} tasks</p>
                  </div>
                  <div className="hidden w-40 sm:block">
                    <div className="h-2 overflow-hidden rounded-full bg-zinc-100">
                      <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-700" style={{ width: `${p.pct}%` }} />
                    </div>
                  </div>
                  <span className="w-10 text-right text-sm font-semibold tabular-nums text-zinc-700">{p.pct}%</span>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="ui-card p-5">
          <SectionHeader title="Task pipeline" subtitle={`${tasks.length} tasks overall`} href="/admin/tasks" />
          <div className="flex items-center gap-6">
            <div className="relative h-32 w-32 shrink-0 rounded-full" style={{ background: tasks.length ? `conic-gradient(${s.conic})` : "#f4f4f5" }}>
              <div className="absolute inset-3 flex flex-col items-center justify-center rounded-full bg-white">
                <span className="text-2xl font-bold tabular-nums text-zinc-900">{tasks.length ? Math.round((s.completedTasks.length / tasks.length) * 100) : 0}%</span>
                <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">done</span>
              </div>
            </div>
            <ul className="flex-1 space-y-2.5">
              {s.statusDist.map((x) => (
                <li key={x.key} className="flex items-center gap-2 text-[13px]">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: x.color }} />
                  <span className="flex-1 text-zinc-600">{x.label}</span>
                  <span className="font-semibold tabular-nums text-zinc-900">{x.n}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── Activity + Online ── */}
      <section className="grid gap-6 xl:grid-cols-3">
        <div className="ui-card p-5 xl:col-span-2">
          <SectionHeader title="Recent activity" subtitle="Latest events across tasks, leads and requests" />
          {s.activity.length === 0 ? (
            <p className="py-10 text-center text-sm text-zinc-500">No activity yet.</p>
          ) : (
            <ol className="relative space-y-1 before:absolute before:bottom-2 before:left-[17px] before:top-2 before:w-px before:bg-zinc-200">
              {s.activity.map((a) => {
                const t = TONES[a.tone];
                return (
                  <li key={a.id}>
                    <Link href={a.href} className="relative flex items-center gap-3 rounded-lg py-2 pr-2 transition-colors hover:bg-zinc-50">
                      <span className={`relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ring-4 ring-white ${t.bg} ${t.fg}`}>
                        <Icon d={a.icon} className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-zinc-900">{a.title}</span>
                        <span className="block truncate text-xs text-zinc-500">{a.meta}</span>
                      </span>
                      <span className="shrink-0 text-[11px] text-zinc-400">{timeAgo(a.at)}</span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        <div className="ui-card p-5">
          <SectionHeader title="Who's online" subtitle={`${s.onlineWorkers.length} of ${s.approvedWorkers.length} team members`} href="/admin/workers" />
          {s.onlineWorkers.length === 0 ? (
            <p className="py-10 text-center text-sm text-zinc-500">Nobody is online right now.</p>
          ) : (
            <ul className="space-y-1">
              {s.onlineWorkers.slice(0, 8).map((w) => {
                const openForWorker = s.openTasks.filter((t) => (Array.isArray(t.assignedTo) ? t.assignedTo : [t.assignedTo]).includes(w.id)).length;
                return (
                  <li key={w.id} className="flex items-center gap-3 rounded-lg px-1 py-2">
                    <span className="relative">
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-900 text-[11px] font-bold uppercase text-white">
                        {(w.firstName?.[0] ?? "") + (w.lastName?.[0] ?? "")}
                      </span>
                      <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-white" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-zinc-900">{workerName(w.id) || "Worker"}</span>
                      <span className="block truncate text-xs capitalize text-zinc-500">{(w.role || w.department || "team member").replace(/-/g, " ")}</span>
                    </span>
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600">{openForWorker} open</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
