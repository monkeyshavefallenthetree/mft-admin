"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { addDoc, collection, getDocs, query, serverTimestamp, where } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { getAdminRoleMeta, type AdminRole } from "@/lib/admin/nav";
import { TASK_DEPARTMENTS } from "@/lib/admin/constants";
import { confirmDialog, toast } from "@/lib/admin/feedback";
import { logActivity } from "@/lib/admin/activity";
import { notifyAdmins } from "@/lib/adminNotifications";
import { sendExpoPushToWorkers } from "@/lib/chatNotifications";
import type {
  AdminAiAction,
  AdminAiChatResponse,
  AdminAiClientReplyDraft,
  AdminAiCreateTaskDraft,
  AdminAiDraft,
  AdminAiHistoryTurn,
  AdminAiHrNoticeDraft,
  AdminAiProviderInfo,
  AdminAiSendHrAlertDraft,
  AdminAiStatusResponse,
} from "@/lib/admin/adminAiTypes";

interface Props {
  open: boolean;
  onClose: () => void;
  onNavigate: (href: string) => void;
  role: AdminRole;
  pathname: string;
}

interface UiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  provider?: string;
  model?: string;
  mode?: "llm" | "local";
  actions?: AdminAiAction[];
  draft?: AdminAiDraft | null;
  draftDone?: boolean;
  setupHint?: boolean;
}

const ARABIC_RE = /[\u0600-\u06FF]/;

function isRtl(text: string): boolean {
  return ARABIC_RE.test(text);
}

/** Safe inline markdown formatter (bold + inline code; zero dangerouslySetInnerHTML). */
function renderInlineMarkdown(line: string, keyPrefix: string) {
  const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, idx) => {
    const key = `${keyPrefix}-${idx}`;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={key} className="font-semibold text-zinc-950 dark:text-white">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code
          key={key}
          className="rounded bg-zinc-200/80 px-1 py-0.5 font-code text-[11px] text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <Fragment key={key}>{part}</Fragment>;
  });
}

