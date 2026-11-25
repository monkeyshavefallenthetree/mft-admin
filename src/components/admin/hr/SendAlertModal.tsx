"use client";

import { useState } from "react";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { DEPARTMENTS } from "@/lib/admin/constants";
import { toast } from "@/lib/admin/feedback";
import { logActivity } from "@/lib/admin/activity";
import { sendExpoPushToWorkers } from "@/lib/chatNotifications";
import { notifyAdmins } from "@/lib/adminNotifications";
import { useHrLang } from "@/lib/admin/hrI18n";
import ModalPortal from "@/components/admin/ui/ModalPortal";
import type { Worker } from "@/lib/admin/hrPageTypes";
import { workerName } from "@/components/admin/hr/hrPageUtils";

interface Props {
  approved: Worker[];
  adminEmail: string;
  onClose: () => void;
}

export default function SendAlertModal({ approved, adminEmail, onClose }: Props) {
  const { dir, t } = useHrLang();
  // Alert Form
  const [alertForm, setAlertForm] = useState({
    type: "system_announcement",
    title: "",
    message: "",
    recipient: "all",
    department: "",
    workerId: "",
    workerIds: [] as string[],
    workerSearch: "",
    priority: "high",
  });

  const handleSendAlert = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!alertForm.type || !alertForm.title || !alertForm.message) {
      toast.warning(t("يرجى ملء جميع الحقول المطلوبة", "Please fill in required fields"));
      return;
    }

    let recipients: string[] = [];
    if (alertForm.recipient === "all") recipients = approved.map((w) => w.id);
    else if (alertForm.recipient === "department")
      recipients = approved.filter((w) => w.department === alertForm.department).map((w) => w.id);
    else if (alertForm.recipient === "individual")
      recipients =
        alertForm.workerIds.length > 0
          ? alertForm.workerIds
          : alertForm.workerId
            ? [alertForm.workerId]
            : [];

    if (recipients.length === 0) {
      toast.warning(t("يرجى اختيار موظف واحد على الأقل لإرسال التنبيه", "Please select at least one recipient"));
      return;
    }

    try {
      await addDoc(collection(db, "alerts"), {
        type: alertForm.type,
        title: alertForm.title,
        message: alertForm.message,
        recipient: alertForm.recipient,
        department: alertForm.department || "",
        workerId: recipients.length === 1 ? recipients[0] : "",
        priority: alertForm.priority,
        recipients,
        sentBy: adminEmail,
        sentAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        recipientCount: recipients.length,
        isRead: false,
        readBy: [],
      });

      if (recipients.length > 0) {
        void sendExpoPushToWorkers(db, {
          recipientUids: recipients,
          title: `HR Alert: ${alertForm.title}`,
          body: alertForm.message,
          tab: "alerts",
          urgent: alertForm.priority === "high" || alertForm.type === "urgent" || alertForm.type === "penalty",
        });
      }

      void notifyAdmins(db, {
        targetRoles: ["super_admin", "hr_admin"],
        category: "hr",
        eventType: "hr_alert_sent",
        title: `📢 HR Alert Sent: ${alertForm.title}`,
        body: `${adminEmail} sent "${alertForm.title}" to ${recipients.length} worker(s): ${alertForm.message}`,
        href: "/admin/hr?tab=announcements",
        actorUid: auth.currentUser?.uid,
        actorName: adminEmail,
        urgent: alertForm.priority === "high" || alertForm.type === "urgent" || alertForm.type === "penalty",
      });

      void logActivity({
        action: "created",
        entity: "hr",
        label: `Sent alert: ${alertForm.title} to ${recipients.length} workers`,
      });

      toast.success(
        t(
          `تم إرسال التنبيه بنجاح إلى ${recipients.length} موظف`,
          `Alert sent to ${recipients.length} worker(s)`,
        ),
      );
      onClose();
      setAlertForm({
        type: "system_announcement",
        title: "",
        message: "",
        recipient: "all",
        department: "",
        workerId: "",
        workerIds: [],
        workerSearch: "",
        priority: "high",
      });
    } catch (err) {
      toast.error(t("فشل إرسال التنبيه", "Failed to send alert"), {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <ModalPortal onClose={() => onClose()}>
      <div
        className="fixed inset-0 z-[120] bg-zinc-950/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto animate-fade-in"
        onClick={() => onClose()}
      >
        <div
          dir={dir}
          role="dialog"
          aria-modal="true"
          aria-labelledby="send-alert-modal-title"
          className="ui-card shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 animate-scale-in text-zinc-950 dark:text-zinc-100"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex justify-between items-center mb-4 pb-3 border-b border-zinc-200 dark:border-zinc-800">
            <h3 id="send-alert-modal-title" className="text-lg font-bold tracking-tight text-red-600">
              {t("إرسال تنبيه أو تعميم للموظفين", "Send Workforce Alert")}
            </h3>
            <button
              type="button"
              aria-label="Close"
              className="h-8 w-8 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
              onClick={() => onClose()}
            >
              &times;
            </button>
          </div>
          <form onSubmit={handleSendAlert} className="space-y-4 text-xs">
            <div>
              <label className="block text-zinc-700 dark:text-zinc-300 font-semibold uppercase mb-1.5">
                {t("نوع التنبيه *", "Alert Type *")}
              </label>
              <select
                required
                value={alertForm.type}
                onChange={(e) => setAlertForm({ ...alertForm, type: e.target.value })}
                className="w-full brutal-input px-3 py-2 font-semibold cursor-pointer"
              >
                <option value="">{t("اختر النوع…", "Select type…")}</option>
                <option value="system_announcement">{t("إعلان هام (System Announcement)", "System Announcement (إعلان هام)")}</option>
                <option value="policy_update">{t("تحديث لائحة العمل (Policy Update)", "Policy Update (تحديث سياسة العمل)")}</option>
                <option value="shift_reminder">{t("تذكير بمواعيد الوردية (Shift Reminder)", "Shift Reminder (تذكير بالوردية)")}</option>
                <option value="urgent_directive">{t("توجيه عاجل (Urgent Directive)", "Urgent Directive (توجيه عاجل)")}</option>
              </select>
            </div>

            <div>
              <label className="block text-zinc-700 dark:text-zinc-300 font-semibold uppercase mb-1.5">
                {t("المستلمون *", "Recipients *")}
              </label>
              <select
                value={alertForm.recipient}
                onChange={(e) => setAlertForm({ ...alertForm, recipient: e.target.value })}
                className="w-full brutal-input px-3 py-2 font-semibold cursor-pointer"
              >
                <option value="all">
                  {t(
                    `🌐 جميع الموظفين (${approved.length} موظف) — تظهر في أعلى شاشة الكل`,
                    `🌐 Broadcast to ALL workers (${approved.length})`,
                  )}
                </option>
                <option value="department">{t("🏢 قسم محدد", "🏢 Specific department")}</option>
                <option value="individual">
                  {t("👥 اختيار موظفين محددين (موظف أو أكثر)", "👥 Select specific worker(s) (1 or more)")}
                </option>
              </select>
            </div>

            <div>
              <label className="block text-zinc-700 dark:text-zinc-300 font-semibold uppercase mb-1.5">
                {t("درجة الأهمية *", "Priority *")}
              </label>
              <select
                value={alertForm.priority}
                onChange={(e) => setAlertForm({ ...alertForm, priority: e.target.value })}
                className="w-full brutal-input px-3 py-2 font-semibold cursor-pointer"
              >
                <option value="high">{t("⚡ هام وعاجل (يظهر كبانر بارز للجميع)", "⚡ High Priority Banner")}</option>
                <option value="medium">{t("📢 تنبيه اعتيادي", "📢 Standard Notice")}</option>
              </select>
            </div>

            {alertForm.recipient === "department" && (
              <div>
                <label className="block text-zinc-700 dark:text-zinc-300 font-semibold uppercase mb-1.5">
                  {t("القسم *", "Department *")}
                </label>
                <select
                  value={alertForm.department}
                  onChange={(e) => setAlertForm({ ...alertForm, department: e.target.value })}
                  className="w-full brutal-input px-3 py-2 font-semibold cursor-pointer"
                >
                  <option value="">{t("اختر القسم…", "Select department…")}</option>
                  {DEPARTMENTS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {alertForm.recipient === "individual" && (
              <div className="space-y-2 border border-zinc-200/80 dark:border-zinc-800 rounded-xl p-3.5 bg-zinc-50/70 dark:bg-zinc-800/50">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="block text-zinc-800 dark:text-zinc-200 font-semibold uppercase">
                    {t("اختر الموظفين المستلمين *", "Select Recipient Workers *")}
                    <span className="ms-2 inline-flex items-center px-2 py-0.5 rounded-full bg-red-600 text-white text-[10px] font-bold">
                      {t(`تم اختيار ${alertForm.workerIds.length} موظف`, `${alertForm.workerIds.length} selected`)}
                    </span>
                  </label>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        setAlertForm((prev) => ({
                          ...prev,
                          workerIds: approved.map((w) => w.id),
                        }))
                      }
                      className="px-2.5 py-1 text-[10px] font-semibold bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 rounded-lg cursor-pointer hover:opacity-90"
                    >
                      {t("✓ تحديد الكل", "✓ Select All")}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setAlertForm((prev) => ({
                          ...prev,
                          workerIds: [],
                          workerId: "",
                        }))
                      }
                      className="px-2.5 py-1 text-[10px] font-semibold border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 rounded-lg cursor-pointer hover:bg-zinc-100"
                    >
                      {t("✕ إلغاء الكل", "✕ Clear")}
                    </button>
                  </div>
                </div>

                <input
                  type="text"
                  value={alertForm.workerSearch}
                  onChange={(e) => setAlertForm({ ...alertForm, workerSearch: e.target.value })}
                  placeholder={t("🔍 ابحث باسم الموظف أو القسم...", "🔍 Search worker by name or department...")}
                  className="w-full brutal-input px-2.5 py-1.5 text-xs"
                />

                <div className="max-h-44 overflow-y-auto divide-y divide-zinc-200/70 dark:divide-zinc-800 border border-zinc-200/80 dark:border-zinc-800 rounded-xl bg-white dark:bg-zinc-900">
                  {approved
                    .filter((w) => {
                      const q = alertForm.workerSearch.trim().toLowerCase();
                      if (!q) return true;
                      return (
                        workerName(w).toLowerCase().includes(q) ||
                        (w.department || "").toLowerCase().includes(q) ||
                        (w.email || "").toLowerCase().includes(q)
                      );
                    })
                    .map((w) => {
                      const checked = alertForm.workerIds.includes(w.id);
                      return (
                        <label
                          key={w.id}
                          className={`flex items-center justify-between gap-2 px-3 py-2 cursor-pointer transition-colors ${
                            checked
                              ? "bg-red-50/80 dark:bg-red-950/30 font-semibold text-red-900 dark:text-red-200"
                              : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                setAlertForm((prev) => {
                                  const exists = prev.workerIds.includes(w.id);
                                  const nextIds = exists
                                    ? prev.workerIds.filter((id) => id !== w.id)
                                    : [...prev.workerIds, w.id];
                                  return {
                                    ...prev,
                                    workerIds: nextIds,
                                    workerId: nextIds[0] || "",
                                  };
                                });
                              }}
                              className="h-4 w-4 accent-red-600 rounded cursor-pointer"
                            />
                            <span className="truncate">{workerName(w)}</span>
                          </div>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 shrink-0">
                            {w.department || "General"}
                          </span>
                        </label>
                      );
                    })}
                </div>
              </div>
            )}

            <div>
              <label className="block text-zinc-700 dark:text-zinc-300 font-semibold uppercase mb-1.5">
                {t("عنوان التنبيه *", "Title *")}
              </label>
              <input
                type="text"
                required
                value={alertForm.title}
                onChange={(e) => setAlertForm({ ...alertForm, title: e.target.value })}
                className="w-full brutal-input px-3 py-2 font-semibold"
                placeholder={t("عنوان مختصر للتنبيه", "Brief subject")}
              />
            </div>

            <div>
              <label className="block text-zinc-700 dark:text-zinc-300 font-semibold uppercase mb-1.5">
                {t("نص الرسالة *", "Message *")}
              </label>
              <textarea
                rows={4}
                required
                value={alertForm.message}
                onChange={(e) => setAlertForm({ ...alertForm, message: e.target.value })}
                className="w-full brutal-input px-3 py-2 resize-none"
                placeholder={t("اكتب تفاصيل التعميم أو التنبيه...", "Full notice text...")}
              />
            </div>

            <div className="flex gap-2 justify-end pt-3 border-t border-zinc-200 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => onClose()}
                className="brutal-btn-outline px-4 py-2 text-xs cursor-pointer"
              >
                {t("إلغاء", "Cancel")}
              </button>
              <button
                type="submit"
                className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white font-semibold text-xs rounded-lg shadow-xs cursor-pointer transition-colors"
              >
                {t("إرسال التنبيه", "Send Alert")}
              </button>
            </div>
          </form>
        </div>
      </div>
    </ModalPortal>
  );
}
