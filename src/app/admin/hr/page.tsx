"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import {
  collection,
  onSnapshot,
  addDoc,
  deleteDoc,
  doc,
  updateDoc,
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
  WORK_POLICY,
  calculateAttendancePolicy,
  computePayrollForWorker,
  formatDepartment,
  formatEmploymentType,
  getExpectedWorkDays,
  getHrDateRange,
  isLateTodayHtml,
  performanceRating,
  productivityScore,
  sessionDateYmd,
  workerSessionsInRange,
} from "@/lib/admin/hrReports";

interface Worker {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
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
  return `${w.firstName} ${w.lastName}`.trim();
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

function inferSentAlertCategory(a: AlertDoc): "warning" | "info" | "urgent" | "penalty" {
  if (a.hasPenalty || (a.penalty != null && String(a.penalty).length > 0)) return "penalty";
  if (a.type === "urgent" || a.priority === "urgent") return "urgent";
  if (["policy", "general", "schedule"].includes(a.type || "")) return "info";
  return "warning";
}

function alertPassesSentFilters(
  a: AlertDoc,
  typeFilter: string,
  priorityFilter: string,
  dateFilter: string,
): boolean {
  if (priorityFilter && (a.priority || "medium") !== priorityFilter) return false;
  if (dateFilter !== "all") {
    const alertDate = a.sentAt?.toDate?.() ?? a.createdAt?.toDate?.() ?? new Date(0);
    const now = new Date();
    if (dateFilter === "today" && alertDate.toDateString() !== now.toDateString()) return false;
    if (dateFilter === "week" && alertDate < new Date(now.getTime() - 7 * 86400000)) return false;
    if (dateFilter === "month" && alertDate < new Date(now.getTime() - 30 * 86400000)) return false;
  }
  if (!typeFilter) return true;
  return inferSentAlertCategory(a) === typeFilter;
}

const EMPLOYMENT_OPTIONS = [
  { value: "full-time", label: "Full-time" },
  { value: "part-time", label: "Part-time" },
  { value: "contract", label: "Contract" },
  { value: "intern", label: "Intern" },
];

export default function AdminHRPage() {
  const [adminEmail, setAdminEmail] = useState("admin");
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [sessions, setSessions] = useState<WorkSession[]>([]);
  const [tasks, setTasks] = useState<TaskDoc[]>([]);
  const [penalties, setPenalties] = useState<PenaltyDoc[]>([]);
  const [alerts, setAlerts] = useState<AlertDoc[]>([]);
  const [refreshTick, setRefreshTick] = useState(0);
  const [sendOpen, setSendOpen] = useState(false);
  const [payrollModalOpen, setPayrollModalOpen] = useState(false);
  const [dashboardWorker, setDashboardWorker] = useState<Worker | null>(null);
  const [dashTab, setDashTab] = useState<HrTab>("overview");

  const [workerSearch, setWorkerSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [employmentFilter, setEmploymentFilter] = useState("");
  const [hrDateRange, setHrDateRange] = useState<HrDateRangeKey>("week");
  const [reportType, setReportType] = useState<ReportType>("attendance");

  const [sentTypeFilter, setSentTypeFilter] = useState("");
  const [sentDateFilter, setSentDateFilter] = useState("all");
  const [sentPriorityFilter, setSentPriorityFilter] = useState("");

  const [payrollPeriod, setPayrollPeriod] = useState<HrDateRangeKey>("month");
  const [payrollIncludeOvertime, setPayrollIncludeOvertime] = useState(true);
  const [payrollIncludeAbsence, setPayrollIncludeAbsence] = useState(true);
  const [payrollIncludeBonuses, setPayrollIncludeBonuses] = useState(true);

  const [alertForm, setAlertForm] = useState({
    type: "",
    title: "",
    message: "",
    recipient: "all",
    department: "",
    workerId: "",
    priority: "medium",
    penalty: "",
    penaltyReason: "",
  });

  useEffect(() => {
    const u = onAuthStateChanged(auth, (user) => {
      setAdminEmail(user?.email || "admin");
    });
    return () => u();
  }, []);

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
      list.sort((a, b) => {
        const ta = a.appliedAt?.toDate?.()?.getTime() ?? 0;
        const tb = b.appliedAt?.toDate?.()?.getTime() ?? 0;
        return tb - ta;
      });
      setPenalties(list);
    });
  }, [refreshTick]);

  useEffect(() => {
    return onSnapshot(collection(db, "alerts"), (snap) => {
      const list: AlertDoc[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() } as AlertDoc));
      list.sort((a, b) => {
        const ta = a.sentAt?.toDate?.()?.getTime() ?? a.createdAt?.toDate?.()?.getTime() ?? 0;
        const tb = b.sentAt?.toDate?.()?.getTime() ?? b.createdAt?.toDate?.()?.getTime() ?? 0;
        return tb - ta;
      });
      setAlerts(list);
    });
  }, [refreshTick]);

  const approved = useMemo(() => workers.filter((w) => w.status === "approved"), [workers]);
  const today = todayYmd();

  const todaysSessions = useMemo(() => {
    return sessions.filter((s) => sessionDateYmd(s) === today);
  }, [sessions, today]);

  const presentToday = useMemo(() => {
    const fromSessions = new Set(todaysSessions.map((s) => s.workerId).filter(Boolean)).size;
    const fromOnline = approved.filter((w) => w.isOnline === true).length;
    return Math.max(fromSessions, fromOnline);
  }, [todaysSessions, approved]);

  const hrSummary = useMemo(() => {
    const expectedWorkers = approved.length;
    const absentToday = Math.max(0, expectedWorkers - presentToday);
    const lateToday = todaysSessions.filter((s) => isLateTodayHtml(s)).length;
    const overtimeToday = todaysSessions.filter((s) => sessionHours(s) > WORK_POLICY.STANDARD_HOURS).length;
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
  }, [approved.length, presentToday, todaysSessions]);

  const systemInsights = useMemo(() => {
    const items: { type: "danger" | "warning" | "info"; title: string; message: string }[] = [];
    const expectedWorkers = approved.length;
    if (hrSummary.absentToday > 0) {
      const absentList = approved.filter((w) => !todaysSessions.some((s) => s.workerId === w.id)).map(workerName);
      items.push({
        type: "warning",
        title: "Workers absent today",
        message: `${hrSummary.absentToday} approved worker(s) have no session today: ${absentList.slice(0, 5).join(", ")}${absentList.length > 5 ? "…" : ""}`,
      });
    }
    const overtimeSessions = todaysSessions.filter((s) => sessionHours(s) > WORK_POLICY.STANDARD_HOURS);
    if (overtimeSessions.length > 0) {
      items.push({
        type: "info",
        title: "Overtime today",
        message: `${overtimeSessions.length} session(s) over ${WORK_POLICY.STANDARD_HOURS}h`,
      });
    }
    const lateSessions = todaysSessions.filter((s) => isLateTodayHtml(s));
    if (lateSessions.length > 0) {
      items.push({
        type: "warning",
        title: "Late arrivals (login ≥ 11:00)",
        message: `${lateSessions.length} session(s) flagged late`,
      });
    }
    const longSessions = todaysSessions.filter((s) => sessionHours(s) > 10);
    if (longSessions.length > 0) {
      items.push({
        type: "danger",
        title: "Extended sessions",
        message: `${longSessions.length} session(s) over 10h today`,
      });
    }
    if (items.length === 0 && expectedWorkers > 0) {
      items.push({ type: "info", title: "All clear", message: "No automated HR warnings for today." });
    }
    return items;
  }, [approved, hrSummary.absentToday, todaysSessions]);

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

  const filteredAlerts = useMemo(() => {
    return alerts.filter((a) => alertPassesSentFilters(a, sentTypeFilter, sentPriorityFilter, sentDateFilter));
  }, [alerts, sentTypeFilter, sentPriorityFilter, sentDateFilter]);

  const sentAlertStats = useMemo(() => {
    const total = filteredAlerts.length;
    const now = new Date();
    const todayStr = now.toDateString();
    const todaySent = filteredAlerts.filter((a) => {
      const d = a.sentAt?.toDate?.() ?? a.createdAt?.toDate?.() ?? new Date(0);
      return d.toDateString() === todayStr;
    }).length;
    const readAlerts = filteredAlerts.filter((a) => a.readBy && a.readBy.length > 0).length;
    return { total, todaySent, readAlerts, unread: total - readAlerts };
  }, [filteredAlerts]);

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

  const rangeBounds = useMemo(() => getHrDateRange(hrDateRange), [hrDateRange]);

  const resolveRecipients = useCallback((): string[] | null => {
    const { recipient, department, workerId } = alertForm;
    switch (recipient) {
      case "all":
        return approved.map((w) => w.id);
      case "department": {
        if (!department) return null;
        return approved.filter((w) => w.department === department).map((w) => w.id);
      }
      case "individual": {
        if (!workerId) return null;
        return [workerId];
      }
      case "absent": {
        const present = new Set(todaysSessions.map((s) => s.workerId));
        return approved.filter((w) => !present.has(w.id)).map((w) => w.id);
      }
      case "late": {
        return todaysSessions
          .filter((s) => isLateTodayHtml(s))
          .map((s) => s.workerId)
          .filter((id): id is string => !!id);
      }
      case "overtime": {
        return todaysSessions
          .filter((s) => sessionHours(s) > WORK_POLICY.STANDARD_HOURS)
          .map((s) => s.workerId)
          .filter((id): id is string => !!id);
      }
      default:
        return [];
    }
  }, [alertForm, approved, todaysSessions]);

  const sendAlert = async (e: React.FormEvent) => {
    e.preventDefault();
    const f = alertForm;
    if (!f.type || !f.title || !f.message || !f.recipient || !f.priority) {
      alert("Please fill in all required fields.");
      return;
    }
    if (f.penalty && !f.penaltyReason.trim()) {
      alert("Please provide a reason for the penalty/bonus.");
      return;
    }
    const recipients = resolveRecipients();
    if (recipients === null) {
      alert("Please select department or worker where required.");
      return;
    }
    if (recipients.length === 0) {
      alert("No recipients found for the selected criteria.");
      return;
    }

    const penaltyIds: string[] = [];
    try {
      if (f.penalty) {
        const penaltyValue = parseFloat(f.penalty);
        if (Number.isNaN(penaltyValue)) {
          alert("Invalid penalty value.");
          return;
        }
        const penaltyType = penaltyValue > 0 ? "deduction" : "bonus";
        const absValue = Math.abs(penaltyValue);

        for (const rid of recipients) {
          const worker = workers.find((w) => w.id === rid);
          if (!worker) continue;
          const ref = await addDoc(collection(db, "penalties"), {
            workerId: rid,
            workerName: workerName(worker),
            workerEmail: worker.email || "",
            type: penaltyType,
            amount: absValue,
            reason: f.penaltyReason.trim(),
            appliedBy: adminEmail,
            appliedAt: serverTimestamp(),
            alertId: null,
            date: today,
            category: "manual",
            description: `${penaltyType === "deduction" ? "Penalty" : "Bonus"} of ${absValue} day(s) via alert: ${f.title}`,
          });
          penaltyIds.push(ref.id);
        }
      }

      const alertRef = await addDoc(collection(db, "alerts"), {
        type: f.type,
        title: f.title,
        message: f.message,
        recipient: f.recipient,
        department: f.department || "",
        workerId: f.workerId || "",
        priority: f.priority,
        penalty: f.penalty || "",
        penaltyReason: f.penaltyReason || "",
        recipients,
        sentBy: adminEmail,
        sentAt: serverTimestamp(),
        recipientCount: recipients.length,
        isRead: false,
        createdAt: serverTimestamp(),
        hasPenalty: !!f.penalty,
        penaltyApplied: f.penalty ? parseFloat(f.penalty) : 0,
        readBy: [],
      });

      for (const pid of penaltyIds) {
        await updateDoc(doc(db, "penalties", pid), { alertId: alertRef.id });
      }

      const extra = f.penalty
        ? ` with ${parseFloat(f.penalty) > 0 ? "penalty" : "bonus"} of ${Math.abs(parseFloat(f.penalty))} day(s)`
        : "";
      alert(`Alert sent to ${recipients.length} worker(s)${extra}.`);
      setSendOpen(false);
      setAlertForm({
        type: "",
        title: "",
        message: "",
        recipient: "all",
        department: "",
        workerId: "",
        priority: "medium",
        penalty: "",
        penaltyReason: "",
      });
    } catch (err) {
      console.error(err);
      alert("Failed to send alert.");
    }
  };

  const deleteAlert = async (id: string) => {
    if (!confirm("Delete this alert? This cannot be undone.")) return;
    await deleteDoc(doc(db, "alerts", id));
  };

  const resendAlert = async (a: AlertDoc) => {
    if (!confirm("Resend this alert to all original recipients?")) return;
    await addDoc(collection(db, "alerts"), {
      type: a.type || "general",
      title: a.title || "",
      message: a.message || "",
      recipient: a.recipient || "all",
      department: a.department || "",
      workerId: a.workerId || "",
      priority: a.priority || "medium",
      penalty: a.penalty || "",
      penaltyReason: a.penaltyReason || "",
      recipients: a.recipients || [],
      sentBy: adminEmail,
      sentAt: serverTimestamp(),
      recipientCount: a.recipients?.length ?? a.recipientCount ?? 0,
      isRead: false,
      createdAt: serverTimestamp(),
      hasPenalty: !!a.hasPenalty,
      penaltyApplied: a.penaltyApplied ?? 0,
      readBy: [],
      resent: true,
      originalAlertId: a.id,
    });
  };

  const exportAttendance = () => {
    const rows: (string | number)[][] = [
      ["Date", "Worker", "Email", "Department", "Hours", "Late", "Active"],
    ];
    const sorted = [...sessions].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    for (const s of sorted) {
      rows.push([
        s.date || sessionDateYmd(s) || "",
        s.workerName || "",
        "",
        s.department || "",
        Math.round(sessionHours(s) * 100) / 100,
        s.isLate ? "yes" : "no",
        s.isActive ? "yes" : "no",
      ]);
    }
    downloadCsv(rows, `attendance_export_${today}.csv`);
  };

  const exportPenaltiesCsv = () => {
    const rows: (string | number)[][] = [
      ["Worker", "Email", "Dept", "Penalty/Bonus", "Amount (days)", "Date", "Reason", "Description"],
    ];
    for (const p of penalties) {
      const w = workers.find((x) => x.id === p.workerId);
      rows.push([
        p.workerName || (w ? workerName(w) : ""),
        w?.email || "",
        w?.department || "",
        p.type || "",
        p.amount ?? "",
        p.date || "",
        p.reason || "",
        p.description || "",
      ]);
    }
    downloadCsv(rows, `payroll_penalties_${today}.csv`);
  };

  const exportSentAlertsCsv = () => {
    const rows: (string | number)[][] = [
      ["Title", "Type", "Priority", "Recipients", "Sent", "Message", "Read by (count)"],
    ];
    for (const a of filteredAlerts) {
      rows.push([
        a.title || "",
        a.type || "",
        a.priority || "",
        String(a.recipientCount ?? a.recipients?.length ?? 0),
        formatTs(a.sentAt || a.createdAt),
        (a.message || "").replace(/\n/g, " "),
        a.readBy?.length ?? 0,
      ]);
    }
    downloadCsv(rows, `hr_sent_alerts_${today}.csv`);
  };

  const runPayrollExport = () => {
    const { start, end } = getHrDateRange(payrollPeriod);
    const headers = [
      "Employee Name",
      "Employee ID",
      "Department",
      "Days Worked",
      "Total Hours",
      "Hourly Rate (EGP)",
      "Base Pay (EGP)",
      ...(payrollIncludeOvertime ? ["Overtime Pay (EGP)"] : []),
      ...(payrollIncludeAbsence ? ["Absence Penalty (EGP)"] : []),
      ...(payrollIncludeBonuses ? ["Bonuses/Penalties (EGP)"] : []),
      "Total Pay (EGP)",
    ];
    const rows: (string | number)[][] = [headers];

    for (const w of approved) {
      const ws = workerSessionsInRange(sessions, w.id, start, end);
      const hr = w.hourlyRate && w.hourlyRate > 0 ? w.hourlyRate : 31.25;
      const p = computePayrollForWorker(ws, hr, start, end);
      let bonusNet = 0;
      if (payrollIncludeBonuses) {
        const periodPenalties = penalties.filter((pen) => {
          if (!pen.appliedAt?.toDate) return false;
          const d = pen.appliedAt.toDate();
          return d >= start && d <= end && pen.workerId === w.id;
        });
        for (const pen of periodPenalties) {
          const days = pen.amount || 0;
          const val = days * 8 * hr * (pen.type === "bonus" ? 1 : -1);
          bonusNet += val;
        }
      }

      const baseRow: (string | number)[] = [
        workerName(w),
        w.id,
        w.department || "",
        p.daysWorked,
        p.totalHours,
        hr,
        p.basePay,
      ];
      if (payrollIncludeOvertime) baseRow.push(p.overtimePay);
      if (payrollIncludeAbsence) baseRow.push(p.absencePenalty);
      if (payrollIncludeBonuses) baseRow.push(Math.round(bonusNet));
      const total =
        p.basePay +
        (payrollIncludeOvertime ? p.overtimePay : 0) -
        (payrollIncludeAbsence ? p.absencePenalty : 0) -
        p.totalLatePenaltyEgp +
        (payrollIncludeBonuses ? Math.round(bonusNet) : 0);
      baseRow.push(total);
      rows.push(baseRow);
    }
    downloadCsv(rows, `payroll_report_${payrollPeriod}_${today}.csv`);
    setPayrollModalOpen(false);
  };

  const openDashboard = (w: Worker) => {
    setDashboardWorker(w);
    setDashTab("overview");
  };

  const dashSessions = useMemo(() => {
    if (!dashboardWorker) return [];
    return sessions
      .filter((s) => s.workerId === dashboardWorker.id)
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }, [dashboardWorker, sessions]);

  const dashTasks = useMemo(() => {
    if (!dashboardWorker) return [];
    return tasks.filter((t) => taskAssignsToWorker(t, dashboardWorker.id));
  }, [dashboardWorker, tasks]);

  const dashPenalties = useMemo(() => {
    if (!dashboardWorker) return [];
    return penalties.filter((p) => p.workerId === dashboardWorker.id);
  }, [dashboardWorker, penalties]);

  const perfWindow = useMemo(() => {
    const cutoff = Date.now() - 30 * 86400000;
    return dashSessions.filter((s) => {
      const y = sessionDateYmd(s);
      if (!y) return false;
      return new Date(y + "T12:00:00").getTime() >= cutoff;
    });
  }, [dashSessions]);

  const dashStats = useMemo(() => {
    if (!dashboardWorker) return null;
    const totalH = dashSessions.reduce((a, s) => a + sessionHours(s), 0);
    const exp = getExpectedWorkDays("month");
    const workDays = dashSessions.length;
    const att = exp > 0 ? Math.min(100, Math.round((workDays / exp) * 100)) : 0;
    const ts = workerTaskStats.get(dashboardWorker.id) || { completed: 0, total: 0 };
    const hr = dashboardWorker.hourlyRate && dashboardWorker.hourlyRate > 0 ? dashboardWorker.hourlyRate : 31.25;
    const earnings = Math.round(totalH * hr);
    const prod = productivityScore(
      dashboardWorker.expectedHours || 8,
      ts.completed,
      ts.total,
      perfWindow as SessionForHr[],
    );
    return { totalH, att, ts, earnings, prod, hr };
  }, [dashboardWorker, dashSessions, perfWindow, workerTaskStats]);

  const modalPayroll = useMemo(() => {
    if (!dashboardWorker) return null;
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    const ws = workerSessionsInRange(sessions, dashboardWorker.id, start, end);
    const hr = dashboardWorker.hourlyRate && dashboardWorker.hourlyRate > 0 ? dashboardWorker.hourlyRate : 31.25;
    return computePayrollForWorker(ws, hr, start, end);
  }, [dashboardWorker, sessions]);

  const insightBorder: Record<string, string> = {
    danger: "border-2 border-red-500 bg-red-50 text-red-950 shadow-[2px_2px_0px_0px_#dc2626]",
    warning: "border-2 border-amber-500 bg-amber-50 text-amber-950 shadow-[2px_2px_0px_0px_#d97706]",
    info: "border-2 border-blue-500 bg-blue-50 text-blue-950 shadow-[2px_2px_0px_0px_#2563eb]",
  };

  const penaltiesInRange = useMemo(() => {
    const { start, end } = rangeBounds;
    return penalties.filter((p) => {
      if (!p.appliedAt?.toDate) return false;
      const d = p.appliedAt.toDate();
      return d >= start && d <= end;
    });
  }, [penalties, rangeBounds]);

  const renderReportCards = () => {
    const { start, end } = rangeBounds;
    const expectedDays = getExpectedWorkDays(hrDateRange);

    if (reportType === "penalties") {
      const totalPen = penaltiesInRange.filter((p) => p.type === "deduction").length;
      const totalBon = penaltiesInRange.filter((p) => p.type === "bonus").length;
      const dedDays = penaltiesInRange.filter((p) => p.type === "deduction").reduce((s, p) => s + (p.amount || 0), 0);
      const bonDays = penaltiesInRange.filter((p) => p.type === "bonus").reduce((s, p) => s + (p.amount || 0), 0);

      const byDate: Record<string, PenaltyDoc[]> = {};
      for (const p of penaltiesInRange) {
        const d = p.appliedAt?.toDate?.().toDateString() || "unknown";
        if (!byDate[d]) byDate[d] = [];
        byDate[d].push(p);
      }
      const sortedDates = Object.keys(byDate).sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

      return (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4 bg-zinc-50 border-2 border-zinc-900 shadow-[3px_3px_0px_0px_#09090b]">
            <div className="text-center">
              <div className="text-2xl font-black text-red-600 font-heading">{totalPen}</div>
              <div className="text-xs text-zinc-600 font-mono font-bold uppercase mt-1">Penalties</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-black text-emerald-700 font-heading">{totalBon}</div>
              <div className="text-xs text-zinc-600 font-mono font-bold uppercase mt-1">Bonuses</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-black text-red-600 font-heading">{dedDays.toFixed(1)}</div>
              <div className="text-xs text-zinc-600 font-mono font-bold uppercase mt-1">Days deducted</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-black text-emerald-700 font-heading">{bonDays.toFixed(1)}</div>
              <div className="text-xs text-zinc-600 font-mono font-bold uppercase mt-1">Bonus days</div>
            </div>
          </div>
          {penaltiesInRange.length === 0 ? (
            <p className="text-zinc-500 font-mono text-center py-8">No penalties in this period.</p>
          ) : (
            sortedDates.map((dateKey) => (
              <div key={dateKey}>
                <h4 className="text-zinc-950 font-bold mb-2 px-3 py-1.5 bg-zinc-100 border border-zinc-300 font-mono text-xs uppercase tracking-wider">{dateKey}</h4>
                <div className="space-y-2">
                  {byDate[dateKey].map((penalty) => (
                    <div
                      key={penalty.id}
                      className="border-2 border-zinc-900 p-4 bg-white text-sm shadow-[2px_2px_0px_0px_#09090b]"
                    >
                      <div className="flex justify-between items-start gap-2">
                        <span className="font-bold text-zinc-950 font-heading">{penalty.workerName}</span>
                        <span className={`px-2 py-0.5 text-xs font-mono font-bold border ${
                          penalty.type === "deduction"
                            ? "border-red-400 bg-red-50 text-red-700"
                            : "border-emerald-400 bg-emerald-50 text-emerald-700"
                        }`}>
                          {penalty.type === "deduction" ? "Penalty" : "Bonus"} {penalty.amount}d
                        </span>
                      </div>
                      <p className="text-zinc-800 font-mono text-xs mt-2 bg-zinc-50 border border-zinc-200 p-2">{penalty.reason}</p>
                      <p className="text-xs text-zinc-500 font-mono mt-2">
                        {penalty.appliedBy} · {formatTs(penalty.appliedAt)} · {penalty.category || "—"}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      );
    }

    return (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filteredHrWorkers.map((w) => {
          const ws = workerSessionsInRange(sessions, w.id, start, end);
          const ts = workerTaskStats.get(w.id) || { completed: 0, total: 0 };
          const totalHours = ws.reduce((sum, s) => sum + sessionHours(s), 0);
          const workDays = ws.length;
          const avgDaily = workDays > 0 ? totalHours / workDays : 0;
          const attendancePct =
            expectedDays > 0 ? Math.min(100, Math.round((workDays / expectedDays) * 100)) : 0;
          const prod = productivityScore(w.expectedHours || 8, ts.completed, ts.total, ws);
          const hrRate = w.hourlyRate && w.hourlyRate > 0 ? w.hourlyRate : 31.25;
          const pay = computePayrollForWorker(ws, hrRate, start, end);

          const longSessions = ws.filter((s) => sessionHours(s) > 12);
          const otHours = ws.reduce((sum, s) => sum + Math.max(0, sessionHours(s) - 8), 0);
          const missing: string[] = [];
          if (!w.emergencyContact) missing.push("Emergency contact");
          if (!w.lastLogin) missing.push("Last login");
          if (!w.hourlyRate) missing.push("Hourly rate");
          const violations: string[] = [];
          if (longSessions.length) violations.push(`${longSessions.length} sessions over 12h`);
          if (otHours > 20) violations.push(`Excessive overtime: ${Math.round(otHours)}h`);
          if (missing.length) violations.push(`Missing: ${missing.join(", ")}`);
          const compliant = violations.length === 0;

          return (
            <button
              key={w.id}
              type="button"
              onClick={() => openDashboard(w)}
              className="text-left border-2 border-zinc-900 p-4 bg-white hover:border-red-600 hover:shadow-[4px_4px_0px_0px_#dc2626] transition-all shadow-[2px_2px_0px_0px_#09090b] flex flex-col justify-between"
            >
              <div>
                {reportType === "attendance" && (
                  <>
                    <div className="flex justify-between items-start gap-2">
                      <span className="font-bold text-zinc-950 font-heading text-base">{workerName(w)}</span>
                      <span
                        className={`text-xs px-2 py-0.5 border font-mono font-bold ${
                          attendancePct >= 90
                            ? "bg-emerald-50 text-emerald-800 border-emerald-300"
                            : attendancePct >= 70
                              ? "bg-amber-50 text-amber-800 border-amber-300"
                              : "bg-red-50 text-red-800 border-red-300"
                        }`}
                      >
                        {attendancePct}% attendance
                      </span>
                    </div>
                    <div className="text-xs text-zinc-700 font-mono mt-3 space-y-1">
                      <div><strong className="text-zinc-900">Dept:</strong> {formatDepartment(w.department)}</div>
                      <div><strong className="text-zinc-900">Employment:</strong> {formatEmploymentType(w.employmentType)}</div>
                      <div>
                        <strong className="text-zinc-900">Work days:</strong> {workDays} / {expectedDays}
                      </div>
                      <div><strong className="text-zinc-900">Total hours:</strong> {Math.round(totalHours * 10) / 10}h</div>
                      <div><strong className="text-zinc-900">Avg daily:</strong> {Math.round(avgDaily * 10) / 10}h</div>
                      <div className="pt-1 font-bold">{w.isOnline ? "🟢 Online" : "⚪ Offline"}</div>
                    </div>
                  </>
                )}
                {reportType === "productivity" && (
                  <>
                    <div className="flex justify-between items-start gap-2">
                      <span className="font-bold text-zinc-950 font-heading text-base">{workerName(w)}</span>
                      <span className="text-xs px-2 py-0.5 border border-zinc-300 bg-zinc-100 text-zinc-900 font-bold font-mono">{prod}%</span>
                    </div>
                    <div className="text-xs text-zinc-700 font-mono mt-3 space-y-1">
                      <div><strong className="text-zinc-900">Hours:</strong> {Math.round(totalHours * 10) / 10}h · Sessions: {ws.length}</div>
                      <div><strong className="text-zinc-900">Tasks done:</strong> {ts.completed} / {ts.total}</div>
                      <div><strong className="text-zinc-900">Rating:</strong> {performanceRating(prod)}</div>
                    </div>
                  </>
                )}
                {reportType === "payroll" && (
                  <>
                    <div className="flex justify-between items-start gap-2">
                      <span className="font-bold text-zinc-950 font-heading text-base">{workerName(w)}</span>
                      <span className="text-emerald-800 font-mono font-bold text-sm bg-emerald-50 border border-emerald-300 px-2 py-0.5">EGP {pay.totalPay}</span>
                    </div>
                    <div className="text-xs text-zinc-700 font-mono mt-3 space-y-1">
                      <div><strong className="text-zinc-900">Days:</strong> {pay.daysWorked} · <strong className="text-zinc-900">Hours:</strong> {pay.totalHours}h</div>
                      <div><strong className="text-zinc-900">Overtime:</strong> {pay.overtimeHours}h · <strong className="text-zinc-900">Rate:</strong> EGP {pay.hourlyRate}/h</div>
                      <div><strong className="text-zinc-900">Base:</strong> EGP {pay.basePay} + <strong className="text-zinc-900">OT:</strong> EGP {pay.overtimePay}</div>
                      {pay.absencePenalty > 0 && <div><strong className="text-red-700">Absence:</strong> -EGP {pay.absencePenalty}</div>}
                      <div><strong className="text-red-700">Late:</strong> -EGP {pay.totalLatePenaltyEgp}</div>
                    </div>
                  </>
                )}
                {reportType === "compliance" && (
                  <>
                    <div className="flex justify-between items-start gap-2">
                      <span className="font-bold text-zinc-950 font-heading text-base">{workerName(w)}</span>
                      <span className={`px-2 py-0.5 text-xs font-mono font-bold border ${
                        compliant
                          ? "bg-emerald-50 text-emerald-800 border-emerald-300"
                          : "bg-red-50 text-red-800 border-red-300"
                      }`}>
                        {compliant ? "✓ OK" : "Issues"}
                      </span>
                    </div>
                    <div className="text-xs text-zinc-700 font-mono mt-3 space-y-1">
                      <div><strong className="text-zinc-900">Sessions:</strong> {ws.length} · <strong className="text-zinc-900">Long (&gt;12h):</strong> {longSessions.length}</div>
                      <div><strong className="text-zinc-900">Overtime hours:</strong> {Math.round(otHours * 10) / 10}h</div>
                      <div><strong className="text-zinc-900">Status:</strong> {w.status}</div>
                      <div><strong className="text-zinc-900">Last login:</strong> {w.lastLogin?.toDate ? w.lastLogin.toDate().toLocaleDateString() : "—"}</div>
                    </div>
                    {!compliant && (
                      <ul className="text-xs text-red-700 mt-2 list-disc pl-4 font-mono font-semibold">
                        {violations.map((v) => (
                          <li key={v}>{v}</li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </div>
              <p className="text-[11px] text-red-600 mt-4 pt-2 border-t border-zinc-100 font-bold font-mono">Click for worker dashboard →</p>
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between gap-4 items-start pb-4 border-b-2 border-zinc-900">
        <div>
          <h2 className="text-2xl font-black text-zinc-950 font-heading tracking-tight">HR Management Dashboard</h2>
          <p className="text-xs text-zinc-600 font-mono mt-1">Live Firestore · parity with legacy HR tab (production tools)</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setSendOpen(true)}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white font-mono text-xs font-bold uppercase tracking-wider border-2 border-zinc-900 shadow-[2px_2px_0px_0px_#09090b] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none transition-all cursor-pointer"
          >
            Send alert
          </button>
          <button
            type="button"
            onClick={() => setPayrollModalOpen(true)}
            className="px-4 py-2 bg-white hover:bg-zinc-100 text-zinc-950 font-mono text-xs font-bold uppercase tracking-wider border-2 border-zinc-900 shadow-[2px_2px_0px_0px_#09090b] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none transition-all cursor-pointer"
          >
            Payroll report
          </button>
          <button
            type="button"
            onClick={exportAttendance}
            className="px-4 py-2 bg-white hover:bg-zinc-100 text-zinc-950 font-mono text-xs font-bold uppercase tracking-wider border-2 border-zinc-900 shadow-[2px_2px_0px_0px_#09090b] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none transition-all cursor-pointer"
          >
            Export attendance
          </button>
          <button
            type="button"
            onClick={exportPenaltiesCsv}
            className="px-4 py-2 bg-white hover:bg-zinc-100 text-zinc-950 font-mono text-xs font-bold uppercase tracking-wider border-2 border-zinc-900 shadow-[2px_2px_0px_0px_#09090b] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none transition-all cursor-pointer"
          >
            Export penalties CSV
          </button>
          <button
            type="button"
            onClick={() => setRefreshTick((n) => n + 1)}
            className="px-4 py-2 bg-white hover:bg-zinc-100 text-zinc-950 font-mono text-xs font-bold uppercase tracking-wider border-2 border-zinc-900 shadow-[2px_2px_0px_0px_#09090b] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none transition-all cursor-pointer"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-bold uppercase font-mono tracking-wider text-zinc-700">Today&apos;s insights</h3>
        <div className="space-y-2">
          {systemInsights.map((item, i) => (
            <div key={i} className={`p-3 text-xs font-mono font-medium ${insightBorder[item.type]}`}>
              <strong className="font-bold uppercase tracking-wide">{item.title}:</strong> {item.message}
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-3 items-end bg-white border-2 border-zinc-900 p-4 shadow-[3px_3px_0px_0px_#09090b]">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-bold uppercase font-mono text-zinc-700 mb-1">Search workers</label>
          <input
            value={workerSearch}
            onChange={(e) => setWorkerSearch(e.target.value)}
            placeholder="Name, email, department, role…"
            className="w-full bg-white border-2 border-zinc-900 px-3 py-2 text-sm text-zinc-950 font-mono focus:outline-none focus:ring-2 focus:ring-red-600"
          />
        </div>
        <button
          type="button"
          onClick={() => setWorkerSearch("")}
          className="px-4 py-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-950 font-mono text-xs font-bold border-2 border-zinc-900 shadow-[2px_2px_0px_0px_#09090b] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none cursor-pointer"
        >
          Clear search
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          ["Present today", hrSummary.presentToday],
          ["Absent today", hrSummary.absentToday],
          ["Late today (≥11:00)", hrSummary.lateToday],
          ["Overtime today (>8h)", hrSummary.overtimeToday],
          ["Attendance rate", `${hrSummary.attendanceRate}%`],
          ["Payroll hours (today)", `${hrSummary.payrollHoursToday}h`],
        ].map(([label, value]) => (
          <div key={label as string} className="bg-white border-2 border-zinc-900 p-4 text-center shadow-[3px_3px_0px_0px_#09090b]">
            <div className="text-2xl font-black text-red-600 font-heading">{value as string | number}</div>
            <div className="text-[10px] text-zinc-600 uppercase font-mono font-bold mt-1 tracking-wider">{label as string}</div>
          </div>
        ))}
      </div>

      <div className="bg-white border-2 border-zinc-900 p-5 space-y-4 shadow-[4px_4px_0px_0px_#09090b]">
        <div className="flex flex-wrap justify-between gap-2 items-center pb-2 border-b-2 border-zinc-900">
          <h3 className="text-lg font-black text-zinc-950 font-heading uppercase tracking-wide">Sent alerts &amp; notifications</h3>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={exportSentAlertsCsv}
              className="px-3 py-1.5 bg-white hover:bg-zinc-100 text-zinc-950 font-mono text-xs font-bold uppercase border-2 border-zinc-900 shadow-[2px_2px_0px_0px_#09090b] cursor-pointer"
            >
              Export
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            ["Total (filtered)", sentAlertStats.total],
            ["Sent today", sentAlertStats.todaySent],
            ["Read (est.)", sentAlertStats.readAlerts],
            ["Unread (est.)", sentAlertStats.unread],
          ].map(([l, v]) => (
            <div key={l} className="bg-zinc-50 border-2 border-zinc-900 p-3 text-center">
              <div className="text-xl font-black text-zinc-950 font-heading">{v}</div>
              <div className="text-[10px] text-zinc-600 font-mono font-bold uppercase mt-0.5">{l}</div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-3">
          <select
            value={sentTypeFilter}
            onChange={(e) => setSentTypeFilter(e.target.value)}
            className="bg-white border-2 border-zinc-900 px-3 py-2 text-xs font-mono font-bold text-zinc-950 focus:outline-none focus:ring-2 focus:ring-red-600"
          >
            <option value="">All alert categories</option>
            <option value="warning">Warning</option>
            <option value="info">Information</option>
            <option value="urgent">Urgent</option>
            <option value="penalty">Penalty</option>
          </select>
          <select
            value={sentDateFilter}
            onChange={(e) => setSentDateFilter(e.target.value)}
            className="bg-white border-2 border-zinc-900 px-3 py-2 text-xs font-mono font-bold text-zinc-950 focus:outline-none focus:ring-2 focus:ring-red-600"
          >
            <option value="all">All time</option>
            <option value="today">Today</option>
            <option value="week">This week</option>
            <option value="month">This month</option>
          </select>
          <select
            value={sentPriorityFilter}
            onChange={(e) => setSentPriorityFilter(e.target.value)}
            className="bg-white border-2 border-zinc-900 px-3 py-2 text-xs font-mono font-bold text-zinc-950 focus:outline-none focus:ring-2 focus:ring-red-600"
          >
            <option value="">All priorities</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>
        {filteredAlerts.length === 0 ? (
          <p className="text-zinc-500 font-mono text-center py-6">No alerts match filters.</p>
        ) : (
          <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
            {filteredAlerts.map((a) => (
              <div key={a.id} className="border-2 border-zinc-900 p-4 text-sm bg-white shadow-[2px_2px_0px_0px_#09090b]">
                <div className="flex flex-wrap justify-between gap-2">
                  <div>
                    <p className="font-bold text-zinc-950 font-heading text-sm">{a.title || "Untitled"}</p>
                    <p className="text-zinc-600 text-xs font-mono mt-1">
                      {inferSentAlertCategory(a)} · {a.priority} · {a.recipientCount ?? a.recipients?.length ?? 0}{" "}
                      recipients · readBy: {a.readBy?.length ?? 0}
                    </p>
                  </div>
                  <span className="text-xs font-mono text-zinc-500">{formatTs(a.sentAt || a.createdAt)}</span>
                </div>
                <div className="text-zinc-800 font-mono text-xs mt-2 bg-zinc-50 border border-zinc-200 p-2.5 whitespace-pre-wrap">{a.message}</div>
                <div className="flex flex-wrap gap-2 mt-3">
                  <button
                    type="button"
                    onClick={() => void resendAlert(a)}
                    className="px-3 py-1.5 border-2 border-zinc-900 bg-white hover:bg-zinc-100 text-zinc-950 text-xs font-mono font-bold shadow-[2px_2px_0px_0px_#09090b] cursor-pointer"
                  >
                    Resend
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteAlert(a.id)}
                    className="px-3 py-1.5 border-2 border-red-600 bg-red-50 hover:bg-red-600 hover:text-white text-red-700 text-xs font-mono font-bold transition-colors cursor-pointer"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white border-2 border-zinc-900 p-4 flex flex-wrap gap-4 shadow-[3px_3px_0px_0px_#09090b]">
        <div>
          <label className="block text-xs font-bold uppercase font-mono text-zinc-700 mb-1">Department</label>
          <select
            value={departmentFilter}
            onChange={(e) => setDepartmentFilter(e.target.value)}
            className="bg-white border-2 border-zinc-900 px-3 py-2 text-xs font-mono font-bold text-zinc-950 min-w-[140px] focus:outline-none focus:ring-2 focus:ring-red-600"
          >
            <option value="">All</option>
            {DEPARTMENTS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-bold uppercase font-mono text-zinc-700 mb-1">Employment</label>
          <select
            value={employmentFilter}
            onChange={(e) => setEmploymentFilter(e.target.value)}
            className="bg-white border-2 border-zinc-900 px-3 py-2 text-xs font-mono font-bold text-zinc-950 min-w-[140px] focus:outline-none focus:ring-2 focus:ring-red-600"
          >
            <option value="">All types</option>
            {EMPLOYMENT_OPTIONS.map((e) => (
              <option key={e.value} value={e.value}>
                {e.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-bold uppercase font-mono text-zinc-700 mb-1">Date range</label>
          <select
            value={hrDateRange}
            onChange={(e) => setHrDateRange(e.target.value as HrDateRangeKey)}
            className="bg-white border-2 border-zinc-900 px-3 py-2 text-xs font-mono font-bold text-zinc-950 min-w-[140px] focus:outline-none focus:ring-2 focus:ring-red-600"
          >
            <option value="today">Today</option>
            <option value="week">This week</option>
            <option value="month">This month</option>
            <option value="quarter">This quarter</option>
            <option value="year">This year</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-bold uppercase font-mono text-zinc-700 mb-1">Report type</label>
          <select
            value={reportType}
            onChange={(e) => setReportType(e.target.value as ReportType)}
            className="bg-white border-2 border-zinc-900 px-3 py-2 text-xs font-mono font-bold text-zinc-950 min-w-[180px] focus:outline-none focus:ring-2 focus:ring-red-600"
          >
            <option value="attendance">Attendance report</option>
            <option value="productivity">Productivity report</option>
            <option value="payroll">Payroll preview</option>
            <option value="compliance">Compliance report</option>
            <option value="penalties">Penalties &amp; bonuses</option>
          </select>
        </div>
      </div>

      <div>
        <p className="text-xs font-bold font-mono uppercase tracking-wider text-zinc-600 mb-3">
          Showing {filteredHrWorkers.length} worker(s) · {reportType} · {hrDateRange}
        </p>
        {filteredHrWorkers.length === 0 ? (
          <p className="text-zinc-500 font-mono text-center py-12">No workers match filters.</p>
        ) : (
          renderReportCards()
        )}
      </div>

      {payrollModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4" onClick={() => setPayrollModalOpen(false)}>
          <div className="bg-white border-2 border-zinc-900 shadow-[8px_8px_0px_0px_#09090b] w-full max-w-md p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-xl font-black text-zinc-950 font-heading">Payroll report (CSV)</h3>
            <p className="text-xs text-zinc-600 font-mono">Exports all approved workers for the selected rolling period (matches legacy payroll export options).</p>
            <div>
              <label className="block text-xs font-bold uppercase font-mono text-zinc-700 mb-1">Period</label>
              <select
                value={payrollPeriod}
                onChange={(e) => setPayrollPeriod(e.target.value as HrDateRangeKey)}
                className="w-full bg-white border-2 border-zinc-900 px-3 py-2 text-zinc-950 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-red-600"
              >
                <option value="week">Last 7 days</option>
                <option value="month">Last ~30 days</option>
                <option value="quarter">Last ~90 days</option>
                <option value="year">Last ~365 days</option>
                <option value="today">Today only</option>
              </select>
            </div>
            <label className="flex items-center gap-2 text-xs font-mono text-zinc-800 font-bold accent-red-600 cursor-pointer">
              <input type="checkbox" checked={payrollIncludeOvertime} onChange={(e) => setPayrollIncludeOvertime(e.target.checked)} />
              Include overtime pay column
            </label>
            <label className="flex items-center gap-2 text-xs font-mono text-zinc-800 font-bold accent-red-600 cursor-pointer">
              <input type="checkbox" checked={payrollIncludeAbsence} onChange={(e) => setPayrollIncludeAbsence(e.target.checked)} />
              Include absence penalty column
            </label>
            <label className="flex items-center gap-2 text-xs font-mono text-zinc-800 font-bold accent-red-600 cursor-pointer">
              <input type="checkbox" checked={payrollIncludeBonuses} onChange={(e) => setPayrollIncludeBonuses(e.target.checked)} />
              Include bonus/penalty adjustments (from Firestore penalties)
            </label>
            <div className="flex gap-2 justify-end pt-2">
              <button
                type="button"
                onClick={() => setPayrollModalOpen(false)}
                className="px-4 py-2 border-2 border-zinc-900 bg-white hover:bg-zinc-100 text-zinc-950 font-mono text-xs font-bold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={runPayrollExport}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-mono text-xs font-bold uppercase tracking-wider border-2 border-zinc-900 shadow-[2px_2px_0px_0px_#09090b] cursor-pointer"
              >
                Download CSV
              </button>
            </div>
          </div>
        </div>
      )}

      {sendOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4" onClick={() => setSendOpen(false)}>
          <div className="bg-white border-2 border-zinc-900 shadow-[8px_8px_0px_0px_#09090b] w-full max-w-lg max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4 pb-2 border-b-2 border-zinc-900">
              <h3 className="text-xl font-black text-zinc-950 font-heading">Send alert</h3>
              <button type="button" className="text-2xl text-zinc-500 hover:text-red-600 font-bold cursor-pointer" onClick={() => setSendOpen(false)}>
                &times;
              </button>
            </div>
            <form onSubmit={sendAlert} className="space-y-4 text-sm font-mono">
              <div>
                <label className="block text-zinc-700 font-mono font-bold text-xs uppercase mb-1">Alert type *</label>
                <select
                  required
                  value={alertForm.type}
                  onChange={(e) => setAlertForm({ ...alertForm, type: e.target.value })}
                  className="w-full bg-white border-2 border-zinc-900 px-3 py-2 text-zinc-950 font-mono focus:outline-none focus:ring-2 focus:ring-red-600"
                >
                  <option value="">Select…</option>
                  <option value="attendance">Attendance</option>
                  <option value="performance">Performance</option>
                  <option value="schedule">Schedule</option>
                  <option value="policy">Policy</option>
                  <option value="general">General</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
              <div>
                <label className="block text-zinc-700 font-mono font-bold text-xs uppercase mb-1">Title *</label>
                <input
                  required
                  value={alertForm.title}
                  onChange={(e) => setAlertForm({ ...alertForm, title: e.target.value })}
                  className="w-full bg-white border-2 border-zinc-900 px-3 py-2 text-zinc-950 font-mono focus:outline-none focus:ring-2 focus:ring-red-600"
                />
              </div>
              <div>
                <label className="block text-zinc-700 font-mono font-bold text-xs uppercase mb-1">Message *</label>
                <textarea
                  required
                  rows={4}
                  value={alertForm.message}
                  onChange={(e) => setAlertForm({ ...alertForm, message: e.target.value })}
                  className="w-full bg-white border-2 border-zinc-900 px-3 py-2 text-zinc-950 font-mono resize-y focus:outline-none focus:ring-2 focus:ring-red-600"
                />
              </div>
              <div>
                <label className="block text-zinc-700 font-mono font-bold text-xs uppercase mb-1">Recipients *</label>
                <select
                  value={alertForm.recipient}
                  onChange={(e) => setAlertForm({ ...alertForm, recipient: e.target.value })}
                  className="w-full bg-white border-2 border-zinc-900 px-3 py-2 text-zinc-950 font-mono focus:outline-none focus:ring-2 focus:ring-red-600"
                >
                  <option value="all">All approved workers</option>
                  <option value="department">By department</option>
                  <option value="individual">Individual</option>
                  <option value="absent">Absent today</option>
                  <option value="late">Late today (≥11:00)</option>
                  <option value="overtime">Overtime today (&gt;8h)</option>
                </select>
              </div>
              {alertForm.recipient === "department" && (
                <div>
                  <label className="block text-zinc-700 font-mono font-bold text-xs uppercase mb-1">Department</label>
                  <select
                    value={alertForm.department}
                    onChange={(e) => setAlertForm({ ...alertForm, department: e.target.value })}
                    className="w-full bg-white border-2 border-zinc-900 px-3 py-2 text-zinc-950 font-mono focus:outline-none focus:ring-2 focus:ring-red-600"
                  >
                    <option value="">Select…</option>
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
                  <label className="block text-zinc-700 font-mono font-bold text-xs uppercase mb-1">Worker</label>
                  <select
                    value={alertForm.workerId}
                    onChange={(e) => setAlertForm({ ...alertForm, workerId: e.target.value })}
                    className="w-full bg-white border-2 border-zinc-900 px-3 py-2 text-zinc-950 font-mono focus:outline-none focus:ring-2 focus:ring-red-600"
                  >
                    <option value="">Select…</option>
                    {approved.map((w) => (
                      <option key={w.id} value={w.id}>
                        {workerName(w)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-zinc-700 font-mono font-bold text-xs uppercase mb-1">Priority *</label>
                <select
                  required
                  value={alertForm.priority}
                  onChange={(e) => setAlertForm({ ...alertForm, priority: e.target.value })}
                  className="w-full bg-white border-2 border-zinc-900 px-3 py-2 text-zinc-950 font-mono focus:outline-none focus:ring-2 focus:ring-red-600"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
              <div>
                <label className="block text-zinc-700 font-mono font-bold text-xs uppercase mb-1">Penalty / bonus (days)</label>
                <input
                  value={alertForm.penalty}
                  onChange={(e) => setAlertForm({ ...alertForm, penalty: e.target.value })}
                  placeholder="e.g. 0.25 or -0.5"
                  className="w-full bg-white border-2 border-zinc-900 px-3 py-2 text-zinc-950 font-mono focus:outline-none focus:ring-2 focus:ring-red-600"
                />
              </div>
              <div>
                <label className="block text-zinc-700 font-mono font-bold text-xs uppercase mb-1">Penalty / bonus reason</label>
                <input
                  value={alertForm.penaltyReason}
                  onChange={(e) => setAlertForm({ ...alertForm, penaltyReason: e.target.value })}
                  className="w-full bg-white border-2 border-zinc-900 px-3 py-2 text-zinc-950 font-mono focus:outline-none focus:ring-2 focus:ring-red-600"
                />
              </div>
              <div className="flex gap-2 justify-end pt-3 border-t-2 border-zinc-900">
                <button
                  type="button"
                  onClick={() => setSendOpen(false)}
                  className="px-4 py-2 border-2 border-zinc-900 bg-white hover:bg-zinc-100 text-zinc-950 font-mono text-xs font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-mono text-xs font-bold uppercase tracking-wider border-2 border-zinc-900 shadow-[2px_2px_0px_0px_#09090b] cursor-pointer"
                >
                  Send
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {dashboardWorker && dashStats && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4" onClick={() => setDashboardWorker(null)}>
          <div
            className="bg-white border-2 border-zinc-900 shadow-[8px_8px_0px_0px_#09090b] w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b-2 border-zinc-900 flex justify-between items-center bg-zinc-50">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-none bg-red-600 border-2 border-zinc-900 text-white flex items-center justify-center text-lg font-bold font-heading shadow-[2px_2px_0px_0px_#09090b]">
                  {dashboardWorker.firstName?.[0]}
                  {dashboardWorker.lastName?.[0]}
                </div>
                <div>
                  <h3 className="text-lg font-black text-zinc-950 font-heading">{workerName(dashboardWorker)}</h3>
                  <p className="text-xs text-zinc-600 font-mono">{dashboardWorker.email}</p>
                  <p className="text-xs font-mono mt-1">
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

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 p-3 border-b-2 border-zinc-900 bg-zinc-100">
              {[
                [`${Math.round(dashStats.totalH * 10) / 10}h`, "Total hours"],
                [`${dashStats.att}%`, "Attendance (est.)"],
                [`${dashStats.ts.completed}/${dashStats.ts.total}`, "Tasks done"],
                [`EGP ${dashStats.earnings}`, "Earnings (est.)"],
              ].map(([num, lab]) => (
                <div key={lab} className="text-center p-2 bg-white border border-zinc-300">
                  <div className="text-lg font-black text-zinc-950 font-heading">{num}</div>
                  <div className="text-[10px] text-zinc-600 font-mono font-bold uppercase">{lab}</div>
                </div>
              ))}
            </div>

            <div className="flex border-b-2 border-zinc-900 overflow-x-auto bg-zinc-50">
              {(
                [
                  ["overview", "Overview"],
                  ["attendance", "Attendance"],
                  ["tasks", "Tasks"],
                  ["performance", "Performance"],
                  ["payroll", "Payroll"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setDashTab(key)}
                  className={`px-4 py-2 text-xs font-mono font-bold uppercase tracking-wider whitespace-nowrap border-b-2 -mb-px transition-colors cursor-pointer ${
                    dashTab === key
                      ? "border-red-600 text-red-600 bg-white"
                      : "border-transparent text-zinc-600 hover:text-zinc-950"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="p-4 overflow-y-auto flex-1 text-sm text-zinc-800 font-mono space-y-3 max-h-[55vh]">
              {dashTab === "overview" && (
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="space-y-2 border border-zinc-200 p-3 bg-zinc-50">
                    <h4 className="font-bold text-xs uppercase text-zinc-900 border-b border-zinc-200 pb-1">Personal Info</h4>
                    <p>
                      <strong className="text-zinc-600">Role:</strong> {dashboardWorker.role}
                    </p>
                    <p>
                      <strong className="text-zinc-600">Department:</strong> {dashboardWorker.department || "—"}
                    </p>
                    <p>
                      <strong className="text-zinc-600">Employment:</strong> {formatEmploymentType(dashboardWorker.employmentType)}
                    </p>
                    <p>
                      <strong className="text-zinc-600">Skills:</strong>{" "}
                      {dashboardWorker.skills?.length ? dashboardWorker.skills.join(", ") : "—"}
                    </p>
                  </div>
                  <div className="space-y-2 border border-zinc-200 p-3 bg-zinc-50">
                    <h4 className="font-bold text-xs uppercase text-zinc-900 border-b border-zinc-200 pb-1">Emergency Contact</h4>
                    {dashboardWorker.emergencyContact ? (
                      typeof dashboardWorker.emergencyContact === "string" ? (
                        <p>{dashboardWorker.emergencyContact}</p>
                      ) : (
                        <ul className="text-xs space-y-1">
                          {Object.entries(dashboardWorker.emergencyContact).map(([k, v]) => (
                            <li key={k}>
                              <strong className="text-zinc-600">{k}:</strong> {v}
                            </li>
                          ))}
                        </ul>
                      )
                    ) : (
                      <p className="text-amber-800 font-medium">Not on file</p>
                    )}
                  </div>
                  <div className="md:col-span-2 border border-zinc-200 p-3 bg-zinc-50">
                    <h4 className="font-bold text-xs uppercase text-zinc-900 border-b border-zinc-200 pb-1 mb-2">Recent sessions</h4>
                    <p className="text-xs text-zinc-700">
                      {dashSessions
                        .slice(0, 5)
                        .map((s) => `${s.date}: ${Math.round(sessionHours(s) * 10) / 10}h`)
                        .join(" · ") || "None"}
                    </p>
                  </div>
                </div>
              )}
              {dashTab === "attendance" && (
                <div className="space-y-3">
                  <div className="grid grid-cols-4 gap-2 text-center text-xs">
                    <div className="bg-zinc-50 border border-zinc-200 p-2">
                      <div className="text-zinc-950 font-black font-heading text-base">{dashSessions.filter((s) => sessionDateYmd(s) === today).length}</div>
                      <div className="text-zinc-600 text-[10px] uppercase font-bold">Sessions today</div>
                    </div>
                    <div className="bg-zinc-50 border border-zinc-200 p-2">
                      <div className="text-zinc-950 font-black font-heading text-base">{dashSessions.length}</div>
                      <div className="text-zinc-600 text-[10px] uppercase font-bold">All sessions</div>
                    </div>
                    <div className="bg-zinc-50 border border-zinc-200 p-2">
                      <div className="text-zinc-950 font-black font-heading text-base">
                        {
                          dashSessions.filter((s) => {
                            const pol = calculateAttendancePolicy(s);
                            return pol.attendanceStatus === "late" || pol.attendanceStatus === "very-late";
                          }).length
                        }
                      </div>
                      <div className="text-zinc-600 text-[10px] uppercase font-bold">Late (policy)</div>
                    </div>
                    <div className="bg-zinc-50 border border-zinc-200 p-2">
                      <div className="text-zinc-950 font-black font-heading text-base">
                        {Math.round(dashSessions.reduce((a, s) => a + Math.max(0, sessionHours(s) - 8), 0) * 10) / 10}h
                      </div>
                      <div className="text-zinc-600 text-[10px] uppercase font-bold">Overtime (all)</div>
                    </div>
                  </div>
                  {dashSessions.length === 0 ? (
                    <p className="text-zinc-500">No sessions.</p>
                  ) : (
                    <table className="w-full text-xs border border-zinc-300">
                      <thead>
                        <tr className="bg-zinc-100 text-zinc-900 border-b border-zinc-300 text-left font-bold">
                          <th className="p-2">Date</th>
                          <th className="p-2">Hours</th>
                          <th className="p-2">Late</th>
                          <th className="p-2">Policy</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dashSessions.slice(0, 100).map((s) => {
                          const pol = calculateAttendancePolicy(s);
                          return (
                            <tr key={s.id} className="border-t border-zinc-200 hover:bg-zinc-50">
                              <td className="p-2">{s.date || sessionDateYmd(s)}</td>
                              <td className="p-2 font-bold">{Math.round(sessionHours(s) * 100) / 100}</td>
                              <td className="p-2">{s.isLate || pol.isLate ? "yes" : "no"}</td>
                              <td className="p-2">{pol.attendanceStatus}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
              {dashTab === "tasks" && (
                <div className="space-y-2">
                  <div className="grid grid-cols-4 gap-2 text-center text-xs mb-2">
                    <div className="bg-zinc-50 border border-zinc-200 p-2">
                      <div className="text-zinc-950 font-black font-heading text-base">{dashStats.ts.total}</div>
                      <span className="text-zinc-600 text-[10px] uppercase font-bold">Total</span>
                    </div>
                    <div className="bg-zinc-50 border border-zinc-200 p-2">
                      <div className="text-emerald-700 font-black font-heading text-base">{dashStats.ts.completed}</div>
                      <span className="text-zinc-600 text-[10px] uppercase font-bold">Done</span>
                    </div>
                    <div className="bg-zinc-50 border border-zinc-200 p-2">
                      <div className="text-zinc-950 font-black font-heading text-base">{dashStats.ts.total - dashStats.ts.completed}</div>
                      <span className="text-zinc-600 text-[10px] uppercase font-bold">Open</span>
                    </div>
                    <div className="bg-zinc-50 border border-zinc-200 p-2">
                      <div className="text-red-600 font-black font-heading text-base">
                        {dashStats.ts.total ? Math.round((dashStats.ts.completed / dashStats.ts.total) * 100) : 0}%
                      </div>
                      <span className="text-zinc-600 text-[10px] uppercase font-bold">Progress</span>
                    </div>
                  </div>
                  {dashTasks.length === 0 ? (
                    <p className="text-zinc-500">No assigned tasks.</p>
                  ) : (
                    dashTasks.map((t) => (
                      <div key={t.id} className="border border-zinc-200 p-2.5 bg-zinc-50">
                        <p className="font-bold text-zinc-950">{t.title}</p>
                        <p className="text-xs text-zinc-600 mt-1">
                          {t.status} · {t.priority || "—"} · {t.projectName || "—"}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              )}
              {dashTab === "performance" && (
                <div className="space-y-4">
                  <div>
                    <div className="flex justify-between text-xs mb-1 font-bold">
                      <span className="text-zinc-700">Productivity score</span>
                      <span className="text-red-600">{dashStats.prod}%</span>
                    </div>
                    <div className="h-2.5 bg-zinc-200 overflow-hidden border border-zinc-300">
                      <div className="h-full bg-red-600" style={{ width: `${dashStats.prod}%` }} />
                    </div>
                    <p className="text-xs text-zinc-600 mt-1 font-medium">{performanceRating(dashStats.prod)}</p>
                  </div>
                  <div>
                    <div className="flex justify-between text-xs mb-1 font-bold">
                      <span className="text-zinc-700">Task completion</span>
                      <span className="text-zinc-900">
                        {dashStats.ts.total ? Math.round((dashStats.ts.completed / dashStats.ts.total) * 100) : 0}%
                      </span>
                    </div>
                    <div className="h-2.5 bg-zinc-200 overflow-hidden border border-zinc-300">
                      <div
                        className="h-full bg-zinc-900"
                        style={{
                          width: `${dashStats.ts.total ? Math.round((dashStats.ts.completed / dashStats.ts.total) * 100) : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                  <p className="text-xs text-zinc-700 pt-2 border-t border-zinc-200">
                    <strong className="text-zinc-900">Avg session (30d):</strong>{" "}
                    {perfWindow.length
                      ? Math.round((perfWindow.reduce((a, s) => a + sessionHours(s), 0) / perfWindow.length) * 10) / 10
                      : 0}
                    h
                  </p>
                </div>
              )}
              {dashTab === "payroll" && modalPayroll && (
                <div className="space-y-2 text-sm border-2 border-zinc-900 p-4 bg-zinc-50 shadow-[2px_2px_0px_0px_#09090b]">
                  <p>
                    <strong className="text-zinc-700">Regular / total hours:</strong> {modalPayroll.totalHours}h
                  </p>
                  <p>
                    <strong className="text-zinc-700">Overtime hours:</strong> {modalPayroll.overtimeHours}h
                  </p>
                  <p>
                    <strong className="text-zinc-700">Hourly rate:</strong> EGP {modalPayroll.hourlyRate}
                  </p>
                  <p>
                    <strong className="text-zinc-700">Base pay (est.):</strong> EGP {modalPayroll.basePay}
                  </p>
                  <p>
                    <strong className="text-zinc-700">Overtime pay:</strong> EGP {modalPayroll.overtimePay}
                  </p>
                  <p>
                    <strong className="text-red-700">Absence penalty:</strong> -EGP {modalPayroll.absencePenalty}
                  </p>
                  <p>
                    <strong className="text-red-700">Late penalties:</strong> -EGP {modalPayroll.totalLatePenaltyEgp} ({modalPayroll.lateDays}{" "}
                    late, {modalPayroll.veryLateDays} very late)
                  </p>
                  <p className="text-emerald-800 font-bold text-base pt-2 border-t-2 border-zinc-900">
                    Net (est. month-to-date): EGP {modalPayroll.totalPay}
                  </p>
                  <p className="text-xs text-zinc-500 mt-1">Uses session login time policy (11:00 / 12:00 thresholds) like legacy dashboard.</p>
                </div>
              )}
              {dashTab === "payroll" && !modalPayroll && <p className="text-zinc-500">No payroll data.</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
