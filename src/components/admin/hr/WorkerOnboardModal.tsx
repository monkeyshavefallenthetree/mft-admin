"use client";

import { formatDepartment } from "@/lib/admin/hrReports";
import { useHrLang } from "@/lib/admin/hrI18n";
import ModalPortal from "@/components/admin/ui/ModalPortal";
import WorkerLeaveProfileCard from "@/components/admin/hr/WorkerLeaveProfileCard";
import type { Worker } from "@/lib/admin/hrPageTypes";
import { workerName } from "@/components/admin/hr/hrPageUtils";

interface Props {
  worker: Worker;
  adminEmail: string;
  onClose: () => void;
}

export default function WorkerOnboardModal({ worker: onboardModalWorker, adminEmail, onClose }: Props) {
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
          aria-labelledby="worker-onboard-modal-title"
          className="ui-card shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 text-zinc-950 dark:text-zinc-100 animate-scale-in space-y-4"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between pb-3 border-b border-zinc-200 dark:border-zinc-800">
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-widest text-red-600">
                {t("إعداد بيانات الموظف والراتب والإجازات", "WORKER ONBOARDING, RATE & LEAVE CONTROL")}
              </span>
              <h3 id="worker-onboard-modal-title" className="text-xl font-bold tracking-tight text-zinc-950 dark:text-white mt-0.5">
                {workerName(onboardModalWorker)}
              </h3>
              <p className="text-xs text-zinc-500">
                {formatDepartment(onboardModalWorker.department)} · {onboardModalWorker.role} · {onboardModalWorker.email}
              </p>
            </div>
            <button
              type="button"
              aria-label="Close"
              onClick={() => onClose()}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
            >
              &times;
            </button>
          </div>

          <WorkerLeaveProfileCard
            worker={onboardModalWorker}
            adminEmail={adminEmail}
            onSaved={() => onClose()}
          />
        </div>
      </div>
    </ModalPortal>
  );
}
