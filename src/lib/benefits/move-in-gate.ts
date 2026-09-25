/**
 * COL-575: before an arrival can be approved, anyone expected to rely on Medicaid needs a preliminary review
 * showing they are likely to qualify (the admission Medicaid questions returned "candidate"), or a Facility
 * Executive override with a reason. The check itself lives in the database's arrival readiness (migration 550,
 * using 528's gate); the admission PATCH route only records the override, and only for these roles.
 */
export const MOVE_IN_GATE_OVERRIDE_ROLES = ["owner", "org_admin", "facility_admin"] as const;

export function moveInGateOverrideAllowed(role: string) {
  return (MOVE_IN_GATE_OVERRIDE_ROLES as readonly string[]).includes(role);
}
