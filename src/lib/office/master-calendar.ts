import { addDays, addHours, format, parseISO } from "date-fns";
import type { SupabaseClient } from "@supabase/supabase-js";

import { addFacilityCalendarDays, facilityDatetimeLocalToUtcIso } from "@/lib/facility-wall-clock";
import type { Database } from "@/types/database";

const CRLF = "\r\n";
const TZ = "America/New_York";
const PRODID = "-//Circle of Life//Haven Master Calendar//EN";

export type MasterCalendarLayer =
  | "transport"
  | "meetings"
  | "inservices"
  | "drills"
  | "expirations"
  | "surveys";

export const MASTER_CALENDAR_LAYERS: { id: MasterCalendarLayer; label: string }[] = [
  { id: "transport", label: "Transportation" },
  { id: "meetings", label: "Meetings" },
  { id: "inservices", label: "In-services" },
  { id: "drills", label: "Drills & emergency checks" },
  { id: "expirations", label: "Document expirations" },
  { id: "surveys", label: "Survey history" },
];

export type MasterCalendarEvent = {
  id: string;
  layer: MasterCalendarLayer;
  /** Calendar day YYYY-MM-DD (ET for timestamptz sources). */
  date: string;
  /** HH:mm:ss when the source has a time, else null (all-day). */
  time: string | null;
  title: string;
  detail: string | null;
  href: string | null;
};

type QueryError = { message: string };
type QueryResult<T> = { data: T[] | null; error: QueryError | null };

function etDateIso(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });
}

function etTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", {
    timeZone: TZ,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function masterCalendarTimestampBounds(startDate: string, endDate: string) {
  return { start: facilityDatetimeLocalToUtcIso(`${startDate}T00:00`), end: new Date(new Date(facilityDatetimeLocalToUtcIso(`${addFacilityCalendarDays(endDate, 1)}T00:00`)).getTime() - 1).toISOString() };
}

/**
 * Loads every layer for one facility and date window (inclusive YYYY-MM-DD bounds)
 * through the caller's session client — existing RLS on each source governs.
 */
export async function fetchMasterCalendarEvents(
  supabase: SupabaseClient<Database>,
  facilityId: string,
  startIso: string,
  endIso: string,
): Promise<MasterCalendarEvent[]> {
  const { start: windowStartTs, end: windowEndTs } = masterCalendarTimestampBounds(startIso, endIso);

  const transportQ = supabase
    .from("resident_transport_requests")
    .select(
      "id, appointment_date, appointment_time, destination_name, purpose, status, residents(first_name, last_name)",
    )
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .gte("appointment_date", startIso)
    .lte("appointment_date", endIso)
    .limit(300);

  const meetingsQ = supabase
    .from("meetings" as never)
    .select("id, title, scheduled_at, status")
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .gte("scheduled_at", windowStartTs)
    .lte("scheduled_at", windowEndTs)
    .limit(200);

  const inservicesQ = supabase
    .from("inservice_log_sessions" as never)
    .select("id, session_date, topic, trainer_name, hours")
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .gte("session_date", startIso)
    .lte("session_date", endIso)
    .limit(200);

  const drillsQ = supabase
    .from("emergency_checklist_items" as never)
    .select("id, checklist_type, title, next_due_date")
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .gte("next_due_date", startIso)
    .lte("next_due_date", endIso)
    .limit(200);

  const expirationsQ = supabase
    .from("facility_documents" as never)
    .select("id, document_name, expiration_date")
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .not("expiration_date", "is", null)
    .gte("expiration_date", startIso)
    .lte("expiration_date", endIso)
    .limit(200);

  const surveysQ = supabase
    .from("facility_survey_history" as never)
    .select("id, survey_date, survey_type, result")
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .gte("survey_date", startIso)
    .lte("survey_date", endIso)
    .limit(100);

  type TransportRow = {
    id: string;
    appointment_date: string;
    appointment_time: string | null;
    destination_name: string;
    purpose: string;
    status: string;
    residents: { first_name: string; last_name: string } | null;
  };
  type MeetingRow = { id: string; title: string; scheduled_at: string; status: string };
  type InserviceRow = {
    id: string;
    session_date: string;
    topic: string;
    trainer_name: string;
    hours: number | string;
  };
  type DrillRow = { id: string; checklist_type: string; title: string; next_due_date: string };
  type ExpirationRow = { id: string; document_name: string; expiration_date: string };
  type SurveyRow = { id: string; survey_date: string; survey_type: string; result: string };

  const [transportRes, meetingsRes, inservicesRes, drillsRes, expirationsRes, surveysRes] =
    await Promise.all([
      transportQ as unknown as Promise<QueryResult<TransportRow>>,
      meetingsQ as unknown as Promise<QueryResult<MeetingRow>>,
      inservicesQ as unknown as Promise<QueryResult<InserviceRow>>,
      drillsQ as unknown as Promise<QueryResult<DrillRow>>,
      expirationsQ as unknown as Promise<QueryResult<ExpirationRow>>,
      surveysQ as unknown as Promise<QueryResult<SurveyRow>>,
    ]);

  for (const res of [transportRes, meetingsRes, inservicesRes, drillsRes, expirationsRes, surveysRes]) {
    if (res.error) throw new Error(res.error.message);
  }

  const events: MasterCalendarEvent[] = [];

  for (const r of transportRes.data ?? []) {
    const resident = r.residents
      ? `${r.residents.first_name} ${r.residents.last_name}`.trim()
      : "Resident";
    events.push({
      id: `transport-${r.id}`,
      layer: "transport",
      date: r.appointment_date,
      time: r.appointment_time,
      title: `${resident} — ${r.destination_name}`,
      detail: `${r.purpose.replace(/_/g, " ")} · ${r.status.replace(/_/g, " ")}`,
      href: `/admin/transportation/requests/${r.id}`,
    });
  }

  for (const r of meetingsRes.data ?? []) {
    const dateIso = etDateIso(r.scheduled_at);
    if (dateIso < startIso || dateIso > endIso) continue;
    events.push({
      id: `meeting-${r.id}`,
      layer: "meetings",
      date: dateIso,
      time: etTime(r.scheduled_at),
      title: r.title,
      detail: r.status.replace(/_/g, " "),
      href: `/admin/meetings/${r.id}`,
    });
  }

  for (const r of inservicesRes.data ?? []) {
    events.push({
      id: `inservice-${r.id}`,
      layer: "inservices",
      date: r.session_date,
      time: null,
      title: r.topic,
      detail: `Trainer ${r.trainer_name} · ${Number(r.hours)} h`,
      href: "/admin/training",
    });
  }

  for (const r of drillsRes.data ?? []) {
    events.push({
      id: `drill-${r.id}`,
      layer: "drills",
      date: r.next_due_date,
      time: null,
      title: r.title,
      detail: `${r.checklist_type.replace(/_/g, " ")} due`,
      href: null,
    });
  }

  for (const r of expirationsRes.data ?? []) {
    events.push({
      id: `expiration-${r.id}`,
      layer: "expirations",
      date: r.expiration_date,
      time: null,
      title: `${r.document_name} expires`,
      detail: null,
      href: null,
    });
  }

  for (const r of surveysRes.data ?? []) {
    events.push({
      id: `survey-${r.id}`,
      layer: "surveys",
      date: r.survey_date,
      time: null,
      title: `${r.survey_type.replace(/_/g, " ")} survey`,
      detail: r.result.replace(/_/g, " "),
      href: null,
    });
  }

  events.sort((a, b) => {
    const d = a.date.localeCompare(b.date);
    if (d !== 0) return d;
    return (a.time ?? "").localeCompare(b.time ?? "");
  });
  return events;
}

