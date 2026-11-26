/**
 * Smart deterministic local analyzer, HR-POL-2026 advisor, action/draft sanitizer,
 * and system prompt builder for MFT Admin Super AI.
 *
 * Guarantees:
 * - Works immediately out-of-the-box with zero API keys (Arabic + English).
 * - Strictly enforces role boundaries (`ops_admin` cannot view HR data/actions/drafts;
 *   `hr_admin` cannot view Ops/Client Portal data/actions/drafts; `super_admin` has full access).
 * - Sanitizes every action `href` via `isPathAllowedForRole` and every draft `type` via role whitelist.
 */

import { findNavItem, isPathAllowedForRole, type AdminRole } from "@/lib/admin/nav";
import { TASK_DEPARTMENTS } from "@/lib/admin/constants";
import type { AdminAiAction, AdminAiDraft } from "@/lib/admin/adminAiTypes";
import type { AdminAiWorkspaceContext } from "@/lib/server/adminAiContext";

const VALID_DEPARTMENTS = new Set<string>(TASK_DEPARTMENTS);
const VALID_TASK_PRIORITIES = new Set(["low", "medium", "high", "urgent"]);
const VALID_ALERT_PRIORITIES = new Set(["low", "medium", "high"]);

const DRAFT_ROLE_ALLOWLIST: Record<AdminAiDraft["type"], AdminRole[]> = {
  create_task: ["super_admin", "ops_admin"],
  client_reply_draft: ["super_admin", "ops_admin"],
  send_hr_alert: ["super_admin", "hr_admin"],
  hr_notice_draft: ["super_admin", "hr_admin"],
};

export function isArabicText(text: string): boolean {
  return /[\u0600-\u06FF]/.test(text);
}

/**
 * Strictly validates every action link against `/admin*` internal paths AND `isPathAllowedForRole`.
 */
export function sanitizeAdminAiActions(rawActions: unknown, role: AdminRole): AdminAiAction[] {
  if (!Array.isArray(rawActions)) return [];
  const out: AdminAiAction[] = [];
  const seenHref = new Set<string>();

  for (const item of rawActions) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const label = typeof rec.label === "string" ? rec.label.trim().slice(0, 64) : "";
    const rawHref = typeof rec.href === "string" ? rec.href.trim() : "";
    if (!label || !rawHref.startsWith("/admin")) continue;
    if (rawHref.includes("://") || rawHref.startsWith("//") || rawHref.includes("..")) continue;

    const pathnameOnly = rawHref.split("?")[0].split("#")[0].replace(/\/+$/, "") || "/";
    if (pathnameOnly === "/admin/login") continue;
    const matchedNav = findNavItem(pathnameOnly);
    if (!matchedNav || matchedNav.external || pathnameOnly !== matchedNav.href) continue;
    if (!isPathAllowedForRole(pathnameOnly, role)) continue;
    if (seenHref.has(rawHref)) continue;
    seenHref.add(rawHref);

    out.push({
      label,
      href: rawHref.slice(0, 180),
      kind: rec.kind === "filter" ? "filter" : "navigate",
    });
    if (out.length >= 6) break;
  }

  return out;
}

/**
 * Strictly validates a proposed confirmed-action draft against the caller's role & schema.
 */
