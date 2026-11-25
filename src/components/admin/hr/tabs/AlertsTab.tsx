"use client";

import { deleteDoc, doc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { toast, confirmDialog } from "@/lib/admin/feedback";
import { useHrLang } from "@/lib/admin/hrI18n";
import type { Worker, AlertDoc } from "@/lib/admin/hrPageTypes";
import { formatTs } from "@/components/admin/hr/hrPageUtils";

interface Props {
  alerts: AlertDoc[];
  approved: Worker[];
  setSendOpen: (open: boolean) => void;
}

export default function AlertsTab({ alerts, approved, setSendOpen }: Props) {
  const { t } = useHrLang();

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="ui-card p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-bold text-sm text-zinc-950">
            {t(`التنبيهات والتعاميم الإدارية (${alerts.length})`, `Broadcast Alerts & Disciplinary Notices (${alerts.length})`)}
          </h3>
          <p className="text-xs text-zinc-500 mt-0.5">
            {t("سجل الإشعارات والتعاميم المرسلة للموظفين مع متابعة حالة القراءة", "Official notices dispatched to workers with real-time read receipts")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setSendOpen(true)}
          className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-semibold text-xs rounded-xl shadow-2xs cursor-pointer transition-colors"
        >
          {t("+ إرسال تنبيه جديد", "+ Send New Alert")}
        </button>
      </div>

      <div className="ui-card divide-y divide-zinc-100 text-xs overflow-hidden">
        {alerts.length === 0 ? (
          <div className="py-12 text-center text-zinc-400">
            {t("لا توجد تنبيهات مرسلة بعد.", "No broadcast alerts sent yet.")}
          </div>
        ) : (
          alerts.map((a) => {
            const totalRecipients = a.recipientCount ?? a.recipients?.length ?? approved.length;
            const readCount = Array.isArray(a.readBy) ? a.readBy.length : 0;
            return (
              <div
                key={a.id}
                className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-zinc-50/70 transition-colors"
              >
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-sm font-bold text-zinc-950">{a.title}</strong>
                    <span className="px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200 text-[10px] font-semibold">
                      {a.recipient === "all"
                        ? t("🌐 تعميم للكل", "🌐 Broadcast All")
                        : a.recipient === "department"
                          ? t(`🏢 قسم ${a.department}`, `🏢 Dept: ${a.department}`)
                          : totalRecipients > 1
                            ? t(`👥 ${totalRecipients} موظفين محددين`, `👥 ${totalRecipients} Selected Workers`)
                            : t("👤 تنبيه فردي", "👤 Individual")}
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-zinc-100 border border-zinc-200 text-[10px] font-semibold uppercase text-zinc-600">
                      {a.type || "Notice"}
                    </span>
                    <span className="font-code text-[11px] text-zinc-400">{formatTs(a.sentAt || a.createdAt)}</span>
                  </div>
                  <p className="text-zinc-600 max-w-2xl whitespace-pre-line leading-relaxed">{a.message}</p>
                  <p className="text-[11px] text-zinc-400 flex flex-wrap items-center gap-2 pt-0.5">
                    <span>
                      {t("المستلمون:", "Recipients:")} <strong className="font-code text-zinc-600">{totalRecipients}</strong>
                    </span>
                    <span>·</span>
                    <span className="text-emerald-700 font-semibold">
                      👁️ {t("قرأ الرسالة:", "Read by:")} <span className="font-code">{readCount} / {totalRecipients}</span>
                    </span>
                    <span>·</span>
                    <span>
                      {t("بواسطة:", "Sent by:")} {a.sentBy || "Admin"}
                    </span>
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = await confirmDialog({
                        title: t("حذف التنبيه؟", "Delete alert?"),
                        message: t(`حذف "${a.title}" من السجل؟`, `Remove "${a.title}" from log?`),
                      });
                      if (!ok) return;
                      await deleteDoc(doc(db, "alerts", a.id));
                      toast.success(t("تم حذف التنبيه", "Alert deleted"));
                    }}
                    className="px-3 py-1.5 rounded-lg text-zinc-400 hover:text-red-600 hover:bg-red-50 cursor-pointer font-semibold transition-colors"
                  >
                    {t("حذف", "Delete")}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
