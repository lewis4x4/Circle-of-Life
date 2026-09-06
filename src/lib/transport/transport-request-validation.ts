import { todayFacilityDateIso } from "@/lib/facility-wall-clock";

/** A required credential must remain valid through the trip's facility calendar date. */
export function isCredentialDateValid(expiresOn: string | null | undefined, tripDate = todayFacilityDateIso()): boolean {
  if (!expiresOn || !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) return false;
  const parsed = new Date(`${expiresOn}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === expiresOn && expiresOn >= tripDate;
}

/** Spec 15 rule 5: wheelchair trip requires wheelchair-capable vehicle when a vehicle is assigned. */
export function wheelchairVehicleError(wheelchairRequired: boolean, vehicleWheelchairOk: boolean | null): string | null {
  if (!wheelchairRequired) return null;
  if (vehicleWheelchairOk === null) return null;
  if (!vehicleWheelchairOk) return "This trip requires a wheelchair-accessible vehicle. Pick a flagged vehicle or clear the vehicle assignment.";
  return null;
}