export function sanitizeAdminAiDraft(
  rawDraft: unknown,
  role: AdminRole,
  ctx?: AdminAiWorkspaceContext,
): AdminAiDraft | null {
  if (!rawDraft || typeof rawDraft !== "object" || Array.isArray(rawDraft)) return null;
  const rec = rawDraft as Record<string, unknown>;
  const type = typeof rec.type === "string" ? (rec.type.trim() as AdminAiDraft["type"]) : null;
  if (!type || !(type in DRAFT_ROLE_ALLOWLIST)) return null;
  if (!DRAFT_ROLE_ALLOWLIST[type].includes(role)) return null;

  const rosterIds = new Set<string>([
    ...(ctx?.ops?.approvedWorkerRoster ?? []).map((w) => w.id),
    ...(ctx?.hr?.approvedWorkerRoster ?? []).map((w) => w.id),
  ]);
  const filterWorkerIds = (val: unknown): string[] | undefined => {
    if (!Array.isArray(val)) return undefined;
    const ids = val
      .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      .map((x) => x.trim())
      .filter((id) => (rosterIds.size > 0 ? rosterIds.has(id) : true));
    return ids.length > 0 ? Array.from(new Set(ids)).slice(0, 20) : undefined;
  };

  if (type === "create_task") {
    const title = typeof rec.title === "string" ? rec.title.trim().slice(0, 140) : "";
    if (!title) return null;
    const description = typeof rec.description === "string" ? rec.description.trim().slice(0, 1000) : "";
    const deptRaw = typeof rec.department === "string" ? rec.department.trim().toLowerCase() : "general";
    const department = VALID_DEPARTMENTS.has(deptRaw) ? deptRaw : "general";
    const prioRaw = typeof rec.priority === "string" ? rec.priority.trim().toLowerCase() : "medium";
    const priority = (VALID_TASK_PRIORITIES.has(prioRaw) ? prioRaw : "medium") as
      | "low"
      | "medium"
      | "high"
      | "urgent";
    const dueDate =
      typeof rec.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rec.dueDate.trim())
        ? rec.dueDate.trim()
        : undefined;
    const projectId = typeof rec.projectId === "string" && rec.projectId.trim() ? rec.projectId.trim().slice(0, 80) : undefined;
    const projectName =
      typeof rec.projectName === "string" && rec.projectName.trim() ? rec.projectName.trim().slice(0, 100) : undefined;
    return {
      type: "create_task",
      title,
      description,
      department,
      priority,
      ...(dueDate ? { dueDate } : {}),
      ...(filterWorkerIds(rec.workerIds) ? { workerIds: filterWorkerIds(rec.workerIds) } : {}),
      ...(projectId ? { projectId } : {}),
      ...(projectName ? { projectName } : {}),
    };
  }

  if (type === "send_hr_alert") {
    const title = typeof rec.title === "string" ? rec.title.trim().slice(0, 120) : "";
    const message = typeof rec.message === "string" ? rec.message.trim().slice(0, 1000) : "";
    if (!title || !message) return null;
    const alertType =
      typeof rec.alertType === "string" && rec.alertType.trim()
        ? rec.alertType.trim().slice(0, 40)
        : "system_announcement";
    const prioRaw = typeof rec.priority === "string" ? rec.priority.trim().toLowerCase() : "high";
    const priority = (VALID_ALERT_PRIORITIES.has(prioRaw) ? prioRaw : "high") as "low" | "medium" | "high";
    const recipRaw = typeof rec.recipient === "string" ? rec.recipient.trim().toLowerCase() : "all";
    const recipient = (
      recipRaw === "department" || recipRaw === "individual" ? recipRaw : "all"
    ) as "all" | "department" | "individual";
    const deptRaw = typeof rec.department === "string" ? rec.department.trim().toLowerCase() : "";
    const department = VALID_DEPARTMENTS.has(deptRaw) ? deptRaw : undefined;
    const workerIds = filterWorkerIds(rec.workerIds);
    return {
      type: "send_hr_alert",
      title,
      message,
      alertType,
      priority,
      recipient: recipient === "individual" && !workerIds ? "all" : recipient,
      ...(department ? { department } : {}),
      ...(workerIds ? { workerIds } : {}),
    };
  }

  if (type === "client_reply_draft") {
    const subject = typeof rec.subject === "string" ? rec.subject.trim().slice(0, 140) : "MFT Studio Update";
    const body = typeof rec.body === "string" ? rec.body.trim().slice(0, 1600) : "";
    if (!body) return null;
    const language = rec.language === "ar" || isArabicText(body) ? "ar" : "en";
    return { type: "client_reply_draft", subject, body, language };
  }

  if (type === "hr_notice_draft") {
    const title = typeof rec.title === "string" ? rec.title.trim().slice(0, 140) : "HR Policy Notice";
    const body = typeof rec.body === "string" ? rec.body.trim().slice(0, 1600) : "";
    if (!body) return null;
    const policyClause =
      typeof rec.policyClause === "string" && rec.policyClause.trim()
        ? rec.policyClause.trim().slice(0, 80)
        : undefined;
    const language = rec.language === "ar" || isArabicText(body) ? "ar" : "en";
    return { type: "hr_notice_draft", title, body, ...(policyClause ? { policyClause } : {}), language };
  }

  return null;
}

/**
 * Builds the concise role-scoped system prompt for external LLMs (keeps total prompt well inside Groq 8K TPM).
 */
export function buildAdminSystemPrompt(role: AdminRole, serializedContext: string): string {
  const allowedDraftTypes = Object.entries(DRAFT_ROLE_ALLOWLIST)
    .filter(([, roles]) => roles.includes(role))
    .map(([t]) => t)
    .join(", ");

  const roleBoundary =
    role === "ops_admin"
      ? "ROLE BOUNDARY (ops_admin): You ONLY handle Projects, Tasks, Client Submissions, and Client Portals. Politely decline HR payroll, salaries, attendance/workSessions, exceptions, or reimbursements."
      : role === "hr_admin"
        ? "ROLE BOUNDARY (hr_admin): You ONLY handle Workers, Attendance/Work Sessions, HR Dashboard, Exceptions, Reimbursements, Reports, and HR-POL-2026 Policy. Politely decline Client Portal, Submissions/Leads, or Ops-only Project/Task management."
        : "ROLE (super_admin): Full visibility across Operations, Clients, People, Attendance, HR-POL-2026, and Activity.";

  return [
    "You are MFT Super AI, the executive operations & HR copilot inside MFT Studio OS.",
    roleBoundary,
    "RULES:",
    "1. Reply concisely in the SAME language as the user (Arabic RTL or English LTR) using clean markdown bullets.",
    "2. Base every number and name STRICTLY on the LIVE WORKSPACE SNAPSHOT below. Never invent workers, tasks, or metrics.",
    "3. Never claim you modified Firestore directly — when asked to create a task, send an HR alert, or draft a client/HR message, propose it inside the `mft-actions` block so the admin can review and confirm.",
    `4. Allowed draft types for this role: [${allowedDraftTypes}].`,
    "5. Optionally append at the very end a fenced JSON block:",
    "```mft-actions",
    '{"actions":[{"label":"View Pending","href":"/admin/...","kind":"navigate"}],"draft":null}',
    "```",
    "LIVE WORKSPACE SNAPSHOT:",
    serializedContext,
  ].join("\n");
}

