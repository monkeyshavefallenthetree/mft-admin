"use client";

import { useEffect, useMemo, useState } from "react";
import { auth, db } from "@/lib/firebase";
import { toast } from "@/lib/admin/feedback";
import { logActivity } from "@/lib/admin/activity";
import { sendExpoPushToWorkers } from "@/lib/chatNotifications";
import { notifyAdmins } from "@/lib/adminNotifications";
import { EmptyState, PageHeader, SkeletonRows, STATE_ICONS } from "@/components/admin/ui/States";
import ModalPortal from "@/components/admin/ui/ModalPortal";
import { ICONS } from "@/lib/admin/nav";
import { DEFAULT_HR_SETTINGS, type HrSettings } from "@/lib/admin/hrReports";
import {
  approveReimbursementFinal,
  approveReimbursementQuote,
  loadReimbursementAttachments,
  rejectReimbursement,
  subscribeHrSettings,
  subscribeReimbursements,
  type ReimbursementAttachmentDoc,
  type ReimbursementDoc,
} from "@/lib/admin/hrSettings";
import {
  policyConfigFromSettings,
  REIMBURSEMENT_STAGE_AR,
  validateReimbursement,
  type ReimbursementFlag,
  type ReimbursementStage,
} from "@/lib/admin/hrPolicy2026";

/**
 * HR-POL-2026 clause 5 — reimbursement review.
 * Outdoor missions: ride-hailing screenshot (route + endpoints + price).
 * Purchases: two stages — quote pre-approval, then invoice that must match the approved amount.
 */

