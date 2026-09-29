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
  new: "text-emerald-700 border-emerald-300 bg-emerald-50 font-bold",
  contacted: "text-blue-700 border-blue-300 bg-blue-50 font-bold",
  "in-progress": "text-amber-800 border-amber-300 bg-amber-50 font-bold",
  completed: "text-zinc-700 border-zinc-300 bg-zinc-100 font-bold",
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
          <p className="text-[9px] font-bold uppercase tracking-[0.3em] text-zinc-500 mb-1">{"// MODULE"}</p>
          <h2 className="text-3xl font-oswald font-bold text-zinc-950 uppercase tracking-wider">Inbound Submissions</h2>
        </div>
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1">
          <span className="h-2 w-2 rounded-full bg-emerald-600 animate-pulse" />
          MONITORING QUEUE
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-zinc-200 border border-zinc-200 shadow-[3px_3px_0px_0px_#09090b]">
        {[
          { label: "Total Recs", value: stats.total, color: "text-zinc-950" },
          { label: "Unprocessed", value: stats.new, color: "text-emerald-600" },
          { label: "Contacted", value: stats.contacted, color: "text-blue-600" },
          { label: "In Pipeline", value: stats.inProgress, color: "text-amber-600" },
        ].map((s) => (
          <div key={s.label} className="bg-white p-5 text-center transition-colors hover:bg-zinc-50">
            <div className={`text-3xl font-oswald font-bold tracking-wider ${s.color}`}>{s.value}</div>
            <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-zinc-500 mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-5 bg-white border border-zinc-200 shadow-sm">
        <div className="flex flex-col gap-1.5">
          <label className="text-[9px] font-bold uppercase tracking-widest text-zinc-600">Sort by Status</label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="brutal-input text-xs">
            <option value="">ALL STATUSES</option>
            <option value="new">NEW / UNPROCESSED</option>
            <option value="contacted">CONTACTED</option>
            <option value="in-progress">IN PROGRESS</option>
            <option value="completed">COMPLETED</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-[9px] font-bold uppercase tracking-widest text-zinc-600">By Service</label>
          <select value={serviceFilter} onChange={(e) => setServiceFilter(e.target.value)} className="brutal-input text-xs">
            <option value="">ALL SERVICES</option>
            {Object.entries(SERVICE_MAP).map(([k, v]) => <option key={k} value={k}>{v.toUpperCase()}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1.5 md:col-span-2">
          <label className="text-[9px] font-bold uppercase tracking-widest text-zinc-600">Operator Search</label>
          <input value={searchFilter} onChange={(e) => setSearchFilter(e.target.value)} placeholder="NAME, EMAIL, OR COMPANY ID..." className="brutal-input text-xs" />
        </div>
      </div>

      {/* Submissions List */}
      <div className="space-y-0 border border-zinc-200 bg-white shadow-[3px_3px_0px_0px_#09090b]">
        {filtered.length === 0 ? (
          <div className="p-20 text-center border-b border-zinc-200">
            <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">NO RECORDS MATCHING PARAMETERS</p>
          </div>
        ) : (
          filtered.map((sub, idx) => (
            <div key={sub.id} className="group relative border-b border-zinc-200 last:border-0 bg-white hover:bg-zinc-50/70 transition-all p-6">
              {/* Submission Header Bar */}
              <div className="flex flex-col lg:flex-row justify-between gap-6 mb-6">
                <div className="flex gap-4">
                  <span className="text-[10px] font-bold text-zinc-400 mt-1 shrink-0 font-mono">
                    {String(idx + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <h3 className="text-xl font-oswald font-bold text-zinc-950 uppercase tracking-wider group-hover:text-red-600 transition-colors">
                      {sub.fullName}
                    </h3>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 font-mono text-[10px] uppercase tracking-widest">
                      <a href={`mailto:${sub.email}`} className="text-zinc-600 font-semibold hover:underline">
                        📧 {sub.email}
                      </a>
                      {sub.phone && (
                        <span className="text-zinc-800 font-bold inline-flex items-center gap-1.5">
                          <span>📞 {sub.phone}</span>
                          <a
                            href={`https://wa.me/${sub.phone.replace(/[^0-9]/g, "")}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-emerald-700 bg-emerald-50 border border-emerald-300 px-1.5 py-0.5 hover:bg-emerald-100"
                          >
                            WhatsApp
                          </a>
                        </span>
                      )}
                      {sub.company && <span className="text-red-600 font-bold">🏢 [{sub.company}]</span>}
                      <span className="text-zinc-400">REC_ID: {sub.id.slice(-8)}</span>
                    </div>
                  </div>
                </div>
                <div className="flex flex-col lg:items-end gap-2">
                  <span className={`brutal-badge self-start lg:self-end ${STATUS_COLORS[sub.status] || STATUS_COLORS.new}`}>
                    {sub.status.toUpperCase()}
                  </span>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">
                    RCVD: {formatDate(sub.submittedAt)}
                  </p>
                </div>
              </div>

              {/* Data Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                <div className="border border-zinc-200 p-4 bg-zinc-50">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-500 mb-2">{"// SCHEDULE"}</p>
                  <p className="text-sm font-bold text-zinc-900 uppercase">{formatDateOnly(sub.meetingDate)}</p>
                  <p className="text-xs text-red-600 font-bold mt-0.5">{formatTime(sub.meetingTime)}</p>
                  {sub.meetingEmail && (
                    <p className="text-[10px] font-mono text-zinc-600 mt-1 truncate">
                      Invite: {sub.meetingEmail}
                    </p>
                  )}
                </div>
                <div className="md:col-span-2 border border-zinc-200 p-4 bg-zinc-50">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-500 mb-2">{"// SERVICES"}</p>
                  <div className="flex flex-wrap gap-2">
                    {sub.services?.map((s) => (
                      <span key={s} className="brutal-badge text-zinc-900 border-zinc-300 bg-white">
                        {SERVICE_MAP[s] || s}
                      </span>
                    )) || <span className="text-xs text-zinc-500 italic">NONE SPECIFIED</span>}
                  </div>
                </div>
              </div>

              {/* Requirements */}
              {sub.projectDescription && (
                <div className="mb-6 border-l-2 border-red-600 pl-5 py-2 bg-red-50/20">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-600 mb-2">OPERATOR_LOG: REQUIREMENTS_MANIFEST</p>
                  <p className="text-xs text-zinc-800 leading-relaxed max-w-4xl whitespace-pre-wrap">{sub.projectDescription}</p>
                </div>
              )}

              {/* Reference Links */}
              {sub.referenceLinks && (
                <div className="mb-6 border-l-2 border-zinc-900 pl-5 py-2 bg-zinc-50">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-600 mb-1">REFERENCE_LINKS</p>
                  <p className="text-xs font-mono text-zinc-800 leading-relaxed max-w-4xl break-all">
                    {sub.referenceLinks.startsWith("http") ? (
                      <a href={sub.referenceLinks} target="_blank" rel="noreferrer" className="text-red-600 underline font-bold inline-flex items-center gap-1">
                        {sub.referenceLinks} ↗
                      </a>
                    ) : (
                      sub.referenceLinks
                    )}
                  </p>
                </div>
              )}

              {/* Action Toolbar */}
              <div className="flex flex-wrap items-center gap-3 pt-4 border-t border-zinc-200">
                <button onClick={() => contactClient(sub.email, sub.fullName)} className="brutal-btn px-4 py-2">
                  [ CONTACT OPERATOR ]
                </button>
                <button onClick={() => updateStatus(sub.id, "contacted")} className="brutal-btn-outline px-4 py-2">
                  [ MARK CONTACTED ]
                </button>
                <button onClick={() => deleteSubmission(sub.id)} className="border border-red-300 bg-red-50 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-red-700 hover:bg-red-600 hover:text-white transition-colors cursor-pointer">
                  [ TERMINATE RECORD ]
                </button>
              </div>

              {/* Pipeline Status */}
              <div className="mt-8 border-t border-zinc-200 pt-6">
                <h4 className="text-[10px] font-bold text-red-600 mb-4 uppercase tracking-[0.2em]">PROJECT_PIPELINE.EXE</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-zinc-200 border border-zinc-200">
                  {(["phase1", "phase2", "phase3"] as const).map((phase, idx) => {
                    const phaseStatus = sub[`${phase}Status` as keyof Submission] as string || "pending";
                    const labels = ["PHASE 01 // PLANNING", "PHASE 02 // DEVELOPMENT", "PHASE 03 // FINALIZATION"];
                    const isDone = phaseStatus === "completed";
                    const isCurrent = phaseStatus === "in-progress";
                    
                    return (
                      <div key={phase} className="bg-white p-4 flex flex-col gap-3">
                        <span className={`text-[9px] font-bold tracking-widest uppercase ${isDone ? "text-emerald-700" : isCurrent ? "text-blue-700" : "text-zinc-500"}`}>
                          {labels[idx]}
                        </span>
                        <div className="flex gap-2">
                          <button
                            onClick={() => updatePhase(sub.id, phase, "in-progress")}
                            disabled={isDone || isCurrent}
                            className={`flex-1 text-[9px] font-bold uppercase border py-1.5 transition-colors cursor-pointer ${
                              isCurrent ? "bg-blue-600 border-blue-600 text-white" : "border-zinc-300 bg-zinc-50 text-zinc-700 hover:bg-zinc-100 hover:text-zinc-950"
                            }`}
                          >
                            {isCurrent ? "ACTIVE" : "START"}
                          </button>
                          <button
                            onClick={() => updatePhase(sub.id, phase, "completed")}
                            disabled={isDone || !isCurrent}
                            className={`flex-1 text-[9px] font-bold uppercase border py-1.5 transition-colors cursor-pointer ${
                              isDone ? "bg-emerald-600 border-emerald-600 text-white font-bold" : "border-zinc-300 bg-zinc-50 text-zinc-700 hover:bg-zinc-100 hover:text-zinc-950"
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
