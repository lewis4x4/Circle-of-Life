/**
 * Quiet Operator copy for Haven Insight facility-facts administrator labels.
 * Missing, blank, or em-dash values name real gaps — never silent dashes or fabricated names.
 */

export const FACILITY_FACTS_NO_ADMINISTRATOR_POSTED_COPY = "No administrator posted";
export const FACILITY_FACTS_NO_ASSISTANT_ADMINISTRATOR_POSTED_COPY =
  "No assistant administrator posted";

const EM_DASH = "—";

function isBlankOrEmDash(value: string | null | undefined): boolean {
  if (value == null) return true;
  const trimmed = String(value).trim();
  return trimmed === "" || trimmed === EM_DASH;
}

/** Administrator on a facility fact card when unset, blank, or em dash. */
export function formatFacilityFactsAdministratorName(
  name: string | null | undefined,
): string {
  if (isBlankOrEmDash(name)) return FACILITY_FACTS_NO_ADMINISTRATOR_POSTED_COPY;
  return String(name).trim();
}

/** Assistant administrator on a facility fact card when unset, blank, or em dash. */
export function formatFacilityFactsAssistantAdministratorName(
  name: string | null | undefined,
): string {
  if (isBlankOrEmDash(name)) return FACILITY_FACTS_NO_ASSISTANT_ADMINISTRATOR_POSTED_COPY;
  return String(name).trim();
}
