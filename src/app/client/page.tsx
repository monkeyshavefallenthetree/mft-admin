"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
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

type PortalTab = "overview" | "feed" | "stories" | "timeline" | "ads";

const SESSION_KEY = "mft_client_portal_session_v1";

function Icon({ d, className = "h-4 w-4" }: { d: string; className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

const ICONS = {
  overview: "M4 5a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v2a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10-3a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1h-4a1 1 0 01-1-1v-7z",
  timeline: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4",
  feed: "M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z",
  stories: "M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z",
  ads: "M13 7h8m0 0v8m0-8l-8 8-4-4-6 6",
  check: "M5 13l4 4L19 7",
  edit: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z",
  play: "M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  calendar: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
  external: "M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14",
  sun: "M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z",
  moon: "M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z",
  upload: "M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12",
  chat: "M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z",
  shield: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z",
};

function statusTone(status: string): { dot: string; badge: string; labelAr: string } {
  const s = status.toLowerCase();
  if (s === "done" || s === "published" || s === "approved" || s === "completed") {
    return {
      dot: "bg-emerald-500",
      badge: "border-emerald-200 bg-emerald-50 text-emerald-700",
      labelAr: s === "published" ? "منشور" : "معتمد",
    };
  }
  if (s.includes("progress") || s === "scheduled" || s === "active") {
    return {
      dot: "bg-blue-500",
      badge: "border-blue-200 bg-blue-50 text-blue-700",
      labelAr: s === "scheduled" ? "مجدول للنشر" : "قيد التنفيذ",
    };
  }
  if (s.includes("wait") || s.includes("review")) {
    return {
      dot: "bg-amber-500",
      badge: "border-amber-200 bg-amber-50 text-amber-700",
      labelAr: "بانتظار مراجعتك",
    };
  }
  if (s.includes("revision") || s.includes("delay")) {
    return {
      dot: "bg-red-500",
      badge: "border-red-200 bg-red-50 text-red-700",
      labelAr: "مطلوب تعديل",
    };
  }
  return {
    dot: "bg-zinc-400",
    badge: "border-zinc-200 bg-zinc-100 text-zinc-600",
    labelAr: "قيد التجهيز",
  };
}

/** Precision SVG Donut Chart */
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

function ClientPortalInner() {
  const searchParams = useSearchParams();
  const [lang, setLang] = useState<"ar" | "en">("ar");
  const isAr = lang === "ar";
  const t = (ar: string, en: string) => (isAr ? ar : en);

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

  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const [portalsMap, setPortalsMap] = useState<Record<string, ClientRolloutPortal>>({
    [ARC_DEFAULT_PORTAL.id]: ARC_DEFAULT_PORTAL,
  });
  const [activePortalId, setActivePortalId] = useState<string | null>(null);
  const [interactions, setInteractions] = useState<ClientPortalInteraction[]>([]);

  // Login State
  const [loginCode, setLoginCode] = useState("");
  const [loginPin, setLoginPin] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [clientActorName, setClientActorName] = useState("");
  const [loginError, setLoginError] = useState("");

  // Navigation & View States
  const [activeTab, setActiveTab] = useState<PortalTab>("overview");
  const [selectedCycle, setSelectedCycle] = useState<string>("Cycle 01");
  const [feedLayout, setFeedLayout] = useState<"social" | "calendar">("social");
  const [feedFormatFilter, setFeedFormatFilter] = useState<string>("all");
  const [selectedStoryWeek, setSelectedStoryWeek] = useState<number>(0);
  const [activeStoryPlayer, setActiveStoryPlayer] = useState<DailyStoryItem | null>(null);

  // Native <dialog> Modal for Revisions / Asset Links
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [actionModal, setActionModal] = useState<{
    mode: "milestone_assets" | "milestone_note" | "post_revision" | "story_revision";
    targetId: string;
    targetLabel: string;
  } | null>(null);
  const [modalLink, setModalLink] = useState("");
  const [modalComment, setModalComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Sign-off state
  const [localChecks, setLocalChecks] = useState<Record<string, boolean>>({});
  const [assetContactName, setAssetContactName] = useState("");
  const [assetContactPhone, setAssetContactPhone] = useState("");
  const [approverName, setApproverName] = useState("");
  const [approverTitle, setApproverTitle] = useState("");
  const [generalComment, setGeneralComment] = useState("");

  // Cairo live clock
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
    setTimeout(() => setToastMsg(null), 4000);
  };

  // Open/close native <dialog> when actionModal state changes (modern-web-guidance: dialog)
  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (actionModal) {
      if (!dlg.open) dlg.showModal();
    } else {
      if (dlg.open) dlg.close();
    }
  }, [actionModal]);

  useEffect(() => {
    return subscribeClientPortals(setPortalsMap);
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
          "كود العميل أو الرقم السري غير صحيح. استخدم الكود ARC والرقم السري 2026",
          "Invalid Client Code or PIN. Use Code: ARC and PIN: 2026",
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

  // Metrics & Priority Queue
  const stats = useMemo(() => {
    if (!portal) {
      return {
        msDone: 0,
        msTotal: 0,
        clientPendingMs: [] as MilestoneItem[],
        feedApproved: 0,
        feedTotal: 0,
        feedReady: [] as FeedPostItem[],
        feedRevision: 0,
        feedDraft: 0,
        storiesApproved: 0,
        storiesTotal: 0,
        overallPct: 0,
        cycleMetrics: [] as Array<{
          name: string;
          startDate: string;
          endDate: string;
          msDone: number;
          msTotal: number;
          msPct: number;
          feedDone: number;
          feedTotal: number;
          feedPct: number;
          storyDone: number;
          storyTotal: number;
          storyPct: number;
        }>,
      };
    }
    const msDone = portal.milestones.filter((m) => m.status === "Done").length;
    const msTotal = portal.milestones.length;
    const clientPendingMs = portal.milestones.filter(
      (m) => m.owner.toLowerCase().includes("arc") && m.status !== "Done",
    );

    const feedApproved = portal.feedCalendar.filter((f) =>
      ["Approved", "Scheduled", "Published"].includes(f.publishStatus),
    ).length;
    const feedTotal = portal.feedCalendar.length;
    const feedReady = portal.feedCalendar.filter((f) => f.publishStatus === "Ready for Review");
    const feedRevision = portal.feedCalendar.filter((f) => f.publishStatus === "Revision Requested").length;
    const feedDraft = portal.feedCalendar.filter((f) => f.publishStatus === "Draft").length;

    const storiesApproved = portal.dailyStories.filter((s) =>
      ["Approved", "Scheduled", "Published"].includes(s.publishStatus),
    ).length;
    const storiesTotal = portal.dailyStories.length;

    const totalItems = msTotal + feedTotal + storiesTotal;
    const doneItems = msDone + feedApproved + storiesApproved;
    const overallPct = totalItems > 0 ? Math.round((doneItems / totalItems) * 100) : 0;

    const cycleMetrics = portal.cycles.map((c) => {
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
      feedApproved,
      feedTotal,
      feedReady,
      feedRevision,
      feedDraft,
      storiesApproved,
      storiesTotal,
      overallPct,
      cycleMetrics,
    };
  }, [portal]);

  const cycleFeed = useMemo(() => {
    if (!portal) return [];
    return portal.feedCalendar.filter((f) => {
      if (selectedCycle !== "all" && f.cycle !== selectedCycle) return false;
      if (feedFormatFilter !== "all" && f.format.toLowerCase() !== feedFormatFilter) return false;
      return true;
    });
  }, [portal, selectedCycle, feedFormatFilter]);

  const cycleStories = useMemo(() => {
    if (!portal) return [];
    const targetCycle = selectedCycle === "all" ? "Cycle 01" : selectedCycle;
    return portal.dailyStories.filter((s) => s.cycle === targetCycle);
  }, [portal, selectedCycle]);

  // Group cycle stories into 4 weekly strips of 7 days (Sun -> Sat)
  const storyWeeks = useMemo(() => {
    const weeks: DailyStoryItem[][] = [];
    for (let i = 0; i < cycleStories.length; i += 7) {
      weeks.push(cycleStories.slice(i, i + 7));
    }
    return weeks;
  }, [cycleStories]);

  const activeWeekStories = storyWeeks[selectedStoryWeek] || storyWeeks[0] || [];

  // Actions
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
      showToast(t(`تم اعتماد المرحلة "${m.milestone}" بنجاح`, `Approved "${m.milestone}"`));
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
      showToast(t(`تم اعتماد ${p.contentName} (${p.publishDate})`, `Approved ${p.contentName}`));
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
      showToast(t(`تم اعتماد جميع بوستات ${cycleName} بالكامل`, `Approved all ${cycleName} posts`));
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
      showToast(t(`تم اعتماد ${s.storyId} (${s.publishDate})`, `Approved ${s.storyId}`));
    } finally {
      setSubmitting(false);
    }
  };

  const handleBulkApproveWeekStories = async (stories: DailyStoryItem[]) => {
    if (!portal || submitting || stories.length === 0) return;
    setSubmitting(true);
    try {
      for (const s of stories) {
        if (!["Approved", "Scheduled", "Published"].includes(s.publishStatus)) {
          await recordClientPortalInteraction({
            portalId: portal.id,
            actorRole: "client",
            actorName: clientActorName || portal.clientName,
            actionType: "approve_story",
            targetId: s.id,
            targetLabel: `${s.cycle} · ${s.storyId} (${s.publishDate})`,
            statusAfter: "Approved",
          });
        }
      }
      showToast(t("تم اعتماد استوريهات الأسبوع بالكامل", "Approved all stories for this week"));
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
        showToast(t("تم إرسال رابط خامات المشروع واعتماد المرحلة", "Project assets link submitted"));
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
        showToast(t("تم إرسال الملاحظة لفريق الوكالة", "Note sent to agency"));
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
        showToast(t("تم إرسال طلب التعديل على البوست", "Revision request sent"));
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
        showToast(t("تم حفظ الملاحظة على الاستوري", "Story note saved"));
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
      showToast(t("يرجى تحديد جميع بنود التأكيد الثلاثة قبل التوقيع", "Please confirm all 3 items before signing"));
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
      showToast(t("تم اعتماد وتوقيع خطة العمل رسمياً", "Rollout plan signed and confirmed"));
    } finally {
      setSubmitting(false);
    }
  };

  // ── 1. CLIENT SIGN-IN SCREEN ──
  if (!portal) {
    return (
      <div dir={isAr ? "rtl" : "ltr"} className="grid min-h-screen bg-[var(--mft-bg)] lg:grid-cols-2">
        <div className="relative hidden overflow-hidden bg-zinc-950 p-12 text-white lg:flex lg:flex-col lg:justify-between">
          <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-red-600/20 blur-3xl" />
          <div className="pointer-events-none absolute bottom-0 left-0 h-80 w-80 rounded-full bg-zinc-800/40 blur-3xl" />

          <div className="relative flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-600 font-oswald text-base font-bold text-white">
              M
            </div>
            <span className="font-oswald text-lg font-bold tracking-wider">MFT AGENCY</span>
            <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] font-medium text-zinc-300">
              Client Studio
            </span>
          </div>

          <div className="relative max-w-lg space-y-5">
            <h2 className="text-3xl font-semibold leading-snug tracking-tight text-white">
              {t(
                "منصة مراجعة المحتوى، استوديو الكالندر، واعتماد خطط النشر.",
                "Content review studio, visual rollout calendar, and instant approvals.",
              )}
            </h2>
            <p className="text-sm text-zinc-400 leading-relaxed">
              {t(
                "استعرض بوستات فيسبوك وإنستجرام والـ Reels والـ Stories اليومية في معاينة حية مطابقة للواقع، واعتمد خطتك بضغطة واحدة.",
                "Preview your Facebook & Instagram posts, Reels, and daily Stories in native social mockups and approve with one click.",
              )}
            </p>
            <div className="grid grid-cols-3 gap-3 pt-2">
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
                <p className="text-lg font-bold tabular-nums">3 Cycles</p>
                <p className="text-xs text-zinc-400">{t("خطة 90 يوم", "90-Day Rollout")}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
                <p className="text-lg font-bold tabular-nums">36 Posts</p>
                <p className="text-xs text-zinc-400">Sun · Tue · Thu</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
                <p className="text-lg font-bold tabular-nums">90 Stories</p>
                <p className="text-xs text-zinc-400">{t("يومياً 6:00 م", "Daily 6:00 PM")}</p>
              </div>
            </div>
          </div>

          <p className="relative text-xs text-zinc-500">
            © {new Date().getFullYear()} MFT Operations · Cairo Local Time ({cairoTimeStr || "GMT+2"})
          </p>
        </div>

        <div className="flex flex-col justify-between p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5 lg:invisible">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-600 font-oswald text-sm font-bold text-white">
                M
              </div>
              <span className="font-oswald text-lg font-bold tracking-wider text-zinc-900">MFT</span>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={toggleTheme} className="brutal-btn-outline px-3 py-1.5 text-xs">
                <Icon d={isDark ? ICONS.sun : ICONS.moon} className="h-3.5 w-3.5" />
                {isDark ? t("نهاري", "Light") : t("ليلي", "Dark")}
              </button>
              <button
                type="button"
                onClick={() => setLang(isAr ? "en" : "ar")}
                className="brutal-btn-outline px-3 py-1.5 text-xs"
              >
                {isAr ? "English" : "العربية"}
              </button>
            </div>
          </div>

          <div className="mx-auto w-full max-w-sm my-auto py-8 animate-slide-up">
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
              {t("دخول بوابة العميل", "Client Studio Sign In")}
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              {t("أدخل كود المشروع والرقم السري الخاص بك للمتابعة.", "Enter your project code and access PIN.")}
            </p>

            <form onSubmit={handleLogin} className="mt-7 space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-zinc-700">
                  {t("كود المشروع (Client Code)", "Client Code")}
                </label>
                <input
                  type="text"
                  required
                  value={loginCode}
                  onChange={(e) => setLoginCode(e.target.value)}
                  placeholder="ARC"
                  dir="ltr"
                  className="brutal-input h-10 font-code font-semibold uppercase tracking-wider"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-zinc-700">
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
                    className="brutal-input h-10 pr-16 font-code tracking-widest"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs font-medium text-zinc-500 hover:text-zinc-800 cursor-pointer"
                  >
                    {showPw ? t("إخفاء", "Hide") : t("إظهار", "Show")}
                  </button>
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-zinc-700">
                  {t("الاسم (لتوثيق الاعتمادات - اختياري)", "Reviewer Name (optional)")}
                </label>
                <input
                  type="text"
                  value={clientActorName}
                  onChange={(e) => setClientActorName(e.target.value)}
                  placeholder={t("مثال: أ. أحمد — إدارة التسويق", "e.g. Marketing Director")}
                  className="brutal-input h-10 text-xs"
                />
              </div>

              {loginError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                  {loginError}
                </div>
              )}

              <button type="submit" className="brutal-btn h-10 w-full text-xs">
                {t("فتح استوديو العميل", "Continue to Studio")}
              </button>
            </form>

            <div className="mt-6 rounded-xl border border-zinc-200 bg-zinc-50/70 p-3 flex items-center justify-between">
              <div className="text-xs text-zinc-600">
                <span className="font-semibold text-zinc-900">ARC Workspace:</span>{" "}
                <code className="font-code font-semibold text-red-600">ARC</code> ·{" "}
                <code className="font-code font-semibold text-red-600">2026</code>
              </div>
              <button
                type="button"
                onClick={() => {
                  setLoginCode("ARC");
                  setLoginPin("2026");
                }}
                className="brutal-btn-outline px-2.5 py-1 text-[11px]"
              >
                {t("تعبئة سريعة", "Autofill")}
              </button>
            </div>
          </div>

          <div className="text-center text-xs text-zinc-400">MFT Client Collaboration Suite</div>
        </div>
      </div>
    );
  }

  const navItems: Array<{ id: PortalTab; label: string; icon: string; badge?: number }> = [
    {
      id: "overview",
      label: t("ملخص الخطة والاعتمادات", "Executive Overview"),
      icon: ICONS.overview,
      badge: stats.clientPendingMs.length + stats.feedReady.length + (!portal.contractSigned ? 1 : 0),
    },
    {
      id: "feed",
      label: t("استوديو البوستات والـ Reels", "Feed & Reels Studio"),
      icon: ICONS.feed,
      badge: stats.feedReady.length,
    },
    {
      id: "stories",
      label: t("استوديو الـ Stories اليومية", "Daily Stories Deck"),
      icon: ICONS.stories,
    },
    {
      id: "timeline",
      label: t("خارطة طريق الإنتاج", "Production Roadmap"),
      icon: ICONS.timeline,
      badge: stats.clientPendingMs.length,
    },
    {
      id: "ads",
      label: t("الإعلانات وسجل المتابعة", "Paid Media & Activity"),
      icon: ICONS.ads,
    },
  ];

  // ── 2. CLIENT STUDIO WORKSPACE (Planable + Frame.io + Linear Experience) ──
  return (
    <div dir={isAr ? "rtl" : "ltr"} className="flex min-h-screen bg-[var(--mft-bg)] text-zinc-900">
      {toastMsg && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2.5 text-xs font-medium text-white shadow-xl animate-toast-in">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          <span>{toastMsg}</span>
        </div>
      )}

      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-zinc-950/40 backdrop-blur-xs lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* ── Left Rail Sidebar ── */}
      <aside
        className={`fixed inset-y-0 start-0 z-40 flex h-screen flex-col border-e border-zinc-200/80 bg-white transition-all duration-200 lg:sticky ${
          mobileOpen
            ? "translate-x-0"
            : isAr
              ? "translate-x-full lg:translate-x-0"
              : "-translate-x-full lg:translate-x-0"
        } ${collapsed ? "w-64 lg:w-[68px]" : "w-64"}`}
      >
        <div className={`flex h-15 items-center gap-3 border-b border-zinc-100 px-4 ${collapsed ? "lg:justify-center lg:px-2" : ""}`}>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-900 font-oswald text-sm font-bold text-white">
            {portal.clientCode.slice(0, 2)}
          </div>
          <div className={`min-w-0 ${collapsed ? "lg:hidden" : ""}`}>
            <p className="text-sm font-bold leading-none text-zinc-900">{portal.clientName}</p>
            <p className="mt-1 truncate text-[11px] text-zinc-500">3-Month Rollout Studio</p>
          </div>
        </div>

        {/* Cycle Selector */}
        <div className={`px-3 pt-3 ${collapsed ? "lg:hidden" : ""}`}>
          <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-2">
            <p className="px-1.5 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
              {t("الدورة النشطة", "Active Cycle")}
            </p>
            <div className="grid grid-cols-3 gap-1">
              {portal.cycles.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setSelectedCycle(c.name);
                    setSelectedStoryWeek(0);
                  }}
                  className={`rounded-lg py-1.5 text-[11px] font-semibold transition cursor-pointer ${
                    selectedCycle === c.name
                      ? "bg-white text-zinc-900 shadow-xs border border-zinc-200/80"
                      : "text-zinc-500 hover:text-zinc-900"
                  }`}
                >
                  {c.name.replace("Cycle ", "C")}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Nav Items */}
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
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
                className={`group relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-all cursor-pointer ${
                  isActive
                    ? "bg-zinc-900 text-white"
                    : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
                } ${collapsed ? "lg:justify-center lg:px-2" : ""}`}
              >
                <Icon
                  d={item.icon}
                  className={`h-4 w-4 shrink-0 ${
                    isActive ? "text-white" : "text-zinc-400 group-hover:text-zinc-700"
                  }`}
                />
                <span className={`truncate ${collapsed ? "lg:hidden" : ""}`}>{item.label}</span>
                {item.badge && item.badge > 0 ? (
                  <span
                    className={`ms-auto flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold ${
                      isActive ? "bg-red-500 text-white" : "bg-zinc-100 text-zinc-700"
                    } ${collapsed ? "lg:hidden" : ""}`}
                  >
                    {item.badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-zinc-100 p-3 space-y-1">
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="hidden w-full items-center gap-3 rounded-lg px-3 py-2 text-xs font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 lg:flex cursor-pointer"
          >
            <Icon d="M11 19l-7-7 7-7m8 14l-7-7 7-7" className="h-4 w-4" />
            <span className={collapsed ? "lg:hidden" : ""}>{t("طي القائمة", "Collapse")}</span>
          </button>
        </div>
      </aside>

      {/* ── Center Stage ── */}
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        {/* Topbar */}
        <header className="sticky top-0 z-20 flex h-15 items-center gap-3 border-b border-zinc-200/80 bg-white/85 px-4 backdrop-blur-md md:px-6">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="rounded-lg p-2 text-zinc-600 hover:bg-zinc-100 lg:hidden cursor-pointer"
          >
            <Icon d="M4 6h16M4 12h16M4 18h16" className="h-5 w-5" />
          </button>

          <div className="min-w-0 flex-1 flex items-center gap-2">
            <span className="text-xs font-medium text-zinc-400">{portal.clientName}</span>
            <span className="text-zinc-300">/</span>
            <h1 className="truncate text-sm font-semibold text-zinc-900">
              {navItems.find((n) => n.id === activeTab)?.label}
            </h1>
          </div>

          {/* Cycle Switcher Pills */}
          <div className="hidden md:flex items-center gap-1 rounded-lg border border-zinc-200/80 bg-zinc-50 p-1">
            {[
              { key: "all", label: t("كل الدورات", "All Cycles") },
              ...portal.cycles.map((c) => ({ key: c.name, label: c.name })),
            ].map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setSelectedCycle(c.key)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition cursor-pointer ${
                  selectedCycle === c.key
                    ? "bg-white text-zinc-900 shadow-xs border border-zinc-200/60"
                    : "text-zinc-500 hover:text-zinc-900"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>

          <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] font-medium text-zinc-600">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            {cairoTimeStr}
          </span>

          <button
            type="button"
            onClick={toggleTheme}
            className="rounded-lg border border-zinc-200 bg-white p-2 text-zinc-600 hover:bg-zinc-50 cursor-pointer"
            aria-label="Toggle theme"
          >
            <Icon d={isDark ? ICONS.sun : ICONS.moon} className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() => setLang(isAr ? "en" : "ar")}
            className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 cursor-pointer"
          >
            {isAr ? "EN" : "عربي"}
          </button>

          <button
            type="button"
            onClick={handleLogout}
            className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:text-red-600 cursor-pointer"
          >
            {t("خروج", "Sign out")}
          </button>
        </header>

        <main className="mft-admin-content mx-auto w-full max-w-[1380px] flex-1 p-4 md:p-6 lg:p-8 space-y-6">
          {/* ── TAB 1: EXECUTIVE OVERVIEW & ACTION INBOX ── */}
          {activeTab === "overview" && (
            <div className="space-y-6 animate-fade-in">
              {/* Executive Summary Header Card */}
              <section className="ui-card p-6">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-6 border-b border-zinc-100">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-0.5 text-[11px] font-medium text-zinc-700">
                        <span className={`h-1.5 w-1.5 rounded-full ${portal.contractSigned ? "bg-emerald-500" : "bg-amber-500"}`} />
                        {portal.contractSigned
                          ? t(`الخطة معتمدة (${portal.contractSignedBy})`, `Signed by ${portal.contractSignedBy}`)
                          : t("بانتظار اعتماد الخطة", "Awaiting Plan Sign-Off")}
                      </span>
                      <span className="text-xs text-zinc-400">•</span>
                      <span className="text-xs text-zinc-500">{portal.timezoneLabel}</span>
                    </div>
                    <h2 className="mt-2 text-2xl font-bold tracking-tight text-zinc-900">
                      {portal.projectTitle}
                    </h2>
                    <p className="mt-1 text-sm text-zinc-500">{portal.subtitle}</p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setActiveTab("feed")}
                      className="brutal-btn"
                    >
                      <Icon d={ICONS.feed} className="h-4 w-4" />
                      {t("استعراض البوستات والـ Reels", "Open Feed Studio")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab("stories")}
                      className="brutal-btn-outline"
                    >
                      <Icon d={ICONS.stories} className="h-4 w-4" />
                      {t("استوديو الـ Stories", "Daily Stories Deck")}
                    </button>
                  </div>
                </div>

                {/* 4 Clean Metric Blocks */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 pt-5">
                  <div className="rounded-xl border border-zinc-100 bg-zinc-50/50 p-4">
                    <p className="text-xs font-medium text-zinc-500">{t("تقدم الخطة الإجمالي", "Overall Progress")}</p>
                    <div className="mt-2 flex items-baseline justify-between">
                      <span className="text-2xl font-bold tabular-nums text-zinc-900">{stats.overallPct}%</span>
                      <span className="text-xs text-emerald-600 font-medium">3 Cycles</span>
                    </div>
                    <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-200/70">
                      <div className="h-full rounded-full bg-zinc-900 transition-all duration-500" style={{ width: `${stats.overallPct}%` }} />
                    </div>
                  </div>

                  <div className="rounded-xl border border-zinc-100 bg-zinc-50/50 p-4">
                    <p className="text-xs font-medium text-zinc-500">{t("بوستات جاهزة لمراجعتك", "Ready for Your Review")}</p>
                    <div className="mt-2 flex items-baseline justify-between">
                      <span className="text-2xl font-bold tabular-nums text-zinc-900">{stats.feedReady.length}</span>
                      <button
                        type="button"
                        onClick={() => setActiveTab("feed")}
                        className="text-xs font-semibold text-red-600 hover:underline cursor-pointer"
                      >
                        {t("مراجعة الآن ←", "Review →")}
                      </button>
                    </div>
                    <p className="mt-2 text-[11px] text-zinc-400">
                      {t(`تم اعتماد ${stats.feedApproved} من ${stats.feedTotal} بوست`, `${stats.feedApproved} of ${stats.feedTotal} approved`)}
                    </p>
                  </div>

                  <div className="rounded-xl border border-zinc-100 bg-zinc-50/50 p-4">
                    <p className="text-xs font-medium text-zinc-500">{t("مراحل الجدول الزمني", "Roadmap Milestones")}</p>
                    <div className="mt-2 flex items-baseline justify-between">
                      <span className="text-2xl font-bold tabular-nums text-zinc-900">
                        {stats.msDone}<span className="text-sm font-normal text-zinc-400">/{stats.msTotal}</span>
                      </span>
                      <span className="text-xs text-amber-600 font-medium">
                        {stats.clientPendingMs.length} {t("مطلوب منك", "pending")}
                      </span>
                    </div>
                    <p className="mt-2 text-[11px] text-zinc-400">
                      {t("خارطة طريق الـ 90 يوم", "90-day production timeline")}
                    </p>
                  </div>

                  <div className="rounded-xl border border-zinc-100 bg-zinc-50/50 p-4">
                    <p className="text-xs font-medium text-zinc-500">{t("الـ Stories اليومية", "Daily Stories (6 PM)")}</p>
                    <div className="mt-2 flex items-baseline justify-between">
                      <span className="text-2xl font-bold tabular-nums text-zinc-900">
                        {stats.storiesApproved}<span className="text-sm font-normal text-zinc-400">/{stats.storiesTotal}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setActiveTab("stories")}
                        className="text-xs font-semibold text-zinc-700 hover:underline cursor-pointer"
                      >
                        {t("عرض الأسابيع ←", "Open Deck →")}
                      </button>
                    </div>
                    <p className="mt-2 text-[11px] text-zinc-400">
                      {t("يومياً شاملة الجمعة والسبت", "Every day incl. weekends")}
                    </p>
                  </div>
                </div>
              </section>

              {/* ── PRIORITY ACTION INBOX (Linear-style Decision Queue, NOT an Excel table!) ── */}
              {(stats.clientPendingMs.length > 0 || stats.feedReady.length > 0) && (
                <section className="ui-card p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-50 text-amber-600 border border-amber-200">
                        <Icon d={ICONS.check} className="h-4 w-4" />
                      </span>
                      <div>
                        <h3 className="text-sm font-semibold text-zinc-900">
                          {t("قرارات واعتمادات بانتظارك الآن", "Action Required — Awaiting Your Sign-Off")}
                        </h3>
                        <p className="text-xs text-zinc-500">
                          {t("اعتمد البنود الجاهزة بضغطة واحدة لبدء الجدولة والنشر في موعدها", "One-click approval keeps production and publishing on schedule")}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="divide-y divide-zinc-100">
                    {stats.clientPendingMs.slice(0, 3).map((m) => (
                      <div key={m.id} className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-start gap-3">
                          <span className="mt-0.5 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] font-code font-semibold text-zinc-700">
                            {m.cycle}
                          </span>
                          <div>
                            <p className="text-sm font-semibold text-zinc-900">{m.milestone}</p>
                            <p className="text-xs text-zinc-500 mt-0.5">{m.notes}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs font-code text-zinc-400" dir="ltr">{m.endDate}</span>
                          <button
                            type="button"
                            onClick={() => void handleApproveMilestone(m)}
                            disabled={submitting}
                            className="rounded-lg bg-emerald-600 hover:bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white cursor-pointer transition"
                          >
                            {t("اعتماد المرحلة", "Approve")}
                          </button>
                        </div>
                      </div>
                    ))}

                    {stats.feedReady.slice(0, 3).map((p) => (
                      <div key={p.id} className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] font-code font-semibold text-zinc-700">
                            {p.cycle} · {p.contentName}
                          </span>
                          <span className="rounded-md bg-violet-50 border border-violet-200 px-2 py-0.5 text-[11px] font-medium text-violet-700">
                            {p.format}
                          </span>
                          <div>
                            <p className="text-sm font-semibold text-zinc-900">
                              {p.topicTitle || `${p.format} — ${p.publishDate} (${p.cairoTime})`}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => void handleApprovePost(p)}
                            disabled={submitting}
                            className="rounded-lg bg-emerald-600 hover:bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white cursor-pointer transition"
                          >
                            {t("اعتماد البوست", "Approve Post")}
                          </button>
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
                            className="brutal-btn-outline px-2.5 py-1.5 text-xs"
                          >
                            {t("طلب تعديل", "Request Edit")}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* ── Charts Row: 3-Cycle Cards + Content Pipeline Donut ── */}
              <section className="grid gap-6 xl:grid-cols-3">
                <div className="ui-card p-6 xl:col-span-2">
                  <div className="mb-5 flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-zinc-900">
                        {t("خطة الدورات الثلاث (90-Day Rollout Cycles)", "3-Month Rollout Cycles")}
                      </h3>
                      <p className="text-xs text-zinc-500">
                        {t("اضغط على أي دورة لفتح استوديو المحتوى الخاص بها", "Select any cycle to inspect its posts, Reels, and daily Stories")}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {stats.cycleMetrics.map((c) => (
                      <div
                        key={c.name}
                        className="rounded-xl border border-zinc-200/80 bg-zinc-50/40 p-4 flex flex-col justify-between hover:border-zinc-300 transition"
                      >
                        <div>
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-bold text-zinc-900">{c.name}</span>
                            <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-[11px] font-code font-medium text-zinc-600">
                              {c.feedPct}%
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-zinc-500 font-code" dir="ltr">
                            {c.startDate} → {c.endDate}
                          </p>

                          <div className="mt-4 space-y-2.5">
                            <div>
                              <div className="flex justify-between text-[11px] mb-1">
                                <span className="text-zinc-500">{t("المراحل", "Milestones")}</span>
                                <span className="font-semibold tabular-nums text-zinc-800">{c.msDone}/{c.msTotal}</span>
                              </div>
                              <div className="h-1.5 w-full rounded-full bg-zinc-200/70 overflow-hidden">
                                <div className="h-full rounded-full bg-zinc-900" style={{ width: `${c.msPct}%` }} />
                              </div>
                            </div>

                            <div>
                              <div className="flex justify-between text-[11px] mb-1">
                                <span className="text-zinc-500">Feed & Reels</span>
                                <span className="font-semibold tabular-nums text-zinc-800">{c.feedDone}/{c.feedTotal}</span>
                              </div>
                              <div className="h-1.5 w-full rounded-full bg-zinc-200/70 overflow-hidden">
                                <div className="h-full rounded-full bg-red-600" style={{ width: `${c.feedPct}%` }} />
                              </div>
                            </div>

                            <div>
                              <div className="flex justify-between text-[11px] mb-1">
                                <span className="text-zinc-500">Daily Stories</span>
                                <span className="font-semibold tabular-nums text-zinc-800">{c.storyDone}/{c.storyTotal}</span>
                              </div>
                              <div className="h-1.5 w-full rounded-full bg-zinc-200/70 overflow-hidden">
                                <div className="h-full rounded-full bg-emerald-600" style={{ width: `${c.storyPct}%` }} />
                              </div>
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            setSelectedCycle(c.name);
                            setActiveTab("feed");
                          }}
                          className="mt-4 w-full rounded-lg border border-zinc-200 bg-white py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 cursor-pointer transition"
                        >
                          {t(`استعراض ${c.name}`, `Explore ${c.name}`)}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="ui-card p-6 flex flex-col justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-900">
                      {t("إحصائيات اعتماد البوستات", "Feed Approval Status")}
                    </h3>
                    <p className="text-xs text-zinc-500 mb-4">
                      {t("حالة الـ 36 بوست و Reel عبر الـ 3 دورات", "Across all 36 scheduled Feed Posts & Reels")}
                    </p>
                    <DonutChart
                      centerValue={`${Math.round((stats.feedApproved / Math.max(1, stats.feedTotal)) * 100)}%`}
                      centerSub={t("معتمد", "Approved")}
                      segments={[
                        { label: t("معتمد / منشور", "Approved & Live"), value: stats.feedApproved, color: "#10b981" },
                        { label: t("جاهز للمراجعة", "In Review"), value: stats.feedReady.length, color: "#f59e0b" },
                        { label: t("مطلوب تعديل", "Changes Requested"), value: stats.feedRevision, color: "#ef4444" },
                        { label: t("قيد التحضير", "Draft"), value: stats.feedDraft, color: "#a1a1aa" },
                      ]}
                    />
                  </div>
                </div>
              </section>

              {/* ── Working Rules & Digital Sign-Off ── */}
              <section className="grid gap-6 lg:grid-cols-12">
                <div className="ui-card p-6 lg:col-span-7 space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-900">
                      {t("قواعد التشغيل والنشر المتفق عليها", "Scope & Operational Working Rules")}
                    </h3>
                    <p className="text-xs text-zinc-500">
                      {t("ملخص بنود إدارة المحتوى، التسليم، والإعلانات الممولة", "Agreed framework for content, approvals, and paid media")}
                    </p>
                  </div>

                  <div className="divide-y divide-zinc-100">
                    {portal.scopeRules.map((rule) => (
                      <div key={rule.id} className="py-3 flex items-start gap-3.5">
                        <span className="w-24 shrink-0 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-center text-[11px] font-semibold text-zinc-700">
                          {rule.category}
                        </span>
                        <div className="text-xs leading-relaxed">
                          <p className="font-medium text-zinc-900">
                            {isAr ? rule.descriptionAr : rule.descriptionEn}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="ui-card p-6 lg:col-span-5 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-600">
                        <Icon d={ICONS.shield} className="h-4 w-4" />
                        {t("التوقيع والاعتماد الرسمي", "Pre-Launch Sign-Off")}
                      </span>
                      {portal.contractSigned && (
                        <span className="rounded-md bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                          ✓ {t("موقّع", "Signed")}
                        </span>
                      )}
                    </div>
                    <h3 className="mt-1 text-sm font-semibold text-zinc-900">
                      {t("تأكيد المسؤولين واعتماد بدء الخطة", "Confirm Contacts & Authorize Rollout")}
                    </h3>

                    <form onSubmit={handleSignContract} className="mt-4 space-y-3">
                      {portal.signOffChecklist.map((item) => {
                        const checked = Boolean(localChecks[item.id]);
                        return (
                          <label
                            key={item.id}
                            className={`flex items-start gap-2.5 rounded-xl border p-3 text-xs cursor-pointer transition ${
                              checked
                                ? "border-zinc-900 bg-zinc-50/80"
                                : "border-zinc-200 hover:border-zinc-300"
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
                            <span className="text-zinc-700 leading-relaxed">
                              {isAr ? item.textAr : item.textEn}
                            </span>
                          </label>
                        );
                      })}

                      <div className="grid grid-cols-2 gap-2.5 pt-1">
                        <input
                          type="text"
                          value={assetContactName}
                          onChange={(e) => setAssetContactName(e.target.value)}
                          placeholder={t("اسم مسؤول الخامات", "Asset Contact Name")}
                          className="brutal-input text-xs py-1.5"
                        />
                        <input
                          type="text"
                          value={assetContactPhone}
                          onChange={(e) => setAssetContactPhone(e.target.value)}
                          placeholder={t("رقم واتساب الخامات", "WhatsApp Number")}
                          dir="ltr"
                          className="brutal-input text-xs py-1.5"
                        />
                        <input
                          type="text"
                          value={approverName}
                          onChange={(e) => setApproverName(e.target.value)}
                          placeholder={t("اسم مسؤول الاعتماد", "Approver Name")}
                          className="brutal-input text-xs py-1.5"
                        />
                        <input
                          type="text"
                          value={approverTitle}
                          onChange={(e) => setApproverTitle(e.target.value)}
                          placeholder={t("المسمى الوظيفي", "Job Title")}
                          className="brutal-input text-xs py-1.5"
                        />
                      </div>

                      <button type="submit" disabled={submitting} className="brutal-btn w-full py-2.5 text-xs">
                        {t("اعتماد وتوقيع خطة العمل", "Authorize & Sign Rollout Plan")}
                      </button>
                    </form>
                  </div>
                </div>
              </section>
            </div>
          )}

          {/* ── TAB 2: PLANABLE-STYLE NATIVE SOCIAL FEED & REELS STUDIO ── */}
          {activeTab === "feed" && (
            <div className="space-y-5 animate-fade-in">
              {/* Studio Toolbar */}
              <div className="ui-card p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  {/* Cycle Switcher */}
                  {portal.cycles.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setSelectedCycle(c.name)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition ${
                        selectedCycle === c.name
                          ? "bg-zinc-900 text-white"
                          : "bg-zinc-100 text-zinc-600 hover:text-zinc-900"
                      }`}
                    >
                      {c.name} ({c.startDate.slice(0, 6)})
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setSelectedCycle("all")}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition ${
                      selectedCycle === "all"
                        ? "bg-zinc-900 text-white"
                        : "bg-zinc-100 text-zinc-600 hover:text-zinc-900"
                    }`}
                  >
                    {t("الكل (36)", "All (36)")}
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {/* Format Filter */}
                  <div className="flex items-center rounded-lg border border-zinc-200 bg-zinc-50 p-0.5">
                    {[
                      { id: "all", label: t("الكل", "All") },
                      { id: "reel", label: "Reels" },
                      { id: "post", label: "Posts" },
                    ].map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setFeedFormatFilter(f.id)}
                        className={`px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer ${
                          feedFormatFilter === f.id ? "bg-white text-zinc-900 shadow-xs" : "text-zinc-500"
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>

                  {/* Layout Switcher: Social Cards vs Visual Calendar */}
                  <div className="flex items-center rounded-lg border border-zinc-200 bg-zinc-50 p-0.5">
                    <button
                      type="button"
                      onClick={() => setFeedLayout("social")}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer ${
                        feedLayout === "social" ? "bg-white text-zinc-900 shadow-xs" : "text-zinc-500"
                      }`}
                    >
                      {t("معاينة السوشيال", "Social Cards")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setFeedLayout("calendar")}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer ${
                        feedLayout === "calendar" ? "bg-white text-zinc-900 shadow-xs" : "text-zinc-500"
                      }`}
                    >
                      {t("التقويم المرئي", "Calendar Grid")}
                    </button>
                  </div>

                  {selectedCycle !== "all" && (
                    <button
                      type="button"
                      onClick={() => void handleBulkApproveCycleFeed(selectedCycle)}
                      disabled={submitting}
                      className="rounded-lg bg-emerald-600 hover:bg-emerald-700 px-3.5 py-1.5 text-xs font-semibold text-white cursor-pointer transition"
                    >
                      {t(`اعتماد ${selectedCycle} بالكامل`, `Approve All ${selectedCycle}`)}
                    </button>
                  )}
                </div>
              </div>

              {feedLayout === "social" ? (
                /* ── Planable-Style Native Instagram / Facebook Social Mockup Cards ── */
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                  {cycleFeed.map((p) => {
                    const isReel = p.format === "Reel";
                    const st = statusTone(p.publishStatus);
                    const isApproved = ["Approved", "Scheduled", "Published"].includes(p.publishStatus);

                    return (
                      <article
                        key={p.id}
                        className="ui-card overflow-hidden flex flex-col justify-between transition-all hover:border-zinc-300"
                      >
                        <div>
                          {/* Social Post Top Header (Instagram / Facebook Mockup Header) */}
                          <div className="p-4 flex items-center justify-between border-b border-zinc-100">
                            <div className="flex items-center gap-2.5">
                              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-900 font-oswald text-xs font-bold text-white">
                                {portal.clientCode.slice(0, 3)}
                              </div>
                              <div>
                                <div className="flex items-center gap-1.5">
                                  <span className="text-xs font-bold text-zinc-900">
                                    {portal.clientName.toLowerCase().replace(/\s+/g, "")}.official
                                  </span>
                                  <span className="text-[10px] text-zinc-400">•</span>
                                  <span className="text-[11px] font-code font-medium text-zinc-500">
                                    {p.contentName}
                                  </span>
                                </div>
                                <p className="text-[11px] text-zinc-400" dir="ltr">
                                  {p.day}, {p.publishDate} · {p.cairoTime}
                                </p>
                              </div>
                            </div>

                            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${st.badge}`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
                              {isAr ? st.labelAr : p.publishStatus}
                            </span>
                          </div>

                          {/* Visual Media Canvas (Reel 9:16 feel or Post 4:5 canvas) */}
                          <div className="relative aspect-[16/10] w-full bg-gradient-to-br from-zinc-900 via-zinc-800 to-zinc-950 text-white p-5 flex flex-col justify-between overflow-hidden">
                            <div className="pointer-events-none absolute -right-10 -bottom-10 h-40 w-40 rounded-full bg-red-600/20 blur-2xl" />
                            <div className="relative flex items-center justify-between">
                              <span className="rounded-md bg-white/10 backdrop-blur px-2.5 py-1 text-[11px] font-semibold text-white ring-1 ring-white/15">
                                {isReel ? "Reel · 9:16 Video" : "Feed Post · Carousel / Static"}
                              </span>
                              <span className="rounded-md bg-black/40 px-2 py-0.5 text-[10px] font-code text-zinc-300">
                                {p.platforms}
                              </span>
                            </div>

                            <div className="relative my-auto py-2">
                              <p className="text-[11px] uppercase tracking-wider text-zinc-400 font-code">
                                {p.cycle} · {p.contentName}
                              </p>
                              <h3 className="mt-1 text-base font-semibold text-white line-clamp-2">
                                {p.topicTitle || t(`محتوى ${p.contentName} — ${p.publishDate}`, `${p.contentName} Creative — ${p.publishDate}`)}
                              </h3>
                            </div>

                            <div className="relative flex items-center justify-between">
                              <span className="text-[11px] text-zinc-300 font-code" dir="ltr">
                                {p.publishDate} @ {p.cairoTime}
                              </span>
                              {p.assetLink ? (
                                <a
                                  href={p.assetLink}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-1 text-xs font-semibold text-zinc-900 hover:bg-zinc-100 transition"
                                >
                                  <Icon d={ICONS.external} className="h-3.5 w-3.5" />
                                  {t("معاينة الميديا", "Open Media")}
                                </a>
                              ) : (
                                <span className="text-[11px] text-zinc-400">
                                  {t("بانتظار رفع الميديا النهائية", "Creative in production")}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Caption & Feedback Area */}
                          <div className="p-4 space-y-2.5">
                            <p className="text-xs text-zinc-600 line-clamp-3 leading-relaxed">
                              <strong className="text-zinc-900 me-1.5">{portal.clientName}</strong>
                              {p.captionText ||
                                t(
                                  `نشر متزامن على فيسبوك وإنستجرام يوم ${p.day} ${p.publishDate} الساعة ${p.cairoTime} بتوقيت القاهرة.`,
                                  `Scheduled for Facebook & Instagram on ${p.day}, ${p.publishDate} at ${p.cairoTime} Cairo time.`,
                                )}
                            </p>

                            {p.clientComment && (
                              <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-800">
                                <span className="font-semibold">{t("ملاحظتك:", "Your note:")}</span> {p.clientComment}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Three-Action Decision Bar */}
                        <div className="px-4 py-3 bg-zinc-50/60 border-t border-zinc-100 flex items-center justify-between gap-2">
                          {!isApproved ? (
                            <button
                              type="button"
                              onClick={() => void handleApprovePost(p)}
                              disabled={submitting}
                              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 py-2 text-xs font-semibold text-white cursor-pointer transition"
                            >
                              <Icon d={ICONS.check} className="h-3.5 w-3.5" />
                              {t("اعتماد البوست", "Approve")}
                            </button>
                          ) : (
                            <span className="flex-1 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600">
                              <Icon d={ICONS.check} className="h-4 w-4" />
                              {t("تم الاعتماد للنشر", "Approved for publishing")}
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
                            className="brutal-btn-outline px-3 py-1.5 text-xs"
                          >
                            <Icon d={ICONS.edit} className="h-3.5 w-3.5" />
                            {t("طلب تعديل", "Request Changes")}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                /* ── Visual 4-Week Publishing Calendar Grid (Sun / Tue / Thu Cadence) ── */
                <div className="ui-card p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-zinc-900">
                        {t("خريطة النشر الأسبوعية (الأحد · الثلاثاء · الخميس)", "Weekly Publishing Grid (Sun · Tue · Thu @ 7:00 PM)")}
                      </h3>
                      <p className="text-xs text-zinc-500">
                        {t("٣ بوستات أسبوعياً لمدة ٤ أسابيع في كل دورة (١٢ بوست/دورة)", "3 feed posts per week across 4 weeks per cycle")}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {["Sun", "Tue", "Thu"].map((dayKey) => {
                      const dayPosts = cycleFeed.filter((p) => p.day === dayKey);
                      const dayTitle =
                        dayKey === "Sun"
                          ? t("الأحد (Sunday · 7:00 PM)", "Sunday · 7:00 PM")
                          : dayKey === "Tue"
                            ? t("الثلاثاء (Tuesday · 7:00 PM)", "Tuesday · 7:00 PM")
                            : t("الخميس (Thursday · 7:00 PM)", "Thursday · 7:00 PM");
                      return (
                        <div key={dayKey} className="rounded-xl border border-zinc-200/80 bg-zinc-50/40 p-4 space-y-3">
                          <div className="flex items-center justify-between border-b border-zinc-200/70 pb-2.5">
                            <span className="text-xs font-bold text-zinc-900">{dayTitle}</span>
                            <span className="text-[11px] text-zinc-400">{dayPosts.length} posts</span>
                          </div>
                          <div className="space-y-2.5">
                            {dayPosts.map((p) => {
                              const st = statusTone(p.publishStatus);
                              return (
                                <div key={p.id} className="rounded-lg border border-zinc-200/80 bg-white p-3 space-y-2">
                                  <div className="flex items-center justify-between">
                                    <span className="text-xs font-bold text-zinc-900">
                                      {p.cycle} · {p.contentName}
                                    </span>
                                    <span className="rounded bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-700">
                                      {p.format}
                                    </span>
                                  </div>
                                  <p className="text-xs font-code text-zinc-500" dir="ltr">{p.publishDate}</p>
                                  {p.topicTitle && <p className="text-xs font-medium text-zinc-800">{p.topicTitle}</p>}
                                  <div className="flex items-center justify-between pt-1">
                                    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${st.badge}`}>
                                      <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
                                      {isAr ? st.labelAr : p.publishStatus}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => void handleApprovePost(p)}
                                      className="text-[11px] font-semibold text-emerald-600 hover:underline cursor-pointer"
                                    >
                                      {t("اعتماد ✓", "Approve ✓")}
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── TAB 3: INSTAGRAM-STYLE WEEKLY STORY DECK (NOT an 84-row Excel sheet!) ── */}
          {activeTab === "stories" && (
            <div className="space-y-5 animate-fade-in">
              {/* Cycle & Week Selector Bar */}
              <div className="ui-card p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div>
                  <h2 className="text-base font-semibold text-zinc-900">
                    {t("استوديو الـ Stories اليومية (٦:٠٠ مساءً بتوقيت القاهرة)", "Daily Stories Deck — 6:00 PM Cairo Time")}
                  </h2>
                  <p className="text-xs text-zinc-500">
                    {t(
                      "اختر الدورة والأسبوع لاستعراض الـ 7 استوريهات اليومية شاملة الجمعة والسبت في كروت مرئية",
                      "Browse your daily stories week by week in vertical 9:16 story cards",
                    )}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {portal.cycles.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setSelectedCycle(c.name);
                        setSelectedStoryWeek(0);
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition ${
                        (selectedCycle === "all" ? "Cycle 01" : selectedCycle) === c.name
                          ? "bg-zinc-900 text-white"
                          : "bg-zinc-100 text-zinc-600 hover:text-zinc-900"
                      }`}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Week Tabs + Bulk Week Approve */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 overflow-x-auto">
                  {storyWeeks.map((wk, idx) => {
                    const first = wk[0];
                    const last = wk[wk.length - 1];
                    const active = selectedStoryWeek === idx;
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setSelectedStoryWeek(idx)}
                        className={`px-4 py-2 rounded-xl border text-xs font-semibold cursor-pointer transition ${
                          active
                            ? "border-zinc-900 bg-zinc-900 text-white shadow-xs"
                            : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300"
                        }`}
                      >
                        {t(`الأسبوع ${idx + 1}`, `Week ${idx + 1}`)}
                        {first && last && (
                          <span className="ms-2 font-code text-[11px] opacity-75" dir="ltr">
                            ({first.publishDate.slice(0, 6)} – {last.publishDate.slice(0, 6)})
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={() => void handleBulkApproveWeekStories(activeWeekStories)}
                  disabled={submitting}
                  className="rounded-lg bg-emerald-600 hover:bg-emerald-700 px-4 py-2 text-xs font-semibold text-white cursor-pointer transition"
                >
                  {t(`اعتماد استوريهات الأسبوع ${selectedStoryWeek + 1} بالكامل`, `Approve All Week ${selectedStoryWeek + 1} Stories`)}
                </button>
              </div>

              {/* 7 Vertical 9:16 Phone Story Cards for the Selected Week */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3.5">
                {activeWeekStories.map((s) => {
                  const st = statusTone(s.publishStatus);
                  const isWeekend = s.day === "Fri" || s.day === "Sat";
                  const isApproved = ["Approved", "Scheduled", "Published"].includes(s.publishStatus);

                  return (
                    <div
                      key={s.id}
                      className="ui-card overflow-hidden flex flex-col justify-between transition-all hover:-translate-y-0.5 hover:border-zinc-300"
                    >
                      {/* Vertical 9:16 Phone Story Mockup Frame */}
                      <div
                        onClick={() => setActiveStoryPlayer(s)}
                        className="relative aspect-[9/14] bg-gradient-to-b from-zinc-900 via-zinc-900 to-zinc-950 p-3.5 text-white flex flex-col justify-between cursor-pointer group"
                      >
                        {/* Story Progress Bar at Top */}
                        <div className="space-y-2">
                          <div className="h-0.5 w-full rounded-full bg-white/25 overflow-hidden">
                            <div className={`h-full ${isApproved ? "w-full bg-emerald-400" : "w-1/2 bg-white"}`} />
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-tr from-amber-500 to-red-600 text-[10px] font-bold">
                                {portal.clientCode.slice(0, 2)}
                              </span>
                              <span className="text-[11px] font-semibold">{s.storyId}</span>
                            </div>
                            {isWeekend && (
                              <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-amber-300">
                                Weekend
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Story Center Content */}
                        <div className="my-auto text-center px-1 space-y-1.5">
                          <p className="text-[11px] font-code text-zinc-400" dir="ltr">
                            {s.day} · {s.publishDate}
                          </p>
                          <p className="text-xs font-semibold text-white line-clamp-3">
                            {s.topicAssetLink && !s.topicAssetLink.startsWith("http")
                              ? s.topicAssetLink
                              : t(`ستوري تفاعلي يومي — ${s.publishDate}`, `Daily Interactive Story — ${s.publishDate}`)}
                          </p>
                          <span className="inline-block rounded-full bg-white/10 px-2.5 py-0.5 text-[10px] text-zinc-300 group-hover:bg-white/20 transition">
                            {t("معاينة الاستوري", "Preview Story")}
                          </span>
                        </div>

                        {/* Story Footer */}
                        <div className="flex items-center justify-between text-[10px] text-zinc-400 font-code" dir="ltr">
                          <span>{s.cairoTime}</span>
                          <span>{s.platforms}</span>
                        </div>
                      </div>

                      {/* Story Card Decision Controls */}
                      <div className="p-2.5 bg-white space-y-2">
                        <div className="flex items-center justify-between">
                          <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${st.badge}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
                            {isAr ? st.labelAr : s.publishStatus}
                          </span>
                        </div>

                        <div className="flex items-center gap-1">
                          {!isApproved ? (
                            <button
                              type="button"
                              onClick={() => void handleApproveStory(s)}
                              disabled={submitting}
                              className="flex-1 rounded-md bg-emerald-600 hover:bg-emerald-700 py-1.5 text-[11px] font-semibold text-white cursor-pointer transition"
                            >
                              {t("اعتماد", "Approve")}
                            </button>
                          ) : (
                            <span className="flex-1 text-center text-[11px] font-semibold text-emerald-600 py-1">
                              ✓ {t("معتمد", "Approved")}
                            </span>
                          )}
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
                            className="rounded-md border border-zinc-200 px-2 py-1.5 text-[11px] text-zinc-600 hover:bg-zinc-50 cursor-pointer"
                            title={t("إضافة ملاحظة", "Add Note")}
                          >
                            <Icon d={ICONS.chat} className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── TAB 4: LINEAR-STYLE VISUAL PRODUCTION ROADMAP (NOT a spreadsheet!) ── */}
          {activeTab === "timeline" && (
            <div className="space-y-6 animate-fade-in">
              {portal.cycles
                .filter((c) => selectedCycle === "all" || c.name === selectedCycle)
                .map((c) => {
                  const cycleMs = portal.milestones.filter((m) => m.cycle === c.name);
                  const doneCount = cycleMs.filter((m) => m.status === "Done").length;
                  return (
                    <section key={c.id} className="ui-card p-6">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-zinc-100">
                        <div>
                          <div className="flex items-center gap-2.5">
                            <span className="rounded-lg bg-zinc-900 px-2.5 py-1 text-xs font-bold text-white">
                              {c.name}
                            </span>
                            <h3 className="text-base font-semibold text-zinc-900" dir="ltr">
                              {c.startDate} → {c.endDate}
                            </h3>
                          </div>
                        </div>
                        <span className="text-xs font-medium text-zinc-500">
                          {t(`مكتمل ${doneCount} من ${cycleMs.length} مراحل`, `${doneCount} of ${cycleMs.length} milestones completed`)}
                        </span>
                      </div>

                      {/* Connected Vertical Stepper */}
                      <ol className="relative mt-5 space-y-4 before:absolute before:top-3 before:bottom-3 before:start-4 before:w-px before:bg-zinc-200">
                        {cycleMs.map((m) => {
                          const st = statusTone(m.status);
                          const isClientOwner = m.owner.toLowerCase().includes("arc");
                          const isAssetsRow = m.milestone.toLowerCase().includes("asset");
                          const isDone = m.status === "Done";

                          return (
                            <li key={m.id} className="relative ps-10">
                              <span
                                className={`absolute start-2 top-3.5 flex h-4 w-4 items-center justify-center rounded-full ring-4 ring-white ${
                                  isDone
                                    ? "bg-emerald-500 text-white"
                                    : isClientOwner
                                      ? "bg-amber-500"
                                      : "bg-zinc-300"
                                }`}
                              />
                              <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/40 p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 hover:border-zinc-300 transition">
                                <div className="space-y-1 max-w-2xl">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-sm font-semibold text-zinc-900">{m.milestone}</span>
                                    <span
                                      className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${
                                        isClientOwner
                                          ? "border-red-200 bg-red-50 text-red-700"
                                          : "border-zinc-200 bg-white text-zinc-600"
                                      }`}
                                    >
                                      {m.owner}
                                    </span>
                                    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${st.badge}`}>
                                      <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
                                      {isAr ? st.labelAr : m.status}
                                    </span>
                                  </div>
                                  <p className="text-xs text-zinc-600 leading-relaxed">{m.notes}</p>
                                  {m.linkEvidence && (
                                    <a
                                      href={m.linkEvidence}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 hover:underline pt-1"
                                    >
                                      <Icon d={ICONS.external} className="h-3.5 w-3.5" />
                                      {t("فتح الملفات / الرابط المرفق", "Open Deliverable Link")}
                                    </a>
                                  )}
                                  {m.clientComment && (
                                    <p className="text-xs text-emerald-700 pt-1">
                                      {t("ملاحظتك المسجلة:", "Your comment:")} {m.clientComment}
                                    </p>
                                  )}
                                </div>

                                <div className="flex flex-wrap items-center gap-2 shrink-0">
                                  <span className="text-xs font-code text-zinc-500 me-2" dir="ltr">
                                    {m.startDate} {m.endDate && m.endDate !== m.startDate ? `→ ${m.endDate}` : ""}
                                  </span>

                                  {isClientOwner && !isDone && (
                                    <button
                                      type="button"
                                      onClick={() => void handleApproveMilestone(m)}
                                      disabled={submitting}
                                      className="rounded-lg bg-emerald-600 hover:bg-emerald-700 px-3.5 py-1.5 text-xs font-semibold text-white cursor-pointer transition"
                                    >
                                      {t("اعتماد المرحلة", "Approve Milestone")}
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
                                      className="brutal-btn-outline px-3 py-1.5 text-xs"
                                    >
                                      <Icon d={ICONS.upload} className="h-3.5 w-3.5" />
                                      {t("إرفاق خامات المشروع", "Attach Assets Link")}
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
                                    className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 cursor-pointer"
                                  >
                                    {t("ملاحظة", "Comment")}
                                  </button>
                                </div>
                              </div>
                            </li>
                          );
                        })}
                      </ol>
                    </section>
                  );
                })}
            </div>
          )}

          {/* ── TAB 5: PAID MEDIA CAMPAIGNS & ACTIVITY FEED ── */}
          {activeTab === "ads" && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fade-in">
              <div className="lg:col-span-2 space-y-4">
                <div className="ui-card p-6 space-y-4">
                  <div>
                    <h2 className="text-base font-semibold text-zinc-900">
                      {t("حملات الإعلانات الممولة وتقارير الأداء (Meta Ads)", "Paid Media Campaigns & Monthly Reports")}
                    </h2>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      {t("اعتماد الهدف الإعلاني والميزانية والتصميم لإطلاق الحملات الممولة", "Review and approve campaign objectives, budgets, and creatives")}
                    </p>
                  </div>

                  <div className="space-y-4">
                    {portal.paidCampaigns.map((camp) => {
                      const st = statusTone(camp.status);
                      return (
                        <div key={camp.id} className="rounded-xl border border-zinc-200/80 bg-zinc-50/40 p-5 space-y-4">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <span className="text-xs font-code font-semibold text-red-600">
                                {camp.cycle} · {camp.platforms}
                              </span>
                              <h3 className="text-base font-semibold text-zinc-900 mt-0.5">{camp.campaignName}</h3>
                              <p className="text-xs text-zinc-500 mt-1">
                                {t("الهدف الإعلاني:", "Objective:")}{" "}
                                <strong className="text-zinc-900">{camp.objective}</strong>
                              </p>
                            </div>
                            <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${st.badge}`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
                              {camp.status}
                            </span>
                          </div>

                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                            <div className="rounded-lg border border-zinc-200/80 bg-white p-3">
                              <span className="text-zinc-400 text-[11px]">{t("الميزانية المعتمدة", "Budget")}</span>
                              <p className="text-sm font-bold tabular-nums text-zinc-900 mt-0.5">
                                EGP {camp.budgetEgp.toLocaleString()}
                              </p>
                            </div>
                            <div className="rounded-lg border border-zinc-200/80 bg-white p-3">
                              <span className="text-zinc-400 text-[11px]">{t("ربط الحساب الإعلاني", "Ad Account Access")}</span>
                              <p className="font-semibold text-zinc-900 mt-0.5">
                                {camp.adAccountAccessConfirmed ? t("مفعّل", "Confirmed") : t("قيد الربط", "Pending")}
                              </p>
                            </div>
                            <div className="rounded-lg border border-zinc-200/80 bg-white p-3 flex flex-col justify-center">
                              {camp.reportLink ? (
                                <a
                                  href={camp.reportLink}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-red-600 font-semibold hover:underline"
                                >
                                  {t("تحميل تقرير الأداء ↗", "Open Report ↗")}
                                </a>
                              ) : (
                                <span className="text-zinc-400 text-[11px]">
                                  {t("يصدر بنهاية الدورة", "Issued at cycle end")}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-zinc-200/70">
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
                                    showToast(t("تم اعتماد الحملة الإعلانية", "Campaign approved"));
                                  } finally {
                                    setSubmitting(false);
                                  }
                                }}
                                className="rounded-lg bg-emerald-600 hover:bg-emerald-700 px-4 py-2 text-xs font-semibold text-white cursor-pointer"
                              >
                                {t("اعتماد الحملة والميزانية", "Approve Campaign")}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="ui-card p-5">
                  <h3 className="text-sm font-semibold text-zinc-900">
                    {t("رسالة مباشرة لفريق إدارة الحساب", "Direct Message to Account Manager")}
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
                        showToast(t("تم إرسال رسالتك لفريق الوكالة", "Message sent"));
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
                      placeholder={t("اكتب أي ملاحظة أو توجيه ليصل فوراً للأكونت مانجر...", "Write a note for your Account Manager...")}
                      className="brutal-input text-xs"
                    />
                    <button type="submit" disabled={submitting} className="brutal-btn w-full py-2 text-xs">
                      {t("إرسال الملاحظة", "Send Message")}
                    </button>
                  </form>
                </div>

                <div className="ui-card p-5">
                  <h3 className="text-sm font-semibold text-zinc-900 mb-3">
                    {t("سجل الاعتمادات والتعديلات", "Approval & Revision Log")}
                  </h3>
                  {interactions.length === 0 ? (
                    <p className="text-xs text-zinc-500">
                      {t("لم يتم تسجيل حركات بعد.", "No activity logged yet.")}
                    </p>
                  ) : (
                    <div className="space-y-2.5 max-h-96 overflow-y-auto">
                      {[...interactions].reverse().map((ev) => (
                        <div key={ev.id} className="rounded-lg border border-zinc-200/80 bg-zinc-50/60 p-3 text-xs space-y-1">
                          <div className="flex items-center justify-between text-[11px] text-zinc-400">
                            <strong className="text-zinc-800">{ev.actorName}</strong>
                            <span dir="ltr">
                              {new Date(ev.createdAtIso).toLocaleString([], {
                                month: "short",
                                day: "2-digit",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          </div>
                          <p className="font-semibold text-zinc-900">{ev.targetLabel}</p>
                          {ev.comment && <p className="text-zinc-600">{ev.comment}</p>}
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

      {/* ── STORY FULLSCREEN PHONE PLAYER OVERLAY ── */}
      {activeStoryPlayer && (
        <div
          className="fixed inset-0 z-50 bg-zinc-950/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setActiveStoryPlayer(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xs rounded-3xl border border-white/15 bg-zinc-900 text-white overflow-hidden shadow-2xl"
          >
            <div className="aspect-[9/16] p-5 flex flex-col justify-between bg-gradient-to-b from-zinc-900 via-zinc-800 to-zinc-950">
              <div className="space-y-3">
                <div className="h-1 w-full rounded-full bg-white/20 overflow-hidden">
                  <div className="h-full w-full bg-white animate-pulse" />
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-red-600 text-xs font-bold">
                      {portal.clientCode.slice(0, 2)}
                    </span>
                    <div>
                      <p className="text-xs font-bold">{portal.clientName}</p>
                      <p className="text-[10px] text-zinc-400" dir="ltr">
                        {activeStoryPlayer.publishDate} · {activeStoryPlayer.cairoTime}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveStoryPlayer(null)}
                    className="rounded-full bg-white/10 px-2.5 py-1 text-xs hover:bg-white/20 cursor-pointer"
                  >
                    ✕
                  </button>
                </div>
              </div>

              <div className="my-auto text-center space-y-3 px-2">
                <span className="rounded-md bg-white/10 px-2.5 py-1 text-xs font-code text-zinc-300">
                  {activeStoryPlayer.cycle} · {activeStoryPlayer.storyId}
                </span>
                <h3 className="text-lg font-semibold">
                  {activeStoryPlayer.topicAssetLink && !activeStoryPlayer.topicAssetLink.startsWith("http")
                    ? activeStoryPlayer.topicAssetLink
                    : t(`ستوري يوم ${activeStoryPlayer.publishDate}`, `Daily Story — ${activeStoryPlayer.publishDate}`)}
                </h3>
                {activeStoryPlayer.topicAssetLink?.startsWith("http") && (
                  <a
                    href={activeStoryPlayer.topicAssetLink}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-2 text-xs font-semibold text-zinc-900"
                  >
                    <Icon d={ICONS.external} className="h-3.5 w-3.5" />
                    {t("فتح ملف الاستوري الأصلي", "Open Story File")}
                  </a>
                )}
              </div>

              <div className="flex items-center gap-2 pt-3 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => {
                    void handleApproveStory(activeStoryPlayer);
                    setActiveStoryPlayer(null);
                  }}
                  className="flex-1 rounded-xl bg-emerald-500 hover:bg-emerald-400 py-2.5 text-xs font-bold text-zinc-950 cursor-pointer"
                >
                  {t("اعتماد الاستوري", "Approve Story")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── NATIVE <dialog> MODAL FOR REVISIONS & ASSET LINKS (modern-web-guidance: dialog) ── */}
      <dialog
        ref={dialogRef}
        aria-labelledby="client-action-dialog-title"
        onClose={() => setActionModal(null)}
        onClick={(e) => {
          const dlg = dialogRef.current;
          if (!dlg) return;
          const r = dlg.getBoundingClientRect();
          if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) {
            dlg.close();
          }
        }}
        className="m-auto w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 text-zinc-900 shadow-2xl"
      >
        {actionModal && (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 id="client-action-dialog-title" className="text-base font-semibold text-zinc-900">
                  {actionModal.mode === "milestone_assets"
                    ? t("إرفاق رابط خامات المشروع", "Submit Project Assets Link")
                    : actionModal.mode === "post_revision"
                      ? t("طلب تعديل على المحتوى", "Request Content Revision")
                      : t("إضافة ملاحظة للفريق", "Add Review Note")}
                </h2>
                <p className="text-xs font-code text-zinc-500 mt-0.5">{actionModal.targetLabel}</p>
              </div>
              <button
                type="button"
                onClick={() => setActionModal(null)}
                aria-label="Close"
                className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmitModalAction} className="space-y-3.5">
              {(actionModal.mode === "milestone_assets" ||
                actionModal.mode === "milestone_note" ||
                actionModal.mode === "story_revision") && (
                <div>
                  <label className="block text-xs font-medium text-zinc-700 mb-1">
                    {t("رابط الملفات (Google Drive / WeTransfer)", "Assets / Reference URL")}
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
                  {t("التفاصيل أو التعديلات المطلوبة", "Revision Notes")}
                </label>
                <textarea
                  rows={3}
                  autoFocus
                  required={actionModal.mode !== "milestone_assets"}
                  value={modalComment}
                  onChange={(e) => setModalComment(e.target.value)}
                  placeholder={t("اكتب ملاحظتك بالتفصيل ليتم تنفيذها فوراً...", "Describe the requested changes...")}
                  className="brutal-input text-xs"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setActionModal(null)}
                  className="brutal-btn-outline px-4 py-2 text-xs"
                >
                  {t("إلغاء", "Cancel")}
                </button>
                <button type="submit" disabled={submitting} className="brutal-btn px-5 py-2 text-xs">
                  {t("حفظ وإرسال", "Submit")}
                </button>
              </div>
            </form>
          </div>
        )}
      </dialog>
    </div>
  );
}

export default function ClientPortalPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center bg-[var(--mft-bg)]">
          <div className="flex flex-col items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-900 font-oswald text-sm font-bold text-white">
              M
            </div>
            <p className="text-xs font-medium text-zinc-500">Loading Client Studio…</p>
          </div>
        </div>
      }
    >
      <ClientPortalInner />
    </Suspense>
  );
}
