/**
 * Quiet Operator copy for the admin training hub (`/admin/training`).
 * Missing facility, program, staff, dates, hours, PDFs, and signers name real gaps — never fabricate labels.
 */

export const TRAINING_HUB_NO_FACILITY_COPY = "No facility posted";
export const TRAINING_HUB_NO_PROGRAM_COPY = "No program posted";
export const TRAINING_HUB_NO_STAFF_COPY = "No staff posted";
export const TRAINING_HUB_NO_DATE_COPY = "No date posted";
export const TRAINING_HUB_NO_HOURS_COPY = "No hours posted";
export const TRAINING_HUB_NO_PDF_COPY = "No PDF posted";
export const TRAINING_HUB_NO_SIGNER_COPY = "No signer posted";

/** Facility name on a training hub row when the join is unset or blank. */
export function formatTrainingHubFacilityName(name: string | null | undefined): string {
  if (!name || !name.trim()) return TRAINING_HUB_NO_FACILITY_COPY;
  return name;
}

/** Training program name on a completion or in-service row when unset or blank. */
export function formatTrainingHubProgramName(name: string | null | undefined): string {
  if (!name || !name.trim()) return TRAINING_HUB_NO_PROGRAM_COPY;
  return name;
}

/** Staff name on a hub row when the join is unset or blank. */
export function formatTrainingHubStaffName(
  staff: { first_name: string; last_name: string } | null | undefined,
): string {
  if (!staff) return TRAINING_HUB_NO_STAFF_COPY;
  const name = `${staff.first_name} ${staff.last_name}`.trim();
  if (!name) return TRAINING_HUB_NO_STAFF_COPY;
  return name;
}

/** Calendar date on a hub row — never invents a day. */
export function formatTrainingHubDate(iso: string | null | undefined): string {
  if (!iso || !iso.trim()) return TRAINING_HUB_NO_DATE_COPY;
  const d = iso.includes("T") ? new Date(iso) : new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return TRAINING_HUB_NO_DATE_COPY;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Training hours on a completion or in-service row — real zero stays numeric. */
export function formatTrainingHubHours(h: number | null | undefined): string {
  if (h == null) return TRAINING_HUB_NO_HOURS_COPY;
  const n = typeof h === "number" ? h : Number(h);
  if (Number.isNaN(n)) return TRAINING_HUB_NO_HOURS_COPY;
  return n.toFixed(2);
}

/** Signer name on an attestation row when unset or blank. */
export function formatTrainingHubSignerName(name: string | null | undefined): string {
  if (!name || !name.trim()) return TRAINING_HUB_NO_SIGNER_COPY;
  return name;
}
