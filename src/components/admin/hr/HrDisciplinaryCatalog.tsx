"use client";

import { useMemo, useState } from "react";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import ModalPortal from "@/components/admin/ui/ModalPortal";
import {
  DISCIPLINARY_RULES,
  VIOLATION_CATEGORIES,
  computeDisciplinaryDeductionEgp,
  computeWorkerDailyWageEgp,
  type DisciplinaryViolationRule,
  type OffenseTier,
  type TierPenaltySpec,
  type ViolationCategory,
} from "@/lib/admin/hrDisciplinary";
import { addPayrollAdjustment, deletePayrollAdjustment } from "@/lib/admin/hrSettings";
import type { PayrollAdjustment } from "@/lib/admin/hrReports";
import { sendExpoPushToWorkers } from "@/lib/chatNotifications";
import { notifyAdmins } from "@/lib/adminNotifications";
import { logActivity } from "@/lib/admin/activity";
import { toast, confirmDialog } from "@/lib/admin/feedback";
import { useHrLang } from "@/lib/admin/hrI18n";

interface WorkerItem {
  id: string;
  firstName?: string;
  lastName?: string;
  department?: string;
  role?: string;
  hourlyRate?: number;
  expectedSalary?: number | string;
}

interface Props {
  workers: WorkerItem[];
  adjustments: PayrollAdjustment[];
  defaultHourlyRate?: number;
  standardHours?: number;
  adminEmail?: string;
}

function tierBadgeClass(spec: TierPenaltySpec): string {
  if (spec.severity === "termination") {
    return "bg-rose-950 text-white border-rose-800 dark:bg-rose-700 dark:text-white";
  }
  if (spec.severity === "increment_penalty") {
    return "bg-purple-100 text-purple-900 border-purple-300 dark:bg-purple-950/60 dark:text-purple-200 dark:border-purple-800";
  }
  if (spec.severity === "warning" || spec.deductionDays === 0) {
    return "bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-800";
  }
  if (spec.deductionDays <= 0.5) {
    return "bg-orange-100 text-orange-900 border-orange-300 dark:bg-orange-950/60 dark:text-orange-200 dark:border-orange-800";
  }
  if (spec.deductionDays <= 2) {
    return "bg-red-100 text-red-900 border-red-300 dark:bg-red-950/60 dark:text-red-200 dark:border-red-800";
  }
  return "bg-red-600 text-white border-red-700";
}

const TIER_NAMES: Record<OffenseTier, { ar: string; en: string }> = {
  1: { ar: "أول مرة", en: "1st Offense" },
  2: { ar: "ثاني مرة", en: "2nd Offense" },
  3: { ar: "ثالث مرة", en: "3rd Offense" },
  4: { ar: "رابع مرة", en: "4th Offense" },
};

