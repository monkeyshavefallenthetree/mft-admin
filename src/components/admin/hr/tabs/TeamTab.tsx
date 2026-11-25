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
import { ChartCard, BarCompare } from "@/components/admin/ui/Charts";

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

  const teamProductivityChart = useMemo(() => {
    return filteredHrWorkers
      .map((w) => {
        const ws = workerSessionsInRange(sessions, w.id, activePeriod.start, activePeriod.end);
        const ts = workerTaskStats.get(w.id) || { completed: 0, total: 0 };
        const totalHours = Math.round(ws.reduce((sum, s) => sum + sessionHours(s), 0) * 10) / 10;
        const prod = productivityScore(w.expectedHours || 8, ts.completed, ts.total, ws);
        const fullName = workerName(w);
        return {
          worker: fullName.length > 14 ? fullName.slice(0, 13) + "…" : fullName,
          Productivity: prod,
          Hours: totalHours,
        };
      })
      .sort((a, b) => b.Productivity - a.Productivity)
      .slice(0, 8);
  }, [filteredHrWorkers, sessions, activePeriod, workerTaskStats]);

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Team Productivity & Hours Chart */}
      {teamProductivityChart.length > 0 && (
        <ChartCard
          title={t("مؤشر الإنتاجية وساعات العمل للفريق", "Team Productivity & Logged Hours Benchmark")}
          subtitle={t("مقارنة نسبة الإنتاجية وساعات العمل المسجلة خلال الفترة المحددة", "Productivity score (%) and logged shift hours for the active cycle")}
        >
          <BarCompare
            data={teamProductivityChart}
            xKey="worker"
            series={[
              { key: "Productivity", label: t("الإنتاجية (%)", "Productivity (%)"), color: "#10b981" },
              { key: "Hours", label: t("الساعات (h)", "Logged Hours (h)"), color: "#3b82f6" },
            ]}
            height={195}
            description="Team productivity and hours"
          />
        </ChartCard>
      )}

      {/* Search & Filters */}
      <div className="ui-card p-3.5 flex flex-col lg:flex-row lg:items-center gap-2.5">
        <div className="relative flex-1">
          <input
            id="hr-search"
            type="search"
            value={workerSearch}
            onChange={(e) => setWorkerSearch(e.target.value)}
            placeholder={t("ابحث بالاسم أو البريد أو القسم أو الوظيفة…", "Search name, email, department, role…")}
            className="brutal-input text-xs"
          />
        </div>
        <select
          value={departmentFilter}
          onChange={(e) => setDepartmentFilter(e.target.value)}
          className="brutal-input lg:w-48 text-xs"
          aria-label="Filter by department"
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
          className="brutal-input lg:w-48 text-xs"
          aria-label="Filter by employment type"
        >
          <option value="">{t("كل أنواع التعاقد", "All employment types")}</option>
          {EMPLOYMENT_OPTIONS.map((e) => (
            <option key={e.value} value={e.value}>
              {isAr ? e.ar : e.en}
            </option>
          ))}
        </select>
      </div>

      {/* Team Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredHrWorkers.map((w) => {
          const ws = workerSessionsInRange(sessions, w.id, activePeriod.start, activePeriod.end);
          const ts = workerTaskStats.get(w.id) || { completed: 0, total: 0 };
          const totalHours = Math.round(ws.reduce((sum, s) => sum + sessionHours(s), 0) * 10) / 10;
          const prod = productivityScore(w.expectedHours || 8, ts.completed, ts.total, ws);

          return (
            <div
              key={w.id}
              className="ui-card ui-card-hover p-5 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h4 className="font-bold text-sm text-zinc-950">
                      {workerName(w)}
                    </h4>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      {formatDepartment(w.department)} · {w.role}
                    </p>
                  </div>
                  <span
                    className={`font-code px-2.5 py-0.5 border text-xs font-bold rounded-full ${
                      prod >= 80
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : prod >= 50
                        ? "bg-blue-50 text-blue-700 border-blue-200"
                        : "bg-amber-50 text-amber-800 border-amber-200"
                    }`}
                  >
                    {prod}%
                  </span>
                </div>

                {/* Productivity Bar */}
                <div className="mt-3">
                  <div className="flex items-center justify-between text-[11px] text-zinc-500 mb-1">
                    <span>{performanceRating(prod)}</span>
                    <span className="font-code font-semibold text-zinc-700">{ts.completed}/{ts.total} tasks</span>
                  </div>
                  <div className="h-1.5 w-full bg-zinc-100 rounded-full overflow-hidden">
                    <div
                      style={{ width: `${Math.min(100, prod)}%` }}
                      className={`h-full rounded-full ${
                        prod >= 80 ? "bg-emerald-500" : prod >= 50 ? "bg-blue-500" : "bg-amber-500"
                      }`}
                    />
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2.5 rounded-xl bg-zinc-50/80 border border-zinc-100">
                    <span className="text-[10px] text-zinc-400 font-semibold block">
                      {t("الساعات المسجلة", "Logged Hours")}
                    </span>
                    <strong className="font-code text-zinc-900">
                      {totalHours}h ({ws.length} {t("وردية", "shifts")})
                    </strong>
                  </div>
                  <div className="p-2.5 rounded-xl bg-zinc-50/80 border border-zinc-100">
                    <span className="text-[10px] text-zinc-400 font-semibold block">
                      {t("أجر الساعة", "Hourly Rate")}
                    </span>
                    <strong className="font-code text-zinc-900">
                      EGP {w.hourlyRate || settings.defaultHourlyRate}/h
                    </strong>
                  </div>
                </div>

                <div className="mt-2.5 text-xs text-zinc-500 flex items-center justify-between px-1">
                  <span>{t("تاريخ التعيين:", "Joined Company:")}</span>
                  <strong className="font-code text-zinc-800">{w.hireDate || t("غير محدد", "Not set")}</strong>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-zinc-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOnboardModalWorker(w)}
                  className="px-2.5 py-1 rounded-lg bg-zinc-100 hover:bg-zinc-200 text-xs font-semibold text-zinc-700 cursor-pointer transition-colors"
                >
                  {t("🗓️ التعيين والراتب", "🗓️ Join & Rate")}
                </button>
                <button
                  type="button"
                  onClick={() => setPayslipModalWorker(w)}
                  className="px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-xs font-semibold text-emerald-700 border border-emerald-200 cursor-pointer transition-colors"
                >
                  {t("كشف الراتب 📄", "Payslip 📄")}
                </button>
                <button
                  type="button"
                  onClick={() => setDashboardWorker(w)}
                  className="px-2.5 py-1 rounded-lg bg-red-50 hover:bg-red-600 text-xs font-semibold text-red-700 hover:text-white border border-red-200 cursor-pointer transition-colors"
                >
                  {t("الملف الكامل ←", "360° →")}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
