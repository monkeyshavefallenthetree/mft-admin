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

function statusBadgeClass(status: string): string {
  const s = status.toLowerCase();
  if (s === "done" || s === "published" || s === "approved" || s === "completed") {
    return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
  }
  if (s.includes("progress") || s === "scheduled" || s === "active") {
    return "bg-sky-500/15 text-sky-400 border-sky-500/30";
  }
  if (s.includes("wait") || s.includes("review")) {
    return "bg-amber-500/15 text-amber-300 border-amber-500/40 animate-pulse";
  }
  if (s.includes("revision") || s.includes("delay")) {
    return "bg-rose-500/15 text-rose-400 border-rose-500/30";
  }
  return "bg-zinc-800 text-zinc-400 border-zinc-700";
}

function ownerBadgeClass(owner: string): string {
  const o = owner.toLowerCase();
  if (o.includes("arc")) {
    return "bg-amber-500/20 text-amber-300 border-amber-500/40";
  }
  if (o.includes("media")) {
    return "bg-violet-500/20 text-violet-300 border-violet-500/40";
  }
  return "bg-zinc-800 text-zinc-300 border-zinc-700";
}

function ClientPortalInner() {
  const searchParams = useSearchParams();
  const [lang, setLang] = useState<"ar" | "en">("ar");
  const isAr = lang === "ar";
  const t = (ar: string, en: string) => (isAr ? ar : en);

  const [portalsMap, setPortalsMap] = useState<Record<string, ClientRolloutPortal>>({
    [ARC_DEFAULT_PORTAL.id]: ARC_DEFAULT_PORTAL,
  });
  const [activePortalId, setActivePortalId] = useState<string | null>(null);
  const [interactions, setInteractions] = useState<ClientPortalInteraction[]>([]);

  // Login Form State
  const [loginCode, setLoginCode] = useState("");
  const [loginPin, setLoginPin] = useState("");
  const [clientActorName, setClientActorName] = useState("");
  const [loginError, setLoginError] = useState("");

  // Navigation & Filters
  const [activeTab, setActiveTab] = useState<PortalTab>("overview");
  const [selectedCycle, setSelectedCycle] = useState<string>("all");
  const [feedViewMode, setFeedViewMode] = useState<"grid" | "table">("grid");
  const [feedFormatFilter, setFeedFormatFilter] = useState<string>("all");
  const [storyStatusFilter, setStoryStatusFilter] = useState<string>("all");
  const [timelineOwnerFilter, setTimelineOwnerFilter] = useState<string>("all");

  // Interactive Modals
  const [actionModal, setActionModal] = useState<{
    mode: "milestone_assets" | "milestone_note" | "post_revision" | "story_revision";
    targetId: string;
    targetLabel: string;
    initialLink?: string;
    initialComment?: string;
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

  // Subscribe to portals
  useEffect(() => {
    return subscribeClientPortals((map) => {
      setPortalsMap(map);
    });
  }, []);

  // Restore saved session or auto-login from URL query (?code=ARC&pin=2026)
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

  // Subscribe to interactions for the active portal
  useEffect(() => {
    if (!activePortalId) return;
    return subscribePortalInteractions(activePortalId, setInteractions);
  }, [activePortalId]);

  const portal = useMemo(() => {
    if (!activePortalId) return null;
    const base = portalsMap[activePortalId] || ARC_DEFAULT_PORTAL;
    return applyClientInteractionsToPortal(base, interactions);
  }, [activePortalId, portalsMap, interactions]);

  // Sync contact fields when portal loads
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

  // Computed metrics
  const stats = useMemo(() => {
    if (!portal) {
      return {
        msDone: 0,
        msTotal: 0,
        clientPendingMs: [] as MilestoneItem[],
        feedApprovedOrPublished: 0,
        feedTotal: 0,
        feedReadyForReview: [] as FeedPostItem[],
        storiesApprovedOrPublished: 0,
        storiesTotal: 0,
        overallPct: 0,
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
    const feedReadyForReview = portal.feedCalendar.filter(
      (f) => f.publishStatus === "Ready for Review",
    );

    const storiesApprovedOrPublished = portal.dailyStories.filter((s) =>
      ["Approved", "Scheduled", "Published"].includes(s.publishStatus),
    ).length;
    const storiesTotal = portal.dailyStories.length;

    const totalItems = msTotal + feedTotal + storiesTotal;
    const completedItems = msDone + feedApprovedOrPublished + storiesApprovedOrPublished;
    const overallPct = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;

    return {
      msDone,
      msTotal,
      clientPendingMs,
      feedApprovedOrPublished,
      feedTotal,
      feedReadyForReview,
      storiesApprovedOrPublished,
      storiesTotal,
      overallPct,
    };
  }, [portal]);

  // Filtered Lists
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
      return true;
    });
  }, [portal, selectedCycle, feedFormatFilter]);

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

  // ── 1. CLIENT LOGIN SCREEN ──
  if (!portal) {
    return (
      <div
        dir={isAr ? "rtl" : "ltr"}
        className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col justify-between relative overflow-hidden selection:bg-amber-500 selection:text-zinc-950"
      >
        {/* Ambient Luxury Glow */}
        <div className="pointer-events-none fixed inset-0">
          <div className="absolute -top-40 left-1/2 -translate-x-1/2 h-96 w-[44rem] rounded-full bg-amber-500/10 blur-3xl" />
          <div className="absolute bottom-0 right-0 h-80 w-80 rounded-full bg-red-600/10 blur-3xl" />
        </div>

        <header className="relative z-10 mx-auto w-full max-w-6xl px-6 py-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 text-zinc-950 font-black flex items-center justify-center text-lg shadow-lg shadow-amber-500/20">
              MFT
            </div>
            <div>
              <p className="text-xs font-bold tracking-widest uppercase text-amber-400">
                MFT Agency · Client Rollout Portal
              </p>
              <p className="text-[11px] text-zinc-400">
                {t("بوابة متابعة واعتماد خطط السوشيال ميديا والإنتاج", "Social Media Production, Calendar & Approvals Suite")}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setLang(isAr ? "en" : "ar")}
            className="px-3.5 py-1.5 rounded-full border border-zinc-800 bg-zinc-900/80 hover:border-amber-500/50 text-xs font-bold text-zinc-200 cursor-pointer transition"
          >
            {isAr ? "English (EN)" : "العربية (AR)"}
          </button>
        </header>

        <main className="relative z-10 flex-1 flex items-center justify-center px-4 py-8">
          <div className="w-full max-w-md rounded-3xl border border-zinc-800/90 bg-zinc-900/75 backdrop-blur-xl p-8 shadow-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[11px] font-bold text-amber-300">
              <span>✨</span>
              <span>{t("بوابة العملاء الخاصة", "Dedicated Client Workspace")}</span>
            </div>

            <h1 className="mt-4 text-2xl font-black tracking-tight text-white">
              {t("تسجيل دخول العميل", "Client Portal Sign In")}
            </h1>
            <p className="mt-1.5 text-xs text-zinc-400 leading-relaxed">
              {t(
                "أدخل كود المشروع والرقم السري لمتابعة الجدول الزمني، اعتماد البوستات والـ Reels والـ Stories، ومراجعة خطة الـ ٣ أشهر.",
                "Enter your Client Code & PIN to review your 3-month rollout plan, approve feed posts & daily stories, and track milestones.",
              )}
            </p>

            <form onSubmit={handleLogin} className="mt-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-zinc-300 mb-1.5">
                  {t("كود العميل / المشروع (Client Code)", "Client / Project Code")}
                </label>
                <input
                  type="text"
                  required
                  value={loginCode}
                  onChange={(e) => setLoginCode(e.target.value)}
                  placeholder="ARC"
                  dir="ltr"
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm font-mono font-bold uppercase tracking-wider text-white placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-300 mb-1.5">
                  {t("كود الدخول السري (Access PIN)", "Access PIN")}
                </label>
                <input
                  type="password"
                  required
                  value={loginPin}
                  onChange={(e) => setLoginPin(e.target.value)}
                  placeholder="••••"
                  dir="ltr"
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm font-mono font-bold tracking-widest text-white placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-300 mb-1.5">
                  {t("اسمك (ليظهر في سجل الاعتمادات - اختياري)", "Your Name (for approval logs - optional)")}
                </label>
                <input
                  type="text"
                  value={clientActorName}
                  onChange={(e) => setClientActorName(e.target.value)}
                  placeholder={t("مثال: أ. أحمد — مدير التسويق بـ ARC", "e.g. ARC Marketing Director")}
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-2.5 text-xs text-white placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none"
                />
              </div>

              {loginError && (
                <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs font-bold text-rose-300">
                  {loginError}
                </div>
              )}

              <button
                type="submit"
                className="w-full rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-zinc-950 font-black py-3 text-sm shadow-lg shadow-amber-500/20 transition cursor-pointer"
              >
                {t("دخول إلى بوابة العميل ←", "Enter Client Portal →")}
              </button>
            </form>

            {/* Quick Fill Card for ARC */}
            <div className="mt-6 pt-5 border-t border-zinc-800/80 flex items-center justify-between gap-2">
              <div className="text-[11px] text-zinc-400">
                <span className="font-bold text-zinc-200">ARC Rollout Plan:</span>{" "}
                <code className="text-amber-300">ARC</code> / PIN <code className="text-amber-300">2026</code>
              </div>
              <button
                type="button"
                onClick={() => {
                  setLoginCode("ARC");
                  setLoginPin("2026");
                }}
                className="px-3 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-[11px] font-bold text-amber-300 cursor-pointer transition"
              >
                {t("تعبئة سريعة (ARC)", "Quick Fill ARC")}
              </button>
            </div>
          </div>
        </main>

        <footer className="relative z-10 py-4 text-center text-[11px] text-zinc-600">
          MFT Agency · Cairo Local Time ({cairoTimeStr || "GMT+2"})
        </footer>
      </div>
    );
  }

  // ── 2. AUTHENTICATED CLIENT PORTAL WORKSPACE ──
  return (
    <div
      dir={isAr ? "rtl" : "ltr"}
      className="min-h-screen bg-zinc-950 text-zinc-100 pb-20 selection:bg-amber-500 selection:text-zinc-950"
    >
      {/* Floating Toast Notification */}
      {toastMsg && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-2xl border border-amber-500/40 bg-zinc-900/95 px-5 py-3 text-xs font-bold text-amber-300 shadow-2xl backdrop-blur-md">
          {toastMsg}
        </div>
      )}

      {/* ── Top Executive Header ── */}
      <header className="sticky top-0 z-30 border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-4 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start sm:items-center gap-3.5">
            <div className="h-12 w-12 shrink-0 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 text-zinc-950 font-black flex items-center justify-center text-lg shadow-lg shadow-amber-500/20">
              {portal.clientCode.slice(0, 3)}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-amber-500/15 border border-amber-500/30 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">
                  {portal.contractSigned
                    ? t("✓ الخطة معتمدة وموقعة", "✓ Signed & Approved Rollout")
                    : t("● مسودة للمراجعة والاعتماد", "● Draft for Client Review")}
                </span>
                <span className="text-[11px] text-zinc-400 font-mono">
                  🕒 {t("توقيت القاهرة:", "Cairo Time:")} {cairoTimeStr}
                </span>
              </div>
              <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white mt-0.5">
                {portal.projectTitle}
              </h1>
              <p className="text-xs text-zinc-400">{portal.subtitle}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Cycle Filter Selector */}
            <div className="flex items-center rounded-xl border border-zinc-800 bg-zinc-900 p-1">
              {[
                { key: "all", label: t("كل الدورات (3 شهور)", "All 3 Cycles") },
                ...portal.cycles.map((c) => ({ key: c.name, label: c.name })),
              ].map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setSelectedCycle(c.key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                    selectedCycle === c.key
                      ? "bg-amber-400 text-zinc-950 shadow-sm"
                      : "text-zinc-400 hover:text-white"
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>

            {portal.googleSheetUrl && (
              <a
                href={portal.googleSheetUrl}
                target="_blank"
                rel="noreferrer"
                className="px-3 py-2 rounded-xl border border-zinc-800 bg-zinc-900 hover:border-zinc-700 text-xs font-bold text-zinc-300 transition"
              >
                📊 Google Sheet ↗
              </a>
            )}

            <button
              type="button"
              onClick={() => setLang(isAr ? "en" : "ar")}
              className="px-3 py-2 rounded-xl border border-zinc-800 bg-zinc-900 hover:border-amber-500/40 text-xs font-bold text-zinc-200 cursor-pointer"
            >
              {isAr ? "EN" : "عربي"}
            </button>

            <button
              type="button"
              onClick={handleLogout}
              className="px-3 py-2 rounded-xl border border-zinc-800 bg-zinc-900 hover:bg-rose-500/15 hover:border-rose-500/40 hover:text-rose-300 text-xs font-bold text-zinc-400 cursor-pointer transition"
            >
              {t("خروج", "Sign Out")}
            </button>
          </div>
        </div>

        {/* Navigation Tabs Bar */}
        <div className="mx-auto max-w-7xl px-4 sm:px-6 flex items-center gap-1 overflow-x-auto pb-2">
          {(
            [
              {
                id: "overview",
                label: t("١. نظرة عامة والقواعد والاعتماد", "1. Overview & Sign-Off"),
                badge: !portal.contractSigned ? t("مطلوب توقيع", "Sign-off") : undefined,
              },
              {
                id: "timeline",
                label: t("٢. الجدول الزمني الرئيسي (Master Timeline)", "2. Master Timeline"),
                badge: stats.clientPendingMs.length > 0 ? `${stats.clientPendingMs.length}` : undefined,
              },
              {
                id: "feed",
                label: t(`٣. كالندر البوستات والـ Reels (${portal.feedCalendar.length})`, `3. Feed Calendar (${portal.feedCalendar.length})`),
                badge: stats.feedReadyForReview.length > 0 ? `${stats.feedReadyForReview.length} للمراجعة` : undefined,
              },
              {
                id: "stories",
                label: t(`٤. الـ Stories اليومية (${portal.dailyStories.length})`, `4. Daily Stories (${portal.dailyStories.length})`),
              },
              {
                id: "ads",
                label: t("٥. الإعلانات الممولة وسجل المتابعة", "5. Paid Media & Activity Log"),
              },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2.5 rounded-xl text-xs font-extrabold whitespace-nowrap flex items-center gap-2 transition cursor-pointer ${
                activeTab === tab.id
                  ? "bg-white text-zinc-950 shadow-md"
                  : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
              }`}
            >
              <span>{tab.label}</span>
              {"badge" in tab && tab.badge && (
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                    activeTab === tab.id
                      ? "bg-amber-500 text-zinc-950"
                      : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                  }`}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 sm:px-6 pt-6 space-y-6">
        {/* ── Top KPI Summary Strip ── */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="rounded-2xl border border-zinc-800/90 bg-zinc-900/60 p-4">
            <p className="text-[11px] font-bold text-zinc-400">
              {t("إجمالي تقدم الخطة", "Overall Rollout Progress")}
            </p>
            <p className="mt-1 text-2xl font-black text-amber-400">{stats.overallPct}%</p>
            <div className="mt-2 h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-amber-400 to-emerald-400 transition-all duration-500"
                style={{ width: `${stats.overallPct}%` }}
              />
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-800/90 bg-zinc-900/60 p-4">
            <p className="text-[11px] font-bold text-zinc-400">
              {t("مراحل الجدول الزمني", "Timeline Milestones")}
            </p>
            <p className="mt-1 text-2xl font-black text-white">
              {stats.msDone} <span className="text-sm font-normal text-zinc-500">/ {stats.msTotal}</span>
            </p>
            <p className="mt-1 text-[11px] text-amber-300">
              {stats.clientPendingMs.length > 0
                ? t(`${stats.clientPendingMs.length} مراحل بانتظار اعتمادك`, `${stats.clientPendingMs.length} awaiting your action`)
                : t("✓ كل المراحل الحالية معتمدة", "✓ All current milestones approved")}
            </p>
          </div>

          <div className="rounded-2xl border border-zinc-800/90 bg-zinc-900/60 p-4">
            <p className="text-[11px] font-bold text-zinc-400">
              {t("بوستات الـ Feed والـ Reels", "Feed Posts & Reels (Sun/Tue/Thu)")}
            </p>
            <p className="mt-1 text-2xl font-black text-white">
              {stats.feedApprovedOrPublished}{" "}
              <span className="text-sm font-normal text-zinc-500">/ {stats.feedTotal}</span>
            </p>
            <p className="mt-1 text-[11px] text-zinc-400">
              {t("١٢ بوست لكل دورة (٧:٠٠ م)", "12 posts per 4-week cycle (7:00 PM)")}
            </p>
          </div>

          <div className="rounded-2xl border border-zinc-800/90 bg-zinc-900/60 p-4">
            <p className="text-[11px] font-bold text-zinc-400">
              {t("الـ Stories اليومية", "Daily Stories (incl. Weekends)")}
            </p>
            <p className="mt-1 text-2xl font-black text-white">
              {stats.storiesApprovedOrPublished}{" "}
              <span className="text-sm font-normal text-zinc-500">/ {stats.storiesTotal}</span>
            </p>
            <p className="mt-1 text-[11px] text-zinc-400">
              {t("يومياً الساعة ٦:٠٠ مساءً", "Daily at 6:00 PM Cairo Time")}
            </p>
          </div>

          <div className="col-span-2 lg:col-span-1 rounded-2xl border border-zinc-800/90 bg-zinc-900/60 p-4 flex flex-col justify-between">
            <p className="text-[11px] font-bold text-zinc-400">
              {t("حالة اعتماد التعاقد", "Contract & Scope Status")}
            </p>
            {portal.contractSigned ? (
              <div className="mt-1">
                <span className="inline-flex items-center gap-1 text-xs font-black text-emerald-400">
                  ✅ {t("تم الاعتماد والتوقيع", "Signed & Confirmed")}
                </span>
                <p className="text-[11px] text-zinc-400 mt-0.5 truncate">
                  {portal.contractSignedBy}
                </p>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setActiveTab("overview")}
                className="mt-2 w-full rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 px-3 py-2 text-xs font-bold text-amber-300 cursor-pointer transition"
              >
                ✍️ {t("مراجعة وتوقيع البنود", "Review & Sign Scope")}
              </button>
            )}
          </div>
        </div>

        {/* ── TAB 1: OVERVIEW, CYCLES, WORKING RULES & SIGN-OFF ── */}
        {activeTab === "overview" && (
          <div className="space-y-6">
            {/* 3-Month Rollout Cycles Table & Cards */}
            <section className="rounded-3xl border border-zinc-800 bg-zinc-900/60 p-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-5">
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-widest text-amber-400">
                    {t("خطة الـ ٣ أشهر (Cycles Breakdown)", "3-Month Production Rollout Cycles")}
                  </span>
                  <h2 className="text-lg font-black text-white mt-0.5">
                    {t("دورات العمل والنشر الثلاث", "Rollout Cycles Summary")}
                  </h2>
                </div>
                <span className="text-xs text-zinc-400 font-mono">
                  Total: 36 Feed Posts • 90 Daily Stories
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {portal.cycles.map((c) => {
                  const cMs = portal.milestones.filter((m) => m.cycle === c.name);
                  const cMsDone = cMs.filter((m) => m.status === "Done").length;
                  const cFeed = portal.feedCalendar.filter((f) => f.cycle === c.name);
                  const cFeedReels = cFeed.filter((f) => f.format === "Reel").length;
                  const cFeedPosts = cFeed.length - cFeedReels;
                  const cFeedDone = cFeed.filter((f) =>
                    ["Approved", "Scheduled", "Published"].includes(f.publishStatus),
                  ).length;

                  return (
                    <div
                      key={c.id}
                      className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-5 flex flex-col justify-between hover:border-amber-500/40 transition"
                    >
                      <div>
                        <div className="flex items-center justify-between">
                          <span className="rounded-lg bg-amber-400/15 border border-amber-400/30 px-2.5 py-1 text-xs font-black text-amber-300">
                            {c.name}
                          </span>
                          <span className="text-xs font-mono text-zinc-400">
                            {cMsDone}/{cMs.length} {t("مراحل", "Milestones")}
                          </span>
                        </div>

                        <p className="mt-3 text-sm font-bold text-white" dir="ltr">
                          {c.startDate} → {c.endDate}
                        </p>

                        <div className="mt-4 grid grid-cols-2 gap-2.5">
                          <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-3">
                            <p className="text-[11px] text-zinc-400">{t("بوستات الـ Feed", "Feed Posts")}</p>
                            <p className="text-lg font-black text-white mt-0.5">{c.feedPostsTarget}</p>
                            <p className="text-[10px] text-zinc-500">
                              {cFeedReels} Reels · {cFeedPosts} Posts
                            </p>
                          </div>
                          <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-3">
                            <p className="text-[11px] text-zinc-400">{t("الـ Stories اليومية", "Daily Stories")}</p>
                            <p className="text-lg font-black text-white mt-0.5">{c.storiesTarget}</p>
                            <p className="text-[10px] text-zinc-500">
                              {t("يومياً 6:00 PM", "Daily 6:00 PM")}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 pt-3 border-t border-zinc-800/80 flex items-center justify-between text-xs">
                        <span className="text-zinc-400">
                          {t(`معتمد: ${cFeedDone}/${cFeed.length} بوست`, `Approved: ${cFeedDone}/${cFeed.length}`)}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedCycle(c.name);
                            setActiveTab("feed");
                          }}
                          className="font-bold text-amber-400 hover:underline cursor-pointer"
                        >
                          {t("عرض الكالندر ←", "Open Calendar →")}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Scope & Working Rules (7 Cards from Sheet) */}
            <section className="rounded-3xl border border-zinc-800 bg-zinc-900/60 p-6">
              <span className="text-[11px] font-bold uppercase tracking-widest text-amber-400">
                Scope & Working Rules
              </span>
              <h2 className="text-lg font-black text-white mt-0.5 mb-4">
                {t("نطاق العمل وقواعد التشغيل والاعتماد", "Scope & Operational Working Rules")}
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {portal.scopeRules.map((rule) => (
                  <div
                    key={rule.id}
                    className="rounded-2xl border border-zinc-800/90 bg-zinc-950/70 p-4 flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="rounded-md bg-zinc-800 px-2.5 py-0.5 text-[11px] font-mono font-bold text-amber-300">
                          {rule.category}
                        </span>
                        <span className="text-xs font-bold text-zinc-200">{rule.titleAr}</span>
                      </div>
                      <p className="mt-2.5 text-xs text-zinc-200 leading-relaxed">
                        {isAr ? rule.descriptionAr : rule.descriptionEn}
                      </p>
                      <p className="mt-1.5 text-[11px] text-zinc-500 leading-relaxed" dir="ltr">
                        {isAr ? rule.descriptionEn : rule.descriptionAr}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Confirm Before Signing (Interactive Sign-Off Box) */}
            <section className="rounded-3xl border-2 border-amber-500/40 bg-gradient-to-b from-amber-500/10 to-zinc-900/80 p-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-widest text-amber-300">
                    Confirm Before Signing
                  </span>
                  <h2 className="text-lg font-black text-white mt-0.5">
                    {t(
                      "بنود التأكيد والاعتماد قبل بدء التنفيذ",
                      "Pre-Signing Confirmation & Authorized Contacts",
                    )}
                  </h2>
                </div>
                {portal.contractSigned && (
                  <span className="rounded-xl bg-emerald-500/20 border border-emerald-500/40 px-3.5 py-1.5 text-xs font-black text-emerald-300">
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
                        className={`flex items-start gap-3 rounded-2xl border p-4 cursor-pointer transition ${
                          checked
                            ? "border-emerald-500/50 bg-emerald-500/10"
                            : "border-zinc-800 bg-zinc-950/80 hover:border-zinc-700"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            setLocalChecks((prev) => ({ ...prev, [item.id]: e.target.checked }))
                          }
                          className="mt-1 h-4 w-4 rounded accent-amber-400 cursor-pointer"
                        />
                        <div className="flex-1 text-xs">
                          <p className="font-bold text-white leading-relaxed">
                            {idx + 1}. {isAr ? item.textAr : item.textEn}
                          </p>
                          <p className="mt-1 text-[11px] text-zinc-400" dir="ltr">
                            {isAr ? item.textEn : item.textAr}
                          </p>
                        </div>
                      </label>
                    );
                  })}
                </div>

                {/* Named Contacts as required by Checklist Item 1 */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2">
                  <div>
                    <label className="block text-[11px] font-bold text-zinc-300 mb-1">
                      {t("مسؤول تسليم الخامات بـ ARC", "ARC Asset Contact Name")}
                    </label>
                    <input
                      type="text"
                      value={assetContactName}
                      onChange={(e) => setAssetContactName(e.target.value)}
                      placeholder={t("الاسم الكامل", "Full Name")}
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-white focus:border-amber-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-zinc-300 mb-1">
                      {t("رقم واتساب مسؤول الخامات", "Asset Contact WhatsApp")}
                    </label>
                    <input
                      type="text"
                      value={assetContactPhone}
                      onChange={(e) => setAssetContactPhone(e.target.value)}
                      placeholder="+20 1..."
                      dir="ltr"
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-white focus:border-amber-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-zinc-300 mb-1">
                      {t("المسؤول المعتمد للموافقات (Approver)", "Authorized Approver Name")}
                    </label>
                    <input
                      type="text"
                      value={approverName}
                      onChange={(e) => setApproverName(e.target.value)}
                      placeholder={t("اسم المسؤول المعتمد", "Approver Name")}
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-white focus:border-amber-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-zinc-300 mb-1">
                      {t("المسمى الوظيفي", "Job Title")}
                    </label>
                    <input
                      type="text"
                      value={approverTitle}
                      onChange={(e) => setApproverTitle(e.target.value)}
                      placeholder={t("مثال: رئيس مجلس الإدارة / مدير التسويق", "e.g. CEO / Marketing Head")}
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-white focus:border-amber-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                  <p className="text-[11px] text-zinc-400">
                    {t(
                      "بمجرد الضغط على اعتماد، يتم تسجيل الموافقة رسمياً في سجل المشروع وإرسال إشعار فوري للوكالة.",
                      "Submitting records your official sign-off timestamp and notifies the MFT account management team.",
                    )}
                  </p>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-6 py-3 rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-zinc-950 font-black text-xs shadow-lg shadow-amber-500/20 cursor-pointer transition disabled:opacity-50"
                  >
                    ✍️ {t("اعتماد وتوقيع خطة العمل والبنود", "Confirm & Sign Rollout Plan")}
                  </button>
                </div>
              </form>
            </section>
          </div>
        )}

        {/* ── TAB 2: MASTER TIMELINE ── */}
        {activeTab === "timeline" && (
          <section className="rounded-3xl border border-zinc-800 bg-zinc-900/60 p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-widest text-amber-400">
                  Master Timeline
                </span>
                <h2 className="text-lg font-black text-white mt-0.5">
                  {t(
                    "الجدول الزمني الرئيسي ومواعيد التسليم والاعتماد",
                    "Master Production & Approval Timeline",
                  )}
                </h2>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {[
                  { id: "all", label: t("كل المسؤوليات", "All Owners") },
                  { id: "client", label: t(`مطلوب من ${portal.clientName}`, `${portal.clientName} Actions`) },
                  { id: "agency", label: t("مهام الوكالة", "Agency Tasks") },
                ].map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setTimelineOwnerFilter(f.id)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer transition ${
                      timelineOwnerFilter === f.id
                        ? "bg-amber-400 text-zinc-950"
                        : "bg-zinc-950 text-zinc-400 border border-zinc-800 hover:text-white"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-zinc-800">
              <table className="w-full text-xs text-left rtl:text-right">
                <thead className="bg-zinc-950 text-zinc-400 uppercase text-[10px] border-b border-zinc-800">
                  <tr>
                    <th className="px-4 py-3">{t("الدورة", "Cycle")}</th>
                    <th className="px-4 py-3">{t("المرحلة (Milestone)", "Milestone")}</th>
                    <th className="px-4 py-3">{t("المسؤول", "Owner")}</th>
                    <th className="px-4 py-3">{t("تاريخ البدء", "Start Date")}</th>
                    <th className="px-4 py-3">{t("تاريخ الانتهاء", "End Date")}</th>
                    <th className="px-4 py-3">{t("التاريخ الفعلي", "Actual Date")}</th>
                    <th className="px-4 py-3">{t("الحالة", "Status")}</th>
                    <th className="px-4 py-3">{t("الروابط والملاحظات", "Notes & Evidence")}</th>
                    <th className="px-4 py-3">{t("إجراء العميل", "Client Action")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/80 bg-zinc-900/40">
                  {filteredMilestones.map((m) => {
                    const isClientOwner = m.owner.toLowerCase().includes("arc");
                    const isAssetsRow = m.milestone.toLowerCase().includes("asset");
                    return (
                      <tr key={m.id} className="hover:bg-zinc-800/40 transition">
                        <td className="px-4 py-3.5 font-mono font-bold text-amber-300 whitespace-nowrap">
                          {m.monthHeader && (
                            <div className="text-[10px] text-zinc-500 mb-0.5">{m.monthHeader}</div>
                          )}
                          {m.cycle}
                        </td>
                        <td className="px-4 py-3.5 font-bold text-white">{m.milestone}</td>
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border ${ownerBadgeClass(m.owner)}`}>
                            {m.owner}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 font-mono text-zinc-300 whitespace-nowrap" dir="ltr">
                          {m.startDate || "—"}
                        </td>
                        <td className="px-4 py-3.5 font-mono text-zinc-300 whitespace-nowrap" dir="ltr">
                          {m.endDate || "—"}
                        </td>
                        <td className="px-4 py-3.5 font-mono text-emerald-400 whitespace-nowrap" dir="ltr">
                          {m.actualDate || "—"}
                        </td>
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border ${statusBadgeClass(m.status)}`}>
                            {m.status}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 max-w-xs">
                          <p className="text-zinc-300 leading-relaxed">{m.notes}</p>
                          {m.linkEvidence && (
                            <a
                              href={m.linkEvidence}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-1 inline-flex items-center gap-1 text-[11px] font-bold text-amber-400 hover:underline"
                            >
                              🔗 {t("فتح الرابط / الملفات المرفقة ↗", "Open Attached Link / Evidence ↗")}
                            </a>
                          )}
                          {m.clientComment && (
                            <p className="mt-1 text-[11px] text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-2 py-1">
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
                                className="px-2.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-black text-[11px] cursor-pointer transition"
                              >
                                ✅ {t("اعتماد", "Approve")}
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
                                className="px-2.5 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 font-bold text-[11px] cursor-pointer transition"
                              >
                                📁 {t("إرفاق خامات", "Upload Assets Link")}
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
                              className="px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[11px] font-bold cursor-pointer transition"
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

        {/* ── TAB 3: FEED CALENDAR (36 POSTS & REELS) ── */}
        {activeTab === "feed" && (
          <section className="rounded-3xl border border-zinc-800 bg-zinc-900/60 p-6 space-y-5">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-widest text-amber-400">
                  Feed Calendar • Sun / Tue / Thu @ 7:00 PM Cairo Time
                </span>
                <h2 className="text-lg font-black text-white mt-0.5">
                  {t(
                    `جدول بوستات الـ Feed والـ Reels (${filteredFeed.length})`,
                    `Feed Content Calendar (${filteredFeed.length} Posts & Reels)`,
                  )}
                </h2>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/* Format filter */}
                <div className="flex items-center rounded-xl border border-zinc-800 bg-zinc-950 p-1">
                  {[
                    { id: "all", label: t("الكل", "All") },
                    { id: "reel", label: "🎬 Reels" },
                    { id: "post", label: "🖼️ Posts" },
                  ].map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setFeedFormatFilter(f.id)}
                      className={`px-3 py-1 rounded-lg text-xs font-bold cursor-pointer transition ${
                        feedFormatFilter === f.id
                          ? "bg-amber-400 text-zinc-950"
                          : "text-zinc-400 hover:text-white"
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                {/* View switcher */}
                <div className="flex items-center rounded-xl border border-zinc-800 bg-zinc-950 p-1">
                  <button
                    type="button"
                    onClick={() => setFeedViewMode("grid")}
                    className={`px-3 py-1 rounded-lg text-xs font-bold cursor-pointer ${
                      feedViewMode === "grid" ? "bg-zinc-800 text-white" : "text-zinc-400"
                    }`}
                  >
                    ⊞ {t("كروت مرئية", "Visual Cards")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setFeedViewMode("table")}
                    className={`px-3 py-1 rounded-lg text-xs font-bold cursor-pointer ${
                      feedViewMode === "table" ? "bg-zinc-800 text-white" : "text-zinc-400"
                    }`}
                  >
                    ☰ {t("جدول", "Sheet Table")}
                  </button>
                </div>

                {/* Bulk approve cycle */}
                {selectedCycle !== "all" && (
                  <button
                    type="button"
                    onClick={() => void handleBulkApproveCycleFeed(selectedCycle)}
                    disabled={submitting}
                    className="px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-black text-xs cursor-pointer transition"
                  >
                    ✅ {t(`اعتماد كالندر ${selectedCycle} بالكامل`, `Approve All ${selectedCycle} Posts`)}
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
                      className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-5 flex flex-col justify-between hover:border-zinc-700 transition"
                    >
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="rounded-lg bg-zinc-900 border border-zinc-800 px-2.5 py-1 text-[11px] font-mono font-bold text-amber-300">
                              {p.cycle} · {p.contentName}
                            </span>
                            <span
                              className={`px-2.5 py-0.5 rounded-full text-[10px] font-black border ${
                                isReel
                                  ? "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30"
                                  : "bg-sky-500/15 text-sky-300 border-sky-500/30"
                              }`}
                            >
                              {isReel ? "🎬 Reel" : "🖼️ Post"}
                            </span>
                          </div>

                          <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${statusBadgeClass(p.publishStatus)}`}>
                            {p.publishStatus}
                          </span>
                        </div>

                        <div className="mt-3 flex items-center justify-between text-xs text-zinc-400 font-mono" dir="ltr">
                          <span>📅 {p.day}, {p.publishDate}</span>
                          <span>🕖 {p.cairoTime}</span>
                        </div>

                        {p.topicTitle && (
                          <h3 className="mt-3 text-sm font-bold text-white">{p.topicTitle}</h3>
                        )}
                        {p.captionText && (
                          <p className="mt-1.5 text-xs text-zinc-400 line-clamp-3 whitespace-pre-line">
                            {p.captionText}
                          </p>
                        )}

                        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
                          <span className="rounded bg-zinc-900 px-2 py-0.5 border border-zinc-800">
                            📱 {p.platforms}
                          </span>
                          <span className="rounded bg-zinc-900 px-2 py-0.5 border border-zinc-800">
                            🏷️ {p.postType}
                          </span>
                          {p.assetLink && (
                            <a
                              href={p.assetLink}
                              target="_blank"
                              rel="noreferrer"
                              className="text-amber-400 font-bold hover:underline"
                            >
                              🎨 {t("معاينة التصميم / الفيديو ↗", "View Creative ↗")}
                            </a>
                          )}
                        </div>

                        {p.clientComment && (
                          <div className="mt-3 rounded-xl bg-amber-500/10 border border-amber-500/30 p-2.5 text-[11px] text-amber-200">
                            💬 {p.clientComment}
                          </div>
                        )}
                      </div>

                      <div className="mt-4 pt-3 border-t border-zinc-800/80 flex items-center justify-between gap-2">
                        {!isApproved ? (
                          <button
                            type="button"
                            onClick={() => void handleApprovePost(p)}
                            disabled={submitting}
                            className="flex-1 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-black text-xs cursor-pointer transition"
                          >
                            ✅ {t("اعتماد البوست", "Approve Post")}
                          </button>
                        ) : (
                          <span className="text-xs font-bold text-emerald-400">
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
                          className="px-3 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-bold text-zinc-300 cursor-pointer transition"
                        >
                          ✏️ {t("طلب تعديل", "Request Edit")}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-zinc-800">
                <table className="w-full text-xs text-left rtl:text-right">
                  <thead className="bg-zinc-950 text-zinc-400 uppercase text-[10px] border-b border-zinc-800">
                    <tr>
                      <th className="px-4 py-3">Cycle</th>
                      <th className="px-4 py-3">Content Name</th>
                      <th className="px-4 py-3">Publish Date</th>
                      <th className="px-4 py-3">Day</th>
                      <th className="px-4 py-3">Cairo Time</th>
                      <th className="px-4 py-3">Format</th>
                      <th className="px-4 py-3">Platforms</th>
                      <th className="px-4 py-3">Posts / Ads</th>
                      <th className="px-4 py-3">Publish Status</th>
                      <th className="px-4 py-3">{t("إجراء العميل", "Action")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/80 bg-zinc-900/40">
                    {filteredFeed.map((p) => (
                      <tr key={p.id} className="hover:bg-zinc-800/40">
                        <td className="px-4 py-3 font-mono font-bold text-amber-300">{p.cycle}</td>
                        <td className="px-4 py-3 font-bold text-white">
                          {p.contentName}
                          {p.topicTitle && <div className="text-[11px] text-zinc-400">{p.topicTitle}</div>}
                        </td>
                        <td className="px-4 py-3 font-mono text-zinc-300" dir="ltr">{p.publishDate}</td>
                        <td className="px-4 py-3 font-mono text-zinc-400">{p.day}</td>
                        <td className="px-4 py-3 font-mono text-zinc-400" dir="ltr">{p.cairoTime}</td>
                        <td className="px-4 py-3 font-bold text-white">{p.format}</td>
                        <td className="px-4 py-3 text-zinc-300">{p.platforms}</td>
                        <td className="px-4 py-3 text-zinc-400">{p.postType}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${statusBadgeClass(p.publishStatus)}`}>
                            {p.publishStatus}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => void handleApprovePost(p)}
                              className="px-2.5 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500 text-emerald-300 hover:text-zinc-950 font-bold text-[11px] cursor-pointer transition"
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
                              className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[11px] font-bold cursor-pointer"
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

        {/* ── TAB 4: DAILY STORIES (84 STORIES) ── */}
        {activeTab === "stories" && (
          <section className="rounded-3xl border border-zinc-800 bg-zinc-900/60 p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-widest text-amber-400">
                  Daily Stories • Every Day incl. Weekends @ 6:00 PM Cairo Time
                </span>
                <h2 className="text-lg font-black text-white mt-0.5">
                  {t(
                    `جدول الـ Stories اليومية (${filteredStories.length})`,
                    `Daily Stories Schedule (${filteredStories.length} Stories)`,
                  )}
                </h2>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {["all", "Draft", "Ready for Review", "Approved", "Scheduled", "Published"].map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setStoryStatusFilter(st)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer transition ${
                      storyStatusFilter === st
                        ? "bg-amber-400 text-zinc-950"
                        : "bg-zinc-950 text-zinc-400 border border-zinc-800 hover:text-white"
                    }`}
                  >
                    {st === "all" ? t("كل الحالات", "All Statuses") : st}
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-zinc-800 max-h-[640px]">
              <table className="w-full text-xs text-left rtl:text-right">
                <thead className="sticky top-0 bg-zinc-950 text-zinc-400 uppercase text-[10px] border-b border-zinc-800 z-10">
                  <tr>
                    <th className="px-4 py-3">Cycle</th>
                    <th className="px-4 py-3">Story ID</th>
                    <th className="px-4 py-3">Publish Date</th>
                    <th className="px-4 py-3">Day</th>
                    <th className="px-4 py-3">Cairo Time</th>
                    <th className="px-4 py-3">Platforms</th>
                    <th className="px-4 py-3">Topic / Asset Link</th>
                    <th className="px-4 py-3">Actual Publish</th>
                    <th className="px-4 py-3">Publish Status</th>
                    <th className="px-4 py-3">{t("إجراء العميل", "Client Action")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/80 bg-zinc-900/40">
                  {filteredStories.map((s) => {
                    const isWeekend = s.day === "Fri" || s.day === "Sat";
                    return (
                      <tr key={s.id} className="hover:bg-zinc-800/40 transition">
                        <td className="px-4 py-3 font-mono font-bold text-amber-300">{s.cycle}</td>
                        <td className="px-4 py-3 font-bold text-white">{s.storyId}</td>
                        <td className="px-4 py-3 font-mono text-zinc-200" dir="ltr">{s.publishDate}</td>
                        <td className="px-4 py-3 font-mono">
                          <span className={isWeekend ? "text-amber-300 font-bold" : "text-zinc-400"}>
                            {s.day} {isWeekend ? "(Weekend)" : ""}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-zinc-400" dir="ltr">{s.cairoTime}</td>
                        <td className="px-4 py-3 text-zinc-300">{s.platforms}</td>
                        <td className="px-4 py-3 max-w-xs">
                          {s.topicAssetLink ? (
                            s.topicAssetLink.startsWith("http") ? (
                              <a
                                href={s.topicAssetLink}
                                target="_blank"
                                rel="noreferrer"
                                className="text-amber-400 font-bold hover:underline"
                              >
                                🔗 {t("معاينة الاستوري / الرابط ↗", "Open Story Asset ↗")}
                              </a>
                            ) : (
                              <span className="text-zinc-200">{s.topicAssetLink}</span>
                            )
                          ) : (
                            <span className="text-zinc-600">—</span>
                          )}
                          {s.clientComment && (
                            <div className="text-[11px] text-amber-300 mt-0.5">💬 {s.clientComment}</div>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-emerald-400" dir="ltr">
                          {s.actualPublish || "—"}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${statusBadgeClass(s.publishStatus)}`}>
                            {s.publishStatus}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => void handleApproveStory(s)}
                              className="px-2.5 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500 text-emerald-300 hover:text-zinc-950 font-bold text-[11px] cursor-pointer transition"
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
                              className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[11px] font-bold cursor-pointer"
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
            {/* Paid Media Campaigns */}
            <div className="lg:col-span-2 space-y-4">
              <div className="rounded-3xl border border-zinc-800 bg-zinc-900/60 p-6">
                <span className="text-[11px] font-bold uppercase tracking-widest text-amber-400">
                  Paid Media & Meta Ads
                </span>
                <h2 className="text-lg font-black text-white mt-0.5">
                  {t(
                    "حملات الإعلانات الممولة وتقارير الأداء الشهرية",
                    "Meta Paid Media Campaigns & Performance Reports",
                  )}
                </h2>
                <p className="text-xs text-zinc-400 mt-1">
                  {t(
                    "يتطلب إطلاق الإعلانات اعتماد الهدف الإعلاني (Objective) والميزانية (Budget) والتصميم (Creative) مع تأكيد صلاحية الحساب الإعلاني.",
                    "Launch requires approval of the objective, budget, and creative, plus confirmed ad account access.",
                  )}
                </p>

                <div className="mt-5 space-y-4">
                  {portal.paidCampaigns.map((camp) => (
                    <div
                      key={camp.id}
                      className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-5 flex flex-col justify-between gap-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <span className="text-[11px] font-mono font-bold text-amber-300">
                            {camp.cycle} · {camp.platforms}
                          </span>
                          <h3 className="text-base font-black text-white mt-0.5">{camp.campaignName}</h3>
                          <p className="text-xs text-zinc-400 mt-1">
                            🎯 {t("الهدف الإعلاني:", "Objective:")}{" "}
                            <strong className="text-zinc-200">{camp.objective}</strong>
                          </p>
                        </div>
                        <span className={`px-3 py-1 rounded-full text-xs font-bold border ${statusBadgeClass(camp.status)}`}>
                          {camp.status}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                        <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-3">
                          <span className="text-zinc-400 text-[11px]">{t("الميزانية المقترحة", "Approved Budget")}</span>
                          <p className="font-mono text-sm font-black text-emerald-400 mt-0.5">
                            EGP {camp.budgetEgp.toLocaleString()}
                          </p>
                        </div>
                        <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-3">
                          <span className="text-zinc-400 text-[11px]">{t("صلاحية الحساب الإعلاني", "Ad Account Access")}</span>
                          <p className="font-bold text-white mt-0.5">
                            {camp.adAccountAccessConfirmed ? "✅ Confirmed" : "⏳ Pending"}
                          </p>
                        </div>
                        <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-3 flex flex-col justify-center">
                          {camp.reportLink ? (
                            <a
                              href={camp.reportLink}
                              target="_blank"
                              rel="noreferrer"
                              className="text-amber-400 font-bold hover:underline"
                            >
                              📈 {t("فتح تقرير الأداء ↗", "View Performance Report ↗")}
                            </a>
                          ) : (
                            <span className="text-zinc-500 text-[11px]">
                              {t("التقرير يصدر بنهاية الدورة", "Report published at cycle end")}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-zinc-800">
                        <span className="text-xs text-zinc-400">{camp.notes}</span>
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
                                showToast(
                                  t(
                                    `🚀 تم اعتماد إطلاق حملة "${camp.campaignName}"!`,
                                    `🚀 Approved campaign "${camp.campaignName}"!`,
                                  ),
                                );
                              } finally {
                                setSubmitting(false);
                              }
                            }}
                            className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-black text-xs cursor-pointer transition"
                          >
                            🚀 {t("اعتماد الهدف والميزانية والإطلاق", "Approve Objective, Budget & Launch")}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Live Activity & Direct Note Column */}
            <div className="space-y-4">
              <div className="rounded-3xl border border-zinc-800 bg-zinc-900/60 p-5">
                <h3 className="text-sm font-black text-white">
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
                      showToast(t("💬 تم إرسال رسالتك لفريق إدارة الحساب فوراً!", "💬 Message sent to Account Manager!"));
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
                    placeholder={t(
                      "اكتب أي ملاحظة أو تعديل أو رابط إضافي ليصل فوراً للأكونت مانجر والأدمن...",
                      "Write any note, revision, or asset link for your Account Manager...",
                    )}
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-xs text-white focus:border-amber-500 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-zinc-950 font-black text-xs cursor-pointer transition"
                  >
                    {t("إرسال الملاحظة للوكالة", "Send Note")}
                  </button>
                </form>
              </div>

              <div className="rounded-3xl border border-zinc-800 bg-zinc-900/60 p-5">
                <h3 className="text-sm font-black text-white mb-3">
                  🕒 {t("سجل الاعتمادات والتعديلات اللحظي", "Live Approvals & Activity Log")}
                </h3>
                {interactions.length === 0 ? (
                  <p className="text-xs text-zinc-500">
                    {t("لم يتم تسجيل اعتمادات جديدة بعد.", "No recent activity logged yet.")}
                  </p>
                ) : (
                  <div className="space-y-2.5 max-h-96 overflow-y-auto pr-1">
                    {[...interactions].reverse().map((ev) => (
                      <div
                        key={ev.id}
                        className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-3 text-xs space-y-1"
                      >
                        <div className="flex items-center justify-between text-[10px] text-zinc-400">
                          <strong className="text-amber-300">{ev.actorName}</strong>
                          <span dir="ltr">
                            {new Date(ev.createdAtIso).toLocaleString([], {
                              month: "short",
                              day: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>
                        <p className="font-bold text-white">{ev.targetLabel}</p>
                        {ev.comment && <p className="text-zinc-300">{ev.comment}</p>}
                        {ev.linkUrl && (
                          <a
                            href={ev.linkUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-block text-amber-400 hover:underline font-bold"
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

      {/* ── MODAL FOR ASSET UPLOAD / REVISION REQUEST / NOTE ── */}
      {actionModal && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setActionModal(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-3xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl space-y-4"
          >
            <h3 className="text-base font-black text-white">
              {actionModal.mode === "milestone_assets"
                ? t("📁 إرفاق رابط خامات المشروع واعتماد التسليم", "📁 Submit Project Assets Link")
                : actionModal.mode === "post_revision"
                  ? t("✏️ طلب تعديل على البوست / الـ Reel", "✏️ Request Post Revision")
                  : t("💬 إضافة ملاحظة للفريق", "💬 Add Note")}
            </h3>
            <p className="text-xs text-amber-300 font-mono">{actionModal.targetLabel}</p>

            <form onSubmit={handleSubmitModalAction} className="space-y-3.5">
              {(actionModal.mode === "milestone_assets" ||
                actionModal.mode === "milestone_note" ||
                actionModal.mode === "story_revision") && (
                <div>
                  <label className="block text-xs font-bold text-zinc-300 mb-1">
                    {t(
                      "رابط الملفات / الخامات (Google Drive / WeTransfer / Dropbox)",
                      "Assets / Reference Link (Google Drive, etc.)",
                    )}
                  </label>
                  <input
                    type="url"
                    required={actionModal.mode === "milestone_assets"}
                    value={modalLink}
                    onChange={(e) => setModalLink(e.target.value)}
                    placeholder="https://drive.google.com/..."
                    dir="ltr"
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 text-xs text-white focus:border-amber-500 focus:outline-none"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-zinc-300 mb-1">
                  {t("الملاحظات أو التعديلات المطلوبة", "Notes / Revision Details")}
                </label>
                <textarea
                  rows={3}
                  required={actionModal.mode !== "milestone_assets"}
                  value={modalComment}
                  onChange={(e) => setModalComment(e.target.value)}
                  placeholder={t(
                    "اكتب تفاصيل التعديل أو البيانات المسموح بنشرها...",
                    "Enter details or notes...",
                  )}
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-xs text-white focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setActionModal(null)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 text-xs font-bold text-zinc-300 cursor-pointer"
                >
                  {t("إلغاء", "Cancel")}
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-zinc-950 font-black text-xs cursor-pointer transition"
                >
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
        <div className="min-h-screen bg-zinc-950 text-zinc-400 flex items-center justify-center text-sm font-mono">
          Loading Client Rollout Portal...
        </div>
      }
    >
      <ClientPortalInner />
    </Suspense>
  );
}
