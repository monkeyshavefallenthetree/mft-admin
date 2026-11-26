"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { collection, doc, onSnapshot, serverTimestamp, updateDoc } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { sessionHours } from "@/lib/admin/workTime";
import { cairoYmd } from "@/lib/admin/cairoTime";
import { evaluateShiftLifecycle } from "@/lib/admin/shiftLifecycle";
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
  saveHrSettings,
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
import { effectiveLeaveDaysForRequest } from "@/lib/admin/hrPolicy2026";
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
  const [workersLoaded, setWorkersLoaded] = useState(false);

  const [sessions, setSessions] = useState<WorkSession[]>([]);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [liveNowMs, setLiveNowMs] = useState(() => Date.now());

  const cleanedStaleOnlineRef = useRef<Set<string>>(new Set());
  const cleanedStaleSessionsRef = useRef<Set<string>>(new Set());

  const [tasks, setTasks] = useState<TaskDoc[]>([]);

  const [alerts, setAlerts] = useState<AlertDoc[]>([]);

  const [settings, setSettings] = useState<HrSettings>(DEFAULT_HR_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  const [holidays, setHolidays] = useState<HolidayItem[]>([]);

  const [adjustments, setAdjustments] = useState<PayrollAdjustment[]>([]);

  const [cycleRecords, setCycleRecords] = useState<Record<string, PayrollCycleRecord>>({});

  const [ledger, setLedger] = useState<PermissionLedgerDoc[]>([]);

  const [approvedRequests, setApprovedRequests] = useState<ApprovedRequestRow[]>([]);
  const [approvedRequestsLoaded, setApprovedRequestsLoaded] = useState(false);

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
      setWorkersLoaded(true);
    });
  }, [refreshTick]);

  useEffect(() => {
    return onSnapshot(collection(db, "workSessions"), (snap) => {
      const list: WorkSession[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() } as WorkSession));
      setSessions(list);
      setSessionsLoaded(true);
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
      snap.forEach((d) => {
        const data = d.data();
        // Exclude internal system push subscription & fallback admin notification docs from HR AlertsTab UI
        if (data.type === "admin_push_sub" || data.adminNotif === true) return;
        list.push({ id: d.id, ...data } as AlertDoc);
      });
      list.sort((a, b) => (b.sentAt?.toDate?.()?.getTime() ?? 0) - (a.sentAt?.toDate?.()?.getTime() ?? 0));
      setAlerts(list);
    });
  }, [refreshTick]);

  // HR Settings & Holidays subscriptions
  useEffect(() => {
    let mirroredOnce = false;
    return subscribeHrSettings((s) => {
      setSettings(s);
      setSettingsLoaded(true);
      const sWithMeta = s as HrSettings & { _mirrorUpdatedAtMs?: number };
      if (!mirroredOnce && (s.officeNetworks?.length ?? 0) > 0 && !sWithMeta._mirrorUpdatedAtMs) {
        mirroredOnce = true;
        saveHrSettings(s, adminEmail).catch(() => {});
      }
    });
  }, [adminEmail, refreshTick]);

  useEffect(() => subscribeHolidays((h) => setHolidays(h)), [adminEmail, refreshTick]);

  useEffect(() => subscribePayrollAdjustments((a) => setAdjustments(a)), [adminEmail, refreshTick]);

  useEffect(() => subscribePayrollCycles((c) => setCycleRecords(c)), [adminEmail, refreshTick]);

  // HR-POL-2026 data
  useEffect(() => subscribePermissionLedger(setLedger), [adminEmail, refreshTick]);

  useEffect(
    () =>
      subscribeApprovedPolicyRequests((rows) => {
        setApprovedRequests(rows);
        setApprovedRequestsLoaded(true);
      }),
    [adminEmail, refreshTick],
  );

  useEffect(() => subscribeReimbursements(setReimbursements), [adminEmail, refreshTick]);

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

  // Unique cycle ID for status tracking (Cairo timezone, never UTC-shifted)
  const currentCycleId = useMemo(() => {
    const s = cairoYmd(activePeriod.start);
    const e = cairoYmd(activePeriod.end);
    return `cycle_${s}_${e}`;
  }, [activePeriod]);

  const currentCycleStatus = useMemo(() => {
    return cycleRecords[currentCycleId]?.status || "draft";
  }, [cycleRecords, currentCycleId]);

  const todayHoliday = useMemo(() => {
    return isDateHoliday(today, holidays);
  }, [today, holidays]);

  const todaysSessions = useMemo(() => {
    return sessions.filter(
      (s) =>
        sessionDateYmd(s) === today &&
        Boolean(s.workerId) &&
        (Boolean(s.loginTime) || Boolean(s.startTime) || (s.totalWorkTime ?? 0) > 0),
    );
  }, [sessions, today]);

  // A worker is Present Today ONLY if they actually clocked in and created a workSession today.
  // Never mark a worker as present based on a stale `w.isOnline` flag on their profile document.
  const presentWorkerIds = useMemo(() => {
    const set = new Set<string>();
    for (const s of todaysSessions) if (s.workerId) set.add(s.workerId);
    return set;
  }, [todaysSessions]);

  const activeShiftWorkerIds = useMemo(() => {
    const set = new Set<string>();
    for (const s of todaysSessions) {
      if (s.workerId && s.isActive && !s.isExternalMission && (s.loginTime || s.startTime)) {
        set.add(s.workerId);
      }
    }
    return set;
  }, [todaysSessions]);

  // Refresh live running shift hours every 30 seconds while any worker has an active shift today
  useEffect(() => {
    if (activeShiftWorkerIds.size === 0) return;
    const id = window.setInterval(() => setLiveNowMs(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [activeShiftWorkerIds.size]);

  const approvedOtByKey = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of approvedRequests) {
      if (r.type !== "overtime" || !r.workerId || !r.exceptionDate) continue;
      const mins = Number(r.lateMinutes ?? r.overtimeMinutes ?? 0) || 0;
      if (mins > 0) {
        const key = `${r.workerId}|${r.exceptionDate}`;
        map.set(key, (map.get(key) ?? 0) + mins);
      }
    }
    return map;
  }, [approvedRequests]);

  const approvedTodayOtByWorker = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of approvedRequests) {
      if (r.type !== "overtime" || !r.workerId || r.exceptionDate !== today) continue;
      const mins = Number(r.lateMinutes ?? r.overtimeMinutes ?? 0) || 0;
      if (mins > 0) {
        map.set(r.workerId, (map.get(r.workerId) ?? 0) + mins);
      }
    }
    return map;
  }, [approvedRequests, today]);

  // Auto-heal stale `isOnline: true` flags AND close unclosed past-day `workSessions` cleanly
  useEffect(() => {
    if (!workersLoaded || !sessionsLoaded) return;
    for (const w of workers) {
      if (w.isOnline && !activeShiftWorkerIds.has(w.id) && !cleanedStaleOnlineRef.current.has(w.id)) {
        cleanedStaleOnlineRef.current.add(w.id);
        updateDoc(doc(db, "workers", w.id), {
          isOnline: false,
          presenceStatus: "offline",
        }).catch(() => {});
      } else if (w.isOnline && activeShiftWorkerIds.has(w.id)) {
        cleanedStaleOnlineRef.current.delete(w.id);
      }
    }

    // Wait until BOTH approved overtime requests AND HR settings have resolved before
    // closing stale past-day sessions so approved overtime is never prematurely wiped to 0.
    if (!approvedRequestsLoaded || !settingsLoaded) return;

    const nowMs = Date.now();
    for (const s of sessions) {
      if (!s.isActive || s.isExternalMission || !s.id) continue;
      const dKey = sessionDateYmd(s);
      if (!dKey || dKey >= today || cleanedStaleSessionsRef.current.has(s.id)) continue;
      cleanedStaleSessionsRef.current.add(s.id);
      const pastApprovedOt = s.workerId ? (approvedOtByKey.get(`${s.workerId}|${dKey}`) ?? 0) : 0;
      const lifecycle = evaluateShiftLifecycle(
        { ...s, overtimeMinutes: pastApprovedOt, allowedShiftMs: undefined },
        {
          nowMs,
          todayCairoYmd: today,
          standardHours: settings.standardHours || 8,
          overtimeMinutes: pastApprovedOt,
          policySettings: settings,
        },
      );
      if (lifecycle.action === "auto_clock_out") {
        const cappedLogout = new Date(lifecycle.cappedLogoutMs ?? lifecycle.shiftLimitAtMs);
        const cappedTotal = lifecycle.cappedTotalWorkTimeMs ?? lifecycle.allowedMs;
        updateDoc(doc(db, "workSessions", s.id), {
          isActive: false,
          logoutTime: cappedLogout,
          endTime: cappedLogout,
          segmentStartAt: null,
          overtimeMinutes: pastApprovedOt,
          allowedShiftMs: lifecycle.allowedMs,
          bankedWorkTime: cappedTotal,
          totalWorkTime: cappedTotal,
          presenceStatus: "offline",
          autoClockedOut: true,
          autoClockOutReason: lifecycle.autoClockOutReason || "past_day_unclosed",
          autoClockedOutAt: serverTimestamp(),
          autoClockOutNotifiedAt: serverTimestamp(),
          lastUpdated: serverTimestamp(),
        }).catch(() => {});
      }
    }
  }, [
    workersLoaded,
    sessionsLoaded,
    approvedRequestsLoaded,
    settingsLoaded,
    workers,
    sessions,
    activeShiftWorkerIds,
    today,
    settings,
    approvedOtByKey,
  ]);

  // Evaluate lateness ONLY against each worker's earliest clock-in of the day
  const lateWorkerIds = useMemo(() => {
    const earliestByWorker = new Map<string, { ms: number; session: WorkSession }>();
    for (const s of todaysSessions) {
      if (!s.workerId || s.isExternalMission) continue;
      const startD = s.startTime?.toDate?.() ?? s.loginTime?.toDate?.();
      if (!startD) continue;
      const ms = startD.getTime();
      const cur = earliestByWorker.get(s.workerId);
      if (!cur || ms < cur.ms) {
        earliestByWorker.set(s.workerId, { ms, session: s });
      }
    }
    const set = new Set<string>();
    for (const [wId, entry] of earliestByWorker.entries()) {
      if (isLateTodayHtml(entry.session, settings)) set.add(wId);
    }
    return set;
  }, [todaysSessions, settings]);

  const overtimeWorkerIds = useMemo(() => {
    const hoursByWorker = new Map<string, number>();
    const std = settings.standardHours || 8;
    for (const s of todaysSessions) {
      if (!s.workerId || s.isExternalMission) continue;
      const approvedOtMins = approvedTodayOtByWorker.get(s.workerId) ?? 0;
      hoursByWorker.set(
        s.workerId,
        (hoursByWorker.get(s.workerId) ?? 0) +
          sessionHours(s, liveNowMs, { standardHours: std, approvedOvertimeMinutes: approvedOtMins }),
      );
    }
    const set = new Set<string>();
    for (const [wId, hrs] of hoursByWorker.entries()) {
      if ((approvedTodayOtByWorker.get(wId) ?? 0) > 0 && hrs > std) set.add(wId);
    }
    return set;
  }, [todaysSessions, settings.standardHours, liveNowMs, approvedTodayOtByWorker]);

  // Today KPI Metrics
  const hrSummary = useMemo(() => {
    const expectedWorkers = approved.length;
    const presentToday = presentWorkerIds.size;
    const absentToday = Math.max(0, expectedWorkers - presentToday);
    const lateToday = lateWorkerIds.size;
    const overtimeToday = overtimeWorkerIds.size;
    const attendanceRate = expectedWorkers > 0 ? Math.round((presentToday / expectedWorkers) * 100) : 0;
    const std = settings.standardHours || 8;
    const payrollHoursToday = todaysSessions.reduce(
      (sum, s) =>
        sum +
        sessionHours(s, liveNowMs, {
          standardHours: std,
          approvedOvertimeMinutes: s.workerId ? (approvedTodayOtByWorker.get(s.workerId) ?? 0) : 0,
        }),
      0,
    );

    return {
      presentToday,
      absentToday,
      lateToday,
      overtimeToday,
      attendanceRate,
      payrollHoursToday: Math.round(payrollHoursToday * 10) / 10,
    };
  }, [
    approved.length,
    presentWorkerIds.size,
    lateWorkerIds.size,
    overtimeWorkerIds.size,
    todaysSessions,
    settings.standardHours,
    liveNowMs,
    approvedTodayOtByWorker,
  ]);

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
      const s = cairoYmd(start);
      const e = cairoYmd(end);
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
      const fallbackStart = w.createdAt?.toDate ? cairoYmd(w.createdAt.toDate()) : null;
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
          .map((r) => ({ date: r.exceptionDate, minutes: Number(r.lateMinutes ?? r.overtimeMinutes ?? 0) || 0 })),
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
    const startYmd = cairoYmd(start);
    const endYmd = cairoYmd(end);
    return approved.map((w) => {
      const ws = workerSessionsInRange(sessions, w.id, start, end);
      const workerAdj = adjustments.filter((a) => {
        if (a.workerId !== w.id) return false;
        const d = a.date;
        return d >= startYmd && d <= endYmd;
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
    liveNowMs,
    activeCycle,
    activePeriod,
    currentCycleId,
    currentCycleStatus,
    todayHoliday,
    todaysSessions,
    presentWorkerIds,
    activeShiftWorkerIds,
    lateWorkerIds,
    overtimeWorkerIds,
    approvedOtByKey,
    approvedTodayOtByWorker,
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
