import { describe, expect, it } from "vitest";

import { factExtractionCatalog, parseResidentFactValue, type ResidentFactCode } from "./fact-registry";

const validFacts: Array<[ResidentFactCode, unknown]> = [
  ["resident.contact", { contact_type: "emergency", name: "Ada Lovelace", relationship: "daughter", phone: "555-0100" }],
  ["resident.payer", { payer_type: "medicaid_oss", effective_date: "2026-09-15", payer_name: "Example MCO", policy_number: "P-1", group_number: "G-1", payer_phone: "555-0101", medicaid_recipient_id: "M-1" }],
  ["resident.profile_fact", { category: "preference", field_code: "preference.language", value: "English", effective_date: "2026-09-15" }],
  ["resident.authority_instrument", { instrument_type: "durable_power_of_attorney", holder_name: "Grace Hopper", relationship: "daughter", scope: ["Healthcare decisions"], status: "reported" }],
  ["resident.screening", { screening_type: "background_registry", searched_on: "2026-09-15", result: "clear" }],
  ["resident.provider_referral", { referral_type: "behavioral_health", provider_name: "Example Provider", referred_on: "2026-09-15", status: "documented" }],
  ["resident.contract", { contract_type: "admission_agreement", status: "completed", paper_signature_observation: { signer_name: "Ada Lovelace", signature_observed: true, signed_date: "2026-09-15" } }],
  ["resident.medication_order", {
    action: "save",
    reason: "Signed physician order reviewed by nurse",
    order: {
      medication_name: "Example medication",
      strength: "10 mg",
      form: "tablet",
      route: "oral",
      frequency: "daily",
      scheduled_times: ["08:00"],
      instructions: "Take one tablet by mouth daily",
      prescriber_name: "Example Prescriber",
      order_date: "2026-09-14",
      start_date: "2026-09-15",
      controlled_schedule: "non_controlled",
    },
  }],
];

const validForm1823 = {
  physician_name: "Example Physician",
  exam_date: "2026-09-01",
  expiration_date: "2027-09-01",
  representative_name: null,
  representative_relationship: null,
  representative_phone: null,
  allergies: [],
  height_inches: 66,
  weight_lbs: 145,
  medical_history: { diagnoses: ["Example diagnosis"] },
  physical_limitations: {},
  cognitive_behavioral_status: { orientation: "not_assessed" },
  service_requirements: {},
  precautions: {},
  elopement_risk: null,
  adl_bathing: "assistance",
  adl_dressing: "supervision",
  adl_eating: "independent",
  adl_transferring: "assistance",
  adl_toileting: "assistance",
  adl_grooming: "supervision",
  adl_walking: "dependent",
  prescribed_diet: null,
  condition_communicable_disease: false,
  condition_bedridden: false,
  condition_pressure_injury: false,
  condition_tuberculosis: false,
  condition_special_precautions: null,
  alf_care_appropriate: true,
  medication_assistance: "assistance_with_self_administration",
  examiner_license_number: "ME-12345",
  examiner_license_type: "MD",
  examiner_title: "Physician",
  examiner_phone: "555-0102",
  examiner_address: "100 Example Street",
  examiner_signature_date: "2026-09-01",
  source_pages: [1, 2, 3],
  checklist_note: "Nurse reviewed all three Form 1823 pages",
};

describe("resident fact canonical writer contracts", () => {
  it.each(validFacts)("accepts the canonical %s shape", (code, value) => {
    expect(parseResidentFactValue(code, value).success).toBe(true);
  });

  it("rejects legacy aliases that the SQL writer would ignore", () => {
    expect(parseResidentFactValue("resident.contact", { kind: "emergency", name: "Ada" }).success).toBe(false);
    expect(parseResidentFactValue("resident.payer", { payer_name: "Example", coverage_start: "2026-09-15" }).success).toBe(false);
    expect(parseResidentFactValue("resident.authority_instrument", { person_name: "Grace", observed_status: "reported" }).success).toBe(false);
    expect(parseResidentFactValue("resident.screening", { screening_type: "other", searched_at: "2026-09-15", result: "clear" }).success).toBe(false);
    expect(parseResidentFactValue("resident.medication_order", { medication_name: "Example" }).success).toBe(false);
  });

  it("publishes value-schema guidance in the provider catalog", () => {
    const catalog = factExtractionCatalog();
    expect(catalog.find((fact) => fact.code === "resident.payer")?.value_schema).toMatchObject({
      type: "object",
      required: expect.arrayContaining(["payer_type", "effective_date"]),
    });
    expect(catalog.find((fact) => fact.code === "resident.medication_order")?.value_schema).toMatchObject({ type: "object" });
  });

  it("accepts the strict April 2021 Form 1823 writer shape", () => {
    expect(parseResidentFactValue("admission.form_1823", validForm1823).success).toBe(true);
  });

  it("rejects missing, unknown, invalid ADL, and inconsistent Form 1823 fields", () => {
    const missingPhysician: Record<string, unknown> = { ...validForm1823 };
    delete missingPhysician.physician_name;
    expect(parseResidentFactValue("admission.form_1823", missingPhysician).success).toBe(false);
    expect(parseResidentFactValue("admission.form_1823", { ...validForm1823, arbitrary_sql: "not allowed" }).success).toBe(false);
    expect(parseResidentFactValue("admission.form_1823", { ...validForm1823, adl_bathing: "T" }).success).toBe(false);
    expect(parseResidentFactValue("admission.form_1823", { ...validForm1823, expiration_date: "2025-09-01" }).success).toBe(false);
    expect(parseResidentFactValue("admission.form_1823", { ...validForm1823, source_pages: [1, 1] }).success).toBe(false);
  });

  it("keeps non-binary gender and empty diagnosis/allergy arrays valid", () => {
    expect(parseResidentFactValue("resident.gender", "non_binary").success).toBe(true);
    expect(parseResidentFactValue("resident.diagnosis_list", []).success).toBe(true);
    expect(parseResidentFactValue("resident.allergy_list", []).success).toBe(true);
  });
});
