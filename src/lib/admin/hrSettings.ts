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
  const ref = collection(db, "exceptionRequests");
  const docRef = await addDoc(ref, {
    workerId: payload.workerId,
    workerName: payload.workerName,
    workerEmail: payload.workerEmail || "",
    type: "absent",
    leaveType: payload.leaveType,
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
