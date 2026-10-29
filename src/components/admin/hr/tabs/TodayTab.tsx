"use client";

import { useMemo, useState } from "react";
import { sessionHours } from "@/lib/admin/workTime";
import { formatDepartment, type HrSettings } from "@/lib/admin/hrReports";
import { useHrLang } from "@/lib/admin/hrI18n";
import type { AdjustmentKind } from "@/components/admin/hr/HrAdjustmentModal";
import type { Worker, WorkSession, HrSummary } from "@/lib/admin/hrPageTypes";
import { workerName } from "@/components/admin/hr/hrPageUtils";

export type TodayFilter = "all" | "present" | "absent" | "late" | "overtime";

interface Props {
  approved: Worker[];
  settings: HrSettings;
  hrSummary: HrSummary;
  todaysSessions: WorkSession[];
  presentWorkerIds: Set<string>;
  lateWorkerIds: Set<string>;
  overtimeWorkerIds: Set<string>;
  todayFilter: TodayFilter;
  setTodayFilter: (f: TodayFilter) => void;
  setOnboardModalWorker: (w: Worker) => void;
  setExcuseModalWorker: (w: Worker) => void;
  setPayslipModalWorker: (w: Worker) => void;
  openAdjustmentFor: (workerId?: string, kind?: AdjustmentKind) => void;
}

