"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import {
  collection,
  onSnapshot,
  addDoc,
  deleteDoc,
  doc,
  serverTimestamp,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { downloadCsv } from "@/lib/admin/csv";
import { DEPARTMENTS } from "@/lib/admin/constants";
import { sessionHours } from "@/lib/admin/workTime";
import {
  type SessionForHr,
  type HrSettings,
  type HolidayItem,
  type PayrollAdjustment,
  DEFAULT_HR_SETTINGS,
  computePayrollForWorker,
  formatDepartment,
  formatEmploymentType,
  getPayrollCycleRange,
  getHrDateRange,
  isDateHoliday,
  isLateTodayHtml,
  performanceRating,
  productivityScore,
  sessionDateYmd,
  workerSessionsInRange,
} from "@/lib/admin/hrReports";
import {
  subscribeHrSettings,
  subscribeHolidays,
  subscribePayrollAdjustments,
  subscribePayrollCycles,
  setPayrollCycleStatus,
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
import { useHrLang } from "@/lib/admin/hrI18n";
import Link from "next/link";
import { toast, confirmDialog } from "@/lib/admin/feedback";
import { logActivity } from "@/lib/admin/activity";
import { sendExpoPushToWorkers } from "@/lib/chatNotifications";
import { notifyAdmins } from "@/lib/adminNotifications";
import { useUrlState } from "@/lib/admin/useUrlState";
import ModalPortal from "@/components/admin/ui/ModalPortal";
import HrPolicyModal from "@/components/admin/hr/HrPolicyModal";
import HrHolidaysManager from "@/components/admin/hr/HrHolidaysManager";
import HrPayslipModal from "@/components/admin/hr/HrPayslipModal";
import HrAdjustmentModal from "@/components/admin/hr/HrAdjustmentModal";
import HrDateRangeSelector from "@/components/admin/hr/HrDateRangeSelector";
import HrExcuseModal from "@/components/admin/hr/HrExcuseModal";
import HrComplianceView from "@/components/admin/hr/HrComplianceView";
import WorkerLeaveProfileCard from "@/components/admin/hr/WorkerLeaveProfileCard";

interface Worker {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  role: string;
  status: string;
  department?: string;
  employmentType?: string;
  skills?: string[];
  isOnline?: boolean;
  hourlyRate?: number;
  expectedSalary?: number | string;
  expectedHours?: number;
  emergencyContact?: string | Record<string, string>;
  lastLogin?: { toDate: () => Date };
  hireDate?: string;
  attendanceStartDate?: string;
  leaveLawType?: "new_15" | "legacy_21";
  priorUsedLeaveDays?: number;
  carriedOverLeaveDays?: number;
  carryOverApprovedBy?: string;
  createdAt?: { toDate: () => Date };
}

interface WorkSession extends SessionForHr {
  id: string;
  workerName?: string;
  isLate?: boolean;
  department?: string;
  isActive?: boolean;
}

interface TaskDoc {
  id: string;
  title: string;
  status: string;
  priority?: string;
  assignedTo?: string | string[];
  projectName?: string;
  createdAt?: { toDate: () => Date };
}

interface AlertDoc {
  id: string;
  type?: string;
  title?: string;
  message?: string;
  recipient?: string;
  department?: string;
  workerId?: string;
  priority?: string;
  penalty?: string;
  penaltyReason?: string;
  recipients?: string[];
  sentBy?: string;
  sentAt?: { toDate: () => Date };
  createdAt?: { toDate: () => Date };
  recipientCount?: number;
  isRead?: boolean;
  hasPenalty?: boolean;
  penaltyApplied?: number;
  readBy?: string[];
  resent?: boolean;
  originalAlertId?: string;
}

function todayYmd() {
  return new Date().toISOString().split("T")[0];
}

function workerName(w: Worker) {
  return `${w.firstName || ""} ${w.lastName || ""}`.trim() || "Worker";
}

function formatTs(t: { toDate: () => Date } | undefined) {
  if (!t?.toDate) return "—";
  return t.toDate().toLocaleString();
}

function assignedIds(task: TaskDoc): string[] {
  const a = task.assignedTo;
  if (Array.isArray(a)) return a;
  return a ? [a] : [];
}

const EMPLOYMENT_OPTIONS = [
  { value: "full-time", ar: "دوام كامل (Full-time)", en: "Full-time" },
  { value: "part-time", ar: "دوام جزئي (Part-time)", en: "Part-time" },
  { value: "contract", ar: "عقد (Contract)", en: "Contract" },
  { value: "intern", ar: "تدريب (Intern)", en: "Intern" },
];

const HR_NAV_TABS = [
  {
    key: "overview",
    ar: "١. حضور اليوم",
    en: "1. Today's Attendance",
    icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
  },
  {
    key: "compliance",
    ar: "٢. التعيين والأذونات والإجازات",
    en: "2. Joining Dates, Permissions & Leave",
    icon: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z",
  },
  {
    key: "payroll",
    ar: "٣. الرواتب وكشوف المرتبات",
    en: "3. Payroll & Payslips",
    icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  },
  {
    key: "holidays",
    ar: "٤. العطلات الرسمية واللائحة",
    en: "4. Holidays & Policy",
    icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
  },
  {
    key: "team",
    ar: "٥. تقييم أداء الفريق",
    en: "5. Team Performance",
    icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z",
  },
  {
    key: "alerts",
    ar: "٦. التنبيهات والتعاميم",
    en: "6. Alerts & Notices",
    icon: "M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9",
  },
];

function SvgI({ d, className = "h-4 w-4" }: { d: string; className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

export default function AdminHRPage() {
  const { isAr, dir, toggleLang, t } = useHrLang();
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
  const [refreshTick, setRefreshTick] = useState(0);

  // Modals
  const [sendOpen, setSendOpen] = useState(false);
  const [policyModalOpen, setPolicyModalOpen] = useState(false);
  const [adjustmentModalOpen, setAdjustmentModalOpen] = useState(false);
  const [excuseModalWorker, setExcuseModalWorker] = useState<Worker | null>(null);
  const [payslipModalWorker, setPayslipModalWorker] = useState<Worker | null>(null);
  const [dashboardWorker, setDashboardWorker] = useState<Worker | null>(null);
  const [onboardModalWorker, setOnboardModalWorker] = useState<Worker | null>(null);

  // Navigation & Search State
  const [section, setSection] = useUrlState("tab", "overview");
  const [workerSearch, setWorkerSearch] = useUrlState("q");
  const [departmentFilter, setDepartmentFilter] = useUrlState("dept");
  const [employmentFilter, setEmploymentFilter] = useUrlState("type");
  const [todayFilter, setTodayFilter] = useState<"all" | "present" | "absent" | "late" | "overtime">("all");

  // Date Range and Cycle Selection State
  const [rangeKey, setRangeKey] = useState<string>("cycle");
  const [customStart, setCustomStart] = useState<Date>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d;
  });
  const [customEnd, setCustomEnd] = useState<Date>(() => new Date());

  // Alert Form
  const [alertForm, setAlertForm] = useState({
    type: "",
    title: "",
    message: "",
    recipient: "all",
    department: "",
    workerId: "",
    priority: "medium",
  });

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

  const filteredTodayWorkers = useMemo(() => {
    return approved.filter((w) => {
      const isPresent = presentWorkerIds.has(w.id);
      const isLate = lateWorkerIds.has(w.id);
      const isOvertime = overtimeWorkerIds.has(w.id);

      if (todayFilter === "present") return isPresent;
      if (todayFilter === "absent") return !isPresent;
      if (todayFilter === "late") return isLate;
      if (todayFilter === "overtime") return isOvertime;
      return true;
    });
  }, [approved, todayFilter, presentWorkerIds, lateWorkerIds, overtimeWorkerIds]);

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
    let deductions = 0;
    let advances = 0;

    for (const row of payrollTableData) {
      gross += row.payroll.basePay + row.payroll.overtimePay + row.payroll.allowances;
      net += row.payroll.netPayable;
      overtime += row.payroll.overtimePay;
      deductions +=
        row.payroll.absencePenalty +
        row.payroll.totalLatePenaltyEgp +
        row.payroll.shortfallDeduction +
        row.payroll.manualDeductions;
      advances += row.payroll.salaryAdvances;
    }

    return {
      gross: Math.round(gross),
      net: Math.round(net),
      overtime: Math.round(overtime),
      deductions: Math.round(deductions),
      advances: Math.round(advances),
    };
  }, [payrollTableData]);

  const missingHireCount = useMemo(() => approved.filter((w) => !w.hireDate).length, [approved]);
  const pendingExpensesCount = useMemo(
    () => reimbursements.filter((r) => r.stage === "pre_approval" || r.stage === "review").length,
    [reimbursements],
  );

  const exportPayrollCsv = () => {
    const headers = [
      "Employee Name",
      "Employee ID",
      "Department",
      "Role",
      "Company Join Date",
      "Days Worked",
      "Expected Days",
      "Total Hours",
      "Hourly Rate (EGP)",
      "Base Pay (EGP)",
      "Overtime Pay (EGP)",
      "Allowances (EGP)",
      "Absence Deductions (EGP)",
      "Late Penalties (EGP)",
      "Salary Advances (EGP)",
      "Net Payable (EGP)",
    ];

    const rows: (string | number)[][] = [headers];

    for (const row of payrollTableData) {
      rows.push([
        workerName(row.worker),
        row.worker.id,
        formatDepartment(row.worker.department),
        row.worker.role || "Operator",
        row.worker.hireDate || "Not Set",
        row.payroll.daysWorked,
        row.payroll.expectedWorkDays,
        row.payroll.totalHours,
        row.payroll.hourlyRate,
        row.payroll.basePay,
        row.payroll.overtimePay,
        row.payroll.allowances,
        row.payroll.absencePenalty,
        row.payroll.totalLatePenaltyEgp,
        row.payroll.salaryAdvances,
        row.payroll.netPayable,
      ]);
    }

    const s = activePeriod.start.toISOString().split("T")[0];
    const e = activePeriod.end.toISOString().split("T")[0];
    downloadCsv(rows, `payroll_${s}_to_${e}.csv`);
    toast.success(t("تم تحميل شيت الرواتب بصيغة CSV", "Payroll report downloaded"));
  };

  const handleToggleCycleStatus = async (nextStatus: "draft" | "approved" | "paid") => {
    const confirmMessages = {
      approved: t(
        "اعتماد دورة الرواتب الحالية؟ يؤكد ذلك مراجعة الساعات والأذونات والخصومات.",
        "Approve this payroll cycle? This confirms that hours and penalties have been reviewed.",
      ),
      paid: t(
        "تأكيد صرف الرواتب (تم الصرف)؟ سيتم قفل الدورة كمدفوعة.",
        "Mark this payroll as PAID (تم الصرف)? This locks the cycle as disbursed.",
      ),
      draft: t(
        "إعادة دورة الرواتب إلى وضع المسودة (قيد المراجعة)؟",
        "Revert payroll back to Draft review mode?",
      ),
    };

    const ok = await confirmDialog({
      title: t(`تأكيد حالة الرواتب: ${nextStatus.toUpperCase()}`, `Confirm Payroll Status: ${nextStatus.toUpperCase()}`),
      message: confirmMessages[nextStatus],
      confirmLabel: t("تأكيد", `Mark as ${nextStatus.toUpperCase()}`),
    });
    if (!ok) return;

    try {
      const updateData: Partial<PayrollCycleRecord> = {
        cycleLabel: activePeriod.label,
        periodStart: activePeriod.start.toISOString().split("T")[0],
        periodEnd: activePeriod.end.toISOString().split("T")[0],
        status: nextStatus,
        totalGrossPay: payrollTotals.gross,
        totalNetPay: payrollTotals.net,
        totalWorkers: approved.length,
      };

      if (nextStatus === "approved") {
        updateData.approvedAt = { toDate: () => new Date() };
        updateData.approvedBy = adminEmail;
      } else if (nextStatus === "paid") {
        updateData.paidAt = { toDate: () => new Date() };
        updateData.paidBy = adminEmail;
      }

      await setPayrollCycleStatus(currentCycleId, updateData, adminEmail);
      void notifyAdmins(db, {
        targetRoles: ["super_admin", "hr_admin"],
        category: "hr",
        eventType: `payroll_cycle_${nextStatus}`,
        title: `💳 Payroll Cycle ${nextStatus.toUpperCase()}: ${activePeriod.label}`,
        body: `${adminEmail} marked payroll cycle (${activePeriod.label}) as ${nextStatus.toUpperCase()} — Net EGP ${payrollTotals.net}.`,
        href: "/admin/hr?tab=payroll",
        actorUid: auth.currentUser?.uid,
        actorName: adminEmail,
      });
      if (nextStatus === "paid" && approved.length > 0) {
        void sendExpoPushToWorkers(db, {
          recipientUids: approved.map((w) => w.id),
          title: "💳 Monthly Payroll Disbursed",
          body: `Payroll for cycle ${activePeriod.label} has been marked as PAID.`,
          tab: "profile",
        }).catch(() => {});
      }
      toast.success(t("تم تحديث حالة دورة الرواتب", `Payroll cycle marked as ${nextStatus.toUpperCase()}`));
    } catch (err) {
      toast.error(t("فشل تحديث حالة الدورة", "Failed to update cycle status"), {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleSendAlert = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!alertForm.type || !alertForm.title || !alertForm.message) {
      toast.warning(t("يرجى ملء جميع الحقول المطلوبة", "Please fill in required fields"));
      return;
    }

    let recipients: string[] = [];
    if (alertForm.recipient === "all") recipients = approved.map((w) => w.id);
    else if (alertForm.recipient === "department")
      recipients = approved.filter((w) => w.department === alertForm.department).map((w) => w.id);
    else if (alertForm.recipient === "individual") recipients = alertForm.workerId ? [alertForm.workerId] : [];

    try {
      await addDoc(collection(db, "alerts"), {
        type: alertForm.type,
        title: alertForm.title,
        message: alertForm.message,
        recipient: alertForm.recipient,
        department: alertForm.department || "",
        workerId: alertForm.workerId || "",
        priority: alertForm.priority,
        recipients,
        sentBy: adminEmail,
        sentAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        recipientCount: recipients.length,
        isRead: false,
        readBy: [],
      });

      if (recipients.length > 0) {
        void sendExpoPushToWorkers(db, {
          recipientUids: recipients,
          title: `HR Alert: ${alertForm.title}`,
          body: alertForm.message,
          tab: "alerts",
          urgent: alertForm.priority === "high" || alertForm.type === "urgent" || alertForm.type === "penalty",
        });
      }

      void notifyAdmins(db, {
        targetRoles: ["super_admin", "hr_admin"],
        category: "hr",
        eventType: "hr_alert_sent",
        title: `📢 HR Alert Sent: ${alertForm.title}`,
        body: `${adminEmail} sent "${alertForm.title}" to ${recipients.length} worker(s): ${alertForm.message}`,
        href: "/admin/hr?tab=alerts",
        actorUid: auth.currentUser?.uid,
        actorName: adminEmail,
        urgent: alertForm.priority === "high" || alertForm.type === "urgent" || alertForm.type === "penalty",
      });

      void logActivity({
        action: "created",
        entity: "hr",
        label: `Sent alert: ${alertForm.title} to ${recipients.length} workers`,
      });

      toast.success(t("تم إرسال التنبيه للموظفين بنجاح", "Broadcast alert sent"));
      setSendOpen(false);
      setAlertForm({ type: "", title: "", message: "", recipient: "all", department: "", workerId: "", priority: "medium" });
    } catch (err) {
      toast.error(t("فشل إرسال التنبيه", "Failed to send alert"), {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <div dir={dir} className="space-y-5">
      {/* ── Top Header with Prominent Language Toggle & Clear Actions ── */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-700 p-4 rounded-lg shadow-[3px_3px_0px_0px_#09090b]">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-red-600 font-mono">
              {t("// لوحة إدارة الموارد البشرية والرواتب · HR-POL-2026", "// HR OPERATIONS & PAYROLL CENTER · HR-POL-2026")}
            </span>
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-zinc-950 dark:text-white mt-0.5">
            {t("إدارة الموارد البشرية والرواتب", "HR Operations & Payroll")}
          </h2>
          <p className="mt-1 text-xs sm:text-sm text-zinc-500 dark:text-zinc-400">
            {t(
              "متابعة الحضور اليومي، تواريخ تعيين الموظفين، الأذونات الشهرية (4 أذونات/240 د)، الإجازات السنوية، وكشوف الرواتب.",
              "Daily attendance, worker joining dates, monthly permissions (4/240m), annual leave, and automated payroll.",
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 font-mono">
          {/* Language Switcher */}
          <button
            type="button"
            id="hr-lang-toggle"
            onClick={toggleLang}
            className="px-3 py-2 border-2 border-red-600 bg-red-50 dark:bg-red-950/40 hover:bg-red-600 hover:text-white text-red-700 dark:text-red-300 text-xs font-bold cursor-pointer flex items-center gap-1.5 rounded transition-colors"
          >
            <span>🌐</span>
            <span>{isAr ? "English (EN)" : "العربية (AR)"}</span>
          </button>

          <button
            type="button"
            onClick={() => setPolicyModalOpen(true)}
            className="px-3 py-2 border-2 border-zinc-900 dark:border-zinc-700 bg-white dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-950 dark:text-zinc-100 text-xs font-bold cursor-pointer flex items-center gap-1.5 rounded shadow-[2px_2px_0px_0px_#09090b]"
          >
            <span>{t(`⚙️ إعدادات اللائحة (يوم ${settings.monthStartDay})`, `⚙️ Policies (Day ${settings.monthStartDay})`)}</span>
          </button>

          <button
            type="button"
            onClick={() => setAdjustmentModalOpen(true)}
            className="px-3 py-2 border-2 border-zinc-900 dark:border-zinc-700 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 text-emerald-800 dark:text-emerald-300 text-xs font-bold cursor-pointer flex items-center gap-1 rounded shadow-[2px_2px_0px_0px_#059669]"
          >
            <span>{t("+ تسجيل سلفة / مكافأة", "+ Record Advance / Bonus")}</span>
          </button>

          <Link
            href="/admin/reimbursements"
            className="px-3 py-2 border-2 border-zinc-900 dark:border-zinc-700 bg-violet-50 dark:bg-violet-950/40 hover:bg-violet-100 text-violet-800 dark:text-violet-300 text-xs font-bold cursor-pointer flex items-center gap-1 rounded shadow-[2px_2px_0px_0px_#7c3aed]"
          >
            <span>{t(`🚕 المصروفات (${pendingExpensesCount})`, `🚕 Expenses (${pendingExpensesCount})`)}</span>
          </Link>

          <Link
            href="/admin/hr/policy-lab"
            id="hr-open-policy-lab"
            className="px-3 py-2 border-2 border-zinc-900 dark:border-zinc-700 bg-zinc-950 dark:bg-zinc-100 hover:bg-zinc-800 text-white dark:text-zinc-950 text-xs font-bold cursor-pointer flex items-center gap-1.5 rounded shadow-[2px_2px_0px_0px_#dc2626]"
          >
            <span>{t("🧪 مختبر اللائحة والمدقق", "🧪 Policy Lab")}</span>
          </Link>

          <button
            type="button"
            onClick={() => {
              setRefreshTick((n) => n + 1);
              toast.info(t("تم تحديث البيانات الحية", "Refreshed live data"));
            }}
            title={t("تحديث البيانات", "Refresh Data")}
            className="p-2 border-2 border-zinc-900 dark:border-zinc-700 bg-white dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 rounded cursor-pointer"
          >
            <SvgI d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </button>
        </div>
      </div>

      {/* ── Guided 4-Step Quick Workflow Cards (Easy HR Navigation) ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 font-mono">
        {[
          {
            key: "overview",
            step: isAr ? "الخطوة ١" : "STEP 1",
            title: t("حضور اليوم والوردية", "Today's Attendance"),
            sub: t(
              `${hrSummary.presentToday} حاضر · ${hrSummary.lateToday} متأخر · ${hrSummary.absentToday} غائب`,
              `${hrSummary.presentToday} present · ${hrSummary.lateToday} late · ${hrSummary.absentToday} absent`,
            ),
            action: t("متابعة الحضور والأعذار ←", "Monitor & Excuse →"),
            tone: "border-emerald-600",
          },
          {
            key: "compliance",
            step: isAr ? "الخطوة ٢" : "STEP 2",
            title: t("تواريخ التعيين والأذونات والإجازات", "Joining Dates, Permissions & Leave"),
            sub:
              missingHireCount > 0
                ? t(`⚠ ${missingHireCount} موظف بحاجة لتحديد تاريخ التعيين`, `⚠ ${missingHireCount} worker(s) need joining date`)
                : t("الأذونات الشهرية (4/240د) ورصيد الإجازات", "Monthly permissions (4/240m) & leave balances"),
            action: t("ضبط تواريخ التعيين والرصيد ←", "Set Dates & Quotas →"),
            tone: missingHireCount > 0 ? "border-amber-500" : "border-sky-600",
          },
          {
            key: "payroll",
            step: isAr ? "الخطوة ٣" : "STEP 3",
            title: t("الرواتب وكشوف المرتبات", "Monthly Payroll & Payslips"),
            sub: t(
              `صافي الدورة: ${payrollTotals.net} ج.م · إضافي ${settings.dayOtMultiplier ?? 1.35}x/${settings.nightOtMultiplier ?? 1.7}x`,
              `Net due: EGP ${payrollTotals.net} · OT ${settings.dayOtMultiplier ?? 1.35}x/${settings.nightOtMultiplier ?? 1.7}x`,
            ),
            action: t("مراجعة الرواتب والطباعة ←", "Review & Print Payslips →"),
            tone: "border-red-600",
          },
          {
            key: "holidays",
            step: isAr ? "الخطوة ٤" : "STEP 4",
            title: t("العطلات الرسمية والسياسات", "Holidays & Work Policies"),
            sub: t(
              `${holidays.length} عطلة رسمية مسجلة · بداية الشهر يوم ${settings.monthStartDay}`,
              `${holidays.length} official holidays · Cycle starts Day ${settings.monthStartDay}`,
            ),
            action: t("إدارة العطلات والسياسات ←", "Manage Holidays & Rules →"),
            tone: "border-zinc-700",
          },
        ].map((card) => {
          const active = section === card.key;
          return (
            <button
              key={card.key}
              type="button"
              onClick={() => setSection(card.key)}
              className={`p-3.5 rounded-lg border-2 text-start transition-all cursor-pointer flex flex-col justify-between ${
                active
                  ? "bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950 border-red-600 shadow-[3px_3px_0px_0px_#dc2626]"
                  : `bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 ${card.tone} hover:bg-zinc-50 dark:hover:bg-zinc-800/60 shadow-[2px_2px_0px_0px_#09090b]`
              }`}
            >
              <div>
                <div className="flex items-center justify-between text-[10px] font-bold uppercase opacity-75">
                  <span>{card.step}</span>
                  {active && <span className="px-1.5 py-0.5 bg-red-600 text-white rounded">{t("مفتوح الآن", "Active")}</span>}
                </div>
                <div className="font-bold text-sm mt-1">{card.title}</div>
                <div className={`text-[11px] mt-1 ${active ? "text-zinc-300 dark:text-zinc-600" : "text-zinc-500 dark:text-zinc-400"}`}>
                  {card.sub}
                </div>
              </div>
              <div className={`mt-2.5 text-[11px] font-bold ${active ? "text-red-400 dark:text-red-600" : "text-red-600"}`}>
                {card.action}
              </div>
            </button>
          );
        })}
      </div>

      {/* ── Official Holiday Banner (If Today is a Holiday) ── */}
      {todayHoliday && (
        <div className="p-4 bg-emerald-50 dark:bg-emerald-950/50 border-2 border-emerald-600 rounded-lg flex items-center justify-between gap-3 shadow-[3px_3px_0px_0px_#059669] animate-fade-in font-mono">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🎉</span>
            <div>
              <div className="font-bold text-sm text-emerald-950 dark:text-emerald-200 uppercase tracking-wide">
                {t(`اليوم عطلة رسمية: ${todayHoliday.name}`, `Today is an Official Holiday: ${todayHoliday.name}`)}
              </div>
              <p className="text-xs text-emerald-800 dark:text-emerald-300 mt-0.5">
                {t(
                  "العمل معفى اليوم ولن يتم احتساب أي خصم غياب على الموظفين في هذا التاريخ.",
                  "Work shift is excused. Workers will NOT incur absence deductions on this date.",
                )}
              </p>
            </div>
          </div>
          <span className="px-2.5 py-1 bg-emerald-600 text-white font-bold rounded text-xs uppercase">
            {t("عطلة مدفوعة الأجر", "Paid Holiday")}
          </span>
        </div>
      )}

      {/* ── Navigation Tabs ── */}
      <div className="flex gap-1 overflow-x-auto border-b-2 border-zinc-900 dark:border-zinc-700 pb-1 font-mono">
        {HR_NAV_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            id={`hr-nav-tab-${tab.key}`}
            onClick={() => setSection(tab.key)}
            className={`relative flex shrink-0 items-center gap-2 px-4 py-2.5 text-xs font-bold tracking-wider transition-all cursor-pointer rounded-t ${
              section === tab.key
                ? "bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950 border-2 border-b-0 border-zinc-900 dark:border-zinc-100 shadow-[2px_-2px_0px_0px_#09090b]"
                : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800"
            }`}
          >
            <SvgI d={tab.icon} className={`h-4 w-4 ${section === tab.key ? "text-red-500" : ""}`} />
            <span>{isAr ? tab.ar : tab.en}</span>
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          TAB 1: TODAY OPERATIONS (LIVE ROSTER, 1-CLICK ONBOARDING & EXCUSES)
      ══════════════════════════════════════════════════════════════════ */}
      {section === "overview" && (
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

          {/* Live Roster Filter Pills */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-700 shadow-[2px_2px_0px_0px_#09090b] rounded-lg">
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

            <span className="text-xs text-zinc-500">
              {t(
                `الوردية: ${settings.shiftStartTime || "10:00"} + سماح ${settings.gracePeriodMinutes || 60} دقيقة`,
                `Shift: ${settings.shiftStartTime || "10:00"} + ${settings.gracePeriodMinutes || 60}m Grace`,
              )}
            </span>
          </div>

          {/* Live Workers Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {filteredTodayWorkers.map((w) => {
              const workerSession = todaysSessions.find((s) => s.workerId === w.id);
              const isPresent = presentWorkerIds.has(w.id);
              const isLate = lateWorkerIds.has(w.id);
              const workedHours = workerSession ? Math.round(sessionHours(workerSession) * 10) / 10 : 0;

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
                        <strong className={w.isOnline ? "text-emerald-600" : "text-zinc-500"}>
                          {w.isOnline
                            ? t("🟢 متصل بالوردية", "🟢 Online in shift")
                            : t("⚪ غير متصل", "⚪ Offline")}
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
                      {workerSession?.loginTime?.toDate && (
                        <div className="flex justify-between">
                          <span className="text-zinc-500">{t("وقت الحضور:", "Clock-in Time:")}</span>
                          <strong>
                            {workerSession.loginTime.toDate().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </strong>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Actions Bar */}
                  <div className="mt-4 pt-3 border-t border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
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
                        {t("🗓️ التعيين والراتب", "🗓️ Join Date & Rate")}
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
      )}

      {/* ══════════════════════════════════════════════════════════════════
          TAB 2: JOINING DATES, PERMISSIONS & LEAVE (HR-POL-2026)
      ══════════════════════════════════════════════════════════════════ */}
      {section === "compliance" && (
        <div className="space-y-5 animate-fade-in font-mono">
          <HrComplianceView
            workers={approved}
            ledger={effectiveLedger}
            approvedRequests={approvedRequests}
            reimbursements={reimbursements}
            settings={settings}
            adminEmail={adminEmail}
            onOpenPolicyModal={() => setPolicyModalOpen(true)}
          />
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          TAB 3: PAYROLL CENTER (COMMAND TABLE, ADVANCES, PAYSLIPS & LOCK)
      ══════════════════════════════════════════════════════════════════ */}
      {section === "payroll" && (
        <div className="space-y-5 animate-fade-in font-mono">
          <HrDateRangeSelector
            rangeKey={rangeKey}
            onRangeKeyChange={setRangeKey}
            periodStart={activePeriod.start}
            periodEnd={activePeriod.end}
            onCustomDatesChange={(start, end) => {
              setCustomStart(start);
              setCustomEnd(end);
              setRangeKey("custom");
            }}
            settings={settings}
            holidays={holidays}
            onOpenPolicyModal={() => setPolicyModalOpen(true)}
          />

          {/* Payroll Financial Summary & Disbursal Status Bar */}
          <div className="p-5 bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-700 shadow-[4px_4px_0px_0px_#09090b] rounded-lg space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-zinc-900 dark:border-zinc-700 pb-3">
              <div>
                <span className="text-[10px] font-bold uppercase text-zinc-400">
                  {t("حالة دورة الرواتب", "Payroll Cycle Status")}
                </span>
                <div className="flex items-center gap-2 mt-0.5">
                  <span
                    className={`px-3 py-1 rounded text-xs font-bold uppercase border ${
                      currentCycleStatus === "paid"
                        ? "bg-emerald-600 text-white border-emerald-700"
                        : currentCycleStatus === "approved"
                          ? "bg-blue-600 text-white border-blue-700"
                          : "bg-amber-100 text-amber-800 border-amber-300"
                    }`}
                  >
                    {currentCycleStatus === "paid"
                      ? t("تم الصرف (Paid)", "Paid (تم الصرف)")
                      : currentCycleStatus === "approved"
                        ? t("معتمد للصرف (Approved)", "Approved for Payout")
                        : t("مسودة قيد المراجعة (Draft)", "Draft (Under Review)")}
                  </span>
                  <span className="text-xs text-zinc-500">
                    {t("الفترة:", "Cycle:")} {activePeriod.label}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setAdjustmentModalOpen(true)}
                  className="px-3 py-1.5 border-2 border-zinc-900 dark:border-zinc-700 bg-white dark:bg-zinc-800 hover:bg-zinc-100 text-zinc-950 dark:text-zinc-100 text-xs font-bold cursor-pointer rounded"
                >
                  {t("+ إضافة سلفة / بدل / مكافأة", "+ Add Advance / Allowance")}
                </button>
                <button
                  type="button"
                  onClick={exportPayrollCsv}
                  className="px-3 py-1.5 border-2 border-zinc-900 dark:border-zinc-700 bg-white dark:bg-zinc-800 hover:bg-zinc-100 text-zinc-950 dark:text-zinc-100 text-xs font-bold cursor-pointer rounded"
                >
                  {t("📥 تصدير شيت الرواتب CSV", "📥 Export CSV")}
                </button>
                {currentCycleStatus === "draft" && (
                  <button
                    type="button"
                    onClick={() => void handleToggleCycleStatus("approved")}
                    className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold border-2 border-zinc-900 cursor-pointer shadow-[2px_2px_0px_0px_#09090b] rounded"
                  >
                    {t("اعتماد كشف الرواتب", "Approve Payroll")}
                  </button>
                )}
                {currentCycleStatus === "approved" && (
                  <button
                    type="button"
                    onClick={() => void handleToggleCycleStatus("paid")}
                    className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold border-2 border-zinc-900 cursor-pointer shadow-[2px_2px_0px_0px_#059669] rounded"
                  >
                    {t("✓ تأكيد الصرف (تم الصرف)", "✓ Mark as Paid")}
                  </button>
                )}
                {currentCycleStatus === "paid" && (
                  <button
                    type="button"
                    onClick={() => void handleToggleCycleStatus("draft")}
                    className="px-2 py-1 text-zinc-400 hover:text-red-600 text-xs underline cursor-pointer"
                  >
                    {t("إلغاء القفل / تعديل", "Unlock / Revert")}
                  </button>
                )}
              </div>
            </div>

            {/* Financial Numbers Strip */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
              <div className="p-3 bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 rounded">
                <span className="text-zinc-500 text-[10px] uppercase font-bold">
                  {t("إجمالي الاستحقاقات", "Gross Earnings")}
                </span>
                <p className="text-xl font-bold font-oswald text-zinc-900 dark:text-white mt-1">EGP {payrollTotals.gross}</p>
              </div>
              <div className="p-3 bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 rounded">
                <span className="text-zinc-500 text-[10px] uppercase font-bold">
                  {settings.policy2026Enabled
                    ? t(
                        `إجمالي الإضافي (${settings.dayOtMultiplier ?? 1.35}x / ${settings.nightOtMultiplier ?? 1.7}x)`,
                        `Overtime (${settings.dayOtMultiplier ?? 1.35}x / ${settings.nightOtMultiplier ?? 1.7}x)`,
                      )
                    : t(`إجمالي الإضافي (${settings.overtimeMultiplier || 1.5}x)`, `Overtime (${settings.overtimeMultiplier || 1.5}x)`)}
                </span>
                <p className="text-xl font-bold font-oswald text-emerald-700 dark:text-emerald-400 mt-1">+EGP {payrollTotals.overtime}</p>
              </div>
              <div className="p-3 bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 rounded">
                <span className="text-zinc-500 text-[10px] uppercase font-bold">
                  {t("السلف المستردة (Advances)", "Advances (سلف)")}
                </span>
                <p className="text-xl font-bold font-oswald text-red-600 dark:text-red-400 mt-1">-EGP {payrollTotals.advances}</p>
              </div>
              <div className="p-3 bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 rounded">
                <span className="text-zinc-500 text-[10px] uppercase font-bold">
                  {t("خصومات الغياب والتأخير", "Absence & Late Deductions")}
                </span>
                <p className="text-xl font-bold font-oswald text-red-600 dark:text-red-400 mt-1">-EGP {payrollTotals.deductions}</p>
              </div>
              <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 rounded col-span-2 md:col-span-1">
                <span className="text-emerald-800 dark:text-emerald-300 text-[10px] uppercase font-bold">
                  {t("صافي المبلغ المستحق للصرف", "Net Due to Disburse")}
                </span>
                <p className="text-xl font-bold font-oswald text-emerald-800 dark:text-emerald-300 mt-1">EGP {payrollTotals.net}</p>
              </div>
            </div>
          </div>

          {/* Full Payroll Data Table */}
          <div className="bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-700 shadow-[3px_3px_0px_0px_#09090b] rounded-lg overflow-x-auto text-xs">
            <table className="w-full text-start divide-y divide-zinc-200 dark:divide-zinc-800 font-mono">
              <thead className="bg-zinc-100 dark:bg-zinc-800 text-[10px] font-bold uppercase text-zinc-600 dark:text-zinc-400">
                <tr>
                  <th className="py-3 px-4 text-start">{t("الموظف", "Employee")}</th>
                  <th className="py-3 px-3 text-start">{t("تاريخ التعيين", "Joined")}</th>
                  <th className="py-3 px-3 text-start">{t("أيام العمل", "Worked")}</th>
                  <th className="py-3 px-3 text-start">{t("أجر الساعة", "Rate")}</th>
                  <th className="py-3 px-3 text-start">{t("الأساسي", "Base Pay")}</th>
                  <th className="py-3 px-3 text-start text-emerald-700 dark:text-emerald-400">{t("الإضافي", "OT Pay")}</th>
                  <th className="py-3 px-3 text-start text-sky-700 dark:text-sky-400">{t("الأذونات", "Permissions")}</th>
                  <th className="py-3 px-3 text-start text-red-600">{t("الغياب/التأخير", "Deductions")}</th>
                  <th className="py-3 px-3 text-start text-red-600">{t("السلف", "Advances")}</th>
                  <th className="py-3 px-4 text-end">{t("صافي المستحق", "Net Payable")}</th>
                  <th className="py-3 px-3 text-center">{t("إجراءات", "Actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {payrollTableData.map(({ worker: w, payroll: p }) => {
                  const totalDed = p.absencePenalty + p.totalLatePenaltyEgp + p.shortfallDeduction + p.manualDeductions;
                  return (
                    <tr key={w.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                      <td className="py-3 px-4">
                        <div className="font-bold text-zinc-950 dark:text-white">{workerName(w)}</div>
                        <div className="text-[10px] text-zinc-500">{formatDepartment(w.department)}</div>
                      </td>
                      <td className="py-3 px-3">
                        <button
                          type="button"
                          onClick={() => setOnboardModalWorker(w)}
                          className={`text-[11px] font-bold underline cursor-pointer ${
                            w.hireDate ? "text-zinc-800 dark:text-zinc-200" : "text-amber-600"
                          }`}
                        >
                          {w.hireDate || t("⚠ حدد التاريخ", "⚠ Set Date")}
                        </button>
                      </td>
                      <td className="py-3 px-3">
                        <strong>
                          {p.daysWorked}/{p.expectedWorkDays}d
                        </strong>{" "}
                        <span className="text-zinc-400">({p.totalHours}h)</span>
                      </td>
                      <td className="py-3 px-3">EGP {p.hourlyRate}/h</td>
                      <td className="py-3 px-3 font-semibold">EGP {p.basePay}</td>
                      <td className="py-3 px-3 text-emerald-700 dark:text-emerald-400 font-semibold">
                        +{p.overtimePay}
                      </td>
                      <td className="py-3 px-3 text-sky-700 dark:text-sky-400">
                        {p.permissionsUsed}/4 ({p.permissionMinutesUsed}m)
                      </td>
                      <td className="py-3 px-3 text-red-600">
                        {totalDed > 0 ? `-${totalDed}` : "0"}
                      </td>
                      <td className="py-3 px-3 text-red-600 font-semibold">
                        {p.salaryAdvances > 0 ? `-${p.salaryAdvances}` : "0"}
                      </td>
                      <td className="py-3 px-4 text-end font-bold font-oswald text-sm text-emerald-700 dark:text-emerald-400">
                        EGP {p.netPayable}
                      </td>
                      <td className="py-3 px-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            type="button"
                            onClick={() => setOnboardModalWorker(w)}
                            title={t("ضبط تاريخ التعيين والراتب", "Set Joining Date & Rate")}
                            className="px-2 py-1 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-900 hover:text-white border border-zinc-300 dark:border-zinc-700 rounded text-[10px] font-bold transition-all cursor-pointer"
                          >
                            🗓️
                          </button>
                          <button
                            type="button"
                            onClick={() => setPayslipModalWorker(w)}
                            className="px-2.5 py-1 bg-zinc-100 dark:bg-zinc-800 hover:bg-red-600 hover:text-white border border-zinc-300 dark:border-zinc-700 rounded text-[10px] font-bold uppercase transition-all cursor-pointer"
                          >
                            {t("كشف الراتب 📄", "Payslip 📄")}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          TAB 4: HOLIDAYS & WORK POLICIES
      ══════════════════════════════════════════════════════════════════ */}
      {section === "holidays" && (
        <div className="space-y-6 animate-fade-in font-mono">
          <HrHolidaysManager
            holidays={holidays}
            adminEmail={adminEmail}
            onOpenPolicyModal={() => setPolicyModalOpen(true)}
          />
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          TAB 5: TEAM ANALYTICS & TIMESHEETS
      ══════════════════════════════════════════════════════════════════ */}
      {section === "team" && (
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
      )}

      {/* ══════════════════════════════════════════════════════════════════
          TAB 6: ALERTS & DISCIPLINARY LOGS
      ══════════════════════════════════════════════════════════════════ */}
      {section === "alerts" && (
        <div className="space-y-5 animate-fade-in font-mono">
          <div className="p-4 bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-700 shadow-[3px_3px_0px_0px_#09090b] rounded-lg flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-bold text-base text-zinc-950 dark:text-white uppercase">
              {t(`التنبيهات والتعاميم الإدارية (${alerts.length})`, `Broadcast Alerts & Disciplinary Notices (${alerts.length})`)}
            </h3>
            <button
              type="button"
              onClick={() => setSendOpen(true)}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold text-xs uppercase border-2 border-zinc-900 shadow-[2px_2px_0px_0px_#09090b] cursor-pointer rounded"
            >
              {t("+ إرسال تنبيه جديد", "+ Send New Alert")}
            </button>
          </div>

          <div className="bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-700 shadow-[3px_3px_0px_0px_#09090b] rounded-lg divide-y divide-zinc-200 dark:divide-zinc-800 text-xs">
            {alerts.map((a) => (
              <div
                key={a.id}
                className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <strong className="text-sm text-zinc-950 dark:text-white">{a.title}</strong>
                    <span className="px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 text-[10px] uppercase font-bold">
                      {a.type || "Notice"}
                    </span>
                    <span className="text-[10px] text-zinc-400">{formatTs(a.sentAt || a.createdAt)}</span>
                  </div>
                  <p className="text-zinc-600 dark:text-zinc-400 max-w-2xl">{a.message}</p>
                  <p className="text-[10px] text-zinc-400">
                    {t("المستلمون:", "Recipients:")} {a.recipientCount ?? a.recipients?.length ?? 0} ·{" "}
                    {t("بواسطة:", "Sent by:")} {a.sentBy || "Admin"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = await confirmDialog({
                        title: t("حذف التنبيه؟", "Delete alert?"),
                        message: t(`حذف "${a.title}" من السجل؟`, `Remove "${a.title}" from log?`),
                      });
                      if (!ok) return;
                      await deleteDoc(doc(db, "alerts", a.id));
                      toast.success(t("تم حذف التنبيه", "Alert deleted"));
                    }}
                    className="px-2.5 py-1 text-red-600 hover:underline cursor-pointer font-bold"
                  >
                    {t("حذف", "Delete")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── MODALS ── */}

      {/* 1. Policy Settings Modal */}
      {policyModalOpen && (
        <HrPolicyModal
          initialSettings={settings}
          adminEmail={adminEmail}
          onClose={() => setPolicyModalOpen(false)}
        />
      )}

      {/* 2. Record Advance / Allowance Modal */}
      {adjustmentModalOpen && (
        <HrAdjustmentModal
          workers={approved}
          adminEmail={adminEmail}
          onClose={() => setAdjustmentModalOpen(false)}
        />
      )}

      {/* 3. Excuse Worker Absence Modal */}
      {excuseModalWorker && (
        <HrExcuseModal
          worker={excuseModalWorker}
          date={today}
          adminEmail={adminEmail}
          onClose={() => setExcuseModalWorker(null)}
          onExcused={() => setRefreshTick((n) => n + 1)}
        />
      )}

      {/* 4. Worker Payslip Modal */}
      {payslipModalWorker &&
        (() => {
          const row = payrollTableData.find((r) => r.worker.id === payslipModalWorker.id);
          const computed = row
            ? row.payroll
            : computePayrollForWorker(
                workerSessionsInRange(sessions, payslipModalWorker.id, activePeriod.start, activePeriod.end),
                payslipModalWorker.hourlyRate || settings.defaultHourlyRate || 31.25,
                activePeriod.start,
                activePeriod.end,
                {
                  weekendDays: settings.weekendDays,
                  holidays,
                  settings,
                  ...policyInputsFor(payslipModalWorker, activePeriod.start, activePeriod.end),
                },
              );

          return (
            <HrPayslipModal
              worker={payslipModalWorker}
              payroll={computed}
              cycleLabel={activePeriod.label}
              periodStart={activePeriod.start}
              periodEnd={activePeriod.end}
              onClose={() => setPayslipModalWorker(null)}
            />
          );
        })()}

      {/* 5. Quick Onboarding / Joining Date & Rate Modal */}
      {onboardModalWorker && (
        <ModalPortal onClose={() => setOnboardModalWorker(null)}>
          <div
            className="fixed inset-0 z-[120] bg-zinc-950/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto animate-fade-in"
            onClick={() => setOnboardModalWorker(null)}
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
                  onClick={() => setOnboardModalWorker(null)}
                  className="text-2xl font-bold text-zinc-500 hover:text-red-600 cursor-pointer"
                >
                  &times;
                </button>
              </div>

              <WorkerLeaveProfileCard
                worker={onboardModalWorker}
                adminEmail={adminEmail}
                onSaved={() => setOnboardModalWorker(null)}
              />
            </div>
          </div>
        </ModalPortal>
      )}

      {/* 6. Send Alert Modal */}
      {sendOpen && (
        <ModalPortal onClose={() => setSendOpen(false)}>
          <div
            className="fixed inset-0 z-[120] bg-zinc-950/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto animate-fade-in font-mono"
            onClick={() => setSendOpen(false)}
          >
            <div
              dir={dir}
              className="bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-700 shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 animate-scale-in text-zinc-950 dark:text-zinc-100 rounded-lg"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-between items-center mb-4 pb-2 border-b-2 border-zinc-900 dark:border-zinc-700">
                <h3 className="text-xl font-black font-heading text-red-600">
                  {t("إرسال تنبيه أو تعميم للموظفين", "Send Workforce Alert")}
                </h3>
                <button
                  type="button"
                  className="text-2xl text-zinc-500 hover:text-red-600 font-bold cursor-pointer"
                  onClick={() => setSendOpen(false)}
                >
                  &times;
                </button>
              </div>
              <form onSubmit={handleSendAlert} className="space-y-4 text-xs font-mono">
                <div>
                  <label className="block text-zinc-700 dark:text-zinc-300 font-bold uppercase mb-1">
                    {t("نوع التنبيه *", "Alert Type *")}
                  </label>
                  <select
                    required
                    value={alertForm.type}
                    onChange={(e) => setAlertForm({ ...alertForm, type: e.target.value })}
                    className="w-full bg-white dark:bg-zinc-800 border-2 border-zinc-900 dark:border-zinc-700 px-3 py-2 text-zinc-950 dark:text-zinc-100 font-bold rounded focus:outline-none focus:ring-2 focus:ring-red-600"
                  >
                    <option value="">{t("اختر النوع…", "Select type…")}</option>
                    <option value="system_announcement">{t("إعلان هام (System Announcement)", "System Announcement (إعلان هام)")}</option>
                    <option value="policy_update">{t("تحديث لائحة العمل (Policy Update)", "Policy Update (تحديث سياسة العمل)")}</option>
                    <option value="shift_reminder">{t("تذكير بمواعيد الوردية (Shift Reminder)", "Shift Reminder (تذكير بالوردية)")}</option>
                    <option value="urgent_directive">{t("توجيه عاجل (Urgent Directive)", "Urgent Directive (توجيه عاجل)")}</option>
                  </select>
                </div>

                <div>
                  <label className="block text-zinc-700 dark:text-zinc-300 font-bold uppercase mb-1">
                    {t("المستلمون *", "Recipients *")}
                  </label>
                  <select
                    value={alertForm.recipient}
                    onChange={(e) => setAlertForm({ ...alertForm, recipient: e.target.value })}
                    className="w-full bg-white dark:bg-zinc-800 border-2 border-zinc-900 dark:border-zinc-700 px-3 py-2 text-zinc-950 dark:text-zinc-100 font-bold rounded focus:outline-none focus:ring-2 focus:ring-red-600"
                  >
                    <option value="all">{t("جميع الموظفين المعتمدين", "Broadcast to all approved workers")}</option>
                    <option value="department">{t("قسم محدد", "Specific department")}</option>
                    <option value="individual">{t("موظف محدد", "Individual worker")}</option>
                  </select>
                </div>

                {alertForm.recipient === "department" && (
                  <div>
                    <label className="block text-zinc-700 dark:text-zinc-300 font-bold uppercase mb-1">
                      {t("القسم *", "Department *")}
                    </label>
                    <select
                      value={alertForm.department}
                      onChange={(e) => setAlertForm({ ...alertForm, department: e.target.value })}
                      className="w-full bg-white dark:bg-zinc-800 border-2 border-zinc-900 dark:border-zinc-700 px-3 py-2 text-zinc-950 dark:text-zinc-100 font-bold rounded focus:outline-none focus:ring-2 focus:ring-red-600"
                    >
                      <option value="">{t("اختر القسم…", "Select department…")}</option>
                      {DEPARTMENTS.map((d) => (
                        <option key={d.value} value={d.value}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {alertForm.recipient === "individual" && (
                  <div>
                    <label className="block text-zinc-700 dark:text-zinc-300 font-bold uppercase mb-1">
                      {t("الموظف *", "Worker *")}
                    </label>
                    <select
                      value={alertForm.workerId}
                      onChange={(e) => setAlertForm({ ...alertForm, workerId: e.target.value })}
                      className="w-full bg-white dark:bg-zinc-800 border-2 border-zinc-900 dark:border-zinc-700 px-3 py-2 text-zinc-950 dark:text-zinc-100 font-bold rounded focus:outline-none focus:ring-2 focus:ring-red-600"
                    >
                      <option value="">{t("اختر الموظف…", "Select worker…")}</option>
                      {approved.map((w) => (
                        <option key={w.id} value={w.id}>
                          {workerName(w)} ({w.department || "General"})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className="block text-zinc-700 dark:text-zinc-300 font-bold uppercase mb-1">
                    {t("عنوان التنبيه *", "Title *")}
                  </label>
                  <input
                    type="text"
                    required
                    value={alertForm.title}
                    onChange={(e) => setAlertForm({ ...alertForm, title: e.target.value })}
                    className="w-full bg-white dark:bg-zinc-800 border-2 border-zinc-900 dark:border-zinc-700 px-3 py-2 text-zinc-950 dark:text-zinc-100 font-bold rounded focus:outline-none focus:ring-2 focus:ring-red-600"
                    placeholder={t("عنوان مختصر للتنبيه", "Brief subject")}
                  />
                </div>

                <div>
                  <label className="block text-zinc-700 dark:text-zinc-300 font-bold uppercase mb-1">
                    {t("نص الرسالة *", "Message *")}
                  </label>
                  <textarea
                    rows={4}
                    required
                    value={alertForm.message}
                    onChange={(e) => setAlertForm({ ...alertForm, message: e.target.value })}
                    className="w-full bg-white dark:bg-zinc-800 border-2 border-zinc-900 dark:border-zinc-700 px-3 py-2 text-zinc-950 dark:text-zinc-100 font-mono rounded focus:outline-none focus:ring-2 focus:ring-red-600 resize-none"
                    placeholder={t("اكتب تفاصيل التعميم أو التنبيه...", "Full notice text...")}
                  />
                </div>

                <div className="flex gap-2 justify-end pt-3 border-t-2 border-zinc-900 dark:border-zinc-700">
                  <button
                    type="button"
                    onClick={() => setSendOpen(false)}
                    className="px-4 py-2 border-2 border-zinc-900 dark:border-zinc-700 bg-white dark:bg-zinc-800 hover:bg-zinc-100 text-zinc-950 dark:text-zinc-100 font-bold cursor-pointer rounded"
                  >
                    {t("إلغاء", "Cancel")}
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold uppercase tracking-wider border-2 border-zinc-900 shadow-[2px_2px_0px_0px_#09090b] cursor-pointer rounded"
                  >
                    {t("إرسال التنبيه", "Send Alert")}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </ModalPortal>
      )}

      {/* 7. Complete Worker 360 Dashboard Modal */}
      {dashboardWorker && (
        <ModalPortal onClose={() => setDashboardWorker(null)}>
          <div
            className="fixed inset-0 z-[120] bg-zinc-950/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto animate-fade-in font-mono"
            onClick={() => setDashboardWorker(null)}
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
                  onClick={() => setDashboardWorker(null)}
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
                      setDashboardWorker(null);
                      setPayslipModalWorker(w);
                    }}
                    className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold uppercase rounded cursor-pointer"
                  >
                    {t("عرض كشف الراتب الحالي 📄", "View Current Payslip 📄")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDashboardWorker(null)}
                    className="px-4 py-1.5 border border-zinc-400 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white font-bold uppercase rounded cursor-pointer"
                  >
                    {t("إغلاق", "Close")}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
}
