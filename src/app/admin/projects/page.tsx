"use client";

import { useEffect, useState, useMemo } from "react";
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
import {
  sendExpoPushToWorkers,
  subscribeAdminChatNotifications,
  type ChatNotification,
} from "@/lib/chatNotifications";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { toast, confirmDialog, promptDialog } from "@/lib/admin/feedback";
import { logActivity } from "@/lib/admin/activity";

// ClickUp Components
import {
  Project,
  TaskRow,
  Worker,
  ProjectViewMode,
  getAssigneeIds,
  parseDate,
  SubtaskItem,
} from "@/components/admin/projects/types";
import ProjectHeaderBar from "@/components/admin/projects/ProjectHeaderBar";
import ProjectFilterToolbar from "@/components/admin/projects/ProjectFilterToolbar";
import ProjectListView from "@/components/admin/projects/ProjectListView";
import ProjectBoardView from "@/components/admin/projects/ProjectBoardView";
import ProjectCalendarView from "@/components/admin/projects/ProjectCalendarView";
import ProjectOverviewView from "@/components/admin/projects/ProjectOverviewView";
import TaskDetailDrawer from "@/components/admin/projects/TaskDetailDrawer";
import TaskModalForm from "@/components/admin/projects/TaskModalForm";
import ProjectModalForm from "@/components/admin/projects/ProjectModalForm";
import ProjectsHubView from "@/components/admin/projects/ProjectsHubView";

