import { FacilityName } from "@/types/facility";
import type { HomewoodProtocol } from "@/types/resident-profile-contracts";

/** Homewood-specific monitoring defaults (handoff: Duke Energy / Lafayette county pilot context). */
export function buildHomewoodProtocol(facility: FacilityName | string): HomewoodProtocol {
  const active = facility === FacilityName.HOMEWOOD;
  return {
    active,
    enhancedRounding: active,
    autoWanderGuardAssessment: active,
  };
}
