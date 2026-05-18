import {
  CONSTRUCTION_TYPES,
  FIRE_SUPPRESSION_TYPES,
  GENERATOR_FUEL_TYPES,
} from "@/lib/admin/facilities/facility-constants";

/** Display labels for DB-backed facility_building_profiles enums (Quiet Operator — no raw snake_case in UI). */

export const CONSTRUCTION_TYPE_LABELS = {
  wood_frame: "Wood frame",
  masonry: "Masonry (non-combustible / brick)",
  steel_frame: "Steel frame",
  concrete: "Concrete",
  mixed: "Mixed construction",
} as const satisfies Record<(typeof CONSTRUCTION_TYPES)[number], string>;

export const FIRE_SUPPRESSION_LABELS = {
  full_sprinkler: "Full sprinkler",
  partial_sprinkler: "Partial sprinkler",
  extinguisher_only: "Portable extinguishers only",
  none: "None on file",
} as const satisfies Record<(typeof FIRE_SUPPRESSION_TYPES)[number], string>;

export const GENERATOR_FUEL_LABELS = {
  diesel: "Diesel",
  natural_gas: "Natural gas",
  propane: "Propane",
  dual_fuel: "Dual fuel",
} as const satisfies Record<(typeof GENERATOR_FUEL_TYPES)[number], string>;

export function labelConstructionType(value: string | undefined): string {
  if (!value || !(value in CONSTRUCTION_TYPE_LABELS)) return "";
  return CONSTRUCTION_TYPE_LABELS[value as keyof typeof CONSTRUCTION_TYPE_LABELS];
}

export function labelFireSuppression(value: string | undefined): string {
  if (!value || !(value in FIRE_SUPPRESSION_LABELS)) return "";
  return FIRE_SUPPRESSION_LABELS[value as keyof typeof FIRE_SUPPRESSION_LABELS];
}

export function labelGeneratorFuel(value: string | undefined): string {
  if (!value || !(value in GENERATOR_FUEL_LABELS)) return "";
  return GENERATOR_FUEL_LABELS[value as keyof typeof GENERATOR_FUEL_LABELS];
}
