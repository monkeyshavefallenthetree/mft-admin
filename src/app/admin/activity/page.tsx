"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query, type Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { ACTIVITY_COLLECTION, type ActivityAction, type ActivityEntity } from "@/lib/admin/activity";
import { useUrlState } from "@/lib/admin/useUrlState";
import { downloadCsv } from "@/lib/admin/csv";
import { EmptyState, ErrorState, PageHeader, SkeletonRows, STATE_ICONS } from "@/components/admin/ui/States";
import { ICONS } from "@/lib/admin/nav";

interface ActivityDoc {
  id: string;
  action: ActivityAction;
  entity: ActivityEntity;
  label: string;
  detail?: string | null;
  entityId?: string | null;
  actorEmail?: string;
  createdAt?: Timestamp | null;
}

const ENTITY_META: Record<ActivityEntity, { label: string; icon: string; tone: string }> = {
  project: { label: "Projects", icon: ICONS.projects, tone: "bg-red-100 text-red-700" },
  task: { label: "Tasks", icon: ICONS.tasks, tone: "bg-blue-100 text-blue-700" },
  worker: { label: "Workers", icon: ICONS.workers, tone: "bg-emerald-100 text-emerald-700" },
  exception: { label: "Exceptions", icon: ICONS.exceptions, tone: "bg-orange-100 text-orange-700" },
  submission: { label: "Submissions", icon: ICONS.submissions, tone: "bg-violet-100 text-violet-700" },
  hr: { label: "HR", icon: ICONS.hr, tone: "bg-amber-100 text-amber-700" },
  session: { label: "Sessions", icon: ICONS.sessions, tone: "bg-sky-100 text-sky-700" },
  auth: { label: "Sign-ins", icon: "M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z", tone: "bg-zinc-100 text-zinc-700" },
};

const ACTION_VERB: Record<ActivityAction, string> = {
  created: "created",
  updated: "updated",
  deleted: "deleted",
  approved: "approved",
  rejected: "rejected",
  assigned: "assigned",
  status: "changed status of",
  sent: "sent",
  exported: "exported",
  "signed-in": "signed in",
  "signed-out": "signed out",
};

const ACTION_TONE: Partial<Record<ActivityAction, string>> = {
  deleted: "text-red-600",
  rejected: "text-red-600",
  approved: "text-emerald-600",
  created: "text-blue-600",
};

function dayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dayLabel(key: string) {
  const today = dayKey(new Date());
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (key === today) return "Today";
  if (key === dayKey(y)) return "Yesterday";
  return new Date(key + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", year: "numeric" });
}

export default function ActivityPage() {
  const [items, setItems] = useState<ActivityDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [search, setSearch] = useUrlState("q");
  const [entity, setEntity] = useUrlState("entity");
  const [actor, setActor] = useUrlState("actor");
  const [range, setRange] = useUrlState("range", "30");

  useEffect(() => {
    setLoading(true);
    setError(null);
    const q = query(collection(db, ACTIVITY_COLLECTION), orderBy("createdAt", "desc"), limit(500));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setItems(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ActivityDoc, "id">) })));
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      },
    );
    return () => unsub();
  }, [reloadKey]);

  const actors = useMemo(() => Array.from(new Set(items.map((i) => i.actorEmail).filter(Boolean))) as string[], [items]);

  const filtered = useMemo(() => {
    const since = range === "all" ? 0 : Date.now() - Number(range) * 86400000;
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      const t = i.createdAt?.toDate?.().getTime() ?? Date.now();
      if (t < since) return false;
      if (entity && i.entity !== entity) return false;
      if (actor && i.actorEmail !== actor) return false;
      if (q && !`${i.label} ${i.detail ?? ""} ${i.actorEmail ?? ""} ${i.action}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, search, entity, actor, range]);

  const grouped = useMemo(() => {
    const map = new Map<string, ActivityDoc[]>();
    filtered.forEach((i) => {
      const k = dayKey(i.createdAt?.toDate?.() ?? new Date());
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(i);
    });
    return Array.from(map.entries());
  }, [filtered]);

  const stats = useMemo(() => {
    const today = dayKey(new Date());
    return {
      today: items.filter((i) => dayKey(i.createdAt?.toDate?.() ?? new Date()) === today).length,
      deletions: filtered.filter((i) => i.action === "deleted").length,
      approvals: filtered.filter((i) => i.action === "approved").length,
      admins: new Set(filtered.map((i) => i.actorEmail)).size,
    };
  }, [items, filtered]);

  const exportCsv = () => {
    downloadCsv(
      [
        ["When", "Admin", "Action", "Area", "Item", "Detail"],
        ...filtered.map((i) => [
          i.createdAt?.toDate?.().toLocaleString() ?? "",
          i.actorEmail ?? "",
          i.action,
          i.entity,
          i.label,
          i.detail ?? "",
        ]),
      ],
      `activity-log-${dayKey(new Date())}.csv`,
    );
  };

  const hasFilters = !!(search || entity || actor || range !== "30");

  return (
    <div>
      <PageHeader
        title="Activity log"
        description="A complete audit trail of what admins changed, approved and deleted."
        actions={
          <button type="button" onClick={exportCsv} disabled={!filtered.length} className="brutal-btn-outline normal-case tracking-normal disabled:opacity-50">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export CSV
          </button>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Actions today", stats.today],
          ["Approvals", stats.approvals],
          ["Deletions", stats.deletions],
          ["Active admins", stats.admins],
        ].map(([label, v]) => (
          <div key={label as string} className="ui-card px-4 py-3">
            <p className="text-[11px] font-medium text-zinc-500">{label}</p>
            <p className="mt-1 text-2xl font-bold tracking-tight text-zinc-900">{v}</p>
          </div>
        ))}
      </div>

      <div className="ui-card mb-5 flex flex-col gap-3 p-3 md:flex-row md:items-center">
        <div className="relative flex-1">
          <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d={STATE_ICONS.search} />
          </svg>
          <input id="activity-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search actions, items, admins…" className="brutal-input pl-9" />
        </div>
        <select id="activity-entity" value={entity} onChange={(e) => setEntity(e.target.value)} className="brutal-input md:w-44">
          <option value="">All areas</option>
          {Object.entries(ENTITY_META).map(([k, m]) => (
            <option key={k} value={k}>
              {m.label}
            </option>
          ))}
        </select>
        <select id="activity-actor" value={actor} onChange={(e) => setActor(e.target.value)} className="brutal-input md:w-52">
          <option value="">All admins</option>
          {actors.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <select id="activity-range" value={range} onChange={(e) => setRange(e.target.value)} className="brutal-input md:w-40">
          <option value="1">Last 24 hours</option>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
          <option value="all">All time</option>
        </select>
        {hasFilters && (
          <button
            type="button"
            onClick={() => {
              setSearch("");
              setEntity("");
              setActor("");
              setRange("30");
            }}
            className="text-xs font-medium text-zinc-500 hover:text-zinc-900 cursor-pointer"
          >
            Reset
          </button>
        )}
      </div>

      <div className="ui-card overflow-hidden">
        {loading ? (
          <SkeletonRows rows={8} cols={3} />
        ) : error ? (
          <ErrorState description={error} onRetry={() => setReloadKey((k) => k + 1)} />
        ) : grouped.length === 0 ? (
          <EmptyState
            icon={ICONS.activity}
            title={items.length ? "No activity matches your filters" : "No activity recorded yet"}
            description={items.length ? "Try widening the date range or clearing filters." : "Admin actions like approvals, deletions and new tasks will show up here automatically."}
          />
        ) : (
          grouped.map(([day, list]) => (
            <section key={day}>
              <div className="sticky top-16 z-[1] flex items-center justify-between border-b border-zinc-100 bg-zinc-50 px-5 py-2">
                <h3 className="text-xs font-semibold text-zinc-700">{dayLabel(day)}</h3>
                <span className="text-[11px] text-zinc-400">{list.length} actions</span>
              </div>
              <ol className="relative">
                {list.map((i) => {
                  const m = ENTITY_META[i.entity] ?? ENTITY_META.auth;
                  const at = i.createdAt?.toDate?.();
                  return (
                    <li key={i.id} className="group flex items-start gap-4 border-b border-zinc-50 px-5 py-3.5 transition-colors hover:bg-zinc-50">
                      <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${m.tone}`}>
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                          <path strokeLinecap="round" strokeLinejoin="round" d={m.icon} />
                        </svg>
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] leading-snug text-zinc-700">
                          <span className="font-semibold text-zinc-900">{i.actorEmail?.split("@")[0] ?? "Someone"}</span>{" "}
                          <span className={ACTION_TONE[i.action] ?? ""}>{ACTION_VERB[i.action] ?? i.action}</span>{" "}
                          {i.action !== "signed-in" && i.action !== "signed-out" && <span className="font-medium text-zinc-900">{i.label}</span>}
                        </p>
                        {i.detail && <p className="mt-0.5 truncate text-xs text-zinc-500">{i.detail}</p>}
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-xs font-medium text-zinc-600">{at ? at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "now"}</p>
                        <p className="text-[10px] text-zinc-400">{m.label}</p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
