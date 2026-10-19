import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  addDoc,
  deleteDoc,
  updateDoc,
  serverTimestamp,
  getDocs,
  getDoc,
  query,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  DEFAULT_HR_SETTINGS,
  EGYPTIAN_HOLIDAYS_TEMPLATE,
  type HrSettings,
  type HolidayItem,
  type PayrollAdjustment,
} from "./hrReports";
import type {
  PermissionLedgerEntry,
  ReimbursementFlag,
  ReimbursementStage,
  ReimbursementType,
} from "./hrPolicy2026";

export interface PayrollCycleRecord {
  id: string; // e.g. "cycle_2026-09-21_2026-10-20"
  cycleLabel: string;
  periodStart: string; // YYYY-MM-DD
  periodEnd: string; // YYYY-MM-DD
  status: "draft" | "approved" | "paid";
  totalGrossPay?: number;
  totalNetPay?: number;
  totalWorkers?: number;
  approvedAt?: { toDate: () => Date } | null;
  approvedBy?: string;
  paidAt?: { toDate: () => Date } | null;
  paidBy?: string;
  notes?: string;
  updatedAt?: unknown;
}

/**
 * Real-time subscription to HR settings from Firestore (`settings/hr`).
 */
export function subscribeHrSettings(callback: (settings: HrSettings) => void): () => void {
  const ref = doc(db, "settings", "hr");
  return onSnapshot(
    ref,
    (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        callback({
          ...DEFAULT_HR_SETTINGS,
          ...data,
        });
      } else {
        callback(DEFAULT_HR_SETTINGS);
      }
    },
    (err) => {
      console.warn("Error subscribing to hr settings:", err);
      callback(DEFAULT_HR_SETTINGS);
    },
  );
}

/**
 * Saves/updates HR settings in Firestore (`settings/hr`).
 */
export async function saveHrSettings(settings: Partial<HrSettings>, adminEmail = "admin"): Promise<void> {
  const ref = doc(db, "settings", "hr");
  await setDoc(
    ref,
    {
      ...settings,
      updatedAt: serverTimestamp(),
      updatedBy: adminEmail,
    },
    { merge: true },
  );
}

/**
 * Real-time subscription to official holidays collection.
 */
export function subscribeHolidays(callback: (holidays: HolidayItem[]) => void): () => void {
  const ref = collection(db, "holidays");
  return onSnapshot(
    ref,
    (snap) => {
      const list: HolidayItem[] = [];
      snap.forEach((d) => {
        list.push({ id: d.id, ...d.data() } as HolidayItem);
      });
      list.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
      callback(list);
    },
    (err) => {
      console.warn("Error subscribing to holidays:", err);
      callback([]);
    },
  );
}

/**
 * Adds an official holiday to Firestore.
 */
export async function addHoliday(
  item: Omit<HolidayItem, "id">,
  adminEmail = "admin",
): Promise<string> {
  const ref = collection(db, "holidays");
  const docRef = await addDoc(ref, {
    ...item,
    createdAt: serverTimestamp(),
    createdBy: adminEmail,
  });
  return docRef.id;
}

/**
 * Deletes an official holiday by ID.
 */
export async function deleteHoliday(id: string): Promise<void> {
  await deleteDoc(doc(db, "holidays", id));
}

/**
 * Imports the standard Egyptian national holidays template into Firestore.
 * Skips items that already exist for the same date.
 */
export async function seedDefaultEgyptianHolidays(adminEmail = "admin"): Promise<number> {
  const snap = await getDocs(collection(db, "holidays"));
  const existingDates = new Set<string>();
  snap.forEach((d) => {
    const data = d.data();
    if (data.date) existingDates.add(data.date);
  });

  const batch = writeBatch(db);
  let addedCount = 0;

  for (const h of EGYPTIAN_HOLIDAYS_TEMPLATE) {
    if (!existingDates.has(h.date)) {
      const newRef = doc(collection(db, "holidays"));
      batch.set(newRef, {
        ...h,
        createdAt: serverTimestamp(),
        createdBy: adminEmail,
      });
      addedCount++;
    }
  }

  if (addedCount > 0) {
    await batch.commit();
  }
  return addedCount;
}

