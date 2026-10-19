"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import {
  collection,
  query,
  onSnapshot,
  doc,
  updateDoc,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { DEPARTMENTS } from "@/lib/admin/constants";
import { deleteWorkerCascade } from "@/lib/admin/deleteWorkerCascade";
import { sendExpoPushToWorkers } from "@/lib/chatNotifications";
import { notifyAdmins } from "@/lib/adminNotifications";
import { useUrlState } from "@/lib/admin/useUrlState";
import { toast, confirmDialog } from "@/lib/admin/feedback";
import { logActivity } from "@/lib/admin/activity";
import { downloadCsv } from "@/lib/admin/csv";
import { bulkSetSystemStartDate } from "@/lib/admin/hrSettings";
import { useHrLang } from "@/lib/admin/hrI18n";
import { BulkBar, BulkButton, EmptyState, PageHeader, SkeletonRows, STATE_ICONS } from "@/components/admin/ui/States";
import ModalPortal from "@/components/admin/ui/ModalPortal";
import WorkerLeaveProfileCard from "@/components/admin/hr/WorkerLeaveProfileCard";

interface WorkerTask {
  id: string;
  title: string;
  description?: string;
  projectId?: string | null;
  projectName?: string;
  department?: string;
  assignedTo?: string | string[];
  assignedWorkerName?: string;
  priority?: string;
  status: string;
  dueDate?: { toDate?: () => Date } | Date | string | null;
  photo?: string | null;
  createdAt?: { toDate?: () => Date } | Date | string | null;
}

interface Worker {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  role: string;
  experience?: string;
  status: string;
  isOnline?: boolean;
  presenceStatus?: "active" | "idle" | "offline";
  lastActiveCheckAt?: { toDate: () => Date };
  currentTaskTitle?: string;
  currentTaskNote?: string;
  department?: string;
  employmentType?: string;
  skills?: string[];
  expectedSalary?: number | string;
  hourlyRate?: number;
  expectedHours?: number;
  portfolioLink?: string;
  government?: string;
  city?: string;
  netspend?: string;
  emergencyContact?: string | Record<string, string>;
  completedTasks?: number;
  totalTasks?: number;
  expoPushToken?: string;
  createdAt?: { toDate: () => Date };
  lastLogin?: { toDate: () => Date };
  lastLogout?: { toDate: () => Date };
  hireDate?: string;
  attendanceStartDate?: string;
  leaveLawType?: "new_15" | "legacy_21";
  priorUsedLeaveDays?: number;
  carriedOverLeaveDays?: number;
  carryOverApprovedBy?: string;
}

interface ProjectOption {
  id: string;
  name: string;
}

