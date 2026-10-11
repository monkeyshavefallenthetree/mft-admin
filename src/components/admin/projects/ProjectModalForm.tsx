"use client";

import { toast } from "@/lib/admin/feedback";
import { useState } from "react";
import { Project } from "./types";
import { PROJECT_TYPES, PROJECT_STATUSES } from "@/lib/admin/constants";
import ModalPortal from "@/components/admin/ui/ModalPortal";

interface Props {
  initialProject?: Project | null;
  onClose: () => void;
  onSubmit: (formData: {
    name: string;
    clientName: string;
    description: string;
    projectTypes: string[];
    status: string;
    startDate: string;
    endDate: string;
  }) => Promise<void>;
}

export default function ProjectModalForm({
  initialProject,
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
  const [saving, setSaving] = useState(false);

  const toggleType = (val: string) => {
    setProjectTypes((prev) =>
      prev.includes(val) ? prev.filter((x) => x !== val) : [...prev, val]
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
              {initialProject ? "// EDIT PROJECT" : "// CREATE NEW PROJECT"}
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
                Description *
              </label>
              <textarea
                required
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Project overview, goals, constraints..."
                className="w-full px-3 py-2 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded text-xs text-zinc-950 dark:text-zinc-100 focus:outline-none focus:border-red-600 font-mono resize-y"
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
                {saving ? "Saving..." : initialProject ? "Save Project" : "Create Project"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </ModalPortal>
  );
}