/**
 * Real-time subscription to payroll adjustments (advances, allowances, bonuses, deductions).
 */
export function subscribePayrollAdjustments(
  callback: (adjustments: PayrollAdjustment[]) => void,
): () => void {
  const ref = collection(db, "payrollAdjustments");
  return onSnapshot(
    ref,
    (snap) => {
      const list: PayrollAdjustment[] = [];
      snap.forEach((d) => {
        list.push({ id: d.id, ...d.data() } as PayrollAdjustment);
      });
      list.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      callback(list);
    },
    (err) => {
      console.warn("Error subscribing to payroll adjustments:", err);
      callback([]);
    },
  );
}

/**
 * Records a cash advance (سلفة), allowance (بدل), bonus, or disciplinary deduction.
 */
export async function addPayrollAdjustment(
  adjustment: Omit<PayrollAdjustment, "id">,
  adminEmail = "admin",
): Promise<string> {
  const ref = collection(db, "payrollAdjustments");
  const docRef = await addDoc(ref, {
    ...adjustment,
    status: adjustment.status || "applied",
    createdAt: serverTimestamp(),
    createdBy: adminEmail,
  });
  return docRef.id;
}

/**
 * Deletes a payroll adjustment.
 */
export async function deletePayrollAdjustment(id: string): Promise<void> {
  await deleteDoc(doc(db, "payrollAdjustments", id));
}

/**
 * Real-time subscription to payroll cycle records.
 */
export function subscribePayrollCycles(
  callback: (cycles: Record<string, PayrollCycleRecord>) => void,
): () => void {
  const ref = collection(db, "payrollCycles");
  return onSnapshot(
    ref,
    (snap) => {
      const map: Record<string, PayrollCycleRecord> = {};
      snap.forEach((d) => {
        map[d.id] = { id: d.id, ...d.data() } as PayrollCycleRecord;
      });
      callback(map);
    },
    (err) => {
      console.warn("Error subscribing to payroll cycles:", err);
      callback({});
    },
  );
}

/**
 * Updates or sets the status of a payroll cycle (e.g. draft, approved, paid).
 */
export async function setPayrollCycleStatus(
  cycleId: string,
  data: Partial<PayrollCycleRecord>,
  adminEmail = "admin",
): Promise<void> {
  const ref = doc(db, "payrollCycles", cycleId);
  await setDoc(
    ref,
    {
      ...data,
      id: cycleId,
      updatedAt: serverTimestamp(),
      updatedBy: adminEmail,
    },
    { merge: true },
  );
}

/**
 * Excuses a worker's absence or lateness for a specific date by adding an approved record
 * to `exceptionRequests`.
 */
export async function excuseWorkerAbsence(payload: {
  workerId: string;
  workerName: string;
  workerEmail?: string;
  date: string;
  leaveType: "annual" | "sick" | "casual" | "official" | "unpaid";
  reason: string;
  adminEmail?: string;
}): Promise<string> {
  const mappedType =
    payload.leaveType === "annual"
      ? "annual_leave"
      : payload.leaveType === "unpaid"
        ? "unpaid_leave"
        : payload.leaveType === "sick"
          ? "sick_leave"
          : payload.leaveType === "casual"
            ? "emergency_leave"
            : "absent";
  const ref = collection(db, "exceptionRequests");
  const docRef = await addDoc(ref, {
    workerId: payload.workerId,
    workerName: payload.workerName,
    workerEmail: payload.workerEmail || "",
    type: mappedType,
    leaveType: payload.leaveType,
    leaveDays: 1,
    exceptionDate: payload.date,
    reason: `[Approved Excuse: ${payload.leaveType.toUpperCase()}] ${payload.reason}`,
    status: "approved",
    approvedAt: serverTimestamp(),
    approvedBy: payload.adminEmail || "admin",
    createdAt: serverTimestamp(),
    submittedAt: serverTimestamp(),
  });
  return docRef.id;
}

