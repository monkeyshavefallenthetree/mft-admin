"use client";

import { useMemo } from "react";
import { DEPARTMENTS } from "@/lib/admin/constants";
import { sessionHours } from "@/lib/admin/workTime";
import {
  formatDepartment,
  performanceRating,
  productivityScore,
  workerSessionsInRange,
  type HrSettings,
} from "@/lib/admin/hrReports";
import { useHrLang } from "@/lib/admin/hrI18n";
import { useUrlState } from "@/lib/admin/useUrlState";
import type { Worker, WorkSession } from "@/lib/admin/hrPageTypes";
import type { HrData } from "@/lib/admin/useHrData";
import { EMPLOYMENT_OPTIONS, workerName } from "@/components/admin/hr/hrPageUtils";

interface Props {
  approved: Worker[];
  sessions: WorkSession[];
  settings: HrSettings;
  activePeriod: HrData["activePeriod"];
  workerTaskStats: HrData["workerTaskStats"];
  setOnboardModalWorker: (w: Worker) => void;
  setPayslipModalWorker: (w: Worker) => void;
  setDashboardWorker: (w: Worker) => void;
}

export default function TeamTab({
  approved,
  sessions,
  settings,
  activePeriod,
  workerTaskStats,
  setOnboardModalWorker,
  setPayslipModalWorker,
  setDashboardWorker,
}: Props) {
  const { isAr, t } = useHrLang();
  const [workerSearch, setWorkerSearch] = useUrlState("q");

  const [departmentFilter, setDepartmentFilter] = useUrlState("dept");

  const [employmentFilter, setEmploymentFilter] = useUrlState("type");

  const filteredHrWorkers = useMemo(() => {
    const q = workerSearch.trim().toLowerCase();
    return approved.filter((w) => {
      if (departmentFilter && (w.department || "") !== departmentFilter) return false;
      if (employmentFilter && (w.employmentType || "full-time") !== employmentFilter) return false;
      if (!q) return true;
      const blob = `${workerName(w)} ${w.email || ""} ${w.department || ""} ${w.role}`.toLowerCase();
      return blob.includes(q);
    });
  }, [approved, workerSearch, departmentFilter, employmentFilter]);

  return (
    <div className="space-y-4 animate-fade-in font-mono">
      <div className="p-4 bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-700 shadow-[3px_3px_0px_0px_#09090b] rounded-lg flex flex-col lg:flex-row lg:items-center gap-3">
        <div className="relative flex-1">
          <input
            id="hr-search"
            value={workerSearch}
            onChange={(e) => setWorkerSearch(e.target.value)}
            placeholder={t("ابحث بالاسم أو البريد أو القسم أو الوظيفة…", "Search name, email, department, role…")}
            className="w-full bg-white dark:bg-zinc-800 border-2 border-zinc-900 dark:border-zinc-700 px-3 py-2 text-zinc-950 dark:text-zinc-100 text-xs font-bold rounded focus:outline-none focus:ring-2 focus:ring-red-600"
          />
        </div>
        <select
          value={departmentFilter}
          onChange={(e) => setDepartmentFilter(e.target.value)}
          className="bg-white dark:bg-zinc-800 border-2 border-zinc-900 dark:border-zinc-700 px-3 py-2 text-xs font-bold text-zinc-900 dark:text-zinc-100 rounded"
        >
          <option value="">{t("كل الأقسام", "All departments")}</option>
          {DEPARTMENTS.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
        <select
          value={employmentFilter}
          onChange={(e) => setEmploymentFilter(e.target.value)}
          className="bg-white dark:bg-zinc-800 border-2 border-zinc-900 dark:border-zinc-700 px-3 py-2 text-xs font-bold text-zinc-900 dark:text-zinc-100 rounded"
        >
          <option value="">{t("كل أنواع التعاقد", "All employment types")}</option>
          {EMPLOYMENT_OPTIONS.map((e) => (
            <option key={e.value} value={e.value}>
              {isAr ? e.ar : e.en}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredHrWorkers.map((w) => {
          const ws = workerSessionsInRange(sessions, w.id, activePeriod.start, activePeriod.end);
          const ts = workerTaskStats.get(w.id) || { completed: 0, total: 0 };
          const totalHours = ws.reduce((sum, s) => sum + sessionHours(s), 0);
          const prod = productivityScore(w.expectedHours || 8, ts.completed, ts.total, ws);

          return (
            <div
              key={w.id}
              className="p-5 bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-700 shadow-[3px_3px_0px_0px_#09090b] rounded-lg flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="font-bold text-base text-zinc-950 dark:text-white font-heading">
                      {workerName(w)}
                    </h4>
                    <p className="text-xs text-zinc-500">
                      {formatDepartment(w.department)} · {w.role}
                    </p>
                  </div>
                  <span className="px-2 py-0.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 border border-zinc-300 dark:border-zinc-700 text-xs font-bold rounded">
                    {prod}%
                  </span>
                </div>

                <div className="mt-4 space-y-1.5 text-xs text-zinc-700 dark:text-zinc-300">
                  <div>
                    <strong>{t("الساعات المسجلة:", "Logged Hours:")}</strong> {Math.round(totalHours * 10) / 10}h ({ws.length}{" "}
                    {t("وردية", "shifts")})
                  </div>
                  <div>
                    <strong>{t("المهام المنجزة:", "Tasks Finished:")}</strong> {ts.completed} / {ts.total}
                  </div>
                  <div>
                    <strong>{t("التقييم:", "Rating:")}</strong> {performanceRating(prod)}
                  </div>
                  <div>
                    <strong>{t("أجر الساعة:", "Rate:")}</strong> EGP {w.hourlyRate || settings.defaultHourlyRate}/h
                  </div>
                  <div>
                    <strong>{t("تاريخ التعيين:", "Joined Company:")}</strong> {w.hireDate || t("غير محدد", "Not set")}
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-zinc-200 dark:border-zinc-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOnboardModalWorker(w)}
                  className="text-xs font-bold text-zinc-700 dark:text-zinc-300 hover:underline cursor-pointer"
                >
                  {t("🗓️ التعيين والراتب", "🗓️ Join Date & Rate")}
                </button>
                <button
                  type="button"
                  onClick={() => setPayslipModalWorker(w)}
                  className="text-xs font-bold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer"
                >
                  {t("كشف الراتب 📄", "Payslip 📄")}
                </button>
                <button
                  type="button"
                  onClick={() => setDashboardWorker(w)}
                  className="text-xs font-bold text-red-600 hover:underline cursor-pointer"
                >
                  {t("الملف الكامل ←", "Full 360 →")}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
