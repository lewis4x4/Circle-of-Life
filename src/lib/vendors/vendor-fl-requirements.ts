/**
 * FL ALF-facing vendor completeness signals for facility KPIs and survey prep.
 * Expanded checklist UI consumes the same canonical rows (`VendorsTab`).
 */
import { effectiveVendorCategoryKey } from "@/lib/vendors/vendor-category-ui";

export type FlVendorRequirement = {
  id: string;
  /** Survey-facing label */
  label: string;
  /** Satisfied if ANY linked canonical vendor.category matches */
  satisfiesCategories?: readonly string[];
  /** Optional row (survey guidance, not counted in KPI gap total) */
  optional?: boolean;
  /** Fallback: building_profile text field satisfies */
  buildingProfileVendorField?:
    | "generator_service_vendor"
    | "fire_alarm_monitoring_company";
  /** Emergency directory category satisfies (contact row) */
  emergencyContactCategories?: readonly string[];
};

/** Required + optional checklist rows (surveyor-visible wording). */
export const FL_VENDOR_SURVEY_CHECKLIST: FlVendorRequirement[] = [
  {
    id: "medical_director",
    label: "Medical Director",
    satisfiesCategories: ["medical_director", "consulting"],
  },
  {
    id: "resident_transport",
    label: "Resident transport",
    satisfiesCategories: ["resident_transport", "transportation", "staffing_agency"],
  },
  {
    id: "medical_waste",
    label: "Medical waste hauler",
    satisfiesCategories: ["medical_waste", "laboratory"],
  },
  { id: "pharmacy", label: "Pharmacy", satisfiesCategories: ["pharmacy", "medical_supply"] },
  {
    id: "hospice",
    label: "Hospice partner (if accepting hospice residents)",
    satisfiesCategories: ["hospice"],
    optional: true,
  },
  {
    id: "pest_control",
    label: "Pest control (FDACS posture)",
    satisfiesCategories: ["pest_control", "maintenance"],
  },
  {
    id: "food_service",
    label: "Food service (if not operated in-house)",
    satisfiesCategories: ["food_service"],
    optional: true,
  },
  {
    id: "generator_service",
    label: "Generator service",
    satisfiesCategories: ["generator", "utilities"],
    buildingProfileVendorField: "generator_service_vendor",
  },
  {
    id: "fire_alarm_monitoring",
    label: "Fire alarm monitoring",
    satisfiesCategories: ["fire_alarm", "security"],
    emergencyContactCategories: ["fire_alarm_monitoring"],
    buildingProfileVendorField: "fire_alarm_monitoring_company",
  },
  {
    id: "sprinkler_service",
    label: "Sprinkler service",
    satisfiesCategories: ["sprinkler", "maintenance", "utilities"],
  },
];

function norm(s: unknown): string {
  return typeof s === "string" ? s.trim().toLowerCase() : "";
}

function profileHasVendorText(profile: Record<string, unknown>, field?: string): boolean {
  if (!field) return false;
  const v = profile[field];
  return typeof v === "string" && v.trim().length > 0;
}

type EmergencyLite = {
  contact_category: string;
  phone_primary: string;
};

export function vendorCategorySetFromLinkedVendors(rows: readonly { vendor?: { category?: string; name?: string } | null }[]): Set<string> {
  const set = new Set<string>();
  for (const row of rows) {
    const c = norm(row.vendor?.category ?? "");
    if (c) set.add(c);
    const inferred = norm(effectiveVendorCategoryKey(row.vendor?.category ?? null, row.vendor?.name ?? null));
    if (inferred) set.add(inferred);
  }
  return set;
}

/** Mandatory rows only — used by facility header KPI (“Required vendors missing”). */
export function countFlMandatoryVendorComplianceGaps(args: {
  linkedCategories: ReadonlySet<string>;
  /** Canonical vendor_facilities rows only (exclude facility launch placeholders). */
  vendorRowsCanonical: readonly { vendor?: { category?: string; name?: string } | null }[];
  buildingProfile: Record<string, unknown> | null;
  emergencyContacts: readonly EmergencyLite[];
}): number {
  const mandatory = FL_VENDOR_SURVEY_CHECKLIST.filter((r) => !r.optional);
  let gaps = 0;
  const profile = args.buildingProfile ?? {};
  const linked = args.linkedCategories;

  const emergencyCats = new Set(
    args.emergencyContacts.filter((e) => (e.phone_primary ?? "").trim().length > 0).map((e) => norm(e.contact_category)),
  );

  const nameHaystack = args.vendorRowsCanonical
    .map((r) => norm(r.vendor?.name ?? ""))
    .join(" | ");

  for (const req of mandatory) {
    let satisfied = false;

    const cats = req.satisfiesCategories ?? [];
    satisfied = cats.some((c) => linked.has(c));

    if (!satisfied && req.buildingProfileVendorField) {
      satisfied = profileHasVendorText(profile, req.buildingProfileVendorField);
    }

    if (!satisfied && req.emergencyContactCategories?.length) {
      satisfied = req.emergencyContactCategories.some((ec) =>
        [...emergencyCats].includes(norm(ec)),
      );
    }

    if (!satisfied && req.id === "generator_service") {
      satisfied = /\bring\s*power\b/i.test(nameHaystack);
    }
    if (!satisfied && req.id === "fire_alarm_monitoring") {
      satisfied = /\bsecurity\s*safe\b/i.test(nameHaystack);
    }

    if (!satisfied) gaps += 1;
  }

  return gaps;
}

export type FlRequirementEvidence =
  | { satisfied: true; via: "vendor_category" | "building_profile" | "emergency_contact" | "name_heuristic"; detail?: string }
  | { satisfied: false };

export function evaluateFlVendorRequirement(
  req: FlVendorRequirement,
  args: {
    linkedCategories: ReadonlySet<string>;
    vendorRowsCanonical: readonly { vendor?: { category?: string; name?: string } | null }[];
    buildingProfile: Record<string, unknown> | null;
    emergencyContacts: readonly { contact_category: string; phone_primary: string }[];
  },
): FlRequirementEvidence {
  const profile = args.buildingProfile ?? {};
  const linked = args.linkedCategories;
  const nameHaystack = args.vendorRowsCanonical.map((r) => (r.vendor?.name ?? "").toLowerCase()).join(" | ");

  const cats = req.satisfiesCategories ?? [];
  if (cats.some((c) => linked.has(c))) {
    return { satisfied: true, via: "vendor_category" };
  }

  if (req.buildingProfileVendorField && profileHasVendorText(profile, req.buildingProfileVendorField)) {
    return {
      satisfied: true,
      via: "building_profile",
      detail: String(profile[req.buildingProfileVendorField]),
    };
  }

  const emergencyCats = new Set(
    args.emergencyContacts.filter((e) => (e.phone_primary ?? "").trim().length > 0).map((e) => norm(e.contact_category)),
  );
  if (req.emergencyContactCategories?.some((ec) => emergencyCats.has(norm(ec)))) {
    return { satisfied: true, via: "emergency_contact" };
  }

  if (req.id === "generator_service" && /\bring\s*power\b/i.test(nameHaystack)) {
    return { satisfied: true, via: "name_heuristic", detail: "Ring Power" };
  }
  if (req.id === "fire_alarm_monitoring" && /\bsecurity\s*safe\b/i.test(nameHaystack)) {
    return { satisfied: true, via: "name_heuristic", detail: "Security Safe" };
  }

  return { satisfied: false };
}
