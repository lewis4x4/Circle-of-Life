import { createClient } from "@/lib/supabase/server";

export type FormFacilityOption = { id: string; label: string };
export type FormResidentOption = { id: string; label: string };

type FacilityRow = { facility_id: string; facility_name: string };
type ResidentRow = { resident_id: string; resident_name: string };

type FacilitiesResult = { data: FacilityRow[] | null; error: { message: string } | null };
type ResidentsResult = { data: ResidentRow[] | null; error: { message: string } | null };

/**
 * Load the dropdown option lists used by V2 form pages.
 *
 * - Facilities come from `haven.vw_v2_facility_rollup` so options are
 *   constrained to whatever the caller can read under RLS.
 * - Residents come from `haven.vw_v2_residents_list` for the same reason.
 *
 * Both return `[]` on error; the caller's UI handles "no options" gracefully
 * (form selects render an empty placeholder).
 */
export async function loadV2FormOptions(): Promise<{
  facilities: FormFacilityOption[];
  residents: FormResidentOption[];
}> {
  const supabase = await createClient();

  const facilitiesResult = (await supabase
    .schema("haven" as never)
    .from("vw_v2_facility_rollup" as never)
    .select("facility_id, facility_name")
    .order("facility_name" as never, { ascending: true })) as unknown as FacilitiesResult;

  const residentsResult = (await supabase
    .schema("haven" as never)
    .from("vw_v2_residents_list" as never)
    .select("resident_id, resident_name")
    .order("resident_name" as never, { ascending: true })) as unknown as ResidentsResult;

  const facilities: FormFacilityOption[] = (facilitiesResult.data ?? []).map((row) => ({
    id: row.facility_id,
    label: row.facility_name,
  }));

  const residents: FormResidentOption[] = (residentsResult.data ?? []).map((row) => ({
    id: row.resident_id,
    label: (row.resident_name ?? "").trim() || "Unnamed resident",
  }));

  return { facilities, residents };
}
