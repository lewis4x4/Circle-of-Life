import {
  RESIDENT_ROSTER_NO_ACUITY_COPY,
  RESIDENT_ROSTER_NO_ADL_COPY,
  RESIDENT_ROSTER_NO_DATE_COPY,
} from "./roster-display-copy";
import type { Acuity, AdlStatus, ResidentRow } from "./load-residents";

type ResidentRosterMetricCellTone = "muted" | "warning" | "danger" | "gap";

// Fixed locale/timezone formatters are reusable; relative dates remain live per call.
const rosterTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});
const rosterDayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const rosterMonthDayFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
});

/**
 * Compact relative timestamps for roster "Updated" column (America/New_York oriented display).
 */
export function formatResidentRosterUpdatedAt(iso: string | null): string {
  if (iso == null) return RESIDENT_ROSTER_NO_DATE_COPY;

  const trimmed = iso.trim();
  if (!trimmed) return RESIDENT_ROSTER_NO_DATE_COPY;

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return RESIDENT_ROSTER_NO_DATE_COPY;

  const today = new Date();
  const yday = new Date(today);
  yday.setDate(yday.getDate() - 1);

  const parsedKey = rosterDayFormatter.format(parsed);
  const todayKey = rosterDayFormatter.format(today);
  const ydayKey = rosterDayFormatter.format(yday);

  const timeSuffix = rosterTimeFormatter
    .format(parsed)
    .replace(/\s+/g, "")
    .replace(/AM/i, "a")
    .replace(/PM/i, "p")
    .toLowerCase();

  if (parsedKey === todayKey) return `Today ${timeSuffix}`;
  if (parsedKey === ydayKey) return `Yesterday ${timeSuffix}`;

  const monthDay = rosterMonthDayFormatter.format(parsed);
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - 7);
  if (parsed >= cutoff) {
    return `${monthDay} ${timeSuffix}`;
  }

  return monthDay;
}

export type ResidentRosterMetricCell = {
  label: string;
  tone: ResidentRosterMetricCellTone;
};

function isResidentRosterAcuityPosted(acuityLevel: string | null | undefined): boolean {
  return acuityLevel != null && acuityLevel.trim().length > 0;
}

/** Acuity column — posted levels stay labeled; missing data names the gap. */
export function formatResidentRosterAcuityCell(
  acuityLevel: string | null | undefined,
  acuity: Acuity,
): ResidentRosterMetricCell {
  if (!isResidentRosterAcuityPosted(acuityLevel)) {
    return { label: RESIDENT_ROSTER_NO_ACUITY_COPY, tone: "gap" };
  }
  if (acuity === 3) return { label: `Acuity ${acuity}`, tone: "danger" };
  if (acuity === 2) return { label: `Acuity ${acuity}`, tone: "warning" };
  return { label: `Acuity ${acuity}`, tone: "muted" };
}

/** ADL column — inferred from posted acuity; missing acuity names the ADL gap. */
export function formatResidentRosterAdlCell(
  acuityLevel: string | null | undefined,
  status: AdlStatus,
): ResidentRosterMetricCell {
  if (!isResidentRosterAcuityPosted(acuityLevel)) {
    return { label: RESIDENT_ROSTER_NO_ADL_COPY, tone: "gap" };
  }
  if (status === "assisted") return { label: "Partial assist", tone: "warning" };
  if (status === "dependent") return { label: "Total assist", tone: "danger" };
  return { label: "Independent", tone: "muted" };
}

/** CSV / export label for acuity — never a silent em dash. */
export function formatResidentRosterAcuityExport(
  acuityLevel: string | null | undefined,
  acuity: Acuity,
): string {
  if (!isResidentRosterAcuityPosted(acuityLevel)) return RESIDENT_ROSTER_NO_ACUITY_COPY;
  return String(acuity);
}

/** CSV / export label for ADL — never a silent em dash. */
export function formatResidentRosterAdlExport(
  acuityLevel: string | null | undefined,
  status: AdlStatus,
): string {
  if (!isResidentRosterAcuityPosted(acuityLevel)) return RESIDENT_ROSTER_NO_ADL_COPY;
  return status;
}

/** Group header average acuity; names empty groups instead of a silent em dash. */
export function averageAcuity(rows: ResidentRow[]): string {
  let sum = 0;
  let count = 0;
  rows.forEach((row) => {
    if (!isResidentRosterAcuityPosted(row.acuityLevel)) return;
    sum += row.acuity;
    count += 1;
  });
  return count === 0 ? RESIDENT_ROSTER_NO_ACUITY_COPY : (sum / count).toFixed(1);
}

/** Deterministic accent for avatar dot / initials background (HSL). */
export function rosterAvatarAccentFromId(id: string): { background: string; foreground: string } {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  return {
    background: `hsla(${hue}, 42%, 82%, 1)`,
    foreground: `hsla(${hue}, 35%, 28%, 1)`,
  };
}

export function truncateCareNoteSubtitle(text: string, maxChars: number): string {
  const t = text.trim();
  if (t.length <= maxChars) return t;
  return `${t.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}
