/**
 * What each printed sheet needs, assembled from the care event, its incident,
 * the administrator's completion answers, the witness tasks and the attachment
 * list (spec 07A Appendix A).
 *
 * Nothing here is hand written: every value comes from a row. A field Haven
 * does not hold prints as a blank line, which is what the paper form did.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchCareEventAttachments, type CareEventAttachment } from "@/lib/care-events/attachments";
import { loadCareEventCard, type CareEventAdminCard } from "@/lib/care-events/admin-data";
import { fetchWitnessTasksForIncident, type WitnessTask } from "@/lib/care-events/witness";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

export type PrintFacility = {
  id: string;
  name: string;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  timeZone: string;
};

export type PrintResident = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;
  roomLabel: string | null;
  physicianName: string | null;
  physicianPhone: string | null;
  physicianFax: string | null;
};

/**
 * The incident columns the paper form prints that the live card does not need.
 * Fetched here rather than widened onto CareEventAdminCard, so the card stays
 * the size the Administrator's screen actually uses.
 */
export type PrintIncidentExtras = {
  injuryOccurred: boolean | null;
  injuryDescription: string | null;
  injurySeverity: string | null;
  injuryBodyLocation: string | null;
  locationDescription: string | null;
  contributingFactors: string[] | null;
  physicianNotifiedAt: string | null;
  familyNotifiedAt: string | null;
  resolutionNotes: string | null;
};

export type CareEventPrintPacket = {
  card: CareEventAdminCard;
  facility: PrintFacility;
  resident: PrintResident | null;
  incidentExtras: PrintIncidentExtras | null;
  witnesses: WitnessTask[];
  attachments: CareEventAttachment[];
};

export async function fetchPrintFacility(supabase: Client, facilityId: string): Promise<PrintFacility> {
  const result = await supabase
    .from("facilities")
    .select("id, name, address_line_1, city, state, zip, phone, timezone")
    .eq("id", facilityId)
    .maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new Error("print: facility not found");
  return {
    id: result.data.id,
    name: result.data.name,
    addressLine1: result.data.address_line_1,
    city: result.data.city,
    state: result.data.state,
    zip: result.data.zip,
    phone: result.data.phone,
    timeZone: result.data.timezone ?? "America/New_York",
  };
}

async function fetchPrintResident(supabase: Client, residentId: string): Promise<PrintResident | null> {
  const resident = await supabase
    .from("residents")
    .select("id, first_name, last_name, date_of_birth, bed_id, primary_physician_name, primary_physician_phone, primary_physician_fax")
    .eq("id", residentId)
    .maybeSingle();
  if (resident.error) throw resident.error;
  if (!resident.data) return null;

  let roomLabel: string | null = null;
  if (resident.data.bed_id) {
    const bed = await supabase.from("beds").select("room_id, bed_label").eq("id", resident.data.bed_id).maybeSingle();
    if (!bed.error && bed.data?.room_id) {
      const room = await supabase.from("rooms").select("room_number").eq("id", bed.data.room_id).maybeSingle();
      if (!room.error && room.data?.room_number) {
        roomLabel = bed.data.bed_label ? `${room.data.room_number}${bed.data.bed_label}` : room.data.room_number;
      }
    }
  }

  return {
    id: resident.data.id,
    firstName: resident.data.first_name,
    lastName: resident.data.last_name,
    dateOfBirth: resident.data.date_of_birth,
    roomLabel,
    physicianName: resident.data.primary_physician_name,
    physicianPhone: resident.data.primary_physician_phone,
    physicianFax: resident.data.primary_physician_fax,
  };
}

async function fetchIncidentExtras(supabase: Client, incidentId: string): Promise<PrintIncidentExtras | null> {
  const result = await supabase
    .from("incidents")
    .select(
      "injury_occurred, injury_description, injury_severity, injury_body_location, location_description, contributing_factors, physician_notified_at, family_notified_at, resolution_notes",
    )
    .eq("id", incidentId)
    .maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) return null;
  return {
    injuryOccurred: result.data.injury_occurred,
    injuryDescription: result.data.injury_description,
    injurySeverity: result.data.injury_severity,
    injuryBodyLocation: result.data.injury_body_location,
    locationDescription: result.data.location_description,
    contributingFactors: result.data.contributing_factors,
    physicianNotifiedAt: result.data.physician_notified_at,
    familyNotifiedAt: result.data.family_notified_at,
    resolutionNotes: result.data.resolution_notes,
  };
}

/**
 * Everything the incident form and the physician sheet print. One call so a
 * partially loaded sheet never reaches paper.
 */
export async function loadCareEventPrintPacket(supabase: Client, careEventId: string): Promise<CareEventPrintPacket> {
  const card = await loadCareEventCard(supabase, careEventId);
  if (!card) throw new Error("print: care event not found");

  const [facility, resident, incidentExtras, witnesses, attachments] = await Promise.all([
    fetchPrintFacility(supabase, card.facilityId),
    card.resident ? fetchPrintResident(supabase, card.resident.id) : Promise.resolve(null),
    card.incident ? fetchIncidentExtras(supabase, card.incident.id) : Promise.resolve(null),
    card.incident ? fetchWitnessTasksForIncident(supabase, card.incident.id) : Promise.resolve([] as WitnessTask[]),
    fetchCareEventAttachments(supabase, careEventId),
  ]);

  return { card, facility, resident, incidentExtras, witnesses, attachments };
}

export type IncidentReportsLogRow = {
  incidentId: string;
  logDate: string | null;
  room: string | null;
  resident: string | null;
  fall: boolean | null;
  bruise: boolean | null;
  scrapesOrBurn: boolean | null;
  cutLacerationPuncture: boolean | null;
  nonApparent: boolean | null;
  other: boolean | null;
  contributingFactors: string | null;
  shift: string | null;
};

/** The paper log for one facility and date range, oldest first, as the log reads. */
export async function fetchIncidentReportsLog(
  supabase: Client,
  input: { facilityId: string; from: string; to: string },
): Promise<IncidentReportsLogRow[]> {
  const result = await supabase
    .from("v_incident_reports_log")
    .select(
      "incident_id, log_date, room, resident, fall, bruise, scrapes_or_burn, cut_laceration_puncture, non_apparent, other, contributing_factors, shift",
    )
    .eq("facility_id", input.facilityId)
    .gte("log_date", input.from)
    .lte("log_date", input.to)
    .order("log_date", { ascending: true });
  if (result.error) throw result.error;
  return (result.data ?? [])
    .filter((row): row is typeof row & { incident_id: string } => Boolean(row.incident_id))
    .map((row) => ({
      incidentId: row.incident_id,
      logDate: row.log_date,
      room: row.room,
      resident: row.resident,
      fall: row.fall,
      bruise: row.bruise,
      scrapesOrBurn: row.scrapes_or_burn,
      cutLacerationPuncture: row.cut_laceration_puncture,
      nonApparent: row.non_apparent,
      other: row.other,
      contributingFactors: row.contributing_factors,
      shift: row.shift,
    }));
}
