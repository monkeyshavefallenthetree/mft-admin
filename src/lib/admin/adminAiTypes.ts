import type { AdminRole } from "@/lib/admin/nav";

export type AdminAiMessageRole = "user" | "assistant";

export interface AdminAiHistoryTurn {
  role: AdminAiMessageRole;
  content: string;
}

export interface AdminAiAction {
  label: string;
  href: string;
  kind?: "navigate" | "filter";
}

export interface AdminAiCreateTaskDraft {
  type: "create_task";
  title: string;
  description: string;
  department: string;
  priority: "low" | "medium" | "high" | "urgent";
  dueDate?: string;
  workerIds?: string[];
  projectId?: string;
  projectName?: string;
}

export interface AdminAiSendHrAlertDraft {
  type: "send_hr_alert";
  title: string;
  message: string;
  alertType: string;
  priority: "low" | "medium" | "high";
  recipient: "all" | "department" | "individual";
  department?: string;
  workerIds?: string[];
}

export interface AdminAiClientReplyDraft {
  type: "client_reply_draft";
  subject: string;
  body: string;
  language: "ar" | "en";
}

export interface AdminAiHrNoticeDraft {
  type: "hr_notice_draft";
  title: string;
  body: string;
  policyClause?: string;
  language: "ar" | "en";
}

export type AdminAiDraft =
  | AdminAiCreateTaskDraft
  | AdminAiSendHrAlertDraft
  | AdminAiClientReplyDraft
  | AdminAiHrNoticeDraft;

export interface AdminAiProviderInfo {
  id: "custom" | "opencode" | "groq" | "gemini" | "openrouter";
  label: string;
  configured: boolean;
  defaultModel: string;
  freeSignupUrl?: string;
}

export interface AdminAiStatusResponse {
  ok: true;
  role: AdminRole;
  providers: AdminAiProviderInfo[];
  activeProvider: string;
  localFallbackReady: true;
}

export interface AdminAiChatResponse {
  ok: true;
  reply: string;
  provider: string;
  model: string;
  mode: "llm" | "local";
  role: AdminRole;
  actions: AdminAiAction[];
  draft?: AdminAiDraft | null;
  setupHint?: boolean;
}
