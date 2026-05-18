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

function operationalStatusLabel(status: string): string {
  switch (status) {
    case "inactive":
      return "Inactive";
    case "under_renovation":
      return "Under renovation";
    case "archived":
      return "Archived";
    case "active":
    default:
      return "Active";
  }
}

/** e.g. Facility · Mayo, Lafayette · License 12528 · Active */
export function formatFacilityDetailSubtitle(parts: {
  city?: string | null;
  county?: string | null;
  licenseNumber?: string | null;
  facilityOperationalStatus?: string | null;
}): string {
  const cityRaw = typeof parts.city === "string" ? parts.city.trim() : "";
  const countyRaw = typeof parts.county === "string" ? parts.county.trim() : "";

  let loc = "";
  if (cityRaw && countyRaw) {
    loc = `${titleCaseGeo(cityRaw)}, ${titleCaseGeo(countyRaw)}`;
  } else if (cityRaw) {
    loc = titleCaseGeo(cityRaw);
  } else if (countyRaw) {
    loc = titleCaseGeo(countyRaw);
  }

  const prefix = loc ? `Facility · ${loc}` : "Facility";

  const licRaw = typeof parts.licenseNumber === "string" ? parts.licenseNumber.trim() : "";
  const licSeg = licRaw ? ` · License ${licRaw}` : "";

  const st = operationalStatusLabel((parts.facilityOperationalStatus ?? "active").trim() || "active");

  return `${prefix}${licSeg} · ${st}`;
}
