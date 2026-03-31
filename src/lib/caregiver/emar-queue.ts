import { toDate } from "date-fns-tz";

export type EmarQueueSlot = {
  /** Stable key for React + dedup */
  queueKey: string;
  residentMedicationId: string;
  residentId: string;
  residentName: string;
  roomLabel: string;
  medicationLabel: string;
  routeLabel: string;
  scheduleLabel: string;
  scheduledTimeIso: string;
  isPrn: boolean;
  instructions: string;
  /** due-now = within past 30m or overdue &lt; 2h; due-soon = next 60m */
  urgency: "due-now" | "due-soon";
};

function parseTimeParts(raw: string): { h: number; m: number; s: number } | null {
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  const s = m[3] != null ? Number(m[3]) : 0;
  if (h < 0 || h > 23 || min < 0 || min > 59 || s < 0 || s > 59) return null;
  return { h, m: min, s };
}

/** YYYY-MM-DD in facility TZ */
export function zonedYmd(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * Build wall-clock instants (UTC) for each scheduled time on `ymd` in `timeZone`.
 */
export function wallClocksToUtc(ymd: string, timeStrings: string[], timeZone: string): string[] {
  const out: string[] = [];
  for (const t of timeStrings) {
    const parts = parseTimeParts(t);
    if (!parts) continue;
    const wall = `${ymd}T${String(parts.h).padStart(2, "0")}:${String(parts.m).padStart(2, "0")}:${String(parts.s).padStart(2, "0")}`;
    const utc = toDate(wall, { timeZone });
    if (!Number.isNaN(utc.getTime())) {
      out.push(utc.toISOString());
    }
  }
  return out;
}

function formatScheduleLabel(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function routeDisplay(route: string): string {
  return route.replace(/_/g, " ");
}

/**
 * Classify slot vs now: due-now if overdue up to 2h or due within 30m; due-soon if within 60m after that window.
 */
export function urgencyForSlot(scheduledTimeIso: string, now: Date): "due-now" | "due-soon" {
  const t = new Date(scheduledTimeIso).getTime();
  const n = now.getTime();
  const diffMin = (t - n) / 60000;
  if (diffMin <= 30 && diffMin >= -120) return "due-now";
  return "due-soon";
}

export type MedRowInput = {
  id: string;
  resident_id: string;
  medication_name: string;
  strength: string | null;
  route: string;
  frequency: string;
  scheduled_times: string[] | null;
  instructions: string | null;
  resident: { first_name: string | null; last_name: string | null };
  roomLabel: string;
};

export function buildEmarQueueSlots(
  meds: MedRowInput[],
  timeZone: string,
  now: Date,
  documentedKeys: Set<string>,
): EmarQueueSlot[] {
  const ymd = zonedYmd(now, timeZone);
  const slots: EmarQueueSlot[] = [];

  for (const med of meds) {
    const first = med.resident.first_name?.trim() ?? "";
    const last = med.resident.last_name?.trim() ?? "";
    const residentName = `${first} ${last}`.trim() || "Resident";
    const medLabel = [med.medication_name, med.strength].filter(Boolean).join(" ");

    if (med.frequency === "prn") {
      const key = `prn|${med.id}|${ymd}`;
      if (documentedKeys.has(key)) continue;
      const noon = wallClocksToUtc(ymd, ["12:00:00"], timeZone)[0] ?? now.toISOString();
      slots.push({
        queueKey: key,
        residentMedicationId: med.id,
        residentId: med.resident_id,
        residentName,
        roomLabel: med.roomLabel,
        medicationLabel: medLabel,
        routeLabel: routeDisplay(med.route),
        scheduleLabel: "PRN",
        scheduledTimeIso: noon,
        isPrn: true,
        instructions: med.instructions?.trim() || "Document indication and response per policy.",
        urgency: "due-soon",
      });
      continue;
    }

    const times = (med.scheduled_times ?? []).filter(Boolean);
    if (times.length === 0) continue;

    const isos = wallClocksToUtc(ymd, times, timeZone);
    for (const iso of isos) {
      const key = `${med.id}|${iso}`;
      if (documentedKeys.has(key)) continue;

      const diffMin = (new Date(iso).getTime() - now.getTime()) / 60000;
      if (diffMin < -180 || diffMin > 90) continue;

      slots.push({
        queueKey: key,
        residentMedicationId: med.id,
        residentId: med.resident_id,
        residentName,
        roomLabel: med.roomLabel,
        medicationLabel: medLabel,
        routeLabel: routeDisplay(med.route),
        scheduleLabel: formatScheduleLabel(iso, timeZone),
        scheduledTimeIso: iso,
        isPrn: false,
        instructions: med.instructions?.trim() || "—",
        urgency: urgencyForSlot(iso, now),
      });
    }
  }

  slots.sort((a, b) => new Date(a.scheduledTimeIso).getTime() - new Date(b.scheduledTimeIso).getTime());
  return slots;
}

/** Keys for doses already documented today (same calendar day in facility TZ). */
export function documentedSlotKeys(
  rows: { resident_medication_id: string; scheduled_time: string; is_prn: boolean; status: string }[],
  timeZone: string,
  ymd: string,
): Set<string> {
  const set = new Set<string>();
  for (const r of rows) {
    const rowYmd = zonedYmd(new Date(r.scheduled_time), timeZone);
    if (rowYmd !== ymd) continue;
    if (r.status !== "given" && r.status !== "refused" && r.status !== "held" && r.status !== "not_available") {
      continue;
    }
    if (r.is_prn) {
      set.add(`prn|${r.resident_medication_id}|${ymd}`);
    } else {
      set.add(`${r.resident_medication_id}|${new Date(r.scheduled_time).toISOString()}`);
    }
  }
  return set;
}
