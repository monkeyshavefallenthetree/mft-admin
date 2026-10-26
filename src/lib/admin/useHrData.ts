"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { sessionHours } from "@/lib/admin/workTime";
import {
  type HrSettings,
  type HolidayItem,
  type PayrollAdjustment,
  DEFAULT_HR_SETTINGS,
  computePayrollForWorker,
  getPayrollCycleRange,
  getHrDateRange,
  isDateHoliday,
  isLateTodayHtml,
  sessionDateYmd,
  workerSessionsInRange,
} from "@/lib/admin/hrReports";
import {
  subscribeHrSettings,
  subscribeHolidays,
  subscribePayrollAdjustments,
  subscribePayrollCycles,
  subscribePermissionLedger,
  subscribeApprovedPolicyRequests,
  mergeLedgerWithApprovedRequests,
  subscribeReimbursements,
  type PayrollCycleRecord,
  type PermissionLedgerDoc,
  type ApprovedRequestRow,
  type ReimbursementDoc,
} from "@/lib/admin/hrSettings";
import { effectiveLeaveDaysForRequest, ymd as localYmd } from "@/lib/admin/hrPolicy2026";
import type { Worker, WorkSession, TaskDoc, AlertDoc } from "@/lib/admin/hrPageTypes";
import { todayYmd, assignedIds } from "@/components/admin/hr/hrPageUtils";

/**
 * All live HR dashboard data (Firestore subscriptions) plus derived attendance & payroll figures.
 * Extracted verbatim from the HR page so tabs can share it.
 */
