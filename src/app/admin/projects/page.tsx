"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import {
  collection,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { PROJECT_TYPES, PROJECT_STATUSES, TASK_DEPARTMENTS } from "@/lib/admin/constants";
import { subscribeTaskChat, sendTaskMessage, type ChatMessage } from "@/lib/taskChat";
import {
  sendChatNotificationToWorkers,
  sendExpoPushToWorkers,
  markTaskChatNotificationsReadForAdmin,
  subscribeAdminChatNotifications,
  type ChatNotification,
} from "@/lib/chatNotifications";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import TasksCalendar from "@/components/admin/TasksCalendar";

interface Project {
  id: string;
  name: string;
  clientName?: string;
  description: string;
  projectTypes: string[];
  status: string;
  startDate?: string | null;
  endDate?: string | null;
  createdAt?: { toDate: () => Date };
}

interface Worker {
  id: string;
  firstName: string;
  lastName: string;
  status: string;
}

interface TaskRow {
  id: string;
  projectId?: string;
  title: string;
  description: string;
  department?: string;
  assignedTo: string | string[];
  priority: string;
  status: string;
  dueDate?: { toDate: () => Date } | null;
  createdAt?: { toDate: () => Date };
  photo?: string | null;
  startedAt?: { toDate: () => Date } | null;
  submittedForApprovalAt?: { toDate: () => Date } | null;
  approvedAt?: { toDate: () => Date } | null;
  approvedBy?: string | null;
  rejectedAt?: { toDate: () => Date } | null;
  rejectedBy?: string | null;
  rejectionReason?: string | null;
}

const defaultCreate = {
  name: "",
  clientName: "",
  description: "",
  projectTypes: [] as string[],
  status: "active",
  startDate: "",
  endDate: "",
};

type ProjectFormState = typeof defaultCreate & { id?: string };

const PRIORITY_COLORS: Record<string, string> = {
  low: "text-zinc-600 border-zinc-300 bg-zinc-50 font-bold",
  medium: "text-blue-700 border-blue-300 bg-blue-50 font-bold",
  high: "text-orange-700 border-orange-300 bg-orange-50 font-bold",
  urgent: "text-red-700 border-red-300 bg-red-50 font-bold",
};

const STATUS_COLORS: Record<string, string> = {
  assigned: "text-blue-700 border-blue-300 bg-blue-50 font-bold",
  "in-progress": "text-amber-800 border-amber-300 bg-amber-50 font-bold",
  "pending-approval": "text-amber-800 border-amber-300 bg-amber-50 font-bold",
  completed: "text-emerald-700 border-emerald-300 bg-emerald-50 font-bold",
};

