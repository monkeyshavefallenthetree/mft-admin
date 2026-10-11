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
  type HrDateRangeKey,
  type SessionForHr,
  type HrSettings,
  type HolidayItem,
  type PayrollAdjustment,
  DEFAULT_HR_SETTINGS,
  calculateAttendancePolicy,
  computePayrollForWorker,
  formatDepartment,
  formatEmploymentType,
  getExpectedWorkDaysInPeriod,
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
  type PayrollCycleRecord,
} from "@/lib/admin/hrSettings";
import { toast, confirmDialog } from "@/lib/admin/feedback";
import { logActivity } from "@/lib/admin/activity";
import { useUrlState } from "@/lib/admin/useUrlState";
import ModalPortal from "@/components/admin/ui/ModalPortal";
import HrPolicyModal from "@/components/admin/hr/HrPolicyModal";
import HrHolidaysManager from "@/components/admin/hr/HrHolidaysManager";
import HrPayslipModal from "@/components/admin/hr/HrPayslipModal";
import HrAdjustmentModal from "@/components/admin/hr/HrAdjustmentModal";
import HrDateRangeSelector from "@/components/admin/hr/HrDateRangeSelector";
import HrExcuseModal from "@/components/admin/hr/HrExcuseModal";

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
  expectedHours?: number;
  emergencyContact?: string | Record<string, string>;
  lastLogin?: { toDate: () => Date };
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

