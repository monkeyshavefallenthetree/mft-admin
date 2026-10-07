"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  doc,
  updateDoc,
  deleteDoc,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { subscribeTaskChat, sendTaskMessage, type ChatMessage } from "@/lib/taskChat";
import {
  sendChatNotificationToWorkers,
  sendExpoPushToWorkers,
  subscribeAdminChatNotifications,
  markTaskChatNotificationsReadForAdmin,
  type ChatNotification,
} from "@/lib/chatNotifications";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { DEPARTMENTS } from "@/lib/admin/constants";

interface Task {
  id: string;
  title: string;
  description: string;
  projectName?: string;
  projectId?: string;
  assignedTo?: string | string[];
  assignedWorkerName?: string;
  priority: string;
  status: string;
  dueDate?: { toDate?: () => Date } | Date | string | null;
  createdAt?: { toDate?: () => Date } | Date | string | null;
  updatedAt?: { toDate?: () => Date } | Date | string | null;
  rejectionReason?: string;
  department?: string;
  photo?: string | null;
  startedAt?: { toDate?: () => Date } | Date | string | null;
  submittedForApprovalAt?: { toDate?: () => Date } | Date | string | null;
}

interface ProjectRow {
  id: string;
  name: string;
}

interface Worker {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  department?: string;
  status: string;
}

const STATUS_COLORS: Record<string, string> = {
  assigned: "bg-blue-50 text-blue-700 border-blue-300 font-bold",
  "in-progress": "bg-amber-50 text-amber-800 border-amber-300 font-bold",
  "pending-approval": "bg-amber-50 text-amber-800 border-amber-300 font-bold",
  completed: "bg-emerald-50 text-emerald-700 border-emerald-300 font-bold",
};

const PRIORITY_COLORS: Record<string, string> = {
  low: "text-zinc-600 font-bold",
  medium: "text-blue-700 font-bold",
  high: "text-orange-700 font-bold",
  urgent: "text-red-700 font-bold",
};

function formatRole(role: string) {
  if (!role) return "Worker";
  return role
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function assignedWorkerIds(assignedTo: string | string[] | undefined | null): string[] {
  if (!assignedTo) return [];
  if (Array.isArray(assignedTo)) return assignedTo.filter(Boolean);
  if (typeof assignedTo === "string") return [assignedTo];
  return [];
}

function formatLocalDateInput(val: unknown): string {
  if (!val) return "";
  let d: Date | null = null;
  if (val && typeof (val as { toDate?: () => Date }).toDate === "function") {
    d = (val as { toDate: () => Date }).toDate();
  } else if (val instanceof Date) {
    d = val;
  } else if (typeof val === "string") {
    d = new Date(val);
  }
  if (!d || isNaN(d.getTime())) return "";
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function playTerminalBeep() {
  if (typeof window === "undefined") return;
  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "square";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.1);

    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  } catch (e) {
    console.error("Audio play failed", e);
  }
}

type ModalMode = "create" | "edit" | null;
type StatusFilter = "all" | "assigned" | "in-progress" | "pending-approval" | "completed";