function formatRole(role: string | undefined) {
  if (!role) return "OPERATOR";
  return role
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function formatDepartment(dept: string | undefined) {
  if (!dept) return "UNASSIGNED";
  return dept.charAt(0).toUpperCase() + dept.slice(1);
}

function formatEmploymentType(type: string | undefined) {
  if (!type) return "STANDARD";
  return type
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function formatTimestamp(ts: { toDate: () => Date } | undefined) {
  if (!ts?.toDate) return "UNKNOWN";
  return ts.toDate().toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function cleanPhoneForWhatsApp(phone: string | undefined) {
  if (!phone) return "";
  const cleaned = phone.replace(/[^0-9]/g, "");
  return cleaned;
}

function formatTaskDueDate(d: unknown) {
  if (!d) return "No due date";
  if (typeof (d as { toDate?: () => Date }).toDate === "function") {
    return (d as { toDate: () => Date }).toDate().toLocaleDateString();
  }
  if (d instanceof Date) return d.toLocaleDateString();
  if (typeof d === "string") return new Date(d).toLocaleDateString();
  return "No due date";
}

export default function AdminWorkersPage() {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [allTasks, setAllTasks] = useState<WorkerTask[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters (mirrored to the URL so they survive refresh / can be shared)
  const [searchFilter, setSearchFilter] = useUrlState("q");
  const [statusFilter, setStatusFilter] = useUrlState("status");
  const [roleFilter, setRoleFilter] = useUrlState("role");
  const [departmentFilter, setDepartmentFilter] = useUrlState("dept");
  const [onlineOnly, setOnlineOnly] = useUrlState("online");
  const [viewMode, setViewMode] = useUrlState("view", "table");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [assignModalWorker, setAssignModalWorker] = useState<Worker | null>(null);
  const [detailWorker, setDetailWorker] = useState<Worker | null>(null);
  const [onboardWorker, setOnboardWorker] = useState<Worker | null>(null);

  // Editing Task state
  const [editingTask, setEditingTask] = useState<WorkerTask | null>(null);
  const [editTaskForm, setEditTaskForm] = useState({
    title: "",
    description: "",
    projectId: "",
    projectName: "",
    department: "general",
    assignedWorkerIds: [] as string[],
    priority: "medium",
    status: "assigned",
    dueDate: "",
    photo: "",
    notificationMessage: "",
  });
  const [savingTask, setSavingTask] = useState(false);

  const [taskForm, setTaskForm] = useState({
    title: "",
    description: "",
    projectId: "",
    projectName: "",
    department: "general",
    priority: "medium",
    dueDate: "",
    notificationMessage: "",
  });

  useEffect(() => {
    const q = query(collection(db, "workers"));
    return onSnapshot(
      q,
      (snap) => {
        const items: Worker[] = [];
        snap.forEach((d) => items.push({ id: d.id, ...d.data() } as Worker));
        setWorkers(items);
        setLoading(false);
      },
      (err) => {
        console.error("Error loading workers:", err);
        setLoading(false);
      },
    );
  }, []);

  useEffect(() => {
    return onSnapshot(collection(db, "projects"), (snap) => {
      const list: ProjectOption[] = [];
      snap.forEach((d) => {
        const data = d.data();
        list.push({ id: d.id, name: data.name || "Untitled Project" });
      });
      setProjects(list);
    });
  }, []);

  useEffect(() => {
    const q = query(collection(db, "tasks"));
    return onSnapshot(
      q,
      (snap) => {
        const items: WorkerTask[] = [];
        snap.forEach((d) => items.push({ id: d.id, ...d.data() } as WorkerTask));
        items.sort((a, b) => {
          const ta = a.createdAt && typeof (a.createdAt as { toDate?: () => Date }).toDate === "function"
            ? (a.createdAt as { toDate: () => Date }).toDate().getTime()
            : a.createdAt instanceof Date ? a.createdAt.getTime()
            : typeof a.createdAt === "string" ? new Date(a.createdAt).getTime() : 0;
          const tb = b.createdAt && typeof (b.createdAt as { toDate?: () => Date }).toDate === "function"
            ? (b.createdAt as { toDate: () => Date }).toDate().getTime()
            : b.createdAt instanceof Date ? b.createdAt.getTime()
            : typeof b.createdAt === "string" ? new Date(b.createdAt).getTime() : 0;
          return tb - ta;
        });
        setAllTasks(items);
      },
      (err) => {
        console.error("Error loading tasks for workers:", err);
      },
    );
  }, []);

  // Compute tasks assigned to the worker currently in detail view
  const workerAssignedTasks = useMemo(() => {
    if (!detailWorker) return [];
    return allTasks.filter((t) => {
      if (!t.assignedTo) return false;
      if (Array.isArray(t.assignedTo)) return t.assignedTo.includes(detailWorker.id);
      return t.assignedTo === detailWorker.id;
    });
  }, [detailWorker, allTasks]);

  const openEditWorkerTask = (task: WorkerTask) => {
    let dueDateStr = "";
    if (task.dueDate) {
      if (typeof (task.dueDate as { toDate?: () => Date }).toDate === "function") {
        const d = (task.dueDate as { toDate: () => Date }).toDate();
        const pad = (n: number) => n.toString().padStart(2, "0");
        dueDateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      } else if (task.dueDate instanceof Date) {
        const pad = (n: number) => n.toString().padStart(2, "0");
        dueDateStr = `${task.dueDate.getFullYear()}-${pad(task.dueDate.getMonth() + 1)}-${pad(task.dueDate.getDate())}`;
      } else if (typeof task.dueDate === "string") {
        dueDateStr = (task.dueDate as string).split("T")[0];
      }
    }
    const assignedIds = Array.isArray(task.assignedTo)
      ? task.assignedTo
      : task.assignedTo
      ? [task.assignedTo]
      : [];
    setEditTaskForm({
      title: task.title || "",
      description: task.description || "",
      projectId: task.projectId || "",
      projectName: task.projectName || (task.projectId ? projects.find((p) => p.id === task.projectId)?.name || "" : ""),
      department: task.department || "general",
      assignedWorkerIds: assignedIds,
      priority: task.priority || "medium",
      status: task.status || "assigned",
      dueDate: dueDateStr,
      photo: task.photo || "",
      notificationMessage: "",
    });
    setEditingTask(task);
  };

  const submitEditWorkerTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTask) return;
    if (!editTaskForm.title.trim()) {
      toast.warning("Please enter a task title");
      return;
    }
    if (editTaskForm.assignedWorkerIds.length === 0) {
      toast.warning("Select at least one worker");
      return;
    }

    setSavingTask(true);
    try {
      let projName = editTaskForm.projectName;
      if (editTaskForm.projectId) {
        const p = projects.find((x) => x.id === editTaskForm.projectId);
        if (p) projName = p.name;
      }

      const assignedWorkerNames = editTaskForm.assignedWorkerIds
        .map((id) => {
          const w = workers.find((x) => x.id === id);
          return w ? `${w.firstName} ${w.lastName}` : id;
        })
        .join(", ");

      const assignedTo =
        editTaskForm.assignedWorkerIds.length === 1
          ? editTaskForm.assignedWorkerIds[0]
          : editTaskForm.assignedWorkerIds;

      const updatePayload: Record<string, unknown> = {
        title: editTaskForm.title.trim(),
        description: editTaskForm.description.trim(),
        projectId: editTaskForm.projectId || null,
        projectName: projName || "Direct Operation",
        department: editTaskForm.department || "general",
        assignedTo,
        assignedWorkerName: assignedWorkerNames,
        priority: editTaskForm.priority || "medium",
        status: editTaskForm.status || "assigned",
        dueDate: editTaskForm.dueDate ? new Date(editTaskForm.dueDate) : null,
        photo: editTaskForm.photo.trim() || null,
        updatedAt: serverTimestamp(),
      };

      await updateDoc(doc(db, "tasks", editingTask.id), updatePayload);

      for (const workerId of editTaskForm.assignedWorkerIds) {
        await addDoc(collection(db, "alerts"), {
          recipients: [workerId],
          title: "Task Directive Updated",
          message:
            editTaskForm.notificationMessage.trim() || `Task directive updated: ${editTaskForm.title}`,
          type: "schedule",
          priority: editTaskForm.priority || "medium",
          isRead: false,
          createdAt: serverTimestamp(),
          sentAt: serverTimestamp(),
          sentBy: "System",
        });
      }

      if (editTaskForm.assignedWorkerIds.length > 0) {
        void sendExpoPushToWorkers(db, {
          recipientUids: editTaskForm.assignedWorkerIds,
          title: "Task Directive Updated",
          body: editTaskForm.notificationMessage.trim() || `Task directive updated: ${editTaskForm.title}`,
          taskId: editingTask.id,
          taskTitle: editTaskForm.title,
        }).catch(() => {});
      }

      void notifyAdmins(db, {
        targetRoles: ["super_admin", "ops_admin"],
        category: "task",
        eventType: "task_updated",
        title: `✏️ Task Updated: ${editTaskForm.title.trim()}`,
        body: `${auth.currentUser?.email || "Admin"} updated "${editTaskForm.title.trim()}" (assigned to ${assignedWorkerNames}).`,
        href: `/admin/tasks?task=${encodeURIComponent(editingTask.id)}`,
        actorUid: auth.currentUser?.uid,
        actorName: auth.currentUser?.email || "Admin",
        taskId: editingTask.id,
        projectId: editTaskForm.projectId || undefined,
      });

      void logActivity({ action: "updated", entity: "task", entityId: editingTask.id, label: editTaskForm.title.trim(), detail: `Assigned to ${assignedWorkerNames}` });
      toast.success("Task updated", { description: "Assigned workers were notified." });
      setEditingTask(null);
    } catch (err) {
      console.error("Failed to update task:", err);
      toast.error("Failed to update task", { description: err instanceof Error ? err.message : undefined });
    } finally {
      setSavingTask(false);
    }
  };

  // Collect unique roles dynamically from loaded data for accurate filter options
  const uniqueRoles = useMemo(() => {
    const set = new Set<string>();
    workers.forEach((w) => {
      if (w.role) set.add(w.role);
    });
    return Array.from(set).sort();
  }, [workers]);

  const filteredWorkers = useMemo(() => {
    const q = searchFilter.trim().toLowerCase();
    return workers.filter((w) => {
      if (statusFilter && w.status !== statusFilter) return false;
      if (roleFilter && w.role !== roleFilter) return false;
      if (departmentFilter && (w.department || "") !== departmentFilter) return false;
      if (onlineOnly && !w.isOnline) return false;
      if (!q) return true;

      const skillsStr = Array.isArray(w.skills) ? w.skills.join(" ") : "";
      const blob = `${w.firstName} ${w.lastName} ${w.email} ${w.role} ${w.phone || ""} ${w.government || ""} ${w.city || ""} ${w.department || ""} ${skillsStr}`.toLowerCase();
      return blob.includes(q);
    });
  }, [workers, searchFilter, statusFilter, roleFilter, departmentFilter, onlineOnly]);

  const clearWorkerFilters = () => {
    setSearchFilter("");
    setRoleFilter("");
    setDepartmentFilter("");
    setOnlineOnly("");
  };

  /** Live open / completed task counts per worker (from the tasks collection). */
  const taskCounts = useMemo(() => {
    const m = new Map<string, { open: number; done: number }>();
    allTasks.forEach((t) => {
      const ids = Array.isArray(t.assignedTo) ? t.assignedTo : t.assignedTo ? [t.assignedTo] : [];
      ids.forEach((id) => {
        const c = m.get(id) ?? { open: 0, done: 0 };
        if (t.status === "completed") c.done++;
        else c.open++;
        m.set(id, c);
      });
    });
    return m;
  }, [allTasks]);

  const workerLabel = (w: Worker) => `${w.firstName} ${w.lastName}`.trim();

  const setWorkerStatus = async (ids: string[], status: "approved" | "rejected") => {
    setBulkBusy(true);
    try {
      await Promise.all(ids.map((id) => updateDoc(doc(db, "workers", id), { status })));
      void sendExpoPushToWorkers(db, {
        recipientUids: ids,
        title: status === "approved" ? "Account Approved 🎉" : "Account Status Update",
        body:
          status === "approved"
            ? "Your MFT worker account has been approved! You can now sign in and start your shift."
            : "Your MFT worker registration was not approved.",
        tab: "tasks",
        urgent: status === "rejected",
      }).catch(() => {});
      ids.forEach((id) => {
        const w = workers.find((x) => x.id === id);
        const label = w ? workerLabel(w) : id;
        void logActivity({ action: status === "approved" ? "approved" : "rejected", entity: "worker", entityId: id, label, detail: w?.email });
        void notifyAdmins(db, {
          targetRoles: ["super_admin", "hr_admin"],
          category: "hr",
          eventType: `worker_${status}`,
          title: `${status === "approved" ? "✅ Worker Approved" : "❌ Worker Rejected"}: ${label}`,
          body: `${auth.currentUser?.email || "HR"} ${status} worker account for ${label} (${w?.email || ""}).`,
          href: `/admin/workers?status=${status}`,
          actorUid: auth.currentUser?.uid,
          actorName: auth.currentUser?.email || "HR",
        });
      });
      const one = ids.length === 1 ? workers.find((x) => x.id === ids[0]) : null;
      toast.success(
        one ? `${workerLabel(one)} ${status === "approved" ? "approved" : "rejected"}` : `${ids.length} workers ${status}`,
        status === "approved" ? { description: "They can now sign in to the mobile app." } : undefined,
      );
      setSelected(new Set());
    } catch (err) {
      toast.error("Couldn't update worker status", { description: err instanceof Error ? err.message : undefined });
    } finally {
      setBulkBusy(false);
    }
  };

  const approveWorker = (id: string) => setWorkerStatus([id], "approved");
  const rejectWorker = (id: string) => setWorkerStatus([id], "rejected");

  const handleDeleteWorker = async (worker: Worker) => {
    const name = workerLabel(worker);
    const ok = await confirmDialog({
      title: `Delete ${name}?`,
      message: "This permanently removes the worker together with their work sessions and task links. This can't be undone.",
      tone: "danger",
      confirmLabel: "Delete worker",
      requireText: "DELETE",
    });
    if (!ok) return;

    setDeletingId(worker.id);
    try {
      await deleteWorkerCascade(worker.id);
      if (detailWorker?.id === worker.id) setDetailWorker(null);
      void logActivity({ action: "deleted", entity: "worker", entityId: worker.id, label: name, detail: worker.email });
      toast.success(`${name} deleted`);
    } catch (e) {
      console.error(e);
      toast.error("Delete failed", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setDeletingId(null);
    }
  };

  const bulkDelete = async (ids: string[]) => {
    const ok = await confirmDialog({
      title: `Delete ${ids.length} workers?`,
      message: "All selected workers and their work sessions and task links will be permanently removed.",
      tone: "danger",
      confirmLabel: `Delete ${ids.length}`,
      requireText: "DELETE",
    });
    if (!ok) return;
    setBulkBusy(true);
    let failed = 0;
    for (const id of ids) {
      try {
        await deleteWorkerCascade(id);
        const w = workers.find((x) => x.id === id);
        void logActivity({ action: "deleted", entity: "worker", entityId: id, label: w ? workerLabel(w) : id });
      } catch {
        failed++;
      }
    }
    setBulkBusy(false);
    setSelected(new Set());
    if (failed) toast.error(`${failed} of ${ids.length} deletions failed`);
    else toast.success(`${ids.length} workers deleted`);
  };

  const exportWorkers = (list: Worker[]) => {
    downloadCsv(
      [
        ["First name", "Last name", "Email", "Phone", "Role", "Department", "Status", "Employment", "Hourly rate", "City", "Skills", "Joined"],
        ...list.map((w) => [
          w.firstName,
          w.lastName,
          w.email,
          w.phone || "",
          w.role || "",
          w.department || "",
          w.status,
          w.employmentType || "",
          w.hourlyRate ?? "",
          [w.government, w.city].filter(Boolean).join(", "),
          (w.skills || []).join("; "),
          w.createdAt?.toDate ? w.createdAt.toDate().toLocaleDateString() : "",
        ]),
      ],
      `workers_${new Date().toISOString().split("T")[0]}.csv`,
    );
    toast.success(`Exported ${list.length} workers`);
  };

  const openAssignModal = (worker: Worker) => {
    setAssignModalWorker(worker);
    setTaskForm({
      title: "",
      description: "",
      projectId: "",
      projectName: "",
      department: worker.department || "general",
      priority: "medium",
      dueDate: "",
      notificationMessage: "",
    });
  };

  const handleAssignTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignModalWorker) return;

    let selectedProjectName = taskForm.projectName;
    if (taskForm.projectId) {
      const proj = projects.find((p) => p.id === taskForm.projectId);
      if (proj) selectedProjectName = proj.name;
    }

    const assignedWorkerFullName = `${assignModalWorker.firstName} ${assignModalWorker.lastName}`.trim();
    const taskRef = await addDoc(collection(db, "tasks"), {
      title: taskForm.title,
      description: taskForm.description,
      projectId: taskForm.projectId || null,
      projectName: selectedProjectName || "Direct Operation",
      department: taskForm.department || "general",
      priority: taskForm.priority || "medium",
      assignedTo: assignModalWorker.id,
      assignedWorkerName: assignedWorkerFullName,
      dueDate: taskForm.dueDate ? new Date(taskForm.dueDate) : null,
      status: "assigned",
      createdAt: serverTimestamp(),
      assignedAt: serverTimestamp(),
    });

    await addDoc(collection(db, "alerts"), {
      recipients: [assignModalWorker.id],
      title: "New Task Assigned",
      message: taskForm.notificationMessage || `You have been assigned to task: ${taskForm.title}`,
      type: "schedule",
      priority: taskForm.priority || "medium",
      isRead: false,
      createdAt: serverTimestamp(),
      sentAt: serverTimestamp(),
      sentBy: "System",
    });

    void sendExpoPushToWorkers(db, {
      recipientUids: [assignModalWorker.id],
      title: "New Task Assigned 📋",
      body: taskForm.notificationMessage || `You have been assigned to task: ${taskForm.title}`,
      taskId: taskRef.id,
      taskTitle: taskForm.title,
      tab: "tasks",
    }).catch(() => {});

    void notifyAdmins(db, {
      targetRoles: ["super_admin", "ops_admin"],
      category: "task",
      eventType: "task_created",
      title: `📋 New Task Assigned: ${taskForm.title}`,
      body: `${auth.currentUser?.email || "Admin"} assigned "${taskForm.title}" to ${assignedWorkerFullName}.`,
      href: `/admin/tasks?task=${encodeURIComponent(taskRef.id)}`,
      actorUid: auth.currentUser?.uid,
      actorName: auth.currentUser?.email || "Admin",
      taskId: taskRef.id,
      projectId: taskForm.projectId || undefined,
    });

    setAssignModalWorker(null);
    void logActivity({ action: "assigned", entity: "task", label: taskForm.title, detail: `To ${assignedWorkerFullName}` });
    toast.success("Task assigned", { description: `"${taskForm.title}" was sent to ${assignedWorkerFullName}.` });
  };

  const { isAr, dir, toggleLang, t } = useHrLang();
  const todayStr = new Date().toISOString().split("T")[0];

  const stats = {
    total: workers.length,
    approved: workers.filter((w) => w.status === "approved").length,
    pending: workers.filter((w) => w.status === "pending").length,
    rejected: workers.filter((w) => w.status === "rejected").length,
    online: workers.filter((w) => w.isOnline).length,
    missingHire: workers.filter((w) => w.status === "approved" && !w.hireDate).length,
  };

  const handleBulkStartToday = async () => {
    const approvedIds = workers.filter((w) => w.status === "approved").map((w) => w.id);
    if (!approvedIds.length) return;
    const ok = await confirmDialog({
      title: t(
        `ضبط تاريخ بدء الحساب بالنظام إلى اليوم (${todayStr})؟`,
        `Set System Attendance Start Date to Today (${todayStr})?`,
      ),
      message: t(
        `سيتم ضبط تاريخ بدء الحساب بالنظام لجميع الموظفين المعتمدين (${approvedIds.length}) إلى ${todayStr} لمنع احتساب أي غياب عن الأيام السابقة.`,
        `This sets the MFT attendance start date to ${todayStr} for all ${approvedIds.length} approved workers so payroll will not penalize past days as absences.`,
      ),
      confirmLabel: t(`تطبيق على ${approvedIds.length} موظف`, `Apply to ${approvedIds.length} workers`),
    });
    if (!ok) return;
    setBulkBusy(true);
    try {
      await bulkSetSystemStartDate(approvedIds, todayStr);
      toast.success(
        t(
          `تم ضبط تاريخ بدء النظام إلى ${todayStr} لجميع الموظفين`,
          `System start date set to ${todayStr} for all approved workers`,
        ),
      );
    } catch (e) {
      toast.error(t("فشل التحديث الجماعي", "Bulk update failed"), {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBulkBusy(false);
    }
  };

  const tabs = [
    { key: "", label: t("الكل", "All"), count: stats.total },
    { key: "approved", label: t("المعتمدون", "Approved"), count: stats.approved },
    { key: "pending", label: t("بانتظار الموافقة", "Pending"), count: stats.pending },
    { key: "rejected", label: t("مرفوض", "Rejected"), count: stats.rejected },
  ];
  const hasFilters = !!(searchFilter || roleFilter || departmentFilter || onlineOnly);
  const allSelected = filteredWorkers.length > 0 && filteredWorkers.every((w) => selected.has(w.id));
  const toggleSel = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const selectedIds = [...selected];
  const selectedPending = selectedIds.filter((id) => workers.find((w) => w.id === id)?.status === "pending");
  const STATUS_CHIP: Record<string, string> = {
    approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
    pending: "bg-amber-50 text-amber-700 border-amber-200",
    rejected: "bg-red-50 text-red-700 border-red-200",
  };
  const initialsOf = (w: Worker) => `${w.firstName?.[0] ?? ""}${w.lastName?.[0] ?? ""}`.toUpperCase() || "?";
  const relTime = (ts?: { toDate: () => Date }) => {
    if (!ts?.toDate) return t("أبدًا", "Never");
    const s = Math.floor((Date.now() - ts.toDate().getTime()) / 1000);
    if (s < 60) return t("الآن", "Just now");
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    if (s < 86400) return `${Math.floor(s / 3600)}h`;
    if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`;
    return ts.toDate().toLocaleDateString();
  };
  const IconBtn = ({ onClick, title, d, tone = "default", disabled }: { onClick: () => void; title: string; d: string; tone?: "default" | "success" | "danger"; disabled?: boolean }) => (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-lg p-1.5 transition-colors disabled:opacity-40 cursor-pointer ${
        tone === "success" ? "text-emerald-600 hover:bg-emerald-50" : tone === "danger" ? "text-zinc-400 hover:bg-red-50 hover:text-red-600" : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
      }`}
    >
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d={d} />
      </svg>
    </button>
  );
  const ICON_PATH = {
    approve: "M5 13l4 4L19 7",
    reject: "M6 18L18 6M6 6l12 12",
    assign: "M12 4v16m8-8H4",
    view: "M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z",
    trash: "M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16",
    whatsapp: "M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z",
  };

  return (
    <div dir={dir} className="space-y-5 pb-24">
      <PageHeader
        title={t("سجل الموظفين (Workers)", "Workers")}
        description={t(
          "إدارة الموظفين، اعتماد الحسابات الجديدة، ضبط تاريخ التعيين والراتب، وإسناد المهام.",
          "Team roster, registration approvals, joining dates, hourly rates, and task assignment.",
        )}
        actions={
          <>
            <button
              type="button"
              onClick={toggleLang}
              className="rounded-lg border-2 border-red-600 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-600 hover:text-white cursor-pointer transition-colors"
            >
              🌐 {isAr ? "English (EN)" : "العربية (AR)"}
            </button>
            <Link
              href="/admin/hr?tab=compliance"
              className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-bold text-zinc-900 hover:bg-zinc-100"
            >
              {t("🗓️ سجل الأذونات والإجازات", "🗓️ HR Leave & Quotas")}
            </Link>
            <div className="flex gap-1 rounded-lg bg-zinc-100 p-1">
              {[
                ["table", t("جدول", "Table"), "M3 10h18M3 14h18M3 6h18M3 18h18"],
                ["cards", t("بطاقات", "Cards"), "M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"],
              ].map(([k, l, d]) => (
                <button
                  key={k}
                  type="button"
                  title={l}
                  onClick={() => setViewMode(k)}
                  className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-all cursor-pointer ${viewMode === k ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-800"}`}
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d={d} />
                  </svg>
                  {l}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => exportWorkers(filteredWorkers)} disabled={!filteredWorkers.length} className="brutal-btn-outline normal-case tracking-normal disabled:opacity-50">
              {t("تصدير CSV", "Export CSV")}
            </button>
          </>
        }
      />

      {/* Existing Staff Onboarding Banner (HR-POL-2026) */}
      {!loading && stats.approved > 0 && (
        <div className="rounded-xl border-2 border-zinc-900 bg-white p-4 shadow-[3px_3px_0px_0px_#dc2626] flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="rounded bg-red-600 px-2 py-0.5 text-[10px] font-bold uppercase text-white">
                HR-POL-2026
              </span>
              <h3 className="text-sm font-bold text-zinc-900">
                {t(
                  "إعداد الموظفين الحاليين والجدد (تاريخ التعيين · بدء النظام · الراتب · رصيد الإجازات)",
                  "Worker Onboarding & Tenure Control (Joining Date · System Start · Rate · Leave)",
                )}
              </h3>
            </div>
            <p className="text-xs text-zinc-600">
              {t(
                `اضغط على زر «🗓️ التعيين والراتب» أمام أي موظف لتحديد تاريخ التحاقه بالشركة وأجر الساعة وتاريخ بدء الحساب بالنظام الجديد.${stats.missingHire > 0 ? ` (${stats.missingHire} موظف بحاجة لتحديد تاريخ التعيين)` : ""}`,
                `Click "🗓️ Set Joining Date & Rate" on any worker to set their Company Joining Date, Hourly Rate, and MFT Attendance Start Date.${stats.missingHire > 0 ? ` (${stats.missingHire} worker(s) still need a joining date)` : ""}`,
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={bulkBusy}
              onClick={() => void handleBulkStartToday()}
              className="rounded-lg bg-emerald-600 hover:bg-emerald-700 px-3 py-2 text-xs font-bold text-white cursor-pointer disabled:opacity-50"
            >
              {t("⚡ ضبط بدء النظام للكل = اليوم", "⚡ Set All System Start = Today")}
            </button>
            <Link
              href="/admin/hr?tab=compliance"
              className="rounded-lg bg-zinc-900 hover:bg-zinc-800 px-3 py-2 text-xs font-bold text-white"
            >
              {t("فتح جدول التعديل الجماعي ←", "Bulk Edit All Dates →")}
            </Link>
          </div>
        </div>
      )}

      {/* Stat strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          { label: t("إجمالي الموظفين", "Total workers"), value: stats.total, bar: "bg-zinc-400", onClick: () => setStatusFilter("") },
          { label: t("المعتمدون", "Approved"), value: stats.approved, bar: "bg-emerald-500", onClick: () => setStatusFilter("approved") },
          { label: t("بانتظار الموافقة", "Awaiting approval"), value: stats.pending, bar: "bg-amber-500", onClick: () => setStatusFilter("pending") },
          { label: t("المرفوضون", "Rejected"), value: stats.rejected, bar: "bg-red-500", onClick: () => setStatusFilter("rejected") },
          { label: t("متصلون الآن", "Online now"), value: stats.online, bar: "bg-sky-500", onClick: () => setOnlineOnly(onlineOnly ? "" : "1") },
        ].map((s) => (
          <button key={s.label} type="button" onClick={s.onClick} className="ui-card ui-card-hover relative overflow-hidden px-4 py-3 text-start cursor-pointer">
            <span className={`absolute start-0 top-0 h-full w-1 ${s.bar}`} />
            <p className="text-[11px] font-medium text-zinc-500">{s.label}</p>
            <p className="mt-1 text-2xl font-bold tracking-tight text-zinc-900">{loading ? "–" : s.value}</p>
          </button>
        ))}
      </div>

      {/* Pending banner */}
      {!loading && stats.pending > 0 && statusFilter !== "pending" && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-100 text-amber-700">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </span>
          <p className="flex-1 text-sm text-zinc-800">
            <span className="font-semibold">
              {t(`${stats.pending} طلب تسجيل جديد`, `${stats.pending} new registration${stats.pending === 1 ? "" : "s"}`)}
            </span>{" "}
            {t("بانتظار مراجعتك واعتماد تاريخ التعيين.", "waiting for your approval.")}
          </p>
          <button type="button" onClick={() => setStatusFilter("pending")} className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-700 cursor-pointer">
            {t("مراجعة الآن", "Review now")}
          </button>
        </div>
      )}

      {/* Tabs + filters */}
      <div className="ui-card overflow-hidden">
        <div className="flex flex-wrap items-center gap-1 border-b border-zinc-100 px-3 pt-2">
          {tabs.map((tab) => (
            <button
              key={tab.key || "all"}
              type="button"
              id={`workers-tab-${tab.key || "all"}`}
              onClick={() => setStatusFilter(tab.key)}
              className={`relative flex items-center gap-2 px-3 pb-2.5 pt-1.5 text-[13px] font-medium transition-colors cursor-pointer ${statusFilter === tab.key ? "text-zinc-900" : "text-zinc-500 hover:text-zinc-800"}`}
            >
              {tab.label}
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${statusFilter === tab.key ? "bg-zinc-900 text-white" : tab.key === "pending" && tab.count ? "bg-amber-100 text-amber-700" : "bg-zinc-100 text-zinc-600"}`}>{tab.count}</span>
              {statusFilter === tab.key && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-red-600" />}
            </button>
          ))}
          <span className="ms-auto pb-2 text-[11px] text-zinc-400">
            {filteredWorkers.length} / {workers.length}
          </span>
        </div>
        <div className="flex flex-col gap-2 p-3 md:flex-row md:items-center">
          <div className="relative flex-1">
            <svg className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d={STATE_ICONS.search} />
            </svg>
            <input id="workers-search" value={searchFilter} onChange={(e) => setSearchFilter(e.target.value)} placeholder={t("ابحث بالاسم أو البريد أو المدينة أو المهارات…", "Search name, email, city, skills…")} className="brutal-input ps-9" />
          </div>
          <select value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)} className="brutal-input md:w-44" aria-label="Department">
            <option value="">{t("كل الأقسام", "All departments")}</option>
            {DEPARTMENTS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
          <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="brutal-input md:w-44" aria-label="Role">
            <option value="">{t("كل الوظائف", "All roles")}</option>
            {uniqueRoles.map((r) => (
              <option key={r} value={r}>
                {formatRole(r)}
              </option>
            ))}
          </select>
          <label className="flex shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-600">
            <input type="checkbox" className="mft-check" checked={!!onlineOnly} onChange={(e) => setOnlineOnly(e.target.checked ? "1" : "")} />
            {t("المتصلون فقط", "Online only")}
          </label>
          {hasFilters && (
            <button type="button" onClick={clearWorkerFilters} className="px-2 text-xs font-medium text-zinc-500 hover:text-zinc-900 cursor-pointer">
              {t("إعادة ضبط", "Reset")}
            </button>
          )}
        </div>
      </div>

      {/* Roster */}
      {loading ? (
        <div className="ui-card">
          <SkeletonRows rows={8} cols={4} />
        </div>
      ) : workers.length === 0 ? (
        <div className="ui-card">
          <EmptyState icon={STATE_ICONS.users} title="No workers yet" description="Workers appear here as soon as they register from the mobile app." />
        </div>
      ) : filteredWorkers.length === 0 ? (
        <div className="ui-card">
          <EmptyState
            icon={STATE_ICONS.search}
            title={statusFilter === "pending" && !hasFilters ? "No pending registrations" : "No workers match"}
            description={statusFilter === "pending" && !hasFilters ? "Every registration has been reviewed." : "Try a different tab or clear filters."}
            action={
              hasFilters ? (
                <button type="button" onClick={clearWorkerFilters} className="brutal-btn-outline normal-case tracking-normal">
                  Clear filters
                </button>
              ) : undefined
            }
          />
        </div>
      ) : viewMode === "cards" ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filteredWorkers.map((worker) => {
            const tc = taskCounts.get(worker.id) ?? { open: 0, done: 0 };
            const isSel = selected.has(worker.id);
            return (
              <article key={worker.id} className={`ui-card ui-card-hover flex flex-col p-4 ${isSel ? "ring-2 ring-red-500/40" : ""}`}>
                <div className="flex items-start gap-3">
                  <input type="checkbox" className="mft-check mt-1" checked={isSel} onChange={() => toggleSel(worker.id)} aria-label={`Select ${workerLabel(worker)}`} />
                  <button type="button" onClick={() => setDetailWorker(worker)} className="flex min-w-0 flex-1 items-start gap-3 text-left cursor-pointer">
                    <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-zinc-700 to-zinc-900 text-sm font-bold text-white">
                      {initialsOf(worker)}
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-white ${
                          worker.isOnline
                            ? worker.presenceStatus === "idle"
                              ? "bg-red-600 animate-ping"
                              : "bg-emerald-500"
                            : "bg-zinc-300"
                        }`}
                      />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-zinc-900">{workerLabel(worker)}</span>
                      <span className="block truncate text-xs text-zinc-500">
                        {formatRole(worker.role)} · {formatDepartment(worker.department)}
                      </span>
                      {worker.isOnline && (
                        <span className={`block truncate text-[11px] font-medium mt-0.5 ${worker.presenceStatus === "idle" ? "text-red-600 font-bold" : "text-emerald-600"}`}>
                          {worker.presenceStatus === "idle"
                            ? "⚠️ Station Idle (Missed check)"
                            : worker.currentTaskTitle
                            ? `📌 ${worker.currentTaskTitle}`
                            : "🟢 Active (2h verified)"}
                        </span>
                      )}
                    </span>
                  </button>
                  <span className={`shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-semibold capitalize ${STATUS_CHIP[worker.status] ?? STATUS_CHIP.pending}`}>{worker.status}</span>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 rounded-lg bg-zinc-50 p-2.5 text-center">
                  <div>
                    <p className="text-sm font-semibold text-zinc-900">{tc.open}</p>
                    <p className="text-[10px] text-zinc-500">{t("مهام مفتوحة", "Open tasks")}</p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-emerald-600">{tc.done}</p>
                    <p className="text-[10px] text-zinc-500">{t("مكتملة", "Completed")}</p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-zinc-900">{worker.hourlyRate ?? 31.25}</p>
                    <p className="text-[10px] text-zinc-500">{t("ج.م / ساعة", "EGP / h")}</p>
                  </div>
                </div>
                {worker.skills && worker.skills.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1">
                    {worker.skills.slice(0, 4).map((s, i) => (
                      <span key={i} className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600">
                        {s}
                      </span>
                    ))}
                    {worker.skills.length > 4 && <span className="text-[10px] text-zinc-400">+{worker.skills.length - 4}</span>}
                  </div>
                )}
                <div className="mt-3 flex items-center justify-between rounded-lg border border-zinc-200 bg-zinc-50/70 px-2.5 py-1.5 text-xs">
                  <span className="text-zinc-500">
                    {t("التعيين:", "Joined:")}{" "}
                    <strong className={worker.hireDate ? "text-zinc-900" : "text-amber-600"}>
                      {worker.hireDate || t("غير محدد ⚠", "Not set ⚠")}
                    </strong>
                  </span>
                  <button
                    type="button"
                    onClick={() => setOnboardWorker(worker)}
                    className="text-[11px] font-bold text-red-600 hover:underline cursor-pointer"
                  >
                    🗓️ {t("تحديد التعيين والراتب", "Set Date & Rate")}
                  </button>
                </div>
                <div className="mt-auto flex items-center gap-1 border-t border-zinc-100 pt-3 mt-3">
                  {worker.status === "pending" ? (
                    <>
                      <button type="button" disabled={bulkBusy} onClick={() => setOnboardWorker(worker)} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 cursor-pointer">
                        {t("اعتماد وتحديد التعيين", "Approve & Set Date")}
                      </button>
                      <button type="button" disabled={bulkBusy} onClick={() => void rejectWorker(worker.id)} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 cursor-pointer">
                        {t("رفض", "Reject")}
                      </button>
                    </>
                  ) : (
                    <button type="button" onClick={() => openAssignModal(worker)} className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-zinc-800 cursor-pointer">
                      {t("إسناد مهمة", "Assign task")}
                    </button>
                  )}
                  <span className="ms-auto flex items-center">
                    {cleanPhoneForWhatsApp(worker.phone) && (
                      <a href={`https://wa.me/${cleanPhoneForWhatsApp(worker.phone)}`} target="_blank" rel="noreferrer" title="WhatsApp" className="rounded-lg p-1.5 text-zinc-500 hover:bg-emerald-50 hover:text-emerald-600">
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                          <path strokeLinecap="round" strokeLinejoin="round" d={ICON_PATH.whatsapp} />
                        </svg>
                      </a>
                    )}
                    <IconBtn title={t("عرض الملف", "View profile")} d={ICON_PATH.view} onClick={() => setDetailWorker(worker)} />
                    <IconBtn title={t("حذف الموظف", "Delete worker")} d={ICON_PATH.trash} tone="danger" disabled={deletingId === worker.id} onClick={() => void handleDeleteWorker(worker)} />
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="ui-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="border-b border-zinc-100 bg-zinc-50 text-start text-[11px] font-semibold text-zinc-500">
                <tr>
                  <th className="w-10 px-4 py-2.5">
                    <input type="checkbox" className="mft-check" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(filteredWorkers.map((w) => w.id)))} aria-label="Select all" />
                  </th>
                  <th className="px-2 py-2.5">{t("الموظف", "Worker")}</th>
                  <th className="px-4 py-2.5">{t("الوظيفة والقسم", "Role & department")}</th>
                  <th className="px-4 py-2.5">{t("تاريخ التعيين والراتب", "Joined & Rate")}</th>
                  <th className="px-4 py-2.5">{t("الحالة", "Status")}</th>
                  <th className="px-4 py-2.5">{t("المهام", "Tasks")}</th>
                  <th className="px-4 py-2.5">{t("الموقع", "Location")}</th>
                  <th className="px-4 py-2.5">{t("آخر ظهور", "Last seen")}</th>
                  <th className="px-4 py-2.5 text-end">{t("إجراءات", "Actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {filteredWorkers.map((worker) => {
                  const tc = taskCounts.get(worker.id) ?? { open: 0, done: 0 };
                  const total = tc.open + tc.done;
                  const isSel = selected.has(worker.id);
                  return (
                    <tr key={worker.id} className={`group transition-colors ${isSel ? "bg-red-50/50" : "hover:bg-zinc-50"}`}>
                      <td className="px-4 py-3">
                        <input type="checkbox" className="mft-check" checked={isSel} onChange={() => toggleSel(worker.id)} aria-label={`Select ${workerLabel(worker)}`} />
                      </td>
                      <td className="px-2 py-3">
                        <button type="button" onClick={() => setDetailWorker(worker)} className="flex items-center gap-3 text-start cursor-pointer">
                          <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[11px] font-bold text-zinc-600">
                            {initialsOf(worker)}
                            <span
                              className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-white ${
                                worker.isOnline
                                  ? worker.presenceStatus === "idle"
                                    ? "bg-red-600 animate-ping"
                                    : "bg-emerald-500"
                                  : "bg-zinc-300"
                              }`}
                            />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-zinc-900 group-hover:text-red-600">{workerLabel(worker)}</span>
                            <span className="block truncate text-[11px] text-zinc-500">{worker.email}</span>
                          </span>
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-zinc-800">{formatRole(worker.role)}</p>
                        <p className="text-[11px] text-zinc-500">
                          {formatDepartment(worker.department)}
                          {worker.employmentType ? ` · ${formatEmploymentType(worker.employmentType)}` : ""}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <button
                          type="button"
                          onClick={() => setOnboardWorker(worker)}
                          className="text-start group/join cursor-pointer"
                          title={t("اضغط لتحديد تاريخ التعيين الفعلي وسعر الساعة", "Click to set when this worker joined the company and hourly rate")}
                        >
                          {worker.hireDate ? (
                            <span className="font-semibold text-zinc-900 group-hover/join:text-red-600 group-hover/join:underline">
                              🗓️ {worker.hireDate}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 hover:bg-amber-100">
                              ⚠ {t("حدد تاريخ التعيين", "Set join date")}
                            </span>
                          )}
                          <span className="block text-[10px] text-zinc-500 mt-0.5">
                            {worker.hourlyRate ?? 31.25} EGP/h{worker.attendanceStartDate ? ` · MFT: ${worker.attendanceStartDate}` : ""}
                          </span>
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] font-semibold capitalize ${STATUS_CHIP[worker.status] ?? STATUS_CHIP.pending}`}>{worker.status}</span>
                        {worker.expoPushToken && <span className="ml-1 text-[10px] text-zinc-400" title="Push notifications enabled">📱</span>}
                      </td>
                      <td className="px-4 py-3">
                        {total ? (
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-14 overflow-hidden rounded-full bg-zinc-100">
                              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${(tc.done / total) * 100}%` }} />
                            </div>
                            <span className="text-xs tabular-nums text-zinc-600">
                              {tc.done}/{total}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-zinc-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-zinc-600">{[worker.government, worker.city].filter(Boolean).join(", ") || "—"}</td>
                      <td className="px-4 py-3 text-xs text-zinc-600">
                        {worker.isOnline ? (
                          worker.presenceStatus === "idle" ? (
                            <div className="flex flex-col">
                              <span className="inline-flex items-center gap-1 font-bold text-red-600">
                                <span className="h-1.5 w-1.5 rounded-full bg-red-600 animate-ping" />
                                Idle (Missed check)
                              </span>
                              <span className="text-[10px] text-zinc-400">Station unconfirmed</span>
                            </div>
                          ) : (
                            <div className="flex flex-col">
                              <span className="inline-flex items-center gap-1 font-semibold text-emerald-600">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                Active (2h OK)
                              </span>
                              {worker.currentTaskTitle && (
                                <span className="text-[10px] text-zinc-500 truncate max-w-[140px]" title={worker.currentTaskTitle}>
                                  📌 {worker.currentTaskTitle}
                                </span>
                              )}
                            </div>
                          )
                        ) : (
                          relTime(worker.lastLogin)
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-0.5">
                          {worker.status === "pending" && (
                            <>
                              <IconBtn title="Approve & Set Joining Date" d={ICON_PATH.approve} tone="success" disabled={bulkBusy} onClick={() => setOnboardWorker(worker)} />
                              <IconBtn title="Reject" d={ICON_PATH.reject} tone="danger" disabled={bulkBusy} onClick={() => void rejectWorker(worker.id)} />
                            </>
                          )}
                          <IconBtn title="Set company joining date & leave balance" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" onClick={() => setOnboardWorker(worker)} />
                          <IconBtn title="Assign task" d={ICON_PATH.assign} onClick={() => openAssignModal(worker)} />
                          <IconBtn title="View profile" d={ICON_PATH.view} onClick={() => setDetailWorker(worker)} />
                          <IconBtn title="Delete worker" d={ICON_PATH.trash} tone="danger" disabled={deletingId === worker.id} onClick={() => void handleDeleteWorker(worker)} />
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

      <BulkBar count={selected.size} onClear={() => setSelected(new Set())}>
        <BulkButton tone="success" disabled={bulkBusy || selectedPending.length === 0} onClick={() => void setWorkerStatus(selectedPending, "approved")}>
          Approve{selectedPending.length ? ` ${selectedPending.length}` : ""}
        </BulkButton>
        <BulkButton disabled={bulkBusy || selectedPending.length === 0} onClick={() => void setWorkerStatus(selectedPending, "rejected")}>
          Reject
        </BulkButton>
        <BulkButton disabled={bulkBusy} onClick={() => exportWorkers(workers.filter((w) => selected.has(w.id)))}>
          Export
        </BulkButton>
        <BulkButton tone="danger" disabled={bulkBusy} onClick={() => void bulkDelete(selectedIds)}>
          Delete
        </BulkButton>
      </BulkBar>


      {/* Complete Worker 360 Detail Modal */}
      {detailWorker && (
        <ModalPortal onClose={() => setDetailWorker(null)}>
          <div
            className="fixed inset-0 z-[120] bg-zinc-950/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto animate-fade-in"
            onClick={() => setDetailWorker(null)}
          >
            <div
              className="border-2 border-zinc-900 bg-white dark:bg-zinc-900 w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 shadow-2xl text-zinc-950 dark:text-zinc-100 font-mono animate-scale-in"
              onClick={(e) => e.stopPropagation()}
            >
            {/* Modal Header */}
            <div className="flex items-start justify-between pb-4 border-b-2 border-zinc-900 mb-5">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-red-600 text-white border-2 border-zinc-900 flex items-center justify-center text-lg font-bold font-heading shadow-[2px_2px_0px_0px_#09090b]">
                  {detailWorker.firstName?.[0]}
                  {detailWorker.lastName?.[0]}
                </div>
                <div>
                  <h3 className="text-xl font-black font-heading text-zinc-950 uppercase tracking-wide">
                    {detailWorker.firstName} {detailWorker.lastName}
                  </h3>
                  <div className="flex flex-wrap items-center gap-2 mt-1 text-xs">
                    <span className="font-bold text-red-600 bg-red-50 border border-red-300 px-2 py-0.5">
                      {formatRole(detailWorker.role)}
                    </span>
                    <span className="font-bold text-zinc-800 bg-zinc-100 border border-zinc-300 px-2 py-0.5">
                      {formatDepartment(detailWorker.department)}
                    </span>
                    <span
                      className={`px-2 py-0.5 font-bold border ${
                        detailWorker.isOnline
                          ? detailWorker.presenceStatus === "idle"
                            ? "bg-red-50 text-red-800 border-red-300 animate-pulse"
                            : "bg-emerald-50 text-emerald-800 border-emerald-300"
                          : "bg-zinc-100 text-zinc-600 border-zinc-300"
                      }`}
                    >
                      {detailWorker.isOnline
                        ? detailWorker.presenceStatus === "idle"
                          ? "⚠️ IDLE (MISSED 2H CHECK)"
                          : "● ONLINE (2H ACTIVE)"
                        : "○ OFFLINE"}
                    </span>
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDetailWorker(null)}
                className="text-2xl font-bold text-zinc-500 hover:text-red-600 cursor-pointer"
              >
                &times;
              </button>
            </div>

            {/* Active Presence Banner in Drawer */}
            {detailWorker.isOnline && (
              <div
                className={`mb-5 p-3.5 border-2 ${
                  detailWorker.presenceStatus === "idle"
                    ? "bg-red-50 border-red-500 text-red-950"
                    : "bg-emerald-50 border-emerald-500 text-emerald-950"
                }`}
              >
                <div className="flex items-center justify-between text-xs font-mono font-bold uppercase tracking-wider mb-1.5">
                  <span className="flex items-center gap-1.5">
                    <span className={`h-2 w-2 rounded-full ${detailWorker.presenceStatus === "idle" ? "bg-red-600 animate-ping" : "bg-emerald-600"}`} />
                    2-Hour Presence Status
                  </span>
                  <span className="font-extrabold">{detailWorker.presenceStatus === "idle" ? "Station Idle / Unresponsive" : "Active & Verified"}</span>
                </div>
                {detailWorker.currentTaskTitle ? (
                  <p className="text-xs font-semibold">
                    Current Task: <span className="font-normal">{detailWorker.currentTaskTitle}</span>
                  </p>
                ) : (
                  <p className="text-xs text-zinc-600">Currently active on general shift operations.</p>
                )}
                {detailWorker.currentTaskNote && (
                  <p className="text-xs italic text-zinc-600 mt-1 font-mono">
                    Note: &ldquo;{detailWorker.currentTaskNote}&rdquo;
                  </p>
                )}
              </div>
            )}

            {/* Quick Action Toolbar */}
            <div className="flex flex-wrap gap-2 mb-5 p-3 bg-zinc-50 border border-zinc-200">
              <a
                href={`mailto:${detailWorker.email}`}
                className="px-3 py-1 bg-white border border-zinc-300 text-zinc-900 text-xs font-bold hover:bg-zinc-100 inline-flex items-center gap-1"
              >
                📧 Email Operator
              </a>
              {detailWorker.phone && (
                <>
                  <a
                    href={`tel:${detailWorker.phone}`}
                    className="px-3 py-1 bg-white border border-zinc-300 text-zinc-900 text-xs font-bold hover:bg-zinc-100 inline-flex items-center gap-1"
                  >
                    📞 Call Phone
                  </a>
                  {cleanPhoneForWhatsApp(detailWorker.phone) && (
                    <a
                      href={`https://wa.me/${cleanPhoneForWhatsApp(detailWorker.phone)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="px-3 py-1 bg-emerald-50 border border-emerald-300 text-emerald-800 text-xs font-bold hover:bg-emerald-100 inline-flex items-center gap-1"
                    >
                      💬 WhatsApp
                    </a>
                  )}
                </>
              )}
              {detailWorker.portfolioLink && (
                <a
                  href={detailWorker.portfolioLink.startsWith("http") ? detailWorker.portfolioLink : `https://${detailWorker.portfolioLink}`}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-1 bg-red-50 border border-red-300 text-red-700 text-xs font-bold hover:bg-red-100 inline-flex items-center gap-1"
                >
                  🔗 Portfolio ↗
                </a>
              )}
            </div>

            {/* Structured Sections */}
            <div className="space-y-4 text-xs">
              {/* Section 1: Identification & Contact */}
              <div className="border border-zinc-300 p-4 bg-white">
                <h4 className="font-bold text-xs uppercase text-zinc-950 border-b border-zinc-200 pb-1 mb-3 flex items-center gap-2">
                  <span>📋</span> Personal &amp; Contact Details
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <p>
                    <span className="text-zinc-500 font-medium">FULL NAME:</span>{" "}
                    <strong className="text-zinc-950">{detailWorker.firstName} {detailWorker.lastName}</strong>
                  </p>
                  <p>
                    <span className="text-zinc-500 font-medium">EMAIL ADDRESS:</span>{" "}
                    <strong className="text-zinc-950 break-all">{detailWorker.email}</strong>
                  </p>
                  <p>
                    <span className="text-zinc-500 font-medium">TELEPHONE:</span>{" "}
                    <strong className="text-zinc-950">{detailWorker.phone || "Unset"}</strong>
                  </p>
                  <p>
                    <span className="text-zinc-500 font-medium">LOCATION:</span>{" "}
                    <strong className="text-zinc-950">
                      {detailWorker.government || detailWorker.city ? `${detailWorker.government || ""} ${detailWorker.city ? `(${detailWorker.city})` : ""}` : "Unset"}
                    </strong>
                  </p>
                  <p className="md:col-span-2">
                    <span className="text-zinc-500 font-medium">EMERGENCY CONTACT:</span>{" "}
                    <strong className="text-zinc-950">
                      {typeof detailWorker.emergencyContact === "string"
                        ? detailWorker.emergencyContact
                        : detailWorker.emergencyContact
                          ? JSON.stringify(detailWorker.emergencyContact)
                          : "None provided"}
                    </strong>
                  </p>
                </div>
              </div>

              {/* Section 2: Professional Profile & Skills */}
              <div className="border border-zinc-300 p-4 bg-white">
                <h4 className="font-bold text-xs uppercase text-zinc-950 border-b border-zinc-200 pb-1 mb-3 flex items-center gap-2">
                  <span>💼</span> Professional Profile &amp; Capacity
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <p>
                    <span className="text-zinc-500 font-medium">PRIMARY ROLE:</span>{" "}
                    <strong className="text-red-600 font-bold">{formatRole(detailWorker.role)}</strong>
                  </p>
                  <p>
                    <span className="text-zinc-500 font-medium">DEPARTMENT:</span>{" "}
                    <strong className="text-zinc-950">{formatDepartment(detailWorker.department)}</strong>
                  </p>
                  <p>
                    <span className="text-zinc-500 font-medium">EMPLOYMENT TYPE:</span>{" "}
                    <strong className="text-zinc-950">{formatEmploymentType(detailWorker.employmentType)}</strong>
                  </p>
                  <p>
                    <span className="text-zinc-500 font-medium">EXPERIENCE:</span>{" "}
                    <strong className="text-zinc-950">{detailWorker.experience || "Not specified"}</strong>
                  </p>
                  <p>
                    <span className="text-zinc-500 font-medium">AVAILABILITY / NOTICE:</span>{" "}
                    <strong className="text-zinc-950">{detailWorker.netspend || "Immediate"}</strong>
                  </p>
                  <p>
                    <span className="text-zinc-500 font-medium">PORTFOLIO URL:</span>{" "}
                    {detailWorker.portfolioLink ? (
                      <a
                        href={detailWorker.portfolioLink.startsWith("http") ? detailWorker.portfolioLink : `https://${detailWorker.portfolioLink}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-red-600 underline font-bold break-all"
                      >
                        {detailWorker.portfolioLink}
                      </a>
                    ) : (
                      <span className="text-zinc-400">Not provided</span>
                    )}
                  </p>
                </div>

                {/* Skills Chips */}
                <div className="mt-3 pt-3 border-t border-zinc-200">
                  <span className="text-zinc-500 font-medium block mb-1.5">SKILLS STACK:</span>
                  {detailWorker.skills && detailWorker.skills.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {detailWorker.skills.map((s, idx) => (
                        <span key={idx} className="px-2 py-0.5 bg-zinc-100 border border-zinc-300 text-zinc-900 font-bold">
                          {s}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-zinc-400">No skills tags specified</span>
                  )}
                </div>
              </div>

              {/* Section 3: Compensation & Policy */}
              <div className="border border-zinc-300 p-4 bg-white">
                <h4 className="font-bold text-xs uppercase text-zinc-950 border-b border-zinc-200 pb-1 mb-3 flex items-center gap-2">
                  <span>💰</span> Compensation &amp; Rates
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <p>
                    <span className="text-zinc-500 font-medium">EXPECTED SALARY:</span><br />
                    <strong className="text-zinc-950 text-sm">
                      {detailWorker.expectedSalary ? `EGP ${detailWorker.expectedSalary}` : "Unset"}
                    </strong>
                  </p>
                  <p>
                    <span className="text-zinc-500 font-medium">HOURLY RATE:</span><br />
                    <strong className="text-zinc-950 text-sm">
                      {detailWorker.hourlyRate ? `EGP ${detailWorker.hourlyRate}/h` : "EGP 31.25/h"}
                    </strong>
                  </p>
                  <p>
                    <span className="text-zinc-500 font-medium">TARGET HOURS:</span><br />
                    <strong className="text-zinc-950 text-sm">
                      {detailWorker.expectedHours ? `${detailWorker.expectedHours}h / day` : "8h / day"}
                    </strong>
                  </p>
                </div>
              </div>

              {/* Section 3b: HR-POL-2026 Leave Profile */}
              <WorkerLeaveProfileCard worker={detailWorker} />

              {/* Section 4: Assigned Tasks & Directives */}
              <div className="border border-zinc-300 p-4 bg-white">
                <div className="flex items-center justify-between border-b border-zinc-200 pb-2 mb-3">
                  <h4 className="font-bold text-xs uppercase text-zinc-950 flex items-center gap-2">
                    <span>📋</span> Assigned Tasks &amp; Directives ({workerAssignedTasks.length})
                  </h4>
                  <button
                    type="button"
                    onClick={() => {
                      const target = detailWorker;
                      openAssignModal(target);
                    }}
                    className="px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white font-mono text-[10px] font-bold uppercase rounded cursor-pointer"
                  >
                    + Assign New Task
                  </button>
                </div>

                {workerAssignedTasks.length === 0 ? (
                  <p className="text-zinc-500 py-3 text-center italic text-xs">
                    No tasks currently assigned to this operator.
                  </p>
                ) : (
                  <div className="space-y-2.5 max-h-60 overflow-y-auto pr-1">
                    {workerAssignedTasks.map((t) => (
                      <div
                        key={t.id}
                        className="p-3 border border-zinc-300 bg-zinc-50 rounded flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-zinc-950 text-xs">{t.title}</span>
                            <span
                              className={`px-2 py-0.5 text-[9px] font-bold uppercase rounded border ${
                                t.status === "completed"
                                  ? "bg-emerald-50 text-emerald-800 border-emerald-300"
                                  : t.status === "pending-approval"
                                  ? "bg-amber-50 text-amber-800 border-amber-300"
                                  : t.status === "in-progress"
                                  ? "bg-blue-50 text-blue-800 border-blue-300"
                                  : "bg-zinc-100 text-zinc-800 border-zinc-300"
                              }`}
                            >
                              {t.status.replace(/-/g, " ")}
                            </span>
                          </div>
                          <p className="text-[10px] text-zinc-500">
                            Project: <strong className="text-zinc-700">{t.projectName || "Direct Operation"}</strong> ·
                            Priority: <strong className="uppercase text-zinc-700">{t.priority || "medium"}</strong> ·
                            Due: <strong className="text-zinc-700">{formatTaskDueDate(t.dueDate)}</strong>
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => openEditWorkerTask(t)}
                          className="px-3 py-1.5 bg-zinc-900 hover:bg-black text-white text-[10px] font-bold uppercase tracking-wider border border-zinc-900 shadow-[1px_1px_0px_0px_#09090b] cursor-pointer self-start sm:self-auto shrink-0 flex items-center gap-1"
                        >
                          ✏️ Edit Directive
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Section 5: System Telemetry & Timestamps */}
              <div className="border border-zinc-300 p-4 bg-zinc-50">
                <h4 className="font-bold text-xs uppercase text-zinc-950 border-b border-zinc-200 pb-1 mb-3 flex items-center gap-2">
                  <span>⏱️</span> System Telemetry &amp; Logs
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <p>
                    <span className="text-zinc-500 font-medium">REGISTRATION TIMESTAMP:</span><br />
                    <strong className="text-zinc-900">{formatTimestamp(detailWorker.createdAt)}</strong>
                  </p>
                  <p>
                    <span className="text-zinc-500 font-medium">LAST CLOCK-IN / LOGIN:</span><br />
                    <strong className="text-zinc-900">{formatTimestamp(detailWorker.lastLogin)}</strong>
                  </p>
                  <p>
                    <span className="text-zinc-500 font-medium">LAST CLOCK-OUT:</span><br />
                    <strong className="text-zinc-900">{formatTimestamp(detailWorker.lastLogout)}</strong>
                  </p>
                  <p>
                    <span className="text-zinc-500 font-medium">MOBILE DEVICE UPLINK:</span><br />
                    <strong className={detailWorker.expoPushToken ? "text-emerald-700" : "text-zinc-500"}>
                      {detailWorker.expoPushToken ? "Active (Push Notifications Linked) 📱" : "No Mobile Device Token"}
                    </strong>
                  </p>
                </div>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex flex-wrap gap-3 justify-end pt-5 border-t-2 border-zinc-900 mt-5">
              <button
                type="button"
                onClick={() => {
                  const target = detailWorker;
                  setDetailWorker(null);
                  openAssignModal(target);
                }}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-mono text-xs font-bold uppercase tracking-wider border-2 border-zinc-900 shadow-[2px_2px_0px_0px_#09090b] cursor-pointer"
              >
                Assign Task
              </button>
              <button
                type="button"
                onClick={() => setDetailWorker(null)}
                className="px-4 py-2 border-2 border-zinc-900 bg-white hover:bg-zinc-100 text-zinc-950 font-mono text-xs font-bold uppercase cursor-pointer"
              >
                Dismiss Manifest
              </button>
            </div>
          </div>
        </div>
      </ModalPortal>
    )}

      {/* Assign Task Modal */}
      {assignModalWorker && (
        <ModalPortal onClose={() => setAssignModalWorker(null)}>
          <div
            className="fixed inset-0 z-[120] bg-zinc-950/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto animate-fade-in"
            onClick={() => setAssignModalWorker(null)}
          >
            <div
              className="border-2 border-zinc-900 bg-white dark:bg-zinc-900 w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 shadow-2xl text-zinc-950 dark:text-zinc-100 font-mono animate-scale-in"
              onClick={(e) => e.stopPropagation()}
            >
            <div className="flex items-center justify-between pb-3 border-b-2 border-zinc-900 mb-4">
              <div>
                <h3 className="text-xl font-black font-heading text-red-600 uppercase tracking-wide">
                  Dispatch Directive
                </h3>
                <p className="text-xs text-zinc-600 mt-0.5">
                  Assigning to: <strong>{assignModalWorker.firstName} {assignModalWorker.lastName}</strong> ({formatRole(assignModalWorker.role)})
                </p>
              </div>
              <button
                onClick={() => setAssignModalWorker(null)}
                className="text-2xl font-bold text-zinc-500 hover:text-red-600 cursor-pointer"
              >
                &times;
              </button>
            </div>

            <form onSubmit={(e) => void handleAssignTask(e)} className="space-y-4 text-xs font-mono">
              <div>
                <label className="block font-bold uppercase tracking-wider text-zinc-700 mb-1">
                  Operation Title *
                </label>
                <input
                  required
                  value={taskForm.title}
                  onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })}
                  placeholder="e.g. Campaign Graphics Production"
                  className="w-full bg-white border-2 border-zinc-900 px-3 py-2 text-sm text-zinc-950 focus:outline-none focus:ring-2 focus:ring-red-600"
                />
              </div>

              <div>
                <label className="block font-bold uppercase tracking-wider text-zinc-700 mb-1">
                  Directive Details *
                </label>
                <textarea
                  required
                  rows={3}
                  value={taskForm.description}
                  onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })}
                  placeholder="Provide detailed instructions, deliverables, and guidelines..."
                  className="w-full bg-white border-2 border-zinc-900 px-3 py-2 text-sm text-zinc-950 focus:outline-none focus:ring-2 focus:ring-red-600 resize-y"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold uppercase tracking-wider text-zinc-700 mb-1">
                    Link to Project
                  </label>
                  <select
                    value={taskForm.projectId}
                    onChange={(e) => {
                      const id = e.target.value;
                      const p = projects.find((x) => x.id === id);
                      setTaskForm({
                        ...taskForm,
                        projectId: id,
                        projectName: p ? p.name : "",
                      });
                    }}
                    className="w-full bg-white border-2 border-zinc-900 px-3 py-2 text-xs font-mono font-bold text-zinc-950 focus:outline-none focus:ring-2 focus:ring-red-600"
                  >
                    <option value="">No Project (Stand-alone)</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-bold uppercase tracking-wider text-zinc-700 mb-1">
                    Department
                  </label>
                  <select
                    value={taskForm.department}
                    onChange={(e) => setTaskForm({ ...taskForm, department: e.target.value })}
                    className="w-full bg-white border-2 border-zinc-900 px-3 py-2 text-xs font-mono font-bold text-zinc-950 focus:outline-none focus:ring-2 focus:ring-red-600"
                  >
                    {DEPARTMENTS.map((d) => (
                      <option key={d.value} value={d.value}>
                        {d.label.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold uppercase tracking-wider text-zinc-700 mb-1">
                    Priority Level
                  </label>
                  <select
                    value={taskForm.priority}
                    onChange={(e) => setTaskForm({ ...taskForm, priority: e.target.value })}
                    className="w-full bg-white border-2 border-zinc-900 px-3 py-2 text-xs font-mono font-bold text-zinc-950 focus:outline-none focus:ring-2 focus:ring-red-600"
                  >
                    <option value="low">LOW</option>
                    <option value="medium">MEDIUM</option>
                    <option value="high">HIGH</option>
                    <option value="urgent">CRITICAL (URGENT)</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold uppercase tracking-wider text-zinc-700 mb-1">
                    Deadline (Due Date)
                  </label>
                  <input
                    type="date"
                    value={taskForm.dueDate}
                    onChange={(e) => setTaskForm({ ...taskForm, dueDate: e.target.value })}
                    className="w-full bg-white border-2 border-zinc-900 px-3 py-2 text-xs font-mono font-bold text-zinc-950 focus:outline-none focus:ring-2 focus:ring-red-600"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold uppercase tracking-wider text-zinc-700 mb-1">
                  Custom Notification Uplink (Optional)
                </label>
                <textarea
                  rows={2}
                  value={taskForm.notificationMessage}
                  onChange={(e) => setTaskForm({ ...taskForm, notificationMessage: e.target.value })}
                  placeholder="Message sent as real-time push alert to operator's mobile..."
                  className="w-full bg-white border-2 border-zinc-900 px-3 py-2 text-xs text-zinc-950 focus:outline-none focus:ring-2 focus:ring-red-600 resize-y"
                />
              </div>

              <div className="flex gap-3 justify-end pt-3 border-t-2 border-zinc-900">
                <button
                  type="button"
                  onClick={() => setAssignModalWorker(null)}
                  className="px-4 py-2 border-2 border-zinc-900 bg-white hover:bg-zinc-100 text-zinc-950 font-mono text-xs font-bold cursor-pointer"
                >
                  Abort
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white font-mono text-xs font-bold uppercase tracking-wider border-2 border-zinc-900 shadow-[2px_2px_0px_0px_#09090b] cursor-pointer"
                >
                  Dispatch Directive
                </button>
              </div>
            </form>
          </div>
        </div>
      </ModalPortal>
    )}

      {/* Edit Directive / Task Modal */}
      {editingTask && (
        <ModalPortal onClose={() => setEditingTask(null)}>
          <div
            className="fixed inset-0 z-[120] bg-zinc-950/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto animate-fade-in"
            onClick={() => setEditingTask(null)}
          >
            <div
              className="border-2 border-zinc-900 bg-white dark:bg-zinc-900 w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 shadow-2xl text-zinc-950 dark:text-zinc-100 font-mono animate-scale-in"
              onClick={(e) => e.stopPropagation()}
            >
            <div className="flex items-center justify-between pb-3 border-b-2 border-zinc-900 mb-4">
              <div>
                <h3 className="text-xl font-black font-heading text-red-600 uppercase tracking-wide">
                  Edit Task Directive
                </h3>
                <p className="text-[10px] text-zinc-500 mt-0.5">TASK ID: {editingTask.id}</p>
              </div>
              <button
                onClick={() => setEditingTask(null)}
                className="text-2xl font-bold text-zinc-500 hover:text-red-600 cursor-pointer"
              >
                &times;
              </button>
            </div>

            <form onSubmit={(e) => void submitEditWorkerTask(e)} className="space-y-4 text-xs font-mono">
              <div>
                <label className="block font-bold uppercase tracking-wider text-zinc-700 mb-1">
                  Operation Title *
                </label>
                <input
                  required
                  value={editTaskForm.title}
                  onChange={(e) => setEditTaskForm({ ...editTaskForm, title: e.target.value })}
                  placeholder="e.g. Campaign Graphics Production"
                  className="w-full bg-white border-2 border-zinc-900 px-3 py-2 text-sm text-zinc-950 focus:outline-none focus:ring-2 focus:ring-red-600"
                />
              </div>

              <div>
                <label className="block font-bold uppercase tracking-wider text-zinc-700 mb-1">
                  Directive Details *
                </label>
                <textarea
                  required
                  rows={3}
                  value={editTaskForm.description}
                  onChange={(e) => setEditTaskForm({ ...editTaskForm, description: e.target.value })}
                  placeholder="Provide detailed instructions, deliverables, and guidelines..."
                  className="w-full bg-white border-2 border-zinc-900 px-3 py-2 text-sm text-zinc-950 focus:outline-none focus:ring-2 focus:ring-red-600 resize-y"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold uppercase tracking-wider text-zinc-700 mb-1">
                    Link to Project
                  </label>
                  <select
                    value={editTaskForm.projectId}
                    onChange={(e) => {
                      const id = e.target.value;
                      const p = projects.find((x) => x.id === id);
                      setEditTaskForm({
                        ...editTaskForm,
                        projectId: id,
                        projectName: p ? p.name : "",
                      });
                    }}
                    className="w-full bg-white border-2 border-zinc-900 px-3 py-2 text-xs font-mono font-bold text-zinc-950 focus:outline-none focus:ring-2 focus:ring-red-600"
                  >
                    <option value="">No Project (Stand-alone)</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-bold uppercase tracking-wider text-zinc-700 mb-1">
                    Department
                  </label>
                  <select
                    value={editTaskForm.department}
                    onChange={(e) => setEditTaskForm({ ...editTaskForm, department: e.target.value })}
                    className="w-full bg-white border-2 border-zinc-900 px-3 py-2 text-xs font-mono font-bold text-zinc-950 focus:outline-none focus:ring-2 focus:ring-red-600"
                  >
                    {DEPARTMENTS.map((d) => (
                      <option key={d.value} value={d.value}>
                        {d.label.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-bold uppercase tracking-wider text-zinc-700 mb-1">
                  Assignee(s) ({editTaskForm.assignedWorkerIds.length} Selected)
                </label>
                <div className="max-h-32 overflow-y-auto border-2 border-zinc-900 p-2 bg-zinc-50 space-y-1">
                  {workers
                    .filter((w) => w.status === "approved")
                    .map((w) => {
                      const isAssigned = editTaskForm.assignedWorkerIds.includes(w.id);
                      return (
                        <label
                          key={w.id}
                          className={`flex items-center justify-between gap-2 p-1 rounded cursor-pointer ${
                            isAssigned ? "bg-red-50 font-bold text-red-950" : "text-zinc-900 hover:bg-zinc-100"
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={isAssigned}
                              onChange={() => {
                                const set = new Set(editTaskForm.assignedWorkerIds);
                                if (set.has(w.id)) set.delete(w.id);
                                else set.add(w.id);
                                setEditTaskForm({ ...editTaskForm, assignedWorkerIds: [...set] });
                              }}
                              className="accent-red-600"
                            />
                            <span>
                              {w.firstName} {w.lastName}
                            </span>
                          </div>
                          <span className="text-[10px] text-zinc-500 uppercase">({formatRole(w.role)})</span>
                        </label>
                      );
                    })}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-bold uppercase tracking-wider text-zinc-700 mb-1">
                    Status
                  </label>
                  <select
                    value={editTaskForm.status}
                    onChange={(e) => setEditTaskForm({ ...editTaskForm, status: e.target.value })}
                    className="w-full bg-white border-2 border-zinc-900 px-3 py-2 text-xs font-mono font-bold text-zinc-950 focus:outline-none focus:ring-2 focus:ring-red-600"
                  >
                    <option value="assigned">ASSIGNED</option>
                    <option value="in-progress">IN PROGRESS</option>
                    <option value="pending-approval">PENDING APPROVAL</option>
                    <option value="completed">COMPLETED</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold uppercase tracking-wider text-zinc-700 mb-1">
                    Priority Level
                  </label>
                  <select
                    value={editTaskForm.priority}
                    onChange={(e) => setEditTaskForm({ ...editTaskForm, priority: e.target.value })}
                    className="w-full bg-white border-2 border-zinc-900 px-3 py-2 text-xs font-mono font-bold text-zinc-950 focus:outline-none focus:ring-2 focus:ring-red-600"
                  >
                    <option value="low">LOW</option>
                    <option value="medium">MEDIUM</option>
                    <option value="high">HIGH</option>
                    <option value="urgent">CRITICAL (URGENT)</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold uppercase tracking-wider text-zinc-700 mb-1">
                    Deadline (Due Date)
                  </label>
                  <input
                    type="date"
                    value={editTaskForm.dueDate}
                    onChange={(e) => setEditTaskForm({ ...editTaskForm, dueDate: e.target.value })}
                    className="w-full bg-white border-2 border-zinc-900 px-3 py-2 text-xs font-mono font-bold text-zinc-950 focus:outline-none focus:ring-2 focus:ring-red-600"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold uppercase tracking-wider text-zinc-700 mb-1">
                  Photo / Proof URL (Optional)
                </label>
                <input
                  value={editTaskForm.photo}
                  onChange={(e) => setEditTaskForm({ ...editTaskForm, photo: e.target.value })}
                  placeholder="https://..."
                  className="w-full bg-white border-2 border-zinc-900 px-3 py-2 text-xs text-zinc-950 focus:outline-none focus:ring-2 focus:ring-red-600"
                />
              </div>

              <div>
                <label className="block font-bold uppercase tracking-wider text-zinc-700 mb-1">
                  Custom Push Notification Alert (Optional)
                </label>
                <textarea
                  rows={2}
                  value={editTaskForm.notificationMessage}
                  onChange={(e) => setEditTaskForm({ ...editTaskForm, notificationMessage: e.target.value })}
                  placeholder="Message sent as real-time push alert to operator's mobile..."
                  className="w-full bg-white border-2 border-zinc-900 px-3 py-2 text-xs text-zinc-950 focus:outline-none focus:ring-2 focus:ring-red-600 resize-y"
                />
              </div>

              <div className="flex gap-3 justify-end pt-3 border-t-2 border-zinc-900">
                <button
                  type="button"
                  onClick={() => setEditingTask(null)}
                  disabled={savingTask}
                  className="px-4 py-2 border-2 border-zinc-900 bg-white hover:bg-zinc-100 text-zinc-950 font-mono text-xs font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingTask}
                  className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white font-mono text-xs font-bold uppercase tracking-wider border-2 border-zinc-900 shadow-[2px_2px_0px_0px_#09090b] cursor-pointer disabled:opacity-50"
                >
                  {savingTask ? "Saving Directive..." : "Save Directive"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </ModalPortal>
    )}

      {/* Company Joining Date & Onboarding Modal (for existing & newly registered workers) */}
      {onboardWorker && (
        <ModalPortal onClose={() => setOnboardWorker(null)}>
          <div
            className="fixed inset-0 z-[120] bg-zinc-950/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto animate-fade-in"
            onClick={() => setOnboardWorker(null)}
          >
            <div
              dir={dir}
              className="border-2 border-zinc-900 bg-white dark:bg-zinc-900 w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 shadow-2xl text-zinc-950 dark:text-zinc-100 font-mono animate-scale-in space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between pb-3 border-b-2 border-zinc-900">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-red-600">
                    {t("// إعداد تاريخ التعيين والراتب ورصيد الإجازات", "// WORKER ONBOARDING & TENURE CONTROL")}
                  </span>
                  <h3 className="text-xl font-black font-heading text-zinc-950 dark:text-white uppercase">
                    {onboardWorker.firstName} {onboardWorker.lastName}
                  </h3>
                  <p className="text-xs text-zinc-500">
                    {formatRole(onboardWorker.role)} · {formatDepartment(onboardWorker.department)} · {onboardWorker.email}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setOnboardWorker(null)}
                  className="text-2xl font-bold text-zinc-500 hover:text-red-600 cursor-pointer"
                >
                  &times;
                </button>
              </div>

              <WorkerLeaveProfileCard
                worker={onboardWorker}
                onSaved={() => {
                  if (onboardWorker.status !== "pending") setOnboardWorker(null);
                }}
              />

              <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t-2 border-zinc-900">
                <p className="text-[11px] text-zinc-500">
                  {t(
                    "نصيحة: اضغط «حفظ بيانات التعيين والراتب» بالأعلى بعد إدخال التواريخ.",
                    "Tip: Click Save Onboarding & Salary Profile above after setting dates.",
                  )}
                </p>
                <div className="flex items-center gap-2">
                  {onboardWorker.status === "pending" && (
                    <button
                      type="button"
                      disabled={bulkBusy}
                      onClick={async () => {
                        await approveWorker(onboardWorker.id);
                        setOnboardWorker(null);
                      }}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-xs font-bold uppercase border-2 border-zinc-900 shadow-[2px_2px_0px_0px_#09090b] cursor-pointer"
                    >
                      ✓ {t("اعتماد حساب الموظف", "Approve Worker Account")}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setOnboardWorker(null)}
                    className="px-4 py-2 border-2 border-zinc-900 bg-white dark:bg-zinc-800 hover:bg-zinc-100 text-zinc-950 dark:text-white font-mono text-xs font-bold uppercase cursor-pointer"
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
