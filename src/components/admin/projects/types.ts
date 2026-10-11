export interface Project {
  id: string;
  name: string;
  clientName?: string;
  description: string;
  projectTypes: string[];
  status: string;
  startDate?: string | null;
  endDate?: string | null;
  createdAt?: { toDate: () => Date } | any;
  updatedAt?: { toDate: () => Date } | any;
}

export interface Worker {
  id: string;
  firstName: string;
  lastName: string;
  role?: string;
  department?: string;
  status: string;
  expoPushToken?: string;
}

export interface SubtaskItem {
  id: string;
  title: string;
  description?: string;
  link?: string;
  completed: boolean;
}

export interface TaskRow {
  id: string;
  projectId?: string;
  projectName?: string;
  title: string;
  description: string;
  department?: string;
  assignedTo: string | string[];
  assignedWorkerName?: string;
  priority: string;
  status: string;
  dueDate?: { toDate?: () => Date } | Date | string | null;
  createdAt?: { toDate?: () => Date } | Date | string | null;
  updatedAt?: { toDate?: () => Date } | Date | string | null;
  photo?: string | null;
  startedAt?: { toDate?: () => Date } | Date | string | null;
  submittedForApprovalAt?: { toDate?: () => Date } | Date | string | null;
  approvedAt?: { toDate?: () => Date } | Date | string | null;
  approvedBy?: string | null;
  rejectedAt?: { toDate?: () => Date } | Date | string | null;
  rejectedBy?: string | null;
  rejectionReason?: string | null;
  subtasks?: SubtaskItem[];
  tags?: string[];
}

export type ProjectViewMode = "list" | "board" | "calendar" | "overview";
export type HubViewMode = "grid" | "table";

export type StatusCategory = "assigned" | "in-progress" | "pending-approval" | "completed";

export const STATUS_CONFIG: Record<
  string,
  { label: string; dot: string; badge: string; border: string; bg: string; text: string }
> = {
  assigned: {
    label: "TO DO",
    dot: "#3b82f6",
    badge: "bg-blue-50 text-blue-700 border-blue-300",
    border: "border-blue-500",
    bg: "bg-blue-50/50",
    text: "text-blue-700",
  },
  "in-progress": {
    label: "IN PROGRESS",
    dot: "#f59e0b",
    badge: "bg-amber-50 text-amber-800 border-amber-300",
    border: "border-amber-500",
    bg: "bg-amber-50/50",
    text: "text-amber-800",
  },
  "pending-approval": {
    label: "PENDING REVIEW",
    dot: "#d97706",
    badge: "bg-amber-100 text-amber-900 border-amber-400 font-bold",
    border: "border-amber-500",
    bg: "bg-amber-50/70",
    text: "text-amber-900",
  },
  completed: {
    label: "COMPLETED",
    dot: "#10b981",
    badge: "bg-emerald-50 text-emerald-700 border-emerald-300",
    border: "border-emerald-500",
    bg: "bg-emerald-50/50",
    text: "text-emerald-700",
  },
};

export const PRIORITY_CONFIG: Record<
  string,
  { label: string; iconColor: string; badge: string; text: string }
> = {
  urgent: {
    label: "Urgent",
    iconColor: "text-red-600",
    badge: "bg-red-50 text-red-700 border-red-300 font-bold",
    text: "text-red-700",
  },
  high: {
    label: "High",
    iconColor: "text-orange-600",
    badge: "bg-orange-50 text-orange-700 border-orange-300 font-bold",
    text: "text-orange-700",
  },
  medium: {
    label: "Normal",
    iconColor: "text-blue-600",
    badge: "bg-blue-50 text-blue-700 border-blue-300 font-medium",
    text: "text-blue-700",
  },
  low: {
    label: "Low",
    iconColor: "text-zinc-400",
    badge: "bg-zinc-50 text-zinc-600 border-zinc-200 font-normal",
    text: "text-zinc-600",
  },
};

export function getAssigneeIds(assignedTo: string | string[] | undefined | null): string[] {
  if (!assignedTo) return [];
  if (Array.isArray(assignedTo)) return assignedTo.filter(Boolean);
  if (typeof assignedTo === "string") return [assignedTo];
  return [];
}

export function parseDate(val: unknown): Date | null {
  if (!val) return null;
  if (typeof (val as { toDate?: () => Date }).toDate === "function") {
    return (val as { toDate: () => Date }).toDate();
  }
  if (val instanceof Date) return val;
  if (typeof val === "string") {
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function formatSmartDate(val: unknown): { label: string; isOverdue: boolean; isToday: boolean } {
  const d = parseDate(val);
  if (!d) return { label: "No date", isOverdue: false, isToday: false };

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return {
      label: `${Math.abs(diffDays)}d overdue (${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })})`,
      isOverdue: true,
      isToday: false,
    };
  }
  if (diffDays === 0) {
    return { label: "Today", isOverdue: false, isToday: true };
  }
  if (diffDays === 1) {
    return { label: "Tomorrow", isOverdue: false, isToday: false };
  }
  if (diffDays <= 6) {
    return {
      label: `In ${diffDays} days (${d.toLocaleDateString("en-US", { weekday: "short" })})`,
      isOverdue: false,
      isToday: false,
    };
  }

  return {
    label: d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined }),
    isOverdue: false,
    isToday: false,
  };
}
