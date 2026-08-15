/**
 * Quiet Operator copy for residents roster loader (`load-residents.ts`).
 * Missing or blank posted names name real gaps — never fabricate resident names.
 */

export const LOAD_RESIDENTS_NO_NAME_COPY = "No name posted";

const LOAD_RESIDENTS_PLACEHOLDER_RESIDENT_NAMES = new Set([
  "—",
  "unknown",
  "unknown resident",
  "unnamed",
  "unnamed resident",
]);

function isMissingLoadResidentsFullName(combined: string): boolean {
  const trimmed = combined.trim();
  if (trimmed.length === 0) return true;
  return LOAD_RESIDENTS_PLACEHOLDER_RESIDENT_NAMES.has(trimmed.toLowerCase());
}

/** Resident full name on the roster when first/last are blank, whitespace, or legacy placeholder. */
export function formatLoadResidentsFullName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): string {
  const first = (firstName ?? "").trim();
  const last = (lastName ?? "").trim();
  const combined = `${first} ${last}`.trim();

  if (isMissingLoadResidentsFullName(combined)) return LOAD_RESIDENTS_NO_NAME_COPY;
  return combined;
}
