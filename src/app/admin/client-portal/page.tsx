"use client";

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { toast, confirmDialog } from "@/lib/admin/feedback";
import {
  applyClientInteractionsToPortal,
  deleteClientPortalFromFirestore,
  importPortalFromGoogleSheetUrl,
  saveClientPortalToFirestore,
  subscribeClientPortals,
  subscribePortalInteractions,
} from "@/lib/admin/clientPortalStore";
import {
  ARC_DEFAULT_PORTAL,
  type ClientPortalInteraction,
  type ClientRolloutPortal,
  type DailyStoryItem,
  type FeedPostItem,
  type MilestoneItem,
  type MilestoneStatus,
  type PaidMediaCampaignItem,
  type PublishStatus,
} from "@/lib/admin/clientPortalTypes";

type AdminPortalTab = "overview" | "timeline" | "feed" | "stories" | "ads";

const MILESTONE_STATUSES: MilestoneStatus[] = [
  "Pending",
  "In progress",
  "Waiting Client",
  "Done",
  "Delayed",
];

const PUBLISH_STATUSES: PublishStatus[] = [
  "Draft",
  "Ready for Review",
  "Approved",
  "Revision Requested",
  "Scheduled",
  "Published",
];

function Icon({ d, className = "h-[18px] w-[18px]" }: { d: string; className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

function statusPillClass(status: string): string {
  const s = status.toLowerCase();
  if (s === "done" || s === "published" || s === "approved" || s === "completed") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (s.includes("progress") || s === "scheduled" || s === "active") {
    return "border-blue-200 bg-blue-50 text-blue-700";
  }
  if (s.includes("wait") || s.includes("review")) {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  if (s.includes("revision") || s.includes("delay")) {
    return "border-red-200 bg-red-50 text-red-700";
  }
  return "border-zinc-200 bg-zinc-100 text-zinc-600";
}

function SvgDonutChart({
  segments,
  centerValue,
  centerLabel,
}: {
  segments: Array<{ label: string; value: number; color: string }>;
  centerValue: string;
  centerLabel: string;
}) {
  const total = Math.max(1, segments.reduce((acc, s) => acc + s.value, 0));
  const radius = 48;
  const circumference = 2 * Math.PI * radius;
  let cumulative = 0;

  return (
    <div className="flex flex-col sm:flex-row items-center gap-6">
      <div className="relative h-36 w-36 shrink-0">
        <svg viewBox="0 0 120 120" className="h-36 w-36 -rotate-90">
          <circle cx="60" cy="60" r={radius} fill="none" stroke="#e4e4e7" strokeWidth="14" className="opacity-40" />
          {segments.map((seg) => {
            if (seg.value <= 0) return null;
            const dash = (seg.value / total) * circumference;
            const offset = -(cumulative / total) * circumference;
            cumulative += seg.value;
            return (
              <circle
                key={seg.label}
                cx="60"
                cy="60"
                r={radius}
                fill="none"
                stroke={seg.color}
                strokeWidth="14"
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={offset}
                className="transition-all duration-700"
              />
            );
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-2xl font-bold tabular-nums text-zinc-900">{centerValue}</span>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{centerLabel}</span>
        </div>
      </div>

      <ul className="flex-1 w-full space-y-2">
        {segments.map((seg) => {
          const pct = Math.round((seg.value / total) * 100);
          return (
            <li key={seg.label} className="flex items-center gap-2.5 text-xs">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: seg.color }} />
              <span className="flex-1 font-medium text-zinc-600">{seg.label}</span>
              <span className="font-bold tabular-nums text-zinc-900">{seg.value}</span>
              <span className="w-9 text-right text-[11px] tabular-nums text-zinc-400">({pct}%)</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function AdminClientPortalPage() {
  const [adminEmail, setAdminEmail] = useState("admin@mft.com");
  const [portalsMap, setPortalsMap] = useState<Record<string, ClientRolloutPortal>>({
    [ARC_DEFAULT_PORTAL.id]: ARC_DEFAULT_PORTAL,
  });
  const [selectedPortalId, setSelectedPortalId] = useState<string>(ARC_DEFAULT_PORTAL.id);
  const [interactions, setInteractions] = useState<ClientPortalInteraction[]>([]);
  const [draft, setDraft] = useState<ClientRolloutPortal>(ARC_DEFAULT_PORTAL);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importingSheet, setImportingSheet] = useState(false);

  // Navigation & Filters
  const [activeTab, setActiveTab] = useState<AdminPortalTab>("overview");
  const [cycleFilter, setCycleFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Quick Drawer / Modal Editor for Post or Milestone
  const [editingPost, setEditingPost] = useState<FeedPostItem | null>(null);
  const [editingMilestone, setEditingMilestone] = useState<MilestoneItem | null>(null);

  // New Client Modal
  const [newClientModal, setNewClientModal] = useState(false);
  const [newClientCode, setNewClientCode] = useState("");
  const [newClientName, setNewClientName] = useState("");
  const [newClientPin, setNewClientPin] = useState("2026");
  const [newClientSheetUrl, setNewClientSheetUrl] = useState("");

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      if (u?.email) setAdminEmail(u.email);
    });
  }, []);

  useEffect(() => {
    return subscribeClientPortals((map) => {
      setPortalsMap(map);
    });
  }, []);

  useEffect(() => {
    if (!selectedPortalId) return;
    return subscribePortalInteractions(selectedPortalId, setInteractions);
  }, [selectedPortalId]);

  const livePortal = useMemo(() => {
    const base = portalsMap[selectedPortalId] || ARC_DEFAULT_PORTAL;
    return applyClientInteractionsToPortal(base, interactions);
  }, [portalsMap, selectedPortalId, interactions]);

  useEffect(() => {
    if (!dirty || draft.id !== livePortal.id) {
      setDraft(livePortal);
      setDirty(false);
    }
  }, [livePortal, dirty, draft.id]);

  const updateDraft = (updater: (prev: ClientRolloutPortal) => ClientRolloutPortal) => {
    setDraft((prev) => updater(prev));
    setDirty(true);
  };

  const handleSavePortal = async (nextPortal?: ClientRolloutPortal) => {
    const toSave = nextPortal ?? draft;
    setSaving(true);
    try {
      await saveClientPortalToFirestore(toSave, adminEmail);
      setDirty(false);
      toast.success(`تم حفظ ومزامنة بوابة "${toSave.clientName}" ✓`, {
        description: "التعديلات ظاهرة الآن للعميل لحظياً.",
      });
    } catch (err) {
      toast.error("تعذر حفظ التعديلات", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleImportGoogleSheet = async (targetUrl?: string) => {
    const urlToUse = (targetUrl ?? draft.googleSheetUrl ?? "").trim();
    if (!urlToUse) {
      toast.warning("يرجى إدخال رابط Google Sheet أولاً");
      return;
    }
    setImportingSheet(true);
    try {
      const imported = await importPortalFromGoogleSheetUrl(urlToUse, draft);
      setDraft(imported);
      await saveClientPortalToFirestore(imported, adminEmail);
      setDirty(false);
      toast.success("تمت المزامنة من Google Sheet بنجاح ✓", {
        description: `تم سحب ${imported.milestones.length} مرحلة، ${imported.feedCalendar.length} بوست، و ${imported.dailyStories.length} ستوري.`,
      });
    } catch (err) {
      toast.error("فشل سحب البيانات من Google Sheet", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setImportingSheet(false);
    }
  };

  const handleCreateNewClient = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = newClientCode.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "");
    const name = newClientName.trim() || code;
    if (!code) {
      toast.warning("يرجى إدخال كود العميل (مثال: ARC)");
      return;
    }
    const id = code.toLowerCase();
    setSaving(true);
    try {
      let created: ClientRolloutPortal = {
        ...ARC_DEFAULT_PORTAL,
        id,
        clientCode: code,
        accessPin: newClientPin.trim() || "2026",
        clientName: name,
        projectTitle: `${name}  /  Social Media Rollout`,
        googleSheetUrl: newClientSheetUrl.trim() || "",
        contractSigned: false,
        contractSignedAt: undefined,
        contractSignedBy: undefined,
        updatedAtIso: new Date().toISOString(),
        updatedBy: adminEmail,
      };
      if (newClientSheetUrl.trim()) {
        try {
          created = await importPortalFromGoogleSheetUrl(newClientSheetUrl.trim(), created);
        } catch {
          /* keep default template */
        }
      }
      await saveClientPortalToFirestore(created, adminEmail);
      setSelectedPortalId(id);
      setDraft(created);
      setDirty(false);
      setNewClientModal(false);
      setNewClientCode("");
      setNewClientName("");
      setNewClientSheetUrl("");
      toast.success(`تم إنشاء بوابة العميل ${name} (${code}) ✓`);
    } finally {
      setSaving(false);
    }
  };

  const handleCopyMagicLink = () => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const url = `${origin}/client?code=${encodeURIComponent(draft.clientCode)}&pin=${encodeURIComponent(draft.accessPin)}`;
    navigator.clipboard?.writeText(url);
    toast.success("تم نسخ رابط دخول العميل السريع ✓", {
      description: url,
    });
  };

  // Analytics & Metrics
  const stats = useMemo(() => {
    const msDone = draft.milestones.filter((m) => m.status === "Done").length;
    const msWaiting = draft.milestones.filter((m) => m.status === "Waiting Client").length;
    const feedApproved = draft.feedCalendar.filter((f) =>
      ["Approved", "Scheduled", "Published"].includes(f.publishStatus),
    ).length;
    const feedReview = draft.feedCalendar.filter((f) => f.publishStatus === "Ready for Review").length;
    const feedRevision = draft.feedCalendar.filter((f) => f.publishStatus === "Revision Requested").length;
    const feedDraft = draft.feedCalendar.filter((f) => f.publishStatus === "Draft").length;
    const storiesDone = draft.dailyStories.filter((s) =>
      ["Approved", "Scheduled", "Published"].includes(s.publishStatus),
    ).length;

    const total = draft.milestones.length + draft.feedCalendar.length + draft.dailyStories.length;
    const done = msDone + feedApproved + storiesDone;
    const overallPct = total > 0 ? Math.round((done / total) * 100) : 0;

    const byCycle = draft.cycles.map((c) => {
      const cMs = draft.milestones.filter((m) => m.cycle === c.name);
      const cMsDone = cMs.filter((m) => m.status === "Done").length;
      const cFeed = draft.feedCalendar.filter((f) => f.cycle === c.name);
      const cFeedDone = cFeed.filter((f) =>
        ["Approved", "Scheduled", "Published"].includes(f.publishStatus),
      ).length;
      const cStories = draft.dailyStories.filter((s) => s.cycle === c.name);
      const cStoriesDone = cStories.filter((s) =>
        ["Approved", "Scheduled", "Published"].includes(s.publishStatus),
      ).length;
      return {
        ...c,
        msPct: cMs.length ? Math.round((cMsDone / cMs.length) * 100) : 0,
        feedPct: cFeed.length ? Math.round((cFeedDone / cFeed.length) * 100) : 0,
        storyPct: cStories.length ? Math.round((cStoriesDone / cStories.length) * 100) : 0,
        msDone: cMsDone,
        msTotal: cMs.length,
        feedDone: cFeedDone,
        feedTotal: cFeed.length,
        storyDone: cStoriesDone,
        storyTotal: cStories.length,
      };
    });

    return {
      msDone,
      msWaiting,
      feedApproved,
      feedReview,
      feedRevision,
      feedDraft,
      storiesDone,
      overallPct,
      byCycle,
    };
  }, [draft]);

  const filteredMilestones = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return draft.milestones.filter((m) => {
      if (cycleFilter !== "all" && m.cycle !== cycleFilter) return false;
      if (q && !`${m.milestone} ${m.owner} ${m.notes}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [draft.milestones, cycleFilter, searchQuery]);

  const filteredFeed = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return draft.feedCalendar.filter((f) => {
      if (cycleFilter !== "all" && f.cycle !== cycleFilter) return false;
      if (q && !`${f.contentName} ${f.publishDate} ${f.topicTitle || ""} ${f.captionText || ""}`.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [draft.feedCalendar, cycleFilter, searchQuery]);

  const filteredStories = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return draft.dailyStories.filter((s) => {
      if (cycleFilter !== "all" && s.cycle !== cycleFilter) return false;
      if (q && !`${s.storyId} ${s.publishDate} ${s.topicAssetLink}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [draft.dailyStories, cycleFilter, searchQuery]);

  return (
    <div className="space-y-6">
      {/* ── Signature MFT Admin Hero Banner ── */}
      <section
        className="relative overflow-hidden rounded-2xl border border-zinc-200 bg-gradient-to-br from-zinc-900 via-zinc-900 to-red-950 p-6 text-white md:p-8"
        style={{ boxShadow: "var(--mft-shadow-lg)" }}
      >
        <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-red-600/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 left-1/3 h-56 w-56 rounded-full bg-red-500/10 blur-3xl" />

        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-white/10 px-3 py-0.5 text-[11px] font-semibold text-zinc-200 ring-1 ring-white/15">
                Client Code: {draft.clientCode} · PIN: {draft.accessPin}
              </span>
              {draft.contractSigned ? (
                <span className="rounded-full bg-emerald-500/20 px-3 py-0.5 text-[11px] font-semibold text-emerald-300 ring-1 ring-emerald-400/30">
                  ✓ موقّع بواسطة {draft.contractSignedBy}
                </span>
              ) : (
                <span className="rounded-full bg-amber-500/20 px-3 py-0.5 text-[11px] font-semibold text-amber-300 ring-1 ring-amber-400/30">
                  ● بانتظار توقيع العميل
                </span>
              )}
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">
              {draft.projectTitle}
            </h1>
            <p className="mt-1.5 max-w-2xl text-sm text-zinc-300">
              لوحة التحكم الكاملة في بوابة العميل، الجداول الزمنية، كالندر البوستات والـ Stories، ومزامنة Google Sheets.
            </p>
          </div>

          {/* Client Switcher & Primary Action Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedPortalId}
              onChange={(e) => {
                setSelectedPortalId(e.target.value);
                setDirty(false);
              }}
              className="rounded-lg bg-white/10 px-3 py-2 text-xs font-semibold text-white ring-1 ring-white/15 backdrop-blur focus:outline-none cursor-pointer"
            >
              {Object.values(portalsMap).map((p) => (
                <option key={p.id} value={p.id} className="text-zinc-900">
                  🏢 {p.clientName} ({p.clientCode})
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => setNewClientModal(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3.5 py-2 text-xs font-semibold text-white ring-1 ring-white/15 backdrop-blur hover:bg-white/15 cursor-pointer"
            >
              + عميل جديد
            </button>

            <button
              type="button"
              onClick={handleCopyMagicLink}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3.5 py-2 text-xs font-semibold text-white ring-1 ring-white/15 backdrop-blur hover:bg-white/15 cursor-pointer"
            >
              🔗 نسخ رابط العميل
            </button>

            <a
              href={`/client?code=${encodeURIComponent(draft.clientCode)}&pin=${encodeURIComponent(draft.accessPin)}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3.5 py-2 text-xs font-semibold text-white ring-1 ring-white/15 backdrop-blur hover:bg-white/15"
            >
              ↗ شاشة العميل
            </a>

            <button
              type="button"
              onClick={() => void handleSavePortal()}
              disabled={saving}
              className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold text-white shadow-lg transition cursor-pointer ${
                dirty
                  ? "bg-emerald-500 hover:bg-emerald-400 animate-pulse"
                  : "bg-red-600 hover:bg-red-500 shadow-red-900/40"
              }`}
            >
              {saving ? "جاري الحفظ…" : dirty ? "💾 حفظ التعديلات *" : "💾 حفظ ومزامنة"}
            </button>
          </div>
        </div>

        {/* Mini Strip */}
        <div className="relative mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["إجمالي تقدم الخطة", `${stats.overallPct}%`],
            ["المراحل المكتملة", `${stats.msDone}/${draft.milestones.length}`],
            ["بوستات معتمدة / منشورة", `${stats.feedApproved}/${draft.feedCalendar.length}`],
            ["حركات واعتمادات العميل", `${interactions.length}`],
          ].map(([l, v]) => (
            <div key={l} className="rounded-xl bg-white/5 px-4 py-3 ring-1 ring-white/10">
              <p className="text-[11px] text-zinc-400">{l}</p>
              <p className="text-xl font-semibold tabular-nums mt-0.5">{v}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Navigation & Cycle Filter Bar ── */}
      <div className="ui-card p-3.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { id: "overview", label: "١. الإحصائيات والإعدادات" },
              { id: "timeline", label: `٢. الجدول الزمني (${draft.milestones.length})` },
              { id: "feed", label: `٣. كالندر البوستات (${draft.feedCalendar.length})` },
              { id: "stories", label: `٤. الـ Stories اليومية (${draft.dailyStories.length})` },
              { id: "ads", label: `٥. الإعلانات وسجل العميل (${interactions.length})` },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={`px-3.5 py-2 rounded-lg text-xs font-semibold cursor-pointer transition ${
                activeTab === t.id
                  ? "bg-red-600 text-white shadow-xs"
                  : "bg-zinc-50 text-zinc-700 hover:bg-zinc-100"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="🔍 بحث سريع في المراحل أو البوستات..."
            className="brutal-input w-56 py-1.5 text-xs"
          />
          <div className="flex items-center gap-1 rounded-lg border border-zinc-200 bg-zinc-50 p-1">
            {["all", ...draft.cycles.map((c) => c.name)].map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCycleFilter(c)}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer transition ${
                  cycleFilter === c ? "bg-zinc-900 text-white" : "text-zinc-600 hover:text-zinc-900"
                }`}
              >
                {c === "all" ? "الكل" : c}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── TAB 1: ANALYTICS CHARTS, GOOGLE SHEET SYNC & SETTINGS ── */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          {/* Analytics Charts Row */}
          <section className="grid gap-6 xl:grid-cols-3">
            {/* Multi-Cycle Progress Chart */}
            <div className="ui-card p-5 xl:col-span-2">
              <div className="mb-4 flex items-end justify-between">
                <div>
                  <h2 className="text-[15px] font-semibold text-zinc-900">
                    مؤشر إنجاز الدورات الثلاث (Cycle 01 – Cycle 03)
                  </h2>
                  <p className="text-xs text-zinc-500">
                    مقارنة حية بين المراحل، بوستات الـ Feed، والـ Stories اليومية لكل دورة
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {stats.byCycle.map((c) => (
                  <div key={c.id} className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="rounded-md bg-zinc-900 px-2.5 py-1 text-xs font-bold text-white">
                        {c.name}
                      </span>
                      <span className="text-[11px] text-zinc-500" dir="ltr">
                        {c.startDate} – {c.endDate}
                      </span>
                    </div>

                    <div className="flex h-32 items-end justify-around gap-3 pt-2 px-2">
                      {[
                        { label: "Timeline", pct: c.msPct, sub: `${c.msDone}/${c.msTotal}`, color: "from-red-600 to-red-400" },
                        { label: "Feed", pct: c.feedPct, sub: `${c.feedDone}/${c.feedTotal}`, color: "from-blue-600 to-sky-400" },
                        { label: "Stories", pct: c.storyPct, sub: `${c.storyDone}/${c.storyTotal}`, color: "from-emerald-600 to-emerald-400" },
                      ].map((b) => (
                        <div key={b.label} className="flex flex-1 flex-col items-center gap-1.5">
                          <span className="text-[10px] font-bold tabular-nums text-zinc-700">{b.pct}%</span>
                          <div className="relative flex h-20 w-full max-w-[36px] items-end overflow-hidden rounded-lg bg-zinc-200/80">
                            <div
                              className={`w-full rounded-lg bg-gradient-to-t ${b.color} transition-all duration-700`}
                              style={{ height: `${Math.max(b.pct, 6)}%` }}
                            />
                          </div>
                          <span className="text-[10px] font-semibold text-zinc-600">{b.label}</span>
                          <span className="text-[9px] font-mono text-zinc-400">{b.sub}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Content Approval Pipeline Donut Chart */}
            <div className="ui-card p-5 flex flex-col justify-between">
              <div className="mb-4">
                <h2 className="text-[15px] font-semibold text-zinc-900">حالة اعتمادات المحتوى</h2>
                <p className="text-xs text-zinc-500">توزيع الـ {draft.feedCalendar.length} بوست و Reel</p>
              </div>

              <SvgDonutChart
                centerValue={`${Math.round((stats.feedApproved / Math.max(1, draft.feedCalendar.length)) * 100)}%`}
                centerLabel="Approved"
                segments={[
                  { label: "معتمد / منشور", value: stats.feedApproved, color: "#10b981" },
                  { label: "جاهز للمراجعة", value: stats.feedReview, color: "#f59e0b" },
                  { label: "مطلوب تعديل", value: stats.feedRevision, color: "#ef4444" },
                  { label: "مسودة (Draft)", value: stats.feedDraft, color: "#71717a" },
                ]}
              />
            </div>
          </section>

          {/* Client Credentials & Live Google Sheets Sync */}
          <div className="ui-card p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-[15px] font-semibold text-zinc-900">
                  إعدادات دخول العميل والمزامنة التلقائية مع Google Sheets
                </h2>
                <p className="text-xs text-zinc-500">
                  يمكنك تعديل كود العميل أو سحب التحديثات مباشرة من شيت جوجل بضغطة واحدة
                </p>
              </div>
              {draft.id !== "arc" && (
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await confirmDialog({
                      title: `حذف بوابة ${draft.clientName}؟`,
                      message: "سيتم حذف إعدادات بوابة هذا العميل.",
                      confirmLabel: "حذف",
                      tone: "danger",
                    });
                    if (!ok) return;
                    await deleteClientPortalFromFirestore(draft.id, adminEmail);
                    setSelectedPortalId("arc");
                  }}
                  className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 cursor-pointer"
                >
                  حذف هذا العميل
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">اسم العميل (Client Name)</label>
                <input
                  type="text"
                  value={draft.clientName}
                  onChange={(e) => updateDraft((p) => ({ ...p, clientName: e.target.value }))}
                  className="brutal-input text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">كود الدخول (Client Code)</label>
                <input
                  type="text"
                  value={draft.clientCode}
                  onChange={(e) => updateDraft((p) => ({ ...p, clientCode: e.target.value.toUpperCase() }))}
                  dir="ltr"
                  className="brutal-input text-xs font-code font-bold uppercase"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">الرقم السري (Access PIN)</label>
                <input
                  type="text"
                  value={draft.accessPin}
                  onChange={(e) => updateDraft((p) => ({ ...p, accessPin: e.target.value }))}
                  dir="ltr"
                  className="brutal-input text-xs font-code font-bold"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">عنوان الخطة (Project Title)</label>
                <input
                  type="text"
                  value={draft.projectTitle}
                  onChange={(e) => updateDraft((p) => ({ ...p, projectTitle: e.target.value }))}
                  className="brutal-input text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-end pt-2">
              <div className="lg:col-span-2">
                <label className="block text-xs font-medium text-zinc-700 mb-1">
                  رابط Google Sheet (للمزامنة التلقائية للـ 4 تابات)
                </label>
                <input
                  type="url"
                  value={draft.googleSheetUrl || ""}
                  onChange={(e) => updateDraft((p) => ({ ...p, googleSheetUrl: e.target.value }))}
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  dir="ltr"
                  className="brutal-input text-xs font-code"
                />
              </div>
              <button
                type="button"
                onClick={() => void handleImportGoogleSheet()}
                disabled={importingSheet}
                className="brutal-btn h-10 text-xs normal-case"
              >
                {importingSheet ? "⏳ جاري سحب الجداول…" : "🔄 سحب ومزامنة من Google Sheet"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 2: MASTER TIMELINE (Clean Rows + Quick Status & Drawer Edit) ── */}
      {activeTab === "timeline" && (
        <div className="ui-card p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-[15px] font-semibold text-zinc-900">
                الجدول الزمني الرئيسي ({filteredMilestones.length} مرحلة)
              </h2>
              <p className="text-xs text-zinc-500">
                غيّر الحالة بضغطة واحدة أو اضغط «تعديل» لإضافة روابط الـ References والملفات
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                const newMs: MilestoneItem = {
                  id: `ms_${Date.now()}`,
                  cycle: cycleFilter === "all" ? "Cycle 01" : cycleFilter,
                  milestone: "مرحلة جديدة",
                  owner: "ARC",
                  startDate: "15 Nov 2026",
                  endDate: "16 Nov 2026",
                  actualDate: "",
                  status: "Pending",
                  linkEvidence: "",
                  notes: "",
                };
                updateDraft((p) => ({ ...p, milestones: [...p.milestones, newMs] }));
                setEditingMilestone(newMs);
              }}
              className="brutal-btn text-xs normal-case"
            >
              + إضافة مرحلة جديدة
            </button>
          </div>

          <div className="overflow-x-auto rounded-xl border border-zinc-200">
            <table className="w-full text-xs text-left rtl:text-right">
              <thead className="bg-zinc-50 text-zinc-500 uppercase text-[11px] border-b border-zinc-200">
                <tr>
                  <th className="px-4 py-3">Cycle</th>
                  <th className="px-4 py-3">Milestone</th>
                  <th className="px-4 py-3">Owner</th>
                  <th className="px-4 py-3">Planned Dates</th>
                  <th className="px-4 py-3">Status (تغيير سريع)</th>
                  <th className="px-4 py-3">Notes & Links</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {filteredMilestones.map((m) => (
                  <tr key={m.id} className="hover:bg-zinc-50/80 transition">
                    <td className="px-4 py-3 font-semibold text-zinc-900">{m.cycle}</td>
                    <td className="px-4 py-3 font-semibold text-zinc-900">{m.milestone}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-md bg-zinc-100 px-2 py-0.5 font-medium text-zinc-700">
                        {m.owner}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-600" dir="ltr">
                      {m.startDate} {m.endDate && m.endDate !== m.startDate ? `→ ${m.endDate}` : ""}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={m.status}
                        onChange={(e) =>
                          updateDraft((p) => ({
                            ...p,
                            milestones: p.milestones.map((x) =>
                              x.id === m.id ? { ...x, status: e.target.value as MilestoneStatus } : x,
                            ),
                          }))
                        }
                        className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold cursor-pointer ${statusPillClass(m.status)}`}
                      >
                        {MILESTONE_STATUSES.map((st) => (
                          <option key={st} value={st} className="bg-white text-zinc-900">
                            {st}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3 max-w-xs">
                      <p className="truncate text-zinc-600">{m.notes || "—"}</p>
                      {m.linkEvidence && (
                        <a
                          href={m.linkEvidence}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[11px] font-semibold text-red-600 hover:underline"
                        >
                          🔗 فتح الرابط ↗
                        </a>
                      )}
                      {m.clientComment && (
                        <p className="text-[11px] text-emerald-700 mt-0.5">💬 العميل: {m.clientComment}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setEditingMilestone(m)}
                          className="brutal-btn-outline px-2.5 py-1 text-[11px] normal-case"
                        >
                          ✏️ تعديل
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            updateDraft((p) => ({
                              ...p,
                              milestones: p.milestones.filter((x) => x.id !== m.id),
                            }))
                          }
                          className="rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-red-50 hover:text-red-600 cursor-pointer"
                        >
                          حذف
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── TAB 3: FEED CALENDAR (Visual Cards + Quick Status & Drawer Edit) ── */}
      {activeTab === "feed" && (
        <div className="space-y-4">
          <div className="ui-card p-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-[15px] font-semibold text-zinc-900">
                كالندر البوستات والـ Reels ({filteredFeed.length})
              </h2>
              <p className="text-xs text-zinc-500">
                اضغط على أي كارت لتعديل الكابشن أو إرفاق رابط التصميم، أو غيّر الحالة بضغطة واحدة
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {cycleFilter !== "all" && (
                <button
                  type="button"
                  onClick={() =>
                    updateDraft((p) => ({
                      ...p,
                      feedCalendar: p.feedCalendar.map((f) =>
                        f.cycle === cycleFilter && f.publishStatus === "Draft"
                          ? { ...f, publishStatus: "Ready for Review" }
                          : f,
                      ),
                    }))
                  }
                  className="brutal-btn-outline text-xs normal-case"
                >
                  🔔 تحويل مسودات {cycleFilter} إلى جاهز للمراجعة
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  const newPost: FeedPostItem = {
                    id: `fp_${Date.now()}`,
                    cycle: cycleFilter === "all" ? "Cycle 01" : cycleFilter,
                    contentName: `Post ${filteredFeed.length + 1}`,
                    publishDate: "15 Nov 2026",
                    day: "Sun",
                    cairoTime: "7:00 PM",
                    format: "Post",
                    platforms: "FB + IG",
                    actualPublish: "",
                    postType: "Organic",
                    publishStatus: "Draft",
                  };
                  updateDraft((p) => ({ ...p, feedCalendar: [...p.feedCalendar, newPost] }));
                  setEditingPost(newPost);
                }}
                className="brutal-btn text-xs normal-case"
              >
                + إضافة بوست / Reel
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredFeed.map((p) => {
              const isReel = p.format === "Reel";
              return (
                <div key={p.id} className="ui-card ui-card-hover p-5 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="rounded-md bg-zinc-100 px-2.5 py-1 text-xs font-bold text-zinc-900">
                          {p.cycle} · {p.contentName}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
                            isReel
                              ? "border-violet-200 bg-violet-50 text-violet-700"
                              : "border-sky-200 bg-sky-50 text-sky-700"
                          }`}
                        >
                          {isReel ? "🎬 Reel" : "🖼️ Post"}
                        </span>
                      </div>

                      <select
                        value={p.publishStatus}
                        onChange={(e) =>
                          updateDraft((prev) => ({
                            ...prev,
                            feedCalendar: prev.feedCalendar.map((x) =>
                              x.id === p.id ? { ...x, publishStatus: e.target.value as PublishStatus } : x,
                            ),
                          }))
                        }
                        className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold cursor-pointer ${statusPillClass(p.publishStatus)}`}
                      >
                        {PUBLISH_STATUSES.map((st) => (
                          <option key={st} value={st} className="bg-white text-zinc-900">
                            {st}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="mt-3 flex items-center justify-between text-xs text-zinc-500" dir="ltr">
                      <span>📅 {p.day}, {p.publishDate}</span>
                      <span>🕖 {p.cairoTime}</span>
                    </div>

                    <p className="mt-3 text-sm font-semibold text-zinc-900">
                      {p.topicTitle || "بدون عنوان (اضغط تعديل لإضافة فكرة البوست)"}
                    </p>
                    {p.captionText && (
                      <p className="mt-1 text-xs text-zinc-500 line-clamp-2">{p.captionText}</p>
                    )}

                    {p.clientComment && (
                      <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
                        💬 ملاحظة العميل: {p.clientComment}
                      </div>
                    )}
                  </div>

                  <div className="mt-4 pt-3 border-t border-zinc-100 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingPost(p)}
                      className="brutal-btn-outline flex-1 py-1.5 text-xs normal-case"
                    >
                      ✏️ تعديل المحتوى والروابط
                    </button>
                    {p.assetLink && (
                      <a
                        href={p.assetLink}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50"
                      >
                        🎨 معاينة ↗
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── TAB 4: DAILY STORIES ── */}
      {activeTab === "stories" && (
        <div className="ui-card p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-[15px] font-semibold text-zinc-900">
                الـ Stories اليومية ({filteredStories.length} ستوري)
              </h2>
              <p className="text-xs text-zinc-500">
                تُنشر يومياً الساعة 6:00 مساءً بتوقيت القاهرة شاملة الجمعة والسبت
              </p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-zinc-200 max-h-[600px]">
            <table className="w-full text-xs text-left rtl:text-right">
              <thead className="sticky top-0 bg-zinc-50 text-zinc-500 uppercase text-[11px] border-b border-zinc-200 z-10">
                <tr>
                  <th className="px-4 py-3">Cycle</th>
                  <th className="px-4 py-3">Story ID</th>
                  <th className="px-4 py-3">Date & Day</th>
                  <th className="px-4 py-3">Topic / Asset Link</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Client Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {filteredStories.map((s: DailyStoryItem) => (
                  <tr key={s.id} className="hover:bg-zinc-50/80">
                    <td className="px-4 py-2.5 font-semibold text-zinc-900">{s.cycle}</td>
                    <td className="px-4 py-2.5 font-semibold text-zinc-900">{s.storyId}</td>
                    <td className="px-4 py-2.5 text-zinc-600" dir="ltr">
                      {s.publishDate} ({s.day})
                    </td>
                    <td className="px-4 py-2.5">
                      <input
                        type="text"
                        value={s.topicAssetLink}
                        onChange={(e) =>
                          updateDraft((prev) => ({
                            ...prev,
                            dailyStories: prev.dailyStories.map((x) =>
                              x.id === s.id ? { ...x, topicAssetLink: e.target.value } : x,
                            ),
                          }))
                        }
                        placeholder="أضف موضوع الاستوري أو رابط التصميم..."
                        className="brutal-input py-1 text-xs max-w-xs"
                      />
                    </td>
                    <td className="px-4 py-2.5">
                      <select
                        value={s.publishStatus}
                        onChange={(e) =>
                          updateDraft((prev) => ({
                            ...prev,
                            dailyStories: prev.dailyStories.map((x) =>
                              x.id === s.id ? { ...x, publishStatus: e.target.value as PublishStatus } : x,
                            ),
                          }))
                        }
                        className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold cursor-pointer ${statusPillClass(s.publishStatus)}`}
                      >
                        {PUBLISH_STATUSES.map((st) => (
                          <option key={st} value={st} className="bg-white text-zinc-900">
                            {st}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2.5 text-amber-700">{s.clientComment || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── TAB 5: PAID MEDIA & CLIENT ACTIVITY LOG ── */}
      {activeTab === "ads" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="ui-card p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-semibold text-zinc-900">
                حملات الإعلانات الممولة وتقارير الأداء (Meta Ads)
              </h2>
              <button
                type="button"
                onClick={() =>
                  updateDraft((p) => ({
                    ...p,
                    paidCampaigns: [
                      ...p.paidCampaigns,
                      {
                        id: `paid_${Date.now()}`,
                        cycle: "Cycle 01",
                        campaignName: "New Meta Campaign",
                        objective: "Messages & Lead Generation",
                        budgetEgp: 20000,
                        platforms: "Facebook + Instagram",
                        creativeLink: "",
                        adAccountAccessConfirmed: true,
                        status: "Waiting Approval",
                      },
                    ],
                  }))
                }
                className="brutal-btn text-xs normal-case"
              >
                + إضافة حملة
              </button>
            </div>

            <div className="space-y-3">
              {draft.paidCampaigns.map((c: PaidMediaCampaignItem) => (
                <div key={c.id} className="rounded-xl border border-zinc-200 bg-zinc-50/50 p-4 space-y-2.5 text-xs">
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={c.campaignName}
                      onChange={(e) =>
                        updateDraft((p) => ({
                          ...p,
                          paidCampaigns: p.paidCampaigns.map((x) =>
                            x.id === c.id ? { ...x, campaignName: e.target.value } : x,
                          ),
                        }))
                      }
                      className="brutal-input py-1.5 text-xs font-semibold"
                    />
                    <select
                      value={c.status}
                      onChange={(e) =>
                        updateDraft((p) => ({
                          ...p,
                          paidCampaigns: p.paidCampaigns.map((x) =>
                            x.id === c.id ? { ...x, status: e.target.value as PaidMediaCampaignItem["status"] } : x,
                          ),
                        }))
                      }
                      className="brutal-input py-1.5 text-xs font-semibold"
                    >
                      <option value="Draft">Draft</option>
                      <option value="Waiting Approval">Waiting Approval</option>
                      <option value="Approved">Approved</option>
                      <option value="Active">Active</option>
                      <option value="Completed">Completed</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-[10px] text-zinc-500">Objective</span>
                      <input
                        type="text"
                        value={c.objective}
                        onChange={(e) =>
                          updateDraft((p) => ({
                            ...p,
                            paidCampaigns: p.paidCampaigns.map((x) =>
                              x.id === c.id ? { ...x, objective: e.target.value } : x,
                            ),
                          }))
                        }
                        className="brutal-input py-1 text-xs"
                      />
                    </div>
                    <div>
                      <span className="text-[10px] text-zinc-500">Budget (EGP)</span>
                      <input
                        type="number"
                        value={c.budgetEgp}
                        onChange={(e) =>
                          updateDraft((p) => ({
                            ...p,
                            paidCampaigns: p.paidCampaigns.map((x) =>
                              x.id === c.id ? { ...x, budgetEgp: parseInt(e.target.value || "0", 10) } : x,
                            ),
                          }))
                        }
                        className="brutal-input py-1 text-xs"
                      />
                    </div>
                  </div>
                  <div>
                    <span className="text-[10px] text-zinc-500">رابط تقرير الأداء الشهري (Performance Report URL)</span>
                    <input
                      type="url"
                      value={c.reportLink || ""}
                      onChange={(e) =>
                        updateDraft((p) => ({
                          ...p,
                          paidCampaigns: p.paidCampaigns.map((x) =>
                            x.id === c.id ? { ...x, reportLink: e.target.value } : x,
                          ),
                        }))
                      }
                      placeholder="https://drive.google.com/..."
                      dir="ltr"
                      className="brutal-input py-1 text-xs"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="ui-card p-6 space-y-4">
            <h2 className="text-[15px] font-semibold text-zinc-900">
              سجل اعتمادات وملاحظات العميل اللحظي ({interactions.length})
            </h2>
            {interactions.length === 0 ? (
              <p className="text-xs text-zinc-500">لا توجد حركات مسجلة من العميل حتى الآن.</p>
            ) : (
              <div className="space-y-2.5 max-h-[500px] overflow-y-auto">
                {[...interactions].reverse().map((ev) => (
                  <div key={ev.id} className="rounded-xl border border-zinc-200 bg-zinc-50/70 p-3.5 text-xs space-y-1">
                    <div className="flex items-center justify-between text-[11px] text-zinc-500">
                      <strong className="text-zinc-900">{ev.actorName}</strong>
                      <span dir="ltr">{new Date(ev.createdAtIso).toLocaleString()}</span>
                    </div>
                    <p className="font-semibold text-red-600">
                      [{ev.actionType.toUpperCase()}] {ev.targetLabel}
                    </p>
                    {ev.comment && <p className="text-zinc-700">{ev.comment}</p>}
                    {ev.linkUrl && (
                      <a
                        href={ev.linkUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-block text-red-600 font-semibold hover:underline"
                      >
                        🔗 فتح الرابط المرفق ↗
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── MODAL: EDIT FEED POST ── */}
      {editingPost && (
        <div
          className="fixed inset-0 z-50 bg-zinc-950/50 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setEditingPost(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl space-y-4"
          >
            <h3 className="text-base font-semibold text-zinc-900">
              تعديل البوست: {editingPost.cycle} · {editingPost.contentName}
            </h3>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-medium text-zinc-700 mb-1">اسم المحتوى</label>
                <input
                  type="text"
                  value={editingPost.contentName}
                  onChange={(e) => setEditingPost({ ...editingPost, contentName: e.target.value })}
                  className="brutal-input text-xs"
                />
              </div>
              <div>
                <label className="block font-medium text-zinc-700 mb-1">النوع (Format)</label>
                <select
                  value={editingPost.format}
                  onChange={(e) =>
                    setEditingPost({ ...editingPost, format: e.target.value as FeedPostItem["format"] })
                  }
                  className="brutal-input text-xs"
                >
                  <option value="Post">Post</option>
                  <option value="Reel">Reel</option>
                  <option value="Carousel">Carousel</option>
                  <option value="Video">Video</option>
                </select>
              </div>
              <div>
                <label className="block font-medium text-zinc-700 mb-1">تاريخ النشر</label>
                <input
                  type="text"
                  value={editingPost.publishDate}
                  onChange={(e) => setEditingPost({ ...editingPost, publishDate: e.target.value })}
                  dir="ltr"
                  className="brutal-input text-xs"
                />
              </div>
              <div>
                <label className="block font-medium text-zinc-700 mb-1">الحالة</label>
                <select
                  value={editingPost.publishStatus}
                  onChange={(e) =>
                    setEditingPost({ ...editingPost, publishStatus: e.target.value as PublishStatus })
                  }
                  className="brutal-input text-xs"
                >
                  {PUBLISH_STATUSES.map((st) => (
                    <option key={st} value={st}>{st}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1">عنوان الفكرة / الموضوع</label>
              <input
                type="text"
                value={editingPost.topicTitle || ""}
                onChange={(e) => setEditingPost({ ...editingPost, topicTitle: e.target.value })}
                placeholder="مثال: إطلاق المرحلة الأولى لمشروع ARC..."
                className="brutal-input text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1">الكابشن / السكريبت</label>
              <textarea
                rows={3}
                value={editingPost.captionText || ""}
                onChange={(e) => setEditingPost({ ...editingPost, captionText: e.target.value })}
                placeholder="اكتب نص البوست أو سكريبت الـ Reel..."
                className="brutal-input text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1">
                رابط التصميم / الفيديو للمعاينة (Google Drive / Canva)
              </label>
              <input
                type="url"
                value={editingPost.assetLink || ""}
                onChange={(e) => setEditingPost({ ...editingPost, assetLink: e.target.value })}
                placeholder="https://drive.google.com/..."
                dir="ltr"
                className="brutal-input text-xs"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingPost(null)}
                className="brutal-btn-outline px-4 py-2 text-xs normal-case"
              >
                إغلاق
              </button>
              <button
                type="button"
                onClick={() => {
                  const next = {
                    ...draft,
                    feedCalendar: draft.feedCalendar.map((x) =>
                      x.id === editingPost.id ? editingPost : x,
                    ),
                  };
                  setDraft(next);
                  setEditingPost(null);
                  void handleSavePortal(next);
                }}
                className="brutal-btn px-5 py-2 text-xs normal-case"
              >
                حفظ ومزامنة للعميل
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: EDIT MILESTONE ── */}
      {editingMilestone && (
        <div
          className="fixed inset-0 z-50 bg-zinc-950/50 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setEditingMilestone(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl space-y-4"
          >
            <h3 className="text-base font-semibold text-zinc-900">
              تعديل المرحلة: {editingMilestone.milestone}
            </h3>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-medium text-zinc-700 mb-1">اسم المرحلة</label>
                <input
                  type="text"
                  value={editingMilestone.milestone}
                  onChange={(e) => setEditingMilestone({ ...editingMilestone, milestone: e.target.value })}
                  className="brutal-input text-xs"
                />
              </div>
              <div>
                <label className="block font-medium text-zinc-700 mb-1">المسؤول (Owner)</label>
                <input
                  type="text"
                  value={editingMilestone.owner}
                  onChange={(e) => setEditingMilestone({ ...editingMilestone, owner: e.target.value })}
                  className="brutal-input text-xs"
                />
              </div>
              <div>
                <label className="block font-medium text-zinc-700 mb-1">تاريخ البدء</label>
                <input
                  type="text"
                  value={editingMilestone.startDate}
                  onChange={(e) => setEditingMilestone({ ...editingMilestone, startDate: e.target.value })}
                  dir="ltr"
                  className="brutal-input text-xs"
                />
              </div>
              <div>
                <label className="block font-medium text-zinc-700 mb-1">تاريخ الانتهاء</label>
                <input
                  type="text"
                  value={editingMilestone.endDate}
                  onChange={(e) => setEditingMilestone({ ...editingMilestone, endDate: e.target.value })}
                  dir="ltr"
                  className="brutal-input text-xs"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1">رابط الملفات / الإثبات (Link / Evidence)</label>
              <input
                type="url"
                value={editingMilestone.linkEvidence}
                onChange={(e) => setEditingMilestone({ ...editingMilestone, linkEvidence: e.target.value })}
                placeholder="https://drive.google.com/..."
                dir="ltr"
                className="brutal-input text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1">الملاحظات والشرح</label>
              <textarea
                rows={3}
                value={editingMilestone.notes}
                onChange={(e) => setEditingMilestone({ ...editingMilestone, notes: e.target.value })}
                className="brutal-input text-xs"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingMilestone(null)}
                className="brutal-btn-outline px-4 py-2 text-xs normal-case"
              >
                إغلاق
              </button>
              <button
                type="button"
                onClick={() => {
                  const next = {
                    ...draft,
                    milestones: draft.milestones.map((x) =>
                      x.id === editingMilestone.id ? editingMilestone : x,
                    ),
                  };
                  setDraft(next);
                  setEditingMilestone(null);
                  void handleSavePortal(next);
                }}
                className="brutal-btn px-5 py-2 text-xs normal-case"
              >
                حفظ ومزامنة للعميل
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: CREATE NEW CLIENT PORTAL ── */}
      {newClientModal && (
        <div
          className="fixed inset-0 z-50 bg-zinc-950/50 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setNewClientModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl space-y-4"
          >
            <h3 className="text-base font-semibold text-zinc-900">
              إضافة بوابة عميل جديدة (New Client Portal)
            </h3>
            <form onSubmit={handleCreateNewClient} className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-zinc-700 mb-1">اسم العميل / الشركة</label>
                <input
                  type="text"
                  required
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                  placeholder="مثال: ARC Developments"
                  className="brutal-input text-xs"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-zinc-700 mb-1">كود الدخول (Client Code)</label>
                  <input
                    type="text"
                    required
                    value={newClientCode}
                    onChange={(e) => setNewClientCode(e.target.value.toUpperCase())}
                    placeholder="ARC2"
                    dir="ltr"
                    className="brutal-input text-xs font-code uppercase"
                  />
                </div>
                <div>
                  <label className="block font-medium text-zinc-700 mb-1">الرقم السري (PIN)</label>
                  <input
                    type="text"
                    required
                    value={newClientPin}
                    onChange={(e) => setNewClientPin(e.target.value)}
                    placeholder="2026"
                    dir="ltr"
                    className="brutal-input text-xs font-code"
                  />
                </div>
              </div>
              <div>
                <label className="block font-medium text-zinc-700 mb-1">رابط Google Sheet للاستيراد التلقائي (اختياري)</label>
                <input
                  type="url"
                  value={newClientSheetUrl}
                  onChange={(e) => setNewClientSheetUrl(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  dir="ltr"
                  className="brutal-input text-xs font-code"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setNewClientModal(false)}
                  className="brutal-btn-outline px-4 py-2 text-xs normal-case"
                >
                  إلغاء
                </button>
                <button type="submit" disabled={saving} className="brutal-btn px-5 py-2 text-xs normal-case">
                  إنشاء البوابة
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
