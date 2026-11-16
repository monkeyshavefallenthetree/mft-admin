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

  // UI Navigation
  const [activeTab, setActiveTab] = useState<AdminPortalTab>("overview");
  const [cycleFilter, setCycleFilter] = useState<string>("all");

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

  // Keep draft synced with livePortal when not dirty or when switching client
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

  const handleSavePortal = async () => {
    setSaving(true);
    try {
      await saveClientPortalToFirestore(draft, adminEmail);
      setDirty(false);
      toast.success(`Saved "${draft.clientName}" Client Portal ✓`, {
        description: "All changes are now live on the Client Portal.",
      });
    } catch (err) {
      toast.error("Failed to save Client Portal", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleImportGoogleSheet = async (targetUrl?: string) => {
    const urlToUse = (targetUrl ?? draft.googleSheetUrl ?? "").trim();
    if (!urlToUse) {
      toast.warning("Please enter a Google Sheets URL first");
      return;
    }
    setImportingSheet(true);
    try {
      const imported = await importPortalFromGoogleSheetUrl(urlToUse, draft);
      setDraft(imported);
      await saveClientPortalToFirestore(imported, adminEmail);
      setDirty(false);
      toast.success("Synced from Google Sheet ✓", {
        description: `Loaded ${imported.milestones.length} milestones, ${imported.feedCalendar.length} feed posts, and ${imported.dailyStories.length} daily stories.`,
      });
    } catch (err) {
      toast.error("Google Sheet Sync Failed", {
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
      toast.warning("Please enter a short Client Code (e.g. ARC, NIKE)");
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
          /* keep default template if sheet import fails */
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
      toast.success(`Created Client Portal for ${name} (${code}) ✓`);
    } finally {
      setSaving(false);
    }
  };

  const handleCopyMagicLink = () => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const url = `${origin}/client?code=${encodeURIComponent(draft.clientCode)}&pin=${encodeURIComponent(draft.accessPin)}`;
    navigator.clipboard?.writeText(url);
    toast.success("Copied Client Magic Login Link ✓", {
      description: url,
    });
  };

  const filteredMilestones = useMemo(() => {
    return draft.milestones.filter((m) => cycleFilter === "all" || m.cycle === cycleFilter);
  }, [draft.milestones, cycleFilter]);

  const filteredFeed = useMemo(() => {
    return draft.feedCalendar.filter((f) => cycleFilter === "all" || f.cycle === cycleFilter);
  }, [draft.feedCalendar, cycleFilter]);

  const filteredStories = useMemo(() => {
    return draft.dailyStories.filter((s) => cycleFilter === "all" || s.cycle === cycleFilter);
  }, [draft.dailyStories, cycleFilter]);

  return (
    <div className="space-y-6">
      {/* ── Top Control Header ── */}
      <div className="rounded-2xl border-2 border-zinc-900 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-5 shadow-[3px_3px_0px_0px_#09090b]">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border-b border-zinc-200 dark:border-zinc-800 pb-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-red-600">
                // CLIENT ROLLOUT & APPROVALS PORTAL CONTROL
              </span>
              <span className="rounded bg-amber-100 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-800 px-2 py-0.5 text-[10px] font-mono font-bold text-amber-800 dark:text-amber-300">
                Client Code: {draft.clientCode} · PIN: {draft.accessPin}
              </span>
              {draft.contractSigned && (
                <span className="rounded bg-emerald-100 dark:bg-emerald-950/60 border border-emerald-300 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:text-emerald-300">
                  ✓ Signed by {draft.contractSignedBy}
                </span>
              )}
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-950 dark:text-white mt-1">
              إدارة بوابة العملاء وخطة السوشيال ميديا ({draft.clientName})
            </h1>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              تحكم كامل في الجداول الزمنية، بوستات الـ Feed والـ Reels، الـ Stories اليومية، واستلام اعتمادات العميل لحظياً.
            </p>
          </div>

          {/* Client Switcher & Top Actions */}
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedPortalId}
              onChange={(e) => {
                setSelectedPortalId(e.target.value);
                setDirty(false);
              }}
              className="rounded-lg border-2 border-zinc-900 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-xs font-bold text-zinc-900 dark:text-white"
            >
              {Object.values(portalsMap).map((p) => (
                <option key={p.id} value={p.id}>
                  🏢 {p.clientName} ({p.clientCode})
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => setNewClientModal(true)}
              className="px-3 py-2 rounded-lg border-2 border-zinc-900 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 text-xs font-bold text-zinc-900 dark:text-white cursor-pointer"
            >
              + عميل جديد
            </button>

            <button
              type="button"
              onClick={handleCopyMagicLink}
              className="px-3 py-2 rounded-lg border-2 border-zinc-900 bg-amber-400 hover:bg-amber-300 text-zinc-950 text-xs font-black cursor-pointer shadow-[2px_2px_0px_0px_#09090b]"
            >
              🔗 نسخ رابط دخول العميل
            </button>

            <a
              href={`/client?code=${encodeURIComponent(draft.clientCode)}&pin=${encodeURIComponent(draft.accessPin)}`}
              target="_blank"
              rel="noreferrer"
              className="px-3 py-2 rounded-lg border-2 border-zinc-900 dark:border-zinc-700 bg-zinc-900 text-white hover:bg-zinc-800 text-xs font-bold"
            >
              ↗ معاينة شاشة العميل
            </a>

            <button
              type="button"
              onClick={handleSavePortal}
              disabled={saving}
              className={`px-4 py-2 rounded-lg border-2 border-zinc-900 text-xs font-black cursor-pointer shadow-[2px_2px_0px_0px_#09090b] transition ${
                dirty
                  ? "bg-emerald-500 hover:bg-emerald-400 text-zinc-950 animate-pulse"
                  : "bg-emerald-600 hover:bg-emerald-500 text-white"
              }`}
            >
              {saving ? "جاري الحفظ..." : dirty ? "💾 حفظ التعديلات الآن *" : "💾 حفظ ومزامنة"}
            </button>
          </div>
        </div>

        {/* Sub-bar: Cycle Filter + Section Tabs */}
        <div className="pt-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { id: "overview", label: "١. الإعدادات والقواعد والدورات" },
                { id: "timeline", label: `٢. الجدول الزمني (${draft.milestones.length})` },
                { id: "feed", label: `٣. كالندر البوستات (${draft.feedCalendar.length})` },
                { id: "stories", label: `٤. الـ Stories اليومية (${draft.dailyStories.length})` },
                { id: "ads", label: `٥. الإعلانات وسجل اعتمادات العميل (${interactions.length})` },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                className={`px-3.5 py-2 rounded-lg text-xs font-bold cursor-pointer border transition ${
                  activeTab === t.id
                    ? "bg-zinc-950 text-white dark:bg-white dark:text-zinc-950 border-zinc-950"
                    : "bg-zinc-50 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-zinc-300 dark:border-zinc-700"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-xs font-bold text-zinc-500">تصفية الدورة:</span>
            {["all", ...draft.cycles.map((c) => c.name)].map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCycleFilter(c)}
                className={`px-2.5 py-1 rounded text-xs font-mono font-bold cursor-pointer border ${
                  cycleFilter === c
                    ? "bg-amber-400 text-zinc-950 border-zinc-900"
                    : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border-zinc-300 dark:border-zinc-700"
                }`}
              >
                {c === "all" ? "الكل" : c}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── TAB 1: OVERVIEW, CREDENTIALS, GOOGLE SHEET SYNC & CYCLES ── */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          {/* Credentials & Google Sheet Live Sync */}
          <div className="rounded-2xl border-2 border-zinc-900 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-bold text-zinc-950 dark:text-white">
                بيانات دخول العميل والربط مع Google Sheets
              </h2>
              {draft.id !== "arc" && (
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await confirmDialog({
                      title: `Delete ${draft.clientName} Portal?`,
                      message: "This will remove this client portal configuration.",
                      confirmLabel: "Delete",
                      tone: "danger",
                    });
                    if (!ok) return;
                    await deleteClientPortalFromFirestore(draft.id, adminEmail);
                    setSelectedPortalId("arc");
                  }}
                  className="px-3 py-1 rounded bg-rose-100 text-rose-700 text-xs font-bold cursor-pointer"
                >
                  حذف بوابة هذا العميل
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-bold text-zinc-600 dark:text-zinc-300 mb-1">
                  اسم العميل (Client Name)
                </label>
                <input
                  type="text"
                  value={draft.clientName}
                  onChange={(e) => updateDraft((p) => ({ ...p, clientName: e.target.value }))}
                  className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-xs font-bold"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-zinc-600 dark:text-zinc-300 mb-1">
                  كود دخول العميل (Client Code)
                </label>
                <input
                  type="text"
                  value={draft.clientCode}
                  onChange={(e) => updateDraft((p) => ({ ...p, clientCode: e.target.value.toUpperCase() }))}
                  dir="ltr"
                  className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-xs font-mono font-bold uppercase"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-zinc-600 dark:text-zinc-300 mb-1">
                  الرقم السري (Access PIN)
                </label>
                <input
                  type="text"
                  value={draft.accessPin}
                  onChange={(e) => updateDraft((p) => ({ ...p, accessPin: e.target.value }))}
                  dir="ltr"
                  className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-xs font-mono font-bold"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-zinc-600 dark:text-zinc-300 mb-1">
                  عنوان الخطة (Project Title)
                </label>
                <input
                  type="text"
                  value={draft.projectTitle}
                  onChange={(e) => updateDraft((p) => ({ ...p, projectTitle: e.target.value }))}
                  className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-xs font-bold"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-end pt-2">
              <div className="lg:col-span-2">
                <label className="block text-xs font-bold text-zinc-600 dark:text-zinc-300 mb-1">
                  رابط شيت جوجل (Google Sheets Rollout URL) — للمزامنة التلقائية
                </label>
                <input
                  type="url"
                  value={draft.googleSheetUrl || ""}
                  onChange={(e) => updateDraft((p) => ({ ...p, googleSheetUrl: e.target.value }))}
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  dir="ltr"
                  className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-xs font-mono"
                />
              </div>
              <button
                type="button"
                onClick={() => void handleImportGoogleSheet()}
                disabled={importingSheet}
                className="px-4 py-2 rounded-lg border-2 border-zinc-900 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer shadow-[2px_2px_0px_0px_#09090b]"
              >
                {importingSheet ? "⏳ جاري سحب البيانات من Google Sheet..." : "🔄 سحب ومزامنة الجداول من Google Sheet"}
              </button>
            </div>
          </div>

          {/* Cycles Editor */}
          <div className="rounded-2xl border-2 border-zinc-900 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-zinc-950 dark:text-white">
                دورات العمل والنشر (Rollout Cycles)
              </h2>
              <button
                type="button"
                onClick={() =>
                  updateDraft((p) => ({
                    ...p,
                    cycles: [
                      ...p.cycles,
                      {
                        id: `cycle_0${p.cycles.length + 1}`,
                        name: `Cycle 0${p.cycles.length + 1}`,
                        startDate: "05 Feb 2027",
                        endDate: "04 Mar 2027",
                        feedPostsTarget: 12,
                        storiesTarget: 30,
                      },
                    ],
                  }))
                }
                className="px-3 py-1.5 rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950 text-xs font-bold cursor-pointer"
              >
                + إضافة دورة جديدة
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {draft.cycles.map((c, idx) => (
                <div
                  key={c.id}
                  className="rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 p-4 space-y-2.5"
                >
                  <div className="flex items-center justify-between">
                    <input
                      type="text"
                      value={c.name}
                      onChange={(e) =>
                        updateDraft((p) => {
                          const next = [...p.cycles];
                          next[idx] = { ...c, name: e.target.value };
                          return { ...p, cycles: next };
                        })
                      }
                      className="font-mono font-bold text-sm bg-transparent border-b border-zinc-400 focus:outline-none"
                    />
                    {draft.cycles.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          updateDraft((p) => ({
                            ...p,
                            cycles: p.cycles.filter((_, i) => i !== idx),
                          }))
                        }
                        className="text-xs text-rose-600 font-bold cursor-pointer"
                      >
                        حذف
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-[10px] text-zinc-500">تاريخ البدء</span>
                      <input
                        type="text"
                        value={c.startDate}
                        onChange={(e) =>
                          updateDraft((p) => {
                            const next = [...p.cycles];
                            next[idx] = { ...c, startDate: e.target.value };
                            return { ...p, cycles: next };
                          })
                        }
                        dir="ltr"
                        className="w-full rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs font-mono"
                      />
                    </div>
                    <div>
                      <span className="text-[10px] text-zinc-500">تاريخ الانتهاء</span>
                      <input
                        type="text"
                        value={c.endDate}
                        onChange={(e) =>
                          updateDraft((p) => {
                            const next = [...p.cycles];
                            next[idx] = { ...c, endDate: e.target.value };
                            return { ...p, cycles: next };
                          })
                        }
                        dir="ltr"
                        className="w-full rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs font-mono"
                      />
                    </div>
                    <div>
                      <span className="text-[10px] text-zinc-500">عدد البوستات</span>
                      <input
                        type="number"
                        value={c.feedPostsTarget}
                        onChange={(e) =>
                          updateDraft((p) => {
                            const next = [...p.cycles];
                            next[idx] = { ...c, feedPostsTarget: parseInt(e.target.value || "12", 10) };
                            return { ...p, cycles: next };
                          })
                        }
                        className="w-full rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs font-mono"
                      />
                    </div>
                    <div>
                      <span className="text-[10px] text-zinc-500">عدد الـ Stories</span>
                      <input
                        type="number"
                        value={c.storiesTarget}
                        onChange={(e) =>
                          updateDraft((p) => {
                            const next = [...p.cycles];
                            next[idx] = { ...c, storiesTarget: parseInt(e.target.value || "30", 10) };
                            return { ...p, cycles: next };
                          })
                        }
                        className="w-full rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs font-mono"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 2: MASTER TIMELINE EDITOR ── */}
      {activeTab === "timeline" && (
        <div className="rounded-2xl border-2 border-zinc-900 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-zinc-950 dark:text-white">
                إدارة الجدول الزمني الرئيسي (Master Timeline)
              </h2>
              <p className="text-xs text-zinc-500">
                عدّل المواعيد أو الحالات أو أضف روابط الـ References والكالندر ليراها العميل ويعتمدها مباشرة.
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                updateDraft((p) => ({
                  ...p,
                  milestones: [
                    ...p.milestones,
                    {
                      id: `ms_${Date.now()}`,
                      cycle: cycleFilter === "all" ? "Cycle 01" : cycleFilter,
                      milestone: "New Milestone",
                      owner: "ARC",
                      startDate: "15 Nov 2026",
                      endDate: "16 Nov 2026",
                      actualDate: "",
                      status: "Pending",
                      linkEvidence: "",
                      notes: "",
                    },
                  ],
                }))
              }
              className="px-3.5 py-2 rounded-lg bg-zinc-900 text-white dark:bg-white dark:text-zinc-950 text-xs font-bold cursor-pointer"
            >
              + إضافة مرحلة جديدة
            </button>
          </div>

          <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-xs text-left">
              <thead className="bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 uppercase text-[10px]">
                <tr>
                  <th className="p-2.5">Cycle</th>
                  <th className="p-2.5">Milestone</th>
                  <th className="p-2.5">Owner</th>
                  <th className="p-2.5">Start Date</th>
                  <th className="p-2.5">End Date</th>
                  <th className="p-2.5">Actual Date</th>
                  <th className="p-2.5">Status</th>
                  <th className="p-2.5">Link / Evidence</th>
                  <th className="p-2.5">Notes</th>
                  <th className="p-2.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {filteredMilestones.map((m) => (
                  <tr key={m.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                    <td className="p-2">
                      <select
                        value={m.cycle}
                        onChange={(e) =>
                          updateDraft((p) => ({
                            ...p,
                            milestones: p.milestones.map((x) =>
                              x.id === m.id ? { ...x, cycle: e.target.value } : x,
                            ),
                          }))
                        }
                        className="rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs font-mono"
                      >
                        {draft.cycles.map((c) => (
                          <option key={c.id} value={c.name}>{c.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="p-2">
                      <input
                        type="text"
                        value={m.milestone}
                        onChange={(e) =>
                          updateDraft((p) => ({
                            ...p,
                            milestones: p.milestones.map((x) =>
                              x.id === m.id ? { ...x, milestone: e.target.value } : x,
                            ),
                          }))
                        }
                        className="w-44 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs font-bold"
                      />
                    </td>
                    <td className="p-2">
                      <input
                        type="text"
                        value={m.owner}
                        onChange={(e) =>
                          updateDraft((p) => ({
                            ...p,
                            milestones: p.milestones.map((x) =>
                              x.id === m.id ? { ...x, owner: e.target.value } : x,
                            ),
                          }))
                        }
                        className="w-28 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs font-bold"
                      />
                    </td>
                    <td className="p-2">
                      <input
                        type="text"
                        value={m.startDate}
                        onChange={(e) =>
                          updateDraft((p) => ({
                            ...p,
                            milestones: p.milestones.map((x) =>
                              x.id === m.id ? { ...x, startDate: e.target.value } : x,
                            ),
                          }))
                        }
                        dir="ltr"
                        className="w-28 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs font-mono"
                      />
                    </td>
                    <td className="p-2">
                      <input
                        type="text"
                        value={m.endDate}
                        onChange={(e) =>
                          updateDraft((p) => ({
                            ...p,
                            milestones: p.milestones.map((x) =>
                              x.id === m.id ? { ...x, endDate: e.target.value } : x,
                            ),
                          }))
                        }
                        dir="ltr"
                        className="w-28 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs font-mono"
                      />
                    </td>
                    <td className="p-2">
                      <input
                        type="text"
                        value={m.actualDate}
                        onChange={(e) =>
                          updateDraft((p) => ({
                            ...p,
                            milestones: p.milestones.map((x) =>
                              x.id === m.id ? { ...x, actualDate: e.target.value } : x,
                            ),
                          }))
                        }
                        dir="ltr"
                        className="w-28 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs font-mono"
                      />
                    </td>
                    <td className="p-2">
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
                        className="rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs font-bold"
                      >
                        {MILESTONE_STATUSES.map((st) => (
                          <option key={st} value={st}>{st}</option>
                        ))}
                      </select>
                    </td>
                    <td className="p-2">
                      <input
                        type="url"
                        value={m.linkEvidence}
                        onChange={(e) =>
                          updateDraft((p) => ({
                            ...p,
                            milestones: p.milestones.map((x) =>
                              x.id === m.id ? { ...x, linkEvidence: e.target.value } : x,
                            ),
                          }))
                        }
                        placeholder="https://drive..."
                        dir="ltr"
                        className="w-40 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs font-mono"
                      />
                    </td>
                    <td className="p-2">
                      <input
                        type="text"
                        value={m.notes}
                        onChange={(e) =>
                          updateDraft((p) => ({
                            ...p,
                            milestones: p.milestones.map((x) =>
                              x.id === m.id ? { ...x, notes: e.target.value } : x,
                            ),
                          }))
                        }
                        className="w-56 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs"
                      />
                    </td>
                    <td className="p-2">
                      <button
                        type="button"
                        onClick={() =>
                          updateDraft((p) => ({
                            ...p,
                            milestones: p.milestones.filter((x) => x.id !== m.id),
                          }))
                        }
                        className="text-rose-600 hover:underline font-bold cursor-pointer"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── TAB 3: FEED CALENDAR EDITOR ── */}
      {activeTab === "feed" && (
        <div className="rounded-2xl border-2 border-zinc-900 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-zinc-950 dark:text-white">
                إدارة كالندر البوستات والـ Reels ({filteredFeed.length})
              </h2>
              <p className="text-xs text-zinc-500">
                أضف عنوان البوست، الكابشن، رابط التصميم/الفيديو، وغيّر الحالة إلى Ready for Review ليعتمدها العميل.
              </p>
            </div>
            <div className="flex items-center gap-2">
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
                  className="px-3 py-2 rounded-lg bg-amber-400 text-zinc-950 text-xs font-black cursor-pointer"
                >
                  🔔 تحويل كل مسودات {cycleFilter} إلى جاهز للمراجعة
                </button>
              )}
              <button
                type="button"
                onClick={() =>
                  updateDraft((p) => ({
                    ...p,
                    feedCalendar: [
                      ...p.feedCalendar,
                      {
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
                      },
                    ],
                  }))
                }
                className="px-3.5 py-2 rounded-lg bg-zinc-900 text-white dark:bg-white dark:text-zinc-950 text-xs font-bold cursor-pointer"
              >
                + إضافة بوست / Reel
              </button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-xs text-left">
              <thead className="bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 uppercase text-[10px]">
                <tr>
                  <th className="p-2.5">Cycle</th>
                  <th className="p-2.5">Post #</th>
                  <th className="p-2.5">Date & Day</th>
                  <th className="p-2.5">Time</th>
                  <th className="p-2.5">Format</th>
                  <th className="p-2.5">Topic / Caption</th>
                  <th className="p-2.5">Creative URL</th>
                  <th className="p-2.5">Status</th>
                  <th className="p-2.5">Client Feedback</th>
                  <th className="p-2.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {filteredFeed.map((p) => (
                  <tr key={p.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                    <td className="p-2 font-mono font-bold">{p.cycle}</td>
                    <td className="p-2">
                      <input
                        type="text"
                        value={p.contentName}
                        onChange={(e) =>
                          updateDraft((prev) => ({
                            ...prev,
                            feedCalendar: prev.feedCalendar.map((x) =>
                              x.id === p.id ? { ...x, contentName: e.target.value } : x,
                            ),
                          }))
                        }
                        className="w-20 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs font-bold"
                      />
                    </td>
                    <td className="p-2 whitespace-nowrap">
                      <input
                        type="text"
                        value={p.publishDate}
                        onChange={(e) =>
                          updateDraft((prev) => ({
                            ...prev,
                            feedCalendar: prev.feedCalendar.map((x) =>
                              x.id === p.id ? { ...x, publishDate: e.target.value } : x,
                            ),
                          }))
                        }
                        dir="ltr"
                        className="w-28 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs font-mono"
                      />
                      <span className="ms-1 text-[10px] font-mono text-zinc-500">{p.day}</span>
                    </td>
                    <td className="p-2">
                      <input
                        type="text"
                        value={p.cairoTime}
                        onChange={(e) =>
                          updateDraft((prev) => ({
                            ...prev,
                            feedCalendar: prev.feedCalendar.map((x) =>
                              x.id === p.id ? { ...x, cairoTime: e.target.value } : x,
                            ),
                          }))
                        }
                        dir="ltr"
                        className="w-20 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs font-mono"
                      />
                    </td>
                    <td className="p-2">
                      <select
                        value={p.format}
                        onChange={(e) =>
                          updateDraft((prev) => ({
                            ...prev,
                            feedCalendar: prev.feedCalendar.map((x) =>
                              x.id === p.id ? { ...x, format: e.target.value as FeedPostItem["format"] } : x,
                            ),
                          }))
                        }
                        className="rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs font-bold"
                      >
                        <option value="Post">Post</option>
                        <option value="Reel">Reel</option>
                        <option value="Carousel">Carousel</option>
                        <option value="Video">Video</option>
                      </select>
                    </td>
                    <td className="p-2 space-y-1">
                      <input
                        type="text"
                        value={p.topicTitle || ""}
                        onChange={(e) =>
                          updateDraft((prev) => ({
                            ...prev,
                            feedCalendar: prev.feedCalendar.map((x) =>
                              x.id === p.id ? { ...x, topicTitle: e.target.value } : x,
                            ),
                          }))
                        }
                        placeholder="عنوان الفكرة / الموضوع..."
                        className="w-48 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs font-bold block"
                      />
                      <input
                        type="text"
                        value={p.captionText || ""}
                        onChange={(e) =>
                          updateDraft((prev) => ({
                            ...prev,
                            feedCalendar: prev.feedCalendar.map((x) =>
                              x.id === p.id ? { ...x, captionText: e.target.value } : x,
                            ),
                          }))
                        }
                        placeholder="الكابشن / السكريبت..."
                        className="w-48 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-[11px] block"
                      />
                    </td>
                    <td className="p-2">
                      <input
                        type="url"
                        value={p.assetLink || ""}
                        onChange={(e) =>
                          updateDraft((prev) => ({
                            ...prev,
                            feedCalendar: prev.feedCalendar.map((x) =>
                              x.id === p.id ? { ...x, assetLink: e.target.value } : x,
                            ),
                          }))
                        }
                        placeholder="https://drive..."
                        dir="ltr"
                        className="w-36 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs font-mono"
                      />
                    </td>
                    <td className="p-2">
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
                        className="rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs font-bold"
                      >
                        {PUBLISH_STATUSES.map((st) => (
                          <option key={st} value={st}>{st}</option>
                        ))}
                      </select>
                    </td>
                    <td className="p-2 max-w-xs text-[11px] text-amber-700 dark:text-amber-300">
                      {p.clientComment || "—"}
                    </td>
                    <td className="p-2">
                      <button
                        type="button"
                        onClick={() =>
                          updateDraft((prev) => ({
                            ...prev,
                            feedCalendar: prev.feedCalendar.filter((x) => x.id !== p.id),
                          }))
                        }
                        className="text-rose-600 font-bold cursor-pointer"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── TAB 4: DAILY STORIES EDITOR ── */}
      {activeTab === "stories" && (
        <div className="rounded-2xl border-2 border-zinc-900 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-zinc-950 dark:text-white">
                إدارة الـ Stories اليومية ({filteredStories.length})
              </h2>
              <p className="text-xs text-zinc-500">
                جدول الاستوريهات اليومية الساعة 6:00 مساءً بتوقيت القاهرة شاملة الجمعة والسبت.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800 max-h-[600px]">
            <table className="w-full text-xs text-left">
              <thead className="sticky top-0 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 uppercase text-[10px]">
                <tr>
                  <th className="p-2.5">Cycle</th>
                  <th className="p-2.5">Story ID</th>
                  <th className="p-2.5">Publish Date</th>
                  <th className="p-2.5">Day</th>
                  <th className="p-2.5">Time</th>
                  <th className="p-2.5">Topic / Asset Link</th>
                  <th className="p-2.5">Actual Publish</th>
                  <th className="p-2.5">Status</th>
                  <th className="p-2.5">Client Comment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {filteredStories.map((s: DailyStoryItem) => (
                  <tr key={s.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                    <td className="p-2 font-mono font-bold">{s.cycle}</td>
                    <td className="p-2 font-bold">{s.storyId}</td>
                    <td className="p-2 font-mono" dir="ltr">{s.publishDate}</td>
                    <td className="p-2 font-mono">{s.day}</td>
                    <td className="p-2 font-mono" dir="ltr">{s.cairoTime}</td>
                    <td className="p-2">
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
                        placeholder="Topic or Drive Link..."
                        className="w-56 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs"
                      />
                    </td>
                    <td className="p-2">
                      <input
                        type="text"
                        value={s.actualPublish}
                        onChange={(e) =>
                          updateDraft((prev) => ({
                            ...prev,
                            dailyStories: prev.dailyStories.map((x) =>
                              x.id === s.id ? { ...x, actualPublish: e.target.value } : x,
                            ),
                          }))
                        }
                        dir="ltr"
                        className="w-28 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs font-mono"
                      />
                    </td>
                    <td className="p-2">
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
                        className="rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs font-bold"
                      >
                        {PUBLISH_STATUSES.map((st) => (
                          <option key={st} value={st}>{st}</option>
                        ))}
                      </select>
                    </td>
                    <td className="p-2 text-[11px] text-amber-700 dark:text-amber-300">
                      {s.clientComment || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── TAB 5: PAID MEDIA & CLIENT INTERACTIONS LOG ── */}
      {activeTab === "ads" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-2xl border-2 border-zinc-900 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-zinc-950 dark:text-white">
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
                        campaignName: "New Meta Ads Campaign",
                        objective: "Lead Generation & Messages",
                        budgetEgp: 20000,
                        platforms: "Facebook + Instagram",
                        creativeLink: "",
                        adAccountAccessConfirmed: true,
                        status: "Waiting Approval",
                      },
                    ],
                  }))
                }
                className="px-3 py-1.5 rounded-lg bg-zinc-900 text-white text-xs font-bold cursor-pointer"
              >
                + إضافة حملة
              </button>
            </div>

            <div className="space-y-3">
              {draft.paidCampaigns.map((c: PaidMediaCampaignItem) => (
                <div
                  key={c.id}
                  className="rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 p-4 space-y-2.5 text-xs"
                >
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
                      className="rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-1.5 font-bold"
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
                      className="rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-1.5 font-bold"
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
                        className="w-full rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1"
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
                        className="w-full rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 font-mono"
                      />
                    </div>
                  </div>
                  <div>
                    <span className="text-[10px] text-zinc-500">Performance Report Link (Drive / PDF)</span>
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
                      className="w-full rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 font-mono"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Client Interactions Feed */}
          <div className="rounded-2xl border-2 border-zinc-900 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-5 space-y-4">
            <h2 className="text-base font-bold text-zinc-950 dark:text-white">
              سجل اعتمادات وملاحظات العميل اللحظي ({interactions.length})
            </h2>
            {interactions.length === 0 ? (
              <p className="text-xs text-zinc-500">لا توجد حركات مسجلة من العميل حتى الآن.</p>
            ) : (
              <div className="space-y-2.5 max-h-[520px] overflow-y-auto">
                {[...interactions].reverse().map((ev) => (
                  <div
                    key={ev.id}
                    className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50 p-3.5 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between text-[11px] text-zinc-500">
                      <strong className="text-zinc-900 dark:text-white">{ev.actorName}</strong>
                      <span dir="ltr">{new Date(ev.createdAtIso).toLocaleString()}</span>
                    </div>
                    <p className="font-bold text-emerald-700 dark:text-emerald-400">
                      [{ev.actionType.toUpperCase()}] {ev.targetLabel}
                    </p>
                    {ev.comment && <p className="text-zinc-700 dark:text-zinc-300">{ev.comment}</p>}
                    {ev.linkUrl && (
                      <a
                        href={ev.linkUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-block text-indigo-600 dark:text-amber-400 font-bold hover:underline"
                      >
                        🔗 فتح الرابط المرفق من العميل ↗
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── MODAL: CREATE NEW CLIENT PORTAL ── */}
      {newClientModal && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setNewClientModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border-2 border-zinc-900 bg-white dark:bg-zinc-900 p-6 shadow-2xl space-y-4"
          >
            <h3 className="text-lg font-bold text-zinc-950 dark:text-white">
              إضافة بوابة عميل جديدة (New Client Rollout Portal)
            </h3>
            <form onSubmit={handleCreateNewClient} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold mb-1">اسم العميل / الشركة</label>
                <input
                  type="text"
                  required
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                  placeholder="مثال: ARC Developments"
                  className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold mb-1">كود الدخول (Client Code)</label>
                  <input
                    type="text"
                    required
                    value={newClientCode}
                    onChange={(e) => setNewClientCode(e.target.value.toUpperCase())}
                    placeholder="ARC2"
                    dir="ltr"
                    className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 font-mono uppercase"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1">الرقم السري (PIN)</label>
                  <input
                    type="text"
                    required
                    value={newClientPin}
                    onChange={(e) => setNewClientPin(e.target.value)}
                    placeholder="2026"
                    dir="ltr"
                    className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="block font-bold mb-1">رابط Google Sheet للاستيراد التلقائي (اختياري)</label>
                <input
                  type="url"
                  value={newClientSheetUrl}
                  onChange={(e) => setNewClientSheetUrl(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  dir="ltr"
                  className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 font-mono"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setNewClientModal(false)}
                  className="px-4 py-2 rounded-lg bg-zinc-200 dark:bg-zinc-800 font-bold cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 rounded-lg bg-emerald-600 text-white font-bold cursor-pointer"
                >
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
