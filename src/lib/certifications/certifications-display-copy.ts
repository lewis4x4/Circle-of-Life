/**
 * Quiet Operator copy for the admin certifications hub (`/admin/certifications`).
 * Missing staff names name real gaps — never fabricate labels.
 */

export const CERTIFICATIONS_NO_STAFF_COPY = "No staff posted";

/** Staff name on a certification row or CSV export when the join is unset or blank. */
export function formatCertificationStaffName(name: string | null | undefined): string {
  if (!name) return CERTIFICATIONS_NO_STAFF_COPY;
  const trimmed = name.trim();
  if (!trimmed) return CERTIFICATIONS_NO_STAFF_COPY;
  return trimmed;
}
