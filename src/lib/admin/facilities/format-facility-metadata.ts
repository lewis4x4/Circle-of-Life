/**
 * Quiet Operator facility chrome — subtitle helpers.
 */

function titleCaseGeo(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** e.g. Facility · Mayo, FL · License 12528 (operational status is the header pill only). */
export function formatFacilityDetailSubtitle(parts: {
  city?: string | null;
  /** Two-letter state code, e.g. FL */
  state?: string | null;
  licenseNumber?: string | null;
}): string {
  const cityRaw = typeof parts.city === "string" ? parts.city.trim() : "";
  const stateRaw = typeof parts.state === "string" ? parts.state.trim().toUpperCase() : "";

  let loc = "";
  if (cityRaw && stateRaw) {
    loc = `${titleCaseGeo(cityRaw)}, ${stateRaw}`;
  } else if (cityRaw) {
    loc = titleCaseGeo(cityRaw);
  } else if (stateRaw) {
    loc = stateRaw;
  }

  const prefix = loc ? `Facility · ${loc}` : "Facility";

  const licRaw = typeof parts.licenseNumber === "string" ? parts.licenseNumber.trim() : "";
  const licSeg = licRaw ? ` · License ${licRaw}` : "";

  return `${prefix}${licSeg}`;
}
