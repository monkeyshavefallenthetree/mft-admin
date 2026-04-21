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
  assigned: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  "in-progress": "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  "pending-approval": "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  completed: "bg-green-500/20 text-green-400 border-green-500/30",
};

const PRIORITY_COLORS: Record<string, string> = {
  low: "text-zinc-400",
  medium: "text-blue-400",
  high: "text-orange-400",
  urgent: "text-red-400",
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
    assignedWorkerIds: [] as string[],
    priority: "medium",
    status: "assigned",
    dueDate: "",
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
      assignedWorkerIds: [],
      priority: "medium",
      status: "assigned",
      dueDate: "",
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
      assignedWorkerIds: assignedWorkerIds(task.assignedTo),
      priority: task.priority,
      status: task.status,
      dueDate: dueDateStr,
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
    await updateDoc(doc(db, "tasks", id), { status: "completed", approvedAt: serverTimestamp(), approvedBy: "admin" });
  };

  const rejectTask = async (id: string) => {
    const reason = prompt("Reason for rejection (optional):") || "No reason provided";
    await updateDoc(doc(db, "tasks", id), { status: "in-progress", rejectedAt: serverTimestamp(), rejectedBy: "admin", rejectionReason: reason });
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
          <h2 className="text-2xl font-bold text-red-400">Task Management</h2>
          {chatNotifications.length > 0 && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-cyan-500/20 border border-cyan-500/40 rounded-full text-cyan-400 text-xs font-semibold animate-pulse">
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7z" /></svg>
              {chatNotifications.length} new {chatNotifications.length === 1 ? "message" : "messages"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <p className="text-xs text-zinc-500 hidden sm:block">Live updates</p>
          <button onClick={openCreate} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-lg transition-colors">
            + Create Task
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {[
          { label: "Total", value: tasks.length, color: "text-red-400" },
          { label: "Assigned", value: tasks.filter((t) => t.status === "assigned").length, color: "text-blue-400" },
          { label: "In Progress", value: tasks.filter((t) => t.status === "in-progress").length, color: "text-yellow-400" },
          { label: "Completed", value: tasks.filter((t) => t.status === "completed").length, color: "text-green-400" },
        { label: "Pending approval", value: tasks.filter((t) => t.status === "pending-approval").length, color: "text-amber-400" },
        ].map((s) => (
          <div key={s.label} className="bg-[#111] border border-red-600/20 rounded-xl p-5 text-center">
            <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-xs text-zinc-500 uppercase tracking-wider mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Tasks List */}
      {tasks.length === 0 ? (
        <div className="text-center py-20 text-zinc-600">
          <p className="text-lg font-medium">No tasks found</p>
          <p className="text-sm mt-1">Create your first task to get started</p>
        </div>
      ) : (
        <div className="space-y-4">
          {tasks.map((task) => (
            <div key={task.id} className="bg-[#111] border border-red-600/20 rounded-xl p-6 hover:border-red-600/40 transition-colors">
              <div className="flex flex-col sm:flex-row justify-between gap-3 mb-4">
                <h3 className="text-lg font-bold text-red-400">{task.title}</h3>
                <span className={`inline-block self-start px-3 py-1 rounded-full text-xs font-semibold uppercase border ${STATUS_COLORS[task.status] || STATUS_COLORS.assigned}`}>
                  {task.status.replace(/-/g, " ")}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4 text-sm text-zinc-400">
                <p><span className="text-zinc-500 font-medium">Description:</span> {task.description}</p>
                <p>
                  <span className="text-zinc-500 font-medium">Project:</span>{" "}
                  {task.projectName || (task.projectId ? projectById.get(task.projectId) || task.projectId : "N/A")}
                </p>
                {task.projectId && <p className="text-xs text-zinc-600">projectId: {task.projectId}</p>}
                <p><span className="text-zinc-500 font-medium">Priority:</span> <span className={PRIORITY_COLORS[task.priority] || ""}>{task.priority}</span></p>
                <p><span className="text-zinc-500 font-medium">Assigned To:</span> {formatAssignees(task.assignedTo)}</p>
                <p><span className="text-zinc-500 font-medium">Due Date:</span> {task.dueDate?.toDate ? task.dueDate.toDate().toLocaleDateString() : "No due date"}</p>
                <p><span className="text-zinc-500 font-medium">Created:</span> {task.createdAt?.toDate ? task.createdAt.toDate().toLocaleDateString() : "N/A"}</p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setDetailTask(task)}
                  className="relative px-4 py-2 border border-zinc-600 text-zinc-300 hover:bg-white/5 text-sm font-semibold rounded-lg transition-colors"
                >
                  View Details
                  {chatNotifications.some((n) => n.taskId === task.id) && (
                    <span className="absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-cyan-500 text-[10px] font-bold text-black px-1">
                      {chatNotifications.filter((n) => n.taskId === task.id).length}
                    </span>
                  )}
                </button>
                <button onClick={() => openEdit(task)} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors">
                  Edit Task
                </button>
                <button onClick={() => deleteTask(task.id)} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-lg transition-colors">
                  Delete
                </button>
                {task.status === "pending-approval" && (
                  <>
                    <button onClick={() => approveTask(task.id)} className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg transition-colors">
                      Approve
                    </button>
                    <button onClick={() => rejectTask(task.id)} className="px-4 py-2 border border-red-500/50 text-red-400 hover:bg-red-500 hover:text-white text-sm font-semibold rounded-lg transition-colors">
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
      {detailTask && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setDetailTask(null)}>
          <div
            className="bg-[#111] border border-red-600/30 rounded-2xl w-full max-w-md p-8 space-y-3 text-sm text-zinc-300"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-red-400">Task Details</h3>
              <button type="button" onClick={() => setDetailTask(null)} className="text-zinc-400 hover:text-red-400 text-2xl leading-none">
                &times;
              </button>
            </div>
            <p><span className="text-zinc-500 font-medium">Title:</span> {detailTask.title}</p>
            <p><span className="text-zinc-500 font-medium">Description:</span> {detailTask.description}</p>
            <p>
              <span className="text-zinc-500 font-medium">Project:</span>{" "}
              {detailTask.projectName ||
                (detailTask.projectId ? projectById.get(detailTask.projectId) || detailTask.projectId : "N/A")}
            </p>
            {detailTask.projectId && <p className="text-xs text-zinc-600">projectId: {detailTask.projectId}</p>}
            <p><span className="text-zinc-500 font-medium">Priority:</span> {detailTask.priority}</p>
            <p><span className="text-zinc-500 font-medium">Status:</span> {detailTask.status.replace(/-/g, " ")}</p>
            <p><span className="text-zinc-500 font-medium">Assigned To:</span> {formatAssignees(detailTask.assignedTo)}</p>
            <p><span className="text-zinc-500 font-medium">Due Date:</span> {detailTask.dueDate?.toDate ? detailTask.dueDate.toDate().toLocaleDateString() : "No due date"}</p>
            <p><span className="text-zinc-500 font-medium">Created:</span> {detailTask.createdAt?.toDate ? detailTask.createdAt.toDate().toLocaleDateString() : "N/A"}</p>
            {detailTask.rejectionReason && (
              <p><span className="text-zinc-500 font-medium">Last rejection reason:</span> {detailTask.rejectionReason}</p>
            )}

            {/* Task Chat */}
            <div className="mt-4 pt-4 border-t border-white/10">
              <h4 className="text-sm font-bold text-red-400 mb-3">💬 Task Chat</h4>
              <div className="flex flex-col gap-2 max-h-48 overflow-y-auto mb-3 pr-1">
                {chatMessages.length === 0 && (
                  <p className="text-xs text-zinc-600 italic">No messages yet.</p>
                )}
                {chatMessages.map((m) => {
                  const isAdmin = m.senderRole === "admin";
                  const ts = m.createdAt?.toDate().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
                  return (
                    <div key={m.id} className={`flex flex-col gap-0.5 ${isAdmin ? "items-end" : "items-start"}`}>
                      <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm leading-snug ${
                        isAdmin
                          ? "bg-red-600/20 border border-red-500/30 text-white"
                          : "bg-white/5 border border-white/10 text-zinc-200"
                      }`}>
                        {m.text}
                      </div>
                      <p className="text-[9px] text-zinc-600">
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
                  className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-red-500 placeholder:text-zinc-600"
                />
                <button
                  type="submit"
                  disabled={chatBusy || !chatInput.trim()}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-lg disabled:opacity-40"
                >
                  Send
                </button>
              </form>
            </div>

            <button
              type="button"
              onClick={() => setDetailTask(null)}
              className="mt-4 w-full py-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-semibold"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Create / Edit Modal */}
      {modalMode && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setModalMode(null)}>
          <div className="bg-[#111] border border-red-600/30 rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-8" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-red-400">{modalMode === "create" ? "Create New Task" : "Edit Task"}</h3>
              <button onClick={() => setModalMode(null)} className="text-zinc-400 hover:text-red-400 text-2xl leading-none">&times;</button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-semibold text-zinc-300 mb-2">Task Title *</label>
                <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-red-500" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-zinc-300 mb-2">Description *</label>
                <textarea required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-red-500 resize-y" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-zinc-300 mb-2">Link to project (optional)</label>
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
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-red-500"
                >
                  <option value="">No project</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-zinc-300 mb-2">Project name (free text, optional)</label>
                <input
                  value={form.projectName}
                  onChange={(e) => setForm({ ...form, projectName: e.target.value })}
                  placeholder="Legacy label if not using dropdown"
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-red-500"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-zinc-300 mb-2">Assigned workers</label>
                <p className="text-xs text-zinc-500 mb-2">Select one or more approved workers (stored as array when multiple).</p>
                <div className="max-h-40 overflow-y-auto space-y-2 border border-white/10 rounded-lg p-3 bg-white/[0.03]">
                  {approvedWorkers.length === 0 ? (
                    <p className="text-zinc-500 text-sm">No approved workers.</p>
                  ) : (
                    approvedWorkers.map((w) => (
                      <label key={w.id} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={form.assignedWorkerIds.includes(w.id)}
                          onChange={() => toggleAssignee(w.id)}
                          className="rounded border-zinc-600"
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
                  <label className="block text-sm font-semibold text-zinc-300 mb-2">Status</label>
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-red-500">
                    <option value="assigned">Assigned</option>
                    <option value="in-progress">In Progress</option>
                    <option value="pending-approval">Pending Approval</option>
                    <option value="completed">Completed</option>
                  </select>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-zinc-300 mb-2">Priority</label>
                  <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-red-500">
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-zinc-300 mb-2">Due Date</label>
                  <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-red-500" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-zinc-300 mb-2">Custom Notification Message (optional)</label>
                <textarea value={form.notificationMessage} onChange={(e) => setForm({ ...form, notificationMessage: e.target.value })} rows={2} placeholder="Leave blank to use default message" className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-red-500 resize-y" />
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <button type="button" onClick={() => setModalMode(null)} className="px-5 py-2.5 border border-zinc-600 text-zinc-400 hover:bg-zinc-800 rounded-lg text-sm font-semibold transition-colors">
                  Cancel
                </button>
                <button type="submit" className="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-semibold transition-colors">
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
