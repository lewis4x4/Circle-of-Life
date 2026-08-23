import { todayFacilityDateIso } from "@/lib/facility-wall-clock";

/** Success stamp after a caregiver illness self-report insert. Names the Eastern calendar date. */
export function caregiverIllnessSelfReportSuccessCopy(
  now: Date = new Date(),
): string {
  const facilityDate = todayFacilityDateIso(now);
  return `Illness self-report saved for ${facilityDate} Eastern. A nurse may follow up.`;
}
