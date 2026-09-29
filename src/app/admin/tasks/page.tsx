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
  priority: string;
  status: string;
  dueDate?: { toDate: () => Date } | null;
  createdAt?: { toDate: () => Date } | null;
  rejectionReason?: string;
  department?: string;
  photo?: string | null;
  startedAt?: { toDate: () => Date } | null;
  submittedForApprovalAt?: { toDate: () => Date } | null;
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
  return role.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function assignedWorkerIds(assignedTo: string | string[] | undefined): string[] {
  if (!assignedTo) return [];
  return Array.isArray(assignedTo) ? assignedTo : [assignedTo];
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
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [editId, setEditId] = useState("");
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

  const formatAssignees = (assignedTo: string | string[] | undefined) => {
    const ids = assignedWorkerIds(assignedTo);
    if (ids.length === 0) return "Unassigned";
    return ids.map((id) => getWorkerName(id)).join(", ");
  };

  const approvedWorkers = workers.filter((w) => w.status === "approved");

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
    setModalMode("create");
  };

  const openEdit = (task: Task) => {
    let dueDateStr = "";
    if (task.dueDate?.toDate) {
      dueDateStr = task.dueDate.toDate().toISOString().split("T")[0];
    }
    setForm({
      title: task.title,
      description: task.description,
      projectId: task.projectId || "",
      projectName: task.projectName || (task.projectId ? projectById.get(task.projectId) || "" : ""),
      department: task.department || "general",
      assignedWorkerIds: assignedWorkerIds(task.assignedTo),
      priority: task.priority,
      status: task.status,
      dueDate: dueDateStr,
      photo: task.photo || "",
      notificationMessage: "",
    });
    setEditId(task.id);
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

  const firestoreAssignedTo = (ids: string[]) => {
    if (ids.length === 0) return "";
    if (ids.length === 1) return ids[0];
    return ids;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const projName = form.projectId ? projectById.get(form.projectId) || form.projectName : form.projectName;
    const assignedTo = firestoreAssignedTo(form.assignedWorkerIds);

    if (modalMode === "create") {
      const payload: Record<string, unknown> = {
        title: form.title,
        description: form.description,
        projectName: projName || "",
        department: form.department || "general",
        photo: form.photo || null,
        assignedTo,
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
          message: form.notificationMessage || `You have been assigned to task: ${form.title}`,
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
          body: form.notificationMessage || `You have been assigned: ${form.title}`,
          taskId: taskRef.id,
          taskTitle: form.title,
        }).catch(() => {});
      }
    } else if (modalMode === "edit") {
      const updateData: Record<string, unknown> = {
        title: form.title,
        description: form.description,
        projectName: projName || "",
        department: form.department || "general",
        photo: form.photo || null,
        assignedTo,
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
          message: form.notificationMessage || `Task has been updated: ${form.title}`,
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
          body: form.notificationMessage || `Task has been updated: ${form.title}`,
          taskId: editId,
          taskTitle: form.title,
        }).catch(() => {});
      }
    }
    setModalMode(null);
  };

  const deleteTask = async (id: string) => {
    if (confirm("Are you sure you want to delete this task?")) {
      await deleteDoc(doc(db, "tasks", id));
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex items-center gap-3 text-red-500"><svg className="animate-spin h-5 w-5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg> Loading tasks...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <h2 className="text-3xl font-oswald font-bold text-zinc-950 uppercase tracking-wider">Task Management</h2>
          {chatNotifications.length > 0 && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-red-100 border border-red-300 rounded-full text-red-700 text-xs font-bold animate-pulse">
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7z" /></svg>
              {chatNotifications.length} new {chatNotifications.length === 1 ? "message" : "messages"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <p className="text-xs text-zinc-500 hidden sm:block">Live updates</p>
          <button onClick={openCreate} className="brutal-btn px-4 py-2">
            + Create Task
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {[
          { label: "Total", value: tasks.length, color: "text-zinc-950" },
          { label: "Assigned", value: tasks.filter((t) => t.status === "assigned").length, color: "text-blue-700" },
          { label: "In Progress", value: tasks.filter((t) => t.status === "in-progress").length, color: "text-amber-700" },
          { label: "Completed", value: tasks.filter((t) => t.status === "completed").length, color: "text-emerald-700" },
          { label: "Pending approval", value: tasks.filter((t) => t.status === "pending-approval").length, color: "text-amber-700" },
        ].map((s) => (
          <div key={s.label} className="bg-white border border-zinc-200 shadow-[3px_3px_0px_0px_#09090b] rounded-lg p-5 text-center">
            <div className={`text-2xl font-bold font-oswald ${s.color}`}>{s.value}</div>
            <div className="text-xs text-zinc-500 uppercase tracking-wider mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Tasks List */}
      {tasks.length === 0 ? (
        <div className="text-center py-20 text-zinc-500 bg-white border border-zinc-200 rounded-lg">
          <p className="text-lg font-bold text-zinc-900">No tasks found</p>
          <p className="text-sm mt-1">Create your first task to get started</p>
        </div>
      ) : (
        <div className="space-y-4">
          {tasks.map((task) => (
            <div key={task.id} className="bg-white border border-zinc-200 shadow-[3px_3px_0px_0px_#09090b] rounded-lg p-6 hover:border-zinc-900 transition-colors">
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
                      📷 Photo Attached ↗
                    </a>
                  )}
                </div>
                <span className={`inline-block self-start px-3 py-1 rounded-full text-xs font-semibold uppercase border ${STATUS_COLORS[task.status] || STATUS_COLORS.assigned}`}>
                  {task.status.replace(/-/g, " ")}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4 text-sm text-zinc-700">
                <p><span className="text-zinc-500 font-medium">Description:</span> {task.description}</p>
                <p>
                  <span className="text-zinc-500 font-medium">Project:</span>{" "}
                  <span className="font-semibold text-zinc-900">{task.projectName || (task.projectId ? projectById.get(task.projectId) || task.projectId : "N/A")}</span>
                </p>
                {task.projectId && <p className="text-xs text-zinc-500">projectId: {task.projectId}</p>}
                <p><span className="text-zinc-500 font-medium">Priority:</span> <span className={PRIORITY_COLORS[task.priority] || ""}>{task.priority}</span></p>
                <p><span className="text-zinc-500 font-medium">Assigned To:</span> <span className="font-semibold text-zinc-900">{formatAssignees(task.assignedTo)}</span></p>
                <p><span className="text-zinc-500 font-medium">Due Date:</span> <span className="font-semibold text-zinc-900">{task.dueDate?.toDate ? task.dueDate.toDate().toLocaleDateString() : "No due date"}</span></p>
                <p><span className="text-zinc-500 font-medium">Created:</span> <span className="text-zinc-600">{task.createdAt?.toDate ? task.createdAt.toDate().toLocaleDateString() : "N/A"}</span></p>
              </div>

              <div className="flex flex-wrap gap-2 pt-2 border-t border-zinc-100">
                <button
                  type="button"
                  onClick={() => setDetailTask(task)}
                  className="relative px-4 py-2 border border-zinc-300 bg-zinc-50 hover:bg-zinc-100 text-zinc-800 text-xs font-bold uppercase tracking-wider rounded transition-colors cursor-pointer"
                >
                  View Details
                  {chatNotifications.some((n) => n.taskId === task.id) && (
                    <span className="absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 text-[10px] font-bold text-white px-1">
                      {chatNotifications.filter((n) => n.taskId === task.id).length}
                    </span>
                  )}
                </button>
                <button onClick={() => openEdit(task)} className="px-4 py-2 border border-zinc-900 bg-white hover:bg-zinc-900 hover:text-white text-zinc-900 text-xs font-bold uppercase tracking-wider rounded transition-colors cursor-pointer">
                  Edit Task
                </button>
                <button onClick={() => deleteTask(task.id)} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold uppercase tracking-wider rounded transition-colors cursor-pointer">
                  Delete
                </button>
                {task.status === "pending-approval" && (
                  <>
                    <button onClick={() => approveTask(task.id)} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold uppercase tracking-wider rounded transition-colors cursor-pointer">
                      Approve
                    </button>
                    <button onClick={() => rejectTask(task.id)} className="px-4 py-2 border border-red-300 bg-red-50 text-red-700 hover:bg-red-600 hover:text-white text-xs font-bold uppercase tracking-wider rounded transition-colors cursor-pointer">
                      Reject
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Task details (parity with original admin) */}
      {/* Task details (parity with original admin) */}
      {detailTask && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 backdrop-blur-xs" onClick={() => setDetailTask(null)}>
          <div
            className="bg-white border-2 border-zinc-900 rounded-xl w-full max-w-md p-8 space-y-3 text-sm text-zinc-800 shadow-[6px_6px_0px_0px_#09090b]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4 pb-2 border-b border-zinc-200">
              <h3 className="text-xl font-bold font-oswald text-zinc-950 uppercase tracking-wider">Task Details</h3>
              <button type="button" onClick={() => setDetailTask(null)} className="text-zinc-500 hover:text-zinc-950 text-2xl leading-none cursor-pointer">
                &times;
              </button>
            </div>
            <p><span className="text-zinc-500 font-medium">Title:</span> <span className="font-bold text-zinc-900">{detailTask.title}</span></p>
            <p><span className="text-zinc-500 font-medium">Description:</span> <span className="text-zinc-800">{detailTask.description}</span></p>
            <p>
              <span className="text-zinc-500 font-medium">Project:</span>{" "}
              <span className="font-semibold text-zinc-900">
                {detailTask.projectName ||
                  (detailTask.projectId ? projectById.get(detailTask.projectId) || detailTask.projectId : "N/A")}
              </span>
            </p>
            {detailTask.projectId && <p className="text-xs text-zinc-500">projectId: {detailTask.projectId}</p>}
            <p><span className="text-zinc-500 font-medium">Department:</span> <span className="font-semibold text-zinc-900 uppercase">{detailTask.department || "general"}</span></p>
            <p><span className="text-zinc-500 font-medium">Priority:</span> <span className="font-semibold text-zinc-900">{detailTask.priority}</span></p>
            <p><span className="text-zinc-500 font-medium">Status:</span> <span className="font-semibold text-zinc-900">{detailTask.status.replace(/-/g, " ")}</span></p>
            <p><span className="text-zinc-500 font-medium">Assigned To:</span> <span className="font-semibold text-zinc-900">{formatAssignees(detailTask.assignedTo)}</span></p>
            <p><span className="text-zinc-500 font-medium">Due Date:</span> <span className="font-semibold text-zinc-900">{detailTask.dueDate?.toDate ? detailTask.dueDate.toDate().toLocaleDateString() : "No due date"}</span></p>
            <p><span className="text-zinc-500 font-medium">Created:</span> <span className="text-zinc-600">{detailTask.createdAt?.toDate ? detailTask.createdAt.toDate().toLocaleDateString() : "N/A"}</span></p>
            {detailTask.startedAt?.toDate && (
              <p><span className="text-zinc-500 font-medium">Started Work:</span> <span className="text-zinc-700">{detailTask.startedAt.toDate().toLocaleString()}</span></p>
            )}
            {detailTask.submittedForApprovalAt?.toDate && (
              <p><span className="text-zinc-500 font-medium">Submitted for Approval:</span> <span className="text-zinc-700">{detailTask.submittedForApprovalAt.toDate().toLocaleString()}</span></p>
            )}
            {detailTask.photo && (
              <div className="pt-2 pb-1">
                <span className="text-zinc-500 font-medium block mb-1">Attached Photo / Proof:</span>
                <a href={detailTask.photo} target="_blank" rel="noreferrer" className="block group">
                  <img src={detailTask.photo} alt="Task proof" className="max-h-48 rounded border border-zinc-300 object-cover group-hover:opacity-90" />
                  <span className="text-xs text-red-600 underline font-bold mt-1 inline-block">View full size ↗</span>
                </a>
              </div>
            )}
            {detailTask.rejectionReason && (
              <p><span className="text-red-600 font-medium">Last rejection reason:</span> <span className="text-red-700">{detailTask.rejectionReason}</span></p>
            )}

            {/* Task Chat */}
            <div className="mt-4 pt-4 border-t border-zinc-200">
              <h4 className="text-sm font-bold text-red-600 mb-3">💬 Task Chat</h4>
              <div className="flex flex-col gap-2 max-h-48 overflow-y-auto mb-3 pr-1 bg-zinc-50 p-2 rounded border border-zinc-200">
                {chatMessages.length === 0 && (
                  <p className="text-xs text-zinc-500 italic">No messages yet.</p>
                )}
                {chatMessages.map((m) => {
                  const isAdmin = m.senderRole === "admin";
                  const ts = m.createdAt?.toDate().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
                  return (
                    <div key={m.id} className={`flex flex-col gap-0.5 ${isAdmin ? "items-end" : "items-start"}`}>
                      <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm leading-snug font-mono ${
                        isAdmin
                          ? "bg-red-100 border border-red-200 text-red-950 font-medium"
                          : "bg-white border border-zinc-200 text-zinc-900"
                      }`}>
                        {m.text}
                      </div>
                      <p className="text-[9px] text-zinc-500">
                        {isAdmin ? "YOU" : m.senderName} · {ts ?? "—"}
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
                  placeholder="Message to worker..."
                  disabled={chatBusy}
                  className="flex-1 px-3 py-2 bg-white border border-zinc-300 rounded-lg text-sm text-zinc-900 focus:outline-none focus:border-red-600 placeholder:text-zinc-400"
                />
                <button
                  type="submit"
                  disabled={chatBusy || !chatInput.trim()}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold uppercase rounded-lg disabled:opacity-40 cursor-pointer"
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
                    setDetailTask(null);
                  }}
                  className="flex-1 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold uppercase tracking-wider cursor-pointer"
                >
                  ✓ Approve Task
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await rejectTask(detailTask.id);
                    setDetailTask(null);
                  }}
                  className="flex-1 py-2.5 rounded-lg border border-red-300 bg-red-50 text-red-700 hover:bg-red-600 hover:text-white text-xs font-bold uppercase tracking-wider cursor-pointer"
                >
                  ✕ Reject Task
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => setDetailTask(null)}
              className="mt-4 w-full py-2.5 rounded-lg bg-zinc-900 hover:bg-black text-white text-sm font-bold uppercase tracking-wider cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Create / Edit Modal */}
      {modalMode && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 backdrop-blur-xs" onClick={() => setModalMode(null)}>
          <div className="bg-white border-2 border-zinc-900 rounded-xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-8 shadow-[6px_6px_0px_0px_#09090b]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6 pb-2 border-b border-zinc-200">
              <h3 className="text-xl font-bold font-oswald text-red-600 uppercase tracking-wider">{modalMode === "create" ? "Create New Task" : "Edit Task"}</h3>
              <button onClick={() => setModalMode(null)} className="text-zinc-500 hover:text-zinc-950 text-2xl leading-none cursor-pointer">&times;</button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-semibold text-zinc-700 mb-2">Task Title *</label>
                <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full px-4 py-3 bg-white border border-zinc-300 rounded-lg text-zinc-900 focus:outline-none focus:border-red-600" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-zinc-700 mb-2">Description *</label>
                <textarea required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} className="w-full px-4 py-3 bg-white border border-zinc-300 rounded-lg text-zinc-900 focus:outline-none focus:border-red-600 resize-y" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-zinc-700 mb-2">Link to project (optional)</label>
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
                  className="w-full px-4 py-3 bg-white border border-zinc-300 rounded-lg text-zinc-900 focus:outline-none focus:border-red-600"
                >
                  <option value="">No project</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-zinc-700 mb-2">Department</label>
                  <select
                    value={form.department}
                    onChange={(e) => setForm({ ...form, department: e.target.value })}
                    className="w-full px-4 py-3 bg-white border border-zinc-300 rounded-lg text-zinc-900 focus:outline-none focus:border-red-600 uppercase"
                  >
                    {DEPARTMENTS.map((d) => (
                      <option key={d.value} value={d.value}>{d.label.toUpperCase()}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-zinc-700 mb-2">Photo / Proof URL (optional)</label>
                  <input
                    value={form.photo}
                    onChange={(e) => setForm({ ...form, photo: e.target.value })}
                    placeholder="https://..."
                    className="w-full px-4 py-3 bg-white border border-zinc-300 rounded-lg text-zinc-900 focus:outline-none focus:border-red-600 text-xs"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-zinc-700 mb-2">Project name (free text, optional)</label>
                <input
                  value={form.projectName}
                  onChange={(e) => setForm({ ...form, projectName: e.target.value })}
                  placeholder="Legacy label if not using dropdown"
                  className="w-full px-4 py-3 bg-white border border-zinc-300 rounded-lg text-zinc-900 focus:outline-none focus:border-red-600"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-zinc-700 mb-2">Assigned workers</label>
                <p className="text-xs text-zinc-500 mb-2">Select one or more approved workers (stored as array when multiple).</p>
                <div className="max-h-40 overflow-y-auto space-y-2 border border-zinc-300 rounded-lg p-3 bg-zinc-50">
                  {approvedWorkers.length === 0 ? (
                    <p className="text-zinc-500 text-sm">No approved workers.</p>
                  ) : (
                    approvedWorkers.map((w) => (
                      <label key={w.id} className="flex items-center gap-2 text-sm text-zinc-900 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={form.assignedWorkerIds.includes(w.id)}
                          onChange={() => toggleAssignee(w.id)}
                          className="rounded border-zinc-300 accent-red-600"
                        />
                        <span>
                          {w.firstName} {w.lastName} ({formatRole(w.role)})
                        </span>
                      </label>
                    ))
                  )}
                </div>
              </div>
              {modalMode === "edit" && (
                <div>
                  <label className="block text-sm font-semibold text-zinc-700 mb-2">Status</label>
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="w-full px-4 py-3 bg-white border border-zinc-300 rounded-lg text-zinc-900 focus:outline-none focus:border-red-600">
                    <option value="assigned">Assigned</option>
                    <option value="in-progress">In Progress</option>
                    <option value="pending-approval">Pending Approval</option>
                    <option value="completed">Completed</option>
                  </select>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-zinc-700 mb-2">Priority</label>
                  <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="w-full px-4 py-3 bg-white border border-zinc-300 rounded-lg text-zinc-900 focus:outline-none focus:border-red-600">
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-zinc-700 mb-2">Due Date</label>
                  <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className="w-full px-4 py-3 bg-white border border-zinc-300 rounded-lg text-zinc-900 focus:outline-none focus:border-red-600" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-zinc-700 mb-2">Custom Notification Message (optional)</label>
                <textarea value={form.notificationMessage} onChange={(e) => setForm({ ...form, notificationMessage: e.target.value })} rows={2} placeholder="Leave blank to use default message" className="w-full px-4 py-3 bg-white border border-zinc-300 rounded-lg text-zinc-900 focus:outline-none focus:border-red-600 resize-y" />
              </div>
              <div className="flex gap-3 justify-end pt-2 border-t border-zinc-200">
                <button type="button" onClick={() => setModalMode(null)} className="px-5 py-2.5 border border-zinc-300 text-zinc-700 hover:bg-zinc-100 rounded-lg text-sm font-bold uppercase tracking-wider transition-colors cursor-pointer">
                  Cancel
                </button>
                <button type="submit" className="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-bold uppercase tracking-wider transition-colors cursor-pointer">
                  {modalMode === "create" ? "Create Task" : "Update Task"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
