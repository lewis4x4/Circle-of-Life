import { startOfDay } from "date-fns";

/** Driver license / medical card date string YYYY-MM-DD must be on or after today (facility-local calendar day approximation). */
export function isCredentialDateValid(expiresOn: string | null | undefined): boolean {
  if (!expiresOn) return false;
  const d = startOfDay(new Date(`${expiresOn}T12:00:00.000Z`));
  if (Number.isNaN(d.getTime())) return false;
  return d >= startOfDay(new Date());
}

/** Spec 15 rule 5: wheelchair trip requires wheelchair-capable vehicle when a vehicle is assigned. */
export function wheelchairVehicleError(wheelchairRequired: boolean, vehicleWheelchairOk: boolean | null): string | null {
  if (!wheelchairRequired) return null;
  if (vehicleWheelchairOk === null) return null;
  if (!vehicleWheelchairOk) return "This trip requires a wheelchair-accessible vehicle. Pick a flagged vehicle or clear the vehicle assignment.";
  return null;
}
