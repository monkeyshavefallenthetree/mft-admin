/**
 * Role-scoped live workspace snapshot loader for MFT Admin Super AI.
 *
 * Isolation rules:
 * - Uses caller's verified Firebase ID token via `createFirestoreRestClient` (Firestore rules reinforce scope).
 * - `ops_admin`: Projects, tasks, client submissions, client portal rollouts, and non-sensitive approved worker directory
 *   (id, name, department, role ONLY — NEVER hourlyRate, expectedSalary, workSessions, exceptions, reimbursements, payroll).
 * - `hr_admin`: Workers (approved/pending), today's workSessions (live active/late/idle/hours), pending exceptions,
 *   pending reimbursements, HR settings & HR-POL-2026 rules — NEVER projects, tasks, client leads, or client portal.
 * - `super_admin`: Full Ops + HR + recent activityLog highlights.
 * - Serialized prompt context is strictly capped to `<= 6,500 chars` (safe for Groq's 8K TPM limit).
 */

import type { AdminRole } from "@/lib/admin/nav";
import { cairoYmd, formatCairoTime } from "@/lib/admin/cairoTime";
import { DEFAULT_HR_SETTINGS, isLateTodayHtml, type HrSettings } from "@/lib/admin/hrReports";
import { policyConfigFromSettings } from "@/lib/admin/hrPolicy2026";
import { effectiveSessionWorkMs, type SessionLike } from "@/lib/admin/workTime";
import { isMissionSession, toMillisSafe } from "@/lib/admin/shiftLifecycle";
import {
  createFirestoreRestClient,
  type FirestoreDocRecord,
  type ServerFirestoreClient,
} from "@/lib/server/firestoreRest";

export interface SafeWorkerRosterEntry {
  id: string;
  name: string;
  department: string;
  role: string;
  status: string;
}

export interface OpsSnapshot {
  projectsTotal: number;
  activeProjects: Array<{ id: string; name: string; client: string; status: string }>;
  tasksTotal: number;
  openTasks: number;
  pendingApprovalTasks: Array<{ id: string; title: string; assignee: string; project: string }>;
  overdueTasks: Array<{ id: string; title: string; assignee: string; dueDate: string }>;
  inProgressCount: number;
  newSubmissionsCount: number;
  latestSubmissions: Array<{ id: string; name: string; company: string; service: string; status: string }>;
  clientPortalsCount: number;
  clientPortalsSummary: string[];
  approvedWorkerRoster: SafeWorkerRosterEntry[];
}

export interface HrSnapshot {
  approvedWorkersCount: number;
  pendingWorkersCount: number;
  pendingWorkers: Array<{ id: string; name: string; department: string; role: string }>;
  approvedWorkerRoster: SafeWorkerRosterEntry[];
  todaySessionsCount: number;
  liveOnlineWorkers: Array<{ name: string; department: string; idle: boolean; hours: number; clockIn: string }>;
  lateTodayWorkers: Array<{ name: string; clockIn: string }>;
  idleTodayWorkers: string[];
  pendingExceptionsCount: number;
  pendingExceptions: Array<{
    id: string;
    workerName: string;
    type: string;
    date: string;
    minutes?: number;
  }>;
  pendingReimbursementsCount: number;
  pendingReimbursements: Array<{
    id: string;
    workerName: string;
    type: string;
    stage: string;
    amount: number;
  }>;
  hrSettings: {
    standardHours: number;
    shiftStartTime: string;
    lateCutoffTime: string;
    graceMinutes: number;
    weekendDays: number[];
    policy2026Enabled: boolean;
  };
  policySummary: string;
}

export interface AdminAiWorkspaceContext {
  role: AdminRole;
  pathname: string;
  todayCairoYmd: string;
  cairoTimeLabel: string;
  ops?: OpsSnapshot;
  hr?: HrSnapshot;
  recentActivity?: Array<{ action: string; entity: string; label: string }>;
}

function str(val: unknown, fallback = ""): string {
  return typeof val === "string" ? val.trim() : fallback;
}

