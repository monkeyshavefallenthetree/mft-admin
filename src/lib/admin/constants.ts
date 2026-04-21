export const PROJECT_TYPES = [
  { value: "social-media", label: "Social Media" },
  { value: "web-development", label: "Web Development" },
  { value: "media-buying", label: "Media Buying" },
  { value: "branding", label: "Branding" },
  { value: "seo", label: "SEO" },
  { value: "content-creation", label: "Content Creation" },
] as const;

export const PROJECT_STATUSES = [
  { value: "active", label: "Active" },
  { value: "on-hold", label: "On Hold" },
  { value: "completed", label: "Completed" },
] as const;

export const WORKER_ROLES_FILTER = [
  { value: "tree-cutter", label: "Tree Cutter" },
  { value: "equipment-operator", label: "Equipment Operator" },
  { value: "safety-supervisor", label: "Safety Supervisor" },
  { value: "logistics-coordinator", label: "Logistics Coordinator" },
  { value: "site-manager", label: "Site Manager" },
] as const;

export const DEPARTMENTS = [
  { value: "development", label: "Development" },
  { value: "design", label: "Design" },
  { value: "marketing", label: "Marketing" },
  { value: "management", label: "Management" },
  { value: "general", label: "General" },
] as const;

export const TASK_DEPARTMENTS = [
  "development",
  "design",
  "marketing",
  "management",
  "operations",
  "general",
] as const;