function Svg({ d, className = "h-4 w-4" }: { d: string; className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

const adminId = () => auth.currentUser?.email ?? "admin";
const egp = (n?: number | null) => (n == null || Number.isNaN(Number(n)) ? "—" : `EGP ${Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`);

type TabKey = "pre_approval" | "review" | "pending_invoice" | "approved" | "rejected" | "all";

const TABS: { key: TabKey; label: string; ar: string }[] = [
  { key: "pre_approval", label: "Pre-approval", ar: "موافقة مسبقة" },
  { key: "review", label: "Invoice review", ar: "مراجعة" },
  { key: "pending_invoice", label: "Awaiting invoice", ar: "بانتظار الفاتورة" },
  { key: "approved", label: "Approved", ar: "معتمد" },
  { key: "rejected", label: "Rejected", ar: "مرفوض" },
  { key: "all", label: "All", ar: "الكل" },
];

const STAGE_TONE: Record<ReimbursementStage, string> = {
  pre_approval: "bg-amber-100 text-amber-800 border-amber-200",
  pending_invoice: "bg-sky-100 text-sky-800 border-sky-200",
  review: "bg-orange-100 text-orange-800 border-orange-200",
  approved: "bg-emerald-100 text-emerald-800 border-emerald-200",
  rejected: "bg-red-100 text-red-700 border-red-200",
};

const KIND_LABEL: Record<ReimbursementAttachmentDoc["kind"], string> = {
  ride_screenshot: "لقطة تطبيق النقل",
  quote: "عرض السعر",
  proforma: "فاتورة مبدئية",
  invoice: "الفاتورة النهائية",
};

type CheckItem = { key: string; label: string; ar: string };

function checklistFor(r: ReimbursementDoc): CheckItem[] {
  if (r.type === "outdoor") {
    return [
      { key: "route_visible", label: "Route / map is visible", ar: "خط السير ظاهر" },
      { key: "endpoints_visible", label: "Start & end points visible", ar: "نقطة البداية والنهاية ظاهرة" },
      { key: "price_visible", label: "Final price visible", ar: "السعر النهائي ظاهر" },
      { key: "amount_matches", label: "Claimed amount = screenshot price", ar: "المبلغ المطلوب = السعر في اللقطة" },
      { key: "mission_valid", label: "Trip matches a work mission", ar: "الرحلة مرتبطة بمأمورية عمل" },
    ];
  }
  if (r.stage === "pre_approval") {
    return [
      { key: "quote_valid", label: "Quote / link is clear and current", ar: "عرض السعر أو الرابط واضح وحديث" },
      { key: "purpose_valid", label: "Business purpose justified", ar: "الغرض مبرر للعمل" },
    ];
  }
  return [
    { key: "invoice_official", label: "Invoice / proforma is legible", ar: "الفاتورة مقروءة ورسمية" },
    { key: "invoice_matches_items", label: "Items match the approved quote", ar: "الأصناف مطابقة لعرض السعر المعتمد" },
    { key: "invoice_matches_amount", label: "Amount ≤ approved amount", ar: "المبلغ لا يتجاوز المعتمد" },
  ];
}

export default function AdminReimbursementsPage() {
  const [rows, setRows] = useState<ReimbursementDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<HrSettings>(DEFAULT_HR_SETTINGS);
  const [tab, setTab] = useState<TabKey>("pre_approval");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"" | "outdoor" | "purchase">("");
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let first = true;
    const u1 = subscribeReimbursements((list) => {
      setRows(list);
      setLoading(false);
      // Auto-pick the most useful tab on first load.
      if (first) {
        first = false;
        if (!list.some((r) => r.stage === "pre_approval") && list.some((r) => r.stage === "review")) setTab("review");
      }
    });
    const u2 = subscribeHrSettings(setSettings);
    return () => {
      u1();
      u2();
    };
  }, []);

  const cfg = useMemo(() => policyConfigFromSettings(settings), [settings]);

  /** Flags per claim, including duplicate-image detection across all other claims. */
  const flagsById = useMemo(() => {
    const hashOwners = new Map<string, Set<string>>();
    rows.forEach((r) => (r.imageHashes ?? []).forEach((h) => {
      if (!hashOwners.has(h)) hashOwners.set(h, new Set());
      hashOwners.get(h)!.add(r.id);
    }));
    const out = new Map<string, ReimbursementFlag[]>();
    rows.forEach((r) => {
      const known = new Set<string>();
      (r.imageHashes ?? []).forEach((h) => {
        const owners = hashOwners.get(h);
        if (owners && [...owners].some((id) => id !== r.id)) known.add(h);
      });
      out.set(r.id, validateReimbursement(r, { knownHashes: known, cfg }));
    });
    return out;
  }, [rows, cfg]);

  const counts = useMemo(() => {
    const c: Record<TabKey, number> = { pre_approval: 0, review: 0, pending_invoice: 0, approved: 0, rejected: 0, all: rows.length };
    rows.forEach((r) => (c[r.stage] = (c[r.stage] ?? 0) + 1));
    return c;
  }, [rows]);

  const paidThisMonth = useMemo(() => {
    const now = new Date();
    return rows
      .filter((r) => r.stage === "approved" && r.reviewedAt?.toDate && r.reviewedAt.toDate().getMonth() === now.getMonth() && r.reviewedAt.toDate().getFullYear() === now.getFullYear())
      .reduce((s, r) => s + Number((r as ReimbursementDoc & { paidAmount?: number }).paidAmount ?? r.approvedAmount ?? r.amount ?? 0), 0);
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (tab !== "all" && r.stage !== tab) return false;
      if (typeFilter && r.type !== typeFilter) return false;
      if (!q) return true;
      return [r.workerName, r.workerEmail, r.purpose, r.routeFrom, r.routeTo].some((v) => (v ?? "").toLowerCase().includes(q));
    });
  }, [rows, tab, typeFilter, search]);

  const open = rows.find((r) => r.id === openId) ?? null;

  return (
    <div className="pb-24">
      <PageHeader
        title="Reimbursements · المصروفات"
        description="HR-POL-2026 clause 5 — outdoor missions (ride-hailing proof) and two-stage purchase approvals."
      />

      {!settings.policy2026Enabled && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
          <Svg d={STATE_ICONS.error} className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            HR-POL-2026 is currently <b>disabled</b> in Policies. Workers can still submit claims; approved claims are always added to payroll as an allowance.
          </p>
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: "Needs pre-approval", value: counts.pre_approval, tone: "text-amber-600", ring: "bg-amber-500" },
          { label: "Invoices to review", value: counts.review, tone: "text-orange-600", ring: "bg-orange-500" },
          { label: "Awaiting worker invoice", value: counts.pending_invoice, tone: "text-sky-600", ring: "bg-sky-500" },
          { label: "Paid this month", value: egp(paidThisMonth), tone: "text-emerald-600", ring: "bg-emerald-500" },
        ].map((s) => (
          <div key={s.label} className="ui-card relative overflow-hidden px-4 py-3">
            <span className={`absolute left-0 top-0 h-full w-1 ${s.ring}`} />
            <p className="text-[11px] font-medium text-zinc-500">{s.label}</p>
            <p className={`mt-1 text-2xl font-bold tracking-tight ${s.tone}`}>{loading ? "—" : s.value}</p>
          </div>
        ))}
      </div>

      <div className="ui-card mb-4 overflow-hidden">
        <div className="flex flex-wrap items-center gap-1 border-b border-zinc-100 px-3 pt-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              id={`reimb-tab-${t.key}`}
              onClick={() => setTab(t.key)}
              className={`relative flex items-center gap-2 px-3 pb-2.5 pt-1.5 text-[13px] font-medium transition-colors cursor-pointer ${tab === t.key ? "text-zinc-900" : "text-zinc-500 hover:text-zinc-800"}`}
            >
              {t.label}
              <span className="text-[11px] text-zinc-400" dir="rtl">{t.ar}</span>
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${tab === t.key ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-600"}`}>{counts[t.key]}</span>
              {tab === t.key && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-red-600" />}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2 p-3 md:flex-row md:items-center">
          <div className="relative flex-1">
            <Svg d={STATE_ICONS.search} className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input id="reimb-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search worker, purpose or route…" className="brutal-input pl-9" />
          </div>
          <select id="reimb-type-filter" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)} className="brutal-input md:w-52">
            <option value="">All claim types</option>
            <option value="outdoor">Outdoor mission (مأمورية)</option>
            <option value="purchase">Purchase (مشتريات)</option>
          </select>
        </div>
      </div>

      <div className="ui-card overflow-hidden">
        {loading ? (
          <SkeletonRows rows={5} cols={4} />
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No claims here"
            description={tab === "all" ? "Workers submit claims from the Expenses tab in the worker app." : "Nothing in this stage right now."}
            icon={ICONS.reimbursements}
          />
        ) : (
          <ul className="divide-y divide-zinc-100">
            {filtered.map((r) => {
              const flags = flagsById.get(r.id) ?? [];
              const errors = flags.filter((f) => f.severity === "error").length;
              const warns = flags.length - errors;
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    id={`reimb-row-${r.id}`}
                    onClick={() => setOpenId(r.id)}
                    className="group flex w-full items-center gap-4 px-4 py-3.5 text-left transition-colors hover:bg-zinc-50 cursor-pointer"
                  >
                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${r.type === "outdoor" ? "bg-sky-50 text-sky-700" : "bg-violet-50 text-violet-700"}`}>
                      <Svg d={r.type === "outdoor" ? "M17.657 16.657L13.414 20.9a2 2 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0zM15 11a3 3 0 11-6 0 3 3 0 016 0z" : "M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-semibold text-zinc-900">{r.workerName || r.workerEmail || "Worker"}</p>
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STAGE_TONE[r.stage]}`} dir="rtl">{REIMBURSEMENT_STAGE_AR[r.stage]}</span>
                        {errors > 0 && <span className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold text-white">{errors} issue{errors > 1 ? "s" : ""}</span>}
                        {warns > 0 && <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold text-white">{warns} warning{warns > 1 ? "s" : ""}</span>}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-zinc-500" dir="auto">
                        {r.type === "outdoor" ? `${r.routeFrom || "?"} → ${r.routeTo || "?"} · ` : ""}
                        {r.purpose}
                      </p>
                    </div>
                    <div className="hidden text-right sm:block">
                      <p className="text-sm font-bold text-zinc-900">{egp(r.invoiceAmount ?? r.amount)}</p>
                      <p className="text-[11px] text-zinc-400">{r.date}</p>
                    </div>
                    <Svg d="M9 5l7 7-7 7" className="h-4 w-4 text-zinc-300 transition-transform group-hover:translate-x-0.5 group-hover:text-zinc-500" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {open && <ReviewDrawer key={open.id} r={open} flags={flagsById.get(open.id) ?? []} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function ReviewDrawer({ r, flags, onClose }: { r: ReimbursementDoc; flags: ReimbursementFlag[]; onClose: () => void }) {
  const [attachments, setAttachments] = useState<ReimbursementAttachmentDoc[] | null>(null);
  const [zoom, setZoom] = useState<ReimbursementAttachmentDoc | null>(null);
  const items = checklistFor(r);
  const [checks, setChecks] = useState<Record<string, boolean>>(() => ({ ...(r.checklist ?? {}) }));
  const defaultAmount =
    r.stage === "pre_approval"
      ? Number(r.amount || 0)
      : r.type === "purchase"
        ? Math.min(Number(r.invoiceAmount || r.amount || 0), Number(r.approvedAmount || Infinity))
        : Number(r.amount || 0);
  const [amount, setAmount] = useState<string>(String(Number.isFinite(defaultAmount) ? defaultAmount : 0));
  const [note, setNote] = useState("");
  const [override, setOverride] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    loadReimbursementAttachments(r).then((a) => alive && setAttachments(a));
    return () => {
      alive = false;
    };
  }, [r]);

  const amt = Number(amount);
  const allChecked = items.every((i) => checks[i.key]);
  const overApproval = r.type === "purchase" && r.stage === "review" && Number(r.approvedAmount) > 0 && amt > Number(r.approvedAmount);
  const blockingErrors = flags.filter((f) => f.severity === "error" && f.code !== "duplicate_image");
  const duplicate = flags.some((f) => f.code === "duplicate_image");
  const canDecide = r.stage === "pre_approval" || r.stage === "review";

  const label = `${r.type === "outdoor" ? "Outdoor" : "Purchase"} · ${r.workerName ?? "worker"}`;

  const doApproveQuote = async () => {
    if (!(amt > 0)) return toast.error("Enter the approved amount");
    if (!allChecked) return toast.warning("Complete the checklist first");
    setBusy(true);
    try {
      await approveReimbursementQuote(r, amt, note.trim(), adminId());
      if (r.workerId) {
        void sendExpoPushToWorkers(db, {
          recipientUids: [r.workerId],
          title: "Purchase Quote Pre-Approved ✓",
          body: `Approved ${egp(amt)} for "${r.purpose}". Upload the official invoice after purchase.`,
          tab: "expenses",
        });
      }
      void notifyAdmins(db, {
        targetRoles: ["super_admin", "hr_admin"],
        category: "hr",
        eventType: "reimbursement_quote_approved",
        title: `✅ Quote Pre-Approved: ${r.workerName ?? "Worker"}`,
        body: `${egp(amt)} pre-approved for "${r.purpose}" by ${adminId()}.`,
        href: "/admin/reimbursements",
        actorUid: auth.currentUser?.uid,
        actorName: adminId(),
      });
      void logActivity({ action: "approved", entity: "hr", entityId: r.id, label: `Quote pre-approved — ${label}`, detail: egp(amt) });
      toast.success("Quote approved", { description: "The worker can now buy and upload the invoice." });
      onClose();
    } catch (e) {
      toast.error("Approval failed", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  const doApproveFinal = async () => {
    if (!(amt > 0)) return toast.error("Enter the amount to pay");
    if (!allChecked && !override.trim()) return toast.warning("Complete the checklist or write an override reason");
    if (overApproval && !override.trim()) return toast.warning("Amount exceeds the pre-approved value — an override reason is required");
    if (duplicate && !override.trim()) return toast.warning("Duplicate image detected — an override reason is required");
    setBusy(true);
    try {
      await approveReimbursementFinal(r, { amount: amt, note: note.trim(), checklist: checks, overrideReason: override.trim() || undefined }, adminId());
      if (r.workerId) {
        void sendExpoPushToWorkers(db, {
          recipientUids: [r.workerId],
          title: "Reimbursement Approved 💰",
          body: `${egp(amt)} for "${r.purpose}" has been approved and added to your payroll.`,
          tab: "expenses",
        });
      }
      void notifyAdmins(db, {
        targetRoles: ["super_admin", "hr_admin"],
        category: "hr",
        eventType: "reimbursement_approved",
        title: `💰 Reimbursement Approved: ${r.workerName ?? "Worker"}`,
        body: `${egp(amt)} approved for "${r.purpose}" and added to payroll by ${adminId()}.`,
        href: "/admin/reimbursements",
        actorUid: auth.currentUser?.uid,
        actorName: adminId(),
      });
      void logActivity({ action: "approved", entity: "hr", entityId: r.id, label: `Reimbursement approved — ${label}`, detail: `${egp(amt)} → payroll allowance${override.trim() ? ` · override: ${override.trim()}` : ""}` });
      toast.success("Reimbursement approved", { description: `${egp(amt)} added to the worker's payroll as an allowance.` });
      onClose();
    } catch (e) {
      toast.error("Approval failed", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  const doReject = async () => {
    if (!note.trim()) return toast.warning("Write a rejection reason for the worker");
    setBusy(true);
    try {
      await rejectReimbursement(r, note.trim(), adminId());
      if (r.workerId) {
        void sendExpoPushToWorkers(db, {
          recipientUids: [r.workerId],
          title: "Reimbursement Claim Rejected",
          body: note.trim(),
          tab: "expenses",
          urgent: true,
        });
      }
      void notifyAdmins(db, {
        targetRoles: ["super_admin", "hr_admin"],
        category: "hr",
        eventType: "reimbursement_rejected",
        title: `❌ Reimbursement Rejected: ${r.workerName ?? "Worker"}`,
        body: `"${r.purpose}" rejected by ${adminId()}: ${note.trim()}`,
        href: "/admin/reimbursements",
        actorUid: auth.currentUser?.uid,
        actorName: adminId(),
        urgent: true,
      });
      void logActivity({ action: "rejected", entity: "hr", entityId: r.id, label: `Reimbursement rejected — ${label}`, detail: note.trim().slice(0, 120) });
      toast.success("Claim rejected");
      onClose();
    } catch (e) {
      toast.error("Reject failed", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalPortal onClose={zoom ? () => setZoom(null) : onClose}>
      <div className="fixed inset-0 z-[120] flex justify-end bg-zinc-950/45 backdrop-blur-[2px] animate-fade-in" onMouseDown={(ev) => ev.target === ev.currentTarget && onClose()}>
        <aside id="reimb-drawer" className="flex h-full w-full max-w-xl flex-col overflow-hidden border-l border-zinc-200 bg-white animate-slide-up" style={{ boxShadow: "var(--mft-shadow-lg)" }}>
          <header className="flex items-start justify-between gap-3 border-b border-zinc-100 px-5 py-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STAGE_TONE[r.stage]}`} dir="rtl">{REIMBURSEMENT_STAGE_AR[r.stage]}</span>
                <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">{r.type === "outdoor" ? "Outdoor mission · مأمورية" : "Purchase · مشتريات"}</span>
              </div>
              <h3 className="mt-1 truncate text-lg font-bold text-zinc-900">{r.workerName || r.workerEmail}</h3>
              <p className="text-xs text-zinc-500">{r.date} · {r.workerEmail}</p>
            </div>
            <button type="button" id="reimb-drawer-close" onClick={onClose} className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 cursor-pointer" aria-label="Close">
              <Svg d="M6 18L18 6M6 6l12 12" />
            </button>
          </header>

          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
            {/* Facts */}
            <section className="grid grid-cols-2 gap-3 text-sm">
              <Fact label="Purpose · الغرض" value={r.purpose} wide />
              {r.type === "outdoor" && <Fact label="From · من" value={r.routeFrom} />}
              {r.type === "outdoor" && <Fact label="To · إلى" value={r.routeTo} />}
              <Fact label={r.type === "outdoor" ? "Ride price · سعر الرحلة" : "Quoted · عرض السعر"} value={egp(r.amount)} />
              {r.type === "purchase" && <Fact label="Approved · المعتمد" value={egp(r.approvedAmount)} />}
              {r.type === "purchase" && <Fact label="Invoice · الفاتورة" value={egp(r.invoiceAmount)} />}
              {r.quoteLink && (
                <div className="col-span-2">
                  <p className="text-[11px] font-medium text-zinc-500">Quote link · رابط العرض</p>
                  <a href={r.quoteLink} target="_blank" rel="noreferrer noopener" className="break-all text-sm font-medium text-red-600 underline-offset-2 hover:underline">{r.quoteLink}</a>
                </div>
              )}
            </section>

            {/* Flags */}
            {flags.length > 0 && (
              <section className="space-y-2" dir="rtl">
                {flags.map((f) => (
                  <div key={f.code} className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-[13px] ${f.severity === "error" ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
                    <Svg d={STATE_ICONS.error} className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{f.messageAr}</span>
                  </div>
                ))}
              </section>
            )}

            {/* Attachments */}
            <section>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Attachments · المرفقات</p>
              {attachments === null ? (
                <div className="grid grid-cols-2 gap-3">
                  {[0, 1].map((i) => <div key={i} className="mft-skeleton h-36 rounded-lg" />)}
                </div>
              ) : attachments.length === 0 ? (
                <p className="rounded-lg border border-dashed border-zinc-300 px-3 py-6 text-center text-xs text-zinc-500">No images attached.</p>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {attachments.map((a) => (
                    <button key={a.id} type="button" id={`reimb-att-${a.id}`} onClick={() => setZoom(a)} className="group overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 text-left transition-shadow hover:shadow-md cursor-zoom-in">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={a.dataUrl} alt={KIND_LABEL[a.kind]} className="h-36 w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
                      <div className="flex items-center justify-between px-2 py-1.5 text-[11px]">
                        <span className="font-medium text-zinc-700" dir="rtl">{KIND_LABEL[a.kind]}</span>
                        <span className="text-zinc-400">{a.bytes ? `${Math.round(a.bytes / 1024)} KB` : ""}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </section>

            {/* Checklist */}
            {canDecide && (
              <section>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Verification checklist · قائمة التحقق</p>
                <div className="space-y-1.5">
                  {items.map((i) => (
                    <label key={i.key} className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-[13px] transition-colors ${checks[i.key] ? "border-emerald-300 bg-emerald-50" : "border-zinc-200 hover:bg-zinc-50"}`}>
                      <input id={`reimb-check-${i.key}`} type="checkbox" checked={!!checks[i.key]} onChange={(e) => setChecks((c) => ({ ...c, [i.key]: e.target.checked }))} className="h-4 w-4 accent-emerald-600" />
                      <span className="flex-1 text-zinc-800">{i.label}</span>
                      <span className="text-[12px] text-zinc-500" dir="rtl">{i.ar}</span>
                    </label>
                  ))}
                </div>
              </section>
            )}

            {/* Decision inputs */}
            {canDecide && (
              <section className="space-y-3">
                <div>
                  <label htmlFor="reimb-amount" className="mb-1.5 block text-xs font-medium text-zinc-700">
                    {r.stage === "pre_approval" ? "Approved amount (locks the ceiling) · المبلغ المعتمد" : "Amount to pay · المبلغ المصروف"}
                  </label>
                  <input id="reimb-amount" type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="brutal-input" />
                  {overApproval && <p className="mt-1 text-[12px] font-medium text-red-600" dir="rtl">المبلغ يتجاوز الموافقة المسبقة ({egp(r.approvedAmount)}) — يلزم سبب للاستثناء.</p>}
                </div>
                {r.stage === "review" && (overApproval || !allChecked || duplicate || blockingErrors.length > 0) && (
                  <div>
                    <label htmlFor="reimb-override" className="mb-1.5 block text-xs font-medium text-zinc-700">Override reason · سبب الاستثناء</label>
                    <input id="reimb-override" value={override} onChange={(e) => setOverride(e.target.value)} placeholder="Required to approve despite issues" className="brutal-input" />
                  </div>
                )}
                <div>
                  <label htmlFor="reimb-note" className="mb-1.5 block text-xs font-medium text-zinc-700">Note to worker · ملاحظة للموظف</label>
                  <textarea id="reimb-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Required when rejecting" className="brutal-input resize-y" />
                </div>
              </section>
            )}

            {!canDecide && (
              <section className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3 text-[13px] text-zinc-700">
                {r.stage === "pending_invoice" && <p dir="rtl">تمت الموافقة المسبقة على {egp(r.approvedAmount)}. بانتظار رفع الفاتورة من الموظف.</p>}
                {r.stage === "approved" && (
                  <p>
                    Paid {egp((r as ReimbursementDoc & { paidAmount?: number }).paidAmount ?? r.approvedAmount)} as a payroll allowance
                    {r.payrollAdjustmentId ? ` (adjustment ${r.payrollAdjustmentId.slice(0, 6)}…)` : ""}. Reviewed by {r.reviewedBy ?? "—"}.
                  </p>
                )}
                {r.stage === "rejected" && <p>Rejected by {r.reviewedBy ?? "—"}.</p>}
                {r.adminNote && <p className="mt-1 text-zinc-500" dir="auto">“{r.adminNote}”</p>}
                {r.overrideReason && <p className="mt-1 text-amber-700" dir="auto">Override: {r.overrideReason}</p>}
              </section>
            )}
          </div>

          <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-zinc-100 bg-zinc-50/60 px-5 py-3">
            {(canDecide || r.stage === "pending_invoice") && (
              <button type="button" id="reimb-reject" disabled={busy} onClick={doReject} className="brutal-btn-outline normal-case tracking-normal text-red-600 disabled:opacity-50">
                Reject · رفض
              </button>
            )}
            {r.stage === "pre_approval" && (
              <button type="button" id="reimb-approve-quote" disabled={busy} onClick={doApproveQuote} className="brutal-btn normal-case tracking-normal disabled:opacity-50">
                Approve quote · موافقة مسبقة
              </button>
            )}
            {r.stage === "review" && (
              <button type="button" id="reimb-approve-final" disabled={busy} onClick={doApproveFinal} className="brutal-btn normal-case tracking-normal disabled:opacity-50">
                Approve &amp; add to payroll · اعتماد
              </button>
            )}
          </footer>
        </aside>

        {zoom && (
          <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/80 p-6 animate-fade-in" onMouseDown={() => setZoom(null)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={zoom.dataUrl} alt={KIND_LABEL[zoom.kind]} className="max-h-full max-w-full rounded-lg object-contain shadow-2xl animate-scale-in" />
            <p className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 font-mono text-[11px] text-white/80">sha256 {zoom.sha256?.slice(0, 16)}…</p>
          </div>
        )}
      </div>
    </ModalPortal>
  );
}

function Fact({ label, value, wide }: { label: string; value?: string | null; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-2" : ""}>
      <p className="text-[11px] font-medium text-zinc-500">{label}</p>
      <p className="mt-0.5 font-medium text-zinc-900" dir="auto">{value || "—"}</p>
    </div>
  );
}