export default function AdminTasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const [chatNotifications, setChatNotifications] = useState<ChatNotification[]>([]);
  const chatNotifCountRef = useRef(0);

  // Filters & Search
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Modal State
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [editId, setEditId] = useState("");
  const [workerSearch, setWorkerSearch] = useState("");
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
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

  useEffect(() => {
    const q = query(collection(db, "tasks"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const items: Task[] = [];
        snap.forEach((d) => items.push({ id: d.id, ...d.data() } as Task));
        setTasks(items);
        setLoading(false);
      },
      (err) => {
        console.error("Error loading tasks:", err);
        setLoading(false);
      },
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    const q = query(collection(db, "workers"));
    const unsub = onSnapshot(q, (snap) => {
      const items: Worker[] = [];
      snap.forEach((d) => items.push({ id: d.id, ...d.data() } as Worker));
      setWorkers(items);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    return onSnapshot(collection(db, "projects"), (snap) => {
      const list: ProjectRow[] = [];
      snap.forEach((d) => list.push({ id: d.id, name: (d.data() as { name?: string }).name || d.id }));
      list.sort((a, b) => a.name.localeCompare(b.name));
      setProjects(list);
    });
  }, []);

  // Keep detailTask updated in real-time when tasks change
  useEffect(() => {
    if (detailTask) {
      const fresh = tasks.find((t) => t.id === detailTask.id);
      if (fresh) setDetailTask(fresh);
    }
  }, [tasks]);

  // Subscribe to admin chat notifications (wait for auth to be ready)
  useEffect(() => {
    let chatUnsub: (() => void) | null = null;
    const authUnsub = onAuthStateChanged(getAuth(), (user) => {
      if (!user) return;
      chatUnsub = subscribeAdminChatNotifications(db, (notifs) => {
        setChatNotifications(notifs);
        if (notifs.length > chatNotifCountRef.current && chatNotifCountRef.current >= 0) {
          playTerminalBeep();
        }
        chatNotifCountRef.current = notifs.length;
      });
    });
    return () => {
      authUnsub();
      chatUnsub?.();
    };
  }, []);

  // Subscribe to task chat when detail modal opens
  useEffect(() => {
    if (!detailTask) {
      setChatMessages([]);
      return;
    }
    markTaskChatNotificationsReadForAdmin(db, detailTask.id).catch(() => {});
    const unsub = subscribeTaskChat(db, detailTask.id, (msgs) => {
      setChatMessages(msgs);
      markTaskChatNotificationsReadForAdmin(db, detailTask.id).catch(() => {});
      setTimeout(() => {
        chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 50);
    });
    return () => unsub();
  }, [detailTask]);

  const handleSendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !detailTask) return;
    setChatBusy(true);
    try {
      const admin = getAuth().currentUser;
      const senderUid = admin?.uid ?? "admin";
      const senderName = admin?.displayName || admin?.email || "Admin";
      await sendTaskMessage(db, detailTask.id, {
        text: chatInput,
        senderUid,
        senderName,
        senderRole: "admin",
      });
      const recipientUids = assignedWorkerIds(detailTask.assignedTo);
      if (recipientUids.length > 0) {
        void sendChatNotificationToWorkers(db, {
          recipientUids,
          taskId: detailTask.id,
          taskTitle: detailTask.title || "Task",
          senderUid,
          senderName,
          messageText: chatInput,
        }).catch(() => {});
      }
      setChatInput("");
    } finally {
      setChatBusy(false);
    }
  };

  const getWorkerName = (id: string) => {
    const w = workers.find((w) => w.id === id);
    return w ? `${w.firstName} ${w.lastName}` : id || "Unassigned";
  };

  const formatAssignees = (assignedTo: string | string[] | undefined | null) => {
    const ids = assignedWorkerIds(assignedTo);
    if (ids.length === 0) return "Unassigned";
    return ids.map((id) => getWorkerName(id)).join(", ");
  };

  const approvedWorkers = useMemo(() => {
    return workers.filter((w) => w.status === "approved");
  }, [workers]);

  const filteredModalWorkers = useMemo(() => {
    const q = workerSearch.trim().toLowerCase();
    if (!q) return approvedWorkers;
    return approvedWorkers.filter((w) => {
      const name = `${w.firstName} ${w.lastName}`.toLowerCase();
      const role = (w.role || "").toLowerCase();
      const dept = (w.department || "").toLowerCase();
      return name.includes(q) || role.includes(q) || dept.includes(q);
    });
  }, [approvedWorkers, workerSearch]);

  const projectById = useMemo(() => {
    const m = new Map<string, string>();
    projects.forEach((p) => m.set(p.id, p.name));
    return m;
  }, [projects]);

  const openCreate = () => {
    setForm({
      title: "",
      description: "",
      projectId: "",
      projectName: "",
      department: "general",
      assignedWorkerIds: [],
      priority: "medium",
      status: "assigned",
      dueDate: "",
      photo: "",
      notificationMessage: "",
    });
    setWorkerSearch("");
    setModalMode("create");
  };

  const openEdit = (task: Task) => {
    const dueDateStr = formatLocalDateInput(task.dueDate);
    const assignedIds = assignedWorkerIds(task.assignedTo);
    setForm({
      title: task.title || "",
      description: task.description || "",
      projectId: task.projectId || "",
      projectName: task.projectName || (task.projectId ? projectById.get(task.projectId) || "" : ""),
      department: task.department || "general",
      assignedWorkerIds: assignedIds,
      priority: task.priority || "medium",
      status: task.status || "assigned",
      dueDate: dueDateStr,
      photo: task.photo || "",
      notificationMessage: "",
    });
    setEditId(task.id);
    setWorkerSearch("");
    setModalMode("edit");
  };

  const toggleAssignee = (workerId: string) => {
    setForm((prev) => {
      const set = new Set(prev.assignedWorkerIds);
      if (set.has(workerId)) set.delete(workerId);
      else set.add(workerId);
      return { ...prev, assignedWorkerIds: [...set] };
    });
  };

  const selectAllApprovedWorkers = () => {
    setForm((prev) => ({
      ...prev,
      assignedWorkerIds: approvedWorkers.map((w) => w.id),
    }));
  };

  const clearAllAssignees = () => {
    setForm((prev) => ({
      ...prev,
      assignedWorkerIds: [],
    }));
  };

  const firestoreAssignedTo = (ids: string[]) => {
    if (ids.length === 0) return "";
    if (ids.length === 1) return ids[0];
    return ids;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) {
      alert("Please enter a task title.");
      return;
    }

    setSaving(true);
    try {
      const projName = form.projectId ? projectById.get(form.projectId) || form.projectName : form.projectName;
      const assignedTo = firestoreAssignedTo(form.assignedWorkerIds);
      const assignedWorkerNames = form.assignedWorkerIds.map((id) => getWorkerName(id)).join(", ");

      if (modalMode === "create") {
        const payload: Record<string, unknown> = {
          title: form.title.trim(),
          description: form.description.trim(),
          projectName: projName || "",
          department: form.department || "general",
          photo: form.photo.trim() || null,
          assignedTo,
          assignedWorkerName: assignedWorkerNames || "Unassigned",
          priority: form.priority,
          status: "assigned",
          dueDate: form.dueDate ? new Date(form.dueDate) : null,
          createdAt: serverTimestamp(),
          assignedAt: serverTimestamp(),
        };
        if (form.projectId) {
          payload.projectId = form.projectId;
        }
        const taskRef = await addDoc(collection(db, "tasks"), payload);

        for (const workerId of form.assignedWorkerIds) {
          await addDoc(collection(db, "alerts"), {
            recipients: [workerId],
            title: "New Task Assigned",
            message: form.notificationMessage.trim() || `You have been assigned to task: ${form.title}`,
            type: "schedule",
            priority: form.priority || "medium",
            isRead: false,
            createdAt: serverTimestamp(),
            sentAt: serverTimestamp(),
            sentBy: "System",
          });
        }

        if (form.assignedWorkerIds.length > 0) {
          void sendExpoPushToWorkers(db, {
            recipientUids: form.assignedWorkerIds,
            title: "New Task Assigned",
            body: form.notificationMessage.trim() || `You have been assigned: ${form.title}`,
            taskId: taskRef.id,
            taskTitle: form.title,
          }).catch(() => {});
        }
      } else if (modalMode === "edit" && editId) {
        const updateData: Record<string, unknown> = {
          title: form.title.trim(),
          description: form.description.trim(),
          projectName: projName || "",
          department: form.department || "general",
          photo: form.photo.trim() || null,
          assignedTo,
          assignedWorkerName: assignedWorkerNames || "Unassigned",
          priority: form.priority,
          status: form.status,
          dueDate: form.dueDate ? new Date(form.dueDate) : null,
          updatedAt: serverTimestamp(),
        };
        if (form.projectId) {
          updateData.projectId = form.projectId;
        } else {
          updateData.projectId = null;
        }
        await updateDoc(doc(db, "tasks", editId), updateData);

        for (const workerId of form.assignedWorkerIds) {
          await addDoc(collection(db, "alerts"), {
            recipients: [workerId],
            title: "Task Updated",
            message: form.notificationMessage.trim() || `Task details updated: ${form.title}`,
            type: "schedule",
            priority: form.priority || "medium",
            isRead: false,
            createdAt: serverTimestamp(),
            sentAt: serverTimestamp(),
            sentBy: "System",
          });
        }

        if (form.assignedWorkerIds.length > 0) {
          void sendExpoPushToWorkers(db, {
            recipientUids: form.assignedWorkerIds,
            title: "Task Updated",
            body: form.notificationMessage.trim() || `Task updated: ${form.title}`,
            taskId: editId,
            taskTitle: form.title,
          }).catch(() => {});
        }
      }
      setModalMode(null);
    } catch (err) {
      console.error("Failed to save task:", err);
      alert("Failed to save task. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const deleteTask = async (id: string) => {
    if (confirm("Are you sure you want to delete this task? This action cannot be undone.")) {
      await deleteDoc(doc(db, "tasks", id));
      if (detailTask?.id === id) setDetailTask(null);
    }
  };

  const approveTask = async (id: string) => {
    const task = tasks.find((t) => t.id === id);
    await updateDoc(doc(db, "tasks", id), {
      status: "completed",
      approvedAt: serverTimestamp(),
      approvedBy: "admin",
      updatedAt: serverTimestamp(),
    });
    if (task) {
      const ids = assignedWorkerIds(task.assignedTo);
      for (const workerId of ids) {
        await addDoc(collection(db, "alerts"), {
          recipients: [workerId],
          title: "Task Approved ✅",
          message: `Your task "${task.title}" has been approved!`,
          type: "task",
          priority: "medium",
          isRead: false,
          createdAt: serverTimestamp(),
          sentAt: serverTimestamp(),
          sentBy: "Admin",
        });
      }
      if (ids.length > 0) {
        void sendExpoPushToWorkers(db, {
          recipientUids: ids,
          title: "Task Approved ✅",
          body: `Your task "${task.title}" has been approved!`,
          taskId: task.id,
          taskTitle: task.title,
        }).catch(() => {});
      }
    }
  };

  const rejectTask = async (id: string) => {
    const reason = prompt("Reason for rejection (optional):");
    if (reason === null) return; // cancelled
    const feedback = reason.trim() || "No reason provided";
    const task = tasks.find((t) => t.id === id);
    await updateDoc(doc(db, "tasks", id), {
      status: "in-progress",
      rejectedAt: serverTimestamp(),
      rejectedBy: "admin",
      rejectionReason: feedback,
      updatedAt: serverTimestamp(),
    });
    if (task) {
      const ids = assignedWorkerIds(task.assignedTo);
      for (const workerId of ids) {
        await addDoc(collection(db, "alerts"), {
          recipients: [workerId],
          title: "Task Needs Revision ⚠️",
          message: `Task "${task.title}" rejected: ${feedback}`,
          type: "task",
          priority: "high",
          isRead: false,
          createdAt: serverTimestamp(),
          sentAt: serverTimestamp(),
          sentBy: "Admin",
        });
      }
      if (ids.length > 0) {
        void sendExpoPushToWorkers(db, {
          recipientUids: ids,
          title: "Task Needs Revision ⚠️",
          body: `Task "${task.title}" rejected: ${feedback}`,
          taskId: task.id,
          taskTitle: task.title,
        }).catch(() => {});
      }
    }
  };

  const formatTaskDate = (d: unknown) => {
    if (!d) return "No due date";
    if (typeof (d as { toDate?: () => Date }).toDate === "function") {
      return (d as { toDate: () => Date }).toDate().toLocaleDateString();
    }
    if (d instanceof Date) return d.toLocaleDateString();
    if (typeof d === "string") return new Date(d).toLocaleDateString();
    return "No due date";
  };

  const formatDateTime = (d: unknown) => {
    if (!d) return "—";
    if (typeof (d as { toDate?: () => Date }).toDate === "function") {
      return (d as { toDate: () => Date }).toDate().toLocaleString();
    }
    if (d instanceof Date) return d.toLocaleString();
    if (typeof d === "string") return new Date(d).toLocaleString();
    return "—";
  };

  // Filtered Tasks
  const filteredTasks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return tasks.filter((t) => {
      // Status filter
      if (statusFilter !== "all" && t.status !== statusFilter) return false;

      // Search query
      if (!q) return true;
      const titleMatch = (t.title || "").toLowerCase().includes(q);
      const descMatch = (t.description || "").toLowerCase().includes(q);
      const projMatch = (t.projectName || "").toLowerCase().includes(q);
      const deptMatch = (t.department || "").toLowerCase().includes(q);
      const assigneeMatch = formatAssignees(t.assignedTo).toLowerCase().includes(q);

      return titleMatch || descMatch || projMatch || deptMatch || assigneeMatch;
    });
  }, [tasks, statusFilter, searchQuery, workers]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex items-center gap-3 text-red-500 font-mono text-sm">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Loading task command center...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <h2 className="text-3xl font-oswald font-bold text-zinc-950 uppercase tracking-wider">
            Task Operations &amp; Directives
          </h2>
          {chatNotifications.length > 0 && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-red-100 border border-red-300 rounded-full text-red-700 text-xs font-bold animate-pulse">
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                <path d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7z" />
              </svg>
              {chatNotifications.length} new {chatNotifications.length === 1 ? "message" : "messages"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button onClick={openCreate} className="brutal-btn px-4 py-2">
            + Create &amp; Assign Task
          </button>
        </div>
      </div>

      {/* Interactive Status Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          { id: "all" as const, label: "All Tasks", value: tasks.length, color: "text-zinc-950" },
          { id: "assigned" as const, label: "Assigned", value: tasks.filter((t) => t.status === "assigned").length, color: "text-blue-700" },
          { id: "in-progress" as const, label: "In Progress", value: tasks.filter((t) => t.status === "in-progress").length, color: "text-amber-700" },
          { id: "pending-approval" as const, label: "Pending Approval", value: tasks.filter((t) => t.status === "pending-approval").length, color: "text-amber-700" },
          { id: "completed" as const, label: "Completed", value: tasks.filter((t) => t.status === "completed").length, color: "text-emerald-700" },
        ].map((s) => {
          const isSelected = statusFilter === s.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setStatusFilter(s.id)}
              className={`p-4 text-center rounded-lg border-2 transition-all cursor-pointer ${
                isSelected
                  ? "bg-zinc-100 border-zinc-950 shadow-[3px_3px_0px_0px_#09090b] ring-2 ring-zinc-950"
                  : "bg-white border-zinc-200 shadow-[2px_2px_0px_0px_#09090b] hover:border-zinc-900"
              }`}
            >
              <div className={`text-2xl font-bold font-oswald ${s.color}`}>{s.value}</div>
              <div className="text-xs text-zinc-600 uppercase tracking-wider font-mono font-bold mt-1">
                {s.label}
              </div>
            </button>
          );
        })}
      </div>

      {/* Search & Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white border border-zinc-200 p-4 shadow-[2px_2px_0px_0px_#09090b]">
        <div className="relative flex-1 min-w-[280px]">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by title, description, worker, project, department..."
            className="w-full pl-9 pr-8 py-2 bg-white border border-zinc-300 rounded text-sm text-zinc-900 focus:outline-none focus:border-red-600 font-mono"
          />
          <svg className="w-4 h-4 text-zinc-400 absolute left-3 top-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-2 text-zinc-400 hover:text-zinc-900 text-sm font-bold"
            >
              &times;
            </button>
          )}
        </div>
        <div className="text-xs font-mono text-zinc-500 uppercase font-bold">
          Showing {filteredTasks.length} of {tasks.length} task directives
        </div>
      </div>

      {/* Tasks List */}
      {filteredTasks.length === 0 ? (
        <div className="text-center py-16 text-zinc-500 bg-white border border-zinc-200 rounded-lg shadow-[2px_2px_0px_0px_#09090b]">
          <p className="text-lg font-bold text-zinc-900 font-oswald uppercase">No tasks match criteria</p>
          <p className="text-sm mt-1 font-mono text-zinc-600">
            {tasks.length === 0
              ? "Create and assign your first task using '+ Create & Assign Task'"
              : "Try clearing your search or filter tab to view all tasks"}
          </p>
          {tasks.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setStatusFilter("all");
                setSearchQuery("");
              }}
              className="mt-4 px-4 py-1.5 border border-zinc-300 bg-zinc-50 hover:bg-zinc-100 text-zinc-800 text-xs font-bold uppercase rounded font-mono cursor-pointer"
            >
              Reset Filters
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {filteredTasks.map((task) => (
            <div
              key={task.id}
              className="bg-white border-2 border-zinc-900 shadow-[3px_3px_0px_0px_#09090b] rounded-lg p-6 hover:shadow-[5px_5px_0px_0px_#09090b] transition-all"
            >
              <div className="flex flex-col sm:flex-row justify-between gap-3 mb-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-bold text-zinc-950 font-oswald tracking-wide">{task.title}</h3>
                  <span className="text-xs font-mono font-bold uppercase text-zinc-700 bg-zinc-100 border border-zinc-300 px-2 py-0.5">
                    {task.department || "general"}
                  </span>
                  {task.photo && (
                    <a
                      href={task.photo}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs font-mono font-bold text-red-600 bg-red-50 border border-red-300 px-2 py-0.5 hover:bg-red-100 inline-flex items-center gap-1"
                    >
                      📷 Proof Photo ↗
                    </a>
                  )}
                </div>
                <span
                  className={`inline-block self-start px-3 py-1 rounded-full text-xs font-semibold uppercase border ${
                    STATUS_COLORS[task.status] || STATUS_COLORS.assigned
                  }`}
                >
                  {task.status.replace(/-/g, " ")}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4 text-sm text-zinc-700 font-mono">
                <p>
                  <span className="text-zinc-500 font-medium">Description:</span> {task.description}
                </p>
                <p>
                  <span className="text-zinc-500 font-medium">Project:</span>{" "}
                  <span className="font-semibold text-zinc-900">
                    {task.projectName || (task.projectId ? projectById.get(task.projectId) || task.projectId : "N/A")}
                  </span>
                </p>
                <p>
                  <span className="text-zinc-500 font-medium">Assigned To:</span>{" "}
                  <span className="font-bold text-zinc-950 bg-zinc-100 px-2 py-0.5 border border-zinc-200">
                    {formatAssignees(task.assignedTo)}
                  </span>
                </p>
                <p>
                  <span className="text-zinc-500 font-medium">Priority:</span>{" "}
                  <span className={`uppercase font-bold ${PRIORITY_COLORS[task.priority] || ""}`}>
                    {task.priority}
                  </span>
                </p>
                <p>
                  <span className="text-zinc-500 font-medium">Deadline (Due):</span>{" "}
                  <span className="font-semibold text-zinc-900">{formatTaskDate(task.dueDate)}</span>
                </p>
                <p>
                  <span className="text-zinc-500 font-medium">Created:</span>{" "}
                  <span className="text-zinc-600">{formatTaskDate(task.createdAt)}</span>
                </p>
              </div>

              {/* Action Toolbar with prominent Edit Button */}
              <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-zinc-200">
                <button
                  type="button"
                  onClick={() => openEdit(task)}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-mono font-bold uppercase tracking-wider rounded border border-zinc-900 shadow-[2px_2px_0px_0px_#09090b] transition-transform active:translate-x-0.5 active:translate-y-0.5 cursor-pointer flex items-center gap-1.5"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  Edit Task
                </button>

                <button
                  type="button"
                  onClick={() => setDetailTask(task)}
                  className="relative px-4 py-2 border border-zinc-900 bg-white hover:bg-zinc-100 text-zinc-900 text-xs font-mono font-bold uppercase tracking-wider rounded transition-colors cursor-pointer"
                >
                  View Details &amp; Chat
                  {chatNotifications.some((n) => n.taskId === task.id) && (
                    <span className="absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 text-[10px] font-bold text-white px-1 animate-bounce">
                      {chatNotifications.filter((n) => n.taskId === task.id).length}
                    </span>
                  )}
                </button>

                {task.status === "pending-approval" && (
                  <>
                    <button
                      type="button"
                      onClick={() => void approveTask(task.id)}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-mono font-bold uppercase tracking-wider rounded transition-colors cursor-pointer"
                    >
                      ✓ Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => void rejectTask(task.id)}
                      className="px-4 py-2 border border-red-300 bg-red-50 text-red-700 hover:bg-red-600 hover:text-white text-xs font-mono font-bold uppercase tracking-wider rounded transition-colors cursor-pointer"
                    >
                      ✕ Reject
                    </button>
                  </>
                )}

                <button
                  type="button"
                  onClick={() => void deleteTask(task.id)}
                  className="ml-auto px-3.5 py-2 text-zinc-500 hover:text-red-700 hover:bg-red-50 text-xs font-mono font-bold uppercase tracking-wider rounded transition-colors cursor-pointer"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Task Details Modal */}
      {detailTask && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 backdrop-blur-xs"
          onClick={() => setDetailTask(null)}
        >
          <div
            className="bg-white border-2 border-zinc-900 rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 space-y-3 text-sm text-zinc-800 shadow-[8px_8px_0px_0px_#09090b] font-mono"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b-2 border-zinc-900 mb-2">
              <div>
                <h3 className="text-xl font-bold font-oswald text-zinc-950 uppercase tracking-wider">
                  Task Directives &amp; Chat
                </h3>
                <p className="text-xs text-zinc-500">ID: {detailTask.id}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const t = detailTask;
                    setDetailTask(null);
                    openEdit(t);
                  }}
                  className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-xs font-bold uppercase rounded border border-zinc-900 cursor-pointer flex items-center gap-1"
                >
                  ✏️ Edit Task
                </button>
                <button
                  type="button"
                  onClick={() => setDetailTask(null)}
                  className="text-zinc-500 hover:text-zinc-950 text-2xl font-bold leading-none cursor-pointer pl-1"
                >
                  &times;
                </button>
              </div>
            </div>

            {/* Structured details */}
            <div className="space-y-2 text-xs">
              <p>
                <span className="text-zinc-500 font-bold uppercase">Title:</span>{" "}
                <strong className="text-zinc-950 text-sm">{detailTask.title}</strong>
              </p>
              <p>
                <span className="text-zinc-500 font-bold uppercase">Description:</span>{" "}
                <span className="text-zinc-800 block mt-1 bg-zinc-50 p-2.5 border border-zinc-200 rounded whitespace-pre-wrap">
                  {detailTask.description}
                </span>
              </p>
              <div className="grid grid-cols-2 gap-2 pt-1">
                <p>
                  <span className="text-zinc-500 font-bold uppercase">Project:</span>{" "}
                  <strong className="text-zinc-900 block">
                    {detailTask.projectName ||
                      (detailTask.projectId ? projectById.get(detailTask.projectId) || detailTask.projectId : "N/A")}
                  </strong>
                </p>
                <p>
                  <span className="text-zinc-500 font-bold uppercase">Department:</span>{" "}
                  <strong className="text-zinc-900 uppercase block">{detailTask.department || "general"}</strong>
                </p>
                <p>
                  <span className="text-zinc-500 font-bold uppercase">Priority:</span>{" "}
                  <span className={`font-bold block uppercase ${PRIORITY_COLORS[detailTask.priority] || ""}`}>
                    {detailTask.priority}
                  </span>
                </p>
                <p>
                  <span className="text-zinc-500 font-bold uppercase">Status:</span>{" "}
                  <span className="font-bold text-zinc-900 uppercase block">
                    {detailTask.status.replace(/-/g, " ")}
                  </span>
                </p>
                <p className="col-span-2">
                  <span className="text-zinc-500 font-bold uppercase">Assigned To:</span>{" "}
                  <strong className="text-zinc-950 block bg-zinc-100 p-1.5 border border-zinc-200 mt-0.5">
                    {formatAssignees(detailTask.assignedTo)}
                  </strong>
                </p>
                <p>
                  <span className="text-zinc-500 font-bold uppercase">Deadline:</span>{" "}
                  <strong className="text-zinc-900 block">{formatTaskDate(detailTask.dueDate)}</strong>
                </p>
                <p>
                  <span className="text-zinc-500 font-bold uppercase">Created At:</span>{" "}
                  <span className="text-zinc-600 block">{formatDateTime(detailTask.createdAt)}</span>
                </p>
              </div>

              {detailTask.startedAt && (
                <p>
                  <span className="text-zinc-500 font-bold uppercase">Started Work:</span>{" "}
                  <span className="text-zinc-700">{formatDateTime(detailTask.startedAt)}</span>
                </p>
              )}
              {detailTask.submittedForApprovalAt && (
                <p>
                  <span className="text-zinc-500 font-bold uppercase">Submitted for Approval:</span>{" "}
                  <span className="text-zinc-700">{formatDateTime(detailTask.submittedForApprovalAt)}</span>
                </p>
              )}
              {detailTask.photo && (
                <div className="pt-2">
                  <span className="text-zinc-500 font-bold uppercase block mb-1">Attached Photo / Proof:</span>
                  <a href={detailTask.photo} target="_blank" rel="noreferrer" className="block group">
                    <img
                      src={detailTask.photo}
                      alt="Task proof"
                      className="max-h-48 rounded border-2 border-zinc-900 object-cover group-hover:opacity-90"
                    />
                    <span className="text-xs text-red-600 underline font-bold mt-1 inline-block">
                      View full size ↗
                    </span>
                  </a>
                </div>
              )}
              {detailTask.rejectionReason && (
                <p className="p-2 bg-red-50 border border-red-200 text-red-700">
                  <span className="font-bold">Last rejection reason:</span> {detailTask.rejectionReason}
                </p>
              )}
            </div>

            {/* Task Chat */}
            <div className="mt-4 pt-4 border-t-2 border-zinc-200">
              <h4 className="text-xs font-bold font-mono text-red-600 uppercase mb-2 flex items-center gap-1.5">
                <span>💬</span> Realtime Task Channel
              </h4>
              <div className="flex flex-col gap-2 max-h-48 overflow-y-auto mb-3 pr-1 bg-zinc-50 p-2.5 rounded border border-zinc-200">
                {chatMessages.length === 0 && (
                  <p className="text-xs text-zinc-500 italic py-2 text-center">No messages yet in this task.</p>
                )}
                {chatMessages.map((m) => {
                  const isAdmin = m.senderRole === "admin";
                  const ts = m.createdAt?.toDate
                    ? m.createdAt.toDate().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                    : "—";
                  return (
                    <div key={m.id} className={`flex flex-col gap-0.5 ${isAdmin ? "items-end" : "items-start"}`}>
                      <div
                        className={`max-w-[85%] rounded-lg px-3 py-2 text-xs leading-snug font-mono ${
                          isAdmin
                            ? "bg-red-100 border border-red-200 text-red-950 font-medium"
                            : "bg-white border border-zinc-200 text-zinc-900"
                        }`}
                      >
                        {m.text}
                      </div>
                      <p className="text-[9px] text-zinc-500">
                        {isAdmin ? "YOU (ADMIN)" : m.senderName} · {ts}
                      </p>
                    </div>
                  );
                })}
                <div ref={chatBottomRef} />
              </div>
              <form onSubmit={(e) => void handleSendChat(e)} className="flex gap-2">
                <input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Type message to worker..."
                  disabled={chatBusy}
                  className="flex-1 px-3 py-2 bg-white border border-zinc-300 rounded text-xs text-zinc-900 focus:outline-none focus:border-red-600 placeholder:text-zinc-400 font-mono"
                />
                <button
                  type="submit"
                  disabled={chatBusy || !chatInput.trim()}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold uppercase rounded disabled:opacity-40 cursor-pointer font-mono"
                >
                  Send
                </button>
              </form>
            </div>

            {detailTask.status === "pending-approval" && (
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={async () => {
                    await approveTask(detailTask.id);
                  }}
                  className="flex-1 py-2 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold uppercase tracking-wider cursor-pointer"
                >
                  ✓ Approve Task
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await rejectTask(detailTask.id);
                  }}
                  className="flex-1 py-2 rounded border border-red-300 bg-red-50 text-red-700 hover:bg-red-600 hover:text-white text-xs font-bold uppercase tracking-wider cursor-pointer"
                >
                  ✕ Reject Task
                </button>
              </div>
            )}

            {/* Bottom Modal Actions */}
            <div className="flex gap-2 pt-3 border-t border-zinc-200">
              <button
                type="button"
                onClick={() => {
                  const t = detailTask;
                  setDetailTask(null);
                  openEdit(t);
                }}
                className="flex-1 py-2.5 rounded bg-red-600 hover:bg-red-700 text-white text-xs font-bold uppercase tracking-wider cursor-pointer"
              >
                ✏️ Edit This Task
              </button>
              <button
                type="button"
                onClick={() => setDetailTask(null)}
                className="flex-1 py-2.5 rounded border border-zinc-900 bg-zinc-100 hover:bg-zinc-200 text-zinc-900 text-xs font-bold uppercase tracking-wider cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create / Edit Task Modal */}
      {modalMode && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 backdrop-blur-xs"
          onClick={() => setModalMode(null)}
        >
          <div
            className="bg-white border-2 border-zinc-900 rounded-xl w-full max-w-xl max-h-[90vh] overflow-y-auto p-6 md:p-8 shadow-[8px_8px_0px_0px_#09090b] font-mono text-zinc-950"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5 pb-3 border-b-2 border-zinc-900">
              <div>
                <h3 className="text-2xl font-bold font-oswald text-red-600 uppercase tracking-wider">
                  {modalMode === "create" ? "Create & Assign Task" : "Edit Task & Directives"}
                </h3>
                <p className="text-xs text-zinc-600 mt-0.5">
                  {modalMode === "create"
                    ? "Dispatch a new task to worker(s) with project linking and deadlines"
                    : `Editing Task ID: ${editId}`}
                </p>
              </div>
              <button
                onClick={() => setModalMode(null)}
                className="text-zinc-500 hover:text-zinc-950 text-2xl font-bold leading-none cursor-pointer"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold uppercase tracking-wider text-zinc-800 mb-1">
                  Task Title *
                </label>
                <input
                  required
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="e.g. Design Instagram Campaign Post"
                  className="w-full px-3 py-2.5 bg-white border-2 border-zinc-900 rounded text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-red-600"
                />
              </div>

              <div>
                <label className="block font-bold uppercase tracking-wider text-zinc-800 mb-1">
                  Description &amp; Guidelines *
                </label>
                <textarea
                  required
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Provide detailed instructions, deliverables, requirements..."
                  className="w-full px-3 py-2.5 bg-white border-2 border-zinc-900 rounded text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-red-600 resize-y"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold uppercase tracking-wider text-zinc-800 mb-1">
                    Link to Project (Optional)
                  </label>
                  <select
                    value={form.projectId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setForm({
                        ...form,
                        projectId: id,
                        projectName: id ? projectById.get(id) || "" : form.projectName,
                      });
                    }}
                    className="w-full px-3 py-2 bg-white border-2 border-zinc-900 rounded text-xs font-bold text-zinc-900 focus:outline-none focus:ring-2 focus:ring-red-600"
                  >
                    <option value="">No Project (Stand-alone Directive)</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-bold uppercase tracking-wider text-zinc-800 mb-1">
                    Department
                  </label>
                  <select
                    value={form.department}
                    onChange={(e) => setForm({ ...form, department: e.target.value })}
                    className="w-full px-3 py-2 bg-white border-2 border-zinc-900 rounded text-xs font-bold text-zinc-900 focus:outline-none focus:ring-2 focus:ring-red-600 uppercase"
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
                <div className="flex items-center justify-between mb-1">
                  <label className="font-bold uppercase tracking-wider text-zinc-800">
                    Assigned Workers ({form.assignedWorkerIds.length} Selected)
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={selectAllApprovedWorkers}
                      className="text-[10px] text-red-600 hover:underline font-bold uppercase cursor-pointer"
                    >
                      Select All
                    </button>
                    <span className="text-zinc-300">|</span>
                    <button
                      type="button"
                      onClick={clearAllAssignees}
                      className="text-[10px] text-zinc-500 hover:underline font-bold uppercase cursor-pointer"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                <div className="border-2 border-zinc-900 rounded p-2.5 bg-zinc-50 space-y-2">
                  <input
                    type="text"
                    value={workerSearch}
                    onChange={(e) => setWorkerSearch(e.target.value)}
                    placeholder="Search worker by name or role..."
                    className="w-full px-2.5 py-1.5 bg-white border border-zinc-300 rounded text-xs text-zinc-900 focus:outline-none focus:border-red-600"
                  />

                  <div className="max-h-36 overflow-y-auto space-y-1 pr-1">
                    {filteredModalWorkers.length === 0 ? (
                      <p className="text-zinc-500 text-xs py-2 text-center">No approved workers found.</p>
                    ) : (
                      filteredModalWorkers.map((w) => {
                        const isAssigned = form.assignedWorkerIds.includes(w.id);
                        return (
                          <label
                            key={w.id}
                            className={`flex items-center justify-between gap-2 p-1.5 rounded border transition-colors cursor-pointer ${
                              isAssigned
                                ? "bg-red-50 border-red-300 text-red-950 font-bold"
                                : "bg-white border-zinc-200 text-zinc-900 hover:bg-zinc-100"
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={isAssigned}
                                onChange={() => toggleAssignee(w.id)}
                                className="rounded accent-red-600"
                              />
                              <span className="text-xs">
                                {w.firstName} {w.lastName}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 text-[10px] font-mono">
                              <span className="px-1.5 py-0.5 bg-zinc-100 border border-zinc-300 rounded uppercase">
                                {formatRole(w.role)}
                              </span>
                              {w.department && (
                                <span className="px-1.5 py-0.5 bg-zinc-200 rounded uppercase text-zinc-700">
                                  {w.department}
                                </span>
                              )}
                            </div>
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {modalMode === "edit" ? (
                  <div>
                    <label className="block font-bold uppercase tracking-wider text-zinc-800 mb-1">
                      Status
                    </label>
                    <select
                      value={form.status}
                      onChange={(e) => setForm({ ...form, status: e.target.value })}
                      className="w-full px-3 py-2 bg-white border-2 border-zinc-900 rounded text-xs font-bold text-zinc-900 focus:outline-none focus:ring-2 focus:ring-red-600"
                    >
                      <option value="assigned">Assigned</option>
                      <option value="in-progress">In Progress</option>
                      <option value="pending-approval">Pending Approval</option>
                      <option value="completed">Completed</option>
                    </select>
                  </div>
                ) : (
                  <div>
                    <label className="block font-bold uppercase tracking-wider text-zinc-800 mb-1">
                      Initial Status
                    </label>
                    <input
                      disabled
                      value="Assigned"
                      className="w-full px-3 py-2 bg-zinc-100 border-2 border-zinc-300 rounded text-xs font-bold text-zinc-500 uppercase"
                    />
                  </div>
                )}

                <div>
                  <label className="block font-bold uppercase tracking-wider text-zinc-800 mb-1">
                    Priority
                  </label>
                  <select
                    value={form.priority}
                    onChange={(e) => setForm({ ...form, priority: e.target.value })}
                    className="w-full px-3 py-2 bg-white border-2 border-zinc-900 rounded text-xs font-bold text-zinc-900 focus:outline-none focus:ring-2 focus:ring-red-600"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent / Critical</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold uppercase tracking-wider text-zinc-800 mb-1">
                    Deadline (Due Date)
                  </label>
                  <input
                    type="date"
                    value={form.dueDate}
                    onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                    className="w-full px-3 py-2 bg-white border-2 border-zinc-900 rounded text-xs font-bold text-zinc-900 focus:outline-none focus:ring-2 focus:ring-red-600"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold uppercase tracking-wider text-zinc-800 mb-1">
                  Photo / Attachment Proof URL (Optional)
                </label>
                <input
                  value={form.photo}
                  onChange={(e) => setForm({ ...form, photo: e.target.value })}
                  placeholder="https://firebasestorage.googleapis.com/..."
                  className="w-full px-3 py-2 bg-white border-2 border-zinc-900 rounded text-xs text-zinc-900 focus:outline-none focus:ring-2 focus:ring-red-600"
                />
              </div>

              <div>
                <label className="block font-bold uppercase tracking-wider text-zinc-800 mb-1">
                  Custom Mobile Push Notification Message (Optional)
                </label>
                <textarea
                  value={form.notificationMessage}
                  onChange={(e) => setForm({ ...form, notificationMessage: e.target.value })}
                  rows={2}
                  placeholder={
                    modalMode === "create"
                      ? "Custom message to worker (defaults to 'You have been assigned to task: [Title]')"
                      : "Custom update alert message to worker (defaults to 'Task details updated: [Title]')"
                  }
                  className="w-full px-3 py-2 bg-white border-2 border-zinc-900 rounded text-xs text-zinc-900 focus:outline-none focus:ring-2 focus:ring-red-600 resize-y"
                />
              </div>

              <div className="flex gap-3 justify-end pt-3 border-t-2 border-zinc-900">
                <button
                  type="button"
                  onClick={() => setModalMode(null)}
                  disabled={saving}
                  className="px-4 py-2 border-2 border-zinc-900 text-zinc-800 hover:bg-zinc-100 rounded font-mono text-xs font-bold uppercase cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white rounded font-mono text-xs font-bold uppercase tracking-wider border-2 border-zinc-900 shadow-[2px_2px_0px_0px_#09090b] cursor-pointer disabled:opacity-50"
                >
                  {saving ? "Saving..." : modalMode === "create" ? "Dispatch Task" : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
