/**
 * Facility staffing taxonomy + conditional FL ALF role requirements (constants layer).
 * Replace with `facility_required_roles` when admin UI + migrations land.
 */

import type { FacilityDetailRow } from "@/types/facility";

export type StaffTaxonomyRowKey =
  | "resident_aide"
  | "med_tech"
  | "lpn"
  | "rn"
  | "dietary"
  | "housekeeping"
  | "maintenance"
  | "activities_director"
  | "administrator"
  | "assistant_administrator"
  | "driver"
  | "other";

export type StaffingOpsFlags = {
  administersMedications: boolean;
  providesMeals: boolean;
  providesTransportation: boolean;
};

export function staffingOpsFlagsFromFacility(facility: FacilityDetailRow): StaffingOpsFlags {
  const raw = facility.settings;
  const s =
    raw != null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    administersMedications:
      typeof s.administers_medications === "boolean" ? s.administers_medications : true,
    providesMeals: typeof s.provides_meals === "boolean" ? s.provides_meals : true,
    providesTransportation:
      typeof s.provides_transportation === "boolean" ? s.provides_transportation : false,
  };
}

export type RequiredRoleContext = StaffingOpsFlags & {
  licensedBeds: number;
};

export interface StaffTaxonomyRowDef {
  key: StaffTaxonomyRowKey;
  /** Sentence-case label */
  label: string;
  /** Raw `staff.staff_role` values counted into this bucket */
  matchRoles: readonly string[];
  isRequired: (ctx: RequiredRoleContext) => boolean;
}

function beds(ctx: RequiredRoleContext): number {
  const n = ctx.licensedBeds;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}

/** Ordered tally rows — always render entire set for survey snapshot parity. */
export const FACILITY_STAFF_TAXONOMY: readonly StaffTaxonomyRowDef[] = [
  {
    key: "resident_aide",
    label: "Resident aide",
    matchRoles: ["resident_aide", "cna"],
    isRequired: () => true,
  },
  {
    key: "med_tech",
    label: "Medication technician (Med Tech)",
    matchRoles: ["medication_tech", "med_tech"],
    isRequired: (ctx) => ctx.administersMedications,
  },
  {
    key: "lpn",
    label: "LPN",
    matchRoles: ["lpn"],
    isRequired: () => false,
  },
  {
    key: "rn",
    label: "RN",
    matchRoles: ["rn"],
    isRequired: () => false,
  },
  {
    key: "dietary",
    label: "Cook / dietary",
    matchRoles: ["dietary_staff", "dietary_manager", "dietary_aide"],
    isRequired: (ctx) => ctx.providesMeals,
  },
  {
    key: "housekeeping",
    label: "Housekeeping",
    matchRoles: ["housekeeping"],
    isRequired: () => true,
  },
  {
    key: "maintenance",
    label: "Maintenance",
    matchRoles: ["maintenance"],
    isRequired: () => true,
  },
  {
    key: "activities_director",
    label: "Activities director",
    matchRoles: ["activities_director"],
    isRequired: (ctx) => beds(ctx) > 16,
  },
  {
    key: "administrator",
    label: "Administrator",
    matchRoles: ["administrator"],
    isRequired: () => true,
  },
  {
    key: "assistant_administrator",
    label: "Assistant administrator",
    matchRoles: ["assistant_administrator"],
    isRequired: () => false,
  },
  {
    key: "driver",
    label: "Driver",
    matchRoles: ["driver"],
    isRequired: (ctx) => ctx.providesTransportation,
  },
  {
    key: "other",
    label: "Other",
    matchRoles: ["other"],
    isRequired: () => false,
  },
];

export function resolveRequiredRoleContext(facility: FacilityDetailRow): RequiredRoleContext {
  const flags = staffingOpsFlagsFromFacility(facility);
  const licensedBeds =
    typeof facility.total_licensed_beds === "number"
      ? facility.total_licensed_beds
      : typeof facility.licensed_beds === "number"
        ? facility.licensed_beds
        : typeof facility.total_beds === "number"
          ? facility.total_beds
          : 1;
  return { ...flags, licensedBeds };
}

/** Map normalized role string → taxonomy row keys that consume it (first wins for “other”). */
export function countStaffByTaxonomy(
  activeRoles: readonly string[],
): Map<StaffTaxonomyRowKey, number> {
  const normalized = activeRoles.map((r) => r.trim().toLowerCase());
  const counts = new Map<StaffTaxonomyRowKey, number>();
  for (const def of FACILITY_STAFF_TAXONOMY) {
    counts.set(def.key, 0);
  }

  const consumed = new Set<number>();

  const matchBucket = (roleNorm: string): StaffTaxonomyRowKey | null => {
    for (const def of FACILITY_STAFF_TAXONOMY) {
      if (def.key === "other") continue;
      if (def.matchRoles.some((m) => m.toLowerCase() === roleNorm)) {
        return def.key;
      }
    }
    return null;
  };

  normalized.forEach((roleNorm, idx) => {
    const bucket = matchBucket(roleNorm);
    if (bucket) {
      counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
      consumed.add(idx);
    }
  });

  normalized.forEach((roleNorm, idx) => {
    if (consumed.has(idx)) return;
    counts.set("other", (counts.get("other") ?? 0) + 1);
  });

  return counts;
}
