"use client";

/**
 * Shared HR request (exceptionRequests) data access + approve / reject actions.
 * Used by both the HR Dashboard Inbox and the /admin/exceptions page so both run the exact same logic.
 */
import { collection, doc, onSnapshot, serverTimestamp, writeBatch, addDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { logActivity } from "@/lib/admin/activity";
import { sendExpoPushToWorkers } from "@/lib/chatNotifications";
import { notifyAdmins } from "@/lib/adminNotifications";
import { checkAnnualLeave, checkMonthlyPermission, type InsightWorker } from "@/components/admin/hr/ExceptionPolicyInsight";
import { chargeableMinutes, type Policy2026Config } from "@/lib/admin/hrPolicy2026";

export interface ExceptionRequest {
  id: string;
  workerId?: string;
  workerName?: string;
  workerEmail?: string;
  type?: string;
  lateMinutes?: number;
  leaveDays?: number;
  missionHours?: number;
  screenshotUrl?: string;
  workerLat?: number;
  workerLng?: number;
  nearestLocationName?: string;
  distanceMeters?: number;
  requestedAmount?: number;
  exceptionDate?: string;
  endDate?: string;
  reason?: string;
  supportingEvidence?: string;
  status?: string;
  adminResponse?: string;
  approvedAt?: { toDate: () => Date };
  approvedBy?: string;
  rejectedAt?: { toDate: () => Date };
  rejectedBy?: string;
  responseAt?: { toDate: () => Date };
  responseBy?: string;
  createdAt?: { toDate: () => Date };
  submittedAt?: { toDate: () => Date };
}

export function formatExceptionType(type: string | undefined) {
  if (type === "external_mission") return "🚗 External Mission (مأمورية خارجية)";
  if (type === "late") return "Late Excuse (استثناء تأخير)";
  if (type === "advance_late") return "Late Permission (إذن تأخير شهري)";
  if (type === "early_permission") return "Early Leave Permission (إذن انصراف مبكر)";
  if (type === "absent") return "Absent for day (غياب)";
  if (type === "overtime") return "Overtime request (وقت إضافي)";
  if (type === "annual_leave") return "Annual Leave (إجازة سنوية)";
  if (type === "unpaid_leave") return "Unpaid Leave (إجازة بدون مرتب)";
  if (type === "sick_leave") return "Sick Leave (إجازة مرضية)";
  if (type === "emergency_leave") return "Emergency Leave (إجازة عارضة)";
  if (type === "advance_request") return "Salary Advance (سلفة)";
  return type || "Other";
}

export const adminId = () => auth.currentUser?.email ?? "admin";
export const statusOf = (e: ExceptionRequest) => e.status || "pending";

/** Time the request was submitted (createdAt, falling back to submittedAt). */
export function requestSubmittedAt(e: ExceptionRequest): Date | null {
  return e.createdAt?.toDate?.() ?? e.submittedAt?.toDate?.() ?? null;
}

/** Live subscription to all exception requests, newest first. */
export function subscribeExceptionRequests(
  callback: (rows: ExceptionRequest[]) => void,
  onError?: (err: Error) => void,
): () => void {
  return onSnapshot(
    collection(db, "exceptionRequests"),
    (snap) => {
      const list: ExceptionRequest[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() } as ExceptionRequest));
      list.sort((a, b) => {
        const ta = a.createdAt?.toDate?.()?.getTime() ?? a.submittedAt?.toDate?.()?.getTime() ?? 0;
        const tb = b.createdAt?.toDate?.()?.getTime() ?? b.submittedAt?.toDate?.()?.getTime() ?? 0;
        return tb - ta;
      });
      callback(list);
    },
    (err) => onError?.(err),
  );
}

export interface RequestPolicyContext {
  /** All exception requests (needed for monthly quota / leave balance checks). */
  items: ExceptionRequest[];
  workersById: Map<string, InsightWorker>;
  policyCfg: Policy2026Config;
  policyEffectiveFrom?: string;
}

/**
 * Approves requests after validating HR-POL-2026 annual/emergency leave and monthly permission quotas.
 * Writes ledger entries (permissions), mission work sessions, and salary-advance payroll adjustments.
 * Throws if the Firestore batch fails.
 */
