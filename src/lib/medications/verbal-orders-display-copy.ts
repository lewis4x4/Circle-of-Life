/**
 * Quiet Operator copy for the verbal orders list (`/admin/medications/verbal-orders`).
 * Missing resident joins name real gaps — never fabricate labels or silent em dashes.
 */

export const VERBAL_ORDERS_NO_RESIDENT_COPY = "No resident posted";

type VerbalOrderResidentJoin = {
  first_name: string | null;
  last_name: string | null;
};

/** Resident name on the verbal orders list when the join is missing or both names are blank. */
export function formatVerbalOrderResidentName(
  resident: VerbalOrderResidentJoin | null,
): string {
  if (!resident) return VERBAL_ORDERS_NO_RESIDENT_COPY;
  const name = [resident.first_name, resident.last_name].filter(Boolean).join(" ");
  if (!name) return VERBAL_ORDERS_NO_RESIDENT_COPY;
  return name;
}
