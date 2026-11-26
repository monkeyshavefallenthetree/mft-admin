"use client";

import { formatDepartment, formatEmploymentType, type HrSettings } from "@/lib/admin/hrReports";
import { useHrLang } from "@/lib/admin/hrI18n";
import ModalPortal from "@/components/admin/ui/ModalPortal";
import WorkerLeaveProfileCard from "@/components/admin/hr/WorkerLeaveProfileCard";
import type { Worker } from "@/lib/admin/hrPageTypes";
import { workerName } from "@/components/admin/hr/hrPageUtils";

interface Props {
  worker: Worker;
  isLiveOnline?: boolean;
  settings: HrSettings;
  adminEmail: string;
  onClose: () => void;
  onOpenPayslip: (w: Worker) => void;
}

export default function Worker360Modal({
  worker: dashboardWorker,
  isLiveOnline = false,
  settings,
  adminEmail,
  onClose,
  onOpenPayslip,
}: Props) {
  const { dir, t } = useHrLang();

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
          aria-labelledby="worker-360-modal-title"
          className="ui-card shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col animate-scale-in text-zinc-950 dark:text-zinc-100"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex justify-between items-center bg-zinc-50/80 dark:bg-zinc-900/80">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-red-500 to-rose-600 text-white flex items-center justify-center text-base font-bold shadow-xs">
                {dashboardWorker.firstName?.[0]}
                {dashboardWorker.lastName?.[0]}
              </div>
              <div>
                <h3 id="worker-360-modal-title" className="text-lg font-bold tracking-tight text-zinc-950 dark:text-white">
                  {workerName(dashboardWorker)}
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">{dashboardWorker.email}</p>
                <p className="text-xs mt-0.5">
                  <span className="text-zinc-600 dark:text-zinc-300 uppercase font-semibold">{dashboardWorker.status}</span>
                  {isLiveOnline ? (
                    <span className="ms-2 text-emerald-700 dark:text-emerald-400 font-semibold">{t("● متصل", "● Online")}</span>
                  ) : (
                    <span className="ms-2 text-zinc-400 font-medium">{t("○ غير متصل", "○ Offline")}</span>
                  )}
                </p>
              </div>
            </div>
            <button
              type="button"
              aria-label="Close"
              className="h-8 w-8 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
              onClick={() => onClose()}
            >
              &times;
            </button>
          </div>

          <div className="p-5 overflow-y-auto flex-1 text-xs space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3.5 bg-zinc-50/80 dark:bg-zinc-800/50 border border-zinc-200/80 dark:border-zinc-800 rounded-xl">
              <div>
                <span className="text-zinc-500 text-[11px]">{t("القسم:", "Department:")}</span>
                <p className="font-semibold text-zinc-900 dark:text-white mt-0.5">
                  {formatDepartment(dashboardWorker.department)}
                </p>
              </div>
              <div>
                <span className="text-zinc-500 text-[11px]">{t("نوع التعاقد:", "Employment:")}</span>
                <p className="font-semibold text-zinc-900 dark:text-white mt-0.5">
                  {formatEmploymentType(dashboardWorker.employmentType)}
                </p>
              </div>
              <div>
                <span className="text-zinc-500 text-[11px]">{t("أجر الساعة:", "Hourly Rate:")}</span>
                <p className="font-bold font-code text-emerald-700 dark:text-emerald-400 mt-0.5">
                  EGP {dashboardWorker.hourlyRate || settings.defaultHourlyRate}/h
                </p>
              </div>
              <div>
                <span className="text-zinc-500 text-[11px]">{t("الهاتف:", "Phone:")}</span>
                <p className="font-semibold font-code text-zinc-900 dark:text-white mt-0.5">{dashboardWorker.phone || "—"}</p>
              </div>
            </div>

            {/* Embedded Onboarding & Leave Profile Editor */}
            <WorkerLeaveProfileCard worker={dashboardWorker} adminEmail={adminEmail} />

            <div className="pt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  const w = dashboardWorker;
                  onClose();
                  onOpenPayslip(w);
                }}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg shadow-2xs cursor-pointer transition-colors"
              >
                {t("عرض كشف الراتب الحالي 📄", "View Current Payslip 📄")}
              </button>
              <button
                type="button"
                onClick={() => onClose()}
                className="brutal-btn-outline px-4 py-2 cursor-pointer"
              >
                {t("إغلاق", "Close")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