function detectRoleBoundaryViolation(message: string, role: AdminRole): "hr_denied" | "ops_denied" | null {
  const q = message.toLowerCase();
  if (role === "ops_admin") {
    const asksHr =
      /\b(payroll|salary|salaries|hourly\s*rate|attendance|work\s*sessions?|reimbursement|exception|overtime|late\s*workers?|hr[\s-]*pol|leave\s*balance|annual\s*leave|who\s+is\s+online|who\s+is\s+late)\b/i.test(
        q,
      ) ||
      /(مرتب|رواتب|كشف المرتبات|الحضور|الانصراف|متأخرين|أوفرتايم|إجازة|إجازات|استئذان|مصاريف|عهدة|لائحة|مين أونلاين|مين متصل|تنبيه موظفين)/.test(
        message,
      );
    if (asksHr) return "hr_denied";
  }
  if (role === "hr_admin") {
    const asksOps =
      /\b(client\s*portal|rollout|submission|inbound\s*lead|leads|strapi|create\s+task|new\s+task|project\s*board|overdue\s*tasks?|pending[\s-]*approval\s*tasks?|client\s*reply)\b/i.test(
        q,
      ) ||
      /(بورتال العميل|عملاء جدد|ليدز|طلبات العملاء|إنشاء مهمة|اعمل مهمة|تاسك جديد|المشاريع|مهام متأخرة|رد على عميل)/.test(
        message,
      );
    if (asksOps) return "ops_denied";
  }
  return null;
}

/**
 * Deterministic local analyzer + bilingual HR-POL-2026 & Studio Ops assistant.
 */
