import type { SupabaseClient } from "@supabase/supabase-js";
import { format, startOfDay } from "date-fns";

import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/types/database";

export type TransportationFleetRow = Database["public"]["Tables"]["fleet_vehicles"]["Row"];
export type TransportationInspectionRow = Database["public"]["Tables"]["vehicle_inspection_logs"]["Row"] & {
  fleet_vehicles: { name: string } | null;
};
export type TransportationDriverRow = Database["public"]["Tables"]["driver_credentials"]["Row"] & {
  staff: { first_name: string; last_name: string } | null;
};
export type TransportationRequestRow = Database["public"]["Tables"]["resident_transport_requests"]["Row"] & {
  residents: { first_name: string; last_name: string } | null;
};

export type TransportationHubSnapshot = {
  fleet: TransportationFleetRow[];
  inspections: TransportationInspectionRow[];
  drivers: TransportationDriverRow[];
  transportRequests: TransportationRequestRow[];
};

export async function fetchTransportationHubSnapshot(
  facilityId: string,
  supabase: SupabaseClient<Database> = createClient(),
): Promise<TransportationHubSnapshot> {
  const today = format(startOfDay(new Date()), "yyyy-MM-dd");

  const [fRes, iRes, dRes, tRes] = await Promise.all([
    supabase
      .from("fleet_vehicles")
      .select("*")
      .eq("facility_id", facilityId)
      .is("deleted_at", null)
      .order("name", { ascending: true })
      .limit(40),
    supabase
      .from("vehicle_inspection_logs")
      .select("*, fleet_vehicles(name)")
      .eq("facility_id", facilityId)
      .is("deleted_at", null)
      .order("inspected_at", { ascending: false })
      .limit(25),
    supabase
      .from("driver_credentials")
      .select("*, staff(first_name, last_name)")
      .eq("facility_id", facilityId)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(40),
    supabase
      .from("resident_transport_requests")
      .select(
        "id, appointment_date, appointment_time, destination_name, purpose, status, residents(first_name, last_name)",
      )
      .eq("facility_id", facilityId)
      .is("deleted_at", null)
      .gte("appointment_date", today)
      .order("appointment_date", { ascending: true })
      .order("appointment_time", { ascending: true })
      .limit(25),
  ]);

  if (fRes.error) throw fRes.error;
  if (iRes.error) throw iRes.error;
  if (dRes.error) throw dRes.error;
  if (tRes.error) throw tRes.error;

  return {
    fleet: fRes.data ?? [],
    inspections: (iRes.data ?? []) as TransportationInspectionRow[],
    drivers: (dRes.data ?? []) as TransportationDriverRow[],
    transportRequests: (tRes.data ?? []) as TransportationRequestRow[],
  };
}
