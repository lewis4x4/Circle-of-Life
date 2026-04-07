import { assertNoError, DEMO_IDS } from "./_config.mjs";

export async function seedTransportation(supabase, actorUserId) {
  // 1. Vehicles
  await assertNoError(
    "fleet vehicles upsert",
    supabase.from("fleet_vehicles").upsert([
      {
        id: DEMO_IDS.transportation.vehicleOne,
        organization_id: DEMO_IDS.orgId,
        facility_id: DEMO_IDS.facilityId,
        name: "Shuttle Van A",
        vin: "1G1YZ2A13B5123456",
        license_plate: "FL-593-XYZ",
        make: "Ford",
        model: "Transit 350",
        model_year: 2023,
        passenger_capacity: 12,
        status: "active",
        insurance_expires_on: new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().slice(0, 10),
        registration_expires_on: new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().slice(0, 10),
        created_by: actorUserId || null,
        updated_by: actorUserId || null,
      },
      {
        id: DEMO_IDS.transportation.vehicleTwo,
        organization_id: DEMO_IDS.orgId,
        facility_id: DEMO_IDS.facilityId,
        name: "Wheelchair Bus 1",
        vin: "3F2E1E1B1B5123456",
        license_plate: "FL-WCH-882",
        make: "Chevrolet",
        model: "Express 4500",
        model_year: 2021,
        passenger_capacity: 8,
        status: "active",
        insurance_expires_on: new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().slice(0, 10),
        registration_expires_on: new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().slice(0, 10),
        created_by: actorUserId || null,
        updated_by: actorUserId || null,
      }
    ])
  );

  // 2. Inspection Logs
  await assertNoError(
    "vehicle inspection logs upsert",
    supabase.from("vehicle_inspection_logs").upsert([
      {
        id: DEMO_IDS.transportation.inspectionOne,
        organization_id: DEMO_IDS.orgId,
        facility_id: DEMO_IDS.facilityId,
        fleet_vehicle_id: DEMO_IDS.transportation.vehicleOne,
        inspected_at: new Date(new Date().setDate(new Date().getDate() - 2)).toISOString(),
        inspector_label: "John Doe (Maintenance)",
        odometer_miles: 14250,
        result: "pass",
        defects_notes: "Minor scratch on right rear bumper. Safety check passed.",
        created_by: actorUserId || null,
        updated_by: actorUserId || null,
      }
    ])
  );

  // 3. Driver Credentials
  await assertNoError(
    "driver credentials upsert",
    supabase.from("driver_credentials").upsert([
      {
        id: DEMO_IDS.transportation.driverOne,
        organization_id: DEMO_IDS.orgId,
        facility_id: DEMO_IDS.facilityId,
        staff_id: DEMO_IDS.staff.cnaDay,
        status: "active",
        license_class: "CDL Class C",
        license_number: "D123-456-78-900-0",
        license_expires_on: new Date(new Date().setFullYear(new Date().getFullYear() + 2)).toISOString().slice(0, 10),
        medical_card_expires_on: new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().slice(0, 10),
        notes: "Cleared for wheelchair transport",
        created_by: actorUserId || null,
        updated_by: actorUserId || null,
      }
    ])
  );
}
