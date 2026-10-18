"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { collection, query, orderBy, onSnapshot, doc, updateDoc, writeBatch } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useUrlState } from "@/lib/admin/useUrlState";
import { toast, confirmDialog } from "@/lib/admin/feedback";
import { logActivity } from "@/lib/admin/activity";
import { notifyAdmins } from "@/lib/adminNotifications";
import { downloadCsv } from "@/lib/admin/csv";
import { BulkBar, BulkButton, EmptyState, PageHeader, SkeletonRows, STATE_ICONS } from "@/components/admin/ui/States";
import LinkifiedText from "@/components/admin/ui/LinkifiedText";
import { ICONS } from "@/lib/admin/nav";

interface Submission {
  id: string;
  fullName: string;
  email: string;
  phone?: string;
  company?: string;
  meetingDate?: string;
  meetingTime?: string;
  meetingEmail?: string;
  services?: string[];
  projectDescription?: string;
  referenceLinks?: string;
  status: string;
  submittedAt: Date;
  phase1Status?: string;
  phase2Status?: string;
  phase3Status?: string;
}

const SERVICE_MAP: Record<string, string> = {
  branding: "Branding & Identity",
  "media-buying": "Media Buying",
  "digital-marketing": "Digital Marketing",
  "media-production": "Media Production",
  "outdoor-advertising": "Outdoor Advertising",
  "web-development": "Web & SEO Development",
  printing: "Printing Solutions",
  "event-management": "Event Management",
};

