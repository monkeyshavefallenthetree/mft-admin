"use client";

import { formatDepartment, formatEmploymentType, type HrSettings } from "@/lib/admin/hrReports";
import { useHrLang } from "@/lib/admin/hrI18n";
import ModalPortal from "@/components/admin/ui/ModalPortal";
import WorkerLeaveProfileCard from "@/components/admin/hr/WorkerLeaveProfileCard";
import type { Worker } from "@/lib/admin/hrPageTypes";
import { workerName } from "@/components/admin/hr/hrPageUtils";

interface Props {
  worker: Worker;
  settings: HrSettings;
  adminEmail: string;
  onClose: () => void;
  onOpenPayslip: (w: Worker) => void;
}

export default function Worker360Modal({ worker: dashboardWorker, settings, adminEmail, onClose, onOpenPayslip }: Props) {
  const { dir, t } = useHrLang();

  return (
    <ModalPortal onClose={() => onClose()}>
      <div
        className="fixed inset-0 z-[120] bg-zinc-950/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto animate-fade-in font-mono"
        onClick={() => onClose()}
      >
        <div
          dir={dir}
          className="bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-700 shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col animate-scale-in text-zinc-950 dark:text-zinc-100 rounded-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-4 border-b-2 border-zinc-900 dark:border-zinc-700 flex justify-between items-center bg-zinc-50 dark:bg-zinc-800">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-none bg-red-600 border-2 border-zinc-900 text-white flex items-center justify-center text-lg font-bold font-heading shadow-[2px_2px_0px_0px_#09090b]">
                {dashboardWorker.firstName?.[0]}
                {dashboardWorker.lastName?.[0]}
              </div>
              <div>
                <h3 className="text-lg font-black text-zinc-950 dark:text-white font-heading">
                  {workerName(dashboardWorker)}
                </h3>
                <p className="text-xs text-zinc-600 dark:text-zinc-400">{dashboardWorker.email}</p>
                <p className="text-xs mt-0.5">
                  <span className="text-zinc-600 uppercase font-bold">{dashboardWorker.status}</span>
                  {dashboardWorker.isOnline ? (
                    <span className="ms-2 text-emerald-700 font-bold">{t("● متصل", "● Online")}</span>
                  ) : (
                    <span className="ms-2 text-zinc-400 font-bold">{t("○ غير متصل", "○ Offline")}</span>
                  )}
                </p>
              </div>
            </div>
            <button
              type="button"
              className="text-2xl text-zinc-500 hover:text-red-600 font-bold cursor-pointer"
              onClick={() => onClose()}
            >
              &times;
            </button>
          </div>

          <div className="p-4 overflow-y-auto flex-1 text-xs space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 p-3 bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded">
              <div>
                <span className="text-zinc-500">{t("القسم:", "Department:")}</span>
                <p className="font-bold text-zinc-900 dark:text-white">
                  {formatDepartment(dashboardWorker.department)}
                </p>
              </div>
              <div>
                <span className="text-zinc-500">{t("نوع التعاقد:", "Employment:")}</span>
                <p className="font-bold text-zinc-900 dark:text-white">
                  {formatEmploymentType(dashboardWorker.employmentType)}
                </p>
              </div>
              <div>
                <span className="text-zinc-500">{t("أجر الساعة:", "Hourly Rate:")}</span>
                <p className="font-bold text-emerald-700 dark:text-emerald-400">
                  EGP {dashboardWorker.hourlyRate || settings.defaultHourlyRate}/h
                </p>
              </div>
              <div>
                <span className="text-zinc-500">{t("الهاتف:", "Phone:")}</span>
                <p className="font-bold text-zinc-900 dark:text-white">{dashboardWorker.phone || "—"}</p>
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
                className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold uppercase rounded cursor-pointer"
              >
                {t("عرض كشف الراتب الحالي 📄", "View Current Payslip 📄")}
              </button>
              <button
                type="button"
                onClick={() => onClose()}
                className="px-4 py-1.5 border border-zinc-400 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white font-bold uppercase rounded cursor-pointer"
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
