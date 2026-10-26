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
    <div className="space-y-5 animate-fade-in font-mono">
      <div className="p-4 bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-700 shadow-[3px_3px_0px_0px_#09090b] rounded-lg flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-bold text-base text-zinc-950 dark:text-white uppercase">
          {t(`التنبيهات والتعاميم الإدارية (${alerts.length})`, `Broadcast Alerts & Disciplinary Notices (${alerts.length})`)}
        </h3>
        <button
          type="button"
          onClick={() => setSendOpen(true)}
          className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold text-xs uppercase border-2 border-zinc-900 shadow-[2px_2px_0px_0px_#09090b] cursor-pointer rounded"
        >
          {t("+ إرسال تنبيه جديد", "+ Send New Alert")}
        </button>
      </div>

      <div className="bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-700 shadow-[3px_3px_0px_0px_#09090b] rounded-lg divide-y divide-zinc-200 dark:divide-zinc-800 text-xs">
        {alerts.map((a) => (
          <div
            key={a.id}
            className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
          >
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <strong className="text-sm text-zinc-950 dark:text-white">{a.title}</strong>
                <span className="px-1.5 py-0.5 bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300 border border-red-300 dark:border-red-800 text-[10px] uppercase font-bold">
                  {a.recipient === "all"
                    ? t("🌐 تعميم للكل", "🌐 Broadcast All")
                    : a.recipient === "department"
                      ? t(`🏢 قسم ${a.department}`, `🏢 Dept: ${a.department}`)
                      : (a.recipientCount ?? a.recipients?.length ?? 1) > 1
                        ? t(`👥 ${a.recipientCount ?? a.recipients?.length} موظفين محددين`, `👥 ${a.recipientCount ?? a.recipients?.length} Selected Workers`)
                        : t("👤 تنبيه فردي", "👤 Individual")}
                </span>
                <span className="px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 text-[10px] uppercase font-bold">
                  {a.type || "Notice"}
                </span>
                <span className="text-[10px] text-zinc-400">{formatTs(a.sentAt || a.createdAt)}</span>
              </div>
              <p className="text-zinc-600 dark:text-zinc-400 max-w-2xl whitespace-pre-line">{a.message}</p>
              <p className="text-[10px] text-zinc-400 flex flex-wrap items-center gap-2">
                <span>
                  {t("المستلمون:", "Recipients:")} {a.recipientCount ?? a.recipients?.length ?? approved.length}
                </span>
                <span>·</span>
                <span className="text-emerald-700 dark:text-emerald-400 font-bold">
                  👁️ {t("قرأ الرسالة:", "Read by:")} {Array.isArray(a.readBy) ? a.readBy.length : 0} /{" "}
                  {a.recipientCount ?? a.recipients?.length ?? approved.length}
                </span>
                <span>·</span>
                <span>
                  {t("بواسطة:", "Sent by:")} {a.sentBy || "Admin"}
                </span>
              </p>
            </div>
            <div className="flex items-center gap-2">
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
                className="px-2.5 py-1 text-red-600 hover:underline cursor-pointer font-bold"
              >
                {t("حذف", "Delete")}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
