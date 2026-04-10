import { addHours, addDays, format, parseISO } from "date-fns";

const CRLF = "\r\n";
const TZ = "America/New_York";
const PRODID = "-//Circle of Life//Haven Transport//EN";

export type TransportRequestIcsInput = {
  id: string;
  appointment_date: string;
  appointment_time: string | null;
  destination_name: string;
  purpose: string;
  status: string;
  destination_address: string | null;
  residents: { first_name: string; last_name: string } | null;
};

/** Escape TEXT property values (RFC 5545). */
function escapeIcsText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function compactDateYmd(yyyyMmDd: string): string {
  return yyyyMmDd.replace(/-/g, "");
}

function timePartFromDb(t: string | null): string | null {
  if (!t || !String(t).trim()) return null;
  const m = String(t).match(/^(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  return `${m[1]}:${m[2]}:${m[3]}`;
}

function dtStampUtc(): string {
  return format(new Date(), "yyyyMMdd'T'HHmmss'Z'");
}

/**
 * Build an iCalendar document for the given transport rows (current calendar query window).
 * Timed events use TZID=America/New_York; untimed use all-day VALUE=DATE.
 * Cancelled requests include STATUS:CANCELLED.
 */
export function buildTransportRequestsIcs(
  rows: TransportRequestIcsInput[],
  calName = "Haven transport",
): string {
  const sorted = [...rows].sort((a, b) => {
    const da = a.appointment_date.localeCompare(b.appointment_date);
    if (da !== 0) return da;
    const ta = a.appointment_time ?? "";
    const tb = b.appointment_time ?? "";
    return ta.localeCompare(tb);
  });

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    `PRODID:${PRODID}`,
    `X-WR-CALNAME:${escapeIcsText(calName)}`,
    "METHOD:PUBLISH",
  ];

  const stamp = dtStampUtc();

  for (const row of sorted) {
    const resident = row.residents
      ? `${row.residents.first_name} ${row.residents.last_name}`.trim()
      : "Resident";
    const summary = `${resident} — ${row.destination_name}`.slice(0, 200);
    const descParts = [`Purpose: ${row.purpose}`, `Status: ${row.status.replace(/_/g, " ")}`];
    if (row.destination_address?.trim()) descParts.push(`Address: ${row.destination_address.trim()}`);
    const description = escapeIcsText(descParts.join("\\n"));

    const uid = `haven-transport-${row.id}@local`;
    const location = escapeIcsText(row.destination_name + (row.destination_address ? ` (${row.destination_address})` : ""));

    lines.push("BEGIN:VEVENT", `UID:${uid}`, `DTSTAMP:${stamp}`);

    if (row.status === "cancelled") {
      lines.push("STATUS:CANCELLED");
    }

    const tp = timePartFromDb(row.appointment_time);
    if (tp) {
      try {
        const start = parseISO(`${row.appointment_date}T${tp}`);
        if (Number.isNaN(start.getTime())) throw new Error("bad start");
        const end = addHours(start, 1);
        const ds = format(start, "yyyyMMdd'T'HHmmss");
        const de = format(end, "yyyyMMdd'T'HHmmss");
        lines.push(
          `DTSTART;TZID=${TZ}:${ds}`,
          `DTEND;TZID=${TZ}:${de}`,
          `SUMMARY:${escapeIcsText(summary)}`,
          `DESCRIPTION:${description}`,
          `LOCATION:${location}`,
        );
      } catch {
        pushAllDayEvent(lines, row, summary, description, location);
      }
    } else {
      pushAllDayEvent(lines, row, summary, description, location);
    }

    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.join(CRLF) + CRLF;
}

function pushAllDayEvent(
  lines: string[],
  row: TransportRequestIcsInput,
  summary: string,
  description: string,
  location: string,
): void {
  const d0 = compactDateYmd(row.appointment_date);
  const endExclusive = format(addDays(parseISO(`${row.appointment_date}T12:00:00`), 1), "yyyyMMdd");
  lines.push(
    `DTSTART;VALUE=DATE:${d0}`,
    `DTEND;VALUE=DATE:${endExclusive}`,
    `SUMMARY:${escapeIcsText(summary)}`,
    `DESCRIPTION:${description}`,
    `LOCATION:${location}`,
  );
}
