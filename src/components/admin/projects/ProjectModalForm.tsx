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
        className="fixed inset-0 z-[120] bg-zinc-950/55 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto animate-fade-in"
        onClick={onClose}
      >
        <div
          className="ui-card shadow-2xl rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 text-xs animate-scale-in"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-5 pb-3.5 border-b border-zinc-100 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-red-600">
                Studio Project Configuration
              </p>
              <h3 className="text-base font-bold text-zinc-950 mt-0.5">
                {initialProject ? "Edit Project & Group Chat" : "Create New Project & Channel"}
              </h3>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close modal"
              className="w-7 h-7 rounded-lg bg-zinc-100 hover:bg-zinc-900 hover:text-white flex items-center justify-center text-sm font-bold cursor-pointer transition-colors"
            >
              &times;
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[11px] font-semibold text-zinc-700 mb-1">
                Project Name *
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Q4 Brand Rollout — Zone 4"
                className="brutal-input text-xs"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-zinc-700 mb-1">
                Client / Account Name
              </label>
              <input
                type="text"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="e.g. ARC Studio"
                className="brutal-input text-xs"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-zinc-700 mb-1">
                Description (Headlines, Paragraphs &amp; Colors) *
              </label>
              <RichDescriptionEditor
                value={description}
                onChange={setDescription}
                placeholder="Project overview, deliverables, constraints..."
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-zinc-700 mb-1">
                Project Categories *
              </label>
              <div className="grid grid-cols-2 gap-2 border border-zinc-200 bg-zinc-50/70 p-3 rounded-xl">
                {PROJECT_TYPES.map((pt) => (
                  <label
                    key={pt.value}
                    className="flex items-center gap-2 text-xs font-medium text-zinc-800 hover:text-red-600 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={projectTypes.includes(pt.value)}
                      onChange={() => toggleType(pt.value)}
                      className="accent-red-600 rounded"
                    />
                    <span>{pt.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Project Group Chat Members */}
            <div className="border border-zinc-200 rounded-xl p-3.5 bg-zinc-50/60 space-y-2.5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-zinc-900">
                    💬 Project Group Chat Members ({memberIds.length})
                  </p>
                  <p className="text-[11px] text-zinc-500">
                    Connected to this project · Task assignees are also added automatically
                  </p>
                </div>
                {memberIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setMemberIds([])}
                    className="text-[11px] font-semibold text-red-600 hover:underline cursor-pointer"
                  >
                    Clear
                  </button>
                )}
              </div>

              {approvedWorkers.length > 0 && (
                <>
                  <input
                    type="search"
                    value={workerSearch}
                    onChange={(e) => setWorkerSearch(e.target.value)}
                    placeholder="Filter team members..."
                    className="w-full px-3 py-1.5 bg-white border border-zinc-200 rounded-lg text-xs text-zinc-900 focus:outline-none focus:border-zinc-900"
                  />
                  <div className="max-h-32 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-1.5 pr-1">
                    {filteredWorkers.map((w) => {
                      const checked = memberIds.includes(w.id);
                      return (
                        <label
                          key={w.id}
                          className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs cursor-pointer transition-colors ${
                            checked
                              ? "bg-red-50 border-red-300 text-red-900 font-semibold"
                              : "bg-white border-zinc-200 text-zinc-800 hover:border-zinc-300"
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
                  <label className="block text-[11px] font-semibold text-zinc-600 mb-1">
                    Kickoff Group Chat Message (Optional)
                  </label>
                  <input
                    type="text"
                    value={initialChatMessage}
                    onChange={(e) => setInitialChatMessage(e.target.value)}
                    placeholder="e.g. Welcome team! Let's align on deliverables here."
                    className="w-full px-3 py-1.5 bg-white border border-zinc-200 rounded-lg text-xs text-zinc-950"
                  />
                </div>
              )}
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-zinc-700 mb-1">
                Status
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl text-xs font-medium text-zinc-900 cursor-pointer"
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
                <label className="block text-[11px] font-semibold text-zinc-700 mb-1">
                  Start Date
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-3 py-1.5 bg-white border border-zinc-200 rounded-xl text-xs font-code text-zinc-900"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-zinc-700 mb-1">
                  End Date
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full px-3 py-1.5 bg-white border border-zinc-200 rounded-xl text-xs font-code text-zinc-900"
                />
              </div>
            </div>

            <div className="flex gap-2.5 pt-3 border-t border-zinc-100">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="flex-1 brutal-btn-outline py-2.5"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-xl transition-colors cursor-pointer shadow-2xs disabled:opacity-50"
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
