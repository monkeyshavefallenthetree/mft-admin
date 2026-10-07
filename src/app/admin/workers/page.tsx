"use client";

import { useEffect, useState, useMemo } from "react";
import {
  collection,
  query,
  onSnapshot,
  doc,
  updateDoc,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { DEPARTMENTS } from "@/lib/admin/constants";
import { deleteWorkerCascade } from "@/lib/admin/deleteWorkerCascade";
import { sendExpoPushToWorkers } from "@/lib/chatNotifications";

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

  // Filters
  const [searchFilter, setSearchFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [assignModalWorker, setAssignModalWorker] = useState<Worker | null>(null);
  const [detailWorker, setDetailWorker] = useState<Worker | null>(null);

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
      alert("Please enter a title.");
      return;
    }
    if (editTaskForm.assignedWorkerIds.length === 0) {
      alert("Select at least one worker.");
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

      setEditingTask(null);
    } catch (err) {
      console.error("Failed to update task:", err);
      alert("Failed to update task.");
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
      if (!q) return true;

      const skillsStr = Array.isArray(w.skills) ? w.skills.join(" ") : "";
      const blob = `${w.firstName} ${w.lastName} ${w.email} ${w.role} ${w.phone || ""} ${w.government || ""} ${w.city || ""} ${w.department || ""} ${skillsStr}`.toLowerCase();
      return blob.includes(q);
    });
  }, [workers, searchFilter, statusFilter, roleFilter, departmentFilter]);

  const clearWorkerFilters = () => {
    setSearchFilter("");
    setStatusFilter("");
    setRoleFilter("");
    setDepartmentFilter("");
  };

  const approveWorker = async (id: string) => {
    await updateDoc(doc(db, "workers", id), { status: "approved" });
  };

  const rejectWorker = async (id: string) => {
    await updateDoc(doc(db, "workers", id), { status: "rejected" });
  };

  const handleDeleteWorker = async (worker: Worker) => {
    const name = `${worker.firstName} ${worker.lastName}`;
    if (!confirm(`TERMINATE OPERATOR RECORD: ${name.toUpperCase()}?\n\nThis will purge all associated work logs and task links. Action is irreversible.`)) return;
    
    setDeletingId(worker.id);
    try {
      await deleteWorkerCascade(worker.id);
      if (detailWorker?.id === worker.id) setDetailWorker(null);
    } catch (e) {
      console.error(e);
      alert(`[ERR] ${e instanceof Error ? e.message : "PURGE_FAILED"}`);
    } finally {
      setDeletingId(null);
    }
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

    await addDoc(collection(db, "tasks"), {
      title: taskForm.title,
      description: taskForm.description,
      projectId: taskForm.projectId || null,
      projectName: selectedProjectName || "Direct Operation",
      department: taskForm.department || "general",
      priority: taskForm.priority || "medium",
      assignedTo: assignModalWorker.id,
      assignedWorkerName: `${assignModalWorker.firstName} ${assignModalWorker.lastName}`.trim(),
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

    setAssignModalWorker(null);
    alert(`Task "${taskForm.title}" successfully dispatched to ${assignModalWorker.firstName} ${assignModalWorker.lastName}.`);
  };

  const stats = {
    total: workers.length,
    approved: workers.filter((w) => w.status === "approved").length,
    pending: workers.filter((w) => w.status === "pending").length,
    rejected: workers.filter((w) => w.status === "rejected").length,
    online: workers.filter((w) => w.isOnline).length,
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-zinc-600 animate-pulse font-mono">
          INITIALIZING OPERATOR MANIFEST...
        </p>
        <div className="w-48 h-1 bg-zinc-200 overflow-hidden border border-zinc-900">
          <div className="h-full bg-red-600 w-1/2 animate-[slide_1s_ease-in-out_infinite]" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b-2 border-zinc-900">
        <div>
          <h2 className="text-2xl font-black text-zinc-950 font-heading tracking-tight uppercase">Operator Manifest</h2>
          <p className="text-xs text-zinc-600 font-mono mt-0.5">
            Real-time Personnel Roster &amp; Operational Telemetry
          </p>
        </div>
        <p className="text-xs font-bold font-mono uppercase tracking-widest text-zinc-600 bg-zinc-100 border border-zinc-300 px-3 py-1.5">
          SYNCING: {filteredWorkers.length} OF {workers.length} RECORDS
        </p>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Total Operators", value: stats.total, color: "text-zinc-950" },
          { label: "Approved Active", value: stats.approved, color: "text-emerald-700" },
          { label: "Verify Pending", value: stats.pending, color: "text-amber-700" },
          { label: "Rejected Units", value: stats.rejected, color: "text-red-700" },
          { label: "Online Uplink", value: stats.online, color: "text-emerald-700" },
        ].map((s) => (
          <div key={s.label} className="bg-white border-2 border-zinc-900 p-4 text-center shadow-[3px_3px_0px_0px_#09090b]">
            <div className={`text-2xl font-black font-heading ${s.color}`}>{s.value}</div>
            <div className="text-[10px] font-bold uppercase font-mono tracking-wider text-zinc-600 mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters Bar */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 p-4 bg-white border-2 border-zinc-900 shadow-[3px_3px_0px_0px_#09090b]">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold uppercase font-mono tracking-wider text-zinc-700">Search</label>
          <input
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            placeholder="Name, email, city, skills..."
            className="w-full bg-white border-2 border-zinc-900 px-3 py-2 text-xs font-mono text-zinc-950 focus:outline-none focus:ring-2 focus:ring-red-600"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold uppercase font-mono tracking-wider text-zinc-700">Status</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full bg-white border-2 border-zinc-900 px-3 py-2 text-xs font-mono font-bold text-zinc-950 focus:outline-none focus:ring-2 focus:ring-red-600"
          >
            <option value="">ALL STATUSES</option>
            <option value="approved">APPROVED</option>
            <option value="pending">PENDING</option>
            <option value="rejected">REJECTED</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold uppercase font-mono tracking-wider text-zinc-700">Department</label>
          <select
            value={departmentFilter}
            onChange={(e) => setDepartmentFilter(e.target.value)}
            className="w-full bg-white border-2 border-zinc-900 px-3 py-2 text-xs font-mono font-bold text-zinc-950 focus:outline-none focus:ring-2 focus:ring-red-600"
          >
            <option value="">ALL DEPARTMENTS</option>
            {DEPARTMENTS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label.toUpperCase()}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold uppercase font-mono tracking-wider text-zinc-700">Role</label>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="w-full bg-white border-2 border-zinc-900 px-3 py-2 text-xs font-mono font-bold text-zinc-950 focus:outline-none focus:ring-2 focus:ring-red-600"
          >
            <option value="">ALL ROLES</option>
            {uniqueRoles.map((r) => (
              <option key={r} value={r}>
                {formatRole(r).toUpperCase()}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <button
            type="button"
            onClick={clearWorkerFilters}
            className="w-full py-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-950 font-mono text-xs font-bold uppercase border-2 border-zinc-900 shadow-[2px_2px_0px_0px_#09090b] cursor-pointer"
          >
            Reset Filters
          </button>
        </div>
      </div>

      {/* Workers Manifest Cards */}
      <div className="space-y-4">
        {workers.length === 0 ? (
          <div className="p-16 text-center bg-white border-2 border-zinc-900 shadow-[3px_3px_0px_0px_#09090b]">
            <p className="text-xs font-bold font-mono uppercase tracking-widest text-emerald-700">
              WAITING FOR INBOUND OPERATOR REGISTRATIONS...
            </p>
          </div>
        ) : filteredWorkers.length === 0 ? (
          <div className="p-16 text-center bg-white border-2 border-zinc-900 shadow-[3px_3px_0px_0px_#09090b]">
            <p className="text-xs font-bold font-mono uppercase tracking-widest text-amber-700">
              NO OPERATORS MATCHING SEARCH PARAMS
            </p>
          </div>
        ) : (
          filteredWorkers.map((worker) => {
            const hasLocation = worker.government || worker.city;
            const waPhone = cleanPhoneForWhatsApp(worker.phone);

            return (
              <div
                key={worker.id}
                className="bg-white border-2 border-zinc-900 p-5 shadow-[4px_4px_0px_0px_#09090b] transition-all hover:translate-x-0.5 hover:translate-y-0.5"
              >
                {/* Header Section */}
                <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-3 pb-3 border-b border-zinc-200">
                  <div className="flex items-center gap-3">
                    <div
                      className={`h-3.5 w-3.5 rounded-full border border-zinc-900 ${
                        worker.isOnline
                          ? "bg-emerald-500 shadow-sm shadow-emerald-500 animate-pulse"
                          : "bg-zinc-300"
                      }`}
                    />
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-xl font-bold font-heading text-zinc-950 uppercase tracking-tight">
                          {worker.firstName} {worker.lastName}
                        </h3>
                        <span className="text-xs font-bold font-mono text-red-600 bg-red-50 border border-red-300 px-2 py-0.5">
                          {formatRole(worker.role)}
                        </span>
                        <span className="text-xs font-bold font-mono text-zinc-800 bg-zinc-100 border border-zinc-300 px-2 py-0.5">
                          {formatDepartment(worker.department)}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 mt-1 text-xs font-mono text-zinc-500">
                        <span>ID: {worker.id.slice(-8)}</span>
                        {hasLocation && (
                          <span className="text-zinc-700 font-bold">
                            📍 {worker.government || ""}{worker.city ? `, ${worker.city}` : ""}
                          </span>
                        )}
                        {worker.employmentType && (
                          <span className="text-zinc-600">
                            • {formatEmploymentType(worker.employmentType)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <span
                      className={`px-2.5 py-1 text-xs font-mono font-bold border ${
                        worker.status === "approved"
                          ? "text-emerald-800 border-emerald-400 bg-emerald-50"
                          : worker.status === "pending"
                            ? "text-amber-800 border-amber-400 bg-amber-50"
                            : "text-red-800 border-red-400 bg-red-50"
                      }`}
                    >
                      {worker.status.toUpperCase()}
                    </span>
                    <span
                      className={`px-2.5 py-1 text-xs font-mono font-bold border ${
                        worker.isOnline
                          ? "text-emerald-800 border-emerald-400 bg-emerald-50"
                          : "text-zinc-600 border-zinc-300 bg-zinc-100"
                      }`}
                    >
                      {worker.isOnline ? "LINK_ACTIVE" : "DISPATCH_OFFLINE"}
                    </span>
                    {worker.expoPushToken && (
                      <span className="px-2 py-1 text-xs font-mono font-bold bg-blue-50 text-blue-800 border border-blue-300">
                        📱 PUSH ACTIVE
                      </span>
                    )}
                  </div>
                </div>

                {/* Main Operator Data Grid */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 py-4 text-xs font-mono border-b border-zinc-200">
                  {/* Contact Info */}
                  <div className="space-y-1.5 bg-zinc-50 p-3 border border-zinc-200">
                    <div className="text-[10px] font-bold uppercase text-zinc-500 border-b border-zinc-200 pb-1 mb-1.5">
                      Contact Directives
                    </div>
                    <div>
                      <span className="text-zinc-500">EMAIL:</span>{" "}
                      <a href={`mailto:${worker.email}`} className="text-zinc-950 font-bold hover:underline break-all">
                        {worker.email}
                      </a>
                    </div>
                    <div>
                      <span className="text-zinc-500">PHONE:</span>{" "}
                      <span className="text-zinc-950 font-bold">{worker.phone || "UNSET"}</span>
                    </div>
                    {waPhone && (
                      <div className="pt-1">
                        <a
                          href={`https://wa.me/${waPhone}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-300 px-2 py-0.5 hover:bg-emerald-100"
                        >
                          💬 WhatsApp Link
                        </a>
                      </div>
                    )}
                  </div>

                  {/* Professional & Experience */}
                  <div className="space-y-1.5 bg-zinc-50 p-3 border border-zinc-200">
                    <div className="text-[10px] font-bold uppercase text-zinc-500 border-b border-zinc-200 pb-1 mb-1.5">
                      Qualifications
                    </div>
                    <div>
                      <span className="text-zinc-500">EXPERIENCE:</span>{" "}
                      <span className="text-zinc-950 font-bold">{worker.experience || "N/A"}</span>
                    </div>
                    <div>
                      <span className="text-zinc-500">NOTICE:</span>{" "}
                      <span className="text-zinc-950 font-bold">{worker.netspend || "Immediate"}</span>
                    </div>
                    {worker.portfolioLink && (
                      <div className="pt-1">
                        <a
                          href={worker.portfolioLink.startsWith("http") ? worker.portfolioLink : `https://${worker.portfolioLink}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] font-bold text-red-600 bg-red-50 border border-red-300 px-2 py-0.5 hover:bg-red-100"
                        >
                          🔗 View Portfolio ↗
                        </a>
                      </div>
                    )}
                  </div>

                  {/* Financial & Compensation */}
                  <div className="space-y-1.5 bg-zinc-50 p-3 border border-zinc-200">
                    <div className="text-[10px] font-bold uppercase text-zinc-500 border-b border-zinc-200 pb-1 mb-1.5">
                      Compensation
                    </div>
                    <div>
                      <span className="text-zinc-500">EXPECTED SAL:</span>{" "}
                      <span className="text-zinc-950 font-bold">
                        {worker.expectedSalary ? `EGP ${worker.expectedSalary}` : "UNSET"}
                      </span>
                    </div>
                    <div>
                      <span className="text-zinc-500">HOURLY RATE:</span>{" "}
                      <span className="text-zinc-950 font-bold">
                        {worker.hourlyRate ? `EGP ${worker.hourlyRate}/h` : "EGP 31.25/h (Std)"}
                      </span>
                    </div>
                    <div>
                      <span className="text-zinc-500">TARGET HRS:</span>{" "}
                      <span className="text-zinc-950 font-bold">
                        {worker.expectedHours ? `${worker.expectedHours}h/day` : "8h/day"}
                      </span>
                    </div>
                  </div>

                  {/* System & Timeline */}
                  <div className="space-y-1.5 bg-zinc-50 p-3 border border-zinc-200">
                    <div className="text-[10px] font-bold uppercase text-zinc-500 border-b border-zinc-200 pb-1 mb-1.5">
                      System Timeline
                    </div>
                    <div>
                      <span className="text-zinc-500">JOINED:</span>{" "}
                      <span className="text-zinc-900 font-bold">
                        {worker.createdAt?.toDate ? worker.createdAt.toDate().toLocaleDateString() : "UNKNOWN"}
                      </span>
                    </div>
                    <div>
                      <span className="text-zinc-500">LAST LOGIN:</span>{" "}
                      <span className="text-zinc-900 font-bold">
                        {worker.lastLogin?.toDate
                          ? worker.lastLogin.toDate().toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
                          : "UNKNOWN"}
                      </span>
                    </div>
                    <div>
                      <span className="text-zinc-500">TASKS RATIO:</span>{" "}
                      <span className="text-zinc-900 font-bold">
                        {worker.completedTasks ?? 0} / {worker.totalTasks ?? 0} Done
                      </span>
                    </div>
                  </div>
                </div>

                {/* Skills Tags Bar (if available) */}
                {worker.skills && worker.skills.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 py-3 border-b border-zinc-200">
                    <span className="text-[10px] font-bold uppercase font-mono text-zinc-500 mr-1">Skills:</span>
                    {worker.skills.map((s, idx) => (
                      <span
                        key={idx}
                        className="px-2 py-0.5 bg-zinc-100 border border-zinc-300 text-zinc-800 text-xs font-mono font-medium"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                )}

                {/* Command Action Buttons */}
                <div className="flex flex-wrap items-center gap-2 pt-3">
                  {worker.status === "pending" && (
                    <>
                      <button
                        type="button"
                        onClick={() => approveWorker(worker.id)}
                        className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-xs font-bold uppercase border-2 border-zinc-900 shadow-[2px_2px_0px_0px_#09090b] cursor-pointer"
                      >
                        Verify Operator
                      </button>
                      <button
                        type="button"
                        onClick={() => rejectWorker(worker.id)}
                        className="px-3.5 py-1.5 bg-red-50 hover:bg-red-600 hover:text-white text-red-700 font-mono text-xs font-bold uppercase border-2 border-red-600 cursor-pointer"
                      >
                        Reject Unit
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => openAssignModal(worker)}
                    className="px-4 py-1.5 bg-red-600 hover:bg-red-700 text-white font-mono text-xs font-bold uppercase tracking-wider border-2 border-zinc-900 shadow-[2px_2px_0px_0px_#09090b] cursor-pointer active:translate-x-0.5 active:translate-y-0.5"
                  >
                    Assign Task
                  </button>
                  <button
                    type="button"
                    onClick={() => setDetailWorker(worker)}
                    className="px-4 py-1.5 bg-white hover:bg-zinc-100 text-zinc-950 font-mono text-xs font-bold uppercase tracking-wider border-2 border-zinc-900 shadow-[2px_2px_0px_0px_#09090b] cursor-pointer active:translate-x-0.5 active:translate-y-0.5"
                  >
                    View All Data
                  </button>
                  <button
                    type="button"
                    disabled={deletingId === worker.id}
                    onClick={() => void handleDeleteWorker(worker)}
                    className="ml-auto px-3 py-1.5 bg-white hover:bg-red-50 text-red-700 border border-zinc-300 hover:border-red-500 font-mono text-xs font-bold uppercase cursor-pointer"
                  >
                    {deletingId === worker.id ? "Purging..." : "Terminate Record"}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Complete Worker 360 Detail Modal */}
      {detailWorker && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setDetailWorker(null)}
        >
          <div
            className="border-2 border-zinc-900 bg-white w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 shadow-[8px_8px_0px_0px_#09090b] text-zinc-950 font-mono"
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
                          ? "bg-emerald-50 text-emerald-800 border-emerald-300"
                          : "bg-zinc-100 text-zinc-600 border-zinc-300"
                      }`}
                    >
                      {detailWorker.isOnline ? "● ONLINE" : "○ OFFLINE"}
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
      )}

      {/* Assign Task Modal */}
      {assignModalWorker && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setAssignModalWorker(null)}
        >
          <div
            className="border-2 border-zinc-900 bg-white w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 shadow-[8px_8px_0px_0px_#09090b] text-zinc-950 font-mono"
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
      )}

      {/* Edit Directive / Task Modal */}
      {editingTask && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setEditingTask(null)}
        >
          <div
            className="border-2 border-zinc-900 bg-white w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 shadow-[8px_8px_0px_0px_#09090b] text-zinc-950 font-mono"
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
      )}
    </div>
  );
}
