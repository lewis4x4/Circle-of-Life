/**
 * COL-651: a user with exactly one accessible facility has nothing to choose,
 * so "All facilities" is never a useful scope for them — every facility-gated
 * page would dead-end on a picker with one option. Returns the facility the
 * scope should default to, or `null` when the current scope should stand.
 */
export function singleFacilityDefault(
  facilities: readonly { id: string }[],
  selectedFacilityId: string | null,
): string | null {
  if (facilities.length !== 1) return null;
  const only = facilities[0].id;
  return selectedFacilityId === only ? null : only;
}