/* ═══════════════════════════ HR-POL-2026 data ═══════════════════════════ */

export type PermissionLedgerDoc = PermissionLedgerEntry & {
  id: string;
  workerName?: string;
  createdAt?: { toDate: () => Date } | null;
  reversedAt?: { toDate: () => Date } | null;
  reversedBy?: string;
};

/** Live `permissionLedger` entries (all workers). Filter by date range on the client. */
export function subscribePermissionLedger(callback: (rows: PermissionLedgerDoc[]) => void): () => void {
  return onSnapshot(
    collection(db, "permissionLedger"),
    (snap) => {
      const list: PermissionLedgerDoc[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() } as PermissionLedgerDoc));
      list.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      callback(list);
    },
    (err) => {
      console.warn("Error subscribing to permissionLedger:", err);
      callback([]);
    },
  );
}

/** Admin reversal of a permission (restores the worker's quota). */
export async function reversePermission(id: string, adminEmail = "admin"): Promise<void> {
  await setDoc(
    doc(db, "permissionLedger", id),
    {
      status: "reversed",
      reversedAt: serverTimestamp(),
      reversedBy: adminEmail,
    },
    { merge: true },
  );
}

/** Re-applies a previously reversed permission. */
export async function reapplyPermission(id: string, adminEmail = "admin"): Promise<void> {
  await setDoc(
    doc(db, "permissionLedger", id),
    {
      status: "applied",
      reappliedAt: serverTimestamp(),
      reappliedBy: adminEmail,
    },
    { merge: true },
  );
}

export interface ApprovedRequestRow {
  id: string;
  workerId: string;
  workerName?: string;
  type: string;
  leaveType?: string;
  exceptionDate: string;
  endDate?: string;
  lateMinutes?: number | null;
  leaveDays?: number | null;
  reason?: string;
  status: string;
  createdAt?: { toDate: () => Date };
}

/** Approved overtime + leave + lateness + early permission requests (used by payroll and leave/permission balances). */
export function subscribeApprovedPolicyRequests(callback: (rows: ApprovedRequestRow[]) => void): () => void {
  const q = query(collection(db, "exceptionRequests"), where("status", "==", "approved"));
  return onSnapshot(
    q,
    (snap) => {
      const list: ApprovedRequestRow[] = [];
      snap.forEach((d) => {
        const data = d.data();
        if (
          data.type === "overtime" ||
          data.type === "annual_leave" ||
          data.type === "unpaid_leave" ||
          data.type === "sick_leave" ||
          data.type === "emergency_leave" ||
          data.type === "absence" ||
          data.type === "absent" ||
          data.type === "late" ||
          data.type === "advance_late" ||
          data.type === "early_permission"
        ) {
          list.push({ id: d.id, ...data } as ApprovedRequestRow);
        }
      });
      callback(list);
    },
    (err) => {
      console.warn("Error subscribing to approved requests:", err);
      callback([]);
    },
  );
}

/**
 * Merges `permissionLedger` entries with approved `advance_late` and `early_permission`
 * requests from `exceptionRequests` so approved permissions always reflect in worker
 * permission balances and payroll even if the ledger doc was created before approval
 * (with `covered: false`) or without a clock-in/out session.
 */
