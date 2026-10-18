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
import { toast, confirmDialog, promptDialog } from "@/lib/admin/feedback";
import { logActivity } from "@/lib/admin/activity";
import { notifyAdmins } from "@/lib/adminNotifications";
import { useUrlState } from "@/lib/admin/useUrlState";
import ModalPortal from "@/components/admin/ui/ModalPortal";
import LinkifiedText, { stripRichHtml } from "@/components/admin/ui/LinkifiedText";
import RichDescriptionEditor from "@/components/admin/ui/RichDescriptionEditor";
import ProjectBoardView from "@/components/admin/projects/ProjectBoardView";
import { SubtaskItem, TaskRow, Worker as ProjectWorker, sanitizeSubtask, sanitizeSubtasks } from "@/components/admin/projects/types";

function formatExternalUrl(url?: string): string {
  if (!url) return "";
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

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
  startDate?: { toDate?: () => Date } | Date | string | null;
  dueDate?: { toDate?: () => Date } | Date | string | null;
  createdAt?: { toDate?: () => Date } | Date | string | null;
  updatedAt?: { toDate?: () => Date } | Date | string | null;
  rejectionReason?: string;
  department?: string;
  photo?: string | null;
  startedAt?: { toDate?: () => Date } | Date | string | null;
  submittedForApprovalAt?: { toDate?: () => Date } | Date | string | null;
  subtasks?: SubtaskItem[];
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
  const [deepLinkTaskId, setDeepLinkTaskId] = useUrlState("task", "");

  // Filters & Search (mirrored to the URL so views are shareable)
  const [statusFilterRaw, setStatusFilterRaw] = useUrlState("status", "all");
  const statusFilter = statusFilterRaw as StatusFilter;
  const setStatusFilter = (v: StatusFilter) => setStatusFilterRaw(v);
  const [searchQuery, setSearchQuery] = useUrlState("q", "");

  // View Mode: list vs board
  const [viewModeRaw, setViewModeRaw] = useUrlState("view", "list");
  const viewMode = (viewModeRaw === "board" ? "board" : "list") as "list" | "board";
  const setViewMode = (v: "list" | "board") => setViewModeRaw(v);

  // Modal State
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [editId, setEditId] = useState("");
  const [workerSearch, setWorkerSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [detailSubtaskTitle, setDetailSubtaskTitle] = useState("");
  const [detailSubtaskDesc, setDetailSubtaskDesc] = useState("");
  const [detailSubtaskLink, setDetailSubtaskLink] = useState("");
  const [detailSubtaskBusy, setDetailSubtaskBusy] = useState(false);
  const [editingDetailStId, setEditingDetailStId] = useState<string | null>(null);
  const [editDetailStTitle, setEditDetailStTitle] = useState("");
  const [editDetailStDesc, setEditDetailStDesc] = useState("");
  const [editDetailStLink, setEditDetailStLink] = useState("");

  const [formSubtaskTitle, setFormSubtaskTitle] = useState("");
  const [formSubtaskDesc, setFormSubtaskDesc] = useState("");
  const [formSubtaskLink, setFormSubtaskLink] = useState("");

  const [form, setForm] = useState({
    title: "",
    description: "",
    projectId: "",
    projectName: "",
    department: "general",
    assignedWorkerIds: [] as string[],
    priority: "medium",
    status: "assigned",
    startDate: "",
    dueDate: "",
    photo: "",
    notificationMessage: "",
    subtasks: [] as SubtaskItem[],
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

  // Open task detail modal when navigated via ?task=<id> from notification bell / toast / push
  useEffect(() => {
    if (!deepLinkTaskId || tasks.length === 0) return;
    const match = tasks.find((t) => t.id === deepLinkTaskId);
    if (match) {
      setDetailTask(match);
      setDeepLinkTaskId("");
    }
  }, [deepLinkTaskId, tasks, setDeepLinkTaskId]);

  const handleToggleDetailSubtask = async (stId: string) => {
    if (!detailTask || detailSubtaskBusy) return;
    setDetailSubtaskBusy(true);
    try {
      const current = sanitizeSubtasks(detailTask.subtasks);
      const updated = current.map((st) => (st.id === stId ? { ...st, completed: !st.completed } : st));
      await updateDoc(doc(db, "tasks", detailTask.id), { subtasks: sanitizeSubtasks(updated) });
    } catch (err) {
      console.error("Failed to toggle subtask:", err);
      toast.error("Failed to update checklist item");
    } finally {
      setDetailSubtaskBusy(false);
    }
  };

  const handleAddDetailSubtask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detailTask || !detailSubtaskTitle.trim() || detailSubtaskBusy) return;
    setDetailSubtaskBusy(true);
    try {
      const current = sanitizeSubtasks(detailTask.subtasks);
      const newSt = sanitizeSubtask({
        title: detailSubtaskTitle,
        description: detailSubtaskDesc,
        link: detailSubtaskLink,
        completed: false,
      });
      await updateDoc(doc(db, "tasks", detailTask.id), { subtasks: sanitizeSubtasks([...current, newSt]) });
      setDetailSubtaskTitle("");
      setDetailSubtaskDesc("");
      setDetailSubtaskLink("");
      toast.success("Checklist item added");
    } catch (err) {
      console.error("Failed to add subtask:", err);
      toast.error("Failed to add checklist item");
    } finally {
      setDetailSubtaskBusy(false);
    }
  };

  const handleStartEditDetailSubtask = (st: SubtaskItem) => {
    setEditingDetailStId(st.id);
    setEditDetailStTitle(st.title);
    setEditDetailStDesc(st.description || "");
    setEditDetailStLink(st.link || "");
  };

  const handleSaveEditDetailSubtask = async () => {
    if (!detailTask || !editingDetailStId || !editDetailStTitle.trim() || detailSubtaskBusy) return;
    setDetailSubtaskBusy(true);
    try {
      const current = sanitizeSubtasks(detailTask.subtasks);
      const updated = current.map((st) =>
        st.id === editingDetailStId
          ? sanitizeSubtask({
              ...st,
              title: editDetailStTitle,
              description: editDetailStDesc,
              link: editDetailStLink,
            })
          : st
      );
      await updateDoc(doc(db, "tasks", detailTask.id), { subtasks: sanitizeSubtasks(updated) });
      setEditingDetailStId(null);
      setEditDetailStTitle("");
      setEditDetailStDesc("");
      setEditDetailStLink("");
      toast.success("Checklist item updated");
    } catch (err) {
      console.error("Failed to edit subtask:", err);
      toast.error("Failed to update checklist item");
    } finally {
      setDetailSubtaskBusy(false);
    }
  };

  const handleCancelEditDetailSubtask = () => {
    setEditingDetailStId(null);
    setEditDetailStTitle("");
    setEditDetailStDesc("");
    setEditDetailStLink("");
  };

  const handleDeleteDetailSubtask = async (stId: string) => {
    if (!detailTask || detailSubtaskBusy) return;
    setDetailSubtaskBusy(true);
    try {
      const current = sanitizeSubtasks(detailTask.subtasks);
      const updated = current.filter((st) => st.id !== stId);
      await updateDoc(doc(db, "tasks", detailTask.id), { subtasks: sanitizeSubtasks(updated) });
      toast.success("Checklist item removed");
    } catch (err) {
      console.error("Failed to delete subtask:", err);
      toast.error("Failed to remove checklist item");
    } finally {
      setDetailSubtaskBusy(false);
    }
  };

  const handleAddFormSubtask = () => {
    if (!formSubtaskTitle.trim()) return;
    const item = sanitizeSubtask({
      title: formSubtaskTitle,
      description: formSubtaskDesc,
      link: formSubtaskLink,
      completed: false,
    });
    setForm((prev) => ({ ...prev, subtasks: [...prev.subtasks, item] }));
    setFormSubtaskTitle("");
    setFormSubtaskDesc("");
    setFormSubtaskLink("");
  };

  const handleToggleFormSubtask = (stId: string) => {
    setForm((prev) => ({
      ...prev,
      subtasks: prev.subtasks.map((st) => (st.id === stId ? { ...st, completed: !st.completed } : st)),
    }));
  };

  const handleRemoveFormSubtask = (stId: string) => {
    setForm((prev) => ({
      ...prev,
      subtasks: prev.subtasks.filter((st) => st.id !== stId),
    }));
  };

  // Subscribe to admin chat notifications for unread badges on task cards (sound & toast are handled globally by useAdminBadges)
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
      void sendChatNotificationToWorkers(db, {
        recipientUids,
        taskId: detailTask.id,
        taskTitle: detailTask.title || "Task",
        senderUid,
        senderName,
        messageText: chatInput,
      }).catch(() => {});
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
      startDate: "",
      dueDate: "",
      photo: "",
      notificationMessage: "",
      subtasks: [],
    });
    setFormSubtaskTitle("");
    setFormSubtaskDesc("");
    setFormSubtaskLink("");
    setWorkerSearch("");
    setModalMode("create");
  };

  const openEdit = (task: Task) => {
    const startDateStr = formatLocalDateInput(task.startDate);
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
      startDate: startDateStr,
      dueDate: dueDateStr,
      photo: task.photo || "",
      notificationMessage: "",
      subtasks: sanitizeSubtasks(task.subtasks),
    });
    setFormSubtaskTitle("");
    setFormSubtaskDesc("");
    setFormSubtaskLink("");
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
      toast.warning("Task title is required");
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
          startDate: form.startDate ? new Date(form.startDate) : null,
          dueDate: form.dueDate ? new Date(form.dueDate) : null,
          subtasks: sanitizeSubtasks(form.subtasks),
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
        const currentAdmin = getAuth().currentUser;
        const actorName = currentAdmin?.displayName || currentAdmin?.email || "Admin";
        void notifyAdmins(db, {
          targetRoles: ["super_admin", "ops_admin"],
          category: "task",
          eventType: "task_created",
          title: `📋 New Task Created: ${form.title.trim()}`,
          body: `${actorName} assigned "${form.title.trim()}" to ${assignedWorkerNames || "Unassigned"}${projName ? ` (${projName})` : ""}.`,
          href: `/admin/tasks?task=${encodeURIComponent(taskRef.id)}`,
          actorUid: currentAdmin?.uid,
          actorName,
          taskId: taskRef.id,
          projectId: form.projectId || undefined,
        });
        toast.success("Task created", { description: assignedWorkerNames ? `Assigned to ${assignedWorkerNames}` : form.title.trim() });
        void logActivity({ action: "created", entity: "task", entityId: taskRef.id, label: form.title.trim(), detail: projName || undefined });
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
          startDate: form.startDate ? new Date(form.startDate) : null,
          dueDate: form.dueDate ? new Date(form.dueDate) : null,
          subtasks: sanitizeSubtasks(form.subtasks),
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
        const currentAdmin = getAuth().currentUser;
        const actorName = currentAdmin?.displayName || currentAdmin?.email || "Admin";
        void notifyAdmins(db, {
          targetRoles: ["super_admin", "ops_admin"],
          category: "task",
          eventType: "task_updated",
          title: `✏️ Task Updated: ${form.title.trim()}`,
          body: `${actorName} updated task "${form.title.trim()}" (assigned to ${assignedWorkerNames || "Unassigned"}).`,
          href: `/admin/tasks?task=${encodeURIComponent(editId)}`,
          actorUid: currentAdmin?.uid,
          actorName,
          taskId: editId,
          projectId: form.projectId || undefined,
        });
        toast.success("Task updated");
        void logActivity({ action: "updated", entity: "task", entityId: editId, label: form.title.trim() });
      }
      setModalMode(null);
    } catch (err) {
      console.error("Failed to save task:", err);
      toast.error("Failed to save task", { description: "Please try again." });
    } finally {
      setSaving(false);
    }
  };

  const deleteTask = async (id: string) => {
    const t = tasks.find((x) => x.id === id);
    const ok = await confirmDialog({
      title: `Delete ${t?.title ? `"${t.title}"` : "this task"}?`,
      message: "This action cannot be undone.",
      tone: "danger",
      confirmLabel: "Delete task",
    });
    if (!ok) return;
    try {
      await deleteDoc(doc(db, "tasks", id));
      if (detailTask?.id === id) setDetailTask(null);
      toast.success("Task deleted");
      void logActivity({ action: "deleted", entity: "task", entityId: id, label: t?.title || id });
    } catch {
      toast.error("Could not delete task");
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
      const currentAdmin = getAuth().currentUser;
      const actorName = currentAdmin?.displayName || currentAdmin?.email || "Admin";
      void notifyAdmins(db, {
        targetRoles: ["super_admin", "ops_admin"],
        category: "task",
        eventType: "task_approved",
        title: `✅ Task Approved: ${task.title}`,
        body: `${actorName} approved task "${task.title}".`,
        href: `/admin/tasks?task=${encodeURIComponent(task.id)}`,
        actorUid: currentAdmin?.uid,
        actorName,
        taskId: task.id,
        projectId: task.projectId,
      });
    }
    toast.success("Task approved", { description: task?.title });
    void logActivity({ action: "approved", entity: "task", entityId: id, label: task?.title || id });
  };

  const rejectTask = async (id: string) => {
    const pending = tasks.find((t) => t.id === id);
    const reason = await promptDialog({
      title: `Request changes${pending?.title ? ` on "${pending.title}"` : ""}`,
      message: "The task goes back to In progress and assignees are notified.",
      placeholder: "Reason / feedback for the worker (optional)",
      multiline: true,
      confirmLabel: "Send back",
    });
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
      const currentAdmin = getAuth().currentUser;
      const actorName = currentAdmin?.displayName || currentAdmin?.email || "Admin";
      void notifyAdmins(db, {
        targetRoles: ["super_admin", "ops_admin"],
        category: "task",
        eventType: "task_rejected",
        title: `⚠️ Changes Requested: ${task.title}`,
        body: `${actorName} requested changes on "${task.title}": ${feedback}`,
        href: `/admin/tasks?task=${encodeURIComponent(task.id)}`,
        actorUid: currentAdmin?.uid,
        actorName,
        taskId: task.id,
        projectId: task.projectId,
        urgent: true,
      });
    }
    toast.warning("Changes requested", { description: task?.title });
    void logActivity({ action: "rejected", entity: "task", entityId: id, label: task?.title || id, detail: feedback });
  };

  const quickUpdateStatus = async (taskId: string, newStatus: string) => {
    const t = tasks.find((x) => x.id === taskId);
    if (!t || t.status === newStatus) return;

    if (newStatus === "completed") {
      await approveTask(taskId);
      return;
    }
    if (newStatus === "pending-approval") {
      await updateDoc(doc(db, "tasks", taskId), {
        status: "pending-approval",
        submittedForApprovalAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(doc(db, "tasks", taskId), {
        status: newStatus,
        updatedAt: serverTimestamp(),
        ...(newStatus === "in-progress" && !t.startedAt ? { startedAt: serverTimestamp() } : {}),
      });
    }
    const ids = assignedWorkerIds(t.assignedTo);
    if (ids.length > 0) {
      void sendExpoPushToWorkers(db, {
        recipientUids: ids,
        title: `Task Status: ${newStatus.replace(/-/g, " ").toUpperCase()}`,
        body: `"${t.title}" was moved to ${newStatus.replace(/-/g, " ")}.`,
        taskId,
        taskTitle: t.title,
      }).catch(() => {});
    }
    const currentAdmin = getAuth().currentUser;
    const actorName = currentAdmin?.displayName || currentAdmin?.email || "Admin";
    void notifyAdmins(db, {
      targetRoles: ["super_admin", "ops_admin"],
      category: "task",
      eventType: "task_status_changed",
      title: `🔄 Task Status Changed: ${t.title}`,
      body: `${actorName} moved "${t.title}" to ${newStatus.replace(/-/g, " ")}.`,
      href: `/admin/tasks?task=${encodeURIComponent(taskId)}`,
      actorUid: currentAdmin?.uid,
      actorName,
      taskId,
      projectId: t.projectId,
    });
    toast.success(`Task moved to ${newStatus.replace(/-/g, " ")}`, { description: t.title });
    void logActivity({ action: "updated", entity: "task", entityId: taskId, label: t.title, detail: `Moved to ${newStatus}` });
  };

  const quickAddTask = (prefill: { status: string }) => {
    setForm({
      title: "",
      description: "",
      projectId: "",
      projectName: "",
      department: "general",
      assignedWorkerIds: [],
      priority: "medium",
      status: prefill.status || "assigned",
      startDate: "",
      dueDate: "",
      photo: "",
      notificationMessage: "",
      subtasks: [],
    });
    setFormSubtaskTitle("");
    setFormSubtaskDesc("");
    setFormSubtaskLink("");
    setWorkerSearch("");
    setModalMode("create");
  };

  const unreadTaskIdSet = useMemo(() => {
    return new Set(chatNotifications.map((n) => n.taskId).filter(Boolean));
  }, [chatNotifications]);

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
          {/* View Mode Toggle: List vs Board */}
          <div className="flex items-center bg-zinc-100 border-2 border-zinc-900 rounded-lg p-1 shadow-[2px_2px_0px_0px_#09090b]">
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-bold uppercase rounded transition-all cursor-pointer ${
                viewMode === "list"
                  ? "bg-zinc-900 text-white shadow-xs"
                  : "text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200/70"
              }`}
              title="Switch to List View"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h7" />
              </svg>
              <span>List</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("board")}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-bold uppercase rounded transition-all cursor-pointer ${
                viewMode === "board"
                  ? "bg-zinc-900 text-white shadow-xs"
                  : "text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200/70"
              }`}
              title="Switch to Kanban Board View"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
              </svg>
              <span>Board</span>
            </button>
          </div>

          <button
            type="button"
            id="btn-create-task"
            onClick={openCreate}
            className="brutal-btn px-4 py-2 flex items-center gap-2 cursor-pointer shadow-md"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            <span>Create &amp; Assign Task</span>
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

      {/* Task Content: Board vs List */}
      {viewMode === "board" ? (
        <div className="space-y-4">
          {statusFilter !== "all" && (
            <div className="flex items-center justify-between p-3 bg-amber-50 border border-amber-300 rounded-lg text-xs font-mono">
              <span className="text-amber-900 font-bold">
                ⚠️ Board is currently filtered to status: <span className="uppercase underline">{statusFilter.replace(/-/g, " ")}</span>
              </span>
              <button
                type="button"
                onClick={() => setStatusFilter("all")}
                className="px-2.5 py-1 bg-amber-200 hover:bg-amber-300 text-amber-950 font-bold uppercase rounded cursor-pointer transition-colors"
              >
                Show All Columns
              </button>
            </div>
          )}

          <ProjectBoardView
            tasks={filteredTasks as unknown as TaskRow[]}
            workers={workers as unknown as ProjectWorker[]}
            unreadTaskIdSet={unreadTaskIdSet}
            onSelectTask={(task) => setDetailTask(task as unknown as Task)}
            onOpenEditTask={(task) => openEdit(task as unknown as Task)}
            onDeleteTask={(taskId) => deleteTask(taskId)}
            onApproveTask={(task) => approveTask(task.id)}
            onRejectTask={(task) => rejectTask(task.id)}
            onQuickUpdateStatus={(taskId, newStatus) => quickUpdateStatus(taskId, newStatus)}
            onQuickAddTask={(prefill) => quickAddTask(prefill)}
          />
        </div>
      ) : filteredTasks.length === 0 ? (
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
                  {task.subtasks && task.subtasks.length > 0 && (
                    <span
                      className={`text-xs font-mono font-bold px-2 py-0.5 border rounded ${
                        task.subtasks.every((s) => s.completed)
                          ? "bg-emerald-50 text-emerald-700 border-emerald-300"
                          : "bg-zinc-100 text-zinc-700 border-zinc-300"
                      }`}
                      title="Checklist / Subtasks progress"
                    >
                      ☑ {task.subtasks.filter((s) => s.completed).length}/{task.subtasks.length}
                    </span>
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
                  <span className="text-zinc-500 font-medium">Description:</span>{" "}
                  <LinkifiedText text={task.description} />
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
                  <span className="text-zinc-500 font-medium">Start Date:</span>{" "}
                  <span className="font-semibold text-zinc-900">
                    {task.startDate ? formatTaskDate(task.startDate) : "—"}
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
        <ModalPortal onClose={() => setDetailTask(null)}>
          <div
            className="fixed inset-0 z-[120] bg-zinc-950/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto animate-fade-in"
            onClick={() => setDetailTask(null)}
          >
            <div
              className="bg-white border-2 border-zinc-900 rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 space-y-3 text-sm text-zinc-800 shadow-2xl font-mono animate-scale-in"
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
              <div>
                <span className="text-zinc-500 font-bold uppercase">Description:</span>{" "}
                <div className="text-zinc-800 block mt-1 bg-zinc-50 p-2.5 border border-zinc-200 rounded whitespace-pre-wrap">
                  <LinkifiedText text={detailTask.description} />
                </div>
              </div>
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
                  <span className="text-zinc-500 font-bold uppercase">Start Date:</span>{" "}
                  <strong className="text-zinc-900 block">
                    {detailTask.startDate ? formatTaskDate(detailTask.startDate) : "—"}
                  </strong>
                </p>
                <p>
                  <span className="text-zinc-500 font-bold uppercase">Deadline:</span>{" "}
                  <strong className="text-zinc-900 block">{formatTaskDate(detailTask.dueDate)}</strong>
                </p>
                <p className="col-span-2">
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

            {/* Checklist & Subtasks Section */}
            <div className="mt-4 pt-4 border-t-2 border-zinc-200 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold font-mono text-zinc-950 uppercase flex items-center gap-1.5">
                  <span>☑</span> Checklist &amp; Subtasks
                  {detailTask.subtasks && detailTask.subtasks.length > 0 && (
                    <span className="text-[10px] font-mono font-bold text-zinc-600 bg-zinc-200 px-2 py-0.5 rounded">
                      {detailTask.subtasks.filter((s) => s.completed).length}/{detailTask.subtasks.length} (
                      {Math.round(
                        (detailTask.subtasks.filter((s) => s.completed).length / detailTask.subtasks.length) * 100
                      )}
                      %)
                    </span>
                  )}
                </h4>
              </div>

              {detailTask.subtasks && detailTask.subtasks.length > 0 && (
                <div className="h-1.5 w-full bg-zinc-200 rounded-full overflow-hidden">
                  <div
                    style={{
                      width: `${Math.round(
                        (detailTask.subtasks.filter((s) => s.completed).length / detailTask.subtasks.length) * 100
                      )}%`,
                    }}
                    className="h-full bg-emerald-600 transition-all duration-300"
                  />
                </div>
              )}

              <div className="space-y-2">
                {(detailTask.subtasks || []).map((st) => {
                  const isEditing = editingDetailStId === st.id;
                  if (isEditing) {
                    return (
                      <div key={st.id} className="p-3 bg-white border-2 border-red-500 rounded-md space-y-2 shadow-xs">
                        <input
                          type="text"
                          value={editDetailStTitle}
                          onChange={(e) => setEditDetailStTitle(e.target.value)}
                          placeholder="Subtask title (required)"
                          className="w-full text-xs font-mono px-2.5 py-1.5 border border-zinc-300 rounded focus:border-red-600 focus:outline-none"
                          autoFocus
                        />
                        <input
                          type="text"
                          value={editDetailStDesc}
                          onChange={(e) => setEditDetailStDesc(e.target.value)}
                          placeholder="Description or notes (optional)"
                          className="w-full text-[11px] font-mono px-2.5 py-1.5 border border-zinc-200 rounded focus:border-red-600 focus:outline-none text-zinc-700"
                        />
                        <input
                          type="text"
                          value={editDetailStLink}
                          onChange={(e) => setEditDetailStLink(e.target.value)}
                          placeholder="Link URL (e.g. figma.com/... or PR link, optional)"
                          className="w-full text-[11px] font-mono px-2.5 py-1.5 border border-zinc-200 rounded focus:border-red-600 focus:outline-none text-blue-700"
                        />
                        <div className="flex justify-end gap-1.5 pt-1">
                          <button
                            type="button"
                            onClick={handleCancelEditDetailSubtask}
                            className="text-[10px] font-mono px-2.5 py-1 rounded border border-zinc-300 hover:bg-zinc-100 text-zinc-600 cursor-pointer"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={handleSaveEditDetailSubtask}
                            disabled={!editDetailStTitle.trim() || detailSubtaskBusy}
                            className="text-[10px] font-mono font-bold px-3 py-1 rounded bg-red-600 hover:bg-red-700 text-white disabled:opacity-40 cursor-pointer"
                          >
                            Save Changes
                          </button>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={st.id}
                      className={`p-2.5 bg-white border border-zinc-200 rounded-md transition-all group ${
                        st.completed ? "bg-zinc-50/80 border-zinc-200 opacity-80" : "hover:border-zinc-400 shadow-2xs"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2.5">
                        <label className="flex items-start gap-2.5 flex-1 min-w-0 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={st.completed}
                            onChange={() => handleToggleDetailSubtask(st.id)}
                            className="accent-emerald-600 w-4 h-4 mt-0.5 rounded cursor-pointer shrink-0"
                          />
                          <div className="flex-1 min-w-0">
                            <span
                              className={`text-xs font-mono font-semibold block break-words ${
                                st.completed ? "line-through text-zinc-400" : "text-zinc-900"
                              }`}
                            >
                              {st.title}
                            </span>
                            {st.description && (
                              <p
                                className={`text-[11px] font-mono mt-0.5 whitespace-pre-wrap break-words ${
                                  st.completed ? "text-zinc-400 line-through" : "text-zinc-600"
                                }`}
                              >
                                <LinkifiedText text={st.description} />
                              </p>
                            )}
                            {st.link && (
                              <div className="mt-1.5">
                                <a
                                  href={formatExternalUrl(st.link)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="inline-flex items-center gap-1.5 text-[10px] font-mono font-semibold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-2 py-0.5 rounded transition-colors cursor-pointer max-w-full truncate"
                                  title={st.link}
                                >
                                  <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                  </svg>
                                  <span className="truncate">{st.link.replace(/^https?:\/\//i, "")}</span>
                                </a>
                              </div>
                            )}
                          </div>
                        </label>
                        <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            type="button"
                            onClick={() => handleStartEditDetailSubtask(st)}
                            className="p-1 text-zinc-400 hover:text-zinc-800 hover:bg-zinc-100 rounded text-xs cursor-pointer transition-colors"
                            title="Edit subtask"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteDetailSubtask(st.id)}
                            className="p-1 text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded text-xs cursor-pointer transition-colors"
                            title="Delete subtask"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {(!detailTask.subtasks || detailTask.subtasks.length === 0) && (
                  <p className="text-xs font-mono text-zinc-400 italic py-1">No subtasks or checklist steps yet.</p>
                )}
              </div>

              {/* Add Subtask Form */}
              <form onSubmit={handleAddDetailSubtask} className="bg-white border border-zinc-200 rounded-md p-2.5 space-y-2">
                <input
                  type="text"
                  value={detailSubtaskTitle}
                  onChange={(e) => setDetailSubtaskTitle(e.target.value)}
                  placeholder="+ Subtask title (required)..."
                  className="w-full text-xs font-mono px-2.5 py-1.5 border border-zinc-300 rounded focus:outline-none focus:border-red-600"
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={detailSubtaskDesc}
                    onChange={(e) => setDetailSubtaskDesc(e.target.value)}
                    placeholder="Description / criteria (optional)..."
                    className="text-[11px] font-mono px-2.5 py-1.5 border border-zinc-200 rounded focus:outline-none focus:border-red-600 text-zinc-700 placeholder:text-zinc-400"
                  />
                  <input
                    type="text"
                    value={detailSubtaskLink}
                    onChange={(e) => setDetailSubtaskLink(e.target.value)}
                    placeholder="Link URL (e.g. figma.com/..., optional)"
                    className="text-[11px] font-mono px-2.5 py-1.5 border border-zinc-200 rounded focus:outline-none focus:border-red-600 text-zinc-700 placeholder:text-zinc-400"
                  />
                </div>
                <div className="flex justify-end pt-0.5">
                  <button
                    type="submit"
                    disabled={!detailSubtaskTitle.trim()}
                    className="px-3 py-1.5 bg-zinc-900 hover:bg-black text-white text-xs font-mono font-bold uppercase rounded disabled:opacity-40 cursor-pointer shadow-xs transition-colors"
                  >
                    + Add Subtask
                  </button>
                </div>
              </form>
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
      </ModalPortal>
    )}

      {/* Create / Edit Task Modal */}
      {modalMode && (
        <ModalPortal onClose={() => setModalMode(null)}>
          <div
            className="fixed inset-0 z-[120] bg-zinc-950/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto animate-fade-in"
            onClick={() => setModalMode(null)}
          >
            <div
              className="bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-700 rounded-xl w-full max-w-xl max-h-[90vh] overflow-y-auto p-6 md:p-8 shadow-2xl font-mono text-zinc-950 dark:text-zinc-100 animate-scale-in"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-5 pb-3 border-b-2 border-zinc-900 dark:border-zinc-700">
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
                  Description &amp; Guidelines (Headlines, Paragraphs &amp; Colors) *
                </label>
                <RichDescriptionEditor
                  value={form.description}
                  onChange={(val) => setForm({ ...form, description: val })}
                  placeholder="Provide detailed instructions, deliverables, requirements..."
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

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold uppercase tracking-wider text-zinc-800 mb-1">
                    Start Date
                  </label>
                  <input
                    type="date"
                    value={form.startDate}
                    onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                    className="w-full px-3 py-2 bg-white border-2 border-zinc-900 rounded text-xs font-bold text-zinc-900 focus:outline-none focus:ring-2 focus:ring-red-600"
                  />
                  <div className="flex flex-wrap items-center gap-1 mt-1">
                    {[
                      { label: "Today", offset: 0 },
                      { label: "Tmrw", offset: 1 },
                      { label: "+3d", offset: 3 },
                    ].map((p) => (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() => {
                          const d = new Date();
                          d.setDate(d.getDate() + p.offset);
                          const pad = (n: number) => n.toString().padStart(2, "0");
                          setForm({ ...form, startDate: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` });
                        }}
                        className="px-1.5 py-0.5 rounded bg-zinc-100 hover:bg-zinc-200 text-[9px] font-bold text-zinc-700 cursor-pointer"
                      >
                        {p.label}
                      </button>
                    ))}
                    {form.startDate && (
                      <button
                        type="button"
                        onClick={() => setForm({ ...form, startDate: "" })}
                        className="px-1.5 py-0.5 rounded text-[9px] font-bold text-zinc-400 hover:text-red-600 cursor-pointer"
                      >
                        Clear
                      </button>
                    )}
                  </div>
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
                  <div className="flex flex-wrap items-center gap-1 mt-1">
                    {[
                      { label: "Today", offset: 0 },
                      { label: "Tmrw", offset: 1 },
                      { label: "+3d", offset: 3 },
                      { label: "+1w", offset: 7 },
                    ].map((p) => (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() => {
                          const d = new Date();
                          d.setDate(d.getDate() + p.offset);
                          const pad = (n: number) => n.toString().padStart(2, "0");
                          setForm({ ...form, dueDate: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` });
                        }}
                        className="px-1.5 py-0.5 rounded bg-zinc-100 hover:bg-zinc-200 text-[9px] font-bold text-zinc-700 cursor-pointer"
                      >
                        {p.label}
                      </button>
                    ))}
                    {form.dueDate && (
                      <button
                        type="button"
                        onClick={() => setForm({ ...form, dueDate: "" })}
                        className="px-1.5 py-0.5 rounded text-[9px] font-bold text-zinc-400 hover:text-red-600 cursor-pointer"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {form.startDate && form.dueDate && form.startDate > form.dueDate && (
                <p className="text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5">
                  ⚠️ Start date ({form.startDate}) is after the deadline ({form.dueDate}).
                </p>
              )}

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

              {/* Checklist & Subtasks Builder */}
              <div className="border-2 border-zinc-900 rounded p-3 bg-zinc-50 space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-zinc-800">
                    Checklist &amp; Subtasks ({form.subtasks.length})
                  </label>
                  <span className="text-[10px] font-mono text-zinc-500">
                    Title, description &amp; links
                  </span>
                </div>

                <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                  {form.subtasks.map((st) => (
                    <div
                      key={st.id}
                      className={`p-2 bg-white border border-zinc-200 rounded text-xs flex items-start justify-between gap-2 ${
                        st.completed ? "bg-zinc-50 opacity-70" : ""
                      }`}
                    >
                      <label className="flex items-start gap-2 flex-1 min-w-0 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={st.completed}
                          onChange={() => handleToggleFormSubtask(st.id)}
                          className="accent-emerald-600 w-3.5 h-3.5 mt-0.5 rounded cursor-pointer shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <span className={`font-semibold block truncate ${st.completed ? "line-through text-zinc-400" : "text-zinc-900"}`}>
                            {st.title}
                          </span>
                          {st.description && (
                            <p className={`text-[11px] whitespace-pre-wrap ${st.completed ? "line-through text-zinc-400" : "text-zinc-500"}`}>
                              <LinkifiedText text={st.description} />
                            </p>
                          )}
                          {st.link && (
                            <a
                              href={formatExternalUrl(st.link)}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center gap-1 text-[10px] text-blue-600 hover:underline mt-0.5 truncate"
                            >
                              <span>🔗</span>
                              <span className="truncate">{st.link.replace(/^https?:\/\//i, "")}</span>
                            </a>
                          )}
                        </div>
                      </label>
                      <button
                        type="button"
                        onClick={() => handleRemoveFormSubtask(st.id)}
                        className="text-zinc-400 hover:text-red-600 px-1 cursor-pointer text-sm font-bold shrink-0"
                        title="Remove item"
                      >
                        &times;
                      </button>
                    </div>
                  ))}
                  {form.subtasks.length === 0 && (
                    <p className="text-xs text-zinc-400 italic py-0.5">No subtasks added yet.</p>
                  )}
                </div>

                <div className="bg-white border border-zinc-200 rounded p-2.5 space-y-2">
                  <input
                    type="text"
                    value={formSubtaskTitle}
                    onChange={(e) => setFormSubtaskTitle(e.target.value)}
                    placeholder="+ Subtask title (required)..."
                    className="w-full text-xs px-2 py-1.5 border border-zinc-300 rounded focus:border-red-600 focus:outline-none"
                  />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={formSubtaskDesc}
                      onChange={(e) => setFormSubtaskDesc(e.target.value)}
                      placeholder="Description / criteria (optional)..."
                      className="text-[11px] px-2 py-1 border border-zinc-200 rounded focus:border-red-600 focus:outline-none text-zinc-700"
                    />
                    <input
                      type="text"
                      value={formSubtaskLink}
                      onChange={(e) => setFormSubtaskLink(e.target.value)}
                      placeholder="Link URL (e.g. figma.com/..., optional)"
                      className="text-[11px] px-2 py-1 border border-zinc-200 rounded focus:border-red-600 focus:outline-none text-zinc-700"
                    />
                  </div>
                  <div className="flex justify-end pt-0.5">
                    <button
                      type="button"
                      onClick={handleAddFormSubtask}
                      disabled={!formSubtaskTitle.trim()}
                      className="px-2.5 py-1 bg-zinc-900 hover:bg-black text-white text-[11px] font-bold uppercase rounded disabled:opacity-40 cursor-pointer transition-colors"
                    >
                      + Add Subtask
                    </button>
                  </div>
                </div>
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
      </ModalPortal>
      )}
    </div>
  );
}
