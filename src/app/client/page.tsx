"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  applyClientInteractionsToPortal,
  recordClientPortalInteraction,
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
} from "@/lib/admin/clientPortalTypes";

type PortalTab = "overview" | "timeline" | "feed" | "stories" | "ads";

const SESSION_KEY = "mft_client_portal_session_v1";

function Icon({ d, className = "h-[18px] w-[18px]" }: { d: string; className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

const ICONS = {
  overview: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6",
  timeline: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4",
  feed: "M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z",
  stories: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
  ads: "M13 7h8m0 0v8m0-8l-8 8-4-4-6 6",
  check: "M5 13l4 4L19 7",
  sparkles: "M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z",
  calendar: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
  folder: "M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z",
  sun: "M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z",
  moon: "M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z",
};

const TONES = {
  red: { bg: "bg-red-50", fg: "text-red-600", bar: "bg-red-500" },
  blue: { bg: "bg-blue-50", fg: "text-blue-600", bar: "bg-blue-500" },
  amber: { bg: "bg-amber-50", fg: "text-amber-600", bar: "bg-amber-500" },
  emerald: { bg: "bg-emerald-50", fg: "text-emerald-600", bar: "bg-emerald-500" },
  violet: { bg: "bg-violet-50", fg: "text-violet-600", bar: "bg-violet-500" },
  sky: { bg: "bg-sky-50", fg: "text-sky-600", bar: "bg-sky-500" },
} as const;
type Tone = keyof typeof TONES;

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

function ownerPillClass(owner: string): string {
  const o = owner.toLowerCase();
  if (o.includes("arc")) {
    return "border-red-200 bg-red-50 text-red-700";
  }
  if (o.includes("media")) {
    return "border-violet-200 bg-violet-50 text-violet-700";
  }
  return "border-zinc-200 bg-zinc-100 text-zinc-700";
}

function KpiCard({
  label,
  value,
  sub,
  icon,
  tone,
  onClick,
  alert,
}: {
  label: string;
  value: string | number;
  sub: string;
  icon: string;
  tone: Tone;
  onClick?: () => void;
  alert?: boolean;
}) {
  const t = TONES[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`ui-card ui-card-hover group relative block w-full text-left rtl:text-right p-4 cursor-pointer ${
        alert ? "ring-1 ring-amber-300" : ""
      }`}
    >
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
    </button>
  );
}

/** SVG Multi-Segment Donut Chart (matches MFT Admin clean aesthetic) */
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
  const radius = 50;
  const circumference = 2 * Math.PI * radius;
  let cumulative = 0;

  return (
    <div className="flex flex-col sm:flex-row items-center gap-6">
      <div className="relative h-36 w-36 shrink-0">
        <svg viewBox="0 0 120 120" className="h-36 w-36 -rotate-90">
          <circle cx="60" cy="60" r={radius} fill="none" stroke="#e4e4e7" strokeWidth="14" className=" opacity-40" />
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
                strokeLinecap="butt"
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

function ClientPortalInner() {
  const searchParams = useSearchParams();
  const [lang, setLang] = useState<"ar" | "en">("ar");
  const isAr = lang === "ar";
  const t = (ar: string, en: string) => (isAr ? ar : en);

  // Theme state matching mft-admin
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    const saved = localStorage.getItem("mft.theme") || "light";
    const dark = saved === "dark";
    setIsDark(dark);
    document.documentElement.classList.toggle("dark", dark);
  }, []);
  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    localStorage.setItem("mft.theme", next ? "dark" : "light");
    document.documentElement.classList.toggle("dark", next);
  };

  // Layout sidebar state matching mft-admin
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const [portalsMap, setPortalsMap] = useState<Record<string, ClientRolloutPortal>>({
    [ARC_DEFAULT_PORTAL.id]: ARC_DEFAULT_PORTAL,
  });
  const [activePortalId, setActivePortalId] = useState<string | null>(null);
  const [interactions, setInteractions] = useState<ClientPortalInteraction[]>([]);

  // Login Form State
  const [loginCode, setLoginCode] = useState("");
  const [loginPin, setLoginPin] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [clientActorName, setClientActorName] = useState("");
  const [loginError, setLoginError] = useState("");

  // Navigation & Filters
  const [activeTab, setActiveTab] = useState<PortalTab>("overview");
  const [selectedCycle, setSelectedCycle] = useState<string>("all");
  const [feedViewMode, setFeedViewMode] = useState<"grid" | "table">("grid");
  const [feedFormatFilter, setFeedFormatFilter] = useState<string>("all");
  const [feedStatusFilter, setFeedStatusFilter] = useState<string>("all");
  const [storyStatusFilter, setStoryStatusFilter] = useState<string>("all");
  const [timelineOwnerFilter, setTimelineOwnerFilter] = useState<string>("all");

  // Interactive Modals
  const [actionModal, setActionModal] = useState<{
    mode: "milestone_assets" | "milestone_note" | "post_revision" | "story_revision";
    targetId: string;
    targetLabel: string;
  } | null>(null);
  const [modalLink, setModalLink] = useState("");
  const [modalComment, setModalComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Sign-off form state
  const [localChecks, setLocalChecks] = useState<Record<string, boolean>>({});
  const [assetContactName, setAssetContactName] = useState("");
  const [assetContactPhone, setAssetContactPhone] = useState("");
  const [approverName, setApproverName] = useState("");
  const [approverTitle, setApproverTitle] = useState("");
  const [generalComment, setGeneralComment] = useState("");

  // Cairo live time
  const [cairoTimeStr, setCairoTimeStr] = useState("");
  useEffect(() => {
    const updateClock = () => {
      try {
        setCairoTimeStr(
          new Date().toLocaleTimeString("en-US", {
            timeZone: "Africa/Cairo",
            hour: "2-digit",
            minute: "2-digit",
          }),
        );
      } catch {
        setCairoTimeStr(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
      }
    };
    updateClock();
    const id = setInterval(updateClock, 30_000);
    return () => clearInterval(id);
  }, []);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 4500);
  };

  useEffect(() => {
    return subscribeClientPortals((map) => {
      setPortalsMap(map);
    });
  }, []);

  useEffect(() => {
    const qCode = (searchParams.get("code") || searchParams.get("client") || "").trim().toUpperCase();
    const qPin = (searchParams.get("pin") || "").trim();

    if (qCode) {
      const matched = Object.values(portalsMap).find(
        (p) => p.clientCode.toUpperCase() === qCode || p.id.toUpperCase() === qCode,
      );
      if (matched && (!qPin || matched.accessPin === qPin)) {
        setActivePortalId(matched.id);
        setClientActorName(matched.clientApproverName || matched.clientName);
        try {
          localStorage.setItem(
            SESSION_KEY,
            JSON.stringify({ portalId: matched.id, actorName: matched.clientName }),
          );
        } catch {
          /* ignore */
        }
        return;
      }
      setLoginCode(qCode);
      if (qPin) setLoginPin(qPin);
    }

    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { portalId?: string; actorName?: string };
        if (parsed.portalId && portalsMap[parsed.portalId]) {
          setActivePortalId(parsed.portalId);
          setClientActorName(parsed.actorName || portalsMap[parsed.portalId]!.clientName);
        }
      }
    } catch {
      /* ignore */
    }
  }, [searchParams, portalsMap]);

  useEffect(() => {
    if (!activePortalId) return;
    return subscribePortalInteractions(activePortalId, setInteractions);
  }, [activePortalId]);

  const portal = useMemo(() => {
    if (!activePortalId) return null;
    const base = portalsMap[activePortalId] || ARC_DEFAULT_PORTAL;
    return applyClientInteractionsToPortal(base, interactions);
  }, [activePortalId, portalsMap, interactions]);

  useEffect(() => {
    if (!portal) return;
    if (!assetContactName && portal.clientAssetContactName) setAssetContactName(portal.clientAssetContactName);
    if (!assetContactPhone && portal.clientAssetContactPhone) setAssetContactPhone(portal.clientAssetContactPhone);
    if (!approverName && portal.clientApproverName) setApproverName(portal.clientApproverName);
    if (!approverTitle && portal.clientApproverTitle) setApproverTitle(portal.clientApproverTitle);
    const chkMap: Record<string, boolean> = {};
    for (const c of portal.signOffChecklist) {
      chkMap[c.id] = c.confirmed;
    }
    setLocalChecks((prev) => ({ ...chkMap, ...prev }));
  }, [portal, assetContactName, assetContactPhone, approverName, approverTitle]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError("");
    const code = loginCode.trim().toUpperCase();
    const pin = loginPin.trim();
    const matched = Object.values(portalsMap).find(
      (p) =>
        (p.clientCode.toUpperCase() === code || p.id.toUpperCase() === code) &&
        p.accessPin === pin,
    );
    if (!matched) {
      setLoginError(
        t(
          "كود العميل أو الرقم السري غير صحيح. جرب مثلاً: الكود ARC والرقم السري 2026",
          "Invalid Client Code or PIN. Try Code: ARC and PIN: 2026",
        ),
      );
      return;
    }
    const actor = clientActorName.trim() || matched.clientName;
    setActivePortalId(matched.id);
    setClientActorName(actor);
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ portalId: matched.id, actorName: actor }));
    } catch {
      /* ignore */
    }
  };

  const handleLogout = () => {
    setActivePortalId(null);
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
  };

  const stats = useMemo(() => {
    if (!portal) {
      return {
        msDone: 0,
        msTotal: 0,
        clientPendingMs: [] as MilestoneItem[],
        feedApprovedOrPublished: 0,
        feedTotal: 0,
        feedReadyForReview: [] as FeedPostItem[],
        feedRevisions: 0,
        feedDrafts: 0,
        reelsCount: 0,
        postsCount: 0,
        storiesApprovedOrPublished: 0,
        storiesTotal: 0,
        overallPct: 0,
        cycleBreakdown: [] as Array<{
          name: string;
          startDate: string;
          endDate: string;
          msPct: number;
          feedPct: number;
          storyPct: number;
          msDone: number;
          msTotal: number;
          feedDone: number;
          feedTotal: number;
          storyDone: number;
          storyTotal: number;
        }>,
      };
    }
    const msDone = portal.milestones.filter((m) => m.status === "Done").length;
    const msTotal = portal.milestones.length;
    const clientPendingMs = portal.milestones.filter(
      (m) => m.owner.toLowerCase().includes("arc") && m.status !== "Done",
    );

    const feedApprovedOrPublished = portal.feedCalendar.filter((f) =>
      ["Approved", "Scheduled", "Published"].includes(f.publishStatus),
    ).length;
    const feedTotal = portal.feedCalendar.length;
    const feedReadyForReview = portal.feedCalendar.filter((f) => f.publishStatus === "Ready for Review");
    const feedRevisions = portal.feedCalendar.filter((f) => f.publishStatus === "Revision Requested").length;
    const feedDrafts = portal.feedCalendar.filter((f) => f.publishStatus === "Draft").length;
    const reelsCount = portal.feedCalendar.filter((f) => f.format === "Reel").length;
    const postsCount = feedTotal - reelsCount;

    const storiesApprovedOrPublished = portal.dailyStories.filter((s) =>
      ["Approved", "Scheduled", "Published"].includes(s.publishStatus),
    ).length;
    const storiesTotal = portal.dailyStories.length;

    const totalItems = msTotal + feedTotal + storiesTotal;
    const completedItems = msDone + feedApprovedOrPublished + storiesApprovedOrPublished;
    const overallPct = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;

    const cycleBreakdown = portal.cycles.map((c) => {
      const cMs = portal.milestones.filter((m) => m.cycle === c.name);
      const cMsDone = cMs.filter((m) => m.status === "Done").length;
      const cFeed = portal.feedCalendar.filter((f) => f.cycle === c.name);
      const cFeedDone = cFeed.filter((f) =>
        ["Approved", "Scheduled", "Published"].includes(f.publishStatus),
      ).length;
      const cStories = portal.dailyStories.filter((s) => s.cycle === c.name);
      const cStoryDone = cStories.filter((s) =>
        ["Approved", "Scheduled", "Published"].includes(s.publishStatus),
      ).length;
      return {
        name: c.name,
        startDate: c.startDate,
        endDate: c.endDate,
        msDone: cMsDone,
        msTotal: cMs.length,
        msPct: cMs.length ? Math.round((cMsDone / cMs.length) * 100) : 0,
        feedDone: cFeedDone,
        feedTotal: cFeed.length,
        feedPct: cFeed.length ? Math.round((cFeedDone / cFeed.length) * 100) : 0,
        storyDone: cStoryDone,
        storyTotal: cStories.length,
        storyPct: cStories.length ? Math.round((cStoryDone / cStories.length) * 100) : 0,
      };
    });

    return {
      msDone,
      msTotal,
      clientPendingMs,
      feedApprovedOrPublished,
      feedTotal,
      feedReadyForReview,
      feedRevisions,
      feedDrafts,
      reelsCount,
      postsCount,
      storiesApprovedOrPublished,
      storiesTotal,
      overallPct,
      cycleBreakdown,
    };
  }, [portal]);

  const filteredMilestones = useMemo(() => {
    if (!portal) return [];
    return portal.milestones.filter((m) => {
      if (selectedCycle !== "all" && m.cycle !== selectedCycle) return false;
      if (timelineOwnerFilter === "client" && !m.owner.toLowerCase().includes("arc")) return false;
      if (timelineOwnerFilter === "agency" && m.owner.toLowerCase().includes("arc")) return false;
      return true;
    });
  }, [portal, selectedCycle, timelineOwnerFilter]);

  const filteredFeed = useMemo(() => {
    if (!portal) return [];
    return portal.feedCalendar.filter((f) => {
      if (selectedCycle !== "all" && f.cycle !== selectedCycle) return false;
      if (feedFormatFilter !== "all" && f.format.toLowerCase() !== feedFormatFilter) return false;
      if (feedStatusFilter !== "all" && f.publishStatus !== feedStatusFilter) return false;
      return true;
    });
  }, [portal, selectedCycle, feedFormatFilter, feedStatusFilter]);

  const filteredStories = useMemo(() => {
    if (!portal) return [];
    return portal.dailyStories.filter((s) => {
      if (selectedCycle !== "all" && s.cycle !== selectedCycle) return false;
      if (storyStatusFilter !== "all" && s.publishStatus !== storyStatusFilter) return false;
      return true;
    });
  }, [portal, selectedCycle, storyStatusFilter]);

  // Client Actions
  const handleApproveMilestone = async (m: MilestoneItem) => {
    if (!portal || submitting) return;
    setSubmitting(true);
    try {
      await recordClientPortalInteraction({
        portalId: portal.id,
        actorRole: "client",
        actorName: clientActorName || portal.clientName,
        actionType: "approve_milestone",
        targetId: m.id,
        targetLabel: `${m.cycle} — ${m.milestone}`,
        statusAfter: "Done",
      });
      showToast(t(`✅ تم اعتماد "${m.milestone}" وإبلاغ فريق الوكالة فوراً`, `✅ Approved "${m.milestone}" & notified agency`));
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprovePost = async (p: FeedPostItem) => {
    if (!portal || submitting) return;
    setSubmitting(true);
    try {
      await recordClientPortalInteraction({
        portalId: portal.id,
        actorRole: "client",
        actorName: clientActorName || portal.clientName,
        actionType: "approve_post",
        targetId: p.id,
        targetLabel: `${p.cycle} · ${p.contentName} (${p.publishDate})`,
        statusAfter: "Approved",
      });
      showToast(t(`✅ تم اعتماد ${p.contentName} (${p.publishDate})`, `✅ Approved ${p.contentName}`));
    } finally {
      setSubmitting(false);
    }
  };

  const handleBulkApproveCycleFeed = async (cycleName: string) => {
    if (!portal || submitting) return;
    setSubmitting(true);
    try {
      await recordClientPortalInteraction({
        portalId: portal.id,
        actorRole: "client",
        actorName: clientActorName || portal.clientName,
        actionType: "approve_cycle_feed",
        targetId: cycleName,
        targetLabel: `${cycleName} Full Feed Calendar`,
        statusAfter: "Approved",
      });
      showToast(
        t(
          `🎉 تم اعتماد جميع بوستات ${cycleName} بالكامل وإشعار الوكالة!`,
          `🎉 Approved all ${cycleName} feed posts!`,
        ),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleApproveStory = async (s: DailyStoryItem) => {
    if (!portal || submitting) return;
    setSubmitting(true);
    try {
      await recordClientPortalInteraction({
        portalId: portal.id,
        actorRole: "client",
        actorName: clientActorName || portal.clientName,
        actionType: "approve_story",
        targetId: s.id,
        targetLabel: `${s.cycle} · ${s.storyId} (${s.publishDate})`,
        statusAfter: "Approved",
      });
      showToast(t(`✅ تم اعتماد ${s.storyId} (${s.publishDate})`, `✅ Approved ${s.storyId}`));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitModalAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!portal || !actionModal || submitting) return;
    setSubmitting(true);
    try {
      if (actionModal.mode === "milestone_assets") {
        await recordClientPortalInteraction({
          portalId: portal.id,
          actorRole: "client",
          actorName: clientActorName || portal.clientName,
          actionType: "submit_assets",
          targetId: actionModal.targetId,
          targetLabel: actionModal.targetLabel,
          linkUrl: modalLink.trim(),
          comment: modalComment.trim(),
          statusAfter: "Done",
        });
        showToast(t("📁 تم إرسال رابط خامات المشروع واعتماد المرحلة بنجاح!", "📁 Project assets link submitted!"));
      } else if (actionModal.mode === "milestone_note") {
        await recordClientPortalInteraction({
          portalId: portal.id,
          actorRole: "client",
          actorName: clientActorName || portal.clientName,
          actionType: "comment",
          targetId: actionModal.targetId,
          targetLabel: actionModal.targetLabel,
          linkUrl: modalLink.trim() || undefined,
          comment: modalComment.trim(),
        });
        showToast(t("💬 تم إرسال ملاحظتك لفريق الوكالة!", "💬 Note sent to agency!"));
      } else if (actionModal.mode === "post_revision") {
        await recordClientPortalInteraction({
          portalId: portal.id,
          actorRole: "client",
          actorName: clientActorName || portal.clientName,
          actionType: "revision_post",
          targetId: actionModal.targetId,
          targetLabel: actionModal.targetLabel,
          comment: modalComment.trim(),
          statusAfter: "Revision Requested",
        });
        showToast(t("✏️ تم إرسال طلب التعديل على البوست للوكالة!", "✏️ Revision request sent!"));
      } else if (actionModal.mode === "story_revision") {
        await recordClientPortalInteraction({
          portalId: portal.id,
          actorRole: "client",
          actorName: clientActorName || portal.clientName,
          actionType: "revision_story",
          targetId: actionModal.targetId,
          targetLabel: actionModal.targetLabel,
          linkUrl: modalLink.trim() || undefined,
          comment: modalComment.trim(),
          statusAfter: "Revision Requested",
        });
        showToast(t("✏️ تم حفظ الملاحظة على الاستوري!", "✏️ Story note saved!"));
      }
      setActionModal(null);
      setModalLink("");
      setModalComment("");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignContract = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!portal || submitting) return;
    const allChecked = portal.signOffChecklist.every((c) => localChecks[c.id]);
    if (!allChecked) {
      showToast(
        t(
          "⚠ يرجى تحديد جميع بنود التأكيد الثلاثة قبل التوقيع والاعتماد.",
          "⚠ Please check all 3 confirmation items before signing.",
        ),
      );
      return;
    }
    const signer = approverName.trim() || clientActorName || portal.clientName;
    setSubmitting(true);
    try {
      await recordClientPortalInteraction({
        portalId: portal.id,
        actorRole: "client",
        actorName: signer,
        actionType: "sign_contract",
        targetLabel: portal.projectTitle,
        comment: `Signed by ${signer} (${approverTitle || "Authorized Approver"}) — Asset Contact: ${assetContactName || "—"} (${assetContactPhone || "—"})`,
        extraData: {
          assetContactName: assetContactName.trim(),
          assetContactPhone: assetContactPhone.trim(),
          approverName: signer,
          approverTitle: approverTitle.trim(),
        },
      });
      showToast(
        t(
          "🎉 تم اعتماد وتوقيع خطة العمل بنجاح وإشعار إدارة الوكالة!",
          "🎉 Rollout plan confirmed & signed!",
        ),
      );
    } finally {
      setSubmitting(false);
    }
  };

  // ── 1. CLIENT LOGIN SCREEN (Matches MFT Admin Split-Screen Design) ──
  if (!portal) {
    return (
      <div dir={isAr ? "rtl" : "ltr"} className="grid min-h-screen bg-[var(--mft-bg)] lg:grid-cols-2">
        {/* Brand Panel (Signature MFT Red-to-Zinc Gradient) */}
        <div className="relative hidden overflow-hidden bg-gradient-to-br from-zinc-900 via-zinc-900 to-red-950 p-12 text-white lg:flex lg:flex-col lg:justify-between">
          <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-red-600/30 blur-3xl" />
          <div className="pointer-events-none absolute bottom-0 left-0 h-72 w-72 rounded-full bg-red-500/10 blur-3xl" />
          <div className="relative flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-600 font-oswald text-lg font-bold shadow-lg shadow-red-900/40">
                M
              </div>
              <div>
                <span className="font-oswald text-xl font-bold tracking-wider">MFT</span>
                <span className="ms-2 rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-medium text-zinc-200">
                  Client Portal
                </span>
              </div>
            </div>
          </div>

          <div className="relative space-y-6">
            <h2 className="text-4xl font-semibold leading-tight tracking-tight">
              {t(
                "تابع خطة السوشيال ميديا، الكالندر، والاعتمادات من مكان واحد.",
                "Review your 3-month rollout, calendars and approvals in real time.",
              )}
            </h2>
            <p className="max-w-md text-sm text-zinc-300 leading-relaxed">
              {t(
                "بوابة تفاعلية مباشرة لعملاء وكالة MFT لمراجعة مراحل الإنتاج، اعتماد بوستات الـ Feed والـ Reels والـ Stories اليومية، ومتابعة تقارير الإعلانات الممولة.",
                "Interactive workspace for MFT Agency clients to track production milestones, approve feed posts & daily stories, and monitor Meta ad campaigns.",
              )}
            </p>
            <div className="grid grid-cols-3 gap-3 pt-2 max-w-md">
              <div className="rounded-xl bg-white/5 p-3 ring-1 ring-white/10">
                <p className="text-xl font-bold">3 Cycles</p>
                <p className="text-[11px] text-zinc-400">{t("خطة ٣ أشهر", "90-Day Plan")}</p>
              </div>
              <div className="rounded-xl bg-white/5 p-3 ring-1 ring-white/10">
                <p className="text-xl font-bold">36 Posts</p>
                <p className="text-[11px] text-zinc-400">Sun · Tue · Thu</p>
              </div>
              <div className="rounded-xl bg-white/5 p-3 ring-1 ring-white/10">
                <p className="text-xl font-bold">90 Stories</p>
                <p className="text-[11px] text-zinc-400">{t("يومياً 6:00 م", "Daily 6:00 PM")}</p>
              </div>
            </div>
          </div>

          <p className="relative text-xs text-zinc-400">
            © {new Date().getFullYear()} MFT Agency · Cairo Local Time ({cairoTimeStr || "GMT+2"})
          </p>
        </div>

        {/* Form Panel */}
        <div className="flex flex-col justify-between p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 lg:invisible">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-600 font-oswald text-lg font-bold text-white">
                M
              </div>
              <span className="font-oswald text-xl font-bold tracking-wider text-zinc-900">MFT</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleTheme}
                className="brutal-btn-outline px-3 py-1.5 text-xs normal-case"
              >
                <Icon d={isDark ? ICONS.sun : ICONS.moon} className="h-4 w-4" />
                {isDark ? t("نهاري", "Light") : t("ليلي", "Dark")}
              </button>
              <button
                type="button"
                onClick={() => setLang(isAr ? "en" : "ar")}
                className="brutal-btn-outline px-3 py-1.5 text-xs normal-case"
              >
                {isAr ? "English (EN)" : "العربية (AR)"}
              </button>
            </div>
          </div>

          <div className="mx-auto w-full max-w-sm animate-slide-up my-auto py-8">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-red-700">
              <span>✨</span>
              <span>{t("بوابة عملاء MFT", "MFT Client Rollout Portal")}</span>
            </span>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-900">
              {t("تسجيل دخول العميل", "Welcome to Client Portal")}
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              {t(
                "أدخل كود المشروع والرقم السري لفتح لوحة المتابعة والاعتمادات.",
                "Sign in with your Client Code and Access PIN.",
              )}
            </p>

            <form onSubmit={handleLogin} className="mt-7 space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-700">
                  {t("كود العميل / المشروع (Client Code)", "Client Code")}
                </label>
                <input
                  type="text"
                  required
                  value={loginCode}
                  onChange={(e) => setLoginCode(e.target.value)}
                  placeholder="ARC"
                  dir="ltr"
                  className="brutal-input h-11 font-code font-semibold uppercase tracking-wider"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-700">
                  {t("الرقم السري (Access PIN)", "Access PIN")}
                </label>
                <div className="relative">
                  <input
                    type={showPw ? "text" : "password"}
                    required
                    value={loginPin}
                    onChange={(e) => setLoginPin(e.target.value)}
                    placeholder="••••"
                    dir="ltr"
                    className="brutal-input h-11 pr-16 font-code tracking-widest"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 cursor-pointer"
                  >
                    {showPw ? t("إخفاء", "Hide") : t("إظهار", "Show")}
                  </button>
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-700">
                  {t("الاسم (لتسجيل الاعتمادات - اختياري)", "Your Name (optional)")}
                </label>
                <input
                  type="text"
                  value={clientActorName}
                  onChange={(e) => setClientActorName(e.target.value)}
                  placeholder={t("مثال: أ. أحمد — إدارة التسويق", "e.g. Marketing Director")}
                  className="brutal-input h-11"
                />
              </div>

              {loginError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs font-medium text-red-700">
                  {loginError}
                </div>
              )}

              <button
                type="submit"
                className="brutal-btn h-11 w-full text-sm normal-case tracking-normal"
              >
                {t("دخول إلى لوحة العميل", "Sign in to Client Portal")}
              </button>
            </form>

            {/* Quick Fill Demo Helper */}
            <div className="mt-6 ui-card p-3.5 flex items-center justify-between gap-2 bg-zinc-50/80">
              <div className="text-xs text-zinc-600">
                <span className="font-semibold text-zinc-900">ARC Rollout:</span>{" "}
                <code className="font-code font-bold text-red-600">ARC</code> / PIN{" "}
                <code className="font-code font-bold text-red-600">2026</code>
              </div>
              <button
                type="button"
                onClick={() => {
                  setLoginCode("ARC");
                  setLoginPin("2026");
                }}
                className="brutal-btn-outline px-2.5 py-1 text-[11px] normal-case"
              >
                {t("تعبئة تلقائية", "Quick Fill")}
              </button>
            </div>
          </div>

          <div className="text-center text-xs text-zinc-400">
            MFT Operations & Client Success Workspace
          </div>
        </div>
      </div>
    );
  }

  const navItems: Array<{ id: PortalTab; label: string; icon: string; badge?: number }> = [
    {
      id: "overview",
      label: t("نظرة عامة والإحصائيات", "Overview & Analytics"),
      icon: ICONS.overview,
      badge: !portal.contractSigned ? 1 : 0,
    },
    {
      id: "timeline",
      label: t("الجدول الزمني (Timeline)", "Master Timeline"),
      icon: ICONS.timeline,
      badge: stats.clientPendingMs.length,
    },
    {
      id: "feed",
      label: t("كالندر البوستات والـ Reels", "Feed & Reels Calendar"),
      icon: ICONS.feed,
      badge: stats.feedReadyForReview.length,
    },
    {
      id: "stories",
      label: t("الـ Stories اليومية", "Daily Stories (6 PM)"),
      icon: ICONS.stories,
    },
    {
      id: "ads",
      label: t("الإعلانات وسجل المتابعة", "Paid Media & Activity"),
      icon: ICONS.ads,
    },
  ];

  // ── 2. AUTHENTICATED CLIENT WORKSPACE (Exact MFT Admin Shell + Rich Charts) ──
  return (
    <div dir={isAr ? "rtl" : "ltr"} className="flex min-h-screen bg-[var(--mft-bg)] text-zinc-900">
      {/* Toast Notification */}
      {toastMsg && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-900 px-4 py-3 text-xs font-semibold text-white shadow-xl animate-toast-in">
          <span>{toastMsg}</span>
        </div>
      )}

      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-zinc-950/40 backdrop-blur-sm lg:hidden animate-fade-in"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* ── Left Sidebar (Matches MFT Admin Sidebar) ── */}
      <aside
        className={`fixed inset-y-0 start-0 z-40 flex h-screen flex-col border-e border-zinc-200 bg-white transition-all duration-200 lg:sticky ${
          mobileOpen
            ? "translate-x-0"
            : isAr
              ? "translate-x-full lg:translate-x-0"
              : "-translate-x-full lg:translate-x-0"
        } ${collapsed ? "w-64 lg:w-[72px]" : "w-64"}`}
      >
        {/* Brand */}
        <div className={`flex h-16 items-center gap-3 border-b border-zinc-100 px-4 ${collapsed ? "lg:justify-center lg:px-2" : ""}`}>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-red-500 to-red-700 font-oswald text-base font-bold text-white shadow-md shadow-red-600/25">
            {portal.clientCode.slice(0, 2)}
          </div>
          <div className={`min-w-0 ${collapsed ? "lg:hidden" : ""}`}>
            <p className="font-oswald text-lg font-bold leading-none tracking-wider text-zinc-900">
              {portal.clientName}
            </p>
            <p className="mt-0.5 truncate text-[11px] font-medium text-zinc-500">
              MFT Client Rollout Portal
            </p>
          </div>
        </div>

        {/* Cycle Quick Switcher inside Sidebar */}
        <div className={`px-3 pt-3 ${collapsed ? "lg:hidden" : ""}`}>
          <label className="mb-1 block px-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            {t("فلتر الدورة الشهرية", "Active Rollout Cycle")}
          </label>
          <select
            value={selectedCycle}
            onChange={(e) => setSelectedCycle(e.target.value)}
            className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-2 text-xs font-semibold text-zinc-800 focus:border-red-500 focus:outline-none"
          >
            <option value="all">{t("كل الدورات (3 شهور كاملة)", "All 3 Cycles (Full Rollout)")}</option>
            {portal.cycles.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name} ({c.startDate} – {c.endDate})
              </option>
            ))}
          </select>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          <p className={`mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400 ${collapsed ? "lg:hidden" : ""}`}>
            {t("أقسام الخطة", "Rollout Modules")}
          </p>
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveTab(item.id);
                  setMobileOpen(false);
                }}
                title={collapsed ? item.label : undefined}
                className={`group relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium transition-all cursor-pointer ${
                  isActive
                    ? "bg-red-50 text-red-700"
                    : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
                } ${collapsed ? "lg:justify-center lg:px-2" : ""}`}
              >
                {isActive && (
                  <span className="absolute start-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-e-full bg-red-600" />
                )}
                <Icon
                  d={item.icon}
                  className={`h-[18px] w-[18px] shrink-0 ${
                    isActive ? "text-red-600" : "text-zinc-400 group-hover:text-zinc-700"
                  }`}
                />
                <span className={`truncate ${collapsed ? "lg:hidden" : ""}`}>{item.label}</span>
                {item.badge && item.badge > 0 ? (
                  <span
                    className={`ms-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white ${
                      collapsed ? "lg:hidden" : ""
                    }`}
                  >
                    {item.badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>

        {/* Sidebar Footer */}
        <div className="border-t border-zinc-100 p-3 space-y-1">
          {portal.googleSheetUrl && !collapsed && (
            <a
              href={portal.googleSheetUrl}
              target="_blank"
              rel="noreferrer"
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
            >
              <Icon d={ICONS.calendar} className="h-4 w-4 text-emerald-600" />
              <span className="truncate">{t("فتح شيت جوجل الأصلي ↗", "Open Google Sheet ↗")}</span>
            </a>
          )}
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="hidden w-full items-center gap-3 rounded-lg px-3 py-2 text-xs font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 lg:flex cursor-pointer"
          >
            <Icon d="M11 19l-7-7 7-7m8 14l-7-7 7-7" className="h-4 w-4" />
            <span className={collapsed ? "lg:hidden" : ""}>{t("طي القائمة الجانبية", "Collapse sidebar")}</span>
          </button>
        </div>
      </aside>

      {/* ── Main Content Column ── */}
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        {/* Sticky Topbar (Matches MFT Admin Header) */}
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-zinc-200 bg-white/85 px-4 backdrop-blur-md md:px-6">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="rounded-lg p-2 text-zinc-600 hover:bg-zinc-100 lg:hidden cursor-pointer"
          >
            <Icon d="M4 6h16M4 12h16M4 18h16" className="h-5 w-5" />
          </button>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-400">
              <span>{portal.clientName}</span>
              <span>/</span>
              <span>{t("بوابة السوشيال ميديا", "Social Media Rollout")}</span>
            </div>
            <h1 className="truncate text-[15px] font-semibold text-zinc-900">
              {navItems.find((n) => n.id === activeTab)?.label}
            </h1>
          </div>

          {/* Cycle Pills on Desktop */}
          <div className="hidden xl:flex items-center gap-1 rounded-lg border border-zinc-200 bg-zinc-50 p-1">
            {[
              { key: "all", label: t("كل الدورات", "All Cycles") },
              ...portal.cycles.map((c) => ({ key: c.name, label: c.name })),
            ].map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setSelectedCycle(c.key)}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
                  selectedCycle === c.key
                    ? "bg-red-600 text-white shadow-xs"
                    : "text-zinc-600 hover:text-zinc-900"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>

          {/* Live Sync Indicator */}
          <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            {t(`مباشر · ${cairoTimeStr}`, `Live · ${cairoTimeStr}`)}
          </span>

          {/* Theme Switcher */}
          <button
            type="button"
            onClick={toggleTheme}
            title={t("تغيير المظهر", "Toggle Theme")}
            className="rounded-lg border border-zinc-200 bg-white p-2 text-zinc-600 hover:bg-zinc-100 cursor-pointer"
          >
            <Icon d={isDark ? ICONS.sun : ICONS.moon} className="h-4 w-4" />
          </button>

          {/* Language Switcher */}
          <button
            type="button"
            onClick={() => setLang(isAr ? "en" : "ar")}
            className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 cursor-pointer"
          >
            {isAr ? "EN" : "عربي"}
          </button>

          {/* Sign Out */}
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-600 hover:border-red-200 hover:bg-red-50 hover:text-red-600 cursor-pointer transition"
          >
            {t("خروج", "Sign out")}
          </button>
        </header>

        {/* ── Main Content Body ── */}
        <main className="mft-admin-content mx-auto w-full max-w-[1440px] flex-1 p-4 md:p-6 lg:p-8 space-y-6">
          {/* ── Signature MFT Hero Banner ── */}
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
                    {portal.contractSigned
                      ? t("✓ الخطة موقعة ومعتمدة رسمياً", "✓ Rollout Plan Signed & Confirmed")
                      : t("● مسودة جاهزة للمراجعة والاعتماد", "● Draft Ready for Review & Sign-Off")}
                  </span>
                  <span className="text-xs text-zinc-400">
                    {t(`مرحباً، ${clientActorName || portal.clientName}`, `Welcome, ${clientActorName || portal.clientName}`)}
                  </span>
                </div>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">
                  {portal.projectTitle}
                </h2>
                <p className="mt-1.5 max-w-2xl text-sm text-zinc-300">{portal.subtitle}</p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setActiveTab("feed")}
                  className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-red-900/40 transition-all hover:bg-red-500 cursor-pointer"
                >
                  <Icon d={ICONS.feed} className="h-4 w-4" />
                  {t(`مراجعة البوستات (${stats.feedReadyForReview.length} جاهز)`, `Review Feed (${stats.feedReadyForReview.length} Ready)`)}
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("timeline")}
                  className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2 text-xs font-semibold text-white ring-1 ring-white/15 backdrop-blur transition-all hover:bg-white/15 cursor-pointer"
                >
                  <Icon d={ICONS.timeline} className="h-4 w-4" />
                  {t("الجدول الزمني", "Master Timeline")}
                </button>
              </div>
            </div>

            {/* Hero Mini Strip */}
            <div className="relative mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                [t("نسبة الإنجاز الكلية", "Overall Progress"), `${stats.overallPct}%`],
                [t("مراحل مكتملة", "Milestones Done"), `${stats.msDone}/${stats.msTotal}`],
                [t("بوستات معتمدة / منشورة", "Feed Approved"), `${stats.feedApprovedOrPublished}/${stats.feedTotal}`],
                [t("استوريهات معتمدة", "Stories Approved"), `${stats.storiesApprovedOrPublished}/${stats.storiesTotal}`],
              ].map(([l, v]) => (
                <div key={l} className="rounded-xl bg-white/5 px-4 py-3 ring-1 ring-white/10">
                  <p className="text-[11px] text-zinc-400">{l}</p>
                  <p className="text-xl font-semibold tabular-nums mt-0.5">{v}</p>
                </div>
              ))}
            </div>
          </section>

          {/* ── 4 Interactive KPI Cards ── */}
          <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard
              label={t("مراحل بانتظار اعتمادك", "Awaiting Your Approval")}
              value={stats.clientPendingMs.length}
              sub={t(`من إجمالي ${stats.msTotal} مرحلة في الجدول`, `Out of ${stats.msTotal} timeline milestones`)}
              icon={ICONS.timeline}
              tone="amber"
              alert={stats.clientPendingMs.length > 0}
              onClick={() => {
                setTimelineOwnerFilter("client");
                setActiveTab("timeline");
              }}
            />
            <KpiCard
              label={t("بوستات جاهزة للمراجعة", "Posts Ready for Review")}
              value={stats.feedReadyForReview.length}
              sub={t(`${stats.reelsCount} Reels · ${stats.postsCount} Posts إجمالاً`, `${stats.reelsCount} Reels · ${stats.postsCount} Posts total`)}
              icon={ICONS.feed}
              tone="red"
              alert={stats.feedReadyForReview.length > 0}
              onClick={() => setActiveTab("feed")}
            />
            <KpiCard
              label={t("الـ Stories اليومية", "Daily Stories (6:00 PM)")}
              value={`${stats.storiesApprovedOrPublished}/${stats.storiesTotal}`}
              sub={t("تُنشر يومياً شاملة الجمعة والسبت", "Published daily including weekends")}
              icon={ICONS.stories}
              tone="blue"
              onClick={() => setActiveTab("stories")}
            />
            <KpiCard
              label={t("حالة اعتماد الخطة", "Rollout Sign-Off")}
              value={portal.contractSigned ? t("موقّعة ✓", "Signed ✓") : t("بانتظار التوقيع", "Pending Sign-Off")}
              sub={portal.contractSignedBy || t("اضغط لمراجعة البنود والتوقيع", "Click to confirm scope & sign")}
              icon={ICONS.check}
              tone="emerald"
              alert={!portal.contractSigned}
              onClick={() => setActiveTab("overview")}
            />
          </section>

          {/* ── TAB 1: OVERVIEW, ANALYTICS CHARTS, SCOPE & DIGITAL SIGN-OFF ── */}
          {activeTab === "overview" && (
            <div className="space-y-6">
              {/* Row of Visual Analytics Charts (Matches MFT Admin Chart Cards) */}
              <section className="grid gap-6 xl:grid-cols-3">
                {/* Chart 1: Multi-Cycle Progress & Deliverables Bar Chart */}
                <div className="ui-card p-5 xl:col-span-2">
                  <div className="mb-4 flex items-end justify-between gap-3">
                    <div>
                      <h3 className="text-[15px] font-semibold text-zinc-900">
                        {t("مقارنة تقدم الدورات الثلاث (Cycle 01 – Cycle 03)", "3-Month Rollout Progress by Cycle")}
                      </h3>
                      <p className="text-xs text-zinc-500">
                        {t("نسبة إنجاز المراحل، البوستات (١٢/دورة)، والـ Stories اليومية (٣٠/دورة)", "Milestones, Feed Posts (12/cycle) & Daily Stories (30/cycle)")}
                      </p>
                    </div>
                    <span className="text-xs font-medium text-red-600">36 Posts · 90 Stories</span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {stats.cycleBreakdown.map((c) => (
                      <div key={c.name} className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="rounded-md bg-zinc-900 px-2.5 py-1 text-xs font-bold text-white">
                            {c.name}
                          </span>
                          <span className="text-[11px] font-medium text-zinc-500" dir="ltr">
                            {c.startDate} – {c.endDate}
                          </span>
                        </div>

                        {/* 3 Vertical Visual Bars */}
                        <div className="flex h-32 items-end justify-around gap-3 pt-2 px-2">
                          {[
                            { label: t("المراحل", "Timeline"), pct: c.msPct, sub: `${c.msDone}/${c.msTotal}`, color: "from-red-600 to-red-400" },
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

                        <button
                          type="button"
                          onClick={() => {
                            setSelectedCycle(c.name);
                            setActiveTab("feed");
                          }}
                          className="w-full rounded-lg border border-zinc-200 bg-white py-1.5 text-xs font-semibold text-zinc-700 hover:border-red-300 hover:text-red-600 transition cursor-pointer"
                        >
                          {t(`فتح كالندر ${c.name} ←`, `Open ${c.name} Calendar →`)}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Chart 2: Content Approval Pipeline Donut Chart */}
                <div className="ui-card p-5 flex flex-col justify-between">
                  <div className="mb-4">
                    <h3 className="text-[15px] font-semibold text-zinc-900">
                      {t("توزيع حالات كالندر المحتوى", "Content Approval Pipeline")}
                    </h3>
                    <p className="text-xs text-zinc-500">
                      {t(`إجمالي ${stats.feedTotal} بوست و Reel عبر الـ ٣ دورات`, `${stats.feedTotal} Feed Posts & Reels across 3 cycles`)}
                    </p>
                  </div>

                  <SvgDonutChart
                    centerValue={`${Math.round((stats.feedApprovedOrPublished / Math.max(1, stats.feedTotal)) * 100)}%`}
                    centerLabel={t("معتمد", "Approved")}
                    segments={[
                      { label: t("معتمد / مجدول / منشور", "Approved & Published"), value: stats.feedApprovedOrPublished, color: "#10b981" },
                      { label: t("جاهز لمراجعة العميل", "Ready for Review"), value: stats.feedReadyForReview.length, color: "#f59e0b" },
                      { label: t("مطلوب تعديل", "Revision Requested"), value: stats.feedRevisions, color: "#ef4444" },
                      { label: t("قيد التجهيز (Draft)", "In Production / Draft"), value: stats.feedDrafts, color: "#71717a" },
                    ]}
                  />

                  <div className="mt-4 pt-3 border-t border-zinc-100 flex items-center justify-between text-xs text-zinc-500">
                    <span>🎬 {stats.reelsCount} Reels</span>
                    <span>🖼️ {stats.postsCount} Static Posts</span>
                    <span>📱 FB + IG</span>
                  </div>
                </div>
              </section>

              {/* Scope & Working Rules (Clean Admin-style Grid) */}
              <section className="ui-card p-6">
                <div className="mb-4 flex items-end justify-between">
                  <div>
                    <h3 className="text-[15px] font-semibold text-zinc-900">
                      {t("نطاق العمل وقواعد التشغيل (Scope & Working Rules)", "Scope & Working Rules")}
                    </h3>
                    <p className="text-xs text-zinc-500">
                      {t("القواعد المتفق عليها للإنتاج، التسليم، الاعتمادات، ومواعيد النشر بتوقيت القاهرة", "Agreed production, delivery, approval and publishing rules")}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {portal.scopeRules.map((rule) => (
                    <div
                      key={rule.id}
                      className="rounded-xl border border-zinc-200 bg-zinc-50/50 p-4 flex flex-col justify-between hover:border-zinc-300 transition"
                    >
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="rounded-md bg-red-50 border border-red-200 px-2.5 py-0.5 text-[11px] font-semibold text-red-700">
                            {rule.category}
                          </span>
                          <span className="text-xs font-semibold text-zinc-800">{rule.titleAr}</span>
                        </div>
                        <p className="mt-2.5 text-xs text-zinc-700 leading-relaxed">
                          {isAr ? rule.descriptionAr : rule.descriptionEn}
                        </p>
                        <p className="mt-1.5 text-[11px] text-zinc-400 leading-relaxed" dir="ltr">
                          {isAr ? rule.descriptionEn : rule.descriptionAr}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Confirm Before Signing (Interactive Sign-Off Card) */}
              <section className="ui-card p-6 border-red-200">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-red-600">
                      Confirm Before Signing
                    </span>
                    <h3 className="text-base font-semibold text-zinc-900 mt-0.5">
                      {t("بنود التأكيد والاعتماد الرسمي قبل بدء التنفيذ", "Pre-Signing Confirmation & Authorized Contacts")}
                    </h3>
                  </div>
                  {portal.contractSigned && (
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3.5 py-1.5 text-xs font-semibold text-emerald-700">
                      ✅ {t(`تم التوقيع بواسطة: ${portal.contractSignedBy}`, `Signed by ${portal.contractSignedBy}`)}
                    </span>
                  )}
                </div>

                <form onSubmit={handleSignContract} className="space-y-4">
                  <div className="space-y-2.5">
                    {portal.signOffChecklist.map((item, idx) => {
                      const checked = Boolean(localChecks[item.id]);
                      return (
                        <label
                          key={item.id}
                          className={`flex items-start gap-3 rounded-xl border p-4 cursor-pointer transition ${
                            checked
                              ? "border-emerald-300 bg-emerald-50/50"
                              : "border-zinc-200 bg-zinc-50/50 hover:border-zinc-300"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) =>
                              setLocalChecks((prev) => ({ ...prev, [item.id]: e.target.checked }))
                            }
                            className="mft-check mt-0.5"
                          />
                          <div className="flex-1 text-xs">
                            <p className="font-semibold text-zinc-900 leading-relaxed">
                              {idx + 1}. {isAr ? item.textAr : item.textEn}
                            </p>
                            <p className="mt-1 text-[11px] text-zinc-500" dir="ltr">
                              {isAr ? item.textEn : item.textAr}
                            </p>
                          </div>
                        </label>
                      );
                    })}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2">
                    <div>
                      <label className="block text-xs font-medium text-zinc-700 mb-1">
                        {t("مسؤول تسليم الخامات (Asset Contact)", "Asset Contact Name")}
                      </label>
                      <input
                        type="text"
                        value={assetContactName}
                        onChange={(e) => setAssetContactName(e.target.value)}
                        placeholder={t("الاسم الكامل", "Full Name")}
                        className="brutal-input text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-700 mb-1">
                        {t("رقم واتساب مسؤول الخامات", "Asset Contact WhatsApp")}
                      </label>
                      <input
                        type="text"
                        value={assetContactPhone}
                        onChange={(e) => setAssetContactPhone(e.target.value)}
                        placeholder="+20 1..."
                        dir="ltr"
                        className="brutal-input text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-700 mb-1">
                        {t("المسؤول المعتمد للموافقات (Approver)", "Authorized Approver Name")}
                      </label>
                      <input
                        type="text"
                        value={approverName}
                        onChange={(e) => setApproverName(e.target.value)}
                        placeholder={t("اسم المسؤول المعتمد", "Approver Name")}
                        className="brutal-input text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-700 mb-1">
                        {t("المسمى الوظيفي", "Job Title")}
                      </label>
                      <input
                        type="text"
                        value={approverTitle}
                        onChange={(e) => setApproverTitle(e.target.value)}
                        placeholder={t("مثال: مدير التسويق", "e.g. Marketing Director")}
                        className="brutal-input text-xs"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                    <p className="text-xs text-zinc-500">
                      {t(
                        "بمجرد الضغط على اعتماد، يتم حفظ التوقيع رسمياً وإرسال إشعار فوري لفريق الوكالة.",
                        "Submitting records your official sign-off and notifies the agency team.",
                      )}
                    </p>
                    <button type="submit" disabled={submitting} className="brutal-btn px-6 py-2.5 text-xs normal-case">
                      ✍️ {t("اعتماد وتوقيع خطة العمل", "Confirm & Sign Rollout Plan")}
                    </button>
                  </div>
                </form>
              </section>
            </div>
          )}

          {/* ── TAB 2: MASTER TIMELINE ── */}
          {activeTab === "timeline" && (
            <section className="ui-card p-6 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-zinc-900">
                    {t("الجدول الزمني الرئيسي والاعتمادات (Master Timeline)", "Master Production & Approval Timeline")}
                  </h2>
                  <p className="text-xs text-zinc-500">
                    {t("اضغط اعتماد أمام أي مرحلة مطلوبة من العميل أو أرفق رابط الخامات مباشرة", "Approve client milestones or attach project asset links in one click")}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {[
                    { id: "all", label: t("الكل", "All") },
                    { id: "client", label: t(`مطلوب من ${portal.clientName} (${stats.clientPendingMs.length})`, `${portal.clientName} Actions (${stats.clientPendingMs.length})`) },
                    { id: "agency", label: t("مهام الوكالة", "Agency Tasks") },
                  ].map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setTimelineOwnerFilter(f.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition ${
                        timelineOwnerFilter === f.id
                          ? "bg-red-600 text-white"
                          : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border border-zinc-200">
                <table className="w-full text-xs text-left rtl:text-right">
                  <thead className="bg-zinc-50 text-zinc-500 uppercase text-[11px] border-b border-zinc-200">
                    <tr>
                      <th className="px-4 py-3">{t("الدورة", "Cycle")}</th>
                      <th className="px-4 py-3">{t("المرحلة", "Milestone")}</th>
                      <th className="px-4 py-3">{t("المسؤول", "Owner")}</th>
                      <th className="px-4 py-3">{t("الموعد المخطط", "Planned Dates")}</th>
                      <th className="px-4 py-3">{t("التاريخ الفعلي", "Actual Date")}</th>
                      <th className="px-4 py-3">{t("الحالة", "Status")}</th>
                      <th className="px-4 py-3">{t("التفاصيل والروابط", "Details & Links")}</th>
                      <th className="px-4 py-3">{t("إجراء العميل", "Action")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {filteredMilestones.map((m) => {
                      const isClientOwner = m.owner.toLowerCase().includes("arc");
                      const isAssetsRow = m.milestone.toLowerCase().includes("asset");
                      return (
                        <tr key={m.id} className="hover:bg-zinc-50/80 transition">
                          <td className="px-4 py-3.5 font-semibold text-zinc-900 whitespace-nowrap">
                            {m.monthHeader && (
                              <div className="text-[10px] font-bold text-red-600 mb-0.5">{m.monthHeader}</div>
                            )}
                            {m.cycle}
                          </td>
                          <td className="px-4 py-3.5 font-semibold text-zinc-900">{m.milestone}</td>
                          <td className="px-4 py-3.5 whitespace-nowrap">
                            <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${ownerPillClass(m.owner)}`}>
                              {m.owner}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 text-zinc-600 whitespace-nowrap" dir="ltr">
                            {m.startDate} {m.endDate && m.endDate !== m.startDate ? `→ ${m.endDate}` : ""}
                          </td>
                          <td className="px-4 py-3.5 font-semibold text-emerald-600 whitespace-nowrap" dir="ltr">
                            {m.actualDate || "—"}
                          </td>
                          <td className="px-4 py-3.5 whitespace-nowrap">
                            <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${statusPillClass(m.status)}`}>
                              {m.status}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 max-w-xs">
                            <p className="text-zinc-600 leading-relaxed">{m.notes}</p>
                            {m.linkEvidence && (
                              <a
                                href={m.linkEvidence}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-red-600 hover:underline"
                              >
                                🔗 {t("فتح الملفات / الرابط المرفق ↗", "Open Attached Link ↗")}
                              </a>
                            )}
                            {m.clientComment && (
                              <p className="mt-1 text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1">
                                💬 {m.clientComment}
                              </p>
                            )}
                          </td>
                          <td className="px-4 py-3.5 whitespace-nowrap">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {isClientOwner && m.status !== "Done" && (
                                <button
                                  type="button"
                                  onClick={() => void handleApproveMilestone(m)}
                                  disabled={submitting}
                                  className="rounded-lg bg-emerald-600 hover:bg-emerald-700 px-3 py-1.5 text-[11px] font-semibold text-white cursor-pointer transition"
                                >
                                  ✅ {t("اعتماد المرحلة", "Approve")}
                                </button>
                              )}
                              {isAssetsRow && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setModalLink(m.linkEvidence || "");
                                    setModalComment(m.clientComment || "");
                                    setActionModal({
                                      mode: "milestone_assets",
                                      targetId: m.id,
                                      targetLabel: `${m.cycle} — ${m.milestone}`,
                                    });
                                  }}
                                  className="brutal-btn-outline px-2.5 py-1 text-[11px] normal-case"
                                >
                                  📁 {t("إرفاق خامات", "Submit Assets")}
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => {
                                  setModalLink(m.linkEvidence || "");
                                  setModalComment(m.clientComment || "");
                                  setActionModal({
                                    mode: "milestone_note",
                                    targetId: m.id,
                                    targetLabel: `${m.cycle} — ${m.milestone}`,
                                  });
                                }}
                                className="rounded-lg border border-zinc-200 bg-zinc-50 hover:bg-zinc-100 px-2.5 py-1 text-[11px] font-medium text-zinc-700 cursor-pointer"
                              >
                                💬 {t("ملاحظة", "Note")}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* ── TAB 3: FEED CALENDAR ── */}
          {activeTab === "feed" && (
            <section className="ui-card p-6 space-y-5">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div>
                  <h2 className="text-base font-semibold text-zinc-900">
                    {t(
                      `جدول بوستات الـ Feed والـ Reels (${filteredFeed.length})`,
                      `Feed Content Calendar (${filteredFeed.length} Posts & Reels)`,
                    )}
                  </h2>
                  <p className="text-xs text-zinc-500">
                    {t("النشر أيام الأحد والثلاثاء والخميس الساعة 7:00 مساءً بتوقيت القاهرة على فيسبوك وإنستجرام", "Published every Sunday, Tuesday & Thursday at 7:00 PM Cairo time on FB + IG")}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {/* Format Filter */}
                  <div className="flex items-center rounded-lg border border-zinc-200 bg-zinc-50 p-1">
                    {[
                      { id: "all", label: t("الكل", "All") },
                      { id: "reel", label: "🎬 Reels" },
                      { id: "post", label: "🖼️ Posts" },
                    ].map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setFeedFormatFilter(f.id)}
                        className={`px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer transition ${
                          feedFormatFilter === f.id ? "bg-red-600 text-white" : "text-zinc-600 hover:text-zinc-900"
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>

                  {/* Status Filter */}
                  <select
                    value={feedStatusFilter}
                    onChange={(e) => setFeedStatusFilter(e.target.value)}
                    className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700"
                  >
                    <option value="all">{t("كل الحالات", "All Statuses")}</option>
                    <option value="Ready for Review">{t("جاهز للمراجعة", "Ready for Review")}</option>
                    <option value="Approved">{t("معتمد", "Approved")}</option>
                    <option value="Revision Requested">{t("مطلوب تعديل", "Revision Requested")}</option>
                    <option value="Draft">{t("مسودة", "Draft")}</option>
                    <option value="Published">{t("منشور", "Published")}</option>
                  </select>

                  {/* View Mode Switcher */}
                  <div className="flex items-center rounded-lg border border-zinc-200 bg-zinc-50 p-1">
                    <button
                      type="button"
                      onClick={() => setFeedViewMode("grid")}
                      className={`px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer ${
                        feedViewMode === "grid" ? "bg-white text-zinc-900 shadow-xs" : "text-zinc-500"
                      }`}
                    >
                      ⊞ {t("كروت", "Cards")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setFeedViewMode("table")}
                      className={`px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer ${
                        feedViewMode === "table" ? "bg-white text-zinc-900 shadow-xs" : "text-zinc-500"
                      }`}
                    >
                      ☰ {t("جدول", "Table")}
                    </button>
                  </div>

                  {selectedCycle !== "all" && (
                    <button
                      type="button"
                      onClick={() => void handleBulkApproveCycleFeed(selectedCycle)}
                      disabled={submitting}
                      className="rounded-lg bg-emerald-600 hover:bg-emerald-700 px-3.5 py-2 text-xs font-semibold text-white cursor-pointer transition"
                    >
                      ✅ {t(`اعتماد كالندر ${selectedCycle} بالكامل`, `Approve All ${selectedCycle}`)}
                    </button>
                  )}
                </div>
              </div>

              {feedViewMode === "grid" ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredFeed.map((p) => {
                    const isReel = p.format === "Reel";
                    const isApproved = ["Approved", "Scheduled", "Published"].includes(p.publishStatus);
                    return (
                      <div
                        key={p.id}
                        className="ui-card ui-card-hover p-5 flex flex-col justify-between"
                      >
                        <div>
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="rounded-md bg-zinc-100 px-2.5 py-1 text-xs font-bold text-zinc-900">
                                {p.cycle} · {p.contentName}
                              </span>
                              <span
                                className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${
                                  isReel
                                    ? "border-violet-200 bg-violet-50 text-violet-700"
                                    : "border-sky-200 bg-sky-50 text-sky-700"
                                }`}
                              >
                                {isReel ? "🎬 Reel" : "🖼️ Post"}
                              </span>
                            </div>
                            <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${statusPillClass(p.publishStatus)}`}>
                              {p.publishStatus}
                            </span>
                          </div>

                          <div className="mt-3 flex items-center justify-between text-xs text-zinc-500" dir="ltr">
                            <span>📅 {p.day}, {p.publishDate}</span>
                            <span>🕖 {p.cairoTime}</span>
                          </div>

                          {p.topicTitle && (
                            <h3 className="mt-3 text-sm font-semibold text-zinc-900">{p.topicTitle}</h3>
                          )}
                          {p.captionText && (
                            <p className="mt-1.5 text-xs text-zinc-600 line-clamp-3 whitespace-pre-line">
                              {p.captionText}
                            </p>
                          )}

                          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                            <span className="rounded-md bg-zinc-100 px-2 py-0.5">📱 {p.platforms}</span>
                            <span className="rounded-md bg-zinc-100 px-2 py-0.5">🏷️ {p.postType}</span>
                            {p.assetLink && (
                              <a
                                href={p.assetLink}
                                target="_blank"
                                rel="noreferrer"
                                className="text-red-600 font-semibold hover:underline"
                              >
                                🎨 {t("معاينة التصميم / الفيديو ↗", "View Creative ↗")}
                              </a>
                            )}
                          </div>

                          {p.clientComment && (
                            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
                              💬 {p.clientComment}
                            </div>
                          )}
                        </div>

                        <div className="mt-4 pt-3 border-t border-zinc-100 flex items-center justify-between gap-2">
                          {!isApproved ? (
                            <button
                              type="button"
                              onClick={() => void handleApprovePost(p)}
                              disabled={submitting}
                              className="flex-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 py-2 text-xs font-semibold text-white cursor-pointer transition"
                            >
                              ✅ {t("اعتماد البوست", "Approve Post")}
                            </button>
                          ) : (
                            <span className="text-xs font-semibold text-emerald-600">
                              ✓ {t("معتمد للنشر", "Approved")}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setModalComment(p.clientComment || "");
                              setActionModal({
                                mode: "post_revision",
                                targetId: p.id,
                                targetLabel: `${p.cycle} · ${p.contentName} (${p.publishDate})`,
                              });
                            }}
                            className="brutal-btn-outline px-3 py-1.5 text-xs normal-case"
                          >
                            ✏️ {t("طلب تعديل", "Request Edit")}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-zinc-200">
                  <table className="w-full text-xs text-left rtl:text-right">
                    <thead className="bg-zinc-50 text-zinc-500 uppercase text-[11px] border-b border-zinc-200">
                      <tr>
                        <th className="px-4 py-3">Cycle</th>
                        <th className="px-4 py-3">Post</th>
                        <th className="px-4 py-3">Publish Date</th>
                        <th className="px-4 py-3">Day</th>
                        <th className="px-4 py-3">Time</th>
                        <th className="px-4 py-3">Format</th>
                        <th className="px-4 py-3">Platforms</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3">{t("إجراء العميل", "Action")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {filteredFeed.map((p) => (
                        <tr key={p.id} className="hover:bg-zinc-50/80">
                          <td className="px-4 py-3 font-semibold text-zinc-900">{p.cycle}</td>
                          <td className="px-4 py-3 font-semibold text-zinc-900">
                            {p.contentName}
                            {p.topicTitle && <div className="text-[11px] text-zinc-500">{p.topicTitle}</div>}
                          </td>
                          <td className="px-4 py-3 text-zinc-600" dir="ltr">{p.publishDate}</td>
                          <td className="px-4 py-3 text-zinc-500">{p.day}</td>
                          <td className="px-4 py-3 text-zinc-500" dir="ltr">{p.cairoTime}</td>
                          <td className="px-4 py-3 font-semibold text-zinc-800">{p.format}</td>
                          <td className="px-4 py-3 text-zinc-600">{p.platforms}</td>
                          <td className="px-4 py-3">
                            <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${statusPillClass(p.publishStatus)}`}>
                              {p.publishStatus}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => void handleApprovePost(p)}
                                className="rounded-md bg-emerald-600 hover:bg-emerald-700 px-2.5 py-1 text-[11px] font-semibold text-white cursor-pointer"
                              >
                                ✅ {t("اعتماد", "Approve")}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setModalComment(p.clientComment || "");
                                  setActionModal({
                                    mode: "post_revision",
                                    targetId: p.id,
                                    targetLabel: `${p.cycle} · ${p.contentName}`,
                                  });
                                }}
                                className="rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700 cursor-pointer"
                              >
                                ✏️
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {/* ── TAB 4: DAILY STORIES ── */}
          {activeTab === "stories" && (
            <section className="ui-card p-6 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-zinc-900">
                    {t(`جدول الـ Stories اليومية (${filteredStories.length})`, `Daily Stories Schedule (${filteredStories.length} Stories)`)}
                  </h2>
                  <p className="text-xs text-zinc-500">
                    {t("تُنشر يومياً الساعة 6:00 مساءً بتوقيت القاهرة شاملة أيام الجمعة والسبت", "Published daily at 6:00 PM Cairo time including Friday & Saturday weekends")}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {["all", "Draft", "Ready for Review", "Approved", "Scheduled", "Published"].map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setStoryStatusFilter(st)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition ${
                        storyStatusFilter === st
                          ? "bg-red-600 text-white"
                          : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                      }`}
                    >
                      {st === "all" ? t("كل الحالات", "All") : st}
                    </button>
                  ))}
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border border-zinc-200 max-h-[620px]">
                <table className="w-full text-xs text-left rtl:text-right">
                  <thead className="sticky top-0 bg-zinc-50 text-zinc-500 uppercase text-[11px] border-b border-zinc-200 z-10">
                    <tr>
                      <th className="px-4 py-3">Cycle</th>
                      <th className="px-4 py-3">Story ID</th>
                      <th className="px-4 py-3">Publish Date</th>
                      <th className="px-4 py-3">Day</th>
                      <th className="px-4 py-3">Time</th>
                      <th className="px-4 py-3">Topic / Asset Link</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">{t("إجراء العميل", "Action")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {filteredStories.map((s) => {
                      const isWeekend = s.day === "Fri" || s.day === "Sat";
                      return (
                        <tr key={s.id} className="hover:bg-zinc-50/80">
                          <td className="px-4 py-3 font-semibold text-zinc-900">{s.cycle}</td>
                          <td className="px-4 py-3 font-semibold text-zinc-900">{s.storyId}</td>
                          <td className="px-4 py-3 text-zinc-600" dir="ltr">{s.publishDate}</td>
                          <td className="px-4 py-3">
                            <span className={isWeekend ? "font-semibold text-amber-600" : "text-zinc-500"}>
                              {s.day} {isWeekend ? "(Weekend)" : ""}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-zinc-500" dir="ltr">{s.cairoTime}</td>
                          <td className="px-4 py-3 max-w-xs">
                            {s.topicAssetLink ? (
                              s.topicAssetLink.startsWith("http") ? (
                                <a
                                  href={s.topicAssetLink}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-red-600 font-semibold hover:underline"
                                >
                                  🔗 {t("معاينة الاستوري ↗", "View Story Asset ↗")}
                                </a>
                              ) : (
                                <span className="text-zinc-800">{s.topicAssetLink}</span>
                              )
                            ) : (
                              <span className="text-zinc-400">—</span>
                            )}
                            {s.clientComment && (
                              <div className="text-[11px] text-amber-700 mt-0.5">💬 {s.clientComment}</div>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${statusPillClass(s.publishStatus)}`}>
                              {s.publishStatus}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => void handleApproveStory(s)}
                                className="rounded-md bg-emerald-600 hover:bg-emerald-700 px-2.5 py-1 text-[11px] font-semibold text-white cursor-pointer"
                              >
                                ✅ {t("اعتماد", "Approve")}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setModalLink(s.topicAssetLink || "");
                                  setModalComment(s.clientComment || "");
                                  setActionModal({
                                    mode: "story_revision",
                                    targetId: s.id,
                                    targetLabel: `${s.cycle} · ${s.storyId} (${s.publishDate})`,
                                  });
                                }}
                                className="rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700 cursor-pointer"
                              >
                                💬
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* ── TAB 5: PAID MEDIA CAMPAIGNS & LIVE ACTIVITY LOG ── */}
          {activeTab === "ads" && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-4">
                <div className="ui-card p-6">
                  <h2 className="text-base font-semibold text-zinc-900">
                    {t("حملات الإعلانات الممولة وتقارير الأداء (Meta Ads)", "Meta Paid Media Campaigns & Reports")}
                  </h2>
                  <p className="text-xs text-zinc-500 mt-1">
                    {t(
                      "يتطلب الإطلاق اعتماد الهدف الإعلاني والميزانية والتصميم مع تأكيد صلاحية الحساب الإعلاني.",
                      "Launch requires approval of the objective, budget, and creative, plus confirmed ad account access.",
                    )}
                  </p>

                  <div className="mt-5 space-y-4">
                    {portal.paidCampaigns.map((camp) => (
                      <div key={camp.id} className="rounded-xl border border-zinc-200 bg-zinc-50/50 p-5 space-y-4">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <span className="text-xs font-semibold text-red-600">
                              {camp.cycle} · {camp.platforms}
                            </span>
                            <h3 className="text-base font-bold text-zinc-900 mt-0.5">{camp.campaignName}</h3>
                            <p className="text-xs text-zinc-600 mt-1">
                              🎯 {t("الهدف الإعلاني:", "Objective:")}{" "}
                              <strong className="text-zinc-900">{camp.objective}</strong>
                            </p>
                          </div>
                          <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${statusPillClass(camp.status)}`}>
                            {camp.status}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                          <div className="rounded-lg bg-white border border-zinc-200 p-3">
                            <span className="text-zinc-500 text-[11px]">{t("الميزانية المقترحة", "Budget")}</span>
                            <p className="text-sm font-bold text-emerald-600 mt-0.5">
                              EGP {camp.budgetEgp.toLocaleString()}
                            </p>
                          </div>
                          <div className="rounded-lg bg-white border border-zinc-200 p-3">
                            <span className="text-zinc-500 text-[11px]">{t("صلاحية الحساب الإعلاني", "Ad Account Access")}</span>
                            <p className="font-semibold text-zinc-900 mt-0.5">
                              {camp.adAccountAccessConfirmed ? "✅ Confirmed" : "⏳ Pending"}
                            </p>
                          </div>
                          <div className="rounded-lg bg-white border border-zinc-200 p-3 flex flex-col justify-center">
                            {camp.reportLink ? (
                              <a
                                href={camp.reportLink}
                                target="_blank"
                                rel="noreferrer"
                                className="text-red-600 font-semibold hover:underline"
                              >
                                📈 {t("فتح تقرير الأداء ↗", "View Report ↗")}
                              </a>
                            ) : (
                              <span className="text-zinc-400 text-[11px]">
                                {t("التقرير بنهاية الدورة", "Report at cycle end")}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-zinc-200">
                          <span className="text-xs text-zinc-500">{camp.notes}</span>
                          {camp.status !== "Approved" && camp.status !== "Active" && camp.status !== "Completed" && (
                            <button
                              type="button"
                              onClick={async () => {
                                setSubmitting(true);
                                try {
                                  await recordClientPortalInteraction({
                                    portalId: portal.id,
                                    actorRole: "client",
                                    actorName: clientActorName || portal.clientName,
                                    actionType: "approve_ad_campaign",
                                    targetId: camp.id,
                                    targetLabel: `${camp.cycle} — ${camp.campaignName}`,
                                    statusAfter: "Approved",
                                  });
                                  showToast(t(`🚀 تم اعتماد إطلاق حملة "${camp.campaignName}"!`, `🚀 Approved campaign!`));
                                } finally {
                                  setSubmitting(false);
                                }
                              }}
                              className="rounded-lg bg-emerald-600 hover:bg-emerald-700 px-4 py-2 text-xs font-semibold text-white cursor-pointer"
                            >
                              🚀 {t("اعتماد الهدف والميزانية والإطلاق", "Approve Campaign Launch")}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="ui-card p-5">
                  <h3 className="text-sm font-semibold text-zinc-900">
                    💬 {t("إرسال ملاحظة مباشرة للوكالة", "Send Direct Note to Agency")}
                  </h3>
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (!generalComment.trim() || submitting) return;
                      setSubmitting(true);
                      try {
                        await recordClientPortalInteraction({
                          portalId: portal.id,
                          actorRole: "client",
                          actorName: clientActorName || portal.clientName,
                          actionType: "comment",
                          targetLabel: "General Portal Note",
                          comment: generalComment.trim(),
                        });
                        setGeneralComment("");
                        showToast(t("💬 تم إرسال رسالتك لفريق الوكالة فوراً!", "💬 Message sent!"));
                      } finally {
                        setSubmitting(false);
                      }
                    }}
                    className="mt-3 space-y-2.5"
                  >
                    <textarea
                      rows={3}
                      value={generalComment}
                      onChange={(e) => setGeneralComment(e.target.value)}
                      placeholder={t("اكتب أي ملاحظة أو تعديل ليصل فوراً للأكونت مانجر...", "Write a note for your Account Manager...")}
                      className="brutal-input text-xs"
                    />
                    <button type="submit" disabled={submitting} className="brutal-btn w-full py-2.5 text-xs normal-case">
                      {t("إرسال الملاحظة", "Send Note")}
                    </button>
                  </form>
                </div>

                <div className="ui-card p-5">
                  <h3 className="text-sm font-semibold text-zinc-900 mb-3">
                    🕒 {t("سجل الاعتمادات والتعديلات اللحظي", "Live Approvals & Activity Log")}
                  </h3>
                  {interactions.length === 0 ? (
                    <p className="text-xs text-zinc-500">
                      {t("لم يتم تسجيل اعتمادات جديدة بعد.", "No activity logged yet.")}
                    </p>
                  ) : (
                    <div className="space-y-2.5 max-h-96 overflow-y-auto">
                      {[...interactions].reverse().map((ev) => (
                        <div key={ev.id} className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs space-y-1">
                          <div className="flex items-center justify-between text-[11px] text-zinc-500">
                            <strong className="text-zinc-900">{ev.actorName}</strong>
                            <span dir="ltr">
                              {new Date(ev.createdAtIso).toLocaleString([], {
                                month: "short",
                                day: "2-digit",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          </div>
                          <p className="font-semibold text-red-600">{ev.targetLabel}</p>
                          {ev.comment && <p className="text-zinc-700">{ev.comment}</p>}
                          {ev.linkUrl && (
                            <a
                              href={ev.linkUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-block text-red-600 hover:underline font-semibold"
                            >
                              🔗 Open Link ↗
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* ── MODAL FOR ASSET UPLOAD / REVISION REQUEST / NOTE ── */}
      {actionModal && (
        <div
          className="fixed inset-0 z-50 bg-zinc-950/50 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setActionModal(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl space-y-4"
          >
            <h3 className="text-base font-semibold text-zinc-900">
              {actionModal.mode === "milestone_assets"
                ? t("📁 إرفاق رابط خامات المشروع واعتماد التسليم", "📁 Submit Project Assets Link")
                : actionModal.mode === "post_revision"
                  ? t("✏️ طلب تعديل على البوست / الـ Reel", "✏️ Request Post Revision")
                  : t("💬 إضافة ملاحظة للفريق", "💬 Add Note")}
            </h3>
            <p className="text-xs font-semibold text-red-600">{actionModal.targetLabel}</p>

            <form onSubmit={handleSubmitModalAction} className="space-y-3.5">
              {(actionModal.mode === "milestone_assets" ||
                actionModal.mode === "milestone_note" ||
                actionModal.mode === "story_revision") && (
                <div>
                  <label className="block text-xs font-medium text-zinc-700 mb-1">
                    {t("رابط الملفات / الخامات (Google Drive / WeTransfer)", "Assets / Reference Link")}
                  </label>
                  <input
                    type="url"
                    required={actionModal.mode === "milestone_assets"}
                    value={modalLink}
                    onChange={(e) => setModalLink(e.target.value)}
                    placeholder="https://drive.google.com/..."
                    dir="ltr"
                    className="brutal-input text-xs"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">
                  {t("الملاحظات أو التعديلات المطلوبة", "Notes / Revision Details")}
                </label>
                <textarea
                  rows={3}
                  required={actionModal.mode !== "milestone_assets"}
                  value={modalComment}
                  onChange={(e) => setModalComment(e.target.value)}
                  placeholder={t("اكتب تفاصيل التعديل أو الملاحظة...", "Enter details or notes...")}
                  className="brutal-input text-xs"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setActionModal(null)}
                  className="brutal-btn-outline px-4 py-2 text-xs normal-case"
                >
                  {t("إلغاء", "Cancel")}
                </button>
                <button type="submit" disabled={submitting} className="brutal-btn px-5 py-2 text-xs normal-case">
                  {t("حفظ وإرسال للوكالة", "Save & Send")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ClientPortalPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center bg-[var(--mft-bg)]">
          <div className="flex flex-col items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-red-600 font-oswald text-lg font-bold text-white shadow-lg shadow-red-600/30">
              M
            </div>
            <p className="text-xs font-medium text-zinc-500">Loading Client Portal…</p>
          </div>
        </div>
      }
    >
      <ClientPortalInner />
    </Suspense>
  );
}
