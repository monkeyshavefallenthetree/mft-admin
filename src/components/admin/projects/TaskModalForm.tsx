"use client";

import { toast } from "@/lib/admin/feedback";
import { useState } from "react";
import { TaskRow, Worker, parseDate, getAssigneeIds, SubtaskItem, sanitizeSubtask, sanitizeSubtasks } from "./types";
import { TASK_DEPARTMENTS } from "@/lib/admin/constants";
import ModalPortal from "@/components/admin/ui/ModalPortal";

interface Props {
  initialTask?: TaskRow | null;
  projectId?: string;
  projectName?: string;
  prefillStatus?: string;
  prefillPriority?: string;
  prefillDueDate?: string;
  workers: Worker[];
  onClose: () => void;
  onSubmit: (formData: {
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
  }) => Promise<void>;
}

export default function TaskModalForm({
  initialTask,
  projectName,
  prefillStatus = "assigned",
  prefillPriority = "medium",
  prefillDueDate = "",
  workers,
  onClose,
  onSubmit,
}: Props) {
  const initialDueDate = initialTask?.dueDate
    ? (() => {
        const d = parseDate(initialTask.dueDate);
        if (!d) return "";
        const pad = (n: number) => n.toString().padStart(2, "0");
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      })()
    : prefillDueDate;

  const [title, setTitle] = useState(initialTask?.title || "");
  const [description, setDescription] = useState(initialTask?.description || "");
  const [department, setDepartment] = useState(initialTask?.department || "general");
  const [priority, setPriority] = useState(initialTask?.priority || prefillPriority);
  const [status, setStatus] = useState(initialTask?.status || prefillStatus);
  const [dueDate, setDueDate] = useState(initialDueDate);
  const [photo, setPhoto] = useState(initialTask?.photo || "");
  const [workerIds, setWorkerIds] = useState<string[]>(
    initialTask ? getAssigneeIds(initialTask.assignedTo) : []
  );
  const [notificationMessage, setNotificationMessage] = useState("");
  const [subtasks, setSubtasks] = useState<SubtaskItem[]>(initialTask?.subtasks || []);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");
  const [newSubtaskDesc, setNewSubtaskDesc] = useState("");
  const [newSubtaskLink, setNewSubtaskLink] = useState("");
  const [saving, setSaving] = useState(false);

  const approvedWorkers = workers.filter((w) => w.status === "approved");

  const handleAddSubtask = () => {
    if (!newSubtaskTitle.trim()) return;
    const item = sanitizeSubtask({
      title: newSubtaskTitle,
      description: newSubtaskDesc,
      link: newSubtaskLink,
      completed: false,
    });
    setSubtasks((prev) => [...prev, item]);
    setNewSubtaskTitle("");
    setNewSubtaskDesc("");
    setNewSubtaskLink("");
  };

  const handleToggleSubtask = (id: string) => {
    setSubtasks((prev) => prev.map((s) => (s.id === id ? { ...s, completed: !s.completed } : s)));
  };

  const handleRemoveSubtask = (id: string) => {
    setSubtasks((prev) => prev.filter((s) => s.id !== id));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.warning("Task title is required");
      return;
    }
    if (workerIds.length === 0) {
      toast.warning("Assign at least one worker");
      return;
    }

    setSaving(true);
    try {
      await onSubmit({
        title: title.trim(),
        description: description.trim(),
        department,
        priority,
        status,
        dueDate,
        photo: photo.trim(),
        workerIds,
        notificationMessage: notificationMessage.trim(),
        subtasks: sanitizeSubtasks(subtasks),
      });
      onClose();
    } catch {
      toast.error("Failed to save task");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalPortal onClose={onClose}>
      <div
        className="fixed inset-0 z-[120] bg-zinc-950/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto animate-fade-in"
        onClick={onClose}
      >
        <div
          className="bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-700 shadow-2xl rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 font-mono text-xs animate-scale-in"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="mb-5 pb-3 border-b-2 border-zinc-900 dark:border-zinc-700 flex items-center justify-between">
            <div>
              <h3 className="text-xl font-oswald text-red-600 uppercase tracking-wider font-bold">
                {initialTask ? "// EDIT TASK DIRECTIVE" : "// CREATE TASK DIRECTIVE"}
              </h3>
              {projectName && (
                <p className="text-[10px] text-zinc-500 dark:text-zinc-400 font-bold uppercase mt-0.5">
                  Project: {projectName}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-7 h-7 rounded bg-zinc-100 hover:bg-zinc-900 hover:text-white dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700 flex items-center justify-center text-sm font-bold cursor-pointer transition-colors"
            >
              &times;
            </button>
          </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[10px] font-bold uppercase text-zinc-600 mb-1">
              Title *
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Cut fallen branch at Site Alpha..."
              className="w-full px-3 py-2 bg-white border border-zinc-300 rounded text-sm text-zinc-950 focus:outline-none focus:border-red-600 font-mono"
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase text-zinc-600 mb-1">
              Description *
            </label>
            <textarea
              required
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Full directive scope, safety requirements, equipment needed..."
              className="w-full px-3 py-2 bg-white border border-zinc-300 rounded text-xs text-zinc-950 focus:outline-none focus:border-red-600 font-mono resize-y"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold uppercase text-zinc-600 mb-1">
                Department *
              </label>
              <select
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className="w-full px-2.5 py-2 bg-white border border-zinc-300 rounded text-xs text-zinc-950 uppercase cursor-pointer"
              >
                {TASK_DEPARTMENTS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase text-zinc-600 mb-1">
                Priority
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="w-full px-2.5 py-2 bg-white border border-zinc-300 rounded text-xs text-zinc-950 uppercase cursor-pointer"
              >
                <option value="urgent">🔴 Urgent</option>
                <option value="high">🟠 High</option>
                <option value="medium">🔵 Normal / Medium</option>
                <option value="low">⚪ Low</option>
              </select>
            </div>
          </div>

          {initialTask && (
            <div>
              <label className="block text-[10px] font-bold uppercase text-zinc-600 mb-1">
                Status
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full px-2.5 py-2 bg-white border border-zinc-300 rounded text-xs text-zinc-950 uppercase cursor-pointer"
              >
                <option value="assigned">Assigned</option>
                <option value="in-progress">In Progress</option>
                <option value="pending-approval">Pending Approval</option>
                <option value="completed">Completed</option>
              </select>
            </div>
          )}

          {/* Assignees Selector */}
          <div>
            <label className="block text-[10px] font-bold uppercase text-zinc-600 mb-1">
              Assign Workers * ({workerIds.length} Selected)
            </label>
            <div className="max-h-36 overflow-y-auto border border-zinc-300 rounded bg-zinc-50 p-2 space-y-1">
              {approvedWorkers.length === 0 ? (
                <p className="text-xs text-zinc-400 italic">No approved workers available.</p>
              ) : (
                approvedWorkers.map((w) => {
                  const isAssigned = workerIds.includes(w.id);
                  return (
                    <label
                      key={w.id}
                      className={`flex items-center justify-between p-1.5 rounded text-xs uppercase cursor-pointer transition-colors ${
                        isAssigned
                          ? "bg-red-50 text-red-950 font-bold"
                          : "text-zinc-800 hover:bg-zinc-100"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={isAssigned}
                          onChange={() => {
                            const set = new Set(workerIds);
                            if (set.has(w.id)) set.delete(w.id);
                            else set.add(w.id);
                            setWorkerIds(Array.from(set));
                          }}
                          className="accent-red-600"
                        />
                        <span>
                          {w.firstName} {w.lastName}
                        </span>
                      </div>
                      {w.role && (
                        <span className="text-[10px] text-zinc-500 font-mono">
                          {w.role}
                        </span>
                      )}
                    </label>
                  );
                })
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold uppercase text-zinc-600 mb-1">
                Due Date
              </label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-white border border-zinc-300 rounded text-xs text-zinc-950 font-mono"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase text-zinc-600 mb-1">
                Photo URL (Optional)
              </label>
              <input
                type="text"
                value={photo}
                onChange={(e) => setPhoto(e.target.value)}
                placeholder="https://..."
                className="w-full px-2.5 py-1.5 bg-white border border-zinc-300 rounded text-xs text-zinc-950 font-mono"
              />
            </div>
          </div>

          {/* Subtasks / Checklist Builder */}
          <div className="border border-zinc-200 rounded-lg p-3 bg-zinc-50 space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="block text-[10px] font-bold uppercase text-zinc-600">
                Checklist &amp; Subtasks ({subtasks.length})
              </label>
              <span className="text-[10px] font-mono text-zinc-400">
                Title, description &amp; links
              </span>
            </div>

            <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
              {subtasks.map((st) => (
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
                      onChange={() => handleToggleSubtask(st.id)}
                      className="accent-emerald-600 w-3.5 h-3.5 mt-0.5 rounded cursor-pointer shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <span className={`font-semibold block truncate ${st.completed ? "line-through text-zinc-400" : "text-zinc-900"}`}>
                        {st.title}
                      </span>
                      {st.description && (
                        <p className={`text-[11px] whitespace-pre-wrap ${st.completed ? "line-through text-zinc-400" : "text-zinc-500"}`}>
                          {st.description}
                        </p>
                      )}
                      {st.link && (
                        <a
                          href={/^https?:\/\//i.test(st.link.trim()) ? st.link.trim() : `https://${st.link.trim()}`}
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
                    onClick={() => handleRemoveSubtask(st.id)}
                    className="text-zinc-400 hover:text-red-600 px-1 cursor-pointer text-sm font-bold shrink-0"
                    title="Remove item"
                  >
                    &times;
                  </button>
                </div>
              ))}
              {subtasks.length === 0 && (
                <p className="text-xs text-zinc-400 italic py-0.5">No subtasks added yet.</p>
              )}
            </div>

            <div className="bg-white border border-zinc-200 rounded p-2.5 space-y-2">
              <input
                type="text"
                value={newSubtaskTitle}
                onChange={(e) => setNewSubtaskTitle(e.target.value)}
                placeholder="+ Subtask title (required)..."
                className="w-full text-xs px-2 py-1.5 border border-zinc-300 rounded focus:border-red-600 focus:outline-none"
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  type="text"
                  value={newSubtaskDesc}
                  onChange={(e) => setNewSubtaskDesc(e.target.value)}
                  placeholder="Description / notes (optional)..."
                  className="text-[11px] px-2 py-1 border border-zinc-200 rounded focus:border-red-600 focus:outline-none text-zinc-700"
                />
                <input
                  type="text"
                  value={newSubtaskLink}
                  onChange={(e) => setNewSubtaskLink(e.target.value)}
                  placeholder="Link URL (e.g. figma.com/..., optional)"
                  className="text-[11px] px-2 py-1 border border-zinc-200 rounded focus:border-red-600 focus:outline-none text-zinc-700"
                />
              </div>
              <div className="flex justify-end pt-0.5">
                <button
                  type="button"
                  onClick={handleAddSubtask}
                  disabled={!newSubtaskTitle.trim()}
                  className="px-2.5 py-1 bg-zinc-900 hover:bg-black text-white text-[11px] font-bold uppercase rounded disabled:opacity-40 cursor-pointer transition-colors"
                >
                  + Add Subtask
                </button>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase text-zinc-600 mb-1">
              Custom Push Notification Alert to Worker Mobile (Optional)
            </label>
            <input
              type="text"
              value={notificationMessage}
              onChange={(e) => setNotificationMessage(e.target.value)}
              placeholder="Immediate notification alert..."
              className="w-full px-3 py-1.5 bg-white border border-zinc-300 rounded text-xs text-zinc-950 font-mono"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 pt-3 border-t-2 border-zinc-900">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex-1 py-2 border-2 border-zinc-900 rounded font-bold uppercase hover:bg-zinc-100 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white font-bold uppercase rounded border-2 border-red-700 transition-colors cursor-pointer shadow-xs disabled:opacity-50"
            >
              {saving ? "Saving..." : initialTask ? "Save Changes" : "Create Directive"}
            </button>
          </div>
        </form>
      </div>
    </div>
  </ModalPortal>
  );
}
