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
  low: "text-zinc-400 border-zinc-700",
  medium: "text-blue-400 border-blue-800",
  high: "text-[var(--mft-primary)] border-orange-800",
  urgent: "text-red-400 border-red-800",
};

const STATUS_COLORS: Record<string, string> = {
  assigned: "text-blue-400 border-blue-800",
  "in-progress": "text-yellow-400 border-yellow-800",
  "pending-approval": "text-yellow-400 border-yellow-800",
  completed: "text-[#00FF66] border-green-800",
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
    <div className="mt-4 border-t border-[var(--mft-border)] pt-4">
      <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--mft-muted)] mb-3">{"// COMMS"}</p>
      <div className="max-h-36 overflow-y-auto flex flex-col gap-2 mb-3 pr-1">
        {messages.length === 0 && (
          <p className="text-[9px] uppercase text-[var(--mft-muted)] italic">No messages.</p>
        )}
        {messages.map((m) => {
          const isAdmin = m.senderRole === "admin";
          const ts = m.createdAt?.toDate().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
          return (
            <div key={m.id} className={`flex flex-col gap-0.5 ${isAdmin ? "items-end" : "items-start"}`}>
              <div className={`max-w-[80%] border px-3 py-1.5 text-xs leading-snug ${
                isAdmin ? "border-[var(--mft-primary)]/40 bg-[var(--mft-primary)]/10 text-white" : "border-[var(--mft-border)] bg-[var(--mft-surface)] text-white"
              }`}>
                {m.text}
              </div>
              <p className="text-[8px] uppercase text-[var(--mft-muted)]">{isAdmin ? "YOU" : m.senderName} · {ts}</p>
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
          className="brutal-input flex-1 text-xs py-1.5 placeholder:text-[var(--mft-muted)]"
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

  const filteredProjects = useMemo(() => {
    const t = search.trim().toLowerCase();
    if (!t) return projects;
    return projects.filter((p) => {
      const types = (p.projectTypes || []).join(" ").toLowerCase();
      return (
        p.name.toLowerCase().includes(t) ||
        (p.clientName || "").toLowerCase().includes(t) ||
        types.includes(t)
      );
    });
  }, [projects, search]);

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

    return (
      <div className="space-y-8">
        {/* Breadcrumb */}
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => setDetailId(null)}
            className="text-[10px] font-bold uppercase tracking-widest text-[var(--mft-muted)] hover:text-[var(--mft-primary)] transition-colors">
            ← PROJECTS
          </button>
          <span className="text-[var(--mft-border)]">/</span>
          <span className="text-[10px] font-bold uppercase tracking-widest text-white">{detailProject.name}</span>
        </div>

        {/* Project Header */}
        <div className="border border-[var(--mft-border)] bg-[var(--mft-surface)] p-6 shadow-[4px_4px_0px_0px_var(--mft-primary)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[9px] font-bold uppercase tracking-[0.3em] text-[var(--mft-muted)] mb-1">
                PROJECT.RECORD {"//"}
              </p>
              <h2 className="text-3xl font-oswald font-bold text-white uppercase tracking-wider">
                {detailProject.name}
              </h2>
              {detailProject.clientName && (
                <p className="text-xs uppercase tracking-widest text-[var(--mft-primary)] mt-1">
                  CLIENT: {detailProject.clientName}
                </p>
              )}
              <p className="text-sm text-[var(--mft-muted)] mt-3 max-w-2xl leading-relaxed">
                {detailProject.description}
              </p>
              <div className="flex flex-wrap gap-2 mt-4">
                <span className="brutal-badge text-[var(--mft-primary)] border-[var(--mft-primary)]">
                  {detailProject.status.toUpperCase()}
                </span>
                {(detailProject.projectTypes || []).map((t) => (
                  <span key={t} className="brutal-badge text-[var(--mft-muted)]">{t}</span>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => openEdit(detailProject)} className="brutal-btn-outline px-4 py-2">
                [ EDIT ]
              </button>
              <button type="button" onClick={handleOpenAddTask} className="brutal-btn px-4 py-2">
                [ + TASK ]
              </button>
              <button type="button" onClick={() => void deleteProject(detailProject.id)}
                className="border border-red-800 px-4 py-2 text-xs font-bold uppercase tracking-widest text-red-400 hover:bg-red-900/30 transition-colors">
                [ DELETE ]
              </button>
            </div>
          </div>

          {/* Task stats bar */}
          <div className="mt-6 grid grid-cols-3 gap-px bg-[var(--mft-border)] border border-[var(--mft-border)]">
            {[
              { label: "Active", count: tasksByStatus.active.length, color: "text-blue-400" },
              { label: "Pending Review", count: tasksByStatus.pending.length, color: "text-yellow-400" },
              { label: "Completed", count: tasksByStatus.done.length, color: "text-[#00FF66]" },
            ].map((s) => (
              <div key={s.label} className="bg-[var(--mft-bg)] px-4 py-3 text-center">
                <div className={`text-2xl font-oswald font-bold ${s.color}`}>{s.count}</div>
                <div className="text-[9px] font-bold uppercase tracking-widest text-[var(--mft-muted)] mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Project Specific Calendar */}
        <TasksCalendar tasks={tasks.filter(t => t.projectId === detailId)} selectedDate={selectedDate} onSelectDate={setSelectedDate} />

        {/* Tasks */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--mft-muted)]">
              {"// TASK MANIFEST"} <span className="text-white ml-2">[{projectTasks.length}]</span>
            </p>
          </div>

          {projectTasks.length === 0 ? (
            <div className="border border-dashed border-[var(--mft-border)] p-12 text-center">
              <p className="text-xs font-bold uppercase tracking-widest text-white">NO TASKS ASSIGNED</p>
              <p className="mt-2 text-[10px] uppercase tracking-widest text-[var(--mft-muted)]">
                Use {"[ + TASK ]"} to add a task to this project
              </p>
            </div>
          ) : (
            <div className="space-y-0 border border-[var(--mft-border)]">
              {projectTasks.map((task, idx) => {
                const isExpanded = expandedTaskId === task.id;
                return (
                  <div key={task.id} className={`border-b border-[var(--mft-border)] last:border-0 ${isExpanded ? "bg-[var(--mft-surface)]" : "bg-[var(--mft-bg)] hover:bg-[var(--mft-surface)]"} transition-colors`}>
                    {/* Task row header */}
                    <button
                      type="button"
                      onClick={() => setExpandedTaskId(isExpanded ? null : task.id)}
                      className="w-full flex items-start gap-4 px-6 py-4 text-left"
                    >
                      <span className="text-[10px] font-bold text-[var(--mft-muted)] mt-0.5 shrink-0 font-mono">
                        {String(idx + 1).padStart(2, "0")}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold uppercase tracking-wider text-white text-sm truncate">{task.title}</p>
                        <p className="text-[10px] uppercase tracking-widest mt-1 text-[var(--mft-muted)] truncate">
                          {formatAssignees(task.assignedTo)}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        {chatNotifications.some((n) => n.taskId === task.id) && (
                          <span className="flex items-center gap-1 px-2 py-0.5 bg-cyan-500/20 border border-cyan-500/40 text-cyan-400 text-[9px] font-bold uppercase tracking-widest animate-pulse">
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7z" /></svg>
                            {chatNotifications.filter((n) => n.taskId === task.id).length}
                          </span>
                        )}
                        <span className={`brutal-badge ${PRIORITY_COLORS[task.priority] ?? "text-zinc-400 border-zinc-700"}`}>
                          {task.priority}
                        </span>
                        <span className={`brutal-badge ${STATUS_COLORS[task.status] ?? "text-zinc-400 border-zinc-700"}`}>
                          {task.status.replace(/-/g, " ")}
                        </span>
                        <span className="text-[var(--mft-muted)] text-xs font-bold">{isExpanded ? "[-]" : "[+]"}</span>
                      </div>
                    </button>

                    {/* Expanded task detail */}
                    {isExpanded && (
                      <div className="px-6 pb-6">
                        <div className="border-t border-[var(--mft-border)] pt-4 grid gap-4 sm:grid-cols-2">
                          <div>
                            <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--mft-muted)] mb-1">Description</p>
                            <p className="text-sm text-white leading-relaxed">{task.description || "—"}</p>
                          </div>
                          <div className="space-y-3">
                            <div>
                              <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--mft-muted)] mb-1">Department</p>
                              <p className="text-xs text-white uppercase">{task.department || "—"}</p>
                            </div>
                            <div>
                              <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--mft-muted)] mb-1">Due Date</p>
                              <p className="text-xs text-white">{task.dueDate?.toDate ? task.dueDate.toDate().toLocaleDateString() : "No due date"}</p>
                            </div>
                          </div>
                        </div>

                        {/* Chat */}
                        <TaskChatPanel taskId={task.id} taskTitle={task.title} assignedTo={task.assignedTo} />

                        {/* Task actions */}
                        <div className="mt-4 pt-4 border-t border-[var(--mft-border)] flex gap-2">
                          <button type="button" onClick={() => void deleteTask(task.id)}
                            className="border border-red-800 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-red-400 hover:bg-red-900/30 transition-colors">
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
          <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4 backdrop-blur-sm"
            onClick={() => setShowAddTask(false)}>
            <div className="brutal-card w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 shadow-[4px_4px_0px_0px_var(--mft-primary)]"
              onClick={(e) => e.stopPropagation()}>
              <div className="mb-6 pb-4 border-b border-[var(--mft-border)] flex items-center justify-between">
                <h3 className="text-xl font-oswald text-[var(--mft-primary)] uppercase tracking-wider">{"// ADD TASK"}</h3>
                <button type="button" onClick={() => setShowAddTask(false)} className="text-xs font-bold text-[var(--mft-muted)] hover:text-white">[ X ]</button>
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
                  <div className="max-h-40 overflow-y-auto border border-[var(--mft-border)] bg-[var(--mft-bg)] p-2 space-y-1">
                    {approvedWorkers.length === 0 ? (
                      <p className="text-xs text-[var(--mft-muted)]">No approved workers</p>
                    ) : approvedWorkers.map((w) => (
                      <label key={w.id} className="flex items-center gap-2 text-xs uppercase tracking-wider text-white hover:text-[var(--mft-primary)] cursor-pointer">
                        <input type="checkbox" checked={taskForm.workerIds.includes(w.id)}
                          onChange={() => {
                            const set = new Set(taskForm.workerIds);
                            if (set.has(w.id)) set.delete(w.id); else set.add(w.id);
                            setTaskForm({ ...taskForm, workerIds: [...set] });
                          }}
                          className="accent-[var(--mft-primary)]"
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
                <div className="flex gap-3 pt-4 border-t border-[var(--mft-border)]">
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
          <p className="text-[9px] font-bold uppercase tracking-[0.3em] text-[var(--mft-muted)] mb-1">{"// MODULE"}</p>
          <h2 className="text-3xl font-oswald font-bold text-white uppercase tracking-wider">Project Management</h2>
        </div>
        <button type="button" onClick={() => setShowCreate(true)} className="brutal-btn px-5 py-2.5">
          [ + NEW PROJECT ]
        </button>
      </div>

      {/* Search */}
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="SEARCH — name, client, type..."
        className="brutal-input max-w-xl placeholder:text-[var(--mft-muted)] placeholder:text-[10px] placeholder:uppercase placeholder:tracking-widest"
      />

      {/* Count */}
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-[var(--mft-border)]" />
        <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--mft-muted)]">
          {filteredProjects.length} PROJECTS
        </span>
        <div className="h-px flex-1 bg-[var(--mft-border)]" />
      </div>

      {/* Projects Grid */}
      {filteredProjects.length === 0 ? (
        <div className="border border-dashed border-[var(--mft-border)] p-12 text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-white">NO PROJECTS FOUND</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredProjects.map((p) => {
            const pTaskCount = filteredTasks.filter((t) => t.projectId === p.id).length;
            const unreadCount = unreadByProject.get(p.id) ?? 0;
            return (
              <button key={p.id} type="button" onClick={() => setDetailId(p.id)}
                className={`relative text-left border p-5 transition-all group ${
                  unreadCount > 0
                    ? "border-cyan-500/60 bg-[var(--mft-surface)] shadow-[4px_4px_0px_0px_#06b6d4]"
                    : "border-[var(--mft-border)] bg-[var(--mft-surface)] hover:border-[var(--mft-primary)] hover:shadow-[4px_4px_0px_0px_var(--mft-primary)]"
                }`}>
                {unreadCount > 0 && (
                  <span className="absolute -top-2.5 -right-2.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-cyan-500 text-[11px] font-bold text-black px-1.5 animate-pulse shadow-lg shadow-cyan-500/30">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
                <div className="flex items-start justify-between gap-2 mb-3">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--mft-muted)]">
                    {p.status.toUpperCase()}
                  </p>
                  <div className="flex items-center gap-2">
                    {unreadCount > 0 && (
                      <span className="flex items-center gap-1 text-[9px] font-bold text-cyan-400">
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7z" /></svg>
                        {unreadCount} NEW
                      </span>
                    )}
                    <span className="text-[10px] font-bold font-mono text-[var(--mft-primary)]">TASKS [{pTaskCount}]</span>
                  </div>
                </div>
                <h3 className="text-xl font-oswald font-bold text-white uppercase tracking-wide group-hover:text-[var(--mft-primary)] transition-colors">
                  {p.name}
                </h3>
                {p.clientName && (
                  <p className="text-[10px] uppercase tracking-widest text-[var(--mft-primary)] mt-1">{p.clientName}</p>
                )}
                <p className="text-xs text-[var(--mft-muted)] mt-3 line-clamp-2 leading-relaxed">{p.description}</p>
                <div className="flex flex-wrap gap-1.5 mt-4">
                  {(p.projectTypes || []).map((t) => (
                    <span key={t} className="brutal-badge text-[var(--mft-muted)] text-[8px]">{t}</span>
                  ))}
                </div>
                <div className="mt-4 pt-3 border-t border-[var(--mft-border)] flex justify-between items-center">
                  <span className="text-[9px] font-bold uppercase tracking-widest text-[var(--mft-muted)]">
                    {p.startDate ? `START: ${p.startDate}` : "NO START DATE"}
                  </span>
                  <span className="text-[9px] font-bold text-[var(--mft-primary)] group-hover:underline">VIEW →</span>
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
    <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="brutal-card w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 shadow-[4px_4px_0px_0px_var(--mft-primary)]" onClick={(e) => e.stopPropagation()}>
        <div className="mb-6 pb-4 border-b border-[var(--mft-border)] flex items-center justify-between">
          <h3 className="text-xl font-oswald text-[var(--mft-primary)] uppercase tracking-wider">{title}</h3>
          <button type="button" onClick={onClose} className="text-xs font-bold text-[var(--mft-muted)] hover:text-white">[ X ]</button>
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
            <div className="grid grid-cols-2 gap-2 border border-[var(--mft-border)] bg-[var(--mft-bg)] p-3">
              {PROJECT_TYPES.map((pt) => (
                <label key={pt.value} className="flex items-center gap-2 text-xs uppercase tracking-wider text-white hover:text-[var(--mft-primary)] cursor-pointer">
                  <input type="checkbox" className="accent-[var(--mft-primary)]"
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
          <div className="flex gap-3 pt-4 border-t border-[var(--mft-border)]">
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
