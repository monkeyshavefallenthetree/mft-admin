"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { doc, serverTimestamp, updateDoc, addDoc, collection } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { db } from "@/lib/firebase";
import {
  markProjectChatNotificationsReadForAdmin,
  sendProjectMessage,
  subscribeProjectChat,
  type ProjectChatMessage,
} from "@/lib/projectChat";
import { sendExpoPushToWorkers } from "@/lib/chatNotifications";
import { getAdminRole, getAdminRoleMeta } from "@/lib/admin/nav";
import { toast } from "@/lib/admin/feedback";
import LinkifiedText from "@/components/admin/ui/LinkifiedText";
import {
  getAssigneeIds,
  getProjectMemberIds,
  type Project,
  type TaskRow,
  type Worker,
} from "./types";

interface Props {
  project: Project;
  tasks: TaskRow[];
  workers: Worker[];
  onSelectTask?: (task: TaskRow) => void;
}

function formatRole(role?: string) {
  if (!role) return "Team Member";
  return role
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export default function ProjectGroupChatView({
  project,
  tasks,
  workers,
  onSelectTask,
}: Props) {
  const [messages, setMessages] = useState<ProjectChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [manageMembersOpen, setManageMembersOpen] = useState(false);
  const [memberSearch, setMemberSearch] = useState("");
  const [savingMembers, setSavingMembers] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const taskAssignedIds = useMemo(() => {
    const s = new Set<string>();
    tasks.forEach((t) => getAssigneeIds(t.assignedTo).forEach((id) => s.add(id)));
    return s;
  }, [tasks]);

  const projectMemberIds = useMemo(
    () => getProjectMemberIds(project, tasks),
    [project, tasks],
  );

  const memberWorkers = useMemo(() => {
    return projectMemberIds
      .map((id) => workers.find((w) => w.id === id))
      .filter((w): w is Worker => Boolean(w));
  }, [projectMemberIds, workers]);

  const approvedWorkers = useMemo(
    () => workers.filter((w) => !w.status || w.status === "approved"),
    [workers],
  );

  const filteredWorkersForPicker = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    if (!q) return approvedWorkers;
    return approvedWorkers.filter((w) => {
      const full = `${w.firstName || ""} ${w.lastName || ""}`.toLowerCase();
      const role = (w.role || "").toLowerCase();
      const dept = (w.department || "").toLowerCase();
      return full.includes(q) || role.includes(q) || dept.includes(q);
    });
  }, [approvedWorkers, memberSearch]);

  useEffect(() => {
    markProjectChatNotificationsReadForAdmin(db, project.id).catch(() => {});
    const unsub = subscribeProjectChat(db, project.id, (msgs) => {
      setMessages(msgs);
      markProjectChatNotificationsReadForAdmin(db, project.id).catch(() => {});
      window.setTimeout(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 60);
    });
    return () => unsub();
  }, [project.id]);

  const handleToggleMember = async (worker: Worker) => {
    if (savingMembers) return;
    setSavingMembers(true);
    try {
      const explicit = new Set(Array.isArray(project.memberIds) ? project.memberIds : []);
      const isAdded = !explicit.has(worker.id);
      if (isAdded) explicit.add(worker.id);
      else explicit.delete(worker.id);

      const nextIds = Array.from(explicit);
      await updateDoc(doc(db, "projects", project.id), {
        memberIds: nextIds,
        updatedAt: serverTimestamp(),
      });

      const fullName = `${worker.firstName || ""} ${worker.lastName || ""}`.trim() || worker.id;
      const currentAdmin = getAuth().currentUser;
      const adminName = currentAdmin?.displayName || currentAdmin?.email || "Admin";

      if (isAdded) {
        await addDoc(collection(db, "alerts"), {
          recipients: [worker.id],
          title: `Added to Project Group: ${project.name}`,
          message: `You have been added to the "${project.name}" project group chat.`,
          type: "schedule",
          priority: "medium",
          isRead: false,
          createdAt: serverTimestamp(),
          sentAt: serverTimestamp(),
          sentBy: adminName,
        }).catch(() => {});

        void sendExpoPushToWorkers(db, {
          recipientUids: [worker.id],
          title: `💬 Added to ${project.name}`,
          body: `You were added to the "${project.name}" project group chat.`,
          tab: "tasks",
          url: `/dashboard?tab=tasks&projectChat=${encodeURIComponent(project.id)}`,
        }).catch(() => {});

        await sendProjectMessage(db, {
          projectId: project.id,
          projectName: project.name,
          text: `${adminName} added ${fullName} to the project group chat.`,
          senderUid: currentAdmin?.uid || "admin",
          senderName: adminName,
          senderRole: "admin",
          isSystem: true,
          recipientWorkerIds: [worker.id],
        });
        toast.success(`Added ${fullName} to group chat`);
      } else {
        toast.info(`Removed ${fullName} from direct project members`);
      }
    } catch {
      toast.error("Could not update project members");
    } finally {
      setSavingMembers(false);
    }
  };

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;

    setInput("");
    setSending(true);
    try {
      const u = getAuth().currentUser;
      const role = getAdminRole(u?.email);
      const roleMeta = getAdminRoleMeta(role);
      const senderUid = u?.uid ?? "admin";
      const senderName =
        u?.displayName ||
        (role === "ops_admin"
          ? "Account Manager"
          : role === "super_admin"
          ? "Super Admin"
          : u?.email || "Admin");

      await sendProjectMessage(db, {
        projectId: project.id,
        projectName: project.name,
        text,
        senderUid,
        senderName,
        senderRole: "admin",
        senderTitle: roleMeta.label,
        recipientWorkerIds: projectMemberIds,
      });
    } catch (err) {
      console.error("[ProjectGroupChat] send error:", err);
      setInput(text);
      toast.error("Failed to send message");
    } finally {
      setSending(false);
    }
  };

  const insertTaskReference = (t: TaskRow) => {
    setInput((prev) => `${prev ? `${prev} ` : ""}[Task: ${t.title}] `);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
      {/* Left Sidebar: Project Group Roster & Member Manager */}
      <div className="lg:col-span-4 bg-white border-2 border-zinc-900 rounded-lg shadow-[4px_4px_0px_0px_#09090b] flex flex-col overflow-hidden">
        <div className="p-4 border-b-2 border-zinc-900 bg-zinc-950 text-white flex items-center justify-between">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-widest text-red-400 font-bold">
              // PROJECT CHANNEL
            </p>
            <h3 className="text-base font-oswald uppercase tracking-wider font-bold">
              Team & Group Members ({memberWorkers.length + 2})
            </h3>
          </div>
          <button
            type="button"
            onClick={() => setManageMembersOpen((v) => !v)}
            className="px-2.5 py-1 text-[10px] font-mono font-bold uppercase tracking-wider rounded border border-zinc-700 bg-zinc-800 hover:bg-red-600 hover:border-red-600 text-white transition-colors cursor-pointer"
          >
            {manageMembersOpen ? "Done" : "+ Manage"}
          </button>
        </div>

        {/* Add / Remove Members Picker */}
        {manageMembersOpen && (
          <div className="p-3 bg-zinc-50 border-b-2 border-zinc-200 space-y-2">
            <input
              type="text"
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
              placeholder="Search workers to add to group chat..."
              className="w-full px-2.5 py-1.5 bg-white border border-zinc-300 rounded text-xs font-mono text-zinc-900 focus:outline-none focus:border-red-600"
            />
            <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
              {filteredWorkersForPicker.map((w) => {
                const isExplicit = Array.isArray(project.memberIds) && project.memberIds.includes(w.id);
                const isViaTask = taskAssignedIds.has(w.id);
                return (
                  <div
                    key={w.id}
                    className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded bg-white border border-zinc-200 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="font-bold text-zinc-900 truncate">
                        {w.firstName} {w.lastName}
                      </p>
                      <p className="text-[10px] font-mono text-zinc-500 truncate">
                        {formatRole(w.role)} {isViaTask ? "· Assigned to task" : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={savingMembers}
                      onClick={() => void handleToggleMember(w)}
                      className={`px-2 py-0.5 text-[10px] font-mono font-bold uppercase rounded border transition-colors cursor-pointer ${
                        isExplicit
                          ? "bg-red-50 text-red-700 border-red-300 hover:bg-red-100"
                          : "bg-zinc-900 text-white border-zinc-900 hover:bg-red-600"
                      }`}
                    >
                      {isExplicit ? "Remove" : "+ Add"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Active Roster List */}
        <div className="p-3 space-y-2 overflow-y-auto max-h-[480px]">
          <p className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400 px-1">
            Management & Account Leads
          </p>
          <div className="flex items-center justify-between px-3 py-2 rounded-md bg-red-50/70 border border-red-200">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="w-7 h-7 rounded-full bg-red-600 text-white font-bold text-xs flex items-center justify-center shrink-0">
                SA
              </span>
              <div className="min-w-0">
                <p className="text-xs font-bold text-zinc-900 truncate">Super Admin</p>
                <p className="text-[10px] font-mono text-zinc-500 truncate">admin@mft.com</p>
              </div>
            </div>
            <span className="text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded bg-red-100 text-red-700 border border-red-200">
              Admin
            </span>
          </div>

          <div className="flex items-center justify-between px-3 py-2 rounded-md bg-sky-50/70 border border-sky-200">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="w-7 h-7 rounded-full bg-sky-600 text-white font-bold text-xs flex items-center justify-center shrink-0">
                AM
              </span>
              <div className="min-w-0">
                <p className="text-xs font-bold text-zinc-900 truncate">Account Manager</p>
                <p className="text-[10px] font-mono text-zinc-500 truncate">mayamahmoud@mft.com</p>
              </div>
            </div>
            <span className="text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 border border-sky-200">
              Account Mgr
            </span>
          </div>

          <p className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400 px-1 pt-2">
            Assigned Project Team ({memberWorkers.length})
          </p>
          {memberWorkers.length === 0 ? (
            <div className="p-4 text-center border border-dashed border-zinc-300 rounded-md bg-zinc-50">
              <p className="text-xs font-bold text-zinc-600">No workers in this project yet</p>
              <p className="text-[11px] text-zinc-400 mt-0.5">
                Assign workers to project tasks or click &ldquo;+ Manage&rdquo; above to add team members to this group chat.
              </p>
            </div>
          ) : (
            memberWorkers.map((w) => {
              const workerTaskCount = tasks.filter((t) =>
                getAssigneeIds(t.assignedTo).includes(w.id),
              ).length;
              const initials = `${w.firstName?.[0] || ""}${w.lastName?.[0] || ""}`.toUpperCase() || "W";
              return (
                <div
                  key={w.id}
                  className="flex items-center justify-between px-3 py-2 rounded-md bg-zinc-50 border border-zinc-200 hover:border-zinc-400 transition-colors"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="w-7 h-7 rounded-full bg-zinc-900 text-white font-bold text-[11px] flex items-center justify-center shrink-0">
                      {initials}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-zinc-900 truncate">
                        {w.firstName} {w.lastName}
                      </p>
                      <p className="text-[10px] font-mono text-zinc-500 truncate">
                        {formatRole(w.role)}
                      </p>
                    </div>
                  </div>
                  <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-white border border-zinc-300 text-zinc-700 shrink-0">
                    {workerTaskCount} task{workerTaskCount === 1 ? "" : "s"}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Right Main Panel: Live Group Chat */}
      <div className="lg:col-span-8 bg-white border-2 border-zinc-900 rounded-lg shadow-[4px_4px_0px_0px_#09090b] flex flex-col h-[620px] overflow-hidden">
        {/* Chat Header */}
        <div className="px-5 py-3.5 border-b-2 border-zinc-900 bg-zinc-50 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-9 h-9 rounded-lg bg-red-600 text-white flex items-center justify-center font-oswald font-bold text-base shadow-xs shrink-0">
              💬
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-oswald font-bold uppercase tracking-wider text-zinc-950 truncate">
                  {project.name} — Group Chat
                </h2>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-50 text-emerald-700 border border-emerald-300">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  LIVE
                </span>
              </div>
              <p className="text-[11px] font-mono text-zinc-500 truncate">
                Connected to project · Notifies Admin, Account Manager & {memberWorkers.length} team member{memberWorkers.length === 1 ? "" : "s"}
              </p>
            </div>
          </div>
          <span className="text-xs font-mono font-bold px-2.5 py-1 rounded bg-white border border-zinc-300 text-zinc-700">
            {messages.length} message{messages.length === 1 ? "" : "s"}
          </span>
        </div>

        {/* Messages Feed */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3.5 bg-zinc-50/40">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center py-12">
              <div className="w-12 h-12 rounded-full bg-red-50 border border-red-200 text-red-600 flex items-center justify-center mb-3">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" />
                </svg>
              </div>
              <p className="text-sm font-oswald font-bold uppercase tracking-wider text-zinc-900">
                Start the {project.name} Group Conversation
              </p>
              <p className="text-xs font-mono text-zinc-500 max-w-md mt-1">
                Every message sent here is linked to this project and notifies the Super Admin, Account Manager, and all assigned project team members.
              </p>
            </div>
          ) : (
            messages.map((m) => {
              const currentUid = getAuth().currentUser?.uid;
              const isMe = Boolean(currentUid && m.senderUid === currentUid);
              const timeStr = m.createdAt?.toDate
                ? m.createdAt.toDate().toLocaleString([], {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "Just now";

              if (m.isSystem) {
                return (
                  <div key={m.id} className="flex justify-center my-2">
                    <span className="px-3 py-1 rounded-full bg-zinc-200/80 text-zinc-700 font-mono text-[11px] font-medium">
                      🔔 {m.text} · <span className="text-zinc-500">{timeStr}</span>
                    </span>
                  </div>
                );
              }

              return (
                <div
                  key={m.id}
                  className={`flex flex-col gap-1 ${isMe ? "items-end" : "items-start"}`}
                >
                  <div className="flex items-center gap-1.5 text-[10px] font-mono text-zinc-500">
                    <span className="font-bold text-zinc-800">
                      {isMe ? `${m.senderName} (You)` : m.senderName}
                    </span>
                    <span
                      className={`px-1.5 py-0.2 rounded text-[9px] font-bold uppercase ${
                        m.senderRole === "admin"
                          ? "bg-red-100 text-red-700 border border-red-200"
                          : "bg-zinc-200 text-zinc-700"
                      }`}
                    >
                      {m.senderTitle || (m.senderRole === "admin" ? "ADMIN" : "TEAM")}
                    </span>
                    <span>·</span>
                    <span>{timeStr}</span>
                  </div>
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-xs leading-relaxed whitespace-pre-wrap shadow-xs ${
                      isMe
                        ? "rounded-br-xs bg-red-600 text-white"
                        : m.senderRole === "admin"
                        ? "rounded-bl-xs bg-zinc-900 text-white"
                        : "rounded-bl-xs bg-white border-2 border-zinc-900 text-zinc-900"
                    }`}
                  >
                    <LinkifiedText text={m.text} />
                  </div>
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>

        {/* Quick Task Reference Bar */}
        {tasks.length > 0 && (
          <div className="px-4 py-2 border-t border-zinc-200 bg-zinc-50 flex items-center gap-1.5 overflow-x-auto text-[11px] font-mono">
            <span className="text-zinc-400 font-bold uppercase shrink-0">Tag task:</span>
            {tasks.slice(0, 6).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => insertTaskReference(t)}
                onDoubleClick={() => onSelectTask?.(t)}
                title="Click to mention in chat · Double-click to open task"
                className="px-2 py-0.5 rounded bg-white hover:bg-red-50 hover:text-red-700 hover:border-red-300 border border-zinc-300 text-zinc-700 truncate max-w-[180px] shrink-0 transition-colors cursor-pointer"
              >
                #{t.title}
              </button>
            ))}
          </div>
        )}

        {/* Composer */}
        <form
          onSubmit={handleSend}
          className="p-3.5 border-t-2 border-zinc-900 bg-white flex items-center gap-2.5"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Message ${project.name} group chat (notifies team, Account Manager & Admin)...`}
            className="flex-1 px-3.5 py-2.5 bg-zinc-50 border-2 border-zinc-300 rounded-lg text-xs font-mono text-zinc-950 focus:outline-none focus:border-red-600 focus:bg-white transition-all"
          />
          <button
            type="submit"
            disabled={!input.trim() || sending}
            className="px-5 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-mono font-bold text-xs uppercase tracking-wider rounded-lg border-2 border-zinc-900 shadow-[2px_2px_0px_0px_#09090b] active:translate-x-0.5 active:translate-y-0.5 transition-all cursor-pointer flex items-center gap-2"
          >
            <span>{sending ? "Sending..." : "Send"}</span>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
}