export function mergeLedgerWithApprovedRequests(
  ledger: PermissionLedgerDoc[],
  approvedRequests: ApprovedRequestRow[],
  minMinutes = 30,
  maxSingleMinutes = 120,
): PermissionLedgerDoc[] {
  const byKey = new Map<string, PermissionLedgerDoc>();
  for (const row of ledger) {
    byKey.set(`${row.workerId}_${row.date}_${row.kind}`, row);
  }
  const minStep = Math.max(1, minMinutes);
  const maxStep = Math.max(minStep, maxSingleMinutes);

  for (const req of approvedRequests) {
    if (req.status !== "approved" || !req.workerId || !req.exceptionDate) continue;
    if (req.type !== "advance_late" && req.type !== "early_permission") continue;

    const isEarly = req.type === "early_permission";
    const kind: PermissionLedgerDoc["kind"] = isEarly ? "early_leave" : "late";
    const key = `${req.workerId}_${req.exceptionDate}_${kind}`;
    const docId = `${req.workerId}_${req.exceptionDate}_${isEarly ? "early" : "late"}`;
    const rawMins = Math.max(minStep, Number(req.lateMinutes) || minStep);
    const chargedMins = Math.min(maxStep, Math.max(minStep, Math.ceil(rawMins / minStep) * minStep));
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, {
        id: docId,
        workerId: req.workerId,
        workerName: req.workerName,
        date: req.exceptionDate,
        kind,
        actualMinutes: rawMins,
        chargedMinutes: chargedMins,
        covered: true,
        fallbackPenaltyDays: 0,
        source: "admin",
        reason: req.reason || (isEarly ? "إذن انصراف مبكر معتمد" : "إذن تأخير معتمد"),
        status: "applied",
        createdAt: req.createdAt ?? null,
      });
    } else if (existing.status !== "reversed" && (!existing.covered || (existing.chargedMinutes || 0) === 0)) {
      byKey.set(key, {
        ...existing,
        covered: true,
        actualMinutes: existing.actualMinutes || rawMins,
        chargedMinutes: existing.chargedMinutes || chargedMins,
        fallbackPenaltyDays: 0,
        source: "admin",
      });
    }
  }

  return Array.from(byKey.values()).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}

export type ReimbursementDoc = {
  id: string;
  workerId: string;
  workerName?: string;
  workerEmail?: string;
  type: ReimbursementType;
  stage: ReimbursementStage;
  purpose: string;
  date: string;
  routeFrom?: string;
  routeTo?: string;
  /** Outdoor: final ride price. Purchase: estimated amount from the quote. */
  amount: number;
  quoteLink?: string | null;
  approvedAmount?: number | null;
  invoiceAmount?: number | null;
  attachmentIds?: string[];
  attachmentKinds?: string[];
  imageHashes?: string[];
  checklist?: Record<string, boolean>;
  flags?: ReimbursementFlag[];
  adminNote?: string;
  overrideReason?: string;
  payrollAdjustmentId?: string | null;
  createdAt?: { toDate: () => Date } | null;
  updatedAt?: { toDate: () => Date } | null;
  reviewedAt?: { toDate: () => Date } | null;
  reviewedBy?: string;
};

export type ReimbursementAttachmentDoc = {
  id: string;
  reimbursementId: string;
  workerId: string;
  kind: "ride_screenshot" | "quote" | "proforma" | "invoice";
  dataUrl: string;
  sha256: string;
  width?: number;
  height?: number;
  bytes?: number;
  fileName?: string;
};

export function subscribeReimbursements(callback: (rows: ReimbursementDoc[]) => void): () => void {
  return onSnapshot(
    collection(db, "reimbursements"),
    (snap) => {
      const list: ReimbursementDoc[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() } as ReimbursementDoc));
      list.sort(
        (a, b) => (b.createdAt?.toDate?.()?.getTime() ?? 0) - (a.createdAt?.toDate?.()?.getTime() ?? 0),
      );
      callback(list);
    },
    (err) => {
      console.warn("Error subscribing to reimbursements:", err);
      callback([]);
    },
  );
}

