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
        className="fixed inset-0 z-[120] bg-zinc-950/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto animate-fade-in"
        onClick={() => onClose()}
      >
        <div
          dir={dir}
          className="border-2 border-zinc-900 bg-white dark:bg-zinc-900 w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 shadow-2xl text-zinc-950 dark:text-zinc-100 font-mono animate-scale-in rounded-lg space-y-4"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between pb-3 border-b-2 border-zinc-900">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-red-600">
                {t("// إعداد بيانات الموظف والراتب والإجازات", "// WORKER ONBOARDING, RATE & LEAVE CONTROL")}
              </span>
              <h3 className="text-xl font-black font-heading text-zinc-950 dark:text-white mt-0.5">
                {workerName(onboardModalWorker)}
              </h3>
              <p className="text-xs text-zinc-500">
                {formatDepartment(onboardModalWorker.department)} · {onboardModalWorker.role} · {onboardModalWorker.email}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onClose()}
              className="text-2xl font-bold text-zinc-500 hover:text-red-600 cursor-pointer"
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
