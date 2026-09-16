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
