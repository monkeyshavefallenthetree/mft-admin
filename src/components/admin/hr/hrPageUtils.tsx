import type { Worker, TaskDoc } from "@/lib/admin/hrPageTypes";

export function todayYmd(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function workerName(w: Worker) {
  return `${w.firstName || ""} ${w.lastName || ""}`.trim() || "Worker";
}

export function formatTs(t: { toDate: () => Date } | undefined) {
  if (!t?.toDate) return "—";
  return t.toDate().toLocaleString();
}

export function assignedIds(task: TaskDoc): string[] {
  const a = task.assignedTo;
  if (Array.isArray(a)) return a;
  return a ? [a] : [];
}

export const EMPLOYMENT_OPTIONS = [
  { value: "full-time", ar: "دوام كامل (Full-time)", en: "Full-time" },
  { value: "part-time", ar: "دوام جزئي (Part-time)", en: "Part-time" },
  { value: "contract", ar: "عقد (Contract)", en: "Contract" },
  { value: "intern", ar: "تدريب (Intern)", en: "Intern" },
];

export function SvgI({ d, className = "h-4 w-4" }: { d: string; className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}
