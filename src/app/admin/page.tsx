"use client";

import { useEffect, useState, useCallback } from "react";
import { collection, query, orderBy, onSnapshot, doc, updateDoc, deleteDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

interface Submission {
  id: string;
  fullName: string;
  email: string;
  phone?: string;
  company?: string;
  meetingDate?: string;
  meetingTime?: string;
  meetingEmail?: string;
  services?: string[];
  projectDescription?: string;
  referenceLinks?: string;
  status: string;
  submittedAt: Date;
  phase1Status?: string;
  phase2Status?: string;
  phase3Status?: string;
}

const SERVICE_MAP: Record<string, string> = {
  branding: "Branding & Identity",
  "media-buying": "Media Buying",
  "digital-marketing": "Digital Marketing",
  "media-production": "Media Production",
  "outdoor-advertising": "Outdoor Advertising",
  "web-development": "Web & SEO Development",
  printing: "Printing Solutions",
  "event-management": "Event Management",
};

const STATUS_COLORS: Record<string, string> = {
  new: "text-[#00FF66] border-[#00FF66]/30 bg-[#00FF66]/5",
  contacted: "text-blue-400 border-blue-500/30 bg-blue-500/5",
  "in-progress": "text-yellow-400 border-yellow-500/30 bg-yellow-500/5",
  completed: "text-zinc-400 border-zinc-500/30 bg-zinc-500/5",
};

function formatDate(date: Date | string | undefined) {
  if (!date) return "Unknown";
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDateOnly(date: string | undefined) {
  if (!date) return "Not specified";
  const d = new Date(date);
  return d.toLocaleDateString("en-US", { weekday: "short", year: "numeric", month: "short", day: "numeric" });
}

function formatTime(time: string | undefined) {
  if (!time) return "Not specified";
  const [hour, minute] = time.split(":");
  const h = parseInt(hour);
  return `${h % 12 || 12}:${minute} ${h >= 12 ? "PM" : "AM"}`;
}

export default function AdminSubmissionsPage() {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [serviceFilter, setServiceFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [searchFilter, setSearchFilter] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, "submissions"), orderBy("submittedAt", "desc"));
    return onSnapshot(
      q,
      (snap) => {
        const items: Submission[] = [];
        snap.forEach((d) => {
          const data = d.data();
          items.push({
            id: d.id,
            ...data,
            status: data.status || "new",
            submittedAt: data.submittedAt?.toDate?.() || data.timestamp?.toDate?.() || new Date(data.createdAt || Date.now()),
          } as Submission);
        });
        setSubmissions(items);
        setLoading(false);
      },
      () => {
        setSubmissions([]);
        setLoading(false);
      }
    );
  }, []);

  const filtered = submissions.filter((s) => {
    if (statusFilter && s.status !== statusFilter) return false;
    if (serviceFilter && !(s.services?.includes(serviceFilter))) return false;
    if (searchFilter) {
      const q = searchFilter.toLowerCase();
      if (!s.fullName?.toLowerCase().includes(q) && !s.email?.toLowerCase().includes(q) && !s.company?.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const contactClient = useCallback((email: string, name: string) => {
    const subject = encodeURIComponent("Re: Your Project Request - Monkeys Have Fallen The Tree");
    const body = encodeURIComponent(`Hi ${name},\n\nThank you for your project request. We've reviewed your requirements and would love to discuss your project in more detail.\n\nBest regards,\nMonkeys Have Fallen The Tree Team`);
    window.open(`mailto:${email}?subject=${subject}&body=${body}`);
  }, []);

  const updateStatus = useCallback(async (id: string, status: string) => {
    await updateDoc(doc(db, "submissions", id), { status, updatedAt: new Date().toISOString() });
  }, []);

  const updatePhase = useCallback(async (id: string, phase: string, status: string) => {
    const updateData: Record<string, unknown> = {
      [`${phase}Status`]: status,
      [`${phase}UpdatedAt`]: new Date().toISOString(),
    };
    if (status === "completed") {
      updateData.updatedAt = new Date().toISOString();
      const sub = submissions.find((s) => s.id === id);
      if (sub) {
        const p1 = phase === "phase1" ? true : sub.phase1Status === "completed";
        const p2 = phase === "phase2" ? true : sub.phase2Status === "completed";
        const p3 = phase === "phase3" ? true : sub.phase3Status === "completed";
        if (p1 && p2 && p3) {
          updateData.status = "completed";
          updateData.completedAt = new Date().toISOString();
        }
      }
    }
    await updateDoc(doc(db, "submissions", id), updateData);
  }, [submissions]);

  const deleteSubmission = useCallback(async (id: string) => {
    if (confirm("Terminate record? This cannot be undone.")) {
      await deleteDoc(doc(db, "submissions", id));
    }
  }, []);

  const stats = {
    total: submissions.length,
    new: submissions.filter((s) => s.status === "new").length,
    contacted: submissions.filter((s) => s.status === "contacted").length,
    inProgress: submissions.filter((s) => s.status === "in-progress").length,
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[var(--mft-muted)] animate-pulse">
          FETCHING INBOUND QUEUE...
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
          <h2 className="text-3xl font-oswald font-bold text-white uppercase tracking-wider">Inbound Submissions</h2>
        </div>
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-[#00FF66]">
          <span className="h-1.5 w-1.5 bg-[#00FF66] animate-pulse" />
          MONITORING QUEUE
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-[var(--mft-border)] border border-[var(--mft-border)] shadow-[4px_4px_0px_0px_#111]">
        {[
          { label: "Total Recs", value: stats.total, color: "text-white" },
          { label: "Unprocessed", value: stats.new, color: "text-[#00FF66]" },
          { label: "Contacted", value: stats.contacted, color: "text-blue-400" },
          { label: "In Pipeline", value: stats.inProgress, color: "text-yellow-400" },
        ].map((s) => (
          <div key={s.label} className="bg-[var(--mft-bg)] p-5 text-center transition-colors hover:bg-[var(--mft-surface)]">
            <div className={`text-3xl font-oswald font-bold tracking-wider ${s.color}`}>{s.value}</div>
            <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-[var(--mft-muted)] mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-5 bg-[var(--mft-surface)] border border-[var(--mft-border)]">
        <div className="flex flex-col gap-1.5">
          <label className="text-[9px] font-bold uppercase tracking-widest text-[var(--mft-muted)]">Sort by Status</label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="brutal-input text-xs">
            <option value="">ALL STATUSES</option>
            <option value="new">NEW / UNPROCESSED</option>
            <option value="contacted">CONTACTED</option>
            <option value="in-progress">IN PROGRESS</option>
            <option value="completed">COMPLETED</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-[9px] font-bold uppercase tracking-widest text-[var(--mft-muted)]">By Service</label>
          <select value={serviceFilter} onChange={(e) => setServiceFilter(e.target.value)} className="brutal-input text-xs">
            <option value="">ALL SERVICES</option>
            {Object.entries(SERVICE_MAP).map(([k, v]) => <option key={k} value={k}>{v.toUpperCase()}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1.5 md:col-span-2">
          <label className="text-[9px] font-bold uppercase tracking-widest text-[var(--mft-muted)]">Operator Search</label>
          <input value={searchFilter} onChange={(e) => setSearchFilter(e.target.value)} placeholder="NAME, EMAIL, OR COMPANY ID..." className="brutal-input text-xs placeholder:text-[var(--mft-muted)]" />
        </div>
      </div>

      {/* Submissions List */}
      <div className="space-y-0 border border-[var(--mft-border)]">
        {filtered.length === 0 ? (
          <div className="p-20 text-center border-b border-[var(--mft-border)]">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--mft-muted)]">NO RECORDS MATCHING PARAMETERS</p>
          </div>
        ) : (
          filtered.map((sub, idx) => (
            <div key={sub.id} className={`group relative border-b border-[var(--mft-border)] last:border-0 bg-[var(--mft-bg)] hover:bg-[var(--mft-surface)] transition-all p-6`}>
              {/* Submission Header Bar */}
              <div className="flex flex-col lg:flex-row justify-between gap-6 mb-6">
                <div className="flex gap-4">
                  <span className="text-[10px] font-bold text-[var(--mft-muted)] mt-1 shrink-0 font-mono">
                    {String(idx + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <h3 className="text-xl font-oswald font-bold text-white uppercase tracking-wider group-hover:text-[var(--mft-primary)] transition-colors">
                      {sub.fullName}
                    </h3>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 font-mono text-[10px] uppercase tracking-widest">
                      <span className="text-[var(--mft-muted)]">{sub.email}</span>
                      {sub.company && <span className="text-[var(--mft-primary)]">[{sub.company}]</span>}
                      <span className="text-[var(--mft-muted)]">REC_ID: {sub.id.slice(-8)}</span>
                    </div>
                  </div>
                </div>
                <div className="flex flex-col lg:items-end gap-2">
                  <span className={`brutal-badge self-start lg:self-end ${STATUS_COLORS[sub.status] || STATUS_COLORS.new}`}>
                    {sub.status.toUpperCase()}
                  </span>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--mft-muted)]">
                    RCVD: {formatDate(sub.submittedAt)}
                  </p>
                </div>
              </div>

              {/* Data Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                <div className="border border-[var(--mft-border)] p-4 bg-[var(--mft-bg)]/50">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--mft-muted)] mb-2">{"// SCHEDULE"}</p>
                  <p className="text-sm font-bold text-white uppercase">{formatDateOnly(sub.meetingDate)}</p>
                  <p className="text-xs text-[var(--mft-primary)] mt-0.5">{formatTime(sub.meetingTime)}</p>
                </div>
                <div className="md:col-span-2 border border-[var(--mft-border)] p-4 bg-[var(--mft-bg)]/50">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--mft-muted)] mb-2">{"// SERVICES"}</p>
                  <div className="flex flex-wrap gap-2">
                    {sub.services?.map((s) => (
                      <span key={s} className="brutal-badge text-white border-white/20">
                        {SERVICE_MAP[s] || s}
                      </span>
                    )) || <span className="text-xs text-[var(--mft-muted)] italic">NONE SPECIFIED</span>}
                  </div>
                </div>
              </div>

              {/* Requirements */}
              {sub.projectDescription && (
                <div className="mb-6 border-l-2 border-[var(--mft-primary)] pl-5 py-1">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--mft-muted)] mb-2">OPERATOR_LOG: REQUIREMENTS_MANIFEST</p>
                  <p className="text-xs text-zinc-300 leading-relaxed max-w-4xl whitespace-pre-wrap">{sub.projectDescription}</p>
                </div>
              )}

              {/* Action Toolbar */}
              <div className="flex flex-wrap items-center gap-3 pt-4 border-t border-[var(--mft-border)]">
                <button onClick={() => contactClient(sub.email, sub.fullName)} className="brutal-btn px-4 py-2">
                  [ CONTACT OPERATOR ]
                </button>
                <button onClick={() => updateStatus(sub.id, "contacted")} className="brutal-btn-outline px-4 py-2">
                  [ MARK CONTACTED ]
                </button>
                <button onClick={() => deleteSubmission(sub.id)} className="border border-red-800 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-red-500 hover:bg-red-950 transition-colors">
                  [ TERMINATE RECORD ]
                </button>
              </div>

              {/* Pipeline Status */}
              <div className="mt-8 border-t border-[var(--mft-border)] pt-6">
                <h4 className="text-[10px] font-bold text-[var(--mft-primary)] mb-4 uppercase tracking-[0.2em]">PROJECT_PIPELINE.EXE</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-[var(--mft-border)] border border-[var(--mft-border)]">
                  {(["phase1", "phase2", "phase3"] as const).map((phase, idx) => {
                    const phaseStatus = sub[`${phase}Status` as keyof Submission] as string || "pending";
                    const labels = ["PHASE 01 // PLANNING", "PHASE 02 // DEVELOPMENT", "PHASE 03 // FINALIZATION"];
                    const isDone = phaseStatus === "completed";
                    const isCurrent = phaseStatus === "in-progress";
                    
                    return (
                      <div key={phase} className="bg-[var(--mft-bg)] p-4 flex flex-col gap-3">
                        <span className={`text-[9px] font-bold tracking-widest uppercase ${isDone ? "text-[#00FF66]" : isCurrent ? "text-blue-400" : "text-[var(--mft-muted)]"}`}>
                          {labels[idx]}
                        </span>
                        <div className="flex gap-2">
                          <button
                            onClick={() => updatePhase(sub.id, phase, "in-progress")}
                            disabled={isDone || isCurrent}
                            className={`flex-1 text-[9px] font-bold uppercase border py-1.5 transition-colors ${
                              isCurrent ? "bg-blue-600 border-blue-600 text-white" : "border-[var(--mft-border)] text-[var(--mft-muted)] hover:text-white"
                            }`}
                          >
                            {isCurrent ? "ACTIVE" : "START"}
                          </button>
                          <button
                            onClick={() => updatePhase(sub.id, phase, "completed")}
                            disabled={isDone || !isCurrent}
                            className={`flex-1 text-[9px] font-bold uppercase border py-1.5 transition-colors ${
                              isDone ? "bg-[#00FF66] border-[#00FF66] text-black" : "border-[var(--mft-border)] text-[var(--mft-muted)] hover:text-white"
                            }`}
                          >
                            {isDone ? "COMPLETE" : "SUBMIT"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
