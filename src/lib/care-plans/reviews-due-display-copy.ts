/**
 * Quiet Operator copy for care plan reviews-due roster resident labels.
 * Missing resident rows and blank names name real gaps — never fabricate labels.
 */

export const REVIEWS_DUE_NO_RESIDENT_POSTED_COPY = "No resident posted";
export const REVIEWS_DUE_NO_NAME_POSTED_COPY = "No name posted";

const EM_DASH = "—";

function isBlankOrEmDash(value: string | null | undefined): boolean {
  if (value == null) return true;
  const trimmed = String(value).trim();
  return trimmed === "" || trimmed === EM_DASH;
}

export type ReviewsDueResidentNameFields = {
  first_name: string | null;
  last_name: string | null;
};

function residentNameFromFields(r: ReviewsDueResidentNameFields): string {
  return `${r.first_name?.trim() ?? ""} ${r.last_name?.trim() ?? ""}`.trim();
}

/** Resident label on reviews-due rows when the join or name is unset, blank, or em dash. */
export function formatReviewsDueResidentLabel(
  resident: ReviewsDueResidentNameFields | null | undefined,
): string {
  if (!resident) return REVIEWS_DUE_NO_RESIDENT_POSTED_COPY;
  const name = residentNameFromFields(resident);
  if (isBlankOrEmDash(name)) return REVIEWS_DUE_NO_NAME_POSTED_COPY;
  return name;
}
