import type { SessionForHr } from "@/lib/admin/hrReports";

export interface Worker {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  role: string;
  status: string;
  department?: string;
  employmentType?: string;
  skills?: string[];
  isOnline?: boolean;
  hourlyRate?: number;
  expectedSalary?: number | string;
  expectedHours?: number;
  emergencyContact?: string | Record<string, string>;
  lastLogin?: { toDate: () => Date };
  hireDate?: string;
  attendanceStartDate?: string;
  leaveLawType?: "new_15" | "legacy_21";
  priorUsedLeaveDays?: number;
  carriedOverLeaveDays?: number;
  carryOverApprovedBy?: string;
  createdAt?: { toDate: () => Date };
}

export interface WorkSession extends SessionForHr {
  id: string;
  workerName?: string;
  isLate?: boolean;
  department?: string;
  isActive?: boolean;
}

export interface TaskDoc {
  id: string;
  title: string;
  status: string;
  priority?: string;
  assignedTo?: string | string[];
  projectName?: string;
  createdAt?: { toDate: () => Date };
}

export interface AlertDoc {
  id: string;
  type?: string;
  title?: string;
  message?: string;
  recipient?: string;
  department?: string;
  workerId?: string;
  priority?: string;
  penalty?: string;
  penaltyReason?: string;
  recipients?: string[];
  sentBy?: string;
  sentAt?: { toDate: () => Date };
  createdAt?: { toDate: () => Date };
  recipientCount?: number;
  isRead?: boolean;
  hasPenalty?: boolean;
  penaltyApplied?: number;
  readBy?: string[];
  resent?: boolean;
  originalAlertId?: string;
}

export interface HrSummary {
  presentToday: number;
  absentToday: number;
  lateToday: number;
  overtimeToday: number;
  attendanceRate: number;
  payrollHoursToday: number;
}