function SafeMarkdown({ content }: { content: string }) {
  const lines = content.split(/\r?\n/);
  return (
    <div className="space-y-1.5 text-[13px] leading-relaxed">
      {lines.map((rawLine, idx) => {
        const line = rawLine.trim();
        if (!line) return <div key={idx} className="h-1" />;
        const bulletMatch = line.match(/^[-*•]\s+(.*)$/);
        if (bulletMatch) {
          return (
            <div key={idx} className="flex items-start gap-2">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
              <span className="min-w-0 flex-1">{renderInlineMarkdown(bulletMatch[1], `b-${idx}`)}</span>
            </div>
          );
        }
        const numMatch = line.match(/^(\d+)\.\s+(.*)$/);
        if (numMatch) {
          return (
            <div key={idx} className="flex items-start gap-2">
              <span className="shrink-0 font-code text-[11px] font-bold text-red-600">{numMatch[1]}.</span>
              <span className="min-w-0 flex-1">{renderInlineMarkdown(numMatch[2], `n-${idx}`)}</span>
            </div>
          );
        }
        const headingMatch = line.match(/^#{1,3}\s+(.*)$/);
        if (headingMatch) {
          return (
            <p key={idx} className="font-bold text-zinc-950 dark:text-white">
              {renderInlineMarkdown(headingMatch[1], `h-${idx}`)}
            </p>
          );
        }
        return <p key={idx}>{renderInlineMarkdown(line, `p-${idx}`)}</p>;
      })}
    </div>
  );
}

function quickPromptsFor(role: AdminRole, pathname: string): Array<{ label: string; prompt: string }> {
  if (role === "ops_admin") {
    if (pathname.startsWith("/admin/submissions")) {
      return [
        { label: "New leads summary", prompt: "Summarize our newest client submissions and recommend follow-ups" },
        { label: "Draft client reply", prompt: "Draft a professional client reply in Arabic for our latest lead" },
        { label: "Overdue tasks", prompt: "List overdue tasks and tasks waiting for approval" },
        { label: "Create task", prompt: "Create task for design team to prepare social campaign brief" },
      ];
    }
    return [
      { label: "Ops briefing", prompt: "Give me today's projects, overdue tasks, and client leads briefing" },
      { label: "Pending approvals", prompt: "Which tasks are pending approval right now?" },
      { label: "Draft task", prompt: "Create task for marketing to review client rollout calendar" },
      { label: "رد على عميل", prompt: "اكتب رد احترافي على أحدث عميل متقدم" },
    ];
  }

  if (role === "hr_admin") {
    if (pathname.startsWith("/admin/exceptions")) {
      return [
        { label: "Pending exceptions", prompt: "Summarize all pending exceptions, overtime, and leave requests" },
        { label: "HR-POL-2026 rules", prompt: "Explain HR-POL-2026 overtime, lateness, and 240m permission quota rules" },
        { label: "Live attendance", prompt: "Who is online, idle, or late today?" },
        { label: "Draft HR alert", prompt: "Draft an HR alert reminding staff about 10:00–11:00 clock-in and 2h check-in" },
      ];
    }
    return [
      { label: "ملخص الحضور", prompt: "مين متصل أونلاين ومين متأخر أو خامل اليوم؟" },
      { label: "Pending reviews", prompt: "Show pending exceptions, overtime requests, and reimbursements" },
      { label: "لائحة HR-POL-2026", prompt: "لخّص قواعد التأخير والأوفرتايم ورصيد الإجازات في لائحة HR-POL-2026" },
      { label: "Draft HR alert", prompt: "Draft an HR announcement reminding the team about 2h presence check-ins" },
    ];
  }

  return [
    { label: "Studio briefing", prompt: "Give me today's full studio briefing across Operations, HR attendance, and pending approvals" },
    { label: "ملخص الحضور والمهام", prompt: "اعرض ملخص الحضور اليوم والمتأخرين مع المهام المعلقة للاعتماد" },
    { label: "HR-POL-2026", prompt: "Summarize HR-POL-2026 overtime approval and monthly permission rules" },
    { label: "Draft task", prompt: "Create task for development team to audit client portal delivery" },
    { label: "Draft HR alert", prompt: "Draft an HR announcement about timely clock-in and 2-hour check-ins" },
  ];
}

function DraftCard({
  draft,
  done,
  onMarkDone,
  onPromoteNoticeToAlert,
}: {
  draft: AdminAiDraft;
  done?: boolean;
  onMarkDone: () => void;
  onPromoteNoticeToAlert: (notice: AdminAiHrNoticeDraft) => void;
}) {
  const [busy, setBusy] = useState(false);

  // Task draft editable state
  const [taskTitle, setTaskTitle] = useState(draft.type === "create_task" ? draft.title : "");
  const [taskDesc, setTaskDesc] = useState(draft.type === "create_task" ? draft.description : "");
  const [taskDept, setTaskDept] = useState(draft.type === "create_task" ? draft.department : "general");
  const [taskPrio, setTaskPrio] = useState<AdminAiCreateTaskDraft["priority"]>(
    draft.type === "create_task" ? draft.priority : "medium",
  );
  const [taskDue, setTaskDue] = useState(draft.type === "create_task" ? (draft.dueDate ?? "") : "");

  // HR Alert draft editable state
  const [alertTitle, setAlertTitle] = useState(draft.type === "send_hr_alert" ? draft.title : "");
  const [alertMsg, setAlertMsg] = useState(draft.type === "send_hr_alert" ? draft.message : "");
  const [alertRecip, setAlertRecip] = useState<AdminAiSendHrAlertDraft["recipient"]>(
    draft.type === "send_hr_alert" ? draft.recipient : "all",
  );
  const [alertDept, setAlertDept] = useState(draft.type === "send_hr_alert" ? (draft.department ?? "general") : "general");
  const [alertPrio, setAlertPrio] = useState<AdminAiSendHrAlertDraft["priority"]>(
    draft.type === "send_hr_alert" ? draft.priority : "high",
  );

  // Copyable drafts editable state
  const [replySubject, setReplySubject] = useState(
    draft.type === "client_reply_draft" ? draft.subject : draft.type === "hr_notice_draft" ? draft.title : "",
  );
  const [replyBody, setReplyBody] = useState(
    draft.type === "client_reply_draft" || draft.type === "hr_notice_draft" ? draft.body : "",
  );

  const handleConfirmCreateTask = async () => {
    if (draft.type !== "create_task") return;
    if (!taskTitle.trim()) {
      toast.warning("Task title is required");
      return;
    }
    const ok = await confirmDialog({
      title: "Create task in MFT Studio?",
      message: `Create "${taskTitle.trim()}" under ${taskDept} (${taskPrio} priority)?`,
      confirmLabel: "Create Task",
    });
    if (!ok) return;

    setBusy(true);
    try {
      const workerIds = draft.workerIds ?? [];
      const assignedTo = workerIds.length === 0 ? "" : workerIds.length === 1 ? workerIds[0] : workerIds;
      const payload: Record<string, unknown> = {
        title: taskTitle.trim(),
        description: taskDesc.trim(),
        projectName: draft.projectName || "",
        department: taskDept || "general",
        photo: null,
        assignedTo,
        assignedWorkerIds: workerIds,
        assignedWorkerName: workerIds.length > 0 ? `${workerIds.length} assigned` : "Unassigned",
        priority: taskPrio,
        status: "assigned",
        startDate: null,
        dueDate: taskDue ? new Date(`${taskDue}T12:00:00`) : null,
        subtasks: [],
        createdAt: serverTimestamp(),
        assignedAt: serverTimestamp(),
      };
      if (draft.projectId) {
        payload.projectId = draft.projectId;
      }

      const ref = await addDoc(collection(db, "tasks"), payload);

      if (workerIds.length > 0) {
        void sendExpoPushToWorkers(db, {
          recipientUids: workerIds,
          title: "New Task Assigned",
          body: `You have been assigned: ${taskTitle.trim()}`,
          taskId: ref.id,
          taskTitle: taskTitle.trim(),
        }).catch(() => {});
      }

      const currentAdmin = auth.currentUser;
      const actorName = currentAdmin?.displayName || currentAdmin?.email || "Admin";
      void notifyAdmins(db, {
        targetRoles: ["super_admin", "ops_admin"],
        category: "task",
        eventType: "task_created",
        title: `📋 New Task Created: ${taskTitle.trim()}`,
        body: `${actorName} created "${taskTitle.trim()}" via MFT Super AI.`,
        href: `/admin/tasks?task=${encodeURIComponent(ref.id)}`,
        actorUid: currentAdmin?.uid,
        actorName,
        taskId: ref.id,
        projectId: draft.projectId,
      });

      void logActivity({
        action: "created",
        entity: "task",
        entityId: ref.id,
        label: taskTitle.trim(),
        detail: "Created via MFT Super AI",
      });

      toast.success("Task created", { description: taskTitle.trim() });
      onMarkDone();
    } catch (err) {
      toast.error("Failed to create task", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmSendAlert = async () => {
    if (draft.type !== "send_hr_alert") return;
    if (!alertTitle.trim() || !alertMsg.trim()) {
      toast.warning("Alert title and message are required");
      return;
    }

    const ok = await confirmDialog({
      title: "Send HR alert to workers?",
      message: `Broadcast "${alertTitle.trim()}" to ${alertRecip === "all" ? "all approved workers" : alertRecip === "department" ? `${alertDept} department` : "selected workers"}?`,
      confirmLabel: "Send Alert",
    });
    if (!ok) return;

    setBusy(true);
    try {
      let recipients: string[] = [];
      if (alertRecip === "individual" && draft.workerIds && draft.workerIds.length > 0) {
        recipients = draft.workerIds;
      } else {
        const snap = await getDocs(query(collection(db, "workers"), where("status", "==", "approved")));
        snap.forEach((d) => {
          const data = d.data();
          if (alertRecip === "department" && String(data.department || "") !== alertDept) return;
          recipients.push(d.id);
        });
      }

      if (recipients.length === 0) {
        toast.warning("No matching approved workers found for this audience");
        setBusy(false);
        return;
      }

      const adminEmail = auth.currentUser?.email || "admin";
      await addDoc(collection(db, "alerts"), {
        type: draft.alertType || "system_announcement",
        title: alertTitle.trim(),
        message: alertMsg.trim(),
        recipient: alertRecip,
        department: alertRecip === "department" ? alertDept : "",
        workerId: recipients.length === 1 ? recipients[0] : "",
        priority: alertPrio,
        recipients,
        sentBy: adminEmail,
        sentAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        recipientCount: recipients.length,
        isRead: false,
        readBy: [],
      });

      void sendExpoPushToWorkers(db, {
        recipientUids: recipients,
        title: `HR Alert: ${alertTitle.trim()}`,
        body: alertMsg.trim(),
        tab: "alerts",
        urgent: alertPrio === "high",
      });

      void notifyAdmins(db, {
        targetRoles: ["super_admin", "hr_admin"],
        category: "hr",
        eventType: "hr_alert_sent",
        title: `📢 HR Alert Sent: ${alertTitle.trim()}`,
        body: `${adminEmail} sent "${alertTitle.trim()}" to ${recipients.length} worker(s) via MFT Super AI.`,
        href: "/admin/hr?tab=announcements",
        actorUid: auth.currentUser?.uid,
        actorName: adminEmail,
        urgent: alertPrio === "high",
      });

      void logActivity({
        action: "created",
        entity: "hr",
        label: `Sent alert: ${alertTitle.trim()} to ${recipients.length} workers`,
        detail: "Sent via MFT Super AI",
      });

      toast.success(`Alert sent to ${recipients.length} worker(s)`);
      onMarkDone();
    } catch (err) {
      toast.error("Failed to send alert", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied to clipboard");
    } catch {
      toast.warning("Unable to copy automatically — please copy from the text box");
    }
  };

  if (draft.type === "create_task") {
    return (
      <div className="mt-3 rounded-xl border border-zinc-200 bg-white p-3 text-xs shadow-xs dark:border-zinc-700 dark:bg-zinc-900">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-code text-[10px] font-bold uppercase tracking-wider text-red-600">
            Confirmed Action · Create Task
          </span>
          {done && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
              ✓ Created
            </span>
          )}
        </div>
        <div className="space-y-2">
          <input
            type="text"
            value={taskTitle}
            disabled={done || busy}
            onChange={(e) => setTaskTitle(e.target.value)}
            placeholder="Task title"
            className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-xs font-semibold text-zinc-900 focus:border-red-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
          />
          <textarea
            rows={2}
            value={taskDesc}
            disabled={done || busy}
            onChange={(e) => setTaskDesc(e.target.value)}
            placeholder="Description"
            className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-xs text-zinc-700 focus:border-red-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
          />
          <div className="grid grid-cols-3 gap-1.5">
            <select
              value={taskDept}
              disabled={done || busy}
              onChange={(e) => setTaskDept(e.target.value)}
              className="rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            >
              {TASK_DEPARTMENTS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <select
              value={taskPrio}
              disabled={done || busy}
              onChange={(e) => setTaskPrio(e.target.value as AdminAiCreateTaskDraft["priority"])}
              className="rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            >
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
              <option value="urgent">urgent</option>
            </select>
            <input
              type="date"
              value={taskDue}
              disabled={done || busy}
              onChange={(e) => setTaskDue(e.target.value)}
              className="rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
          </div>
          {!done && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleConfirmCreateTask()}
              className="w-full rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50 cursor-pointer"
            >
              {busy ? "Creating…" : "Confirm & Create Task"}
            </button>
          )}
        </div>
      </div>
    );
  }

  if (draft.type === "send_hr_alert") {
    return (
      <div className="mt-3 rounded-xl border border-zinc-200 bg-white p-3 text-xs shadow-xs dark:border-zinc-700 dark:bg-zinc-900">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-code text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
            Confirmed Action · Send HR Alert
          </span>
          {done && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
              ✓ Sent
            </span>
          )}
        </div>
        <div className="space-y-2">
          <input
            type="text"
            value={alertTitle}
            disabled={done || busy}
            onChange={(e) => setAlertTitle(e.target.value)}
            placeholder="Alert title"
            className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-xs font-semibold text-zinc-900 focus:border-emerald-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
          />
          <textarea
            rows={3}
            value={alertMsg}
            disabled={done || busy}
            onChange={(e) => setAlertMsg(e.target.value)}
            placeholder="Alert message"
            className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-xs text-zinc-700 focus:border-emerald-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
          />
          <div className="grid grid-cols-3 gap-1.5">
            <select
              value={alertRecip}
              disabled={done || busy}
              onChange={(e) => setAlertRecip(e.target.value as AdminAiSendHrAlertDraft["recipient"])}
              className="rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            >
              <option value="all">All Approved</option>
              <option value="department">Department</option>
              {draft.workerIds && draft.workerIds.length > 0 && (
                <option value="individual">Selected ({draft.workerIds.length})</option>
              )}
            </select>
            {alertRecip === "department" ? (
              <select
                value={alertDept}
                disabled={done || busy}
                onChange={(e) => setAlertDept(e.target.value)}
                className="rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              >
                {TASK_DEPARTMENTS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            ) : (
              <div className="flex items-center rounded-lg border border-zinc-200 bg-zinc-100 px-2 py-1 text-[10px] text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800/50">
                Push + Bell
              </div>
            )}
            <select
              value={alertPrio}
              disabled={done || busy}
              onChange={(e) => setAlertPrio(e.target.value as AdminAiSendHrAlertDraft["priority"])}
              className="rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            >
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
            </select>
          </div>
          {!done && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleConfirmSendAlert()}
              className="w-full rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50 cursor-pointer"
            >
              {busy ? "Sending…" : "Confirm & Send Alert"}
            </button>
          )}
        </div>
      </div>
    );
  }

  const isClientReply = draft.type === "client_reply_draft";
  const noticeDraft = draft.type === "hr_notice_draft" ? draft : null;
  const replyDraft = draft.type === "client_reply_draft" ? (draft as AdminAiClientReplyDraft) : null;

  return (
    <div
      dir={isRtl(replyBody) ? "rtl" : "ltr"}
      className="mt-3 rounded-xl border border-zinc-200 bg-white p-3 text-xs shadow-xs dark:border-zinc-700 dark:bg-zinc-900"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-code text-[10px] font-bold uppercase tracking-wider text-sky-700 dark:text-sky-400">
          {isClientReply ? "Draft · Client Reply" : "Draft · HR Policy Notice"}
        </span>
        {noticeDraft?.policyClause && (
          <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-code text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            {noticeDraft.policyClause}
          </span>
        )}
      </div>
      <div className="space-y-2">
        <input
          type="text"
          value={replySubject}
          onChange={(e) => setReplySubject(e.target.value)}
          className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-xs font-semibold text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
        />
        <textarea
          rows={4}
          value={replyBody}
          onChange={(e) => setReplyBody(e.target.value)}
          className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-xs leading-relaxed text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() =>
              void handleCopy(
                replyDraft ? `Subject: ${replySubject}\n\n${replyBody}` : `${replySubject}\n\n${replyBody}`,
              )
            }
            className="flex-1 rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200 cursor-pointer"
          >
            Copy Draft
          </button>
          {noticeDraft && (
            <button
              type="button"
              onClick={() =>
                onPromoteNoticeToAlert({
                  ...noticeDraft,
                  title: replySubject,
                  body: replyBody,
                })
              }
              className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 cursor-pointer"
            >
              Promote to HR Alert
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AdminAiDrawer({ open, onClose, onNavigate, role, pathname }: Props) {
  const roleMeta = getAdminRoleMeta(role);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<AdminAiStatusResponse | null>(null);
  const [showSetup, setShowSetup] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const quickPrompts = useMemo(() => quickPromptsFor(role, pathname), [role, pathname]);

  // Fetch live provider status when drawer opens
  useEffect(() => {
    if (!open) return;
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 60);
    let cancelled = false;
    (async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) return;
        const res = await fetch("/api/ai/admin", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = (await res.json()) as AdminAiStatusResponse;
        if (!cancelled && data.ok) setStatus(data);
      } catch {
        /* ignore non-fatal status check */
      }
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(focusTimer);
    };
  }, [open, role]);

  // Escape key closes drawer
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Keep transcript scrolled to newest message
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sending]);

  if (!open) return null;

  const sendMessage = async (textOverride?: string) => {
    const trimmed = (textOverride ?? input).trim();
    if (!trimmed || sending) return;

    const userMsg: UiMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content: trimmed,
    };
    const history: AdminAiHistoryTurn[] = messages.slice(-10).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    setMessages((prev) => [...prev, userMsg]);
    if (!textOverride) setInput("");
    setSending(true);

    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) {
        toast.error("Sign in again to use MFT Super AI");
        setSending(false);
        return;
      }

      const res = await fetch("/api/ai/admin", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          message: trimmed,
          history,
          pathname,
        }),
      });

      const data = (await res.json()) as AdminAiChatResponse | { ok: false; error?: string };
      if (!res.ok || !data.ok) {
        const errMsg = !data.ok && data.error ? data.error : `AI request failed (${res.status})`;
        setMessages((prev) => [
          ...prev,
          {
            id: `e-${Date.now()}`,
            role: "assistant",
            content: `⚠️ ${errMsg}`,
            mode: "local",
            provider: "error",
          },
        ]);
        return;
      }

      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: data.reply,
          provider: data.provider,
          model: data.model,
          mode: data.mode,
          actions: data.actions,
          draft: data.draft ?? null,
          setupHint: data.setupHint,
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: `e-${Date.now()}`,
          role: "assistant",
          content: `⚠️ Network error: ${err instanceof Error ? err.message : "Unable to reach AI endpoint."}`,
          mode: "local",
          provider: "error",
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  const promoteNoticeToAlert = (msgId: string, notice: AdminAiHrNoticeDraft) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId
          ? {
              ...m,
              draft: {
                type: "send_hr_alert",
                title: notice.title,
                message: notice.body,
                alertType: "system_announcement",
                priority: "high",
                recipient: "all",
              },
              draftDone: false,
            }
          : m,
      ),
    );
  };

  const activeProviderLabel = status
    ? status.activeProvider === "local"
      ? "Local Engine"
      : `${status.activeProvider.toUpperCase()} Live`
    : "Connecting…";

  const providersList: AdminAiProviderInfo[] = status?.providers ?? [];

  return (
    <div className="mft-no-print fixed inset-0 z-[90] flex justify-end">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-zinc-950/45 backdrop-blur-[2px] transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-over Studio Panel */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="mft-super-ai-title"
        className="relative z-10 flex h-full w-full max-w-[480px] flex-col border-l border-zinc-200/90 bg-white shadow-2xl dark:border-zinc-800 dark:bg-[#0c0c0f]"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-2 border-b border-zinc-200/80 bg-zinc-950 px-4 py-3.5 text-white dark:border-zinc-800">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-red-500 to-rose-700 shadow-lg shadow-red-600/30">
              <svg className="h-4.5 w-4.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z"
                />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 id="mft-super-ai-title" className="truncate text-sm font-bold tracking-tight">
                  MFT Super AI
                </h2>
                <span className="rounded-full border border-white/15 bg-white/10 px-2 py-0.5 font-code text-[9px] font-semibold uppercase tracking-wider text-zinc-200">
                  {roleMeta.label.split("·")[0].trim()}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowSetup((s) => !s)}
                className="mt-0.5 inline-flex items-center gap-1.5 font-code text-[10px] text-zinc-400 hover:text-white cursor-pointer"
                title="View free AI API setup & provider chain"
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    status?.activeProvider && status.activeProvider !== "local"
                      ? "bg-emerald-400"
                      : "bg-amber-400"
                  }`}
                />
                <span>{activeProviderLabel}</span>
                <span className="underline decoration-zinc-600 underline-offset-2">
                  {showSetup ? "Hide setup" : "Free API keys"}
                </span>
              </button>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {messages.length > 0 && (
              <button
                type="button"
                onClick={() => setMessages([])}
                className="rounded-lg px-2 py-1 text-[11px] font-medium text-zinc-400 hover:bg-white/10 hover:text-white cursor-pointer"
                title="Clear conversation"
              >
                Clear
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close MFT Super AI"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-white cursor-pointer"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Free API Key Setup Popover */}
        {showSetup && (
          <div className="border-b border-zinc-200 bg-zinc-50 px-4 py-3 text-xs dark:border-zinc-800 dark:bg-zinc-900/90">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-zinc-900 dark:text-white">
                Connect a Free AI Key (Zero Credit Card · &lt;1 min)
              </p>
              <button
                type="button"
                onClick={() => setShowSetup(false)}
                className="text-[11px] text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 cursor-pointer"
              >
                Close
              </button>
            </div>
            <p className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-400">
              Add any one key to <code className="font-code">.env.local</code> / Vercel Environment Variables.
              MFT Super AI automatically fails over across configured providers and falls back to the local studio engine if none are set.
            </p>
            <div className="mt-2.5 space-y-1.5">
              {providersList.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200/80 bg-white px-2.5 py-1.5 dark:border-zinc-800 dark:bg-zinc-950"
                >
                  <div className="min-w-0">
                    <span className="font-semibold text-zinc-800 dark:text-zinc-200">{p.label}</span>
                    <span className="ml-1.5 font-code text-[10px] text-zinc-400">{p.defaultModel}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {p.freeSignupUrl && (
                      <a
                        href={p.freeSignupUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-code text-[10px] font-semibold text-red-600 hover:underline"
                      >
                        Get key ↗
                      </a>
                    )}
                    <span
                      className={`rounded-full px-1.5 py-0.5 font-code text-[9px] font-bold uppercase ${
                        p.configured
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                      }`}
                    >
                      {p.configured ? "Active" : "Unset"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Messages Feed */}
        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {messages.length === 0 && (
            <div className="space-y-4 py-4">
              <div className="rounded-2xl border border-zinc-200/80 bg-zinc-50/80 p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
                <p className="text-sm font-bold text-zinc-900 dark:text-white">
                  Studio Executive Copilot
                </p>
                <p className="mt-1 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                  Live role-scoped insights across your MFT workspace — supports both{" "}
                  <strong className="text-zinc-800 dark:text-zinc-200">English</strong> and{" "}
                  <strong className="text-zinc-800 dark:text-zinc-200">العربية</strong>. Every action draft
                  requires your explicit confirmation before saving.
                </p>
              </div>

              <div>
                <p className="mb-2 font-code text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                  Suggested Prompts
                </p>
                <div className="flex flex-wrap gap-2">
                  {quickPrompts.map((qp) => (
                    <button
                      key={qp.label}
                      type="button"
                      onClick={() => void sendMessage(qp.prompt)}
                      className="rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition-all hover:border-red-300 hover:bg-red-50/60 hover:text-red-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-red-700 dark:hover:text-red-400 cursor-pointer"
                    >
                      {qp.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {messages.map((m) => {
            const rtl = isRtl(m.content);
            if (m.role === "user") {
              return (
                <div key={m.id} className="flex justify-end">
                  <div
                    dir={rtl ? "rtl" : "ltr"}
                    className="max-w-[85%] rounded-2xl rounded-br-sm bg-zinc-950 px-3.5 py-2.5 text-[13px] leading-relaxed text-white shadow-xs dark:bg-red-600"
                  >
                    {m.content}
                  </div>
                </div>
              );
            }

            return (
              <div key={m.id} className="flex justify-start">
                <div
                  dir={rtl ? "rtl" : "ltr"}
                  className="w-full max-w-[95%] rounded-2xl rounded-bl-sm border border-zinc-200/90 bg-zinc-50/90 px-3.5 py-3 text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900/90 dark:text-zinc-200"
                >
                  <SafeMarkdown content={m.content} />

                  {/* 1-Click Safe Navigation Chips */}
                  {m.actions && m.actions.length > 0 && (
                    <div dir="ltr" className="mt-3 flex flex-wrap gap-1.5">
                      {m.actions.map((act) => (
                        <button
                          key={`${m.id}-${act.href}`}
                          type="button"
                          onClick={() => {
                            onNavigate(act.href);
                            onClose();
                          }}
                          className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-zinc-700 transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:border-red-600 cursor-pointer"
                        >
                          <span>{act.label}</span>
                          <span aria-hidden="true">→</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Confirmed Quick-Action Draft Card */}
                  {m.draft && (
                    <DraftCard
                      key={`${m.id}-${m.draft.type}`}
                      draft={m.draft}
                      done={m.draftDone}
                      onMarkDone={() =>
                        setMessages((prev) =>
                          prev.map((x) => (x.id === m.id ? { ...x, draftDone: true } : x)),
                        )
                      }
                      onPromoteNoticeToAlert={(notice) => promoteNoticeToAlert(m.id, notice)}
                    />
                  )}

                  {/* Footer badge */}
                  <div dir="ltr" className="mt-2.5 flex items-center justify-between gap-2 text-[10px] text-zinc-400">
                    <span className="font-code">
                      {m.mode === "llm" ? `${m.provider} · ${m.model}` : "Local Studio Engine"}
                    </span>
                    {m.setupHint && (
                      <button
                        type="button"
                        onClick={() => setShowSetup(true)}
                        className="font-semibold text-red-600 hover:underline cursor-pointer"
                      >
                        + Connect free LLM key
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {sending && (
            <div className="flex justify-start">
              <div className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-zinc-50 px-3.5 py-2.5 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
                <span>Analyzing live workspace…</span>
              </div>
            </div>
          )}
        </div>

        {/* Input Composer */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void sendMessage();
          }}
          className="border-t border-zinc-200/80 bg-white p-3 dark:border-zinc-800 dark:bg-[#0c0c0f]"
        >
          <div className="flex items-end gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-1.5 focus-within:border-red-500 dark:border-zinc-700 dark:bg-zinc-900">
            <textarea
              ref={inputRef}
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void sendMessage();
                }
              }}
              dir={isRtl(input) ? "rtl" : "ltr"}
              placeholder="Ask anything about studio ops, HR, policy, or draft actions… (Enter to send)"
              className="max-h-28 min-h-[42px] flex-1 resize-none bg-transparent px-2 py-1 text-xs text-zinc-900 placeholder:text-zinc-400 focus:outline-none dark:text-white"
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              className="flex h-9 shrink-0 items-center justify-center rounded-lg bg-red-600 px-3 text-xs font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-40 cursor-pointer"
            >
              Send
            </button>
          </div>
          <p className="mt-1.5 flex items-center justify-between px-1 font-code text-[10px] text-zinc-400">
            <span>Shortcut: Ctrl/⌘+J · Esc to close</span>
            <span>Role-scoped · Confirmed writes only</span>
          </p>
        </form>
      </aside>
    </div>
  );
}
