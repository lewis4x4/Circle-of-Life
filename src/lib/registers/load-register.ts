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
  return ((data ?? []) as unknown as VisitorDbRow[]).map((row) => ({
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
  }));
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
