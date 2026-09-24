import type { SupabaseClient } from "@supabase/supabase-js";

import type { RegisterEventType, RegisterRow } from "@/lib/registers/register";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

/**
 * The register and census functions land in migration 412, after the generated
 * `Database` types were last written. `as never` is the repo's existing way to
 * call an RPC the types do not know yet (see src/lib/caregiver/clinical-writes.ts);
 * the row shapes below are the contract until types are regenerated.
 */
type RegisterDbRow = {
  event_at: string;
  event_type: RegisterEventType;
  resident_id: string;
  resident_display_name: string;
  room_number: string | null;
  bed_label: string | null;
  room_as_of: string;
  from_status: string | null;
  to_status: string;
  admission_source: string | null;
  discharge_reason: string | null;
  discharge_destination: string | null;
  recorded_by: string | null;
  recorded_by_name: string | null;
  /** Migration 503 (COL-750). */
  recorded_at?: string | null;
  effective_basis?: string | null;
  late_entry_reason?: string | null;
};

type CensusDbRow = {
  resident_id: string;
  resident_display_name: string;
  month: string;
  physical_presence_days: number;
  billable_days: number;
};

export type CensusRecordRow = {
  residentId: string;
  residentDisplayName: string;
  month: string;
  physicalPresenceDays: number;
  billableDays: number;
};

export async function fetchRegister(
  supabase: Client,
  args: {
    organizationId: string;
    facilityId: string;
    from: string;
    to: string;
    includeHolds: boolean;
  },
): Promise<RegisterRow[]> {
  const { data, error } = await supabase.rpc("admission_discharge_register" as never, {
    p_organization_id: args.organizationId,
    p_facility_id: args.facilityId,
    p_from: args.from,
    p_to: args.to,
    p_include_holds: args.includeHolds,
  } as never);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as RegisterDbRow[]).map((row) => ({
    eventAt: row.event_at,
    eventType: row.event_type,
    residentId: row.resident_id,
    residentDisplayName: row.resident_display_name,
    roomNumber: row.room_number,
    bedLabel: row.bed_label,
    roomAsOf: row.room_as_of,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    admissionSource: row.admission_source,
    dischargeReason: row.discharge_reason,
    dischargeDestination: row.discharge_destination,
    recordedByName: row.recorded_by_name,
    recordedAt: row.recorded_at ?? null,
    effectiveBasis: row.effective_basis ?? null,
    lateEntryReason: row.late_entry_reason ?? null,
  }));
}

export async function fetchCensusRecord(
  supabase: Client,
  args: { organizationId: string; facilityId: string; from: string; to: string },
): Promise<CensusRecordRow[]> {
  const { data, error } = await supabase.rpc("census_record_monthly" as never, {
    p_organization_id: args.organizationId,
    p_facility_id: args.facilityId,
    p_from: args.from,
    p_to: args.to,
  } as never);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as CensusDbRow[]).map((row) => ({
    residentId: row.resident_id,
    residentDisplayName: row.resident_display_name,
    month: row.month,
    physicalPresenceDays: row.physical_presence_days,
    billableDays: row.billable_days,
  }));
}

type VisitorDbRow = {
  id: string;
  visitor_name: string;
  visitor_phone: string | null;
  visitor_type: string;
  visiting_type: string | null;
  visiting_resident_id: string | null;
  visiting_resident_name: string | null;
  signed_in_at: string;
  signed_in_by_name: string | null;
  signed_out_at: string | null;
  signed_out_by_name: string | null;
  sign_out_method: string | null;
  voided_at: string | null;
  void_reason: string | null;
  left_open: boolean;
};

function visitorRow(row: VisitorDbRow): import("@/lib/registers/visitor-log").VisitorLogRow {
  return {
    id: row.id,
    visitorName: row.visitor_name,
    visitorPhone: row.visitor_phone,
    visitorType: row.visitor_type,
    visitingType: row.visiting_type,
    visitingResidentId: row.visiting_resident_id,
    visitingResidentName: row.visiting_resident_name,
    signedInAt: row.signed_in_at,
    signedInByName: row.signed_in_by_name,
    signedOutAt: row.signed_out_at,
    signedOutByName: row.signed_out_by_name,
    signOutMethod: row.sign_out_method,
    voidedAt: row.voided_at,
    voidReason: row.void_reason,
    leftOpen: row.left_open,
  };
}

