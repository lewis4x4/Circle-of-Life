import { RESIDENT_ROSTER_NO_ACUITY_COPY, RESIDENT_ROSTER_NO_DATE_COPY } from "./roster-display-copy";
import type { ResidentRow } from "./load-residents";

/**
 * Compact relative timestamps for roster "Updated" column (America/New_York oriented display).
 */
export function formatResidentRosterUpdatedAt(iso: string | null): string {
  if (iso == null) return RESIDENT_ROSTER_NO_DATE_COPY;

  const trimmed = iso.trim();
  if (!trimmed) return RESIDENT_ROSTER_NO_DATE_COPY;

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return RESIDENT_ROSTER_NO_DATE_COPY;

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  const dayKey = (d: Date) => {
    const f = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return f.format(d);
  };

  const today = new Date();
  const yday = new Date(today);
  yday.setDate(yday.getDate() - 1);

  const parsedKey = dayKey(parsed);
  const todayKey = dayKey(today);
  const ydayKey = dayKey(yday);

  const monthDay = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
  }).format(parsed);

  const timeSuffix = formatter
    .format(parsed)
    .replace(/\s+/g, "")
    .replace(/AM/i, "a")
    .replace(/PM/i, "p")
    .toLowerCase();

  if (parsedKey === todayKey) return `Today ${timeSuffix}`;
  if (parsedKey === ydayKey) return `Yesterday ${timeSuffix}`;

  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - 7);
  if (parsed >= cutoff) {
    return `${monthDay} ${timeSuffix}`;
  }

  return monthDay;
}

/** Group header average acuity; names empty groups instead of a silent em dash. */
export function averageAcuity(rows: ResidentRow[]): string {
  if (rows.length === 0) return RESIDENT_ROSTER_NO_ACUITY_COPY;
  const sum = rows.reduce((acc, r) => acc + r.acuity, 0);
  return (sum / rows.length).toFixed(1);
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
