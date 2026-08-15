/**
 * Quiet Operator copy for v2 W2 list columns (`W2ListClient`).
 * Missing facility, status, detail, and occurred-at values name real gaps — never silent em dashes.
 */

export const W2_LIST_NO_FACILITY_COPY = "No facility posted";
export const W2_LIST_NO_STATUS_COPY = "No status posted";
export const W2_LIST_NO_DETAIL_COPY = "No detail posted";
export const W2_LIST_NO_TIME_COPY = "No time posted";

/** Facility name on a W2 list row when unset or blank. */
export function formatW2ListFacilityName(name: string | null | undefined): string {
  if (!name || !name.trim()) return W2_LIST_NO_FACILITY_COPY;
  return name.trim();
}

/** Status on a W2 list row when unset or blank. */
export function formatW2ListStatus(status: string | null | undefined): string {
  if (!status || !status.trim()) return W2_LIST_NO_STATUS_COPY;
  return status.trim();
}

/** Detail / secondary column on a W2 list row when unset or blank. */
export function formatW2ListDetail(detail: string | null | undefined): string {
  if (!detail || !detail.trim()) return W2_LIST_NO_DETAIL_COPY;
  return detail.trim();
}

/** Occurred-at timestamp on a W2 list row — posted ISO keeps UTC slice shape. */
export function formatW2ListOccurredAt(iso: string | null | undefined): string {
  if (!iso || !iso.trim()) return W2_LIST_NO_TIME_COPY;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return W2_LIST_NO_TIME_COPY;
  return d.toISOString().slice(0, 16).replace("T", " ");
}