function escapeIcsText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

/**
 * iCalendar document for the loaded window (same RFC 5545 conventions as the
 * transportation calendar export: TZID for timed events, VALUE=DATE for all-day).
 */
export function buildMasterCalendarIcs(
  events: MasterCalendarEvent[],
  calName = "Haven facility calendar",
): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    `PRODID:${PRODID}`,
    `X-WR-CALNAME:${escapeIcsText(calName)}`,
    "METHOD:PUBLISH",
  ];
  const stamp = format(new Date(), "yyyyMMdd'T'HHmmss'Z'");

  for (const ev of events) {
    lines.push("BEGIN:VEVENT", `UID:haven-master-${ev.id}@local`, `DTSTAMP:${stamp}`);
    const layerLabel = MASTER_CALENDAR_LAYERS.find((l) => l.id === ev.layer)?.label ?? ev.layer;
    const summary = `[${layerLabel}] ${ev.title}`.slice(0, 200);
    const description = escapeIcsText(ev.detail ?? "");

    const timeMatch = ev.time ? ev.time.match(/^(\d{2}):(\d{2})(?::(\d{2}))?/) : null;
    if (timeMatch) {
      const start = parseISO(`${ev.date}T${timeMatch[1]}:${timeMatch[2]}:${timeMatch[3] ?? "00"}`);
      const end = addHours(start, 1);
      lines.push(
        `DTSTART;TZID=${TZ}:${format(start, "yyyyMMdd'T'HHmmss")}`,
        `DTEND;TZID=${TZ}:${format(end, "yyyyMMdd'T'HHmmss")}`,
      );
    } else {
      const endExclusive = format(addDays(parseISO(`${ev.date}T12:00:00`), 1), "yyyyMMdd");
      lines.push(
        `DTSTART;VALUE=DATE:${ev.date.replace(/-/g, "")}`,
        `DTEND;VALUE=DATE:${endExclusive}`,
      );
    }
    lines.push(`SUMMARY:${escapeIcsText(summary)}`, `DESCRIPTION:${description}`, "END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.join(CRLF) + CRLF;
}
