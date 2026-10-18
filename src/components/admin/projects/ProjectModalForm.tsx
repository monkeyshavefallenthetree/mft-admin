"use client";

import { toast } from "@/lib/admin/feedback";
import { useState, useMemo } from "react";
import { Project, Worker } from "./types";
import { PROJECT_TYPES, PROJECT_STATUSES } from "@/lib/admin/constants";
import ModalPortal from "@/components/admin/ui/ModalPortal";
import RichDescriptionEditor from "@/components/admin/ui/RichDescriptionEditor";

interface Props {
  initialProject?: Project | null;
  workers?: Worker[];
  onClose: () => void;
  onSubmit: (formData: {
    name: string;
    clientName: string;
    description: string;
    projectTypes: string[];
    status: string;
    startDate: string;
    endDate: string;
    memberIds: string[];
    initialChatMessage?: string;
  }) => Promise<void>;
}

export default function ProjectModalForm({
  initialProject,
  workers = [],
  onClose,
  onSubmit,
}: Props) {
  const [name, setName] = useState(initialProject?.name || "");
  const [clientName, setClientName] = useState(initialProject?.clientName || "");
  const [description, setDescription] = useState(initialProject?.description || "");
  const [projectTypes, setProjectTypes] = useState<string[]>(
    initialProject?.projectTypes || []
  );
  const [status, setStatus] = useState(initialProject?.status || "active");
  const [startDate, setStartDate] = useState(initialProject?.startDate || "");
  const [endDate, setEndDate] = useState(initialProject?.endDate || "");
  const [memberIds, setMemberIds] = useState<string[]>(
    Array.isArray(initialProject?.memberIds) ? initialProject!.memberIds! : []
  );
  const [initialChatMessage, setInitialChatMessage] = useState("");
  const [workerSearch, setWorkerSearch] = useState("");
  const [saving, setSaving] = useState(false);

  const approvedWorkers = useMemo(
    () => workers.filter((w) => !w.status || w.status === "approved"),
    [workers]
  );

  const filteredWorkers = useMemo(() => {
    const q = workerSearch.trim().toLowerCase();
    if (!q) return approvedWorkers;
    return approvedWorkers.filter((w) => {
      const full = `${w.firstName || ""} ${w.lastName || ""}`.toLowerCase();
      const role = (w.role || "").toLowerCase();
      return full.includes(q) || role.includes(q);
    });
  }, [approvedWorkers, workerSearch]);

  const toggleType = (val: string) => {
    setProjectTypes((prev) =>
      prev.includes(val) ? prev.filter((x) => x !== val) : [...prev, val]
    );
  };

  const toggleMember = (id: string) => {
    setMemberIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.warning("Project name is required");
      return;
    }
    if (projectTypes.length === 0) {
      toast.warning("Pick at least one project category");
      return;
    }

    setSaving(true);
    try {
      await onSubmit({
        name: name.trim(),
        clientName: clientName.trim(),
        description: description.trim(),
        projectTypes,
        status,
        startDate,
        endDate,
        memberIds,
        initialChatMessage: initialChatMessage.trim() || undefined,
      });
      onClose();
    } catch {
      toast.error("Failed to save project");
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
          <div className="mb-5 pb-3 border-b-2 border-zinc-900 dark:border-zinc-700 flex items-center justify-between">
            <h3 className="text-xl font-oswald text-red-600 uppercase tracking-wider font-bold">
              {initialProject ? "// EDIT PROJECT & GROUP CHAT" : "// CREATE NEW PROJECT + GROUP CHAT"}
            </h3>
            <button
              type="button"
              onClick={onClose}
              className="w-7 h-7 rounded bg-zinc-100 hover:bg-zinc-900 hover:text-white dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700 flex items-center justify-center text-sm font-bold cursor-pointer transition-colors"
            >
              &times;
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[10px] font-bold uppercase text-zinc-600 dark:text-zinc-400 mb-1">
                Project Name *
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Tree Removal - Zone 4"
                className="w-full px-3 py-2 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded text-sm text-zinc-950 dark:text-zinc-100 focus:outline-none focus:border-red-600 font-mono"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase text-zinc-600 dark:text-zinc-400 mb-1">
                Client / Account Name
              </label>
              <input
                type="text"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="e.g. City Forestry Dept"
                className="w-full px-3 py-2 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded text-xs text-zinc-950 dark:text-zinc-100 font-mono"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase text-zinc-600 dark:text-zinc-400 mb-1">
                Description (Headlines, Paragraphs &amp; Colors) *
              </label>
              <RichDescriptionEditor
                value={description}
                onChange={setDescription}
                placeholder="Project overview, goals, constraints..."
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase text-zinc-600 dark:text-zinc-400 mb-1">
                Project Categories *
              </label>
              <div className="grid grid-cols-2 gap-2 border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 p-2.5 rounded">
                {PROJECT_TYPES.map((pt) => (
                  <label
                    key={pt.value}
                    className="flex items-center gap-2 text-xs uppercase text-zinc-900 dark:text-zinc-200 hover:text-red-600 dark:hover:text-red-400 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={projectTypes.includes(pt.value)}
                      onChange={() => toggleType(pt.value)}
                      className="accent-red-600"
                    />
                    <span>{pt.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Project Group Chat Members */}
            <div className="border-2 border-zinc-900 dark:border-zinc-700 rounded-lg p-3 bg-zinc-50 dark:bg-zinc-800/40 space-y-2.5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-bold uppercase text-red-600">
                    💬 Project Group Chat Members ({memberIds.length})
                  </p>
                  <p className="text-[10px] text-zinc-500">
                    Connected to this project · Task assignees are also added automatically
                  </p>
                </div>
                {memberIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setMemberIds([])}
                    className="text-[10px] font-bold text-zinc-500 hover:text-red-600 underline cursor-pointer"
                  >
                    Clear
                  </button>
                )}
              </div>

              {approvedWorkers.length > 0 && (
                <>
                  <input
                    type="text"
                    value={workerSearch}
                    onChange={(e) => setWorkerSearch(e.target.value)}
                    placeholder="Filter team members..."
                    className="w-full px-2.5 py-1.5 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded text-xs text-zinc-900 dark:text-zinc-100"
                  />
                  <div className="max-h-32 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-1.5 pr-1">
                    {filteredWorkers.map((w) => {
                      const checked = memberIds.includes(w.id);
                      return (
                        <label
                          key={w.id}
                          className={`flex items-center gap-2 px-2 py-1.5 rounded border text-[11px] cursor-pointer transition-colors ${
                            checked
                              ? "bg-red-50 border-red-400 text-red-900 font-bold"
                              : "bg-white border-zinc-200 text-zinc-800 hover:border-zinc-400"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleMember(w.id)}
                            className="accent-red-600"
                          />
                          <span className="truncate">
                            {w.firstName} {w.lastName}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </>
              )}

              {!initialProject && (
                <div>
                  <label className="block text-[10px] font-bold uppercase text-zinc-600 dark:text-zinc-400 mb-1">
                    Kickoff Group Chat Message (Optional)
                  </label>
                  <input
                    type="text"
                    value={initialChatMessage}
                    onChange={(e) => setInitialChatMessage(e.target.value)}
                    placeholder="e.g. Welcome team! Let's align on deliverables here."
                    className="w-full px-2.5 py-1.5 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded text-xs text-zinc-950 dark:text-zinc-100"
                  />
                </div>
              )}
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase text-zinc-600 dark:text-zinc-400 mb-1">
                Status
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full px-2.5 py-2 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded text-xs text-zinc-950 dark:text-zinc-100 uppercase cursor-pointer"
              >
                {PROJECT_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-bold uppercase text-zinc-600 dark:text-zinc-400 mb-1">
                  Start Date
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded text-xs text-zinc-950 dark:text-zinc-100 font-mono"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase text-zinc-600 dark:text-zinc-400 mb-1">
                  End Date
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded text-xs text-zinc-950 dark:text-zinc-100 font-mono"
                />
              </div>
            </div>

            <div className="flex gap-3 pt-3 border-t-2 border-zinc-900 dark:border-zinc-700">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="flex-1 py-2 border-2 border-zinc-900 dark:border-zinc-700 text-zinc-900 dark:text-zinc-200 rounded font-bold uppercase hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white font-bold uppercase rounded border-2 border-red-700 transition-colors cursor-pointer shadow-xs disabled:opacity-50"
              >
                {saving ? "Saving..." : initialProject ? "Save Project" : "Create Project & Chat"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </ModalPortal>
  );
}