const STATUSES = [
  { key: "new", label: "New", style: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-500" },
  { key: "contacted", label: "Contacted", style: "bg-blue-50 text-blue-700 border-blue-200", dot: "bg-blue-500" },
  { key: "in-progress", label: "In progress", style: "bg-amber-50 text-amber-700 border-amber-200", dot: "bg-amber-500" },
  { key: "completed", label: "Completed", style: "bg-zinc-100 text-zinc-600 border-zinc-200", dot: "bg-zinc-400" },
] as const;
const statusMeta = (s: string) => STATUSES.find((x) => x.key === s) ?? STATUSES[0];

const PHASES = [
  { key: "phase1", label: "Planning" },
  { key: "phase2", label: "Development" },
  { key: "phase3", label: "Finalization" },
] as const;

function formatDate(date: Date | string | undefined) {
  if (!date) return "Unknown";
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) + " · " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDateOnly(date: string | undefined) {
  if (!date) return "Not specified";
  const d = new Date(date);
  return d.toLocaleDateString("en-US", { weekday: "short", year: "numeric", month: "short", day: "numeric" });
}

function formatTime(time: string | undefined) {
  if (!time) return "";
  const [hour, minute] = time.split(":");
  const h = parseInt(hour);
  return `${h % 12 || 12}:${minute} ${h >= 12 ? "PM" : "AM"}`;
}

function timeAgo(d: Date) {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function initials(n: string) {
  return (n || "?")
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function Svg({ d, className = "h-4 w-4" }: { d: string; className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

export default function AdminSubmissionsPage() {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useUrlState("status");
  const [serviceFilter, setServiceFilter] = useUrlState("service");
  const [searchFilter, setSearchFilter] = useUrlState("q");
  const [activeId, setActiveId] = useUrlState("id");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const q = query(collection(db, "submissions"), orderBy("submittedAt", "desc"));
    return onSnapshot(
      q,
      (snap) => {
        const items: Submission[] = [];
        snap.forEach((d) => {
          const data = d.data();
          items.push({
            id: d.id,
            ...data,
            status: data.status || "new",
            submittedAt: data.submittedAt?.toDate?.() || data.timestamp?.toDate?.() || new Date(data.createdAt || Date.now()),
          } as Submission);
        });
        setSubmissions(items);
        setLoading(false);
      },
      () => {
        setSubmissions([]);
        setLoading(false);
      },
    );
  }, []);

  const baseFiltered = useMemo(
    () =>
      submissions.filter((s) => {
        if (serviceFilter && !s.services?.includes(serviceFilter)) return false;
        if (searchFilter) {
          const q = searchFilter.toLowerCase();
          if (!s.fullName?.toLowerCase().includes(q) && !s.email?.toLowerCase().includes(q) && !s.company?.toLowerCase().includes(q) && !s.projectDescription?.toLowerCase().includes(q)) return false;
        }
        return true;
      }),
    [submissions, serviceFilter, searchFilter],
  );
  const filtered = useMemo(() => (statusFilter ? baseFiltered.filter((s) => s.status === statusFilter) : baseFiltered), [baseFiltered, statusFilter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: baseFiltered.length };
    STATUSES.forEach((s) => (c[s.key] = 0));
    baseFiltered.forEach((s) => (c[s.status] = (c[s.status] ?? 0) + 1));
    return c;
  }, [baseFiltered]);

  const active = useMemo(() => submissions.find((s) => s.id === activeId) ?? null, [submissions, activeId]);

  // Auto-select first item on desktop.
  useEffect(() => {
    if (!loading && !activeId && filtered.length && typeof window !== "undefined" && window.innerWidth >= 1024) setActiveId(filtered[0].id);
  }, [loading, activeId, filtered, setActiveId]);

  const contactClient = useCallback((email: string, name: string) => {
    const subject = encodeURIComponent("Re: Your Project Request - Monkeys Have Fallen The Tree");
    const body = encodeURIComponent(`Hi ${name},\n\nThank you for your project request. We've reviewed your requirements and would love to discuss your project in more detail.\n\nBest regards,\nMonkeys Have Fallen The Tree Team`);
    window.open(`mailto:${email}?subject=${subject}&body=${body}`);
  }, []);

  const setStatus = useCallback(
    async (ids: string[], status: string) => {
      setBusy(true);
      try {
        const batch = writeBatch(db);
        ids.forEach((id) => batch.update(doc(db, "submissions", id), { status, updatedAt: new Date().toISOString() }));
        await batch.commit();
        ids.forEach((id) => {
          const s = submissions.find((x) => x.id === id);
          void logActivity({ action: "status", entity: "submission", entityId: id, label: s?.fullName ?? "Submission", detail: `→ ${statusMeta(status).label}` });
          void notifyAdmins(db, {
            targetRoles: ["super_admin", "ops_admin"],
            category: "client",
            eventType: "submission_status_updated",
            title: `📩 Lead Updated: ${s?.fullName ?? "Client"}`,
            body: `${auth.currentUser?.email || "Admin"} marked "${s?.fullName ?? "Lead"}" as ${statusMeta(status).label}.`,
            href: `/admin/submissions?id=${encodeURIComponent(id)}`,
            actorUid: auth.currentUser?.uid,
            actorName: auth.currentUser?.email || "Admin",
          });
        });
        toast.success(ids.length === 1 ? `Marked as ${statusMeta(status).label.toLowerCase()}` : `${ids.length} submissions updated`);
        setSelected(new Set());
      } catch (err) {
        toast.error("Update failed", { description: err instanceof Error ? err.message : undefined });
      } finally {
        setBusy(false);
      }
    },
    [submissions],
  );

  const updatePhase = useCallback(
    async (id: string, phase: string, status: string) => {
      const updateData: Record<string, unknown> = {
        [`${phase}Status`]: status,
        [`${phase}UpdatedAt`]: new Date().toISOString(),
      };
      const sub = submissions.find((s) => s.id === id);
      if (status === "in-progress" && sub?.status === "new") updateData.status = "in-progress";
      if (status === "completed") {
        updateData.updatedAt = new Date().toISOString();
        if (sub) {
          const p1 = phase === "phase1" ? true : sub.phase1Status === "completed";
          const p2 = phase === "phase2" ? true : sub.phase2Status === "completed";
          const p3 = phase === "phase3" ? true : sub.phase3Status === "completed";
          if (p1 && p2 && p3) {
            updateData.status = "completed";
            updateData.completedAt = new Date().toISOString();
          }
        }
      }
      try {
        await updateDoc(doc(db, "submissions", id), updateData);
        const label = PHASES.find((p) => p.key === phase)?.label ?? phase;
        void logActivity({ action: "updated", entity: "submission", entityId: id, label: sub?.fullName ?? "Submission", detail: `${label} → ${status}` });
        void notifyAdmins(db, {
          targetRoles: ["super_admin", "ops_admin"],
          category: "client",
          eventType: "submission_phase_updated",
          title: `📩 Lead Phase Updated: ${sub?.fullName ?? "Client"}`,
          body: `${auth.currentUser?.email || "Admin"} updated ${label} to ${status} for ${sub?.fullName ?? "Client"}.`,
          href: `/admin/submissions?id=${encodeURIComponent(id)}`,
          actorUid: auth.currentUser?.uid,
          actorName: auth.currentUser?.email || "Admin",
        });
        toast.success(`${label} ${status === "completed" ? "completed" : "started"}`);
      } catch (err) {
        toast.error("Couldn't update phase", { description: err instanceof Error ? err.message : undefined });
      }
    },
    [submissions],
  );

  const deleteSubmissions = useCallback(
    async (ids: string[]) => {
      const one = ids.length === 1 ? submissions.find((s) => s.id === ids[0]) : null;
      const ok = await confirmDialog({
        title: one ? `Delete ${one.fullName}'s submission?` : `Delete ${ids.length} submissions?`,
        message: "The lead and its pipeline history will be permanently removed.",
        tone: "danger",
      });
      if (!ok) return;
      setBusy(true);
      try {
        const batch = writeBatch(db);
        ids.forEach((id) => batch.delete(doc(db, "submissions", id)));
        await batch.commit();
        ids.forEach((id) => {
          const s = submissions.find((x) => x.id === id);
          void logActivity({ action: "deleted", entity: "submission", entityId: id, label: s?.fullName ?? "Submission", detail: s?.company });
        });
        if (ids.includes(activeId)) setActiveId("");
        setSelected(new Set());
        toast.success(ids.length === 1 ? "Submission deleted" : `${ids.length} submissions deleted`);
      } catch (err) {
        toast.error("Delete failed", { description: err instanceof Error ? err.message : undefined });
      } finally {
        setBusy(false);
      }
    },
    [submissions, activeId, setActiveId],
  );

  const exportCsv = () => {
    downloadCsv(
      [
        ["Name", "Email", "Phone", "Company", "Services", "Status", "Meeting date", "Meeting time", "Submitted", "Description", "References"],
        ...filtered.map((s) => [s.fullName, s.email, s.phone ?? "", s.company ?? "", (s.services ?? []).map((x) => SERVICE_MAP[x] || x).join("; "), s.status, s.meetingDate ?? "", s.meetingTime ?? "", formatDate(s.submittedAt), s.projectDescription ?? "", s.referenceLinks ?? ""]),
      ],
      `submissions_${new Date().toISOString().split("T")[0]}.csv`,
    );
    toast.success(`Exported ${filtered.length} submissions`);
  };

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const allSelected = filtered.length > 0 && filtered.every((f) => selected.has(f.id));

  const tabs = [{ key: "", label: "All", count: counts.all }, ...STATUSES.map((s) => ({ key: s.key, label: s.label, count: counts[s.key] ?? 0 }))];

  return (
    <div className="pb-24">
      <PageHeader
        title="Client submissions"
        description="Inbound leads and meeting requests from the website."
        actions={
          <button type="button" onClick={exportCsv} disabled={!filtered.length} className="brutal-btn-outline normal-case tracking-normal disabled:opacity-50">
            <Svg d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /> Export CSV
          </button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        {/* ── Inbox list ── */}
        <section className={`ui-card flex flex-col overflow-hidden lg:max-h-[calc(100vh-11rem)] ${active ? "hidden lg:flex" : "flex"}`}>
          <div className="flex gap-1 overflow-x-auto border-b border-zinc-100 px-2 pt-2">
            {tabs.map((t) => (
              <button
                key={t.key || "all"}
                type="button"
                onClick={() => setStatusFilter(t.key)}
                className={`relative flex shrink-0 items-center gap-1.5 px-2.5 pb-2.5 pt-1.5 text-xs font-medium transition-colors cursor-pointer ${statusFilter === t.key ? "text-zinc-900" : "text-zinc-500 hover:text-zinc-800"}`}
              >
                {t.label}
                <span className={`rounded-full px-1.5 text-[10px] font-semibold ${statusFilter === t.key ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-500"}`}>{t.count}</span>
                {statusFilter === t.key && <span className="absolute inset-x-1.5 -bottom-px h-0.5 rounded-full bg-red-600" />}
              </button>
            ))}
          </div>
          <div className="flex gap-2 border-b border-zinc-100 p-3">
            <div className="relative flex-1">
              <Svg d={STATE_ICONS.search} className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input id="submissions-search" value={searchFilter} onChange={(e) => setSearchFilter(e.target.value)} placeholder="Search leads…" className="brutal-input pl-9" />
            </div>
            <select value={serviceFilter} onChange={(e) => setServiceFilter(e.target.value)} className="brutal-input w-36" aria-label="Filter by service">
              <option value="">All services</option>
              {Object.entries(SERVICE_MAP).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          {filtered.length > 0 && (
            <label className="flex cursor-pointer items-center gap-3 border-b border-zinc-100 bg-zinc-50 px-4 py-2 text-[11px] text-zinc-500">
              <input type="checkbox" className="mft-check" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(filtered.map((f) => f.id)))} />
              Select all
            </label>
          )}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <SkeletonRows rows={7} cols={2} />
            ) : filtered.length === 0 ? (
              <EmptyState compact icon={ICONS.submissions} title={submissions.length ? "No leads match" : "No submissions yet"} description={submissions.length ? "Try a different tab or search." : "New website enquiries will land here in real time."} />
            ) : (
              <ul className="divide-y divide-zinc-100">
                {filtered.map((s) => {
                  const m = statusMeta(s.status);
                  const isActive = s.id === activeId;
                  return (
                    <li key={s.id} className={`group relative flex items-start gap-3 px-4 py-3 transition-colors ${isActive ? "bg-red-50/60" : "hover:bg-zinc-50"}`}>
                      {isActive && <span className="absolute left-0 top-0 h-full w-0.5 bg-red-600" />}
                      <input type="checkbox" className="mft-check mt-2.5" checked={selected.has(s.id)} onChange={() => toggle(s.id)} aria-label={`Select ${s.fullName}`} />
                      <button type="button" onClick={() => setActiveId(s.id)} className="flex min-w-0 flex-1 items-start gap-3 text-left cursor-pointer">
                        <span className="relative mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[11px] font-bold text-zinc-600">
                          {initials(s.fullName)}
                          {s.status === "new" && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center justify-between gap-2">
                            <span className={`truncate text-[13px] ${s.status === "new" ? "font-semibold text-zinc-900" : "font-medium text-zinc-800"}`}>{s.fullName}</span>
                            <span className="shrink-0 text-[10px] text-zinc-400">{timeAgo(s.submittedAt)}</span>
                          </span>
                          <span className="block truncate text-[11px] text-zinc-500">{s.company || s.email}</span>
                          <span className="mt-1 flex items-center gap-1.5">
                            <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-px text-[10px] font-medium ${m.style}`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
                              {m.label}
                            </span>
                            {s.services?.slice(0, 1).map((x) => (
                              <span key={x} className="truncate text-[10px] text-zinc-400">
                                {SERVICE_MAP[x] || x}
                                {(s.services?.length ?? 0) > 1 ? ` +${(s.services?.length ?? 1) - 1}` : ""}
                              </span>
                            ))}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        {/* ── Detail ── */}
        <section className={`ui-card overflow-hidden lg:max-h-[calc(100vh-11rem)] lg:overflow-y-auto ${active ? "block" : "hidden lg:block"}`}>
          {!active ? (
            <EmptyState icon={STATE_ICONS.inbox} title="Select a submission" description="Choose a lead from the list to see the full request and manage its pipeline." />
          ) : (
            <div className="animate-fade-in" key={active.id}>
              {/* Header */}
              <div className="border-b border-zinc-100 p-5 md:p-6">
                <button type="button" onClick={() => setActiveId("")} className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-900 lg:hidden cursor-pointer">
                  <Svg d="M15 19l-7-7 7-7" className="h-3.5 w-3.5" /> Back to inbox
                </button>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex items-start gap-4">
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-red-500 to-red-700 text-sm font-bold text-white">{initials(active.fullName)}</span>
                    <div className="min-w-0">
                      <h2 className="text-lg font-semibold text-zinc-900">{active.fullName}</h2>
                      {active.company && <p className="text-sm text-zinc-600">{active.company}</p>}
                      <p className="mt-0.5 text-xs text-zinc-400">Received {formatDate(active.submittedAt)}</p>
                    </div>
                  </div>
                  <select
                    id="submission-status"
                    value={active.status}
                    onChange={(e) => void setStatus([active.id], e.target.value)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-semibold cursor-pointer ${statusMeta(active.status).style}`}
                  >
                    {STATUSES.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="mt-5 flex flex-wrap gap-2">
                  <button type="button" onClick={() => contactClient(active.email, active.fullName)} className="brutal-btn normal-case tracking-normal">
                    <Svg d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /> Email client
                  </button>
                  {active.phone && (
                    <a href={`https://wa.me/${active.phone.replace(/[^0-9]/g, "")}`} target="_blank" rel="noreferrer" className="brutal-btn-outline normal-case tracking-normal">
                      <Svg d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /> WhatsApp
                    </a>
                  )}
                  {active.status === "new" && (
                    <button type="button" disabled={busy} onClick={() => void setStatus([active.id], "contacted")} className="brutal-btn-outline normal-case tracking-normal">
                      <Svg d="M5 13l4 4L19 7" /> Mark contacted
                    </button>
                  )}
                  <button type="button" onClick={() => void deleteSubmissions([active.id])} className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600 cursor-pointer">
                    <Svg d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /> Delete
                  </button>
                </div>
              </div>

              {/* Contact + meeting */}
              <div className="grid gap-px bg-zinc-100 sm:grid-cols-2">
                <div className="bg-white p-5">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Contact</p>
                  <a href={`mailto:${active.email}`} className="block truncate text-sm font-medium text-zinc-900 hover:text-red-600">
                    {active.email}
                  </a>
                  {active.phone && <p className="mt-1 text-sm text-zinc-700">{active.phone}</p>}
                </div>
                <div className="bg-white p-5">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Requested meeting</p>
                  <p className="text-sm font-medium text-zinc-900">{formatDateOnly(active.meetingDate)}</p>
                  {active.meetingTime && <p className="mt-0.5 text-sm text-red-600">{formatTime(active.meetingTime)}</p>}
                  {active.meetingEmail && <p className="mt-1 truncate text-xs text-zinc-500">Invite: {active.meetingEmail}</p>}
                </div>
              </div>

              <div className="space-y-6 p-5 md:p-6">
                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Services</p>
                  <div className="flex flex-wrap gap-1.5">
                    {active.services?.length ? (
                      active.services.map((s) => (
                        <span key={s} className="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-zinc-700">
                          {SERVICE_MAP[s] || s}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs italic text-zinc-400">None specified</span>
                    )}
                  </div>
                </div>

                {active.projectDescription && (
                  <div>
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Project brief</p>
                    <p className="whitespace-pre-wrap rounded-lg border-l-2 border-red-500 bg-zinc-50 px-4 py-3 text-sm leading-relaxed text-zinc-800">
                      <LinkifiedText text={active.projectDescription} />
                    </p>
                  </div>
                )}

                {active.referenceLinks && (
                  <div>
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">References</p>
                    {active.referenceLinks.startsWith("http") ? (
                      <a href={active.referenceLinks} target="_blank" rel="noreferrer" className="break-all text-sm font-medium text-red-600 hover:underline">
                        {active.referenceLinks} ↗
                      </a>
                    ) : (
                      <p className="break-all text-sm text-zinc-700">{active.referenceLinks}</p>
                    )}
                  </div>
                )}

                {/* Pipeline stepper */}
                <div>
                  <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Project pipeline</p>
                  <ol className="grid gap-3 sm:grid-cols-3">
                    {PHASES.map((p, idx) => {
                      const st = (active[`${p.key}Status` as keyof Submission] as string) || "pending";
                      const done = st === "completed";
                      const current = st === "in-progress";
                      return (
                        <li key={p.key} className={`rounded-xl border p-4 transition-colors ${done ? "border-emerald-200 bg-emerald-50" : current ? "border-blue-200 bg-blue-50" : "border-zinc-200 bg-white"}`}>
                          <div className="flex items-center gap-2">
                            <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${done ? "bg-emerald-500 text-white" : current ? "bg-blue-500 text-white" : "bg-zinc-100 text-zinc-500"}`}>
                              {done ? <Svg d="M5 13l4 4L19 7" className="h-3.5 w-3.5" /> : idx + 1}
                            </span>
                            <span className="text-sm font-medium text-zinc-900">{p.label}</span>
                          </div>
                          <p className="mt-1 text-[11px] capitalize text-zinc-500">{done ? "Completed" : current ? "In progress" : "Not started"}</p>
                          {!done && (
                            <button
                              type="button"
                              onClick={() => void updatePhase(active.id, p.key, current ? "completed" : "in-progress")}
                              className={`mt-3 w-full rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${current ? "bg-emerald-600 text-white hover:bg-emerald-700" : "border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"}`}
                            >
                              {current ? "Mark complete" : "Start phase"}
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      <BulkBar count={selected.size} onClear={() => setSelected(new Set())}>
        <BulkButton disabled={busy} onClick={() => void setStatus([...selected], "contacted")}>
          Mark contacted
        </BulkButton>
        <BulkButton disabled={busy} onClick={() => void setStatus([...selected], "in-progress")}>
          In progress
        </BulkButton>
        <BulkButton tone="success" disabled={busy} onClick={() => void setStatus([...selected], "completed")}>
          Completed
        </BulkButton>
        <BulkButton tone="danger" disabled={busy} onClick={() => void deleteSubmissions([...selected])}>
          Delete
        </BulkButton>
      </BulkBar>
    </div>
  );
}
