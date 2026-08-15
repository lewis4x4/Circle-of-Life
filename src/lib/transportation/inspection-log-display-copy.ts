/**
 * Quiet Operator copy for transportation inspection log surfaces.
 * Missing vehicle names name real gaps — never fabricate fleet labels.
 */

export const INSPECTION_LOG_NO_VEHICLE_COPY = "No vehicle posted";

const EM_DASH = "—";
const LEGACY_UNKNOWN = "Unknown";
const LEGACY_UNKNOWN_LOWER = "unknown";

function pickVehicleName(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed === EM_DASH) return null;
  if (trimmed === LEGACY_UNKNOWN || trimmed === LEGACY_UNKNOWN_LOWER) return null;
  return trimmed;
}

/** Fleet vehicle label when the join is missing or posted names are blank or legacy unknown. */
export function formatInspectionLogVehicleDisplayName(
  fleetVehicle: { name?: string | null } | null | undefined,
): string {
  if (!fleetVehicle) return INSPECTION_LOG_NO_VEHICLE_COPY;
  const name = pickVehicleName(fleetVehicle.name);
  return name ?? INSPECTION_LOG_NO_VEHICLE_COPY;
}