type KioskDetailRow = { id: string; visitor_company: string | null; visiting_name_text: string | null; kiosk_device_id: string | null };

/**
 * `visitor_log()` and `visitor_log_open()` predate the kiosk columns (migration
 * 494) and stay as they are. A kiosk row has no staff signer, so only rows with
 * no signer are looked up, straight from the table under the staff SELECT policy.
 */
async function withKioskDetails(
  supabase: Client,
  rows: import("@/lib/registers/visitor-log").VisitorLogRow[],
): Promise<import("@/lib/registers/visitor-log").VisitorLogRow[]> {
  const ids = rows.filter((row) => !row.signedInByName).map((row) => row.id);
  if (ids.length === 0) return rows;
  const details = new Map<string, KioskDetailRow>();
  for (let start = 0; start < ids.length; start += 200) {
    const { data, error } = await supabase
      .from("visitor_log_entries" as never)
      .select("id, visitor_company, visiting_name_text, kiosk_device_id")
      .in("id", ids.slice(start, start + 200));
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as unknown as KioskDetailRow[]) details.set(row.id, row);
  }
  return rows.map((row) => {
    const detail = details.get(row.id);
    if (!detail) return row;
    return {
      ...row,
      visitorCompany: detail.visitor_company,
      visitingNameText: detail.visiting_name_text,
      fromKiosk: detail.kiosk_device_id !== null,
    };
  });
}

/** The desk matches a kiosk entry's typed name to a resident of that building, once (migration 494). */
export async function matchVisitorResident(supabase: Client, entryId: string, residentId: string): Promise<void> {
  const { error } = await supabase.rpc("visitor_match_resident" as never, { p_entry_id: entryId, p_resident_id: residentId } as never);
  if (error) throw new Error(error.message);
}

export async function fetchVisitorLog(
  supabase: Client,
  args: {
    organizationId: string;
    facilityId: string;
    from: string;
    to: string;
    includeVoided: boolean;
  },
): Promise<import("@/lib/registers/visitor-log").VisitorLogRow[]> {
  const { data, error } = await supabase.rpc("visitor_log" as never, {
    p_organization_id: args.organizationId,
    p_facility_id: args.facilityId,
    p_from: args.from,
    p_to: args.to,
    p_include_voided: args.includeVoided,
  } as never);
  if (error) throw new Error(error.message);
  return withKioskDetails(supabase, ((data ?? []) as unknown as VisitorDbRow[]).map(visitorRow));
}

export async function signOutVisitor(supabase: Client, entryId: string): Promise<void> {
  const { error } = await supabase.rpc("visitor_sign_out" as never, { p_entry_id: entryId } as never);
  if (error) throw new Error(error.message);
}

export async function signOutEveryone(supabase: Client, facilityId: string): Promise<number> {
  const { data, error } = await supabase.rpc("visitor_sign_out_all_open" as never, {
    p_facility_id: facilityId,
  } as never);
  if (error) throw new Error(error.message);
  return typeof data === "number" ? data : 0;
}

export async function voidVisitorEntry(
  supabase: Client,
  entryId: string,
  reason: string,
): Promise<void> {
  const { error } = await supabase.rpc("visitor_void" as never, {
    p_entry_id: entryId,
    p_reason: reason,
  } as never);
  if (error) throw new Error(error.message);
}

export async function recordSurveyPackPrint(
  supabase: Client,
  args: { facilityId: string; sections: string[]; from: string; to: string },
): Promise<void> {
  const { error } = await supabase.rpc("survey_print_pack_record" as never, {
    p_facility_id: args.facilityId,
    p_sections: args.sections,
    p_from: args.from,
    p_to: args.to,
  } as never);
  if (error) throw new Error(error.message);
}

/**
 * Everyone signed in and not signed out at this facility, whatever day they
 * arrived. Deliberately not the ranged `fetchVisitorLog`: the building does not
 * empty at midnight.
 */
export async function fetchOpenVisitors(
  supabase: Client,
  args: { organizationId: string; facilityId: string },
): Promise<import("@/lib/registers/visitor-log").VisitorLogRow[]> {
  const { data, error } = await supabase.rpc("visitor_log_open" as never, {
    p_organization_id: args.organizationId,
    p_facility_id: args.facilityId,
  } as never);
  if (error) throw new Error(error.message);
  return withKioskDetails(supabase, ((data ?? []) as unknown as VisitorDbRow[]).map(visitorRow));
}
