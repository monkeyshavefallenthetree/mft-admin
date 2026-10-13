"use client";

import { toast } from "@/lib/admin/feedback";
import { useEffect, useRef, useState } from "react";
import {
  TaskRow,
  Worker,
  STATUS_CONFIG,
  PRIORITY_CONFIG,
  getAssigneeIds,
  parseDate,
  SubtaskItem,
  sanitizeSubtask,
  sanitizeSubtasks,
} from "./types";
import { subscribeTaskChat, sendTaskMessage, type ChatMessage } from "@/lib/taskChat";
import {
  sendChatNotificationToWorkers,
  sendExpoPushToWorkers,
  markTaskChatNotificationsReadForAdmin,
} from "@/lib/chatNotifications";
import { db } from "@/lib/firebase";
import { getAuth } from "firebase/auth";
import { TASK_DEPARTMENTS } from "@/lib/admin/constants";
import ModalPortal from "@/components/admin/ui/ModalPortal";
import LinkifiedText from "@/components/admin/ui/LinkifiedText";

interface Props {
  task: TaskRow;
  workers: Worker[];
  projectName?: string;
  onClose: () => void;
  onUpdateTask: (updatedFields: Partial<TaskRow>, notificationMsg?: string) => Promise<void>;
  onApproveTask: (task: TaskRow) => Promise<void>;
  onRejectTask: (task: TaskRow) => Promise<void>;
  onDeleteTask: (taskId: string) => Promise<void>;
}

