export type PackUiKind = "operational" | "role_based" | "event_based";

export type EventTrigger = "surveyor_arrival" | "board_prep" | "manual_only";

export type ScheduleFrequency = "daily" | "weekly" | "monthly" | "quarterly";

export type PackUiMeta = {
  pack_kind: PackUiKind;
  /** Operational / role-based scheduling */
  frequency?: ScheduleFrequency;
  /** 0–6 (Sunday–Saturday), America/New_York wall clock */
  weekday?: number;
  /** HH:mm 24h local */
  time_local?: string;
  timezone?: string;
  event_trigger?: EventTrigger | null;
  delivery_destination?: "in_app";
  failure_alert_user_id?: string | null;
};

export type PackNotesEnvelope = {
  ui?: PackUiMeta;
  /** Preserve unknown keys */
  [key: string]: unknown;
};

export function parsePackNotes(raw: string | null | undefined): PackNotesEnvelope {
  if (!raw || typeof raw !== "string") return {};
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return {};
  try {
    const parsed = JSON.parse(trimmed) as PackNotesEnvelope;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function mergePackNotes(existing: string | null | undefined, ui: PackUiMeta): string {
  const env = parsePackNotes(existing);
  return JSON.stringify({ ...env, ui: { ...(env.ui ?? {}), ...ui } }, null, 0);
}

export function packDbCategory(kind: PackUiKind): string {
  switch (kind) {
    case "role_based":
      return "role_based";
    case "event_based":
      return "event_based";
    default:
      return "operational";
  }
}

export function labelPackType(dbCategory: string): "Operational" | "Role-based" | "Event-based" {
  const c = dbCategory.trim().toLowerCase();
  if (c === "role_based" || c === "board") return "Role-based";
  if (c === "event_based" || c === "survey") return "Event-based";
  return "Operational";
}
