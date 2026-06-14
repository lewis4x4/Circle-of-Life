export type HandoffShift = "day" | "evening" | "night";
export type HandoffCategory = "resident" | "staffing" | "facility" | "follow_up" | "other";
export type HandoffPriority = "normal" | "high" | "critical";

export const HANDOFF_SHIFTS: { id: HandoffShift; label: string }[] = [
  { id: "day", label: "Day" },
  { id: "evening", label: "Evening" },
  { id: "night", label: "Night" },
];

export const HANDOFF_CATEGORIES: { id: HandoffCategory; label: string }[] = [
  { id: "resident", label: "Resident" },
  { id: "staffing", label: "Staffing" },
  { id: "facility", label: "Facility" },
  { id: "follow_up", label: "Follow-up" },
  { id: "other", label: "Other" },
];

export type HandoffNoteRow = {
  id: string;
  shift_date: string;
  shift: HandoffShift;
  category: HandoffCategory;
  resident_id: string | null;
  note: string;
  priority: HandoffPriority;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  created_at: string;
};

export type ResidentMini = { id: string; first_name: string; last_name: string };

export type QueryError = { message: string };
export type QueryResult<T> = { data: T[] | null; error: QueryError | null };

export function handoffCategoryLabel(id: string): string {
  return HANDOFF_CATEGORIES.find((c) => c.id === id)?.label ?? id.replace(/_/g, " ");
}

export function priorityTone(priority: HandoffPriority): "danger" | "warning" | "muted" {
  if (priority === "critical") return "danger";
  if (priority === "high") return "warning";
  return "muted";
}

/** Current shift for America/New_York wall-clock hour. */
export function currentShift(now: Date): HandoffShift {
  const hourStr = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    hour12: false,
  }).format(now);
  const hour = Number(hourStr) % 24;
  if (hour >= 7 && hour < 15) return "day";
  if (hour >= 15 && hour < 23) return "evening";
  return "night";
}

/** Today's date as YYYY-MM-DD in America/New_York. */
export function todayEtIso(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return parts;
}