export default function AdminProjectsPage() {
  // Realtime Data
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [chatNotifications, setChatNotifications] = useState<ChatNotification[]>([]);

  // Navigation & Workspace State
  const [detailId, setDetailId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ProjectViewMode>("list");

  // Filtering, Searching, Grouping & Sorting inside Project
  const [taskSearch, setTaskSearch] = useState("");
  const [selectedWorkerId, setSelectedWorkerId] = useState("");
  const [selectedPriority, setSelectedPriority] = useState("all");
  const [selectedDepartment, setSelectedDepartment] = useState("all");
  const [groupBy, setGroupBy] = useState<"status" | "priority" | "none">("status");
  const [sortBy, setSortBy] = useState<"dueDate" | "priority" | "createdAt" | "title">("dueDate");
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<Date | null>(null);

  // Modals & Drawers State
  const [showCreateProject, setShowCreateProject] = useState(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("new") === "1";
  });
  const [editingProject, setEditingProject] = useState<Project | null>(null);

  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const activeTaskDrawer = useMemo(
    () => (activeTaskId ? tasks.find((t) => t.id === activeTaskId) ?? null : null),
    [tasks, activeTaskId]
  );
  const setActiveTaskDrawer = (task: TaskRow | null) => setActiveTaskId(task ? task.id : null);
  const [showCreateTask, setShowCreateTask] = useState(false);
  const [taskModalPrefill, setTaskModalPrefill] = useState<{
    status?: string;
    priority?: string;
    dueDate?: string;
  }>({});
  const [editingTaskModal, setEditingTaskModal] = useState<TaskRow | null>(null);

  // Deep link: /admin/projects?new=1 opens modal and cleans query param
  useEffect(() => {
    const checkNew = () => {
      if (typeof window === "undefined") return;
      const params = new URLSearchParams(window.location.search);
      if (params.get("new") === "1") {
        setShowCreateProject(true);
        window.history.replaceState(null, "", window.location.pathname);
      }
    };
    checkNew();
    window.addEventListener("popstate", checkNew);
    window.addEventListener("mft:urlsync", checkNew);
    return () => {
      window.removeEventListener("popstate", checkNew);
      window.removeEventListener("mft:urlsync", checkNew);
    };
  }, []);

  // 1. Subscribe to Projects
  useEffect(() => {
    return onSnapshot(collection(db, "projects"), (snap) => {
      const list: Project[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() } as Project));
      list.sort((a, b) => (b.createdAt?.toDate?.()?.getTime() ?? 0) - (a.createdAt?.toDate?.()?.getTime() ?? 0));
      setProjects(list);
    });
  }, []);

  // 2. Subscribe to Tasks
  useEffect(() => {
    return onSnapshot(collection(db, "tasks"), (snap) => {
      const list: TaskRow[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() } as TaskRow));
      list.sort((a, b) => (parseDate(b.createdAt)?.getTime() ?? 0) - (parseDate(a.createdAt)?.getTime() ?? 0));
      setTasks(list);
    });
  }, []);

  // 3. Subscribe to Workers
  useEffect(() => {
    return onSnapshot(collection(db, "workers"), (snap) => {
      const list: Worker[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() } as Worker));
      setWorkers(list);
    });
  }, []);

  // 4. Subscribe to Admin Chat Notifications
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

  // Unread counts mapped by Project ID & Task ID
  const unreadByProject = useMemo(() => {
    const map = new Map<string, number>();
    for (const notif of chatNotifications) {
      const task = tasks.find((t) => t.id === notif.taskId);
      if (task?.projectId) {
        map.set(task.projectId, (map.get(task.projectId) ?? 0) + 1);
      }
    }
    return map;
  }, [chatNotifications, tasks]);

  const unreadTaskIdSet = useMemo(() => {
    return new Set(chatNotifications.map((n) => n.taskId));
  }, [chatNotifications]);

  // Current Active Project
  const detailProject = useMemo(() => {
    return detailId ? projects.find((p) => p.id === detailId) || null : null;
  }, [detailId, projects]);

  // Tasks for Current Project
  const currentProjectTasks = useMemo(() => {
    if (!detailId) return [];
    return tasks.filter((t) => t.projectId === detailId);
  }, [detailId, tasks]);

  // Filtered and Sorted Tasks for Current Project View
  const filteredProjectTasks = useMemo(() => {
    let list = [...currentProjectTasks];

    // Search query
    const q = taskSearch.trim().toLowerCase();
    if (q) {
      list = list.filter((t) => {
        const titleMatch = (t.title || "").toLowerCase().includes(q);
        const descMatch = (t.description || "").toLowerCase().includes(q);
        const deptMatch = (t.department || "").toLowerCase().includes(q);
        return titleMatch || descMatch || deptMatch;
      });
    }

    // Assignee filter
    if (selectedWorkerId) {
      list = list.filter((t) => getAssigneeIds(t.assignedTo).includes(selectedWorkerId));
    }

    // Priority filter
    if (selectedPriority !== "all") {
      list = list.filter((t) => t.priority === selectedPriority);
    }

    // Department filter
    if (selectedDepartment !== "all") {
      list = list.filter((t) => (t.department || "general") === selectedDepartment);
    }

    // Sorting
    list.sort((a, b) => {
      if (sortBy === "priority") {
        const priorityOrder: Record<string, number> = { urgent: 4, high: 3, medium: 2, low: 1 };
        return (priorityOrder[b.priority] || 0) - (priorityOrder[a.priority] || 0);
      }
      if (sortBy === "dueDate") {
        const da = parseDate(a.dueDate)?.getTime() ?? 9999999999999;
        const dbTime = parseDate(b.dueDate)?.getTime() ?? 9999999999999;
        return da - dbTime;
      }
      if (sortBy === "title") {
        return (a.title || "").localeCompare(b.title || "");
      }
      // createdAt default
      const ca = parseDate(a.createdAt)?.getTime() ?? 0;
      const cb = parseDate(b.createdAt)?.getTime() ?? 0;
      return cb - ca;
    });

    return list;
  }, [currentProjectTasks, taskSearch, selectedWorkerId, selectedPriority, selectedDepartment, sortBy]);

  // ─── Handlers ───

  // Project CRUD
  const handleCreateProject = async (formData: {
    name: string;
    clientName: string;
    description: string;
    projectTypes: string[];
    status: string;
    startDate: string;
    endDate: string;
  }) => {
    const docRef = await addDoc(collection(db, "projects"), {
      name: formData.name,
      clientName: formData.clientName || null,
      description: formData.description,
      projectTypes: formData.projectTypes,
      status: formData.status,
      startDate: formData.startDate || null,
      endDate: formData.endDate || null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    setDetailId(docRef.id);
    toast.success("Project created", { description: formData.name });
    void logActivity({ action: "created", entity: "project", entityId: docRef.id, label: formData.name });
  };

  const handleEditProject = async (formData: {
    name: string;
    clientName: string;
    description: string;
    projectTypes: string[];
    status: string;
    startDate: string;
    endDate: string;
  }) => {
    if (!editingProject) return;
    await updateDoc(doc(db, "projects", editingProject.id), {
      name: formData.name,
      clientName: formData.clientName || null,
      description: formData.description,
      projectTypes: formData.projectTypes,
      status: formData.status,
      startDate: formData.startDate || null,
      endDate: formData.endDate || null,
      updatedAt: serverTimestamp(),
    });
    toast.success("Project updated");
    void logActivity({ action: "updated", entity: "project", entityId: editingProject.id, label: formData.name });
  };

  const handleDeleteProject = async (projectId: string) => {
    const linked = tasks.filter((t) => t.projectId === projectId);
    const proj = projects.find((p) => p.id === projectId);
    const ok = await confirmDialog({
      title: `Delete ${proj?.name ? `"${proj.name}"` : "this project"}?`,
      message:
        linked.length > 0
          ? `This project has ${linked.length} task(s). They will be permanently deleted too.`
          : "This action cannot be undone.",
      tone: "danger",
      confirmLabel: "Delete project",
      requireText: linked.length > 0 ? "DELETE" : undefined,
    });
    if (!ok) return;

    try {
      for (const t of linked) {
        await deleteDoc(doc(db, "tasks", t.id));
      }
      await deleteDoc(doc(db, "projects", projectId));
      if (detailId === projectId) setDetailId(null);
      toast.success("Project deleted", { description: linked.length ? `${linked.length} task(s) removed` : undefined });
      void logActivity({ action: "deleted", entity: "project", entityId: projectId, label: proj?.name || projectId, detail: linked.length ? `${linked.length} tasks` : undefined });
    } catch (err) {
      console.error(err);
      toast.error("Could not delete project");
    }
  };

  const handleToggleProjectStatus = async (projectId: string, currentStatus: string) => {
    const nextStatus = currentStatus === "completed" ? "active" : "completed";
    await updateDoc(doc(db, "projects", projectId), {
      status: nextStatus,
      updatedAt: serverTimestamp(),
    });
    const proj = projects.find((p) => p.id === projectId);
    toast.success(nextStatus === "completed" ? "Project marked complete" : "Project reopened");
    void logActivity({ action: "status", entity: "project", entityId: projectId, label: proj?.name || projectId, detail: nextStatus === "completed" ? "→ completed" : "→ reopened" });
  };

  // Task CRUD & Quick Actions
  const handleCreateTask = async (formData: {
    title: string;
    description: string;
    department: string;
    priority: string;
    status: string;
    dueDate: string;
    photo: string;
    workerIds: string[];
    notificationMessage: string;
    subtasks?: SubtaskItem[];
  }) => {
    if (!detailId) return;

    const assignedWorkerNames = formData.workerIds
      .map((id) => {
        const w = workers.find((x) => x.id === id);
        return w ? `${w.firstName} ${w.lastName}` : id;
      })
      .join(", ");

    const taskRef = await addDoc(collection(db, "tasks"), {
      projectId: detailId,
      projectName: detailProject?.name || "",
      title: formData.title,
      description: formData.description,
      department: formData.department,
      assignedTo: formData.workerIds.length === 1 ? formData.workerIds[0] : formData.workerIds,
      assignedWorkerName: assignedWorkerNames || "Unassigned",
      priority: formData.priority,
      status: formData.status || "assigned",
      dueDate: formData.dueDate ? new Date(formData.dueDate) : null,
      photo: formData.photo || null,
      subtasks: formData.subtasks || [],
      createdAt: serverTimestamp(),
      assignedAt: serverTimestamp(),
    });

    // If project was marked completed, reactive reopen
    if (detailProject && detailProject.status === "completed") {
      await updateDoc(doc(db, "projects", detailId), {
        status: "active",
        updatedAt: serverTimestamp(),
      });
    }

    // Send push notifications & alerts
    if (formData.workerIds.length > 0) {
      for (const workerId of formData.workerIds) {
        await addDoc(collection(db, "alerts"), {
          recipients: [workerId],
          title: `New Task in ${detailProject?.name || "Project"}`,
          message: formData.notificationMessage || `You have been assigned to: ${formData.title}`,
          type: "schedule",
          priority: formData.priority || "medium",
          isRead: false,
          createdAt: serverTimestamp(),
          sentAt: serverTimestamp(),
          sentBy: "Admin",
        });
      }

      void sendExpoPushToWorkers(db, {
        recipientUids: formData.workerIds,
        title: `New Task in ${detailProject?.name || "Project"}`,
        body: formData.notificationMessage || formData.title,
        taskId: taskRef.id,
        taskTitle: formData.title,
      }).catch(() => {});
    }
    toast.success("Task created", { description: formData.workerIds.length ? `Assigned to ${assignedWorkerNames}` : formData.title });
    void logActivity({ action: "created", entity: "task", entityId: taskRef.id, label: formData.title, detail: detailProject?.name });
  };

  const handleEditTaskFromModal = async (formData: {
    title: string;
    description: string;
    department: string;
    priority: string;
    status: string;
    dueDate: string;
    photo: string;
    workerIds: string[];
    notificationMessage: string;
    subtasks?: SubtaskItem[];
  }) => {
    if (!editingTaskModal) return;

    const assignedWorkerNames = formData.workerIds
      .map((id) => {
        const w = workers.find((x) => x.id === id);
        return w ? `${w.firstName} ${w.lastName}` : id;
      })
      .join(", ");

    await updateDoc(doc(db, "tasks", editingTaskModal.id), {
      title: formData.title,
      description: formData.description,
      department: formData.department,
      assignedTo: formData.workerIds.length === 1 ? formData.workerIds[0] : formData.workerIds,
      assignedWorkerName: assignedWorkerNames || "Unassigned",
      priority: formData.priority,
      status: formData.status,
      dueDate: formData.dueDate ? new Date(formData.dueDate) : null,
      photo: formData.photo || null,
      subtasks: formData.subtasks || [],
      updatedAt: serverTimestamp(),
    });

    if (formData.workerIds.length > 0 && formData.notificationMessage) {
      for (const workerId of formData.workerIds) {
        await addDoc(collection(db, "alerts"), {
          recipients: [workerId],
          title: "Task Directive Updated",
          message: formData.notificationMessage,
          type: "schedule",
          priority: formData.priority || "medium",
          isRead: false,
          createdAt: serverTimestamp(),
          sentAt: serverTimestamp(),
          sentBy: "Admin",
        });
      }
      void sendExpoPushToWorkers(db, {
        recipientUids: formData.workerIds,
        title: "Task Directive Updated",
        body: formData.notificationMessage,
        taskId: editingTaskModal.id,
        taskTitle: formData.title,
      }).catch(() => {});
    }
    toast.success("Task updated");
    void logActivity({ action: "updated", entity: "task", entityId: editingTaskModal.id, label: formData.title });
  };

  const handleUpdateTaskField = async (
    updatedFields: Partial<TaskRow>,
    notificationMsg?: string
  ) => {
    if (!activeTaskDrawer) return;

    await updateDoc(doc(db, "tasks", activeTaskDrawer.id), {
      ...updatedFields,
      updatedAt: serverTimestamp(),
    });

    if (notificationMsg) {
      const ids = getAssigneeIds(activeTaskDrawer.assignedTo);
      if (ids.length > 0) {
        void sendExpoPushToWorkers(db, {
          recipientUids: ids,
          title: `Update: ${activeTaskDrawer.title}`,
          body: notificationMsg,
          taskId: activeTaskDrawer.id,
          taskTitle: activeTaskDrawer.title,
        }).catch(() => {});
      }
    }
  };

  const handleQuickUpdateStatus = async (taskId: string, newStatus: string) => {
    try {
      await updateDoc(doc(db, "tasks", taskId), {
        status: newStatus,
        updatedAt: serverTimestamp(),
      });
      const t = tasks.find((x) => x.id === taskId);
      void logActivity({ action: "status", entity: "task", entityId: taskId, label: t?.title || taskId, detail: `→ ${newStatus}` });
    } catch {
      toast.error("Could not update status");
    }
  };

  const handleQuickUpdatePriority = async (taskId: string, newPriority: string) => {
    try {
      await updateDoc(doc(db, "tasks", taskId), {
        priority: newPriority,
        updatedAt: serverTimestamp(),
      });
    } catch {
      toast.error("Could not update priority");
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    const t = tasks.find((x) => x.id === taskId);
    const ok = await confirmDialog({
      title: `Delete ${t?.title ? `"${t.title}"` : "this task"}?`,
      message: "The task and its history will be permanently removed.",
      tone: "danger",
      confirmLabel: "Delete task",
    });
    if (!ok) return;
    try {
      await deleteDoc(doc(db, "tasks", taskId));
      if (activeTaskDrawer?.id === taskId) setActiveTaskDrawer(null);
      toast.success("Task deleted");
      void logActivity({ action: "deleted", entity: "task", entityId: taskId, label: t?.title || taskId });
    } catch {
      toast.error("Could not delete task");
    }
  };

  const handleApproveTask = async (task: TaskRow) => {
    try {
      await updateDoc(doc(db, "tasks", task.id), {
        status: "completed",
        approvedAt: serverTimestamp(),
        approvedBy: "admin",
        updatedAt: serverTimestamp(),
      });

      // Auto-check if all tasks for this project are complete
      if (task.projectId) {
        const otherTasks = tasks.filter((t) => t.projectId === task.projectId && t.id !== task.id);
        const allDone = otherTasks.length === 0 || otherTasks.every((t) => t.status === "completed");
        if (allDone) {
          void updateDoc(doc(db, "projects", task.projectId), {
            status: "completed",
            updatedAt: serverTimestamp(),
          }).catch(() => {});
        }
      }

      const ids = getAssigneeIds(task.assignedTo);
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
      toast.success("Task approved", { description: task.title });
      void logActivity({ action: "approved", entity: "task", entityId: task.id, label: task.title });
    } catch (err) {
      console.error("Failed to approve task:", err);
      toast.error("Failed to approve task");
    }
  };

  const handleRejectTask = async (task: TaskRow) => {
    const reason = await promptDialog({
      title: `Request changes on "${task.title}"`,
      message: "The task goes back to In progress and assignees are notified with your feedback.",
      placeholder: "What needs to be revised? (optional)",
      multiline: true,
      confirmLabel: "Send back",
    });
    if (reason === null) return;

    try {
      await updateDoc(doc(db, "tasks", task.id), {
        status: "in-progress",
        rejectedAt: serverTimestamp(),
        rejectedBy: "admin",
        rejectionReason: reason.trim() || "Needs revision",
        updatedAt: serverTimestamp(),
      });

      if (task.projectId) {
        void updateDoc(doc(db, "projects", task.projectId), {
          status: "active",
          updatedAt: serverTimestamp(),
        }).catch(() => {});
      }

      const ids = getAssigneeIds(task.assignedTo);
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
          body: `Task "${task.title}" rejected: ${reason.trim() || "Needs revision"}`,
          taskId: task.id,
          taskTitle: task.title,
        }).catch(() => {});
      }
      toast.warning("Changes requested", { description: task.title });
      void logActivity({ action: "rejected", entity: "task", entityId: task.id, label: task.title, detail: reason.trim() || "Needs revision" });
    } catch (err) {
      console.error("Failed to reject task:", err);
      toast.error("Failed to reject task");
    }
  };

  // ─── RENDER: Project Detail Workspace ───
  if (detailProject) {
    return (
      <div className="space-y-6">
        {/* Project Header Bar with Switcher, Status & View Tabs */}
        <ProjectHeaderBar
          project={detailProject}
          allProjects={projects}
          tasks={currentProjectTasks}
          workers={workers}
          viewMode={viewMode}
          onSelectViewMode={setViewMode}
          onBackToProjects={() => setDetailId(null)}
          onSelectProject={(pid) => setDetailId(pid)}
          onOpenCreateTask={() => {
            setTaskModalPrefill({});
            setShowCreateTask(true);
          }}
          onOpenEditProject={() => setEditingProject(detailProject)}
          onToggleProjectStatus={handleToggleProjectStatus}
          onDeleteProject={handleDeleteProject}
        />

        {/* Filter and Group Toolbar (For List & Board views) */}
        {(viewMode === "list" || viewMode === "board") && (
          <ProjectFilterToolbar
            search={taskSearch}
            onSearchChange={setTaskSearch}
            selectedWorkerId={selectedWorkerId}
            onSelectWorkerId={setSelectedWorkerId}
            selectedPriority={selectedPriority}
            onSelectPriority={setSelectedPriority}
            selectedDepartment={selectedDepartment}
            onSelectDepartment={setSelectedDepartment}
            groupBy={groupBy}
            onGroupByChange={setGroupBy}
            sortBy={sortBy}
            onSortByChange={setSortBy}
            workers={workers}
            onOpenCreateTask={() => {
              setTaskModalPrefill({});
              setShowCreateTask(true);
            }}
            totalFilteredCount={filteredProjectTasks.length}
          />
        )}

        {/* View Mode 1: List View */}
        {viewMode === "list" && (
          <ProjectListView
            tasks={filteredProjectTasks}
            workers={workers}
            groupBy={groupBy}
            unreadTaskIdSet={unreadTaskIdSet}
            onSelectTask={(task) => setActiveTaskDrawer(task)}
            onOpenEditTask={(task) => setEditingTaskModal(task)}
            onDeleteTask={handleDeleteTask}
            onApproveTask={handleApproveTask}
            onRejectTask={handleRejectTask}
            onQuickUpdateStatus={handleQuickUpdateStatus}
            onQuickUpdatePriority={handleQuickUpdatePriority}
            onQuickAddTask={(prefill) => {
              setTaskModalPrefill(prefill);
              setShowCreateTask(true);
            }}
          />
        )}

        {/* View Mode 2: Board (Kanban) View */}
        {viewMode === "board" && (
          <ProjectBoardView
            tasks={filteredProjectTasks}
            workers={workers}
            unreadTaskIdSet={unreadTaskIdSet}
            onSelectTask={(task) => setActiveTaskDrawer(task)}
            onOpenEditTask={(task) => setEditingTaskModal(task)}
            onDeleteTask={handleDeleteTask}
            onApproveTask={handleApproveTask}
            onRejectTask={handleRejectTask}
            onQuickUpdateStatus={handleQuickUpdateStatus}
            onQuickAddTask={(prefill) => {
              setTaskModalPrefill(prefill);
              setShowCreateTask(true);
            }}
          />
        )}

        {/* View Mode 3: Calendar View */}
        {viewMode === "calendar" && (
          <ProjectCalendarView
            tasks={currentProjectTasks}
            workers={workers}
            selectedDate={selectedCalendarDate}
            onSelectDate={setSelectedCalendarDate}
            onSelectTask={(task) => setActiveTaskDrawer(task)}
            onOpenCreateTask={(prefillDate) => {
              setTaskModalPrefill({ dueDate: prefillDate });
              setShowCreateTask(true);
            }}
          />
        )}

        {/* View Mode 4: Overview / Dashboard View */}
        {viewMode === "overview" && (
          <ProjectOverviewView
            project={detailProject}
            tasks={currentProjectTasks}
            workers={workers}
            onSelectTask={(task) => setActiveTaskDrawer(task)}
            onApproveTask={handleApproveTask}
            onRejectTask={handleRejectTask}
            onOpenCreateTask={() => {
              setTaskModalPrefill({});
              setShowCreateTask(true);
            }}
          />
        )}

        {/* Task Detail Inspector Drawer / Modal */}
        {activeTaskDrawer && (
          <TaskDetailDrawer
            task={activeTaskDrawer}
            workers={workers}
            projectName={detailProject.name}
            onClose={() => setActiveTaskDrawer(null)}
            onUpdateTask={handleUpdateTaskField}
            onApproveTask={handleApproveTask}
            onRejectTask={handleRejectTask}
            onDeleteTask={handleDeleteTask}
          />
        )}

        {/* Create Task Modal */}
        {showCreateTask && (
          <TaskModalForm
            projectName={detailProject.name}
            prefillStatus={taskModalPrefill.status}
            prefillPriority={taskModalPrefill.priority}
            prefillDueDate={taskModalPrefill.dueDate}
            workers={workers}
            onClose={() => setShowCreateTask(false)}
            onSubmit={handleCreateTask}
          />
        )}

        {/* Edit Task Modal */}
        {editingTaskModal && (
          <TaskModalForm
            initialTask={editingTaskModal}
            projectName={detailProject.name}
            workers={workers}
            onClose={() => setEditingTaskModal(null)}
            onSubmit={handleEditTaskFromModal}
          />
        )}

        {/* Edit Project Modal */}
        {editingProject && (
          <ProjectModalForm
            initialProject={editingProject}
            onClose={() => setEditingProject(null)}
            onSubmit={handleEditProject}
          />
        )}
      </div>
    );
  }

  // ─── RENDER: Projects Hub (All Projects Workspace) ───
  return (
    <div className="space-y-6">
      <ProjectsHubView
        projects={projects}
        tasks={tasks}
        workers={workers}
        unreadByProject={unreadByProject}
        onSelectProject={(pid) => {
          setDetailId(pid);
          setViewMode("list");
        }}
        onOpenCreateProject={() => setShowCreateProject(true)}
        onOpenEditProject={(p) => setEditingProject(p)}
        onDeleteProject={handleDeleteProject}
        onOpenCreateTaskForProject={(p) => {
          setDetailId(p.id);
          setTaskModalPrefill({});
          setShowCreateTask(true);
        }}
        onToggleProjectStatus={handleToggleProjectStatus}
      />

      {/* Create Project Modal */}
      {showCreateProject && (
        <ProjectModalForm
          onClose={() => setShowCreateProject(false)}
          onSubmit={handleCreateProject}
        />
      )}

      {/* Edit Project Modal */}
      {editingProject && (
        <ProjectModalForm
          initialProject={editingProject}
          onClose={() => setEditingProject(null)}
          onSubmit={handleEditProject}
        />
      )}
    </div>
  );
}