export function runAdminAiLocal(
  message: string,
  ctx: AdminAiWorkspaceContext,
): { reply: string; actions: AdminAiAction[]; draft: AdminAiDraft | null } {
  const ar = isArabicText(message);
  const q = message.toLowerCase();
  const role = ctx.role;
  const canOps = role === "super_admin" || role === "ops_admin";
  const canHr = role === "super_admin" || role === "hr_admin";

  // 1. Strict role boundary enforcement
  const violation = detectRoleBoundaryViolation(message, role);
  if (violation === "hr_denied") {
    return {
      reply: ar
        ? "صلاحية حسابك الحالية هي **مدير الحسابات والعمليات (`ops_admin`)**، لذلك بيانات الحضور والرواتب والاستثناءات والمصاريف (HR) متاحة فقط لحساب **HR Admin** أو **Super Admin**.\n\nأقدر أساعدك فوراً في المشاريع، المهام، طلبات العملاء، وبورتال العملاء."
        : "Your current role is **Operations / Account Manager (`ops_admin`)**, so HR attendance, payroll, exceptions, and reimbursements are restricted to **HR Admin** or **Super Admin**.\n\nI can help immediately with Projects, Tasks, Client Submissions, and Client Rollout Portals.",
      actions: sanitizeAdminAiActions(
        [
          { label: ar ? "المشاريع" : "Projects", href: "/admin/projects" },
          { label: ar ? "المهام" : "Tasks", href: "/admin/tasks" },
          { label: ar ? "طلبات العملاء" : "Submissions", href: "/admin/submissions" },
        ],
        role,
      ),
      draft: null,
    };
  }
  if (violation === "ops_denied") {
    return {
      reply: ar
        ? "صلاحية حسابك الحالية هي **الموارد البشرية (`hr_admin`)**، لذلك إدارة المشاريع والمهام وطلبات العملاء وبورتال العملاء متاحة فقط لحساب **Ops Admin** أو **Super Admin**.\n\nأقدر أساعدك فوراً في الحضور اليومي، المتأخرين، الأوفرتايم، الاستثناءات، المصاريف، ولائحة HR-POL-2026."
        : "Your current role is **People & HR (`hr_admin`)**, so Projects, Tasks, Client Submissions, and Client Portals are restricted to **Ops Admin** or **Super Admin**.\n\nI can help immediately with Today's Attendance, Late/Idle staff, Exceptions, Reimbursements, Reports, and HR-POL-2026.",
      actions: sanitizeAdminAiActions(
        [
          { label: ar ? "لوحة HR" : "HR Dashboard", href: "/admin/hr" },
          { label: ar ? "جلسات العمل" : "Work Sessions", href: "/admin/work-sessions" },
          { label: ar ? "الاستثناءات" : "Exceptions", href: "/admin/exceptions?status=pending" },
        ],
        role,
      ),
      draft: null,
    };
  }

  // 2. Confirmed Draft Intents (never mutates DB directly)
  if (
    canOps &&
    (/\b(create|draft|make|assign|new)\s+(a\s+)?task\b/i.test(q) ||
      /(اعمل|أنشئ|انشئ|اكتب|جهز|إنشاء)\s*(لي\s*)?(مهمة|تاسك)/.test(message))
  ) {
    const cleanedTitle =
      message
        .replace(/^(please\s+)?(create|draft|make|assign|new)\s+(a\s+)?task(\s+(for|to|about))?\s*/i, "")
        .replace(/^(لو سمحت\s+)?(اعمل|أنشئ|انشئ|اكتب|جهز|إنشاء)\s*(لي\s*)?(مهمة|تاسك)\s*(جديدة\s*)?(عن|لـ|ل)?\s*/i, "")
        .trim()
        .slice(0, 100) || (ar ? "مهمة تشغيل جديدة" : "New Studio Task");
    const deptGuess = /design|تصميم|جرافيك/i.test(message)
      ? "design"
      : /market|سوشيال|تسويق|ميديا/i.test(message)
        ? "marketing"
        : /dev|كود|موقع|برمجة|web/i.test(message)
          ? "development"
          : "general";
    const prioGuess = /urgent|عاجل|فورا/i.test(message)
      ? "urgent"
      : /high|مهم|أولوية عالية/i.test(message)
        ? "high"
        : "medium";
    const matchedWorker = (ctx.ops?.approvedWorkerRoster ?? []).find((w) =>
      message.toLowerCase().includes(w.name.toLowerCase().split(" ")[0]),
    );
    const matchedProject = (ctx.ops?.activeProjects ?? []).find((p) =>
      message.toLowerCase().includes(p.name.toLowerCase()),
    );

    const draft = sanitizeAdminAiDraft(
      {
        type: "create_task",
        title: cleanedTitle,
        description: ar
          ? `تم تجهيز المسودة من طلب الأدمن: ${message.trim()}`
          : `Drafted from admin request: ${message.trim()}`,
        department: deptGuess,
        priority: prioGuess,
        ...(matchedWorker ? { workerIds: [matchedWorker.id] } : {}),
        ...(matchedProject ? { projectId: matchedProject.id, projectName: matchedProject.name } : {}),
      },
      role,
      ctx,
    );
    return {
      reply: ar
        ? `جهزت لك مسودة المهمة أدناه (**${cleanedTitle}**). راجع التفاصيل أو عدّلها واضغط **تأكيد إنشاء المهمة** لحفظها في النظام.`
        : `I prepared a task draft below (**${cleanedTitle}**). Review or edit the fields and click **Confirm & Create Task** to save it.`,
      actions: sanitizeAdminAiActions([{ label: ar ? "كل المهام" : "All Tasks", href: "/admin/tasks" }], role),
      draft,
    };
  }

  if (
    canHr &&
    (/\b(send|draft|broadcast|write)\s+(an?\s+)?(hr\s+)?(alert|announcement|reminder)\b/i.test(q) ||
      /(ابعت|ارسل|أرسل|جهز|اعمل)\s*(لي\s*)?(تنبيه|إعلان|اعلان|تذكير)\s*(للموظفين|للفريق|عام|HR)?/.test(message))
  ) {
    const draft = sanitizeAdminAiDraft(
      {
        type: "send_hr_alert",
        title: ar ? "تنبيه هام من إدارة الموارد البشرية" : "Important HR Studio Notice",
        message: ar
          ? `يرجى الالتزام بمواعيد الحضور الرسمية (${ctx.hr?.hrSettings.shiftStartTime || "10:00"}–${ctx.hr?.hrSettings.lateCutoffTime || "11:00"} بتوقيت القاهرة) وتأكيد حضور الساعتين الدوري. (${message.trim()})`
          : `Please ensure timely shift clock-in (${ctx.hr?.hrSettings.shiftStartTime || "10:00"}–${ctx.hr?.hrSettings.lateCutoffTime || "11:00"} Cairo) and 2-hour check-in confirmation. (${message.trim()})`,
        alertType: "system_announcement",
        priority: "high",
        recipient: "all",
      },
      role,
      ctx,
    );
    return {
      reply: ar
        ? "جهزت مسودة التنبيه أدناه للموظفين. لن يتم إرسال أي إشعار إلا بعد مراجعتك والضغط على **تأكيد الإرسال**."
        : "I drafted an HR alert below. Nothing is sent until you review it and click **Confirm & Send Alert**.",
      actions: sanitizeAdminAiActions([{ label: ar ? "لوحة HR" : "HR Dashboard", href: "/admin/hr" }], role),
      draft,
    };
  }

  if (
    canOps &&
    (/\b(client\s+reply|reply\s+to\s+(the\s+)?client|draft\s+(a\s+)?(client|lead)\s+(reply|email|message))\b/i.test(q) ||
      /(رد\s*على\s*(ال)?عميل|رسالة\s*ل(ل)?عميل|اكتب\s*رد\s*عميل)/.test(message))
  ) {
    const lead = ctx.ops?.latestSubmissions[0];
    const draft = sanitizeAdminAiDraft(
      {
        type: "client_reply_draft",
        subject: ar ? "تحديث من فريق MFT Studio" : "Update from MFT Studio",
        body: ar
          ? `أهلاً ${lead?.name ? `أ/ ${lead.name}` : "حضرتك"}،\n\nشكراً لتواصلك مع فريق MFT Studio. تم استلام طلبك وجارٍ مراجعة كافة التفاصيل، وسنتواصل معك خلال ساعات العمل لتحديد الخطوات القادمة والجدول الزمني.\n\nخالص التحية،\nفريق MFT Studio`
          : `Hi ${lead?.name || "there"},\n\nThank you for reaching out to MFT Studio. We have received your inquiry and are reviewing the details. We will follow up shortly with our recommended plan and timeline.\n\nBest regards,\nMFT Studio Team`,
        language: ar ? "ar" : "en",
      },
      role,
      ctx,
    );
    return {
      reply: ar
        ? "جهزت لك مسودة رد جاهزة للنسخ والتعديل للعميل."
        : "Here is a ready-to-copy client reply draft you can customize before sending.",
      actions: sanitizeAdminAiActions(
        [
          { label: ar ? "طلبات العملاء" : "Submissions", href: "/admin/submissions?status=new" },
          { label: ar ? "بورتال العملاء" : "Client Portal", href: "/admin/client-portal" },
        ],
        role,
      ),
      draft,
    };
  }

  if (
    canHr &&
    (/\b(hr\s+notice|warning\s+letter|policy\s+notice|draft\s+(a\s+)?(notice|memo|warning))\b/i.test(q) ||
      /(مسودة\s*(إنذار|انذار|إخطار|مذكرة)|اكتب\s*(إنذار|انذار|إخطار|مذكرة))/.test(message))
  ) {
    const draft = sanitizeAdminAiDraft(
      {
        type: "hr_notice_draft",
        title: ar ? "إخطار إداري وفق لائحة HR-POL-2026" : "HR Administrative Notice (HR-POL-2026)",
        policyClause: "HR-POL-2026 · Attendance & Overtime",
        body: ar
          ? "السيد/السيدة الموظف،\n\nنود التذكير بالالتزام بضوابط الحضور والانصراف المعتمدة في لائحة HR-POL-2026 (نافذة الحضور 10:00–11:00 صباحاً بتوقيت القاهرة، تسجيل دخول واحد يومياً، وعدم احتساب أي ساعات إضافية إلا بموافقة إدارية مسبقة).\n\nإدارة الموارد البشرية — MFT Studio"
          : "Dear Team Member,\n\nThis notice serves as a reminder of HR-POL-2026 attendance guidelines (10:00–11:00 Cairo on-time window, single daily shift clock-in, and prior admin approval required for all overtime).\n\nPeople & HR — MFT Studio",
        language: ar ? "ar" : "en",
      },
      role,
      ctx,
    );
    return {
      reply: ar
        ? "جهزت لك مسودة الإخطار الإداري بناءً على لائحة HR-POL-2026 — يمكنك نسخها أو تحويلها إلى تنبيه مباشر."
        : "I prepared an HR policy notice draft aligned with HR-POL-2026 — you can copy it directly.",
      actions: sanitizeAdminAiActions([{ label: ar ? "مختبر اللائحة" : "Policy Lab", href: "/admin/hr/policy-lab" }], role),
      draft,
    };
  }

  // 3. HR-POL-2026 Policy Q&A
  if (
    canHr &&
    (/\b(hr[\s-]*pol|policy|probation|accrual|carry[\s-]*over|1\.35|1\.7|240|permission\s*quota|check[\s-]*in\s*rule)\b/i.test(
      q,
    ) ||
      /(لائحة|سياسة|قواعد|فترة التجربة|رصيد الإجازات|الإضافي|ساعات إضافية|حد الأذونات|240|شيك إن|تأخير|خصم)/.test(
        message,
      ))
  ) {
    const h = ctx.hr;
    const reply = ar
      ? [
          "**ملخص لائحة HR-POL-2026 المفعّلة في النظام:**",
          `- **الحضور والتأخير:** نافذة الحضور المرن من **${h?.hrSettings.shiftStartTime || "10:00"}** حتى **${h?.hrSettings.lateCutoffTime || "11:00"}** بتوقيت القاهرة. من **11:01** يُحتسب تأخير (الحد الأدنى 30 دقيقة ثم مضاعفات 15 دقيقة حتى 120 دقيقة كحد أقصى في المرة).`,
          "- **حصص الأذونات الشهرية:** بحد أقصى **4 أذونات** وإجمالي **240 دقيقة** شهرياً. التأخير غير المغطى حتى 12:00 = **0.25 يوم**، وبعد 12:00 = **0.5 يوم**.",
          `- **الشيفت وتأكيد الحضور:** **${h?.hrSettings.standardHours || 8} ساعات** عمل، **تسجيل دخول واحد فقط في اليوم** بتوقيت القاهرة، وتأكيد حضور دوري كل **ساعتين** (نافذة 10 دقائق).`,
          "- **الأوفرتايم (الإضافي):** **لا يُحتسب ولا يمدد الشيفت إلا بعد موافقة الأدمن** (1.35x نهاري، 1.70x ليلي من 18:00 حتى 06:00).",
          "- **الإجازات السنوية:** فترة تجربة **6 شهور**، بعدها **1.25 يوم/شهر** في السنة الأولى (15 يوم) و**1.75 يوم/شهر** من السنة الثانية (21 يوم)، بحد ترحيل قانوني **7 أيام**.",
        ].join("\n")
      : [
          "**Active HR-POL-2026 Policy Summary:**",
          `- **Attendance & Lateness:** Flexible on-time window **${h?.hrSettings.shiftStartTime || "10:00"}–${h?.hrSettings.lateCutoffTime || "11:00"} Cairo**. At **11:01+**, lateness applies (30m floor, 15m increments, 120m max single permission).`,
          "- **Monthly Permission Quota:** Max **4 permissions** / **240 minutes** total per cycle. Uncovered late <=12:00 = **0.25 day**, >12:00 = **0.5 day**.",
          `- **Shift & Check-In:** **${h?.hrSettings.standardHours || 8}h** shift, strictly **1 shift clock-in per Cairo day**, and 2-hour active-presence check-in (10-minute confirmation window).`,
          "- **Overtime:** **Admin-approved ONLY** before extending shifts or pay (**1.35x** day, **1.70x** night 18:00–06:00).",
          "- **Annual Leave:** **6-month probation**, then **1.25d/mo** in Year 1 (15d) and **1.75d/mo** in Year 2+ (21d), legal carry-over cap **7 days**.",
        ].join("\n");
    return {
      reply,
      actions: sanitizeAdminAiActions(
        [
          { label: ar ? "مختبر اللائحة" : "Policy Lab", href: "/admin/hr/policy-lab" },
          { label: ar ? "الاستثناءات المعلقة" : "Pending Exceptions", href: "/admin/exceptions?status=pending" },
        ],
        role,
      ),
      draft: null,
    };
  }

  // 4. HR Live Attendance / Late / Idle / Online
  if (
    canHr &&
    ctx.hr &&
    (/\b(online|active|attendance|late|idle|who\s+clocked|sessions?)\b/i.test(q) ||
      /(أونلاين|اونلاين|متصل|حضور|متأخر|خامل|شغالين|جلسات)/.test(message))
  ) {
    const h = ctx.hr;
    const onlineList =
      h.liveOnlineWorkers.length > 0
        ? h.liveOnlineWorkers
            .slice(0, 10)
            .map((w) => `- **${w.name}** (${w.department}) — ${ar ? "دخول" : "in"} ${w.clockIn} · ${w.hours}h${w.idle ? " ⚠️ IDLE" : ""}`)
            .join("\n")
        : ar
          ? "- لا يوجد موظفون في وردية نشطة حالياً اليوم."
          : "- No workers are currently in an active shift today.";
    const lateLine =
      h.lateTodayWorkers.length > 0
        ? h.lateTodayWorkers.map((w) => `${w.name} (${w.clockIn})`).join(", ")
        : ar
          ? "لا يوجد متأخرون اليوم"
          : "None today";
    const reply = ar
      ? `**ملخص الحضور المباشر ليوم ${ctx.todayCairoYmd} (${ctx.cairoTimeLabel} القاهرة):**\n- إجمالي الموظفين المعتمدين: **${h.approvedWorkersCount}** | سجّلوا حضور اليوم: **${h.todaySessionsCount}** | متصلون الآن: **${h.liveOnlineWorkers.length}** | خاملون (Idle): **${h.idleTodayWorkers.length}**\n- المتأخرون اليوم (${h.lateTodayWorkers.length}): ${lateLine}\n\n**المتصلون الآن:**\n${onlineList}`
      : `**Live Attendance Snapshot — ${ctx.todayCairoYmd} (${ctx.cairoTimeLabel} Cairo):**\n- Approved staff: **${h.approvedWorkersCount}** | Clocked in today: **${h.todaySessionsCount}** | Active now: **${h.liveOnlineWorkers.length}** | Idle: **${h.idleTodayWorkers.length}**\n- Late today (${h.lateTodayWorkers.length}): ${lateLine}\n\n**Currently Active:**\n${onlineList}`;
    return {
      reply,
      actions: sanitizeAdminAiActions(
        [
          { label: ar ? "جلسات العمل" : "Work Sessions", href: "/admin/work-sessions", kind: "navigate" },
          ...(h.idleTodayWorkers.length > 0
            ? [{ label: ar ? "الخاملون الآن" : "Filter Idle", href: "/admin/work-sessions?status=idle", kind: "filter" as const }]
            : []),
          { label: ar ? "لوحة HR" : "HR Dashboard", href: "/admin/hr", kind: "navigate" },
        ],
        role,
      ),
      draft: null,
    };
  }

  // 5. HR Pending Exceptions / Overtime / Reimbursements / Pending Workers
  if (
    canHr &&
    ctx.hr &&
    (/\b(exception|overtime|reimbursement|expense|pending\s*worker|leave\s*request)\b/i.test(q) ||
      /(استثناء|أوفرتايم|اوفر تايم|مصاريف|عهدة|موافقات|موظفين جدد|طلبات معلقة)/.test(message))
  ) {
    const h = ctx.hr;
    const exLines =
      h.pendingExceptions.length > 0
        ? h.pendingExceptions
            .slice(0, 8)
            .map((e) => `- **${e.workerName}** — \`${e.type}\`${e.minutes ? ` (${e.minutes}m)` : ""} · ${e.date}`)
            .join("\n")
        : ar
          ? "- لا توجد استثناءات معلقة."
          : "- No pending exception requests.";
    const reimbLines =
      h.pendingReimbursements.length > 0
        ? h.pendingReimbursements
            .slice(0, 6)
            .map((r) => `- **${r.workerName}** — ${r.type} · **${r.amount} EGP** (${r.stage})`)
            .join("\n")
        : ar
          ? "- لا توجد مطالبات مصاريف معلقة."
          : "- No pending reimbursement claims.";
    const reply = ar
      ? `**قائمة المراجعات المعلقة في HR:**\n- موظفون بانتظار الاعتماد: **${h.pendingWorkersCount}**\n- استثناءات وأوفرتايم معلقة: **${h.pendingExceptionsCount}**\n${exLines}\n\n- مطالبات مصاريف معلقة: **${h.pendingReimbursementsCount}**\n${reimbLines}`
      : `**Pending HR Review Queue:**\n- Workers awaiting approval: **${h.pendingWorkersCount}**\n- Pending exceptions & overtime: **${h.pendingExceptionsCount}**\n${exLines}\n\n- Pending reimbursements: **${h.pendingReimbursementsCount}**\n${reimbLines}`;
    return {
      reply,
      actions: sanitizeAdminAiActions(
        [
          { label: ar ? "الاستثناءات المعلقة" : "Pending Exceptions", href: "/admin/exceptions?status=pending", kind: "filter" },
          { label: ar ? "المصاريف" : "Reimbursements", href: "/admin/reimbursements", kind: "navigate" },
          ...(h.pendingWorkersCount > 0
            ? [{ label: ar ? "اعتماد الموظفين" : "Pending Workers", href: "/admin/workers?status=pending", kind: "filter" as const }]
            : []),
        ],
        role,
      ),
      draft: null,
    };
  }

  // 6. Ops Tasks / Overdue / Pending Approval / Projects / Leads
  if (
    canOps &&
    ctx.ops &&
    (/\b(task|overdue|approval|project|lead|submission|client\s*portal)\b/i.test(q) ||
      /(مهام|متأخرة|مشاريع|عملاء|ليدز|بورتال|اعتماد مهام)/.test(message))
  ) {
    const o = ctx.ops;
    const overdueLines =
      o.overdueTasks.length > 0
        ? o.overdueTasks.slice(0, 6).map((t) => `- **${t.title}** (${t.assignee}) — due ${t.dueDate}`).join("\n")
        : ar
          ? "- لا توجد مهام متأخرة حالياً."
          : "- No overdue tasks right now.";
    const approvalLines =
      o.pendingApprovalTasks.length > 0
        ? o.pendingApprovalTasks.slice(0, 6).map((t) => `- **${t.title}** (${t.assignee} · ${t.project})`).join("\n")
        : ar
          ? "- لا توجد مهام بانتظار المراجعة."
          : "- No tasks awaiting approval.";
    const reply = ar
      ? `**ملخص العمليات والمشاريع (${ctx.todayCairoYmd}):**\n- المشاريع النشطة: **${o.activeProjects.length}** من إجمالي **${o.projectsTotal}**\n- المهام المفتوحة: **${o.openTasks}** (${o.inProgressCount} قيد التنفيذ)\n- طلبات العملاء الجديدة: **${o.newSubmissionsCount}** | بورتالات العملاء: **${o.clientPortalsCount}**\n\n**مهام بانتظار الاعتماد (${o.pendingApprovalTasks.length}):**\n${approvalLines}\n\n**مهام متأخرة (${o.overdueTasks.length}):**\n${overdueLines}`
      : `**Operations & Client Delivery Snapshot (${ctx.todayCairoYmd}):**\n- Active Projects: **${o.activeProjects.length}** / ${o.projectsTotal}\n- Open Tasks: **${o.openTasks}** (${o.inProgressCount} in-progress)\n- New Client Submissions: **${o.newSubmissionsCount}** | Client Portals: **${o.clientPortalsCount}**\n\n**Pending Approval (${o.pendingApprovalTasks.length}):**\n${approvalLines}\n\n**Overdue Tasks (${o.overdueTasks.length}):**\n${overdueLines}`;
    return {
      reply,
      actions: sanitizeAdminAiActions(
        [
          { label: ar ? "اعتماد المهام" : "Task Approvals", href: "/admin/tasks?status=pending-approval", kind: "filter" },
          { label: ar ? "المشاريع" : "Projects", href: "/admin/projects", kind: "navigate" },
          { label: ar ? "طلبات العملاء" : "New Leads", href: "/admin/submissions?status=new", kind: "filter" },
          { label: ar ? "بورتال العملاء" : "Client Portal", href: "/admin/client-portal", kind: "navigate" },
        ],
        role,
      ),
      draft: null,
    };
  }

  // 7. Default Executive Studio Briefing (role-scoped)
  const sections: string[] = [
    ar
      ? `**ملخص استوديو MFT المباشر — ${ctx.todayCairoYmd} (${ctx.cairoTimeLabel} القاهرة)**`
      : `**MFT Studio Live Briefing — ${ctx.todayCairoYmd} (${ctx.cairoTimeLabel} Cairo)**`,
  ];
  const defaultActions: AdminAiAction[] = [];

  if (ctx.hr) {
    const h = ctx.hr;
    sections.push(
      ar
        ? `- **الموارد البشرية والحضور:** ${h.liveOnlineWorkers.length} متصل الآن (${h.idleTodayWorkers.length} خامل)، ${h.lateTodayWorkers.length} متأخر اليوم، ${h.pendingExceptionsCount} استثناء معلق، ${h.pendingReimbursementsCount} مصاريف معلقة، ${h.pendingWorkersCount} موظف بانتظار التفعيل.`
        : `- **People & HR:** ${h.liveOnlineWorkers.length} active online (${h.idleTodayWorkers.length} idle), ${h.lateTodayWorkers.length} late today, ${h.pendingExceptionsCount} pending exceptions, ${h.pendingReimbursementsCount} pending reimbursements, ${h.pendingWorkersCount} pending workers.`,
    );
    defaultActions.push(
      { label: ar ? "لوحة HR" : "HR Dashboard", href: "/admin/hr" },
      { label: ar ? "الاستثناءات" : "Exceptions", href: "/admin/exceptions?status=pending", kind: "filter" },
    );
  }
  if (ctx.ops) {
    const o = ctx.ops;
    sections.push(
      ar
        ? `- **العمليات والعملاء:** ${o.activeProjects.length} مشروع نشط، ${o.openTasks} مهمة مفتوحة (${o.pendingApprovalTasks.length} بانتظار الاعتماد، ${o.overdueTasks.length} متأخرة)، ${o.newSubmissionsCount} طلب عميل جديد.`
        : `- **Operations & Clients:** ${o.activeProjects.length} active projects, ${o.openTasks} open tasks (${o.pendingApprovalTasks.length} pending approval, ${o.overdueTasks.length} overdue), ${o.newSubmissionsCount} new client leads.`,
    );
    defaultActions.push(
      { label: ar ? "المشاريع" : "Projects", href: "/admin/projects" },
      { label: ar ? "اعتماد المهام" : "Pending Approvals", href: "/admin/tasks?status=pending-approval", kind: "filter" },
    );
  }

  sections.push(
    ar
      ? "\nاسألني عن: **الحضور والمتأخرين**، **المهام المتأخرة**، **لائحة HR-POL-2026**، أو اطلب مني **إنشاء مسودة مهمة / تنبيه HR / رد على عميل**."
      : "\nAsk me about: **live attendance & late staff**, **overdue/pending tasks**, **HR-POL-2026 rules**, or ask me to **draft a task, HR alert, or client reply**.",
  );

  return {
    reply: sections.join("\n"),
    actions: sanitizeAdminAiActions(defaultActions, role),
    draft: null,
  };
}
