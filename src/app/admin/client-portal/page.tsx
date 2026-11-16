"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

type AdminPortalTab = "overview" | "feed" | "stories" | "timeline" | "ads";

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

function Icon({ d, className = "h-4 w-4" }: { d: string; className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

function statusMeta(status: string): { dot: string; pill: string } {
  const s = status.toLowerCase();
  if (s === "done" || s === "published" || s === "approved" || s === "completed") {
    return { dot: "bg-emerald-500", pill: "border-emerald-200 bg-emerald-50 text-emerald-700" };
  }
  if (s.includes("progress") || s === "scheduled" || s === "active") {
    return { dot: "bg-blue-500", pill: "border-blue-200 bg-blue-50 text-blue-700" };
  }
  if (s.includes("wait") || s.includes("review")) {
    return { dot: "bg-amber-500", pill: "border-amber-200 bg-amber-50 text-amber-700" };
  }
  if (s.includes("revision") || s.includes("delay")) {
    return { dot: "bg-red-500", pill: "border-red-200 bg-red-50 text-red-700" };
  }
  return { dot: "bg-zinc-400", pill: "border-zinc-200 bg-zinc-100 text-zinc-600" };
}

function DonutChart({
  segments,
  centerValue,
  centerSub,
}: {
  segments: Array<{ label: string; value: number; color: string }>;
  centerValue: string;
  centerSub: string;
}) {
  const total = Math.max(1, segments.reduce((acc, s) => acc + s.value, 0));
  const r = 46;
  const circ = 2 * Math.PI * r;
  let offsetAcc = 0;

  return (
    <div className="flex flex-col sm:flex-row items-center gap-6">
      <div className="relative h-32 w-32 shrink-0">
        <svg viewBox="0 0 112 112" className="h-32 w-32 -rotate-90">
          <circle cx="56" cy="56" r={r} fill="none" stroke="currentColor" strokeWidth="11" className="text-zinc-100" />
          {segments.map((seg) => {
            if (seg.value <= 0) return null;
            const dash = (seg.value / total) * circ;
            const dashOffset = -(offsetAcc / total) * circ;
            offsetAcc += seg.value;
            return (
              <circle
                key={seg.label}
                cx="56"
                cy="56"
                r={r}
                fill="none"
                stroke={seg.color}
                strokeWidth="11"
                strokeDasharray={`${dash} ${circ - dash}`}
                strokeDashoffset={dashOffset}
                className="transition-all duration-700"
              />
            );
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-bold tabular-nums text-zinc-900">{centerValue}</span>
          <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">{centerSub}</span>
        </div>
      </div>

      <div className="flex-1 w-full space-y-2.5">
        {segments.map((seg) => {
          const pct = Math.round((seg.value / total) * 100);
          return (
            <div key={seg.label} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2 text-zinc-600 font-medium">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: seg.color }} />
                  {seg.label}
                </span>
                <span className="font-semibold tabular-nums text-zinc-900">
                  {seg.value} <span className="text-zinc-400 font-normal">({pct}%)</span>
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${pct}%`, backgroundColor: seg.color }}
                />
              </div>
            </div>
          );
        })}
      </div>
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
  const [cycleFilter, setCycleFilter] = useState<string>("Cycle 01");
  const [feedViewMode, setFeedViewMode] = useState<"kanban" | "cards">("kanban");
  const [storyWeekIdx, setStoryWeekIdx] = useState<number>(0);
  const [searchQuery, setSearchQuery] = useState("");

  // Native <dialog> refs for Post & Milestone Inspector Modals
  const postDialogRef = useRef<HTMLDialogElement | null>(null);
  const milestoneDialogRef = useRef<HTMLDialogElement | null>(null);
  const newClientDialogRef = useRef<HTMLDialogElement | null>(null);

  const [editingPost, setEditingPost] = useState<FeedPostItem | null>(null);
  const [editingMilestone, setEditingMilestone] = useState<MilestoneItem | null>(null);
  const [newClientModal, setNewClientModal] = useState(false);
  const [newClientCode, setNewClientCode] = useState("");
  const [newClientName, setNewClientName] = useState("");
  const [newClientPin, setNewClientPin] = useState("2026");
  const [newClientSheetUrl, setNewClientSheetUrl] = useState("");

  useEffect(() => {
    const dlg = postDialogRef.current;
    if (!dlg) return;
    if (editingPost) {
      if (!dlg.open) dlg.showModal();
    } else if (dlg.open) {
      dlg.close();
    }
  }, [editingPost]);

  useEffect(() => {
    const dlg = milestoneDialogRef.current;
    if (!dlg) return;
    if (editingMilestone) {
      if (!dlg.open) dlg.showModal();
    } else if (dlg.open) {
      dlg.close();
    }
  }, [editingMilestone]);

  useEffect(() => {
    const dlg = newClientDialogRef.current;
    if (!dlg) return;
    if (newClientModal) {
      if (!dlg.open) dlg.showModal();
    } else if (dlg.open) {
      dlg.close();
    }
  }, [newClientModal]);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      if (u?.email) setAdminEmail(u.email);
    });
  }, []);

  useEffect(() => {
    return subscribeClientPortals(setPortalsMap);
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
      toast.success(`تم حفظ ومزامنة بوابة "${toSave.clientName}"`, {
        description: "التحديثات ظاهرة للعميل لحظياً.",
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
      toast.success("تمت المزامنة من Google Sheet بنجاح", {
        description: `${imported.milestones.length} مرحلة · ${imported.feedCalendar.length} بوست · ${imported.dailyStories.length} ستوري`,
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
      toast.warning("يرجى إدخال كود العميل");
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
      toast.success(`تم إنشاء بوابة العميل ${name} (${code})`);
    } finally {
      setSaving(false);
    }
  };

  const handleCopyMagicLink = () => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const url = `${origin}/client?code=${encodeURIComponent(draft.clientCode)}&pin=${encodeURIComponent(draft.accessPin)}`;
    navigator.clipboard?.writeText(url);
    toast.success("تم نسخ رابط دخول العميل", { description: url });
  };

  const stats = useMemo(() => {
    const msDone = draft.milestones.filter((m) => m.status === "Done").length;
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

  const cycleStories = useMemo(() => {
    const target = cycleFilter === "all" ? "Cycle 01" : cycleFilter;
    return draft.dailyStories.filter((s) => s.cycle === target);
  }, [draft.dailyStories, cycleFilter]);

  const storyWeeks = useMemo(() => {
    const weeks: DailyStoryItem[][] = [];
    for (let i = 0; i < cycleStories.length; i += 7) {
      weeks.push(cycleStories.slice(i, i + 7));
    }
    return weeks;
  }, [cycleStories]);

  const activeWeekStories = storyWeeks[storyWeekIdx] || storyWeeks[0] || [];

  return (
    <div className="space-y-6">
      {/* ── Executive Command Bar ── */}
      <section className="ui-card p-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-5 border-b border-zinc-100">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-0.5 text-[11px] font-code font-semibold text-zinc-700">
                Code: {draft.clientCode} · PIN: {draft.accessPin}
              </span>
              <span
                className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-0.5 text-[11px] font-medium ${
                  draft.contractSigned
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-amber-200 bg-amber-50 text-amber-700"
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${draft.contractSigned ? "bg-emerald-500" : "bg-amber-500"}`} />
                {draft.contractSigned ? `موقّع بواسطة ${draft.contractSignedBy}` : "بانتظار توقيع العميل"}
              </span>
            </div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-zinc-900">
              {draft.projectTitle}
            </h1>
            <p className="mt-1 text-xs text-zinc-500">
              إدارة استوديو العميل، لوحة كانبان المحتوى، خارطة الطريق، والربط المباشر مع Google Sheets
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedPortalId}
              onChange={(e) => {
                setSelectedPortalId(e.target.value);
                setDirty(false);
              }}
              className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-semibold text-zinc-900 cursor-pointer"
            >
              {Object.values(portalsMap).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.clientName} ({p.clientCode})
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => setNewClientModal(true)}
              className="brutal-btn-outline"
            >
              + عميل جديد
            </button>

            <button
              type="button"
              onClick={handleCopyMagicLink}
              className="brutal-btn-outline"
            >
              نسخ رابط العميل
            </button>

            <a
              href={`/client?code=${encodeURIComponent(draft.clientCode)}&pin=${encodeURIComponent(draft.accessPin)}`}
              target="_blank"
              rel="noreferrer"
              className="brutal-btn-outline"
            >
              معاينة بوابة العميل ↗
            </a>

            <button
              type="button"
              onClick={() => void handleSavePortal()}
              disabled={saving}
              className={`rounded-lg px-4 py-2 text-xs font-semibold text-white transition cursor-pointer ${
                dirty ? "bg-emerald-600 hover:bg-emerald-700" : "bg-zinc-900 hover:bg-zinc-800"
              }`}
            >
              {saving ? "جاري الحفظ…" : dirty ? "حفظ التعديلات *" : "حفظ ومزامنة"}
            </button>
          </div>
        </div>

        {/*Accessible Single-Row Tablist + Cycle Switcher (modern-web-guidance: tabs) */}
        <div className="pt-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div role="tablist" aria-label="أقسام إدارة بوابة العميل" className="flex items-center gap-1 overflow-x-auto">
            {(
              [
                { id: "overview", label: "الإحصائيات والإعدادات" },
                { id: "feed", label: `استوديو البوستات (${draft.feedCalendar.length})` },
                { id: "stories", label: `الـ Stories اليومية (${draft.dailyStories.length})` },
                { id: "timeline", label: `خارطة الطريق (${draft.milestones.length})` },
                { id: "ads", label: `الإعلانات وسجل العميل (${interactions.length})` },
              ] as const
            ).map((t) => {
              const selected = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={(e) => {
                    setActiveTab(t.id);
                    e.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" });
                  }}
                  className={`mft-tab-btn px-3.5 py-2 text-xs font-semibold transition cursor-pointer ${
                    selected ? "text-red-600" : "text-zinc-500 hover:text-zinc-900"
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="بحث في المحتوى أو المراحل…"
              className="brutal-input w-52 py-1.5 text-xs"
            />
            <div className="flex items-center gap-1 rounded-lg border border-zinc-200 bg-zinc-50 p-0.5">
              {["all", ...draft.cycles.map((c) => c.name)].map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => {
                    setCycleFilter(c);
                    setStoryWeekIdx(0);
                  }}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer transition ${
                    cycleFilter === c ? "bg-white text-zinc-900 shadow-xs" : "text-zinc-500 hover:text-zinc-900"
                  }`}
                >
                  {c === "all" ? "الكل" : c}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── TAB 1: ANALYTICS & SETTINGS ── */}
      {activeTab === "overview" && (
        <div className="space-y-6 animate-fade-in">
          <section className="grid gap-6 xl:grid-cols-3">
            <div className="ui-card p-6 xl:col-span-2">
              <h2 className="text-sm font-semibold text-zinc-900">معدل الإنجاز حسب الدورة</h2>
              <p className="text-xs text-zinc-500 mb-4">مقارنة المراحل، البوستات، والـ Stories عبر الـ 3 دورات</p>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {stats.byCycle.map((c) => (
                  <div key={c.id} className="rounded-xl border border-zinc-200/80 bg-zinc-50/40 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-zinc-900">{c.name}</span>
                      <span className="text-[11px] font-code text-zinc-500" dir="ltr">
                        {c.startDate.slice(0, 6)} – {c.endDate.slice(0, 6)}
                      </span>
                    </div>
                    <div className="space-y-2">
                      <div>
                        <div className="flex justify-between text-[11px] mb-1">
                          <span className="text-zinc-500">Roadmap</span>
                          <span className="font-semibold">{c.msDone}/{c.msTotal}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-zinc-200/70 overflow-hidden">
                          <div className="h-full rounded-full bg-zinc-900" style={{ width: `${c.msPct}%` }} />
                        </div>
                      </div>
                      <div>
                        <div className="flex justify-between text-[11px] mb-1">
                          <span className="text-zinc-500">Feed & Reels</span>
                          <span className="font-semibold">{c.feedDone}/{c.feedTotal}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-zinc-200/70 overflow-hidden">
                          <div className="h-full rounded-full bg-red-600" style={{ width: `${c.feedPct}%` }} />
                        </div>
                      </div>
                      <div>
                        <div className="flex justify-between text-[11px] mb-1">
                          <span className="text-zinc-500">Daily Stories</span>
                          <span className="font-semibold">{c.storyDone}/{c.storyTotal}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-zinc-200/70 overflow-hidden">
                          <div className="h-full rounded-full bg-emerald-600" style={{ width: `${c.storyPct}%` }} />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="ui-card p-6">
              <h2 className="text-sm font-semibold text-zinc-900">توزيع حالات البوستات</h2>
              <p className="text-xs text-zinc-500 mb-4">إجمالي {draft.feedCalendar.length} بوست و Reel</p>
              <DonutChart
                centerValue={`${Math.round((stats.feedApproved / Math.max(1, draft.feedCalendar.length)) * 100)}%`}
                centerSub="Approved"
                segments={[
                  { label: "معتمد / منشور", value: stats.feedApproved, color: "#10b981" },
                  { label: "بانتظار مراجعة العميل", value: stats.feedReview, color: "#f59e0b" },
                  { label: "مطلوب تعديل", value: stats.feedRevision, color: "#ef4444" },
                  { label: "مسودة (Draft)", value: stats.feedDraft, color: "#a1a1aa" },
                ]}
              />
            </div>
          </section>

          <section className="ui-card p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-zinc-900">إعدادات العميل والربط مع Google Sheets</h2>
                <p className="text-xs text-zinc-500">تحكم في بيانات الدخول أو اسحب أحدث الجداول من Google Sheet</p>
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
                  حذف العميل
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">اسم العميل</label>
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
                  className="brutal-input text-xs font-code font-semibold uppercase"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">الرقم السري (PIN)</label>
                <input
                  type="text"
                  value={draft.accessPin}
                  onChange={(e) => updateDraft((p) => ({ ...p, accessPin: e.target.value }))}
                  dir="ltr"
                  className="brutal-input text-xs font-code font-semibold"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">عنوان المشروع</label>
                <input
                  type="text"
                  value={draft.projectTitle}
                  onChange={(e) => updateDraft((p) => ({ ...p, projectTitle: e.target.value }))}
                  className="brutal-input text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-end pt-1">
              <div className="lg:col-span-2">
                <label className="block text-xs font-medium text-zinc-700 mb-1">رابط Google Sheet</label>
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
                className="brutal-btn h-10 text-xs"
              >
                {importingSheet ? "جاري سحب الجداول…" : "سحب ومزامنة من Google Sheet"}
              </button>
            </div>
          </section>
        </div>
      )}

      {/* ── TAB 2: KANBAN PIPELINE & SOCIAL STUDIO FOR FEED POSTS ── */}
      {activeTab === "feed" && (
        <div className="space-y-4 animate-fade-in">
          <div className="ui-card p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="flex items-center rounded-lg border border-zinc-200 bg-zinc-50 p-0.5">
                <button
                  type="button"
                  onClick={() => setFeedViewMode("kanban")}
                  className={`px-3 py-1 rounded-md text-xs font-medium cursor-pointer ${
                    feedViewMode === "kanban" ? "bg-white text-zinc-900 shadow-xs" : "text-zinc-500"
                  }`}
                >
                  لوحة المراحل (Kanban)
                </button>
                <button
                  type="button"
                  onClick={() => setFeedViewMode("cards")}
                  className={`px-3 py-1 rounded-md text-xs font-medium cursor-pointer ${
                    feedViewMode === "cards" ? "bg-white text-zinc-900 shadow-xs" : "text-zinc-500"
                  }`}
                >
                  كروت المعاينة
                </button>
              </div>
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
                  className="brutal-btn-outline text-xs"
                >
                  إرسال مسودات {cycleFilter} لمراجعة العميل
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
                className="brutal-btn text-xs"
              >
                + إضافة بوست / Reel
              </button>
            </div>
          </div>

          {feedViewMode === "kanban" ? (
            /* Linear-style 4-Column Kanban Pipeline */
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              {(
                [
                  { title: "قيد التجهيز (Draft)", statuses: ["Draft"], dot: "bg-zinc-400" },
                  { title: "بانتظار مراجعة العميل", statuses: ["Ready for Review"], dot: "bg-amber-500" },
                  { title: "مطلوب تعديل", statuses: ["Revision Requested"], dot: "bg-red-500" },
                  { title: "معتمد / منشور", statuses: ["Approved", "Scheduled", "Published"], dot: "bg-emerald-500" },
                ] as const
              ).map((col) => {
                const colItems = filteredFeed.filter((p) =>
                  (col.statuses as readonly string[]).includes(p.publishStatus),
                );
                return (
                  <div key={col.title} className="rounded-xl border border-zinc-200/80 bg-zinc-50/50 p-3.5 space-y-3">
                    <div className="flex items-center justify-between px-1">
                      <span className="flex items-center gap-2 text-xs font-semibold text-zinc-800">
                        <span className={`h-2 w-2 rounded-full ${col.dot}`} />
                        {col.title}
                      </span>
                      <span className="rounded-full bg-zinc-200/70 px-2 py-0.5 text-[11px] font-semibold text-zinc-700">
                        {colItems.length}
                      </span>
                    </div>

                    <div className="space-y-2.5 max-h-[540px] overflow-y-auto pr-0.5">
                      {colItems.map((p) => (
                        <div
                          key={p.id}
                          onClick={() => setEditingPost(p)}
                          className="rounded-xl border border-zinc-200/90 bg-white p-3.5 shadow-2xs hover:border-zinc-300 cursor-pointer transition space-y-2"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-zinc-900">
                              {p.cycle} · {p.contentName}
                            </span>
                            <span className="rounded bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-700">
                              {p.format}
                            </span>
                          </div>
                          <p className="text-xs font-medium text-zinc-800 line-clamp-2">
                            {p.topicTitle || `${p.format} — ${p.publishDate}`}
                          </p>
                          <div className="flex items-center justify-between text-[11px] text-zinc-400 font-code" dir="ltr">
                            <span>{p.day}, {p.publishDate}</span>
                            <span>{p.cairoTime}</span>
                          </div>
                          {p.clientComment && (
                            <p className="rounded bg-amber-50 border border-amber-200 px-2 py-1 text-[11px] text-amber-800">
                              ملاحظة العميل: {p.clientComment}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredFeed.map((p) => {
                const st = statusMeta(p.publishStatus);
                return (
                  <div key={p.id} className="ui-card p-5 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-zinc-900">
                          {p.cycle} · {p.contentName} ({p.format})
                        </span>
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
                          className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium cursor-pointer ${st.pill}`}
                        >
                          {PUBLISH_STATUSES.map((s) => (
                            <option key={s} value={s} className="bg-white text-zinc-900">{s}</option>
                          ))}
                        </select>
                      </div>
                      <p className="mt-2 text-xs font-code text-zinc-400" dir="ltr">
                        {p.day}, {p.publishDate} · {p.cairoTime}
                      </p>
                      <p className="mt-2 text-sm font-semibold text-zinc-900">
                        {p.topicTitle || "اضغط لتحديد عنوان الفكرة والكابشن"}
                      </p>
                    </div>
                    <div className="mt-4 pt-3 border-t border-zinc-100 flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => setEditingPost(p)}
                        className="brutal-btn-outline py-1.5 text-xs"
                      >
                        تعديل البوست والروابط
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── TAB 3: WEEKLY STORY DECK MANAGER (Instead of an 84-row spreadsheet) ── */}
      {activeTab === "stories" && (
        <div className="space-y-4 animate-fade-in">
          <div className="ui-card p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 overflow-x-auto">
              {storyWeeks.map((wk, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setStoryWeekIdx(idx)}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition ${
                    storyWeekIdx === idx
                      ? "bg-zinc-900 text-white"
                      : "bg-zinc-100 text-zinc-600 hover:text-zinc-900"
                  }`}
                >
                  الأسبوع {idx + 1} ({wk[0]?.publishDate.slice(0, 6)} – {wk[wk.length - 1]?.publishDate.slice(0, 6)})
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3.5">
            {activeWeekStories.map((s) => {
              const st = statusMeta(s.publishStatus);
              return (
                <div key={s.id} className="ui-card p-3.5 flex flex-col justify-between space-y-3">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-zinc-900">{s.storyId}</span>
                      <span className="text-[11px] font-code text-zinc-400">{s.day}</span>
                    </div>
                    <p className="text-[11px] font-code text-zinc-500 mt-0.5" dir="ltr">
                      {s.publishDate} · {s.cairoTime}
                    </p>
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
                      placeholder="موضوع الاستوري أو الرابط…"
                      className="brutal-input mt-2.5 py-1.5 text-xs"
                    />
                  </div>

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
                    className={`w-full rounded-lg border px-2 py-1 text-[11px] font-medium cursor-pointer ${st.pill}`}
                  >
                    {PUBLISH_STATUSES.map((stOpt) => (
                      <option key={stOpt} value={stOpt} className="bg-white text-zinc-900">
                        {stOpt}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── TAB 4: PRODUCTION ROADMAP STEPPER ── */}
      {activeTab === "timeline" && (
        <div className="ui-card p-6 space-y-4 animate-fade-in">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-zinc-900">خارطة طريق الإنتاج والاعتمادات</h2>
              <p className="text-xs text-zinc-500">اضغط على أي مرحلة لتعديل المواعيد أو إرفاق الروابط</p>
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
              className="brutal-btn text-xs"
            >
              + إضافة مرحلة
            </button>
          </div>

          <div className="divide-y divide-zinc-100">
            {filteredMilestones.map((m) => {
              const st = statusMeta(m.status);
              return (
                <div key={m.id} className="py-3.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                  <div className="space-y-1 max-w-2xl">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded bg-zinc-100 px-2 py-0.5 text-[11px] font-code font-semibold text-zinc-700">
                        {m.cycle}
                      </span>
                      <span className="text-sm font-semibold text-zinc-900">{m.milestone}</span>
                      <span className="rounded border border-zinc-200 px-2 py-0.5 text-[11px] text-zinc-600">
                        {m.owner}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-500">{m.notes}</p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <span className="text-xs font-code text-zinc-400" dir="ltr">
                      {m.startDate} → {m.endDate}
                    </span>
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
                      className={`rounded-full border px-2.5 py-1 text-[11px] font-medium cursor-pointer ${st.pill}`}
                    >
                      {MILESTONE_STATUSES.map((s) => (
                        <option key={s} value={s} className="bg-white text-zinc-900">{s}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setEditingMilestone(m)}
                      className="brutal-btn-outline px-2.5 py-1 text-xs"
                    >
                      تعديل
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── TAB 5: PAID MEDIA & CLIENT LOG ── */}
      {activeTab === "ads" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-fade-in">
          <div className="ui-card p-6 space-y-4">
            <h2 className="text-sm font-semibold text-zinc-900">حملات الإعلانات الممولة (Meta Ads)</h2>
            <div className="space-y-3">
              {draft.paidCampaigns.map((c: PaidMediaCampaignItem) => (
                <div key={c.id} className="rounded-xl border border-zinc-200/80 bg-zinc-50/50 p-4 space-y-2.5 text-xs">
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
                      className="brutal-input py-1.5 text-xs"
                    />
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
                      className="brutal-input py-1.5 text-xs font-code"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="ui-card p-6 space-y-4">
            <h2 className="text-sm font-semibold text-zinc-900">سجل اعتمادات العميل ({interactions.length})</h2>
            <div className="space-y-2.5 max-h-96 overflow-y-auto">
              {[...interactions].reverse().map((ev) => (
                <div key={ev.id} className="rounded-xl border border-zinc-200/80 bg-zinc-50/50 p-3 text-xs space-y-1">
                  <div className="flex justify-between text-[11px] text-zinc-400">
                    <strong className="text-zinc-800">{ev.actorName}</strong>
                    <span dir="ltr">{new Date(ev.createdAtIso).toLocaleString()}</span>
                  </div>
                  <p className="font-semibold text-zinc-900">{ev.targetLabel}</p>
                  {ev.comment && <p className="text-zinc-600">{ev.comment}</p>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── NATIVE <dialog> FOR EDITING POST ── */}
      <dialog
        ref={postDialogRef}
        aria-labelledby="edit-post-dialog-title"
        onClose={() => setEditingPost(null)}
        className="m-auto w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-6 text-zinc-900 shadow-2xl"
      >
        {editingPost && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 id="edit-post-dialog-title" className="text-base font-semibold">
                {editingPost.cycle} · {editingPost.contentName}
              </h2>
              <button type="button" onClick={() => setEditingPost(null)} className="text-zinc-400 hover:text-zinc-700 cursor-pointer">
                ✕
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-medium text-zinc-700 mb-1">Format</label>
                <select
                  value={editingPost.format}
                  onChange={(e) => setEditingPost({ ...editingPost, format: e.target.value as FeedPostItem["format"] })}
                  className="brutal-input text-xs"
                >
                  <option value="Post">Post</option>
                  <option value="Reel">Reel</option>
                  <option value="Carousel">Carousel</option>
                </select>
              </div>
              <div>
                <label className="block font-medium text-zinc-700 mb-1">Status</label>
                <select
                  value={editingPost.publishStatus}
                  onChange={(e) => setEditingPost({ ...editingPost, publishStatus: e.target.value as PublishStatus })}
                  className="brutal-input text-xs"
                >
                  {PUBLISH_STATUSES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1">عنوان الفكرة</label>
              <input
                type="text"
                value={editingPost.topicTitle || ""}
                onChange={(e) => setEditingPost({ ...editingPost, topicTitle: e.target.value })}
                className="brutal-input text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1">الكابشن</label>
              <textarea
                rows={3}
                value={editingPost.captionText || ""}
                onChange={(e) => setEditingPost({ ...editingPost, captionText: e.target.value })}
                className="brutal-input text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1">رابط التصميم / الفيديو (Drive / Canva)</label>
              <input
                type="url"
                value={editingPost.assetLink || ""}
                onChange={(e) => setEditingPost({ ...editingPost, assetLink: e.target.value })}
                dir="ltr"
                className="brutal-input text-xs"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setEditingPost(null)} className="brutal-btn-outline">
                إغلاق
              </button>
              <button
                type="button"
                onClick={() => {
                  const next = {
                    ...draft,
                    feedCalendar: draft.feedCalendar.map((x) => (x.id === editingPost.id ? editingPost : x)),
                  };
                  setDraft(next);
                  setEditingPost(null);
                  void handleSavePortal(next);
                }}
                className="brutal-btn"
              >
                حفظ ومزامنة
              </button>
            </div>
          </div>
        )}
      </dialog>

      {/* ── NATIVE <dialog> FOR EDITING MILESTONE ── */}
      <dialog
        ref={milestoneDialogRef}
        aria-labelledby="edit-ms-dialog-title"
        onClose={() => setEditingMilestone(null)}
        className="m-auto w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-6 text-zinc-900 shadow-2xl"
      >
        {editingMilestone && (
          <div className="space-y-4">
            <h2 id="edit-ms-dialog-title" className="text-base font-semibold">
              {editingMilestone.milestone}
            </h2>
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1">رابط الملفات / الإثبات</label>
              <input
                type="url"
                value={editingMilestone.linkEvidence}
                onChange={(e) => setEditingMilestone({ ...editingMilestone, linkEvidence: e.target.value })}
                dir="ltr"
                className="brutal-input text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1">الملاحظات</label>
              <textarea
                rows={3}
                value={editingMilestone.notes}
                onChange={(e) => setEditingMilestone({ ...editingMilestone, notes: e.target.value })}
                className="brutal-input text-xs"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setEditingMilestone(null)} className="brutal-btn-outline">
                إغلاق
              </button>
              <button
                type="button"
                onClick={() => {
                  const next = {
                    ...draft,
                    milestones: draft.milestones.map((x) => (x.id === editingMilestone.id ? editingMilestone : x)),
                  };
                  setDraft(next);
                  setEditingMilestone(null);
                  void handleSavePortal(next);
                }}
                className="brutal-btn"
              >
                حفظ ومزامنة
              </button>
            </div>
          </div>
        )}
      </dialog>

      {/* ── NATIVE <dialog> FOR NEW CLIENT ── */}
      <dialog
        ref={newClientDialogRef}
        aria-labelledby="new-client-dialog-title"
        onClose={() => setNewClientModal(false)}
        className="m-auto w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 text-zinc-900 shadow-2xl"
      >
        <form onSubmit={handleCreateNewClient} className="space-y-3.5 text-xs">
          <h2 id="new-client-dialog-title" className="text-base font-semibold">
            إضافة بوابة عميل جديدة
          </h2>
          <div>
            <label className="block font-medium text-zinc-700 mb-1">اسم العميل</label>
            <input
              type="text"
              required
              value={newClientName}
              onChange={(e) => setNewClientName(e.target.value)}
              className="brutal-input text-xs"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-zinc-700 mb-1">كود الدخول</label>
              <input
                type="text"
                required
                value={newClientCode}
                onChange={(e) => setNewClientCode(e.target.value.toUpperCase())}
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
                dir="ltr"
                className="brutal-input text-xs font-code"
              />
            </div>
          </div>
          <div>
            <label className="block font-medium text-zinc-700 mb-1">رابط Google Sheet (اختياري)</label>
            <input
              type="url"
              value={newClientSheetUrl}
              onChange={(e) => setNewClientSheetUrl(e.target.value)}
              dir="ltr"
              className="brutal-input text-xs font-code"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setNewClientModal(false)} className="brutal-btn-outline">
              إلغاء
            </button>
            <button type="submit" disabled={saving} className="brutal-btn">
              إنشاء البوابة
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