function num(val: unknown, fallback = 0): number {
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

function workerFullName(data: Record<string, unknown>, fallbackId: string): string {
  const full = `${str(data.firstName)} ${str(data.lastName)}`.trim();
  return full || str(data.name) || str(data.email) || fallbackId;
}

function toSafeRoster(docs: FirestoreDocRecord[]): SafeWorkerRosterEntry[] {
  return docs
    .map((d) => ({
      id: d.id,
      name: workerFullName(d.data, d.id),
      department: str(d.data.department, "general"),
      role: str(d.data.role, "member"),
      status: str(d.data.status, "pending"),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function parseDueYmd(raw: unknown): string | null {
  if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}/.test(raw.trim())) {
    return raw.trim().slice(0, 10);
  }
  const ms = toMillisSafe(raw as Date | string | number | null | undefined);
  if (ms != null) return cairoYmd(ms);
  return null;
}

function buildPolicySummary(settings: HrSettings): string {
  const pcfg = policyConfigFromSettings(settings);
  const grace = settings.gracePeriodMinutes ?? 60;
  return [
    `HR-POL-2026 (${settings.policy2026Enabled !== false ? "Active" : "Legacy"}):`,
    `Window ${pcfg.shiftStartTime}–${pcfg.lateCutoffTime} Cairo (grace ${grace}m; 11:01+ = late, ${pcfg.permissionMinMinutes}m floor, ${pcfg.permissionRoundingBlock}m increments up to ${pcfg.permissionMaxSingleMinutes}m single cap).`,
    `Shift ${pcfg.standardHours}h; strictly 1 shift clock-in per Cairo day; 2h active-presence check-in with 10m window.`,
    `Monthly permissions: max ${pcfg.permissionMaxCount} permissions / ${pcfg.permissionMaxMinutes} min total; uncovered <=${pcfg.veryLateCutoffTime} = 0.25d, >${pcfg.veryLateCutoffTime} = 0.5d.`,
    `Overtime: strictly admin-approved only; day ${pcfg.dayOtMultiplier}x / night (${pcfg.nightWindowStart}–${pcfg.dayWindowStart}) ${pcfg.nightOtMultiplier}x${pcfg.nightShiftAllowance > 0 ? ` + ${pcfg.nightShiftAllowance} EGP night allowance` : ""}.`,
    `Annual leave: ${pcfg.probationMonths}m probation, then ${pcfg.leaveRateYear1}d/mo Year 1 (15d) and ${pcfg.leaveRateYear2}d/mo Year 2+ (21d), legal carry-over cap ${pcfg.maxCarryOverDays}d.`,
  ].join(" ");
}

export async function loadAdminAiContext(params: {
  role: AdminRole;
  pathname?: string;
  idToken?: string;
  firestore?: ServerFirestoreClient;
  nowMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<AdminAiWorkspaceContext> {
  const nowMs = params.nowMs ?? Date.now();
  const todayCairoYmd = cairoYmd(nowMs);
  const cairoTimeLabel = formatCairoTime(nowMs);
  const pathname = (params.pathname || "/admin").slice(0, 120);

  const client =
    params.firestore ??
    (params.idToken ? createFirestoreRestClient(params.idToken, params.fetchImpl ?? fetch) : null);

  const ctx: AdminAiWorkspaceContext = {
    role: params.role,
    pathname,
    todayCairoYmd,
    cairoTimeLabel,
  };

  if (!client) return ctx;

  const canOps = params.role === "super_admin" || params.role === "ops_admin";
  const canHr = params.role === "super_admin" || params.role === "hr_admin";
  const isSuper = params.role === "super_admin";

  const safeQuery = async (
    col: string,
    filters: Array<{ field: string; op: "EQUAL" | "LESS_THAN" | "GREATER_THAN"; value: unknown }> = [],
  ): Promise<FirestoreDocRecord[]> => {
    try {
      return await client.queryCollection(col, filters);
    } catch {
      return [];
    }
  };
  const safeDoc = async (docPath: string): Promise<FirestoreDocRecord | null> => {
    try {
      return await client.getDocument(docPath);
    } catch {
      return null;
    }
  };

  const [
    workersRes,
    projectsRes,
    tasksRes,
    submissionsRes,
    portalsRes,
    todaySessionsRes,
    approvedOtRes,
    pendingExceptionsRes,
    reimbursementsRes,
    hrSettingsRes,
    activityRes,
  ] = await Promise.allSettled([
    safeQuery("workers"),
    canOps ? safeQuery("projects") : Promise.resolve([]),
    canOps ? safeQuery("tasks") : Promise.resolve([]),
    canOps ? safeQuery("submissions") : Promise.resolve([]),
    canOps ? safeDoc("settings/client_portals_v1") : Promise.resolve(null),
    canHr ? safeQuery("workSessions", [{ field: "date", op: "EQUAL", value: todayCairoYmd }]) : Promise.resolve([]),
    canHr
      ? safeQuery("exceptionRequests", [{ field: "type", op: "EQUAL", value: "overtime" }])
      : Promise.resolve([]),
    canHr ? safeQuery("exceptionRequests", [{ field: "status", op: "EQUAL", value: "pending" }]) : Promise.resolve([]),
    canHr ? safeQuery("reimbursements") : Promise.resolve([]),
    canHr ? safeDoc("settings/hr") : Promise.resolve(null),
    isSuper ? safeQuery("activityLog") : Promise.resolve([]),
  ]);

  const allWorkerDocs = workersRes.status === "fulfilled" ? workersRes.value : [];
  const allRoster = toSafeRoster(allWorkerDocs);
  const approvedRoster = allRoster.filter((w) => w.status === "approved");
  const workerNameById = new Map(allRoster.map((w) => [w.id, w.name]));
  const approvedIdSet = new Set(approvedRoster.map((w) => w.id));

  if (canOps) {
    const projectDocs = projectsRes.status === "fulfilled" ? projectsRes.value : [];
    const taskDocs = tasksRes.status === "fulfilled" ? tasksRes.value : [];
    const submissionDocs = submissionsRes.status === "fulfilled" ? submissionsRes.value : [];
    const portalsDoc = portalsRes.status === "fulfilled" ? portalsRes.value : null;

    const activeProjects = projectDocs
      .filter((p) => {
        const st = str(p.data.status, "active").toLowerCase();
        return st !== "completed" && st !== "archived";
      })
      .slice(0, 12)
      .map((p) => ({
        id: p.id,
        name: str(p.data.name, "Untitled"),
        client: str(p.data.clientName || p.data.client, "—"),
        status: str(p.data.status, "active"),
      }));

    const pendingApprovalTasks: OpsSnapshot["pendingApprovalTasks"] = [];
    const overdueTasks: OpsSnapshot["overdueTasks"] = [];
    let openTasks = 0;
    let inProgressCount = 0;

    for (const t of taskDocs) {
      const status = str(t.data.status, "assigned");
      if (status !== "completed") {
        openTasks += 1;
        if (status === "in-progress") inProgressCount += 1;
      }
      const title = str(t.data.title, "Untitled Task");
      const assignee =
        str(t.data.assignedWorkerName) ||
        (typeof t.data.assignedTo === "string" ? workerNameById.get(t.data.assignedTo) ?? t.data.assignedTo : "Unassigned");
      const project = str(t.data.projectName, "General");

      if (status === "pending-approval" && pendingApprovalTasks.length < 8) {
        pendingApprovalTasks.push({ id: t.id, title, assignee, project });
      }

      if (status !== "completed" && overdueTasks.length < 8) {
        const dueYmd = parseDueYmd(t.data.dueDate);
        if (dueYmd && dueYmd < todayCairoYmd) {
          overdueTasks.push({ id: t.id, title, assignee, dueDate: dueYmd });
        }
      }
    }

    const newSubs = submissionDocs.filter((s) => {
      const st = str(s.data.status);
      return !st || st === "new";
    });
    const latestSubmissions = [...submissionDocs]
      .sort((a, b) => (toMillisSafe(b.data.createdAt as Date | null) ?? 0) - (toMillisSafe(a.data.createdAt as Date | null) ?? 0))
      .slice(0, 6)
      .map((s) => ({
        id: s.id,
        name: str(s.data.name || s.data.fullName || s.data.clientName, "Lead"),
        company: str(s.data.company || s.data.businessName, ""),
        service: str(s.data.service || s.data.projectType, ""),
        status: str(s.data.status, "new"),
      }));

    const portalsRaw = portalsDoc?.data?.portals;
    const portalList = Array.isArray(portalsRaw) ? portalsRaw : [];
    const clientPortalsSummary = portalList.slice(0, 6).map((p) => {
      const rec = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
      const brand = str(rec.brandName || rec.clientName || rec.name, "Client Portal");
      const feedCount = Array.isArray(rec.feedPosts) ? rec.feedPosts.length : 0;
      const storiesCount = Array.isArray(rec.dailyStories) ? rec.dailyStories.length : 0;
      return `${brand} (${feedCount} posts, ${storiesCount} stories)`;
    });

    ctx.ops = {
      projectsTotal: projectDocs.length,
      activeProjects,
      tasksTotal: taskDocs.length,
      openTasks,
      pendingApprovalTasks,
      overdueTasks,
      inProgressCount,
      newSubmissionsCount: newSubs.length,
      latestSubmissions,
      clientPortalsCount: portalList.length,
      clientPortalsSummary,
      // Ops receives ONLY non-sensitive directory info (no hourlyRate/salary/HR records)
      approvedWorkerRoster: approvedRoster.slice(0, 25),
    };
  }

  if (canHr) {
    const todaySessionDocs = todaySessionsRes.status === "fulfilled" ? todaySessionsRes.value : [];
    const approvedOtDocs = approvedOtRes.status === "fulfilled" ? approvedOtRes.value : [];
    const pendingExDocs = pendingExceptionsRes.status === "fulfilled" ? pendingExceptionsRes.value : [];
    const reimbDocs = reimbursementsRes.status === "fulfilled" ? reimbursementsRes.value : [];
    const hrSettingsDoc = hrSettingsRes.status === "fulfilled" ? hrSettingsRes.value : null;

    const hrSettingsMerged: HrSettings = {
      ...DEFAULT_HR_SETTINGS,
      ...((hrSettingsDoc?.data ?? {}) as Partial<HrSettings>),
    };
    const stdHours = hrSettingsMerged.standardHours || 8;

    const approvedTodayOtByWorker = new Map<string, number>();
    for (const r of approvedOtDocs) {
      if (str(r.data.status) !== "approved") continue;
      const d = str(r.data.exceptionDate || r.data.date).slice(0, 10);
      const wId = str(r.data.workerId);
      if (!wId || d !== todayCairoYmd) continue;
      const mins = num(r.data.lateMinutes ?? r.data.overtimeMinutes, 0);
      if (mins > 0) {
        approvedTodayOtByWorker.set(wId, (approvedTodayOtByWorker.get(wId) ?? 0) + mins);
      }
    }

    const liveOnlineWorkers: HrSnapshot["liveOnlineWorkers"] = [];
    const lateTodayWorkers: HrSnapshot["lateTodayWorkers"] = [];
    const idleTodayWorkers: string[] = [];
    let validTodaySessions = 0;

    for (const sDoc of todaySessionDocs) {
      const sData = { id: sDoc.id, ...sDoc.data } as SessionLike & {
        workerId?: string;
        workerName?: string;
        presenceStatus?: string;
      };
      const wId = str(sData.workerId);
      if (!wId || !approvedIdSet.has(wId)) continue;
      const startMs = toMillisSafe(sData.startTime) ?? toMillisSafe(sData.loginTime);
      if (startMs == null) continue;
      validTodaySessions += 1;

      const wName = str(sData.workerName) || workerNameById.get(wId) || wId;
      const dept = allRoster.find((w) => w.id === wId)?.department || "general";
      const clockIn = formatCairoTime(startMs);
      const approvedOt = approvedTodayOtByWorker.get(wId) ?? 0;

      if (!isMissionSession(sData) && sData.isActive) {
        const ms = effectiveSessionWorkMs(sData, nowMs, {
          standardHours: stdHours,
          approvedOvertimeMinutes: approvedOt,
        });
        const hours = Math.round((ms / 3_600_000) * 10) / 10;
        const isIdle = sData.presenceStatus === "idle";
        liveOnlineWorkers.push({ name: wName, department: dept, idle: isIdle, hours, clockIn });
        if (isIdle) idleTodayWorkers.push(wName);
      }

      if (!isMissionSession(sData) && isLateTodayHtml(sData, hrSettingsMerged)) {
        lateTodayWorkers.push({ name: wName, clockIn });
      }
    }

    const pendingReimbs = reimbDocs.filter((r) => {
      const st = str(r.data.stage);
      return st === "pre_approval" || st === "review";
    });

    const pendingWorkers = allRoster
      .filter((w) => w.status === "pending")
      .slice(0, 10)
      .map((w) => ({ id: w.id, name: w.name, department: w.department, role: w.role }));

    ctx.hr = {
      approvedWorkersCount: approvedRoster.length,
      pendingWorkersCount: allRoster.filter((w) => w.status === "pending").length,
      pendingWorkers,
      approvedWorkerRoster: approvedRoster.slice(0, 25),
      todaySessionsCount: validTodaySessions,
      liveOnlineWorkers: liveOnlineWorkers.slice(0, 20),
      lateTodayWorkers: lateTodayWorkers.slice(0, 15),
      idleTodayWorkers: idleTodayWorkers.slice(0, 15),
      pendingExceptionsCount: pendingExDocs.length,
      pendingExceptions: pendingExDocs.slice(0, 10).map((e) => ({
        id: e.id,
        workerName: str(e.data.workerName) || workerNameById.get(str(e.data.workerId)) || "Worker",
        type: str(e.data.type, "exception"),
        date: str(e.data.exceptionDate || e.data.date, todayCairoYmd),
        minutes: num(e.data.lateMinutes ?? e.data.overtimeMinutes, 0) || undefined,
      })),
      pendingReimbursementsCount: pendingReimbs.length,
      pendingReimbursements: pendingReimbs.slice(0, 8).map((r) => ({
        id: r.id,
        workerName: str(r.data.workerName) || workerNameById.get(str(r.data.workerId)) || "Worker",
        type: str(r.data.type, "outdoor"),
        stage: str(r.data.stage, "review"),
        amount: num(r.data.amount, 0),
      })),
      hrSettings: {
        standardHours: stdHours,
        shiftStartTime: policyConfigFromSettings(hrSettingsMerged).shiftStartTime,
        lateCutoffTime: policyConfigFromSettings(hrSettingsMerged).lateCutoffTime,
        graceMinutes: hrSettingsMerged.gracePeriodMinutes ?? 60,
        weekendDays: hrSettingsMerged.weekendDays ?? [5, 6],
        policy2026Enabled: hrSettingsMerged.policy2026Enabled !== false,
      },
      policySummary: buildPolicySummary(hrSettingsMerged),
    };
  }

  if (isSuper) {
    const actDocs = activityRes.status === "fulfilled" ? activityRes.value : [];
    ctx.recentActivity = [...actDocs]
      .sort((a, b) => (toMillisSafe(b.data.createdAt as Date | null) ?? 0) - (toMillisSafe(a.data.createdAt as Date | null) ?? 0))
      .slice(0, 6)
      .map((a) => ({
        action: str(a.data.action, "updated"),
        entity: str(a.data.entity, "system"),
        label: str(a.data.label, a.id),
      }));
  }

  return ctx;
}

/**
 * Serializes the role-scoped workspace context into a compact prompt block
 * strictly bounded to `<= maxChars` (default 6,200 chars, safely below Groq's 8K TPM ceiling).
 */
export function serializeAdminContext(ctx: AdminAiWorkspaceContext, maxChars = 6_200): string {
  const lines: string[] = [
    `Date (Africa/Cairo): ${ctx.todayCairoYmd} ${ctx.cairoTimeLabel} | Admin Role: ${ctx.role} | Current Page: ${ctx.pathname}`,
  ];

  if (ctx.ops) {
    const o = ctx.ops;
    lines.push(
      `[OPS] Projects: ${o.projectsTotal} total, ${o.activeProjects.length} active. Tasks: ${o.tasksTotal} total, ${o.openTasks} open, ${o.inProgressCount} in-progress, ${o.pendingApprovalTasks.length} pending-approval, ${o.overdueTasks.length} overdue. New client submissions: ${o.newSubmissionsCount}. Client portals: ${o.clientPortalsCount}.`,
    );
    if (o.activeProjects.length > 0) {
      lines.push(
        `Active Projects: ${o.activeProjects
          .slice(0, 8)
          .map((p) => `${p.name} (${p.client}, ${p.status}) [id:${p.id}]`)
          .join("; ")}`,
      );
    }
    if (o.pendingApprovalTasks.length > 0) {
      lines.push(
        `Pending-Approval Tasks: ${o.pendingApprovalTasks
          .slice(0, 6)
          .map((t) => `"${t.title}" by ${t.assignee} (${t.project})`)
          .join("; ")}`,
      );
    }
    if (o.overdueTasks.length > 0) {
      lines.push(
        `Overdue Tasks: ${o.overdueTasks
          .slice(0, 6)
          .map((t) => `"${t.title}" (${t.assignee}, due ${t.dueDate})`)
          .join("; ")}`,
      );
    }
    if (o.latestSubmissions.length > 0) {
      lines.push(
        `Latest Client Leads: ${o.latestSubmissions
          .slice(0, 5)
          .map((s) => `${s.name}${s.company ? `/${s.company}` : ""} [${s.status}]`)
          .join("; ")}`,
      );
    }
    if (o.clientPortalsSummary.length > 0) {
      lines.push(`Client Portals: ${o.clientPortalsSummary.join("; ")}`);
    }
    if (!ctx.hr && o.approvedWorkerRoster.length > 0) {
      lines.push(
        `Team Directory (approved): ${o.approvedWorkerRoster
          .slice(0, 18)
          .map((w) => `${w.name} (${w.department}) [id:${w.id}]`)
          .join(", ")}`,
      );
    }
  }

  if (ctx.hr) {
    const h = ctx.hr;
    lines.push(
      `[HR] Workers: ${h.approvedWorkersCount} approved, ${h.pendingWorkersCount} pending. Today sessions: ${h.todaySessionsCount}, live online: ${h.liveOnlineWorkers.length}, idle: ${h.idleTodayWorkers.length}, late: ${h.lateTodayWorkers.length}. Pending exceptions: ${h.pendingExceptionsCount}. Pending reimbursements: ${h.pendingReimbursementsCount}.`,
    );
    if (h.liveOnlineWorkers.length > 0) {
      lines.push(
        `Live Online Today: ${h.liveOnlineWorkers
          .slice(0, 12)
          .map((w) => `${w.name} (${w.department}, in ${w.clockIn}, ${w.hours}h${w.idle ? ", IDLE" : ""})`)
          .join("; ")}`,
      );
    }
    if (h.lateTodayWorkers.length > 0) {
      lines.push(
        `Late Today: ${h.lateTodayWorkers.slice(0, 10).map((w) => `${w.name} (${w.clockIn})`).join(", ")}`,
      );
    }
    if (h.pendingWorkers.length > 0) {
      lines.push(
        `Pending Workers: ${h.pendingWorkers.slice(0, 6).map((w) => `${w.name} (${w.department})`).join(", ")}`,
      );
    }
    if (h.pendingExceptions.length > 0) {
      lines.push(
        `Pending Exceptions: ${h.pendingExceptions
          .slice(0, 8)
          .map((e) => `${e.workerName}: ${e.type}${e.minutes ? ` ${e.minutes}m` : ""} on ${e.date}`)
          .join("; ")}`,
      );
    }
    if (h.pendingReimbursements.length > 0) {
      lines.push(
        `Pending Reimbursements: ${h.pendingReimbursements
          .slice(0, 6)
          .map((r) => `${r.workerName}: ${r.type} ${r.amount} EGP (${r.stage})`)
          .join("; ")}`,
      );
    }
    if (h.approvedWorkerRoster.length > 0) {
      lines.push(
        `Approved Roster: ${h.approvedWorkerRoster
          .slice(0, 18)
          .map((w) => `${w.name} (${w.department}) [id:${w.id}]`)
          .join(", ")}`,
      );
    }
    lines.push(h.policySummary);
  }

  if (ctx.recentActivity && ctx.recentActivity.length > 0) {
    lines.push(
      `Recent Activity: ${ctx.recentActivity
        .slice(0, 5)
        .map((a) => `${a.action} ${a.entity}: ${a.label}`)
        .join("; ")}`,
    );
  }

  const joined = lines.join("\n");
  if (joined.length <= maxChars) return joined;
  return `${joined.slice(0, maxChars - 18)}\n...(truncated)`;
}
