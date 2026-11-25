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
  liveNowMs?: number;
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
  liveNowMs,
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

  const stdHours = settings.standardHours || 8;

  return (
    <div className="space-y-5 animate-fade-in">
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
            label: t(`عمل إضافي (>${stdHours}س)`, `Overtime (>${stdHours}h)`),
            value: hrSummary.overtimeToday,
            bar: "bg-violet-500",
          },
          { label: t("نسبة الحضور", "Attendance Rate"), value: `${hrSummary.attendanceRate}%`, bar: "bg-blue-500" },
          { label: t("إجمالي ساعات اليوم", "Hours Today"), value: `${hrSummary.payrollHoursToday}h`, bar: "bg-zinc-500" },
        ].map((s) => (
          <div key={s.label} className="ui-card relative overflow-hidden p-4">
            <span className={`absolute inset-x-0 top-0 h-1 ${s.bar}`} />
            <p className="text-[11px] font-medium text-zinc-500">{s.label}</p>
            <p className="mt-1.5 font-code text-2xl font-bold tracking-tight tabular-nums text-zinc-900">
              {s.value}
            </p>
          </div>
        ))}
      </div>

      {/* Live Roster Filter Tablist & Search */}
      <div className="ui-card flex flex-col justify-between gap-3 p-3.5 lg:flex-row lg:items-center">
        <div
          role="tablist"
          aria-label={t("تصفية الموظفين", "Filter Roster")}
          className="flex items-center gap-1 overflow-x-auto rounded-xl bg-zinc-100 p-1"
        >
          {(
            [
              { id: "all", label: t(`الكل (${approved.length})`, `All (${approved.length})`) },
              { id: "present", label: t(`الحاضرون (${hrSummary.presentToday})`, `Present (${hrSummary.presentToday})`) },
              { id: "absent", label: t(`الغائبون (${hrSummary.absentToday})`, `Absent (${hrSummary.absentToday})`) },
              { id: "late", label: t(`المتأخرون (${hrSummary.lateToday})`, `Late (${hrSummary.lateToday})`) },
              { id: "overtime", label: t(`وقت إضافي (${hrSummary.overtimeToday})`, `Overtime (${hrSummary.overtimeToday})`) },
            ] as const
          ).map((pill) => (
            <button
              key={pill.id}
              type="button"
              role="tab"
              aria-selected={todayFilter === pill.id}
              onClick={() => setTodayFilter(pill.id)}
              className={`mft-tab-btn rounded-lg px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                todayFilter === pill.id
                  ? "bg-white text-zinc-900 shadow-2xs"
                  : "text-zinc-500 hover:text-zinc-800"
              }`}
            >
              {pill.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <input
            type="search"
            value={todaySearch}
            onChange={(e) => setTodaySearch(e.target.value)}
            placeholder={t("ابحث باسم الموظف أو القسم…", "Search worker or dept…")}
            className="brutal-input h-9 w-full sm:w-64 text-xs"
          />
          <span className="rounded-lg bg-zinc-100 px-2.5 py-1.5 font-code text-[11px] font-medium text-zinc-600">
            {t(
              `الوردية: ${settings.shiftStartTime || "10:00"} + سماح ${settings.gracePeriodMinutes || 60}د`,
              `Shift: ${settings.shiftStartTime || "10:00"} + ${settings.gracePeriodMinutes || 60}m Grace`,
            )}
          </span>
        </div>
      </div>

      {/* Live Workers Grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filteredTodayWorkers.map((w) => {
          const workerTodaySessions = todaysSessions.filter((s) => s.workerId === w.id);
          const sortedByStart = [...workerTodaySessions].sort((a, b) => {
            const aMs =
              (a.startTime?.toDate?.() ?? a.loginTime?.toDate?.())?.getTime() ?? Number.MAX_SAFE_INTEGER;
            const bMs =
              (b.startTime?.toDate?.() ?? b.loginTime?.toDate?.())?.getTime() ?? Number.MAX_SAFE_INTEGER;
            return aMs - bMs;
          });
          const workerSession =
            sortedByStart.find(
              (s) => !s.isExternalMission && (s.startTime?.toDate || s.loginTime?.toDate),
            ) || sortedByStart[0];
          const isPresent = workerTodaySessions.length > 0 && presentWorkerIds.has(w.id);
          const isActiveInShift = workerTodaySessions.some((s) => Boolean(s.isActive));
          const isLate = isPresent && lateWorkerIds.has(w.id);
          const workedHours =
            Math.round(
              workerTodaySessions.reduce(
                (sum, s) => sum + sessionHours(s, liveNowMs, { standardHours: stdHours }),
                0,
              ) * 10,
            ) / 10;
          const shiftPct = Math.min(100, Math.round((workedHours / stdHours) * 100));
          const clockInTs = workerSession?.startTime?.toDate
            ? workerSession.startTime
            : workerSession?.loginTime?.toDate
              ? workerSession.loginTime
              : null;

          const initials = workerName(w)
            .split(" ")
            .map((p) => p[0])
            .join("")
            .slice(0, 2)
            .toUpperCase();

          return (
            <div
              key={w.id}
              className={`ui-card ui-card-hover relative flex flex-col justify-between overflow-hidden p-4 ${
                !isPresent
                  ? "border-red-200/80"
                  : isLate
                    ? "border-amber-200/80"
                    : ""
              }`}
            >
              <span
                className={`absolute inset-x-0 top-0 h-1 ${
                  !isPresent ? "bg-red-500" : isLate ? "bg-amber-500" : "bg-emerald-500"
                }`}
              />
              <div>
                <div className="flex items-start justify-between gap-2 pt-1">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-zinc-900 font-code text-xs font-bold text-white">
                      {initials}
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-white ${
                          isActiveInShift
                            ? "bg-emerald-500"
                            : isPresent
                              ? "bg-blue-500"
                              : "bg-zinc-300"
                        }`}
                      />
                    </span>
                    <div className="min-w-0">
                      <h4 className="truncate text-sm font-bold text-zinc-900">{workerName(w)}</h4>
                      <p className="truncate text-[11px] text-zinc-500">
                        {formatDepartment(w.department)} · {w.role || "Operator"}
                      </p>
                    </div>
                  </div>

                  <span
                    className={`shrink-0 rounded-lg border px-2 py-0.5 text-[10px] font-bold uppercase ${
                      !isPresent
                        ? "border-red-200 bg-red-50 text-red-700"
                        : isLate
                          ? "border-amber-200 bg-amber-50 text-amber-700"
                          : "border-emerald-200 bg-emerald-50 text-emerald-700"
                    }`}
                  >
                    {!isPresent
                      ? t("غائب", "Absent")
                      : isLate
                        ? t("متأخر", "Late")
                        : t("في الموعد", "On-Time")}
                  </span>
                </div>

                {/* Visual Shift Progress Bar */}
                <div className="mt-3.5 rounded-xl border border-zinc-100 bg-zinc-50/70 p-2.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span
                      className={`font-semibold ${
                        isActiveInShift
                          ? "text-emerald-600"
                          : isPresent
                            ? "text-blue-600"
                            : "text-zinc-400"
                      }`}
                    >
                      {isActiveInShift
                        ? t("متصل بالوردية الآن", "Active in shift")
                        : isPresent
                          ? t("أنهى الشيفت / استراحة", "Clocked out")
                          : t("لم يسجل حضور اليوم", "Not clocked in")}
                    </span>
                    <span className="font-code font-bold tabular-nums text-zinc-900">
                      {workedHours}h / {stdHours}h
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-200/70">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        workedHours > stdHours
                          ? "bg-violet-500"
                          : isActiveInShift
                            ? "bg-emerald-500"
                            : "bg-blue-500"
                      }`}
                      style={{ width: `${shiftPct}%` }}
                    />
                  </div>
                </div>

                <div className="mt-3 space-y-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500">{t("تاريخ التعيين:", "Joined Company:")}</span>
                    <button
                      type="button"
                      onClick={() => setOnboardModalWorker(w)}
                      className={`font-code font-semibold underline cursor-pointer ${
                        w.hireDate ? "text-zinc-800" : "text-amber-600"
                      }`}
                    >
                      {w.hireDate || t("حدد تاريخ التعيين", "Set join date")}
                    </button>
                  </div>
                  {clockInTs?.toDate && (
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-500">{t("وقت الحضور:", "Clock-in Time:")}</span>
                      <strong className="font-code text-zinc-900">
                        {clockInTs.toDate().toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </strong>
                    </div>
                  )}
                </div>
              </div>

              {/* Actions Bar */}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-1.5 border-t border-zinc-100 pt-3">
                <div className="flex flex-wrap items-center gap-1">
                  {w.phone && (
                    <a
                      href={`https://wa.me/${w.phone.replace(/\D/g, "")}`}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg bg-emerald-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-emerald-700"
                    >
                      WhatsApp
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => setOnboardModalWorker(w)}
                    className="rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 text-[10px] font-semibold text-zinc-700 hover:bg-zinc-100 cursor-pointer"
                  >
                    {t("التعيين والراتب", "Join & Rate")}
                  </button>
                  <button
                    type="button"
                    onClick={() => openAdjustmentFor(w.id, "deduction")}
                    className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-[10px] font-semibold text-red-700 hover:bg-red-600 hover:text-white cursor-pointer transition-colors"
                  >
                    {t("جزاء / خصم", "Penalty")}
                  </button>
                  <button
                    type="button"
                    onClick={() => openAdjustmentFor(w.id, "bonus")}
                    className="rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-600 hover:text-white cursor-pointer transition-colors"
                  >
                    {t("بونص", "Bonus")}
                  </button>
                </div>

                <div className="flex items-center gap-1.5">
                  {!isPresent && (
                    <button
                      type="button"
                      onClick={() => setExcuseModalWorker(w)}
                      className="rounded-lg bg-amber-500 px-2 py-1 text-[10px] font-semibold text-white hover:bg-amber-600 cursor-pointer"
                    >
                      {t("+ تسجيل عذر", "+ Excuse")}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setPayslipModalWorker(w)}
                    className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-[10px] font-semibold text-zinc-700 hover:bg-zinc-50 cursor-pointer"
                  >
                    {t("كشف الراتب", "Payslip")}
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