function formatExternalUrl(url?: string): string {
  if (!url) return "";
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export default function TaskDetailDrawer({
  task,
  workers,
  projectName,
  onClose,
  onUpdateTask,
  onApproveTask,
  onRejectTask,
  onDeleteTask,
}: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [isEditingDesc, setIsEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState(task.description);
  const [activeTab, setActiveTab] = useState<"chat" | "assignees" | "details">("chat");
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const [pushAlertInput, setPushAlertInput] = useState("");
  const [isSendingAlert, setIsSendingAlert] = useState(false);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");
  const [newSubtaskDesc, setNewSubtaskDesc] = useState("");
  const [newSubtaskLink, setNewSubtaskLink] = useState("");
  const [editingSubtaskId, setEditingSubtaskId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editLink, setEditLink] = useState("");
  const [subtasksBusy, setSubtasksBusy] = useState(false);

  const chatBottomRef = useRef<HTMLDivElement>(null);

  // Sync state when task changes
  useEffect(() => {
    setTitleDraft(task.title);
    setDescDraft(task.description);
  }, [task]);

  // Subscribe to Live Task Chat
  useEffect(() => {
    markTaskChatNotificationsReadForAdmin(db, task.id).catch(() => {});
    const unsub = subscribeTaskChat(db, task.id, (msgs) => {
      setMessages(msgs);
      markTaskChatNotificationsReadForAdmin(db, task.id).catch(() => {});
      setTimeout(() => {
        chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 50);
    });
    return () => unsub();
  }, [task.id]);

  const handleSendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    setChatBusy(true);
    try {
      const admin = getAuth().currentUser;
      const senderUid = admin?.uid ?? "admin";
      const senderName = admin?.displayName || admin?.email || "Admin";

      await sendTaskMessage(db, task.id, {
        text: chatInput,
        senderUid,
        senderName,
        senderRole: "admin",
      });

      const recipientUids = getAssigneeIds(task.assignedTo);
      if (recipientUids.length > 0) {
        void sendChatNotificationToWorkers(db, {
          recipientUids,
          taskId: task.id,
          taskTitle: task.title || "Task",
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

  const handleSaveTitle = async () => {
    if (!titleDraft.trim() || titleDraft === task.title) {
      setIsEditingTitle(false);
      return;
    }
    await onUpdateTask({ title: titleDraft.trim() });
    setIsEditingTitle(false);
  };

  const handleSaveDesc = async () => {
    if (descDraft === task.description) {
      setIsEditingDesc(false);
      return;
    }
    await onUpdateTask({ description: descDraft.trim() });
    setIsEditingDesc(false);
  };

  const handleToggleAssignee = async (workerId: string) => {
    const currentIds = getAssigneeIds(task.assignedTo);
    const set = new Set(currentIds);
    if (set.has(workerId)) set.delete(workerId);
    else set.add(workerId);

    const nextIds = Array.from(set);
    const assignedWorkerNames = nextIds
      .map((id) => {
        const w = workers.find((x) => x.id === id);
        return w ? `${w.firstName} ${w.lastName}` : id;
      })
      .join(", ");

    await onUpdateTask({
      assignedTo: nextIds.length === 1 ? nextIds[0] : nextIds,
      assignedWorkerName: assignedWorkerNames || "Unassigned",
    });
  };

  const handleSendCustomAlert = async () => {
    if (!pushAlertInput.trim()) return;
    setIsSendingAlert(true);
    try {
      const recipientUids = getAssigneeIds(task.assignedTo);
      if (recipientUids.length > 0) {
        await sendExpoPushToWorkers(db, {
          recipientUids,
          title: `Update: ${task.title}`,
          body: pushAlertInput.trim(),
          taskId: task.id,
          taskTitle: task.title,
        });
        toast.success("Push alert sent", { description: "Assigned workers were notified." });
        setPushAlertInput("");
      }
    } catch {
      toast.error("Failed to send alert");
    } finally {
      setIsSendingAlert(false);
    }
  };

  const handleToggleSubtask = async (subtaskId: string) => {
    if (subtasksBusy) return;
    setSubtasksBusy(true);
    try {
      const currentSubtasks: SubtaskItem[] = sanitizeSubtasks(task.subtasks);
      const updated = currentSubtasks.map((st) =>
        st.id === subtaskId ? { ...st, completed: !st.completed } : st
      );
      await onUpdateTask({ subtasks: sanitizeSubtasks(updated) });
    } catch (err) {
      console.error("Failed to toggle subtask:", err);
      toast.error("Failed to update checklist item");
    } finally {
      setSubtasksBusy(false);
    }
  };

  const handleAddSubtask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubtaskTitle.trim() || subtasksBusy) return;
    setSubtasksBusy(true);
    try {
      const currentSubtasks: SubtaskItem[] = sanitizeSubtasks(task.subtasks);
      const newSubtask = sanitizeSubtask({
        title: newSubtaskTitle,
        description: newSubtaskDesc,
        link: newSubtaskLink,
        completed: false,
      });
      const updated = [...currentSubtasks, newSubtask];
      await onUpdateTask({ subtasks: sanitizeSubtasks(updated) });
      setNewSubtaskTitle("");
      setNewSubtaskDesc("");
      setNewSubtaskLink("");
      toast.success("Checklist item added");
    } catch (err) {
      console.error("Failed to add subtask:", err);
      toast.error("Failed to add checklist item");
    } finally {
      setSubtasksBusy(false);
    }
  };

  const handleStartEditSubtask = (st: SubtaskItem) => {
    setEditingSubtaskId(st.id);
    setEditTitle(st.title);
    setEditDesc(st.description || "");
    setEditLink(st.link || "");
  };

  const handleSaveEditSubtask = async () => {
    if (!editingSubtaskId || !editTitle.trim() || subtasksBusy) return;
    setSubtasksBusy(true);
    try {
      const currentSubtasks: SubtaskItem[] = sanitizeSubtasks(task.subtasks);
      const updated = currentSubtasks.map((st) =>
        st.id === editingSubtaskId
          ? sanitizeSubtask({
              ...st,
              title: editTitle,
              description: editDesc,
              link: editLink,
            })
          : st
      );
      await onUpdateTask({ subtasks: sanitizeSubtasks(updated) });
      setEditingSubtaskId(null);
      setEditTitle("");
      setEditDesc("");
      setEditLink("");
      toast.success("Checklist item updated");
    } catch (err) {
      console.error("Failed to update subtask:", err);
      toast.error("Failed to update checklist item");
    } finally {
      setSubtasksBusy(false);
    }
  };

  const handleCancelEditSubtask = () => {
    setEditingSubtaskId(null);
    setEditTitle("");
    setEditDesc("");
    setEditLink("");
  };

  const handleDeleteSubtask = async (subtaskId: string) => {
    if (subtasksBusy) return;
    setSubtasksBusy(true);
    try {
      const currentSubtasks: SubtaskItem[] = sanitizeSubtasks(task.subtasks);
      const updated = currentSubtasks.filter((st) => st.id !== subtaskId);
      await onUpdateTask({ subtasks: sanitizeSubtasks(updated) });
      toast.success("Checklist item removed");
    } catch (err) {
      console.error("Failed to delete subtask:", err);
      toast.error("Failed to remove checklist item");
    } finally {
      setSubtasksBusy(false);
    }
  };

  const assignedIds = getAssigneeIds(task.assignedTo);
  const approvedWorkers = workers.filter((w) => w.status === "approved");
  const isPending = task.status === "pending-approval";
  const subtasksList = task.subtasks || [];
  const completedSubtasksCount = subtasksList.filter((s) => s.completed).length;
  const subtasksPercent = subtasksList.length > 0 ? Math.round((completedSubtasksCount / subtasksList.length) * 100) : 0;

  return (
    <ModalPortal onClose={onClose}>
      <div
        className="fixed inset-0 z-[120] bg-zinc-950/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 overflow-y-auto animate-fade-in"
        onClick={onClose}
      >
        <div
          className="bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-700 shadow-2xl rounded-xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden text-zinc-950 dark:text-zinc-100 font-sans animate-scale-in"
          onClick={(e) => e.stopPropagation()}
        >
        {/* Drawer Top Header Bar */}
        <div className="px-6 py-3.5 bg-zinc-50 border-b-2 border-zinc-900 flex items-center justify-between gap-4 flex-wrap">
          {/* Breadcrumb & Task Status Dropdown */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[11px] font-mono font-bold uppercase text-zinc-500">
              {projectName || "Project"} / Task #{task.id.slice(-6)}
            </span>

            {/* ClickUp Status Dropdown */}
            <select
              value={task.status}
              onChange={(e) => onUpdateTask({ status: e.target.value })}
              className={`px-2.5 py-1 rounded text-xs font-bold uppercase tracking-wider border cursor-pointer ${
                STATUS_CONFIG[task.status]?.badge || "bg-zinc-100 text-zinc-800 border-zinc-300"
              }`}
            >
              <option value="assigned">TO DO / ASSIGNED</option>
              <option value="in-progress">IN PROGRESS</option>
              <option value="pending-approval">PENDING REVIEW</option>
              <option value="completed">COMPLETED</option>
            </select>

            {/* Priority Selector */}
            <select
              value={task.priority}
              onChange={(e) => onUpdateTask({ priority: e.target.value })}
              className={`px-2 py-1 rounded text-xs font-bold uppercase tracking-wider border cursor-pointer ${
                PRIORITY_CONFIG[task.priority]?.badge || "bg-zinc-100 text-zinc-800 border-zinc-300"
              }`}
            >
              <option value="urgent">🔴 Urgent</option>
              <option value="high">🟠 High</option>
              <option value="medium">🔵 Normal</option>
              <option value="low">⚪ Low</option>
            </select>

            {/* Department Selector */}
            <select
              value={task.department || "general"}
              onChange={(e) => onUpdateTask({ department: e.target.value })}
              className="px-2 py-1 rounded text-xs font-mono font-bold uppercase bg-zinc-100 border border-zinc-300 text-zinc-700 cursor-pointer"
            >
              {TASK_DEPARTMENTS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          {/* Close & Delete */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onDeleteTask(task.id)}
              className="px-2.5 py-1 text-xs font-bold uppercase text-red-700 hover:bg-red-50 border border-red-300 rounded cursor-pointer transition-colors"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={onClose}
              className="w-7 h-7 rounded bg-zinc-200 hover:bg-zinc-900 hover:text-white flex items-center justify-center text-sm font-bold transition-colors cursor-pointer"
            >
              &times;
            </button>
          </div>
        </div>

        {/* Drawer Body (Dual Column) */}
        <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-12">
          {/* Left Column: Directive Content & Proof (7 Cols) */}
          <div className="lg:col-span-7 p-6 overflow-y-auto space-y-5 border-b lg:border-b-0 lg:border-r border-zinc-200">
            {/* Title */}
            <div>
              {isEditingTitle ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSaveTitle();
                      if (e.key === "Escape") setIsEditingTitle(false);
                    }}
                    autoFocus
                    className="w-full text-xl font-oswald font-bold uppercase px-2 py-1 border-2 border-red-600 rounded"
                  />
                  <button
                    type="button"
                    onClick={handleSaveTitle}
                    className="px-3 py-1 bg-red-600 text-white font-bold text-xs uppercase rounded cursor-pointer"
                  >
                    Save
                  </button>
                </div>
              ) : (
                <div
                  className="group flex items-start justify-between gap-2 cursor-pointer"
                  onClick={() => setIsEditingTitle(true)}
                >
                  <h2 className="text-2xl font-oswald font-bold uppercase text-zinc-950 tracking-wide">
                    {task.title}
                  </h2>
                  <span className="opacity-0 group-hover:opacity-100 text-xs text-red-600 font-bold uppercase mt-1">
                    ✏️ Edit
                  </span>
                </div>
              )}
            </div>

            {/* Pending Review Decision Banner */}
            {isPending && (
              <div className="bg-amber-50 border-2 border-amber-500 rounded-lg p-4 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">⚠️</span>
                    <div>
                      <h4 className="font-oswald text-base font-bold uppercase tracking-wider text-amber-950">
                        Submitted For Approval
                      </h4>
                      <p className="text-xs text-amber-900 font-mono">
                        Assigned worker has marked this directive as ready for review.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 pt-2 border-t border-amber-200">
                  <button
                    type="button"
                    onClick={() => onApproveTask(task)}
                    className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold font-mono text-xs uppercase tracking-wider rounded shadow-xs cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    <span>✓ Approve &amp; Mark Complete</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onRejectTask(task)}
                    className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white font-bold font-mono text-xs uppercase tracking-wider rounded shadow-xs cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    <span>✕ Reject With Feedback</span>
                  </button>
                </div>
              </div>
            )}

            {/* Rejection Note if exists */}
            {task.rejectionReason && (
              <div className="bg-red-50 border border-red-300 rounded p-3 text-xs text-red-800 space-y-1">
                <span className="font-bold uppercase tracking-wider block">⚠️ Last Rejection Feedback:</span>
                <p className="font-mono">{task.rejectionReason}</p>
              </div>
            )}

            {/* Description Section */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[10px] font-bold font-mono uppercase tracking-widest text-zinc-500">
                  Directive Description
                </label>
                {!isEditingDesc && (
                  <button
                    type="button"
                    onClick={() => setIsEditingDesc(true)}
                    className="text-[10px] font-bold uppercase text-red-600 hover:underline cursor-pointer"
                  >
                    Edit Description
                  </button>
                )}
              </div>

              {isEditingDesc ? (
                <div className="space-y-2">
                  <textarea
                    rows={5}
                    value={descDraft}
                    onChange={(e) => setDescDraft(e.target.value)}
                    className="w-full text-xs font-mono p-3 border-2 border-zinc-900 rounded bg-zinc-50 focus:bg-white focus:outline-none"
                  />
                  <div className="flex items-center gap-2 justify-end">
                    <button
                      type="button"
                      onClick={() => setIsEditingDesc(false)}
                      className="px-3 py-1 border border-zinc-300 rounded text-xs font-bold uppercase cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveDesc}
                      className="px-3 py-1 bg-red-600 text-white rounded text-xs font-bold uppercase cursor-pointer"
                    >
                      Save Description
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  onClick={() => setIsEditingDesc(true)}
                  className="p-3.5 bg-zinc-50 border border-zinc-200 rounded text-xs text-zinc-800 font-mono leading-relaxed whitespace-pre-wrap cursor-pointer hover:bg-zinc-100/70 transition-colors"
                >
                  {task.description ? (
                    <LinkifiedText text={task.description} />
                  ) : (
                    <span className="italic text-zinc-400">Click to add directive description...</span>
                  )}
                </div>
              )}
            </div>

            {/* Subtasks / Directive Checklist Section */}
            <div className="border border-zinc-200 rounded-lg p-4 bg-zinc-50/70 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm">☑</span>
                  <h4 className="text-xs font-bold font-mono uppercase tracking-wider text-zinc-950">
                    Checklist &amp; Subtasks
                  </h4>
                  {subtasksList.length > 0 && (
                    <span className="text-[10px] font-mono font-bold text-zinc-600 bg-zinc-200 px-2 py-0.5 rounded">
                      {completedSubtasksCount}/{subtasksList.length} ({subtasksPercent}%)
                    </span>
                  )}
                </div>
              </div>

              {/* Progress bar */}
              {subtasksList.length > 0 && (
                <div className="h-1.5 w-full bg-zinc-200 rounded-full overflow-hidden">
                  <div
                    style={{ width: `${subtasksPercent}%` }}
                    className="h-full bg-emerald-600 transition-all duration-300"
                  />
                </div>
              )}

              {/* Subtasks List */}
              <div className="space-y-2">
                {subtasksList.map((st) => {
                  const isEditing = editingSubtaskId === st.id;
                  if (isEditing) {
                    return (
                      <div key={st.id} className="p-3 bg-white border-2 border-red-500 rounded-md space-y-2 shadow-xs">
                        <input
                          type="text"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          placeholder="Subtask title (required)"
                          className="w-full text-xs font-mono px-2.5 py-1.5 border border-zinc-300 rounded focus:border-red-600 focus:outline-none"
                          autoFocus
                        />
                        <input
                          type="text"
                          value={editDesc}
                          onChange={(e) => setEditDesc(e.target.value)}
                          placeholder="Description or notes (optional)"
                          className="w-full text-[11px] font-mono px-2.5 py-1.5 border border-zinc-200 rounded focus:border-red-600 focus:outline-none text-zinc-700"
                        />
                        <input
                          type="text"
                          value={editLink}
                          onChange={(e) => setEditLink(e.target.value)}
                          placeholder="Link URL (e.g. figma.com/... or PR link, optional)"
                          className="w-full text-[11px] font-mono px-2.5 py-1.5 border border-zinc-200 rounded focus:border-red-600 focus:outline-none text-blue-700"
                        />
                        <div className="flex justify-end gap-1.5 pt-1">
                          <button
                            type="button"
                            onClick={handleCancelEditSubtask}
                            className="text-[10px] font-mono px-2.5 py-1 rounded border border-zinc-300 hover:bg-zinc-100 text-zinc-600 cursor-pointer"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={handleSaveEditSubtask}
                            disabled={!editTitle.trim()}
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
                            onChange={() => handleToggleSubtask(st.id)}
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
                                  className="inline-flex items-center gap-1.5 text-[10px] font-mono font-semibold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-2 py-0.5 rounded transition-colors group/link cursor-pointer max-w-full truncate"
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
                            onClick={() => handleStartEditSubtask(st)}
                            className="p-1 text-zinc-400 hover:text-zinc-800 hover:bg-zinc-100 rounded text-xs cursor-pointer transition-colors"
                            title="Edit subtask"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteSubtask(st.id)}
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

                {subtasksList.length === 0 && (
                  <p className="text-xs font-mono text-zinc-400 italic py-1">No subtasks or checklist steps yet.</p>
                )}
              </div>

              {/* Add Subtask Form */}
              <form onSubmit={handleAddSubtask} className="bg-white border border-zinc-200 rounded-md p-2.5 space-y-2">
                <input
                  type="text"
                  value={newSubtaskTitle}
                  onChange={(e) => setNewSubtaskTitle(e.target.value)}
                  placeholder="+ Subtask title (required)..."
                  className="w-full text-xs font-mono px-2.5 py-1.5 border border-zinc-300 rounded focus:outline-none focus:border-red-600"
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={newSubtaskDesc}
                    onChange={(e) => setNewSubtaskDesc(e.target.value)}
                    placeholder="Description / criteria (optional)..."
                    className="text-[11px] font-mono px-2.5 py-1.5 border border-zinc-200 rounded focus:outline-none focus:border-red-600 text-zinc-700 placeholder:text-zinc-400"
                  />
                  <input
                    type="text"
                    value={newSubtaskLink}
                    onChange={(e) => setNewSubtaskLink(e.target.value)}
                    placeholder="Link URL (e.g. figma.com/..., optional)"
                    className="text-[11px] font-mono px-2.5 py-1.5 border border-zinc-200 rounded focus:outline-none focus:border-red-600 text-zinc-700 placeholder:text-zinc-400"
                  />
                </div>
                <div className="flex justify-end pt-0.5">
                  <button
                    type="submit"
                    disabled={!newSubtaskTitle.trim()}
                    className="px-3 py-1.5 bg-zinc-900 hover:bg-black text-white text-xs font-mono font-bold uppercase rounded disabled:opacity-40 cursor-pointer shadow-xs transition-colors"
                  >
                    + Add Subtask
                  </button>
                </div>
              </form>
            </div>

            {/* Proof / Attached Photo Gallery */}
            {task.photo && (
              <div>
                <label className="text-[10px] font-bold font-mono uppercase tracking-widest text-zinc-500 block mb-2">
                  Proof of Work / Inspection Media
                </label>
                <div className="relative group rounded-lg overflow-hidden border-2 border-zinc-900 shadow-[3px_3px_0px_0px_#09090b] max-w-md">
                  <img
                    src={task.photo}
                    alt="Task submission proof"
                    className="w-full max-h-64 object-cover cursor-pointer group-hover:scale-102 transition-transform"
                    onClick={() => setZoomedImage(task.photo || null)}
                  />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                    <span className="px-3 py-1 bg-white text-zinc-950 font-bold font-mono text-xs uppercase rounded shadow">
                      🔍 Click to Zoom Full Screen
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Quick Dispatch Worker Mobile Alert */}
            <div className="p-3.5 bg-zinc-50 border border-zinc-200 rounded-lg space-y-2">
              <label className="text-[10px] font-bold font-mono uppercase tracking-widest text-zinc-500 block">
                Dispatch Mobile Push Alert to Assigned Workers
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={pushAlertInput}
                  onChange={(e) => setPushAlertInput(e.target.value)}
                  placeholder="Notification text sent to worker device..."
                  className="flex-1 text-xs px-3 py-1.5 bg-white border border-zinc-300 rounded font-mono"
                />
                <button
                  type="button"
                  onClick={handleSendCustomAlert}
                  disabled={isSendingAlert || !pushAlertInput.trim()}
                  className="px-3 py-1.5 bg-zinc-900 hover:bg-black text-white text-xs font-bold uppercase rounded disabled:opacity-40 cursor-pointer"
                >
                  {isSendingAlert ? "..." : "Send Alert"}
                </button>
              </div>
            </div>
          </div>

          {/* Right Column: Metadata & Comms Chat (5 Cols) */}
          <div className="lg:col-span-5 bg-zinc-50 flex flex-col h-full overflow-hidden">
            {/* Tabs */}
            <div className="px-4 pt-3 border-b border-zinc-200 flex items-center gap-2 bg-zinc-100/70">
              <button
                type="button"
                onClick={() => setActiveTab("chat")}
                className={`px-3 py-2 text-xs font-bold uppercase tracking-wider border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
                  activeTab === "chat"
                    ? "border-red-600 text-red-600 font-bold"
                    : "border-transparent text-zinc-500 hover:text-zinc-900"
                }`}
              >
                <span>💬 Live Comms</span>
                {messages.length > 0 && (
                  <span className="text-[10px] px-1.5 py-0.2 bg-zinc-200 text-zinc-700 rounded-full font-mono">
                    {messages.length}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("assignees")}
                className={`px-3 py-2 text-xs font-bold uppercase tracking-wider border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
                  activeTab === "assignees"
                    ? "border-red-600 text-red-600 font-bold"
                    : "border-transparent text-zinc-500 hover:text-zinc-900"
                }`}
              >
                <span>👤 Assignees ({assignedIds.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("details")}
                className={`px-3 py-2 text-xs font-bold uppercase tracking-wider border-b-2 transition-all cursor-pointer ${
                  activeTab === "details"
                    ? "border-red-600 text-red-600 font-bold"
                    : "border-transparent text-zinc-500 hover:text-zinc-900"
                }`}
              >
                <span>📅 Schedule</span>
              </button>
            </div>

            {/* Tab 1: Live Chat Comms Stream */}
            {activeTab === "chat" && (
              <div className="flex-1 flex flex-col justify-between overflow-hidden p-4">
                {/* Messages List */}
                <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 max-h-[380px]">
                  {messages.length === 0 ? (
                    <div className="py-12 text-center text-xs text-zinc-400 font-mono italic">
                      No communication records yet. Send a direct message to assigned workers below.
                    </div>
                  ) : (
                    messages.map((m) => {
                      const isAdmin = m.senderRole === "admin";
                      const timeStr = m.createdAt?.toDate?.()?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

                      return (
                        <div
                          key={m.id}
                          className={`flex flex-col ${isAdmin ? "items-end" : "items-start"}`}
                        >
                          <div
                            className={`max-w-[85%] px-3 py-2 rounded-lg text-xs leading-relaxed font-mono shadow-xs border ${
                              isAdmin
                                ? "bg-red-600 text-white border-red-700"
                                : "bg-white text-zinc-950 border-zinc-300"
                            }`}
                          >
                            {m.text}
                          </div>
                          <span className="text-[9px] text-zinc-400 font-mono mt-0.5 uppercase">
                            {isAdmin ? "Admin (You)" : m.senderName} · {timeStr || "Just now"}
                          </span>
                        </div>
                      );
                    })
                  )}
                  <div ref={chatBottomRef} />
                </div>

                {/* Input Bar */}
                <form onSubmit={handleSendChat} className="mt-3 pt-3 border-t border-zinc-200 flex gap-2">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Message assigned workers..."
                    disabled={chatBusy}
                    className="flex-1 text-xs px-3 py-2 bg-white border border-zinc-300 rounded font-mono focus:outline-none focus:border-red-600"
                  />
                  <button
                    type="submit"
                    disabled={chatBusy || !chatInput.trim()}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold uppercase rounded disabled:opacity-40 cursor-pointer shadow-xs"
                  >
                    {chatBusy ? "..." : "Send"}
                  </button>
                </form>
              </div>
            )}

            {/* Tab 2: Assignees Manager */}
            {activeTab === "assignees" && (
              <div className="p-4 space-y-3 overflow-y-auto flex-1">
                <p className="text-[10px] font-mono font-bold uppercase text-zinc-500">
                  Select Workers to Assign
                </p>
                <div className="space-y-1.5 max-h-[380px] overflow-y-auto">
                  {approvedWorkers.map((w) => {
                    const isAssigned = assignedIds.includes(w.id);
                    return (
                      <label
                        key={w.id}
                        className={`flex items-center justify-between p-2.5 rounded border cursor-pointer transition-colors ${
                          isAssigned
                            ? "bg-red-50 border-red-300 text-red-950 font-bold"
                            : "bg-white border-zinc-200 text-zinc-800 hover:bg-zinc-100"
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <input
                            type="checkbox"
                            checked={isAssigned}
                            onChange={() => handleToggleAssignee(w.id)}
                            className="accent-red-600 w-4 h-4 cursor-pointer"
                          />
                          <div>
                            <p className="text-xs uppercase">{w.firstName} {w.lastName}</p>
                            {w.role && <p className="text-[10px] text-zinc-500 font-mono">{w.role}</p>}
                          </div>
                        </div>
                        {isAssigned && (
                          <span className="text-[9px] font-bold text-red-700 uppercase bg-red-100 px-1.5 py-0.2 rounded">
                            Assigned
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Tab 3: Timeline & Schedule Details */}
            {activeTab === "details" && (
              <div className="p-4 space-y-4 overflow-y-auto flex-1 text-xs font-mono">
                {/* Due Date Picker */}
                <div>
                  <label className="text-[10px] font-bold uppercase text-zinc-500 block mb-1">
                    Directive Due Date
                  </label>
                  <input
                    type="date"
                    value={
                      task.dueDate
                        ? (() => {
                            const d = parseDate(task.dueDate);
                            if (!d) return "";
                            const pad = (n: number) => n.toString().padStart(2, "0");
                            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
                          })()
                        : ""
                    }
                    onChange={(e) => {
                      onUpdateTask({
                        dueDate: e.target.value ? new Date(e.target.value) : null,
                      });
                    }}
                    className="w-full p-2 bg-white border border-zinc-300 rounded font-mono text-xs"
                  />
                </div>

                {/* Timestamps */}
                <div className="space-y-2 pt-2 border-t border-zinc-200">
                  <div>
                    <span className="text-zinc-500 block text-[10px] uppercase">Created At</span>
                    <span className="text-zinc-800 font-bold">
                      {parseDate(task.createdAt)?.toLocaleString() || "—"}
                    </span>
                  </div>

                  {task.startedAt && (
                    <div>
                      <span className="text-zinc-500 block text-[10px] uppercase">Work Started</span>
                      <span className="text-zinc-800 font-bold">
                        {parseDate(task.startedAt)?.toLocaleString() || "—"}
                      </span>
                    </div>
                  )}

                  {task.submittedForApprovalAt && (
                    <div>
                      <span className="text-amber-800 block text-[10px] uppercase font-bold">Submitted For Review</span>
                      <span className="text-amber-950 font-bold">
                        {parseDate(task.submittedForApprovalAt)?.toLocaleString() || "—"}
                      </span>
                    </div>
                  )}

                  {task.approvedAt && (
                    <div>
                      <span className="text-emerald-800 block text-[10px] uppercase font-bold">Approved By Admin</span>
                      <span className="text-emerald-950 font-bold">
                        {parseDate(task.approvedAt)?.toLocaleString()} ({task.approvedBy || "Admin"})
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Full Screen Image Zoom Modal */}
      {zoomedImage && (
        <div
          className="fixed inset-0 z-60 bg-black/90 flex items-center justify-center p-4 backdrop-blur-md"
          onClick={() => setZoomedImage(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh]">
            <img src={zoomedImage} alt="Zoomed proof" className="max-w-full max-h-[90vh] object-contain rounded" />
            <button
              type="button"
              onClick={() => setZoomedImage(null)}
              className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-white text-black font-bold text-lg flex items-center justify-center shadow-lg cursor-pointer"
            >
              &times;
            </button>
          </div>
        </div>
      )}
    </div>
  </ModalPortal>
  );
}