interface PenaltyDoc {
  id: string;
  workerId?: string;
  workerName?: string;
  type?: string;
  amount?: number;
  reason?: string;
  date?: string;
  description?: string;
  appliedAt?: { toDate: () => Date };
  appliedBy?: string;
  category?: string;
  alertId?: string | null;
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

type HrTab = "overview" | "attendance" | "tasks" | "performance" | "payroll";
type ReportType = "attendance" | "productivity" | "payroll" | "compliance" | "penalties";

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

function taskAssignsToWorker(task: TaskDoc, workerId: string): boolean {
  const a = task.assignedTo;
  if (Array.isArray(a)) return a.includes(workerId);
  return a === workerId;
}

function assignedIds(task: TaskDoc): string[] {
  const a = task.assignedTo;
  if (Array.isArray(a)) return a;
  return a ? [a] : [];
}

const EMPLOYMENT_OPTIONS = [
  { value: "full-time", label: "Full-time" },
  { value: "part-time", label: "Part-time" },
  { value: "contract", label: "Contract" },
  { value: "intern", label: "Intern" },
];

const HR_NAV_TABS = [
  { key: "overview", label: "Today Operations", icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" },
  { key: "payroll", label: "Payroll Center", icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
  { key: "team", label: "Team Analytics", icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" },
  { key: "holidays", label: "Holidays & Policies", icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" },
  { key: "alerts", label: "Alerts & Disciplinary", icon: "M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" },
];

function SvgI({ d, className = "h-4 w-4" }: { d: string; className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

export default function AdminHRPage() {
  const [adminEmail, setAdminEmail] = useState("admin");
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [sessions, setSessions] = useState<WorkSession[]>([]);
  const [tasks, setTasks] = useState<TaskDoc[]>([]);
  const [penalties, setPenalties] = useState<PenaltyDoc[]>([]);
  const [alerts, setAlerts] = useState<AlertDoc[]>([]);
  const [settings, setSettings] = useState<HrSettings>(DEFAULT_HR_SETTINGS);
  const [holidays, setHolidays] = useState<HolidayItem[]>([]);
  const [adjustments, setAdjustments] = useState<PayrollAdjustment[]>([]);
  const [cycleRecords, setCycleRecords] = useState<Record<string, PayrollCycleRecord>>({});
  const [refreshTick, setRefreshTick] = useState(0);

  // Modals
  const [sendOpen, setSendOpen] = useState(false);
  const [policyModalOpen, setPolicyModalOpen] = useState(false);
  const [adjustmentModalOpen, setAdjustmentModalOpen] = useState(false);
  const [excuseModalWorker, setExcuseModalWorker] = useState<Worker | null>(null);
  const [payslipModalWorker, setPayslipModalWorker] = useState<Worker | null>(null);
  const [dashboardWorker, setDashboardWorker] = useState<Worker | null>(null);
  const [dashTab, setDashTab] = useState<HrTab>("overview");

  // Navigation & Search State
  const [section, setSection] = useUrlState("tab", "overview");
  const [workerSearch, setWorkerSearch] = useUrlState("q");
  const [departmentFilter, setDepartmentFilter] = useUrlState("dept");
  const [employmentFilter, setEmploymentFilter] = useUrlState("type");
  const [reportType, setReportType] = useState<ReportType>("attendance");
  const [todayFilter, setTodayFilter] = useState<"all" | "present" | "absent" | "late" | "overtime">("all");

  // Date Range and Cycle Selection State
  const [rangeKey, setRangeKey] = useState<string>("cycle");
  const [customStart, setCustomStart] = useState<Date>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d;
  });
  const [customEnd, setCustomEnd] = useState<Date>(() => new Date());

  // Alerts filtering
  const [sentTypeFilter, setSentTypeFilter] = useState("");
  const [sentDateFilter, setSentDateFilter] = useState("all");
  const [sentPriorityFilter, setSentPriorityFilter] = useState("");

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
    return onSnapshot(collection(db, "penalties"), (snap) => {
      const list: PenaltyDoc[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() } as PenaltyDoc));
      list.sort((a, b) => (b.appliedAt?.toDate?.()?.getTime() ?? 0) - (a.appliedAt?.toDate?.()?.getTime() ?? 0));
      setPenalties(list);
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
  useEffect(() => {
    return subscribeHrSettings((s) => setSettings(s));
  }, []);

  useEffect(() => {
    return subscribeHolidays((h) => setHolidays(h));
  }, []);

  useEffect(() => {
    return subscribePayrollAdjustments((a) => setAdjustments(a));
  }, []);

  useEffect(() => {
    return subscribePayrollCycles((c) => setCycleRecords(c));
  }, []);

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
      return getPayrollCycleRange(new Date(), 1); // 1st to end
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

  // Check if today is an official holiday
  const todayHoliday = useMemo(() => {
    return isDateHoliday(today, holidays);
  }, [today, holidays]);

  // Today Sessions & Live Attendance
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

  // Filtered Workers for Today Tab
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

  // Worker Tasks Map
  const workerTaskStats = useMemo(() => {
    const m = new Map<string, { completed: number; total: number }>();
    for (const t of tasks) {
      for (const id of assignedIds(t)) {
        const cur = m.get(id) || { completed: 0, total: 0 };
        cur.total += 1;
        if (t.status === "completed") cur.completed += 1;
        m.set(id, cur);
      }
    }
    return m;
  }, [tasks]);

  // Filtered Workers for Reports
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
      });

      return {
        worker: w,
        payroll: p,
        adjustments: workerAdj,
      };
    });
  }, [approved, activePeriod, sessions, adjustments, settings, holidays]);

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
      deductions += row.payroll.absencePenalty + row.payroll.totalLatePenaltyEgp + row.payroll.manualDeductions;
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

  // Export CSV Handler
  const exportPayrollCsv = () => {
    const headers = [
      "Employee Name",
      "Employee ID",
      "Department",
      "Role",
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
    toast.success("Payroll report downloaded");
  };

  // Cycle Approval Handler
  const handleToggleCycleStatus = async (nextStatus: "draft" | "approved" | "paid") => {
    const confirmMessages = {
      approved: "Approve this payroll cycle? This confirms that hours and penalties have been reviewed.",
      paid: "Mark this payroll as PAID (تم الصرف)? This locks the cycle as disbursed.",
      draft: "Revert payroll back to Draft review mode?",
    };

    const ok = await confirmDialog({
      title: `Confirm Payroll Status: ${nextStatus.toUpperCase()}`,
      message: confirmMessages[nextStatus],
      confirmLabel: `Mark as ${nextStatus.toUpperCase()}`,
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
      toast.success(`Payroll cycle marked as ${nextStatus.toUpperCase()}`);
    } catch (err) {
      toast.error("Failed to update cycle status", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  // Send Alert Handler
  const handleSendAlert = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!alertForm.type || !alertForm.title || !alertForm.message) {
      toast.warning("Please fill in required fields");
      return;
    }

    let recipients: string[] = [];
    if (alertForm.recipient === "all") recipients = approved.map((w) => w.id);
    else if (alertForm.recipient === "department") recipients = approved.filter((w) => w.department === alertForm.department).map((w) => w.id);
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

      void logActivity({
        action: "created",
        entity: "hr",
        label: `Sent alert: ${alertForm.title} to ${recipients.length} workers`,
      });

      toast.success("Broadcast alert sent");
      setSendOpen(false);
      setAlertForm({ type: "", title: "", message: "", recipient: "all", department: "", workerId: "", priority: "medium" });
    } catch (err) {
      toast.error("Failed to send alert", { description: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <div className="space-y-5">
      {/* ── Top Header ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-widest text-red-600 font-mono">
            // WORKFORCE COMMAND CENTER
          </span>
          <h2 className="text-2xl font-bold tracking-tight text-zinc-950 dark:text-white mt-0.5">
            HR Operations &amp; Payroll
          </h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Attendance monitoring, statutory holidays, automated payroll, and worker communications.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 font-mono">
          <button
            type="button"
            onClick={() => setPolicyModalOpen(true)}
            className="px-3 py-2 border-2 border-zinc-900 dark:border-zinc-700 bg-white dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-950 dark:text-zinc-100 text-xs font-bold uppercase tracking-wider cursor-pointer flex items-center gap-1.5 shadow-[2px_2px_0px_0px_#09090b]"
          >
            <span>⚙️ Policies (Day {settings.monthStartDay})</span>
          </button>

          <button
            type="button"
            onClick={() => setAdjustmentModalOpen(true)}
            className="px-3 py-2 border-2 border-zinc-900 dark:border-zinc-700 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 text-emerald-800 dark:text-emerald-300 text-xs font-bold uppercase tracking-wider cursor-pointer flex items-center gap-1 shadow-[2px_2px_0px_0px_#059669]"
          >
            <span>+ Record Advance (سلفة)</span>
          </button>

          <button
            type="button"
            onClick={() => setSendOpen(true)}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold uppercase tracking-wider border-2 border-zinc-900 shadow-[2px_2px_0px_0px_#09090b] cursor-pointer flex items-center gap-1.5"
          >
            <SvgI d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            <span>Send Alert</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setRefreshTick((n) => n + 1);
              toast.info("Refreshed live data");
            }}
            title="Refresh Data"
            className="p-2 border-2 border-zinc-900 dark:border-zinc-700 bg-white dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 rounded cursor-pointer"
          >
            <SvgI d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </button>
        </div>
      </div>

      {/* ── Official Holiday Banner (If Today is a Holiday) ── */}
      {todayHoliday && (
        <div className="p-4 bg-emerald-50 dark:bg-emerald-950/50 border-2 border-emerald-600 rounded-lg flex items-center justify-between gap-3 shadow-[3px_3px_0px_0px_#059669] animate-fade-in font-mono">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🎉</span>
            <div>
              <div className="font-bold text-sm text-emerald-950 dark:text-emerald-200 uppercase tracking-wide">
                Today is an Official Holiday: {todayHoliday.name} (عطلة رسمية)
              </div>
              <p className="text-xs text-emerald-800 dark:text-emerald-300 mt-0.5">
                Work shift is excused. Workers will <strong>NOT</strong> incur absence deductions on this date.
              </p>
            </div>
          </div>
          <span className="px-2.5 py-1 bg-emerald-600 text-white font-bold rounded text-xs uppercase">
            Paid Holiday
          </span>
        </div>
      )}

      {/* ── Navigation Tabs ── */}
      <div className="flex gap-1 overflow-x-auto border-b-2 border-zinc-900 dark:border-zinc-700 pb-1 font-mono">
        {HR_NAV_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            id={`hr-nav-tab-${t.key}`}
            onClick={() => setSection(t.key)}
            className={`relative flex shrink-0 items-center gap-2 px-4 py-2.5 text-xs font-bold uppercase tracking-wider transition-all cursor-pointer rounded-t ${
              section === t.key
                ? "bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950 border-2 border-b-0 border-zinc-900 dark:border-zinc-100 shadow-[2px_-2px_0px_0px_#09090b]"
                : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800"
            }`}
          >
            <SvgI d={t.icon} className={`h-4 w-4 ${section === t.key ? "text-red-500" : ""}`} />
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          TAB 1: TODAY OPERATIONS (LIVE ROSTER & 1-CLICK EXCUSES)
      ══════════════════════════════════════════════════════════════════ */}
      {section === "overview" && (
        <div className="space-y-5 animate-fade-in font-mono">
          {/* Top KPI Metrics Strip */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            {[
              { label: "Present Today", value: hrSummary.presentToday, bar: "bg-emerald-500" },
              { label: "Absent Today", value: hrSummary.absentToday, bar: "bg-red-500" },
              { label: `Late (>${settings.shiftStartTime || "10:00"})`, value: hrSummary.lateToday, bar: "bg-amber-500" },
              { label: `Overtime (>${settings.standardHours || 8}h)`, value: hrSummary.overtimeToday, bar: "bg-violet-500" },
              { label: "Attendance Rate", value: `${hrSummary.attendanceRate}%`, bar: "bg-blue-500" },
              { label: "Hours Today", value: `${hrSummary.payrollHoursToday}h`, bar: "bg-zinc-400" },
            ].map((s) => (
              <div key={s.label} className="p-4 bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-700 shadow-[3px_3px_0px_0px_#09090b] relative overflow-hidden">
                <span className={`absolute left-0 top-0 h-full w-1.5 ${s.bar}`} />
                <p className="text-[10px] font-bold uppercase text-zinc-500">{s.label}</p>
                <p className="text-2xl font-bold font-oswald text-zinc-950 dark:text-white mt-1">{s.value}</p>
              </div>
            ))}
          </div>

          {/* Live Roster Filter Pills */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-700 shadow-[2px_2px_0px_0px_#09090b] rounded-lg">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-bold uppercase text-zinc-400 mr-1">Roster:</span>
              {[
                { id: "all", label: `All Workers (${approved.length})` },
                { id: "present", label: `Present (${hrSummary.presentToday})` },
                { id: "absent", label: `Absent (${hrSummary.absentToday})` },
                { id: "late", label: `Late Arrivals (${hrSummary.lateToday})` },
                { id: "overtime", label: `On Overtime (${hrSummary.overtimeToday})` },
              ].map((pill) => (
                <button
                  key={pill.id}
                  type="button"
                  onClick={() => setTodayFilter(pill.id as any)}
                  className={`px-3 py-1.5 rounded text-xs font-bold uppercase cursor-pointer border transition-all ${
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
              Shift Policy: Start {settings.shiftStartTime || "10:00"} · {settings.gracePeriodMinutes || 60}m Grace
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
                        <p className="text-[11px] text-zinc-500">{formatDepartment(w.department)} · {w.role || "Operator"}</p>
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
                        {!isPresent ? "Absent" : isLate ? "Late" : "On-Time"}
                      </span>
                    </div>

                    <div className="mt-3 pt-2 border-t border-zinc-200 dark:border-zinc-800 text-xs space-y-1">
                      <div className="flex justify-between">
                        <span className="text-zinc-500">Status:</span>
                        <strong className={w.isOnline ? "text-emerald-600" : "text-zinc-500"}>
                          {w.isOnline ? "🟢 Online in shift" : "⚪ Offline"}
                        </strong>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zinc-500">Today Hours:</span>
                        <strong>{workedHours}h / {settings.standardHours || 8}h</strong>
                      </div>
                      {workerSession?.loginTime?.toDate && (
                        <div className="flex justify-between">
                          <span className="text-zinc-500">Clock-in Time:</span>
                          <strong>{workerSession.loginTime.toDate().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</strong>
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
                          title="WhatsApp Operator"
                          className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[10px] font-bold cursor-pointer"
                        >
                          WhatsApp
                        </a>
                      )}
                      {w.phone && (
                        <a
                          href={`tel:${w.phone}`}
                          title="Call Operator"
                          className="px-2 py-1 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 text-zinc-900 dark:text-zinc-200 border border-zinc-300 dark:border-zinc-700 rounded text-[10px] font-bold cursor-pointer"
                        >
                          Call
                        </a>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5">
                      {!isPresent && (
                        <button
                          type="button"
                          onClick={() => setExcuseModalWorker(w)}
                          className="px-2 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded text-[10px] font-bold uppercase cursor-pointer"
                        >
                          + Excuse Absence
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setDashboardWorker(w);
                          setDashTab("overview");
                        }}
                        className="px-2 py-1 text-zinc-600 hover:text-red-600 text-[10px] font-bold uppercase cursor-pointer"
                      >
                        Profile →
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
          TAB 2: PAYROLL CENTER (COMMAND TABLE, ADVANCES, PAYSLIPS & LOCK)
      ══════════════════════════════════════════════════════════════════ */}
      {section === "payroll" && (
        <div className="space-y-5 animate-fade-in font-mono">
          {/* Active Cycle & Period Selector */}
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
                <span className="text-[10px] font-bold uppercase text-zinc-400">Payroll Cycle Status</span>
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
                    {currentCycleStatus === "paid" ? "Paid (تم الصرف)" : currentCycleStatus === "approved" ? "Approved for Payout" : "Draft (Under Review)"}
                  </span>
                  <span className="text-xs text-zinc-500">
                    Cycle: {activePeriod.label}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setAdjustmentModalOpen(true)}
                  className="px-3 py-1.5 border-2 border-zinc-900 dark:border-zinc-700 bg-white dark:bg-zinc-800 hover:bg-zinc-100 text-zinc-950 dark:text-zinc-100 text-xs font-bold uppercase cursor-pointer"
                >
                  + Add Advance / Allowance
                </button>
                <button
                  type="button"
                  onClick={exportPayrollCsv}
                  className="px-3 py-1.5 border-2 border-zinc-900 dark:border-zinc-700 bg-white dark:bg-zinc-800 hover:bg-zinc-100 text-zinc-950 dark:text-zinc-100 text-xs font-bold uppercase cursor-pointer"
                >
                  📥 Export CSV
                </button>
                {currentCycleStatus === "draft" && (
                  <button
                    type="button"
                    onClick={() => void handleToggleCycleStatus("approved")}
                    className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold uppercase border-2 border-zinc-900 cursor-pointer shadow-[2px_2px_0px_0px_#09090b]"
                  >
                    Approve Payroll
                  </button>
                )}
                {currentCycleStatus === "approved" && (
                  <button
                    type="button"
                    onClick={() => void handleToggleCycleStatus("paid")}
                    className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold uppercase border-2 border-zinc-900 cursor-pointer shadow-[2px_2px_0px_0px_#059669]"
                  >
                    ✓ Mark as Paid (تم الصرف)
                  </button>
                )}
                {currentCycleStatus === "paid" && (
                  <button
                    type="button"
                    onClick={() => void handleToggleCycleStatus("draft")}
                    className="px-2 py-1 text-zinc-400 hover:text-red-600 text-xs underline cursor-pointer"
                  >
                    Unlock / Revert
                  </button>
                )}
              </div>
            </div>

            {/* Financial Numbers Strip */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
              <div className="p-3 bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 rounded">
                <span className="text-zinc-500 text-[10px] uppercase font-bold">Gross Earnings</span>
                <p className="text-xl font-bold font-oswald text-zinc-900 dark:text-white mt-1">EGP {payrollTotals.gross}</p>
              </div>
              <div className="p-3 bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 rounded">
                <span className="text-zinc-500 text-[10px] uppercase font-bold">Total Overtime (1.5x)</span>
                <p className="text-xl font-bold font-oswald text-emerald-700 dark:text-emerald-400 mt-1">+EGP {payrollTotals.overtime}</p>
              </div>
              <div className="p-3 bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 rounded">
                <span className="text-zinc-500 text-[10px] uppercase font-bold">Advances (سلف)</span>
                <p className="text-xl font-bold font-oswald text-red-600 dark:text-red-400 mt-1">-EGP {payrollTotals.advances}</p>
              </div>
              <div className="p-3 bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 rounded">
                <span className="text-zinc-500 text-[10px] uppercase font-bold">Absence Deductions</span>
                <p className="text-xl font-bold font-oswald text-red-600 dark:text-red-400 mt-1">-EGP {payrollTotals.deductions}</p>
              </div>
              <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 rounded col-span-2 md:col-span-1">
                <span className="text-emerald-800 dark:text-emerald-300 text-[10px] uppercase font-bold">Net Due to Disburse</span>
                <p className="text-xl font-bold font-oswald text-emerald-800 dark:text-emerald-300 mt-1">EGP {payrollTotals.net}</p>
              </div>
            </div>
          </div>

          {/* Full Payroll Data Table */}
          <div className="bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-700 shadow-[3px_3px_0px_0px_#09090b] rounded-lg overflow-x-auto text-xs">
            <table className="w-full text-left divide-y divide-zinc-200 dark:divide-zinc-800 font-mono">
              <thead className="bg-zinc-100 dark:bg-zinc-800 text-[10px] font-bold uppercase text-zinc-600 dark:text-zinc-400">
                <tr>
                  <th className="py-3 px-4">Employee</th>
                  <th className="py-3 px-3">Dept</th>
                  <th className="py-3 px-3">Worked</th>
                  <th className="py-3 px-3">Rate</th>
                  <th className="py-3 px-3">Base Pay</th>
                  <th className="py-3 px-3 text-emerald-700 dark:text-emerald-400">OT Pay</th>
                  <th className="py-3 px-3 text-red-600">Absence</th>
                  <th className="py-3 px-3 text-red-600">Advances</th>
                  <th className="py-3 px-4 text-right">Net Payable</th>
                  <th className="py-3 px-3 text-center">Payslip</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {payrollTableData.map(({ worker: w, payroll: p }) => (
                  <tr key={w.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                    <td className="py-3 px-4 font-bold text-zinc-950 dark:text-white">
                      {workerName(w)}
                    </td>
                    <td className="py-3 px-3 text-zinc-500">{formatDepartment(w.department)}</td>
                    <td className="py-3 px-3">
                      <strong>{p.daysWorked}d</strong> ({p.totalHours}h)
                    </td>
                    <td className="py-3 px-3">EGP {p.hourlyRate}/h</td>
                    <td className="py-3 px-3 font-semibold">EGP {p.basePay}</td>
                    <td className="py-3 px-3 text-emerald-700 dark:text-emerald-400 font-semibold">
                      +{p.overtimePay}
                    </td>
                    <td className="py-3 px-3 text-red-600">
                      {p.absencePenalty > 0 ? `-${p.absencePenalty}` : "0"}
                    </td>
                    <td className="py-3 px-3 text-red-600 font-semibold">
                      {p.salaryAdvances > 0 ? `-${p.salaryAdvances}` : "0"}
                    </td>
                    <td className="py-3 px-4 text-right font-bold font-oswald text-sm text-emerald-700 dark:text-emerald-400">
                      EGP {p.netPayable}
                    </td>
                    <td className="py-3 px-3 text-center">
                      <button
                        type="button"
                        onClick={() => setPayslipModalWorker(w)}
                        className="px-2.5 py-1 bg-zinc-100 dark:bg-zinc-800 hover:bg-red-600 hover:text-white border border-zinc-300 dark:border-zinc-700 rounded text-[10px] font-bold uppercase transition-all cursor-pointer"
                      >
                        Payslip 📄
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          TAB 3: TEAM ANALYTICS & TIMESHEETS
      ══════════════════════════════════════════════════════════════════ */}
      {section === "team" && (
        <div className="space-y-4 animate-fade-in font-mono">
          <div className="p-4 bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-700 shadow-[3px_3px_0px_0px_#09090b] rounded-lg flex flex-col lg:flex-row lg:items-center gap-3">
            <div className="relative flex-1">
              <input
                id="hr-search"
                value={workerSearch}
                onChange={(e) => setWorkerSearch(e.target.value)}
                placeholder="Search name, email, department, role…"
                className="w-full bg-white dark:bg-zinc-800 border-2 border-zinc-900 dark:border-zinc-700 px-3 py-2 text-zinc-950 dark:text-zinc-100 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-red-600"
              />
            </div>
            <select
              value={departmentFilter}
              onChange={(e) => setDepartmentFilter(e.target.value)}
              className="bg-white dark:bg-zinc-800 border-2 border-zinc-900 dark:border-zinc-700 px-3 py-2 text-xs font-bold text-zinc-900 dark:text-zinc-100"
            >
              <option value="">All departments</option>
              {DEPARTMENTS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
            <select
              value={employmentFilter}
              onChange={(e) => setEmploymentFilter(e.target.value)}
              className="bg-white dark:bg-zinc-800 border-2 border-zinc-900 dark:border-zinc-700 px-3 py-2 text-xs font-bold text-zinc-900 dark:text-zinc-100"
            >
              <option value="">All employment types</option>
              {EMPLOYMENT_OPTIONS.map((e) => (
                <option key={e.value} value={e.value}>
                  {e.label}
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
                        <p className="text-xs text-zinc-500">{formatDepartment(w.department)} · {w.role}</p>
                      </div>
                      <span className="px-2 py-0.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 border border-zinc-300 dark:border-zinc-700 text-xs font-bold">
                        {prod}% Score
                      </span>
                    </div>

                    <div className="mt-4 space-y-1.5 text-xs text-zinc-700 dark:text-zinc-300">
                      <div><strong>Logged Hours:</strong> {Math.round(totalHours * 10) / 10}h ({ws.length} shifts)</div>
                      <div><strong>Tasks Finished:</strong> {ts.completed} / {ts.total}</div>
                      <div><strong>Rating:</strong> {performanceRating(prod)}</div>
                      <div><strong>Rate:</strong> EGP {w.hourlyRate || settings.defaultHourlyRate}/h</div>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-zinc-200 dark:border-zinc-800 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setPayslipModalWorker(w)}
                      className="text-xs font-bold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer"
                    >
                      Payslip 📄
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDashboardWorker(w);
                        setDashTab("overview");
                      }}
                      className="text-xs font-bold text-red-600 hover:underline cursor-pointer"
                    >
                      Full 360 →
                    </button>
                  </div>
                </div>
              );
            })}
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
          TAB 5: ALERTS & DISCIPLINARY LOGS
      ══════════════════════════════════════════════════════════════════ */}
      {section === "alerts" && (
        <div className="space-y-5 animate-fade-in font-mono">
          <div className="p-4 bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-700 shadow-[3px_3px_0px_0px_#09090b] rounded-lg flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-bold text-base text-zinc-950 dark:text-white uppercase">
              Broadcast Alerts &amp; Disciplinary Notices ({alerts.length})
            </h3>
            <button
              type="button"
              onClick={() => setSendOpen(true)}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold text-xs uppercase border-2 border-zinc-900 shadow-[2px_2px_0px_0px_#09090b] cursor-pointer"
            >
              + Send New Alert
            </button>
          </div>

          <div className="bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-700 shadow-[3px_3px_0px_0px_#09090b] rounded-lg divide-y divide-zinc-200 dark:divide-zinc-800 text-xs">
            {alerts.map((a) => (
              <div key={a.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <strong className="text-sm text-zinc-950 dark:text-white">{a.title}</strong>
                    <span className="px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 text-[10px] uppercase font-bold">
                      {a.type || "Notice"}
                    </span>
                    <span className="text-[10px] text-zinc-400">{formatTs(a.sentAt || a.createdAt)}</span>
                  </div>
                  <p className="text-zinc-600 dark:text-zinc-400 max-w-2xl">{a.message}</p>
                  <p className="text-[10px] text-zinc-400">Recipients: {a.recipientCount ?? a.recipients?.length ?? 0} operators · Sent by {a.sentBy || "Admin"}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = await confirmDialog({ title: "Delete alert?", message: `Remove "${a.title}" from log?` });
                      if (!ok) return;
                      await deleteDoc(doc(db, "alerts", a.id));
                      toast.success("Alert deleted");
                    }}
                    className="px-2.5 py-1 text-red-600 hover:underline cursor-pointer font-bold"
                  >
                    Delete
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
      {payslipModalWorker && (
        (() => {
          const row = payrollTableData.find((r) => r.worker.id === payslipModalWorker.id);
          const computed = row ? row.payroll : computePayrollForWorker(
            workerSessionsInRange(sessions, payslipModalWorker.id, activePeriod.start, activePeriod.end),
            payslipModalWorker.hourlyRate || settings.defaultHourlyRate || 31.25,
            activePeriod.start,
            activePeriod.end,
            { weekendDays: settings.weekendDays, holidays, settings },
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
        })()
      )}

      {/* 5. Send Alert Modal */}
      {sendOpen && (
        <ModalPortal onClose={() => setSendOpen(false)}>
          <div className="fixed inset-0 z-[120] bg-zinc-950/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto animate-fade-in font-mono" onClick={() => setSendOpen(false)}>
            <div className="bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-700 shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 animate-scale-in text-zinc-950 dark:text-zinc-100" onClick={(e) => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-4 pb-2 border-b-2 border-zinc-900 dark:border-zinc-700">
                <h3 className="text-xl font-black font-heading text-red-600">Send Workforce Alert</h3>
                <button type="button" className="text-2xl text-zinc-500 hover:text-red-600 font-bold cursor-pointer" onClick={() => setSendOpen(false)}>
                  &times;
                </button>
              </div>
              <form onSubmit={handleSendAlert} className="space-y-4 text-xs font-mono">
                <div>
                  <label className="block text-zinc-700 dark:text-zinc-300 font-bold uppercase mb-1">Alert Type *</label>
                  <select
                    required
                    value={alertForm.type}
                    onChange={(e) => setAlertForm({ ...alertForm, type: e.target.value })}
                    className="w-full bg-white dark:bg-zinc-800 border-2 border-zinc-900 dark:border-zinc-700 px-3 py-2 text-zinc-950 dark:text-zinc-100 font-bold focus:outline-none focus:ring-2 focus:ring-red-600"
                  >
                    <option value="">Select type…</option>
                    <option value="system_announcement">System Announcement (إعلان هام)</option>
                    <option value="policy_update">Policy Update (تحديث سياسة العمل)</option>
                    <option value="shift_reminder">Shift Reminder (تذكير بالوردية)</option>
                    <option value="urgent_directive">Urgent Directive (توجيه عاجل)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-zinc-700 dark:text-zinc-300 font-bold uppercase mb-1">Recipients *</label>
                  <select
                    value={alertForm.recipient}
                    onChange={(e) => setAlertForm({ ...alertForm, recipient: e.target.value })}
                    className="w-full bg-white dark:bg-zinc-800 border-2 border-zinc-900 dark:border-zinc-700 px-3 py-2 text-zinc-950 dark:text-zinc-100 font-bold focus:outline-none focus:ring-2 focus:ring-red-600"
                  >
                    <option value="all">Broadcast to all approved workers</option>
                    <option value="department">Specific department</option>
                    <option value="individual">Individual worker</option>
                  </select>
                </div>

                {alertForm.recipient === "department" && (
                  <div>
                    <label className="block text-zinc-700 dark:text-zinc-300 font-bold uppercase mb-1">Department *</label>
                    <select
                      value={alertForm.department}
                      onChange={(e) => setAlertForm({ ...alertForm, department: e.target.value })}
                      className="w-full bg-white dark:bg-zinc-800 border-2 border-zinc-900 dark:border-zinc-700 px-3 py-2 text-zinc-950 dark:text-zinc-100 font-bold focus:outline-none focus:ring-2 focus:ring-red-600"
                    >
                      <option value="">Select department…</option>
                      {DEPARTMENTS.map((d) => (
                        <option key={d.value} value={d.value}>{d.label}</option>
                      ))}
                    </select>
                  </div>
                )}

                {alertForm.recipient === "individual" && (
                  <div>
                    <label className="block text-zinc-700 dark:text-zinc-300 font-bold uppercase mb-1">Worker *</label>
                    <select
                      value={alertForm.workerId}
                      onChange={(e) => setAlertForm({ ...alertForm, workerId: e.target.value })}
                      className="w-full bg-white dark:bg-zinc-800 border-2 border-zinc-900 dark:border-zinc-700 px-3 py-2 text-zinc-950 dark:text-zinc-100 font-bold focus:outline-none focus:ring-2 focus:ring-red-600"
                    >
                      <option value="">Select worker…</option>
                      {approved.map((w) => (
                        <option key={w.id} value={w.id}>{workerName(w)} ({w.department || "General"})</option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className="block text-zinc-700 dark:text-zinc-300 font-bold uppercase mb-1">Title *</label>
                  <input
                    type="text"
                    required
                    value={alertForm.title}
                    onChange={(e) => setAlertForm({ ...alertForm, title: e.target.value })}
                    className="w-full bg-white dark:bg-zinc-800 border-2 border-zinc-900 dark:border-zinc-700 px-3 py-2 text-zinc-950 dark:text-zinc-100 font-bold focus:outline-none focus:ring-2 focus:ring-red-600"
                    placeholder="Brief subject"
                  />
                </div>

                <div>
                  <label className="block text-zinc-700 dark:text-zinc-300 font-bold uppercase mb-1">Message *</label>
                  <textarea
                    rows={4}
                    required
                    value={alertForm.message}
                    onChange={(e) => setAlertForm({ ...alertForm, message: e.target.value })}
                    className="w-full bg-white dark:bg-zinc-800 border-2 border-zinc-900 dark:border-zinc-700 px-3 py-2 text-zinc-950 dark:text-zinc-100 font-mono focus:outline-none focus:ring-2 focus:ring-red-600 resize-none"
                    placeholder="Full notice text..."
                  />
                </div>

                <div className="flex gap-2 justify-end pt-3 border-t-2 border-zinc-900 dark:border-zinc-700">
                  <button
                    type="button"
                    onClick={() => setSendOpen(false)}
                    className="px-4 py-2 border-2 border-zinc-900 dark:border-zinc-700 bg-white dark:bg-zinc-800 hover:bg-zinc-100 text-zinc-950 dark:text-zinc-100 font-bold cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold uppercase tracking-wider border-2 border-zinc-900 shadow-[2px_2px_0px_0px_#09090b] cursor-pointer"
                  >
                    Send Alert
                  </button>
                </div>
              </form>
            </div>
          </div>
        </ModalPortal>
      )}

      {/* 6. Complete Worker 360 Dashboard Modal */}
      {dashboardWorker && (
        <ModalPortal onClose={() => setDashboardWorker(null)}>
          <div className="fixed inset-0 z-[120] bg-zinc-950/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto animate-fade-in font-mono" onClick={() => setDashboardWorker(null)}>
            <div
              className="bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-700 shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col animate-scale-in text-zinc-950 dark:text-zinc-100"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4 border-b-2 border-zinc-900 dark:border-zinc-700 flex justify-between items-center bg-zinc-50 dark:bg-zinc-800">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-none bg-red-600 border-2 border-zinc-900 text-white flex items-center justify-center text-lg font-bold font-heading shadow-[2px_2px_0px_0px_#09090b]">
                    {dashboardWorker.firstName?.[0]}
                    {dashboardWorker.lastName?.[0]}
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-zinc-950 dark:text-white font-heading">{workerName(dashboardWorker)}</h3>
                    <p className="text-xs text-zinc-600 dark:text-zinc-400">{dashboardWorker.email}</p>
                    <p className="text-xs mt-0.5">
                      <span className="text-zinc-600 uppercase font-bold">{dashboardWorker.status}</span>
                      {dashboardWorker.isOnline ? (
                        <span className="ml-2 text-emerald-700 font-bold">● Online</span>
                      ) : (
                        <span className="ml-2 text-zinc-400 font-bold">○ Offline</span>
                      )}
                    </p>
                  </div>
                </div>
                <button type="button" className="text-2xl text-zinc-500 hover:text-red-600 font-bold cursor-pointer" onClick={() => setDashboardWorker(null)}>
                  &times;
                </button>
              </div>

              <div className="p-4 overflow-y-auto flex-1 text-xs space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 p-3 bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700">
                  <div>
                    <span className="text-zinc-500">Department:</span>
                    <p className="font-bold text-zinc-900 dark:text-white">{formatDepartment(dashboardWorker.department)}</p>
                  </div>
                  <div>
                    <span className="text-zinc-500">Employment:</span>
                    <p className="font-bold text-zinc-900 dark:text-white">{formatEmploymentType(dashboardWorker.employmentType)}</p>
                  </div>
                  <div>
                    <span className="text-zinc-500">Hourly Rate:</span>
                    <p className="font-bold text-emerald-700 dark:text-emerald-400">EGP {dashboardWorker.hourlyRate || settings.defaultHourlyRate}/h</p>
                  </div>
                  <div>
                    <span className="text-zinc-500">Phone:</span>
                    <p className="font-bold text-zinc-900 dark:text-white">{dashboardWorker.phone || "—"}</p>
                  </div>
                </div>

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
                    View Current Payslip 📄
                  </button>
                  <button
                    type="button"
                    onClick={() => setDashboardWorker(null)}
                    className="px-4 py-1.5 border border-zinc-400 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white font-bold uppercase rounded cursor-pointer"
                  >
                    Close
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