export function useHrData({
  refreshTick,
  rangeKey,
  customStart,
  customEnd,
}: {
  refreshTick: number;
  rangeKey: string;
  customStart: Date;
  customEnd: Date;
}) {
  const [adminEmail, setAdminEmail] = useState("admin");

  const [workers, setWorkers] = useState<Worker[]>([]);

  const [sessions, setSessions] = useState<WorkSession[]>([]);

  const [tasks, setTasks] = useState<TaskDoc[]>([]);

  const [alerts, setAlerts] = useState<AlertDoc[]>([]);

  const [settings, setSettings] = useState<HrSettings>(DEFAULT_HR_SETTINGS);

  const [holidays, setHolidays] = useState<HolidayItem[]>([]);

  const [adjustments, setAdjustments] = useState<PayrollAdjustment[]>([]);

  const [cycleRecords, setCycleRecords] = useState<Record<string, PayrollCycleRecord>>({});

  const [ledger, setLedger] = useState<PermissionLedgerDoc[]>([]);

  const [approvedRequests, setApprovedRequests] = useState<ApprovedRequestRow[]>([]);

  const [reimbursements, setReimbursements] = useState<ReimbursementDoc[]>([]);

  // Auth
  useEffect(() => {
    return onAuthStateChanged(auth, (user) => {
      setAdminEmail(user?.email || "admin");
    });
  }, []);

  // Subscriptions
  useEffect(() => {
    return onSnapshot(collection(db, "workers"), (snap) => {
      const list: Worker[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() } as Worker));
      setWorkers(list);
    });
  }, [refreshTick]);

  useEffect(() => {
    return onSnapshot(collection(db, "workSessions"), (snap) => {
      const list: WorkSession[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() } as WorkSession));
      setSessions(list);
    });
  }, [refreshTick]);

  useEffect(() => {
    return onSnapshot(collection(db, "tasks"), (snap) => {
      const list: TaskDoc[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() } as TaskDoc));
      setTasks(list);
    });
  }, [refreshTick]);

  useEffect(() => {
    return onSnapshot(collection(db, "alerts"), (snap) => {
      const list: AlertDoc[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() } as AlertDoc));
      list.sort((a, b) => (b.sentAt?.toDate?.()?.getTime() ?? 0) - (a.sentAt?.toDate?.()?.getTime() ?? 0));
      setAlerts(list);
    });
  }, [refreshTick]);

  // HR Settings & Holidays subscriptions
  useEffect(() => subscribeHrSettings((s) => setSettings(s)), []);

  useEffect(() => subscribeHolidays((h) => setHolidays(h)), []);

  useEffect(() => subscribePayrollAdjustments((a) => setAdjustments(a)), []);

  useEffect(() => subscribePayrollCycles((c) => setCycleRecords(c)), []);

  // HR-POL-2026 data
  useEffect(() => subscribePermissionLedger(setLedger), []);

  useEffect(() => subscribeApprovedPolicyRequests(setApprovedRequests), []);

  useEffect(() => subscribeReimbursements(setReimbursements), []);

  const effectiveLedger = useMemo(
    () =>
      mergeLedgerWithApprovedRequests(
        ledger,
        approvedRequests,
        settings.permissionMinMinutes ?? 30,
        settings.permissionMaxSingleMinutes ?? 120,
      ),
    [ledger, approvedRequests, settings.permissionMinMinutes, settings.permissionMaxSingleMinutes],
  );

  const approved = useMemo(() => workers.filter((w) => w.status === "approved"), [workers]);

  const today = todayYmd();

  // Active Date Range Resolution
  const activeCycle = useMemo(() => {
    return getPayrollCycleRange(new Date(), settings.monthStartDay);
  }, [settings.monthStartDay]);

  const activePeriod = useMemo(() => {
    if (rangeKey === "cycle") return activeCycle;
    if (rangeKey === "prev-cycle") {
      const prevDate = new Date();
      prevDate.setDate(prevDate.getDate() - 32);
      return getPayrollCycleRange(prevDate, settings.monthStartDay);
    }
    if (rangeKey === "month") {
      return getPayrollCycleRange(new Date(), 1);
    }
    if (rangeKey === "week") {
      const res = getHrDateRange("week", settings);
      return { start: res.start, end: res.end, label: "Last 7 Days" };
    }
    return {
      start: customStart,
      end: customEnd,
      label: `Custom (${customStart.toLocaleDateString()} - ${customEnd.toLocaleDateString()})`,
    };
  }, [rangeKey, activeCycle, settings, customStart, customEnd]);

  // Unique cycle ID for status tracking
  const currentCycleId = useMemo(() => {
    const s = activePeriod.start.toISOString().split("T")[0];
    const e = activePeriod.end.toISOString().split("T")[0];
    return `cycle_${s}_${e}`;
  }, [activePeriod]);

  const currentCycleStatus = useMemo(() => {
    return cycleRecords[currentCycleId]?.status || "draft";
  }, [cycleRecords, currentCycleId]);

  const todayHoliday = useMemo(() => {
    return isDateHoliday(today, holidays);
  }, [today, holidays]);

  const todaysSessions = useMemo(() => {
    return sessions.filter((s) => sessionDateYmd(s) === today);
  }, [sessions, today]);

  const presentWorkerIds = useMemo(() => {
    const set = new Set<string>();
    for (const s of todaysSessions) if (s.workerId) set.add(s.workerId);
    for (const w of approved) if (w.isOnline) set.add(w.id);
    return set;
  }, [todaysSessions, approved]);

  const lateWorkerIds = useMemo(() => {
    const set = new Set<string>();
    for (const s of todaysSessions) {
      if (s.workerId && isLateTodayHtml(s, settings)) set.add(s.workerId);
    }
    return set;
  }, [todaysSessions, settings]);

  const overtimeWorkerIds = useMemo(() => {
    const set = new Set<string>();
    for (const s of todaysSessions) {
      if (s.workerId && sessionHours(s) > (settings.standardHours || 8)) set.add(s.workerId);
    }
    return set;
  }, [todaysSessions, settings.standardHours]);

  // Today KPI Metrics
  const hrSummary = useMemo(() => {
    const expectedWorkers = approved.length;
    const presentToday = presentWorkerIds.size;
    const absentToday = Math.max(0, expectedWorkers - presentToday);
    const lateToday = lateWorkerIds.size;
    const overtimeToday = overtimeWorkerIds.size;
    const attendanceRate = expectedWorkers > 0 ? Math.round((presentToday / expectedWorkers) * 100) : 0;
    const payrollHoursToday = todaysSessions.reduce((sum, s) => sum + sessionHours(s), 0);

    return {
      presentToday,
      absentToday,
      lateToday,
      overtimeToday,
      attendanceRate,
      payrollHoursToday: Math.round(payrollHoursToday * 10) / 10,
    };
  }, [approved.length, presentWorkerIds.size, lateWorkerIds.size, overtimeWorkerIds.size, todaysSessions]);

  const workerTaskStats = useMemo(() => {
    const m = new Map<string, { completed: number; total: number }>();
    for (const tsk of tasks) {
      for (const id of assignedIds(tsk)) {
        const cur = m.get(id) || { completed: 0, total: 0 };
        cur.total += 1;
        if (tsk.status === "completed") cur.completed += 1;
        m.set(id, cur);
      }
    }
    return m;
  }, [tasks]);

  /** Builds the HR-POL-2026 payroll inputs (ledger + approved OT + onboarding start date + paid/unpaid leave) for one worker and period. */
  const policyInputsFor = useCallback(
    (w: Worker, start: Date, end: Date) => {
      const workerId = w.id;
      const s = localYmd(start);
      const e = localYmd(end);
      const leaveReqs = approvedRequests.filter(
        (r) =>
          r.workerId === workerId &&
          (r.type === "annual_leave" ||
            r.type === "unpaid_leave" ||
            r.type === "sick_leave" ||
            r.type === "emergency_leave" ||
            r.type === "absence" ||
            r.type === "absent") &&
          r.exceptionDate >= s &&
          r.exceptionDate <= e,
      );
      const wknd = settings.weekendDays || [5, 6];
      const unpaidLeaveDays = leaveReqs
        .filter((r) => r.type === "unpaid_leave" || r.leaveType === "unpaid")
        .reduce((sum, r) => sum + effectiveLeaveDaysForRequest(r, wknd, holidays), 0);
      const paidLeaveDays = leaveReqs
        .filter((r) => r.type !== "unpaid_leave" && r.leaveType !== "unpaid")
        .reduce((sum, r) => sum + effectiveLeaveDaysForRequest(r, wknd, holidays), 0);
      const approvedLeaveDays = paidLeaveDays + unpaidLeaveDays;
      const fallbackStart = w.createdAt?.toDate ? localYmd(w.createdAt.toDate()) : null;
      return {
        permissionLedger: effectiveLedger.filter((l) => l.workerId === workerId && l.date >= s && l.date <= e),
        approvedOvertime: approvedRequests
          .filter(
            (r) =>
              r.workerId === workerId &&
              r.type === "overtime" &&
              r.exceptionDate >= s &&
              r.exceptionDate <= e,
          )
          .map((r) => ({ date: r.exceptionDate, minutes: Number(r.lateMinutes) || 0 })),
        approvedLeaveDays,
        paidLeaveDays,
        unpaidLeaveDays,
        workerStartDate: w.attendanceStartDate || w.hireDate || fallbackStart,
        capAtToday: true,
      };
    },
    [effectiveLedger, approvedRequests, settings.weekendDays, holidays],
  );

  // Comprehensive Payroll Calculations for Active Period
  const payrollTableData = useMemo(() => {
    const { start, end } = activePeriod;
    return approved.map((w) => {
      const ws = workerSessionsInRange(sessions, w.id, start, end);
      const workerAdj = adjustments.filter((a) => {
        if (a.workerId !== w.id) return false;
        const d = a.date;
        return d >= start.toISOString().split("T")[0] && d <= end.toISOString().split("T")[0];
      });

      const p = computePayrollForWorker(ws, w.hourlyRate || settings.defaultHourlyRate || 31.25, start, end, {
        weekendDays: settings.weekendDays,
        holidays,
        settings,
        adjustments: workerAdj,
        ...policyInputsFor(w, start, end),
      });

      return {
        worker: w,
        payroll: p,
        adjustments: workerAdj,
      };
    });
  }, [approved, activePeriod, sessions, adjustments, settings, holidays, policyInputsFor]);

  // Overall Payroll Totals
  const payrollTotals = useMemo(() => {
    let gross = 0;
    let net = 0;
    let overtime = 0;
    let bonuses = 0;
    let manualDeductions = 0;
    let attendanceDeductions = 0;
    let deductions = 0;
    let advances = 0;

    for (const row of payrollTableData) {
      gross +=
        row.payroll.basePay +
        row.payroll.overtimePay +
        row.payroll.allowances +
        row.payroll.manualBonuses;
      net += row.payroll.netPayable;
      overtime += row.payroll.overtimePay;
      bonuses += row.payroll.manualBonuses + row.payroll.allowances;
      manualDeductions += row.payroll.manualDeductions;
      const attDed =
        row.payroll.absencePenalty +
        row.payroll.totalLatePenaltyEgp +
        row.payroll.shortfallDeduction;
      attendanceDeductions += attDed;
      deductions += attDed + row.payroll.manualDeductions;
      advances += row.payroll.salaryAdvances;
    }

    return {
      gross: Math.round(gross),
      net: Math.round(net),
      overtime: Math.round(overtime),
      bonuses: Math.round(bonuses),
      manualDeductions: Math.round(manualDeductions),
      attendanceDeductions: Math.round(attendanceDeductions),
      deductions: Math.round(deductions),
      advances: Math.round(advances),
    };
  }, [payrollTableData]);

  const missingHireCount = useMemo(() => approved.filter((w) => !w.hireDate).length, [approved]);

  const pendingExpensesCount = useMemo(
    () => reimbursements.filter((r) => r.stage === "pre_approval" || r.stage === "review").length,
    [reimbursements],
  );

  return {
    adminEmail,
    workers,
    sessions,
    tasks,
    alerts,
    settings,
    holidays,
    adjustments,
    cycleRecords,
    ledger,
    approvedRequests,
    reimbursements,
    effectiveLedger,
    approved,
    today,
    activeCycle,
    activePeriod,
    currentCycleId,
    currentCycleStatus,
    todayHoliday,
    todaysSessions,
    presentWorkerIds,
    lateWorkerIds,
    overtimeWorkerIds,
    hrSummary,
    workerTaskStats,
    policyInputsFor,
    payrollTableData,
    payrollTotals,
    missingHireCount,
    pendingExpensesCount,
  };
}

export type HrData = ReturnType<typeof useHrData>;