/** Loads the (heavy) image attachments of one reimbursement on demand. */
export async function loadReimbursementAttachments(r: ReimbursementDoc): Promise<ReimbursementAttachmentDoc[]> {
  const ids = r.attachmentIds ?? [];
  const out: ReimbursementAttachmentDoc[] = [];
  for (const id of ids) {
    try {
      const snap = await getDoc(doc(db, "reimbursementAttachments", id));
      if (snap.exists()) out.push({ id: snap.id, ...snap.data() } as ReimbursementAttachmentDoc);
    } catch (e) {
      console.warn("attachment load failed", id, e);
    }
  }
  return out;
}

/** Purchase stage 1: approve the quote and lock the approved amount. */
export async function approveReimbursementQuote(
  r: ReimbursementDoc,
  approvedAmount: number,
  note: string,
  adminEmail = "admin",
): Promise<void> {
  await updateDoc(doc(db, "reimbursements", r.id), {
    stage: "pending_invoice",
    approvedAmount,
    adminNote: note || "",
    preApprovedAt: serverTimestamp(),
    preApprovedBy: adminEmail,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Final approval: records a payroll allowance (source = "reimbursement") so it
 * appears on the worker's monthly payslip, then marks the claim approved.
 */
export async function approveReimbursementFinal(
  r: ReimbursementDoc,
  payload: { amount: number; note: string; checklist: Record<string, boolean>; overrideReason?: string },
  adminEmail = "admin",
): Promise<string> {
  const label = r.type === "outdoor" ? "مأمورية خارجية" : "مشتريات";
  const adjRef = await addDoc(collection(db, "payrollAdjustments"), {
    workerId: r.workerId,
    workerName: r.workerName || "",
    type: "allowance",
    amount: payload.amount,
    date: new Date().toISOString().split("T")[0],
    reason: `[${label}] ${r.purpose}${r.type === "outdoor" && r.routeFrom ? ` (${r.routeFrom} → ${r.routeTo})` : ""}`,
    status: "applied",
    source: "reimbursement",
    reimbursementId: r.id,
    createdAt: serverTimestamp(),
    createdBy: adminEmail,
  });
  await updateDoc(doc(db, "reimbursements", r.id), {
    stage: "approved",
    approvedAmount: r.type === "outdoor" ? payload.amount : r.approvedAmount ?? payload.amount,
    paidAmount: payload.amount,
    checklist: payload.checklist,
    adminNote: payload.note || "",
    overrideReason: payload.overrideReason || "",
    payrollAdjustmentId: adjRef.id,
    reviewedAt: serverTimestamp(),
    reviewedBy: adminEmail,
    updatedAt: serverTimestamp(),
  });
  return adjRef.id;
}

export async function rejectReimbursement(r: ReimbursementDoc, note: string, adminEmail = "admin"): Promise<void> {
  await updateDoc(doc(db, "reimbursements", r.id), {
    stage: "rejected",
    adminNote: note || "",
    reviewedAt: serverTimestamp(),
    reviewedBy: adminEmail,
    updatedAt: serverTimestamp(),
  });
}

/** Updates HR-POL-2026 contract, joining date, compensation, and leave onboarding fields on a worker profile. */
export async function saveWorkerLeaveProfile(
  workerId: string,
  data: {
    hireDate?: string | null;
    attendanceStartDate?: string | null;
    leaveLawType?: "new_15" | "legacy_21";
    priorUsedLeaveDays?: number;
    carriedOverLeaveDays?: number;
    carryOverApprovedBy?: string;
    hourlyRate?: number;
    expectedSalary?: number | string | null;
    status?: "approved" | "pending" | "rejected";
  },
): Promise<void> {
  await updateDoc(doc(db, "workers", workerId), { ...data, leaveProfileUpdatedAt: serverTimestamp() });
}

/** Bulk-sets the MFT system attendance start date for existing workers migrating onto the new platform. */
export async function bulkSetSystemStartDate(workerIds: string[], attendanceStartDate: string): Promise<void> {
  await Promise.all(
    workerIds.map((id) =>
      updateDoc(doc(db, "workers", id), {
        attendanceStartDate,
        leaveProfileUpdatedAt: serverTimestamp(),
      }),
    ),
  );
}