/* ─── Task Chat Panel ─── */
function TaskChatPanel({ taskId, taskTitle, assignedTo }: { taskId: string; taskTitle?: string; assignedTo?: string | string[] }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    markTaskChatNotificationsReadForAdmin(db, taskId).catch(() => {});
    const unsub = subscribeTaskChat(db, taskId, (msgs) => {
      setMessages(msgs);
      markTaskChatNotificationsReadForAdmin(db, taskId).catch(() => {});
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    });
    return () => unsub();
  }, [taskId]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    setBusy(true);
    try {
      const admin = getAuth().currentUser;
      const senderUid = admin?.uid ?? "admin";
      const senderName = admin?.displayName || admin?.email || "Admin";
      await sendTaskMessage(db, taskId, {
        text: input,
        senderUid,
        senderName,
        senderRole: "admin",
      });
      const recipientUids = assignedTo
        ? (Array.isArray(assignedTo) ? assignedTo : [assignedTo])
        : [];
      if (recipientUids.length > 0) {
        void sendChatNotificationToWorkers(db, {
          recipientUids,
          taskId,
          taskTitle: taskTitle || "Task",
          senderUid,
          senderName,
          messageText: input,
        }).catch(() => {});
      }
      setInput("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 border-t border-zinc-200 pt-4 bg-zinc-50 p-4 border rounded">
      <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-500 mb-3">{"// COMMS"}</p>
      <div className="max-h-36 overflow-y-auto flex flex-col gap-2 mb-3 pr-1">
        {messages.length === 0 && (
          <p className="text-[9px] uppercase text-zinc-500 italic">No messages.</p>
        )}
        {messages.map((m) => {
          const isAdmin = m.senderRole === "admin";
          const ts = m.createdAt?.toDate().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
          return (
            <div key={m.id} className={`flex flex-col gap-0.5 ${isAdmin ? "items-end" : "items-start"}`}>
              <div className={`max-w-[80%] border px-3 py-1.5 text-xs leading-snug font-mono ${
                isAdmin ? "border-red-200 bg-red-100 text-red-950 font-medium" : "border-zinc-200 bg-white text-zinc-950"
              }`}>
                {m.text}
              </div>
              <p className="text-[8px] uppercase text-zinc-500">{isAdmin ? "YOU" : m.senderName} · {ts}</p>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
      <form onSubmit={(e) => void handleSend(e)} className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Message worker..."
          disabled={busy}
          className="brutal-input flex-1 text-xs py-1.5"
        />
        <button type="submit" disabled={busy || !input.trim()} className="brutal-btn px-3 py-1.5 text-[10px] disabled:opacity-40">
          {busy ? "..." : "SEND"}
        </button>
      </form>
    </div>
  );
}

/* ─── Main Page ─── */
export default function AdminProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [search, setSearch] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showAddTask, setShowAddTask] = useState(false);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [taskFilter, setTaskFilter] = useState<"all" | "pending" | "active" | "completed">("all");
  const [projectFilter, setProjectFilter] = useState<"all" | "needs-approval" | "active" | "completed" | "unread">("all");
  const [createForm, setCreateForm] = useState<ProjectFormState>(defaultCreate);
  const [editForm, setEditForm] = useState<ProjectFormState>(defaultCreate);
  const [taskForm, setTaskForm] = useState({
    title: "",
    description: "",
    department: "general",
    priority: "medium",
    dueDate: "",
    photo: "",
    workerIds: [] as string[],
  });

  useEffect(() => {
    return onSnapshot(collection(db, "projects"), (snap) => {
      const list: Project[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() } as Project));
      list.sort((a, b) => (b.createdAt?.toDate?.()?.getTime() ?? 0) - (a.createdAt?.toDate?.()?.getTime() ?? 0));
      setProjects(list);
    });
  }, []);

  useEffect(() => {
    return onSnapshot(collection(db, "tasks"), (snap) => {
      const list: TaskRow[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() } as TaskRow));
      list.sort((a, b) => (b.createdAt?.toDate?.()?.getTime() ?? 0) - (a.createdAt?.toDate?.()?.getTime() ?? 0));
      setTasks(list);
    });
  }, []);

  useEffect(() => {
    return onSnapshot(collection(db, "workers"), (snap) => {
      const list: Worker[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() } as Worker));
      setWorkers(list);
    });
  }, []);

  const [chatNotifications, setChatNotifications] = useState<ChatNotification[]>([]);

  useEffect(() => {
    let chatUnsub: (() => void) | null = null;
    const authUnsub = onAuthStateChanged(getAuth(), (user) => {
      if (!user) return;
      chatUnsub = subscribeAdminChatNotifications(db, (notifs) => {
        setChatNotifications(notifs);
      });
    });
    return () => {
      authUnsub();
      chatUnsub?.();
    };
  }, []);

  const filteredTasks = useMemo(() => {
    if (!selectedDate) return tasks;
    return tasks.filter((t) => {
      if (!t.dueDate) return false;
      const val = t.dueDate as any;
      const d = typeof val.toDate === "function" ? val.toDate() : new Date(val);
      return d.getFullYear() === selectedDate.getFullYear() &&
             d.getMonth() === selectedDate.getMonth() &&
             d.getDate() === selectedDate.getDate();
    });
  }, [tasks, selectedDate]);

  const unreadByProject = useMemo(() => {
    const map = new Map<string, number>();
    for (const notif of chatNotifications) {
      const task = filteredTasks.find((t) => t.id === notif.taskId);
      if (task?.projectId) {
        map.set(task.projectId, (map.get(task.projectId) ?? 0) + 1);
      }
    }
    return map;
  }, [chatNotifications, filteredTasks]);

  const approvedWorkers = workers.filter((w) => w.status === "approved");

  const projectsNeedingApproval = useMemo(() => {
    return new Set(
      tasks
        .filter((t) => {
          const s = (t.status || "").toLowerCase().trim();
          return (s === "pending-approval" || s === "pending_approval" || s === "pending") && t.projectId;
        })
        .map((t) => t.projectId!)
    );
  }, [tasks]);

  const projectsWithUnread = useMemo(() => {
    return new Set(
      Array.from(unreadByProject.keys()).filter((pid) => (unreadByProject.get(pid) ?? 0) > 0)
    );
  }, [unreadByProject]);

  const totalPendingTasksCount = useMemo(() => {
    return tasks.filter((t) => {
      const s = (t.status || "").toLowerCase().trim();
      return s === "pending-approval" || s === "pending_approval" || s === "pending";
    }).length;
  }, [tasks]);

  const getProjectEffectiveStatus = (p: Project) => {
    if (p.status === "completed") return "completed";
    const pTasks = tasks.filter((t) => t.projectId === p.id);
    if (pTasks.length > 0 && pTasks.every((t) => t.status === "completed")) {
      return "completed";
    }
    return p.status || "active";
  };

  // Auto-sync projects with 100% completed tasks to "completed" in Firestore
  useEffect(() => {
    if (projects.length === 0 || tasks.length === 0) return;
    projects.forEach((p) => {
      const pTasks = tasks.filter((t) => t.projectId === p.id);
      if (pTasks.length > 0 && pTasks.every((t) => t.status === "completed") && p.status !== "completed") {
        updateDoc(doc(db, "projects", p.id), {
          status: "completed",
          updatedAt: serverTimestamp(),
        }).catch(() => {});
      }
    });
  }, [projects, tasks]);

  const activeProjectsCount = useMemo(() => {
    return projects.filter((p) => getProjectEffectiveStatus(p) === "active").length;
  }, [projects, tasks]);

  const completedProjectsCount = useMemo(() => {
    return projects.filter((p) => getProjectEffectiveStatus(p) === "completed").length;
  }, [projects, tasks]);

  const filteredProjects = useMemo(() => {
    const t = search.trim().toLowerCase();
    return projects.filter((p) => {
      const effectiveStatus = getProjectEffectiveStatus(p);

      // Category filter tab
      if (projectFilter === "needs-approval" && !projectsNeedingApproval.has(p.id)) return false;
      if (projectFilter === "unread" && !projectsWithUnread.has(p.id)) return false;
      if (projectFilter === "active" && effectiveStatus !== "active") return false;
      if (projectFilter === "completed" && effectiveStatus !== "completed") return false;

      // Text search
      if (!t) return true;
      const types = (p.projectTypes || []).join(" ").toLowerCase();
      return (
        p.name.toLowerCase().includes(t) ||
        (p.clientName || "").toLowerCase().includes(t) ||
        types.includes(t)
      );
    });
  }, [projects, search, projectFilter, projectsNeedingApproval, projectsWithUnread, tasks]);

  const detailProject = detailId ? projects.find((p) => p.id === detailId) : null;
  const projectTasks = detailId ? filteredTasks.filter((t) => t.projectId === detailId) : [];

  const formatAssignees = (assignedTo: string | string[]) => {
    const ids = Array.isArray(assignedTo) ? assignedTo : assignedTo ? [assignedTo] : [];
    return ids
      .map((id) => {
        const w = workers.find((x) => x.id === id);
        return w ? `${w.firstName} ${w.lastName}` : id;
      })
      .join(", ") || "—";
  };

  const submitCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (createForm.projectTypes.length === 0) { alert("Select at least one project type."); return; }
    await addDoc(collection(db, "projects"), {
      name: createForm.name, clientName: createForm.clientName,
      description: createForm.description, projectTypes: createForm.projectTypes,
      status: createForm.status, startDate: createForm.startDate || null,
      endDate: createForm.endDate || null, createdAt: serverTimestamp(),
    });
    setShowCreate(false);
    setCreateForm(defaultCreate);
  };

  const openEdit = (p: Project) => {
    setEditForm({ id: p.id, name: p.name, clientName: p.clientName || "", description: p.description,
      projectTypes: p.projectTypes || [], status: p.status || "active",
      startDate: p.startDate || "", endDate: p.endDate || "" });
    setShowEdit(true);
  };

  const submitEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editForm.id) return;
    if (editForm.projectTypes.length === 0) { alert("Select at least one project type."); return; }
    await updateDoc(doc(db, "projects", editForm.id), {
      name: editForm.name, clientName: editForm.clientName, description: editForm.description,
      projectTypes: editForm.projectTypes, status: editForm.status,
      startDate: editForm.startDate || null, endDate: editForm.endDate || null,
      updatedAt: serverTimestamp(),
    });
    setShowEdit(false);
  };

  const deleteProject = async (projectId: string) => {
    const linked = tasks.filter((t) => t.projectId === projectId);
    const msg = linked.length > 0
      ? `This project has ${linked.length} task(s). They will be deleted too. Continue?`
      : "Delete this project?";
    if (!confirm(msg)) return;
    for (const t of linked) await deleteDoc(doc(db, "tasks", t.id));
    await deleteDoc(doc(db, "projects", projectId));
    if (detailId === projectId) setDetailId(null);
  };

  const deleteTask = async (taskId: string) => {
    if (!confirm("Delete this task?")) return;
    await deleteDoc(doc(db, "tasks", taskId));
  };

  const approveTask = async (task: TaskRow) => {
    try {
      await updateDoc(doc(db, "tasks", task.id), {
        status: "completed",
        approvedAt: serverTimestamp(),
        approvedBy: "admin",
        updatedAt: serverTimestamp(),
      });

      // If all tasks for this project are completed, auto-mark project as completed
      if (task.projectId) {
        const otherTasks = tasks.filter((t) => t.projectId === task.projectId && t.id !== task.id);
        const allCompleted = otherTasks.length === 0 || otherTasks.every((t) => t.status === "completed");
        if (allCompleted) {
          void updateDoc(doc(db, "projects", task.projectId), {
            status: "completed",
            updatedAt: serverTimestamp(),
          }).catch(() => {});
        }
      }

      const ids = Array.isArray(task.assignedTo) ? task.assignedTo : task.assignedTo ? [task.assignedTo] : [];
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
    } catch (err) {
      console.error("Failed to approve task:", err);
      alert("Failed to approve task.");
    }
  };

  const rejectTask = async (task: TaskRow) => {
    const reason = prompt("Enter reason for rejection / feedback for worker (optional):");
    if (reason === null) return; // cancelled
    try {
      await updateDoc(doc(db, "tasks", task.id), {
        status: "in-progress",
        rejectedAt: serverTimestamp(),
        rejectedBy: "admin",
        rejectionReason: reason.trim() || "Needs revision",
        updatedAt: serverTimestamp(),
      });

      // If rejected, ensure project is active
      if (task.projectId) {
        void updateDoc(doc(db, "projects", task.projectId), {
          status: "active",
          updatedAt: serverTimestamp(),
        }).catch(() => {});
      }

      const ids = Array.isArray(task.assignedTo) ? task.assignedTo : task.assignedTo ? [task.assignedTo] : [];
      for (const workerId of ids) {
        await addDoc(collection(db, "alerts"), {
          recipients: [workerId],
          title: "Task Needs Revision ⚠️",
          message: `Task "${task.title}" rejected: ${reason.trim() || "Needs revision"}`,
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
          body: `Task "${task.title}" needs revision: ${reason.trim() || "Needs revision"}`,
          taskId: task.id,
          taskTitle: task.title,
        }).catch(() => {});
      }
    } catch (err) {
      console.error("Failed to reject task:", err);
      alert("Failed to reject task.");
    }
  };

  const toggleProjectStatus = async (projectId: string, currentStatus: string) => {
    const nextStatus = currentStatus === "completed" ? "active" : "completed";
    await updateDoc(doc(db, "projects", projectId), {
      status: nextStatus,
      updatedAt: serverTimestamp(),
    });
  };

  const submitAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detailId) return;
    if (taskForm.workerIds.length === 0) { alert("Select at least one worker."); return; }
    const taskRef = await addDoc(collection(db, "tasks"), {
      projectId: detailId, title: taskForm.title, description: taskForm.description,
      department: taskForm.department, assignedTo: taskForm.workerIds,
      priority: taskForm.priority, dueDate: taskForm.dueDate ? new Date(taskForm.dueDate) : null,
      photo: taskForm.photo.trim() || null, status: "assigned",
      createdAt: serverTimestamp(), assignedAt: serverTimestamp(),
    });

    if (detailProject && detailProject.status === "completed") {
      await updateDoc(doc(db, "projects", detailId), {
        status: "active",
        updatedAt: serverTimestamp(),
      });
    }

    const projName = detailProject?.name || "a project";
    if (taskForm.workerIds.length > 0) {
      void sendExpoPushToWorkers(db, {
        recipientUids: taskForm.workerIds,
        title: `New Task in ${projName}`,
        body: `${taskForm.title}`,
        taskId: taskRef.id,
        taskTitle: taskForm.title,
      }).catch(() => {});
    }

    setShowAddTask(false);
    setTaskForm({ title: "", description: "", department: "general", priority: "medium", dueDate: "", photo: "", workerIds: [] });
  };

  /* ── Project Detail View ── */
  if (detailProject) {
    const tasksByStatus = {
      active: projectTasks.filter((t) => ["assigned", "in-progress"].includes(t.status)),
      pending: projectTasks.filter((t) => t.status === "pending-approval"),
      done: projectTasks.filter((t) => t.status === "completed"),
    };

    const handleOpenAddTask = () => {
      let prefillDate = "";
      if (selectedDate) {
        const pad = (n: number) => n.toString().padStart(2, '0');
        prefillDate = `${selectedDate.getFullYear()}-${pad(selectedDate.getMonth() + 1)}-${pad(selectedDate.getDate())}`;
      }
      setTaskForm(prev => ({ ...prev, dueDate: prefillDate }));
      setShowAddTask(true);
    };

    const effectiveDetailStatus = getProjectEffectiveStatus(detailProject);

    return (
      <div className="space-y-8">
        {/* Breadcrumb */}
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => setDetailId(null)}
            className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 hover:text-red-600 transition-colors cursor-pointer">
            ← PROJECTS
          </button>
          <span className="text-zinc-300">/</span>
          <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-950">{detailProject.name}</span>
        </div>

        {/* Project Header */}
        <div className="border border-zinc-200 bg-white p-6 shadow-[3px_3px_0px_0px_#09090b]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[9px] font-bold uppercase tracking-[0.3em] text-zinc-500 mb-1">
                PROJECT.RECORD {"//"}
              </p>
              <h2 className="text-3xl font-oswald font-bold text-zinc-950 uppercase tracking-wider">
                {detailProject.name}
              </h2>
              {detailProject.clientName && (
                <p className="text-xs uppercase tracking-widest text-red-600 font-bold mt-1">
                  CLIENT: {detailProject.clientName}
                </p>
              )}
              <p className="text-sm text-zinc-600 mt-3 max-w-2xl leading-relaxed">
                {detailProject.description}
              </p>
              <div className="flex flex-wrap gap-2 mt-4">
                <span
                  className={`brutal-badge font-bold ${
                    effectiveDetailStatus === "completed"
                      ? "text-emerald-800 border-emerald-300 bg-emerald-50"
                      : "text-zinc-700 border-zinc-300 bg-zinc-100"
                  }`}
                >
                  {effectiveDetailStatus.toUpperCase()}
                </span>
                {(detailProject.projectTypes || []).map((t) => (
                  <span key={t} className="brutal-badge text-zinc-700 border-zinc-300 bg-zinc-100">{t}</span>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void toggleProjectStatus(detailProject.id, effectiveDetailStatus)}
                className={`px-4 py-2 text-xs font-bold uppercase tracking-widest cursor-pointer border-2 border-zinc-900 transition-all ${
                  effectiveDetailStatus === "completed"
                    ? "bg-zinc-100 hover:bg-zinc-200 text-zinc-900 shadow-[2px_2px_0px_0px_#09090b]"
                    : "bg-emerald-600 hover:bg-emerald-700 text-white shadow-[2px_2px_0px_0px_#09090b]"
                }`}
              >
                {effectiveDetailStatus === "completed" ? "[ REOPEN PROJECT ]" : "[ MARK COMPLETED ]"}
              </button>
              <button type="button" onClick={() => openEdit(detailProject)} className="brutal-btn-outline px-4 py-2">
                [ EDIT ]
              </button>
              <button type="button" onClick={handleOpenAddTask} className="brutal-btn px-4 py-2">
                [ + TASK ]
              </button>
              <button type="button" onClick={() => void deleteProject(detailProject.id)}
                className="border border-red-300 bg-red-50 px-4 py-2 text-xs font-bold uppercase tracking-widest text-red-700 hover:bg-red-600 hover:text-white transition-colors cursor-pointer">
                [ DELETE ]
              </button>
            </div>
          </div>

          {/* Task stats bar */}
          <div className="mt-6 grid grid-cols-3 gap-px bg-zinc-200 border border-zinc-200">
            {[
              { id: "active", label: "Active", count: tasksByStatus.active.length, color: "text-blue-700" },
              { id: "pending", label: "Pending Review", count: tasksByStatus.pending.length, color: "text-amber-700" },
              { id: "completed", label: "Completed", count: tasksByStatus.done.length, color: "text-emerald-700" },
            ].map((s) => (
              <button
                key={s.label}
                type="button"
                onClick={() => setTaskFilter(taskFilter === s.id ? "all" : (s.id as "all" | "pending" | "active" | "completed"))}
                className={`bg-white px-4 py-3 text-center cursor-pointer transition-all ${
                  taskFilter === s.id ? "bg-zinc-100 ring-2 ring-zinc-950 inset-0 z-10" : "hover:bg-zinc-50"
                }`}
              >
                <div className={`text-2xl font-oswald font-bold ${s.color}`}>{s.count}</div>
                <div className="text-[9px] font-bold uppercase tracking-widest text-zinc-500 mt-0.5">{s.label}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Project Specific Calendar */}
        <TasksCalendar tasks={tasks.filter(t => t.projectId === detailId)} selectedDate={selectedDate} onSelectDate={setSelectedDate} />

        {/* Tasks */}
        <div>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                {"// TASK MANIFEST"}
              </p>
              <span className="text-zinc-950 font-bold font-mono text-xs">
                [{projectTasks.filter((t) => {
                  if (taskFilter === "pending") return t.status === "pending-approval";
                  if (taskFilter === "active") return ["assigned", "in-progress"].includes(t.status);
                  if (taskFilter === "completed") return t.status === "completed";
                  return true;
                }).length}]
              </span>
              {tasksByStatus.pending.length > 0 && (
                <span className="px-2 py-0.5 bg-amber-100 border border-amber-300 text-amber-800 text-[10px] font-bold uppercase tracking-wider animate-pulse ml-2">
                  ⚠️ {tasksByStatus.pending.length} PENDING APPROVAL
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {(
                [
                  { id: "all", label: `ALL (${projectTasks.length})` },
                  { id: "pending", label: `PENDING (${tasksByStatus.pending.length})` },
                  { id: "active", label: `ACTIVE (${tasksByStatus.active.length})` },
                  { id: "completed", label: `COMPLETED (${tasksByStatus.done.length})` },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setTaskFilter(tab.id)}
                  className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider cursor-pointer border transition-colors ${
                    taskFilter === tab.id
                      ? "bg-zinc-950 text-white border-zinc-950"
                      : "bg-white text-zinc-600 border-zinc-200 hover:border-zinc-400"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {projectTasks.filter((t) => {
            if (taskFilter === "pending") return t.status === "pending-approval";
            if (taskFilter === "active") return ["assigned", "in-progress"].includes(t.status);
            if (taskFilter === "completed") return t.status === "completed";
            return true;
          }).length === 0 ? (
            <div className="border border-dashed border-zinc-300 bg-white p-12 text-center">
              <p className="text-xs font-bold uppercase tracking-widest text-zinc-900">
                {taskFilter === "all" ? "NO TASKS ASSIGNED" : `NO ${taskFilter.toUpperCase()} TASKS FOUND`}
              </p>
              <p className="mt-2 text-[10px] uppercase tracking-widest text-zinc-500">
                {taskFilter === "all" ? 'Use "[ + TASK ]" to add a task to this project' : 'Click "ALL" tab to view all project tasks'}
              </p>
            </div>
          ) : (
            <div className="space-y-0 border border-zinc-200 bg-white shadow-[3px_3px_0px_0px_#09090b]">
              {projectTasks.filter((t) => {
                if (taskFilter === "pending") return t.status === "pending-approval";
                if (taskFilter === "active") return ["assigned", "in-progress"].includes(t.status);
                if (taskFilter === "completed") return t.status === "completed";
                return true;
              }).map((task, idx) => {
                const isExpanded = expandedTaskId === task.id;
                return (
                  <div key={task.id} className={`border-b border-zinc-200 last:border-0 ${isExpanded ? "bg-zinc-50" : "bg-white hover:bg-zinc-50/70"} transition-colors`}>
                    {/* Task row header */}
                    <button
                      type="button"
                      onClick={() => setExpandedTaskId(isExpanded ? null : task.id)}
                      className="w-full flex items-start gap-4 px-6 py-4 text-left cursor-pointer"
                    >
                      <span className="text-[10px] font-bold text-zinc-400 mt-0.5 shrink-0 font-mono">
                        {String(idx + 1).padStart(2, "0")}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold uppercase tracking-wider text-zinc-950 text-sm truncate">{task.title}</p>
                        <p className="text-[10px] uppercase tracking-widest mt-1 text-zinc-500 truncate">
                          {formatAssignees(task.assignedTo)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {chatNotifications.some((n) => n.taskId === task.id) && (
                          <span className="flex items-center gap-1 px-2 py-0.5 bg-red-100 border border-red-300 text-red-700 text-[9px] font-bold uppercase tracking-widest animate-pulse">
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7z" /></svg>
                            {chatNotifications.filter((n) => n.taskId === task.id).length}
                          </span>
                        )}
                        <span className={`brutal-badge ${PRIORITY_COLORS[task.priority] ?? "text-zinc-600 border-zinc-300"}`}>
                          {task.priority}
                        </span>
                        <span className={`brutal-badge ${STATUS_COLORS[task.status] ?? "text-zinc-600 border-zinc-300"}`}>
                          {task.status.replace(/-/g, " ")}
                        </span>
                        {task.status === "pending-approval" && (
                          <span
                            onClick={(e) => {
                              e.stopPropagation();
                              void approveTask(task);
                            }}
                            title="Quick Approve"
                            className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold uppercase tracking-wider border border-zinc-900 shadow-[1px_1px_0px_0px_#09090b] transition-transform active:translate-x-0.5 active:translate-y-0.5 cursor-pointer"
                          >
                            ✓ APPROVE
                          </span>
                        )}
                        <span className="text-zinc-500 text-xs font-bold">{isExpanded ? "[-]" : "[+]"}</span>
                      </div>
                    </button>

                    {/* Expanded task detail */}
                    {isExpanded && (
                      <div className="px-6 pb-6 space-y-4">
                        <div className="border-t border-zinc-200 pt-4 grid gap-4 sm:grid-cols-2">
                          <div>
                            <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-500 mb-1">Description</p>
                            <p className="text-sm text-zinc-900 leading-relaxed font-mono whitespace-pre-wrap">{task.description || "—"}</p>
                          </div>
                          <div className="space-y-3">
                            <div>
                              <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-500 mb-1">Department</p>
                              <p className="text-xs text-zinc-900 font-bold uppercase">{task.department || "—"}</p>
                            </div>
                            <div>
                              <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-500 mb-1">Due Date</p>
                              <p className="text-xs text-zinc-900 font-bold">{task.dueDate?.toDate ? task.dueDate.toDate().toLocaleDateString() : "No due date"}</p>
                            </div>
                            {task.startedAt?.toDate && (
                              <div>
                                <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-500 mb-1">Started Work</p>
                                <p className="text-xs text-zinc-700 font-mono">{task.startedAt.toDate().toLocaleString()}</p>
                              </div>
                            )}
                            {task.submittedForApprovalAt?.toDate && (
                              <div>
                                <p className="text-[9px] font-bold uppercase tracking-widest text-amber-700 mb-1 font-bold">Submitted for Approval</p>
                                <p className="text-xs text-amber-900 font-bold font-mono">{task.submittedForApprovalAt.toDate().toLocaleString()}</p>
                              </div>
                            )}
                            {task.approvedAt?.toDate && (
                              <div>
                                <p className="text-[9px] font-bold uppercase tracking-widest text-emerald-700 mb-1 font-bold">Approved At</p>
                                <p className="text-xs text-emerald-900 font-bold font-mono">{task.approvedAt.toDate().toLocaleString()} by {task.approvedBy || "Admin"}</p>
                              </div>
                            )}
                          </div>

                          {/* Proof / Attached Photo */}
                          {task.photo && (
                            <div className="sm:col-span-2 pt-2 border-t border-zinc-200">
                              <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-500 mb-1.5">Attached Photo / Proof of Work</p>
                              <a href={task.photo} target="_blank" rel="noreferrer" className="inline-block group">
                                <img src={task.photo} alt="Task proof" className="max-h-56 max-w-full rounded border-2 border-zinc-900 object-cover group-hover:opacity-90 shadow-[2px_2px_0px_0px_#09090b]" />
                                <span className="text-xs text-red-600 underline font-bold mt-1 inline-block">View Full Size ↗</span>
                              </a>
                            </div>
                          )}

                          {/* Rejection Note */}
                          {task.rejectionReason && (
                            <div className="sm:col-span-2 bg-red-50 border border-red-300 p-3 text-xs text-red-700">
                              <span className="font-bold uppercase tracking-wider block mb-1">⚠️ Last Rejection Feedback:</span>
                              {task.rejectionReason}
                            </div>
                          )}
                        </div>

                        {/* Chat */}
                        <TaskChatPanel taskId={task.id} taskTitle={task.title} assignedTo={task.assignedTo} />

                        {/* Task actions */}
                        <div className="mt-4 pt-4 border-t border-zinc-200 flex flex-wrap items-center justify-between gap-3">
                          <div className="flex flex-wrap items-center gap-2">
                            {task.status === "pending-approval" && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => void approveTask(task)}
                                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-xs font-bold uppercase px-4 py-2 border-2 border-zinc-900 shadow-[2px_2px_0px_0px_#09090b] transition-all active:translate-x-0.5 active:translate-y-0.5 cursor-pointer flex items-center gap-1.5"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                                  [ APPROVE TASK ]
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void rejectTask(task)}
                                  className="bg-red-600 hover:bg-red-700 text-white font-mono text-xs font-bold uppercase px-4 py-2 border-2 border-zinc-900 shadow-[2px_2px_0px_0px_#09090b] transition-all active:translate-x-0.5 active:translate-y-0.5 cursor-pointer flex items-center gap-1.5"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                                  [ REJECT TASK ]
                                </button>
                              </>
                            )}
                            {task.status !== "completed" && task.status !== "pending-approval" && (
                              <button
                                type="button"
                                onClick={() => void approveTask(task)}
                                className="border border-emerald-600 bg-emerald-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-emerald-700 hover:bg-emerald-600 hover:text-white transition-colors cursor-pointer"
                              >
                                [ MARK COMPLETED ]
                              </button>
                            )}
                          </div>

                          <button
                            type="button"
                            onClick={() => void deleteTask(task.id)}
                            className="border border-red-300 bg-red-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-red-700 hover:bg-red-600 hover:text-white transition-colors cursor-pointer"
                          >
                            [ DELETE TASK ]
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Modals */}
        {showEdit && (
          <ProjectFormModal title="// EDIT PROJECT" form={editForm} setForm={setEditForm}
            onClose={() => setShowEdit(false)} onSubmit={(e) => void submitEdit(e)} submitLabel="[ SAVE ]" />
        )}
        {showAddTask && (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 backdrop-blur-xs"
            onClick={() => setShowAddTask(false)}>
            <div className="border-2 border-zinc-900 bg-white w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 shadow-[6px_6px_0px_0px_#09090b]"
              onClick={(e) => e.stopPropagation()}>
              <div className="mb-6 pb-4 border-b border-zinc-200 flex items-center justify-between">
                <h3 className="text-xl font-oswald text-red-600 uppercase tracking-wider font-bold">{"// ADD TASK"}</h3>
                <button type="button" onClick={() => setShowAddTask(false)} className="text-xs font-bold text-zinc-500 hover:text-zinc-950 cursor-pointer">[ X ]</button>
              </div>
              <form onSubmit={(e) => void submitAddTask(e)} className="space-y-4">
                <Field label="Title *">
                  <input required value={taskForm.title} onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })} className="brutal-input" />
                </Field>
                <Field label="Description *">
                  <textarea required rows={3} value={taskForm.description} onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })} className="brutal-input" />
                </Field>
                <Field label="Department *">
                  <select value={taskForm.department} onChange={(e) => setTaskForm({ ...taskForm, department: e.target.value })} className="brutal-input">
                    {TASK_DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </Field>
                <Field label="Assign workers *">
                  <div className="max-h-40 overflow-y-auto border border-zinc-300 bg-zinc-50 p-2 space-y-1">
                    {approvedWorkers.length === 0 ? (
                      <p className="text-xs text-zinc-500">No approved workers</p>
                    ) : approvedWorkers.map((w) => (
                      <label key={w.id} className="flex items-center gap-2 text-xs uppercase tracking-wider text-zinc-900 hover:text-red-600 cursor-pointer">
                        <input type="checkbox" checked={taskForm.workerIds.includes(w.id)}
                          onChange={() => {
                            const set = new Set(taskForm.workerIds);
                            if (set.has(w.id)) set.delete(w.id); else set.add(w.id);
                            setTaskForm({ ...taskForm, workerIds: [...set] });
                          }}
                          className="accent-red-600"
                        />
                        {w.firstName} {w.lastName}
                      </label>
                    ))}
                  </div>
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Priority">
                    <select value={taskForm.priority} onChange={(e) => setTaskForm({ ...taskForm, priority: e.target.value })} className="brutal-input">
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="urgent">Urgent</option>
                    </select>
                  </Field>
                  <Field label="Due date">
                    <input type="date" value={taskForm.dueDate} onChange={(e) => setTaskForm({ ...taskForm, dueDate: e.target.value })} className="brutal-input" />
                  </Field>
                </div>
                <div className="flex gap-3 pt-4 border-t border-zinc-200">
                  <button type="button" onClick={() => setShowAddTask(false)} className="brutal-btn-outline flex-1">[ CANCEL ]</button>
                  <button type="submit" className="brutal-btn flex-1">[ CREATE ]</button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  /* ── Projects List View ── */
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-[9px] font-bold uppercase tracking-[0.3em] text-zinc-500 mb-1">{"// MODULE"}</p>
          <h2 className="text-3xl font-oswald font-bold text-zinc-950 uppercase tracking-wider">Project Management</h2>
        </div>
        <button type="button" onClick={() => setShowCreate(true)} className="brutal-btn px-5 py-2.5">
          [ + NEW PROJECT ]
        </button>
      </div>

      {/* KPI & Quick Metrics Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white border-2 border-zinc-900 p-3.5 shadow-[3px_3px_0px_0px_#09090b]">
          <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">Total Projects</p>
          <p className="text-2xl font-oswald font-bold text-zinc-950 mt-0.5">{projects.length}</p>
          <p className="text-[10px] text-zinc-500 font-mono mt-1">Client accounts</p>
        </div>

        <button
          type="button"
          onClick={() => setProjectFilter(projectFilter === "active" ? "all" : "active")}
          className={`text-left p-3.5 border-2 border-zinc-900 shadow-[3px_3px_0px_0px_#09090b] transition-all cursor-pointer ${
            projectFilter === "active" ? "bg-zinc-100 ring-2 ring-zinc-950" : "bg-white hover:bg-zinc-50"
          }`}
        >
          <p className="text-[9px] font-bold uppercase tracking-widest text-blue-700">Active Projects</p>
          <p className="text-2xl font-oswald font-bold text-blue-800 mt-0.5">{activeProjectsCount}</p>
          <p className="text-[10px] text-zinc-500 font-mono mt-1">Ongoing operations</p>
        </button>

        <button
          type="button"
          onClick={() => setProjectFilter(projectFilter === "completed" ? "all" : "completed")}
          className={`text-left p-3.5 border-2 border-zinc-900 shadow-[3px_3px_0px_0px_#09090b] transition-all cursor-pointer ${
            projectFilter === "completed" ? "bg-zinc-100 ring-2 ring-zinc-950" : "bg-white hover:bg-zinc-50"
          }`}
        >
          <p className="text-[9px] font-bold uppercase tracking-widest text-emerald-700">Completed Projects</p>
          <p className="text-2xl font-oswald font-bold text-emerald-800 mt-0.5">{completedProjectsCount}</p>
          <p className="text-[10px] text-zinc-500 font-mono mt-1">Delivered or closed</p>
        </button>

        <button
          type="button"
          onClick={() => setProjectFilter(projectFilter === "needs-approval" ? "all" : "needs-approval")}
          className={`text-left p-3.5 border-2 transition-all cursor-pointer ${
            projectsNeedingApproval.size > 0
              ? projectFilter === "needs-approval"
                ? "bg-amber-100 border-zinc-900 shadow-[3px_3px_0px_0px_#d97706]"
                : "bg-amber-50/80 border-amber-500 hover:border-zinc-900 shadow-[3px_3px_0px_0px_#d97706]"
              : "bg-white border-zinc-900 shadow-[3px_3px_0px_0px_#09090b]"
          }`}
        >
          <div className="flex items-center justify-between">
            <p className="text-[9px] font-bold uppercase tracking-widest text-amber-900">Task Approvals</p>
            {totalPendingTasksCount > 0 && (
              <span className="w-2 h-2 rounded-full bg-amber-600 animate-ping" />
            )}
          </div>
          <p className={`text-2xl font-oswald font-bold mt-0.5 ${totalPendingTasksCount > 0 ? "text-amber-800" : "text-zinc-400"}`}>
            {totalPendingTasksCount}
          </p>
          <p className="text-[10px] text-amber-900 font-mono mt-1 font-semibold">
            {projectsNeedingApproval.size} project{projectsNeedingApproval.size === 1 ? "" : "s"} waiting {projectFilter === "needs-approval" ? "(ACTIVE)" : "→"}
          </p>
        </button>
      </div>

      {/* Search and Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="SEARCH — name, client, type..."
          className="brutal-input flex-1 min-w-[260px] max-w-md"
        />

        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { id: "all", label: `ALL PROJECTS (${projects.length})`, highlight: false },
              { id: "active", label: `ACTIVE PROJECTS (${activeProjectsCount})`, highlight: false },
              { id: "completed", label: `COMPLETED (${completedProjectsCount})`, highlight: false },
              { id: "needs-approval", label: `⚠️ NEEDS APPROVAL (${projectsNeedingApproval.size})`, highlight: projectsNeedingApproval.size > 0 },
              ...(projectsWithUnread.size > 0
                ? [{ id: "unread", label: `💬 UNREAD (${projectsWithUnread.size})`, highlight: true }]
                : []),
            ] as const
          ).map((tab) => {
            const isActive = projectFilter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setProjectFilter(tab.id as typeof projectFilter)}
                className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider cursor-pointer border-2 transition-all ${
                  isActive
                    ? "bg-zinc-950 text-white border-zinc-950 shadow-[2px_2px_0px_0px_#dc2626]"
                    : tab.highlight
                    ? "bg-amber-50 text-amber-900 border-amber-400 hover:bg-amber-100"
                    : "bg-white text-zinc-700 border-zinc-300 hover:border-zinc-900"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Count */}
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-zinc-200" />
        <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
          SHOWING {filteredProjects.length} OF {projects.length} PROJECTS
          {projectFilter !== "all" && ` [FILTER: ${projectFilter.toUpperCase()}]`}
        </span>
        <div className="h-px flex-1 bg-zinc-200" />
      </div>

      {/* Projects Grid */}
      {filteredProjects.length === 0 ? (
        <div className="border border-dashed border-zinc-300 bg-white p-12 text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-zinc-900">
            {projectFilter === "needs-approval"
              ? "NO PROJECTS WITH PENDING APPROVALS"
              : "NO PROJECTS FOUND"}
          </p>
          {projectFilter !== "all" && (
            <button
              type="button"
              onClick={() => setProjectFilter("all")}
              className="mt-3 px-3 py-1.5 bg-zinc-900 text-white text-[10px] font-bold uppercase tracking-wider cursor-pointer"
            >
              Clear Filter (Show All)
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredProjects.map((p) => {
            const pTasks = tasks.filter((t) => t.projectId === p.id);
            const pTaskCount = pTasks.length;
            const pendingApprovalCount = pTasks.filter((t) => t.status === "pending-approval").length;
            const inProgressCount = pTasks.filter((t) => ["assigned", "in-progress"].includes(t.status)).length;
            const completedCount = pTasks.filter((t) => t.status === "completed").length;
            const progressPercent = pTaskCount > 0 ? Math.round((completedCount / pTaskCount) * 100) : 0;
            const unreadCount = unreadByProject.get(p.id) ?? 0;

            // Assigned workers
            const assignedWorkerIds = Array.from(
              new Set(
                pTasks.flatMap((t) =>
                  Array.isArray(t.assignedTo) ? t.assignedTo : t.assignedTo ? [t.assignedTo] : []
                )
              )
            );
            const assignedWorkers = assignedWorkerIds
              .map((id) => workers.find((w) => w.id === id))
              .filter(Boolean) as Worker[];

            // Nearest upcoming due date
            const now = new Date();
            now.setHours(0, 0, 0, 0);
            const upcomingTaskDates = pTasks
              .map((t) => (t.dueDate?.toDate ? t.dueDate.toDate() : null))
              .filter((d): d is Date => d !== null && !isNaN(d.getTime()))
              .sort((a, b) => a.getTime() - b.getTime());
            const nextDueDate = upcomingTaskDates[0];
            const isOverdue =
              nextDueDate &&
              nextDueDate < now &&
              pTasks.some(
                (t) =>
                  t.dueDate?.toDate &&
                  t.dueDate.toDate().getTime() === nextDueDate.getTime() &&
                  t.status !== "completed"
              );

            const effectiveStatus = getProjectEffectiveStatus(p);
            const isCompleted = effectiveStatus === "completed";
            const hasPending = pendingApprovalCount > 0;

            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setDetailId(p.id)}
                className={`relative text-left border-2 p-5 transition-all group cursor-pointer flex flex-col justify-between ${
                  hasPending
                    ? "border-amber-500 bg-white hover:border-zinc-950 shadow-[4px_4px_0px_0px_#d97706]"
                    : unreadCount > 0
                    ? "border-red-500 bg-white hover:border-zinc-950 shadow-[4px_4px_0px_0px_#dc2626]"
                    : isCompleted
                    ? "border-emerald-600 bg-white hover:border-zinc-950 shadow-[4px_4px_0px_0px_#059669]"
                    : "border-zinc-300 bg-white hover:border-zinc-950 hover:shadow-[4px_4px_0px_0px_#09090b]"
                }`}
              >
                {/* Corner unread badge */}
                {unreadCount > 0 && (
                  <span className="absolute -top-2.5 -right-2.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-red-600 text-[11px] font-bold text-white px-1.5 animate-pulse shadow-md border-2 border-white">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}

                <div>
                  {/* Top Status & Pending Approval Badges */}
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span
                        className={`brutal-badge text-[8px] font-bold ${
                          isCompleted
                            ? "text-emerald-800 border-emerald-300 bg-emerald-50"
                            : "text-zinc-700 border-zinc-300 bg-zinc-100"
                        }`}
                      >
                        {effectiveStatus.toUpperCase()}
                      </span>

                      {isCompleted && (
                        <span className="flex items-center gap-1 px-2 py-0.5 bg-emerald-600 text-white font-mono text-[9px] font-bold uppercase tracking-wider rounded border border-emerald-700 shadow-xs">
                          ✓ ALL TASKS COMPLETED
                        </span>
                      )}

                      {/* Prominent Pending Approval Badge */}
                      {hasPending && (
                        <span className="flex items-center gap-1 px-2 py-0.5 bg-amber-500 text-white font-mono text-[9px] font-bold uppercase tracking-wider rounded border border-amber-600 shadow-xs animate-pulse">
                          <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                          </svg>
                          {pendingApprovalCount} PENDING APPROVAL
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {unreadCount > 0 && (
                        <span className="flex items-center gap-1 text-[9px] font-bold text-red-600">
                          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7z" />
                          </svg>
                          {unreadCount} NEW
                        </span>
                      )}
                      <span className="text-[10px] font-bold font-mono text-zinc-950 bg-zinc-100 px-2 py-0.5 border border-zinc-200">
                        TASKS [{pTaskCount}]
                      </span>
                    </div>
                  </div>

                  {/* Title & Client */}
                  <h3 className="text-xl font-oswald font-bold text-zinc-950 uppercase tracking-wide group-hover:text-red-600 transition-colors">
                    {p.name}
                  </h3>
                  {p.clientName && (
                    <p className="text-[10px] uppercase tracking-widest text-red-600 font-bold mt-0.5">{p.clientName}</p>
                  )}

                  {/* Description */}
                  <p className="text-xs text-zinc-600 mt-2 line-clamp-2 leading-relaxed font-mono">
                    {p.description || "No description provided."}
                  </p>

                  {/* Tasks Progress Bar & Status Pills */}
                  {pTaskCount > 0 && (
                    <div className="mt-3 pt-2.5 border-t border-zinc-100">
                      <div className="flex items-center justify-between text-[9px] font-bold uppercase tracking-widest text-zinc-500 mb-1 font-mono">
                        <span>Task Progress</span>
                        <span className="text-zinc-900 font-bold">
                          {completedCount}/{pTaskCount} Done ({progressPercent}%)
                        </span>
                      </div>
                      <div className="h-2 w-full bg-zinc-100 border border-zinc-200 overflow-hidden flex">
                        <div
                          style={{ width: `${progressPercent}%` }}
                          className="bg-emerald-600 h-full transition-all"
                          title={`${completedCount} completed`}
                        />
                        {pendingApprovalCount > 0 && (
                          <div
                            style={{
                              width: `${Math.round((pendingApprovalCount / pTaskCount) * 100)}%`,
                            }}
                            className="bg-amber-500 h-full transition-all animate-pulse"
                            title={`${pendingApprovalCount} pending approval`}
                          />
                        )}
                      </div>

                      {/* Status Pills */}
                      <div className="flex flex-wrap items-center gap-1.5 mt-2">
                        {pendingApprovalCount > 0 && (
                          <span className="px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider bg-amber-100 border border-amber-300 text-amber-900 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-600 animate-ping" />
                            {pendingApprovalCount} Review
                          </span>
                        )}
                        {inProgressCount > 0 && (
                          <span className="px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider bg-blue-50 border border-blue-200 text-blue-700">
                            {inProgressCount} Active
                          </span>
                        )}
                        {completedCount > 0 && (
                          <span className="px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider bg-emerald-50 border border-emerald-200 text-emerald-700">
                            ✓ {completedCount} Done
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Team Members */}
                  {assignedWorkers.length > 0 && (
                    <div className="flex items-center gap-2 mt-3 pt-2.5 border-t border-zinc-100">
                      <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500 shrink-0">Team:</span>
                      <div className="flex items-center -space-x-1.5 overflow-hidden">
                        {assignedWorkers.slice(0, 4).map((w) => (
                          <span
                            key={w.id}
                            title={`${w.firstName} ${w.lastName}`}
                            className="inline-flex items-center justify-center w-5 h-5 rounded-full border border-white bg-zinc-900 text-[8px] font-bold text-white uppercase shadow-xs shrink-0"
                          >
                            {w.firstName?.[0] || ""}{w.lastName?.[0] || ""}
                          </span>
                        ))}
                        {assignedWorkers.length > 4 && (
                          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full border border-white bg-zinc-200 text-[8px] font-bold text-zinc-700 shrink-0">
                            +{assignedWorkers.length - 4}
                          </span>
                        )}
                      </div>
                      <span className="text-[9px] text-zinc-600 font-mono truncate">
                        {assignedWorkers.slice(0, 2).map((w) => w.firstName).join(", ")}
                        {assignedWorkers.length > 2 ? ` +${assignedWorkers.length - 2}` : ""}
                      </span>
                    </div>
                  )}

                  {/* Project Types */}
                  <div className="flex flex-wrap gap-1 mt-3">
                    {(p.projectTypes || []).map((t) => (
                      <span key={t} className="brutal-badge text-zinc-700 border-zinc-300 bg-zinc-50 text-[8px]">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Footer Info Row */}
                <div className="mt-4 pt-3 border-t border-zinc-200 flex flex-wrap justify-between items-center gap-2">
                  <div className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-widest text-zinc-500 font-mono">
                    <span>{p.startDate ? `START: ${p.startDate}` : "NO START DATE"}</span>
                    {nextDueDate && (
                      <>
                        <span className="text-zinc-300">|</span>
                        <span className={isOverdue ? "text-red-600 font-bold" : "text-zinc-600"}>
                          {isOverdue ? "⚠️ DUE: " : "DUE: "}
                          {nextDueDate.toLocaleDateString()}
                        </span>
                      </>
                    )}
                  </div>
                  <span className="text-[10px] font-bold text-red-600 group-hover:translate-x-1 transition-transform">
                    VIEW →
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <ProjectFormModal title="// CREATE PROJECT" form={createForm} setForm={setCreateForm}
          onClose={() => { setShowCreate(false); setCreateForm(defaultCreate); }}
          onSubmit={(e) => void submitCreate(e)} submitLabel="[ CREATE ]" />
      )}
    </div>
  );
}

/* ─── Helper Components ─── */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] font-bold uppercase tracking-widest text-[var(--mft-muted)] mb-1">{label}</label>
      {children}
    </div>
  );
}

function ProjectFormModal({ title, form, setForm, onClose, onSubmit, submitLabel }: {
  title: string;
  form: ProjectFormState;
  setForm: React.Dispatch<React.SetStateAction<ProjectFormState>>;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  submitLabel: string;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 backdrop-blur-xs" onClick={onClose}>
      <div className="border-2 border-zinc-900 bg-white w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 shadow-[6px_6px_0px_0px_#09090b]" onClick={(e) => e.stopPropagation()}>
        <div className="mb-6 pb-4 border-b border-zinc-200 flex items-center justify-between">
          <h3 className="text-xl font-oswald text-red-600 uppercase tracking-wider font-bold">{title}</h3>
          <button type="button" onClick={onClose} className="text-xs font-bold text-zinc-500 hover:text-zinc-950 cursor-pointer">[ X ]</button>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Project name *">
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="brutal-input" />
          </Field>
          <Field label="Client name">
            <input value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} className="brutal-input" />
          </Field>
          <Field label="Description *">
            <textarea required rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="brutal-input" />
          </Field>
          <Field label="Project types *">
            <div className="grid grid-cols-2 gap-2 border border-zinc-300 bg-zinc-50 p-3">
              {PROJECT_TYPES.map((pt) => (
                <label key={pt.value} className="flex items-center gap-2 text-xs uppercase tracking-wider text-zinc-900 hover:text-red-600 cursor-pointer">
                  <input type="checkbox" className="accent-red-600"
                    checked={form.projectTypes.includes(pt.value)}
                    onChange={() => toggleTypes(pt.value, form.projectTypes, (v) => setForm({ ...form, projectTypes: v }))}
                  />
                  {pt.label}
                </label>
              ))}
            </div>
          </Field>
          <Field label="Status">
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="brutal-input">
              {PROJECT_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start date">
              <input type="date" value={form.startDate ?? ""} onChange={(e) => setForm({ ...form, startDate: e.target.value })} className="brutal-input" />
            </Field>
            <Field label="End date">
              <input type="date" value={form.endDate ?? ""} onChange={(e) => setForm({ ...form, endDate: e.target.value })} className="brutal-input" />
            </Field>
          </div>
          <div className="flex gap-3 pt-4 border-t border-zinc-200">
            <button type="button" onClick={onClose} className="brutal-btn-outline flex-1">[ CANCEL ]</button>
            <button type="submit" className="brutal-btn flex-1">{submitLabel}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function toggleTypes(value: string, current: string[], set: (v: string[]) => void) {
  if (current.includes(value)) set(current.filter((x) => x !== value));
  else set([...current, value]);
}
