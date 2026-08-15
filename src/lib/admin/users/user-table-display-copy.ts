/**
 * Quiet Operator copy for the admin users table (`UserDataTable`).
 * Missing primary facility names name real gaps — never fabricate labels or silent em dashes.
 */

export const USER_TABLE_NO_PRIMARY_FACILITY_COPY = "No primary facility posted";

export type UserTablePrimaryFacility = {
  facility_name: string;
  is_primary: boolean;
};

/** Primary facility column on a user row — joins multiple primaries with ", ". */
export function formatUserTablePrimaryFacilitiesDisplay(
  facilities: UserTablePrimaryFacility[] | null | undefined,
): string {
  const primaryNames = (facilities ?? [])
    .filter((f) => f.is_primary)
    .map((f) => f.facility_name.trim())
    .filter((name) => name.length > 0);

  if (primaryNames.length === 0) return USER_TABLE_NO_PRIMARY_FACILITY_COPY;
  return primaryNames.join(", ");
}
