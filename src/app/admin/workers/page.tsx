"use client";

import { useEffect, useState, useMemo } from "react";
import {
  collection,
  query,
  onSnapshot,
  doc,
  updateDoc,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { WORKER_ROLES_FILTER } from "@/lib/admin/constants";
import { deleteWorkerCascade } from "@/lib/admin/deleteWorkerCascade";

interface Worker {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  role: string;
  experience: string;
  status: string;
  isOnline: boolean;
  createdAt?: { toDate: () => Date };
  lastLogin?: { toDate: () => Date };
  lastLogout?: { toDate: () => Date };
}

function formatRole(role: string) {
  return role
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export default function AdminWorkersPage() {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchFilter, setSearchFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [assignModal, setAssignModal] = useState<string | null>(null);
  const [detailWorker, setDetailWorker] = useState<Worker | null>(null);
  const [taskForm, setTaskForm] = useState({ title: "", description: "", projectName: "", priority: "medium", dueDate: "", notificationMessage: "" });

  const filteredWorkers = useMemo(() => {
    const q = searchFilter.trim().toLowerCase();
    return workers.filter((w) => {
      if (statusFilter && w.status !== statusFilter) return false;
      if (roleFilter && w.role !== roleFilter) return false;
      if (!q) return true;
      const blob = `${w.firstName} ${w.lastName} ${w.email} ${w.role} ${w.phone || ""}`.toLowerCase();
      return blob.includes(q);
    });
  }, [workers, searchFilter, statusFilter, roleFilter]);

  const clearWorkerFilters = () => {
    setSearchFilter("");
    setStatusFilter("");
    setRoleFilter("");
  };

  const handleDeleteWorker = async (worker: Worker) => {
    const name = `${worker.firstName} ${worker.lastName}`;
    if (!confirm(`TERMINATE OPERATOR RECORD: ${name.toUpperCase()}?\n\nThis will purge all associated work logs and task links. Action is irreversible.`)) return;
    const typed = prompt(`Type CONFIRM to purge operator ID:`);
    if (typed !== "CONFIRM") { alert("ACTION ABORTED."); return; }
    
    setDeletingId(worker.id);
    try {
      await deleteWorkerCascade(worker.id);
    } catch (e) {
      console.error(e);
      alert(`[ERR] ${e instanceof Error ? e.message : "PURGE_FAILED"}`);
    } finally {
      setDeletingId(null);
    }
  };

  useEffect(() => {
    const q = query(collection(db, "workers"));
    return onSnapshot(
      q,
      (snap) => {
        const items: Worker[] = [];
        snap.forEach((d) => items.push({ id: d.id, ...d.data() } as Worker));
        setWorkers(items);
        setLoading(false);
      },
      (err) => {
        console.error("Error loading workers:", err);
        setLoading(false);
      },
    );
  }, []);

  const approveWorker = async (id: string) => {
    await updateDoc(doc(db, "workers", id), { status: "approved" });
  };

  const rejectWorker = async (id: string) => {
    await updateDoc(doc(db, "workers", id), { status: "rejected" });
  };

  const handleAssignTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignModal) return;
    
    await addDoc(collection(db, "tasks"), {
      ...taskForm,
      assignedTo: assignModal,
      dueDate: taskForm.dueDate ? new Date(taskForm.dueDate) : null,
      status: "assigned",
      createdAt: serverTimestamp(),
      assignedAt: serverTimestamp(),
    });

    await addDoc(collection(db, "alerts"), {
      recipients: [assignModal],
      title: "New Task Assigned",
      message: taskForm.notificationMessage || `You have been assigned to task: ${taskForm.title}`,
      type: "schedule",
      priority: taskForm.priority || "medium",
      isRead: false,
      createdAt: serverTimestamp(),
      sentAt: serverTimestamp(),
      sentBy: "System",
    });

    setAssignModal(null);
    setTaskForm({ title: "", description: "", projectName: "", priority: "medium", dueDate: "", notificationMessage: "" });
  };

  const stats = {
    total: workers.length,
    pending: workers.filter((w) => w.status === "pending").length,
    online: workers.filter((w) => w.isOnline).length,
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[var(--mft-muted)] animate-pulse">
          INITIALIZING OPERATOR MANIFEST...
        </p>
        <div className="w-48 h-px bg-[var(--mft-border)] overflow-hidden">
          <div className="h-px bg-[var(--mft-primary)] w-1/2 animate-[slide_1s_ease-in-out_infinite]" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-[9px] font-bold uppercase tracking-[0.3em] text-[var(--mft-muted)] mb-1">{"// MODULE"}</p>
          <h2 className="text-3xl font-oswald font-bold text-white uppercase tracking-wider">Operator Manifest</h2>
        </div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--mft-muted)]">
          SYNCING: {filteredWorkers.length} OF {workers.length} RECORDS
        </p>
      </div>

      {/* Warnings */}
      <div className="border border-red-500 bg-red-950/20 p-4">
        <div className="flex items-center gap-3 mb-2">
            <span className="h-2 w-2 bg-red-500 animate-pulse" />
            <h4 className="text-xs font-bold uppercase tracking-widest text-red-500">OPERATOR_PURGE_WARNING</h4>
        </div>
        <p className="text-[10px] uppercase tracking-widest leading-relaxed text-red-400">
          Record termination purges profile data, work logs, task links, and pipeline sessions.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-px bg-[var(--mft-border)] border border-[var(--mft-border)] shadow-[4px_4px_0px_0px_#111]">
        {[
          { label: "Active Nodes", value: stats.total, color: "text-white" },
          { label: "Verify Pending", value: stats.pending, color: "text-yellow-400" },
          { label: "Online Uplink", value: stats.online, color: "text-[#00FF66]" },
        ].map((s) => (
          <div key={s.label} className="bg-[var(--mft-bg)] p-5 text-center transition-colors hover:bg-[var(--mft-surface)]">
            <div className={`text-3xl font-oswald font-bold tracking-wider ${s.color}`}>{s.value}</div>
            <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-[var(--mft-muted)] mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filter Bar */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-5 bg-[var(--mft-surface)] border border-[var(--mft-border)]">
        <div className="flex flex-col gap-1.5 min-w-[180px] flex-1">
          <label className="text-[9px] font-bold uppercase tracking-widest text-[var(--mft-muted)]">Operator Search</label>
          <input
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            placeholder="NAME, EMAIL, ROLE..."
            className="brutal-input text-xs placeholder:text-[var(--mft-muted)]"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-[9px] font-bold uppercase tracking-widest text-[var(--mft-muted)]">Status</label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="brutal-input text-xs">
            <option value="">ALL STATUSES</option>
            <option value="approved">APPROVED</option>
            <option value="pending">PENDING</option>
            <option value="rejected">REJECTED</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-[9px] font-bold uppercase tracking-widest text-[var(--mft-muted)]">Unit Role</label>
          <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="brutal-input text-xs">
            <option value="">ALL ROLES</option>
            {WORKER_ROLES_FILTER.map((r) => <option key={r.value} value={r.value}>{r.label.toUpperCase()}</option>)}
          </select>
        </div>
        <div className="flex items-end">
          <button type="button" onClick={clearWorkerFilters} className="brutal-btn-outline w-full py-2.5">
            [ RESET FILTERS ]
          </button>
        </div>
      </div>

      {/* Workers Manifest */}
      <div className="border border-[var(--mft-border)]">
        {workers.length === 0 ? (
          <div className="p-20 text-center border-b border-[var(--mft-border)]">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--mft-muted)] text-[#00FF66]">WAITING FOR INBOUND REGISTRATIONS...</p>
          </div>
        ) : filteredWorkers.length === 0 ? (
          <div className="p-20 text-center border-b border-[var(--mft-border)]">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--mft-muted)] text-yellow-400">NO OPERATORS MATCHING SEARCH PARAMS</p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--mft-border)]">
            {filteredWorkers.map((worker) => (
              <div key={worker.id} className="bg-[var(--mft-bg)] p-6 hover:bg-[var(--mft-surface)] transition-all group">
                {/* Operator Identity */}
                <div className="flex flex-col lg:flex-row justify-between gap-6 mb-6">
                  <div className="flex items-start gap-4">
                    <div className={`mt-1 h-3 w-3 shrink-0 ${worker.isOnline ? "bg-[#00FF66] animate-pulse" : "bg-red-900"}`} />
                    <div>
                      <h3 className="text-xl font-oswald font-bold text-white uppercase tracking-wider group-hover:text-[var(--mft-primary)] transition-colors">
                        {worker.firstName} {worker.lastName}
                      </h3>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-[11px] font-bold text-[var(--mft-primary)] uppercase tracking-widest">
                          {formatRole(worker.role)}
                        </span>
                        <span className="text-[var(--mft-border)]">|</span>
                        <span className="text-[10px] uppercase font-mono text-[var(--mft-muted)]">{worker.id.slice(-8)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap lg:justify-end gap-2">
                    <span className={`brutal-badge ${worker.status === "approved" ? "text-[#00FF66] border-[#00FF66]/30" : "text-yellow-400 border-yellow-500/30"}`}>
                        {worker.status.toUpperCase()}
                    </span>
                    <span className={`brutal-badge ${worker.isOnline ? "text-[#00FF66] border-[#00FF66]/20" : "text-[var(--mft-muted)] border-white/10"}`}>
                      {worker.isOnline ? "LINK_ACTIVE" : "LINK_OFFLINE"}
                    </span>
                  </div>
                </div>

                {/* Technical Specs Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6 font-mono text-[10px] uppercase tracking-widest">
                  <div className="space-y-1.5">
                    <p><span className="text-[var(--mft-muted)]">EMAIL_ID:</span> <span className="text-white">{worker.email}</span></p>
                    <p><span className="text-[var(--mft-muted)]">NODE_TEL:</span> <span className="text-white">{worker.phone}</span></p>
                  </div>
                  <div className="space-y-1.5">
                    <p><span className="text-[var(--mft-muted)]">XP_LEVEL:</span> <span className="text-white">{worker.experience}</span></p>
                    <p><span className="text-[var(--mft-muted)]">NODE_JOIN:</span> <span className="text-white">{worker.createdAt?.toDate ? worker.createdAt.toDate().toLocaleDateString() : "???"}</span></p>
                  </div>
                  <div className="space-y-1.5">
                    <p><span className="text-[var(--mft-muted)]">LAST_UP:</span> <span className="text-white">{worker.lastLogin?.toDate ? worker.lastLogin.toDate().toLocaleString([], { hour: '2-digit', minute: '2-digit' }) : "UNKNOWN"}</span></p>
                    <p><span className="text-[var(--mft-muted)]">LAST_DN:</span> <span className="text-white">{worker.lastLogout?.toDate ? worker.lastLogout.toDate().toLocaleString([], { hour: '2-digit', minute: '2-digit' }) : "STILL_UP"}</span></p>
                  </div>
                </div>

                {/* Command Interface */}
                <div className="flex flex-wrap items-center gap-3 pt-4 border-t border-[var(--mft-border)]">
                  {worker.status === "pending" && (
                    <>
                      <button onClick={() => approveWorker(worker.id)} className="bg-[#00FF66] px-4 py-2 border border-[#00FF66] text-black text-[10px] font-bold uppercase transition-colors hover:bg-white hover:border-white">
                        [ VERIFY OPERATOR ]
                      </button>
                      <button onClick={() => rejectWorker(worker.id)} className="border border-red-600 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-red-500 hover:bg-red-950 transition-colors">
                        [ REJECT UNIT ]
                      </button>
                    </>
                  )}
                  <button onClick={() => setAssignModal(worker.id)} className="brutal-btn px-4 py-2">
                    [ ASSIGN_TASK ]
                  </button>
                  <button type="button" onClick={() => setDetailWorker(worker)} className="brutal-btn-outline px-4 py-2">
                    [ VIEW_DATA ]
                  </button>
                  <button
                    type="button"
                    disabled={deletingId === worker.id}
                    onClick={() => void handleDeleteWorker(worker)}
                    className="ml-auto border border-red-800 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-red-700 hover:bg-red-950 hover:text-red-500 transition-colors disabled:opacity-30"
                  >
                    {deletingId === worker.id ? "PURGING..." : "[ TERMINATE RECORD ]"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* View Data Modal */}
      {detailWorker && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4 backdrop-blur-sm"
          onClick={() => setDetailWorker(null)}>
          <div className="brutal-card w-full max-w-md p-8 shadow-[4px_4px_0px_0px_var(--mft-muted)]"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-8 pb-4 border-b border-[var(--mft-border)]">
              <h3 className="text-xl font-oswald text-white uppercase tracking-widest">{"// OPERATOR_DATA"}</h3>
              <button onClick={() => setDetailWorker(null)} className="text-xs font-bold text-[var(--mft-muted)] hover:text-white">[ X ]</button>
            </div>
            <div className="space-y-4 font-mono text-[11px] uppercase tracking-widest">
              <p><span className="text-[var(--mft-muted)]">NAME:</span> {detailWorker.firstName} {detailWorker.lastName}</p>
              <p><span className="text-[var(--mft-muted)]">EMAIL:</span> {detailWorker.email}</p>
              <p><span className="text-[var(--mft-muted)]">TEL:</span> {detailWorker.phone || "UNSET"}</p>
              <p><span className="text-[var(--mft-muted)]">ROLE:</span> <span className="text-[var(--mft-primary)]">{formatRole(detailWorker.role)}</span></p>
              <p><span className="text-[var(--mft-muted)]">XP_CREDITS:</span> {detailWorker.experience}</p>
              <p><span className="text-[var(--mft-muted)]">UPLINK_STATUS:</span> {detailWorker.isOnline ? "OPERATIONAL" : "DISPATCH_OFFLINE"}</p>
            </div>
            <button
              type="button"
              onClick={() => setDetailWorker(null)}
              className="brutal-btn w-full mt-10 py-3"
            >
              [ DISMISS_MANIFEST ]
            </button>
          </div>
        </div>
      )}

      {/* Assign Task Modal */}
      {assignModal && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4 backdrop-blur-sm"
          onClick={() => setAssignModal(null)}>
          <div className="brutal-card w-full max-w-lg max-h-[90vh] overflow-y-auto p-8 shadow-[4px_4px_0px_0px_var(--mft-primary)]"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-8 pb-4 border-b border-[var(--mft-border)]">
              <h3 className="text-xl font-oswald text-[var(--mft-primary)] uppercase tracking-wider">{"// DISPATCH_TASK"}</h3>
              <button onClick={() => setAssignModal(null)} className="text-xs font-bold text-[var(--mft-muted)] hover:text-white">[ X ]</button>
            </div>
            <form onSubmit={(e) => void handleAssignTask(e)} className="space-y-6">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-[var(--mft-muted)] mb-2">Operation Title *</label>
                <input required value={taskForm.title} onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })} className="brutal-input" />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-[var(--mft-muted)] mb-2">Directive Details *</label>
                <textarea required value={taskForm.description} onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })} rows={3} className="brutal-input resize-none" />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-[var(--mft-muted)] mb-2">Project ID / Name</label>
                <input value={taskForm.projectName} onChange={(e) => setTaskForm({ ...taskForm, projectName: e.target.value })} className="brutal-input" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-[var(--mft-muted)] mb-2">Priority Level</label>
                  <select value={taskForm.priority} onChange={(e) => setTaskForm({ ...taskForm, priority: e.target.value })} className="brutal-input">
                    <option value="low">LOW</option>
                    <option value="medium">MEDIUM</option>
                    <option value="high">HIGH</option>
                    <option value="urgent">CRITICAL</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-[var(--mft-muted)] mb-2">Deadline</label>
                  <input type="date" value={taskForm.dueDate} onChange={(e) => setTaskForm({ ...taskForm, dueDate: e.target.value })} className="brutal-input" />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-[var(--mft-muted)] mb-2">Custom Uplink Msg (Optional)</label>
                <textarea value={taskForm.notificationMessage} onChange={(e) => setTaskForm({ ...taskForm, notificationMessage: e.target.value })} rows={2} placeholder="SENDER: SYSTEM_DISPATCH" className="brutal-input text-xs" />
              </div>
              <div className="flex gap-3 justify-end pt-4 border-t border-[var(--mft-border)]">
                <button type="button" onClick={() => setAssignModal(null)} className="brutal-btn-outline flex-1 py-3">[ ABORT ]</button>
                <button type="submit" className="brutal-btn flex-1 py-3">[ DISPATCH ]</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