export async function approveExceptionRequests(
  requestedIds: string[],
  ctx: RequestPolicyContext,
): Promise<{ approvedIds: string[]; blocked: string[] }> {
  const { items, workersById, policyCfg, policyEffectiveFrom } = ctx;
  const byId = (id: string) => items.find((i) => i.id === id);

  // HR-POL-2026: validate annual/emergency leave and monthly permission quotas before approving.
  const blocked: string[] = [];
  const ids = requestedIds.filter((id) => {
    const e = byId(id);
    if (!e || !e.workerId) return true;
    if (e.type === "annual_leave" || e.type === "emergency_leave") {
      const res = checkAnnualLeave(e, workersById.get(e.workerId), items, policyCfg, policyEffectiveFrom);
      if (res && !res.verdict.ok) {
        blocked.push(`${e.workerName ?? "Worker"}: ${res.verdict.reasonAr}`);
        return false;
      }
    }
    if (e.type === "advance_late" || e.type === "early_permission") {
      const res = checkMonthlyPermission(e, items, policyCfg);
      if (!res.verdict.ok) {
        blocked.push(`${e.workerName ?? "Worker"}: ${res.verdict.reasonAr}`);
        return false;
      }
    }
    return true;
  });
  if (!ids.length) return { approvedIds: [], blocked };

  const batch = writeBatch(db);
  ids.forEach((id) => {
    batch.update(doc(db, "exceptionRequests", id), {
      status: "approved",
      approvedAt: serverTimestamp(),
      approvedBy: adminId(),
    });
    const e = byId(id);
    // Atomically record a covered permission ledger entry when an advance late permission, early leave permission, or late excuse is approved
    if ((e?.type === "advance_late" || e?.type === "early_permission" || e?.type === "late") && e.workerId && e.exceptionDate) {
      const actualMins = Number(e.lateMinutes) || 30;
      const isEarly = e.type === "early_permission";
      const suffix = isEarly ? "early" : "late";
      batch.set(
        doc(db, "permissionLedger", `${e.workerId}_${e.exceptionDate}_${suffix}`),
        {
          workerId: e.workerId,
          workerName: e.workerName || "Worker",
          date: e.exceptionDate,
          kind: isEarly ? "early_leave" : "late",
          actualMinutes: actualMins,
          chargedMinutes: e.type === "late" ? 0 : chargeableMinutes(actualMins, policyCfg),
          covered: true,
          status: "applied",
          source: "admin",
          reason: `[Approved ${e.type}] ${e.reason || ""}`.trim(),
          note: `[Approved ${e.type}] ${e.reason || ""}`.trim(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    }
    // When an external mission is approved, credit its hours in workSessions for that date & unlock shift
    if (e?.type === "external_mission" && e.workerId) {
      const missionDate = e.exceptionDate || new Date().toISOString().split("T")[0];
      const hrs = Math.max(0.5, Number(e.missionHours) || Math.round(((Number(e.lateMinutes) || 60) / 60) * 10) / 10);
      const missionMs = Math.round(hrs * 3600 * 1000);
      const startAt = new Date(`${missionDate}T10:00:00`);
      const endAt = new Date(startAt.getTime() + missionMs);
      batch.set(
        doc(db, "workSessions", `mission_${e.id}`),
        {
          workerId: e.workerId,
          workerName: e.workerName || "Worker",
          workerEmail: e.workerEmail || "",
          date: missionDate,
          loginTime: startAt,
          startTime: startAt,
          logoutTime: endAt,
          endTime: endAt,
          isActive: false,
          presenceStatus: "offline",
          totalWorkTime: missionMs,
          isExternalMission: true,
          missionRequestId: e.id,
          missionHoursApproved: hrs,
          currentTaskTitle: `[مأمورية خارجية معتمدة — ${hrs} ساعة] ${e.reason || ""}`.trim(),
          createdAt: serverTimestamp(),
          lastUpdated: serverTimestamp(),
        },
        { merge: true },
      );
    }
  });
  await batch.commit();

  ids.forEach((id) => {
    const e = byId(id);
    void logActivity({ action: "approved", entity: "exception", entityId: id, label: `${formatExceptionType(e?.type)} · ${e?.workerName ?? "worker"}`, detail: e?.exceptionDate });
    if (e?.workerId) {
      void sendExpoPushToWorkers(db, {
        recipientUids: [e.workerId],
        title: `${formatExceptionType(e.type)} Approved ✓`,
        body: e.adminResponse || `Your request for ${e.exceptionDate ?? "today"} has been approved.`,
        tab: "exceptions",
      });
    }
    void notifyAdmins(db, {
      targetRoles: ["super_admin", "hr_admin"],
      category: "hr",
      eventType: "exception_approved",
      title: `✅ ${formatExceptionType(e?.type)} Approved: ${e?.workerName ?? "Worker"}`,
      body: `Approved by ${adminId()} for ${e?.exceptionDate ?? "today"}.`,
      href: "/admin/exceptions?status=approved",
      actorUid: auth.currentUser?.uid,
      actorName: adminId(),
    });
    // Automatically sync salary advances to payroll adjustments
    if (e?.type === "advance_request" && e.workerId && Number(e.requestedAmount) > 0) {
      void addDoc(collection(db, "payrollAdjustments"), {
        workerId: e.workerId,
        workerName: e.workerName || "Worker",
        type: "advance",
        amount: Number(e.requestedAmount),
        date: e.exceptionDate || new Date().toISOString().split("T")[0],
        reason: `[Approved Advance Request] ${e.reason || ""}`.trim(),
        status: "applied",
        createdAt: serverTimestamp(),
        createdBy: adminId(),
      });
    }
  });

  return { approvedIds: ids, blocked };
}

/**
 * Rejects requests (optionally with an HR note) and marks any related permission ledger entry as not covered.
 * Throws if the Firestore batch fails.
 */
export async function rejectExceptionRequests(
  ids: string[],
  items: ExceptionRequest[],
  note: string,
): Promise<void> {
  const byId = (id: string) => items.find((i) => i.id === id);
  const text = note.trim();
  const batch = writeBatch(db);
  ids.forEach((id) => {
    const u: Record<string, unknown> = { status: "rejected", rejectedAt: serverTimestamp(), rejectedBy: adminId() };
    if (text) u.adminResponse = text;
    batch.update(doc(db, "exceptionRequests", id), u);
    const x = byId(id);
    if ((x?.type === "advance_late" || x?.type === "early_permission" || x?.type === "late") && x.workerId && x.exceptionDate) {
      const isEarly = x.type === "early_permission";
      const suffix = isEarly ? "early" : "late";
      batch.set(
        doc(db, "permissionLedger", `${x.workerId}_${x.exceptionDate}_${suffix}`),
        {
          workerId: x.workerId,
          date: x.exceptionDate,
          kind: isEarly ? "early_leave" : "late",
          covered: false,
          chargedMinutes: 0,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    }
  });
  await batch.commit();
  ids.forEach((id) => {
    const x = byId(id);
    void logActivity({ action: "rejected", entity: "exception", entityId: id, label: `${formatExceptionType(x?.type)} · ${x?.workerName ?? "worker"}`, detail: text || undefined });
    if (x?.workerId) {
      void sendExpoPushToWorkers(db, {
        recipientUids: [x.workerId],
        title: `${formatExceptionType(x.type)} Rejected`,
        body: text || `Your request for ${x.exceptionDate ?? "today"} was not approved.`,
        tab: "exceptions",
        urgent: true,
      });
    }
    void notifyAdmins(db, {
      targetRoles: ["super_admin", "hr_admin"],
      category: "hr",
      eventType: "exception_rejected",
      title: `❌ ${formatExceptionType(x?.type)} Rejected: ${x?.workerName ?? "Worker"}`,
      body: text || `Rejected by ${adminId()} for ${x?.exceptionDate ?? "today"}.`,
      href: "/admin/exceptions?status=rejected",
      actorUid: auth.currentUser?.uid,
      actorName: adminId(),
      urgent: true,
    });
  });
}