export default function TodayTab({
  approved,
  settings,
  hrSummary,
  todaysSessions,
  presentWorkerIds,
  lateWorkerIds,
  overtimeWorkerIds,
  todayFilter,
  setTodayFilter,
  setOnboardModalWorker,
  setExcuseModalWorker,
  setPayslipModalWorker,
  openAdjustmentFor,
}: Props) {
  const { t } = useHrLang();
  const [todaySearch, setTodaySearch] = useState("");

  const filteredTodayWorkers = useMemo(() => {
    const q = todaySearch.trim().toLowerCase();
    return approved.filter((w) => {
      const isPresent = presentWorkerIds.has(w.id);
      const isLate = lateWorkerIds.has(w.id);
      const isOvertime = overtimeWorkerIds.has(w.id);

      if (todayFilter === "present" && !isPresent) return false;
      if (todayFilter === "absent" && isPresent) return false;
      if (todayFilter === "late" && !isLate) return false;
      if (todayFilter === "overtime" && !isOvertime) return false;

      if (q) {
        const blob = `${workerName(w)} ${w.department || ""} ${w.role || ""} ${w.email || ""}`.toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
  }, [approved, todayFilter, todaySearch, presentWorkerIds, lateWorkerIds, overtimeWorkerIds]);

  return (
    <div className="space-y-5 animate-fade-in font-mono">
      {/* Top KPI Metrics Strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {[
          { label: t("حاضرون اليوم", "Present Today"), value: hrSummary.presentToday, bar: "bg-emerald-500" },
          { label: t("غائبون اليوم", "Absent Today"), value: hrSummary.absentToday, bar: "bg-red-500" },
          {
            label: t(`متأخرون (بعد السماح)`, `Late (>${settings.shiftStartTime || "10:00"})`),
            value: hrSummary.lateToday,
            bar: "bg-amber-500",
          },
          {
            label: t(`عمل إضافي (>${settings.standardHours || 8}س)`, `Overtime (>${settings.standardHours || 8}h)`),
            value: hrSummary.overtimeToday,
            bar: "bg-violet-500",
          },
          { label: t("نسبة الحضور", "Attendance Rate"), value: `${hrSummary.attendanceRate}%`, bar: "bg-blue-500" },
          { label: t("إجمالي ساعات اليوم", "Hours Today"), value: `${hrSummary.payrollHoursToday}h`, bar: "bg-zinc-400" },
        ].map((s) => (
          <div
            key={s.label}
            className="p-4 bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-700 shadow-[3px_3px_0px_0px_#09090b] relative overflow-hidden rounded-lg"
          >
            <span className={`absolute start-0 top-0 h-full w-1.5 ${s.bar}`} />
            <p className="text-[10px] font-bold uppercase text-zinc-500">{s.label}</p>
            <p className="text-2xl font-bold font-oswald text-zinc-950 dark:text-white mt-1">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Live Roster Filter Pills & Search */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 p-3.5 bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-700 shadow-[2px_2px_0px_0px_#09090b] rounded-lg">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-bold uppercase text-zinc-400 me-1">
            {t("تصفية الموظفين:", "Filter Roster:")}
          </span>
          {(
            [
              { id: "all", label: t(`الكل (${approved.length})`, `All Workers (${approved.length})`) },
              { id: "present", label: t(`الحاضرون (${hrSummary.presentToday})`, `Present (${hrSummary.presentToday})`) },
              { id: "absent", label: t(`الغائبون (${hrSummary.absentToday})`, `Absent (${hrSummary.absentToday})`) },
              { id: "late", label: t(`المتأخرون (${hrSummary.lateToday})`, `Late (${hrSummary.lateToday})`) },
              { id: "overtime", label: t(`في وقت إضافي (${hrSummary.overtimeToday})`, `Overtime (${hrSummary.overtimeToday})`) },
            ] as const
          ).map((pill) => (
            <button
              key={pill.id}
              type="button"
              onClick={() => setTodayFilter(pill.id)}
              className={`px-3 py-1.5 rounded text-xs font-bold cursor-pointer border transition-all ${
                todayFilter === pill.id
                  ? "bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950 border-zinc-950 shadow-sm"
                  : "bg-zinc-50 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100"
              }`}
            >
              {pill.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={todaySearch}
            onChange={(e) => setTodaySearch(e.target.value)}
            placeholder={t("🔍 ابحث باسم الموظف أو القسم...", "🔍 Search worker or dept...")}
            className="bg-zinc-50 dark:bg-zinc-800 border-2 border-zinc-900 dark:border-zinc-700 px-3 py-1.5 text-xs font-bold rounded text-zinc-950 dark:text-zinc-100 w-full sm:w-64 focus:outline-none focus:ring-2 focus:ring-red-600"
          />
          <span className="text-[11px] text-zinc-500">
            {t(
              `الوردية: ${settings.shiftStartTime || "10:00"} + سماح ${settings.gracePeriodMinutes || 60}د`,
              `Shift: ${settings.shiftStartTime || "10:00"} + ${settings.gracePeriodMinutes || 60}m Grace`,
            )}
          </span>
        </div>
      </div>

      {/* Live Workers Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {filteredTodayWorkers.map((w) => {
          const workerTodaySessions = todaysSessions.filter((s) => s.workerId === w.id);
          const workerSession =
            workerTodaySessions.find((s) => s.loginTime?.toDate || s.startTime?.toDate) || workerTodaySessions[0];
          const isPresent = workerTodaySessions.length > 0 && presentWorkerIds.has(w.id);
          const isActiveInShift = workerTodaySessions.some((s) => Boolean(s.isActive));
          const isLate = isPresent && lateWorkerIds.has(w.id);
          const workedHours =
            Math.round(workerTodaySessions.reduce((sum, s) => sum + sessionHours(s), 0) * 10) / 10;
          const clockInTs = workerSession?.loginTime?.toDate
            ? workerSession.loginTime
            : workerSession?.startTime?.toDate
              ? workerSession.startTime
              : null;

          return (
            <div
              key={w.id}
              className={`p-4 border-2 border-zinc-900 dark:border-zinc-700 rounded-lg flex flex-col justify-between transition-all ${
                !isPresent
                  ? "bg-red-50/40 dark:bg-red-950/20 border-red-300 dark:border-red-900 shadow-[2px_2px_0px_0px_#dc2626]"
                  : isLate
                    ? "bg-amber-50/40 dark:bg-amber-950/20 border-amber-300 shadow-[2px_2px_0px_0px_#d97706]"
                    : "bg-white dark:bg-zinc-900 shadow-[2px_2px_0px_0px_#09090b]"
              }`}
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h4 className="font-bold text-sm text-zinc-950 dark:text-white font-heading">
                      {workerName(w)}
                    </h4>
                    <p className="text-[11px] text-zinc-500">
                      {formatDepartment(w.department)} · {w.role || "Operator"}
                    </p>
                  </div>

                  <span
                    className={`px-2 py-0.5 text-[10px] font-bold uppercase rounded border ${
                      !isPresent
                        ? "bg-red-100 text-red-800 border-red-300 dark:bg-red-900/60 dark:text-red-300"
                        : isLate
                          ? "bg-amber-100 text-amber-800 border-amber-300"
                          : "bg-emerald-100 text-emerald-800 border-emerald-300"
                    }`}
                  >
                    {!isPresent
                      ? t("غائب", "Absent")
                      : isLate
                        ? t("متأخر", "Late")
                        : t("في الموعد", "On-Time")}
                  </span>
                </div>

                <div className="mt-3 pt-2 border-t border-zinc-200 dark:border-zinc-800 text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-zinc-500">{t("الحالة الآن:", "Status:")}</span>
                    <strong
                      className={
                        isActiveInShift
                          ? "text-emerald-600"
                          : isPresent
                            ? "text-blue-600 dark:text-blue-400"
                            : "text-zinc-500"
                      }
                    >
                      {isActiveInShift
                        ? t("🟢 متصل بالوردية الآن", "🟢 Online in shift")
                        : isPresent
                          ? t("🔵 أنهى الشيفت / استراحة", "🔵 Clocked out")
                          : t("⚪ لم يسجل حضور اليوم", "⚪ Not clocked in")}
                    </strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">{t("ساعات اليوم:", "Today Hours:")}</span>
                    <strong>
                      {workedHours}h / {settings.standardHours || 8}h
                    </strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">{t("تاريخ التعيين:", "Joined Company:")}</span>
                    <button
                      type="button"
                      onClick={() => setOnboardModalWorker(w)}
                      className={`font-bold underline cursor-pointer ${
                        w.hireDate ? "text-zinc-900 dark:text-zinc-100" : "text-amber-600"
                      }`}
                    >
                      {w.hireDate || t("⚠ حدد تاريخ التعيين", "⚠ Set join date")}
                    </button>
                  </div>
                  {clockInTs?.toDate && (
                    <div className="flex justify-between">
                      <span className="text-zinc-500">{t("وقت الحضور:", "Clock-in Time:")}</span>
                      <strong>
                        {clockInTs.toDate().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </strong>
                    </div>
                  )}
                </div>
              </div>

              {/* Actions Bar */}
              <div className="mt-4 pt-3 border-t border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-1.5">
                <div className="flex flex-wrap items-center gap-1">
                  {w.phone && (
                    <a
                      href={`https://wa.me/${w.phone.replace(/\D/g, "")}`}
                      target="_blank"
                      rel="noreferrer"
                      className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[10px] font-bold cursor-pointer"
                    >
                      WhatsApp
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => setOnboardModalWorker(w)}
                    className="px-2 py-1 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 text-zinc-900 dark:text-zinc-200 border border-zinc-300 dark:border-zinc-700 rounded text-[10px] font-bold cursor-pointer"
                  >
                    {t("🗓️ التعيين والراتب", "🗓️ Join & Rate")}
                  </button>
                  <button
                    type="button"
                    onClick={() => openAdjustmentFor(w.id, "deduction")}
                    title={t("توقيع جزاء لائحي أو خصم على هذا الموظف", "Apply disciplinary deduction")}
                    className="px-2 py-1 bg-red-50 dark:bg-red-950/40 hover:bg-red-600 hover:text-white text-red-700 dark:text-red-300 border border-red-300 dark:border-red-800 rounded text-[10px] font-bold cursor-pointer transition-colors"
                  >
                    {t("⚖️ جزاء/خصم", "⚖️ Penalty")}
                  </button>
                  <button
                    type="button"
                    onClick={() => openAdjustmentFor(w.id, "bonus")}
                    className="px-2 py-1 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-600 hover:text-white text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 rounded text-[10px] font-bold cursor-pointer transition-colors"
                  >
                    {t("🎁 بونص", "🎁 Bonus")}
                  </button>
                </div>

                <div className="flex items-center gap-1.5">
                  {!isPresent && (
                    <button
                      type="button"
                      onClick={() => setExcuseModalWorker(w)}
                      className="px-2 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded text-[10px] font-bold cursor-pointer"
                    >
                      {t("+ تسجيل عذر / إجازة", "+ Excuse Absence")}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setPayslipModalWorker(w)}
                    className="px-2 py-1 text-emerald-700 dark:text-emerald-400 hover:underline text-[10px] font-bold cursor-pointer"
                  >
                    {t("كشف الراتب 📄", "Payslip 📄")}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
