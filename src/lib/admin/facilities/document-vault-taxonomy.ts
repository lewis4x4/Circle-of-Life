/**
 * Facility Document Vault — FL ALF taxonomy (mirrors migration `248_facility_document_vault_taxonomy.sql`).
 */

export const DOCUMENT_VAULT_PARENTS = [
  "compliance",
  "insurance",
  "vendors",
  "building",
  "staff",
  "reference",
] as const;

export type DocumentVaultParent = (typeof DOCUMENT_VAULT_PARENTS)[number];

export const DOCUMENT_VAULT_CATEGORY_KEYS = [
  "ahca_licensing",
  "survey_reports_poc",
  "fire_inspections",
  "sprinkler_inspections",
  "generator_service_records",
  "cemp",
  "insurance_general_liability",
  "insurance_property",
  "insurance_professional_liability",
  "insurance_workers_comp",
  "insurance_bond",
  "insurance_loss_run",
  "vendor_contracts",
  "vendor_coi",
  "medical_director_agreement",
  "hospice_partnership_agreements",
  "pharmacy_contract",
  "resident_contracts_master",
  "building_permits_cof",
  "elevator_certificate",
  "pest_control_records",
  "health_department_inspections",
  "food_service_license",
  "background_check_records",
  "staff_training_records",
  "policies_procedures_manual",
  "floor_plans_evacuation_maps",
  "photos",
  "other_misc",
] as const;

export type DocumentVaultCategoryKey = (typeof DOCUMENT_VAULT_CATEGORY_KEYS)[number];

export const DOCUMENT_VAULT_CATEGORY_LABELS: Record<DocumentVaultCategoryKey, string> = {
  ahca_licensing: "AHCA Licensing",
  survey_reports_poc: "Survey reports & Plans of Correction",
  fire_inspections: "Fire inspections",
  sprinkler_inspections: "Sprinkler inspections",
  generator_service_records: "Generator service records",
  cemp: "CEMP (Emergency Management Plan)",
  insurance_general_liability: "Insurance — General Liability",
  insurance_property: "Insurance — Property",
  insurance_professional_liability: "Insurance — Professional Liability",
  insurance_workers_comp: "Insurance — Workers Comp",
  insurance_bond: "Insurance — Bond",
  insurance_loss_run: "Insurance — Loss Run",
  vendor_contracts: "Vendor contracts",
  vendor_coi: "Vendor COIs",
  medical_director_agreement: "Medical Director agreement",
  hospice_partnership_agreements: "Hospice partnership agreements",
  pharmacy_contract: "Pharmacy contract",
  resident_contracts_master: "Resident contracts (master template)",
  building_permits_cof: "Building permits / Certificate of Occupancy",
  elevator_certificate: "Elevator certificate",
  pest_control_records: "Pest control records",
  health_department_inspections: "Health Department inspections",
  food_service_license: "Food service license",
  background_check_records: "Background check records",
  staff_training_records: "Staff training records",
  policies_procedures_manual: "Policies & Procedures manual",
  floor_plans_evacuation_maps: "Floor plans / evacuation maps",
  photos: "Photos",
  other_misc: "Other / Miscellaneous",
};

export const DOCUMENT_VAULT_CATEGORY_PARENT: Record<DocumentVaultCategoryKey, DocumentVaultParent> = {
  ahca_licensing: "compliance",
  survey_reports_poc: "compliance",
  fire_inspections: "building",
  sprinkler_inspections: "building",
  generator_service_records: "building",
  cemp: "compliance",
  insurance_general_liability: "insurance",
  insurance_property: "insurance",
  insurance_professional_liability: "insurance",
  insurance_workers_comp: "insurance",
  insurance_bond: "insurance",
  insurance_loss_run: "insurance",
  vendor_contracts: "vendors",
  vendor_coi: "vendors",
  medical_director_agreement: "compliance",
  hospice_partnership_agreements: "compliance",
  pharmacy_contract: "vendors",
  resident_contracts_master: "reference",
  building_permits_cof: "building",
  elevator_certificate: "building",
  pest_control_records: "building",
  health_department_inspections: "compliance",
  food_service_license: "compliance",
  background_check_records: "staff",
  staff_training_records: "staff",
  policies_procedures_manual: "reference",
  floor_plans_evacuation_maps: "reference",
  photos: "reference",
  other_misc: "reference",
};

/** Optional expiration: upload form never hard-requires expiry for these. */
export const DOCUMENT_CATEGORY_EXPIRATION_NA: ReadonlySet<DocumentVaultCategoryKey> = new Set([
  "survey_reports_poc",
  "insurance_loss_run",
  "photos",
  "floor_plans_evacuation_maps",
  "policies_procedures_manual",
  "resident_contracts_master",
]);

/** Explicitly require expiration dates on upload (survey-facing renewals). */
export function vaultCategoryExpirationRequired(category: DocumentVaultCategoryKey): boolean {
  return !DOCUMENT_CATEGORY_EXPIRATION_NA.has(category);
}

export const DOCUMENT_VAULT_PARENT_LABELS: Record<DocumentVaultParent, string> = {
  compliance: "Compliance",
  insurance: "Insurance",
  vendors: "Vendors",
  building: "Building",
  staff: "Staff",
  reference: "Reference",
};

/**
 * KPI “missing required” uses this minimum slot list (facility must hold current evidence rows).
 */
export const DOCUMENT_VAULT_REQUIRED_SLOTS: DocumentVaultCategoryKey[] = [
  "ahca_licensing",
  "food_service_license",
  "insurance_general_liability",
  "insurance_property",
  "fire_inspections",
  "sprinkler_inspections",
  "elevator_certificate",
];