export default function HrDisciplinaryCatalog({
  workers,
  adjustments,
  defaultHourlyRate = 31.25,
  standardHours = 8,
  adminEmail,
}: Props) {
  const { isAr, dir, t } = useHrLang();
  const [categoryFilter, setCategoryFilter] = useState<ViolationCategory | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Apply Penalty Modal State
  const [applyOpen, setApplyOpen] = useState(false);
  const [selectedRuleCode, setSelectedRuleCode] = useState<number>(1);
  const [selectedWorkerId, setSelectedWorkerId] = useState<string>(workers[0]?.id ?? "");
  const [selectedTier, setSelectedTier] = useState<OffenseTier>(1);
  const [customAmount, setCustomAmount] = useState<number | "">("");
  const [customDate, setCustomDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [adminNote, setAdminNote] = useState("");
  const [sendWorkerAlert, setSendWorkerAlert] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const filteredRules = useMemo(() => {
    return DISCIPLINARY_RULES.filter((rule) => {
      if (categoryFilter !== "all" && rule.category !== categoryFilter) return false;
      const q = searchQuery.trim().toLowerCase();
      if (!q) return true;
      return (
        String(rule.code).includes(q) ||
        rule.titleAr.toLowerCase().includes(q) ||
        rule.titleEn.toLowerCase().includes(q) ||
        (rule.notesAr || "").toLowerCase().includes(q)
      );
    });
  }, [categoryFilter, searchQuery]);

  const selectedRule = useMemo(
    () => DISCIPLINARY_RULES.find((r) => r.code === selectedRuleCode) || DISCIPLINARY_RULES[0]!,
    [selectedRuleCode],
  );

  const selectedWorker = useMemo(
    () => workers.find((w) => w.id === selectedWorkerId) || workers[0],
    [workers, selectedWorkerId],
  );

  // Count how many times this worker already had this violation code recorded
  const priorOffenseCount = useMemo(() => {
    if (!selectedWorker || !selectedRule) return 0;
    const tag = `[بند #${selectedRule.code}]`;
    return adjustments.filter(
      (a) =>
        a.workerId === selectedWorker.id &&
        a.type === "deduction" &&
        a.status !== "cancelled" &&
        (a.reason || "").includes(tag),
    ).length;
  }, [adjustments, selectedWorker, selectedRule]);

  const dailyWageEgp = useMemo(() => {
    if (!selectedWorker) return Math.round(defaultHourlyRate * standardHours * 100) / 100;
    return computeWorkerDailyWageEgp(selectedWorker, defaultHourlyRate, standardHours);
  }, [selectedWorker, defaultHourlyRate, standardHours]);

  const autoDeductionEgp = useMemo(() => {
    return computeDisciplinaryDeductionEgp(selectedRule, selectedTier, dailyWageEgp);
  }, [selectedRule, selectedTier, dailyWageEgp]);

  const openApplyModalForRule = (rule: DisciplinaryViolationRule, workerId?: string) => {
    const wId = workerId || selectedWorkerId || (workers[0]?.id ?? "");
    setSelectedRuleCode(rule.code);
    setSelectedWorkerId(wId);

    const tag = `[بند #${rule.code}]`;
    const prior = adjustments.filter(
      (a) =>
        a.workerId === wId &&
        a.type === "deduction" &&
        a.status !== "cancelled" &&
        (a.reason || "").includes(tag),
    ).length;
    const suggestedTier = Math.min(4, Math.max(1, prior + 1)) as OffenseTier;
    setSelectedTier(suggestedTier);
    setCustomAmount("");
    setAdminNote("");
    setApplyOpen(true);
  };

  const handleWorkerChange = (wId: string) => {
    setSelectedWorkerId(wId);
    const tag = `[بند #${selectedRule.code}]`;
    const prior = adjustments.filter(
      (a) =>
        a.workerId === wId &&
        a.type === "deduction" &&
        a.status !== "cancelled" &&
        (a.reason || "").includes(tag),
    ).length;
    setSelectedTier(Math.min(4, Math.max(1, prior + 1)) as OffenseTier);
    setCustomAmount("");
  };

  const handleRuleChange = (code: number) => {
    setSelectedRuleCode(code);
    const tag = `[بند #${code}]`;
    const prior = adjustments.filter(
      (a) =>
        a.workerId === selectedWorkerId &&
        a.type === "deduction" &&
        a.status !== "cancelled" &&
        (a.reason || "").includes(tag),
    ).length;
    setSelectedTier(Math.min(4, Math.max(1, prior + 1)) as OffenseTier);
    setCustomAmount("");
  };

  const handleApplyPenalty = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedWorker) {
      toast.warning(t("يرجى اختيار الموظف أولاً", "Please select a worker first"));
      return;
    }

    const tierSpec = selectedRule.tiers[selectedTier];
    const finalEgp = customAmount !== "" ? Number(customAmount) : autoDeductionEgp;
    const wName = `${selectedWorker.firstName || ""} ${selectedWorker.lastName || ""}`.trim() || "Worker";
    const tierNameAr = TIER_NAMES[selectedTier].ar;
    const fullReason = `[بند #${selectedRule.code} — ${tierNameAr} (${tierSpec.labelAr})]: ${selectedRule.titleAr}${
      adminNote.trim() ? ` — ملاحظة: ${adminNote.trim()}` : ""
    }`;

    setSubmitting(true);
    try {
      // 1. Add payroll deduction if finalEgp > 0
      if (finalEgp > 0) {
        await addPayrollAdjustment(
          {
            workerId: selectedWorker.id,
            workerName: wName,
            type: "deduction",
            amount: finalEgp,
            date: customDate,
            reason: fullReason,
            status: "applied",
          },
          adminEmail,
        );
      }

      // 2. Send official HR Penalty Alert to the worker if enabled
      if (sendWorkerAlert) {
        const alertTitle =
          finalEgp > 0
            ? `⚖️ إخطار جزاء إداري (بند #${selectedRule.code} — خصم ${tierSpec.labelAr})`
            : `⚠️ إخطار جزاء إداري (بند #${selectedRule.code} — ${tierSpec.labelAr})`;
        const alertMessage = [
          `تم توقيع جزاء إداري وفقاً للائحة الجزاءات والمخالفات التأديبية المعتمدة:`,
          `• رقم ونوع المخالفة: (بند #${selectedRule.code}) ${selectedRule.titleAr}`,
          `• درجة التكرار: ${tierNameAr}`,
          `• الجزاء المقرر باللائحة: ${tierSpec.labelAr}${finalEgp > 0 ? ` (خصم ${finalEgp} ج.م في كشف الراتب)` : ""}`,
          selectedRule.notesAr ? `• ملاحظة اللائحة: ${selectedRule.notesAr}` : "",
          adminNote.trim() ? `• تفاصيل إضافية من الـ HR: ${adminNote.trim()}` : "",
        ]
          .filter(Boolean)
          .join("\n");

        await addDoc(collection(db, "alerts"), {
          type: "penalty",
          title: alertTitle,
          message: alertMessage,
          recipient: "individual",
          department: selectedWorker.department || "",
          workerId: selectedWorker.id,
          recipients: [selectedWorker.id],
          recipientCount: 1,
          priority: "high",
          hasPenalty: finalEgp > 0,
          penaltyApplied: finalEgp,
          penaltyReason: fullReason,
          sentBy: adminEmail || "HR",
          sentAt: serverTimestamp(),
          createdAt: serverTimestamp(),
          isRead: false,
          readBy: [],
        });

        void sendExpoPushToWorkers(db, {
          recipientUids: [selectedWorker.id],
          title: alertTitle,
          body: `${selectedRule.titleAr} — ${tierSpec.labelAr}${finalEgp > 0 ? ` (-${finalEgp} EGP)` : ""}`,
          tab: "alerts",
          urgent: true,
        }).catch(() => {});
      }

      void notifyAdmins(db, {
        targetRoles: ["super_admin", "hr_admin"],
        category: "hr",
        eventType: "disciplinary_penalty_applied",
        title: `⚖️ جزاء لائحي (بند #${selectedRule.code}): ${wName}`,
        body: `${tierNameAr} (${tierSpec.labelAr}) — ${finalEgp > 0 ? `خصم ${finalEgp} ج.م` : "إنذار إداري"}`,
        href: "/admin/hr?tab=disciplinary",
        actorUid: auth.currentUser?.uid,
        actorName: adminEmail || "HR",
      });

      void logActivity({
        action: "created",
        entity: "hr",
        entityId: selectedWorker.id,
        label: `Disciplinary Rule #${selectedRule.code} (${tierSpec.labelEn}) on ${wName}`,
        detail: fullReason,
      });

      toast.success(
        finalEgp > 0
          ? t(
              `تم توقيع جزاء البند #${selectedRule.code} (${tierSpec.labelAr} = ${finalEgp} ج.م) على ${wName} وإضافته لشيت الرواتب ✓`,
              `Applied Rule #${selectedRule.code} (-EGP ${finalEgp}) to ${wName} & updated Payroll Sheet ✓`,
            )
          : t(
              `تم تسجيل وإرسال ${tierSpec.labelAr} (بند #${selectedRule.code}) للموظف ${wName} ✓`,
              `Recorded & sent ${tierSpec.labelEn} (Rule #${selectedRule.code}) to ${wName} ✓`,
            ),
      );
      setApplyOpen(false);
    } catch (err) {
      toast.error(t("فشل توقيع الجزاء", "Failed to apply disciplinary penalty"), {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSubmitting(false);
    }
  };

  // List of disciplinary deductions recorded in adjustments
  const disciplinaryAdjustments = useMemo(
    () =>
      adjustments.filter(
        (a) => a.type === "deduction" && a.status !== "cancelled" && (a.reason || "").includes("[بند #"),
      ),
    [adjustments],
  );

  const handleRevokeDisciplinaryAdjustment = async (adj: PayrollAdjustment) => {
    if (!adj.id) return;
    const ok = await confirmDialog({
      title: t("إلغاء الجزاء ورفع الخصم من شيت الرواتب؟", "Revoke Disciplinary Penalty?"),
      message: t(
        `هل تريد إلغاء هذا الجزاء (${adj.reason}) واسترداد مبلغ ${adj.amount} ج.م في شيت راتب ${adj.workerName || "الموظف"}؟`,
        `Remove this penalty (${adj.reason}) and refund EGP ${adj.amount} to ${adj.workerName || "worker"}'s payroll?`,
      ),
      confirmLabel: t("✕ نعم، شيل الجزاء من البايرول", "✕ Revoke & Refund"),
      tone: "danger",
    });
    if (!ok) return;
    try {
      await deletePayrollAdjustment(adj.id);
      toast.success(t("تم إلغاء الجزاء ورفع الخصم من شيت الرواتب بنجاح ✓", "Penalty revoked and removed from payroll ✓"));
    } catch (err) {
      toast.error(t("تعذر إلغاء الجزاء", "Failed to revoke penalty"), {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const categoriesToRender: ViolationCategory[] =
    categoryFilter === "all" ? ["attendance", "operations", "conduct"] : [categoryFilter];

  return (
    <div dir={dir} className="space-y-5 font-mono">
      {/* ── Top Control & Explanation Banner ── */}
      <div className="p-5 bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-700 shadow-[4px_4px_0px_0px_#09090b] rounded-lg space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border-b-2 border-zinc-200 dark:border-zinc-800 pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 bg-red-600 text-white text-[10px] font-black uppercase rounded">
                {t("⚖️ لائحة الجزاءات التأديبية الرسمية", "⚖️ OFFICIAL DISCIPLINARY SCHEDULE")}
              </span>
              <span className="text-xs font-bold text-zinc-500">
                {t(`إجمالي البنود: ${DISCIPLINARY_RULES.length} مادة لائحية`, `${DISCIPLINARY_RULES.length} Articles`)}
              </span>
            </div>
            <h3 className="text-lg sm:text-xl font-black text-zinc-950 dark:text-white">
              {t(
                "جدول المخالفات والجزاءات المتدرجة (أول مرة ← رابع مرة)",
                "Progressive Disciplinary Violations & Penalties Schedule (1st → 4th Offense)",
              )}
            </h3>
            <p className="text-xs text-zinc-600 dark:text-zinc-400 max-w-3xl leading-relaxed">
              {t(
                "يقصد بعبارة (اليوم) في جدول الجزاءات الخصم من أجر الموظف اليومي بالمقدار المبين (ربع يوم = 0.25، نصف يوم = 0.5، يوم = 1، يومان = 2...). يمكنك الضغط على «⚖️ توقيع الجزاء» أمام أي مخالفة لحساب الخصم تلقائياً وإضافته لشيت الرواتب وإبلاغ الموظف.",
                "'Day' refers to deducting the specified fraction/multiple of the employee's daily wage directly in the Payroll Sheet and notifying the employee.",
              )}
            </p>
          </div>

          <button
            type="button"
            onClick={() => openApplyModalForRule(DISCIPLINARY_RULES[0]!)}
            className="px-4 py-3 bg-red-600 hover:bg-red-700 text-white text-xs font-black uppercase border-2 border-zinc-900 rounded-lg shadow-[3px_3px_0px_0px_#09090b] cursor-pointer shrink-0 flex items-center justify-center gap-2 transition-transform active:scale-95"
          >
            <span>⚖️</span>
            <span>{t("+ توقيع جزاء لائحي على موظف", "+ Apply Disciplinary Penalty")}</span>
          </button>
        </div>

        {/* Search & Category Filter Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setCategoryFilter("all")}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border cursor-pointer transition-all ${
                categoryFilter === "all"
                  ? "bg-zinc-950 text-white dark:bg-white dark:text-zinc-950 border-zinc-950"
                  : "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-zinc-300 dark:border-zinc-700 hover:bg-zinc-200"
              }`}
            >
              {t(`الكل (${DISCIPLINARY_RULES.length})`, `All (${DISCIPLINARY_RULES.length})`)}
            </button>
            {(["attendance", "operations", "conduct"] as const).map((catKey) => {
              const cat = VIOLATION_CATEGORIES[catKey];
              const count = DISCIPLINARY_RULES.filter((r) => r.category === catKey).length;
              const active = categoryFilter === catKey;
              return (
                <button
                  key={catKey}
                  type="button"
                  onClick={() => setCategoryFilter(catKey)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold border cursor-pointer transition-all flex items-center gap-1.5 ${
                    active
                      ? "bg-red-600 text-white border-red-700 shadow-sm"
                      : "bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100"
                  }`}
                >
                  <span>{cat.icon}</span>
                  <span>
                    {isAr ? cat.titleAr.replace(/^.*—\s*/, "") : cat.titleEn} ({count})
                  </span>
                </button>
              );
            })}
          </div>

          <div className="relative w-full md:w-80">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("🔍 ابحث برقم البند أو نوع المخالفة...", "🔍 Search by rule # or violation text...")}
              className="w-full bg-zinc-50 dark:bg-zinc-800 border-2 border-zinc-900 dark:border-zinc-700 px-3 py-2 text-xs font-bold text-zinc-950 dark:text-zinc-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </div>
        </div>
      </div>

      {/* ── Active Applied Disciplinary Penalties Log (If Any) ── */}
      {disciplinaryAdjustments.length > 0 && (
        <div className="p-4 bg-red-50/70 dark:bg-red-950/25 border-2 border-red-600 rounded-lg space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs sm:text-sm font-black text-red-950 dark:text-red-200 flex items-center gap-2">
              <span>📋</span>
              <span>
                {t(
                  `الجزاءات الموقعة والمضافة لشيت الرواتب في هذه الدورة (${disciplinaryAdjustments.length})`,
                  `Applied Disciplinary Deductions in Current Cycle (${disciplinaryAdjustments.length})`,
                )}
              </span>
            </h4>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {disciplinaryAdjustments.map((adj) => (
              <div
                key={adj.id}
                className="p-3 bg-white dark:bg-zinc-900 border border-red-300 dark:border-red-800 rounded-lg flex items-start justify-between gap-3 text-xs shadow-xs"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-black text-zinc-950 dark:text-white">{adj.workerName || "موظف"}</span>
                    <span className="px-2 py-0.5 rounded bg-red-600 text-white text-[10px] font-black">
                      -EGP {adj.amount}
                    </span>
                    <span className="text-[10px] text-zinc-400">{adj.date}</span>
                  </div>
                  <p className="text-[11px] text-zinc-700 dark:text-zinc-300 leading-relaxed">{adj.reason}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleRevokeDisciplinaryAdjustment(adj)}
                  className="px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-[10px] font-bold cursor-pointer shrink-0"
                >
                  {t("✕ شيل الجزاء", "✕ Revoke")}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Categorized Disciplinary Schedule Tables ── */}
      {categoriesToRender.map((catKey) => {
        const catInfo = VIOLATION_CATEGORIES[catKey];
        const rules = filteredRules.filter((r) => r.category === catKey);
        if (rules.length === 0) return null;

        return (
          <div
            key={catKey}
            className="bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-700 shadow-[3px_3px_0px_0px_#09090b] rounded-lg overflow-hidden"
          >
            {/* Category Header */}
            <div className="p-4 bg-zinc-950 text-white dark:bg-zinc-800 flex flex-wrap items-center justify-between gap-2 border-b-2 border-zinc-900">
              <div className="flex items-center gap-2.5">
                <span className="text-xl">{catInfo.icon}</span>
                <div>
                  <h4 className="font-black text-sm sm:text-base">{isAr ? catInfo.titleAr : catInfo.titleEn}</h4>
                  <p className="text-[11px] text-zinc-300 mt-0.5">{catInfo.subtitleAr}</p>
                </div>
              </div>
              <span className="px-2.5 py-1 rounded bg-white/10 text-white text-xs font-bold">
                {t(`${rules.length} بند`, `${rules.length} items`)}
              </span>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-start divide-y divide-zinc-200 dark:divide-zinc-800 text-xs">
                <thead className="bg-zinc-100 dark:bg-zinc-800/90 text-[11px] font-black text-zinc-700 dark:text-zinc-300">
                  <tr>
                    <th className="py-3 px-3 text-center w-16">{t("م", "#")}</th>
                    <th className="py-3 px-4 text-start min-w-[260px]">{t("نوع المخالفة", "Violation Description")}</th>
                    <th className="py-3 px-3 text-center min-w-[110px] bg-amber-50/60 dark:bg-amber-950/20">
                      {t("أول مرة", "1st Time")}
                    </th>
                    <th className="py-3 px-3 text-center min-w-[110px] bg-orange-50/60 dark:bg-orange-950/20">
                      {t("ثاني مرة", "2nd Time")}
                    </th>
                    <th className="py-3 px-3 text-center min-w-[110px] bg-red-50/60 dark:bg-red-950/20">
                      {t("ثالث مرة", "3rd Time")}
                    </th>
                    <th className="py-3 px-3 text-center min-w-[110px] bg-rose-50/60 dark:bg-rose-950/20">
                      {t("رابع مرة", "4th Time")}
                    </th>
                    <th className="py-3 px-3 text-start min-w-[180px]">{t("ملاحظات", "Notes")}</th>
                    <th className="py-3 px-3 text-center w-36">{t("تطبيق الجزاء", "Action")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {rules.map((rule) => (
                    <tr
                      key={rule.code}
                      className="hover:bg-zinc-50/90 dark:hover:bg-zinc-800/50 transition-colors"
                    >
                      <td className="py-3.5 px-3 text-center">
                        <span className="inline-flex items-center justify-center h-7 w-9 rounded bg-zinc-900 text-white dark:bg-zinc-700 text-xs font-black">
                          #{rule.code}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-zinc-950 dark:text-white leading-relaxed">
                          {isAr ? rule.titleAr : rule.titleEn}
                        </div>
                        {!isAr && (
                          <div className="text-[11px] text-zinc-500 mt-0.5">{rule.titleAr}</div>
                        )}
                      </td>
                      {([1, 2, 3, 4] as const).map((tierNum) => {
                        const spec = rule.tiers[tierNum];
                        return (
                          <td key={tierNum} className="py-3.5 px-2.5 text-center">
                            <span
                              className={`inline-block px-2.5 py-1 rounded-md border text-[11px] font-extrabold leading-snug ${tierBadgeClass(
                                spec,
                              )}`}
                            >
                              {isAr ? spec.labelAr : spec.labelEn}
                            </span>
                          </td>
                        );
                      })}
                      <td className="py-3.5 px-3 text-[11px] text-zinc-600 dark:text-zinc-400 leading-relaxed">
                        {rule.notesAr ? (
                          <span className="inline-block px-2 py-1 rounded bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 font-semibold text-zinc-800 dark:text-zinc-200">
                            {isAr ? rule.notesAr : rule.notesEn || rule.notesAr}
                          </span>
                        ) : (
                          <span className="text-zinc-400">—</span>
                        )}
                      </td>
                      <td className="py-3.5 px-3 text-center">
                        <button
                          type="button"
                          onClick={() => openApplyModalForRule(rule)}
                          className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-md text-[11px] font-extrabold cursor-pointer shadow-[2px_2px_0px_0px_#09090b] transition-transform active:scale-95 whitespace-nowrap"
                        >
                          {t("⚖️ توقيع الجزاء", "⚖️ Apply")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {/* ══════════════════════════════════════════════════════════════════
          MODAL: APPLY DISCIPLINARY PENALTY TO WORKER
      ══════════════════════════════════════════════════════════════════ */}
      {applyOpen && (
        <ModalPortal onClose={() => setApplyOpen(false)}>
          <div
            className="fixed inset-0 z-[130] bg-zinc-950/65 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto animate-fade-in"
            onClick={() => setApplyOpen(false)}
          >
            <div
              dir={dir}
              className="bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-700 shadow-2xl w-full max-w-xl max-h-[92vh] overflow-y-auto p-6 animate-scale-in text-zinc-950 dark:text-zinc-100 font-mono rounded-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between pb-3 border-b-2 border-zinc-900 dark:border-zinc-700 mb-4">
                <div>
                  <span className="px-2 py-0.5 bg-red-600 text-white text-[10px] font-black uppercase rounded">
                    {t("تطبيق لائحة الجزاءات على شيت الرواتب", "DISCIPLINARY PENALTY ENFORCEMENT")}
                  </span>
                  <h3 className="text-lg sm:text-xl font-black text-zinc-950 dark:text-white mt-1">
                    {t("⚖️ توقيع جزاء إداري من اللائحة على موظف", "⚖️ Apply Official Disciplinary Penalty")}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setApplyOpen(false)}
                  className="text-2xl font-bold text-zinc-400 hover:text-red-600 cursor-pointer"
                >
                  &times;
                </button>
              </div>

              <form onSubmit={handleApplyPenalty} className="space-y-4 text-xs">
                {/* 1. Select Worker */}
                <div>
                  <label className="block font-bold text-zinc-700 dark:text-zinc-300 mb-1">
                    {t("١. اختر الموظف *", "1. Select Employee *")}
                  </label>
                  <select
                    value={selectedWorkerId}
                    onChange={(e) => handleWorkerChange(e.target.value)}
                    className="w-full bg-white dark:bg-zinc-800 border-2 border-zinc-900 dark:border-zinc-700 px-3 py-2 text-zinc-950 dark:text-zinc-100 font-bold rounded-lg"
                  >
                    {workers.map((w) => {
                      const wWage = computeWorkerDailyWageEgp(w, defaultHourlyRate, standardHours);
                      return (
                        <option key={w.id} value={w.id}>
                          {w.firstName} {w.lastName} ({w.department || "General"}) — أجر اليوم: {wWage} ج.م
                        </option>
                      );
                    })}
                  </select>
                </div>

                {/* 2. Select Violation Rule */}
                <div>
                  <label className="block font-bold text-zinc-700 dark:text-zinc-300 mb-1">
                    {t("٢. البند ونوع المخالفة من اللائحة *", "2. Violation Article *")}
                  </label>
                  <select
                    value={selectedRuleCode}
                    onChange={(e) => handleRuleChange(Number(e.target.value))}
                    className="w-full bg-white dark:bg-zinc-800 border-2 border-zinc-900 dark:border-zinc-700 px-3 py-2 text-zinc-950 dark:text-zinc-100 font-bold rounded-lg"
                  >
                    {DISCIPLINARY_RULES.map((r) => (
                      <option key={r.code} value={r.code}>
                        بند #{r.code}: {r.titleAr.slice(0, 85)}
                      </option>
                    ))}
                  </select>
                  <div className="mt-2 p-2.5 rounded-lg bg-zinc-50 dark:bg-zinc-800/70 border border-zinc-300 dark:border-zinc-700 text-[11px] leading-relaxed">
                    <div className="font-bold text-zinc-900 dark:text-white">
                      بند #{selectedRule.code}: {selectedRule.titleAr}
                    </div>
                    {selectedRule.notesAr && (
                      <div className="text-amber-800 dark:text-amber-300 font-semibold mt-1">
                        📌 ملاحظة اللائحة: {selectedRule.notesAr}
                      </div>
                    )}
                  </div>
                </div>

                {/* 3. Select Offense Tier (1st, 2nd, 3rd, 4th) */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="font-bold text-zinc-700 dark:text-zinc-300">
                      {t("٣. درجة تكرار المخالفة *", "3. Offense Repetition Tier *")}
                    </label>
                    <span className="px-2 py-0.5 rounded bg-sky-100 dark:bg-sky-950 text-sky-900 dark:text-sky-200 text-[10px] font-bold">
                      {priorOffenseCount === 0
                        ? t("لم تُسجل عليه هذه المخالفة سابقاً (مقترح: أول مرة)", "0 prior offenses (Suggested: 1st Time)")
                        : t(
                            `سُجلت عليه ${priorOffenseCount} مرة سابقاً`,
                            `${priorOffenseCount} prior offense(s) recorded`,
                          )}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {([1, 2, 3, 4] as const).map((tierNum) => {
                      const spec = selectedRule.tiers[tierNum];
                      const active = selectedTier === tierNum;
                      const egpVal = computeDisciplinaryDeductionEgp(selectedRule, tierNum, dailyWageEgp);
                      return (
                        <button
                          key={tierNum}
                          type="button"
                          onClick={() => {
                            setSelectedTier(tierNum);
                            setCustomAmount("");
                          }}
                          className={`p-2.5 rounded-lg border-2 text-center cursor-pointer transition-all ${
                            active
                              ? "border-red-600 bg-red-50 dark:bg-red-950/40 ring-2 ring-red-600/20 font-black"
                              : "border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 hover:bg-zinc-50"
                          }`}
                        >
                          <div className="text-[10px] text-zinc-500 font-bold">
                            {isAr ? TIER_NAMES[tierNum].ar : TIER_NAMES[tierNum].en}
                          </div>
                          <div className="text-xs font-extrabold text-zinc-950 dark:text-white mt-0.5">
                            {isAr ? spec.labelAr : spec.labelEn}
                          </div>
                          <div className="text-[10px] font-bold text-red-600 dark:text-red-400 mt-0.5">
                            {egpVal > 0 ? `-${egpVal} ج.م` : "0 ج.م (إنذار)"}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 4. Calculated Financial Impact & Date */}
                <div className="p-3.5 rounded-xl bg-red-50/70 dark:bg-red-950/25 border-2 border-red-300 dark:border-red-800 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div>
                      <span className="text-zinc-600 dark:text-zinc-400">
                        {t("أجر اليوم الفعلي للموظف:", "Worker Daily Wage:")}
                      </span>{" "}
                      <strong className="text-zinc-950 dark:text-white">{dailyWageEgp} ج.م / يوم</strong>
                    </div>
                    <div>
                      <span className="text-zinc-600 dark:text-zinc-400">
                        {t("الجزاء المقرر:", "Scheduled Penalty:")}
                      </span>{" "}
                      <strong className="text-red-700 dark:text-red-300">
                        {selectedRule.tiers[selectedTier].labelAr} ({selectedRule.tiers[selectedTier].deductionDays} يوم)
                      </strong>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    <div>
                      <label className="block text-[11px] font-bold text-zinc-700 dark:text-zinc-300 mb-1">
                        {t("مبلغ الخصم في شيت الرواتب (ج.م)", "Payroll Deduction Amount (EGP)")}
                      </label>
                      <input
                        type="number"
                        min={0}
                        step="0.5"
                        value={customAmount === "" ? autoDeductionEgp : customAmount}
                        onChange={(e) =>
                          setCustomAmount(e.target.value === "" ? "" : Math.max(0, Number(e.target.value)))
                        }
                        className="w-full bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-700 px-3 py-2 text-sm font-black text-red-600 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-zinc-700 dark:text-zinc-300 mb-1">
                        {t("تاريخ المخالفة *", "Violation Date *")}
                      </label>
                      <input
                        type="date"
                        required
                        value={customDate}
                        onChange={(e) => setCustomDate(e.target.value)}
                        className="w-full bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-700 px-3 py-2 text-xs font-bold rounded-lg"
                      />
                    </div>
                  </div>
                </div>

                {/* 5. Extra HR Note & Alert Checkbox */}
                <div>
                  <label className="block font-bold text-zinc-700 dark:text-zinc-300 mb-1">
                    {t("ملاحظات إضافية من الـ HR (اختياري)", "Additional HR Notes (Optional)")}
                  </label>
                  <input
                    type="text"
                    value={adminNote}
                    onChange={(e) => setAdminNote(e.target.value)}
                    placeholder={t("مثال: تأخير بدون إذن يوم الثلاثاء...", "e.g. Incident details...")}
                    className="w-full bg-white dark:bg-zinc-800 border-2 border-zinc-900 dark:border-zinc-700 px-3 py-2 text-xs font-bold rounded-lg"
                  />
                </div>

                <label className="flex items-center gap-2.5 p-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sendWorkerAlert}
                    onChange={(e) => setSendWorkerAlert(e.target.checked)}
                    className="h-4 w-4 accent-red-600 cursor-pointer"
                  />
                  <span className="text-xs font-bold text-zinc-900 dark:text-white">
                    {t(
                      "🔔 إرسال إشعار رسمي بالمخالفة والجزاء إلى حساب الموظف فوراً",
                      "🔔 Send official disciplinary notice to the employee's Alerts tab immediately",
                    )}
                  </span>
                </label>

                <div className="flex items-center justify-end gap-2 pt-3 border-t-2 border-zinc-900 dark:border-zinc-700">
                  <button
                    type="button"
                    onClick={() => setApplyOpen(false)}
                    className="px-4 py-2 border-2 border-zinc-900 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-bold rounded-lg cursor-pointer"
                  >
                    {t("إلغاء", "Cancel")}
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-black uppercase border-2 border-zinc-900 rounded-lg shadow-[2px_2px_0px_0px_#09090b] cursor-pointer disabled:opacity-50"
                  >
                    {submitting
                      ? t("جاري الحفظ...", "Applying...")
                      : t("✓ اعتماد الجزاء وتحديث شيت الرواتب", "✓ Apply Penalty & Update Payroll")}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
}
